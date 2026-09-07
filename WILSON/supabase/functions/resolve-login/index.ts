// =============================================================================
// resolve-login Edge Function
// Username (+ workspace slug) -> email for Supabase signInWithPassword, and
// the company-existence check that runs before it (contract v2, Session 43).
//
// Security properties:
//  - Constant-time response floor (~180ms) regardless of outcome, to defeat
//    username enumeration timing attacks.
//  - Per-IP rate limit through the DURABLE limiter (public.fn_rate_limit_hit,
//    migration 0028; one counter shared by every isolate). Two buckets, one
//    per path, so a burst of company probes cannot lock credentials out and
//    vice versa. It fails CLOSED: this is a pre-authentication endpoint and
//    the limiter is the only volume control, so a limiter that cannot count
//    refuses (TPN-NET-011). Track B bundle B1 replaced the per-isolate Map
//    that TPN-NET-005 recorded.
//  - The IP is Cloudflare's `cf-connecting-ip`, with the X-Forwarded-For hop
//    BEFORE the platform relay as the fallback — never the first hop, which
//    the caller supplies (TPN-NET-004), and never the last, which is the
//    platform's own relay (measured; see clientIp).
//  - Outcome is always logged to auth_attempt_log.
//  - Response BODY shape is identical for found / not-found / rate-limited to
//    prevent enumeration via response body. A rate-limited call answers 429,
//    so the client can say "wait a minute" instead of "wrong password". The
//    status depends only on the caller's own request count in the window,
//    never on whether a username or a company exists.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { envInt, isRateLimited } from '../_shared/rateLimit.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// ~180ms floor — enough to mask DB lookup variance without hurting UX.
const MIN_RESPONSE_MS = 180

// Per-IP limits, per fixed 60-second window, one bucket per path.
//
// Why these numbers: an office signs in from ONE NAT address, and a person
// who mistypes a password needs several attempts inside a minute — so the
// credentials bucket is generous. The company bucket is tighter because a
// real person clears step 1 once or twice per sign-in, and it is the one
// that is also a company-existence oracle (see the company branch below).
// Both are the VOLUME bound only; the constant-time floor and the uniform
// body are what keep the username path closed to enumeration.
const RATE_WINDOW_SECONDS = 60
const COMPANY_RPM = envInt('RESOLVE_LOGIN_COMPANY_RPM', 20)
const USER_RPM    = envInt('RESOLVE_LOGIN_USER_RPM', 30)

// Which address is the caller's — MEASURED, because the obvious answers are
// both wrong on this platform.
//
// wilson-dev, 2026-09-06, via a throwaway header-echo function (deleted the
// same minute): every request to <ref>.supabase.co arrives through Cloudflare
// and then AWS, and x-forwarded-for reaches the function as
//
//   "<anything the caller sent>, <client as Cloudflare saw it>,
//    <client as the AWS load balancer saw it>, <13.248.0.0/14 relay>"
//
// So the FIRST hop is caller-supplied — a throttle keyed on it is not a
// throttle, and auth_attempt_log named whatever the caller typed
// (TPN-NET-004). And the LAST hop is the platform's own relay, which varies
// per request: keyed on it, 22 requests from one machine landed in ten
// limiter rows of 1–4 hits and nothing was refused — and once a relay's
// shared counter did cross the limit it would refuse EVERY customer behind
// it at once. The S9 comment in the old provision-workspace that said "take
// the last hop" was wrong here. Cloudflare sets `cf-connecting-ip` from the
// actual connection; a caller-supplied value does not get through the edge
// (measured: the request is answered by Cloudflare, not by us). Fallback,
// for a request that somehow arrives without it: the hop BEFORE the relay.
function clientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip')?.trim()
  if (cf) return cf
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean)
    if (parts.length >= 2) return parts[parts.length - 2]
    if (parts.length === 1) return parts[0]
  }
  return req.headers.get('x-real-ip') ?? 'unknown'
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
// B1 did not bump it: the body shape is unchanged, and 429 is a status an
// older client reads as "unavailable" (it degrades), not as a refusal.
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
//
// `*` is a FOURTH one, and it is PostgREST's, not Postgres's: the `like` and
// `ilike` filters accept `*` as an alias of `%` (so a pattern survives URL
// encoding) and rewrite it before the query runs, so a backslash in front of
// it never reaches LIKE. Measured on wilson-dev (Track B bundle B1, review
// round R1, 2026-09-06): `smo*`, `Smoke Work*` and `S*e Workspace` all
// resolved the smoke workspace and handed back its slug — a prefix search over
// customer names, which is more than TPN-AUTH-009 accepts. There is no way to
// send a literal `*` through that filter, so it becomes `_` (exactly one
// character, the narrowest wildcard there is) and the company branch re-checks
// the rows that come back for equality with what was typed.
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/\*/g, '_')
}

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, apikey',
}

