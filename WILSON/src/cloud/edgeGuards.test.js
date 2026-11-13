// =============================================================================
// edgeGuards.test.js — F8 (wave 2, 2026-11-13): the Edge Functions' caller
// checks, pinned exactly as they stood before F8 shared their plumbing.
//
// Every Edge Function begins by deciding who is asking: a workspace admin
// (adminGuard), any active member (memberGuard), a platform operator
// (operatorGuard), a file gateway (gatewayGuard), or, in issue-session, a
// signed-in user with no guard module at all. F8 refactors that code. This
// file is the proof that nothing a caller can see moved: for every refusal,
// its status, its exact body and headers, its ORDER, and the work done before
// it (who was asked what, and how many round trips); for every pass, the
// context handed on. It also holds every function's answer to OPTIONS and
// GET, and how the client that carries the caller's own token is made.
//
// The oracle is the code as it was at a71cd144. Where a pin looks like a
// defect it is still pinned, with a note: F8 must not change it by accident.
// The tokens and keys are the harness's made-up words; nothing is a secret.
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import {
  newWorld, loadFunction, seatCaller, tokenFor, post, answerOf, trips, createClient,
  VERIFIED_TOTP, SERVICE_KEY, ANON_KEY, SUPABASE_URL,
} from './edgeHarness.js'
import { requireWorkspaceAdmin, logAdminEvent, reply } from '../../supabase/functions/_shared/adminGuard.ts'
import { requireActiveMember } from '../../supabase/functions/_shared/memberGuard.ts'
import { requirePlatformOperator, logPlatformEvent } from '../../supabase/functions/_shared/operatorGuard.ts'
import {
  answer, refusal, preflight, serviceClient, withMemberSentence, requireGateway,
} from '../../supabase/functions/_shared/gatewayGuard.ts'

