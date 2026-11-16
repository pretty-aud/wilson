// =============================================================================
// ModelsSection (Admin Terminal) — Session 20: the company tier.
//
// A company admin picks which model each of WILSON's 28 AI functions uses for
// everyone in their company. That choice beats the platform default and is
// beaten in turn by an individual's own setting in SYSTEM SETTINGS.
//
// -----------------------------------------------------------------------------
// WHY THIS IS A PICKER AND NOT A TEXT BOX
// -----------------------------------------------------------------------------
// Decision D4: admins and users may only choose from models WILSON's operator
// has approved. Free text is operator-only. That is not merely a UI convention
// — migration 0031 puts a foreign key from workspace_model_overrides.model_id to
// the approved catalogue, so an unapproved id is refused by the database
// whatever client sends it. The dropdown is the courteous half of a rule that is
// enforced underneath.
//
// EFFORT IS ABSENT ON PURPOSE. It is a platform-level lever: ai-proxy streams
// through an Edge Function, and S19 measured D.O.G.'s full deck at 137.9s with
// no effort setting against 69.1s at `medium`. An admin cannot see that
// measurement, so they do not get the control (Audrey, 2026-08-02). The
// operator console has it.
//
// -----------------------------------------------------------------------------
// THE FAILURE THIS SCREEN REFUSES TO HIDE
// -----------------------------------------------------------------------------
// An RLS-refused UPDATE in Postgres affects zero rows — it does not raise. A
// version of this that checked only for an error would show "saved" to a
// non-admin whose write went nowhere, and they would then generate with a model
// they believe they chose. `setWorkspaceModelOverride` checks the returned row
// and says so; this screen surfaces that message rather than swallowing it.
//
// UX laws applied (≥5): Jakob's Law (same 190px-nav page grammar and light
// table as the rest of the Admin Terminal); Chunking (functions grouped by tool
// rather than 28 flat rows); Cognitive Load (every row states what it inherits
// and from where, so "leave it" is a legible choice); Von Restorff (a row the
// company has actually overridden is the only one carrying an accent, so five
// deliberate choices stand out from twenty-three defaults); Doherty Threshold
// (each row reports its own in-flight and error state, next to the control that
// caused it, not in a banner at the top).
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, RotateCcw } from 'lucide-react'
import { registryByTool, BUILTIN, REGISTRY } from '../../lib/aiModels'
import { getModelSources } from '../../lib/activeModel'
import {
  loadApprovedModels, cachedApprovedModels,
  setWorkspaceModelOverride, loadModelSources,
} from '../../lib/modelSources'
import Button from '../../ui/Button'
import Banner from '../../ui/Banner'
import SectionTitle from '../../ui/SectionTitle'

