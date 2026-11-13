// =============================================================================
// edgeAiFilesCaller.test.js — F8, the second merger (wave 2, 2026-11-13): who
// ai-files lets in, pinned as the merged code (F7's ai-files at 14bca27e)
// answers. OUTSTANDING F8-03 stays open: doing its caller checks once was
// tried (8a0bdb4f) and taken back after review.
//
// A sweep (DELETE { sweep: true }) passes the member guard and then the whole
// admin guard on the same request: two GoTrue calls, two reads of the
// caller's workspace_members row. The list (GET) passes the member guard and
// then reads that row again for the caller's role (isLiveAdmin). The second
// of each is load-bearing IN TIME: the admin guard is asked after the body is
// read (the client sends it as slowly as it likes), and the list's role after
// the two limiters, so a demotion, a deactivation or a sign-out in between is
// met. Reusing the first answers let a sweep through for an admin demoted
// while the body was still arriving (section F).
//
// ai-files RUNS here: src/cloud/edgeHarness.js stands in for Deno, GoTrue and
// the database, and both guards are the real ones. The caller's row answers
// only the columns a read names, as PostgREST does. fetch is the AI provider's
// store and no world here reaches it (any call fails the test).
//
// Pinned: the status and body of every answer, refusal by refusal and in the
// order they are met; the round trips as they are (E: 8a0bdb4f's reuse cut
// them, and they are back); and the timing (F: a change to the caller made
// while the request runs is answered as of after it). F was run red against
// the reuse (4ab4260c) and is green on the code as it is.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { newWorld, loadFunction, post, answerOf, tokenFor, trips, VERIFIED_TOTP } from './edgeHarness.js'
import { SWEEP_AGE_HOURS, totalsOf } from '../../supabase/functions/_shared/aiFileStore.ts'

vi.mock('https://esm.sh/@supabase/supabase-js@2.45.4', async () => ({
  createClient: (await import('./edgeHarness.js')).createClient,
}))

const ENV = { ANTHROPIC_API_KEY: 'harness-platform-key' }
const FILE = 'file_harness0001'
const USER = 'user-1'
const WS = 'ws-1'

let unexpected = []
beforeEach(() => {
  unexpected = []
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    unexpected.push(`${init.method ?? 'GET'} ${String(url)}`)
    throw new Error(`unexpected fetch ${String(url)}`)
  }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  expect(unexpected, 'a fetch no world here should make').toEqual([])
})

/** Only the columns a select names, as PostgREST answers. */
const project = (row, columns) => {
  if (!row || !columns || columns.trim() === '*') return row
  return Object.fromEntries(columns.split(',').map((c) => c.trim()).map((c) => [c, row[c]]))
}

/**
 * Seat a caller: what the TOKEN says (its role, its workspace, its aal) and
 * what the LIVE row says (its role, whether it is active, or no row, or a read
 * that fails) are set apart, so a test can make them disagree.
 */
function seat(w, {
  tokenRole = 'admin', rowRole = tokenRole, active = true, member = true, aal = 'aal1', factors = [],
  claimWorkspace = true, readError = null,
} = {}) {
  const app_metadata = claimWorkspace ? { workspace_id: WS, app_role: tokenRole } : { app_role: tokenRole }
  const token = tokenFor({ sub: USER, aal, app_metadata })
  w.auth.users.set(token, { id: USER, email: 'caller@example.test', app_metadata: claimWorkspace ? { workspace_id: WS } : {} })
  w.auth.factors.set(USER, factors)
  w.table('workspace_members', (q) => {
    if (readError) return { data: null, error: readError }
    const ws = q.filters.find((f) => f.column === 'workspace_id')?.value
    const uid = q.filters.find((f) => f.column === 'user_id')?.value
    const row = member && uid === USER && ws === WS ? project({ app_role: rowRole, is_active: active }, q.columns) : null
    return { data: q.terminal ? row : (row ? [row] : []), error: null }
  })
  return token
}

/** A world for ai-files. `limited(args)` answers the limiter (true: refused). */
async function aiWorld({ caller = {}, env = {}, limited = () => false } = {}) {
  const { handler } = await loadFunction(vi, 'ai-files', { ...ENV, ...env })
  const w = newWorld()
  const token = seat(w, caller)
  w.rpc('fn_rate_limit_hit', (args) => ({ data: limited(args) }))
  const call = async (method, body, o = {}) => {
    const a = await answerOf(await handler(post(body, { token, method, ...o })))
    return { status: a.status, json: a.json }
  }
  return { w, call, token, handler }
}

