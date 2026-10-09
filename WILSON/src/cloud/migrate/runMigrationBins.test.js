// =============================================================================
// runMigrationBins.test.js — BC3 (Audrey's B9): a desktop project's bins move
// with it.
//
// Two desktop bundles stand in for hers: the dev fixtures' Salt Hours, turned
// back into the signed-out desktop's shape (absolute paths under one network
// share, known roots), and a bundle shaped like her real projects — nested
// bins, a frame sequence, takes on shots, clips on a drive letter and on a
// share, one root nobody names. What this pins:
//   * the dry run counts the bins' part, lists every root once with what the
//     answers make of it, asks the switch, and writes nothing;
//   * the real run carries scenes and shots (a take's shot must be there),
//     bins parents first, each clip under the location its root was named as
//     with its path inside it (ids kept), the takes whose shot and clip
//     landed, and the pictures only while the switch is on;
//   * a new location is made once and serves every clip under it; an
//     existing one is matched by address, never made twice;
//   * a root left unnamed leaves its clips on this computer, listed, never
//     dropped — and the desktop's bundle is never written;
//   * a second run skips what is there, and completes a picture the first
//     run could not;
//   * what cannot land is said: a take whose shot is missing, a clip whose
//     bin is missing, a picture the desktop cannot make.
// The Supabase client is a recorder; the desktop server is a fetch of three
// routes. Nothing here touches a network.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fake = vi.hoisted(() => {
  const state = { inserts: {}, updates: [], log: [], failWith: null, uploads: [], removed: [], lists: {}, listError: null, single: {}, singleError: null }
  const builder = (table) => {
    const q = { table, cols: null, filters: [] }
    const api = {
      select(cols) { q.cols = cols; return api },
      eq(col, value) { q.filters.push([col, value]); return api },
      maybeSingle: async () => {
        if (state.singleError) return { data: null, error: state.singleError }
        const by = q.filters.find(f => f[0] === 'id')
        return { data: state.single[table]?.[by?.[1]] ?? null, error: null }
      },
      // A list read: `await client.from(t).select(c).eq(k, v)`.
      then(resolve) {
        if (state.listError) return resolve({ data: null, error: state.listError })
        const rows = (state.lists[table] || []).filter(r => q.filters.every(([c, v]) => r[c] === v))
        return resolve({ data: rows.map(r => ({ ...r })), error: null })
      },
      insert: async (row) => {
        state.log.push(table)
        const override = state.failWith?.(table, row)
        if (override) return { error: override }
        // The database's own refusals: a primary key already there, and
        // (bin_locations) one share per company whatever its case.
        const have = state.lists[table] || []
        if (row?.id && have.some(r => r.id === row.id)) return { error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
        if (table === 'bin_locations' && have.some(r => String(r.unc_path).toLowerCase() === String(row.unc_path).toLowerCase())) return { error: { code: '23505', message: 'duplicate key value violates unique constraint "bin_locations_workspace_unc_key"' } }
        ;(state.inserts[table] ||= []).push(row)
        // The row is now "in the cloud" for later reads of this run.
        ;(state.lists[table] ||= []).push({ ...row })
        return { error: null }
      },
      update(patch) {
        const u = { table, patch, filters: [] }
        const chain = {
          eq(col, value) { u.filters.push([col, value]); return chain },
          then(resolve) {
            state.updates.push(u)
            for (const r of state.lists[table] || []) if (u.filters.every(([c, v]) => r[c] === v)) Object.assign(r, patch)
            return resolve({ error: null })
          },
        }
        return chain
      },
    }
    return api
  }
  const client = {
    from: (table) => builder(table),
    storage: {
      from() {
        return {
          list: async () => ({ data: [] }),
          upload: async (path, bytes) => {
            const override = state.failWith?.('storage', { path })
            if (override) return { error: override }
            state.uploads.push({ path, size: bytes?.length ?? 0 })
            return { error: null }
          },
          remove: async (keys) => { state.removed.push(...keys); return { error: null } },
        }
      },
    },
    rpc: async (fn, args) => (fn === 'rabbit_money_segment' ? { data: args?.seg === 'LEGAL', error: null } : { data: null, error: null }),
  }
  return { state, client }
})

vi.mock('../auth/supabaseClient', () => ({ supabase: fake.client }))

