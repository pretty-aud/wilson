// =============================================================================
// ai-files Edge Function — the upload half of locked decision #21.
//
// WHY THIS EXISTS
// -----------------------------------------------------------------------------
// On 2026-08-10/11 D.O.G. could not generate a deck at all. ai-proxy returned
// HTTP 546 — the Supabase Edge Runtime killing the worker for exceeding its
// resource ceiling INSTEAD of returning a response. Measured from app_events:
// D.O.G.'s last successful deck (2026-08-03) carried 232,275 input tokens of
// base64 documents; every attempt since logged NO usage row at all, and
// ai-proxy logs one even when a stream is cancelled mid-generation. So the
// worker was dying before it reached Anthropic — while doing `req.json()` on a
// multi-megabyte body and `JSON.stringify()`ing it straight back out.
//
// Neither `effort` nor `max_tokens` can reach that: both govern OUTPUT. The fix
// is to stop pushing whole documents through the Edge worker's JSON body at
// all. Files are uploaded ONCE to Anthropic's Files API and referenced by
// `file_id` thereafter, so the body ai-proxy relays stays a few KB no matter
// how much source material a deck carries — Audrey's constraint, verbatim:
// "do not put a limit to how long it takes or lengths of output or inputs".
//
// -----------------------------------------------------------------------------
// 🚨 THE ONE INVARIANT: NEVER MATERIALISE THE BODY
// -----------------------------------------------------------------------------
// `req.body` is piped straight into the upstream fetch with `duplex: 'half'`.
// Do NOT add `req.json()`, `req.formData()`, `req.arrayBuffer()`, `req.text()`,
// or anything that buffers — every one of them reintroduces exactly the failure
// this function exists to fix, and it will present as a 546 with no log line
// rather than as an error you can read.
//
// The multipart boundary and the `file` field name are built by the client
// (src/cloud/aiFiles.js), so `content-type` is forwarded verbatim. This
// function inspects nothing about the payload; it authenticates the caller,
// attaches the key, and gets out of the way.
//
// -----------------------------------------------------------------------------
// FX12 (2026-10-25, OUTSTANDING DG1-03): LETTING GO OF WHAT WAS UPLOADED
// -----------------------------------------------------------------------------
// Until FX12 nothing deleted an upload: every PDF and picture D.O.G. sent
// stayed in the store under the one organisation key. Two routes sit beside
// the upload, dispatched BEFORE it so the upload's own branch below is
// byte-identical:
//
//   DELETE { file_id } | { file_ids: [...] }   a member lets go of THEIR OWN
//          uploads (D.O.G.: a file removed, a reference untaken, the app
//          closing, a sign-out). An id is deleted only when an upload row of
//          this workspace, written by this caller, names it AND binds to the
//          stored file (_shared/aiFileStore.ts says why a row alone is not
//          proof). Every deletion leaves a certificate row, a 404 included.
//   DELETE { sweep: true }                     a workspace ADMIN (adminGuard,
//          MFA step-up) deletes this workspace's files older than
//          SWEEP_AGE_HOURS: the Admin Terminal's "The AI's file store" card.
//          Never a cron (storage-gc's precedent, TS-1.5): the stated confirm
//          is the second factor. One certificate per file, one for the run.
//   GET                                        what this workspace has stored:
//          ids, times and sizes, never a filename; a member sees their own,
//          an admin the workspace's.
//
// These read a JSON body of a few dozen bytes (readSmallJson, capped), which
// does not touch the invariant above: that is about the UPLOAD's stream.
// The operator's sweep across workspaces is operator-ai-files.
// =============================================================================

import { corsHeaders, reply, requireWorkspaceAdmin } from '../_shared/adminGuard.ts'
import { requireActiveMember, type MemberContext } from '../_shared/memberGuard.ts'
import { isRateLimited, envInt } from '../_shared/rateLimit.ts'
import { decryptAiKey, aiKeyCryptoConfigured } from '../_shared/aiKeyCrypto.ts'
// P8 (TPN-AI-011): the upload's key, decided fail-closed.
import { resolveUploadKey, type ResolvedUploadKey } from '../_shared/aiFilesKey.ts'
import {
  SWEEP_AGE_HOURS, attribute, deleteOutcome, deleteVerdict, filesOfWorkspace, isFileId, isSweepable,
  publicFile, readSmallJson, sweepPlan, totalsOf,
  type KeySource, type StoredFile, type UploadRow,
} from '../_shared/aiFileStore.ts'
import {
  deleteFile, lookupFiles, noteAbsent, pooled, readAbsentNoted, readCertifiedGone, readUploadRows,
  readUploadRowsNaming, writeCertificate,
} from '../_shared/aiFilesUpstream.ts'

