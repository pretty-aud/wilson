/** @vitest-environment jsdom */
// =============================================================================
// gatewayVideo.test.jsx — GW3: the player through the gateway
// (GATEWAY_DESIGN.md §5 step 7, §7; D5, D9; G7, D8), rendered.
//
// What this pins:
//   * the hand-over: the cloud picture is under the element, which is
//     transparent (the loaded state is off) until `loadeddata` fires;
//   * the mark (D9): drawn ONLY when the door is outside — the display name,
//     the six-character member code (the first six characters of the user id,
//     never the email), the clock — moved among the five positions every 30 s,
//     the lower ones above the control strip; the kit's label step;
//   * the renewal: onRenew(row.id) at 75 s, again at 150 s, never without a
//     door; the URL never changes;
//   * the recovery: an error is diagnosed; 'ticket' gets ONE fresh src at the
//     same currentTime and a second failure is said, not retried; 'missing'
//     says the clip is not at its path; 'ok' (the door served, the browser
//     could not decode) is NEEDS_DESKTOP_FORMAT;
//   * the cosmetic measures, as named: nodownload, noremoteplayback, no
//     picture-in-picture, the context menu suppressed, fullscreen on the
//     CONTAINER; "loading" while no src; audio and image kinds.
// =============================================================================

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, act, screen } from '@testing-library/react'
import GatewayVideo, { ViewerMark, memberCodeOf, markWords, clockWords, MARK_POSITIONS, MARK_MOVE_MS, POSITION_CLASS, RENEW_RETRY_MS } from './GatewayVideo'
import { NEEDS_DESKTOP_FORMAT, GATEWAY_LOADING, gatewayMissingSentence } from '../../bins/binLocations'
import { RENEW_AFTER_MS } from '../../bins/gatewayDoors'

afterEach(() => { cleanup(); vi.useRealTimers() })
beforeEach(() => { vi.restoreAllMocks() })

const row = { id: 'c1', display_name: 'Clip', media_type: 'video', extension: '.mp4', location_id: 'L1', poster_path: null }
const viewer = { userId: 'f1c70000-0002-4000-8000-000000000001', name: 'Priya Nair' }
const outside = { door: 'outside', jti: 'j1' }
const inside = { door: 'inside', jti: 'j1' }
const player = () => document.querySelector('[data-testid="gateway-player"]')
const video = () => document.querySelector('video')
const mark = () => document.querySelector('[data-testid="viewer-mark"]')

describe('the words of the mark', () => {
  it('the member code is the first six characters of the user id, which the viewer cannot change; the clock is HH:MM; never the email', () => {
    expect(memberCodeOf('3f9a2c7e-1111-4222-8333-444444444444')).toBe('3f9a2c')
    expect(memberCodeOf('F1C70000-0002')).toBe('f1c700')
    expect(memberCodeOf(null)).toBe('')
    expect(clockWords(new Date(2026, 9, 11, 14, 2))).toBe('14:02')
    expect(markWords({ name: 'Priya Nair', userId: '3f9a2c7e-1111-4222-8333-444444444444', email: 'priya@example.com' }, new Date(2026, 9, 11, 14, 2))).toBe('Priya Nair · 3f9a2c · 14:02')
    expect(markWords({ name: '', userId: null }, new Date(2026, 9, 11, 9, 5))).toBe('a viewer · ------ · 09:05')
  })
  it('five positions, the corners and the centre, each a class bins.css draws', () => {
    expect(MARK_POSITIONS).toEqual(['top-left', 'top-right', 'bottom-right', 'bottom-left', 'centre'])
    expect(MARK_MOVE_MS).toBe(30_000)
    expect(Object.keys(POSITION_CLASS).sort()).toEqual([...MARK_POSITIONS].sort())
  })
})

