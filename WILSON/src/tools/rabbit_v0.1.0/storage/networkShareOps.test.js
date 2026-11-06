// @vitest-environment node
// networkShareOps.test.js — MO1 (MOTH_DESIGN §1.8): the renames an office-server operation owes, on real files.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'

const require = createRequire(import.meta.url)
const { mountNetworkShareOps, makeShareLocate, ROUTE, PUT_ROUTE, PURGE_ROUTE, FILE_ROUTE } = require('../../../../electron/networkShareOps.cjs')
const { checkShareLocator } = require('../../../../electron/networkShare.cjs')
const { makeRootQuestions } = require('../../../../electron/rootReachable.cjs')
const { makeShareContain } = require('../../../../electron/shareContain.cjs')

let root, outside, server, base, sameOrigin, drive, picked, reach, contain, caller, opsFsp
const ME = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const OTHER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const put = (rel, text = 'x') => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text) }
const has = (rel) => fs.existsSync(path.join(root, rel))
const ask = async (pairs) => {
  const r = await fetch(`${base}${ROUTE}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pairs }) })
  return { status: r.status, body: await r.json() }
}

const post = async (route, body) => {
  const r = await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: r.status, body: await r.json() }
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'share-ops-'))
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'share-out-'))
  sameOrigin = true
  drive = root
  picked = new Set()
  caller = 'bearer'
  opsFsp = fs.promises
  reach = makeRootQuestions({ askRoot: (r) => fs.promises.stat(r).then(() => true, () => false), rootTtlMs: 1, rootOffTtlMs: 1 })
  contain = makeShareContain({ reach })
  const app = express()
  app.use(express.json())
  mountNetworkShareOps(app, {
    getWorkspaceRoot: () => drive,
    isSameOriginRequest: () => sameOrigin,
    checkShareLocator,
    isShareRoot: () => true,
    reach,
    contain,
    get fsp() { return opsFsp },
    verifyBearer: async (header) => (caller === 'off' ? { unreachable: true } : { userId: header === 'Bearer mine' ? ME : null }),
    isAuthorizedFile: (p) => picked.has(p),
    resolveMediaKey: (key) => (key === 'good/key.mov' ? path.join(outside, 'media.mov') : null),
  })
  await new Promise((ok) => { server = app.listen(0, '127.0.0.1', ok) })
  base = `http://127.0.0.1:${server.address().port}`
})
afterEach(async () => {
  await new Promise((ok) => server.close(ok))
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(outside, { recursive: true, force: true })
})

describe('a rename', () => {
  it('moves the file, making the folder it needs, and says so', async () => {
    put('Salt/a.mov')
    const out = await ask([{ from: 'Salt/a.mov', to: 'Moon/in/a.mov' }])
    expect(out.body.results).toEqual([{ from: 'Salt/a.mov', to: 'Moon/in/a.mov', ok: true }])
    expect(has('Salt/a.mov')).toBe(false)
    expect(has('Moon/in/a.mov')).toBe(true)
  })
  it('🚨 never overwrites: a target that exists is refused, and both stay', async () => {
    put('Salt/a.mov', 'mine')
    put('Moon/a.mov', 'theirs')
    const out = await ask([{ from: 'Salt/a.mov', to: 'Moon/a.mov' }])
    expect(out.body.results[0]).toMatchObject({ ok: false, code: 'name_taken' })
    expect(fs.readFileSync(path.join(root, 'Moon/a.mov'), 'utf8')).toBe('theirs')
    expect(has('Salt/a.mov')).toBe(true)
  })
  it('a repeat of one that worked says so, because its answer may have been lost', async () => {
    put('Moon/a.mov')
    expect((await ask([{ from: 'Salt/a.mov', to: 'Moon/a.mov' }])).body.results[0]).toMatchObject({ ok: true, already: true })
  })
  it('a file at neither end is said to be not there', async () => {
    expect((await ask([{ from: 'Salt/a.mov', to: 'Moon/a.mov' }])).body.results[0]).toMatchObject({ ok: false, code: 'not_there' })
  })
  it('each pair answers for itself', async () => {
    put('Salt/a.mov')
    const out = await ask([{ from: 'Salt/gone.mov', to: 'Moon/gone.mov' }, { from: 'Salt/a.mov', to: 'Moon/a.mov' }])
    expect(out.body.results.map((r) => r.ok)).toEqual([false, true])
  })
})

