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
// dropped on the floor before 2026-09-06), files. The migration is:
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

const RABBIT_BASE = '/api/rabbit'

async function fetchLocalProjectsList() {
  const res = await fetch(`${RABBIT_BASE}/projects`)
  if (!res.ok) throw new Error(`list projects failed: HTTP ${res.status}`)
  return res.json()
}

async function fetchLocalProject(projectId) {
  const res = await fetch(`${RABBIT_BASE}/projects/${projectId}`)
  if (!res.ok) throw new Error(`load project ${projectId} failed: HTTP ${res.status}`)
  return res.json()
}

async function fetchLocalFileBlob(projectId, fileId) {
  const res = await fetch(`${RABBIT_BASE}/projects/${projectId}/files/${fileId}`)
  if (!res.ok) return null
  return res.blob()
}

// Supabase .insert throws 23505 on pk conflict; we treat that as "already
// migrated" and skip the row silently. Any other error bubbles up.
async function insertOrSkip(table, row) {
  const { error } = await supabase.from(table).insert(row)
  if (!error) return { status: 'inserted' }
  if (error.code === '23505') return { status: 'skipped' } // unique_violation
  throw new Error(`${table}: ${error.message}`)
}

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
 * @returns {Promise<object>} Report object with per-table counters.
 */
export async function runMigration({ workspaceId, dryRun = false, onProgress }) {
  if (!workspaceId) throw new Error('workspaceId required')
  const report = makeReport()
  report.dryRun      = dryRun
  report.workspaceId = workspaceId

  const note = (m) => { try { onProgress?.(m) } catch { /* swallow */ } }

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
      continue
    }

    // Project row. Drop workspace_id if already present on the local row
    // (shouldn't be; v0.1 seeded a hardcoded uuid) and set our target.
    try {
      const p = {
        ...(bundle.project ?? {}),
        workspace_id: workspaceId,
      }
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
        const r = await insertOrSkip('phases', ph)
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
        const r = await insertOrSkip('tasks', t)
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
        const blob = await fetchLocalFileBlob(projectId, f.id)
        if (!blob) { bumpSkipped(report.files); continue }

        const safeName = (f.name || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_')
        const objectPath = `projects/${projectId}/files/${f.id}/${safeName}`

        // Detect already-uploaded objects via list (cheap for the dir).
        const { data: existing } = await supabase.storage
          .from('rabbit-files')
          .list(`projects/${projectId}/files/${f.id}`, { limit: 10 })
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
        const r = await insertOrSkip('files', row)
        r.status === 'inserted' ? bumpInserted(report.files) : bumpSkipped(report.files)
      } catch (err) {
        report.errors.push({ scope: 'file', projectId, id: f.id, message: err.message })
        bumpFailed(report.files)
      }
    }
  }

  report.finishedAt = new Date().toISOString()
  return report
}
