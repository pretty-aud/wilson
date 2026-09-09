// =============================================================================
// deckAttachments — what makes a stored file row one of a project's DECK
// attachments (Track C, bundle C3; MASTER_PLAN §6 #31).
//
// 🚨 ONE MODULE BECAUSE IT IS ONE CONTRACT, WITH A READER AND THREE WRITERS.
// D.O.G. picks its source material out of `public.files` / `bundle.files` with
// isDeckAttachmentRow; the Resources drop zone, D.O.G.'s new-project modal and
// the legacy-array migration all WRITE rows that have to satisfy it. Split
// across four files, the reader and the writers drift, and the drift is silent
// in the worst way: the file uploads, the row is there, the grid shows it, and
// generation never sees it. That is §6 #31 trap (c) — "upload successfully and
// contribute NOTHING to generation (worse than today's loud throw)".
//
// The drift is not hypothetical. Both halves of it were MEASURED rather than
// reasoned about, and both were wrong on the first attempt:
//
//   * `detectDocumentKind` returns null for a PDF whose name matches none of
//     its heuristics ("legacy.pdf", "Nightjar_v3.pdf"), the writer recorded
//     NULL, and the reader dropped it. A legacy project's brief disappeared
//     from its own deck the moment it was migrated. `documentKindFor` closes
//     it and `attachmentRowIsVisible` is the invariant the tests hold both
//     sides to.
//   * The media arm admitted EVERY image and video the project had ever held
//     (review round 1). See the note on isDeckAttachmentRow.
// =============================================================================

/**
 * The columns that say a file is filed against a PRODUCTION entity rather than
 * against the project itself.
 *
 * `supabaseAdapter.uploadFile` writes ALL SEVEN unconditionally from its
 * `scope`, so on the cloud "all null" is a fact about the row.
 *
 * ⚠️ NOT SO ON LOCAL SERVER (review round 2 — round 1's comment here said
 * "writes the first three", which was both the wrong three and the wrong
 * conclusion). `electron/main.cjs`'s upload route writes `phase_id`,
 * `asset_id` and `task_id` and DROPS `scene_id`, `shot_id`, `level_id` and
 * `experience_id` even when the caller sends them — so on that backend a
 * missing key can mean "filed at project level" OR "the route discarded it",
 * and this function cannot tell them apart.
 *
 * The exposure is narrow rather than zero: Local Server's entity FileManagers
 * write the MANAGED store (`bundle.managedFiles`), which `listFiles` never
 * returns, so a scene-scoped image does not normally reach this test at all.
 * It reaches it when the renderer is served from the loopback server WITHOUT
 * the preload bridge, because `FileManager` picks its store from
 * `ctx.supportsManagedFiles`. Stated rather than closed: closing it means
 * teaching the Express route the other four columns, which is a change to a
 * shared write path C3 has no other reason to touch.
 */
const ENTITY_KEYS = [
  'scene_id', 'shot_id', 'asset_id', 'task_id',
  'phase_id', 'level_id', 'experience_id',
];

/** True when the row was filed against the PROJECT and nothing narrower. */
function isProjectLevelRow(row) {
  return ENTITY_KEYS.every(k => !row[k]);
}

