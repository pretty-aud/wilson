// =============================================================================
// rabbitBinsOpen.test.js — the Bins inspector's "Open" (POST …/bin-files/:id/
// open) keeps the Files explorer's rule: deny by default (post-overhaul S4a,
// review round 2, R2-SEC-01, measured: the route handed ANY file to the
// operating system, and a bin import walks a folder whole — `Take3.mov.cmd`
// lists as "Take3.mov").
//
// The real electron/rabbitBins.cjs on real Express, with a RECORDING shell, over
// real files in a temp folder. Every refusal has a presence control beside it.
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
const calls = []
const shell = {
  openPath: async (p) => { calls.push(['open', p]); return '' },
  showItemInFolder: (p) => { calls.push(['reveal', p]) },
}
let root, server, base
const PID = 'proj-open'
const ROWS = {}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wilson-bins-open-'))
  const make = (name, body = 'x') => { const p = path.join(root, name); fs.writeFileSync(p, body); return p }
  ROWS.cmd = make('Take3.mov.cmd', '@echo off')
  ROWS.scm = make('Scene 12.settingcontent-ms', '<x/>')
  ROWS.mov = make('A001C001.mov', 'mov')
  ROWS.dir = path.join(root, 'Day01'); fs.mkdirSync(ROWS.dir)
  const exe = make('tool.exe', 'MZ')
  ROWS.link = path.join(root, 'linked-take.mov')
  try { fs.symlinkSync(exe, ROWS.link, 'file') } catch { ROWS.link = null }
  // …and a link to an ALLOWED file elsewhere: what opens must be the target.
  const realTake = make('real-take.mp4', 'mp4')
  ROWS.okLink = path.join(root, 'proxy-take.mov')
  try { fs.symlinkSync(realTake, ROWS.okLink, 'file') } catch { ROWS.okLink = null }
  const binFiles = Object.entries(ROWS).filter(([, p]) => p).map(([k, p]) => ({
    id: `b-${k}`, bin_id: 'bin1', display_name: path.basename(p), original_name: path.basename(p), source_path: p,
    media_type: 'video', online: true,
  }))
  store.set(PID, JSON.stringify({ project: { id: PID, title: 'Open test' }, bins: [{ id: 'bin1', name: 'Footage' }], binFiles }))

  const app = express()
  app.use(express.json())
  mountRabbitBins(app, {
    readRabbitBundle: (id) => (store.has(id) ? JSON.parse(store.get(id)) : null),
    writeRabbitBundle: (id, b) => { store.set(id, JSON.stringify(b)) },
    rabbitTouch: (r) => r, rabbitUpsertInto: (a, r) => r, rabbitRemoveFrom: () => true,
    rabbitNotFound: (res, what = 'project') => res.status(404).json({ error: `${what} not found` }),
    getThumbCacheDir: () => root, generateVideoThumbOnce: async () => ({ ok: false }),
    safeMediaContentType: () => 'application/octet-stream',
    userAuthorizedDirs: new Set(), dialog: {}, getMainWindow: () => ({}), shell,
  })
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve) })
  base = `http://127.0.0.1:${server.address().port}`
})
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  fs.rmSync(root, { recursive: true, force: true })
})

const open = async (key, reveal = false) => {
  calls.length = 0
  const r = await fetch(`${base}/api/rabbit/projects/${PID}/bin-files/b-${key}/open`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ reveal }),
  })
  return { status: r.status, body: await r.json() }
}

describe('Bins "Open": deny by default (R2-SEC-01)', () => {
  it('🚨 a script named like a take is REFUSED, and the shell is never asked to open it', async () => {
    const r = await open('cmd')
    expect(r).toEqual({ status: 422, body: { error: 'WILSON does not open programs or scripts. Use Show in folder to see it.', code: 'refused_type' } })
    expect(calls).toEqual([])
  })

  it('a launch type the old route never thought of (.settingcontent-ms) is refused too', async () => {
    const r = await open('scm')
    expect(r.status).toBe(422)
    expect(calls).toEqual([])
  })

  it('a link named like a take that leads to a program is refused (where this machine can make one)', async (ctx) => {
    if (!ROWS.link) { ctx.skip(); return }
    const r = await open('link')
    expect(r.status).toBe(422)
    expect(calls).toEqual([])
  })

  it('a link to an allowed file opens THE TARGET, the file that was judged (where links can be made)', async (ctx) => {
    if (!ROWS.okLink) { ctx.skip(); return }
    const r = await open('okLink')
    expect(r.status).toBe(200)
    expect(calls).toEqual([['open', fs.realpathSync(ROWS.okLink)]])
    expect(calls[0][1].toLowerCase().endsWith('real-take.mp4')).toBe(true)
  })

  it('CONTROL: a real take opens, by its real path', async () => {
    const r = await open('mov')
    expect(r).toEqual({ status: 200, body: { ok: true } })
    expect(calls).toEqual([['open', fs.realpathSync(ROWS.mov)]])
  })

  it('a folder still opens in Explorer; Show in folder reveals even a script and opens nothing', async () => {
    expect((await open('dir')).status).toBe(200)
    expect(calls).toEqual([['open', ROWS.dir]])
    expect((await open('cmd', true)).status).toBe(200)
    expect(calls).toEqual([['reveal', ROWS.cmd]])
  })
})