type MemberCtxAdmin = MemberContext['admin']

const ANTHROPIC_FILES_URL = 'https://api.anthropic.com/v1/files'
const ANTHROPIC_VERSION = '2023-06-01'
// Required on the upload AND on every messages request that references the
// resulting file_id. The client sends the second one via ai-proxy's `betas`
// passthrough — see src/cloud/aiProxy.js and the callAI body in D.O.G.
const FILES_BETA = 'files-api-2025-04-14'

// Uploads are cheap for Anthropic but not free for us to relay, and a runaway
// client could otherwise pin a worker. Shares AI_PROXY_RPM's default rather
// than inventing a second knob nobody knows exists.
const RPM = envInt('AI_FILES_RPM', envInt('AI_PROXY_RPM', 60))

// ── Key resolution ───────────────────────────────────────────────────────────
// P8 (TPN-AI-011): _shared/aiFilesKey.ts, ai-files' OWN rule, fail-CLOSED.
// Until P8 this was a copy of ai-proxy's resolver, which falls through to the
// platform key on any failure: right for a chat call that spends, wrong for
// a file store, where a company that set its own key chose WHERE its files
// are held (the delete path below, keyForSource, already refused to fall
// back). A company row that will not open is now a refusal with a sentence,
// as storage-presign refuses in the same areas; ai-proxy keeps its copy,
// untouched, by its own instruction. The resolver is pure, so
// src/cloud/aiFilesKey.test.js drives every outcome.
function resolveAnthropicKey(admin: MemberCtxAdmin, workspaceId: string): Promise<ResolvedUploadKey> {
  return resolveUploadKey({
    readRow: () => admin
      .from('workspace_ai_keys')
      .select('key_ciphertext, key_version')
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
    decrypt: (ciphertext) => decryptAiKey(ciphertext),
    cryptoConfigured: aiKeyCryptoConfigured,
    platformKey: Deno.env.get('ANTHROPIC_API_KEY') ?? '',
  })
}

// ── Telemetry ────────────────────────────────────────────────────────────────
// Reuses ai-proxy's WIL-6001/6002 codes deliberately: 0021's `code` CHECK is a
// closed set, and a brand-new code would fail the insert. The `tool` tag
// separates these rows from generation rows.
//
// This exists because the ABSENCE of telemetry is what made the 546 outage take
// three passes to diagnose — a failure that logs nothing is indistinguishable
// from a request that was never made.
async function logUpload(
  admin: MemberCtxAdmin,
  workspaceId: string,
  callerId: string,
  ok: boolean,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    await admin.from('app_events').insert({
      workspace_id: workspaceId,
      actor_user_id: callerId,
      event_type: 'system',
      code: ok ? 'WIL-6001' : 'WIL-6002',
      severity: ok ? 'info' : 'warning',
      message: ok ? 'AI file upload completed' : 'AI file upload failed',
      // Technical metadata only — never filename content or payload bytes (TPN).
      context: { tool: 'ai-files', ...detail },
    })
  } catch { /* telemetry never breaks the request */ }
}

// ── FX12: the routes that let go ─────────────────────────────────────────────

// Only a preflight reads allow-methods, so this 204 is the one place the two
// new methods are named; reply()'s shared headers stay every function's.
const AI_FILES_CORS = {
  ...corsHeaders,
  'access-control-allow-methods': 'POST, GET, DELETE, OPTIONS',
}

/** Ids one delete call may carry: a short list, far under keepalive's 64 KB. */
const DELETE_MAX_IDS = 25
/** Two deletions at a time: the store's file calls share one org-wide limit. */
const SWEEP_CONCURRENCY = 2
/** A member's short list, four at a time: the desktop's close waits for it. */
const DELETE_CONCURRENCY = 4
/**
 * The let-go and list routes' own limit, per caller (review round 1, finding
 * 2). A desktop's close sends one call for up to 25 ids; a person removing
 * files one by one sends one each.
 */