const ADMIN_AAL2 = { tokenRole: 'admin', aal: 'aal2', factors: VERIFIED_TOTP }
const SWEEP = { sweep: true }
const sweptEmpty = {
  ok: true,
  counts: { deleted: 0, gone: 0, failed: 0, skipped_recent: 0, unreachable: 0, certify_failed: 0, truncated: false, older_than_hours: SWEEP_AGE_HOURS },
  after: { ...totalsOf([]), sweepable: 0 },
}
const listedEmpty = (scope) => ({ scope, older_than_hours: SWEEP_AGE_HOURS, ...totalsOf([]), sweepable: 0, unreachable: 0, files: [] })
const R = {
  unauthorized: { status: 401, json: { error: 'unauthorized' } },
  forbidden: { status: 403, json: { error: 'forbidden' } },
  limited: { status: 429, json: { error: 'rate_limited' } },
  badBody: { status: 400, json: { error: 'validation_failed', errors: [{ field: 'body', error: 'expected a small JSON object' }] } },
  sweepAlone: { status: 400, json: { error: 'validation_failed', errors: [{ field: 'body', error: 'a sweep takes no other field' }] } },
  badIds: { status: 400, json: { error: 'validation_failed', errors: [{ field: 'file_id', error: 'one file id, or file_ids: up to 25' }] } },
  mfaFailed: { status: 503, json: { error: 'mfa_check_failed' } },
  mfaRequired: { status: 403, json: { error: 'mfa_required' } },
  enrol: { status: 403, json: { error: 'mfa_enrollment_required' } },
  swept: { status: 200, json: sweptEmpty },
}

// =============================================================================
// A. Who is let in at all (every route but the preflight)
// =============================================================================

describe('ai-files: the caller, before anything else is asked', () => {
  for (const [method, body] of [['DELETE', SWEEP], ['DELETE', { file_id: FILE }], ['GET', undefined]]) {
    const label = `${method}${body ? ` ${JSON.stringify(body)}` : ''}`
    it(`${label}: no authorization header → 401`, async () => {
      const { call } = await aiWorld()
      expect(await call(method, body, { token: null })).toEqual(R.unauthorized)
    })
    it(`${label}: not a bearer (Basic …) → 401`, async () => {
      const { call, token } = await aiWorld()
      expect(await call(method, body, { token: null, headers: { authorization: `Basic ${token}` } })).toEqual(R.unauthorized)
    })
    it(`${label}: "Bearer" with nothing after it → 401`, async () => {
      const { call } = await aiWorld()
      expect(await call(method, body, { token: null, headers: { authorization: 'Bearer ' } })).toEqual(R.unauthorized)
    })
    it(`${label}: two spaces after Bearer (never trimmed) → 401`, async () => {
      const { call, token } = await aiWorld()
      expect(await call(method, body, { token: null, headers: { authorization: `Bearer  ${token}` } })).toEqual(R.unauthorized)
    })
    it(`${label}: a token GoTrue refuses → 401`, async () => {
      const { call } = await aiWorld()
      expect(await call(method, body, { token: tokenFor({ sub: 'nobody', app_metadata: { workspace_id: WS } }) })).toEqual(R.unauthorized)
    })
    it(`${label}: no workspace claim → 403`, async () => {
      const { call } = await aiWorld({ caller: { claimWorkspace: false } })
      expect(await call(method, body)).toEqual(R.forbidden)
    })
    it(`${label}: no live row → 403`, async () => {
      const { call } = await aiWorld({ caller: { member: false } })
      expect(await call(method, body)).toEqual(R.forbidden)
    })
    it(`${label}: an inactive row (an admin's token) → 403`, async () => {
      const { call } = await aiWorld({ caller: { ...ADMIN_AAL2, active: false } })
      expect(await call(method, body)).toEqual(R.forbidden)
    })
    it(`${label}: the row read failing → 403, never a pass`, async () => {
      const { call } = await aiWorld({ caller: { ...ADMIN_AAL2, readError: { message: 'statement timeout' } } })
      expect(await call(method, body)).toEqual(R.forbidden)
    })
    it(`${label}: an active member, limited → 429 (the limiter is asked after the caller)`, async () => {
      const { call } = await aiWorld({ caller: { tokenRole: 'member' }, limited: () => true })
      expect(await call(method, body)).toEqual(R.limited)
    })
  }
  it('the preflight answers without asking who the caller is', async () => {
    const { handler, w } = await aiWorld()
    const a = await answerOf(await handler(new Request('https://edge-harness.test/functions/v1/ai-files', { method: 'OPTIONS' })))
    expect(a.status).toBe(204)
    expect(a.headers['access-control-allow-methods']).toBe('POST, GET, DELETE, OPTIONS')
    expect(w.calls).toEqual([])
  })
})

