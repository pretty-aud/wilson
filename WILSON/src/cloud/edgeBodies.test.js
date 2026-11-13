// =============================================================================
// edgeBodies.test.js — F8 (wave 2): how fourteen Edge Functions read their
// request body, pinned exactly as the code stands BEFORE F8.
//
// Each of these fourteen reads its body with one unbounded `await req.json()`.
// F8 moves them onto a size-bounded reader. This file is the proof that
// nothing else about their answers moved: for every function it sends the
// same bodies (none, empty, broken JSON, JSON null, a number, a string, an
// array, an empty object, a minimal valid body, a byte-order mark, broken
// UTF-8, and a very large valid body) and holds the exact status and JSON
// that comes back today. Where today's code CRASHES (JSON `null` makes most
// of them read a field of null), the pin is the crash itself: the handler
// rejects, with that error class and message. Those are pinned, not fixed.
//
// It also pins the ORDER: what runs before the body is read (the guard, and
// in some functions the rate limiter) and so which answer wins when both
// would refuse.
//
// The large-body pins live in ONE block, "today: no cap (F8 changes this
// block)": they document that today any size is read and answered. F8 is
// expected to change that block, and only that block.
//
// The callers come from the harness (seatCaller / tokenFor): nobody's
// credentials. `fetch` is replaced in every test, so nothing reaches a network.
// =============================================================================

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { newWorld, loadFunction, seatCaller, post, answerOf, trips, VERIFIED_TOTP } from './edgeHarness.js'

