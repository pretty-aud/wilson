// =============================================================================
// desktopCloudBins.test.js — Bins on the cloud, the desktop app signed in
// (BC2). The composite: the cloud's data, this computer's files.
//
// What this pins:
//   * the capability object is the parity shape (the keys every backend
//     answers), frozen, and says the desktop can pick, probe, stream, resolve
//     and open, relinks by location, keeps its pictures in the cloud's bucket
//     and has the company's locations and switch;
//   * every cloud method is still the cloud's (lists, writes, takes, the
//     locations, the switch) — reached through the prototype;
//   * listBins registers ONLY what the cloud returned (id + network address;
//     never a local folder from the renderer) and marks each row with what
//     this computer can reach — a row the desktop did not answer for, or a
//     desktop that did not answer at all, reads "not on this computer";
//   * an add sends the cloud's RPC exactly the columns it reads, the
//     technical ones filled by a probe HERE first, and never this
//     computer's own path;
//   * a probe writes the columns to the cloud; a renderer-decoded poster
//     goes to THIS computer's cache only; an upload is a separate method
//     that goes through the cloud's own (switch-asking) upload;
//   * relinking by path is refused with the sentence that says how the
//     cloud finds footage again (by location, per computer).
// =============================================================================

import { describe, it, expect } from 'vitest'
import {
  composeDesktopCloudBins, DESKTOP_CLOUD_BINS_CAPABILITIES, BIN_FILE_TECH_COLUMNS,
  PROBE_BEFORE_ADD, RELINK_BY_LOCATION_SENTENCE,
} from './desktopCloudBins'

const ROWS = [
  { id: 'f1', bin_id: 'b1', location_id: 'L1', relative_path: 'A001/T1.mov', media_type: 'video', extension: '.mov', mtime: '2026-10-01T10:00:00.000Z' },
  { id: 'f2', bin_id: 'b1', location_id: 'L1', relative_path: 'A001/T2.mov', media_type: 'video', extension: '.mov' },
  { id: 'f3', bin_id: 'b1', location_id: 'L2', relative_path: 'VFX/plate_seq', is_sequence: true, media_type: 'sequence', extension: '.exr' },
]
const LOCS = [
  { id: 'L1', name: 'Footage NAS', unc_path: '\\\\nas\\footage', local_path: 'C:\\never-sent' },
  { id: 'L2', name: 'VFX', unc_path: '\\\\nas\\vfx' },
]

function makeCloud() {
  const calls = []
  const cloud = {
    mode: 'supabase',
    calls,
    async listBins() { return { bins: [], binFiles: ROWS.map(r => ({ ...r })), binRoots: [], binLocations: LOCS.map(l => ({ ...l })), shotTakes: [], orphanTakes: [], ffmpeg: false } },
    async updateBinFile(pid, id, patch) { calls.push(['updateBinFile', pid, id, patch]); return { ...ROWS.find(r => r.id === id), ...patch } },
    async addBinFiles(pid, binId, items, sub) { calls.push(['addBinFiles', pid, binId, items, sub]); return { created: items.map((it, i) => ({ id: `n${i}`, ...it })), bins: [], results: items.map((it, i) => ({ status: 'added', id: `n${i}` })) } },
    async copyBinFiles() { return { created: [{ ...ROWS[0], id: 'c1' }] } },
    async restoreBinFiles(_p, rows) { return { restored: rows.map(r => ({ ...r })), skipped: [] } },
    async postBinFileThumbnail(pid, id, base64) { calls.push(['postBinFileThumbnail', pid, id, base64, this === cloud ? 'cloud' : 'composite']); return { ok: true, poster_path: `projects/${pid}/bin_files/${id}/1-poster.jpg` } },
    async listBinLocations() { return LOCS },
    async setRemoteViewingEnabled() { return true },
    async assignShotTakes() { calls.push(['assignShotTakes']); return { created: [] } },
  }
  return cloud
}

