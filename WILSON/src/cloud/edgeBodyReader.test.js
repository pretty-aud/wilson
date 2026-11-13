// =============================================================================
// edgeBodyReader.test.js — F8 (wave 2, 2026-11-13), step (e).
//
// gatewayWire.readJsonLimited now decodes AS IT READS (one streaming
// TextDecoder, each chunk let go) instead of keeping every chunk and joining
// them: the old way held the body twice over for a moment, one copy more than
// the runtime's own req.json(). That must not move one return value. So the
// OLD reader is copied below, verbatim, as the oracle, and both are fed the
// SAME bytes in many chunkings: a multi-byte character split across two
// chunks, a byte-order mark split and alone, bytes that are not UTF-8 in the
// middle and at the very end, empty chunks, one byte at a time; under caps
// below, at and above the body's length. Each answer is also held to what
// `JSON.parse(new TextDecoder().decode(allBytes))` means.
//
// Then readBodyJson's three answers, and aiFileStore.readSmallJson (now
// readJsonLimited plus the object check) against a copy of ITS old self on
// DESIGN.md §7.1's cases.
//
// F8, the drain (2026-11-13): past its cap a body is now READ THROUGH and
// dropped (up to DRAIN_MAX_BYTES, then cancelled) before the answer, because
// the hosted relay delivers no answer before it has the request body. Every
// return value is still the old reader's; only how much of an over-cap body
// is pulled, and whether it is cancelled, moved, on purpose, and is held in
// the drain block at the end.
// =============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest'
import { readJsonLimited, readBodyJson, DRAIN_MAX_BYTES } from '../../supabase/functions/_shared/gatewayWire.ts'
import { readSmallJson, SMALL_BODY_MAX } from '../../supabase/functions/_shared/aiFileStore.ts'

// ── The oracles: the two readers exactly as they were at 9b0255c3 ────────────
async function oldReadJsonLimited(req, maxBytes) {
  const declared = Number(req.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) return { value: undefined, length: declared }
  if (!req.body) return { value: undefined, length: 0 }
  const reader = req.body.getReader()
  const parts = []
  let total = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.length
    if (total > maxBytes) {
      try { await reader.cancel() } catch { /* already done */ }
      return { value: undefined, length: total }
    }
    parts.push(value)
  }
  const bytes = new Uint8Array(total)
  let off = 0
  for (const p of parts) { bytes.set(p, off); off += p.length }
  const text = new TextDecoder().decode(bytes)
  if (!text) return { value: undefined, length: 0 }
  try {
    return { value: JSON.parse(text), length: total }
  } catch {
    return null
  }
}

async function oldReadSmallJson(req, max = 2048) {
  const declared = Number(req.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > max) return null
  if (!req.body) return null
  const reader = req.body.getReader()
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const c of chunks) { bytes.set(c, at); at += c.byteLength }
  try {
    const v = JSON.parse(new TextDecoder().decode(bytes))
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null
  } catch {
    return null
  }
}

// ── Bytes and chunkings ──────────────────────────────────────────────────────
const enc = (s) => new TextEncoder().encode(s)
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length } return out }
const BOM = new Uint8Array([0xef, 0xbb, 0xbf])

/**
 * A request-shaped object whose body delivers EXACTLY these chunks (a real
 * Request may re-chunk), one a read, closed with the last, counting the bytes
 * pulled. Cancelling it after its last chunk is no cancel (it has closed),
 * as when the chunks were all queued at the start.
 */
function reqOf(chunks, headers = {}) {
  let cancelled = false
  let pulled = 0
  let i = 0
  const body = chunks === null ? null : new ReadableStream({
    pull(c) {
      if (i < chunks.length) { pulled += chunks[i].length; c.enqueue(chunks[i++]) }
      if (i >= chunks.length) c.close()
    },
    cancel() { cancelled = true },
  }, { highWaterMark: 0 })
  return { headers: new Headers(headers), body, wasCancelled: () => cancelled, pulled: () => pulled }
}

function chunkings(bytes) {
  const out = [['whole', [bytes]], ['one byte at a time', Array.from(bytes, (b) => new Uint8Array([b]))]]
  for (let i = 1; i < bytes.length; i++) out.push([`split at ${i}`, [bytes.slice(0, i), bytes.slice(i)]])
  out.push(['empty chunks around and between', [new Uint8Array(0), bytes.slice(0, 1), new Uint8Array(0), bytes.slice(1), new Uint8Array(0)]])
  if (bytes.length >= 3) out.push(['three pieces', [bytes.slice(0, 1), bytes.slice(1, bytes.length - 1), bytes.slice(bytes.length - 1)]])
  return out
}

