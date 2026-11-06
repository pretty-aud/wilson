// =============================================================================
// networkShare.routes.test.js — MO1 (MOTH_DESIGN §2.2 PS-7, §2.4 NS-D7, NS-SEC-04,
// NS-SEC-10): the office-server add route. A real Express app on an ephemeral port, the
// real electron/networkShare.cjs and real files in a temp folder that stands in for the
// share, with the real launch-token lock in front; a UNC path cannot exist on the runner,
// so `isShareRoot` is the one seam, and the default is proved on its own. main.cjs's
// wiring is pinned by reading it at the end.
// =============================================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Writable } from 'node:stream'
import express from 'express'
import cors from 'cors'

const require = createRequire(import.meta.url)
const {
  mountNetworkShare,
  checkShareLocator,
  SHARE_REFUSED_EXACT,
  SHARE_REFUSED_SUFFIX,
} = require('../../../electron/networkShare.cjs')
const { applyLocalServerLock, TOKEN_HEADER } = require('../../../electron/localToken.cjs')

const APP = path.resolve(__dirname, '../../..')
const USER = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const OTHER = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
const TOKEN = 'launch-token'
const BS = String.fromCharCode(92)

let root
let server
let base
let signedIn
let driveRoot

function start(options = {}) {
  const app = express()
  applyLocalServerLock(app, { cors, getToken: () => TOKEN, getOrigin: () => 'http://127.0.0.1' })
  app.use(express.json({ limit: '1mb' }))
  mountNetworkShare(app, {
    getWorkspaceRoot: () => driveRoot,
    getSignedInUserId: () => signedIn,
    isShareRoot: () => true,
    ...options,
  })
  return new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      base = server.address().port
      resolve()
    })
  })
}

// http.request, for the headers a browser's fetch would not let a page set.
function send({ body = 'hello', query = {}, headers = {}, abortAfter = null, hold = false, onRequest = null } = {}) {
  const q = new URLSearchParams({
    root: driveRoot ?? '',
    folder: `_WILSON_PERSONAL/${USER}`,
    name: 'clip.mov',
    sizeBytes: String(Buffer.byteLength(body)),
    ...query,
  })
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: base,
      method: 'POST',
      path: `/api/network-share/personal-space/files?${q}`,
      headers: {
        [TOKEN_HEADER]: TOKEN,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/octet-stream',
        ...headers,
      },
    }, (res) => {
      let text = ''
      res.on('data', (d) => { text += d })
      res.on('end', () => {
        let json = null
        try { json = JSON.parse(text) } catch { /* a bare status */ }
        resolve({ status: res.statusCode, json })
      })
    })
    req.on('error', (err) => {
      if (abortAfter !== null) resolve({ status: 0, json: null })
      else reject(err)
    })
    if (onRequest) onRequest(req)
    if (abortAfter !== null) {
      req.flushHeaders()
      req.write(body.slice(0, abortAfter), () => {
        if (!hold) setTimeout(() => req.destroy(), 30)
      })
    } else {
      req.end(body)
    }
  })
}