function makeFiles({ reachable = new Set(['f1', 'f3']), fail = false } = {}) {
  const calls = []
  return {
    calls,
    async registerCloudBinLocations(list) { calls.push(['register', list]); if (fail) throw new Error('desktop down'); return { locations: list.map(l => ({ id: l.id, status: 'registered', reachable: l.id === 'L1', root: l.unc_path })) } },
    async resolveCloudBinFiles(list) {
      calls.push(['resolve', list])
      if (fail) throw new Error('desktop down')
      // f2 is not answered at all: it must read "not on this computer".
      return { files: list.filter(f => f.id !== 'f2').map(f => ({ id: f.id, online: reachable.has(f.id) })) }
    },
    async probeCloudBinFile(file) { calls.push(['probe', file]); if (file.relative_path.includes('broken')) throw Object.assign(new Error('nope'), { status: 422 }); return { size_bytes: 10, duration_sec: 4.5, width: 1920, height: 1080, fps: 25, codec: 'h264', probe_status: 'done', sample_rate: 48000, path: 'Z:\\x', online: true } },
    async pickCloudBinFiles() { calls.push(['pick']); return { paths: ['\\\\nas\\footage\\A001\\T3.mov'] } },
    async pickCloudBinFolder(title) { calls.push(['pickFolder', title]); return { path: '\\\\nas\\footage\\A001' } },
    async prepareCloudBinFiles(paths, opts) { calls.push(['prepare', paths, opts]); return { items: [] } },
    async openCloudBinFile(f) { calls.push(['open', f]); return { ok: true } },
    async postCloudBinFileThumbnail(f) { calls.push(['postLocal', f]); return { ok: true } },
    async cloudBinFileThumbnailBase64(loc, rel, opts) { calls.push(['bytes', loc, rel, opts]); return '/9j/AAA=' },
    cloudBinFileStreamUrl: (loc, rel, opts) => `stream:${loc}:${rel}:${opts.isSequence ? 'seq' : 'file'}`,
    cloudBinFileThumbnailUrl: (loc, rel, rev, opts) => `thumb:${loc}:${rel}:${rev}:${opts.mediaType}:${opts.mtime || ''}`,
    async pickCloudBinLocationLocalPath(id, body) { calls.push(['pickLocal', id, body]); return { local_path: 'Z:\\' } },
    async forgetCloudBinLocationLocalPath(id) { calls.push(['forgetLocal', id]); return { ok: true } },
  }
}

const rowOf = (id) => ROWS.find(r => r.id === id) || null

describe('the composite capability object', () => {
  it('is the parity shape, frozen, and says what the desktop signed in can do', () => {
    expect(Object.isFrozen(DESKTOP_CLOUD_BINS_CAPABILITIES)).toBe(true)
    expect(Object.keys(DESKTOP_CLOUD_BINS_CAPABILITIES).sort()).toEqual(
      ['backend', 'pickFiles', 'probe', 'stream', 'resolveFiles', 'relink', 'openInOs', 'posters', 'locations', 'remoteViewingSwitch'].sort())
    expect(DESKTOP_CLOUD_BINS_CAPABILITIES).toEqual({
      backend: 'desktop_cloud', pickFiles: true, probe: true, stream: true, resolveFiles: true,
      relink: true, openInOs: true, posters: 'cloud', locations: true, remoteViewingSwitch: true,
    })
    const c = composeDesktopCloudBins(makeCloud(), makeFiles(), { rowOf })
    expect(c.binsCapabilities()).toBe(DESKTOP_CLOUD_BINS_CAPABILITIES)
  })

  it('refuses to build without both halves', () => {
    expect(() => composeDesktopCloudBins(makeCloud(), null)).toThrow()
    expect(() => composeDesktopCloudBins(null, makeFiles())).toThrow()
  })
})

describe('the cloud\'s methods stay the cloud\'s', () => {
  it('a write, the takes, the locations and the switch reach the cloud adapter through the prototype', async () => {
    const cloud = makeCloud()
    const c = composeDesktopCloudBins(cloud, makeFiles(), { rowOf })
    expect(c.mode).toBe('supabase')
    await c.assignShotTakes('p1', [])
    expect(cloud.calls.map(x => x[0])).toEqual(['assignShotTakes'])
    expect(await c.listBinLocations()).toBe(LOCS)
    expect(await c.setRemoteViewingEnabled('w1', true)).toBe(true)
    expect(Object.getPrototypeOf(c)).toBe(cloud)
  })
})

describe('listBins: the cloud\'s rows, marked with what THIS computer can reach', () => {
  it('registers only what the cloud returned — id and network address, never a local folder', async () => {
    const files = makeFiles()
    const c = composeDesktopCloudBins(makeCloud(), files, { rowOf })
    const data = await c.listBins('p1')
    const reg = files.calls.find(x => x[0] === 'register')[1]
    expect(reg).toEqual([{ id: 'L1', unc_path: '\\\\nas\\footage' }, { id: 'L2', unc_path: '\\\\nas\\vfx' }])
    expect(JSON.stringify(reg)).not.toContain('never-sent')
    expect(data.locationStatus.map(l => [l.id, l.reachable])).toEqual([['L1', true], ['L2', false]])
    expect(data.capabilities).toBe(DESKTOP_CLOUD_BINS_CAPABILITIES)
  })

  it('a reachable row is online; one the desktop did not answer for is "not on this computer"', async () => {
    const c = composeDesktopCloudBins(makeCloud(), makeFiles(), { rowOf })
    const { binFiles } = await c.listBins('p1')
    expect(binFiles.map(f => [f.id, f.online])).toEqual([['f1', true], ['f2', false], ['f3', true]])
  })

  it('the desktop not answering: every row reads "not on this computer", and the list still arrives', async () => {
    const c = composeDesktopCloudBins(makeCloud(), makeFiles({ fail: true }), { rowOf })
    const data = await c.listBins('p1')
    expect(data.binFiles.every(f => f.online === false)).toBe(true)
    expect(data.filesError).toContain('desktop down')
  })

  it('the ping\'s decoder flag rides on the list', async () => {
    const c = composeDesktopCloudBins(makeCloud(), makeFiles(), { rowOf, ping: { ok: true, ffmpeg: true } })
    expect((await c.listBins('p1')).ffmpeg).toBe(true)
  })
})

