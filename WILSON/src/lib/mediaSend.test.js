// =============================================================================
// mediaSend.test.js — F9 item 1 (the desktop-build review's A5; OUTSTANDING
// F3-01 and S4a-06; TPN-CONT-003): the one media sender, electron/mediaSend.cjs,
// SERVED, and every route that answers with a file's bytes.
//
// Real: Express, sendMedia, the bins module, the files stream, local media,
// the office-server file route, sharp, the files on disk, the containment
// resolver and the Local Server's own error handler (localToken.cjs). The
// main process's own media routes cannot be mounted without Electron, so they
// are LIFTED from main.cjs's source and run with stand-ins for the bundle store
// (the idiom of jsonFile.test.js): what each answers is then what main.cjs
// answers, line for line.
//
// The failing controls, each red on the tip before this commit (81df858b):
//   · a cached thumbnail under a dot-folder answered 500 "internal error"
//     (main.cjs's three thumbnail GETs and the bins' poster);
//   · the files download and the managed-file stream answered another origin,
//     and wrote its 'downloaded' event before they did;
//   · no stream but the bins' two answered no-store;
//   · local media answered `private, max-age=0`, another origin, and 403 for
//     a root under a dot-folder (`dotfiles: 'deny'` judged the root's own
//     ancestors);
//   · twenty-two `sendFile(` calls in six files.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const express = require('express')
const sharp = require('sharp')
const here = path.dirname(fileURLToPath(import.meta.url))
const ELECTRON = path.resolve(here, '../../electron')
// The lifted routes `require('./x.cjs')` as main.cjs does.
const requireElectron = createRequire(path.join(ELECTRON, 'main.cjs'))
const { resolveContainedFilePath, dataFilePath } = requireElectron('./pathContainment.cjs')
const { localServerErrorHandler } = requireElectron('./localToken.cjs')
const { mountRabbitBins } = requireElectron('./rabbitBins.cjs')
const { mountFileStreamRead } = requireElectron('./fileReads.cjs')
const { mountLocalMedia } = requireElectron('./localMedia.cjs')
const { mountNetworkShareOps, FILE_ROUTE } = requireElectron('./networkShareOps.cjs')
const { checkShareLocator } = requireElectron('./networkShare.cjs')
const { makeRootQuestions } = requireElectron('./rootReachable.cjs')
const { makeShareContain } = requireElectron('./shareContain.cjs')
// Absent on the tip: the routes below then run as the tip wrote them.
const media = (() => { try { return requireElectron('./mediaSend.cjs') } catch { return null } })()

const MAIN = fs.readFileSync(path.join(ELECTRON, 'main.cjs'), 'utf8').replace(/\r\n/g, '\n')

