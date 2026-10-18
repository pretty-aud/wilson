// =============================================================================
// tableViewsParity.test.js — VW1c (0098): the Local Server's copy of the views'
// and groupings' rules (electron/rabbitTableViews.cjs, CommonJS so a
// synchronous route can run it) and the one statement of them
// (state/tableViewsModel.js) answer the same cases the same way. A rule
// changed in one file and not the other fails here, before a project behaves
// differently on the signed-out desktop than in the cloud (A9: "the system to
// work the same").
//
// FX2's lesson (taskItemsParity.test.js): agreement on inputs where every
// plausible rule agrees proves nothing. So each rule's cases come with a
// CONTROL whose inputs disagree on every rule but the one under test — the
// position, the time, the microseconds and the id each name a different first
// view; a count, an array order or a UTF-16 length each give another answer —
// and the control proves the cases tell them apart, so a twin that kept a
// neighbouring rule (taskItemsModel's timeOf, localeCompare, `.length`, a
// Number() of a string `at`) fails the comparison.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import * as esm from './tableViewsModel'
import { compareItems } from './taskItemsModel'

const require = createRequire(import.meta.url)
const cjs = require('../../../../electron/rabbitTableViews.cjs')

// ── What each copy carries ──────────────────────────────────────────────────
const SHARED_CONSTANTS = [
  'TABLE_KEYS', 'GROUPING_KINDS', 'VIEW_NAME_MAX', 'VIEW_CONFIG_MAX_BYTES', 'VIEWS_PER_TABLE_MAX',
  'GROUPINGS_PER_TABLE_MAX', 'GROUPING_IDS_MAX', 'TABLE_VIEW_LAST_MAX', 'ALL_VIEW_ID', 'MAX_VIEW_POSITION',
]
const SHARED_RULES = [
  'isTableKey', 'isGroupingPair', 'normalizeViewName', 'viewNameProblem', 'utf8Length', 'canonicalJson',
  'configsEqual', 'jsonbText', 'viewConfigProblem', 'compareViews', 'compareViewRows', 'compareGroupingRows',
  'viewsOfTable', 'nextViewPosition', 'planReorderViews',
  'normalizeEntityIds', 'groupingKeyOf', 'groupingProblem', 'findGroupingBySet', 'planForgetItem',
  'tableViewLastKey', 'tableViewLastKeyProblem', 'isViewIdOrAll', 'mergeTableViewLast',
]
// The twin's own: the bundle-level sweep and read, the hooks' wrapper, the routes.
const TWIN_OWN = ['forgetGoneItems', 'reconcileTableViewsOnRead', 'withItemGroupingSweep', 'mountRabbitTableViews']
// The screens' half, which stays ESM-only (the brief: readViewConfig,
// writeViewConfig, defaultViewConfig, allViewOf and what they lean on).
const SCREENS_ONLY = [
  'VIEW_CONFIG_VERSION', 'ALL_VIEW_NAME', 'LAYOUTS_BY_TABLE', 'FILTER_VALUELESS_OPS', 'isCompleteFilter',
  'defaultViewConfig', 'readViewConfig', 'writeViewConfig', 'allViewOf', 'groupingsOfTable', 'isGroupingLive',
  'readTableViewLast',
]

// ── Running both ────────────────────────────────────────────────────────────
function outcome(fn, args) {
  try {
    return { value: fn(...args) }
  } catch (e) {
    return { threw: { name: e?.name, message: e?.message, code: e?.code } }
  }
}
function label(args) {
  try {
    const s = JSON.stringify(args, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v === undefined ? '<undefined>' : v))
    return s.length > 160 ? `${s.slice(0, 157)}...` : s
  } catch {
    return '<unprintable>'
  }
}
/** Every case through both copies: the same value, or the same refusal. */
function agree(name, cases) {
  expect(cases.length, `${name} has cases`).toBeGreaterThan(0)
  for (const args of cases) {
    expect(outcome(cjs[name], args), `${name}(${label(args)})`).toEqual(outcome(esm[name], args))
  }
}

// ── Fixtures ────────────────────────────────────────────────────────────────
const view = (id, table, position, created_at) => ({ id, project_id: 'p', table_key: table, name: id, position, created_at })
const grouping = (id, table, kind, ids) => ({ id, project_id: 'p', table_key: table, kind, entity_ids: ids })
const UUID = '6f1c2a9e-1b2c-4d3e-8f90-0a1b2c3d4e5f'

