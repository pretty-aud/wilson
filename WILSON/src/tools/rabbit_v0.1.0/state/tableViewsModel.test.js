// =============================================================================
// tableViewsModel.test.js — VW1c (2026-10-17): the rules of custom table
// views and groupings (state/tableViewsModel.js), the client's statement of
// migration 0098 (design §5, corrected at VW1c's step 0).
// =============================================================================

import { describe, it, expect } from 'vitest'
import {
  TABLE_KEYS, GROUPING_KINDS, VIEW_NAME_MAX, GROUPING_IDS_MAX, TABLE_VIEW_LAST_MAX, ALL_VIEW_ID, MAX_VIEW_POSITION,
  isTableKey, isGroupingPair, normalizeViewName, viewNameProblem, utf8Length, canonicalJson, configsEqual,
  jsonbText, viewConfigProblem, defaultViewConfig, isCompleteFilter, readViewConfig, writeViewConfig, allViewOf,
  compareViews, viewsOfTable, nextViewPosition, planReorderViews, normalizeEntityIds, groupingKeyOf,
  groupingProblem, groupingsOfTable, findGroupingBySet, isGroupingLive, planForgetItem,
  tableViewLastKey, tableViewLastKeyProblem, isViewIdOrAll, mergeTableViewLast, readTableViewLast,
} from './tableViewsModel.js'

describe('the tables and the grouping pairs (0098 §2, §3; design §4.11)', () => {
  it('six tables have views; budget and team do not (Q19)', () => {
    expect(TABLE_KEYS).toEqual(['tasks', 'assets', 'scenes', 'shots', 'levels', 'experiences'])
    expect(isTableKey('tasks')).toBe(true)
    expect(isTableKey('budget')).toBe(false)
    expect(isTableKey(undefined)).toBe(false)
  })

  it('the pairs are exactly 0098\'s CHECK', () => {
    expect(GROUPING_KINDS.tasks).toEqual(['asset', 'scene', 'shot', 'level', 'experience'])
    expect(isGroupingPair('assets', 'scene')).toBe(true)
    expect(isGroupingPair('assets', 'asset')).toBe(false)
    expect(isGroupingPair('levels', 'asset')).toBe(true)
    expect(isGroupingPair('levels', 'scene')).toBe(false)
    expect(isGroupingPair('scenes', 'asset')).toBe(false) // Scenes has no grouping by a linked kind
    expect(isGroupingPair('toString', 'asset')).toBe(false) // an inherited name is not a table
  })
})

describe('names (the cloud\'s table_views_name_chk)', () => {
  it('a name is stored trimmed, 1 to 80 characters, with no control character', () => {
    expect(normalizeViewName('  Shoot week ')).toBe('Shoot week')
    expect(viewNameProblem('Shoot week')).toBe(null)
    expect(viewNameProblem('')).toMatch(/needs a name/)
    expect(viewNameProblem(' Padded')).toMatch(/start or end with a space/)
    expect(viewNameProblem('x'.repeat(VIEW_NAME_MAX))).toBe(null)
    expect(viewNameProblem('x'.repeat(VIEW_NAME_MAX + 1))).toMatch(/at most 80/)
    expect(viewNameProblem('Two\nlines')).toMatch(/line break/)
    expect(viewNameProblem(42)).toMatch(/needs a name/)
  })

  it('80 characters are characters, not UTF-16 units (an emoji counts once)', () => {
    expect(viewNameProblem('🎬'.repeat(80))).toBe(null)
    expect(viewNameProblem('🎬'.repeat(81))).toMatch(/at most 80/)
  })
})