describe('the mark over REMOTE playback only (D9)', () => {
  it('is drawn when the door is outside, in the kit label step, moved every 30 s through the five positions; never inside', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 11, 14, 2))
    render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={outside} viewer={viewer} />)
    const m = mark()
    expect(m.textContent).toBe('Priya Nair · f1c700 · 14:02')
    expect(m.className).toContain('text-label')
    expect(m.className).toContain('uppercase')
    expect(m.className).toContain(POSITION_CLASS['top-left'])
    expect(m.getAttribute('aria-hidden')).toBe('true')
    const seen = [POSITION_CLASS['top-left']]
    for (let i = 1; i < 6; i++) {
      act(() => { vi.advanceTimersByTime(MARK_MOVE_MS) })
      const cls = MARK_POSITIONS.map((p) => POSITION_CLASS[p]).find((c) => mark().className.includes(c))
      seen.push(cls)
    }
    expect(seen.slice(0, 5)).toEqual(MARK_POSITIONS.map((p) => POSITION_CLASS[p]))
    expect(seen[5]).toBe(POSITION_CLASS['top-left'])
    cleanup()
    render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={inside} viewer={viewer} />)
    expect(mark()).toBeNull()
    cleanup()
    render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={null} viewer={viewer} />)
    expect(mark()).toBeNull()
  })
  it('the clock moves on: a minute later the mark says so', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 11, 14, 2, 50))
    render(<ViewerMark viewer={viewer} />)
    expect(mark().textContent).toContain('14:02')
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(mark().textContent).toContain('14:03')
  })
  it('no mark without a src (nothing is playing), nor once the player failed', async () => {
    render(<GatewayVideo row={row} src={null} stream={outside} viewer={viewer} />)
    expect(mark()).toBeNull()
    expect(screen.getByTestId('gateway-loading').textContent).toBe(GATEWAY_LOADING)
  })
  it('no src and the cloud refused a ticket: the refusal\'s sentence, not "loading" for good; while a ticket is on its way, "loading" still', () => {
    render(<GatewayVideo row={row} src={null} stream={{ ...outside, ticketError: 'Sign in again: WILSON could not confirm who is asking for this.', pending: false }} viewer={viewer} />)
    expect(screen.queryByTestId('gateway-loading')).toBeNull()
    expect(screen.getByTestId('gateway-sentence').textContent).toBe('Sign in again: WILSON could not confirm who is asking for this.')
    expect(mark()).toBeNull()
    cleanup()
    render(<GatewayVideo row={row} src={null} stream={{ ...outside, ticketError: 'Sign in again.', pending: true }} viewer={viewer} />)
    expect(screen.getByTestId('gateway-loading').textContent).toBe(GATEWAY_LOADING)
    expect(screen.queryByTestId('gateway-sentence')).toBeNull()
    cleanup()
    // The cloud answered, naming the clip missing: said plainly, not "loading" for good.
    render(<GatewayVideo row={row} src={null} stream={{ ...outside, missing: true, pending: false }} viewer={viewer} />)
    expect(screen.getByTestId('gateway-sentence').textContent).toBe('This clip cannot be played here right now.')
    expect(screen.queryByTestId('gateway-loading')).toBeNull()
    cleanup()
    // With a src the old error is history: the clip plays.
    render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={{ ...outside, ticketError: 'old', pending: false }} viewer={viewer} />)
    expect(screen.queryByTestId('gateway-sentence')).toBeNull()
    expect(video()).toBeTruthy()
  })
})

describe('the hand-over (§7; Doherty)', () => {
  it('the picture is rendered under the element, and the element is transparent (no loaded state) until loadeddata; then loaded', () => {
    render(<GatewayVideo row={{ ...row, poster_path: 'p/x.jpg' }} src="https://d:1/v1/clips/c1?t=x" stream={inside} poster="blob:poster" />)
    expect(player().getAttribute('data-loaded')).toBeNull()
    const v = video()
    expect(v.className).toContain('bn-gateway-media')
    expect(document.querySelector('img[src="blob:poster"]')).toBeTruthy()
    fireEvent.loadedData(v)
    expect(player().getAttribute('data-loaded')).toBe('true')
    // Once drawn, the picture stands down (the video covers it).
    expect(document.querySelector('img[src="blob:poster"]')).toBeNull()
  })
  it('a new src from the parent (a new clip) brings the picture back on top', () => {
    const { rerender } = render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={inside} />)
    fireEvent.loadedData(video())
    expect(player().getAttribute('data-loaded')).toBe('true')
    rerender(<GatewayVideo row={{ ...row, id: 'c2' }} src="https://d:1/v1/clips/c2?t=y" stream={inside} />)
    expect(player().getAttribute('data-loaded')).toBeNull()
  })
})

