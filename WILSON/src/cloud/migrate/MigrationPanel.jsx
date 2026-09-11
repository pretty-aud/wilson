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
import { Section, Group, Row } from '../../components/settings/SettingsChrome'
import { Button } from '../../ui'

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
      <Section
        title="Migrate to cloud"
        description="Sign in to enable cloud migration for your R.A.B.B.I.T. data."
      />
    )
  }

  const completed = report && !report.dryRun && report.errors.length === 0

  return (
    <Section
      title="Migrate to cloud"
      description={<>
        Copy every project under <span className="s-data">rabbit-data</span> into the active
        workspace. Dry-run first to preview the diff. Re-running the full
        migration is safe — rows already present in the cloud are skipped.
      </>}
    >
      <Group>
        {/* Button copy goes sentence case with the rest of the app (Q2).
            These were the last SHOUTED labels on the surface. */}
        <Row label="Migration">
          <MigrateButton onClick={() => runOnce(true)} disabled={busy}>
            {busy && !report ? 'Running…' : 'Dry-run'}
          </MigrateButton>
          <MigrateButton onClick={() => runOnce(false)} disabled={busy || completed} primary>
            {busy && report ? 'Migrating…' : 'Migrate'}
          </MigrateButton>
          {completed && (
            <MigrateButton onClick={archiveAndClear} disabled={busy || archived}>
              {archived ? 'Archived' : 'Archive and clear local'}
            </MigrateButton>
          )}
        </Row>
      </Group>

      {/* ⚠️ The expression inside <pre> sits where it sits on purpose:
          whitespace here is rendered output, so re-indenting it changes the
          log. Only the class moves. */}
      {progress.length > 0 && (
        <pre className="s-log mt-4">
          {progress.join('\n')}
        </pre>
      )}

      {report && <ReportTable r={report} />}

      {error && (
        <p className="s-feedback mt-4" data-tone="error" role="alert">{error}</p>
      )}

      {archived && (
        <p className="s-feedback mt-4" data-tone="ok" role="status">
          Local rabbit-data archived. R.A.B.B.I.T. is now cloud-first.
        </p>
      )}
    </Section>
  )
}



// The private button is gone: this is the kit Button, so the migration panels
// stop being a ninth and tenth button treatment in the app (C8). `primary`
// maps to the one filled primary token; everything else is secondary, which
// is what makes "Dry-run first" read as the safe default it is meant to be.
function MigrateButton({ children, onClick, disabled, primary }) {
  return (
    <Button
      surface="light"
      size="sm"
      variant={primary ? 'primary' : 'secondary'}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
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
    <div className="mt-4">
      {/* 🚨 This is a real <table> and it STAYS a real <table>. The shared
          `Table` is Foundation 2's and has not landed on the integration
          branch, so this takes the Table contract's TOKENS by hand — 32px
          head, 36px rows, 8px/12px cells, one hairline, no zebra, right
          aligned numerics with tabular figures — which makes the eventual
          swap a component change rather than a redesign. Recorded in the
          hand-off as the one piece of D1 deferred to a post-F2 pass. */}
      <table className="s-table">
        <caption>{r.dryRun ? 'Dry-run report' : 'Migration report'}</caption>
        <thead>
          <tr>
            <th scope="col">Table</th>
            <th scope="col">Total</th>
            <th scope="col">Inserted</th>
            <th scope="col">Skipped</th>
            <th scope="col">Failed</th>
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
        <p className="s-row-desc mt-2">
          Uploaded {(r.files.bytes / 1_000_000).toFixed(1)} MB to rabbit-files bucket.
        </p>
      )}
      {/* This <details> is the one disclosure on the surface that is NOT a
          C1 problem: it hides a list of error text, not a control, and it was
          already closed by default. text-red-700 measured 2.41:1 on the
          ground. */}
      {r.errors.length > 0 && (
        <details className="mt-3">
          <summary className="s-label cursor-pointer">
            {r.errors.length} error{r.errors.length === 1 ? '' : 's'}
          </summary>
          <ul className="s-data s-row-desc mt-2 space-y-1">
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
