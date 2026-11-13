// =============================================================================
// edgeTicketKey.test.js — F8 (wave 2, 2026-11-13): gateway-ticket, run whole,
// pinned as it stood at a71cd144, before F8 keeps the opened signing key for
// the life of an isolate.
//
// What this file holds, and why. F8 will cache the company's opened
// ticket-signing key inside the Edge isolate, so a warm call stops importing
// the master key, decrypting the sealed key and importing it again. Nothing a
// caller or a gateway can see may move, so this file runs the real
// supabase/functions/gateway-ticket/index.ts through edgeHarness.js and pins:
//
//   A. every answer the function gives, in its own order: status, the exact
//      JSON (every sentence character for character) and the headers; the
//      tickets themselves, checked with the cloud's reference verifier; the
//      mint rows written before the answer; and which client asked what (the
//      caller's own token for the Bins predicates, the service role for the
//      limiter, the key and the mint log);
//   B. the signing-key helper (gatewaySigning.ts): a key made when there is
//      none, a key that will not open replaced once, and a missing master
//      secret that replaces nothing;
//   C. the work of one call (C5): the database round trips (which must NOT
//      change: the current key is still read on every call) and the WebCrypto
//      work (which must fall on a warm isolate), plus the cache's safety.
//
// The code as it stood at a71cd144 is the oracle: every test here passed
// against it. One number is the measurement of the review's C5 and is edited
// by the commit that lowers it: WARM_CALL, the key work of a call after the
// first (at a71cd144 every call imported the AES master, decrypted the sealed
// key and imported the Ed25519 private key again: TODAY below).
//
// Every key here is made in this file (random bytes, or a fresh Ed25519 pair)
// for one test, and is nobody's secret. No network: the world is a fake.
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  newWorld, seatCaller, loadFunction, post, answerOf, tokenFor, endlessBody, createClient,
  SUPABASE_URL, SERVICE_KEY, ANON_KEY,
} from './edgeHarness.js'
import {
  generateSigningKey, importSigningPublicKey, verifyTicket, KEY_ROTATE_AFTER_SECONDS,
} from '../../supabase/functions/_shared/gatewayTicket.ts'
import { sealSigningKey, openSigningKey, GatewayKeyCryptoUnavailable } from '../../supabase/functions/_shared/gatewayKeyCrypto.ts'

vi.mock('https://esm.sh/@supabase/supabase-js@2.45.4', async () => ({
  createClient: (await import('./edgeHarness.js')).createClient,
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// What one call costs today, measured at a71cd144 (the first call of a fresh
// load and each of five warm calls alike). A record, not an assertion.
const TODAY = { importsPerCall: 2, decryptsPerCall: 1 }
// What a WARM call costs (a call after the first, on the same loaded
// function). At a71cd144 it is a first call's cost again: nothing was kept.
// The commit that keeps the opened key per isolate (C5) edits this line.
// F8 (a) lowered imports 2 → 1: the AES master is now imported once per
// value per isolate (_shared/envelopeCrypto.ts); the sealed key is still
// opened and the Ed25519 key still imported on every call.
// F8 (f) lowered it to nothing: the opened key is kept per isolate, per
// workspace, for the same kid, ciphertext and master key (gatewaySigning.ts);
// the signing-key read is still made on every call.
const WARM_CALL = { imports: 0, decrypts: 0 }

// ── The cast ─────────────────────────────────────────────────────────────────

const MASTER = randomBytes(32).toString('base64')
const OTHER_MASTER = randomBytes(32).toString('base64')
const WS_A = 'a0000000-0000-4000-8000-00000000000a'
const WS_B = 'b0000000-0000-4000-8000-00000000000b'
const USER_A = 'a1111111-1111-4111-8111-111111111111'
const USER_B = 'b1111111-1111-4111-8111-111111111111'
const GW_A = 'a2222222-2222-4222-8222-222222222222'
const GW_B = 'b2222222-2222-4222-8222-222222222222'
const CLIP1 = 'c1000000-0000-4000-8000-000000000001'
const CLIP2 = 'c1000000-0000-4000-8000-000000000002'
const CLIP3 = 'c1000000-0000-4000-8000-000000000003'
const CLIP4 = 'c1000000-0000-4000-8000-000000000004'
const CLIP_B = 'c2000000-0000-4000-8000-0000000000b1'
const LOC = 'd0000000-0000-4000-8000-00000000000d'
const PROJ = 'e0000000-0000-4000-8000-00000000000e'
const NOW_MS = 1_794_000_000_123
const NOW_S = Math.floor(NOW_MS / 1000)

const HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, apikey',
  'content-type': 'application/json',
  'cache-control': 'no-store',
}
const refused = (status, error, detail) => ({ status, json: { error, detail }, headers: HEADERS })
const pick = (a) => ({ status: a.status, json: a.json, headers: a.headers })
const trips = (w) => w.calls.map((c) => ({ kind: c.kind, name: c.name, by: c.by }))
const callsTo = (w, name) => w.calls.filter((c) => c.name === name)

const clip = (over = {}) => ({
  bin_file_id: CLIP1, project_id: PROJ, workspace_id: WS_A, location_id: LOC,
  relative_path: 'A001/A001_C001.mov', is_sequence: false, mime_type: 'video/quicktime',
  file_name: 'A001_C001.mov', remote_viewing: false, ...over,
})
const ask = (ids = [CLIP1], gw = GW_A) => ({ gateway_id: gw, bin_file_ids: ids })

/** A company's signing key as the database row holds it, plus its public half imported for verifying. */
async function keyRow(ws, { kid, master = MASTER, sealFor = ws } = {}) {
  const k = await generateSigningKey(kid)
  const ciphertext = await sealSigningKey(k.privatePkcs8, sealFor, k.kid, master)
  return {
    row: { kid: k.kid, public_key: k.publicKey, private_key_ciphertext: ciphertext },
    pub: await importSigningPublicKey(k.publicKey),
    pkcs8: k.privatePkcs8,
  }
}

/** Load the function (a fresh isolate) and make its world. */
async function boot(env) {
  const { handler, env: live } = await loadFunction(vi, 'gateway-ticket', env)
  // `live` is the loaded function's environment: changing it is the secret changing while warm.
  return { handler, w: newWorld(), live }
}

/**
 * One company's world: a seated member, a live gateway, the clips the caller
 * may read, the current key. `keys` is what gateway_signing_key_current
 * answers, call by call (the last one repeats); a function is called with the
 * rpc's args.
 */
async function scene({ clips = [clip()], gateway = { id: GW_A, workspace_id: WS_A, version: '1.4.0' }, keys = null, env = {}, secret = MASTER } = {}) {
  vi.spyOn(Date, 'now').mockReturnValue(NOW_MS)
  const fnEnv = { ...env }
  if (secret !== null) fnEnv.WILSON_GATEWAY_KEY_SECRET = secret
  const { handler, w, live } = await boot(fnEnv)
  const caller = seatCaller(w, { userId: USER_A, workspaceId: WS_A })
  const key = keys ? null : await keyRow(WS_A, { kid: 'kalpha' })
  const answers = keys ?? [{ data: key.row, error: null }]
  let n = 0
  w.table('gateways_visible', () => ({ data: gateway, error: null }))
  w.rpc('gateway_clips_for_tickets', () => ({ data: clips, error: null }))
  w.rpc('gateway_signing_key_current', (args) => {
    const a = answers[Math.min(n++, answers.length - 1)]
    return typeof a === 'function' ? a(args) : a
  })
  w.table('gateway_ticket_mints', () => ({ data: null, error: null }))
  const call = async (body = ask(), opts = {}) => answerOf(await handler(post(body, { token: caller.token, ...opts })))
  return { w, caller, key, handler, call, live }
}

const verifyAs = (ticket, pub, kid, { gw = GW_A, ws = WS_A } = {}) =>
  verifyTicket(ticket, { publicKeys: { [kid]: pub }, gatewayId: gw, workspaceId: ws, now: NOW_S })

/** Counts WebCrypto's importKey (by format) and decrypt across one stretch of work. */
function meter() {
  const imp = vi.spyOn(globalThis.crypto.subtle, 'importKey')
  const dec = vi.spyOn(globalThis.crypto.subtle, 'decrypt')
  return async (fn) => {
    const i0 = imp.mock.calls.length
    const d0 = dec.mock.calls.length
    const out = await fn()
    return { out, imports: imp.mock.calls.slice(i0).map((c) => c[0]), decrypts: dec.mock.calls.length - d0 }
  }
}

const silenceErrors = () => vi.spyOn(console, 'error').mockImplementation(() => {})

// ── A. The answers ───────────────────────────────────────────────────────────

describe('gateway-ticket — before the caller is known', () => {
  it('OPTIONS is the CORS preflight: 204, no body, the CORS headers only', async () => {
    const { handler, w } = await scene()
    const a = await answerOf(await handler(post(undefined, { method: 'OPTIONS' })))
    expect(a.status).toBe(204)
    expect(a.text).toBe('')
    expect(a.headers).toEqual({
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization, apikey',
    })
    expect(w.calls).toEqual([])
  })

  it.each(['GET', 'PUT', 'DELETE'])('%s is 405 method_not_allowed, before any database call', async (method) => {
    const { handler, w } = await scene()
    const a = await answerOf(await handler(post(undefined, { method })))
    expect(pick(a)).toEqual(refused(405, 'method_not_allowed', 'Use POST.'))
    expect(w.calls).toEqual([])
  })
})

describe('gateway-ticket — the caller (the guard, in this function\'s sentences)', () => {
  const UNAUTH = refused(401, 'unauthorized', 'Sign in again: WILSON could not confirm who is asking for this.')
  const FORBID = refused(403, 'forbidden', 'Your account is not an active member of this company, so WILSON will not do this for it.')

  it('no Authorization header: 401, and GoTrue is never asked', async () => {
    const { call, w } = await scene()
    expect(pick(await call(ask(), { token: null }))).toEqual(UNAUTH)
    expect(w.calls).toEqual([])
  })

  it('a scheme other than Bearer: 401', async () => {
    const { call, w, caller } = await scene()
    expect(pick(await call(ask(), { token: null, headers: { authorization: `Basic ${caller.token}` } }))).toEqual(UNAUTH)
    expect(w.calls).toEqual([])
  })

  it('a token GoTrue refuses: 401 after one getUser on the service client', async () => {
    const { call, w } = await scene()
    expect(pick(await call(ask(), { token: 'not-a-known-token' }))).toEqual(UNAUTH)
    expect(trips(w)).toEqual([{ kind: 'auth', name: 'getUser', by: 'service' }])
  })

  it('a known user who is not a member of the claimed company: 403', async () => {
    const { call, w } = await scene()
    const stranger = tokenFor({ sub: USER_B, app_metadata: { workspace_id: WS_A } })
    w.auth.users.set(stranger, { id: USER_B, app_metadata: { workspace_id: WS_A } })
    expect(pick(await call(ask(), { token: stranger }))).toEqual(FORBID)
    expect(trips(w)).toEqual([
      { kind: 'auth', name: 'getUser', by: 'service' },
      { kind: 'table', name: 'workspace_members', by: 'service' },
    ])
  })

  it('a deactivated member: 403', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW_MS)
    const { handler, w } = await boot({ WILSON_GATEWAY_KEY_SECRET: MASTER })
    const caller = seatCaller(w, { userId: USER_A, workspaceId: WS_A, active: false })
    expect(pick(await answerOf(await handler(post(ask(), { token: caller.token }))))).toEqual(FORBID)
    expect(callsTo(w, 'fn_rate_limit_hit')).toEqual([])
  })

  it('a token with no company in its claims or in the user: 403, and the membership is never read', async () => {
    const { call, w } = await scene()
    const homeless = tokenFor({ sub: USER_B, app_metadata: {} })
    w.auth.users.set(homeless, { id: USER_B, app_metadata: {} })
    expect(pick(await call(ask(), { token: homeless }))).toEqual(FORBID)
    expect(trips(w)).toEqual([{ kind: 'auth', name: 'getUser', by: 'service' }])
  })
})

