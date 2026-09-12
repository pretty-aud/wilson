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
import { RefreshCw, ScrollText } from 'lucide-react'
import { supabase } from '../../cloud/auth/supabaseClient'
import { describeErrorCode } from '../../cloud/errorCodes'
import Table, { Th, Td, Row } from '../../ui/Table'
import Toolbar from '../../ui/Toolbar'
import Tabs from '../../ui/Tabs'
import Button from '../../ui/Button'
import Select from '../../ui/Select'
import Badge from '../../ui/Badge'
import Banner from '../../ui/Banner'
import StatusDot from '../../ui/StatusDot'
import SectionTitle from '../../ui/SectionTitle'
import Loading from '../../ui/Loading'
import Empty from '../../ui/EmptyState'

const EVENT_TYPES = ['auth', 'admin', 'error', 'system', 'update', 'storage', 'realtime']
const SEVERITIES = ['info', 'warning', 'error', 'critical']
// 🚨 SEVERITY IS A TONE, NOT A COLOUR LITERAL (AT-30, and the plan's one
// source for a status colour). The four hex values this map used to hold were
// picked against the ORANGE ground — `info` was already a tint of the ink
// because stone-400 measured 1.4:1 on it — and none of them survives the move
// to `paper`. `StatusDot` renders the dot AND its accessible label from the
// tone, which is also the finding: severity was communicated by colour alone,
// with the word only in a `title`.
const SEVERITY_TONE = {
  info: 'neutral', warning: 'warning', error: 'danger', critical: 'danger',
}
// PostgREST codes for "relation does not exist" — table not deployed yet.
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205'])

const TYPE_OPTIONS = EVENT_TYPES.map(t => ({ value: t, label: t }))
const SEVERITY_OPTIONS = SEVERITIES.map(s => ({ value: s, label: s }))

// Declared column grids (AT-18). Six for the system stream, four for
// activity; both measured at 1280 with the nav strip taking its 190px.
const SYS_COLS = ['13%', '10%', '14%', '13%', '15%', '35%']
const ACT_COLS = ['16%', '22%', '14%', '48%']

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

  const busy = tab === 'system' ? eventsLoading : historyLoading

  return (
    <div className="at-section">
      <SectionTitle description="Two streams: what the system did, and what people changed.">
        Logs
      </SectionTitle>

      <Toolbar
        right={(
          <Button
            size="sm"
            Icon={RefreshCw}
            onClick={() => (tab === 'system' ? loadEvents() : loadHistory())}
            disabled={busy}
            loading={busy}
            loadingLabel="Refreshing"
          >
            Refresh
          </Button>
        )}
      >
        <Tabs
          items={[{ id: 'system', label: 'System' }, { id: 'activity', label: 'Activity' }]}
          value={tab}
          onChange={setTab}
          label="Log stream"
          panelId="at-logs-panel"
        />
        {tab === 'system' && (
          <>
            <Select
              size="sm"
              value={typeFilter}
              onChange={(v) => setTypeFilter(v ?? '')}
              options={TYPE_OPTIONS}
              placeholder="All types"
              aria-label="Filter by event type"
            />
            <Select
              size="sm"
              value={sevFilter}
              onChange={(v) => setSevFilter(v ?? '')}
              options={SEVERITY_OPTIONS}
              placeholder="All severities"
              aria-label="Filter by severity"
            />
          </>
        )}
      </Toolbar>

      <div id="at-logs-panel" role="tabpanel" className="at-logs-panel">
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
    </div>
  )
}

