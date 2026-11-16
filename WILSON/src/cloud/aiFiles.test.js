// =============================================================================
// aiFiles — the upload path that replaced base64-inlined source documents.
//
// The 546 outage (2026-08-11) happened because whole documents rode inside the
// ai-proxy request body. These tests guard the two things that would break the
// replacement SILENTLY — a corrupted upload and a missing beta header — rather
// than the transport, which fails loudly on its own.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./auth/supabaseClient', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } },
}))

const { base64ToBlob, uploadAIFile, FILES_BETA, AIFileError } = await import('./aiFiles.js')

/** Round-trip helper: Blob -> base64, so a decode bug cannot hide behind a re-encode bug. */
async function blobToBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer())
}

function bytesToBase64(bytes) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

describe('base64ToBlob', () => {
  it('round-trips bytes exactly', async () => {
    const original = new Uint8Array(Array.from({ length: 5000 }, (_, i) => i % 256))
    const blob = base64ToBlob(bytesToBase64(original), 'application/pdf')
    expect(await blobToBytes(blob)).toEqual(original)
    expect(blob.type).toBe('application/pdf')
  })

  it('round-trips across the chunk boundary, where a bad slice length corrupts silently', async () => {
    // The decoder slices the base64 string. base64 encodes 3 bytes per 4 chars,
    // so a slice length that is not a multiple of 4 splits a quantum and every
    // byte after the first chunk is wrong — with no error anywhere. 393216 is
    // the shipped chunk; this input spans several of them.
    const CHUNK_CHARS = 1024 * 384
    const bytesPerChunk = (CHUNK_CHARS / 4) * 3
    const size = bytesPerChunk * 2 + 777 // deliberately not chunk-aligned
    const original = new Uint8Array(size)
    for (let i = 0; i < size; i++) original[i] = (i * 31) % 256

    const blob = base64ToBlob(bytesToBase64(original))
    const out = await blobToBytes(blob)
    expect(out.length).toBe(original.length)
    expect(out).toEqual(original)
  })

  it('tolerates whitespace and an empty payload', async () => {
    const original = new Uint8Array([1, 2, 3, 4, 5])
    const withNewlines = bytesToBase64(original).replace(/(.{4})/g, '$1\n')
    expect(await blobToBytes(base64ToBlob(withNewlines))).toEqual(original)
    expect((await blobToBytes(base64ToBlob(''))).length).toBe(0)
  })
})

describe('FILES_BETA', () => {
  it('is the exact beta string Anthropic requires', () => {
    // Asserted as the executable value, not a phrase: this string has to match
    // on the upload AND on every messages request that references the file_id.
    // A typo returns a 400 that mentions neither beta headers nor the file.
    expect(FILES_BETA).toBe('files-api-2025-04-14')
  })
})

describe('uploadAIFile', () => {
  beforeEach(() => { vi.unstubAllGlobals() })

  it('posts multipart WITHOUT a hand-set content-type, so the boundary is generated', async () => {
    let seen = null
    vi.stubGlobal('fetch', async (url, init) => {
      seen = { url, init }
      return { ok: true, json: async () => ({ id: 'file_abc', size_bytes: 3 }) }
    })

    const out = await uploadAIFile({ data: 'AAAA', filename: 'a.pdf', mediaType: 'application/pdf' })

    expect(out.id).toBe('file_abc')
    expect(String(seen.url)).toContain('/functions/v1/ai-files')
    expect(seen.init.body).toBeInstanceOf(FormData)
    // Anthropic's contract: the multipart field must be named `file`.
    expect(seen.init.body.get('file')).toBeInstanceOf(Blob)
    // Setting content-type by hand omits the boundary and the upstream cannot
    // parse the stream — the resulting error names neither cause.
    const headerNames = Object.keys(seen.init.headers).map((h) => h.toLowerCase())
    expect(headerNames).not.toContain('content-type')
    expect(headerNames).toContain('authorization')
  })

  it('surfaces Anthropic’s own message when the proxy forwarded one', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'upstream_error', anthropic: { error: { message: 'unsupported file type' } } }),
    }))
    await expect(uploadAIFile({ data: 'AAAA', filename: 'a.xyz' }))
      .rejects.toThrow('unsupported file type')
  })

  it('treats a 200 with no id as a failure rather than returning undefined', async () => {
    // An unchecked id would flow into a content block as `file_id: undefined`
    // and fail much later, at generation time, as an unrelated-looking 400.
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({}) }))
    await expect(uploadAIFile({ data: 'AAAA', filename: 'a.pdf' })).rejects.toThrow(AIFileError)
  })
})