describe('gateway-ticket — the rate limit', () => {
  it('the limiter is asked on the service client with the bucket, the caller, 60 a minute', async () => {
    const { call, w } = await scene()
    await call()
    const [hit] = callsTo(w, 'fn_rate_limit_hit')
    expect(hit.by).toBe('service')
    expect(hit.args).toEqual({ p_bucket: 'gateway-ticket', p_subject: USER_A, p_limit: 60, p_window_seconds: 60 })
  })

  it('GATEWAY_TICKET_PER_MINUTE sets the limit', async () => {
    const { call, w } = await scene({ env: { GATEWAY_TICKET_PER_MINUTE: '7' } })
    await call()
    expect(callsTo(w, 'fn_rate_limit_hit')[0].args.p_limit).toBe(7)
  })

  it('over the limit: 429 rate_limited, before the body is read (a body that is not JSON is still 429)', async () => {
    const { call, w } = await scene()
    w.rpc('fn_rate_limit_hit', () => ({ data: true, error: null }))
    expect(pick(await call(undefined, { raw: '{not json' }))).toEqual(
      refused(429, 'rate_limited', 'Too many ticket requests this minute; wait a moment and press play again.'))
    expect(trips(w).map((t) => t.name)).toEqual(['getUser', 'workspace_members', 'fn_rate_limit_hit'])
  })

  it('a limiter that errors fails OPEN: the tickets are made, and the failure is logged', async () => {
    const err = silenceErrors()
    const { call, w } = await scene()
    w.rpc('fn_rate_limit_hit', () => ({ data: null, error: { message: 'limiter down' } }))
    const a = await call()
    expect(a.status).toBe(200)
    expect(Object.keys(a.json.tickets)).toEqual([CLIP1])
    expect(err).toHaveBeenCalledWith('rate-limit RPC failed (gateway-ticket): limiter down')
  })
})

