// =============================================================================
// posters.test.js — F9 item 3 (the desktop-build review's A2): one poster
// maker and one acceptor (electron/posters.cjs), the bins' hardened copy made
// the model: sharp to a buffer, written whole through a part of its own and
// renamed, one write in flight per poster; the main process's poster routes
// moved beside them and SERVED; the four thumbnail channels kept, thin.
//
// The failing controls are kept IN THIS FILE, word for word from the tip
// (81df858b), and each is shown to fail the property the real code holds:
//   · main.cjs's GETs encoded twice when asked twice (no single flight);
//   · libvips's toFile wrote in place, so a failed encode left a torn JPEG the
//     GET then served for good (it serves on existence);
//   · the bins' part was `<poster>.part`, one name for every writer;
//   · the bins' single flight SHARED the write in flight, so a new picture
//     asked while the old one was being made would have kept the old one;
//   · the managed-file acceptor wrote the bytes in place.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import realFs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const express = require('express')
const sharp = require('sharp')
const here = path.dirname(fileURLToPath(import.meta.url))
const ELECTRON = path.resolve(here, '../../../../electron')
const requireElectron = createRequire(path.join(ELECTRON, 'main.cjs'))
const posters = requireElectron('./posters.cjs')
const { resolveContainedFilePath, dataFilePath } = requireElectron('./pathContainment.cjs')
const { localServerErrorHandler } = requireElectron('./localToken.cjs')

const MAIN = realFs.readFileSync(path.join(ELECTRON, 'main.cjs'), 'utf8').replace(/\r\n/g, '\n')
const read = (name) => realFs.readFileSync(path.join(ELECTRON, name), 'utf8').replace(/\r\n/g, '\n')

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`main.cjs has no function ${name}`)
  const open = source.indexOf('{', source.indexOf(')', start))
  let depth = 0
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++
    else if (source[j] === '}') { depth--; if (depth === 0) return source.slice(start, j + 1) }
  }
  throw new Error(`unbalanced braces in ${name}`)
}
function extractHandlerBody(source, head) {
  const start = source.indexOf(head)
  if (start < 0) throw new Error(`main.cjs no longer registers ${head}`)
  const open = source.indexOf('{', source.indexOf('=>', start))
  let depth = 0
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++
    else if (source[j] === '}') { depth--; if (depth === 0) return source.slice(open, j + 1) }
  }
  throw new Error(`unbalanced braces extracting ${head}`)
}
/** Real fs, every call counted by method and the paths written recorded. */
function countingFs() {
  const counts = {}
  const wrote = []
  const fs = new Proxy(realFs, {
    get(target, key) {
      const v = target[key]
      if (typeof v !== 'function') return v
      return (...args) => {
        counts[key] = (counts[key] || 0) + 1
        if (key === 'writeFileSync') wrote.push(String(args[0]))
        return v.apply(target, args)
      }
    },
  })
  return { fs, counts, wrote }
}
const deferred = () => { let release; const promise = new Promise((r) => { release = r }); return { promise, release } }

let tmp, cache, SRC, JPEG_A, JPEG_B
beforeAll(async () => {
  tmp = realFs.mkdtempSync(path.join(os.tmpdir(), 'f9-posters-'))
  cache = path.join(tmp, 'Demo', '.wilson', 'rabbit-data', 'thumbnails') // a demo folder's cache, under a dot-folder
  realFs.mkdirSync(cache, { recursive: true })
  SRC = path.join(tmp, 'still.png')
  realFs.writeFileSync(SRC, await sharp({ create: { width: 64, height: 32, channels: 3, background: '#36c' } }).png().toBuffer())
  JPEG_A = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#a00' } }).jpeg().toBuffer()
  JPEG_B = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#0a0' } }).jpeg().toBuffer()
})
afterAll(() => { realFs.rmSync(tmp, { recursive: true, force: true }) })
beforeEach(() => { for (const n of realFs.readdirSync(cache)) realFs.rmSync(path.join(cache, n), { force: true }) })

