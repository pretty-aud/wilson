// shotListModel.test.js — the pure half of shot lists and edits (S3a).
//
// Plain arrays in, direct calls, no React (the bins/shotTakeSelectors.test.js
// pattern). The ORDER-BY pin at the bottom reads migration 0084 so the SQL
// backfill and backfillItems() cannot drift apart silently.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  SHOT_LIST_BACKFILL_TITLE,
  SHOT_LIST_BACKFILL_SUMMARY,
  compareScenesForList,
  compareShotsForList,
  backfillItems,
  unlistedScenesOf,
  unlistedShotsOf,
  editChainTip,
  formatShotListLabel,
  sortShotLists,
  activeShotListOf,
  activeScenesOf,
  activeShotsOf,
  scenesOfList,
  shotsOfList,
  sceneIdSetOf,
  listsContainingOf,
  nextShotListVersion,
  nextEditVersion,
  editsOfList,
  validateVersionedTitle,
  assertUniqueShotList,
  assertUniqueEdit,
  WITHDRAW_LIST_REFUSAL,
  WITHDRAW_EDIT_REFUSAL,
  ACTIVE_LIST_ARCHIVE_REFUSAL,
  isShotListUntouched,
  isEditUntouched,
  isWithdrawn,
  shotListWithdrawRefusal,
  editWithdrawRefusal,
  withdrawnRestoreRefusal,
  ARCHIVE_SEAT_REFUSAL_LIST,
  ARCHIVE_SEAT_REFUSAL_EDIT,
  RESTORE_SAVED_LIST_REFUSAL,
  RESTORE_SAVED_EDIT_REFUSAL,
  planAddToList,
  planRemoveFromList,
  planReorderList,
  planCopyList,
  planAllScenesAndShots,
  buildShotListSnapshot,
  normalizeEditItems,
  editItemsFromList,
  buildEditSnapshot,
} from './shotListModel'

const here = path.dirname(fileURLToPath(import.meta.url))

function idGen(prefix = 'id') {
  let n = 0
  return () => `${prefix}-${++n}`
}

// Two scenes numbered out of creation order, three shots (one unlinked).
const SCENES = [
  { id: 'sc-b', scene_number: 2, sort_order: 0, created_at: '2026-01-01', name: 'Second' },
  { id: 'sc-a', scene_number: 1, sort_order: 1, created_at: '2026-01-02', name: 'First' },
]
const SHOTS = [
  { id: 'sh-a2', scene_id: 'sc-a', shot_number: 20, sort_order: 0, name: 'A two' },
  { id: 'sh-a1', scene_id: 'sc-a', shot_number: 10, sort_order: 1, name: 'A one' },
  { id: 'sh-b1', scene_id: 'sc-b', shot_number: 10, sort_order: 2, name: 'B one' },
  { id: 'sh-x',  scene_id: null,   shot_number: null, sort_order: 3, name: 'Loose' },
]

function listWithEverything(listId = 'L1') {
  const gen = idGen(listId)
  return backfillItems(SCENES, SHOTS).map(i => ({ id: gen(), shot_list_id: listId, project_id: 'p1', ...i }))
}

