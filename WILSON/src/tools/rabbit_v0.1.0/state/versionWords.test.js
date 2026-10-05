// =============================================================================
// versionWords.test.js — the words of bid versions (post-overhaul S5b). Each
// sentence names what it does and where rows go; each case has a control.
// =============================================================================

import { describe, it, expect } from 'vitest'
import {
  joinNames, rowsWords, removalToastWords, removalQuestion, removalNeedsAsking,
  someNames, unsavedQuestionWords, openQuestionWords, deleteQuestionWords, saveAsNewWords,
  openedToastWords, lockedToastWords, resetToastWords, deletedToastWords, recordedToastWords,
} from './versionWords'

describe('joinNames and rowsWords', () => {
  it('no serial comma', () => {
    expect(joinNames(['A'])).toBe('A')
    expect(joinNames(['A', 'B'])).toBe('A and B')
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C')
    expect(joinNames([])).toBe('')
  })
  it('counts each kind, singular and plural, and says nothing for none', () => {
    expect(rowsWords({ tasks: [1, 2, 3], phases: [1], milestones: [1, 2] })).toBe('3 tasks, 1 phase and 2 key dates')
    expect(rowsWords({ tasks: [1] })).toBe('1 task')
    expect(rowsWords({})).toBe('')
  })
})

describe('removalToastWords — Remove from this version (constraint 9)', () => {
  const openVersion = { id: 'v2', name: 'Mid ROM · v2' }
  const removed = (name, holders) => ({ kind: 'tasks', id: name, name, verb: 'remove', holders: holders.map(h => ({ id: h, name: h })) })
  const deleted = (name) => ({ kind: 'tasks', id: name, name, verb: 'delete', holders: [] })
  it('one row: what went, from which version, and which version still holds it', () => {
    expect(removalToastWords({ openVersion, rows: [removed('Lighting pass 2', ['High ROM · v3'])] }))
      .toBe('Removed “Lighting pass 2” from “Mid ROM · v2” — “High ROM · v3” still holds it')
    expect(removalToastWords({ openVersion, rows: [removed('Grade', ['Low ROM', 'High ROM'])] }))
      .toBe('Removed “Grade” from “Mid ROM · v2” — “Low ROM” and “High ROM” still hold it')
  })
  it('several rows, and the ordinary deletes beside them', () => {
    expect(removalToastWords({ openVersion, rows: [removed('A', ['v3']), removed('B', ['v3']), deleted('C')] }))
      .toBe('Removed 2 rows from “Mid ROM · v2” — the other bid versions that hold them keep them; deleted “C”')
    expect(removalToastWords({ openVersion, rows: [removed('A', ['v3']), deleted('C'), deleted('D')] }))
      .toBe('Removed “A” from “Mid ROM · v2” — “v3” still holds it; deleted 2 more')
  })
})

describe('removalQuestion — the confirm says which (constraint 9)', () => {
  const openVersion = { id: 'v2', name: 'Mid ROM · v2' }
  const row = (name, verb, holders = [], work = null) => ({ kind: 'tasks', id: name, name, verb, holders: holders.map(h => ({ id: h, name: h })), work })
  it('every row an ordinary delete: no question of its own (the caller\'s stands)', () => {
    expect(removalQuestion({ openVersion, rows: [row('A', 'delete')] })).toBeNull()
  })
  it('one row another version holds: Remove, where it stays, and that nothing is deleted', () => {
    const q = removalQuestion({ openVersion, rows: [row('Grade', 'remove', ['High ROM · v3'])] })
    expect(q.title).toBe('Remove “Grade” from “Mid ROM · v2”?')
    expect(q.sentences[0]).toBe('Takes “Grade” out of “Mid ROM · v2”. Nothing is deleted: it stays in “High ROM · v3”, with everything on it, and comes back when you edit that version.')
    expect(q).toMatchObject({ confirm: 'Remove from this version', danger: false })
  })
  it('names the work on a removed row by count (constraint 4)', () => {
    const q = removalQuestion({ openVersion, rows: [row('Lighting pass 2', 'remove', ['High ROM · v3'], { loggedDays: 1.5, comments: 2, files: 0 })] })
    expect(q.sentences[1]).toBe('It has work on it, kept with it while it is out of sight: “Lighting pass 2” (1.5 days logged and 2 comments).')
    expect(removalNeedsAsking({ rows: [row('L', 'remove', ['v3'], { loggedDays: 1 })] })).toBe(true)
    // CONTROL: no work, or work on a row that is DELETED (its own question), is not this rule's.
    expect(removalNeedsAsking({ rows: [row('L', 'remove', ['v3'])] })).toBe(false)
  })
  it('mixed: says which go aside and which are deleted, and the button says both', () => {
    const q = removalQuestion({ openVersion, rows: [row('A', 'remove', ['v3']), row('B', 'remove', ['v1', 'v3']), row('C', 'delete')] })
    expect(q.title).toBe('Remove 2 tasks and delete 1 task?')
    // S5c: "Undo", not "Undo (Ctrl+Z)": the Tasks tab binds no Ctrl+Z; the toast is the way back everywhere.
    expect(q.sentences.at(-1)).toBe('“C” is in no other bid version, so it is deleted. Undo brings it back.')
    expect(q).toMatchObject({ confirm: 'Remove and delete', danger: true })
  })
})

