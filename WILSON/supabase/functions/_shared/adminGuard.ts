// =============================================================================
// _shared/adminGuard.ts — Session 9
//
// Common plumbing for the Admin Terminal Edge Functions
// (admin-create-user / admin-reset-password / admin-set-active /
// admin-user-security). All of them:
//
//   * run with verify_jwt = false (the Edge gateway can't validate this
//     project's ES256 JWTs — same rationale as issue-session) and validate
//     the caller in-function via admin.auth.getUser(token);
//   * require app_role=admin in the JWT claims AND an ACTIVE admin row in
//     workspace_members (live-row check — a deactivated/demoted admin's
//     token keeps its claims for up to the TTL; the row is authoritative);
//   * enforce MFA step-up: when the caller has a verified TOTP factor, the
//     token must carry aal2 (403 mfa_required otherwise). Locked decision
//     #9 — MFA for all admin tiers — enforced where it matters most. Since
//     S15 a failure to ESTABLISH that state is refused too (503), rather
//     than waved through (§6 #17).
//
// Sibling guards: _shared/memberGuard.ts (any active member — ai-proxy) and
// _shared/operatorGuard.ts (the platform tier — the /wilsonadmin console,
// where MFA is a hard requirement rather than a conditional step-up).
//
// Also home to the show-once password generator (locked decision #8) and
// the best-effort app_events writer.
//
// F8 (wave 2, 2026-11-13): also home to the caller checks the three guards
// (and issue-session, resolve-login, admin-user-security, the gateway and
// storage functions) used to write out each for themselves, now once:
// authenticate (the bearer, sliced and never trimmed, then GoTrue, and the
// token's claims, decoded only when a caller first reads one: review round 1,
// G1), liveMembership (the live workspace_members row, its error
// handed back unjudged), hasVerifiedTotp (the factor read), serviceClient and
// callerClient (with `quiet` only where a function always passed those
// options), and jsonResponse under reply. Each guard still decides its own
// refusals, in its own order, with its own codes: they are composed from these
// pieces, not merged into one. No new file: memberGuard, operatorGuard and
// gatewayGuard already took their helpers from here.
// =============================================================================

import { createClient, type SupabaseClient, type User } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

export const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, apikey',
}

/**
 * The one JSON answer every helper is built on: the house CORS headers, then
 * content-type, then whatever the helper adds. `reply` adds nothing;
 * gatewayGuard's `answer` adds cache-control: no-store. The two are NOT one
 * function (a header differs), and a function must never swap one for the other.
 */
export function jsonResponse(body: Record<string, unknown>, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json', ...extra },
  })
}

export function reply(body: Record<string, unknown>, status = 200) {
  return jsonResponse(body, status)
}

// ── The clients ──────────────────────────────────────────────────────────────

/** The client as createClient(url, key) really returns it: SupabaseClient<any, 'public', any>. */
export type ServiceClient = SupabaseClient
/**
 * The guards' `admin`: the true client. Until the second merger it was
 * `SupabaseClient & ReturnType<typeof createClient>` (the alias is NOT the
 * type createClient returns: it is SupabaseClient<unknown, never,
 * GenericSchema>), only because F7's _shared/aiFilesUpstream.ts named the
 * alias and ai-files hands it the guards' client. That file names
 * ServiceClient now, so this is ServiceClient and serviceClient() needs no
 * cast (OUTSTANDING F8-01). The name stays: memberGuard and the functions use it.
 */
export type GuardClient = ServiceClient

// The option set the gateway functions have always passed (no stored session,
// no refresh timer). NOT added where a function never passed it: that is an
// answer-invisible difference the brief says must survive (F8-07).
const QUIET = { auth: { persistSession: false, autoRefreshToken: false } }

/**
 * The service-role client. `quiet` for gatewayGuard; the three guards,
 * issue-session and resolve-login pass none, as before.
 */
export function serviceClient(opts: { quiet?: boolean } = {}): GuardClient {
  const url = Deno.env.get('SUPABASE_URL')!
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  return opts.quiet ? createClient(url, key, QUIET) : createClient(url, key)
}

/**
 * The caller's own client: the anon key carrying the request's bearer, so a
 * predicate or a row read runs under the caller's JWT (the S33 rule:
 * evaluated as the caller, never replicated). The bearer is the header from
 * its eighth character, UNTRIMMED, exactly what the guard handed GoTrue; call
 * it only after a guard has passed the request. `quiet` for gateway-reach and
 * gateway-ticket (they always passed it); none for storage-presign and
 * storage-read-urls (they never did).
 */
