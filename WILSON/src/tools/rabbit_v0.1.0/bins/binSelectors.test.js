// =============================================================================
// binSelectors.test.js — the Bins view's pure logic (demo 2026-09-11).
// =============================================================================

import { describe, it, expect } from 'vitest'
import {
  buildBinTree, flattenTree, descendantIds, binPathLabel, countsByBin,
  sortBinFiles, slateKey, filterBinFiles, EMPTY_FILTERS, isFilterEmpty, activeFilterCount,
  matchesSearch, binStats, distinctValues, mixedValue, stepId, rangeIds,
} from './binSelectors.js'

const bins = [
  { id: 'a', name: 'Dailies', parent_bin_id: null, sort_order: 1 },
  { id: 'b', name: 'Scene 12', parent_bin_id: null, sort_order: 0 },
  { id: 'a1', name: 'Day 02', parent_bin_id: 'a', sort_order: 1 },
  { id: 'a0', name: 'Day 01', parent_bin_id: 'a', sort_order: 0 },
  { id: 'a00', name: 'A cam', parent_bin_id: 'a0', sort_order: 0 },
  { id: 'orphan', name: 'Lost', parent_bin_id: 'ghost', sort_order: 0 },
]
const files = [
  { id: 'f1', bin_id: 'a0', display_name: 'Master', original_name: 'A001C001.mov', media_type: 'video', slate: '12', take_number: 1, camera: 'A', shoot_day: '2026-06-12', duration_sec: 10, size_bytes: 100, review_flag: 'select', circled: true, color: 'green', tags: ['hero'], sort_order: 2, online: true },
  { id: 'f2', bin_id: 'a0', display_name: 'Close up', original_name: '12A_2_T3.mov', media_type: 'video', slate: '12A', take_number: 3, camera: 'B', shoot_day: '2026-06-12', duration_sec: 5, size_bytes: 50, review_flag: 'reject', circled: false, color: null, tags: [], sort_order: 0, online: false },
  { id: 'f3', bin_id: 'a1', display_name: 'Wide', original_name: '100_1.mov', media_type: 'video', slate: '100', take_number: null, camera: 'A', shoot_day: '2026-06-13', duration_sec: 7, size_bytes: 70, review_flag: 'unflagged', circled: false, color: 'red', tags: ['b-roll'], sort_order: 1, online: true, notes: 'boom in shot' },
  { id: 'f4', bin_id: 'b', display_name: 'Sc 12 selects', original_name: 'plate_seq', media_type: 'sequence', slate: null, take_number: null, camera: null, shoot_day: null, duration_sec: null, size_bytes: 0, review_flag: 'unflagged', circled: false, color: null, tags: [], sort_order: 0, online: true },
]

describe('tree', () => {
  it('orders siblings by sort_order, nests children, keeps orphans reachable', () => {
    const tree = buildBinTree(bins)
    expect(tree.map(n => n.bin.id)).toEqual(['b', 'a', 'orphan'])
    expect(tree[1].children.map(n => n.bin.id)).toEqual(['a0', 'a1'])
    expect(tree[1].children[0].children[0].bin.id).toBe('a00')
  })
  it('flattens with depth and respects the expanded set', () => {
    const all = flattenTree(buildBinTree(bins))
    expect(all.map(n => `${n.depth}:${n.bin.id}`)).toEqual(['0:b', '0:a', '1:a0', '2:a00', '1:a1', '0:orphan'])
    const some = flattenTree(buildBinTree(bins), new Set(['a']))
    expect(some.map(n => n.bin.id)).toEqual(['b', 'a', 'a0', 'a1', 'orphan'])
    expect(some.find(n => n.bin.id === 'a0').hasChildren).toBe(true)
  })
  it('descendants, path labels and counts include the whole subtree', () => {
    expect([...descendantIds(bins, 'a')].sort()).toEqual(['a', 'a0', 'a00', 'a1'])
    expect(binPathLabel(bins, 'a00')).toBe('Dailies / Day 01 / A cam')
    const counts = countsByBin(bins, files)
    expect(counts.get('a')).toBe(3)
    expect(counts.get('a0')).toBe(2)
    expect(counts.get('a00')).toBe(0)
    expect(counts.get('b')).toBe(1)
  })
})

describe('sort', () => {
  it('manual order is sort_order', () => {
    expect(sortBinFiles(files, { field: 'sort_order' }).map(f => f.id)).toEqual(['f2', 'f4', 'f3', 'f1'])
  })
  it('slates sort naturally: 12, 12A, 100, then blanks last', () => {
    expect(slateKey('12A')).toEqual([12, 'a'])
    expect(sortBinFiles(files, { field: 'slate' }).map(f => f.slate)).toEqual(['12', '12A', '100', null])
  })
  it('numbers sort as numbers with nulls first ascending, and desc flips', () => {
    expect(sortBinFiles(files, { field: 'duration_sec' }).map(f => f.id)).toEqual(['f4', 'f2', 'f3', 'f1'])
    expect(sortBinFiles(files, { field: 'duration_sec', dir: 'desc' }).map(f => f.id)).toEqual(['f1', 'f3', 'f2', 'f4'])
  })
  it('flags rank select, unflagged, reject; strings put blanks last', () => {
    expect(sortBinFiles(files, { field: 'review_flag' }).map(f => f.id)).toEqual(['f1', 'f4', 'f3', 'f2'])
    expect(sortBinFiles(files, { field: 'camera' }).map(f => f.camera)).toEqual(['A', 'A', 'B', null])
  })
})

