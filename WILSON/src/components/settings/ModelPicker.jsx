// =============================================================================
// ModelPicker — choose the Claude model for one function, next to its prompt.
//
// It lives above the prompt textarea on purpose: the prompt and the model are
// one decision. Reading a system prompt without knowing which model receives it
// tells you half the story, and until S19 there was nowhere in the app that
// showed the model at all — which is a large part of why a retired one went
// unnoticed for 47 days.
//
// Writes through `setUserModelPref`, which persists the choice AND pushes it
// into the live resolver, so the next generation uses it without a reload.
// =============================================================================

import { useState } from 'react'
import { BY_KEY, SELECTABLE_MODELS } from '../../lib/aiModels'
import { modelFor, defaultModelFor } from '../../lib/activeModel'
import { loadUserModelPrefs, setUserModelPref } from '../../lib/userModelPrefs'

export default function ModelPicker({ registryKey, disabled = false }) {
  const entry = BY_KEY[registryKey]
  const [chosen, setChosen] = useState(() => loadUserModelPrefs()[registryKey] || '')

  // An unknown key is a wiring mistake, not something to render a broken
  // control for. The guard test catches this at build time; this is the
  // belt-and-braces for a key built at runtime.
  if (!entry) return null

  const effective = modelFor(registryKey)
  const isDefault = !chosen
  // The default must be resolved WITHOUT the user tier. Using the effective
  // model here labelled someone's own override as the thing it replaced.
  const fallback = defaultModelFor(registryKey)
  const nameOf = (id) => SELECTABLE_MODELS.find((m) => m.id === id)?.label || id
  const defaultLabel = nameOf(fallback)

  const onChange = (e) => {
    const value = e.target.value
    setChosen(value)
    setUserModelPref(registryKey, value || null)
  }

  return (
    <div className="mb-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-wide text-stone-500">
          Model
        </span>
        <select
          value={chosen}
          onChange={onChange}
          disabled={disabled}
          title={entry.hint || entry.label}
          className={`px-2 py-1 bg-stone-950 border-2 border-stone-600 rounded-sm text-orange-400
            text-[11px] font-mono focus:outline-none focus:border-orange-500
            ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
        >
          {/* Empty value = inherit, so a user who never touches this keeps
              getting whatever the default becomes rather than being pinned to
              whatever it happened to be the day they opened this panel. */}
          <option value="">Default ({defaultLabel})</option>
          {SELECTABLE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>

        {!isDefault && (
          <button
            type="button"
            onClick={() => { setChosen(''); setUserModelPref(registryKey, null) }}
            disabled={disabled}
            className={`text-[10px] ${disabled
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
            <span title="Set from a measurement, not a guess — see the registry entry.">
              effort {entry.effort}
            </span>
          </>
        )}
      </p>
    </div>
  )
}
