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

// 🚨 A CLOSED ENUM, VALIDATED BEFORE ANY WORK. An action implemented below but
// missing here is rejected with validation_failed/400 and never runs — the
// handler reads as live code and is unreachable.
const ACTIONS = new Set([
  'list',
  'create',
  'rename',
  'admin_contact',
  'send_setup_link',
  'suspend',
  'restore',
  'teardown',
])

// Where the setup link points. ⚠️ Mirrors invite-member's constant, including
// the localhost fallback. The recovery TEMPLATE builds its href from
// {{ .SiteURL }} rather than from this — see the send_setup_link handler — so
// this is the redirect hint, not the address the recipient clicks.
const SITE_URL = Deno.env.get('WILSON_SITE_URL') ?? 'http://localhost:5203'

const BUCKET = 'rabbit-files'
// S39. Derived previews. Teardown must sweep this bucket too, and the reason is
// the certificate rather than the disk space: WIL-7005 affirmatively STATES a
// complete disposal, so a bucket it does not know about turns the certificate
// into a false statement about a torn-down tenant's pre-release frames.
// (TPN-CLOUD-005 is exactly this complaint about the single-bucket sweep.)
//
// ⚠️ S44: THIS IS THE PETAL-HOSTED PREVIEWS' BUCKET, NOT "THE THUMBNAIL BUCKET".
// Since 0054 a preview lives at its body's provider, so an s3 workspace's
// previews are in the CUSTOMER's bucket and are deliberately NOT swept — they
// are counted as byo_thumbnails_left instead. The scan below excludes s3 and
// only s3, mirroring 0054's thumbnail arm.
const THUMBNAIL_BUCKET = 'rabbit-thumbnails'
const PAGE = 1000          // PostgREST max_rows; read in exactly one page's worth
const REMOVE_BATCH = 100   // objects per storage.remove() call
const CERT_BATCH = 40      // paths per certificate row (context CHECK is 8000 chars)

// Track C / C2 (Audrey's decision 24, 2026-09-04): THE THIRD BUCKET. Avatars
// live at user-avatars/{workspace_id}/{user_id}/{filename} (0009) and are
// photographs of identifiable people. Three buckets, and until C2 teardown
// swept two: after the CASCADE `workspace_members` is gone, so storage-gc's
// avatar arm could never run for that tenant again, and WIL-7005's "torn down"
// was a personal-data statement made with the faces still resident. No row
// names an avatar object (avatar_url names the CURRENT one only), so this
// bucket is LISTED by prefix rather than derived from rows — the prefix is the
// tenancy proof, because 0009's INSERT policy pins the first folder to the
// uploader's workspace. Counted from remove()'s RETURNED array, never the batch.
const AVATAR_BUCKET = 'user-avatars'
const LIST_PAGE = 100      // storage.list() page (the API's own default)
const AVATAR_MAX = 5000    // objects per teardown; past it the scan STOPS AND SAYS SO

/**
 * Addresses that exist only to satisfy GoTrue's email shape, and that nobody
 * reads. Mailing one reports success to the operator and delivers nothing.
 *
 * 🚨 TWO FORMATS, NOT ONE, AND THE SECOND IS REACHABLE HERE. This function's
 *    own `create` mints `${username}.${slug}@wilson.invalid`. But a company
 *    admin created later through admin-create-user gets
 *    `wilson.<workspace8>.<local>@mail.petalstudios.co` — a domain Petal really
 *    controls, which UsersSection badges "no real inbox" on screen. If the
 *    founding admin is deactivated, that member becomes the oldest active admin
 *    and this handler would happily mail a mailbox with no reader.
 *
 * ⚠️ A SHAPE CHECK CANNOT DO THIS. invite-member's own
 *    EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/ accepts both of them.
 */
const SYNTHESIZED_SUFFIXES = ['@wilson.invalid', '@mail.petalstudios.co']

function isSynthesizedAddress(email: string): boolean {
  const e = email.trim().toLowerCase()
  return SYNTHESIZED_SUFFIXES.some((suffix) => e.endsWith(suffix))
}

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
 * The company's FOUNDING admin, with the address mail would actually go to.
 *
 * Oldest active admin by created_at. `provision_workspace_and_admin` makes
 * exactly one at creation, so on an untouched company this is that person; a
 * company can acquire more admins later, and the oldest is the defensible
 * choice because nothing on the row marks the founder as such.
 *
 * ⚠️ limit(1), NOT maybeSingle(). A workspace with two admins makes
 *    maybeSingle() throw PGRST116, which would turn "this company has more than
 *    one admin" into a 500.
 * ⚠️ The address lives on the AUTH user, never on the membership row.
 */
