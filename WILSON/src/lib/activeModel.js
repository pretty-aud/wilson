// =============================================================================
// activeModel — the one function every AI call site asks for its model.
//
// `aiModels.js` is deliberately pure: it can compute a model and a warning but
// it cannot deliver the warning anywhere. This module is the delivery half.
// It holds the (currently empty) override sources, and it turns
// `resolveModel()`'s returned warning into something a human actually sees.
//
// -----------------------------------------------------------------------------
// WHY A WARNING SURFACE EXISTS BEFORE ANYTHING CAN FILL IT
// -----------------------------------------------------------------------------
// In S19 there are no override stores yet — no user, workspace, or platform
// settings — so `resolveModel(key)` returns the built-in and a null warning at
// every call site. That makes the misconfiguration path unreachable *today*,
// and it would be easy to conclude the banner is premature.
//
// It is not, for two reasons:
//
//   1. One warning IS reachable now: an unknown registry key. 28 keys are
//      hand-typed at 28 call sites, and a typo resolves to a working model
//      while silently ignoring whatever the user configured for the real key.
//      `noHardcodedModels.test.js` catches that at build time; this catches
//      the case the static check cannot see.
//   2. S20 turns the misconfiguration path on for every one of those keys.
//      Building the surface now means S20 adds stores, not stores *and* a way
//      to hear about them — and the mechanism ships tested rather than
//      written in a hurry alongside three admin screens.
//
// Decision D6 (Audrey, 2026-08-01) is loud fallback over silent fallback: the
// call still succeeds, and the user is told which function fell back and why.
// A console.warn does not satisfy that. Silent fallback is precisely how a
// dead model went unnoticed for 47 days.
// =============================================================================

// Extension included deliberately. Vite resolves the extensionless form, plain
// Node's ESM loader does not — and scripts/probes/ import this module directly
// so a probe tests the registry the app actually ships rather than a copy of it.
import { resolveModel, tuningFor as builtinTuningFor, EFFORT_LEVELS } from './aiModels.js'

// ── Effort, and why it is not a fourth entry in `sources` ────────────────────
// Session 20. Effort is stored on platform_model_defaults and ONLY there:
// companies choose the model, the platform chooses how hard it thinks
// (Audrey, 2026-08-02). ai-proxy streams through an Edge Function and S19
// measured D.O.G.'s full deck at 137.9s unset against 69.1s at `medium`, so
// this is a lever with a sharp edge and a company admin cannot see the
// measurement behind it.
//
// It is kept separate from `sources` rather than folded in as a fourth tier
// because the two are different shapes — `sources` maps a registry key to a
// MODEL, this maps a registry key to an EFFORT — and merging them would make
// resolveModel's cascade mean two things at once.

let platformEffort = {}

/** Replace the operator-set effort map. Called by the loader. */
export function setPlatformEffort(map) {
  platformEffort = map && typeof map === 'object' ? map : {}
}

/** Current effort overrides — for the settings surfaces and tests. */
export function getPlatformEffort() {
  return platformEffort
}

/**
 * Request tuning for one function, preferring the operator's stored value over
 * the built-in on the REGISTRY entry.
 *
 * Exported under the same name S19 used so call sites need exactly one import
 * to build a request body:
 *   { model: modelFor(k), ...tuningFor(k), max_tokens, system, messages }
 */
export function tuningFor(key) {
  const stored = platformEffort[key]
  if (typeof stored === 'string' && EFFORT_LEVELS.includes(stored)) {
    return { thinking: { type: 'adaptive' }, output_config: { effort: stored } }
  }
  return builtinTuningFor(key)
}

/**
 * Override sources, in resolution order. Empty until S20 builds the stores.
 *
 * Module-level rather than React state on purpose: `runIngestion` in RABBIT's
 * intake pipeline is a plain async function called from outside any component,
 * so a hook-only design would leave it unable to resolve anything. It reads
 * models through an injected map instead (see `pipeline.js`), but the provider
 * that builds that map uses the same resolution path as everything else.
 */
let sources = { user: null, workspace: null, platform: null }

/** S20 calls this when settings load or change. */
export function setModelSources(next) {
  sources = {
    user: next?.user ?? null,
    workspace: next?.workspace ?? null,
    platform: next?.platform ?? null,
  }
}

/** Current sources — exported for tests and for the S20 settings surfaces. */
export function getModelSources() {
  return sources
}

