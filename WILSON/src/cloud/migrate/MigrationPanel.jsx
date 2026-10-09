// =============================================================================
// MigrationPanel — Settings → RABBIT widget that orchestrates the single-user
// → cloud migration.
//
// Flow:
//   1. User clicks DRY-RUN — runMigration with dryRun:true reports what WOULD
//      be migrated. Nothing is written.
//   2. User reviews the counts + error list — and, since BC3 (Audrey's B9,
//      "bins move with the project"), answers ONE question per footage root
//      the dry run found: which footage location is this folder? An existing
//      location of the company by its network address, a new one named now,
//      or left on this computer for now (its clips are listed, never dropped;
//      a later run brings them). Migrate waits until every root is answered.
//   3. User clicks MIGRATE — runMigration for real; progress streams to the
//      console area as projects are processed.
//   4. On success, we ask the Electron main process to archive the local
//      rabbit-data directory to a timestamped .json and clear the live stores
//      so the user is fully cloud-first afterward (user-selected option in
//      the Session 2 kickoff).
//
// Laws of UX that shaped the question (laws-of-ux + design-direction, BC3):
//   Tesler's law — the system absorbs what it can: a network root is matched
//     to the company's location that already holds it, or offered its share
//     as a new one; only a drive letter needs the person (the cloud refuses
//     a drive letter as an address, B2).
//   Hick's law / Chunking — one row per root, one field that matters (the
//     address), the name only when a new location is being made.
//   Goal-gradient — "2 of 3 named" beside the group; Migrate lights up at
//     the last one.
//   Postel's law — an address pasted any way (smb://, forward slashes,
//     quotes) is read as the one shape the cloud stores, and refused before
//     the run with the cloud's own sentence.
//   Working memory — what each answer will DO is written under it (the
//     location, the clips' path inside it) before anything is written.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePermissions } from '../../permissions'
import { runMigration, BINS_LEFT_BEHIND, POSTERS_SWITCH_OFF } from './runMigration'
import { suggestedAnswer, resolveRootAnswer, LOCATION_QUESTION, LEAVE_FOR_NOW, NAME_IT_INSTEAD, MIGRATE_WAITS } from './binsMigration'
import { normalizeUncInput } from '../../tools/rabbit_v0.1.0/bins/binLocations'
import '../../components/settings/settings.css'
import { Section, Group, Row, Note } from '../../components/settings/SettingsChrome'
import { Button, Input } from '../../ui'

export const MIGRATE_TITLE = 'Migrate to cloud'

