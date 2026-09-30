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
// =============================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import SessionWarning, { describeSessionExpiry } from './SessionWarning'
import ConnectionLostBanner, { CONNECTION_LOST_COPY } from '../ConnectionLostBanner'
import { createConnectionWatchdog } from '../connectionWatchdog'
import { ToastProvider } from '../../ui'

const renderStr = (type, props) => renderToString(h(type, props))
const inStack = (props) => h(ToastProvider, { bar: '80px' }, h(SessionWarning, props))

afterEach(cleanup)

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

  it('the idle warning sits in a layer above both surfaces’ own modals (B-R1-02)', () => {
    render(h(SessionWarning, { phase: 'idle-warning', deadline: Date.now() + 60_000, onStay: () => {} }))
    const dialog = screen.getByRole('alertdialog', { name: 'Still there?' })
    const layer = dialog.closest('[data-session-layer="idle"]')
    expect(layer).not.toBeNull()
    // A `position: relative` div with a z-index is a stacking context, so the
    // kit backdrop inside it (z 70 in index.css) paints at the LAYER's index
    // against the page. The operator console's CredentialsDialog is 90 and
    // App's quit dialog 200; the banner above them all is 300.
    expect(layer.style.position).toBe('relative')
    expect(Number(layer.style.zIndex)).toBeGreaterThan(200)
    expect(Number(layer.style.zIndex)).toBeLessThan(300)
    expect(layer.contains(dialog.closest('.ui-dialog-backdrop'))).toBe(true)
    // The description is the body sentence, by id.
    expect(dialog.getAttribute('aria-describedby')).toBe(dialog.querySelector('.ui-dialog-body > div').id)
    expect(dialog.textContent).toMatch(/signed out in \d:\d\d for inactivity/)
  })

  it('the cap notice says sessions end after 4 hours and offers only OK (the corner card, on the operator console)', () => {
    const html = renderStr(SessionWarning, { phase: 'cap-warning', deadline: Date.now() + 2 * 60_000, onStay: () => {}, placement: 'corner' })
    expect(html).toContain('Session ending')
    expect(html).toMatch(/Sessions end after (<!-- -->)?4(<!-- -->)? hours/)
    expect(html).toMatch(/signed out in (<!-- -->)?<span[^>]*>2:00<\/span>/)
    expect(html).not.toContain('Stay signed in')
    expect(html).toContain('>OK<')
    // Non-modal: role="alert" (the kit's warning tone) named for the spec.
    expect(html).toContain('role="alert"')
    expect(html).toContain('aria-label="Session ending"')
    expect(html).not.toContain('role="alertdialog"')
    expect(html).toContain('data-session-notice="corner"')
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
    expect(toast.textContent).toMatch(/Sessions end after 4 hours\. You’ll be signed out in \d:\d\d — save your work\./)
    // ONE anchor: the corner card is the console's only, so no second fixed
    // surface exists here (A-R2-02's rule, the one this finding enforces).
    expect(document.querySelector('[data-session-notice="corner"]')).toBeNull()
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
  })
})
