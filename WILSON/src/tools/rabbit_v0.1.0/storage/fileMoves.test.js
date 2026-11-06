// @vitest-environment node
// fileMoves.test.js — MO1 (MOTH_DESIGN §1.8, her answer 2): moves on one computer, on real files.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'

const require = createRequire(import.meta.url)
const { mountFileMoves, moveBody } = require('../../../../electron/fileMoves.cjs')
const { resolveContainedFilePath } = require('../../../../electron/pathContainment.cjs')

let root, server, base, bundles, api, failWrite
const f = (id, extra = {}) => ({ id, name: `${id}.mov`, storage_path: `${id}.mov`, storage_provider: 'local_server', ...extra })
const dirOf = (p) => path.join(root, p)
const call = async (method, url, body) => {
  const r = await fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })
  return { status: r.status, body: await r.json() }
}
const journals = () => (fs.existsSync(path.join(root, 'moves')) ? fs.readdirSync(path.join(root, 'moves')) : [])

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'file-moves-'))
  for (const p of ['p1', 'p2']) fs.mkdirSync(dirOf(p))
  fs.writeFileSync(path.join(dirOf('p1'), 'a.mov'), 'aaa')
  fs.writeFileSync(path.join(dirOf('p1'), 'b.mov'), 'bbb')
  bundles = {
    p1: { files: [f('a', { task_id: 't', is_core_definer: true }), f('b'), f('inv', { is_financial: true })], folders: [{ id: 'fo', slug: 'rushes', path: 'rushes' }], fileEvents: [] },
    p2: { files: [], folders: [{ id: 'in', slug: 'in', path: 'in' }, { id: 'mon', slug: 'invoices', path: 'INVOICES' }], fileEvents: [] },
  }
  failWrite = null
  const app = express()
  app.use(express.json())
  api = mountFileMoves(app, {
    fs, path,
    readRabbitBundle: (id) => (bundles[id] ? JSON.parse(JSON.stringify(bundles[id])) : null),
    writeRabbitBundle: (id, b) => {
      if (failWrite === id) { failWrite = null; throw new Error('the disk said no') }
      bundles[id] = JSON.parse(JSON.stringify(b))
    },
    rabbitNotFound: (res, what = 'project') => res.status(404).json({ error: `${what} not found` }),
    rabbitRemoveFrom: (list, id) => { const i = list.findIndex((x) => x.id === id); if (i >= 0) list.splice(i, 1) },
    resolveFileBaseDir: (_b, id) => dirOf(id),
    resolveContainedFilePath,
    rabbitLogFileEvent: (b, e) => b.fileEvents.push(e),
    writeJsonAtomic: (file, data) => fs.writeFileSync(file, JSON.stringify(data)),
    movesDir: () => path.join(root, 'moves'),
  })
  await new Promise((ok) => { server = app.listen(0, '127.0.0.1', ok) })
  base = `http://127.0.0.1:${server.address().port}`
})
afterEach(async () => {
  await new Promise((ok) => server.close(ok))
  fs.rmSync(root, { recursive: true, force: true })
})

const MOVE = '/api/rabbit/files/move-between-projects'

describe('within a project', () => {
  it('only the folder changes', async () => {
    expect((await call('POST', '/api/rabbit/projects/p1/files/move', { ids: ['a'], folder_id: 'fo' })).body).toEqual({ moved: 1 })
    const a = bundles.p1.files.find((x) => x.id === 'a')
    expect([a.folder_id, a.task_id, a.is_core_definer]).toEqual(['fo', 't', true])
  })
  it('an invoice and a folder that is not there read as not there', async () => {
    expect((await call('POST', '/api/rabbit/projects/p1/files/move', { ids: ['inv'] })).status).toBe(404)
    expect((await call('POST', '/api/rabbit/projects/p1/files/move', { ids: ['a'], folder_id: 'zz' })).status).toBe(404)
  })
})

