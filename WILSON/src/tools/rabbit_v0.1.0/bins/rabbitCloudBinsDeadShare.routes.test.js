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
const OFF_TTL_MS = 800
const DEAD = '\\\\dead-nas\\footage'
const LIVE = '\\\\live-nas\\footage'
const SLOW = '\\\\slow-nas\\footage'
// Review round 1: a share nobody on this computer agreed to connect to (a
// row any member can write). It answers as a live share would — once it may
// be asked at all.
const STRANGER = '\\\\stranger-nas\\footage'
const under = (p, root) => String(p).toLowerCase().startsWith(root.toLowerCase())

// What touched a dead, slow or stranger share, and how.
const calls = { syncDead: [], asyncDead: [], asyncSlow: 0, stranger: [] }
const slow = { next: null }
const hangs = []
const releaseHangs = () => { while (hangs.length) hangs.shift()() }
const realStat = fs.promises.stat.bind(fs.promises)
const realStatSync = fs.statSync
const realExistsSync = fs.existsSync
const realReaddirSync = fs.readdirSync
const recordSync = (name, real) => vi.spyOn(fs, name).mockImplementation((p, ...rest) => {
  if (under(p, STRANGER)) { calls.stranger.push([name, String(p)]); throw Object.assign(new Error('not here'), { code: 'ENOENT' }) }
  if (under(p, DEAD) || under(p, SLOW)) { calls.syncDead.push([name, String(p)]); throw Object.assign(new Error('not here'), { code: 'ENOENT' }) }
  return real.call(fs, p, ...rest)
})

let root, media, thumbDir, server, base
const saved = { value: null }
const cloudBinsLocalPaths = { read: () => (saved.value ? JSON.parse(JSON.stringify(saved.value)) : null), write: (v) => { saved.value = JSON.parse(JSON.stringify(v)) } }
const dialogCalls = []
const dialogNext = { open: null, message: 1 } // open: filePaths or null (cancel); message: the button index pressed
const messageCalls = []
const dialog = {
  showOpenDialog: async (_win, opts) => { dialogCalls.push(opts); const p = dialogNext.open; dialogNext.open = null; return p ? { canceled: false, filePaths: p } : { canceled: true, filePaths: [] } },
  showMessageBox: async (_win, opts) => { messageCalls.push(opts); return { response: dialogNext.message } },
}
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
  // The live location is seen on this computer as a folder (B2's fallback);
  // the dead and slow ones are addresses this computer's person agreed to.
  saved.value = {
    version: 1,
    locations: { 'loc-live': { unc_path: LIVE, local_path: media } },
    connected: Object.fromEntries([DEAD, SLOW, `${DEAD}2`, `${DEAD}3`, `${DEAD}4`, `${DEAD}5`].map(u => [u.toLowerCase(), { unc_path: u }])),
  }
  vi.spyOn(fs.promises, 'stat').mockImplementation((p, ...rest) => {
    if (under(p, STRANGER)) { calls.stranger.push(['stat', String(p)]); return Promise.resolve({ isDirectory: () => String(p).toLowerCase() === STRANGER.toLowerCase(), isFile: () => /\.\w+$/.test(String(p)), mtime: new Date(0) }) }
    if (under(p, DEAD)) { calls.asyncDead.push(String(p)); return new Promise(() => {}) } // a server that never answers
    if (under(p, SLOW)) {
      // The root answers as the test says; one file under it is there
      // (here.mov), any other is not.
      if (String(p).toLowerCase() === SLOW.toLowerCase()) { calls.asyncSlow++; return slow.next }
      if (String(p).endsWith('here.mov')) return Promise.resolve({ isFile: () => true, isDirectory: () => false, mtime: new Date(0) })
      // A clip check that is not answered until the test lets it go.
      if (/hang\d*\.mov$/.test(String(p))) { calls.hangStarted = (calls.hangStarted || 0) + 1; return new Promise((_, rej) => hangs.push(() => rej(Object.assign(new Error('gone'), { code: 'ENOENT' })))) }
      return Promise.reject(Object.assign(new Error('not here'), { code: 'ENOENT' }))
    }
    return realStat(p, ...rest)
  })
  vi.spyOn(fs.promises, 'realpath').mockImplementation(async (p) => {
    if (under(p, STRANGER)) calls.stranger.push(['realpath', String(p)])
    return String(p)
  })
  recordSync('statSync', realStatSync)
  recordSync('existsSync', realExistsSync)
  recordSync('readdirSync', realReaddirSync)
  // A mapped drive's real path is asked off the main thread (review round 1).
  calls.syncRealpath = []
  vi.spyOn(fs.realpathSync, 'native').mockImplementation((p) => { calls.syncRealpath.push(String(p)); return String(p) })
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
    cloudBinsRootWaitMs: WAIT_MS, cloudBinsRootTtlMs: TTL_MS, cloudBinsRootOffTtlMs: OFF_TTL_MS,
    // The cap's mechanism, at four (the desktop's default is sixteen).
    cloudBinsRootMaxAsking: 4,
    // The root question through the spied fs.promises.stat: the desktop's own
    // asks it in a worker thread, whose fs no spy here reaches (that one is
    // held by rabbitCloudBinsDesktop.routes.test.js, on real folders).
    cloudBinsAskRoot: (root) => fs.promises.stat(root).then((s) => s.isDirectory(), () => false),
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
    expect((await register([L_SLOW]))[0].reachable).toBe(false) // it WAS reachable: waited for
    expect(calls.asyncSlow).toBe(2)
    expect(calls.syncDead).toEqual([])
  })

  it('a location known to be off answers at once when its answer is due again, and is asked again behind it', async () => {
    calls.asyncSlow = 0
    // Known off now (the last answer above). An "off" answer is kept longer
    // than an "on" one (review round 1): not yet due after TTL_MS…
    await sleep(TTL_MS + 50)
    expect((await register([L_SLOW]))[0].reachable).toBe(false)
    expect(calls.asyncSlow).toBe(0)
    // …due after OFF_TTL_MS:
    await sleep(OFF_TTL_MS - TTL_MS)
    let back
    slow.next = new Promise(r => { back = r })
    const [again, ms] = await timed(() => register([L_SLOW]))
    expect(again[0].reachable).toBe(false)
    expect(ms).toBeLessThan(WAIT_MS) // not the limit: answered at once
    expect(calls.asyncSlow).toBe(1) // …and asked again, behind the answer
    back({ isDirectory: () => true }) // the server is back
    await sleep(10)
    expect((await register([L_SLOW]))[0].reachable).toBe(true)
    expect(calls.asyncSlow).toBe(1)
    expect(calls.syncDead).toEqual([])
  })
})

