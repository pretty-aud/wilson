// =============================================================================
// rabbitCloudBinsDesktop.routes.test.js — the desktop app SIGNED IN (BC2):
// the cloud-bins routes BC2 adds or changes in electron/rabbitBins.cjs, over
// a real Express app on an ephemeral port, real files in a temp folder, a
// fake OS dialog. rabbitCloudBins.routes.test.js keeps BC1's routes.
//
// What this pins:
//   * the ping — the renderer's "the desktop's file process is reachable" —
//     answers behind the same-origin gate and says nothing but ok + ffmpeg;
//   * registration REPLACES the list: a location the renderer no longer
//     sends (removed in the cloud, a sign-out, another company) is no longer
//     readable through these routes;
//   * B2's fallback, per computer: the folder a location is seen under on
//     this computer is read from THIS computer's settings — written only by
//     the folder dialog for that location — and only for the network
//     address it was chosen for; a re-addressed location drops it. A body
//     local_path nobody picked is still dropped (BC1's rule stands).
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'

const require = createRequire(import.meta.url)
const { mountRabbitBins, locateCloudPath, shareRootOfPath } = require('../../../../electron/rabbitBins.cjs')

const store = new Map()
const readRabbitBundle = (id) => (store.has(id) ? JSON.parse(store.get(id)) : null)
const writeRabbitBundle = (id, bundle) => { store.set(id, JSON.stringify(bundle)) }
const { randomUUID } = require('node:crypto')
function rabbitTouch(row) { const now = new Date().toISOString(); if (!row.id) row.id = randomUUID(); if (!row.created_at) row.created_at = now; row.updated_at = now; return row }
function rabbitUpsertInto(arr, row) { const i = arr.findIndex(x => x.id === row.id); if (i >= 0) { arr[i] = { ...arr[i], ...row }; return arr[i] } arr.push(row); return row }
function rabbitRemoveFrom(arr, id) { const i = arr.findIndex(x => x.id === id); if (i < 0) return false; arr.splice(i, 1); return true }
function rabbitNotFound(res, what = 'project') { return res.status(404).json({ error: `${what} not found` }) }
function safeMediaContentType(mime) { const m = String(mime || '').trim().toLowerCase(); return /^(video|audio|image)\/[a-z0-9][a-z0-9.+-]*$/.test(m) && m !== 'image/svg+xml' ? m : 'application/octet-stream' }

let root, media, other, thumbDir, server, base
const userAuthorizedDirs = new Set()
// This computer's settings file, in memory: what main.cjs injects.
const saved = { value: null, writes: 0 }
const cloudBinsLocalPaths = { read: () => (saved.value ? JSON.parse(JSON.stringify(saved.value)) : null), write: (v) => { saved.value = JSON.parse(JSON.stringify(v)); saved.writes++ } }
// The OS dialog: answers whatever the test sets next.
const dialogAnswer = { filePaths: [], canceled: true }
// The OS shell: records what the desktop would open or reveal.
const shellCalls = []
const shell = { openPath: async (p) => { shellCalls.push(['open', p]); return '' }, showItemInFolder: (p) => { shellCalls.push(['reveal', p]) } }
const dialogCalls = []
const dialog = { showOpenDialog: async (_win, opts) => { dialogCalls.push(opts); return { ...dialogAnswer } } }

const J = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const raw = (p, init) => fetch(`${base}/api/rabbit/cloud-bins${p}`, init)
const api = (p, init = {}) => raw(p, { ...init, headers: { 'sec-fetch-site': 'same-origin', ...(init.headers || {}) } })

