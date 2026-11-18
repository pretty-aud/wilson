// =============================================================================
// edgeFunctions.test.js — F11 item 3 (the review's shared-client A1;
// OUTSTANDING F8-06): the one Edge Function caller, through the helpers that
// keep their names and answers.
//
//   1. Each converted site sends the request it sent before: URL, method, the
//      headers, the body, keepalive (the values were recorded from the code
//      before F11 by a scratchpad harness).
//   2. Each refusal reads as before; a 413 `too_large` now has words (F8-06).
//   3. A 2xx whose body is not a JSON object is never a success.
//   4. A call past its ceiling is aborted and answers `timeout`; callAI's
//      ceiling bounds only the wait for the answer to start, never its reading.
//   5. The caller's own abort is rethrown; `ok` is read once, before `json`; a
//      bare `{ ok, json }` answer works; a stalled session read is
//      `session_stalled`, with no request sent.
// Failing controls, run before the commit against the helpers as they were
// before F11 (this file kept): sections 1 and 2's old words stay green, the
// 413 words (2), the never-a-success (3) and the ceilings (4) go red; with the
// new code, dropping `apikey` from the headers turns section 1 red.
// =============================================================================
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.test')
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')

const auth = vi.hoisted(() => ({ getSession: async () => ({ data: { session: { access_token: 'tok-1' } } }) }))
vi.mock('./auth/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: (...a) => auth.getSession(...a),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}))
vi.mock('../dev/devFixtures', () => ({ devFixtures: () => null, devWriteRefused: (l) => ({ message: `${l} refused` }) }))
const reports = vi.hoisted(() => ({ calls: [] }))
vi.mock('./errorCodes', () => ({ reportAppEvent: (e) => { reports.calls.push(e) } }))
vi.mock('../tools/rabbit_v0.1.0/storage/uploadReservation.js', () => ({ releaseStaleUploads: async () => 0 }))

const { callEdgeFunction, edgeFunctionUrl, EDGE_WORDS } = await import('./edgeFunctions.js')
const admin = await import('./adminApi.js')
const op = await import('../admin/operatorApi.js')
const ai = await import('./aiProxy.js')
const files = await import('./aiFiles.js')
const gw = await import('./gatewayApi.js')
const { cloudUrlFor } = await import('../components/settings/gatewayWords.js')

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  auth.getSession = async () => ({ data: { session: { access_token: 'tok-1' } } })
  vi.useRealTimers()
})

/** A bare answer, as the app's tests have always faked one: ok, status, json and nothing else. */
const answer = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => { if (body instanceof Error) throw body; return body },
})
const notJson = () => new SyntaxError('Unexpected token < in JSON')
/** callAI has always read the content-type first, so its answers carry one. */
const aiAnswer = (status, body) => ({ ...answer(status, body), headers: { get: () => 'application/json' } })
function record(reply) {
  const sent = []
  globalThis.fetch = vi.fn(async (url, init) => {
    sent.push({ url, init })
    return typeof reply === 'function' ? reply(url, init) : reply
  })
  return sent
}
const headersOf = (init) => ({ ...init.headers })
const AUTH = { 'content-type': 'application/json', apikey: 'anon-key', authorization: 'Bearer tok-1' }

