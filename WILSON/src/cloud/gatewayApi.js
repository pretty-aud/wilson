// =============================================================================
// gatewayApi — GW1 (post-overhaul, 2026-10-10): the web app's half of the
// file gateway's cloud side, for Settings, Storage, File gateway and the Bins
// inspector's one line (GATEWAY_DESIGN.md §2, §4, §6, §8; Appendix B and C).
//
// Everything here runs AS THE CALLER, through the signed-in session: the
// gateways table, the enrolment tokens, workspace_audit and file_events are
// read under their own RLS (a LIVE workspace admin; 0093), and the admin's
// RPCs check the live row themselves (fn_gateway_require_admin). Nothing
// here holds a service key, a credential or a token's hash: the enrolment
// token is returned ONCE by gateway_make_enrolment_token and lives only in
// the card's state until the panel is closed.
//
// House style (adminApi.js): every call returns { ok, data } or
// { ok: false, code, friendly } and never throws; `friendly` is the sentence
// a person reads. The 0093 RPCs raise one sentence each (42501, P0002,
// 55000, 22023, 54000), which is shown as it is. `fetch` resolves for every
// status, so the one function call here (gateway-reach) reads `res.ok`
// BEFORE it reads a body (the brief's rule).
//
// Dev fixtures (dev builds only): `devFixtures().gateways` answers every
// call in memory (the fixtures' gatewayFixtures.js), so the card renders on
// port 5288 without a database. The guard comes before every request.
// =============================================================================

import { supabase } from './auth/supabaseClient'
import { devFixtures } from '../dev/devFixtures'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

// The admin's columns: what the card shows, and nothing it does not (the
// grants leave out the root's PEM, the reach nonce and the delivery stamps).
const GATEWAY_COLUMNS = [
  'id', 'name', 'platform', 'version', 'hostname', 'inside_addresses', 'outside_address', 'outside_open',
  'root_fingerprint', 'root_confirmed_at', 'reach', 'health', 'office_ranges', 'reach_ok', 'reach_checked_at',
  'reach_detail', 'reach_result', 'reach_check_id', 'update_check_requested_at', 'created_by', 'created_at',
  'last_seen_at', 'revoked_at',
].join(', ')

// A member's columns, from the view every member's browser reads (§2).
const VISIBLE_COLUMNS = 'id, name, platform, version, last_seen_at'

const SAID = {
  signIn: 'Sign in again: WILSON could not confirm who is asking for this.',
  network: 'WILSON could not reach the cloud. Check the connection and try again.',
  notAdmin: 'Only a workspace admin can add or change the file gateway.',
  gone: 'That gateway is not in this company\'s list any more, or only a workspace admin can change it.',
  read: 'WILSON could not read the file gateway\'s details just now. Try again in a moment.',
  token: 'WILSON could not make a token just now. Try again in a moment.',
  tokenGone: 'That token was used or has expired, so there is nothing to cancel.',
  cancel: 'WILSON could not cancel that token just now. Try again in a moment.',
  confirm: 'WILSON could not confirm the fingerprint just now. Try again in a moment.',
  certificate: 'WILSON could not fetch the certificate just now. Try again in a moment.',
  change: 'WILSON could not save that change just now. Try again in a moment.',
  address: 'An outside address is a public name like gateway.yourcompany.com, or a public address, with its port: never a name or address inside the office.',
  ranges: 'Office ranges are private ranges only (10.x, 172.16–31.x, 192.168.x or fc00::/7), at most eight, none wider than a /16 (a /48 for IPv6).',
  name: 'A gateway\'s name is 1 to 80 characters.',
  forget: 'WILSON could not forget that gateway just now. Try again in a moment.',
  unforget: 'WILSON could not bring that gateway back just now. Try again in a moment.',
  update: 'WILSON could not ask the gateway to check for an update just now. Try again in a moment.',
  rotate: 'WILSON could not rotate the ticket keys just now; the old key is still the one in use. Try again in a moment.',
  reach: 'WILSON could not run the check just now. Try again in a moment.',
  reachShape: 'The check answered in a shape WILSON does not know. Try again in a moment.',
  viewings: 'WILSON could not read the viewings from outside the office just now. Try again in a moment.',
  audit: 'WILSON could not read the list of changes just now. Try again in a moment.',
}

