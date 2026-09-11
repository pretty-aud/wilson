// =============================================================================
// LogsSection — System (app_events) and Activity (edit_history) streams
// (Session 9).
//
// UX laws embodied:
//   Hick's Law — two tabs, two selects, one refresh; nothing else.
//   Doherty Threshold — refresh spinner + instant client-side filtering
//     over the fetched 100 rows.
//   Jakob's Law — same chip-tab + light-table grammar as the rest of the app.
//
// RLS: app_events is admin-only, edit_history admin/manager — both queries
// ride the signed-in client. Missing-table errors ('42P01'/'PGRST205') are
// a legitimate pre-deploy state, not a failure.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, ScrollText, Loader2 } from 'lucide-react'
import { supabase } from '../../cloud/auth/supabaseClient'
import { describeErrorCode } from '../../cloud/errorCodes'
import {
  LIGHT_INK, LIGHT_RULE, LIGHT_TABLE_FRAME, LIGHT_TABLE_HEAD_ROW,
} from '../lightSurface' // §B — light page

const EVENT_TYPES = ['auth', 'admin', 'error', 'system', 'update', 'storage', 'realtime']
const SEVERITIES = ['info', 'warning', 'error', 'critical']
const SEVERITY_DOT = {
  // `info` was stone-400, which measures 1.4:1 against this page — the dot
  // that means "nothing is wrong" was the one you could not see. A tint of
  // the ink reads as neutral without disappearing.
  info: 'rgba(28, 25, 23, 0.45)', warning: '#fbbf24', error: '#dc2626', critical: '#7c2d12',
}
// PostgREST codes for "relation does not exist" — table not deployed yet.
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205'])

const lightSelectStyle = {
  backgroundColor: 'rgba(120, 70, 30, 0.55)',
  color: '#fde8d0',
  border: 'none',
}

function fmtAbs(iso) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
}

