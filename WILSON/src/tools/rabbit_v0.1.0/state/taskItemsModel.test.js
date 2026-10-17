// =============================================================================
// taskItemsModel.test.js — FX2 (migration 0096, 2026-10-11): the one
// statement of a task's items' rules, which the provider runs before the
// echo, the fixtures run as the fake cloud, and electron/rabbitTaskItems.cjs
// copies (taskItemsParity.test.js holds the copy to this file).
//
// VW1m (2026-10-16), Audrey's batch 12 to 14 rulings: a task's items are its
// items, no item of a kind counts for more than another; an older app's write
// of one field adds and never moves; screens read the LIVE items in one
// display order through buildItemLookup (item 2 of
// docs/sessions/handoffs/po-vw1m-2026-10-16.md).
//
// VW1b (2026-10-17), her answers to Q-N1a and Q-N1b: *Date created* is the
// item's own creation date, *Type* the asset's own type.
// =============================================================================

import { describe, it, expect } from 'vitest'
import * as model from './taskItemsModel'
import {
  ITEM_KINDS, KIND_FIELD, LINK_FIELDS, FIELD_KIND, COLUMN_KINDS,
  NO_KIND_LABEL, ITEM_SORTS, ITEM_SORT_LABEL,
  compareItems, itemsOfTask, copyFieldsFromItems,
  tasksAbout, taskCountsByEntity, nextPosition,
  planLegacyFieldWrite, planSetKind, seedItemsFor, linkFieldsIn, withoutLinkFields, itemShapeProblem,
  indexItemsByTask, buildItemLookup, sortItemsForDisplay, typeRunsOf,
} from './taskItemsModel'
import { ASSET_TYPES } from './assetTypes'

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
  it('says the empty combination of every kind in plain words', () => {
    expect(NO_KIND_LABEL).toEqual({
      asset: 'No asset', scene: 'No scene', shot: 'No shot', level: 'No level', experience: 'No experience',
    })
  })
  it('offers her three sorts (Q-N1), Type first, each with its words', () => {
    expect(ITEM_SORTS).toEqual(['type', 'name', 'date'])
    expect(ITEM_SORT_LABEL).toEqual({ type: 'Type', name: 'A to Z', date: 'Date created' })
  })
  it('VW1m: no item counts for more than another, so the rules that picked one are gone', () => {
    for (const gone of ['mainItemOf', 'linkFieldsFromItems', 'withItemLinks', 'withItemLinksFor', 'linksInStep',
      'tasksWithChangedItems', 'mainAfterLinkWrite', 'planSingleFieldWrite']) {
      expect(model, gone).not.toHaveProperty(gone)
    }
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

describe('a task\'s items and the older apps\' copy', () => {
  const items = [
    it_('s2', 'scene', 'S2', 1), it_('a2', 'asset', 'A2', 1), it_('a1', 'asset', 'A1', 0),
    it_('s1', 'scene', 'S1', 0), it_('l1', 'level', 'L1', 0), it_('other', 'asset', 'AX', 0, undefined, 'task-2'),
  ]
  it('lists a task\'s items, kinds in order, each kind in the stored order; another task\'s are not its', () => {
    expect(itemsOfTask(items, T).map(i => i.id)).toEqual(['a1', 'a2', 's1', 's2', 'l1'])
    expect(itemsOfTask(items, T, 'scene').map(i => i.id)).toEqual(['s1', 's2'])
    expect(itemsOfTask(items, null)).toEqual([])
  })
  it('the copy is each kind\'s first item in the stored order, null for a kind with none', () => {
    expect(copyFieldsFromItems(itemsOfTask(items, T))).toEqual({
      asset_id: 'A1', scene_id: 'S1', shot_id: null, level_id: 'L1', experience_id: null,
    })
    expect(copyFieldsFromItems([])).toEqual({ asset_id: null, scene_id: null, shot_id: null, level_id: null, experience_id: null })
    expect(copyFieldsFromItems(undefined).asset_id).toBeNull()
  })
  it('FAILING CONTROL: the copy reads the stored order, never the order the rows arrive in', () => {
    const late = [it_('a9', 'asset', 'A9', 3), it_('a0', 'asset', 'A0', 0)]
    expect(copyFieldsFromItems(late).asset_id).toBe('A0')
  })
  it('indexes the items by task, each list sorted', () => {
    const byTask = indexItemsByTask(items)
    expect(byTask.get(T).map(i => i.id)).toEqual(['a1', 'a2', 's1', 's2', 'l1'])
    expect(byTask.get('task-2').map(i => i.id)).toEqual(['other'])
  })
})

describe('tasksAbout and taskCountsByEntity — the relation readers', () => {
  const tasks = [{ id: 'a', scene_id: 'S1' }, { id: 'b', scene_id: 'S2' }, { id: 'c', scene_id: null }]
  const items = [
    it_('i1', 'scene', 'S1', 0, undefined, 'a'), it_('i2', 'scene', 'S2', 1, undefined, 'a'),
    it_('i3', 'scene', 'S2', 0, undefined, 'b'), it_('i4', 'scene', 'S2', 0, undefined, 'gone-task'),
  ]
  it('lists every task that names the thing, wherever it sits in the task\'s list', () => {
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

describe('planLegacyFieldWrite — 0097 §7b, an older app\'s write of one field, ADD-ONLY', () => {
  const items = [it_('a1', 'asset', 'A1', 0), it_('a2', 'asset', 'A2', 1)]
  const none = { remove: [], insert: null }
  it('the same value: nothing', () => {
    expect(planLegacyFieldWrite(items, T, 'asset', 'A1', 'A1', make)).toEqual(none)
  })
  it('a value the task already has: nothing, and nothing MOVES (FX2 moved it first)', () => {
    expect(planLegacyFieldWrite(items, T, 'asset', 'A2', 'A1', make)).toEqual(none)
  })
  it('a new value: inserted at the END, and the item it was written over STAYS', () => {
    const plan = planLegacyFieldWrite(items, T, 'asset', 'A3', 'A1', make)
    expect(plan.remove).toEqual([])
    expect(plan.insert).toMatchObject({ task_id: T, entity_type: 'asset', entity_id: 'A3', position: 2 })
  })
  it('A, then B: the task keeps A and gains B', () => {
    let list = []
    const one = planLegacyFieldWrite(list, T, 'asset', 'A', null, make)
    list = [...list, one.insert]
    const two = planLegacyFieldWrite(list, T, 'asset', 'B', 'A', make)
    expect(two.remove).toEqual([])
    list = [...list, two.insert]
    expect(itemsOfTask(list, T, 'asset').map(i => `${i.entity_id}:${i.position}`)).toEqual(['A:0', 'B:1'])
  })
  it('cleared: only the item the cleared field named goes, never the others', () => {
    const plan = planLegacyFieldWrite(items, T, 'asset', null, 'A2', make)
    expect(plan.remove.map(i => i.id)).toEqual(['a2'])
    expect(plan.insert).toBeNull()
    expect(planLegacyFieldWrite(items, T, 'asset', '', 'A1', make).remove.map(i => i.id)).toEqual(['a1'])
  })
  it('cleared when the cleared value is already gone (a scene\'s cascade ran first), or was never set: nothing', () => {
    expect(planLegacyFieldWrite(items, T, 'asset', '', 'A9', make).remove).toEqual([])
    expect(planLegacyFieldWrite(items, T, 'asset', null, null, make)).toEqual(none)
  })
  it('a first item on a task with none of that kind: inserted at 0; another task\'s items are not counted', () => {
    const plan = planLegacyFieldWrite([...items, it_('o', 'scene', 'S9', 7, undefined, 'task-2')], T, 'scene', 'S1', null, make)
    expect(plan.insert).toMatchObject({ entity_type: 'scene', entity_id: 'S1', position: 0 })
    expect(plan.remove).toEqual([])
  })
  it('an unknown kind or no task changes nothing', () => {
    expect(planLegacyFieldWrite(items, T, 'phase', 'P', null, make)).toEqual(none)
    expect(planLegacyFieldWrite(items, null, 'asset', 'A3', null, make)).toEqual(none)
  })
})

describe('planSetKind — a kind made exactly the ids wanted (a drop on a row or group, a version\'s open)', () => {
  const items = [it_('a1', 'asset', 'A1', 0), it_('a2', 'asset', 'A2', 1), it_('s1', 'scene', 'S1', 0)]
  it('removes the others and inserts the missing at the end, in the order given; the kept ones never move', () => {
    const plan = planSetKind(items, T, 'asset', ['A3', 'A2', 'A4'], make)
    expect(plan.remove.map(i => i.id)).toEqual(['a1'])
    expect(plan.insert.map(i => `${i.entity_id}:${i.position}`)).toEqual(['A3:2', 'A4:3'])
    expect(plan.insert[0]).toMatchObject({ task_id: T, entity_type: 'asset' })
  })
  it('the same set: nothing; an empty set: every item of the kind goes, no other kind', () => {
    expect(planSetKind(items, T, 'asset', ['A2', 'A1'], make)).toEqual({ remove: [], insert: [] })
    const plan = planSetKind(items, T, 'asset', [], make)
    expect(plan.remove.map(i => i.id)).toEqual(['a1', 'a2'])
    expect(plan.insert).toEqual([])
  })
  it('an id named twice, or empty, is read once or not at all', () => {
    const plan = planSetKind(items, T, 'scene', ['S2', 'S2', '', null, 'S1'], make)
    expect(plan.remove).toEqual([])
    expect(plan.insert.map(i => `${i.entity_id}:${i.position}`)).toEqual(['S2:1'])
  })
  it('an unknown kind or no task changes nothing', () => {
    expect(planSetKind(items, T, 'phase', ['P'], make)).toEqual({ remove: [], insert: [] })
    expect(planSetKind(items, null, 'asset', ['A1'], make)).toEqual({ remove: [], insert: [] })
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

// ── The screens' half: buildItemLookup and sortItemsForDisplay ──────────────
const ROWS = {
  assets: [
    { id: 'as-lh', name: 'Lighthouse Interior' }, { id: 'as-sl', name: 'storm Lantern' },
    { id: 'as-10', name: 'Prop 10' }, { id: 'as-2', name: 'Prop 2' }, { id: 'as-x', name: '' },
    { id: 'as-twin-b', name: 'Twin' }, { id: 'as-twin-a', name: 'twin' },
  ],
  scenes: [
    { id: 'sc-3', name: 'Cliff', scene_number: 3 }, { id: 'sc-1', name: 'Harbour', scene_number: 1 },
    { id: 'sc-10', name: 'Attic', scene_number: 10 }, { id: 'sc-none', name: 'Aardvark', scene_number: null },
    { id: 'sc-1b', name: 'Beach', scene_number: 1 },
  ],
  shots: [
    { id: 'sh-3-1', name: 'Wide', scene_id: 'sc-3', shot_number: 1 },
    { id: 'sh-1-2', name: 'Close', scene_id: 'sc-1', shot_number: 2 },
    { id: 'sh-1-10', name: 'Insert', scene_id: 'sc-1', shot_number: 10 },
    { id: 'sh-loose', name: 'Pickup', scene_id: null, shot_number: 1 },
    { id: 'sh-1-2b', name: 'Another', scene_id: 'sc-1', shot_number: 2 },
  ],
  levels: [{ id: 'lv-1', name: 'Docks' }],
  experiences: [{ id: 'xp-1', name: 'Tour' }],
}

describe('buildItemLookup — a task\'s LIVE items, in one display order', () => {
  const items = [
    it_('i1', 'asset', 'as-sl', 0), it_('i2', 'asset', 'as-lh', 1), it_('i3', 'asset', 'as-gone', 2),
    it_('i4', 'scene', 'sc-3', 0), it_('i5', 'scene', 'sc-1', 1),
    it_('i6', 'shot', 'sh-1-10', 0), it_('i7', 'shot', 'sh-3-1', 1), it_('i8', 'shot', 'sh-1-2', 2),
    it_('i9', 'level', 'lv-1', 0), it_('i10', 'asset', 'as-sl', 5), // a second copy of one (task, kind, entity)
    it_('o1', 'asset', 'as-2', 0, undefined, 'task-2'),
  ]
  const lookup = buildItemLookup({ items, available: true, ...ROWS })
  const task = { id: T, asset_id: 'as-10', scene_id: 'sc-10' }

  it('idsOf: every live item of the kind, by name A to Z, each once; the task\'s own fields are not read', () => {
    expect(lookup.idsOf(task, 'asset')).toEqual(['as-lh', 'as-sl'])
    expect(lookup.idsOf(task, 'level')).toEqual(['lv-1'])
    expect(lookup.idsOf(task, 'experience')).toEqual([])
    expect(lookup.idsOf({ id: 'task-2' }, 'asset')).toEqual(['as-2'])
  })
  it('isLive: a row in the list given for its kind; an item whose row is in the trash or not loaded is hidden', () => {
    expect(lookup.isLive('asset', 'as-lh')).toBe(true)
    expect(lookup.isLive('asset', 'as-gone')).toBe(false)
    expect(lookup.isLive('scene', 'as-lh')).toBe(false) // another kind's row
    expect(lookup.isLive('shot', null)).toBe(false)
    // The row comes back (restored, or loaded): the same item shows again.
    const back = buildItemLookup({ items, available: true, ...ROWS, assets: [...ROWS.assets, { id: 'as-gone', name: 'Back' }] })
    expect(back.idsOf(task, 'asset')).toEqual(['as-gone', 'as-lh', 'as-sl'])
  })
  it('scenes read by their number, then name; a scene with no number last', () => {
    const l = buildItemLookup({ items: [
      it_('a', 'scene', 'sc-10', 0), it_('b', 'scene', 'sc-none', 1), it_('c', 'scene', 'sc-1b', 2),
      it_('d', 'scene', 'sc-3', 3), it_('e', 'scene', 'sc-1', 4),
    ], ...ROWS })
    expect(l.idsOf({ id: T }, 'scene')).toEqual(['sc-1b', 'sc-1', 'sc-3', 'sc-10', 'sc-none'])
  })
  it('shots read by their scene\'s number, then their own, then name; a shot with no scene last', () => {
    const l = buildItemLookup({ items: [
      it_('a', 'shot', 'sh-loose', 0), it_('b', 'shot', 'sh-3-1', 1), it_('c', 'shot', 'sh-1-10', 2),
      it_('d', 'shot', 'sh-1-2', 3), it_('e', 'shot', 'sh-1-2b', 4),
    ], ...ROWS })
    expect(l.idsOf({ id: T }, 'shot')).toEqual(['sh-1-2b', 'sh-1-2', 'sh-1-10', 'sh-3-1', 'sh-loose'])
  })
  it('names: a row\'s own name or "Untitled <kind>"; a shot as "Scene › Shot", as the task window says it', () => {
    expect(lookup.nameOf('asset', 'as-lh')).toBe('Lighthouse Interior')
    expect(lookup.nameOf('asset', 'as-x')).toBe('Untitled asset')
    expect(lookup.nameOf('shot', 'sh-1-2')).toBe('Harbour › Close')
    expect(lookup.nameOf('shot', 'sh-loose')).toBe('Pickup')
    expect(lookup.nameOf('asset', 'as-gone')).toBeNull()
    const untitled = buildItemLookup({ shots: [{ id: 'h', scene_id: 's' }], scenes: [{ id: 's' }] })
    expect(untitled.nameOf('shot', 'h')).toBe('Untitled scene › Untitled shot')
    expect(untitled.nameOf('scene', 's')).toBe('Untitled scene')
  })
  it('names compare numbers as numbers and ignore case; a tie on the name falls to the id', () => {
    const l = buildItemLookup({ items: [
      it_('a', 'asset', 'as-10', 0), it_('b', 'asset', 'as-2', 1), it_('c', 'asset', 'as-twin-b', 2), it_('d', 'asset', 'as-twin-a', 3),
    ], ...ROWS })
    expect(l.idsOf({ id: T }, 'asset')).toEqual(['as-2', 'as-10', 'as-twin-a', 'as-twin-b'])
  })
  it('orderOf: the display order as a comparator, rows not shown last', () => {
    expect(['as-sl', 'as-gone', 'as-lh'].sort(lookup.orderOf('asset'))).toEqual(['as-lh', 'as-sl', 'as-gone'])
    expect(['sc-3', 'sc-1'].sort(lookup.orderOf('scene'))).toEqual(['sc-1', 'sc-3'])
  })
  it('combinationOf: the key is the sorted ids, the ids and the label in the display order', () => {
    expect(lookup.combinationOf(task, 'asset')).toEqual({
      key: 'as-lh|as-sl', ids: ['as-lh', 'as-sl'], label: 'Lighthouse Interior, storm Lantern',
    })
    expect(lookup.combinationOf(task, 'scene')).toEqual({ key: 'sc-1|sc-3', ids: ['sc-1', 'sc-3'], label: 'Harbour, Cliff' })
    expect(lookup.combinationOf(task, 'shot')).toEqual({
      key: 'sh-1-10|sh-1-2|sh-3-1', ids: ['sh-1-2', 'sh-1-10', 'sh-3-1'], label: 'Harbour › Close, Harbour › Insert, Cliff › Wide',
    })
    expect(lookup.combinationOf(task, 'experience')).toEqual({ key: '', ids: [], label: '' })
  })
  it('FAILING CONTROL: the same set added in another order is the same combination', () => {
    const other = buildItemLookup({ items: [it_('x', 'asset', 'as-lh', 0, undefined, 'task-9'), it_('y', 'asset', 'as-sl', 1, undefined, 'task-9')], ...ROWS })
    expect(other.combinationOf({ id: 'task-9' }, 'asset')).toEqual(lookup.combinationOf(task, 'asset'))
    expect(other.combinationOf({ id: 'task-9' }, 'asset').key).not.toBe(lookup.combinationOf({ id: 'task-2' }, 'asset').key)
  })
  it('an unknown kind, or no task, reads nothing', () => {
    expect(lookup.idsOf(task, 'phase')).toEqual([])
    expect(lookup.idsOf(null, 'asset')).toEqual([])
    expect(lookup.combinationOf({}, 'asset')).toEqual({ key: '', ids: [], label: '' })
  })
})

describe('buildItemLookup where the backend keeps no items (available false)', () => {
  const lookup = buildItemLookup({ items: [it_('i1', 'asset', 'as-lh', 0)], available: false, ...ROWS })
  it('the task\'s own single field is its one item, so every screen has one reading path', () => {
    const task = { id: T, asset_id: 'as-sl', scene_id: 'sc-1', shot_id: '', level_id: null }
    expect(lookup.idsOf(task, 'asset')).toEqual(['as-sl'])
    expect(lookup.combinationOf(task, 'scene')).toEqual({ key: 'sc-1', ids: ['sc-1'], label: 'Harbour' })
    expect(lookup.idsOf(task, 'shot')).toEqual([])
    expect(lookup.idsOf(task, 'level')).toEqual([])
  })
  it('still only when live: a field naming a row not shown reads nothing', () => {
    expect(lookup.idsOf({ id: T, asset_id: 'as-gone' }, 'asset')).toEqual([])
  })
  it('FAILING CONTROL: the items given are not read (a stale list cannot speak for the fields)', () => {
    expect(lookup.idsOf({ id: T }, 'asset')).toEqual([])
  })
})

// VW1b (2026-10-17): her answers to Q-N1a ("The item's own creation date")
// and Q-N1b ("The asset's own type"), batch 15 of CUSTOM_VIEWS_QUESTIONS.md.
// Every row below carries its own type and creation date; every ITEM was
// added in the opposite order, so a sort that read when an item was added
// (the interim) or the kinds alone (the interim *Type*) answers otherwise.
const DATED = {
  assets: [
    { id: 'as-lh', name: 'Lighthouse Interior', type: 'environment', created_at: '2026-09-02T10:00:00Z' },
    { id: 'as-sl', name: 'storm Lantern', type: 'prop', created_at: '2026-09-01T10:00:00Z' },
    { id: 'as-ma', name: 'Mara', type: 'character', created_at: '2026-09-05T10:00:00Z' },
    { id: 'as-zz', name: 'Ash', type: 'mystery', created_at: null },
    { id: 'as-no', name: 'Buoy' }, // no type: reads as 'other'; no date
  ],
  scenes: [{ id: 'sc-3', name: 'Cliff', scene_number: 3, created_at: '2026-09-03T10:00:00Z' }],
  shots: [{ id: 'sh-1', name: 'Wide', scene_id: 'sc-3', shot_number: 1, created_at: '2026-09-04T10:00:00Z' }],
  levels: [{ id: 'lv-1', name: 'Docks', created_at: '2026-08-30T10:00:00Z' }],
  experiences: [],
}

describe('buildItemLookup — an asset\'s own type and a row\'s own creation date (VW1b)', () => {
  const l = buildItemLookup({ ...DATED })
  it('typeOf: an asset\'s own type, "other" when it names none; null for another kind or a row not shown', () => {
    expect(l.typeOf('asset', 'as-ma')).toBe('character')
    expect(l.typeOf('asset', 'as-no')).toBe('other')
    expect(l.typeOf('scene', 'sc-3')).toBeNull()
    expect(l.typeOf('asset', 'as-gone')).toBeNull()
  })
  it('madeAt: the row\'s own created_at in ms, null when it says none or the row is not shown', () => {
    expect(l.madeAt('asset', 'as-sl')).toBe(Date.parse('2026-09-01T10:00:00Z'))
    expect(l.madeAt('level', 'lv-1')).toBe(Date.parse('2026-08-30T10:00:00Z'))
    expect(l.madeAt('asset', 'as-zz')).toBeNull()
    expect(l.madeAt('asset', 'as-no')).toBeNull()
    expect(l.madeAt('asset', 'as-gone')).toBeNull()
    expect(buildItemLookup({ assets: [{ id: 'x', created_at: 'not a date' }] }).madeAt('asset', 'x')).toBeNull()
  })
  it('madeAt keeps the database\'s microseconds, as the stored order does (VW1m R2-7)', () => {
    const m = buildItemLookup({ assets: [{ id: 'a', created_at: '2026-09-01T10:00:00.000100Z' }, { id: 'b', created_at: '2026-09-01T10:00:00.000900Z' }] })
    expect(m.madeAt('asset', 'a')).toBeLessThan(m.madeAt('asset', 'b'))
  })
})

describe('sortItemsForDisplay — her Q-N1 sorts, with her Q-N1a and Q-N1b answers (VW1b)', () => {
  const lookup = buildItemLookup({ ...DATED })
  // Added newest-first: r1 (the oldest add) is the newest row, and so on.
  const rows = [
    it_('r1', 'asset', 'as-ma', 0, '2026-10-11T08:00:00Z'),
    it_('r2', 'shot', 'sh-1', 0, '2026-10-11T09:00:00Z'),
    it_('r3', 'scene', 'sc-3', 0, '2026-10-11T10:00:00Z'),
    it_('r4', 'asset', 'as-lh', 1, '2026-10-11T11:00:00Z'),
    it_('r5', 'asset', 'as-sl', 2, '2026-10-11T12:00:00Z'),
    it_('r6', 'level', 'lv-1', 0, '2026-10-11T13:00:00Z'),
  ]
  it('Type: the assets by their own type in the Assets table\'s order (character, environment, prop…), then the other kinds, each in the display order', () => {
    expect(ASSET_TYPES.slice(0, 3)).toEqual(['character', 'environment', 'prop'])
    // Mara (character), Lighthouse Interior (environment), storm Lantern (prop); then Cliff, Cliff › Wide, Docks.
    expect(sortItemsForDisplay(rows, 'type', lookup).map(i => i.id)).toEqual(['r1', 'r4', 'r5', 'r3', 'r2', 'r6'])
  })
  it('FAILING CONTROL: the interim Type (the kinds alone, each by name) would put Lighthouse Interior before Mara', () => {
    const byKindOnly = [...rows].sort((a, b) => (ITEM_KINDS.indexOf(a.entity_type) - ITEM_KINDS.indexOf(b.entity_type))
      || lookup.orderOf(a.entity_type)(a.entity_id, b.entity_id)).map(i => i.id)
    expect(byKindOnly).toEqual(['r4', 'r1', 'r5', 'r3', 'r2', 'r6'])
    expect(sortItemsForDisplay(rows, 'type', lookup).map(i => i.id)).not.toEqual(byKindOnly)
  })
  it('Type: a type the list does not name comes after every one it does; an asset with no type is "other", the list\'s last', () => {
    const more = [...rows, it_('r7', 'asset', 'as-zz', 3), it_('r8', 'asset', 'as-no', 4)]
    const ids = sortItemsForDisplay(more, 'type', lookup).map(i => i.id)
    expect(ids.slice(0, 5)).toEqual(['r1', 'r4', 'r5', 'r8', 'r7'])
  })
  it('A to Z: one list by name, whatever the kind', () => {
    // Cliff, Cliff › Wide, Docks, Lighthouse Interior, Mara, storm Lantern
    expect(sortItemsForDisplay(rows, 'name', lookup).map(i => i.id)).toEqual(['r3', 'r2', 'r6', 'r4', 'r1', 'r5'])
  })
  it('A to Z: a tie on the name falls to the kind', () => {
    const l = buildItemLookup({ assets: [{ id: 'a', name: 'Dock' }], levels: [{ id: 'l', name: 'dock' }] })
    const tied = [it_('x', 'level', 'l', 0), it_('y', 'asset', 'a', 0)]
    expect(sortItemsForDisplay(tied, 'name', l).map(i => i.id)).toEqual(['y', 'x'])
  })
  it('Date created: one list by when each item ITSELF was made, oldest first, whatever the kind', () => {
    // Docks 08-30, storm Lantern 09-01, Lighthouse Interior 09-02, Cliff 09-03, Cliff › Wide 09-04, Mara 09-05.
    expect(sortItemsForDisplay(rows, 'date', lookup).map(i => i.id)).toEqual(['r6', 'r5', 'r4', 'r3', 'r2', 'r1'])
  })
  it('FAILING CONTROL: the interim Date added (when each was added to the task) is the opposite order here', () => {
    const added = [...rows].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).map(i => i.id)
    expect(added).toEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r6'])
    expect(sortItemsForDisplay(rows, 'date', lookup).map(i => i.id)).not.toEqual(added)
  })
  it('Date created: a row that says no date comes after the dated ones; ties by kind, then the display order', () => {
    const more = [it_('u1', 'asset', 'as-no', 0), it_('u2', 'asset', 'as-zz', 1), ...rows]
    const ids = sortItemsForDisplay(more, 'date', lookup).map(i => i.id)
    expect(ids.slice(-2)).toEqual(['u2', 'u1']) // Ash, Buoy: no date, by name
    const l = buildItemLookup({ assets: [{ id: 'a', name: 'B', created_at: '2026-09-01T00:00:00Z' }], levels: [{ id: 'l', name: 'A', created_at: '2026-09-01T00:00:00Z' }] })
    expect(sortItemsForDisplay([it_('x', 'level', 'l', 0), it_('y', 'asset', 'a', 0)], 'date', l).map(i => i.id)).toEqual(['y', 'x'])
  })
  it('the labels say the new meaning: Date created', () => {
    expect(ITEM_SORT_LABEL.date).toBe('Date created')
  })
  it('anything else reads as Type; the list given is never changed', () => {
    const before = rows.map(i => i.id)
    expect(sortItemsForDisplay(rows, 'nonsense', lookup).map(i => i.id)).toEqual(sortItemsForDisplay(rows, 'type', lookup).map(i => i.id))
    expect(rows.map(i => i.id)).toEqual(before)
    expect(sortItemsForDisplay(null, 'type', lookup)).toEqual([])
  })
})

describe('typeRunsOf — the window\'s runs under Type: one per asset type, then one per other kind (VW1b)', () => {
  const lookup = buildItemLookup({ ...DATED })
  it('splits the sorted rows into runs, each with its kind and the asset type it is about', () => {
    const rows = [it_('a', 'asset', 'as-ma', 0), it_('b', 'asset', 'as-lh', 1), it_('c', 'asset', 'as-no', 2), it_('d', 'scene', 'sc-3', 0), it_('e', 'level', 'lv-1', 0)]
    const runs = typeRunsOf(sortItemsForDisplay(rows, 'type', lookup), lookup)
    expect(runs.map(r => [r.key, r.kind, r.type, r.items.map(i => i.id)])).toEqual([
      ['asset:character', 'asset', 'character', ['a']],
      ['asset:environment', 'asset', 'environment', ['b']],
      ['asset:other', 'asset', 'other', ['c']],
      ['scene', 'scene', null, ['d']],
      ['level', 'level', null, ['e']],
    ])
  })
  it('two assets of one type share a run; nothing given, no runs', () => {
    const l = buildItemLookup({ assets: [{ id: 'p', name: 'P', type: 'prop' }, { id: 'q', name: 'Q', type: 'prop' }] })
    expect(typeRunsOf([it_('a', 'asset', 'p', 0), it_('b', 'asset', 'q', 1)], l).map(r => r.items.length)).toEqual([2])
    expect(typeRunsOf(null, l)).toEqual([])
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
