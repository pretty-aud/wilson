// =============================================================================
// runMigration — single-user → cloud data migration runner.
//
// Reads every RABBIT project from the local_server Express backend
// (/api/rabbit/projects) which serves JSON bundles persisted under
// {userData}/rabbit-data/projects/{id}/project.json. The Session 2 scope
// mentions "IndexedDB"; no RABBIT code uses IndexedDB — that term in the
// original prompt referred to the Express-backed JSON store.
//
// Writes to Supabase via the shared authenticated client, scoped by RLS
// to the target workspace. Tables, in order: projects, phases, assets,
// tasks, task_dependencies + phase_dependencies (Track A A2 — the edges were
// dropped on the floor before 2026-09-06), files, then — BC3 (Audrey's B9,
// "bins move with the project") — scenes, shots, bins, bin_locations,
// bin_files, shot_takes, and the clips' pictures to rabbit-thumbnails while
// the company's switch is on. The migration is:
//   - idempotent: already-migrated rows are detected by id and skipped
//   - resumable: a mid-flight failure leaves the cloud in a consistent
//                state; re-running picks up only the missing rows
//   - dry-runnable: { dryRun: true } returns the same report without
//                   performing any writes
//
// The runner accepts an onProgress callback so the UI can stream per-project
// status (useful for large workspaces where a full migration takes minutes).
// =============================================================================

import { supabase } from '../auth/supabaseClient'
// The edge tables' routing rule and column allowlist come from the adapter
// that owns them — one vocabulary, not a restatement (Track A A2, 2026-09-06).
import { DEPENDENCY_TABLE, dependencyKind, toColumns } from '../../tools/rabbit_v0.1.0/adapters/supabaseAdapter'
// B3 (Track B): the desktop loopback API refuses /api without the per-launch
// token; localFetch attaches it (same-origin URLs only).
import { localFetch } from '../../lib/localServerFetch.js'
import { isLegalFile, LEGAL_SEGMENT, LEGAL_UNAVAILABLE } from '../../tools/rabbit_v0.1.0/fileTags'
// BC3 (B9): the bins' part — the roots, the question's answers, the cloud
// row shape — is pure and lives beside this file.
import {
  binRootsOf, mergeRoots, pathKey, resolveRootAnswer, cloudBinFileRow, cloudRowOf, binsParentsFirst, takesToLand, POSTER_MEDIA,
} from './binsMigration'

const RABBIT_BASE = '/api/rabbit'
const POSTER_BUCKET = 'rabbit-thumbnails'
const POSTER_MAX_BYTES = 262144 // the bucket's own cap (0053)

// The sentences the bins' part says (the panel and the tests quote them).
export const BINS_LEFT_BEHIND = (n) => `${n} clip${n === 1 ? '' : 's'} left on this computer: name ${n === 1 ? 'its' : 'their'} footage location and run the migration again`
export const POSTERS_SWITCH_OFF = 'pictures stay on this computer: the company has not allowed files to be viewed from outside the office network (a workspace admin can turn that on in App settings, Storage)'

async function fetchLocalProjectsList() {
  const res = await localFetch(`${RABBIT_BASE}/projects`)
  if (!res.ok) throw new Error(`list projects failed: HTTP ${res.status}`)
  return res.json()
}

async function fetchLocalProject(projectId) {
  const res = await localFetch(`${RABBIT_BASE}/projects/${projectId}`)
  if (!res.ok) throw new Error(`load project ${projectId} failed: HTTP ${res.status}`)
  return res.json()
}

// The Local Server's body route is /files/:id/download. Until S4b's review
// round 1 this asked /files/:id, which no route serves — the SPA fallback
// answered index.html with a 200, so every migrated "file" was the app's own
// page (R1-BEH-01, found in passing). The download is a read, so the desktop
// records one 'downloaded' event per file, as any other read does.
//
// Review round 2 (R2-BEH-02): a body the desktop cannot read (410 — the NAS
// offline, the LEGAL folder locked to this account as LEGAL_LOCAL_NOTE asks;
// any other refusal) is a FAILURE with its reason, never a quiet "skipped":
// skipped reads as "already in the cloud", and a clean report offers to
// archive and clear the desktop's copy.
async function fetchLocalFileBlob(projectId, fileId) {
  const res = await localFetch(`${RABBIT_BASE}/projects/${projectId}/files/${fileId}/download`)
  if (!res.ok) return { blob: null, status: res.status }
  return { blob: await res.blob(), status: res.status }
}

// Already in the cloud? Asked BEFORE any byte moves (review round 2,
// R2-BEH-06): a re-run used to upload the body again and only then meet the
// row's 23505 — and for an invoice or a Legal file, whose key changed in
// round 1, that left an orphan object at the new key. A row this person
// cannot read (another's Legal file) answers nothing, and the upload is then
// refused by the storage policies like any other write they may not make.
// An ERROR is not "not there" (review round 2's re-check, R3-BEH-02): the
// file is then failed with the reason, not uploaded on a guess.
async function cloudFileRow(fileId) {
  try {
    const { data, error } = await supabase.from('files').select('id, storage_path').eq('id', fileId).maybeSingle()
    return error ? { error } : { row: data || null }
  } catch (err) {
    return { error: err }
  }
}

