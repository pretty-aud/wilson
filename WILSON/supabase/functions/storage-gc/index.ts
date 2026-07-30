// =============================================================================
// storage-gc — Session 14, Block E: deliberate, provider-aware blob disposal.
//
// Blobs outlive their rows in three ways (gap #6): the 0014/30-day purge
// hard-deletes a files row but never touched its bucket object; a failed
// files-row insert can strand a fresh upload; and an avatar replacement's
// best-effort delete can fail. This function is the one place any of that
// gets cleaned up — ADMIN-INVOKED (not a silent cron), scoped to the
// caller's own workspace, and every deletion leaves a certificate:
//
//   * queue rows (public.storage_gc_queue, enqueued by trg_files_gc_enqueue
//     on hard delete) are drained and stamped deleted/missing/failed;
//   * orphan-scan / avatar-orphan deletions INSERT their own queue rows in
//     a terminal status, so the queue doubles as the disposal ledger; and
//   * one WIL-3003 app_events line carries the counts (WIL-3004 on failure).
//
// This is the TPN-CONT-002 "certified disposal" remediation: delete stops
// being an unlink and becomes a recorded, attributable act. Admin-invoked
// beats a cron here — TS-1.5 wants dual authorization on destruction, and
// a human clicking a stated confirm IS the second factor. (Also avoids the
// gap-#24 trap: GitHub schedule workflows only run from the default branch.)
//
// SAFETY RULES, in order of importance:
//   1. NEVER delete an object a live OR TRASHED files row references —
//      trash must stay restorable for its full 30 days.
//   2. Orphans must be older than 24h (an in-flight upload's row may not
//      have landed yet).
//   3. Tenancy: only paths provably in the caller's workspace are touched.
//      A project folder whose projects row is GONE is only deletable when a
//      file_events certificate ties that project_id to this workspace;
//      otherwise it is counted and reported, never deleted (fail closed).
//
// verify_jwt = false + in-function validation, same as every admin function
// (_shared/adminGuard.ts): claims from the token payload, live-row admin
// check, MFA aal2 step-up.
// =============================================================================

import {
  corsHeaders, reply, requireWorkspaceAdmin, logAdminEvent, type AdminContext,
} from '../_shared/adminGuard.ts'

const RABBIT_BUCKET = 'rabbit-files'
const AVATAR_BUCKET = 'user-avatars'
const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000
const LIST_PAGE = 100
const MAX_OBJECTS = 5000 // per run; leftovers surface in the next run

type Counts = {
  queue_deleted: number
  queue_missing: number
  queue_failed: number
  orphans_deleted: number
  avatar_orphans_deleted: number
  skipped_recent: number
  skipped_foreign_or_unknown: number
  certify_failed: number
  truncated: boolean
}

function olderThanWindow(iso: string | null | undefined): boolean {
  if (!iso) return false // no timestamp → be conservative, treat as recent
  const t = Date.parse(iso)
  return Number.isFinite(t) && Date.now() - t > ORPHAN_MIN_AGE_MS
}

// List one storage folder completely (paged).
async function listFolder(ctx: AdminContext, bucket: string, prefix: string) {
  const out: Array<{ name: string; id: string | null; created_at?: string }> = []
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await ctx.admin.storage.from(bucket).list(prefix, {
      limit: LIST_PAGE, offset, sortBy: { column: 'name', order: 'asc' },
    })
    if (error) throw new Error(`storage list ${bucket}/${prefix}: ${error.message}`)
    out.push(...(data ?? []))
    if (!data || data.length < LIST_PAGE) return out
  }
}

// Recursively collect object paths below a prefix (folders have id: null).
// The budget is RUN-WIDE (shared across all project folders) so total work
// stays bounded under the Edge wall-clock deadline (adversarial review).
async function collectObjects(
  ctx: AdminContext, bucket: string, prefix: string,
  sink: Array<{ path: string; created_at?: string }>, budget: { left: number },
): Promise<boolean> {
  if (budget.left <= 0) return true
  const entries = await listFolder(ctx, bucket, prefix)
  let truncated = false
  for (const e of entries) {
    const path = prefix ? `${prefix}/${e.name}` : e.name
    if (e.id === null) {
      truncated = (await collectObjects(ctx, bucket, path, sink, budget)) || truncated
    } else {
      if (budget.left <= 0) return true
      budget.left--
      sink.push({ path, created_at: e.created_at })
    }
  }
  return truncated
}

