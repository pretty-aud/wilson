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
const { mountRabbitBins } = require('../../../../electron/rabbitBins.cjs')

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
const dialog = { showOpenDialog: async () => ({ ...dialogAnswer }) }

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
  const app = express()
  app.use(express.json({ limit: '5mb' }))
  mountRabbitBins(app, {
    readRabbitBundle, writeRabbitBundle, rabbitTouch, rabbitUpsertInto, rabbitRemoveFrom, rabbitNotFound,
    getThumbCacheDir: () => thumbDir,
    generateVideoThumbOnce: async () => ({ ok: false, reason: 'ffmpeg_missing' }),
    safeMediaContentType,
    userAuthorizedDirs, dialog, getMainWindow: () => ({}), shell: null,
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
