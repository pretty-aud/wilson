// =============================================================================
// taskItemsParity.test.js — FX2 (0096): the Local Server's copy of a task's
// items' rules (electron/rabbitTaskItems.cjs, CommonJS so a synchronous route
// can run it) and the one statement of them (state/taskItemsModel.js) answer
// the same cases the same way. A rule changed in one file and not the other
// fails here, before a project behaves differently on the desktop than in the
// cloud (A9: "the system to work the same").
//
// VW1m (2026-10-16): every rule both copies share is compared, and every case
// list carries a CONTROL: its inputs disagree on every rule but the one under
// test (positions, times, ids and the order the rows arrive in all point
// different ways), so a copy that kept a neighbouring rule (FX2's "replace the
// first", the array's order, a count for a position) answers differently and
// fails. Agreement on inputs where every rule agrees proves nothing (the FX2
// trap).
// =============================================================================

import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import * as esm from './taskItemsModel'

const require = createRequire(import.meta.url)
const cjs = require('../../../../electron/rabbitTaskItems.cjs')

const T = 'task-1'
const row = (id, kind, entity, position, created_at = '2026-10-11T10:00:00Z', task = T) =>
  ({ id, task_id: task, project_id: 'p', entity_type: kind, entity_id: entity, position, created_at })
// Each kind's rows arrive out of order, and within a kind the position, the
// time and the id each name a different first row.
const ITEMS = [
  row('a3', 'asset', 'A3', 2, '2026-10-11T09:00:00Z'), row('a2', 'asset', 'A2', 1, '2026-10-11T11:00:00Z'),
  row('a1', 'asset', 'A1', 0, '2026-10-11T12:00:00Z'), row('a0', 'asset', 'A0', 7, '2026-10-11T08:00:00Z'),
  row('s1', 'scene', 'S1', 0), row('s2', 'scene', 'S2', 0, '2026-10-11T09:00:00Z'),
  row('h1', 'shot', 'H1', 3), row('l1', 'level', 'L1', 0), row('x1', 'experience', 'X1', 1),
  row('o1', 'asset', 'AO', 0, undefined, 'task-2'),
  // Review round 2, R2-7: one millisecond, two microseconds.
  row('m1', 'asset', 'AM1', 5, '2026-10-12T06:17:56.123789+00:00'), row('m2', 'asset', 'AM2', 5, '2026-10-12T06:17:56.123456+00:00'),
]
// A fixed maker, so both sides mint the same row.
const maker = () => { let n = 0; return (base) => ({ id: `made-${++n}`, project_id: 'p', created_at: '2026-10-11T12:00:00Z', ...base }) }

// The rules both copies carry, by name. A rule added to the twin and not
// listed here fails the last test below.
const SHARED = [
  'ITEM_KINDS', 'KIND_FIELD', 'LINK_FIELDS', 'FIELD_KIND',
  'compareItems', 'itemsOfTask', 'copyFieldsFromItems', 'nextPosition',
  'planLegacyFieldWrite', 'seedItemsFor', 'itemShapeProblem',
]
// VW1m review round 1 (R1-8): the twin's own rules, which the model no
// longer states — an older build's reorder, answered by the desktop's route
// (rabbitTaskItems.routes.test.js) and nothing in this app since its Move
// buttons went (her Q-N1).
const TWIN_OWN = ['planReorder', 'applyPositions']

