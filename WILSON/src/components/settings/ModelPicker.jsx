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
        <span className="text-[10px] font-bold uppercase tracking-wide text-stone-500">
          Model
        </span>
        <select
          value={chosen}
          onChange={(e) => apply(e.target.value)}
          disabled={disabled || busy}
          title={entry.hint || entry.label}
          className={`px-2 py-1 bg-stone-950 border-2 border-stone-600 rounded-sm text-orange-400
            text-[11px] font-mono focus:border-orange-500
            ${disabled || busy ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
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
            className={`text-[10px] ${disabled || busy
              ? 'text-stone-600 cursor-not-allowed'
              : 'text-orange-400 hover:text-orange-300'}`}
          >
            Reset to default
          </button>
        )}
      </div>

      <p className="text-[10px] text-stone-500 mt-1">
        Used by <span className="text-stone-400">{entry.label}</span>
        {' · '}
        {isDefault
          ? `currently ${effective}`
          : (
            <span className="text-orange-400/80">
              using {nameOf(effective)} — default is {defaultLabel}
            </span>
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
        <p className="text-[10px] text-amber-500/80 mt-1">
          No models are available to choose from
          {error ? ` — ${error}` : ' — ask your WILSON operator to approve one'}.
          Generation still uses the default.
        </p>
      )}
      {error && models.length > 0 && (
        <p className="text-[10px] text-red-400/80 mt-1">{error}</p>
      )}
    </div>
  )
}