// =============================================================================
// B. DELETE: the member's own ids, and the admin's sweep
// =============================================================================

describe('ai-files DELETE: the body, then (for a sweep) the admin', () => {
  it('a body that is not JSON → 400', async () => {
    const { call } = await aiWorld({ caller: ADMIN_AAL2 })
    expect(await call('DELETE', undefined, { raw: 'not json' })).toEqual(R.badBody)
  })
  it('a JSON array → 400', async () => {
    const { call } = await aiWorld({ caller: ADMIN_AAL2 })
    expect(await call('DELETE', [SWEEP])).toEqual(R.badBody)
  })
  it('a sweep with another field → 400 (before the admin is asked)', async () => {
    const { call } = await aiWorld({ caller: { tokenRole: 'member' } })
    expect(await call('DELETE', { sweep: true, file_id: FILE })).toEqual(R.sweepAlone)
  })
  it('sweep: "yes" is not a sweep: it is read as ids, and refused as ids', async () => {
    const { call } = await aiWorld({ caller: { tokenRole: 'member' } })
    expect(await call('DELETE', { sweep: 'yes' })).toEqual(R.badIds)
  })
  it('a member lets go of an id no upload of theirs names: 200, not_found (no admin asked)', async () => {
    const { call, w } = await aiWorld({ caller: { tokenRole: 'member' } })
    expect(await call('DELETE', { file_id: FILE })).toEqual({ status: 200, json: { results: [{ id: FILE, outcome: 'not_found' }], certify_failed: 0 } })
    expect(w.count((c) => c.name === 'listFactors')).toBe(0)
  })

  const sweepCases = [
    ['a member (token and row) → 403', { tokenRole: 'member' }, {}, R.forbidden],
    ['the token says admin, the live row says member → 403', { tokenRole: 'admin', rowRole: 'member', aal: 'aal2', factors: VERIFIED_TOTP }, {}, R.forbidden],
    ['the token says member, the live row says admin → 403', { tokenRole: 'member', rowRole: 'admin', aal: 'aal2', factors: VERIFIED_TOTP }, {}, R.forbidden],
    ['an admin whose factor check fails → 503', { tokenRole: 'admin', aal: 'aal2', factors: new Error('GoTrue unavailable') }, {}, R.mfaFailed],
    ['an enrolled admin at aal1 → 403 mfa_required', { tokenRole: 'admin', aal: 'aal1', factors: VERIFIED_TOTP }, {}, R.mfaRequired],
    ['an enrolled admin at aal2 → 200, the sweep runs', ADMIN_AAL2, {}, R.swept],
    ['an unenrolled admin, the gate off → 200', { tokenRole: 'admin' }, {}, R.swept],
    ['an unenrolled admin, the gate on → 403 mfa_enrollment_required', { tokenRole: 'admin' }, { WILSON_REQUIRE_ADMIN_MFA: '1' }, R.enrol],
    ['an enrolled admin at aal2, the gate on → 200', ADMIN_AAL2, { WILSON_REQUIRE_ADMIN_MFA: '1' }, R.swept],
    ['an enrolled admin at aal1, the gate on → 403 mfa_required (the step-up first)', { tokenRole: 'admin', aal: 'aal1', factors: VERIFIED_TOTP }, { WILSON_REQUIRE_ADMIN_MFA: '1' }, R.mfaRequired],
    ['a factor that is not verified counts as none: gate off → 200', { tokenRole: 'admin', factors: [{ factor_type: 'totp', status: 'unverified' }] }, {}, R.swept],
    ['a member whose factor check would fail → 403 (the role before the factors)', { tokenRole: 'member', factors: new Error('GoTrue unavailable') }, {}, R.forbidden],
    ['an admin row, a member token, the factor check failing → 403', { tokenRole: 'member', rowRole: 'admin', factors: new Error('x') }, {}, R.forbidden],
  ]
  for (const [name, caller, env, answer] of sweepCases) {
    it(`sweep, ${name}`, async () => {
      const { call } = await aiWorld({ caller, env })
      expect(await call('DELETE', SWEEP)).toEqual(answer)
    })
  }

  it('sweep: the limiter before the body, the body before the admin', async () => {
    const limited = await aiWorld({ caller: { tokenRole: 'member' }, limited: () => true })
    expect(await limited.call('DELETE', { sweep: true, extra: 1 })).toEqual(R.limited)
    const bad = await aiWorld({ caller: { tokenRole: 'member', factors: new Error('x') } })
    expect(await bad.call('DELETE', undefined, { raw: '{' })).toEqual(R.badBody)
  })
  it('sweep: the limiter failing lets the call through (fail open), and the admin is still asked', async () => {
    const { handler, w, token } = await aiWorld({ caller: { tokenRole: 'member' } })
    w.rpc('fn_rate_limit_hit', () => ({ data: null, error: { message: 'limiter down' } }))
    const a = await answerOf(await handler(post(SWEEP, { token, method: 'DELETE' })))
    expect({ status: a.status, json: a.json }).toEqual(R.forbidden)
  })
  it('sweep: the limiter is the caller\'s own bucket (ai-files-manage, by user)', async () => {
    const seen = []
    const { call } = await aiWorld({ caller: ADMIN_AAL2, limited: (args) => { seen.push(args); return false } })
    expect(await call('DELETE', SWEEP)).toEqual(R.swept)
    expect(seen).toEqual([{ p_bucket: 'ai-files-manage', p_subject: USER, p_limit: 30, p_window_seconds: 60 }])
  })
  it('sweep: the factors asked are the caller\'s own', async () => {
    const { call, w } = await aiWorld({ caller: ADMIN_AAL2 })
    expect(await call('DELETE', SWEEP)).toEqual(R.swept)
    expect(w.calls.filter((c) => c.name === 'listFactors').map((c) => c.args)).toEqual([[USER]])
  })
})

