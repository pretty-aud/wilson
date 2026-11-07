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

let root, server, base, bundles, api, failWrite, holdRename, awayProjects, baseOf, journalOpts, pauseAfterBody, release
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
  holdRename = null
  awayProjects = new Set()
  baseOf = null
  journalOpts = null
  pauseAfterBody = null
  const holdable = { ...fs, renameSync: (from, to) => {
    if (holdRename && String(from).endsWith(holdRename)) { const e = new Error('held'); e.code = 'EBUSY'; throw e }
    return fs.renameSync(from, to)
  } }
  const app = express()
  app.use(express.json())
  api = mountFileMoves(app, {
    fs: holdable, path,
    projectFolderAway: (_b, id) => awayProjects.has(id),
    afterBodies: () => pauseAfterBody,
    readRabbitBundle: (id) => (bundles[id] ? JSON.parse(JSON.stringify(bundles[id])) : null),
    writeRabbitBundle: (id, b) => {
      if (failWrite === id) { failWrite = null; throw new Error('the disk said no') }
      bundles[id] = JSON.parse(JSON.stringify(b))
    },
    rabbitNotFound: (res, what = 'project') => res.status(404).json({ error: `${what} not found` }),
    rabbitRemoveFrom: (list, id) => { const i = list.findIndex((x) => x.id === id); if (i >= 0) list.splice(i, 1) },
    resolveFileBaseDir: (b, id, row) => (baseOf ? baseOf(b, id, row) : dirOf(id)),
    resolveContainedFilePath,
    rabbitLogFileEvent: (b, e) => b.fileEvents.push(e),
    writeJsonAtomic: (file, data, opts) => { journalOpts = opts; fs.writeFileSync(file, JSON.stringify(data)) },
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
    expect(await api.recoverMoves()).toEqual({ recovered: 1, left: 0 })
    expect(journals()).toEqual([])
    expect(bundles.p1.files.some((x) => x.id === 'a')).toBe(false)
    expect(bundles.p2.files.filter((x) => x.id === 'a').length).toBe(1)
  })
  it('recovery with a project away leaves the journal for next time', async () => {
    fs.mkdirSync(path.join(root, 'moves'))
    fs.writeFileSync(path.join(root, 'moves', 'x.json'), JSON.stringify({ op: 'x', from_project: 'gone', to_project: 'p2', items: [] }))
    expect(await api.recoverMoves()).toEqual({ recovered: 0, left: 1 })
    expect(journals()).toEqual(['x.json'])
  })
  it('🚨 a crash before the destination was written rolls back: the original stands, and a copy of it goes', async () => {
    fs.writeFileSync(path.join(dirOf('p2'), 'a.mov'), 'aaa')
    fs.mkdirSync(path.join(root, 'moves'))
    const op = (id) => '00000000-0000-4000-8000-' + id.padStart(12, '0')
    fs.writeFileSync(path.join(root, 'moves', `${op('1')}.json`), JSON.stringify({ op: op('1'), from_project: 'p1', to_project: 'p2', items: [{ row: f('a') }] }))
    expect(await api.recoverMoves()).toEqual({ recovered: 1, left: 0 })
    expect(fs.existsSync(path.join(dirOf('p1'), 'a.mov'))).toBe(true)
    expect(fs.existsSync(path.join(dirOf('p2'), 'a.mov'))).toBe(false)
    expect(bundles.p1.files.some((x) => x.id === 'a')).toBe(true)
    expect(bundles.p2.files.some((x) => x.id === 'a')).toBe(false)
    expect(journals()).toEqual([])
  })
  it('🚨 a crash after the body moved and before the destination was written brings the body home', async () => {
    fs.renameSync(path.join(dirOf('p1'), 'a.mov'), path.join(dirOf('p2'), 'a.mov'))
    fs.mkdirSync(path.join(root, 'moves'))
    const op = '00000000-0000-4000-8000-000000000002'
    fs.writeFileSync(path.join(root, 'moves', `${op}.json`), JSON.stringify({ op, from_project: 'p1', to_project: 'p2', items: [{ row: f('a') }] }))
    await api.recoverMoves()
    expect(fs.existsSync(path.join(dirOf('p1'), 'a.mov'))).toBe(true)
    expect(fs.existsSync(path.join(dirOf('p2'), 'a.mov'))).toBe(false)
    expect(journals()).toEqual([])
  })
  it('🚨 a crash after the destination was written rolls forward, from the row as it is now, not the journal\'s copy', async () => {
    fs.renameSync(path.join(dirOf('p1'), 'a.mov'), path.join(dirOf('p2'), 'a.mov'))
    bundles.p2.files.push(f('a', { project_id: 'p2' }))
    bundles.p1.files.find((x) => x.id === 'a').name = 'renamed since.mov'
    fs.mkdirSync(path.join(root, 'moves'))
    const op = '00000000-0000-4000-8000-000000000003'
    fs.writeFileSync(path.join(root, 'moves', `${op}.json`), JSON.stringify({ op, from_project: 'p1', to_project: 'p2', items: [{ row: f('a') }] }))
    await api.recoverMoves()
    expect(bundles.p1.files.some((x) => x.id === 'a')).toBe(false)
    expect(bundles.p2.files.filter((x) => x.id === 'a').length).toBe(1)
    expect(journals()).toEqual([])
  })
  it('🚨 a row trashed while a journal waited is not brought back as a second row', async () => {
    bundles.p1.files = bundles.p1.files.filter((x) => x.id !== 'a')
    bundles.p1.trashedFiles = [{ row: f('a'), trashed_at: 'then', trash_name: 'a-a.mov', moved: false }]
    fs.renameSync(path.join(dirOf('p1'), 'a.mov'), path.join(dirOf('p2'), 'a.mov'))
    fs.mkdirSync(path.join(root, 'moves'))
    const op = '00000000-0000-4000-8000-000000000004'
    fs.writeFileSync(path.join(root, 'moves', `${op}.json`), JSON.stringify({ op, from_project: 'p1', to_project: 'p2', items: [{ row: f('a') }] }))
    await api.recoverMoves()
    expect(bundles.p2.files.some((x) => x.id === 'a')).toBe(false)
    expect(fs.existsSync(path.join(dirOf('p1'), 'a.mov'))).toBe(true)
    expect(journals()).toEqual([])
  })
  it('🚨 a journal that names itself as something else is left alone, and reported', async () => {
    fs.mkdirSync(path.join(root, 'moves'))
    fs.writeFileSync(path.join(root, 'moves', 'x.json'), JSON.stringify({ op: '../../escape', from_project: 'p1', to_project: 'p2', items: [{ row: f('a') }] }))
    expect(await api.recoverMoves()).toEqual({ recovered: 0, left: 1 })
    expect(fs.existsSync(path.join(dirOf('p1'), 'a.mov'))).toBe(true)
    expect(journals()).toEqual(['x.json'])
  })
  it('🚨 a journal torn by a power cut is reported, not silently left', async () => {
    fs.mkdirSync(path.join(root, 'moves'))
    fs.writeFileSync(path.join(root, 'moves', 'torn.json'), '\0\0\0\0')
    expect(await api.recoverMoves()).toEqual({ recovered: 0, left: 1 })
    const list = await fetch(`${base}/api/rabbit/files/pending-moves`).then((r) => r.json())
    expect(list.moves.length).toBe(1)
    expect(list.moves[0].unreadable).toBe(true)
  })
  it('the pending list names what a journal is waiting on, with no path', async () => {
    fs.mkdirSync(path.join(root, 'moves'))
    fs.writeFileSync(path.join(root, 'moves', 'x.json'), JSON.stringify({ op: 'x', from_project: 'gone', to_project: 'p2', items: [{ row: f('a') }] }))
    const list = await fetch(`${base}/api/rabbit/files/pending-moves`).then((r) => r.json())
    expect(list.moves[0]).toMatchObject({ from_project: 'gone', to_project: 'p2', files: 1 })
    expect(JSON.stringify(list)).not.toContain('a.mov')
  })
  it('asks for a durable journal', async () => {
    await call('POST', MOVE, { ids: ['a'], from_project: 'p1', to_project: 'p2' })
    expect(journalOpts.durable).toBe(true)
  })
})

