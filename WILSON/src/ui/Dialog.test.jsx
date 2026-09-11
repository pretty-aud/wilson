/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Dialog, DIALOG_WIDTHS } from './Dialog'
import { overlayOpen, _resetOverlaysForTests } from './overlay'

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

  it('Q17 (ruled): Escape closes, the X closes, the backdrop closes — every Dialog, no flag', () => {
    const onClose = vi.fn()
    render(<Dialog title="Plain" onClose={onClose}>body</Dialog>)
    expect(overlayOpen()).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    fireEvent.mouseDown(document.querySelector('.ui-dialog-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(3)
    // …but a click INSIDE the dialog is not the backdrop.
    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(3)
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
  })

  it('accepts a legacy numeric width for Bins, and reports an unknown named one', () => {
    render(<Dialog title="Legacy" width={640} onClose={() => {}}>x</Dialog>)
    expect(screen.getByRole('dialog', { name: 'Legacy' }).style.width).toBe('640px')
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<Dialog title="Odd" width="huge" onClose={() => {}}>x</Dialog>)
    expect(err).toHaveBeenCalledWith(expect.stringContaining('unknown width'))
    err.mockRestore()
  })
})
