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
import { resolveModel, tuningFor } from './aiModels.js'

// Re-exported so a call site needs exactly one import to build a request body:
//   { model: modelFor(k), ...tuningFor(k), max_tokens, system, messages }
export { tuningFor }

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
