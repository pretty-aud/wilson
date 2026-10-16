// =============================================================================
// connectionStatus.js — what the connection dot in R.A.B.B.I.T.'s bottom-left
// corner says, and the probe it says it from. Post-overhaul FX11, 2026-10-16.
//
// Audrey, verbatim: "move the live dot to the bottom left corner of the window
// right above the orange bar … to confirm this green dot should clarify that
// the system is connected to the storage solution not just the databases on
// supabase". Her answers (asked as multiple choice, the same day):
//   * What it tells: "Everything is connected" — green when both the WILSON
//     database and the file storage answer; amber when the database works
//     but the storage does not (files cannot open or save); red when offline;
//     hovering says each part in words.
//   * Which storage: "Where your files are kept" — the storage the company
//     chose for its files (Petal cloud, its own bucket, the Local Server or
//     NAS). The Bins tab keeps its own per-location words for footage shares.
//
// Pure: every network call is a dependency the caller passes in, so the whole
// file runs under a test with fakes (connectionStatus.test.js).
//
// ── What was there before, measured (FX11 hand-off §2) ──────────────────────
// The project bar's adapter dot was `adapterStatus.online`: ONE PostgREST count
// of `projects` (supabaseAdapter.status), taken at boot, on an auth event, on
// an adapter switch and on a projects refresh — never again, so it stayed
// green after the network went. Nothing anywhere asked the file storage:
// Petal cloud's describe() answers `reachable: true` without a request, and
// the Local Server's GET /local-media creates the folder it reports.
//
// ── The rules this module keeps ─────────────────────────────────────────────
// 1. `fetch` RESOLVES for every status. An answer reads `res.ok`; a 401/403
//    is "not answering for you", never "connected" (answerOfResponse).
// 2. Every check is BOUNDED and ABORTABLE (bounded): an AbortController
//    whose signal reaches the fetch, aborted at the time-out, not a race that
//    leaves the request running (withTimeout races but never aborts —
//    OUTSTANDING's auth-js lock entry).
// 3. No check calls into auth-js. An abandoned getSession() keeps auth-js's
//    global lock, and every later auth operation queues behind it with no
//    acquire time-out. So the cloud checks are plain `fetch` with the access
//    token the caller read from an auth EVENT (the hook keeps the latest one)
//    — never supabase-js, never presignStorage's own getSession.
// 4. The storage check is a real round trip to where the files are kept, never
//    inferred from the database: on Petal cloud, a HEAD of one of the open
//    project's files (else a list of one object of the files bucket); a
//    company bucket is asked about one object through the presign function
//    (a real file of the project where there is one: R1-1); the Local Server
//    and a NAS are asked by the desktop's own GET /api/rabbit/connection
//    (electron/connectionProbe.cjs), which stats the files root.
// =============================================================================

import { activeWorkspaceProvider, WORKSPACE_PROVIDERS } from '../storage/index.js'

/** One probe's ceiling. A check still pending then is aborted. */
export const CONNECTION_TIMEOUT_MS = 6000
/** How often the dot asks again while R.A.B.B.I.T. is on screen. */
export const CONNECTION_EVERY_MS = 60_000
/** Coming back to R.A.B.B.I.T. asks again only if the last answer is older. */
export const CONNECTION_FRESH_MS = 15_000
/** How long the company's storage choice is trusted before it is read again. */
export const STORAGE_CHOICE_FRESH_MS = 10 * 60_000

/** The private bucket project files live in on Petal cloud (supabaseProvider). */
export const FILES_BUCKET = 'rabbit-files'
/** The desktop's own answer for the Local Server and a NAS root. */
export const LOCAL_CONNECTION_ROUTE = '/api/rabbit/connection'