async function loadFoundingAdmin(
  ctx: OperatorContext,
  workspaceId: string,
): Promise<{ userId: string; username: string | null; email: string } | null> {
  const { data, error } = await ctx.admin
    .from('workspace_members')
    .select('user_id, username, created_at')
    .eq('workspace_id', workspaceId)
    .eq('app_role', 'admin')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
  if (error) throw new Error(`admin lookup failed: ${error.message}`)
  const row = data?.[0] as { user_id?: string; username?: string } | undefined
  if (!row?.user_id) return null

  const { data: authUser, error: authErr } =
    await ctx.admin.auth.admin.getUserById(row.user_id)
  if (authErr || !authUser?.user) {
    throw new Error(`admin lookup failed: ${authErr?.message ?? 'no auth user'}`)
  }
  return {
    userId: row.user_id,
    username: row.username ?? null,
    email: (authUser.user.email ?? '').trim(),
  }
}

/** One folder level of a bucket, every page. Folders come back with id: null. */
async function listFolder(
  ctx: OperatorContext,
  bucket: string,
  prefix: string,
): Promise<Array<{ name: string; id: string | null }>> {
  const out: Array<{ name: string; id: string | null }> = []
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await ctx.admin.storage.from(bucket).list(prefix, {
      limit: LIST_PAGE, offset, sortBy: { column: 'name', order: 'asc' },
    })
    if (error) throw new Error(`storage list ${bucket}/${prefix}: ${error.message}`)
    out.push(...((data ?? []) as Array<{ name: string; id: string | null }>))
    if (!data || data.length < LIST_PAGE) return out
  }
}

/**
 * Every object below user-avatars/{workspaceId}/ (Track C / C2), by LISTING
 * the prefix — see AVATAR_BUCKET for why no row can supply these. The layout is
 * two levels deep; anything deeper under the prefix is still this tenant's and
 * still swept, to a depth bound. Budgeted: past AVATAR_MAX the walk stops and
 * `truncated` says so, because a certificate that silently stopped counting
 * is the S39 defect one bucket over. A listing that fails THROWS, and the
 * caller refuses the teardown — a certificate written over an unknown set
 * would be wrong the moment it was signed.
 */