describe('configs: the size, equality and the never-throwing reader (design §5.1)', () => {
  it('measures the JSON text in UTF-8 bytes, as the cloud\'s CHECK does', () => {
    expect(utf8Length('abc')).toBe(3)
    expect(utf8Length('é')).toBe(2)
    expect(utf8Length('€')).toBe(3)
    expect(utf8Length('🎬')).toBe(4)
    expect(viewConfigProblem({ pad: 'x'.repeat(32000) })).toBe(null)
    expect(viewConfigProblem({ pad: 'x'.repeat(33000) })).toMatch(/32 KB/)
    expect(viewConfigProblem([1, 2])).toMatch(/object/)
    expect(viewConfigProblem(null)).toMatch(/object/)
  })

  // Review round 2, R2-4: [the number, octet_length('{"v": <it>}'::jsonb::text)]
  // as wilson-dev answered on 2026-10-17 (the numbers JSON.stringify writes
  // with an exponent, and three it writes plainly).
  const PRINTED = [[1e21, 29], [1e-7, 16], [[1e300], 310], [1.5e-7, 17], [-2.5e22, 31], [5e-324, 333],
    [1.7976931348623157e308, 316], [123456789012345680000, 28], [0.000001, 15], [1.2345e-10, 23]]

  it('R2-4: a number is measured as jsonb prints it, never with an exponent', () => {
    for (const [v, bytes] of PRINTED) expect(utf8Length(jsonbText({ v })), JSON.stringify(v)).toBe(bytes)
    expect(jsonbText({ v: 1e21 })).toBe('{"v": 1000000000000000000000}')
    expect(jsonbText({ v: -1.5e-7 })).toBe('{"v": -0.00000015}')
    expect(jsonbText([2e-7, 1.25e22])).toBe('[0.0000002, 12500000000000000000000]')
    // CONTROL: JSON.stringify's text is shorter than what the cloud measures.
    expect(utf8Length(JSON.stringify({ v: [1e300] }))).toBeLessThan(310)
    // A config at the cap by jsonb's count passes; a byte more is refused,
    // though JSON.stringify's count of it is under the cap.
    const base = utf8Length(jsonbText({ k: '', v: 1e21 }))
    expect(base).toBe(38)
    expect(viewConfigProblem({ k: 'x'.repeat(32768 - base), v: 1e21 })).toBe(null)
    expect(viewConfigProblem({ k: 'x'.repeat(32769 - base), v: 1e21 })).toMatch(/32 KB/)
    expect(utf8Length(JSON.stringify({ k: 'x'.repeat(32769 - base), v: 1e21 }))).toBeLessThan(32768)
  })

  it('R2-4: a NUL or half of a surrogate pair (jsonb refuses them: 22P05, 22P02) is refused in a config\'s key or value, and in a name', () => {
    for (const config of [{ v: 'a\u0000b' }, { ['\u0000']: 1 }, { v: ['\udc00'] }, { v: { deep: 'x\ud800' } },
      { v: '\ud800x' }, { ['\udc00']: 1 }, { v: [{ w: 'ok', z: 'end\udbff' }] }]) {
      expect(viewConfigProblem(config), JSON.stringify(config)).toBe('A view\'s settings hold a character that cannot be saved.')
    }
    // CONTROL: a whole pair (an emoji) is kept, and a value
    // the request would not carry is not read.
    expect(viewConfigProblem({ v: '😀', w: '😀', x: 'é€' })).toBe(null)
    expect(viewConfigProblem({ v: undefined, f: () => '\u0000' })).toBe(null)
    expect(viewNameProblem('Shoot \udc00 week')).toBe('A view\'s name holds a character that cannot be saved.')
    expect(viewNameProblem('Shoot week \ud83c')).toBe('A view\'s name holds a character that cannot be saved.')
    expect(viewNameProblem('Shoot 😀 week')).toBe(null)
  })

  it('two configs that differ only in key order are the same (jsonb\'s equality: no new revision)', () => {
    expect(configsEqual({ a: 1, b: { c: 2, d: [1, { e: 3, f: 4 }] } }, { b: { d: [1, { f: 4, e: 3 }], c: 2 }, a: 1 })).toBe(true)
    expect(configsEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false) // arrays keep their order
    expect(configsEqual({ a: 1 }, { a: '1' })).toBe(false)
    expect(canonicalJson({ b: 1, a: undefined })).toBe('{"b":1}')
  })

  it('All\'s settings per table: the Tasks Board by Status and key dates on, Shots grouped by Scene', () => {
    expect(defaultViewConfig('tasks')).toMatchObject({ group: null, board: { field: 'status', hideEmpty: false }, keyDates: true, fields: [] })
    expect(defaultViewConfig('shots').group).toEqual({ field: 'scene', hideEmpty: true })
    expect(defaultViewConfig('assets')).not.toHaveProperty('board')
    expect(defaultViewConfig('assets')).not.toHaveProperty('keyDates')
  })

  it('anything that is not an object opens as All, and says so; nothing throws', () => {
    for (const raw of [null, undefined, 'x', 7, [], true]) {
      const r = readViewConfig(raw, 'tasks')
      expect(r.unreadable).toBe(true)
      expect(r.config).toEqual(defaultViewConfig('tasks'))
    }
  })

  it('reads what it can: malformed parts fall back to All\'s, incomplete filter rows are dropped', () => {
    const { config, newer, unreadable } = readViewConfig({
      version: 1,
      layout: 'gallery', // not a Tasks layout
      filters: [
        { field: 'status', op: 'is', values: ['todo'] },
        { field: 'status', op: 'is', values: [] }, // incomplete: never stored
        { field: 'priority', op: 'is_empty' },     // complete without a value
        { op: 'is', values: ['x'] },               // no field
        { field: 'asset', op: 'is', values: [{ id: 1 }, 'a1'] }, // only the primitive survives
      ],
      sorts: [{ field: 'title', dir: 'desc' }, { field: 'title', dir: 'asc' }, { dir: 'asc' }, { field: 'start_date', dir: 'sideways' }],
      group: { field: 'phase_id' },
      board: 'columns',
      fields: [{ key: 'title' }, { key: 'status', visible: false }, { key: 'title', visible: false }, { visible: true }],
      leading: 'nope',
      keyDates: 'yes',
    }, 'tasks')
    expect(unreadable).toBe(false)
    expect(newer).toBe(false)
    expect(config.layout).toBe('table')
    expect(config.filters).toEqual([
      { field: 'status', op: 'is', values: ['todo'] },
      { field: 'priority', op: 'is_empty', values: [] },
      { field: 'asset', op: 'is', values: ['a1'] },
    ])
    expect(config.sorts).toEqual([{ field: 'title', dir: 'desc' }, { field: 'start_date', dir: 'asc' }])
    expect(config.group).toEqual({ field: 'phase_id', hideEmpty: false })
    expect(config.board).toEqual({ field: 'status', hideEmpty: false })
    expect(config.fields).toEqual([{ key: 'title', visible: true }, { key: 'status', visible: false }])
    expect(config.leading).toEqual([])
    expect(config.keyDates).toBe(true)
  })

  it('a stored group of null is "no grouping", not All\'s (Shots grouped by Scene by default)', () => {
    expect(readViewConfig({ group: null }, 'shots').config.group).toBe(null)
    expect(readViewConfig({}, 'shots').config.group).toEqual({ field: 'scene', hideEmpty: true })
  })

  it('a config made by a newer WILSON reads as newer (Save greyed), its known parts still read', () => {
    const r = readViewConfig({ version: 2, sorts: [{ field: 'title', dir: 'asc' }] }, 'assets')
    expect(r.newer).toBe(true)
    expect(r.config.sorts).toEqual([{ field: 'title', dir: 'asc' }])
    expect(readViewConfig({ version: 1 }, 'assets').newer).toBe(false)
  })

  it('writing keeps every key this build does not know, and drops incomplete filters', () => {
    const stored = { version: 1, futureThing: { a: 1 }, sorts: [{ field: 'x', dir: 'asc' }] }
    const out = writeViewConfig(stored, {
      sorts: [{ field: 'title', dir: 'desc' }],
      filters: [{ field: 'status', op: 'is', values: [] }, { field: 'status', op: 'is_not', values: ['done'] }],
      notAKnownKey: 1,
    })
    expect(out).toEqual({
      version: 1,
      futureThing: { a: 1 },
      sorts: [{ field: 'title', dir: 'desc' }],
      filters: [{ field: 'status', op: 'is_not', values: ['done'] }],
    })
    expect(stored.sorts).toEqual([{ field: 'x', dir: 'asc' }]) // the stored object is not touched
    expect(writeViewConfig(null, {})).toEqual({ version: 1 })
  })

  it('isCompleteFilter is the reader\'s and the writer\'s one rule', () => {
    expect(isCompleteFilter({ field: 'f', op: 'is', values: ['v'] })).toBe(true)
    expect(isCompleteFilter({ field: 'f', op: 'is_not_empty' })).toBe(true)
    expect(isCompleteFilter({ field: 'f', op: 'contains', values: [''] })).toBe(true) // an empty word is a value; the screen decides
    expect(isCompleteFilter({ field: 'f', op: 'contains', values: [] })).toBe(false)
    expect(isCompleteFilter({ field: '', op: 'is', values: ['v'] })).toBe(false)
  })
})