// The 0093 RPCs' own refusals: one sentence each, shown as written.
const SENTENCE_CODES = new Set(['42501', 'P0002', '55000', '22023', '54000'])

function fixtures() {
  return (import.meta.env.DEV && devFixtures()) ? (devFixtures().gateways ?? null) : null
}

function refused(error, fallback) {
  const code = error?.code ? String(error.code) : 'failed'
  const message = String(error?.message || '')
  if (code === 'PGRST301' || /jwt/i.test(message)) return { ok: false, code: 'unauthorized', friendly: SAID.signIn }
  if (SENTENCE_CODES.has(code) && message && !/permission denied|row-level security|violates/i.test(message)) {
    return { ok: false, code, friendly: message }
  }
  if (code === '42501') return { ok: false, code, friendly: SAID.notAdmin }
  return { ok: false, code, friendly: fallback }
}

async function run(build, fallback) {
  try {
    const { data, error, count } = await build()
    if (error) return refused(error, fallback)
    return { ok: true, data, count }
  } catch {
    return { ok: false, code: 'network', friendly: SAID.network }
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * The company's gateways. An admin reads the table (live ones, and one
 * forgotten in the last minute, which can still be brought back); anyone
 * else reads gateways_visible's name, version and last-seen.
 */
export async function listGateways({ admin, now = Date.now() } = {}) {
  const fx = fixtures()
  if (fx) return fx.listGateways({ admin, now })
  if (!admin) {
    return run(() => supabase.from('gateways_visible').select(VISIBLE_COLUMNS).order('name'), SAID.read)
  }
  const recently = new Date(now - 60 * 1000).toISOString()
  return run(() => supabase.from('gateways').select(GATEWAY_COLUMNS)
    .or(`revoked_at.is.null,revoked_at.gt.${recently}`)
    .order('created_at', { ascending: true }), SAID.read)
}

/** The company's enrolment tokens made in the last 24 hours: the pending ones, and the used ones with the gateway each enrolled. */
export async function listEnrolmentTokens({ now = Date.now() } = {}) {
  const fx = fixtures()
  if (fx) return fx.listEnrolmentTokens({ now })
  const since = new Date(now - 24 * 3600 * 1000).toISOString()
  return run(() => supabase.from('gateway_enrolment_tokens')
    .select('id, created_by, created_at, expires_at, used_at, gateway_id')
    .gt('created_at', since)
    .order('created_at', { ascending: true }), SAID.read)
}

/** The last twenty changes to the gateway and the switch (workspace_audit; admins only). */
export async function listGatewayAudit({ limit = 20 } = {}) {
  const fx = fixtures()
  if (fx) return fx.listGatewayAudit({ limit })
  return run(() => supabase.from('workspace_audit')
    .select('id, action, actor_user_id, actor_label, gateway_id, details, created_at')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit), SAID.audit)
}

/**
 * The viewings through the outside door in the last 30 days, newest first,
 * one page at a time: { rows, total }. Each row carries its project's title
 * when the caller can read the project.
 */
