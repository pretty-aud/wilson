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
// web. Per-browser localStorage is the right web home for all three: they
// are per-machine preference/companion files, not workspace content (the
// S11 Sidebar-collapse precedent).
//
// Every function resolves rather than throws where the old call sites
// swallowed errors — callers keep their existing error handling.
//
// KNOWN GAP (accepted for v1, MASTER_PLAN §6): these are full-object
// last-writer-wins overwrites with no cross-tab sync. Two web tabs both
// running the pet's 30s decay/auto-save timers will clobber each other's
// writes — same class as the pre-existing Electron two-window case. The
// app is a one-window product; a 'storage'-event merge is deliberate
// future work, not an oversight.
// =============================================================================

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

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch { /* storage disabled */ }
}

// ── Pet ──────────────────────────────────────────────────────────────────────

// Mirror of defaultPet() in electron/main.cjs — the web build has no main
// process, so the default egg is minted client-side.
function defaultPet() {
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

/** GET /api/pet semantics: always yields a pet, minting the default egg. */
export async function loadPet() {
  if (hasLocalServer()) {
    const res = await fetch('/api/pet')
    return res.json()
  }
  let pet = readLocal(PET_KEY, null)
  if (!pet) {
    pet = defaultPet()
    writeLocal(PET_KEY, pet)
  }
  return pet
}

/** POST /api/pet semantics: overwrite the stored pet. */
export async function savePetData(pet) {
  if (hasLocalServer()) {
    await fetch('/api/pet', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pet),
    })
    return
  }
  writeLocal(PET_KEY, pet)
}

/** POST /api/pet/new-egg semantics: ghost → fresh egg, feedback carries over. */
export async function newPetEgg() {
  if (hasLocalServer()) {
    const res = await fetch('/api/pet/new-egg', { method: 'POST' })
    if (!res.ok) throw new Error('Pet must be a ghost to create new egg')
    return res.json()
  }
  const old = readLocal(PET_KEY, null)
  if (!old || old.form !== 'ghost') {
    throw new Error('Pet must be a ghost to create new egg')
  }
  const pet = defaultPet()
  pet.difficulty = old.difficulty
  pet.feedback = old.feedback || []
  pet.totalThumbsUp = old.totalThumbsUp || 0
  pet.totalThumbsDown = old.totalThumbsDown || 0
  writeLocal(PET_KEY, pet)
  return pet
}

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
    await fetch('/api/otter-settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
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
    await fetch('/api/agent-skills', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(skills ?? {}),
    })
    return
  }
  writeLocal(AGENT_SKILLS_KEY, skills ?? {})
}
