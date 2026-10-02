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
// list, "Start new version" from an edit. Pure (editCopy.test.js).
// ============================================================

import { formatShotListLabel } from '../../state/shotListModel'
import { showDate } from '../../dates'

const q = (s) => `“${s}”`

/**
 * D13's question, before a list's or an edit's first change.
 *   list   the list on screen
 *   from   the saved edit on screen, or null (the list's order)
 *   tip    the chain's latest edit, or null (the list has none)
 *   name   draftName's { title, version } — what Yes makes
 *   what   the change, in words ("Move “The door” down"), or null (none yet)
 * → { title, lines: [string, string], confirmLabel }
 */
export function firstChangeQuestion({ list, from = null, tip = null, name, what = null }) {
  const making = q(formatShotListLabel(name))
  const change = what ? ` with this change: ${what}` : ''
  if (!from) {
    return {
      title: 'Make a new edit from this list?',
      lines: [
        `Yes starts ${making}, ${tip ? 'the next edit' : 'a new edit'} of ${q(formatShotListLabel(list))}, from the list's order${change}.`,
        'The list itself does not change. Nothing is saved until you choose Save edit.',
      ],
      confirmLabel: 'Start new edit',
    }
  }
  const fromLabel = q(formatShotListLabel(from))
  if (tip && tip.id !== from.id) {
    return {
      title: 'Make a new version of this edit?',
      lines: [
        `Yes starts ${making}, the next version after ${q(formatShotListLabel(tip))}, the latest, from ${fromLabel}${change}.`,
        'Saved versions stay as they are. Nothing is saved until you choose Save edit.',
      ],
      confirmLabel: 'Start new version',
    }
  }
  return {
    title: 'Make a new version of this edit?',
    lines: [
      `Yes starts ${making} from ${fromLabel}${change}.`,
      `${fromLabel} stays as it was saved. Nothing is saved until you choose Save edit.`,
    ],
    confirmLabel: 'Start new version',
  }
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
 */
export function discardWords({ draft, basedOn }) {
  const back = basedOn ? `${q(formatShotListLabel(basedOn))} comes back as it was saved` : 'the list\'s own order comes back'
  return `${q(formatShotListLabel(draft))} is not saved: its changes go, and ${back}. Nothing was written, so nothing else changes.`
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