export default function ModelsSection({ isActive }) {
  const [models, setModels] = useState(() => cachedApprovedModels())
  const [overrides, setOverrides] = useState(() => getModelSources().workspace ?? {})
  const [platform, setPlatform] = useState(() => getModelSources().platform ?? {})
  const [loading, setLoading] = useState(false)
  const [busyKey, setBusyKey] = useState(null)
  const [rowError, setRowError] = useState({})
  const [error, setError] = useState('')

  const mountedRef = useRef(true)
  const loadedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    const [{ models: fresh, error: catErr }] = await Promise.all([
      loadApprovedModels(),
      loadModelSources(),
    ])
    if (!mountedRef.current) return
    setLoading(false)
    if (fresh.length > 0) setModels(fresh)
    else if (catErr) setError(catErr)
    setOverrides(getModelSources().workspace ?? {})
    setPlatform(getModelSources().platform ?? {})
  }, [])

  useEffect(() => {
    if (!isActive || loadedRef.current) return
    loadedRef.current = true
    reload()
  }, [isActive, reload])

  const labelFor = (id) => models.find((m) => m.model_id === id)?.label || id

  const apply = async (registryKey, modelId) => {
    setBusyKey(registryKey)
    setRowError((p) => ({ ...p, [registryKey]: null }))
    const res = await setWorkspaceModelOverride(registryKey, modelId || null)
    if (!mountedRef.current) return
    setBusyKey(null)
    if (!res.ok) {
      setRowError((p) => ({ ...p, [registryKey]: res.error }))
      return
    }
    setOverrides(getModelSources().workspace ?? {})
  }

  const overriddenCount = REGISTRY.filter((e) => overrides[e.key]).length

  return (
    <div className="at-section at-models wilson-dark-scroll">
      <SectionTitle
        description="Which model each function uses for everyone in this company. Individuals can still choose their own in App settings."
        actions={(
          <Button size="sm" Icon={RefreshCw} onClick={reload} disabled={loading} loading={loading} loadingLabel="Refreshing">
            Refresh
          </Button>
        )}
      >
        AI models
      </SectionTitle>

      {error && <Banner tone="danger">{error}</Banner>}

      {models.length === 0 && !loading && (
        <Banner tone="info">
          No models have been approved for your account yet, so there is nothing
          to choose from. Every function still runs on its default. Ask your
          WILSON operator to approve one.
        </Banner>
      )}

      <p className="at-note">
        {overriddenCount === 0
          ? 'Nothing overridden — every function follows the platform default.'
          : `${overriddenCount} of ${REGISTRY.length} functions overridden by this company.`}
      </p>

      {[...registryByTool().entries()].map(([tool, entries]) => (
        <div key={tool} className="at-model-group">
          <div className="at-group-label">{tool}</div>
          <div className="at-model-list">
            {entries.map((entry, i) => {
              const chosen = overrides[entry.key] ?? ''
              const busy = busyKey === entry.key
              const err = rowError[entry.key]
              // What this function would use if the company chose nothing —
              // the platform pin if there is one, otherwise the built-in floor.
              const inherited = platform[entry.key] ?? BUILTIN[entry.tier]
              const inheritedFrom = platform[entry.key] ? 'platform default' : 'built-in'
              return (
                /* 🚨 A GRID, NOT A WRAPPING FLEX ROW (AT-27). Under pressure
                   the old row wrapped and dropped RESET onto its own line
                   BELOW the select it resets, so the control that undoes a
                   choice stopped sitting beside it. Three fixed tracks — name,
                   picker, reset — mean the twenty-eight rows form three
                   columns at every width, and the reset slot is reserved
                   whether or not the row has one, so no row shifts when it
                   gains or loses the control. */
                <div
                  key={entry.key}
                  className="at-model-row"
                  data-overridden={String(!!chosen)}
                  data-first={String(i === 0)}
                >
                  <div className="at-model-cells">
                    <div className="at-model-name">
                      <div className="at-model-label">{entry.label}</div>
                      <div className="at-model-source">
                        {chosen
                          ? `using ${labelFor(chosen)} — set by this company`
                          : `using ${labelFor(inherited)} — ${inheritedFrom}`}
                      </div>
                    </div>

                    <select
                      value={chosen}
                      disabled={busy || models.length === 0}
                      onChange={(e) => apply(entry.key, e.target.value)}
                      title={entry.hint || entry.label}
                      className="ui-input at-model-select"
                      data-size="sm"
                    >
                      <option value="">Inherit ({labelFor(inherited)})</option>
                      {models.map((m) => (
                        <option key={m.model_id} value={m.model_id}>{m.label}</option>
                      ))}
                      {/* A model retired since this was chosen stays selectable
                          so the row does not silently snap to Inherit. */}
                      {chosen && !models.some((m) => m.model_id === chosen) && (
                        <option value={chosen}>{chosen} (no longer offered)</option>
                      )}
                    </select>

                    <span className="at-model-reset">
                      {chosen && (
                        <Button
                          size="sm"
                          variant="ghost"
                          Icon={RotateCcw}
                          onClick={() => apply(entry.key, '')}
                          disabled={busy}
                        >
                          Reset
                        </Button>
                      )}
                    </span>
                  </div>

                  {err && <p className="at-model-error" role="alert">{err}</p>}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
