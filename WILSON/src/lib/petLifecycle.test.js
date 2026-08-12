// =============================================================================
// petLifecycle.test.js — Phase 3, 2026-08-12.
//
// 🚨 THIS FILE EXISTS BECAUSE THE TEST THAT CLAIMED TO COVER THIS BUG WAS GREEN
// THROUGHOUT IT.
//
// userStateWiring.test.js had `it('creating a new egg after a death is not a
// silent no-op')`, and its entire body was:
//
//     expect(app).toMatch(/A new egg could not be created/)
//
// The string was present, so the test passed, while the button did nothing on
// Audrey's computer for two days. It pinned the EXISTENCE OF A STRING LITERAL —
// not the click, not the write, not whether any surface rendered it.
//
// The rules that follow from that (S43, and the repo's standing guidance):
// assert the EXECUTABLE form, and include FAILING CONTROLS — a predicate that
// is never allowed to be false proves nothing by being true.
//
// So every eligibility test below is paired with the forms that MUST be
// refused, and the no-I/O test asserts the property the whole fix rests on.
// =============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest'
import { canCreateNewEgg, mintEggFrom, defaultPet, DEAD_FORMS } from './petLifecycle'

/** Audrey's pet as reported: died, feedback history intact. */
const TOMITHY_GHOST = {
  name: 'Tomithy', form: 'ghost', gender: 'male', breed: 'blob',
  difficulty: 'low', petMode: true,
  bornAt: '2026-07-16T07:57:42.865Z', diedAt: '2026-07-30T17:30:12.459Z',
  hunger: 0, happiness: 0, interactionCount: 5,
  feedback: [
    { rating: 'up', userMessage: 'hi', botResponse: 'hello', at: '2026-07-20T00:00:00.000Z' },
    { rating: 'down', userMessage: 'no', botResponse: 'sorry', at: '2026-07-21T00:00:00.000Z' },
  ],
  totalThumbsUp: 7, totalThumbsDown: 3,
}

afterEach(() => { vi.restoreAllMocks() })

describe('canCreateNewEgg — who may start over', () => {
  it('🚨 a ghost may — the reported case', () => {
    expect(canCreateNewEgg(TOMITHY_GHOST)).toBe(true)
  })

  it('🚨 a CORPSE may too — the button was offered and then refused', () => {
    // SettingsPage has always shown the control for `ghost || corpse`, while
    // both old implementations demanded form === 'ghost' exactly. A pet saved
    // mid-death sat in 'corpse' forever: applyOfflineDecay skips corpses and
    // the decay tick skips corpses, so nothing ever promoted it. The button
    // was visible and could only ever fail.
    expect(canCreateNewEgg({ ...TOMITHY_GHOST, form: 'corpse' })).toBe(true)
  })

  it('both dead forms are covered, and only those', () => {
    expect([...DEAD_FORMS].sort()).toEqual(['corpse', 'ghost'])
  })

  // ── FAILING CONTROLS ──────────────────────────────────────────────────────
  // Without these, `canCreateNewEgg = () => true` passes everything above.

  it('CONTROL: a living adult may NOT', () => {
    expect(canCreateNewEgg({ ...TOMITHY_GHOST, form: 'adult', diedAt: null })).toBe(false)
  })

  it('CONTROL: a baby may NOT', () => {
    expect(canCreateNewEgg({ ...TOMITHY_GHOST, form: 'baby', diedAt: null })).toBe(false)
  })

  it('CONTROL: an egg may NOT — no double-eggs', () => {
    expect(canCreateNewEgg(defaultPet())).toBe(false)
  })

  it('CONTROL: no pet at all may NOT', () => {
    expect(canCreateNewEgg(null)).toBe(false)
    expect(canCreateNewEgg(undefined)).toBe(false)
  })

  it('CONTROL: an unknown form may NOT', () => {
    expect(canCreateNewEgg({ form: 'dragon' })).toBe(false)
    expect(canCreateNewEgg({})).toBe(false)
  })
})