vi.mock('https://esm.sh/@supabase/supabase-js@2.45.4', async () => ({
  createClient: (await import('./edgeHarness.js')).createClient,
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ── Shared words ────────────────────────────────────────────────────────────

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, apikey',
}
const JSON_H = { ...CORS, 'content-type': 'application/json' }
const GW_H = { ...JSON_H, 'cache-control': 'no-store' }
const NO_PERSIST = { auth: { persistSession: false, autoRefreshToken: false } }
const GW_ID = '11111111-2222-4333-8444-555555555555'
const PROJECT = '66666666-7777-4888-8999-aaaaaaaaaaaa'

/** Deno, for a guard called directly (they read the environment when called). */
function denoEnv(extra = {}) {
  const values = { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_ANON_KEY: ANON_KEY, ...extra }
  vi.stubGlobal('Deno', { env: { get: (n) => values[n] } })
}
/** A POST carrying exactly this Authorization header (none when undefined). */
function signed(authorization, body = '{}') {
  const headers = { 'content-type': 'application/json' }
  if (authorization !== undefined) headers.authorization = authorization
  return new Request('https://edge-harness.test/functions/v1/x', { method: 'POST', headers, body })
}
const tables = (w, name) => w.calls.filter((c) => c.kind === 'table' && c.name === name)
/** Status, JSON body and the function's own headers. */
async function shown(res) {
  const a = await answerOf(res)
  return { status: a.status, json: a.json, headers: a.headers }
}
/** The membership table answering one row (or none) and an optional error. */
function membersAnswer(w, row, error = null) {
  w.table('workspace_members', (q) => ({ data: q.terminal ? row : (row ? [row] : []), error }))
}

const GET_USER = 'auth:getUser'
const MEMBERS = 'table:workspace_members'
const FACTORS = 'auth:listFactors'

// ── 1. adminGuard: requireWorkspaceAdmin ────────────────────────────────────

describe('adminGuard requireWorkspaceAdmin', () => {
  // Each case seats the world and returns the Authorization header it sends.
  const REFUSALS = [
    ['no Authorization header', () => undefined, {}, 401, 'unauthorized', []],
    ['a Basic scheme', (w) => `Basic ${seatCaller(w).token}`, {}, 401, 'unauthorized', []],
    ['"Bearer " with nothing after it', () => 'Bearer ', {}, 401, 'unauthorized', []],
    ['"Bearer" with no space', (w) => `Bearer${seatCaller(w).token}`, {}, 401, 'unauthorized', []],
    ['a token GoTrue refuses', () => `Bearer ${tokenFor({ sub: 'nobody' })}`, {}, 401, 'unauthorized', [GET_USER]],
    ['no workspace claim, in the token or the user record', (w) => {
      const t = tokenFor({ sub: 'user-1', aal: 'aal1', app_metadata: { app_role: 'admin' } })
      w.auth.users.set(t, { id: 'user-1', app_metadata: {} })
      return `Bearer ${t}`
    }, {}, 403, 'forbidden', [GET_USER]],
    ['claim role manager', (w) => `Bearer ${seatCaller(w, { role: 'manager' }).token}`, {}, 403, 'forbidden', [GET_USER]],
    ['claim role user', (w) => `Bearer ${seatCaller(w, { role: 'user' }).token}`, {}, 403, 'forbidden', [GET_USER]],
    // The role is read from the TOKEN only; the user record's copy does not count.
    ['admin only on the user record, not in the token', (w) => {
      const t = tokenFor({ sub: 'user-1', aal: 'aal1', app_metadata: { workspace_id: 'ws-1' } })
      w.auth.users.set(t, { id: 'user-1', app_metadata: { workspace_id: 'ws-1', app_role: 'admin' } })
      membersAnswer(w, { app_role: 'admin', is_active: true })
      return `Bearer ${t}`
    }, {}, 403, 'forbidden', [GET_USER]],
    ['no membership row', (w) => `Bearer ${seatCaller(w, { member: false }).token}`, {}, 403, 'forbidden', [GET_USER, MEMBERS]],
    ['an inactive row', (w) => `Bearer ${seatCaller(w, { active: false }).token}`, {}, 403, 'forbidden', [GET_USER, MEMBERS]],
    ['a row demoted to user while the claim still says admin', (w) => {
      const { token } = seatCaller(w)
      membersAnswer(w, { app_role: 'user', is_active: true })
      return `Bearer ${token}`
    }, {}, 403, 'forbidden', [GET_USER, MEMBERS]],
    // adminGuard.ts:99 destructures only `data`: a failed read is "no row", a 403, not a 503.
    ['the membership read failing', (w) => {
      const { token } = seatCaller(w)
      membersAnswer(w, null, { message: 'database unavailable' })
      return `Bearer ${token}`
    }, {}, 403, 'forbidden', [GET_USER, MEMBERS]],
    ['listFactors failing on the error channel', (w) => {
      const { token } = seatCaller(w)
      w.auth.factors.set('user-1', new Error('gotrue unavailable'))
      return `Bearer ${token}`
    }, {}, 503, 'mfa_check_failed', [GET_USER, MEMBERS, FACTORS]],
    ['listFactors throwing', (w) => {
      const { token } = seatCaller(w)
      w.auth.admin.listFactors = () => { throw new Error('gotrue threw') }
      return `Bearer ${token}`
    }, {}, 503, 'mfa_check_failed', [GET_USER, MEMBERS, FACTORS]],
    ['a verified TOTP factor with an aal1 token', (w) => `Bearer ${seatCaller(w, { factors: VERIFIED_TOTP }).token}`,
      {}, 403, 'mfa_required', [GET_USER, MEMBERS, FACTORS]],
    ['a verified TOTP factor with aal1, the enrolment flag on too', (w) => `Bearer ${seatCaller(w, { factors: VERIFIED_TOTP }).token}`,
      { WILSON_REQUIRE_ADMIN_MFA: '1' }, 403, 'mfa_required', [GET_USER, MEMBERS, FACTORS]],
    ['no factor with WILSON_REQUIRE_ADMIN_MFA=1', (w) => `Bearer ${seatCaller(w).token}`,
      { WILSON_REQUIRE_ADMIN_MFA: '1' }, 403, 'mfa_enrollment_required', [GET_USER, MEMBERS, FACTORS]],
    ['only an unverified factor with WILSON_REQUIRE_ADMIN_MFA=1', (w) => `Bearer ${seatCaller(w, { factors: [{ factor_type: 'totp', status: 'unverified' }] }).token}`,
      { WILSON_REQUIRE_ADMIN_MFA: '1' }, 403, 'mfa_enrollment_required', [GET_USER, MEMBERS, FACTORS]],
  ]

  it.each(REFUSALS)('refuses %s', async (_name, seat, env, status, error, expectedTrips) => {
    const w = newWorld()
    const header = seat(w)
    denoEnv(env)
    const g = await requireWorkspaceAdmin(signed(header))
    expect(g.ok).toBe(false)
    expect(await shown(g.res)).toEqual({ status, json: { error }, headers: JSON_H })
    // Nothing after the refusal ran (no factor read once the row refused, and so on).
    expect(trips(w)).toEqual(expectedTrips)
    // The service client is made only once a token has been sliced out.
    expect(w.clients.length).toBe(expectedTrips.length === 0 ? 0 : 1)
  })

  const PASSES = [
    ['a verified TOTP factor with aal2', { factors: VERIFIED_TOTP, aal: 'aal2' }, {}],
    ['a verified TOTP factor with aal2, the flag on', { factors: VERIFIED_TOTP, aal: 'aal2' }, { WILSON_REQUIRE_ADMIN_MFA: '1' }],
    ['an unverified TOTP factor with aal1', { factors: [{ factor_type: 'totp', status: 'unverified' }] }, {}],
    ['a verified non-TOTP factor with aal1', { factors: [{ factor_type: 'phone', status: 'verified' }] }, {}],
    ['no factor, the flag unset', {}, {}],
    ['no factor, the flag "0"', {}, { WILSON_REQUIRE_ADMIN_MFA: '0' }],
    ['no factor, the flag "true" (only "1" turns it on)', {}, { WILSON_REQUIRE_ADMIN_MFA: 'true' }],
  ]

  it.each(PASSES)('passes %s', async (_name, seat, env) => {
    const w = newWorld()
    const { token } = seatCaller(w, seat)
    denoEnv(env)
    const g = await requireWorkspaceAdmin(signed(`Bearer ${token}`))
    expect(g.ok).toBe(true)
    expect(g.ctx.callerId).toBe('user-1')
    expect(g.ctx.workspaceId).toBe('ws-1')
    expect(trips(w)).toEqual([GET_USER, MEMBERS, FACTORS])
  })

  it('passes when the membership read reports an error but still hands back a live admin row (the error is ignored)', async () => {
    const w = newWorld()
    const { token } = seatCaller(w)
    membersAnswer(w, { app_role: 'admin', is_active: true }, { message: 'reported but ignored' })
    denoEnv()
    const g = await requireWorkspaceAdmin(signed(`Bearer ${token}`))
    expect(g.ok).toBe(true)
  })

  it('asks exactly this, and hands on the service-role client', async () => {
    const w = newWorld()
    const { token } = seatCaller(w)
    denoEnv()
    const g = await requireWorkspaceAdmin(signed(`Bearer ${token}`))
    expect(g.ok).toBe(true)
    expect(Object.keys(g.ctx).sort()).toEqual(['admin', 'callerId', 'workspaceId'])
    expect(g.ctx).toMatchObject({ callerId: 'user-1', workspaceId: 'ws-1' })
    // One client, the service key, NO options.
    expect(w.clients).toEqual([{ key: SERVICE_KEY, by: 'service', options: undefined }])
    expect(g.ctx.admin).toMatchObject({ url: SUPABASE_URL, key: SERVICE_KEY, by: 'service', options: undefined })
    expect(w.calls).toEqual([
      { kind: 'auth', name: 'getUser', by: 'service', args: [token] },
      expect.objectContaining({
        kind: 'table', name: 'workspace_members', op: 'select', by: 'service',
        columns: 'app_role, is_active', terminal: 'maybeSingle',
        filters: [{ f: 'eq', column: 'workspace_id', value: 'ws-1' }, { f: 'eq', column: 'user_id', value: 'user-1' }],
        order: [], limit: null, range: null,
      }),
      { kind: 'auth', name: 'listFactors', by: 'service', args: ['user-1'] },
    ])
  })

  it("takes the workspace from the TOKEN's app_metadata before the user record's", async () => {
    const w = newWorld()
    const t = tokenFor({ sub: 'user-1', aal: 'aal1', app_metadata: { workspace_id: 'ws-token', app_role: 'admin' } })
    w.auth.users.set(t, { id: 'user-1', app_metadata: { workspace_id: 'ws-user' } })
    membersAnswer(w, { app_role: 'admin', is_active: true })
    denoEnv()
    const g = await requireWorkspaceAdmin(signed(`Bearer ${t}`))
    expect(g.ctx.workspaceId).toBe('ws-token')
    expect(tables(w, 'workspace_members')[0].filters[0]).toEqual({ f: 'eq', column: 'workspace_id', value: 'ws-token' })
  })

  it("falls back to the user record's workspace when the token carries none", async () => {
    const w = newWorld()
    const t = tokenFor({ sub: 'user-1', aal: 'aal1', app_metadata: { app_role: 'admin' } })
    w.auth.users.set(t, { id: 'user-1', app_metadata: { workspace_id: 'ws-user' } })
    membersAnswer(w, { app_role: 'admin', is_active: true })
    denoEnv()
    const g = await requireWorkspaceAdmin(signed(`Bearer ${t}`))
    expect(g.ctx.workspaceId).toBe('ws-user')
    expect(tables(w, 'workspace_members')[0].filters[0]).toEqual({ f: 'eq', column: 'workspace_id', value: 'ws-user' })
  })

  it('matches the scheme in any case', async () => {
    for (const scheme of ['bearer', 'BEARER', 'bEaReR']) {
      const w = newWorld()
      const { token } = seatCaller(w)
      denoEnv()
      const g = await requireWorkspaceAdmin(signed(`${scheme} ${token}`))
      expect(g.ok).toBe(true)
      expect(w.calls[0].args).toEqual([token])
    }
  })

  it('hands getUser the slice after the seventh character, untrimmed', async () => {
    const w = newWorld()
    const { token } = seatCaller(w)
    denoEnv()
    const g = await requireWorkspaceAdmin(signed(`Bearer  ${token}`))
    expect(w.calls[0]).toEqual({ kind: 'auth', name: 'getUser', by: 'service', args: [` ${token}`] })
    // GoTrue (the harness's) does not know the spaced token, so it is refused there.
    expect(await shown(g.res)).toEqual({ status: 401, json: { error: 'unauthorized' }, headers: JSON_H })
  })
})

// ── 2. memberGuard: requireActiveMember ─────────────────────────────────────

describe('memberGuard requireActiveMember', () => {
  const REFUSALS = [
    ['no Authorization header', () => undefined, 401, 'unauthorized', []],
    ['a Basic scheme', (w) => `Basic ${seatCaller(w).token}`, 401, 'unauthorized', []],
    ['"Bearer " with nothing after it', () => 'Bearer ', 401, 'unauthorized', []],
    ['a token GoTrue refuses', () => `Bearer ${tokenFor({ sub: 'nobody' })}`, 401, 'unauthorized', [GET_USER]],
    ['no workspace claim', (w) => {
      const t = tokenFor({ sub: 'user-1', app_metadata: {} })
      w.auth.users.set(t, { id: 'user-1' })
      return `Bearer ${t}`
    }, 403, 'forbidden', [GET_USER]],
    ['no membership row', (w) => `Bearer ${seatCaller(w, { member: false }).token}`, 403, 'forbidden', [GET_USER, MEMBERS]],
    ['an inactive row', (w) => `Bearer ${seatCaller(w, { active: false }).token}`, 403, 'forbidden', [GET_USER, MEMBERS]],
    // memberGuard.ts:60 destructures only `data`, as adminGuard does: a failed read is a 403.
    ['the membership read failing', (w) => {
      const { token } = seatCaller(w)
      membersAnswer(w, null, { message: 'database unavailable' })
      return `Bearer ${token}`
    }, 403, 'forbidden', [GET_USER, MEMBERS]],
  ]

  it.each(REFUSALS)('refuses %s', async (_name, seat, status, error, expectedTrips) => {
    const w = newWorld()
    const header = seat(w)
    denoEnv()
    const g = await requireActiveMember(signed(header))
    expect(g.ok).toBe(false)
    expect(await shown(g.res)).toEqual({ status, json: { error }, headers: JSON_H })
    expect(trips(w)).toEqual(expectedTrips)
  })

  it.each(['admin', 'manager', 'user', 'viewer'])('passes any active role (%s), with never an MFA call', async (role) => {
    const w = newWorld()
    // A verified factor and an aal1 token: adminGuard would refuse this; memberGuard never asks.
    const { token } = seatCaller(w, { role, factors: VERIFIED_TOTP, aal: 'aal1' })
    denoEnv({ WILSON_REQUIRE_ADMIN_MFA: '1' })
    const g = await requireActiveMember(signed(`Bearer ${token}`))
    expect(g.ok).toBe(true)
    expect(trips(w)).toEqual([GET_USER, MEMBERS])
  })

  it('passes when the read reports an error but still hands back an active row (the error is ignored)', async () => {
    const w = newWorld()
    const { token } = seatCaller(w)
    membersAnswer(w, { is_active: true }, { message: 'reported but ignored' })
    denoEnv()
    expect((await requireActiveMember(signed(`Bearer ${token}`))).ok).toBe(true)
  })

  it('asks exactly this, and hands on the service-role client', async () => {
    const w = newWorld()
    const { token } = seatCaller(w)
    denoEnv()
    const g = await requireActiveMember(signed(`Bearer ${token}`))
    expect(Object.keys(g.ctx).sort()).toEqual(['admin', 'callerId', 'workspaceId'])
    expect(g.ctx).toMatchObject({ callerId: 'user-1', workspaceId: 'ws-1' })
    expect(w.clients).toEqual([{ key: SERVICE_KEY, by: 'service', options: undefined }])
    expect(g.ctx.admin).toMatchObject({ key: SERVICE_KEY, by: 'service', options: undefined })
    expect(w.calls).toEqual([
      { kind: 'auth', name: 'getUser', by: 'service', args: [token] },
      expect.objectContaining({
        kind: 'table', name: 'workspace_members', op: 'select', by: 'service',
        columns: 'is_active', terminal: 'maybeSingle',
        filters: [{ f: 'eq', column: 'workspace_id', value: 'ws-1' }, { f: 'eq', column: 'user_id', value: 'user-1' }],
      }),
    ])
  })

  it('takes the workspace from the token first, the user record second', async () => {
    for (const [claims, record, expected] of [
      [{ workspace_id: 'ws-token' }, { workspace_id: 'ws-user' }, 'ws-token'],
      [{}, { workspace_id: 'ws-user' }, 'ws-user'],
    ]) {
      const w = newWorld()
      const t = tokenFor({ sub: 'user-1', app_metadata: claims })
      w.auth.users.set(t, { id: 'user-1', app_metadata: record })
      membersAnswer(w, { is_active: true })
      denoEnv()
      const g = await requireActiveMember(signed(`Bearer ${t}`))
      expect(g.ctx.workspaceId).toBe(expected)
    }
  })

  it('matches the scheme in any case and hands getUser the untrimmed slice', async () => {
    const w = newWorld()
    const { token } = seatCaller(w)
    denoEnv()
    expect((await requireActiveMember(signed(`BEARER ${token}`))).ok).toBe(true)
    await requireActiveMember(signed(`Bearer  ${token}`))
    expect(w.calls.filter((c) => c.name === 'getUser').map((c) => c.args)).toEqual([[token], [` ${token}`]])
  })
})

// ── 3. operatorGuard: requirePlatformOperator ───────────────────────────────

/** An operator: no workspace claims at all, a platform_operators row, a verified factor, aal2. */
function seatOperator(w, { operator = true, factors = VERIFIED_TOTP, aal = 'aal2', email = 'op@example.test', username = null } = {}) {
  const token = tokenFor({ sub: 'op-1', aal })
  w.auth.users.set(token, email === null ? { id: 'op-1' } : { id: 'op-1', email })
  w.auth.factors.set('op-1', factors)
  w.table('platform_operators', (q) => ({ data: operator && q.filters[0]?.value === 'op-1' ? { user_id: 'op-1' } : null, error: null }))
  w.table('workspace_members', () => ({ data: username ? { username } : null, error: null }))
  return token
}
const OPERATORS = 'table:platform_operators'

describe('operatorGuard requirePlatformOperator', () => {
  const REFUSALS = [
    ['no Authorization header', () => undefined, 401, 'unauthorized', []],
    ['a Basic scheme', (w) => `Basic ${seatOperator(w)}`, 401, 'unauthorized', []],
    ['a token GoTrue refuses', () => `Bearer ${tokenFor({ sub: 'nobody' })}`, 401, 'unauthorized', [GET_USER]],
    ['not an operator', (w) => `Bearer ${seatOperator(w, { operator: false })}`, 403, 'forbidden', [GET_USER, OPERATORS]],
    ['the operator read failing', (w) => {
      const t = seatOperator(w)
      w.table('platform_operators', () => ({ data: null, error: { message: 'database unavailable' } }))
      return `Bearer ${t}`
    }, 503, 'operator_check_failed', [GET_USER, OPERATORS]],
    ['the operator read failing even with a row in hand', (w) => {
      const t = seatOperator(w)
      w.table('platform_operators', () => ({ data: { user_id: 'op-1' }, error: { message: 'database unavailable' } }))
      return `Bearer ${t}`
    }, 503, 'operator_check_failed', [GET_USER, OPERATORS]],
    ['listFactors failing on the error channel', (w) => `Bearer ${seatOperator(w, { factors: new Error('gotrue unavailable') })}`,
      503, 'mfa_check_failed', [GET_USER, OPERATORS, FACTORS]],
    ['listFactors throwing', (w) => {
      const t = seatOperator(w)
      w.auth.admin.listFactors = () => { throw new Error('gotrue threw') }
      return `Bearer ${t}`
    }, 503, 'mfa_check_failed', [GET_USER, OPERATORS, FACTORS]],
    ['no factor at all', (w) => `Bearer ${seatOperator(w, { factors: [] })}`, 403, 'mfa_enrollment_required', [GET_USER, OPERATORS, FACTORS]],
    ['no factor, and aal1 too (enrolment is asked first)', (w) => `Bearer ${seatOperator(w, { factors: [], aal: 'aal1' })}`,
      403, 'mfa_enrollment_required', [GET_USER, OPERATORS, FACTORS]],
    ['only an unverified factor', (w) => `Bearer ${seatOperator(w, { factors: [{ factor_type: 'totp', status: 'unverified' }] })}`,
      403, 'mfa_enrollment_required', [GET_USER, OPERATORS, FACTORS]],
    ['a verified factor with an aal1 token', (w) => `Bearer ${seatOperator(w, { aal: 'aal1' })}`, 403, 'mfa_required', [GET_USER, OPERATORS, FACTORS]],
  ]

  it.each(REFUSALS)('refuses %s', async (_name, seat, status, error, expectedTrips) => {
    const w = newWorld()
    const header = seat(w)
    denoEnv()
    const g = await requirePlatformOperator(signed(header))
    expect(g.ok).toBe(false)
    expect(await shown(g.res)).toEqual({ status, json: { error }, headers: JSON_H })
    expect(trips(w)).toEqual(expectedTrips)
  })

  it('passes with no JWT claims at all, and asks exactly this, in this order', async () => {
    const w = newWorld()
    const token = seatOperator(w)
    denoEnv()
    const g = await requirePlatformOperator(signed(`Bearer ${token}`))
    expect(g.ok).toBe(true)
    // NO workspaceId in the context.
    expect(Object.keys(g.ctx).sort()).toEqual(['admin', 'callerId', 'callerLabel'])
    expect(g.ctx).toMatchObject({ callerId: 'op-1', callerLabel: 'op@example.test' })
    expect(w.clients).toEqual([{ key: SERVICE_KEY, by: 'service', options: undefined }])
    expect(g.ctx.admin).toMatchObject({ key: SERVICE_KEY, by: 'service' })
    expect(w.calls).toEqual([
      { kind: 'auth', name: 'getUser', by: 'service', args: [token] },
      expect.objectContaining({
        kind: 'table', name: 'platform_operators', op: 'select', by: 'service', columns: 'user_id',
        filters: [{ f: 'eq', column: 'user_id', value: 'op-1' }], terminal: 'maybeSingle',
      }),
      { kind: 'auth', name: 'listFactors', by: 'service', args: ['op-1'] },
      expect.objectContaining({
        kind: 'table', name: 'workspace_members', op: 'select', by: 'service', columns: 'username',
        filters: [{ f: 'eq', column: 'user_id', value: 'op-1' }], limit: 1, terminal: 'maybeSingle',
      }),
    ])
  })

  it('passes a token whose claims say something else entirely (app_role user, another workspace)', async () => {
    const w = newWorld()
    seatOperator(w)
    const t = tokenFor({ sub: 'op-1', aal: 'aal2', app_metadata: { app_role: 'user', workspace_id: 'ws-9' } })
    w.auth.users.set(t, { id: 'op-1', email: 'op@example.test' })
    denoEnv()
    const g = await requirePlatformOperator(signed(`Bearer ${t}`))
    expect(g.ok).toBe(true)
    expect(g.ctx.workspaceId).toBeUndefined()
  })

  it('labels the caller by a workspace username when one exists, else the email', async () => {
    const cases = [
      [(w) => seatOperator(w, { username: 'opname' }), 'opname'],
      [(w) => seatOperator(w), 'op@example.test'],
      [(w) => { const t = seatOperator(w); w.table('workspace_members', () => { throw new Error('read threw') }); return t }, 'op@example.test'],
      [(w) => { const t = seatOperator(w); w.table('workspace_members', () => ({ data: null, error: { message: 'x' } })); return t }, 'op@example.test'],
      [(w) => seatOperator(w, { email: null }), null],
    ]
    for (const [seat, label] of cases) {
      const w = newWorld()
      const token = seat(w)
      denoEnv()
      const g = await requirePlatformOperator(signed(`Bearer ${token}`))
      expect(g.ok).toBe(true)
      expect(g.ctx.callerLabel).toBe(label)
    }
  })

  it('logPlatformEvent and logAdminEvent never throw when the insert fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const failing of [
      () => ({ data: null, error: { message: 'check violation' } }),
      () => { throw new Error('insert threw') },
    ]) {
      const w = newWorld()
      w.table('platform_audit', failing).table('app_events', failing)
      const admin = createClient(SUPABASE_URL, SERVICE_KEY)
      await expect(logPlatformEvent({ admin, callerId: 'op-1', callerLabel: 'op' }, { action: 'workspace.renamed', message: 'm' })).resolves.toBeUndefined()
      await expect(logAdminEvent({ admin, callerId: 'user-1', workspaceId: 'ws-1' }, { code: 'c', message: 'm' })).resolves.toBeUndefined()
      expect(trips(w)).toEqual(['table:platform_audit', 'table:app_events'])
    }
  })
})

