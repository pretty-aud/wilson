/** @vitest-environment jsdom */
// binsProvider.test.jsx — Bins on the cloud (BC1, migration 0091): the REAL
// provider over an in-memory backend that keeps the cloud's rules, in
// 'supabase' mode. shotListsProvider.test.jsx's harness.
//
// What this pins:
//   * supportsBins is TRUE on the cloud (the Bins tab stops saying bins need
//     the desktop); binsInfo carries the backend's capability object and the
//     company's switch; rows from a backend that cannot resolve files are
//     marked "not on this computer" (online: false), on load and on a live
//     insert.
//   * removeBinFiles / deleteBin NEVER call a file delete on any backend
//     (B10): the only adapter methods they reach are the row methods, and
//     the bins block's source names no file-deleting verb.
//   * the undo of a removal puts the TAKES back too (the cloud cascades
//     them): restoreBinFiles, then replaceShotTakes with the snapshot taken
//     before the removal — and the same for a bin's delete in remove mode.
//   * the duplicate check (B8): same location, same file, compared as
//     Windows shares compare.
//   * footage locations: add / remove with undo; a location in use is
//     refused by the backend and nothing changes; the admin's switch flips
//     with undo; every one of these is in the registry (mutationsRegistry
//     pins the source; this drives them).
//   * what the cloud cannot do answers `not_supported_here` through the
//     adapter, unchanged by the provider, and the probe pass stands down.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import React from 'react'
import { render, cleanup, act, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const holder = vi.hoisted(() => ({ adapter: null, mode: 'supabase', session: null, writable: true, authCbs: [], fixtures: null }))

vi.mock('../adapters', () => ({
  selectAdapter: () => holder.adapter,
  ADAPTER_MODES: ['supabase', 'local_server', 'google_drive'],
  adapterSupportsWrites: () => holder.writable,
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
  loadOtterSettings: async () => ({ rabbit: { adapterMode: holder.mode, activeProjectId: 'p1' } }),
  saveOtterSettings: async () => {},
}))
vi.mock('../../../dev/devFixtures', () => ({ devFixtures: () => holder.fixtures }))
vi.mock('../intake/pipeline', () => ({ runIngestion: vi.fn() }))

const { RabbitProvider, useRabbit } = await import('./RabbitProvider')

const CLOUD_CAPS = Object.freeze({
  backend: 'supabase', pickFiles: false, probe: false, stream: false, resolveFiles: false, relink: false, openInOs: false,
  posters: 'cloud', locations: true, remoteViewingSwitch: true,
})

function refusal(message, code) { const e = new Error(message); e.code = code; return e }

// ── an in-memory cloud with 0091's rules ────────────────────────────────────
function makeAdapter() {
  let n = 0
  const id = (p) => `${p}-${++n}`
  const db = {
    project: { id: 'p1', title: 'Salt Hours', workspace_id: 'w1' },
    scenes: [{ id: 'sc1', project_id: 'p1', name: 'One', scene_number: 1 }],
    shots: [{ id: 'sh1', project_id: 'p1', scene_id: 'sc1', name: '1A', shot_number: 10 }],
    locations: [{ id: 'L1', workspace_id: 'w1', name: 'Footage NAS', unc_path: '\\\\nas\\footage' }],
    bins: [
      { id: 'b1', project_id: 'p1', workspace_id: 'w1', name: 'Footage', kind: 'footage', parent_bin_id: null, sort_order: 0 },
      { id: 'b2', project_id: 'p1', workspace_id: 'w1', name: 'Day 1', kind: 'footage', parent_bin_id: 'b1', sort_order: 0 },
    ],
    files: [
      { id: 'f1', project_id: 'p1', workspace_id: 'w1', bin_id: 'b2', location_id: 'L1', relative_path: 'A001/T1.mov', display_name: 'T1', original_name: 'T1.mov', sort_order: 0, review_flag: 'unflagged' },
      { id: 'f2', project_id: 'p1', workspace_id: 'w1', bin_id: 'b2', location_id: 'L1', relative_path: 'A001/T2.mov', display_name: 'T2', original_name: 'T2.mov', sort_order: 1, review_flag: 'unflagged' },
    ],
    takes: [{ id: 't1', project_id: 'p1', workspace_id: 'w1', shot_id: 'sh1', bin_file_id: 'f1', role: 'primary', position: 0, notes: '' }],
    remoteViewing: false,
  }
  const clone = (x) => JSON.parse(JSON.stringify(x))
  const calls = []
  const answer = (shotIds) => ({ affectedShotIds: [...new Set(shotIds)], shotTakes: clone(db.takes.filter(t => shotIds.includes(t.shot_id))), orphanTakes: [] })
  const a = {
    mode: 'supabase',
    calls, db,
    status: async () => ({ online: true, lastSyncAt: null }),
    listProjects: async () => [clone(db.project)],
    loadProject: async () => clone({
      project: db.project, scenes: db.scenes, shots: db.shots,
      bins: db.bins, binFiles: db.files, binRoots: [], shotTakes: db.takes, binLocations: db.locations,
    }),
    listProjectMembers: async () => [],
    subscribeProjectChanges: () => () => {},
    binsCapabilities: () => CLOUD_CAPS,
    listBins: async () => { calls.push(['listBins']); return clone({ bins: db.bins, binFiles: db.files, binRoots: [], binLocations: db.locations, shotTakes: db.takes, orphanTakes: [], ffmpeg: false, capabilities: CLOUD_CAPS }) },
    getRemoteViewingEnabled: async () => db.remoteViewing,
    setRemoteViewingEnabled: async (_ws, on) => { calls.push(['setRemoteViewingEnabled', on]); db.remoteViewing = on === true; return db.remoteViewing },
    createBin: async (_pid, bin) => { calls.push(['createBin', bin.id]); const row = { ...bin, id: bin.id || id('bin'), project_id: 'p1', workspace_id: 'w1' }; db.bins = [...db.bins.filter(b => b.id !== row.id), row]; return clone(row) },
    deleteBin: async (_pid, binId, { mode }) => {
      calls.push(['deleteBin', binId, mode])
      const doomed = new Set([binId]); let grew = true
      while (grew) { grew = false; for (const b of db.bins) if (!doomed.has(b.id) && doomed.has(b.parent_bin_id)) { doomed.add(b.id); grew = true } }
      const removedFiles = db.files.filter(f => doomed.has(f.bin_id))
      const gone = new Set(removedFiles.map(f => f.id))
      const removedTakes = db.takes.filter(t => gone.has(t.bin_file_id))
      db.takes = db.takes.filter(t => !gone.has(t.bin_file_id))
      db.files = db.files.filter(f => !doomed.has(f.bin_id))
      const removedBins = db.bins.filter(b => doomed.has(b.id))
      db.bins = db.bins.filter(b => !doomed.has(b.id))
      return clone({ ok: true, removedBins, movedFiles: [], removedFiles, removedTakes })
    },
    removeBinFiles: async (_pid, ids) => {
      calls.push(['removeBinFiles', ids])
      const set = new Set(ids)
      const removed = db.files.filter(f => set.has(f.id))
      const removedTakes = db.takes.filter(t => set.has(t.bin_file_id))
      db.files = db.files.filter(f => !set.has(f.id))
      db.takes = db.takes.filter(t => !set.has(t.bin_file_id)) // 0091's CASCADE
      return clone({ removed, removedTakes })
    },
    restoreBinFiles: async (_pid, rows) => {
      calls.push(['restoreBinFiles', rows.map(r => r.id)])
      const restored = []; const skipped = []
      for (const r of rows) {
        if (!db.bins.some(b => b.id === r.bin_id)) { skipped.push({ id: r.id, reason: 'bin_gone' }); continue }
        const { online, ...row } = r
        db.files = [...db.files.filter(f => f.id !== row.id), row]
        restored.push(row)
      }
      return clone({ restored, skipped, affectedShotIds: [], shotTakes: [], orphanTakes: [] })
    },
    replaceShotTakes: async (_pid, shotIds, rows) => {
      calls.push(['replaceShotTakes', shotIds, rows.map(r => r.id)])
      const set = new Set(shotIds)
      db.takes = db.takes.filter(t => !set.has(t.shot_id))
      for (const r of rows) if (db.files.some(f => f.id === r.bin_file_id)) db.takes.push({ ...r, project_id: 'p1' })
      return clone(answer(shotIds))
    },
    assignShotTakes: async (_pid, list) => {
      const created = []
      for (const x of list) { const row = { id: id('take'), project_id: 'p1', shot_id: x.shot_id, bin_file_id: x.bin_file_id, role: db.takes.some(t => t.shot_id === x.shot_id) ? 'alt' : 'primary', position: db.takes.filter(t => t.shot_id === x.shot_id).length, notes: '' }; db.takes.push(row); created.push(row) }
      return clone({ created, skipped: [], ...answer(list.map(x => x.shot_id)) })
    },
    listBinLocations: async () => clone(db.locations),
    createBinLocation: async (loc) => { calls.push(['createBinLocation', loc.unc_path]); const row = { id: loc.id || id('loc'), workspace_id: 'w1', name: loc.name, unc_path: loc.unc_path }; db.locations = [...db.locations.filter(l => l.id !== row.id), row]; return clone(row) },
    updateBinLocation: async (lid, patch) => { const row = db.locations.find(l => l.id === lid); Object.assign(row, patch); return clone(row) },
    removeBinLocation: async (lid) => {
      calls.push(['removeBinLocation', lid])
      if (db.files.some(f => f.location_id === lid)) throw refusal('[supabase] This location still has clips in it — move or remove them before taking it away.', '23503')
      const row = db.locations.find(l => l.id === lid)
      db.locations = db.locations.filter(l => l.id !== lid)
      return clone(row)
    },
    probeBinFile: async () => { calls.push(['probeBinFile']); throw refusal('[supabase] Reading a file\'s columns is not supported here', 'not_supported_here') },
    pickBinFiles: async () => { throw refusal('[supabase] Picking files is not supported here — it needs the desktop app on a computer that can reach the footage.', 'not_supported_here') },
    binFilePosterUrl: async (_pid, row) => (row?.poster_path ? `signed:${row.poster_path}` : null),
    binFileThumbnailUrl: () => null,
    binFileStreamUrl: () => null,
  }
  return a
}

let ctxRef
function Probe() { ctxRef = useRabbit(); return null }

async function mount() {
  render(<RabbitProvider><Probe /></RabbitProvider>)
  await waitFor(() => expect(ctxRef?.project?.id).toBe('p1'))
  await act(async () => { await ctxRef.refreshBins() })
  await waitFor(() => expect(ctxRef.binsInfo.loadedFor).toBe('p1'))
}

beforeEach(() => {
  holder.adapter = makeAdapter()
  holder.mode = 'supabase'
  holder.session = { user: { id: 'u1', app_metadata: {} } }
  holder.writable = true
  holder.authCbs = []
  holder.fixtures = null
  ctxRef = null
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('BC1 — bins on the cloud through the real provider', () => {
  it('supportsBins is true in supabase mode; binsInfo carries the capability object and the switch', async () => {
    await mount()
    expect(ctxRef.supportsBins).toBe(true)
    expect(ctxRef.binsInfo.capabilities).toBe(CLOUD_CAPS)
    expect(ctxRef.binsInfo.remoteViewing).toBe(false)
    expect(ctxRef.binLocations.map(l => l.id)).toEqual(['L1'])
  })

  it('rows from a backend that cannot resolve files are marked "not on this computer"', async () => {
    await mount()
    expect(ctxRef.binFiles.every(f => f.online === false)).toBe(true)
  })

  it('removing clips never calls a file delete; the undo restores the rows AND their takes', async () => {
    await mount()
    expect(ctxRef.shotTakes.map(t => t.id)).toEqual(['t1'])
    await act(async () => { await ctxRef.removeBinFiles(['f1'], { quiet: true }) })
    expect(holder.adapter.db.files.map(f => f.id)).toEqual(['f2'])
    expect(holder.adapter.db.takes).toEqual([]) // the cloud cascaded the take
    const verbs = holder.adapter.calls.map(c => c[0])
    expect(verbs).toContain('removeBinFiles')
    expect(verbs.filter(v => /delete|unlink|remove/i.test(v) && v !== 'removeBinFiles')).toEqual([])
    await act(async () => { await ctxRef.undo() })
    await waitFor(() => expect(holder.adapter.db.files.map(f => f.id).sort()).toEqual(['f1', 'f2']))
    expect(holder.adapter.db.takes.map(t => [t.id, t.shot_id, t.bin_file_id])).toEqual([['t1', 'sh1', 'f1']])
    expect(holder.adapter.calls.some(c => c[0] === 'replaceShotTakes' && c[1][0] === 'sh1' && c[2][0] === 't1')).toBe(true)
    await waitFor(() => expect(ctxRef.shotTakes.map(t => t.id)).toEqual(['t1']))
  })

  it('deleting a bin (remove mode) takes its children and clips; the undo brings bins, clips and takes back', async () => {
    await mount()
    await act(async () => { await ctxRef.deleteBin('b1', { mode: 'remove' }) })
    expect(holder.adapter.db.bins).toEqual([])
    expect(holder.adapter.db.files).toEqual([])
    expect(holder.adapter.db.takes).toEqual([])
    await act(async () => { await ctxRef.undo() })
    await waitFor(() => expect(holder.adapter.db.bins.map(b => b.id).sort()).toEqual(['b1', 'b2']))
    expect(holder.adapter.db.files.map(f => f.id).sort()).toEqual(['f1', 'f2'])
    expect(holder.adapter.db.takes.map(t => t.id)).toEqual(['t1'])
    // Parents before children: b1 was re-created before b2.
    const creates = holder.adapter.calls.filter(c => c[0] === 'createBin').map(c => c[1])
    expect(creates).toEqual(['b1', 'b2'])
  })

  it('the duplicate check (B8): same location, same file, whatever the case or the slashes', async () => {
    await mount()
    const [hit, other, otherLoc, none] = ctxRef.findDuplicateBinFiles([
      { location_id: 'L1', relative_path: 'a001\\t1.MOV' },
      { location_id: 'L1', relative_path: 'A001/T9.mov' },
      { location_id: 'L2', relative_path: 'A001/T1.mov' },
      null,
    ])
    expect(hit).toEqual({ reason: 'same_path', existing_id: 'f1', existing_bin_id: 'b2', existing_bin_name: 'Day 1' })
    expect(other).toBeNull()
    expect(otherLoc).toBeNull()
    expect(none).toBeNull()
  })

  it('a footage location is added with undo; one in use is refused by the backend and stays', async () => {
    await mount()
    let row
    await act(async () => { row = await ctxRef.addBinLocation({ name: 'Sound', unc_path: '\\\\nas\\sound' }) })
    expect(ctxRef.binLocations.map(l => l.id)).toEqual(['L1', row.id])
    await act(async () => { await ctxRef.undo() })
    await waitFor(() => expect(ctxRef.binLocations.map(l => l.id)).toEqual(['L1']))
    await act(async () => { await ctxRef.redo() })
    await waitFor(() => expect(ctxRef.binLocations.map(l => l.id)).toEqual(['L1', row.id]))
    // L1 has clips: the backend refuses (RESTRICT) and the list is unchanged.
    const err = await ctxRef.removeBinLocation('L1').catch(e => e)
    expect(err.code).toBe('23503')
    expect(ctxRef.binLocations.some(l => l.id === 'L1')).toBe(true)
    expect(holder.adapter.db.locations.some(l => l.id === 'L1')).toBe(true)
  })

  it('the admin\'s switch flips with undo', async () => {
    await mount()
    await act(async () => { await ctxRef.setRemoteViewingEnabled(true) })
    expect(ctxRef.binsInfo.remoteViewing).toBe(true)
    expect(holder.adapter.db.remoteViewing).toBe(true)
    await act(async () => { await ctxRef.undo() })
    await waitFor(() => expect(holder.adapter.db.remoteViewing).toBe(false))
    await waitFor(() => expect(ctxRef.binsInfo.remoteViewing).toBe(false))
  })

  it('what the cloud cannot do refuses with its code, and the probe pass stands down', async () => {
    await mount()
    const err = await ctxRef.pickBinFiles().catch(e => e)
    expect(err.code).toBe('not_supported_here')
    expect(err.message).toContain('needs the desktop app')
    await act(async () => { await ctxRef.probeBinFiles(['f1', 'f2']) })
    expect(holder.adapter.calls.some(c => c[0] === 'probeBinFile')).toBe(false)
    expect(ctxRef.binFiles.every(f => f.probe_status !== 'failed')).toBe(true)
    expect(ctxRef.binsInfo.probing).toBe(0)
  })

  it('a signed poster URL comes from the adapter; a row without a picture has none', async () => {
    await mount()
    expect(await ctxRef.binFilePosterUrl({ id: 'f1', poster_path: 'projects/p1/bin_files/f1/1-poster.jpg' })).toBe('signed:projects/p1/bin_files/f1/1-poster.jpg')
    expect(await ctxRef.binFilePosterUrl({ id: 'f2' })).toBeNull()
    expect(ctxRef.binFileThumbnailUrl('f1')).toBeNull()
  })
})

describe('B10, pinned on the source: the bins block deletes rows, never files', () => {
  // A path, not a file: URL — jsdom's URL class refuses the file scheme.
  const src = readFileSync(path.resolve(process.cwd(), 'src/tools/rabbit_v0.1.0/state/RabbitProvider.jsx'), 'utf8')
  const start = src.indexOf('// ── Bins (demo 2026-09-11')
  const end = src.indexOf('// ── Ingestion runs')
  const block = src.slice(start, end)

  it('the block exists and is the bins block', () => {
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    expect(block).toContain('const removeBinFiles')
    expect(block).toContain('const deleteBin')
  })

  it('no file-deleting verb is reached from it', () => {
    for (const verb of ['deleteFile(', 'deleteManagedFile(', 'unlink', 'rmSync', 'storage.remove', '.remove([']) {
      expect(block.includes(verb), verb).toBe(false)
    }
  })
})
