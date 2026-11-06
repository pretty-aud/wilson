// @vitest-environment node
// networkShareWalk.test.js — MO1 (MOTH_DESIGN §1.8, NS-D5, NS-D7): the office-server walk, on real files,
// in the real worker thread.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'

const require = createRequire(import.meta.url)
const { mountNetworkShareWalk, walkFolder, ROUTE, SEQUENCE_MIME } = require('../../../../electron/networkShareWalk.cjs')
const { classifySequence, SEQUENCE_EXTS } = require('../../../../electron/frameSequence.cjs')
const { checkShareLocator, walkLists } = require('../../../../electron/networkShare.cjs')
const { makeRootQuestions } = require('../../../../electron/rootReachable.cjs')

let root, outside, server, base, sameOrigin, limits, deadlineMs
const put = (rel, text = 'x') => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text) }
const walk = async (body) => {
  const r = await fetch(`${base}${ROUTE}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: r.status, body: await r.json() }
}
const dirOf = (out, d) => out.body.dirs.find((x) => x.d === d)
const names = (record) => record.files.map((f) => f.n)

async function start() {
  const app = express()
  app.use(express.json())
  mountNetworkShareWalk(app, {
    getWorkspaceRoot: () => root,
    isSameOriginRequest: () => sameOrigin,
    checkShareLocator,
    isShareRoot: () => true,
    reach: makeRootQuestions({ askRoot: (r) => fs.promises.stat(r).then(() => true, () => false) }),
    lists: walkLists,
    verifyBearer: async () => ({ userId: null }),
    limits,
    deadlineMs,
  })
  await new Promise((ok) => { server = app.listen(0, '127.0.0.1', ok) })
  base = `http://127.0.0.1:${server.address().port}`
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'share-walk-'))
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'share-out-'))
  sameOrigin = true
  limits = {}
  deadlineMs = 60000
  await start()
})
afterEach(async () => {
  await new Promise((ok) => server.close(ok))
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(outside, { recursive: true, force: true })
})

describe('what it tells', () => {
  it('whole directories, in the shape the catalogue reads', async () => {
    put('Salt/a.mov', 'abc')
    put('Salt/rushes/b.mov')
    const out = await walk({ folder: 'Salt' })
    expect(out.status).toBe(200)
    expect(out.body.stopped_at).toBeNull()
    const top = dirOf(out, 'Salt')
    expect(top).toMatchObject({ complete: true, subdirs: ['rushes'] })
    expect(top.files[0]).toMatchObject({ n: 'a.mov', s: '3' })
    expect(top.files[0].m).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(names(dirOf(out, 'Salt/rushes'))).toEqual(['b.mov'])
  })
  it('never names money, Legal, a dot-led name or the three kinds of clutter, at any depth', async () => {
    for (const rel of ['Salt/INVOICES/i.pdf', 'Salt/in/LEGAL/l.pdf', 'Salt/FINANCE/f.pdf', 'Salt/x_RECEIPTS&INVOICES/r.pdf', 'Salt/y_CREWINVOICES/c.pdf',
      'Salt/z_TALENTINVOICES/t.pdf', 'Salt/d_DATABASES/d.json', 'Salt/.hidden/h.mov', 'Salt/in/.secret', 'Salt/node_modules/n.js', 'Salt/desktop.ini', 'Salt/Thumbs.db', 'Salt/in/ok.mov']) put(rel)
    const text = JSON.stringify((await walk({ folder: 'Salt' })).body)
    for (const word of ['INVOICES', 'LEGAL', 'FINANCE', 'DATABASES', 'hidden', 'secret', 'node_modules', 'desktop.ini', 'Thumbs']) expect(text).not.toContain(word)
    expect(text).toContain('ok.mov')
  })
  it('a file dated before 1980 is listed with no time', async () => {
    put('Salt/old.mov')
    fs.utimesSync(path.join(root, 'Salt/old.mov'), new Date('1975-01-01'), new Date('1975-01-01'))
    const [file] = dirOf(await walk({ folder: 'Salt' }), 'Salt').files
    expect(file.n).toBe('old.mov')
    expect(file.m).toBeUndefined()
  })
  it('the bin is read once, as ids at the top', async () => {
    const id = '12100000-0000-0000-0000-000000000001'
    put(`Salt/.wilson-bin/${id}/a.mov`)
    put('Salt/.wilson-bin/not-an-id/a.mov')
    put('Salt/rushes/b.mov')
    expect((await walk({ folder: 'Salt' })).body.bin).toEqual([id])
    expect((await walk({ folder: 'Salt', start: 'Salt/rushes' })).body.bin).toEqual([])
  })
})

