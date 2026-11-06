// @vitest-environment node
// fileTrash.test.js — MO1 (MOTH_DESIGN §1.8): a desktop project's 30-day trash, on real files.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { MONEY_SEGMENTS, moneyFolderChainLocked } from './index.js'

const require = createRequire(import.meta.url)
const { mountFileTrash, mountFilesDirGuard, isMothExcluded, RETENTION_MS } = require('../../../../electron/fileTrash.cjs')
const { resolveContainedFilePath } = require('../../../../electron/pathContainment.cjs')

const PID = 'p1'
let dir, bundle, server, base, clock, writes, lastWrite, bases = [], throwOnRename = null

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
  throwOnRename = null
  const holdable = { ...fs, renameSync: (from, to) => {
    if (throwOnRename && String(from).endsWith(throwOnRename)) { const e = new Error('held'); e.code = 'EBUSY'; throw e }
    return fs.renameSync(from, to)
  } }
  mountFileTrash(app, {
    fs: holdable, path,
    allFileBases: () => bases,
    readRabbitBundle: (id) => (id === PID ? bundle : null),
    writeRabbitBundle: (_id, _b, opts) => { writes += 1; lastWrite = opts },
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
    expect(out.body.code).toBe('name_taken')
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
    const b = { folders: [{ id: 'root', kind: 'root', slug: 'proj', path: '' }, { id: 'm', parent_id: 'root', slug: 'invoices', path: 'Old' }, { id: 'k', parent_id: 'm', slug: 'x', path: 'Old/x' }, { id: 'ok', slug: 'rushes', path: 'rushes' }], expenses: [{ file_ids: ['r'] }] }
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
    expect((await call('POST', `/api/rabbit/projects/${PID}/files/relink-apply`, {})).body.code).toBe('trash_would_strand')
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

// Whole-session review round 1.
describe('what the disk says, not what the entry says', () => {
  const entry = (id, extra = {}) => ({ row: f(id), trashed_at: new Date(clock).toISOString(), trash_name: `${id}-${id}.mov`, moved: true, ...extra })
  const toTrash = (id) => { fs.mkdirSync(path.join(dir, '.trash'), { recursive: true }); fs.renameSync(path.join(dir, `${id}.mov`), path.join(dir, '.trash', `${id}-${id}.mov`)) }
  const live = (id) => bundle.files.some((x) => x.id === id)
  const leave = (id) => { bundle.files = bundle.files.filter((x) => x.id !== id) }

  it('🚨 a rename a program holds open leaves the row knowing where its body is, and answers', async () => {
    fs.mkdirSync(path.join(dir, '.trash', 'a-a.mov'), { recursive: true }) // a folder in the way: the rename throws
    expect((await call('DELETE', `/api/rabbit/projects/${PID}/files/a`)).status).toBe(200)
    expect(bundle.trashedFiles[0].moved).toBe(false)
    expect(onDisk('a.mov')).toBe(true)
  })
  it('🚨 killed after the rename and before the flag was written: a restore still brings the body back', async () => {
    leave('a'); toTrash('a')
    bundle.trashedFiles = [entry('a', { moved: false })]
    expect((await call('POST', `/api/rabbit/projects/${PID}/files/a/restore`)).body.done).toBe(1)
    expect(onDisk('a.mov')).toBe(true)
    expect(onDisk('.trash/a-a.mov')).toBe(false)
  })
  it('🚨 killed after a restore renamed and before its row was written: the next restore finishes, not name_taken', async () => {
    leave('a')
    bundle.trashedFiles = [entry('a')]
    expect((await call('POST', `/api/rabbit/projects/${PID}/files/a/restore`)).body.done).toBe(1)
    expect(live('a')).toBe(true)
    expect(bundle.trashedFiles).toEqual([])
  })
  it('🚨 a body nobody can see is refused and keeps its entry: told Restored, the record of where it is would be gone', async () => {
    leave('a'); fs.unlinkSync(path.join(dir, 'a.mov'))
    bundle.trashedFiles = [entry('a')]
    const out = await call('POST', `/api/rabbit/projects/${PID}/files/a/restore`)
    expect(out.status).toBe(409)
    expect(out.body.code).toBe('body_not_found')
    expect(out.body.error).not.toBe('body_not_found')
    expect(bundle.trashedFiles.length).toBe(1)
    expect(live('a')).toBe(false)
  })
  it('a name another live row holds is taken, even with no body in the trash', async () => {
    leave('a')
    bundle.files.push(f('other', { storage_path: 'a.mov' }))
    bundle.trashedFiles = [entry('a')]
    expect((await call('POST', `/api/rabbit/projects/${PID}/files/a/restore`)).body.code).toBe('name_taken')
  })
  it('🚨 a restore whose body sat in another base finds it there and puts it back there', async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'file-trash-other-'))
    try {
      fs.mkdirSync(path.join(other, '.trash'))
      fs.writeFileSync(path.join(other, '.trash', 'z-z.mov'), 'zzz')
      bases = [other]
      bundle.trashedFiles = [{ row: f('z', { is_financial: true }), trashed_at: new Date(clock).toISOString(), trash_name: 'z-z.mov', moved: true }]
      expect((await call('POST', `/api/rabbit/projects/${PID}/files/z/restore`)).body.done).toBe(1)
      expect(fs.readFileSync(path.join(other, 'z.mov'), 'utf8')).toBe('zzz')
    } finally {
      bases = []
      fs.rmSync(other, { recursive: true, force: true })
    }
  })
  it('🚨 a batch that throws part way keeps what came back, and the rest stay in the trash', async () => {
    leave('a'); leave('b'); toTrash('a'); toTrash('b')
    bundle.trashedFiles = [entry('a'), entry('b')]
    fs.mkdirSync(path.join(dir, 'b.mov', 'x'), { recursive: true }) // refused as taken, so a throw needs a later hold
    fs.rmSync(path.join(dir, 'b.mov'), { recursive: true })
    throwOnRename = 'b-b.mov'
    const out = await call('POST', `/api/rabbit/projects/${PID}/files/restore`, { ids: ['a', 'b'] })
    expect(out.status).toBe(409)
    expect(out.body.done).toBe(1)
    expect(live('a')).toBe(true)
    expect(bundle.trashedFiles.map((e) => e.row.id)).toEqual(['b'])
    expect(writes).toBeGreaterThan(0)
  })
  it('🚨 the purge takes the body in the trash, not a newer file at the old name', async () => {
    leave('a'); toTrash('a')
    fs.writeFileSync(path.join(dir, 'a.mov'), 'newer')
    bundle.trashedFiles = [entry('a', { moved: false, trashed_at: new Date(clock - RETENTION_MS - 1000).toISOString() })]
    expect((await call('POST', `/api/rabbit/projects/${PID}/trash/purge-expired`)).body).toEqual({ purged: 1 })
    expect(onDisk('.trash/a-a.mov')).toBe(false)
    expect(fs.readFileSync(path.join(dir, 'a.mov'), 'utf8')).toBe('newer')
  })
  it('never unlinks a file a live row now names', async () => {
    leave('a')
    bundle.files.push(f('other', { storage_path: 'a.mov' }))
    bundle.trashedFiles = [entry('a', { moved: false, trashed_at: new Date(clock - RETENTION_MS - 1000).toISOString() })]
    await call('POST', `/api/rabbit/projects/${PID}/trash/purge-expired`)
    expect(onDisk('a.mov')).toBe(true)
    expect(bundle.fileEvents.at(-1).blob_removed).toBe(false)
  })
  it('🚨 the purge keeps an entry whose body it cannot see: the drive may be away', async () => {
    leave('a'); fs.unlinkSync(path.join(dir, 'a.mov'))
    bundle.trashedFiles = [entry('a', { trashed_at: new Date(clock - RETENTION_MS - 1000).toISOString() })]
    expect((await call('POST', `/api/rabbit/projects/${PID}/trash/purge-expired`)).body).toEqual({ purged: 0 })
    expect(bundle.trashedFiles.length).toBe(1)
    clock += 2 * RETENTION_MS + 5000
    expect((await call('POST', `/api/rabbit/projects/${PID}/trash/purge-expired`)).body).toEqual({ purged: 1 })
    expect(bundle.fileEvents.at(-1).blob_removed).toBe(false)
  })
  it('🚨 opening a project with nothing to purge writes nothing, and a purge does not touch its date', async () => {
    writes = 0
    await call('POST', `/api/rabbit/projects/${PID}/trash/purge-expired`)
    expect(writes).toBe(0)
    await call('DELETE', `/api/rabbit/projects/${PID}/files/a`)
    clock += RETENTION_MS + 1000
    writes = 0
    await call('POST', `/api/rabbit/projects/${PID}/trash/purge-expired`)
    expect(writes).toBe(1)
    expect(lastWrite).toEqual({ touch: false })
  })
})