/** What the bytes MEAN, whole: req.json()'s reading, in readJsonLimited's vocabulary. */
function meaning(bytes, cap) {
  if (bytes.length > cap) return 'over'
  const text = new TextDecoder().decode(bytes)
  if (!text) return { value: undefined, length: 0 }
  try { return { value: JSON.parse(text), length: bytes.length } } catch { return null }
}

const INPUTS = [
  ['an object', enc('{"a":1,"b":[true,null]}')],
  ['an object with a three-byte character', enc('{"name":"Ré€sumé"}')],
  ['an object with a four-byte character', enc('{"e":"😀x"}')],
  ['a byte-order mark then an object', cat(BOM, enc('{"a":1}'))],
  ['a lone byte-order mark', BOM],
  ['two byte-order marks then an object (the second is text, not JSON)', cat(BOM, BOM, enc('{"a":1}'))],
  ['a byte that is not UTF-8 inside a string', cat(enc('{"a":"'), new Uint8Array([0xff]), enc('"}'))],
  ['a cut-off character inside a string', cat(enc('{"a":"'), new Uint8Array([0xe2, 0x82]), enc('"}'))],
  ['a cut-off character at the very end', cat(enc('{"a":1}'), new Uint8Array([0xe2, 0x82]))],
  ['bytes that are not UTF-8 and not JSON', new Uint8Array([0xff, 0xfe])],
  ['JSON null', enc('null')],
  ['a number', enc('5')],
  ['a string', enc('"x"')],
  ['an array', enc('[1,2]')],
  ['white space only', enc('  \n ')],
  ['not JSON', enc('{nope')],
  ['nothing (no chunks)', new Uint8Array(0)],
]

describe('readJsonLimited decodes as it reads: the same answer as the old reader, chunking by chunking (F8 e)', () => {
  for (const [label, bytes] of INPUTS) {
    it(`${label}`, async () => {
      for (const cap of [bytes.length - 1, bytes.length, bytes.length + 1, 4096]) {
        if (cap < 0) continue
        for (const [how, chunks] of chunkings(bytes)) {
          const a = reqOf(chunks)
          const b = reqOf(chunks)
          const got = await readJsonLimited(a, cap)
          const want = await oldReadJsonLimited(b, cap)
          expect(got, `${how}, cap ${cap}`).toEqual(want)
          const m = meaning(bytes, cap)
          if (m === 'over') {
            expect(got.value, `${how}, cap ${cap}`).toBeUndefined()
            expect(got.length).toBeGreaterThan(cap)
            // F8, the drain (on purpose): the old reader stopped at the cap and
            // cancelled the rest; the rest is now read through and dropped, to
            // its end (these end long before DRAIN_MAX_BYTES), not cancelled.
            expect(a.pulled(), `${how}, cap ${cap}: read through`).toBe(bytes.length)
            expect(a.wasCancelled(), `${how}, cap ${cap}: not cancelled`).toBe(false)
          } else {
            expect(a.wasCancelled(), `${how}, cap ${cap}: cancelled`).toBe(b.wasCancelled())
            expect(got, `${how}, cap ${cap}: what the bytes mean`).toEqual(m)
          }
        }
      }
    })
  }

  it('a lone byte-order mark is "nothing sent", split or not ({ value: undefined, length: 0 })', async () => {
    for (const chunks of [[BOM], [BOM.slice(0, 1), BOM.slice(1)], [BOM.slice(0, 2), BOM.slice(2)], Array.from(BOM, (x) => new Uint8Array([x]))]) {
      expect(await readJsonLimited(reqOf(chunks), 64)).toEqual({ value: undefined, length: 0 })
    }
  })
  it('the declared length: over the cap, the same answer, the body read through to its end and dropped (F8, the drain); not a number, or negative, goes on', async () => {
    const chunks = [enc('{"p":"'), enc('x'.repeat(40)), enc('y'.repeat(22)), enc('"}')]
    for (const declared of ['70', '100000']) {
      const a = reqOf(chunks, { 'content-length': declared })
      const b = reqOf(chunks, { 'content-length': declared })
      const got = await readJsonLimited(a, 64)
      expect(got, declared).toEqual({ value: undefined, length: Number(declared) })
      expect(got, declared).toEqual(await oldReadJsonLimited(b, 64))
      expect(a.pulled(), `${declared}: read through`).toBe(70)
      expect(a.wasCancelled(), `${declared}: not cancelled`).toBe(false)
    }
    for (const declared of ['abc', '-1', '']) {
      const a = reqOf([enc('{"a":1}')], { 'content-length': declared })
      const b = reqOf([enc('{"a":1}')], { 'content-length': declared })
      expect(await readJsonLimited(a, 64), declared).toEqual(await oldReadJsonLimited(b, 64))
    }
  })
  it('no body at all is { value: undefined, length: 0 }', async () => {
    expect(await readJsonLimited(reqOf(null), 64)).toEqual({ value: undefined, length: 0 })
  })
  it('past the cap: the length is where it first went over (the same as the old reader), the rest read through and dropped, not cancelled (F8, the drain)', async () => {
    const chunks = [enc('{"a":"'), enc('x'.repeat(40)), enc('y'.repeat(40)), enc('"}')]
    const a = reqOf(chunks)
    const b = reqOf(chunks)
    const got = await readJsonLimited(a, 64)
    expect(got).toEqual({ value: undefined, length: 86 })
    expect(got).toEqual(await oldReadJsonLimited(b, 64))
    expect(a.pulled()).toBe(88)
    expect(a.wasCancelled()).toBe(false)
  })
  it('a stream that fails while read throws, as it did (readBodyJson reads that as not_json, as req.json() threw)', async () => {
    const failing = () => ({ headers: new Headers(), body: new ReadableStream({ pull(c) { c.error(new TypeError('the connection dropped')) } }) })
    await expect(readJsonLimited(failing(), 64)).rejects.toThrow('the connection dropped')
    await expect(oldReadJsonLimited(failing(), 64)).rejects.toThrow('the connection dropped')
    expect(await readBodyJson(failing(), 64)).toEqual({ kind: 'not_json' })
  })
  it('through a real Request too, for the bodies the functions are sent', async () => {
    for (const raw of ['{"a":1}', '', 'null', '{nope', cat(BOM, enc('{"a":"é"}'))]) {
      const mk = () => new Request('https://x.test/f', { method: 'POST', body: raw })
      expect(await readJsonLimited(mk(), 64)).toEqual(await oldReadJsonLimited(mk(), 64))
    }
  })
})