// ── 4. gatewayGuard ─────────────────────────────────────────────────────────

const CRED = `wgc_${'A'.repeat(43)}`
const CRED_HASH = createHash('sha256').update(CRED).digest('hex')

describe('gatewayGuard', () => {
  it('answer: JSON, the house CORS, no-store; 200 by default', async () => {
    expect(await shown(answer({ a: 1 }))).toEqual({ status: 200, json: { a: 1 }, headers: GW_H })
    expect(await shown(answer({ b: 2 }, 418))).toEqual({ status: 418, json: { b: 2 }, headers: GW_H })
  })

  it('refusal: { error, detail } at its status', async () => {
    expect(await shown(refusal(409, 'busy', 'A sentence.'))).toEqual({ status: 409, json: { error: 'busy', detail: 'A sentence.' }, headers: GW_H })
  })

  it('preflight: 204, no body, the CORS headers only', async () => {
    const a = await answerOf(preflight())
    expect({ status: a.status, text: a.text, headers: a.headers }).toEqual({ status: 204, text: '', headers: CORS })
  })

  it('withMemberSentence rewords 401 and 403, and passes anything else through untouched', async () => {
    expect(await shown(withMemberSentence(reply({ error: 'unauthorized' }, 401)))).toEqual({
      status: 401, headers: GW_H,
      json: { error: 'unauthorized', detail: 'Sign in again: WILSON could not confirm who is asking for this.' },
    })
    // Any 403 becomes `forbidden`, whatever code it carried.
    expect(await shown(withMemberSentence(reply({ error: 'anything' }, 403)))).toEqual({
      status: 403, headers: GW_H,
      json: { error: 'forbidden', detail: 'Your account is not an active member of this company, so WILSON will not do this for it.' },
    })
    for (const status of [200, 400, 429, 503]) {
      const res = reply({ error: 'x' }, status)
      expect(withMemberSentence(res)).toBe(res)
    }
  })

  it('serviceClient: the service key, no session kept or refreshed', () => {
    const w = newWorld()
    denoEnv()
    const c = serviceClient()
    expect(c).toMatchObject({ url: SUPABASE_URL, key: SERVICE_KEY })
    expect(w.clients).toEqual([{ key: SERVICE_KEY, by: 'service', options: NO_PERSIST }])
  })

  /** gateway_secrets and gateways, each answering what the case says. */
  function gatewayWorld({ secret = { data: { gateway_id: 'gw-1' }, error: null }, gateway = { data: { id: 'gw-1', workspace_id: 'ws-1', name: 'Office', version: '1.0.0', revoked_at: null, created_at: 't0' }, error: null } } = {}) {
    const w = newWorld()
    w.table('gateway_secrets', () => secret)
    w.table('gateways', () => gateway)
    return w
  }
  const SECRETS = 'table:gateway_secrets'
  const GATEWAYS = 'table:gateways'
  const NEEDS = "This call needs the gateway's credential (Authorization: Bearer wgc_…)."
  const REVOKED = 'This gateway was forgotten in Settings, so WILSON no longer answers it. Close both doors.'

  const REFUSALS = [
    ['no credential', undefined, {}, 401, 'unauthorized', NEEDS, []],
    ['a bearer that is not a credential', 'Bearer not-a-credential', {}, 401, 'unauthorized', NEEDS, []],
    ['the secret lookup failing', `Bearer ${CRED}`, { secret: { data: null, error: { message: 'x' } } }, 503, 'lookup_failed',
      "WILSON could not check the gateway's credential just now; the gateway will try again.", [SECRETS]],
    ['an unknown credential', `Bearer ${CRED}`, { secret: { data: null, error: null } }, 401, 'unknown_gateway',
      "WILSON does not know this gateway's credential: it was forgotten, or never enrolled. Enrol it again with a new token from Settings, Storage, File gateway.", [SECRETS]],
    ['the gateway read failing', `Bearer ${CRED}`, { gateway: { data: null, error: { message: 'x' } } }, 503, 'lookup_failed',
      'WILSON could not check the gateway just now; the gateway will try again.', [SECRETS, GATEWAYS]],
    ['no gateway row', `Bearer ${CRED}`, { gateway: { data: null, error: null } }, 401, 'revoked', REVOKED, [SECRETS, GATEWAYS]],
    ['a revoked gateway', `Bearer ${CRED}`, { gateway: { data: { id: 'gw-1', workspace_id: 'ws-1', revoked_at: 't1' }, error: null } }, 401, 'revoked', REVOKED, [SECRETS, GATEWAYS]],
  ]

  it.each(REFUSALS)('requireGateway refuses %s', async (_name, header, scripted, status, error, detail, expectedTrips) => {
    const w = gatewayWorld(scripted)
    denoEnv()
    const g = await requireGateway(signed(header))
    expect(g.ok).toBe(false)
    expect(await shown(g.res)).toEqual({ status, json: { error, detail }, headers: GW_H })
    expect(trips(w)).toEqual(expectedTrips)
    expect(w.clients.length).toBe(expectedTrips.length === 0 ? 0 : 1)
  })

  it('requireGateway passes a live gateway, looked up by the credential hash', async () => {
    const w = gatewayWorld()
    denoEnv()
    const g = await requireGateway(signed(`Bearer ${CRED}`))
    expect(g.ok).toBe(true)
    expect(Object.keys(g.ctx).sort()).toEqual(['admin', 'gateway', 'gatewayId', 'workspaceId'])
    expect(g.ctx).toMatchObject({
      gatewayId: 'gw-1', workspaceId: 'ws-1',
      gateway: { id: 'gw-1', workspace_id: 'ws-1', name: 'Office', version: '1.0.0', revoked_at: null, created_at: 't0' },
    })
    expect(w.clients).toEqual([{ key: SERVICE_KEY, by: 'service', options: NO_PERSIST }])
    expect(w.calls).toEqual([
      expect.objectContaining({ name: 'gateway_secrets', by: 'service', columns: 'gateway_id', terminal: 'maybeSingle', filters: [{ f: 'eq', column: 'credential_hash', value: CRED_HASH }] }),
      expect.objectContaining({ name: 'gateways', by: 'service', columns: 'id, workspace_id, name, version, revoked_at, created_at', terminal: 'maybeSingle', filters: [{ f: 'eq', column: 'id', value: 'gw-1' }] }),
    ])
  })

  // Unlike the three user guards, the gateway's bearer IS trimmed (gatewayWire.ts:230);
  // the scheme is matched in any case, as theirs is.
  it('requireGateway trims the bearer and matches the scheme in any case', async () => {
    for (const header of [`Bearer  ${CRED}`, `bearer ${CRED}`, `Bearer ${CRED}  `]) {
      const w = gatewayWorld()
      denoEnv()
      expect((await requireGateway(signed(header))).ok).toBe(true)
      expect(w.calls[0].filters[0].value).toBe(CRED_HASH)
    }
  })
})

