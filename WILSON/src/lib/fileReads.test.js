// =============================================================================
// fileReads.test.js — the Local Server's inline read of a project file and the
// download's `?download=1` (electron/fileReads.cjs), SERVED: Express, the
// route, a real file on disk and the real containment resolver, on a loopback
// port (post-overhaul S4a, review round 1, R1-TST-09 — as source text, a gate
// that also admitted `same-site`, a misspelled header and a dropped bundle
// write each passed).
//
// Only the bundle store is a stand-in (readRabbitBundle / writeRabbitBundle /
// rabbitLogFileEvent record what they are given) and the throttle is a Set,
// so each assertion says what reached the disk and the bundle.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const express = require('express')
const { mountFileStreamRead, attachWhenAsked, isSameOriginRequest } = require('../../electron/fileReads.cjs')
const { resolveContainedFilePath } = require('../../electron/pathContainment.cjs')
const { contentDisposition } = require('../../electron/localMedia.cjs')

const here = dirname(fileURLToPath(import.meta.url))
const BODY = 'S4a: twenty-six bytes, ok.'
let dir, bundle, writes, logged, server, port
const seen = new Set() // the throttle's window, emptied per test

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 's4a-filereads-'))
  mkdirSync(join(dir, 'files'), { recursive: true })
  writeFileSync(join(dir, 'files', '1-notes.txt'), BODY)
  const app = express()
  mountFileStreamRead(app, {
    fs,
    readRabbitBundle: (pid) => (pid === 'p1' ? bundle : null),
    rabbitNotFound: (res, what = 'project') => res.status(404).json({ error: `${what} not found` }),
    resolveContainedFilePath,
    resolveFileBaseDir: () => join(dir, 'files'),
    rabbitLogFileEvent: (b, evt) => { logged.push(evt); (b.fileEvents ||= []).push(evt) },
    writeRabbitBundle: (pid, b, opts) => { writes.push([pid, opts]) },
    safeMediaContentType: (m) => (/^(image|video|audio)\//.test(m || '') ? m : 'application/octet-stream'),
    shouldLogManagedRead: (key) => (seen.has(key) ? false : (seen.add(key), true)),
    warn: () => {},
  })
  // The download route's own use of the helper, as main.cjs calls it.
  app.get('/dl/:name', (req, res) => { attachWhenAsked(req, res, req.params.name, contentDisposition); res.send('x') })
  server = await new Promise((done) => { const s = app.listen(0, '127.0.0.1', () => done(s)) })
  port = server.address().port
})
afterAll(async () => {
  await new Promise((done) => server.close(done))
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
  bundle = { files: [
    { id: 'f1', name: 'notes.txt', mime_type: 'text/html', storage_path: '1-notes.txt', storage_provider: 'local', size_bytes: BODY.length },
    { id: 'f2', name: 'gone.txt', mime_type: 'text/plain', storage_path: '2-gone.txt', storage_provider: 'local' },
    { id: 'f3', name: 'evil.txt', mime_type: 'text/plain', storage_path: '../../outside.txt', storage_provider: 'local' },
  ] }
  writes = []
  logged = []
  seen.clear()
})

const url = (p) => `http://127.0.0.1:${port}${p}`
const SAME = { 'sec-fetch-site': 'same-origin' }
const stream = (id, headers = SAME, q = '') => fetch(url(`/api/rabbit/projects/p1/files/${id}/stream${q}`), { headers })

describe('the stream route: same-origin only, failing closed', () => {
  it('the renderer\'s own read is answered, with the bytes', async () => {
    const r = await stream('f1')
    expect(r.status).toBe(200)
    expect(await r.text()).toBe(BODY)
  })
  it('🚨 another localhost port (same-site), another site, a typed URL and no claim at all are refused', async () => {
    for (const site of ['same-site', 'cross-site', 'none']) {
      const r = await stream('f1', { 'sec-fetch-site': site })
      expect(r.status, site).toBe(403)
      expect((await r.json()).code).toBe('cross_origin')
    }
    // No Sec-Fetch-Site: only an Origin naming this very host passes.
    expect((await stream('f1', { origin: 'http://evil.example' })).status).toBe(403)
    expect((await stream('f1', {})).status).toBe(403)
    expect((await stream('f1', { origin: `http://127.0.0.1:${port}` })).status).toBe(200)
  })
  it('isSameOriginRequest is the whole rule', () => {
    const r = (headers) => isSameOriginRequest({ headers })
    expect(r({ 'sec-fetch-site': 'same-origin' })).toBe(true)
    expect(r({ 'sec-fetch-site': 'same-site', origin: 'http://h', host: 'h' })).toBe(false)
    expect(r({ origin: 'http://h', host: 'h' })).toBe(true)
    expect(r({ origin: 'http://h:2', host: 'h:1' })).toBe(false)
    expect(r({})).toBe(false)
  })
})

