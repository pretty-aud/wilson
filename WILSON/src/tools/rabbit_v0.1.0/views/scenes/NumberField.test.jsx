/** @vitest-environment jsdom */
// =============================================================================
// Post-overhaul FX1 — NumberField on its own (Audrey, 2026-10-11: "the
// chevrons are covering up the numbers … after 5 digits, add ellipsis").
// A caller here is one of ScenesView's, its onChange copied verbatim: the
// frame count's (a blank or a refused figure is 0) and the scene number's
// (a refused figure writes nothing). jsdom lays nothing out, so what the
// field DRAWS is read from its DOM — the cap's words and `data-capped`,
// which the sheet keys the hidden text on (rabbitScenesCss.test.js reads
// those rules) — and the browser run (scripts/shot-number-fields-shots.mjs)
// measures the rest.
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import NumberField from './NumberField'

afterEach(cleanup)

/** The frame count, as the shot table holds it: min 0, a blank or a refusal
    is 0. `onStep` runs inside each write — a test's stand-in for the time a
    write's re-render takes. */
function Frames({ start, log, disabled = false, onStep }) {
  const [n, setN] = useState(start)
  return (
    <NumberField min={0} value={n ?? ''}
      onChange={e => {
        const v = parseInt(e.target.value, 10)
        const next = Number.isFinite(v) && v >= 0 ? v : 0
        log.push(next)
        onStep?.()
        setN(next)
      }}
      disabled={disabled}
      aria-label="Frames for The door"
      className="rb-scene-frames"
      placeholder="0" />
  )
}
/** The scene number, as the scene popup holds it: no min, a refused figure
    writes nothing. `calls` counts every onChange, refused or not. */
function SceneNumber({ start, log, calls = [] }) {
  const [n, setN] = useState(start)
  return (
    <NumberField value={n ?? ''}
      onChange={e => {
        calls.push(e.target.value)
        const v = parseInt(e.target.value, 10)
        if (Number.isFinite(v) && v >= 0) { log.push(v); setN(v) }
      }}
      aria-label="Scene number" />
  )
}

const field = (name = 'Frames for The door') => screen.getByRole('spinbutton', { name })
const wrapOf = (el) => el.closest('.rb-scene-number')
const capOf = (el) => wrapOf(el).querySelector(':scope > .rb-scene-number-cap')
/** What the field shows: the cap's words while it is capped, else its own value. */
const shown = (el) => (wrapOf(el).getAttribute('data-capped') === 'true' ? capOf(el).textContent : el.value)

describe('FX1: five figures and an ellipsis, the whole figure on focus', () => {
  it('a six-digit figure shows its first five and an ellipsis unfocused and the whole of it focused; the field holds the whole number throughout and says it in its title', () => {
    render(<Frames start={123456} log={[]} />)
    const el = field()
    expect(shown(el)).toBe('12345…')
    expect(capOf(el).getAttribute('aria-hidden')).toBe('true')
    expect([el.type, el.value, el.title]).toEqual(['number', '123456', '123456'])
    act(() => el.focus())
    expect(document.activeElement).toBe(el)
    expect([wrapOf(el).getAttribute('data-capped'), capOf(el)]).toEqual([null, null])
    expect(shown(el)).toBe('123456')
    // The title stays while focused: past six figures the tables' field
    // scrolls, and the title is then the one place the whole number reads.
    expect(el.title).toBe('123456')
    act(() => el.blur())
    expect(shown(el)).toBe('12345…')
    expect(el.title).toBe('123456')
  })

  it('five figures or fewer are drawn whole, with no title; so are a blank, a negative and a figure that is not whole', () => {
    for (const [start, value] of [[12345, '12345'], [99999, '99999'], [0, '0'], [null, ''], [-123456, '-123456'], [1234567.5, '1234567.5']]) {
      cleanup()
      render(<Frames start={start} log={[]} />)
      const el = field()
      expect([shown(el), wrapOf(el).getAttribute('data-capped'), capOf(el), el.getAttribute('title')], String(start)).toEqual([value, null, null, null])
      // The blank keeps its placeholder.
      if (start == null) expect(el.getAttribute('placeholder')).toBe('0')
    }
  })

  it('typing is never cut short: seven figures typed into the focused field reach the caller whole, and the cap comes back on blur', () => {
    const log = []
    render(<Frames start={240} log={log} />)
    const el = field()
    act(() => el.focus())
    fireEvent.change(el, { target: { value: '1234567' } })
    expect(log).toEqual([1234567])
    expect(shown(el)).toBe('1234567')
    act(() => el.blur())
    expect([shown(el), el.value, el.title]).toEqual(['12345…', '1234567', '1234567'])
  })

  it('CONTROL: five is the line — 99999 is whole, 100000 is capped', () => {
    render(<Frames start={99999} log={[]} />)
    expect(shown(field())).toBe('99999')
    cleanup()
    render(<Frames start={100000} log={[]} />)
    expect(shown(field())).toBe('10000…')
  })
})

