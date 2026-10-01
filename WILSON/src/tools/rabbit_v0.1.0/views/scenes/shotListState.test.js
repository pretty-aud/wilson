// =============================================================================
// shotListState — what the shot-list bar says about a list (post-overhaul S3b).
// =============================================================================

import { describe, it, expect } from 'vitest'
import { canonicalJson, listSaveState, restoreRouteFor } from './shotListState'
import { buildShotListSnapshot, backfillItems } from '../../state/shotListModel'

const SCENES = [
  { id: 'sc1', name: 'Lighthouse', scene_number: 1, status: 'final' },
  { id: 'sc2', name: 'Cliff path', scene_number: 2, status: 'in_progress' },
]
const SHOTS = [
  { id: 'sh1', scene_id: 'sc1', name: 'The door', shot_number: 10, frame_count: 240 },
  { id: 'sh2', scene_id: 'sc1', name: 'The lamp', shot_number: 20, frame_count: 0 },
]
const ITEMS = backfillItems(SCENES, SHOTS).map((it, i) => ({ id: `i${i}`, shot_list_id: 'l1', ...it }))
const LIST = { id: 'l1', title: 'Shoot', version: 1, snapshot: {} }
const savedList = (at = '2026-09-30T15:00:00.000Z') => ({
  ...LIST, snapshot: buildShotListSnapshot({ list: LIST, scenes: SCENES, shots: SHOTS, items: ITEMS, savedAt: at }),
})
/** The same value with every object's keys in reverse — as jsonb may hand them back. */
const reversedKeys = (v) => JSON.parse(JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).reverse()) : x)))

describe('canonicalJson', () => {
  it('one string for one value, whatever order its keys came in; arrays keep their order', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe(canonicalJson({ a: { c: null, d: [2, 1] }, b: 1 }))
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]))
    expect(canonicalJson({ a: undefined })).toBe('{"a":null}')
  })
})

describe('listSaveState', () => {
  it('never Saved: snapshot still {}', () => {
    expect(listSaveState({ list: LIST, scenes: SCENES, shots: SHOTS, items: ITEMS })).toEqual({ kind: 'never' })
  })
  it('Saved and unchanged — also when the stored snapshot\'s keys come back in another order', () => {
    const list = savedList()
    expect(listSaveState({ list, scenes: SCENES, shots: SHOTS, items: ITEMS })).toEqual({ kind: 'saved', at: '2026-09-30T15:00:00.000Z' })
    expect(listSaveState({ list: { ...list, snapshot: reversedKeys(list.snapshot) }, scenes: SCENES, shots: SHOTS, items: ITEMS }).kind).toBe('saved')
  })
  it('changed since: a shot renamed (the row is shared, D3), a shot moved, a scene added to the list', () => {
    const list = savedList()
    const renamed = SHOTS.map((s) => (s.id === 'sh1' ? { ...s, name: 'The door, wide' } : s))
    expect(listSaveState({ list, scenes: SCENES, shots: renamed, items: ITEMS }).kind).toBe('changed')
    const moved = ITEMS.map((i) => (i.shot_id === 'sh1' ? { ...i, position: 5 } : i))
    expect(listSaveState({ list, scenes: SCENES, shots: SHOTS, items: moved }).kind).toBe('changed')
    const more = [...ITEMS, { id: 'iX', shot_list_id: 'l1', scene_id: 'sc9', shot_id: null, position: 9 }]
    expect(listSaveState({ list, scenes: [...SCENES, { id: 'sc9', name: 'New', scene_number: 9 }], shots: SHOTS, items: more }).kind).toBe('changed')
  })
  it('a rename of the list itself is not a change of its content', () => {
    const list = { ...savedList(), title: 'Shoot (final)', version: 2 }
    expect(listSaveState({ list, scenes: SCENES, shots: SHOTS, items: ITEMS }).kind).toBe('saved')
  })
})

describe('restoreRouteFor', () => {
  const withdrawn = { id: 'l2', archived_at: '2026-10-01T09:00:00Z', created_by: 'u-1', archived_by: 'u-1', snapshot: {} }
  it('nothing to restore on a live list', () => {
    expect(restoreRouteFor({ list: { id: 'l1', archived_at: null }, canActivate: true, canWrite: true, makerUserId: 'u-1' })).toBeNull()
  })
  it('a manager or an admin archives it back, whoever set it aside', () => {
    expect(restoreRouteFor({ list: { ...withdrawn, archived_by: 'u-9' }, canActivate: true, canWrite: true, makerUserId: 'u-1' })).toBe('archive')
  })
  it('its maker restores what they withdrew, while it is not Saved; nobody else, and not before the user is known', () => {
    expect(restoreRouteFor({ list: withdrawn, canActivate: false, canWrite: true, makerUserId: 'u-1' })).toBe('withdrawn')
    expect(restoreRouteFor({ list: withdrawn, canActivate: false, canWrite: true, makerUserId: 'u-2' })).toBeNull()
    expect(restoreRouteFor({ list: withdrawn, canActivate: false, canWrite: true, makerUserId: null })).toBeNull()
    expect(restoreRouteFor({ list: withdrawn, canActivate: false, canWrite: false, makerUserId: 'u-1' })).toBeNull()
    expect(restoreRouteFor({ list: { ...withdrawn, snapshot: { saved_at: 'x' } }, canActivate: false, canWrite: true, makerUserId: 'u-1' })).toBeNull()
  })
  it('on the Local Server (no users, the maker test skipped) a list writer restores it', () => {
    expect(restoreRouteFor({ list: { ...withdrawn, created_by: null, archived_by: null }, canActivate: false, canWrite: true, makerUserId: undefined })).toBe('withdrawn')
  })
})