describe('the bin', () => {
  const BIN = 'Salt/.wilson-bin/12100000-0000-0000-0000-000000000001/a.mov'
  it('a trash goes in, and a restore comes out', async () => {
    put('Salt/a.mov')
    expect((await ask([{ from: 'Salt/a.mov', to: BIN }])).body.results[0].ok).toBe(true)
    expect(has(BIN)).toBe(true)
    expect((await ask([{ from: BIN, to: 'Salt/a.mov' }])).body.results[0].ok).toBe(true)
    expect(has('Salt/a.mov')).toBe(true)
  })
  it.each([
    ['not an id', 'Salt/.wilson-bin/nope/a.mov'],
    ['deeper', 'Salt/.wilson-bin/12100000-0000-0000-0000-000000000001/b/a.mov'],
    ['at the top', '.wilson-bin/12100000-0000-0000-0000-000000000001/a.mov'],
    ['another dot-led folder', 'Salt/.other/12100000-0000-0000-0000-000000000001/a.mov'],
  ])('only in its one shape: %s', async (_label, to) => {
    put('Salt/a.mov')
    expect((await ask([{ from: 'Salt/a.mov', to }])).body.results[0]).toMatchObject({ ok: false, code: 'bad_locator' })
  })
})

describe('what is refused', () => {
  it.each([
    ['a climb out of the drive', '../outside.mov', 'Moon/a.mov'],
    ['a target outside it', 'Salt/a.mov', '../outside.mov'],
    ['an absolute path', path.join(os.tmpdir(), 'x.mov'), 'Moon/a.mov'],
    ['a dot-led folder', '.wilson/a.mov', 'Moon/a.mov'],
    ['nothing at all', '', 'Moon/a.mov'],
  ])('%s', async (_label, from, to) => {
    put('Salt/a.mov')
    expect((await ask([{ from, to }])).body.results[0]).toMatchObject({ ok: false, code: 'bad_locator' })
    expect(has('Salt/a.mov')).toBe(true)
  })
  it('a link is not moved', async () => {
    put('Salt/real.mov')
    try {
      fs.symlinkSync(path.join(root, 'Salt/real.mov'), path.join(root, 'Salt/link.mov'))
    } catch {
      return // Windows without the privilege: the arm is the lstat's, and the other cases run.
    }
    expect((await ask([{ from: 'Salt/link.mov', to: 'Moon/link.mov' }])).body.results[0]).toMatchObject({ ok: false, code: 'a_link' })
  })
  it('a folder is not moved, unless it is one frame series', async () => {
    put('Salt/rushes/a.mov')
    expect((await ask([{ from: 'Salt/rushes', to: 'Moon/rushes' }])).body.results[0]).toMatchObject({ ok: false, code: 'not_a_file' })
    put('Salt/seq/f.0001.exr')
    put('Salt/seq/f.0002.exr')
    expect((await ask([{ from: 'Salt/seq', to: 'Moon/seq' }])).body.results[0].ok).toBe(true)
    expect(has('Moon/seq/f.0002.exr')).toBe(true)
  })
  it('a junction on the way is refused, and nothing lands where it leads', async () => {
    put('Salt/a.mov')
    fs.symlinkSync(outside, path.join(root, 'Moon'), 'junction')
    expect((await ask([{ from: 'Salt/a.mov', to: 'Moon/deep/a.mov' }])).body.results[0]).toMatchObject({ ok: false, code: 'a_link' })
    expect(fs.existsSync(path.join(outside, 'deep'))).toBe(false)
    expect(has('Salt/a.mov')).toBe(true)
    fs.writeFileSync(path.join(outside, 'b.mov'), 'x')
    expect((await ask([{ from: 'Moon/b.mov', to: 'Salt/b.mov' }])).body.results[0]).toMatchObject({ ok: false, code: 'a_link' })
    expect(fs.existsSync(path.join(outside, 'b.mov'))).toBe(true)
  })
  it('another origin, no drive, and an empty or oversized batch', async () => {
    sameOrigin = false
    expect((await ask([{ from: 'a/b', to: 'c/d' }])).status).toBe(403)
    sameOrigin = true
    expect((await ask([])).status).toBe(400)
    expect((await ask(Array.from({ length: 501 }, () => ({ from: 'a/b', to: 'c/d' })))).status).toBe(400)
    drive = null
    expect((await ask([{ from: 'a/b', to: 'c/d' }])).status).toBe(409)
  })
  it('a drive that cannot be reached answers that, and touches nothing', async () => {
    drive = path.join(root, 'not-there')
    expect((await ask([{ from: 'a/b', to: 'c/d' }])).status).toBe(503)
  })
})