describe('the renewal (§5 step 7; D5)', () => {
  const tick = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  it('onRenew(row.id) fires at 75 s and again at 150 s while a door plays the stream; the src never changes', async () => {
    vi.useFakeTimers()
    const onRenew = vi.fn(async () => ({ ok: true }))
    render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={inside} onRenew={onRenew} />)
    await tick(RENEW_AFTER_MS - 1)
    expect(onRenew).not.toHaveBeenCalled()
    await tick(1)
    expect(onRenew).toHaveBeenCalledWith('c1')
    await tick(RENEW_AFTER_MS)
    expect(onRenew).toHaveBeenCalledTimes(2)
    expect(video().getAttribute('src')).toBe('https://d:1/v1/clips/c1?t=x')
  })
  it('the parent re-rendering with a NEW onRenew every 30 s (the provider\'s updates, the tab\'s 60 s re-read) does not restart the clock: the renewal still comes at 75 s, with the latest callback', async () => {
    vi.useFakeTimers()
    const calls = []
    const make = (n) => async (id) => { calls.push([n, id]); return { ok: true } }
    const { rerender } = render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={inside} onRenew={make(0)} />)
    await tick(30_000)
    rerender(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={inside} onRenew={make(1)} />)
    await tick(30_000)
    rerender(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={inside} onRenew={make(2)} />)
    await tick(15_000)
    expect(calls).toEqual([[2, 'c1']])
    // CONTROL: a stream object rebuilt with the same door keeps the clock too.
    rerender(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={{ ...inside }} onRenew={make(3)} />)
    await tick(RENEW_AFTER_MS)
    expect(calls).toEqual([[2, 'c1'], [3, 'c1']])
  })
  it('a failed renewal is tried again in 10 s, not at the next 75 s (a blip must not let the authority run out); a success goes back to 75 s', async () => {
    vi.useFakeTimers()
    const answers = [{ ok: false, status: 0, reason: 'ticket' }, { ok: true }]
    const onRenew = vi.fn(async () => answers.shift() || { ok: true })
    render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={inside} onRenew={onRenew} />)
    await tick(RENEW_AFTER_MS)
    expect(onRenew).toHaveBeenCalledTimes(1)
    await tick(RENEW_RETRY_MS)
    expect(onRenew).toHaveBeenCalledTimes(2)
    await tick(RENEW_RETRY_MS)
    expect(onRenew).toHaveBeenCalledTimes(2) // the retry succeeded: the next is 75 s after it
    await tick(RENEW_AFTER_MS - RENEW_RETRY_MS)
    expect(onRenew).toHaveBeenCalledTimes(3)
    expect(RENEW_RETRY_MS).toBe(10_000)
  })
  it('a renewal that throws is a failure (retried), never an unhandled error', async () => {
    vi.useFakeTimers()
    const onRenew = vi.fn(() => { throw new Error('boom') })
    render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={inside} onRenew={onRenew} />)
    await tick(RENEW_AFTER_MS + RENEW_RETRY_MS)
    expect(onRenew).toHaveBeenCalledTimes(2)
  })
  it('CONTROL: no door, no src — no renewal', async () => {
    vi.useFakeTimers()
    const onRenew = vi.fn()
    render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={null} onRenew={onRenew} />)
    await tick(RENEW_AFTER_MS * 2)
    expect(onRenew).not.toHaveBeenCalled()
  })
  it('the test\'s renewal interval can be shortened (the Playwright run) and defaults to the design\'s 75 s', async () => {
    vi.useFakeTimers()
    const onRenew = vi.fn()
    render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={inside} onRenew={onRenew} renewAfterMs={1000} />)
    await tick(1000)
    expect(onRenew).toHaveBeenCalledTimes(1)
    expect(RENEW_AFTER_MS).toBe(75_000)
  })
})