function SystemTable({ events, allCount, loading, error, missing, expandedId, onToggleExpand }) {
  if (error) return <Banner tone="danger">{error}</Banner>
  if (missing) return <EmptyState text="Log stream not deployed yet." />
  // 🚨 LOADING IS NOT AN EMPTY STATE (AT-15). This file passed the literal
  // string "Loading..." to the same component that renders "No events yet",
  // with the same icon, so a wait and a void were indistinguishable — and the
  // kit's `EmptyState` now dev-errors on exactly this string.
  if (loading && events.length === 0) return <Loading rows={10} columns={6} label="Loading events" />
  if (events.length === 0) {
    return <EmptyState text={allCount === 0 ? 'No events yet.' : 'No events match the filters.'} />
  }
  return (
    <Table
      className="at-log-table"
      head={(
        <Row>
          <Th width={SYS_COLS[0]}>Time</Th>
          <Th width={SYS_COLS[1]}>Severity</Th>
          <Th width={SYS_COLS[2]}>Type</Th>
          <Th width={SYS_COLS[3]}>Code</Th>
          <Th width={SYS_COLS[4]}>Actor</Th>
          <Th width={SYS_COLS[5]}>Message</Th>
        </Row>
      )}
    >
      {events.map(e => (
        <SystemRow
          key={e.id}
          event={e}
          expanded={expandedId === e.id}
          onToggle={() => onToggleExpand(e.id)}
        />
      ))}
    </Table>
  )
}

function SystemRow({ event, expanded, onToggle }) {
  return (
    <>
      <Row
        onClick={onToggle}
        interactive
        className="at-log-row"
        data-expanded={String(expanded)}
      >
        <Td>
          <span className="at-mono at-nowrap" title={fmtAbs(event.created_at)}>
            {timeAgo(event.created_at)}
          </span>
        </Td>
        <Td>
          <StatusDot tone={SEVERITY_TONE[event.severity] || 'neutral'} label={event.severity} />
        </Td>
        <Td><span className="at-mono">{event.event_type}</span></Td>
        <Td>
          {event.code
            ? <Badge title={describeErrorCode(event.code)}>{event.code}</Badge>
            : <span className="at-none">--</span>}
        </Td>
        <Td><span className="at-mono">{event.actor_label ?? 'system'}</span></Td>
        <Td><span className="at-log-message">{event.message}</span></Td>
      </Row>
      {expanded && (
        <Row className="at-log-context-row">
          <Td colSpan={6}>
            <pre className="at-log-context wilson-dark-scroll">
              {JSON.stringify(event.context ?? {}, null, 2)}
            </pre>
          </Td>
        </Row>
      )}
    </>
  )
}

// Three hand-written chip fills in three colours — one of them a green that
// exists nowhere else on the surface — become one inert `Badge`. The word is
// the information; it was already there under the colour.
function ActivityTable({ rows, loading, error, missing }) {
  if (error) return <Banner tone="danger">{error}</Banner>
  if (missing) return <EmptyState text="Edit history not deployed yet." />
  if (loading && rows.length === 0) return <Loading rows={10} columns={4} label="Loading activity" />
  if (rows.length === 0) return <EmptyState text="No activity yet." />
  return (
    <Table
      className="at-activity-table"
      head={(
        <Row>
          <Th width={ACT_COLS[0]}>Time</Th>
          <Th width={ACT_COLS[1]}>Actor</Th>
          <Th width={ACT_COLS[2]}>Action</Th>
          <Th width={ACT_COLS[3]}>Entity</Th>
        </Row>
      )}
    >
      {rows.map(r => (
        <Row key={r.id}>
          <Td>
            <span className="at-mono at-nowrap" title={fmtAbs(r.created_at)}>
              {timeAgo(r.created_at)}
            </span>
          </Td>
          <Td>{r.actor_label || '--'}</Td>
          <Td><Badge>{r.action}</Badge></Td>
          <Td>
            <span className="at-mono">
              {r.entity_type} {String(r.entity_id || '').slice(0, 8)}
            </span>
          </Td>
        </Row>
      ))}
    </Table>
  )
}

/**
 * The section's own empty state, wrapping the kit's so the four call sites
 * keep their one-word call shape and the icon stays this section's.
 *
 * 🚨 IT IS NEVER PASSED A LOADING STRING ANY MORE — the two call sites that
 * did now render `Loading` instead (AT-15). The kit dev-errors on a title or
 * body matching /loading/, so the old spelling could not survive here even if
 * someone reintroduced it.
 */
function EmptyState({ text }) {
  return <Empty Icon={ScrollText} title={text} />
}
