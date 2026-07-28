// =============================================================================
// provision-workspace Edge Function
//
// Self-serve company onboarding. Given a company name + slug and an admin
// profile (username, email, password, display_name), creates:
//   1. A workspaces row.
//   2. An auth.users row (email confirmed inline because Session 2 has no
//      email infra yet; Session 3 swaps this for a one-time-password flow).
//   3. A workspace_members row with app_role='admin'.
//
// Public endpoint. Rate-limited aggressively (3/h/IP) because workspace
// creation is a high-cost action.
//
// Near-atomic: Supabase has no transaction across Auth + Postgres, so the
// auth.users row is still created by a separate admin API call. Once that
// succeeds, the workspace + membership creation is a single SQL transaction
// via public.provision_workspace_and_admin() (migration 0009). On RPC
// failure we clean up the orphan auth user; on success there is nothing to
// clean up because the DB side is all-or-nothing.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, apikey',
}

// Hourly cap per IP. In-memory; resets on cold start. Tight because this
// endpoint provisions a durable resource. Swap to Upstash KV in Session 3.
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1_000
const RATE_LIMIT_MAX = 3
const rateBuckets = new Map<string, { count: number; resetAt: number }>()

function rateLimitHit(ip: string): boolean {
  const now = Date.now()
  const bucket = rateBuckets.get(ip)
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return false
  }
  bucket.count++
  return bucket.count > RATE_LIMIT_MAX
}

function clientIp(req: Request): string {
  // Trust the LAST x-forwarded-for entry: the platform proxy APPENDS the
  // real peer, while the first entry is client-supplied and trivially
  // spoofable (Session 9 review finding).
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean)
    if (parts.length > 0) return parts[parts.length - 1]
  }
  return req.headers.get('x-real-ip') ?? 'unknown'
}

function reply(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

// ── Validators. Same shape rules as the DB check constraints. ─────────
const SLUG_RE     = /^[a-z0-9][a-z0-9-]{1,62}$/
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/
const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

type Body = {
  company_name?: string
  slug?: string
  username?: string
  email?: string
  password?: string
  display_name?: string
  // Session 9 (locked §10-D): Slack-style initial team — invited AFTER the
  // workspace exists, server-side, because the new admin has no JWT yet.
  invites?: Array<{ email?: string; username?: string; app_role?: string }>
}

// ── Session 9: initial-team invites ───────────────────────────────────
const SITE_URL = Deno.env.get('WILSON_SITE_URL') ?? 'http://localhost:5203'
const INVITE_ROLE_SET = new Set(['admin', 'manager', 'user'])
const MAX_INVITES = 19

// Blast-radius cap on outbound invite email from this PUBLIC endpoint: a
// per-isolate hourly budget on top of the per-IP limiter (which an attacker
// can dodge via cold starts / spoofed XFF chains). Exceeding it fails the
// remaining invites with 'rate_limited' — provisioning itself still
// succeeds and the admin re-invites from the terminal. S11's TPN pass owns
// a durable (DB-backed) limiter.
const INVITE_BUDGET_PER_HOUR = 60
let inviteBudget = { windowStart: Date.now(), sent: 0 }
function inviteBudgetExhausted(): boolean {
  const now = Date.now()
  if (now - inviteBudget.windowStart > 60 * 60 * 1000) {
    inviteBudget = { windowStart: now, sent: 0 }
  }
  return inviteBudget.sent >= INVITE_BUDGET_PER_HOUR
}

type InviteResult = { email: string; username?: string; status: 'invited' | 'failed'; error?: string }

// Derive a valid, workspace-unique username from the email local part.
function deriveUsername(email: string, taken: Set<string>): string {
  let base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '.')
    .replace(/^[^a-z0-9]+/, '').slice(0, 32)
  if (base.length < 2) base = `user${base}`.slice(0, 32)
  if (!USERNAME_RE.test(base)) base = 'user.invite'
  let candidate = base
  let n = 2
  while (taken.has(candidate)) {
    const suffix = String(n++)
    candidate = base.slice(0, 32 - suffix.length) + suffix
  }
  return candidate
}