// Where the files are kept, in the words the hover text uses.
export const FILES_PLACE = Object.freeze({
  petal:   'Petal cloud',
  s3:      "your company's own bucket",
  network: "your company's server or NAS",
  drive:   'Google Drive',
  // The Local Server's files root, by what it is (connectionProbe.cjs `kind`).
  demo:    'the open demo folder',
  machine: "this computer's files folder",
  app:     'this computer',
})

// connectionProbe.cjs's `kind` → the place's words. `workspace` is the
// company's root (a NAS or a server share), the same place as a cloud
// workspace's `network` provider.
const LOCAL_KIND_PLACE = Object.freeze({
  demo: FILES_PLACE.demo, workspace: FILES_PLACE.network, machine: FILES_PLACE.machine, app: FILES_PLACE.app,
})

// ── 1. One answer ───────────────────────────────────────────────────────────
// An answer is { ok: true } or { ok: false, why } (or ok: null when there was
// nothing to ask), plus the place it is about where the place is known.

/**
 * A fetch Response, read. `missingIsAnswer`: a 404 means the store answered
 * and the object is not there (a bucket asked for one object) — the store is
 * up, so that is an answer, not a fault.
 */
export function answerOfResponse(res, { missingIsAnswer = false } = {}) {
  if (!res || typeof res.status !== 'number') return { ok: false, why: 'unreachable' }
  if (res.ok) return { ok: true }
  if (res.status === 404 && missingIsAnswer) return { ok: true }
  if (res.status === 401 || res.status === 403) return { ok: false, why: 'refused', status: res.status }
  return { ok: false, why: 'error', status: res.status }
}

/**
 * Run `check(signal)` with a ceiling. Resolves with what the check resolved
 * with, or a failure answer — never rejects. At the ceiling the signal the
 * check was given is ABORTED (rule 2) and the answer is `timeout`; an abort
 * from outside (the dot unmounting, a newer probe) answers `cancelled`, which
 * the caller drops.
 */
export async function bounded(check, { timeoutMs = CONNECTION_TIMEOUT_MS, signal = null, timers = globalThis } = {}) {
  const ctl = new AbortController()
  // An abort from outside settles at once (`cancelled`), whether or not the
  // check heeds its signal.
  let cancel = () => {}
  const cancelled = new Promise((resolve) => { cancel = () => resolve({ ok: false, why: 'cancelled' }) })
  const fromOutside = () => { ctl.abort(); cancel() }
  if (signal) {
    if (signal.aborted) fromOutside()
    else signal.addEventListener('abort', fromOutside, { once: true })
  }
  let timedOut = false
  let timer = null
  const ceiling = new Promise((resolve) => {
    timer = timers.setTimeout(() => {
      timedOut = true
      ctl.abort()
      resolve({ ok: false, why: 'timeout' })
    }, timeoutMs)
  })
  const run = Promise.resolve()
    .then(() => check(ctl.signal))
    .then(
      (value) => value,
      () => (timedOut ? { ok: false, why: 'timeout' } : ctl.signal.aborted ? { ok: false, why: 'cancelled' } : { ok: false, why: 'unreachable' }),
    )
  try {
    return await Promise.race([run, ceiling, cancelled])
  } finally {
    timers.clearTimeout(timer)
    signal?.removeEventListener?.('abort', fromOutside)
  }
}

// ── 2. Which backend, and where its files are ──────────────────────────────

/**
 * 'fixtures' | 'cloud' | 'local' | 'drive' | 'pending' | null (no backend
 * set up). 'pending': a mode is named but its adapter is not built yet — the
 * provider's first render, before its boot effect: its mode is the DEFAULT
 * (the Local Server) whatever the boot then picks, so asking anything then
 * would ask the wrong backend and announce a change that never happened.
 */
export function adapterKindOf(adapterMode, adapter) {
  if (!adapterMode) return null
  if (!adapter) return 'pending'
  if (adapter.mode === 'fixtures') return 'fixtures'
  if (adapterMode === 'supabase') return 'cloud'
  if (adapterMode === 'local_server') return 'local'
  if (adapterMode === 'google_drive') return 'drive'
  return null
}

