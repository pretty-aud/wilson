/** @vitest-environment jsdom */
// =============================================================================
// ConnectionDot.test.jsx — the dot in R.A.B.B.I.T.'s bottom-left corner
// (post-overhaul FX11, 2026-10-16), rendered.
//
// Pinned here:
//   * its three colours, each from a real answer of the probe, and its words:
//     the hover text and the accessible name are the same sentence, each
//     part in words;
//   * a change of state is announced once, politely — never the first
//     answer, never "checking", never the same state twice;
//   * it asks only while R.A.B.B.I.T. is the page on screen, and again when
//     the browser comes back online;
//   * on the cloud the token is the auth EVENT's (the first probe waits for
//     it), getSession() is never called, and both checks carry it.
// =============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, waitFor } from '@testing-library/react'

const auth = vi.hoisted(() => ({ listeners: [], getSession: null }))
vi.mock('../../../cloud/auth/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: (auth.getSession = vi.fn(async () => ({ data: { session: null } }))),
      onAuthStateChange: (cb) => {
        auth.listeners.push(cb)
        return { data: { subscription: { unsubscribe: () => { auth.listeners = auth.listeners.filter((l) => l !== cb) } } } }
      },
    },
  },
}))
vi.mock('../../../cloud/storageApi', () => ({ presignStorage: vi.fn() }))

const ctx = vi.hoisted(() => ({ value: null }))
vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => ctx.value }))

// eslint-disable-next-line import/first
import ConnectionDot from './ConnectionDot'

let answer
let probe
function fixturesCtx(over = {}) {
  probe = vi.fn(async () => answer)
  return {
    adapterMode: 'supabase',
    getAdapter: () => ({ mode: 'fixtures', connectionProbe: probe }),
    adapterStatus: { online: true },
    realtimeStatus: 'live',
    activeProjectId: 'p1',
    projectsIndex: { p1: { id: 'p1' } },
    files: [],
    ...over,
  }
}

const dotOf = (container) => container.querySelector('[data-testid="connection-dot"]')
const markOf = (container) => dotOf(container).querySelector('.ui-status-dot')
const liveOf = (container) => container.querySelector('[data-testid="connection-dot-live"]')