// ── 5. Through real handlers ────────────────────────────────────────────────

describe('issue-session', () => {
  async function run(req) {
    const { handler } = await loadFunction(vi, 'issue-session')
    return handler(req)
  }
  const memberships = (w, rows, error = null) => w.table('workspace_members', () => ({ data: rows, error }))

  it('OPTIONS is a 204 with the CORS headers; a non-POST is a 405', async () => {
    const w = newWorld()
    const o = await answerOf(await run(post(undefined, { method: 'OPTIONS' })))
    expect({ status: o.status, text: o.text, headers: o.headers }).toEqual({ status: 204, text: '', headers: CORS })
    expect(await shown(await run(post({}, { method: 'PUT' })))).toEqual({ status: 405, json: { error: 'method_not_allowed' }, headers: JSON_H })
    expect(w.clients).toEqual([])
  })

  it('no token is a 401 before any client is made; a bad token is a 401 after getUser', async () => {
    const w = newWorld()
    expect(await shown(await run(post({})))).toEqual({ status: 401, json: { error: 'unauthorized' }, headers: JSON_H })
    expect(w.clients).toEqual([])
    expect(await shown(await run(post({}, { token: tokenFor({ sub: 'nobody' }) })))).toEqual({ status: 401, json: { error: 'unauthorized' }, headers: JSON_H })
    expect(trips(w)).toEqual([GET_USER])
  })

  it.each([
    ['no active memberships', [], null],
    ['the memberships read failing', null, { message: 'x' }],
    ['the memberships read failing with rows in hand', [{ workspace_id: 'ws-1' }], { message: 'x' }],
  ])('%s is a 403 no_workspaces', async (_name, rows, error) => {
    const w = newWorld()
    const { token } = seatCaller(w)
    memberships(w, rows, error)
    expect(await shown(await run(post({}, { token })))).toEqual({ status: 403, json: { error: 'no_workspaces' }, headers: JSON_H })
    expect(trips(w)).toEqual([GET_USER, MEMBERS])
  })

  it.each([
    ['a workspace the caller belongs to is honoured', JSON.stringify({ workspace_id: 'ws-b' }), 'ws-b'],
    ['a workspace the caller does not belong to falls back to the oldest', JSON.stringify({ workspace_id: 'ws-other' }), 'ws-a'],
    ['no workspace asked is the oldest', JSON.stringify({}), 'ws-a'],
    ['a body that is not JSON is the oldest', 'not json', 'ws-a'],
  ])('%s', async (_name, raw, active) => {
    const w = newWorld()
    const { token } = seatCaller(w)
    memberships(w, [{ workspace_id: 'ws-a' }, { workspace_id: 'ws-b' }])
    const res = await run(post(undefined, { token, raw }))
    expect(await shown(res)).toEqual({ status: 200, json: { workspace_id: active, workspace_ids: ['ws-a', 'ws-b'] }, headers: JSON_H })
    expect(w.calls).toEqual([
      { kind: 'auth', name: 'getUser', by: 'service', args: [token] },
      expect.objectContaining({
        kind: 'table', name: 'workspace_members', op: 'select', by: 'service', columns: 'workspace_id', terminal: null,
        filters: [{ f: 'eq', column: 'user_id', value: 'user-1' }, { f: 'eq', column: 'is_active', value: true }],
        order: [{ column: 'created_at', options: { ascending: true } }],
      }),
      { kind: 'auth', name: 'updateUserById', by: 'service', args: ['user-1', { app_metadata: { workspace_id: active } }] },
    ])
    // One client: the service key with NO options (unlike gatewayGuard's serviceClient).
    expect(w.clients).toEqual([{ key: SERVICE_KEY, by: 'service', options: undefined }])
  })

  it("keeps the rest of the user's app_metadata when it writes the workspace", async () => {
    const w = newWorld()
    const { token } = seatCaller(w)
    w.auth.users.get(token).app_metadata = { provider: 'email', workspace_id: 'ws-old' }
    memberships(w, [{ workspace_id: 'ws-a' }])
    await run(post({}, { token }))
    expect(w.calls.at(-1).args).toEqual(['user-1', { app_metadata: { provider: 'email', workspace_id: 'ws-a' } }])
  })

  it('a failed update is a 500 update_failed', async () => {
    const w = newWorld()
    const { token } = seatCaller(w)
    memberships(w, [{ workspace_id: 'ws-a' }])
    w.auth.admin.updateUserById = () => ({ data: null, error: { message: 'x' } })
    expect(await shown(await run(post({}, { token })))).toEqual({ status: 500, json: { error: 'update_failed' }, headers: JSON_H })
  })
})