// =============================================================================
// C. GET: what the caller may see is decided by the LIVE row's role
// =============================================================================

describe('ai-files GET: the scope is the live row\'s, never the token\'s', () => {
  for (const [name, caller, scope] of [
    ['a member (token and row) sees their own', { tokenRole: 'member' }, 'own'],
    ['an admin (token and row) sees the workspace\'s', { tokenRole: 'admin' }, 'workspace'],
    ['an admin token on a member row sees their own', { tokenRole: 'admin', rowRole: 'member' }, 'own'],
    ['a member token on an admin row sees the workspace\'s', { tokenRole: 'member', rowRole: 'admin' }, 'workspace'],
    ['an enrolled admin at aal1 sees the workspace\'s (no step-up on a list)', { tokenRole: 'admin', aal: 'aal1', factors: VERIFIED_TOTP }, 'workspace'],
    ['an admin whose factors cannot be read sees the workspace\'s (they are never asked)', { tokenRole: 'admin', factors: new Error('x') }, 'workspace'],
  ]) {
    it(name, async () => {
      const { call, w } = await aiWorld({ caller })
      expect(await call('GET')).toEqual({ status: 200, json: listedEmpty(scope) })
      expect(w.count((c) => c.name === 'listFactors')).toBe(0)
    })
  }
  it('the per-caller limit first, then the workspace\'s', async () => {
    const seen = []
    const byCaller = await aiWorld({ caller: { tokenRole: 'member' }, limited: (args) => { seen.push(args.p_bucket); return args.p_bucket === 'ai-files-manage' } })
    expect(await byCaller.call('GET')).toEqual(R.limited)
    expect(seen).toEqual(['ai-files-manage'])
    const byWorkspace = await aiWorld({ caller: { tokenRole: 'member' }, limited: (args) => args.p_bucket === 'ai-files-list' && args.p_subject === WS })
    expect(await byWorkspace.call('GET')).toEqual(R.limited)
  })
})

// =============================================================================
// D. POST: the upload's member guard, unchanged (it never asked the role)
// =============================================================================