export function callerClient(req: Request, opts: { quiet?: boolean } = {}): ServiceClient {
  const token = (req.headers.get('authorization') ?? '').slice(7)
  const global = { headers: { Authorization: `Bearer ${token}` } }
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    opts.quiet ? { global, ...QUIET } : { global },
  )
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const part = token.split('.')[1] ?? ''
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    return JSON.parse(atob(pad))
  } catch {
    return {}
  }
}

// ── The caller checks, once ──────────────────────────────────────────────────

export type Caller = {
  /** The service-role client this request made (no options). */
  admin: GuardClient
  /** The bearer as sliced from the header: never trimmed. */
  token: string
  /** GoTrue's record of the token's user. */
  user: User
  /**
   * From the TOKEN's payload (the hook mints them there); workspace_id falls
   * back to the user record. LAZY (review round 1, G1): the payload is decoded
   * when a field is first read, never before, so each caller decodes it where
   * it always did. Reading workspaceId or appRole reads the payload's
   * app_metadata (the admin and member guards, at once after GoTrue); reading
   * aal reads only the payload's aal (the operator guard, once its row and an
   * enrolled factor are found); issue-session reads none. A payload that is
   * JSON null throws a TypeError on that first read, at that point, as it did.
   */
  readonly claims: { readonly workspaceId: string | null; readonly appRole: string | null; readonly aal: unknown }
}

/** The claims of a GoTrue-verified token, each decoded on its first read (see Caller.claims). */
function lazyClaims(token: string, user: User): Caller['claims'] {
  let payload: Record<string, unknown> | undefined
  let decoded = false
  const payloadOf = (): Record<string, unknown> => {
    if (!decoded) { payload = decodeJwtPayload(token); decoded = true }
    return payload as Record<string, unknown>
  }
  let fromMetadata: { workspaceId: string | null; appRole: string | null } | undefined
  const metadata = () => {
    if (fromMetadata) return fromMetadata
    // The token's workspace FIRST, the user record's only when the token has
    // none; the role from the token ONLY.
    const pmd = (payloadOf().app_metadata ?? {}) as Record<string, unknown>
    const md = user.app_metadata ?? {}
    const workspaceId =
      typeof pmd.workspace_id === 'string' ? pmd.workspace_id :
      typeof md.workspace_id === 'string' ? md.workspace_id : null
    const appRole = typeof pmd.app_role === 'string' ? pmd.app_role : null
    fromMetadata = { workspaceId, appRole }
    return fromMetadata
  }
  return {
    get workspaceId() { return metadata().workspaceId },
    get appRole() { return metadata().appRole },
    get aal() { return payloadOf().aal },
  }
}

/**
 * Steps 1 and 2 of every guard and of issue-session: the bearer, then GoTrue;
 * the claims are handed back undecoded (Caller.claims). It answers a REASON,
 * never a Response: each caller words its own 401. It reads headers only,
 * never the body (ai-files calls two guards on one request).
 */
export async function authenticate(
  req: Request,
): Promise<{ ok: true; caller: Caller } | { ok: false; reason: 'no_token' | 'not_verified' }> {
  const authHeader = req.headers.get('authorization') ?? ''
  // 🚨 SLICE, NEVER TRIM. `Bearer  <token>` (two spaces) hands GoTrue a token
  // with a leading space, which it refuses, and must go on refusing.
  // gatewayWire.bearerOf trims; that is the GATEWAYS' reader, not this one.
  const token = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7)
    : ''
  if (!token) return { ok: false, reason: 'no_token' }

  // Made only once a token has been sliced out, as it always was.
  const admin = serviceClient()

  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) return { ok: false, reason: 'not_verified' }

  // Claims come from the TOKEN payload, not the getUser() record:
  // app_role/workspace_id are minted by custom_access_token_hook into the
  // JWT and never persisted to raw_app_meta_data (only workspace_id gets
  // seeded there, best-effort). The token is already validated above, so
  // decoding its payload is safe. Decoded when first read, not here.
  return { ok: true, caller: { admin, token, user: data.user, claims: lazyClaims(token, data.user) } }
}