// ── The tip's own words, as in-file controls ───────────────────────────────
// main.cjs's poster GETs' making half (the asset GET, :4542-4546).
async function tipGetMake(sharpImpl, srcPath, thumbPath) {
  if (realFs.existsSync(thumbPath)) return 'served'
  await sharpImpl(srcPath).resize(512).jpeg({ quality: 85 }).toFile(thumbPath)
  return 'made'
}
// rabbitBins.cjs's single flight and atomic write (:926-941), its fs injected.
function tipBinsPosters(fs = realFs) {
  const posterInFlight = new Map()
  function writePosterAtomically(thumbPath, buf) {
    const part = thumbPath + '.part'
    fs.writeFileSync(part, buf)
    fs.renameSync(part, thumbPath)
  }
  function posterOnce(thumbPath, make) {
    if (posterInFlight.has(thumbPath)) return posterInFlight.get(thumbPath)
    const p = Promise.resolve().then(make).finally(() => posterInFlight.delete(thumbPath))
    posterInFlight.set(thumbPath, p)
    return p
  }
  return { writePosterAtomically, posterOnce }
}

describe('makePoster: one write in flight per poster, never torn', () => {
  it('two posters asked at once encode once and rename once', async () => {
    const dest = path.join(cache, 'asset-twice.jpg')
    const c = countingFs()
    let encodes = 0
    const encode = async () => { encodes += 1; return JPEG_A }
    await Promise.all([
      posters.makePoster({ src: SRC, dest, edge: 512, quality: 85, encode, fsImpl: c.fs }),
      posters.makePoster({ src: SRC, dest, edge: 512, quality: 85, encode, fsImpl: c.fs }),
    ])
    expect(encodes).toBe(1)
    expect(c.counts.renameSync).toBe(1)
    expect(realFs.readFileSync(dest).equals(JPEG_A)).toBe(true)
  })
  it('CONTROL: the tip\'s GET, asked twice at once, encoded twice', async () => {
    const dest = path.join(cache, 'asset-twice-tip.jpg')
    let toFiles = 0
    const fakeSharp = () => ({ resize: () => ({ jpeg: () => ({ toFile: async (p) => { toFiles += 1; await new Promise((r) => setTimeout(r, 5)); realFs.writeFileSync(p, JPEG_A) } }) }) })
    await Promise.all([tipGetMake(fakeSharp, SRC, dest), tipGetMake(fakeSharp, SRC, dest)])
    expect(toFiles).toBe(2)
  })

  it('nothing is at the poster\'s name until the whole poster is; a failed encode leaves neither it nor a part', async () => {
    const dest = path.join(cache, 'asset-torn.jpg')
    const hold = deferred()
    const p = posters.makePoster({ src: SRC, dest, edge: 512, quality: 85, encode: async () => { await hold.promise; throw new Error('corrupt source') } })
    expect(realFs.existsSync(dest)).toBe(false)
    hold.release()
    await expect(p).rejects.toThrow('corrupt source')
    expect(realFs.readdirSync(cache).filter((n) => n.startsWith('asset-torn'))).toEqual([])
  })
  it('a rename that fails leaves no part behind, and the old poster stands', async () => {
    const dest = path.join(cache, 'asset-keep.jpg')
    realFs.writeFileSync(dest, JPEG_A)
    const failing = new Proxy(realFs, { get: (t, k) => (k === 'renameSync' ? () => { throw Object.assign(new Error('EIO'), { code: 'EIO' }) } : t[k]) })
    await expect(posters.makePoster({ src: SRC, dest, edge: 512, quality: 85, replace: true, encode: async () => JPEG_B, fsImpl: failing })).rejects.toThrow('EIO')
    expect(realFs.readdirSync(cache).filter((n) => n.startsWith('asset-keep'))).toEqual(['asset-keep.jpg'])
    expect(realFs.readFileSync(dest).equals(JPEG_A)).toBe(true)
  })
  it('CONTROL: libvips\'s toFile wrote in place, so a failed encode left a torn poster the GET then served', async () => {
    const dest = path.join(cache, 'asset-torn-tip.jpg')
    const fakeSharp = () => ({ resize: () => ({ jpeg: () => ({ toFile: async (p) => { realFs.writeFileSync(p, JPEG_A.subarray(0, 40)); throw new Error('corrupt source') } }) }) })
    await expect(tipGetMake(fakeSharp, SRC, dest)).rejects.toThrow('corrupt source')
    expect(realFs.existsSync(dest)).toBe(true)
    expect(await tipGetMake(fakeSharp, SRC, dest)).toBe('served') // torn, for good
  })

  it('two writers of one poster never share a part (an acceptor and a maker)', async () => {
    const dest = path.join(cache, 'clip.jpg')
    const c = countingFs()
    await Promise.all([
      posters.putPoster(dest, JPEG_A, { fsImpl: c.fs }),
      posters.makePoster({ src: SRC, dest, edge: 256, quality: 80, fit: 'inside', replace: true, encode: async () => JPEG_B, fsImpl: c.fs }),
    ])
    expect(c.wrote).toHaveLength(2)
    expect(new Set(c.wrote).size).toBe(2)
    for (const p of c.wrote) {
      expect(p.endsWith('.part')).toBe(true)
      expect(p).not.toBe(`${dest}.part`)
    }
    expect(realFs.readdirSync(cache).filter((n) => n.endsWith('.part'))).toEqual([])
  })
  it('CONTROL: the bins\' part was one name for every writer (the tip\'s own function)', () => {
    const c = countingFs()
    const { writePosterAtomically } = tipBinsPosters(c.fs)
    const dest = path.join(cache, 'clip-tip.jpg')
    writePosterAtomically(dest, JPEG_A)
    writePosterAtomically(dest, JPEG_B)
    expect(c.wrote).toEqual([`${dest}.part`, `${dest}.part`])
  })

  it('review round 1: a rename Windows holds is tried again after a pause that waits, never blocks', async () => {
    const dest = path.join(cache, 'asset-held.jpg')
    let refusals = 2
    const held = new Proxy(realFs, { get: (t, k) => (k === 'renameSync' ? (...a) => { if (refusals-- > 0) throw Object.assign(new Error('EPERM: held'), { code: 'EPERM' }); return t.renameSync(...a) } : t[k]) })
    let ticks = 0
    const ticker = setInterval(() => { ticks += 1 }, 1)
    try {
      await posters.makePoster({ src: SRC, dest, edge: 512, quality: 85, encode: async () => JPEG_A, fsImpl: held, pauseMs: 15 })
    } finally { clearInterval(ticker) }
    expect(realFs.readFileSync(dest).equals(JPEG_A)).toBe(true)
    expect(ticks).toBeGreaterThan(0) // the event loop ran while it waited
    expect(realFs.readdirSync(cache).filter((n) => n.endsWith('.part'))).toEqual([])
  })
  it('review round 1: a make that takes too long fails, writes nothing, and lets the next one go', async () => {
    const dest = path.join(cache, 'asset-stalled.jpg')
    const stalled = posters.makePoster({ src: SRC, dest, edge: 512, quality: 85, encode: () => new Promise(() => {}), deadlineMs: 30 })
    const next = posters.makePoster({ src: SRC, dest, edge: 512, quality: 85, replace: true, encode: async () => JPEG_B })
    await expect(stalled).rejects.toMatchObject({ code: 'POSTER_TIMEOUT' })
    await next
    expect(realFs.readFileSync(dest).equals(JPEG_B)).toBe(true)
  })
  it('a make after a failed one on the same poster still runs; a poster already there is not made again', async () => {
    const dest = path.join(cache, 'asset-after.jpg')
    await expect(posters.makePoster({ src: SRC, dest, edge: 512, quality: 85, encode: async () => { throw new Error('bad') } })).rejects.toThrow('bad')
    await posters.makePoster({ src: SRC, dest, edge: 512, quality: 85, encode: async () => JPEG_A })
    expect(realFs.readFileSync(dest).equals(JPEG_A)).toBe(true)
    let encodes = 0
    expect(await posters.makePoster({ src: SRC, dest, edge: 512, quality: 85, encode: async () => { encodes += 1; return JPEG_B } })).toEqual({ made: false })
    expect(encodes).toBe(0)
  })

  it('a new picture asked while the old one is being made wins (the channel after the GET)', async () => {
    const dest = path.join(cache, 'asset-pick.jpg')
    const hold = deferred()
    const fromA = posters.makePoster({ src: SRC, dest, edge: 512, quality: 85, encode: async () => { await hold.promise; return JPEG_A } })
    const fromB = posters.makePoster({ src: SRC, dest, edge: 512, quality: 85, replace: true, encode: async () => JPEG_B })
    hold.release()
    await Promise.all([fromA, fromB])
    expect(realFs.readFileSync(dest).equals(JPEG_B)).toBe(true)
  })
  it('CONTROL: the bins\' shared flight would have kept the old picture', async () => {
    const { posterOnce, writePosterAtomically } = tipBinsPosters()
    const dest = path.join(cache, 'asset-pick-tip.jpg')
    const hold = deferred()
    const a = posterOnce(dest, async () => { await hold.promise; writePosterAtomically(dest, JPEG_A) })
    const b = posterOnce(dest, async () => { writePosterAtomically(dest, JPEG_B) })
    hold.release()
    await Promise.all([a, b])
    expect(realFs.readFileSync(dest).equals(JPEG_A)).toBe(true)
  })

  it('clearPoster waits for the write in flight, then removes the poster', async () => {
    const dest = path.join(cache, 'asset-clear.jpg')
    const hold = deferred()
    const making = posters.makePoster({ src: SRC, dest, edge: 512, quality: 85, encode: async () => { await hold.promise; return JPEG_A } })
    const clearing = posters.clearPoster(dest)
    hold.release()
    await Promise.all([making, clearing])
    expect(realFs.existsSync(dest)).toBe(false)
  })
})

