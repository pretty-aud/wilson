// electron/fileTrash.cjs — MO1 (MOTH_DESIGN §1.8): a desktop project's files get a 30-day trash, as
// the cloud's have. A delete used to unlink the body at once and certificate 'purged'.
//
// A delete moves the row into bundle.trashedFiles in one atomic write, then renames the body into
// <base>/.trash/<id>-<safe name>. If the rename fails the row still says where the body is: `at` on
// the entry says it never moved, so a restore finds it and the purge removes it. Every path goes
// through resolveContainedFilePath before a rename or an unlink.

const TRASH_DIR = '.trash';
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MONEY = new Set(['invoices', 'receipts', 'legal', 'budgets', 'budget', 'contracts']);

const safeName = (name) => String(name || 'file').replace(/[^A-Za-z0-9._-]/g, '_').slice(-120) || 'file';

// Moth's one exclusion, on a desktop row: what the cloud's moth_file_row_locked says, from what a
// bundle holds. Generic delete still reaches these; only Moth's batch route asks.
function isMothExcluded(bundle, row) {
  if (row.is_financial) return true;
  if (Array.isArray(row.tags) && row.tags.includes('legal')) return true;
  const firstOf = (p) => String(p || '').split('/')[0].toLowerCase();
  if (MONEY.has(firstOf(row.storage_path))) return true;
  const folders = Array.isArray(bundle.folders) ? bundle.folders : [];
  let at = row.folder_id ? folders.find((f) => f.id === row.folder_id) : null;
  for (let hops = 0; at && hops < 64; hops += 1) {
    if (MONEY.has(firstOf(at.path)) || MONEY.has(String(at.slug || '').toLowerCase())) return true;
    at = at.parent_id ? folders.find((f) => f.id === at.parent_id) : null;
  }
  const expenses = Array.isArray(bundle.expenses) ? bundle.expenses : [];
  return expenses.some((e) => Array.isArray(e.file_ids) && e.file_ids.includes(row.id));
}