describe('ai-files POST: the upload\'s caller check', () => {
  it('an active member, the wrong content-type → 400 after the guard and the limiter; the row read is is_active alone', async () => {
    const { call, w } = await aiWorld({ caller: { tokenRole: 'member' } })
    expect(await call('POST', { a: 1 })).toEqual({ status: 400, json: { error: 'validation_failed', errors: [{ field: 'content-type', error: 'expected multipart/form-data' }] } })
    expect(w.calls.filter((c) => c.name === 'workspace_members').map((c) => c.columns)).toEqual(['is_active'])
  })
  it('an inactive member → 403', async () => {
    const { call } = await aiWorld({ caller: { tokenRole: 'member', active: false } })
    expect(await call('POST', { a: 1 })).toEqual(R.forbidden)
  })
})

// =============================================================================
// E. The round trips, as they are (OUTSTANDING F8-03, open). 8a0bdb4f's reuse
// cut a sweep to 4 (getUser, members, limiter, listFactors), a refused sweep
// to 3 and a list to 4; it was taken back (section F says why), and these are
// the counts again: the second GoTrue call and the second read are the checks
// made after the body and after the limiters.
// =============================================================================

describe('F8-03 (open): a sweep authenticates twice and reads the row twice; a list reads it twice', () => {
  /** The round trips before the route's own work (its first app_events read). */
  const head = (w) => {
    const t = trips(w)
    const at = t.indexOf('table:app_events')
    return at < 0 ? t : t.slice(0, at)
  }

  it('a sweep: the member guard (GoTrue, the row), the limiter, then the whole admin guard (GoTrue, the row with its role, the factors)', async () => {
    const { call, w } = await aiWorld({ caller: ADMIN_AAL2 })
    expect(await call('DELETE', SWEEP)).toEqual(R.swept)
    expect(head(w)).toEqual(['auth:getUser', 'table:workspace_members', 'rpc:fn_rate_limit_hit', 'auth:getUser', 'table:workspace_members', 'auth:listFactors'])
    expect(w.calls.filter((c) => c.name === 'workspace_members').map((c) => c.columns)).toEqual(['is_active', 'app_role, is_active'])
    expect(w.clients.filter((c) => c.by === 'service').length).toBe(2)
  })
  it('a refused sweep stops on the admin guard\'s own read of the row', async () => {
    const { call, w } = await aiWorld({ caller: { tokenRole: 'admin', rowRole: 'member' } })
    expect(await call('DELETE', SWEEP)).toEqual(R.forbidden)
    expect(head(w)).toEqual(['auth:getUser', 'table:workspace_members', 'rpc:fn_rate_limit_hit', 'auth:getUser', 'table:workspace_members'])
  })
  it('a list: the member guard (GoTrue, the row), the two limiters, then the row again with its role', async () => {
    const { call, w } = await aiWorld({ caller: { tokenRole: 'admin' } })
    expect(await call('GET')).toEqual({ status: 200, json: listedEmpty('workspace') })
    expect(head(w)).toEqual(['auth:getUser', 'table:workspace_members', 'rpc:fn_rate_limit_hit', 'rpc:fn_rate_limit_hit', 'table:workspace_members'])
    expect(w.calls.filter((c) => c.name === 'workspace_members').map((c) => c.columns)).toEqual(['is_active', 'app_role, is_active'])
  })
  it('a member\'s own delete: GoTrue once, the row once', async () => {
    const { call, w } = await aiWorld({ caller: { tokenRole: 'member' } })
    expect((await call('DELETE', { file_id: FILE })).status).toBe(200)
    expect(head(w)).toEqual(['auth:getUser', 'table:workspace_members', 'rpc:fn_rate_limit_hit'])
  })
})

// =============================================================================
// F. The second checks are timed around the work they guard (why F8-03 stays
// open). A DELETE's body is the client's to send, as slowly as it likes; the
// admin guard is asked AFTER it has arrived, so an admin demoted, deactivated
// or signed out while it was still arriving is refused. The list's scope is
// read AFTER the two limiters, from the row as it is then. Run red against
// 8a0bdb4f's reuse (4ab4260c), which answered all three sweeps 200 with the
// sweep's counts and all three lists 200 'workspace'.
// =============================================================================

