/** @vitest-environment jsdom */
// =============================================================================
// The Budget view's three data hooks under StrictMode (B5, 2026-09-26).
//
// Each kept a mounted guard that only an unmount set — `useRef(true)` plus an
// effect whose cleanup set it false. StrictMode (every dev build) runs that
// cleanup once between two mounts, so the guard stayed false and every load
// after it was dropped: in the running app the Talent tab said "Loading
// talent..." for ever and the Expenses tab drew nothing (B4c's FileAuditDrawer
// had the same defect). A production build mounts once; nothing changes there.
// =============================================================================
import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const adapter = {
  listBudgetLines: vi.fn(async () => [{ id: 'l1', project_id: 'p1', sheet: 'talent', sort_order: 0 }]),
  listBudgetActuals: vi.fn(async () => []),
  listExpenses: vi.fn(async () => [{ id: 'e1', project_id: 'p1', name: 'Ferry' }]),
  listProjectRateOverrides: vi.fn(async () => [{ id: 'o1', project_id: 'p1', role: 'editor', rate: 400 }]),
}
const rabbit = { getAdapter: () => adapter, project: { id: 'p1' }, adapterMode: 'fixtures', adapterStatus: { online: true } }
vi.mock('../../tools/rabbit_v0.1.0/state/RabbitProvider', () => ({ useRabbit: () => rabbit }))

const { useBudgetLines } = await import('./useBudgetLines')
const { useExpenses } = await import('../Expenses/useExpenses')
const { useProjectRateOverrides } = await import('./useProjectRateOverrides')


describe('the Budget hooks finish loading under StrictMode', () => {
  it('useBudgetLines: the lines land and loading ends', async () => {
    const { result } = renderHook(() => useBudgetLines(), { reactStrictMode: true })
    await waitFor(() => expect(result.current.lines).toHaveLength(1))
    expect(result.current.loading).toBe(false)
  })
  it('useExpenses: the expenses land and loading ends', async () => {
    const { result } = renderHook(() => useExpenses(), { reactStrictMode: true })
    await waitFor(() => expect(result.current.expenses).toHaveLength(1))
    expect(result.current.loading).toBe(false)
  })
  it('useProjectRateOverrides: the overrides land and loading ends', async () => {
    const { result } = renderHook(() => useProjectRateOverrides(), { reactStrictMode: true })
    await waitFor(() => expect(result.current.overrides).toHaveLength(1))
    expect(result.current.loading).toBe(false)
  })
})
