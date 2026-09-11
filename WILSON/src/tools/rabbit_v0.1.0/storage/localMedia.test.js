// =============================================================================
// localMedia.test.js — the desktop's five local-media routes
// (electron/localMedia.cjs), driven through a real express app on a temp
// root, the way rabbitBins.routes.test.js drives the bins.
//
// What this pins:
//   * put / get / head / delete round-trip, Range and ?download on get,
//     409 on a second put to the same key, 404 after delete.
//   * The global express.json parser the real server mounts does NOT eat
//     an octet-stream body — even one that LOOKS like JSON.
//   * The boundary: a dot-segment key (sent encoded, since fetch normalises
//     a literal ..), a backslash, a device name, a foreign prefix and a key
//     under a junction that points OUTSIDE the root are all 404, and
//     nothing lands outside the root.
//   * A root that cannot be resolved (the demo folder that vanished) is a
//     503 with the sentence, on every verb.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'

const require = createRequire(import.meta.url)
const { mountLocalMedia, checkMediaKey, mimeForLeaf, contentDisposition, ROUTE_BASE } =
  require('../../../../electron/localMedia.cjs')
const { resolveContainedFilePath } = require('../../../../electron/pathContainment.cjs')

const SAFE = (m) => (/^(video|audio|image)\/[a-z0-9][a-z0-9.+-]*$/.test(m) && m !== 'image/svg+xml' ? m : 'application/octet-stream')

let root, outside, server, base
let rootAvailable = true
const logged = []

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wilson-local-media-'))
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wilson-outside-'))
  const app = express()
  // The real server mounts this globally (main.cjs); the PUT must survive it.
  app.use(express.json({ limit: '1mb' }))
  mountLocalMedia(app, {
    getRoot: () => {
      if (!rootAvailable) throw new Error('the demo folder is not available — open Settings → Storage')
      return root
    },
    resolveContainedFilePath,
    safeMediaContentType: SAFE,
    log: (line) => logged.push(line),
  })
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r) })
  base = `http://127.0.0.1:${server.address().port}${ROUTE_BASE}`
})

afterAll(async () => {
  await new Promise((r) => server.close(r))
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(outside, { recursive: true, force: true })
})

const put = (key, body, init = {}) => fetch(`${base}/${key}`, {
  method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body, ...init,
})

describe('checkMediaKey — only the shape uploadFile writes', () => {
  it('accepts a body key and its thumbnail key', () => {
    expect(checkMediaKey('projects/8d2c/assets/a1/1731-clip.mov').ok).toBe(true)
    expect(checkMediaKey('projects/8d2c/assets/a1/1731-clip.mov.jpg').ok).toBe(true)
    expect(checkMediaKey('projects/8d2c/project/8d2c/1-x_y.png').ok).toBe(true)
  })
  it('refuses everything that is not that shape', () => {
    for (const bad of [
      '', 'projects', 'projects/p1', 'otter/p1/a/b', '/projects/p1/a/b', 'projects//a/b',
      'projects/p1/../b/c', 'projects/p1/./b/c', 'projects/p1/a\\b/c', 'projects/p1/C:/b/c',
      'projects/p1/a/b/con', 'projects/p1/a/b/NUL.mp4', 'projects/p1/a/b/x.', 'projects/p1/a/b/x ',
      'projects/p1/a/b/x\0y', 'projects/p1/a/b/ünïcode.mov', 'projects/p1/a/b/x y.mov',
      'projects/' + 'a/'.repeat(12) + 'b',
    ]) {
      expect(checkMediaKey(bad).ok, JSON.stringify(bad)).toBe(false)
    }
    expect(checkMediaKey('projects/p1/a/' + 'x'.repeat(256)).ok).toBe(false)
  })
})

describe('mimeForLeaf / contentDisposition', () => {
  it('knows the media extensions and falls back to octet-stream', () => {
    expect(mimeForLeaf('1-clip.MOV')).toBe('video/quicktime')
    expect(mimeForLeaf('1-clip.mov.jpg')).toBe('image/jpeg')
    expect(mimeForLeaf('deck.pdf')).toBe('application/octet-stream')
  })
  it('names the download in both forms and strips what could break the header', () => {
    const h = contentDisposition('My "clip"\r\n.mov')
    expect(h.startsWith('attachment; filename="My _clip___.mov"')).toBe(true)
    expect(h).toContain("filename*=UTF-8''My%20_clip___.mov")
  })
})