vi.mock('https://esm.sh/@supabase/supabase-js@2.45.4', async () => ({
  createClient: (await import('./edgeHarness.js')).createClient,
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ── fetch: refused unless a test says otherwise ──────────────────────────────
let fetchCalls = []
const SSE = 'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":3}}}\n\n'
  + 'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n'
const UPSTREAM_400 = { type: 'error', error: { type: 'invalid_request_error', message: 'prompt is too long' } }
function stubFetch(kind) {
  fetchCalls = []
  vi.stubGlobal('fetch', async (url, init) => {
    fetchCalls.push({ url, init })
    if (kind === 'sse') return new Response(SSE, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    if (kind === 'error400') return new Response(JSON.stringify(UPSTREAM_400), { status: 400, headers: { 'content-type': 'application/json' } })
    throw new Error('edgeBodies: no network in this file')
  })
}
beforeEach(() => { fetchCalls = [] })

// ── how a caller is seated, per guard ────────────────────────────────────────
const SEAT = {
  admin: (w) => seatCaller(w, { role: 'admin' }).token,
  member: (w) => seatCaller(w, { role: 'user' }).token,
  operator: (w) => {
    w.table('platform_operators', () => ({ data: { user_id: 'user-1' }, error: null }))
    return seatCaller(w, { aal: 'aal2', factors: VERIFIED_TOTP }).token
  },
  // issue-session: a signed-in user with two live memberships (oldest first).
  signedIn: (w) => {
    w.table('workspace_members', () => ({ data: [{ workspace_id: 'ws-1' }, { workspace_id: 'ws-2' }], error: null }))
    return seatCaller(w).token
  },
  nobody: () => null,
}

// ── what each guard does before the body is read (seen in world.calls) ──────
const ADMIN_GUARD = ['auth:getUser', 'table:workspace_members', 'auth:listFactors']
const MEMBER_GUARD = ['auth:getUser', 'table:workspace_members']
const OPERATOR_GUARD = ['auth:getUser', 'table:platform_operators', 'auth:listFactors', 'table:workspace_members']
const LIMITER = 'rpc:fn_rate_limit_hit'

const r = (status, json) => ({ status, json })
const crash = (field) => ({ throws: 'TypeError', message: `Cannot read properties of null (reading '${field}')` })
const BAD_JSON = r(400, { error: 'bad_json' })
const UNAUTHORIZED = r(401, { error: 'unauthorized' })
const MISS = r(200, { exists: false, email: null })
const actionUnknown = r(400, { error: 'validation_failed', errors: [{ field: 'action', error: 'unknown' }] })
const userIdRequired = r(400, { error: 'validation_failed', errors: [{ field: 'user_id', error: 'required' }] })
const PRESIGN_NOT_JSON = r(400, { error: 'bad_request', detail: 'the request body is not JSON' })
const PROJECT_ID = '11111111-1111-4111-8111-111111111111'

// ── the fourteen ─────────────────────────────────────────────────────────────
// shapes: the answer to a non-JSON body (a, b, c), to JSON null (d), to a
// number / a string / an array / {} (e, f: all four are the same today), and to
// the minimal valid body g. `before`: world.calls when the body is `{nope`.
// `limited`: the answer when the limiter refuses AND the body is `{nope`.
const FUNCTIONS = [
  {
    name: 'admin-create-user', seat: 'admin',
    // The first step after validation is the username lookup; the world answers a hit.
    script: (w) => {
      const base = w.tables.get('workspace_members')
      w.table('workspace_members', (q) => (q.filters.some((f) => f.column === 'username')
        ? { data: { user_id: 'someone-else' }, error: null } : base(q)))
    },
    notJson: BAD_JSON, nullBody: crash('username'),
    shapeless: r(400, { error: 'validation_failed', errors: [{ field: 'username', error: 'invalid shape' }] }),
    valid: { body: { username: 'newbie' }, answer: r(409, { error: 'username_taken' }) },
    before: ADMIN_GUARD, limited: null,
  },
  {
    name: 'admin-reset-password', seat: 'admin',
    notJson: BAD_JSON, nullBody: crash('user_id'), shapeless: userIdRequired,
    valid: { body: { user_id: 'u2' }, answer: r(404, { error: 'not_found' }) },
    before: ADMIN_GUARD, limited: null,
  },
  {
    name: 'admin-set-active', seat: 'admin',
    notJson: BAD_JSON, nullBody: crash('user_id'), shapeless: userIdRequired,
    valid: { body: { user_id: 'u2', active: false }, answer: r(404, { error: 'not_found' }) },
    before: ADMIN_GUARD, limited: null,
  },
  {
    name: 'admin-user-security', seat: 'admin',
    notJson: BAD_JSON, nullBody: crash('user_id'), shapeless: userIdRequired,
    valid: { body: { user_id: 'u2' }, answer: r(404, { error: 'not_found' }) },
    before: ADMIN_GUARD, limited: null,
  },
  {
    name: 'ai-proxy', seat: 'member', env: { ANTHROPIC_API_KEY: 'harness-platform-key' },
    notJson: BAD_JSON, nullBody: crash('model'),
    shapeless: r(400, { error: 'validation_failed', errors: [{ field: 'model', error: 'required' }] }),
    // A valid body goes upstream: the fake provider streams a small SSE back, verbatim.
    valid: {
      body: { model: 'harness-model', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] },
      answer: { status: 200, text: SSE }, fetch: 'sse',
    },
    // The large body goes upstream too; the fake provider refuses it with a 400, forwarded.
    large: {
      body: { model: 'harness-model', max_tokens: 5, messages: [{ role: 'user', content: 'x'.repeat(300000) }] },
      answer: r(400, { error: 'upstream_error', anthropic: UPSTREAM_400 }), fetch: 'error400',
    },
    before: [...MEMBER_GUARD, LIMITER], limited: r(429, { error: 'rate_limited' }),
  },
  {
    name: 'invite-member', seat: 'admin',
    notJson: BAD_JSON, nullBody: crash('email'),
    shapeless: r(400, { error: 'validation_failed', errors: [{ field: 'email', error: 'invalid shape' }, { field: 'username', error: 'invalid shape' }] }),
    // Deterministic all the way to the 201 with an unscripted world.
    valid: {
      body: { email: 'new@example.test', username: 'newbie' },
      answer: r(201, { user_id: 'invited-user-id', email: 'new@example.test', username: 'newbie', app_role: 'user', workspace_id: 'ws-1' }),
    },
    before: ADMIN_GUARD, limited: null,
  },
  {
    name: 'issue-session', seat: 'signedIn',
    // A body that is not JSON is read as {} and the oldest membership is chosen.
    notJson: r(200, { workspace_id: 'ws-1', workspace_ids: ['ws-1', 'ws-2'] }),
    nullBody: crash('workspace_id'),
    shapeless: r(200, { workspace_id: 'ws-1', workspace_ids: ['ws-1', 'ws-2'] }),
    valid: { body: { workspace_id: 'ws-2' }, answer: r(200, { workspace_id: 'ws-2', workspace_ids: ['ws-1', 'ws-2'] }) },
    before: ['auth:getUser', 'table:workspace_members', 'auth:updateUserById'], limited: null,
  },
  {
    name: 'operator-ai-keys', seat: 'operator',
    notJson: BAD_JSON, nullBody: crash('action'), shapeless: actionUnknown,
    valid: { body: { action: 'clear', workspace_id: 'ws-9' }, answer: r(404, { error: 'not_found' }) },
    before: OPERATOR_GUARD,
    // The limiter runs AFTER the body: a limited operator with a bad body is told bad_json.
    limited: BAD_JSON, limitedValid: r(429, { error: 'rate_limited' }),
  },
  {
    name: 'operator-models', seat: 'operator',
    notJson: BAD_JSON, nullBody: crash('action'), shapeless: actionUnknown,
    valid: { body: { action: 'list' }, answer: r(200, { models: [], defaults: [] }) },
    before: OPERATOR_GUARD,
    // `list` runs before the write limiter, so a limited operator still lists.
    limited: BAD_JSON, limitedValid: r(200, { models: [], defaults: [] }),
  },
  {
    name: 'operator-storage-plans', seat: 'operator',
    notJson: BAD_JSON, nullBody: crash('action'), shapeless: actionUnknown,
    valid: { body: { action: 'list' }, answer: r(200, { plans: [] }) },
    before: OPERATOR_GUARD,
    limited: BAD_JSON, limitedValid: r(200, { plans: [] }),
  },
  {
    name: 'operator-workspaces', seat: 'operator',
    notJson: BAD_JSON, nullBody: crash('action'), shapeless: actionUnknown,
    valid: { body: { action: 'list' }, answer: r(200, { workspaces: [] }) },
    before: OPERATOR_GUARD,
    // Here `list` IS limited (the operator-read bucket), after the body.
    limited: BAD_JSON, limitedValid: r(429, { error: 'rate_limited' }),
  },
  {
    name: 'resolve-login', seat: 'nobody',
    // Never refuses a body: anything that is not an object is read as {} and is a miss.
    notJson: MISS, nullBody: MISS, shapeless: MISS,
    valid: { body: { username: 'nobody' }, answer: MISS },
    large: { body: { username: 'nobody', junk: 'x'.repeat(300000) }, answer: MISS },
    before: [LIMITER, 'table:auth_attempt_log'],
    limited: r(429, { exists: false, email: null }),
  },
  {
    name: 'storage-presign', seat: 'member',
    notJson: PRESIGN_NOT_JSON, nullBody: crash('op'),
    shapeless: r(400, { error: 'bad_request', detail: 'op must be one of put, get, del, head, look' }),
    valid: {
      body: { op: 'get', path: `projects/${PROJECT_ID}/files/a.txt` },
      answer: r(403, { error: 'refused', detail: 'you cannot presign for this project' }),
    },
    before: [...MEMBER_GUARD, LIMITER],
    limited: r(429, { error: 'rate_limited', detail: 'too many presign requests — wait a minute and retry' }),
  },
  {
    name: 'storage-secret', seat: 'admin',
    notJson: PRESIGN_NOT_JSON, nullBody: crash('action'),
    shapeless: r(400, { error: 'bad_request', detail: 'action must be one of set, clear, status, probe' }),
    valid: { body: { action: 'status' }, answer: r(200, { ok: true, configured: false, keyHint: null, cryptoConfigured: false }) },
    before: [...ADMIN_GUARD, LIMITER],
    limited: r(429, { error: 'rate_limited', detail: 'too many requests — wait a minute and retry' }),
  },
]

// ── bodies ───────────────────────────────────────────────────────────────────
const enc = (s) => new TextEncoder().encode(s)
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length } return out }
/** The valid body with a junk field whose value is one byte that is not UTF-8. */
function brokenUtf8(body) {
  const [head, tail] = JSON.stringify({ ...body, junk: '@@' }).split('"@@"')
  return cat(enc(`${head}"`), new Uint8Array([0xff]), enc(`"${tail}`))
}
const withBom = (body) => cat(new Uint8Array([0xef, 0xbb, 0xbf]), enc(JSON.stringify(body)))

// ── running one ──────────────────────────────────────────────────────────────
async function setUp(fn, { limited = false } = {}) {
  const { handler } = await loadFunction(vi, fn.name, fn.env ?? {})
  const w = newWorld()
  const token = SEAT[fn.seat](w)
  fn.script?.(w)
  if (limited) w.rpc('fn_rate_limit_hit', () => ({ data: true, error: null }))
  return { w, token, handler }
}
/** The handler's whole answer, or how it crashed. */
async function outcome(handler, req) {
  let res
  try { res = await handler(req) } catch (e) { return { throws: e?.constructor?.name, message: e?.message } }
  const a = await answerOf(res)
  return a.json === undefined ? { status: a.status, text: a.text } : { status: a.status, json: a.json }
}
async function send(fn, opts, { fetch = 'none', limited = false, signedOut = false } = {}) {
  stubFetch(fetch)
  const { w, token, handler } = await setUp(fn, { limited })
  const out = await outcome(handler, post(opts.body, { token: signedOut ? null : token, raw: opts.raw }))
  return { out, w }
}
const callNames = trips

describe.each(FUNCTIONS)('$name: the body, as it is read today', (fn) => {
  it('a. no body at all', async () => {
    expect((await send(fn, {})).out).toEqual(fn.notJson)
  })
  it('b. an empty string', async () => {
    expect((await send(fn, { raw: '' })).out).toEqual(fn.notJson)
  })
  it('c. invalid JSON, and what ran before the body was read', async () => {
    const { out, w } = await send(fn, { raw: '{nope' })
    expect(out).toEqual(fn.notJson)
    expect(callNames(w)).toEqual(fn.before)
  })
  it('d. JSON null', async () => {
    expect((await send(fn, { raw: 'null' })).out).toEqual(fn.nullBody)
  })
  it.each([['a number', '5'], ['a string', '"x"'], ['an array', '[]']])('e. %s', async (_, raw) => {
    expect((await send(fn, { raw })).out).toEqual(fn.shapeless)
  })
  it('f. an empty object', async () => {
    expect((await send(fn, { body: {} })).out).toEqual(fn.shapeless)
  })
  it('g. a minimal valid body reaches the next step', async () => {
    expect((await send(fn, { body: fn.valid.body }, { fetch: fn.valid.fetch })).out).toEqual(fn.valid.answer)
  })
  it('h. a UTF-8 byte-order mark before valid JSON is stripped: the same answer as g', async () => {
    expect((await send(fn, { raw: withBom(fn.valid.body) }, { fetch: fn.valid.fetch })).out).toEqual(fn.valid.answer)
  })
  it('h. a byte that is not UTF-8 inside a string becomes U+FFFD: the same answer as g', async () => {
    expect((await send(fn, { raw: brokenUtf8(fn.valid.body) }, { fetch: fn.valid.fetch })).out).toEqual(fn.valid.answer)
  })
  it('h. bytes that are not UTF-8 and not JSON: the same answer as c', async () => {
    expect((await send(fn, { raw: new Uint8Array([0xff, 0xfe]) })).out).toEqual(fn.notJson)
  })
  if (fn.seat !== 'nobody') {
    it('order: a signed-out caller with a bad body gets the guard\'s 401, and nothing is read', async () => {
      const { out, w } = await send(fn, { raw: '{nope' }, { signedOut: true })
      expect(out).toEqual(UNAUTHORIZED)
      expect(w.calls).toEqual([])
    })
  }
  if (fn.limited) {
    it('order: a rate-limited caller with a bad body', async () => {
      const { out, w } = await send(fn, { raw: '{nope' }, { limited: true })
      expect(out).toEqual(fn.limited)
      expect(callNames(w).includes(LIMITER)).toBe(fn.before.includes(LIMITER))
    })
  }
  if (fn.limitedValid) {
    it('order: a rate-limited caller with the valid body (the limiter sits after the body)', async () => {
      expect((await send(fn, { body: fn.valid.body }, { limited: true, fetch: fn.valid.fetch })).out).toEqual(fn.limitedValid)
    })
  }
})

describe('today: no cap (F8 changes this block)', () => {
  it.each(FUNCTIONS)('i. $name reads a 300,000-character valid body whole and answers it', async (fn) => {
    const large = fn.large ?? { ...fn.valid, body: { ...fn.valid.body, padding: 'x'.repeat(300000) } }
    expect(JSON.stringify(large.body).length).toBeGreaterThan(300000)
    const { out } = await send(fn, { body: large.body }, { fetch: large.fetch })
    expect(out).toEqual(large.answer)
  })
  it('i. ai-proxy forwards the whole 300,000-character message upstream', async () => {
    const fn = FUNCTIONS.find((f) => f.name === 'ai-proxy')
    await send(fn, { body: fn.large.body }, { fetch: fn.large.fetch })
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0].url).toBe('https://api.anthropic.com/v1/messages')
    const up = JSON.parse(fetchCalls[0].init.body)
    expect(up).toEqual({ model: 'harness-model', max_tokens: 5, messages: [{ role: 'user', content: 'x'.repeat(300000) }], stream: true })
  })
})