const UNC = '\\\\salthours-nas\\footage'

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wilson-cloud-bins-bc2-'))
  thumbDir = path.join(root, 'thumbs'); fs.mkdirSync(thumbDir)
  media = path.join(root, 'footage'); fs.mkdirSync(path.join(media, 'A001'), { recursive: true })
  other = path.join(root, 'elsewhere'); fs.mkdirSync(other)
  fs.writeFileSync(path.join(media, 'A001', 'clip.mp4'), Buffer.alloc(1024, 3))
  fs.writeFileSync(path.join(other, 'secret.mov'), Buffer.alloc(16, 1))
  fs.writeFileSync(path.join(media, 'A001', 'run.mov.cmd'), 'echo hi')
  fs.writeFileSync(path.join(media, 'A001', 'A001C003_240612_R1AB_T4.mov'), Buffer.alloc(64, 2))
  fs.mkdirSync(path.join(media, 'A001', 'stills'))
  fs.writeFileSync(path.join(media, 'A001', 'stills', 'frame.png'), Buffer.alloc(32, 4))
  const seq = path.join(media, 'VFX', 'plate_seq'); fs.mkdirSync(seq, { recursive: true })
  for (let i = 1; i <= 4; i++) fs.writeFileSync(path.join(seq, `plate.${String(i).padStart(4, '0')}.exr`), Buffer.alloc(8, i))
  // Item 4: a real still (sharp draws its poster) and a PNG frame sequence.
  const sharp = require('sharp')
  fs.mkdirSync(path.join(media, 'STILLS'))
  await sharp({ create: { width: 64, height: 36, channels: 3, background: '#ea580c' } }).png().toFile(path.join(media, 'STILLS', 'set.png'))
  const pseq = path.join(media, 'STILLS', 'png_seq'); fs.mkdirSync(pseq)
  for (let i = 1; i <= 3; i++) await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toFile(path.join(pseq, `f.${String(i).padStart(4, '0')}.png`))
  const app = express()
  app.use(express.json({ limit: '5mb' }))
  mountRabbitBins(app, {
    readRabbitBundle, writeRabbitBundle, rabbitTouch, rabbitUpsertInto, rabbitRemoveFrom, rabbitNotFound,
    getThumbCacheDir: () => thumbDir,
    generateVideoThumbOnce: async () => ({ ok: false, reason: 'ffmpeg_missing' }),
    safeMediaContentType,
    userAuthorizedDirs, dialog, getMainWindow: () => ({}), shell,
    cloudBinsLocalPaths,
  })
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve) })
  base = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  await new Promise(resolve => server.close(resolve))
  fs.rmSync(root, { recursive: true, force: true })
})

describe('the ping: is the desktop\'s file process reachable?', () => {
  it('answers ok and the decoder flag, behind the same-origin gate', async () => {
    const r = await api('/ping')
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(Object.keys(body).sort()).toEqual(['ffmpeg', 'ok'])
    expect(body.ok).toBe(true)
    expect(typeof body.ffmpeg).toBe('boolean')
    const cross = await raw('/ping')
    expect(cross.status).toBe(403)
  })
})

describe('registration replaces the list', () => {
  it('a location the renderer no longer sends is no longer readable here', async () => {
    saved.value = { version: 1, locations: { 'loc-a': { unc_path: UNC, local_path: media } } }
    await api('/locations', J({ locations: [{ id: 'loc-a', unc_path: UNC }] }))
    const before = await (await api('/resolve', J({ files: [{ id: 'x', location_id: 'loc-a', relative_path: 'A001/clip.mp4' }] }))).json()
    expect(before.files[0].online).toBe(true)
    // The company's list changes (the location removed in the cloud, or a
    // sign-out sends nothing): loc-a is gone from this computer's list.
    await api('/locations', J({ locations: [{ id: 'loc-b', unc_path: '\\\\other-nas\\share' }] }))
    const after = await (await api('/resolve', J({ files: [{ id: 'x', location_id: 'loc-a', relative_path: 'A001/clip.mp4' }] }))).json()
    expect(after.files[0]).toMatchObject({ online: false, reason: 'unknown_location', path: null })
    expect((await api(`/stream?location_id=loc-a&relative_path=${encodeURIComponent('A001/clip.mp4')}`)).status).toBe(403)
    // An empty list (a sign-out) leaves nothing.
    await api('/locations', J({ locations: [] }))
    const empty = await (await api('/resolve', J({ files: [{ id: 'y', location_id: 'loc-b', relative_path: 'a.mov' }] }))).json()
    expect(empty.files[0].reason).toBe('unknown_location')
  })
})