// ── 1. the request each site sent before ─────────────────────────────────────
describe('1. each converted site sends the request it sent before', () => {
  const CASES = [
    ['adminCreateUser', () => admin.adminCreateUser({ username: 'ann', displayName: 'Ann', appRole: 'user', email: 'a@x.test', grantRateCardView: true }),
      'admin-create-user', '{"username":"ann","display_name":"Ann","app_role":"user","email":"a@x.test","grant_rate_card_view":true,"grant_rate_card_edit":false}'],
    ['adminResetPassword', () => admin.adminResetPassword('u1'), 'admin-reset-password', '{"user_id":"u1"}'],
    ['adminSetActive', () => admin.adminSetActive('u1', false), 'admin-set-active', '{"user_id":"u1","active":false}'],
    ['adminUserSecurity', () => admin.adminUserSecurity('u1'), 'admin-user-security', '{"user_id":"u1"}'],
    ['inviteMember (both invite dialogs)', () => admin.inviteMember({ email: 'e@x.test', username: 'eve', displayName: '', appRole: 'manager' }),
      'invite-member', '{"email":"e@x.test","username":"eve","display_name":null,"app_role":"manager"}'],
    ['operator listWorkspaces', () => op.listWorkspaces(), 'operator-workspaces', '{"action":"list"}'],
    ['operator teardownWorkspace', () => op.teardownWorkspace('w1', 'n'), 'operator-workspaces', '{"action":"teardown","workspace_id":"w1","confirm_slug":"n"}'],
    ['operator setPlatformDefault', () => op.setPlatformDefault({ registryKey: 'k', modelId: '', effort: '' }), 'operator-models', '{"action":"set_default","registry_key":"k","model_id":"","effort":""}'],
    ['callAI', () => ai.callAI({ model: 'm', max_tokens: 5, messages: [] }).catch(() => {}), 'ai-proxy', '{"model":"m","max_tokens":5,"messages":[]}', aiAnswer],
    ['fetchGatewayTickets', () => gw.fetchGatewayTickets('g1', ['b1', 'b2', 'b1']), 'gateway-ticket', '{"gateway_id":"g1","bin_file_ids":["b1","b2"]}'],
    ['checkGatewayReach', () => gw.checkGatewayReach('g1'), 'gateway-reach', '{"gateway_id":"g1"}'],
  ]
  for (const [label, call, fn, body, reply = answer] of CASES) {
    it(label, async () => {
      const sent = record(reply(200, { ok: true }))
      await call()
      expect(sent).toHaveLength(1)
      expect(sent[0].url).toBe(`https://proj.test/functions/v1/${fn}`)
      expect(sent[0].init.method).toBe('POST')
      expect(headersOf(sent[0].init)).toEqual(AUTH)
      expect(sent[0].init.body).toBe(body)
      expect('keepalive' in sent[0].init).toBe(false)
    })
  }

  it('uploadAIFile: multipart, the browser sets the content-type, the store gets a neutral name', async () => {
    const sent = record(answer(200, { id: 'file_abc' }))
    await files.uploadAIFile({ data: 'aGVsbG8=', filename: 'Client brief.pdf', mediaType: 'application/pdf' })
    expect(sent[0].url).toBe('https://proj.test/functions/v1/ai-files')
    expect(sent[0].init.method).toBe('POST')
    expect(headersOf(sent[0].init)).toEqual({ apikey: 'anon-key', authorization: 'Bearer tok-1' })
    const fields = [...sent[0].init.body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : v.name])
    expect(fields).toEqual([['expires_in_seconds', '86400'], ['file', 'document.pdf']])
  })
  it('the file store: a DELETE with its JSON list and keepalive, a GET with no body', async () => {
    let sent = record(answer(200, { results: [] }))
    await files.deleteAIFiles(['file_abcdefgh12'], { keepalive: true, token: 'page-tok' })
    expect(sent[0].init.method).toBe('DELETE')
    expect(headersOf(sent[0].init)).toEqual({ apikey: 'anon-key', authorization: 'Bearer page-tok', 'content-type': 'application/json' })
    expect(sent[0].init.body).toBe('{"file_ids":["file_abcdefgh12"]}')
    expect(sent[0].init.keepalive).toBe(true)
    sent = record(answer(200, { scope: 'own', files: [] }))
    await files.listAIFiles()
    expect(sent[0].init.method).toBe('GET')
    expect(headersOf(sent[0].init)).toEqual({ apikey: 'anon-key', authorization: 'Bearer tok-1' })
    expect('body' in sent[0].init).toBe(false)
    expect(sent[0].init.keepalive).toBe(false)
  })
  it('the gateway is given the same functions base the client calls', () => {
    expect(`${cloudUrlFor('https://proj.test/')}/gateway-sync`).toBe(edgeFunctionUrl('gateway-sync'))
  })
})