describe('FX1: the field\'s own chevrons', () => {
  const up = (name = 'Frames for The door') => screen.getByRole('button', { name: `Increase ${name}` })
  const down = (name = 'Frames for The door') => screen.getByRole('button', { name: `Decrease ${name}` })

  it('each steps by one through the caller\'s own onChange — the event the browser\'s spinner fired — and never below min', () => {
    const log = []
    render(<Frames start={0} log={log} />)
    fireEvent.click(up())
    fireEvent.click(up())
    expect([log, field().value]).toEqual([[1, 2], '2'])
    fireEvent.click(down())
    fireEvent.click(down())
    // At min, nothing: no event, no write.
    fireEvent.click(down())
    expect([log, field().value]).toEqual([[1, 2, 1, 0], '0'])
  })

  it('a blank steps up to 1 and down to min, as the browser\'s spinner did', () => {
    const log = []
    render(<Frames start={null} log={log} />)
    fireEvent.click(up())
    expect(log).toEqual([1])
    cleanup()
    const log2 = []
    render(<Frames start={null} log={log2} />)
    fireEvent.click(down())
    expect([log2, field().value]).toEqual([[0], '0'])
  })

  it('without a min a step below zero reaches the caller, which refuses it, and the field keeps what it holds (the scene number)', () => {
    const log = []
    render(<SceneNumber start={0} log={log} />)
    fireEvent.click(down('Scene number'))
    expect([log, field('Scene number').value]).toEqual([[], '0'])
    fireEvent.click(up('Scene number'))
    expect([log, field('Scene number').value]).toEqual([[1], '1'])
  })

  it('a six-digit figure steps as itself, not as its cap', () => {
    const log = []
    render(<Frames start={123456} log={log} />)
    fireEvent.click(up())
    expect([log, field().value, field().title]).toEqual([[123457], '123457', '123457'])
  })

  it('a press keeps the focus in the field, bringing it there first — so the figure shown while stepping is the whole one', () => {
    render(<Frames start={123456} log={[]} />)
    const el = field()
    expect(shown(el)).toBe('12345…')
    // fireEvent returns false when the default was prevented: the chevron takes no focus.
    expect(fireEvent.mouseDown(up())).toBe(false)
    expect(document.activeElement).toBe(el)
    expect(shown(el)).toBe('123456')
  })

  it('the chevrons are not tab stops', () => {
    render(<Frames start={240} log={[]} />)
    expect([up(), down()].map((b) => [b.getAttribute('type'), b.getAttribute('tabindex')])).toEqual([['button', '-1'], ['button', '-1']])
  })

  it('a disabled field has none, and its six-digit figure is still capped', () => {
    const log = []
    render(<Frames start={123456} log={log} disabled />)
    const el = field()
    expect(el.disabled).toBe(true)
    expect(screen.queryByRole('button')).toBeNull()
    expect(wrapOf(el).querySelector('.rb-scene-number-step')).toBeNull()
    expect(shown(el)).toBe('12345…')
  })

  it('R1-06: a press on either chevron keeps the focus in the field', () => {
    render(<Frames start={240} log={[]} />)
    for (const b of [down(), up()]) {
      act(() => document.body.focus())
      expect(fireEvent.mouseDown(b), b.getAttribute('aria-label')).toBe(false)
      expect(document.activeElement, b.getAttribute('aria-label')).toBe(field())
    }
  })
})

/* Review round 1's corrections: the held chevron (R1-05), the focus a
   disabled field cannot keep (R1-04), the figure typed with leading zeros
   (R1-07). */