describe('admin-user-security', () => {
  /** The caller (an admin, user-1) and a target (user-2) in the same workspace. */
  function securityWorld({ target = { username: 'tgt', is_active: true }, user = { id: 'user-2', email: 't@example.test', last_sign_in_at: '2026-11-01T00:00:00Z' } } = {}) {
    const w = newWorld()
    const { token } = seatCaller(w)
    w.table('workspace_members', (q) => {
      const uid = q.filters.find((f) => f.column === 'user_id')?.value
      if (uid === 'user-1') return { data: { app_role: 'admin', is_active: true }, error: null }
      return { data: uid === 'user-2' ? target : null, error: null }
    })
    if (user) w.auth.byId.set('user-2', user)
    return { w, token }
  }
  async function ask(token) {
    const { handler } = await loadFunction(vi, 'admin-user-security')
    return shown(await handler(post({ user_id: 'user-2' }, { token })))
  }

  it('counts only verified TOTP factors, and answers these keys', async () => {
    const { w, token } = securityWorld()
    w.auth.factors.set('user-2', [
      { factor_type: 'totp', status: 'verified' }, { factor_type: 'totp', status: 'verified' },
      { factor_type: 'totp', status: 'unverified' }, { factor_type: 'phone', status: 'verified' },
    ])
    expect(await ask(token)).toEqual({
      status: 200, headers: JSON_H,
      json: {
        user_id: 'user-2', username: 'tgt', is_active: true, email: 't@example.test',
        last_sign_in_at: '2026-11-01T00:00:00Z', banned_until: null, mfa_enrolled: true, factor_count: 2,
      },
    })
    expect(trips(w)).toEqual([GET_USER, MEMBERS, FACTORS, MEMBERS, 'auth:getUserById', FACTORS])
    expect(tables(w, 'workspace_members')[1]).toMatchObject({
      columns: 'username, is_active', terminal: 'maybeSingle',
      filters: [{ f: 'eq', column: 'workspace_id', value: 'ws-1' }, { f: 'eq', column: 'user_id', value: 'user-2' }],
    })
  })

  // admin-user-security/index.ts:39 reads only `data`: a failed read on the error channel
  // reports "not enrolled", exactly as a throw does, where both guards would refuse.
  it.each([
    ['failing on the error channel', (w) => w.auth.factors.set('user-2', new Error('gotrue unavailable'))],
    ['throwing', (w) => {
      w.auth.admin.listFactors = (userId) => {
        if (userId === 'user-2') throw new Error('gotrue threw')
        return { data: { factors: [] }, error: null }
      }
    }],
  ])("reports unenrolled when the target's factor read is %s", async (_name, fail) => {
    const { w, token } = securityWorld()
    fail(w)
    const a = await ask(token)
    expect(a.status).toBe(200)
    expect(a.json).toMatchObject({ mfa_enrolled: false, factor_count: 0 })
  })

  // Review round 1, G2: at a71cd144 this read destructured `data` alone and counted the
  // verified TOTP factors in it, whatever the error channel said; only a throw was 0.
  it.each([
    ['a verified factor in data, the error channel set too: counted', { data: { factors: VERIFIED_TOTP }, error: { message: 'x' } }, true, 1],
    ['no data, the error channel set: 0', { data: null, error: { message: 'x' } }, false, 0],
    ['a throw: 0', 'throw', false, 0],
  ])("the target's factor read: %s", async (_name, answer, enrolled, count) => {
    const { w, token } = securityWorld()
    w.auth.admin.listFactors = (userId) => {
      if (userId !== 'user-2') return { data: { factors: [] }, error: null }
      if (answer === 'throw') throw new Error('gotrue threw')
      return answer
    }
    const a = await ask(token)
    expect(a.status).toBe(200)
    expect(a.json).toMatchObject({ mfa_enrolled: enrolled, factor_count: count })
    expect(trips(w)).toEqual([GET_USER, MEMBERS, FACTORS, MEMBERS, 'auth:getUserById', FACTORS])
  })

  it("the CALLER's factor read with a verified factor in data and the error channel set: the guard's 503, as before", async () => {
    const { w, token } = securityWorld()
    w.auth.admin.listFactors = () => ({ data: { factors: VERIFIED_TOTP }, error: { message: 'x' } })
    expect(await ask(token)).toEqual({ status: 503, json: { error: 'mfa_check_failed' }, headers: JSON_H })
    expect(trips(w)).toEqual([GET_USER, MEMBERS, FACTORS])
  })

  it('no target row is a 404 not_found, before the user lookup', async () => {
    const { w, token } = securityWorld({ target: null })
    expect(await ask(token)).toEqual({ status: 404, json: { error: 'not_found' }, headers: JSON_H })
    expect(trips(w)).toEqual([GET_USER, MEMBERS, FACTORS, MEMBERS])
  })

  it('a user lookup that fails is a 502 lookup_failed', async () => {
    const { w, token } = securityWorld({ user: null })
    expect(await ask(token)).toEqual({ status: 502, json: { error: 'lookup_failed' }, headers: JSON_H })
    expect(trips(w)).toEqual([GET_USER, MEMBERS, FACTORS, MEMBERS, 'auth:getUserById'])
  })

  it('missing fields on the user answer null', async () => {
    const { token } = securityWorld({ user: { id: 'user-2' } })
    expect((await ask(token)).json).toEqual({
      user_id: 'user-2', username: 'tgt', is_active: true, email: null,
      last_sign_in_at: null, banned_until: null, mfa_enrolled: false, factor_count: 0,
    })
  })
})