// Views whose position, time, microseconds and id each point another way.
const VIEWS = [
  view('v-c', 'tasks', 0, '2026-10-17T10:00:00.000Z'),
  view('v-a', 'tasks', 1, '2026-10-17T09:00:00.000Z'),
  view('v-b', 'tasks', 1, '2026-10-17T08:00:00.000Z'), // ties v-a on position, older, later id
  view('v-0', 'tasks', 2, '2026-10-17T07:00:00.000Z'), // the lowest id and the oldest of these, yet third
  // One millisecond, two microseconds: the lower id is the later time.
  view('v-m2', 'tasks', 3, '2026-10-17T06:17:56.123456+00:00'),
  view('v-m1', 'tasks', 3, '2026-10-17T06:17:56.123789+00:00'),
  // Seven digits: .4567 against .4561 — taskItemsModel's timeOf reads both as .456.
  view('v-s1', 'tasks', 4, '2026-10-17T05:00:00.1234567Z'),
  view('v-s2', 'tasks', 4, '2026-10-17T05:00:00.1234561Z'),
  // Same position and time: the id decides.
  view('v-y', 'tasks', 5, '2026-10-17T04:00:00.000Z'),
  view('v-x', 'tasks', 5, '2026-10-17T04:00:00.000Z'),
  // Stored oddly: a string position, none, a negative one, no or a bad time.
  view('v-str', 'tasks', '6', '2026-10-17T03:00:00.000Z'),
  view('v-none', 'tasks', undefined, undefined),
  view('v-neg', 'tasks', -1, 'not a date'),
  view('w-2', 'assets', 0, '2026-10-17T11:00:00.000Z'),
  view('w-1', 'assets', 0, '2026-10-17T10:00:00.000Z'),
  view('l-1', 'levels', 2, '2026-10-17T10:00:00.000Z'),
  null,
]