describe('between projects', () => {
  it('the row and the body go, the links and the flag stay behind, and the journal is gone', async () => {
    const out = await call('POST', MOVE, { ids: ['a'], from_project: 'p1', to_project: 'p2', to_folder: 'in' })
    expect(out.body.moved).toBe(1)
    const a = bundles.p2.files[0]
    expect([a.id, a.project_id, a.folder_id, a.task_id, a.is_core_definer]).toEqual(['a', 'p2', 'in', null, false])
    expect(bundles.p1.files.some((x) => x.id === 'a')).toBe(false)
    expect(fs.existsSync(path.join(dirOf('p2'), 'a.mov'))).toBe(true)
    expect(fs.existsSync(path.join(dirOf('p1'), 'a.mov'))).toBe(false)
    expect(journals()).toEqual([])
    expect(bundles.p1.fileEvents.map((e) => e.event)).toEqual(['moved_out'])
    expect(bundles.p2.fileEvents.map((e) => e.event)).toEqual(['moved_in'])
  })
  it('refuses before anything moves: an invoice in the batch, a money folder, a name taken', async () => {
    expect((await call('POST', MOVE, { ids: ['a', 'inv'], from_project: 'p1', to_project: 'p2' })).status).toBe(404)
    expect((await call('POST', MOVE, { ids: ['a'], from_project: 'p1', to_project: 'p2', to_folder: 'mon' })).status).toBe(404)
    fs.writeFileSync(path.join(dirOf('p2'), 'b.mov'), 'there')
    expect((await call('POST', MOVE, { ids: ['a', 'b'], from_project: 'p1', to_project: 'p2' })).status).toBe(409)
    expect(fs.existsSync(path.join(dirOf('p1'), 'a.mov'))).toBe(true)
    expect(journals()).toEqual([])
  })
  it('the same project, or no file, is a bad request', async () => {
    expect((await call('POST', MOVE, { ids: ['a'], from_project: 'p1', to_project: 'p1' })).status).toBe(400)
    expect((await call('POST', MOVE, { ids: [], from_project: 'p1', to_project: 'p2' })).status).toBe(400)
  })
  it('🚨 a write that fails leaves the journal, and recovery finishes it', async () => {
    failWrite = 'p1'
    const out = await call('POST', MOVE, { ids: ['a'], from_project: 'p1', to_project: 'p2' })
    expect(out.status).toBe(500)
    expect(journals().length).toBe(1)
    expect(fs.existsSync(path.join(dirOf('p2'), 'a.mov'))).toBe(true)
    expect(api.recoverMoves()).toEqual({ recovered: 1, left: 0 })
    expect(journals()).toEqual([])
    expect(bundles.p1.files.some((x) => x.id === 'a')).toBe(false)
    expect(bundles.p2.files.filter((x) => x.id === 'a').length).toBe(1)
  })
  it('recovery with a project away leaves the journal for next time', async () => {
    fs.mkdirSync(path.join(root, 'moves'))
    fs.writeFileSync(path.join(root, 'moves', 'x.json'), JSON.stringify({ op: 'x', from_project: 'gone', to_project: 'p2', items: [] }))
    expect(api.recoverMoves()).toEqual({ recovered: 0, left: 1 })
    expect(journals()).toEqual(['x.json'])
  })
  it('both copies after a crash: a proved copy lets the original go, an unproved one is removed', async () => {
    fs.writeFileSync(path.join(dirOf('p2'), 'a.mov'), 'aaa')
    fs.mkdirSync(path.join(root, 'moves'))
    fs.writeFileSync(path.join(root, 'moves', 'x.json'), JSON.stringify({ op: 'x', from_project: 'p1', to_project: 'p2', items: [{ row: f('a') }] }))
    api.recoverMoves()
    expect(fs.existsSync(path.join(dirOf('p1'), 'a.mov'))).toBe(false)
    fs.writeFileSync(path.join(dirOf('p2'), 'b.mov'), 'half')
    fs.writeFileSync(path.join(root, 'moves', 'y.json'), JSON.stringify({ op: 'y', from_project: 'p1', to_project: 'p2', items: [{ row: f('b') }] }))
    api.recoverMoves()
    expect(fs.readFileSync(path.join(dirOf('p2'), 'b.mov'), 'utf8')).toBe('bbb')
  })
})

describe('moveBody', () => {
  it('across volumes: a copy, proved, then the original goes; a bad copy keeps the original', () => {
    const from = path.join(root, 'x.bin')
    const to = path.join(root, 'y.bin')
    fs.writeFileSync(from, 'xyz')
    const cross = { ...fs, renameSync: () => { const e = new Error('x'); e.code = 'EXDEV'; throw e } }
    moveBody(cross, from, to)
    expect(fs.existsSync(from)).toBe(false)
    expect(fs.readFileSync(to, 'utf8')).toBe('xyz')
    fs.writeFileSync(from, 'abc')
    const bad = { ...cross, copyFileSync: (a, b) => fs.writeFileSync(b, 'ab') }
    fs.unlinkSync(to)
    expect(() => moveBody(bad, from, to)).toThrow('did not match')
    expect(fs.existsSync(from)).toBe(true)
    expect(fs.existsSync(to)).toBe(false)
  })
})
