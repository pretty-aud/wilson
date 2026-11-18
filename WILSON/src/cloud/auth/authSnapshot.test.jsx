/** @vitest-environment jsdom */
// =============================================================================
// authSnapshot.test.jsx — F5 item 7 (2026-11-16; the review's shared B3 and
// B4): one auth snapshot for every reader, and the active workspace read from
// the access token's claim everywhere.
//
// The pins:
//   (a) 37 mounted readers of usePermissions make ONE onAuthStateChange
//       subscription and ONE getSession() call;
//   (b) a TOKEN_REFRESHED whose claims say the same redraws none of them;
//   (c) a session whose user object says ws-A while its token's claim says
//       ws-B (a deactivated membership: the access-token hook re-derives the
//       claim, the user object keeps what issue-session last wrote):
//       usePermissions, workspaceFromSession, the app_events row, a model
//       override and R.A.B.B.I.T.'s workspace channel all take ws-B;
//   (d) a sign-out empties the snapshot at once, and a second person signing
//       in over the first is never shown with the first one's id or company
//       in any reader, a read asked before both and answered after included.
//
// MEASURED BEFORE (2026-11-16, abb6b2d5's usePermissions restored for the run):
// (a) 37 subscriptions and 37 getSession calls (74 and 74 under StrictMode);
// (b) the TOKEN_REFRESHED redrew all 37 readers; (d) the late answer of a read
// asked before the change put the first person back in every reader.
// =============================================================================
import { renderSpy } from '../../lib/renderSpy'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StrictMode } from 'react'
import { render, renderHook, act, cleanup, waitFor } from '@testing-library/react'
import { mountRabbit } from '../../tools/rabbit_v0.1.0/state/mountRabbit'

// The SDK at its module boundary: every subscription and every session read is
// counted; `from` records what would be written.
const sdk = vi.hoisted(() => ({ listeners: [], subscribed: 0, getSession: null, writes: [], adapter: null, channels: [] }))
vi.mock('./supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: (...a) => sdk.getSession(...a),
      onAuthStateChange: (cb) => {
        sdk.subscribed += 1
        sdk.listeners.push(cb)
        return { data: { subscription: { unsubscribe: () => { sdk.listeners = sdk.listeners.filter((l) => l !== cb) } } } }
      },
    },
    from: (table) => ({
      insert: async (row) => { sdk.writes.push({ table, row }); return { error: null } },
      upsert: (row) => {
        sdk.writes.push({ table, row })
        return { select: async () => ({ data: [{ registry_key: row.registry_key }], error: null }) }
      },
      select: async () => ({ data: [], error: null }),
    }),
  },
}))
// R.A.B.B.I.T. over the dev fixtures' adapter, on the cloud (projectAudience.test.jsx's mount).
vi.mock('../../tools/rabbit_v0.1.0/adapters', () => ({
  selectAdapter: () => sdk.adapter,
  ADAPTER_MODES: ['supabase', 'local_server', 'google_drive'],
  adapterSupportsWrites: () => true,
}))
vi.mock('../../tools/rabbit_v0.1.0/adapters/supabaseAdapter', () => ({ resetSupabaseAdapter: () => {} }))
vi.mock('../../lib/localData', () => ({
  hasLocalServer: () => false,
  loadOtterSettings: async () => ({ rabbit: { adapterMode: 'supabase', activeProjectId: null } }),
  saveOtterSettings: async () => {},
}))
vi.mock('../../dev/devFixtures', async (importOriginal) => ({ ...(await importOriginal()), devFixtures: () => null }))
vi.mock('../../tools/rabbit_v0.1.0/intake/pipeline', () => ({ runIngestion: vi.fn() }))

const { usePermissions } = await import('../../permissions/usePermissions')
const { getAuthSnapshot, useAuthSnapshot, workspaceFromSession } = await import('./authSnapshot')
const { setHeldSession } = await import('./heldSession')
const { reportAppEvent } = await import('../errorCodes')
const { setUserModelOverride } = await import('../../lib/modelSources')
const { buildDevFixtures } = await import('../../dev/fixtures/install')
const { RabbitProvider } = await import('../../tools/rabbit_v0.1.0/state/RabbitProvider')

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const tokenFor = (claims) => `${b64({ alg: 'ES256', typ: 'JWT' })}.${b64(claims)}.sig`
/** A session as GoTrue hands it out: the claims in the token, and the user object beside it. */
const sessionOf = (sub, ws, role, { iat = 1000, userWs = ws } = {}) => ({
  access_token: tokenFor({ sub, iat, exp: iat + 3600, session_id: `s-${sub}`, app_metadata: { workspace_id: ws, workspace_ids: [ws], app_role: role } }),
  refresh_token: `r-${sub}-${iat}`,
  user: { id: sub, app_metadata: { workspace_id: userWs } },
})
const fire = (event, session) => { for (const l of [...sdk.listeners]) l(event, session) }
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }

