/** @vitest-environment jsdom */
// =============================================================================
// The shell's undo toast pauses while it has the keyboard's focus, as it does
// under the pointer (post-overhaul VW1d, 2026-10-25: docs/design/
// CUSTOM_VIEWS_DESIGN.md §4.4, step 0 review finding 11 — a keyboard user
// who Tabs to Undo is reading it too). CONTROL: unfocused, it goes.
// =============================================================================
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react'

const rabbit = vi.hoisted(() => ({ current: null }))
vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))
const { default: UndoToast } = await import('./UndoToast')

afterEach(() => { cleanup(); vi.useRealTimers(); delete globalThis.__WILSON_TEST_UNDO_TOAST_MS })

function mount() {
  const dismiss = vi.fn()
  rabbit.current = { undoToast: { key: 1, message: 'Shoot week saved', onUndo: vi.fn() }, dismissUndoToast: dismiss, undoHeld: null }
  render(<UndoToast />)
  return dismiss
}

describe('the undo toast\'s pause', () => {
  it('focus on its Undo holds the deadline; leaving it lets the deadline run', () => {
    vi.useFakeTimers()
    globalThis.__WILSON_TEST_UNDO_TOAST_MS = 1000
    const dismiss = mount()
    const undo = screen.getByRole('button', { name: /Undo/ })
    act(() => { fireEvent.focus(undo) })
    act(() => { vi.advanceTimersByTime(5000) })
    expect(dismiss).not.toHaveBeenCalled()
    act(() => { fireEvent.blur(undo, { relatedTarget: document.body }) })
    act(() => { vi.advanceTimersByTime(1100) })
    expect(dismiss).toHaveBeenCalledTimes(1)
  })
  it('CONTROL: with no focus and no pointer it goes at its deadline', () => {
    vi.useFakeTimers()
    globalThis.__WILSON_TEST_UNDO_TOAST_MS = 1000
    const dismiss = mount()
    act(() => { vi.advanceTimersByTime(1100) })
    expect(dismiss).toHaveBeenCalledTimes(1)
  })
  it('focus moving between its own buttons keeps it held', () => {
    vi.useFakeTimers()
    globalThis.__WILSON_TEST_UNDO_TOAST_MS = 1000
    const dismiss = mount()
    const undo = screen.getByRole('button', { name: /Undo/ })
    const close = screen.getByTitle('Dismiss')
    act(() => { fireEvent.focus(undo) })
    act(() => { fireEvent.blur(undo, { relatedTarget: close }) })
    act(() => { vi.advanceTimersByTime(5000) })
    expect(dismiss).not.toHaveBeenCalled()
  })
})