function mountFileTrash(app, deps) {
  const { fs, path, readRabbitBundle, writeRabbitBundle, rabbitNotFound, rabbitRemoveFrom,
    resolveFileBaseDir, resolveContainedFilePath, rabbitLogFileEvent, now = () => Date.now() } = deps;

  const trashOf = (bundle) => {
    if (!Array.isArray(bundle.trashedFiles)) bundle.trashedFiles = [];
    return bundle.trashedFiles;
  };

  // Row first: a crash between the two leaves a row that says where its body still is.
  function trashOne(bundle, projectId, file) {
    const base = resolveFileBaseDir(bundle, projectId, file);
    const from = resolveContainedFilePath(base, file.storage_path);
    const trashName = `${file.id}-${safeName(file.name)}`;
    const to = resolveContainedFilePath(base, path.join(TRASH_DIR, trashName));
    rabbitRemoveFrom(bundle.files, file.id);
    const entry = { row: file, trashed_at: new Date(now()).toISOString(), trash_name: trashName, moved: false };
    trashOf(bundle).push(entry);
    rabbitLogFileEvent(bundle, {
      file_id: file.id, project_id: projectId, file_name: file.name, storage_provider: file.storage_provider,
      event: 'trashed', old_path: file.storage_path, size_bytes: file.size_bytes ?? null,
    });
    writeRabbitBundle(projectId, bundle);
    if (from && to && fs.existsSync(from)) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(from, to);
      entry.moved = true;
      writeRabbitBundle(projectId, bundle);
    }
  }

  // Refused before anything moves, so a batch can ask all of it first.
  function restoreRefusal(bundle, projectId, entry) {
    const dest = resolveContainedFilePath(resolveFileBaseDir(bundle, projectId, entry.row), entry.row.storage_path);
    if (!dest) return 'not_contained';
    if (entry.moved && fs.existsSync(dest)) return 'name_taken';
    return null;
  }

  function restoreOne(bundle, projectId, entry) {
    const base = resolveFileBaseDir(bundle, projectId, entry.row);
    const dest = resolveContainedFilePath(base, entry.row.storage_path);
    const from = resolveContainedFilePath(base, path.join(TRASH_DIR, entry.trash_name));
    if (entry.moved && from && fs.existsSync(from)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(from, dest);
    }
    bundle.trashedFiles = trashOf(bundle).filter((e) => e !== entry);
    bundle.files.push(entry.row);
    rabbitLogFileEvent(bundle, {
      file_id: entry.row.id, project_id: projectId, file_name: entry.row.name, storage_provider: entry.row.storage_provider,
      event: 'restored', new_path: entry.row.storage_path, size_bytes: entry.row.size_bytes ?? null,
    });
  }

  app.delete('/api/rabbit/projects/:projectId/files/:id', (req, res) => {
    const bundle = readRabbitBundle(req.params.projectId);
    if (!bundle) return rabbitNotFound(res);
    const file = bundle.files.find((f) => f.id === req.params.id);
    if (file) trashOne(bundle, req.params.projectId, file);
    res.json({ ok: true });
  });

  app.post('/api/rabbit/projects/:projectId/files/trash', (req, res) => {
    const bundle = readRabbitBundle(req.params.projectId);
    if (!bundle) return rabbitNotFound(res);
    const ids = [...new Set(Array.isArray(req.body?.ids) ? req.body.ids : [])];
    const live = ids.map((id) => bundle.files.find((f) => f.id === id));
    const already = (id) => trashOf(bundle).some((e) => e.row.id === id);
    // One exclusion, before any row is touched: the same answer as a file that is not there.
    if (ids.some((id, i) => (live[i] ? isMothExcluded(bundle, live[i]) : !already(id)))) return rabbitNotFound(res, 'file');
    let done = 0;
    for (const file of live) {
      if (file) { trashOne(bundle, req.params.projectId, file); done += 1; }
    }
    res.json({ done, ops: [] });
  });

  function restoreRoute(req, res, ids) {
    const bundle = readRabbitBundle(req.params.projectId);
    if (!bundle) return rabbitNotFound(res);
    const entries = ids.map((id) => trashOf(bundle).find((e) => e.row.id === id));
    const live = (id) => bundle.files.some((f) => f.id === id);
    if (ids.some((id, i) => (entries[i] ? isMothExcluded(bundle, entries[i].row) : !live(id)))) return rabbitNotFound(res, 'file');
    for (const entry of entries) {
      const refused = entry && restoreRefusal(bundle, req.params.projectId, entry);
      if (refused) return res.status(409).json({ error: refused });
    }
    let done = 0;
    for (const entry of entries) {
      if (entry) { restoreOne(bundle, req.params.projectId, entry); done += 1; }
    }
    writeRabbitBundle(req.params.projectId, bundle);
    return res.json({ done, ops: [] });
  }
  app.post('/api/rabbit/projects/:projectId/files/restore', (req, res) =>
    restoreRoute(req, res, [...new Set(Array.isArray(req.body?.ids) ? req.body.ids : [])]));
  app.post('/api/rabbit/projects/:projectId/files/:id/restore', (req, res) => restoreRoute(req, res, [req.params.id]));

  // Metadata only: no path goes out.
  app.get('/api/rabbit/projects/:projectId/trash', (req, res) => {
    const bundle = readRabbitBundle(req.params.projectId);
    if (!bundle) return rabbitNotFound(res);
    res.json(trashOf(bundle)
      .filter((e) => !isMothExcluded(bundle, e.row))
      .map((e) => ({
        id: e.row.id, project_id: req.params.projectId, folder_id: e.row.folder_id ?? null, name: e.row.name,
        mime_type: e.row.mime_type ?? null, size_bytes: e.row.size_bytes ?? null, kind: e.row.kind ?? null,
        deleted_at: e.trashed_at, purges_at: new Date(Date.parse(e.trashed_at) + RETENTION_MS).toISOString(),
        can_restore: true, needs_desktop: false,
      }))
      .sort((a, b) => (a.deleted_at < b.deleted_at ? 1 : -1)));
  });

  app.post('/api/rabbit/projects/:projectId/trash/purge-expired', (req, res) => {
    const bundle = readRabbitBundle(req.params.projectId);
    if (!bundle) return rabbitNotFound(res);
    const cutoff = now() - RETENTION_MS;
    let purged = 0;
    bundle.trashedFiles = trashOf(bundle).filter((entry) => {
      if (Date.parse(entry.trashed_at) >= cutoff) return true;
      const base = resolveFileBaseDir(bundle, req.params.projectId, entry.row);
      const at = resolveContainedFilePath(base, entry.moved ? path.join(TRASH_DIR, entry.trash_name) : entry.row.storage_path);
      // blob_removed keeps the certificate honest: it must not assert a disposal that never happened.
      let blobRemoved = false;
      if (at && fs.existsSync(at)) {
        fs.unlinkSync(at);
        blobRemoved = true;
      }
      rabbitLogFileEvent(bundle, {
        file_id: entry.row.id, project_id: req.params.projectId, file_name: entry.row.name, storage_provider: entry.row.storage_provider,
        event: 'purged', old_path: entry.row.storage_path, size_bytes: entry.row.size_bytes ?? null, blob_removed: blobRemoved,
      });
      purged += 1;
      return false;
    });
    writeRabbitBundle(req.params.projectId, bundle);
    res.json({ purged });
  });
}

module.exports = { mountFileTrash, isMothExcluded, TRASH_DIR, RETENTION_MS };
