/** @vitest-environment jsdom */
// =============================================================================
// PetNotice on the kit's toast stack — the Track A merge, review round 1
// (A-R1-06) as it ships, pinned in round 2 (A-R2-08: the only coverage was
// source-text pins in userStateWiring.test.js, and none of the rework's
// claims was exercised), plus the both-mounted probe A-R2-02 asked for.
//
// What is pinned: push and withdraw keyed on the notice OBJECT; the info
// notice's ten seconds, run by PetNotice's own timer, which clears APP's
// state (the kit's timer is off — duration 0 — so the two cannot disagree);
// the error notice sticky with no timer at all; a re-render with the same
// object neither re-pushing nor restarting; the same sentence as a NEW object
// showing again with a fresh ten seconds; the kit's X withdrawing the toast
// without touching App's state (as it is — harmless today, now recorded);
// and, with R.A.B.B.I.T.'s UndoToast pinned on the same stack, the notice
// ABOVE the Undo row in one column, never over its button.
// =============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { ToastProvider } from '../ui/Toast'
import PetNotice from './PetNotice'
import UndoToast from '../tools/rabbit_v0.1.0/components/UndoToast'

// UndoToast reads its state from the R.A.B.B.I.T. context; one object for
// the run, set per test (rabbitScenesRender.test.jsx's stand-in).
const rabbit = vi.hoisted(() => ({ current: null }))
vi.mock('../tools/rabbit_v0.1.0/state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))

afterEach(() => { cleanup(); vi.useRealTimers(); rabbit.current = null })

const stack = () => document.querySelector('.ui-toast-stack')
const toasts = () => stack().querySelectorAll('.ui-toast')
const tree = (notice, onDismiss, pinned) => (
  <ToastProvider bar="8px" pinned={pinned}>
    <PetNotice notice={notice} onDismiss={onDismiss} />
  </ToastProvider>
)
// Fresh literals, as App's announcePetNotice hands them over.
const INFO = () => ({ kind: 'info', message: 'Your pet changed on another device — refreshed' })
const ERROR = () => ({ kind: 'error', message: 'Your pet could not be loaded' })
const TEN_SECONDS = 10_000

describe('PetNotice on the kit toast stack', () => {
  it('says nothing when there is nothing to say', () => {
    render(tree(null, vi.fn()))
    expect(toasts().length).toBe(0)
  })

  it('info: one toast, info tone, a status; sticky on the kit side, and after ten seconds it asks App to clear it — the clear withdraws it', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    const utils = render(tree(INFO(), onDismiss))
    expect(toasts().length).toBe(1)
    const t = toasts()[0]
    expect(t.dataset.tone).toBe('info')
    expect(t.getAttribute('role')).toBe('status')
    expect(t.textContent).toContain('refreshed')
    act(() => { vi.advanceTimersByTime(TEN_SECONDS - 1) })
    expect(onDismiss).not.toHaveBeenCalled()
    // The kit's own timer is off (duration 0): the toast is App's to clear.
    expect(toasts().length).toBe(1)
    act(() => { vi.advanceTimersByTime(1) })
    expect(onDismiss).toHaveBeenCalledTimes(1)
    // …and still up until App acts on the callback, so the two cannot
    // disagree about whether the notice is showing.
    expect(toasts().length).toBe(1)
    utils.rerender(tree(null, onDismiss))
    expect(toasts().length).toBe(0)
  })

  it('error: danger tone, an alert, and no timer at all — a standing condition, not an event', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(tree(ERROR(), onDismiss))
    const t = toasts()[0]
    expect(t.dataset.tone).toBe('danger')
    expect(t.getAttribute('role')).toBe('alert')
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(onDismiss).not.toHaveBeenCalled()
    expect(toasts().length).toBe(1)
  })

  it('keyed on the notice OBJECT: a re-render with the same object neither re-pushes nor restarts the ten seconds', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    const notice = INFO()
    const utils = render(tree(notice, onDismiss))
    act(() => { vi.advanceTimersByTime(6_000) })
    // App re-rendered for an unrelated reason: same state, same object.
    utils.rerender(tree(notice, onDismiss))
    expect(toasts().length).toBe(1)
    act(() => { vi.advanceTimersByTime(4_000) })
    // Ten seconds from the announcement, not from the re-render.
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('…and the same sentence announced again as a NEW object shows again, with a fresh ten seconds (0068 says the same thing every time)', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    const utils = render(tree(INFO(), onDismiss))
    act(() => { vi.advanceTimersByTime(TEN_SECONDS) })
    expect(onDismiss).toHaveBeenCalledTimes(1)
    utils.rerender(tree(null, onDismiss))
    expect(toasts().length).toBe(0)
    utils.rerender(tree(INFO(), onDismiss))
    expect(toasts().length).toBe(1)
    act(() => { vi.advanceTimersByTime(TEN_SECONDS - 1) })
    expect(onDismiss).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(1) })
    expect(onDismiss).toHaveBeenCalledTimes(2)
  })

  it('a second announcement replaces the first: one toast, never two', () => {
    const onDismiss = vi.fn()
    const utils = render(tree(INFO(), onDismiss))
    utils.rerender(tree(ERROR(), onDismiss))
    expect(toasts().length).toBe(1)
    expect(toasts()[0].dataset.tone).toBe('danger')
  })

  it("the kit's X withdraws the toast and leaves App's state to App: onDismiss is not called (recorded as it is)", () => {
    const onDismiss = vi.fn()
    const utils = render(tree(ERROR(), onDismiss))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(toasts().length).toBe(0)
    expect(onDismiss).not.toHaveBeenCalled()
    // App clearing afterwards is a no-op, not a throw.
    utils.rerender(tree(null, onDismiss))
    expect(toasts().length).toBe(0)
  })
})