describe('views: All, the order, the place of a new one, the reorder (Q5c, Q20; 0098 §8)', () => {
  it('All is never stored, always first, and cannot be mistaken for a row', () => {
    const all = allViewOf('scenes')
    expect(all).toMatchObject({ id: ALL_VIEW_ID, name: 'All', builtIn: true, table_key: 'scenes', revision: 0 })
    expect(Object.isFrozen(all)).toBe(true)
    expect(all.config).toEqual(defaultViewConfig('scenes'))
  })

  const t = (us) => `2026-10-17T10:00:00.12345${us}Z`
  const views = [
    { id: 'b', table_key: 'tasks', position: 1, created_at: t(6) },
    { id: 'a', table_key: 'tasks', position: 1, created_at: t(5) },
    { id: 'c', table_key: 'tasks', position: 0, created_at: t(9) },
    { id: 'z', table_key: 'assets', position: 0, created_at: t(1) },
  ]

  it('orders by position, then created_at to the microsecond, then id', () => {
    expect(viewsOfTable(views, 'tasks').map(v => v.id)).toEqual(['c', 'a', 'b'])
    // CONTROL: equal times fall to the id.
    expect([{ id: 'y', position: 0, created_at: t(1) }, { id: 'x', position: 0, created_at: t(1) }].sort(compareViews).map(v => v.id)).toEqual(['x', 'y'])
  })

  it('R1-6: a new view never goes past the INTEGER ceiling; a tie there falls to created_at', () => {
    const at = (p) => [{ id: 'x', table_key: 'tasks', position: p }]
    expect(MAX_VIEW_POSITION).toBe(2147483647)
    expect(nextViewPosition(at(MAX_VIEW_POSITION - 1), 'tasks')).toBe(MAX_VIEW_POSITION)
    expect(nextViewPosition(at(MAX_VIEW_POSITION), 'tasks')).toBe(MAX_VIEW_POSITION) // not 2147483648 (22003 on every insert)
  })

  it('a new view goes after the table\'s last; the first at 0', () => {
    expect(nextViewPosition(views, 'tasks')).toBe(2)
    expect(nextViewPosition(views, 'levels')).toBe(0)
  })

  it('reorder: the named first in the given order, the rest after in their order, dense; another table\'s id ignored', () => {
    expect(planReorderViews(views, 'tasks', ['b', 'z'])).toEqual([
      { id: 'b', position: 0 }, { id: 'c', position: 1 }, { id: 'a', position: 2 },
    ])
    // Already in place: nothing moves.
    expect(planReorderViews([{ id: 'p', table_key: 'tasks', position: 0 }], 'tasks', ['p'])).toEqual([])
  })

  it('reorder refuses what the cloud refuses (22023): an unknown table, an empty id, a repeat', () => {
    expect(() => planReorderViews(views, 'budget', [])).toThrow(expect.objectContaining({ code: 'table_view_invalid' }))
    expect(() => planReorderViews(views, 'tasks', ['a', ''])).toThrow(/empty/)
    expect(() => planReorderViews(views, 'tasks', ['a', null])).toThrow(/empty/)
    expect(() => planReorderViews(views, 'tasks', ['a', 'a'])).toThrow(/twice/)
  })
})