describe('🚨 the decision reads the PET, never a store', () => {
  // This is the whole fix. The old newPetEgg() answered from localStorage or
  // from the Express pet.json, and BOTH are per-device — which is why the same
  // account worked on one of Audrey's computers and not the other. Worse, an
  // OFFLINE death is never written to either store, so after a reload the
  // screen showed a ghost while every store still said 'adult'.
  it('touches neither fetch nor localStorage', async () => {
    const fetchSpy = vi.fn(() => { throw new Error('fetch must not be called') })
    const getItem = vi.fn(() => { throw new Error('localStorage must not be read') })
    const setItem = vi.fn(() => { throw new Error('localStorage must not be written') })
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal('localStorage', { getItem, setItem, removeItem: vi.fn() })

    try {
      expect(canCreateNewEgg(TOMITHY_GHOST)).toBe(true)
      expect(mintEggFrom(TOMITHY_GHOST).form).toBe('egg')
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(getItem).not.toHaveBeenCalled()
      expect(setItem).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('a pet whose death exists ONLY in memory is still eligible', () => {
    // applyOfflineDecay() produces exactly this: a ghost that no store has
    // ever seen, because both load paths prime the signature ref instead of
    // saving. Re-pointing the old check at the account would have thrown here.
    const neverPersisted = { ...TOMITHY_GHOST, form: 'ghost' }
    expect(canCreateNewEgg(neverPersisted)).toBe(true)
  })
})

describe('mintEggFrom — what the new egg inherits', () => {
  it('is a fresh egg', () => {
    const egg = mintEggFrom(TOMITHY_GHOST)
    expect(egg.form).toBe('egg')
    expect(egg.bornAt).toBeNull()
    expect(egg.diedAt).toBeNull()
    expect(egg.breed).toBeNull()
    expect(egg.interactionCount).toBe(0)
  })

  it('🚨 carries the FULL feedback history — it is the pet\'s memory of her', () => {
    const egg = mintEggFrom(TOMITHY_GHOST)
    expect(egg.feedback).toHaveLength(2)
    expect(egg.feedback).toEqual(TOMITHY_GHOST.feedback)
  })

  it('🚨 carries both thumb totals', () => {
    const egg = mintEggFrom(TOMITHY_GHOST)
    expect(egg.totalThumbsUp).toBe(7)
    expect(egg.totalThumbsDown).toBe(3)
  })

  it('🚨 carries difficulty — a new egg must not silently reset to medium', () => {
    expect(mintEggFrom(TOMITHY_GHOST).difficulty).toBe('low')
    expect(mintEggFrom({ ...TOMITHY_GHOST, difficulty: 'high' }).difficulty).toBe('high')
  })

  it('CONTROL: it does NOT just return the old pet', () => {
    const egg = mintEggFrom(TOMITHY_GHOST)
    expect(egg.form).not.toBe('ghost')
    expect(egg.name).not.toBe('Tomithy')
    expect(egg.hunger).toBe(0)
  })

  it('does not mutate the dead pet', () => {
    const before = JSON.parse(JSON.stringify(TOMITHY_GHOST))
    mintEggFrom(TOMITHY_GHOST)
    expect(TOMITHY_GHOST).toEqual(before)
  })

  it('copies the feedback array rather than aliasing it', () => {
    const egg = mintEggFrom(TOMITHY_GHOST)
    egg.feedback.push({ rating: 'up' })
    expect(TOMITHY_GHOST.feedback).toHaveLength(2)
  })

  it('survives a pet with no feedback recorded', () => {
    const egg = mintEggFrom({ form: 'ghost' })
    expect(egg.feedback).toEqual([])
    expect(egg.totalThumbsUp).toBe(0)
    expect(egg.totalThumbsDown).toBe(0)
    expect(egg.difficulty).toBe('medium')
  })

  it('tolerates a corrupt feedback value instead of throwing', () => {
    // A save that half-landed, or an older row shape. Refusing the new egg here
    // would strand exactly the person this feature exists for.
    const egg = mintEggFrom({ form: 'ghost', feedback: 'not-an-array' })
    expect(egg.feedback).toEqual([])
  })

  it('is hatchable — the counters the hatch flow reads are present', () => {
    const egg = mintEggFrom(TOMITHY_GHOST)
    expect(egg.eggPetCount).toBe(0)
    expect(egg.eggHatchThreshold).toBeGreaterThanOrEqual(2)
    expect(egg.eggHatchThreshold).toBeLessThanOrEqual(4)
    expect(egg.petMode).toBe(true)
  })
})