describe('gateway-ticket — the shape', () => {
  it('a body that is not JSON: 400 bad_request "not JSON"', async () => {
    const { call, w } = await scene()
    expect(pick(await call(undefined, { raw: '{not json' }))).toEqual(refused(400, 'bad_request', 'The request body is not JSON.'))
    expect(callsTo(w, 'gateways_visible')).toEqual([])
  })

  it('no body at all: 400 bad_request "not a JSON object" (readJson answers value undefined)', async () => {
    const { call } = await scene()
    expect(pick(await call(undefined, { raw: null }))).toEqual(refused(400, 'bad_request', 'The request body is not a JSON object.'))
    expect(pick(await call(undefined, { raw: '' }))).toEqual(refused(400, 'bad_request', 'The request body is not a JSON object.'))
  })

  it('a body over 16 KB is NOT 413: a well-formed request padded past the cap is 400 "not a JSON object"', async () => {
    const { call, w } = await scene()
    const big = JSON.stringify({ ...ask(), pad: 'x'.repeat(17 * 1024) })
    expect(pick(await call(undefined, { raw: big }))).toEqual(refused(400, 'bad_request', 'The request body is not a JSON object.'))
    expect(callsTo(w, 'gateways_visible')).toEqual([])
  })

  it('exactly 16 KB is read; one byte more is not', async () => {
    const { call } = await scene()
    const base = JSON.stringify({ ...ask(), pad: '' })
    const at = JSON.stringify({ ...ask(), pad: 'x'.repeat(16 * 1024 - base.length) })
    expect(at.length).toBe(16 * 1024)
    expect((await call(undefined, { raw: at })).status).toBe(200)
    const over = JSON.stringify({ ...ask(), pad: 'x'.repeat(16 * 1024 - base.length + 1) })
    expect(pick(await call(undefined, { raw: over }))).toEqual(refused(400, 'bad_request', 'The request body is not a JSON object.'))
  })

  it('a body that never ends is read through and dropped up to 64 MiB (gatewayWire.DRAIN_MAX_BYTES), then cancelled: the same 400', async () => {
    const { call } = await scene()
    const { stream, state } = endlessBody(1024)
    expect(pick(await call(undefined, { raw: stream }))).toEqual(refused(400, 'bad_request', 'The request body is not a JSON object.'))
    expect(state.cancelled).toBe(true)
    // F8, the drain: was "at most 18 KiB pulled" (cut off just past 16 KB).
    expect(state.pulled).toBeGreaterThanOrEqual(64 * 1024 * 1024)
    expect(state.pulled).toBeLessThan(64 * 1024 * 1024 + 1024)
  }, 60_000)

  it.each([
    ['an array', [1], 'bad_request', 'The request body is not a JSON object.'],
    ['a string', 'hello', 'bad_request', 'The request body is not a JSON object.'],
    ['null', null, 'bad_request', 'The request body is not a JSON object.'],
    ['no gateway_id', { bin_file_ids: [CLIP1] }, 'bad_gateway_id', "gateway_id must be a gateway's id."],
    ['an upper-case gateway_id', { gateway_id: GW_A.toUpperCase(), bin_file_ids: [CLIP1] }, 'bad_gateway_id', "gateway_id must be a gateway's id."],
    ['no bin_file_ids', { gateway_id: GW_A }, 'bad_ids', 'bin_file_ids must list at least one clip.'],
    ['an empty bin_file_ids', { gateway_id: GW_A, bin_file_ids: [] }, 'bad_ids', 'bin_file_ids must list at least one clip.'],
    ['51 ids', { gateway_id: GW_A, bin_file_ids: Array(51).fill(CLIP1) }, 'too_many', 'At most 50 clips can be asked for at once.'],
    ['an id that is not a uuid', { gateway_id: GW_A, bin_file_ids: [CLIP1, 'nope'] }, 'bad_ids', "Every entry of bin_file_ids must be a clip's id."],
    ['a number for an id', { gateway_id: GW_A, bin_file_ids: [7] }, 'bad_ids', "Every entry of bin_file_ids must be a clip's id."],
  ])('%s: 400 %s', async (_label, body, code, detail) => {
    const { call, w } = await scene()
    expect(pick(await call(body))).toEqual(refused(400, code, detail))
    expect(callsTo(w, 'gateways_visible')).toEqual([])
  })

  it('51 ids are refused even when they are one id repeated (the cap counts before the duplicates fold)', async () => {
    const { call } = await scene()
    expect((await call({ gateway_id: GW_A, bin_file_ids: Array(51).fill(CLIP1) })).json.error).toBe('too_many')
    expect((await call({ gateway_id: GW_A, bin_file_ids: Array(50).fill(CLIP1) })).status).toBe(200)
  })
})

describe('gateway-ticket — the gateway and the clips, as the caller', () => {
  it('the gateway read errors: 503 gateway_check_failed, the clips are never asked', async () => {
    const { call, w } = await scene()
    w.table('gateways_visible', () => ({ data: null, error: { message: 'boom' } }))
    expect(pick(await call())).toEqual(refused(503, 'gateway_check_failed', 'WILSON could not check the gateway just now; press play again in a moment.'))
    expect(callsTo(w, 'gateway_clips_for_tickets')).toEqual([])
  })

  it('no gateway visible to the caller: 404 gateway_unavailable', async () => {
    const { call, w } = await scene({ gateway: null })
    expect(pick(await call())).toEqual(refused(404, 'gateway_unavailable',
      "That gateway is not available to you: it was forgotten, it is another company's, or its fingerprint has not been confirmed yet."))
    expect(callsTo(w, 'gateway_clips_for_tickets')).toEqual([])
  })

  it('the gateway is read with its id, three columns, maybeSingle, on the caller\'s client', async () => {
    const { call, w } = await scene()
    await call()
    const [q] = callsTo(w, 'gateways_visible')
    expect({ by: q.by, op: q.op, columns: q.columns, filters: q.filters, terminal: q.terminal }).toEqual({
      by: 'caller', op: 'select', columns: 'id, workspace_id, version', filters: [{ f: 'eq', column: 'id', value: GW_A }], terminal: 'maybeSingle',
    })
  })

  it('a gateway below WILSON_GATEWAY_HARD_MINIMUM_VERSION: 409 gateway_too_old', async () => {
    const { call, w } = await scene({ env: { WILSON_GATEWAY_HARD_MINIMUM_VERSION: '2.0.0' } })
    expect(pick(await call())).toEqual(refused(409, 'gateway_too_old',
      "This gateway's version must be updated before it can serve clips (Settings, Storage, File gateway)."))
    expect(callsTo(w, 'gateway_clips_for_tickets')).toEqual([])
  })

  it('a gateway AT the hard minimum is served; the soft minimum is not consulted', async () => {
    const { call } = await scene({ env: { WILSON_GATEWAY_HARD_MINIMUM_VERSION: '1.4.0', WILSON_GATEWAY_MINIMUM_VERSION: '9.0.0' } })
    expect((await call()).status).toBe(200)
  })

  it('a gateway whose version cannot be read passes the hard minimum (compareVersions answers 0)', async () => {
    const { call } = await scene({ gateway: { id: GW_A, workspace_id: WS_A, version: null }, env: { WILSON_GATEWAY_HARD_MINIMUM_VERSION: '2.0.0' } })
    expect((await call()).status).toBe(200)
  })

  it('a malformed hard minimum is read as 0.0.0', async () => {
    const { call } = await scene({ env: { WILSON_GATEWAY_HARD_MINIMUM_VERSION: 'v2' } })
    expect((await call()).status).toBe(200)
  })

  it('the clips rpc errors: 503 clip_check_failed, no key read', async () => {
    const { call, w } = await scene()
    w.rpc('gateway_clips_for_tickets', () => ({ data: null, error: { message: 'boom' } }))
    expect(pick(await call())).toEqual(refused(503, 'clip_check_failed', 'WILSON could not check these clips just now; press play again in a moment.'))
    expect(callsTo(w, 'gateway_signing_key_current')).toEqual([])
  })

  it('the clips rpc is called with the de-duplicated ids on the caller\'s client', async () => {
    const { call, w } = await scene()
    await call(ask([CLIP1, CLIP2, CLIP1]))
    const [c] = callsTo(w, 'gateway_clips_for_tickets')
    expect(c.by).toBe('caller')
    expect(c.args).toEqual({ p_ids: [CLIP1, CLIP2] })
  })
})

