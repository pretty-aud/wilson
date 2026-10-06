// editCopy.test.js — the first-change question's sentences (S3c step 4, D13).
import { describe, it, expect } from 'vitest'
import { firstChangeQuestion, recoverWords, discardWords, dropWords, moveWords, duplicateWords, removeWords, addWords, newShotWords, moveBlockWords, duplicateBlockWords, removeBlockWords, NEW_SHOT_WRITES, replacesWords } from './editCopy'

const list = { id: 'L1', title: 'Shoot', version: 2 }
const v1 = { id: 'e1', title: "Director's cut", version: 1 }
const v3 = { id: 'e3', title: "Director's cut", version: 3 }

describe('the first-change question says what Yes makes, from what, and what stays (D13)', () => {
  it('from a list with no edit: a new edit, from the list\'s order; the list does not change', () => {
    const qn = firstChangeQuestion({ list, name: { title: 'Shoot', version: 1 }, what: 'Move “The door” down' })
    expect(qn.title).toBe('Make a new edit from this list?')
    expect(qn.lines).toEqual([
      'Start new edit makes “Shoot · v1”, a new edit of “Shoot · v2”, from the list\'s order with this change: Move “The door” down.',
      'The list itself does not change. Nothing is saved until you choose Save edit.',
    ])
    expect(qn.confirmLabel).toBe('Start new edit')
  })
  it('from a list whose chain has edits: the next edit — and with no change yet, no change named', () => {
    const qn = firstChangeQuestion({ list, tip: v3, name: { title: "Director's cut", version: 4 } })
    expect(qn.lines[0]).toBe('Start new edit makes “Director\'s cut · v4”, the next edit of “Shoot · v2”, from the list\'s order.')
  })
  it('from the latest edit: its next version; the saved one stays', () => {
    const qn = firstChangeQuestion({ list, from: v3, tip: v3, name: { title: "Director's cut", version: 4 }, what: 'Duplicate “The door” in the edit' })
    expect(qn.title).toBe('Make a new version of this edit?')
    expect(qn.lines).toEqual([
      'Start new version makes “Director\'s cut · v4” from “Director\'s cut · v3” with this change: Duplicate “The door” in the edit.',
      '“Director\'s cut · v3” stays as it was saved. Nothing is saved until you choose Save edit.',
    ])
    expect(qn.confirmLabel).toBe('Start new version')
  })
  it('from an OLDER edit: the next version after the latest (one chain, D6), from the one on screen', () => {
    const qn = firstChangeQuestion({ list, from: v1, tip: v3, name: { title: "Director's cut", version: 4 }, what: 'Move “Boats” up' })
    expect(qn.lines[0]).toBe('Start new version makes “Director\'s cut · v4”, the next version after “Director\'s cut · v3”, the latest, from “Director\'s cut · v1” with this change: Move “Boats” up.')
    expect(qn.lines[1]).toBe('Saved versions stay as they are. Nothing is saved until you choose Save edit.')
  })
  it('names its go-ahead by the button\'s own label in every case — there is no "Yes" to look for', () => {
    const cases = [
      firstChangeQuestion({ list, name: { title: 'Shoot', version: 1 } }),
      firstChangeQuestion({ list, tip: v3, name: { title: "Director's cut", version: 4 } }),
      firstChangeQuestion({ list, from: v3, tip: v3, name: { title: "Director's cut", version: 4 } }),
      firstChangeQuestion({ list, from: v1, tip: v3, name: { title: "Director's cut", version: 4 } }),
    ]
    for (const qn of cases) {
      expect(qn.lines[0].startsWith(`${qn.confirmLabel} makes “`)).toBe(true)
      expect(qn.lines.join(' ')).not.toMatch(/\bYes\b/)
    }
  })
})

describe('"Recover unsaved edit?" says what was left, and when it cannot be', () => {
  const copy = { title: "Director's cut", version: 4, items: [{}, {}, {}], changedAt: '2026-10-02T14:32:00' }
  it('names the edit, its list, its size and when it last changed', () => {
    const words = recoverWords({ copy, list, locale: 'en-GB' })
    expect(words).toBe('“Director\'s cut · v4”, an edit of “Shoot · v2”, was left unsaved. It holds 3 shots. It was last changed 02/10/2026, 14:32. Recover it to keep working on it, or discard it.')
  })
  it('an archived list: restore it first; a list gone: it cannot be recovered', () => {
    expect(recoverWords({ copy, list: { ...list, archived_at: 'T' }, locale: 'en-GB' })).toMatch(/Its list is archived: restore the list to recover the edit\.$/)
    expect(recoverWords({ copy: { ...copy, items: [{}], changedAt: null }, list: null })).toBe('“Director\'s cut · v4” was left unsaved. It holds 1 shot. Its list is no longer in this project, so it cannot be recovered.')
  })
  // Review round 2 (R2-03; S3c-06): a copy is left by a closed window, a
  // reloaded tab or a sign-out alike, so the words never say which.
  it('never says why the edit was left (WILSON may never have closed)', () => {
    for (const l of [list, { ...list, archived_at: 'T' }, null]) {
      expect(recoverWords({ copy, list: l, locale: 'en-GB' })).not.toMatch(/closed|crash|reload|signed out/i)
    }
  })
})

