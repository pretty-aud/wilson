// electron/fileTrash.cjs — MO1 (MOTH_DESIGN §1.8): a desktop project's files get a 30-day trash, as
// the cloud's have. A delete used to unlink the body at once and certificate 'purged'.
//
// A delete moves the row into bundle.trashedFiles in one atomic write, then renames the body into
// <base>/.trash/<id>-<safe name>. A crash or a file held open can stop it between any two steps, so a
// restore and a purge ask the disk where the body is, and `moved` says only that it has left its place.
// Every path goes through resolveContainedFilePath before a rename or an unlink.

const { isLegalRow } = require('./fileTags.cjs');

const TRASH_DIR = '.trash';
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
// An entry whose body cannot be seen stays this long: the drive may be away, and the entry is the only
// record of where the body is. After this it goes, and its certificate says nothing was removed.
const UNSEEN_KEEP_MS = 3 * RETENTION_MS;
// storage/index.js MONEY_SEGMENTS, and the desktop's old folders beside a project's slug (fileTrash.test.js
// holds these to the page's rule).
const MONEY = new Set(['INVOICES', 'FINANCE', 'LEGAL']);
const OLD_MONEY_SUFFIXES = ['_RECEIPTS&INVOICES', '_CREWINVOICES', '_TALENTINVOICES'];

const safeName = (name) => String(name || 'file').replace(/[^A-Za-z0-9._-]/g, '_').slice(-120) || 'file';
const isMoney = (segment) => typeof segment === 'string' && MONEY.has(segment.toUpperCase());

// storage/index.js moneyFolderChainLocked: a slug deeper down is a working folder's name, and a root's
// slug is the project's. A chain that cannot be walked to its end fails closed.
function moneyChainLocked(folderId, folders) {
  if (!folderId || !Array.isArray(folders)) return false;
  const byId = new Map(folders.map((f) => [f.id, f]));
  let node = byId.get(folderId);
  for (let depth = 1; node; depth += 1) {
    if (depth === 64) return node.kind !== 'root';
    const parent = byId.get(node.parent_id);
    if (node.kind !== 'root') {
      if (isMoney(String(node.path ?? '').split('/')[0])) return true;
      if (parent?.kind === 'root' && isMoney(node.slug)) return true;
    }
    node = parent;
  }
  return false;
}

// Moth's one exclusion, on a desktop row: the page's mothFileHidden, from what a bundle holds, so the
// routes and the list agree. Generic delete and its own restore still reach these; only Moth's batch
// routes, its trash list and its moves ask.
function isMothExcluded(bundle, row) {
  if (row.is_financial || isLegalRow(row)) return true;
  const segments = String(row.storage_path || '').split(/[\\/]/);
  // The first segment is a desktop path's own, the third a cloud key's: the page asks both.
  if (isMoney(segments[0]) || isMoney(segments[2])) return true;
  const slug = bundle.project?.folder_slug || bundle.project?.slug;
  if (slug) {
    const old = OLD_MONEY_SUFFIXES.map((suffix) => `${slug}${suffix}`.toLowerCase());
    if (segments.some((segment) => old.includes(segment.toLowerCase()))) return true;
  }
  if (moneyChainLocked(row.folder_id, bundle.folders)) return true;
  const expenses = Array.isArray(bundle.expenses) ? bundle.expenses : [];
  return expenses.some((e) => Array.isArray(e.file_ids) && e.file_ids.includes(row.id));
}

const STRAND_SENTENCE = 'Restore this project\'s deleted files from the Trash in M.O.T.H. first, so they are not left behind in the old folder.';

// Would changing where this project's files live leave a body behind? Only one that is there to be left,
// in the folder that is changing, and that a person can see to restore. The rest (Legal, invoices) live
// elsewhere, and a body on a drive that is away cannot be restored first anyway: it comes along when
// the folder that moved is linked again.
function bodiesWouldStrand({ fs, path, resolveFileBaseDir, resolveContainedFilePath }, bundle, projectId, toBase = null) {
  const filesBase = resolveFileBaseDir(bundle, projectId, {});
  if (toBase && path.resolve(filesBase).toLowerCase() === path.resolve(String(toBase)).toLowerCase()) return false;
  const entries = Array.isArray(bundle.trashedFiles) ? bundle.trashedFiles : [];
  return entries.some((e) => {
    if (isMothExcluded(bundle, e.row)) return false;
    const at = resolveContainedFilePath(filesBase, path.join(TRASH_DIR, e.trash_name));
    return Boolean(at && fs.existsSync(at));
  });
}

