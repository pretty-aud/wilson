// =============================================================================
// legalFiling.cjs — where the Local Server keeps a Legal file, and the rules
// that keep it there (post-overhaul S4b; review round 1, R1-BEH-03/04/05/10).
//
// Audrey, 2026-10-01: "its just the folder that is locked". The Local Server
// has no roles, so the LEGAL folder IS the lock — the one the drive or NAS
// can restrict with its own permissions. So a Legal body must always land in
// a folder called LEGAL, and nothing may move it out:
//
//   * legalDir — <project folder>/LEGAL beside INVOICES; and when the project
//     has NO folder (no demo, workspace or default root, or the NAS is
//     offline), <internal project dir>/LEGAL. Never the ordinary files
//     directory: invoices fall back there, but a Legal body among the
//     project's ordinary files is exactly what the folder exists to prevent.
//   * baseDirFor — where a Legal row's body is read from: the project's
//     LEGAL, then the internal LEGAL (a file added before a folder was set),
//     then wherever the body actually is (the files directory — never the
//     answer for a body added since S4b, kept so nothing becomes unreadable).
//   * settleLegalLabels — S4a's label period (on the desktop anyone could
//     tick Legal, and the PATCH accepted it): a `legal` tag on a managed file,
//     on an invoice, or on a project file whose body is in the ordinary files
//     directory is a LABEL, not a Legal file — otherwise it sits in the LEGAL
//     node with its body outside the folder the UI tells you to lock, and its
//     tags can never be edited again (the PATCH refuses changing a Legal tag).
//     ONCE per project, as 0088 §2 strips the cloud's once and counts them:
//     the caller records that the project is settled, with the ids it
//     stripped, and never asks again (review round 2, R2-BEH-01: run on every
//     read, it stripped a REAL Legal file whose body was moved by hand or
//     whose NAS was offline beside a relinked copy — and the tag could never
//     come back). Since S4b nothing can make a new label: the PATCH refuses
//     adding `legal`, and every Legal upload writes its body into LEGAL. Not
//     settled while the project's own folder is unreachable (a NAS offline):
//     the LEGAL folder it would look in is not there to look in.
//   * relinkable — the relink flow moves the project's ORDINARY files home;
//     invoices (Session 24) and Legal files never take part, in the scan or
//     in the apply (a crafted mapping must not re-point a Legal body).
//
// Every host helper is injected (they are closures inside main.cjs's
// startLocalServer); legalFiling.test.js runs it against a temp directory.
// =============================================================================
'use strict';

const { LEGAL_DIR, LEGAL_TAG, isLegalRow } = require('./fileTags.cjs');

function createLegalFiling({
  fs,
  path,
  resolveProjectFolder,
  resolveProjectFilesDir,
  getRabbitProjectDir,
  resolveContainedFilePath,
} = {}) {
  for (const [name, v] of Object.entries({
    fs, path, resolveProjectFolder, resolveProjectFilesDir, getRabbitProjectDir, resolveContainedFilePath,
  })) {
    if (!v) throw new Error(`createLegalFiling: ${name} is required`);
  }

  // The LEGAL folders a body may sit in, canonical first. Nothing is created.
  function legalDirs(bundle, projectId) {
    const out = [];
    const root = resolveProjectFolder(bundle);
    if (root) out.push(path.join(root, LEGAL_DIR));
    out.push(path.join(getRabbitProjectDir(projectId), LEGAL_DIR));
    return out;
  }

  /** The LEGAL folder a new Legal body is written to, made if missing. */
  function legalDir(bundle, projectId) {
    const dir = legalDirs(bundle, projectId)[0];
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  const holds = (dir, rel) => {
    const p = resolveContainedFilePath(dir, rel);
    return !!(p && fs.existsSync(p));
  };

  /** The LEGAL folder holding this row's body, or null. */
  function legalHome(bundle, projectId, file) {
    return legalDirs(bundle, projectId).find((d) => holds(d, file?.storage_path)) || null;
  }

  /** Where a Legal row's body resolves: a LEGAL folder, else where it is. */
  function baseDirFor(bundle, projectId, file) {
    const home = legalHome(bundle, projectId, file);
    if (home) return home;
    const filesDir = resolveProjectFilesDir(bundle, projectId);
    if (filesDir && holds(filesDir, file?.storage_path)) return filesDir;
    // Neither has it: the canonical home, so a 410 names where it belongs.
    return legalDirs(bundle, projectId)[0];
  }

  /**
   * Remove S4a-period `legal` LABELS, once (see the header). Returns
   * `{ settled, stripped }`: `stripped` the ids whose label was removed (the
   * caller persists them); `settled` false — so the caller asks again on a
   * later read — while the project's folder is configured but unreachable
   * (nothing touched), or while any labelled row's body is found NOWHERE (a
   * relinked files folder on an unplugged drive, a NAS root offline): that
   * row stays Legal for now (fail closed) and is decided when its body is
   * back (review round 2's re-check, R3-BEH-01 — settled anyway, an
   * ordinary file stayed Legal for good). The folders are resolved once per
   * call, not per row (R2-BEH-03).
   */
  function settleLegalLabels(bundle, projectId) {
    if (bundle?.project?.folder_root && !resolveProjectFolder(bundle)) {
      return { settled: false, stripped: [] };
    }
    const stripped = [];
    const drop = (row) => {
      row.tags = row.tags.filter((t) => t !== LEGAL_TAG);
      stripped.push(row.id);
    };
    for (const m of bundle?.managedFiles || []) {
      if (Array.isArray(m?.tags) && m.tags.includes(LEGAL_TAG)) drop(m);
    }
    const labelled = (bundle?.files || []).filter((f) => isLegalRow(f));
    let undecided = 0;
    if (labelled.length > 0) {
      const dirs = legalDirs(bundle, projectId);
      let filesDir;
      for (const f of labelled) {
        if (f.is_financial) { drop(f); continue; }
        if (dirs.some((d) => holds(d, f.storage_path))) continue;
        if (filesDir === undefined) filesDir = resolveProjectFilesDir(bundle, projectId) || null;
        if (filesDir && holds(filesDir, f.storage_path)) drop(f);
        else undecided += 1;
      }
    }
    return { settled: undecided === 0, stripped };
  }

  /** May the relink flow scan or re-point this row? Never an invoice or a Legal file. */
  function relinkable(file) {
    return !file?.is_financial && !isLegalRow(file);
  }

  return { legalDir, legalDirs, legalHome, baseDirFor, settleLegalLabels, relinkable };
}

module.exports = { createLegalFiling };