describe('makePoster: each caller\'s own geometry, so a new poster matches the cached ones', () => {
  const dims = async (buf) => { const m = await sharp(buf).metadata(); return [m.width, m.height] }
  for (const [who, opts, tipCall] of [
    ['a managed file (256 wide, q80)', { edge: 256, quality: 80 }, (s) => s.resize(256).jpeg({ quality: 80 })],
    ['an asset or an entity, and the two channels (512 wide, q85)', { edge: 512, quality: 85 }, (s) => s.resize(512).jpeg({ quality: 85 })],
    ['a bin (inside 256, never enlarged, q80)', { edge: 256, quality: 80, fit: 'inside' }, (s) => s.resize(256, 256, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 })],
  ]) {
    it(who, async () => {
      const dest = path.join(cache, `geom-${opts.edge}-${opts.fit || 'width'}.jpg`)
      await posters.makePoster({ src: SRC, dest, ...opts })
      const tip = await tipCall(sharp(SRC)).toBuffer()
      expect(await dims(realFs.readFileSync(dest))).toEqual(await dims(tip))
      // The same bytes: the same size, quality and pipeline (review round 1).
      expect(realFs.readFileSync(dest).equals(tip)).toBe(true)
    })
  }
})

describe('acceptPoster: the bins\' narrowing, once', () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)])
  it('answers each refusal as the bins\' acceptors did; a body that is not a string is refused (a tightening: the managed and signed-out acceptors wrote an array\'s bytes)', () => {
    expect(posters.acceptPoster(undefined)).toEqual({ ok: false, status: 400, error: 'base64 required' })
    expect(posters.acceptPoster('')).toEqual({ ok: false, status: 400, error: 'base64 required' })
    expect(posters.acceptPoster([0xff, 0xd8, 0xff])).toEqual({ ok: false, status: 400, error: 'base64 required' })
    expect(posters.acceptPoster('!!!!')).toEqual({ ok: false, status: 400, error: 'unreadable body' })
    expect(posters.acceptPoster(Buffer.alloc(262145, 0xff).toString('base64'))).toEqual({ ok: false, status: 413, error: 'thumbnail too large' })
    expect(posters.acceptPoster(Buffer.from('hello').toString('base64'))).toEqual({ ok: false, status: 415, error: 'not a JPEG' })
  })
  it('accepts a JPEG up to 256 KB', () => {
    const out = posters.acceptPoster(jpeg.toString('base64'))
    expect(out.ok).toBe(true)
    expect(out.buf.equals(jpeg)).toBe(true)
  })
})

