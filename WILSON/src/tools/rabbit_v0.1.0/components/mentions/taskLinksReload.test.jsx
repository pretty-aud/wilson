/** @vitest-environment jsdom */
// MO3: the task window reads its links again once a text's save has landed, since the server makes a typed link
// with the write. A timer from the local change alone reads too early on a slow connection, and the server's echo
// leaves the words the same, so nothing would read them again.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor, act } from '@testing-library/react'

// The provider's getAdapter is one function for the window's life, as the real one is.
const holder = vi.hoisted(() => {
  const h = { adapter: null }
  h.rabbit = { getAdapter: () => h.adapter }
  return h
})
vi.mock('../../state/RabbitProvider', () => ({ useRabbit: () => holder.rabbit }))
vi.mock('../../../../permissions/usePermissions', () => ({ usePermissions: () => ({ role: 'admin', ready: true }) }))
vi.mock('../../../../components/RateCard/useRateCard', () => ({ useRateCard: () => ({ entries: [], rateCards: [], settled: true, loading: false, error: null }) }))
vi.mock('../../../../components/TeamMembers/useRosterMembers', () => ({ useRosterMembers: () => ({ members: [], mode: 'supabase' }) }))
vi.mock('../FileManager', () => ({ default: () => null }))

const { default: TaskDetailPopup } = await import('../TaskDetailPopup')

afterEach(() => cleanup())

const TASK = '22222222-2222-2222-2222-222222222222'

describe('the task window\'s links after a save', () => {
  it('are read again when the write lands, not only a moment after the local change', async () => {
    const listMothItemRelationships = vi.fn(async () => ({ out: [], in: [] }))
    holder.adapter = { listMothItemRelationships }
    let landed
    const updateTask = vi.fn(() => new Promise(r => { landed = r }))
    const ctx = { tasks: [{ id: TASK, title: 'Grade the lamp shot', description: '', notes: '' }], project: { id: 'pppp' }, updateTask }
    const { getByText, container } = render(<TaskDetailPopup taskId={TASK} ctx={ctx} onClose={() => {}} />)
    // The first read, and the timer's fallback read after it.
    await act(async () => { await new Promise(r => setTimeout(r, 900)) })
    const before = listMothItemRelationships.mock.calls.length
    expect(before).toBeGreaterThan(0)

    fireEvent.click(getByText('Click to add a description…'))
    const el = container.querySelector('textarea[aria-label="Description"]')
    fireEvent.change(el, { target: { value: 'See the lamp' } })
    fireEvent.blur(el)
    expect(updateTask).toHaveBeenCalledWith(TASK, { description: 'See the lamp' })
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(listMothItemRelationships.mock.calls.length).toBe(before)

    await act(async () => { landed({ id: TASK, description: 'See the lamp' }) })
    await waitFor(() => expect(listMothItemRelationships.mock.calls.length).toBe(before + 1))
  })
})
