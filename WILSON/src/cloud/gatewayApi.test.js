// =============================================================================
// gatewayApi.test.js — GW1 (2026-10-10): the web app's calls for the file
// gateway, against a fake Supabase client and a fake fetch.
//
// What this pins:
//   * every read and write runs through the caller's own client (no service
//     key exists here), and the admin's read names the columns the card shows
//     and none the grants leave out (the root's PEM, the reach nonce);
//   * a forgotten gateway stays in the admin's list for its minute of undo;
//   * the 0093 RPCs' sentences reach the person as written; a grant's
//     "permission denied" and an RLS refusal become the admin-only sentence;
//     an update that touched no row is a sentence, not a silent success;
//   * the token and the certificate are checked for their shape before the
//     card shows them;
//   * gateway-reach: no session, no request; `res.ok` is read BEFORE any
//     body (the brief's rule: fetch resolves for every status); a refusal's
//     own sentence is shown; a body in an unknown shape is refused;
//   * dev fixtures answer every call when they are on, and nothing reaches
//     the client then.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const holder = vi.hoisted(() => ({ sb: null, fx: null }))
vi.mock('./auth/supabaseClient', () => ({ get supabase() { return holder.sb } }))
vi.mock('../dev/devFixtures', () => ({ devFixtures: () => holder.fx }))

vi.stubEnv('VITE_SUPABASE_URL', 'https://abc.supabase.co')
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-for-tests')
const api = await import('./gatewayApi')

// A chainable PostgREST stand-in: every method records itself and returns
// the builder; awaiting it gives the queued answer.
function fakeClient(answers) {
  const log = []
  const queue = [...answers]
  const builder = () => {
    const result = queue.shift() ?? { data: null, error: null }
    const b = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') return (res, rej) => Promise.resolve(result).then(res, rej)
        return (...args) => { log.push([prop, ...args]); return b }
      },
    })
    return b
  }
  return {
    log,
    from: (t) => { log.push(['from', t]); return builder() },
    rpc: (name, args) => { log.push(['rpc', name, args]); return builder() },
    auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'user-jwt' } } })) },
  }
}

beforeEach(() => { holder.fx = null })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('reads, as the caller', () => {
  it('an admin reads the table: the card\'s columns, never the PEM or the nonce; a forgotten one stays for its minute', async () => {
    holder.sb = fakeClient([{ data: [{ id: 'g1' }], error: null }])
    const now = Date.parse('2026-10-10T12:00:00Z')
    const res = await api.listGateways({ admin: true, now })
    expect(res).toEqual({ ok: true, data: [{ id: 'g1' }], count: undefined })
    const [from, select, or] = holder.sb.log
    expect(from).toEqual(['from', 'gateways'])
    expect(select[1]).toContain('root_fingerprint')
    expect(select[1]).toContain('health')
    for (const hidden of ['root_cert_pem', 'reach_nonce', 'reach_nonce_at', 'reach_nonce_delivered_at', 'update_check_delivered_at', 'last_sync_source']) {
      expect(select[1].split(', ')).not.toContain(hidden)
    }
    expect(or).toEqual(['or', 'revoked_at.is.null,revoked_at.gt.2026-10-10T11:59:00.000Z'])
  })

  it('anyone else reads the view\'s name, version and last-seen, and nothing from the table', async () => {
    holder.sb = fakeClient([{ data: [], error: null }])
    await api.listGateways({ admin: false })
    expect(holder.sb.log[0]).toEqual(['from', 'gateways_visible'])
    expect(holder.sb.log[1]).toEqual(['select', 'id, name, platform, version, last_seen_at'])
    expect(holder.sb.log.some(([, t]) => t === 'gateways')).toBe(false)
  })

  it('the viewings: viewed_remote only, last 30 days, newest first, paged, with the project titles', async () => {
    holder.sb = fakeClient([
      { data: [{ id: 7, project_id: 'p1', details: {} }, { id: 6, project_id: 'p2', details: {} }], error: null, count: 61 },
      { data: [{ id: 'p1', title: 'Salt Hours' }], error: null },
    ])
    const now = Date.parse('2026-10-10T12:00:00Z')
    const res = await api.listRemoteViewings({ page: 2, pageSize: 25, now })
    expect(res.ok).toBe(true)
    expect(res.data.total).toBe(61)
    expect(res.data.rows.map(r => r.project_title)).toEqual(['Salt Hours', null])
    const log = holder.sb.log
    expect(log).toContainEqual(['eq', 'event', 'viewed_remote'])
    expect(log).toContainEqual(['gte', 'created_at', '2026-09-10T12:00:00.000Z'])
    expect(log).toContainEqual(['order', 'created_at', { ascending: false }])
    expect(log).toContainEqual(['range', 50, 74])
    expect(log).toContainEqual(['in', 'id', ['p1', 'p2']])
  })

  it('a failed read is a sentence, never a throw', async () => {
    holder.sb = { from: () => { throw new Error('socket hang up') } }
    const res = await api.listGatewayAudit()
    expect(res).toEqual({ ok: false, code: 'network', friendly: 'WILSON could not reach the cloud. Check the connection and try again.' })
  })
})

