/** @vitest-environment jsdom */
// binsDesktopProvider.test.jsx — Bins on the cloud, the desktop app signed in
// (BC2), through the REAL provider: binsProvider.test.jsx's harness (an
// in-memory cloud in 'supabase' mode) plus a fake of this computer's desktop
// process (the Local Server adapter's cloud-bins client).
//
// What this pins:
//   * the predicate: the composite (data from the cloud, files from the
//     desktop) is built only on the cloud, inside the desktop app, when the
//     desktop's file process answers its ping — never in the signed-out
//     desktop (B12: local_server mode never pings), never in a browser, and
//     not when the ping is refused;
//   * it is NOT the supportsManagedFiles mistake: the FILES store is decided
//     exactly as before (false on the cloud, desktop or not) — bins are not
//     files, and this picks no store;
//   * registration: the company's locations — what the cloud returned, id
//     and network address only — are registered with the desktop, again on
//     every change of the list (an add, a removal), the list replacing;
//   * every clip reads what THIS computer can reach, on a load as on a list:
//     never "here" before the desktop has been asked.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import React from 'react'
import { render, cleanup, act, waitFor } from '@testing-library/react'

const holder = vi.hoisted(() => ({ adapter: null, files: null, mode: 'supabase', session: null, authCbs: [], live: null }))

vi.mock('../adapters', () => ({
  selectAdapter: () => holder.adapter,
  ADAPTER_MODES: ['supabase', 'local_server', 'google_drive'],
  adapterSupportsWrites: () => true,
}))
vi.mock('../adapters/supabaseAdapter', () => ({ resetSupabaseAdapter: () => {} }))
vi.mock('../adapters/localServerAdapter', () => ({ localServerAdapter: () => holder.files }))
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
  loadOtterSettings: async () => ({ rabbit: { adapterMode: holder.mode, activeProjectId: holder.noProject ? null : 'p1' } }),
  saveOtterSettings: async () => {},
}))
vi.mock('../../../dev/devFixtures', () => ({ devFixtures: () => null }))
vi.mock('../intake/pipeline', () => ({ runIngestion: vi.fn() }))

const { RabbitProvider, useRabbit, markLoadedBinFiles } = await import('./RabbitProvider')
const { BIN_POSTERS_OFF_SENTENCE, needsCloudPoster } = await import('../bins/cloudPosters')

const CLOUD_CAPS = Object.freeze({
  backend: 'supabase', pickFiles: false, probe: false, stream: false, resolveFiles: false, relink: false, openInOs: false,
  posters: 'cloud', locations: true, remoteViewingSwitch: true,
})