describe('a folder of frames', () => {
  it('is one entry in its parent', async () => {
    for (let i = 1; i <= 3; i += 1) put(`Salt/seq/f.000${i}.exr`, 'ab')
    const out = await walk({ folder: 'Salt' })
    const top = dirOf(out, 'Salt')
    expect(top.subdirs).toEqual([])
    expect(top.files[0]).toMatchObject({ n: 'seq', s: '6', t: SEQUENCE_MIME })
    expect(dirOf(out, 'Salt/seq')).toBeUndefined()
  })
  it('a folder with a second series or a subfolder stays a folder', async () => {
    put('Salt/two/a.0001.exr')
    put('Salt/two/b.0001.exr')
    put('Salt/deep/a.0001.exr')
    put('Salt/deep/a.0002.exr')
    put('Salt/deep/in/x.mov')
    expect(dirOf(await walk({ folder: 'Salt' }), 'Salt').subdirs).toEqual(['deep', 'two'])
  })
})

describe('links', () => {
  it('🚨 a junction is neither followed nor listed', async () => {
    fs.writeFileSync(path.join(outside, 'secret.mov'), 'x')
    put('Salt/ok.mov')
    fs.symlinkSync(outside, path.join(root, 'Salt', 'away'), 'junction')
    const out = await walk({ folder: 'Salt' })
    expect(dirOf(out, 'Salt').subdirs).toEqual([])
    expect(JSON.stringify(out.body)).not.toContain('secret')
  })
  it('a folder that is itself a junction is refused', async () => {
    fs.symlinkSync(outside, path.join(root, 'Salt'), 'junction')
    expect((await walk({ folder: 'Salt' })).body.code).toBe('a_link')
  })
})

describe('limits', () => {
  it('stops between directories, and the next call starts where it stopped', async () => {
    await new Promise((ok) => server.close(ok))
    limits = { maxFiles: 2 }
    await start()
    put('Salt/a/1.mov'); put('Salt/a/2.mov'); put('Salt/b/3.mov'); put('Salt/c/4.mov')
    const first = await walk({ folder: 'Salt' })
    expect(first.body.stopped_at).toBe('Salt/b')
    expect(first.body.dirs.map((d) => d.d)).toEqual(['Salt', 'Salt/a'])
    const second = await walk({ folder: 'Salt', start: first.body.stopped_at })
    expect(second.body.dirs.map((d) => d.d)).toEqual(['Salt/b', 'Salt/c'])
    expect(second.body.stopped_at).toBeNull()
  })
  it('a start deep in the tree carries on past its own branch', async () => {
    put('Salt/a/deep/1.mov'); put('Salt/a/zed/2.mov'); put('Salt/b/3.mov')
    const out = await walk({ folder: 'Salt', start: 'Salt/a/deep' })
    expect(out.body.dirs.map((d) => d.d)).toEqual(['Salt/a/deep', 'Salt/a/zed', 'Salt/b'])
  })
  it('a start whose folder has gone carries on from the next', async () => {
    put('Salt/a/1.mov'); put('Salt/c/2.mov')
    expect((await walk({ folder: 'Salt', start: 'Salt/b' })).body.dirs.map((d) => d.d)).toEqual(['Salt/c'])
  })
  it('a directory over the cap says it is not complete, so nothing in it is called missing', async () => {
    await new Promise((ok) => server.close(ok))
    limits = { maxFiles: 2 }
    await start()
    put('Salt/1.mov'); put('Salt/2.mov'); put('Salt/3.mov')
    const top = dirOf(await walk({ folder: 'Salt' }), 'Salt')
    expect(top.complete).toBe(false)
    expect(top.files.length).toBe(2)
  })
  it('depth: a folder too deep is named and not entered', async () => {
    await new Promise((ok) => server.close(ok))
    limits = { maxDepth: 1 }
    await start()
    put('Salt/a/b/c/1.mov')
    const out = await walk({ folder: 'Salt' })
    expect(dirOf(out, 'Salt/a').subdirs).toEqual(['b'])
    expect(dirOf(out, 'Salt/a/b')).toBeUndefined()
  })
  it('the deadline stops the walk with something to say', async () => {
    await new Promise((ok) => server.close(ok))
    deadlineMs = -1000
    await start()
    put('Salt/a.mov')
    expect((await walk({ folder: 'Salt' })).body.stopped_at).toBe('Salt')
  })
})