describe('the refusals a person reads', () => {
  it('an RPC\'s own sentence is shown as written', async () => {
    const said = 'This company already has five unused gateway tokens. Cancel one before making another.'
    holder.sb = fakeClient([{ data: null, error: { code: '54000', message: said } }])
    expect(await api.makeEnrolmentToken()).toEqual({ ok: false, code: '54000', friendly: said })
  })

  it('a grant\'s or a policy\'s technical refusal becomes the admin-only sentence', async () => {
    holder.sb = fakeClient([{ data: null, error: { code: '42501', message: 'permission denied for table gateways' } }])
    expect((await api.listGateways({ admin: true })).friendly).toBe('Only a workspace admin can add or change the file gateway.')
    holder.sb = fakeClient([{ data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "gateways"' } }])
    expect((await api.renameGateway('g1', 'x')).friendly).toBe('Only a workspace admin can add or change the file gateway.')
    // CONTROL: the RPC's own 42501 sentence is kept.
    holder.sb = fakeClient([{ data: null, error: { code: '42501', message: 'Only the admin who made this gateway\'s enrolment token can confirm its fingerprint: they are the one who saw it printed.' } }])
    expect((await api.confirmGatewayFingerprint('g1', 'a'.repeat(64))).friendly).toMatch(/^Only the admin who made this gateway's enrolment token/)
  })

  it('an expired sign-in is said as such', async () => {
    holder.sb = fakeClient([{ data: null, error: { code: 'PGRST301', message: 'JWT expired' } }])
    expect((await api.listGatewayAudit()).friendly).toBe('Sign in again: WILSON could not confirm who is asking for this.')
  })

  it('an update that changed no row is refused in words; a CHECK is the field\'s own sentence', async () => {
    holder.sb = fakeClient([{ data: [], error: null }])
    expect((await api.renameGateway('g1', 'New name')).friendly).toMatch(/not in this company's list any more, or only a workspace admin/)
    holder.sb = fakeClient([{ data: null, error: { code: '23514', message: 'new row for relation "gateways" violates check constraint "gateways_office_ranges_chk"' } }])
    expect((await api.setGatewayOfficeRanges('g1', ['8.8.8.0/24'])).friendly).toMatch(/^Office ranges are private ranges only/)
    holder.sb = fakeClient([{ data: null, error: { code: '23514', message: 'violates check constraint "gateways_outside_address_chk"' } }])
    expect((await api.setGatewayOutsideAddress('g1', { host: 'nas.local', port: 8444 })).friendly).toMatch(/^An outside address is a public name/)
    holder.sb = fakeClient([{ data: [{ id: 'g1', name: 'New name' }], error: null }])
    expect(await api.renameGateway('g1', 'New name')).toEqual({ ok: true, data: { id: 'g1', name: 'New name' } })
    expect(holder.sb.log).toContainEqual(['update', { name: 'New name' }])
    expect(holder.sb.log).toContainEqual(['is', 'revoked_at', null])
  })

  it('cancelling a token that was spent meanwhile says so', async () => {
    holder.sb = fakeClient([{ data: [], error: null }])
    expect((await api.cancelEnrolmentToken('t1')).friendly).toBe('That token was used or has expired, so there is nothing to cancel.')
    holder.sb = fakeClient([{ data: [{ id: 't1' }], error: null }])
    expect(await api.cancelEnrolmentToken('t1')).toEqual({ ok: true, data: { id: 't1' } })
  })
})

describe('what is checked before it is shown', () => {
  it('the token must be a wgt_ token before the card shows it', async () => {
    holder.sb = fakeClient([{ data: [{ id: 't1', token: 'wgt_ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', expires_at: 'x' }], error: null }])
    expect(await api.makeEnrolmentToken()).toEqual({ ok: true, data: { id: 't1', token: 'wgt_ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', expires_at: 'x' } })
    holder.sb = fakeClient([{ data: [{ id: 't1', token: '<img src=x>', expires_at: 'x' }], error: null }])
    expect((await api.makeEnrolmentToken()).ok).toBe(false)
  })

  it('the certificate must be one PEM certificate', async () => {
    const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n'
    holder.sb = fakeClient([{ data: pem, error: null }])
    expect(await api.fetchRootCertificate('g1')).toEqual({ ok: true, data: pem })
    holder.sb = fakeClient([{ data: '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n', error: null }])
    expect((await api.fetchRootCertificate('g1')).ok).toBe(false)
  })
})

describe('Rotate the ticket keys (round 2, finding 6)', () => {
  it('calls gateway_rotate_signing_key as the caller and answers its { retired, at }', async () => {
    holder.sb = fakeClient([{ data: { retired: 1, at: '2026-10-10T12:00:00Z' }, error: null }])
    expect(await api.rotateTicketKeys()).toMatchObject({ ok: true, data: { retired: 1 } })
    expect(holder.sb.log).toEqual([['rpc', 'gateway_rotate_signing_key', undefined]])
  })
  it('the database\'s refusal is its sentence; a failure the plain one, and the old key is said to be in use', async () => {
    holder.sb = fakeClient([{ data: null, error: { code: '42501', message: 'Only a workspace admin can manage the file gateway.' } }])
    expect(await api.rotateTicketKeys()).toMatchObject({ ok: false, code: '42501', friendly: 'Only a workspace admin can manage the file gateway.' })
    holder.sb = fakeClient([{ data: null, error: { code: 'XX000', message: 'internal error at line 3' } }])
    expect((await api.rotateTicketKeys()).friendly).toBe('WILSON could not rotate the ticket keys just now; the old key is still the one in use. Try again in a moment.')
  })
})

describe('Check reach (gateway-reach)', () => {
  function response({ ok, status, body, order }) {
    return {
      get ok() { order.push('ok'); return ok },
      status,
      async json() { order.push('json'); if (body instanceof Error) throw body; return body },
    }
  }

  it('no session: no request, the sign-in sentence', async () => {
    holder.sb = fakeClient([])
    holder.sb.auth.getSession = vi.fn(async () => ({ data: { session: null } }))
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect((await api.checkGatewayReach('g1')).code).toBe('unauthorized')
    expect(f).not.toHaveBeenCalled()
  })

  it('posts the gateway id with the caller\'s token; reads ok BEFORE the body', async () => {
    holder.sb = fakeClient([])
    const order = []
    const body = { outside: { ok: true, detail: 'reached', ms: 143 }, inside_answered: false, checked_at: 'now' }
    const f = vi.fn(async () => response({ ok: true, status: 200, body, order }))
    vi.stubGlobal('fetch', f)
    const res = await api.checkGatewayReach('g1')
    expect(res).toEqual({ ok: true, status: 200, data: body })
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://abc.supabase.co/functions/v1/gateway-reach')
    expect(init.method).toBe('POST')
    expect(init.headers.authorization).toBe('Bearer user-jwt')
    expect(JSON.parse(init.body)).toEqual({ gateway_id: 'g1' })
    expect(order).toEqual(['ok', 'json'])
  })

  it('a refusal: its own sentence and code; a body that is not JSON: the plain sentence', async () => {
    holder.sb = fakeClient([])
    const order = []
    vi.stubGlobal('fetch', vi.fn(async () => response({ ok: false, status: 409, body: { error: 'busy', detail: 'A check is running for this gateway; its result appears here in a few seconds.' }, order })))
    expect(await api.checkGatewayReach('g1')).toEqual({ ok: false, status: 409, code: 'busy', friendly: 'A check is running for this gateway; its result appears here in a few seconds.' })
    expect(order[0]).toBe('ok')
    vi.stubGlobal('fetch', vi.fn(async () => response({ ok: false, status: 502, body: new SyntaxError('Unexpected token <'), order: [] })))
    expect(await api.checkGatewayReach('g1')).toEqual({ ok: false, status: 502, code: 'http_502', friendly: 'WILSON could not run the check just now. Try again in a moment.' })
  })

  it('a 200 in an unknown shape is refused, not shown', async () => {
    holder.sb = fakeClient([])
    vi.stubGlobal('fetch', vi.fn(async () => response({ ok: true, status: 200, body: { ok: true }, order: [] })))
    expect((await api.checkGatewayReach('g1')).code).toBe('bad_answer')
  })

  it('the network failing is a sentence', async () => {
    holder.sb = fakeClient([])
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    expect((await api.checkGatewayReach('g1')).code).toBe('network')
  })
})

describe('dev fixtures', () => {
  it('answer every call when on, and the client is never touched', async () => {
    holder.sb = { from: () => { throw new Error('the client was used') }, rpc: () => { throw new Error('the client was used') } }
    const calls = []
    const answer = (name) => async (...args) => { calls.push(name); return { ok: true, data: name, args } }
    holder.fx = { gateways: Object.fromEntries(['listGateways', 'listEnrolmentTokens', 'listGatewayAudit', 'listRemoteViewings',
      'makeEnrolmentToken', 'cancelEnrolmentToken', 'confirmGatewayFingerprint', 'fetchRootCertificate', 'updateGateway', 'forgetGateway',
      'unforgetGateway', 'requestGatewayUpdateCheck', 'checkGatewayReach', 'rotateTicketKeys'].map(n => [n, answer(n)])) }
    await api.listGateways({ admin: true })
    await api.listEnrolmentTokens()
    await api.listGatewayAudit()
    await api.listRemoteViewings()
    await api.makeEnrolmentToken()
    await api.cancelEnrolmentToken('t1')
    await api.confirmGatewayFingerprint('g1', 'f')
    await api.fetchRootCertificate('g1')
    await api.renameGateway('g1', 'n')
    await api.setGatewayOutsideAddress('g1', null)
    await api.setGatewayOfficeRanges('g1', [])
    await api.forgetGateway('g1')
    await api.unforgetGateway('g1')
    await api.requestGatewayUpdateCheck('g1')
    await api.checkGatewayReach('g1')
    await api.rotateTicketKeys()
    expect(calls).toEqual(['listGateways', 'listEnrolmentTokens', 'listGatewayAudit', 'listRemoteViewings',
      'makeEnrolmentToken', 'cancelEnrolmentToken', 'confirmGatewayFingerprint', 'fetchRootCertificate', 'updateGateway', 'updateGateway',
      'updateGateway', 'forgetGateway', 'unforgetGateway', 'requestGatewayUpdateCheck', 'checkGatewayReach', 'rotateTicketKeys'])
  })

  it('the cloud address is this build\'s', () => {
    expect(api.gatewayCloudBase()).toBe('https://abc.supabase.co')
  })
})