const { runMigration, BINS_LEFT_BEHIND, POSTERS_SWITCH_OFF } = await import('./runMigration')
const { pathKey } = await import('./binsMigration')
const { BINS, BIN_FILES, SHOT_TAKES, SCENES, SHOTS, BIN_LOCATIONS } = await import('../../dev/fixtures/data/scenes')
const { PROJECT } = await import('../../dev/fixtures/data/project')

const WS = 'ws1'
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])

// ── The fixtures' Salt Hours, as the signed-out desktop keeps it ─────────────
// The cloud rows (location + relative path) turned back into absolute paths
// under the share the fixtures name, with that share as the one known root.
const SHARE = BIN_LOCATIONS[0].unc_path // \\salthours-nas\footage
function fixturesBundle() {
  const pid = PROJECT.id
  const binFiles = BIN_FILES.map(({ __poster, location_id, relative_path, workspace_id, poster_path, online, ...f }) => ({
    ...f, source_path: `${SHARE}\\${relative_path.replace(/\//g, '\\')}`,
  }))
  return {
    project: { id: pid, title: PROJECT.title },
    phases: [], assets: [], tasks: [], files: [], dependencies: [],
    scenes: SCENES.map(({ workspace_id, ...s }) => s),
    shots: SHOTS.map(({ workspace_id, ...s }) => s),
    bins: BINS.map(({ workspace_id, ...b }) => b),
    binFiles,
    binRoots: [{ id: 'r1', project_id: pid, path: SHARE, label: 'footage' }],
    shotTakes: SHOT_TAKES.map(({ workspace_id, ...t }) => t),
  }
}

// ── A bundle shaped like her real desktop projects ──────────────────────────
// Nested bins (Footage / Day 01 / A001), a frame sequence (one row for its
// folder), takes on two shots, clips on a share AND on a drive letter, plus a
// root nobody names.
function realBundle() {
  const pid = 'p-real'
  return {
    project: { id: pid, title: 'Real' },
    phases: [], assets: [], tasks: [], files: [], dependencies: [],
    scenes: [{ id: 'sc1', project_id: pid, name: 'Lighthouse', scene_number: 1 }],
    shots: [
      { id: 'sh1', project_id: pid, scene_id: 'sc1', name: 'Wide', shot_number: 1 },
      { id: 'sh2', project_id: pid, scene_id: 'sc1', name: 'Close', shot_number: 2 },
    ],
    bins: [
      { id: 'b-day', project_id: pid, name: 'Day 01', kind: 'footage', parent_bin_id: 'b-footage', sort_order: 0 },
      { id: 'b-footage', project_id: pid, name: 'Footage', kind: 'footage', parent_bin_id: null, sort_order: 0 },
      { id: 'b-a001', project_id: pid, name: 'A001', kind: 'footage', parent_bin_id: 'b-day', sort_order: 0 },
      { id: 'b-vfx', project_id: pid, name: 'VFX plates', kind: 'vfx', parent_bin_id: null, sort_order: 1 },
      { id: 'b-stills', project_id: pid, name: 'Stills', kind: 'stills', parent_bin_id: null, sort_order: 2 },
    ],
    binFiles: [
      { id: 'c1', project_id: pid, bin_id: 'b-a001', source_path: '\\\\nas\\footage\\Day01\\A001\\A001_C001.mov', display_name: 'A001_C001', original_name: 'A001_C001.mov', extension: '.mov', media_type: 'video', review_flag: 'select', circled: true, scene_id: 'sc1', shot_id: 'sh1', shoot_day: '2026-09-24', sort_order: 0, online: true },
      { id: 'c2', project_id: pid, bin_id: 'b-a001', source_path: '\\\\nas\\footage\\Day01\\A001\\A001_C002.mov', display_name: 'A001_C002', original_name: 'A001_C002.mov', extension: '.mov', media_type: 'video', review_flag: 'reject', sort_order: 1, online: true },
      { id: 'seq', project_id: pid, bin_id: 'b-vfx', source_path: '\\\\nas\\footage\\VFX\\storm_plate_v01', display_name: 'storm_plate_v01', original_name: 'storm_plate_v01', extension: '.exr', media_type: 'sequence', is_sequence: true, sequence_pattern: 'storm_plate_v01.####.exr', frame_count: 240, sort_order: 0, online: true },
      { id: 'd1', project_id: pid, bin_id: 'b-stills', source_path: 'D:\\Dailies\\stills\\lamp_room.png', display_name: 'lamp_room', original_name: 'lamp_room.png', extension: '.png', media_type: 'still', sort_order: 0, online: true },
      { id: 'e1', project_id: pid, bin_id: 'b-stills', source_path: 'E:\\Scratch\\odd.wav', display_name: 'odd', original_name: 'odd.wav', extension: '.wav', media_type: 'audio', sort_order: 1, online: false },
    ],
    binRoots: [
      { id: 'r-a001', project_id: pid, path: '\\\\nas\\footage\\Day01\\A001', label: 'A001' },
      { id: 'r-vfx', project_id: pid, path: '\\\\nas\\footage\\VFX', label: 'VFX' },
      { id: 'r-d', project_id: pid, path: 'D:\\Dailies', label: 'Dailies' },
      { id: 'r-e', project_id: pid, path: 'E:\\Scratch', label: 'Scratch' },
    ],
    shotTakes: [
      { id: 't1', project_id: pid, shot_id: 'sh1', bin_file_id: 'c1', role: 'primary', position: 0, notes: '' },
      { id: 't2', project_id: pid, shot_id: 'sh1', bin_file_id: 'c2', role: 'alt', position: 1, notes: 'Keep for the trailer.' },
      { id: 't3', project_id: pid, shot_id: 'sh2', bin_file_id: 'seq', role: 'primary', position: 0, notes: '' },
    ],
  }
}

