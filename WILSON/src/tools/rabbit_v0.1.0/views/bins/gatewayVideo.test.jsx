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
import { useState, useCallback } from 'react'
import GatewayVideo, { ViewerMark, memberCodeOf, markWords, clockWords, MARK_POSITIONS, MARK_MOVE_MS, POSITION_CLASS, RENEW_RETRY_MS, LOADING_AFTER_MS, markPositionAt } from './GatewayVideo'
import { NEEDS_DESKTOP_FORMAT, GATEWAY_LOADING, gatewayMissingSentence, refusalSentence, FULLSCREEN_KEEPS_MARK, GATEWAY_REFUSED_FRESH_TICKET, CONNECTION_DROPPED } from '../../bins/binLocations'
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
    // 14:02:30 starts a turn of the five 30 s slots (the clock decides, round 2 note 14).
    vi.setSystemTime(new Date(2026, 9, 11, 14, 2, 30))
    expect(markPositionAt(Date.now())).toBe('top-left')
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
    // The clock turns within 15 s of the minute, not only when the mark moves (every 30 s).
    act(() => { vi.advanceTimersByTime(15_000) })
    expect(mark().textContent).toContain('14:03')
    // …and the position is the clock's: 14:03:00 opens the next 30 s slot.
    expect(mark().className).toContain(POSITION_CLASS[markPositionAt(Date.now())])
    expect(mark().className).toContain(POSITION_CLASS['top-right'])
  })
  it('no mark without a src (nothing is playing), nor once the player failed', async () => {
    render(<GatewayVideo row={row} src={null} stream={outside} viewer={viewer} />)
    expect(mark()).toBeNull()
    expect((await screen.findByTestId('gateway-loading')).textContent).toBe(GATEWAY_LOADING)
  })
  it('no src and the cloud refused a ticket: the refusal\'s sentence, not "loading" for good; while a ticket is on its way, "loading" still', async () => {
    render(<GatewayVideo row={row} src={null} stream={{ ...outside, ticketError: 'Sign in again: WILSON could not confirm who is asking for this.', pending: false }} viewer={viewer} />)
    expect(screen.queryByTestId('gateway-loading')).toBeNull()
    expect(screen.getByTestId('gateway-sentence').textContent).toBe('Sign in again: WILSON could not confirm who is asking for this.')
    expect(mark()).toBeNull()
    cleanup()
    render(<GatewayVideo row={row} src={null} stream={{ ...outside, ticketError: 'Sign in again.', pending: true }} viewer={viewer} />)
    expect((await screen.findByTestId('gateway-loading')).textContent).toBe(GATEWAY_LOADING)
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
  // jsdom's media never plays: the element is made to read as playing.
  const playing = () => { const v = video(); Object.defineProperty(v, 'paused', { value: false, configurable: true }); fireEvent.play(v); return v }
  it('onRenew(row.id) fires at 75 s and again at 150 s while a door plays the stream; the src never changes', async () => {
    vi.useFakeTimers()
    const onRenew = vi.fn(async () => ({ ok: true }))
    render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={inside} onRenew={onRenew} />)
    playing()
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
    playing()
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
    playing()
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
    playing()
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
    playing()
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
  it('a stale ticket (the HEAD says 401): ONE fresh src at the same currentTime; that src failing before it loads is said, not retried', async () => {
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
    expect(onFailed).not.toHaveBeenCalled()
    fireEvent.error(video())
    await flush()
    expect(onFreshSrc).toHaveBeenCalledTimes(1)
    expect(onFailed).toHaveBeenCalledWith('ticket')
    expect(video()).toBeNull()
    expect(screen.getByTestId('gateway-sentence').textContent).toMatch(/ticket/)
  })
  it('a fresh src that LOADED gives the recovery back: a later stale ticket (an idle player played again) is recovered once more, at the same moment', async () => {
    let n = 0
    const onDiagnose = vi.fn(async () => ({ verdict: 'ticket', status: 401 }))
    const onFreshSrc = vi.fn(async () => `https://d:1/v1/clips/c1?t=fresh${++n}`)
    render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=stale" stream={inside} onDiagnose={onDiagnose} onFreshSrc={onFreshSrc} />)
    fireEvent.error(video())
    await flush()
    const v = video()
    const set = vi.fn()
    Object.defineProperty(v, 'currentTime', { get: () => 0, set, configurable: true })
    fireEvent.loadedData(v)
    expect(set).toHaveBeenCalledWith(0)
    fireEvent.error(video())
    await flush()
    expect(onFreshSrc).toHaveBeenCalledTimes(2)
    expect(video().getAttribute('src')).toBe('https://d:1/v1/clips/c1?t=fresh2')
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

describe('one gateway player sounds at a time', () => {
  it('the large player starting pauses the inspector\'s, and back; a paused one is left alone; an unmounted one is forgotten', () => {
    render(
      <>
        <GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={inside} />
        <GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={inside} autoPlay />
      </>,
    )
    const [a, b] = [...document.querySelectorAll('video')]
    a.pause = vi.fn()
    b.pause = vi.fn()
    Object.defineProperty(a, 'paused', { value: false, configurable: true })
    fireEvent.play(a)
    fireEvent.play(b)
    expect(a.pause).toHaveBeenCalledTimes(1)
    expect(b.pause).not.toHaveBeenCalled()
    Object.defineProperty(b, 'paused', { value: false, configurable: true })
    fireEvent.play(a)
    expect(b.pause).toHaveBeenCalledTimes(1)
    // A player already paused is not paused again.
    Object.defineProperty(a, 'paused', { value: true, configurable: true })
    fireEvent.play(b)
    expect(a.pause).toHaveBeenCalledTimes(1)
  })
  it('CONTROL: a player alone is never paused by itself', () => {
    render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={inside} />)
    const v = video()
    v.pause = vi.fn()
    Object.defineProperty(v, 'paused', { value: false, configurable: true })
    fireEvent.play(v)
    fireEvent.play(v)
    expect(v.pause).not.toHaveBeenCalled()
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

describe('round 1\'s corrections, the player', () => {
  const tick = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
  it('finding 7: an idle player (never played) is not renewed at all — no mint, no POST; once played it is, at the next turn; a still never is', async () => {
    vi.useFakeTimers()
    const onRenew = vi.fn(async () => ({ ok: true }))
    render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={inside} onRenew={onRenew} />)
    await tick(RENEW_AFTER_MS * 3)
    expect(onRenew).not.toHaveBeenCalled()
    const v = video()
    Object.defineProperty(v, 'paused', { value: false, configurable: true })
    fireEvent.play(v)
    await tick(RENEW_AFTER_MS)
    expect(onRenew).toHaveBeenCalledTimes(1)
    // Paused for good: one more renewal covers the time it played since the
    // last one, then none — the stream lapses.
    Object.defineProperty(v, 'paused', { value: true, configurable: true })
    fireEvent.pause(v)
    await tick(RENEW_AFTER_MS)
    expect(onRenew).toHaveBeenCalledTimes(2)
    await tick(RENEW_AFTER_MS * 4)
    expect(onRenew).toHaveBeenCalledTimes(2)
    cleanup()
    const still = vi.fn(async () => ({ ok: true }))
    render(<GatewayVideo row={{ ...row, extension: '.png', media_type: 'still' }} kind="image" src="https://d:1/v1/clips/c1?t=x" stream={inside} onRenew={still} />)
    await tick(RENEW_AFTER_MS * 3)
    expect(still).not.toHaveBeenCalled()
    cleanup()
    // The inspector hands its own media ref; a still shown while that ref
    // still names a playing element is not renewed either: a still is
    // fetched once, whatever else plays.
    const shared = { current: { paused: false, currentTime: 3 } }
    const still2 = vi.fn(async () => ({ ok: true }))
    render(<GatewayVideo row={{ ...row, extension: '.png', media_type: 'still' }} kind="image" src="https://d:1/v1/clips/c1?t=x" stream={inside} onRenew={still2} mediaRef={shared} />)
    await tick(RENEW_AFTER_MS * 3)
    expect(still2).not.toHaveBeenCalled()
    cleanup()
    // CONTROL: the same ref under a video is renewed.
    const shared2 = { current: { paused: false, currentTime: 3 } }
    const clip = vi.fn(async () => ({ ok: true }))
    render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={inside} onRenew={clip} mediaRef={shared2} />)
    shared2.current = { paused: false, currentTime: 3 }
    await tick(RENEW_AFTER_MS)
    expect(clip).toHaveBeenCalledTimes(1)
  })
  it('finding 4: through the OUTSIDE door, the bare element taken fullscreen by the browser\'s own control is paused, put back, and told where fullscreen is; the office door is left alone', async () => {
    render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={outside} viewer={viewer} />)
    const v = video()
    v.pause = vi.fn()
    const exit = vi.fn(() => Promise.resolve())
    document.exitFullscreen = exit
    Object.defineProperty(document, 'fullscreenElement', { get: () => v, configurable: true })
    try {
      await act(async () => { document.dispatchEvent(new Event('fullscreenchange')) })
      expect(v.pause).toHaveBeenCalledTimes(1)
      expect(exit).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('gateway-sentence').textContent).toBe(FULLSCREEN_KEEPS_MARK)
      // Played again: the sentence goes.
      fireEvent.play(v)
      expect(screen.queryByTestId('gateway-sentence')).toBeNull()
      // The CONTAINER fullscreen (the frame's own button) is not touched.
      Object.defineProperty(document, 'fullscreenElement', { get: () => document.querySelector('[data-testid="gateway-player"]'), configurable: true })
      await act(async () => { document.dispatchEvent(new Event('fullscreenchange')) })
      expect(v.pause).toHaveBeenCalledTimes(1)
      cleanup()
      // The office door: nothing to guard (no mark to lose).
      render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={inside} />)
      const w = video()
      w.pause = vi.fn()
      Object.defineProperty(document, 'fullscreenElement', { get: () => w, configurable: true })
      await act(async () => { document.dispatchEvent(new Event('fullscreenchange')) })
      expect(w.pause).not.toHaveBeenCalled()
    } finally {
      delete document.fullscreenElement
      delete document.exitFullscreen
    }
  })
  it('finding 4: picture-in-picture and iOS\'s native player are undone the same way through the outside door', async () => {
    render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={outside} viewer={viewer} />)
    const v = video()
    v.pause = vi.fn()
    v.webkitExitFullscreen = vi.fn()
    document.exitPictureInPicture = vi.fn(() => Promise.resolve())
    try {
      await act(async () => { v.dispatchEvent(new Event('enterpictureinpicture')) })
      expect(v.pause).toHaveBeenCalledTimes(1)
      expect(document.exitPictureInPicture).toHaveBeenCalledTimes(1)
      await act(async () => { v.dispatchEvent(new Event('webkitbeginfullscreen')) })
      expect(v.pause).toHaveBeenCalledTimes(2)
      expect(v.webkitExitFullscreen).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('gateway-sentence').textContent).toBe(FULLSCREEN_KEEPS_MARK)
    } finally { delete document.exitPictureInPicture }
  })
  it('finding 6: a decode failure is the format at once, the door not asked; the recovery resumes PLAYING when it was playing', async () => {
    const onDiagnose = vi.fn(async () => ({ verdict: 'ok' }))
    render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={inside} onDiagnose={onDiagnose} />)
    const v = video()
    Object.defineProperty(v, 'error', { value: { code: 3 }, configurable: true })
    fireEvent.error(v)
    await flush()
    expect(onDiagnose).not.toHaveBeenCalled()
    expect(screen.getByTestId('gateway-sentence').textContent).toBe(NEEDS_DESKTOP_FORMAT)
    cleanup()
    const diagnose = vi.fn(async () => ({ verdict: 'ticket', status: 401 }))
    const fresh = vi.fn(async () => 'https://d:1/v1/clips/c1?t=fresh')
    render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={inside} onDiagnose={diagnose} onFreshSrc={fresh} />)
    const a = video()
    Object.defineProperty(a, 'paused', { value: false, configurable: true })
    Object.defineProperty(a, 'currentTime', { value: 33, writable: true, configurable: true })
    fireEvent.play(a)
    fireEvent.error(a)
    await flush()
    const b = video()
    expect(b.getAttribute('src')).toBe('https://d:1/v1/clips/c1?t=fresh')
    const set = vi.fn()
    Object.defineProperty(b, 'currentTime', { get: () => 0, set, configurable: true })
    b.play = vi.fn(async () => {})
    fireEvent.loadedData(b)
    await flush()
    expect(set).toHaveBeenCalledWith(33)
    expect(b.play).toHaveBeenCalled()
  })
  it('note 13: a refusal is said by its reason — a path too long, a ticket WILSON could not read — never as the format', async () => {
    const onDiagnose = vi.fn(async () => ({ verdict: 'refused', status: 0, reason: 'too_long' }))
    render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={inside} onDiagnose={onDiagnose} />)
    fireEvent.error(video())
    await flush()
    expect(screen.getByTestId('gateway-sentence').textContent).toBe(refusalSentence('too_long'))
    expect(screen.getByTestId('gateway-sentence').textContent).not.toBe(NEEDS_DESKTOP_FORMAT)
    cleanup()
    render(<GatewayVideo row={row} src={null} stream={{ ...inside, refused: 'bad_ticket', pending: false }} />)
    expect(screen.getByTestId('gateway-sentence').textContent).toBe(refusalSentence('bad_ticket'))
    expect(screen.queryByTestId('gateway-loading')).toBeNull()
  })
})