describe('"Discard changes?" says what goes and what comes back', () => {
  it('a draft of an edit: that edit comes back as saved; of the list: the list\'s order', () => {
    expect(discardWords({ draft: { title: "Director's cut", version: 4 }, basedOn: v3 }))
      .toBe('“Director\'s cut · v4” is not saved: its changes go, and “Director\'s cut · v3” comes back as it was saved. Nothing was written, so nothing else changes.')
    expect(discardWords({ draft: { title: 'Shoot', version: 1 }, basedOn: null }))
      .toBe('“Shoot · v1” is not saved: its changes go, and the list\'s own order comes back. Nothing was written, so nothing else changes.')
  })
  // Review round 1 (R1-04): New shot writes a real shot at once (D6), so
  // "nothing was written" was not true of a draft that used it.
  it('a draft that added new shots to the list says they stay — one, or several', () => {
    expect(discardWords({ draft: { title: 'Shoot', version: 1 }, basedOn: null, made: ['SC01_SH031'] }))
      .toBe('“Shoot · v1” is not saved: its changes go, and the list\'s own order comes back. The new shot it added to the list, “SC01_SH031”, stays there.')
    expect(discardWords({ draft: { title: 'Shoot', version: 1 }, basedOn: null, made: ['SC01_SH031', 'SC02_SH011'] }))
      .toBe('“Shoot · v1” is not saved: its changes go, and the list\'s own order comes back. The new shots it added to the list stay there: “SC01_SH031”, “SC02_SH011”.')
  })
})

describe('review round 1: the question says what a change writes, and what a new edit replaces', () => {
  it('R1-04: New shot says the shot is added to the list now, and that the edit itself is not saved', () => {
    const qn = firstChangeQuestion({ list, from: v3, tip: v3, name: { title: "Director's cut", version: 4 }, what: 'Add a new shot to “Boats”', writes: NEW_SHOT_WRITES })
    expect(qn.lines[1]).toBe('“Director\'s cut · v3” stays as it was saved. The new shot is added to the list now, and stays there whatever becomes of the edit. The edit itself is not saved until you choose Save edit.')
    expect(qn.lines.join(' ')).not.toContain('Nothing is saved until you choose Save edit.')
  })
  it('R1-03: an unsaved edit of this list kept from before is named — what replaces it, and the way back to it first', () => {
    const copy = { title: 'Shoot', version: 2, items: [{}, {}, {}] }
    const qn = firstChangeQuestion({ list, name: { title: 'Shoot', version: 1 }, what: 'Move “The door” down', replaces: copy })
    expect(qn.lines).toHaveLength(3)
    expect(qn.lines[2]).toBe('It replaces “Shoot · v2”, the unsaved edit of this list kept from before (3 shots), which is then gone. To keep that one instead, choose Cancel, then Recover unsaved edit… in the bar\'s More menu.')
    expect(replacesWords({ title: 'A', version: 1, items: [{}] })).toContain('(1 shot)')
    // Without one, two lines, as before.
    expect(firstChangeQuestion({ list, name: { title: 'Shoot', version: 1 } }).lines).toHaveLength(2)
  })
})

describe('each change in words', () => {
  it('names the shot or the block and the direction', () => {
    expect(moveWords('The door', -1)).toBe('Move “The door” up')
    expect(moveWords('The door', 1)).toBe('Move “The door” down')
    expect(duplicateWords('The door')).toBe('Duplicate “The door” in the edit')
    expect(removeWords('The door')).toBe('Remove “The door” from the edit')
    expect(addWords(1)).toBe('Add 1 shot')
    expect(addWords(3)).toBe('Add 3 shots')
    expect(newShotWords('Lighthouse')).toBe('Add a new shot to “Lighthouse”')
    expect(moveBlockWords('Lighthouse', -1)).toBe('Move the scene “Lighthouse” up')
    expect(duplicateBlockWords('Lighthouse')).toBe('Duplicate the scene “Lighthouse” in the edit')
    expect(removeBlockWords('Lighthouse')).toBe('Remove the scene “Lighthouse” from the edit')
  })
  it('a drop says what moved, and where to', () => {
    expect(dropWords({ dragName: 'The door', targetName: 'Boats', where: 'before' })).toBe('Move “The door” before “Boats”')
    expect(dropWords({ dragName: 'The door', targetName: 'Boats', where: 'after' })).toBe('Move “The door” after “Boats”')
    expect(dropWords({ dragName: 'The door', targetName: 'Cliff path', targetIsScene: true, where: 'after' })).toBe('Move “The door” to the top of “Cliff path”')
    expect(dropWords({ dragName: 'Cliff path', dragIsScene: true, targetName: 'Harbour', targetIsScene: true, where: 'before' })).toBe('Move the scene “Cliff path” before “Harbour”')
  })
})