// The money segments (public.rabbit_money_segment, 0042 + 0088;
// supabase/functions/_shared/moneySegments.ts): a body under one is gated by
// the money and Legal rules, so it is never the one the dot reads.
const MONEY_SEGMENTS = ['INVOICES', 'FINANCE', 'LEGAL']
function readableFileOf(files, provider, projectId) {
  return (files || []).find(f => f && f.storage_provider === provider && f.storage_path && !f.deleted_at
    && !f.is_financial && (!projectId || f.project_id === projectId)
    && !MONEY_SEGMENTS.includes(String(f.storage_path.split('/')[2] || '').toUpperCase())) || null
}

/**
 * The path a company bucket is asked about, and whether a file is really
 * there: { path, real }.
 *   * real — a file of the open project kept in the bucket. It exists, so a
 *     403 is the bucket refusing, never its way of saying "missing".
 *   * not real — a row-shaped key nobody writes, for the open project or the
 *     first listed one. A 404 is then the bucket answering; a 403 says
 *     nothing either way, because a key without s3:ListBucket — the
 *     handbook's own setup (SYSTEMS_HANDBOOK, "Nothing wider — WILSON never
 *     lists") — answers 403 for a missing object (review round 1, R1-1).
 * Null with no project at all. The storage-presign function admits only
 * row-shaped paths whose third segment is not money (_shared/presignPath.ts).
 */
export function bucketProbeKey({ files = [], projectId = null, projectIds = [] } = {}) {
  const real = readableFileOf(files, 's3', projectId)
  if (real) return { path: real.storage_path, real: true }
  const pid = projectId || (projectIds || [])[0]
  return pid ? { path: `projects/${pid}/connection-check/wilson-connection-check`, real: false } : null
}

/**
 * A Petal cloud file of the open project to read one byte of, or null
 * (review round 1, R1-8: listing proves the storage API and its metadata, a
 * read proves the object store behind it). Never a money or Legal body.
 */
export function petalProbePath({ files = [], projectId = null } = {}) {
  return projectId ? (readableFileOf(files, 'supabase', projectId)?.storage_path || null) : null
}

// ── 3. The probe ────────────────────────────────────────────────────────────

const json = async (res) => { try { return await res.json() } catch { return null } }

function cloudHeaders(deps, token, extra = {}) {
  return { apikey: deps.anonKey, authorization: `Bearer ${token}`, ...extra }
}

// The WILSON database on the cloud: one HEAD of one project row (RLS answers
// zero rows with a 200 as readily as one).
async function cloudDatabase(deps, signal) {
  const token = deps.token()
  if (!token) return { ok: false, why: 'signed-out' }
  const res = await deps.fetch(`${deps.supabaseUrl}/rest/v1/projects?select=id&limit=1`, {
    method: 'HEAD', headers: cloudHeaders(deps, token), signal, cache: 'no-store',
  })
  return answerOfResponse(res)
}

// The company's storage choice, read as the caller (RLS: a member reads their
// own workspace's row). Never through supabase-js (rule 3).
async function readStorageChoice(deps, signal) {
  const token = deps.token()
  if (!token) return { failed: true }
  const res = await deps.fetch(`${deps.supabaseUrl}/rest/v1/workspace_storage?select=mode,provider&limit=1`, {
    method: 'GET', headers: cloudHeaders(deps, token), signal, cache: 'no-store',
  })
  if (!res?.ok) return { failed: true }
  const rows = await json(res)
  // A body that could not be read (or was cut off at the ceiling) is not
  // "no row": guessing Petal cloud from it is what the upload path refuses
  // to do (review round 1, R1-3).
  if (!Array.isArray(rows) || signal.aborted) return { failed: true }
  return { row: rows[0] || null }
}