async function collectAvatarPaths(
  ctx: OperatorContext,
  workspaceId: string,
): Promise<{ avatars: string[]; truncated: boolean }> {
  const avatars: string[] = []
  let truncated = false
  const walk = async (prefix: string, depth: number): Promise<void> => {
    if (truncated) return
    const entries = await listFolder(ctx, AVATAR_BUCKET, prefix)
    for (const e of entries) {
      if (truncated) return
      const path = `${prefix}/${e.name}`
      if (e.id === null) {
        if (depth >= 4) { truncated = true; return }
        await walk(path, depth + 1)
      } else {
        if (avatars.length >= AVATAR_MAX) { truncated = true; return }
        avatars.push(path)
      }
    }
  }
  await walk(workspaceId, 1)
  return { avatars, truncated }
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

  // The derived previews, in their OWN bucket, from the same two row sources.
  // Kept in a separate set because they are removed from a different bucket and
  // counted on their own certificate line.
  //
  // ⚠️ THIS BLOCK USED TO SAY "NO storage_provider FILTER HERE" AND THAT A
  // THUMBNAIL "is always written to Petal's rabbit-thumbnails, even for an
  // s3-backed workspace". Both were true under S39 and BOTH ARE NOW FALSE — S44
  // (0054) routes a preview to the provider its body went to. The filter the
  // old comment forbade is now required, and it is twelve lines below. Rewritten
  // rather than left standing: a comment that instructs the opposite of the code
  // beneath it is how the next session confidently reverts a fix.
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

  // ── admin_contact ─────────────────────────────────────────────────────────
  // 🚨 THIS EXISTS BECAUSE THE SAFETY MECHANISM WAS UNUSABLE WITHOUT IT.
  //    send_setup_link makes the operator type the admin's address back, on the
  //    reasoning that this hands over a company that already exists. But NO
  //    operator surface shows that address: operator_workspace_summary() (0028)
  //    returns member COUNTS and no contact detail, and the create-time
  //    CredentialsDialog is show-once. An operator returning to a company a
  //    week later could not send a link at all — not because it was refused,
  //    but because they had nothing to type.
  //    This is the teardown precedent, not a new idea: that flow SHOWS the slug
  //    and real counts and then requires the slug typed back. A confirmation
  //    you cannot read is theatre; one you can read is a check.
  // ⚠️ Read-only, and no wider than the operator already is — an operator can
  //    already tear this company down. It reveals nothing about anyone outside
  //    the workspace they named.
  if (action === 'admin_contact') {
    // 🚨 CAUGHT, exactly as send_setup_link catches it. loadFoundingAdmin THROWS
    //    on a failed lookup — that is the R1 correction that made it the one
    //    shared query — and Deno.serve wraps this function in no error handler,
    //    so an uncaught throw here was a bare 500 with no CORS headers and no
    //    JSON body, which the browser refuses to hand to the console. A
    //    transient PostgREST or GoTrue hiccup on this READ therefore surfaced as
    //    "Network error — check your connection." instead of admin_lookup_failed's
    //    own sentence. The helper's failure contract changed in R1 and only one
    //    of its two callers followed it. Found by the R2 review (Track A, A1).
    let admin0
    try {
      admin0 = await loadFoundingAdmin(ctx, workspaceId)
    } catch (err) {
      return reply({ error: 'admin_lookup_failed', detail: String((err as Error)?.message ?? err) }, 500)
    }
    if (!admin0) return reply({ error: 'no_admin' }, 409)
    return reply({
      email: admin0.email,
      username: admin0.username,
      // The console greys out Send rather than letting the operator type an
      // address that the server will refuse anyway.
      deliverable: !isSynthesizedAddress(admin0.email),
      suspended: Boolean(ws.deleted_at),
    })
  }

  // ── send_setup_link ───────────────────────────────────────────────────────
  // Session 43b. Audrey: "lets make it that the operator ... can send this as a
  // link for when they establish a new company ... for the new company to set
  // up their workspace."
  //
  // 🚨 A RECOVERY LINK, NOT AN INVITE, AND THAT IS NOT A STYLE CHOICE.
  //    `inviteUserByEmail` CREATES the auth row. `create` above has already
  //    created it — with `email_confirm: true` and a generated password — so an
  //    invite here returns "already been registered" on every call, forever.
  //    Recovery is the only verb that works against an existing user.
  //
  // 🚨 THE WORKSPACE AND ITS ADMIN ALREADY EXIST WHEN THIS RUNS. There is no
  //    "pending company" state: provision_workspace_and_admin inserted the
  //    workspaces row and an is_active, app_role='admin' membership at create
  //    time. So a link sent to the wrong address does not invite a stranger to
  //    sign up — it hands them a real company. Hence: the caller must echo back
  //    the exact address (confirm_email), and the address is recorded in the
  //    certificate.
  if (action === 'send_setup_link') {
    // 🚨 NOT FOR A SUSPENDED COMPANY. loadWorkspace deliberately returns
    //    soft-deleted rows and the suspend/restore branch below guards on the
    //    same field. Without this the link works, the recipient sets a
    //    password, and then cannot sign in at all — workspaces_select filters
    //    `deleted_at IS NULL` — while the certificate asserts a hand-over that
    //    did not happen.
    if (ws.deleted_at) return reply({ error: 'already_suspended' }, 409)

    // Same helper the admin_contact read uses, so the address the console
    // DISPLAYS and the address the server DEMANDS can never diverge — two
    // copies of this query would be exactly the drift that makes a typed
    // confirmation impossible to satisfy.
    let admin0
    try {
      admin0 = await loadFoundingAdmin(ctx, workspaceId)
    } catch (err) {
      return reply({ error: 'admin_lookup_failed', detail: String((err as Error)?.message ?? err) }, 500)
    }
    if (!admin0) return reply({ error: 'no_admin' }, 409)
    const adminEmail = admin0.email

    // 🚨 THE SYNTHESIZED-ADDRESS REFUSAL. Two formats exist and both are
    //    reachable here — see isSynthesizedAddress. Mailing one reports success
    //    and delivers to nobody.
    if (!adminEmail || isSynthesizedAddress(adminEmail)) {
      return reply({ error: 'email_synthesized' }, 409)
    }

    // The operator must retype/confirm the address they are about to hand a
    // company to. Compared case-insensitively because mail is; compared at all
    // because a typo at create time is otherwise invisible until a stranger
    // signs in.
    // ⚠️ NOT `confirmation_mismatch`. That code already exists for teardown's
    //    typed-slug gate, and its FRIENDLY string reads "The slug you typed
    //    does not match" — which would appear over an EMAIL field. A code with
    //    the wrong noun is the same defect as no code at all, just quieter.
    const confirm = typeof body.confirm_email === 'string' ? body.confirm_email.trim() : ''
    if (confirm.toLowerCase() !== adminEmail.toLowerCase()) {
      return reply({ error: 'email_mismatch' }, 400)
    }

    // GoTrue mails the recovery template and mints the token. The redirect is
    // passed for completeness, but ⚠️ the TEMPLATE decides where the link
    // actually points: recovery.html builds its href from {{ .SiteURL }}, on
    // purpose, because the desktop app runs on a dynamic 127.0.0.1 port. If the
    // link lands somewhere wrong, the project's Site URL is what to fix — not
    // this line.
    const { error: mailErr } = await ctx.admin.auth.resetPasswordForEmail(
      adminEmail,
      { redirectTo: `${SITE_URL}/#/recovery` },
    )
    if (mailErr) {
      // 🚨 SURFACED, NOT SWALLOWED. A green tick over a mail that never left is
      //    this repo's signature defect, and here it would leave the operator
      //    believing a company has been handed over when nobody was told.
      return reply({ error: 'send_failed', detail: mailErr.message }, 502)
    }

    await logPlatformEvent(ctx, {
      action: 'workspace.invite_sent',
      workspaceId,
      workspaceSlug: ws.slug,
      workspaceName: ws.name,
      // ⚠️ WIL-7009, NOT 7006. WIL-7006 is the registered blob.purged BATCH
      //    certificate (SYSTEMS_HANDBOOK §17) and is emitted from three places
      //    in this very file. A duplicated code makes the audit trail
      //    unreadable exactly when someone is trying to read it.
      code: 'WIL-7009',
      message: `Setup link sent for ${ws.name} (${ws.slug})`,
      // sent_to is the whole point of the certificate: "we sent it to the wrong
      // place" is unanswerable after the fact without it.
      context: { sent_to: adminEmail, admin_username: admin0.username },
    })

    return reply({ ok: true, sent_to: adminEmail, username: admin0.username })
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

    // 1b. The AVATARS, by prefix (Track C / C2). Part of the collect step: a
    //     listing that fails refuses the teardown like any other scan, for the
    //     same reason — after the CASCADE nothing can re-derive the set.
    let avatars: string[]
    let avatarsTruncated: boolean
    try {
      const a = await collectAvatarPaths(ctx, workspaceId)
      avatars = a.avatars
      avatarsTruncated = a.truncated
    } catch (err) {
      return reply({ error: 'scan_failed', detail: `avatars: ${String((err as Error).message ?? err)}` }, 500)
    }

    // 1c. The OPEN UPLOAD RESERVATIONS (Track C / C2, migration 0074), BEFORE
    //     anything is destroyed and BEFORE the CASCADE. upload_reservations and
    //     file_events both CASCADE with the workspace, so a tenant torn down
    //     with an upload in flight was certified "torn down" with that partial
    //     unrecorded (TPN-CONT-017). sweep_open_uploads closes every open row —
    //     'completed' where the object landed, 'abandoned' with a certificate
    //     otherwise — and returns the abandoned paths, which the WIL-7012
    //     certificates in step 1d carry into platform_audit, the one table the
    //     CASCADE cannot reach.
    //
    //     🚨 THE FAILURE FLAG STARTS TRUE and is cleared only by an ANSWER
    //     (storage-gc's lesson, C1 review round 1): a database without 0074
    //     answers PGRST202, and a certificate that silently read 0/0 there
    //     would claim a sweep that never ran. rpc() resolves for every status,
    //     so `.error` is the only signal; a thrown transport error lands on the
    //     same flag. Nothing here throws past this block — nothing has been
    //     destroyed yet, but the teardown must still proceed and RECORD that
    //     the sweep did not answer.
    let reservationsAbandoned = 0
    let reservationsCompleted = 0
    let reservationSweepFailed = true
    let abandonedPaths: string[] = []
    try {
      const { data, error } = await ctx.admin.rpc('sweep_open_uploads', { p_workspace_id: workspaceId })
      if (!error) {
        const row = (Array.isArray(data) ? data[0] : data) as
          { abandoned?: number; completed?: number; abandoned_paths?: unknown } | null | undefined
        reservationSweepFailed = false
        reservationsAbandoned = Number(row?.abandoned ?? 0)
        reservationsCompleted = Number(row?.completed ?? 0)
        abandonedPaths = Array.isArray(row?.abandoned_paths)
          ? (row?.abandoned_paths as unknown[]).filter((p): p is string => typeof p === 'string')
          : []
      }
    } catch { /* reservationSweepFailed stays true, and the certificate says so */ }

    // 1d. Certify the ABANDONED UPLOADS NOW, where the CASCADE cannot reach.
    //     Nothing has been destroyed yet, so 2b's ordering rule ("no new way
    //     to throw ahead of certificates for blobs already gone") is not in
    //     play — WIL-7008 below sits at the same point for the same reason. And
    //     it must be NOW rather than after the blob passes: 1c has already
    //     committed the rows as 'abandoned', so a teardown that died between
    //     here and a later certificate would let the CASCADE take the first
    //     run's file_events certificates with it (R1 review, C2). Nothing was
    //     destroyed here — a partial is reaped by Supabase's 24 h TUS expiry,
    //     which nothing on the platform can see — so this is WIL-7012,
    //     "certified abandoned", never WIL-7006 "purged". One row per
    //     CERT_BATCH paths, like every other certificate here.
    //
    //     🚨 WHAT IS CERTIFIED IS THE TENANT'S WHOLE ABANDONED-UPLOAD RECORD,
    //     NOT ONLY THIS RUN'S. Every `upload_abandoned` row in file_events —
    //     written by this sweep, by the hourly one (0073), or by a person's
    //     own client on a failed upload (0074) — is destroyed by the CASCADE in
    //     a few seconds' time, and this is the last moment any of it can be
    //     preserved. Reading them also closes the retry case R2 named: a
    //     teardown that DIED between 1c and this line left rows already closed
    //     as 'abandoned', so a second attempt's sweep would find nothing open
    //     and certify nothing — but their file_events rows are still there to
    //     be read. Union, deduped, bounded; a read that fails leaves the
    //     sweep's own paths, which is what the previous revision certified.
    const certifyPaths = new Set<string>(abandonedPaths)
    let abandonedRecordsTruncated = false
    try {
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await ctx.admin
          .from('file_events')
          .select('new_path')
          .eq('workspace_id', workspaceId)
          .eq('event', 'upload_abandoned')
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1)
        if (error) break
        for (const r of data ?? []) {
          if (typeof r.new_path === 'string' && r.new_path.length > 0) certifyPaths.add(r.new_path)
        }
        if (!data || data.length < PAGE) break
        // One page is 1000 records; a tenant with more has had a pathological
        // number of abandoned uploads, and a certificate that quietly stopped
        // counting is the S39 defect. Stop, and SAY so.
        abandonedRecordsTruncated = true
        break
      }
    } catch { abandonedRecordsTruncated = true }
    const abandonedCertified = [...certifyPaths]

    for (let i = 0; i < abandonedCertified.length; i += CERT_BATCH) {
      const batch = abandonedCertified.slice(i, i + CERT_BATCH)
      await logPlatformEvent(ctx, {
        action: 'workspace.teardown',
        workspaceId,
        workspaceSlug: ws.slug,
        workspaceName: ws.name,
        code: 'WIL-7012',
        severity: 'warning',
        message: `Certified ${batch.length} abandoned upload(s) during teardown of ${ws.slug}`,
        context: {
          paths: batch,
          batch: Math.floor(i / CERT_BATCH) + 1,
          truncated: abandonedRecordsTruncated,
          note: 'every upload_abandoned record this company had, preserved before the CASCADE destroyed it: the open reservations this teardown closed (sweep_open_uploads, 0074) plus any already certified by the hourly sweep or by a person\'s own failed upload. The partials expire at 24 h in Supabase Storage and are not enumerable from WILSON',
        },
      })
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

    // 2d. The AVATARS (Track C / C2): the third bucket, its own pass, its own
    //     counters — a photograph of a person is not a preview frame, and the
    //     two must never be folded into one number. Same ordering rule as 2b
    //     and 2c: AFTER the certificates already written for blobs already
    //     gone. Counted from remove()'s RETURNED array — the batch length would
    //     certify a destruction that never happened (the S15 finding).
    let avatarsRemoved = 0
    const avatarsFailed: string[] = []
    const avatarsRemovedPaths: string[] = []
    for (let i = 0; i < avatars.length; i += REMOVE_BATCH) {
      const batch = avatars.slice(i, i + REMOVE_BATCH)
      const { data, error } = await ctx.admin.storage.from(AVATAR_BUCKET).remove(batch)
      if (error) {
        avatarsFailed.push(...batch)
      } else if (Array.isArray(data)) {
        avatarsRemoved += data.length
        avatarsRemovedPaths.push(
          ...data.map((o: { name?: string }) => o?.name).filter((n): n is string => typeof n === 'string'),
        )
      }
    }
    for (let i = 0; i < avatarsRemovedPaths.length; i += CERT_BATCH) {
      const batch = avatarsRemovedPaths.slice(i, i + CERT_BATCH)
      await logPlatformEvent(ctx, {
        action: 'blob.purged',
        workspaceId,
        workspaceSlug: ws.slug,
        workspaceName: ws.name,
        code: 'WIL-7006',
        severity: 'warning',
        message: `Purged ${batch.length} avatar(s) during teardown of ${ws.slug}`,
        context: {
          bucket: AVATAR_BUCKET,
          avatars: true,
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
        context: { error: delErr.message, blobs_removed: removed, avatars_removed: avatarsRemoved },
      })
      return reply({ error: 'teardown_failed', detail: delErr.message, blobs_removed: removed, avatars_removed: avatarsRemoved }, 500)
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
        // Track C / C2: the THIRD bucket, LISTED by prefix (no row names an
        // avatar). `avatars_truncated: true` means the listing stopped at
        // AVATAR_MAX and objects remain — stated, never assumed swept.
        avatars_found: avatars.length,
        avatars_removed: avatarsRemoved,
        avatars_failed: avatarsFailed.length,
        avatars_truncated: avatarsTruncated,
        // Track C / C2: the open upload reservations closed BEFORE the CASCADE
        // (sweep_open_uploads, 0074; the abandoned paths are on WIL-7012).
        // `reservation_sweep_failed: true` means the sweep did not ANSWER — a
        // database without 0074, or a transport failure — so any open
        // reservation went with the CASCADE uncertified, and the two counts
        // beside it are 0 and mean nothing.
        reservations_abandoned: reservationsAbandoned,
        reservations_completed: reservationsCompleted,
        reservation_sweep_failed: reservationSweepFailed,
        // Track C / C2: the stated limit of blobs_* and thumbnails_*, on the
        // certificate rather than only in §17. Both are ROW-DERIVED (files +
        // storage_gc_queue), plus the product-written reserved objects 2b
        // builds from the project ids: an object whose row never landed — a
        // body or preview put succeeded, the row insert was refused, both
        // compensating deletes best-effort — is neither removed nor counted
        // above. The avatars are the exception: they are listed, not derived.
        thumbnails_note: 'row-derived: rabbit-files and rabbit-thumbnails were swept from files and storage_gc_queue rows plus the product-written reserved objects; a stranded body or preview with no row is neither removed nor counted',
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
      // Track C / C2: the avatar count Audrey's test plan reads ("the
      // certificate's avatar count is 1"), and the reservation sweep's answer.
      avatars_found: avatars.length,
      avatars_removed: avatarsRemoved,
      avatars_failed: avatarsFailed.length,
      avatars_truncated: avatarsTruncated,
      reservations_abandoned: reservationsAbandoned,
      reservations_completed: reservationsCompleted,
      reservation_sweep_failed: reservationSweepFailed,
    })
  }

  // Unreachable: the action enum is validated above.
  return reply({ error: 'unknown_action' }, 400)
})