describe('the fields of the body are used (g, looked at closer)', () => {
  const get = (name) => FUNCTIONS.find((f) => f.name === name)
  it('admin-reset-password looks the member up by the user_id it was sent', async () => {
    const { w } = await send(get('admin-reset-password'), { body: { user_id: 'u2' } })
    const lookup = w.calls.filter((c) => c.name === 'workspace_members').at(-1)
    expect(lookup.filters).toEqual([{ f: 'eq', column: 'workspace_id', value: 'ws-1' }, { f: 'eq', column: 'user_id', value: 'u2' }])
  })
  it('broken UTF-8 reaches the function as U+FFFD (admin-user-security looks up "\\uFFFD")', async () => {
    const { out, w } = await send(get('admin-user-security'), { raw: cat(enc('{"user_id":"'), new Uint8Array([0xff]), enc('"}')) })
    expect(out).toEqual(r(404, { error: 'not_found' }))
    expect(w.calls.at(-1).filters.at(-1)).toEqual({ f: 'eq', column: 'user_id', value: '�' })
  })
  it('ai-proxy sends upstream only the whitelisted fields, with stream forced on', async () => {
    const fn = get('ai-proxy')
    await send(fn, { body: { ...fn.valid.body, junk: 1, stream: false } }, { fetch: 'sse' })
    expect(JSON.parse(fetchCalls[0].init.body)).toEqual({ ...fn.valid.body, stream: true })
    expect(fetchCalls[0].init.headers['x-api-key']).toBe('harness-platform-key')
  })
  it('issue-session crashes on JSON null AFTER it has read the memberships, before any update', async () => {
    const { out, w } = await send(get('issue-session'), { raw: 'null' })
    expect(out).toEqual(crash('workspace_id'))
    expect(callNames(w)).toEqual(['auth:getUser', 'table:workspace_members'])
  })
  it('storage-presign asks the project predicate, as the caller, about the path it was sent', async () => {
    const fn = get('storage-presign')
    const { w } = await send(fn, { body: fn.valid.body })
    const pred = w.calls.find((c) => c.name === 'can_presign_object')
    expect(pred).toMatchObject({ kind: 'rpc', by: 'caller', args: { p_path: fn.valid.body.path, p_op: 'get' } })
  })
})

