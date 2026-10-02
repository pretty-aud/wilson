// leaveGuard.test.js — one question before every exit (S3c step 7, D12).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { addLeaveGuard, confirmLeave, hasUnsavedWork, unsavedForClose, leaveTab, _resetLeaveGuardsForTests } from './leaveGuard'

beforeEach(() => _resetLeaveGuardsForTests())

const guard = ({ order = 2, reasons = ['tab', 'page'], dirty = true, answer = true, extra = {} } = {}) => {
  const g = {
    order,
    applies: (r) => reasons.includes(r),
    dirty: vi.fn(() => (typeof dirty === 'function' ? dirty() : dirty)),
    ask: vi.fn(async () => answer),
    ...extra,
  }
  addLeaveGuard(g)
  return g
}

describe('confirmLeave', () => {
  it('nothing unsaved: go on, asking nobody', async () => {
    const g = guard({ dirty: false })
    expect(hasUnsavedWork('tab')).toBe(false)
    expect(await confirmLeave('tab')).toBe(true)
    expect(g.ask).not.toHaveBeenCalled()
  })
  it('only the guards the exit is about are asked', async () => {
    const edit = guard({ reasons: ['tab', 'page'] })
    const popup = guard({ order: 1, reasons: ['tab', 'popup'] })
    expect(await confirmLeave('page')).toBe(true)
    expect(edit.ask).toHaveBeenCalledWith('page')
    expect(popup.ask).not.toHaveBeenCalled()
    expect(hasUnsavedWork('close')).toBe(false)
  })
  it('the nearest asks first, and the first "stay" ends it', async () => {
    const order = []
    const edit = guard({ order: 2, extra: { ask: vi.fn(async () => { order.push('edit'); return true }) } })
    const popup = guard({ order: 1, answer: false, extra: { ask: vi.fn(async () => { order.push('popup'); return false }) } })
    expect(await confirmLeave('tab')).toBe(false)
    expect(order).toEqual(['popup'])
    expect(edit.ask).not.toHaveBeenCalled()
    popup.ask.mockImplementation(async () => { order.push('popup'); return true })
    expect(await confirmLeave('tab')).toBe(true)
    expect(order).toEqual(['popup', 'popup', 'edit'])
  })
  it('a second exit while one question is open is refused, not queued; after the answer it asks again', async () => {
    let answer
    guard({ extra: { ask: vi.fn(() => new Promise((r) => { answer = r })) } })
    const first = confirmLeave('tab')
    expect(await confirmLeave('page')).toBe(false)
    answer(true)
    expect(await first).toBe(true)
    const again = confirmLeave('tab')
    answer(false)
    expect(await again).toBe(false)
  })
  it('a guard whose work an earlier answer dealt with is not asked', async () => {
    let held = true
    const popup = guard({ order: 1, extra: { ask: vi.fn(async () => { held = false; return true }) } })
    const edit = guard({ order: 2, dirty: () => held })
    expect(await confirmLeave('tab')).toBe(true)
    expect(popup.ask).toHaveBeenCalled()
    expect(edit.ask).not.toHaveBeenCalled()
  })
  it('the window\'s close folds in only the guards that can be saved or discarded from there', () => {
    guard({ reasons: ['close'] })
    const edit = guard({ reasons: ['close'], extra: { save: async () => {}, discard: () => {}, describe: () => 'x' } })
    expect(unsavedForClose()).toEqual([edit])
  })
  it('the tab strip: only leaving the Scenes tab asks — arriving there, or moving between other tabs, never does', async () => {
    const g = guard({ answer: false, reasons: ['tab'] })
    expect(await leaveTab('scenes', 'bins')).toBe(false)
    expect(g.ask).toHaveBeenCalledTimes(1)
    expect(await leaveTab('bins', 'scenes')).toBe(true)
    expect(await leaveTab('timeline', 'budget')).toBe(true)
    expect(await leaveTab('scenes', 'scenes')).toBe(true)
    expect(g.ask).toHaveBeenCalledTimes(1)
  })
  it('a removed guard is never asked again', async () => {
    const g = { order: 1, applies: () => true, dirty: () => true, ask: vi.fn(async () => false) }
    const remove = addLeaveGuard(g)
    remove()
    expect(await confirmLeave('tab')).toBe(true)
    expect(g.ask).not.toHaveBeenCalled()
  })
})