describe('FX1 review round 1: holding, disabling, leading zeros', () => {
  const up = () => screen.getByRole('button', { name: 'Increase Frames for The door' })
  const down = () => screen.getByRole('button', { name: 'Decrease Frames for The door' })
  // The page's clock is the fake one: the beat is reckoned against it.
  const fakeClock = () => { vi.useFakeTimers(); vi.spyOn(performance, 'now').mockImplementation(() => Date.now()) }
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('R1-05 / R2-01: a held chevron steps once on the press, again 250ms later, then every 50ms, and stops when it is let go', () => {
    fakeClock()
    const log = []
    render(<Frames start={2000} log={log} />)
    fireEvent.pointerDown(up(), { button: 0 })
    expect(log).toEqual([2001])
    act(() => vi.advanceTimersByTime(249))
    expect(log).toEqual([2001])
    act(() => vi.advanceTimersByTime(1))
    expect(log).toEqual([2001, 2002])
    act(() => vi.advanceTimersByTime(150))
    expect(log).toEqual([2001, 2002, 2003, 2004, 2005])
    fireEvent.pointerUp(up(), { button: 0 })
    // The pointer's own click after its press steps nothing more (detail 1).
    fireEvent.click(up(), { detail: 1 })
    act(() => vi.advanceTimersByTime(1000))
    expect([log.length, field().value]).toEqual([5, '2005'])
  })

  it('R1-05: the repeat stops when the field blurs and at min; a right button does nothing', () => {
    fakeClock()
    const log = []
    render(<Frames start={3} log={log} />)
    fireEvent.pointerDown(up(), { button: 0 })
    act(() => field().focus())
    act(() => field().blur())
    act(() => vi.advanceTimersByTime(1000))
    expect(log).toEqual([4])
    fireEvent.pointerUp(up(), { button: 0 })
    // Held down from 4: 3 on the press, 2, 1, 0, then nothing — min is 0.
    fireEvent.pointerDown(down(), { button: 0 })
    act(() => vi.advanceTimersByTime(5000))
    expect(log).toEqual([4, 3, 2, 1, 0])
    fireEvent.pointerUp(down(), { button: 0 })
    fireEvent.pointerDown(up(), { button: 2 })
    act(() => vi.advanceTimersByTime(1000))
    expect(log).toEqual([4, 3, 2, 1, 0])
  })

  it('R1-05: a held Decrease under a caller that refuses the figure (a scene number at 0) offers it once, writes nothing and stops', () => {
    fakeClock()
    const log = []
    const calls = []
    render(<SceneNumber start={0} log={log} calls={calls} />)
    const minus = screen.getByRole('button', { name: 'Decrease Scene number' })
    fireEvent.pointerDown(minus, { button: 0 })
    act(() => vi.advanceTimersByTime(2000))
    expect([calls, log, field('Scene number').value]).toEqual([['-1'], [], '0'])
  })

  it('R1-04: a field disabled while it had the focus is capped again once it is enabled', () => {
    const log = []
    const { rerender } = render(<Frames start={123456} log={log} />)
    act(() => field().focus())
    expect(shown(field())).toBe('123456')
    rerender(<Frames start={123456} log={log} disabled />)
    rerender(<Frames start={123456} log={log} />)
    expect(shown(field())).toBe('12345…')
  })

  it('R1-07: a figure typed with leading zeros is stored as its number and, on blur, shown as it is stored — capped past five figures', () => {
    const log = []
    render(<Frames start={240} log={log} />)
    const el = field()
    act(() => el.focus())
    fireEvent.change(el, { target: { value: '00000001' } })
    expect(log).toEqual([1])
    act(() => el.blur())
    expect(el.value).toBe('1')
    act(() => el.focus())
    fireEvent.change(el, { target: { value: '000123456' } })
    act(() => el.blur())
    expect([el.value, shown(el), el.title]).toEqual(['123456', '12345…', '123456'])
  })

  it('CONTROL: a figure spelt as stored is left alone on blur, and so is a blank', () => {
    const log = []
    render(<Frames start={null} log={log} />)
    const el = field()
    act(() => el.focus())
    act(() => el.blur())
    expect([el.value, log]).toEqual(['', []])
  })
})

/* Review round 2's corrections: the hold at the browser's pace and on its
   terms (R2-01), its release pinned for both chevrons (R2-02), what round 1
   added that nothing pinned (R2-14), a touch's first tap (R2-15). */