describe('ordering — the same rule as 0084', () => {
  it('scenes by scene_number with nulls last, then sort_order, created_at, id', () => {
    const rows = [
      { id: 'z', scene_number: null, sort_order: 0 },
      { id: 'b', scene_number: 1, sort_order: 5 },
      { id: 'a', scene_number: 1, sort_order: 5 },
      { id: 'c', scene_number: 0, sort_order: 9 },
    ]
    expect([...rows].sort(compareScenesForList).map(r => r.id)).toEqual(['c', 'a', 'b', 'z'])
  })

  it('shots by shot_number with nulls last', () => {
    const rows = [{ id: 'n', shot_number: null }, { id: 'b', shot_number: 20 }, { id: 'a', shot_number: 10 }]
    expect([...rows].sort(compareShotsForList).map(r => r.id)).toEqual(['a', 'b', 'n'])
  })

  it('backfillItems: scene positions follow scene_number; shot positions restart per scene and for the unlinked bucket', () => {
    const items = backfillItems(SCENES, SHOTS)
    const scenePos = Object.fromEntries(items.filter(i => i.scene_id).map(i => [i.scene_id, i.position]))
    expect(scenePos).toEqual({ 'sc-a': 0, 'sc-b': 1 })
    const shotPos = Object.fromEntries(items.filter(i => i.shot_id).map(i => [i.shot_id, i.position]))
    expect(shotPos).toEqual({ 'sh-a1': 0, 'sh-a2': 1, 'sh-b1': 0, 'sh-x': 0 })
    expect(items).toHaveLength(SCENES.length + SHOTS.length)
    for (const i of items) expect((i.scene_id == null) !== (i.shot_id == null)).toBe(true)
  })

  it('the D11 list is "Shot list 1 · v1"', () => {
    expect(formatShotListLabel({ title: SHOT_LIST_BACKFILL_TITLE, version: 1 })).toBe('Shot list 1 · v1')
    expect(SHOT_LIST_BACKFILL_SUMMARY).toBe('Created from existing scenes')
  })

  it('PIN: 0084 orders its backfill by the same columns, in the same order', () => {
    const sql = readFileSync(path.resolve(here, '../../../../supabase/migrations/0084_shot_lists_and_edits.sql'), 'utf8')
    const fn = sql.slice(sql.indexOf('FUNCTION public.backfill_shot_lists'))
    expect(fn).toContain('ORDER BY s.scene_number NULLS LAST, s.sort_order, s.created_at, s.id')
    expect(fn).toContain('PARTITION BY sh.scene_id')
    expect(fn).toContain('ORDER BY sh.shot_number NULLS LAST, sh.sort_order, sh.created_at, sh.id')
    expect(fn).toContain(`'${SHOT_LIST_BACKFILL_TITLE}', 1, '${SHOT_LIST_BACKFILL_SUMMARY}'`)
  })
})