describe('gateway-ticket — one company (F23)', () => {
  const MISMATCH = refused(403, 'workspace_mismatch', 'These clips, this gateway and your sign-in do not belong to one company, so no ticket was made.')

  it('the gateway is another company\'s: 403 workspace_mismatch, logged with the caller\'s id, no key read', async () => {
    const err = silenceErrors()
    const { call, w } = await scene({ gateway: { id: GW_A, workspace_id: WS_B, version: '1.4.0' } })
    expect(pick(await call())).toEqual(MISMATCH)
    expect(err).toHaveBeenCalledWith(`gateway-ticket: workspace mismatch for caller ${USER_A}`)
    expect(callsTo(w, 'gateway_signing_key_current')).toEqual([])
  })

  it('one clip of several is another company\'s: 403 for the whole request', async () => {
    silenceErrors()
    const { call, w } = await scene({ clips: [clip(), clip({ bin_file_id: CLIP2, workspace_id: WS_B })] })
    expect(pick(await call(ask([CLIP1, CLIP2])))).toEqual(MISMATCH)
    expect(callsTo(w, 'gateway_ticket_mints')).toEqual([])
  })

  it('another company\'s gateway is refused even when no clip is visible (the check comes first)', async () => {
    silenceErrors()
    const { call } = await scene({ clips: [], gateway: { id: GW_A, workspace_id: WS_B, version: '1.4.0' } })
    expect(pick(await call())).toEqual(MISMATCH)
  })
})

describe('gateway-ticket — nothing to mint', () => {
  it('no visible clips: 200 with no tickets, every id missing, expires_at null, and NO signing-key read', async () => {
    const { call, w } = await scene({ clips: [] })
    const a = await call(ask([CLIP1, CLIP2, CLIP1]))
    expect(pick(a)).toEqual({ status: 200, json: { tickets: {}, missing: [CLIP1, CLIP2], refused: [], expires_at: null }, headers: HEADERS })
    expect(callsTo(w, 'gateway_signing_key_current')).toEqual([])
    expect(callsTo(w, 'gateway_ticket_mints')).toEqual([])
  })

  it('the clips rpc answering null data is read as no rows', async () => {
    const { call, w } = await scene()
    w.rpc('gateway_clips_for_tickets', () => ({ data: null, error: null }))
    expect((await call()).json).toEqual({ tickets: {}, missing: [CLIP1], refused: [], expires_at: null })
  })
})

describe('gateway-ticket — the key', () => {
  it('the master secret is not set: 503 crypto_unavailable', async () => {
    const { call, w } = await scene({ secret: null })
    expect(pick(await call())).toEqual(refused(503, 'crypto_unavailable',
      'WILSON_GATEWAY_KEY_SECRET is not configured on this environment, so no ticket can be signed.'))
    expect(callsTo(w, 'gateway_ticket_mints')).toEqual([])
  })

  it('the master secret is only whitespace: the same 503 crypto_unavailable', async () => {
    const { call } = await scene({ secret: '   ' })
    expect((await call()).json.error).toBe('crypto_unavailable')
  })

  it('the master secret is malformed (not 32 bytes): 503 key_unavailable, not crypto_unavailable, and the key is replaced first', async () => {
    const err = silenceErrors()
    const { call, w } = await scene({ secret: Buffer.alloc(16).toString('base64') })
    expect(pick(await call())).toEqual(refused(503, 'key_unavailable', 'WILSON could not open the ticket key just now; press play again in a moment.'))
    expect(callsTo(w, 'gateway_signing_key_current').map((c) => c.args.p_rotate_after_seconds)).toEqual([KEY_ROTATE_AFTER_SECONDS, 60])
    expect(err).toHaveBeenLastCalledWith('gateway-ticket: WILSON_GATEWAY_KEY_SECRET must decode to exactly 32 bytes (got 16)')
  })

  it('the signing-key rpc errors: 503 key_unavailable, logged', async () => {
    const err = silenceErrors()
    const { call, w } = await scene({ keys: [{ data: null, error: { message: 'pool exhausted' } }] })
    expect(pick(await call())).toEqual(refused(503, 'key_unavailable', 'WILSON could not open the ticket key just now; press play again in a moment.'))
    expect(err).toHaveBeenCalledWith('gateway-ticket: the signing key could not be read: pool exhausted')
    expect(callsTo(w, 'gateway_signing_key_current')).toHaveLength(1)
    expect(callsTo(w, 'gateway_ticket_mints')).toEqual([])
  })

  it('the signing-key rpc is asked on the service client for the caller\'s company, a year\'s rotation', async () => {
    const { call, w } = await scene()
    await call()
    const [k] = callsTo(w, 'gateway_signing_key_current')
    expect(k.by).toBe('service')
    expect(k.args).toEqual({ p_workspace: WS_A, p_rotate_after_seconds: 31536000 })
    expect(KEY_ROTATE_AFTER_SECONDS).toBe(31536000)
  })
})