describe('FX1 review round 2: the hold\'s pace, its release, its cleanup, a first tap', () => {
  const up = () => screen.getByRole('button', { name: 'Increase Frames for The door' })
  const down = () => screen.getByRole('button', { name: 'Decrease Frames for The door' })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('R2-01: the beat is kept against the page\'s clock — a write whose re-render takes 40ms of its 50 does not stretch the next — 26 steps or more in a 1.5 s hold', () => {
    vi.useFakeTimers()
    // The page's clock runs on by `lag` while each write re-renders: what
    // the hold reads with performance.now(), the timers do not see.
    let lag = 0
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now() + lag)
    const log = []
    render(<Frames start={0} log={log} onStep={() => { lag += 40 }} />)
    const start = performance.now()
    fireEvent.pointerDown(up(), { button: 0 })
    while (performance.now() - start < 1500) act(() => vi.advanceTimersByTime(1))
    fireEvent.pointerUp(up(), { button: 0 })
    // The press, then one at 250ms and every 50ms to 1500: 27 at most.
    expect(log.length).toBeGreaterThanOrEqual(26)
    expect(log.length).toBeLessThanOrEqual(27)
  })

  it('R2-01 / R2-02: either chevron, held, keeps counting when the pointer slides off it, as the browser\'s spinner did, and stops when it is let go on it, let go anywhere else, or cancelled', () => {
    const RELEASES = [
      ['let go on the chevron', (b) => fireEvent.pointerUp(b, { button: 0 })],
      ['let go elsewhere', () => fireEvent.pointerUp(document.body, { button: 0 })],
      ['cancelled', () => fireEvent(window, new Event('pointercancel'))],
    ]
    for (const [which, chevron, sign] of [['Increase', up, 1], ['Decrease', down, -1]]) {
      for (const [how, release] of RELEASES) {
        cleanup()
        vi.useFakeTimers()
        vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
        const log = []
        render(<Frames start={100} log={log} />)
        const b = chevron()
        fireEvent.pointerDown(b, { button: 0 })
        act(() => vi.advanceTimersByTime(300))
        fireEvent.pointerLeave(b)
        act(() => vi.advanceTimersByTime(100))
        expect(log, `${which}, slid off`).toEqual([1, 2, 3, 4, 5].map((k) => 100 + sign * k))
        release(b)
        act(() => vi.advanceTimersByTime(1000))
        expect(log.length, `${which}, ${how}`).toBe(5)
        vi.useRealTimers()
        vi.restoreAllMocks()
      }
    }
  })

  it('R2-14: a press on one chevron while the other is held takes over — only the newest repeats', () => {
    vi.useFakeTimers()
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
    const log = []
    render(<Frames start={100} log={log} />)
    fireEvent.pointerDown(up(), { button: 0 })
    act(() => vi.advanceTimersByTime(300))
    fireEvent.pointerDown(down(), { button: 0 })
    act(() => vi.advanceTimersByTime(300))
    fireEvent.pointerUp(down(), { button: 0 })
    act(() => vi.advanceTimersByTime(1000))
    expect(log).toEqual([101, 102, 103, 102, 101, 100])
  })

  it('R2-14: a field unmounted or disabled mid-hold takes the window\'s listeners away and steps no more', () => {
    for (const end of ['unmount', 'disable']) {
      cleanup()
      vi.useFakeTimers()
      vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
      const added = vi.spyOn(window, 'addEventListener')
      const removed = vi.spyOn(window, 'removeEventListener')
      const log = []
      const { rerender, unmount } = render(<Frames start={100} log={log} />)
      fireEvent.pointerDown(up(), { button: 0 })
      const listener = added.mock.calls.find(([type]) => type === 'pointerup')?.[1]
      expect(listener, end).toBeTypeOf('function')
      removed.mockClear()
      if (end === 'unmount') unmount()
      else rerender(<Frames start={100} log={log} disabled />)
      expect(removed.mock.calls.filter(([type, fn]) => fn === listener).map(([type]) => type).sort(), end).toEqual(['pointercancel', 'pointerup'])
      act(() => vi.advanceTimersByTime(1000))
      expect(log, end).toEqual([101])
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })

  it('R2-15: a click whose press landed elsewhere — a touch\'s first tap, the chevrons not yet showing — steps once; a click after the chevron\'s own press does not', () => {
    const log = []
    render(<Frames start={240} log={log} />)
    fireEvent.click(up(), { detail: 1 })
    expect(log).toEqual([241])
    fireEvent.pointerDown(down(), { button: 0 })
    fireEvent.pointerUp(down(), { button: 0 })
    fireEvent.click(down(), { detail: 1 })
    expect(log).toEqual([241, 240])
  })
})
