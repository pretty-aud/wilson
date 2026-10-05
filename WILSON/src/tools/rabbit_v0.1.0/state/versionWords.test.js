// =============================================================================
// versionWords.test.js — the words of bid versions (post-overhaul S5b). Each
// sentence names what it does and where rows go; each case has a control.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { joinNames, rowsWords, removalToastWords, removalQuestion, removalNeedsAsking } from './versionWords'

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
    expect(q.sentences.at(-1)).toBe('“C” is in no other bid version, so it is deleted. Undo (Ctrl+Z) brings it back.')
    expect(q).toMatchObject({ confirm: 'Remove and delete', danger: true })
  })
})
