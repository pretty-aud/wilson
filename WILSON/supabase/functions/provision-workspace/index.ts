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
// Not atomic — Supabase has no transaction across Auth + Postgres. On
// partial failure we make a best-effort cleanup before returning an error.
// A proper transactional PL/pgSQL RPC is queued for Session 3.
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
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
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

// Best-effort cleanup after partial failure. We never surface cleanup errors
// because they're secondary to the real failure the caller will see.
async function cleanup(admin: ReturnType<typeof createClient>, workspaceId: string | null, userId: string | null) {
  try {
    if (workspaceId) await admin.from('workspaces').delete().eq('id', workspaceId)
  } catch { /* swallow */ }
  try {
    if (userId) await admin.auth.admin.deleteUser(userId)
  } catch { /* swallow */ }
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

  // 1. Pre-flight: slug already taken? (unique index catches it too; nicer UX.)
  const { data: slugHit } = await admin
    .from('workspaces')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()
  if (slugHit) return reply({ error: 'slug_taken' }, 409)

  // 2. Create the workspace. No RLS bypass needed — we're service_role.
  const { data: ws, error: wsErr } = await admin
    .from('workspaces')
    .insert({ name: company_name, slug })
    .select('id, slug')
    .single()
  if (wsErr || !ws) {
    return reply({ error: 'workspace_create_failed', detail: wsErr?.message ?? 'unknown' }, 500)
  }

  // 3. Create the admin auth user. email_confirm=true because Session 2 has
  //    no email infra; Session 3 will switch this to the invite flow.
  const { data: createdUser, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name },
  })
  if (userErr || !createdUser.user) {
    await cleanup(admin, ws.id, null)
    const taken = /already\s*exists|duplicate/i.test(userErr?.message ?? '')
    return reply({ error: taken ? 'email_taken' : 'user_create_failed', detail: userErr?.message ?? 'unknown' }, taken ? 409 : 500)
  }

  // 4. Membership row (admin).
  const { error: memErr } = await admin
    .from('workspace_members')
    .insert({
      workspace_id: ws.id,
      user_id:      createdUser.user.id,
      app_role:     'admin',
      username,
      display_name,
      is_active:    true,
    })
  if (memErr) {
    await cleanup(admin, ws.id, createdUser.user.id)
    // Username uniqueness within workspace is enforced by a unique index.
    const taken = /duplicate|unique/i.test(memErr.message)
    return reply({ error: taken ? 'username_taken' : 'membership_create_failed', detail: memErr.message }, taken ? 409 : 500)
  }

  // 5. Pre-populate app_metadata.workspace_id so the first JWT the user ever
  //    receives carries the right workspace. Matches what issue-session does.
  try {
    await admin.auth.admin.updateUserById(createdUser.user.id, {
      app_metadata: { workspace_id: ws.id },
    })
  } catch { /* best-effort; custom_access_token_hook would still pick it up */ }

  return reply({
    workspace_id:   ws.id,
    workspace_slug: ws.slug,
    user_id:        createdUser.user.id,
  }, 201)
})