// Batched referenced-path lookup: one .in() per 100 paths instead of one
// round trip per object (adversarial review — sequential per-object reads
// could blow the 150s deadline).
async function referencedPaths(ctx: AdminContext, paths: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100)
    const { data } = await ctx.admin.from('files').select('storage_path').in('storage_path', chunk)
    for (const r of data ?? []) out.add(r.storage_path as string)
  }
  return out
}

async function certify(
  ctx: AdminContext, counts: Counts, bucket: string, path: string, reason: string, status: string, detail: string,
) {
  try {
    const { error } = await ctx.admin.from('storage_gc_queue').insert({
      bucket_id: bucket, object_path: path, workspace_id: ctx.workspaceId,
      reason, status, processed_at: new Date().toISOString(), detail,
    })
    if (error) counts.certify_failed++
  } catch { counts.certify_failed++ }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405)

  const guard = await requireWorkspaceAdmin(req)
  if (!guard.ok) return guard.res
  const ctx = guard.ctx

  const counts: Counts = {
    queue_deleted: 0, queue_missing: 0, queue_failed: 0,
    orphans_deleted: 0, avatar_orphans_deleted: 0,
    skipped_recent: 0, skipped_foreign_or_unknown: 0,
    certify_failed: 0, truncated: false,
  }

  try {
    // ── 1. Drain the queue (rows enqueued by the purge trigger) ────────────
    const { data: pending, error: qErr } = await ctx.admin
      .from('storage_gc_queue')
      .select('id, bucket_id, object_path')
      .eq('status', 'pending')
      .eq('workspace_id', ctx.workspaceId)
      .order('id', { ascending: true })
      .limit(500)
    if (qErr) throw new Error(`queue read: ${qErr.message}`)

    for (const row of pending ?? []) {
      // Restorability guard: if ANY files row (live or trashed) still
      // references this path, skip — restore must keep working.
      const { data: stillRef } = await ctx.admin
        .from('files').select('id').eq('storage_path', row.object_path).limit(1)
      if (stillRef && stillRef.length > 0) {
        await ctx.admin.from('storage_gc_queue')
          .update({ status: 'skipped', processed_at: new Date().toISOString(), detail: 'a files row still references this path' })
          .eq('id', row.id)
        continue
      }
      const { data: removed, error: rmErr } = await ctx.admin.storage
        .from(row.bucket_id).remove([row.object_path])
      if (rmErr) {
        counts.queue_failed++
        await ctx.admin.from('storage_gc_queue')
          .update({ status: 'failed', processed_at: new Date().toISOString(), detail: rmErr.message })
          .eq('id', row.id)
      } else if (!removed || removed.length === 0) {
        counts.queue_missing++
        await ctx.admin.from('storage_gc_queue')
          .update({ status: 'missing', processed_at: new Date().toISOString(), detail: 'object was already gone' })
          .eq('id', row.id)
      } else {
        counts.queue_deleted++
        await ctx.admin.from('storage_gc_queue')
          .update({ status: 'deleted', processed_at: new Date().toISOString(), detail: 'blob removed' })
          .eq('id', row.id)
      }
    }

    // ── 2. Orphan scan: rabbit-files (this workspace's projects only) ──────
    const scanBudget = { left: MAX_OBJECTS } // RUN-wide, not per-project
    const projectFolders = await listFolder(ctx, RABBIT_BUCKET, 'projects')
    for (const folder of projectFolders) {
      if (folder.id !== null) continue // an object directly under projects/ — ignore
      if (scanBudget.left <= 0) { counts.truncated = true; break }
      const projectId = folder.name
      // Tenancy: projects row → workspace; if the project is gone, a
      // file_events certificate may still tie it to this workspace.
      const { data: proj } = await ctx.admin
        .from('projects').select('workspace_id').eq('id', projectId).maybeSingle()
      let ours = proj?.workspace_id === ctx.workspaceId
      if (!proj) {
        const { data: evt } = await ctx.admin
          .from('file_events').select('workspace_id').eq('project_id', projectId).limit(1).maybeSingle()
        ours = evt?.workspace_id === ctx.workspaceId
      }
      if (!ours) { counts.skipped_foreign_or_unknown++; continue }

      const objects: Array<{ path: string; created_at?: string }> = []
      counts.truncated = (await collectObjects(ctx, RABBIT_BUCKET, `projects/${projectId}`, objects, scanBudget)) || counts.truncated
      const referenced = await referencedPaths(ctx, objects.map(o => o.path))
      for (const obj of objects) {
        if (referenced.has(obj.path)) continue // referenced (live OR trashed)
        if (!olderThanWindow(obj.created_at)) { counts.skipped_recent++; continue }
        const { error: rmErr } = await ctx.admin.storage.from(RABBIT_BUCKET).remove([obj.path])
        if (!rmErr) {
          counts.orphans_deleted++
          await certify(ctx, counts, RABBIT_BUCKET, obj.path, 'orphan-scan', 'deleted', 'no files row references this object')
        }
      }
    }

    // ── 3. Avatar orphans: user-avatars/{this workspace}/{user}/… ──────────
    // PAGED members read: PostgREST caps un-ranged reads at max_rows (1000,
    // config.toml) even for service_role — an unpaged read would make every
    // member past the cap look avatar-less and their CURRENT avatar an
    // "orphan" (adversarial review, S14). Belt and braces: a user folder
    // with no fetched membership row is NEVER fair game (fail closed).
    const avatarByUser = new Map<string, string>()
    for (let from = 0; ; from += 1000) {
      const { data: page, error: mErr } = await ctx.admin
        .from('workspace_members')
        .select('user_id, avatar_url')
        .eq('workspace_id', ctx.workspaceId)
        .order('user_id', { ascending: true })
        .range(from, from + 999)
      if (mErr) throw new Error(`members read: ${mErr.message}`)
      for (const m of page ?? []) avatarByUser.set(m.user_id as string, (m.avatar_url as string | null) ?? '')
      if (!page || page.length < 1000) break
    }
    const userFolders = await listFolder(ctx, AVATAR_BUCKET, ctx.workspaceId)
    for (const uf of userFolders) {
      if (uf.id !== null) continue
      const userId = uf.name
      if (!avatarByUser.has(userId)) { counts.skipped_foreign_or_unknown++; continue }
      const files = await listFolder(ctx, AVATAR_BUCKET, `${ctx.workspaceId}/${userId}`)
      for (const f of files) {
        if (f.id === null) continue
        const path = `${ctx.workspaceId}/${userId}/${f.name}`
        // Current avatar_url embeds the object path — anything else in the
        // folder is a leftover from a replaced/removed avatar.
        const current = avatarByUser.get(userId) ?? ''
        if (current.includes(path)) continue
        if (!olderThanWindow(f.created_at)) { counts.skipped_recent++; continue }
        const { error: rmErr } = await ctx.admin.storage.from(AVATAR_BUCKET).remove([path])
        if (!rmErr) {
          counts.avatar_orphans_deleted++
          await certify(ctx, counts, AVATAR_BUCKET, path, 'avatar-orphan', 'deleted', 'not the member\'s current avatar')
        }
      }
    }

    await logAdminEvent(ctx, {
      code: 'WIL-3003',
      message: 'Storage cleanup completed',
      context: counts as unknown as Record<string, unknown>,
    })
    return reply({ ok: true, counts })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await logAdminEvent(ctx, {
      code: 'WIL-3004',
      message: `Storage cleanup failed: ${message}`.slice(0, 1900),
      context: counts as unknown as Record<string, unknown>,
    })
    return reply({ error: 'gc_failed', detail: message, counts }, 500)
  }
})
