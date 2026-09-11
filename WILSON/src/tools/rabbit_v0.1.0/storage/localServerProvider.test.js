// =============================================================================
// localServerProvider.test.js — the `local_server` registry provider over a
// fake fetch. What this pins: the five verbs hit the five routes with the
// key encoded per segment; off the desktop every verb refuses with NOT_HERE
// (a sentence, not "no storage provider registered"); getUrl carries the
// download name; the XHR transport reports progress.
// =============================================================================

import { describe, it, expect } from 'vitest'
import {
  createLocalServerStorageProvider, localMediaUrl, encodeMediaKey, NOT_HERE, LOCAL_MEDIA_BASE,
} from './localServerProvider.js'

function fakeFetch(handler) {
  const calls = []
  const f = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body })
    const r = handler(url, init) || {}
    const status = r.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: r.statusText || '',
      json: async () => r.json ?? {},
      blob: async () => r.blob ?? new Blob([r.text || '']),
    }
  }
  f.calls = calls
  return f
}

describe('localMediaUrl / encodeMediaKey', () => {
  it('encodes per segment and keeps the slashes', () => {
    expect(encodeMediaKey('projects/p#1/a b/x.mov')).toBe('projects/p%231/a%20b/x.mov')
    expect(localMediaUrl('projects/p/a/1/x.mov')).toBe(`${LOCAL_MEDIA_BASE}/projects/p/a/1/x.mov`)
    expect(localMediaUrl('projects/p/a/1/x.mov', { download: 'Hero shot.mov' }))
      .toBe(`${LOCAL_MEDIA_BASE}/projects/p/a/1/x.mov?download=Hero%20shot.mov`)
  })
})

describe('off the desktop, every verb is a sentence', () => {
  const p = createLocalServerStorageProvider({ available: () => false, fetchImpl: fakeFetch(() => ({})), xhr: null })
  it('put / get / del / exists / getUrl refuse with NOT_HERE', async () => {
    await expect(p.put('projects/p/a/1/x.mov', new Blob(['x']))).rejects.toThrow(NOT_HERE)
    await expect(p.get('projects/p/a/1/x.mov')).rejects.toThrow(NOT_HERE)
    await expect(p.del('projects/p/a/1/x.mov')).rejects.toThrow(NOT_HERE)
    await expect(p.exists('projects/p/a/1/x.mov')).rejects.toThrow(NOT_HERE)
    await expect(p.getUrl('projects/p/a/1/x.mov')).rejects.toThrow(NOT_HERE)
  })
  it('describe says unreachable, with the same sentence', async () => {
    expect(await p.describe()).toMatchObject({ provider: 'local_server', reachable: false, detail: NOT_HERE })
  })
})

