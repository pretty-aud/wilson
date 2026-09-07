// =============================================================================
// AttachmentMigrationPanel — Settings → RABBIT widget that moves a project's
// LEGACY attachment arrays into its file store (Track C, bundle C3;
// MASTER_PLAN §6 #31).
//
// Sits beside MigrationPanel and OtterMigrationPanel so all three migrations
// are found in one place, and follows the same two-button shape Audrey already
// knows: DRY-RUN reports what WOULD move and writes nothing; MOVE does it.
//
// 🚨 A DRY RUN FIRST IS NOT A SUGGESTION. This is the only irreversible thing
// in the C3 bundle: a moved attachment leaves the project row. The dry run is
// cheap (it measures base64 lengths, it does not decode anything) and it names
// every file too large to move, so nothing about the real run is a surprise.
// The MOVE button stays disabled until a dry run has been read.
// =============================================================================

import { useCallback, useState } from 'react'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'
import { adapterSupportsWrites } from '../../tools/rabbit_v0.1.0/adapters'
import { detectDocumentKind } from '../../tools/rabbit_v0.1.0/components/ProjectFilesTable'
import { runAttachmentMigration, MAX_ATTACHMENT_BYTES } from './runAttachmentMigration'
import { LIGHT_INK } from '../../components/lightSurface'

// MiB, and it says MiB. R1: the ceiling is a hard limit a person will run
// into, so rounding it into "64.0 MB" and being refused at 36 is the kind of
// small lie that costs an afternoon.
function fmtBytes(b) {
  if (!b) return '0 B'
  if (b < 1024) return `${b} B`
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KiB`
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MiB`
  return `${(b / 1073741824).toFixed(2)} GiB`
}

export default function AttachmentMigrationPanel() {
  const ctx = useRabbit()
  // 🚨 §6 #31 trap (f): the MODE, never `typeof adapter.uploadFile` — Drive's
  // is a function that throws.
  const canStoreFiles = adapterSupportsWrites(ctx?.adapterMode)

  const [busy, setBusy]         = useState(false)
  const [progress, setProgress] = useState([])
  const [report, setReport]     = useState(null)
  const [error, setError]       = useState(null)
  const [dryRunSeen, setDryRunSeen] = useState(false)

  const runOnce = useCallback(async (dryRun) => {
    if (busy || !canStoreFiles) return
    setBusy(true)
    setError(null)
    setReport(null)
    setProgress([])
    try {
      const r = await runAttachmentMigration({
        adapter: ctx?.getAdapter?.(),
        dryRun,
        detectKind: detectDocumentKind,
        onProgress: (msg) => setProgress((p) => [...p, msg]),
      })
      setReport(r)
      if (dryRun) setDryRunSeen(true)
      // The panel is the only reader of the project row's arrays, but D.O.G.
      // and the Projects page are not — a real move changes what both of them
      // show, so the provider is asked to re-read rather than left stale.
      if (!dryRun) { try { await ctx?.refreshProjectsIndex?.() } catch { /* best effort */ } }
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }, [busy, canStoreFiles, ctx])

  if (!canStoreFiles) {
    return (
      <div>
        <SectionHeading>Move deck attachments into project files</SectionHeading>
        <p className="text-xs text-stone-950 leading-relaxed">
          This backend is read-only, so attachments cannot be moved. Switch to
          Supabase or Local Server in Settings first.
        </p>
      </div>
    )
  }

  const moved = report && !report.dryRun

  return (
    <div>
      <SectionHeading>Move deck attachments into project files</SectionHeading>
      <p className="text-xs text-stone-950 mb-3 leading-relaxed">
        Older projects kept D.O.G.’s documents and visual assets on the project
        record itself. New ones are ordinary project files, which is what D.O.G.,
        the Projects page and RABBIT all read. This moves the old ones across —
        their <strong>Core</strong> marks come with them, so decks generate the
        same way afterwards. Dry-run first; the move is one-way, and files over{' '}
        {fmtBytes(MAX_ATTACHMENT_BYTES)} are listed and left where they are.
      </p>

      <div className="flex gap-2 mb-3">
        <MigrateButton onClick={() => runOnce(true)} disabled={busy}>
          {busy && !report ? 'CHECKING…' : 'DRY-RUN'}
        </MigrateButton>
        <MigrateButton onClick={() => runOnce(false)} disabled={busy || !dryRunSeen} primary>
          {busy && dryRunSeen ? 'MOVING…' : 'MOVE'}
        </MigrateButton>
      </div>

      {progress.length > 0 && (
        <pre className="text-[11px] font-mono bg-stone-900 text-stone-100 rounded-sm p-3 max-h-40 overflow-auto">
          {progress.join('\n')}
        </pre>
      )}

      {report && (
        <div className="mt-3">
          <div className="text-[11px] font-mono uppercase tracking-wider text-stone-700 mb-1">
            {report.dryRun ? 'Dry-run report' : 'Move report'}
          </div>
          <table className="text-[11px] font-mono">
            <tbody>
              <Row label="projects checked"        value={report.projects.total} />
              <Row label="with old attachments"    value={report.projects.withAttachments} />
              <Row label="attachments found"       value={report.attachments.found} />
              <Row label={report.dryRun ? 'would move' : 'moved'}
                   value={report.attachments.moved} good />
              <Row label={`too large (over ${fmtBytes(MAX_ATTACHMENT_BYTES)})`}
                   value={report.attachments.tooBig} />
              <Row label="empty records, left alone" value={report.attachments.empty} />
              <Row label="failed"                  value={report.attachments.failed} bad />
              <Row label={report.dryRun ? 'bytes to move' : 'bytes moved'}
                   value={fmtBytes(report.attachments.bytes)} />
            </tbody>
          </table>

          {report.oversize.length > 0 && (
            <div className="mt-2 text-[11px] font-mono" style={{ color: LIGHT_INK }}>
              Left in place (too large):
              <ul className="mt-1 ml-3 list-disc">
                {report.oversize.map((o, i) => (
                  <li key={i}>{o.projectTitle} — {o.name} ({fmtBytes(o.bytes)})</li>
                ))}
              </ul>
            </div>
          )}

          {report.errors.length > 0 && (
            <div className="mt-2 text-[11px] font-mono" style={{ color: '#991b1b' }}>
              <ul className="ml-3 list-disc">
                {report.errors.map((e, i) => (
                  <li key={i}>{e.name ? `${e.name}: ` : ''}{e.message}</li>
                ))}
              </ul>
            </div>
          )}

          {moved && report.errors.length === 0 && report.attachments.failed === 0 && (
            <div className="mt-2 text-[11px] font-mono" style={{ color: '#166534' }}>
              Done. These files now appear in each project’s Resources list and
              in RABBIT’s Files view.
            </div>
          )}
        </div>
      )}

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

function Row({ label, value, good, bad }) {
  const colour = bad && value ? '#991b1b' : good && value ? '#166534' : LIGHT_INK
  return (
    <tr>
      <td className="pr-3 py-0.5 text-stone-900">{label}</td>
      <td className="px-2 text-right" style={{ color: colour }}>{value}</td>
    </tr>
  )
}

function MigrateButton({ children, onClick, disabled, primary }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-3 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider rounded-sm transition-colors disabled:cursor-default"
      style={{
        backgroundColor: primary ? '#ea580c' : 'rgba(120, 70, 30, 0.18)',
        color: primary ? '#fff' : '#1c1917',
        border: primary ? '2px solid #ea580c' : '2px solid transparent',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  )
}