describe('B2\'s fallback, per computer: the folder from this computer\'s settings', () => {
  it('a saved folder for this location and this address is used, and says so', async () => {
    saved.value = { version: 1, locations: { 'loc-a': { unc_path: UNC, local_path: media } } }
    const r = await api('/locations', J({ locations: [{ id: 'loc-a', unc_path: UNC }] }))
    const { locations } = await r.json()
    expect(locations[0]).toMatchObject({ id: 'loc-a', status: 'registered', local_path: media, local_path_source: 'saved', reachable: true, root: media })
  })

  it('the address compares as Windows compares (case), and a re-addressed location drops the folder', async () => {
    saved.value = { version: 1, locations: { 'loc-a': { unc_path: UNC, local_path: media } } }
    const same = await (await api('/locations', J({ locations: [{ id: 'loc-a', unc_path: UNC.toUpperCase() }] }))).json()
    expect(same.locations[0].local_path_source).toBe('saved')
    const moved = await (await api('/locations', J({ locations: [{ id: 'loc-a', unc_path: '\\\\new-nas\\footage' }] }))).json()
    expect(moved.locations[0]).toMatchObject({ local_path: null, local_path_reason: 'address_changed', root: '\\\\new-nas\\footage' })
    expect(saved.value.locations['loc-a']).toBeUndefined()
  })

  it('the dialog for one REGISTERED location saves its folder in this computer\'s settings — not in the process-wide picked set', async () => {
    saved.value = null
    const before = new Set(userAuthorizedDirs)
    // Not registered: refused before any dialog opens.
    dialogAnswer.canceled = false; dialogAnswer.filePaths = [media]
    expect((await api('/locations/loc-x/pick-local', J({ name: 'X' }))).status).toBe(403)
    expect(saved.value).toBeNull()
    await api('/locations', J({ locations: [{ id: 'loc-a', unc_path: UNC }] }))
    const r = await api('/locations/loc-a/pick-local', J({ name: 'Footage NAS' }))
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body).toMatchObject({ id: 'loc-a', unc_path: UNC, local_path: path.resolve(media), local_path_source: 'saved', reachable: true })
    expect(saved.value.locations['loc-a']).toMatchObject({ unc_path: UNC, local_path: path.resolve(media) })
    expect([...userAuthorizedDirs]).toEqual([...before])
    // The clip is read under the chosen folder now.
    const res = await (await api('/resolve', J({ files: [{ id: 'c', location_id: 'loc-a', relative_path: 'A001/clip.mp4' }] }))).json()
    expect(res.files[0].online).toBe(true)
    // …and after a restart (the list registered afresh) it still is.
    await api('/locations', J({ locations: [] }))
    const again = await (await api('/locations', J({ locations: [{ id: 'loc-a', unc_path: UNC }] }))).json()
    expect(again.locations[0]).toMatchObject({ local_path: path.resolve(media), local_path_source: 'saved', reachable: true })
  })

  it('a cancelled dialog saves nothing; a file instead of a folder is refused', async () => {
    saved.value = null
    await api('/locations', J({ locations: [{ id: 'loc-a', unc_path: UNC }] }))
    dialogAnswer.canceled = true; dialogAnswer.filePaths = []
    expect(await (await api('/locations/loc-a/pick-local', J({}))).json()).toEqual({ canceled: true })
    dialogAnswer.canceled = false; dialogAnswer.filePaths = [path.join(media, 'A001', 'clip.mp4')]
    const r = await api('/locations/loc-a/pick-local', J({}))
    expect(r.status).toBe(400)
    expect((await r.json()).code).toBe('not_a_directory')
    expect(saved.value).toBeNull()
  })

  it('forgetting the folder: the clip is read at the network address again', async () => {
    saved.value = { version: 1, locations: { 'loc-a': { unc_path: UNC, local_path: media } } }
    await api('/locations', J({ locations: [{ id: 'loc-a', unc_path: UNC }] }))
    const r = await (await api('/locations/loc-a/local', { method: 'DELETE' })).json()
    expect(r).toMatchObject({ id: 'loc-a', local_path: null, root: UNC })
    expect(saved.value.locations['loc-a']).toBeUndefined()
    const res = await (await api('/resolve', J({ files: [{ id: 'c', location_id: 'loc-a', relative_path: 'A001/clip.mp4' }] }))).json()
    expect(res.files[0].online).toBe(false)
    expect((await api('/locations/nothing-here/local', { method: 'DELETE' })).status).toBe(404)
  })

  it('a body local_path nobody picked is still dropped; the saved folder of ANOTHER location is never borrowed', async () => {
    saved.value = { version: 1, locations: { 'loc-a': { unc_path: UNC, local_path: media } } }
    const r = await (await api('/locations', J({ locations: [{ id: 'loc-z', unc_path: UNC, local_path: other }] }))).json()
    expect(r.locations[0]).toMatchObject({ id: 'loc-z', local_path: null, local_path_reason: 'local_path_not_picked', root: UNC })
    const res = await (await api('/resolve', J({ files: [{ id: 's', location_id: 'loc-z', relative_path: 'secret.mov' }] }))).json()
    expect(res.files[0].online).toBe(false)
  })
})