/**
 * Is this stored row one of the project's DECK attachments?
 *
 * Two kinds qualify, matching what the two legacy arrays held:
 *
 *   * a classified DOCUMENT — `document_kind` is non-null (migration 0075).
 *     All three attachment writers always set it (see documentKindFor);
 *     RABBIT's own uploads leave it NULL. That column is the whole separation
 *     for documents, and it is a positive marker: nothing becomes deck source
 *     material by accident.
 *
 *   * a VISUAL ASSET — an image or video — **filed against the project
 *     itself**, which is what `visualAssets[]` was.
 *
 * 🚨 THE SECOND ARM'S ENTITY CHECK IS THE WHOLE OF IT, AND IT WAS MISSING.
 * Review round 1: without it, the arm read "every image or video this project
 * has ever held" — every plate, render, frame grab and reference JPEG uploaded
 * from RABBIT's Files view. On a project a month into production the twenty
 * NEWEST files are renders, so the brief was pushed out of D.O.G.'s budget
 * entirely and 32 MiB of production media went into the generation prompt in
 * its place. Media has no `document_kind` to mark it with (0075 keeps the
 * column nullable precisely so a frame of footage does not claim to be a
 * document), so the marker has to be where it was FILED: an entity
 * FileManager stamps `scene_id` / `shot_id` / `asset_id` / `task_id`, and the
 * Resources drop zone stamps none of them.
 *
 * ⚠️ THE STATED RESIDUE, and review round 2 corrected WHERE it is. Round 1
 * named "FileManager mounted at project level"; there is no such mount — every
 * `<FileManager>` in the tree passes an entity (TaskDetailPopup,
 * ProjectAssetsView, ScenesView). The surface that really writes project-level
 * media is `ProjectSummaryView`'s ProjectFilesSection, whose Add Files calls
 * `ctx.uploadFile(file, { type: 'project' })` — no entity keys — and
 * such a file is indistinguishable from a Resources drop and WILL be included.
 *
 * ⚠️ C4 CLOSED THE OTHER HALF OF THIS RESIDUE, and this comment asserted the
 * opposite until review round 1 caught it. `BudgetView`'s expense receipts
 * used to pass `{ type: 'expense' }` — a scope `uploadFile` does not read — so
 * they landed as ordinary project-level files and were included here. They now
 * pass `{ financial: true }`, which makes them money, and the `is_financial`
 * arm of `isDeckAttachmentRow` below excludes them. A receipt can no longer
 * reach a deck on the cloud backend. ⚠️ Local Server is NOT covered: migration
 * 0076 is Postgres-only, so a desktop receipt uploaded before C4 keeps
 * `is_financial: false` in its JSON bundle and still qualifies here.
 * Handbook §12.9.
 *
 * Bounded rather than closed: documents are always taken first (see
 * orderAttachmentCandidates), so nothing can crowd out the brief, and D.O.G.'s
 * File roles list names every file it is using — an unexpected one is visible
 * rather than silent. Closing it properly needs a column that says "filed as
 * deck source material", which is a migration this bundle did not take.
 * Handbook §12.8.
 *
 * Money files never qualify, whatever else they are: an invoice is not deck
 * source material, RLS already hides it from anyone without money access, and
 * the Resources list filters it out a layer up for the same reason. Nor does a
 * trashed row — cloud deletes are soft (0014), so the row and its blob both
 * survive, and without this check a deleted brief would still shape the deck.
 */
export function isDeckAttachmentRow(row) {
  if (!row || row.deleted_at || row.is_financial) return false;
  if (row.document_kind) return true;
  // 🚨 THE SAME TEST THE WRITER USES, name included. Round 2's fix made
  // `documentKindFor` return NULL for `plate.mov` with an empty mime type
  // (correctly — it is a video, not a document); if this arm still asked only
  // the mime type, that row would satisfy neither arm and the clip would
  // vanish from generation. The reader and the writer answer "is this media?"
  // with ONE function or the contract has a hole between them, which is the
  // whole reason this module exists.
  return looksLikeMedia(row.mime_type, row.name) && isProjectLevelRow(row);
}

/** True for the rows that are DOCUMENTS rather than visual assets. */
export function isDeckDocumentRow(row) {
  return !!row?.document_kind;
}