describe('adding: the adding computer fills the columns, the cloud stores them', () => {
  const items = [
    { kind: 'file', status: 'ok', location_id: 'L1', relative_path: 'A001/T3.mov', source_path: '\\\\nas\\footage\\A001\\T3.mov', original_name: 'T3.mov', extension: '.mov', size_bytes: 9, mtime: '2026-10-02T00:00:00.000Z', media_type: 'video', display_name: 'T3', suggestions: { slate: '1' }, duplicate: null, sub_bin: 'A001', slate: '1' },
    { kind: 'sequence', status: 'ok', location_id: 'L2', relative_path: 'VFX/broken_seq', source_path: '\\\\nas\\vfx\\VFX\\broken_seq', original_name: 'broken_seq', extension: '.exr', media_type: 'sequence', sequence: { pattern: 'p.####.exr' }, sequence_pattern: 'p.####.exr', frame_count: 12 },
  ]

  it('probes each item here first, sends only what add_bin_files reads, and never this computer\'s path', async () => {
    const cloud = makeCloud(); const files = makeFiles()
    const c = composeDesktopCloudBins(cloud, files, { rowOf, projectFps: () => 25 })
    const progress = []
    const res = await c.addBinFiles('p1', 'b1', items, true, ['C:\\roots'], { onProgress: (p) => progress.push(p) })
    const sent = cloud.calls.find(x => x[0] === 'addBinFiles')[3]
    expect(sent[0]).toMatchObject({ location_id: 'L1', relative_path: 'A001/T3.mov', duration_sec: 4.5, width: 1920, codec: 'h264', probe_status: 'done', sub_bin: 'A001', slate: '1', is_sequence: false })
    expect(sent[1]).toMatchObject({ location_id: 'L2', is_sequence: true, frame_count: 12, sequence_pattern: 'p.####.exr', probe_status: 'failed' })
    for (const s of sent) {
      for (const k of ['source_path', 'suggestions', 'duplicate', 'sequence', 'kind', 'status', 'sample_rate', 'path', 'online']) expect(k in s, k).toBe(false)
    }
    expect(JSON.stringify(sent)).not.toContain('\\\\nas\\\\footage\\\\A001')
    expect(files.calls.filter(x => x[0] === 'probe').map(x => x[1].fps)).toEqual([25, 25])
    expect(progress.at(-1)).toEqual({ done: 2, total: 2 })
    expect(res.created.every(r => r.online === true)).toBe(true)
  })

  it(`past ${PROBE_BEFORE_ADD} items the rest are added pending (read after), not probed before`, async () => {
    const cloud = makeCloud(); const files = makeFiles()
    const c = composeDesktopCloudBins(cloud, files, { rowOf })
    const many = Array.from({ length: PROBE_BEFORE_ADD + 3 }, (_, i) => ({ location_id: 'L1', relative_path: `A/${i}.mov`, media_type: 'video' }))
    await c.addBinFiles('p1', 'b1', many, true)
    expect(files.calls.filter(x => x[0] === 'probe').length).toBe(PROBE_BEFORE_ADD)
    const sent = cloud.calls.find(x => x[0] === 'addBinFiles')[3]
    expect(sent.at(-1).probe_status).toBe('pending')
    expect(sent[0].probe_status).toBe('done')
  })
})

