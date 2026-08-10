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

type Body = { username?: string; workspace_slug?: string; company?: string }

// Bumped when the response contract changes. The client uses it to tell a
// DEPLOYED function that understands company verification from an older one:
// an old deployment answers `{exists:false}` to a body with no username, which
// is indistinguishable from "no such company". Without this marker, shipping
// the client before the function would lock everyone out instead of degrading.
const CONTRACT_VERSION = 2

function isValidUsername(s: unknown): s is string {
  return typeof s === 'string' && /^[a-z0-9][a-z0-9._-]{1,31}$/i.test(s)
}
function isValidSlug(s: unknown): s is string {
  return typeof s === 'string' && /^[a-z0-9][a-z0-9-]{1,62}$/i.test(s)
}

// Mirrors src/cloud/auth/workspaceSlug.js — a company typed as a display name
// has to reach the same slug on both sides.
function slugifyWorkspace(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
}

// `%`, `_` and `\` are LIKE metacharacters. A company called "50% Studio" must
// not match "50X Studio".
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
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

  // ── Company verification (Session 43) ──────────────────────────────────
  // Audrey, 2026-08-10: "the user has to enter the company, the system should
  // verify that company exists, the login after the company should only allow
  // users of that company to login."
  //
  // ⚠️ This IS a company-existence oracle, and that is a deliberate product
  // decision taken with the trade-off on the table: anyone holding the anon
  // key can now test whether a company name is a customer. It is bounded by
  // the same per-IP limiter and the same ~180ms constant-time floor as the
  // username path, and it returns a boolean plus the canonical slug — never a
  // name, never a list, never a count. Do not extend it to return anything
  // else. The USERNAME path's enumeration defence is untouched.
  //
  // Accepts the display NAME or the slug, because they are independent: the
  // operator console only seeds the slug from the name and leaves it editable,
  // and 0020 freezes it while the name stays renameable. Measured on
  // wilson-dev 2026-08-10, four of four workspaces had a slug that no
  // derivation of their name would produce ("Petal Studios" is `petal`), so a
  // slug-only match would refuse every real company.
  if (typeof body.company === 'string' && body.username === undefined) {
    const typed = body.company.trim()
    if (typed.length < 1 || typed.length > 80) {
      return reply({ exists: false, slug: null, v: CONTRACT_VERSION })
    }

    // Own client: the shared `sb` below is declared after this branch.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

    // 1. Exact slug match (covers someone typing the slug they were given).
    const candidate = slugifyWorkspace(typed)
    let hit: { slug: string; id: string } | null = null

    if (isValidSlug(candidate)) {
      const { data } = await admin
        .from('workspaces')
        .select('id, slug')
        .eq('slug', candidate)
        .is('deleted_at', null)
        .limit(1)
      if (data && data.length === 1) hit = data[0] as { slug: string; id: string }
    }

    // 2. Case-insensitive exact match on the display name. `.ilike` with the
    //    metacharacters escaped is an equality test, not a prefix search.
    if (!hit) {
      const { data } = await admin
        .from('workspaces')
        .select('id, slug')
        .ilike('name', escapeLike(typed))
        .is('deleted_at', null)
        .limit(2)
      // Two workspaces sharing a display name cannot be disambiguated from a
      // name alone — refuse rather than pick one and sign the user into the
      // wrong tenant.
      if (data && data.length === 1) hit = data[0] as { slug: string; id: string }
    }

    queueMicrotask(async () => {
      try {
        await admin.from('auth_attempt_log').insert({
          workspace_id: hit?.id ?? null,
          ip_address: ip === 'unknown' ? null : ip,
          outcome: hit ? 'resolved' : 'not_found',
        })
      } catch { /* swallow */ }
    })

    return reply({ exists: !!hit, slug: hit?.slug ?? null, v: CONTRACT_VERSION })
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
