// =============================================================================
// userModelPrefs — per-user model choices, stored locally.
//
// The settings panel's model dropdowns write here, and this feeds
// `setModelSources({ user })` so the choice actually reaches the next
// generation. Without it the dropdown would be decorative, which is worse than
// having no dropdown: a setting that visibly does nothing teaches people not to
// trust the settings screen.
//
// -----------------------------------------------------------------------------
// WHY LOCALSTORAGE, AND WHAT REPLACES IT
// -----------------------------------------------------------------------------
// This is the `user` tier of the three-tier cascade (user -> workspace ->
// platform -> built-in). S20 moves it to Supabase so a choice follows someone
// between machines, and adds the workspace and platform tiers above it. The
// KEYS DO NOT CHANGE when that happens — they are REGISTRY keys, which is the
// whole reason they were made a contract in S19 — so a migration reads this
// object and writes the same shape to a table.
//
// Deliberately not in `localData.js`: that module is the local-server/desktop
// data path, and these preferences must work identically on the web build.
// =============================================================================

import { setModelSources, getModelSources } from './activeModel'
import { BY_KEY, isWellFormedModelId, RETIRED } from './aiModels'

const STORAGE_KEY = 'wilson.modelPrefs.v1'

/** Read the stored map. Never throws — a corrupt value degrades to defaults. */
export function loadUserModelPrefs() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    // Drop anything that is not a known function or not a usable model id.
    // A stale key from a renamed REGISTRY entry, or a model retired since it
    // was chosen, should quietly stop applying rather than resurface as a
    // warning banner on every generation.
    const clean = {}
    for (const [key, model] of Object.entries(parsed)) {
      if (!BY_KEY[key]) continue
      if (typeof model !== 'string' || !isWellFormedModelId(model)) continue
      if (RETIRED[model]) continue
      clean[key] = model
    }
    return clean
  } catch {
    return {}
  }
}

function persist(prefs) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // Private browsing, quota, or no localStorage at all. The in-memory
    // sources below still apply for this session — losing the preference at
    // the next launch beats refusing to honour it now.
  }
}

/**
 * Load stored preferences into the resolver. Call once at startup, before
 * anything generates.
 */
export function initUserModelPrefs() {
  const prefs = loadUserModelPrefs()
  setModelSources({ ...getModelSources(), user: prefs })
  return prefs
}

/**
 * Set (or clear) one function's model and apply it immediately.
 *
 * @param {string} key    a REGISTRY key
 * @param {string|null} model  a model id, or null/'' to fall back to the default
 * @returns {object} the full preference map after the change
 */
export function setUserModelPref(key, model) {
  const prefs = loadUserModelPrefs()
  if (!model) delete prefs[key]
  else prefs[key] = model

  persist(prefs)
  // Apply to the live resolver too — `modelFor` reads sources at call time, so
  // the very next generation uses this without a reload.
  setModelSources({ ...getModelSources(), user: prefs })
  return prefs
}

/** Clear every stored choice. */
export function clearUserModelPrefs() {
  persist({})
  setModelSources({ ...getModelSources(), user: {} })
}