// ── Post-overhaul S5c: the versions block's questions and toasts ───────────
// Her ruling (a)'s words — rows LEAVE the Timeline and COME BACK — and every
// question names its rows by count and by name, rows with work first. None
// says "Ctrl+Z": the Budget's Summary binds no undo keys, its undo toast is
// the way back.
const T = (id, title) => ({ id, title })
const P = (id, name) => ({ id, name })
const set = (tasks = [], phases = [], milestones = []) => ({ tasks, phases, milestones })
const W = (id, name, work, kind = 'tasks') => ({ kind, id, name, work })
const v = (id, name) => ({ id, name })

describe('someNames — the first few, then "and N more"', () => {
  it('names up to four, quoted, no serial comma; more are counted', () => {
    expect(someNames([T(1, 'A')])).toBe('“A”')
    expect(someNames([T(1, 'A'), P(2, 'B'), T(3, 'C')])).toBe('“A”, “B” and “C”')
    expect(someNames(['A', 'B', 'C', 'D', 'E', 'F'].map((n, i) => T(i, n)))).toBe('“A”, “B”, “C”, “D” and 2 more')
    // A row with no name is still a row.
    expect(someNames([T(1, '')])).toBe('“Untitled”')
  })
})

describe('unsavedQuestionWords — before Edit this version / Set budget active (F2, constraint 8)', () => {
  const mid = v('v2', 'Mid ROM')
  const high = v('v3', 'High ROM')
  it('the open version unsaved: Save to it / Discard changes; Discard says by count and name what it deletes, rows with work first', () => {
    const w = unsavedQuestionWords({
      mode: 'open', target: high,
      unsaved: { kind: 'open', version: mid, inNoVersion: set([T('a', 'Fog pass'), T('b', 'Rain pass')]), work: [W('b', 'Rain pass', { loggedDays: 1.5 })] },
    })
    expect(w.title).toBe('Save the changes to “Mid ROM” first?')
    expect(w.sentences[0]).toBe('“Mid ROM” has unsaved changes, and editing “High ROM” replaces what the Timeline and Budget show.')
    expect(w.sentences[1]).toBe('Discard changes leaves “Mid ROM” as it was last saved and deletes the 2 tasks no bid version holds: “Rain pass” and “Fog pass”. Undo brings them back.')
    expect(w.sentences[2]).toBe('“Rain pass” has work on it (1.5 days logged).')
    expect(w).toMatchObject({ discard: 'Discard changes', save: 'Save to “Mid ROM”' })
    expect(w.sentences.join(' ')).not.toMatch(/Ctrl/)
  })
  it('CONTROL: nothing in no version — Discard deletes nothing and says only that the version stays as saved', () => {
    const w = unsavedQuestionWords({ mode: 'open', target: high, unsaved: { kind: 'open', version: mid, inNoVersion: set(), work: [] } })
    expect(w.sentences).toEqual(['“Mid ROM” has unsaved changes, and editing “High ROM” replaces what the Timeline and Budget show.', 'Discard changes leaves “Mid ROM” as it was last saved.'])
  })
  it('no version open and the Timeline matches none: Save as new version… / Discard; key dates also say Recently deleted', () => {
    const w = unsavedQuestionWords({ mode: 'open', target: high, unsaved: { kind: 'none', version: null, inNoVersion: set([], [], [T('m', 'Premiere')]), work: [] } })
    expect(w.title).toBe('Save what the Timeline shows first?')
    expect(w.sentences[0]).toBe('What the Timeline and Budget show now is not saved in any bid version, and editing “High ROM” replaces it.')
    expect(w.sentences[1]).toBe('Discard deletes the 1 key date no bid version holds: “Premiere”. Undo brings it back. Deleted key dates are in Recently deleted as well.')
    expect(w).toMatchObject({ discard: 'Discard', save: 'Save as new version…' })
    expect(unsavedQuestionWords({ mode: 'open', target: high, unsaved: { kind: 'none', inNoVersion: set(), work: [] } }).sentences[1])
      .toBe('Discard lets the changes go; no row is deleted.')
  })
  it('Set budget active: the lock freezes a version AS SAVED — said for the open one and for another', () => {
    expect(unsavedQuestionWords({ mode: 'lock', target: mid, unsaved: { kind: 'open', version: mid, inNoVersion: set(), work: [] } }).sentences[0])
      .toBe('“Mid ROM” has unsaved changes, and setting it active locks it as it was last saved.')
    expect(unsavedQuestionWords({ mode: 'lock', target: high, unsaved: { kind: 'open', version: mid, inNoVersion: set(), work: [] } }).sentences[0])
      .toBe('“Mid ROM” has unsaved changes, and setting “High ROM” active locks that version as it was last saved.')
  })
})