// F9 (B1): the copy is no longer kept by hand. Every rule both carry is the
// generated module's own (electron/rules/taskItems.cjs, esbuild's bundle of
// taskItemsModel.js), and src/lib/electronRules.test.js fails while it is
// stale — the one check in place of this file's pairwise comparisons, which ran
// unedited on the generated copy before they were retired. What stays: the
// CONTROLs (the model's rules, stated absolutely), the twin's export list, and
// the twin's own reorder below.
describe('the CommonJS copy says what the model says', () => {
  it('F9: each rule both carry IS the generated module\'s, the very function', () => {
    const gen = require('../../../../electron/rules/taskItems.cjs')
    for (const name of SHARED) expect(cjs[name], name).toBe(gen[name])
  })
  it('review round 1: the refusals the desktop\'s route sends a client, word for word', () => {
    expect(cjs.itemShapeProblem(null)).toBe('an item needs a task, a kind and an entity')
    expect(cjs.itemShapeProblem({ task_id: T, entity_type: 'phase', entity_id: 'x' })).toBe('phase is not a kind of item (asset, scene, shot, level, experience)')
    expect(cjs.itemShapeProblem({ task_id: T, entity_type: 'asset', entity_id: 'x', position: -1 })).toBe('an item\'s position is a whole number from 0 to 2147483647')
    expect(cjs.itemShapeProblem({ task_id: T, entity_type: 'asset', entity_id: 'x', created_at: 'soon' })).toBe('an item\'s created_at is a date')
    expect(cjs.itemShapeProblem({ task_id: T, entity_type: 'asset', entity_id: 'x' })).toBeNull()
  })
  it('CONTROL: the pairs tell position-first from time-first and from id-first', () => {
    const byTime = (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)
    const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    const differs = (cmp) => ITEMS.some(a => ITEMS.some(b => Math.sign(cmp(a, b)) !== Math.sign(esm.compareItems(a, b))))
    expect(differs(byTime)).toBe(true)
    expect(differs(byId)).toBe(true)
  })

  it('CONTROL: the copy is the first in the STORED order, not the first to arrive, the oldest or the lowest id', () => {
    const assets = ITEMS.filter(i => i.task_id === T && i.entity_type === 'asset')
    const copy = esm.copyFieldsFromItems(assets).asset_id
    expect(copy).toBe('A1')
    expect(assets[0].entity_id).not.toBe(copy) // arrival
    expect(assets.slice().sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0].entity_id).not.toBe(copy) // oldest
    expect(assets.slice().sort((a, b) => (a.id < b.id ? -1 : 1))[0].entity_id).not.toBe(copy) // lowest id
  })

  it('CONTROL: the next position is after the highest, not the count and not after the last to arrive', () => {
    const assets = ITEMS.filter(i => i.task_id === T && i.entity_type === 'asset')
    const next = esm.nextPosition(ITEMS, T, 'asset')
    expect(next).toBe(8)
    expect(assets.length).not.toBe(next)
    expect(assets[assets.length - 1].position + 1).not.toBe(next)
  })

  it('CONTROL: the cases tell add-only from FX2\'s replace-the-first and move-first', () => {
    // A new value over A1: FX2 removed A1 and put the new one first (position 0).
    const add = esm.planLegacyFieldWrite(ITEMS, T, 'asset', 'A9', 'A1', maker())
    expect(add.remove).toEqual([])
    expect(add.insert.position).toBe(8)
    // A value the task has (A2 over A1): FX2 moved it first; now nothing.
    expect(esm.planLegacyFieldWrite(ITEMS, T, 'asset', 'A2', 'A1', maker())).toEqual({ remove: [], insert: null })
    // Cleared over A2: only A2 goes, though A1 is the first.
    expect(esm.planLegacyFieldWrite(ITEMS, T, 'asset', null, 'A2', maker()).remove.map(i => i.id)).toEqual(['a2'])
  })

  it('CONTROL: a seed checks the task\'s own items, not another task\'s', () => {
    // task-2 has AO, not A1: an A1 seed is due though task-1 has A1.
    expect(esm.seedItemsFor({ id: 'task-2', asset_id: 'A1' }, ITEMS, maker()).map(i => i.entity_id)).toEqual(['A1'])
  })

  it('every rule the twin carries is one the model states, and the rules that picked one item are gone from both', () => {
    for (const name of SHARED) {
      expect(cjs, name).toHaveProperty(name)
      expect(esm, name).toHaveProperty(name)
    }
    const bundleLevel = ['stableItemId', 'syncTaskFields', 'pruneDanglingTaskItems', 'reconcileTaskItemsOnRead',
      'applyTaskWrite', 'afterRowRemoved', 'makeTaskItemHooks', 'mountRabbitTaskItems']
    expect(Object.keys(cjs).filter(k => !SHARED.includes(k) && !bundleLevel.includes(k) && !TWIN_OWN.includes(k))).toEqual([])
    for (const gone of ['mainItemOf', 'linkFieldsFromItems', 'planSingleFieldWrite', 'mainAfterLinkWrite']) {
      expect(cjs, gone).not.toHaveProperty(gone)
      expect(esm, gone).not.toHaveProperty(gone)
    }
  })
  it('R1-8: the reorder is the twin\'s own: the model no longer states it, the twin still does', () => {
    for (const own of TWIN_OWN) {
      expect(cjs, own).toHaveProperty(own)
      expect(esm, own).not.toHaveProperty(own)
    }
  })
})

// VW1m review round 1 (R1-8): the twin's own reorder (0096 section 6's
// reorder_task_items, for an older build), held here now the model has none.
describe('the twin\'s planReorder: an older build\'s reorder only', () => {
  const items = [row('a', 'asset', 'A', 0), row('b', 'asset', 'B', 1), row('c', 'asset', 'C', 2), row('s', 'scene', 'S', 0)]
  it('puts the named ids first, in the order given, and the rest after in their order, dense from 0', () => {
    const changes = cjs.planReorder(items, T, 'asset', ['c'])
    expect(cjs.applyPositions(items, changes).filter(i => i.entity_type === 'asset').sort(cjs.compareItems).map(i => `${i.id}:${i.position}`))
      .toEqual(['c:0', 'a:1', 'b:2'])
  })
  it('answers only the rows that move', () => {
    expect(cjs.planReorder(items, T, 'asset', ['a', 'b', 'c'])).toEqual([])
    expect(cjs.planReorder(items, T, 'asset', ['b', 'a'])).toEqual([{ id: 'b', position: 0 }, { id: 'a', position: 1 }])
  })
  it('ignores an id of another kind or task, and never touches another kind', () => {
    const changes = cjs.planReorder(items, T, 'asset', ['s', 'b'])
    expect(changes.find(c => c.id === 's')).toBeUndefined()
    expect(changes[0]).toEqual({ id: 'b', position: 0 })
  })
  it('makes a tie dense; no change applied hands back the same list', () => {
    const tied = [row('x', 'asset', 'X', 0, '2026-10-11T10:00:00Z'), row('y', 'asset', 'Y', 0, '2026-10-11T11:00:00Z')]
    expect(cjs.planReorder(tied, T, 'asset', [])).toEqual([{ id: 'y', position: 1 }])
    expect(cjs.applyPositions(ITEMS, [])).toBe(ITEMS)
  })
})
