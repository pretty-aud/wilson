// =============================================================================
// _shared/operatorGuard.ts — Session 15
//
// The platform-operator tier. Sibling of adminGuard (company admins) and
// memberGuard (any active member); this is the tier ABOVE both, used only by
// the operator console at /wilsonadmin.
//
// Three deliberate differences from requireWorkspaceAdmin, each with a
// reason — this is not a copy-paste with the role string swapped:
//
//   1. NO workspaceId in the context. An operator is not a member of the
//      companies they administer; every call names its target workspace
//      explicitly in the body and the function resolves it with service
//      role. There is nothing safe to default to, so there is no default.
//
//   2. The JWT `is_platform_operator` claim is NOT required. adminGuard
//      pre-filters on the app_role claim, but for this tier the claim is
//      strictly weaker than the live-row check that follows it, and
//      requiring it would add a lockout mode with no security gain: the
//      claim only exists while the custom_access_token_hook is enabled in
//      the Supabase Dashboard (config.toml alone does not turn it on —
//      see supabase/config.toml). public.platform_operators is the
//      authority, exactly as migration 0028's is_platform_operator() has
//      it, so a revoked operator loses the console on their next request
//      rather than at their next token refresh.
//
//   3. MFA is a HARD requirement, both ways. adminGuard only challenges
//      admins who happen to have enrolled, and (until S15) let a
//      listFactors failure through. Here an operator with no verified TOTP
//      factor is refused outright, and a failure to establish MFA state is
//      refused too. This is the highest-privilege surface in the system —
//      it can destroy a company — and it is brand new, so there is no
//      existing workflow to break by requiring enrolment from day one
//      (TPN TS-1.6: MFA on all admin/privileged access).
//
// Note there is deliberately NO grant/revoke-operator endpoint anywhere.
// Operator status is inserted into public.platform_operators by SQL, out of
// band. That means the platform tier cannot be escalated from a web
// session at all — a property worth more than the convenience of a button.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { corsHeaders, reply, decodeJwtPayload } from './adminGuard.ts'

export { corsHeaders, reply, decodeJwtPayload }

export type OperatorContext = {
  admin: ReturnType<typeof createClient>
  callerId: string
  callerLabel: string | null
}

type GuardResult =
  | { ok: true; ctx: OperatorContext }
  | { ok: false; res: Response }

export async function requirePlatformOperator(req: Request): Promise<GuardResult> {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7)
    : ''
  if (!token) return { ok: false, res: reply({ error: 'unauthorized' }, 401) }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

  // GoTrue validates the ES256 signature. Everything below trusts the user id
  // this returns, never anything decoded from the token by hand.
  const { data: caller, error: callerErr } = await admin.auth.getUser(token)
  if (callerErr || !caller.user) {
    return { ok: false, res: reply({ error: 'unauthorized' }, 401) }
  }

  // Live row IS the authority (see header note 2).
  const { data: liveRow, error: rowErr } = await admin
    .from('platform_operators')
    .select('user_id')
    .eq('user_id', caller.user.id)
    .maybeSingle()
  if (rowErr) {
    // A failed lookup is not a pass. The whole point of the live-row check is
    // that it is the thing standing between a stale token and the platform.
    return { ok: false, res: reply({ error: 'operator_check_failed' }, 503) }
  }
  if (!liveRow) {
    return { ok: false, res: reply({ error: 'forbidden' }, 403) }
  }

  // MFA, hard (see header note 3). supabase-js reports most failures on the
  // `error` channel rather than throwing, so both are handled — an unchecked
  // `error` here would be the fail-open this guard exists to avoid.
  let hasVerified = false
  try {
    const { data: factorData, error: factorErr } = await admin.auth.admin.mfa.listFactors({
      userId: caller.user.id,
    })
    if (factorErr) throw factorErr
    hasVerified = (factorData?.factors ?? []).some(
      (f: { factor_type?: string; status?: string }) =>
        f.factor_type === 'totp' && f.status === 'verified',
    )
  } catch {
    return { ok: false, res: reply({ error: 'mfa_check_failed' }, 503) }
  }
  if (!hasVerified) {
    return { ok: false, res: reply({ error: 'mfa_enrollment_required' }, 403) }
  }
  if (decodeJwtPayload(token).aal !== 'aal2') {
    return { ok: false, res: reply({ error: 'mfa_required' }, 403) }
  }

  // Label for the audit trail. Best-effort: an operator need not be a member
  // of any workspace, so there may be no username to find.
  let callerLabel: string | null = caller.user.email ?? null
  try {
    const { data: m } = await admin
      .from('workspace_members')
      .select('username')
      .eq('user_id', caller.user.id)
      .limit(1)
      .maybeSingle()
    if (m?.username) callerLabel = m.username as string
  } catch { /* label is decoration; never fail the call for it */ }

  return { ok: true, ctx: { admin, callerId: caller.user.id, callerLabel } }
}

// ── Platform audit trail ─────────────────────────────────────────────────────
// The operator analogue of logAdminEvent. Writes to public.platform_audit,
// which carries NO workspace FK — so a 'workspace.teardown' row survives the
// CASCADE that removes app_events and file_events (gap #34). The slug/name
// snapshot is what keeps a certificate readable once the workspace row is
// gone; pass them from the row you read BEFORE the delete.

