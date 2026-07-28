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

const cardStyle = {
  backgroundColor: 'rgba(120, 70, 30, 0.12)',
  border: '1px solid rgba(120, 70, 30, 0.3)',
}
const darkBtnClass = 'flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors disabled:opacity-50'
const darkBtnStyle = { backgroundColor: '#1c1917', color: '#f4a261' }

const REALTIME_DOT = {
  live: '#22c55e', connecting: '#fbbf24', error: '#ef4444', off: '#a8a29e',
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
    <div className="space-y-6 pb-8" style={{ maxWidth: '640px' }}>
      {/* BUILD & ENVIRONMENT */}
      <div className="p-4 rounded-sm" style={cardStyle}>
        <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">
          Build &amp; environment
        </h2>
        <p className="text-xs text-stone-950 mb-4 leading-relaxed">
          What this install is running and where it points. Paste the block into bug reports.
        </p>
        <div className="space-y-1.5 mb-4">
          {envRows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3">
              <span className="text-[10px] font-bold uppercase tracking-wider flex-shrink-0" style={{ color: '#78716c' }}>{k}</span>
              <span className="text-xs font-mono break-all text-right" style={{ color: '#1c1917' }}>{v}</span>
            </div>
          ))}
        </div>
        <button type="button" onClick={copyDiagnostics} className={darkBtnClass} style={darkBtnStyle}>
          {copied ? <Check className="w-3 h-3" style={{ color: '#22c55e' }} /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied ✓' : 'Copy diagnostics'}
        </button>
      </div>

      {/* LIVE STATUS */}
      <div className="p-4 rounded-sm" style={cardStyle}>
        <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">
          Live status
        </h2>
        <p className="text-xs text-stone-950 mb-4 leading-relaxed">
          Current storage adapter and workspace realtime channel.
        </p>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: rabbit?.adapterStatus?.online ? '#22c55e' : '#ef4444' }}
            />
            <span className="text-xs font-mono" style={{ color: '#1c1917' }}>
              Adapter: {rabbit?.adapterMode || '--'} — {rabbit?.adapterStatus?.online ? 'connected' : 'offline'}
              {rabbit?.adapterStatus?.error ? ` (${rabbit.adapterStatus.error})` : ''}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: REALTIME_DOT[realtimeStatus] || '#a8a29e' }}
            />
            <span className="text-xs font-mono" style={{ color: '#1c1917' }}>
              Workspace realtime: {realtimeStatus}
            </span>
          </div>
        </div>
      </div>

      {/* ERROR CODES */}
      <div className="p-4 rounded-sm" style={cardStyle}>
        <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">
          Error codes
        </h2>
        <p className="text-xs text-stone-950 mb-4 leading-relaxed">
          Users can quote these codes when reporting issues.
        </p>
        <div className="overflow-auto wilson-light-scroll rounded-sm" style={{ maxHeight: '280px', border: '1px solid #d6d3d1' }}>
          <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
            <tbody>
              {Object.entries(ERROR_CODES).map(([code, desc]) => (
                <tr key={code} style={{ borderBottom: '1px solid #e7e5e4' }}>
                  <td className="px-3 py-1.5 align-middle" style={{ width: '110px' }}>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm" style={{ backgroundColor: 'rgba(120, 70, 30, 0.12)', color: '#1c1917' }}>
                      {code}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 align-middle">
                    <span className="text-xs" style={{ color: '#1c1917' }}>{desc}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* TEST TOOLS */}
      <div className="p-4 rounded-sm" style={cardStyle}>
        <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">
          Test tools
        </h2>
        <p className="text-xs text-stone-950 mb-4 leading-relaxed">
          Verify the reporting pipelines end to end.
        </p>
        <div className="flex items-center gap-3 mb-2">
          <button type="button" onClick={sendTestEvent} className={darkBtnClass} style={darkBtnStyle}>
            <Send className="w-3 h-3" /> Send test event
          </button>
          {testEventState === 'sent' && (
            <span className="text-[11px] font-mono" style={{ color: '#15803d' }}>Sent — check the Logs tab.</span>
          )}
          {testEventState === 'failed' && (
            <span className="text-[11px] font-mono" style={{ color: '#dc2626' }}>Could not send.</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={sendSentryTest} className={darkBtnClass} style={darkBtnStyle}>
            <Activity className="w-3 h-3" /> Send Sentry test
          </button>
          {sentryState === 'sent' && (
            <span className="text-[11px] font-mono" style={{ color: '#15803d' }}>Test exception sent.</span>
          )}
          {sentryState === 'missing' && (
            <span className="text-[11px] font-mono" style={{ color: '#78716c' }}>Sentry test hook not available in this build.</span>
          )}
        </div>
      </div>
    </div>
  )
}
