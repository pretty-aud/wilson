/** @vitest-environment jsdom */
// =============================================================================
// gapPremise.test.jsx — post-overhaul FX15, review rounds 1 and 2: the premise
// every "gap" CONTROL in the R.A.B.B.I.T. tests rests on (tasksViews,
// taskItemDrops, assetsViews, entityViews, scenesViews, tableViewsProvider).
//
// Those CONTROLs resolve a MutationObserver in the microtasks of the commit
// that draws the project, and find that commit's passive effects not yet run.
// FX14 put that down to the commit overrunning the Scheduler's 5 ms slice.
// Round 1 (R1-2) found the gap open after a commit of 0.3–1.3 ms and read the
// cause in the code: React asks the Scheduler for a paint in every commit
// (react-dom 19.2.4, `requestPaint()`), and Scheduler 0.27's
// `shouldYieldToHost` answers yes whenever a paint is asked for, so the passive
// flush (a scheduled callback) is a later task however short the commit was.
// Round 2 (R2-1) found the first premise test held the consequence only. This
// file holds the cause: the slice made a whole second long, so time can make
// nothing yield, the effect is still pending; with `requestPaint` a no-op (its
// CONTROL) it has run. A sync commit is the exception (`flushSync`: React
// flushes its effects at its end), a CONTROL too. The fixtures' project load
// is not a sync update.
//
// react-dom takes `Scheduler.unstable_requestPaint` when it loads, so the
// stub goes in first and react-dom, React and Testing Library are imported
// after it. Each test file runs in a fresh worker here (Vitest's isolation);
// the first test checks that the stub is the function react-dom calls.
// =============================================================================
import { describe, it, expect, afterEach } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Scheduler = require('scheduler')
const realRequestPaint = Scheduler.unstable_requestPaint
const paint = { noop: false, calls: 0 }
Scheduler.unstable_requestPaint = function requestPaint() {
  paint.calls++
  if (!paint.noop) realRequestPaint()
}
const React = await import('react')
const { flushSync } = await import('react-dom')
const { render, cleanup, act, waitFor } = await import('@testing-library/react')

afterEach(() => {
  cleanup()
  paint.noop = false
  Scheduler.unstable_forceFrameRate(0)   // back to the default 5 ms slice
})

// One element; its state set in a microtask after the mount, so outside act
// (Testing Library's render is an act; this update comes after it returns).
function Tiny({ log, sync = false }) {
  const [on, setOn] = React.useState(false)
  React.useEffect(() => {
    Promise.resolve().then(() => { if (sync) flushSync(() => setOn(true)); else setOn(true) })
  }, [sync])
  React.useEffect(() => { if (on) log.push('effect') }, [on, log])
  return <i data-tiny={String(on)} />
}
const drawn = () => new Promise((resolve) => {
  const mo = new MutationObserver(() => {
    if (document.querySelector('i[data-tiny="true"]')) { mo.disconnect(); resolve() }
  })
  mo.observe(document.body, { subtree: true, attributes: true, childList: true })
})

describe('the premise of the gap CONTROLs (FX15 review rounds 1 and 2)', () => {
  it('a one-element commit outside act leaves its effects for a later task, even with a one-second slice: the commit asked for a paint', async () => {
    Scheduler.unstable_forceFrameRate(1)                 // a 1000 ms slice: time makes nothing yield
    const log = []
    const committed = drawn()
    const before = paint.calls
    render(<Tiny log={log} />)
    await committed
    expect(paint.calls).toBeGreaterThan(before)         // the stub is what react-dom calls
    expect(log).toEqual([])                             // drawn; its effect not run yet
    await waitFor(() => expect(log).toEqual(['effect']))
  })
  it('CONTROL: with requestPaint a no-op, the same commit has run its effect when the commit is seen', async () => {
    Scheduler.unstable_forceFrameRate(1)
    paint.noop = true
    const log = []
    const committed = drawn()
    render(<Tiny log={log} />)
    await committed
    expect(log).toEqual(['effect'])
  })
  it('CONTROL: inside act, and committed by flushSync, the effect has run when the commit is seen', async () => {
    const log = []
    let set = null
    function Held() {
      const [on, setOn] = React.useState(false)
      set = setOn
      React.useEffect(() => { if (on) log.push('effect') }, [on])
      return <i data-held={String(on)} />
    }
    render(<Held />)
    await act(async () => { set(true) })
    expect(log).toEqual(['effect'])
    cleanup()
    const synced = []
    const committed = drawn()
    render(<Tiny log={synced} sync />)
    await committed
    expect(synced).toEqual(['effect'])
  })
})
