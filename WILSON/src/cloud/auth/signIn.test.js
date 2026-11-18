// =============================================================================
// signIn.test.js — F11 item 4 (the review's shared-client A2): the sign-in's
// steps, written once. Each function's answers for a hit, a miss, a 429, a
// refusal, no answer, an unreadable answer and a stall; the requests are the
// ones the screens sent (resolve-login with and without the company, the
// company step, issue-session with the caller's token); every await bounded.
// Failing controls: dropping `workspace_slug` from resolveLogin's body turns
// the company test red; an unbounded mfaStepNeeded turns the stall test red.
// =============================================================================
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.test')
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')

const sb = vi.hoisted(() => ({ auth: null }))
vi.mock('./supabaseClient', () => ({ supabase: { auth: new Proxy({}, { get: (_, k) => sb.auth[k] }) } }))

const { resolveLogin, verifyCompany, issueSession, mfaStepNeeded, verifyTotp } = await import('./signIn.js')

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch; vi.useRealTimers() })

const answer = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => { if (body instanceof Error) throw body; return body } })
function serve(reply) {
  const sent = []
  globalThis.fetch = vi.fn(async (url, init) => { sent.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined }); return typeof reply === 'function' ? reply(sent.at(-1)) : reply })
  return sent
}
const never = () => { globalThis.fetch = vi.fn((url, init) => new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) }

describe('resolveLogin(username, slug)', () => {
  it('sends the username within the company, anonymously, as the login did', async () => {
    const sent = serve(answer(200, { exists: true, email: 'ann@petal.test' }))
    expect(await resolveLogin('ann', 'petal')).toEqual({ exists: true, email: 'ann@petal.test', limited: false })
    expect(sent[0].url).toBe('https://proj.test/functions/v1/resolve-login')
    expect(sent[0].body).toEqual({ username: 'ann', workspace_slug: 'petal' })
    expect({ ...sent[0].init.headers }).toEqual({ 'content-type': 'application/json', apikey: 'anon-key' })
  })
  it('without a company it sends the username alone', async () => {
    const sent = serve(answer(200, { exists: false, email: null }))
    await resolveLogin('ann')
    expect(sent[0].body).toEqual({ username: 'ann' })
  })
  it('a miss, a refusal and the 413 are the miss; a 429 is limited', async () => {
    serve(answer(200, { exists: false, email: null }))
    expect(await resolveLogin('x', 'p')).toEqual({ exists: false, email: null, limited: false })
    serve(answer(500, { exists: false, email: null }))
    expect(await resolveLogin('x', 'p')).toEqual({ exists: false, email: null })
    serve(answer(413, { exists: false, email: null }))
    expect(await resolveLogin('x', 'p')).toEqual({ exists: false, email: null })
    serve(answer(429, { exists: false, email: null }))
    expect(await resolveLogin('x', 'p')).toEqual({ limited: true, exists: false, email: null })
  })
  it('no answer and an unreadable answer throw, as the screens\' own fetch did; a stall is a TimeoutError', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    await expect(resolveLogin('x', 'p')).rejects.not.toMatchObject({ name: 'TimeoutError' })
    serve(answer(200, new SyntaxError('not json')))
    await expect(resolveLogin('x', 'p')).rejects.toBeTruthy()
    vi.useFakeTimers()
    never()
    const p = resolveLogin('x', 'p').catch((e) => e)
    await vi.advanceTimersByTimeAsync(15_500)
    expect(await p).toMatchObject({ name: 'TimeoutError' })
  })
})

describe('verifyCompany(company): never throws', () => {
  it('contract v2: exists and the canonical slug', async () => {
    const sent = serve(answer(200, { exists: true, slug: 'petal', v: 2 }))
    expect(await verifyCompany('Petal Studios')).toEqual({ unavailable: false, exists: true, slug: 'petal' })
    expect(sent[0].body).toEqual({ company: 'Petal Studios' })
  })
  it('a 429 is limited, never "not deployed"; an old contract, a refusal, no answer and a stall are unavailable', async () => {
    serve(answer(429, { exists: false, slug: null, v: 2 }))
    expect(await verifyCompany('P')).toEqual({ unavailable: false, limited: true, exists: false, slug: null })
    serve(answer(200, { exists: false }))
    expect(await verifyCompany('P')).toEqual({ unavailable: true })
    serve(answer(500, {}))
    expect(await verifyCompany('P')).toEqual({ unavailable: true })
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    expect(await verifyCompany('P')).toEqual({ unavailable: true })
    vi.useFakeTimers()
    never()
    const p = verifyCompany('P')
    await vi.advanceTimersByTimeAsync(15_500)
    expect(await p).toEqual({ unavailable: true })
  })
})