describe('groupings: the set, its key, the problems, the live rule (0098 §3; Q-N4)', () => {
  it('a set is stored as strings, sorted, distinct; its key joins them with |', () => {
    expect(normalizeEntityIds(['b', 'a', 'b', null, '', 3])).toEqual(['3', 'a', 'b'])
    expect(groupingKeyOf(['b', 'a'])).toBe('a|b')
    expect(groupingKeyOf([])).toBe('')
  })

  it('the problems are the cloud\'s CHECKs', () => {
    expect(groupingProblem({ table_key: 'tasks', kind: 'asset', entity_ids: ['a'] })).toBe(null)
    expect(groupingProblem({ table_key: 'assets', kind: 'asset', entity_ids: ['a'] })).toMatch(/cannot be grouped by asset/)
    expect(groupingProblem({ table_key: 'tasks', kind: 'asset', entity_ids: [] })).toMatch(/at least one/)
    expect(groupingProblem({ table_key: 'tasks', kind: 'asset', entity_ids: ['a', null] })).toMatch(/each be an id/)
    expect(groupingProblem({ table_key: 'tasks', kind: 'asset', entity_ids: [7] })).toMatch(/each be an id/)
    const many = Array.from({ length: GROUPING_IDS_MAX + 1 }, (_, i) => `id-${i}`)
    expect(groupingProblem({ table_key: 'tasks', kind: 'asset', entity_ids: many })).toMatch(/at most 100/)
    expect(groupingProblem({ table_key: 'tasks', kind: 'asset', entity_ids: many.slice(1) })).toBe(null)
    // A repeat does not count twice towards the cap (the cloud stores the set).
    expect(groupingProblem({ table_key: 'tasks', kind: 'asset', entity_ids: [...many.slice(1), 'id-1'] })).toBe(null)
  })

  const groupings = [
    { id: 'g2', table_key: 'tasks', kind: 'asset', entity_ids: ['b', 'a'], created_at: '2026-10-17T10:00:02Z' },
    { id: 'g1', table_key: 'tasks', kind: 'asset', entity_ids: ['a'], created_at: '2026-10-17T10:00:01Z' },
    { id: 'g3', table_key: 'tasks', kind: 'scene', entity_ids: ['s'], created_at: '2026-10-17T10:00:00Z' },
    { id: 'g4', table_key: 'assets', kind: 'scene', entity_ids: ['s'], created_at: '2026-10-17T10:00:00Z' },
  ]

  it('of a table and kind, oldest first; found by set in any order', () => {
    expect(groupingsOfTable(groupings, 'tasks', 'asset').map(g => g.id)).toEqual(['g1', 'g2'])
    expect(findGroupingBySet(groupings, 'tasks', 'asset', ['a', 'b'])?.id).toBe('g2')
    expect(findGroupingBySet(groupings, 'assets', 'scene', ['s'])?.id).toBe('g4')
    expect(findGroupingBySet(groupings, 'tasks', 'asset', ['c'])).toBe(null)
  })

  it('a grouping shows only while every item it names is live (an asset in the trash hides it)', () => {
    const live = new Set(['asset:a'])
    const isLive = (kind, id) => live.has(`${kind}:${id}`)
    expect(isGroupingLive(groupings[1], isLive)).toBe(true)
    expect(isGroupingLive(groupings[0], isLive)).toBe(false)
    live.add('asset:b')
    expect(isGroupingLive(groupings[0], isLive)).toBe(true) // back on restore
    expect(isGroupingLive({ kind: 'asset', entity_ids: [] }, () => true)).toBe(false)
  })
})