const N = 37
const seen = []
let lastSnapshot = null
function PermsReader({ i, log }) {
  const p = usePermissions()
  seen[i] = p
  log?.push({ i, userId: p.userId, workspaceId: p.workspaceId })
  return null
}
function SnapshotReader({ log }) {
  const s = useAuthSnapshot()
  lastSnapshot = s
  log?.push({ i: 'snapshot', userId: s.userId, workspaceId: s.workspaceId })
  return null
}
const readers = (n, log) => Array.from({ length: n }, (_, i) => <PermsReader key={i} i={i} log={log} />)
/** The last thing each reader drew. */
const lastOf = (log) => Object.fromEntries(log.map((e) => [e.i, `${e.userId}@${e.workspaceId}`]))

beforeEach(() => {
  sdk.listeners = []
  sdk.subscribed = 0
  sdk.writes = []
  sdk.adapter = null
  sdk.channels = []
  sdk.getSession = vi.fn(async () => ({ data: { session: null } }))
  seen.length = 0
  lastSnapshot = null
})
afterEach(async () => {
  cleanup()
  act(() => setHeldSession(null))
  renderSpy.reset()
  // The store detaches a microtask after its last reader leaves.
  await new Promise((r) => setTimeout(r, 0))
})

describe('(a) 37 mounted readers of usePermissions', () => {
  it('make ONE auth subscription and ONE getSession call (before: 37 and 37)', async () => {
    sdk.getSession = vi.fn(async () => ({ data: { session: sessionOf('u-1', 'w-1', 'admin') } }))
    let view
    await act(async () => { view = render(<>{readers(N)}</>) })
    expect({ subscriptions: sdk.subscribed, getSessionCalls: sdk.getSession.mock.calls.length }).toEqual({ subscriptions: 1, getSessionCalls: 1 })
    // every one of them read it
    expect(seen.filter((p) => p.ready && p.userId === 'u-1' && p.workspaceId === 'w-1' && p.can('project.create'))).toHaveLength(N)
    // and the last one leaving detaches the store
    view.unmount()
    await new Promise((r) => setTimeout(r, 0))
    expect(sdk.listeners).toHaveLength(0)
  })

  it('and under StrictMode, whose unmount and mount in one commit keep the one attachment (before: 74 and 74)', async () => {
    sdk.getSession = vi.fn(async () => ({ data: { session: sessionOf('u-1', 'w-1', 'admin') } }))
    await act(async () => { render(<StrictMode>{readers(N)}</StrictMode>) })
    expect({ subscriptions: sdk.subscribed, getSessionCalls: sdk.getSession.mock.calls.length }).toEqual({ subscriptions: 1, getSessionCalls: 1 })
    expect(sdk.listeners).toHaveLength(1)
  })
})

describe('(b) a TOKEN_REFRESHED whose claims say the same', () => {
  it('redraws none of the 37 readers (before: every one redrew)', async () => {
    const first = sessionOf('u-1', 'w-1', 'admin', { iat: 1000 })
    sdk.getSession = vi.fn(async () => ({ data: { session: first } }))
    await act(async () => { render(<>{readers(N)}</>) })
    renderSpy.assertSeen('PermsReader')
    const before = [...seen]
    // a new token, a new expiry: the same person, company and role
    const refreshed = sessionOf('u-1', 'w-1', 'admin', { iat: 4000 })
    expect(refreshed.access_token).not.toBe(first.access_token)
    let mark = renderSpy.mark()
    await act(async () => { fire('TOKEN_REFRESHED', refreshed) })
    expect({ readerRedraws: renderSpy.renders('PermsReader', mark) }).toEqual({ readerRedraws: 0 })
    expect(seen.every((p, i) => p === before[i])).toBe(true)
    expect(getAuthSnapshot().token).toBe(refreshed.access_token)   // the store holds the new token all the same

    // CONTROL: a refresh that moves a claim (the role) redraws every one of them.
    mark = renderSpy.mark()
    await act(async () => { fire('TOKEN_REFRESHED', sessionOf('u-1', 'w-1', 'manager', { iat: 5000 })) })
    expect({ readerRedraws: renderSpy.renders('PermsReader', mark) }).toEqual({ readerRedraws: N })
    expect(seen.every((p) => p.role === 'manager')).toBe(true)
  })
})