describe('selectors (D10)', () => {
  const items = listWithEverything('L1')
  const lists = [{ id: 'L1', title: 'Shot list 1', version: 1 }]

  it('no active list => every scene and shot, untouched and in load order', () => {
    const project = { id: 'p1', active_shot_list_id: null }
    expect(activeShotListOf(project, lists)).toBeNull()
    expect(activeScenesOf({ project, shotLists: lists, shotListItems: items, scenes: SCENES, shots: SHOTS })).toBe(SCENES)
    expect(activeShotsOf({ project, shotLists: lists, shotListItems: items, shots: SHOTS })).toBe(SHOTS)
  })

  it('a pointer to a list that is not loaded counts as no active list (nothing disappears)', () => {
    const project = { id: 'p1', active_shot_list_id: 'L-unknown' }
    expect(activeScenesOf({ project, shotLists: lists, shotListItems: items, scenes: SCENES, shots: SHOTS })).toBe(SCENES)
  })

  it('an active list hides what ANOTHER list holds, keeps LOAD order (views sort by number themselves)', () => {
    // sc-b and sh-b1 move to list L2: another list holds them, so the active
    // L1 no longer shows them on the other surfaces.
    const moved = items.map(i => (i.scene_id === 'sc-b' || i.shot_id === 'sh-b1' ? { ...i, shot_list_id: 'L2' } : i))
    const lists2 = [...lists, { id: 'L2', title: 'Alt', version: 1 }]
    const project = { id: 'p1', active_shot_list_id: 'L1' }
    const scenes = activeScenesOf({ project, shotLists: lists2, shotListItems: moved, scenes: SCENES, shots: SHOTS })
    expect(scenes.map(s => s.id)).toEqual(['sc-a'])
    const shots = activeShotsOf({ project, shotLists: lists2, shotListItems: moved, shots: SHOTS })
    expect(shots.map(s => s.id)).toEqual(['sh-a2', 'sh-a1', 'sh-x'])
  })

  it('D10 as ruled: a row in NO list is not shown on the other tabs; unlisted*Of reach it (S3b\'s bucket)', () => {
    const without = items.filter(i => i.scene_id !== 'sc-b' && i.shot_id !== 'sh-b1')
    const project = { id: 'p1', active_shot_list_id: 'L1' }
    expect(activeScenesOf({ project, shotLists: lists, shotListItems: without, scenes: SCENES, shots: SHOTS }).map(s => s.id)).toEqual(['sc-a'])
    expect(activeShotsOf({ project, shotLists: lists, shotListItems: without, shots: SHOTS }).map(s => s.id)).toEqual(['sh-a2', 'sh-a1', 'sh-x'])
    expect(unlistedScenesOf({ shotListItems: without, scenes: SCENES, shots: SHOTS }).map(s => s.id)).toEqual(['sc-b'])
    expect(unlistedShotsOf({ shotListItems: without, shots: SHOTS }).map(s => s.id)).toEqual(['sh-b1'])
    // Control: with every row listed there is nothing unlisted.
    expect(unlistedScenesOf({ shotListItems: items, scenes: SCENES, shots: SHOTS })).toEqual([])
  })

  it('"Not in any list" counts LIVE lists only: a row whose only list is archived or withdrawn is in it', () => {
    const moved = items.map(i => (i.scene_id === 'sc-b' || i.shot_id === 'sh-b1' ? { ...i, shot_list_id: 'L2' } : i))
    const archivedL2 = [...lists, { id: 'L2', title: 'Alt', version: 1, archived_at: '2026-09-30T00:00:00Z' }]
    expect(unlistedScenesOf({ shotLists: archivedL2, shotListItems: moved, scenes: SCENES, shots: SHOTS }).map(s => s.id)).toEqual(['sc-b'])
    expect(unlistedShotsOf({ shotLists: archivedL2, shotListItems: moved, shots: SHOTS }).map(s => s.id)).toEqual(['sh-b1'])
    // Control: the same rows in a LIVE second list have a home.
    const liveL2 = [...lists, { id: 'L2', title: 'Alt', version: 1, archived_at: null }]
    expect(unlistedScenesOf({ shotLists: liveL2, shotListItems: moved, scenes: SCENES, shots: SHOTS })).toEqual([])
    expect(unlistedShotsOf({ shotLists: liveL2, shotListItems: moved, shots: SHOTS })).toEqual([])
    // A list this client has not loaded still counts as a home (review R1).
    expect(unlistedScenesOf({ shotLists: lists, shotListItems: moved, scenes: SCENES, shots: SHOTS })).toEqual([])
  })

  it('after the backfill the active list equals every row (nothing visible changes)', () => {
    const project = { id: 'p1', active_shot_list_id: 'L1' }
    expect(activeScenesOf({ project, shotLists: lists, shotListItems: items, scenes: SCENES, shots: SHOTS })).toEqual(SCENES)
    expect(activeShotsOf({ project, shotLists: lists, shotListItems: items, shots: SHOTS })).toEqual(SHOTS)
  })

  it('scenesOfList / shotsOfList return LIST order; unlinked shots last', () => {
    expect(scenesOfList(SCENES, items, 'L1', SHOTS).map(s => s.id)).toEqual(['sc-a', 'sc-b'])
    expect(shotsOfList(SHOTS, items, 'L1', SCENES).map(s => s.id)).toEqual(['sh-a1', 'sh-a2', 'sh-b1', 'sh-x'])
    expect(scenesOfList(SCENES, items, null)).toEqual([])
  })

  it('a shot item whose scene has no item implies that scene (it would render under no heading otherwise)', () => {
    const only = [{ id: 'i1', shot_list_id: 'L2', scene_id: null, shot_id: 'sh-b1', position: 0 }]
    expect([...sceneIdSetOf(only, 'L2', SHOTS)]).toEqual(['sc-b'])
    expect(scenesOfList(SCENES, only, 'L2', SHOTS).map(s => s.id)).toEqual(['sc-b'])
    // Control: without the shots lookup there is nothing to imply.
    expect([...sceneIdSetOf(only, 'L2')]).toEqual([])
  })

  it('listsContaining finds explicit and implied membership, sorted for display', () => {
    const l2 = [{ id: 'j1', shot_list_id: 'L2', scene_id: null, shot_id: 'sh-b1', position: 0 }]
    const both = [...items, ...l2]
    const lists2 = [{ id: 'L2', title: 'Pickups', version: 1 }, ...lists]
    expect(listsContainingOf({ shotLists: lists2, shotListItems: both, shots: SHOTS }, 'sc-b').map(l => l.id)).toEqual(['L2', 'L1'])
    expect(listsContainingOf({ shotLists: lists2, shotListItems: both, shots: SHOTS }, 'sh-a1').map(l => l.id)).toEqual(['L1'])
    expect(listsContainingOf({ shotLists: lists2, shotListItems: both, shots: SHOTS }, 'nope')).toEqual([])
  })

  it('versions and labels (D14)', () => {
    const ls = [{ id: '1', title: 'Main', version: 1 }, { id: '2', title: 'Main', version: 3 }, { id: '3', title: 'Alt', version: 1 }]
    expect(nextShotListVersion(ls, 'Main')).toBe(4)
    expect(nextShotListVersion(ls, ' Main ')).toBe(4)
    expect(nextShotListVersion(ls, 'New')).toBe(1)
    expect(sortShotLists(ls).map(formatShotListLabel)).toEqual(['Alt · v1', 'Main · v1', 'Main · v3'])
    const eds = [{ id: 'e1', shot_list_id: 'L1', title: 'Cut', version: 2, created_at: 'b' }, { id: 'e0', shot_list_id: 'L1', title: 'Cut', version: 1, created_at: 'a' }, { id: 'e9', shot_list_id: 'L9', title: 'Cut', version: 7 }]
    expect(nextEditVersion(eds, 'L1', 'Cut')).toBe(3)
    expect(editsOfList(eds, 'L1').map(e => e.id)).toEqual(['e0', 'e1'])
    // D6: the chain tip is the edit nobody names as parent.
    const chain = [{ id: 'a', shot_list_id: 'L1', parent_edit_id: null }, { id: 'b', shot_list_id: 'L1', parent_edit_id: 'a' }]
    expect(editChainTip(chain, 'L1').id).toBe('b')
    expect(editChainTip(chain, 'L9')).toBeNull()
  })
})

