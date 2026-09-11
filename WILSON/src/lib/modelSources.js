// =============================================================================
// modelSources — fill the three override tiers from the database.
//
// S19 built the resolver and left the stores empty. S20's migration 0031 adds
// them: platform_model_defaults, workspace_model_overrides and
// user_model_overrides, plus platform_approved_models as the catalogue every
// picker reads. This module is the seam between those tables and
// `activeModel.js`.
//
// -----------------------------------------------------------------------------
// WHY THERE IS A CACHE
// -----------------------------------------------------------------------------
// Model resolution is SYNCHRONOUS — `modelFor(key)` reads module state and
// returns a string, because it is called from inside request-body literals at
// 20 call sites and from `runIngestion`, which is not a React component. The
// tiers, though, arrive from three async queries after sign-in.
//
// That gap is dangerous in a specific and quiet way: `resolveModel` warns when
// a CONFIGURED model is rejected, but an ABSENT tier is not a misconfiguration,
// so it returns `{ warning: null }`. A generation fired before the queries land
// therefore uses the built-in floor and says nothing — which is precisely the
// silent-wrong-model failure the registry was built to eliminate, reintroduced
// by the act of moving the settings into a database.
//
// So localStorage stops being the source of truth (it was, in S19) and becomes
// a CACHE of the last known good tiers, hydrated synchronously at startup. The
// database is authoritative and overwrites it as soon as it answers. This also
// preserves the property aiModels.js promises in its header — that the app runs
// with no database and no network — which a purely remote store would lose.
//
// -----------------------------------------------------------------------------
// RETIREMENT, AND WHY IT DOES NOT INVALIDATE A SAVED CHOICE
// -----------------------------------------------------------------------------
// Two things could mean "retired": the hardcoded RETIRED map in aiModels.js
// (models Anthropic has actually withdrawn) and `retired_at` on the catalogue
// (models Audrey no longer offers). They are not rivals:
//
//   RETIRED   -> the model will not answer. resolveModel falls back and warns.
//   retired_at -> stop OFFERING it in pickers. Anything already chosen keeps
//                 working, which is why 0031 retires softly and keeps the row
//                 readable.
//
// So a retired-by-the-operator model still resolves. That is the intent, not an
// oversight: pulling a model out of the catalogue should not break every
// company that had selected it, mid-sentence.
// =============================================================================

import { supabase } from '../cloud/auth/supabaseClient'
import { devFixtures, devWriteRefused } from '../dev/devFixtures'
import { withTimeout, AUTH_TIMEOUT_MS } from '../cloud/auth/withTimeout'
import { BY_KEY, isWellFormedModelId } from './aiModels'
import { updateModelSource, markModelSourcesLoaded, setPlatformEffort } from './activeModel'
import { loadUserModelPrefs } from './userModelPrefs'

const CACHE_KEY = 'wilson.modelSources.v1'
const CATALOGUE_CACHE_KEY = 'wilson.modelCatalogue.v1'
/** The S19 localStorage user tier, migrated once into the database. */
const LEGACY_MIGRATED_KEY = 'wilson.modelPrefs.migrated.v1'

/**
 * Keep only rows that name a known function and a well-formed model id.
 *
 * A key that is not in the REGISTRY is inert rather than harmful — every read
 * path looks keys up rather than iterating stored rows — but dropping it here
 * keeps the resolver's state honest and stops a renamed call site resurfacing
 * as a mystery override years later.
 */
function sanitise(rows) {
  const out = {}
  for (const row of rows ?? []) {
    const key = row?.registry_key
    const model = row?.model_id
    if (!key || !BY_KEY[key]) continue
    if (typeof model !== 'string' || !isWellFormedModelId(model)) continue
    out[key] = model
  }
  return out
}

