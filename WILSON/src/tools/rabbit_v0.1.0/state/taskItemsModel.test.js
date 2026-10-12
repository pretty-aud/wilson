// =============================================================================
// taskItemsModel.test.js — FX2 (migration 0096, 2026-10-11): the one
// statement of a task's items' rules, which the provider runs before the
// echo, the fixtures run as the fake cloud, and electron/rabbitTaskItems.cjs
// copies (taskItemsParity.test.js holds the copy to this file).
// =============================================================================

import { describe, it, expect } from 'vitest'
import {
  ITEM_KINDS, KIND_FIELD, LINK_FIELDS, FIELD_KIND, COLUMN_KINDS,
  compareItems, itemsOfTask, mainItemOf, linkFieldsFromItems, withItemLinks,
  tasksAbout, taskCountsByEntity, nextPosition, planReorder, applyPositions,
  planSingleFieldWrite, seedItemsFor, linkFieldsIn, withoutLinkFields, itemShapeProblem,
  indexItemsByTask, linksInStep, tasksWithChangedItems, mainAfterLinkWrite,
} from './taskItemsModel'

const T = 'task-1'
const it_ = (id, kind, entity, position, created_at = '2026-10-11T10:00:00Z', task = T) =>
  ({ id, task_id: task, project_id: 'p', entity_type: kind, entity_id: entity, position, created_at })
let n = 0
const make = (base) => ({ id: `new-${++n}`, project_id: 'p', created_at: '2026-10-11T12:00:00Z', ...base })

describe('the five kinds and their fields', () => {
  it('names five kinds, each with its single field, and the cloud keeps three as columns', () => {
    expect(ITEM_KINDS).toEqual(['asset', 'scene', 'shot', 'level', 'experience'])
    expect(LINK_FIELDS).toEqual(['asset_id', 'scene_id', 'shot_id', 'level_id', 'experience_id'])
    for (const k of ITEM_KINDS) expect(FIELD_KIND[KIND_FIELD[k]]).toBe(k)
    expect(COLUMN_KINDS).toEqual(['asset', 'scene', 'shot'])
  })
})

describe("0096's order: position, then created_at, then id", () => {
  it('sorts by position first', () => {
    expect([it_('b', 'asset', 'x', 1), it_('a', 'asset', 'y', 0)].sort(compareItems).map(i => i.id)).toEqual(['a', 'b'])
  })
  it('breaks a position tie by created_at, across the two spellings of a time', () => {
    const older = it_('z', 'asset', 'x', 0, '2026-10-11T10:00:00.000+00:00')
    const newer = it_('a', 'asset', 'y', 0, '2026-10-11T10:00:01Z')
    expect([newer, older].sort(compareItems).map(i => i.id)).toEqual(['z', 'a'])
  })
  it('breaks a full tie by id, in code-unit order (Postgres orders uuids byte-wise)', () => {
    expect([it_('b', 'asset', 'x', 0), it_('a', 'asset', 'y', 0)].sort(compareItems).map(i => i.id)).toEqual(['a', 'b'])
    // Review round 2, R2-7: the database orders created_at to the
    // microsecond; two items made in one millisecond keep its order here.
    const early = it_('z', 'asset', 'x', 0, '2026-10-12T06:17:56.123456+00:00')
    const late = it_('a', 'asset', 'y', 0, '2026-10-12T06:17:56.123789+00:00')
    expect([late, early].sort(compareItems).map(i => i.id)).toEqual(['z', 'a'])
  })
})

describe('a task\'s items and its main item of each kind', () => {
  const items = [
    it_('s2', 'scene', 'S2', 1), it_('a2', 'asset', 'A2', 1), it_('a1', 'asset', 'A1', 0),
    it_('s1', 'scene', 'S1', 0), it_('l1', 'level', 'L1', 0), it_('other', 'asset', 'AX', 0, undefined, 'task-2'),
  ]
  it('lists a task\'s items, kinds in order, each kind in 0096\'s order; another task\'s are not its', () => {
    expect(itemsOfTask(items, T).map(i => i.id)).toEqual(['a1', 'a2', 's1', 's2', 'l1'])
    expect(itemsOfTask(items, T, 'scene').map(i => i.id)).toEqual(['s1', 's2'])
    expect(itemsOfTask(items, null)).toEqual([])
  })
  it('the main item of a kind is the first; none is null', () => {
    expect(mainItemOf(items, T, 'asset').entity_id).toBe('A1')
    expect(mainItemOf(items, T, 'shot')).toBeNull()
  })
  it('reads the five single fields from the main items', () => {
    expect(linkFieldsFromItems(itemsOfTask(items, T))).toEqual({
      asset_id: 'A1', scene_id: 'S1', shot_id: null, level_id: 'L1', experience_id: null,
    })
  })
  it('indexes the items by task, each list sorted', () => {
    const byTask = indexItemsByTask(items)
    expect(byTask.get(T).map(i => i.id)).toEqual(['a1', 'a2', 's1', 's2', 'l1'])
    expect(byTask.get('task-2').map(i => i.id)).toEqual(['other'])
  })
})

