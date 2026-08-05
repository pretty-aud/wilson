// =============================================================================
// userState — the pet and personal settings, per PERSON, in the cloud (0046).
//
// Audrey signed into the same account on a second computer and was asked to
// create a new pet. Nothing was broken: `localData.js` is per-device by
// construction and says so in its own header. This module is the seam between
// those per-device stores and the two per-user tables migration 0046 adds.
//
// -----------------------------------------------------------------------------
// WHY THIS IS A PLAIN MODULE AND NOT AN ADAPTER METHOD
// -----------------------------------------------------------------------------
// There is no app-wide adapter layer to plug into — R.A.B.B.I.T. and O.T.T.E.R.
// have two separate seams with different backend predicates and different error
// contracts, and the pet belongs to neither tool. The one existing per-user
// cloud store, `user_model_overrides`, is written by src/lib/modelSources.js:
// a plain module importing `supabase` directly, bypassing selectAdapter,
// adapterMode and COLUMN_ALLOWLIST. That is the house precedent and this
// follows it.
//
// -----------------------------------------------------------------------------
// 🚨 CACHE-PLUS-CLOUD, NEVER A MODE SWITCH
// -----------------------------------------------------------------------------
// `localData.js` and `otterFetch` are MODE SWITCHES: `if (host) { … } else { … }`,
// with no path that tries one and falls back to the other. That shape is
// exactly why signing in on the desktop app empties the O.T.T.E.R. library —
// the local data is not consulted again, so it reads as deleted.
//
// This module is the modelSources shape instead: local stays the cache and
// renders instantly, cloud overwrites it when it answers, and a FAILED cloud
// read leaves the cached value alone rather than blanking it.
//
// -----------------------------------------------------------------------------
// 🚨 THE ADOPTION TRAP, WHICH HAS ALREADY BITTEN THIS CODEBASE ONCE
// -----------------------------------------------------------------------------
// src/cloud/migrate/runOtterMigration.js documents it verbatim: a migration
// runner must read with RAW fetch, never the routed one, because the routed one
// goes to the cloud exactly when a migration runs — so it copies the cloud onto
// itself and reports success.
//
// The same trap is one edit away here. `localData.loadPet()` is deliberately
// LEFT ALONE — it is not taught to route to Supabase — precisely so that the
// adoption step below reads the local pet and cannot accidentally read the
// blank cloud row it is about to replace. If a later session adds cloud routing
// inside localData.js, adoption silently becomes a no-op that reports success.
// =============================================================================

import { supabase } from '../cloud/auth/supabaseClient'
import { loadPet as loadLocalPet, savePetData as saveLocalPetData,
         loadOtterSettings, saveOtterSettings,
         loadAgentSkills, saveAgentSkills } from './localData'

// Who is signed in, as far as this module is concerned. App.jsx's identity
// effect owns it. It exists so the settings writers can no-op when signed out
// WITHOUT calling supabase.auth.getSession() — that contends on auth-js's
// global per-storageKey lock, which one hung call can pin for the whole app
// (see docs/OUTSTANDING.md, "One hung getSession()").
let currentUserId = null
export function setUserStateOwner(userId) { currentUserId = userId || null }
export function getUserStateOwner() { return currentUserId }

const PET_TABLE = 'user_pets'
const SETTINGS_TABLE = 'user_settings'

// camelCase in the app, snake_case in Postgres. `state` is deliberately absent
// from both directions — it is derived by derivePetState on every read, and a
// stored copy could disagree with the row describing it (0046 §"state is
// deliberately absent").
const PET_FIELDS = [
  ['name', 'name'],
  ['gender', 'gender'],
  ['breed', 'breed'],
  ['form', 'form'],
  ['hunger', 'hunger'],
  ['happiness', 'happiness'],
  ['difficulty', 'difficulty'],
  ['petMode', 'pet_mode'],
  ['eggPetCount', 'egg_pet_count'],
  ['eggHatchThreshold', 'egg_hatch_threshold'],
  ['bornAt', 'born_at'],
  ['evolvedAt', 'evolved_at'],
  ['diedAt', 'died_at'],
  ['lastFedAt', 'last_fed_at'],
  ['lastPettedAt', 'last_petted_at'],
  ['lastSleptAt', 'last_slept_at'],
  ['sleepingSince', 'sleeping_since'],
  ['interactionCount', 'interaction_count'],
  ['lastUpdatedAt', 'last_updated_at'],
  ['feedback', 'feedback'],
  ['totalThumbsUp', 'total_thumbs_up'],
  ['totalThumbsDown', 'total_thumbs_down'],
]

const PET_SELECT = PET_FIELDS.map(([, col]) => col).join(',')

