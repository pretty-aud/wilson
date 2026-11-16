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
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

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
