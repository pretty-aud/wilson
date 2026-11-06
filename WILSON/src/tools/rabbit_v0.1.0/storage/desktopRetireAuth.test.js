// @vitest-environment node
// desktopRetireAuth.test.js — MO1 (MOTH_DESIGN §1.8, PS-7): a copy-up's local original kept 30 days, the open
// arm on an office server, who a bearer token is, and the question lifted out of Bins.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'

const require = createRequire(import.meta.url)
const { mountLocalMedia } = require('../../../../electron/localMedia.cjs')
const { resolveContainedFilePath } = require('../../../../electron/pathContainment.cjs')
const { openOrReveal } = require('../../../../electron/openPath.cjs')
const { makeVerifyBearer, readAuthPublic } = require('../../../../electron/authCheck.cjs')
const { makeRootQuestions } = require('../../../../electron/rootReachable.cjs')

const OP = '12100000-0000-0000-0000-000000000001'
const DAY = 24 * 60 * 60 * 1000

describe('retiring a local original', () => {
  let root, moves, server, base, api, clock, failRename
  const KEY = 'projects/a1000000-0000-0000-0000-000000000001/assets/f1000000-0000-0000-0000-000000000001/clip.mov'
  const disk = () => path.join(root, ...KEY.split('/'))
  const retire = async (body) => {
    const r = await fetch(`${base}/api/rabbit/local-media/retire`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return { status: r.status, body: await r.json() }
  }
  beforeEach(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retire-'))
    root = path.join(dir, 'media')
    moves = path.join(dir, 'moves')
    clock = Date.parse('2026-11-01T00:00:00Z')
    failRename = false
    fs.mkdirSync(path.dirname(disk()), { recursive: true })
    fs.writeFileSync(disk(), 'body')
    const app = express()
    app.use(express.json())
    api = mountLocalMedia(app, {
      getRoot: () => root,
      resolveContainedFilePath,
      movesDir: () => moves,
      writeJsonAtomic: (file, data) => {
        if (failRename) throw new Error('the disk said no')
        fs.writeFileSync(file, JSON.stringify(data))
      },
      now: () => clock,
    })
    await new Promise((ok) => { server = app.listen(0, '127.0.0.1', ok) })
    base = `http://127.0.0.1:${server.address().port}`
  })
  afterEach(async () => {
    await new Promise((ok) => server.close(ok))
    fs.rmSync(path.dirname(root), { recursive: true, force: true })
  })

  it('moves the copy into .trash, and leaves no journal', async () => {
    expect((await retire({ key: KEY, op: OP })).body).toEqual({ retired: true })
    expect(fs.existsSync(disk())).toBe(false)
    expect(fs.readdirSync(path.join(root, '.trash'))).toEqual([`${clock}-${OP}-clip.mov`])
    expect(fs.readdirSync(moves)).toEqual([])
  })
  it('a repeat says so', async () => {
    await retire({ key: KEY, op: OP })
    expect((await retire({ key: KEY, op: OP })).body).toEqual({ retired: false, already: true })
  })
  it('refuses a key of the wrong shape and an op that is no id', async () => {
    expect((await retire({ key: '../../x', op: OP })).status).toBe(404)
    expect((await retire({ key: KEY, op: 'nope' })).status).toBe(404)
    expect(fs.existsSync(disk())).toBe(true)
  })
  it('🚨 a journal left by a crash is finished at the next start', () => {
    fs.mkdirSync(moves, { recursive: true })
    fs.writeFileSync(path.join(moves, `retire-${OP}.json`), JSON.stringify({ kind: 'retire', op: OP, key: KEY, trash_name: `${clock}-${OP}-clip.mov` }))
    expect(api.recoverRetires()).toMatchObject({ recovered: 1, left: 0 })
    expect(fs.existsSync(disk())).toBe(false)
    expect(fs.readdirSync(moves)).toEqual([])
  })
  it('after 30 days the kept copy goes, and not before', async () => {
    await retire({ key: KEY, op: OP })
    clock += 30 * DAY - 1000
    expect(api.recoverRetires().purged).toBe(0)
    clock += 2000
    expect(api.recoverRetires().purged).toBe(1)
    expect(fs.readdirSync(path.join(root, '.trash'))).toEqual([])
  })
})