const folderOf = (id = USER) => path.join(root, '_WILSON_PERSONAL', id)
const listing = (id = USER) => {
  try { return fs.readdirSync(folderOf(id)).sort() } catch { return [] }
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wilson-share-'))
  driveRoot = root
  signedIn = USER
  await start()
})

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve))
  fs.rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('checkShareLocator holds what network_share_locator_ok holds (0117)', () => {
  const migration = fs.readFileSync(path.join(APP, 'supabase/migrations/0117_network_share_catalogue.sql'), 'utf8')

  it('admits a plain path, a personal space\'s, and a name with spaces', () => {
    for (const ok of ['Salt-Hours/rushes/A001.mov', `_WILSON_PERSONAL/${USER}/x.mov`, 'a/My Clip (2).mov', 'a/INVOICES.zip', `a/caf${String.fromCharCode(233)}.mov`]) {
      expect(checkShareLocator(ok), ok).toBe(true)
    }
  })

  it('refuses the shapes the SQL refuses', () => {
    const refused = [
      'a/INVOICES/x', 'a/invoices/x', 'FINANCE/x', 'a/Legal/x', 'a/P_DATABASES/b', 'a/P_RECEIPTS&INVOICES/b',
      'a/x_crewinvoices/b', 'a/x_talentinvoices/b', 'a/.wilson/x', '.a', 'a/../b', '../b', 'a/..', `a${BS}b`,
      'C:/x', 'a//b', '/a', 'a/', 'a/b.', 'a/b ', `a${String.fromCodePoint(8238)}b`, `e${String.fromCodePoint(769)}`,
      `a${String.fromCodePoint(8203)}b`, `a${String.fromCodePoint(1)}b`, `a${String.fromCodePoint(159)}b`,
      `a${String.fromCodePoint(65279)}b`, `a${String.fromCodePoint(65024)}b`, `a${String.fromCodePoint(917601)}b`,
      `a${String.fromCodePoint(917760)}b`, `a${String.fromCodePoint(1564)}b`, 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b',
      '', 'a'.repeat(1025), null, undefined, 7,
    ]
    for (const bad of refused) expect(checkShareLocator(bad), String(bad)).toBe(false)
  })

  it('counts length in characters and in bytes, as SQL does', () => {
    expect(checkShareLocator(String.fromCodePoint(0x1f600).repeat(500))).toBe(true)
    expect(checkShareLocator(String.fromCodePoint(0x1f600).repeat(501))).toBe(false)
    expect(checkShareLocator('a'.repeat(1024))).toBe(true)
  })

  it('refuses a short name, and not a tilde in an ordinary one', () => {
    const smiles = String.fromCodePoint(0x1f600).repeat(4)
    for (const p of ['_WILSO~1', 'P_DATA~1/rates.json', 'a/CLIP~12.MOV', 'a/take~a1/b.mov', `a/${smiles}~1.txt`]) {
      expect(checkShareLocator(p), p).toBe(false)
    }
    for (const p of ['a/shot~final/b.mov', 'a/~draft.mov', 'a/b~c~d.mov']) {
      expect(checkShareLocator(p), p).toBe(true)
    }
  })

  it('carries the SQL\'s lists, word for word', () => {
    const suffix = migration.match(/lower\(seg\) ~ '_\(([^)]+)\)\$'/)
    expect(suffix).not.toBeNull()
    expect(suffix[1].split('|').map((s) => `_${s.toUpperCase()}`).sort()).toEqual([...SHARE_REFUSED_SUFFIX].sort())
    const money = fs.readFileSync(path.join(APP, 'supabase/migrations/0088_legal_files.sql'), 'utf8')
      .match(/upper\(seg\) IN \(([^)]+)\)/)
    expect(money).not.toBeNull()
    expect(money[1].split(',').map((s) => s.trim().replace(/'/g, '')).sort()).toEqual([...SHARE_REFUSED_EXACT].sort())
  })
})

describe('POST /api/network-share/personal-space/files', () => {
  it('writes the bytes into the owner\'s folder, and says what landed', async () => {
    const res = await send({ body: 'the whole clip' })
    expect(res.status).toBe(201)
    expect(res.json.locator).toBe(`_WILSON_PERSONAL/${USER}/clip.mov`)
    expect(res.json.name).toBe('clip.mov')
    expect(res.json.sizeBytes).toBe(14)
    expect(Number.isNaN(Date.parse(res.json.modifiedAt))).toBe(false)
    expect(fs.readFileSync(path.join(folderOf(), 'clip.mov'), 'utf8')).toBe('the whole clip')
    expect(listing()).toEqual(['clip.mov'])
  })

  it('takes a body past the JSON parser\'s limit', async () => {
    const body = 'x'.repeat(2 * 1024 * 1024)
    const res = await send({ body })
    expect(res.status).toBe(201)
    expect(fs.statSync(path.join(folderOf(), 'clip.mov')).size).toBe(body.length)
  })

  it('never overwrites: the next free name, and the first file\'s bytes stand', async () => {
    expect((await send({ body: 'one' })).json.name).toBe('clip.mov')
    expect((await send({ body: 'two' })).json.name).toBe('clip (2).mov')
    expect((await send({ body: 'three' })).json.name).toBe('clip (3).mov')
    expect(fs.readFileSync(path.join(folderOf(), 'clip.mov'), 'utf8')).toBe('one')
    expect(fs.readFileSync(path.join(folderOf(), 'clip (2).mov'), 'utf8')).toBe('two')
    expect(listing()).toEqual(['clip (2).mov', 'clip (3).mov', 'clip.mov'])
  })

  it('numbers a name with no extension at its end', async () => {
    await send({ query: { name: 'README' } })
    expect((await send({ query: { name: 'README' } })).json.name).toBe('README (2)')
  })

  it('takes two at once under one name without losing either', async () => {
    const [a, b] = await Promise.all([send({ body: 'aaa' }), send({ body: 'bbb' })])
    expect([a.status, b.status]).toEqual([201, 201])
    expect([a.json.name, b.json.name].sort()).toEqual(['clip (2).mov', 'clip.mov'])
    const texts = listing().map((f) => fs.readFileSync(path.join(folderOf(), f), 'utf8')).sort()
    expect(texts).toEqual(['aaa', 'bbb'])
  })

  it('puts a name in NFC, so the catalogue can hold it', async () => {
    const res = await send({ query: { name: `cafe${String.fromCodePoint(769)}.mov` } })
    expect(res.status).toBe(201)
    expect(res.json.name).toBe(`caf${String.fromCodePoint(233)}.mov`)
  })

  it('confirms the size: a short or long body keeps nothing', async () => {
    expect((await send({ body: 'abc', query: { sizeBytes: '4' } })).json.code).toBe('size_mismatch')
    expect((await send({ body: 'abcde', query: { sizeBytes: '4' } })).json.code).toBe('size_mismatch')
    expect(listing()).toEqual([])
  })

  it('leaves nothing behind when the connection drops', async () => {
    let client
    const sent = send({ body: 'x'.repeat(4096), abortAfter: 100, hold: true, onRequest: (r) => { client = r } })
    await vi.waitFor(() => expect(listing().some((n) => n.startsWith('.wilson-upload-'))).toBe(true), { timeout: 3000 })
    client.destroy()
    expect((await sent).status).toBe(0)
    await vi.waitFor(() => expect(listing()).toEqual([]), { timeout: 3000 })
  })

  it('ends an add whose connection has gone quiet, and keeps nothing', async () => {
    await new Promise((resolve) => server.close(resolve))
    await start({ stallMs: 60 })
    const res = await send({ body: 'x'.repeat(4096), abortAfter: 100, hold: true })
    expect(res.status).toBe(0)
    await vi.waitFor(() => expect(listing()).toEqual([]), { timeout: 3000 })
  })

  it('answers when the file cannot be finished, though the whole body was read', async () => {
    await new Promise((resolve) => server.close(resolve))
    const busy = Object.assign(new Error('busy'), { code: 'EBUSY' })
    await start({ fsp: { ...fs.promises, rename: () => Promise.reject(busy) } })
    const res = await send()
    expect(res.status).toBe(500)
    expect(res.json.code).toBe('write_failed')
    expect(res.json.error).toContain('Nothing was kept')
    expect(listing()).toEqual([])
  })

  it('answers when a write fails part way, on the connection still open', async () => {
    await new Promise((resolve) => server.close(resolve))
    const full = Object.assign(new Error('full'), { code: 'ENOSPC' })
    await start({
      createWriteStream: () => new Writable({ write(_chunk, _enc, cb) { cb(full) } }),
    })
    const res = await send()
    expect(res.status).toBe(500)
    expect(res.json.code).toBe('write_failed')
  })

  it('keeps nothing for somebody who has gone by the time the body is written', async () => {
    let client
    await new Promise((resolve) => server.close(resolve))
    await start({
      createWriteStream: (p, opts) => {
        const real = fs.createWriteStream(p, opts)
        const original = real._final
        real._final = function final(cb) {
          client.destroy()
          setTimeout(() => (original ? original.call(this, cb) : cb()), 60)
        }
        return real
      },
    })
    const res = await send({ onRequest: (r) => { client = r } }).catch(() => ({ status: 0 }))
    expect(res.status).toBe(0)
    await vi.waitFor(() => expect(listing()).toEqual([]), { timeout: 3000 })
  })

  it('removes the file when the folder turned out to lead elsewhere after the check', async () => {
    await new Promise((resolve) => server.close(resolve))
    const real = fs.promises.realpath
    await start({
      fsp: {
        ...fs.promises,
        realpath: (p) => (String(p).endsWith('clip.mov') ? Promise.resolve(path.join(os.tmpdir(), 'elsewhere', 'clip.mov')) : real(p)),
      },
    })
    const res = await send()
    expect(res.status).toBe(403)
    expect(res.json.code).toBe('not_your_folder')
    expect(listing()).toEqual([])
  })

  it('answers when the name cannot be reserved', async () => {
    await new Promise((resolve) => server.close(resolve))
    const denied = Object.assign(new Error('denied'), { code: 'EACCES' })
    await start({ fsp: { ...fs.promises, open: () => Promise.reject(denied) } })
    const res = await send()
    expect(res.status).toBe(500)
    expect(res.json.code).toBe('write_failed')
    expect(listing()).toEqual([])
  })

  it('does not say nothing was kept when part of it could not be removed', async () => {
    await new Promise((resolve) => server.close(resolve))
    const busy = Object.assign(new Error('busy'), { code: 'EBUSY' })
    await start({
      fsp: { ...fs.promises, rename: () => Promise.reject(busy), unlink: () => Promise.reject(busy) },
    })
    const res = await send()
    expect(res.status).toBe(500)
    expect(res.json.error).not.toContain('Nothing was kept')
    expect(res.json.error).toContain('may still be')
  })

  it('clears what a killed add left, and not what another add is writing', async () => {
    fs.mkdirSync(folderOf(), { recursive: true })
    const old = path.join(folderOf(), '.wilson-upload-old.tmp')
    const young = path.join(folderOf(), '.wilson-upload-young.tmp')
    fs.writeFileSync(old, 'part')
    fs.writeFileSync(young, 'part')
    const longAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    fs.utimesSync(old, longAgo, longAgo)
    expect((await send()).status).toBe(201)
    await vi.waitFor(() => expect(fs.existsSync(old)).toBe(false), { timeout: 3000 })
    expect(fs.existsSync(young)).toBe(true)
  })

  it('refuses a size that is missing or not a whole number', async () => {
    for (const sizeBytes of ['', 'x', '-1', '1.5', '1234567890123456']) {
      expect((await send({ query: { sizeBytes } })).json.code, sizeBytes).toBe('bad_size')
    }
    expect(listing()).toEqual([])
  })

  it('refuses a name the catalogue could not hold, before any write', async () => {
    for (const name of ['', '.hidden', '..', 'a/b.mov', `a${BS}b.mov`, 'a:b.mov', 'INVOICES', 'LEGAL', 'x_DATABASES', 'trail.', 'trail ',
      'CON', 'nul.txt', 'COM1', 'Lpt9.log', `a${String.fromCodePoint(8238)}b`]) {
      const res = await send({ query: { name } })
      expect(res.status, name).toBe(400)
      expect(res.json.code, name).toBe('bad_name')
    }
    expect(fs.existsSync(path.join(root, '_WILSON_PERSONAL'))).toBe(false)
  })

  it('writes only into the signed-in person\'s own folder', async () => {
    for (const folder of [`_WILSON_PERSONAL/${OTHER}`, '_WILSON_PERSONAL', 'Salt-Hours', `_WILSON_PERSONAL/${USER}/x`, `_WILSON_PERSONAL/${USER}/..`,
      `_WILSON_PERSONAL/../${USER}`, `Personal_${USER.replace(/-/g, '')}`, `_WILSON_PERSONAL/${USER.toUpperCase()}`, '']) {
      const res = await send({ query: { folder } })
      expect(res.status, folder).toBe(403)
      expect(res.json.code, folder).toBe('not_your_folder')
    }
    expect(fs.existsSync(path.join(root, '_WILSON_PERSONAL'))).toBe(false)
  })

  it('refuses when nobody is signed in', async () => {
    signedIn = null
    expect((await send()).json.code).toBe('not_your_folder')
    signedIn = 'not-an-id'
    expect((await send({ query: { folder: '_WILSON_PERSONAL/not-an-id' } })).json.code).toBe('not_your_folder')
    expect(fs.existsSync(path.join(root, '_WILSON_PERSONAL'))).toBe(false)
  })

  it('refuses a drive that is not the company\'s', async () => {
    const res = await send({ query: { root: path.join(root, 'elsewhere') } })
    expect(res.status).toBe(409)
    expect(res.json.code).toBe('drive_changed')
    driveRoot = null
    expect((await send({ query: { root: 'x' } })).json.code).toBe('no_drive')
  })

  it('answers the drive\'s case-insensitively, as Windows does', async () => {
    const res = await send({ query: { root: root.toUpperCase() } })
    // On a case-sensitive runner the path is the pushed one all the same: the check is on the text.
    expect(res.status).toBe(201)
  })

  it('says the server cannot be reached when it is not there', async () => {
    driveRoot = path.join(root, 'gone')
    const res = await send({ query: { root: driveRoot } })
    expect(res.status).toBe(503)
    expect(res.json.code).toBe('server_off')
  })

  it('refuses a junction or link in the share that leads out of the drive', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wilson-outside-'))
    try {
      fs.mkdirSync(path.join(root, '_WILSON_PERSONAL'))
      try {
        fs.symlinkSync(outside, folderOf(), 'junction')
      } catch {
        return // no link on this machine; the check needs one
      }
      const res = await send()
      expect(res.status).toBe(403)
      expect(res.json.code).toBe('not_your_folder')
      expect(fs.readdirSync(outside)).toEqual([])
    } finally {
      fs.rmSync(folderOf(), { recursive: true, force: true })
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it('refuses a link that leads to another folder inside the drive', async () => {
    const target = path.join(root, 'Finance')
    fs.mkdirSync(target)
    fs.mkdirSync(path.join(root, '_WILSON_PERSONAL'))
    try {
      fs.symlinkSync(target, folderOf(), 'junction')
    } catch {
      return // no link on this machine; the check needs one
    }
    const res = await send()
    expect(res.status).toBe(403)
    expect(res.json.code).toBe('not_your_folder')
    expect(fs.readdirSync(target)).toEqual([])
  })

  it('makes no folder through a link on the parent', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wilson-outside-'))
    try {
      try {
        fs.symlinkSync(outside, path.join(root, '_WILSON_PERSONAL'), 'junction')
      } catch {
        return // no link on this machine; the check needs one
      }
      const res = await send()
      expect(res.status).toBe(403)
      expect(res.json.code).toBe('not_your_folder')
      expect(fs.readdirSync(outside)).toEqual([])
    } finally {
      fs.rmSync(path.join(root, '_WILSON_PERSONAL'), { recursive: true, force: true })
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it('refuses a request from anywhere but the page itself', async () => {
    for (const headers of [{ 'sec-fetch-site': 'same-site' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'none' }]) {
      const res = await send({ headers })
      expect(res.status, JSON.stringify(headers)).toBe(403)
    }
    expect(listing()).toEqual([])
  })

  it('stands behind the launch token', async () => {
    const res = await send({ headers: { [TOKEN_HEADER]: 'wrong' } })
    expect(res.status).toBe(401)
    expect(listing()).toEqual([])
  })

  it('runs no synchronous file call on the main thread', async () => {
    const names = ['statSync', 'lstatSync', 'mkdirSync', 'openSync', 'writeFileSync', 'renameSync', 'existsSync', 'realpathSync', 'unlinkSync', 'copyFileSync', 'readdirSync']
    const spies = names.map((n) => vi.spyOn(fs, n))
    const res = await send({ body: 'quiet' })
    const counts = spies.map((s) => s.mock.calls.length)
    vi.restoreAllMocks()
    expect(res.status).toBe(201)
    expect(counts).toEqual(names.map(() => 0))
  })

  it('does not wait on a server that hangs', async () => {
    await new Promise((resolve) => server.close(resolve))
    const fsp = { ...fs.promises, stat: () => new Promise(() => {}) }
    await start({ fsp, reachWaitMs: 20 })
    const res = await send()
    expect(res.status).toBe(503)
    expect(res.json.code).toBe('server_off')
  })

  it('refuses a drive-letter root before any file call, with the real test', async () => {
    await new Promise((resolve) => server.close(resolve))
    const touched = []
    const fsp = new Proxy(fs.promises, { get: (t, k) => { touched.push(String(k)); return t[k] } })
    driveRoot = 'C:/wilson'
    await start({ fsp, isShareRoot: undefined })
    const res = await send({ query: { root: 'C:/wilson' } })
    expect(res.status).toBe(409)
    expect(res.json.code).toBe('no_drive')
    expect(touched).toEqual([])
  })

  it('takes a UNC drive with the real test', async () => {
    await new Promise((resolve) => server.close(resolve))
    // The path is not on this machine, so the answer is that it cannot be reached: past the test.
    driveRoot = `${BS}${BS}nas${BS}share${BS}wilson`
    await start({ isShareRoot: undefined, reachWaitMs: 200 })
    const res = await send({ query: { root: driveRoot } })
    expect(res.status).toBe(503)
  })
})

describe('the wiring', () => {
  const main = fs.readFileSync(path.join(APP, 'electron/main.cjs'), 'utf8')
  const preload = fs.readFileSync(path.join(APP, 'electron/preload.cjs'), 'utf8')
  const appJsx = fs.readFileSync(path.join(APP, 'src/App.jsx'), 'utf8')

  it('main.cjs mounts the route behind the lock, with the memory-only root and user', () => {
    const lock = main.indexOf('applyLocalServerLock(expressApp, {')
    const mount = main.indexOf("require('./networkShare.cjs').mountNetworkShare(expressApp, {")
    expect(lock).toBeGreaterThan(0)
    expect(mount).toBeGreaterThan(lock)
    expect(main.slice(mount, mount + 300)).toContain('getWorkspaceRoot: () => workspaceRootDir')
    expect(main.slice(mount, mount + 300)).toContain('getSignedInUserId: () => signedInUserId')
  })

  it('main.cjs lifts Node\'s five-minute limit, so a big add is not always cut off', () => {
    expect(main).toContain('server.requestTimeout = 0;')
  })

  it('the signed-in id reaches main over one gated channel, and the app pushes and clears it', () => {
    expect(main).toContain("ipcMain.handle('rabbit:set-signed-in-user'")
    expect(preload).toContain("ipcRenderer.invoke('rabbit:set-signed-in-user'")
    expect(appJsx).toContain('bridge.setSignedInUser({ userId: perms.ready ? (perms.userId || null) : null })')
  })
})