describe('withItemLinks — what ctx.tasks shows', () => {
  const tasks = [
    { id: T, title: 'One', asset_id: 'STALE', scene_id: null, shot_id: null },
    { id: 'task-2', title: 'Two', asset_id: 'AX', scene_id: null, shot_id: null, level_id: null, experience_id: null },
  ]
  const items = [it_('a1', 'asset', 'A1', 0), it_('l1', 'level', 'L1', 0), it_('other', 'asset', 'AX', 0, undefined, 'task-2')]
  it('sets each task\'s five fields from its items, the level and experience included (the cloud has no column for them)', () => {
    const out = withItemLinks(tasks, items, true)
    expect(out[0]).toMatchObject({ id: T, title: 'One', asset_id: 'A1', level_id: 'L1', experience_id: null })
  })
  it('hands back the SAME task object where the fields already agree, and the same array when none moved', () => {
    const out = withItemLinks(tasks, items, true)
    expect(out[1]).toBe(tasks[1])
    const settled = withItemLinks(out, items, true)
    expect(settled).toBe(out)
  })
  it('with no items on the backend (available false), the stored fields are the truth, untouched', () => {
    expect(withItemLinks(tasks, items, false)).toBe(tasks)
  })
  it('a task with no item of a kind reads null for that kind — never the stale stored value', () => {
    expect(withItemLinks([{ id: 'lonely', asset_id: 'A9' }], [], true)[0].asset_id).toBeNull()
  })
})

// Review round 2, R2-1 and R2-3: the provider's bundle rule and the gone-row
// rule, pure.
describe('linksInStep — only the tasks whose items changed read their links from them', () => {
  const a1 = it_('a1', 'asset', 'A1', 0)
  const a2 = it_('a2', 'asset', 'A2', 1)
  const prev = { tasks: [{ id: T, asset_id: 'A1' }, { id: 'back', asset_id: 'AB', scene_id: 'SB' }], taskItems: [a1, a2] }
  it('a task brought back with no items read keeps its row\'s links', () => {
    const next = { ...prev, tasks: [...prev.tasks, { id: 'new', asset_id: 'AN' }] }
    expect(linksInStep(prev, next, true)).toBe(next)
  })
  it('a task whose items changed reads them (a removed main hands over; the last removed reads null)', () => {
    const once = linksInStep(prev, { ...prev, taskItems: [a2] }, true)
    expect(once.tasks[0].asset_id).toBe('A2')
    expect(once.tasks[1]).toBe(prev.tasks[1])
    const twice = linksInStep(once, { ...once, taskItems: [] }, true)
    expect(twice.tasks[0].asset_id).toBeNull()
  })
  it('without items on the backend, nothing is touched', () => {
    const next = { ...prev, taskItems: [] }
    expect(linksInStep(prev, next, false)).toBe(next)
  })
  it('tasksWithChangedItems names the tasks of rows added, removed and replaced', () => {
    const b2 = { ...a2, position: 0 }
    expect([...tasksWithChangedItems([a1, a2], [a1, b2, it_('x', 'scene', 'S', 0, undefined, 'other')])].sort()).toEqual(['other', T])
    expect([...tasksWithChangedItems([a1, a2], [a1, a2])]).toEqual([])
  })
})

describe('mainAfterLinkWrite — the row a single-field write leaves as main', () => {
  const items = [it_('a1', 'asset', 'A1', 0), it_('a2', 'asset', 'A2', 1)]
  it('a value is the main; a clear hands main to the next, or to none', () => {
    expect(mainAfterLinkWrite(items, T, 'asset', 'A9')).toBe('A9')
    expect(mainAfterLinkWrite(items, T, 'asset', null)).toBe('A2')
    expect(mainAfterLinkWrite(items.slice(0, 1), T, 'asset', '')).toBeNull()
    expect(mainAfterLinkWrite(items, T, 'scene', null)).toBeNull()
  })
})