/**
 * The live workspace_members row: claims can outlive a demotion or a
 * deactivation by the token's TTL; the row cannot. `withRole` selects
 * app_role too (the admin guard); without it only is_active (the member
 * guard's read, unchanged). The read's error is HANDED BACK, not judged: the
 * admin and member guards ignore it (a failed read is "no row": 403, never a
 * 503 and never a pass), as they always have. operatorGuard's read is of
 * another table and judges its error (503): it does not use this.
 */
export async function liveMembership(
  admin: ServiceClient, workspaceId: string, userId: string, opts: { withRole?: boolean } = {},
): Promise<{ row: { is_active?: unknown; app_role?: unknown } | null; error: unknown }> {
  const { data, error } = await admin
    .from('workspace_members')
    .select(opts.withRole ? 'app_role, is_active' : 'is_active')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()
  return { row: (data ?? null) as { is_active?: unknown; app_role?: unknown } | null, error }
}

/**
 * How many verified TOTP factors a user holds. `ok: false` when GoTrue could
 * not say: its `error` channel or a throw (supabase-js reports most failures
 * on the channel, so an unchecked `error` would be a quiet fail-open). The
 * guards refuse on it (503). It takes a user id, not "the caller":
 * admin-user-security asks about its TARGET.
 *
 * `count` is there on BOTH answers (review round 1, G2), for
 * admin-user-security, which reads a posture and is never a gate: as at
 * a71cd144 it counts the verified TOTP factors in `data` WHATEVER the error
 * channel says, and is 0 only when the read throws (or `data` cannot be
 * counted). The guards never read `count` when `ok` is false.
 *
 * `verified` and `count` are decided APART (review round 2): at a71cd144 both
 * guards decided "verified" with `.some(...)`, which stops at the first
 * verified TOTP factor, and admin-user-security counted with `.filter(...)`,
 * which visits every entry. So a list like `[verified totp, null]` was
 * verified for the guards (`.some` never reached the null) and 0 for
 * admin-user-security (`.filter` threw on it); `[null, verified totp]` threw
 * in both (the guards' 503). Each is kept: `count` from `.filter` in its own
 * try (a bad entry makes it 0, never touches `verified`), `verified` from
 * `.some` (a throw there is `ok: false`, the guards' 503). Do not derive one
 * from the other.
 */
export async function hasVerifiedTotp(
  admin: ServiceClient, userId: string,
): Promise<{ ok: true; verified: boolean; count: number } | { ok: false; count: number }> {
  let data: { factors?: unknown } | null | undefined = undefined
  let error: unknown = null
  try {
    ({ data, error } = await admin.auth.admin.mfa.listFactors({ userId }))
  } catch {
    return { ok: false, count: 0 }
  }
  const isVerifiedTotp = (f: { factor_type?: string; status?: string }) =>
    f.factor_type === 'totp' && f.status === 'verified'
  // admin-user-security's count, as it counted: .filter over every entry.
  let count = 0
  try {
    count = ((data?.factors ?? []) as Array<{ factor_type?: string; status?: string }>).filter(isVerifiedTotp).length
  } catch {
    count = 0
  }
  if (error) return { ok: false, count }
  // The guards' answer, as they decided it: .some, stopping at the first.
  try {
    const verified = ((data?.factors ?? []) as Array<{ factor_type?: string; status?: string }>).some(isVerifiedTotp)
    return { ok: true, verified, count }
  } catch {
    return { ok: false, count }
  }
}

export type AdminContext = {
  admin: GuardClient
  callerId: string
  workspaceId: string
}

type GuardResult =
  | { ok: true; ctx: AdminContext }
  | { ok: false; res: Response }

/**
 * What the member guard has already learnt of THIS request: the caller
 * (GoTrue asked once) and the live row as `liveMembership(…, { withRole: true })`
 * read it, for the token's workspace and user. requireActiveMember(req,
 * { withRole: true }) hands it back; requireWorkspaceAdmin(req, it) takes it in
 * place of a second authentication and a second read of the same row
 * (ai-files' sweep: OUTSTANDING F8-03, the second merger). Pass it only with
 * the request it came from.
 */
export type Authenticated = {
  caller: Caller
  live: Awaited<ReturnType<typeof liveMembership>>
}