/** The BODY block of an inline `expressApp.<verb>('<path>', (req, res) => { … })`. */
function extractRouteBody(source, head) {
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
// Every free name the lifted bodies use, then and now.
const LIFT_NAMES = [
  'fs', 'console', 'require', 'sharp', 'ffmpeg', 'singular', 'etype',
  'readRabbitBundle', 'writeRabbitBundle', 'rabbitNotFound', 'rabbitLogFileEvent', 'shouldLogManagedRead',
  'resolveContainedFilePath', 'resolveFileBaseDir', 'resolveManagedFileDiskPath', 'resolveProjectFolderRoot',
  'getThumbCacheDir', 'dataFileOrThrow', 'thumbnailSourceAllowed', 'isThumbableExt', 'isVideoExt',
  'generateVideoThumbOnce', 'safeMediaContentType', 'sendMedia', 'requireSameOrigin', 'posters',
]
function liftRoute(head) {
  const body = extractRouteBody(MAIN, head)
  // eslint-disable-next-line no-new-func
  const run = new Function('deps', 'req', 'res', `const { ${LIFT_NAMES.join(', ')} } = deps; return (async () => ${body})()`)
  return (deps) => (req, res, next) => run(deps, req, res).catch(next)
}
const ROUTE = {
  download: "expressApp.get('/api/rabbit/projects/:projectId/files/:id/download'",
  managedStream: "expressApp.get('/api/rabbit/projects/:projectId/managed-files/:id/stream'",
}
// F9 item 3: the poster routes left main.cjs for posters.cjs and are mounted
// for real below (on the tip they were lifted from main.cjs like the two above).
const posters = (() => { try { return requireElectron('./posters.cjs') } catch { return null } })()

// The media allowlist the tip's routes call by name (main.cjs's, word for word).
const TIP_SAFE = (mime) => {
  const m = String(mime || '').trim().toLowerCase()
  if (m === 'image/svg+xml') return 'application/octet-stream'
  return /^(video|audio|image)\/[a-z0-9][a-z0-9.+-]*$/.test(m) ? m : 'application/octet-stream'
}
const quiet = { error() {}, warn() {}, info() {}, log() {} }
const SAME = { 'sec-fetch-site': 'same-origin' }
const OTHERS = [{ 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }, { 'sec-fetch-site': 'none' }, {}]
const A_ID = '11111111-1111-4111-8111-111111111111'
const S_ID = '22222222-2222-4222-8222-222222222222'
const M_ID = '33333333-3333-4333-8333-333333333333'

let tmp, cacheDir, projectDir, filesDir, sourcePng, plantedJpeg, server, base, store, writes, events

function serve(app) {
  return new Promise((done) => { const s = app.listen(0, '127.0.0.1', () => done(s)) })
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f9-media-'))
  // A demo folder: everything WILSON keeps sits under <folder>/.wilson/rabbit-data.
  const data = path.join(tmp, 'Demo', '.wilson', 'rabbit-data')
  cacheDir = path.join(data, 'thumbnails')
  projectDir = path.join(tmp, 'Demo', 'projects', 'Salt-Hours')
  filesDir = path.join(data, 'projects', 'p1', 'files')
  for (const d of [cacheDir, projectDir, filesDir]) fs.mkdirSync(d, { recursive: true })
  sourcePng = path.join(projectDir, 'still.png')
  fs.writeFileSync(sourcePng, await sharp({ create: { width: 64, height: 32, channels: 3, background: '#3c6' } }).png().toBuffer())
  plantedJpeg = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#c33' } }).jpeg().toBuffer()
  fs.writeFileSync(path.join(filesDir, 'clip.bin'), Buffer.alloc(4096, 7))
  fs.writeFileSync(path.join(projectDir, 'M-v001.png'), fs.readFileSync(sourcePng))

  const deps = {
    fs, console: quiet, require: requireElectron, sharp,
    ffmpeg: { hasFfmpeg: () => false },
    readRabbitBundle: (id) => (store.has(id) ? JSON.parse(store.get(id)) : null),
    writeRabbitBundle: (id, b, opts) => { writes.push({ id, opts }); store.set(id, JSON.stringify(b)) },
    rabbitNotFound: (res, what = 'project') => res.status(404).json({ error: `${what} not found` }),
    rabbitLogFileEvent: (b, evt) => { events.push(evt); (b.fileEvents ||= []).push(evt) },
    shouldLogManagedRead: () => true,
    resolveContainedFilePath,
    resolveFileBaseDir: () => filesDir,
    resolveManagedFileDiskPath: (_b, mf) => path.join(projectDir, mf.stored_name),
    resolveProjectFolderRoot: () => projectDir,
    getThumbCacheDir: () => cacheDir,
    dataFileOrThrow: (dir, id, ext, what) => {
      const p = dataFilePath(dir, id, ext)
      if (!p) { const err = new Error(`invalid ${what} id`); err.code = 'WILSON_PATH_ESCAPE'; throw err }
      return p
    },
    thumbnailSourceAllowed: () => true,
    isThumbableExt: (e) => ['.png', '.jpg', '.jpeg'].includes(String(e || '').toLowerCase()),
    isVideoExt: (e) => ['.mp4', '.mov'].includes(String(e || '').toLowerCase()),
    generateVideoThumbOnce: async () => ({ ok: false, reason: 'ffmpeg_missing' }),
    safeMediaContentType: media ? media.safeMediaContentType : TIP_SAFE,
    sendMedia: media?.sendMedia,
    requireSameOrigin: media?.requireSameOrigin,
  }
  const app = express()
  app.get('/api/rabbit/projects/:projectId/files/:id/download', liftRoute(ROUTE.download)(deps))
  app.get('/api/rabbit/projects/:projectId/managed-files/:id/stream', liftRoute(ROUTE.managedStream)(deps))
  posters.mountPosterRoutes(app, { ...deps, log: quiet })
  // main.cjs's two tail handlers, in its order.
  app.use((err, req, res, next) => (err && err.code === 'WILSON_PATH_ESCAPE' ? res.status(404).json({ error: 'item not found' }) : next(err)))
  app.use((err, req, res, next) => { quiet.error(err); localServerErrorHandler(err, req, res, next) })
  server = await serve(app)
  base = `http://127.0.0.1:${server.address().port}/api/rabbit/projects/p1`
})
afterAll(async () => {
  await new Promise((done) => server.close(done))
  fs.rmSync(tmp, { recursive: true, force: true })
})
beforeEach(() => {
  store = new Map([['p1', JSON.stringify({
    project: { id: 'p1', title: 'Salt Hours', folder_slug: 'Salt-Hours' },
    assets: [{ id: A_ID, name: 'Hero', thumbnail_image: sourcePng }],
    scenes: [{ id: S_ID, name: 'Dawn', thumbnail_image: sourcePng }],
    managedFiles: [{ id: M_ID, file_name: 'M', stored_name: 'M-v001.png', extension: '.png', mime_type: 'image/png', folder_path: '' }],
    files: [{ id: 'f1', name: 'clip.mp4', mime_type: 'text/html', storage_path: 'clip.bin', storage_provider: 'local', size_bytes: 4096 }],
    fileEvents: [],
  })]])
  writes = []
  events = []
  for (const name of fs.readdirSync(cacheDir)) fs.rmSync(path.join(cacheDir, name), { force: true })
})

