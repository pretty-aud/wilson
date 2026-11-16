// =============================================================================
// withTimeout.test.js — Session 17.
//
// Pins the helper that stops a hung auth call stranding the UI. This existed
// because the failure it prevents is invisible in every other kind of testing:
// the operation SUCCEEDS server-side, so the database looks right, the logs
// look right, and only the person staring at a button that says "Verifying…"
// knows anything is wrong.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withTimeout, TimeoutError, AUTH_TIMEOUT_MS } from './withTimeout'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('withTimeout', () => {
  it('resolves with the value when the promise settles in time', async () => {
    const p = withTimeout(Promise.resolve('ok'), 1000, 'test')
    await expect(p).resolves.toBe('ok')
  })

  it('propagates a rejection unchanged rather than masking it as a timeout', async () => {
    // A real error must stay a real error — the caller's message for a
    // rejected MFA code is different from its message for a dead network.
    const boom = new Error('code rejected')
    await expect(withTimeout(Promise.reject(boom), 1000, 'test')).rejects.toThrow('code rejected')
  })

  it('rejects with TimeoutError once the ceiling passes', async () => {
    const never = new Promise(() => {})           // the bug, in one line
    const p = withTimeout(never, 5000, 'MFA verify')
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError)
    await vi.advanceTimersByTimeAsync(5000)
    await assertion
  })

  it('names the operation in the error, so the log says which call hung', async () => {
    const p = withTimeout(new Promise(() => {}), 100, 'issue-session')
    const assertion = expect(p).rejects.toThrow(/issue-session timed out after 100ms/)
    await vi.advanceTimersByTimeAsync(100)
    await assertion
  })

  it('carries label and ms on the error for callers that branch on them', async () => {
    const p = withTimeout(new Promise(() => {}), 250, 'session save')
    const caught = p.catch((e) => e)
    await vi.advanceTimersByTimeAsync(250)
    const err = await caught
    expect(err.name).toBe('TimeoutError')
    expect(err.label).toBe('session save')
    expect(err.ms).toBe(250)
  })

  it('does not fire after the promise already resolved', async () => {
    // Regression guard: a leftover timer would reject an already-settled
    // race (harmless) but also keep a handle alive in Electron.
    const p = withTimeout(Promise.resolve('fast'), 1000, 'test')
    await expect(p).resolves.toBe('fast')
    await vi.advanceTimersByTimeAsync(5000)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears its timer when the promise rejects, too', async () => {
    await expect(withTimeout(Promise.reject(new Error('x')), 1000, 't')).rejects.toThrow('x')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses a ceiling long enough for a slow connection but short enough to notice', () => {
    // Not arbitrary: GoTrue MFA verify and issue-session are both normally
    // sub-second, and a user will not wait past ~15s without assuming it broke.
    expect(AUTH_TIMEOUT_MS).toBeGreaterThanOrEqual(10000)
    expect(AUTH_TIMEOUT_MS).toBeLessThanOrEqual(30000)
  })
})