describe('on the desktop, the five verbs hit the five routes', () => {
  const KEY = 'projects/p1/assets/a1/1000-clip.mov'
  it('put PUTs octet-stream to the key and returns { key }', async () => {
    const f = fakeFetch(() => ({ json: { key: KEY, size: 1 } }))
    const p = createLocalServerStorageProvider({ available: () => true, fetchImpl: f, xhr: null })
    const body = new Blob(['x'])
    expect(await p.put(KEY, body, { contentType: 'video/quicktime' })).toEqual({ key: KEY })
    expect(f.calls[0]).toMatchObject({ url: `${LOCAL_MEDIA_BASE}/${KEY}`, method: 'PUT' })
    expect(f.calls[0].headers['content-type']).toBe('application/octet-stream')
    expect(f.calls[0].body).toBe(body)
  })
  it('put surfaces the route\'s sentence on refusal', async () => {
    const f = fakeFetch(() => ({ status: 409, json: { error: 'a body already exists at this key' } }))
    const p = createLocalServerStorageProvider({ available: () => true, fetchImpl: f, xhr: null })
    await expect(p.put(KEY, new Blob(['x']))).rejects.toThrow('a body already exists at this key')
  })
  it('get returns the blob; a 404 throws', async () => {
    const f = fakeFetch((url) => (url.endsWith('missing.mov') ? { status: 404, json: { error: 'media not found' } } : { text: 'bytes' }))
    const p = createLocalServerStorageProvider({ available: () => true, fetchImpl: f, xhr: null })
    const blob = await p.get(KEY)
    expect(await blob.text()).toBe('bytes')
    await expect(p.get('projects/p1/assets/a1/missing.mov')).rejects.toThrow('media not found')
  })
  it('exists is a HEAD; del tolerates 404 and throws on anything else', async () => {
    const f = fakeFetch((url, init) => {
      if (init.method === 'HEAD') return { status: url.endsWith('gone.mov') ? 404 : 200 }
      if (init.method === 'DELETE') return { status: url.endsWith('gone.mov') ? 404 : url.endsWith('locked.mov') ? 500 : 204 }
      return {}
    })
    const p = createLocalServerStorageProvider({ available: () => true, fetchImpl: f, xhr: null })
    expect(await p.exists(KEY)).toBe(true)
    expect(await p.exists('projects/p1/assets/a1/gone.mov')).toBe(false)
    await expect(p.del(KEY)).resolves.toBeUndefined()
    await expect(p.del('projects/p1/assets/a1/gone.mov')).resolves.toBeUndefined()
    await expect(p.del('projects/p1/assets/a1/locked.mov')).rejects.toThrow('media delete failed')
  })
  it('getUrl is the local URL, with the download name when asked', async () => {
    const p = createLocalServerStorageProvider({ available: () => true, fetchImpl: fakeFetch(() => ({})), xhr: null })
    expect(await p.getUrl(KEY, 3600)).toBe(`${LOCAL_MEDIA_BASE}/${KEY}`)
    expect(await p.getUrl(KEY, 300, { download: 'clip.mov' })).toBe(`${LOCAL_MEDIA_BASE}/${KEY}?download=clip.mov`)
  })
  it('describe reports the root the server names', async () => {
    const f = fakeFetch(() => ({ json: { root: 'D:\\Demo\\media', exists: true } }))
    const p = createLocalServerStorageProvider({ available: () => true, fetchImpl: f, xhr: null })
    expect(await p.describe()).toMatchObject({ reachable: true, root: 'D:\\Demo\\media' })
    const g = createLocalServerStorageProvider({ available: () => true, fetchImpl: fakeFetch(() => ({ status: 503, json: { error: 'the demo folder is not available' } })), xhr: null })
    expect(await g.describe()).toMatchObject({ reachable: false, detail: 'the demo folder is not available' })
  })
})

describe('the XHR transport carries progress', () => {
  it('reports loaded/total and resolves on 2xx, rejects on the route\'s sentence', async () => {
    const seen = []
    class FakeXHR {
      constructor() { this.upload = {}; this.headers = {}; FakeXHR.last = this }
      open(m, u) { this.method = m; this.url = u }
      setRequestHeader(k, v) { this.headers[k] = v }
      send(body) {
        this.body = body
        this.upload.onprogress({ lengthComputable: true, loaded: 5, total: 10 })
        this.upload.onprogress({ lengthComputable: true, loaded: 10, total: 10 })
        this.status = FakeXHR.status
        this.responseText = FakeXHR.responseText || ''
        this.onload()
      }
    }
    FakeXHR.status = 200
    const p = createLocalServerStorageProvider({ available: () => true, fetchImpl: fakeFetch(() => ({})), xhr: FakeXHR })
    const r = await p.put('projects/p/a/1/x.mov', new Blob(['0123456789']), { onProgress: (s, t) => seen.push([s, t]) })
    expect(r).toEqual({ key: 'projects/p/a/1/x.mov' })
    expect(seen).toEqual([[5, 10], [10, 10]])
    expect(FakeXHR.last.method).toBe('PUT')
    expect(FakeXHR.last.headers['content-type']).toBe('application/octet-stream')

    FakeXHR.status = 409
    FakeXHR.responseText = JSON.stringify({ error: 'a body already exists at this key' })
    await expect(p.put('projects/p/a/1/x.mov', new Blob(['x']), { onProgress: () => {} }))
      .rejects.toThrow('a body already exists at this key')
  })
})
