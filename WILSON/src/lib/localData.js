// =============================================================================
// localData — Session 12 (gap #21): host-appropriate persistence for the
// three local-file stores the in-app Express server owns in Electron:
//
//   pet.json            → /api/pet*            → localStorage 'wilson.pet'
//   otter-settings.json → /api/otter-settings  → localStorage 'wilson.otter-settings'
//   agent-skills.json   → /api/agent-skills    → localStorage 'wilson.agent-skills'
//
// In Electron these keep hitting the same Express routes, byte-for-byte the
// same behavior as before. In a browser there is no Express server — the old
// code 404'd (or, on a static host, parsed index.html) and swallowed the
// error, which is exactly how O.T.T.E.R. rendered an empty library on the
// web.
//
// 🚨 SESSION 31 OVERTURNED THIS FILE'S FOUNDING ASSUMPTION, and the sentence
// that used to sit here is why it is worth saying loudly. It read: "Per-browser
// localStorage is the right web home for all three: they are per-machine
// preference/companion files, not workspace content." Audrey signed into the
// same account on a second computer, was asked to create a new pet, and that
// premise stopped being true.
//
// These stores are now a CACHE for the parts that follow the PERSON — the pet,
// the seven edited prompts, and the agent prompt overrides. `src/lib/userState.js`
// owns the authority (`public.user_pets` / `public.user_settings`, migration
// 0046) and fills this cache from the account on sign-in.
//
// ⚠️ NOTHING IN THIS FILE MAY ROUTE TO THE CLOUD, and that is deliberate rather
// than unfinished. `userState.resolveUserPet` reads the local pet THROUGH
// `loadPet` to decide whether to adopt it. If `loadPet` ever learned to reach
// Supabase, adoption would read the blank cloud row it is about to replace,
// copy it onto itself, and report success — the exact trap
// `src/cloud/migrate/runOtterMigration.js` documents in its own header.
//
// What genuinely stays per-machine, and must not be lifted into the account:
// `rabbit.adapterMode`, `rabbit.activeProjectId` and `storageLocation`. A saved
// disk path names a DIFFERENT folder on another computer, so carrying it points
// at the wrong content rather than sharing content.
//
// 🚨 A3 (2026-09-07): THE PET CACHE IS KEYED BY ACCOUNT, NOT BY MACHINE.
//
// It was one key per origin (`wilson.pet`) and one file per install
// (`otter-data/pet.json`, from a getDataDir() with no user segment), and
// nothing removed either on sign-out. `userState.resolveUserPet` reads that
// cache to decide whether to ADOPT it into the account — so on a shared
// computer person A's pet could be lifted into person B's account whenever B
// had no pet row of their own. Suite 56 proves an admin cannot read a member's
// pet through RLS; that handed one person's pet to another underneath RLS,
// through the filesystem.
//
// So the cache now names its owner: `wilson.pet.<userId>` on the web,
// `pet.<userId>.json` on the desktop, and sign-out deletes the copy belonging
// to the account that is leaving.
//
// ⚠️ AND THE UNATTRIBUTED COPY IS NO LONGER ADOPTABLE BY ANYBODY. The old
// `wilson.pet` / `pet.json` is still read when there is no signed-in user —
// that is the only case where it can only be one person's — but a cache that
// does not record who wrote it cannot be handed to an account safely, and
// there is no marker that would make it safe retrospectively. The file is left
// on disk rather than deleted; nothing reads it into an account any more.
//
// READERS resolve rather than throw, so a broken store degrades to defaults
// instead of taking a screen down.
//
// 🚨 THE THREE SAVERS NOW THROW — CHANGED IN SESSION 30, and this line used to
// say "every function resolves", which is what made the pet's failures
// invisible. `savePetData`, `saveOtterSettings` and `saveAgentSkills` did not
// check `res.ok` on their Express POST and `writeLocal` swallowed every
// localStorage exception, so App.jsx's `catch { /* silent */ }` could never
// fire even in principle. Three layers of silence over one lost pet.
// Callers must now handle a rejection and SHOW it.
//
// KNOWN GAP (accepted for v1, MASTER_PLAN §6): these are full-object
// last-writer-wins overwrites with no cross-tab sync. Two web tabs both
// running the pet's 30s decay/auto-save timers will clobber each other's
// writes — same class as the pre-existing Electron two-window case. The
// app is a one-window product; a 'storage'-event merge is deliberate
// future work, not an oversight.
// =============================================================================