// One invite, mirroring invite-member's core (inviteUserByEmail + membership
// + app_metadata seed). Failures never abort provisioning — per-item report.
async function sendInitialInvite(
  admin: ReturnType<typeof createClient>,
  workspaceId: string,
  companyName: string,
  inviterName: string,
  invite: { email: string; username: string; app_role: string },
): Promise<InviteResult> {
  const { email, username, app_role } = invite
  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
    email,
    {
      data: { company_name: companyName, inviter_name: inviterName, username },
      redirectTo: `${SITE_URL}/#/recovery`,
    },
  )
  if (inviteErr || !invited.user) {
    const taken = /already|duplicate/i.test(inviteErr?.message ?? '')
    return { email, username, status: 'failed', error: taken ? 'email_taken' : 'invite_failed' }
  }
  const { error: memErr } = await admin.from('workspace_members').insert({
    workspace_id: workspaceId,
    user_id: invited.user.id,
    app_role,
    username,
    display_name: username,
    is_active: true,
  })
  if (memErr) {
    try { await admin.auth.admin.deleteUser(invited.user.id) } catch { /* best-effort */ }
    return { email, username, status: 'failed', error: 'membership_create_failed' }
  }
  try {
    await admin.auth.admin.updateUserById(invited.user.id, {
      app_metadata: { workspace_id: workspaceId },
    })
  } catch { /* hook fills it on first sign-in */ }
  return { email, username, status: 'invited' }
}

type ValidationError = { field: string; error: string }

type ValidatedInput = {
  company_name: string
  slug: string
  username: string
  email: string
  password: string
  display_name: string
}

type ValidateResult =
  | { ok: true;  data: ValidatedInput }
  | { ok: false; errors: ValidationError[] }

function validate(body: Body): ValidateResult {
  const errors: ValidationError[] = []
  const name = typeof body.company_name === 'string' ? body.company_name.trim() : ''
  const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : ''
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : ''

  if (name.length < 1 || name.length > 80)   errors.push({ field: 'company_name', error: 'length 1–80' })
  if (!SLUG_RE.test(slug))                   errors.push({ field: 'slug',         error: 'invalid shape' })
  if (!USERNAME_RE.test(username))           errors.push({ field: 'username',     error: 'invalid shape' })
  if (!EMAIL_RE.test(email))                 errors.push({ field: 'email',        error: 'invalid shape' })
  if (password.length < 10 || password.length > 128) errors.push({ field: 'password', error: 'length 10–128' })
  if (displayName.length > 80)               errors.push({ field: 'display_name', error: 'length 0–80' })

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    data: {
      company_name: name,
      slug,
      username,
      email,
      password,
      display_name: displayName || username,
    },
  }
}

