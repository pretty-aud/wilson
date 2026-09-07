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
import { defaultPet } from './petLifecycle'
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

/**
 * Migration 0068's SQLSTATE for "this copy of the pet is older than the one
 * already saved". ONE definition, because the client's whole response to it —
 * do not retry, re-read, say "refreshed" — hangs on recognising it.
 */
export const PET_STALE_WRITE_CODE = 'WP001'

/**
 * Was this failure 0068's stale-write refusal?
 *
 * Matches the SQLSTATE first and the message token second. The token exists
 * because a transport that drops `code` (a fetch shim, a future client) would
 * otherwise turn a refusal into "your pet could not be saved" — the wrong
 * message and the wrong recovery. 0009's `RAISE EXCEPTION 'slug_taken'` is the
 * precedent for a message that is meant to be read by a program.
 */
export function isStalePetWrite(err) {
  if (!err) return false
  if (err.code === PET_STALE_WRITE_CODE) return true
  return typeof err.message === 'string' && err.message.includes('pet_stale_write')
}

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
      // 🚨 PHASE 3 (2026-08-12): AN EGG THAT CARRIES A HISTORY IS A REAL PET.
      //
      // The three clauses above call EVERY egg "nothing yet", and that is right
      // for the blank egg loadPet() mints on an empty store — the whole point of
      // this predicate. But the egg mintEggFrom() creates after a death is also
      // an egg, and it is the opposite of "nothing yet": it is the continuation
      // of a pet Audrey has lived with, carrying her whole feedback history and
      // both thumb totals forward.
      //
      // Without this, her brand-new egg was "not real", so any other computer
      // signing in re-uploaded ITS stale dead pet over the top and the egg
      // vanished — the cross-machine half of the Create Egg bug.
      //
      // ⚠️ Deliberately NOT `difficulty !== 'medium'`: difficulty has a default
      // that a blank egg also carries, so it cannot distinguish anything.
      //
      // The S31 protection is untouched: a never-used computer's pet is
      // defaultPet(), whose feedback is [] and whose totals are 0, so it is
      // still "nothing yet" and still cannot beat anything.
      || (Array.isArray(pet.feedback) && pet.feedback.length > 0)
      || (pet.totalThumbsUp || 0) > 0
      || (pet.totalThumbsDown || 0) > 0
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
  if (error) {
    // 🚨 A3: THE SQLSTATE SURVIVES THE RE-THROW.
    //
    // Migration 0068 refuses a write whose decay anchor is older than the
    // stored row's, and the caller has to tell that ONE refusal apart from
    // every other failure — it must re-read instead of retrying, and it must
    // say "refreshed" rather than "could not be saved". Wrapping the message in
    // a bare Error threw the code away, so `code` is carried across.
    const wrapped = new Error(`[supabase] ${error.message}`)
    wrapped.code = error.code
    throw wrapped
  }
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
 *      pet, on every computer. (Phase 3 did not change this rule — it changed
 *      isRealPet, so that the egg minted after a death counts as real. It
 *      carries the dead pet's feedback history, so it is a continuation, not
 *      a blank.)
 *   2. No real cloud pet + a REAL local pet → upload the local one. This is
 *      Audrey's case: Ollie has lived on this machine since 16 July.
 *   3. Neither is real → keep whatever the cloud has. A pristine local egg is
 *      never uploaded over anything, and since Phase 3 it is not uploaded at
 *      all: seeding blank rows only created more not-real state to misread.
 *
 * ⚠️ There is deliberately no "both are real, pick the newer" branch. Rule 1
 * makes it unreachable, and a timestamp comparison here would be reading
 * `lastUpdatedAt`, which historical launches have already overwritten.
 */
