// =============================================================================
// _shared/teardownCollect.ts — P8 (night 5, 2026-10-28), TPN-CONT-018: what a
// workspace's teardown must remove, collected BEFORE anything is destroyed.
//
// operator-workspaces/index.ts (S15 onward) held these three collectors and
// their constants beside Deno.serve, so no test could drive them: the S39
// thumbnail blind spot and the S44 provider mistake were both caught by
// reading, not by a run. They are here now, VERBATIM but for the posters'
// listing, pure over the client they are handed (readUrls.ts's arrangement:
// no Deno.*, no network import), so vitest imports this exact file and runs
// them against a fake client (src/cloud/teardownCollect.test.js). index.ts
// calls them exactly as before and removes what they return.
//
// What collectBlobPaths returns, and from where:
//   paths     rabbit-files bodies this tenant owns, from public.files
//             (storage_provider 'supabase') and the pending storage_gc_queue
//   rejected  paths a row named outside the tenant's own projects (never removed)
//   reserved  the product-written objects no row names (reservedObjects.ts)
//   thumbs    rabbit-thumbnails previews this tenant owns, from files
//             (every provider but s3) and the queue — AND, since P8, the bin
//             clips' posters under projects/{id}/bin_files/, LISTED by prefix
//             (TPN-CONT-018: a poster is named only by bin_files.poster_path,
//             which no sweep read; the CASCADE's own trigger queued it only
//             for the queue to be deleted)
//   byoLeft, byoThumbsLeft   what is deliberately LEFT in a customer's own
//             bucket, counted (NULL when the count failed, never 0)
//   binPostersListed, binPostersTruncated   how many posters the listing
//             found, and whether it stopped at its budget
// =============================================================================

import { reservedProjectObjectPaths } from './reservedObjects.ts'

/** The client the collectors read through: the operator's service-role client. */
// deno-lint-ignore no-explicit-any
export type TeardownClient = { admin: any }

export const BUCKET = 'rabbit-files'
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
export const THUMBNAIL_BUCKET = 'rabbit-thumbnails'
export const PAGE = 1000          // PostgREST max_rows; read in exactly one page's worth

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
export const AVATAR_BUCKET = 'user-avatars'
export const LIST_PAGE = 100      // storage.list() page (the API's own default)
export const AVATAR_MAX = 5000    // objects per teardown; past it the scan STOPS AND SAYS SO
/** Bin posters listed per teardown (P8); past it the walk STOPS AND SAYS SO. */
export const BIN_POSTERS_MAX = 20000

/** One folder level of a bucket, every page. Folders come back with id: null. */
export async function listFolder(
  ctx: TeardownClient,
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
export async function collectAvatarPaths(
  ctx: TeardownClient,
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
export async function collectBlobPaths(
  ctx: TeardownClient,
  workspaceId: string,
  opts: { binPostersMax?: number } = {},
): Promise<{ paths: string[]; rejected: string[]; reserved: string[]; thumbs: string[]; byoLeft: number | null; byoThumbsLeft: number | null; binPostersListed: number; binPostersTruncated: boolean }> {
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

  // P8 (TPN-CONT-018): the bin clips' POSTERS. A poster is named only by
  // bin_files.poster_path, which no sweep read, and the CASCADE's own trigger
  // (trg_bin_files_gc_enqueue) queues it only for step 4 to delete the queue —
  // so every poster of every torn-down tenant stayed in rabbit-thumbnails,
  // unrecorded. Listed by PREFIX (the avatars' model; 0091's poster_path
  // CHECK pins every key under projects/{id}/bin_files/): the objects two
  // levels down, for every project this workspace provably owns, budgeted
  // (binPostersTruncated says when the walk stopped), a failing listing
  // THROWING so the teardown refuses — after the CASCADE nothing can
  // re-derive the set. They join `thumbs`, which step 2c removes before
  // the CASCADE and WIL-7005 counts.
  let binPostersListed = 0
  let binPostersTruncated = false
  const binPostersMax = opts.binPostersMax ?? BIN_POSTERS_MAX
  for (const projectId of projectIds) {
    if (binPostersTruncated) break
    const walkPosters = async (prefix: string, depth: number): Promise<void> => {
      if (binPostersTruncated) return
      const entries = await listFolder(ctx, THUMBNAIL_BUCKET, prefix)
      for (const e of entries) {
        if (binPostersTruncated) return
        const path = `${prefix}/${e.name}`
        if (e.id === null) {
          if (depth >= 3) { binPostersTruncated = true; return }
          await walkPosters(path, depth + 1)
        } else {
          if (binPostersListed >= binPostersMax) { binPostersTruncated = true; return }
          binPostersListed++
          if (owned(path)) thumbs.add(path)
        }
      }
    }
    await walkPosters(`projects/${projectId}/bin_files`, 1)
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
    binPostersListed, binPostersTruncated,
  }
}