function makeCloud(mode = 'supabase') {
  const clone = (x) => JSON.parse(JSON.stringify(x))
  let n = 0
  const db = {
    project: { id: 'p1', title: 'Salt Hours', workspace_id: 'w1', fps: 25 },
    locations: [{ id: 'L1', workspace_id: 'w1', name: 'Footage NAS', unc_path: '\\\\nas\\footage' }],
    bins: [{ id: 'b1', project_id: 'p1', workspace_id: 'w1', name: 'Day 1', kind: 'footage', parent_bin_id: null, sort_order: 0 }],
    files: [
      { id: 'f1', project_id: 'p1', workspace_id: 'w1', bin_id: 'b1', location_id: 'L1', relative_path: 'A001/T1.mov', display_name: 'T1', original_name: 'T1.mov', media_type: 'video', sort_order: 0 },
      { id: 'f2', project_id: 'p1', workspace_id: 'w1', bin_id: 'b1', location_id: 'L1', relative_path: 'A001/T2.mov', display_name: 'T2', original_name: 'T2.mov', media_type: 'video', sort_order: 1 },
    ],
  }
  return {
    mode, db,
    status: async () => ({ online: true, lastSyncAt: null }),
    listProjects: async () => [clone(db.project)],
    loadProject: async () => clone({ project: db.project, scenes: [], shots: [], bins: db.bins, binFiles: db.files, binRoots: [], shotTakes: [], binLocations: db.locations }),
    listProjectMembers: async () => [],
    subscribeProjectChanges: (_pid, cb) => { holder.live = cb; return () => {} },
    binsCapabilities: () => CLOUD_CAPS,
    listBins: async () => clone({ bins: db.bins, binFiles: db.files, binRoots: [], binLocations: db.locations, shotTakes: [], orphanTakes: [], ffmpeg: false }),
    getRemoteViewingEnabled: async () => db.remoteViewing === true,
    getWorkspaceRemoteViewing: async (ws) => { db.switchReads = [...(db.switchReads || []), ws]; return db.remoteViewing === true },
    setRemoteViewingEnabled: async (ws, on) => { db.switchWrites = [...(db.switchWrites || []), [ws, on]]; db.remoteViewing = on === true; return db.remoteViewing },
    // The cloud's own upload: asks the switch (the client's pre-check) and
    // the "database" refuses regardless when `refuseAnyway` (the admin
    // turned it off between the pre-check and the write).
    postBinFileThumbnail: async (pid, id, base64) => {
      db.uploads = [...(db.uploads || []), id]
      if (db.remoteViewing !== true || db.refuseAnyway) throw Object.assign(new Error('[supabase] This company has not allowed files to be viewed from outside the office network, so WILSON keeps no picture of this clip in the cloud.'), { code: 'remote_viewing_off' })
      const key = `projects/${pid}/bin_files/${id}/1-poster.jpg`
      db.files = db.files.map(f => (f.id === id ? { ...f, poster_path: key } : f))
      return { ok: true, poster_path: key, base64 }
    },
    listBinLocations: async () => clone(db.locations),
    createBinLocation: async (loc) => { const row = { id: loc.id || `loc-${++n}`, workspace_id: 'w1', name: loc.name, unc_path: loc.unc_path }; db.locations = [...db.locations.filter(l => l.id !== row.id), row]; return clone(row) },
    removeBinLocation: async (lid) => { const row = db.locations.find(l => l.id === lid); db.locations = db.locations.filter(l => l.id !== lid); return clone(row) },
    addBinFiles: async (_pid, binId, items) => {
      const created = items.map((it, i) => ({ id: `n${++n}`, project_id: 'p1', workspace_id: 'w1', bin_id: binId, display_name: it.relative_path, sort_order: 10 + i, ...it }))
      db.files = [...db.files, ...created]
      return clone({ created, bins: [], results: created.map(r => ({ status: 'added', id: r.id })) })
    },
    binFileThumbnailUrl: () => null,
    binFileStreamUrl: () => null,
  }
}

function makeFiles({ pingOk = true } = {}) {
  const calls = []
  return {
    calls,
    cloudBinsPing: vi.fn(async () => { calls.push(['ping']); if (!pingOk) throw new Error('HTTP 404'); return { ok: true, ffmpeg: true } }),
    registerCloudBinLocations: vi.fn(async (list) => { calls.push(['register', list]); return { locations: list.map(l => ({ id: l.id, unc_path: l.unc_path, status: 'registered', reachable: true, root: l.unc_path })) } }),
    resolveCloudBinFiles: vi.fn(async (list) => { calls.push(['resolve', list.map(f => f.id)]); return { files: list.map(f => ({ id: f.id, online: f.id === 'f1' })) } }),
    cloudBinFileThumbnailUrl: (loc, rel) => `thumb:${loc}:${rel}`,
    cloudBinFileStreamUrl: (loc, rel) => `stream:${loc}:${rel}`,
    probeCloudBinFile: vi.fn(async () => ({ duration_sec: 3, width: 1920, height: 1080, probe_status: 'done' })),
    cloudBinFileThumbnailBase64: vi.fn(async () => '/9j/AAAA'),
    pickCloudBinLocationLocalPath: vi.fn(async (id) => { calls.push(['pickLocal', id]); return { id, local_path: 'Z:\\footage', local_path_source: 'saved', reachable: true } }),
    forgetCloudBinLocationLocalPath: vi.fn(async (id) => { calls.push(['forgetLocal', id]); return { id, local_path: null } }),
  }
}

let ctxRef
function Probe() { ctxRef = useRabbit(); return null }

async function mount() {
  render(<RabbitProvider><Probe /></RabbitProvider>)
  await waitFor(() => expect(ctxRef?.project?.id).toBe('p1'))
}

beforeEach(() => {
  holder.adapter = makeCloud()
  holder.files = makeFiles()
  holder.mode = 'supabase'
  holder.session = { user: { id: 'u1', app_metadata: {} } }
  holder.authCbs = []
  ctxRef = null
  window.electronAPI = { rabbit: {} }
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete window.electronAPI })