describe('the stream route: what it sends', () => {
  it('a client-written text/html is sent as an opaque download, never sniffed', async () => {
    const r = await stream('f1')
    expect(r.headers.get('content-type')).toBe('application/octet-stream')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
  })
  it('a Range read answers 206 with exactly the range (a <video> seeks)', async () => {
    const r = await stream('f1', { ...SAME, range: 'bytes=0-3' })
    expect(r.status).toBe(206)
    expect(await r.text()).toBe(BODY.slice(0, 4))
  })
  it('an unknown row 404s, a body missing on disk 410s, a path that leaves the folder 400s', async () => {
    expect((await stream('nope')).status).toBe(404)
    expect((await stream('f2')).status).toBe(410)
    expect((await stream('f3')).status).toBe(400)
    expect((await fetch(url('/api/rabbit/projects/p9/files/f1/stream'), { headers: SAME })).status).toBe(404)
  })
})

describe('the stream route: E13, one read a minute, written to the bundle', () => {
  it('the first read records ONE "downloaded" and WRITES it (touch:false); the next does not repeat it', async () => {
    await (await stream('f1')).text()
    expect(logged).toEqual([expect.objectContaining({ file_id: 'f1', event: 'downloaded', old_path: '1-notes.txt', size_bytes: BODY.length })])
    expect(writes).toEqual([['p1', { touch: false }]])
    await (await stream('f1', { ...SAME, range: 'bytes=4-9' })).text()
    expect(logged).toHaveLength(1)
  })
  it('a probe (?probe=1) is a machine read: nothing recorded', async () => {
    bundle.files.push({ id: 'f4', name: 'p.txt', mime_type: 'text/plain', storage_path: '1-notes.txt', storage_provider: 'local' })
    await (await stream('f4', SAME, '?probe=1')).text()
    expect(logged).toEqual([])
    expect(writes).toEqual([])
    // CONTROL: the same file read for real IS recorded.
    await (await stream('f4')).text()
    expect(logged.map((e) => e.file_id)).toEqual(['f4'])
  })
})

describe('?download=1: an attachment under the file\'s own name', () => {
  it('sets Content-Disposition only when asked', async () => {
    const asked = await fetch(url('/dl/Treatment%20v2.pdf?download=1'))
    expect(asked.headers.get('content-disposition')).toMatch(/^attachment; filename="Treatment v2\.pdf"/)
    const plain = await fetch(url('/dl/Treatment.pdf'))
    expect(plain.headers.get('content-disposition')).toBeNull()
  })
})

describe('main.cjs mounts these and nothing of its own', () => {
  const MAIN = readFileSync(resolve(here, '../../electron/main.cjs'), 'utf8')
  it('the stream is mountFileStreamRead with main\'s helpers, after the download route and before the SPA fallback', () => {
    const at = MAIN.indexOf("require('./fileReads.cjs').mountFileStreamRead(expressApp, {")
    expect(at).toBeGreaterThan(MAIN.indexOf("expressApp.get('/api/rabbit/projects/:projectId/files/:id/download'"))
    expect(at).toBeLessThan(MAIN.indexOf("expressApp.get('/{*splat}'"))
    expect(MAIN.slice(at, MAIN.indexOf('});', at))).toContain('rabbitLogFileEvent, writeRabbitBundle, safeMediaContentType, shouldLogManagedRead,')
    expect(MAIN).not.toContain("expressApp.get('/api/rabbit/projects/:projectId/files/:id/stream'")
  })
  it('the download route asks attachWhenAsked with the file\'s own name', () => {
    const at = MAIN.indexOf("expressApp.get('/api/rabbit/projects/:projectId/files/:id/download'")
    const body = MAIN.slice(at, MAIN.indexOf('\n    });', at))
    expect(body).toContain("require('./fileReads.cjs').attachWhenAsked(req, res, file.name, require('./localMedia.cjs').contentDisposition);")
    expect(body.indexOf('attachWhenAsked(')).toBeLessThan(body.indexOf('res.sendFile(diskPath)'))
  })
})
