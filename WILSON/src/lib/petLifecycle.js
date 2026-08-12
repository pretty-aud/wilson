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