describe('the five verbs on a temp root', () => {
  const KEY = 'projects/p1/assets/a1/1000-clip.mp4'
  const BYTES = Buffer.from('0123456789abcdef')

  it('describes the root', async () => {
    const r = await fetch(base)
    expect(r.status).toBe(200)
    const j = await r.json()
    expect(j.root).toBe(root)
    expect(j.exists).toBe(true)
  })

  it('put writes under the root and answers the key and size', async () => {
    const r = await put(KEY, BYTES)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ key: KEY, size: 16 })
    const onDisk = path.join(root, 'projects', 'p1', 'assets', 'a1', '1000-clip.mp4')
    expect(fs.readFileSync(onDisk)).toEqual(BYTES)
    expect(fs.readdirSync(path.dirname(onDisk))).toEqual(['1000-clip.mp4']) // no .part left behind
  })

  it('a second put to the same key is 409 and leaves the first body alone', async () => {
    const r = await put(KEY, Buffer.from('overwrite'))
    expect(r.status).toBe(409)
    expect(fs.readFileSync(path.join(root, 'projects', 'p1', 'assets', 'a1', '1000-clip.mp4'))).toEqual(BYTES)
  })

  it('head reports the body with its type and size', async () => {
    const r = await fetch(`${base}/${KEY}`, { method: 'HEAD' })
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('video/mp4')
    expect(r.headers.get('content-length')).toBe('16')
    expect(r.headers.get('accept-ranges')).toBe('bytes')
  })

  it('get streams the bytes, typed and nosniffed', async () => {
    const r = await fetch(`${base}/${KEY}`)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('video/mp4')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect(Buffer.from(await r.arrayBuffer())).toEqual(BYTES)
  })

  it('get honours a Range request (what a <video> needs)', async () => {
    const r = await fetch(`${base}/${KEY}`, { headers: { range: 'bytes=2-4' } })
    expect(r.status).toBe(206)
    expect(r.headers.get('content-range')).toBe('bytes 2-4/16')
    expect(Buffer.from(await r.arrayBuffer()).toString()).toBe('234')
  })

  it('?download= attaches under the real name', async () => {
    const r = await fetch(`${base}/${KEY}?download=${encodeURIComponent('Hero shot.mp4')}`)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-disposition')).toContain('attachment; filename="Hero shot.mp4"')
  })

  it('an octet-stream body that looks like JSON is stored verbatim (the global json parser stays out)', async () => {
    const key = 'projects/p1/assets/a1/1001-notes.json'
    const body = Buffer.from('{"a":1}')
    const r = await put(key, body)
    expect(r.status).toBe(200)
    const g = await fetch(`${base}/${key}`)
    expect(Buffer.from(await g.arrayBuffer())).toEqual(body)
    expect(g.headers.get('content-type')).toBe('application/octet-stream')
  })

  it('delete removes the body; get, head and delete are then 404', async () => {
    const d = await fetch(`${base}/${KEY}`, { method: 'DELETE' })
    expect(d.status).toBe(204)
    expect((await fetch(`${base}/${KEY}`)).status).toBe(404)
    expect((await fetch(`${base}/${KEY}`, { method: 'HEAD' })).status).toBe(404)
    expect((await fetch(`${base}/${KEY}`, { method: 'DELETE' })).status).toBe(404)
  })
})

describe('the boundary holds against a row-shaped key', () => {
  const treeBefore = () => fs.readdirSync(outside)

  it('a dot-segment key (sent encoded) is 404 and writes nothing', async () => {
    const snapshot = treeBefore()
    const r = await put('projects/p1/%2e%2e/%2e%2e/escape.bin', Buffer.from('x'))
    expect(r.status).toBe(404)
    expect(fs.existsSync(path.join(root, '..', 'escape.bin'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'escape.bin'))).toBe(false)
    expect(treeBefore()).toEqual(snapshot)
  })

  it('a backslash, a device name, a colon and a foreign prefix are 404', async () => {
    for (const bad of ['projects/p1/a%5Cb/c.bin', 'projects/p1/a/b/NUL', 'projects/p1/C%3A/b/c.bin', 'otter/p1/a/b.bin', 'projects/p1/a/b/x%00y.bin']) {
      const r = await put(bad, Buffer.from('x'))
      expect(r.status, bad).toBe(404)
    }
  })

  it('a key under a junction that points outside the root is 404 for every verb', async () => {
    const link = path.join(root, 'projects', 'link')
    fs.mkdirSync(path.dirname(link), { recursive: true })
    fs.symlinkSync(outside, link, 'junction')
    fs.writeFileSync(path.join(outside, 'secret.mp4'), 'secret')
    const snapshot = treeBefore()
    expect((await put('projects/link/a/b/x.bin', Buffer.from('x'))).status).toBe(404)
    expect((await fetch(`${base}/projects/link/secret.mp4/x/y`)).status).toBe(404)
    expect((await fetch(`${base}/projects/link/a/secret.mp4`)).status).toBe(404)
    expect((await fetch(`${base}/projects/link/a/secret.mp4`, { method: 'DELETE' })).status).toBe(404)
    expect(treeBefore()).toEqual(snapshot)
    expect(fs.existsSync(path.join(outside, 'secret.mp4'))).toBe(true)
  })

  it('the root itself is never addressable', async () => {
    expect((await fetch(`${base}/projects/p1/assets`)).status).toBe(404)
  })
})

describe('no root, no service', () => {
  it('every verb is a 503 with the sentence while the root cannot be resolved', async () => {
    rootAvailable = false
    try {
      for (const [m, p] of [['GET', ''], ['PUT', '/projects/p1/a/b/c.bin'], ['GET', '/projects/p1/a/b/c.bin'], ['DELETE', '/projects/p1/a/b/c.bin']]) {
        const r = await fetch(`${base}${p}`, { method: m, ...(m === 'PUT' ? { headers: { 'content-type': 'application/octet-stream' }, body: 'x' } : {}) })
        expect(r.status, `${m} ${p}`).toBe(503)
        expect((await r.json()).error).toContain('the demo folder is not available')
      }
      const h = await fetch(`${base}/projects/p1/a/b/c.bin`, { method: 'HEAD' })
      expect(h.status).toBe(503)
    } finally {
      rootAvailable = true
    }
  })
})