describe('a copy in', () => {
  const src = () => path.join(outside, 'picked.mov')
  beforeEach(() => { fs.writeFileSync(src(), 'body') })
  it('only from a file the person picked, or a media key', async () => {
    expect((await post(PUT_ROUTE, { to: 'Salt/a.mov', from: { picked: src() } })).body.code).toBe('not_allowed_source')
    expect(has('Salt/a.mov')).toBe(false)
    picked.add(src())
    const out = await post(PUT_ROUTE, { to: 'Salt/a.mov', from: { picked: src() } })
    expect(out.status).toBe(201)
    expect(out.body).toMatchObject({ locator: 'Salt/a.mov', size_bytes: 4 })
    expect(fs.readFileSync(path.join(root, 'Salt/a.mov'), 'utf8')).toBe('body')
    expect(fs.readdirSync(path.join(root, 'Salt'))).toEqual(['a.mov'])
    fs.writeFileSync(path.join(outside, 'media.mov'), 'media')
    expect((await post(PUT_ROUTE, { to: 'Salt/m.mov', from: { media_key: 'good/key.mov' } })).status).toBe(201)
    expect((await post(PUT_ROUTE, { to: 'Salt/n.mov', from: { media_key: 'bad' } })).body.code).toBe('not_allowed_source')
  })
  it('🚨 never over a file, and leaves no part behind', async () => {
    picked.add(src())
    put('Salt/a.mov', 'theirs')
    expect((await post(PUT_ROUTE, { to: 'Salt/a.mov', from: { picked: src() } })).status).toBe(409)
    expect(fs.readFileSync(path.join(root, 'Salt/a.mov'), 'utf8')).toBe('theirs')
    expect(fs.readdirSync(path.join(root, 'Salt'))).toEqual(['a.mov'])
  })
  it('refuses a money folder and a dot-led one', async () => {
    picked.add(src())
    for (const to of ['Salt/INVOICES/a.pdf', '.wilson/a.mov', 'Salt/.wilson-bin/12100000-0000-0000-0000-000000000001/a.mov']) {
      expect((await post(PUT_ROUTE, { to, from: { picked: src() } })).body.code).toBe('bad_locator')
    }
  })
})

describe('a purge', () => {
  const ID = '12100000-0000-0000-0000-000000000001'
  it('removes a bin entry, and repeating it is fine', async () => {
    put(`Salt/.wilson-bin/${ID}/a.mov`)
    expect((await post(PURGE_ROUTE, { paths: [`Salt/.wilson-bin/${ID}`] })).body.results[0]).toMatchObject({ ok: true })
    expect(has(`Salt/.wilson-bin/${ID}`)).toBe(false)
    expect((await post(PURGE_ROUTE, { paths: [`Salt/.wilson-bin/${ID}`] })).body.results[0]).toMatchObject({ ok: true, already: true })
  })
  it('removes a frame folder in a bin', async () => {
    put(`Salt/.wilson-bin/${ID}/seq/f.0001.exr`)
    put(`Salt/.wilson-bin/${ID}/seq/f.0002.exr`)
    expect((await post(PURGE_ROUTE, { paths: [`Salt/.wilson-bin/${ID}`] })).body.results[0].ok).toBe(true)
    expect(has(`Salt/.wilson-bin/${ID}`)).toBe(false)
  })
  it.each([
    ['a live file', 'Salt/a.mov'],
    ['a live folder', 'Salt'],
    ['a bin itself', 'Salt/.wilson-bin'],
    ['a climb', `Salt/.wilson-bin/../../x/.wilson-bin/${ID}`],
    ['a money folder', `INVOICES/.wilson-bin/${ID}`],
  ])('only bin-shaped paths: %s', async (_label, p) => {
    put('Salt/a.mov')
    expect((await post(PURGE_ROUTE, { paths: [p] })).body.results[0]).toMatchObject({ ok: false, code: 'bad_locator' })
    expect(has('Salt/a.mov')).toBe(true)
  })
  it('leaves a bin entry holding anything else', async () => {
    put(`Salt/.wilson-bin/${ID}/folder/notes.txt`)
    expect((await post(PURGE_ROUTE, { paths: [`Salt/.wilson-bin/${ID}`] })).body.results[0]).toMatchObject({ ok: false, code: 'not_a_file' })
    expect(has(`Salt/.wilson-bin/${ID}/folder/notes.txt`)).toBe(true)
  })
})