function toPetRow(pet) {
  const row = {}
  for (const [js, col] of PET_FIELDS) {
    let v = pet?.[js]
    if (v === undefined) continue
    // The columns are NOT NULL with defaults; sending an explicit null for one
    // of them would be rejected, so drop it and let the default stand.
    if (v === null && ['name', 'gender', 'form', 'hunger', 'happiness',
                       'difficulty', 'pet_mode', 'egg_pet_count',
                       'egg_hatch_threshold', 'interaction_count',
                       'last_updated_at', 'feedback', 'total_thumbs_up',
                       'total_thumbs_down'].includes(col)) continue
    row[col] = v
  }
  return row
}

function fromPetRow(row) {
  if (!row) return null
  const pet = {}
  for (const [js, col] of PET_FIELDS) pet[js] = row[col] ?? null
  // Numeric columns come back as numbers; timestamps as ISO strings, which is
  // what the app already stores. feedback is JSONB → array.
  if (!Array.isArray(pet.feedback)) pet.feedback = []
  return pet
}

/**
 * 🚨 THE ADOPTION DISCRIMINATOR, and it is not `lastUpdatedAt`.
 *
 * Every launch used to rewrite lastUpdatedAt (App.jsx's mount effect saved
 * unconditionally), so it cannot order two pets. And the app MINTS AND
 * PERSISTS a blank egg the first time it reads an empty store — on every host
 * it has ever run on — so "a local pet exists" is not evidence of anything.
 *
 * A pet counts as REAL if somebody has actually lived with it: it hatched
 * (bornAt), it grew past the egg, or it was interacted with. A pristine egg is
 * "nothing yet" and must never be uploaded, because a never-used second
 * computer signing in FIRST would otherwise overwrite the real pet on the
 * first one.
 */
export function isRealPet(pet) {
  if (!pet) return false
  return pet.bornAt != null
      || (pet.form && pet.form !== 'egg')
      || (pet.interactionCount || 0) > 0
}

/** Reads the signed-in user's pet. Returns null when they have no row yet. */
export async function fetchCloudPet() {
  const { data, error } = await supabase
    .from(PET_TABLE).select(PET_SELECT).maybeSingle()
  if (error) throw new Error(`[supabase] ${error.message}`)
  return fromPetRow(data)
}

/**
 * Writes the signed-in user's pet.
 *
 * `.select()` is not decoration. An RLS-refused write returns ZERO ROWS rather
 * than raising, so checking `error` alone reports success for a write that
 * never landed — the exact shape that made the Validator's "Accept Fix" show a
 * green tick over a 404 for twenty sessions.
 *
 * user_id is OMITTED so the column DEFAULT auth.uid() stamps it; the client
 * cannot file a pet against somebody else even if it tried.
 */
export async function saveCloudPet(pet) {
  const row = toPetRow(pet)
  const { data, error } = await supabase
    .from(PET_TABLE)
    .upsert(row, { onConflict: 'user_id' })
    .select('user_id')
  if (error) throw new Error(`[supabase] ${error.message}`)
  if (!data || data.length === 0) {
    throw new Error('Your pet was refused by the server (no row was written).')
  }
}

export async function fetchCloudSettings() {
  const { data, error } = await supabase
    .from(SETTINGS_TABLE).select('prompts,agent_prompt_overrides').maybeSingle()
  if (error) throw new Error(`[supabase] ${error.message}`)
  if (!data) return null
  return {
    prompts: data.prompts && typeof data.prompts === 'object' ? data.prompts : {},
    agentPromptOverrides:
      data.agent_prompt_overrides && typeof data.agent_prompt_overrides === 'object'
        ? data.agent_prompt_overrides : {},
  }
}

export async function saveCloudSettings({ prompts, agentPromptOverrides }) {
  const row = {}
  if (prompts !== undefined) row.prompts = prompts ?? {}
  if (agentPromptOverrides !== undefined) row.agent_prompt_overrides = agentPromptOverrides ?? {}
  if (Object.keys(row).length === 0) return
  const { data, error } = await supabase
    .from(SETTINGS_TABLE)
    .upsert(row, { onConflict: 'user_id' })
    .select('user_id')
  if (error) throw new Error(`[supabase] ${error.message}`)
  if (!data || data.length === 0) {
    throw new Error('Your settings were refused by the server (no row was written).')
  }
}

/**
 * Resolve which pet this person should be looking at, adopting the local one
 * the first time they sign in on a machine that has one.
 *
 * The rules, stated here because a silent wrong answer destroys something the
 * user likes:
 *
 *   1. A REAL cloud pet always wins. Once the account has a pet, that is the
 *      pet, on every computer.
 *   2. No real cloud pet + a REAL local pet → upload the local one. This is
 *      Audrey's case: Ollie has lived on this machine since 16 July.
 *   3. Neither is real → keep whatever the cloud has, or seed from local so the
 *      row exists. A pristine egg is never uploaded over anything.
 *
 * ⚠️ There is deliberately no "both are real, pick the newer" branch. Rule 1
 * makes it unreachable, and a timestamp comparison here would be reading
 * `lastUpdatedAt`, which historical launches have already overwritten.
 */