// The share for the two network roots (the company's "Footage NAS" where a
// test seeds it, a new location where none does); the drive letter named as
// a second share, new; the scratch drive left for now.
const REAL_ANSWERS = {
  [pathKey('\\\\nas\\footage\\Day01\\A001')]: { unc_path: '\\\\nas\\footage' },
  [pathKey('\\\\nas\\footage\\VFX')]: { unc_path: '\\\\nas\\footage' },
  [pathKey('D:\\Dailies')]: { unc_path: '\\\\nas\\dailies', name: 'Dailies on the NAS' },
  [pathKey('E:\\Scratch')]: { skip: true },
}
const seedNas = () => { fake.state.lists.bin_locations = [{ id: 'L1', workspace_id: WS, name: 'Footage NAS', unc_path: '\\\\nas\\footage' }] }

let served
let posterStatus
let bundleWrites
function serve(bundles) {
  served = bundles
  globalThis.fetch = vi.fn(async (url, init) => {
    if (init?.method && init.method !== 'GET') { bundleWrites.push(url); return { ok: false, status: 405 } }
    if (url === '/api/rabbit/projects') return { ok: true, json: async () => served.map(b => ({ id: b.project.id, title: b.project.title })) }
    const m = /^\/api\/rabbit\/projects\/([^/]+)$/.exec(url)
    if (m) { const b = served.find(x => x.project.id === m[1]); return b ? { ok: true, json: async () => JSON.parse(JSON.stringify(b)) } : { ok: false, status: 404 } }
    const t = /^\/api\/rabbit\/projects\/([^/]+)\/bin-files\/([^/]+)\/thumbnail$/.exec(url)
    if (t) {
      const status = posterStatus[t[2]] ?? 200
      return status === 200 ? { ok: true, status, arrayBuffer: async () => JPEG.buffer.slice(0) } : { ok: false, status }
    }
    return { ok: false, status: 404 }
  })
}

beforeEach(() => {
  Object.assign(fake.state, { inserts: {}, updates: [], log: [], failWith: null, uploads: [], removed: [], lists: {}, listError: null, single: {}, singleError: null })
  fake.state.single.workspaces = { [WS]: { remote_viewing_enabled: false } }
  posterStatus = {}
  bundleWrites = []
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks() })

const ins = (t) => fake.state.inserts[t] || []
const byId = (t, id) => ins(t).find(r => r.id === id)