const get = (url, headers = SAME) => fetch(url, { headers })
async function isJpeg(r) {
  const buf = Buffer.from(await r.arrayBuffer())
  return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
}

describe('F3-01: a cached thumbnail under a dot-folder answers 200 with the JPEG', () => {
  it('the asset thumbnail, cached: the very bytes in the cache', async () => {
    fs.writeFileSync(path.join(cacheDir, `asset-${A_ID}.jpg`), plantedJpeg)
    const r = await get(`${base}/assets/${A_ID}/thumbnail`)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('image/jpeg')
    expect(Buffer.from(await r.arrayBuffer()).equals(plantedJpeg)).toBe(true)
  })
  it('the asset thumbnail, made now from its source, then served', async () => {
    const r = await get(`${base}/assets/${A_ID}/thumbnail`)
    expect(r.status).toBe(200)
    expect(await isJpeg(r)).toBe(true)
    expect(fs.existsSync(path.join(cacheDir, `asset-${A_ID}.jpg`))).toBe(true)
  })
  it('a scene\'s thumbnail (the entity loop), cached', async () => {
    fs.writeFileSync(path.join(cacheDir, `scene-${S_ID}.jpg`), plantedJpeg)
    const r = await get(`${base}/scenes/${S_ID}/thumbnail`)
    expect(r.status).toBe(200)
    expect(Buffer.from(await r.arrayBuffer()).equals(plantedJpeg)).toBe(true)
  })
  it('a managed file\'s thumbnail, cached and made', async () => {
    const made = await get(`${base}/managed-files/${M_ID}/thumbnail`)
    expect(made.status).toBe(200)
    expect(await isJpeg(made)).toBe(true)
    const cached = await get(`${base}/managed-files/${M_ID}/thumbnail`)
    expect(cached.status).toBe(200)
    expect(await isJpeg(cached)).toBe(true)
  })
  it('a bin\'s poster (the real bins module), made and then cached', async () => {
    const bins = express()
    const binStore = new Map([['p1', JSON.stringify({
      project: { id: 'p1' }, bins: [], binRoots: [], shotTakes: [],
      binFiles: [{ id: 'bf1', bin_id: 'b1', source_path: sourcePng, extension: '.png', media_type: 'still', is_sequence: false }],
    })]])
    mountRabbitBins(bins, {
      readRabbitBundle: (id) => (binStore.has(id) ? JSON.parse(binStore.get(id)) : null),
      writeRabbitBundle: (id, b) => binStore.set(id, JSON.stringify(b)),
      rabbitTouch: (r) => r, rabbitUpsertInto: (a, r) => { a.push(r); return r }, rabbitRemoveFrom: () => true,
      rabbitNotFound: (res, w = 'project') => res.status(404).json({ error: `${w} not found` }),
      getThumbCacheDir: () => cacheDir,
      generateVideoThumbOnce: async () => ({ ok: false, reason: 'ffmpeg_missing' }),
      safeMediaContentType: TIP_SAFE,
    })
    bins.use((err, req, res, next) => { quiet.error(err); localServerErrorHandler(err, req, res, next) })
    const s = await serve(bins)
    try {
      const url = `http://127.0.0.1:${s.address().port}/api/rabbit/projects/p1/bin-files/bf1/thumbnail`
      for (const pass of ['made', 'cached']) {
        const r = await get(url)
        expect(r.status, pass).toBe(200)
        expect(r.headers.get('content-type')).toBe('image/jpeg')
        expect(await isJpeg(r)).toBe(true)
        // The one named exception (mediaSend.cjs, REVALIDATE): a bin poster
        // keeps send's own revalidating header, as the bins' test pins.
        expect(r.headers.get('cache-control')).toBe('public, max-age=0')
        expect(r.headers.get('pragma')).toBeNull()
      }
    } finally {
      await new Promise((done) => s.close(done))
    }
  })
})