describe('tasksAbout and taskCountsByEntity — the relation readers', () => {
  const tasks = [{ id: 'a', scene_id: 'S1' }, { id: 'b', scene_id: 'S2' }, { id: 'c', scene_id: null }]
  const items = [
    it_('i1', 'scene', 'S1', 0, undefined, 'a'), it_('i2', 'scene', 'S2', 1, undefined, 'a'),
    it_('i3', 'scene', 'S2', 0, undefined, 'b'), it_('i4', 'scene', 'S2', 0, undefined, 'gone-task'),
  ]
  it('lists every task that names the thing, main or not', () => {
    expect(tasksAbout(tasks, items, 'scene', 'S2', true).map(t => t.id)).toEqual(['a', 'b'])
  })
  it('without items, the single field decides, as before 0096', () => {
    expect(tasksAbout(tasks, items, 'scene', 'S2', false).map(t => t.id)).toEqual(['b'])
  })
  it('refuses an unknown kind or no id quietly', () => {
    expect(tasksAbout(tasks, items, 'phase', 'S2', true)).toEqual([])
    expect(tasksAbout(tasks, items, 'scene', null, true)).toEqual([])
  })
  it('counts a task once per thing it names, and only tasks that are on the screen', () => {
    expect(taskCountsByEntity(tasks, items, 'scene', true)).toEqual({ S1: 1, S2: 2 })
    expect(taskCountsByEntity(tasks, items, 'scene', false)).toEqual({ S1: 1, S2: 1 })
  })
})

describe('planReorder — reorder_task_items (0096 §6)', () => {
  const items = [it_('a', 'asset', 'A', 0), it_('b', 'asset', 'B', 1), it_('c', 'asset', 'C', 2), it_('s', 'scene', 'S', 0)]
  it('puts the named ids first, in the order given, and the rest after in their order, dense from 0', () => {
    const changes = planReorder(items, T, 'asset', ['c'])
    expect(applyPositions(items, changes).filter(i => i.entity_type === 'asset').sort(compareItems).map(i => `${i.id}:${i.position}`))
      .toEqual(['c:0', 'a:1', 'b:2'])
  })
  it('answers only the rows that move', () => {
    expect(planReorder(items, T, 'asset', ['a', 'b', 'c'])).toEqual([])
    expect(planReorder(items, T, 'asset', ['b', 'a'])).toEqual([{ id: 'b', position: 0 }, { id: 'a', position: 1 }])
  })
  it('ignores an id of another kind or task, and never touches another kind', () => {
    const changes = planReorder(items, T, 'asset', ['s', 'b'])
    expect(changes.find(c => c.id === 's')).toBeUndefined()
    expect(changes[0]).toEqual({ id: 'b', position: 0 })
  })
  it('makes a tie dense', () => {
    const tied = [it_('x', 'asset', 'X', 0, '2026-10-11T10:00:00Z'), it_('y', 'asset', 'Y', 0, '2026-10-11T11:00:00Z')]
    expect(planReorder(tied, T, 'asset', [])).toEqual([{ id: 'y', position: 1 }])
  })
})

describe('planSingleFieldWrite — 0096 §7b, what writing a single field does', () => {
  const items = [it_('a1', 'asset', 'A1', 0), it_('a2', 'asset', 'A2', 1)]
  it('the main item already: nothing', () => {
    expect(planSingleFieldWrite(items, T, 'asset', 'A1', 'A1', make)).toEqual({ remove: [], insert: null, order: null })
  })
  it('another item of the task: it MOVES first and nothing is removed (a bid version\'s open)', () => {
    const plan = planSingleFieldWrite(items, T, 'asset', 'A2', 'A1', make)
    expect(plan.remove).toEqual([])
    expect(plan.insert).toBeNull()
    expect(plan.order).toEqual(['a2', 'a1'])
  })
  it('a new id: it REPLACES the item it was written over, first', () => {
    const plan = planSingleFieldWrite(items, T, 'asset', 'A3', 'A1', make)
    expect(plan.remove.map(i => i.id)).toEqual(['a1'])
    expect(plan.insert).toMatchObject({ task_id: T, entity_type: 'asset', entity_id: 'A3', position: 0 })
    expect(plan.order).toEqual([plan.insert.id, 'a2'])
  })
  it('cleared: the item for the value cleared goes, and nothing else (the next becomes main)', () => {
    const plan = planSingleFieldWrite(items, T, 'asset', null, 'A1', make)
    expect(plan.remove.map(i => i.id)).toEqual(['a1'])
    expect(plan.insert).toBeNull()
  })
  it('cleared when the cleared value is already gone (a scene\'s cascade ran first): nothing goes', () => {
    expect(planSingleFieldWrite(items, T, 'asset', '', 'A9', make).remove).toEqual([])
  })
  it('a first item on a task with none of that kind: inserted, first', () => {
    const plan = planSingleFieldWrite(items, T, 'scene', 'S1', null, make)
    expect(plan.insert).toMatchObject({ entity_type: 'scene', entity_id: 'S1', position: 0 })
    expect(plan.remove).toEqual([])
  })
  it('an unknown kind changes nothing', () => {
    expect(planSingleFieldWrite(items, T, 'phase', 'P', null, make)).toEqual({ remove: [], insert: null, order: null })
  })
})