// ── Adding clips from a location (item 3) ───────────────────────────────────
describe('locateCloudPath (pure): the location a path lies in, and the path inside it', () => {
  const locs = new Map([
    ['L1', { id: 'L1', unc_path: '\\\\SaltHours-NAS\\Footage', local_path: 'Z:\\footage' }],
    ['L2', { id: 'L2', unc_path: '\\\\nas\\vfx', local_path: '/Volumes/vfx' }],
  ])
  it('a network path, case-folded as Windows folds, with forward slashes inside', () => {
    expect(locateCloudPath(locs, '\\\\salthours-nas\\footage\\A001\\T1.mov')).toMatchObject({ location: { id: 'L1' }, relative_path: 'A001/T1.mov' })
  })
  it('this computer\'s folder for a location (B2) first; a POSIX folder the POSIX way', () => {
    expect(locateCloudPath(locs, 'z:\\Footage\\A001\\T1.mov')).toMatchObject({ location: { id: 'L1' }, relative_path: 'A001/T1.mov' })
    expect(locateCloudPath(locs, '/Volumes/vfx/plates/p.0001.exr')).toMatchObject({ location: { id: 'L2' }, relative_path: 'plates/p.0001.exr' })
  })
  it('the location root itself is the empty path; a sibling with the same prefix is NOT inside', () => {
    expect(locateCloudPath(locs, '\\\\nas\\vfx')).toMatchObject({ location: { id: 'L2' }, relative_path: '' })
    expect(locateCloudPath(locs, '\\\\nas\\vfx2\\a.exr')).toBeNull()
    expect(locateCloudPath(locs, 'C:\\Users\\me\\a.mov')).toBeNull()
    expect(locateCloudPath(locs, '/Volumes/vfxother/a.exr')).toBeNull()
  })
  it('shareRootOfPath: the share a network path is on — never this computer, never an administrative share', () => {
    expect(shareRootOfPath('\\\\other-nas\\sound\\day1\\a.wav')).toBe('\\\\other-nas\\sound')
    expect(shareRootOfPath('\\\\localhost\\C$\\Users\\a.mov')).toBeNull()
    expect(shareRootOfPath('\\\\server\\ADMIN$\\a')).toBeNull()
    expect(shareRootOfPath('C:\\x')).toBeNull()
  })
})