// ── 2. the words ─────────────────────────────────────────────────────────────
describe('2. each refusal reads as before, and a 413 has words (F8-06)', () => {
  const TOO_LARGE = { error: 'too_large', detail: 'the request is too large' }
  it('admin and operator: their own sentence, the numbered one for a code nobody words, and the 413', async () => {
    record(answer(403, { error: 'forbidden' }))
    expect((await admin.adminSetActive('u1', true)).data.friendly).toBe('Only active workspace admins can do this.')
    record(answer(409, { error: 'something_new' }))
    expect((await admin.adminSetActive('u1', true)).data.friendly).toBe('Request failed (409).')
    record(answer(502, notJson()))
    expect(await admin.adminSetActive('u1', true)).toEqual({ ok: false, status: 502, data: { friendly: 'Request failed (502).' } })
    record(answer(409, { error: 'slug_taken' }))
    expect((await op.renameWorkspace('w1', 'N')).data.friendly).toBe('That slug is already in use by another company.')
    record(answer(413, TOO_LARGE))
    expect((await admin.adminCreateUser({ username: 'a', appRole: 'user' })).data.friendly).toBe(EDGE_WORDS.too_large)
    record(answer(413, TOO_LARGE))
    expect((await op.createWorkspace({ name: 'N', slug: 'n', adminUsername: 'a' })).data.friendly).toBe(EDGE_WORDS.too_large)
    expect(EDGE_WORDS.too_large).not.toMatch(/\(413\)/)
  })
  it('a network failure reads as it always did', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    expect(await admin.adminUserSecurity('u1')).toEqual({ ok: false, status: 0, data: { error: 'network', friendly: 'Network error — check your connection.' } })
    expect((await op.listModels()).data.friendly).toBe('Network error — check your connection.')
  })
  it('the invite: its words for its codes, the numbered sentence otherwise, the 413', async () => {
    record(answer(409, { error: 'username_taken' }))
    expect((await admin.inviteMember({ email: 'e@x.test', username: 'eve', appRole: 'user' })).data.friendly).toBe('That username is already in use in this workspace.')
    record(answer(422, { error: 'brand_new_code' }))
    expect((await admin.inviteMember({ email: 'e@x.test', username: 'eve', appRole: 'user' })).data.friendly).toBe('Invite failed (422).')
    record(answer(413, TOO_LARGE))
    expect((await admin.inviteMember({ email: 'e@x.test', username: 'eve', appRole: 'user' })).data.friendly).toBe(EDGE_WORDS.too_large)
    auth.getSession = async () => ({ data: { session: null } })
    const f = record(answer(201, {}))
    expect((await admin.inviteMember({ email: 'e@x.test', username: 'eve', appRole: 'user' })).data.friendly).toBe('Session expired — sign in again.')
    expect(f).toHaveLength(0)
  })
  it('the AI: the upstream message first, its own words, and its own words for the 413', async () => {
    record(aiAnswer(529, { anthropic: { error: { message: 'Overloaded' } } }))
    await expect(ai.callAI({})).rejects.toMatchObject({ message: 'Overloaded', status: 529 })
    record(aiAnswer(429, { error: 'rate_limited' }))
    await expect(ai.callAI({})).rejects.toMatchObject({ message: 'Too many AI requests at once — retrying shortly.', code: 'rate_limited' })
    record(aiAnswer(413, TOO_LARGE))
    const err = await ai.callAI({}).catch((e) => e)
    expect(err).toMatchObject({ name: 'AIProxyError', status: 413, code: 'too_large' })
    expect(err.message).toMatch(/too large for WILSON’s AI relay/)
    expect(ai.isRetryableAIError(err)).toBe(false)
  })
  it('the upload and the file store: their words, their numbered sentences, and the 413', async () => {
    record(answer(409, { error: 'odd' }))
    await expect(files.uploadAIFile({ data: 'aGk=', mediaType: 'text/plain' })).rejects.toMatchObject({ message: 'File upload failed (409).' })
    record(answer(413, TOO_LARGE))
    await expect(files.uploadAIFile({ data: 'aGk=', mediaType: 'text/plain' })).rejects.toMatchObject({ message: EDGE_WORDS.too_large, status: 413 })
    record(answer(429, { error: 'rate_limited' }))
    await expect(files.listAIFiles()).rejects.toMatchObject({ message: 'Too many requests to the AI’s file store — try again in a minute.' })
    record(answer(409, { error: 'odd' }))
    await expect(files.listAIFiles()).rejects.toMatchObject({ message: 'The AI’s file store refused (409).' })
  })
  it('the gateway: the function\'s detail, else its own sentence', async () => {
    record(answer(409, { error: 'busy', detail: 'A check is running.' }))
    expect(await gw.checkGatewayReach('g1')).toEqual({ ok: false, status: 409, code: 'busy', friendly: 'A check is running.' })
    record(answer(502, notJson()))
    expect(await gw.fetchGatewayTickets('g1', ['b1'])).toEqual({ ok: false, status: 502, code: 'http_502', friendly: 'WILSON could not get a ticket to play this clip just now. Try again in a moment.' })
  })
})