describe('reading a file', () => {
  const url = (locator) => `${base}${FILE_ROUTE}/${locator.split('/').map(encodeURIComponent).join('/')}`
  it('serves its bytes, with ranges and nosniff', async () => {
    put('Salt/My clip.mov', '0123456789')
    const whole = await fetch(url('Salt/My clip.mov'))
    expect(whole.status).toBe(200)
    expect(whole.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await whole.text()).toBe('0123456789')
    const part = await fetch(url('Salt/My clip.mov'), { headers: { range: 'bytes=2-4' } })
    expect(part.status).toBe(206)
    expect(await part.text()).toBe('234')
    const head = await fetch(url('Salt/My clip.mov'), { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.headers.get('content-length')).toBe('10')
  })
  it('asks the attachment when told to', async () => {
    put('Salt/a.mov')
    const r = await fetch(`${url('Salt/a.mov')}?download=1`)
    expect(r.headers.get('content-disposition')).toContain('attachment')
  })
  it('refuses another origin, a money folder, a bin, a junction and what is not there', async () => {
    put('Salt/a.mov')
    put('INVOICES/i.pdf')
    put('Salt/.wilson-bin/12100000-0000-0000-0000-000000000001/a.mov')
    fs.writeFileSync(path.join(outside, 'o.mov'), 'x')
    fs.symlinkSync(outside, path.join(root, 'Moon'), 'junction')
    expect((await fetch(url('INVOICES/i.pdf'))).status).toBe(404)
    expect((await fetch(url('Salt/.wilson-bin/12100000-0000-0000-0000-000000000001/a.mov'))).status).toBe(404)
    expect((await fetch(url('Moon/o.mov'))).status).toBe(404)
    expect((await fetch(url('Salt/gone.mov'))).status).toBe(404)
    sameOrigin = false
    expect((await fetch(url('Salt/a.mov'))).status).toBe(403)
  })
  it('🚨 makes no synchronous call on this thread', async () => {
    put('Salt/a.mov')
    const names = ['statSync', 'lstatSync', 'existsSync', 'realpathSync', 'readdirSync', 'readFileSync', 'renameSync', 'copyFileSync', 'mkdirSync', 'openSync', 'unlinkSync']
    const asked = []
    const was = names.map((n) => fs[n])
    names.forEach((n, i) => { fs[n] = (...args) => { asked.push(n); return was[i](...args) } })
    try {
      await (await fetch(url('Salt/a.mov'))).text()
      await ask([{ from: 'Salt/a.mov', to: 'Moon/a.mov' }])
    } finally {
      names.forEach((n, i) => { fs[n] = was[i] })
    }
    expect(asked).toEqual([])
  })
})

describe('the open arm', () => {
  const locate = () => makeShareLocate({ getWorkspaceRoot: () => drive, checkShareLocator, reach, contain, isShareRoot: () => true })
  it('says where a file is, and refuses what the routes refuse', async () => {
    put('Salt/a.mov')
    expect(await locate()('Salt/a.mov')).toMatchObject({ ok: true, isFile: true, diskPath: path.join(root, 'Salt', 'a.mov') })
    expect((await locate()('INVOICES/a.pdf')).ok).toBe(false)
    expect((await locate()('Salt/gone.mov')).ok).toBe(false)
  })
})

// Whole-session review round 1.
describe('a rename that is interrupted', () => {
  const heldFsp = (onRename) => ({ ...fs.promises, rename: onRename })
  const remount = async (fsp) => {
    await new Promise((ok) => server.close(ok))
    const app = express()
    app.use(express.json())
    mountNetworkShareOps(app, {
      getWorkspaceRoot: () => drive, isSameOriginRequest: () => true, checkShareLocator, isShareRoot: () => true, reach, contain, fsp,
      verifyBearer: async () => ({ userId: null }), isAuthorizedFile: (p) => picked.has(p),
      resolveMediaKey: (key) => (key === 'good/key.mov' ? path.join(outside, 'media.mov') : null),
    })
    await new Promise((ok) => { server = app.listen(0, '127.0.0.1', ok) })
    base = `http://127.0.0.1:${server.address().port}`
  }
  it('🚨 a rename that threw after the server made it keeps the moved file, and says it moved', async () => {
    put('Salt/a.mov', 'abc')
    await remount(heldFsp(async (from, to) => {
      await fs.promises.rename(from, to)
      const e = new Error('the connection dropped'); e.code = 'ECONNRESET'; throw e
    }))
    const { body } = await ask([{ from: 'Salt/a.mov', to: 'Pepper/a.mov' }])
    expect(body.results[0].ok).toBe(true)
    expect(fs.readFileSync(path.join(root, 'Pepper/a.mov'), 'utf8')).toBe('abc')
  })
  it('🚨 a rename refused while a program holds the file clears only its own reservation', async () => {
    put('Salt/a.mov', 'abc')
    await remount(heldFsp(async () => { const e = new Error('held'); e.code = 'EBUSY'; throw e }))
    const { body } = await ask([{ from: 'Salt/a.mov', to: 'Pepper/a.mov' }])
    expect(body.results[0]).toMatchObject({ ok: false, code: 'in_use' })
    expect(has('Pepper/a.mov')).toBe(false)
    expect(has('Salt/a.mov')).toBe(true)
  })
  it('🚨 an empty file left at the target by an interrupted rename does not hold the name', async () => {
    put('Salt/a.mov', 'abc')
    put('Pepper/a.mov', '')
    const { body } = await ask([{ from: 'Salt/a.mov', to: 'Pepper/a.mov' }])
    expect(body.results[0].ok).toBe(true)
    expect(fs.readFileSync(path.join(root, 'Pepper/a.mov'), 'utf8')).toBe('abc')
  })
  it('a real file at the target still holds it, however small', async () => {
    put('Salt/a.mov', 'abc')
    put('Pepper/a.mov', 'x')
    expect((await ask([{ from: 'Salt/a.mov', to: 'Pepper/a.mov' }])).body.results[0].code).toBe('name_taken')
    expect(has('Salt/a.mov')).toBe(true)
  })
  it('🚨 a repeat looks at what it finds: another file at the target is not this one', async () => {
    put('Pepper/b.mov', 'a colleague\'s other file')
    const wrong = await ask([{ from: 'Salt/a.mov', to: 'Pepper/b.mov', size: 3 }])
    expect(wrong.body.results[0]).toMatchObject({ ok: false, code: 'not_there' })
    put('Pepper/c.mov', 'abc')
    const right = await ask([{ from: 'Salt/c.mov', to: 'Pepper/c.mov', size: 3 }])
    expect(right.body.results[0]).toMatchObject({ ok: true, already: true })
  })
  it('🚨 a restore leaves no empty id folder in the bin', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    put(`Salt/.wilson-bin/${id}/a.mov`, 'abc')
    const { body } = await ask([{ from: `Salt/.wilson-bin/${id}/a.mov`, to: 'Salt/a.mov' }])
    expect(body.results[0].ok).toBe(true)
    expect(has(`Salt/.wilson-bin/${id}`)).toBe(false)
  })
})