describe('what is refused', () => {
  it('another origin, a bad folder, a start outside it, and a folder that is not there', async () => {
    put('Salt/a.mov')
    expect((await walk({ folder: '../x' })).status).toBe(400)
    expect((await walk({ folder: 'INVOICES' })).status).toBe(400)
    expect((await walk({ folder: 'Salt', start: 'Moon/a' })).status).toBe(400)
    expect((await walk({ folder: 'Gone' })).status).toBe(404)
    sameOrigin = false
    expect((await walk({ folder: 'Salt' })).status).toBe(403)
  })
  it('🚨 makes no synchronous call on this thread', async () => {
    put('Salt/a.mov')
    const list = ['statSync', 'lstatSync', 'readdirSync', 'realpathSync', 'existsSync', 'openSync', 'readFileSync']
    const asked = []
    const was = list.map((n) => fs[n])
    list.forEach((n, i) => { fs[n] = (...args) => { asked.push(n); return was[i](...args) } })
    let out
    try {
      out = await walk({ folder: 'Salt' })
    } finally {
      list.forEach((n, i) => { fs[n] = was[i] })
    }
    expect(names(dirOf(out, 'Salt'))).toEqual(['a.mov'])
    expect(asked).toEqual([])
  })
})

// Whole-session review round 1.
describe('review round 1', () => {
  it('🚨 a folder reached through a junction on the way is refused: a money folder cannot be listed under an innocent name', async () => {
    fs.mkdirSync(path.join(outside, 'Docs'), { recursive: true })
    fs.writeFileSync(path.join(outside, 'Docs', 'q3.pdf'), 'x')
    const inside = path.join(root, 'INV')
    fs.mkdirSync(path.join(inside, 'Docs'), { recursive: true })
    fs.writeFileSync(path.join(inside, 'Docs', 'q3.pdf'), 'x')
    fs.mkdirSync(path.join(root, 'Projects'))
    fs.symlinkSync(inside, path.join(root, 'Projects', 'Alpha'), 'junction')
    const out = await walk({ folder: 'Projects/Alpha/Docs' })
    expect(out.status).toBe(403)
    expect(out.body.code).toBe('a_link')
  })
  it('🚨 a frame folder that cannot be read leaves its parent not complete, so its row is not called missing', () => {
    fs.mkdirSync(path.join(root, 'Salt', 'frames'), { recursive: true })
    fs.writeFileSync(path.join(root, 'Salt', 'a.mov'), 'x')
    const refusing = {
      ...fs,
      readdirSync: (dir, opts) => {
        if (String(dir).endsWith('frames')) { const e = new Error('no'); e.code = 'EACCES'; throw e }
        return fs.readdirSync(dir, opts)
      },
    }
    const out = walkFolder({
      root, folder: 'Salt', start: null,
      lists: { ...walkLists, sequenceExts: SEQUENCE_EXTS, sequenceMime: SEQUENCE_MIME },
      limits: { deadlineMs: 60000, maxFiles: 5000, maxDirs: 2000, maxDepth: 8, maxBin: 500, maxFrameStats: 5000, oldestMs: 0 },
    }, refusing, path, classifySequence)
    expect(out.dirs.find((d) => d.d === 'Salt').complete).toBe(false)
    expect(out.dirs.find((d) => d.d === 'Salt/frames').complete).toBe(false)
  })
  it('🚨 an empty id folder in the bin takes no place in its list', async () => {
    const full = '22222222-2222-4222-8222-222222222222'
    const empty = '11111111-1111-4111-8111-111111111111'
    fs.mkdirSync(path.join(root, 'Salt', '.wilson-bin', empty), { recursive: true })
    put(`Salt/.wilson-bin/${full}/a.mov`)
    expect((await walk({ folder: 'Salt' })).body.bin).toEqual([full])
  })
  it('🚨 a walk of somebody else\'s personal folder is refused', async () => {
    const other = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    put(`_WILSON_PERSONAL/${other}/a.mov`)
    expect((await walk({ folder: `_WILSON_PERSONAL/${other}` })).status).toBe(403)
  })
})

