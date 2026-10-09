/** @vitest-environment jsdom */
// deleteShotTakes.test.jsx — BC2 item 8 (BC1's Deferred): deleting a shot
// and undoing it puts the shot's TAKES back, on all three backends.
//
// 0091 cascades shot_takes from shots on the cloud (and the dev fixtures now
// do as the cloud does); the Local Server keeps a deleted shot's takes as
// orphans. The provider snapshots the shot's takes BEFORE the delete and the
// undo puts them back through replaceShotTakes after the shot — exact on
// every backend, as removeBinFiles' undo already was for a clip's takes.
//
// The REAL provider, over: an in-memory cloud with the cascade, an in-memory
// Local Server that keeps orphans (its replace route's rules), and the real
// dev-fixtures adapter.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import React from 'react'
import { render, cleanup, act, waitFor } from '@testing-library/react'

const holder = vi.hoisted(() => ({ adapter: null, mode: 'supabase', session: null, authCbs: [] }))

vi.mock('../adapters', () => ({
  selectAdapter: () => holder.adapter,
  ADAPTER_MODES: ['supabase', 'local_server', 'google_drive'],
  adapterSupportsWrites: () => true,
}))
vi.mock('../adapters/supabaseAdapter', () => ({ resetSupabaseAdapter: () => {} }))
vi.mock('../../../cloud/auth/supabaseClient', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb) => { holder.authCbs.push(cb); return { data: { subscription: { unsubscribe() {} } } } },
      getSession: async () => ({ data: { session: holder.session } }),
    },
  },
}))
vi.mock('../../../lib/localData', () => ({
  hasLocalServer: () => true,
  loadOtterSettings: async () => ({ rabbit: { adapterMode: holder.mode, activeProjectId: holder.projectId || 'p1' } }),
  saveOtterSettings: async () => {},
}))
// The fixtures are built here (buildDevFixtures) and handed to the provider
// as its adapter; the global switch stays off.
vi.mock('../../../dev/devFixtures', async (importOriginal) => ({ ...(await importOriginal()), devFixtures: () => null }))
vi.mock('../intake/pipeline', () => ({ runIngestion: vi.fn() }))

const { RabbitProvider, useRabbit } = await import('./RabbitProvider')
const { buildDevFixtures } = await import('../../../dev/fixtures/install')

const CLOUD_CAPS = Object.freeze({ backend: 'supabase', pickFiles: false, probe: false, stream: false, resolveFiles: false, relink: false, openInOs: false, posters: 'cloud', locations: true, remoteViewingSwitch: true })
const clone = (x) => JSON.parse(JSON.stringify(x))

// An in-memory backend. `cascade`: the cloud's FK (a shot's takes go with
// it); without it, the Local Server's orphans (kept on disk, hidden from
// reads until the shot is back).
function makeBackend({ mode, cascade }) {
  const db = {
    project: { id: 'p1', title: 'Salt Hours', workspace_id: 'w1', scenes_enabled: true },
    scenes: [{ id: 'sc1', project_id: 'p1', name: 'One', scene_number: 1 }],
    shots: [{ id: 'sh1', project_id: 'p1', scene_id: 'sc1', name: '1A', shot_number: 10 }, { id: 'sh2', project_id: 'p1', scene_id: 'sc1', name: '1B', shot_number: 20 }],
    bins: [{ id: 'b1', project_id: 'p1', name: 'Day 1', parent_bin_id: null, sort_order: 0 }],
    files: [
      { id: 'f1', project_id: 'p1', bin_id: 'b1', display_name: 'T1', original_name: 'T1.mov', sort_order: 0 },
      { id: 'f2', project_id: 'p1', bin_id: 'b1', display_name: 'T2', original_name: 'T2.mov', sort_order: 1 },
    ],
    takes: [
      { id: 't1', project_id: 'p1', shot_id: 'sh1', bin_file_id: 'f1', role: 'primary', position: 0, notes: 'the one' },
      { id: 't2', project_id: 'p1', shot_id: 'sh1', bin_file_id: 'f2', role: 'alt', position: 1, notes: '' },
      { id: 't3', project_id: 'p1', shot_id: 'sh2', bin_file_id: 'f2', role: 'primary', position: 0, notes: '' },
    ],
  }
  const live = () => db.takes.filter(t => db.shots.some(s => s.id === t.shot_id) && db.files.some(f => f.id === t.bin_file_id))
  const answer = (shotIds) => ({ affectedShotIds: shotIds, shotTakes: clone(live().filter(t => shotIds.includes(t.shot_id))), orphanTakes: [] })
  const calls = []
  return {
    mode, db, calls,
    status: async () => ({ online: true, lastSyncAt: null }),
    listProjects: async () => [clone(db.project)],
    loadProject: async () => clone({ project: db.project, scenes: db.scenes, shots: db.shots, bins: db.bins, binFiles: db.files, binRoots: [], shotTakes: live(), binLocations: [] }),
    listProjectMembers: async () => [],
    subscribeProjectChanges: () => () => {},
    ...(mode === 'supabase' ? { binsCapabilities: () => CLOUD_CAPS } : {}),
    listBins: async () => clone({ bins: db.bins, binFiles: db.files, binRoots: [], binLocations: [], shotTakes: live(), orphanTakes: [], ffmpeg: false }),
    upsertShot: async (row) => { calls.push(['upsertShot', row.id]); db.shots = [...db.shots.filter(s => s.id !== row.id), clone(row)]; return clone(row) },
    deleteShot: async (sid) => {
      calls.push(['deleteShot', sid])
      db.shots = db.shots.filter(s => s.id !== sid)
      if (cascade) db.takes = db.takes.filter(t => t.shot_id !== sid)
    },
    replaceShotTakes: async (_pid, shotIds, rows) => {
      calls.push(['replaceShotTakes', shotIds, rows.map(r => r.id)])
      const set = new Set(shotIds)
      // Only the LIVE rows of the named shots are replaced (the Local
      // Server's rule; on the cloud every row of a live shot is live).
      const liveIds = new Set(live().filter(t => set.has(t.shot_id)).map(t => t.id))
      db.takes = db.takes.filter(t => !liveIds.has(t.id))
      for (const r of rows) {
        if (!set.has(r.shot_id) || !db.files.some(f => f.id === r.bin_file_id)) continue
        db.takes = [...db.takes.filter(t => t.id !== r.id), { ...r }]
      }
      return answer(shotIds)
    },
  }
}

