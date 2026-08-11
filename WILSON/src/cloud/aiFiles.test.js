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
