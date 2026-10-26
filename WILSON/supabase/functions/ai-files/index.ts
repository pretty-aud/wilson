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
import { decryptAiKey } from '../_shared/aiKeyCrypto.ts'
import {
  SWEEP_AGE_HOURS, attribute, deleteOutcome, filesOfWorkspace, isFileId, isSweepable,
  publicFile, readSmallJson, sweepPlan, totalsOf,
  type KeySource, type StoredFile, type UploadRow,
} from '../_shared/aiFileStore.ts'
import {
  deleteFile, fileMetadata, lookupFiles, pooled, readUploadRows, readUploadRowsNaming,
  writeCertificate,
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
// 🚨 DUPLICATED FROM ai-proxy/index.ts ON PURPOSE. Keep the two in step.
//
// It is not shared through _shared/ because that would require redeploying
// ai-proxy, and on 2026-08-11 ai-proxy was measured byte-identical to this
// repo on all three environments while being the ONLY working AI path in the
// product (O.T.T.E.R. runs through it). Preserving that identity was worth ~20
// duplicated lines. If you ever do extract this, extract it for both callers in
// one commit and redeploy both — a half-migration is worse than the copy.
//
// Same fail-soft rule as the original: any failure reading the per-workspace
// key falls through to the platform key rather than failing the request. A
// tenant key is a billing preference, not an authorization boundary.
async function resolveAnthropicKey(
  admin: MemberCtxAdmin,
  workspaceId: string,
): Promise<{ key: string; source: 'workspace' | 'platform' } | null> {
  try {
    const { data, error } = await admin
      .from('workspace_ai_keys')
      .select('key_ciphertext, key_version')
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (!error && data?.key_ciphertext) {
      const plain = await decryptAiKey(data.key_ciphertext as string)
      if (plain) return { key: plain, source: 'workspace' }
    }
  } catch { /* fall through to platform key */ }
  const platform = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
  return platform ? { key: platform, source: 'platform' } : null
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
 * `not_found` is the one answer for "no such file", "not this workspace's",
 * "not yours" and "a row that does not bind": the route is no oracle for
 * which ids exist elsewhere.
 */
async function deleteOwn(
  ctx: MemberContext,
  ids: string[],
): Promise<DeleteResult[]> {
  const { admin, workspaceId, callerId } = ctx
  // EVERY workspace's rows naming these ids, so a file two workspaces' rows
  // claim is seen as contested rather than taken by whichever asked first.
  const rows = await readUploadRowsNaming(admin, ids)
  // Each source's key read once per call, not once per id.
  const keys = new Map<KeySource, Promise<string | null>>()
  const keyOf = (source: KeySource) => {
    if (!keys.has(source)) keys.set(source, keyForSource(admin, workspaceId, source))
    return keys.get(source)!
  }

  // A few at a time: the desktop app waits for this answer before its window
  // closes (MEASURED, FX12: a keepalive request dies with the app when its
  // preflight takes a round trip), so a short list must answer in about a
  // second, not one file after another.
  const results = await pooled(ids, DELETE_CONCURRENCY, async (id): Promise<DeleteResult> => {
    const named = rows.filter(r => r.fileId === id)
    const mine = named
      .filter(r => r.workspaceId === workspaceId && r.actorUserId === callerId)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0]
    if (!mine) return { id, outcome: 'not_found' }

    const key = await keyOf(mine.keySource)
    if (!key) {
      await writeCertificate(admin, {
        workspaceId, actorUserId: callerId, ok: false,
        message: 'AI file delete could not read the key the file was uploaded under',
        context: { stage: 'delete', via: 'member', file_id: id, outcome: 'key_unavailable', key_source: mine.keySource },
      })
      return { id, outcome: 'key_unavailable' }
    }

    let file: StoredFile | null
    try {
      file = await fileMetadata(key, id)
    } catch (err) {
      await writeCertificate(admin, {
        workspaceId, actorUserId: callerId, ok: false,
        message: 'AI file delete could not read the stored file',
        context: { stage: 'delete', via: 'member', file_id: id, outcome: 'failed', status: (err as { status?: number })?.status ?? 0, key_source: mine.keySource },
      })
      return { id, outcome: 'failed' }
    }
    if (!file) {
      // The store has no such file (deleted before, or expired and gone):
      // certified as gone, so "no row" never means "never asked".
      await writeCertificate(admin, {
        workspaceId, actorUserId: callerId, ok: true,
        message: 'AI file was already gone from the store',
        context: { stage: 'delete', via: 'member', file_id: id, outcome: 'gone', status: 404, key_source: mine.keySource },
      })
      return { id, outcome: 'gone' }
    }
    const verdict = attribute([file], named)[0]
    if (verdict.kind !== 'attributed' || verdict.owner.workspaceId !== workspaceId || verdict.owner.actorUserId !== callerId) {
      return { id, outcome: 'not_found' }
    }

    const status = await deleteFile(key, id)
    const outcome = deleteOutcome(status)
    await writeCertificate(admin, {
      workspaceId, actorUserId: callerId, ok: outcome !== 'failed',
      message: outcome === 'failed' ? 'AI file delete failed' : 'AI file deleted',
      context: { stage: 'delete', via: 'member', file_id: id, outcome, status, key_source: mine.keySource, size_bytes: file.size_bytes },
    })
    return { id, outcome }
  })
  const refused = results.filter(r => r.outcome === 'not_found').map(r => r.id)
  if (refused.length) {
    // One line per refused call, never per id: a refusal is worth seeing
    // (someone asked for ids that are not theirs), and the ids are the
    // caller's own words, so writing them here tells this workspace nothing
    // it did not already say. `stage` keeps it from ever reading as an upload.
    await writeCertificate(admin, {
      workspaceId, actorUserId: callerId, ok: false,
      message: 'AI file delete refused for ids this member did not upload',
      context: { stage: 'delete_refused', via: 'member', count: refused.length, file_ids: refused.slice(0, DELETE_MAX_IDS) },
    })
  }
  return results
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
  const scoped = onlyActor === null ? own : own.filter(r => r.actorUserId === onlyActor)
  const bySource = new Map<KeySource, string[]>()
  for (const r of scoped) {
    const list = bySource.get(r.keySource) ?? []
    list.push(r.fileId)
    bySource.set(r.keySource, list)
  }
  const files: StoredFile[] = []
  let unreachable = 0
  for (const [source, ids] of bySource) {
    const key = await keyForSource(admin, workspaceId, source)
    if (!key) { unreachable += new Set(ids).size; continue }
    // Exactly these ids (`ids[]`), never the key's whole list: another
    // company's metadata, its filenames included, is never even fetched.
    files.push(...await lookupFiles(key, ids))
  }
  // A file id that sits under both sources is impossible; dedupe anyway.
  const unique = [...new Map(files.map(f => [f.id, f])).values()]
  const rows = await readUploadRowsNaming(admin, unique.map(f => f.id))
  return { files: filesOfWorkspace(attribute(unique, rows), workspaceId, onlyActor), unreachable }
}

async function handleDelete(req: Request): Promise<Response> {
  const guard = await requireActiveMember(req)
  if (!guard.ok) return guard.res
  const { admin, workspaceId, callerId } = guard.ctx

  if (await isRateLimited(admin, 'ai-files', workspaceId, RPM, 60)) {
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
    return reply({ results: await deleteOwn(guard.ctx, ids) })
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
        workspaceId, actorUserId: callerId, ok: outcome !== 'failed', eventType: 'admin',
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
      workspaceId, actorUserId: callerId, ok: counts.failed === 0, eventType: 'admin',
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
      workspaceId, actorUserId: callerId, ok: false, eventType: 'admin',
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

  if (await isRateLimited(admin, 'ai-files', workspaceId, RPM, 60)) {
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
  if (!resolved) {
    // 501 not 503, matching ai-proxy: a missing key is a permanent config
    // state, and every client retry loop treats 503 as transient.
    return reply({ error: 'ai_not_configured' }, 501)
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
