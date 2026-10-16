/** @vitest-environment jsdom */
// =============================================================================
// ConnectionDot.test.jsx — the dot in R.A.B.B.I.T.'s bottom-left corner
// (post-overhaul FX11, 2026-10-16), rendered.
//
// Pinned here:
//   * its three colours, each from a real answer of the probe, and its words:
//     the button's name and its title say each part in words; the state is a
//     shape as well as a colour (data-state, styled in rabbitShell.css);
//   * the toggletip: a press shows the words, Escape and leaving hide them;
//   * a change of state is announced once, politely — never the first
//     answer, never "checking" or "unchecked", never the same state twice,
//     even across an unchecked answer in between (review round 1, R1-12);
//   * it asks only while R.A.B.B.I.T. is the page on screen, and again when
//     the browser comes back online; a projects refetch (a new adapterStatus
//     object, same `online`) asks nothing (R1-7);
//   * on the cloud the token is the auth EVENT's (the first probe waits for
//     it), getSession() is never called, both checks carry it; an expired
//     token is not used until TOKEN_REFRESHED brings the new one (R1-2); the
//     upload path's cached storage choice is the one asked about (R1-3); a
//     company bucket's real file arriving asks again (R1-1).
// =============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, waitFor, fireEvent } from '@testing-library/react'

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
const presign = vi.hoisted(() => ({ fn: null }))
vi.mock('../../../cloud/storageApi', () => ({ presignStorage: (...a) => presign.fn(...a) }))
const held = vi.hoisted(() => ({ row: undefined }))
vi.mock('../../../cloud/workspaceStorage', () => ({ peekWorkspaceStorageCached: () => held.row }))

const ctx = vi.hoisted(() => ({ value: null }))
vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => ctx.value }))

// eslint-disable-next-line import/first
import ConnectionDot from './ConnectionDot'

const PID = '11111111-2222-3333-4444-555555555555'
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
const cloudCtx = (over = {}) => fixturesCtx({ getAdapter: () => ({ mode: 'supabase' }), ...over })
const ok = (body = []) => ({ status: 200, ok: true, json: async () => body })
const later = (seconds) => Math.floor(Date.now() / 1000) + seconds

const dotOf = (container) => container.querySelector('[data-testid="connection-dot"]')
const cellOf = (container) => dotOf(container).querySelector('button.rb-conn-cell')
const markOf = (container) => dotOf(container).querySelector('.ui-status-dot')
const liveOf = (container) => container.querySelector('[data-testid="connection-dot-live"]')
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)) })

