// =============================================================================
// SignInsSection — Track B bundle B2, part 2: operator sign-ins, the mirror
// of the Admin Terminal's Sign-ins tab for the platform tier (TPN-LOG-007:
// "Platform Operator Console access is entirely unlogged").
//
// Reads public.auth_events DIRECTLY with the operator's own client — 0070's
// SELECT policy gives an operator every row — and narrows it to the user ids
// in public.platform_operators, which 0028 lets an operator list. So the
// rows here are: every password check and two-factor challenge the sign-in
// server ran for an operator account (hook rows, no address, no surface —
// GoTrue does not know which door was knocked on), and the console's and
// the app's own sign-in / sign-out / timeout rows for the same accounts
// (client rows, with the address and the surface). The same person holding
// a /wilson session and a /wilsonadmin session shows up under both doors;
// the Surface column is how you tell them apart.
//
// Names: the sign-in server knows an operator only by id, and this console
// deliberately reads nothing from auth.users. Your own row says "you"; the
// others show the id's first eight characters. With one to three operators
// on the platform that is enough to recognise; it is not a people directory.
//
// Unknown-username attempts are NOT here: they never reach GoTrue and live in
// auth_attempt_log, which an operator can also read but which is a different
// thing (resolve-login's log of names typed at the door). A future tab.
//
// UX laws applied (≥5): Jakob's Law (the AuditSection table, column for
// column, so an operator who knows Audit knows this); Selective Attention
// (failures carry a red dot and a red label; everything else is quiet);
// Chunking (date over time, as in Audit); Miller's Law (six columns, one
// filter); Cognitive Load (no charts, no counts to interpret — the rows and
// when they happened); Doherty (first activation loads with a spinner and the
// refresh button reports its own state).
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { supabase } from '../cloud/auth/supabaseClient'
import {
  describeAuthEvent, surfaceOf, sourceLabel, KIND_FILTERS, matchesFilter,
  ADDRESS_LEGEND, AUTH_EVENT_COLUMNS,
} from '../cloud/auth/authEventLabels'

const TONE_DOT = { ok: '#16a34a', bad: '#dc2626', neutral: '#a8a29e' }
const TONE_INK = { ok: '#166534', bad: '#991b1b', neutral: '#57534e' }
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205'])
const PAGE = 200

export default function SignInsSection({ isActive, selfUserId = null, selfEmail = '' }) {
  const [rows, setRows] = useState([])
  const [operatorIds, setOperatorIds] = useState([])
  const [filter, setFilter] = useState('')
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

  const reload = useCallback(async () => {
    const seq = ++seqRef.current
    setLoading(true)
    setError('')
    // 1. who the operators are (0028's operator-read arm on platform_operators)
    const { data: ops, error: opsErr } = await supabase
      .from('platform_operators')
      .select('user_id, granted_at')
    if (!mountedRef.current || seq !== seqRef.current) return
    if (opsErr) {
      setLoading(false)
      setError(opsErr.message)
      return
    }
    const ids = (ops ?? []).map(o => o.user_id).filter(Boolean)
    setOperatorIds(ids)
    if (ids.length === 0) {
      setLoading(false)
      setRows([])
      return
    }
    // 2. their rows (0070's operator arm on auth_events sees every row; the
    //    .in() is the mirror's scope, not the policy's)
    const { data, error: err } = await supabase
      .from('auth_events')
      .select(AUTH_EVENT_COLUMNS)
      .in('user_id', ids)
      .order('created_at', { ascending: false })
      .limit(PAGE)
    if (!mountedRef.current || seq !== seqRef.current) return
    setLoading(false)
    if (err) {
      if (MISSING_TABLE_CODES.has(err.code)) { setMissing(true); setRows([]); return }
      setError(err.message)
      return
    }
    setMissing(false)
    setRows(Array.isArray(data) ? data : [])
  }, [])

  useEffect(() => {
    if (!isActive || loadedRef.current) return
    loadedRef.current = true
    reload()
  }, [isActive, reload])

  const visible = rows.filter(r => matchesFilter(r, filter))

  return (
    <div className="pb-8" style={{ maxWidth: '980px' }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900">Operator sign-ins</h2>
          <p className="text-xs text-stone-950 leading-relaxed">
            Every password check and two-factor challenge for a platform operator, from the sign-in server,
            plus the console&rsquo;s and the app&rsquo;s own sign-in, sign-out and timeout rows.
            {operatorIds.length > 0 && <> {operatorIds.length} operator{operatorIds.length === 1 ? '' : 's'} on this platform.</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            style={{ backgroundColor: 'rgba(120, 70, 30, 0.55)', color: '#fde8d0', border: 'none' }}
          >
            {KIND_FILTERS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
          <button
            onClick={() => reload()}
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
          auth_events is not deployed in this environment yet (migration 0070).
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
              <Th style={{ width: '150px' }}>When</Th>
              <Th>Event</Th>
              <Th>Who</Th>
              <Th>Surface</Th>
              <Th>Address</Th>
              <Th>Factor</Th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && !loading && !missing && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-xs" style={{ color: '#78716c' }}>
                  {rows.length === 0 ? 'Nothing recorded yet.' : 'No rows match the filter.'}
                </td>
              </tr>
            )}
            {visible.map((r) => {
              const d = new Date(r.created_at)
              const { label, tone } = describeAuthEvent(r)
              const surface = surfaceOf(r)
              const isSelf = selfUserId && r.user_id === selfUserId
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
                      <span className="inline-block rounded-full flex-shrink-0" style={{ width: 7, height: 7, backgroundColor: TONE_DOT[tone] }} />
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: TONE_INK[tone] }}>{label}</span>
                    </span>
                    <div className="text-[10px]" style={{ color: '#78716c' }}>{sourceLabel(r)}</div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="text-[11px] font-mono" style={{ color: '#1c1917' }}>
                      {isSelf ? (selfEmail || 'you') : String(r.user_id ?? '').slice(0, 8)}
                    </div>
                    <div className="text-[10px]" style={{ color: '#78716c' }}>{isSelf ? 'you' : 'operator'}</div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span className="text-[11px] font-mono" style={{ color: '#57534e' }}>
                      {surface === 'admin' ? 'console' : surface === 'app' ? 'app' : '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span className="text-[11px] font-mono" style={{ color: '#57534e' }}>{r.ip_address ?? '—'}</span>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span className="text-[11px] font-mono" style={{ color: '#57534e' }}>{r.factor_type ?? '—'}</span>
                    {open && (
                      <pre
                        className="mt-1 text-[10px] font-mono p-2 rounded-sm whitespace-pre-wrap break-all"
                        style={{ backgroundColor: 'rgba(120,70,30,0.10)', color: '#57534e' }}
                      >{JSON.stringify({ user_id: r.user_id, session_id: r.session_id, user_agent: r.user_agent, context: r.context }, null, 2)}</pre>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] mt-2" style={{ color: '#78716c' }}>
        {ADDRESS_LEGEND}{rows.length >= PAGE ? ` Showing the most recent ${PAGE} rows.` : ''}
      </p>
    </div>
  )
}

function Th({ children, style }) {
  return (
    <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-left" style={{ color: '#57534e', ...style }}>
      {children}
    </th>
  )
}