describe('a file on the office server, from rabbit:open-path', () => {
  const shell = () => ({ showItemInFolder: vi.fn(), openPath: vi.fn(async () => '') })
  const found = (diskPath, isFile = true) => async () => ({ ok: true, diskPath, isFile })

  it('reveals without opening, and a program is refused by its name', async () => {
    const s = shell()
    expect(await openOrReveal({ source: 'share', locator: 'Salt/a.mov', reveal: true }, { shell: s, shareLocate: found('X:/Salt/a.mov') })).toEqual({ ok: true })
    expect(s.showItemInFolder).toHaveBeenCalledWith('X:/Salt/a.mov')
    expect(s.openPath).not.toHaveBeenCalled()
    expect((await openOrReveal({ source: 'share', locator: 'Salt/a.exe' }, { shell: s, shareLocate: found('X:/Salt/a.exe') })).ok).toBe(false)
    expect(s.openPath).not.toHaveBeenCalled()
  })
  it('opens a file, and a folder of frames is shown, not opened', async () => {
    const s = shell()
    expect(await openOrReveal({ source: 'share', locator: 'Salt/a.mov' }, { shell: s, shareLocate: found('X:/Salt/a.mov') })).toEqual({ ok: true })
    expect(s.openPath).toHaveBeenCalledWith('X:/Salt/a.mov')
    expect((await openOrReveal({ source: 'share', locator: 'Salt/seq' }, { shell: s, shareLocate: found('X:/Salt/seq', false) })).ok).toBe(false)
  })
  it('🚨 uses nothing synchronous, and passes on a refusal', async () => {
    const s = shell()
    const fsSpy = new Proxy({}, { get: () => { throw new Error('a sync call') } })
    const out = await openOrReveal({ source: 'share', locator: 'Salt/a.mov' }, { shell: s, fs: fsSpy, shareLocate: async () => ({ ok: false, error: 'Off.' }) })
    expect(out).toEqual({ ok: false, error: 'Off.' })
  })
  it('with no drive set up, it is not here', async () => {
    expect((await openOrReveal({ source: 'share', locator: 'a' }, { shell: shell() })).ok).toBe(false)
  })
})

describe('who a bearer token is', () => {
  const pub = { url: 'https://example.test/', anonKey: 'public-anon' }
  const answering = (status, body) => vi.fn(async () => ({ status, ok: status >= 200 && status < 300, json: async () => body }))

  it('asks the auth server, and keeps a good answer a minute', async () => {
    const fetchImpl = answering(200, { id: 'u1' })
    let clock = 1000
    const verify = makeVerifyBearer({ getAuthPublic: () => pub, fetchImpl, now: () => clock })
    expect(await verify('Bearer abc')).toEqual({ userId: 'u1' })
    expect(fetchImpl.mock.calls[0][0]).toBe('https://example.test/auth/v1/user')
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer abc')
    await verify('Bearer abc')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    clock += 60001
    await verify('Bearer abc')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
  it('no token, or one refused, is nobody; a refused answer is not kept', async () => {
    const fetchImpl = answering(401, {})
    const verify = makeVerifyBearer({ getAuthPublic: () => pub, fetchImpl })
    expect(await verify(undefined)).toEqual({ userId: null })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(await verify('Bearer bad')).toEqual({ userId: null })
    await verify('Bearer bad')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
  it('a server that cannot be asked is said to be that, not nobody', async () => {
    expect(await makeVerifyBearer({ getAuthPublic: () => pub, fetchImpl: answering(500, {}) })('Bearer x')).toEqual({ unreachable: true })
    expect(await makeVerifyBearer({ getAuthPublic: () => pub, fetchImpl: vi.fn(async () => { throw new Error('off') }) })('Bearer x')).toEqual({ unreachable: true })
    expect(await makeVerifyBearer({ getAuthPublic: () => null, fetchImpl: answering(200, {}) })('Bearer x')).toEqual({ unreachable: true })
  })
  it('the build\'s file first, then a dev run\'s environment', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-public-'))
    const env = { VITE_SUPABASE_URL: 'https://dev.test', VITE_SUPABASE_ANON_KEY: 'dev-anon' }
    expect(readAuthPublic({ distDir: dir, env })).toEqual({ url: 'https://dev.test', anonKey: 'dev-anon' })
    fs.writeFileSync(path.join(dir, 'auth-public.json'), JSON.stringify({ url: 'https://build.test', anonKey: 'build-anon' }))
    expect(readAuthPublic({ distDir: dir, env })).toEqual({ url: 'https://build.test', anonKey: 'build-anon' })
    expect(readAuthPublic({ distDir: path.join(dir, 'none'), env: {} })).toBeNull()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('whether a root answers', () => {
  it('one question at a time per root, and marked off at once', async () => {
    let asked = 0
    const q = makeRootQuestions({ askRoot: async () => { asked += 1; return true } })
    expect(await Promise.all([q.rootReachable('R'), q.rootReachable('r')])).toEqual([true, true])
    expect(asked).toBe(1)
    expect(q.knownOff('R')).toBe(false)
    q.markOff('R')
    expect(q.knownOff('r')).toBe(true)
    expect(await q.rootReachable('R')).toBe(false)
  })
  it('the real question, in a real worker', async () => {
    const q = makeRootQuestions()
    expect(await q.rootReachable(os.tmpdir())).toBe(true)
    expect(await q.rootReachable(path.join(os.tmpdir(), 'not-there-at-all'))).toBe(false)
  })
})