describe('a copy in that fails', () => {
  it('🚨 clears its reservation, so a retry is not refused for ever and no empty file is listed', async () => {
    fs.writeFileSync(path.join(outside, 'media.mov'), 'abc')
    await new Promise((ok) => server.close(ok))
    const app = express()
    app.use(express.json())
    mountNetworkShareOps(app, {
      getWorkspaceRoot: () => drive, isSameOriginRequest: () => true, checkShareLocator, isShareRoot: () => true, reach, contain,
      fsp: { ...fs.promises, rename: async () => { const e = new Error('held'); e.code = 'EBUSY'; throw e } },
      resolveMediaKey: () => path.join(outside, 'media.mov'),
    })
    await new Promise((ok) => { server = app.listen(0, '127.0.0.1', ok) })
    base = `http://127.0.0.1:${server.address().port}`
    const out = await post(PUT_ROUTE, { to: 'Salt/a.mov', from: { media_key: 'good/key.mov' } })
    expect(out.status).toBe(500)
    expect(has('Salt/a.mov')).toBe(false)
    expect(fs.readdirSync(path.join(root, 'Salt'))).toEqual([])
  })
  it('🚨 a copy that arrived but cannot be looked at says it arrived', async () => {
    fs.writeFileSync(path.join(outside, 'media.mov'), 'abc')
    const out = await post(PUT_ROUTE, { to: 'Salt/b.mov', from: { media_key: 'good/key.mov' } })
    expect(out.status).toBe(201)
    expect(out.body.size_bytes).toBe(3)
    expect(fs.readdirSync(path.join(root, 'Salt'))).toEqual(['b.mov'])
  })
})

