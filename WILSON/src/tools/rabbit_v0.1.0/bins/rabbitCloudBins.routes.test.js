// =============================================================================
// rabbitCloudBins.routes.test.js — the desktop SIGNED IN reads a cloud clip by
// its location's network address + its relative path (Bins on the cloud, BC1,
// migration 0091; electron/rabbitBins.cjs, the cloud-bins routes BC2 builds
// on). The same harness as rabbitBins.routes.test.js: a real Express app on
// an ephemeral port, the real module, real files in a temp folder.
//
// What this pins:
//   * the pure shapes — isUncPath is 0091's unc_path CHECK, isSafeRelativePath
//     its relative_path CHECK, and resolveCloudFilePath joins them without
//     ever leaving the location (a traversal, an absolute path, an unknown
//     location all answer null);
//   * REGISTRATION is the authorisation: a location is accepted only as a
//     network address (a drive letter is refused by name — a body can never
//     make C:\Users a root, the S14 rule), and a per-computer local path is
//     kept only when it is a folder the person picked through the OS dialog
//     this session (`userAuthorizedDirs`), else dropped with its reason;
//   * resolve / stream / thumbnail / probe answer by location + path, refuse
//     an unregistered location (403) and a missing file (410), and the
//     same-origin gate stands in front of all of them;
//   * B12: none of this touches the project bundle (the store is read back
//     unchanged).
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'

const require = createRequire(import.meta.url)
const bins = require('../../../../electron/rabbitBins.cjs')
const { mountRabbitBins, isUncPath, isSafeRelativePath, resolveCloudFilePath } = bins
const FFMPEG = require('../../../../electron/ffmpeg.cjs').hasFfmpeg()

// ── the fakes (rabbitBins.routes.test.js's) ─────────────────────────────────
const store = new Map()
const readRabbitBundle = (id) => (store.has(id) ? JSON.parse(store.get(id)) : null)
const writeRabbitBundle = (id, bundle) => { store.set(id, JSON.stringify(bundle)) }
const { randomUUID } = require('node:crypto')
function rabbitTouch(row) { const now = new Date().toISOString(); if (!row.id) row.id = randomUUID(); if (!row.created_at) row.created_at = now; row.updated_at = now; return row }
function rabbitUpsertInto(arr, row) { const i = arr.findIndex(x => x.id === row.id); if (i >= 0) { arr[i] = { ...arr[i], ...row }; return arr[i] } arr.push(row); return row }
function rabbitRemoveFrom(arr, id) { const i = arr.findIndex(x => x.id === id); if (i < 0) return false; arr.splice(i, 1); return true }
function rabbitNotFound(res, what = 'project') { return res.status(404).json({ error: `${what} not found` }) }
const SAFE_MEDIA_TYPE_RE = /^(video|audio|image)\/[a-z0-9][a-z0-9.+-]*$/
function safeMediaContentType(mime) { const m = String(mime || '').trim().toLowerCase(); return SAFE_MEDIA_TYPE_RE.test(m) && m !== 'image/svg+xml' ? m : 'application/octet-stream' }

let root, media, thumbDir, server, base
const userAuthorizedDirs = new Set()
const J = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const raw = (p, init) => fetch(`${base}/api/rabbit/cloud-bins${p}`, init)
const api = (p, init = {}) => raw(p, { ...init, headers: { 'sec-fetch-site': 'same-origin', ...(init.headers || {}) } })

const LOC = 'loc-nas'
const UNC = '\\\\salthours-nas\\footage'

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wilson-cloud-bins-'))
  thumbDir = path.join(root, 'thumbs'); fs.mkdirSync(thumbDir)
  media = path.join(root, 'footage'); fs.mkdirSync(media)
  const sharp = require('sharp')
  fs.mkdirSync(path.join(media, 'A001'))
  await sharp({ create: { width: 64, height: 32, channels: 3, background: '#ea580c' } }).png().toFile(path.join(media, 'A001', 'still.png'))
  fs.writeFileSync(path.join(media, 'A001', 'clip.mp4'), Buffer.alloc(2048, 7))
  fs.writeFileSync(path.join(media, 'A001', 'tone.wav'), Buffer.alloc(512, 1))
  const seq = path.join(media, 'VFX', 'plate_seq'); fs.mkdirSync(seq, { recursive: true })
  for (let i = 1; i <= 5; i++) {
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toFile(path.join(seq, `plate.${String(i).padStart(4, '0')}.png`))
  }
  store.set('proj-1', JSON.stringify({ project: { id: 'proj-1', title: 'Cloud Bins', fps: 25 }, scenes: [], shots: [], bins: [], binFiles: [], binRoots: [], shotTakes: [] }))

  const app = express()
  app.use(express.json({ limit: '5mb' }))
  mountRabbitBins(app, {
    readRabbitBundle, writeRabbitBundle, rabbitTouch, rabbitUpsertInto, rabbitRemoveFrom, rabbitNotFound,
    getThumbCacheDir: () => thumbDir,
    generateVideoThumbOnce: async () => ({ ok: false, reason: 'ffmpeg_missing' }),
    safeMediaContentType,
    userAuthorizedDirs, dialog: null, getMainWindow: () => null,
  })
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve) })
  base = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  await new Promise(resolve => server.close(resolve))
  fs.rmSync(root, { recursive: true, force: true })
})

