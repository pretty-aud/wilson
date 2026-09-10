// =============================================================================
// rabbitBins.routes.test.js — every local bins route probed (demo 2026-09-11).
//
// A real Express app on an ephemeral port, the real electron/rabbitBins.cjs,
// and a fake bundle store with DISK semantics (read = parse a copy, write =
// store), so a route that mutates without writing is caught, exactly as it
// would be on the desktop. Real files in a temp folder: a PNG made by sharp,
// a numbered PNG sequence, and bytes standing in for a video and a WAV.
// ffmpeg may or may not be present (resolveFfmpegPath looks only in
// resources/ffmpeg/, gitignored); either way the ffmpeg arms answer NAMED states.
//
// Each route gets a happy path, a refusal and a missing-file case where those
// exist (DEMO_BINS_BRIEF.md §4.4).
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'

const require = createRequire(import.meta.url)
const { mountRabbitBins } = require('../../../../electron/rabbitBins.cjs')
// resources/ffmpeg/ffmpeg.exe is gitignored: absent on CI and in a fresh
// worktree, present on a machine set up for the desktop app. Both states are
// legitimate and both are asserted — the NAMED state differs, not the shape.
const FFMPEG = require('../../../../electron/ffmpeg.cjs').hasFfmpeg()

// ── the fakes ────────────────────────────────────────────────────────────────
const store = new Map()
const readRabbitBundle = (id) => (store.has(id) ? JSON.parse(store.get(id)) : null)
const writeRabbitBundle = (id, bundle) => { store.set(id, JSON.stringify(bundle)) }
const { randomUUID } = require('node:crypto')
function rabbitTouch(row) {
  const now = new Date().toISOString()
  if (!row.id) row.id = randomUUID()
  if (!row.created_at) row.created_at = now
  row.updated_at = now
  return row
}
function rabbitUpsertInto(arr, row) {
  const idx = arr.findIndex(x => x.id === row.id)
  if (idx >= 0) { arr[idx] = { ...arr[idx], ...row }; return arr[idx] }
  arr.push(row); return row
}
function rabbitRemoveFrom(arr, id) {
  const idx = arr.findIndex(x => x.id === id)
  if (idx < 0) return false
  arr.splice(idx, 1); return true
}
function rabbitNotFound(res, what = 'project') { return res.status(404).json({ error: `${what} not found` }) }
const SAFE_MEDIA_TYPE_RE = /^(video|audio|image)\/[a-z0-9][a-z0-9.+-]*$/
function safeMediaContentType(mime) {
  const m = String(mime || '').trim().toLowerCase()
  if (m === 'image/svg+xml') return 'application/octet-stream'
  return SAFE_MEDIA_TYPE_RE.test(m) ? m : 'application/octet-stream'
}

let root, thumbDir, server, base, PID
const userAuthorizedDirs = new Set()
let nextDialog = { canceled: true, filePaths: [] }
const dialog = { showOpenDialog: async () => nextDialog }

const J = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const PATCH = (body) => ({ method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
// `api` sends what the renderer sends (Sec-Fetch-Site: same-origin); `raw`
// sends exactly the headers given, for the gate's own tests.
const raw = (p, init) => fetch(`${base}/api/rabbit/projects/${PID}${p}`, init)
const api = (p, init = {}) => raw(p, { ...init, headers: { 'sec-fetch-site': 'same-origin', ...(init.headers || {}) } })

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wilson-bins-routes-'))
  thumbDir = path.join(root, 'thumbs'); fs.mkdirSync(thumbDir)
  const media = path.join(root, 'media'); fs.mkdirSync(media)
  const sharp = require('sharp')
  await sharp({ create: { width: 64, height: 32, channels: 3, background: '#ea580c' } }).png().toFile(path.join(media, 'still.png'))
  fs.writeFileSync(path.join(media, 'clip.mp4'), Buffer.alloc(2048, 7))
  fs.writeFileSync(path.join(media, 'tone.wav'), Buffer.alloc(512, 1))
  fs.writeFileSync(path.join(media, 'notes.pdf'), Buffer.alloc(128, 2))
  const day = path.join(media, 'Day01'); fs.mkdirSync(day)
  fs.writeFileSync(path.join(day, 'A001C001_240612_R1AB.mov'), Buffer.alloc(4096, 3))
  fs.writeFileSync(path.join(day, '12A_3_T4_A.mov'), Buffer.alloc(4096, 4))
  const sub = path.join(day, 'stills'); fs.mkdirSync(sub)
  await sharp({ create: { width: 16, height: 16, channels: 3, background: '#000' } }).png().toFile(path.join(sub, 'ref.png'))
  const seq = path.join(day, 'plate_seq'); fs.mkdirSync(seq)
  for (let i = 1; i <= 5; i++) {
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toFile(path.join(seq, `plate.${String(i).padStart(4, '0')}.png`))
  }

  PID = 'proj-1'
  store.set(PID, JSON.stringify({ project: { id: PID, title: 'Bins Test', fps: 25 }, scenes: [], shots: [] }))

  const app = express()
  app.use(express.json({ limit: '5mb' }))
  mountRabbitBins(app, {
    readRabbitBundle, writeRabbitBundle, rabbitTouch, rabbitUpsertInto, rabbitRemoveFrom, rabbitNotFound,
    getThumbCacheDir: () => thumbDir,
    generateVideoThumbOnce: async () => ({ ok: false, reason: 'ffmpeg_missing' }),
    safeMediaContentType,
    userAuthorizedDirs, dialog, getMainWindow: () => ({}),
  })
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve) })
  base = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  await new Promise(resolve => server.close(resolve))
  try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* temp */ }
})

const media = () => path.join(root, 'media')

