// =============================================================================
// fileTags.js — a project file's tags (post-overhaul S4a, migration 0085).
//
// Audrey's rulings (docs/design/POST_OVERHAUL_PLAN.md §0.1, 2026-09-29):
//   E3  NINE tags, several per file, beside Kind, monochrome — Production,
//       Creative, Legal, Finance, Reference, Assets, Code, Shots,
//       Documentation ("remove the notes tag option").
//   E4  FINANCE is shown read-only, derived from files.is_financial, and
//       never written as a tag.
//   E12 tags start empty on every existing row; the old files.kind is ignored.
// And since post-overhaul S4b (migration 0088), Audrey 2026-10-01: a LEGAL
// file is seen by "same as money files for now" (workspace admins and the
// project's managers), and Legal is chosen when the file is ADDED — "its
// just the folder that is locked". So Legal, like Finance, is a fact about
// the file and never a toggle: the legal tag goes with the LEGAL folder (the
// cloud's third path segment, files_legal_folder_chk; the Local Server's
// LEGAL directory beside INVOICES), is written once by uploadFile, and is
// neither set nor cleared afterwards by anyone.
//
// ONE vocabulary in three places, held together by fileTags.test.js:
// FILE_TAG_IDS here, `FILE_TAG_IDS` in electron/fileTags.cjs (the Local
// Server's PATCH routes) and the CHECK in 0085_file_tags.sql.
// =============================================================================

/** The nine, in the order every surface lists them. Stored lower case. */
export const FILE_TAGS = Object.freeze([
  Object.freeze({ id: 'production', label: 'Production' }),
  Object.freeze({ id: 'creative', label: 'Creative' }),
  Object.freeze({ id: 'legal', label: 'Legal' }),
  Object.freeze({ id: 'finance', label: 'Finance' }),
  Object.freeze({ id: 'reference', label: 'Reference' }),
  Object.freeze({ id: 'assets', label: 'Assets' }),
  Object.freeze({ id: 'code', label: 'Code' }),
  Object.freeze({ id: 'shots', label: 'Shots' }),
  Object.freeze({ id: 'documentation', label: 'Documentation' }),
])

export const FILE_TAG_IDS = Object.freeze(FILE_TAGS.map((t) => t.id))

/** Finance is the one tag the client never writes (E4): it is is_financial. */
export const DERIVED_TAG = 'finance'

/** Legal: chosen when the file is added, never set or cleared after (0088). */
export const GATED_TAG = 'legal'

/**
 * The locked folder a Legal file is added under: the third segment of its
 * cloud object key (projects/<id>/LEGAL/…, public.rabbit_money_segment) and
 * the LEGAL directory beside INVOICES on the Local Server. Written in
 * capitals; the database matches it in any case, and so does isLegalFile.
 */
export const LEGAL_SEGMENT = 'LEGAL'

/** Who sees a Legal file — Audrey's ruling, "same as money files". */
export const LEGAL_HINT = 'Only project managers and workspace admins can see this file.'

/** Beside Add files' Legal choice (only people past the money gate see it). */
export const LEGAL_ADD_HINT = 'Only project managers and workspace admins will see these files.'

/** The Legal chip on a Legal file: a fact, not a toggle. */
export const LEGAL_LOCKED_REASON = 'Added as Legal. To change this, add the file again.'

/** The Legal chip on every other file. */
export const LEGAL_AT_ADD_REASON = 'Legal is chosen when a file is added.'

/** The Core switch on a Legal file (files_legal_not_core_chk, 0088). */
export const LEGAL_NOT_CORE_REASON = 'A Legal file is never a core file: core files feed Intake and D.O.G., which the whole project reads.'

/** The Local Server has no roles (A9): the one line that says so. */
export const LEGAL_LOCAL_NOTE = 'On this computer\'s storage Legal is a folder, not a lock: restrict the LEGAL folder on the drive or NAS itself.'

/** Refused before any byte moves: a database without 0088. */
export const LEGAL_UNAVAILABLE = 'Legal files need a database update (migration 0088) that has not reached this workspace yet.'

/** Refused before any byte moves: someone outside the money gate. */
export const LEGAL_GATE_REFUSAL = 'Only project managers and workspace admins can add Legal files.'

const ORDER = new Map(FILE_TAG_IDS.map((id, i) => [id, i]))

export function tagLabel(id) {
  return FILE_TAGS.find((t) => t.id === id)?.label || String(id || '')
}

/** A row's STORED tags as the client trusts them: known, once each, in order. */
export function storedTags(row) {
  const raw = Array.isArray(row?.tags) ? row.tags : []
  const seen = new Set()
  for (const t of raw) {
    const id = typeof t === 'string' ? t : null
    if (id && ORDER.has(id)) seen.add(id)
  }
  return [...seen].sort((a, b) => ORDER.get(a) - ORDER.get(b))
}

