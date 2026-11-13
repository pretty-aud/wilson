// =============================================================================
// edgeAiProxy.test.js — F8 (wave 2, 2026-11-13), step (f), the review's C5.
//
// ai-proxy now STARTS reading the company's key row before it awaits the rate
// limiter, and awaits that read where it always did (after validation). Not
// Promise.all: a limited call is still answered at once, without reading the
// body. This runs the real supabase/functions/ai-proxy/index.ts through
// edgeHarness.js and holds every answer around the key: limited, invalid, the
// platform key, a company key, a row that will not open, a failed read, no
// key at all (501), the provider unreachable (502); and the order of the
// statements. Every key here is made up in this file; fetch is a fake.
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { randomBytes, createCipheriv } from 'node:crypto'
import { newWorld, loadFunction, seatCaller, post, answerOf, trips, endlessBody } from './edgeHarness.js'

vi.mock('https://esm.sh/@supabase/supabase-js@2.45.4', async () => ({
  createClient: (await import('./edgeHarness.js')).createClient,
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const AI_MASTER = randomBytes(32)
const PLATFORM = 'harness-platform-key'
const COMPANY = 'harness-company-key-0123'
const SSE = 'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":3}}}\n\n'
const VALID = { model: 'harness-model', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }

/** An AI key sealed as operator-ai-keys seals it (version 1: base64(iv ‖ ciphertext ‖ tag), no AAD). */
function seal(plain, key = AI_MASTER) {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64')
}

let fetchCalls = []
function stubFetch(kind = 'sse') {
  fetchCalls = []
  vi.stubGlobal('fetch', async (url, init) => {
    fetchCalls.push({ url, init })
    if (kind === 'down') throw new TypeError('fetch failed')
    return new Response(SSE, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  })
}

/**
 * The function loaded with `env`, a member seated, and the key table answering `keyRow`:
 * a row, null, or { error }. `limited` makes the limiter refuse.
 */
async function setUp({ env = { ANTHROPIC_API_KEY: PLATFORM, WILSON_AI_KEY_SECRET: AI_MASTER.toString('base64') }, keyRow = null, limited = false, fetch = 'sse' } = {}) {
  stubFetch(fetch)
  const { handler } = await loadFunction(vi, 'ai-proxy', env)
  const w = newWorld()
  const { token } = seatCaller(w, { role: 'user' })
  w.table('workspace_ai_keys', () => (keyRow && keyRow.error
    ? { data: null, error: keyRow.error }
    : { data: keyRow, error: null }))
  if (limited) w.rpc('fn_rate_limit_hit', () => ({ data: true, error: null }))
  const call = async (body = VALID, opts = {}) => {
    const res = await handler(post(body, { token, ...opts }))
    const a = await answerOf(res)
    return a.json === undefined ? { status: a.status, text: a.text } : { status: a.status, json: a.json }
  }
  return { w, call, handler, token }
}
const keyUsed = () => fetchCalls[0]?.init?.headers?.['x-api-key'] ?? null

describe('ai-proxy: the answers around the key, the key read started beside the limiter (F8 f)', () => {
  it('limited: 429, the body never read, no upstream fetch', async () => {
    const { w, handler, token } = await setUp({ limited: true })
    const { stream, state } = endlessBody(1024)
    const a = await answerOf(await handler(post(undefined, { token, raw: stream })))
    expect({ status: a.status, json: a.json }).toEqual({ status: 429, json: { error: 'rate_limited' } })
    expect(state.pulled).toBe(0)
    expect(fetchCalls).toEqual([])
    expect(trips(w)).toContain('rpc:fn_rate_limit_hit')
  })

  it('limited, with a company key that takes a while to read: answered without waiting for it', async () => {
    const { w, call } = await setUp({ limited: true })
    let release
    w.table('workspace_ai_keys', () => new Promise((r) => { release = () => r({ data: null, error: null }) }))
    const out = await call()
    expect(out).toEqual({ status: 429, json: { error: 'rate_limited' } })
    expect(typeof release).toBe('function') // the read had started, and was still pending
    release()
  })

  it('invalid: 400 validation_failed, nothing sent upstream', async () => {
    const { call } = await setUp()
    expect(await call({ model: 'm' })).toEqual({ status: 400, json: { error: 'validation_failed', errors: [{ field: 'max_tokens', error: 'required' }] } })
    expect(fetchCalls).toEqual([])
  })

  it('no company row: the platform key', async () => {
    const { call } = await setUp()
    expect(await call()).toEqual({ status: 200, text: SSE })
    expect(keyUsed()).toBe(PLATFORM)
  })

  it('a company row that opens: the company key', async () => {
    const { call, w } = await setUp({ keyRow: { key_ciphertext: seal(COMPANY), key_version: 1 } })
    expect(await call()).toEqual({ status: 200, text: SSE })
    expect(keyUsed()).toBe(COMPANY)
    const read = w.calls.find((c) => c.name === 'workspace_ai_keys')
    expect(read).toMatchObject({ by: 'service', columns: 'key_ciphertext, key_version', terminal: 'maybeSingle', filters: [{ f: 'eq', column: 'workspace_id', value: 'ws-1' }] })
  })

  it('a row that will not open (sealed under another master): the platform key, as before', async () => {
    const { call } = await setUp({ keyRow: { key_ciphertext: seal(COMPANY, randomBytes(32)), key_version: 1 } })
    expect(await call()).toEqual({ status: 200, text: SSE })
    expect(keyUsed()).toBe(PLATFORM)
  })

  it('a row and no AI master on this environment: the platform key', async () => {
    const { call } = await setUp({ env: { ANTHROPIC_API_KEY: PLATFORM }, keyRow: { key_ciphertext: seal(COMPANY), key_version: 1 } })
    expect(await call()).toEqual({ status: 200, text: SSE })
    expect(keyUsed()).toBe(PLATFORM)
  })

  it('a failed read: the platform key', async () => {
    const { call } = await setUp({ keyRow: { error: { message: 'relation does not exist' } } })
    expect(await call()).toEqual({ status: 200, text: SSE })
    expect(keyUsed()).toBe(PLATFORM)
  })

  it('no key at all: 501 ai_not_configured, nothing sent upstream', async () => {
    const { call } = await setUp({ env: {} })
    expect(await call()).toEqual({ status: 501, json: { error: 'ai_not_configured' } })
    expect(fetchCalls).toEqual([])
  })

  it('the provider unreachable: 502 upstream_unreachable', async () => {
    const { call } = await setUp({ fetch: 'down' })
    expect(await call()).toEqual({ status: 502, json: { error: 'upstream_unreachable' } })
    expect(fetchCalls).toHaveLength(1)
  })

  it('the order: the guard, then the key row read STARTED no later than the limiter, then the limiter; one read a call', async () => {
    const { call, w } = await setUp({ keyRow: { key_ciphertext: seal(COMPANY), key_version: 1 } })
    await call()
    const names = trips(w)
    expect(names.slice(0, 4)).toEqual(['auth:getUser', 'table:workspace_members', 'table:workspace_ai_keys', 'rpc:fn_rate_limit_hit'])
    expect(names.filter((n) => n === 'table:workspace_ai_keys')).toHaveLength(1)
  })

  it('the one named difference (DESIGN.md §8.3): a call then refused has also read the key row, and written nothing', async () => {
    const limited = await setUp({ limited: true })
    await limited.call()
    expect(trips(limited.w)).toEqual(['auth:getUser', 'table:workspace_members', 'table:workspace_ai_keys', 'rpc:fn_rate_limit_hit'])
    const bad = await setUp()
    await bad.call(undefined, { raw: '{nope' })
    expect(bad.w.calls.filter((c) => c.op !== 'select' && c.kind === 'table')).toEqual([])
  })
})