// Review round 1, finding 3: once a root has answered, the routes still
// touch the share — the file, its time, its real path — and a server that
// dies in between must not freeze the window: those calls are asynchronous.
describe('after a root answered: the share is touched only off the main thread', () => {
  it('stream, open, probe and both poster routes for a clip on it make no synchronous call; a drive letter\'s real path is asked off-thread', async () => {
    slow.next = Promise.resolve({ isDirectory: () => true })
    await sleep(OFF_TTL_MS + 50)
    expect((await register([L_SLOW]))[0].reachable).toBe(true)
    calls.syncDead.length = 0
    const body = { location_id: 'loc-slow', relative_path: 'A001/c1.mov' }
    const q = 'location_id=loc-slow&relative_path=A001%2Fc1.mov'
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]).toString('base64')
    expect([
      (await api(`/stream?${q}`)).status,
      (await api('/open', J(body))).status,
      (await api('/probe', J(body))).status,
      (await api(`/thumbnail?${q}`)).status,
      (await api('/thumbnail', J({ ...body, base64: jpeg }))).status,
    ]).toEqual([410, 410, 410, 410, 410])
    // A clip that IS there: its poster is keyed by its time, read off-thread
    // (no decoder in this test: refused after the key, never a sync call).
    const made = await api('/thumbnail?location_id=loc-slow&relative_path=A001%2Fhere.mov&media_type=video')
    expect([415, 422]).toContain(made.status)
    expect(calls.syncDead).toEqual([])
    // A clip whose own check is never answered (the server died after its
    // root answered): 410 within the limit, and the ROOT is marked off at
    // once — the next clip on it is not asked.
    const [hang, hangMs] = await timed(async () => (await api('/stream?location_id=loc-slow&relative_path=A001%2Fhang.mov')).status)
    expect(hang).toBe(410)
    expect(hangMs).toBeLessThan(WAIT_MS + 1500)
    expect((await register([L_SLOW]))[0].reachable).toBe(false)
    releaseHangs()
    // A path on a drive letter outside every location: refused by name, its
    // real path asked asynchronously (a disconnected mapped drive).
    const items = (await (await api('/prepare', J({ paths: ['Q:\\footage\\x.mov'] }))).json()).items
    expect(items[0].status).toBe('outside')
    expect(calls.syncRealpath).toEqual([])
  })
})