describe('readBodyJson: req.json()\'s reading, plus too_large (F8 e)', () => {
  const rb = (raw, cap = 64, headers = {}) => readBodyJson(reqOf(raw === null ? null : [typeof raw === 'string' ? enc(raw) : raw], headers), cap)
  it.each([
    ['an object', '{"a":1}', { kind: 'json', value: { a: 1 } }],
    ['JSON null is handed on as null, not refused', 'null', { kind: 'json', value: null }],
    ['a number', '5', { kind: 'json', value: 5 }],
    ['false', 'false', { kind: 'json', value: false }],
    ['an array', '[]', { kind: 'json', value: [] }],
    ['an empty string value', '""', { kind: 'json', value: '' }],
    ['nothing sent', '', { kind: 'not_json' }],
    ['a lone byte-order mark', BOM, { kind: 'not_json' }],
    ['white space', '   ', { kind: 'not_json' }],
    ['not JSON', '{nope', { kind: 'not_json' }],
    ['exactly at the cap', `{"p":"${'x'.repeat(56)}"}`, { kind: 'json', value: { p: 'x'.repeat(56) } }],
    ['one byte past the cap', `{"p":"${'x'.repeat(57)}"}`, { kind: 'too_large', length: 65 }],
  ])('%s', async (_, raw, want) => {
    expect(await rb(raw)).toEqual(want)
  })
  it('no body at all is not_json; a declared length past the cap is too_large with that length', async () => {
    expect(await rb(null)).toEqual({ kind: 'not_json' })
    expect(await rb('{}', 64, { 'content-length': '100' })).toEqual({ kind: 'too_large', length: 100 })
  })
})

