// =============================================================================
// rabbitCloudBinsDeadShare.routes.test.js — a footage location whose server
// does not answer (BC2, found on a real network path).
//
// Measured on Windows during the BC2 rehearsal: the first filesystem call on
// a share whose server does not answer is held 5 s for a name that does not
// resolve and 42 s for an address nothing answers. The cloud-bins routes run
// in the desktop's MAIN process, where a synchronous call freezes the whole
// window. What this pins, with fs spied (a promise that never settles stands
// for the dead server, one we settle by hand for a slow one):
//   * registration answers within the limit, the dead location unreachable,
//     the live one reachable — and no SYNCHRONOUS call ever touches a dead
//     share, in any route;
//   * resolve asks a location's ROOT once for the whole list: forty clips of
//     a dead location are "not on this computer" (location_unreachable)
//     without a call of their own;
//   * every per-clip route (probe, both thumbnail routes, open, stream) and
//     prepare answer at once for a dead location;
//   * the add dialog opens at a location that answered, not the first listed;
//   * one question per root is in flight at a time; a root that answers
//     late counts from then on; after the time an answer is kept, a fresh
//     question (a server that comes back, or goes again).
// =============================================================================

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'

const require = createRequire(import.meta.url)
const { mountRabbitBins } = require('../../../../electron/rabbitBins.cjs')

const WAIT_MS = 80
const TTL_MS = 400
const DEAD = '\\\\dead-nas\\footage'
const LIVE = '\\\\live-nas\\footage'
const SLOW = '\\\\slow-nas\\footage'
const under = (p, root) => String(p).toLowerCase().startsWith(root.toLowerCase())

// What touched a dead or slow share, and how.
const calls = { syncDead: [], asyncDead: [], asyncSlow: 0 }
const slow = { next: null }
const realStat = fs.promises.stat.bind(fs.promises)
const realStatSync = fs.statSync
const realExistsSync = fs.existsSync
const realReaddirSync = fs.readdirSync
const recordSync = (name, real) => vi.spyOn(fs, name).mockImplementation((p, ...rest) => {
  if (under(p, DEAD) || under(p, SLOW)) { calls.syncDead.push([name, String(p)]); throw Object.assign(new Error('not here'), { code: 'ENOENT' }) }
  return real.call(fs, p, ...rest)
})

let root, media, thumbDir, server, base
const saved = { value: null }
const cloudBinsLocalPaths = { read: () => (saved.value ? JSON.parse(JSON.stringify(saved.value)) : null), write: (v) => { saved.value = JSON.parse(JSON.stringify(v)) } }
const dialogCalls = []
const dialog = { showOpenDialog: async (_win, opts) => { dialogCalls.push(opts); return { canceled: true, filePaths: [] } } }
const shell = { openPath: async () => '', showItemInFolder: () => {} }
const J = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const api = (p, init = {}) => fetch(`${base}/api/rabbit/cloud-bins${p}`, { ...init, headers: { 'sec-fetch-site': 'same-origin', ...(init.headers || {}) } })
const register = async (locations) => (await (await api('/locations', J({ locations }))).json()).locations
const timed = async (fn) => { const t0 = Date.now(); const v = await fn(); return [v, Date.now() - t0] }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const L_DEAD = { id: 'loc-dead', unc_path: DEAD }
const L_LIVE = { id: 'loc-live', unc_path: LIVE }
const L_SLOW = { id: 'loc-slow', unc_path: SLOW }

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wilson-cloud-bins-dead-'))
  thumbDir = path.join(root, 'thumbs'); fs.mkdirSync(thumbDir)
  media = path.join(root, 'footage'); fs.mkdirSync(path.join(media, 'A001'), { recursive: true })
  fs.writeFileSync(path.join(media, 'A001', 'clip.mp4'), Buffer.alloc(1024, 3))
  // The live location is seen on this computer as a folder (B2's fallback).
  saved.value = { version: 1, locations: { 'loc-live': { unc_path: LIVE, local_path: media } } }
  vi.spyOn(fs.promises, 'stat').mockImplementation((p, ...rest) => {
    if (under(p, DEAD)) { calls.asyncDead.push(String(p)); return new Promise(() => {}) } // a server that never answers
    if (under(p, SLOW)) { calls.asyncSlow++; return slow.next }
    return realStat(p, ...rest)
  })
  recordSync('statSync', realStatSync)
  recordSync('existsSync', realExistsSync)
  recordSync('readdirSync', realReaddirSync)
  const app = express()
  app.use(express.json({ limit: '5mb' }))
  mountRabbitBins(app, {
    readRabbitBundle: () => null, writeRabbitBundle: () => {}, rabbitTouch: (r) => r, rabbitUpsertInto: (a, r) => r, rabbitRemoveFrom: () => false,
    rabbitNotFound: (res) => res.status(404).json({ error: 'not found' }),
    getThumbCacheDir: () => thumbDir,
    generateVideoThumbOnce: async () => ({ ok: false, reason: 'ffmpeg_missing' }),
    safeMediaContentType: (m) => String(m || 'application/octet-stream'),
    userAuthorizedDirs: new Set(), dialog, getMainWindow: () => ({}), shell,
    cloudBinsLocalPaths,
    cloudBinsRootWaitMs: WAIT_MS, cloudBinsRootTtlMs: TTL_MS,
  })
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve) })
  base = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  vi.restoreAllMocks()
  await new Promise(r => server.close(r))
  fs.rmSync(root, { recursive: true, force: true })
})

