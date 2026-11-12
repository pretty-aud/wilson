/** @vitest-environment jsdom */
// rabbitNavigate.test.js — a jump the person turned down is dropped, not
// left pending for the next time its view mounts (post-overhaul S3c, step 7:
// "Keep editing" at the leave guard).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { navigateTo, dropPendingNavigate, useNavigateTarget, mothItemTarget, openFromMoth } from './rabbitNavigate'

// A mounted target consumes every later jump to its view: unmount each.
afterEach(cleanup)

describe('dropPendingNavigate', () => {
  it('a turned-down jump never reaches its view later', () => {
    const d = { view: 'bins', projectId: 'p1', fileId: 'f1' }
    navigateTo(d)
    dropPendingNavigate(d)
    const handler = vi.fn(() => true)
    renderHook(() => useNavigateTarget('bins', handler, 'p1'))
    expect(handler).not.toHaveBeenCalled()
  })
  it('CONTROL: a jump not turned down is consumed when its view mounts', () => {
    navigateTo({ view: 'bins', projectId: 'p1', fileId: 'f2' })
    const handler = vi.fn(() => true)
    renderHook(() => useNavigateTarget('bins', handler, 'p1'))
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'f2' }))
  })
  it('dropping one view\'s jump leaves another view\'s pending one alone', () => {
    navigateTo({ view: 'scenes', projectId: 'p1', shotId: 's1' })
    dropPendingNavigate({ view: 'bins' })
    const handler = vi.fn(() => true)
    renderHook(() => useNavigateTarget('scenes', handler, 'p1'))
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ shotId: 's1' }))
  })
})

describe('mothItemTarget (MO2: Open in R.A.B.B.I.T. from M.O.T.H.)', () => {
  it('opens each kind at its own tab, with what that tab opens', () => {
    expect(mothItemTarget('project', 'p1')).toEqual({ view: 'summary' })
    expect(mothItemTarget('phase', 'ph1')).toEqual({ view: 'timeline' })
    expect(mothItemTarget('task', 't1')).toEqual({ view: 'tasks', itemId: 't1' })
    expect(mothItemTarget('asset', 'a1')).toEqual({ view: 'assets', itemId: 'a1' })
    expect(mothItemTarget('scene', 'sc1')).toEqual({ view: 'scenes', sceneId: 'sc1' })
    expect(mothItemTarget('shot', 'sh1')).toEqual({ view: 'scenes', shotId: 'sh1' })
    expect(mothItemTarget('level', 'l1')).toEqual({ view: 'levels', itemId: 'l1' })
    expect(mothItemTarget('experience', 'e1')).toEqual({ view: 'experiences', itemId: 'e1' })
  })
  it('a kind with no tab opens nothing, whatever it is called', () => {
    for (const kind of ['folder', 'file', 'tag', 'toString', '__proto__', undefined]) expect(mothItemTarget(kind, 'x')).toBeNull()
  })
  it('a task opened this way waits for its rows, then opens once', () => {
    // As the Tasks view does: its handler is made again when its rows change, and declines until the task is there.
    const seen = []
    const handlerFor = (rows) => (p) => { if (!rows.includes(p.itemId)) return false; seen.push(p.itemId); return true }
    navigateTo({ projectId: 'p1', ...mothItemTarget('task', 't1') })
    const { rerender } = renderHook(({ h }) => useNavigateTarget('tasks', h, 'p1'), { initialProps: { h: handlerFor([]) } })
    expect(seen).toEqual([])
    rerender({ h: handlerFor(['t1']) })
    expect(seen).toEqual(['t1'])
    rerender({ h: handlerFor(['t1', 't2']) })
    expect(seen).toEqual(['t1'])
  })
})

describe('openFromMoth (MO2 review round 1)', () => {
  const deps = (over = {}) => {
    const calls = []
    return {
      calls,
      currentId: () => 'p1',
      confirm: vi.fn(async () => { calls.push('confirm'); return true }),
      switchProject: vi.fn(async (id) => { calls.push(`switch:${id}`) }),
      navigate: vi.fn((d) => { calls.push(`go:${d.view}`) }),
      ...over,
    }
  }
  it('in the open project, opens the tab and the item at once, asking nothing', async () => {
    const d = deps()
    expect(await openFromMoth({ projectId: 'p1', target: { view: 'tasks', itemId: 't1' } }, d)).toBe(true)
    expect(d.calls).toEqual(['go:tasks'])
    expect(d.navigate).toHaveBeenCalledWith({ projectId: 'p1', view: 'tasks', itemId: 't1' })
  })
  it('in another project, asks first, switches, and only then opens the tab', async () => {
    const d = deps()
    await openFromMoth({ projectId: 'p2', target: { view: 'files', fileId: 'f1' } }, d)
    expect(d.calls).toEqual(['confirm', 'switch:p2', 'go:files'])
  })
  it('Keep editing changes nothing: no switch, no tab', async () => {
    const d = deps({ confirm: vi.fn(async () => false) })
    expect(await openFromMoth({ projectId: 'p2', target: { view: 'tasks', itemId: 't1' } }, d)).toBe(false)
    expect(d.switchProject).not.toHaveBeenCalled()
    expect(d.navigate).not.toHaveBeenCalled()
  })
  it('nothing to open opens nothing', async () => {
    const d = deps()
    expect(await openFromMoth({ projectId: null, target: { view: 'tasks' } }, d)).toBe(false)
    expect(await openFromMoth({ projectId: 'p1', target: null }, d)).toBe(false)
    expect(d.navigate).not.toHaveBeenCalled()
  })
})