/**
 * Replace ONE tier, leaving the other two exactly as they were.
 *
 * Session 20. `setModelSources` above replaces all three, which was right when
 * localStorage was the only writer — there was one loader and it knew
 * everything. There are now three tiers arriving from three queries at three
 * different moments, and a loader that called `setModelSources({ workspace })`
 * would silently wipe the user's own choices on the way past. That failure is
 * invisible: resolution simply falls through to the next tier and generates
 * happily with the wrong model.
 *
 * @param {'user'|'workspace'|'platform'} tier
 * @param {Record<string,string>|null} map  registry key -> model id
 */
export function updateModelSource(tier, map) {
  if (tier !== 'user' && tier !== 'workspace' && tier !== 'platform') {
    throw new Error(`updateModelSource: unknown tier "${tier}"`)
  }
  sources = { ...sources, [tier]: map ?? null }
}

// ── Load state ───────────────────────────────────────────────────────────────
// The workspace and platform tiers come from Supabase, so there is a window
// between app start and their arrival during which resolution falls through to
// the built-in floor and reports NO warning — an absent tier is not a
// misconfigured one, so resolveModel has nothing to complain about.
//
// The cache in `modelSources.js` closes that window in the normal case by
// hydrating synchronously from the last known good values. This flag exists so
// a surface that genuinely needs to know (the settings panel, which would
// otherwise draw "inherited from: built-in" for every row on first paint) can
// tell "nothing is configured" from "nothing has loaded yet".

let loaded = false

/** True once a real load has completed at least once this session. */
export function areModelSourcesLoaded() {
  return loaded
}

/** Called by the loader when the three tiers have been read from the database. */
export function markModelSourcesLoaded(value = true) {
  loaded = Boolean(value)
}

// ── Warning store ────────────────────────────────────────────────────────────
// Keyed by registry key so a retry loop that resolves the same bad setting
// three times produces one banner, not three. Warnings persist until the user
// dismisses them: a fallback that scrolls past unnoticed is a silent fallback
// wearing a hat.

const warnings = new Map()
const listeners = new Set()

function emit() {
  const snapshot = [...warnings.values()]
  for (const fn of listeners) fn(snapshot)
}

/** Subscribe to the warning list. Returns an unsubscribe function. */
export function subscribeModelWarnings(fn) {
  listeners.add(fn)
  fn([...warnings.values()])
  return () => listeners.delete(fn)
}

/** Current warnings. Empty means every configured model resolved cleanly. */
export function getModelWarnings() {
  return [...warnings.values()]
}

/** Dismiss one warning by its registry key. */
export function dismissModelWarning(key) {
  if (warnings.delete(key)) emit()
}

/** Drop every warning. Used on sign-out and by tests. */
export function clearModelWarnings() {
  if (warnings.size === 0) return
  warnings.clear()
  emit()
}

/**
 * The model for one registry key.
 *
 * This is the ONLY thing call sites should use. It returns a plain string, so
 * swapping `model: 'claude-…'` for `model: modelFor('dog.fullDeck')` changes
 * the shape of nothing else in the request body.
 *
 * @param {string} key a REGISTRY key — see `aiModels.js`
 * @returns {string} a model id that is safe to send
 */
/**
 * What this function WOULD resolve to if the user had chosen nothing — the
 * workspace/platform/built-in answer, ignoring the user tier.
 *
 * The settings picker needs this and cannot get it from `modelFor`: once an
 * override is set, `modelFor` returns the override, so a picker using it to
 * label the default showed people their own choice as the thing they had
 * replaced ("overridden — was Opus 5" when Opus 5 was the new value).
 *
 * Deliberately not `BUILTIN[entry.tier]` — that is only right today because
 * the workspace and platform tiers are empty. S20 fills them, and this keeps
 * answering the question that was actually asked.
 */
export function defaultModelFor(key) {
  const { user: _ignored, ...withoutUser } = sources
  return resolveModel(key, withoutUser).model
}

export function modelFor(key) {
  const { model, warning } = resolveModel(key, sources)
  if (warning) {
    const existing = warnings.get(key)
    if (!existing || existing.text !== warning) {
      warnings.set(key, { key, text: warning })
      emit()
    }
  } else if (warnings.delete(key)) {
    // The setting was corrected — retract the banner rather than leaving a
    // stale complaint on screen.
    emit()
  }
  return model
}
