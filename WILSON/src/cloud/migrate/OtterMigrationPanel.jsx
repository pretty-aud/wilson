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
      <div>
        <SectionHeading>Migrate O.T.T.E.R. courses to cloud</SectionHeading>
        <p className="text-xs text-stone-950 leading-relaxed">
          Sign in to move your O.T.T.E.R. courses into the active workspace.
        </p>
      </div>
    )
  }

  if (!hasLocalServer) {
    return (
      <div>
        <SectionHeading>Migrate O.T.T.E.R. courses to cloud</SectionHeading>
        <p className="text-xs text-stone-950 leading-relaxed">
          This reads courses saved on your computer, so it only runs in the desktop app.
        </p>
      </div>
    )
  }

  const completed = report && !report.dryRun

  return (
    <div>
      <SectionHeading>Migrate O.T.T.E.R. courses to cloud</SectionHeading>
      <p className="text-xs text-stone-950 mb-3 leading-relaxed">
        Copy every course saved on this computer into the active workspace. Dry-run first to
        preview. Re-running is safe — courses already in the cloud are skipped, not duplicated.
      </p>

      <div className="mb-3">
        <label className="block text-[11px] font-mono uppercase tracking-wider text-stone-700 mb-1">
          Bring them in as
        </label>
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value)}
          disabled={busy}
          className="px-3 py-1.5 text-[11px] font-mono rounded-sm focus:ring-2 focus:ring-orange-500 cursor-pointer"
          style={{ backgroundColor: 'rgba(120, 70, 30, 0.55)', color: '#fde8d0', border: 'none' }}
        >
          <option value="personal">Just for me (recommended)</option>
          <option value="shared">Shared with the company</option>
        </select>
        <p className="text-[10px] text-stone-700 mt-1">
          You can share individual courses afterwards. Sharing everything at once cannot be undone
          course-by-course as easily.
        </p>
      </div>

      <div className="flex gap-2 mb-3">
        <MigrateButton onClick={() => runOnce(true)} disabled={busy}>
          {busy && !report ? 'RUNNING…' : 'DRY-RUN'}
        </MigrateButton>
        <MigrateButton onClick={() => runOnce(false)} disabled={busy || completed} primary>
          {busy && report ? 'MIGRATING…' : 'MIGRATE'}
        </MigrateButton>
      </div>

      {progress.length > 0 && (
        <pre className="text-[11px] font-mono bg-stone-900 text-stone-100 rounded-sm p-3 max-h-40 overflow-auto">
          {progress.join('\n')}
        </pre>
      )}

      {report && <OtterReportTable r={report} />}

      {error && (
        <div className="mt-2 text-[11px] font-mono" style={{ color: '#991b1b' }}>
          {error}
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

function OtterReportTable({ r }) {
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
            <th className="px-2 text-right">Migrated</th>
            <th className="px-2 text-right">Already there</th>
            <th className="px-2 text-right">Failed</th>
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
        <details className="mt-2">
          <summary className="text-[11px] text-red-700 cursor-pointer">
            {r.errors.length} problem{r.errors.length === 1 ? '' : 's'}
          </summary>
          <ul className="text-[10px] font-mono mt-1 space-y-0.5">
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