describe('gateway-ticket — the mint', () => {
  it('success: one verified ticket per clip, the claims in full, missing, refused, expires_at', async () => {
    const { call, key } = await scene({ clips: [clip(), clip({ bin_file_id: CLIP2, relative_path: 'B/seq', is_sequence: true, mime_type: null, remote_viewing: true })] })
    const a = await call(ask([CLIP1, CLIP2, CLIP3]))
    expect(a.status).toBe(200)
    expect(a.headers).toEqual(HEADERS)
    expect(Object.keys(a.json)).toEqual(['tickets', 'missing', 'refused', 'expires_at'])
    expect(Object.keys(a.json.tickets)).toEqual([CLIP1, CLIP2])
    expect(a.json.missing).toEqual([CLIP3])
    expect(a.json.refused).toEqual([])
    expect(a.json.expires_at).toBe(new Date((NOW_S + 120) * 1000).toISOString())
    const one = await verifyAs(a.json.tickets[CLIP1], key.pub, 'kalpha')
    expect(one).toEqual({ ok: true, claims: {
      v: 1, kid: 'kalpha', gw: GW_A, ws: WS_A, sub: USER_A, clip: CLIP1, loc: LOC, path: 'A001/A001_C001.mov',
      seq: false, mt: 'video/quicktime', rv: false, iat: NOW_S, exp: NOW_S + 120, jti: expect.stringMatching(/^[0-9a-f]{32}$/),
    } })
    const two = await verifyAs(a.json.tickets[CLIP2], key.pub, 'kalpha')
    expect(two.ok).toBe(true)
    expect([two.claims.path, two.claims.seq, two.claims.mt, two.claims.rv]).toEqual(['B/seq', true, '', true])
    expect(two.claims.jti).not.toBe(one.claims.jti)
    expect(two.claims.exp - two.claims.iat).toBe(120)
  })

  it('rv is true only for remote_viewing === true (a truthy string is false)', async () => {
    const { call, key } = await scene({ clips: [clip({ remote_viewing: 'yes' })] })
    const a = await call()
    expect((await verifyAs(a.json.tickets[CLIP1], key.pub, 'kalpha')).claims.rv).toBe(false)
  })

  it('refused: a path that makes the ticket longer than 4096 is too_long; a path the wire refuses is not_playable', async () => {
    const { call, w } = await scene({ clips: [
      clip(),
      clip({ bin_file_id: CLIP2, relative_path: '日'.repeat(1000) }),
      clip({ bin_file_id: CLIP3, relative_path: '../escape.mov' }),
      clip({ bin_file_id: CLIP4, location_id: 'not-a-uuid' }),
    ] })
    const a = await call(ask([CLIP1, CLIP2, CLIP3, CLIP4]))
    expect(a.status).toBe(200)
    expect(Object.keys(a.json.tickets)).toEqual([CLIP1])
    expect(a.json.missing).toEqual([])
    expect(a.json.refused).toEqual([{ id: CLIP2, reason: 'too_long' }, { id: CLIP3, reason: 'not_playable' }, { id: CLIP4, reason: 'not_playable' }])
    const [m] = callsTo(w, 'gateway_ticket_mints')
    expect(m.values.map((r) => r.bin_file_id)).toEqual([CLIP1])
  })

  it('every clip refused: 200, no tickets, no mint insert, and expires_at is still set', async () => {
    const { call, w } = await scene({ clips: [clip({ relative_path: '/abs.mov' })] })
    const a = await call()
    expect(a.json).toEqual({ tickets: {}, missing: [], refused: [{ id: CLIP1, reason: 'not_playable' }], expires_at: new Date((NOW_S + 120) * 1000).toISOString() })
    expect(callsTo(w, 'gateway_ticket_mints')).toEqual([])
  })

  it('the mint rows: one insert on the service client, the last call, its fields; the jti is the ticket\'s', async () => {
    const longName = 'n'.repeat(600)
    const { call, w, key } = await scene({ clips: [clip(), clip({ bin_file_id: CLIP2, file_name: null }), clip({ bin_file_id: CLIP3, file_name: longName })] })
    const a = await call(ask([CLIP1, CLIP2, CLIP3]))
    const mints = callsTo(w, 'gateway_ticket_mints')
    expect(mints).toHaveLength(1)
    expect(w.calls.at(-1)).toBe(mints[0])
    expect([mints[0].by, mints[0].op]).toEqual(['service', 'insert'])
    const jtis = await Promise.all([CLIP1, CLIP2, CLIP3].map(async (id) => (await verifyAs(a.json.tickets[id], key.pub, 'kalpha')).claims.jti))
    expect(mints[0].values).toEqual([
      { jti: jtis[0], workspace_id: WS_A, gateway_id: GW_A, user_id: USER_A, bin_file_id: CLIP1, project_id: PROJ, file_name: 'A001_C001.mov' },
      { jti: jtis[1], workspace_id: WS_A, gateway_id: GW_A, user_id: USER_A, bin_file_id: CLIP2, project_id: PROJ, file_name: '' },
      { jti: jtis[2], workspace_id: WS_A, gateway_id: GW_A, user_id: USER_A, bin_file_id: CLIP3, project_id: PROJ, file_name: 'n'.repeat(500) },
    ])
    expect(Object.keys(mints[0].values[0])).toEqual(['jti', 'workspace_id', 'gateway_id', 'user_id', 'bin_file_id', 'project_id', 'file_name'])
  })

  it('the mint rows are written before the answer is made (the insert is awaited)', async () => {
    const { handler, caller, w } = await scene()
    let written = false
    w.table('gateway_ticket_mints', async () => { await new Promise((r) => setTimeout(r, 20)); written = true; return { data: null, error: null } })
    const res = await handler(post(ask(), { token: caller.token }))
    expect(written).toBe(true)
    expect(res.status).toBe(200)
  })

  it('the mint insert errors: 503 mint_log_failed, no ticket in the answer, logged', async () => {
    const err = silenceErrors()
    const { call, w } = await scene()
    w.table('gateway_ticket_mints', () => ({ data: null, error: { message: 'disk full' } }))
    const a = await call()
    expect(pick(a)).toEqual(refused(503, 'mint_log_failed', 'WILSON could not record these tickets, so it did not hand them out; press play again in a moment.'))
    expect(a.text).not.toContain('v1.')
    expect(err).toHaveBeenCalledWith('gateway-ticket: mint log failed: disk full')
  })

  it('WHO asked: the predicates on the caller\'s token, everything else on the service role; two clients per call', async () => {
    const { call, w, caller } = await scene()
    await call()
    const by = Object.fromEntries(w.calls.map((c) => [c.name, c.by]))
    expect(by).toEqual({
      getUser: 'service', workspace_members: 'service', fn_rate_limit_hit: 'service',
      gateways_visible: 'caller', gateway_clips_for_tickets: 'caller',
      gateway_signing_key_current: 'service', gateway_ticket_mints: 'service',
    })
    expect(w.clients).toEqual([
      { key: SERVICE_KEY, by: 'service', options: undefined },
      { key: ANON_KEY, by: 'caller', options: { global: { headers: { Authorization: `Bearer ${caller.token}` } }, auth: { persistSession: false, autoRefreshToken: false } } },
    ])
  })
})

// ── B. The signing-key helper ────────────────────────────────────────────────

describe('gatewaySigning — a key made when there is none', () => {
  async function emptyScene() {
    let stored = null
    const s = await scene({ keys: [(args) => ({ data: stored, error: null })] })
    s.w.rpc('gateway_signing_key_put', (args) => {
      stored = { kid: args.p_kid, public_key: args.p_public_key, private_key_ciphertext: args.p_ciphertext }
      return { data: stored, error: null }
    })
    return s
  }

  it('generates, seals and stores one with gateway_signing_key_put, and signs with it', async () => {
    const { call, w } = await emptyScene()
    const a = await call()
    expect(a.status).toBe(200)
    expect(trips(w).slice(5, 7)).toEqual([
      { kind: 'rpc', name: 'gateway_signing_key_current', by: 'service' },
      { kind: 'rpc', name: 'gateway_signing_key_put', by: 'service' },
    ])
    const [put] = callsTo(w, 'gateway_signing_key_put')
    expect(Object.keys(put.args)).toEqual(['p_workspace', 'p_kid', 'p_public_key', 'p_ciphertext', 'p_rotate_after_seconds'])
    expect(put.args.p_workspace).toBe(WS_A)
    expect(put.args.p_kid).toMatch(/^k[0-9a-f]{12}$/)
    expect(put.args.p_public_key).toMatch(/^[A-Za-z0-9+/]{43}=$/)
    expect(put.args.p_rotate_after_seconds).toBe(31536000)
    const pub = await importSigningPublicKey(put.args.p_public_key)
    expect((await verifyAs(a.json.tickets[CLIP1], pub, put.args.p_kid)).ok).toBe(true)
  })

  it('the stored ciphertext opens under the master for that workspace and kid, and NOT for another workspace or kid', async () => {
    const { call, w } = await emptyScene()
    await call()
    const { p_ciphertext: ct, p_kid: kid } = callsTo(w, 'gateway_signing_key_put')[0].args
    const pkcs8 = await openSigningKey(ct, WS_A, kid, MASTER)
    expect(Buffer.from(pkcs8, 'base64').length).toBe(48)
    await expect(openSigningKey(ct, WS_B, kid, MASTER)).rejects.toThrow()
    await expect(openSigningKey(ct, WS_A, 'kother', MASTER)).rejects.toThrow()
    await expect(openSigningKey(ct, WS_A, kid, OTHER_MASTER)).rejects.toThrow()
  })

  it('the next call finds the stored key and does not put again', async () => {
    const { call, w } = await emptyScene()
    await call()
    await call()
    expect(callsTo(w, 'gateway_signing_key_put')).toHaveLength(1)
    expect(callsTo(w, 'gateway_signing_key_current')).toHaveLength(2)
  })

  it('the put errors: 503 key_unavailable, "could not be stored: <message>"', async () => {
    const err = silenceErrors()
    const { call, w } = await scene({ keys: [{ data: null, error: null }] })
    w.rpc('gateway_signing_key_put', () => ({ data: null, error: { message: 'lock timeout' } }))
    expect((await call()).json.error).toBe('key_unavailable')
    expect(err).toHaveBeenCalledWith('gateway-ticket: the signing key could not be stored: lock timeout')
  })

  it('the put answers no row: 503 key_unavailable, "could not be stored: no row"', async () => {
    const err = silenceErrors()
    const { call } = await scene({ keys: [{ data: null, error: null }] })
    expect((await call()).json.error).toBe('key_unavailable')
    expect(err).toHaveBeenCalledWith('gateway-ticket: the signing key could not be stored: no row')
  })

  it('the put answers the WINNER\'s key (two first mints): the ticket is signed with the winner\'s', async () => {
    const winner = await keyRow(WS_A, { kid: 'kwinner' })
    const { call, w } = await scene({ keys: [{ data: null, error: null }] })
    w.rpc('gateway_signing_key_put', () => ({ data: winner.row, error: null }))
    const a = await call()
    expect((await verifyAs(a.json.tickets[CLIP1], winner.pub, 'kwinner')).ok).toBe(true)
  })
})

