// =============================================================================
// OtterMigrationPanel — Settings widget for the O.T.T.E.R. local → cloud
// migration (Session 11).
//
// runOtterMigration.js shipped in Session 10 and nothing ever called it, so
// every course still sitting in {userData}/otter-data was unreachable from the
// cloud model. This is the missing entry point, mounted beside the RABBIT
// MigrationPanel and following its shape deliberately (Jakob's Law: two
// migrations that look and behave differently is one more thing to learn).
//
// TWO THINGS DIFFER FROM THE RABBIT PANEL, both forced by the runner:
//
//   1. It needs the in-app Express server, because that is what serves
//      otter-data from disk. In a browser there is nothing to read FROM, so the
//      panel says so rather than offering a button that reports "0 courses" —
//      which would read as "your data is already migrated".
//   2. It offers a starting VISIBILITY. Everything lands as `personal` by
//      default, which is the safe direction: a course that should have been
//      shared is one menu click away, whereas a personal course published to
//      the whole company by a migration cannot be un-seen.
//
// There is deliberately no ARCHIVE + CLEAR LOCAL step. The RABBIT panel has one
// because RABBIT is fully cloud-first afterwards; O.T.T.E.R. still runs against
// local disk whenever the user is signed out, so deleting otter-data would take
// their courses away in exactly the mode that still needs them.
//
// UX laws embodied:
//   Jakob's Law         Same DRY-RUN → MIGRATE → report grammar as RABBIT's.
//   Cognitive Bias      Dry-run is the primary path; the real run is only
//                       reachable after you have seen what it would do.
//   Doherty Threshold   Progress streams a line per course rather than
//                       freezing behind one long await.
//   Postel's Law        Re-running is safe and says so — 23505 counts as
//                       "already there", not as a failure.
// =============================================================================

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../auth/supabaseClient'
import { runOtterMigration } from './runOtterMigration'
import '../../components/settings/settings.css'
import { Section, Group, Row } from '../../components/settings/SettingsChrome'
import { Button, Select } from '../../ui'

export default function OtterMigrationPanel() {
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(null)
  const [visibility, setVisibility] = useState('personal')
  const [busy, setBusy]         = useState(false)
  const [progress, setProgress] = useState([])
  const [report, setReport]     = useState(null)
  const [error, setError]       = useState(null)

  // No electronAPI means no in-app Express server, so nothing local to read.
  const hasLocalServer = typeof window !== 'undefined' && !!window.electronAPI

  useEffect(() => {
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        setActiveWorkspaceId(session?.user?.app_metadata?.workspace_id ?? null)
      } catch { /* no session; panel stays disabled */ }
    })()
  }, [])

  const runOnce = useCallback(async (dryRun) => {
    if (busy || !activeWorkspaceId) return
    setBusy(true)
    setError(null)
    setReport(null)
    setProgress([])
    try {
      const r = await runOtterMigration({
        dryRun,
        visibility,
        onProgress: (msg) => setProgress((p) => [...p, msg]),
      })
      setReport(r)
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }, [busy, activeWorkspaceId, visibility])

  if (!activeWorkspaceId) {
    return (
      <Section
        title="Migrate O.T.T.E.R. courses to cloud"
        description="Sign in to move your O.T.T.E.R. courses into the active workspace."
      />
    )
  }

  if (!hasLocalServer) {
    return (
      <Section
        title="Migrate O.T.T.E.R. courses to cloud"
        description="This reads courses saved on your computer, so it only runs in the desktop app."
      />
    )
  }

  const completed = report && !report.dryRun

  return (
    <Section
      title="Migrate O.T.T.E.R. courses to cloud"
      description="Copy every course saved on this computer into the active workspace. Dry-run first to preview. Re-running is safe — courses already in the cloud are skipped, not duplicated."
    >
      <Group>
        {/* The label here was the ONE field label on the surface set in mono
            rather than the sans Label step, with its own mb-1 instead of the
            shared mb-1.5 — two small divergences that made the same object
            look like a different one (B′ in the row-shape inventory). */}
        <Row
          label="Bring them in as"
          htmlFor="s-otter-visibility"
          description="You can share individual courses afterwards. Sharing everything at once cannot be undone course-by-course as easily."
        >
          <Select
            id="s-otter-visibility"
            surface="light"
            size="sm"
            aria-label="Bring them in as"
            value={visibility}
            onChange={(v) => setVisibility(v || 'personal')}
            disabled={busy}
            options={[
              { value: 'personal', label: 'Just for me (recommended)' },
              { value: 'shared', label: 'Shared with the company' },
            ]}
          />
        </Row>

        <Row label="Migration">
          <MigrateButton onClick={() => runOnce(true)} disabled={busy}>
            {busy && !report ? 'Running…' : 'Dry-run'}
          </MigrateButton>
          <MigrateButton onClick={() => runOnce(false)} disabled={busy || completed} primary>
            {busy && report ? 'Migrating…' : 'Migrate'}
          </MigrateButton>
        </Row>
      </Group>

      {/* Whitespace inside <pre> is rendered output; only the class moves. */}
      {progress.length > 0 && (
        <pre className="s-log mt-4" data-surface="dark">
          {progress.join('\n')}
        </pre>
      )}

      {report && <OtterReportTable r={report} />}

      {error && (
        <p className="s-feedback mt-4" data-tone="error" role="alert">{error}</p>
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

function OtterReportTable({ r }) {
  const Row = ({ label, bucket }) => (
    <tr>
      <td>{label}</td>
      <td>{bucket.total}</td>
      <td>{bucket.inserted}</td>
      <td>{bucket.skipped}</td>
      <td className="s-report-cell" data-failed={!!bucket.failed}>{bucket.failed}</td>
    </tr>
  )
  return (
    <div className="mt-4">
      {/* Same contract as the R.A.B.B.I.T. panel's table, deliberately: the
          two migrations are the same grammar, and two tables that look
          different is one more thing to learn. Column LABELS still differ
          ("Migrated"/"Already there" against "Inserted"/"Skipped") because
          they describe different runners; that is copy, not chrome. */}
      <table className="s-table">
        <caption>{r.dryRun ? 'Dry-run report' : 'Migration report'}</caption>
        <thead>
          <tr>
            <th scope="col">Table</th>
            <th scope="col">Total</th>
            <th scope="col">Migrated</th>
            <th scope="col">Already there</th>
            <th scope="col">Failed</th>
          </tr>
        </thead>
        <tbody>
          <Row label="courses"   bucket={r.courses} />
          <Row label="subjects"  bucket={r.subjects} />
          <Row label="documents" bucket={r.documents} />
          <Row label="progress"  bucket={r.progress} />
        </tbody>
      </table>
      {/* runOtterMigration pushes plain strings, unlike the RABBIT runner's
          {scope, id, message} objects — rendering it as an object would print
          "[object Object]" for every line. */}
      {r.errors.length > 0 && (
        <details className="mt-3">
          <summary className="s-label cursor-pointer">
            {r.errors.length} problem{r.errors.length === 1 ? '' : 's'}
          </summary>
          <ul className="s-data s-row-desc mt-2 space-y-1">
            {r.errors.slice(0, 20).map((e, i) => (
              <li key={i}>{typeof e === 'string' ? e : (e?.message ?? JSON.stringify(e))}</li>
            ))}
            {r.errors.length > 20 && <li>… {r.errors.length - 20} more</li>}
          </ul>
        </details>
      )}
    </div>
  )
}
