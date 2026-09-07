// =============================================================================
// operator-storage-plans — Session 41
//
// The write half of the Petal-cloud storage plane. Migration 0055 gives
// public.workspace_storage_plans a member READ policy and NO write policy, and
// revokes the write verbs from `authenticated`, so this function under
// service_role is the ONLY way a plan changes — including for a platform
// operator holding a browser session. That is the 0031 precedent, and it is
// what makes "the operator approves access" a property of the system rather
// than a convention of the UI.
//
// Audrey, 2026-08-07: billing is MANUAL in v1. The operator flips a company
// active/suspended as payments start and stop; a payment-provider hook is its
// own later session.
//
// -----------------------------------------------------------------------------
// WHY THIS IS A NEW FUNCTION AND NOT THREE MORE ACTIONS ON operator-workspaces
// -----------------------------------------------------------------------------
// isRateLimited in operator-workspaces splits its budget only on
// `action === 'list'`. Every other action shares ONE 'operator-write' bucket at
// OPERATOR_WRITE_RPM (default 20) per 60s, keyed on the operator. Quota edits
// are routine and teardown is not — folding them together means a burst of
// quota saves can 429 a teardown, which is the one action that must never be
// rate-limited out at the wrong moment. This function carries its own bucket.
//
// -----------------------------------------------------------------------------
// TWO THINGS THAT WILL BITE A FUTURE EDITOR
// -----------------------------------------------------------------------------
//   * 🚨 THE PLAN ROW IS READABLE BY THE COMPANY'S OWN MEMBERS
//     (workspace_storage_plans_select). Operator commentary — "chasing payment,
//     two months late" — must NEVER be written onto it. That is why the table
//     has no `notes` column and why `note` below goes into platform_audit.context
//     instead, which 0028 gates on is_platform_operator().
//   * 🚨 ABSENCE OF A ROW IS THE FREE TIER, not "no access". `clear` is
//     therefore a real, meaningful action (drop back to the 1 GiB allowance) and
//     NOT a synonym for suspend. Deleting a row to "cut someone off" would do
//     the opposite of what it looks like.
// =============================================================================

import {
  corsHeaders,
  reply,
  requirePlatformOperator,
  logPlatformEvent,
} from '../_shared/operatorGuard.ts'
import { isRateLimited, envInt } from '../_shared/rateLimit.ts'