describe('validation — refused before any write, in the database\'s words', () => {
  it('title and version', () => {
    expect(() => validateVersionedTitle({ title: '  ', version: 1 })).toThrow('A shot list needs a title.')
    expect(() => validateVersionedTitle({ title: 'x', version: 0 })).toThrow("A shot list's version must be a whole number of at least 1.")
    expect(() => validateVersionedTitle({ title: 'x', version: 1.5 })).toThrow(/whole number/)
    expect(() => validateVersionedTitle({ title: 'x', version: 2 }, 'edit')).not.toThrow()
    expect(() => validateVersionedTitle({ title: '', version: 2 }, 'edit')).toThrow('An edit needs a title.')
  })

  it('unique title + version per project (and per list for edits)', () => {
    const ls = [{ id: '1', title: 'Main', version: 1 }]
    expect(() => assertUniqueShotList(ls, { title: 'Main', version: 1 })).toThrow('There is already a shot list called "Main · v1".')
    expect(() => assertUniqueShotList(ls, { id: '1', title: 'Main', version: 1 })).not.toThrow()
    expect(() => assertUniqueShotList(ls, { title: 'Main', version: 2 })).not.toThrow()
    const eds = [{ id: 'e', shot_list_id: 'L1', title: 'Cut', version: 1 }]
    expect(() => assertUniqueEdit(eds, { shot_list_id: 'L1', title: 'Cut', version: 1 })).toThrow(/already has an edit called "Cut · v1"/)
    expect(() => assertUniqueEdit(eds, { shot_list_id: 'L2', title: 'Cut', version: 1 })).not.toThrow()
  })
})