describe("gateway-reach rewords the admin guard's refusals", () => {
  const CASES = [
    ['no token', () => null, {}, 401, 'unauthorized', 'Sign in again: WILSON could not confirm who is asking for this.'],
    ['a verified factor with aal1', (w) => seatCaller(w, { factors: VERIFIED_TOTP }).token, {}, 403, 'mfa_required',
      "Sign in with your authenticator code first: checking the gateway's reach needs two-factor."],
    ['never enrolled, the flag on', (w) => seatCaller(w).token, { WILSON_REQUIRE_ADMIN_MFA: '1' }, 403, 'mfa_enrollment_required',
      'Enrol an authenticator on your account first: this environment asks every admin for two-factor.'],
    ['not an admin', (w) => seatCaller(w, { role: 'user' }).token, {}, 403, 'forbidden',
      'Only a workspace admin can check whether the gateway is reachable from outside.'],
    ['an inactive admin row', (w) => seatCaller(w, { active: false }).token, {}, 403, 'forbidden',
      'Only a workspace admin can check whether the gateway is reachable from outside.'],
    ['the factor read failing', (w) => { const { token } = seatCaller(w); w.auth.factors.set('user-1', new Error('x')); return token }, {}, 503, 'mfa_check_failed',
      'WILSON could not check your two-factor status just now; try again in a moment.'],
  ]
  it.each(CASES)('%s', async (_name, seat, env, status, error, detail) => {
    const w = newWorld()
    const token = seat(w)
    const { handler } = await loadFunction(vi, 'gateway-reach', env)
    expect(await shown(await handler(post({ gateway_id: GW_ID }, { token })))).toEqual({ status, json: { error, detail }, headers: GW_H })
  })
})