describe('a new URL for the same clip (a fresh ticket after the margin) goes on from the same moment', () => {
  it('resumes where it was and plays if it was playing; a NEW clip starts from the beginning', () => {
    const { rerender } = render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=a" stream={inside} />)
    const v1 = video()
    Object.defineProperty(v1, 'currentTime', { value: 42, writable: true, configurable: true })
    Object.defineProperty(v1, 'paused', { value: false, configurable: true })
    fireEvent.timeUpdate(v1)
    rerender(<GatewayVideo row={row} src={null} stream={inside} />) // the held ticket reached its margin
    rerender(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=b" stream={inside} />)
    const v2 = video()
    expect(v2.getAttribute('src')).toBe('https://d:1/v1/clips/c1?t=b')
    const set = vi.fn()
    Object.defineProperty(v2, 'currentTime', { get: () => 0, set, configurable: true })
    v2.play = vi.fn(async () => {})
    fireEvent.loadedData(v2)
    expect(set).toHaveBeenCalledWith(42)
    return Promise.resolve().then(() => {
      expect(v2.play).toHaveBeenCalled()
      rerender(<GatewayVideo row={{ ...row, id: 'c2' }} src="https://d:1/v1/clips/c2?t=c" stream={inside} />)
      const v3 = video()
      const set3 = vi.fn()
      Object.defineProperty(v3, 'currentTime', { get: () => 0, set: set3, configurable: true })
      fireEvent.loadedData(v3)
      expect(set3).not.toHaveBeenCalled()
    })
  })
  it('paused where it was: resumes there, and stays paused', async () => {
    const { rerender } = render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=a" stream={inside} />)
    const v1 = video()
    Object.defineProperty(v1, 'currentTime', { value: 9, writable: true, configurable: true })
    fireEvent.pause(v1)
    rerender(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=b" stream={inside} />)
    const v2 = video()
    const set = vi.fn()
    Object.defineProperty(v2, 'currentTime', { get: () => 0, set, configurable: true })
    v2.play = vi.fn(async () => {})
    fireEvent.loadedData(v2)
    await Promise.resolve()
    expect(set).toHaveBeenCalledWith(9)
    expect(v2.play).not.toHaveBeenCalled()
  })
})

describe('the recovery: never the same ticket twice', () => {
  const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
  it('a stale ticket (the HEAD says 401): ONE fresh src at the same currentTime; a second failure is said, not retried', async () => {
    const onDiagnose = vi.fn(async () => ({ verdict: 'ticket', status: 401 }))
    const onFreshSrc = vi.fn(async () => 'https://d:1/v1/clips/c1?t=fresh')
    const onFailed = vi.fn()
    render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=stale" stream={inside} onDiagnose={onDiagnose} onFreshSrc={onFreshSrc} onFailed={onFailed} />)
    Object.defineProperty(video(), 'currentTime', { value: 12.5, writable: true, configurable: true })
    fireEvent.error(video())
    await flush()
    expect(onDiagnose).toHaveBeenCalledWith('c1')
    expect(onFreshSrc).toHaveBeenCalledWith('c1')
    expect(video().getAttribute('src')).toBe('https://d:1/v1/clips/c1?t=fresh')
    const v = video()
    const set = vi.fn()
    Object.defineProperty(v, 'currentTime', { get: () => 0, set, configurable: true })
    fireEvent.loadedData(v)
    expect(set).toHaveBeenCalledWith(12.5)
    expect(onFailed).not.toHaveBeenCalled()
    fireEvent.error(video())
    await flush()
    expect(onFreshSrc).toHaveBeenCalledTimes(1)
    expect(onFailed).toHaveBeenCalledWith('ticket')
    expect(video()).toBeNull()
    expect(screen.getByTestId('gateway-sentence').textContent).toMatch(/ticket/)
  })
  it('a 404 is the clip missing at its location; a door that served bytes the browser could not decode is the format (G7)', async () => {
    const missing = vi.fn(async () => ({ verdict: 'missing', status: 404 }))
    render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={inside} onDiagnose={missing} locationName="Footage NAS" />)
    fireEvent.error(video())
    await flush()
    expect(screen.getByTestId('gateway-sentence').textContent).toBe(gatewayMissingSentence('Footage NAS'))
    cleanup()
    render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={inside} onDiagnose={vi.fn(async () => ({ verdict: 'ok', status: 206 }))} />)
    fireEvent.error(video())
    await flush()
    expect(screen.getByTestId('gateway-sentence').textContent).toBe(NEEDS_DESKTOP_FORMAT)
    expect(mark()).toBeNull()
  })
  it('with no diagnosis given, an error is the format (nothing else can be known)', async () => {
    render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={inside} />)
    fireEvent.error(video())
    await flush()
    expect(screen.getByTestId('gateway-sentence').textContent).toBe(NEEDS_DESKTOP_FORMAT)
  })
})

describe('the cosmetic measures, named as such, and fullscreen on the container', () => {
  it('controlsList nodownload noremoteplayback nofullscreen; picture-in-picture disabled; the context menu suppressed', () => {
    render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={inside} />)
    const v = video()
    expect(v.getAttribute('controlslist')).toBe('nodownload noremoteplayback nofullscreen')
    expect(v.hasAttribute('disablepictureinpicture')).toBe(true)
    expect(v.hasAttribute('controls')).toBe(true)
    const ev = fireEvent.contextMenu(v)
    expect(ev).toBe(false) // defaultPrevented
  })
  it('the wrapper\'s Fullscreen asks the CONTAINER, never the element; a double-click does the same', () => {
    render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={outside} viewer={viewer} />)
    const container = player()
    container.requestFullscreen = vi.fn()
    video().requestFullscreen = vi.fn()
    fireEvent.click(screen.getByTitle('Fullscreen'))
    expect(container.requestFullscreen).toHaveBeenCalledTimes(1)
    fireEvent.doubleClick(container)
    expect(container.requestFullscreen).toHaveBeenCalledTimes(2)
    expect(video().requestFullscreen).not.toHaveBeenCalled()
    // The mark is inside the container, so it goes fullscreen with it.
    expect(container.contains(mark())).toBe(true)
  })
  it('an audio row is an <audio>, a still an <img>, each with the mark when outside', () => {
    render(<GatewayVideo row={{ ...row, extension: '.wav', media_type: 'audio' }} kind="audio" src="https://d:1/v1/clips/c1?t=x" stream={outside} viewer={viewer} />)
    expect(document.querySelector('audio')).toBeTruthy()
    expect(mark()).toBeTruthy()
    cleanup()
    render(<GatewayVideo row={{ ...row, extension: '.png', media_type: 'still' }} kind="image" src="https://d:1/v1/clips/c1?t=x" stream={outside} viewer={viewer} />)
    expect(document.querySelector('img.bn-gateway-media')).toBeTruthy()
    expect(video()).toBeNull()
    expect(mark()).toBeTruthy()
  })
})