describe('the main process\'s poster routes, served (posters.cjs mountPosterRoutes)', () => {
  const SAME = { 'sec-fetch-site': 'same-origin' }
  const A = '11111111-1111-4111-8111-111111111111'
  const M = '33333333-3333-4333-8333-333333333333'
  const V = '44444444-4444-4444-8444-444444444444'
  let server, base, store, encodes, projectDir
  beforeAll(async () => {
    projectDir = path.join(tmp, 'Demo', 'projects', 'Salt-Hours')
    realFs.mkdirSync(path.join(projectDir, 'ASSETS', 'Hero'), { recursive: true })
    realFs.copyFileSync(SRC, path.join(projectDir, 'ASSETS', 'Hero', 'Salt-Hours_Still_v001.png'))
    realFs.writeFileSync(path.join(projectDir, 'ASSETS', 'Hero', 'clip.mp4'), Buffer.alloc(64, 1))
    const app = express()
    app.use(express.json({ limit: '1mb' }))
    posters.mountPosterRoutes(app, {
      readRabbitBundle: (id) => (store.has(id) ? JSON.parse(store.get(id)) : null),
      rabbitNotFound: (res, what = 'project') => res.status(404).json({ error: `${what} not found` }),
      getThumbCacheDir: () => cache,
      resolveContainedFilePath,
      dataFileOrThrow: (dir, id, ext, what) => {
        const p = dataFilePath(dir, id, ext)
        if (!p) { const err = new Error(`invalid ${what} id`); err.code = 'WILSON_PATH_ESCAPE'; throw err }
        return p
      },
      resolveProjectFolderRoot: () => projectDir,
      resolveManagedFileDiskPath: (_b, mf) => path.join(projectDir, ...String(mf.folder_path || '').split('/').filter(Boolean), mf.stored_name),
      thumbnailSourceAllowed: (_b, _p, src) => !String(src).includes('forbidden'),
      isThumbableExt: (e) => ['.png', '.jpg'].includes(String(e).toLowerCase()),
      isVideoExt: (e) => ['.mp4', '.mov'].includes(String(e).toLowerCase()),
      ffmpeg: { hasFfmpeg: () => false },
      encode: async (src, opts) => { encodes += 1; return posters.encodePoster(src, opts) },
    })
    app.use((err, req, res, next) => (err && err.code === 'WILSON_PATH_ESCAPE' ? res.status(404).json({ error: 'item not found' }) : next(err)))
    app.use((err, req, res, next) => localServerErrorHandler(err, req, res, next))
    server = await new Promise((done) => { const s = app.listen(0, '127.0.0.1', () => done(s)) })
    base = `http://127.0.0.1:${server.address().port}/api/rabbit/projects/p1`
  })
  afterAll(async () => { await new Promise((done) => server.close(done)) })
  beforeEach(() => {
    encodes = 0
    store = new Map([['p1', JSON.stringify({
      project: { id: 'p1', folder_slug: 'Salt-Hours' },
      assets: [{ id: A, name: 'Hero', thumbnail_image: SRC }, { id: 'bad', name: 'Bad', thumbnail_image: path.join(tmp, 'forbidden.png') }],
      scenes: [{ id: 's1', thumbnail_image: SRC }], shots: [{ id: 'h1', thumbnail_image: SRC }],
      levels: [{ id: 'l1', thumbnail_image: SRC }], experiences: [{ id: 'x1', thumbnail_image: SRC }],
      managedFiles: [
        { id: M, extension: '.png', stored_name: 'Salt-Hours_Still_v001.png', folder_path: 'ASSETS/Hero/' },
        { id: V, extension: '.mp4', stored_name: 'clip.mp4', folder_path: 'ASSETS/Hero/' },
        { id: 'not-a-uuid', extension: '.mp4', stored_name: 'clip.mp4', folder_path: 'ASSETS/Hero/' },
        { id: 'doc', extension: '.pdf', stored_name: 'brief.pdf', folder_path: 'ASSETS/Hero/' },
      ],
    })]])
  })
  const get = (p, headers = SAME) => fetch(`${base}${p}`, { headers })
  const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { ...SAME, 'content-type': 'application/json' }, body: JSON.stringify(body) })

  it('F3-01, served: each family\'s cached poster under the dot-folder answers 200 with its bytes', async () => {
    realFs.writeFileSync(path.join(cache, `asset-${A}.jpg`), JPEG_A)
    realFs.writeFileSync(path.join(cache, 'shot-h1.jpg'), JPEG_A)
    realFs.writeFileSync(path.join(cache, `${M}.jpg`), JPEG_A)
    for (const p of [`/assets/${A}/thumbnail`, '/shots/h1/thumbnail', `/managed-files/${M}/thumbnail`]) {
      const r = await get(p)
      expect(r.status, p).toBe(200)
      expect(r.headers.get('content-type')).toBe('image/jpeg')
      expect(r.headers.get('cache-control')).toBe('no-store')
      expect(Buffer.from(await r.arrayBuffer()).equals(JPEG_A)).toBe(true)
    }
    expect(encodes).toBe(0)
  })
  it('a poster asked by two tiles at once is made once', async () => {
    const [a, b] = await Promise.all([get(`/assets/${A}/thumbnail`), get(`/assets/${A}/thumbnail`)])
    expect([a.status, b.status]).toEqual([200, 200])
    expect(encodes).toBe(1)
    const m = await sharp(realFs.readFileSync(path.join(cache, `asset-${A}.jpg`))).metadata()
    expect(m.width).toBe(512)
  })
  it('every entity family is served, and a managed still is made 256 wide', async () => {
    for (const p of ['/scenes/s1/thumbnail', '/shots/h1/thumbnail', '/levels/l1/thumbnail', '/experiences/x1/thumbnail']) {
      expect((await get(p)).status, p).toBe(200)
    }
    const r = await get(`/managed-files/${M}/thumbnail`)
    expect(r.status).toBe(200)
    expect((await sharp(Buffer.from(await r.arrayBuffer())).metadata()).width).toBe(256)
  })
  it('their refusals, as before', async () => {
    expect((await get(`/assets/${A}/thumbnail`, { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await get('/assets/nope/thumbnail')).status).toBe(404)
    expect((await get('/assets/bad/thumbnail')).status).toBe(410) // its source is not there
    realFs.writeFileSync(path.join(tmp, 'forbidden.png'), realFs.readFileSync(SRC))
    expect((await get('/assets/bad/thumbnail')).status).toBe(403)
    const escape = await get('/scenes/..%2F..%2Fx/thumbnail')
    expect(escape.status).toBe(404)
    expect((await get('/managed-files/doc/thumbnail')).status).toBe(415)
    const video = await get(`/managed-files/${V}/thumbnail`)
    expect(video.status).toBe(415)
    expect((await video.json()).code).toBe('ffmpeg_missing')
    expect((await get('/managed-files/nope/thumbnail')).status).toBe(404)
  })
  it('a HEAD (the probe\'s question) is answered as a GET without a body', async () => {
    realFs.writeFileSync(path.join(cache, `${M}.jpg`), JPEG_A)
    const r = await fetch(`${base}/managed-files/${M}/thumbnail`, { method: 'HEAD', headers: SAME })
    expect(r.status).toBe(200)
    expect(await r.text()).toBe('')
  })
  it('the managed acceptor: a video row, a bare uuid, a JPEG; then the bytes are the poster, written whole', async () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 2)])
    expect((await post(`/managed-files/${M}/thumbnail`, { base64: jpeg.toString('base64') })).status).toBe(415) // a still, not a video
    expect((await post('/managed-files/not-a-uuid/thumbnail', { base64: jpeg.toString('base64') })).status).toBe(400)
    expect((await post(`/managed-files/${V}/thumbnail`, {})).status).toBe(400)
    expect((await post(`/managed-files/${V}/thumbnail`, { base64: Buffer.from('hi').toString('base64') })).status).toBe(415)
    const ok = await post(`/managed-files/${V}/thumbnail`, { base64: jpeg.toString('base64') })
    expect(await ok.json()).toEqual({ ok: true })
    expect(realFs.readFileSync(path.join(cache, `${V}.jpg`)).equals(jpeg)).toBe(true)
    expect(realFs.readdirSync(cache).filter((n) => n.endsWith('.part'))).toEqual([])
  })
})