describe('the dry run: counted, asked, nothing written', () => {
  it('counts scenes, shots, bins, clips and takes; lists every root once with what the answers make of it; asks the switch; writes nothing', async () => {
    serve([realBundle()])
    const lines = []
    const report = await runMigration({ workspaceId: WS, dryRun: true, onProgress: (m) => lines.push(m) })
    expect(fake.state.log).toEqual([])
    expect(fake.state.uploads).toEqual([])
    expect(report).toMatchObject({ scenes: { total: 1 }, shots: { total: 2 }, bins: { total: 5 }, binFiles: { total: 5 }, shotTakes: { total: 3 } })
    // No answer given: the runner names nothing on its own (the panel
    // suggests; the person answers), and every root is a question.
    expect(report.footageRoots.map(r => [r.root, r.kind, r.count, r.resolved])).toEqual([
      ['\\\\nas\\footage\\Day01\\A001', 'unc', 2, 'unanswered'],
      ['\\\\nas\\footage\\VFX', 'unc', 1, 'unanswered'],
      ['D:\\Dailies', 'local', 1, 'unanswered'],
      ['E:\\Scratch', 'local', 1, 'unanswered'],
    ])
    expect(lines).toContain('  5 bins, 5 clips in 4 footage roots, 3 takes')
    expect(lines).toContain('    \\\\nas\\footage\\Day01\\A001: 2 clips — which footage location is this? (not named yet)')
    // Nothing named yet: every clip would stay, and the report lists them.
    expect(report.binFiles.leftBehind).toBe(5)
    expect(report.clipsLeftBehind.map(c => c.id).sort()).toEqual(['c1', 'c2', 'd1', 'e1', 'seq'])
    // The switch, asked once, off: the pictures stay, said.
    expect(report.posters).toMatchObject({ total: 4, switchOff: 4 })
    expect(report.remoteViewing).toBe(false)
    expect(lines.some(l => l.includes(POSTERS_SWITCH_OFF))).toBe(true)
  })

  it('with answers given, the dry run says where each root will go; an existing location is matched by address (any case); a root left for now is said', async () => {
    serve([realBundle()])
    fake.state.lists.bin_locations = [{ id: 'L1', workspace_id: WS, name: 'Footage NAS', unc_path: '\\\\NAS\\Footage' }]
    const lines = []
    const report = await runMigration({ workspaceId: WS, dryRun: true, onProgress: (m) => lines.push(m), locations: REAL_ANSWERS })
    expect(report.footageRoots.map(r => r.resolved)).toEqual(['existing', 'existing', 'new', 'skip'])
    expect(lines).toContain('    \\\\nas\\footage\\Day01\\A001: 2 clips — the company\'s "Footage NAS"')
    expect(lines).toContain('    D:\\Dailies: 1 clip — a new location "Dailies on the NAS" (\\\\nas\\dailies)')
    expect(lines).toContain('    E:\\Scratch: 1 clip — left on this computer (not named)')
    expect(report.binFiles.leftBehind).toBe(1)
    expect(report.footageLocations).toEqual([{ id: 'L1', name: 'Footage NAS', unc_path: '\\\\NAS\\Footage' }])
    expect(fake.state.log).toEqual([])
  })

  it('an address inside a company location IS that location (Tesler: the system matches; nobody makes a second share)', async () => {
    serve([realBundle()])
    seedNas()
    const report = await runMigration({ workspaceId: WS, dryRun: true, locations: { ...REAL_ANSWERS, [pathKey('D:\\Dailies')]: { unc_path: '\\\\nas\\footage\\dailies' } } })
    expect(report.footageRoots.find(r => r.root === 'D:\\Dailies').resolved).toBe('existing')
  })
})

