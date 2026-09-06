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
//   2. NEVER delete a RESERVED object — the two files R.A.B.B.I.T. writes
//      straight to the bucket with no files row on purpose (PROJECT.json and
//      FINANCE/RATES.json). Rule 1 cannot see them: "no row references this"
//      is true of them by design, which is precisely what made them garbage
//      to this function. S36, before the first run that would have proved it.
//      One definition, in _shared/reservedObjects.ts.
//   3. Orphans must be older than 24h (an in-flight upload's row may not
//      have landed yet).
//   4. Tenancy: only paths provably in the caller's workspace are touched.
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
import { isReservedProjectObject } from '../_shared/reservedObjects.ts'
import { decryptStorageSecret } from '../_shared/storageSecretCrypto.ts'
import { presignS3Request, type S3Target } from '../_shared/s3Presign.ts'

const RABBIT_BUCKET = 'rabbit-files'
const AVATAR_BUCKET = 'user-avatars'
// ── Derived previews (S39, re-based S44) ────────────────────────────────────
// Disposed of on the SAME purge as their source (TPN-CONT-011), enqueued by
// trg_files_gc_enqueue alongside the body. There is DELIBERATELY no thumbnail
// bucket constant here any more: since S44 a thumbnail lives at its body's
// provider, so a Petal one is in 'rabbit-thumbnails' and an s3 one is in the
// customer's bucket under the 'byo-s3' marker. The queue row carries both its
// bucket and its `kind` (0054), and the drain reads those — a constant would
// only invite the bucket to be treated as the object's identity again, which
// is the exact defect 0054 closed.
//
// The ORPHAN SCAN deliberately walks NEITHER thumbnail location — see the
// stated limit in §12.7b. A thumbnail whose files row never landed is cleaned
// up by uploadFile's compensating delete, the same way a stranded source
// upload is; and WILSON never enumerates a customer bucket at all (§12.4).
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
  // Product-written, row-less objects this run declined to delete. Reported
  // rather than silent: this counter is the only evidence in a WIL-3003 line
  // that the guard was reachable and fired, and a run over a workspace with
  // projects that reads 0 here means the manifests are already gone.
  skipped_reserved: number
  // Queue rows whose body lives at the workspace's OWN bucket (S37): drained
  // by signed DELETE against provider_config, not storage.remove. Counted
  // apart for the same reason as skipped_reserved — the counter is the
  // evidence the branch exists and fired.
  queue_s3_drained: number
  // Track C / 0073 (TPN-CONT-017): expired upload reservations this run
  // classified — certified abandoned (one file_events row each) or closed as
  // completed. `reservation_sweep_failed` is true when the RPC itself failed
  // (before 0073 is applied it does not exist) — said rather than hidden, so a
  // certificate never reads 0/0 for a sweep that did not run.
  reservations_abandoned: number
  reservations_completed: number
  reservation_sweep_failed: boolean
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
    skipped_recent: 0, skipped_foreign_or_unknown: 0, skipped_reserved: 0,
    queue_s3_drained: 0,
    reservations_abandoned: 0, reservations_completed: 0, reservation_sweep_failed: false,
    certify_failed: 0, truncated: false,
  }

  // Lazily-resolved, memoised S3 context for draining s3 queue rows (S37).
  // Resolved AT DRAIN TIME from the workspace's current provider_config —
  // the trigger cannot see the config, and a bucket renamed between purge
  // and drain should be hit at its new name. One resolution per run.
  type S3Drain =
    | { ok: true; target: S3Target; accessKeyId: string; secret: string; prefix?: string }
    | { ok: false; detail: string }
  let s3DrainMemo: S3Drain | null = null
  async function s3Drain(): Promise<S3Drain> {
    if (s3DrainMemo) return s3DrainMemo
    const fail = (detail: string): S3Drain => (s3DrainMemo = { ok: false, detail })
    const { data: ws, error: wsErr } = await ctx.admin
      .from('workspace_storage')
      .select('provider, provider_config')
      .eq('workspace_id', ctx.workspaceId)
      .maybeSingle()
    if (wsErr) return fail(`workspace storage read failed: ${wsErr.message}`)
    if (ws?.provider !== 's3' || !ws.provider_config) {
      return fail('this workspace no longer has S3-compatible storage configured — its queued bucket deletions cannot be drained')
    }
    const cfg = ws.provider_config as {
      endpoint?: string; region: string; bucket: string; prefix?: string
      accessKeyId: string; forcePathStyle?: boolean
    }
    const { data: sec, error: secErr } = await ctx.admin
      .from('workspace_storage_secrets')
      .select('secret_ciphertext')
      .eq('workspace_id', ctx.workspaceId)
      .maybeSingle()
    if (secErr) return fail(`secret read failed: ${secErr.message}`)
    if (!sec?.secret_ciphertext) {
      return fail('no bucket secret is stored for this workspace — save it in Admin Terminal → Storage, then run cleanup again')
    }
    let secret: string
    try {
      secret = await decryptStorageSecret(sec.secret_ciphertext as string)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return fail(`the stored bucket secret cannot be decrypted (${message}) — re-enter it, then run cleanup again`)
    }
    return (s3DrainMemo = {
      ok: true,
      target: {
        endpoint: cfg.endpoint, region: cfg.region, bucket: cfg.bucket,
        forcePathStyle: cfg.forcePathStyle,
      },
      accessKeyId: cfg.accessKeyId,
      secret,
      prefix: cfg.prefix,
    })
  }

  try {
    // ── 1. Drain the queue (rows enqueued by the purge trigger) ────────────
    const { data: pending, error: qErr } = await ctx.admin
      .from('storage_gc_queue')
      // 🚨 `kind` IS LOAD-BEARING AND MUST STAY IN THIS LIST (S44). It picks
      // the restorability column below; omitted, every row reads undefined,
      // every thumbnail is treated as a body, and the drain deletes restorable
      // previews while certifying them disposed. A missing column here is a
      // silent data-loss bug, not a missing field.
      .select('id, bucket_id, object_path, provider, kind')
      .eq('status', 'pending')
      .eq('workspace_id', ctx.workspaceId)
      .order('id', { ascending: true })
      .limit(500)
    if (qErr) throw new Error(`queue read: ${qErr.message}`)

    for (const row of pending ?? []) {
      // Reserved guard, FIRST — refuse in depth rather than trusting the
      // orphan scan to be the only way here.
      //
      // The queue is fed by trg_files_gc_enqueue on hard delete of a files
      // row, and the reserved objects have no files row, so on the intended
      // path this branch is unreachable. It is not the only path.
      // `files.storage_path` is unconstrained, client-writable TEXT — the
      // files_insert/files_update policies pin workspace_id and
      // can_write_project and say NOTHING about the path (the same fact that
      // forced teardown's cross-tenant check in S15). A member can therefore
      // point a files row of their own at projects/<id>/FINANCE/RATES.json,
      // delete it, and have the trigger enqueue the rates file for disposal.
      // The restorability check below would then find no row referencing it —
      // because they just deleted the only one — and this loop would remove it.
      if (isReservedProjectObject(row.object_path)) {
        counts.skipped_reserved++
        await ctx.admin.from('storage_gc_queue')
          .update({ status: 'skipped', processed_at: new Date().toISOString(), detail: 'reserved: written by the product with no files row, never garbage' })
          .eq('id', row.id)
        continue
      }
      // Restorability guard: if ANY files row (live or trashed) still
      // references this path, skip — restore must keep working.
      //
      // 🚨 THE COLUMN DEPENDS ON WHAT THE OBJECT IS (S39, re-based in S44). A
      // thumbnail row's object_path is a `thumbnail_url`, not a `storage_path`,
      // and those are different columns holding different keys. Asking the
      // wrong one always returns "nothing references this" — which is not a
      // refusal to delete but a licence to, so a trashed file's still-restorable
      // preview would be destroyed while its source was correctly preserved.
      // The bug would present as "my restored file lost its thumbnail", long
      // after the run.
      //
      // 🚨 S44: THIS READS `kind`, NOT THE BUCKET, AND THAT CHANGE IS THE WHOLE
      // POINT OF 0054's NEW COLUMN. S39 tested the bucket name directly
      // because a thumbnail was always in Petal's thumbnail bucket. Since S44 a
      // thumbnail lives at its body's provider, so an s3 workspace's preview
      // sits in the customer's bucket under the SAME 'byo-s3' marker as its
      // body — the bucket no longer identifies the object, and the old test
      // would have silently classified every s3 thumbnail as a body, checked
      // storage_path, found nothing, and deleted a restorable preview while
      // stamping it 'deleted' in the ledger. Exactly the failure the paragraph
      // above was written to prevent, re-entering through the fix.
      //
      // Rows written before 0054 default to 'body', and 0054 backfills the
      // rabbit-thumbnails ones — so this is behaviour-identical on old rows.
      // Cast for the same reason the `provider` read below carries one: this
      // project ships no generated Database types, so a column added by a
      // later migration is not on the inferred row shape.
      const refColumn = (row as { kind?: string }).kind === 'thumbnail'
        ? 'thumbnail_url'
        : 'storage_path'
      const { data: stillRef, error: refErr } = await ctx.admin
        .from('files').select('id').eq(refColumn, row.object_path).limit(1)
      // 🚨 A FAILED READ PUSHES NOTHING (S37's rule). supabase-js RESOLVES on
      // error with data:null, so an unchecked destructure turns a statement
      // timeout or a pooler reset into "nothing references this path" — which
      // is not a refusal to delete but a LICENCE to, and the row is then
      // stamped 'deleted' in the disposal ledger. Safety rule 1 at the top of
      // this file would be broken by a read that failed rather than by a row
      // that was absent, and the loss surfaces weeks later as "my restored file
      // is gone" with a certificate calling it garbage. Leave it pending: the
      // next run retries, and nothing is destroyed on a guess.
      if (refErr) {
        counts.queue_failed++
        await ctx.admin.from('storage_gc_queue')
          .update({ status: 'failed', processed_at: new Date().toISOString(), detail: `restorability check failed, nothing deleted: ${refErr.message}` })
          .eq('id', row.id)
        continue
      }
      if (stillRef && stillRef.length > 0) {
        await ctx.admin.from('storage_gc_queue')
          .update({ status: 'skipped', processed_at: new Date().toISOString(), detail: 'a files row still references this path' })
          .eq('id', row.id)
        continue
      }
      // S37: a body at the workspace's OWN bucket — signed DELETE via the
      // current provider_config, never storage.remove (the marker bucket_id
      // 'byo-s3' names no Supabase bucket on purpose). The prefix is applied
      // here, from config, exactly as storage-presign applies it: queue rows
      // carry the row-shaped path.
      if ((row as { provider?: string }).provider === 's3') {
        const s3 = await s3Drain()
        if (!s3.ok) {
          counts.queue_failed++
          await ctx.admin.from('storage_gc_queue')
            .update({ status: 'failed', processed_at: new Date().toISOString(), detail: s3.detail })
            .eq('id', row.id)
          continue
        }
        const key = s3.prefix ? `${s3.prefix}/${row.object_path}` : row.object_path
        try {
          const url = await presignS3Request({
            target: s3.target, accessKeyId: s3.accessKeyId, secretAccessKey: s3.secret,
            method: 'DELETE', key, expiresSeconds: 60, now: new Date(),
          })
          const res = await fetch(url, { method: 'DELETE' })
          // S3 DELETE is idempotent-success: 204 whether or not the KEY
          // existed, so a 2xx means "certifiably absent now" — weaker than
          // the Supabase branch's deleted/missing split, and the detail says
          // which semantics apply.
          //
          // 🚨 404 IS A FAILURE HERE, NOT A SUCCESS. A missing key returns
          // 204; a 404 means the BUCKET did not resolve — a renamed bucket, a
          // flipped addressing style, a wrong endpoint. Counting it as
          // 'deleted' would stamp a TPN-CONT-002 disposal certificate on a
          // body still sitting in the customer's bucket, and do it for the
          // whole batch at once. Found by S37's adversarial review.
          if (res.ok) {
            counts.queue_deleted++
            counts.queue_s3_drained++
            await ctx.admin.from('storage_gc_queue')
              .update({ status: 'deleted', processed_at: new Date().toISOString(), detail: 'blob removed at the workspace bucket (signed DELETE; S3 does not distinguish already-gone)' })
              .eq('id', row.id)
          } else if (res.status === 404) {
            counts.queue_failed++
            await ctx.admin.from('storage_gc_queue')
              .update({ status: 'failed', processed_at: new Date().toISOString(), detail: 'the bucket itself did not resolve (404) — check the bucket name, endpoint and path-style setting in Admin Terminal → Storage. Nothing was deleted.' })
              .eq('id', row.id)
          } else {
            counts.queue_failed++
            await ctx.admin.from('storage_gc_queue')
              .update({ status: 'failed', processed_at: new Date().toISOString(), detail: `the bucket refused the delete (HTTP ${res.status})` })
              .eq('id', row.id)
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          counts.queue_failed++
          await ctx.admin.from('storage_gc_queue')
            .update({ status: 'failed', processed_at: new Date().toISOString(), detail: `could not reach the bucket endpoint: ${message}` })
            .eq('id', row.id)
        }
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
        // 🚨 THE ROW IS NOT THE ONLY THING THAT MAKES AN OBJECT WANTED.
        // PROJECT.json and FINANCE/RATES.json are written straight to the
        // bucket and deliberately have no files row, so every check above
        // this line classifies them as garbage. Ordered BEFORE the age check
        // so the counter reads "reserved" rather than "recent" — the two
        // mean opposite things to whoever reads the WIL-3003 line, and a
        // manifest younger than 24h was only ever surviving by accident.
        if (isReservedProjectObject(obj.path)) { counts.skipped_reserved++; continue }
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

    // ── 4. Abandoned resumable uploads (Track C / 0073, TPN-CONT-017) ──────
    // An upload_reservations row the client wrote before tus.Upload.start()
    // and never released, past its 24 h expiry, is the WILSON-side record of a
    // partial upload. The SQL sweep classifies each one (object landed →
    // 'completed'; otherwise → 'abandoned' plus one file_events certificate)
    // and this run reports the counts on its own certificate. It destroys
    // nothing — the partial is reaped by Supabase's TUS expiry, which nothing
    // here can see — so TS-1.5's dual-authorisation argument for keeping the
    // rest of this function admin-invoked does not apply: pg_cron runs the
    // same sweep hourly across all workspaces, and this per-workspace call is
    // so an admin's cleanup click certifies now rather than within the hour.
    //
    // 🚨 A FAILED RPC IS SAID, NOT SWALLOWED. rpc() resolves for every status;
    // before 0073 is applied it answers PGRST202, and a certificate that
    // silently read 0/0 there would claim a sweep that never ran.
    const { data: swept, error: sweepErr } = await ctx.admin
      .rpc('sweep_abandoned_uploads', { p_workspace_id: ctx.workspaceId })
    if (sweepErr) {
      counts.reservation_sweep_failed = true
    } else {
      const row = (Array.isArray(swept) ? swept[0] : swept) as
        { abandoned?: number; completed?: number } | null | undefined
      counts.reservations_abandoned = Number(row?.abandoned ?? 0)
      counts.reservations_completed = Number(row?.completed ?? 0)
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