// Keep in step with the CHECK on platform_audit.action (0028, extended by
// 0031). Session 20 found this union had drifted: it was missing
// 'operator.granted' and 'operator.revoked', which 0028 has allowed since S15.
// Nothing logged them, so the drift was inert — but a union that is narrower
// than the constraint silently makes a valid action unloggable from TypeScript,
// which is a trap rather than a safety net.
export type PlatformAuditFields = {
  action:
    | 'workspace.created'
    | 'workspace.renamed'
    | 'workspace.suspended'
    | 'workspace.restored'
    | 'workspace.teardown'
    | 'blob.purged'
    | 'ai_key.set'
    | 'ai_key.cleared'
    | 'operator.granted'
    | 'operator.revoked'
    // Session 20 — the model control plane
    | 'model.approved'
    | 'model.retired'
    | 'model.restored'
    | 'model.default_set'
    | 'model.default_cleared'
    // Session 41 — the Petal-cloud storage plane (migration 0055 widens the
    // CHECK to admit these four). ⚠️ A union NARROWER than the constraint makes
    // a legal action unloggable from TypeScript; a union WIDER than it makes the
    // insert fail on the `error` channel, which logPlatformEvent only
    // console.errors — so the operator's action still returns 200 and no
    // certificate exists. These three lists (this union, the SQL CHECK, and
    // AuditSection's ACTIONS filter) are kept in step only by comments.
    | 'storage_plan.set'
    | 'storage_plan.cleared'
    | 'storage_plan.suspended'
    | 'storage_plan.restored'
    // Session 43b — the operator-sent setup link (migration 0066 widens the
    // CHECK to admit this one). Deliberately NOT 'workspace.created': the
    // question this verb exists to answer is "did the link actually go out, and
    // to what address", which is unanswerable if the send shares a verb with
    // the creation. The address lands in `context.sent_to`.
    | 'workspace.invite_sent'
  message: string
  workspaceId?: string | null
  workspaceSlug?: string | null
  workspaceName?: string | null
  code?: string | null
  severity?: 'info' | 'warning' | 'error' | 'critical'
  context?: Record<string, unknown>
}

const CONTEXT_MAX = 8000

/**
 * Fit `context` inside platform_audit's `char_length(context::text) <= 8000`
 * CHECK, dropping detail rather than losing the whole row.
 *
 * This is the S14 lesson applied properly: a certificate write must be
 * infallible for ANY input that can reach it. The first version truncated
 * every scalar field and then passed `context` through raw — which was the
 * one field carrying unbounded client-derived data (`paths: batch`, 40
 * storage paths whose filenames have no length cap anywhere: not in
 * `files.storage_path` (bare TEXT), not in the RLS policies, and not in
 * supabaseAdapter's `safeName`, which substitutes characters but never
 * truncates). A post-production tenant with long asset filenames would
 * therefore bust the CHECK on every blob.purged row, and because supabase-js
 * reports a CHECK violation on the `error` channel instead of throwing, the
 * surrounding try/catch could not see it. The result would have been a
 * teardown that destroyed the blobs and filed no per-path certificate at
 * all, silently. Found by the Session 15 pre-commit review.
 */
function fitContext(context: Record<string, unknown>): Record<string, unknown> {
  let value = context ?? {}
  if (JSON.stringify(value).length <= CONTEXT_MAX) return value

  // Shed the array fields first — they are the only unbounded ones — keeping
  // a count and a sample so the row still says what happened.
  const trimmed: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    if (Array.isArray(v)) {
      trimmed[`${k}_count`] = v.length
      trimmed[`${k}_truncated`] = true
    } else {
      trimmed[k] = v
    }
  }
  // Re-add as much of each array as still fits, longest-key-last so one huge
  // array cannot starve the others entirely.
  for (const [k, v] of Object.entries(value)) {
    if (!Array.isArray(v)) continue
    const kept: unknown[] = []
    for (const item of v) {
      const probe = { ...trimmed, [k]: [...kept, item] }
      if (JSON.stringify(probe).length > CONTEXT_MAX) break
      kept.push(item)
    }
    if (kept.length > 0) {
      trimmed[k] = kept
      trimmed[`${k}_truncated`] = kept.length < v.length
    }
  }
  value = trimmed
  // Last resort: if even the skeleton is too big, keep nothing but the shape.
  if (JSON.stringify(value).length > CONTEXT_MAX) {
    return { truncated: true, note: 'context exceeded the 8000-char audit limit' }
  }
  return value
}

export async function logPlatformEvent(
  ctx: OperatorContext,
  fields: PlatformAuditFields,
): Promise<void> {
  try {
    // Every field is bounded to its column CHECK rather than trusted. A
    // rejected insert here would mean a destruction with no record of it.
    const { error } = await ctx.admin.from('platform_audit').insert({
      actor_user_id: ctx.callerId,
      actor_label: ctx.callerLabel?.slice(0, 200) ?? null,
      action: fields.action,
      workspace_id: fields.workspaceId ?? null,
      workspace_slug: fields.workspaceSlug?.slice(0, 64) ?? null,
      workspace_name: fields.workspaceName?.slice(0, 200) ?? null,
      code: fields.code ?? null,
      severity: fields.severity ?? 'info',
      message: fields.message.slice(0, 2000),
      context: fitContext(fields.context ?? {}),
    })
    if (error) {
      // supabase-js reports a CHECK violation on the error channel and does
      // NOT throw, so the catch below never sees one. Without this line a
      // dropped certificate is completely invisible — no exception, no log,
      // and a 200 from the action that just destroyed something.
      console.error(
        `platform_audit write FAILED (${fields.action}): ${error.message}`,
      )
    }
  } catch (err) {
    console.error(
      `platform_audit write THREW (${fields.action}): ${String((err as Error)?.message ?? err)}`,
    )
  }
}
