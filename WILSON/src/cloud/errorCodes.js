// =============================================================================
// errorCodes — Session 9: the WIL-#### error-code registry + reporter.
//
// Codes give users something quotable ("it said WIL-2001") and give the
// Admin Terminal's log viewer a stable key to group on. Bands:
//   WIL-1xxx auth · WIL-2xxx realtime · WIL-3xxx storage/files ·
//   WIL-41xx admin actions (server-stamped) · WIL-42xx admin client ·
//   WIL-5xxx auto-update · WIL-6xxx AI proxy (server-stamped usage telemetry)
//
// reportAppEvent() is BEST-EFFORT twice over: the app_events insert rides
// RLS (active member, own workspace — the DB stamps the actor) and Sentry
// only fires when enabled. Neither path may ever throw at a call site.
//
// TPN: messages come from this registry and context must be technical
// metadata only (codes, table names, status strings) — never customer
// content or PII (sendDefaultPii stays false in sentry.js).
// =============================================================================

import { supabase } from './auth/supabaseClient'
import { initSentry } from './sentry'

export const ERROR_CODES = Object.freeze({
  'WIL-1001': 'Sign-in failed',
  'WIL-1002': 'Session expired',
  'WIL-1003': 'Multi-factor challenge failed',
  'WIL-1004': 'Multi-factor enrollment failed',
  'WIL-2001': 'Realtime channel error',
  'WIL-2002': 'Realtime resubscribe loop',
  'WIL-3001': 'File storage operation failed',
  'WIL-3002': 'Avatar upload failed',
  // Session 14: written by the storage-gc Edge Function (service role) —
  // deletion counts land in context as the run's certificate summary.
  'WIL-3003': 'Storage cleanup completed',
  'WIL-3004': 'Storage cleanup failed',
  'WIL-4101': 'User created',
  'WIL-4102': 'Password reset',
  'WIL-4103': 'User deactivated',
  'WIL-4104': 'User reactivated',
  'WIL-4201': 'Admin action failed',
  'WIL-4202': 'Last-admin protection triggered',
  'WIL-4203': 'Invite delivery failed',
  'WIL-5001': 'Update check failed',
  'WIL-5002': 'Update download failed',
  // Session 12: written by the ai-proxy Edge Function (service role), never
  // by clients — model + token counts land in context for the spend view.
  'WIL-6001': 'AI request completed',
  'WIL-6002': 'AI request failed',
})

export function describeErrorCode(code) {
  return ERROR_CODES[code] || 'Unknown error code'
}

/**
 * Fire-and-forget event report. Inserts into app_events (admins see it in
 * the Terminal's log viewer) and mirrors error/critical severities to
 * Sentry when configured.
 *
 * @param {{ code?: string, eventType?: string, severity?: 'info'|'warning'|'error'|'critical',
 *           message?: string, context?: object, error?: Error }} fields
 */
export async function reportAppEvent(fields = {}) {
  const {
    code = null,
    eventType = 'error',
    severity = 'error',
    message = code ? describeErrorCode(code) : 'Unspecified event',
    context = {},
    error = null,
  } = fields

  try {
    const { data } = await supabase.auth.getSession()
    const workspaceId = data?.session?.user?.app_metadata?.workspace_id ?? null
    if (workspaceId) {
      await supabase.from('app_events').insert({
        workspace_id: workspaceId,
        event_type: eventType,
        code,
        severity,
        message,
        context,
      })
    }
  } catch {
    // Logging never breaks the feature that called it.
  }

  if (severity === 'error' || severity === 'critical') {
    try {
      const ready = await initSentry()
      if (ready?.enabled) {
        if (error instanceof Error) {
          ready.Sentry.captureException(error, { tags: { wil_code: code ?? 'none' } })
        } else {
          ready.Sentry.captureMessage(`[${code ?? 'WIL-????'}] ${message}`, 'error')
        }
      }
    } catch { /* same rule */ }
  }
}
