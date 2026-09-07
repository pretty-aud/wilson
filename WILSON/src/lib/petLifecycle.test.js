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

// =============================================================================
// Track A, bundle A3 (2026-09-07) — the death trio, driven as real functions.
//
// 🚨 THESE COULD NOT BE WRITTEN BEFORE. applyOfflineDecay and derivePetState
// lived in App.jsx, so every guard over them was a regex across a 2000-line
// component. Two of the four pins that broke when they moved were matching text
// that had simply been relocated — which is what a regex pin measures. Moving
// them into this module is what makes the assertions below possible, and each
// one drives the shipped function with real inputs.
// =============================================================================

import {
  applyOfflineDecay, derivePetState,
  DECAY_RATES, EVOLVE_TIMES, SLEEP_DURATIONS, CORPSE_TO_GHOST_MS,
} from './petLifecycle'

const MIN = 60000
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString()

/** A live adult with full bars, last true `minutesAgo` minutes ago. */
function adult(minutesAgo, over = {}) {
  return {
    form: 'adult', breed: 'otter', difficulty: 'medium', petMode: true,
    hunger: 100, happiness: 100,
    bornAt: iso(90 * MIN), sleepingSince: null, lastSleptAt: iso(60 * MIN),
    interactionCount: 3, diedAt: null, evolvedAt: iso(70 * MIN),
    lastUpdatedAt: iso(minutesAgo * MIN),
    ...over,
  }
}

describe('derivePetState — now driven, not grepped', () => {
  // This assertion used to live in userStateWiring.test.js as
  // `toMatch(/if \(pet\.form === 'egg'\) return 'content'/)` over App.jsx.
  it('🚨 an egg is never labelled starving', () => {
    // Every egg is minted with hunger 0, and the hunger ladder rendered that in
    // RED as "STARVING" — so a brand-new egg announced that it was dying, to
    // the one person whose pet had just died.
    expect(derivePetState({ form: 'egg', hunger: 0, happiness: 0 })).toBe('content')
  })

  it('a dead pet reads dead in both forms', () => {
    expect(derivePetState({ form: 'corpse', hunger: 0 })).toBe('dead')
    expect(derivePetState({ form: 'ghost', hunger: 0 })).toBe('dead')
  })

  it('sleep outranks the hunger ladder', () => {
    expect(derivePetState({ form: 'adult', sleepingSince: iso(MIN), hunger: 5 }))
      .toBe('sleeping')
  })

  it('the hunger ladder, in order', () => {
    expect(derivePetState({ form: 'adult', hunger: 10, happiness: 100 })).toBe('starving')
    expect(derivePetState({ form: 'adult', hunger: 30, happiness: 100 })).toBe('hungry')
    expect(derivePetState({ form: 'adult', hunger: 90, happiness: 10 })).toBe('lonely')
    expect(derivePetState({ form: 'adult', hunger: 90, happiness: 90 })).toBe('content')
  })
})

describe('🚨 A3(a) — the corpse that never became a ghost', () => {
  // The live tick sets form='corpse' and only a setTimeout inside that same
  // tick promotes it. Close, reload or sign out inside the window and the
  // corpse was the stored state FOREVER: this function excluded corpses and so
  // did the tick. Phase 3 made it recoverable (Create Egg accepts a corpse) and
  // left the state machine stalled.
  it('promotes a corpse whose death is older than the promotion window', () => {
    const out = applyOfflineDecay({
      form: 'corpse', hunger: 0, happiness: 0, difficulty: 'medium', petMode: true,
      diedAt: iso(CORPSE_TO_GHOST_MS + 5000), lastUpdatedAt: iso(30 * MIN),
    })
    expect(out.form).toBe('ghost')
    expect(out.state).toBe('dead')
  })

  it('leaves a corpse inside the window alone — the live tick still owns it', () => {
    const out = applyOfflineDecay({
      form: 'corpse', hunger: 0, happiness: 0, difficulty: 'medium', petMode: true,
      diedAt: iso(2000), lastUpdatedAt: iso(30 * MIN),
    })
    expect(out.form).toBe('corpse')
  })

  it('leaves a corpse with no diedAt alone rather than guessing', () => {
    // Absence of diedAt is not evidence the window has passed, and
    // canCreateNewEgg accepts a corpse either way, so nobody is stuck.
    const out = applyOfflineDecay({
      form: 'corpse', hunger: 0, happiness: 0, difficulty: 'medium', petMode: true,
      diedAt: null, lastUpdatedAt: iso(30 * MIN),
    })
    expect(out.form).toBe('corpse')
  })

  it('🚨 promotes even with Pet Mode OFF — finishing a transition is not decay', () => {
    // A pet that died before its owner turned Pet Mode off must not be
    // stranded as a corpse by that switch.
    const out = applyOfflineDecay({
      form: 'corpse', hunger: 0, happiness: 0, difficulty: 'medium', petMode: false,
      diedAt: iso(CORPSE_TO_GHOST_MS + 5000), lastUpdatedAt: iso(30 * MIN),
    })
    expect(out.form).toBe('ghost')
  })
})

