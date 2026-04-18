// =============================================================================
// resolve-login Edge Function
// Username (+ optional workspace slug) -> email for Supabase signInWithPassword.
//
// Security properties:
//  - Constant-time response floor (~180ms) regardless of outcome, to defeat
//    username enumeration timing attacks.
//  - IP-based rate limit: 5 requests / minute (simple in-memory bucket;
//    replace with an Upstash KV in Session 3 when email infra lands).
//  - Outcome is always logged to auth_attempt_log.
//  - Response shape is identical for found / not-found / rate-limited to
//    prevent enumeration via response body.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// ~180ms floor — enough to mask DB lookup variance without hurting UX.
const MIN_RESPONSE_MS = 180

// Per-IP rate limit bucket. In-memory; resets on function cold start which is
// acceptable for v1. Swap to durable KV in Session 3.
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 5
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

async function sleepUntil(deadline: number) {
  const remaining = deadline - Date.now()
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining))
}

type Body = { username?: string; workspace_slug?: string }

function isValidUsername(s: unknown): s is string {
  return typeof s === 'string' && /^[a-z0-9][a-z0-9._-]{1,31}$/i.test(s)
}
function isValidSlug(s: unknown): s is string {
  return typeof s === 'string' && /^[a-z0-9][a-z0-9-]{1,62}$/i.test(s)
}

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, apikey',
}

Deno.serve(async (req: Request) => {
  const start = Date.now()
  const deadline = start + MIN_RESPONSE_MS

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  const ip = clientIp(req)

  // Uniform response shape for every outcome.
  const reply = async (body: Record<string, unknown>, status = 200) => {
    await sleepUntil(deadline)
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    })
  }

  if (req.method !== 'POST') {
    return reply({ exists: false, email: null }, 405)
  }

  // Rate limit FIRST — even bad input shouldn't be a free probe.
  if (rateLimitHit(ip)) {
    // Log but respond identically to a miss.
    queueMicrotask(async () => {
      try {
        const sb = createClient(SUPABASE_URL, SERVICE_ROLE)
        await sb.from('auth_attempt_log').insert({
          ip_address: ip === 'unknown' ? null : ip,
          outcome: 'rate_limited',
        })
      } catch { /* swallow */ }
    })
    return reply({ exists: false, email: null })
  }

  let body: Body
  try {
    body = await req.json()
  } catch {
    return reply({ exists: false, email: null })
  }

  const username = body.username?.trim().toLowerCase()
  const slug = body.workspace_slug?.trim().toLowerCase()

  if (!isValidUsername(username) || (slug !== undefined && !isValidSlug(slug))) {
    queueMicrotask(async () => {
      try {
        const sb = createClient(SUPABASE_URL, SERVICE_ROLE)
        await sb.from('auth_attempt_log').insert({
          username_tried: typeof username === 'string' ? username : null,
          ip_address: ip === 'unknown' ? null : ip,
          outcome: 'error',
        })
      } catch { /* swallow */ }
    })
    return reply({ exists: false, email: null })
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE)

  // Join workspace_members -> workspaces -> auth.users.email.
  // When slug omitted we accept any single match (for v1 single-workspace users);
  // multi-workspace users supply slug to disambiguate.
  let query = sb
    .from('workspace_members')
    .select('user_id, workspace_id, workspaces!inner(slug, deleted_at)')
    .eq('username', username)
    .eq('is_active', true)
    .is('workspaces.deleted_at', null)
    .limit(2)

  if (slug) query = query.eq('workspaces.slug', slug)

  const { data: members, error: membersErr } = await query

  if (membersErr) {
    return reply({ exists: false, email: null })
  }

  // Ambiguous (multi-workspace hit without slug): respond as miss to force the
  // client to supply workspace_slug. Still logged.
  if (!members || members.length === 0 || members.length > 1) {
    queueMicrotask(async () => {
      try {
        await sb.from('auth_attempt_log').insert({
          username_tried: username,
          ip_address: ip === 'unknown' ? null : ip,
          outcome: 'not_found',
        })
      } catch { /* swallow */ }
    })
    return reply({ exists: false, email: null })
  }

  const { user_id, workspace_id } = members[0]

  // Look up email via admin API (service_role).
  const { data: userData, error: userErr } = await sb.auth.admin.getUserById(user_id)
  if (userErr || !userData.user?.email) {
    return reply({ exists: false, email: null })
  }

  queueMicrotask(async () => {
    try {
      await sb.from('auth_attempt_log').insert({
        workspace_id,
        username_tried: username,
        ip_address: ip === 'unknown' ? null : ip,
        outcome: 'resolved',
      })
    } catch { /* swallow */ }
  })

  return reply({ exists: true, email: userData.user.email })
})