describe('plans — each returns the new item set of ONE list', () => {
  it('add: a shot brings its scene; ids already present are skipped; new items go to the end of their group', () => {
    const start = [{ id: 'i1', shot_list_id: 'L', scene_id: 'sc-a', shot_id: null, position: 0 },
                   { id: 'i2', shot_list_id: 'L', scene_id: null, shot_id: 'sh-a1', position: 0 }]
    const { next, added } = planAddToList({ items: start, listId: 'L', projectId: 'p1', shots: SHOTS,
      shotIds: ['sh-b1', 'sh-a2', 'sh-a1'], newId: idGen('n') })
    expect(added.map(a => a.scene_id || a.shot_id)).toEqual(['sc-b', 'sh-b1', 'sh-a2'])
    expect(next.find(i => i.scene_id === 'sc-b').position).toBe(1)
    expect(next.find(i => i.shot_id === 'sh-b1').position).toBe(0)
    expect(next.find(i => i.shot_id === 'sh-a2').position).toBe(1)
    expect(next).toHaveLength(5)
    // Control: nothing new => nothing added.
    expect(planAddToList({ items: next, listId: 'L', projectId: 'p1', shots: SHOTS, shotIds: ['sh-a2'], newId: idGen() }).added).toEqual([])
  })

  it('remove: a scene takes its shots\' items with it; other lists are untouched', () => {
    const items = [...listWithEverything('L'), ...listWithEverything('M')]
    const { next, removed } = planRemoveFromList({ items, listId: 'L', shots: SHOTS, sceneIds: ['sc-a'] })
    expect(removed.map(r => r.scene_id || r.shot_id).sort()).toEqual(['sc-a', 'sh-a1', 'sh-a2'])
    expect(next.every(i => i.shot_list_id === 'L')).toBe(true)
    expect(next).toHaveLength(3)
  })

  it('reorder: scenes by scene id; shots within one scene; mixing groups throws', () => {
    const items = listWithEverything('L')
    const scenes = planReorderList({ items, listId: 'L', shots: SHOTS, orderedIds: ['sc-b', 'sc-a'] }).next
    expect(scenes.find(i => i.scene_id === 'sc-b').position).toBe(0)
    expect(scenes.find(i => i.scene_id === 'sc-a').position).toBe(1)
    const plan = planReorderList({ items, listId: 'L', shots: SHOTS, orderedIds: ['sh-a2'] })
    const shots = plan.next
    // Only the two shots whose position moved are written (a delta).
    expect(plan.changed.map(i => i.shot_id).sort()).toEqual(['sh-a1', 'sh-a2'])
    expect(shots.find(i => i.shot_id === 'sh-a2').position).toBe(0)
    expect(shots.find(i => i.shot_id === 'sh-a1').position).toBe(1)
    expect(() => planReorderList({ items, listId: 'L', shots: SHOTS, orderedIds: ['sc-a', 'sh-a1'] })).toThrow('Scenes and shots are reordered separately.')
    expect(() => planReorderList({ items, listId: 'L', shots: SHOTS, orderedIds: ['sh-b1', 'sh-a1'] })).toThrow(/one scene at a time/)
    expect(() => planReorderList({ items, listId: 'L', shots: SHOTS, orderedIds: ['nope'] })).toThrow(/not in this shot list/)
  })

  it('copy links the SAME scene and shot ids with new item ids (D3: membership, not copies)', () => {
    const items = listWithEverything('L')
    const copy = planCopyList({ items, fromListId: 'L', toListId: 'M', projectId: 'p1', newId: idGen('c') })
    expect(copy).toHaveLength(items.length)
    expect(copy.map(i => i.scene_id || i.shot_id).sort()).toEqual(items.map(i => i.scene_id || i.shot_id).sort())
    expect(copy.every(i => i.shot_list_id === 'M' && !items.some(o => o.id === i.id))).toBe(true)
    expect(planAllScenesAndShots({ scenes: SCENES, shots: SHOTS, listId: 'N', projectId: 'p1', newId: idGen() })).toHaveLength(6)
  })
})

