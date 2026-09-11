// =============================================================================
// MigrationPanel — Settings → RABBIT widget that orchestrates the single-user
// → cloud migration.
//
// Flow:
//   1. User clicks DRY-RUN — runMigration with dryRun:true reports what WOULD
//      be migrated. Nothing is written.
//   2. User reviews the counts + error list.
//   3. User clicks MIGRATE — runMigration for real; progress streams to the
//      console area as projects are processed.
//   4. On success, we ask the Electron main process to archive the local
//      rabbit-data directory to a timestamped .json and clear the live stores
//      so the user is fully cloud-first afterward (user-selected option in
//      the Session 2 kickoff).
// =============================================================================

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../auth/supabaseClient'
import { runMigration } from './runMigration'
import '../../components/settings/settings.css'

export default function MigrationPanel() {
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(null)
  const [busy, setBusy]         = useState(false)
  const [progress, setProgress] = useState([])
  const [report, setReport]     = useState(null)
  const [archived, setArchived] = useState(false)
  const [error, setError]       = useState(null)

  useEffect(() => {
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const wsId = session?.user?.app_metadata?.workspace_id ?? null
        setActiveWorkspaceId(wsId)
      } catch { /* no session; panel stays disabled */ }
    })()
  }, [])

  const runOnce = useCallback(async (dryRun) => {
    if (busy || !activeWorkspaceId) return
    setBusy(true)
    setError(null)
    setReport(null)
    setArchived(false)
    setProgress([])
    try {
      const r = await runMigration({
        workspaceId: activeWorkspaceId,
        dryRun,
        onProgress: (msg) => setProgress((p) => [...p, msg]),
      })
      setReport(r)
      if (!dryRun && r.errors.length === 0) {
        // Clean run — offer to archive & clear local data.
        // The user can skip archiving by simply not clicking the button.
      }
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }, [busy, activeWorkspaceId])

  const archiveAndClear = useCallback(async () => {
    const api = window.electronAPI?.rabbit
    if (!api?.archiveLocalData || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.archiveLocalData()
      if (!res?.ok) throw new Error(res?.error || 'archive failed')
      setArchived(true)
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }, [busy])

  if (!activeWorkspaceId) {
    return (
      <div>
        <SectionHeading>Migrate to cloud</SectionHeading>
        <p className="text-xs text-stone-950 leading-relaxed">
          Sign in to enable cloud migration for your RABBIT data.
        </p>
      </div>
    )
  }

  const completed = report && !report.dryRun && report.errors.length === 0

  return (
    <div>
      <SectionHeading>Migrate to cloud</SectionHeading>
      <p className="text-xs text-stone-950 mb-3 leading-relaxed">
        Copy every project under <code>rabbit-data</code> into the active
        workspace. Dry-run first to preview the diff. Re-running the full
        migration is safe — rows already present in the cloud are skipped.
      </p>

      <div className="flex gap-2 mb-3">
        <MigrateButton onClick={() => runOnce(true)}  disabled={busy}>
          {busy && !report ? 'RUNNING…' : 'DRY-RUN'}
        </MigrateButton>
        <MigrateButton onClick={() => runOnce(false)} disabled={busy || completed} primary>
          {busy && report ? 'MIGRATING…' : 'MIGRATE'}
        </MigrateButton>
        {completed && (
          <MigrateButton onClick={archiveAndClear} disabled={busy || archived}>
            {archived ? 'ARCHIVED' : 'ARCHIVE + CLEAR LOCAL'}
          </MigrateButton>
        )}
      </div>

      {progress.length > 0 && (
        <pre className="text-[11px] font-mono bg-stone-900 text-stone-100 rounded-sm p-3 max-h-40 overflow-auto">
          {progress.join('\n')}
        </pre>
      )}

      {report && <ReportTable r={report} />}

      {error && (
        <div className="mt-2 text-[11px] font-mono" style={{ color: '#991b1b' }}>
          {error}
        </div>
      )}

      {archived && (
        <div className="mt-2 text-[11px] font-mono" style={{ color: '#166534' }}>
          Local rabbit-data archived. RABBIT is now cloud-first.
        </div>
      )}
    </div>
  )
}

function SectionHeading({ children }) {
  return (
    <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">
      {children}
    </h2>
  )
}

function MigrateButton({ children, onClick, disabled, primary }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="s-migrate-btn px-3 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider rounded-sm transition-colors disabled:cursor-default"
      data-variant={primary ? 'primary' : 'quiet'}
    >
      {children}
    </button>
  )
}

function ReportTable({ r }) {
  const Row = ({ label, bucket }) => (
    <tr>
      <td className="pr-3 py-0.5">{label}</td>
      <td className="px-2 text-right">{bucket.total}</td>
      <td className="s-report-cell px-2 text-right" data-tone="inserted">{bucket.inserted}</td>
      <td className="s-report-cell px-2 text-right" data-tone="skipped">{bucket.skipped}</td>
      <td className="s-report-cell px-2 text-right" data-tone="failed" data-failed={!!bucket.failed}>{bucket.failed}</td>
    </tr>
  )
  return (
    <div className="mt-3">
      <div className="text-[11px] font-mono uppercase tracking-wider text-stone-700 mb-1">
        {r.dryRun ? 'Dry-run report' : 'Migration report'}
      </div>
      <table className="text-[11px] font-mono">
        <thead>
          <tr className="text-stone-900">
            <th className="pr-3 py-0.5 text-left">Table</th>
            <th className="px-2 text-right">Total</th>
            <th className="px-2 text-right">Inserted</th>
            <th className="px-2 text-right">Skipped</th>
            <th className="px-2 text-right">Failed</th>
          </tr>
        </thead>
        <tbody>
          <Row label="projects" bucket={r.projects} />
          <Row label="phases"   bucket={r.phases} />
          <Row label="assets"   bucket={r.assets} />
          <Row label="tasks"    bucket={r.tasks} />
          <Row label="files"    bucket={r.files} />
        </tbody>
      </table>
      {r.files.bytes > 0 && (
        <div className="text-[10px] text-stone-900 mt-1">
          Uploaded {(r.files.bytes / 1_000_000).toFixed(1)} MB to rabbit-files bucket.
        </div>
      )}
      {r.errors.length > 0 && (
        <details className="mt-2">
          <summary className="text-[11px] text-red-700 cursor-pointer">
            {r.errors.length} error{r.errors.length === 1 ? '' : 's'}
          </summary>
          <ul className="text-[10px] font-mono mt-1 space-y-0.5">
            {r.errors.slice(0, 20).map((e, i) => (
              <li key={i}>
                [{e.scope}] {e.projectId ?? e.id ?? ''}: {e.message}
              </li>
            ))}
            {r.errors.length > 20 && <li>… {r.errors.length - 20} more</li>}
          </ul>
        </details>
      )}
    </div>
  )
}
