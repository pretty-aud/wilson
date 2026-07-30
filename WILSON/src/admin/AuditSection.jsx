// =============================================================================
// AuditSection — Session 15: the platform audit stream.
//
// Reads public.platform_audit DIRECTLY with the operator's own client, not
// through an Edge Function. That is the one cross-tenant read in this
// console that does not need service role, because 0028 gives the table a
// real operator SELECT policy (public.is_platform_operator(), live-row).
// Writes stay server-side — there is no INSERT policy and the privilege is
// revoked, so a certificate cannot be forged or edited from here even by an
// operator holding a valid session.
//
// What makes this table worth its own section rather than a tab in Logs:
// its rows OUTLIVE their subject. app_events and file_events both cascade
// away with the workspace, so after a teardown the only remaining record of
// a company having existed — and of what was destroyed — is here (gap #34).
//
// UX laws applied (≥5): Jakob's Law (a reverse-chronological log table with
// a filter, which is what every audit view looks like); Selective Attention
// (severity is a coloured dot, and destructive actions carry a red badge, so
// the teardown line is findable in a wall of routine rows); Chunking (the
// timestamp is split into date and time, and context JSON is collapsed
// behind the row rather than spilling into the table); Miller's Law (six
// columns, and the filter is a single select rather than a bank of
// checkboxes); Cognitive Load (the workspace column shows the SNAPSHOT name
// and slug — for a torn-down company that is the only readable identity
// left, and making the operator resolve a bare UUID would be cruel);
// Doherty Threshold (loads on first activation with a visible spinner, and
// the refresh button reports its own state).
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { supabase } from '../cloud/auth/supabaseClient'

const SEVERITY_DOT = {
  info: '#a8a29e',
  warning: '#fbbf24',
  error: '#dc2626',
  critical: '#7c2d12',
}

// Actions that destroy or spend. Everything else is bookkeeping.
const LOUD = new Set(['workspace.teardown', 'blob.purged', 'workspace.suspended'])

const ACTIONS = [
  ['', 'All actions'],
  ['workspace.created', 'Created'],
  ['workspace.renamed', 'Renamed'],
  ['workspace.suspended', 'Suspended'],
  ['workspace.restored', 'Restored'],
  ['workspace.teardown', 'Teardown'],
  ['blob.purged', 'Blobs purged'],
  ['ai_key.set', 'AI key set'],
  ['ai_key.cleared', 'AI key cleared'],
]

// PostgREST codes for "relation does not exist" — migration not deployed here
// yet. A brand-new environment should say so, not show a red error.
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205'])

const PAGE = 200

export default function AuditSection({ isActive }) {
  const [rows, setRows] = useState([])
  const [action, setAction] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [expanded, setExpanded] = useState(null)

  const mountedRef = useRef(true)
  const loadedRef = useRef(false)
  const seqRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const reload = useCallback(async (filterAction) => {
    const seq = ++seqRef.current
    setLoading(true)
    let q = supabase
      .from('platform_audit')
      .select('id, created_at, action, actor_label, workspace_id, workspace_slug, workspace_name, severity, message, context')
      .order('created_at', { ascending: false })
      .limit(PAGE)
    if (filterAction) q = q.eq('action', filterAction)
    const { data, error: err } = await q
    if (!mountedRef.current || seq !== seqRef.current) return
    setLoading(false)
    if (err) {
      if (MISSING_TABLE_CODES.has(err.code)) { setMissing(true); setRows([]); setError(''); return }
      setError(err.message)
      return
    }
    setMissing(false)
    setError('')
    setRows(data ?? [])
  }, [])

  useEffect(() => {
    if (!isActive || loadedRef.current) return
    loadedRef.current = true
    reload(action)
  }, [isActive, reload, action])

  return (
    <div className="pb-8" style={{ maxWidth: '900px' }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900">Platform audit</h2>
          <p className="text-xs text-stone-950 leading-relaxed">
            Append-only. Teardown certificates outlive the company they name.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={action}
            onChange={(e) => { setAction(e.target.value); reload(e.target.value) }}
            className="px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            style={{ backgroundColor: 'rgba(120, 70, 30, 0.55)', color: '#fde8d0', border: 'none' }}
          >
            {ACTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
          <button
            onClick={() => reload(action)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors disabled:opacity-40"
            style={{ backgroundColor: '#1c1917', color: '#f4a261' }}
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {missing && (
        <p className="text-[11px] mb-3 px-3 py-2 rounded-sm" style={{ backgroundColor: 'rgba(120,70,30,0.12)', color: '#57534e' }}>
          platform_audit is not deployed in this environment yet (migration 0028).
        </p>
      )}
      {error && (
        <p className="text-[11px] mb-3 px-3 py-2 rounded-sm" style={{ backgroundColor: 'rgba(220,38,38,0.10)', color: '#991b1b' }}>
          {error}
        </p>
      )}

      <div className="overflow-auto rounded-sm wilson-light-scroll" style={{ border: '1px solid #d6d3d1' }}>
        <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr style={{ backgroundColor: '#e7e5e4' }}>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-left" style={{ color: '#57534e', width: '150px' }}>When</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-left" style={{ color: '#57534e' }}>Action</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-left" style={{ color: '#57534e' }}>Company</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-left" style={{ color: '#57534e' }}>Operator</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-left" style={{ color: '#57534e' }}>Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && !missing && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-xs" style={{ color: '#78716c' }}>
                  Nothing recorded yet.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const d = new Date(r.created_at)
              const open = expanded === r.id
              return (
                <tr
                  key={r.id}
                  onClick={() => setExpanded(open ? null : r.id)}
                  className="cursor-pointer"
                  style={{ borderBottom: '1px solid #e7e5e4' }}
                >
                  <td className="px-3 py-2 align-top">
                    <div className="text-[11px] font-mono" style={{ color: '#1c1917' }}>{d.toLocaleDateString()}</div>
                    <div className="text-[10px] font-mono" style={{ color: '#78716c' }}>{d.toLocaleTimeString()}</div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block rounded-full flex-shrink-0"
                        style={{ width: 7, height: 7, backgroundColor: SEVERITY_DOT[r.severity] ?? '#a8a29e' }}
                      />
                      <span
                        className="text-[10px] font-bold uppercase tracking-wider"
                        style={{ color: LOUD.has(r.action) ? '#991b1b' : '#57534e' }}
                      >
                        {r.action.replace('workspace.', '').replace('ai_key.', 'key ').replace('.', ' ')}
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="text-[11px]" style={{ color: '#1c1917' }}>{r.workspace_name ?? '—'}</div>
                    {r.workspace_slug && (
                      <code className="text-[10px] font-mono" style={{ color: '#78716c' }}>{r.workspace_slug}</code>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span className="text-[11px] font-mono" style={{ color: '#57534e' }}>{r.actor_label ?? '—'}</span>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="text-[11px]" style={{ color: '#1c1917' }}>{r.message}</div>
                    {open && r.context && Object.keys(r.context).length > 0 && (
                      <pre
                        className="mt-1 text-[10px] font-mono p-2 rounded-sm whitespace-pre-wrap break-all"
                        style={{ backgroundColor: 'rgba(120,70,30,0.10)', color: '#57534e' }}
                      >{JSON.stringify(r.context, null, 2)}</pre>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {rows.length >= PAGE && (
        <p className="text-[10px] mt-2" style={{ color: '#78716c' }}>
          Showing the most recent {PAGE} entries.
        </p>
      )}
    </div>
  )
}