// Review round 2: per-clip checks share libuv's pool with the app's own
// files — at most two out at once; one slow clip marks its root off only
// briefly (as long as an "on" answer is kept), not for the full off time.
describe('review round 2: clip checks on the shared pool', () => {
  it('one slow clip marks its root off briefly: asked again after the "on" keep time, not the "off" one', async () => {
    calls.asyncSlow = 0
    await sleep(TTL_MS + 50) // the brief off from the hang above is due again (OFF_TTL_MS is longer)
    expect((await register([L_SLOW]))[0].reachable).toBe(false) // known off: answered at once…
    await sleep(20)
    expect(calls.asyncSlow).toBe(1) // …and asked again behind it
    expect((await register([L_SLOW]))[0].reachable).toBe(true)
  })

  it('at most two clip checks are out at once; the others wait, and say "not here" without marking a root off', async () => {
    calls.hangStarted = 0
    const one = (n) => api(`/stream?location_id=loc-slow&relative_path=A001%2Fhang${n}.mov`).then(r => r.status)
    const codes = await Promise.all([one(2), one(3), one(4), one(5)])
    expect(codes).toEqual([410, 410, 410, 410])
    expect(calls.hangStarted).toBe(2)
    releaseHangs()
    await sleep(20)
    expect(calls.hangStarted).toBe(2) // the two that waited never asked
    expect(calls.syncDead).toEqual([])
  })
})