// ── the pure shapes ─────────────────────────────────────────────────────────
describe('the shapes 0091 refuses, refused here too', () => {
  it('isUncPath: a network address with a share, nothing else', () => {
    for (const ok of ['\\\\nas\\footage', '\\\\nas\\footage\\2026', '\\\\10.0.0.5\\share']) expect(isUncPath(ok), ok).toBe(true)
    for (const bad of ['Z:\\footage', 'C:\\Users', '//nas/footage', '\\\\nas', '\\\\nas\\footage\\', '\\\\nas\\footage\\..\\secret', '\\\\nas\\.\\x', '', null, 42, '\\\\nas\\foo:bar']) expect(isUncPath(bad), String(bad)).toBe(false)
  })

  it('isUncPath: never an administrative share, never the loopback host (review round 1 — \\\\localhost\\C$ is C: in disguise)', () => {
    for (const bad of ['\\\\localhost\\C$', '\\\\LOCALHOST\\c$\\Users', '\\\\127.0.0.1\\C$', '\\\\127.0.0.1\\footage', '\\\\0.0.0.0\\share',
      '\\\\server\\C$\\Windows', '\\\\server\\d$', '\\\\server\\ADMIN$', '\\\\server\\ipc$']) expect(isUncPath(bad), bad).toBe(false)
    // A hidden share that is not administrative is an ordinary share, and so
    // is one whose name merely starts with a letter and a dollar.
    for (const ok of ['\\\\nas\\footage$', '\\\\nas\\c$footage', '\\\\127-nas\\footage', '\\\\localhost2\\share']) expect(isUncPath(ok), ok).toBe(true)
  })

  it('isUncPath, round 2: a segment ending in a dot or a space is refused (Windows strips both — \\\\server\\C$. is C$), and the loopback arm knows every spelling of 127.0.0.1', () => {
    for (const bad of ['\\\\server\\C$.', '\\\\server\\C$ \\Windows', '\\\\server\\C$ ', '\\\\server\\ADMIN$.', '\\\\nas\\footage.', '\\\\nas\\footage \\day1', '\\\\localhost.\\footage',
      '\\\\127.1\\footage', '\\\\127.0.0.1.\\footage', '\\\\2130706433\\footage', '\\\\0177.0.0.1\\footage', '\\\\0x7f.0.0.1\\footage', '\\\\0.0.0.0\\footage', '\\\\127\\footage']) expect(isUncPath(bad), bad).toBe(false)
    for (const ok of ['\\\\10.0.0.5\\share', '\\\\nas-01.corp.local\\footage', '\\\\3com-nas\\share', '\\\\nas\\day 1\\footage', '\\\\nas\\v1.2\\footage']) expect(isUncPath(ok), ok).toBe(true)
  })

  it('isSafeRelativePath, round 2: a segment ending in a dot or a space is refused (".. " is ".." to Windows)', () => {
    for (const bad of ['.. /secret.mov', 'a/.. /b.mov', 'a/. /b.mov', 'clip.mov.', 'A001 /clip.mov', 'A001/clip.mov ', '.. ']) expect(isSafeRelativePath(bad), bad).toBe(false)
    for (const ok of ['A001/clip.mov', 'day 1/clip.mov', 'a.b/c.d', 'VFX/plate_seq', '.hidden/clip.mov']) expect(isSafeRelativePath(ok), ok).toBe(true)
  })

  it('isSafeRelativePath: forward slashes inside the location, never out of it', () => {
    for (const ok of ['A001/clip.mov', 'clip.mov', 'VFX/plate_seq', 'a b/c d.png']) expect(isSafeRelativePath(ok), ok).toBe(true)
    for (const bad of ['/clip.mov', 'A001/', 'A001//clip.mov', '../clip.mov', 'a/../b.mov', 'a/./b', 'C:/x.mov', 'a\\b.mov', '', null]) expect(isSafeRelativePath(bad), String(bad)).toBe(false)
  })

  it('resolveCloudFilePath joins the location root and the path, and refuses what would escape', () => {
    const locs = new Map([[LOC, { id: LOC, unc_path: UNC, local_path: null }]])
    expect(resolveCloudFilePath(locs, LOC, 'A001/clip.mov')).toBe('\\\\salthours-nas\\footage\\A001\\clip.mov')
    expect(resolveCloudFilePath(locs, LOC, '../clip.mov')).toBeNull()
    expect(resolveCloudFilePath(locs, LOC, 'C:/clip.mov')).toBeNull()
    expect(resolveCloudFilePath(locs, 'nope', 'A001/clip.mov')).toBeNull()
    // The per-computer fallback (B2): the share seen as a local folder.
    const withLocal = new Map([[LOC, { id: LOC, unc_path: UNC, local_path: 'Z:\\footage' }]])
    expect(resolveCloudFilePath(withLocal, LOC, 'A001/clip.mov')).toBe('Z:\\footage\\A001\\clip.mov')
  })

  it('the root\'s shape chooses the path rules, not the computer: a POSIX root joins the POSIX way on Windows, a Windows root the Windows way on Linux', () => {
    // CI runs this file on Linux against a POSIX temp folder; a Mac desktop
    // mounts the share at /Volumes/footage. The first version joined every
    // root with path.win32 and contained it with the platform's resolve, so
    // on Linux a POSIX root became \tmp\...\A001\clip.mp4, failed containment
    // and every route answered 403.
    const posixRoot = new Map([[LOC, { id: LOC, unc_path: UNC, local_path: '/Volumes/footage' }]])
    expect(resolveCloudFilePath(posixRoot, LOC, 'A001/clip.mov')).toBe('/Volumes/footage/A001/clip.mov')
    expect(resolveCloudFilePath(posixRoot, LOC, 'VFX/plate_seq')).toBe('/Volumes/footage/VFX/plate_seq')
    expect(resolveCloudFilePath(posixRoot, LOC, 'a/../../clip.mov')).toBeNull()
    // A Windows root keeps Windows rules on every platform: a drive letter
    // written with forward slashes, a network address with a trailing
    // backslash (what path.resolve gives a registered UNC local_path).
    const drive = new Map([[LOC, { id: LOC, unc_path: UNC, local_path: 'z:/footage' }]])
    expect(resolveCloudFilePath(drive, LOC, 'A001/clip.mov')).toBe('z:\\footage\\A001\\clip.mov')
    const trailing = new Map([[LOC, { id: LOC, unc_path: UNC, local_path: '\\\\salthours-nas\\footage\\' }]])
    expect(resolveCloudFilePath(trailing, LOC, 'A001/clip.mov')).toBe('\\\\salthours-nas\\footage\\A001\\clip.mov')
    // Containment is case-folded only where the filesystem is: a Windows
    // root admits a path spelt in another case, a POSIX root does not care
    // because its join never changes case either way.
    const upper = new Map([[LOC, { id: LOC, unc_path: '\\\\SALTHOURS-NAS\\Footage', local_path: null }]])
    expect(resolveCloudFilePath(upper, LOC, 'A001/clip.mov')).toBe('\\\\SALTHOURS-NAS\\Footage\\A001\\clip.mov')
  })
})