// Ahead of the project PATCH in main.cjs, whose body tests lift, so the guard is mounted before it: the
// 'Files folder' reset and a new project folder move where a project's files live as a relink does. Only
// a change: the adapters send whole project rows. A files_dir outranks the folder it is in.
function mountFilesDirGuard(app, deps) {
  app.patch('/api/rabbit/projects/:id', (req, res, next) => {
    const body = req.body || {};
    if (!('files_dir' in body) && !('folder_root' in body)) return next();
    const bundle = deps.readRabbitBundle(req.params.id);
    const project = bundle?.project;
    if (!project) return next();
    const changes = (key) => key in body && (body[key] || null) !== (project[key] || null);
    const filesDirAfter = 'files_dir' in body ? body.files_dir : project.files_dir;
    if ((changes('files_dir') || (changes('folder_root') && !filesDirAfter)) && bodiesWouldStrand(deps, bundle, req.params.id)) {
      return res.status(409).json({ code: 'trash_would_strand', error: STRAND_SENTENCE });
    }
    return next();
  });
}

function mountFileTrash(app, deps) {
  const { fs, path, readRabbitBundle, writeRabbitBundle, rabbitNotFound, rabbitRemoveFrom,
    resolveFileBaseDir, resolveContainedFilePath, rabbitLogFileEvent, allFileBases = () => [], now = () => Date.now() } = deps;

  const trashOf = (bundle) => {
    if (!Array.isArray(bundle.trashedFiles)) bundle.trashedFiles = [];
    return bundle.trashedFiles;
  };
  // Moth's batches: a hidden file reads as one that is not there, live or in the trash.
  const hiddenOrAbsent = (bundle, id) => {
    const row = bundle.files.find((f) => f.id === id) ?? trashOf(bundle).find((e) => e.row.id === id)?.row;
    return !row || isMothExcluded(bundle, row);
  };

  // Row first: a crash between the two leaves a row that says where its body still is. A rename that
  // fails (a program has the file open) leaves it the same way, and the delete has still happened.
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
      try {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(from, to);
      } catch {
        return;
      }
      entry.moved = true;
      writeRabbitBundle(projectId, bundle);
    }
  }

  // Where this entry's body is, asked of the disk: the base its row names, then any other a body of this
  // project can sit in, because a row's base can change once its body has left (a legacy invoice).
  function locate(bundle, projectId, entry) {
    const preferred = resolveFileBaseDir(bundle, projectId, entry.row);
    for (const base of [preferred, ...allFileBases(bundle, projectId)]) {
      const at = resolveContainedFilePath(base, path.join(TRASH_DIR, entry.trash_name));
      if (at && fs.existsSync(at)) return { trashAt: at, dest: resolveContainedFilePath(base, entry.row.storage_path) };
    }
    return { trashAt: null, dest: resolveContainedFilePath(preferred, entry.row.storage_path) };
  }
  const named = (bundle, entry) => bundle.files.some((f) => f.id !== entry.row.id && f.storage_path === entry.row.storage_path);

  // Refused before anything moves, so a batch can ask all of it first. A body at its own place with
  // nothing in the trash never left, or a restore stopped before its row was written.
  function restoreRefusal(bundle, projectId, entry) {
    const { trashAt, dest } = locate(bundle, projectId, entry);
    if (!dest) return 'not_contained';
    const there = fs.existsSync(dest);
    if (trashAt) return there ? 'name_taken' : null;
    if (there) return named(bundle, entry) ? 'name_taken' : null;
    return entry.moved ? 'body_not_found' : null;
  }

  function restoreOne(bundle, projectId, entry) {
    const { trashAt, dest } = locate(bundle, projectId, entry);
    if (trashAt) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(trashAt, dest);
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
    // One exclusion, before any row is touched: the same answer as a file that is not there.
    if (ids.some((id) => hiddenOrAbsent(bundle, id))) return rabbitNotFound(res, 'file');
    let done = 0;
    for (const file of live) {
      if (file) { trashOne(bundle, req.params.projectId, file); done += 1; }
    }
    res.json({ done, ops: [] });
  });

  const REFUSALS = {
    name_taken: 'A file with this name is already there. Rename it, then restore this one.',
    not_contained: 'This file\'s place is outside its project, so WILSON will not put it there.',
    body_not_found: 'This file\'s stored copy cannot be found just now. If its drive is away, connect it and try again.',
  };

  // Moth's batch asks the exclusion; a file's own restore is Undo from Files, which deleted it unasked.
  function restoreRoute(req, res, ids, { excluded = true } = {}) {
    const bundle = readRabbitBundle(req.params.projectId);
    if (!bundle) return rabbitNotFound(res);
    const entries = ids.map((id) => trashOf(bundle).find((e) => e.row.id === id));
    const absent = (id) => !bundle.files.some((f) => f.id === id) && !entries.some((e) => e?.row.id === id);
    if (ids.some((id) => (excluded ? hiddenOrAbsent(bundle, id) : absent(id)))) return rabbitNotFound(res, 'file');
    for (const entry of entries) {
      const refused = entry && restoreRefusal(bundle, req.params.projectId, entry);
      if (refused) return res.status(409).json({ code: refused, error: REFUSALS[refused] });
    }
    let done = 0;
    try {
      for (const entry of entries) {
        if (entry) { restoreOne(bundle, req.params.projectId, entry); done += 1; }
      }
    } catch {
      // What came back stays back, and the rest stay in the trash.
      if (done > 0) writeRabbitBundle(req.params.projectId, bundle);
      return res.status(409).json({ code: 'in_use', error: 'A file could not be put back, because a program has it open. Close it and try again.', done });
    }
    writeRabbitBundle(req.params.projectId, bundle);
    return res.json({ done, ops: [] });
  }
  app.post('/api/rabbit/projects/:projectId/files/restore', (req, res) =>
    restoreRoute(req, res, [...new Set(Array.isArray(req.body?.ids) ? req.body.ids : [])]));
  // A managed file's delete marks its row and moves nothing, so its restore clears the mark. A row whose
  // asset has gone stays gone: there is nothing for it to come back to.
  app.post('/api/rabbit/projects/:projectId/managed-files/:id/restore', (req, res) => {
    const bundle = readRabbitBundle(req.params.projectId);
    if (!bundle) return rabbitNotFound(res);
    const row = (bundle.managedFiles || []).find((f) => f.id === req.params.id);
    if (!row) return rabbitNotFound(res, 'file');
    const asset = (bundle.assets || []).find((a) => a.id === row.asset_id);
    if (row.asset_id && (!asset || asset.deleted_at)) return rabbitNotFound(res, 'file');
    if (!row.deleted_at) return res.json({ done: 0, ops: [] });
    delete row.deleted_at;
    writeRabbitBundle(req.params.projectId, bundle);
    return res.json({ done: 1, ops: [] });
  });

  // Ahead of the route it guards, which stays in main.cjs: a relink rewrites where this project's files
  // are, and the bodies in its trash would stay behind where a restore could not find them.
  app.post('/api/rabbit/projects/:projectId/files/relink-apply', (req, res, next) => {
    const bundle = readRabbitBundle(req.params.projectId);
    if (bundle && bodiesWouldStrand(deps, bundle, req.params.projectId, req.body?.baseDir)) {
      return res.status(409).json({ code: 'trash_would_strand', error: STRAND_SENTENCE });
    }
    return next();
  });

  app.post('/api/rabbit/projects/:projectId/files/:id/restore', (req, res) => restoreRoute(req, res, [req.params.id], { excluded: false }));

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

  // Nothing is written unless something went: this runs each time a project opens, and a read must not
  // move the project up the list or rewrite its mirrors (S33).
  app.post('/api/rabbit/projects/:projectId/trash/purge-expired', (req, res) => {
    const bundle = readRabbitBundle(req.params.projectId);
    if (!bundle) return rabbitNotFound(res);
    const clock = now();
    let purged = 0;
    bundle.trashedFiles = trashOf(bundle).filter((entry) => {
      const age = clock - Date.parse(entry.trashed_at);
      if (age <= RETENTION_MS) return true;
      const { trashAt, dest } = locate(bundle, req.params.projectId, entry);
      // Its body, wherever it is: the trash, or its own place if it never left, unless a live row has
      // that name now. blob_removed keeps the certificate honest: it must not assert a disposal that never happened.
      const at = trashAt || (!entry.moved && dest && !named(bundle, entry) ? dest : null);
      if (!at || !fs.existsSync(at)) {
        if (entry.moved && age <= UNSEEN_KEEP_MS) return true;
      }
      let blobRemoved = false;
      if (at && fs.existsSync(at)) {
        try {
          fs.unlinkSync(at);
        } catch {
          return true; // Held open: next time.
        }
        blobRemoved = true;
      }
      rabbitLogFileEvent(bundle, {
        file_id: entry.row.id, project_id: req.params.projectId, file_name: entry.row.name, storage_provider: entry.row.storage_provider,
        event: 'purged', old_path: entry.row.storage_path, size_bytes: entry.row.size_bytes ?? null, blob_removed: blobRemoved,
      });
      purged += 1;
      return false;
    });
    if (purged > 0) writeRabbitBundle(req.params.projectId, bundle, { touch: false });
    res.json({ purged });
  });
}

module.exports = { mountFileTrash, mountFilesDirGuard, isMothExcluded, TRASH_DIR, RETENTION_MS };
