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
import { cleanup, act, waitFor } from '@testing-library/react'
import { mountRabbit } from './mountRabbit'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const holder = vi.hoisted(() => ({
  adapter: null, mode: 'supabase', session: null, writable: true, authCbs: [], fixtures: null,
  // GW3: the gateway view the cloud answers, the doors in the page, the ticket call.
  gateways: [], doors: null, tickets: null, viewingsCalls: [],
}))

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
// GW3: the cloud's gateway view and ticket call, and the doors in the page,
// answered by the test; everything else in those modules stays real.
vi.mock('../../../cloud/gatewayApi', async (importOriginal) => ({
  ...(await importOriginal()),
  listGatewaysForPlayback: async () => ({ ok: true, data: holder.gateways }),
  fetchGatewayTickets: async (gatewayId, ids) => holder.tickets(gatewayId, ids),
  listRemoteViewingsOfClip: async (id, opts) => { holder.viewingsCalls.push([id, opts]); return { ok: true, data: { rows: [], total: 0 } } },
}))
vi.mock('../bins/gatewayDoors', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    realGatewayDoors: Object.freeze({
      probe: (g) => holder.doors.probe(g),
      clipUrl: real.clipUrl,
      renew: (...a) => holder.doors.renew(...a),
      head: (...a) => holder.doors.head(...a),
    }),
  }
})

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
  await mountRabbit(<RabbitProvider><Probe /></RabbitProvider>, { adapter: holder.adapter, ctx: () => ctxRef, until: () => expect(ctxRef?.project?.id).toBe('p1') })
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
  holder.gateways = []
  holder.doors = { probe: vi.fn(async () => null), renew: vi.fn(async () => ({ ok: false, status: 0 })), head: vi.fn(async () => ({ status: 0, door: null })) }
  holder.tickets = vi.fn(async () => ({ ok: false, status: 0, code: 'network', friendly: 'no cloud in this test' }))
  holder.viewingsCalls = []
  ctxRef = null
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

// BC3 review round 1: the capability object is known the moment the project
// is (a browser read a null object as the signed-out desktop until the first
// list, and for good when that list failed); and a clip row a mutation hands
// back (a restore, a copy) is "not on this computer" like every other where
// the backend cannot say what this computer reaches.
describe('BC3 — a browser knows what it is from the project load, and keeps every row marked', () => {
  it('binsInfo.capabilities is the cloud\'s once the project has loaded, even when the bins list then fails', async () => {
    holder.adapter.listBins = async () => { throw new Error('the list failed') }
    await mountRabbit(<RabbitProvider><Probe /></RabbitProvider>, { adapter: holder.adapter, ctx: () => ctxRef, until: () => expect(ctxRef?.project?.id).toBe('p1') })
    expect(ctxRef.binsInfo.capabilities).toBe(CLOUD_CAPS)
    await act(async () => { await expect(ctxRef.refreshBins()).rejects.toThrow('the list failed') })
    expect(ctxRef.binsInfo.capabilities).toBe(CLOUD_CAPS)
    expect(ctxRef.binFiles.every(f => f.online === false)).toBe(true)
  })

  it('a row the undo of a removal puts back is marked "not on this computer" again', async () => {
    await mount()
    await act(async () => { await ctxRef.removeBinFiles(['f1'], { quiet: true }) })
    await act(async () => { await ctxRef.undo() })
    await waitFor(() => expect(ctxRef.binFiles.map(f => f.id).sort()).toEqual(['f1', 'f2']))
    expect(ctxRef.binFiles.find(f => f.id === 'f1').online).toBe(false)
  })
})