// ── the gate ─────────────────────────────────────────────────────────────────
describe('same-origin gate', () => {
  it('a cross-site browser request is refused with a named code, on both prefixes', async () => {
    const r = await raw('/bins', { headers: { 'sec-fetch-site': 'cross-site' } })
    expect(r.status).toBe(403)
    expect((await r.json()).code).toBe('cross_origin')
    expect((await raw('/bin-files/x/stream', { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403)
    expect((await raw('/bin-files/x/thumbnail', { headers: { 'sec-fetch-site': 'same-site' } })).status).toBe(403)
    expect((await raw('/bins', { headers: { 'sec-fetch-site': 'none' } })).status).toBe(403)
  })
  it('an Origin that is not the server is refused', async () => {
    const r = await raw('/bins', { headers: { origin: 'http://evil.localhost:1' } })
    expect(r.status).toBe(403)
  })
  it('a request with neither header is refused too (adversarial review: a local process is not the user)', async () => {
    expect((await raw('/bins')).status).toBe(403)
    expect((await raw('/bins/prepare', J({ paths: ['C:\\Users'] }))).status).toBe(403)
    expect((await raw('/bin-files/x/stream')).status).toBe(403)
  })
  it('the renderer passes, by Sec-Fetch-Site or by its own Origin', async () => {
    expect((await raw('/bins', { headers: { 'sec-fetch-site': 'same-origin' } })).status).toBe(200)
    expect((await raw('/bins', { headers: { origin: base } })).status).toBe(200)
  })
  it('an unknown project is a 404 JSON body', async () => {
    const r = await fetch(`${base}/api/rabbit/projects/nope/bins`, { headers: { 'sec-fetch-site': 'same-origin' } })
    expect(r.status).toBe(404)
    expect((await r.json()).error).toMatch(/not found/)
  })
})

// ── bins ─────────────────────────────────────────────────────────────────────
let dailies, sceneBin, childBin
describe('bins', () => {
  it('lists empty arrays for a project with no bins', async () => {
    const body = await (await api('/bins')).json()
    expect(body).toMatchObject({ bins: [], binFiles: [], binRoots: [] })
    expect(typeof body.ffmpeg).toBe('boolean')
  })
  it('creates bins with a kind, a colour and sibling order', async () => {
    dailies = await (await api('/bins', J({ name: 'Dailies', kind: 'footage', color: 'orange' }))).json()
    sceneBin = await (await api('/bins', J({ name: 'Scene 12', kind: 'selects' }))).json()
    expect(dailies).toMatchObject({ name: 'Dailies', kind: 'footage', color: 'orange', parent_bin_id: null, sort_order: 0 })
    expect(sceneBin.sort_order).toBe(1)
  })
  it('refuses a nameless bin, an unknown colour and a missing parent', async () => {
    expect((await api('/bins', J({ name: '  ' }))).status).toBe(400)
    expect((await api(`/bins/${dailies.id}`, PATCH({ color: 'taupe' }))).status).toBe(400)
    expect((await api('/bins', J({ name: 'x', parent_bin_id: 'ghost' }))).status).toBe(400)
  })
  it('nests a child and refuses a cycle', async () => {
    childBin = await (await api('/bins', J({ name: 'Day 1', parent_bin_id: dailies.id }))).json()
    expect(childBin.parent_bin_id).toBe(dailies.id)
    const r = await api(`/bins/${dailies.id}`, PATCH({ parent_bin_id: childBin.id }))
    expect(r.status).toBe(400)
    expect((await r.json()).error).toMatch(/inside itself/)
    const self = await api(`/bins/${dailies.id}`, PATCH({ parent_bin_id: dailies.id }))
    expect(self.status).toBe(400)
  })
  it('renames and re-kinds through PATCH; unknown ids are 404', async () => {
    const r = await (await api(`/bins/${childBin.id}`, PATCH({ name: 'Day 01', kind: 'footage', description: 'first shoot day' }))).json()
    expect(r).toMatchObject({ name: 'Day 01', kind: 'footage', description: 'first shoot day' })
    expect((await api('/bins/ghost', PATCH({ name: 'x' }))).status).toBe(404)
  })
  it('reorders and re-parents in one call, and rolls back a cycle', async () => {
    const ok = await api('/bins/reorder', J({ order: [{ id: sceneBin.id, parent_bin_id: null, sort_order: 0 }, { id: dailies.id, parent_bin_id: null, sort_order: 1 }] }))
    expect(ok.status).toBe(200)
    const bins = (await (await api('/bins')).json()).bins
    expect(bins.find(b => b.id === sceneBin.id).sort_order).toBe(0)
    const bad = await api('/bins/reorder', J({ order: [{ id: dailies.id, parent_bin_id: childBin.id, sort_order: 0 }] }))
    expect(bad.status).toBe(400)
    const after = (await (await api('/bins')).json()).bins
    expect(after.find(b => b.id === dailies.id).parent_bin_id).toBeNull()
  })
})

// ── picking, prepare, add ───────────────────────────────────────────────────
let added
describe('pick, prepare, add', () => {
  it('pick-files opens the dialog in the main process and authorises the folders', async () => {
    nextDialog = { canceled: false, filePaths: [path.join(media(), 'still.png')] }
    const r = await (await api('/bins/pick-files', J({}))).json()
    expect(r.paths).toEqual([path.join(media(), 'still.png')])
    expect(userAuthorizedDirs.size).toBeGreaterThan(0)
    nextDialog = { canceled: true, filePaths: [] }
    expect(await (await api('/bins/pick-folder', J({}))).json()).toMatchObject({ path: null, canceled: true })
  })
  it('prepare describes files, folders, sub-bins and a sequence, and flags a missing path', async () => {
    const r = await api('/bins/prepare', J({ paths: [path.join(media(), 'still.png'), path.join(media(), 'clip.mp4'), path.join(media(), 'Day01'), path.join(media(), 'ghost.mov')] }))
    expect(r.status).toBe(200)
    const plan = await r.json()
    const byName = Object.fromEntries(plan.items.map(i => [i.original_name, i]))
    expect(byName['still.png']).toMatchObject({ kind: 'file', media_type: 'still', status: 'ok', duplicate: null, sub_bin: null })
    expect(byName['clip.mp4']).toMatchObject({ media_type: 'video', mime_type: 'video/mp4', size_bytes: 2048 })
    expect(byName['12A_3_T4_A.mov'].suggestions).toMatchObject({ slate: '12A', take_number: 4, camera: 'A' })
    expect(byName['A001C001_240612_R1AB.mov'].suggestions).toMatchObject({ camera: 'A', roll: 'A001', shoot_day: '2024-06-12' })
    expect(byName['ref.png'].sub_bin).toBe('Day01/stills')
    expect(byName['12A_3_T4_A.mov'].sub_bin).toBe('Day01')
    expect(byName['plate_seq'].sub_bin).toBe('Day01')
    expect(byName['plate_seq']).toMatchObject({ kind: 'sequence', media_type: 'sequence', sequence: { pattern: 'plate.####.png', frame_count: 5 } })
    expect(byName['ghost.mov'].status).toBe('missing')
    expect(plan.folders).toEqual([{ path: path.join(media(), 'Day01'), name: 'Day01', sub_bin: 'Day01' }])
    const flat = await (await api('/bins/prepare', J({ paths: [path.join(media(), 'Day01')], folderAsBin: false }))).json()
    expect(flat.items.find(i => i.original_name === 'ref.png').sub_bin).toBe('stills')
    expect(flat.items.find(i => i.original_name === '12A_3_T4_A.mov').sub_bin).toBeNull()
    expect(plan.truncated).toBe(false)
  })
  it('prepare refuses relative paths and empty input', async () => {
    expect((await api('/bins/prepare', J({ paths: ['relative/clip.mp4'] }))).status).toBe(400)
    expect((await api('/bins/prepare', J({}))).status).toBe(400)
  })
  it('add creates rows, makes sub-bins from folders, reports per file, remembers roots', async () => {
    const plan = await (await api('/bins/prepare', J({ paths: [path.join(media(), 'still.png'), path.join(media(), 'clip.mp4'), path.join(media(), 'tone.wav'), path.join(media(), 'notes.pdf'), path.join(media(), 'Day01'), path.join(media(), 'ghost.mov')] }))).json()
    const items = plan.items.map(i => ({ ...i, ...(i.original_name === '12A_3_T4_A.mov' ? { ...i.suggestions, display_name: 'Sc 12A T4', tags: ['hero'] } : {}) }))
    const r = await api(`/bins/${dailies.id}/files`, J({ items }))
    expect(r.status).toBe(200)
    added = await r.json()
    expect(added.results.filter(x => x.status === 'added').length).toBe(8)
    expect(added.results.find(x => x.source_path.endsWith('ghost.mov')).status).toBe('missing')
    const hero = added.created.find(f => f.original_name === '12A_3_T4_A.mov')
    expect(hero).toMatchObject({ display_name: 'Sc 12A T4', slate: '12A', take_number: 4, camera: 'A', tags: ['hero'], review_flag: 'unflagged', circled: false, probe_status: 'pending', online: true, media_type: 'video' })
    const ref = added.created.find(f => f.original_name === 'ref.png')
    // The dropped folder itself becomes a nested bin, its subfolder inside it.
    expect(added.bins.map(b => b.name)).toEqual(['Day01', 'stills'])
    const dayBin = added.bins[0]; const stillsBin = added.bins[1]
    expect(dayBin.parent_bin_id).toBe(dailies.id)
    expect(stillsBin.parent_bin_id).toBe(dayBin.id)
    expect(ref.bin_id).toBe(stillsBin.id)
    expect(hero.bin_id).toBe(dayBin.id)
    const seq = added.created.find(f => f.is_sequence)
    expect(seq).toMatchObject({ media_type: 'sequence', frame_count: 5, sequence_pattern: 'plate.####.png', bin_id: dayBin.id })
    const roots = (await (await api('/bins')).json()).binRoots
    expect(roots.length).toBeGreaterThan(0)
    expect(roots.some(x => path.resolve(x.path) === path.resolve(media()))).toBe(true)
  })
  it('prepare flags a duplicate by path and by name+size, and add still accepts it (Q9: skip or add anyway)', async () => {
    const twin = path.join(media(), 'twin'); fs.mkdirSync(twin, { recursive: true })
    fs.copyFileSync(path.join(media(), 'clip.mp4'), path.join(twin, 'clip.mp4'))
    const plan = await (await api('/bins/prepare', J({ paths: [path.join(media(), 'clip.mp4'), path.join(twin, 'clip.mp4')] }))).json()
    const byPath = plan.items.find(i => i.source_path === path.join(media(), 'clip.mp4'))
    const byName = plan.items.find(i => i.source_path === path.join(twin, 'clip.mp4'))
    expect(byPath.duplicate).toMatchObject({ reason: 'same_path', existing_bin_name: 'Dailies' })
    expect(byName.duplicate).toMatchObject({ reason: 'same_name_size' })
    const r = await (await api(`/bins/${dailies.id}/files`, J({ items: [byPath] }))).json()
    expect(r.results[0].status).toBe('added')
    expect(r.created[0].source_path).toBe(byPath.source_path)
    await api('/bin-files/remove', J({ ids: [r.created[0].id] }))
  })
  it('roots are recorded in the bundle only, never in the process-wide authorised set', async () => {
    const before = userAuthorizedDirs.size
    // A folder OUTSIDE every recorded root (twin sits under media, which the
    // add already recorded, so it would be covered and not re-recorded).
    const elsewhere = path.join(root, 'elsewhere'); fs.mkdirSync(elsewhere, { recursive: true })
    const r = await (await api('/bins/roots', J({ path: elsewhere }))).json()
    expect(r.binRoots.some(x => path.resolve(x.path) === path.resolve(elsewhere))).toBe(true)
    expect(userAuthorizedDirs.size).toBe(before)
  })
  it('add refuses an unknown bin and an empty batch', async () => {
    expect((await api('/bins/ghost/files', J({ items: [{ source_path: path.join(media(), 'still.png') }] }))).status).toBe(404)
    expect((await api(`/bins/${dailies.id}/files`, J({ items: [] }))).status).toBe(400)
  })
})

// ── edits ────────────────────────────────────────────────────────────────────
describe('bin-file edits', () => {
  const find = (name) => added.created.find(f => f.original_name === name)
  it('PATCH validates the vocabulary and keeps the path out of reach', async () => {
    const clip = find('clip.mp4')
    const r = await (await api(`/bin-files/${clip.id}`, PATCH({ review_flag: 'select', color: 'green', circled: true, take_number: '3', shoot_day: '2026-06-12', source_path: 'C:/evil', notes: 'nice' }))).json()
    expect(r).toMatchObject({ review_flag: 'select', color: 'green', circled: true, take_number: 3, shoot_day: '2026-06-12', notes: 'nice' })
    expect(r.source_path).toBe(clip.source_path)
    const bad = await (await api(`/bin-files/${clip.id}`, PATCH({ review_flag: 'maybe', color: 'plaid', shoot_day: 'tuesday' }))).json()
    expect(bad).toMatchObject({ review_flag: 'unflagged', color: null, shoot_day: null })
    expect((await api('/bin-files/ghost', PATCH({ notes: 'x' }))).status).toBe(404)
    expect((await api(`/bin-files/${clip.id}`, PATCH({ bin_id: 'ghost' }))).status).toBe(400)
  })
  it('bulk applies one patch to many', async () => {
    const ids = [find('clip.mp4').id, find('tone.wav').id]
    const r = await (await api('/bin-files/bulk', J({ ids, patch: { camera: 'B', tags: ['day1', ' '] } }))).json()
    expect(r.updated.length).toBe(2)
    expect(r.updated.every(f => f.camera === 'B' && f.tags.length === 1)).toBe(true)
    expect((await api('/bin-files/bulk', J({ ids: [], patch: {} }))).status).toBe(400)
  })
  it('move, copy (an instance), reorder', async () => {
    const still = find('still.png')
    const mv = await (await api('/bin-files/move', J({ ids: [still.id], binId: sceneBin.id }))).json()
    expect(mv.moved).toEqual([{ id: still.id, from: dailies.id, sort_order: still.sort_order }])
    expect(mv.binFiles[0].bin_id).toBe(sceneBin.id)
    const cp = await (await api('/bin-files/copy', J({ ids: [find('clip.mp4').id], binId: sceneBin.id }))).json()
    expect(cp.created.length).toBe(1)
    expect(cp.created[0].id).not.toBe(find('clip.mp4').id)
    expect(cp.created[0].source_path).toBe(find('clip.mp4').source_path)
    expect((await api('/bin-files/move', J({ ids: [still.id], binId: 'ghost' }))).status).toBe(400)
    // An undo hands the original order back and it is honoured.
    const back = await (await api('/bin-files/move', J({ ids: [still.id], binId: dailies.id, sortOrders: { [still.id]: 41 } }))).json()
    expect(back.binFiles[0]).toMatchObject({ bin_id: dailies.id, sort_order: 41 })
    await api('/bin-files/move', J({ ids: [still.id], binId: sceneBin.id }))
    const ro = await api('/bin-files/reorder', J({ ids: [cp.created[0].id, still.id] }))
    expect(ro.status).toBe(200)
    const files = (await (await api('/bins')).json()).binFiles
    expect(files.find(f => f.id === still.id).sort_order).toBe(1)
  })
  it('remove returns the rows and restore puts them back verbatim', async () => {
    const pdf = find('notes.pdf')
    const rm = await (await api('/bin-files/remove', J({ ids: [pdf.id] }))).json()
    expect(rm.removed.map(f => f.id)).toEqual([pdf.id])
    expect((await (await api('/bins')).json()).binFiles.some(f => f.id === pdf.id)).toBe(false)
    const rs = await (await api('/bin-files/restore', J({ rows: rm.removed }))).json()
    expect(rs.restored.map(f => f.id)).toEqual([pdf.id])
    expect((await (await api('/bins')).json()).binFiles.some(f => f.id === pdf.id)).toBe(true)
    expect((await api('/bin-files/restore', J({ rows: [{ id: 'x', bin_id: dailies.id, source_path: 'relative' }] }))).status).toBe(200)
    expect((await api('/bin-files/remove', J({}))).status).toBe(400)
  })
})

// ── probe, posters, bytes ───────────────────────────────────────────────────
describe('probe', () => {
  const find = (name) => added.created.find(f => f.original_name === name)
  it('a still is measured by sharp', async () => {
    const r = await (await api(`/bin-files/${find('ref.png').id}/probe`, J({}))).json()
    expect(r).toMatchObject({ width: 16, height: 16, codec: 'png', probe_status: 'done' })
  })
  it('a sequence gets frames, fps from the project and a derived duration', async () => {
    const seq = added.created.find(f => f.is_sequence)
    const r = await (await api(`/bin-files/${seq.id}/probe`, J({}))).json()
    expect(r).toMatchObject({ frame_count: 5, fps: 25, duration_sec: 0.2, width: 8, height: 8, probe_status: 'done' })
  })
  it('a video that cannot be probed is a named state, never an error', async () => {
    const r = await (await api(`/bin-files/${find('clip.mp4').id}/probe`, J({}))).json()
    expect(r.probe_status).toBe(FFMPEG ? 'failed' : 'unavailable')
  })
  it('a missing file is 410 offline; an unknown id is 404', async () => {
    const ghostRow = await (await api(`/bin-files/restore`, J({ rows: [{ id: 'ghost-row', bin_id: dailies.id, source_path: path.join(media(), 'gone.mp4'), original_name: 'gone.mp4', extension: '.mp4', media_type: 'video', is_sequence: false }] }))).json()
    expect(ghostRow.restored.length).toBe(1)
    const r = await api('/bin-files/ghost-row/probe', J({}))
    expect(r.status).toBe(410)
    expect((await r.json()).code).toBe('offline')
    expect((await api('/bin-files/nope/probe', J({}))).status).toBe(404)
  })
})

describe('thumbnail', () => {
  const find = (name) => added.created.find(f => f.original_name === name)
  it('a still becomes a cached JPEG', async () => {
    const r = await api(`/bin-files/${find('ref.png').id}/thumbnail`)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toMatch(/image\/jpeg/)
    const bytes = Buffer.from(await r.arrayBuffer())
    expect(bytes[0]).toBe(0xff)
    expect(fs.readdirSync(thumbDir).some(n => n.startsWith('bin-'))).toBe(true)
  })
  it('a sequence poster is its middle frame, and HEAD answers like GET without a body', async () => {
    const seq = added.created.find(f => f.is_sequence)
    const r = await api(`/bin-files/${seq.id}/thumbnail`)
    expect(r.status).toBe(200)
    const h = await api(`/bin-files/${seq.id}/thumbnail`, { method: 'HEAD' })
    expect(h.status).toBe(200)
    expect(h.headers.get('content-type')).toMatch(/image\/jpeg/)
    expect((await h.arrayBuffer()).byteLength).toBe(0)
  })
  it('an undecodable video is a named code; audio is 415 unsupported_type', async () => {
    const v = await api(`/bin-files/${find('clip.mp4').id}/thumbnail`)
    // The stubbed generateVideoThumbOnce answers ffmpeg_missing; with a real
    // binary present the route still reaches it and reports the stub's reason
    // as a 422 (the bytes are not a video), without one it is 415.
    expect(v.status).toBe(FFMPEG ? 422 : 415)
    expect((await v.json()).code).toBe('ffmpeg_missing')
    const a = await api(`/bin-files/${find('tone.wav').id}/thumbnail`)
    expect(a.status).toBe(415)
    expect((await a.json()).code).toBe('unsupported_type')
  })
  it('an offline row is 410', async () => {
    const r = await api('/bin-files/ghost-row/thumbnail')
    expect(r.status).toBe(410)
  })
  it('the renderer may POST a JPEG it decoded, and only a JPEG', async () => {
    const clip = find('clip.mp4')
    const notJpeg = await api(`/bin-files/${clip.id}/thumbnail`, J({ base64: Buffer.from('hello').toString('base64') }))
    expect(notJpeg.status).toBe(415)
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0)])
    const ok = await api(`/bin-files/${clip.id}/thumbnail`, J({ base64: jpeg.toString('base64') }))
    expect(ok.status).toBe(200)
    const served = await api(`/bin-files/${clip.id}/thumbnail`)
    expect(served.status).toBe(200)
    expect((await api(`/bin-files/${clip.id}/thumbnail`, J({}))).status).toBe(400)
  })
})