// ── the routes ──────────────────────────────────────────────────────────────
describe('registering a company\'s locations', () => {
  it('the gate: a request without the renderer\'s header is refused', async () => {
    const r = await raw('/locations', J({ locations: [] }))
    expect(r.status).toBe(403)
    expect((await r.json()).code).toBe('cross_origin')
  })

  it('a drive letter is refused by name — a body cannot make a local folder a root', async () => {
    const r = await api('/locations', J({ locations: [{ id: 'bad', unc_path: 'C:\\Users' }] }))
    expect(r.status).toBe(200)
    const { locations } = await r.json()
    expect(locations[0]).toMatchObject({ id: 'bad', status: 'refused', reason: 'not_a_network_address' })
    const res = await api('/resolve', J({ files: [{ id: 'f', location_id: 'bad', relative_path: 'x' }] }))
    expect((await res.json()).files[0]).toMatchObject({ online: false, reason: 'unknown_location' })
  })

  it('a network address registers, unreachable from this test machine, and a local_path nobody picked is dropped with its reason', async () => {
    const r = await api('/locations', J({ locations: [{ id: LOC, unc_path: UNC, local_path: media }] }))
    const { locations } = await r.json()
    expect(locations[0]).toMatchObject({ id: LOC, unc_path: UNC, status: 'registered', local_path: null, local_path_reason: 'local_path_not_picked', root: UNC })
    expect(typeof locations[0].reachable).toBe('boolean')
  })

  it('a local_path the person PICKED this session is kept, and the location becomes reachable', async () => {
    userAuthorizedDirs.add(media.toLowerCase())
    const r = await api('/locations', J({ locations: [{ id: LOC, unc_path: UNC, local_path: media }] }))
    const { locations } = await r.json()
    expect(locations[0]).toMatchObject({ id: LOC, status: 'registered', reachable: true })
    expect(locations[0].local_path.toLowerCase()).toBe(path.resolve(media).toLowerCase())
  })

  it('resolve: what this computer can reach, by location + path', async () => {
    const r = await api('/resolve', J({ files: [
      { id: 'a', location_id: LOC, relative_path: 'A001/clip.mp4' },
      { id: 'b', location_id: LOC, relative_path: 'A001/missing.mov' },
      { id: 'c', location_id: LOC, relative_path: '../escape.mov' },
      { id: 'd', location_id: LOC, relative_path: 'VFX/plate_seq', is_sequence: true },
    ] }))
    const { files } = await r.json()
    expect(files[0]).toMatchObject({ id: 'a', online: true })
    expect(files[0].path.toLowerCase()).toBe(path.join(media, 'A001', 'clip.mp4').toLowerCase())
    expect(files[1]).toMatchObject({ id: 'b', online: false })
    expect(files[2]).toMatchObject({ id: 'c', online: false, reason: 'bad_path', path: null })
    expect(files[3]).toMatchObject({ id: 'd', online: true })
  })
})