export async function resolveUserPet(userId = null) {
  const cloud = await fetchCloudPet()

  // 🚨 THE ORDER HERE IS S31'S ORIGINAL AND MUST STAY THAT WAY — Phase 3 tried
  // twice to change it and was wrong both times. Recorded so nobody repeats it:
  //
  //   Attempt 1 hoisted an unconditional `if (cloud) return cloud` above the
  //   adoption branch, to stop a stale dead pet overwriting a new egg. That
  //   made rule 2 unreachable for any account whose row already existed.
  //
  //   Attempt 2 kept the hoist and merely stopped SEEDING a blank row,
  //   reasoning that "a row exists" would then mean "somebody deliberately
  //   saved a pet". THAT IS FALSE. savePet writes whatever it is handed, and
  //   five ordinary controls run while the pet is still a blank egg — the Pet
  //   Mode toggle, the difficulty buttons, Reset History, a companion
  //   thumbs-up, and PETTING THE EGG (eggHatchThreshold is 2–4, so the first
  //   click can never hatch it and always writes). One click on a second
  //   computer would have permanently shadowed the real pet on the first, and
  //   savePet's cache mirror would then have overwritten it on disk too.
  //
  // The real defect was never the ORDER — it was that isRealPet() could not
  // tell a blank egg from a deliberate one. That is fixed at isRealPet, above,
  // where the distinction actually lives: an egg carrying a feedback history is
  // real, a pristine one is not. With that, rule 1 short-circuits for Audrey's
  // new egg and no reordering is needed.
  if (isRealPet(cloud)) return { pet: cloud, source: 'cloud', adopted: false }

  // RAW local read — see the adoption-trap note at the top of this file.
  //
  // 🚨 A3: SCOPED TO THE ACCOUNT. `loadLocalPet(userId)` reads
  // `pet.<userId>.json` / `wilson.pet.<userId>` and returns null when this
  // account has never been cached here. Passing nothing would read the
  // unattributed store — which is how person A's pet could be adopted into
  // person B's account on a shared computer, underneath RLS, through the
  // filesystem. A cache that does not record its owner cannot be adopted
  // safely, so it is not read here at all.
  let local = null
  try { local = await loadLocalPet(userId) } catch { /* a broken cache is not fatal */ }

  // Rule 2: no REAL cloud pet + a REAL local pet → lift it up. This is the
  // pre-accounts migration case (Audrey's Ollie, resident since 16 July).
  if (isRealPet(local)) {
    try {
      await saveCloudPet(local)
    } catch (err) {
      // 🚨 0068 CAN REFUSE AN ADOPTION, AND THAT REFUSAL IS AN ANSWER.
      //
      // The cached copy carries the anchor it was cached with. If another
      // machine has written the account since, that anchor is older and the
      // guard rejects this upsert. Re-raising would turn "somebody else already
      // moved this pet on" into a sign-in error; the right reading is that the
      // account's copy wins, which is rule 1 arriving one step late.
      if (!isStalePetWrite(err)) throw err
      const fresh = await fetchCloudPet()
      return { pet: fresh ?? cloud, source: 'cloud', adopted: false }
    }
    return { pet: local, source: 'local', adopted: true }
  }

  if (cloud) return { pet: cloud, source: 'cloud', adopted: false }

  // 🚨 A PRISTINE EGG IS RETURNED BUT **NOT** UPLOADED — Phase 3.
  //
  // It used to be written to the account "so a row exists". Seeding bought
  // nothing — saveCloudPet upserts, so the row appears on the first real save
  // whenever that comes — and every blank row it created was one more chance
  // for a not-real pet to be mistaken for the account's own state.
  if (local) return { pet: local, source: 'local', adopted: false }

  // 🚨 R1 OF A3: A NEW ACCOUNT HAS TO GET A PET, AND FOR ONE COMMIT IT DID NOT.
  //
  // Before A3 this line was unreachable: `loadLocalPet()` read the
  // unattributed store, which ALWAYS minted, so `local` was always truthy.
  // Keying the cache by account made the account arm answer null for a machine
  // that has never held this account's pet — which is every first sign-in —
  // and nothing replaced the mint. The result was `{ pet: null }`, so
  // `petData` stayed null, App renders the companion as `{petData && …}`,
  // SettingsPage gates its whole Companion card the same way, and
  // `handleNewPet` refuses with "A new egg can only be created once your pet
  // has died." The pet was simply absent, on every launch, with no error.
  //
  // ⚠️ MINTED BUT NOT UPLOADED, which is Phase 3's rule and is why this is not
  // simply `saveCloudPet(defaultPet())`. Seeding blank rows bought nothing —
  // saveCloudPet upserts, so the row appears on the first real save — and
  // every blank row created was one more not-real pet for isRealPet to
  // misread. `source: 'new'` so a caller can tell a mint from a cache read.
  return { pet: defaultPet(), source: 'new', adopted: false }
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
 * Mirror the authoritative pet back into THIS ACCOUNT'S per-device cache, so
 * the next cold start on this computer renders instantly. Never throws: a
 * failed cache write must not surface as "your pet was not saved" when the
 * cloud write succeeded.
 *
 * ⚠️ A3: `userId` is not optional in practice. Called without one it writes the
 * unattributed store, which nothing adopts and which the account arm of
 * loadPet() never reads — so a missing argument here is a cache that is
 * silently never used again. App.jsx passes petUserIdRef.current at both call
 * sites and userStateWiring.test.js fails if either drops it.
 */
export async function mirrorPetToCache(pet, userId = null) {
  try { await saveLocalPetData(pet, userId) } catch { /* cache only */ }
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