describe('resolve-login: a bad body is a counted, logged miss', () => {
  const fn = FUNCTIONS.find((f) => f.name === 'resolve-login')
  const limiterArgs = (w) => w.calls.filter((c) => c.name === 'fn_rate_limit_hit').map((c) => c.args)
  const logRows = (w) => w.calls.filter((c) => c.name === 'auth_attempt_log').map((c) => ({ op: c.op, values: c.values }))

  it('invalid JSON is counted against the credentials bucket, then logged as an error with no username', async () => {
    const { w } = await send(fn, { raw: '{nope' })
    expect(limiterArgs(w)).toEqual([{ p_bucket: 'resolve-login:user', p_subject: 'unknown', p_limit: 30, p_window_seconds: 60 }])
    expect(logRows(w)).toEqual([{ op: 'insert', values: { username_tried: null, outcome: 'error', ip_address: null } }])
  })
  it('a non-object JSON (an array) is read as {}: the same bucket and the same log row', async () => {
    const { w } = await send(fn, { raw: '[]' })
    expect(limiterArgs(w)).toEqual([{ p_bucket: 'resolve-login:user', p_subject: 'unknown', p_limit: 30, p_window_seconds: 60 }])
    expect(logRows(w)).toEqual([{ op: 'insert', values: { username_tried: null, outcome: 'error', ip_address: null } }])
  })
  it('a limited caller with a bad body: 429, the miss shape, logged rate_limited, nothing looked up', async () => {
    const { out, w } = await send(fn, { raw: '{nope' }, { limited: true })
    expect(out).toEqual(r(429, { exists: false, email: null }))
    expect(callNames(w)).toEqual([LIMITER, 'table:auth_attempt_log'])
    expect(logRows(w)).toEqual([{ op: 'insert', values: { outcome: 'rate_limited', ip_address: null } }])
  })
  it('the valid username body is looked up by that username, and logged not_found', async () => {
    const { w } = await send(fn, { body: { username: 'Nobody ' } })
    const q = w.calls.find((c) => c.name === 'workspace_members')
    expect(q.filters).toContainEqual({ f: 'eq', column: 'username', value: 'nobody' })
    expect(logRows(w)).toEqual([{ op: 'insert', values: { username_tried: 'nobody', outcome: 'not_found', ip_address: null } }])
  })
  it('a company body goes to the company bucket and answers the company miss', async () => {
    const { out, w } = await send(fn, { body: { company: 'Acme' } })
    expect(out).toEqual(r(200, { exists: false, slug: null, v: 2 }))
    expect(limiterArgs(w)[0].p_bucket).toBe('resolve-login:company')
  })
  it('every answer waits for the floor (about 180 ms), a bad body too', async () => {
    const t0 = Date.now()
    await send(fn, { raw: '{nope' })
    expect(Date.now() - t0).toBeGreaterThanOrEqual(170)
  })
})
