// =============================================================================
// ModelsSection — Session 20: the model control plane, operator side.
//
// Audrey adds a model in one place and every company can use it. Two halves:
// the CATALOGUE (which models exist at all) and the DEFAULTS (which one each of
// the 28 functions uses when nobody has chosen otherwise).
//
// Everything here writes through the operator-models Edge Function, never
// through PostgREST. Migration 0031 gives both tables no write policy and no
// write privilege, so there is no direct path — which is exactly what stops the
// Anthropic validation (D5) being bypassable from a browser console.
//
// -----------------------------------------------------------------------------
// TWO THINGS THIS SCREEN DELIBERATELY REFUSES TO PRETEND
// -----------------------------------------------------------------------------
// 1. A model saved while Anthropic was unreachable is badged UNVERIFIED, not
//    shown as approved. operator-ai-keys set the precedent: storing something on
//    the benefit of the doubt is fine, implying you checked it is not.
//
// 2. EFFORT is offered only for functions whose call path actually carries it
//    (`carriesEffort` on the REGISTRY entry — one function today). Rendering the
//    control for all 28 would make 27 settings that save, display, and do
//    nothing. Effort is operator-only by decision: it trades wall-clock against
//    quality on a call running against an Edge deadline, and S19 measured
//    D.O.G.'s full deck at 137.9s unset against 69.1s at `medium`.
//
// UX laws applied (≥5): Jakob's Law (same 900px column, light table, dark amber
// buttons as the other two sections); Von Restorff (UNVERIFIED and RETIRED are
// badges, not a column of yeses and nos); Selective Attention (a retired model
// dims its whole row rather than merely sorting differently, matching how a
// suspended company reads in CompaniesSection); Chunking (functions are grouped
// by tool — D.O.G., O.T.T.E.R., R.A.B.B.I.T., Assistant — because nobody thinks
// about 28 flat rows); Cognitive Load (each default says what it falls back to,
// so "leave it alone" is legible rather than a blank); Doherty Threshold (every
// button reports its own in-flight state and the row it belongs to).
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, Plus, Archive, RotateCcw } from 'lucide-react'
import { REGISTRY, registryByTool, BUILTIN, EFFORT_LEVELS } from '../lib/aiModels'
import {
  listModels, approveModel, setModelRetired,
  setPlatformDefault, clearPlatformDefault, isMissingFunction,
} from './operatorApi'