beforeEach(() => {
  answer = { database: true, files: true }
  ctx.value = fixturesCtx()
  auth.listeners = []
  held.row = undefined
  presign.fn = vi.fn()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('the three colours, and the words', () => {
  it('green: both parts answer — "Database: connected · Files: Petal cloud, connected · Live updates: on"', async () => {
    const { container } = render(<ConnectionDot />)
    await waitFor(() => expect(dotOf(container).dataset.state).toBe('connected'))
    const cell = cellOf(container)
    expect(cell.getAttribute('type')).toBe('button')
    expect(cell.getAttribute('aria-label')).toBe('Connection: Database: connected · Files: Petal cloud, connected · Live updates: on')
    expect(cell.getAttribute('title')).toBe('Database: connected · Files: Petal cloud, connected · Live updates: on')
    // The kit's dot: the tone, out of the accessibility tree, the same title
    // (an empty one would mask the button's).
    const mark = markOf(container)
    expect(mark.dataset.tone).toBe('success')
    expect(mark.getAttribute('aria-hidden')).toBe('true')
    expect(mark.hasAttribute('role')).toBe(false)
    expect(mark.getAttribute('title')).toBe(cell.getAttribute('title'))
  })
  it('amber: the database answers and the files do not', async () => {
    answer = { database: true, files: false }
    const { container } = render(<ConnectionDot />)
    await waitFor(() => expect(dotOf(container).dataset.state).toBe('files'))
    expect(markOf(container).dataset.tone).toBe('warning')
    expect(cellOf(container).getAttribute('title')).toBe('Database: connected · Files: Petal cloud, not answering · Live updates: on')
  })
  it('red: offline', async () => {
    answer = { database: false, files: false }
    const { container } = render(<ConnectionDot />)
    await waitFor(() => expect(dotOf(container).dataset.state).toBe('offline'))
    expect(markOf(container).dataset.tone).toBe('danger')
    expect(cellOf(container).getAttribute('title')).toMatch(/^Database: not answering · Files: Petal cloud, not answering/)
  })
  it('before the first answer it is neutral and says "checking", never green', () => {
    ctx.value.getAdapter = () => ({ mode: 'fixtures', connectionProbe: () => new Promise(() => {}) })
    const { container } = render(<ConnectionDot />)
    expect(dotOf(container).dataset.state).toBe('checking')
    expect(markOf(container).dataset.tone).toBe('neutral')
    expect(cellOf(container).getAttribute('title')).toBe('Database: checking · Files: checking · Live updates: on')
  })
})

describe('the toggletip: the words on a press, for the keyboard too (R1-4)', () => {
  it('a press shows each part on its own line; a second press, Escape and leaving hide them', async () => {
    const { container } = render(<ConnectionDot />)
    await waitFor(() => expect(dotOf(container).dataset.state).toBe('connected'))
    const cell = cellOf(container)
    expect(cell.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('[data-testid="connection-dot-words"]')).toBeNull()
    fireEvent.click(cell)
    const words = container.querySelector('[data-testid="connection-dot-words"]')
    expect([...words.children].map((c) => c.textContent)).toEqual(['Database: connected', 'Files: Petal cloud, connected', 'Live updates: on'])
    expect(cell.getAttribute('aria-expanded')).toBe('true')
    expect(cell.getAttribute('aria-controls')).toBe(words.id)
    fireEvent.click(cell)
    expect(container.querySelector('[data-testid="connection-dot-words"]')).toBeNull()
    fireEvent.click(cell)
    fireEvent.keyDown(cell, { key: 'Escape' })
    expect(container.querySelector('[data-testid="connection-dot-words"]')).toBeNull()
    fireEvent.click(cell)
    fireEvent.blur(cell)
    expect(container.querySelector('[data-testid="connection-dot-words"]')).toBeNull()
  })
  it('the cell is reachable by Tab (a real button, no tabindex games)', async () => {
    const { container } = render(<ConnectionDot />)
    const cell = cellOf(container)
    expect(cell.tagName).toBe('BUTTON')
    expect(cell.hasAttribute('tabindex')).toBe(false)
    expect(cell.disabled).toBe(false)
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

    answer = { database: false, files: false }
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await waitFor(() => expect(dotOf(container).dataset.state).toBe('offline'))
    expect(live.textContent).toBe('Offline: the database is not answering.')

    answer = { database: true, files: true }
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await waitFor(() => expect(dotOf(container).dataset.state).toBe('connected'))
    expect(live.textContent).toBe('Everything is connected.')
  })
  it('R1-12: connected, then unchecked, then connected again says nothing (the same settled state is not a change)', async () => {
    // The cloud on a company bucket: a key nobody writes answered 404 is
    // connected, answered 403 is unchecked.
    held.row = { mode: 'byos', provider: 's3' }
    presign.fn = vi.fn(async () => ({ url: 'https://bucket.example/signed' }))
    let bucketStatus = 404
    vi.stubGlobal('fetch', vi.fn(async (url) => (String(url).startsWith('https://bucket.example') ? { status: bucketStatus, ok: bucketStatus < 300 } : ok())))
    ctx.value = cloudCtx({ activeProjectId: PID, projectsIndex: { [PID]: { id: PID } } })
    const { container } = render(<ConnectionDot />)
    await act(async () => { auth.listeners[0]('INITIAL_SESSION', { access_token: 't', expires_at: later(3600) }) })
    await waitFor(() => expect(dotOf(container).dataset.state).toBe('connected'))
    bucketStatus = 403
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await waitFor(() => expect(dotOf(container).dataset.state).toBe('unchecked'))
    bucketStatus = 404
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await waitFor(() => expect(dotOf(container).dataset.state).toBe('connected'))
    expect(liveOf(container).textContent).toBe('')
  })
})

describe('the boot window and a change of backend are not changes of the connection', () => {
  it('before the provider has built its adapter: checking, nothing asked; then its first answer, unannounced', async () => {
    let adapter = null
    const fetchFn = vi.fn()
    vi.stubGlobal('fetch', fetchFn)
    ctx.value = fixturesCtx({ adapterMode: 'local_server', getAdapter: () => adapter })
    const { container, rerender } = render(<ConnectionDot />)
    await settle()
    expect(dotOf(container).dataset.state).toBe('checking')
    expect(fetchFn).not.toHaveBeenCalled()
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
    await settle()
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
    await settle()
    expect(probe).toHaveBeenCalledTimes(2)
  })
  it('R1-7: a projects refetch (a new adapterStatus object, the same online) asks nothing; the adapter going offline asks at once', async () => {
    const { rerender } = render(<ConnectionDot />)
    await waitFor(() => expect(probe).toHaveBeenCalledTimes(1))
    for (let i = 0; i < 3; i++) {
      ctx.value = { ...ctx.value, adapterStatus: { online: true, lastSyncAt: new Date(Date.now() + i) } }
      rerender(<ConnectionDot />)
    }
    await settle()
    expect(probe).toHaveBeenCalledTimes(1)
    ctx.value = { ...ctx.value, adapterStatus: { online: false } }
    rerender(<ConnectionDot />)
    await waitFor(() => expect(probe).toHaveBeenCalledTimes(2))
  })
  it('the fixtures are not asked about the network: the browser going offline leaves them as they are', async () => {
    const { container } = render(<ConnectionDot />)
    await waitFor(() => expect(dotOf(container).dataset.state).toBe('connected'))
    await act(async () => { window.dispatchEvent(new Event('offline')) })
    expect(dotOf(container).dataset.state).toBe('connected')
  })
})

describe('the cloud: the token comes from the auth event, never getSession', () => {
  it('waits for the first auth event, then asks both parts with its token, once; getSession is never called', async () => {
    const fetchFn = vi.fn(async (url) => ok(String(url).includes('workspace_storage') ? [{ mode: 'central', provider: 'petal' }] : []))
    vi.stubGlobal('fetch', fetchFn)
    ctx.value = cloudCtx()
    const { container } = render(<ConnectionDot />)
    await settle()
    expect(fetchFn).not.toHaveBeenCalled()
    expect(dotOf(container).dataset.state).toBe('checking')
    expect(auth.listeners).toHaveLength(1)
    // The listener returns synchronously (an async auth callback deadlocks auth-js).
    let returned
    await act(async () => { returned = auth.listeners[0]('INITIAL_SESSION', { access_token: 'event-token', expires_at: later(3600) }) })
    expect(returned).toBeUndefined()
    await waitFor(() => expect(dotOf(container).dataset.state).toBe('connected'))
    await settle()
    const urls = fetchFn.mock.calls.map(([u]) => String(u))
    expect(urls.filter((u) => u.includes('/rest/v1/projects'))).toHaveLength(1) // R1-7: one probe at boot, not two
    expect(urls.some((u) => u.includes('/storage/v1/object/list/rabbit-files'))).toBe(true)
    for (const [, init] of fetchFn.mock.calls) {
      expect(init.headers.authorization).toBe('Bearer event-token')
      expect(init.signal).toBeInstanceOf(AbortSignal)
    }
    expect(auth.getSession).not.toHaveBeenCalled()
  })
  it('R1-2: an expired token is not used — the dot keeps what it said — and TOKEN_REFRESHED asks at once with the new one', async () => {
    const fetchFn = vi.fn(async () => ok())
    vi.stubGlobal('fetch', fetchFn)
    ctx.value = cloudCtx()
    const { container } = render(<ConnectionDot />)
    await act(async () => { auth.listeners[0]('INITIAL_SESSION', { access_token: 'old', expires_at: later(3600) }) })
    await waitFor(() => expect(dotOf(container).dataset.state).toBe('connected'))
    // An hour away: the page comes back with the old token past its expiry.
    await act(async () => { auth.listeners[0]('TOKEN_REFRESHED', { access_token: 'old', expires_at: later(-30) }) })
    fetchFn.mockClear()
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await settle()
    expect(fetchFn).not.toHaveBeenCalled()
    expect(dotOf(container).dataset.state).toBe('connected')
    expect(liveOf(container).textContent).toBe('')
    await act(async () => { auth.listeners[0]('TOKEN_REFRESHED', { access_token: 'new', expires_at: later(3600) }) })
    await waitFor(() => expect(fetchFn).toHaveBeenCalled())
    for (const [, init] of fetchFn.mock.calls) expect(init.headers.authorization).toBe('Bearer new')
  })
  it('R1-2: a token still expired 2 minutes on is used (the refresh failed; the red is then true)', async () => {
    const fetchFn = vi.fn(async () => ({ status: 401, ok: false, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchFn)
    ctx.value = cloudCtx()
    const { container } = render(<ConnectionDot />)
    await act(async () => { auth.listeners[0]('INITIAL_SESSION', { access_token: 'dead', expires_at: later(-300) }) })
    await waitFor(() => expect(dotOf(container).dataset.state).toBe('offline'))
    expect(cellOf(container).getAttribute('title')).toMatch(/^Database: not answering for you/)
  })
  it('R1-3: the store asked about is the upload path\'s cached choice; the dot reads none of its own then', async () => {
    held.row = { mode: 'byos', provider: 's3' }
    presign.fn = vi.fn(async () => ({ url: 'https://bucket.example/signed' }))
    const fetchFn = vi.fn(async (url) => (String(url).startsWith('https://bucket.example') ? { status: 404, ok: false } : ok()))
    vi.stubGlobal('fetch', fetchFn)
    ctx.value = cloudCtx({ activeProjectId: PID, projectsIndex: { [PID]: { id: PID } } })
    const { container } = render(<ConnectionDot />)
    await act(async () => { auth.listeners[0]('INITIAL_SESSION', { access_token: 't', expires_at: later(3600) }) })
    await waitFor(() => expect(dotOf(container).dataset.state).toBe('connected'))
    expect(fetchFn.mock.calls.some(([u]) => String(u).includes('workspace_storage'))).toBe(false)
    expect(cellOf(container).getAttribute('title')).toMatch(/Files: your company's own bucket, connected/)
    // presignStorage got the event's token (so it never falls back to getSession) and a signal.
    const [, , opts] = presign.fn.mock.calls[0]
    expect(opts.token).toBe('t')
    expect(opts.signal).toBeInstanceOf(AbortSignal)
  })
  it('R1-1: the open project\'s first file in the bucket arriving asks again, about that file', async () => {
    held.row = { mode: 'byos', provider: 's3' }
    presign.fn = vi.fn(async () => ({ url: 'https://bucket.example/signed' }))
    vi.stubGlobal('fetch', vi.fn(async (url) => (String(url).startsWith('https://bucket.example') ? { status: 403, ok: false } : ok())))
    ctx.value = cloudCtx({ activeProjectId: PID, projectsIndex: { [PID]: { id: PID } }, files: [] })
    const { container, rerender } = render(<ConnectionDot />)
    await act(async () => { auth.listeners[0]('INITIAL_SESSION', { access_token: 't', expires_at: later(3600) }) })
    await waitFor(() => expect(dotOf(container).dataset.state).toBe('unchecked'))
    const file = { project_id: PID, storage_provider: 's3', storage_path: `projects/${PID}/files/x/1-a.mov` }
    ctx.value = { ...ctx.value, files: [file] }
    rerender(<ConnectionDot />)
    await waitFor(() => expect(presign.fn.mock.calls.some(([, p]) => p === file.storage_path)).toBe(true))
    await waitFor(() => expect(dotOf(container).dataset.state).toBe('files'))
  })
  it('the browser going offline turns the cloud red at once, before any probe answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok()))
    ctx.value = cloudCtx()
    const { container } = render(<ConnectionDot />)
    await act(async () => { auth.listeners[0]('INITIAL_SESSION', { access_token: 't', expires_at: later(3600) }) })
    await waitFor(() => expect(dotOf(container).dataset.state).toBe('connected'))
    await act(async () => { window.dispatchEvent(new Event('offline')) })
    expect(dotOf(container).dataset.state).toBe('offline')
    expect(cellOf(container).getAttribute('title')).toMatch(/^Database: no network · Files: Petal cloud, no network/)
    await act(async () => { window.dispatchEvent(new Event('online')) })
  })
  it('unmounting unsubscribes from auth and aborts the probe in flight', async () => {
    let signal = null
    vi.stubGlobal('fetch', vi.fn((url, init) => { signal = init.signal; return new Promise(() => {}) }))
    ctx.value = cloudCtx()
    const { unmount } = render(<ConnectionDot />)
    await act(async () => { auth.listeners[0]('INITIAL_SESSION', { access_token: 't', expires_at: later(3600) }) })
    await waitFor(() => expect(signal).not.toBeNull())
    unmount()
    expect(signal.aborted).toBe(true)
    expect(auth.listeners).toHaveLength(0)
  })
})