const MANAGE_RPM = envInt('AI_FILES_MANAGE_RPM', 30)
/** Lists per workspace per minute, every member together. */
const LIST_RPM = envInt('AI_FILES_LIST_RPM', 30)

/**
 * The key a stored file lives under — exactly the one its upload row names.
 *
 * NOT resolveAnthropicKey above. That one falls back to the platform key when
 * a tenant key cannot be read, which is right for a call that spends and
 * wrong here: a file uploaded under a tenant's key is not in the platform
 * key's store, the store would answer 404, and a 404 certifies "gone". So a
 * source that cannot be read answers null and nothing is certified as gone.
 * (A key rotated to ANOTHER Anthropic workspace has the same 404 problem and
 * no remedy here: the store cannot tell "deleted" from "not yours".)
 */
async function keyForSource(
  admin: MemberCtxAdmin,
  workspaceId: string,
  source: KeySource,
): Promise<string | null> {
  if (source === 'platform') return Deno.env.get('ANTHROPIC_API_KEY') || null
  try {
    const { data, error } = await admin
      .from('workspace_ai_keys')
      .select('key_ciphertext, key_version')
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (error || !data?.key_ciphertext) return null
    return (await decryptAiKey(data.key_ciphertext as string)) || null
  } catch {
    return null
  }
}

/** The ids a DELETE names, or null when the body is not one of the two shapes. */
function idsOf(body: Record<string, unknown>): string[] | null {
  if (typeof body.file_id === 'string' && !('file_ids' in body)) {
    return isFileId(body.file_id) ? [body.file_id] : null
  }
  if (Array.isArray(body.file_ids) && !('file_id' in body)) {
    const ids = [...new Set(body.file_ids)]
    if (!ids.length || ids.length > DELETE_MAX_IDS || !ids.every(isFileId)) return null
    return ids as string[]
  }
  return null
}

type DeleteResult = { id: string; outcome: 'deleted' | 'gone' | 'not_found' | 'key_unavailable' | 'failed' }

/**
 * DELETE { file_id } | { file_ids }: the caller's own uploads.
 *
 * Looked up FIRST, attributed, then acted on (review round 1, findings 1, 2
 * and note e): ONE `ids[]` lookup per key per request, whatever the number of
 * ids, so a member cannot turn 25 ids into 25 calls on the org-wide file
 * limit, and the function never reads metadata it then has to ignore.
 *
 * `not_found` is the one answer for "no such file", "not this workspace's",
 * "not yours" and "a row that does not bind", AND for "the store has no such
 * id" unless this workspace's own certificate says it deleted the id before
 * (then `gone`): otherwise a forged upload row would turn this route into an
 * oracle for which ids exist under the key, and a "gone" certificate would
 * certify a deletion this workspace never made.
 */
