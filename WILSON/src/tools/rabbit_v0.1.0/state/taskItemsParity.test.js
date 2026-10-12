// =============================================================================
// taskItemsParity.test.js — FX2 (0096): the Local Server's copy of a task's
// items' rules (electron/rabbitTaskItems.cjs, CommonJS so a synchronous route
// can run it) and the one statement of them (state/taskItemsModel.js) answer
// the same cases the same way. A rule changed in one file and not the other
// fails here, before a project behaves differently on the desktop than in the
// cloud (A9: "the system to work the same").
// =============================================================================

import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import * as esm from './taskItemsModel'

const require = createRequire(import.meta.url)
const cjs = require('../../../../electron/rabbitTaskItems.cjs')

const T = 'task-1'
const row = (id, kind, entity, position, created_at = '2026-10-11T10:00:00Z', task = T) =>
  ({ id, task_id: task, project_id: 'p', entity_type: kind, entity_id: entity, position, created_at })
const ITEMS = [
  row('a1', 'asset', 'A1', 0), row('a2', 'asset', 'A2', 1), row('a3', 'asset', 'A3', 2, '2026-10-11T09:00:00Z'),
  row('s1', 'scene', 'S1', 0), row('s2', 'scene', 'S2', 0, '2026-10-11T09:00:00Z'),
  row('h1', 'shot', 'H1', 3), row('l1', 'level', 'L1', 0), row('x1', 'experience', 'X1', 1),
  row('o1', 'asset', 'AO', 0, undefined, 'task-2'),
]
// A fixed maker, so both sides mint the same row.
const maker = () => { let n = 0; return (base) => ({ id: `made-${++n}`, project_id: 'p', created_at: '2026-10-11T12:00:00Z', ...base }) }

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

  it('the same items of a task, kind by kind, and the same main items', () => {
    for (const kind of [null, ...esm.ITEM_KINDS]) {
      expect(cjs.itemsOfTask(ITEMS, T, kind).map(i => i.id), String(kind)).toEqual(esm.itemsOfTask(ITEMS, T, kind).map(i => i.id))
    }
    for (const kind of esm.ITEM_KINDS) {
      expect(cjs.mainItemOf(ITEMS, T, kind)?.id ?? null, kind).toEqual(esm.mainItemOf(ITEMS, T, kind)?.id ?? null)
    }
    expect(cjs.linkFieldsFromItems(cjs.itemsOfTask(ITEMS, T))).toEqual(esm.linkFieldsFromItems(esm.itemsOfTask(ITEMS, T)))
  })

  it('the same reorder for every kind and a spread of named lists', () => {
    const lists = [[], ['a3'], ['a2', 'a1'], ['a3', 'a2', 'a1'], ['s2'], ['h1'], ['nope', 'a2'], ['s1', 'a1']]
    for (const kind of esm.ITEM_KINDS) for (const ids of lists) {
      expect(cjs.planReorder(ITEMS, T, kind, ids), `${kind} ${ids}`).toEqual(esm.planReorder(ITEMS, T, kind, ids))
    }
  })

  it('the same single-field write for every kind: no-op, move, replace, clear, first item', () => {
    const cases = [
      ['asset', 'A1', 'A1'], ['asset', 'A2', 'A1'], ['asset', 'A9', 'A1'], ['asset', null, 'A1'], ['asset', '', 'A9'],
      ['scene', 'S1', 'S2'], ['scene', 'S7', null], ['shot', null, 'H1'], ['level', 'L2', 'L1'], ['experience', 'X1', null],
      ['phase', 'P', null],
    ]
    for (const [kind, value, previous] of cases) {
      const a = cjs.planSingleFieldWrite(ITEMS, T, kind, value, previous, maker())
      const b = esm.planSingleFieldWrite(ITEMS, T, kind, value, previous, maker())
      expect({ remove: a.remove.map(i => i.id), insert: a.insert, order: a.order }, `${kind} ${value} over ${previous}`)
        .toEqual({ remove: b.remove.map(i => i.id), insert: b.insert, order: b.order })
    }
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
})
