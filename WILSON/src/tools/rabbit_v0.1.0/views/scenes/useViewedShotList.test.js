// =============================================================================
// useViewedShotList — the pure half (post-overhaul S3b, step 2): which list
// the Scenes tab shows (D2), and the rows of the "Not in any list" view.
// The hook itself is exercised mounted, through ScenesView, in
// rabbitScenesRender.test.jsx's "S3b step 2" block.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { resolveViewedList, unlistedSceneRows, UNLISTED, resolveViewedEdit } from './useViewedShotList'

// Post-overhaul S3c, step 3: which edit of the list on screen is on screen.
describe('resolveViewedEdit (S3c step 3)', () => {
  const list = { id: 'L1' }
  const edits = [{ id: 'e1', shot_list_id: 'L1' }, { id: 'x1', shot_list_id: 'L2' }]
  it('List order when nothing is chosen, or no list is on screen', () => {
    expect(resolveViewedEdit({ list, chosen: null, edits, draft: null }).mode).toBe('none')
    expect(resolveViewedEdit({ list: null, chosen: 'e1', edits, draft: null }).mode).toBe('none')
  })
  it('the chosen edit of this list; another list\'s, or a gone one, is List order', () => {
    expect(resolveViewedEdit({ list, chosen: 'e1', edits, draft: null })).toMatchObject({ mode: 'edit', id: 'e1' })
    expect(resolveViewedEdit({ list, chosen: 'x1', edits, draft: null }).mode).toBe('none')
    expect(resolveViewedEdit({ list, chosen: 'gone', edits, draft: null }).mode).toBe('none')
  })
  it('the list\'s draft is on screen whatever was chosen (a draft never hides behind another view); another list\'s draft is not', () => {
    const draft = { listId: 'L1', basedOnEditId: 'e1', items: [] }
    expect(resolveViewedEdit({ list, chosen: null, edits, draft })).toMatchObject({ mode: 'draft', id: 'e1', draft })
    expect(resolveViewedEdit({ list, chosen: 'e1', edits, draft: { ...draft, listId: 'L2' } }).mode).toBe('edit')
  })
})

const live = (id) => ({ id, title: id, version: 1, archived_at: null })
const archived = (id) => ({ id, title: id, version: 1, archived_at: '2026-10-01T09:00:00Z' })
const LISTS = [live('a'), live('b'), archived('c')]

describe('resolveViewedList (D2)', () => {
  it('the remembered list when it is live; the active list otherwise', () => {
    expect(resolveViewedList({ remembered: 'b', shotLists: LISTS, activeId: 'a' })).toMatchObject({ id: 'b', mode: 'list' })
    expect(resolveViewedList({ remembered: null, shotLists: LISTS, activeId: 'a' })).toMatchObject({ id: 'a', mode: 'list' })
  })

  it('a remembered list that is archived, or gone, falls back to the active list', () => {
    expect(resolveViewedList({ remembered: 'c', shotLists: LISTS, activeId: 'a' })).toMatchObject({ id: 'a', mode: 'list' })
    expect(resolveViewedList({ remembered: 'gone', shotLists: LISTS, activeId: 'b' })).toMatchObject({ id: 'b', mode: 'list' })
  })

  it('an archived list opened on purpose this visit is shown, read-only; restored, it reads as a list', () => {
    expect(resolveViewedList({ remembered: 'a', session: { id: 'c', archived: true }, shotLists: LISTS, activeId: 'a' }))
      .toMatchObject({ id: 'c', mode: 'archived' })
    expect(resolveViewedList({ session: { id: 'c', archived: true }, shotLists: [live('c')], activeId: null }))
      .toMatchObject({ id: 'c', mode: 'list' })
  })

  it('"Not in any list" is a view of its own, this visit only', () => {
    expect(resolveViewedList({ remembered: 'a', session: { id: UNLISTED }, shotLists: LISTS, activeId: 'a' }))
      .toEqual({ id: UNLISTED, list: null, mode: 'unlisted' })
  })

  it('an active list this client has not loaded is "pending" under its own id (a new row still lands in it)', () => {
    expect(resolveViewedList({ remembered: null, shotLists: LISTS, activeId: 'new' })).toEqual({ id: 'new', list: null, mode: 'pending' })
  })

  it('no list to show — none at all, no active one and none remembered, or an archived pointer — is "none": every scene and shot', () => {
    expect(resolveViewedList({ remembered: null, shotLists: [], activeId: null })).toEqual({ id: null, list: null, mode: 'none' })
    expect(resolveViewedList({ remembered: null, shotLists: LISTS, activeId: null })).toEqual({ id: null, list: null, mode: 'none' })
    expect(resolveViewedList({ remembered: null, shotLists: LISTS, activeId: 'c' })).toEqual({ id: null, list: null, mode: 'none' })
  })
})

describe('unlistedSceneRows', () => {
  const scenes = { s1: { id: 's1' }, s2: { id: 's2' }, s3: { id: 's3' } }
  const byId = (id) => scenes[id] || null
  it('the scenes in no live list, then the scene each unlisted shot sits under, once each', () => {
    expect(unlistedSceneRows({
      unlistedScenes: [scenes.s1],
      unlistedShots: [{ id: 'h1', scene_id: 's2' }, { id: 'h2', scene_id: 's2' }, { id: 'h3', scene_id: 's1' }, { id: 'h4', scene_id: null }],
      sceneById: byId,
    }).map((s) => s.id)).toEqual(['s1', 's2'])
  })
  it('a shot whose scene is gone, or with none, adds no heading', () => {
    expect(unlistedSceneRows({ unlistedScenes: [], unlistedShots: [{ id: 'h1', scene_id: 'zz' }, { id: 'h2', scene_id: null }], sceneById: byId })).toEqual([])
  })
  it('in scene number order — a heading is not left at the end — the unnumbered last, in the order they came (S3b step 6)', () => {
    const n = { a: { id: 'a', scene_number: 4 }, b: { id: 'b', scene_number: 1 }, c: { id: 'c', scene_number: null }, d: { id: 'd' }, e: { id: 'e', scene_number: 2 } }
    expect(unlistedSceneRows({
      unlistedScenes: [n.c, n.a, n.d],
      unlistedShots: [{ id: 'h1', scene_id: 'b' }, { id: 'h2', scene_id: 'e' }],
      sceneById: (id) => n[id] || null,
    }).map((s) => s.id)).toEqual(['b', 'e', 'a', 'c', 'd'])
  })
})
