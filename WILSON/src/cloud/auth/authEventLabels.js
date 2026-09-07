// =============================================================================
// authEventLabels — Track B bundle B2, part 2: how an auth_events row reads
// on screen. Shared by the Admin Terminal's Sign-ins tab and the operator
// console's Sign-ins section so the two never drift apart in wording.
//
// A row is (kind, outcome, source). The sign-in server (GoTrue, through the
// two 0070 hooks) writes sign_in and mfa_verify rows, success or failure,
// with no address; the app writes its own sign_in / sign_out / idle_timeout /
// session_cap rows, always successes, stamped with the address and the
// surface. The labels say which is which without making anyone learn the
// column names.
// =============================================================================

const LABELS = {
  'sign_in:success':    { label: 'Signed in',           tone: 'ok' },
  'sign_in:failure':    { label: 'Sign-in failed',      tone: 'bad' },
  'mfa_verify:success': { label: 'Two-factor passed',   tone: 'ok' },
  'mfa_verify:failure': { label: 'Two-factor failed',   tone: 'bad' },
  'sign_out:success':   { label: 'Signed out',          tone: 'neutral' },
  'idle_timeout:success': { label: 'Signed out (idle)', tone: 'neutral' },
  'session_cap:success':  { label: 'Signed out (4-hour limit)', tone: 'neutral' },
}

/** { label, tone } for a row; tone is 'ok' | 'bad' | 'neutral'. */
export function describeAuthEvent(row) {
  const key = `${row?.kind}:${row?.outcome}`
  return LABELS[key] ?? { label: `${row?.kind ?? '?'} (${row?.outcome ?? '?'})`, tone: row?.outcome === 'failure' ? 'bad' : 'neutral' }
}

/** Which door a client row came through; null for a server row. */
export function surfaceOf(row) {
  if (row?.source !== 'client') return null
  const s = row?.context?.surface
  return s === 'admin' || s === 'app' ? s : null
}

/** Where the row was written: the app, the operator console, or the sign-in server. */
export function sourceLabel(row) {
  if (row?.source === 'gotrue_hook') return 'sign-in server'
  const s = surfaceOf(row)
  if (s === 'admin') return 'operator console'
  if (s === 'app') return 'app'
  return 'client'
}

/** Only the app's own rows carry an address; the server passes none to the hooks. */
export const ADDRESS_LEGEND =
  'Addresses are recorded on the app’s own rows only; checks made by the sign-in server carry none.'

export const KIND_FILTERS = Object.freeze([
  ['', 'All events'],
  ['sign_in', 'Sign-ins'],
  ['failure', 'Failures'],
  ['mfa_verify', 'Two-factor'],
  ['ended', 'Sign-outs & timeouts'],
])

const ENDED = new Set(['sign_out', 'idle_timeout', 'session_cap'])

export function matchesFilter(row, filter) {
  if (!filter) return true
  if (filter === 'failure') return row?.outcome === 'failure'
  if (filter === 'ended') return ENDED.has(row?.kind)
  return row?.kind === filter
}

/** The columns both views read. One list so a future column lands in both. */
export const AUTH_EVENT_COLUMNS =
  'id, user_id, workspace_id, session_id, kind, outcome, source, factor_type, ip_address, user_agent, context, created_at'