// ── 3. never a success ───────────────────────────────────────────────────────
describe('3. a 2xx that is not a JSON object is never a success', () => {
  it('admin, operator and the invite answer not ok, in words', async () => {
    record(answer(200, notJson()))
    expect(await admin.adminSetActive('u1', true)).toEqual({ ok: false, status: 200, data: { error: 'bad_answer', friendly: EDGE_WORDS.bad_answer } })
    record(answer(200, notJson()))
    expect((await op.setWorkspaceSuspended('w1', true)).ok).toBe(false)
    record(answer(201, notJson()))
    expect((await admin.inviteMember({ email: 'e@x.test', username: 'eve', appRole: 'user' })).ok).toBe(false)
  })
  it('the caller itself: a throwing json(), an array and null are bad_answer', async () => {
    for (const body of [notJson(), [1, 2], null]) {
      record(answer(200, body))
      expect(await callEdgeFunction('x', {})).toMatchObject({ ok: false, status: 200, code: 'bad_answer' })
    }
  })
})

// ── 4. the ceilings ──────────────────────────────────────────────────────────
function hanging() {
  const seen = {}
  globalThis.fetch = vi.fn((url, init) => new Promise((_, reject) => {
    seen.signal = init.signal
    init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
  }))
  return seen
}
const settle = (p) => { const s = { done: false }; p.then((v) => { s.done = true; s.value = v }, (e) => { s.done = true; s.error = e }); return s }

describe('4. a call past its ceiling is aborted and answers timeout', () => {
  it('an admin write: 60 s, then the timeout words (it may have gone through)', async () => {
    vi.useFakeTimers()
    const seen = hanging()
    const s = settle(admin.adminSetActive('u1', false))
    await vi.advanceTimersByTimeAsync(59_000)
    expect(s.done).toBe(false)
    await vi.advanceTimersByTimeAsync(1_500)
    expect(seen.signal.aborted).toBe(true)
    expect(s.value).toEqual({ ok: false, status: 0, data: { error: 'timeout', friendly: EDGE_WORDS.timeout } })
  })
  it('the gateway keeps its 15 s and words a timeout as the network, as before', async () => {
    vi.useFakeTimers()
    hanging()
    const s = settle(gw.fetchGatewayTickets('g1', ['b1']))
    await vi.advanceTimersByTimeAsync(15_500)
    expect(s.value).toEqual({ ok: false, status: 0, code: 'network', friendly: 'WILSON could not reach the cloud. Check the connection and try again.' })
  })
  it('the AI: ten minutes to the START of the answer, then its own timeout words, not retried', async () => {
    vi.useFakeTimers()
    const seen = hanging()
    const s = settle(ai.callAI({}))
    await vi.advanceTimersByTimeAsync(599_000)
    expect(s.done).toBe(false)
    await vi.advanceTimersByTimeAsync(1_500)
    expect(seen.signal.aborted).toBe(true)
    expect(s.error).toMatchObject({ name: 'AIProxyError', code: 'timeout', status: 0 })
    expect(ai.isRetryableAIError(s.error)).toBe(false)
  })
  it('🚨 the AI: once the answer has started, a long answer is never cut short by the ceiling', async () => {
    vi.useFakeTimers()
    const enc = new TextEncoder()
    let push
    const stream = new ReadableStream({ start(c) { push = c } })
    let signal
    globalThis.fetch = vi.fn(async (url, init) => {
      signal = init.signal
      return { ok: true, status: 200, headers: { get: () => 'text/event-stream' }, body: stream }
    })
    const s = settle(ai.callAI({}))
    await vi.advanceTimersByTimeAsync(1)
    const ev = (e) => enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
    push.enqueue(ev({ type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } }))
    await vi.advanceTimersByTimeAsync(11 * 60_000)
    expect(signal?.aborted ?? false).toBe(false)
    push.enqueue(ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }))
    push.enqueue(ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'a long answer' } }))
    push.enqueue(ev({ type: 'content_block_stop', index: 0 }))
    push.enqueue(ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } }))
    push.enqueue(ev({ type: 'message_stop' }))
    push.close()
    await vi.advanceTimersByTimeAsync(1)
    expect(s.error).toBeUndefined()
    expect(s.value.content).toEqual([{ type: 'text', text: 'a long answer' }])
  })
  it('the caller\'s own stop still stops a stream after it has started', async () => {
    const ctl = new AbortController()
    let signal
    globalThis.fetch = vi.fn(async (url, init) => { signal = init.signal; return { ok: true, status: 200, headers: { get: () => 'text/event-stream' }, body: new ReadableStream() } })
    const r = await callEdgeFunction('ai-proxy', {}, { signal: ctl.signal, timeoutMs: 600_000, raw: true })
    expect(r.ok).toBe(true)
    ctl.abort()
    expect(signal.aborted).toBe(true)
  })
})