describe('the four thumbnail channels: names, arguments and answers kept, bodies thin', () => {
  const NAMES = ['generate-asset', 'clear-asset', 'generate-entity', 'clear-entity']
  const lift = (name) => {
    const body = extractHandlerBody(MAIN, `ipcMain.handle('rabbit:${name}-thumbnail'`)
    const src = `${extractFunction(MAIN, 'dataFileOrThrow')}\n${extractFunction(MAIN, 'entityThumbKind')}\n`
      + 'return async (_event, { assetId, sourcePath, entityType, entityId } = {}) => ' + body
    // eslint-disable-next-line no-new-func
    return new Function('fs', 'dataFilePath', 'getThumbCacheDir', 'posters', 'sharp', src)(realFs, dataFilePath, () => cache, posters, sharp)
  }
  it('each channel is still registered under its own name, and the preload still names all four', () => {
    const preload = read('preload.cjs')
    for (const n of NAMES) {
      expect(MAIN).toContain(`ipcMain.handle('rabbit:${n}-thumbnail'`)
      expect(preload).toContain(`ipcRenderer.invoke('rabbit:${n}-thumbnail', opts)`)
    }
  })
  it('generate answers { ok, thumbPath } with a 512-wide poster; clear answers { ok } and the poster is gone', async () => {
    const out = await lift('generate-asset')(null, { assetId: 'a-1', sourcePath: SRC })
    expect(out).toEqual({ ok: true, thumbPath: path.join(cache, 'asset-a-1.jpg') })
    expect((await sharp(realFs.readFileSync(out.thumbPath)).metadata()).width).toBe(512)
    expect(await lift('clear-asset')(null, { assetId: 'a-1' })).toEqual({ ok: true })
    expect(realFs.existsSync(out.thumbPath)).toBe(false)
    const ent = await lift('generate-entity')(null, { entityType: 'shot', entityId: 'h-1', sourcePath: SRC })
    expect(ent).toEqual({ ok: true, thumbPath: path.join(cache, 'shot-h-1.jpg') })
    expect(await lift('clear-entity')(null, { entityType: 'shot', entityId: 'h-1' })).toEqual({ ok: true })
    expect(realFs.existsSync(ent.thumbPath)).toBe(false)
  })
  it('a new picture replaces the cached poster (the views clear, then generate)', async () => {
    realFs.writeFileSync(path.join(cache, 'asset-a-2.jpg'), JPEG_A)
    await lift('generate-asset')(null, { assetId: 'a-2', sourcePath: SRC })
    expect(realFs.readFileSync(path.join(cache, 'asset-a-2.jpg')).equals(JPEG_A)).toBe(false)
  })
  it('their refusals, word for word', async () => {
    await expect(lift('generate-asset')(null, { assetId: 'a-3', sourcePath: path.join(tmp, 'gone.png') })).rejects.toThrow('source image does not exist')
    await expect(lift('generate-entity')(null, { entityType: 'project', entityId: 'x', sourcePath: SRC })).rejects.toMatchObject({ code: 'WILSON_PATH_ESCAPE' })
    await expect(lift('clear-asset')(null, { assetId: '../x' })).rejects.toMatchObject({ code: 'WILSON_PATH_ESCAPE' })
  })
  it('the bodies are thin: the channel asks posters.cjs, and keeps its contained path', () => {
    for (const n of NAMES) {
      const body = extractHandlerBody(MAIN, `ipcMain.handle('rabbit:${n}-thumbnail'`)
      expect(body, n).toMatch(/posters\.(makePoster|clearPoster)\(/)
      expect(body, n).not.toMatch(/sharp\(|unlinkSync/)
    }
  })
})

describe('the wiring: one maker, one acceptor', () => {
  it('sharp( appears once to make a poster (posters.cjs) and once to probe a bin; main.cjs has none (was 5)', () => {
    const count = (name) => (read(name).match(/sharp\(/g) || []).length
    expect(count('main.cjs')).toBe(0)
    expect(count('posters.cjs')).toBe(1)
    expect(count('rabbitBins.cjs')).toBe(1)
    expect(read('rabbitBins.cjs')).toContain('await sharp(target).metadata()')
  })
  it('no acceptor writes a poster itself: every POST asks acceptPoster and putPoster (the managed one wrote in place)', () => {
    expect(MAIN).not.toContain('fs.writeFileSync(thumbPath, buf)')
    const bins = read('rabbitBins.cjs')
    expect(bins).not.toMatch(/writeFileSync\(thumbPath \+ '\.part'|function writePosterAtomically|posterInFlight/)
    expect((bins.match(/acceptPoster\(/g) || []).length).toBe(2)
    expect((read('posters.cjs').match(/acceptPoster\(req\.body/g) || []).length).toBe(1)
  })
  it('the bins and main share the one module (one in-flight map per process)', () => {
    expect(read('rabbitBins.cjs')).toContain("require('./posters.cjs')")
    expect(MAIN).toContain("require('./posters.cjs')")
    expect(MAIN).toMatch(/generateVideoThumbOnce: posters\.generateVideoThumbOnce|generateVideoThumbOnce = posters\.generateVideoThumbOnce|const \{[^}]*generateVideoThumbOnce[^}]*\} = posters/)
  })
})