// Mirrors workspace_storage_plans_quota_chk in 0055. Kept in step by hand: the
// CHECK is the authority and this exists so the operator gets a sentence rather
// than a raw constraint name.
const QUOTA_MIN = 1
const QUOTA_MAX = 109951162777600 // 100 TiB

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405)

  const guard = await requirePlatformOperator(req)
  if (!guard.ok) return guard.res
  const ctx = guard.ctx

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return reply({ error: 'bad_json' }, 400) }

  const action = typeof body.action === 'string' ? body.action : ''
  const KNOWN = ['list', 'set', 'clear', 'suspend', 'restore']
  if (!KNOWN.includes(action)) {
    return reply({ error: 'validation_failed', errors: [{ field: 'action', error: 'unknown' }] }, 400)
  }

  // ── list ────────────────────────────────────────────────────────────────────
  // Read-only, so it runs BEFORE the write rate limiter — the console calls it
  // on every render of the storage panel.
  //
  // 🚨 It goes through the RPC, not a PostgREST select on the plan table. An
  // operator is not a member of any workspace and holds no workspace_id claim,
  // so workspace_storage_plans_select matches nothing for them: a direct read
  // returns an EMPTY SET rather than an error, and the panel would show "free
  // tier" for every company on the platform while looking like working code.
  if (action === 'list') {
    const { data, error } = await ctx.admin.rpc('operator_storage_plan_summary')
    if (error) return reply({ error: 'plan_read_failed', detail: error.message }, 500)
    return reply({ plans: data ?? [] })
  }

  const limited = await isRateLimited(
    ctx.admin, 'operator-storage-plan', ctx.callerId, envInt('OPERATOR_STORAGE_RPM', 30), 60,
  )
  if (limited) return reply({ error: 'rate_limited' }, 429)

  const workspaceId = typeof body.workspace_id === 'string' ? body.workspace_id.trim() : ''
  if (!UUID_RE.test(workspaceId)) {
    return reply({ error: 'validation_failed', errors: [{ field: 'workspace_id', error: 'shape' }] }, 400)
  }

  // Read the company BEFORE any write: the slug/name snapshot is what keeps the
  // audit row readable if the workspace is later torn down, and a missing row
  // must be a 404 rather than a silently-created plan for a company that does
  // not exist (workspace_id is a FK, so the insert would fail anyway — this
  // turns a 500 into an answer).
  const { data: ws, error: wsErr } = await ctx.admin
    .from('workspaces')
    .select('id, name, slug, deleted_at')
    .eq('id', workspaceId)
    .maybeSingle()
  if (wsErr) return reply({ error: 'plan_read_failed', detail: wsErr.message }, 500)
  if (!ws) return reply({ error: 'not_found' }, 404)

  const { data: existing, error: exErr } = await ctx.admin
    .from('workspace_storage_plans')
    .select('workspace_id, status, quota_bytes')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (exErr) return reply({ error: 'plan_read_failed', detail: exErr.message }, 500)

  // Free-text operator commentary. Bounded here because platform_audit.context
  // is capped at 8000 chars and fitContext only sheds ARRAY fields — a large
  // flat object blows the cap with nothing to trim and falls through to
  // { truncated: true }, losing every field including this one.
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : ''

  const nowIso = new Date().toISOString()
  const auditBase = {
    workspaceId,
    workspaceSlug: ws.slug as string,
    workspaceName: ws.name as string,
  }

  // ── clear ───────────────────────────────────────────────────────────────────
  // Back to the free tier. NOT a way to cut a company off — see the header.
  if (action === 'clear') {
    // ⚠️ `no_plan`, NOT `not_found`. operatorApi maps not_found to "That company
    // no longer exists." — so clearing a plan that was already clear told the
    // operator the COMPANY had been deleted. The server's correct sentence lived
    // in `detail`, which callOperatorFn never renders.
    if (!existing) {
      return reply({ error: 'no_plan', detail: 'this company is already on the free allowance' }, 409)
    }

    const { data, error } = await ctx.admin
      .from('workspace_storage_plans')
      .delete()
      .eq('workspace_id', workspaceId)
      .select('workspace_id')
      .maybeSingle()
    if (error) return reply({ error: 'update_failed', detail: error.message }, 500)
    // A refused DELETE comes back as 204 with no error, so "no error" is not
    // "it happened" (the operator-workspaces rule).
    if (!data) return reply({ error: 'update_failed', detail: 'no row was removed' }, 500)

    await logPlatformEvent(ctx, {
      ...auditBase,
      action: 'storage_plan.cleared',
      code: 'WIL-7031',
      message: `Cleared the storage plan for ${ws.name} — back to the free tier`,
      context: { previous_quota_bytes: existing.quota_bytes, previous_status: existing.status, note: note || null },
    })
    return reply({ workspace_id: workspaceId, has_plan: false })
  }

  // ── suspend / restore ───────────────────────────────────────────────────────
  // Deliberately separate actions rather than `set` with a status argument, so
  // the audit trail says what happened in its own vocabulary and the console can
  // filter on it. Both REQUIRE an existing plan: suspending a company that has
  // never had a plan would silently invent a quota for them.
  if (action === 'suspend' || action === 'restore') {
    if (!existing) {
      return reply({
        error: 'no_plan',
        detail: 'this company has no storage plan — set a quota first, then suspend or restore it',
      }, 409)
    }
    const nextStatus = action === 'suspend' ? 'suspended' : 'active'

    // 🚨 A CERTIFICATE FOR AN EVENT THAT DID NOT HAPPEN IS WORSE THAN NO
    // CERTIFICATE. Without this, a double-click files a second
    // `storage_plan.suspended` row — and platform_audit is append-only with no
    // purge (TPN-LOG-004), so the audit trail permanently records two
    // suspensions where there was one. Returning the current state as success
    // is right: the operator asked for a state, and it is already that state.
    if (existing.status === nextStatus) {
      return reply({
        workspace_id: workspaceId,
        status: nextStatus,
        quota_bytes: existing.quota_bytes,
        has_plan: true,
        unchanged: true,
      })
    }

    const { data, error } = await ctx.admin
      .from('workspace_storage_plans')
      .update({ status: nextStatus, updated_at: nowIso, updated_by: ctx.callerId })
      .eq('workspace_id', workspaceId)
      .select('workspace_id, status, quota_bytes')
      .maybeSingle()
    if (error) return reply({ error: 'update_failed', detail: error.message }, 500)
    if (!data) return reply({ error: 'update_failed', detail: 'no row was updated' }, 500)

    await logPlatformEvent(ctx, {
      ...auditBase,
      action: action === 'suspend' ? 'storage_plan.suspended' : 'storage_plan.restored',
      code: action === 'suspend' ? 'WIL-7032' : 'WIL-7033',
      severity: action === 'suspend' ? 'warning' : 'info',
      message: action === 'suspend'
        ? `Suspended Petal cloud storage for ${ws.name} — new uploads are refused`
        : `Restored Petal cloud storage for ${ws.name}`,
      context: { quota_bytes: data.quota_bytes, note: note || null },
    })
    return reply({ workspace_id: workspaceId, status: data.status, quota_bytes: data.quota_bytes, has_plan: true })
  }

  // ── set ─────────────────────────────────────────────────────────────────────
  // Create or repoint the quota. Status is preserved on an existing row: raising
  // a suspended company's quota must not silently un-suspend them, because the
  // two decisions have different causes (capacity vs payment).
  const raw = body.quota_bytes
  const quotaBytes = typeof raw === 'number' ? Math.trunc(raw) : NaN
  if (!Number.isFinite(quotaBytes) || quotaBytes < QUOTA_MIN || quotaBytes > QUOTA_MAX) {
    return reply({
      error: 'validation_failed',
      errors: [{ field: 'quota_bytes', error: 'range' }],
      detail: `quota_bytes must be a whole number between ${QUOTA_MIN} and ${QUOTA_MAX} (100 TiB)`,
    }, 400)
  }

  let saved: Record<string, unknown> | null = null
  if (existing) {
    const { data, error } = await ctx.admin
      .from('workspace_storage_plans')
      .update({ quota_bytes: quotaBytes, updated_at: nowIso, updated_by: ctx.callerId })
      .eq('workspace_id', workspaceId)
      .select('workspace_id, status, quota_bytes')
      .maybeSingle()
    if (error) return reply({ error: 'update_failed', detail: error.message }, 500)
    if (!data) return reply({ error: 'update_failed', detail: 'no row was updated' }, 500)
    saved = data
  } else {
    // 0055 attaches NO fn_audit_touch trigger (it would blank updated_by under
    // service_role, where auth.uid() is NULL), so every audit column is stamped
    // here. Forgetting one leaves a plan nobody can attribute.
    const { data, error } = await ctx.admin
      .from('workspace_storage_plans')
      .insert({
        workspace_id: workspaceId,
        status: 'active',
        quota_bytes: quotaBytes,
        created_at: nowIso,
        created_by: ctx.callerId,
        updated_at: nowIso,
        updated_by: ctx.callerId,
      })
      .select('workspace_id, status, quota_bytes')
      .maybeSingle()
    if (error) return reply({ error: 'update_failed', detail: error.message }, 500)
    if (!data) return reply({ error: 'update_failed', detail: 'no row was created' }, 500)
    saved = data
  }

  await logPlatformEvent(ctx, {
    ...auditBase,
    action: 'storage_plan.set',
    code: 'WIL-7030',
    message: existing
      ? `Changed the Petal cloud quota for ${ws.name} to ${quotaBytes} bytes`
      : `Set a Petal cloud storage plan for ${ws.name}: ${quotaBytes} bytes`,
    context: {
      quota_bytes: quotaBytes,
      previous_quota_bytes: existing?.quota_bytes ?? null,
      status: saved?.status ?? null,
      created: !existing,
      workspace_deleted: ws.deleted_at !== null,
      note: note || null,
    },
  })

  return reply({
    workspace_id: workspaceId,
    status: saved?.status,
    quota_bytes: saved?.quota_bytes,
    has_plan: true,
  })
})