export async function requireWorkspaceAdmin(req: Request, already?: Authenticated): Promise<GuardResult> {
  let caller: Caller
  if (already) {
    caller = already.caller
  } else {
    const who = await authenticate(req)
    if (!who.ok) return { ok: false, res: reply({ error: 'unauthorized' }, 401) }
    caller = who.caller
  }
  const { admin, user, claims } = caller

  // The role on the claim AND (below) on the live row.
  if (!claims.workspaceId || claims.appRole !== 'admin') {
    return { ok: false, res: reply({ error: 'forbidden' }, 403) }
  }

  // Live-row check: claims can outlive a demotion/deactivation by the token
  // TTL; the membership row cannot. Its error is ignored: no row is a 403.
  // The row the member guard read for this request, when it is handed over
  // (the same table, workspace, user and columns): never read twice.
  const { row: liveRow } = already
    ? already.live
    : await liveMembership(admin, claims.workspaceId, user.id, { withRole: true })
  if (!liveRow || !liveRow.is_active || liveRow.app_role !== 'admin') {
    return { ok: false, res: reply({ error: 'forbidden' }, 403) }
  }

  // MFA step-up: enrolled admins must present an aal2 token.
  //
  // Session 15 (MASTER_PLAN §6 #17, TPN TS-1.6) — this block used to swallow
  // a listFactors failure and continue. That failed OPEN: an aal1 token
  // belonging to an enrolled admin got full admin-function access whenever
  // the GoTrue admin-MFA endpoint hiccuped, which is exactly the moment you
  // least want it. It now fails CLOSED. Note supabase-js reports most
  // failures on the `error` channel rather than throwing, so an unchecked
  // `error` would have been a second, quieter version of the same bug.
  //
  // Verified safe for CI: no job calls an adminGuard-backed function. The
  // Playwright auth lane exercises invite-member — which as of Session 17
  // routes through THIS guard too (§6 #46), so that lane now depends on a
  // GoTrue that can serve admin/mfa/listFactors. The seeded probe admin has
  // no verified factor, so hasVerified stays false and the aal2 gate never
  // fires; a listFactors outage would 503 the invite rather than pass it.
  const mfa = await hasVerifiedTotp(admin, user.id)
  if (!mfa.ok) {
    // 503: transient and retryable, unlike the 403s above. The caller cannot
    // fix this by enrolling or re-authenticating.
    return { ok: false, res: reply({ error: 'mfa_check_failed' }, 503) }
  }
  const hasVerified = mfa.verified
  // Step-up only for the enrolled (operatorGuard is hard both ways instead).
  if (hasVerified && claims.aal !== 'aal2') {
    return { ok: false, res: reply({ error: 'mfa_required' }, 403) }
  }

  // The stronger gate — refuse admins who have never enrolled at all — is
  // OPT-IN via WILSON_REQUIRE_ADMIN_MFA. It is off by default deliberately:
  // turning it on locks every un-enrolled admin out of the Admin Terminal in
  // that environment, and whether Audrey and the existing prod admins hold
  // verified TOTP factors is not something this session can verify from
  // here. Flipping the secret is a one-line change once enrolment is
  // confirmed — see docs/OWED_AUDREY.md. Until then TPN-AUTH-003 stays
  // partially remediated rather than being claimed on an assumption.
  if (!hasVerified && (Deno.env.get('WILSON_REQUIRE_ADMIN_MFA') ?? '') === '1') {
    return { ok: false, res: reply({ error: 'mfa_enrollment_required' }, 403) }
  }

  return { ok: true, ctx: { admin, callerId: user.id, workspaceId: claims.workspaceId } }
}

// Show-once credential generator (locked decision #8). Unambiguous charset
// (no 0/O/1/l/I), rejection-sampled so every character is uniform.
const PW_CHARSET =
  'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789-#'

export function generatePassword(length = 20): string {
  const out: string[] = []
  const max = 256 - (256 % PW_CHARSET.length)
  while (out.length < length) {
    const buf = new Uint8Array(length * 2)
    crypto.getRandomValues(buf)
    for (const b of buf) {
      if (b < max && out.length < length) out.push(PW_CHARSET[b % PW_CHARSET.length])
    }
  }
  return out.join('')
}

// Best-effort admin audit event. Service-role insert: the 0021 stamp trigger
// trusts our actor stamp and fills the label.
export async function logAdminEvent(
  ctx: AdminContext,
  fields: { code: string; message: string; context?: Record<string, unknown> },
): Promise<void> {
  try {
    await ctx.admin.from('app_events').insert({
      workspace_id: ctx.workspaceId,
      actor_user_id: ctx.callerId,
      event_type: 'admin',
      code: fields.code,
      severity: 'info',
      message: fields.message,
      context: fields.context ?? {},
    })
  } catch {
    // Logging never blocks the action.
  }
}