export default function MigrationPanel() {
  // The active workspace, as every gate reads it (the session's claims; the
  // dev fixtures' in a dev build) — one source, not a second session read.
  const { workspaceId: activeWorkspaceId, ready } = usePermissions()
  const [busy, setBusy]         = useState(false)
  const [progress, setProgress] = useState([])
  const [report, setReport]     = useState(null)
  const [archived, setArchived] = useState(false)
  const [error, setError]       = useState(null)
  // BC3: the answers to the roots' question, keyed by the root's key.
  const [answers, setAnswers]   = useState({})

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
        locations: answers,
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
  }, [busy, activeWorkspaceId, answers])

  // Each root the dry run found starts from what the system can suggest
  // (an answer already given is kept).
  useEffect(() => {
    if (!report?.dryRun || !report.footageRoots?.length) return
    setAnswers((prev) => {
      const next = { ...prev }
      for (const root of report.footageRoots) if (!next[root.key]) next[root.key] = { ...suggestedAnswer(root, report.footageLocations || []), skip: false }
      return next
    })
  }, [report])

  const roots = report?.footageRoots || []
  const resolved = useMemo(() => Object.fromEntries(roots.map((root) => [root.key, resolveRootAnswer(root, answers[root.key], report?.footageLocations || [])])), [roots, answers, report])
  const answered = roots.filter((r) => ['existing', 'new', 'skip'].includes(resolved[r.key]?.kind)).length
  const everyRootAnswered = roots.length === 0 || answered === roots.length
  const setAnswer = (key, patch) => setAnswers((a) => ({ ...a, [key]: { ...(a[key] || { unc_path: '', name: '', skip: false }), ...patch } }))

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

  if (!ready || !activeWorkspaceId) {
    return (
      <Section
        title={MIGRATE_TITLE}
        description="Sign in to enable cloud migration for your R.A.B.B.I.T. data."
      />
    )
  }

  const completed = report && !report.dryRun && report.errors.length === 0
  // The real run waits for a dry run that found the roots, and for their
  // answers (never a disabled control without its reason: the title says).
  const migrateWhy = !report ? 'Dry-run first: it lists what will move and asks about each footage root.'
    : !everyRootAnswered ? MIGRATE_WAITS
      : completed ? 'Done. Re-running changes nothing: rows already in the cloud are skipped.' : null

  return (
    <Section
      title={MIGRATE_TITLE}
      description={<>
        Copy every project under <span className="s-data">rabbit-data</span> into the active
        workspace: its schedule, assets, tasks, files, scenes and shots, and its bins with
        their logging, marks and takes. Dry-run first to preview the diff. Re-running the full
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
          <MigrateButton onClick={() => runOnce(false)} disabled={busy || completed || !report || !everyRootAnswered} primary title={migrateWhy || undefined}>
            {busy && report ? 'Migrating…' : 'Migrate'}
          </MigrateButton>
          {completed && (
            <MigrateButton onClick={archiveAndClear} disabled={busy || archived}>
              {archived ? 'Archived' : 'Archive and clear local'}
            </MigrateButton>
          )}
        </Row>
      </Group>

      {/* BC3 (B9): the question, once per footage root the dry run found. */}
      {report?.dryRun && roots.length > 0 && (
        <Group label="Footage locations" actions={<span className="s-row-desc" data-testid="roots-progress">{answered} of {roots.length} answered</span>}>
          <Note>
            A clip in the cloud is a footage location — the company&apos;s share, saved once by its
            network address like <span className="s-data">\\server\footage</span> — plus its path
            inside it, the same on every computer. Each folder these clips were added from is
            named once: an existing location of the company by its address, or a new one. A
            folder left unnamed keeps its clips on this computer; they are listed in the report,
            and a later run brings them.
          </Note>
          {roots.map((root) => {
            const a = answers[root.key] || { unc_path: '', name: '', skip: false }
            const r = resolved[root.key] || { kind: 'unanswered' }
            const id = `root-${root.key.replace(/[^a-z0-9]+/gi, '-')}`
            return (
              <div key={root.key} className="s-row" data-stacked="true" data-footage-root={root.root} data-resolved={r.kind}>
                <div className="s-row-label">
                  <label className="s-label" htmlFor={id}>{LOCATION_QUESTION}</label>
                  <p className="s-row-desc">
                    <span className="s-data">{root.root}</span>
                    <br />
                    {root.count} clip{root.count === 1 ? '' : 's'} in {root.projects.length} project{root.projects.length === 1 ? '' : 's'} · {root.kind === 'unc' ? 'a share on the network' : 'a folder on this computer: give its address as the network sees it'}
                  </p>
                </div>
                {!a.skip && (
                  <div className="flex gap-2 flex-wrap">
                    <Input id={id} surface="light" size="sm" aria-label="Network address" value={a.unc_path} onChange={(v) => setAnswer(root.key, { unc_path: v })}
                      onBlur={() => setAnswer(root.key, { unc_path: normalizeUncInput(a.unc_path) })}
                      placeholder={'\\\\server\\footage'} className="flex-[2] min-w-[220px] s-data" />
                    {r.kind === 'new' || (r.kind !== 'existing' && a.name) ? (
                      <Input surface="light" size="sm" aria-label="Location name" value={a.name} onChange={(v) => setAnswer(root.key, { name: v })} placeholder="Footage NAS" className="flex-1 min-w-[160px]" />
                    ) : null}
                  </div>
                )}
                <div className="s-row-control">
                  {a.skip
                    ? <Button surface="light" size="sm" variant="secondary" onClick={() => setAnswer(root.key, { skip: false })}>{NAME_IT_INSTEAD}</Button>
                    : <Button surface="light" size="sm" variant="ghost" onClick={() => setAnswer(root.key, { skip: true })} title="Its clips stay on this computer, listed in the report; a later run brings them once it is named.">{LEAVE_FOR_NOW}</Button>}
                </div>
                <p className={r.kind === 'invalid' ? 's-feedback' : 's-row-desc'} data-tone={r.kind === 'invalid' ? 'error' : undefined} role={r.kind === 'invalid' ? 'alert' : undefined} data-testid="root-resolution">
                  {resolutionWords(root, r)}
                </p>
              </div>
            )
          })}
        </Group>
      )}

      {/* ⚠️ The expression inside <pre> sits where it sits on purpose:
          whitespace here is rendered output, so re-indenting it changes the
          log. Only the class moves. */}
      {progress.length > 0 && (
        <pre className="s-log mt-4" data-surface="dark">
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

/** What an answer will do, in words, before anything is written. */
function resolutionWords(root, r) {
  const n = root.count
  const clips = `${n} clip${n === 1 ? '' : 's'}`
  switch (r.kind) {
    case 'existing': return `The company's "${r.location.name}" (${r.location.unc_path}): ${clips} at ${r.prefix ? `${r.prefix}/…` : 'its top'}.`
    case 'new': return `A new location "${r.name}" at ${r.unc_path}: ${clips} at ${r.prefix ? `${r.prefix}/…` : 'its top'}.`
    case 'skip': return `Left on this computer: ${clips} ${n === 1 ? 'stays' : 'stay'}, listed in the report; a later run brings ${n === 1 ? 'it' : 'them'} once this folder is named.`
    case 'invalid': return r.problem
    default: return `Type the folder's network address, like \\\\server\\footage, or leave it for now.`
  }
}

// The private button is gone: this is the kit Button, so the migration panels
// stop being a ninth and tenth button treatment in the app (C8). `primary`
// maps to the one filled primary token; everything else is secondary, which
// is what makes "Dry-run first" read as the safe default it is meant to be.
function MigrateButton({ children, onClick, disabled, primary, title }) {
  return (
    <Button
      surface="light"
      size="sm"
      variant={primary ? 'primary' : 'secondary'}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </Button>
  )
}

function ReportTable({ r }) {
  const Row = ({ label, bucket }) => (
    <tr>
      <td>{label}</td>
      <td>{bucket.total}</td>
      <td>{bucket.inserted}</td>
      <td>{bucket.skipped}</td>
      <td className="s-report-cell" data-failed={!!bucket.failed}>{bucket.failed}</td>
    </tr>
  )
  const posters = r.posters ? { total: r.posters.total, inserted: r.posters.uploaded, skipped: r.posters.skipped, failed: r.posters.failed } : null
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
            <th scope="col">{r.dryRun ? 'Would insert' : 'Inserted'}</th>
            <th scope="col">Skipped</th>
            <th scope="col">Failed</th>
          </tr>
        </thead>
        <tbody>
          <Row label="projects" bucket={r.projects} />
          <Row label="phases"   bucket={r.phases} />
          <Row label="assets"   bucket={r.assets} />
          <Row label="tasks"    bucket={r.tasks} />
          <Row label="task links"  bucket={r.taskLinks} />
          <Row label="phase links" bucket={r.phaseLinks} />
          <Row label="files"    bucket={r.files} />
          {/* BC3 (B9): the bins' part. */}
          {r.scenes && <Row label="scenes" bucket={r.scenes} />}
          {r.shots && <Row label="shots" bucket={r.shots} />}
          {r.bins && <Row label="bins" bucket={r.bins} />}
          {r.binLocations && <Row label="footage locations" bucket={r.binLocations} />}
          {r.binFiles && <Row label="clips" bucket={r.binFiles} />}
          {r.shotTakes && <Row label="takes" bucket={r.shotTakes} />}
          {posters && <Row label="pictures" bucket={posters} />}
        </tbody>
      </table>
      {r.files.bytes > 0 && (
        <p className="s-row-desc mt-2">
          Uploaded {(r.files.bytes / 1_000_000).toFixed(1)} MB to rabbit-files bucket.
        </p>
      )}
      {r.binFiles?.leftBehind > 0 && (
        <div className="mt-2" data-testid="clips-left-behind">
          <p className="s-row-desc">{BINS_LEFT_BEHIND(r.binFiles.leftBehind)}.</p>
          <ul className="s-data s-row-desc mt-1 space-y-1">
            {(r.clipsLeftBehind || []).slice(0, 20).map((c) => (
              <li key={`${c.projectId}:${c.id}`}>{c.name}{c.root ? ` · ${c.root}` : ''}</li>
            ))}
            {(r.clipsLeftBehind || []).length > 20 && <li>… {r.clipsLeftBehind.length - 20} more</li>}
          </ul>
        </div>
      )}
      {r.posters?.switchOff > 0 && (
        <p className="s-row-desc mt-2" data-testid="posters-switch-off">
          {r.posters.switchOff} picture{r.posters.switchOff === 1 ? '' : 's'}: {POSTERS_SWITCH_OFF}.
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