// ── 4b. every ceiling, at its edges (review round 1, 1C and 1D) ──────────────
// Failing controls: any of these figures lowered (OPERATOR_MS = 60000, say) turns its row red at the "not yet" check;
// a ceiling removed turns it red at the "aborted" check.
describe('4b. each ceiling ends a dead call at its own figure, never before', () => {
  const ROWS = [
    ['an admin read (security posture), 15 s', () => admin.adminUserSecurity('u1'), 15_000],
    ['an invite, 60 s', () => admin.inviteMember({ email: 'e@x.test', username: 'eve', appRole: 'user' }), 60_000],
    ['an operator call (a teardown runs long), 420 s', () => op.teardownWorkspace('w1', 'n'), 420_000],
    ['the upload, 600 s', () => files.uploadAIFile({ data: 'aGk=', mediaType: 'text/plain' }), 600_000],
    ['the file store list, 15 s', () => files.listAIFiles(), 15_000],
    ['the file store sweep, 120 s', () => files.sweepAIFiles(), 120_000],
    ['the gateway reach check, 30 s', () => gw.checkGatewayReach('g1'), 30_000],
  ]
  for (const [label, call, ms] of ROWS) {
    it(label, async () => {
      vi.useFakeTimers()
      const seen = hanging()
      const s = settle(call())
      await vi.advanceTimersByTimeAsync(ms - 1_000)
      expect(s.done, 'not yet').toBe(false)
      expect(seen.signal.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1_500)
      expect(seen.signal.aborted, 'aborted at the ceiling').toBe(true)
      expect(s.done).toBe(true)
    })
  }
  it('the session read: not given up before 15 s, given up just after', async () => {
    vi.useFakeTimers()
    auth.getSession = () => new Promise(() => {})
    const s = settle(callEdgeFunction('x', {}))
    await vi.advanceTimersByTimeAsync(14_000)
    expect(s.done).toBe(false)
    await vi.advanceTimersByTimeAsync(1_500)
    expect(s.value).toMatchObject({ code: 'session_stalled' })
  })
  it('a ceiling reached while the answer\'s body is read is a timeout, never bad_answer', async () => {
    vi.useFakeTimers()
    globalThis.fetch = vi.fn(async (url, init) => ({ ok: true, status: 200, json: () => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))) }))
    const s = settle(callEdgeFunction('x', {}, { timeoutMs: 15_000 }))
    await vi.advanceTimersByTimeAsync(15_500)
    expect(s.value).toMatchObject({ ok: false, status: 0, code: 'timeout' })
  })
})

