/** @vitest-environment jsdom */
// =============================================================================
// listRemovalKeepsTasks.test.jsx — Audrey's rule of 2026-10-02, in the
// executable form the S3c brief's dated section asks for: "if a shot list is
// removed. dont delete the budget and timeline."
//
// N assigned tasks; then, through the REAL provider over an in-memory backend
// (shotListsProvider.test.jsx's, keeping the contract's rules): clear the
// active list, set another list active, archive a list, delete a scene. After
// each, the Timeline's group-by-scene (TimelineView's buildRowsByGrouping)
// still draws N task rows, and the Budget's By scene and By shot
// (BudgetView's bySceneRows / byShotRows) still total the same tasks, days
// and cost. Every stored link is kept — only deleting a scene clears its
// tasks' links, as the database does (0084's ON DELETE SET NULL) — and a
// task whose scene comes back into the active list is under it again.
// =============================================================================
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import React from 'react'
import { render, cleanup, act, waitFor } from '@testing-library/react'

const holder = vi.hoisted(() => ({ adapter: null }))

vi.mock('../adapters', () => ({
  selectAdapter: () => holder.adapter,
  ADAPTER_MODES: ['supabase', 'local_server', 'google_drive'],
  adapterSupportsWrites: () => true,
}))
vi.mock('../adapters/supabaseAdapter', () => ({ resetSupabaseAdapter: () => {} }))
vi.mock('../../../cloud/auth/supabaseClient', () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: null } }),
    },
  },
  hydrateSupabase: async () => {},
}))
vi.mock('../../../lib/localData', () => ({
  hasLocalServer: () => true,
  loadOtterSettings: async () => ({ rabbit: { adapterMode: 'local_server', activeProjectId: 'p1' } }),
  saveOtterSettings: async () => {},
}))
vi.mock('../../../dev/devFixtures', () => ({ devFixtures: () => null }))
vi.mock('../intake/pipeline', () => ({ runIngestion: vi.fn() }))
// The two views are imported for their row builders only.
vi.mock('../../../permissions/usePermissions', () => ({ usePermissions: () => ({ role: 'admin', ready: true }) }))
vi.mock('../../../components/RateCard/useRateCard', () => ({ useRateCard: () => ({ entries: [], rateCards: [] }) }))
vi.mock('../../../components/TeamMembers/useRosterMembers', () => ({ useRosterMembers: () => ({ members: [] }) }))
vi.mock('../components/FileManager', () => ({ default: () => null }))
vi.mock('../components/TaskDetailPopup', () => ({ default: () => null }))
vi.mock('../../../components/TaskTemplates/TaskTemplateManager', () => ({ default: () => null }))

const { RabbitProvider, useRabbit } = await import('./RabbitProvider')
const { buildRowsByGrouping } = await import('../views/TimelineView.jsx')
const { bySceneRows, byShotRows } = await import('../views/BudgetView.jsx')
const { homeIndexOf } = await import('../views/scenes/linkHomes')