describe('review round 1', () => {
  it('🚨 one file held open stops the move and undoes it: bodies home, no journal, and the sentence names the file', async () => {
    holdRename = 'b.mov'
    const out = await call('POST', MOVE, { ids: ['a', 'b'], from_project: 'p1', to_project: 'p2' })
    expect(out.status).toBe(409)
    expect(out.body.code).toBe('in_use')
    expect(out.body.error).toContain('b.mov')
    expect(fs.existsSync(path.join(dirOf('p1'), 'a.mov'))).toBe(true)
    expect(fs.existsSync(path.join(dirOf('p2'), 'a.mov'))).toBe(false)
    expect(journals()).toEqual([])
    expect(bundles.p1.files.some((x) => x.id === 'a')).toBe(true)
  })
  it('🚨 a destination that cannot be written brings the bodies home, and says so', async () => {
    failWrite = 'p2'
    const out = await call('POST', MOVE, { ids: ['a'], from_project: 'p1', to_project: 'p2' })
    expect(out.status).toBe(500)
    expect(out.body.error).not.toBe('not_finished')
    expect(fs.existsSync(path.join(dirOf('p1'), 'a.mov'))).toBe(true)
    expect(fs.existsSync(path.join(dirOf('p2'), 'a.mov'))).toBe(false)
    expect(journals()).toEqual([])
  })
  it('🚨 a source body that cannot be seen is refused before anything is journalled', async () => {
    fs.unlinkSync(path.join(dirOf('p1'), 'a.mov'))
    const out = await call('POST', MOVE, { ids: ['a'], from_project: 'p1', to_project: 'p2' })
    expect(out.status).toBe(409)
    expect(out.body.code).toBe('body_missing')
    expect(journals()).toEqual([])
    expect(bundles.p1.files.some((x) => x.id === 'a')).toBe(true)
  })
  it('🚨 a project whose folder is away is refused: the rows would move and the bodies would not', async () => {
    awayProjects.add('p1')
    const out = await call('POST', MOVE, { ids: ['a'], from_project: 'p1', to_project: 'p2' })
    expect(out.status).toBe(409)
    expect(out.body.code).toBe('folder_away')
    expect(journals()).toEqual([])
    awayProjects.clear()
    awayProjects.add('p2')
    expect((await call('POST', MOVE, { ids: ['a'], from_project: 'p1', to_project: 'p2' })).body.code).toBe('folder_away')
  })
  it('🚨 a journal with a folder away is left for next time, with no row moved', async () => {
    fs.mkdirSync(path.join(root, 'moves'))
    const op = '00000000-0000-4000-8000-000000000005'
    fs.writeFileSync(path.join(root, 'moves', `${op}.json`), JSON.stringify({ op, from_project: 'p1', to_project: 'p2', items: [{ row: f('a') }] }))
    awayProjects.add('p1')
    expect(await api.recoverMoves()).toEqual({ recovered: 0, left: 1 })
    expect(bundles.p1.files.some((x) => x.id === 'a')).toBe(true)
    expect(journals().length).toBe(1)
  })
  it('🚨 two moves at once take turns: the second sees what the first did', async () => {
    const [one, two] = await Promise.all([
      call('POST', MOVE, { ids: ['a'], from_project: 'p1', to_project: 'p2' }),
      call('POST', MOVE, { ids: ['a'], from_project: 'p1', to_project: 'p2' }),
    ])
    expect([one.status, two.status].sort()).toEqual([200, 404])
    expect(bundles.p2.files.filter((x) => x.id === 'a').length).toBe(1)
  })
  it('🚨 a write to a project during the copy is kept: the rows are read again after the bodies move', async () => {
    release = null
    const held = new Promise((ok) => { release = ok })
    pauseAfterBody = held
    const moving = call('POST', MOVE, { ids: ['a'], from_project: 'p1', to_project: 'p2' })
    await new Promise((ok) => setTimeout(ok, 50))
    bundles.p1.project = { title: 'changed during the copy' }
    release()
    expect((await moving).status).toBe(200)
    expect(bundles.p1.project.title).toBe('changed during the copy')
  })
  it('🚨 the answer says what the row left behind, and a way back restores it: its folder, its links, its flag', async () => {
    bundles.p1.tasks = [{ id: 't' }]
    bundles.p1.files.find((x) => x.id === 'a').folder_id = 'fo'
    const out = await call('POST', MOVE, { ids: ['a'], from_project: 'p1', to_project: 'p2', to_folder: 'in' })
    expect(out.body.links_cleared).toBe(1)
    const back = await call('POST', MOVE, { ids: ['a'], from_project: 'p2', to_project: 'p1', back: out.body.before })
    expect(back.body.links_not_restored).toBe(0)
    const a = bundles.p1.files.find((x) => x.id === 'a')
    expect([a.folder_id, a.task_id, a.is_core_definer]).toEqual(['fo', 't', true])
  })
  it('🚨 a way back says what it could not restore: a link deleted since, and a folder gone is no folder', async () => {
    bundles.p1.tasks = []
    bundles.p1.files.find((x) => x.id === 'a').folder_id = 'fo'
    const out = await call('POST', MOVE, { ids: ['a'], from_project: 'p1', to_project: 'p2' })
    bundles.p1.folders = []
    const back = await call('POST', MOVE, { ids: ['a'], from_project: 'p2', to_project: 'p1', back: out.body.before })
    expect(back.body.links_not_restored).toBe(1)
    const a = bundles.p1.files.find((x) => x.id === 'a')
    expect([a.folder_id, a.task_id]).toEqual([null, null])
  })
  it('🚨 an in-project move refuses a money folder as its destination', async () => {
    bundles.p1.folders.push({ id: 'mon', slug: 'invoices', path: 'INVOICES' })
    expect((await call('POST', '/api/rabbit/projects/p1/files/move', { ids: ['a'], folder_id: 'mon' })).status).toBe(404)
    expect(bundles.p1.files.find((x) => x.id === 'a').folder_id).toBeUndefined()
  })
  it('🚨 a name only a money file in another folder holds is not taken, and says nothing of it', async () => {
    bundles.p2.files.push(f('inv2', { storage_path: 'a.mov', is_financial: true }))
    baseOf = (b, id, row) => (row?.is_financial ? path.join(root, 'money') : dirOf(id))
    expect((await call('POST', MOVE, { ids: ['a'], from_project: 'p1', to_project: 'p2' })).status).toBe(200)
  })
})