import { defaultPet } from './petLifecycle'

export function hasLocalServer() {
  return typeof window !== 'undefined' && !!window.electronAPI
}

const PET_KEY = 'wilson.pet'
const OTTER_SETTINGS_KEY = 'wilson.otter-settings'
const AGENT_SKILLS_KEY = 'wilson.agent-skills'

function readLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

/**
 * Session 30: THROWS on failure instead of swallowing.
 *
 * It used to be `catch { /* storage disabled *\/ }`, which is not a rare edge:
 * localStorage throws QuotaExceededError when full, and is unavailable outright
 * in Safari private browsing and under some enterprise policies. Every one of
 * those looked exactly like a successful save, and the pet's whole state lives
 * here.
 *
 * The three savers below turn this into a message the user can read. Readers
 * still tolerate a broken store — see readLocal, which keeps returning the
 * fallback, because failing to READ a preference should not take the app down.
 */
function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (err) {
    throw new Error(
      err?.name === 'QuotaExceededError'
        ? 'This browser\'s storage is full, so the change could not be saved.'
        : 'This browser is blocking local storage, so the change could not be saved.')
  }
}

// ── Pet ──────────────────────────────────────────────────────────────────────

// The default egg now lives in petLifecycle.js beside the rules that mint one
// after a death, so there is ONE definition in the renderer. (electron/main.cjs
// keeps its own copy — it is CommonJS in the main process and cannot import
// this module.)

/**
 * The cache key for one account, or the unattributed one when signed out.
 *
 * 🚨 The desktop half is the SAME string: electron/main.cjs builds
 * `pet.<userId>.json` from the `user` query parameter, and refuses anything
 * that is not a UUID rather than joining it into a path. Both halves have to
 * agree, so the shape is written down in one place and the Express route
 * quotes this comment.
 */
export function petCacheKey(userId) {
  return userId ? PET_KEY + '.' + userId : PET_KEY
}

function petCacheQuery(userId) {
  return userId ? '?user=' + encodeURIComponent(userId) : ''
}

/**
 * GET /api/pet semantics.
 *
 * 🚨 THE TWO ARMS ANSWER DIFFERENT QUESTIONS, AND THAT IS DELIBERATE.
 *
 *   * With a userId — the account cache. Returns NULL when this account has
 *     never been cached on this machine, and mints nothing. Minting here would
 *     hand `resolveUserPet` a pristine egg to reason about on every first
 *     sign-in, and would flash a blank egg on screen before the real pet
 *     arrives.
 *   * Without one — the unattributed store, unchanged since Session 12: it
 *     always yields a pet, minting the default egg. That is what a signed-out
 *     or local-only session reads, and nothing adopts it into an account.
 */
export async function loadPet(userId = null) {
  if (hasLocalServer()) {
    const res = await fetch('/api/pet' + petCacheQuery(userId))
    // 404 is the account arm's "nothing cached here yet". It is not an error
    // and must not be reported as one — a first sign-in on a new computer is
    // the ordinary case.
    if (userId && res.status === 404) return null
    if (!res.ok) {
      const detail = await res.json().then(b => b?.error).catch(() => null)
      throw new Error(detail || `The pet could not be loaded (HTTP ${res.status}).`)
    }
    return res.json()
  }
  const key = petCacheKey(userId)
  let pet = readLocal(key, null)
  if (userId) return pet
  if (!pet) {
    pet = defaultPet()
    // Seeding the default egg is a cache write, not the user's data — a broken
    // store must not stop the app producing a pet. The next real save reports
    // the problem properly.
    try { writeLocal(key, pet) } catch { /* reported on first save */ }
  }
  return pet
}

/**
 * Forget one account's cached pet. Called on sign-out so the next person at
 * this computer cannot be handed the previous one's — the filesystem half of
 * the leak `resolveUserPet` used to close nothing about.
 *
 * Never throws: a sign-out must not be blocked by a cache that will not
 * cooperate. Returns whether the copy is known to be gone, so the caller can
 * say something if it is not.
 */