describe('ai-files: a change to the caller mid-request is met by the check after it', () => {
  /**
   * An enrolled admin at aal2 whose LIVE row is `row`, which a test changes
   * while the request runs. `readAt(n, q)` may answer the n-th read of the row
   * itself (a failure, or a throw).
   */
  async function liveWorld({ readAt = () => null } = {}) {
    const { handler } = await loadFunction(vi, 'ai-files', ENV)
    const w = newWorld()
    const token = seat(w, ADMIN_AAL2)
    const row = { app_role: 'admin', is_active: true }
    let reads = 0
    w.table('workspace_members', async (q) => {
      reads++
      const forced = await readAt(reads, q)
      if (forced) return forced
      const ws = q.filters.find((f) => f.column === 'workspace_id')?.value
      const uid = q.filters.find((f) => f.column === 'user_id')?.value
      const r = uid === USER && ws === WS ? project(row, q.columns) : null
      return { data: q.terminal ? r : (r ? [r] : []), error: null }
    })
    w.rpc('fn_rate_limit_hit', () => ({ data: false }))
    return { handler, w, token, row }
  }

  /** A JSON body that arrives only once `during()` has run: the client still sending it. */
  function slowBody(json, during) {
    const bytes = new TextEncoder().encode(JSON.stringify(json))
    let sent = false
    return new ReadableStream({
      async pull(c) {
        if (sent) { c.close(); return }
        await during()
        sent = true
        c.enqueue(bytes)
      },
    }, { highWaterMark: 0 })
  }

  async function slowSweep(world, change) {
    let before = null
    const raw = slowBody(SWEEP, async () => { before = trips(world.w); change(world) })
    const a = await answerOf(await world.handler(post(undefined, { token: world.token, method: 'DELETE', raw })))
    return { answer: { status: a.status, json: a.json }, before }
  }

  const PASSED = ['auth:getUser', 'table:workspace_members', 'rpc:fn_rate_limit_hit']

  for (const [name, change, answer] of [
    ['(T1) the row\'s role becomes member → 403 forbidden', ({ row }) => { row.app_role = 'member' }, R.forbidden],
    ['(T2) the row becomes inactive → 403 forbidden', ({ row }) => { row.is_active = false }, R.forbidden],
    ['(T3) GoTrue stops knowing the token (signed out) → 401', ({ w, token }) => { w.auth.users.delete(token) }, R.unauthorized],
  ]) {
    it(`sweep, while its body is still arriving: ${name}`, async () => {
      const world = await liveWorld()
      const { answer: got, before } = await slowSweep(world, change)
      // The member guard and the limiter had passed when the caller changed…
      expect(before).toEqual(PASSED)
      // …and the answer is the admin guard's, asked after: nothing swept.
      expect(got).toEqual(answer)
      expect(world.w.count((c) => c.name === 'listFactors')).toBe(0)
      expect(world.w.count((c) => c.name === 'app_events')).toBe(0)
    })
  }
  it('sweep, the same slow body and no change → 200, the sweep runs (the control)', async () => {
    const world = await liveWorld()
    const { answer: got, before } = await slowSweep(world, () => {})
    expect(before).toEqual(PASSED)
    expect(got).toEqual(R.swept)
  })

  const list = async (world) => {
    const a = await answerOf(await world.handler(post(undefined, { token: world.token, method: 'GET' })))
    return { status: a.status, json: a.json }
  }
  it('list (T5): the row\'s role becomes member during the limiters → own (the scope is read after them)', async () => {
    const world = await liveWorld()
    world.w.rpc('fn_rate_limit_hit', () => { world.row.app_role = 'member'; return { data: false } })
    expect(await list(world)).toEqual({ status: 200, json: listedEmpty('own') })
  })
  it('list (T6): the second read of the row fails → own (a failed read is not an admin)', async () => {
    const world = await liveWorld({ readAt: (n) => (n === 2 ? { data: null, error: { message: 'statement timeout' } } : null) })
    expect(await list(world)).toEqual({ status: 200, json: listedEmpty('own') })
    expect(world.w.calls.filter((c) => c.name === 'workspace_members').map((c) => c.columns)).toEqual(['is_active', 'app_role, is_active'])
  })
  it('list (T7): the second read of the row throws → 502 list_failed', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const world = await liveWorld({ readAt: (n) => { if (n === 2) throw new Error('socket closed'); return null } })
    expect(await list(world)).toEqual({ status: 502, json: { error: 'list_failed' } })
    expect(errors).toHaveBeenCalledWith('[ai-files] list failed: socket closed')
  })
  it('list, no change → workspace (the control)', async () => {
    const world = await liveWorld()
    expect(await list(world)).toEqual({ status: 200, json: listedEmpty('workspace') })
  })
})
