/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { StrictMode } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Dialog, DIALOG_WIDTHS } from './Dialog'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { overlayOpen, focusableWithin, _resetOverlaysForTests } from './overlay'

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8')

afterEach(cleanup)
beforeEach(() => _resetOverlaysForTests())

describe('Dialog', () => {
  it('renders header, body, footer and the four width tokens', () => {
    render(<Dialog title="Delete bin" subtitle="3 files inside" width="confirm" onClose={() => {}} footer={<button>OK</button>}>body</Dialog>)
    const d = screen.getByRole('dialog', { name: 'Delete bin' })
    expect(d.className).toContain('ui-dialog')
    expect(d.style.width).toBe(`${DIALOG_WIDTHS.confirm}px`)
    expect(d.dataset.width).toBe('confirm')
    expect(screen.getByText('3 files inside').className).toContain('ui-dialog-subtitle')
    expect(screen.getByText('body').className).toContain('ui-dialog-body')
    expect(screen.getByRole('button', { name: 'OK' })).toBeTruthy()
    expect(DIALOG_WIDTHS).toEqual({ confirm: 400, form: 560, reading: 720, workbench: 960 })
  })

  it('shows the error INSIDE the footer', () => {
    render(<Dialog title="Save" onClose={() => {}} error="Network is down">body</Dialog>)
    const alert = screen.getByRole('alert')
    expect(alert.closest('.ui-dialog-foot')).not.toBeNull()
    expect(alert.textContent).toContain('Network is down')
  })

  it('the footer error WRAPS, clamped, and keeps the whole message on its title (K5)', () => {
    // `white-space: nowrap` cut every failure the footer reported to about
    // six words and an ellipsis — the half that says what went wrong, not the
    // half that says what to do. Both auth dialogs worked around it with a
    // Banner in the body.
    const long = 'The workspace refused the change because your session expired; sign in again and retry.'
    render(<Dialog title="Save" onClose={() => {}} error={long}>body</Dialog>)
    const span = screen.getByRole('alert').querySelector('span')
    expect(span.getAttribute('title')).toBe(long)
    const rule = css.match(/\.ui-dialog-error > span \{[^}]*\}/)
    expect(rule, 'no .ui-dialog-error > span rule in index.css').not.toBeNull()
    expect(rule[0]).not.toContain('white-space: nowrap')
    expect(rule[0]).toContain('white-space: normal')
    // Clamped, so a stack trace cannot push the buttons off a 700px window.
    expect(rule[0]).toMatch(/line-clamp: 3/)
    // The icon stops centring itself against three lines of text.
    const wrap = css.match(/\.ui-dialog-error \{[^}]*\}/)
    expect(wrap[0]).toContain('align-items: flex-start')
  })

  it('Q17 (ruled): Escape closes and the X closes on every Dialog; the backdrop only when asked', () => {
    const onClose = vi.fn()
    render(<Dialog title="Plain" onClose={onClose}>body</Dialog>)
    expect(overlayOpen()).toBe(true)
    expect(screen.getByRole('dialog').dataset.surface).toBe('dark')   // the ring stays the signal on a light page
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    // "Nothing else": a stray click on the backdrop does not close by default…
    fireEvent.mouseDown(document.querySelector('.ui-dialog-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(2)
    cleanup()
    // …unless the caller asks (Bins' Modal does), and even then not from inside.
    const onClose2 = vi.fn()
    render(<Dialog title="Bins" onClose={onClose2} dismissOnBackdrop>body</Dialog>)
    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(onClose2).not.toHaveBeenCalled()
    fireEvent.mouseDown(document.querySelector('.ui-dialog-backdrop'))
    expect(onClose2).toHaveBeenCalledTimes(1)
  })

  it('the modal stack: only the topmost answers Escape, busy locks, the guard can refuse', () => {
    const closeA = vi.fn()
    const closeB = vi.fn()
    const guard = vi.fn(() => false)
    render(
      <>
        <Dialog title="A" onClose={closeA} onBeforeClose={guard}>a</Dialog>
        <Dialog title="B" onClose={closeB}>b</Dialog>
      </>,
    )
    expect(overlayOpen()).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closeB).toHaveBeenCalledTimes(1)
    expect(closeA).not.toHaveBeenCalled()
    // A's own X asks the guard, which refuses.
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0])
    expect(guard).toHaveBeenCalled()
    expect(closeA).not.toHaveBeenCalled()
    cleanup()
    expect(overlayOpen()).toBe(false)   // both unregistered on unmount
    const closeC = vi.fn()
    render(<Dialog title="C" onClose={closeC} busy>c</Dialog>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closeC).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Close' }).disabled).toBe(true)
  })

  it('a caller\'s extra props cannot clobber the role or the width (review round 1)', () => {
    render(<Dialog title="Styled" onClose={() => {}} role="region" style={{ opacity: 0.5 }} data-x="y">x</Dialog>)
    const d = screen.getByRole('dialog', { name: 'Styled' })
    expect(d.style.width).toBe(`${DIALOG_WIDTHS.form}px`)
    expect(d.style.opacity).toBe('0.5')
    expect(d.dataset.x).toBe('y')
    cleanup()
    // A numeric (legacy) width does not erase a caller's own data-width.
    render(<Dialog title="Legacy" onClose={() => {}} width={640} data-width="bins">x</Dialog>)
    expect(screen.getByRole('dialog', { name: 'Legacy' }).dataset.width).toBe('bins')
  })

  it('accepts a legacy numeric width for Bins, and reports an unknown named one', () => {
    render(<Dialog title="Legacy" width={640} onClose={() => {}}>x</Dialog>)
    expect(screen.getByRole('dialog', { name: 'Legacy' }).style.width).toBe('640px')
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<Dialog title="Odd" width="huge" onClose={() => {}}>x</Dialog>)
    expect(err).toHaveBeenCalledWith(expect.stringContaining('unknown width'))
    err.mockRestore()
  })

  // ── Focus management (F3, C2 KR-5) ────────────────────────────────────────
  //
  // `role="dialog" aria-modal="true"` was already being announced here and
  // none of the three things it promises was true. W9 sends this component to
  // twenty-seven `window.confirm` sites; `window.confirm` takes focus, holds
  // it and gives it back, so each conversion was a keyboard regression until
  // these tests passed.

  it('takes focus on open — the first focusable thing inside it', () => {
    render(
      <Dialog title="Rename" onClose={() => {}} footer={<button>Save</button>}>
        <input aria-label="Name" />
      </Dialog>,
    )
    // The header's Close button is the first focusable element in the DOM.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
  })

  it('leaves an autoFocus child alone — React has already focused it', () => {
    render(
      <Dialog title="Rename" onClose={() => {}}>
        <input aria-label="Name" autoFocus />
      </Dialog>,
    )
    expect(document.activeElement).toBe(screen.getByLabelText('Name'))
  })

  it('focuses the surface itself when the dialog holds nothing focusable', () => {
    // A BUSY dialog is the real case: the busy lock disables Close, so there
    // is genuinely nothing inside to focus. The first cut of this test
    // hand-built a div and proved only that `.focus()` works on a tabindex
    // of -1, which was never in doubt.
    render(<Dialog title="Saving" onClose={() => {}} busy>just a message</Dialog>)
    const d = screen.getByRole('dialog')
    expect(d.getAttribute('tabindex')).toBe('-1')
    expect(screen.getByRole('button', { name: 'Close' }).disabled).toBe(true)
    expect(focusableWithin(d)).toEqual([])
    expect(document.activeElement).toBe(d)
    // And Tab stays on it rather than walking out to the page behind.
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(d)
  })

  it('traps Tab: forwards off the last control and back to the first, and Shift+Tab the other way', () => {
    render(
      <Dialog title="Edit" onClose={() => {}} footer={<button>Save</button>}>
        <input aria-label="Name" />
      </Dialog>,
    )
    const close = screen.getByRole('button', { name: 'Close' })
    const name = screen.getByLabelText('Name')
    const save = screen.getByRole('button', { name: 'Save' })

    // Forwards off the end wraps to the start.
    save.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(close)

    // Backwards off the start wraps to the end.
    close.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(save)

    // In the middle the browser's own Tab is left alone: no preventDefault,
    // no forced move. (jsdom does not move focus on Tab, so the assertion is
    // on the event, not on where focus lands.)
    name.focus()
    const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(name)
  })

  it('pulls focus back in when it has escaped the dialog entirely', () => {
    // The Dashboard case: the confirm opens over a popup that stays mounted
    // by design, so focus could be sitting on a control behind the backdrop.
    const outside = document.createElement('button')
    outside.textContent = 'behind the backdrop'
    document.body.appendChild(outside)
    render(<Dialog title="Delete" onClose={() => {}} footer={<button>Delete</button>}>sure?</Dialog>)
    outside.focus()
    expect(document.activeElement).toBe(outside)
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
    document.body.removeChild(outside)
  })

  it('only the TOPMOST dialog holds Tab, exactly as it holds Escape', () => {
    render(
      <>
        <Dialog title="A" onClose={() => {}} footer={<button>A-save</button>}>a</Dialog>
        <Dialog title="B" onClose={() => {}} footer={<button>B-save</button>}>
          <input aria-label="B-field" />
        </Dialog>
      </>,
    )
    // B is topmost, so B's own last control wraps to B's first.
    screen.getByRole('button', { name: 'B-save' }).focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getAllByRole('button', { name: 'Close' })[1])

    // 🚨 THE PART THAT ACTUALLY TESTS THE GUARD. Both handlers sit on
    // `document` and the upper one runs LAST, so wherever the lower one moves
    // focus the upper one moves it back — the final position is identical
    // with the guard and without it, and the first cut of this test passed
    // with `isTopModal` deleted. The case that separates them is a control in
    // the MIDDLE of the topmost dialog: guarded, no handler does anything and
    // the browser's own Tab is left alone. Unguarded, the LOWER dialog sees
    // focus as "outside me", preventDefaults, and yanks it to B's first
    // control — so Tab in the middle of a form would jump to the header.
    const middle = screen.getByLabelText('B-field')
    middle.focus()
    const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(middle)
  })

  it('hands focus back to whatever had it when the dialog opened', () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'Open'
    document.body.appendChild(trigger)
    trigger.focus()
    const { unmount } = render(<Dialog title="Confirm" onClose={() => {}}>sure?</Dialog>)
    expect(document.activeElement).not.toBe(trigger)
    unmount()
    expect(document.activeElement).toBe(trigger)
    document.body.removeChild(trigger)
  })

  it('🚨 hands focus back even when a child has autoFocus — the case the app found', () => {
    // The regression this test exists for: the effect that captured the
    // return target ran AFTER React had already applied `autoFocus`, so it
    // captured the dialog's own field and closing dropped focus to <body>.
    // Measured on Team Members' rate dialog before it was fixed.
    const trigger = document.createElement('button')
    trigger.textContent = 'Edit rate'
    document.body.appendChild(trigger)
    trigger.focus()
    const { unmount } = render(
      <Dialog title="Set rate" onClose={() => {}} footer={<button>Save</button>}>
        <input aria-label="Day rate" autoFocus />
      </Dialog>,
    )
    // autoFocus won the open, as it should…
    expect(document.activeElement).toBe(screen.getByLabelText('Day rate'))
    unmount()
    // …and the trigger still gets it back.
    expect(document.activeElement).toBe(trigger)
    document.body.removeChild(trigger)
  })

  it('under StrictMode the dialog still lands on the autoFocus field, not on Close', () => {
    // React 18 StrictMode runs every effect mount -> unmount -> mount in dev,
    // and `autoFocus` does NOT fire again on that second mount because the DOM
    // node is not recreated. Without the remembered landing spot the second
    // run finds focus outside (the first run's cleanup handed it back to the
    // trigger) and focuses the first focusable control, which is Close — so a
    // dev build would put the caret somewhere a production build does not.
    // `src/main.jsx` wraps the app in <React.StrictMode>, so this is what the
    // lanes actually see while they work.
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    render(
      <StrictMode>
        <Dialog title="Set rate" onClose={() => {}} footer={<button>Save</button>}>
          <input aria-label="Day rate" autoFocus />
        </Dialog>
      </StrictMode>,
    )
    expect(document.activeElement).toBe(screen.getByLabelText('Day rate'))
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Close' }))
    document.body.removeChild(trigger)
  })

  it('restores to the trigger even when focus was moved inside the dialog first', () => {
    // The ordinary path: you Tab to Cancel and press it. The return target is
    // captured in RENDER, before this dialog's DOM exists, so it is still the
    // trigger no matter where focus travelled inside.
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    const { unmount } = render(
      <Dialog title="Confirm" onClose={() => {}} footer={<button>Yes</button>}>body</Dialog>,
    )
    const inside = screen.getByRole('button', { name: 'Yes' })
    inside.focus()
    expect(document.activeElement).toBe(inside)
    unmount()
    expect(document.activeElement).toBe(trigger)
    document.body.removeChild(trigger)
  })

  it('does not chase a trigger that is gone — the row a delete dialog opened from', () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    const { unmount } = render(<Dialog title="Delete row" onClose={() => {}}>sure?</Dialog>)
    document.body.removeChild(trigger)          // the row went with the delete
    expect(() => unmount()).not.toThrow()
    expect(document.activeElement).toBe(document.body)
  })
})