describe('seedItemsFor — 0096 §7c and the backfill', () => {
  it('makes one item per set field the task does not already have, at position 0', () => {
    const seeded = seedItemsFor({ id: T, asset_id: 'A1', scene_id: 'S1', shot_id: null }, [it_('a1', 'asset', 'A1', 0)], make)
    expect(seeded.map(i => `${i.entity_type}:${i.entity_id}:${i.position}`)).toEqual(['scene:S1:0'])
  })
  it('reads only the fields asked for (the cloud\'s three)', () => {
    const seeded = seedItemsFor({ id: T, asset_id: 'A1', level_id: 'L1' }, [], make, ['asset_id', 'scene_id', 'shot_id'])
    expect(seeded.map(i => i.entity_type)).toEqual(['asset'])
  })
})

describe('the patch helpers and the shape check', () => {
  it('splits a patch into its single links and the rest', () => {
    const patch = { title: 'x', asset_id: 'A', scene_id: null }
    expect(linkFieldsIn(patch)).toEqual({ asset_id: 'A', scene_id: null })
    expect(withoutLinkFields(patch)).toEqual({ title: 'x' })
  })
  it('refuses an item with no task, an unknown kind, no entity or a bad position, in words', () => {
    expect(itemShapeProblem({ entity_type: 'asset', entity_id: 'a' })).toMatch(/its task/)
    expect(itemShapeProblem({ task_id: T, entity_type: 'phase', entity_id: 'a' })).toMatch(/not a kind of item/)
    expect(itemShapeProblem({ task_id: T, entity_type: 'asset' })).toMatch(/names/)
    expect(itemShapeProblem({ task_id: T, entity_type: 'asset', entity_id: 'a', position: -1 })).toMatch(/whole number/)
    expect(itemShapeProblem({ task_id: T, entity_type: 'asset', entity_id: 'a', position: 1.5 })).toMatch(/whole number/)
    expect(itemShapeProblem({ task_id: T, entity_type: 'asset', entity_id: 'a' })).toBeNull()
    // Review round 1, R1-4: ids are text, a position fits the cloud's
    // INTEGER, and created_at (when sent) is a date.
    const ok = { task_id: T, entity_type: 'asset', entity_id: 'a' }
    expect(itemShapeProblem({ ...ok, entity_id: ['a'] })).toMatch(/as text/)
    expect(itemShapeProblem({ ...ok, task_id: 7 })).toMatch(/as text/)
    expect(itemShapeProblem({ ...ok, id: {} })).toMatch(/own id is text/)
    expect(itemShapeProblem({ ...ok, position: 1e300 })).toMatch(/whole number/)
    expect(itemShapeProblem({ ...ok, position: 2147483648 })).toMatch(/whole number/)
    expect(itemShapeProblem({ ...ok, position: 2147483647 })).toBeNull()
    expect(itemShapeProblem({ ...ok, created_at: {} })).toMatch(/is a date/)
    expect(itemShapeProblem({ ...ok, created_at: 'not a date' })).toMatch(/is a date/)
    expect(itemShapeProblem({ ...ok, id: 'i1', created_at: '2026-10-11T00:00:00Z' })).toBeNull()
  })
  it('the next position is after the last of the kind', () => {
    expect(nextPosition([it_('a', 'asset', 'A', 0), it_('b', 'asset', 'B', 4)], T, 'asset')).toBe(5)
    expect(nextPosition([], T, 'asset')).toBe(0)
    // Review round 2, R2-7: never past the cloud's INTEGER.
    expect(nextPosition([it_('a', 'asset', 'A', 2147483647)], T, 'asset')).toBe(2147483647)
  })
})