export default function ModelsSection({ isActive }) {
  const [models, setModels] = useState([])
  const [defaults, setDefaults] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [busyKey, setBusyKey] = useState(null)
  const [notice, setNotice] = useState('')

  // Add-a-model form
  const [newId, setNewId] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newHint, setNewHint] = useState('')

  const mountedRef = useRef(true)
  const loadedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    const res = await listModels()
    if (!mountedRef.current) return
    setLoading(false)
    if (isMissingFunction(res)) { setMissing(true); return }
    if (!res.ok) { setError(res.data?.friendly ?? 'Could not load the catalogue.'); return }
    setMissing(false)
    setError('')
    setModels(res.data.models ?? [])
    const byKey = {}
    for (const d of res.data.defaults ?? []) byKey[d.registry_key] = d
    setDefaults(byKey)
  }, [])

  useEffect(() => {
    if (!isActive || loadedRef.current) return
    loadedRef.current = true
    reload()
  }, [isActive, reload])

  const live = models.filter((m) => !m.retired_at)

  const onApprove = async (e) => {
    e.preventDefault()
    setBusyKey('new')
    setError('')
    setNotice('')
    const res = await approveModel({
      modelId: newId.trim(), label: newLabel.trim(), hint: newHint.trim(),
      sortOrder: (models.length + 1) * 10,
    })
    if (!mountedRef.current) return
    setBusyKey(null)
    if (!res.ok) { setError(res.data?.friendly ?? 'Could not add that model.'); return }
    setNotice(res.data.validated
      ? `${res.data.model_id} validated against Anthropic and added.`
      : `${res.data.model_id} was added, but Anthropic could not confirm it (${res.data.detail ?? 'inconclusive'}). It is marked unverified.`)
    setNewId(''); setNewLabel(''); setNewHint('')
    reload()
  }

  const onRetire = async (modelId, retired) => {
    setBusyKey(modelId)
    setError('')
    setNotice('')
    const res = await setModelRetired(modelId, retired)
    if (!mountedRef.current) return
    setBusyKey(null)
    if (!res.ok) { setError(res.data?.friendly ?? 'Could not update that model.'); return }
    if (retired) {
      const ws = res.data.workspace_overrides ?? 0
      const us = res.data.user_overrides ?? 0
      setNotice(ws + us === 0
        ? `${modelId} retired. Nothing was using it.`
        : `${modelId} retired. ${ws} company and ${us} user setting(s) still point at it — they keep working, but it is no longer offered.`)
    }
    reload()
  }

  const onDefault = async (registryKey, modelId, effort) => {
    setBusyKey(registryKey)
    setError('')
    setNotice('')
    const res = (!modelId && !effort)
      ? await clearPlatformDefault(registryKey)
      : await setPlatformDefault({ registryKey, modelId, effort })
    if (!mountedRef.current) return
    setBusyKey(null)
    if (!res.ok) { setError(res.data?.friendly ?? 'Could not set that default.'); return }
    reload()
  }

  const labelFor = (id) => models.find((m) => m.model_id === id)?.label || id

  return (
    <div className="pb-8" style={{ maxWidth: '900px' }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900">Models</h2>
          <p className="text-xs text-stone-950 leading-relaxed">
            What every company may choose from, and what each function uses by default.
          </p>
        </div>
        <button
          onClick={reload}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors disabled:opacity-40"
          style={{ backgroundColor: '#1c1917', color: '#f4a261' }}
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {missing && (
        <p className="text-[11px] mb-3 px-3 py-2 rounded-sm" style={{ backgroundColor: 'rgba(120,70,30,0.12)', color: '#57534e' }}>
          operator-models is not deployed in this environment yet (Session 20).
        </p>
      )}
      {error && (
        <p className="text-[11px] mb-3 px-3 py-2 rounded-sm" style={{ backgroundColor: 'rgba(220,38,38,0.10)', color: '#991b1b' }}>
          {error}
        </p>
      )}
      {notice && (
        <p className="text-[11px] mb-3 px-3 py-2 rounded-sm" style={{ backgroundColor: 'rgba(120,70,30,0.12)', color: '#57534e' }}>
          {notice}
        </p>
      )}

      {/* ── Catalogue ───────────────────────────────────────────────────────── */}
      <h3 className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: '#57534e' }}>
        Approved catalogue
      </h3>

      <div className="overflow-auto rounded-sm wilson-light-scroll mb-3" style={{ border: '1px solid #d6d3d1' }}>
        <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr style={{ backgroundColor: '#e7e5e4' }}>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-left" style={{ color: '#57534e' }}>Model</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-left" style={{ color: '#57534e' }}>Name</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-left" style={{ color: '#57534e', width: '130px' }}>State</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-right" style={{ color: '#57534e', width: '110px' }} />
            </tr>
          </thead>
          <tbody>
            {models.length === 0 && !loading && !missing && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-xs" style={{ color: '#78716c' }}>
                  No models approved yet. Every picker in every company is empty until one is.
                </td>
              </tr>
            )}
            {models.map((m) => {
              const retired = !!m.retired_at
              return (
                <tr key={m.model_id} style={{ borderBottom: '1px solid #e7e5e4', opacity: retired ? 0.5 : 1 }}>
                  <td className="px-3 py-2 align-top">
                    <code className="text-[11px] font-mono" style={{ color: '#1c1917' }}>{m.model_id}</code>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="text-[11px]" style={{ color: '#1c1917' }}>{m.label}</div>
                    {m.hint && <div className="text-[10px]" style={{ color: '#78716c' }}>{m.hint}</div>}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {retired && (
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#991b1b' }}>Retired</span>
                    )}
                    {!retired && m.validation === 'validated' && (
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#57534e' }}>Validated</span>
                    )}
                    {!retired && m.validation !== 'validated' && (
                      // Not a warning about the model — a statement about what we
                      // actually know. It may well be fine; Anthropic just never
                      // confirmed it.
                      <span
                        className="text-[10px] font-bold uppercase tracking-wider"
                        style={{ color: '#b45309' }}
                        title="Saved without a positive answer from Anthropic (rate limit, outage, or no platform key). Not necessarily wrong — just never confirmed."
                      >
                        Unverified
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-right">
                    <button
                      onClick={() => onRetire(m.model_id, !retired)}
                      disabled={busyKey === m.model_id}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm disabled:opacity-40"
                      style={{ backgroundColor: 'rgba(120, 70, 30, 0.55)', color: '#fde8d0' }}
                    >
                      {retired ? <><RotateCcw size={11} /> Restore</> : <><Archive size={11} /> Retire</>}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Free text is operator-only — D4. Admins and users get a picker. */}
      <form onSubmit={onApprove} className="flex items-end gap-2 flex-wrap mb-6">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#57534e' }}>Model ID</span>
          <input
            value={newId}
            onChange={(e) => setNewId(e.target.value)}
            placeholder="claude-…"
            required
            className="px-2 py-1.5 text-[11px] font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            style={{ border: '1px solid #d6d3d1', width: '260px', color: '#1c1917' }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#57534e' }}>Name</span>
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Opus 5"
            required
            className="px-2 py-1.5 text-[11px] rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            style={{ border: '1px solid #d6d3d1', width: '140px', color: '#1c1917' }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#57534e' }}>Hint</span>
          <input
            value={newHint}
            onChange={(e) => setNewHint(e.target.value)}
            placeholder="Most capable. Slowest and dearest."
            className="px-2 py-1.5 text-[11px] rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            style={{ border: '1px solid #d6d3d1', width: '260px', color: '#1c1917' }}
          />
        </label>
        <button
          type="submit"
          disabled={busyKey === 'new' || !newId.trim() || !newLabel.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm disabled:opacity-40"
          style={{ backgroundColor: '#ea580c', color: '#fff' }}
        >
          <Plus size={12} /> {busyKey === 'new' ? 'Checking…' : 'Add'}
        </button>
      </form>

      {/* ── Defaults ────────────────────────────────────────────────────────── */}
      <h3 className="text-[11px] font-bold uppercase tracking-widest mb-1" style={{ color: '#57534e' }}>
        Platform defaults
      </h3>
      <p className="text-[11px] mb-2" style={{ color: '#78716c' }}>
        What each function uses when a company and a user have both chosen nothing.
        Leave one on <em>Built-in</em> and it follows whatever ships in the code
        ({BUILTIN.REASONING} or {BUILTIN.FAST}) rather than being pinned here.
      </p>

      {[...registryByTool().entries()].map(([tool, entries]) => (
        <div key={tool} className="mb-4">
          <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#a8a29e' }}>{tool}</div>
          <div className="rounded-sm" style={{ border: '1px solid #d6d3d1' }}>
            {entries.map((entry, i) => {
              const d = defaults[entry.key] ?? {}
              const busy = busyKey === entry.key
              return (
                <div
                  key={entry.key}
                  className="flex items-center gap-2 px-3 py-2 flex-wrap"
                  style={{ borderTop: i === 0 ? 'none' : '1px solid #e7e5e4' }}
                >
                  <div className="flex-1 min-w-0" style={{ minWidth: '200px' }}>
                    <div className="text-[11px]" style={{ color: '#1c1917' }}>{entry.label}</div>
                    <div className="text-[10px]" style={{ color: '#78716c' }}>
                      {d.model_id ? `pinned to ${labelFor(d.model_id)}` : `built-in (${BUILTIN[entry.tier]})`}
                    </div>
                  </div>

                  <select
                    value={d.model_id ?? ''}
                    disabled={busy}
                    onChange={(e) => onDefault(entry.key, e.target.value, d.effort ?? '')}
                    className="px-2 py-1 text-[11px] font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-40"
                    style={{ border: '1px solid #d6d3d1', color: '#1c1917' }}
                  >
                    <option value="">Built-in ({BUILTIN[entry.tier]})</option>
                    {live.map((m) => (
                      <option key={m.model_id} value={m.model_id}>{m.label}</option>
                    ))}
                  </select>

                  {/* Only where the call path actually spreads tuningFor(). A
                      control here for anything else would save and do nothing. */}
                  {entry.carriesEffort ? (
                    <select
                      value={d.effort ?? ''}
                      disabled={busy}
                      onChange={(e) => onDefault(entry.key, d.model_id ?? '', e.target.value)}
                      title="Operator-only. Trades wall-clock against quality on a call that runs against ai-proxy's Edge deadline."
                      className="px-2 py-1 text-[11px] rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-40"
                      style={{ border: '1px solid #d6d3d1', color: '#1c1917' }}
                    >
                      <option value="">effort: registry ({entry.effort ?? 'unset'})</option>
                      {EFFORT_LEVELS.map((lv) => (
                        <option key={lv} value={lv}>effort: {lv}</option>
                      ))}
                    </select>
                  ) : (
                    <span
                      className="text-[10px]"
                      style={{ color: '#a8a29e', width: '150px' }}
                      title="This function's request body does not carry thinking/output_config, so an effort setting here would be stored and ignored. Add the tuningFor() spread to its call site first."
                    >
                      effort n/a
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      <p className="text-[10px]" style={{ color: '#a8a29e' }}>
        {REGISTRY.length} functions. Changing a default takes effect on each
        company&rsquo;s next sign-in or refresh; a company or user override still
        beats it.
      </p>
    </div>
  )
}