describe('adding clips: the dialogs, and the plan by location', () => {
  it('the dialogs open in the main process, at the first location this computer reaches; nothing is added to the picked set', async () => {
    saved.value = { version: 1, locations: { 'loc-a': { unc_path: UNC, local_path: media } } }
    await api('/locations', J({ locations: [{ id: 'loc-a', unc_path: UNC }] }))
    const before = new Set(userAuthorizedDirs)
    dialogAnswer.canceled = false; dialogAnswer.filePaths = [path.join(media, 'A001', 'clip.mp4')]
    dialogCalls.length = 0
    expect(await (await api('/pick-files', J({}))).json()).toEqual({ paths: [path.join(media, 'A001', 'clip.mp4')], canceled: false })
    expect(dialogCalls[0]).toMatchObject({ properties: ['openFile', 'multiSelections'], defaultPath: path.resolve(media) })
    dialogAnswer.filePaths = [path.join(media, 'A001')]
    expect(await (await api('/pick-folder', J({ title: 'Add a folder' }))).json()).toEqual({ path: path.join(media, 'A001'), canceled: false })
    expect([...userAuthorizedDirs]).toEqual([...before])
    expect((await raw('/pick-files', J({}))).status).toBe(403)
  })

  it('a file in a location: its location, its path inside it, the columns this computer reads, the name parser\'s suggestions', async () => {
    saved.value = { version: 1, locations: { 'loc-a': { unc_path: UNC, local_path: media } } }
    await api('/locations', J({ locations: [{ id: 'loc-a', unc_path: UNC }] }))
    const r = await api('/prepare', J({ paths: [path.join(media, 'A001', 'A001C003_240612_R1AB_T4.mov')] }))
    const { items } = await r.json()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      status: 'ok', kind: 'file', location_id: 'loc-a', relative_path: 'A001/A001C003_240612_R1AB_T4.mov',
      original_name: 'A001C003_240612_R1AB_T4.mov', extension: '.mov', media_type: 'video', size_bytes: 64, is_sequence: false,
    })
    expect(items[0].suggestions).toMatchObject({ camera: 'A', roll: 'A001', take_number: 4, confidence: 'high' })
    expect(typeof items[0].mtime).toBe('string')
    expect('duplicate' in items[0]).toBe(false)
  })

  it('a folder: walked inside the location, subfolders as nested bins, a frame sequence as one item', async () => {
    saved.value = { version: 1, locations: { 'loc-a': { unc_path: UNC, local_path: media } } }
    await api('/locations', J({ locations: [{ id: 'loc-a', unc_path: UNC }] }))
    const { items } = await (await api('/prepare', J({ paths: [path.join(media, 'A001'), path.join(media, 'VFX')] }))).json()
    const byRel = Object.fromEntries(items.map(i => [i.relative_path, i]))
    expect(byRel['A001/clip.mp4']).toMatchObject({ status: 'ok', sub_bin: 'A001' })
    expect(byRel['A001/stills/frame.png']).toMatchObject({ status: 'ok', sub_bin: 'A001/stills', media_type: 'still' })
    expect(byRel['VFX/plate_seq']).toMatchObject({ status: 'ok', kind: 'sequence', is_sequence: true, frame_count: 4, sequence_pattern: 'plate.####.exr', sub_bin: 'VFX', media_type: 'sequence' })
    expect(items.every(i => i.location_id === 'loc-a')).toBe(true)
  })

  it('a path outside every location is refused — never walked, never read — and says the share it is on when it is one', async () => {
    saved.value = { version: 1, locations: { 'loc-a': { unc_path: UNC, local_path: media } } }
    await api('/locations', J({ locations: [{ id: 'loc-a', unc_path: UNC }] }))
    const { items } = await (await api('/prepare', J({ paths: [other, path.join(other, 'secret.mov'), '\\\\other-nas\\sound\\day1\\a.wav', '\\\\localhost\\C$\\Users\\x.mov'] }))).json()
    expect(items.map(i => [i.status, i.reason, i.share_root])).toEqual([
      ['outside', 'not_a_share', null],
      ['outside', 'not_a_share', null],
      ['outside', 'no_location', '\\\\other-nas\\sound'],
      ['outside', 'not_a_share', null],
    ])
    // Nothing of the folder or the file was read: no size, no listing.
    expect(items.some(i => 'size_bytes' in i)).toBe(false)
    expect(items.some(i => i.source_path === path.join(other, 'secret.mov') && i.location_id)).toBe(false)
  })

  it('no paths is a 400; the gate stands in front', async () => {
    expect((await api('/prepare', J({ paths: [] }))).status).toBe(400)
    expect((await raw('/prepare', J({ paths: [media] }))).status).toBe(403)
  })
})

// ── Pictures on this computer (item 4) ──────────────────────────────────────
describe('a cloud clip\'s poster on this computer', () => {
  const reg = async () => {
    saved.value = { version: 1, locations: { 'loc-a': { unc_path: UNC, local_path: media } } }
    await api('/locations', J({ locations: [{ id: 'loc-a', unc_path: UNC }] }))
  }
  const q = (rel, extra = '') => `?location_id=loc-a&relative_path=${encodeURIComponent(rel)}${extra}`
  // Postgres writes a stored timestamptz back as "…+00:00"; the disk's is "…Z".
  const asPostgres = (iso) => iso.replace('Z', '+00:00')

  it('a renderer-decoded JPEG goes into THIS computer\'s cache; refused unless a registered, present file, a JPEG, small', async () => {
    await reg()
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)]).toString('base64')
    const r = await api('/thumbnail', J({ location_id: 'loc-a', relative_path: 'A001/clip.mp4', base64: jpeg }))
    expect(await r.json()).toEqual({ ok: true })
    // Served back from the cache by the same key.
    const back = await api(`/thumbnail${q('A001/clip.mp4', '&media_type=video')}`)
    expect(back.status).toBe(200)
    expect(Buffer.from(await back.arrayBuffer()).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
    expect((await api('/thumbnail', J({ location_id: 'nope', relative_path: 'A001/clip.mp4', base64: jpeg }))).status).toBe(403)
    expect((await api('/thumbnail', J({ location_id: 'loc-a', relative_path: 'A001/missing.mp4', base64: jpeg }))).status).toBe(410)
    expect((await api('/thumbnail', J({ location_id: 'loc-a', relative_path: 'A001/clip.mp4', base64: Buffer.from('not a jpeg').toString('base64') }))).status).toBe(415)
    expect((await api('/thumbnail', J({ location_id: 'loc-a', relative_path: 'A001/clip.mp4', base64: Buffer.alloc(300000, 0xff).toString('base64') }))).status).toBe(413)
    expect((await raw('/thumbnail', J({ location_id: 'loc-a', relative_path: 'A001/clip.mp4', base64: jpeg }))).status).toBe(403)
  })

  it('B3: a poster made earlier still shows while the file is out — found by the clip\'s stored time, in Postgres\'s spelling too', async () => {
    await reg()
    const still = path.join(media, 'STILLS', 'set.png')
    const made = await api(`/thumbnail${q('STILLS/set.png', '&media_type=still')}`)
    expect(made.status).toBe(200)
    const mtime = fs.statSync(still).mtime.toISOString()
    // The share goes away (the file moves out of reach).
    fs.renameSync(still, still + '.away')
    try {
      expect((await api(`/thumbnail${q('STILLS/set.png', '&media_type=still')}`)).status).toBe(410)
      const cached = await api(`/thumbnail${q('STILLS/set.png', `&media_type=still&mtime=${encodeURIComponent(asPostgres(mtime))}`)}`)
      expect(cached.status).toBe(200)
      expect(cached.headers.get('content-type')).toBe('image/jpeg')
      // A time that was never cached finds nothing (nothing is made while out).
      expect((await api(`/thumbnail${q('STILLS/set.png', '&mtime=2001-01-01T00:00:00.000Z')}`)).status).toBe(410)
    } finally { fs.renameSync(still + '.away', still) }
  })

  it('a frame sequence\'s poster is keyed by its newest frame (what prepare stores), so the same key serves it offline', async () => {
    await reg()
    const dir = path.join(media, 'STILLS', 'png_seq')
    const { items } = await (await api('/prepare', J({ paths: [dir] }))).json()
    const stored = items[0].mtime
    expect((await api(`/thumbnail${q('STILLS/png_seq', '&is_sequence=true&media_type=sequence')}`)).status).toBe(200)
    fs.renameSync(dir, dir + '_away')
    try {
      const r = await api(`/thumbnail${q('STILLS/png_seq', `&is_sequence=true&media_type=sequence&mtime=${encodeURIComponent(asPostgres(stored))}`)}`)
      expect(r.status).toBe(200)
    } finally { fs.renameSync(dir + '_away', dir) }
  })
})

