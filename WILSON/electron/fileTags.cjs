// =============================================================================
// fileTags.cjs — the Local Server's half of files.tags (post-overhaul S4a).
//
// The cloud refuses a tag outside the nine with migration 0085's CHECK
// (files_tags_known_chk, 23514) and more than nine with files_tags_len_chk.
// The desktop's PATCH routes spread the request body into the bundle, so
// without this an invented tag — or 'notes', which Audrey removed (E3) —
// would persist on the desktop and be refused in the cloud: the parity rule
// ("all functionality should be the same in both versions of the app")
// broken the way 0075's header describes. The two routes answer 400 with
// `code: 'bad_tags'` where the cloud answers 23514.
//
// The vocabulary is a COPY of src/tools/rabbit_v0.1.0/fileTags.js's
// FILE_TAG_IDS (main cannot import an ES module); fileTags.test.js holds the
// two and the migration's CHECK to one list.
// =============================================================================

const FILE_TAG_IDS = Object.freeze([
  'production', 'creative', 'legal', 'finance', 'reference',
  'assets', 'code', 'shots', 'documentation',
]);
const KNOWN = new Set(FILE_TAG_IDS);
const FILE_TAG_MAX = FILE_TAG_IDS.length;

/**
 * Check a PATCH body's `tags` exactly as the cloud's two CHECKs do: an array
 * (not null), every element one of the nine as written (case included, no
 * null), at most nine elements. `{ ok: true }` when the body has no `tags`.
 */
function checkFileTags(body) {
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'tags')) return { ok: true };
  const tags = body.tags;
  if (!Array.isArray(tags)) return { ok: false, error: 'tags must be a list' };
  if (tags.length > FILE_TAG_MAX) return { ok: false, error: `a file carries at most ${FILE_TAG_MAX} tags` };
  for (const t of tags) {
    if (typeof t !== 'string' || !KNOWN.has(t)) {
      return { ok: false, error: `unknown tag: ${t === null ? 'null' : String(t).slice(0, 40)}` };
    }
  }
  return { ok: true };
}

// ── Post-overhaul S4b (0088): Legal is chosen when a file is ADDED ──────────
// Audrey, 2026-10-01: "its just the folder that is locked". On the cloud the
// legal tag goes with the LEGAL third path segment (files_legal_folder_chk)
// and a Legal file is never core (files_legal_not_core_chk). The desktop's
// row keeps a bare filename, so here the TAG is the fact: it is written once,
// by the upload that puts the body in the project's LEGAL folder, and these
// checks refuse every later attempt to add it, remove it, or make the file
// core — the cloud's refusals, answered 400 with a code. Copies of the
// client's sentences (src/tools/rabbit_v0.1.0/fileTags.js), pinned there.
const LEGAL_TAG = 'legal';
const LEGAL_DIR = 'LEGAL';
const LEGAL_LOCKED_REASON = 'Added as Legal. To change this, add the file again.';
const LEGAL_AT_ADD_REASON = 'Legal is chosen when a file is added.';
const LEGAL_NOT_CORE_REASON = 'A Legal file is never a core file: core files feed Intake and D.O.G., which the whole project reads.';
const LEGAL_MANAGED_REASON = 'A file of an asset, a shot or a scene is never Legal: add it to the project with Add as Legal.';

/** A desktop row is Legal when it carries the tag (written only at upload). */
function isLegalRow(row) {
  return Array.isArray(row?.tags) && row.tags.includes(LEGAL_TAG);
}

/**
 * A files PATCH against the stored row: the legal tag may not be added or
 * removed, and a Legal file may not become core. `{ ok: true }` otherwise.
 */
function checkLegalPatch(existing, patch) {
  if (!patch || typeof patch !== 'object') return { ok: true };
  const wasLegal = isLegalRow(existing);
  if (Object.prototype.hasOwnProperty.call(patch, 'tags') && Array.isArray(patch.tags)) {
    if (patch.tags.includes(LEGAL_TAG) !== wasLegal) {
      return { ok: false, code: 'legal_fixed', error: wasLegal ? LEGAL_LOCKED_REASON : LEGAL_AT_ADD_REASON };
    }
  }
  if (wasLegal && patch.is_core_definer === true) {
    return { ok: false, code: 'legal_not_core', error: LEGAL_NOT_CORE_REASON };
  }
  return { ok: true };
}

/** A managed file (an asset's, a shot's, a scene's) is never Legal. */
function checkManagedLegal(patch) {
  if (patch && Array.isArray(patch.tags) && patch.tags.includes(LEGAL_TAG)) {
    return { ok: false, code: 'bad_tags', error: LEGAL_MANAGED_REASON };
  }
  return { ok: true };
}

module.exports = {
  FILE_TAG_IDS, FILE_TAG_MAX, checkFileTags,
  LEGAL_TAG, LEGAL_DIR, LEGAL_LOCKED_REASON, LEGAL_AT_ADD_REASON, LEGAL_NOT_CORE_REASON, LEGAL_MANAGED_REASON,
  isLegalRow, checkLegalPatch, checkManagedLegal,
};