export async function listRemoteViewings({ page = 0, pageSize = 25, now = Date.now() } = {}) {
  const fx = fixtures()
  if (fx) return fx.listRemoteViewings({ page, pageSize, now })
  const since = new Date(now - 30 * 86400 * 1000).toISOString()
  const from = Math.max(0, page) * pageSize
  const res = await run(() => supabase.from('file_events')
    .select('id, project_id, file_id, file_name, size_bytes, actor_user_id, actor_label, details, created_at', { count: 'exact' })
    .eq('event', 'viewed_remote')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + pageSize - 1), SAID.viewings)
  if (!res.ok) return res
  const rows = res.data || []
  const ids = [...new Set(rows.map(r => r.project_id).filter(Boolean))]
  let titles = new Map()
  if (ids.length) {
    const p = await run(() => supabase.from('projects').select('id, title').in('id', ids), SAID.viewings)
    if (p.ok) titles = new Map((p.data || []).map(x => [x.id, x.title]))
  }
  return { ok: true, data: { rows: rows.map(r => ({ ...r, project_title: titles.get(r.project_id) ?? null })), total: res.count ?? rows.length } }
}

// ── The admin's verbs ────────────────────────────────────────────────────────

/** Add a gateway: the enrolment token, shown once ({ id, token, expires_at }). */
export async function makeEnrolmentToken() {
  const fx = fixtures()
  if (fx) return fx.makeEnrolmentToken()
  const res = await run(() => supabase.rpc('gateway_make_enrolment_token'), SAID.token)
  if (!res.ok) return res
  const row = Array.isArray(res.data) ? res.data[0] : res.data
  if (!row?.token || !/^wgt_[A-Z2-7]{32}$/.test(row.token)) return { ok: false, code: 'bad_answer', friendly: SAID.token }
  return { ok: true, data: { id: row.id, token: row.token, expires_at: row.expires_at } }
}

/** Cancel a pending token (the row is deleted; the database writes the audit row). */
export async function cancelEnrolmentToken(tokenId) {
  const fx = fixtures()
  if (fx) return fx.cancelEnrolmentToken(tokenId)
  const res = await run(() => supabase.from('gateway_enrolment_tokens').delete().eq('id', tokenId).select('id'), SAID.cancel)
  if (!res.ok) return res
  if (!res.data?.length) return { ok: false, code: 'not_found', friendly: SAID.tokenGone }
  return { ok: true, data: { id: tokenId } }
}

/** D25: the enrolling admin confirms the fingerprint the gateway printed (64 hex). */
export async function confirmGatewayFingerprint(gatewayId, fingerprint) {
  const fx = fixtures()
  if (fx) return fx.confirmGatewayFingerprint(gatewayId, fingerprint)
  return run(() => supabase.rpc('gateway_confirm_root', { p_gateway: gatewayId, p_fingerprint: fingerprint }), SAID.confirm)
}

/** The root's PUBLIC certificate (PEM), offered only after the fingerprint is confirmed. */
export async function fetchRootCertificate(gatewayId) {
  const fx = fixtures()
  if (fx) return fx.fetchRootCertificate(gatewayId)
  const res = await run(() => supabase.rpc('gateway_root_certificate', { p_gateway: gatewayId }), SAID.certificate)
  if (!res.ok) return res
  const pem = typeof res.data === 'string' ? res.data : ''
  if (!/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/.test(pem)) return { ok: false, code: 'bad_answer', friendly: SAID.certificate }
  return { ok: true, data: pem }
}

async function updateGateway(gatewayId, patch, fallback) {
  const fx = fixtures()
  if (fx) return fx.updateGateway(gatewayId, patch)
  const res = await run(() => supabase.from('gateways').update(patch).eq('id', gatewayId).is('revoked_at', null).select(GATEWAY_COLUMNS), fallback)
  if (!res.ok) return res
  if (!res.data?.length) return { ok: false, code: 'not_found', friendly: SAID.gone }
  return { ok: true, data: res.data[0] }
}

/** Rename (the database trims and checks 1–80 characters, and writes the audit row). */
export function renameGateway(gatewayId, name) {
  return updateGateway(gatewayId, { name }, SAID.name)
}

/** The outside address ({ host, port } or null). A change clears the reach check; the address is published only after the next one passes. */
export function setGatewayOutsideAddress(gatewayId, address) {
  return updateGateway(gatewayId, { outside_address: address }, SAID.address)
}