// ── Open in the default app, reveal (item 5) ────────────────────────────────
describe('"Open in default app" and "Reveal in Explorer", by location + path', () => {
  const reg = async () => {
    saved.value = { version: 1, locations: { 'loc-a': { unc_path: UNC, local_path: media } } }
    await api('/locations', J({ locations: [{ id: 'loc-a', unc_path: UNC }] }))
  }
  it('a clip opens with the OS (what was judged is what opens); reveal shows it in its folder', async () => {
    await reg(); shellCalls.length = 0
    expect(await (await api('/open', J({ location_id: 'loc-a', relative_path: 'A001/clip.mp4' }))).json()).toEqual({ ok: true })
    expect(shellCalls[0][0]).toBe('open')
    expect(shellCalls[0][1].toLowerCase()).toBe(fs.realpathSync(path.join(media, 'A001', 'clip.mp4')).toLowerCase())
    expect(await (await api('/open', J({ location_id: 'loc-a', relative_path: 'A001/clip.mp4', reveal: true }))).json()).toEqual({ ok: true })
    expect(shellCalls[1][0]).toBe('reveal')
  })

  it('a program in a footage folder is never handed to the OS (deny by default)', async () => {
    await reg(); shellCalls.length = 0
    const r = await api('/open', J({ location_id: 'loc-a', relative_path: 'A001/run.mov.cmd' }))
    expect(r.status).toBe(422)
    expect((await r.json()).code).toBe('refused_type')
    expect(shellCalls).toEqual([])
  })

  it('a sequence opens its middle frame; an unregistered location is 403; a missing file 410; the gate stands', async () => {
    await reg(); shellCalls.length = 0
    expect((await api('/open', J({ location_id: 'loc-a', relative_path: 'VFX/plate_seq', is_sequence: true }))).status).toBe(200)
    expect(path.basename(shellCalls[0][1])).toMatch(/^plate\.000[23]\.exr$/)
    expect((await api('/open', J({ location_id: 'nope', relative_path: 'A001/clip.mp4' }))).status).toBe(403)
    expect((await api('/open', J({ location_id: 'loc-a', relative_path: 'A001/missing.mp4' }))).status).toBe(410)
    expect((await api('/open', J({ location_id: 'loc-a', relative_path: '../escape.mp4' }))).status).toBe(403)
    expect((await raw('/open', J({ location_id: 'loc-a', relative_path: 'A001/clip.mp4' }))).status).toBe(403)
  })
})