describe('bytes, posters and columns by location + path', () => {
  const q = (rel, extra = '') => `?location_id=${encodeURIComponent(LOC)}&relative_path=${encodeURIComponent(rel)}${extra}`

  it('stream: an unregistered location is 403, a missing file 410, a present one streams with a Range', async () => {
    expect((await api(`/stream?location_id=nope&relative_path=${encodeURIComponent('A001/clip.mp4')}`)).status).toBe(403)
    expect((await api(`/stream${q('A001/missing.mov')}`)).status).toBe(410)
    const full = await api(`/stream${q('A001/clip.mp4')}`)
    expect(full.status).toBe(200)
    expect(full.headers.get('content-type')).toBe('video/mp4')
    expect(full.headers.get('x-content-type-options')).toBe('nosniff')
    expect((await full.arrayBuffer()).byteLength).toBe(2048)
    const part = await api(`/stream${q('A001/clip.mp4')}`, { headers: { range: 'bytes=0-99' } })
    expect(part.status).toBe(206)
    expect((await part.arrayBuffer()).byteLength).toBe(100)
  })

  it('stream: a sequence streams its middle frame; a traversal is refused', async () => {
    const r = await api(`/stream${q('VFX/plate_seq', '&is_sequence=true')}`)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('image/png')
    expect((await api(`/stream${q('../escape.mov')}`)).status).toBe(403)
  })

  it('thumbnail: a still is drawn by sharp and cached; audio has none; a video without a decoder says so', async () => {
    const r = await api(`/thumbnail${q('A001/still.png')}`)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('image/jpeg')
    expect(fs.readdirSync(thumbDir).some(f => f.startsWith('bin-') && f.endsWith('.jpg'))).toBe(true)
    expect((await api(`/thumbnail${q('A001/tone.wav')}`)).status).toBe(415)
    const v = await api(`/thumbnail${q('A001/clip.mp4')}`)
    // The fake generateVideoThumbOnce answers ffmpeg_missing; with a real
    // binary the route reports the decode's own verdict.
    expect([415, 422]).toContain(v.status)
    expect((await api(`/thumbnail${q('A001/missing.png')}`)).status).toBe(410)
  })

  it('probe: a still\'s dimensions are read on this computer; a missing file is 410', async () => {
    const r = await api('/probe', J({ location_id: LOC, relative_path: 'A001/still.png', media_type: 'still', extension: '.png', fps: 25 }))
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body).toMatchObject({ width: 64, height: 32, probe_status: 'done', online: true })
    expect((await api('/probe', J({ location_id: LOC, relative_path: 'A001/missing.png' }))).status).toBe(410)
    expect((await api('/probe', J({ location_id: 'nope', relative_path: 'A001/still.png' }))).status).toBe(403)
    const seq = await api('/probe', J({ location_id: LOC, relative_path: 'VFX/plate_seq', is_sequence: true, media_type: 'sequence', extension: '.png', fps: 25 }))
    expect(await seq.json()).toMatchObject({ frame_count: 5, fps: 25, online: true })
  })

  it('B12: none of it touched the project bundle', () => {
    const b = JSON.parse(store.get('proj-1'))
    expect(b.bins).toEqual([])
    expect(b.binFiles).toEqual([])
    expect(b.binRoots).toEqual([])
  })

  it(`states its ffmpeg: ${FFMPEG ? 'present' : 'absent'} on this machine`, () => {
    expect(typeof FFMPEG).toBe('boolean')
  })
})
