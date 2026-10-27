/** @vitest-environment jsdom */
// =============================================================================
// useMyTasks.test.jsx — R1 (2026-10-27, night 2): the Dashboard's *My tasks*
// reads its list again when one of its tasks' items changes in another window
// (docs/OUTSTANDING.md, "The Dashboard shows a task's assets as of its last
// load"). Migration 0101 puts a task's items on the workspace channel (an
// assigned task's, never a private project's: suite 104); this is the hook's
// half. The hook alone, with its two neighbours at the module boundary: the
// provider's context, whose workspace listener registry is faked (the test is
// the channel), and the session's user.
//
// A file of its own: the Dashboard view's test mocks this hook whole, and the
// model's test (dashboardTaskModel.test.js) is pure and runs without a DOM.
// =============================================================================
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'

const rabbit = vi.hoisted(() => ({ current: null }))
vi.mock('../../tools/rabbit_v0.1.0/state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))
vi.mock('../../permissions/usePermissions', () => ({ usePermissions: () => ({ userId: 'me', role: 'user', ready: true }) }))

const { useMyTasks } = await import('./useMyTasks')

/** The provider as the hook sees it, with the workspace channel's listeners in reach. */
function harness() {
  const listeners = new Set()
  const counts = { reads: 0, subscriptions: 0 }
  const adapter = {
    listMyTasks: async () => {
      counts.reads += 1
      return [{ id: 't1', project_id: 'p1', assignee_id: 'me', items: [{ kind: 'asset', id: 'a1', name: 'Lighthouse Interior' }] }]
    },
    listPhasesByProjects: async () => [],
    listProjectMembersByProjects: async () => [],
  }
  rabbit.current = {
    adapterMode: 'supabase',
    getAdapter: () => adapter,
    subscribeWorkspaceEvents: (cb) => {
      counts.subscriptions += 1
      listeners.add(cb)
      return () => { listeners.delete(cb) }
    },
  }
  return { emit: (evt) => { for (const cb of listeners) cb(evt) }, counts }
}

/** A task item's event as the workspace channel carries it. */
const itemEvent = (taskId, op = 'INSERT') => {
  const row = { id: 'i9', task_id: taskId, project_id: 'p1', entity_type: 'asset', entity_id: 'a2', position: 1 }
  return { table: 'task_items', op, record: op === 'DELETE' ? null : row, oldRecord: op === 'INSERT' ? null : row }
}

afterEach(() => { cleanup(); rabbit.current = null })

describe('R1: My tasks hears its tasks\' items on the workspace channel', () => {
  it('an item added to one of my tasks elsewhere reads the list again, once, after the debounce; one removed, the same; one subscription', async () => {
    const h = harness()
    const { result } = renderHook(() => useMyTasks())
    await waitFor(() => expect(result.current.tasks.map(t => t.id)).toEqual(['t1']))
    expect(h.counts.reads).toBe(1)
    act(() => h.emit(itemEvent('t1')))
    await waitFor(() => expect(h.counts.reads).toBe(2), { timeout: 2000 })
    act(() => h.emit(itemEvent('t1', 'DELETE')))
    await waitFor(() => expect(h.counts.reads).toBe(3), { timeout: 2000 })
    expect(h.counts.subscriptions).toBe(1)
  })

  it('CONTROL: an item of a task that is not mine reads nothing again', async () => {
    const h = harness()
    const { result } = renderHook(() => useMyTasks())
    await waitFor(() => expect(result.current.tasks).toHaveLength(1))
    act(() => h.emit(itemEvent('t9')))
    await act(() => new Promise(resolve => setTimeout(resolve, 700)))
    expect(h.counts.reads).toBe(1)
  })
})