describe('issueSession(accessToken, workspaceId)', () => {
  it('posts the workspace with the caller\'s own token, and reads no session', async () => {
    sb.auth = { getSession: vi.fn() }
    const sent = serve(answer(200, { ok: true }))
    expect(await issueSession('fresh', 'w2')).toEqual({ ok: true, data: { ok: true } })
    expect(sent[0].url).toBe('https://proj.test/functions/v1/issue-session')
    expect(sent[0].body).toEqual({ workspace_id: 'w2' })
    expect(sent[0].init.headers.authorization).toBe('Bearer fresh')
    expect(sb.auth.getSession).not.toHaveBeenCalled()
    serve(answer(200, {}))
    await issueSession('fresh', null)
  })
  it('a refusal is answered, not thrown; a stall throws TimeoutError; no answer throws', async () => {
    serve(answer(403, { error: 'forbidden' }))
    expect(await issueSession('t', 'w')).toEqual({ ok: false, status: 403, code: 'forbidden' })
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    await expect(issueSession('t', 'w')).rejects.toBeTruthy()
    vi.useFakeTimers()
    never()
    const p = issueSession('t', 'w').catch((e) => e)
    await vi.advanceTimersByTimeAsync(15_500)
    expect(await p).toMatchObject({ name: 'TimeoutError' })
  })
})

describe('the second factor', () => {
  const factors = (totp) => ({ data: { totp }, error: null })
  it('mfaStepNeeded: the verified factor when the session needs aal2; null when it does not', async () => {
    sb.auth = { mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal2' } }), listFactors: async () => factors([{ id: 'f0', status: 'unverified' }, { id: 'f1', status: 'verified' }]) } }
    expect(await mfaStepNeeded()).toEqual({ factorId: 'f1' })
    const listFactors = vi.fn()
    sb.auth = { mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal2', nextLevel: 'aal2' } }), listFactors } }
    expect(await mfaStepNeeded()).toBeNull()
    expect(listFactors).not.toHaveBeenCalled()
    sb.auth = { mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal2' } }), listFactors: async () => factors([]) } }
    expect(await mfaStepNeeded()).toBeNull()
  })
  it('🚨 mfaStepNeeded: a stalled read is a TimeoutError within the bound (it hung before F11)', async () => {
    vi.useFakeTimers()
    sb.auth = { mfa: { getAuthenticatorAssuranceLevel: () => new Promise(() => {}) } }
    const p = mfaStepNeeded().catch((e) => e)
    await vi.advanceTimersByTimeAsync(15_500)
    expect(await p).toMatchObject({ name: 'TimeoutError' })
  })
  it('verifyTotp: a wrong code is rejected; a right one answers verify()\'s own session, without a session read', async () => {
    const getSession = vi.fn(async () => ({ data: { session: { access_token: 'from-read' } } }))
    sb.auth = { getSession, mfa: { challenge: async () => ({ data: { id: 'c1' }, error: null }), verify: async ({ code }) => (code === '123456' ? { data: { access_token: 'aal2' }, error: null } : { data: null, error: { message: 'bad' } }) } }
    expect(await verifyTotp('f1', '000000')).toEqual({ rejected: true })
    expect(await verifyTotp('f1', '123456')).toEqual({ rejected: false, session: { access_token: 'aal2' } })
    expect(getSession).not.toHaveBeenCalled()
  })
  it('verifyTotp: an auth-js that returns no session falls back to one bounded read; the enrol panel asks for none', async () => {
    const getSession = vi.fn(async () => ({ data: { session: { access_token: 'from-read' } } }))
    sb.auth = { getSession, mfa: { challenge: async () => ({ data: { id: 'c1' }, error: null }), verify: async () => ({ data: {}, error: null }) } }
    expect(await verifyTotp('f1', '123456')).toEqual({ rejected: false, session: { access_token: 'from-read' } })
    expect(await verifyTotp('f1', '123456', { session: false })).toEqual({ rejected: false, session: null })
    expect(getSession).toHaveBeenCalledTimes(1)
  })
  it('verifyTotp: a failed challenge throws; a stalled verify is a TimeoutError', async () => {
    sb.auth = { mfa: { challenge: async () => ({ data: null, error: new Error('no challenge') }) } }
    await expect(verifyTotp('f1', '123456')).rejects.toThrow('no challenge')
    vi.useFakeTimers()
    sb.auth = { mfa: { challenge: async () => ({ data: { id: 'c1' }, error: null }), verify: () => new Promise(() => {}) } }
    const p = verifyTotp('f1', '123456').catch((e) => e)
    await vi.advanceTimersByTimeAsync(15_500)
    expect(await p).toMatchObject({ name: 'TimeoutError' })
  })
})