describe('BC2 — the predicate: the desktop\'s file process is reachable', () => {
  it('on the cloud, in the desktop app, with the ping answering: the composite, and every clip marked by this computer', async () => {
    await mount()
    await waitFor(() => expect(ctxRef.binsDesktopFiles).toBe(true))
    await act(async () => { await ctxRef.refreshBins() })
    expect(ctxRef.binsInfo.capabilities.backend).toBe('desktop_cloud')
    expect(ctxRef.binsInfo.capabilities).toMatchObject({ pickFiles: true, probe: true, stream: true, resolveFiles: true, openInOs: true, posters: 'cloud' })
    expect(ctxRef.binsInfo.ffmpeg).toBe(true)
    expect(ctxRef.binFiles.map(f => [f.id, f.online])).toEqual([['f1', true], ['f2', false]])
    expect(ctxRef.binsInfo.locations.map(l => [l.id, l.reachable])).toEqual([['L1', true]])
    // Files by location + path, through the desktop.
    expect(ctxRef.binFileThumbnailUrl('f1')).toBe('thumb:L1:A001/T1.mov')
    expect(ctxRef.binFileStreamUrl('f1')).toBe('stream:L1:A001/T1.mov')
    expect(ctxRef.binFileStreamUrl('f2')).toBeNull()
  })

  it('the predicate follows the provider\'s backend: the dev fixtures in the cloud\'s slot (another adapter name) are composed too', async () => {
    holder.adapter = { ...makeCloud(), mode: 'fixtures' }
    await mount()
    await waitFor(() => expect(ctxRef.binsDesktopFiles).toBe(true))
    await act(async () => { await ctxRef.refreshBins() })
    expect(ctxRef.binsInfo.capabilities.backend).toBe('desktop_cloud')
  })

  it('it is not the supportsManagedFiles mistake: the FILES store is decided as before (false on the cloud)', async () => {
    await mount()
    await waitFor(() => expect(ctxRef.binsDesktopFiles).toBe(true))
    expect(ctxRef.supportsManagedFiles).toBe(false)
    expect(ctxRef.supportsBins).toBe(true)
  })

  it('the ping refused: no composite — the cloud\'s own answers, every clip "not on this computer"', async () => {
    holder.files = makeFiles({ pingOk: false })
    await mount()
    await waitFor(() => expect(holder.files.cloudBinsPing).toHaveBeenCalled())
    await act(async () => { await ctxRef.refreshBins() })
    expect(ctxRef.binsDesktopFiles).toBe(false)
    expect(ctxRef.binsInfo.capabilities).toBe(CLOUD_CAPS)
    expect(ctxRef.binFiles.every(f => f.online === false)).toBe(true)
    expect(holder.files.registerCloudBinLocations).not.toHaveBeenCalled()
  })

  it('in a browser (no desktop bridge): never pinged', async () => {
    delete window.electronAPI
    await mount()
    await act(async () => { await ctxRef.refreshBins() })
    expect(holder.files.cloudBinsPing).not.toHaveBeenCalled()
    expect(ctxRef.binsInfo.capabilities).toBe(CLOUD_CAPS)
  })

  it('B12: the signed-out desktop (local_server) is never pinged and never composed', async () => {
    holder.mode = 'local_server'
    holder.adapter = { ...makeCloud('local_server'), binsCapabilities: undefined }
    await mount()
    await act(async () => { await ctxRef.refreshBins() })
    expect(holder.files.cloudBinsPing).not.toHaveBeenCalled()
    expect(ctxRef.binsDesktopFiles).toBe(false)
    expect(ctxRef.binsInfo.capabilities.backend).toBe('legacy')
  })
})