// Post-overhaul S4b (0088): a Legal file may only land in the cloud under its
// LEGAL folder, and only where that folder is LOCKED — asked of the database
// itself, as supabaseAdapter's probe asks (only a `true` counts). Before 0088
// a LEGAL key is an ordinary folder every member can read, so a Legal file is
// not migrated there at all; the report says why.
async function cloudLocksLegal() {
  try {
    const { data, error } = await supabase.rpc('rabbit_money_segment', { seg: LEGAL_SEGMENT })
    return !error && data === true
  } catch {
    return false
  }
}

/**
 * Where a desktop file's body goes in the cloud, by the gate it must stay
 * behind: a Legal file under LEGAL, an invoice under INVOICES (0042's money
 * policies key on that third segment — under `files` an invoice's body was
 * readable by every project member), anything else under `files`.
 */
export function cloudObjectPathFor(projectId, f) {
  const safeName = (f?.name || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_')
  const segment = isLegalFile(f) ? LEGAL_SEGMENT : f?.is_financial ? 'INVOICES' : 'files'
  return `projects/${projectId}/${segment}/${f?.id}/${safeName}`
}

// Supabase .insert throws 23505 on pk conflict; we treat that as "already
// migrated" and skip the row silently. Any other error bubbles up.
// Post-overhaul S5b (0090): a desktop row set aside by an open bid version
// arrives LIVE. Bid versions are not copied to the cloud, so nothing there
// could ever bring a set-aside row back; carrying the stamp would hide it for
// good (and 0090's guard would refuse it to anyone but a manager anyway).
export function withoutSetAside(row) {
  if (!row || typeof row !== 'object' || !('set_aside_at' in row)) return row
  const { set_aside_at: _dropped, ...rest } = row
  return rest
}

async function insertOrSkip(table, row) {
  const { error } = await supabase.from(table).insert(row)
  if (!error) return { status: 'inserted' }
  if (error.code === '23505') return { status: 'skipped' } // unique_violation
  throw new Error(`${table}: ${error.message}`)
}

// ── BC3 (B9): the bins' reads and writes ──────────────────────────────────

// PostgREST answers at most `max_rows` (1,000 in supabase/config.toml) and
// says nothing about the rest: every list read here is paged by id until a
// page comes back short (review round 1: an unpaged read of a project's
// clips would have re-uploaded every picture past the thousandth).
const PAGE = 1000

/** The rows of `table` where `column` = `value`, every page, or `{ error }` (a read that fails is said, never read as "none"). */
async function listCloud(table, column, value, columns = '*') {
  const rows = []
  try {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from(table).select(columns).eq(column, value).order('id').range(from, from + PAGE - 1)
      if (error) return { error }
      const page = Array.isArray(data) ? data : []
      rows.push(...page)
      if (page.length < PAGE) break
    }
    return { rows }
  } catch (err) {
    return { error: err }
  }
}

/** The ids `table` already holds for a project, as a Set, or `{ error }`. */
async function cloudIds(table, projectId) {
  const r = await listCloud(table, 'project_id', projectId, 'id')
  return r.error ? r : { ids: new Set(r.rows.map(x => x.id)) }
}

/** The company's footage locations: `[{ id, name, unc_path }]`, or `{ error }`. */
async function cloudLocations(workspaceId) {
  const r = await listCloud('bin_locations', 'workspace_id', workspaceId, 'id, name, unc_path')
  return r.error ? r : { rows: r.rows }
}

/**
 * The company's switch (B4, B5a), read once per run. An error reads as OFF
 * (fail closed: not a byte of a picture leaves while the answer is unknown),
 * and the report says the read failed.
 */
async function remoteViewingOn(workspaceId) {
  try {
    const { data, error } = await supabase.from('workspaces').select('remote_viewing_enabled').eq('id', workspaceId).maybeSingle()
    if (error) return { on: false, error }
    return { on: data?.remote_viewing_enabled === true }
  } catch (err) {
    return { on: false, error: err }
  }
}

