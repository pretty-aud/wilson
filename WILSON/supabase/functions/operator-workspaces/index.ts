// =============================================================================
// operator-workspaces — Session 15 (Platform Operator Console, locked #18)
//
// Company lifecycle for /wilsonadmin: list, create, rename, suspend,
// restore, teardown. verify_jwt = false + in-function validation via
// _shared/operatorGuard.ts (live platform_operators row + hard MFA), same
// shape as the Session 9 admin set.
//
// WHY ONE FUNCTION WITH AN `action` FIELD, when the house style is one
// function per verb (admin-create-user, admin-set-active, …): six separate
// deployments and six config.toml entries for a console with a single user
// is more surface, not less — and the brief for this block is "the smallest
// possible surface". The action is a closed enum validated before anything
// else runs, and every branch re-derives its target from the body rather
// than sharing mutable state, so the dispatch adds no reachable path that
// six functions would not also have.
//
// A platform operator is NOT a member of the companies they administer, so
// there is no ctx.workspaceId to lean on: every action names its target and
// the function resolves it with service role. That is also why the reads
// here go through public.operator_workspace_summary() (SECURITY DEFINER,
// service_role only) instead of widening RLS across tenants — one crossing,
// in one place, behind one guard.
//
// TEARDOWN is the reason this function exists at all. MASTER_PLAN §6 #34:
// hard-deleting a workspace CASCADEs away its files rows, its file_events
// deletion certificates and its app_events, while leaving storage_gc_queue
// rows that no admin can ever drain (storage-gc is workspace-scoped and
// there is no admin of a dead tenant). The blobs then sit in the bucket
// forever, unreferenced and unaccounted for. So teardown:
//
//   1. reads the workspace row FIRST (the name/slug snapshot is what keeps
//      the certificate meaningful after the row is gone);
//   2. requires the operator to type the slug back — an irreversible,
//      cross-tenant destruction should not be one click away;
//   3. collects every rabbit-files object path this tenant owns, from BOTH
//      public.files and any pending storage_gc_queue rows, paging with
//      .range() because PostgREST caps un-ranged reads at max_rows (1000)
//      even for service_role (the S14 avatar-scan bug);
//   4. deletes those blobs and certificates the deletion into platform_audit
//      — which carries no workspace FK, so unlike file_events it survives
//      what happens next;
//   5. and only THEN deletes the workspace row.
//
// Order matters and is not cosmetic: after the CASCADE there is no way to
// discover which blobs belonged to this tenant. storage-gc's orphan scan
// cannot help either — it resolves a project folder to a workspace via
// files/file_events, both of which are gone, so it fails closed (correctly)
// and reports the blobs forever without deleting them.
//
// KNOWN LIMIT, deliberately not handled here: teardown removes the tenant,
// not the people. A user whose ONLY membership was in this workspace keeps
// their auth.users row and can still authenticate, they simply have no
// workspace (resolve-login will not find them). Deleting those accounts
// would be a cross-tenant destructive act on identities the operator did
// not create, so it stays out of scope — recorded in MASTER_PLAN §6.
// =============================================================================

import {
  corsHeaders,
  reply,
  requirePlatformOperator,
  logPlatformEvent,
  type OperatorContext,
} from '../_shared/operatorGuard.ts'
import { isRateLimited, envInt } from '../_shared/rateLimit.ts'
import { generatePassword } from '../_shared/adminGuard.ts'

const ACTIONS = new Set([
  'list',
  'create',
  'rename',
  'suspend',
  'restore',
  'teardown',
])

const BUCKET = 'rabbit-files'
const PAGE = 1000          // PostgREST max_rows; read in exactly one page's worth
const REMOVE_BATCH = 100   // objects per storage.remove() call
const CERT_BATCH = 40      // paths per certificate row (context CHECK is 8000 chars)

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/

type WorkspaceRow = {
  id: string
  name: string
  slug: string
  deleted_at: string | null
}

async function loadWorkspace(
  ctx: OperatorContext,
  id: string,
): Promise<WorkspaceRow | null> {
  const { data } = await ctx.admin
    .from('workspaces')
    .select('id, name, slug, deleted_at')
    .eq('id', id)
    .maybeSingle()
  return (data as WorkspaceRow | null) ?? null
}