describe('a footage location whose server does not answer', () => {
  it('registration answers within the limit: the dead location unreachable, the live one reachable', async () => {
    const [locs, ms] = await timed(() => register([L_DEAD, L_LIVE]))
    expect(locs.find(l => l.id === 'loc-dead')).toMatchObject({ status: 'registered', reachable: false, root: DEAD })
    expect(locs.find(l => l.id === 'loc-live')).toMatchObject({ status: 'registered', reachable: true, root: media, local_path_source: 'saved' })
    expect(ms).toBeLessThan(WAIT_MS + 1500)
    expect(calls.syncDead).toEqual([])
  })

  it('resolve asks the root once: forty clips of the dead location are not on this computer, without a call of their own', async () => {
    await register([L_DEAD, L_LIVE])
    const files = Array.from({ length: 40 }, (_, i) => ({ id: `d${i}`, location_id: 'loc-dead', relative_path: `A001/c${i}.mov` }))
      .concat([{ id: 'live', location_id: 'loc-live', relative_path: 'A001/clip.mp4' }])
    const [res, ms] = await timed(async () => (await (await api('/resolve', J({ files }))).json()).files)
    expect(res.filter(f => f.id.startsWith('d')).map(f => [f.online, f.reason])).toEqual(Array(40).fill([false, 'location_unreachable']))
    expect(res.find(f => f.id === 'live')).toMatchObject({ online: true })
    expect(ms).toBeLessThan(WAIT_MS + 1500)
    // Only the ROOT was ever asked, and only once in the whole file so far.
    expect(calls.asyncDead).toEqual([DEAD])
    expect(calls.syncDead).toEqual([])
  })

  it('every per-clip route, and prepare, answer at once for the dead location', async () => {
    await register([L_DEAD, L_LIVE])
    const body = { location_id: 'loc-dead', relative_path: 'A001/c1.mov' }
    const q = 'location_id=loc-dead&relative_path=A001%2Fc1.mov&mtime=2026-10-08T10%3A00%3A00.000Z'
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]).toString('base64')
    const [codes, ms] = await timed(async () => [
      (await api('/probe', J(body))).status,
      (await api('/thumbnail', J({ ...body, base64: jpeg }))).status,
      (await api(`/thumbnail?${q}`)).status,
      (await api('/open', J(body))).status,
      (await api(`/stream?${q}`)).status,
    ])
    expect(codes).toEqual([410, 410, 410, 410, 410])
    const [prep, ms2] = await timed(async () => (await (await api('/prepare', J({ paths: [`${DEAD}\\A001\\c1.mov`, `${DEAD}\\VFX`] }))).json()).items)
    expect(prep.map(i => i.status)).toEqual(['missing', 'missing'])
    expect(ms + ms2).toBeLessThan(1500)
    expect(calls.asyncDead).toEqual([DEAD])
    expect(calls.syncDead).toEqual([])
  })

  it('the add dialog opens at a location that answered, not at the first one listed', async () => {
    await register([L_DEAD, L_LIVE])
    const [, ms] = await timed(() => api('/pick-files', J({})))
    expect(dialogCalls.at(-1).defaultPath).toBe(media)
    await api('/pick-folder', J({ title: 'Add a folder' }))
    expect(dialogCalls.at(-1).defaultPath).toBe(media)
    expect(ms).toBeLessThan(1500)
    expect(calls.syncDead).toEqual([])
  })
})

describe('a slow server: one question in flight, a late answer counts, a kept answer expires', () => {
  it('asked once while it has not answered; reachable from the moment it does; asked afresh after the time kept', async () => {
    let answer
    slow.next = new Promise(r => { answer = r })
    const first = await register([L_SLOW])
    expect(first[0].reachable).toBe(false) // the limit passed
    expect(calls.asyncSlow).toBe(1)
    await sleep(TTL_MS + 50) // even past the time kept: the first question is still out
    expect((await register([L_SLOW]))[0].reachable).toBe(false)
    expect(calls.asyncSlow).toBe(1)
    answer({ isDirectory: () => true })
    await sleep(10)
    expect((await register([L_SLOW]))[0].reachable).toBe(true) // the late answer, no new question
    expect(calls.asyncSlow).toBe(1)
    await sleep(TTL_MS + 50)
    slow.next = Promise.resolve({ isDirectory: () => false }) // gone again
    expect((await register([L_SLOW]))[0].reachable).toBe(false)
    expect(calls.asyncSlow).toBe(2)
    expect(calls.syncDead).toEqual([])
  })
})
