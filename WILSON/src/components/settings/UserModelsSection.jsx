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
import './settings.css'
import { Section, Group } from './SettingsChrome'
import { Button, Select } from '../../ui'

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
    // S13: this heading was the only `h3 text-xs` among twelve `h2 text-sm`,
    // the only one in sentence case and the only one with a right-hand
    // control — three deviations in one header. It is a Section like every
    // other, and Refresh is in the standard actions slot.
    <Section
      first
      title="AI models"
      description={<>
        Which Claude model each WILSON function uses for you. Your choice
        beats your company&rsquo;s, which beats the platform default.
      </>}
      actions={
        <Button surface="light" size="sm" onClick={reload} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" /> Refresh
        </Button>
      }
    >
      {error && (
        <p className="s-feedback mb-4" data-tone="error" role="alert">{error}</p>
      )}

      {models.length === 0 && !loading && (
        <p className="s-feedback mb-4" data-tone="neutral" role="status">
          There are no models available for you to choose from yet. Everything
          still runs on its default — ask your administrator if you need a choice
          here.
        </p>
      )}

      <p className="s-row-desc mb-4">
        {!areModelSourcesLoaded()
          // Distinguishing "nothing is set" from "nothing has loaded" matters:
          // both draw an identical screen, and only one of them is the truth.
          ? 'Loading your settings…'
          : mineCount === 0
            ? 'You have not overridden anything — every function follows your company or the platform.'
            : `You have overridden ${mineCount} of ${REGISTRY.length} functions.`}
      </p>

      {/* H4: 29 controls on one screen. The three tool groups were the right
          instinct and now read as groups — an eyebrow per group with a count
          of what is overridden in it, so a user can see which group needs
          attention without opening anything. No control is hidden. */}
      {[...registryByTool().entries()].map(([tool, entries]) => {
        const mineHere = entries.filter((e) => sources.user?.[e.key]).length
        return (
        <Group
          key={tool}
          label={tool}
          actions={<span className="s-row-desc">{mineHere} of {entries.length} overridden</span>}
        >
          <div>
            {entries.map((entry) => {
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
                  className="s-model-row px-3 py-2"
                  data-overridden={!!mine}
                >
                  <div className="s-model-main">
                      <div className="s-row-desc" style={{ fontWeight: 600 }}>{entry.label}</div>
                      <div className="s-row-desc">
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

                    {/* 🚨 S28, and a live C9 breach: this select set a border
                        and a colour but NO background, so Chrome painted its
                        near-white UA ButtonFace on the orange page — 28 times,
                        because it is inside a map. The kit Select brings the
                        well-light surface with it. */}
                    <div className="s-model-select">
                      <Select
                        surface="light"
                        size="sm"
                        value={mine}
                        disabled={busy || models.length === 0}
                        onChange={(v) => apply(entry.key, v || '')}
                        title={entry.hint || entry.label}
                        aria-label={`Model for ${entry.label}`}
                        className="w-full"
                        options={[
                          { value: '', label: `Inherit (${labelFor(withoutMe.model)})` },
                          ...models.map((m) => ({ value: m.model_id, label: m.label })),
                          ...(mine && !models.some((m) => m.model_id === mine)
                            ? [{ value: mine, label: `${mine} (no longer offered)` }]
                            : []),
                        ]}
                      />
                    </div>

                    {/* The reset slot is RESERVED whether or not it renders,
                        so a conditional button can no longer push a row to
                        wrap and the column stays a column down all 28 rows. */}
                    <div className="s-model-reset">
                      {mine && (
                        <Button
                          surface="light"
                          size="sm"
                          variant="ghost"
                          Icon={RotateCcw}
                          onClick={() => apply(entry.key, '')}
                          disabled={busy}
                        >
                          Reset
                        </Button>
                      )}
                    </div>

                  {err && <p className="s-feedback" data-tone="error" role="alert">{err}</p>}
                </div>
              )
            })}
          </div>
        </Group>
        )
      })}
    </Section>
  )
}