describe('stream', () => {
  const find = (name) => added.created.find(f => f.original_name === name)
  it('serves bytes with an allowlisted type and honours Range', async () => {
    const clip = find('clip.mp4')
    const r = await api(`/bin-files/${clip.id}/stream`)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('video/mp4')
    expect(r.headers.get('accept-ranges')).toBe('bytes')
    expect((await r.arrayBuffer()).byteLength).toBe(2048)
    const part = await api(`/bin-files/${clip.id}/stream`, { headers: { range: 'bytes=0-99' } })
    expect(part.status).toBe(206)
    expect((await part.arrayBuffer()).byteLength).toBe(100)
  })
  it('a document is served as an opaque download, never as text', async () => {
    const r = await api(`/bin-files/${find('notes.pdf').id}/stream`)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('application/octet-stream')
  })
  it('a sequence streams its middle frame as an image', async () => {
    const seq = added.created.find(f => f.is_sequence)
    const r = await api(`/bin-files/${seq.id}/stream`)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('image/png')
  })
  it('offline is 410, unknown is 404', async () => {
    expect((await api('/bin-files/ghost-row/stream')).status).toBe(410)
    expect((await api('/bin-files/nope/stream')).status).toBe(404)
  })
})

// ── relink ───────────────────────────────────────────────────────────────────
describe('relink', () => {
  it('scan without a folder lists the offline rows', async () => {
    const r = await (await api('/bins/relink-scan', J({}))).json()
    expect(r.candidates).toBeNull()
    expect(r.offline.map(o => o.id)).toContain('ghost-row')
  })
  it('scan refuses a folder nobody picked and a folder that is not one', async () => {
    const r = await api('/bins/relink-scan', J({ folderPath: path.join(os.tmpdir()) }))
    expect(r.status).toBe(403)
    expect((await r.json()).code).toBe('unauthorized_folder')
    const nf = await api('/bins/relink-scan', J({ folderPath: path.join(media(), 'still.png') }))
    expect(nf.status).toBe(400)
  })
  it('scan walks a known root and lists candidates including sequences as one', async () => {
    const r = await (await api('/bins/relink-scan', J({ folderPath: media() }))).json()
    expect(r.candidates.some(c => c.name === 'clip.mp4' && c.size === 2048)).toBe(true)
    expect(r.candidates.some(c => c.name === 'plate_seq' && c.is_sequence)).toBe(true)
    expect(r.candidates.some(c => c.name.startsWith('plate.'))).toBe(false)
  })
  it('apply rewrites every instance of the old path and refuses a missing target', async () => {
    const moved = path.join(media(), 'moved.mp4')
    fs.copyFileSync(path.join(media(), 'clip.mp4'), moved)
    const files = (await (await api('/bins')).json()).binFiles
    const instances = files.filter(f => f.original_name === 'clip.mp4')
    expect(instances.length).toBe(2)
    const r = await (await api('/bins/relink-apply', J({ mappings: [{ id: instances[0].id, newPath: moved }, { id: 'ghost-row', newPath: path.join(media(), 'still-missing.mp4') }] }))).json()
    expect(r.updated.length).toBe(2)
    expect(r.updated.every(f => f.source_path === path.resolve(moved) && f.online)).toBe(true)
    expect(r.failed).toEqual([{ id: 'ghost-row', reason: 'missing' }])
    expect((await api('/bins/relink-apply', J({}))).status).toBe(400)
  })
  it('roots can be added and removed', async () => {
    const r = await (await api('/bins/roots', J({ path: path.join(media(), 'Day01'), label: 'Day 1 card' }))).json()
    expect(r.binRoots.length).toBeGreaterThan(0)
    expect((await api('/bins/roots', J({ path: 'nope' }))).status).toBe(400)
    const before = r.binRoots.length
    const del = await (await api(`/bins/roots/${r.binRoots[0].id}`, { method: 'DELETE' })).json()
    expect(del.binRoots.length).toBe(before - 1)
    expect((await api('/bins/roots/ghost', { method: 'DELETE' })).status).toBe(404)
  })
})