describe('readSmallJson is readJsonLimited plus the object check: DESIGN.md §7.1\'s 28 cases against its old self (F8 e)', () => {
  const big = (n) => enc(`{"p":"${'x'.repeat(n - 8)}"}`)
  const CASES = [
    ['1 a declared length over the cap', [enc('{"a":1}')], { 'content-length': '2049' }],
    ['2 a declared length that is not a number', [enc('{"a":1}')], { 'content-length': 'abc' }],
    ['3 a negative declared length', [enc('{"a":1}')], { 'content-length': '-5' }],
    ['4 a declared length under the cap, the stream past it', [big(3000)], { 'content-length': '10' }],
    ['5 no body', null, {}],
    ['6 the stream passes the cap', [big(1500), big(1500)], {}],
    ['7 an object exactly at the cap', [big(2048)], {}],
    ['8 an object one byte past the cap', [big(2049)], {}],
    ['9 an empty body', [new Uint8Array(0)], {}],
    ['10 white space', [enc(' \n ')], {}],
    ['11 a lone byte-order mark', [BOM], {}],
    ['12 not JSON', [enc('{nope')], {}],
    ['13 null', [enc('null')], {}],
    ['14 a number', [enc('5')], {}],
    ['15 zero', [enc('0')], {}],
    ['16 false', [enc('false')], {}],
    ['17 true', [enc('true')], {}],
    ['18 a string', [enc('"s"')], {}],
    ['19 an empty string', [enc('""')], {}],
    ['20 an empty array', [enc('[]')], {}],
    ['21 an array', [enc('[{"a":1}]')], {}],
    ['22 an empty object', [enc('{}')], {}],
    ['23 an object', [enc('{"file_id":"file_011CNha8iCJcU1wXNR6q4V8w"}')], {}],
    ['24 an object after a byte-order mark', [cat(BOM, enc('{"a":1}'))], {}],
    ['25 an object split across chunks', [enc('{"a":'), enc('1}')], {}],
    ['26 an object split inside a character', [enc('{"a":"'), new Uint8Array([0xc3]), cat(new Uint8Array([0xa9]), enc('"}'))], {}],
    ['27 an object with a byte that is not UTF-8', [cat(enc('{"a":"'), new Uint8Array([0xff]), enc('"}'))], {}],
    ['28 a nested object, one byte at a time', Array.from(enc('{"a":{"b":[1]}}'), (b) => new Uint8Array([b])), {}],
  ]
  it('there are 28', () => { expect(CASES).toHaveLength(28); expect(SMALL_BODY_MAX).toBe(2048) })
  it.each(CASES)('%s', async (_, chunks, headers) => {
    const got = await readSmallJson(reqOf(chunks, headers))
    expect(got).toEqual(await oldReadSmallJson(reqOf(chunks, headers)))
  })
  it('the objects come through; everything else is null', async () => {
    expect(await readSmallJson(reqOf([enc('{"a":1}')]))).toEqual({ a: 1 })
    expect(await readSmallJson(reqOf([cat(enc('{"a":"'), new Uint8Array([0xc3]), new Uint8Array([0xa9]), enc('"}'))]))).toEqual({ a: 'é' })
    for (const raw of ['null', '[]', '5', '""', '', '{nope']) expect(await readSmallJson(reqOf([enc(raw)])), raw).toBeNull()
    expect(await readSmallJson(reqOf([big(2049)]))).toBeNull()
  })
})