describe('a clip\'s file, by location + path', () => {
  it('probe: read here, the technical columns written to the cloud (nothing else)', async () => {
    const cloud = makeCloud(); const files = makeFiles()
    const c = composeDesktopCloudBins(cloud, files, { rowOf, projectFps: () => 24 })
    const row = await c.probeBinFile('p1', 'f1')
    const patch = cloud.calls.find(x => x[0] === 'updateBinFile')[3]
    expect(Object.keys(patch).every(k => BIN_FILE_TECH_COLUMNS.includes(k))).toBe(true)
    expect(patch).toMatchObject({ duration_sec: 4.5, width: 1920, probe_status: 'done' })
    expect(row.online).toBe(true)
    expect(files.calls.find(x => x[0] === 'probe')[1]).toMatchObject({ location_id: 'L1', relative_path: 'A001/T1.mov', is_sequence: false, media_type: 'video', fps: 24 })
  })

  it('stream and poster URLs by location + path; an unreachable row streams nothing but its cached poster still has a URL', () => {
    const rows = [{ ...ROWS[0], online: true }, { ...ROWS[1], online: false }, { ...ROWS[2], online: true }]
    const c = composeDesktopCloudBins(makeCloud(), makeFiles(), { rowOf: (id) => rows.find(r => r.id === id) })
    expect(c.binFileStreamUrl('p1', 'f1')).toBe('stream:L1:A001/T1.mov:file')
    expect(c.binFileStreamUrl('p1', 'f3')).toBe('stream:L2:VFX/plate_seq:seq')
    expect(c.binFileStreamUrl('p1', 'f2')).toBeNull()
    expect(c.binFileStreamUrl('p1', 'nope')).toBeNull()
    expect(c.binFileThumbnailUrl('p1', 'f1', 3)).toBe('thumb:L1:A001/T1.mov:3:video:2026-10-01T10:00:00.000Z')
    expect(c.binFileThumbnailUrl('p1', 'f2', 0)).toBe('thumb:L1:A001/T2.mov:0:video:')
  })

  it('open goes to the desktop by location + path; a renderer-decoded poster goes to THIS computer\'s cache only', async () => {
    const cloud = makeCloud(); const files = makeFiles()
    const c = composeDesktopCloudBins(cloud, files, { rowOf })
    await c.openBinFile('p1', 'f1', true)
    expect(files.calls.find(x => x[0] === 'open')[1]).toEqual({ location_id: 'L1', relative_path: 'A001/T1.mov', is_sequence: false, reveal: true })
    expect(await c.postBinFileThumbnail('p1', 'f1', '/9j/xyz')).toEqual({ ok: true, local: true })
    expect(files.calls.find(x => x[0] === 'postLocal')[1]).toMatchObject({ location_id: 'L1', relative_path: 'A001/T1.mov', base64: '/9j/xyz' })
    expect(cloud.calls.some(x => x[0] === 'postBinFileThumbnail')).toBe(false)
  })

  it('the upload is its own method: the cached bytes, through the cloud\'s own upload', async () => {
    const cloud = makeCloud(); const files = makeFiles()
    const c = composeDesktopCloudBins(cloud, files, { rowOf })
    const res = await c.uploadBinFilePoster('p1', 'f1')
    expect(res.poster_path).toBe('projects/p1/bin_files/f1/1-poster.jpg')
    expect(files.calls.find(x => x[0] === 'bytes')).toEqual(['bytes', 'L1', 'A001/T1.mov', { isSequence: false, mediaType: 'video' }])
    expect(cloud.calls.find(x => x[0] === 'postBinFileThumbnail')).toEqual(['postBinFileThumbnail', 'p1', 'f1', '/9j/AAA=', 'composite'])
  })

  it('copies and an undo\'s restore come back marked by what this computer can reach', async () => {
    const c = composeDesktopCloudBins(makeCloud(), makeFiles({ reachable: new Set(['c1']) }), { rowOf })
    expect((await c.copyBinFiles('p1', ['f1'], 'b2')).created.map(r => [r.id, r.online])).toEqual([['c1', true]])
    expect((await c.restoreBinFiles('p1', [{ ...ROWS[1] }])).restored.map(r => [r.id, r.online])).toEqual([['f2', false]])
  })
})

describe('relink: by location, per computer', () => {
  it('relinking by path is refused with the sentence; the roots scan has nothing to scan', async () => {
    const c = composeDesktopCloudBins(makeCloud(), makeFiles(), { rowOf })
    expect(await c.binRelinkScan('p1')).toEqual({ offline: [], candidates: null, truncated: false })
    const err = await c.binRelinkApply('p1', []).catch(e => e)
    expect(err.code).toBe('not_supported_here')
    expect(err.message).toContain(RELINK_BY_LOCATION_SENTENCE)
  })

  it('the per-computer folder is chosen through the desktop\'s dialog, by location', async () => {
    const files = makeFiles()
    const c = composeDesktopCloudBins(makeCloud(), files, { rowOf })
    await c.pickBinLocationLocalPath(LOCS[0])
    await c.forgetBinLocationLocalPath('L1')
    expect(files.calls.filter(x => x[0].endsWith('Local'))).toEqual([
      ['pickLocal', 'L1', { name: 'Footage NAS', unc_path: '\\\\nas\\footage' }],
      ['forgetLocal', 'L1'],
    ])
  })
})