async function deleteOwn(
  ctx: MemberContext,
  ids: string[],
): Promise<{ results: DeleteResult[]; certify_failed: number }> {
  const { admin, workspaceId, callerId } = ctx
  let certifyFailed = 0
  const certify = async (fields: Parameters<typeof writeCertificate>[1]) => {
    if (!(await writeCertificate(admin, fields))) certifyFailed++
  }
  // EVERY workspace's rows naming these ids (the earliest binding row wins,
  // in whichever workspace: aiFileStore.attribute).
  const rows = await readUploadRowsNaming(admin, ids)
  const mineOf = new Map<string, UploadRow>()
  for (const id of ids) {
    const mine = rows
      .filter(r => r.fileId === id && r.workspaceId === workspaceId && r.actorUserId === callerId)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0]
    if (mine) mineOf.set(id, mine)
  }

  // One lookup per key source the caller's rows name.
  const bySource = new Map<KeySource, string[]>()
  for (const [id, row] of mineOf) bySource.set(row.keySource, [...(bySource.get(row.keySource) ?? []), id])
  const keyOfSource = new Map<KeySource, string | null>()
  const stored = new Map<string, StoredFile>()
  const lookupFailed = new Map<string, number>()
  for (const [source, sourceIds] of bySource) {
    const key = await keyForSource(admin, workspaceId, source)
    keyOfSource.set(source, key)
    if (!key) continue
    try {
      for (const f of await lookupFiles(key, sourceIds)) stored.set(f.id, f)
    } catch (err) {
      for (const id of sourceIds) lookupFailed.set(id, (err as { status?: number })?.status ?? 0)
    }
  }
  // Read whether or not anything is missing (review round 2, finding 5): a
  // read only when an id is absent would make "absent" a few tens of
  // milliseconds slower than "present, not yours", which is an oracle too.
  const certified = await readCertifiedGone(admin, workspaceId, [...mineOf.keys()])

  // A few at a time: the desktop app waits for this answer before its window
  // closes (MEASURED, FX12: a keepalive request dies with the app when its
  // preflight takes a round trip), so a short list must answer in about a
  // second, not one file after another.
  const results = await pooled(ids, DELETE_CONCURRENCY, async (id): Promise<DeleteResult> => {
    const mine = mineOf.get(id)
    if (!mine) return { id, outcome: 'not_found' }
    // Nothing was attempted for these two: one row per call says so, below,
    // never one per id (review round 2, finding 4: a forged key_source would
    // otherwise let a member write 25 warnings a call into the admin stream).
    const key = keyOfSource.get(mine.keySource)
    if (!key) return { id, outcome: 'key_unavailable' }
    if (lookupFailed.has(id)) return { id, outcome: 'failed' }
    // The rule (aiFileStore.deleteVerdict): `gone` only when the store lacks
    // the id AND this workspace's own unforgeable certificate says it deleted
    // it before; `not_found` for everything that is not the caller's own.
    const verdict = deleteVerdict(id, { rows, stored, certified, workspaceId, callerId })
    if (verdict === 'not_found') return { id, outcome: 'not_found' }
    if (verdict === 'gone') {
      await certify({
        workspaceId, actorUserId: callerId, ok: true,
        message: 'AI file was already gone from the store',
        context: { stage: 'delete', via: 'member', file_id: id, outcome: 'gone', status: 404, key_source: mine.keySource },
      })
      return { id, outcome: 'gone' }
    }
    const file = stored.get(id)!

    const status = await deleteFile(key, id)
    const outcome = deleteOutcome(status)
    await certify({
      workspaceId, actorUserId: callerId, ok: outcome !== 'failed',
      message: outcome === 'failed' ? 'AI file delete failed' : 'AI file deleted',
      context: { stage: 'delete', via: 'member', file_id: id, outcome, status, key_source: mine.keySource, size_bytes: file.size_bytes },
    })
    return { id, outcome }
  })
  const unread = results.filter(r => r.outcome === 'key_unavailable').map(r => r.id)
  if (unread.length) {
    await certify({
      workspaceId, actorUserId: callerId, ok: false,
      message: 'AI file delete not attempted: the key the files were uploaded under could not be read',
      context: { stage: 'delete_not_attempted', via: 'member', reason: 'key_unavailable', count: unread.length, file_ids: unread.slice(0, DELETE_MAX_IDS) },
    })
  }
  const unasked = results.filter(r => r.outcome === 'failed' && lookupFailed.has(r.id)).map(r => r.id)
  if (unasked.length) {
    await certify({
      workspaceId, actorUserId: callerId, ok: false,
      message: 'AI file delete not attempted: the store could not be read',
      context: { stage: 'delete_not_attempted', via: 'member', reason: 'lookup_failed', status: lookupFailed.get(unasked[0]) ?? 0, count: unasked.length, file_ids: unasked.slice(0, DELETE_MAX_IDS) },
    })
  }
  const refused = results.filter(r => r.outcome === 'not_found').map(r => r.id)
  if (refused.length) {
    // One line per call, never per id. Not an accusation: an upload whose own
    // row never landed (logUpload is best-effort) and a file the store has
    // forgotten land here too. The ids are the caller's own words, so this
    // tells the workspace nothing it did not already say; `stage` keeps it
    // from ever reading as an upload.
    await certify({
      workspaceId, actorUserId: callerId, ok: false, quiet: true,
      message: 'AI file delete: ids no stored upload of this member matches',
      context: { stage: 'delete_refused', via: 'member', count: refused.length, file_ids: refused.slice(0, DELETE_MAX_IDS) },
    })
  }
  return { results, certify_failed: certifyFailed }
}

