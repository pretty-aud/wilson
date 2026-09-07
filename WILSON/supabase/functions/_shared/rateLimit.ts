// =============================================================================
// _shared/rateLimit.ts — Session 15 (MASTER_PLAN §6 #16, TPN AS-3.8)
//
// The durable replacement for the per-isolate in-memory limiters.
//
// What was wrong with those: `const windows = new Map()` inside an Edge
// Function counts requests for ONE Deno isolate. The platform runs as many
// isolates as it likes and recycles them on cold starts, so a "60 per
// minute" limit was really "60 per minute per isolate, resetting at
// unpredictable intervals" — an unknowable number, on the one endpoint
// (ai-proxy) where the overage is billed by Anthropic.
//
// This calls public.fn_rate_limit_hit (0028), which is a single upsert
// against a shared Postgres row. Every isolate sees the same counter.
//
// Fail-open vs fail-closed: this helper fails OPEN if the RPC itself errors,
// and that is a deliberate, narrow choice. The limiter is an abuse control,
// not an authorization control — authorization already ran in the guard
// above it. Failing closed would turn a database hiccup into a total
// outage of every AI feature for every tenant, which is a worse failure
// than briefly not rate-limiting. Note this is the OPPOSITE of the call
// made in operatorGuard, where a failed check gates privilege and therefore
// must refuse. A limiter that cannot count and an auth check that cannot
// verify are not the same kind of unknown.
// =============================================================================

import type { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

type Client = ReturnType<typeof createClient>

/** Read a positive integer env var, falling back when absent or malformed. */
export function envInt(name: string, fallback: number): number {
  const raw = Number(Deno.env.get(name) ?? '')
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

/**
 * Count this request and report whether the caller is OVER the limit.
 * `limit` is inclusive: limit=60 allows the 60th call and refuses the 61st.
 */
export async function isRateLimited(
  admin: Client,
  bucket: string,
  subject: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc('fn_rate_limit_hit', {
      p_bucket: bucket,
      p_subject: subject,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    })
    if (error) {
      // Loud on purpose. Fail-open is the right call (see header) but a
      // permanently-failing limiter is indistinguishable from a working one
      // from the outside — the endpoint just stops refusing anything. This
      // line in the function logs is the only signal that "durable rate
      // limiting" has quietly become no rate limiting at all.
      console.error(`rate-limit RPC failed (${bucket}): ${error.message}`)
      return false
    }
    return data === true
  } catch (err) {
    console.error(`rate-limit RPC threw (${bucket}): ${String((err as Error)?.message ?? err)}`)
    return false
  }
}
