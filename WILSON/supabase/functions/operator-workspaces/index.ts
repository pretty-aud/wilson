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
//      even for service_role (the S14 avatar-scan bug), PLUS the reserved
//      objects the product writes with no row of their own (S36 — see
//      _shared/reservedObjects.ts and the note on collectBlobPaths);
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
import { reservedProjectObjectPaths } from '../_shared/reservedObjects.ts'

const ACTIONS = new Set([
  'list',
  'create',
  'rename',
  'suspend',
  'restore',
  'teardown',
])

const BUCKET = 'rabbit-files'
// S39. Derived previews. Teardown must sweep this bucket too, and the reason is
// the certificate rather than the disk space: WIL-7005 affirmatively STATES a
// complete disposal, so a bucket it does not know about turns the certificate
// into a false statement about a torn-down tenant's pre-release frames.
// (TPN-CLOUD-005 is exactly this complaint about the single-bucket sweep.)
const THUMBNAIL_BUCKET = 'rabbit-thumbnails'
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
 * THREE sources, because any one alone is incomplete: public.files is the
 * live set; storage_gc_queue holds blobs whose files row is already gone but
 * whose disposal never ran; and the RESERVED objects belong to no row at all.
 * The first two are paged — an un-ranged read silently stops at max_rows and
 * the sweep would then leave the tail behind, which is precisely the class of
 * bug that made S14's avatar scan delete the wrong things.
 *
 * 🚨 THE THIRD SOURCE IS S36, AND IT IS THE SAME BLIND SPOT AS THE storage-gc
 * DEFECT WITH THE SIGN REVERSED.
 *
 * `PROJECT.json` and `FINANCE/RATES.json` are written straight to the bucket
 * with no files row on purpose. A row-derived sweep cannot see them, so before
 * this they survived their own tenant's teardown — permanently, since after
 * the CASCADE nothing on the platform can attribute a project folder to a
 * workspace ever again. That left the money-gated rates mirror, the per-member
 * figures `can_access_project_money` exists to protect, sitting in the bucket
 * after the company it belonged to had been certifiably destroyed.
 *
 * §17 recorded the general form of this ("teardown cannot see blobs no row
 * points at") as a coverage gap and asserted "the row-derived sweep covers
 * every blob the product itself created". That sentence was false the moment
 * S26 shipped the manifest.
 *
 * The reserved paths are returned SEPARATELY rather than merged into `paths`
 * so the certificate keeps meaning what it says: `blobs_found` stays the count
 * of blobs a row actually pointed at, and the reserved objects — most of which
 * will not exist for any given project — get their own line rather than
 * inflating both `blobs_found` and `missing` by two per project.
 */
async function collectBlobPaths(
  ctx: OperatorContext,
  workspaceId: string,
): Promise<{ paths: string[]; rejected: string[]; reserved: string[]; thumbs: string[]; byoLeft: number | null; byoThumbsLeft: number | null }> {
  const paths = new Set<string>()
  const rejected = new Set<string>()
  const thumbs = new Set<string>()

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

  // S39: the derived previews, in their OWN bucket, from the same two row
  // sources. Kept in a separate set because they are removed from a different
  // bucket and counted on their own certificate line.
  //
  // 🚨 NO storage_provider FILTER HERE, and that is the whole subtlety. The
  // files scan above is pinned to storage_provider='supabase' because a body
  // at the customer's own bucket is their property (S37). A THUMBNAIL is not:
  // it is always written to Petal's rabbit-thumbnails, even for an s3-backed
  // workspace. Inheriting the provider filter would leave every BYO workspace's
  // previews behind while the certificate said otherwise — the exact inversion
  // of the rule it was copied from.
  const takeThumb = (p: unknown) => {
    if (owned(p)) thumbs.add(p as string)
    else if (typeof p === 'string' && p.length > 0) rejected.add(p)
  }

  // 🚨 S44: EXCLUDE s3, AND ONLY s3. S39 deliberately did NOT filter by provider
  // here, because every thumbnail was on Petal whatever held the body. Since S44
  // a thumbnail lives at its body's provider (Audrey, 2026-08-08 — a still frame
  // IS the content), so an s3 row's preview is in the CUSTOMER's bucket and
  // sweeping unfiltered would hand rabbit-thumbnails keys that were never in it.
  //
  // 🚨 THIS MUST MIRROR 0054's THUMBNAIL ARM, NOT THE BODY SCAN'S PIN, AND THE
  // DIFFERENCE IS A LEAK. The body scan pins to `= 'supabase'` because only a
  // Supabase BODY is in rabbit-files. But the thumbnail mapping is wider:
  //
  //     s3             -> the customer's bucket   (left, and COUNTED below)
  //     everything else -> rabbit-thumbnails       (ours to purge)
  //
  // — the exact CASE expression in fn_files_gc_enqueue. A `local_server` or
  // `google_drive` row CAN carry a Petal-hosted preview; 0053 widened the purge
  // trigger for precisely that case and 0054 keeps it. Copying the body scan's
  // `= 'supabase'` would exclude those rows from this sweep, LEAVING A LEGIBLE
  // FRAME IN rabbit-thumbnails while WIL-7005 certifies the tenant destroyed.
  // Caught in S44's own review of its own change.
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await ctx.admin
      .from('files')
      .select('thumbnail_url')
      .eq('workspace_id', workspaceId)
      .neq('storage_provider', 's3')
      .not('thumbnail_url', 'is', null)
      .order('thumbnail_url', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`thumbnail scan failed: ${error.message}`)
    for (const r of data ?? []) takeThumb(r.thumbnail_url)
    if (!data || data.length < PAGE) break
  }

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await ctx.admin
      .from('storage_gc_queue')
      .select('object_path')
      .eq('workspace_id', workspaceId)
      .eq('bucket_id', THUMBNAIL_BUCKET)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`thumbnail queue scan failed: ${error.message}`)
    for (const r of data ?? []) takeThumb(r.object_path)
    if (!data || data.length < PAGE) break
  }

  // The row-less objects, built from the project ids this workspace provably
  // owns — the same tenancy proof `owned()` applies to the row-derived paths,
  // so these need no separate check and can never be cross-tenant.
  //
  // Deduped against `paths`: a files row CAN point at one of these keys
  // (storage_path is client-writable), and deleting the same key in two
  // batches would count it once as removed and once as missing.
  const reserved = new Set<string>()
  for (const projectId of projectIds) {
    for (const p of reservedProjectObjectPaths(projectId)) {
      if (!paths.has(p)) reserved.add(p)
    }
  }

  // S37: bodies at the workspace's OWN bucket are DELIBERATELY not collected
  // (the files scan is pinned to storage_provider='supabase' and the queue
  // scan to the rabbit-files bucket). Teardown destroys what Petal holds; a
  // customer's bucket is the customer's property, and Petal reaching into it
  // on teardown — with credentials the customer gave it for file storage —
  // is not Petal's call to make. Counted here so the certificate STATES the
  // choice instead of silently under-reporting (the §17 lesson: a stated
  // coverage limit must be readable in both directions).
  //
  // 🚨 BOTH sources, and NULL on failure rather than 0. Live `files` rows are
  // only half of it: a purged-but-undrained body has no files row and still
  // sits in the customer's bucket, so a files-only count understates exactly
  // the objects a failed drain left behind. And a count that silently reads 0
  // on error is worse than no count — after the CASCADE nothing can ever
  // re-derive the true number, so the certificate would permanently assert
  // "nothing of yours remains" on the strength of a failed query. Both
  // corrections come from S37's adversarial review.
  // 🚨 S44 ADDS A SECOND COUNT, BECAUSE ONE ROW NOW LEAVES TWO OBJECTS.
  // Before S44 an s3 files row left exactly one object in the customer's
  // bucket — its body — so counting rows counted objects. Since S44 its
  // derived preview is beside it, so a row with a thumbnail_url leaves TWO,
  // and a row count under-reports the tenant's remaining objects by one per
  // preview. A certificate that under-reports is precisely the failure S39's
  // review caught, one bucket over.
  //
  // Reported as its own number rather than folded into byo_bodies_left: a
  // thumbnail is not a body, and the existing field's meaning must not shift
  // under a reader comparing two certificates. The queue halves split on
  // `kind` (0054) for the same reason — before that column every queued s3 row
  // WAS a body, and it is only now that the two are distinguishable.
  let byoLeft: number | null = null
  let byoThumbsLeft: number | null = null
  const [liveRes, liveThumbRes, queuedRes, queuedThumbRes] = await Promise.all([
    ctx.admin.from('files').select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId).eq('storage_provider', 's3'),
    ctx.admin.from('files').select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId).eq('storage_provider', 's3')
      .not('thumbnail_url', 'is', null),
    // 🚨 UNDRAINED ROWS ONLY. Queue rows are STAMPED, never deleted (0027's
    // status enum), so an unfiltered count says "still in your bucket" about
    // every object storage-gc has already destroyed — after one successful
    // cleanup run the certificate over-reports permanently. The comment above
    // says this half exists for a "purged-but-UNDRAINED body"; nothing was
    // filtering for undrained. S37's omission, inherited by S44's new field and
    // caught by S44's review.
    //
    // 'skipped' is excluded for a second, independent reason: it means "a files
    // row still references this path", so the live half above already counts
    // that object — including it would double-count it.
    //
    // Over-reporting is the same category of false statement as the
    // under-reporting S39's review caught; the certificate has to be true in
    // BOTH directions.
    ctx.admin.from('storage_gc_queue').select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId).eq('provider', 's3').eq('kind', 'body')
      .in('status', ['pending', 'failed']),
    ctx.admin.from('storage_gc_queue').select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId).eq('provider', 's3').eq('kind', 'thumbnail')
      .in('status', ['pending', 'failed']),
  ])
  // NULL on ANY failure rather than 0, and BOTH numbers together: after the
  // CASCADE nothing can ever re-derive them, so a count that silently read 0
  // on error would permanently assert "nothing of yours remains" on the
  // strength of a failed query. (S37's review; extended to the new pair — a
  // half-populated pair is the same lie in smaller print.)
  if (!liveRes.error && !liveThumbRes.error && !queuedRes.error && !queuedThumbRes.error) {
    byoLeft = (liveRes.count ?? 0) + (queuedRes.count ?? 0)
    byoThumbsLeft = (liveThumbRes.count ?? 0) + (queuedThumbRes.count ?? 0)
  }

  return {
    paths: [...paths], rejected: [...rejected], reserved: [...reserved],
    thumbs: [...thumbs], byoLeft, byoThumbsLeft,
  }
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
    let reserved: string[]
    let thumbs: string[]
    let byoLeft: number | null
    let byoThumbsLeft: number | null
    try {
      const scan = await collectBlobPaths(ctx, workspaceId)
      paths = scan.paths
      rejected = scan.rejected
      reserved = scan.reserved
      thumbs = scan.thumbs
      byoLeft = scan.byoLeft
      byoThumbsLeft = scan.byoThumbsLeft
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

    // 2b. The RESERVED objects (S36), in their own pass with their own
    //     counters, and AFTER the certificates above rather than before them.
    //
    //     The ordering is not cosmetic and was the first draft's mistake: this
    //     block ends in an `await logPlatformEvent`, and inserting that ahead
    //     of the loop above would have put a new way to throw in front of the
    //     certificates for blobs that were ALREADY DELETED — the exact
    //     property step 2's comment exists to guarantee ("written as we go, so
    //     a failure partway still leaves a record of what was destroyed").
    //
    //     Counted apart from `removed`/`missing`/`failed` because the inputs
    //     are different in kind. The row-derived paths are blobs a row said
    //     exist; these are two CANDIDATES per project, most of which will not
    //     exist for any given project, so folding them in would inflate
    //     `blobs_missing` by roughly twice the project count and make the
    //     certificate read as a much larger failed purge than it was.
    //
    //     `remove()` answers with the objects it actually deleted, so its
    //     response is an exact census — which is why the keys are submitted
    //     blind rather than list()-ed first. Two extra storage calls per
    //     project would buy nothing and spend the Edge deadline.
    //     The COUNT comes from the array length, exactly as the loop above
    //     takes it — that reading is the one already proven against this API.
    //     The PATHS come from each entry's `name`, which is a convenience for
    //     the certificate and nothing depends on: if the shape ever changes,
    //     the list goes empty or short and the count stays correct, rather
    //     than the count being wrong in a compliance record.
    let reservedRemoved = 0
    const reservedRemovedPaths: string[] = []
    const reservedFailed: string[] = []
    for (let i = 0; i < reserved.length; i += REMOVE_BATCH) {
      const batch = reserved.slice(i, i + REMOVE_BATCH)
      const { data, error } = await ctx.admin.storage.from(BUCKET).remove(batch)
      if (error) {
        reservedFailed.push(...batch)
      } else if (Array.isArray(data)) {
        reservedRemoved += data.length
        // Name the objects rather than only counting them: this function's
        // premise is that a deletion is a recorded, attributable act, and
        // "2 removed" does not say WHICH project lost its rates mirror.
        reservedRemovedPaths.push(
          ...data.map((o: { name?: string }) => o?.name).filter((n): n is string => typeof n === 'string'),
        )
      }
    }
    for (let i = 0; i < reservedRemovedPaths.length; i += CERT_BATCH) {
      const batch = reservedRemovedPaths.slice(i, i + CERT_BATCH)
      await logPlatformEvent(ctx, {
        action: 'blob.purged',
        workspaceId,
        workspaceSlug: ws.slug,
        workspaceName: ws.name,
        code: 'WIL-7006',
        severity: 'warning',
        message: `Purged ${batch.length} product-written blob(s) during teardown of ${ws.slug}`,
        context: {
          bucket: BUCKET,
          reserved: true,
          paths: batch,
          batch: Math.floor(i / CERT_BATCH) + 1,
        },
      })
    }

    // 2c. The DERIVED PREVIEWS (S39), in their own bucket and their own pass.
    //
    //     🚨 A SECOND BUCKET IS A SECOND WAY FOR THE CERTIFICATE TO LIE. WIL-7005
    //     below affirmatively states a complete disposal; until this block
    //     existed, every torn-down tenant's thumbnails stayed in
    //     rabbit-thumbnails while the certificate said the tenant had been
    //     destroyed. Frames of pre-release content are exactly the payload that
    //     claim must be true about, and after the CASCADE nothing on the
    //     platform can attribute a project folder to a workspace ever again —
    //     so this is the last moment it is possible at all. Same reasoning as
    //     the reserved-objects pass above, one bucket over.
    //
    //     Counted apart for the same reason as the reserved objects: these are
    //     derived candidates, not blobs a row promised, and folding them into
    //     `removed`/`missing` would make one file look like two.
    //
    //     Placed AFTER 2b's certificates, obeying the ordering rule 2b states:
    //     a new way to throw must never sit in front of the certificates for
    //     blobs that have already been deleted.
    let thumbsRemoved = 0
    const thumbsFailed: string[] = []
    const thumbsRemovedPaths: string[] = []
    for (let i = 0; i < thumbs.length; i += REMOVE_BATCH) {
      const batch = thumbs.slice(i, i + REMOVE_BATCH)
      const { data, error } = await ctx.admin.storage.from(THUMBNAIL_BUCKET).remove(batch)
      if (error) {
        thumbsFailed.push(...batch)
      } else if (Array.isArray(data)) {
        thumbsRemoved += data.length
        thumbsRemovedPaths.push(
          ...data.map((o: { name?: string }) => o?.name).filter((n): n is string => typeof n === 'string'),
        )
      }
    }
    for (let i = 0; i < thumbsRemovedPaths.length; i += CERT_BATCH) {
      const batch = thumbsRemovedPaths.slice(i, i + CERT_BATCH)
      await logPlatformEvent(ctx, {
        action: 'blob.purged',
        workspaceId,
        workspaceSlug: ws.slug,
        workspaceName: ws.name,
        code: 'WIL-7006',
        severity: 'warning',
        message: `Purged ${batch.length} thumbnail(s) during teardown of ${ws.slug}`,
        context: {
          bucket: THUMBNAIL_BUCKET,
          derived: true,
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
        // The row-less objects (S36). `candidates` is two per project by
        // construction, so only `removed` says anything: it is the number of
        // manifest/rates mirrors that actually existed and are now gone.
        reserved_candidates: reserved.length,
        reserved_removed: reservedRemoved,
        reserved_failed: reservedFailed.length,
        // The derived previews (S39), in rabbit-thumbnails. A SECOND BUCKET is
        // a second way this certificate can be wrong, so it is stated rather
        // than assumed covered by blobs_removed — which counts rabbit-files
        // only.
        //
        // ⚠️ S44 NARROWED WHAT THESE THREE COVER. They used to include previews
        // of bodies at a customer's own bucket, because every preview was on
        // Petal. Since S44 a thumbnail lives at its body's provider, so these
        // count PETAL-HOSTED previews only and the rest are in
        // byo_thumbnails_left below. Read the two together, or a torn-down s3
        // tenant looks like it had no previews at all.
        thumbnails_found: thumbs.length,
        thumbnails_removed: thumbsRemoved,
        thumbnails_failed: thumbsFailed.length,
        // Bodies at the customer's own bucket, DELIBERATELY left (S37): their
        // storage, their property — see collectBlobPaths. Zero for every
        // workspace that never configured S3. NULL means the count could not
        // be taken, which is NOT zero: after the CASCADE nothing can re-derive
        // it, so an unknown must read as unknown forever.
        byo_bodies_left: byoLeft,
        // 🚨 S44: their PREVIEWS, left for the same reason and counted for the
        // same reason. Without this the certificate under-reports the objects
        // remaining in the customer's bucket by one per preview — and a
        // certificate that under-reports is the failure S39's own review
        // caught. Same NULL-is-not-zero rule as the line above.
        byo_thumbnails_left: byoThumbsLeft,
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
      reserved_removed: reservedRemoved,
      reserved_failed: reservedFailed.length,
      thumbnails_removed: thumbsRemoved,
      thumbnails_failed: thumbsFailed.length,
      // S44: surfaced in the operator's immediate response too, not only on the
      // certificate — "we destroyed everything of ours; this many objects
      // remain in your bucket" is the sentence an operator needs while the
      // teardown is still on screen.
      byo_bodies_left: byoLeft,
      byo_thumbnails_left: byoThumbsLeft,
    })
  }

  // Unreachable: the action enum is validated above.
  return reply({ error: 'unknown_action' }, 400)
})