// Best-effort cleanup of the orphan auth user after a DB-side failure. The
// RPC handles workspace + membership atomically, so if it throws, neither
// row was committed — the only thing left dangling is the auth.users row
// created in the preceding step.
async function cleanupAuthUser(admin: ReturnType<typeof createClient>, userId: string | null) {
  try {
    if (userId) await admin.auth.admin.deleteUser(userId)
  } catch { /* swallow — secondary to the real failure */ }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return reply({ error: 'method_not_allowed' }, 405)
  }

  const ip = clientIp(req)
  if (rateLimitHit(ip)) {
    return reply({ error: 'rate_limited' }, 429)
  }

  let body: Body
  try { body = await req.json() } catch { return reply({ error: 'bad_json' }, 400) }

  const v = validate(body)
  if (!v.ok) return reply({ error: 'validation_failed', errors: v.errors }, 400)
  const { company_name, slug, username, email, password, display_name } = v.data

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

  // 1. Pre-flight: slug already taken? The RPC also enforces this, but
  //    checking here lets us return 409 before creating the auth user —
  //    otherwise we'd have to roll back the user on slug_taken, which is
  //    correct but wasteful.
  const { data: slugHit } = await admin
    .from('workspaces')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()
  if (slugHit) return reply({ error: 'slug_taken' }, 409)

  // 2. Create the admin auth user. email_confirm=true because Session 2 has
  //    no email infra; Session 3's invite flow uses a different path entirely
  //    (invite-member Edge Function), so this self-serve path keeps the
  //    inline confirm for first-admin-of-a-new-company provisioning.
  const { data: createdUser, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name },
  })
  if (userErr || !createdUser.user) {
    const taken = /already\s*exists|duplicate/i.test(userErr?.message ?? '')
    return reply({ error: taken ? 'email_taken' : 'user_create_failed', detail: userErr?.message ?? 'unknown' }, taken ? 409 : 500)
  }

  // 3. Atomic workspace + membership creation via the PL/pgSQL RPC
  //    (migration 0009). The function does its own validation and raises
  //    'slug_taken' / 'username shape invalid' / etc. as plain exceptions.
  const { data: rpcRows, error: rpcErr } = await admin.rpc(
    'provision_workspace_and_admin',
    {
      p_workspace_name: company_name,
      p_slug:           slug,
      p_admin_user_id:  createdUser.user.id,
      p_admin_username: username,
      p_admin_display:  display_name,
    },
  )

  if (rpcErr || !rpcRows || (Array.isArray(rpcRows) && rpcRows.length === 0)) {
    await cleanupAuthUser(admin, createdUser.user.id)
    const msg = rpcErr?.message ?? 'unknown'
    if (/slug_taken/.test(msg))       return reply({ error: 'slug_taken',       detail: msg }, 409)
    if (/username shape/.test(msg))   return reply({ error: 'username_invalid', detail: msg }, 400)
    if (/duplicate|unique/i.test(msg)) return reply({ error: 'username_taken',  detail: msg }, 409)
    return reply({ error: 'provision_failed', detail: msg }, 500)
  }

  const row = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows
  const workspaceId = row.workspace_id as string

  // 4. Pre-populate app_metadata.workspace_id so the first JWT the user ever
  //    receives carries the right workspace. Matches what issue-session does.
  try {
    await admin.auth.admin.updateUserById(createdUser.user.id, {
      app_metadata: { workspace_id: workspaceId },
    })
  } catch { /* best-effort; custom_access_token_hook would still pick it up */ }

  // 5. Session 9: initial-team invites (best-effort, per-item results). The
  //    admin's own username is already seated; every derived username is
  //    deduped against rows AND this batch. Bad rows fail individually.
  const invitesIn = Array.isArray(body.invites) ? body.invites.slice(0, MAX_INVITES) : []
  const inviteResults: InviteResult[] = []
  if (invitesIn.length > 0) {
    const taken = new Set<string>([username])
    const seenEmails = new Set<string>([email])
    for (const raw of invitesIn) {
      const invEmail = typeof raw?.email === 'string' ? raw.email.trim().toLowerCase() : ''
      if (!EMAIL_RE.test(invEmail)) {
        inviteResults.push({ email: invEmail || '(empty)', status: 'failed', error: 'invalid_email' })
        continue
      }
      if (seenEmails.has(invEmail)) {
        inviteResults.push({ email: invEmail, status: 'failed', error: 'duplicate_email' })
        continue
      }
      seenEmails.add(invEmail)
      let invUsername = typeof raw?.username === 'string' ? raw.username.trim().toLowerCase() : ''
      if (invUsername && !USERNAME_RE.test(invUsername)) {
        inviteResults.push({ email: invEmail, username: invUsername, status: 'failed', error: 'invalid_username' })
        continue
      }
      if (!invUsername || taken.has(invUsername)) {
        invUsername = deriveUsername(invEmail, taken)
      }
      taken.add(invUsername)
      const invRole = INVITE_ROLE_SET.has(raw?.app_role ?? '') ? (raw!.app_role as string) : 'user'
      if (inviteBudgetExhausted()) {
        inviteResults.push({ email: invEmail, username: invUsername, status: 'failed', error: 'rate_limited' })
        continue
      }
      inviteBudget.sent += 1
      inviteResults.push(await sendInitialInvite(
        admin, workspaceId, company_name, display_name, {
          email: invEmail, username: invUsername, app_role: invRole,
        },
      ))
    }
  }

  return reply({
    workspace_id:   workspaceId,
    workspace_slug: row.workspace_slug,
    user_id:        createdUser.user.id,
    ...(invitesIn.length > 0 ? { invites: inviteResults } : {}),
  }, 201)
})