/**
 * The document kind to record when WRITING a deck attachment.
 *
 * 🚨 TOTAL BY CONSTRUCTION — every row this returns a value for satisfies
 * isDeckAttachmentRow above, PROVIDED the writer files it at project level,
 * which all three attachment writers do:
 *
 *   * image or video  -> NULL. Recognised by its mime type and its filing
 *     instead, and an image is not a document; 0075 makes the column nullable
 *     for exactly this, so a frame of footage does not claim to be a brief.
 *   * anything else   -> the detected kind, or 'other'.
 *
 * 'other' is not a guess. It is one of the ten values 0000's enum declares and
 * it states precisely what is true at this point: this IS a document, and
 * nobody has said which kind. NULL would be the claim "this is not a
 * document" — false, and it removes the file from generation in silence.
 *
 * @param {string} mimeType  the file's mime type, '' when the OS had none.
 * @param {string} name      the file name, for the heuristics.
 * @param {(n: string) => string|null} [detectKind] usually detectDocumentKind.
 */
export function documentKindFor(mimeType, name, detectKind) {
  if (looksLikeMedia(mimeType, name)) return null;
  return detectKind?.(name) || 'other';
}

/**
 * Is this media, by mime type OR by name?
 *
 * 🚨 THE NAME IS CONSULTED, AND ROUND 2 IS WHY. `documentKindFor` used to
 * branch on the mime type alone — but `File.type` is the EMPTY STRING for
 * .mov/.mkv/.avi on any machine whose OS MIME registry lacks them (S40's
 * lesson, which `dogTypeForRow` four lines below already states). So
 * `documentKindFor('', 'plate.mov', …)` returned `'other'` and the row was
 * written CLAIMING TO BE A DOCUMENT.
 *
 * Before round 1 that was a mislabel with no consequence. After it, it was a
 * defect: `isDeckDocumentRow` said yes, `orderAttachmentCandidates` sorted the
 * clip into the DOCUMENTS group ahead of every image, and one 30 MiB ProRes
 * .mov could consume the whole byte budget — the precise outcome the ordering
 * was added to make impossible. A fix that creates the hole it closes.
 */
export function looksLikeMedia(mimeType, name) {
  const m = mimeType || '';
  if (m.startsWith('image/') || m.startsWith('video/')) return true;
  return /\.(mp4|mov|webm|avi|mkv|m4v|mpg|mpeg|wmv|png|jpe?g|gif|webp|bmp|tiff?|heic|avif)$/i
    .test(name || '');
}

/**
 * The invariant, as a function, so a test can assert it rather than restate it:
 * a row written by one of the three attachment writers — project-level, with
 * documentKindFor's answer — is always visible to isDeckAttachmentRow.
 */
export function attachmentRowIsVisible(mimeType, name, detectKind) {
  return isDeckAttachmentRow({
    mime_type: mimeType || '',
    // The NAME travels too — without it this invariant could not see round 2's
    // extension-only-video hole, which is the one it exists to catch.
    name: name || '',
    document_kind: documentKindFor(mimeType, name, detectKind),
  });
}

/**
 * 🚨 THE DEFAULT CORE FLAG FOR A NEWLY WRITTEN ATTACHMENT — §6 #31 trap (b),
 * and review round 1 found this bundle had it BACKWARDS.
 *
 * D.O.G. reads a legacy array entry as CORE unless it says otherwise
 * (`doc.isCore !== false`), and the legacy writer on the Resources page never
 * set `isCore` at all — so every file dropped there was CORE. The first
 * version of this bundle rerouted that writer through `uploadFile` with
 * `isCoreDefiner: false`, which turned the identical gesture into REFERENCE:
 * from "a primary source of truth for what this project IS" to "supporting
 * reference material only", silently, with nothing failing. That is the
 * consequence §6 #31's disposition row names, arriving through the WRITE path
 * while both measured diffs — which only ever covered the READ path and the
 * migration — stayed at zero.
 *
 * So a new attachment is CORE, which is also what `runAttachmentMigration`
 * carries across (`entry.isCore !== false`); the two agree, and a brief
 * dropped today means the same thing as one dropped last month.
 *
 * ⚠️ THE COLUMN IS SHARED WITH RABBIT, AND THAT IS ALL. `files.is_core_definer`
 * is also what RABBIT's Files views show as a Core tick. It does NOT reach the
 * intake pipeline: round 1 added a paragraph here saying a Resources drop
 * became an intake candidate, and review round 2 traced it and found it false
 * in both directions. `IntakeWizardView` holds its files in local state,
 * populated only by `IntakePrepare` from a picker, as staging objects carrying
 * a `dataUrl`; `runIngestion` needs that `dataUrl` to extract text. A `files`
 * row has none and no code path puts one in that list. Nothing about intake
 * changes because of this constant — which is the honest claim, and the one
 * round 1 should have made instead of a measured-sounding one it had not
 * traced.
 */