describe('moveBody', () => {
  it('🚨 across volumes the copy runs in a worker, is proved, then the original goes; a bad copy keeps the original', async () => {
    const from = path.join(root, 'x.bin')
    const to = path.join(root, 'y.bin')
    fs.writeFileSync(from, 'xyz')
    const cross = { ...fs, renameSync: (a, b) => { if (a !== from) return fs.renameSync(a, b); const e = new Error('x'); e.code = 'EXDEV'; throw e } }
    await moveBody(cross, from, to)
    expect(fs.existsSync(from)).toBe(false)
    expect(fs.readFileSync(to, 'utf8')).toBe('xyz')
    fs.writeFileSync(from, 'abc')
    fs.unlinkSync(to)
    const copier = async () => { const e = new Error('the copy did not match its original'); e.code = 'not_verified'; throw e }
    await expect(moveBody(cross, from, to, copier)).rejects.toThrow('did not match')
    expect(fs.existsSync(from)).toBe(true)
  })
  it('no synchronous copy or hash is left in the module', () => {
    const text = fs.readFileSync(new URL('../../../../electron/fileMoves.cjs', import.meta.url), 'utf8')
    expect(text).not.toMatch(/copyFileSync|readSync|fsyncSync/)
  })
})

describe('round 2: a copy between drives', () => {
  const exdevFrom = (source, extra = {}) => ({
    ...fs,
    renameSync: (from, to) => {
      if (from === source) { const e = new Error('x'); e.code = 'EXDEV'; throw e }
      return fs.renameSync(from, to)
    },
    ...extra,
  })
  it('🚨 goes to a name of its own and is renamed once whole, so a partial file never holds the real name', async () => {
    const from = path.join(root, 'x.bin')
    const to = path.join(root, 'sub', 'y.bin')
    fs.writeFileSync(from, 'xyz')
    let copiedTo = null
    const copier = async (a, b) => { copiedTo = b; fs.copyFileSync(a, b) }
    await moveBody(exdevFrom(from), from, to, copier)
    expect(copiedTo).not.toBe(to)
    expect(path.dirname(copiedTo)).toBe(path.dirname(to))
    expect(fs.readFileSync(to, 'utf8')).toBe('xyz')
    expect(fs.existsSync(copiedTo)).toBe(false)
    expect(fs.existsSync(from)).toBe(false)
  })
  it('🚨 a copy that fails leaves nothing at the target, and the original', async () => {
    const from = path.join(root, 'x.bin')
    const to = path.join(root, 'y.bin')
    fs.writeFileSync(from, 'xyz')
    const copier = async (_a, b) => { fs.writeFileSync(b, 'x'); const e = new Error('no'); e.code = 'ENOSPC'; throw e }
    await expect(moveBody(exdevFrom(from), from, to, copier)).rejects.toThrow('no')
    expect(fs.existsSync(to)).toBe(false)
    expect(fs.readdirSync(root).filter((n) => n.includes('wilson-moving'))).toEqual([])
    expect(fs.existsSync(from)).toBe(true)
  })
  it('🚨 an original a program holds: the copy is taken back, so a retry is not refused for ever', async () => {
    const from = path.join(root, 'x.bin')
    const to = path.join(root, 'y.bin')
    fs.writeFileSync(from, 'xyz')
    const held = exdevFrom(from, { unlinkSync: (f) => { if (f === from) { const e = new Error('held'); e.code = 'EBUSY'; throw e } return fs.unlinkSync(f) } })
    await expect(moveBody(held, from, to, async (a, b) => fs.copyFileSync(a, b))).rejects.toMatchObject({ code: 'EBUSY' })
    expect(fs.existsSync(to)).toBe(false)
    expect(fs.existsSync(from)).toBe(true)
  })
})

