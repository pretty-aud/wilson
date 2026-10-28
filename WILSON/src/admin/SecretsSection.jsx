// =============================================================================
// SecretsSection — P8 (TPN-ENC-015, night 5, 2026-10-28): the operator's face
// of the two master secrets that seal every company's Anthropic key
// (WILSON_AI_KEY_SECRET) and bucket secret (WILSON_STORAGE_KEY_SECRET) on
// THIS environment.
//
// What it shows is names and counts: the versions this environment holds
// (the unsuffixed name is version 1, _V2 and up the rest), the version a new
// row is sealed under (the highest present), and how many rows each table
// holds under each version. What it does is the re-seal: every row sealed
// under another version is opened and sealed again under the current one,
// certified by one platform_audit row (secret.resealed) that carries the
// counts. Never a value: operator-ai-keys never returns one and this section
// never asks for one.
//
// The order matters and is said before the button does anything: every
// reader of the secret must have been redeployed on this environment BEFORE
// the re-seal (a reader built before P8 cannot open a v2 envelope). The
// steps are docs/PRODUCTION_RUNBOOK.md (d), "The re-seal on dev and staging".
//
// The same grammar as AIFilesSection (the 900px column, the light table, the
// dark buttons).
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, Lock } from 'lucide-react'
import { secretsStatus, resealSecret, isMissingFunction } from './operatorApi'

const th = { color: '#57534e' }
const td = { color: '#1c1917' }

/** The functions that open each secret: redeployed on this environment before its re-seal. */
export const READERS = {
  ai: ['ai-proxy', 'ai-files', 'operator-ai-keys'],
  storage: ['storage-presign', 'storage-gc', 'storage-read-urls', 'storage-secret', 'operator-ai-keys'],
}
const TITLES = { ai: 'Company AI keys', storage: 'Bucket secrets' }
const BASES = { ai: 'WILSON_AI_KEY_SECRET', storage: 'WILSON_STORAGE_KEY_SECRET' }

/** "v1: 3 · v2: 1", in version order. */
export function rowsByVersionText(byVersion) {
  const entries = Object.entries(byVersion || {}).sort(([a], [b]) => Number(a) - Number(b))
  return entries.length ? entries.map(([v, c]) => `v${v}: ${c}`).join(' · ') : 'none'
}

/** The rows sealed under a version other than the current one. */
export function rowsBehind(status) {
  const current = status?.current ?? null
  return Object.entries(status?.rows_by_version || {})
    .filter(([v]) => Number(v) !== current)
    .reduce((n, [, c]) => n + c, 0)
}