/** The desktop's picture of a clip (its own poster cache, made on demand): JPEG bytes, or null with the reason. */
async function fetchLocalPoster(projectId, fileId) {
  const res = await localFetch(`${RABBIT_BASE}/projects/${projectId}/bin-files/${fileId}/thumbnail`)
  if (!res.ok) return { bytes: null, why: `HTTP ${res.status}` }
  const buf = new Uint8Array(await res.arrayBuffer())
  if (buf.length < 3 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return { bytes: null, why: 'not a JPEG' }
  if (buf.length > POSTER_MAX_BYTES) return { bytes: null, why: `${buf.length} bytes, over the ${POSTER_MAX_BYTES}-byte cap` }
  return { bytes: buf }
}

/**
 * One clip's picture to the cloud, the way BC2's upload does it: the key
 * under the clip's own project (0091's shape), upsert off, the row's
 * `poster_path` PATCHed after; an object whose row refuses it is taken back.
 */
async function uploadPoster(projectId, fileId, bytes) {
  const key = `projects/${projectId}/bin_files/${fileId}/${Date.now()}-poster.jpg`
  const { error: upErr } = await supabase.storage.from(POSTER_BUCKET).upload(key, bytes, { contentType: 'image/jpeg', upsert: false })
  if (upErr) throw new Error(/row-level security|petal_bin_posters/.test(upErr.message || '') ? 'the company has not allowed files to be viewed from outside the office network' : `storage upload: ${upErr.message}`)
  // The row must be THIS project's (review round 1, security: an id the
  // bundle shares with another project's row matches nothing here, and the
  // object would have sat under this project's prefix for ever).
  const { data: rows, error: rowErr } = await supabase.from('bin_files').update({ poster_path: key }).eq('id', fileId).eq('project_id', projectId).select('id')
  if (rowErr || !Array.isArray(rows) || rows.length !== 1) {
    try { await supabase.storage.from(POSTER_BUCKET).remove([key]) } catch { /* the refusal below is the answer */ }
    throw new Error(rowErr ? `bin_files: ${rowErr.message}` : 'bin_files: the clip\'s row is not this project\'s, so its picture was taken back')
  }
  return key
}

const BINS_BUCKETS = ['scenes', 'shots', 'bins', 'binLocations', 'binFiles', 'shotTakes']

function makeReport() {
  return {
    dryRun: false,
    workspaceId: null,
    projects:      { total: 0, inserted: 0, skipped: 0, failed: 0 },
    phases:        { total: 0, inserted: 0, skipped: 0, failed: 0 },
    assets:        { total: 0, inserted: 0, skipped: 0, failed: 0 },
    tasks:         { total: 0, inserted: 0, skipped: 0, failed: 0 },
    taskLinks:     { total: 0, inserted: 0, skipped: 0, failed: 0 },
    phaseLinks:    { total: 0, inserted: 0, skipped: 0, failed: 0 },
    files:         { total: 0, inserted: 0, skipped: 0, failed: 0, bytes: 0 },
    // BC3 (B9): the bins' part. `binFiles.leftBehind` counts the clips whose
    // root nobody named (listed in `clipsLeftBehind`, never dropped);
    // `posters` counts the pictures (uploaded only while the switch is on).
    scenes:        { total: 0, inserted: 0, skipped: 0, failed: 0 },
    shots:         { total: 0, inserted: 0, skipped: 0, failed: 0 },
    bins:          { total: 0, inserted: 0, skipped: 0, failed: 0 },
    binLocations:  { total: 0, inserted: 0, skipped: 0, failed: 0 },
    binFiles:      { total: 0, inserted: 0, skipped: 0, failed: 0, leftBehind: 0 },
    shotTakes:     { total: 0, inserted: 0, skipped: 0, failed: 0, leftBehind: 0 },
    posters:       { total: 0, uploaded: 0, skipped: 0, failed: 0, switchOff: 0 },
    // The question: every distinct root of every project's clips, with what
    // the answers (if any) resolved it to — `[{ root, key, kind, count,
    // projects, resolved }]` — and the company's locations it was asked
    // against, so the panel can resolve a typed answer the same way.
    footageRoots: [],
    footageLocations: [],
    clipsLeftBehind: [],
    remoteViewing: null,
    errors: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
  }
}

// The desktop bundle carries task→task and phase→phase edges in ONE array,
// told apart by `kind` (literally 'phase', or anything else = task) — the
// adapter's dependencyKind is the rule.
function countLinks(dependencies) {
  const out = { task: 0, phase: 0 }
  for (const dep of dependencies ?? []) out[dependencyKind(dep)]++
  return out
}
const plural = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`

function bumpInserted(bucket) { bucket.total++; bucket.inserted++ }
function bumpSkipped(bucket)  { bucket.total++; bucket.skipped++ }
function bumpFailed(bucket)   { bucket.total++; bucket.failed++ }

/**
 * Migrate local RABBIT data into the given workspace.
 *
 * @param {object} opts
 * @param {string} opts.workspaceId Target workspace UUID.
 * @param {boolean} [opts.dryRun]   If true, enumerate only; no writes.
 * @param {(msg: string) => void} [opts.onProgress] Progress callback.
 * @param {object} [opts.locations] BC3 (B9): the answers to "Which footage
 *   location is this?", keyed by the root's key (binsMigration.pathKey):
 *   `{ unc_path, name? }` names a location (an existing one by address, or
 *   a new one), `{ skip: true }` leaves the root's clips on this computer.
 *   The dry run lists the roots to ask about (`report.footageRoots`).
 * @returns {Promise<object>} Report object with per-table counters.
 */
export async function runMigration({ workspaceId, dryRun = false, onProgress, locations = {} }) {
  if (!workspaceId) throw new Error('workspaceId required')
  const report = makeReport()
  report.dryRun      = dryRun
  report.workspaceId = workspaceId

  const note = (m) => { try { onProgress?.(m) } catch { /* swallow */ } }
  // BC3: the company's locations (read once, when a project has clips), the
  // switch (read once, when a clip could have a picture), the roots of every
  // project (the question), and the locations made in this run.
  const binsState = { locations: null, locationsError: null, switch: null, roots: [], answers: locations || {} }
  const companyLocations = async () => {
    if (binsState.locations) return binsState.locations
    const r = await cloudLocations(workspaceId)
    if (r.error) { binsState.locationsError = r.error; binsState.locations = []; report.errors.push({ scope: 'bin_locations', message: `could not read the company's footage locations: ${r.error.message || r.error}` }) }
    else binsState.locations = r.rows
    report.footageLocations = binsState.locations.map(l => ({ id: l.id, name: l.name, unc_path: l.unc_path }))
    return binsState.locations
  }
  const switchOn = async () => {
    if (binsState.switch) return binsState.switch.on
    binsState.switch = await remoteViewingOn(workspaceId)
    report.remoteViewing = binsState.switch.on
    if (binsState.switch.error) report.errors.push({ scope: 'posters', message: `could not read the company's remote-viewing switch, so no picture was uploaded: ${binsState.switch.error.message || binsState.switch.error}` })
    return binsState.switch.on
  }
  // The answer for a root, resolved against the company's list: cached per
  // root, so one new location serves every clip and every project under it.
  const resolvedAnswers = new Map()
  const resolveRoot = async (root) => {
    if (resolvedAnswers.has(root.key)) return resolvedAnswers.get(root.key)
    const existing = await companyLocations()
    const r = resolveRootAnswer(root, binsState.answers[root.key], existing)
    resolvedAnswers.set(root.key, r)
    return r
  }
  // A location named now: made once (a race with a teammate naming the same
  // share reads back the row they made).
  const locationIdFor = async (resolved) => {
    if (resolved.kind === 'existing') return resolved.location.id
    if (resolved.location) return resolved.location.id
    const row = { id: crypto.randomUUID(), workspace_id: workspaceId, name: resolved.name, unc_path: resolved.unc_path }
    const r = await insertOrSkip('bin_locations', row)
    if (r.status === 'inserted') {
      bumpInserted(report.binLocations)
      resolved.location = row
      binsState.locations.push(row)
      report.footageLocations.push({ id: row.id, name: row.name, unc_path: row.unc_path })
      note(`  Footage location "${row.name}" (${row.unc_path}) named`)
      return row.id
    }
    // Already there (another run, a teammate): read it back by address.
    bumpSkipped(report.binLocations)
    const again = await cloudLocations(workspaceId)
    const hit = (again.rows || []).find(l => pathKey(l.unc_path) === pathKey(resolved.unc_path))
    if (!hit) throw new Error(`bin_locations: "${resolved.unc_path}" is already in the company's list but could not be read back`)
    resolved.location = hit
    binsState.locations = again.rows
    return hit.id
  }

  // Fetch the local project list. On a fresh install there may be no local
  // server — handle a 404/network error as "nothing to migrate".
  let localProjects
  try {
    localProjects = await fetchLocalProjectsList()
  } catch (err) {
    report.errors.push({ scope: 'list', message: err.message })
    report.finishedAt = new Date().toISOString()
    return report
  }

  note(`Found ${localProjects.length} local project${localProjects.length === 1 ? '' : 's'}.`)
  // Asked once, and only when there is something to write.
  let legalLocked = null

  for (const { id: projectId, title } of localProjects) {
    note(`• ${title ?? projectId}`)
    let bundle
    try {
      bundle = await fetchLocalProject(projectId)
    } catch (err) {
      report.errors.push({ scope: 'load', projectId, message: err.message })
      bumpFailed(report.projects)
      continue
    }

    // Shape tolerance — localServerAdapter.loadProject returns
    //   { project, phases, assets, tasks, dependencies, taskLinks, files,
    //     assetVersions, comments, ingestionRuns }
    // Dry run: count only — and say the link counts out loud. A project with
    // edges used to migrate to an empty Gantt with no line in the report
    // (docs/OUTSTANDING.md, closed by Track A A2); the counts are the promise
    // the real run is then held to.
    if (dryRun) {
      bumpInserted(report.projects)
      report.phases.total += (bundle.phases ?? []).length
      report.assets.total += (bundle.assets ?? []).length
      report.tasks.total  += (bundle.tasks  ?? []).length
      report.files.total  += (bundle.files  ?? []).length
      const links = countLinks(bundle.dependencies)
      report.taskLinks.total  += links.task
      report.phaseLinks.total += links.phase
      note(`  ${plural((bundle.phases ?? []).length, 'phase')}, ${plural((bundle.tasks ?? []).length, 'task')}, ` +
           `${plural(links.task, 'task link')}, ${plural(links.phase, 'phase link')}`)
      // S4b (review round 2, R2-BEH-07): the dry run promises what the real
      // run will do with Legal files, asked of the same database.
      const legalCount = (bundle.files ?? []).filter(isLegalFile).length
      if (legalCount > 0) {
        if (legalLocked === null) legalLocked = await cloudLocksLegal()
        report.legalFiles = (report.legalFiles || 0) + legalCount
        note(legalLocked
          ? `  ${plural(legalCount, 'Legal file')} will go to the cloud's locked LEGAL folder`
          : `  ${plural(legalCount, 'Legal file')} will stay on this computer: ${LEGAL_UNAVAILABLE}`)
      }
      // BC3 (B9): what the bins' part will do — counted against what the
      // cloud already holds (a row there is skipped; the rest would be
      // inserted, and a row removed from the cloud since an earlier run is
      // among them: review round 1) — and the question the real run needs
      // answered: each distinct root of the clips, with what the answers
      // given so far make of it.
      const wouldWrite = async (bucket, table, rows) => {
        if (!rows.length) return
        const have = await cloudIds(table, projectId)
        if (have.error) { report.errors.push({ scope: table, projectId, message: `could not read what the cloud already holds: ${have.error.message || have.error}` }); bucket.total += rows.length; return }
        const there = rows.filter(r => have.ids.has(r.id)).length
        bucket.total += rows.length; bucket.skipped += there; bucket.inserted += rows.length - there
      }
      await wouldWrite(report.scenes, 'scenes', bundle.scenes ?? [])
      await wouldWrite(report.shots, 'shots', bundle.shots ?? [])
      await wouldWrite(report.bins, 'bins', bundle.bins ?? [])
      await wouldWrite(report.shotTakes, 'shot_takes', bundle.shotTakes ?? [])
      if ((bundle.bins ?? []).length || (bundle.binFiles ?? []).length) {
        const clips = bundle.binFiles ?? []
        const roots = binRootsOf(bundle)
        binsState.roots.push({ projectId, roots })
        note(`  ${plural((bundle.bins ?? []).length, 'bin')}, ${plural(clips.length, 'clip')} in ${plural(roots.length, 'footage root')}, ${plural((bundle.shotTakes ?? []).length, 'take')}`)
        const have = clips.length ? await listCloud('bin_files', 'project_id', projectId, 'id, poster_path') : { rows: [] }
        if (have.error) report.errors.push({ scope: 'bin_files', projectId, message: `could not read what the cloud already holds: ${have.error.message || have.error}` })
        const there = new Map((have.rows || []).map(r => [r.id, r]))
        const named = new Set()
        for (const root of roots) {
          const resolved = await resolveRoot(root)
          const what = resolved.kind === 'existing' ? `the company's "${resolved.location.name}"`
            : resolved.kind === 'new' ? `a new location "${resolved.name}" (${resolved.unc_path})`
              : resolved.kind === 'skip' ? 'left on this computer (not named)'
                : resolved.kind === 'invalid' ? `not an address the cloud takes: ${resolved.problem}`
                  : 'which footage location is this? (not named yet)'
          note(`    ${root.root}: ${plural(root.count, 'clip')} — ${what}`)
          if (resolved.kind === 'existing' || resolved.kind === 'new') { for (const id of root.clipIds) named.add(id); continue }
          report.binFiles.leftBehind += root.count
          for (const id of root.clipIds) {
            const clip = clips.find(f => f.id === id)
            report.clipsLeftBehind.push({ projectId, id, name: clip?.display_name || clip?.original_name || id, root: root.root })
          }
        }
        // A clip with no readable path has no root to ask about: left here, listed.
        const rooted = new Set(roots.flatMap(r => r.clipIds))
        for (const clip of clips) {
          if (rooted.has(clip.id)) continue
          report.binFiles.leftBehind++
          report.clipsLeftBehind.push({ projectId, id: clip.id, name: clip.display_name || clip.original_name || clip.id, root: null })
        }
        for (const clip of clips) {
          if (!named.has(clip.id)) continue
          report.binFiles.total++
          if (there.has(clip.id)) report.binFiles.skipped++; else report.binFiles.inserted++
        }
        // Pictures, for the clips that will go: said now, so the switch is
        // no surprise after the run; one already in the cloud is skipped.
        const withPicture = clips.filter(f => named.has(f.id) && POSTER_MEDIA.has(f.media_type))
        const havePicture = withPicture.filter(f => there.get(f.id)?.poster_path).length
        const toUpload = withPicture.length - havePicture
        report.posters.total += withPicture.length
        report.posters.skipped += havePicture
        if (toUpload > 0) {
          const on = await switchOn()
          if (on) note(`  ${plural(toUpload, 'picture')} will upload (the company allows viewing from outside the office network)`)
          else { report.posters.switchOff += toUpload; note(`  ${plural(toUpload, 'picture')}: ${POSTERS_SWITCH_OFF}`) }
        }
      }
      report.footageRoots = mergeRoots(binsState.roots).map(r => ({ ...r, resolved: (resolvedAnswers.get(r.key) || { kind: 'unanswered' }).kind }))
      continue
    }

    // Project row. Drop workspace_id if already present on the local row
    // (shouldn't be; v0.1 seeded a hardcoded uuid) and set our target.
    //
    // active_shot_list_id is dropped too (0084; S3a review round 1, scope#9).
    // The Local Server sets it (its read-time backfill on every legacy bundle,
    // set-active after that), but it names a LOCAL list this runner never
    // copies (it carries no scenes, shots or lists), so the composite FK
    // projects_active_shot_list_fk refused the whole project (23503) — and
    // its phases, assets and tasks with it. A database without 0084 has no
    // such column at all (PGRST204). The migrated project starts with no
    // active list: every scene and shot shows (D10).
    try {
      const p = {
        ...(bundle.project ?? {}),
        workspace_id: workspaceId,
      }
      delete p.active_shot_list_id
      const r = await insertOrSkip('projects', p)
      if (r.status === 'inserted') bumpInserted(report.projects)
      else bumpSkipped(report.projects)
    } catch (err) {
      report.errors.push({ scope: 'project', projectId, message: err.message })
      bumpFailed(report.projects)
      continue // don't try children if the project itself failed
    }

    // Phases / assets / tasks — parent-join-based RLS. assets and tasks
    // auto-populate workspace_id from their project via our 0004 triggers.
    for (const ph of bundle.phases ?? []) {
      try {
        const r = await insertOrSkip('phases', withoutSetAside(ph))
        r.status === 'inserted' ? bumpInserted(report.phases) : bumpSkipped(report.phases)
      } catch (err) {
        report.errors.push({ scope: 'phase', projectId, id: ph.id, message: err.message })
        bumpFailed(report.phases)
      }
    }
    for (const a of bundle.assets ?? []) {
      try {
        const r = await insertOrSkip('assets', a)
        r.status === 'inserted' ? bumpInserted(report.assets) : bumpSkipped(report.assets)
      } catch (err) {
        report.errors.push({ scope: 'asset', projectId, id: a.id, message: err.message })
        bumpFailed(report.assets)
      }
    }
    for (const t of bundle.tasks ?? []) {
      try {
        const r = await insertOrSkip('tasks', withoutSetAside(t))
        r.status === 'inserted' ? bumpInserted(report.tasks) : bumpSkipped(report.tasks)
      } catch (err) {
        report.errors.push({ scope: 'task', projectId, id: t.id, message: err.message })
        bumpFailed(report.tasks)
      }
    }

    // Dependency edges — both tables, after every endpoint row is in.
    // dependencyKind / DEPENDENCY_TABLE route each row to its table exactly
    // as the adapter does on a live link. `kind` and `project_id` are not
    // columns (the desktop URL and the Gantt's arrow routing need them; the
    // database does not) and `predecessor` is the embed a cloud load adds, so
    // all three are stripped BEFORE toColumns, which then has nothing to warn
    // about on a well-formed row. An edge whose endpoint failed above is
    // refused by the foreign key and lands in `errors` with its id — the
    // report says so instead of the Gantt going quietly empty.
    for (const dep of bundle.dependencies ?? []) {
      const kind   = dependencyKind(dep)
      const table  = DEPENDENCY_TABLE[kind]
      const bucket = kind === 'phase' ? report.phaseLinks : report.taskLinks
      try {
        const columns = { ...dep }
        delete columns.kind
        delete columns.project_id
        delete columns.predecessor
        const r = await insertOrSkip(table, toColumns(table, columns))
        r.status === 'inserted' ? bumpInserted(bucket) : bumpSkipped(bucket)
      } catch (err) {
        report.errors.push({ scope: kind === 'phase' ? 'phase_link' : 'task_link', projectId, id: dep.id, message: err.message })
        bumpFailed(bucket)
      }
    }

    // Files — upload the binary, then the metadata row (which gets the
    // cloud storage_path).
    for (const f of bundle.files ?? []) {
      try {
        // S4b: a Legal file (on the desktop, its tag) goes under LEGAL with
        // its tag, never core — or, where the cloud does not lock LEGAL, not
        // at all. Decided BEFORE its body is read.
        const legal = isLegalFile(f)
        if (legal) {
          if (legalLocked === null) legalLocked = await cloudLocksLegal()
          if (!legalLocked) {
            report.errors.push({ scope: 'file', projectId, id: f.id, message: `Legal file not migrated: ${LEGAL_UNAVAILABLE}` })
            bumpSkipped(report.files)
            continue
          }
        }
        const objectPath = cloudObjectPathFor(projectId, f)
        const asked = await cloudFileRow(f.id)
        if (asked.error) {
          report.errors.push({ scope: 'file', projectId, id: f.id, message: `could not check whether the file is already in the cloud: ${asked.error.message || asked.error}` })
          bumpFailed(report.files)
          continue
        }
        const already = asked.row
        if (already) {
          if (already.storage_path && already.storage_path !== objectPath) {
            report.errors.push({
              scope: 'file', projectId, id: f.id,
              message: `already in the cloud at an older path (${already.storage_path}), not uploaded again — check that copy, and add the file again if it is wrong`,
            })
          }
          bumpSkipped(report.files)
          continue
        }
        const { blob, status } = await fetchLocalFileBlob(projectId, f.id)
        if (!blob) {
          report.errors.push({ scope: 'file', projectId, id: f.id, message: `the file's body could not be read on this computer (HTTP ${status})` })
          bumpFailed(report.files)
          continue
        }

        const objectDir = objectPath.slice(0, objectPath.lastIndexOf('/'))
        const safeName = objectPath.slice(objectPath.lastIndexOf('/') + 1)

        // Detect already-uploaded objects via list (cheap for the dir).
        const { data: existing } = await supabase.storage
          .from('rabbit-files')
          .list(objectDir, { limit: 10 })
        const alreadyUploaded = existing?.some(e => e.name === safeName)

        if (!alreadyUploaded) {
          const { error: upErr } = await supabase.storage
            .from('rabbit-files')
            .upload(objectPath, blob, {
              cacheControl: '3600',
              upsert: false,
              contentType: f.mime_type || blob.type || 'application/octet-stream',
            })
          if (upErr && !/already exists/i.test(upErr.message)) {
            throw new Error(`storage upload: ${upErr.message}`)
          }
          report.files.bytes += blob.size ?? 0
        }

        const row = {
          ...f,
          storage_provider: 'supabase',
          storage_path:     objectPath,
        }
        if (legal) {
          row.tags = ['legal', ...(Array.isArray(f.tags) ? f.tags.filter(t => t !== 'legal') : [])]
          row.is_core_definer = false // files_legal_not_core_chk
        } else if (Array.isArray(f.tags) && f.tags.includes('legal')) {
          row.tags = f.tags.filter(t => t !== 'legal') // not Legal: a label only
        }
        const r = await insertOrSkip('files', row)
        r.status === 'inserted' ? bumpInserted(report.files) : bumpSkipped(report.files)
      } catch (err) {
        report.errors.push({ scope: 'file', projectId, id: f.id, message: err.message })
        bumpFailed(report.files)
      }
    }

    // ── BC3 (B9): the bins — "bins move with the project" ────────────────
    // Scenes and shots first: a take links a shot to a clip, and a clip may
    // be logged to a scene and a shot, so their rows must be in the cloud
    // before the bins' (the runner carried neither before BC3, and 0084's
    // lists are still not carried: the migrated project shows every scene
    // and shot, D10). Then the bins, parents first; then each clip under the
    // footage location its root was named as; then the takes whose shot and
    // clip both landed; then the pictures, while the switch is on. Every
    // row keeps its id (the desktop's UUIDs are 0091's), so a second run
    // skips what is there.
    const landed = { scenes: new Set(), shots: new Set(), bins: new Set(), clips: new Set() }
    for (const sc of bundle.scenes ?? []) {
      try {
        const r = await insertOrSkip('scenes', toColumns('scenes', withoutSetAside(cloudRowOf(sc, projectId))))
        r.status === 'inserted' ? bumpInserted(report.scenes) : bumpSkipped(report.scenes)
        landed.scenes.add(sc.id)
      } catch (err) {
        report.errors.push({ scope: 'scene', projectId, id: sc.id, message: err.message })
        bumpFailed(report.scenes)
      }
    }
    for (const sh of bundle.shots ?? []) {
      try {
        const row = withoutSetAside(cloudRowOf(sh, projectId))
        if (row.scene_id && !landed.scenes.has(row.scene_id)) row.scene_id = null
        const r = await insertOrSkip('shots', toColumns('shots', row))
        r.status === 'inserted' ? bumpInserted(report.shots) : bumpSkipped(report.shots)
        landed.shots.add(sh.id)
      } catch (err) {
        report.errors.push({ scope: 'shot', projectId, id: sh.id, message: err.message })
        bumpFailed(report.shots)
      }
    }
    for (const b of binsParentsFirst(bundle.bins ?? [])) {
      try {
        const r = await insertOrSkip('bins', toColumns('bins', { ...cloudRowOf(b, projectId), workspace_id: workspaceId }))
        r.status === 'inserted' ? bumpInserted(report.bins) : bumpSkipped(report.bins)
        landed.bins.add(b.id)
      } catch (err) {
        report.errors.push({ scope: 'bin', projectId, id: b.id, message: err.message })
        bumpFailed(report.bins)
      }
    }
    const clips = bundle.binFiles ?? []
    const roots = binRootsOf(bundle)
    if (clips.length) binsState.roots.push({ projectId, roots })
    const rootByClip = new Map()
    for (const root of roots) for (const id of root.clipIds) rootByClip.set(id, root)
    // What the cloud already holds for this project (a second run): the
    // rows to skip, and which of them still want a picture.
    let cloudClips = new Map()
    // The read failed: the rows still go (a row already there is skipped by
    // its key), but no picture does — which rows already have one is
    // unknown, and a second upload would orphan the first in the bucket.
    let cloudClipsUnknown = false
    if (clips.length) {
      const have = await listCloud('bin_files', 'project_id', projectId, 'id, poster_path')
      if (have.error) { cloudClipsUnknown = true; report.errors.push({ scope: 'bin_files', projectId, message: `could not read the project's clips already in the cloud, so no picture was uploaded for it: ${have.error.message || have.error}` }) }
      else cloudClips = new Map(have.rows.map(r => [r.id, r]))
    }
    const wantPicture = []
    const leftClips = new Set()
    for (const clip of clips) {
      const root = rootByClip.get(clip.id)
      const name = clip.display_name || clip.original_name || clip.id
      if (!root) {
        // No readable path: left here, listed (never dropped), with its reason.
        report.errors.push({ scope: 'bin_file', projectId, id: clip.id, message: `${name}: no path recorded, so it was left on this computer` })
        report.binFiles.leftBehind++
        report.clipsLeftBehind.push({ projectId, id: clip.id, name, root: null })
        leftClips.add(clip.id)
        continue
      }
      let resolved
      try { resolved = await resolveRoot(root) } catch (err) { report.errors.push({ scope: 'bin_file', projectId, id: clip.id, message: err.message }); bumpFailed(report.binFiles); continue }
      if (resolved.kind !== 'existing' && resolved.kind !== 'new') {
        // Not named: left here, listed, never dropped. The desktop's bundle
        // is untouched, and a second run after naming the root brings it.
        report.binFiles.leftBehind++
        report.clipsLeftBehind.push({ projectId, id: clip.id, name, root: root.root })
        leftClips.add(clip.id)
        continue
      }
      try {
        if (!landed.bins.has(clip.bin_id)) throw new Error(`its bin (${clip.bin_id}) is not in the cloud`)
        // The row is built BEFORE a location is made for it (review round
        // 1): a clip the cloud cannot take leaves no empty location behind.
        const made = cloudBinFileRow(clip, { root: root.root, locationId: null, prefix: resolved.prefix, workspaceId, projectId })
        if (made.error) throw new Error(made.error)
        const row = made.row
        row.location_id = await locationIdFor(resolved)
        // A scene or shot link to a row that did not land is let go, and said.
        if (row.scene_id && !landed.scenes.has(row.scene_id)) { report.errors.push({ scope: 'bin_file', projectId, id: clip.id, message: `${name}: its scene is not in the cloud, so the clip's scene link was left empty` }); row.scene_id = null }
        if (row.shot_id && !landed.shots.has(row.shot_id)) { report.errors.push({ scope: 'bin_file', projectId, id: clip.id, message: `${name}: its shot is not in the cloud, so the clip's shot link was left empty` }); row.shot_id = null }
        const already = cloudClips.get(clip.id)
        const r = already ? { status: 'skipped' } : await insertOrSkip('bin_files', toColumns('bin_files', row))
        r.status === 'inserted' ? bumpInserted(report.binFiles) : bumpSkipped(report.binFiles)
        landed.clips.add(clip.id)
        if (POSTER_MEDIA.has(clip.media_type) && !already?.poster_path && !cloudClipsUnknown) wantPicture.push(clip)
        else if (POSTER_MEDIA.has(clip.media_type)) { report.posters.total++; report.posters.skipped++ }
      } catch (err) {
        report.errors.push({ scope: 'bin_file', projectId, id: clip.id, message: `${name}: ${err.message}` })
        bumpFailed(report.binFiles)
      }
    }
    // The takes: those whose shot and clip landed, with one primary per shot
    // and positions in order (takesToLand); a take of a clip left on this
    // computer waits with it (left behind, not failed); a take whose shot or
    // clip FAILED is said.
    const takes = bundle.shotTakes ?? []
    const landing = takesToLand(takes, landed.shots, landed.clips)
    const landingIds = new Set(landing.map(t => t.id))
    for (const t of takes) {
      if (landingIds.has(t.id)) continue
      report.shotTakes.total++
      if (leftClips.has(t.bin_file_id)) { report.shotTakes.leftBehind++; continue }
      const why = !landed.shots.has(t.shot_id) ? 'its shot is not in the cloud' : 'its clip is not in the cloud'
      report.errors.push({ scope: 'shot_take', projectId, id: t.id, message: `take not migrated: ${why}` })
      report.shotTakes.failed++
    }
    for (const t of landing) {
      report.shotTakes.total++
      try {
        const r = await insertOrSkip('shot_takes', toColumns('shot_takes', { ...cloudRowOf(t, projectId), workspace_id: workspaceId }))
        r.status === 'inserted' ? report.shotTakes.inserted++ : report.shotTakes.skipped++
      } catch (err) {
        report.errors.push({ scope: 'shot_take', projectId, id: t.id, message: err.message })
        report.shotTakes.failed++
      }
    }
    // Pictures: only while the company's switch is on (B4) — asked once;
    // off, the desktop keeps them and the report says so. The desktop makes
    // each picture on demand from the file it reaches; a clip it cannot
    // reach has none to send, which is said per clip.
    if (wantPicture.length) {
      report.posters.total += wantPicture.length
      const on = await switchOn()
      if (!on) {
        report.posters.switchOff += wantPicture.length
        note(`  ${plural(wantPicture.length, 'picture')}: ${POSTERS_SWITCH_OFF}`)
      } else {
        let done = 0
        for (const clip of wantPicture) {
          const name = clip.display_name || clip.original_name || clip.id
          try {
            const { bytes, why } = await fetchLocalPoster(projectId, clip.id)
            if (!bytes) throw new Error(`no picture on this computer (${why})`)
            await uploadPoster(projectId, clip.id, bytes)
            report.posters.uploaded++
          } catch (err) {
            report.errors.push({ scope: 'poster', projectId, id: clip.id, message: `${name}: ${err.message}` })
            report.posters.failed++
          }
          done++
          if (done % 10 === 0 || done === wantPicture.length) note(`  Pictures: ${done} of ${wantPicture.length}`)
        }
      }
    }
    if (clips.length) {
      const left = report.clipsLeftBehind.filter(c => c.projectId === projectId).length
      note(`  ${plural(report.bins.inserted + report.bins.skipped, 'bin')}, ${plural(landed.clips.size, 'clip')} and ${plural(landing.length, 'take')} in the cloud` +
        (left ? `; ${BINS_LEFT_BEHIND(left)}` : ''))
    }
  }

  report.footageRoots = mergeRoots(binsState.roots).map(r => ({ ...r, resolved: (resolvedAnswers.get(r.key) || { kind: 'unanswered' }).kind }))
  report.finishedAt = new Date().toISOString()
  return report
}