describe('openQuestionWords — Edit this version (step 4; ruling (a); constraint 4)', () => {
  const high = v('v3', 'High ROM')
  const leaving = set([T('t1', 'Fog'), T('t2', 'Rain'), T('t3', 'Snow')], [P('p1', 'Weather')])
  const returning = set([T('t9', 'Sun')])
  it('names what leaves the Timeline and what comes back, by count and name, and that nothing on them is lost', () => {
    const w = openQuestionWords({ mode: 'open', preview: { version: high, leaving, returning }, work: [], read: { hasTimeline: true } })
    expect(w.title).toBe('Edit “High ROM”?')
    expect(w.sentences).toEqual([
      'Its phases, tasks, key dates, roles and rates replace what the Timeline and Budget show, and it becomes the open version: Save writes your changes back into it.',
      '3 tasks and 1 phase that are not part of it leave the Timeline: “Fog”, “Rain”, “Snow” and “Weather”; 1 task of its own comes back: “Sun”.',
      'Nothing on a row that leaves is lost: it comes back, with its comments, files and logged time, when you edit a version that holds it.',
    ])
    expect(w).toMatchObject({ verb: 'Edit this version', keepLabel: null })
  })
  it('work on a row that would leave: named first, with the one checkbox — "Keep them on the Timeline in <version>"', () => {
    const work = [W('t3', 'Snow', { loggedDays: 1.5, comments: 2 })]
    const w = openQuestionWords({ mode: 'open', preview: { version: high, leaving, returning: set() }, work, read: { hasTimeline: true } })
    expect(w.sentences[1]).toBe('3 tasks and 1 phase that are not part of it leave the Timeline: “Snow”, “Fog”, “Rain” and “Weather”.')
    expect(w.sentences.at(-1)).toBe('“Snow” has work on it (1.5 days logged and 2 comments).')
    expect(w.keepLabel).toBe('Keep it on the Timeline in “High ROM” (it becomes an unsaved change)')
    expect(openQuestionWords({ mode: 'open', preview: { version: high, leaving, returning: set() }, work: [work[0], W('p1', 'Weather', { comments: 1 }, 'phases')], read: { hasTimeline: true } }).keepLabel)
      .toBe('Keep them on the Timeline in “High ROM” (they become unsaved changes)')
  })
  it('CONTROL: nothing moves — only what the step does', () => {
    const w = openQuestionWords({ mode: 'open', preview: { version: high, leaving: set(), returning: set() }, work: [], read: { hasTimeline: true } })
    expect(w.sentences).toHaveLength(1)
  })
})

