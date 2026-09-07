// =============================================================================
// sessionDialogs.test.js — Track B bundle B2, part 2. The two dialogs and the
// banner rendered to a string: each phase shows the copy the walkthrough
// names, the countdown reads mm:ss, the idle dialog offers "Stay signed in"
// and the cap dialog does not (activity cannot extend a cap), and the banner
// is absent until the watchdog says otherwise.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import SessionWarning, { describeSessionExpiry } from './SessionWarning'
import ConnectionLostBanner, { CONNECTION_LOST_COPY } from '../ConnectionLostBanner'
import { createConnectionWatchdog } from '../connectionWatchdog'

const render = (type, props) => renderToString(createElement(type, props))

describe('SessionWarning', () => {
  it('renders nothing while the session is active, inactive or already expired', () => {
    for (const phase of ['active', 'inactive', 'expired']) {
      expect(render(SessionWarning, { phase, deadline: Date.now() + 60_000, onStay: () => {} })).toBe('')
    }
  })

  it('the idle warning names the countdown and offers to stay signed in', () => {
    const html = render(SessionWarning, { phase: 'idle-warning', deadline: Date.now() + 4 * 60_000 + 59_000, onStay: () => {} })
    expect(html).toContain('Still there?')
    // React's SSR puts <!-- --> between text and an expression; allow it.
    expect(html).toMatch(/signed out in (<!-- -->)?<span[^>]*>4:59<\/span>(<!-- -->)? for inactivity/)
    expect(html).toContain('Stay signed in')
    expect(html).toContain('role="alertdialog"')
  })

  it('the cap warning says sessions end after 4 hours and offers only OK', () => {
    const html = render(SessionWarning, { phase: 'cap-warning', deadline: Date.now() + 2 * 60_000, onStay: () => {} })
    expect(html).toContain('Session ending')
    expect(html).toMatch(/Sessions end after (<!-- -->)?4(<!-- -->)? hours/)
    expect(html).toMatch(/signed out in (<!-- -->)?<span[^>]*>2:00<\/span>/)
    expect(html).not.toContain('Stay signed in')
    expect(html).toContain('>OK<')
  })

  it('a capHours override changes the copy in one place', () => {
    const html = render(SessionWarning, { phase: 'cap-warning', deadline: Date.now() + 1000, onStay: () => {}, capHours: 8 })
    expect(html).toMatch(/Sessions end after (<!-- -->)?8(<!-- -->)? hours/)
  })

  it('the post-sign-out notices are the walkthrough’s exact lines', () => {
    expect(describeSessionExpiry('idle_timeout')).toBe('SIGNED OUT AFTER 30 MINUTES WITHOUT ACTIVITY.')
    expect(describeSessionExpiry('session_cap')).toBe('SIGNED OUT: SESSIONS END AFTER 4 HOURS. SIGN IN AGAIN TO CONTINUE.')
    expect(describeSessionExpiry('sign_out')).toBe('')
  })
})

describe('ConnectionLostBanner', () => {
  it('renders nothing until the watchdog reports a loss, then the sentence and Reload', () => {
    const wd = createConnectionWatchdog({ windowRef: null })
    expect(render(ConnectionLostBanner, { watchdog: wd })).toBe('')

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
    const html = render(ConnectionLostBanner, { watchdog: lost })
    expect(html).toContain(CONNECTION_LOST_COPY)
    expect(html).toContain('Reload')
    expect(html).toContain('role="alert"')
  })
})