describe('🚨 A3(b) — Pet Mode OFF protects the pet while the app is closed', () => {
  // The live tick short-circuits on `if (!prev.petMode) return prev`; this
  // function never read petMode at all, so switching Pet Mode off did not pause
  // starvation — it DEFERRED the whole elapsed interval to the next launch, and
  // the pet could be found dead on reopening.
  it('applies no elapsed decay over six hours', () => {
    const before = adult(360, { petMode: false })
    const out = applyOfflineDecay(before)
    expect(out.hunger).toBe(100)
    expect(out.happiness).toBe(100)
    expect(out.form).toBe('adult')
    expect(out.lastUpdatedAt).toBe(before.lastUpdatedAt)
  })

  it('and the SAME pet with Pet Mode on does decay — the failing control', () => {
    const out = applyOfflineDecay(adult(10))
    // ⚠️ Precision 1, not 5. The fixture's anchor is built a few milliseconds
    // before the call, so the real elapsed time is always slightly more than
    // the nominal ten minutes — and at precision 5 that difference is larger
    // than the tolerance. A breaker run caught this pin going red under an
    // unrelated mutation, which is a flaky instrument, not a finding.
    expect(out.hunger).toBeCloseTo(100 - 10 * DECAY_RATES.medium.hunger, 1)
    expect(out.happiness).toBeCloseTo(100 - 10 * DECAY_RATES.medium.happiness, 1)
  })

  it('🚨 an ABSENT petMode still decays — `=== false`, not falsy', () => {
    // A row that predates the column, or a partial object, carries undefined.
    // Reading that as "off" would silently freeze a pet nobody asked to pause.
    const out = applyOfflineDecay(adult(10, { petMode: undefined }))
    expect(out.hunger).toBeLessThan(100)
  })

  it('does not resurrect a pet that starved before Pet Mode was turned off', () => {
    // hunger was already 0 at the anchor; the guard pauses decay, it does not
    // rewrite history. (The stored form is what the live tick left.)
    //
    // 🚨 R1: `hunger === 0` ALONE COULD NOT FAIL. With the gate removed the
    // function decays, kills the pet and still returns hunger 0 — the
    // assertion was true either way. The form and the happiness are what
    // distinguish "paused" from "ran and killed it".
    const out = applyOfflineDecay(adult(360, { petMode: false, hunger: 0 }))
    expect(out.hunger).toBe(0)
    expect(out.form).toBe('adult')
    expect(out.happiness).toBe(100)
    expect(out.diedAt).toBeNull()
  })

  it('🚨 R1: Pet Mode off pauses SLEEP-END too, not just decay', () => {
    // The commit states (b) as three properties and only one was asserted.
    // Moving the sleep block above the gate would have been green.
    const before = adult(30, { petMode: false, sleepingSince: iso(20 * MIN) })
    const out = applyOfflineDecay(before)
    expect(out.sleepingSince).toBe(before.sleepingSince)
    expect(out.lastSleptAt).toBe(before.lastSleptAt)
    expect(out.lastUpdatedAt).toBe(before.lastUpdatedAt)
  })

  it('🚨 R1: and EVOLUTION, so a baby cannot grow up while paused', () => {
    const before = {
      form: 'baby', breed: 'otter', difficulty: 'medium', petMode: false,
      hunger: 100, happiness: 100, bornAt: iso(EVOLVE_TIMES.medium + 5 * MIN),
      sleepingSince: null, lastSleptAt: iso(30 * MIN), interactionCount: 0,
      diedAt: null, evolvedAt: null, lastUpdatedAt: iso(MIN),
    }
    const out = applyOfflineDecay(before)
    expect(out.form).toBe('baby')
    expect(out.evolvedAt).toBeNull()
  })
})