describe("gateway-ticket rewords the member guard's refusals", () => {
  const CASES = [
    ['no token', () => null, 401, 'unauthorized', 'Sign in again: WILSON could not confirm who is asking for this.'],
    ['a token GoTrue refuses', () => tokenFor({ sub: 'nobody' }), 401, 'unauthorized', 'Sign in again: WILSON could not confirm who is asking for this.'],
    ['no membership row', (w) => seatCaller(w, { member: false }).token, 403, 'forbidden',
      'Your account is not an active member of this company, so WILSON will not do this for it.'],
    ['an inactive row', (w) => seatCaller(w, { active: false }).token, 403, 'forbidden',
      'Your account is not an active member of this company, so WILSON will not do this for it.'],
  ]
  it.each(CASES)('%s', async (_name, seat, status, error, detail) => {
    const w = newWorld()
    const token = seat(w)
    const { handler } = await loadFunction(vi, 'gateway-ticket')
    expect(await shown(await handler(post({ gateway_id: GW_ID, bin_file_ids: [GW_ID] }, { token })))).toEqual({ status, json: { error, detail }, headers: GW_H })
  })
})

describe("the client that carries the caller's own token", () => {
  const KEY = `projects/${PROJECT}/shots/${GW_ID}/1-a.jpg`
  // [function, body, the auth options it adds (null: none), what it answers once that
  // client finds nothing, the first thing it asks as the caller]
  const FUNCTIONS = [
    ['gateway-reach', { gateway_id: GW_ID }, NO_PERSIST.auth,
      { status: 404, json: { error: 'not_found', detail: "That gateway is not in this company's list." } }, 'caller:gateways'],
    ['gateway-ticket', { gateway_id: GW_ID, bin_file_ids: [GW_ID] }, NO_PERSIST.auth,
      { status: 404, json: { error: 'gateway_unavailable', detail: "That gateway is not available to you: it was forgotten, it is another company's, or its fingerprint has not been confirmed yet." } }, 'caller:gateways_visible'],
    ['storage-presign', { op: 'get', path: KEY }, null,
      { status: 403, json: { error: 'refused', detail: 'you cannot presign for this project' } }, 'caller:can_presign_object'],
    ['storage-read-urls', { keys: [KEY] }, null,
      { status: 200, json: { ok: true, urls: {}, expires: {}, refused: { [KEY]: 'row' } } }, 'caller:files'],
  ]
  // The header as sent. The client is given 'Bearer ' + header.slice(7): the scheme's
  // case is normalised and a second space is kept.
  const HEADERS = [
    ['Bearer <token>', (t) => `Bearer ${t}`],
    ['bearer <token>', (t) => `bearer ${t}`],
    ['Bearer  <token> (two spaces)', (t) => `Bearer  ${t}`],
  ]
  const ROWS = FUNCTIONS.flatMap((f) => HEADERS.map((h) => [f[0], h[0], f, h[1]]))

  it.each(ROWS)('%s, sent %s', async (name, _label, [, body, auth, outcome, firstAsked], headerFor) => {
    const w = newWorld()
    const { token } = seatCaller(w)
    // GoTrue knows the spaced form too, so the guard passes and the client gets made.
    w.auth.users.set(` ${token}`, w.auth.users.get(token))
    w.rpc('fn_rate_limit_hit', () => ({ data: false }))
    const header = headerFor(token)
    const { handler } = await loadFunction(vi, name)
    const a = await shown(await handler(post(body, { headers: { authorization: header } })))
    expect({ status: a.status, json: a.json }).toEqual(outcome)
    const options = { global: { headers: { Authorization: `Bearer ${header.slice(7)}` } } }
    if (auth) options.auth = auth
    expect(w.clients).toEqual([
      { key: SERVICE_KEY, by: 'service', options: undefined },
      { key: ANON_KEY, by: 'caller', options },
    ])
    // The guard's read and the limiter by the service client, then the predicate by the caller's.
    expect(w.calls.filter((c) => c.kind !== 'auth').map((c) => `${c.by}:${c.name}`)).toEqual([
      'service:workspace_members', 'service:fn_rate_limit_hit', firstAsked,
    ])
  })
})

// ── 6. Every function's OPTIONS and GET ─────────────────────────────────────

