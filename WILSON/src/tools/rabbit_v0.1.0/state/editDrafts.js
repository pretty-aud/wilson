// ============================================================
// RABBIT — an unsaved EDIT (post-overhaul S3c, step 4; D13)
// ============================================================
//
// Audrey: "before applying the changes please ask the user to confirm if
// they would like to make a new edit. after the first drag and drop, do not
// ask the user to confirm again … dont auto save". D13: the first change asks
// once; Yes makes a DRAFT — written nowhere yet — seeded from what was on
// screen with the change applied; nothing is asked again until the draft is
// saved or discarded.
//
// The draft lives in the PROVIDER (RabbitProvider's `editDrafts`), keyed by
// project and list: the views mount one at a time, and a draft in
// ScenesView's state would die on a tab switch. One draft per list. Its shape
// is the brief's — { listId, basedOnEditId | null, title, version, items,
// dirty } — plus what the provider needs to keep it:
//   projectId   the project it belongs to
//   base        the items it started from (the list's order, or the edit's)
//   past/future the draft's own undo and redo (D13: the provider's undo
//               stands down while a draft is dirty; Ctrl+Z on the Scenes tab
//               takes back the draft's last change instead)
//   changedAt   when it last changed (what "Recover unsaved edit?" says)
//   made        the ids of the shots New shot added to the LIST for it —
//               written at once (D6), so Discard changes says they stay
//               (review round 1, R1-04)
// `dirty` is true for as long as the draft exists: it is unsaved work from
// Yes until Save edit or Discard changes, even when an undo has taken it back
// to where it started (D13 asks no second question until then, so the draft
// — and the leave guard's question — stay).
//
// A copy goes to localStorage on every change (EDIT_DRAFTS_KEY), so a crash
// offers "Recover unsaved edit?" on the next visit. The copy holds what the
// draft needs, not its undo stacks; it is keyed by person too, so another
// person signing in on the machine is not offered it.
//
// Pure: drafts in, drafts out (editDrafts.test.js).
// ============================================================

export const EDIT_DRAFTS_KEY = 'rabbit_edit_drafts'
/** How many of the draft's own changes Ctrl+Z can take back. */
export const DRAFT_HISTORY_CAP = 50

/** The provider's key for a draft: one per project and list. */
export function draftKey(projectId, listId) {
  return `${projectId}|${listId}`
}

/** The stored copy's key: the person too ('local' where there are no users). */
export function storedDraftKey(personKey, projectId, listId) {
  return `${personKey || 'local'}|${projectId}|${listId}`
}

const copyItems = (items) => (Array.isArray(items) ? items.map(it => ({ ...it })) : [])

/**
 * A new draft: `base` is what was on screen, `items` the first change
 * applied to it (D13). Its undo goes back to `base`.
 */
const copyIds = (ids) => (Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : [])

export function startDraft({ projectId, listId, basedOnEditId = null, title, version, base, items, now, made = [] }) {
  return {
    projectId,
    listId,
    basedOnEditId: basedOnEditId || null,
    title,
    version,
    base: copyItems(base),
    items: copyItems(items),
    dirty: true,
    past: [copyItems(base)],
    future: [],
    changedAt: now,
    made: copyIds(made),
  }
}

/** The next change: the items now become one undo step back; `made`, shots it wrote. */
export function changeDraft(draft, items, now, made = []) {
  const past = [...draft.past, draft.items]
  return {
    ...draft,
    items: copyItems(items),
    past: past.length > DRAFT_HISTORY_CAP ? past.slice(past.length - DRAFT_HISTORY_CAP) : past,
    future: [],
    changedAt: now,
    made: [...copyIds(draft.made), ...copyIds(made)],
  }
}

/** The draft's own undo: its last change taken back (null: nothing to take back). */
export function undoDraft(draft, now) {
  if (!draft?.past?.length) return null
  return {
    ...draft,
    items: draft.past[draft.past.length - 1],
    past: draft.past.slice(0, -1),
    future: [draft.items, ...draft.future],
    changedAt: now,
  }
}

/** …and its redo (null: nothing to redo). */
export function redoDraft(draft, now) {
  if (!draft?.future?.length) return null
  return {
    ...draft,
    items: draft.future[0],
    past: [...draft.past, draft.items],
    future: draft.future.slice(1),
    changedAt: now,
  }
}

/** What localStorage keeps of a draft. */
export function storedCopy(draft, personKey) {
  return {
    personKey: personKey || 'local',
    projectId: draft.projectId,
    listId: draft.listId,
    basedOnEditId: draft.basedOnEditId || null,
    title: draft.title,
    version: draft.version,
    base: draft.base,
    items: draft.items,
    changedAt: draft.changedAt,
    made: copyIds(draft.made),
  }
}

/**
 * A draft again from its stored copy ("Recover unsaved edit?" → Recover).
 * Its undo starts empty: the recovered items are where the person picks up.
 */
export function draftFromCopy(copy) {
  return {
    projectId: copy.projectId,
    listId: copy.listId,
    basedOnEditId: copy.basedOnEditId || null,
    title: copy.title,
    version: copy.version,
    base: copyItems(copy.base),
    items: copyItems(copy.items),
    dirty: true,
    past: [],
    future: [],
    changedAt: copy.changedAt,
    made: copyIds(copy.made),
  }
}

/** A stored copy worth offering: it names a project and a list and holds items. */
export function isUsableCopy(v) {
  return !!(v && typeof v === 'object' && typeof v.projectId === 'string' && typeof v.listId === 'string'
    && Array.isArray(v.items) && typeof v.title === 'string')
}

/** Every stored copy (a JSON object read whole; every failure is "none"). */
export function readStoredDrafts(storage = globalThis.localStorage) {
  try {
    const v = JSON.parse(storage?.getItem(EDIT_DRAFTS_KEY) || '{}')
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    const out = {}
    for (const [k, copy] of Object.entries(v)) if (isUsableCopy(copy)) out[k] = copy
    return out
  } catch { return {} }
}

/** Write (copy) or remove (null) one stored copy. A refused write is swallowed. */
export function writeStoredDraft(key, copy, storage = globalThis.localStorage) {
  try {
    const all = readStoredDrafts(storage)
    if (copy) all[key] = copy
    else delete all[key]
    if (Object.keys(all).length) storage?.setItem(EDIT_DRAFTS_KEY, JSON.stringify(all))
    else storage?.removeItem(EDIT_DRAFTS_KEY)
  } catch { /* storage refused: the draft lives on in memory only */ }
}
