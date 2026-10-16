// =============================================================================
// connectionRoute.test.js — the desktop's GET /api/rabbit/connection
// (electron/connectionProbe.cjs, post-overhaul FX11), driven through a real
// express app on temp folders, the way localMedia.test.js drives its routes.
//
// What this pins:
//   * both folders there: both parts answer, the files root's kind named and
//     its path NOT sent;
//   * a files root that is gone (the NAS unmounted, a folder deleted): the
//     data part answers and the files part does not — the dot's amber;
//   * a root that does not answer (a dead SMB share): the answer comes back
//     at the ceiling as `timeout`, and the stat is NOT started again while it
//     is still pending (single flight — one pool thread, never one a minute);
//   * the data folder unavailable (the demo folder missing): a 503 with the
//     sentence;
//   * a file where a folder should be is not "there".
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'

const require = createRequire(import.meta.url)
const { mountConnectionProbe, ROUTE, DEFAULT_TIMEOUT_MS } = require('../../../../electron/connectionProbe.cjs')

let dataDir, filesDir, notADir
const servers = []

async function serve(opts) {
  const app = express()
  mountConnectionProbe(app, opts)
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)) })
  servers.push(server)
  return `http://127.0.0.1:${server.address().port}${ROUTE}`
}

beforeAll(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wilson-conn-data-'))
  filesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wilson-conn-files-'))
  notADir = path.join(dataDir, 'a-file.txt')
  fs.writeFileSync(notADir, 'x')
})

afterAll(async () => {
  for (const s of servers) await new Promise((r) => s.close(r))
  fs.rmSync(dataDir, { recursive: true, force: true })
  fs.rmSync(filesDir, { recursive: true, force: true })
})

describe('GET /api/rabbit/connection', () => {
  it('both folders there: both answer, the kind is named, and no path is sent', async () => {
    const url = await serve({ getDataDir: () => dataDir, getFilesRoot: () => ({ root: filesDir, kind: 'workspace' }) })
    const res = await fetch(url)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    expect(body).toEqual({ data: { ok: true }, files: { ok: true, kind: 'workspace' } })
    expect(JSON.stringify(body)).not.toContain(filesDir)
    expect(JSON.stringify(body)).not.toContain(dataDir)
  })

  it('a files root that is gone: the data answers, the files do not', async () => {
    const url = await serve({ getDataDir: () => dataDir, getFilesRoot: () => ({ root: path.join(filesDir, 'unmounted-share'), kind: 'workspace' }) })
    expect(await (await fetch(url)).json()).toEqual({ data: { ok: true }, files: { ok: false, why: 'missing', kind: 'workspace' } })
  })

  it('a file where the folder should be is not "there"; no root at all is not "there"; no kind reads app', async () => {
    const url = await serve({ getDataDir: () => dataDir, getFilesRoot: () => ({ root: notADir, kind: 'machine' }) })
    expect((await (await fetch(url)).json()).files).toEqual({ ok: false, why: 'missing', kind: 'machine' })
    const none = await serve({ getDataDir: () => dataDir, getFilesRoot: () => ({ root: null }) })
    expect((await (await fetch(none)).json()).files).toEqual({ ok: false, why: 'missing', kind: 'app' })
  })

  it('a root that does not answer comes back at the ceiling as timeout, and its stat is not started again while pending', async () => {
    let calls = 0
    let release = null
    const hung = new Promise((r) => { release = r })
    const stat = (p) => {
      if (p === filesDir) { calls += 1; return hung }
      return fs.promises.stat(p)
    }
    const url = await serve({ getDataDir: () => dataDir, getFilesRoot: () => ({ root: filesDir, kind: 'workspace' }), stat, timeoutMs: 150 })
    const t0 = Date.now()
    const first = await (await fetch(url)).json()
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(first).toEqual({ data: { ok: true }, files: { ok: false, why: 'timeout', kind: 'workspace' } })
    const second = await (await fetch(url)).json()
    expect(second.files.why).toBe('timeout')
    expect(calls).toBe(1)
    // When the share finally answers, the pending stat is let go and the next
    // request asks afresh (a second stat, answering at once).
    release(fs.statSync(filesDir))
    await new Promise((r) => setTimeout(r, 20))
    expect((await (await fetch(url)).json()).files).toEqual({ ok: true, kind: 'workspace' })
    expect(calls).toBe(2)
  })

  it('a stat that fails for another reason (a share refusing) is unreachable, not missing', async () => {
    const stat = async () => { throw Object.assign(new Error('access denied'), { code: 'EACCES' }) }
    const url = await serve({ getDataDir: () => dataDir, getFilesRoot: () => ({ root: filesDir, kind: 'workspace' }), stat })
    expect(await (await fetch(url)).json()).toEqual({ data: { ok: false, why: 'unreachable' }, files: { ok: false, why: 'unreachable', kind: 'workspace' } })
  })

  it('the data folder unavailable (the demo folder missing) is a 503 with the sentence', async () => {
    const url = await serve({
      getDataDir: () => { throw new Error('the demo folder is not available: E:\\demo — open Settings → Storage') },
      getFilesRoot: () => ({ root: filesDir, kind: 'demo' }),
    })
    const res = await fetch(url)
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/demo folder is not available/)
  })

  it('the default ceiling is a few seconds, under the dot\'s own', () => {
    expect(DEFAULT_TIMEOUT_MS).toBeGreaterThanOrEqual(1000)
    expect(DEFAULT_TIMEOUT_MS).toBeLessThan(6000)
  })
})

describe('main.cjs mounts it once, on the one root order', () => {
  const main = fs.readFileSync(path.join(path.dirname(require.resolve('../../../../electron/connectionProbe.cjs')), 'main.cjs'), 'utf8').replace(/\r\n/g, '\n')
  it('mounted once, after the local-media routes, with the data folder and configuredRoot', () => {
    expect(main.match(/mountConnectionProbe\(/g)).toHaveLength(1)
    expect(main.indexOf("require('./connectionProbe.cjs')")).toBeGreaterThan(main.indexOf("require('./localMedia.cjs').mountLocalMedia"))
    expect(main).toMatch(/getDataDir: getRabbitDataDir,/)
    expect(main).toMatch(/const at = configuredRoot\(\);\s*return at\.root \? at : \{ root: getRabbitDataDir\(\), kind: 'app' \};/)
  })
  it('resolveConfiguredRootDir is configuredRoot\'s root: one order (demo, workspace, machine)', () => {
    expect(main).toMatch(/function resolveConfiguredRootDir\(\) \{\s*return configuredRoot\(\)\.root;\s*\}/)
    const body = main.slice(main.indexOf('function configuredRoot()'), main.indexOf('function configuredRoot()') + 900)
    const order = ['kind: \'demo\'', 'kind: \'workspace\'', 'kind: \'machine\''].map((k) => body.indexOf(k))
    expect(order.every((i) => i > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })
})