export async function resolveUserPet() {
  const cloud = await fetchCloudPet()
  if (isRealPet(cloud)) return { pet: cloud, source: 'cloud', adopted: false }

  // RAW local read — see the adoption-trap note at the top of this file.
  let local = null
  try { local = await loadLocalPet() } catch { /* a broken cache is not fatal */ }

  if (isRealPet(local)) {
    await saveCloudPet(local)
    return { pet: local, source: 'local', adopted: true }
  }

  if (cloud) return { pet: cloud, source: 'cloud', adopted: false }

  if (local) {
    await saveCloudPet(local)
    return { pet: local, source: 'local', adopted: false }
  }
  return { pet: null, source: 'none', adopted: false }
}

/**
 * Same shape for settings. The cloud row wins where it has content; otherwise
 * the local prompts and agent overrides are lifted into it once.
 *
 * ⚠️ What is deliberately NOT carried, all measured 2026-08-05: adapterMode and
 * activeProjectId (machine state), storageLocation and defaultRootDir (local
 * filesystem paths that name a DIFFERENT folder on another computer),
 * departments (workspace data edited from two screens), and companionName
 * (a duplicate of the pet's own name with zero readers).
 */
export async function resolveUserSettings() {
  const cloud = await fetchCloudSettings()
  const hasCloud = cloud
    && (Object.keys(cloud.prompts).length > 0
        || Object.keys(cloud.agentPromptOverrides).length > 0)
  if (hasCloud) return { settings: cloud, adopted: false }

  let prompts = {}
  let agentPromptOverrides = {}
  try {
    const s = await loadOtterSettings()
    if (s?.prompts && typeof s.prompts === 'object') prompts = s.prompts
  } catch { /* cache unavailable */ }
  try {
    const a = await loadAgentSkills()
    if (a && typeof a === 'object') agentPromptOverrides = a
  } catch { /* cache unavailable */ }

  if (Object.keys(prompts).length === 0
      && Object.keys(agentPromptOverrides).length === 0) {
    return { settings: cloud ?? { prompts: {}, agentPromptOverrides: {} }, adopted: false }
  }

  await saveCloudSettings({ prompts, agentPromptOverrides })
  return { settings: { prompts, agentPromptOverrides }, adopted: true }
}

/**
 * Mirror the authoritative pet back into the per-device cache so the next cold
 * start renders instantly and a signed-out or offline session still shows
 * something true. Never throws: a failed cache write must not surface as "your
 * pet was not saved" when the cloud write succeeded.
 */
export async function mirrorPetToCache(pet) {
  try { await saveLocalPetData(pet) } catch { /* cache only */ }
}

/**
 * Write the account's settings into the per-device cache, so that every
 * EXISTING reader picks them up without being rewritten.
 *
 * This is the whole reason the settings half needs no changes in Otter.jsx's
 * prompt editor or AgentProvider: they already read `loadOtterSettings()` and
 * `loadAgentSkills()` on mount. Filling the cache from the account on sign-in
 * makes those reads return the person's settings on any computer.
 *
 * ⚠️ saveOtterSettings is a WHOLE-OBJECT overwrite, so the current document has
 * to be read and merged — writing `{ prompts }` alone would silently drop the
 * machine-specific keys (adapterMode, activeProjectId) that deliberately do NOT
 * travel and must survive locally.
 */
export async function mirrorSettingsToCache({ prompts, agentPromptOverrides }) {
  try {
    const current = await loadOtterSettings()
    await saveOtterSettings({
      ...(current && typeof current === 'object' ? current : {}),
      prompts: { ...(current?.prompts ?? {}), ...(prompts ?? {}) },
    })
  } catch { /* cache only — the account copy is still authoritative */ }
  try {
    if (agentPromptOverrides && Object.keys(agentPromptOverrides).length > 0) {
      await saveAgentSkills(agentPromptOverrides)
    }
  } catch { /* cache only */ }
}

/**
 * Push the per-device settings up to the account after the user edits them.
 *
 * 🚨 THIS FUNCTION IS THE REASON THE SETTINGS HALF IS NOT DEAD CODE. It was
 * written, tested and had ZERO CALLERS on first pass — the sixth instance in
 * this repo of a complete feature nothing reaches, in the session whose own
 * brief warned about it five times. Its callers are Otter.jsx's `saveSettings`
 * (the only writer of `prompts`) and SettingsPage's `handlePromptOverrideChange`
 * (the only writer of the agent overrides). `userStateWiring.test.js` fails if
 * either call is removed.
 *
 * No-ops when signed out rather than throwing: editing a prompt on a local-only
 * install is legitimate and must not raise.
 */
export async function pushSettingsToCloud() {
  if (!currentUserId) return
  let prompts = {}
  let agentPromptOverrides = {}
  try {
    const s = await loadOtterSettings()
    if (s?.prompts && typeof s.prompts === 'object') prompts = s.prompts
  } catch { /* fall through with what we have */ }
  try {
    const a = await loadAgentSkills()
    if (a && typeof a === 'object') agentPromptOverrides = a
  } catch { /* fall through */ }
  await saveCloudSettings({ prompts, agentPromptOverrides })
}