describe('the main process\'s media routes: no-store, nosniff, and the renderer only', () => {
  const routes = [
    ['the files download', () => `${base}/files/f1/download`],
    ['the managed-file stream', () => `${base}/managed-files/${M_ID}/stream`],
    ['the asset thumbnail', () => `${base}/assets/${A_ID}/thumbnail`],
    ['a scene\'s thumbnail', () => `${base}/scenes/${S_ID}/thumbnail`],
    ['a managed file\'s thumbnail', () => `${base}/managed-files/${M_ID}/thumbnail`],
  ]
  for (const [name, url] of routes) {
    it(`${name} answers the renderer, never cached`, async () => {
      const r = await get(url())
      expect(r.status).toBe(200)
      expect(r.headers.get('cache-control')).toBe('no-store')
      expect(r.headers.get('pragma')).toBe('no-cache')
      expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    })
    it(`${name} refuses another origin, a typed address and no claim at all`, async () => {
      for (const headers of OTHERS) {
        const r = await get(url(), headers)
        expect(r.status, JSON.stringify(headers)).toBe(403)
        expect((await r.json()).code).toBe('cross_origin')
      }
    })
  }
  it('🚨 a refused read writes nothing: no "downloaded" event, no bundle write (the gate is first)', async () => {
    for (const headers of OTHERS) {
      await (await get(`${base}/files/f1/download`, headers)).arrayBuffer()
      await (await get(`${base}/managed-files/${M_ID}/stream`, headers)).arrayBuffer()
    }
    expect(events).toEqual([])
    expect(writes).toEqual([])
    // CONTROL: the renderer's own read IS recorded, by both.
    await (await get(`${base}/files/f1/download`)).arrayBuffer()
    await (await get(`${base}/managed-files/${M_ID}/stream`)).arrayBuffer()
    expect(events.map((e) => e.event)).toEqual(['downloaded', 'downloaded'])
  })
  it('a client-written text/html is still an opaque download', async () => {
    const r = await get(`${base}/files/f1/download`)
    expect(r.headers.get('content-type')).toBe('application/octet-stream')
  })
  it('a <video> still seeks: Range answers 206 with the range, on the download and the managed stream', async () => {
    const r = await get(`${base}/files/f1/download`, { ...SAME, range: 'bytes=0-99' })
    expect(r.status).toBe(206)
    expect(r.headers.get('content-range')).toBe('bytes 0-99/4096')
    expect((await r.arrayBuffer()).byteLength).toBe(100)
    const m = await get(`${base}/managed-files/${M_ID}/stream`, { ...SAME, range: 'bytes=0-9' })
    expect(m.status).toBe(206)
    expect((await m.arrayBuffer()).byteLength).toBe(10)
  })
})

