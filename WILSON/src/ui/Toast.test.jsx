/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { PAGE_BARS } from '../layout/pages'
import { Toast, ToastProvider, useToast, TOAST_TONES } from './Toast'

afterEach(() => { cleanup(); vi.useRealTimers() })

function Pusher({ opts }) {
  const toast = useToast()
  return <button onClick={() => toast.push(opts)}>push</button>
}

describe('Toast', () => {
  it('renders each tone with title, body and a dismiss control', () => {
    for (const tone of TOAST_TONES) {
      const onDismiss = vi.fn()
      const { unmount } = render(<Toast tone={tone} title={`T ${tone}`} body="b" onDismiss={onDismiss} />)
      const t = screen.getByText(`T ${tone}`).closest('.ui-toast')
      expect(t.dataset.tone).toBe(tone)
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
      expect(onDismiss).toHaveBeenCalledTimes(1)
      unmount()
    }
  })

  it('the provider stacks at one anchor, auto-dismisses, and hover pauses the timer', () => {
    vi.useFakeTimers()
    render(
      <ToastProvider>
        <Pusher opts={{ tone: 'success', title: 'Saved', duration: 1000 }} />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByText('push'))
    act(() => { vi.advanceTimersByTime(600) })
    // A second push re-renders the stack; the first toast's timer must NOT
    // restart (review round 1): it still goes at its own 1000ms.
    fireEvent.click(screen.getByText('push'))
    const stack = document.querySelector('.ui-toast-stack')
    expect(stack.querySelectorAll('.ui-toast').length).toBe(2)
    act(() => { vi.advanceTimersByTime(450) })
    expect(stack.querySelectorAll('.ui-toast').length).toBe(1)
    fireEvent.click(screen.getByText('push'))
    expect(stack.querySelectorAll('.ui-toast').length).toBe(2)
    // Hover the first: it survives the timeout; the second goes.
    const [first] = stack.querySelectorAll('.ui-toast')
    fireEvent.mouseEnter(first)
    act(() => { vi.advanceTimersByTime(1200) })
    expect(stack.querySelectorAll('.ui-toast').length).toBe(1)
    fireEvent.mouseLeave(stack.querySelector('.ui-toast'))
    act(() => { vi.advanceTimersByTime(1200) })
    expect(stack.querySelectorAll('.ui-toast').length).toBe(0)
  })

  it('useToast outside a provider is a stack trace, not a silent no-op', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Pusher opts={{}} />)).toThrow(/ToastProvider/)
    err.mockRestore()
  })
})