// =============================================================================
// FX12 (2026-10-25, OUTSTANDING DG1-03): letting go of what was uploaded.
// =============================================================================

const {
  UPLOAD_EXPIRY_SECONDS, DELETE_BATCH, deleteAIFiles, listAIFiles, sweepAIFiles,
  holdAIFiles, releaseAllAIFiles, __setCurrentTokenForTests, neutralFileName,
} = await import('./aiFiles.js')

const fid = (n) => `file_011Test${String(n).padStart(12, '0')}`
const okJson = (body) => ({ ok: true, status: 200, json: async () => body })

describe('uploadAIFile gives the store a neutral name (FX12 review round 1, finding 5)', () => {
  beforeEach(() => { vi.unstubAllGlobals() })
  it('the store keeps the kind, never the person\'s file name', async () => {
    let form = null
    vi.stubGlobal('fetch', async (_u, init) => { form = init.body; return okJson({ id: 'file_abc' }) })
    await uploadAIFile({ data: 'AAAA', filename: 'Client-Codename-Treatment-v7.pdf', mediaType: 'application/pdf' })
    expect(form.get('file').name).toBe('document.pdf')
    // CONTROL: the type still travels on the part, so the store reads it as a PDF.
    expect(form.get('file').type).toBe('application/pdf')
  })
  it('each kind D.O.G. sends has its neutral name; anything else is "document"', () => {
    expect(['application/pdf', 'text/plain', 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'text/plain;charset=utf-8', 'video/mp4', '']
      .map(neutralFileName)).toEqual(['document.pdf', 'document.txt', 'image.jpg', 'image.png', 'image.gif', 'image.webp', 'document.txt', 'document', 'document'])
  })
})

describe('uploadAIFile asks the store to expire the file (FX12)', () => {
  beforeEach(() => { vi.unstubAllGlobals() })
  it(`sends expires_in_seconds = ${UPLOAD_EXPIRY_SECONDS} before the file`, async () => {
    let form = null
    vi.stubGlobal('fetch', async (_u, init) => { form = init.body; return okJson({ id: 'file_abc' }) })
    await uploadAIFile({ data: 'AAAA', filename: 'a.pdf', mediaType: 'application/pdf' })
    expect(form.get('expires_in_seconds')).toBe(String(24 * 60 * 60))
    expect([...form.keys()]).toEqual(['expires_in_seconds', 'file'])
  })
})

