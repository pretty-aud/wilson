// =============================================================================
// UserModelsSection — Session 20: the user tier, in SYSTEM SETTINGS.
//
// The top of the cascade. A choice here beats the company's and the platform's,
// and applies to this person only.
//
// -----------------------------------------------------------------------------
// THE POINT OF THIS SCREEN IS THE PROVENANCE, NOT THE DROPDOWN
// -----------------------------------------------------------------------------
// The dropdown already existed next to each prompt in D.O.G. What did not exist
// anywhere was an answer to "why is this function using THAT model?" — and the
// absence of that answer is a large part of why a retired model ran unnoticed
// for 47 days. So every row states which tier its value came from: yours, your
// company's, the platform's, or the code.
//
// It reads from the same `activeModel` state the generators resolve against, so
// what this screen says is what the next generation will actually do. A separate
// query here could disagree with the resolver and look authoritative doing it.
//
// Storage moved in S20: choices used to live in localStorage under
// `wilson.modelPrefs.v1` and therefore followed a browser rather than a person.
// They are now rows in user_model_overrides, migrated once on first sign-in
// (see modelSources.migrateLegacyUserModelPrefs) — the REGISTRY keys are
// unchanged, which is exactly why S19 made them a persistence contract.
//
// EFFORT IS NOT HERE AND IS NOT MEANT TO BE. It is operator-only: a lever that
// trades wall-clock against quality on a call running against ai-proxy's Edge
// deadline. Where a function has one set, this screen SHOWS it — read-only —
// because "why is my deck slower than my colleague's" deserves an answer even
// when the answer is not yours to change.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, RotateCcw } from 'lucide-react'
import { registryByTool, BUILTIN, REGISTRY } from '../../lib/aiModels'
import { getModelSources, getPlatformEffort, areModelSourcesLoaded } from '../../lib/activeModel'
import {
  loadApprovedModels, cachedApprovedModels,
  setUserModelOverride, loadModelSources,
} from '../../lib/modelSources'
import { LIGHT_INK, LIGHT_RULE } from '../lightSurface'

/** Which tier supplies this key's value, and what it is. */
function provenance(key, tier, sources, builtin) {
  if (sources.user?.[key]) return { from: 'you', model: sources.user[key] }
  if (sources.workspace?.[key]) return { from: 'your company', model: sources.workspace[key] }
  if (sources.platform?.[key]) return { from: 'the platform default', model: sources.platform[key] }
  return { from: 'the built-in default', model: builtin }
}