// ── F4 (D1b §7): the stack is anchored to the bar, not to the window ────────
describe('the toast anchor clears the page’s bottom bar', () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8')

  // The same evaluator `pageBars.test.js` uses. Deliberately strict: an
  // expression it does not recognise throws rather than resolving to
  // something plausible.
  const resolveAt = (expr, vh) => {
    const m = /^min\((-?[\d.]+)px, max\((-?[\d.]+)px, \(100vh - ([\d.]+)px\) \* ([\d.]+)\)\)$/.exec(expr)
    if (!m) throw new Error(`unrecognised bar expression: ${expr}`)
    const [, cap, floor, reserve, share] = m.map(Number)
    return Math.min(cap, Math.max(floor, (vh - reserve) * share))
  }
  // D1b's measurements, which are what the old anchor failed against.
  const ONE_TOAST = 40.84
  const TWO_TOASTS = 89.69
  const VIEWPORTS = [700, 800, 900, 1076, 1440]
  const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {})

  // 🚨 The anchor is READ, never restated. Writing `bar + 24` in the test and
  // then asserting it clears the bar proves something about the test: it would
  // stay green with `bottom: 24px` back in the stylesheet. So the shape of the
  // declaration and its gap both come out of index.css, and the bar comes out
  // of the rendered node's own custom property.
  const stackRule = css.slice(css.indexOf('.ui-toast-stack {'), css.indexOf('}', css.indexOf('.ui-toast-stack {')))
  const bottomDecl = /bottom:\s*([^;]+);/.exec(stackRule)?.[1] ?? ''
  const gapFromCss = () => {
    const m = /^calc\(var\(--toast-bar,\s*0px\)\s*\+\s*([\d.]+)px\)$/.exec(bottomDecl.trim())
    if (!m) throw new Error(`the stack no longer offsets from --toast-bar: bottom: ${bottomDecl}`)
    return Number(m[1])
  }
  /** Where the stack's bottom edge lands, from the stylesheet and the DOM. */
  const anchorAt = (page, vh) => {
    const err = quiet()
    const { container, unmount } = render(<ToastProvider bar={PAGE_BARS[page].bottom}>x</ToastProvider>)
    const declared = container.querySelector('.ui-toast-stack').style.getPropertyValue('--toast-bar')
    unmount(); err.mockRestore()
    return resolveAt(declared, vh) + gapFromCss()
  }

  it('reads the bar out of a custom property rather than a constant', () => {
    expect(() => gapFromCss()).not.toThrow()
    expect(gapFromCss()).toBe(24)
    // The control: the flat anchor really is gone, not merely joined.
    expect(stackRule).not.toMatch(/bottom:\s*24px/)
  })

  it('carries the bar the shell hands it, verbatim', () => {
    const err = quiet()
    const { container } = render(<ToastProvider bar={PAGE_BARS.settings.bottom}>x</ToastProvider>)
    expect(container.querySelector('.ui-toast-stack').style.getPropertyValue('--toast-bar'))
      .toBe(PAGE_BARS.settings.bottom)
    err.mockRestore()
  })

  // The two rows D1b named. The property that matters is that the stack's
  // BOTTOM EDGE sits at or above the bar's TOP edge — once that holds, a
  // stack of any height grows upward into clear space and the toast heights
  // stop mattering at all.
  for (const page of ['settings', 'home']) {
    it(`clears the bar on ${page} (${page === 'home' ? '268/268' : '120/80'}) at every window size`, () => {
      for (const vh of VIEWPORTS) {
        const bar = resolveAt(PAGE_BARS[page].bottom, vh)
        const anchor = anchorAt(page, vh)
        expect(anchor, `${page} at ${vh}px`).toBeGreaterThanOrEqual(bar)
        // …by the whole gap, so the stack does not merely touch the bar.
        expect(anchor - bar, `${page} gap at ${vh}px`).toBeCloseTo(gapFromCss(), 5)
        // 🚨 The OLD anchor, measured at the SAME viewport: a flat gap off the
        // window, which is what `bottom: 24px` resolved to. It sits INSIDE the
        // bar at every one of these sizes, which is the whole finding — and it
        // is an independent number, not a restatement of the line above. (An
        // earlier cut wrote `if (bar > gap) expect(gap).toBeLessThan(bar)`,
        // where the guard and the assertion were the same comparison.)
        expect(gapFromCss(), `${page}: the old flat anchor at ${vh}px`).toBeLessThan(bar)
      }
    })
  }

  it('CONTROL — the old flat anchor really did fail, and these bars are real', () => {
    // Without this the cases above could assert arithmetic that was never in
    // doubt. At 900px the light pages' bar is 80px: one toast topped out at
    // 64.84px, INSIDE it, and two at 113.69px, across its edge. D1b's numbers.
    const bar = resolveAt(PAGE_BARS.settings.bottom, 900)
    expect(bar).toBe(80)
    expect(gapFromCss() + ONE_TOAST).toBeLessThan(bar)
    expect(gapFromCss() + TWO_TOASTS).toBeGreaterThan(bar)
    // …and both now sit entirely clear of it.
    const anchor = anchorAt('settings', 900)
    expect(anchor).toBeGreaterThanOrEqual(bar)
    expect(anchor + ONE_TOAST).toBeGreaterThan(bar)
    expect(anchor + TWO_TOASTS).toBeGreaterThan(bar)
    // Home's bar is bigger again, so the flat anchor buried a whole stack.
    expect(resolveAt(PAGE_BARS.home.bottom, 1440)).toBe(268)
    expect(gapFromCss() + TWO_TOASTS).toBeLessThan(resolveAt(PAGE_BARS.home.bottom, 1440))
    expect(anchorAt('home', 1440)).toBeGreaterThanOrEqual(268)
  })

  it('says so in dev when the shell forgets, rather than sliding back silently', () => {
    const err = quiet()
    render(<ToastProvider>x</ToastProvider>)
    expect(err).toHaveBeenCalledWith(expect.stringContaining('`bar` is required'))
    err.mockRestore()
  })

  it('but does not scold a barless surface for passing 0px', () => {
    // `0px` is the honest fallback and correct where there is no bar. An
    // earlier cut warned on `bar === '0px'`, so it could not tell "not passed"
    // from "passed, correctly" — the only dev error in the kit that fired on a
    // value rather than on absence or an out-of-enum value.
    const err = quiet()
    const { container } = render(<ToastProvider bar="0px">x</ToastProvider>)
    expect(err).not.toHaveBeenCalled()
    expect(container.querySelector('.ui-toast-stack').style.getPropertyValue('--toast-bar')).toBe('0px')
    err.mockRestore()
  })

  it('the shell passes it, from the same PAGE_BARS the pet reads', () => {
    const app = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../App.jsx'), 'utf8')
    expect(app).toContain('<ToastProvider bar={pageBars.bottom}>')
    expect(app).toContain('const pageBars = PAGE_BARS[currentPage] || PAGE_BARS.home')
  })
})