function makeAdapter() {
  let n = 0
  const id = (p) => `${p}-${++n}`
  const clone = (x) => JSON.parse(JSON.stringify(x))
  const db = {
    project: { id: 'p1', title: 'Salt Hours', active_shot_list_id: 'L1', scenes_enabled: true },
    scenes: [
      { id: 'sc1', project_id: 'p1', name: 'One', scene_number: 1 },
      { id: 'sc2', project_id: 'p1', name: 'Two', scene_number: 2 },
    ],
    shots: [
      { id: 'sh1', project_id: 'p1', scene_id: 'sc1', name: '1A', shot_number: 10 },
      { id: 'sh2', project_id: 'p1', scene_id: 'sc2', name: '2A', shot_number: 10 },
    ],
    // N = 4: on a shot, on a shot, on a scene alone, on nothing.
    tasks: [
      { id: 't1', project_id: 'p1', title: 'Comp 1A', scene_id: 'sc1', shot_id: 'sh1', assigned_role_slug: 'comp', bid_days: 1, logged_days: 0 },
      { id: 't2', project_id: 'p1', title: 'Comp 2A', scene_id: 'sc2', shot_id: 'sh2', assigned_role_slug: 'comp', bid_days: 2, logged_days: 0 },
      { id: 't3', project_id: 'p1', title: 'Board Two', scene_id: 'sc2', shot_id: null, assigned_role_slug: 'comp', bid_days: 3, logged_days: 0 },
      { id: 't4', project_id: 'p1', title: 'Grade', scene_id: null, shot_id: null, assigned_role_slug: 'comp', bid_days: 4, logged_days: 0 },
    ],
    shotLists: [{ id: 'L1', project_id: 'p1', title: 'Shot list 1', version: 1, summary: null, snapshot: {}, archived_at: null, archived_by: null, created_at: '2026-09-01' }],
    shotListItems: [
      { id: 'i1', shot_list_id: 'L1', project_id: 'p1', scene_id: 'sc1', shot_id: null, position: 0 },
      { id: 'i2', shot_list_id: 'L1', project_id: 'p1', scene_id: 'sc2', shot_id: null, position: 1 },
      { id: 'i3', shot_list_id: 'L1', project_id: 'p1', scene_id: null, shot_id: 'sh1', position: 0 },
      { id: 'i4', shot_list_id: 'L1', project_id: 'p1', scene_id: null, shot_id: 'sh2', position: 0 },
    ],
    edits: [],
  }
  const calls = []
  return {
    mode: 'local_server',
    calls,
    db,
    status: async () => ({ online: true, lastSyncAt: null }),
    listProjects: async () => [clone(db.project)],
    loadProject: async () => clone({
      project: db.project, scenes: db.scenes, shots: db.shots, tasks: db.tasks,
      shotLists: db.shotLists, shotListItems: db.shotListItems, edits: db.edits,
    }),
    // Like the database (0040's CASCADE, 0084's SET NULL): the scene's shots
    // go, out of every list, and its tasks are un-linked — never deleted.
    deleteScene: async (sid) => {
      calls.push(['deleteScene', sid])
      const shotIds = new Set(db.shots.filter(s => s.scene_id === sid).map(s => s.id))
      db.scenes = db.scenes.filter(s => s.id !== sid)
      db.shots = db.shots.filter(s => !shotIds.has(s.id))
      db.shotListItems = db.shotListItems.filter(i => i.scene_id !== sid && !shotIds.has(i.shot_id))
      db.tasks = db.tasks.map(t => ({
        ...t,
        ...(t.scene_id === sid ? { scene_id: null } : {}),
        ...(shotIds.has(t.shot_id) ? { shot_id: null } : {}),
      }))
    },
    // Any write to a task is recorded: no list operation may make one.
    patchTask: async (tid, patch) => {
      calls.push(['patchTask', tid])
      db.tasks = db.tasks.map(t => (t.id === tid ? { ...t, ...patch } : t))
      return clone(db.tasks.find(t => t.id === tid))
    },
    upsertTask: async (row) => { calls.push(['upsertTask', row.id]); return clone(row) },
    deleteTask: async (tid) => { calls.push(['deleteTask', tid]) },
    listShotLists: async () => clone(db.shotLists),
    listShotListItems: async () => clone(db.shotListItems),
    listEdits: async () => clone(db.edits),
    upsertShotList: async (row) => {
      calls.push(['upsertShotList', row.id])
      const stored = db.shotLists.find(l => l.id === row.id)
      const next = { ...(stored || {}), ...clone(row), created_at: stored?.created_at || '2026-10-02', created_by: stored?.created_by ?? null }
      db.shotLists = [...db.shotLists.filter(l => l.id !== row.id), next]
      return clone(next)
    },
    upsertShotListItems: async (_pid, listId, items) => {
      calls.push(['upsertShotListItems', listId, items.length])
      const written = []
      for (const it of items) {
        const row = { id: it.id || id('item'), shot_list_id: listId, project_id: 'p1',
          scene_id: it.scene_id || null, shot_id: it.shot_id || null, position: it.position ?? 0 }
        db.shotListItems = [...db.shotListItems.filter(i => i.id !== row.id), row]
        written.push(row)
      }
      return clone(written)
    },
    repositionShotListItems: async () => [],
    deleteShotListItems: async (_pid, listId, ids) => {
      calls.push(['deleteShotListItems', listId, ids.length])
      const gone = db.shotListItems.filter(i => i.shot_list_id === listId && ids.includes(i.id)).map(i => i.id)
      db.shotListItems = db.shotListItems.filter(i => !gone.includes(i.id))
      return { deleted: gone }
    },
    setActiveShotList: async (_pid, listId) => {
      calls.push(['setActiveShotList', listId])
      db.project.active_shot_list_id = listId
      return listId
    },
    archiveShotList: async (_pid, listId, archived = true) => {
      calls.push(['archiveShotList', listId, archived])
      if (archived && db.project.active_shot_list_id === listId) {
        const e = new Error('the active shot list cannot be archived — make another list active first'); e.status = 409; throw e
      }
      db.shotLists = db.shotLists.map(l => (l.id === listId ? { ...l, archived_at: archived ? 'T' : null } : l))
      return clone(db.shotLists.find(l => l.id === listId))
    },
  }
}

