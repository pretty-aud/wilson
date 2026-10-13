// =============================================================================
// coalescingSave.test.js — Phase 3, 2026-08-12.
//
// 🚨 THIS SUITE EXISTS BECAUSE THE QUEUE IT TESTS PRODUCED TWO DEFECTS IN ONE
// SESSION, and a source-scanning test could not have caught either. Both said
// "saved" for a write that had not happened — the failure S30 spent a session
// removing from the pet, reintroduced by the fix for a different bug.
//
// The question both defects turn on is *which caller receives which result*,
// which is not visible in source text. It is visible here.
// =============================================================================

import { describe, it, expect, vi } from 'vitest'
import { createCoalescingSave } from './coalescingSave'

/** A write we can hold open and release by hand. */
function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/** Lets the microtask queue drain. */
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('one write at a time, newest wins', () => {
  it('runs a lone save immediately and returns its result', async () => {
    const perform = vi.fn(async () => true)
    const save = createCoalescingSave(perform)
    await expect(save({ n: 1 })).resolves.toBe(true)
    expect(perform).toHaveBeenCalledTimes(1)
    expect(perform.mock.calls[0][0]).toEqual({ n: 1 })
  })

  it('propagates a failed write as false', async () => {
    const save = createCoalescingSave(async () => false)
    await expect(save({ n: 1 })).resolves.toBe(false)
  })

  it('does not run two writes concurrently', async () => {
    let inFlight = 0
    let maxConcurrent = 0
    const gate = deferred()
    const save = createCoalescingSave(async (d) => {
      inFlight += 1
      maxConcurrent = Math.max(maxConcurrent, inFlight)
      if (d.n === 1) await gate.promise
      inFlight -= 1
      return true
    })

    const a = save({ n: 1 })
    const b = save({ n: 2 })
    gate.resolve()
    await Promise.all([a, b])
    expect(maxConcurrent).toBe(1)
  })

  it('🚨 keeps only the NEWEST queued value — an intermediate state has no value', async () => {
    const seen = []
    const gate = deferred()
    const save = createCoalescingSave(async (d) => {
      seen.push(d.n)
      if (d.n === 1) await gate.promise
      return true
    })

    const a = save({ n: 1 })
    const b = save({ n: 2 })
    const c = save({ n: 3 })
    gate.resolve()
    await Promise.all([a, b, c])

    // 2 was superseded by 3 before the queue drained.
    expect(seen).toEqual([1, 3])
  })

  it('CONTROL: it does NOT drop the queued write entirely', async () => {
    // The guard S30 replaced was `if (saving) return`, which discarded the
    // update — so a decay tick colliding with a slow write vanished and the pet
    // aged backwards on the next load. Never go back to that.
    const seen = []
    const gate = deferred()
    const save = createCoalescingSave(async (d) => {
      seen.push(d.n)
      if (d.n === 1) await gate.promise
      return true
    })
    const a = save({ n: 1 })
    const b = save({ n: 2 })
    gate.resolve()
    await Promise.all([a, b])
    expect(seen).toContain(2)
  })
})

describe('🚨 every caller settles with the result of the write that carried ITS data', () => {
  it('a queued caller waits for the real write, not for the one in flight', async () => {
    const gate = deferred()
    let settled = false
    const save = createCoalescingSave(async (d) => {
      if (d.n === 1) await gate.promise
      return true
    })

    const a = save({ n: 1 })
    const b = save({ n: 2 }).then((r) => { settled = true; return r })

    await flush()
    // DEFECT 1: this returned `true` the instant it was queued.
    expect(settled).toBe(false)

    gate.resolve()
    await expect(a).resolves.toBe(true)
    await expect(b).resolves.toBe(true)
  })

  it('🚨 a caller that queues DURING the flush is not settled by the flush before it', async () => {
    // DEFECT 2, and the subtler one. The first fix settled waiters AFTER the
    // recursive flush, so a caller that arrived while that flush was running
    // was resolved with the PREVIOUS write's result — before its own data had
    // been written at all.
    const first = deferred()
    const second = deferred()
    const save = createCoalescingSave(async (d) => {
      if (d.n === 1) { await first.promise; return true }
      if (d.n === 2) { await second.promise; return false }
      return true
    })

    const a = save({ n: 1 })          // in flight
    const b = save({ n: 2 })          // queued behind it

    let bSettled = false
    b.then(() => { bSettled = true })

    first.resolve()                   // write 1 done -> write 2 starts
    await flush()
    expect(bSettled).toBe(false)      // write 2 has NOT finished yet

    second.resolve()
    await expect(b).resolves.toBe(false)   // and it gets ITS OWN result
    await expect(a).resolves.toBe(true)
  })

  it('a queued caller gets the failure of the write that superseded it', async () => {
    const gate = deferred()
    const save = createCoalescingSave(async (d) => {
      if (d.n === 1) { await gate.promise; return true }
      return false
    })
    const a = save({ n: 1 })
    const b = save({ n: 2 })
    gate.resolve()
    await expect(a).resolves.toBe(true)
    await expect(b).resolves.toBe(false)
  })
})

describe('🚨 it never leaves a caller hanging', () => {
  // handleNewPet awaits this. A promise that never settles strands its pending
  // flag and disables the Create Egg button for the rest of the session.
  it('a throwing write settles as false rather than rejecting', async () => {
    const save = createCoalescingSave(async () => { throw new Error('boom') })
    await expect(save({ n: 1 })).resolves.toBe(false)
  })

  it('a throwing write still settles everyone queued behind it', async () => {
    const gate = deferred()
    const save = createCoalescingSave(async (d) => {
      if (d.n === 1) { await gate.promise; throw new Error('boom') }
      throw new Error('boom too')
    })
    const a = save({ n: 1 })
    const b = save({ n: 2 })
    gate.resolve()
    await expect(a).resolves.toBe(false)
    await expect(b).resolves.toBe(false)
  })

  it('settles a long queue of callers, in any arrival order', async () => {
    const gate = deferred()
    const save = createCoalescingSave(async (d) => {
      if (d.n === 0) await gate.promise
      return true
    })
    const calls = [save({ n: 0 }), ...Array.from({ length: 12 }, (_, i) => save({ n: i + 1 }))]
    gate.resolve()
    await expect(Promise.all(calls)).resolves.toHaveLength(13)
  })

  it('the queue keeps working after a failure', async () => {
    let mode = false
    const save = createCoalescingSave(async () => mode)
    await expect(save({ n: 1 })).resolves.toBe(false)
    mode = true
    await expect(save({ n: 2 })).resolves.toBe(true)
  })
})