describe('the real run on a bundle shaped like her projects', () => {
  it('carries scenes and shots, the bins parents first, each clip under its location with its path inside, the takes, and lists the root left behind', async () => {
    serve([realBundle()])
    seedNas()
    const lines = []
    const report = await runMigration({ workspaceId: WS, onProgress: (m) => lines.push(m), locations: REAL_ANSWERS })
    // Scenes and shots, with the project.
    expect(ins('scenes').map(s => s.id)).toEqual(['sc1'])
    expect(ins('shots').map(s => s.id)).toEqual(['sh1', 'sh2'])
    expect(report.scenes).toEqual({ total: 1, inserted: 1, skipped: 0, failed: 0 })
    // Bins: parents before children, the workspace set, ids kept.
    const binOrder = ins('bins').map(b => b.id)
    expect(binOrder.indexOf('b-footage')).toBeLessThan(binOrder.indexOf('b-day'))
    expect(binOrder.indexOf('b-day')).toBeLessThan(binOrder.indexOf('b-a001'))
    expect(ins('bins').every(b => b.workspace_id === WS && b.project_id === 'p-real')).toBe(true)
    // The new location, made once; the existing one matched, never made.
    expect(ins('bin_locations')).toHaveLength(1)
    expect(ins('bin_locations')[0]).toMatchObject({ workspace_id: WS, name: 'Dailies on the NAS', unc_path: '\\\\nas\\dailies' })
    expect(report.binLocations).toEqual({ total: 1, inserted: 1, skipped: 0, failed: 0 })
    // Each clip: its id, its location, its path inside it; nothing of the desktop's.
    const c1 = byId('bin_files', 'c1')
    expect(c1).toMatchObject({ id: 'c1', bin_id: 'b-a001', location_id: 'L1', relative_path: 'Day01/A001/A001_C001.mov', workspace_id: WS, review_flag: 'select', circled: true, scene_id: 'sc1', shot_id: 'sh1', shoot_day: '2026-09-24', poster_path: null })
    expect(c1).not.toHaveProperty('source_path')
    expect(c1).not.toHaveProperty('online')
    expect(byId('bin_files', 'seq')).toMatchObject({ location_id: 'L1', relative_path: 'VFX/storm_plate_v01', is_sequence: true, frame_count: 240 })
    expect(byId('bin_files', 'd1')).toMatchObject({ location_id: ins('bin_locations')[0].id, relative_path: 'stills/lamp_room.png' })
    expect(byId('bin_files', 'e1')).toBeUndefined()
    expect(report.binFiles).toEqual({ total: 4, inserted: 4, skipped: 0, failed: 0, leftBehind: 1 })
    expect(report.clipsLeftBehind).toEqual([{ projectId: 'p-real', id: 'e1', name: 'odd', root: 'E:\\Scratch' }])
    expect(lines.some(l => l.includes(BINS_LEFT_BEHIND(1)))).toBe(true)
    // The takes, every one (their shots and clips landed), ids kept.
    expect(ins('shot_takes').map(t => t.id)).toEqual(['t1', 't2', 't3'])
    expect(ins('shot_takes')[1]).toMatchObject({ shot_id: 'sh1', bin_file_id: 'c2', role: 'alt', position: 1, notes: 'Keep for the trailer.', workspace_id: WS })
    expect(report.shotTakes).toEqual({ total: 3, inserted: 3, skipped: 0, failed: 0 })
    // The switch off: no picture moved (the two clips, the sequence and the
    // still have one to send; the audio has none), said once.
    expect(fake.state.uploads).toEqual([])
    expect(report.posters).toMatchObject({ total: 4, uploaded: 0, switchOff: 4 })
    // The desktop's bundle was never written.
    expect(bundleWrites).toEqual([])
    // Nothing failed; the left-behind clip is not an error (it is listed).
    expect(report.errors).toEqual([])
  })

  it('writes the tables in an order every foreign key allows: scenes, shots, bins, locations, clips, takes', async () => {
    serve([realBundle()])
    seedNas()
    await runMigration({ workspaceId: WS, locations: REAL_ANSWERS })
    const log = fake.state.log
    const first = (t) => log.indexOf(t); const last = (t) => log.lastIndexOf(t)
    expect(first('shots')).toBeGreaterThan(last('scenes'))
    expect(first('bin_files')).toBeGreaterThan(last('bins'))
    expect(first('bin_files')).toBeGreaterThan(last('shots'))
    expect(first('bin_locations')).toBeLessThan(last('bin_files'))
    expect(first('shot_takes')).toBeGreaterThan(last('bin_files'))
  })

  it('switch on: every picture the desktop can make is uploaded under the clip\'s own key and the row learns it; one it cannot make is said', async () => {
    serve([realBundle()])
    seedNas()
    fake.state.single.workspaces[WS].remote_viewing_enabled = true
    posterStatus.seq = 410
    const report = await runMigration({ workspaceId: WS, locations: REAL_ANSWERS })
    expect(fake.state.uploads.map(u => u.path)).toEqual([
      expect.stringMatching(/^projects\/p-real\/bin_files\/c1\/\d+-poster\.jpg$/),
      expect.stringMatching(/^projects\/p-real\/bin_files\/c2\/\d+-poster\.jpg$/),
      expect.stringMatching(/^projects\/p-real\/bin_files\/d1\/\d+-poster\.jpg$/),
    ])
    const patched = fake.state.updates.filter(u => u.table === 'bin_files')
    expect(patched.map(u => u.filters)).toEqual([[['id', 'c1'], ['project_id', 'p-real']], [['id', 'c2'], ['project_id', 'p-real']], [['id', 'd1'], ['project_id', 'p-real']]])
    expect(patched.every(u => /-poster\.jpg$/.test(u.patch.poster_path))).toBe(true)
    expect(report.posters).toEqual({ total: 4, uploaded: 3, skipped: 0, failed: 1, switchOff: 0 })
    expect(report.errors).toEqual([expect.objectContaining({ scope: 'poster', id: 'seq', message: 'storm_plate_v01: no picture on this computer (HTTP 410)' })])
  })

  it('a second run skips every row that is there, makes no second location, and completes a picture the first run could not', async () => {
    serve([realBundle()])
    seedNas()
    fake.state.single.workspaces[WS].remote_viewing_enabled = true
    posterStatus.seq = 410
    await runMigration({ workspaceId: WS, locations: REAL_ANSWERS })
    const firstUploads = fake.state.uploads.length
    // The desktop made the sequence's picture meanwhile.
    posterStatus = {}
    const again = await runMigration({ workspaceId: WS, locations: REAL_ANSWERS })
    expect(again.bins).toEqual({ total: 5, inserted: 0, skipped: 5, failed: 0 })
    expect(again.binFiles).toEqual({ total: 4, inserted: 0, skipped: 4, failed: 0, leftBehind: 1 })
    expect(again.shotTakes).toEqual({ total: 3, inserted: 0, skipped: 3, failed: 0 })
    // The location the first run made is the company's now: matched by
    // address, nothing to make, nothing to skip.
    expect(again.binLocations).toEqual({ total: 0, inserted: 0, skipped: 0, failed: 0 })
    expect(again.footageRoots.find(r => r.root === 'D:\\Dailies').resolved).toBe('existing')
    expect(ins('bin_locations')).toHaveLength(1)
    expect(fake.state.uploads).toHaveLength(firstUploads + 1)
    expect(fake.state.uploads.at(-1).path).toMatch(/\/bin_files\/seq\//)
    expect(again.posters).toEqual({ total: 4, uploaded: 1, skipped: 3, failed: 0, switchOff: 0 })
    expect(again.errors).toEqual([])
  })

  it('what cannot land is said: a take whose shot is missing, a clip whose bin is missing, a bin whose parent was refused', async () => {
    serve([realBundle()])
    seedNas()
    fake.state.failWith = (table, row) => (table === 'shots' && row.id === 'sh2') || (table === 'bins' && row.id === 'b-vfx') ? { code: '23514', message: 'refused' } : null
    const report = await runMigration({ workspaceId: WS, locations: REAL_ANSWERS })
    expect(report.shots).toMatchObject({ failed: 1 })
    expect(report.bins).toMatchObject({ failed: 1 })
    // The sequence's bin was refused, so the sequence cannot land; its take neither.
    expect(byId('bin_files', 'seq')).toBeUndefined()
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'bin_file', id: 'seq', message: expect.stringMatching(/its bin \(b-vfx\) is not in the cloud/) }),
      expect.objectContaining({ scope: 'shot_take', id: 't3', message: 'take not migrated: its shot is not in the cloud' }),
    ]))
    expect(ins('shot_takes').map(t => t.id)).toEqual(['t1', 't2'])
    expect(report.shotTakes).toEqual({ total: 3, inserted: 2, skipped: 0, failed: 1 })
  })

  it('a clip logged to a shot that did not land keeps its row, its link let go and said', async () => {
    serve([realBundle()])
    seedNas()
    fake.state.failWith = (table, row) => (table === 'shots' && row.id === 'sh1') ? { code: '23514', message: 'refused' } : null
    const report = await runMigration({ workspaceId: WS, locations: REAL_ANSWERS })
    expect(byId('bin_files', 'c1')).toMatchObject({ scene_id: 'sc1', shot_id: null })
    expect(report.errors).toEqual(expect.arrayContaining([expect.objectContaining({ scope: 'bin_file', id: 'c1', message: expect.stringMatching(/its shot is not in the cloud/) })]))
  })

  it('a location named by a teammate meanwhile (the insert meets 23505) is read back by address, not made twice', async () => {
    serve([realBundle()])
    seedNas()
    fake.state.failWith = (table) => {
      if (table !== 'bin_locations') return null
      // Between the run's read and its insert, a teammate named the same share.
      fake.state.lists.bin_locations.push({ id: 'L-theirs', workspace_id: WS, name: 'Theirs', unc_path: '\\\\NAS\\Dailies' })
      return { code: '23505', message: 'duplicate' }
    }
    const report = await runMigration({ workspaceId: WS, locations: REAL_ANSWERS })
    expect(byId('bin_files', 'd1').location_id).toBe('L-theirs')
    expect(report.binLocations).toEqual({ total: 1, inserted: 0, skipped: 1, failed: 0 })
    expect(report.errors).toEqual([])
  })

  it('the switch unreadable: no picture leaves (fail closed), and the report says the read failed', async () => {
    serve([realBundle()])
    seedNas()
    fake.state.singleError = { message: 'boom' }
    const report = await runMigration({ workspaceId: WS, locations: REAL_ANSWERS })
    expect(fake.state.uploads).toEqual([])
    expect(report.errors.some(e => e.scope === 'posters' && /could not read the company's remote-viewing switch/.test(e.message))).toBe(true)
  })
})

