// =============================================================================
// AttachmentMigrationPanel — Settings → Storage panel (the tab's key is still
// `rabbit`) that moves a project's LEGACY attachment arrays into its file
// store (Track C, bundle C3; MASTER_PLAN §6 #31).
//
// Sits beside MigrationPanel and OtterMigrationPanel so all three migrations
// are found in one place, and follows the same two-button shape Audrey already
// knows: Dry-run reports what WOULD move and writes nothing; Move does it.
//
// 🚨 A DRY RUN FIRST IS NOT A SUGGESTION. This is the only irreversible thing
// in the C3 bundle: a moved attachment leaves the project row. The dry run is
// cheap (it measures base64 lengths, it does not decode anything) and it names
// every file too large to move, so nothing about the real run is a surprise.
// The Move button stays disabled until a dry run has been read.
//
// Post-overhaul merge (2026-09-30): on Settings' row contract (SettingsChrome)
// and the kit Button, exactly as its two siblings are. The track wrote it in
// the pre-overhaul idiom — a capitalised heading, a hand-rolled button, inline
// hexes, arbitrary text sizes — and the overhaul's guards refuse all four.
// Same two buttons, same report, same copy; only the chrome is the page's.
// =============================================================================

import { useCallback, useState } from 'react'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'
import { adapterSupportsWrites } from '../../tools/rabbit_v0.1.0/adapters'
import { detectDocumentKind } from '../../tools/rabbit_v0.1.0/components/ProjectFilesTable'
import { runAttachmentMigration, MAX_ATTACHMENT_BYTES } from './runAttachmentMigration'
import '../../components/settings/settings.css'
import { Section, Group, Row } from '../../components/settings/SettingsChrome'
import { Button } from '../../ui'

const TITLE = 'Move deck attachments into project files'

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
      <Section
        title={TITLE}
        description="This backend is read-only, so attachments cannot be moved. Switch to Supabase or Local Server in Settings first."
      />
    )
  }

  const moved = report && !report.dryRun

  return (
    <Section
      title={TITLE}
      description={<>
        Older projects kept D.O.G.’s documents and visual assets on the project
        record itself. New ones are ordinary project files, which is what D.O.G.,
        the Projects page and R.A.B.B.I.T. all read. This moves the old ones
        across — their <strong>Core</strong> marks come with them, so decks
        generate the same way afterwards. Dry-run first; the move is one-way,
        and files over {fmtBytes(MAX_ATTACHMENT_BYTES)} are listed and left
        where they are.
      </>}
    >
      <Group>
        {/* Sentence case, as the two sibling panels' buttons are (Q2). */}
        <Row label="Migration">
          <MigrateButton onClick={() => runOnce(true)} disabled={busy}>
            {busy && !report ? 'Checking…' : 'Dry-run'}
          </MigrateButton>
          <MigrateButton onClick={() => runOnce(false)} disabled={busy || !dryRunSeen} primary>
            {busy && dryRunSeen ? 'Moving…' : 'Move'}
          </MigrateButton>
        </Row>
      </Group>

      {/* Whitespace inside <pre> is rendered output; only the class moves. */}
      {progress.length > 0 && (
        <pre className="s-log mt-4" data-surface="dark">
          {progress.join('\n')}
        </pre>
      )}

      {report && <AttachmentReport r={report} />}

      {moved && report.errors.length === 0 && report.attachments.failed === 0 && (
        <p className="s-feedback mt-4" data-tone="ok" role="status">
          Done. These files now appear in each project’s Resources list and on
          R.A.B.B.I.T.’s Summary tab, under Project files.
        </p>
      )}

      {error && (
        <p className="s-feedback mt-4" data-tone="error" role="alert">{error}</p>
      )}
    </Section>
  )
}



// The kit Button, as the sibling panels have it: `primary` is the one filled
// primary token; everything else is secondary, which is what makes "Dry-run
// first" read as the safe default it is meant to be.
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

function AttachmentReport({ r }) {
  const dry = r.dryRun
  const Line = ({ label, value, failed }) => (
    <tr>
      <td>{label}</td>
      {failed !== undefined
        ? <td className="s-report-cell" data-failed={!!failed}>{value}</td>
        : <td>{value}</td>}
    </tr>
  )
  return (
    <div className="mt-4">
      {/* The sibling panels' table contract (`s-table`): a real <table> on
          the Table tokens, one hairline, right-aligned figures. Two columns,
          because a move has one count per line rather than a bucket per
          table. */}
      <table className="s-table">
        <caption>{dry ? 'Dry-run report' : 'Move report'}</caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Count</th>
          </tr>
        </thead>
        <tbody>
          <Line label="projects checked"        value={r.projects.total} />
          <Line label="with old attachments"    value={r.projects.withAttachments} />
          <Line label="attachments found"       value={r.attachments.found} />
          <Line label={dry ? 'would move' : 'moved'} value={r.attachments.moved} />
          <Line label={`too large (over ${fmtBytes(MAX_ATTACHMENT_BYTES)})`} value={r.attachments.tooBig} />
          <Line label="empty records, left alone" value={r.attachments.empty} />
          <Line label="failed"                  value={r.attachments.failed} failed={r.attachments.failed} />
          <Line label={dry ? 'bytes to move' : 'bytes moved'} value={fmtBytes(r.attachments.bytes)} />
        </tbody>
      </table>

      {/* Two disclosures, both closed by default and both hiding a LIST, not
          a control — the one <details> shape the surface allows (C1). */}
      {r.oversize.length > 0 && (
        <details className="mt-3">
          <summary className="s-label cursor-pointer">
            {r.oversize.length} left in place (too large)
          </summary>
          <ul className="s-data s-row-desc mt-2 space-y-1">
            {r.oversize.map((o, i) => (
              <li key={i}>{o.projectTitle} — {o.name} ({fmtBytes(o.bytes)})</li>
            ))}
          </ul>
        </details>
      )}

      {r.errors.length > 0 && (
        <details className="mt-3">
          <summary className="s-label cursor-pointer">
            {r.errors.length} error{r.errors.length === 1 ? '' : 's'}
          </summary>
          <ul className="s-data s-row-desc mt-2 space-y-1">
            {r.errors.map((e, i) => (
              <li key={i}>{e.name ? `${e.name}: ` : ''}{e.message}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