let ctxRef
function Probe() {
  ctxRef = useRabbit()
  return null
}

beforeEach(() => {
  holder.adapter = makeAdapter()
  ctxRef = null
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const N = 4
const roleRates = { comp: 500 }
const WHOLE = { tasks: N, days: 10, cost: 5000 }

/** What the Timeline and the Budget show from the provider's ctx, now. */
function measure() {
  const ctx = ctxRef
  const homeOf = homeIndexOf(ctx)
  const rows = buildRowsByGrouping({
    groupBy: 'scene', phases: [], assets: [], tasks: ctx.tasks, schedule: { tasks: {}, phases: {} },
    scenes: ctx.scenes, shots: ctx.shots, sceneById: ctx.sceneById, shotById: ctx.shotById, homeOf,
  })
  const total = (rs) => ({
    tasks: rs.reduce((a, r) => a + r.taskCount, 0),
    days: rs.reduce((a, r) => a + r.bid, 0),
    cost: rs.reduce((a, r) => a + r.cost, 0),
  })
  const byScene = bySceneRows({ scenes: ctx.scenes, shots: ctx.shots, sceneById: ctx.sceneById, homeOf, tasks: ctx.tasks, roleRates })
  const byShot = byShotRows({ shots: ctx.shots, scenes: ctx.scenes, sceneById: ctx.sceneById, shotById: ctx.shotById, homeOf, tasks: ctx.tasks, roleRates })
  return {
    taskRows: rows.filter(r => r.kind === 'task').map(r => r.task.id).sort(),
    groups: rows.filter(r => r.kind === 'phase').map(r => r.label),
    tip: (taskId) => rows.find(r => r.key === `tk-${taskId}`)?.tooltip,
    byScene: byScene.map(r => r.name),
    byShot: byShot.map(r => r.name),
    sceneTotal: total(byScene),
    shotTotal: total(byShot),
  }
}
const links = () => ctxRef.tasks.map(t => [t.id, t.scene_id, t.shot_id]).sort()
const ORIGINAL_LINKS = [['t1', 'sc1', 'sh1'], ['t2', 'sc2', 'sh2'], ['t3', 'sc2', null], ['t4', null, null]]
/** Every task drawn once on the Timeline; By scene and By shot each total the whole. */
function expectWhole(m, step) {
  expect(m.taskRows, step).toEqual(['t1', 't2', 't3', 't4'])
  expect(m.sceneTotal, step).toEqual(WHOLE)
  expect(m.shotTotal, step).toEqual(WHOLE)
}
const taskWrites = () => holder.adapter.calls.filter(c => /Task$/.test(c[0]))

describe('removing a shot list never removes the Timeline or the Budget (Audrey, 2026-10-02)', () => {
  it('clear the active list, set another active, archive a list, delete a scene: every task still drawn, every total the same, every link kept but the deleted scene\'s', async () => {
    render(<RabbitProvider><Probe /></RabbitProvider>)
    await waitFor(() => expect(ctxRef?.project?.id).toBe('p1'))
    await waitFor(() => expect(ctxRef.tasks).toHaveLength(N))
    await waitFor(() => expect(ctxRef.shotLists).toHaveLength(1))

    let m = measure()
    expectWhole(m, 'before')
    expect(m.groups).toEqual(['One', '1A', 'Two', '2A', 'No Scene'])
    expect(m.byScene).toEqual(['One', 'Two', 'No scene'])
    expect(m.byShot).toEqual(['One › 1A', 'Two › 2A', 'No shot'])

    // 1. Clear the active list (the Clear question's own call).
    const own = ctxRef.shotListItems.filter(i => i.shot_list_id === 'L1')
    await act(async () => {
      await ctxRef.removeFromShotList('L1', {
        sceneIds: own.filter(i => i.scene_id).map(i => i.scene_id),
        shotIds: own.filter(i => i.shot_id).map(i => i.shot_id),
      })
    })
    expect(ctxRef.scenes).toEqual([])
    m = measure()
    expectWhole(m, 'cleared')
    expect(m.groups).toEqual(['No Scene'])
    expect(m.byScene).toEqual(['No scene'])
    expect(m.byShot).toEqual(['No shot'])
    expect(m.tip('t3')).toBe('Scene “Two”: in no shot list')
    expect(links()).toEqual(ORIGINAL_LINKS)

    // 2. Another list made active, holding scene One and its shot.
    let alt
    await act(async () => { alt = await ctxRef.addShotList({ title: 'Alt' }) })
    await act(async () => { await ctxRef.addToShotList(alt.id, { sceneIds: ['sc1'], shotIds: ['sh1'] }) })
    await act(async () => { await ctxRef.setActiveShotList(alt.id) })
    expect(ctxRef.scenes.map(s => s.id)).toEqual(['sc1'])
    m = measure()
    expectWhole(m, 'set active')
    expect(m.groups).toEqual(['One', '1A', 'No Scene'])
    expect(m.byScene).toEqual(['One', 'No scene'])
    expect(links()).toEqual(ORIGINAL_LINKS)

    // 3. Archive the old list (it is no longer the active one).
    await act(async () => { await ctxRef.archiveShotList('L1') })
    expect(ctxRef.shotLists.find(l => l.id === 'L1').archived_at).toBeTruthy()
    m = measure()
    expectWhole(m, 'archived')
    expect(m.groups).toEqual(['One', '1A', 'No Scene'])
    expect(links()).toEqual(ORIGINAL_LINKS)

    // None of the three wrote a task.
    expect(taskWrites()).toEqual([])

    // 4. Delete scene One: its shot goes with it, and its task is un-linked
    //    (the database's SET NULL) — still drawn, still counted.
    await act(async () => { await ctxRef.deleteScene('sc1') })
    m = measure()
    expectWhole(m, 'deleted')
    expect(m.groups).toEqual(['No Scene'])
    expect(links()).toEqual([['t1', null, null], ['t2', 'sc2', 'sh2'], ['t3', 'sc2', null], ['t4', null, null]])

    // 5. Scene Two back in the active list: its tasks are under it again —
    //    their links were never written.
    await act(async () => { await ctxRef.addToShotList(alt.id, { sceneIds: ['sc2'], shotIds: ['sh2'] }) })
    m = measure()
    expectWhole(m, 'back')
    expect(m.groups).toEqual(['Two', '2A', 'No Scene'])
    expect(m.byScene).toEqual(['Two', 'No scene'])
    expect(m.byShot).toEqual(['Two › 2A', 'No shot'])
    expect(m.tip('t3')).toBeUndefined()
  })
})
