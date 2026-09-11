// =============================================================================
// ModelPicker — choose the Claude model for one function, next to its prompt.
//
// It lives above the prompt textarea on purpose: the prompt and the model are
// one decision. Reading a system prompt without knowing which model receives it
// tells you half the story, and until S19 there was nowhere in the app that
// showed the model at all — which is a large part of why a retired one went
// unnoticed for 47 days.
//
// -----------------------------------------------------------------------------
// SESSION 20 — WHERE THE OPTIONS COME FROM
// -----------------------------------------------------------------------------
// S19 offered a hardcoded SELECTABLE_MODELS list and wrote to localStorage.
// Both are gone. The options are now the operator-curated catalogue
// (platform_approved_models), which is decision D4: a company admin or user may
// only choose from models WILSON's operator has approved, and free text is
// operator-only.
//
// The catalogue is cached, so this renders populated on first paint and keeps
// working with no connection. An empty catalogue is reported rather than drawn
// as an empty dropdown — a picker with no options and no explanation reads as a
// bug, and the actual cause (nothing approved yet, or the read failed) is
// something the person looking at it can act on.
// =============================================================================

import { useEffect, useState } from 'react'
import { BY_KEY } from '../../lib/aiModels'
import { modelFor, defaultModelFor, getModelSources } from '../../lib/activeModel'
import {
  loadApprovedModels,
  cachedApprovedModels,
  setUserModelOverride,
} from '../../lib/modelSources'
import './settings.css'

export default function ModelPicker({ registryKey, disabled = false }) {
  const entry = BY_KEY[registryKey]

  // Start from the cache so the control is populated immediately, then refresh.
  const [models, setModels] = useState(() => cachedApprovedModels())
  const [chosen, setChosen] = useState(() => getModelSources().user?.[registryKey] || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    loadApprovedModels().then(({ models: fresh, error: err }) => {
      if (!alive) return
      if (fresh.length > 0) setModels(fresh)
      // Only surface a load error when there is nothing cached to fall back on.
      if (err && fresh.length === 0) setError(err)
    })
    return () => { alive = false }
  }, [])

  // An unknown key is a wiring mistake, not something to render a broken
  // control for. The guard test catches this at build time; this is the
  // belt-and-braces for a key built at runtime.
  if (!entry) return null

  const effective = modelFor(registryKey)
  const isDefault = !chosen
  // The default must be resolved WITHOUT the user tier. Using the effective
  // model here labelled someone's own override as the thing it replaced.
  const fallback = defaultModelFor(registryKey)
  const nameOf = (id) => models.find((m) => m.model_id === id)?.label || id
  const defaultLabel = nameOf(fallback)

  const apply = async (value) => {
    const previous = chosen
    setChosen(value)
    setBusy(true)
    setError(null)
    const res = await setUserModelOverride(registryKey, value || null)
    setBusy(false)
    if (!res.ok) {
      // Put the control back where it was. Leaving it showing a choice the
      // database refused is the silent-failure this whole subsystem exists to
      // prevent, in miniature.
      setChosen(previous)
      setError(res.error)
    }
  }

  return (
    <div className="mb-2">
      <div className="flex items-center gap-2 flex-wrap">
        {/* DARK surface: this control has no caller in Settings — its only
            four call sites are on D.O.G.'s Prompts tab. text-stone-500 was
            #78716c, 3.65:1 on #1c1917; ink-2 measures 8.49:1. */}
        <span className="s-mp-label">Model</span>
        <select
          value={chosen}
          onChange={(e) => apply(e.target.value)}
          disabled={disabled || busy}
          title={entry.hint || entry.label}
          className="s-mp-select"
          data-disabled={disabled || busy}
        >
          {/* Empty value = inherit, so a user who never touches this keeps
              getting whatever the default becomes rather than being pinned to
              whatever it happened to be the day they opened this panel. */}
          <option value="">Default ({defaultLabel})</option>
          {models.map((m) => (
            <option key={m.model_id} value={m.model_id}>{m.label}</option>
          ))}
          {/* A choice made before the model left the catalogue stays selectable
              and keeps resolving — retirement stops a model being OFFERED, it
              does not revoke what someone already chose. Without this the
              select would silently snap to "Default" and save nothing. */}
          {chosen && !models.some((m) => m.model_id === chosen) && (
            <option value={chosen}>{chosen} (no longer offered)</option>
          )}
        </select>

        {!isDefault && (
          <button
            type="button"
            onClick={() => apply('')}
            disabled={disabled || busy}
            className="s-mp-reset"
            data-disabled={disabled || busy}
          >
            Reset to default
          </button>
        )}
      </div>

      <p className="s-mp-note">
        Used by <em>{entry.label}</em>
        {' · '}
        {isDefault
          ? `currently ${effective}`
          : (
            <em>using {nameOf(effective)} — default is {defaultLabel}</em>
          )}
        {entry.effort && (
          <>
            {' · '}
            <span title="Set by the platform operator from a measurement, not a guess. Effort is not company- or user-settable: it trades wall-clock against quality on a call that runs against an Edge deadline.">
              effort {entry.effort} (platform)
            </span>
          </>
        )}
      </p>

      {models.length === 0 && (
        <p className="s-mp-note">
          No models are available to choose from
          {error ? ` — ${error}` : ' — ask your WILSON operator to approve one'}.
          Generation still uses the default.
        </p>
      )}
      {error && models.length > 0 && (
        <p className="s-mp-note" role="alert">{error}</p>
      )}
    </div>
  )
}
