// =============================================================================
// fileTags.js — a project file's tags (post-overhaul S4a, migration 0085).
//
// Audrey's rulings (docs/design/POST_OVERHAUL_PLAN.md §0.1, 2026-09-29):
//   E3  NINE tags, several per file, beside Kind, monochrome — Production,
//       Creative, Legal, Finance, Reference, Assets, Code, Shots,
//       Documentation ("remove the notes tag option").
//   E4  labels only for now: FINANCE is shown read-only, derived from
//       files.is_financial, and never written as a tag; LEGAL is a plain
//       label ("not restricted yet") that only people who pass the money gate
//       may set or clear, so it is in the right hands when S4b's gate lands.
//   E12 tags start empty on every existing row; the old files.kind is ignored.
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

/** Legal: settable only by people who pass the money gate (E4). */
export const GATED_TAG = 'legal'

/** The sentence beside Legal until S4b builds its gate. */
export const LEGAL_HINT = 'Not restricted yet: anyone who can open the file can still see it.'

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

/** The next stored array once `id` is switched on or off for `row`. */
export function toggleTag(row, id) {
  const current = writableTags(storedTags(row))
  const next = current.includes(id) ? current.filter((t) => t !== id) : [...current, id]
  return writableTags(next)
}

/**
 * May this person set or clear `id`? Returns `{ ok, reason }` so a refused
 * chip says why (Session 29: denied controls are shown, greyed, with the
 * reason). `canSeeMoney` is canSeeProjectMoney's answer; on the Local Server
 * (no roles) it is true.
 */
export function tagSettable(id, { canWrite = true, canSeeMoney = false } = {}) {
  if (id === DERIVED_TAG) {
    return { ok: false, reason: 'Finance comes from the file being marked financial when it was added; it is not set by hand.' }
  }
  if (!canWrite) return { ok: false, reason: 'You can view this project\'s files but not change them.' }
  if (id === GATED_TAG && !canSeeMoney) {
    return { ok: false, reason: 'Only workspace admins and the project\'s managers can set or clear Legal.' }
  }
  return { ok: true, reason: null }
}

/** True when the filter text names one of the row's shown tags. */
export function tagsMatch(row, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return false
  return displayTags(row).some((id) => id.includes(q) || tagLabel(id).toLowerCase().includes(q))
}
