// =============================================================================
// AIFilesSection — FX12 (post-overhaul, 2026-10-25, OUTSTANDING DG1-03): the
// operator's face of the AI provider's file store.
//
// The platform key's store is ONE locker shared by wilson-dev, wilson-staging
// and wilson-prod and every company on each. This section reads it through
// operator-ai-files as COUNTS only (never an id, a company's name or a
// filename) and sweeps what THIS environment's upload rows tie to a company
// and is older than the sweep's age. Everything else is counted and left
// alone: another environment's files (its own sweep takes them), a row that
// does not match its file, a file two companies' rows claim.
//
// The same grammar as ModelsSection (the 900px column, the light table, the
// dark buttons) and the same rule as storage-gc: admin-invoked, a stated
// confirm, the certified counts shown after, one platform_audit row.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'
import { aiFilesSummary, sweepAiFiles, isMissingFunction } from './operatorApi'
import { formatBytes } from '../cloud/workspaceStorage'

const th = { color: '#57534e' }
const td = { color: '#1c1917' }

/** "2 days", "30 hours": an oldest file's age. */
function age(iso) {
  const t = Date.parse(iso || '')
  if (!Number.isFinite(t)) return '—'
  const h = Math.max(0, Math.floor((Date.now() - t) / 3600000))
  if (h < 1) return 'under an hour'
  if (h < 48) return `${h} hours`
  return `${Math.floor(h / 24)} days`
}