describe('deleteAIFiles', () => {
  beforeEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it('DELETEs a JSON list with the bearer, and its own AbortSignal', async () => {
    const seen = []
    vi.stubGlobal('fetch', async (url, init) => { seen.push({ url, init }); return okJson({ results: JSON.parse(init.body).file_ids.map(id => ({ id, outcome: 'deleted' })) }) })
    const out = await deleteAIFiles([fid(1), fid(2)])
    expect(out).toEqual([{ id: fid(1), outcome: 'deleted' }, { id: fid(2), outcome: 'deleted' }])
    expect(seen).toHaveLength(1)
    expect(String(seen[0].url)).toContain('/functions/v1/ai-files')
    expect(seen[0].init.method).toBe('DELETE')
    expect(JSON.parse(seen[0].init.body)).toEqual({ file_ids: [fid(1), fid(2)] })
    expect(seen[0].init.headers.authorization).toBe('Bearer t')
    expect(seen[0].init.headers['content-type']).toBe('application/json')
    expect(seen[0].init.signal).toBeInstanceOf(AbortSignal)
    expect(seen[0].init.keepalive).toBe(false)
  })

  it(`sends at most ${DELETE_BATCH} ids a call, deduped, and never a malformed id`, async () => {
    const bodies = []
    vi.stubGlobal('fetch', async (_u, init) => { bodies.push(JSON.parse(init.body).file_ids); return okJson({ results: [] }) })
    const ids = [...Array.from({ length: 60 }, (_, i) => fid(i)), fid(3), 'file_../x', '', null]
    await deleteAIFiles(ids)
    expect(bodies.map(b => b.length)).toEqual([25, 25, 10])
    expect(bodies.flat()).not.toContain('file_../x')
  })

  it('nothing to delete: no call at all', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await deleteAIFiles([])).toEqual([])
    expect(await deleteAIFiles(['nope'])).toEqual([])
    expect(f).not.toHaveBeenCalled()
  })

  it('keepalive: every batch is issued SYNCHRONOUSLY when the token is given (the page is going)', () => {
    const f = vi.fn(async () => okJson({ results: [] }))
    vi.stubGlobal('fetch', f)
    deleteAIFiles(Array.from({ length: 30 }, (_, i) => fid(i)), { keepalive: true, token: 'tk' })
    // No await: the fetches must already be out.
    expect(f).toHaveBeenCalledTimes(2)
    expect(f.mock.calls.every(([, init]) => init.keepalive === true && init.headers.authorization === 'Bearer tk')).toBe(true)
  })

  it('CONTROL: without keepalive, the second batch waits for the first', () => {
    const f = vi.fn(async () => okJson({ results: [] }))
    vi.stubGlobal('fetch', f)
    deleteAIFiles(Array.from({ length: 30 }, (_, i) => fid(i)), { token: 'tk' })
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('a refusal with a body that is not JSON keeps its status (read defensively)', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 546, json: async () => { throw new SyntaxError('Unexpected token <') } }))
    const err = await deleteAIFiles([fid(1)]).catch(e => e)
    expect(err).toBeInstanceOf(AIFileError)
    expect(err.status).toBe(546)
    expect(err.code).toBe('http_546')
  })

  it('a refusal names its code', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 429, json: async () => ({ error: 'rate_limited' }) }))
    const err = await deleteAIFiles([fid(1)]).catch(e => e)
    expect(err.code).toBe('rate_limited')
    // Round 2, note 9: the store's own words, not the upload's ("uploads").
    expect(err.message).toBe('Too many requests to the AI’s file store — try again in a minute.')
  })

  it('an ai-files from before FX12 (405 to these routes) is said in words, not a bare status', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 405, json: async () => ({ error: 'method_not_allowed' }) }))
    const err = await listAIFiles().catch(e => e)
    expect(err.code).toBe('method_not_allowed')
    expect(err.message).toBe('This environment’s server has not been updated to manage the AI’s file store yet.')
  })

  it('CONTROL: a 200 that is not JSON is a failure, never an empty success', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x') } }))
    const err = await deleteAIFiles([fid(1)]).catch(e => e)
    expect(err.code).toBe('bad_answer')
  })

  it('a store that never answers is aborted by the call’s own timer (not withTimeout alone)', async () => {
    vi.useFakeTimers()
    let aborted = false
    vi.stubGlobal('fetch', (_u, init) => new Promise((_res, rej) => {
      init.signal.addEventListener('abort', () => { aborted = true; rej(new DOMException('aborted', 'AbortError')) })
    }))
    const p = deleteAIFiles([fid(1)], { token: 'tk' }).catch(e => e)
    await vi.advanceTimersByTimeAsync(15001)
    const err = await p
    expect(aborted).toBe(true)
    expect(err).toBeInstanceOf(AIFileError)
    expect(err.code).toBe('timeout')
  })

  it('the caller’s own abort is the caller’s AbortError, not a network error', async () => {
    vi.stubGlobal('fetch', (_u, init) => new Promise((_res, rej) => {
      init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
    }))
    const c = new AbortController()
    const p = deleteAIFiles([fid(1)], { token: 'tk', signal: c.signal }).catch(e => e)
    c.abort()
    const err = await p
    expect(err.name).toBe('AbortError')
    expect(err).not.toBeInstanceOf(AIFileError)
  })
})