describe('🚨 A3(c) — sleep ends and a baby grows while the app is shut', () => {
  it('ends a sleep that has run its course, deterministically', () => {
    const sleptFor = 10 * MIN
    const before = adult(10, { sleepingSince: iso(sleptFor), interactionCount: 15 })
    const out = applyOfflineDecay(before)
    expect(out.sleepingSince).toBeNull()
    expect(out.interactionCount).toBe(0)
    // The instant it WOKE, not `now` — otherwise every launch produces a
    // different pet and the "prime, do not save" rule stops being idempotent.
    const wokeAt = new Date(before.sleepingSince).getTime() + SLEEP_DURATIONS.medium
    expect(new Date(out.lastSleptAt).getTime()).toBe(wokeAt)
  })

  it('🚨 decays from the moment it WOKE, not from the moment it fell asleep', () => {
    const before = adult(10, { sleepingSince: iso(10 * MIN) })
    const out = applyOfflineDecay(before)
    // Awake for 10 min minus the 2-min sleep = 8 minutes of decay.
    const awakeMin = (10 * MIN - SLEEP_DURATIONS.medium) / MIN
    expect(out.hunger).toBeCloseTo(100 - awakeMin * DECAY_RATES.medium.hunger, 1)
  })

  it('leaves a pet still inside its sleep asleep, and immortal for now', () => {
    const before = adult(1, { sleepingSince: iso(30000) })
    const out = applyOfflineDecay(before)
    expect(out.sleepingSince).toBe(before.sleepingSince)
    expect(out.hunger).toBe(100)
    expect(out.state).toBe('sleeping')
    expect(out.lastUpdatedAt).toBe(before.lastUpdatedAt)
  })

  it('evolves a baby that has passed its evolution time', () => {
    const before = {
      form: 'baby', breed: 'otter', difficulty: 'medium', petMode: true,
      hunger: 100, happiness: 100, bornAt: iso(EVOLVE_TIMES.medium + 5 * MIN),
      sleepingSince: null, lastSleptAt: iso(30 * MIN), interactionCount: 0,
      diedAt: null, evolvedAt: null, lastUpdatedAt: iso(MIN),
    }
    const out = applyOfflineDecay(before)
    expect(out.form).toBe('adult')
    const evolvesAt = new Date(before.bornAt).getTime() + EVOLVE_TIMES.medium
    expect(new Date(out.evolvedAt).getTime()).toBe(evolvesAt)
  })

  it('🚨 and evolving is IDEMPOTENT across two cold starts', () => {
    // The load paths prime rather than save, so the stored row keeps the old
    // anchor and this runs again on the next launch from the same input. A
    // `new Date()` stamp here would produce a different pet every time.
    //
    // ⚠️ Comparing two calls to each other is NOT enough on its own: two calls
    // in the same millisecond agree even with a `now` stamp. The assertion that
    // discriminates is that the value is the birth-plus-evolve instant, which
    // is five minutes in the PAST — nothing stamped with `now` can be.
    const before = {
      form: 'baby', breed: 'otter', difficulty: 'medium', petMode: true,
      hunger: 100, happiness: 100, bornAt: iso(EVOLVE_TIMES.medium + 5 * MIN),
      sleepingSince: null, lastSleptAt: iso(30 * MIN), interactionCount: 0,
      diedAt: null, evolvedAt: null, lastUpdatedAt: iso(MIN),
    }
    const first = applyOfflineDecay(before).evolvedAt
    expect(applyOfflineDecay(before).evolvedAt).toBe(first)
    expect(new Date(first).getTime()).toBeLessThan(Date.now() - 4 * MIN)
  })

  it('🚨 a baby that starved does NOT also evolve', () => {
    const out = applyOfflineDecay({
      form: 'baby', breed: 'otter', difficulty: 'medium', petMode: true,
      hunger: 1, happiness: 10, bornAt: iso(EVOLVE_TIMES.medium + 5 * MIN),
      sleepingSince: null, lastSleptAt: iso(30 * MIN), interactionCount: 0,
      diedAt: null, evolvedAt: null, lastUpdatedAt: iso(10 * MIN),
    })
    expect(out.form).toBe('ghost')
    expect(out.evolvedAt).toBeNull()
  })
})