// ── shot takes (milestone 2) ────────────────────────────────────────────────
// Shots live in the bundle's own `shots` array (the generic sub-entity routes
// in main.cjs own them); here they are written straight into the store. `omit`
// is a shot marked omitted — the ROUTES accept it (undo must be able to
// re-assign to a shot omitted meanwhile); the PICKER hides it (Q6).
describe('shot takes', () => {
  const shotA = 'shot-a', shotB = 'shot-b', shotOmit = 'shot-omit'
  let byName
  const takesOf = async (shotId) => (await (await api('/shot-takes')).json()).shotTakes.filter(t => t.shot_id === shotId).sort((a, b) => a.position - b.position)

  it('the gate covers the new prefix', async () => {
    expect((await raw('/shot-takes', { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403)
    expect((await raw('/shot-takes')).status).toBe(403)
    expect((await raw('/shot-takes/remove', J({ ids: ['x'] }))).status).toBe(403)
  })
  it('starts empty, on its own route and on the bins list', async () => {
    const bundle = JSON.parse(store.get(PID))
    bundle.scenes = [{ id: 'sc-1', name: 'Sc 1', scene_number: 1 }, { id: 'sc-2', name: 'Sc 2', scene_number: 2 }]
    bundle.shots = [
      { id: shotA, scene_id: 'sc-1', name: 'Sc1 Sh1', shot_number: 1, status: 'not_started' },
      { id: shotB, scene_id: 'sc-2', name: 'Sc2 Sh1', shot_number: 1, status: 'in_progress' },
      { id: shotOmit, scene_id: 'sc-1', name: 'Sc1 Sh9', shot_number: 9, status: 'omitted' },
    ]
    store.set(PID, JSON.stringify(bundle))
    expect((await (await api('/shot-takes')).json()).shotTakes).toEqual([])
    expect((await (await api('/bins')).json()).shotTakes).toEqual([])
    const files = (await (await api('/bins')).json()).binFiles
    byName = (n) => files.find(f => f.original_name === n)
    expect(byName('still.png')).toBeTruthy()
  })
  it('assigns several files to one shot in one call: the first is primary, the rest alt, positions in order', async () => {
    const r = await api('/shot-takes', J({ assignments: [{ shot_id: shotA, bin_file_id: byName('still.png').id }, { shot_id: shotA, bin_file_id: byName('tone.wav').id, notes: 'wild track' }] }))
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.created.length).toBe(2)
    expect(body.skipped).toEqual([])
    expect(body.affectedShotIds).toEqual([shotA])
    expect(body.shotTakes.map(t => [t.role, t.position, t.notes])).toEqual([['primary', 0, ''], ['alt', 1, 'wild track']])
    expect(body.created.every(t => t.project_id === PID && t.id && t.created_at)).toBe(true)
  })
  it('the same pair again is skipped, never duplicated; one file may serve several shots (Q6)', async () => {
    const again = await (await api('/shot-takes', J({ assignments: [{ shot_id: shotA, bin_file_id: byName('still.png').id }] }))).json()
    expect(again.created).toEqual([])
    expect(again.skipped[0]).toMatchObject({ shot_id: shotA, reason: 'already_assigned' })
    expect((await takesOf(shotA)).length).toBe(2)
    const b = await (await api('/shot-takes', J({ assignments: [{ shot_id: shotB, bin_file_id: byName('still.png').id }, { shot_id: shotOmit, bin_file_id: byName('still.png').id }] }))).json()
    expect(b.created.length).toBe(2)
    expect((await takesOf(shotB))[0].role).toBe('primary')
    expect((await (await api('/shot-takes')).json()).shotTakes.filter(t => t.bin_file_id === byName('still.png').id).length).toBe(3)
  })
  it('refuses an unknown shot, an unknown file and an empty batch, and writes nothing on a half-bad batch', async () => {
    const before = (await (await api('/shot-takes')).json()).shotTakes.length
    const s = await api('/shot-takes', J({ assignments: [{ shot_id: shotA, bin_file_id: byName('notes.pdf').id }, { shot_id: 'ghost', bin_file_id: byName('notes.pdf').id }] }))
    expect(s.status).toBe(400)
    expect((await s.json()).code).toBe('shot_not_found')
    const f = await api('/shot-takes', J({ assignments: [{ shot_id: shotA, bin_file_id: 'ghost' }] }))
    expect(f.status).toBe(400)
    expect((await f.json()).code).toBe('file_not_found')
    expect((await api('/shot-takes', J({}))).status).toBe(400)
    expect((await (await api('/shot-takes')).json()).shotTakes.length).toBe(before)
  })
  it('a role may be given; asking for primary demotes the current primary to alt', async () => {
    const p = await (await api('/shot-takes', J({ assignments: [{ shot_id: shotA, bin_file_id: byName('notes.pdf').id, role: 'part' }] }))).json()
    expect(p.created[0].role).toBe('part')
    const pr = await (await api('/shot-takes', J({ assignments: [{ shot_id: shotA, bin_file_id: byName('ref.png').id, role: 'primary' }] }))).json()
    const rows = await takesOf(shotA)
    expect(rows.map(t => t.role)).toEqual(['alt', 'alt', 'part', 'primary'])
    expect(rows.filter(t => t.role === 'primary').length).toBe(1)
    expect(pr.shotTakes.length).toBe(4)
  })
  it('PATCH swaps roles on promotion, hands primary on when the primary is demoted, keeps a sole primary, validates the role', async () => {
    let rows = await takesOf(shotA)
    const part = rows.find(t => t.role === 'part')
    const oldPrimary = rows.find(t => t.role === 'primary')
    const r = await (await api(`/shot-takes/${part.id}`, PATCH({ role: 'primary', notes: 'the hero take' }))).json()
    expect(r.take).toMatchObject({ id: part.id, role: 'primary', notes: 'the hero take' })
    rows = await takesOf(shotA)
    expect(rows.find(t => t.id === oldPrimary.id).role).toBe('part')
    expect(rows.filter(t => t.role === 'primary').length).toBe(1)
    // Demote the primary: the next take in order takes over.
    await api(`/shot-takes/${part.id}`, PATCH({ role: 'alt' }))
    rows = await takesOf(shotA)
    expect(rows.find(t => t.id === part.id).role).toBe('alt')
    expect(rows.filter(t => t.role === 'primary').length).toBe(1)
    expect(rows.find(t => t.role === 'primary').id).toBe(rows.filter(t => t.id !== part.id)[0].id)
    // The only take of a shot stays primary whatever is asked.
    const sole = (await takesOf(shotB))[0]
    const keep = await (await api(`/shot-takes/${sole.id}`, PATCH({ role: 'alt' }))).json()
    expect(keep.take.role).toBe('primary')
    expect((await api(`/shot-takes/${sole.id}`, PATCH({ role: 'hero' }))).status).toBe(400)
    expect((await api(`/shot-takes/${sole.id}`, PATCH({ position: 'first' }))).status).toBe(400)
    expect((await api('/shot-takes/ghost', PATCH({ notes: 'x' }))).status).toBe(404)
  })
  it('PATCH position moves a take within its shot; reorder sets the whole order and unlisted takes follow', async () => {
    let rows = await takesOf(shotA)
    const last = rows[rows.length - 1]
    await api(`/shot-takes/${last.id}`, PATCH({ position: 0 }))
    rows = await takesOf(shotA)
    expect(rows[0].id).toBe(last.id)
    expect(rows.map(t => t.position)).toEqual([0, 1, 2, 3])
    const ids = rows.map(t => t.id)
    const ro = await (await api('/shot-takes/reorder', J({ shot_id: shotA, ids: [ids[2], ids[1]] }))).json()
    expect(ro.affectedShotIds).toEqual([shotA])
    rows = await takesOf(shotA)
    expect(rows.map(t => t.id)).toEqual([ids[2], ids[1], ids[0], ids[3]])
    expect(rows.filter(t => t.role === 'primary').length).toBe(1)
    expect((await api('/shot-takes/reorder', J({ shot_id: 'ghost', ids }))).status).toBe(400)
    expect((await api('/shot-takes/reorder', J({ shot_id: shotA }))).status).toBe(400)
  })
  it('remove returns the rows, promotes the next take when the primary goes, and 404s on unknown ids', async () => {
    let rows = await takesOf(shotA)
    const primary = rows.find(t => t.role === 'primary')
    const r = await (await api('/shot-takes/remove', J({ ids: [primary.id] }))).json()
    expect(r.removed.map(t => t.id)).toEqual([primary.id])
    expect(r.affectedShotIds).toEqual([shotA])
    rows = await takesOf(shotA)
    expect(rows.length).toBe(3)
    expect(rows.map(t => t.position)).toEqual([0, 1, 2])
    expect(rows.filter(t => t.role === 'primary').length).toBe(1)
    expect((await api('/shot-takes/remove', J({ ids: ['ghost'] }))).status).toBe(404)
    expect((await api('/shot-takes/remove', J({}))).status).toBe(400)
  })
  it('replace restores a snapshot verbatim (ids, roles, positions), drops what it cannot place, and clears with an empty list', async () => {
    const snapshot = await takesOf(shotA)
    // Mutate: promote the last, remove the first.
    await api(`/shot-takes/${snapshot[2].id}`, PATCH({ role: 'primary' }))
    await api('/shot-takes/remove', J({ ids: [snapshot[0].id] }))
    expect((await takesOf(shotA)).length).toBe(2)
    const back = await (await api('/shot-takes/replace', J({ shotIds: [shotA], rows: snapshot }))).json()
    expect(back.affectedShotIds).toEqual([shotA])
    const rows = await takesOf(shotA)
    expect(rows.map(t => [t.id, t.role, t.position, t.notes])).toEqual(snapshot.map(t => [t.id, t.role, t.position, t.notes]))
    // Rows for another shot, an unknown file, and a duplicated pair are ignored.
    const messy = [...snapshot, { ...snapshot[0], id: 'dup-of-first' }, { id: 'stray', shot_id: shotB, bin_file_id: snapshot[0].bin_file_id, role: 'primary', position: 0 }, { id: 'nofile', shot_id: shotA, bin_file_id: 'ghost', role: 'alt', position: 9 }]
    await api('/shot-takes/replace', J({ shotIds: [shotA], rows: messy }))
    expect((await takesOf(shotA)).map(t => t.id)).toEqual(snapshot.map(t => t.id))
    expect((await takesOf(shotB)).length).toBe(1)
    expect((await api('/shot-takes/replace', J({ shotIds: ['ghost'], rows: [] }))).status).toBe(400)
    expect((await api('/shot-takes/replace', J({ rows: [] }))).status).toBe(400)
    await api('/shot-takes/replace', J({ shotIds: [shotB], rows: [] }))
    expect((await takesOf(shotB)).length).toBe(0)
    await api('/shot-takes/replace', J({ shotIds: [shotB], rows: [{ shot_id: shotB, bin_file_id: byName('still.png').id, role: 'alt', position: 0 }] }))
    expect((await takesOf(shotB))[0].role).toBe('primary')
  })
  // Every shot in a read has exactly one primary and positions 0..n-1 —
  // asserted after EVERY step below, because the two HIGH findings of the
  // review lived exactly here (a removed file left a shot with no primary;
  // a restored one left it with two).
  const invariants = (rows) => {
    const byShot = new Map()
    for (const t of rows) { if (!byShot.has(t.shot_id)) byShot.set(t.shot_id, []); byShot.get(t.shot_id).push(t) }
    for (const [shotId, list] of byShot) {
      list.sort((a, b) => a.position - b.position)
      expect(list.filter(t => t.role === 'primary').length, `shot ${shotId} primaries`).toBe(1)
      expect(list.map(t => t.position), `shot ${shotId} positions`).toEqual(list.map((_, i) => i))
    }
  }
  it('a removed bin file takes its assignments out of every read; restoring the file brings them back; the invariants hold throughout', async () => {
    const still = byName('still.png')
    const before = (await (await api('/shot-takes')).json()).shotTakes.filter(t => t.bin_file_id === still.id).length
    expect(before).toBeGreaterThan(0)
    const rm = await (await api('/bin-files/remove', J({ ids: [still.id] }))).json()
    let read = (await (await api('/shot-takes')).json()).shotTakes
    expect(read.some(t => t.bin_file_id === still.id)).toBe(false)
    invariants(read)
    read = (await (await api('/bins')).json()).shotTakes
    expect(read.some(t => t.bin_file_id === still.id)).toBe(false)
    invariants(read)
    await api('/bin-files/restore', J({ rows: rm.removed }))
    read = (await (await api('/shot-takes')).json()).shotTakes
    expect(read.filter(t => t.bin_file_id === still.id).length).toBe(before)
    invariants(read)
  })
  it('while the primary\'s file is out, reads present the next take as primary WITHOUT writing; a take promoted meanwhile keeps the role when the file returns', async () => {
    const shotC = 'shot-c'
    const bundle = JSON.parse(store.get(PID))
    bundle.shots.push({ id: shotC, scene_id: 'sc-2', name: 'Sc2 Sh2', shot_number: 2, status: 'not_started' })
    store.set(PID, JSON.stringify(bundle))
    const f1 = byName('still.png'), f2 = byName('tone.wav'), f3 = byName('notes.pdf')
    await api('/shot-takes', J({ assignments: [f1, f2, f3].map(f => ({ shot_id: shotC, bin_file_id: f.id })) }))
    expect((await takesOf(shotC)).map(t => [t.bin_file_id, t.role, t.position])).toEqual([[f1.id, 'primary', 0], [f2.id, 'alt', 1], [f3.id, 'alt', 2]])
    const rm = await (await api('/bin-files/remove', J({ ids: [f1.id] }))).json()
    // Presented: the next take is primary, positions renumbered.
    expect((await takesOf(shotC)).map(t => [t.bin_file_id, t.role, t.position])).toEqual([[f2.id, 'primary', 0], [f3.id, 'alt', 1]])
    // On disk: nothing was written — f1 is still the primary, still at 0.
    const disk = JSON.parse(store.get(PID)).shotTakes.filter(t => t.shot_id === shotC).sort((a, b) => a.position - b.position)
    expect(disk.map(t => [t.bin_file_id, t.role, t.position])).toEqual([[f1.id, 'primary', 0], [f2.id, 'alt', 1], [f3.id, 'alt', 2]])
    // Restore straight away: exact.
    await api('/bin-files/restore', J({ rows: rm.removed }))
    expect((await takesOf(shotC)).map(t => [t.bin_file_id, t.role, t.position])).toEqual([[f1.id, 'primary', 0], [f2.id, 'alt', 1], [f3.id, 'alt', 2]])
    // Out again, and this time the editor promotes f3 while f1 is away.
    await api('/bin-files/remove', J({ ids: [f1.id] }))
    const t3 = (await takesOf(shotC)).find(t => t.bin_file_id === f3.id)
    await api(`/shot-takes/${t3.id}`, PATCH({ role: 'primary' }))
    expect((await takesOf(shotC)).map(t => [t.bin_file_id, t.role])).toEqual([[f2.id, 'alt'], [f3.id, 'primary']])
    // The orphan was demoted on disk, so the restored take comes back as an
    // alt in its old slot and the editor's choice stands.
    await api('/bin-files/restore', J({ rows: rm.removed }))
    const back = await takesOf(shotC)
    expect(back.map(t => [t.bin_file_id, t.role, t.position])).toEqual([[f1.id, 'alt', 0], [f2.id, 'alt', 1], [f3.id, 'primary', 2]])
    invariants((await (await api('/shot-takes')).json()).shotTakes)
  })
  it('replace keeps the orphan rows of the named shots, so undoing a file removal after an undo still brings the take back', async () => {
    const shotC = 'shot-c'
    const f1 = byName('still.png')
    const rm = await (await api('/bin-files/remove', J({ ids: [f1.id] }))).json()
    const live = await takesOf(shotC)
    expect(live.some(t => t.bin_file_id === f1.id)).toBe(false)
    await api('/shot-takes/replace', J({ shotIds: [shotC], rows: live }))
    expect(JSON.parse(store.get(PID)).shotTakes.some(t => t.shot_id === shotC && t.bin_file_id === f1.id)).toBe(true)
    await api('/bin-files/restore', J({ rows: rm.removed }))
    const back = await takesOf(shotC)
    expect(back.some(t => t.bin_file_id === f1.id)).toBe(true)
    expect(back.filter(t => t.role === 'primary').length).toBe(1)
  })
  it('a deleted shot takes its assignments out of every read; the rows wait on disk for an undo', async () => {
    const bundle = JSON.parse(store.get(PID))
    const onDisk = bundle.shotTakes.filter(t => t.shot_id === shotOmit).length
    expect(onDisk).toBe(1)
    bundle.shots = bundle.shots.filter(s => s.id !== shotOmit)
    store.set(PID, JSON.stringify(bundle))
    expect((await (await api('/shot-takes')).json()).shotTakes.some(t => t.shot_id === shotOmit)).toBe(false)
    expect(JSON.parse(store.get(PID)).shotTakes.filter(t => t.shot_id === shotOmit).length).toBe(onDisk)
    expect((await api('/shot-takes', J({ assignments: [{ shot_id: shotOmit, bin_file_id: byName('still.png').id }] }))).status).toBe(400)
  })
})

// ── deleting bins ───────────────────────────────────────────────────────────
describe('delete bin', () => {
  it('move mode moves the files of the bin and its children to the target', async () => {
    const before = (await (await api('/bins')).json())
    const subtree = new Set([dailies.id])
    let grew = true
    while (grew) { grew = false; for (const b of before.bins) if (b.parent_bin_id && subtree.has(b.parent_bin_id) && !subtree.has(b.id)) { subtree.add(b.id); grew = true } }
    const inTree = before.binFiles.filter(f => subtree.has(f.bin_id))
    expect(inTree.length).toBeGreaterThan(0)
    const bad = await api(`/bins/${dailies.id}?mode=move&target=${childBin.id}`, { method: 'DELETE' })
    expect(bad.status).toBe(400)
    const r = await (await api(`/bins/${dailies.id}?mode=move&target=${sceneBin.id}`, { method: 'DELETE' })).json()
    expect(r.removedBins.map(b => b.id)).toContain(childBin.id)
    expect(r.movedFiles.length).toBe(inTree.length)
    const after = await (await api('/bins')).json()
    expect(after.bins.some(b => b.id === dailies.id)).toBe(false)
    expect(after.binFiles.every(f => f.bin_id === sceneBin.id)).toBe(true)
  })
  it('remove mode returns the removed files for undo; unknown is 404', async () => {
    const onDisk = JSON.parse(store.get(PID)).shotTakes.length
    expect(onDisk).toBeGreaterThan(0)
    const r = await (await api(`/bins/${sceneBin.id}?mode=remove`, { method: 'DELETE' })).json()
    expect(r.removedFiles.length).toBeGreaterThan(0)
    expect((await (await api('/bins')).json()).binFiles).toEqual([])
    // With every file gone, no take is live — and not one was pruned from disk.
    expect((await (await api('/bins')).json()).shotTakes).toEqual([])
    expect(JSON.parse(store.get(PID)).shotTakes.length).toBe(onDisk)
    expect((await api('/bins/ghost', { method: 'DELETE' })).status).toBe(404)
  })
})

// ── wiring pin ───────────────────────────────────────────────────────────────
// Measured on the desktop (2026-09-10): the mount sat AFTER the SPA catch-all
// `expressApp.get('/{*splat}', …)`, so every GET the module registers answered
// index.html while POSTs worked — and this file stayed green, because it
// mounts on a fresh app with no catch-all. Registration ORDER is the contract,
// so it is pinned on main.cjs's source. The local-demo missing-folder guard
// (`app.use('/api/rabbit', localDemoMissingGuard)`) must come before the mount
// so it covers the bin routes too.
describe('main.cjs wiring', () => {
  const src = fs.readFileSync(new URL('../../../../electron/main.cjs', import.meta.url), 'utf8')
  it('mounts the bins routes before the static / SPA fallback', () => {
    const mount = src.indexOf('mountRabbitBins(')
    const stat = src.indexOf('express.static(distPath)')
    const splat = src.indexOf("expressApp.get('/{*splat}'")
    expect(mount).toBeGreaterThan(0)
    expect(stat).toBeGreaterThan(mount)
    expect(splat).toBeGreaterThan(mount)
  })
  it('mounts after the local-demo missing-folder guard when that guard exists', () => {
    const guard = src.indexOf("expressApp.use('/api/rabbit', localDemoMissingGuard)")
    if (guard < 0) return // not on this branch yet
    expect(src.indexOf('mountRabbitBins(')).toBeGreaterThan(guard)
  })
})
