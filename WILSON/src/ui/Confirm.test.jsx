/** @vitest-environment jsdom */
// Confirm (post-overhaul F10, rabbit A6): the one confirm-width question. Each
// view's own question is pinned in its view by
// tools/rabbit_v0.1.0/views/kitInViews.test.jsx.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { Confirm } from './Confirm'
import { _resetOverlaysForTests } from './overlay'

afterEach(() => { cleanup(); _resetOverlaysForTests() })

const dialog = () => screen.getByRole('dialog')
const button = (name) => screen.getByRole('button', { name })

describe('Confirm', () => {
  it('the kit Dialog at the confirm width in <body>, Cancel first and focused, the verb second in its variant', () => {
    const host = document.createElement('section')
    document.body.appendChild(host)
    render(<Confirm title="Delete scene?" onConfirm={() => {}} onCancel={() => {}}>Gone for good.</Confirm>, { container: host })
    expect(dialog().getAttribute('data-width')).toBe('confirm')
    expect(host.contains(dialog())).toBe(false)
    expect(dialog().closest('.ui-dialog-backdrop').parentElement).toBe(document.body)
    const foot = [...dialog().querySelectorAll('.ui-dialog-foot .ui-btn')].map((b) => [b.textContent, b.dataset.variant || null])
    expect(foot[0][0]).toBe('Cancel')
    expect(foot[1]).toEqual(['Delete', 'danger'])
    expect(document.activeElement).toBe(button('Cancel'))
    host.remove()
  })

  it('`portal={false}` draws it where it is rendered; a primary verb in the primary variant', () => {
    const { container } = render(<Confirm portal={false} title="Set active?" confirmLabel="Set active" variant="primary" onConfirm={() => {}} onCancel={() => {}} />)
    expect(container.contains(dialog())).toBe(true)
    expect(button('Set active').dataset.variant).toBe('primary')
  })

  it('Cancel, the ✕ and Escape answer no; the backdrop only when asked', () => {
    for (const how of ['cancel', 'close', 'escape', 'backdrop', 'backdrop-allowed']) {
      const onCancel = vi.fn()
      const onConfirm = vi.fn()
      render(<Confirm title="Delete?" dismissOnBackdrop={how === 'backdrop-allowed'} onConfirm={onConfirm} onCancel={onCancel} />)
      if (how === 'cancel') fireEvent.click(button('Cancel'))
      if (how === 'close') fireEvent.click(button('Close'))
      if (how === 'escape') fireEvent.keyDown(document.activeElement, { key: 'Escape' })
      if (how.startsWith('backdrop')) fireEvent.mouseDown(dialog().closest('.ui-dialog-backdrop'))
      expect(onCancel, how).toHaveBeenCalledTimes(how === 'backdrop' ? 0 : 1)
      expect(onConfirm, how).not.toHaveBeenCalled()
      cleanup(); _resetOverlaysForTests()
    }
  })

  it('a plain answer is a plain call: never busy', () => {
    const onConfirm = vi.fn()
    render(<Confirm title="Delete?" onConfirm={onConfirm} onCancel={() => {}} />)
    fireEvent.click(button('Delete'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(dialog().getAttribute('aria-busy')).toBeNull()
    expect(button('Cancel').disabled).toBe(false)
  })

  it('a promise: busy while it runs (Escape stands down), and a refusal stays open with its words in the error slot', async () => {
    let fail
    const onCancel = vi.fn()
    render(<Confirm title="Archive?" confirmLabel="Archive" onConfirm={() => new Promise((_, reject) => { fail = reject })} onCancel={onCancel} />)
    fireEvent.click(button('Archive'))
    expect(dialog().getAttribute('aria-busy')).toBe('true')
    expect(button('Cancel').disabled).toBe(true)
    fireEvent.keyDown(dialog(), { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
    await act(async () => { fail(new Error('This list is archived.')) })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('This list is archived.'))
    expect(dialog().getAttribute('aria-busy')).toBeNull()
    expect(button('Cancel').disabled).toBe(false)
  })

  it('focus goes back to `returnTo` when it fell to <body> on close (a window\'s Delete asked); otherwise it stays where the Dialog put it', () => {
    function Host({ withReturn }) {
      const [open, setOpen] = useState(true)
      const [opener, setOpener] = useState(null)
      return (
        <>
          <button type="button" ref={(n) => { if (n && !opener) setOpener(n) }}>Open Lighthouse</button>
          {open && opener && <Confirm title="Delete?" returnTo={withReturn ? opener : null} onConfirm={() => setOpen(false)} onCancel={() => setOpen(false)} />}
        </>
      )
    }
    render(<Host withReturn />)
    fireEvent.click(button('Cancel'))
    expect(document.activeElement).toBe(button('Open Lighthouse'))
    cleanup(); _resetOverlaysForTests()
    // CONTROL: without it, focus falls (the question opened with focus on <body>).
    render(<Host withReturn={false} />)
    fireEvent.click(button('Cancel'))
    expect(document.activeElement).toBe(document.body)
  })
})
