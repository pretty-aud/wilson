/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { PAGE_BARS } from '../layout/pages'
import { Toast, ToastProvider, useToast, TOAST_TONES, toastFocusReturn } from './Toast'

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

  it('`name` on push is the accessible name of the surface, and a toast without one has none (B-R1-03)', () => {
    render(
      <ToastProvider bar="0px">
        <Pusher opts={{ tone: 'warning', title: 'Session ending', name: 'Session ending', duration: 0 }} />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByText('push'))
    // role="alert" takes its name from the author only, so this is the query
    // sessions.spec.ts makes — and it resolves through aria-label, not text.
    const named = screen.getByRole('alert', { name: 'Session ending' })
    expect(named.getAttribute('aria-label')).toBe('Session ending')
    expect(named.closest('.ui-toast-stack')).not.toBeNull()
    cleanup()
    render(
      <ToastProvider bar="0px">
        <Pusher opts={{ tone: 'warning', title: 'Unnamed', duration: 0 }} />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByText('push'))
    expect(screen.getByRole('alert').getAttribute('aria-label')).toBeNull()
    expect(screen.queryByRole('alert', { name: 'Unnamed' })).toBeNull()
  })

  it('`dismissible: false` on push drops the ×, and the owner’s own exit still works (B-R2-04)', () => {
    let api
    function Grab() { api = useToast(); return null }
    render(
      <ToastProvider bar="0px">
        <Grab />
        <Pusher opts={{ tone: 'warning', title: 'Only OK', name: 'Only OK', duration: 0, dismissible: false, action: <button type="button">OK</button> }} />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByText('push'))
    const t = screen.getByRole('alert', { name: 'Only OK' })
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
    expect(t.querySelectorAll('button').length).toBe(1)
    expect(screen.getByRole('button', { name: 'OK' })).toBeTruthy()
    // The owner takes it down by id, as before.
    act(() => { api.dismiss(Number(t.dataset.toastId)) })
    expect(screen.queryByRole('alert', { name: 'Only OK' })).toBeNull()
    cleanup()
    // The control: the default keeps the ×.
    render(
      <ToastProvider bar="0px">
        <Pusher opts={{ tone: 'warning', title: 'Default', duration: 0 }} />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByText('push'))
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy()
  })

  it('useToast outside a provider is a stack trace, not a silent no-op', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Pusher opts={{}} />)).toThrow(/ToastProvider/)
    err.mockRestore()
  })

  // The Track A merge, review round 2 (A-R2-02): R.A.B.B.I.T.'s UndoToast was
  // a second fixed surface at the stack's own anchor, and a sticky pet notice
  // painted over its Undo button. `pinned` puts the owner's row INTO the
  // column, last.
  it('`pinned`: a row the stack holds LAST, below everything push() adds, in a wrapper that takes pointer events back', () => {
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8')
    const onUndo = vi.fn()
    render(
      <ToastProvider bar="0px" pinned={<button type="button" onClick={onUndo}>Undo</button>}>
        <Pusher opts={{ tone: 'info', title: 'Note', duration: 0 }} />
      </ToastProvider>,
    )
    const stack = document.querySelector('.ui-toast-stack')
    const pinned = stack.querySelector('.ui-toast-pinned')
    expect(pinned.textContent).toBe('Undo')
    expect(stack.lastElementChild).toBe(pinned)
    fireEvent.click(screen.getByText('push'))
    fireEvent.click(screen.getByText('push'))
    expect(stack.querySelectorAll('.ui-toast').length).toBe(2)
    // Newest at the bottom still holds among the pushed toasts; the pinned
    // row stays below them all, so nothing pushed can land on it.
    expect(stack.lastElementChild).toBe(pinned)
    expect([...stack.children].indexOf(pinned)).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledTimes(1)
    // The stack is click-through and each toast re-enables itself; the
    // wrapper does the same for its row, and leaves the column while empty so
    // the gap is not paid for a row that is not showing.
    const rule = (sel) => css.slice(css.indexOf(`${sel} {`), css.indexOf('}', css.indexOf(`${sel} {`)))
    expect(rule('.ui-toast-stack')).toMatch(/pointer-events:\s*none/)
    expect(rule('.ui-toast-pinned')).toMatch(/pointer-events:\s*auto/)
    expect(rule('.ui-toast-pinned:empty')).toMatch(/display:\s*none/)
    // Not passed: nothing is rendered for it.
    cleanup()
    render(<ToastProvider bar="0px">x</ToastProvider>)
    expect(document.querySelector('.ui-toast-pinned')).toBeNull()
  })
})