describe('BC1 — bins on the cloud through the real provider', () => {
  it('supportsBins is true in supabase mode; binsInfo carries the capability object and the switch', async () => {
    await mount()
    expect(ctxRef.supportsBins).toBe(true)
    // GW3: in a browser the capability object is the gateway composite's,
    // the cloud's catalogue under its own name until a door answers.
    expect(ctxRef.binsInfo.capabilities).toEqual({ ...CLOUD_CAPS, backend: 'gateway_cloud' })
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

// ── GW3 (2026-10-11): a browser through the file gateway, wired through the
// provider (GATEWAY_DESIGN.md §2, §5; the brief's items 1 and 2). The
// composite over the cloud adapter: a door answering turns `stream` and
// `resolveFiles` on and marks the rows by the gateway's reach; tickets are
// asked for only when the tab asks; the URL carries the ticket and never
// changes on renewal; a 404 flips the row; no gateway keeps the catalogue.
describe('GW3 — a browser through the file gateway, through the real provider', () => {
  const b64url = (s) => Buffer.from(s, 'utf8').toString('base64url')
  const ticketFor = (id) => `v1.${b64url(JSON.stringify({ v: 1, clip: id, jti: `jti-${id}`, exp: Math.floor(Date.now() / 1000) + 120 }))}.${b64url('sig')}`
  const gatewayRow = () => ({
    id: 'g1', workspace_id: 'w1', name: 'Studio NAS', platform: 'windows', version: '0.1.0',
    inside_addresses: [{ host: '192.168.1.10', port: 8443 }], outside_address: null, reach: { L1: 'reachable' },
    last_seen_at: new Date().toISOString(), root_fingerprint: 'fp',
  })
  const reached = async () => {
    await mount()
    await waitFor(() => expect(ctxRef.binsInfo.capabilities.stream).toBe(true))
  }
  beforeEach(() => {
    holder.gateways = [gatewayRow()]
    holder.doors = {
      probe: vi.fn(async (g) => ({ door: 'inside', base: 'https://192.168.1.10:8443', gatewayId: g.id })),
      renew: vi.fn(async () => ({ ok: true, status: 204 })),
      head: vi.fn(async () => ({ status: 206, door: 'inside' })),
    }
    holder.tickets = vi.fn(async (gatewayId, ids) => ({ ok: true, status: 200, data: { tickets: Object.fromEntries(ids.map(id => [id, ticketFor(id)])), missing: [], refused: [], expires_at: null } }))
  })

  it('a door answering turns stream and resolveFiles on together, marks the rows by the gateway\'s reach, and says the gateway and its locations on binsInfo', async () => {
    await reached()
    expect(ctxRef.binsInfo.capabilities).toEqual({ ...CLOUD_CAPS, backend: 'gateway_cloud', stream: true, resolveFiles: true })
    expect(ctxRef.binsInfo.gateway).toMatchObject({ state: 'reached', name: 'Studio NAS' })
    expect(ctxRef.binsInfo.locations).toHaveLength(1)
    expect(ctxRef.binsInfo.locations[0]).toMatchObject({ id: 'L1', status: 'gateway', reachable: true, gateway: 'reachable', gateway_name: 'Studio NAS', door: 'inside' })
    await waitFor(() => expect(ctxRef.binFiles.every(f => f.online === true)).toBe(true))
    expect(holder.doors.probe).toHaveBeenCalledTimes(1)
    expect(holder.tickets).not.toHaveBeenCalled()
  })

  it('no URL before a ticket is asked for; ensureBinTickets asks the cloud once for the batch; the URL carries the ticket; the stream info names the door and the jti; a renewal keeps the URL', async () => {
    await reached()
    expect(ctxRef.binFileStreamUrl('f1')).toBeNull()
    const rev = ctxRef.binsInfo.ticketsRev || 0
    await act(async () => { await ctxRef.ensureBinTickets(['f1', 'f2']) })
    expect(holder.tickets).toHaveBeenCalledTimes(1)
    expect(holder.tickets.mock.calls[0].slice(0, 2)).toEqual(['g1', ['f1', 'f2']])
    const url = ctxRef.binFileStreamUrl('f1')
    expect(url).toMatch(/^https:\/\/192\.168\.1\.10:8443\/v1\/clips\/f1\?t=v1\./)
    expect(ctxRef.gatewayStreamInfo('f1')).toMatchObject({ door: 'inside', held: true, jti: 'jti-f1', base: 'https://192.168.1.10:8443' })
    await waitFor(() => expect(ctxRef.binsInfo.ticketsRev).toBeGreaterThan(rev))
    let r
    await act(async () => { r = await ctxRef.renewGatewayStream('f1') })
    expect(r).toMatchObject({ ok: true })
    expect(holder.doors.renew).toHaveBeenCalledWith('https://192.168.1.10:8443', 'f1', expect.objectContaining({ jti: 'jti-f1' }))
    expect(ctxRef.binFileStreamUrl('f1')).toBe(url)
  })

  it('a 404 from the door flips the row to missing at its location, the rest untouched; refreshGateways answers the summary; a clip\'s viewings are the cloud\'s call', async () => {
    await reached()
    holder.doors.head.mockImplementationOnce(async () => ({ status: 404, door: 'inside' }))
    let r
    await act(async () => { r = await ctxRef.diagnoseGatewayClip('f1') })
    expect(r).toMatchObject({ verdict: 'missing', status: 404 })
    await waitFor(() => expect(ctxRef.binFiles.find(f => f.id === 'f1')).toMatchObject({ online: false, gateway_missing: true }))
    expect(ctxRef.binFiles.find(f => f.id === 'f2').online).toBe(true)
    let s
    await act(async () => { s = await ctxRef.refreshGateways() })
    expect(s).toMatchObject({ state: 'reached', name: 'Studio NAS' })
    await ctxRef.listRemoteViewingsOfClip('f1', { page: 0, pageSize: 25 })
    expect(holder.viewingsCalls).toEqual([['f1', { page: 0, pageSize: 25 }]])
  })

  it('a project reload with the gateway reached marks a teammate\'s NEW clips at once by the gateway\'s reach, never "not on this computer" for all until the next re-read', async () => {
    holder.adapter.db.locations.push({ id: 'L2', workspace_id: 'w1', name: 'Archive', unc_path: '\\\\nas\\archive' })
    holder.gateways = [{ ...gatewayRow(), reach: { L1: 'reachable', L2: 'not_mounted' } }]
    await reached()
    const base = { project_id: 'p1', workspace_id: 'w1', bin_id: 'b2', sort_order: 9, review_flag: 'unflagged' }
    holder.adapter.db.files.push({ ...base, id: 'f3', location_id: 'L1', relative_path: 'A001/T3.mov', display_name: 'T3', original_name: 'T3.mov' })
    holder.adapter.db.files.push({ ...base, id: 'f4', location_id: 'L2', relative_path: 'ARCH/T4.mov', display_name: 'T4', original_name: 'T4.mov' })
    await act(async () => { await ctxRef.reloadActiveProject() })
    const online = Object.fromEntries(ctxRef.binFiles.map(f => [f.id, f.online]))
    expect(online).toEqual({ f1: true, f2: true, f3: true, f4: false })
    // The same through the project's load (selected again): the composite's word at once.
    holder.adapter.db.files.push({ ...base, id: 'f5', location_id: 'L1', relative_path: 'A001/T5.mov', display_name: 'T5', original_name: 'T5.mov' })
    await act(async () => { await ctxRef.setActiveProject('p1', false) })
    await waitFor(() => expect(ctxRef.binFiles.some(f => f.id === 'f5')).toBe(true))
    expect(ctxRef.binFiles.find(f => f.id === 'f5').online).toBe(true)
    expect(ctxRef.binFiles.find(f => f.id === 'f4').online).toBe(false)
  })
  it('round 1, finding 1: another person signing in never plays the last person\'s ticket — the composite is dropped at the sign-out and a fresh ticket is minted for the one here', async () => {
    holder.session = { user: { id: 'user-a', app_metadata: {} } }
    const mintedFor = []
    holder.tickets = vi.fn(async (gatewayId, ids) => {
      const sub = holder.session?.user?.id || null
      mintedFor.push(sub)
      const iat = Math.floor(Date.now() / 1000)
      // No `sub` claim here on purpose: the composite's own check on the
      // ticket's person cannot help, so only the provider's drop protects B.
      return { ok: true, status: 200, data: { tickets: Object.fromEntries(ids.map(id => [id, `v1.${b64url(JSON.stringify({ v: 1, clip: id, iat, exp: iat + 120, jti: `jti-${sub}-${id}` }))}.${b64url('sig')}`])), missing: [], refused: [], expires_at: null } }
    })
    await reached()
    await act(async () => { await ctxRef.ensureBinTickets(['f1']) })
    expect(ctxRef.gatewayStreamInfo('f1').jti).toBe('jti-user-a-f1')
    const urlA = ctxRef.binFileStreamUrl('f1')
    expect(urlA).not.toBeNull()
    await act(async () => { for (const cb of holder.authCbs) cb('SIGNED_OUT', null) })
    holder.session = { user: { id: 'user-b', app_metadata: {} } }
    await act(async () => { for (const cb of holder.authCbs) cb('SIGNED_IN', holder.session) })
    await waitFor(() => expect(ctxRef.authUserId).toBe('user-b'))
    await act(async () => { await ctxRef.setActiveProject('p1', false) })
    await act(async () => { await ctxRef.refreshBins() })
    await waitFor(() => expect(ctxRef.binsInfo.capabilities.stream).toBe(true))
    expect(ctxRef.binFileStreamUrl('f1')).toBeNull()
    expect(ctxRef.gatewayStreamInfo('f1').jti).toBeNull()
    await act(async () => { await ctxRef.ensureBinTickets(['f1']) })
    expect(mintedFor).toEqual(['user-a', 'user-b'])
    expect(ctxRef.gatewayStreamInfo('f1').jti).toBe('jti-user-b-f1')
    expect(ctxRef.binFileStreamUrl('f1')).not.toBe(urlA)
  })
  it('CONTROL: no gateway in the view: the catalogue stays, every row "not on this computer", no door probed, no ticket asked', async () => {
    holder.gateways = []
    await mount()
    await act(async () => { await ctxRef.refreshGateways() })
    expect(ctxRef.binsInfo.capabilities).toEqual({ ...CLOUD_CAPS, backend: 'gateway_cloud' })
    expect(ctxRef.binsInfo.gateway).toMatchObject({ state: 'none' })
    expect(holder.doors.probe).not.toHaveBeenCalled()
    expect(ctxRef.binFiles.every(f => f.online === false)).toBe(true)
    await act(async () => { await ctxRef.ensureBinTickets(['f1']) })
    expect(holder.tickets).not.toHaveBeenCalled()
    expect(ctxRef.binFileStreamUrl('f1')).toBeNull()
  })
})
