// =============================================================================
// spaFallback.test.js — the Local Server's SPA fallback answers every in-app
// address from a dist under a dot-folder (electron/spaFallback.cjs).
//
// Served for real: Express (the app's version), express.static, the fallback
// and the app's own localServerErrorHandler, on a loopback port, over a dist
// at `<tmp>/.claude/worktrees/x/dist` — the shape of a session's worktree.
// The CONTROL plants the old absolute form and shows it fails exactly as
// measured in Electron: `/` 200 (express.static is root-relative), every
// other address "500 internal error"; and that the same form passes from a
// path with no dot-folder, so the test is about the dot, not the server.
//
// F12 (2026-11-18): the web preview (scripts/serve-web.mjs) had the same
// absolute form and has the same fallback now; its cases are at the end.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const express = require('express')
const { sendSpaIndex } = require('../../electron/spaFallback.cjs')
const { localServerErrorHandler } = require('../../electron/localToken.cjs')

const here = dirname(fileURLToPath(import.meta.url))
const INDEX = '<!doctype html><title>WILSON</title>'
let base, underDot, plain

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'spa-fallback-'))
  underDot = join(base, '.claude', 'worktrees', 'x', 'dist')
  plain = join(base, 'plain', 'dist')
  for (const d of [underDot, plain]) {
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, 'index.html'), INDEX)
  }
})
afterAll(() => { rmSync(base, { recursive: true, force: true }) })

/** Mount as main.cjs does, then GET `/`, a tool page and a nested address. */
async function serve(handler, dist) {
  const app = express()
  app.use(express.static(dist))
  app.get('/{*splat}', handler)
  app.use(localServerErrorHandler)
  const server = await new Promise((done) => { const s = app.listen(0, '127.0.0.1', () => done(s)) })
  const { port } = server.address()
  const get = async (p) => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`)
    return { status: res.status, body: await res.text() }
  }
  try {
    return { root: await get('/'), page: await get('/rabbit'), nested: await get('/rabbit/files/3') }
  } finally {
    await new Promise((done) => server.close(done))
  }
}

// The form main.cjs used until 2026-10-01.
const absolute = (dist) => (req, res) => { res.sendFile(join(dist, 'index.html')) }

describe('the SPA fallback (Local Server)', () => {
  it('answers every in-app address with index.html from a dist under a dot-folder', async () => {
    const r = await serve(sendSpaIndex(underDot), underDot)
    for (const [where, got] of Object.entries(r)) {
      expect(got.status, where).toBe(200)
      expect(got.body, where).toBe(INDEX)
    }
  })

  it('and from a path with no dot-folder (the installed app, a plain checkout)', async () => {
    const r = await serve(sendSpaIndex(plain), plain)
    expect([r.root.status, r.page.status, r.nested.status]).toEqual([200, 200, 200])
  })

  it('CONTROL: the old absolute form fails under the dot-folder exactly as measured, and passes without it', async () => {
    const bad = await serve(absolute(underDot), underDot)
    expect(bad.root.status).toBe(200)
    expect(bad.page).toEqual({ status: 500, body: 'internal error' })
    expect(bad.nested).toEqual({ status: 500, body: 'internal error' })
    const ok = await serve(absolute(plain), plain)
    expect(ok.page.status).toBe(200)
  })

  it('main.cjs mounts it, and no absolute sendFile of index.html is left', () => {
    const main = readFileSync(resolve(here, '../../electron/main.cjs'), 'utf8')
    expect(main).toContain("expressApp.get('/{*splat}', require('./spaFallback.cjs').sendSpaIndex(distPath));")
    expect(main).not.toMatch(/sendFile\(\s*path\.join\(\s*distPath\s*,\s*['"]index\.html['"]\s*\)/)
  })
})

// ── F12 (desktop-build D2): the web preview has the same fallback ───────────
// scripts/serve-web.mjs (`npm run preview:web`, and the Playwright web lane)
// sent index.html by ABSOLUTE path: the form the CONTROL above shows failing
// under a dot-folder, which every session worktree is, so a deep link into
// the web build could not be previewed from one. It mounts sendSpaIndex now,
// and exports its app so this file can serve it without the script listening.
const SCRIPT = resolve(here, '../../scripts/serve-web.mjs')

/** Listen on a loopback port, GET each path without following a redirect, close. */
async function ask(app, paths) {
  const server = await new Promise((done) => { const s = app.listen(0, '127.0.0.1', () => done(s)) })
  const { port } = server.address()
  try {
    const out = {}
    for (const p of paths) {
      const res = await fetch(`http://127.0.0.1:${port}${p}`, { redirect: 'manual' })
      out[p] = { status: res.status, location: res.headers.get('location'), body: await res.text() }
    }
    return out
  } finally {
    await new Promise((done) => server.close(done))
  }
}

