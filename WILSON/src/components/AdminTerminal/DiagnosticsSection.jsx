// =============================================================================
// DiagnosticsSection — build info, live connection status, error-code
// reference, and test tools (Session 9).
//
// UX laws embodied:
//   Law of Common Region — four bordered cards, one concern each.
//   Tesler's Law — the COPY DIAGNOSTICS block absorbs the complexity of
//     "what should I paste into a bug report?" for the user.
//   Doherty Threshold — copy/test buttons flip to feedback immediately.
//
// Everything here is local state or a single fire-and-forget insert — no
// lazy-load gating needed beyond keeping render cheap.
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { Copy, Check, Activity, Send } from 'lucide-react'
import { usePermissions } from '../../permissions'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'
import { ERROR_CODES, reportAppEvent } from '../../cloud/errorCodes'
import { copyTextToClipboard } from './CredentialsPopup'
import StorageCleanupCard from './StorageCleanupCard'
import Card from '../../ui/Card'
import Button from '../../ui/Button'
import Badge from '../../ui/Badge'
import Table, { Th, Td, Row } from '../../ui/Table'
import StatusDot from '../../ui/StatusDot'
import SectionTitle from '../../ui/SectionTitle'

// The second of the four private `darkBtnClass` pairs (AT-02) — this one at
// `at-disable-50` where CompanySection's was at `at-disable-40`, which is the
// divergence the finding is about. Both are the kit `Button` now.

// Four connection states, four TONES, no hex. `off` was stone-400 at 1.4:1 on
// the old orange ground, so the dot meaning "not connected" was the one you
// could not see; a tone resolves per surface instead of being re-picked.
const REALTIME_TONE = {
  live: 'success', connecting: 'warning', error: 'danger', off: 'neutral',
}

function supabaseHost() {
  try {
    return new URL(import.meta.env.VITE_SUPABASE_URL).host
  } catch {
    return 'not configured'
  }
}