beforeEach(() => {
  answer = { database: true, files: true }
  ctx.value = fixturesCtx()
  auth.listeners = []
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('the three colours, and the words', () => {
  it('green: both parts answer — "Database: connected · Files: Petal cloud, connected · Live updates: on"', async () => {
    const { container } = render(<ConnectionDot />)
    await waitFor(() => expect(dotOf(container).dataset.state).toBe('connected'))
    const mark = markOf(container)
    expect(mark.dataset.tone).toBe('success')
    expect(mark.getAttribute('role')).toBe('img')
    expect(mark.getAttribute('aria-label')).toBe('Database: connected · Files: Petal cloud, connected · Live updates: on')
    expect(mark.getAttribute('title')).toBe(mark.getAttribute('aria-label'))
  })
  it('amber: the database answers and the files do not', async () => {
    answer = { database: true, files: false }
    const { container } = render(<ConnectionDot />)
    await waitFor(() => expect(dotOf(container).dataset.state).toBe('files'))
    expect(markOf(container).dataset.tone).toBe('warning')
    expect(markOf(container).getAttribute('aria-label')).toBe('Database: connected · Files: Petal cloud, not answering · Live updates: on')
  })
  it('red: offline', async () => {
    answer = { database: false, files: false }
    const { container } = render(<ConnectionDot />)
    await waitFor(() => expect(dotOf(container).dataset.state).toBe('offline'))
    expect(markOf(container).dataset.tone).toBe('danger')
    expect(markOf(container).getAttribute('title')).toMatch(/^Database: not answering · Files: Petal cloud, not answering/)
  })
  it('before the first answer it is neutral and says "checking", never green', () => {
    probe = null
    ctx.value = fixturesCtx()
    ctx.value.getAdapter = () => ({ mode: 'fixtures', connectionProbe: () => new Promise(() => {}) })
    const { container } = render(<ConnectionDot />)
    expect(dotOf(container).dataset.state).toBe('checking')
    expect(markOf(container).dataset.tone).toBe('neutral')
    expect(markOf(container).getAttribute('aria-label')).toBe('Database: checking · Files: checking · Live updates: on')
  })
})

describe('a change of state is announced once, politely', () => {
  it('the live region is polite; the first answer is not announced; each change is, once', async () => {
    const { container } = render(<ConnectionDot />)
    await waitFor(() => expect(dotOf(container).dataset.state).toBe('connected'))
    const live = liveOf(container)
    expect(live.getAttribute('aria-live')).toBe('polite')
    expect(live.getAttribute('role')).toBe('status')
    expect(live.textContent).toBe('')

    answer = { database: true, files: false }
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await waitFor(() => expect(dotOf(container).dataset.state).toBe('files'))
    expect(live.textContent).toBe('The files are not answering (Petal cloud); the database is connected.')

    // The same state again: nothing new is said.
    const calls = probe.mock.calls.length
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await waitFor(() => expect(probe.mock.calls.length).toBeGreaterThan(calls))
    expect(live.textContent).toBe('The files are not answering (Petal cloud); the database is connected.')

    answer = { database: false, files: false }
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await waitFor(() => expect(dotOf(container).dataset.state).toBe('offline'))
    expect(live.textContent).toBe('Offline: the database is not answering.')

    answer = { database: true, files: true }
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await waitFor(() => expect(dotOf(container).dataset.state).toBe('connected'))
    expect(live.textContent).toBe('Everything is connected.')
  })
})

describe('the boot window and a change of backend are not changes of the connection', () => {
  it('before the provider has built its adapter: checking, nothing asked; then its first answer, unannounced', async () => {
    let adapter = null
    const localFetch = vi.fn()
    vi.stubGlobal('fetch', localFetch)
    ctx.value = fixturesCtx({ adapterMode: 'local_server', getAdapter: () => adapter })
    const { container, rerender } = render(<ConnectionDot />)
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(dotOf(container).dataset.state).toBe('checking')
    expect(localFetch).not.toHaveBeenCalled()
    // The boot: the fixtures' adapter in the cloud's slot.
    adapter = { mode: 'fixtures', connectionProbe: probe }
    ctx.value = { ...ctx.value, adapterMode: 'supabase', adapterStatus: { online: true } }
    rerender(<ConnectionDot />)
    await waitFor(() => expect(dotOf(container).dataset.state).toBe('connected'))
    expect(liveOf(container).textContent).toBe('')
  })
})

describe('when it asks', () => {
  it('not while R.A.B.B.I.T. is off screen; at once when it comes on screen', async () => {
    const { container, rerender } = render(<ConnectionDot active={false} />)
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(probe).not.toHaveBeenCalled()
    expect(dotOf(container).dataset.state).toBe('checking')
    rerender(<ConnectionDot active />)
    await waitFor(() => expect(dotOf(container).dataset.state).toBe('connected'))
    expect(probe).toHaveBeenCalledTimes(1)
  })
  it('every minute while on screen, and not after it leaves the screen', async () => {
    vi.useFakeTimers()
    try {
      const { rerender } = render(<ConnectionDot active />)
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })
      expect(probe).toHaveBeenCalledTimes(1)
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
      expect(probe).toHaveBeenCalledTimes(2)
      rerender(<ConnectionDot active={false} />)
      await act(async () => { await vi.advanceTimersByTimeAsync(180_000) })
      expect(probe).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
  })
  it('one probe at a time: events during a probe ask once more after it, not once each', async () => {
    let release
    ctx.value.getAdapter = () => ({ mode: 'fixtures', connectionProbe: probe })
    probe.mockImplementationOnce(() => new Promise((r) => { release = () => r(answer) }))
    render(<ConnectionDot />)
    await waitFor(() => expect(probe).toHaveBeenCalledTimes(1))
    await act(async () => {
      window.dispatchEvent(new Event('online'))
      window.dispatchEvent(new Event('online'))
      window.dispatchEvent(new Event('online'))
    })
    expect(probe).toHaveBeenCalledTimes(1)
    await act(async () => { release() })
    await waitFor(() => expect(probe).toHaveBeenCalledTimes(2))
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(probe).toHaveBeenCalledTimes(2)
  })
  it('the browser going offline turns the cloud red at once, without a probe', async () => {
    ctx.value = fixturesCtx()
    const { container } = render(<ConnectionDot />)
    await waitFor(() => expect(dotOf(container).dataset.state).toBe('connected'))
    // The fixtures stand in for the cloud here: they are not asked about the
    // network (only the cloud and Drive are), so this pins the fixtures
    // staying green, and the cloud test below pins red.
    await act(async () => { window.dispatchEvent(new Event('offline')) })
    expect(dotOf(container).dataset.state).toBe('connected')
  })
})

describe('the cloud: the token comes from the auth event, never getSession', () => {
  it('waits for the first auth event, then asks both parts with its token; getSession is never called', async () => {
    const fetch = vi.fn(async (url) => ({ status: 200, ok: true, json: async () => (String(url).includes('workspace_storage') ? [{ mode: 'central', provider: 'petal' }] : []) }))
    vi.stubGlobal('fetch', fetch)
    ctx.value = fixturesCtx({ getAdapter: () => ({ mode: 'supabase' }) })
    const { container } = render(<ConnectionDot />)
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(fetch).not.toHaveBeenCalled()
    expect(dotOf(container).dataset.state).toBe('checking')
    expect(auth.listeners).toHaveLength(1)
    // The listener returns synchronously (an async auth callback deadlocks auth-js).
    let returned
    await act(async () => { returned = auth.listeners[0]('INITIAL_SESSION', { access_token: 'event-token' }) })
    expect(returned).toBeUndefined()
    await waitFor(() => expect(dotOf(container).dataset.state).toBe('connected'))
    const urls = fetch.mock.calls.map(([u]) => String(u))
    expect(urls.some((u) => u.includes('/rest/v1/projects'))).toBe(true)
    expect(urls.some((u) => u.includes('/storage/v1/object/list/rabbit-files'))).toBe(true)
    for (const [, init] of fetch.mock.calls) {
      expect(init.headers.authorization).toBe('Bearer event-token')
      expect(init.signal).toBeInstanceOf(AbortSignal)
    }
    expect(auth.getSession).not.toHaveBeenCalled()
  })
  it('the browser going offline turns the cloud red at once, before any probe answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, ok: true, json: async () => [] })))
    ctx.value = fixturesCtx({ getAdapter: () => ({ mode: 'supabase' }) })
    const { container } = render(<ConnectionDot />)
    await act(async () => { auth.listeners[0]('INITIAL_SESSION', { access_token: 't' }) })
    await waitFor(() => expect(dotOf(container).dataset.state).toBe('connected'))
    await act(async () => { window.dispatchEvent(new Event('offline')) })
    expect(dotOf(container).dataset.state).toBe('offline')
    expect(markOf(container).getAttribute('aria-label')).toMatch(/^Database: no network · Files: Petal cloud, no network/)
  })
  it('unmounting unsubscribes from auth and aborts the probe in flight', async () => {
    let signal = null
    vi.stubGlobal('fetch', vi.fn((url, init) => { signal = init.signal; return new Promise(() => {}) }))
    ctx.value = fixturesCtx({ getAdapter: () => ({ mode: 'supabase' }) })
    const { unmount } = render(<ConnectionDot />)
    await act(async () => { auth.listeners[0]('INITIAL_SESSION', { access_token: 't' }) })
    await waitFor(() => expect(signal).not.toBeNull())
    unmount()
    expect(signal.aborted).toBe(true)
    expect(auth.listeners).toHaveLength(0)
  })
})
