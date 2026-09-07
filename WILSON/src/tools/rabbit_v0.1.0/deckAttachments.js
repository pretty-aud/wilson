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
// The drift is not hypothetical. It was MEASURED, on the first run of this
// bundle's round-trip diff: `detectDocumentKind` returns null for a PDF whose
// name matches none of its heuristics ("legacy.pdf", "Nightjar_v3.pdf"), the
// writer recorded NULL, and the reader — which needs a kind or a media mime
// type — dropped it. A legacy project's brief disappeared from its own deck
// the moment it was migrated. documentKindFor below is what closes it, and
// `attachmentRowIsVisible` is the invariant the tests hold both sides to.
// =============================================================================

/**
 * Is this stored row one of the project's DECK attachments?
 *
 * Two kinds qualify, matching what the two legacy arrays held:
 *   * a classified DOCUMENT — `document_kind` is non-null (migration 0075).
 *     The three attachment writers always set it; RABBIT's own production
 *     uploads leave it NULL, and that is what keeps a project's plates,
 *     renders and versions out of the deck's source material.
 *   * a VISUAL ASSET — an image or video, which is what `visualAssets[]` was.
 *
 * Money files never qualify, whatever else they are: an invoice is not deck
 * source material, RLS already hides it from anyone without money access, and
 * the Resources list filters it out a layer up for the same reason. Nor does a
 * trashed row — cloud deletes are soft (0014), so the row and its blob both
 * survive, and without this check a deleted brief would still shape the deck.
 */
export function isDeckAttachmentRow(row) {
  if (!row || row.deleted_at || row.is_financial) return false;
  const mime = row.mime_type || '';
  return !!row.document_kind || mime.startsWith('image/') || mime.startsWith('video/');
}

/**
 * The document kind to record when WRITING a deck attachment.
 *
 * 🚨 TOTAL BY CONSTRUCTION — every row this returns a value for satisfies
 * isDeckAttachmentRow above:
 *
 *   * image or video  -> NULL. Recognised by its mime type instead, and an
 *     image is not a document; 0075 makes the column nullable for exactly
 *     this, so a frame of footage does not claim to be a brief.
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
  const m = mimeType || '';
  if (m.startsWith('image/') || m.startsWith('video/')) return null;
  return detectKind?.(name) || 'other';
}

/**
 * The invariant, as a function, so a test can assert it rather than restate it:
 * a row written with documentKindFor is always visible to isDeckAttachmentRow.
 */
export function attachmentRowIsVisible(mimeType, name, detectKind) {
  return isDeckAttachmentRow({
    mime_type: mimeType || '',
    document_kind: documentKindFor(mimeType, name, detectKind),
  });
}

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

// ── The bound on what D.O.G. downloads ───────────────────────────────────────
//
// The legacy arrays were whatever a person had dropped on one project.
// `public.files` is every file RABBIT has ever stored for that project, and a
// project that has been in production for a month can hold gigabytes.
// Selecting a project must not start a gigabyte download, so the candidates are
// taken newest-first and cut off at BOTH a count and a total size. The numbers
// are stated here, in D.O.G.'s panel and in the handbook.
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
