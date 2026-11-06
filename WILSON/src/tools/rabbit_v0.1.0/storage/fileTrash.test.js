// @vitest-environment node
// fileTrash.test.js — MO1 (MOTH_DESIGN §1.8): a desktop project's 30-day trash, on real files.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'

const require = createRequire(import.meta.url)
const { mountFileTrash, isMothExcluded, RETENTION_MS } = require('../../../../electron/fileTrash.cjs')
const { resolveContainedFilePath } = require('../../../../electron/pathContainment.cjs')

const PID = 'p1'
let dir, bundle, server, base, clock, writes

const f = (id, extra = {}) => ({ id, name: `${id}.mov`, storage_path: `${id}.mov`, storage_provider: 'local_server', size_bytes: 3, ...extra })
const call = async (method, url, body) => {
  const r = await fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, body: await r.json() }
}
const onDisk = (rel) => fs.existsSync(path.join(dir, rel))

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-trash-'))
  for (const id of ['a', 'b', 'c']) fs.writeFileSync(path.join(dir, `${id}.mov`), 'abc')
  bundle = { files: [f('a'), f('b'), f('c')], fileEvents: [] }
  clock = Date.parse('2026-11-01T00:00:00Z')
  writes = 0
  const app = express()
  app.use(express.json())
  mountFileTrash(app, {
    fs, path,
    readRabbitBundle: (id) => (id === PID ? bundle : null),
    writeRabbitBundle: () => { writes += 1 },
    rabbitNotFound: (res, what = 'project') => res.status(404).json({ error: `${what} not found` }),
    rabbitRemoveFrom: (list, id) => { const i = list.findIndex((x) => x.id === id); if (i >= 0) list.splice(i, 1) },
    resolveFileBaseDir: () => dir,
    resolveContainedFilePath,
    rabbitLogFileEvent: (b, e) => b.fileEvents.push(e),
    now: () => clock,
  })
  await new Promise((ok) => { server = app.listen(0, '127.0.0.1', ok) })
  base = `http://127.0.0.1:${server.address().port}`
})
afterEach(async () => {
  await new Promise((ok) => server.close(ok))
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('a delete', () => {
  it('moves the row and the body, and removes nothing', async () => {
    expect((await call('DELETE', `/api/rabbit/projects/${PID}/files/a`)).status).toBe(200)
    expect(bundle.files.map((x) => x.id)).toEqual(['b', 'c'])
    expect(bundle.trashedFiles[0].row.id).toBe('a')
    expect(onDisk('a.mov')).toBe(false)
    expect(onDisk('.trash/a-a.mov')).toBe(true)
    expect(bundle.fileEvents.map((e) => e.event)).toEqual(['trashed'])
  })
  it('writes the row before it moves the body, so a crash between leaves a row that knows where it is', async () => {
    await call('DELETE', `/api/rabbit/projects/${PID}/files/a`)
    expect(writes).toBe(2)
  })
  it('a body already gone still trashes the row, marked as never moved', async () => {
    fs.unlinkSync(path.join(dir, 'a.mov'))
    await call('DELETE', `/api/rabbit/projects/${PID}/files/a`)
    expect(bundle.trashedFiles[0].moved).toBe(false)
  })
  it('of a file that is not there answers as it did', async () => {
    expect((await call('DELETE', `/api/rabbit/projects/${PID}/files/zz`)).body).toEqual({ ok: true })
  })
  it('a key that climbs out of the folder moves nothing', async () => {
    const outside = path.join(path.dirname(dir), 'outside-trash.mov')
    fs.writeFileSync(outside, 'x')
    bundle.files.push(f('e', { storage_path: '../outside-trash.mov' }))
    await call('DELETE', `/api/rabbit/projects/${PID}/files/e`)
    expect(fs.existsSync(outside)).toBe(true)
    fs.unlinkSync(outside)
  })
})

describe('a restore', () => {
  it('brings the row and the body back, and says so', async () => {
    await call('DELETE', `/api/rabbit/projects/${PID}/files/a`)
    expect((await call('POST', `/api/rabbit/projects/${PID}/files/a/restore`)).body).toEqual({ done: 1, ops: [] })
    expect(bundle.files.map((x) => x.id)).toContain('a')
    expect(bundle.trashedFiles).toEqual([])
    expect(onDisk('a.mov')).toBe(true)
    expect(bundle.fileEvents.map((e) => e.event)).toEqual(['trashed', 'restored'])
  })
  it('a name taken since is refused, and nothing moves', async () => {
    await call('DELETE', `/api/rabbit/projects/${PID}/files/a`)
    fs.writeFileSync(path.join(dir, 'a.mov'), 'new')
    const out = await call('POST', `/api/rabbit/projects/${PID}/files/a/restore`)
    expect(out.status).toBe(409)
    expect(out.body.error).toBe('name_taken')
    expect(onDisk('.trash/a-a.mov')).toBe(true)
    expect(fs.readFileSync(path.join(dir, 'a.mov'), 'utf8')).toBe('new')
  })
  it('a live row adds nothing, and one that does not exist reads as not there', async () => {
    expect((await call('POST', `/api/rabbit/projects/${PID}/files/restore`, { ids: ['b'] })).body.done).toBe(0)
    expect((await call('POST', `/api/rabbit/projects/${PID}/files/restore`, { ids: ['zz'] })).status).toBe(404)
  })
  it('a batch is whole: one name taken restores none of it', async () => {
    await call('DELETE', `/api/rabbit/projects/${PID}/files/a`)
    await call('DELETE', `/api/rabbit/projects/${PID}/files/b`)
    fs.writeFileSync(path.join(dir, 'b.mov'), 'new')
    expect((await call('POST', `/api/rabbit/projects/${PID}/files/restore`, { ids: ['a', 'b'] })).status).toBe(409)
    expect(bundle.trashedFiles.length).toBe(2)
  })
})

describe("Moth's batch", () => {
  it('trashes a batch, once each', async () => {
    expect((await call('POST', `/api/rabbit/projects/${PID}/files/trash`, { ids: ['a', 'b', 'a'] })).body).toEqual({ done: 2, ops: [] })
  })
  it('one invoice in it trashes nothing, and reads as not there', async () => {
    bundle.files.push(f('inv', { is_financial: true }))
    expect((await call('POST', `/api/rabbit/projects/${PID}/files/trash`, { ids: ['a', 'inv'] })).status).toBe(404)
    expect(bundle.files.map((x) => x.id)).toContain('a')
    expect(bundle.trashedFiles ?? []).toEqual([])
  })
  it('the one exclusion: a flag, a tag, a key, a folder and an expense', () => {
    const b = { folders: [{ id: 'm', slug: 'invoices', path: 'Old' }, { id: 'k', parent_id: 'm', slug: 'x', path: 'Old/x' }, { id: 'ok', slug: 'rushes', path: 'rushes' }], expenses: [{ file_ids: ['r'] }] }
    expect(isMothExcluded(b, { id: '1', is_financial: true })).toBe(true)
    expect(isMothExcluded(b, { id: '2', tags: ['legal'] })).toBe(true)
    expect(isMothExcluded(b, { id: '3', storage_path: 'INVOICES/a.pdf' })).toBe(true)
    expect(isMothExcluded(b, { id: '4', folder_id: 'k' })).toBe(true)
    expect(isMothExcluded(b, { id: 'r' })).toBe(true)
    expect(isMothExcluded(b, { id: '5', folder_id: 'ok', storage_path: 'a.mov' })).toBe(false)
  })
})

describe('a managed file', () => {
  it('comes back, and one of a deleted asset stays gone', async () => {
    bundle.managedFiles = [{ id: 'm1', asset_id: 'as', deleted_at: 'then' }, { id: 'm2', asset_id: 'gone', deleted_at: 'then' }, { id: 'm3', deleted_at: 'then' }]
    bundle.assets = [{ id: 'as' }]
    expect((await call('POST', `/api/rabbit/projects/${PID}/managed-files/m1/restore`)).body).toEqual({ done: 1, ops: [] })
    expect(bundle.managedFiles[0].deleted_at).toBeUndefined()
    expect((await call('POST', `/api/rabbit/projects/${PID}/managed-files/m1/restore`)).body.done).toBe(0)
    expect((await call('POST', `/api/rabbit/projects/${PID}/managed-files/m2/restore`)).status).toBe(404)
    expect((await call('POST', `/api/rabbit/projects/${PID}/managed-files/m3/restore`)).body.done).toBe(1)
    expect((await call('POST', `/api/rabbit/projects/${PID}/managed-files/zz/restore`)).status).toBe(404)
  })
})

describe('a relink', () => {
  it('waits while a body in the trash would be left behind', async () => {
    await call('DELETE', `/api/rabbit/projects/${PID}/files/a`)
    expect((await call('POST', `/api/rabbit/projects/${PID}/files/relink-apply`, {})).body.error).toBe('trash_would_strand')
    await call('POST', `/api/rabbit/projects/${PID}/files/a/restore`)
    const through = await fetch(`${base}/api/rabbit/projects/${PID}/files/relink-apply`, { method: 'POST' })
    expect(through.status).toBe(404) // on to the route in main.cjs, which this test does not mount
  })
})

describe('the view and the purge', () => {
  it('the view hands out no path, and says when it goes', async () => {
    await call('DELETE', `/api/rabbit/projects/${PID}/files/a`)
    const [row] = (await call('GET', `/api/rabbit/projects/${PID}/trash`)).body
    expect(row.id).toBe('a')
    expect(row.purges_at).toBe(new Date(clock + RETENTION_MS).toISOString())
    expect(JSON.stringify(row)).not.toContain('.trash')
    expect(row.storage_path).toBeUndefined()
  })
  it('the purge takes what is over 30 days, certifies it, and leaves the rest', async () => {
    await call('DELETE', `/api/rabbit/projects/${PID}/files/a`)
    clock += RETENTION_MS - 1000
    await call('DELETE', `/api/rabbit/projects/${PID}/files/b`)
    clock += 2000
    expect((await call('POST', `/api/rabbit/projects/${PID}/trash/purge-expired`)).body).toEqual({ purged: 1 })
    expect(onDisk('.trash/a-a.mov')).toBe(false)
    expect(onDisk('.trash/b-b.mov')).toBe(true)
    expect(bundle.fileEvents.filter((e) => e.event === 'purged').map((e) => [e.file_id, e.blob_removed])).toEqual([['a', true]])
  })
  it('never unlinks outside the folder', async () => {
    const outside = path.join(path.dirname(dir), 'outside-purge.mov')
    fs.writeFileSync(outside, 'x')
    bundle.trashedFiles = [{ row: f('e', { storage_path: '../outside-purge.mov' }), trashed_at: new Date(0).toISOString(), trash_name: 'e-e.mov', moved: false }]
    await call('POST', `/api/rabbit/projects/${PID}/trash/purge-expired`)
    expect(fs.existsSync(outside)).toBe(true)
    fs.unlinkSync(outside)
  })
})