describe('gatewaySigning — a key that will not open is replaced once', () => {
  const WILL_NOT_OPEN = /^gateway signing key kbad will not open \(.+\); replacing it$/

  async function badThenGood(bad) {
    const good = await keyRow(WS_A, { kid: 'kgood' })
    const s = await scene({ keys: [{ data: bad.row, error: null }, { data: good.row, error: null }] })
    return { ...s, good }
  }

  it.each([
    ['sealed under another master', { master: OTHER_MASTER }],
    ['sealed for another workspace', { sealFor: WS_B }],
  ])('%s: a second current read with p_rotate_after_seconds 60, signed with the replacement', async (_label, opts) => {
    const err = silenceErrors()
    const bad = await keyRow(WS_A, { kid: 'kbad', ...opts })
    const { call, w, good } = await badThenGood(bad)
    const a = await call()
    expect(a.status).toBe(200)
    expect(callsTo(w, 'gateway_signing_key_current').map((c) => [c.by, c.args])).toEqual([
      ['service', { p_workspace: WS_A, p_rotate_after_seconds: 31536000 }],
      ['service', { p_workspace: WS_A, p_rotate_after_seconds: 60 }],
    ])
    expect(trips(w).map((t) => t.name).slice(5)).toEqual(['gateway_signing_key_current', 'gateway_signing_key_current', 'gateway_ticket_mints'])
    expect((await verifyAs(a.json.tickets[CLIP1], good.pub, 'kgood')).ok).toBe(true)
    expect((await verifyAs(a.json.tickets[CLIP1], bad.pub, 'kgood')).ok).toBe(false)
    expect(err).toHaveBeenCalledTimes(1)
    expect(err.mock.calls[0]).toHaveLength(1)
    expect(err.mock.calls[0][0]).toMatch(WILL_NOT_OPEN)
  })

  it('a truncated envelope: replaced, and the log names the truncation', async () => {
    const err = silenceErrors()
    const bad = await keyRow(WS_A, { kid: 'kbad' })
    bad.row.private_key_ciphertext = Buffer.alloc(20).toString('base64')
    const { call } = await badThenGood(bad)
    expect((await call()).status).toBe(200)
    expect(err).toHaveBeenCalledWith('gateway signing key kbad will not open (the sealed signing key is truncated); replacing it')
  })

  it('the second read answers nothing young enough: a new key is put with p_rotate_after_seconds 60', async () => {
    silenceErrors()
    const bad = await keyRow(WS_A, { kid: 'kbad', master: OTHER_MASTER })
    let stored = null
    const { call, w } = await scene({ keys: [{ data: bad.row, error: null }, () => ({ data: stored, error: null })] })
    w.rpc('gateway_signing_key_put', (args) => {
      stored = { kid: args.p_kid, public_key: args.p_public_key, private_key_ciphertext: args.p_ciphertext }
      return { data: stored, error: null }
    })
    const a = await call()
    expect(callsTo(w, 'gateway_signing_key_current').map((c) => c.args.p_rotate_after_seconds)).toEqual([31536000, 60])
    const [put] = callsTo(w, 'gateway_signing_key_put')
    expect(put.args.p_rotate_after_seconds).toBe(60)
    expect(put.args.p_workspace).toBe(WS_A)
    const pub = await importSigningPublicKey(put.args.p_public_key)
    expect((await verifyAs(a.json.tickets[CLIP1], pub, put.args.p_kid)).ok).toBe(true)
  })

  it('the replacement will not open either: 503 key_unavailable, only ONE replacement tried', async () => {
    const err = silenceErrors()
    const bad = await keyRow(WS_A, { kid: 'kbad', master: OTHER_MASTER })
    const { call, w } = await scene({ keys: [{ data: bad.row, error: null }] })
    expect((await call()).json.error).toBe('key_unavailable')
    expect(callsTo(w, 'gateway_signing_key_current')).toHaveLength(2)
    expect(err).toHaveBeenCalledTimes(2)
    expect(err.mock.calls[0][0]).toMatch(WILL_NOT_OPEN)
    expect(err.mock.calls[1][0]).toMatch(/^gateway-ticket: .+/)
    expect(callsTo(w, 'gateway_ticket_mints')).toEqual([])
  })

  it('the master secret missing: GatewayKeyCryptoUnavailable is re-thrown (crypto_unavailable), nothing is replaced', async () => {
    const err = silenceErrors()
    const { call, w } = await scene({ secret: null })
    expect((await call()).json.error).toBe('crypto_unavailable')
    expect(callsTo(w, 'gateway_signing_key_current')).toHaveLength(1)
    expect(callsTo(w, 'gateway_signing_key_put')).toEqual([])
    expect(err).not.toHaveBeenCalled()
  })

  it('the master secret missing and no key yet: crypto_unavailable, a key is generated but never stored', async () => {
    const { call, w } = await scene({ secret: null, keys: [{ data: null, error: null }] })
    expect((await call()).json.error).toBe('crypto_unavailable')
    expect(callsTo(w, 'gateway_signing_key_put')).toEqual([])
  })
})

describe('gatewaySigning — imported directly', () => {
  async function load(env) {
    vi.stubGlobal('Deno', { env: { get: (n) => env[n] } })
    vi.resetModules()
    return await import('../../supabase/functions/_shared/gatewaySigning.ts')
  }

  it('signingKeyFor answers { kid, privateKey }: a non-extractable Ed25519 key that signs only', async () => {
    const { signingKeyFor } = await load({ WILSON_GATEWAY_KEY_SECRET: MASTER })
    const w = newWorld()
    const k = await keyRow(WS_A, { kid: 'kdirect' })
    w.rpc('gateway_signing_key_current', () => ({ data: k.row, error: null }))
    const out = await signingKeyFor(createClient(SUPABASE_URL, SERVICE_KEY), WS_A)
    expect(Object.keys(out)).toEqual(['kid', 'privateKey'])
    expect(out.kid).toBe('kdirect')
    expect([out.privateKey.type, out.privateKey.algorithm.name, out.privateKey.extractable, out.privateKey.usages]).toEqual(['private', 'Ed25519', false, ['sign']])
  })

  it('ensureSigningKey answers the current row as it is, unopened', async () => {
    const { ensureSigningKey } = await load({})
    const w = newWorld()
    const row = { kid: 'kraw', public_key: 'x', private_key_ciphertext: 'not even base64!' }
    w.rpc('gateway_signing_key_current', () => ({ data: row, error: null }))
    expect(await ensureSigningKey(createClient(SUPABASE_URL, SERVICE_KEY), WS_A)).toBe(row)
  })

  it('signingKeyFor with no master re-throws GatewayKeyCryptoUnavailable itself (its own class, from its own module copy)', async () => {
    const mod = await load({})
    const crypto = await import('../../supabase/functions/_shared/gatewayKeyCrypto.ts')
    const w = newWorld()
    const k = await keyRow(WS_A, { kid: 'knomaster' })
    w.rpc('gateway_signing_key_current', () => ({ data: k.row, error: null }))
    const e = await mod.signingKeyFor(createClient(SUPABASE_URL, SERVICE_KEY), WS_A).catch((x) => x)
    expect(e).toBeInstanceOf(crypto.GatewayKeyCryptoUnavailable)
    expect(e).not.toBeInstanceOf(GatewayKeyCryptoUnavailable) // the top-level import is another module copy
    expect([e.name, e.message]).toEqual(['GatewayKeyCryptoUnavailable', 'WILSON_GATEWAY_KEY_SECRET is not configured'])
  })
})