describe('the CommonJS copy says what the model says', () => {
  it('carries exactly the backend half: every shared rule, nothing of the screens, and every model export is placed', () => {
    for (const name of [...SHARED_CONSTANTS, ...SHARED_RULES]) {
      expect(cjs, name).toHaveProperty(name)
      expect(esm, name).toHaveProperty(name)
    }
    for (const name of SHARED_RULES) expect(typeof cjs[name], name).toBe('function')
    expect(Object.keys(cjs).filter(k => ![...SHARED_CONSTANTS, ...SHARED_RULES, ...TWIN_OWN].includes(k))).toEqual([])
    for (const name of SCREENS_ONLY) {
      expect(esm, name).toHaveProperty(name)
      expect(cjs, name).not.toHaveProperty(name)
    }
    // A rule the model gains fails here until it is placed: shared (and
    // copied, and compared below) or the screens'.
    expect(Object.keys(esm).filter(k => ![...SHARED_CONSTANTS, ...SHARED_RULES, ...SCREENS_ONLY].includes(k))).toEqual([])
  })

  it('the same constants, frozen alike, the grouping pairs in the same order', () => {
    for (const k of SHARED_CONSTANTS) expect(cjs[k], k).toEqual(esm[k])
    expect(Object.keys(cjs.GROUPING_KINDS)).toEqual(Object.keys(esm.GROUPING_KINDS))
    expect(Object.isFrozen(cjs.TABLE_KEYS)).toBe(Object.isFrozen(esm.TABLE_KEYS))
    expect(Object.isFrozen(cjs.GROUPING_KINDS)).toBe(Object.isFrozen(esm.GROUPING_KINDS))
    for (const t of Object.keys(esm.GROUPING_KINDS)) {
      expect(Object.isFrozen(cjs.GROUPING_KINDS[t]), t).toBe(Object.isFrozen(esm.GROUPING_KINDS[t]))
    }
    // 0098's numbers, so both copies cannot drift together from the cloud.
    expect([cjs.VIEW_NAME_MAX, cjs.VIEW_CONFIG_MAX_BYTES, cjs.VIEWS_PER_TABLE_MAX, cjs.GROUPINGS_PER_TABLE_MAX,
      cjs.GROUPING_IDS_MAX, cjs.TABLE_VIEW_LAST_MAX, cjs.ALL_VIEW_ID]).toEqual([80, 32768, 200, 500, 100, 300, 'all'])
  })

  // ── Tables and pairs ──────────────────────────────────────────────────────
  const TABLE_INPUTS = [...esm.TABLE_KEYS, 'Tasks', ' tasks', 'tasks ', 'task', 'milestones', '', null, undefined, 0, 1,
    ['tasks'], { toString: () => 'tasks' }, 'toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf']
  const KIND_INPUTS = ['asset', 'scene', 'shot', 'level', 'experience', 'Asset', 'assets', 'task', 'phase', '', null, undefined, ['asset']]

  it('isTableKey and isGroupingPair, for every table and kind and the near misses', () => {
    agree('isTableKey', TABLE_INPUTS.map(k => [k]))
    agree('isGroupingPair', TABLE_INPUTS.flatMap(t => KIND_INPUTS.map(k => [t, k])))
  })
  it('CONTROL: the pairs are 0098\'s CHECK, and a name the prototype carries is no table', () => {
    expect(esm.isGroupingPair('tasks', 'experience')).toBe(true)
    expect(esm.isGroupingPair('assets', 'asset')).toBe(false)
    expect(esm.isGroupingPair('scenes', 'asset')).toBe(false)
    expect(esm.isGroupingPair('levels', 'scene')).toBe(false)
    // A copy reading GROUPING_KINDS[t] without the own-property guard throws
    // on these (Object.prototype.toString is a function, not a list).
    const unguarded = (t, k) => (esm.GROUPING_KINDS[t] || []).includes(k)
    for (const t of ['toString', 'constructor', 'hasOwnProperty', 'valueOf']) {
      expect(() => unguarded(t, 'asset'), t).toThrow(TypeError)
      expect(esm.isGroupingPair(t, 'asset'), t).toBe(false)
    }
  })

  // ── Names ─────────────────────────────────────────────────────────────────
  const ASTRAL_80 = '😀'.repeat(80) // 80 characters, 160 UTF-16 units
  const NAMES = [
    'My view', '  My view  ', '\tMy view', 'My view\n', '', '   ', 'a'.repeat(80), 'a'.repeat(81), ASTRAL_80,
    'a\udc00b', 'a\ud800', '\udbffa', 'pair \ud83d\ude00 ok',
    `${ASTRAL_80}😀`, 'a\nb', 'a\tb', 'a\u0000b', 'a\u001fb', 'a\u007fb', 'a\u0085b', 'a\u009fb', 'a b',
    ' x ', 'x﻿', 'a b', 'Café ✓', null, undefined, 42, ['x'], { name: 'x' },
  ]
  it('normalizeViewName and viewNameProblem, word for word (raw and trimmed)', () => {
    agree('normalizeViewName', NAMES.map(n => [n]))
    agree('viewNameProblem', NAMES.map(n => [n]))
    agree('viewNameProblem', NAMES.map(n => [esm.normalizeViewName(n)]))
  })
  it('CONTROL: a name is counted in characters, bounded inclusively, and C1 controls are refused while a no-break space is not', () => {
    expect(ASTRAL_80.length).toBe(160)
    expect(esm.viewNameProblem(ASTRAL_80)).toBeNull() // a UTF-16 .length count refuses it
    expect(esm.viewNameProblem(`${ASTRAL_80}😀`)).toMatch(/at most 80/)
    expect(esm.viewNameProblem('a'.repeat(80))).toBeNull() // an off-by-one (>=) refuses it
    expect(esm.viewNameProblem('a\u0085b')).toMatch(/line break or a tab/) // a C0-only class passes it
    expect(esm.viewNameProblem('a b')).toBeNull() // a \s class refuses it
    expect(esm.viewNameProblem(' x ')).toMatch(/start or end with a space/) // a ' '-only trim passes it
  })

  // ── Configs ───────────────────────────────────────────────────────────────
  const TEXTS = ['', 'a', 'abc', 'é', '€', '😀', 'a😀é€', '\ud800', '\udc00x', 'x\ud83d', 123, null, undefined, true, { a: 1 }]
  it('utf8Length', () => {
    agree('utf8Length', TEXTS.map(t => [t]))
  })
  it('CONTROL: UTF-8 bytes, not UTF-16 units — a lone surrogate counted as Buffer counts it', () => {
    expect(esm.utf8Length('é')).toBe(2)
    expect('é'.length).toBe(1)
    expect(esm.utf8Length('😀')).toBe(4)
    expect('😀'.length).toBe(2)
    for (const t of ['a😀é€', '\ud800', '\udc00x', 'x\ud83d']) expect(esm.utf8Length(t), t).toBe(Buffer.byteLength(t, 'utf8'))
  })

  const KEYED = { 'é': 1, 'e': 2, 'E': 3, '10': 4, '9': 5 }
  const sparse = [1]
  sparse[2] = 3
  const circular = () => { const o = { a: 1 }; o.self = o; return o }
  const VALUES = [
    null, undefined, 0, -1.5, 'x', 'q"uote', true, [], {}, [1, 'a', null], [1, undefined, 3], sparse,
    { b: 1, a: 2 }, { a: 2, b: 1 }, { a: undefined, b: 1 }, { z: { y: [{ b: 1, a: 2 }] }, a: [] }, KEYED,
    new Date(0), NaN, Infinity, [NaN], () => 1, { f: () => 1 }, { n: 10n }, circular(),
    // Review round 2, R2-4: what JSON.stringify writes with an exponent.
    1e21, 1e-7, [1e300], -2.5e22, 5e-324, { v: 1.5e-7 },
  ]
  it('canonicalJson, including what JSON cannot say (and what makes it throw)', () => {
    agree('canonicalJson', VALUES.map(v => [v]))
  })
  const PAIRS = [
    [{ a: 1, b: 2 }, { b: 2, a: 1 }], [{ a: undefined }, {}], [[1, undefined], [1, null]], [{ a: 1 }, { a: '1' }],
    [{ a: [1, 2] }, { a: [2, 1] }], [{}, []], [null, undefined], [{ x: { b: 1, a: 2 } }, { x: { a: 2, b: 1 } }],
    [{ v: 1, filters: [] }, { filters: [], v: 1, extra: undefined }], [NaN, null], [KEYED, { ...KEYED }],
  ]
  it('configsEqual', () => {
    agree('configsEqual', PAIRS)
  })
  it('CONTROL: key order and undefined keys do not count; values, array order and types do; keys sort by code unit', () => {
    expect(JSON.stringify({ a: 1, b: 2 })).not.toBe(JSON.stringify({ b: 2, a: 1 }))
    expect(esm.configsEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
    expect(esm.configsEqual({ a: undefined }, {})).toBe(true)
    expect(esm.configsEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false)
    expect(esm.configsEqual({ a: 1 }, { a: '1' })).toBe(false)
    expect(esm.canonicalJson(KEYED)).toBe('{"10":4,"9":5,"E":3,"e":2,"é":1}')
    expect(Object.keys(KEYED).sort((x, y) => x.localeCompare(y))).not.toEqual(['10', '9', 'E', 'e', 'é'])
  })

  // Review round 1 (R1-5): 0098's CHECK measures octet_length(config::text),
  // jsonb's own text, which has ": " and ", " — so { k: 'x'.repeat(n - 9) }
  // is exactly n bytes there ({"k": ""} is 9).
  const sized = (bytes) => ({ k: 'x'.repeat(bytes - 9) })
  it('jsonbText is jsonb\'s own text, as wilson-dev printed it (and the twin agrees)', () => {
    agree('jsonbText', VALUES.map(v => [v]))
    // From wilson-dev, 2026-10-17: '{"sorts":[{"field":"title","dir":"asc"}],"version":1,"filters":[],
    // "zz":"é\n\"q","b":{"bb":true,"a":null},"n":-1.5}'::jsonb::text — 132 bytes.
    const sample = { sorts: [{ field: 'title', dir: 'asc' }], version: 1, filters: [], zz: 'é\n"q', b: { bb: true, a: null }, n: -1.5 }
    const printed = '{"b": {"a": null, "bb": true}, "n": -1.5, "zz": "é\\n\\"q", "sorts": [{"dir": "asc", "field": "title"}], "filters": [], "version": 1}'
    expect(esm.jsonbText(sample)).toBe(printed)
    expect(cjs.jsonbText(sample)).toBe(printed)
    expect(esm.utf8Length(printed)).toBe(132)
    // CONTROL: JSON.stringify is not that text, and is shorter.
    expect(esm.utf8Length(JSON.stringify(sample))).toBeLessThan(132)
  })
  // 11,008 UTF-16 units but 33,008 UTF-8 bytes.
  const wide = () => ({ k: '€'.repeat(11000) })
  const CONFIGS = [null, undefined, [], 'x', 1, true, {}, { version: 1 }, sized(32768), sized(32769), wide(), circular(),
    { n: 10n }, new Date(0), Object.create(null),
    // Review round 2, R2-4: the characters jsonb refuses, and the cap met by a number jsonb prints longer.
    { v: 'a\u0000b' }, { ['\udc00']: 1 }, { v: ['x\ud800'] }, { v: '\ud83d\ude00' }, { f: () => '\u0000' },
    { k: 'x'.repeat(32730), v: 1e21 }, { k: 'x'.repeat(32731), v: 1e21 }]
  // Review round 2, R2-4: numbers as jsonb prints them, and the characters
  // jsonb refuses, both copies (the bytes are wilson-dev's of 2026-10-17).
  it('jsonbText prints a number as jsonb does, never with an exponent, in both copies', () => {
    const printed = [[1e21, 29], [1e-7, 16], [[1e300], 310], [1.5e-7, 17], [-2.5e22, 31], [5e-324, 333],
      [1.7976931348623157e308, 316], [123456789012345680000, 28], [0.000001, 15], [1.2345e-10, 23]]
    for (const [v, bytes] of printed) {
      expect(esm.utf8Length(esm.jsonbText({ v })), `esm ${v}`).toBe(bytes)
      expect(cjs.utf8Length(cjs.jsonbText({ v })), `cjs ${v}`).toBe(bytes)
    }
  })
  it('CONTROL: an exponent is what JSON.stringify writes for them, and its count is short of jsonb\'s', () => {
    expect(JSON.stringify(1e21)).toBe('1e+21')
    expect(JSON.stringify(1e-7)).toBe('1e-7')
    expect(esm.utf8Length(JSON.stringify({ v: 1e21 }))).toBeLessThan(29)
  })
  it('viewConfigProblem, word for word', () => {
    agree('viewConfigProblem', CONFIGS.map(c => [c]))
  })
  it('CONTROL: the cap is 32,768 UTF-8 bytes of JSON, inclusive', () => {
    expect(esm.jsonbText(sized(32768)).length).toBe(32768)
    expect(JSON.stringify(sized(32768)).length).toBe(32767) // JSON.stringify would let 32769 through
    expect(esm.viewConfigProblem(sized(32768))).toBeNull() // a >= refuses it
    expect(esm.viewConfigProblem(sized(32769))).toMatch(/32 KB/)
    expect(JSON.stringify(wide()).length).toBeLessThan(32768) // a .length count passes it
    expect(esm.viewConfigProblem(wide())).toMatch(/32 KB/)
  })

  // ── Views ─────────────────────────────────────────────────────────────────
  it('compareViews: the same order, every pair', () => {
    for (const a of VIEWS) for (const b of VIEWS) {
      expect(Math.sign(cjs.compareViews(a, b)), `${a?.id} vs ${b?.id}`).toBe(Math.sign(esm.compareViews(a, b)))
    }
  })
  it('CONTROL: the pairs tell the dropdown\'s order from time-first, id-first, the millisecond alone and taskItemsModel\'s microseconds', () => {
    const rows = VIEWS.filter(Boolean)
    const time = (v) => Date.parse(v.created_at) || 0
    const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    const byTime = (a, b) => time(a) - time(b)
    const millisecond = (a, b) => ((Number(a.position) || 0) - (Number(b.position) || 0)) || byTime(a, b) || byId(a, b)
    const differs = (cmp) => rows.some(a => rows.some(b => Math.sign(cmp(a, b)) !== Math.sign(esm.compareViews(a, b))))
    expect(differs(byTime)).toBe(true)
    expect(differs(byId)).toBe(true)
    expect(differs(millisecond)).toBe(true)
    // taskItemsModel's compareItems is this order but for its timeOf, which
    // keeps three digits of microseconds: only the seven-digit pair parts them.
    expect(differs(compareItems)).toBe(true)
    expect(Math.sign(compareItems(VIEWS[6], VIEWS[7]))).not.toBe(Math.sign(esm.compareViews(VIEWS[6], VIEWS[7])))
  })

  it('compareViewRows (the loads\' order of every table\'s views): the same order, every pair', () => {
    for (const a of VIEWS) for (const b of VIEWS) {
      expect(Math.sign(cjs.compareViewRows(a, b)), `${a?.id} vs ${b?.id}`).toBe(Math.sign(esm.compareViewRows(a, b)))
    }
  })
  it('CONTROL: tables in code-unit order (not TABLE_KEYS\' order), then the dropdown\'s order within each', () => {
    const sorted = VIEWS.filter(Boolean).sort(esm.compareViewRows)
    expect([...new Set(sorted.map(v => v.table_key))]).toEqual(['assets', 'levels', 'tasks'])
    expect(esm.TABLE_KEYS[0]).toBe('tasks') // a copy ranking by TABLE_KEYS would put tasks first
    expect(sorted.filter(v => v.table_key === 'tasks').map(v => v.id)).toEqual(esm.viewsOfTable(VIEWS, 'tasks').map(v => v.id))
    expect(sorted.filter(v => v.table_key === 'assets').map(v => v.id)).toEqual(['w-1', 'w-2']) // the array has w-2 first
  })

  // Groupings whose table, kind, time, microseconds and id each point another way.
  const ROWS = [
    grouping('q-9', 'tasks', 'asset', ['a']), // no time
    grouping('q-1', 'tasks', 'scene', ['a']),
    grouping('q-2', 'tasks', 'asset', ['b']),
    grouping('q-0', 'levels', 'asset', ['a']),
    grouping('q-3', 'assets', 'shot', ['a']),
    grouping('q-4', 'assets', 'level', ['a']),
    grouping('q-m2', 'tasks', 'asset', ['c']), grouping('q-m1', 'tasks', 'asset', ['d']),
    grouping('q-s1', 'tasks', 'asset', ['e']), grouping('q-s2', 'tasks', 'asset', ['f']),
    null,
  ]
  const at = { 'q-1': '2026-10-17T01:00:00Z', 'q-2': '2026-10-17T02:00:00Z', 'q-0': '2026-10-17T09:00:00Z', 'q-3': '2026-10-17T05:00:00Z',
    'q-4': '2026-10-17T06:00:00Z', 'q-m2': '2026-10-17T03:00:00.123456+00:00', 'q-m1': '2026-10-17T03:00:00.123789+00:00',
    'q-s1': '2026-10-17T04:00:00.1234567Z', 'q-s2': '2026-10-17T04:00:00.1234561Z' }
  for (const g of ROWS) if (g && at[g.id]) g.created_at = at[g.id]
  it('compareGroupingRows (the loads\' order of the groupings): the same order, every pair', () => {
    for (const a of ROWS) for (const b of ROWS) {
      expect(Math.sign(cjs.compareGroupingRows(a, b)), `${a?.id} vs ${b?.id}`).toBe(Math.sign(esm.compareGroupingRows(a, b)))
    }
  })
  it('CONTROL: table, then kind, then created_at to the seventh digit, then id — not id-first, time-first or the millisecond', () => {
    const rows = ROWS.filter(Boolean)
    expect(rows.slice().sort(esm.compareGroupingRows).map(g => g.id))
      .toEqual(['q-4', 'q-3', 'q-0', 'q-9', 'q-2', 'q-m2', 'q-m1', 'q-s2', 'q-s1', 'q-1'])
    const time = (g) => Date.parse(g.created_at) || 0
    const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    const millisecond = (a, b) => (a.table_key < b.table_key ? -1 : a.table_key > b.table_key ? 1 : 0)
      || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || (time(a) - time(b)) || byId(a, b)
    const differs = (cmp) => rows.some(a => rows.some(b => Math.sign(cmp(a, b)) !== Math.sign(esm.compareGroupingRows(a, b))))
    expect(differs(byId)).toBe(true)
    expect(differs((a, b) => time(a) - time(b))).toBe(true)
    expect(differs(millisecond)).toBe(true)
  })

  it('viewsOfTable: the same views of each table, in the same order, the stored array untouched', () => {
    const before = VIEWS.map(v => v?.id)
    for (const t of [...esm.TABLE_KEYS, 'nope', undefined]) {
      expect(cjs.viewsOfTable(VIEWS, t).map(v => v.id), String(t)).toEqual(esm.viewsOfTable(VIEWS, t).map(v => v.id))
    }
    agree('viewsOfTable', [[null, 'tasks'], ['x', 'tasks'], [[], 'tasks'], [VIEWS, 'assets']])
    expect(VIEWS.map(v => v?.id)).toEqual(before)
  })

  it('nextViewPosition, for every table and the odd stored positions', () => {
    agree('nextViewPosition', [...esm.TABLE_KEYS, 'nope'].map(t => [VIEWS, t]))
    agree('nextViewPosition', [
      [null, 'tasks'], [[], 'tasks'], [[{ table_key: 'tasks', position: 'x' }], 'tasks'],
      [[{ table_key: 'tasks', position: -5 }], 'tasks'], [[{ table_key: 'tasks', position: 2.5 }], 'tasks'],
      [[{ table_key: 'tasks', position: Infinity }], 'tasks'],
    ])
  })
  it('CONTROL: after the highest position (a string one counts), not the count, not after the last to arrive', () => {
    const tasks = VIEWS.filter(v => v && v.table_key === 'tasks')
    const next = esm.nextViewPosition(VIEWS, 'tasks')
    expect(next).toBe(7) // '6' is the highest
    expect(tasks.length).not.toBe(next)
    expect((Number(tasks[tasks.length - 1].position) || 0) + 1).not.toBe(next)
    const numbersOnly = Math.max(...tasks.map(v => (typeof v.position === 'number' ? v.position : -1))) + 1
    expect(numbersOnly).not.toBe(next)
  })

  // r4 ties r3 on position and is older; r5 is far behind; o1 is another table's.
  const R = [
    view('r1', 'tasks', 0, '2026-10-17T10:00:00Z'), view('r2', 'tasks', 1, '2026-10-17T10:00:00Z'),
    view('r3', 'tasks', 2, '2026-10-17T10:00:00Z'), view('r4', 'tasks', 2, '2026-10-17T09:00:00Z'),
    view('r5', 'tasks', 7, '2026-10-17T08:00:00Z'), view('o1', 'assets', 0, '2026-10-17T08:00:00Z'),
  ]
  const REORDERS = [
    ['tasks', ['r3', 'r1']], ['tasks', []], ['tasks', ['r1', 'r2', 'r4', 'r3', 'r5']], ['tasks', ['o1', 'r5']],
    ['tasks', ['nope', 'r2']], ['tasks', undefined], ['tasks', 'r1'], ['tasks', ['r5']], ['assets', ['o1']], ['assets', []],
    ['levels', []],
    // refusals (the cloud's 22023)
    ['nope', ['r1']], [undefined, []], ['Tasks', []], ['tasks', ['r1', 'r1']], ['tasks', ['r1', '']], ['tasks', [null]],
    ['tasks', [undefined]], ['tasks', [1, '1']],
  ]
  it('planReorderViews: the same changes, and the same refusals (message and code)', () => {
    agree('planReorderViews', REORDERS.map(([t, ids]) => [R, t, ids]))
    agree('planReorderViews', [[null, 'tasks', ['a']], [[null, R[0]], 'tasks', ['r1']]])
  })
  it('CONTROL: a stale list\'s omitted views follow the named in their current order (a tie read by created_at), and only moves are answered', () => {
    expect(esm.planReorderViews(R, 'tasks', ['r5'])).toEqual([
      { id: 'r5', position: 0 }, { id: 'r1', position: 1 }, { id: 'r2', position: 2 },
      // array order, and id order, put r3 before r4; the current order puts the older r4 first
      { id: 'r4', position: 3 }, { id: 'r3', position: 4 },
    ])
    expect(esm.planReorderViews(R, 'tasks', ['r1', 'r2', 'r4', 'r3', 'r5'])).toEqual([{ id: 'r3', position: 3 }, { id: 'r5', position: 4 }])
    const err = outcome(esm.planReorderViews, [R, 'tasks', ['r1', 'r1']]).threw
    expect(err).toMatchObject({ code: 'table_view_invalid', message: 'a view is named twice' })
  })

  // ── Groupings ─────────────────────────────────────────────────────────────
  const IDSETS = [['b', 'a', 'b'], ['B', 'a', 'A', 'b'], [10, 9, '9'], ['x', null, '', undefined, 'y'], [], null, 'ab',
    undefined, [{}, 'a'], ['é', 'e', 'z', 'E'], [UUID, UUID.toUpperCase()]]
  it('normalizeEntityIds and groupingKeyOf', () => {
    agree('normalizeEntityIds', IDSETS.map(s => [s]))
    agree('groupingKeyOf', IDSETS.map(s => [s]))
  })
  it('CONTROL: strings, distinct, in code-unit order (as Postgres orders uuids), not locale or number order', () => {
    expect(esm.normalizeEntityIds(['B', 'a', 'A', 'b'])).toEqual(['A', 'B', 'a', 'b'])
    expect(['B', 'a', 'A', 'b'].sort((x, y) => x.localeCompare(y))).not.toEqual(['A', 'B', 'a', 'b'])
    expect(esm.normalizeEntityIds([10, 9, '9'])).toEqual(['10', '9'])
    expect(esm.groupingKeyOf(['b', 'a', 'b'])).toBe('a|b')
  })

  const ids = (n) => Array.from({ length: n }, (_, i) => `i${String(i).padStart(3, '0')}`)
  const SHAPES = [
    null, [], 'x', {}, { table_key: 'tasks', kind: 'asset' }, { table_key: 'tasks', kind: 'asset', entity_ids: [] },
    { table_key: 'tasks', kind: 'asset', entity_ids: 'a' }, { table_key: 'tasks', kind: 'asset', entity_ids: ['a'] },
    { table_key: 'scenes', kind: 'asset', entity_ids: ['a'] }, { table_key: 'assets', kind: 'asset', entity_ids: ['a'] },
    { table_key: 'levels', kind: 'asset', entity_ids: ['a', 'a'] }, { table_key: 'tasks', kind: 'asset', entity_ids: ['a', null] },
    { table_key: 'tasks', kind: 'asset', entity_ids: ['a', ''] }, { table_key: 'tasks', kind: 'asset', entity_ids: ['a', 7] },
    { table_key: 'tasks', kind: 'asset', entity_ids: ids(100) }, { table_key: 'tasks', kind: 'asset', entity_ids: ids(101) },
    { table_key: 'tasks', kind: 'asset', entity_ids: [...ids(100), 'i000'] },
    { table_key: undefined, kind: undefined, entity_ids: ['a'] }, { table_key: 'tasks', kind: 'phase', entity_ids: ['a'] },
    { table_key: 'experiences', kind: 'asset', entity_ids: [' '] },
  ]
  it('groupingProblem, word for word', () => {
    agree('groupingProblem', SHAPES.map(s => [s]))
  })
  it('CONTROL: the 100 is counted on the set, not on what was sent; an id must be a string, not made one', () => {
    expect(esm.groupingProblem({ table_key: 'tasks', kind: 'asset', entity_ids: [...ids(100), 'i000'] })).toBeNull()
    expect(esm.groupingProblem({ table_key: 'tasks', kind: 'asset', entity_ids: ids(101) })).toMatch(/at most 100/)
    expect(esm.groupingProblem({ table_key: 'tasks', kind: 'asset', entity_ids: ['a', 7] })).toMatch(/each be an id/)
    expect(esm.normalizeEntityIds(['a', 7])).toEqual(['7', 'a']) // what a normalise-first copy would have accepted
  })

  const GR = [
    grouping('g1', 'tasks', 'asset', ['a', 'b']), grouping('g2', 'tasks', 'scene', ['a', 'b']),
    grouping('g3', 'levels', 'asset', ['b', 'a']), grouping('g4', 'tasks', 'asset', ['c']), null,
  ]
  it('findGroupingBySet', () => {
    const FINDS = [['tasks', 'asset', ['b', 'a', 'a']], ['tasks', 'scene', ['a', 'b']], ['levels', 'asset', ['a', 'b']],
      ['tasks', 'asset', ['a']], ['tasks', 'asset', []], ['experiences', 'asset', ['a', 'b']], ['tasks', 'asset', null],
      ['tasks', 'shot', ['a', 'b']]]
    agree('findGroupingBySet', FINDS.map(([t, k, s]) => [GR, t, k, s]))
    agree('findGroupingBySet', [[null, 'tasks', 'asset', ['a']], ['x', 'tasks', 'asset', ['a']]])
  })
  it('CONTROL: a set matches in any order and with repeats, but only in its own table and kind', () => {
    expect(esm.findGroupingBySet(GR, 'tasks', 'asset', ['b', 'a', 'a']).id).toBe('g1')
    expect(esm.findGroupingBySet(GR, 'levels', 'asset', ['a', 'b']).id).toBe('g3') // g1 comes first in the array
    expect(esm.findGroupingBySet(GR, 'tasks', 'scene', ['a', 'b']).id).toBe('g2')
    expect(esm.findGroupingBySet(GR, 'tasks', 'shot', ['a', 'b'])).toBeNull()
  })

  // Arriving out of id order on purpose (k9 and k8 first).
  const SWEEP = [
    grouping('k9', 'tasks', 'asset', ['x']), // left empty: goes
    grouping('k8', 'tasks', 'asset', ['b', 'x', 'x']), // stored oddly: shrinks to [b]
    grouping('k5', 'tasks', 'asset', ['x', 'a']), // shrinks to k2's set: goes
    grouping('k2', 'tasks', 'asset', ['a']),
    grouping('k1', 'tasks', 'asset', ['x', 'b', 'c']), // shrinks to [b, c]
    grouping('k7', 'levels', 'asset', ['x', 'a']), // shrinks to [a]: k2 is another table's
    grouping('k3', 'tasks', 'scene', ['x', 'a']), // another kind: untouched
    grouping('k6', 'tasks', 'asset', ['7', 'b']),
    null,
  ]
  it('planForgetItem: the same removals and shrinks, in the same order', () => {
    const FORGETS = [['asset', 'x'], ['asset', 'a'], ['asset', 'b'], ['scene', 'x'], ['asset', 'nope'], ['shot', 'x'], ['asset', 7]]
    agree('planForgetItem', FORGETS.map(([k, id]) => [SWEEP, k, id]))
    agree('planForgetItem', [[null, 'asset', 'x'], [[], 'asset', 'x'], ['x', 'asset', 'x']])
  })
  it('CONTROL: a shrink onto another grouping\'s set removes, but only within the table; the answer runs in id order', () => {
    const plan = esm.planForgetItem(SWEEP, 'asset', 'x')
    expect(plan).toEqual({
      remove: ['k5', 'k9'],
      update: [{ id: 'k1', entity_ids: ['b', 'c'] }, { id: 'k7', entity_ids: ['a'] }, { id: 'k8', entity_ids: ['b'] }],
    })
    // Array order would answer remove [k9, k5] and update [k8, k1, k7]; a copy
    // that removed only the empty would shrink k5; one that looked across
    // tables would remove k7; one that ignored the kind would touch k3.
    const arrival = SWEEP.filter(g => g && g.kind === 'asset' && g.entity_ids.includes('x')).map(g => g.id)
    expect(arrival).toEqual(['k9', 'k8', 'k5', 'k1', 'k7'])
  })

  // ── The last used view ────────────────────────────────────────────────────
  const KEYS = [`${UUID}:tasks`, `${UUID}:Tasks`, `${UUID}:milestones`, ':tasks', 'tasks', `${UUID}:`, `${UUID}:tasks:tasks`,
    'a:b:tasks', `${'p'.repeat(64)}:assets`, `${'p'.repeat(65)}:assets`, 'p q:tasks', 'p/q:tasks', 'p_q-1:levels',
    'é:tasks', '', null, undefined, 42, [`${UUID}:tasks`]]
  const VIEW_IDS = ['all', 'ALL', 'All', UUID, '', 'a b', 'x'.repeat(64), 'x'.repeat(65), 'a/b', 'a:b', 'é', null, undefined, 7, ['all']]
  it('tableViewLastKey, tableViewLastKeyProblem and isViewIdOrAll', () => {
    agree('tableViewLastKey', [[UUID, 'tasks'], [null, undefined], [1, 2], ['', '']])
    agree('tableViewLastKeyProblem', KEYS.map(k => [k]))
    agree('isViewIdOrAll', VIEW_IDS.map(v => [v]))
  })
  it('CONTROL: an id is 1 to 64 safe characters', () => {
    expect(esm.tableViewLastKeyProblem(`${'p'.repeat(64)}:assets`)).toBeNull()
    expect(esm.tableViewLastKeyProblem(`${'p'.repeat(65)}:assets`)).toMatch(/not a project id and a table/) // an unbounded class passes it
    expect(esm.tableViewLastKeyProblem('p/q:tasks')).toMatch(/not a project id and a table/) // a \S+ class passes it
    expect(esm.isViewIdOrAll('x'.repeat(64))).toBe(true)
    expect(esm.isViewIdOrAll('x'.repeat(65))).toBe(false)
  })

  const entry = (v, at) => ({ view: v, at })
  const full = (n, atOf = (i) => i + 1) => {
    const m = {}
    for (let i = 0; i < n; i++) m[`p${String(i).padStart(3, '0')}:tasks`] = entry('all', atOf(i))
    return m
  }
  const MERGES = [
    [null, 'k:tasks', 'all', 5], [{}, 'k:tasks', 'v1', 5], [{ 'k:tasks': entry('old', 1) }, 'k:tasks', 'v2', 9],
    [full(299), 'new:tasks', 'v', 1000], [full(300), 'new:tasks', 'v', 1000], [full(300), 'p000:tasks', 'v', 0],
    [{ ...full(300), 'junk:tasks': 'not an entry', 'str:tasks': entry('v', '99999') }, 'new:tasks', 'v', 1000],
    [full(300, () => 7), 'new:tasks', 'v', 7], [full(301), 'new:tasks', 'v', 0], [full(300), 'new:tasks', 'v', NaN],
    ['x', 'k:tasks', 'all', 1], [[], 'k:tasks', 'all', 1],
  ]
  it('mergeTableViewLast: the same map, its keys in the same order', () => {
    for (const args of MERGES) {
      expect(Object.entries(cjs.mergeTableViewLast(...args)), label(args)).toEqual(Object.entries(esm.mergeTableViewLast(...args)))
    }
  })
  it('CONTROL: an `at` that is not a number is the oldest; ties go by key A to Z; a replaced key trims nothing', () => {
    const junk = esm.mergeTableViewLast({ ...full(300), 'str:tasks': entry('v', '99999') }, 'new:tasks', 'v', 1000)
    expect(junk).not.toHaveProperty(['str:tasks']) // Number('99999') would keep it, and drop p001
    expect(junk).toHaveProperty(['p001:tasks'])
    expect(junk).not.toHaveProperty(['p000:tasks'])
    const tied = esm.mergeTableViewLast(full(300, () => 7), 'new:tasks', 'v', 7)
    expect(tied).toHaveProperty(['new:tasks']) // the order the keys arrived in would drop the newest key
    expect(tied).not.toHaveProperty(['p299:tasks'])
    expect(Object.keys(esm.mergeTableViewLast(full(300), 'p000:tasks', 'v', 0))).toHaveLength(300)
  })
})