describe('🚨 A3 — the anchor moves with the values, and only with them', () => {
  // Migration 0068 refuses an UPDATE whose last_updated_at is older than the
  // stored row's, and App.jsx no longer stamps one on every save. So this
  // function is now the thing that decides whether a window's copy counts as
  // current — and an anchor that moved without the numbers moving would make a
  // stale window look up to date.
  it('moves it when decay was applied', () => {
    const before = adult(10)
    const out = applyOfflineDecay(before)
    expect(out.lastUpdatedAt).not.toBe(before.lastUpdatedAt)
    expect(new Date(out.lastUpdatedAt).getTime())
      .toBeGreaterThan(new Date(before.lastUpdatedAt).getTime())
  })

  it('🚨 leaves it alone for an egg — the form that cannot decay', () => {
    // This is what lets 0068 tell a window sitting on an old egg from one that
    // has kept up: the egg's anchor stays where the account put it.
    const before = {
      form: 'egg', breed: null, difficulty: 'medium', petMode: true,
      hunger: 0, happiness: 0, bornAt: null, sleepingSince: null,
      lastSleptAt: null, interactionCount: 0, diedAt: null, evolvedAt: null,
      lastUpdatedAt: iso(120 * MIN),
    }
    expect(applyOfflineDecay(before).lastUpdatedAt).toBe(before.lastUpdatedAt)
  })

  it('🚨 leaves it alone for a ghost — Audrey\'s own pet is one', () => {
    const before = adult(120, { form: 'ghost', hunger: 0, diedAt: iso(120 * MIN) })
    expect(applyOfflineDecay(before).lastUpdatedAt).toBe(before.lastUpdatedAt)
  })

  it('🚨 R1: an offline death stamps a COMPUTED instant, not `now`', () => {
    // lastSleptAt and evolvedAt were deterministic and diedAt was not, so each
    // cold start on the same stored row produced a different diedAt until
    // something happened to save — the one branch that broke the idempotence
    // the "prime, do not save" rule depends on.
    //
    // Hunger 10 at medium (0.67/min) reaches zero 14.9 minutes after the
    // anchor; the anchor here is two hours old, so the death is far in the
    // past and nothing stamped with `now` can land there.
    const before = adult(120, { hunger: 10, happiness: 10 })
    const out = applyOfflineDecay(before)
    expect(out.form).toBe('ghost')
    const anchorMs = new Date(before.lastUpdatedAt).getTime()
    const expected = anchorMs + (10 / DECAY_RATES.medium.hunger) * MIN
    expect(new Date(out.diedAt).getTime()).toBeCloseTo(expected, -3)
    expect(new Date(out.diedAt).getTime()).toBeLessThan(Date.now() - 60 * MIN)
    // And it is stable across two cold starts from the same stored row.
    expect(applyOfflineDecay(before).diedAt).toBe(out.diedAt)
  })

  it('an existing diedAt is never overwritten', () => {
    const before = adult(120, { hunger: 0, diedAt: iso(90 * MIN) })
    expect(applyOfflineDecay(before).diedAt).toBe(before.diedAt)
  })

  it('never mutates its input', () => {
    const before = adult(10)
    const copy = JSON.parse(JSON.stringify(before))
    applyOfflineDecay(before)
    expect(before).toEqual(copy)
  })
})
