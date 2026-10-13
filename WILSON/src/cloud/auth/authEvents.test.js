// =============================================================================
// authEvents.test.js — Track B bundle B2, part 2.
//
// Pins the client's contract with migration 0070: the body carries the kind,
// a success outcome, the client source and a context — and NOTHING that
// identifies the row, because the stamp trigger owns those columns and the
// INSERT policy refuses a body that names anyone else. Also pins the two
// ways a log write fails quietly in this codebase (a resolved { error } and
// a hung request), both of which must come back as { ok: false }.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./supabaseClient', () => ({
  supabase: { from: () => { throw new Error('the default client must not be used in this test') } },
}))

import { recordAuthEvent, CLIENT_EVENT_KINDS, AUTH_EVENT_TIMEOUT_MS } from './authEvents'

const IDENTITY_COLUMNS = ['user_id', 'workspace_id', 'session_id', 'ip_address', 'user_agent', 'created_at', 'id']

function fakeClient(result) {
  const calls = []
  return {
    calls,
    from(table) {
      return {
        insert(body) {
          calls.push({ table, body })
          return typeof result === 'function' ? result() : Promise.resolve(result)
        },
      }
    },
  }
}

let warn
beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { warn.mockRestore(); vi.useRealTimers() })

describe('recordAuthEvent', () => {
  it('writes exactly kind / outcome / source / context, and no identity column', async () => {
    const client = fakeClient({ error: null })
    const res = await recordAuthEvent('sign_in', {}, { client })
    expect(res).toEqual({ ok: true })
    expect(client.calls).toHaveLength(1)
    expect(client.calls[0].table).toBe('auth_events')
    const body = client.calls[0].body
    expect(Object.keys(body).sort()).toEqual(['context', 'kind', 'outcome', 'source'])
    expect(body.kind).toBe('sign_in')
    expect(body.outcome).toBe('success')
    expect(body.source).toBe('client')
    for (const col of IDENTITY_COLUMNS) expect(body).not.toHaveProperty(col)
  })

  it('stamps the surface into context and keeps caller context beside it', async () => {
    const client = fakeClient({ error: null })
    await recordAuthEvent('idle_timeout', { reason: 'test' }, { client })
    // vitest has no __WILSON_SURFACE__ define, so the module falls back to 'app'
    expect(client.calls[0].body.context).toEqual({ surface: 'app', reason: 'test' })
  })

  it('accepts every client kind the policy allows', async () => {
    for (const kind of CLIENT_EVENT_KINDS) {
      const client = fakeClient({ error: null })
      await expect(recordAuthEvent(kind, {}, { client })).resolves.toEqual({ ok: true })
    }
    expect(CLIENT_EVENT_KINDS).toEqual(['sign_in', 'sign_out', 'idle_timeout', 'session_cap'])
  })

  it('refuses a kind the policy would refuse, without touching the client', async () => {
    const client = fakeClient({ error: null })
    const res = await recordAuthEvent('mfa_verify', {}, { client })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('unknown_kind')
    expect(client.calls).toHaveLength(0)
  })

  it('reports a resolved { error } as a failure — the supabase-js error channel is read', async () => {
    const client = fakeClient({ error: { code: '42501', message: 'new row violates row-level security policy' } })
    const res = await recordAuthEvent('sign_out', {}, { client })
    expect(res).toEqual({ ok: false, reason: '42501' })
    expect(warn).toHaveBeenCalled()
  })

  it('gives up on a hung insert after the ceiling instead of holding the sign-out', async () => {
    vi.useFakeTimers()
    const client = fakeClient(() => new Promise(() => {}))   // never settles
    const p = recordAuthEvent('sign_out', {}, { client })
    await vi.advanceTimersByTimeAsync(AUTH_EVENT_TIMEOUT_MS)
    await expect(p).resolves.toEqual({ ok: false, reason: 'timeout' })
  })

  it('never throws when the client rejects outright', async () => {
    const client = fakeClient(() => Promise.reject(new Error('network down')))
    await expect(recordAuthEvent('session_cap', {}, { client })).resolves.toEqual({ ok: false, reason: 'network down' })
  })
})
