// =============================================================================
// storage/localServerProvider.js — the `local_server` provider (demo
// 2026-09-11): cloud rows, bodies on THIS computer.
//
// Audrey, 2026-09-11: "all databases need to live in the supabase storage at
// all times. the only thing local storage should be related to is just the
// media files and asset of the project."
//
// The registry (storage/index.js) has said since S36 that a `network`
// workspace's new bodies go to `local_server`, and that nobody registers it
// because a browser cannot write to a disk. The DESKTOP renderer can: its
// page is served by the app's own Express server on 127.0.0.1, and
// electron/localMedia.cjs gives that server five routes, one per registry
// function. This module is those five functions over `fetch`, plus the
// optional `getUrl` a <video> and a download link need.
//
// 🚨 REGISTERED ON EVERY SURFACE, USABLE ON ONE. In the browser build (and
// on a desktop that is not the one that holds the files) every function
// refuses with NOT_HERE — a sentence a person can act on — instead of the
// registry's "no storage provider registered". That is the whole point of
// registering it: a private project's row can name this provider anywhere,
// and it must resolve to words, never to a stack trace or a silent absence.
//
// A provider is five functions, never an adapter fork (§4a2b). Nothing here
// knows about projects, rows or the money gate; uploadFile decides the key
// and the provider, this module moves bytes for a key.
// =============================================================================

import { hasLocalServer } from '../../../lib/localData'

export const LOCAL_MEDIA_BASE = '/api/rabbit/local-media'
export const NOT_HERE =
  'this file lives on the computer that added it — open WILSON on that computer to see it'

export function encodeMediaKey(key) {
  return String(key || '').split('/').map(encodeURIComponent).join('/')
}

/** The URL the local server serves a key at. Absolute when a page origin
 *  exists (a <video> src and an <a download> need one), relative otherwise. */
export function localMediaUrl(key, { download } = {}) {
  const loc = typeof window !== 'undefined' ? window.location : null
  const origin = loc && /^https?:$/.test(loc.protocol) && loc.origin ? loc.origin : ''
  const q = download ? `?download=${encodeURIComponent(String(download))}` : ''
  return `${origin}${LOCAL_MEDIA_BASE}/${encodeMediaKey(key)}${q}`
}

async function errorText(res) {
  try {
    const j = await res.json()
    if (j && typeof j.error === 'string') return j.error
  } catch { /* not JSON */ }
  return `${res.status} ${res.statusText || ''}`.trim()
}

// Upload with progress needs XHR — fetch has no upload-progress events. The
// body is a File/Blob, which Chromium streams from disk, so a multi-GB
// master never has to fit in the renderer.
function putWithProgress(XHR, url, body, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XHR()
    x.open('PUT', url)
    x.setRequestHeader('content-type', 'application/octet-stream')
    if (x.upload) {
      x.upload.onprogress = (e) => {
        if (!e || !e.lengthComputable) return
        try { onProgress(e.loaded, e.total) } catch { /* a progress bar must never fail an upload */ }
      }
    }
    x.onload = () => {
      if (x.status >= 200 && x.status < 300) return resolve()
      let msg = `${x.status}`
      try { msg = JSON.parse(x.responseText).error || msg } catch { /* not JSON */ }
      reject(new Error(`[local] media write failed: ${msg}`))
    }
    x.onerror = () => reject(new Error('[local] media write failed: the local server did not answer'))
    x.onabort = () => reject(new Error('[local] media write aborted'))
    x.send(body)
  })
}

/**
 * @param {object} [deps]
 * @param {() => boolean} [deps.available] — is THIS surface the desktop app
 *   with its local server? Defaults to hasLocalServer().
 * @param {typeof fetch} [deps.fetchImpl] — test seam.
 * @param {typeof XMLHttpRequest} [deps.xhr] — test seam; null disables the
 *   progress transport.
 */
export function createLocalServerStorageProvider({ available = hasLocalServer, fetchImpl, xhr } = {}) {
  const f = (...args) => (fetchImpl || globalThis.fetch)(...args)
  const here = () => { if (!available()) throw new Error(NOT_HERE) }
  const XHR = xhr === undefined
    ? (typeof XMLHttpRequest !== 'undefined' ? XMLHttpRequest : null)
    : xhr

  return {
    name: 'local_server',

    // No overwrite, ever: the route answers 409 for a key that exists, the
    // same upsert:false rule supabaseProvider.put keeps. Keys are unique by
    // construction (uploadFile stamps Date.now() into the leaf).
    async put(key, body, opts = {}) {
      here()
      const url = localMediaUrl(key)
      if (XHR && typeof opts.onProgress === 'function') {
        await putWithProgress(XHR, url, body, opts.onProgress)
        return { key }
      }
      const res = await f(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body,
      })
      if (!res.ok) throw new Error(`[local] media write failed: ${await errorText(res)}`)
      return { key }
    },

    async get(key) {
      here()
      const res = await f(localMediaUrl(key))
      if (!res.ok) throw new Error(`[local] media read failed: ${await errorText(res)}`)
      return await res.blob()
    },

    async del(key) {
      here()
      const res = await f(localMediaUrl(key), { method: 'DELETE' })
      if (!res.ok && res.status !== 404) throw new Error(`[local] media delete failed: ${await errorText(res)}`)
    },

    async exists(key) {
      here()
      const res = await f(localMediaUrl(key), { method: 'HEAD' })
      return res.ok
    },

    // A URL a <video> can Range-request and an <a download> can save from.
    // No expiry: the local server answers whoever can reach 127.0.0.1 on this
    // machine, which is the trust a file on this disk already has.
    async getUrl(key, _expiresIn, opts = {}) {
      here()
      return localMediaUrl(key, { download: opts.download })
    },

    async describe() {
      const base = { provider: 'local_server', label: 'This computer', configurable: false }
      if (!available()) return { ...base, reachable: false, root: null, detail: NOT_HERE }
      try {
        const res = await f(LOCAL_MEDIA_BASE)
        const j = res.ok ? await res.json() : null
        if (!j || !j.root) {
          return { ...base, reachable: false, root: null, detail: res.ok ? 'the local media root is not available' : await errorText(res) }
        }
        return { ...base, reachable: true, root: j.root, detail: `Private projects keep their media in ${j.root}` }
      } catch (err) {
        return { ...base, reachable: false, root: null, detail: err?.message || 'the local server did not answer' }
      }
    },
  }
}