// ── C. The work of one call ──────────────────────────────────────────────────

describe('the work of one call (C5)', () => {
  it('TODAY is a record of what one call cost before F8, not an assertion against the code', () => {
    expect(TODAY).toEqual({ importsPerCall: 2, decryptsPerCall: 1 })
  })

  it('one successful call for one clip: seven round trips, in this order (must NOT change in F8)', async () => {
    const { call, w } = await scene()
    expect((await call()).status).toBe(200)
    expect(trips(w)).toEqual([
      { kind: 'auth', name: 'getUser', by: 'service' },
      { kind: 'table', name: 'workspace_members', by: 'service' },
      { kind: 'rpc', name: 'fn_rate_limit_hit', by: 'service' },
      { kind: 'table', name: 'gateways_visible', by: 'caller' },
      { kind: 'rpc', name: 'gateway_clips_for_tickets', by: 'caller' },
      { kind: 'rpc', name: 'gateway_signing_key_current', by: 'service' },
      { kind: 'table', name: 'gateway_ticket_mints', by: 'service' },
    ])
  })

  it('every warm call still makes the same seven round trips, one signing-key read each (must NOT change in F8)', async () => {
    const { call, w } = await scene()
    for (let i = 0; i < 6; i++) {
      const before = w.calls.length
      expect((await call()).status).toBe(200)
      expect(trips(w).slice(before).map((t) => t.name)).toEqual([
        'getUser', 'workspace_members', 'fn_rate_limit_hit', 'gateways_visible', 'gateway_clips_for_tickets',
        'gateway_signing_key_current', 'gateway_ticket_mints',
      ])
    }
  })

  it('the first call of a fresh load: the AES master imported, the key decrypted once, the Ed25519 key imported', async () => {
    const { call } = await scene()
    const run = meter()
    const first = await run(() => call())
    expect(first.out.status).toBe(200)
    expect(first.imports).toEqual(['raw', 'pkcs8'])
    expect(first.decrypts).toBe(1)
  })

  it('a warm call opens nothing (WARM_CALL: no import, no decrypt) and still makes one signing-key read (C5)', async () => {
    const { call, w, key } = await scene()
    const run = meter()
    const first = await run(() => call())
    expect([first.imports.length, first.decrypts]).toEqual([2, 1])
    const warm = []
    for (let i = 0; i < 5; i++) {
      const before = callsTo(w, 'gateway_signing_key_current').length
      const r = await run(() => call())
      expect(r.out.status).toBe(200)
      expect((await verifyAs(r.out.json.tickets[CLIP1], key.pub, 'kalpha')).ok).toBe(true)
      expect(callsTo(w, 'gateway_signing_key_current').length - before).toBe(1)
      warm.push([r.imports.length, r.decrypts])
    }
    expect(warm).toEqual(Array.from({ length: 5 }, () => [WARM_CALL.imports, WARM_CALL.decrypts]))
  })

  it.each([
    ['a new kid', { kid: 'kbeta' }],
    ['a new ciphertext under the same kid', { kid: 'kalpha' }],
  ])('safety 1 — the database answers %s: the next call opens and imports again and signs with the new key', async (_label, opts) => {
    const old = await keyRow(WS_A, { kid: 'kalpha' })
    const next = await keyRow(WS_A, opts)
    let current = old.row
    const { call } = await scene({ keys: [() => ({ data: current, error: null })] })
    const run = meter()
    await call()
    await call()
    current = next.row
    const r = await run(() => call())
    expect(r.out.status).toBe(200)
    expect(r.imports.filter((f) => f === 'pkcs8')).toHaveLength(1)
    expect(r.decrypts).toBe(1)
    const t = r.out.json.tickets[CLIP1]
    expect((await verifyAs(t, next.pub, opts.kid)).ok).toBe(true)
    expect(await verifyAs(t, old.pub, opts.kid)).toEqual({ ok: false, reason: 'bad_signature' })
    if (opts.kid !== 'kalpha') expect((await verifyAs(t, old.pub, 'kalpha')).reason).toBe('unknown_kid')
  })

  it('safety 2 — two workspaces in one warm isolate never share a key', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW_MS)
    const { handler, w } = await boot({ WILSON_GATEWAY_KEY_SECRET: MASTER })
    w.table('workspace_members', (q) => {
      const ws = q.filters.find((f) => f.column === 'workspace_id')?.value
      const uid = q.filters.find((f) => f.column === 'user_id')?.value
      const ok = (uid === USER_A && ws === WS_A) || (uid === USER_B && ws === WS_B)
      return { data: ok ? { is_active: true } : null, error: null }
    })
    const a = seatCaller(w, { userId: USER_A, workspaceId: WS_A })
    const b = seatCaller(w, { userId: USER_B, workspaceId: WS_B })
    const keys = { [WS_A]: await keyRow(WS_A, { kid: 'kalpha' }), [WS_B]: await keyRow(WS_B, { kid: 'kbravo' }) }
    const gateways = { [GW_A]: { id: GW_A, workspace_id: WS_A, version: '1.4.0' }, [GW_B]: { id: GW_B, workspace_id: WS_B, version: '1.4.0' } }
    w.table('gateways_visible', (q) => ({ data: gateways[q.filters[0].value] ?? null, error: null }))
    w.rpc('gateway_clips_for_tickets', (args) => ({ data: args.p_ids.map((id) => (id === CLIP_B ? clip({ bin_file_id: CLIP_B, workspace_id: WS_B }) : clip())), error: null }))
    w.rpc('gateway_signing_key_current', (args) => ({ data: keys[args.p_workspace].row, error: null }))
    const asA = async () => (await answerOf(await handler(post(ask([CLIP1], GW_A), { token: a.token })))).json.tickets[CLIP1]
    const asB = async () => (await answerOf(await handler(post(ask([CLIP_B], GW_B), { token: b.token })))).json.tickets[CLIP_B]
    for (let i = 0; i < 3; i++) {
      const ta = await asA()
      const tb = await asB()
      expect((await verifyAs(ta, keys[WS_A].pub, 'kalpha')).ok).toBe(true)
      expect((await verifyAs(tb, keys[WS_B].pub, 'kbravo', { gw: GW_B, ws: WS_B })).ok).toBe(true)
      expect((await verifyAs(ta, keys[WS_B].pub, 'kalpha')).reason).toBe('bad_signature')
      expect((await verifyAs(tb, keys[WS_A].pub, 'kbravo', { gw: GW_B, ws: WS_B })).reason).toBe('bad_signature')
    }
  })

  it('after a key that would not open was replaced, the next call opens nothing: the replacement is the one kept (C5)', async () => {
    silenceErrors()
    const bad = await keyRow(WS_A, { kid: 'kbad', master: OTHER_MASTER })
    const good = await keyRow(WS_A, { kid: 'kgood' })
    // The first read answers the bad key; from the replacement on, the good one.
    const { call } = await scene({ keys: [{ data: bad.row, error: null }, { data: good.row, error: null }] })
    const run = meter()
    const first = await run(() => call())
    expect(first.out.status).toBe(200)
    expect((await verifyAs(first.out.json.tickets[CLIP1], good.pub, 'kgood')).ok).toBe(true)
    const next = await run(() => call())
    expect((await verifyAs(next.out.json.tickets[CLIP1], good.pub, 'kgood')).claims.kid).toBe('kgood')
    expect([next.imports.length, next.decrypts]).toEqual([WARM_CALL.imports, WARM_CALL.decrypts])
  })

  it('safety 3 (green part) — after the replacement, the next call signs with the replacement\'s kid', async () => {
    silenceErrors()
    const bad = await keyRow(WS_A, { kid: 'kbad', master: OTHER_MASTER })
    const good = await keyRow(WS_A, { kid: 'kgood' })
    const { call, w } = await scene({ keys: [{ data: bad.row, error: null }, { data: good.row, error: null }] })
    await call()
    const t = (await call()).json.tickets[CLIP1]
    expect((await verifyAs(t, good.pub, 'kgood')).ok).toBe(true)
    expect(callsTo(w, 'gateway_signing_key_current').map((c) => c.args.p_rotate_after_seconds)).toEqual([31536000, 60, 31536000])
  })

  it('F8 (f): the master secret removed while warm: 503 crypto_unavailable, the cold answer exactly, nothing replaced', async () => {
    const err = silenceErrors()
    const { call, w, live } = await scene()
    expect((await call()).status).toBe(200)
    expect((await call()).status).toBe(200)
    delete live.WILSON_GATEWAY_KEY_SECRET
    const warm = await call()
    const cold = await (await scene({ secret: null })).call()
    expect(pick(warm)).toEqual(pick(cold))
    expect(warm.json.error).toBe('crypto_unavailable')
    expect(callsTo(w, 'gateway_signing_key_put')).toEqual([])
    expect(err).not.toHaveBeenCalled()
  })

  it('F8 (f): the master secret CHANGED while warm is a miss: the kept key is not used, the old one will not open, as cold', async () => {
    silenceErrors()
    const { call, w, live } = await scene()
    expect((await call()).status).toBe(200)
    live.WILSON_GATEWAY_KEY_SECRET = OTHER_MASTER
    const warm = await call()
    expect(warm.json.error).toBe('key_unavailable')
    // The replace-once path ran, as it does cold: the current key read, then the 60-second one.
    expect(callsTo(w, 'gateway_signing_key_current').map((c) => c.args.p_rotate_after_seconds)).toEqual([31536000, 31536000, 60])
  })

  it('F8 (f): a key that will not open is never kept: the next call tries to open it again', async () => {
    silenceErrors()
    const bad = await keyRow(WS_A, { kid: 'kbad', master: OTHER_MASTER })
    const { call } = await scene({ keys: [{ data: bad.row, error: null }] })
    const run = meter()
    expect((await call()).json.error).toBe('key_unavailable')
    const again = await run(() => call())
    expect(again.out.json.error).toBe('key_unavailable')
    expect(again.decrypts).toBe(2) // the row and its "replacement", both tried again
  })

  it('every warm call still makes the same seven round trips, in this order, by the same clients (F8 f)', async () => {
    const { call, w } = await scene()
    await call()
    const before = w.calls.length
    expect((await call()).status).toBe(200)
    expect(trips(w).slice(before)).toEqual([
      { kind: 'auth', name: 'getUser', by: 'service' },
      { kind: 'table', name: 'workspace_members', by: 'service' },
      { kind: 'rpc', name: 'fn_rate_limit_hit', by: 'service' },
      { kind: 'table', name: 'gateways_visible', by: 'caller' },
      { kind: 'rpc', name: 'gateway_clips_for_tickets', by: 'caller' },
      { kind: 'rpc', name: 'gateway_signing_key_current', by: 'service' },
      { kind: 'table', name: 'gateway_ticket_mints', by: 'service' },
    ])
  })

  it('safety 4 — a fresh load (a new isolate) starts cold again', async () => {
    const first = await scene()
    const run = meter()
    await first.call()
    await first.call()
    const second = await scene()
    const r = await run(() => second.call())
    expect(r.out.status).toBe(200)
    expect(r.imports).toEqual(['raw', 'pkcs8'])
    expect(r.decrypts).toBe(1)
  })
})

