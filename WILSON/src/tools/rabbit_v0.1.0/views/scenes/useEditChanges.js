// ============================================================
// RABBIT — a change to the cut, and the one question before the first
// (post-overhaul S3c, step 4; D13)
// ============================================================
//
// Every verb that changes a cut — a row's or a scene's edit actions, the
// drag (step 6), "New edit from this list" — comes through `request`:
//   · a DRAFT on screen: the change is applied to it at once (no question:
//     "after the first drag and drop, do not ask the user to confirm again")
//   · otherwise (a saved edit, or the list's own order): nothing changes yet;
//     the question opens (`asking`), saying what Yes makes. Yes starts the
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
      try {
        const prepared = prepare ? await prepare() : null
        // The draft as it is NOW: a prepare may have taken a round trip.
        const draft = ctx?.editDraftOf?.(list.id)
        if (!draft) return false
        const next = apply ? apply(draft.items, prepared) : null
        if (!next) return false
        ctx.changeEditDraft(list.id, next, { made: made ? made(prepared) : [] })
        return true
      } catch (err) {
        onError?.(err)
        return false
      }
    }
    const from = mode === 'edit' ? row : null
    const base = from ? (from.items || []) : (ctx?.editItemsFromList?.(list.id) || [])
    // A change that changes nothing (a row dropped back where it was) asks
    // nothing. Only a change with no `prepare` can be tried before Yes.
    if (apply && !prepare && !apply(base)) return false
    setAsking({
      listId: list.id,
      list,
      from,
      tip: ctx?.editChainTip?.(list.id) || null,
      name: draftName({ edits: ctx?.edits, list }),
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
      listId: a.listId,
      basedOnEditId: a.from?.id || null,
      title: a.name.title,
      version: a.name.version,
      base: a.base,
      items: next || a.base,
      made: a.made ? a.made(prepared) : [],
    })
    setAsking(null)
  }, [ctx, asking])

  const cancel = useCallback(() => setAsking(null), [])

  return { request, asking, answer, cancel }
}
