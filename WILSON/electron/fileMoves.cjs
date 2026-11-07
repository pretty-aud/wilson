// electron/fileMoves.cjs — MO1 (MOTH_DESIGN §1.8, her answer 2): moving files on one computer.
//
// Within a project only folder_id changes, in one write. Between projects the body moves as well,
// so the move has a durable journal: <rabbit-data>/moves/<op>.json, written before any body moves
// and deleted only after both bundles are written and read back. Moves take turns.
//
// A failure the route sees (a file held open, a disk that said no) puts the bodies back and answers
// that nothing moved. A crash leaves the journal, and recoverMoves, which runs at start-up and before
// each new move, asks only where things are now: with the row in the destination's bundle the move
// happened, so it rolls forward; with no row there it did not, and the bodies go home (§1.2, §1.11).
// A row is always written from the bundle as it is then, never from the journal's copy.
//
// The same folder holds the journal of retiring a local original after a cloud copy-up, as
// retire-<op>.json: localMedia.cjs writes and finishes those.

const crypto = require('node:crypto');
const nodePath = require('node:path');
const { isMothExcluded } = require('./fileTrash.cjs');
const { copyVerified, sameBytes } = require('./copyInWorker.cjs');

const IN_USE = new Set(['EBUSY', 'EPERM', 'EACCES']);
const LINKS = [['phase_id', 'phases'], ['asset_id', 'assets'], ['task_id', 'tasks'], ['scene_id', 'scenes'],
  ['shot_id', 'shots'], ['level_id', 'levels'], ['experience_id', 'experiences']];

// Beside its target, so the rename that finishes it is one step. Its name is fixed, so recovery can find it.
const copyingName = (to) => nodePath.join(nodePath.dirname(to), `.wilson-moving-${nodePath.basename(to).slice(-200)}`);

// A rename where it can; across volumes a copy under a name of its own, flushed, checked by size and sha1
// off the main thread, and only then given the real name and the original removed. So a file at the real
// name is whole, whenever a crash came. If the original cannot be removed the copy is taken back, and the
// move is as it was: a retry would otherwise find its own copy and call the name taken.
async function moveBody(fs, from, to, copier = copyVerified) {
  fs.mkdirSync(nodePath.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
    return;
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
  }
  const copying = copyingName(to);
  try {
    await copier(from, copying, { hash: true });
    fs.renameSync(copying, to);
  } catch (err) {
    fs.rmSync(copying, { force: true });
    throw err;
  }
  try {
    fs.unlinkSync(from);
  } catch (err) {
    fs.rmSync(to, { force: true });
    throw err;
  }
}