type AttemptRow = {
  workspace_id?: string | null
  username_tried?: string | null
  outcome: 'resolved' | 'not_found' | 'rate_limited' | 'error'
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

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

  // Fire-and-forget audit row; never on the response path.
  const log = (row: AttemptRow) => {
    queueMicrotask(async () => {
      try {
        await admin.from('auth_attempt_log').insert({
          ...row,
          ip_address: ip === 'unknown' ? null : ip,
        })
      } catch { /* swallow */ }
    })
  }

  // A malformed body is not a free probe: it is parsed as empty, counted
  // against the credentials bucket, and refused as a miss below.
  let body: Body = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  if (body === null || typeof body !== 'object') body = {}

  const companyMode = typeof body.company === 'string' && body.username === undefined
  const miss = companyMode
    ? { exists: false, slug: null, v: CONTRACT_VERSION }
    : { exists: false, email: null }

  // Rate limit FIRST — before any lookup, for either path.
  const limited = await isRateLimited(
    admin,
    companyMode ? 'resolve-login:company' : 'resolve-login:user',
    ip,
    companyMode ? COMPANY_RPM : USER_RPM,
    RATE_WINDOW_SECONDS,
    { failOpen: false },
  )
  if (limited) {
    log({ outcome: 'rate_limited' })
    return reply(miss, 429)
  }

  // ── Company verification (Session 43) ──────────────────────────────────
  // Audrey, 2026-08-10: "the user has to enter the company, the system should
  // verify that company exists, the login after the company should only allow
  // users of that company to login." Reaffirmed 2026-09-04 (fix plan, answer
  // 34): "the system should confirm the company listed first exists and is
  // real, after it makes sure the company exists THEN it should pull from
  // that companies list."
  //
  // ⚠️ This IS a company-existence oracle, and that is a deliberate product
  // decision taken with the trade-off on the table: anyone holding the anon
  // key can test whether a company name is a customer. It is bounded by the
  // durable per-IP limiter above (COMPANY_RPM per minute per address), the
  // ~180ms constant-time floor, and a reply that is a boolean plus the
  // canonical slug — never a name, never a list, never a count. Do not extend
  // it to return anything else. The USERNAME path's enumeration defence is
  // untouched.
  //
  // ONE answer for "no such company" and "company exists but is suspended":
  // a suspended workspace is a soft-deleted one (deleted_at set by the
  // operator console), and the `deleted_at IS NULL` filter on both lookups
  // makes it indistinguishable from a name that was never created. The step
  // reveals existence only, never status.
  //
  // Accepts the display NAME or the slug, because they are independent: the
  // operator console only seeds the slug from the name and leaves it editable,
  // and 0020 freezes it while the name stays renameable. Measured on
  // wilson-dev 2026-08-10, four of four workspaces had a slug that no
  // derivation of their name would produce ("Petal Studios" is `petal`), so a
  // slug-only match would refuse every real company.
  if (companyMode) {
    const typed = (body.company as string).trim()
    if (typed.length < 1 || typed.length > 80) {
      return reply(miss)
    }

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
    //    metacharacters escaped is an equality test, not a prefix search —
    //    except for `*`, which PostgREST rewrites to `%` before Postgres sees
    //    it (escapeLike folds it to a one-character `_`). So the pattern can
    //    still match a SUPERSET of the exact name, and the rows that come back
    //    are re-checked here: a candidate counts only if its name IS what was
    //    typed, case aside. Before this check existed, `smo*` resolved the
    //    smoke workspace (B1 review round R1, measured on wilson-dev).
    if (!hit) {
      const wanted = typed.toLowerCase()
      const { data } = await admin
        .from('workspaces')
        .select('id, slug, name')
        .ilike('name', escapeLike(typed))
        .is('deleted_at', null)
        .limit(10)
      const exact = ((data ?? []) as { id: string; slug: string; name: string | null }[])
        .filter((w) => typeof w.name === 'string' && w.name.toLowerCase() === wanted)
      // Two workspaces sharing a display name cannot be disambiguated from a
      // name alone — refuse rather than pick one and sign the user into the
      // wrong tenant.
      if (exact.length === 1) hit = { id: exact[0].id, slug: exact[0].slug }
    }

    log({ workspace_id: hit?.id ?? null, outcome: hit ? 'resolved' : 'not_found' })

    return reply({ exists: !!hit, slug: hit?.slug ?? null, v: CONTRACT_VERSION })
  }

  const username = body.username?.trim().toLowerCase()
  const slug = body.workspace_slug?.trim().toLowerCase()

  if (!isValidUsername(username) || (slug !== undefined && !isValidSlug(slug))) {
    log({ username_tried: typeof username === 'string' ? username : null, outcome: 'error' })
    return reply(miss)
  }

  // Join workspace_members -> workspaces -> auth.users.email.
  //
  // The B1 client ALWAYS sends the slug it got back from the company step, so
  // from that client the "two matches" branch below is unreachable: the same
  // username in two companies is two different people, and the slug picks
  // one ("two files with the same name in different folders" — Audrey).
  // When the slug is omitted we still accept any SINGLE match, for older
  // clients and for the CI smoke probe (scripts/probes/issue-session.sh),
  // which resolves by username alone.
  let query = admin
    .from('workspace_members')
    .select('user_id, workspace_id, workspaces!inner(slug, deleted_at)')
    .eq('username', username)
    .eq('is_active', true)
    .is('workspaces.deleted_at', null)
    .limit(2)

  if (slug) query = query.eq('workspaces.slug', slug)

  const { data: members, error: membersErr } = await query

  if (membersErr) {
    return reply(miss)
  }

  // Ambiguous (multi-workspace hit without slug): respond as miss to force the
  // client to supply workspace_slug. Still logged.
  if (!members || members.length === 0 || members.length > 1) {
    log({ username_tried: username, outcome: 'not_found' })
    return reply(miss)
  }

  const { user_id, workspace_id } = members[0]

  // Look up email via admin API (service_role).
  const { data: userData, error: userErr } = await admin.auth.admin.getUserById(user_id)
  if (userErr || !userData.user?.email) {
    return reply(miss)
  }

  log({ workspace_id, username_tried: username, outcome: 'resolved' })

  return reply({ exists: true, email: userData.user.email })
})