// Review round 1, finding 1: any member can name or re-address a company
// location, and every teammate's desktop registers the list. Without this
// computer's person agreeing, nothing here may touch the address — or a
// row could make every desktop connect, with its person's Windows sign-in,
// to a host of the row-writer's choosing.
describe('an address this computer\'s person has not agreed to', () => {
  const L_STRANGER = { id: 'loc-stranger', unc_path: STRANGER }

  it('is never contacted: registration says so; resolve, every route and prepare answer without touching it; the add dialog does not open there', async () => {
    calls.stranger.length = 0
    const locs = await register([L_STRANGER, L_LIVE])
    expect(locs[0]).toMatchObject({ status: 'registered', connected: false, reachable: false })
    expect(locs[1]).toMatchObject({ connected: true, reachable: true })
    const files = [{ id: 's1', location_id: 'loc-stranger', relative_path: 'A001/c1.mov' }, { id: 's2', location_id: 'loc-stranger', relative_path: 'VFX/plate', is_sequence: true }]
    const res = (await (await api('/resolve', J({ files }))).json()).files
    expect(res.map(f => [f.online, f.reason])).toEqual([[false, 'not_connected'], [false, 'not_connected']])
    const body = { location_id: 'loc-stranger', relative_path: 'A001/c1.mov' }
    const q = 'location_id=loc-stranger&relative_path=A001%2Fc1.mov'
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]).toString('base64')
    expect([
      (await api('/probe', J(body))).status,
      (await api('/thumbnail', J({ ...body, base64: jpeg }))).status,
      (await api(`/thumbnail?${q}`)).status,
      (await api('/open', J(body))).status,
      (await api(`/stream?${q}`)).status,
    ]).toEqual([410, 410, 410, 410, 410])
    const prep = (await (await api('/prepare', J({ paths: [`${STRANGER}\\A001\\c1.mov`] }))).json()).items
    expect(prep.map(i => i.status)).toEqual(['missing'])
    await api('/pick-files', J({}))
    expect(dialogCalls.at(-1).defaultPath).toBe(media)
    expect(calls.stranger).toEqual([])
  })

  it('Connect asks natively, naming the address the cloud holds (never a name a page sends), Cancel by default; Connect keeps it and asks it at once', async () => {
    calls.stranger.length = 0
    await register([L_STRANGER])
    expect((await api('/locations/nope/connect', J({}))).status).toBe(403)
    dialogNext.message = 1 // Cancel
    expect(await (await api('/locations/loc-stranger/connect', J({ name: 'Trusted company NAS' }))).json()).toEqual({ canceled: true })
    const m = messageCalls.at(-1)
    expect(m).toMatchObject({ type: 'question', buttons: ['Connect', 'Cancel'], defaultId: 1, cancelId: 1, message: `Connect this computer to ${STRANGER}?` })
    expect(m.detail).toContain('Windows sign-in')
    expect(JSON.stringify(m)).not.toContain('Trusted company NAS')
    expect(calls.stranger).toEqual([])
    expect(saved.value.connected?.[STRANGER.toLowerCase()]).toBeUndefined()
    dialogNext.message = 0 // Connect
    expect(await (await api('/locations/loc-stranger/connect', J({}))).json()).toMatchObject({ id: 'loc-stranger', connected: true, reachable: true, root: STRANGER })
    expect(saved.value.connected[STRANGER.toLowerCase()]).toMatchObject({ unc_path: STRANGER })
    expect(calls.stranger).toEqual([['stat', STRANGER]])
    // From now on it is a location like any other on this computer; no
    // second question.
    const asked = messageCalls.length
    expect((await register([L_STRANGER]))[0]).toMatchObject({ connected: true, reachable: true })
    await api('/locations/loc-stranger/connect', J({}))
    expect(messageCalls.length).toBe(asked)
  })

  it('review round 2: forgetting this computer\'s folder for a location never contacts an address not agreed to', async () => {
    const S9 = `${STRANGER}9`
    calls.stranger.length = 0
    await register([{ id: 'loc-s9', unc_path: S9 }])
    const r = await (await api('/locations/loc-s9/local', { method: 'DELETE' })).json()
    expect(r).toMatchObject({ id: 'loc-s9', local_path: null, connected: false, reachable: false })
    expect(calls.stranger).toEqual([])
  })

  it('review round 2: a sign-out forgets the shares picked in this session: the next list cannot connect on them', async () => {
    const S5 = `${STRANGER}5`
    dialogNext.open = [`${S5}\\x.mov`]
    await api('/pick-files', J({}))
    await register([]) // signed out
    expect((await register([{ id: 'loc-r', unc_path: S5 }]))[0].connected).toBe(false)
  })

  it('the agreement is to an ADDRESS: a location re-addressed asks again', async () => {
    const moved = `${STRANGER}2`
    calls.stranger.length = 0
    expect((await register([{ id: 'loc-stranger', unc_path: moved }]))[0]).toMatchObject({ connected: false, reachable: false })
    expect(calls.stranger).toEqual([])
  })

  it('picking files on a share in this computer\'s own file dialog is the person\'s choice: a location on it connects, and so does a share picked first and named after', async () => {
    const asked = messageCalls.length
    const S3 = `${STRANGER}3`; const S4 = `${STRANGER}4`
    await register([{ id: 'loc-p', unc_path: S3 }])
    dialogNext.open = [`${S3}\\A001\\c1.mov`]
    await api('/pick-files', J({}))
    expect((await register([{ id: 'loc-p', unc_path: S3 }]))[0].connected).toBe(true)
    // "Which location is this? Name it.": the share was picked before it was a location.
    dialogNext.open = [`${S4}\\x.mov`]
    await api('/pick-files', J({}))
    expect((await register([{ id: 'loc-q', unc_path: S4 }]))[0].connected).toBe(true)
    expect(messageCalls.length).toBe(asked)
  })
})

// LAST: its four questions never answer, so every slot stays taken.
// Review round 1, finding 3: each unanswered question holds one of libuv's
// pool threads for as long as the server keeps it, and the pool also serves
// the app's own files. At most four are out at once; a fifth waits for a
// slot inside the same limit, and answers "not reachable" if none frees.
describe('several servers that do not answer', () => {
  it('at most four questions are out at once; the next waits for a slot and answers within the limit', async () => {
    // DEAD's question from the first describe is still out (it never
    // answers): three more fill the four slots, the fifth must wait.
    const extra = [2, 3, 4, 5].map(n => ({ id: `loc-dead${n}`, unc_path: `${DEAD}${n}` }))
    const [locs, ms] = await timed(() => register(extra))
    expect(locs.map(l => l.reachable)).toEqual([false, false, false, false])
    expect(ms).toBeLessThan(WAIT_MS + 1500)
    const asked = new Set(calls.asyncDead)
    expect([2, 3, 4].every(n => asked.has(`${DEAD}${n}`))).toBe(true)
    expect(asked.has(`${DEAD}5`)).toBe(false) // queued: no fifth thread held
    expect(calls.syncDead).toEqual([])
  })
})

// (A test that main.cjs widened libuv's pool stood here: measured in the
// desktop app, the line read 16 and changed nothing — the pool is set up
// before main.cjs runs. The root question moved to a worker thread instead;
// rabbitCloudBinsDesktop.routes.test.js holds that.)