describe('openQuestionWords — Set budget active (F9; the lock freezes the bid AS SAVED)', () => {
  const mid = v('v2', 'Mid ROM')
  const prod = 'During production you keep editing the Timeline as usual, and Save as new version records those changes without touching the lock.'
  it('the open version, already on the Timeline', () => {
    const w = openQuestionWords({ mode: 'lock', preview: { version: mid, open: mid, leaving: set(), returning: set() }, work: [], read: { hasTimeline: true } })
    expect(w.title).toBe('Set “Mid ROM” active?')
    expect(w.sentences).toEqual(['“Mid ROM” becomes the budget in production: it is locked as it was saved, and the variance measures against it.', 'It is the open version, so the Timeline already shows it.', prod])
    expect(w.verb).toBe('Set budget active')
  })
  it('another version: its schedule first, with what leaves and comes back, the work and the checkbox before the production line', () => {
    const w = openQuestionWords({ mode: 'lock', preview: { version: mid, open: null, leaving: set([T('t1', 'Fog')]), returning: set() }, work: [W('t1', 'Fog', { files: 1 })], read: { hasTimeline: true } })
    expect(w.sentences[1]).toBe('The Timeline and Budget become its schedule first. 1 task that is not part of it leaves the Timeline: “Fog”.')
    expect(w.sentences.at(-2)).toBe('“Fog” has work on it (1 file).')
    expect(w.sentences.at(-1)).toBe(prod)
    expect(w.keepLabel).toBe('Keep it on the Timeline during production')
  })
  it('an old version (no timeline captured): it locks with the Timeline as it is', () => {
    const w = openQuestionWords({ mode: 'lock', preview: { version: mid, leaving: set(), returning: set() }, work: [], read: { hasTimeline: false } })
    expect(w.sentences[1]).toBe('It was saved before versions kept their schedule (no timeline captured), so the Timeline stays as it is.')
    expect(w.keepLabel).toBeNull()
  })
})

describe('deleteQuestionWords — a version\'s delete (constraint 10)', () => {
  const low = v('v1', 'Low ROM')
  it('the rows only it holds go with it — named, rows with work first — and Undo brings back the version and them', () => {
    const w = deleteQuestionWords({ preview: { version: low, only: set([T('a', 'Fog'), T('b', 'Rain')]), work: [W('b', 'Rain', { comments: 1 })] } })
    expect(w.title).toBe('Delete “Low ROM”?')
    expect(w.sentences).toEqual([
      'It is the only version that holds 2 tasks that are off the Timeline now: “Rain” and “Fog”. They are deleted with it.',
      '“Rain” has work on it (1 comment).',
      'Undo brings back the version and those rows.',
    ])
    expect(w.verb).toBe('Delete version')
  })
  it('CONTROL: nothing only it holds — the version alone; the open and the selected one say what follows', () => {
    expect(deleteQuestionWords({ preview: { version: low, only: set(), work: [] } }).sentences).toEqual(['Undo brings back the version.'])
    expect(deleteQuestionWords({ preview: { version: low, only: set(), work: [] }, isOpen: true, isSelected: true }).sentences).toEqual([
      'It is the open version: the Timeline keeps what it shows, and no version is open after this.',
      'It is the selected bid: no bid is selected after this, so the variance has nothing to measure against until you choose one.',
      'Undo brings back the version.',
    ])
  })
})

describe('Save as new version… and the toasts', () => {
  it('Save as new: opened and selected — or, under a lock, only recorded (F9)', () => {
    expect(saveAsNewWords()).toBe('Saves what the Timeline and Budget show now as a new bid version. It becomes the open version and the selected bid.')
    expect(saveAsNewWords({ locked: v('v2', 'Mid ROM') })).toBe('Records what the Timeline and Budget show now as a new bid version, so production changes are kept. It is not opened or selected: the budget stays locked to “Mid ROM”.')
  })
  it('each toast says what the step did', () => {
    expect(openedToastWords({ version: v('v1', 'Bid v1'), leaving: set([1, 2]), returning: set([3]) })).toBe('Editing “Bid v1”: 2 tasks left the Timeline, 1 task came back')
    expect(openedToastWords({ version: v('v1', 'Bid v1'), leaving: set(), returning: set() })).toBe('Editing “Bid v1”')
    expect(lockedToastWords(v('v2', 'Mid ROM'))).toBe('“Mid ROM” is the budget in production, locked as it was saved')
    expect(resetToastWords(v('v2', 'Mid ROM'))).toBe('Back to bidding: “Mid ROM” is no longer locked')
    expect(resetToastWords(null)).toBe('Back to bidding: the budget is no longer locked')
    expect(deletedToastWords({ version: v('v1', 'Bid v2'), only: set([1, 2, 3]) })).toBe('Deleted “Bid v2” and the 3 tasks only it held')
    expect(deletedToastWords({ version: v('v1', 'Bid v2'), only: set() })).toBe('Deleted “Bid v2”')
    expect(recordedToastWords({ name: 'Revision after week 2' })).toBe('Recorded “Revision after week 2”; the lock is unchanged')
  })
})
