// =============================================================================
// petLifecycle.js — Phase 3 (2026-08-12).
//
// The egg-after-a-death rules, as PURE FUNCTIONS with no I/O and no store.
//
// 🚨 WHY THIS MODULE EXISTS, AND WHY IT TOUCHES NO STORAGE.
//
// `newPetEgg()` used to live in localData.js and decided "may this person start
// a new pet?" by RE-READING a store — localStorage on the web, the Express
// `pet.json` on the desktop. Every part of that was wrong by S31:
//
//   1. Since S31 the pet follows the PERSON (one `user_pets` row per account).
//      The per-device store is a cache, and on a computer that has not held
//      this pet it is absent or stale. Audrey pressed Create Egg on one PC and
//      nothing happened; the same account on another PC worked.
//
//   2. `hasLocalServer()` (i.e. `window.electronAPI`) picked the branch, and
//      that predicate is TRUE FOR THE DESKTOP APP IN CLOUD MODE — the standing
//      repo rule. So a signed-in desktop user asked a local Express server
//      about a pet that lives in Supabase.
//
//   3. 🚨 THE ONE THAT INVALIDATES THE OBVIOUS FIX. An OFFLINE death is never
//      persisted to EITHER store. applyOfflineDecay() in App.jsx computes the
//      ghost in memory, and both load paths deliberately prime
//      petPersistedSigRef with the ghost's signature ("prime, do not save" —
//      that write was removed in S31 because startup writes are the two-computer
//      clobber, and userStateWiring.test.js pins its absence). So after a death
//      that happened while the app was closed, the SCREEN shows a ghost while
//      the device cache AND `public.user_pets` both still say 'adult'.
//
//      Re-pointing the old check at the account would therefore have thrown
//      just the same. The only source of truth that actually knows the pet is
//      dead is the in-memory pet React is already rendering.
//
// So eligibility is decided against the pet OBJECT the caller is holding, and
// persistence is left entirely to App.jsx's savePet(), which is the one place
// that routes correctly (account when signed in, per-device cache otherwise).
//
// Being pure is also what makes this testable: petLifecycle.test.js drives the
// real functions, rather than regex-matching a string in App.jsx source the way
// the guard that was supposed to catch this bug did.
// =============================================================================

/**
 * The forms that mean "this pet's life is over".
 *
 * 🚨 BOTH, NOT JUST 'ghost'. The old check demanded `form === 'ghost'` while
 * SettingsPage has always shown the button for `ghost || corpse`, so a pet
 * sitting in 'corpse' offered a button that could only ever refuse.
 *
 * And 'corpse' is reachable and STICKY: the live decay tick sets form='corpse'
 * (App.jsx), which is a material change and therefore persists immediately,
 * and only a 10-second setTimeout inside that same tick promotes it to 'ghost'.
 * Close, reload or sign out inside those 10 seconds and the corpse is saved
 * with no way out — applyOfflineDecay skips corpses and the decay tick skips
 * corpses, so nothing ever moves it again.
 *
 * Accepting 'corpse' here is what makes that state recoverable. Narrowing
 * SettingsPage to 'ghost' instead would have "matched" the two predicates by
 * leaving a stuck user with no control at all.
 */
export const DEAD_FORMS = Object.freeze(['corpse', 'ghost'])

/** A fresh egg. Mirror of defaultPet() in electron/main.cjs. */
export function defaultPet() {
  return {
    name: 'Ollie', gender: Math.random() < 0.5 ? 'male' : 'female',
    breed: null, form: 'egg',
    hunger: 0, happiness: 0,
    state: 'content', difficulty: 'medium', petMode: true,
    eggPetCount: 0, eggHatchThreshold: Math.floor(Math.random() * 3) + 2,
    bornAt: null, evolvedAt: null, diedAt: null,
    lastFedAt: null, lastPettedAt: null, lastSleptAt: null, sleepingSince: null,
    interactionCount: 0, lastUpdatedAt: new Date().toISOString(),
    feedback: [], totalThumbsUp: 0, totalThumbsDown: 0,
  }
}

/**
 * May this pet be replaced by a new egg?
 *
 * Takes the pet the caller is RENDERING. Callers must not re-read a store to
 * answer this — see the header.
 */
export function canCreateNewEgg(pet) {
  return !!pet && DEAD_FORMS.includes(pet.form)
}