describe('filter and search', () => {
  it('an empty filter passes everything', () => {
    expect(isFilterEmpty(EMPTY_FILTERS)).toBe(true)
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0)
    expect(filterBinFiles(files, EMPTY_FILTERS, '').length).toBe(4)
  })
  it('each chip narrows', () => {
    expect(filterBinFiles(files, { ...EMPTY_FILTERS, mediaTypes: ['sequence'] }, '').map(f => f.id)).toEqual(['f4'])
    expect(filterBinFiles(files, { ...EMPTY_FILTERS, flags: ['select', 'reject'] }, '').map(f => f.id)).toEqual(['f1', 'f2'])
    expect(filterBinFiles(files, { ...EMPTY_FILTERS, circled: true }, '').map(f => f.id)).toEqual(['f1'])
    expect(filterBinFiles(files, { ...EMPTY_FILTERS, colors: ['none'] }, '').map(f => f.id)).toEqual(['f2', 'f4'])
    expect(filterBinFiles(files, { ...EMPTY_FILTERS, cameras: ['a'] }, '').map(f => f.id)).toEqual(['f1', 'f3'])
    expect(filterBinFiles(files, { ...EMPTY_FILTERS, days: ['2026-06-13'] }, '').map(f => f.id)).toEqual(['f3'])
    expect(filterBinFiles(files, { ...EMPTY_FILTERS, tags: ['HERO'] }, '').map(f => f.id)).toEqual(['f1'])
    expect(filterBinFiles(files, { ...EMPTY_FILTERS, online: false }, '').map(f => f.id)).toEqual(['f2'])
    expect(activeFilterCount({ ...EMPTY_FILTERS, online: false, tags: ['x'] })).toBe(2)
  })
  it('search hits name, file name, slate, notes, tags, and every term must match', () => {
    expect(matchesSearch(files[2], 'boom')).toBe(true)
    expect(matchesSearch(files[0], 'a001c001')).toBe(true)
    expect(matchesSearch(files[1], '12a')).toBe(true)
    expect(matchesSearch(files[0], 'hero master')).toBe(true)
    expect(matchesSearch(files[0], 'hero wide')).toBe(false)
    expect(filterBinFiles(files, EMPTY_FILTERS, 'wide').map(f => f.id)).toEqual(['f3'])
  })
})

describe('stats and values', () => {
  it('binStats sums what the header shows', () => {
    expect(binStats(files)).toEqual({ count: 4, durationSec: 22, sizeBytes: 220, offline: 1, selects: 1, rejects: 1, circled: 1 })
    expect(binStats([]).count).toBe(0)
  })
  it('distinctValues collects tags and scalars', () => {
    expect(distinctValues(files, 'camera')).toEqual(['A', 'B'])
    expect(distinctValues(files, 'tags')).toEqual(['b-roll', 'hero'])
  })
  it('mixedValue reports shared versus differing values, arrays included', () => {
    expect(mixedValue([files[0], files[2]], 'camera')).toEqual({ value: 'A', mixed: false })
    expect(mixedValue([files[0], files[1]], 'camera')).toEqual({ value: null, mixed: true })
    expect(mixedValue([files[1], files[3]], 'tags')).toEqual({ value: [], mixed: false })
    expect(mixedValue([], 'camera')).toEqual({ value: null, mixed: false })
  })
  it('keyboard stepping clamps and ranges are inclusive', () => {
    const ids = ['a', 'b', 'c', 'd']
    expect(stepId(ids, 'b', 1)).toBe('c')
    expect(stepId(ids, 'd', 5)).toBe('d')
    expect(stepId(ids, null, 1)).toBe('a')
    expect(stepId(ids, null, -1)).toBe('d')
    expect(stepId([], 'a', 1)).toBeNull()
    expect(rangeIds(ids, 'c', 'a')).toEqual(['a', 'b', 'c'])
    expect(rangeIds(ids, 'zz', 'b')).toEqual(['b'])
  })
})

describe('sort with many nulls (adversarial review)', () => {
  it('rows sharing a null still fall back to manual order, never NaN', () => {
    const rows = [
      { id: 'a', take_number: null, sort_order: 3, display_name: 'a' },
      { id: 'b', take_number: null, sort_order: 1, display_name: 'b' },
      { id: 'c', take_number: 2, sort_order: 9, display_name: 'c' },
      { id: 'd', take_number: null, sort_order: 0, display_name: 'd' },
    ]
    expect(sortBinFiles(rows, { field: 'take_number' }).map(r => r.id)).toEqual(['d', 'b', 'a', 'c'])
    // Every duration undefined: the tie-break is manual order, flipped for desc.
    expect(sortBinFiles(rows, { field: 'duration_sec', dir: 'desc' }).map(r => r.id)).toEqual(['c', 'a', 'b', 'd'])
  })
  it('countsByBin survives a parent cycle on disk without looping or double counting', () => {
    const cyc = [{ id: 'x', parent_bin_id: 'y', sort_order: 0 }, { id: 'y', parent_bin_id: 'x', sort_order: 0 }]
    const c = countsByBin(cyc, [{ id: 'f', bin_id: 'x' }])
    expect(Number.isFinite(c.get('x')) && Number.isFinite(c.get('y'))).toBe(true)
    expect(Math.max(c.get('x'), c.get('y'))).toBe(1)
  })
})
