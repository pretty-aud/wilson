// =============================================================================
// storageApiProbe.test.js — presignStorage's `{ token, signal }` (post-overhaul
// FX11). R.A.B.B.I.T.'s connection dot asks a company bucket through the
// presign function with the access token of the latest auth EVENT and its own
// abort signal: given a token, the call never reaches getSession() — an
// abandoned getSession() keeps auth-js's global lock (review round 1, R1-12:
// the rule-3 test scanned connectionStatus.js only, and callStorageFn fell
// back to getSession whenever the token was falsy). Every other caller passes
// nothing and is unchanged.
// =============================================================================
import { describe, it, expect, vi, afterEach } from 'vitest'

const auth = vi.hoisted(() => ({ getSession: null }))
vi.mock('./auth/supabaseClient', () => ({
  supabase: { auth: { getSession: (auth.getSession = vi.fn(async () => ({ data: { session: { access_token: 'from-getSession' } } }))) } },
}))
vi.mock('../tools/rabbit_v0.1.0/storage/uploadReservation.js', () => ({ releaseStaleUploads: vi.fn() }))

// eslint-disable-next-line import/first
import { presignStorage, presignReadUrls } from './storageApi'

afterEach(() => { vi.unstubAllGlobals(); auth.getSession.mockClear() })

describe('presignStorage(op, path, { token, signal })', () => {
  it('with a token: never calls getSession, sends that token, and passes the signal to fetch', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ url: 'https://bucket.example/s' }) }))
    vi.stubGlobal('fetch', fetchFn)
    const ctl = new AbortController()
    await expect(presignStorage('head', 'projects/p/x/y', { token: 'event-token', signal: ctl.signal })).resolves.toEqual({ url: 'https://bucket.example/s' })
    expect(auth.getSession).not.toHaveBeenCalled()
    const [, init] = fetchFn.mock.calls[0]
    expect(init.headers.authorization).toBe('Bearer event-token')
    expect(init.signal).toBe(ctl.signal)
    expect(JSON.parse(init.body)).toEqual({ op: 'head', path: 'projects/p/x/y' })
  })
  it('without one: the session\'s token, as every other caller has always had it', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ url: 'u' }) }))
    vi.stubGlobal('fetch', fetchFn)
    await presignStorage('get', 'projects/p/x/y')
    expect(auth.getSession).toHaveBeenCalledTimes(1)
    expect(fetchFn.mock.calls[0][1].headers.authorization).toBe('Bearer from-getSession')
    expect(fetchFn.mock.calls[0][1].signal).toBeUndefined()
  })
  it('a refusal throws with its status on the error; an abort rethrows the AbortError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ detail: 'you cannot presign for this project' }) })))
    await expect(presignStorage('head', 'projects/p/x/y', { token: 't' })).rejects.toMatchObject({ status: 403, message: '[s3] you cannot presign for this project' })
    const ctl = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async (_u, init) => { ctl.abort(); throw Object.assign(new Error('aborted'), { name: 'AbortError', signal: init.signal }) }))
    await expect(presignStorage('head', 'projects/p/x/y', { token: 't', signal: ctl.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})

// P1 (night 4): presignReadUrls, the binding for storage-read-urls — the only
// caller of the read signer, and so the one place a money key is stopped
// before it is ever sent (NETWORK_STORAGE_DESIGN.md §9.3).
describe('presignReadUrls(keys, { stream })', () => {
  const P = 'aaaa1111-0000-0000-0000-000000000001'
  const ok = (urls = {}, refused = {}) => vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, urls, expires: {}, refused }) }))

  it('🚨 never sends a money key: it is answered here as refused money', async () => {
    const fetchFn = ok({ [`projects/${P}/assets/a/1-x.png.jpg`]: 'https://b/x' })
    vi.stubGlobal('fetch', fetchFn)
    const money = [`projects/${P}/INVOICES/i/1-a.pdf.jpg`, `projects/${P}/legal/l/1-b.pdf`, `projects/${P}/Finance/RATES.json`]
    const res = await presignReadUrls([...money, `projects/${P}/assets/a/1-x.png.jpg`], { token: 't' })
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({ keys: [`projects/${P}/assets/a/1-x.png.jpg`] })
    expect(res.refused).toEqual(Object.fromEntries(money.map((k) => [k, 'money'])))
  })

  it('only money keys: nothing is sent at all', async () => {
    const fetchFn = ok()
    vi.stubGlobal('fetch', fetchFn)
    const res = await presignReadUrls([`projects/${P}/INVOICES/i/1-a.pdf`], { token: 't' })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(res).toEqual({ urls: {}, expires: {}, refused: { [`projects/${P}/INVOICES/i/1-a.pdf`]: 'money' } })
  })

  it('sends stream only when asked, and throws a whole-call refusal with its sentence and status', async () => {
    const fetchFn = ok({ k: 'u' })
    vi.stubGlobal('fetch', fetchFn)
    await presignReadUrls([`projects/${P}/assets/a/1-cut.mov`], { stream: true, token: 't' })
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({ keys: [`projects/${P}/assets/a/1-cut.mov`], stream: true })
    expect(fetchFn.mock.calls[0][0]).toMatch(/\/functions\/v1\/storage-read-urls$/)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: 'refused', detail: 'this workspace has no S3-compatible storage configured' }) })))
    const err = await presignReadUrls([`projects/${P}/assets/a/1-x.png`], { token: 't' }).catch((e) => e)
    expect(err.message).toBe('[s3] this workspace has no S3-compatible storage configured')
    expect(err.status).toBe(409)
  })
})
