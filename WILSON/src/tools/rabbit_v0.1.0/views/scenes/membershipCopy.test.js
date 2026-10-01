// =============================================================================
// The words of Remove from this list and Delete (post-overhaul S3b, step 6).
// Mounted, the same sentences are read from the rows, the cards, the bulk
// bars and a popup in rabbitScenesRender.test.jsx's "S3b step 6" blocks;
// here every branch on its own.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { joinNames, removeQuestion, deleteQuestion } from './membershipCopy'

describe('joinNames', () => {
  it('one, two, and more — no serial comma, as the app\'s lists are written', () => {
    expect(joinNames([])).toBe('')
    expect(joinNames(['A'])).toBe('A')
    expect(joinNames(['A', 'B'])).toBe('A and B')
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C')
  })
})

describe('removeQuestion: the rows leave ONE list, and nothing is deleted', () => {
  const L = 'Shoot · v1'
  it('one scene, with the shots that leave with it, still in another list', () => {
    expect(removeQuestion({ kind: 'scene', rows: [{ name: 'Lighthouse', homes: ['Pickups · v1', 'Night · v2'] }], shotCount: 2, listLabel: L })).toEqual([
      'Takes “Lighthouse” and its 2 shots out of “Shoot · v1”.',
      'Nothing is deleted: it stays in the project.',
      'It is still in “Pickups · v1” and “Night · v2”.',
    ])
  })
  it('one shot no other list holds: named as a shot, and where it will be found', () => {
    expect(removeQuestion({ kind: 'shot', rows: [{ name: 'The door', homes: [] }], listLabel: L })).toEqual([
      'Takes shot “The door” out of “Shoot · v1”.',
      'Nothing is deleted: it stays in the project.',
      'No other shot list holds it, so Shot lists… will show it under “Not in any list”.',
    ])
  })
  it('a scene with one shot, and one with none: "its 1 shot", and no count at all', () => {
    expect(removeQuestion({ kind: 'scene', rows: [{ name: 'A', homes: ['X'] }], shotCount: 1, listLabel: L })[0]).toBe('Takes “A” and its 1 shot out of “Shoot · v1”.')
    expect(removeQuestion({ kind: 'scene', rows: [{ name: 'A', homes: ['X'] }], shotCount: 0, listLabel: L })[0]).toBe('Takes “A” out of “Shoot · v1”.')
    // A shot never counts shots.
    expect(removeQuestion({ kind: 'shot', rows: [{ name: 'A', homes: ['X'] }], shotCount: 5, listLabel: L })[0]).toBe('Takes shot “A” out of “Shoot · v1”.')
  })
  it('several, each still somewhere else: the lists named once each', () => {
    expect(removeQuestion({ kind: 'shot', rows: [{ name: 'a', homes: ['P · v1'] }, { name: 'b', homes: ['P · v1', 'Q · v1'] }], listLabel: L })).toEqual([
      'Takes 2 shots out of “Shoot · v1”.',
      'Nothing is deleted: they stay in the project.',
      'Each is still in another shot list: “P · v1” and “Q · v1”.',
    ])
  })
  it('several, none held elsewhere', () => {
    expect(removeQuestion({ kind: 'scene', rows: [{ name: 'a', homes: [] }, { name: 'b', homes: [] }, { name: 'c', homes: [] }], shotCount: 4, listLabel: L })).toEqual([
      'Takes 3 scenes and their 4 shots out of “Shoot · v1”.',
      'Nothing is deleted: they stay in the project.',
      'No other shot list holds them, so Shot lists… will show them under “Not in any list”.',
    ])
  })
  it('several, some held elsewhere: how many will be in no list, and where the rest are', () => {
    expect(removeQuestion({ kind: 'shot', rows: [{ name: 'a', homes: [] }, { name: 'b', homes: ['P · v1'] }], listLabel: L }).slice(2)).toEqual([
      '1 of them is in no other shot list, so Shot lists… will show it under “Not in any list”.',
      'The other one is still in “P · v1”.',
    ])
    expect(removeQuestion({ kind: 'shot', rows: [{ name: 'a', homes: [] }, { name: 'b', homes: [] }, { name: 'c', homes: ['P · v1'] }, { name: 'd', homes: ['Q · v1'] }], listLabel: L }).slice(2)).toEqual([
      '2 of them are in no other shot list, so Shot lists… will show those under “Not in any list”.',
      'The rest are still in “P · v1” and “Q · v1”.',
    ])
  })
})

describe('deleteQuestion: from the project, and so from every list', () => {
  const lists = (...ls) => ls.map((l) => (typeof l === 'string' ? { label: l, archived: false } : l))
  it('one scene: every shot it has, the one list that holds it, and the other verb while a list is on screen', () => {
    expect(deleteQuestion({ kind: 'scene', names: ['Lighthouse'], shotCount: 3, lists: lists('Shoot · v1'), onScreen: 'Shoot · v1' })).toEqual([
      'This will permanently delete “Lighthouse” and its 3 shots from the project.',
      'It will be gone from “Shoot · v1” too.',
      'To take it out of “Shoot · v1” only, use “Remove from this list” in its shot-list menu.',
    ])
  })
  it('two lists are "both"; three or more are counted; an archived one says so', () => {
    expect(deleteQuestion({ kind: 'shot', names: ['The door'], lists: lists('P · v1', 'S · v1') })).toEqual([
      'This will permanently delete shot “The door” from the project.',
      'It will be gone from both shot lists that hold it: “P · v1” and “S · v1”.',
    ])
    expect(deleteQuestion({ kind: 'shot', names: ['The door'], lists: lists({ label: 'O · v1', archived: true }, 'P · v1', 'S · v1') })[1])
      .toBe('It will be gone from all 3 shot lists that hold it: “O · v1” (archived), “P · v1” and “S · v1”.')
    expect(deleteQuestion({ kind: 'shot', names: ['The door'], lists: lists({ label: 'O · v1', archived: true }) })[1])
      .toBe('It will be gone from “O · v1” (archived) too.')
  })
  it('in no list, and with no list on screen: the project alone', () => {
    expect(deleteQuestion({ kind: 'scene', names: ['Jetty'], shotCount: 0, lists: [] })).toEqual(['This will permanently delete “Jetty” from the project.'])
  })
  it('a selection: counted, "they", and the selection bar\'s verb', () => {
    expect(deleteQuestion({ kind: 'scene', names: ['a', 'b'], shotCount: 1, lists: lists('S · v1'), onScreen: 'S · v1', removeWhere: 'bar' })).toEqual([
      'This will permanently delete 2 scenes and their 1 shot from the project.',
      'They will be gone from “S · v1” too.',
      'To take them out of “S · v1” only, use “Remove from list” in the selection bar.',
    ])
    expect(deleteQuestion({ kind: 'shot', names: ['a', 'b', 'c'], lists: lists('P · v1', 'S · v1') })[1]).toBe('They will be gone from both shot lists that hold them: “P · v1” and “S · v1”.')
  })
})
