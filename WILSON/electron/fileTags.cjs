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

module.exports = { FILE_TAG_IDS, FILE_TAG_MAX, checkFileTags };