// ── FX14 (OUTSTANDING FX13-02): keyboard focus holds a toast as the pointer
// does, and a toast that leaves holding focus gives it back. FX13's review
// round 2 measured the fault in Chromium: a 5-second toast, Tab to its ×,
// and when the time ran out focus fell to <body>. ──────────────────────────
describe('a toast and keyboard focus (FX14)', () => {
  let api
  function Grab() { api = useToast(); return null }
  const toastEl = () => document.querySelector('.ui-toast-stack .ui-toast')
  const xOf = () => within(toastEl()).getByRole('button', { name: 'Dismiss' })
  function setup(opts = {}, { main = false } = {}) {
    const origin = <button type="button">origin</button>
    render(
      <ToastProvider bar="0px">
        {main ? <main>{origin}</main> : origin}
        <Grab />
      </ToastProvider>,
    )
    let id
    act(() => { id = api.push({ tone: 'info', title: 'Saved', duration: 1000, ...opts }) })
    return { origin: screen.getByRole('button', { name: 'origin' }), id }
  }
  /** A button outside React that can be taken away: the element focus came from, gone. */
  function outsider() {
    const b = document.createElement('button')
    b.textContent = 'outsider'
    document.body.append(b)
    return b
  }

  it('focus inside holds it past its time, as hover does; focus going outside lets it run out the rest', () => {
    vi.useFakeTimers()
    const { origin } = setup()
    act(() => { origin.focus() })
    act(() => { xOf().focus() })
    act(() => { vi.advanceTimersByTime(3000) })
    expect(toastEl()).not.toBeNull()
    act(() => { origin.focus() })
    act(() => { vi.advanceTimersByTime(990) })
    expect(toastEl()).not.toBeNull()
    act(() => { vi.advanceTimersByTime(20) })
    expect(toastEl()).toBeNull()
  })

  it('CONTROL: focus elsewhere does not hold it, and its leaving moves no focus', () => {
    vi.useFakeTimers()
    const { origin } = setup()
    act(() => { origin.focus() })
    act(() => { vi.advanceTimersByTime(1010) })
    expect(toastEl()).toBeNull()
    expect(document.activeElement).toBe(origin)
  })

  it('the pointer and focus together: it runs again only once both have gone', () => {
    vi.useFakeTimers()
    const { origin } = setup()
    fireEvent.mouseEnter(toastEl())
    act(() => { xOf().focus() })
    fireEvent.mouseLeave(toastEl())
    act(() => { vi.advanceTimersByTime(3000) })
    expect(toastEl()).not.toBeNull()                    // focus still holds it
    fireEvent.mouseEnter(toastEl())
    act(() => { origin.focus() })
    act(() => { vi.advanceTimersByTime(3000) })
    expect(toastEl()).not.toBeNull()                    // the pointer still holds it
    fireEvent.mouseLeave(toastEl())
    act(() => { vi.advanceTimersByTime(1010) })
    expect(toastEl()).toBeNull()
  })

  it('moving between its own controls keeps it held, and keeps where focus came from', () => {
    vi.useFakeTimers()
    const { origin } = setup({ action: <button type="button">Undo</button> })
    act(() => { origin.focus() })
    act(() => { within(toastEl()).getByRole('button', { name: 'Undo' }).focus() })
    act(() => { xOf().focus() })
    act(() => { vi.advanceTimersByTime(3000) })
    expect(toastEl()).not.toBeNull()
    fireEvent.click(xOf())
    expect(toastEl()).toBeNull()
    expect(document.activeElement).toBe(origin)
  })

  it('Dismiss from the keyboard gives focus back to the element it came from', () => {
    const { origin } = setup()
    act(() => { origin.focus() })
    act(() => { xOf().focus() })
    fireEvent.click(xOf())
    expect(toastEl()).toBeNull()
    expect(document.activeElement).toBe(origin)
  })

  it('its owner taking it down gives focus back too, and so does a sticky toast (duration 0), which has no timer to hold', () => {
    vi.useFakeTimers()
    const { origin, id } = setup({ duration: 0 })
    act(() => { origin.focus() })
    act(() => { xOf().focus() })
    act(() => { vi.advanceTimersByTime(10000) })
    expect(toastEl()).not.toBeNull()
    act(() => { api.dismiss(id) })
    expect(toastEl()).toBeNull()
    expect(document.activeElement).toBe(origin)
  })

  it('focus leaving for nowhere and coming back keeps the element it first came from', () => {
    const { origin } = setup()
    act(() => { origin.focus() })
    act(() => { xOf().focus() })
    act(() => { xOf().blur() })                        // the window left: focus to nowhere
    act(() => { xOf().focus() })                       // and back, from nowhere
    fireEvent.click(xOf())
    expect(document.activeElement).toBe(origin)
  })

  it('the element it came from gone: focus goes to the main region on screen, focusable for that one move', () => {
    const { origin } = setup({}, { main: true })
    const away = outsider()
    act(() => { away.focus() })
    act(() => { xOf().focus() })
    away.remove()
    fireEvent.click(xOf())
    const main = document.querySelector('main')
    expect(document.activeElement).toBe(main)
    expect(main.getAttribute('tabindex')).toBe('-1')
    act(() => { origin.focus() })                       // it leaves: main is not a stop any more
    expect(main.hasAttribute('tabindex')).toBe(false)
  })

  it('…and so does one that is disabled or hidden now', () => {
    for (const make of [(b) => { b.disabled = true }, (b) => { b.checkVisibility = () => false }]) {
      const { origin } = setup({}, { main: true })
      act(() => { origin.focus() })
      act(() => { xOf().focus() })
      make(origin)
      fireEvent.click(xOf())
      expect(document.activeElement).toBe(document.querySelector('main'))
      cleanup()
    }
  })

  it('nothing to give it back to (no element, no main region): dev says so, and the browser has it on <body>', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setup()
    const away = outsider()
    act(() => { away.focus() })
    act(() => { xOf().focus() })
    away.remove()
    fireEvent.click(xOf())
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('nothing to give focus back to'))
    expect(document.activeElement).toBe(document.body)
    warn.mockRestore()
  })

  it('focus that came from nowhere (a pointer on the × with nothing focused) goes back there: no move, no word', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setup({}, { main: true })
    act(() => { document.activeElement.blur() })
    act(() => { xOf().focus() })
    fireEvent.click(xOf())
    expect(document.activeElement).toBe(document.body)
    expect(document.querySelector('main').hasAttribute('tabindex')).toBe(false)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('toastFocusReturn: the element first, then a main region on screen, then nothing; and nowhere for nowhere', () => {
    document.body.innerHTML = '<main id="m"><button id="b">b</button></main><div role="main" id="r" aria-hidden="true"></div><button id="gone">g</button>'
    const b = document.getElementById('b'); const m = document.getElementById('m'); const gone = document.getElementById('gone')
    gone.remove()
    expect(toastFocusReturn(b)).toBe(b)
    expect(toastFocusReturn(gone)).toBe(m)
    expect(toastFocusReturn(null)).toBe(null)
    expect(toastFocusReturn(document.body)).toBe(null)
    m.checkVisibility = () => false                      // a hidden page's main
    expect(toastFocusReturn(gone)).toBe(null)            // the aria-hidden one is not a place either
    document.body.innerHTML = ''
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

  it('the shell passes it, from the same PAGE_BARS the pet reads — and pins R.A.B.B.I.T.’s UndoToast as the stack’s bottom row', () => {
    const app = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../App.jsx'), 'utf8')
    expect(app).toContain('<ToastProvider bar={pageBars.bottom} pinned={<UndoToast />}>')
    expect(app).toContain('const pageBars = PAGE_BARS[currentPage] || PAGE_BARS.home')
    // …and mounts it nowhere else: one instance, in the stack (A-R2-02).
    expect(app.match(/<UndoToast \/>/g)).toHaveLength(1)
  })
})