export default function DiagnosticsSection() {
  const perms = usePermissions()
  const rabbit = useRabbit()
  const [copied, setCopied] = useState(false)
  const [testEventState, setTestEventState] = useState(null) // 'sent' | 'failed' | null
  const [sentryState, setSentryState] = useState(null)       // 'sent' | 'missing' | null

  // StrictMode-safe mounted flag: body sets true, cleanup sets false.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const version = typeof __WILSON_VERSION__ !== 'undefined' ? __WILSON_VERSION__ : 'v?'
  const sentryEnv = import.meta.env.VITE_SENTRY_ENVIRONMENT ?? 'development'
  const host = supabaseHost()
  const realtimeStatus = rabbit?.workspaceRealtimeStatus || 'off'

  const envRows = [
    ['WILSON version', version],
    ['Sentry env', sentryEnv],
    ['Supabase host', host],
    ['Workspace ID', perms.workspaceId || '--'],
    ['User ID', perms.userId || '--'],
    ['Role', perms.role || '--'],
  ]

  async function copyDiagnostics() {
    const lines = [
      `WILSON diagnostics — ${new Date().toISOString()}`,
      ...envRows.map(([k, v]) => `${k}: ${v}`),
      `Adapter mode: ${rabbit?.adapterMode || '--'}`,
      `Adapter online: ${rabbit?.adapterStatus?.online ? 'yes' : 'no'}`,
      `Workspace realtime: ${realtimeStatus}`,
    ]
    const ok = await copyTextToClipboard(lines.join('\n'))
    if (!ok || !mountedRef.current) return
    setCopied(true)
    setTimeout(() => { if (mountedRef.current) setCopied(false) }, 1500)
  }

  async function sendTestEvent() {
    setTestEventState(null)
    try {
      // reportAppEvent is best-effort by contract (never throws), but the
      // guard costs nothing and keeps the button honest.
      await reportAppEvent({
        code: 'WIL-4201',
        severity: 'info',
        eventType: 'system',
        message: 'Diagnostics test event',
        context: { source: 'admin-terminal' },
      })
      if (mountedRef.current) setTestEventState('sent')
    } catch {
      if (mountedRef.current) setTestEventState('failed')
    }
  }

  function sendSentryTest() {
    if (typeof window.wilsonSendTestException === 'function') {
      window.wilsonSendTestException()
      setSentryState('sent')
    } else {
      setSentryState('missing')
    }
  }

  return (
    <div className="at-section at-section-narrow">
      <SectionTitle description="What this install is running, whether it is connected, and the tools to prove it.">
        Diagnostics
      </SectionTitle>

      {/* BUILD & ENVIRONMENT */}
      <Card title="Build and environment">
        <p className="at-card-desc">
          What this install is running and where it points. Paste the block into bug reports.
        </p>
        {/* A grid, not `justify-between` (AT-17): eight pairs pushed apart gave
            two ragged edges and no column. */}
        <div className="at-sec-group">
          {envRows.map(([k, v]) => (
            <div key={k} className="at-sec-row">
              <span className="at-sec-label">{k}</span>
              <span className="at-sec-value at-mono at-break">{v}</span>
            </div>
          ))}
        </div>
        <Button
          Icon={copied ? Check : Copy}
          onClick={copyDiagnostics}
          className="at-copy-btn"
          data-copied={String(copied)}
        >
          {copied ? 'Copied ✓' : 'Copy diagnostics'}
        </Button>
      </Card>

      {/* LIVE STATUS */}
      <Card title="Live status">
        <p className="at-card-desc">
          Current storage adapter and workspace realtime channel.
        </p>
        <div className="at-status-list">
          <StatusDot
            tone={rabbit?.adapterStatus?.online ? 'success' : 'danger'}
            label={`Adapter: ${rabbit?.adapterMode || '--'} — ${rabbit?.adapterStatus?.online ? 'connected' : 'offline'}${rabbit?.adapterStatus?.error ? ` (${rabbit.adapterStatus.error})` : ''}`}
          />
          <StatusDot
            tone={REALTIME_TONE[realtimeStatus] || 'neutral'}
            label={`Workspace realtime: ${realtimeStatus}`}
          />
        </div>
      </Card>

      {/* ERROR CODES */}
      <Card title="Error codes">
        <p className="at-card-desc">
          Users can quote these codes when reporting issues.
        </p>
        {/* The fourth table on the surface, and the one that had no header row
            at all — two columns with nothing naming them. It is the kit
            `Table` now, with the header it was missing and a declared grid. */}
        <Table
          className="at-codes-table"
          dense
          scrollClassName="at-codes-scroll"
          head={(
            <Row>
              <Th width="110px">Code</Th>
              <Th>What it means</Th>
            </Row>
          )}
        >
          {Object.entries(ERROR_CODES).map(([code, desc]) => (
            <Row key={code}>
              <Td><Badge>{code}</Badge></Td>
              <Td>{desc}</Td>
            </Row>
          ))}
        </Table>
      </Card>

      {/* TEST TOOLS */}
      <Card title="Test tools">
        <p className="at-card-desc">
          Verify the reporting pipelines end to end.
        </p>
        <div className="at-test-row">
          <Button Icon={Send} onClick={sendTestEvent}>Send test event</Button>
          {testEventState === 'sent' && <StatusDot tone="success" label="Sent — check the Logs tab." />}
          {testEventState === 'failed' && <StatusDot tone="danger" label="Could not send." />}
        </div>
        <div className="at-test-row">
          <Button Icon={Activity} onClick={sendSentryTest}>Send Sentry test</Button>
          {sentryState === 'sent' && <StatusDot tone="success" label="Test exception sent." />}
          {sentryState === 'missing' && <StatusDot tone="neutral" label="Sentry test hook not available in this build." />}
        </div>
      </Card>

      {/* STORAGE CLEANUP (Session 14, Block E) */}
      <StorageCleanupCard />
    </div>
  )
}