/**
 * Mint the replacement egg from a dead pet.
 *
 * 🚨 THE CARRY-OVER IS THE POINT. `difficulty` and the whole feedback history
 * (with both thumb totals) are the pet's memory of Audrey; a new egg that
 * forgot them would read as data loss, and she would notice immediately.
 *
 * ⚠️ `petMode` is deliberately NOT carried, matching the behaviour this
 * replaces: a new egg always starts with the companion on.
 *
 * Returns a NEW object; the input is never mutated.
 */
export function mintEggFrom(oldPet) {
  const pet = defaultPet()
  if (oldPet) {
    if (oldPet.difficulty) pet.difficulty = oldPet.difficulty
    pet.feedback = Array.isArray(oldPet.feedback) ? [...oldPet.feedback] : []
    pet.totalThumbsUp = oldPet.totalThumbsUp || 0
    pet.totalThumbsDown = oldPet.totalThumbsDown || 0
  }
  return pet
}

// =============================================================================
// Track A, bundle A3 (2026-09-07) — THE DEATH TRIO MOVES IN HERE.
//
// 🚨 WHY applyOfflineDecay AND ITS TABLES LEFT App.jsx.
//
// They were module-level functions inside a 2299-line component file, so the
// only way to test them was to read App.jsx as a STRING and match a regex.
// That is the instrument the A2 session found wrong three times in one
// sitting, and this module's own header already says why it exists: "Being
// pure is also what makes this testable: petLifecycle.test.js drives the real
// functions, rather than regex-matching a string in App.jsx source the way the
// guard that was supposed to catch this bug did."
//
// Bundle A3 changes three of applyOfflineDecay's rules at once (corpse
// promotion, Pet Mode, sleep and evolution). Changing them where they can only
// be pinned by regex was not defensible, so they moved to where the rest of the
// lifecycle rules already live. Nothing else about them changed in the move;
// App.jsx imports them and the live 30-second tick still uses the same tables.
//
// ⚠️ THE LIVE TICK IS STILL A SEPARATE ALGORITHM and still lives in App.jsx.
// It runs inside a setPetData reducer, drives four pieces of animation state
// and schedules the corpse→ghost timeout, so it is not pure. The two are kept
// in step by sharing these tables and CORPSE_TO_GHOST_MS rather than by being
// one function.
// =============================================================================

/**
 * Per-minute decay, by difficulty. Shared with App.jsx's live tick, which
 * applies them per 30-second tick (perTick = 0.5).
 */
export const DECAY_RATES = {
  low:    { hunger: 0.4,  happiness: 0.25 },
  medium: { hunger: 0.67, happiness: 0.5  },
  high:   { hunger: 1.2,  happiness: 1.0  }
}

/** How long a baby takes to become an adult, by difficulty. */
export const EVOLVE_TIMES = { low: 30 * 60000, medium: 20 * 60000, high: 10 * 60000 }

/** How long a sleep lasts, by difficulty. */
export const SLEEP_DURATIONS = { low: 3 * 60000, medium: 2 * 60000, high: 1 * 60000 }

/**
 * 🚨 THE PROMOTION WINDOW, IN ONE PLACE.
 *
 * The live tick sets form='corpse' and arms a setTimeout to promote it to
 * 'ghost'. That number used to be a bare `10000` inside the tick, and the load
 * path had no idea it existed — which is the whole of the "a pet saved as a
 * corpse never becomes a ghost" entry: close the app inside those ten seconds
 * and the corpse is the stored state forever, because applyOfflineDecay
 * excluded corpses and so did the tick.
 *
 * Both now read this constant, so the window cannot drift out of step.
 */
export const CORPSE_TO_GHOST_MS = 10000

/**
 * The pet's display state. Pure function of form / sleepingSince / hunger /
 * happiness, and deliberately NOT a stored column (0046: "a stored copy could
 * disagree with the row describing it").
 */
