/** @vitest-environment jsdom */
// rabbitNavigate.test.js — a jump the person turned down is dropped, not
// left pending for the next time its view mounts (post-overhaul S3c, step 7:
// "Keep editing" at the leave guard).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { navigateTo, dropPendingNavigate, useNavigateTarget } from './rabbitNavigate'

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