describe("(c) a session whose user object says ws-A while its token's claim says ws-B", () => {
  const SPLIT = sessionOf('u-1', 'ws-B', 'user', { userWs: 'ws-A' })
  beforeEach(() => { sdk.getSession = vi.fn(async () => ({ data: { session: SPLIT } })) })

  it('usePermissions: ws-B', async () => {
    const { result } = renderHook(() => usePermissions())
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect({ workspaceId: result.current.workspaceId, workspaceIds: result.current.workspaceIds }).toEqual({ workspaceId: 'ws-B', workspaceIds: ['ws-B'] })
  })

  it('workspaceFromSession: ws-B; the user object only when there is no token to read', () => {
    expect(workspaceFromSession(SPLIT)).toBe('ws-B')
    // a test's session, with no token: the user object's
    expect(workspaceFromSession({ user: { id: 'u-1', app_metadata: { workspace_id: 'ws-A' } } })).toBe('ws-A')
    // a token that decodes with no workspace claim: no company, never the user object's
    expect(workspaceFromSession({ access_token: tokenFor({ sub: 'u-1', app_metadata: {} }), user: { app_metadata: { workspace_id: 'ws-A' } } })).toBe(null)
    expect(workspaceFromSession(null)).toBe(null)
  })

  it("errorCodes: the app_events row is written for ws-B (RLS's company), not refused for ws-A", async () => {
    await reportAppEvent({ code: 'WIL-2001', eventType: 'error', severity: 'warning' })
    expect(sdk.writes.map((w) => [w.table, w.row.workspace_id])).toEqual([['app_events', 'ws-B']])
  })

  it('modelSources: a model override is written for ws-B', async () => {
    const r = await setUserModelOverride('dog.fullDeck', 'claude-opus-4-1')
    expect(r).toEqual({ ok: true, error: null })
    expect(sdk.writes.filter((w) => w.table === 'user_model_overrides').map((w) => w.row.workspace_id)).toEqual(['ws-B'])
  })

  it("R.A.B.B.I.T.: the workspace channel's key is ws-B", async () => {
    const adapter = buildDevFixtures().rabbitAdapter()
    adapter.subscribeWorkspaceChanges = (workspaceId) => { sdk.channels.push(workspaceId); return () => {} }
    sdk.adapter = adapter
    await mountRabbit(<RabbitProvider><span /></RabbitProvider>)
    // the boot reads the settings, then the channel joins: a loaded full run can take longer than waitFor's 1 s
    await waitFor(() => expect(sdk.channels.length).toBeGreaterThan(0), { timeout: 3000 })
    expect([...new Set(sdk.channels)]).toEqual(['ws-B'])
  })
})

describe('(d) a change of person', () => {
  const A = sessionOf('u-A', 'w-A', 'admin')
  const B = sessionOf('u-B', 'w-B', 'user')

  it('a sign-out empties the snapshot at once, and every reader with it', async () => {
    sdk.getSession = vi.fn(async () => ({ data: { session: A } }))
    await act(async () => { render(<>{readers(5)}<SnapshotReader /></>) })
    expect(seen.map((p) => p.userId)).toEqual(Array(5).fill('u-A'))
    let atOnce = null
    act(() => {
      fire('SIGNED_OUT', null)
      atOnce = getAuthSnapshot()   // as the listener returns, before React draws
    })
    expect(atOnce).toMatchObject({
      session: null, token: null, claims: null, userId: null, workspaceId: null, workspaceIds: [],
      role: null, isPlatformOperator: false, offline: false, ready: true,
    })
    expect(seen.map((p) => [p.userId, p.workspaceId, p.role])).toEqual(Array(5).fill([null, null, null]))
    expect(lastSnapshot.userId).toBe(null)
  })

  it('a second person signing in over the first: no reader shows the first again, not even when a read asked before both is answered after', async () => {
    const priming = deferred()
    sdk.getSession = vi.fn(() => priming.promise)   // the first read, still out
    const log = []
    await act(async () => { render(<>{readers(5, log)}<SnapshotReader log={log} /></>) })
    await act(async () => { fire('SIGNED_IN', A) })
    expect(Object.values(lastOf(log))).toEqual(Array(6).fill('u-A@w-A'))
    const from = log.length
    await act(async () => { fire('SIGNED_IN', B) })                 // another sign-in over the first, no sign-out between
    await act(async () => { priming.resolve({ data: { session: A } }) })   // the read asked before both, answered now with the first person
    await act(async () => { render(<PermsReader i={9} log={log} />) })     // and a reader mounted after the change
    const after = log.slice(from)
    expect(after.filter((e) => e.userId === 'u-A' || e.workspaceId === 'w-A')).toEqual([])
    expect(lastOf(log)).toEqual({ 0: 'u-B@w-B', 1: 'u-B@w-B', 2: 'u-B@w-B', 3: 'u-B@w-B', 4: 'u-B@w-B', snapshot: 'u-B@w-B', 9: 'u-B@w-B' })
  })

  it('a session held offline for the first, then the second signs in: the second at once, the first never again', async () => {
    act(() => setHeldSession(A))
    const log = []
    await act(async () => { render(<>{readers(5, log)}</>) })
    expect(seen.map((p) => [p.userId, p.offline])).toEqual(Array(5).fill(['u-A', true]))
    const from = log.length
    await act(async () => { fire('SIGNED_IN', B) })
    expect(seen.map((p) => [p.userId, p.workspaceId, p.offline])).toEqual(Array(5).fill(['u-B', 'w-B', false]))
    await act(async () => { setHeldSession(null) })   // the confirmation ends the hold
    expect(log.slice(from).filter((e) => e.userId === 'u-A' || e.workspaceId === 'w-A')).toEqual([])
    expect(seen.map((p) => p.userId)).toEqual(Array(5).fill('u-B'))
  })
})