function timeAgo(iso) {
  if (!iso) return '--'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '--'
  const mins = Math.floor((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function LogsSection({ isActive, workspaceId }) {
  const [tab, setTab] = useState('system')

  // System stream
  const [events, setEvents] = useState([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [eventsError, setEventsError] = useState(null)
  const [eventsMissing, setEventsMissing] = useState(false)
  const [typeFilter, setTypeFilter] = useState('')
  const [sevFilter, setSevFilter] = useState('')
  const [expandedId, setExpandedId] = useState(null)

  // Activity stream
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState(null)
  const [historyMissing, setHistoryMissing] = useState(false)

  // StrictMode-safe mounted flag: body sets true, cleanup sets false.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const eventsSeqRef = useRef(0)
  const eventsLoadedRef = useRef(false)
  async function loadEvents() {
    if (!workspaceId) return
    const seq = ++eventsSeqRef.current
    setEventsLoading(true)
    setEventsError(null)
    try {
      const { data, error } = await supabase
        .from('app_events')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(100)
      if (!mountedRef.current || seq !== eventsSeqRef.current) return
      if (error) {
        if (MISSING_TABLE_CODES.has(error.code)) {
          setEventsMissing(true)
          setEvents([])
        } else {
          setEventsError(error.message || String(error))
        }
      } else {
        setEventsMissing(false)
        setEvents(Array.isArray(data) ? data : [])
      }
    } catch (err) {
      if (!mountedRef.current || seq !== eventsSeqRef.current) return
      setEventsError(err?.message || String(err))
    } finally {
      if (mountedRef.current && seq === eventsSeqRef.current) setEventsLoading(false)
    }
  }

  const historySeqRef = useRef(0)
  const historyLoadedRef = useRef(false)
  async function loadHistory() {
    if (!workspaceId) return
    const seq = ++historySeqRef.current
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const { data, error } = await supabase
        .from('edit_history')
        .select('id, entity_type, entity_id, actor_label, action, created_at')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(100)
      if (!mountedRef.current || seq !== historySeqRef.current) return
      if (error) {
        if (MISSING_TABLE_CODES.has(error.code)) {
          setHistoryMissing(true)
          setHistory([])
        } else {
          setHistoryError(error.message || String(error))
        }
      } else {
        setHistoryMissing(false)
        setHistory(Array.isArray(data) ? data : [])
      }
    } catch (err) {
      if (!mountedRef.current || seq !== historySeqRef.current) return
      setHistoryError(err?.message || String(err))
    } finally {
      if (mountedRef.current && seq === historySeqRef.current) setHistoryLoading(false)
    }
  }

  // Lazy-load: nothing until the section is opened; the Activity stream
  // additionally waits for its tab's first activation.
  useEffect(() => {
    if (!isActive || !workspaceId) return
    if (!eventsLoadedRef.current) {
      eventsLoadedRef.current = true
      loadEvents()
    }
    if (tab === 'activity' && !historyLoadedRef.current) {
      historyLoadedRef.current = true
      loadHistory()
    }
    // loadEvents/loadHistory are stable within a render's closure; seq refs
    // make duplicate invocations harmless anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, tab, workspaceId])

  const visibleEvents = useMemo(() => events
    .filter(e => !typeFilter || e.event_type === typeFilter)
    .filter(e => !sevFilter || e.severity === sevFilter), [events, typeFilter, sevFilter])

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Tab chips */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex items-center gap-1 rounded-sm p-0.5" style={{ backgroundColor: 'rgba(120, 70, 30, 0.18)' }}>
          {[{ key: 'system', label: 'System' }, { key: 'activity', label: 'Activity' }].map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="at-chip px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors"
              data-active={String(tab === t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'system' && (
          <>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-2 py-1.5 text-[11px] font-mono rounded-sm focus:ring-2 focus:ring-orange-500 cursor-pointer"
              style={lightSelectStyle}
            >
              <option value="">All types</option>
              {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select
              value={sevFilter}
              onChange={(e) => setSevFilter(e.target.value)}
              className="px-2 py-1.5 text-[11px] font-mono rounded-sm focus:ring-2 focus:ring-orange-500 cursor-pointer"
              style={lightSelectStyle}
            >
              <option value="">All severities</option>
              {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => (tab === 'system' ? loadEvents() : loadHistory())}
          disabled={tab === 'system' ? eventsLoading : historyLoading}
          className="at-disable-50 flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors"
          style={{ backgroundColor: '#1c1917', color: '#f4a261' }}
        >
          {(tab === 'system' ? eventsLoading : historyLoading)
            ? <Loader2 className="w-3 h-3 animate-spin" />
            : <RefreshCw className="w-3 h-3" />}
          Refresh
        </button>
      </div>

      {tab === 'system' ? (
        <SystemTable
          events={visibleEvents}
          allCount={events.length}
          loading={eventsLoading}
          error={eventsError}
          missing={eventsMissing}
          expandedId={expandedId}
          onToggleExpand={(id) => setExpandedId(prev => (prev === id ? null : id))}
        />
      ) : (
        <ActivityTable
          rows={history}
          loading={historyLoading}
          error={historyError}
          missing={historyMissing}
        />
      )}
    </div>
  )
}

function SystemTable({ events, allCount, loading, error, missing, expandedId, onToggleExpand }) {
  if (error) {
    return (
      <div className="text-xs font-mono px-3 py-2 rounded-sm" style={{ backgroundColor: 'rgba(220, 38, 38, 0.1)', color: '#dc2626' }}>
        {error}
      </div>
    )
  }
  if (missing) return <EmptyState text="Log stream not deployed yet." />
  if (loading && events.length === 0) return <EmptyState text="Loading..." />
  if (events.length === 0) {
    return <EmptyState text={allCount === 0 ? 'No events yet.' : 'No events match the filters.'} />
  }
  return (
    <div className="overflow-auto flex-1 rounded-sm wilson-light-scroll" style={{ border: '1px solid #d6d3d1', maxHeight: '100%' }}>
      <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead>
          <tr style={LIGHT_TABLE_HEAD_ROW}>
            <ThLight>Time</ThLight>
            <ThLight>Sev</ThLight>
            <ThLight>Type</ThLight>
            <ThLight>Code</ThLight>
            <ThLight>Actor</ThLight>
            <ThLight>Message</ThLight>
          </tr>
        </thead>
        <tbody>
          {events.map(e => (
            <SystemRow
              key={e.id}
              event={e}
              expanded={expandedId === e.id}
              onToggle={() => onToggleExpand(e.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SystemRow({ event, expanded, onToggle }) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="at-log-row cursor-pointer"
        data-expanded={String(expanded)}
      >
        <TdLight>
          <span className="text-xs font-mono whitespace-nowrap" style={{ color: LIGHT_INK }} title={fmtAbs(event.created_at)}>
            {timeAgo(event.created_at)}
          </span>
        </TdLight>
        <TdLight>
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ backgroundColor: SEVERITY_DOT[event.severity] || 'rgba(28, 25, 23, 0.45)' }}
            title={event.severity}
          />
        </TdLight>
        <TdLight>
          <span className="text-xs font-mono" style={{ color: LIGHT_INK }}>{event.event_type}</span>
        </TdLight>
        <TdLight>
          {event.code ? (
            <span
              className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm"
              style={{ backgroundColor: 'rgba(120, 70, 30, 0.12)', color: '#1c1917' }}
              title={describeErrorCode(event.code)}
            >
              {event.code}
            </span>
          ) : (
            <span className="text-xs font-mono italic" style={{ color: LIGHT_INK }}>--</span>
          )}
        </TdLight>
        <TdLight>
          <span className="text-xs font-mono" style={{ color: LIGHT_INK }}>{event.actor_label ?? 'system'}</span>
        </TdLight>
        <TdLight>
          <span className="text-xs font-mono" style={{ color: '#1c1917' }}>{event.message}</span>
        </TdLight>
      </tr>
      {expanded && (
        <tr style={{ borderBottom: '1px solid #e7e5e4' }}>
          <td colSpan={6} className="px-3 pb-3">
            <pre
              className="text-[11px] font-mono px-3 py-2 rounded-sm overflow-auto wilson-light-scroll"
              style={{ backgroundColor: 'rgba(0,0,0,0.06)', color: '#1c1917', maxHeight: '200px' }}
            >
              {JSON.stringify(event.context ?? {}, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  )
}

const ACTION_CHIP = {
  create: { backgroundColor: 'rgba(34, 197, 94, 0.15)', color: '#15803d' },
  update: { backgroundColor: 'rgba(234, 88, 12, 0.12)', color: '#c2410c' },
  delete: { backgroundColor: 'rgba(220, 38, 38, 0.12)', color: '#dc2626' },
}

function ActivityTable({ rows, loading, error, missing }) {
  if (error) {
    return (
      <div className="text-xs font-mono px-3 py-2 rounded-sm" style={{ backgroundColor: 'rgba(220, 38, 38, 0.1)', color: '#dc2626' }}>
        {error}
      </div>
    )
  }
  if (missing) return <EmptyState text="Edit history not deployed yet." />
  if (loading && rows.length === 0) return <EmptyState text="Loading..." />
  if (rows.length === 0) return <EmptyState text="No activity yet." />
  return (
    <div className="overflow-auto flex-1 rounded-sm wilson-light-scroll" style={{ border: '1px solid #d6d3d1', maxHeight: '100%' }}>
      <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead>
          <tr style={LIGHT_TABLE_HEAD_ROW}>
            <ThLight>Time</ThLight>
            <ThLight>Actor</ThLight>
            <ThLight>Action</ThLight>
            <ThLight>Entity</ThLight>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} style={{ borderBottom: '1px solid #e7e5e4' }}>
              <TdLight>
                <span className="text-xs font-mono whitespace-nowrap" style={{ color: LIGHT_INK }} title={fmtAbs(r.created_at)}>
                  {timeAgo(r.created_at)}
                </span>
              </TdLight>
              <TdLight>
                <span className="text-xs font-mono" style={{ color: '#1c1917' }}>{r.actor_label || '--'}</span>
              </TdLight>
              <TdLight>
                <span
                  className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
                  style={ACTION_CHIP[r.action] || { backgroundColor: 'rgba(120, 70, 30, 0.12)', color: LIGHT_INK }}
                >
                  {r.action}
                </span>
              </TdLight>
              <TdLight>
                <span className="text-xs font-mono" style={{ color: LIGHT_INK }}>
                  {r.entity_type}{' '}
                  <span style={{ color: LIGHT_INK }}>{String(r.entity_id || '').slice(0, 8)}</span>
                </span>
              </TdLight>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EmptyState({ text }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <ScrollText className="w-8 h-8" style={{ color: LIGHT_INK }} />
      <span className="text-xs font-mono italic" style={{ color: LIGHT_INK }}>{text}</span>
    </div>
  )
}

function ThLight({ children }) {
  return (
    <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-left" style={{ color: LIGHT_INK }}>
      {children}
    </th>
  )
}
function TdLight({ children }) {
  return <td className="px-3 py-2 align-middle">{children}</td>
}