describe('Undo from Files, and the relink', () => {
  it('🚨 an expense-linked file deleted in Files comes back through its own restore; Moth\'s batch still reads it as not there', async () => {
    bundle.expenses = [{ id: 'e', file_ids: ['a'] }]
    await call('DELETE', `/api/rabbit/projects/${PID}/files/a`)
    expect((await call('POST', `/api/rabbit/projects/${PID}/files/restore`, { ids: ['a'] })).status).toBe(404)
    expect((await call('POST', `/api/rabbit/projects/${PID}/files/a/restore`)).body.done).toBe(1)
    expect(bundle.files.map((x) => x.id)).toContain('a')
  })
  it('🚨 a relink is not held up by what Moth cannot show, or by a body it cannot see', async () => {
    bundle.expenses = [{ id: 'e', file_ids: ['a'] }]
    await call('DELETE', `/api/rabbit/projects/${PID}/files/a`)
    expect((await fetch(`${base}/api/rabbit/projects/${PID}/files/relink-apply`, { method: 'POST' })).status).toBe(404)
    bundle.expenses = []
    bundle.trashedFiles = [{ row: f('q'), trashed_at: new Date(clock).toISOString(), trash_name: 'q-q.mov', moved: true }]
    expect((await fetch(`${base}/api/rabbit/projects/${PID}/files/relink-apply`, { method: 'POST' })).status).toBe(404)
  })
  it('a relink to the same folder strands nothing', async () => {
    await call('DELETE', `/api/rabbit/projects/${PID}/files/a`)
    const same = await fetch(`${base}/api/rabbit/projects/${PID}/files/relink-apply`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseDir: dir }),
    })
    expect(same.status).toBe(404)
  })
  it('🚨 clearing the files folder waits too, while a body in the trash would be left behind', async () => {
    const app = express()
    app.use(express.json())
    mountFilesDirGuard(app, {
      fs, path, readRabbitBundle: () => ({ ...bundle, project: { files_dir: dir } }),
      resolveFileBaseDir: () => dir, resolveContainedFilePath,
    })
    app.patch('/api/rabbit/projects/:id', (_req, res) => res.json({ through: true }))
    const srv = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)) })
    const patch = async (body) => fetch(`http://127.0.0.1:${srv.address().port}/api/rabbit/projects/${PID}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    try {
      expect((await patch({ files_dir: null })).status).toBe(200)
      await call('DELETE', `/api/rabbit/projects/${PID}/files/a`)
      const refused = await patch({ files_dir: null })
      expect(refused.status).toBe(409)
      expect((await refused.json()).code).toBe('trash_would_strand')
      expect((await patch({ title: 'x' })).status).toBe(200)
    } finally {
      await new Promise((ok) => srv.close(ok))
    }
  })
})

describe('🚨 one rule for what Moth may not touch, the page\'s', () => {
  const folders = [
    { id: 'root', kind: 'root', slug: 'budget', path: '' },
    { id: 'plain', parent_id: 'root', slug: 'contracts', path: 'Contracts' },
    { id: 'deep', parent_id: 'plain', slug: 'invoices', path: 'Contracts/invoices' },
    { id: 'top', parent_id: 'root', slug: 'invoices', path: 'Renamed' },
    { id: 'fin', parent_id: 'root', slug: 'x', path: 'FINANCE/x' },
  ]
  const b = { folders, project: { folder_slug: 'Acme' } }
  it('a project called Budget, an asset called Contracts and a deep Invoices folder are ordinary files', () => {
    for (const id of ['root', 'plain', 'deep']) expect(isMothExcluded(b, { id: 'x', folder_id: id, storage_path: 'a.mov' })).toBe(false)
    expect(isMothExcluded(b, { id: 'x', storage_path: 'Contracts/a.pdf' })).toBe(false)
    expect(isMothExcluded(b, { id: 'x', storage_path: 'budgets/a.pdf' })).toBe(false)
  })
  it('a top-level money slug, a money first segment, FINANCE and the old money folders are not', () => {
    for (const id of ['top', 'fin']) expect(isMothExcluded(b, { id: 'x', folder_id: id })).toBe(true)
    expect(isMothExcluded(b, { id: 'x', storage_path: 'finance/q3.pdf' })).toBe(true)
    expect(isMothExcluded(b, { id: 'x', storage_path: 'Acme_RECEIPTS&INVOICES/a.pdf' })).toBe(true)
    expect(isMothExcluded(b, { id: 'x', storage_path: 'Acme_CREWINVOICES/a.pdf' })).toBe(true)
    expect(isMothExcluded(b, { id: 'x', storage_path: 'x/acme_talentinvoices/a.pdf' })).toBe(true)
  })
  it('a chain that loops fails closed, as the page\'s does', () => {
    const loop = { folders: [{ id: 'l1', parent_id: 'l2', slug: 'a', path: 'a' }, { id: 'l2', parent_id: 'l1', slug: 'b', path: 'b' }] }
    expect(isMothExcluded(loop, { id: 'x', folder_id: 'l1' })).toBe(true)
    expect(moneyFolderChainLocked('l1', loop.folders)).toBe(true)
  })
  it('holds the same folders and names as storage/index.js', () => {
    for (const id of ['root', 'plain', 'deep', 'top', 'fin']) {
      expect(isMothExcluded({ folders }, { id: 'x', folder_id: id })).toBe(moneyFolderChainLocked(id, folders))
    }
    for (const seg of MONEY_SEGMENTS) expect(isMothExcluded({}, { id: 'x', storage_path: `${seg.toLowerCase()}/a` })).toBe(true)
  })
})