/** The office ranges (D21): the database's cidr spellings, at most eight. */
export function setGatewayOfficeRanges(gatewayId, ranges) {
  return updateGateway(gatewayId, { office_ranges: ranges }, SAID.ranges)
}

/** Forget: revoked at once, undoable for a minute (gateway_unforget). */
export async function forgetGateway(gatewayId) {
  const fx = fixtures()
  if (fx) return fx.forgetGateway(gatewayId)
  return run(() => supabase.rpc('gateway_forget', { p_gateway: gatewayId }), SAID.forget)
}

export async function unforgetGateway(gatewayId) {
  const fx = fixtures()
  if (fx) return fx.unforgetGateway(gatewayId)
  return run(() => supabase.rpc('gateway_unforget', { p_gateway: gatewayId }), SAID.unforget)
}

/** §8's Check now: the gateway hears it at its next sync and checks for an update. */
export async function requestGatewayUpdateCheck(gatewayId) {
  const fx = fixtures()
  if (fx) return fx.requestGatewayUpdateCheck(gatewayId)
  return run(() => supabase.rpc('gateway_request_update_check', { p_gateway: gatewayId }), SAID.update)
}

/**
 * Rotate the ticket keys (§5 step 4, §10 row 21; GW1 review round 2, finding
 * 6): the company's signing key is retired; the next ticket is signed with a
 * new one, and the retired key is honoured for ten more minutes. A live
 * admin only (the database's sentence otherwise). { retired, at }.
 */
export async function rotateTicketKeys() {
  const fx = fixtures()
  if (fx) return fx.rotateTicketKeys()
  return run(() => supabase.rpc('gateway_rotate_signing_key'), SAID.rotate)
}

/**
 * Check reach (§4): the cloud hands the gateway a code at its next sync,
 * knocks on the outside address from the internet and tries the inside port.
 * Up to ~25 s: the wait for the sync (≤ 15 s) plus the probes (5 s each).
 * { outside: { ok, detail, ms, certificate, is_this_gateway, method, proof_checked }, inside_answered,
 *   inside_other, checked_at } — inside_answered is the gateway's own inside door reached from the
 *   internet (the red line); inside_other is something else answering on that port (round 2).
 */
export async function checkGatewayReach(gatewayId, { timeoutMs = 30000 } = {}) {
  const fx = fixtures()
  if (fx) return fx.checkGatewayReach(gatewayId)
  let token = null
  try {
    const { data } = await supabase.auth.getSession()
    token = data?.session?.access_token ?? null
  } catch { /* fall through */ }
  if (!token) return { ok: false, status: 401, code: 'unauthorized', friendly: SAID.signIn }
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null
  let res
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/gateway-reach`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: SUPABASE_ANON, authorization: `Bearer ${token}` },
      body: JSON.stringify({ gateway_id: gatewayId }),
      ...(ctrl ? { signal: ctrl.signal } : {}),
    })
  } catch {
    if (timer) clearTimeout(timer)
    return { ok: false, status: 0, code: 'network', friendly: SAID.network }
  }
  if (timer) clearTimeout(timer)
  // `fetch` resolves for a 4xx and a 5xx too: the status first, then a body.
  if (!res.ok) {
    let body = null
    try { body = await res.json() } catch { body = null }
    const detail = typeof body?.detail === 'string' && body.detail ? body.detail : SAID.reach
    return { ok: false, status: res.status, code: typeof body?.error === 'string' ? body.error : `http_${res.status}`, friendly: detail }
  }
  let body = null
  try { body = await res.json() } catch { body = null }
  if (!body || typeof body !== 'object' || !body.outside || typeof body.outside.detail !== 'string') {
    return { ok: false, status: res.status, code: 'bad_answer', friendly: SAID.reachShape }
  }
  return { ok: true, status: res.status, data: body }
}

/** The functions base the gateway is given (WILSON_CLOUD_URL; the installer's second field). */
export function gatewayCloudBase() {
  return SUPABASE_URL || ''
}