describe('round 2\'s corrections, the player', () => {
  const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve() })
  // A parent that does what the inspector does: the composite's fresh URL
  // becomes the next `src` it hands the player (finding 1's shape).
  function Mirror({ onDiagnose, mint }) {
    const [src, setSrc] = useState('https://d:1/v1/clips/c1?t=t0')
    const onFreshSrc = useCallback(async (id) => { const url = await mint(id); setSrc(url); return url }, [mint])
    return <GatewayVideo row={row} src={src} stream={outside} viewer={viewer} onDiagnose={onDiagnose} onFreshSrc={onFreshSrc} />
  }
  it('finding 1: the fresh src the player asked for, handed back by the parent as its src, does NOT hand the recovery back — a door that refuses every ticket costs one fresh src, then the sentence', async () => {
    let n = 0
    const mint = vi.fn(async () => `https://d:1/v1/clips/c1?t=fresh${++n}`)
    const onDiagnose = vi.fn(async () => ({ verdict: 'ticket', status: 401 }))
    render(<Mirror onDiagnose={onDiagnose} mint={mint} />)
    for (let i = 0; i < 6; i++) {
      const v = video()
      if (!v) break
      fireEvent.error(v)
      await flush()
    }
    expect(mint).toHaveBeenCalledTimes(1)
    expect(onDiagnose).toHaveBeenCalledTimes(2)
    expect(video()).toBeNull()
    expect(screen.getByTestId('gateway-sentence').textContent).toMatch(/ticket/)
  })
  it('finding 1, the other order: the parent\'s new src renders BEFORE the player\'s own fresh src lands — still one fresh src, then the sentence', async () => {
    let n = 0
    const mint = vi.fn(async () => `https://d:1/v1/clips/c1?t=fresh${++n}`)
    const onDiagnose = vi.fn(async () => ({ verdict: 'ticket', status: 401 }))
    // freshStreamUrl's answer is held at a gate the test opens only after the
    // parent has rendered the fresh URL as its src (the provider's re-render
    // reaching the player first).
    let open = null
    function ParentFirst() {
      const [src, setSrc] = useState('https://d:1/v1/clips/c1?t=t0')
      const onFreshSrc = useCallback(async (id) => { const url = await mint(id); setSrc(url); await new Promise((r) => { open = r }); return url }, [])
      return <GatewayVideo row={row} src={src} stream={outside} viewer={viewer} onDiagnose={onDiagnose} onFreshSrc={onFreshSrc} />
    }
    render(<ParentFirst />)
    const tickOut = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    let parentFirst = 0
    for (let i = 0; i < 6; i++) {
      const v = video()
      if (!v) break
      fireEvent.error(v)
      await tickOut() // the diagnosis, the mint, the parent's new src: rendered as this act ends
      if (open) {
        // The parent's fresh src is on the element while the player still waits for its answer.
        if (video()?.getAttribute('src')?.includes('fresh')) parentFirst++
        await act(async () => { const o = open; open = null; o(); await new Promise((r) => setTimeout(r, 0)) })
      }
    }
    expect(parentFirst).toBe(1)
    expect(mint).toHaveBeenCalledTimes(1)
    expect(video()).toBeNull()
    expect(screen.getByTestId('gateway-sentence').textContent).toMatch(/ticket/)
  })
  it('finding 1: the parent handing back the fresh URL after its first frame keeps the picture drawn — the element already has it', async () => {
    const onDiagnose = vi.fn(async () => ({ verdict: 'ticket', status: 401 }))
    const onFreshSrc = vi.fn(async () => 'https://d:1/v1/clips/c1?t=fresh')
    const { rerender } = render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=stale" stream={inside} onDiagnose={onDiagnose} onFreshSrc={onFreshSrc} />)
    fireEvent.error(video())
    await flush()
    expect(video().getAttribute('src')).toBe('https://d:1/v1/clips/c1?t=fresh')
    fireEvent.loadedData(video())
    expect(player().getAttribute('data-loaded')).toBe('true')
    rerender(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=fresh" stream={inside} onDiagnose={onDiagnose} onFreshSrc={onFreshSrc} />)
    await flush()
    expect(player().getAttribute('data-loaded')).toBe('true')
    expect(video().getAttribute('src')).toBe('https://d:1/v1/clips/c1?t=fresh')
  })
  it('finding 1: the composite\'s word for a young ticket refused (door_refused) is said as the door\'s refusal, with no fresh src', async () => {
    const onFreshSrc = vi.fn(async () => 'https://d:1/v1/clips/c1?t=fresh')
    render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={outside} viewer={viewer} onDiagnose={async () => ({ verdict: 'door_refused', status: 401 })} onFreshSrc={onFreshSrc} />)
    fireEvent.error(video())
    await flush()
    expect(onFreshSrc).not.toHaveBeenCalled()
    expect(screen.getByTestId('gateway-sentence').textContent).toBe(GATEWAY_REFUSED_FRESH_TICKET)
  })
  it('note 11: a connection that dropped while the door still serves (MEDIA_ERR_NETWORK, a 2xx HEAD) is loaded again at the same moment, once; then said, with Try again — never the format', async () => {
    const onDiagnose = vi.fn(async () => ({ verdict: 'ok', status: 206 }))
    render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={inside} onDiagnose={onDiagnose} />)
    const v = video()
    v.load = vi.fn()
    Object.defineProperty(v, 'error', { value: { code: 2 }, configurable: true })
    Object.defineProperty(v, 'currentTime', { value: 31, writable: true, configurable: true })
    fireEvent.error(v)
    await flush()
    expect(v.load).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('gateway-sentence')).toBeNull()
    fireEvent.error(v)
    await flush()
    expect(screen.getByTestId('gateway-sentence').textContent).toContain(CONNECTION_DROPPED)
    expect(screen.getByTestId('gateway-sentence').textContent).not.toContain(NEEDS_DESKTOP_FORMAT)
    fireEvent.click(screen.getByTestId('gateway-retry'))
    await flush()
    expect(video()).toBeTruthy()
    expect(screen.queryByTestId('gateway-sentence')).toBeNull()
    cleanup()
    // CONTROL: bytes the browser cannot use (MEDIA_ERR_SRC_NOT_SUPPORTED) with a 2xx are the format.
    render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={inside} onDiagnose={onDiagnose} />)
    const w = video()
    Object.defineProperty(w, 'error', { value: { code: 4 }, configurable: true })
    fireEvent.error(w)
    await flush()
    expect(screen.getByTestId('gateway-sentence').textContent).toBe(NEEDS_DESKTOP_FORMAT)
  })
  it('note 14: the mark\'s position is the clock\'s — a player mounted again mid-turn shows the slot it is in, not the first', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 11, 14, 2, 30))
    const first = render(<ViewerMark viewer={viewer} />)
    act(() => { vi.advanceTimersByTime(MARK_MOVE_MS * 2 + 1_000) })
    expect(mark().className).toContain(POSITION_CLASS['bottom-right'])
    first.unmount()
    render(<ViewerMark viewer={viewer} />)
    expect(mark().className).toContain(POSITION_CLASS['bottom-right'])
    expect(MARK_POSITIONS.map((p, i) => markPositionAt(new Date(2026, 9, 11, 14, 2, 30).getTime() + i * MARK_MOVE_MS))).toEqual(MARK_POSITIONS)
  })
  it('note 15: the element\'s own fullscreen asked INSIDE the frame\'s fullscreen steps back to the frame — no pause, nothing said; the frame\'s fullscreen clears an earlier guard', async () => {
    render(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={outside} viewer={viewer} />)
    const v = video()
    v.pause = vi.fn()
    const exit = vi.fn(() => Promise.resolve())
    document.exitFullscreen = exit
    let fe = null
    Object.defineProperty(document, 'fullscreenElement', { get: () => fe, configurable: true })
    try {
      // Outside the frame's fullscreen first: the guard pauses and says it.
      fe = v
      await act(async () => { document.dispatchEvent(new Event('fullscreenchange')) })
      expect(v.pause).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('gateway-sentence').textContent).toBe(FULLSCREEN_KEEPS_MARK)
      fe = null
      await act(async () => { document.dispatchEvent(new Event('fullscreenchange')) })
      // The frame's own fullscreen: the earlier sentence is history.
      fe = player()
      await act(async () => { document.dispatchEvent(new Event('fullscreenchange')) })
      expect(screen.queryByTestId('gateway-sentence')).toBeNull()
      // The element's control inside it: one level back, no pause, nothing said.
      fe = v
      await act(async () => { document.dispatchEvent(new Event('fullscreenchange')) })
      expect(exit).toHaveBeenCalledTimes(2)
      expect(v.pause).toHaveBeenCalledTimes(1)
      expect(screen.queryByTestId('gateway-sentence')).toBeNull()
    } finally {
      delete document.fullscreenElement
      delete document.exitFullscreen
    }
  })
  it('note 16: "loading" is said only once a ticket has taken 300 ms — a fast hand-over shows no flicker of it', () => {
    vi.useFakeTimers()
    const { rerender } = render(<GatewayVideo row={row} src={null} stream={inside} />)
    act(() => { vi.advanceTimersByTime(LOADING_AFTER_MS - 10) })
    expect(screen.queryByTestId('gateway-loading')).toBeNull()
    rerender(<GatewayVideo row={row} src="https://d:1/v1/clips/c1?t=x" stream={inside} />)
    act(() => { vi.advanceTimersByTime(1_000) })
    expect(screen.queryByTestId('gateway-loading')).toBeNull()
    cleanup()
    render(<GatewayVideo row={row} src={null} stream={inside} />)
    act(() => { vi.advanceTimersByTime(LOADING_AFTER_MS + 10) })
    expect(screen.getByTestId('gateway-loading').textContent).toBe(GATEWAY_LOADING)
  })
  it('note 17: the player\'s words are announced (role="status"); the mark is not (aria-hidden)', async () => {
    render(<GatewayVideo row={row} src={null} stream={{ ...outside, ticketError: 'Sign in again.', pending: false }} viewer={viewer} />)
    expect(screen.getByTestId('gateway-sentence').getAttribute('role')).toBe('status')
    cleanup()
    render(<GatewayVideo row={row} src={null} stream={inside} />)
    expect((await screen.findByTestId('gateway-loading')).getAttribute('role')).toBe('status')
  })
})