export function derivePetState(pet) {
  if (!pet) return 'content'
  if (pet.form === 'corpse' || pet.form === 'ghost') return 'dead'
  // 🚨 AN EGG IS NOT STARVING. Phase 3, 2026-08-12.
  //
  // Every egg is minted with `hunger: 0`, and the hunger ladder below turns
  // that into 'starving' — rendered in RED on Settings and as a sad face by the
  // sprite. So a brand-new egg announced itself as about to die, which is
  // exactly how somebody who has just replaced a pet that DID die would read
  // "the fix did not work".
  //
  // Eggs do not eat: the decay tick's first line returns early for 'egg', so
  // hunger never moves until it hatches.
  if (pet.form === 'egg') return 'content'
  if (pet.sleepingSince) return 'sleeping'
  if (pet.hunger <= 15) return 'starving'
  if (pet.hunger <= 40) return 'hungry'
  if (pet.happiness <= 30) return 'lonely'
  return 'content'
}

/**
 * Bring a stored pet up to date from elapsed time. Pure — returns a new object,
 * never mutates the input.
 *
 * 🚨 DECAY IS NOT PERSISTED ON A TIMER (S31). hunger and happiness are a value
 * AT AN ANCHOR (`lastUpdatedAt`), not raw state, so a pet nobody has touched
 * for a week needs no writes at all — the anchor stays put and this recomputes
 * the difference on the next read. Removing the 30-second whole-object
 * auto-save is what stops two signed-in computers overwriting each other; this
 * function is the half that makes that safe.
 *
 * ⚠️ The anchor is `lastUpdatedAt`, NOT `lastFedAt`. MEASURED 2026-08-05:
 * `lastFedAt` is written by handleFeed and read by NOTHING.
 *
 * -----------------------------------------------------------------------------
 * 🚨 A3: THIS FUNCTION NOW MOVES THE ANCHOR, AND THAT IS THE WHOLE POINT
 * -----------------------------------------------------------------------------
 * It used to change hunger and happiness and leave `lastUpdatedAt` where it
 * was. App.jsx's own comment records what that cost: mirroring the result to
 * the cache "writes decayed values against the ORIGINAL anchor and the next
 * launch decays the same interval again — the pet drifts dead-ward on every
 * sign-in". The invariant App.jsx states is that hunger/happiness and
 * lastUpdatedAt are only ever written TOGETHER; this function was the one place
 * that broke it and was worked around instead of fixed.
 *
 * It matters twice as much now. Migration 0068 refuses an UPDATE whose anchor
 * is older than the stored row's, and App.jsx no longer stamps a fresh anchor
 * on every save — so the anchor a client sends is the anchor it is holding. If
 * this function decayed a pet without moving the anchor, the next ordinary save
 * would write decayed values under a stale anchor and be refused for the wrong
 * reason.
 *
 * The rule, stated once: the anchor moves when, and only when, hunger or
 * happiness moved. A load that applies no decay leaves it alone, which is what
 * lets 0068 tell a window that has been sitting on an old copy from one that
 * has genuinely kept up.
 *
 * ⚠️ Still "prime, do not save" at both call sites. An offline death or an
 * offline evolution computed here is idempotent — the stored row keeps the old
 * anchor, so the next load recomputes exactly the same result from exactly the
 * same input — so persisting it would put a write back into app startup, which
 * is the two-computer clobber S31 removed. The deterministic instants used for
 * `evolvedAt` and `lastSleptAt` below are what make that true; stamping them
 * with `now` would make every launch produce a different pet.
 */