describe('snapshots and edits', () => {
  it('a Save snapshot records the list as it is now', () => {
    const items = listWithEverything('L1')
    const snap = buildShotListSnapshot({ list: { id: 'L1', title: 'Shot list 1', version: 1 }, scenes: SCENES, shots: SHOTS, items, savedAt: 'T' })
    expect(snap.kind).toBe('shot_list')
    expect(snap.scenes.map(s => s.id)).toEqual(['sc-a', 'sc-b'])
    expect(snap.shots.map(s => s.id)).toEqual(['sh-a1', 'sh-a2', 'sh-b1', 'sh-x'])
    expect(snap.items).toHaveLength(6)
    expect(Object.keys(snap.scenes[0])).toContain('thumbnail_image')
  })

  it('edit items keep only { id, scene_id, shot_id, label, notes }; repeats are allowed (D6)', () => {
    const gen = idGen('e')
    const out = normalizeEditItems([{ shot_id: 'sh-a1', label: 'x', extra: 1 }, { shot_id: 'sh-a1' }], gen)
    expect(out).toEqual([
      { id: 'e-1', scene_id: null, shot_id: 'sh-a1', label: 'x', notes: '' },
      { id: 'e-2', scene_id: null, shot_id: 'sh-a1', label: '', notes: '' },
    ])
    expect(() => normalizeEditItems({}, gen)).toThrow("An edit's items must be a list.")
  })

  it('the string-out follows list order; the edit snapshot remembers names for "Missing shot" (D17)', () => {
    const items = listWithEverything('L1')
    const strung = editItemsFromList({ scenes: SCENES, shots: SHOTS, items, listId: 'L1', newId: idGen() })
    expect(strung.map(i => i.shot_id)).toEqual(['sh-a1', 'sh-a2', 'sh-b1', 'sh-x'])
    const snap = buildEditSnapshot({ items: strung, shots: SHOTS, scenes: SCENES, savedAt: 'T' })
    expect(snap.shots['sh-a1'].name).toBe('A one')
    expect(snap.scenes['sc-a'].name).toBe('First')
    expect(snap.item_count).toBe(4)
  })
})