export const NEW_ATTACHMENT_IS_CORE = true;

/**
 * Which D.O.G. source-block type a stored row becomes.
 *
 * 🚨 THE NAME IS CONSULTED, NOT ONLY THE MIME TYPE. S40's lesson: File.type is
 * the EMPTY STRING for .mov/.mkv/.avi on any machine whose OS MIME registry
 * lacks them, so a type-only gate sent an H.264 .mov somewhere that could not
 * read it. A row whose mime_type was never captured is in the same position.
 * Anything unrecognised reads as text, which is the only type that degrades
 * safely — worst case some mojibake in the prompt, rather than a content block
 * the API rejects.
 */
export function dogTypeForRow(row) {
  const mime = row?.mime_type || '';
  const name = row?.name || '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/') || /\.(mp4|mov|webm|avi|mkv)$/i.test(name)) return 'video';
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  return 'text';
}

/**
 * Order the candidates the way D.O.G. should spend its budget: every DOCUMENT
 * first, newest-first, then media, newest-first.
 *
 * 🚨 DOCUMENTS CANNOT BE CROWDED OUT. A single ordering by date spends the
 * budget on whatever happens to be newest, which on a working project is
 * media — so the brief the deck is supposed to be about falls off the end and
 * is reported only as "N more files are not included". Sorting by kind first
 * makes the bound cost visual reference material, never source material.
 */
export function orderAttachmentCandidates(rows) {
  const at = (r) => new Date(r.uploaded_at || r.created_at || 0).getTime();
  return [...rows].sort((a, b) => {
    const ad = isDeckDocumentRow(a) ? 0 : 1;
    const bd = isDeckDocumentRow(b) ? 0 : 1;
    if (ad !== bd) return ad - bd;
    return at(b) - at(a);
  });
}

// ── The bound on what D.O.G. downloads ───────────────────────────────────────
//
// The legacy arrays were whatever a person had dropped on one project.
// `public.files` is every file RABBIT has ever stored for that project, and a
// project that has been in production for a month can hold gigabytes.
// Selecting a project must not start a gigabyte download, so the candidates are
// ordered by orderAttachmentCandidates and cut off at BOTH a count and a total
// size. The numbers are stated here, in D.O.G.'s panel and in the handbook.
//
//   * MAX_FILES = 20 — the same ceiling the picker beside it already
//     advertises ("max 20 files"), so the two halves of one screen agree.
//   * MAX_BYTES = 32 MiB across the whole set. A brief, a treatment and a
//     dozen references fit; a camera original does not.
//
// A file over the remaining budget is SKIPPED, never truncated, and the count
// left out is shown. Truncating a document hands the model half a brief with
// no way to know it is half.
export const DOG_ATTACHMENT_MAX_FILES = 20;
export const DOG_ATTACHMENT_MAX_BYTES = 32 * 1024 * 1024;

/**
 * The same number, said once, for the panel copy — and named MiB, because that
 * is what it is. Round 1 fixed exactly this unit slip in the migration panel
 * and introduced it here in the same commit, under a constant literally called
 * `_MAX_MB`. 32 MiB is 33.55 MB; a person who reads "32 MB" and prepares a
 * 33 MB set is told their files did not fit for a reason the copy denies.
 */
export const DOG_ATTACHMENT_MAX_MIB = DOG_ATTACHMENT_MAX_BYTES / (1024 * 1024);
