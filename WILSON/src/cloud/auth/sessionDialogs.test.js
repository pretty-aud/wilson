/** @vitest-environment jsdom */
// =============================================================================
// sessionDialogs.test.js — Track B bundle B2, part 2. The two notices and the
// banner: each phase shows the copy the walkthrough names, the countdown
// reads mm:ss, the idle dialog offers "Stay signed in" and the cap notice
// does not (activity cannot extend a cap), and the banner is absent until
// the watchdog says otherwise.
//
// jsdom since the post-overhaul merge's review round 1 (B-R1-02/-03/-06):
// on /wilson the cap notice is pushed onto the app's toast stack from an
// effect, and effects do not run under renderToString — so that path mounts
// for real, inside a ToastProvider, and the idle dialog's layer is read off
// a live node. The string renders stay for everything that renders on the
// first pass. No JSX here: this is a .js file, and the config only compiles
// JSX in .jsx (createElement is `h`).
//
// Round 2 (B-R2-01, -04, -07): the cap notice's countdown is aria-hidden
// under the alert (a role="alert" is assertive and atomic by definition, so
// a visible tick was re-read every second), the stack path offers only OK,
// and the layers are classes the sheet owns — read out of index.css here,
// never restated.
// =============================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import SessionWarning, { describeSessionExpiry } from './SessionWarning'
import ConnectionLostBanner, { CONNECTION_LOST_COPY } from '../ConnectionLostBanner'
import { createConnectionWatchdog } from '../connectionWatchdog'
import { ToastProvider } from '../../ui'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const renderStr = (type, props) => renderToString(h(type, props))
const inStack = (props) => h(ToastProvider, { bar: '80px' }, h(SessionWarning, props))

afterEach(cleanup)

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../../index.css'), 'utf8')
const app = readFileSync(resolve(here, '../../App.jsx'), 'utf8')
// A rule's body, by selector (the Toast.test.jsx idiom), and its z-index —
// read out of the sheet so the scale is stated in one place.
const rule = (sel) => {
  const at = css.indexOf(`${sel} {`)
  if (at < 0) throw new Error(`no rule for ${sel} in index.css`)
  return css.slice(at, css.indexOf('}', at))
}
const layerOf = (sel) => Number(/z-index:\s*(\d+)/.exec(rule(sel))?.[1])
// The text an assistive technology gets: aria-hidden subtrees dropped,
// whitespace collapsed.
const accessibleText = (el) => {
  const clone = el.cloneNode(true)
  for (const hidden of clone.querySelectorAll('[aria-hidden="true"]')) hidden.remove()
  return clone.textContent.replace(/\s+/g, ' ').trim()
}
// B-R2-01's checker: the mm:ss span under an alert must sit inside an
// aria-hidden subtree. Used by both placements, and by its own control.
const countdownIsHidden = (alertEl) => {
  const tick = [...alertEl.querySelectorAll('span')].find((s) => /^\d+:\d\d$/.test(s.textContent))
  return !!tick && tick.closest('[aria-hidden="true"]') !== null
}