export function applyOfflineDecay(input) {
  const pet = { ...input }
  const now = Date.now()

  // ── (a) THE CORPSE THAT NEVER BECAME A GHOST ───────────────────────────────
  //
  // The live tick sets form='corpse' — a material change, so it persists
  // immediately — and only a setTimeout inside that same tick promotes it.
  // Close, reload or sign out inside the window and nothing ever moves it
  // again: this function used to exclude corpses and the tick still does.
  // Phase 3 made the state RECOVERABLE (canCreateNewEgg accepts a corpse) but
  // left the state machine stalled, so a person who does not press Create Egg
  // has no way forward. Completing the transition on load is A3's ruling 6.
  //
  // 🚨 Deliberately ABOVE the Pet Mode gate. Finishing a transition that has
  // already happened is not decay, and a pet that died before its owner turned
  // Pet Mode off must not be stranded as a corpse by that switch.
  //
  // ⚠️ A corpse with no diedAt is left alone rather than promoted on the spot:
  // it is not evidence the window has passed, and canCreateNewEgg accepts a
  // corpse either way, so nobody is stuck.
  if (pet.form === 'corpse' && pet.diedAt) {
    const since = now - new Date(pet.diedAt).getTime()
    if (Number.isFinite(since) && since >= CORPSE_TO_GHOST_MS) pet.form = 'ghost'
  }

  // ── (b) PET MODE OFF PROTECTS THE PET WHILE THE APP IS CLOSED ──────────────
  //
  // The live tick short-circuits on `if (!prev.petMode) return prev`; this
  // function never read petMode at all, so switching Pet Mode off did not pause
  // starvation — it DEFERRED the whole elapsed interval to the next launch, and
  // the pet could be found dead on reopening. Audrey's ruling 6.
  //
  // Mirroring the tick means mirroring all of it: no decay, no sleep-end, no
  // evolution. A sleeping pet with Pet Mode off stays asleep, exactly as it
  // does with the app open.
  //
  // ⚠️ `=== false`, not `!pet.petMode`. A pet row that predates the column, or
  // a partial object, carries `undefined` — and defaulting that to "off" would
  // silently freeze a pet nobody asked to pause.
  const petModeOff = pet.petMode === false

  if (!petModeOff
      && pet.lastUpdatedAt
      && pet.form !== 'egg' && pet.form !== 'corpse' && pet.form !== 'ghost') {
    let anchor = new Date(pet.lastUpdatedAt).getTime()
    let moved = false

    // ── (c) SLEEP ENDS WHILE THE APP IS SHUT ─────────────────────────────────
    //
    // Decay is skipped while `sleepingSince` is set, and nothing offline ever
    // cleared it — so a pet asleep at close was IMMORTAL, however long the app
    // stayed shut. The live tick ends a sleep after SLEEP_DURATIONS; this
    // mirrors it, and then decays from the moment it woke rather than from the
    // moment it fell asleep.
    if (pet.sleepingSince) {
      const dur = SLEEP_DURATIONS[pet.difficulty] || SLEEP_DURATIONS.medium
      const wokeAt = new Date(pet.sleepingSince).getTime() + dur
      if (Number.isFinite(wokeAt) && now >= wokeAt) {
        pet.sleepingSince = null
        // The instant it woke, not `now`: see the idempotence note above.
        pet.lastSleptAt = new Date(wokeAt).toISOString()
        pet.interactionCount = 0
        if (wokeAt > anchor) anchor = wokeAt
        moved = true
      }
    }

    if (!pet.sleepingSince) {
      const elapsed = (now - anchor) / 60000
      if (elapsed > 0) {
        const rates = DECAY_RATES[pet.difficulty] || DECAY_RATES.medium
        const babyMult = pet.form === 'baby' ? 2 : 1
        pet.hunger = Math.max(0, pet.hunger - elapsed * rates.hunger * babyMult)
        pet.happiness = Math.max(0, pet.happiness - elapsed * rates.happiness * babyMult)
        moved = true
      }
    }

    if (pet.hunger <= 0) {
      // Offline death goes STRAIGHT to 'ghost' — unchanged from S31. The
      // corpse stage exists so the live tick can play a ten-second animation,
      // and there is nobody watching an app that is shut.
      pet.form = 'ghost'
      pet.diedAt = pet.diedAt || new Date(now).toISOString()
      pet.hunger = 0
      moved = true
    }

    // ── (d) A BABY GROWS UP WHILE THE APP IS SHUT ────────────────────────────
    //
    // The live tick evolves a baby after EVOLVE_TIMES from bornAt; offline it
    // did not, so a baby could not grow while the app was closed. Mirrored
    // here, AFTER the death check so a pet that starved does not also evolve.
    if (pet.form === 'baby' && pet.bornAt) {
      const evolveTime = EVOLVE_TIMES[pet.difficulty] || EVOLVE_TIMES.medium
      const evolvesAt = new Date(pet.bornAt).getTime() + evolveTime
      if (Number.isFinite(evolvesAt) && now >= evolvesAt) {
        pet.form = 'adult'
        // Deterministic, for the same reason as lastSleptAt above.
        pet.evolvedAt = new Date(evolvesAt).toISOString()
        moved = true
      }
    }

    // 🚨 The anchor and the values it describes, written together — the
    // invariant this whole design rests on. See the header.
    if (moved) pet.lastUpdatedAt = new Date(now).toISOString()
  }

  if (pet.form !== 'egg' && !pet.breed) pet.breed = 'otter'
  pet.state = derivePetState(pet)
  return pet
}