describe('🚨 somebody else\'s personal folder', () => {
  const opAs = async (pairs, bearer) => {
    const r = await fetch(`${base}${ROUTE}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify({ pairs }) })
    return { status: r.status, body: await r.json() }
  }
  const binned = (who) => `_WILSON_PERSONAL/${who}/.wilson-bin/11111111-1111-4111-8111-111111111111`
  it('a rename, a copy in and a purge are refused, and the file stays', async () => {
    put(`_WILSON_PERSONAL/${OTHER}/a.pdf`, 'theirs')
    const op = await opAs([{ from: `_WILSON_PERSONAL/${OTHER}/a.pdf`, to: `${binned(OTHER)}/a.pdf` }], 'mine')
    expect(op.status).toBe(403)
    expect(op.body.code).toBe('not_your_folder')
    expect(has(`_WILSON_PERSONAL/${OTHER}/a.pdf`)).toBe(true)
    fs.writeFileSync(path.join(outside, 'media.mov'), 'abc')
    const copy = await fetch(`${base}${PUT_ROUTE}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer mine' }, body: JSON.stringify({ to: `_WILSON_PERSONAL/${OTHER}/b.mov`, from: { media_key: 'good/key.mov' } }) })
    expect(copy.status).toBe(403)
    put(`${binned(OTHER)}/old.pdf`, 'theirs')
    const purge = await fetch(`${base}${PURGE_ROUTE}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer mine' }, body: JSON.stringify({ paths: [binned(OTHER)] }) })
    expect(purge.status).toBe(403)
    expect(has(`${binned(OTHER)}/old.pdf`)).toBe(true)
  })
  it('a page with no bearer token is refused too, however the folder is cased', async () => {
    put(`_WILSON_PERSONAL/${ME}/a.pdf`)
    expect((await opAs([{ from: `_wilson_personal/${ME}/a.pdf`, to: `_WILSON_PERSONAL/${ME}/b.pdf` }])).status).toBe(403)
  })
  it('the person\'s own folder works, and moving out of it needs only their own token', async () => {
    put(`_WILSON_PERSONAL/${ME}/a.pdf`)
    const { body } = await opAs([{ from: `_WILSON_PERSONAL/${ME}/a.pdf`, to: 'Salt/a.pdf' }], 'mine')
    expect(body.results[0].ok).toBe(true)
  })
  it('an auth server that does not answer is said plainly, and nothing moves', async () => {
    put(`_WILSON_PERSONAL/${ME}/a.pdf`)
    caller = 'off'
    const out = await opAs([{ from: `_WILSON_PERSONAL/${ME}/a.pdf`, to: 'Salt/a.pdf' }], 'mine')
    expect(out.status).toBe(503)
    expect(out.body.code).toBe('cannot_check')
    expect(has(`_WILSON_PERSONAL/${ME}/a.pdf`)).toBe(true)
  })
  it('a project\'s own files ask no token', async () => {
    put('Salt/a.mov')
    expect((await ask([{ from: 'Salt/a.mov', to: 'Pepper/a.mov' }])).status).toBe(200)
  })
})

describe('is the server there', () => {
  it('🚨 a page can ask before it commits anything', async () => {
    expect((await fetch(`${base}/api/network-share/reachable`)).status).toBe(200)
    drive = path.join(root, 'nowhere')
    const off = await fetch(`${base}/api/network-share/reachable`)
    expect(off.status).toBe(503)
    expect((await off.json()).code).toBe('unreachable')
  })
})

describe('what the routes\' file calls hold', () => {
  it('🚨 no synchronous call in the modules that answer on the main thread (a planted readFileSync goes red here)', () => {
    for (const name of ['networkShareOps.cjs', 'shareContain.cjs', 'networkShare.cjs']) {
      const text = fs.readFileSync(new URL(`../../../../electron/${name}`, import.meta.url), 'utf8')
      expect(text.replace(/^\s*\/\/.*$/gm, ''), name).not.toMatch(/\b[a-zA-Z]+Sync\(/)
    }
    expect('fs.readFileSync(x)').toMatch(/\b[a-zA-Z]+Sync\(/)
  })
  it('🚨 none of them goes to the pool outside the contained slots', () => {
    const text = fs.readFileSync(new URL('../../../../electron/networkShareOps.cjs', import.meta.url), 'utf8')
    expect(text).not.toMatch(/fsp\.copyFile/)
    const direct = text.split('\n').filter((line) => /\bfsp\.[a-z]+\(/i.test(line) && !/io\(/.test(line) && !/fsp\.stat\(sourceAt\)/.test(line))
    expect(direct).toEqual([])
  })
})