describe('BC2 — registering the company\'s locations with this computer', () => {
  it('on sign-in, then again on every change of the list — only what the cloud returned, the list replacing', async () => {
    await mount()
    await waitFor(() => expect(holder.files.registerCloudBinLocations).toHaveBeenCalled())
    expect(holder.files.calls.find(c => c[0] === 'register')[1]).toEqual([{ id: 'L1', unc_path: '\\\\nas\\footage' }])
    let row
    await act(async () => { row = await ctxRef.addBinLocation({ name: 'Sound', unc_path: '\\\\nas\\sound' }) })
    await waitFor(() => expect(holder.files.calls.filter(c => c[0] === 'register').at(-1)[1].map(l => l.id).sort()).toEqual(['L1', row.id].sort()))
    await act(async () => { await ctxRef.removeBinLocation(row.id) })
    await waitFor(() => expect(holder.files.calls.filter(c => c[0] === 'register').at(-1)[1]).toEqual([{ id: 'L1', unc_path: '\\\\nas\\footage' }]))
  })

  it('a load marks clips "not on this computer" until the desktop has answered — never "here" before anyone looked', async () => {
    // The load (setActiveProject) lands before the ping: every row false,
    // not undefined. The composite then resolves them.
    let releasePing
    holder.files.cloudBinsPing = vi.fn(() => new Promise(r => { releasePing = () => r({ ok: true, ffmpeg: false }) }))
    await mount()
    expect(ctxRef.binFiles.map(f => f.online)).toEqual([false, false])
    await act(async () => { releasePing() })
    await waitFor(() => expect(ctxRef.binFiles.map(f => [f.id, f.online])).toEqual([['f1', true], ['f2', false]]))
  })
})