describe('withdraw (0086): the maker takes back an untouched new list or edit', () => {
  const list = { id: 'L1', created_by: 'u-me', snapshot: {}, archived_at: null }
  const edit = { id: 'E1', shot_list_id: 'L1', created_by: 'u-me', parent_edit_id: null, snapshot: null, archived_at: null }
  const SQL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../supabase/migrations')

  it('a list is untouched while not Saved and no LIVE edit is on it; membership does not count', () => {
    expect(isShotListUntouched(list, [])).toBe(true)
    expect(isShotListUntouched({ ...list, snapshot: undefined }, [])).toBe(true)
    expect(isShotListUntouched({ ...list, snapshot: { kind: 'shot_list' } }, [])).toBe(false)
    expect(isShotListUntouched(list, [edit])).toBe(false)
    expect(isShotListUntouched(list, [{ ...edit, archived_at: '2026-09-30T00:00:00Z' }])).toBe(true)
    expect(isShotListUntouched(list, [{ ...edit, shot_list_id: 'L2' }])).toBe(true)
    expect(isShotListUntouched(null, [])).toBe(false)
  })

  it('an edit is untouched while not Saved and no LIVE edit continues it', () => {
    const child = { ...edit, id: 'E2', parent_edit_id: 'E1' }
    expect(isEditUntouched(edit, [edit])).toBe(true)
    expect(isEditUntouched({ ...edit, snapshot: {} }, [edit])).toBe(false)
    expect(isEditUntouched(edit, [edit, child])).toBe(false)
    expect(isEditUntouched(edit, [edit, { ...child, archived_at: '2026-09-30T00:00:00Z' }])).toBe(true)
  })

  it('withdrawn = archived by the person who made it; never on a backend without users', () => {
    expect(isWithdrawn({ ...list, archived_at: 'x', archived_by: 'u-me' })).toBe(true)
    expect(isWithdrawn({ ...list, archived_at: 'x', archived_by: 'u-boss' })).toBe(false)
    expect(isWithdrawn({ ...list, archived_at: null, archived_by: null })).toBe(false)
    expect(isWithdrawn({ id: 'L', created_by: null, archived_at: 'x', archived_by: null })).toBe(false)
  })

  it('a list: each condition gets the database\'s sentence for it, in the database\'s order', () => {
    const base = { list, edits: [], activeListId: null }
    expect(shotListWithdrawRefusal({ ...base, userId: 'u-me' })).toBe(null)
    // not the maker (or no maker, or an unknown user): 0084's seat sentence
    expect(shotListWithdrawRefusal({ ...base, userId: 'u-other' })).toBe(ARCHIVE_SEAT_REFUSAL_LIST)
    expect(shotListWithdrawRefusal({ ...base, userId: null })).toBe(ARCHIVE_SEAT_REFUSAL_LIST)
    expect(shotListWithdrawRefusal({ ...base, list: { ...list, created_by: null }, userId: 'u-me' })).toBe(ARCHIVE_SEAT_REFUSAL_LIST)
    // the maker check comes first: someone else's Saved list reads the seat sentence
    expect(shotListWithdrawRefusal({ ...base, list: { ...list, snapshot: { kind: 'shot_list' } }, userId: 'u-other' })).toBe(ARCHIVE_SEAT_REFUSAL_LIST)
    // touched: 0086's sentence
    expect(shotListWithdrawRefusal({ ...base, edits: [edit], userId: 'u-me' })).toBe(WITHDRAW_LIST_REFUSAL)
    expect(shotListWithdrawRefusal({ ...base, list: { ...list, snapshot: { kind: 'shot_list' } }, userId: 'u-me' })).toBe(WITHDRAW_LIST_REFUSAL)
    // the active list, last (untouched is checked before it)
    expect(shotListWithdrawRefusal({ ...base, activeListId: 'L1', userId: 'u-me' })).toBe(ACTIVE_LIST_ARCHIVE_REFUSAL)
    expect(shotListWithdrawRefusal({ ...base, edits: [edit], activeListId: 'L1', userId: 'u-me' })).toBe(WITHDRAW_LIST_REFUSAL)
    expect(shotListWithdrawRefusal({ ...base, list: null, userId: 'u-me' })).toBe('shot list not found')
  })

  it('no users (Local Server, Drive): the maker test is skipped, untouched and active still apply', () => {
    const base = { list: { ...list, created_by: null }, edits: [], activeListId: null, userId: undefined }
    expect(shotListWithdrawRefusal(base)).toBe(null)
    expect(shotListWithdrawRefusal({ ...base, edits: [edit] })).toBe(WITHDRAW_LIST_REFUSAL)
    expect(shotListWithdrawRefusal({ ...base, activeListId: 'L1' })).toBe(ACTIVE_LIST_ARCHIVE_REFUSAL)
    expect(editWithdrawRefusal({ edit: { ...edit, created_by: null }, edits: [edit], userId: undefined })).toBe(null)
    expect(withdrawnRestoreRefusal({ row: { ...list, created_by: null, archived_at: 'x', archived_by: null }, kind: 'shot_list', userId: undefined })).toBe(null)
  })

  it('an edit: the maker, then untouched', () => {
    const child = { ...edit, id: 'E2', parent_edit_id: 'E1' }
    expect(editWithdrawRefusal({ edit, edits: [edit], userId: 'u-me' })).toBe(null)
    expect(editWithdrawRefusal({ edit, edits: [edit], userId: 'u-other' })).toBe(ARCHIVE_SEAT_REFUSAL_EDIT)
    expect(editWithdrawRefusal({ edit, edits: [edit, child], userId: 'u-me' })).toBe(WITHDRAW_EDIT_REFUSAL)
    expect(editWithdrawRefusal({ edit: { ...edit, snapshot: { kind: 'edit' } }, edits: [edit], userId: 'u-me' })).toBe(WITHDRAW_EDIT_REFUSAL)
    expect(editWithdrawRefusal({ edit: null, edits: [], userId: 'u-me' })).toBe('edit not found')
  })

  it('a restore: the maker restores an unsaved row THEY set aside; someone else\'s reads the seat sentence, a Saved one 0086\'s', () => {
    const mine = { ...list, archived_at: 'x', archived_by: 'u-me' }
    expect(withdrawnRestoreRefusal({ row: mine, kind: 'shot_list', userId: 'u-me' })).toBe(null)
    // a Saved row they archived (as a manager who has since lost the seat)
    expect(withdrawnRestoreRefusal({ row: { ...mine, snapshot: { kind: 'shot_list' } }, kind: 'shot_list', userId: 'u-me' })).toBe(RESTORE_SAVED_LIST_REFUSAL)
    expect(withdrawnRestoreRefusal({ row: { ...edit, archived_at: 'x', archived_by: 'u-me', snapshot: { kind: 'edit' } }, kind: 'edit', userId: 'u-me' })).toBe(RESTORE_SAVED_EDIT_REFUSAL)
    expect(withdrawnRestoreRefusal({ row: { ...edit, archived_at: 'x', archived_by: 'u-me' }, kind: 'edit', userId: 'u-me' })).toBe(null)
    // the seat sentence comes first, as in the database
    expect(withdrawnRestoreRefusal({ row: { ...mine, archived_by: 'u-boss', snapshot: { kind: 'shot_list' } }, kind: 'shot_list', userId: 'u-me' })).toBe(ARCHIVE_SEAT_REFUSAL_LIST)
    // no users: nothing is refused
    expect(withdrawnRestoreRefusal({ row: { ...mine, snapshot: { kind: 'shot_list' } }, kind: 'shot_list', userId: undefined })).toBe(null)
    expect(withdrawnRestoreRefusal({ row: { ...mine, archived_by: 'u-boss' }, kind: 'shot_list', userId: 'u-me' })).toBe(ARCHIVE_SEAT_REFUSAL_LIST)
    expect(withdrawnRestoreRefusal({ row: mine, kind: 'shot_list', userId: 'u-other' })).toBe(ARCHIVE_SEAT_REFUSAL_LIST)
    expect(withdrawnRestoreRefusal({ row: mine, kind: 'shot_list', userId: null })).toBe(ARCHIVE_SEAT_REFUSAL_LIST)
    expect(withdrawnRestoreRefusal({ row: { ...edit, archived_at: 'x', archived_by: 'u-boss' }, kind: 'edit', userId: 'u-me' })).toBe(ARCHIVE_SEAT_REFUSAL_EDIT)
    expect(withdrawnRestoreRefusal({ row: list, kind: 'shot_list', userId: 'u-other' })).toBe(null) // live: nothing to restore
    expect(withdrawnRestoreRefusal({ row: null, kind: 'edit', userId: 'u-me' })).toBe('edit not found')
  })

  it('every sentence is the database\'s, word for word (0084\'s seat sentences, 0086\'s withdraw sentences)', () => {
    const sql84 = readFileSync(path.join(SQL_DIR, '0084_shot_lists_and_edits.sql'), 'utf8')
    const sql86 = readFileSync(path.join(SQL_DIR, '0086_shot_list_withdraw.sql'), 'utf8')
    for (const sentence of [ARCHIVE_SEAT_REFUSAL_LIST, ARCHIVE_SEAT_REFUSAL_EDIT, ACTIVE_LIST_ARCHIVE_REFUSAL]) {
      expect(sql84.includes(`'${sentence}'`), sentence).toBe(true)
      expect(sql86.includes(`'${sentence}'`), sentence).toBe(true)
    }
    for (const sentence of [WITHDRAW_LIST_REFUSAL, WITHDRAW_EDIT_REFUSAL, RESTORE_SAVED_LIST_REFUSAL, RESTORE_SAVED_EDIT_REFUSAL]) {
      expect(sql86.includes(`'${sentence}'`), sentence).toBe(true)
    }
  })
})