describe('the sweep: an item deleted for good leaves its groupings (0098 §5)', () => {
  it('shrinks; removes one left empty; removes one left naming another\'s set', () => {
    const groupings = [
      { id: '1', table_key: 'tasks', kind: 'asset', entity_ids: ['A', 'B'] },
      { id: '2', table_key: 'tasks', kind: 'asset', entity_ids: ['A'] },
      { id: '3', table_key: 'tasks', kind: 'asset', entity_ids: ['B'] },
      { id: '4', table_key: 'tasks', kind: 'asset', entity_ids: ['B', 'C'] },
      { id: '5', table_key: 'levels', kind: 'asset', entity_ids: ['A', 'B'] }, // another table: its own sets
      { id: '6', table_key: 'tasks', kind: 'scene', entity_ids: ['B'] },        // another kind: untouched
    ]
    expect(planForgetItem(groupings, 'asset', 'B')).toEqual({
      remove: ['1', '3'],
      update: [{ id: '4', entity_ids: ['C'] }, { id: '5', entity_ids: ['A'] }],
    })
  })

  it('CONTROL: without a grouping already naming the shrunk set, it only shrinks', () => {
    const groupings = [{ id: '1', table_key: 'tasks', kind: 'asset', entity_ids: ['A', 'B'] }]
    expect(planForgetItem(groupings, 'asset', 'B')).toEqual({ remove: [], update: [{ id: '1', entity_ids: ['A'] }] })
  })

  it('an id nobody names changes nothing', () => {
    expect(planForgetItem([{ id: '1', table_key: 'tasks', kind: 'asset', entity_ids: ['A'] }], 'asset', 'Z')).toEqual({ remove: [], update: [] })
  })
})