describe('BC2 — the company\'s locations, managed from Settings', () => {
  it('with no project open, a location is added, renamed and removed (the verbs need the company, not a project)', async () => {
    holder.noProject = true
    try {
      render(<RabbitProvider><Probe /></RabbitProvider>)
      await waitFor(() => expect(ctxRef?.adapterMode).toBe('supabase'))
      expect(ctxRef.activeProjectId).toBeNull()
      await act(async () => { await ctxRef.refreshBinLocations() })
      expect(ctxRef.binLocations.map(l => l.id)).toEqual(['L1'])
      let row
      await act(async () => { row = await ctxRef.addBinLocation({ name: 'Sound', unc_path: '\\\\nas\\sound' }) })
      expect(holder.adapter.db.locations.map(l => l.id)).toEqual(['L1', row.id])
      await act(async () => { await ctxRef.removeBinLocation(row.id) })
      expect(holder.adapter.db.locations.map(l => l.id)).toEqual(['L1'])
      // The removal offers its undo where Settings shows it: the app's toast.
      expect(ctxRef.undoToast?.message).toContain('Sound')
    } finally { holder.noProject = false }
  })

  it('the switch with no project open: read for the company, flipped for it, and its undo is for the same company', async () => {
    holder.noProject = true
    try {
      render(<RabbitProvider><Probe /></RabbitProvider>)
      await waitFor(() => expect(ctxRef?.adapterMode).toBe('supabase'))
      await act(async () => { await ctxRef.refreshRemoteViewing({ workspaceId: 'w1' }) })
      expect(holder.adapter.db.switchReads).toEqual(['w1'])
      expect(ctxRef.binsInfo.remoteViewing).toBe(false)
      await act(async () => { await ctxRef.setRemoteViewingEnabled(true, { workspaceId: 'w1' }) })
      expect(holder.adapter.db.switchWrites).toEqual([['w1', true]])
      expect(ctxRef.binsInfo.remoteViewing).toBe(true)
      expect(ctxRef.undoToast?.message).toBe('Turned on viewing files from outside the office network')
      await act(async () => { await ctxRef.undo() })
      await waitFor(() => expect(holder.adapter.db.switchWrites).toEqual([['w1', true], ['w1', false]]))
      expect(ctxRef.binsInfo.remoteViewing).toBe(false)
    } finally { holder.noProject = false }
  })

  it('"Where is it on this computer?": the desktop\'s dialog for that location, then the list registered again and every clip resolved', async () => {
    await mount()
    await waitFor(() => expect(ctxRef.binsDesktopFiles).toBe(true))
    await act(async () => { await ctxRef.refreshBins() })
    const registersBefore = holder.files.calls.filter(c => c[0] === 'register').length
    holder.files.resolveCloudBinFiles.mockClear()
    await act(async () => { await ctxRef.pickBinLocationLocalPath('L1') })
    expect(holder.files.pickCloudBinLocationLocalPath).toHaveBeenCalledWith('L1', { name: 'Footage NAS', unc_path: '\\\\nas\\footage' })
    expect(holder.files.calls.filter(c => c[0] === 'register').length).toBeGreaterThan(registersBefore)
    expect(holder.files.resolveCloudBinFiles).toHaveBeenCalled()
    await act(async () => { await ctxRef.forgetBinLocationLocalPath('L1') })
    expect(holder.files.forgetCloudBinLocationLocalPath).toHaveBeenCalledWith('L1')
  })

  it('in a browser the per-computer question is refused with a sentence, not a TypeError', async () => {
    delete window.electronAPI
    await mount()
    const err = await ctxRef.pickBinLocationLocalPath('L1').catch(e => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toContain('needs the desktop app')
  })
})

describe('BC2 — adding clips from a location, through the provider', () => {
  it('the add reads each clip here first (its progress reaches the caller) and stores what it read', async () => {
    await mount()
    await waitFor(() => expect(ctxRef.binsDesktopFiles).toBe(true))
    await act(async () => { await ctxRef.refreshBins() })
    const progress = []
    let res
    await act(async () => {
      res = await ctxRef.addBinFiles('b1', [{ kind: 'file', location_id: 'L1', relative_path: 'A002/T5.mov', source_path: '\\\\nas\\footage\\A002\\T5.mov', media_type: 'video' }], true, null, { onProgress: (p) => progress.push(p) })
    })
    expect(holder.files.probeCloudBinFile).toHaveBeenCalledWith(expect.objectContaining({ location_id: 'L1', relative_path: 'A002/T5.mov', fps: 25 }))
    expect(progress).toEqual([{ done: 1, total: 1 }])
    const stored = holder.adapter.db.files.find(f => f.relative_path === 'A002/T5.mov')
    expect(stored).toMatchObject({ duration_sec: 3, width: 1920, probe_status: 'done' })
    expect('source_path' in stored).toBe(false)
    expect(res.created[0].online).toBe(true)
  })

  it('naming a location registers it with this computer at once (the add flow reads the batch again straight after)', async () => {
    await mount()
    await waitFor(() => expect(ctxRef.binsDesktopFiles).toBe(true))
    await act(async () => { await ctxRef.refreshBins() })
    let row; let duringAdd
    await act(async () => {
      row = await ctxRef.addBinLocation({ name: 'Sound', unc_path: '\\\\nas\\sound' })
      // Read INSIDE the act, before React flushes the re-render and its
      // effects: only the mutator's own registration can have landed. (The
      // first version read after the act, where the effect's registration
      // also counts — plant P41 survived it.)
      duringAdd = holder.files.calls.filter(c => c[0] === 'register').at(-1)[1].map(l => l.id)
    })
    expect(duringAdd.sort()).toEqual(['L1', row.id].sort())
  })
})

describe('BC2 (B4) — a clip\'s picture goes to the cloud only while the company allows it', () => {
  const ready = async () => {
    await mount()
    await waitFor(() => expect(ctxRef.binsDesktopFiles).toBe(true))
    await act(async () => { await ctxRef.refreshBins() })
  }

  it('switch off: not a byte moves — the switch is asked first, and the person reads why (unless quiet)', async () => {
    holder.adapter.db.remoteViewing = false
    await ready()
    let r
    await act(async () => { r = await ctxRef.uploadBinFilePosters(null) })
    expect(r).toMatchObject({ uploaded: 0, refused: true })
    expect(holder.adapter.db.uploads || []).toEqual([])
    expect(holder.files.cloudBinFileThumbnailBase64).not.toHaveBeenCalled()
    expect(ctxRef.binsInfo.notice.text).toBe(BIN_POSTERS_OFF_SENTENCE)
    const before = ctxRef.binsInfo.notice
    await act(async () => { await ctxRef.uploadBinFilePosters(null, { quiet: true }) })
    expect(ctxRef.binsInfo.notice).toBe(before)
  })

  it('switch on: only the clips this computer reaches that have no picture yet', async () => {
    holder.adapter.db.remoteViewing = true
    await ready()
    let r
    await act(async () => { r = await ctxRef.uploadBinFilePosters(null) })
    // f1 is reachable here, f2 is not: only f1's picture can be made here.
    expect(holder.adapter.db.uploads).toEqual(['f1'])
    expect(r).toMatchObject({ uploaded: 1, failed: 0, refused: false })
    expect(ctxRef.binFiles.find(f => f.id === 'f1').poster_path).toBe('projects/p1/bin_files/f1/1-poster.jpg')
    // A second pass finds nothing left to do.
    await act(async () => { r = await ctxRef.uploadBinFilePosters(null) })
    expect(r.uploaded).toBe(0)
  })

  it('a refusal that slips past the pre-check stops the batch and is said ONCE, not per clip', async () => {
    holder.adapter.db.remoteViewing = true
    holder.adapter.db.files = [...holder.adapter.db.files, { ...holder.adapter.db.files[0], id: 'f3', relative_path: 'A001/T3.mov' }]
    holder.files.resolveCloudBinFiles.mockImplementation(async (list) => ({ files: list.map(f => ({ id: f.id, online: true })) }))
    await ready()
    holder.adapter.db.refuseAnyway = true
    let r
    await act(async () => { r = await ctxRef.uploadBinFilePosters(null) })
    expect(holder.adapter.db.uploads).toHaveLength(1)
    expect(r).toMatchObject({ uploaded: 0, refused: true })
    expect(ctxRef.binsInfo.remoteViewing).toBe(false)
    expect(ctxRef.binsInfo.notice.text).toBe(BIN_POSTERS_OFF_SENTENCE)
  })

  it('after an add: the new clips\' pictures go up when the switch is on, and nothing (and no word) when it is off', async () => {
    holder.adapter.db.remoteViewing = false
    await ready()
    const noticeBefore = ctxRef.binsInfo.notice
    await act(async () => { await ctxRef.addBinFiles('b1', [{ location_id: 'L1', relative_path: 'A002/T7.mov', media_type: 'video' }], true) })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(holder.adapter.db.uploads || []).toEqual([])
    expect(ctxRef.binsInfo.notice).toBe(noticeBefore)
    holder.adapter.db.remoteViewing = true
    let res
    await act(async () => { res = await ctxRef.addBinFiles('b1', [{ location_id: 'L1', relative_path: 'A002/T8.mov', media_type: 'video' }], true) })
    await waitFor(() => expect(holder.adapter.db.uploads).toEqual([res.created[0].id]))
  })
})

describe('BC2 — a teammate\'s clip arriving live', () => {
  it('reads "not on this computer" until the desktop has been asked for THAT row, then what it answered', async () => {
    await mount()
    await waitFor(() => expect(ctxRef.binsDesktopFiles).toBe(true))
    await act(async () => { await ctxRef.refreshBins() })
    holder.files.resolveCloudBinFiles.mockClear()
    holder.files.resolveCloudBinFiles.mockImplementation(async (list) => ({ files: list.map(f => ({ id: f.id, online: true })) }))
    const record = { id: 'f9', project_id: 'p1', workspace_id: 'w1', bin_id: 'b1', location_id: 'L1', relative_path: 'A002/T9.mov', display_name: 'T9', original_name: 'T9.mov', media_type: 'video', sort_order: 2 }
    act(() => { holder.live({ table: 'bin_files', op: 'INSERT', record }) })
    await waitFor(() => expect(ctxRef.binFiles.find(f => f.id === 'f9')).toBeTruthy())
    expect(ctxRef.binFiles.find(f => f.id === 'f9').online).toBe(false)
    await waitFor(() => expect(ctxRef.binFiles.find(f => f.id === 'f9').online).toBe(true))
    expect(holder.files.resolveCloudBinFiles.mock.calls.at(-1)[0].map(f => f.id)).toEqual(['f9'])
    // A teammate's flag on a clip keeps what this computer resolved for it.
    act(() => { holder.live({ table: 'bin_files', op: 'UPDATE', record: { ...holder.adapter.db.files[0], review_flag: 'select' } }) })
    await waitFor(() => expect(ctxRef.binFiles.find(f => f.id === 'f1').review_flag).toBe('select'))
    expect(ctxRef.binFiles.find(f => f.id === 'f1').online).toBe(true)
  })
})

describe('markLoadedBinFiles (pure)', () => {
  const rows = [{ id: 'a' }, { id: 'b' }]
  it('a backend that cannot resolve files: every row "not on this computer"', () => {
    expect(markLoadedBinFiles(rows, null, CLOUD_CAPS).map(r => r.online)).toEqual([false, false])
  })
  it('the desktop signed in: what was resolved is kept, the rest reads "not on this computer"', () => {
    expect(markLoadedBinFiles(rows, [{ id: 'a', online: true }], { backend: 'desktop_cloud', resolveFiles: true }).map(r => r.online)).toEqual([true, false])
  })
  it('the signed-out desktop and the fixtures: untouched (B12)', () => {
    const out = markLoadedBinFiles(rows, [{ id: 'a', online: true }], { backend: 'local_server', resolveFiles: true })
    expect(out).toBe(rows)
  })
})