describe('the web preview, scripts/serve-web.mjs (F12)', () => {
  it('serves /wilson/, a tool page and a nested address from a build under a dot-folder, and sends the bare origin to /wilson', async () => {
    const { webPreviewApp } = await import('../../scripts/serve-web.mjs')
    const r = await ask(webPreviewApp(underDot), ['/', '/wilson/', '/wilson/dog', '/wilson/rabbit/files/3'])
    expect(r['/']).toMatchObject({ status: 302, location: '/wilson' })
    for (const p of ['/wilson/', '/wilson/dog', '/wilson/rabbit/files/3']) {
      expect(r[p], p).toMatchObject({ status: 200, body: INDEX })
    }
    // …and from a path with no dot-folder, as before.
    expect((await ask(webPreviewApp(plain), ['/wilson/dog']))['/wilson/dog']).toMatchObject({ status: 200, body: INDEX })
  })

  it('CONTROL: the absolute form it used answers a deep link 404 under the dot-folder, and 200 without it', async () => {
    const old = (dist) => {
      const app = express()
      app.use('/wilson', express.static(dist))
      app.get('/wilson/{*splat}', (_req, res) => { res.sendFile(join(dist, 'index.html')) })
      return app
    }
    const bad = await ask(old(underDot), ['/wilson/', '/wilson/dog'])
    expect(bad['/wilson/'].status).toBe(200) // express.static is root-relative
    expect(bad['/wilson/dog'].status).toBe(404)
    expect((await ask(old(plain), ['/wilson/dog']))['/wilson/dog'].status).toBe(200)
  })

  it('imported, it does not listen: a process that only imports it ends at once, with nothing said', async () => {
    // A listener would keep that process alive (and, unguarded, would open port 4174 on every
    // address in every test run). Review round 1: the order of two words in the source proved
    // nothing; this is the behaviour.
    const importer = `await import(${JSON.stringify(pathToFileURL(SCRIPT).href)})`
    const child = spawn(process.execPath, ['--input-type=module', '-e', importer], { env: { ...process.env, PORT: '0', HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let said = ''
    child.stdout.on('data', (c) => { said += c })
    child.stderr.on('data', (c) => { said += c })
    const code = await new Promise((done) => {
      const timer = setTimeout(() => { child.kill(); done('still running after 15 s') }, 15_000)
      child.on('exit', (c) => { clearTimeout(timer); done(c) })
    })
    expect(code, said).toBe(0)
    expect(said).not.toContain('serving dist-web')
  }, 30_000)

  it('run as a script it listens and says the port it took (the Playwright web lane starts it so)', async () => {
    const src = readFileSync(SCRIPT, 'utf8')
    expect(src.match(/\.listen\(/g)).toHaveLength(1)
    expect(src).not.toMatch(/sendFile\(/)
    // PORT=0: any free port, so nothing here can collide with a preview someone has open on 4174.
    // HOST=127.0.0.1: this computer only, as every other listener in the suite (unset, the script
    // listens on every address, as `npm run preview:web` always has).
    const child = spawn(process.execPath, [SCRIPT], { env: { ...process.env, PORT: '0', HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      const port = await new Promise((done, fail) => {
        let said = ''
        const timer = setTimeout(() => fail(new Error(`the script printed no address in 15 s: ${said}`)), 15_000)
        const read = (chunk) => {
          said += chunk
          const m = said.match(/http:\/\/localhost:(\d+)\/wilson/)
          if (m) { clearTimeout(timer); done(Number(m[1])) }
        }
        child.stdout.on('data', read)
        child.stderr.on('data', read)
        child.on('exit', (code) => { clearTimeout(timer); fail(new Error(`the script exited (${code}) before listening: ${said}`)) })
      })
      expect(port).toBeGreaterThan(0)
      const res = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual' })
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/wilson')
    } finally {
      child.kill()
    }
  }, 30_000)
})