function mountFileMoves(app, deps) {
  const { fs, path, readRabbitBundle, writeRabbitBundle, rabbitNotFound, rabbitRemoveFrom, resolveFileBaseDir,
    resolveContainedFilePath, rabbitLogFileEvent, writeJsonAtomic, movesDir,
    projectFolderAway = () => false, afterBodies = () => null, log = () => {} } = deps;

  const journalPath = (op) => path.join(movesDir(), `${op}.json`);
  let turn = Promise.resolve();
  const inTurn = (fn) => {
    const run = turn.then(fn, fn);
    turn = run.catch(() => {});
    return run;
  };

  const pathsOf = (src, dst, journal, row) => {
    const from = resolveContainedFilePath(resolveFileBaseDir(src, journal.from_project, row), row.storage_path);
    const to = resolveContainedFilePath(resolveFileBaseDir(dst, journal.to_project, row), row.storage_path);
    if (!from || !to) throw new Error('a path of this move is not contained');
    return { from, to };
  };
  const nameHeld = (bundle, projectId, at, exceptId = null) => bundle.files.some((f) => f.id !== exceptId
    && resolveContainedFilePath(resolveFileBaseDir(bundle, projectId, f), f.storage_path) === at);

  // The bundles are read here, after the bodies have moved, however long that took: a project changed
  // during a copy keeps its change. From the first read to the last write nothing waits.
  function writeRows(journal) {
    const src = readRabbitBundle(journal.from_project);
    const dst = readRabbitBundle(journal.to_project);
    if (!src || !dst) throw new Error('a project of this move is not there');
    let linksNotRestored = 0;
    const gone = [];
    for (const it of journal.items) {
      const live = src.files.find((f) => f.id === it.row.id);
      if (!live) {
        if (!dst.files.some((f) => f.id === it.row.id)) gone.push(it);
        continue;
      }
      // As the cloud's move does: the links and the flag belong to the project it left, and a way
      // back returns them, but for what has been deleted since.
      const back = journal.back?.[it.row.id] ?? null;
      const links = {};
      for (const [key, list] of LINKS) {
        const wanted = back?.links?.[key] ?? null;
        const alive = wanted && (dst[list] || []).some((x) => x.id === wanted && !x.deleted_at);
        links[key] = alive ? wanted : null;
        if (wanted && !alive) linksNotRestored += 1;
      }
      const askedFolder = back ? back.folder_id ?? null : journal.to_folder ?? null;
      const folderOk = askedFolder && (dst.folders || []).some((f) => f.id === askedFolder) && !isMothExcluded(dst, { id: '', folder_id: askedFolder });
      rabbitRemoveFrom(src.files, live.id);
      rabbitRemoveFrom(dst.files, live.id);
      dst.files.push({
        ...live,
        project_id: journal.to_project,
        folder_id: folderOk ? askedFolder : null,
        ...links,
        is_core_definer: Boolean(back?.is_core_definer),
      });
      rabbitLogFileEvent(src, { file_id: live.id, project_id: journal.from_project, file_name: live.name, storage_provider: live.storage_provider, event: 'moved_out' });
      rabbitLogFileEvent(dst, { file_id: live.id, project_id: journal.to_project, file_name: live.name, storage_provider: live.storage_provider, event: 'moved_in' });
    }
    try {
      writeRabbitBundle(journal.to_project, dst);
    } catch (err) {
      err.destWritten = false;
      throw err;
    }
    try {
      writeRabbitBundle(journal.from_project, src);
      const backSrc = readRabbitBundle(journal.from_project);
      const backDst = readRabbitBundle(journal.to_project);
      for (const it of journal.items) {
        if (gone.includes(it)) continue;
        if (backSrc.files.some((f) => f.id === it.row.id) || !backDst.files.some((f) => f.id === it.row.id)) {
          throw new Error('the projects did not read back as written');
        }
      }
    } catch (err) {
      err.destWritten = true;
      throw err;
    }
    return { gone, linksNotRestored };
  }

  // What a crash left at the far end goes home. A file at the far end that a row names is that row's,
  // whatever its name says. With a body at both ends only a copy of the same bytes is removed: two
  // different files keep both, and the journal stays, because neither is WILSON's to throw away.
  async function homeOne(src, dst, journal, row) {
    const { from, to } = pathsOf(src, dst, journal, row);
    if (!fs.existsSync(to) || nameHeld(dst, journal.to_project, to, row.id)) return;
    if (!fs.existsSync(from)) {
      await moveBody(fs, to, from);
      return;
    }
    if (!(await sameBytes(from, to))) throw new Error('two different files have this name');
    fs.unlinkSync(to);
  }

  // Forward: the body at the far end, where a crash after a copy may have left both.
  async function forwardOne(src, dst, journal, row) {
    const { from, to } = pathsOf(src, dst, journal, row);
    if (!fs.existsSync(from)) return;
    if (fs.existsSync(to)) {
      if (!(await sameBytes(from, to))) throw new Error('two different files have this name');
      fs.unlinkSync(from);
      return;
    }
    await moveBody(fs, from, to);
  }

  // What a crash left of a copy under way: never a whole file's only copy, since the original is removed
  // only after the rename.
  function sweepCopying(src, dst, journal) {
    for (const it of journal.items) {
      const { from, to } = pathsOf(src, dst, journal, it.row);
      fs.rmSync(copyingName(to), { force: true });
      fs.rmSync(copyingName(from), { force: true });
    }
  }

  // A journal may be from a folder someone handed over, so it says what it is, and which file it is.
  function readJournal(name) {
    const journal = JSON.parse(fs.readFileSync(path.join(movesDir(), name), 'utf8'));
    const shaped = journal && `${journal.op}.json` === name
      && typeof journal.from_project === 'string' && typeof journal.to_project === 'string'
      && Array.isArray(journal.items) && journal.items.every((it) => typeof it?.row?.id === 'string' && typeof it.row.storage_path === 'string');
    if (!shaped) throw new Error('this is not a journal of a move');
    return journal;
  }

  async function recoverOne(name) {
    const journal = readJournal(name);
    const src = readRabbitBundle(journal.from_project);
    const dst = readRabbitBundle(journal.to_project);
    if (!src || !dst) throw new Error('a project of this move is not there');
    if (projectFolderAway(src, journal.from_project) || projectFolderAway(dst, journal.to_project)) throw new Error('a folder of this move is away');
    sweepCopying(src, dst, journal);
    const happened = journal.items.some((it) => dst.files.some((f) => f.id === it.row.id));
    if (happened) {
      for (const it of journal.items) {
        const live = src.files.find((f) => f.id === it.row.id);
        if (live) await forwardOne(src, dst, journal, live);
      }
      // A row trashed while its move was under way: its body goes home, where its trash entry expects it.
      const { gone } = writeRows(journal);
      for (const it of gone) await homeOne(readRabbitBundle(journal.from_project), readRabbitBundle(journal.to_project), journal, it.row);
    } else {
      for (const it of journal.items) await homeOne(src, dst, journal, it.row);
    }
    fs.unlinkSync(journalPath(journal.op));
  }

  const journalNames = () => (fs.existsSync(movesDir())
    ? fs.readdirSync(movesDir()).filter((name) => name.endsWith('.json') && !name.startsWith('retire-')) // A retire's: localMedia.cjs.
    : []);

  // A journal that cannot finish now stays for next time, and the pending list says so.
  async function recoverNow() {
    let recovered = 0;
    let left = 0;
    for (const name of journalNames()) {
      try {
        await recoverOne(name);
        recovered += 1;
      } catch {
        left += 1;
      }
    }
    if (left > 0) log(`[file-moves] ${left} move(s) could not finish yet`);
    return { recovered, left };
  }
  const recoverMoves = () => inTurn(recoverNow);

  // What is waiting: which projects and how many files, and no path.
  app.get('/api/rabbit/files/pending-moves', (_req, res) => {
    res.json({
      moves: journalNames().map((name) => {
        try {
          const journal = readJournal(name);
          return { op: journal.op, from_project: journal.from_project, to_project: journal.to_project, files: journal.items.length };
        } catch {
          return { op: name.replace(/\.json$/, ''), unreadable: true };
        }
      }),
    });
  });

  app.post('/api/rabbit/projects/:projectId/files/move', (req, res) => {
    const bundle = readRabbitBundle(req.params.projectId);
    if (!bundle) return rabbitNotFound(res);
    const ids = [...new Set(Array.isArray(req.body?.ids) ? req.body.ids : [])];
    const folderId = req.body?.folder_id ?? null;
    if (folderId && !(bundle.folders || []).some((f) => f.id === folderId)) return rabbitNotFound(res, 'folder');
    if (folderId && isMothExcluded(bundle, { id: '', folder_id: folderId })) return rabbitNotFound(res, 'folder');
    const rows = ids.map((id) => bundle.files.find((f) => f.id === id));
    if (rows.some((r) => !r || isMothExcluded(bundle, r))) return rabbitNotFound(res, 'file');
    for (const r of rows) r.folder_id = folderId;
    writeRabbitBundle(req.params.projectId, bundle);
    return res.json({ moved: rows.length });
  });

  const refuse = (res, status, code, error) => res.status(status).json({ code, error });

  async function moveBetween(req, res) {
    await recoverNow();
    const { ids, from_project: fromProject, to_project: toProject, to_folder: toFolder = null, back = null } = req.body || {};
    const list = [...new Set(Array.isArray(ids) ? ids : [])];
    if (list.length === 0 || !fromProject || !toProject || fromProject === toProject) return refuse(res, 400, 'bad_request', 'Choose the files and where they go.');
    const src = readRabbitBundle(fromProject);
    const dst = readRabbitBundle(toProject);
    if (!src || !dst) return rabbitNotFound(res);
    if (toFolder && !(dst.folders || []).some((f) => f.id === toFolder)) return rabbitNotFound(res, 'folder');
    if (toFolder && isMothExcluded(dst, { id: '', folder_id: toFolder })) return rabbitNotFound(res, 'folder');
    const rows = list.map((id) => src.files.find((f) => f.id === id));
    if (rows.some((r) => !r || isMothExcluded(src, r))) return rabbitNotFound(res, 'file');
    // A folder that is away would have the rows move and the bodies stay, or land in the wrong place.
    if (projectFolderAway(src, fromProject) || projectFolderAway(dst, toProject)) {
      return refuse(res, 409, 'folder_away', 'One of these projects\' folders cannot be reached right now. Connect its drive and try again.');
    }
    // Every question before anything is written: a name taken at the far end is refused whole.
    const seen = new Set();
    for (const r of rows) {
      const to = resolveContainedFilePath(resolveFileBaseDir(dst, toProject, r), r.storage_path);
      const from = resolveContainedFilePath(resolveFileBaseDir(src, fromProject, r), r.storage_path);
      if (!to || !from) return refuse(res, 400, 'not_contained', 'This file\'s place is outside its project, so it stayed where it was.');
      if (!fs.existsSync(from)) return refuse(res, 409, 'body_missing', `The stored copy of "${r.name}" cannot be found, so nothing moved.`);
      if (fs.existsSync(to) || nameHeld(dst, toProject, to) || seen.has(to)) {
        return refuse(res, 409, 'name_taken', `A file called "${r.name}" is already in that project, so nothing moved.`);
      }
      seen.add(to);
    }
    const before = rows.map((r) => ({
      id: r.id,
      folder_id: r.folder_id ?? null,
      is_core_definer: Boolean(r.is_core_definer),
      links: Object.fromEntries(LINKS.map(([key]) => [key, r[key] ?? null])),
    }));
    const op = crypto.randomUUID();
    const journal = {
      op, from_project: fromProject, to_project: toProject, to_folder: toFolder, items: rows.map((row) => ({ row })),
      ...(Array.isArray(back) ? { back: Object.fromEntries(back.filter((b) => b?.id).map((b) => [b.id, b])) } : {}),
    };
    fs.mkdirSync(movesDir(), { recursive: true });
    writeJsonAtomic(journalPath(op), journal, { fs, durable: true });

    const moved = [];
    const bringHome = async () => {
      for (const { from, to } of moved.reverse()) await moveBody(fs, to, from);
      fs.unlinkSync(journalPath(op));
    };
    // Could not undo it: the journal stands, and the next start finishes it.
    const LATER = 'This move has not finished. WILSON will finish it the next time it starts.';
    try {
      for (const r of rows) {
        const at = pathsOf(src, dst, journal, r);
        try {
          await moveBody(fs, at.from, at.to);
        } catch (err) {
          err.file = r.name;
          throw err;
        }
        moved.push(at);
      }
    } catch (err) {
      try {
        await bringHome();
      } catch {
        return refuse(res, 500, 'not_finished', LATER);
      }
      return IN_USE.has(err.code)
        ? refuse(res, 409, 'in_use', `"${err.file}" is open in another program, so nothing moved. Close it and try again.`)
        : refuse(res, 500, 'failed', `"${err.file}" could not be moved, so nothing moved.`);
    }
    await afterBodies();
    let written;
    try {
      written = writeRows(journal);
    } catch (err) {
      if (err.destWritten) return refuse(res, 500, 'not_finished', LATER);
      try {
        await bringHome();
      } catch {
        return refuse(res, 500, 'not_finished', LATER);
      }
      return refuse(res, 500, 'failed', 'These files could not be written into that project, so nothing moved.');
    }
    // A row trashed while its body was being copied stays in its trash, and its body goes home with it.
    // One that cannot go yet keeps the journal, so the next start sends it: the rows are written, and the
    // answer is still that they moved.
    let allHome = true;
    for (const it of written.gone) {
      try {
        await homeOne(readRabbitBundle(fromProject), readRabbitBundle(toProject), journal, it.row);
      } catch {
        allHome = false;
      }
    }
    if (allHome) fs.unlinkSync(journalPath(op));
    return res.json({
      moved: rows.length,
      op,
      links_cleared: before.filter((b) => b.is_core_definer || Object.values(b.links).some(Boolean)).length,
      links_not_restored: written.linksNotRestored,
      before,
    });
  }

  app.post('/api/rabbit/files/move-between-projects', (req, res) => inTurn(() => moveBetween(req, res)).catch(() => {
    if (!res.headersSent) refuse(res, 500, 'failed', 'These files could not be moved.');
  }));

  return { recoverMoves };
}

module.exports = { mountFileMoves, moveBody };
