// =============================================================================
// projectFilePatch.cjs — the Local Server's two file PATCH routes, lifted out
// of main.cjs (post-overhaul S4b) so they can be served for real in tests,
// on the rabbitBins.routes.test.js pattern: a real express app, a fake bundle
// store with disk semantics.
//
//   PATCH /api/rabbit/projects/:projectId/files/:id
//   PATCH /api/rabbit/projects/:projectId/managed-files/:id
//
// Moved WORD FOR WORD from main.cjs (S14's and S17's path-field strips, S4a's
// tag check before the merge), with S4b's Legal rules added (fileTags.cjs):
//   * a files row's legal tag is never added or removed after upload, and a
//     Legal file never becomes core — the cloud's files_legal_folder_chk and
//     files_legal_not_core_chk (0088), answered 400 with a code;
//   * a managed file (an asset's, a shot's, a scene's) is never Legal.
// Every check runs BEFORE the body is merged, so a refusal writes nothing.
// =============================================================================
'use strict';

const FILES_PATCH = '/api/rabbit/projects/:projectId/files/:id';
const MANAGED_PATCH = '/api/rabbit/projects/:projectId/managed-files/:id';

function mountProjectFilePatch(expressApp, {
  readRabbitBundle,
  writeRabbitBundle,
  rabbitNotFound,
  checkFileTags,
  checkLegalPatch,
  checkManagedLegal,
} = {}) {
  for (const [name, fn] of Object.entries({
    readRabbitBundle, writeRabbitBundle, rabbitNotFound, checkFileTags, checkLegalPatch, checkManagedLegal,
  })) {
    if (typeof fn !== 'function') throw new Error(`mountProjectFilePatch: ${name} is required`);
  }

  expressApp.patch(FILES_PATCH, (req, res) => {
    const bundle = readRabbitBundle(req.params.projectId);
    if (!bundle) return rabbitNotFound(res);
    const idx = bundle.files.findIndex(f => f.id === req.params.id);
    if (idx < 0) return rabbitNotFound(res, 'file');
    // Session 14: path fields are NOT patchable here — a crafted
    // storage_path turned download/delete into arbitrary-path fs calls.
    // Path changes go through relink-apply, which containment-checks.
    const { storage_path: _sp, storage_provider: _spr, id: _id, ...patch } = req.body || {};
    // S4a (0085): the nine tags, refused as the cloud's CHECK refuses them.
    const tagCheck = checkFileTags(patch);
    if (!tagCheck.ok) return res.status(400).json({ error: tagCheck.error, code: 'bad_tags' });
    // S4b (0088): Legal is chosen when the file is added — never added,
    // removed or made core after (the cloud's two Legal CHECKs).
    const legalCheck = checkLegalPatch(bundle.files[idx], patch);
    if (!legalCheck.ok) return res.status(400).json({ error: legalCheck.error, code: legalCheck.code });
    bundle.files[idx] = { ...bundle.files[idx], ...patch, id: req.params.id };
    writeRabbitBundle(req.params.projectId, bundle);
    res.json(bundle.files[idx]);
  });

  expressApp.patch(MANAGED_PATCH, (req, res) => {
    const bundle = readRabbitBundle(req.params.projectId);
    if (!bundle) return rabbitNotFound(res);
    if (!bundle.managedFiles) bundle.managedFiles = [];
    const idx = bundle.managedFiles.findIndex(f => f.id === req.params.id);
    if (idx < 0) return rabbitNotFound(res, 'managed-file');
    // Session 17: path fields are NOT patchable here — the same class the
    // sibling files PATCH was hardened against in S14. A crafted
    // folder_path/stored_name turned the hard-delete and thumbnail routes
    // into arbitrary-path fs calls. Path changes are server-derived on
    // POST, or come from the asset-rename route which rewrites them itself.
    const { folder_path: _fp, stored_name: _sn, storage_provider: _spr, id: _id, ...patch } = req.body || {};
    // S4a (E11): a managed file carries notes and tags too, the tags held
    // to the same nine as a files row (0085's CHECK, fileTags.cjs).
    const tagCheck = checkFileTags(patch);
    if (!tagCheck.ok) return res.status(400).json({ error: tagCheck.error, code: 'bad_tags' });
    // S4b (0088): never Legal.
    const legalCheck = checkManagedLegal(patch);
    if (!legalCheck.ok) return res.status(400).json({ error: legalCheck.error, code: legalCheck.code });
    bundle.managedFiles[idx] = {
      ...bundle.managedFiles[idx],
      ...patch,
      id: req.params.id,
      updated_at: new Date().toISOString(),
    };
    writeRabbitBundle(req.params.projectId, bundle);
    res.json(bundle.managedFiles[idx]);
  });
}

module.exports = { mountProjectFilePatch, FILES_PATCH, MANAGED_PATCH };
