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
// to the target workspace. The migration is:
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
// B3 (Track B): the desktop loopback API refuses /api without the per-launch
// token; localFetch attaches it (same-origin URLs only).
import { localFetch } from '../../lib/localServerFetch.js'

const RABBIT_BASE = '/api/rabbit'

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

async function fetchLocalFileBlob(projectId, fileId) {
  const res = await localFetch(`${RABBIT_BASE}/projects/${projectId}/files/${fileId}`)
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
    files:         { total: 0, inserted: 0, skipped: 0, failed: 0, bytes: 0 },
    errors: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
  }
}

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
    // Dry run: count only.
    if (dryRun) {
      bumpInserted(report.projects)
      report.phases.total += (bundle.phases ?? []).length
      report.assets.total += (bundle.assets ?? []).length
      report.tasks.total  += (bundle.tasks  ?? []).length
      report.files.total  += (bundle.files  ?? []).length
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