describe('round 2: recovery', () => {
  const journal = (id, op) => {
    fs.mkdirSync(path.join(root, 'moves'), { recursive: true })
    fs.writeFileSync(path.join(root, 'moves', `${op}.json`), JSON.stringify({ op, from_project: 'p1', to_project: 'p2', items: [{ row: f(id) }] }))
  }
  it('🚨 two different copies with no row at the far end: neither is removed, and the journal stays to be looked at', async () => {
    const op = '00000000-0000-4000-8000-000000000011'
    fs.writeFileSync(path.join(dirOf('p1'), 'a.mov'), 'par')
    fs.writeFileSync(path.join(dirOf('p2'), 'a.mov'), 'the whole file')
    journal('a', op)
    expect(await api.recoverMoves()).toEqual({ recovered: 0, left: 1 })
    expect(fs.readFileSync(path.join(dirOf('p2'), 'a.mov'), 'utf8')).toBe('the whole file')
    expect(fs.readFileSync(path.join(dirOf('p1'), 'a.mov'), 'utf8')).toBe('par')
    expect(journals()).toEqual([`${op}.json`])
  })
  it('🚨 what a crash left of a copy in progress is swept', async () => {
    const op = '00000000-0000-4000-8000-000000000012'
    const part = path.join(dirOf('p2'), '.wilson-moving-a.mov')
    fs.writeFileSync(part, 'pa')
    journal('a', op)
    await api.recoverMoves()
    expect(fs.existsSync(part)).toBe(false)
  })
  it('🚨 a row trashed during a move that went on: recovery sends its body home too', async () => {
    const op = '00000000-0000-4000-8000-000000000013'
    fs.renameSync(path.join(dirOf('p1'), 'a.mov'), path.join(dirOf('p2'), 'a.mov'))
    fs.renameSync(path.join(dirOf('p1'), 'b.mov'), path.join(dirOf('p2'), 'b.mov'))
    bundles.p1.files = bundles.p1.files.filter((x) => x.id !== 'a')
    bundles.p2.files.push(f('b', { project_id: 'p2' }))
    bundles.p1.files = bundles.p1.files.filter((x) => x.id !== 'b')
    fs.mkdirSync(path.join(root, 'moves'), { recursive: true })
    fs.writeFileSync(path.join(root, 'moves', `${op}.json`), JSON.stringify({ op, from_project: 'p1', to_project: 'p2', items: [{ row: f('a') }, { row: f('b') }] }))
    expect(await api.recoverMoves()).toEqual({ recovered: 1, left: 0 })
    expect(fs.existsSync(path.join(dirOf('p1'), 'a.mov'))).toBe(true)
    expect(fs.existsSync(path.join(dirOf('p2'), 'a.mov'))).toBe(false)
  })
})