describe('SessionWarning', () => {
  it('renders nothing while the session is active, inactive or already expired', () => {
    for (const phase of ['active', 'inactive', 'expired']) {
      expect(renderStr(SessionWarning, { phase, deadline: Date.now() + 60_000, onStay: () => {} })).toBe('')
    }
  })

  it('the idle warning names the countdown and offers to stay signed in', () => {
    const html = renderStr(SessionWarning, { phase: 'idle-warning', deadline: Date.now() + 4 * 60_000 + 59_000, onStay: () => {} })
    expect(html).toContain('Still there?')
    // React's SSR puts <!-- --> between text and an expression; allow it.
    expect(html).toMatch(/signed out in (<!-- -->)?<span[^>]*>4:59<\/span>(<!-- -->)? for inactivity/)
    expect(html).toContain('Stay signed in')
    // The kit's one Dialog as an ALERTDIALOG (B-R1-06): the role plus the
    // focus move announce it, the sentence is its description, read once.
    // Nothing is live — a live region whose countdown re-rendered every
    // second would interrupt every second — so the ticking never re-announces.
    expect(html).toContain('role="alertdialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).not.toContain('aria-live')
    const desc = html.match(/aria-describedby="([^"]+)"/)
    expect(desc).not.toBeNull()
    expect(html).toContain(`id="${desc[1]}"`)
  })

  it('the idle warning sits in a layer above both surfaces’ own modals (B-R1-02) — a class the sheet owns, not an inline z (B-R2-07)', () => {
    render(h(SessionWarning, { phase: 'idle-warning', deadline: Date.now() + 60_000, onStay: () => {} }))
    const dialog = screen.getByRole('alertdialog', { name: 'Still there?' })
    const layer = dialog.closest('.session-layer')
    expect(layer).not.toBeNull()
    expect(layer.contains(dialog.closest('.ui-dialog-backdrop'))).toBe(true)
    // The layer is CSS: no inline style object on the wrapper, so the z scale
    // lives in one place (index.css), which is read below, not restated.
    expect(layer.getAttribute('style')).toBeNull()
    // A `position: relative` div with a z-index is a stacking context, so the
    // kit backdrop inside it paints at the LAYER's index against the page:
    // above the operator console's own modals (CompaniesSection.jsx, inline)
    // and App's quit dialog (App.jsx, inline), under the banner. The corner
    // card shares the layer.
    expect(rule('.session-layer')).toMatch(/position:\s*relative/)
    const consoleModals = [...readFileSync(resolve(here, '../../admin/CompaniesSection.jsx'), 'utf8').matchAll(/zIndex: (\d+)/g)].map((m) => Number(m[1]))
    expect(consoleModals.length).toBeGreaterThan(0)
    // Post-overhaul S3c review round 2 (R2-05): the quit dialog's backdrop
    // carries the mark the pages' undo keys count it by, after a comment
    // saying so; its layer is read the same.
    const QUIT = /showCloseDialog && \((?:\s*\/\/[^\n]*)*\s*<div data-app-question="close" style=\{\{\s*position: 'fixed', inset: 0, zIndex: (\d+),/
    const quit = Number(QUIT.exec(app)?.[1])
    expect(quit).toBe(200)
    // CONTROL: the reading finds nothing when the backdrop's layer moves out of it.
    expect(Number(QUIT.exec(app.replace("position: 'fixed', inset: 0, zIndex: 200,", "position: 'fixed', inset: 0,"))?.[1])).toBeNaN()
    expect(layerOf('.session-layer')).toBeGreaterThan(layerOf('.ui-dialog-backdrop'))
    expect(layerOf('.session-layer')).toBeGreaterThan(Math.max(...consoleModals))
    expect(layerOf('.session-layer')).toBeGreaterThan(quit)
    expect(layerOf('.session-layer')).toBeLessThan(layerOf('.connection-banner'))
    expect(layerOf('.session-corner')).toBe(layerOf('.session-layer'))
    // The description is the body sentence, by id.
    expect(dialog.getAttribute('aria-describedby')).toBe(dialog.querySelector('.ui-dialog-body > div').id)
    expect(dialog.textContent).toMatch(/signed out in \d:\d\d for inactivity/)
  })

  it('the cap notice says sessions end after 4 hours and offers only OK (the corner card, on the operator console)', () => {
    const html = renderStr(SessionWarning, { phase: 'cap-warning', deadline: Date.now() + 2 * 60_000, onStay: () => {}, placement: 'corner' })
    expect(html).toContain('Session ending')
    expect(html).toMatch(/Sessions end after (<!-- -->)?4(<!-- -->)? hours/)
    // The ticking value, aria-hidden, then the still phrase for screen
    // readers only (B-R2-01): a role="alert" is read on insertion and re-read
    // on every change, so the tick must not be a change it can see.
    expect(html).toMatch(/<span aria-hidden="true"><span[^>]*>2:00<\/span><\/span><span class="sr-only"> under five minutes<\/span>/)
    expect(html).not.toContain('Stay signed in')
    expect(html).toContain('>OK<')
    // …and only OK: no × (the presentational Toast gets no onDismiss).
    expect(html).not.toContain('aria-label="Dismiss"')
    // Non-modal: role="alert" (the kit's warning tone) named for the spec.
    expect(html).toContain('role="alert"')
    expect(html).toContain('aria-label="Session ending"')
    expect(html).not.toContain('role="alertdialog"')
    // The frame is the sheet's `.session-corner` — fixed, click-through, the
    // card itself taking pointer events back — with no inline layer (B-R2-07).
    expect(html).toContain('class="session-corner"')
    expect(html).not.toMatch(/<div style="[^"]*(z-index|position)/)
    expect(rule('.session-corner')).toMatch(/position:\s*fixed/)
    expect(rule('.session-corner')).toMatch(/pointer-events:\s*none/)
    expect(rule('.ui-toast')).toMatch(/pointer-events:\s*auto/)
  })

  it('on /wilson the cap notice rides the app’s one toast stack, above the page’s bar, named for getByRole (B-R1-03)', () => {
    const deadline = Date.now() + 2 * 60_000
    const cap = (props) => inStack({ phase: 'cap-warning', deadline, onStay: () => {}, ...props })
    const { rerender, unmount } = render(cap())
    const stack = document.querySelector('.ui-toast-stack')
    // The provider's anchor — 24px above THIS page's bar — is the notice's.
    expect(stack.style.getPropertyValue('--toast-bar')).toBe('80px')
    const toast = screen.getByRole('alert', { name: 'Session ending' })
    expect(stack.contains(toast)).toBe(true)
    expect(toast.dataset.tone).toBe('warning')
    // What a sighted person reads (textContent keeps the hidden phrase too),
    // and what a screen reader gets: the still phrase, never the tick
    // (B-R2-01 — the toast is role="alert", assertive and atomic by that
    // role's definition, so a visible tick was re-read every second).
    expect(toast.textContent).toMatch(/Sessions end after 4 hours\. You’ll be signed out in \d:\d\d under five minutes — save your work\./)
    expect(countdownIsHidden(toast)).toBe(true)
    expect(accessibleText(toast)).toMatch(/Sessions end after 4 hours\. You’ll be signed out in under five minutes — save your work\./)
    // Only OK, here as on the console (B-R2-04): the stack's × is off for
    // this notice, and nothing offers to stay — a cap cannot be extended.
    expect(toast.querySelectorAll('button').length).toBe(1)
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
    expect(toast.textContent).not.toContain('Stay signed in')
    // ONE anchor: the corner card is the console's only, so no second fixed
    // surface exists here (A-R2-02's rule, the one this finding enforces).
    expect(document.querySelector('.session-corner')).toBeNull()
    expect(document.querySelectorAll('.ui-toast').length).toBe(1)
    // OK dismisses it for THIS deadline, and a re-render does not bring it
    // back; a new deadline (a new session's cap) is a new notice; leaving the
    // phase takes it down.
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(screen.queryByRole('alert', { name: 'Session ending' })).toBeNull()
    rerender(cap())
    expect(screen.queryByRole('alert', { name: 'Session ending' })).toBeNull()
    rerender(cap({ deadline: deadline + 5_000 }))
    expect(screen.getByRole('alert', { name: 'Session ending' })).toBeTruthy()
    rerender(cap({ phase: 'expired', deadline: null }))
    expect(screen.queryByRole('alert', { name: 'Session ending' })).toBeNull()
    expect(document.querySelectorAll('.ui-toast').length).toBe(0)
    unmount()
  })

  it('the control: the hidden-countdown checker fails on the markup round 1 shipped', () => {
    // Round 1's cap notice — the tick as a bare span inside the alert — is
    // what B-R2-01 found, and the checker must say no to it.
    const before = render(h('div', { role: 'alert' }, 'signed out in ', h('span', null, '2:00'), ' — save your work.'))
    expect(countdownIsHidden(before.container.firstChild)).toBe(false)
    cleanup()
    // …and yes only when the tick sits under aria-hidden, with the still
    // phrase as the only thing a screen reader hears in its place.
    const after = render(h('div', { role: 'alert' }, 'signed out in ',
      h('span', { 'aria-hidden': 'true' }, h('span', null, '2:00')),
      h('span', { className: 'sr-only' }, ' under five minutes'),
      ' — save your work.'))
    expect(countdownIsHidden(after.container.firstChild)).toBe(true)
    expect(accessibleText(after.container.firstChild)).toBe('signed out in under five minutes — save your work.')
  })

  it('a capHours override changes the copy in one place', () => {
    const html = renderStr(SessionWarning, { phase: 'cap-warning', deadline: Date.now() + 1000, onStay: () => {}, capHours: 8, placement: 'corner' })
    expect(html).toMatch(/Sessions end after (<!-- -->)?8(<!-- -->)? hours/)
  })

  it('the post-sign-out notices are the walkthrough’s exact lines, in sentence case', () => {
    // Sentence case since the post-overhaul merge (AUTH-11: every message on
    // the login screen is); the words are walkthrough 11's.
    expect(describeSessionExpiry('idle_timeout')).toBe('Signed out after 30 minutes without activity.')
    expect(describeSessionExpiry('session_cap')).toBe('Signed out: sessions end after 4 hours. Sign in again to continue.')
    expect(describeSessionExpiry('sign_out')).toBe('')
  })
})

describe('ConnectionLostBanner', () => {
  it('renders nothing until the watchdog reports a loss, then the sentence and Reload', () => {
    const wd = createConnectionWatchdog({ windowRef: null })
    expect(renderStr(ConnectionLostBanner, { watchdog: wd })).toBe('')

    let t = 0
    const lost = createConnectionWatchdog({
      budgetMs: 100, tickMs: 10, now: () => t, isOnline: () => true, windowRef: null,
      schedule: () => 1, unschedule: () => {},
    })
    const fetch = lost.wrapFetch(() => new Promise(() => {}))
    fetch('https://x.supabase.co/rest/v1/projects', { method: 'GET' })
    t = 200
    lost.evaluate()
    expect(lost.getSnapshot()).toBe(true)
    const html = renderStr(ConnectionLostBanner, { watchdog: lost })
    expect(html).toContain(CONNECTION_LOST_COPY)
    expect(html).toContain('Reload')
    expect(html).toContain('role="alert"')
    // The strip's frame is the sheet's `.connection-banner` (B-R2-07): the
    // wrapper carries the class and nothing else — no inline `top`, no
    // inline z — and the rule clears the Electron title bar through the
    // kit's own token, above the session layer and the toast stack.
    expect(html).toMatch(/^<div class="connection-banner"><[a-z]/)
    expect(rule('.connection-banner')).toMatch(/position:\s*fixed/)
    expect(rule('.connection-banner')).toMatch(/top:\s*var\(--titlebar-offset\)/)
    expect(layerOf('.connection-banner')).toBeGreaterThan(layerOf('.session-layer'))
    expect(layerOf('.connection-banner')).toBeGreaterThan(layerOf('.ui-toast-stack'))
  })
})