async function cloudFiles(deps, signal) {
  const token = deps.token()
  if (!token) return { ok: false, why: 'signed-out' }
  let choice = deps.storageChoice?.() ?? undefined
  if (choice === undefined) {
    const read = await readStorageChoice(deps, signal)
    if (read.failed) return { ok: false, why: 'unknown' }
    choice = read.row
    deps.rememberStorageChoice?.(choice)
  }
  let provider
  try { provider = activeWorkspaceProvider(choice) } catch { return { ok: false, why: 'unknown' } }

  if (provider === WORKSPACE_PROVIDERS.PETAL) {
    const place = FILES_PLACE.petal
    const object = deps.petalPath?.()
    if (object) {
      // One of the open project's own files, asked about with the HEAD
      // supabase-js's exists() sends (storage-js `HEAD /object/<bucket>/<path>`,
      // the same two headers as the list, so no new CORS question): the
      // storage service looks the object up rather than only listing. Any
      // answer about the object under 500 (a 400 / 404 "not found" included)
      // is the store answering; 401 / 403 is it refusing you; 5xx is the
      // store failing.
      const res = await deps.fetch(`${deps.supabaseUrl}/storage/v1/object/${FILES_BUCKET}/${object.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'HEAD', headers: cloudHeaders(deps, token), signal, cache: 'no-store',
      })
      if (res && typeof res.status === 'number' && res.status < 500 && res.status !== 401 && res.status !== 403) return { ok: true, place }
      return { ...answerOfResponse(res), place }
    }
    const res = await deps.fetch(`${deps.supabaseUrl}/storage/v1/object/list/${FILES_BUCKET}`, {
      method: 'POST',
      headers: cloudHeaders(deps, token, { 'content-type': 'application/json' }),
      body: JSON.stringify({ prefix: '', limit: 1, offset: 0 }),
      signal, cache: 'no-store',
    })
    return { ...answerOfResponse(res), place }
  }

  if (provider === WORKSPACE_PROVIDERS.S3) {
    const place = FILES_PLACE.s3
    const key = deps.bucketKey?.()
    if (!key) return { ok: null, why: 'no-project', place }
    let signed
    try {
      signed = await deps.presign('head', key.path, { token, signal })
    } catch (err) {
      if (signal.aborted) throw err
      return { ok: false, why: err?.status === 401 || err?.status === 403 ? 'refused' : 'error', place }
    }
    if (!signed?.url) return { ok: false, why: 'error', place }
    const res = await deps.fetch(signed.url, { method: 'HEAD', signal, cache: 'no-store' })
    // A key nobody writes, answered 403: a bucket key without ListBucket says
    // that for a missing object, so it proves neither way (R1-1). Unchecked
    // (grey, never announced) until the project has a file in the bucket.
    if (!key.real && res?.status === 403) return { ok: null, why: 'no-file', place }
    return { ...answerOfResponse(res, { missingIsAnswer: true }), place }
  }

  if (provider === WORKSPACE_PROVIDERS.NETWORK) {
    const place = FILES_PLACE.network
    // A browser cannot reach a NAS at all (NETWORK_STORAGE_DESIGN §4a2b).
    if (!deps.desktop) return { ok: false, why: 'not-here', place }
    const local = await localAnswer(deps, signal)
    if (!local.files) return { ok: false, why: local.why || 'error', place }
    // The desktop learns the company's root at sign-in (App.jsx); until then
    // its files root is something else, and that is not the NAS.
    if (local.files.kind !== 'workspace') return { ok: false, why: 'not-set', place }
    return { ...local.files.answer, place }
  }
  return { ok: false, why: 'unknown' }
}

// The desktop's own answer: { data: { ok }, files: { ok, kind, why } }.
async function localAnswer(deps, signal) {
  const res = await deps.localFetch(LOCAL_CONNECTION_ROUTE, { method: 'GET', signal, cache: 'no-store' })
  if (!res?.ok) {
    const a = answerOfResponse(res)
    // 503: the open demo folder is missing (main.cjs localDemoMissingGuard).
    return { why: res?.status === 503 ? 'unavailable' : a.why }
  }
  const j = await json(res)
  if (!j || typeof j.data?.ok !== 'boolean' || typeof j.files?.ok !== 'boolean') return { why: 'error' }
  const read = (part) => (part.ok ? { ok: true } : { ok: false, why: part.why === 'timeout' ? 'timeout' : part.why === 'missing' ? 'missing' : 'unreachable' })
  return {
    data: { answer: read(j.data) },
    files: { answer: read(j.files), kind: typeof j.files.kind === 'string' ? j.files.kind : null },
  }
}

/**
 * Ask both parts once. Resolves { database, files }, each an answer; never
 * rejects. `deps` (all optional but the ones the kind needs):
 *   adapter          the R.A.B.B.I.T. adapter (fixtures, Drive)
 *   fetch            the plain browser fetch (cloud parts, a bucket's HEAD)
 *   localFetch       the desktop loopback fetch (lib/localServerFetch)
 *   token()          the latest access token from an auth event, or null
 *   supabaseUrl, anonKey
 *   storageChoice()  the workspace_storage row the upload path holds
 *                    (peekWorkspaceStorageCached), else the dot's own
 *                    remembered one, else undefined (then it is read)
 *   rememberStorageChoice(row)
 *   bucketKey()      bucketProbeKey's answer for now: { path, real } or null
 *   petalPath()      petalProbePath's answer for now, or null
 *   presign(op, path, { token, signal })  storageApi.presignStorage
 *   desktop          true where the desktop's loopback server is
 */
export async function probeConnection(kind, deps, { timeoutMs = CONNECTION_TIMEOUT_MS, signal = null, timers = globalThis } = {}) {
  const run = (check) => bounded(check, { timeoutMs, signal, timers })
  if (kind === 'fixtures') {
    // The fixtures' own state (?connection=…, dev only): pure, in memory.
    const r = await run(async () => (await deps.adapter.connectionProbe()) || null)
    if (typeof r?.database !== 'boolean' || typeof r?.files !== 'boolean') {
      const failed = r?.ok === false ? r : { ok: false, why: 'error' }
      return { database: failed, files: { ...failed, place: FILES_PLACE.petal } }
    }
    const answer = (up) => (up ? { ok: true } : { ok: false, why: 'unreachable' })
    return { database: answer(r.database), files: { ...answer(r.files), place: FILES_PLACE.petal } }
  }
  if (kind === 'cloud') {
    const [database, files] = await Promise.all([run((s) => cloudDatabase(deps, s)), run((s) => cloudFiles(deps, s))])
    return { database, files }
  }
  if (kind === 'local') {
    const r = await run((s) => localAnswer(deps, s))
    if (!r.data) {
      const failed = { ok: false, why: r.why || 'unreachable' }
      return { database: failed, files: failed }
    }
    return { database: r.data.answer, files: { ...r.files.answer, place: LOCAL_KIND_PLACE[r.files.kind] || FILES_PLACE.app } }
  }
  if (kind === 'drive') {
    // The Drive adapter's own probe reads the root folder's metadata: the
    // project data and the files are the same folder. Not abortable (the
    // adapter takes no signal) — bounded by the ceiling, and it is not auth-js.
    const r = await run(async () => deps.adapter.status())
    // The adapter says why in `error` ('not signed in', 'no rabbit root
    // folder configured', or the request's own error) — R1-10.
    const why = r?.why || (r?.error === 'not signed in' ? 'signed-out' : 'unreachable')
    const answer = r?.online === true ? { ok: true } : { ok: false, why }
    return { database: answer, files: { ...answer, place: FILES_PLACE.drive } }
  }
  return { database: null, files: null }
}

// ── 4. What the dot says ────────────────────────────────────────────────────

const STATE_TONE = Object.freeze({
  connected: 'success', files: 'warning', offline: 'danger', checking: 'neutral', unchecked: 'neutral', none: 'neutral',
})

function statusWord(answer) {
  if (!answer) return 'checking'
  if (answer.ok === true) return 'connected'
  switch (answer.why) {
    case 'refused':     return 'not answering for you'
    case 'signed-out':  return 'not signed in'
    case 'no-network':  return 'no network'
    case 'not-here':    return 'not reachable from a browser'
    case 'not-set':     return 'not set on this computer yet'
    case 'unknown':     return 'not known (the storage setting could not be read)'
    case 'unavailable': return 'not available (the demo folder is missing)'
    case 'missing':     return 'not found'
    case 'no-project':  return 'checked once there is a project'
    case 'no-file':     return 'checked once this project has a file there'
    default:            return 'not answering'
  }
}

const LIVE_WORD = Object.freeze({ live: 'on', connecting: 'connecting', error: 'reconnecting', off: 'off' })

/**
 * The dot: { state, tone, words, summary }.
 *   state    connected | files | offline | checking | unchecked | none
 *   words    each part in words, ' · ' between: the hover text AND the
 *            accessible name (Audrey: "hovering says each part in words")
 *   summary  the state as one sentence, announced once when it changes
 * `browserOffline` (navigator.onLine false) answers for the cloud at once,
 * before any probe: a computer with no network reaches neither part. The
 * Local Server is on this computer, so it is not asked about the network.
 */
export function connectionView({ kind, result = null, realtimeStatus = 'off', projectOpen = false, browserOffline = false } = {}) {
  if (!kind) {
    return { state: 'none', tone: STATE_TONE.none, words: 'No backend is set up', summary: 'No backend is set up' }
  }
  if (kind === 'pending') {
    return { state: 'checking', tone: STATE_TONE.checking, words: 'Database: checking · Files: checking', summary: 'Checking the connection' }
  }
  const remote = kind === 'cloud' || kind === 'drive'
  let database = result?.database || null
  let files = result?.files || null
  if (browserOffline && remote) {
    database = { ok: false, why: 'no-network' }
    files = { ok: false, why: 'no-network', place: files?.place }
  }
  const dbPlace = kind === 'local' ? 'the Local Server' : kind === 'drive' ? FILES_PLACE.drive : null
  const parts = [
    `Database: ${dbPlace ? `${dbPlace}, ` : ''}${statusWord(database)}`,
    `Files: ${files?.place ? `${files.place}, ` : ''}${statusWord(files)}`,
  ]
  if (kind === 'local' || kind === 'drive') parts.push('Live updates: off')
  else if (projectOpen) parts.push(`Live updates: ${LIVE_WORD[realtimeStatus] || 'off'}`)

  let state
  if (!database) state = 'checking'
  else if (database.ok !== true) state = 'offline'
  else if (!files) state = 'checking'
  else if (files.ok === true) state = 'connected'
  else if (files.ok === null) state = 'unchecked'
  else state = 'files'

  const summary = {
    connected: 'Everything is connected',
    files: `The files are not answering${files?.place ? ` (${files.place})` : ''}; the database is connected`,
    offline: kind === 'local' ? 'The Local Server is not answering'
      : database?.why === 'no-network' ? 'Offline: no network'
        : database?.why === 'signed-out' ? 'Not signed in: the database does not answer'
          : 'Offline: the database is not answering',
    checking: 'Checking the connection',
    unchecked: files?.why === 'no-file'
      ? 'The database is connected; the files are checked once this project has a file there'
      : 'The database is connected; the files are checked once there is a project',
  }[state]
  return { state, tone: STATE_TONE[state], words: parts.join(' · '), summary }
}

/** A settled state (one a person should hear about when it changes). */
export function isSettled(state) {
  return state === 'connected' || state === 'files' || state === 'offline'
}