describe('4c. the reports to app_events, as before (WIL-4201, WIL-4202)', () => {
  it('a 5xx, the last admin and no answer are each reported with their context', async () => {
    reports.calls = []
    record(answer(500, { error: 'update_failed' }))
    await admin.adminSetActive('u1', true)
    record(answer(409, { error: 'last_admin' }))
    await admin.adminSetActive('u1', false)
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    await admin.adminSetActive('u1', true)
    expect(reports.calls.map((e) => [e.code, e.context])).toEqual([
      ['WIL-4201', { fn: 'admin-set-active', error: 'update_failed' }],
      ['WIL-4202', { fn: 'admin-set-active' }],
      ['WIL-4201', { fn: 'admin-set-active', error: 'network' }],
    ])
  })
  it('the AI words a bare 413 too; an unreadable 2xx says to check before trying again', async () => {
    record(aiAnswer(413, notJson()))
    await expect(ai.callAI({})).rejects.toMatchObject({ code: 'http_413', message: expect.stringMatching(/too large for WILSON’s AI relay/) })
    expect(EDGE_WORDS.bad_answer).toMatch(/check before trying again/)
  })
})

// ── 5. the rules every call keeps ────────────────────────────────────────────
describe('5. the caller\'s rules', () => {
  it('the caller\'s own abort is rethrown as fetch reported it, never worded', async () => {
    const ctl = new AbortController()
    globalThis.fetch = vi.fn(async () => { ctl.abort(); throw new DOMException('The operation was aborted.', 'AbortError') })
    await expect(callEdgeFunction('x', {}, { signal: ctl.signal, timeoutMs: 1000 })).rejects.toMatchObject({ name: 'AbortError' })
    await expect(ai.callAI({}, { signal: ctl.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('`ok` is read once, before the body; the body once', async () => {
    const order = []
    globalThis.fetch = vi.fn(async () => ({ get ok() { order.push('ok'); return true }, status: 200, async json() { order.push('json'); return { a: 1 } } }))
    expect(await callEdgeFunction('x', { b: 2 })).toEqual({ ok: true, status: 200, data: { a: 1 } })
    expect(order).toEqual(['ok', 'json'])
  })
  it('a bare `{ ok, json }` answer, with no status and no headers, works', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ a: 1 }) }))
    expect(await callEdgeFunction('x', {})).toEqual({ ok: true, status: undefined, data: { a: 1 } })
  })
  it('a session read that stalls is session_stalled within the bound, and nothing is sent', async () => {
    vi.useFakeTimers()
    auth.getSession = () => new Promise(() => {})
    const f = record(answer(200, {}))
    const s = settle(callEdgeFunction('x', {}))
    await vi.advanceTimersByTimeAsync(15_500)
    expect(s.value).toMatchObject({ ok: false, status: 0, code: 'session_stalled', words: EDGE_WORDS.session_stalled })
    expect(f).toHaveLength(0)
  })
  it('a caller\'s abort is an AbortError in every phase, whatever reason was given (1D)', async () => {
    const ctl = new AbortController()
    globalThis.fetch = vi.fn(async (url, init) => ({ ok: true, status: 200, json: () => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))) }))
    const p = callEdgeFunction('x', {}, { signal: ctl.signal, timeoutMs: 60_000 })
    await new Promise((r) => setTimeout(r, 0))
    ctl.abort('stop-string')
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    // Already aborted before the call: fetch is handed an aborted signal and nothing is answered.
    const done = new AbortController()
    done.abort()
    globalThis.fetch = vi.fn(async (url, init) => { if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError'); return answer(200, {}) })
    await expect(callEdgeFunction('x', {}, { signal: done.signal, timeoutMs: 60_000 })).rejects.toMatchObject({ name: 'AbortError' })
    expect(globalThis.fetch.mock.calls[0][1].signal.aborted, 'the request itself was stopped').toBe(true)
  })
  it('anonymous calls carry the apikey alone; a given token is used without a session read', async () => {
    auth.getSession = vi.fn(async () => ({ data: { session: { access_token: 'tok-1' } } }))
    let sent = record(answer(200, { exists: false }))
    await callEdgeFunction('resolve-login', { username: 'a' }, { anon: true })
    expect(headersOf(sent[0].init)).toEqual({ 'content-type': 'application/json', apikey: 'anon-key' })
    sent = record(answer(200, {}))
    await callEdgeFunction('issue-session', {}, { token: 'fresh' })
    expect(headersOf(sent[0].init).authorization).toBe('Bearer fresh')
    expect(auth.getSession).not.toHaveBeenCalled()
  })
})