export default function AIFilesSection({ isActive }) {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [stage, setStage] = useState('idle') // idle | confirm | running
  const [notice, setNotice] = useState('')
  const mountedRef = useRef(true)
  const loadedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    const res = await aiFilesSummary()
    if (!mountedRef.current) return
    setLoading(false)
    if (isMissingFunction(res)) { setMissing(true); return }
    if (!res.ok) { setError(res.data?.friendly ?? 'Could not read the AI file store.'); return }
    setMissing(false)
    setError('')
    setSummary(res.data)
  }, [])

  useEffect(() => {
    if (!isActive || loadedRef.current) return
    loadedRef.current = true
    reload()
  }, [isActive, reload])

  const onSweep = async () => {
    setStage('running')
    setError('')
    setNotice('')
    const res = await sweepAiFiles()
    if (!mountedRef.current) return
    setStage('idle')
    if (!res.ok) { setError(res.data?.friendly ?? 'The sweep failed part-way — check the audit log.'); return }
    const c = res.data.counts || {}
    setNotice(
      `Deleted ${c.deleted ?? 0} file(s) across ${c.workspaces ?? 0} compan${c.workspaces === 1 ? 'y' : 'ies'}.`
      + (c.gone ? ` ${c.gone} already gone.` : '')
      + (c.failed ? ` ${c.failed} FAILED (see Audit, blob.purged).` : '')
      + (c.skipped_recent ? ` Kept ${c.skipped_recent} younger than ${c.older_than_hours ?? 24} hours.` : '')
      + (c.certify_failed ? ` ${c.certify_failed} certificate write(s) FAILED.` : '')
      + (c.truncated ? ' More are waiting: run it again.' : ''),
    )
    if (res.data.after) setSummary(s => ({ ...(s || {}), counts: res.data.after }))
  }

  const c = summary?.counts
  const hours = summary?.older_than_hours ?? 24
  const rows = c ? [
    ['In the store (every environment)', c.all],
    ['Tied to a company of this environment', c.attributed],
    ['No receipt here (another environment’s): left alone', c.no_row],
    ['A receipt that does not match its file: left alone', c.unbound],
    ['Claimed by two companies: left alone', c.contested],
  ] : []
  const sweepable = c?.attributed?.sweepable ?? 0

  return (
    <div className="pb-8" style={{ maxWidth: '900px' }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-h3 font-semibold text-stone-900">AI files</h2>
          <p className="text-dense text-stone-950">
            What D.O.G. has left in the AI provider&rsquo;s file store under the platform key, as counts.
            The key is shared by every environment, so only files this environment&rsquo;s records tie to a company are ever deleted here.
          </p>
        </div>
        <button
          onClick={reload}
          disabled={loading || stage === 'running'}
          className="flex items-center gap-1.5 px-3 py-1.5 text-dense font-semibold rounded-control transition-colors disabled:opacity-40"
          style={{ backgroundColor: '#1c1917', color: '#f4a261' }}
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {missing && (
        <p className="text-dense mb-3 px-3 py-2 rounded-control" style={{ backgroundColor: 'rgba(120,70,30,0.12)', color: '#57534e' }}>
          operator-ai-files is not deployed in this environment yet (FX12).
        </p>
      )}
      {error && (
        <p className="text-dense mb-3 px-3 py-2 rounded-control" style={{ backgroundColor: 'rgba(220,38,38,0.10)', color: '#991b1b' }}>
          {error}
        </p>
      )}
      {notice && (
        <p className="text-dense mb-3 px-3 py-2 rounded-control" style={{ backgroundColor: 'rgba(120,70,30,0.12)', color: '#57534e' }}>
          {notice}
        </p>
      )}

      {c && (
        <div className="overflow-auto rounded-control wilson-light-scroll mb-3" style={{ border: '1px solid #d6d3d1' }}>
          <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr style={{ backgroundColor: '#e7e5e4' }}>
                <th className="px-3 py-2 text-label font-semibold uppercase text-left" style={th} />
                <th className="px-3 py-2 text-label font-semibold uppercase text-right" style={{ ...th, width: '90px' }}>Files</th>
                <th className="px-3 py-2 text-label font-semibold uppercase text-right" style={{ ...th, width: '110px' }}>Size</th>
                <th className="px-3 py-2 text-label font-semibold uppercase text-right" style={{ ...th, width: '130px' }}>Oldest</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, t]) => (
                <tr key={label} style={{ borderBottom: '1px solid #e7e5e4' }}>
                  <td className="px-3 py-2 text-dense" style={td}>{label}</td>
                  <td className="px-3 py-2 text-dense text-right font-mono" style={td}>{t?.count ?? 0}</td>
                  <td className="px-3 py-2 text-dense text-right font-mono" style={td}>{formatBytes(t?.total_bytes ?? 0)}</td>
                  <td className="px-3 py-2 text-dense text-right" style={td}>{t?.count ? age(t.oldest) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {c && (
        <p className="text-dense mb-3" style={{ color: '#78716c' }}>
          {c.attributed?.workspaces ?? 0} compan{c.attributed?.workspaces === 1 ? 'y has' : 'ies have'} files here; {sweepable} of them
          {' '}{sweepable === 1 ? 'is' : 'are'} older than {hours} hours. {c.expired ?? 0} in the store have expired (their content is gone; the store keeps a name for up to 30 days).
          {summary?.truncated && ' The store’s list was longer than one run reads: the counts are partial.'}
        </p>
      )}

      {stage === 'confirm' ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-dense font-semibold" style={{ color: '#991b1b' }}>
            Permanently delete {sweepable} file{sweepable === 1 ? '' : 's'} older than {hours} hours, across every company of this environment?
          </span>
          <button
            onClick={onSweep}
            className="flex items-center gap-1.5 px-3 py-1.5 text-dense font-semibold rounded-control"
            style={{ backgroundColor: '#991b1b', color: '#fff' }}
          >
            <Trash2 size={12} /> Yes, delete
          </button>
          <button
            onClick={() => setStage('idle')}
            className="px-3 py-1.5 text-dense font-semibold rounded-control"
            style={{ border: '1px solid #d6d3d1', color: '#1c1917' }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setStage('confirm')}
          disabled={!c || loading || stage === 'running' || sweepable === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 text-dense font-semibold rounded-control disabled:opacity-40"
          style={{ backgroundColor: 'rgba(120, 70, 30, 0.55)', color: '#fde8d0' }}
        >
          <Trash2 size={12} /> {stage === 'running' ? 'Deleting…' : `Delete files older than ${hours} hours`}
        </button>
      )}
    </div>
  )
}
