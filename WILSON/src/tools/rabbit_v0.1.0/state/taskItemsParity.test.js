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

describe('the CommonJS copy says what the model says', () => {
  it('the same kinds and fields', () => {
    expect([...cjs.ITEM_KINDS]).toEqual([...esm.ITEM_KINDS])
    expect({ ...cjs.KIND_FIELD }).toEqual({ ...esm.KIND_FIELD })
    expect([...cjs.LINK_FIELDS]).toEqual([...esm.LINK_FIELDS])
    expect({ ...cjs.FIELD_KIND }).toEqual({ ...esm.FIELD_KIND })
  })

  it('the same order, every pair', () => {
    for (const a of ITEMS) for (const b of ITEMS) {
      expect(Math.sign(cjs.compareItems(a, b)), `${a.id} vs ${b.id}`).toBe(Math.sign(esm.compareItems(a, b)))
    }
  })
  it('CONTROL: the pairs tell position-first from time-first and from id-first', () => {
    const byTime = (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)
    const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    const differs = (cmp) => ITEMS.some(a => ITEMS.some(b => Math.sign(cmp(a, b)) !== Math.sign(esm.compareItems(a, b))))
    expect(differs(byTime)).toBe(true)
    expect(differs(byId)).toBe(true)
  })

  it('the same items of a task, kind by kind', () => {
    for (const kind of [null, ...esm.ITEM_KINDS]) {
      expect(cjs.itemsOfTask(ITEMS, T, kind).map(i => i.id), String(kind)).toEqual(esm.itemsOfTask(ITEMS, T, kind).map(i => i.id))
    }
  })

  it('the same older apps\' copy, for the task and for each kind alone', () => {
    expect(cjs.copyFieldsFromItems(ITEMS.filter(i => i.task_id === T))).toEqual(esm.copyFieldsFromItems(ITEMS.filter(i => i.task_id === T)))
    for (const kind of esm.ITEM_KINDS) {
      const only = ITEMS.filter(i => i.task_id === T && i.entity_type === kind)
      expect(cjs.copyFieldsFromItems(only), kind).toEqual(esm.copyFieldsFromItems(only))
    }
    expect(cjs.copyFieldsFromItems(undefined)).toEqual(esm.copyFieldsFromItems(undefined))
  })
  it('CONTROL: the copy is the first in the STORED order, not the first to arrive, the oldest or the lowest id', () => {
    const assets = ITEMS.filter(i => i.task_id === T && i.entity_type === 'asset')
    const copy = esm.copyFieldsFromItems(assets).asset_id
    expect(copy).toBe('A1')
    expect(assets[0].entity_id).not.toBe(copy) // arrival
    expect(assets.slice().sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0].entity_id).not.toBe(copy) // oldest
    expect(assets.slice().sort((a, b) => (a.id < b.id ? -1 : 1))[0].entity_id).not.toBe(copy) // lowest id
  })

  it('the same next position for every kind and task', () => {
    for (const task of [T, 'task-2', 'nobody']) for (const kind of esm.ITEM_KINDS) {
      expect(cjs.nextPosition(ITEMS, task, kind), `${task} ${kind}`).toBe(esm.nextPosition(ITEMS, task, kind))
    }
    expect(cjs.nextPosition([row('z', 'asset', 'Z', 2147483647)], T, 'asset')).toBe(esm.nextPosition([row('z', 'asset', 'Z', 2147483647)], T, 'asset'))
  })
  it('CONTROL: the next position is after the highest, not the count and not after the last to arrive', () => {
    const assets = ITEMS.filter(i => i.task_id === T && i.entity_type === 'asset')
    const next = esm.nextPosition(ITEMS, T, 'asset')
    expect(next).toBe(8)
    expect(assets.length).not.toBe(next)
    expect(assets[assets.length - 1].position + 1).not.toBe(next)
  })

  it('the same older app\'s write of one field for every kind: no-op, has it, add, clear, first item, unknown kind', () => {
    const cases = [
      ['asset', 'A1', 'A1'], ['asset', 'A2', 'A1'], ['asset', 'A9', 'A1'], ['asset', 'A9', null], ['asset', null, 'A2'],
      ['asset', '', 'A9'], ['asset', null, null], ['scene', 'S1', 'S2'], ['scene', 'S7', null], ['shot', null, 'H1'],
      ['shot', 'H9', 'H1'], ['level', 'L2', 'L1'], ['experience', 'X1', null], ['phase', 'P', null],
    ]
    for (const [kind, value, previous] of cases) {
      const a = cjs.planLegacyFieldWrite(ITEMS, T, kind, value, previous, maker())
      const b = esm.planLegacyFieldWrite(ITEMS, T, kind, value, previous, maker())
      expect({ remove: a.remove.map(i => i.id), insert: a.insert }, `${kind} ${value} over ${previous}`)
        .toEqual({ remove: b.remove.map(i => i.id), insert: b.insert })
      expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort())
    }
    expect(cjs.planLegacyFieldWrite(ITEMS, null, 'asset', 'A9', null, maker())).toEqual(esm.planLegacyFieldWrite(ITEMS, null, 'asset', 'A9', null, maker()))
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

  it('the same seeds from a task\'s own fields, all five or the cloud\'s three', () => {
    const tasks = [
      { id: T, asset_id: 'A1', scene_id: 'S9', shot_id: '', level_id: 'L1', experience_id: 'X9' },
      { id: 'task-2', asset_id: 'A1', scene_id: null }, { id: null, asset_id: 'A1' }, null,
    ]
    for (const t of tasks) {
      expect(cjs.seedItemsFor(t, ITEMS, maker()), JSON.stringify(t)).toEqual(esm.seedItemsFor(t, ITEMS, maker()))
      expect(cjs.seedItemsFor(t, ITEMS, maker(), ['asset_id', 'scene_id', 'shot_id'])).toEqual(esm.seedItemsFor(t, ITEMS, maker(), ['asset_id', 'scene_id', 'shot_id']))
    }
  })
  it('CONTROL: a seed checks the task\'s own items, not another task\'s', () => {
    // task-2 has AO, not A1: an A1 seed is due though task-1 has A1.
    expect(esm.seedItemsFor({ id: 'task-2', asset_id: 'A1' }, ITEMS, maker()).map(i => i.entity_id)).toEqual(['A1'])
  })

  it('the same refusals, word for word', () => {
    const shapes = [
      null, {}, { task_id: T }, { task_id: T, entity_type: 'phase', entity_id: 'x' },
      { task_id: T, entity_type: 'asset' }, { task_id: T, entity_type: 'asset', entity_id: 'x', position: -1 },
      { task_id: T, entity_type: 'asset', entity_id: 'x', position: 2.5 }, { task_id: T, entity_type: 'shot', entity_id: 'x', position: 3 },
      // Review round 1, R1-4.
      { task_id: T, entity_type: 'asset', entity_id: ['x'] }, { task_id: 7, entity_type: 'asset', entity_id: 'x' },
      { id: {}, task_id: T, entity_type: 'asset', entity_id: 'x' }, { task_id: T, entity_type: 'asset', entity_id: 'x', position: 1e300 },
      { task_id: T, entity_type: 'asset', entity_id: 'x', created_at: {} }, { task_id: T, entity_type: 'asset', entity_id: 'x', created_at: 'soon' },
      { task_id: T, entity_type: 'asset', entity_id: 'x', created_at: '2026-10-11T00:00:00Z', position: 2147483647 },
    ]
    for (const s of shapes) expect(cjs.itemShapeProblem(s), JSON.stringify(s)).toEqual(esm.itemShapeProblem(s))
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