describe('the last used view (Q4; 0098 §9)', () => {
  it('keys a project\'s table; refuses what set_table_view_last refuses', () => {
    expect(tableViewLastKey('p1', 'tasks')).toBe('p1:tasks')
    expect(tableViewLastKeyProblem('f1c70000-0003-4000-8000-000000000001:tasks')).toBe(null)
    expect(tableViewLastKeyProblem('p1:budget')).not.toBe(null)
    expect(tableViewLastKeyProblem(':tasks')).not.toBe(null)
    expect(tableViewLastKeyProblem('p1/..:tasks')).not.toBe(null)
    expect(tableViewLastKeyProblem(null)).not.toBe(null)
    expect(isViewIdOrAll('all')).toBe(true)
    expect(isViewIdOrAll('f1c70000-0030-4000-8000-000000000001')).toBe(true)
    expect(isViewIdOrAll('a view')).toBe(false)
    expect(isViewIdOrAll(null)).toBe(false)
  })

  it('a write merges its one key and never replaces the map', () => {
    const map = mergeTableViewLast({ 'p:tasks': { view: 'v1', at: 1 } }, 'p:assets', 'all', 2)
    expect(map).toEqual({ 'p:tasks': { view: 'v1', at: 1 }, 'p:assets': { view: 'all', at: 2 } })
    expect(mergeTableViewLast(null, 'p:tasks', 'v2', 3)).toEqual({ 'p:tasks': { view: 'v2', at: 3 } })
  })

  it('keeps the 300 newest by `at`; an entry without a number `at` goes first; ties keep keys A to Z', () => {
    let map = { 'bad:tasks': { view: 'all', at: 'yesterday' } }
    for (let i = 1; i <= TABLE_VIEW_LAST_MAX - 1; i++) map[`p${String(i).padStart(3, '0')}:tasks`] = { view: 'all', at: 1000 + i }
    expect(Object.keys(map)).toHaveLength(300)
    const next = mergeTableViewLast(map, 'new:tasks', 'all', 99999)
    expect(Object.keys(next)).toHaveLength(300)
    expect(next).not.toHaveProperty('bad:tasks')
    expect(next).toHaveProperty('new:tasks')
    expect(next).toHaveProperty('p001:tasks')
    const tied = mergeTableViewLast(Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`k${String(i).padStart(3, '0')}:tasks`, { view: 'all', at: 5 }])), 'zz:tasks', 'all', 5)
    expect(tied).not.toHaveProperty('zz:tasks') // the tie keeps keys A to Z, as the cloud's ORDER BY … key
    expect(tied).toHaveProperty('k000:tasks')
  })

  it('reads a person\'s last view of a table: an id, "all", or null when never chosen', () => {
    const map = { 'p:tasks': { view: 'v1', at: 1 }, 'p:assets': { view: 'all', at: 1 }, 'p:shots': { view: 'not ok', at: 1 } }
    expect(readTableViewLast(map, 'p', 'tasks')).toBe('v1')
    expect(readTableViewLast(map, 'p', 'assets')).toBe('all')
    expect(readTableViewLast(map, 'p', 'shots')).toBe(null)
    expect(readTableViewLast(map, 'p', 'levels')).toBe(null)
    expect(readTableViewLast(null, 'p', 'tasks')).toBe(null)
  })
})