describe('the module routes: no-store where they send bytes', () => {
  it('the files stream (fileReads.cjs)', async () => {
    const app = express()
    mountFileStreamRead(app, {
      fs, readRabbitBundle: () => ({ files: [{ id: 'f1', name: 'clip.mp4', mime_type: 'video/mp4', storage_path: 'clip.bin' }] }),
      rabbitNotFound: (res) => res.status(404).json({ error: 'not found' }), resolveContainedFilePath,
      resolveFileBaseDir: () => filesDir, rabbitLogFileEvent: () => {}, writeRabbitBundle: () => {},
      safeMediaContentType: TIP_SAFE, shouldLogManagedRead: () => false, warn: () => {},
    })
    const s = await serve(app)
    try {
      const r = await get(`http://127.0.0.1:${s.address().port}/api/rabbit/projects/p1/files/f1/stream`)
      expect(r.status).toBe(200)
      expect(r.headers.get('content-type')).toBe('video/mp4')
      expect(r.headers.get('cache-control')).toBe('no-store')
      expect(r.headers.get('pragma')).toBe('no-cache')
    } finally {
      await new Promise((done) => s.close(done))
    }
  })

  it('a file on the office server (networkShareOps.cjs)', async () => {
    const drive = fs.mkdtempSync(path.join(os.tmpdir(), 'f9-share-'))
    fs.mkdirSync(path.join(drive, 'Salt'), { recursive: true })
    fs.writeFileSync(path.join(drive, 'Salt', 'clip.mov'), '0123456789')
    const reach = makeRootQuestions({ askRoot: (r) => fs.promises.stat(r).then(() => true, () => false), rootTtlMs: 1, rootOffTtlMs: 1 })
    const app = express()
    mountNetworkShareOps(app, {
      getWorkspaceRoot: () => drive, isSameOriginRequest: () => true, checkShareLocator,
      isShareRoot: () => true, reach, contain: makeShareContain({ reach }),
    })
    const s = await serve(app)
    try {
      const r = await get(`http://127.0.0.1:${s.address().port}${FILE_ROUTE}/Salt/clip.mov`)
      expect(r.status).toBe(200)
      expect(r.headers.get('cache-control')).toBe('no-store')
      expect(r.headers.get('pragma')).toBe('no-cache')
      expect(r.headers.get('x-content-type-options')).toBe('nosniff')
      expect(await r.text()).toBe('0123456789')
    } finally {
      await new Promise((done) => s.close(done))
      fs.rmSync(drive, { recursive: true, force: true })
    }
  })

  describe('a private project\'s media (localMedia.cjs)', () => {
    let s, url, rootNow
    const KEY = 'projects/p1/files/f1/clip.mp4'
    const plant = (root) => {
      fs.mkdirSync(path.join(root, 'projects', 'p1', 'files', 'f1'), { recursive: true })
      fs.writeFileSync(path.join(root, ...KEY.split('/')), Buffer.alloc(2048, 3))
      fs.mkdirSync(path.join(root, 'projects', 'p1', '.hidden', 'f1'), { recursive: true })
      fs.writeFileSync(path.join(root, 'projects', 'p1', '.hidden', 'f1', 'clip.mp4'), 'x')
      return root
    }
    let plainRoot, dotRoot
    beforeAll(async () => {
      plainRoot = plant(path.join(tmp, 'plain', 'media'))
      // The root itself under a dot-folder: a demo folder kept in one, or
      // app data on Linux (~/.config).
      dotRoot = plant(path.join(tmp, '.under-a-dot', 'media'))
      const app = express()
      mountLocalMedia(app, {
        getRoot: () => rootNow, resolveContainedFilePath, safeMediaContentType: TIP_SAFE,
        sameOriginOnly: media?.requireSameOrigin,
      })
      s = await serve(app)
      url = (key) => `http://127.0.0.1:${s.address().port}/api/rabbit/local-media/${key}`
    })
    afterAll(async () => { await new Promise((done) => s.close(done)) })
    beforeEach(() => { rootNow = plainRoot })

    it('answers the renderer, never cached (was private, max-age=0)', async () => {
      const r = await get(url(KEY))
      expect(r.status).toBe(200)
      expect(r.headers.get('content-type')).toBe('video/mp4')
      expect(r.headers.get('cache-control')).toBe('no-store')
      expect(r.headers.get('pragma')).toBe('no-cache')
      expect((await r.arrayBuffer()).byteLength).toBe(2048)
    })
    it('answers from a root under a dot-folder (was 403: `dotfiles: \'deny\'` judged the root\'s own ancestors)', async () => {
      rootNow = dotRoot
      const r = await get(url(KEY))
      expect(r.status).toBe(200)
      expect((await r.arrayBuffer()).byteLength).toBe(2048)
    })
    it('refuses another origin (main mounts it with sameOriginOnly)', async () => {
      for (const headers of OTHERS) expect((await get(url(KEY), headers)).status, JSON.stringify(headers)).toBe(403)
    })
    it('still refuses a key with a dot-led segment, as `dotfiles: \'deny\'` did, under either root', async () => {
      for (const root of [plainRoot, dotRoot]) {
        rootNow = root
        const r = await get(url('projects/p1/.hidden/f1/clip.mp4'))
        expect(r.status).toBe(403)
        expect(await r.json()).toEqual({ error: 'media read failed' })
      }
    })
    it('still attaches under the asked name', async () => {
      const r = await get(`${url(KEY)}?download=${encodeURIComponent('Take 3.mp4')}`)
      expect(r.headers.get('content-disposition')).toMatch(/^attachment; filename="Take 3\.mp4"/)
    })
    it('a <video> seeks through the route: 206 with the range', async () => {
      const r = await get(url(KEY), { ...SAME, range: 'bytes=100-199' })
      expect(r.status).toBe(206)
      expect(r.headers.get('content-range')).toBe('bytes 100-199/2048')
    })
    it('review round 1: HEAD asks what GET asks — the renderer only, and no dot-led segment', async () => {
      expect((await fetch(url(KEY), { method: 'HEAD', headers: SAME })).status).toBe(200)
      expect((await fetch(url(KEY), { method: 'HEAD', headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403)
      expect((await fetch(url('projects/p1/.hidden/f1/clip.mp4'), { method: 'HEAD', headers: SAME })).status).toBe(403)
    })
  })
})

describe('sendMedia: what it sends, and seeking', () => {
  let s, at, errors, dir
  const BIG = 1 << 21 // 2 MiB: an abort lands mid-body
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f9-send-'))
    const dot = path.join(dir, '.dot')
    fs.mkdirSync(dot)
    fs.writeFileSync(path.join(dot, 'a.bin'), Buffer.from('0123456789'))
    fs.writeFileSync(path.join(dir, 'big.bin'), Buffer.alloc(BIG, 1))
    errors = []
    const app = express()
    app.get('/send/:name', (req, res) => {
      const opts = JSON.parse(String(req.query.o || '{}'))
      media.sendMedia(res, path.join(req.params.name === 'big.bin' ? dir : dot, req.params.name), opts)
    })
    app.use((err, req, res, next) => { errors.push(err); res.status(599).end() })
    s = await serve(app)
    at = (name, o) => `http://127.0.0.1:${s.address().port}/send/${name}${o ? `?o=${encodeURIComponent(JSON.stringify(o))}` : ''}`
  })
  afterAll(async () => {
    await new Promise((done) => s.close(done))
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('the whole file, through a dot-folder, typed through the allowlist, nosniffed, never cached', async () => {
    const r = await fetch(at('a.bin', { mime: 'video/mp4' }))
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('video/mp4')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(r.headers.get('pragma')).toBe('no-cache')
    expect(r.headers.get('accept-ranges')).toBe('bytes')
    expect(await r.text()).toBe('0123456789')
  })
  it('a client-written type that is not media, or is SVG, is an opaque download', async () => {
    for (const mime of ['text/html', 'image/svg+xml', 'application/javascript', null]) {
      expect((await fetch(at('a.bin', { mime }))).headers.get('content-type'), String(mime)).toBe('application/octet-stream')
    }
  })
  it('HEAD answers the length and no body', async () => {
    const r = await fetch(at('a.bin', { mime: 'video/mp4' }), { method: 'HEAD' })
    expect(r.status).toBe(200)
    expect(r.headers.get('content-length')).toBe('10')
    expect(await r.text()).toBe('')
  })
  it('Range answers 206; If-Range with the ETag keeps the range, a stale one sends the whole', async () => {
    const part = await fetch(at('a.bin'), { headers: { range: 'bytes=2-4' } })
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 2-4/10')
    expect(await part.text()).toBe('234')
    const etag = part.headers.get('etag')
    expect(etag).toBeTruthy()
    const kept = await fetch(at('a.bin'), { headers: { range: 'bytes=2-4', 'if-range': etag } })
    expect(kept.status).toBe(206)
    const stale = await fetch(at('a.bin'), { headers: { range: 'bytes=2-4', 'if-range': '"stale"' } })
    expect(stale.status).toBe(200)
    expect(await stale.text()).toBe('0123456789')
  })
  it('a range past the end answers 416, not 500', async () => {
    const r = await fetch(at('a.bin', { failText: 'stream failed' }), { headers: { range: 'bytes=50-60' } })
    expect(r.status).toBe(416)
  })
  it('a file that is not there answers the route\'s own sentence, or nothing', async () => {
    const r = await fetch(at('gone.bin', { failText: 'media read failed' }))
    expect(r.status).toBe(404)
    expect(await r.json()).toEqual({ error: 'media read failed' })
    const bare = await fetch(at('gone.bin', { failText: null }))
    expect(bare.status).toBe(404)
    expect(await bare.text()).toBe('')
  })
  it('an attachment under its name; `revalidate` keeps send\'s own header and no Pragma', async () => {
    const r = await fetch(at('a.bin', { attachmentName: 'Take 3.mov', cache: 'revalidate' }))
    expect(r.headers.get('content-disposition')).toMatch(/^attachment; filename="Take 3\.mov"/)
    expect(r.headers.get('cache-control')).toBe('public, max-age=0')
    expect(r.headers.get('pragma')).toBeNull()
  })
  it('review round 1: an error answer is JSON, without the file\'s own headers', async () => {
    const r = await fetch(at('a.bin', { mime: 'video/mp4', attachmentName: 'x.mp4', failText: 'stream failed' }), { headers: { range: 'bytes=50-60' } })
    expect(r.status).toBe(416)
    expect(r.headers.get('content-type')).toMatch(/^application\/json/)
    for (const h of ['content-disposition', 'last-modified', 'accept-ranges']) expect(r.headers.get(h), h).toBeNull()
    // An ETag, if any, is Express's own for the JSON body, never the file's.
    const file = await fetch(at('a.bin'))
    expect(r.headers.get('etag')).not.toBe(file.headers.get('etag'))
    expect(r.headers.get('content-range')).toBe('bytes */10')
    expect(await r.json()).toEqual({ error: 'stream failed' })
  })
  it('review round 1: a read that fails after the headers went out ends the response (no request timeout would)', () => {
    let destroyed = 0
    const fakeRes = {
      headersSent: false, writableEnded: false,
      setHeader() {}, removeHeader() {}, status() { return this }, type() { return this }, json() {}, end() {},
      destroy() { destroyed += 1 },
      sendFile(_p, _o, cb) { this.headersSent = true; cb(Object.assign(new Error('EIO: read failed'), { code: 'EIO', status: 500 })) },
    }
    media.sendMedia(fakeRes, path.join(dir, 'big.bin'), {})
    expect(destroyed).toBe(1)
    // CONTROL: a cancelled range (every <video> seek) is left alone.
    const seeking = { ...fakeRes, headersSent: false, sendFile(_p, _o, cb) { this.headersSent = true; cb(Object.assign(new Error('aborted'), { code: 'ECONNABORTED' })) } }
    media.sendMedia(seeking, path.join(dir, 'big.bin'), {})
    expect(destroyed).toBe(1)
  })
  it('an unknown cache rule is a programming error', () => {
    expect(() => media.sendMedia({ setHeader() {} }, 'x', { cache: 'public' })).toThrow(/unknown cache rule/)
  })
  it('🚨 a client that hangs up mid-body (every <video> seek) is not an error, and the server answers the next', async () => {
    await new Promise((done) => {
      const req = http.get(at('big.bin'), (res) => {
        res.once('data', () => { req.destroy(); setTimeout(done, 150) })
      })
      req.on('error', () => {})
    })
    expect(errors).toEqual([])
    const next = await fetch(at('a.bin'))
    expect(next.status).toBe(200)
  })
})

describe('requireSameOrigin: the route\'s first line', () => {
  const answer = (headers) => {
    const res = { code: null, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
    return { ok: media.requireSameOrigin({ headers }, res), res }
  }
  it('the renderer passes and nothing is answered', () => {
    const { ok, res } = answer({ 'sec-fetch-site': 'same-origin' })
    expect(ok).toBe(true)
    expect(res.code).toBeNull()
  })
  it('anything else is answered 403 cross_origin', () => {
    for (const headers of [...OTHERS, { origin: 'http://evil.example', host: '127.0.0.1:1' }]) {
      const { ok, res } = answer(headers)
      expect(ok, JSON.stringify(headers)).toBe(false)
      expect(res.code).toBe(403)
      expect(res.body).toEqual({ error: 'file streams answer WILSON only', code: 'cross_origin' })
    }
  })
  it('fileReads.cjs re-exports the one rule, not a copy', () => {
    expect(requireElectron('./fileReads.cjs').isSameOriginRequest).toBe(media.isSameOriginRequest)
    expect(requireElectron('./localMedia.cjs').contentDisposition).toBe(media.contentDisposition)
  })
})

describe('the wiring', () => {
  const sources = fs.readdirSync(ELECTRON).filter((n) => n.endsWith('.cjs'))
    .map((n) => [n, fs.readFileSync(path.join(ELECTRON, n), 'utf8')])
  it('only mediaSend.cjs sends a file (and the SPA fallback its index.html): was 22 calls in six files', () => {
    const senders = sources.filter(([, text]) => /\.sendFile\(/.test(text)).map(([n]) => n).sort()
    expect(senders).toEqual(['mediaSend.cjs', 'spaFallback.cjs'])
    expect(sources.find(([n]) => n === 'mediaSend.cjs')[1].match(/\.sendFile\(/g)).toHaveLength(1)
  })
  it('review round 1: no other way to send a file\'s bytes (res.download, a piped stream)', () => {
    for (const [n, text] of sources) {
      expect(text, n).not.toMatch(/\bres\.download\(|\.pipe\(res\b/)
    }
  })
  it('review round 1: main binds the gate and the sender from mediaSend.cjs (a dropped name would crash every media route)', () => {
    expect(MAIN).toContain("const { safeMediaContentType, sendMedia, requireSameOrigin } = require('./mediaSend.cjs');")
  })
  it('main mounts local media with the gate, and takes the allowlist from mediaSend.cjs', () => {
    const at = MAIN.indexOf("require('./localMedia.cjs').mountLocalMedia(expressApp, {")
    expect(at).toBeGreaterThan(-1)
    expect(MAIN.slice(at, MAIN.indexOf('})', at))).toContain('sameOriginOnly: requireSameOrigin,')
    expect(MAIN).toContain("require('./mediaSend.cjs')")
    expect(MAIN).not.toMatch(/function safeMediaContentType\(/)
  })
})