describe('listAIFiles and sweepAIFiles', () => {
  beforeEach(() => { vi.unstubAllGlobals() })
  it('the list is a GET with no body', async () => {
    let seen = null
    vi.stubGlobal('fetch', async (_url, init) => { seen = init; return okJson({ scope: 'workspace', count: 0, files: [] }) })
    expect((await listAIFiles()).scope).toBe('workspace')
    expect(seen.method).toBe('GET')
    expect(seen.body).toBeUndefined()
    expect(seen.signal).toBeInstanceOf(AbortSignal)
  })
  it('the sweep is a DELETE of { sweep: true } and nothing else', async () => {
    let seen = null
    vi.stubGlobal('fetch', async (_url, init) => { seen = init; return okJson({ ok: true, counts: { deleted: 2 } }) })
    expect((await sweepAIFiles()).counts.deleted).toBe(2)
    expect(seen.method).toBe('DELETE')
    expect(JSON.parse(seen.body)).toEqual({ sweep: true })
  })
})

describe('holdAIFiles / releaseAllAIFiles: the close and the sign-out let go of everything', () => {
  beforeEach(() => { vi.unstubAllGlobals() })
  it('takes every holder’s ids, deletes them, and never throws', async () => {
    const bodies = []
    vi.stubGlobal('fetch', async (_u, init) => { bodies.push(JSON.parse(init.body).file_ids); return okJson({ results: [] }) })
    let held = [fid(1), fid(2)]
    const off1 = holdAIFiles(() => { const out = held; held = []; return out })
    const off2 = holdAIFiles(() => { throw new Error('a broken holder') })
    const off3 = holdAIFiles(() => [fid(3)])
    await releaseAllAIFiles()
    expect(bodies.flat().sort()).toEqual([fid(1), fid(2), fid(3)])
    expect(held).toEqual([])
    off1(); off2(); off3()
    vi.stubGlobal('fetch', async () => { throw new TypeError('offline') })
    const off4 = holdAIFiles(() => [fid(4)])
    await expect(releaseAllAIFiles()).resolves.toEqual([])
    off4()
  })
  it('CONTROL: an unregistered holder is not asked', async () => {
    const take = vi.fn(() => [fid(9)])
    const off = holdAIFiles(take)
    off()
    vi.stubGlobal('fetch', vi.fn())
    await releaseAllAIFiles()
    expect(take).not.toHaveBeenCalled()
  })
  it('keepalive uses the signed-in token at hand, so the deletes leave synchronously', () => {
    __setCurrentTokenForTests('live-token')
    const f = vi.fn(async () => okJson({ results: [] }))
    vi.stubGlobal('fetch', f)
    const off = holdAIFiles(() => [fid(5)])
    releaseAllAIFiles({ keepalive: true })
    expect(f).toHaveBeenCalledTimes(1)
    expect(f.mock.calls[0][1].headers.authorization).toBe('Bearer live-token')
    expect(f.mock.calls[0][1].keepalive).toBe(true)
    off()
    __setCurrentTokenForTests(null)
  })
  it('the first holder hooks pagehide once, and pagehide lets go with keepalive', async () => {
    vi.resetModules()
    const listeners = []
    vi.stubGlobal('window', { addEventListener: (type, fn) => listeners.push([type, fn]) })
    const fresh = await import('./aiFiles.js')
    fresh.__setCurrentTokenForTests('tk')
    const f = vi.fn(async () => okJson({ results: [] }))
    vi.stubGlobal('fetch', f)
    const off1 = fresh.holdAIFiles(() => [fid(6)])
    const off2 = fresh.holdAIFiles(() => [])
    expect(listeners.filter(([t]) => t === 'pagehide')).toHaveLength(1)
    listeners.find(([t]) => t === 'pagehide')[1]()
    expect(f).toHaveBeenCalledTimes(1)
    expect(f.mock.calls[0][1].keepalive).toBe(true)
    off1(); off2()
  })
})
