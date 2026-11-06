// electron/fileMoves.cjs — MO1 (MOTH_DESIGN §1.8, her answer 2): moving files on one computer.
//
// Within a project only folder_id changes, in one write. Between projects the body moves as well,
// so the move has a durable journal: <rabbit-data>/moves/<op>.json, written before any body moves
// and deleted only after both bundles are written and read back. A crash at any point leaves a
// journal, and recoverMoves, which runs at start-up and before each new move, finishes what it can.
//
// A journal holds no decision to re-take: it says which files, from where, to where. Recovery asks
// only where each body is now.
//
// The same folder holds the journal of retiring a local original after a cloud copy-up, as
// retire-<op>.json: localMedia.cjs writes and finishes those.

const crypto = require('node:crypto');
const { isMothExcluded } = require('./fileTrash.cjs');

function sha1Of(fs, file) {
  const h = crypto.createHash('sha1');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      h.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

// A rename where it can; across volumes a copy, flushed, checked by size and sha1, and only then the
// original removed. A copy that does not match is removed and the original kept.
function moveBody(fs, from, to) {
  fs.mkdirSync(require('node:path').dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
    return;
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
  }
  fs.copyFileSync(from, to);
  const fd = fs.openSync(to, 'r+');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  if (fs.statSync(from).size !== fs.statSync(to).size || sha1Of(fs, from) !== sha1Of(fs, to)) {
    fs.unlinkSync(to);
    throw new Error('the copy did not match its original');
  }
  fs.unlinkSync(from);
}

function mountFileMoves(app, deps) {
  const { fs, path, readRabbitBundle, writeRabbitBundle, rabbitNotFound, rabbitRemoveFrom, resolveFileBaseDir,
    resolveContainedFilePath, rabbitLogFileEvent, writeJsonAtomic, movesDir } = deps;

  const journalPath = (op) => path.join(movesDir(), `${op}.json`);

  // Each item's body is at its source, at its destination, or (a crash inside a copy) at both. The
  // bundles are then written from the journal, whichever of them had already been.
  function finish(journal) {
    const src = readRabbitBundle(journal.from_project);
    const dst = readRabbitBundle(journal.to_project);
    if (!src || !dst) throw new Error('a project of this move is not there');
    for (const it of journal.items) {
      const from = resolveContainedFilePath(resolveFileBaseDir(src, journal.from_project, it.row), it.row.storage_path);
      const to = resolveContainedFilePath(resolveFileBaseDir(dst, journal.to_project, it.row), it.row.storage_path);
      if (!from || !to) throw new Error('a path of this move is not contained');
      if (fs.existsSync(from)) {
        if (fs.existsSync(to)) {
          // Both: the original stands until the copy is proved, so only a proved copy lets it go.
          if (sha1Of(fs, from) === sha1Of(fs, to)) fs.unlinkSync(from);
          else fs.unlinkSync(to);
        }
        if (fs.existsSync(from)) moveBody(fs, from, to);
      }
      rabbitRemoveFrom(src.files, it.row.id);
      rabbitRemoveFrom(dst.files, it.row.id);
      dst.files.push({
        ...it.row,
        project_id: journal.to_project,
        folder_id: journal.to_folder ?? null,
        // As the cloud's move does: the links and the flag belong to the project it left.
        phase_id: null, asset_id: null, task_id: null, scene_id: null, shot_id: null, level_id: null, experience_id: null,
        is_core_definer: false,
      });
      rabbitLogFileEvent(src, { file_id: it.row.id, project_id: journal.from_project, file_name: it.row.name, storage_provider: it.row.storage_provider, event: 'moved_out' });
      rabbitLogFileEvent(dst, { file_id: it.row.id, project_id: journal.to_project, file_name: it.row.name, storage_provider: it.row.storage_provider, event: 'moved_in' });
    }
    writeRabbitBundle(journal.to_project, dst);
    writeRabbitBundle(journal.from_project, src);
    const backSrc = readRabbitBundle(journal.from_project);
    const backDst = readRabbitBundle(journal.to_project);
    for (const it of journal.items) {
      if (backSrc.files.some((f) => f.id === it.row.id) || !backDst.files.some((f) => f.id === it.row.id)) {
        throw new Error('the projects did not read back as written');
      }
    }
    fs.unlinkSync(journalPath(journal.op));
  }

  // A journal that cannot finish now stays for next time: a project's drive may be away.
  function recoverMoves() {
    const dir = movesDir();
    if (!fs.existsSync(dir)) return { recovered: 0, left: 0 };
    let recovered = 0;
    let left = 0;
    for (const name of fs.readdirSync(dir)) {
      // A retire's journal (localMedia.cjs) sits here too, and is finished there.
      if (!name.endsWith('.json') || name.startsWith('retire-')) continue;
      try {
        finish(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
        recovered += 1;
      } catch {
        left += 1;
      }
    }
    return { recovered, left };
  }

  app.post('/api/rabbit/projects/:projectId/files/move', (req, res) => {
    const bundle = readRabbitBundle(req.params.projectId);
    if (!bundle) return rabbitNotFound(res);
    const ids = [...new Set(Array.isArray(req.body?.ids) ? req.body.ids : [])];
    const folderId = req.body?.folder_id ?? null;
    if (folderId && !(bundle.folders || []).some((f) => f.id === folderId)) return rabbitNotFound(res, 'folder');
    const rows = ids.map((id) => bundle.files.find((f) => f.id === id));
    if (rows.some((r) => !r || isMothExcluded(bundle, r))) return rabbitNotFound(res, 'file');
    for (const r of rows) r.folder_id = folderId;
    writeRabbitBundle(req.params.projectId, bundle);
    return res.json({ moved: rows.length });
  });

  app.post('/api/rabbit/files/move-between-projects', (req, res) => {
    recoverMoves();
    const { ids, from_project: fromProject, to_project: toProject, to_folder: toFolder = null } = req.body || {};
    const list = [...new Set(Array.isArray(ids) ? ids : [])];
    if (list.length === 0 || !fromProject || !toProject || fromProject === toProject) return res.status(400).json({ error: 'bad_request' });
    const src = readRabbitBundle(fromProject);
    const dst = readRabbitBundle(toProject);
    if (!src || !dst) return rabbitNotFound(res);
    if (toFolder && !(dst.folders || []).some((f) => f.id === toFolder)) return rabbitNotFound(res, 'folder');
    if (toFolder && isMothExcluded(dst, { id: '', folder_id: toFolder })) return rabbitNotFound(res, 'folder');
    const rows = list.map((id) => src.files.find((f) => f.id === id));
    if (rows.some((r) => !r || isMothExcluded(src, r))) return rabbitNotFound(res, 'file');
    // Every question before anything is written: a name taken at the far end is refused whole.
    const seen = new Set();
    for (const r of rows) {
      const to = resolveContainedFilePath(resolveFileBaseDir(dst, toProject, r), r.storage_path);
      const from = resolveContainedFilePath(resolveFileBaseDir(src, fromProject, r), r.storage_path);
      if (!to || !from) return res.status(400).json({ error: 'not_contained' });
      if (fs.existsSync(to) || dst.files.some((f) => f.storage_path === r.storage_path) || seen.has(to)) return res.status(409).json({ error: 'name_taken' });
      seen.add(to);
    }
    const op = crypto.randomUUID();
    const journal = { op, from_project: fromProject, to_project: toProject, to_folder: toFolder, items: rows.map((row) => ({ row })) };
    fs.mkdirSync(movesDir(), { recursive: true });
    writeJsonAtomic(journalPath(op), journal);
    try {
      finish(journal);
    } catch (err) {
      // The journal stands, so the next start finishes it. The person is told it has not landed yet.
      return res.status(500).json({ error: 'not_finished', op, detail: String(err.message || err) });
    }
    return res.json({ moved: rows.length, op });
  });

  return { recoverMoves };
}

module.exports = { mountFileMoves, moveBody };
