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

/** GET /api/pet semantics: always yields a pet, minting the default egg. */
export async function loadPet() {
  if (hasLocalServer()) {
    const res = await fetch('/api/pet')
    return res.json()
  }
  let pet = readLocal(PET_KEY, null)
  if (!pet) {
    pet = defaultPet()
    // Seeding the default egg is a cache write, not the user's data — a broken
    // store must not stop the app producing a pet. The next real save reports
    // the problem properly.
    try { writeLocal(PET_KEY, pet) } catch { /* reported on first save */ }
  }
  return pet
}

/** POST /api/pet semantics: overwrite the stored pet. */
export async function savePetData(pet) {
  if (hasLocalServer()) {
    // 🚨 S30: `fetch` RESOLVES for every status. This `await` used to stand
    // alone, so a 404, a 500 or an Express server that had not started yet all
    // returned normally and App.jsx's catch could never fire — three layers of
    // silence over one lost pet. Same defect the Validator's "Accept Fix" had
    // (see Validator.jsx applyFix), found the same way.
    const res = await fetch('/api/pet', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pet),
    })
    if (!res.ok) {
      const detail = await res.json().then(b => b?.error).catch(() => null)
      throw new Error(detail || `The pet could not be saved (HTTP ${res.status}).`)
    }
    return
  }
  writeLocal(PET_KEY, pet)
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
