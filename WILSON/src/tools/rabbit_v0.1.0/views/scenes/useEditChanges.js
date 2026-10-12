// ============================================================
// RABBIT — a change to the cut, and the one question before the first
// (post-overhaul S3c, step 4; D13 — and FX4)
// ============================================================
//
// Every verb that changes a cut — a row's or a scene's edit actions, the
// drag (step 6), "New edit from this list" — comes through `request`:
//   · a DRAFT on screen: the change is applied to it at once (no question:
//     "after the first drag and drop, do not ask the user to confirm again")
//   · a SAVED edit on screen (FX4, Audrey 2026-10-12: "when i make changes to
//     an edit, it should start to edit the current selected edit instead of
//     asking me to always make a new one"): the change is applied at once,
//     to that edit's own unsaved changes — the provider's draft with its
//     `editId`, title and version — and asks nothing. Save edit then writes
//     it INTO the edit; only Save as… makes a new version. One exception
//     asks: an unsaved edit of this list kept from before ("Recover unsaved
//     edit?" → Not now) would be replaced (S3c R1-03), so the question says
//     so first, and Cancel keeps it.
//   · the list's own order (List order: no edit yet): nothing changes yet;
//     D13's question opens (`asking`), saying what Yes makes. Yes starts the
//     provider's draft from what was on screen with the change applied;
//     Cancel leaves everything as it was and makes nothing.
// A change is { what, apply, prepare?, writes?, made? }:
//   what      the change in words, for the question (editCopy's verbs)
//   apply     (items, prepared) → the next items, or null (nothing to change)
//   prepare   async, run only once the change is going ahead — "New shot"
//             makes its real shot here, so a Cancel makes none
//   writes    what it writes at once, for the question (review round 1,
//             R1-04: New shot's question said nothing was written)
//   made      (prepared) → the ids of the shots it wrote, kept on the draft
//             so Discard changes can say they stay
// ============================================================

import { useCallback, useState } from 'react'
import { draftName } from './editModel'
import { savedAtOf } from '../../state/editDrafts'

/**
 * ctx      useRabbit()
 * session  useEditSession(): the list on screen and its edit, draft or neither
 * canEdit  this seat may change edits here (project.shotlist.write, a live list)
 * onError  where a refusal goes when there is no question to show it in
 * → { request(change), asking, answer(), cancel() }
 */
export function useEditChanges({ ctx, session, canEdit, onError }) {
  const [asking, setAsking] = useState(null)
  const list = session?.list || null
  const mode = session?.mode || 'none'
  const row = session?.row || null
  const readOnly = !!session?.readOnly

  const request = useCallback(async ({ what = null, apply = null, prepare = null, writes = null, made = null } = {}) => {
    if (!canEdit || !list || readOnly) return false
    if (mode === 'draft') {
      const onScreen = session?.draft || ctx?.editDraftOf?.(list.id) || null
      let prepared = null
      try {
        prepared = prepare ? await prepare() : null
        if (!apply || !onScreen) return false
        // The draft as it is NOW in the provider (a prepare may have taken a
        // round trip), and only these same changes (FX4 review rounds 1 and
        // 2: by their identity, kept through a save that rebased them; saved
        // meanwhile, onto the edit they became).
        return !!ctx.changeEditDraft(list.id, (items) => apply(items, prepared), { made: made ? made(prepared) : [], draftId: onScreen.draftId || null })
      } catch (err) {
        const wrote = prepared?.name ? ` The new shot “${prepared.name}” was added to the list and stays there.` : ''
        onError?.(wrote ? new Error(`${err?.message || err}.${wrote}`) : err)
        return false
      }
    }
    const from = mode === 'edit' ? row : null
    const base = from ? (from.items || []) : (ctx?.editItemsFromList?.(list.id) || [])
    // A change that changes nothing (a row dropped back where it was) asks
    // nothing. Only a change with no `prepare` can be tried before Yes.
    if (apply && !prepare && !apply(base)) return false
    // FX4: on a saved edit, the change is that edit's at once — unless an
    // unsaved edit of this list kept from before would be replaced by it.
    const kept = from ? (ctx?.recoverableEditDrafts || []).find(c => c.listId === list.id) || null : null
    const ofEdit = from ? { title: from.title, version: from.version } : null
    if (from && !kept) {
      let prepared = null
      try {
        prepared = prepare ? await prepare() : null
        const next = apply ? apply(base, prepared) : null
        if (!next) return false
        ctx.startEditDraft({
          ...inPlaceOf(from, list.id),
          base,
          items: next,
          made: made ? made(prepared) : [],
          // Changes to this same edit begun meanwhile (another change, while
          // this one's New shot was written): this change goes onto them —
          // never onto another edit's (review round 1, R1-09).
          orApply: apply ? (items) => apply(items, prepared) : null,
        })
        return true
      } catch (err) {
        // The shot New shot wrote stays in the list whatever became of the change: say so.
        const wrote = prepared?.name ? ` The new shot “${prepared.name}” was added to the list and stays there.` : ''
        onError?.(wrote ? new Error(`${err?.message || err}.${wrote}`) : err)
        return false
      }
    }
    setAsking({
      listId: list.id,
      list,
      from,
      tip: ctx?.editChainTip?.(list.id) || null,
      name: ofEdit || draftName({ edits: ctx?.edits, list }),
      base,
      what,
      writes,
      apply,
      prepare,
      made,
    })
    return true
  }, [ctx, canEdit, list, mode, row, readOnly, onError])

  /** Yes: the draft, from what was on screen with the change applied. Throws a refusal (the question shows it). */
  const answer = useCallback(async () => {
    const a = asking
    if (!a) return
    const prepared = a.prepare ? await a.prepare() : null
    const next = a.apply ? a.apply(a.base, prepared) : null
    ctx.startEditDraft({
      ...(a.from ? inPlaceOf(a.from, a.listId) : { listId: a.listId, basedOnEditId: null, title: a.name.title, version: a.name.version }),
      base: a.base,
      items: next || a.base,
      made: a.made ? a.made(prepared) : [],
    })
    setAsking(null)
  }, [ctx, asking])

  const cancel = useCallback(() => setAsking(null), [])

  return { request, asking, answer, cancel }
}

/** FX4: a saved edit's unsaved changes — that edit, its own name, and the Save they began from. */
function inPlaceOf(edit, listId) {
  return {
    listId,
    basedOnEditId: edit.id,
    editId: edit.id,
    title: edit.title,
    version: edit.version,
    baseSavedAt: savedAtOf(edit.snapshot),
  }
}
