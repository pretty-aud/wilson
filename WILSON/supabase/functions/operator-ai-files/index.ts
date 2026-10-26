// =============================================================================
// operator-ai-files — FX12 (post-overhaul, 2026-10-25, OUTSTANDING DG1-03)
//
// The operator's half of the AI file store's clean-up. ai-files lets a member
// delete their own uploads and a workspace admin sweep their workspace's; this
// is the same sweep across EVERY workspace of THIS environment, for the
// platform operator (/wilsonadmin), and the counts that tell the operator what
// the platform key's store holds. Two actions:
//
//   summary  the platform key's whole list (every page) against this
//            environment's upload rows, as COUNTS: all, attributed (with how
//            many companies and how many are past the sweep's age), no row,
//            unbound, expired. Never an id, never a company's name, never a
//            filename.
//   sweep    deletes the attributed files past SWEEP_AGE_HOURS, oldest first,
//            at most SWEEP_MAX_DELETES a run. One certificate per file in the
//            OWNING company's app_events (so its admin reads in Logs that the
//            operator swept it), one platform_audit row for the run.
//
// 🚨 FILES NO ROW OF THIS ENVIRONMENT NAMES ARE LEFT ALONE. The platform key
// backs wilson-dev, wilson-staging and wilson-prod; its list is the union.
// A file this environment has no upload row for is another environment's (or
// one whose row the 90-day app_events purge took): it is counted and never
// touched. The other environment's own sweep deletes its own. A row that names
// a file but does not bind to it (_shared/aiFileStore.ts: a member can insert
// app_events rows) is counted as `unbound` and left alone too. Where rows of
// several companies bind, the earliest wins (a forger cannot be earlier).
//
// Each company's certificate names the operator as its actor (`via:
// 'operator'`), as storage-gc's do for the admin who ran it: the company's
// admin reads in Logs that the operator swept its files, and who.
//
// Only the PLATFORM key's store is read. A company's own Anthropic key holds
// that company's uploads (and possibly its other work, which WILSON must never
// touch); its admin sweeps those from the Admin Terminal. The operator does
// not decrypt tenants' keys to look.
//
// Admin-invoked by design, never a cron (storage-gc's precedent: TS-1.5's
// second factor is a person clicking a stated confirm; a GitHub schedule
// would run only from the default branch, gap #24).
//
// verify_jwt = false + requirePlatformOperator (MFA hard), as every operator-*
// function.
// =============================================================================

import {
  corsHeaders,
  reply,
  requirePlatformOperator,
  logPlatformEvent,
} from '../_shared/operatorGuard.ts'
import { isRateLimited, envInt } from '../_shared/rateLimit.ts'
import {
  SWEEP_AGE_HOURS, attribute, deleteOutcome, operatorCounts, readSmallJson, sweepPlan,
  type Attribution, type StoredFile, type UploadRow,
} from '../_shared/aiFileStore.ts'
import { deleteFile, listAllFiles, pooled, readUploadRows, writeCertificate } from '../_shared/aiFilesUpstream.ts'