export default function UserModelsSection() {
  const [models, setModels] = useState(() => cachedApprovedModels())
  const [sources, setSources] = useState(() => getModelSources())
  const [efforts, setEfforts] = useState(() => getPlatformEffort())
  const [loading, setLoading] = useState(false)
  const [busyKey, setBusyKey] = useState(null)
  const [rowError, setRowError] = useState({})
  const [error, setError] = useState('')

  const mountedRef = useRef(true)
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
    setSources(getModelSources())
    setEfforts(getPlatformEffort())
  }, [])

  useEffect(() => { reload() }, [reload])

  const labelFor = (id) => models.find((m) => m.model_id === id)?.label || id

  const apply = async (key, modelId) => {
    setBusyKey(key)
    setRowError((p) => ({ ...p, [key]: null }))
    const res = await setUserModelOverride(key, modelId || null)
    if (!mountedRef.current) return
    setBusyKey(null)
    if (!res.ok) {
      setRowError((p) => ({ ...p, [key]: res.error }))
      return
    }
    setSources(getModelSources())
  }

  const mineCount = REGISTRY.filter((e) => sources.user?.[e.key]).length

  return (
    <div>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: LIGHT_INK }}>
            AI models
          </h3>
          <p className="text-[11px] leading-relaxed" style={{ color: LIGHT_INK }}>
            Which Claude model each WILSON function uses for you. Your choice
            beats your company&rsquo;s, which beats the platform default.
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          disabled={loading}
          className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm disabled:opacity-40"
          style={{ backgroundColor: 'rgba(120, 70, 30, 0.55)', color: '#fde8d0' }}
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <p className="text-[11px] mb-3 px-3 py-2 rounded-sm" style={{ backgroundColor: 'rgba(220,38,38,0.10)', color: '#991b1b' }}>
          {error}
        </p>
      )}

      {models.length === 0 && !loading && (
        <p className="text-[11px] mb-3 px-3 py-2 rounded-sm" style={{ backgroundColor: 'rgba(120,70,30,0.12)', color: LIGHT_INK }}>
          There are no models available for you to choose from yet. Everything
          still runs on its default — ask your administrator if you need a choice
          here.
        </p>
      )}

      <p className="text-[11px] mb-4" style={{ color: LIGHT_INK }}>
        {!areModelSourcesLoaded()
          // Distinguishing "nothing is set" from "nothing has loaded" matters:
          // both draw an identical screen, and only one of them is the truth.
          ? 'Loading your settings…'
          : mineCount === 0
            ? 'You have not overridden anything — every function follows your company or the platform.'
            : `You have overridden ${mineCount} of ${REGISTRY.length} functions.`}
      </p>

      {[...registryByTool().entries()].map(([tool, entries]) => (
        <div key={tool} className="mb-4">
          <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: LIGHT_INK }}>{tool}</div>
          <div className="rounded-sm" style={{ border: `1px solid ${LIGHT_RULE}` }}>
            {entries.map((entry, i) => {
              const mine = sources.user?.[entry.key] ?? ''
              const busy = busyKey === entry.key
              const err = rowError[entry.key]
              // Provenance ignoring the user tier — what this WOULD be if the
              // person cleared their own choice. That is the useful comparison;
              // showing their own value as "inherited" is what the S19 picker
              // got wrong.
              const withoutMe = provenance(
                entry.key, entry.tier,
                { workspace: sources.workspace, platform: sources.platform },
                BUILTIN[entry.tier],
              )
              const effort = efforts[entry.key] ?? entry.effort
              return (
                <div
                  key={entry.key}
                  className="px-3 py-2"
                  style={{
                    borderTop: i === 0 ? 'none' : `1px solid ${LIGHT_RULE}`,
                    backgroundColor: mine ? 'rgba(234, 88, 12, 0.05)' : 'transparent',
                  }}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex-1 min-w-0" style={{ minWidth: '200px' }}>
                      <div className="text-[11px]" style={{ color: LIGHT_INK }}>{entry.label}</div>
                      <div className="text-[10px]" style={{ color: LIGHT_INK }}>
                        {mine
                          ? `using ${labelFor(mine)} — your choice`
                          : `using ${labelFor(withoutMe.model)} — from ${withoutMe.from}`}
                        {effort && (
                          <span title="Set by the platform operator. Not company- or user-settable: it trades speed against quality on a call that runs against a hard deadline.">
                            {' · '}effort {effort}
                          </span>
                        )}
                      </div>
                    </div>

                    <select
                      value={mine}
                      disabled={busy || models.length === 0}
                      onChange={(e) => apply(entry.key, e.target.value)}
                      title={entry.hint || entry.label}
                      className="px-2 py-1 text-[11px] rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-40"
                      style={{ border: `1px solid ${LIGHT_RULE}`, color: LIGHT_INK, minWidth: '190px' }}
                    >
                      <option value="">Inherit ({labelFor(withoutMe.model)})</option>
                      {models.map((m) => (
                        <option key={m.model_id} value={m.model_id}>{m.label}</option>
                      ))}
                      {mine && !models.some((m) => m.model_id === mine) && (
                        <option value={mine}>{mine} (no longer offered)</option>
                      )}
                    </select>

                    {mine && (
                      <button
                        type="button"
                        onClick={() => apply(entry.key, '')}
                        disabled={busy}
                        className="flex items-center gap-1 text-[10px] disabled:opacity-40"
                        style={{ color: '#ea580c' }}
                      >
                        <RotateCcw size={11} /> Reset
                      </button>
                    )}
                  </div>

                  {err && <p className="text-[10px] mt-1" style={{ color: '#991b1b' }}>{err}</p>}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