describe('with UndoToast pinned on the same stack (A-R2-02)', () => {
  it('the notice and the Undo row share one column, the Undo LAST — the notice above its button, never over it', () => {
    const onUndo = vi.fn()
    rabbit.current = { undoToast: { key: 1, message: 'Deleted "Comp"', onUndo }, dismissUndoToast: vi.fn() }
    render(tree(ERROR(), vi.fn(), <UndoToast />))
    const s = stack()
    const undo = screen.getByRole('button', { name: 'Undo' })
    // One column: the Undo is inside the stack, not a second fixed surface.
    expect(s.contains(undo)).toBe(true)
    const pinned = s.querySelector('.ui-toast-pinned')
    expect(pinned).toBe(s.lastElementChild)
    const pet = s.querySelector('.ui-toast')
    expect(pet.textContent).toContain('could not be loaded')
    expect(pet.compareDocumentPosition(pinned) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // No anchor and no layer of its own: the row rides the stack's.
    const row = pinned.firstElementChild
    expect(row.className).not.toMatch(/(?:^|\s)fixed(?:\s|$)/)
    expect(row.className).not.toMatch(/(?:^|\s)bottom-\d/)
    expect(row.className).not.toMatch(/(?:^|\s)z-/)
    expect(row.className).toMatch(/(?:^|\s)relative(?:\s|$)/)
    // …and with the sticky notice up, the button is the Undo's to click.
    fireEvent.click(undo)
    expect(onUndo).toHaveBeenCalledTimes(1)
  })

  it('CONTROL — with no delete pending the pinned wrapper is empty, and the notice is the stack’s only row', () => {
    rabbit.current = { undoToast: null, dismissUndoToast: vi.fn() }
    render(tree(INFO(), vi.fn(), <UndoToast />))
    const s = stack()
    const pinned = s.querySelector('.ui-toast-pinned')
    expect(pinned.childElementCount).toBe(0)
    expect(pinned.matches(':empty')).toBe(true)
    expect(toasts().length).toBe(1)
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })
})