describe('OPTIONS and GET, every function', () => {
  const PLAIN_405 = { status: 405, json: { error: 'method_not_allowed' }, headers: JSON_H }
  const GATEWAY_405 = { status: 405, json: { error: 'method_not_allowed', detail: 'Use POST.' }, headers: GW_H }
  // [function, OPTIONS status, the GET's answer]. The three that answer OPTIONS with a 200
  // build `new Response(null, { headers })` with no status (storage-presign/index.ts:89,
  // storage-secret/index.ts:63, storage-read-urls/index.ts:142); the rest say 204.
  const TABLE = [
    ['admin-create-user', 204, PLAIN_405],
    ['admin-reset-password', 204, PLAIN_405],
    ['admin-set-active', 204, PLAIN_405],
    ['admin-user-security', 204, PLAIN_405],
    ['ai-proxy', 204, PLAIN_405],
    ['gateway-enrol', 204, GATEWAY_405],
    ['gateway-events', 204, GATEWAY_405],
    ['gateway-reach', 204, GATEWAY_405],
    ['gateway-sync', 204, GATEWAY_405],
    ['gateway-ticket', 204, GATEWAY_405],
    ['invite-member', 204, PLAIN_405],
    ['issue-session', 204, PLAIN_405],
    ['operator-ai-keys', 204, PLAIN_405],
    ['operator-models', 204, PLAIN_405],
    ['operator-storage-plans', 204, PLAIN_405],
    ['operator-workspaces', 204, PLAIN_405],
    // resolve-login's 405 is its uniform not-found shape, after its ~180 ms floor.
    ['resolve-login', 204, { status: 405, json: { exists: false, email: null }, headers: JSON_H }],
    ['storage-presign', 200, PLAIN_405],
    ['storage-read-urls', 200, PLAIN_405],
    ['storage-secret', 200, PLAIN_405],
  ]

  it.each(TABLE)('%s', async (name, optionsStatus, getAnswer) => {
    const w = newWorld()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in this test') }))
    const { handler } = await loadFunction(vi, name)
    const o = await answerOf(await handler(post(undefined, { method: 'OPTIONS' })))
    expect({ status: o.status, text: o.text, headers: o.headers }).toEqual({ status: optionsStatus, text: '', headers: CORS })
    expect(await shown(await handler(post(undefined, { method: 'GET' })))).toEqual(getAnswer)
    // Neither asked the database anything, nor made a client.
    expect(w.calls).toEqual([])
    expect(w.clients).toEqual([])
  })
})

// ── 7. A token whose payload is JSON null (review round 1, G1) ──────────────
//
// GoTrue accepts it here (the harness's users map knows it); a real GoTrue would
// not mint one, so this is about WHEN each caller decodes the token, which is
// where the old code would throw. At a71cd144 the admin and member guards decoded
// it right after GoTrue and read `.app_metadata` of null; the operator guard
// decoded it only for `aal`, after its platform_operators read and its factor
// read; issue-session never decoded it at all. Each must still do exactly that.

describe('a token GoTrue accepts whose payload is JSON null: each caller decodes it where it always did', () => {
  const b64url = (s) => Buffer.from(s).toString('base64url')
  const NULL_TOKEN = `${b64url('{"alg":"ES256"}')}.${b64url('null')}.sig`
  const NULL_META = "Cannot read properties of null (reading 'app_metadata')"
  const NULL_AAL = "Cannot read properties of null (reading 'aal')"
  const thrown = (p) => p.then((v) => ({ resolved: v }), (e) => ({ name: e?.constructor?.name, message: e?.message }))

  it('adminGuard: the TypeError on app_metadata right after GoTrue, as before', async () => {
    const w = newWorld()
    w.auth.users.set(NULL_TOKEN, { id: 'user-1', app_metadata: { workspace_id: 'ws-1' } })
    membersAnswer(w, { app_role: 'admin', is_active: true })
    denoEnv()
    expect(await thrown(requireWorkspaceAdmin(signed(`Bearer ${NULL_TOKEN}`)))).toEqual({ name: 'TypeError', message: NULL_META })
    expect(trips(w)).toEqual([GET_USER])
  })

  it('memberGuard: the same TypeError at the same point', async () => {
    const w = newWorld()
    w.auth.users.set(NULL_TOKEN, { id: 'user-1', app_metadata: { workspace_id: 'ws-1' } })
    membersAnswer(w, { is_active: true })
    denoEnv()
    expect(await thrown(requireActiveMember(signed(`Bearer ${NULL_TOKEN}`)))).toEqual({ name: 'TypeError', message: NULL_META })
    expect(trips(w)).toEqual([GET_USER])
  })

  describe('operatorGuard: the operator row and the factors first, the token decoded only for aal', () => {
    function seatNull(w, { operator = true, factors = VERIFIED_TOTP } = {}) {
      w.auth.users.set(NULL_TOKEN, { id: 'op-1', email: 'op@example.test' })
      w.auth.factors.set('op-1', factors)
      w.table('platform_operators', () => ({ data: operator ? { user_id: 'op-1' } : null, error: null }))
      w.table('workspace_members', () => ({ data: null, error: null }))
    }
    it.each([
      ['no operator row: 403 forbidden', { operator: false }, { status: 403, error: 'forbidden' }, [GET_USER, OPERATORS]],
      ['the factor read failing: 503 mfa_check_failed', { factors: new Error('gotrue unavailable') }, { status: 503, error: 'mfa_check_failed' }, [GET_USER, OPERATORS, FACTORS]],
      ['no verified factor: 403 mfa_enrollment_required', { factors: [] }, { status: 403, error: 'mfa_enrollment_required' }, [GET_USER, OPERATORS, FACTORS]],
    ])('%s', async (_name, seat, { status, error }, expectedTrips) => {
      const w = newWorld()
      seatNull(w, seat)
      denoEnv()
      const g = await requirePlatformOperator(signed(`Bearer ${NULL_TOKEN}`))
      expect(g.ok).toBe(false)
      expect(await shown(g.res)).toEqual({ status, json: { error }, headers: JSON_H })
      expect(trips(w)).toEqual(expectedTrips)
    })
    it('a verified factor: the TypeError on aal, where aal is read (and never the label read after it)', async () => {
      const w = newWorld()
      seatNull(w)
      denoEnv()
      expect(await thrown(requirePlatformOperator(signed(`Bearer ${NULL_TOKEN}`)))).toEqual({ name: 'TypeError', message: NULL_AAL })
      expect(trips(w)).toEqual([GET_USER, OPERATORS, FACTORS])
    })
  })

  it('issue-session never decodes it: 200 with the workspaces, through the real handler', async () => {
    const w = newWorld()
    w.auth.users.set(NULL_TOKEN, { id: 'user-1', app_metadata: { workspace_id: 'ws-a' } })
    w.table('workspace_members', () => ({ data: [{ workspace_id: 'ws-a' }, { workspace_id: 'ws-b' }], error: null }))
    const { handler } = await loadFunction(vi, 'issue-session')
    const res = await handler(post({ workspace_id: 'ws-b' }, { token: NULL_TOKEN }))
    expect(await shown(res)).toEqual({ status: 200, json: { workspace_id: 'ws-b', workspace_ids: ['ws-a', 'ws-b'] }, headers: JSON_H })
    expect(trips(w)).toEqual([GET_USER, MEMBERS, 'auth:updateUserById'])
    expect(w.calls.at(-1).args).toEqual(['user-1', { app_metadata: { workspace_id: 'ws-b' } }])
  })
})