export async function clearPetCache(userId) {
  if (!userId) return false
  try {
    if (hasLocalServer()) {
      const res = await fetch('/api/pet' + petCacheQuery(userId), { method: 'DELETE' })
      return res.ok
    }
    localStorage.removeItem(petCacheKey(userId))
    return true
  } catch {
    return false
  }
}

/** POST /api/pet semantics: overwrite the stored pet for this account. */
export async function savePetData(pet, userId = null) {
  if (hasLocalServer()) {
    // 🚨 S30: `fetch` RESOLVES for every status. This `await` used to stand
    // alone, so a 404, a 500 or an Express server that had not started yet all
    // returned normally and App.jsx's catch could never fire — three layers of
    // silence over one lost pet. Same defect the Validator's "Accept Fix" had
    // (see Validator.jsx applyFix), found the same way.
    const res = await fetch('/api/pet' + petCacheQuery(userId), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pet),
    })
    if (!res.ok) {
      const detail = await res.json().then(b => b?.error).catch(() => null)
      throw new Error(detail || `The pet could not be saved (HTTP ${res.status}).`)
    }
    return
  }
  writeLocal(petCacheKey(userId), pet)
}

// 🚨 `newPetEgg()` IS GONE — Phase 3, 2026-08-12. It decided eligibility by
// re-reading a PER-DEVICE store, which is the bug Audrey reported: the same
// account, the same dead pet, worked on one computer and did nothing on
// another. Its replacement is canCreateNewEgg()/mintEggFrom() in
// petLifecycle.js — pure functions that judge the pet App.jsx is holding —
// and the write goes through savePet(), the one caller that routes by ACCOUNT
// rather than by `window.electronAPI`.
//
// It also fabricated `'Pet must be a ghost to create new egg'` for EVERY
// non-ok HTTP status, so a 500 from a full disk reported a lifecycle rule.
//
// `POST /api/pet/new-egg` was removed from electron/main.cjs in the same
// change; this was its only caller.

// ── O.T.T.E.R. settings (prompts, storage location, companion name, and the
//    rabbit/agentSkills slices SettingsPage stows here) ──────────────────────

/** GET /api/otter-settings semantics. `{}` when nothing is stored yet. */
export async function loadOtterSettings() {
  if (hasLocalServer()) {
    const res = await fetch('/api/otter-settings')
    if (!res.ok) throw new Error('Server not ready')
    return res.json()
  }
  return readLocal(OTTER_SETTINGS_KEY, {})
}

/** POST /api/otter-settings semantics: full-object overwrite (callers merge). */
export async function saveOtterSettings(settings) {
  if (hasLocalServer()) {
    // S30: same unchecked `await` as savePetData had. See the note there.
    const res = await fetch('/api/otter-settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
    if (!res.ok) {
      const detail = await res.json().then(b => b?.error).catch(() => null)
      throw new Error(detail || `Settings could not be saved (HTTP ${res.status}).`)
    }
    return
  }
  writeLocal(OTTER_SETTINGS_KEY, settings ?? {})
}

// ── Agent skills (per-tool prompt overrides) ─────────────────────────────────

/** GET /api/agent-skills semantics. `{}` default. */
export async function loadAgentSkills() {
  if (hasLocalServer()) {
    const res = await fetch('/api/agent-skills')
    const data = await res.json().catch(() => ({}))
    return data && typeof data === 'object' ? data : {}
  }
  return readLocal(AGENT_SKILLS_KEY, {})
}

/** POST /api/agent-skills semantics: full-object overwrite. */
export async function saveAgentSkills(skills) {
  if (hasLocalServer()) {
    // S30: same unchecked `await` as savePetData had. See the note there.
    const res = await fetch('/api/agent-skills', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(skills ?? {}),
    })
    if (!res.ok) {
      const detail = await res.json().then(b => b?.error).catch(() => null)
      throw new Error(detail || `Agent skills could not be saved (HTTP ${res.status}).`)
    }
    return
  }
  writeLocal(AGENT_SKILLS_KEY, skills ?? {})
}
