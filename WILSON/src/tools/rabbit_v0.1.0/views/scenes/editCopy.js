// ============================================================
// RABBIT — what the edit questions say (post-overhaul S3c, step 4)
// ============================================================
//
// S3c's brief: "a person must never be unsure which of the two they are
// changing" — a LIST (live, its own order) or an EDIT (a cut held as a draft
// until Save edit) — "the question's sentence says what Yes will do". So the
// first-change question (D13) names what Yes makes ("Shoot · v4"), what it
// starts from (the list's order, or the edit on screen), the change itself,
// and what does NOT change; and its verb says which: "Start new edit" from a
// list, "Start new version" from an edit. The sentence names that answer by
// its own label, as the leave question names its three (there is no "Yes"
// button to look for). Pure (editCopy.test.js).
// ============================================================

import { formatShotListLabel } from '../../state/shotListModel'
import { showDate } from '../../dates'

const q = (s) => `“${s}”`

/** What New shot writes at once (review round 1, R1-04: the question said nothing was). */
export const NEW_SHOT_WRITES = 'The new shot is added to the list now, and stays there whatever becomes of the edit.'

/**
 * D13's question, before a list's or an edit's first change.
 *   list      the list on screen
 *   from      the saved edit on screen, or null (the list's order)
 *   tip       the chain's latest edit, or null (the list has none)
 *   name      draftName's { title, version } — what Yes makes
 *   what      the change, in words ("Move “The door” down"), or null (none yet)
 *   writes    what the change writes at once, or null (nothing: the usual)
 *   replaces  the unsaved edit a previous run left for this list and the
 *             person put off ("Recover unsaved edit?" → Not now), or null:
 *             a new edit of the list takes its place (review round 1, R1-03)
 * → { title, lines, confirmLabel }
 */
export function firstChangeQuestion({ list, from = null, tip = null, name, what = null, writes = null, replaces = null }) {
  const making = q(formatShotListLabel(name))
  const change = what ? ` with this change: ${what}` : ''
  const unsaved = writes
    ? `${writes} The edit itself is not saved until you choose Save edit.`
    : 'Nothing is saved until you choose Save edit.'
  const after = replaces ? [replacesWords(replaces)] : []
  if (!from) {
    return {
      title: 'Make a new edit from this list?',
      lines: [
        `Start new edit makes ${making}, ${tip ? 'the next edit' : 'a new edit'} of ${q(formatShotListLabel(list))}, from the list's order${change}.`,
        `The list itself does not change. ${unsaved}`,
        ...after,
      ],
      confirmLabel: 'Start new edit',
    }
  }
  const fromLabel = q(formatShotListLabel(from))
  if (tip && tip.id !== from.id) {
    return {
      title: 'Make a new version of this edit?',
      lines: [
        `Start new version makes ${making}, the next version after ${q(formatShotListLabel(tip))}, the latest, from ${fromLabel}${change}.`,
        `Saved versions stay as they are. ${unsaved}`,
        ...after,
      ],
      confirmLabel: 'Start new version',
    }
  }
  return {
    title: 'Make a new version of this edit?',
    lines: [
      `Start new version makes ${making} from ${fromLabel}${change}.`,
      `${fromLabel} stays as it was saved. ${unsaved}`,
      ...after,
    ],
    confirmLabel: 'Start new version',
  }
}

/** The put-off copy a new edit of its list replaces, and the way back to it first. */
export function replacesWords(copy) {
  const n = (copy?.items || []).length
  return `It replaces ${q(formatShotListLabel(copy))}, the unsaved edit of this list kept from before (${n} shot${n === 1 ? '' : 's'}), which is then gone. To keep that one instead, choose Cancel, then Recover unsaved edit… in the bar's More menu.`
}

/**
 * "Recover unsaved edit?" — a copy a previous run left (the provider's
 * recoverableEditDrafts): what it would make, of which list, how big, when
 * last changed; and, when its list is archived or gone, why it cannot be.
 *   copy   the stored copy ({ title, version, items, changedAt })
 *   list   its list now, or null
 *   locale for the date (tests)
 */
export function recoverWords({ copy, list, locale }) {
  const n = (copy?.items || []).length
  const of = list ? `, an edit of ${q(formatShotListLabel(list))},` : ''
  const when = copy?.changedAt
    ? ` It was last changed ${showDate(copy.changedAt, { locale, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}.`
    : ''
  const lead = `WILSON closed before ${q(formatShotListLabel(copy))}${of} was saved. It holds ${n} shot${n === 1 ? '' : 's'}.${when}`
  if (!list) return `${lead} Its list is no longer in this project, so it cannot be recovered.`
  if (list.archived_at) return `${lead} Its list is archived: restore the list to recover the edit.`
  return `${lead} Recover it to keep working on it, or discard it.`
}

/**
 * "Discard changes?" — what goes, and what comes back.
 *   draft    the draft ({ title, version })
 *   basedOn  the saved edit it began from, or null (the list's order)
 *   made     the names of the shots New shot added to the list for it: they
 *            were written at once, and stay (review round 1, R1-04)
 */
export function discardWords({ draft, basedOn, made = [] }) {
  const back = basedOn ? `${q(formatShotListLabel(basedOn))} comes back as it was saved` : 'the list\'s own order comes back'
  const rest = !made.length ? 'Nothing was written, so nothing else changes.'
    : made.length === 1 ? `The new shot it added to the list, ${q(made[0])}, stays there.`
    : `The new shots it added to the list stay there: ${made.map(q).join(', ')}.`
  return `${q(formatShotListLabel(draft))} is not saved: its changes go, and ${back}. ${rest}`
}

// ── each change, in words (the question's "with this change: …") ─────────
// The menus' own verbs (Duplicate in edit, Remove from edit, Move up…), so
// the question repeats what was chosen rather than a second vocabulary.

export const moveWords = (name, dir) => `Move ${q(name)} ${dir < 0 ? 'up' : 'down'}`
export const duplicateWords = (name) => `Duplicate ${q(name)} in the edit`
export const removeWords = (name) => `Remove ${q(name)} from the edit`
export const addWords = (n) => `Add ${n} shot${n === 1 ? '' : 's'}`
export const newShotWords = (sceneLabel) => `Add a new shot to ${q(sceneLabel)}`
export const moveBlockWords = (label, dir) => `Move the scene ${q(label)} ${dir < 0 ? 'up' : 'down'}`
/** A drop (step 6): a shot before / after a shot, or to the top of a scene; a scene before / after a scene. */
export function dropWords({ dragName, dragIsScene, targetName, targetIsScene, where }) {
  if (dragIsScene) return `Move the scene ${q(dragName)} ${where} ${q(targetName)}`
  if (targetIsScene) return `Move ${q(dragName)} to the top of ${q(targetName)}`
  return `Move ${q(dragName)} ${where} ${q(targetName)}`
}
export const duplicateBlockWords = (label) => `Duplicate the scene ${q(label)} in the edit`
export const removeBlockWords = (label) => `Remove the scene ${q(label)} from the edit`