function Card({ which, status, onReseal, busy }) {
  const [stage, setStage] = useState('idle') // idle | confirm
  const current = status?.current ?? null
  const names = status?.names_present ?? []
  const behind = rowsBehind(status)
  return (
    <div className="rounded-float border p-4 mb-4" style={{ borderColor: '#e7e5e4', background: '#fff' }}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-h3 font-semibold" style={td}>{TITLES[which]}</h3>
        <span className="text-caption" style={th}>{BASES[which]}</span>
      </div>
      {status?.error ? (
        <p className="text-dense" style={{ color: '#b91c1c' }} data-testid={`${which}-error`}>{status.error}</p>
      ) : (
        <>
          <table className="w-full text-dense mb-3">
            <tbody>
              <tr>
                <td style={th} className="py-1 pr-4">Versions set here</td>
                <td style={td} data-testid={`${which}-versions`}>{names.length ? names.join(', ') : 'none'}</td>
              </tr>
              <tr>
                <td style={th} className="py-1 pr-4">New rows are sealed under</td>
                <td style={td} data-testid={`${which}-current`}>
                  {current === null ? 'nothing (not configured on this environment)' : `version ${current} (${current === 1 ? BASES[which] : `${BASES[which]}_V${current}`})`}
                </td>
              </tr>
              <tr>
                <td style={th} className="py-1 pr-4">Rows, by the version they are sealed under</td>
                <td style={td} data-testid={`${which}-rows`}>{rowsByVersionText(status?.rows_by_version)}</td>
              </tr>
            </tbody>
          </table>
          {stage === 'idle' ? (
            <button
              type="button"
              disabled={busy || current === null || behind === 0}
              onClick={() => setStage('confirm')}
              className="rounded-control px-3 py-1.5 text-dense text-white disabled:opacity-40"
              style={{ background: '#1c1917' }}
              data-testid={`${which}-reseal`}
            >
              {current === null ? 'Not configured' : behind === 0 ? 'Nothing to re-seal' : `Re-seal ${behind} row${behind === 1 ? '' : 's'} under version ${current}`}
            </button>
          ) : (
            <div className="rounded-control border p-3 text-dense" style={{ borderColor: '#fcd34d', background: '#fffbeb', ...td }} data-testid={`${which}-confirm`}>
              <p className="mb-2">
                Before this, every reader of {BASES[which]} must have been redeployed on this environment: {READERS[which].join(', ')}.
                A reader built before the versions cannot open a row sealed under version {current}, and the rows are re-sealed at once.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => { setStage('idle'); onReseal(which) }}
                  className="rounded-control px-3 py-1.5 text-dense text-white"
                  style={{ background: '#1c1917' }}
                  data-testid={`${which}-reseal-confirm`}
                >
                  They are redeployed — re-seal now
                </button>
                <button type="button" disabled={busy} onClick={() => setStage('idle')} className="rounded-control px-3 py-1.5 text-dense" style={{ border: '1px solid #d6d3d1', ...td }}>
                  Not yet
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function SecretsSection({ isActive }) {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [notice, setNotice] = useState('')
  const mountedRef = useRef(true)
  const loadedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // keepError: a reload after a failed re-seal keeps that failure's sentence on screen.
  const reload = useCallback(async (keepError = false) => {
    setLoading(true)
    const res = await secretsStatus()
    if (!mountedRef.current) return
    setLoading(false)
    if (isMissingFunction(res)) { setMissing(true); return }
    if (!res.ok) { setError(res.data?.friendly ?? 'Could not read the secrets’ status.'); return }
    setMissing(false)
    if (!keepError) setError('')
    setStatus(res.data)
  }, [])

  useEffect(() => {
    if (!isActive || loadedRef.current) return
    loadedRef.current = true
    reload()
  }, [isActive, reload])

  const onReseal = async (which) => {
    setBusy(true)
    setError('')
    setNotice('')
    const res = await resealSecret(which)
    if (!mountedRef.current) return
    setBusy(false)
    if (!res.ok) {
      setError(res.data?.friendly ?? 'The re-seal failed part-way — check the audit log.')
      await reload(true)
      return
    }
    const r = res.data || {}
    setNotice(`${TITLES[which]}: ${r.resealed ?? 0} re-sealed under version ${r.to_version}, ${r.skipped ?? 0} already there${r.unchanged ? `, ${r.unchanged} changed meanwhile and left` : ''}, ${r.failed ?? 0} failed.`)
    await reload()
  }

  return (
    <section className="p-6" style={{ maxWidth: 900 }}>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-h2 font-semibold flex items-center gap-2" style={td}><Lock size={18} /> Secrets</h2>
        <button type="button" onClick={() => reload()} disabled={loading} className="text-dense flex items-center gap-1" style={th}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      <p className="text-body mb-4" style={th}>
        The two master secrets that seal every company’s AI key and bucket secret on this environment, by version.
        Names and counts only; no value is ever shown or sent.
      </p>
      {missing && <p className="text-dense mb-3" style={th} data-testid="secrets-missing">operator-ai-keys is not deployed on this environment yet.</p>}
      {error && <p className="text-dense mb-3" style={{ color: '#b91c1c' }} data-testid="secrets-error">{error}</p>}
      {notice && <p className="text-dense mb-3" style={{ color: '#166534' }} data-testid="secrets-notice">{notice}</p>}
      {status && <Card which="ai" status={status.ai} onReseal={onReseal} busy={busy} />}
      {status && <Card which="storage" status={status.storage} onReseal={onReseal} busy={busy} />}
    </section>
  )
}