let ctxRef
function Probe() { ctxRef = useRabbit(); return null }
async function mount() {
  render(<RabbitProvider><Probe /></RabbitProvider>)
  await waitFor(() => expect(ctxRef?.project?.id).toBe(holder.projectId || 'p1'))
  await act(async () => { await ctxRef.refreshBins() })
}

beforeEach(() => { holder.session = { user: { id: 'u1', app_metadata: {} } }; holder.authCbs = []; holder.projectId = null; ctxRef = null })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const takeKey = (rows) => rows.map(t => [t.id, t.shot_id, t.bin_file_id, t.role, t.position, t.notes || '']).sort((a, b) => a[0].localeCompare(b[0]))

describe('deleting a shot, then Undo: its takes come back', () => {
  it('on the cloud (0091 cascades a shot\'s takes): the undo puts them back after the shot', async () => {
    holder.mode = 'supabase'
    holder.adapter = makeBackend({ mode: 'supabase', cascade: true })
    await mount()
    const before = takeKey(holder.adapter.db.takes.filter(t => t.shot_id === 'sh1'))
    await act(async () => { await ctxRef.deleteShot('sh1') })
    expect(holder.adapter.db.takes.filter(t => t.shot_id === 'sh1')).toEqual([])
    await act(async () => { await ctxRef.undo() })
    await waitFor(() => expect(takeKey(holder.adapter.db.takes.filter(t => t.shot_id === 'sh1'))).toEqual(before))
    // The shot first, then its takes (a take cannot name a shot that is not there).
    const verbs = holder.adapter.calls.map(c => c[0])
    expect(verbs.lastIndexOf('replaceShotTakes')).toBeGreaterThan(verbs.lastIndexOf('upsertShot'))
    expect(takeKey(ctxRef.shotTakes.filter(t => t.shot_id === 'sh1'))).toEqual(before)
    // Another shot's takes were never touched.
    expect(holder.adapter.db.takes.filter(t => t.shot_id === 'sh2').map(t => t.id)).toEqual(['t3'])
  })

  it('on the signed-out desktop (orphans kept): the same undo, and nothing doubled', async () => {
    holder.mode = 'local_server'
    holder.adapter = makeBackend({ mode: 'local_server', cascade: false })
    await mount()
    const before = takeKey(holder.adapter.db.takes.filter(t => t.shot_id === 'sh1'))
    await act(async () => { await ctxRef.deleteShot('sh1') })
    // Kept as orphans on disk.
    expect(holder.adapter.db.takes.filter(t => t.shot_id === 'sh1')).toHaveLength(2)
    await act(async () => { await ctxRef.undo() })
    await waitFor(() => expect(holder.adapter.calls.some(c => c[0] === 'replaceShotTakes')).toBe(true))
    expect(takeKey(holder.adapter.db.takes.filter(t => t.shot_id === 'sh1'))).toEqual(before)
  })

  it('on the dev fixtures (the cloud as a browser sees it, with the cascade): the takes come back', async () => {
    holder.mode = 'supabase'
    const fx = buildDevFixtures()
    holder.adapter = fx.rabbitAdapter()
    const projects = await holder.adapter.listProjects()
    holder.projectId = projects[0].id
    await mount()
    const withTakes = [...new Set(ctxRef.shotTakes.map(t => t.shot_id))].find(sid => ctxRef.shots.some(s => s.id === sid))
    expect(withTakes, 'the fixtures have a shot with takes').toBeTruthy()
    const before = takeKey(ctxRef.shotTakes.filter(t => t.shot_id === withTakes))
    await act(async () => { await ctxRef.deleteShot(withTakes) })
    const afterDelete = await holder.adapter.listBins(holder.projectId)
    expect(afterDelete.shotTakes.filter(t => t.shot_id === withTakes)).toEqual([])
    // Gone, as 0091 cascades them — not kept as orphans (the first version
    // read the live rows only, which hide an orphan too: plant P104 survived).
    expect(afterDelete.orphanTakes.filter(t => t.shot_id === withTakes)).toEqual([])
    await act(async () => { await ctxRef.undo() })
    await waitFor(async () => {
      const back = await holder.adapter.listBins(holder.projectId)
      expect(takeKey(back.shotTakes.filter(t => t.shot_id === withTakes)).map(k => k.slice(0, 4))).toEqual(before.map(k => k.slice(0, 4)))
    })
  })
})