/** The caller's role from the LIVE row (the token's claim can be stale). */
async function isLiveAdmin(admin: MemberCtxAdmin, workspaceId: string, userId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('workspace_members')
    .select('app_role, is_active')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()
  return !error && !!data?.is_active && data.app_role === 'admin'
}

/**
 * What this workspace has in the store, attributed and bound. `onlyActor` is
 * the caller's id for a member who is not the admin (their own uploads only).
 * `unreachable` counts the rows whose key could not be read: said, not hidden.
 */
async function storedForWorkspace(
  admin: MemberCtxAdmin,
  workspaceId: string,
  onlyActor: string | null,
): Promise<{ files: { file: StoredFile; owner: UploadRow }[]; unreachable: number }> {
  const own = await readUploadRows(admin, workspaceId)
  // An id this workspace's own certificates say is deleted is never asked
  // about again (review round 1, finding 2): the lookups touch only ids that
  // can still be live, not ninety days of every upload.
  // Nor is one the store was already found to lack (review round 2, finding
  // 2): a file that expired by itself is never certified, and would otherwise
  // be asked about on every list for ninety days.
  const gone = await readCertifiedGone(admin, workspaceId, null)
  const absent = await readAbsentNoted(admin, workspaceId)
  const live = own.filter(r => !gone.has(r.fileId) && !absent.has(r.fileId))
  const scoped = onlyActor === null ? live : live.filter(r => r.actorUserId === onlyActor)
  const bySource = new Map<KeySource, string[]>()
  for (const r of scoped) {
    const list = bySource.get(r.keySource) ?? []
    list.push(r.fileId)
    bySource.set(r.keySource, list)
  }
  const files: StoredFile[] = []
  let unreachable = 0
  const missing: string[] = []
  for (const [source, ids] of bySource) {
    const key = await keyForSource(admin, workspaceId, source)
    if (!key) { unreachable += new Set(ids).size; continue }
    // Exactly these ids (`ids[]`), never the key's whole list: another
    // company's metadata, its filenames included, is never even fetched.
    // A source the store will not answer for is counted, not thrown (review
    // round 2, finding 1): the list and the sweep go on for the rest.
    let found: StoredFile[]
    try {
      found = await lookupFiles(key, ids)
    } catch {
      unreachable += new Set(ids).size
      continue
    }
    files.push(...found)
    const have = new Set(found.map(f => f.id))
    missing.push(...ids.filter(id => !have.has(id)))
  }
  if (missing.length) await noteAbsent(admin, workspaceId, missing)
  // A file id that sits under both sources is impossible; dedupe anyway.
  const unique = [...new Map(files.map(f => [f.id, f])).values()]
  const rows = await readUploadRowsNaming(admin, unique.map(f => f.id))
  return { files: filesOfWorkspace(attribute(unique, rows), workspaceId, onlyActor), unreachable }
}

async function handleDelete(req: Request): Promise<Response> {
  const guard = await requireActiveMember(req)
  if (!guard.ok) return guard.res
  const { admin, workspaceId, callerId } = guard.ctx

  // Its own bucket, per caller (review round 1, finding 2): letting go and
  // listing never spend the workspace's upload budget, and one member cannot
  // spend everyone's.
  if (await isRateLimited(admin, 'ai-files-manage', callerId, MANAGE_RPM, 60)) {
    return reply({ error: 'rate_limited' }, 429)
  }

  const body = await readSmallJson(req)
  if (!body) {
    return reply({ error: 'validation_failed', errors: [{ field: 'body', error: 'expected a small JSON object' }] }, 400)
  }

  if (body.sweep === true) {
    if (Object.keys(body).length !== 1) {
      return reply({ error: 'validation_failed', errors: [{ field: 'body', error: 'a sweep takes no other field' }] }, 400)
    }
    // Destruction across the workspace: the admin guard, MFA step-up and all,
    // on top of the member guard above (which only got us here cheaply).
    const adminGuard = await requireWorkspaceAdmin(req)
    if (!adminGuard.ok) return adminGuard.res
    if (adminGuard.ctx.workspaceId !== workspaceId || adminGuard.ctx.callerId !== callerId) {
      return reply({ error: 'forbidden' }, 403)
    }
    return await sweep(admin, workspaceId, callerId)
  }

  const ids = idsOf(body)
  if (!ids) {
    return reply({
      error: 'validation_failed',
      errors: [{ field: 'file_id', error: `one file id, or file_ids: up to ${DELETE_MAX_IDS}` }],
    }, 400)
  }
  try {
    return reply(await deleteOwn(guard.ctx, ids))
  } catch (err) {
    console.error(`[ai-files] delete failed: ${String((err as Error)?.message ?? err)}`)
    return reply({ error: 'delete_failed' }, 500)
  }
}