/**
 * Every rabbit-files object path this workspace owns.
 *
 * Two sources, because either alone is incomplete: public.files is the live
 * set, and storage_gc_queue holds blobs whose files row is already gone but
 * whose disposal never ran. Both are paged — an un-ranged read silently
 * stops at max_rows and the sweep would then leave the tail behind, which
 * is precisely the class of bug that made S14's avatar scan delete the
 * wrong things.
 */
async function collectBlobPaths(
  ctx: OperatorContext,
  workspaceId: string,
): Promise<{ paths: string[]; rejected: string[] }> {
  const paths = new Set<string>()
  const rejected = new Set<string>()

  // Every project id this workspace owns. A blob is only ours to delete if it
  // sits under one of these.
  //
  // WHY THIS EXISTS: `files.storage_path` is unconstrained TEXT and is
  // client-writable — the files_insert/files_update policies pin
  // workspace_id and can_write_project, and say nothing about the path. So a
  // member of workspace A can point one of their own file rows at a key
  // belonging to workspace B (a path they might know from a previous
  // engagement), and this sweep runs with SERVICE ROLE, which bypasses the
  // rabbit-files storage policies entirely. Tearing down A would then delete
  // B's master file, leave B's files row dangling, and file the certificate
  // under A's slug. Found by the Session 15 pre-commit review.
  const projectIds = new Set<string>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await ctx.admin
      .from('projects')
      .select('id')
      .eq('workspace_id', workspaceId)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`project scan failed: ${error.message}`)
    for (const r of data ?? []) projectIds.add(r.id as string)
    if (!data || data.length < PAGE) break
  }

  // Key layout (supabaseAdapter.uploadFile):
  //   projects/{project_id}/{entity}/{entity_id}/{ts}-{name}
  const owned = (p: unknown): boolean => {
    if (typeof p !== 'string' || p.length === 0) return false
    const seg = p.split('/')
    return seg.length >= 3 && seg[0] === 'projects' && projectIds.has(seg[1])
  }

  const take = (p: unknown) => {
    if (owned(p)) paths.add(p as string)
    else if (typeof p === 'string' && p.length > 0) rejected.add(p)
  }

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await ctx.admin
      .from('files')
      .select('storage_path')
      .eq('workspace_id', workspaceId)
      .eq('storage_provider', 'supabase')
      .order('storage_path', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`files scan failed: ${error.message}`)
    for (const r of data ?? []) take(r.storage_path)
    if (!data || data.length < PAGE) break
  }

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await ctx.admin
      .from('storage_gc_queue')
      .select('object_path')
      .eq('workspace_id', workspaceId)
      .eq('bucket_id', BUCKET)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`gc queue scan failed: ${error.message}`)
    for (const r of data ?? []) take(r.object_path)
    if (!data || data.length < PAGE) break
  }

  return { paths: [...paths], rejected: [...rejected] }
}

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
  if (!ACTIONS.has(action)) {
    return reply({ error: 'validation_failed', errors: [{ field: 'action', error: 'unknown' }] }, 400)
  }

  // Durable limiter, keyed on the operator. Writes are the expensive/dangerous
  // side; reads get a looser budget so the console's list view stays usable.
  const limited = await isRateLimited(
    ctx.admin,
    action === 'list' ? 'operator-read' : 'operator-write',
    ctx.callerId,
    action === 'list' ? envInt('OPERATOR_READ_RPM', 120) : envInt('OPERATOR_WRITE_RPM', 20),
    60,
  )
  if (limited) return reply({ error: 'rate_limited' }, 429)

  // ── list ──────────────────────────────────────────────────────────────────
  // Paged, even though a platform with more than PAGE companies is unlikely:
  // PostgREST's max_rows cap applies to set-returning RPCs exactly as it does
  // to table reads, and it applies to service_role too. An un-ranged call
  // would silently return the first 1000 and the console would show a
  // complete-looking list that is not. Silent truncation on the surface used
  // to decide what to tear down is not a risk worth taking for one loop.
  if (action === 'list') {
    const workspaces: unknown[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await ctx.admin
        .rpc('operator_workspace_summary')
        .range(from, from + PAGE - 1)
      if (error) return reply({ error: 'list_failed', detail: error.message }, 500)
      const batch = data ?? []
      workspaces.push(...batch)
      if (batch.length < PAGE) break
    }
    return reply({ workspaces })
  }

  // ── create ────────────────────────────────────────────────────────────────
  // Mirrors provision-workspace: create the auth user, then call the atomic
  // provisioning RPC, then roll the auth user back if provisioning failed.
  // The operator gets the show-once password to hand over (locked #8).
  if (action === 'create') {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : ''
    const username = typeof body.admin_username === 'string'
      ? body.admin_username.trim().toLowerCase() : ''
    const displayName = typeof body.admin_display_name === 'string'
      ? body.admin_display_name.trim() : ''
    const email = typeof body.admin_email === 'string' ? body.admin_email.trim() : ''

    const errors: { field: string; error: string }[] = []
    if (name.length < 1 || name.length > 80) errors.push({ field: 'name', error: 'length_1_80' })
    if (!SLUG_RE.test(slug)) errors.push({ field: 'slug', error: 'shape' })
    if (!USERNAME_RE.test(username)) errors.push({ field: 'admin_username', error: 'shape' })
    if (errors.length) return reply({ error: 'validation_failed', errors }, 400)

    // An admin-created account may have no real mailbox — same convention as
    // admin-create-user, where a synthesized address means "resets are
    // admin-only by design" rather than a broken invite.
    const emailSynthesized = !email
    const finalEmail = email || `${username}.${slug}@wilson.invalid`

    const password = generatePassword(20)

    const { data: created, error: createErr } = await ctx.admin.auth.admin.createUser({
      email: finalEmail,
      password,
      email_confirm: true,
      app_metadata: {},
    })
    if (createErr || !created.user) {
      const msg = createErr?.message ?? ''
      if (/already been registered|already exists/i.test(msg)) {
        return reply({ error: 'email_taken' }, 409)
      }
      return reply({ error: 'create_failed', detail: msg }, 500)
    }

    const { data: prov, error: provErr } = await ctx.admin.rpc(
      'provision_workspace_and_admin',
      {
        p_workspace_name: name,
        p_slug: slug,
        p_admin_user_id: created.user.id,
        p_admin_username: username,
        p_admin_display: displayName || username,
      },
    )
    if (provErr) {
      // Roll back the orphan auth user — otherwise a taken slug leaves an
      // account nobody can reach and the email address permanently spent.
      try { await ctx.admin.auth.admin.deleteUser(created.user.id) } catch { /* best effort */ }
      if (/slug_taken/i.test(provErr.message)) return reply({ error: 'slug_taken' }, 409)
      return reply({ error: 'provision_failed', detail: provErr.message }, 500)
    }

    const row = Array.isArray(prov) ? prov[0] : prov
    const workspaceId = row?.workspace_id ?? null

    // Seed the workspace_id claim so the new admin's first token resolves
    // without waiting for the hook's oldest-membership fallback.
    try {
      await ctx.admin.auth.admin.updateUserById(created.user.id, {
        app_metadata: { workspace_id: workspaceId },
      })
    } catch { /* the hook derives it anyway */ }

    await logPlatformEvent(ctx, {
      action: 'workspace.created',
      workspaceId,
      workspaceSlug: slug,
      workspaceName: name,
      code: 'WIL-7001',
      message: `Created workspace ${name} (${slug})`,
      context: { admin_username: username, email_synthesized: emailSynthesized },
    })

    return reply({
      workspace_id: workspaceId,
      slug,
      admin_user_id: created.user.id,
      username,
      email: finalEmail,
      email_synthesized: emailSynthesized,
      password, // show-once
    }, 201)
  }

  // Every remaining action targets one workspace.
  const workspaceId = typeof body.workspace_id === 'string' ? body.workspace_id : ''
  if (!workspaceId) {
    return reply({ error: 'validation_failed', errors: [{ field: 'workspace_id', error: 'required' }] }, 400)
  }
  const ws = await loadWorkspace(ctx, workspaceId)
  if (!ws) return reply({ error: 'not_found' }, 404)

  // ── rename ────────────────────────────────────────────────────────────────
  // The slug is immutable by trigger (0020) and part of sign-in; only the
  // display name moves.
  if (action === 'rename') {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (name.length < 1 || name.length > 80) {
      return reply({ error: 'validation_failed', errors: [{ field: 'name', error: 'length_1_80' }] }, 400)
    }
    // .select().maybeSingle() and throw on zero rows: a refused UPDATE comes
    // back as 204 with no error, so "no error" is not "it happened".
    const { data, error } = await ctx.admin
      .from('workspaces')
      .update({ name })
      .eq('id', workspaceId)
      .select('id, name, slug')
      .maybeSingle()
    if (error) return reply({ error: 'update_failed', detail: error.message }, 500)
    if (!data) return reply({ error: 'update_failed', detail: 'no row updated' }, 500)

    await logPlatformEvent(ctx, {
      action: 'workspace.renamed',
      workspaceId,
      workspaceSlug: ws.slug,
      workspaceName: name,
      code: 'WIL-7002',
      message: `Renamed workspace ${ws.name} to ${name}`,
      context: { previous_name: ws.name },
    })
    return reply({ workspace: data })
  }

  // ── suspend / restore ─────────────────────────────────────────────────────
  // Soft delete. workspaces_select filters `deleted_at IS NULL`, so a
  // suspended company vanishes for its own members while staying fully
  // intact — the reversible step that teardown is not.
  if (action === 'suspend' || action === 'restore') {
    const suspending = action === 'suspend'
    if (suspending && ws.deleted_at) return reply({ error: 'already_suspended' }, 409)
    if (!suspending && !ws.deleted_at) return reply({ error: 'not_suspended' }, 409)

    const { data, error } = await ctx.admin
      .from('workspaces')
      .update({
        deleted_at: suspending ? new Date().toISOString() : null,
        deleted_by: suspending ? ctx.callerId : null,
      })
      .eq('id', workspaceId)
      .select('id, name, slug, deleted_at')
      .maybeSingle()
    if (error) return reply({ error: 'update_failed', detail: error.message }, 500)
    if (!data) return reply({ error: 'update_failed', detail: 'no row updated' }, 500)

    await logPlatformEvent(ctx, {
      action: suspending ? 'workspace.suspended' : 'workspace.restored',
      workspaceId,
      workspaceSlug: ws.slug,
      workspaceName: ws.name,
      code: suspending ? 'WIL-7003' : 'WIL-7004',
      severity: suspending ? 'warning' : 'info',
      message: suspending
        ? `Suspended workspace ${ws.name} (${ws.slug})`
        : `Restored workspace ${ws.name} (${ws.slug})`,
    })
    return reply({ workspace: data })
  }

  // ── teardown ──────────────────────────────────────────────────────────────
  if (action === 'teardown') {
    // Typed confirmation. The operator has to reproduce the slug of the
    // company they are about to destroy — cheap, and it is the difference
    // between a misclick and an intention.
    const confirm = typeof body.confirm_slug === 'string' ? body.confirm_slug.trim() : ''
    if (confirm !== ws.slug) {
      return reply({ error: 'confirmation_mismatch' }, 400)
    }

    // 1. Collect BEFORE anything is destroyed. After the CASCADE there is no
    //    record of which blobs belonged to this tenant.
    let paths: string[]
    let rejected: string[]
    try {
      const scan = await collectBlobPaths(ctx, workspaceId)
      paths = scan.paths
      rejected = scan.rejected
    } catch (err) {
      return reply({ error: 'scan_failed', detail: String((err as Error).message ?? err) }, 500)
    }

    // A rejected path is a files/queue row for this workspace pointing at a
    // key outside its own projects — either data corruption or a deliberate
    // cross-tenant reference. Either way it is not ours to delete, and it is
    // worth a certificate of its own: this is the only moment anyone will
    // ever look.
    if (rejected.length > 0) {
      await logPlatformEvent(ctx, {
        action: 'blob.purged',
        workspaceId,
        workspaceSlug: ws.slug,
        workspaceName: ws.name,
        code: 'WIL-7008',
        severity: 'error',
        message: `Teardown of ${ws.slug} REFUSED to delete ${rejected.length} path(s) outside this workspace's projects`,
        context: { bucket: BUCKET, rejected_paths: rejected },
      })
    }

    // 2. Delete the blobs, and certificate every batch. Certificates are
    //    written as we go rather than at the end, so a failure partway still
    //    leaves a record of what was already destroyed.
    //
    //    `remove()` answers 200 with a data array of the objects it ACTUALLY
    //    deleted and silently omits keys that had no storage.objects row, so
    //    counting the batch length would inflate the total — in the
    //    pathological case certifying "812 of 812 purged" when nothing was
    //    deleted at all. storage-gc has always read the array (its
    //    queue_missing branch); teardown now does too.
    let removed = 0
    let missing = 0
    const failed: string[] = []
    for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
      const batch = paths.slice(i, i + REMOVE_BATCH)
      const { data, error } = await ctx.admin.storage.from(BUCKET).remove(batch)
      if (error) {
        failed.push(...batch)
      } else {
        const n = Array.isArray(data) ? data.length : 0
        removed += n
        missing += batch.length - n
      }
    }
    for (let i = 0; i < paths.length; i += CERT_BATCH) {
      const batch = paths.slice(i, i + CERT_BATCH)
      await logPlatformEvent(ctx, {
        action: 'blob.purged',
        workspaceId,
        workspaceSlug: ws.slug,
        workspaceName: ws.name,
        code: 'WIL-7006',
        severity: 'warning',
        message: `Purged ${batch.length} blob(s) during teardown of ${ws.slug}`,
        // logPlatformEvent bounds this to the 8000-char context CHECK; storage
        // paths carry client-supplied filenames with no length cap.
        context: {
          bucket: BUCKET,
          paths: batch,
          batch: Math.floor(i / CERT_BATCH) + 1,
        },
      })
    }

    // 3. Now the row, and the CASCADE with it.
    const { error: delErr } = await ctx.admin
      .from('workspaces')
      .delete()
      .eq('id', workspaceId)
    if (delErr) {
      await logPlatformEvent(ctx, {
        action: 'workspace.teardown',
        workspaceId,
        workspaceSlug: ws.slug,
        workspaceName: ws.name,
        code: 'WIL-7007',
        severity: 'error',
        message: `Teardown of ${ws.slug} FAILED after purging ${removed} blob(s)`,
        context: { error: delErr.message, blobs_removed: removed },
      })
      return reply({ error: 'teardown_failed', detail: delErr.message, blobs_removed: removed }, 500)
    }

    // 4. NOW drop the queue rows — after the cascade, not before it.
    //    `trg_files_gc_enqueue` is AFTER DELETE FOR EACH ROW on files, so the
    //    cascade in step 3 enqueues one row per supabase-provider file all
    //    over again. Clearing the queue first (as this originally did) left
    //    exactly the undrainable rows gap #34 describes: no admin of a dead
    //    workspace exists to run storage-gc against them. The blobs they name
    //    were already deleted in step 2, so the rows are pure residue.
    try {
      await ctx.admin.from('storage_gc_queue').delete().eq('workspace_id', workspaceId)
    } catch { /* the rows are inert either way */ }

    // 5. The certificate that outlives the company.
    await logPlatformEvent(ctx, {
      action: 'workspace.teardown',
      workspaceId,
      workspaceSlug: ws.slug,
      workspaceName: ws.name,
      code: 'WIL-7005',
      severity: 'critical',
      message: `Tore down workspace ${ws.name} (${ws.slug})`,
      context: {
        blobs_found: paths.length,
        blobs_removed: removed,
        // Keys the bucket had no object for — already GC'd, or a files row
        // whose path drifted. Reported separately from `removed` so the
        // certificate never claims a destruction that did not happen.
        blobs_missing: missing,
        blobs_failed: failed.length,
        blobs_rejected: rejected.length,
      },
    })

    return reply({
      workspace_id: workspaceId,
      slug: ws.slug,
      blobs_found: paths.length,
      blobs_removed: removed,
      blobs_missing: missing,
      blobs_failed: failed.length,
      blobs_rejected: rejected.length,
    })
  }

  // Unreachable: the action enum is validated above.
  return reply({ error: 'unknown_action' }, 400)
})