describe('the kept keys are bounded: 256 workspaces, the least recently used leaving (F8 f)', () => {
  const wsId = (i) => `f0000000-0000-4000-8000-${String(i).padStart(12, '0')}`
  async function setUpMany(n) {
    vi.stubGlobal('Deno', { env: { get: (k) => (k === 'WILSON_GATEWAY_KEY_SECRET' ? MASTER : undefined) } })
    vi.resetModules()
    const mod = await import('../../supabase/functions/_shared/gatewaySigning.ts')
    const w = newWorld()
    const rows = {}
    for (let i = 1; i <= n; i++) rows[wsId(i)] = (await keyRow(wsId(i), { kid: `k${i}` })).row
    w.rpc('gateway_signing_key_current', (args) => ({ data: rows[args.p_workspace], error: null }))
    const admin = createClient(SUPABASE_URL, SERVICE_KEY)
    const run = meter()
    const sign = async (i) => {
      const r = await run(() => mod.signingKeyFor(admin, wsId(i)))
      return { kid: r.out.kid, decrypts: r.decrypts, pkcs8: r.imports.filter((f) => f === 'pkcs8').length }
    }
    return { mod, sign, w }
  }

  it('257 workspaces: the first is opened again; the ones still kept open nothing', async () => {
    const { mod, sign, w } = await setUpMany(257)
    expect(mod.OPENED_KEYS_MAX).toBe(256)
    for (let i = 1; i <= 257; i++) expect((await sign(i)).decrypts, `ws ${i}`).toBe(1)
    expect(await sign(2)).toEqual({ kid: 'k2', decrypts: 0, pkcs8: 0 })
    expect(await sign(257)).toEqual({ kid: 'k257', decrypts: 0, pkcs8: 0 })
    expect(await sign(1)).toEqual({ kid: 'k1', decrypts: 1, pkcs8: 1 })
    // The database was asked on every call, kept or not.
    expect(w.count((c) => c.name === 'gateway_signing_key_current')).toBe(257 + 3)
  }, 60_000)

  it('using a key keeps it: touched before the 257th, the first stays and the second leaves', async () => {
    const { sign } = await setUpMany(257)
    for (let i = 1; i <= 256; i++) await sign(i)
    expect((await sign(1)).decrypts).toBe(0)
    await sign(257)
    expect(await sign(1)).toEqual({ kid: 'k1', decrypts: 0, pkcs8: 0 })
    expect(await sign(2)).toEqual({ kid: 'k2', decrypts: 1, pkcs8: 1 })
  }, 60_000)
})