async function sweep(admin: MemberCtxAdmin, workspaceId: string, callerId: string): Promise<Response> {
  const counts = {
    deleted: 0, gone: 0, failed: 0, skipped_recent: 0, unreachable: 0,
    certify_failed: 0, truncated: false, older_than_hours: SWEEP_AGE_HOURS,
  }
  try {
    const now = Date.now()
    const stored = await storedForWorkspace(admin, workspaceId, null)
    counts.unreachable = stored.unreachable
    const plan = sweepPlan(stored.files, now)
    counts.skipped_recent = plan.recent
    counts.truncated = plan.truncated
    const keys = new Map<KeySource, string | null>()
    let stop = false
    const done = await pooled(plan.take, SWEEP_CONCURRENCY, async ({ file, owner }) => {
      if (stop) return 'skipped' as const
      if (!keys.has(owner.keySource)) keys.set(owner.keySource, await keyForSource(admin, workspaceId, owner.keySource))
      const key = keys.get(owner.keySource)
      if (!key) return 'unreachable' as const
      const status = await deleteFile(key, file.id)
      // The store's limit is everyone's: a 429 ends this run, and what is
      // left waits for the next click rather than hammering it.
      if (status === 429) stop = true
      const outcome = deleteOutcome(status)
      const landed = await writeCertificate(admin, {
        workspaceId, actorUserId: callerId, ok: outcome !== 'failed',
        message: outcome === 'failed' ? 'AI file delete failed (sweep)' : 'AI file deleted (sweep)',
        context: { stage: 'delete', via: 'sweep', file_id: file.id, outcome, status, key_source: owner.keySource, size_bytes: file.size_bytes },
      })
      if (!landed) counts.certify_failed++
      return outcome
    })
    for (const o of done) {
      if (o === 'deleted') counts.deleted++
      else if (o === 'gone') counts.gone++
      else if (o === 'failed') counts.failed++
      else if (o === 'unreachable') counts.unreachable++
    }
    if (stop) counts.truncated = true
    const after = await storedForWorkspace(admin, workspaceId, null)
    const totals = totalsOf(after.files.map(f => f.file))
    await writeCertificate(admin, {
      workspaceId, actorUserId: callerId, ok: counts.failed === 0,
      message: 'AI file store sweep completed',
      context: { stage: 'sweep', via: 'sweep', ...counts, remaining: totals.count },
    })
    return reply({
      ok: true,
      counts,
      after: { ...totals, sweepable: after.files.filter(f => isSweepable(f.file, Date.now())).length },
    })
  } catch (err) {
    const message = String((err as Error)?.message ?? err).slice(0, 300)
    await writeCertificate(admin, {
      workspaceId, actorUserId: callerId, ok: false,
      message: 'AI file store sweep failed part-way',
      context: { stage: 'sweep', via: 'sweep', ...counts, detail: message },
    })
    return reply({ error: 'sweep_failed', counts }, 500)
  }
}

async function handleList(req: Request): Promise<Response> {
  const guard = await requireActiveMember(req)
  if (!guard.ok) return guard.res
  const { admin, workspaceId, callerId } = guard.ctx

  // Its own bucket, per caller (review round 1, finding 2): letting go and
  // listing never spend the workspace's upload budget, and one member cannot
  // spend everyone's.
  if (await isRateLimited(admin, 'ai-files-manage', callerId, MANAGE_RPM, 60)) {
    return reply({ error: 'rate_limited' }, 429)
  }
  // And one for the whole workspace (review round 2, finding 2): every
  // member's lists together stay a bounded share of the org-wide file limit.
  if (await isRateLimited(admin, 'ai-files-list', workspaceId, LIST_RPM, 60)) {
    return reply({ error: 'rate_limited' }, 429)
  }

  try {
    const isAdmin = await isLiveAdmin(admin, workspaceId, callerId)
    const now = Date.now()
    const stored = await storedForWorkspace(admin, workspaceId, isAdmin ? null : callerId)
    const files = stored.files.map(f => f.file)
    return reply({
      scope: isAdmin ? 'workspace' : 'own',
      older_than_hours: SWEEP_AGE_HOURS,
      ...totalsOf(files),
      sweepable: files.filter(f => isSweepable(f, now)).length,
      unreachable: stored.unreachable,
      files: files
        .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
        .map(f => publicFile(f, now)),
    })
  } catch (err) {
    console.error(`[ai-files] list failed: ${String((err as Error)?.message ?? err)}`)
    return reply({ error: 'list_failed' }, 502)
  }
}