describe('the real run on the fixtures\' Salt Hours, as the desktop keeps it', () => {
  it('every bin, clip and take arrives with its id, the clips under the one named location at the paths the fixtures use', async () => {
    serve([fixturesBundle()])
    const key = pathKey(SHARE)
    const report = await runMigration({ workspaceId: WS, locations: { [key]: { unc_path: SHARE, name: 'Footage NAS' } } })
    expect(report.errors).toEqual([])
    expect(ins('bin_locations')).toEqual([expect.objectContaining({ name: 'Footage NAS', unc_path: SHARE })])
    expect(report.bins.inserted).toBe(BINS.length)
    expect(report.binFiles).toMatchObject({ inserted: BIN_FILES.length, leftBehind: 0 })
    expect(report.shotTakes.inserted).toBe(SHOT_TAKES.length)
    for (const f of BIN_FILES) {
      const row = byId('bin_files', f.id)
      expect(row, f.id).toBeTruthy()
      expect(row.relative_path).toBe(f.relative_path)
      expect(row.bin_id).toBe(f.bin_id)
    }
    expect(ins('scenes').map(s => s.id).sort()).toEqual(SCENES.map(s => s.id).sort())
    expect(ins('shots').map(s => s.id).sort()).toEqual(SHOTS.map(s => s.id).sort())
  })

  it('run twice: the second changes nothing', async () => {
    serve([fixturesBundle()])
    const key = pathKey(SHARE)
    const locations = { [key]: { unc_path: SHARE, name: 'Footage NAS' } }
    await runMigration({ workspaceId: WS, locations })
    const before = JSON.stringify(fake.state.inserts)
    const again = await runMigration({ workspaceId: WS, locations })
    expect(JSON.stringify(fake.state.inserts)).toBe(before)
    expect(again.bins.inserted + again.binFiles.inserted + again.shotTakes.inserted + again.binLocations.inserted + again.scenes.inserted + again.shots.inserted).toBe(0)
    expect(again.binFiles.skipped).toBe(BIN_FILES.length)
    expect(again.errors).toEqual([])
  })
})

describe('a project with no bins is as it was', () => {
  it('no bins, no clips: nothing of the bins\' part is read or written, no root is asked about', async () => {
    serve([{ project: { id: 'p0', title: 'Bare' }, phases: [], assets: [], tasks: [], files: [], dependencies: [] }])
    const report = await runMigration({ workspaceId: WS })
    expect(report.footageRoots).toEqual([])
    expect(report.binFiles.total).toBe(0)
    expect(fake.state.log).toEqual(['projects'])
    expect(report.errors).toEqual([])
  })
})