/**
 * The tags a row SHOWS: its stored tags, with Finance taken from
 * is_financial and from nowhere else (a stored 'finance' is ignored, so the
 * badge can never disagree with the money gate the row is actually under).
 */
export function displayTags(row) {
  const out = storedTags(row).filter((t) => t !== DERIVED_TAG)
  if (row?.is_financial) out.push(DERIVED_TAG)
  return out.sort((a, b) => ORDER.get(a) - ORDER.get(b))
}

/** The array to WRITE: known, once each, in order, and never Finance. */
export function writableTags(ids) {
  return storedTags({ tags: ids }).filter((t) => t !== DERIVED_TAG)
}

/**
 * The next stored array once `id` is switched on or off for `row`. Legal is
 * never switched (0088): asked to, this returns the row's tags — which keep
 * 'legal' on a Legal file, as files_legal_folder_chk requires. `legal` is
 * whether the row IS Legal (isLegalFile, by default; the file window passes
 * false for a managed file, which is never Legal). A `legal` LABEL on any
 * other row — S4a's label period, before 0088 strips the cloud's and the
 * Local Server strips its own on read — is dropped from the write, so the
 * next save clears it rather than carrying it (review round 1, R1-BEH-03:
 * kept, it locked a managed file's tags for good).
 */
export function toggleTag(row, id, { legal = isLegalFile(row) } = {}) {
  const kept = writableTags(storedTags(row)).filter((t) => t !== GATED_TAG)
  const current = legal ? writableTags([...kept, GATED_TAG]) : kept
  if (id === GATED_TAG) return current
  const next = current.includes(id) ? current.filter((t) => t !== id) : [...current, id]
  return writableTags(next)
}

/**
 * Is this a Legal file? Every surface that must leave Legal files out —
 * D.O.G.'s attachments, the Projects page's list, the entity file managers,
 * Core — and the file window asks this one function.
 *
 * A CLOUD key (`projects/{id}/{SEGMENT}/…`, any provider but the Local
 * Server) is judged by its folder alone, which is what the database gates:
 * 0088 ties the tag to it, and a `legal` tag on any other cloud key is an
 * S4a label from before 0088 — called Legal, it would claim a lock nobody
 * applies (review round 1, R1-BEH-03). A Local Server row keeps a bare
 * filename (or, relinked, a path of the person's own folders — R1-BEH-06:
 * `Docs/2026/Legal/nda.pdf` is not Legal), so there the TAG is the fact,
 * written once by the upload that put the body in LEGAL. A row with no key
 * at all falls to the tag: fail closed.
 */
export function isLegalFile(row) {
  if (!row || typeof row !== 'object') return false
  const key = typeof row.storage_path === 'string' ? row.storage_path : ''
  if (row.storage_provider !== 'local_server' && key.startsWith('projects/')) {
    return (key.split('/')[2] || '').toUpperCase() === LEGAL_SEGMENT
  }
  return storedTags(row).includes(GATED_TAG)
}

/**
 * The sentence for a refusal by one of 0088's Legal rules (the two CHECKs and
 * the path trigger), or null for any other error. `fields` is the write that
 * was refused: asking to tag a file Legal is "chosen when a file is added";
 * removing it from a Legal file is "added as Legal". One function, so the
 * cloud adapter and the fixtures say the same thing (R1-BEH-08).
 */
export function legalRefusalSentence(message, fields) {
  const why = String(message || '')
  if (/files_legal_not_core_chk/.test(why)) return LEGAL_NOT_CORE_REASON
  if (/files_legal_folder_chk|files_legal_fixed/.test(why)) {
    const adding = Array.isArray(fields?.tags) && fields.tags.includes(GATED_TAG)
    return adding ? LEGAL_AT_ADD_REASON : LEGAL_LOCKED_REASON
  }
  return null
}

/**
 * May this person set or clear `id`? Returns `{ ok, reason }` so a refused
 * chip says why (Session 29: denied controls are shown, greyed, with the
 * reason). `legal` is whether the file IS Legal (isLegalFile). Finance and
 * Legal are facts about the file, never toggles, for anyone — so since S4b
 * nothing here depends on the money gate (who may ADD a Legal file is the
 * upload's question, not this one's).
 */
export function tagSettable(id, { canWrite = true, legal = false } = {}) {
  if (id === DERIVED_TAG) {
    return { ok: false, reason: 'Finance comes from the file being marked financial when it was added; it is not set by hand.' }
  }
  if (id === GATED_TAG) {
    return { ok: false, reason: legal ? LEGAL_LOCKED_REASON : LEGAL_AT_ADD_REASON }
  }
  if (!canWrite) return { ok: false, reason: 'You can view this project\'s files but not change them.' }
  return { ok: true, reason: null }
}

/** True when the filter text names one of the row's shown tags. */
export function tagsMatch(row, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return false
  return displayTags(row).some((id) => id.includes(q) || tagLabel(id).toLowerCase().includes(q))
}