// ── Handler ──────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: AI_FILES_CORS })
  }
  // FX12: dispatched before the upload, so everything below is unchanged.
  if (req.method === 'DELETE') return await handleDelete(req)
  if (req.method === 'GET') return await handleList(req)
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405)

  const guard = await requireActiveMember(req)
  if (!guard.ok) return guard.res
  const { admin, workspaceId, callerId } = guard.ctx

  if (await isRateLimited(admin, 'ai-files', workspaceId, RPM, 60)) {
    return reply({ error: 'rate_limited' }, 429)
  }

  // The multipart boundary lives in this header. Without it the upstream
  // cannot parse the stream, so a missing content-type is a client bug worth
  // naming rather than forwarding into an opaque upstream 400.
  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return reply({
      error: 'validation_failed',
      errors: [{ field: 'content-type', error: 'expected multipart/form-data' }],
    }, 400)
  }
  if (!req.body) {
    return reply({
      error: 'validation_failed',
      errors: [{ field: 'body', error: 'required' }],
    }, 400)
  }

  const resolved = await resolveAnthropicKey(admin, workspaceId)
  if (!resolved.ok) {
    // P8 (TPN-AI-011): fail CLOSED with a sentence — a company's own key that
    // will not open is a refusal (500 secret_unusable, 503 key_read_failed or
    // crypto_unavailable), never a re-route of the file to the platform's
    // store; no key: 501 ai_not_configured, as ai-proxy answers it (a
    // permanent state, so no client retry loop treats it as transient).
    await logUpload(admin, workspaceId, callerId, false, { stage: 'key', error: resolved.error })
    return reply({ error: resolved.error, detail: resolved.detail }, resolved.status)
  }

  let upstream: Response
  try {
    upstream = await fetch(ANTHROPIC_FILES_URL, {
      method: 'POST',
      headers: {
        'content-type': contentType,
        'x-api-key': resolved.key,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-beta': FILES_BETA,
      },
      // 🚨 The whole point. `req.body` is a ReadableStream and is forwarded
      // without ever being read into memory here. `duplex: 'half'` is REQUIRED
      // to send a stream body — without it the runtime throws before the
      // request leaves, and the fix looks like an unrelated network error.
      body: req.body,
      // deno-lint-ignore no-explicit-any
      duplex: 'half',
      signal: req.signal,
    } as RequestInit & { duplex: 'half' })
  } catch (err) {
    await logUpload(admin, workspaceId, callerId, false, {
      key_source: resolved.source,
      stage: 'upstream_fetch',
      detail: String((err as Error)?.message ?? err).slice(0, 200),
    })
    return reply({ error: 'upstream_unreachable' }, 502)
  }

  // Anthropic's response is small JSON either way, so reading it here is safe —
  // this is the one body in this function that is allowed to be materialised.
  const json = await upstream.json().catch(() => ({}))

  if (!upstream.ok) {
    await logUpload(admin, workspaceId, callerId, false, {
      key_source: resolved.source,
      stage: 'upstream_error',
      status: upstream.status,
    })
    // Forward the status verbatim so client retry loops keep working, and keep
    // Anthropic's own shape under `anthropic` exactly as ai-proxy does.
    return reply({ error: 'upstream_error', anthropic: json }, upstream.status || 502)
  }

  await logUpload(admin, workspaceId, callerId, true, {
    key_source: resolved.source,
    file_id: (json as Record<string, unknown>)?.id ?? null,
    size_bytes: (json as Record<string, unknown>)?.size_bytes ?? null,
    mime_type: (json as Record<string, unknown>)?.mime_type ?? null,
  })

  return reply(json as Record<string, unknown>, 200)
})