// ── F8, the drain: past the cap, the rest is read through and dropped ────────
//
// Measured on the hosted platform (wilson-dev, 2026-11-13): a function that
// answers before it has read the request body is often never heard (no answer
// in 90 s for 1 and 8 MiB bodies to storage-presign; a 502 for 34 and 40 MiB
// to ai-proxy). So past the cap readJsonLimited reads the rest and drops it,
// up to DRAIN_MAX_BYTES in all, then cancels; its answer is the old one.
describe('readJsonLimited past the cap reads the rest through, up to DRAIN_MAX_BYTES, then cancels (F8, the drain)', () => {
  const MiB = 1024 * 1024
  const DRAIN = 64 * MiB
  afterEach(() => { vi.unstubAllGlobals() })

  /** A body that never ends, `chunkBytes` a read; read number `failAt` (1-based) fails instead. */
  function endless(chunkBytes, { failAt = 0, headers = {} } = {}) {
    const state = { pulled: 0, reads: 0, cancelled: false }
    const chunk = new Uint8Array(chunkBytes).fill(0x20)
    const body = new ReadableStream({
      pull(c) {
        state.reads += 1
        if (state.reads === failAt) { c.error(new TypeError('the connection dropped')); return }
        state.pulled += chunkBytes
        c.enqueue(chunk)
      },
      cancel() { state.cancelled = true },
    }, { highWaterMark: 0 })
    return { req: { headers: new Headers(headers), body }, state }
  }

  it('DRAIN_MAX_BYTES is 64 MiB', () => {
    expect(DRAIN_MAX_BYTES).toBe(DRAIN)
  })

  it.each([
    ['1 MiB chunks, a cap of 3.5 MiB (first over at 4 MiB)', MiB, 3.5 * MiB, 4 * MiB],
    ['256 KiB chunks, a cap of 64 bytes (first over at 256 KiB)', 256 * 1024, 64, 256 * 1024],
  ])('an endless stream past the cap, %s: the old answer (the total where it first went over, not the drained total), read on to DRAIN_MAX_BYTES within one chunk, then cancelled', async (_, chunk, cap, firstOver) => {
    const a = endless(chunk)
    const b = endless(chunk)
    const got = await readJsonLimited(a.req, cap)
    expect(got).toEqual({ value: undefined, length: firstOver })
    expect(got).toEqual(await oldReadJsonLimited(b.req, cap))
    expect(a.state.pulled).toBeGreaterThanOrEqual(DRAIN)
    expect(a.state.pulled).toBeLessThan(DRAIN + chunk)
    expect(a.state.cancelled).toBe(true)
  })

  it('a declared length over the cap on an endless stream: { length: declared } as before, read on to DRAIN_MAX_BYTES within one chunk, then cancelled', async () => {
    const chunk = MiB
    const a = endless(chunk, { headers: { 'content-length': '65' } })
    const b = endless(chunk, { headers: { 'content-length': '65' } })
    const got = await readJsonLimited(a.req, 64)
    expect(got).toEqual({ value: undefined, length: 65 })
    expect(got).toEqual(await oldReadJsonLimited(b.req, 64))
    expect(a.state.pulled).toBeGreaterThanOrEqual(DRAIN)
    expect(a.state.pulled).toBeLessThan(DRAIN + chunk)
    expect(a.state.cancelled).toBe(true)
  })

  it('a body that ends before DRAIN_MAX_BYTES is read to its end and not cancelled, declared or counted', async () => {
    const chunks = Array.from({ length: 10 }, () => new Uint8Array(MiB).fill(0x20))
    for (const headers of [{}, { 'content-length': String(10 * MiB) }]) {
      const a = reqOf(chunks, headers)
      const b = reqOf(chunks, headers)
      const got = await readJsonLimited(a, 64)
      expect(got).toEqual(await oldReadJsonLimited(b, 64))
      expect(got).toEqual({ value: undefined, length: headers['content-length'] ? 10 * MiB : MiB })
      expect(a.pulled()).toBe(10 * MiB)
      expect(a.wasCancelled()).toBe(false)
    }
  })

  it('a read that fails while the rest is drained: the same too-large answer, no throw; readBodyJson says too_large', async () => {
    const counted = endless(MiB, { failAt: 5 })
    expect(await readJsonLimited(counted.req, 64)).toEqual({ value: undefined, length: MiB })
    expect(counted.state.reads).toBe(5) // drained on to the read that failed
    const declared = endless(MiB, { failAt: 3, headers: { 'content-length': '65' } })
    expect(await readJsonLimited(declared.req, 64)).toEqual({ value: undefined, length: 65 })
    expect(declared.state.reads).toBe(3)
    const viaBody = endless(MiB, { failAt: 2 })
    expect(await readBodyJson(viaBody.req, 64)).toEqual({ kind: 'too_large', length: MiB })
    expect(viaBody.state.reads).toBe(2)
  })

  it('the drained bytes are never decoded: the decoder sees only what came before the cap, then its one flush', async () => {
    const asked = []
    const Real = globalThis.TextDecoder
    vi.stubGlobal('TextDecoder', class extends Real {
      decode(input, options) {
        asked.push(input === undefined ? 'flush' : `${options?.stream ? 'chunk' : 'whole'} ${input.length}`)
        return super.decode(input, options)
      }
    })
    const chunks = [enc('{"a":"'), new Uint8Array([0xe2, 0x82]), enc('x'.repeat(100)), enc('y'.repeat(100)), enc('"}')]
    const a = reqOf(chunks)
    expect(await readJsonLimited(a, 64)).toEqual({ value: undefined, length: 108 })
    expect(a.pulled()).toBe(210)
    expect(asked).toEqual(['chunk 6', 'chunk 2', 'flush'])
  })
})