const SWEEP_CONCURRENCY = 2

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405)

  const guard = await requirePlatformOperator(req)
  if (!guard.ok) return guard.res
  const ctx = guard.ctx

  const body = await readSmallJson(req)
  if (!body) return reply({ error: 'bad_json' }, 400)
  const action = typeof body.action === 'string' ? body.action : ''
  if (action !== 'summary' && action !== 'sweep') {
    return reply({ error: 'validation_failed', errors: [{ field: 'action', error: 'unknown' }] }, 400)
  }

  const limited = await isRateLimited(
    ctx.admin, 'operator-write', ctx.callerId, envInt('OPERATOR_WRITE_RPM', 20), 60,
  )
  if (limited) return reply({ error: 'rate_limited' }, 429)

  const key = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
  // 501 not 503, as ai-proxy: a missing key is a permanent config state.
  if (!key) return reply({ error: 'ai_not_configured' }, 501)

  /** The store and this environment's rows, attributed. */
  async function read() {
    const listing = await listAllFiles(key)
    // EVERY workspace's upload rows of this environment, platform-key ones:
    // a tenant-key upload is not in this store, whatever a row claims.
    const rows = (await readUploadRows(ctx.admin, null)).filter((r: UploadRow) => r.keySource === 'platform')
    return { listing, attributions: attribute(listing.files, rows) }
  }

  if (action === 'summary') {
    try {
      const { listing, attributions } = await read()
      return reply({
        older_than_hours: SWEEP_AGE_HOURS,
        counts: operatorCounts(attributions, Date.now()),
        pages: listing.pages,
        truncated: listing.truncated,
        malformed: listing.malformed,
      })
    } catch (err) {
      console.error(`[operator-ai-files] summary failed: ${String((err as Error)?.message ?? err)}`)
      return reply({ error: 'ai_files_read_failed' }, 502)
    }
  }

  // ── sweep ─────────────────────────────────────────────────────────────────
  const counts = {
    deleted: 0, gone: 0, failed: 0, skipped_recent: 0, certify_failed: 0,
    workspaces: 0, truncated: false, older_than_hours: SWEEP_AGE_HOURS,
  }
  try {
    const { listing, attributions } = await read()
    const owned = attributions
      .filter((a): a is Extract<Attribution, { kind: 'attributed' }> => a.kind === 'attributed')
      .map(a => ({ file: a.file as StoredFile, owner: a.owner }))
    const plan = sweepPlan(owned, Date.now())
    counts.skipped_recent = plan.recent
    counts.truncated = plan.truncated || listing.truncated
    let stop = false
    const touched = new Set<string>()
    const done = await pooled(plan.take, SWEEP_CONCURRENCY, async ({ file, owner }) => {
      if (stop) return 'skipped' as const
      const status = await deleteFile(key, file.id)
      if (status === 429) stop = true
      const outcome = deleteOutcome(status)
      touched.add(owner.workspaceId)
      const landed = await writeCertificate(ctx.admin, {
        workspaceId: owner.workspaceId, actorUserId: ctx.callerId, ok: outcome !== 'failed',
        message: outcome === 'failed' ? 'AI file delete failed (operator sweep)' : 'AI file deleted (operator sweep)',
        context: { stage: 'delete', via: 'operator', file_id: file.id, outcome, status, key_source: 'platform', size_bytes: file.size_bytes },
      })
      if (!landed) counts.certify_failed++
      return outcome
    })
    for (const o of done) {
      if (o === 'deleted') counts.deleted++
      else if (o === 'gone') counts.gone++
      else if (o === 'failed') counts.failed++
    }
    if (stop) counts.truncated = true
    counts.workspaces = touched.size
    const after = await read()
    const afterCounts = operatorCounts(after.attributions, Date.now())
    await logPlatformEvent(ctx, {
      // 'blob.purged' is the platform verb for stored objects deleted; the
      // CHECK on platform_audit.action is a closed set (0028 / 0031 / 0055 /
      // 0066), so this reuses it with the tool and stage named, as ai-files
      // reuses WIL-6001 / 6002 for 0021's.
      action: 'blob.purged',
      code: counts.failed === 0 ? 'WIL-6001' : 'WIL-6002',
      severity: counts.failed === 0 ? 'info' : 'warning',
      message: `AI file store sweep: ${counts.deleted} deleted, ${counts.gone} already gone, ${counts.failed} failed, across ${counts.workspaces} compan${counts.workspaces === 1 ? 'y' : 'ies'}`,
      context: { tool: 'ai-files', stage: 'operator-sweep', ...counts, remaining_attributed: afterCounts.attributed.count, left_alone: afterCounts.no_row.count + afterCounts.unbound.count },
    })
    return reply({ ok: true, counts, after: afterCounts })
  } catch (err) {
    const message = String((err as Error)?.message ?? err).slice(0, 300)
    await logPlatformEvent(ctx, {
      action: 'blob.purged',
      code: 'WIL-6002',
      severity: 'error',
      message: 'AI file store sweep failed part-way',
      context: { tool: 'ai-files', stage: 'operator-sweep', ...counts, detail: message },
    })
    return reply({ error: 'sweep_failed', counts }, 500)
  }
})
