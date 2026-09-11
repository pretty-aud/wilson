/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Dialog, DIALOG_WIDTHS, DIALOG_BEHAVIOURS_DEFAULT } from './Dialog'
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

  it('Q17: the behaviours are off by default and the flag is the single switch', () => {
    expect(DIALOG_BEHAVIOURS_DEFAULT).toBe(false)
    const onClose = vi.fn()
    render(<Dialog title="Plain" onClose={onClose}>body</Dialog>)
    expect(overlayOpen()).toBe(false)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('with behaviours on: registers on the stack, only the topmost answers Escape, busy locks, the guard can refuse', () => {
    const closeA = vi.fn()
    const closeB = vi.fn()
    const guard = vi.fn(() => false)
    render(
      <>
        <Dialog title="A" onClose={closeA} behaviours onBeforeClose={guard}>a</Dialog>
        <Dialog title="B" onClose={closeB} behaviours>b</Dialog>
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
    const closeC = vi.fn()
    render(<Dialog title="C" onClose={closeC} behaviours busy>c</Dialog>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closeC).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Close' }).disabled).toBe(true)
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