function readCache() {
  try {
    const raw = globalThis.localStorage?.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(next) {
  try {
    globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(next))
  } catch {
    // Private browsing or quota. The in-memory tiers still apply for this
    // session; losing the head start at the next launch beats failing here.
  }
}

/**
 * Apply the last known tiers synchronously, before anything can generate.
 * Call at startup, from main.jsx, alongside the legacy prefs init.
 */
export function hydrateModelSourcesFromCache() {
  const cached = readCache()
  if (!cached) return false
  for (const tier of ['platform', 'workspace', 'user']) {
    if (cached[tier] && typeof cached[tier] === 'object') {
      updateModelSource(tier, cached[tier])
    }
  }
  return true
}

/**
 * Read all three tiers from Supabase and apply them.
 *
 * RLS does the scoping: the workspace and user tables are already filtered to
 * the caller's workspace and the caller's own rows, so this passes no ids and
 * cannot accidentally widen its own query. Call after sign-in and after any
 * workspace switch.
 *
 * Failures are non-fatal by design. If the catalogue is unreachable the app
 * must still generate — falling back to cached tiers, then to the built-in
 * floor. Turning a database hiccup into an AI outage is the failure class that
 * cost 47 days.
 *
 * @returns {Promise<{ok: boolean, error: string|null}>}
 */
export async function loadModelSources() {
  // Dev fixtures (2026-09-11, dev builds only): the cached tiers (hydrated in
  // main.jsx) stand; no read leaves for Supabase.
  if (import.meta.env.DEV && devFixtures()) return { ok: true, error: null }
  const results = { user: null, workspace: null, platform: null }
  let firstError = null

  const reads = [
    // The platform tier carries `effort` as well as the model — it is the only
    // tier that does. See activeModel.setPlatformEffort.
    ['platform', supabase.from('platform_model_defaults').select('registry_key, model_id, effort')],
    ['workspace', supabase.from('workspace_model_overrides').select('registry_key, model_id')],
    ['user', supabase.from('user_model_overrides').select('registry_key, model_id')],
  ]

  for (const [tier, query] of reads) {
    try {
      const { data, error } = await query
      if (error) {
        firstError = firstError ?? error.message
        continue
      }
      results[tier] = sanitise(data)
      if (tier === 'platform') {
        const efforts = {}
        for (const row of data ?? []) {
          if (row?.registry_key && BY_KEY[row.registry_key] && row.effort) {
            efforts[row.registry_key] = row.effort
          }
        }
        setPlatformEffort(efforts)
      }
    } catch (err) {
      firstError = firstError ?? String(err?.message ?? err)
    }
  }

  // Apply only the tiers that actually answered. A tier left null keeps
  // whatever the cache hydrated, rather than being blanked by a failed read.
  for (const tier of ['platform', 'workspace', 'user']) {
    if (results[tier]) updateModelSource(tier, results[tier])
  }

  if (!firstError) {
    writeCache(results)
    markModelSourcesLoaded(true)
  }
  return { ok: !firstError, error: firstError }
}

/**
 * The models a picker may offer: the live catalogue, in display order.
 *
 * Retired rows are excluded here rather than filtered in each picker — an
 * operator retiring a model should remove it from every dropdown at once. What
 * it does NOT do is invalidate an existing selection; see the header.
 */
export async function loadApprovedModels() {
  // Dev fixtures (dev builds only): the cached catalogue stands; nothing leaves.
  if (import.meta.env.DEV && devFixtures()) return { models: cachedApprovedModels(), error: null }
  try {
    const { data, error } = await supabase
      .from('platform_approved_models')
      .select('model_id, label, hint, sort_order, validation')
      .is('retired_at', null)
      .order('sort_order', { ascending: true })
      .order('label', { ascending: true })
    if (error) return { models: cachedApprovedModels(), error: error.message }
    const models = data ?? []
    if (models.length > 0) {
      try {
        globalThis.localStorage?.setItem(CATALOGUE_CACHE_KEY, JSON.stringify(models))
      } catch { /* ignore */ }
    }
    return { models, error: null }
  } catch (err) {
    return { models: cachedApprovedModels(), error: String(err?.message ?? err) }
  }
}

/**
 * The last catalogue we saw, synchronously.
 *
 * A picker that renders empty while the network answers looks broken and
 * invites people to conclude their model choice was lost. This is also what
 * keeps the dropdown populated on a desktop build with no connection.
 */
export function cachedApprovedModels() {
  try {
    const raw = globalThis.localStorage?.getItem(CATALOGUE_CACHE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Who is signed in, and to which company — with a ceiling on the await.
 *
 * `getSession()` is unbounded by default, and a pending promise is not
 * recoverable the way a rejected one is: the caller's `busy` flag is cleared by
 * the NEXT step, so a hang here leaves a dropdown greyed out forever with no
 * error and nothing in the console. That is the same defect shape as the
 * Profile panel (`docs/OUTSTANDING.md`), and both writers below reached it —
 * so it is bounded once, here, rather than at each call site.
 *
 * A timeout is reported distinctly from "signed out". They need different
 * remedies, and conflating them would tell someone to sign in again when the
 * truth is that the network stalled.
 */
async function currentIdentity() {
  let sess
  try {
    const res = await withTimeout(
      supabase.auth.getSession(), AUTH_TIMEOUT_MS, 'reading your session',
    )
    sess = res?.data
  } catch (err) {
    return { error: `${err?.message ?? 'could not read your session'} — nothing was saved` }
  }
  const userId = sess?.session?.user?.id
  const workspaceId = sess?.session?.user?.app_metadata?.workspace_id
  if (!userId || !workspaceId) return { error: 'not signed in' }
  return { userId, workspaceId }
}

/**
 * Set or clear the signed-in user's override for one function.
 *
 * @param {string} key      a REGISTRY key
 * @param {string|null} modelId  null/'' clears it (fall through to the tier below)
 */
export async function setUserModelOverride(key, modelId) {
  if (!BY_KEY[key]) return { ok: false, error: `unknown function "${key}"` }
  // Dev fixtures (dev builds only): a model choice is refused loudly, never sent.
  if (import.meta.env.DEV && devFixtures()) return { ok: false, error: devWriteRefused('Saving a model choice').message }

  const { userId, workspaceId, error: idErr } = await currentIdentity()
  if (idErr) return { ok: false, error: idErr }

  try {
    if (!modelId) {
      const { error } = await supabase
        .from('user_model_overrides')
        .delete()
        .eq('user_id', userId)
        .eq('workspace_id', workspaceId)
        .eq('registry_key', key)
      if (error) return { ok: false, error: error.message }
    } else {
      // `.select()` is not decoration. An RLS-refused write returns zero rows
      // rather than raising, so a check for `error` alone reports success for a
      // write that never landed — and the user then generates with a model they
      // believe they chose.
      const { data, error } = await supabase
        .from('user_model_overrides')
        .upsert({
          user_id: userId,
          workspace_id: workspaceId,
          registry_key: key,
          model_id: modelId,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,workspace_id,registry_key' })
        .select('registry_key')
      if (error) return { ok: false, error: error.message }
      if (!data || data.length === 0) {
        return { ok: false, error: 'the change was refused (no row was written)' }
      }
    }
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) }
  }

  await loadModelSources()
  return { ok: true, error: null }
}

/**
 * Set or clear the COMPANY's override for one function. Admins only — the
 * policy in 0031 enforces it; this will report the refusal rather than
 * pretending it worked.
 */
export async function setWorkspaceModelOverride(key, modelId) {
  if (!BY_KEY[key]) return { ok: false, error: `unknown function "${key}"` }
  if (import.meta.env.DEV && devFixtures()) return { ok: false, error: devWriteRefused("Saving the company's model choice").message }

  const { userId, workspaceId, error: idErr } = await currentIdentity()
  if (idErr) return { ok: false, error: idErr }

  try {
    if (!modelId) {
      const { error } = await supabase
        .from('workspace_model_overrides')
        .delete()
        .eq('workspace_id', workspaceId)
        .eq('registry_key', key)
      if (error) return { ok: false, error: error.message }
    } else {
      const { data, error } = await supabase
        .from('workspace_model_overrides')
        .upsert({
          workspace_id: workspaceId,
          registry_key: key,
          model_id: modelId,
          updated_by: userId ?? null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'workspace_id,registry_key' })
        .select('registry_key')
      if (error) return { ok: false, error: error.message }
      if (!data || data.length === 0) {
        // The most likely cause is not being an admin. Say that, rather than
        // leaving a control that appears to work and does nothing.
        return { ok: false, error: 'the change was refused — company model settings are admin-only' }
      }
    }
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) }
  }

  await loadModelSources()
  return { ok: true, error: null }
}

/**
 * Move the S19 localStorage preferences into the database, once.
 *
 * The keys are REGISTRY keys and do not change — that is exactly why S19 made
 * them a persistence contract — so this is a read-and-rewrite, not a
 * translation. Rows that fail (a model since removed from the catalogue, so the
 * FK refuses them) are skipped rather than aborting the batch: losing one stale
 * preference is better than losing all of them.
 *
 * Marked done even on partial success, because retrying forever would rewrite
 * choices the user has since changed deliberately.
 */
export async function migrateLegacyUserModelPrefs() {
  try {
    if (globalThis.localStorage?.getItem(LEGACY_MIGRATED_KEY)) {
      return { migrated: 0, skipped: 0, alreadyDone: true }
    }
  } catch { /* no localStorage: attempt the migration, it is idempotent enough */ }

  const legacy = loadUserModelPrefs()
  const entries = Object.entries(legacy)
  if (entries.length === 0) {
    try { globalThis.localStorage?.setItem(LEGACY_MIGRATED_KEY, '1') } catch { /* ignore */ }
    return { migrated: 0, skipped: 0, alreadyDone: false }
  }

  let migrated = 0
  let skipped = 0
  for (const [key, modelId] of entries) {
    const res = await setUserModelOverride(key, modelId)
    if (res.ok) migrated += 1
    else skipped += 1
  }

  try { globalThis.localStorage?.setItem(LEGACY_MIGRATED_KEY, '1') } catch { /* ignore */ }
  return { migrated, skipped, alreadyDone: false }
}
