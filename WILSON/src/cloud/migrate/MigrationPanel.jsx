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
import { runMigration, BINS_LEFT_BEHIND, POSTERS_SWITCH_OFF, ORPHAN_TAKES, NOT_CARRIED_SENTENCE } from './runMigration'
import { suggestedAnswer, resolveRootAnswer, confirmedAnswers, LOCATION_QUESTION, LEAVE_FOR_NOW, NAME_IT_INSTEAD, MIGRATE_WAITS } from './binsMigration'
import { normalizeUncInput } from '../../tools/rabbit_v0.1.0/bins/binLocations'
import '../../components/settings/settings.css'
import { Section, Group, Row, Note } from '../../components/settings/SettingsChrome'
import { Button, Input } from '../../ui'

export const MIGRATE_TITLE = 'Migrate to cloud'
export const USE_THIS_ADDRESS = 'Use this address'
export const MIGRATE_AGAIN_LEFT = (n) => `${n} clip${n === 1 ? ' is' : 's are'} still on this computer: name ${n === 1 ? 'its' : 'their'} footage location below and Migrate again.`
// A clip with no path recorded has no root to name (review round 2: the
// sentence above sent the person to a question that was not there).
export const NO_PATH_LEFT = (n) => `${n} clip${n === 1 ? ' has' : 's have'} no path recorded, so ${n === 1 ? 'it' : 'they'} cannot move: remove ${n === 1 ? 'it' : 'them'} from ${n === 1 ? 'its' : 'their'} bin on this computer, or keep this computer's copy.`
export const MIGRATE_DONE = 'Done. Re-running skips every row already in the cloud (and brings back a row removed from the cloud since).'
export const ARCHIVE_KEEPS_NOT_CARRIED = 'Archives every project on this computer, including what the migration does not carry (listed under the report), then clears the live copy.'

export default function MigrationPanel() {
  // The active workspace, as every gate reads it (the session's claims; the
  // dev fixtures' in a dev build) — one source, not a second session read.
  const { workspaceId: activeWorkspaceId, ready } = usePermissions()
  const [busy, setBusy]         = useState(false)
  // Which run is on ('dry' | 'real' | null): the pressed button says so. The
  // last report stays on screen meanwhile — the question with it (review
  // round 2: clearing the report at the start of a run made the question
  // vanish for the run's length, and "Migrating…" was never shown).
  const [running, setRunning]   = useState(null)
  const [progress, setProgress] = useState([])
  const [report, setReport]     = useState(null)
  const [archived, setArchived] = useState(null)
  const [error, setError]       = useState(null)
  // BC3: the answers to the roots' question, keyed by the root's key.
  const [answers, setAnswers]   = useState({})

  const runOnce = useCallback(async (dryRun) => {
    if (busy || !activeWorkspaceId) return
    setBusy(true)
    setRunning(dryRun ? 'dry' : 'real')
    setError(null)
    setArchived(null)
    setProgress([])
    try {
      const r = await runMigration({
        workspaceId: activeWorkspaceId,
        dryRun,
        // Only an answer the person gave (typed, "Use this address", left
        // for now) or one the company's list gives (an address one of its
        // locations holds) reaches the run; a suggested NEW location nobody
        // touched does not.
        locations: confirmedAnswers(answers, report?.footageLocations || []),
        onProgress: (msg) => setProgress((p) => [...p, msg]),
      })
      setReport(r)
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
      setRunning(null)
    }
  }, [busy, activeWorkspaceId, answers, report])

  // Each root a run found (a dry run, or a real one that left a root
  // unnamed) starts from what the system can suggest; an answer already
  // given is kept. (A suggestion nobody touched that a teammate's new
  // location has since come to hold is the company's answer: resolved as
  // "existing" below, and sent by confirmedAnswers — review round 2.)
  useEffect(() => {
    if (!report?.footageRoots?.length) return
    setAnswers((prev) => {
      const next = { ...prev }
      for (const root of report.footageRoots) if (!next[root.key]) next[root.key] = { ...suggestedAnswer(root, report.footageLocations || []), skip: false }
      return next
    })
  }, [report])

  const roots = report?.footageRoots || []
  const resolved = useMemo(() => Object.fromEntries(roots.map((root) => [root.key, resolveRootAnswer(root, answers[root.key], report?.footageLocations || [])])), [roots, answers, report])
  // Answered: a company location (the company gave that answer), a NEW one
  // the person confirmed, or left for now. A suggested share nobody touched
  // is not an answer (a new company location comes only from an address the
  // person confirmed, never from a project file alone).
  const isAnswered = (r) => {
    const k = resolved[r.key]?.kind
    return k === 'existing' || k === 'skip' || (k === 'new' && answers[r.key]?.confirmed !== false)
  }
  const answered = roots.filter(isAnswered).length
  const everyRootAnswered = roots.length === 0 || answered === roots.length
  // What confirms a suggested address: typing in the address field, or "Use
  // this address" — and nothing else (review round 2: leaving the field,
  // tabbing through the row, "Leave for now" and "Name it" all confirmed
  // it; a keyboard never reached the button). Each caller says.
  const setAnswer = (key, patch) => setAnswers((a) => ({ ...a, [key]: { ...(a[key] || { unc_path: '', name: '', skip: false }), ...patch } }))

  const archiveAndClear = useCallback(async () => {
    const api = window.electronAPI?.rabbit
    if (!api?.archiveLocalData || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.archiveLocalData()
      if (!res?.ok) throw new Error(res?.error || 'archive failed')
      setArchived({ path: res.archivePath || null })
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

  // Done means done: nothing failed AND nothing was left on this computer
  // (review round 1: a run that left a root's clips here must not offer to
  // archive and clear the only copy of them).
  const leftBehind = report && !report.dryRun ? (report.binFiles?.leftBehind || 0) : 0
  // Of those, the clips with a root to name below; the rest have no path
  // recorded, and no question (review round 2).
  const leftRooted = report && !report.dryRun ? (report.clipsLeftBehind || []).filter((c) => c.root).length : 0
  const leftNoPath = Math.max(0, leftBehind - leftRooted)
  const completed = report && !report.dryRun && report.errors.length === 0 && leftBehind === 0
  const notCarried = report?.notCarried || []
  // The real run waits for a dry run that found the roots, and for their
  // answers (never a disabled control without its reason: the title says).
  const migrateWhy = !report ? 'Dry-run first: it lists what will move and asks about each footage root.'
    : !everyRootAnswered ? MIGRATE_WAITS
      : completed ? MIGRATE_DONE
        : leftRooted ? MIGRATE_AGAIN_LEFT(leftRooted)
          : leftNoPath ? NO_PATH_LEFT(leftNoPath) : null

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
            {running === 'dry' ? 'Running…' : 'Dry-run'}
          </MigrateButton>
          <MigrateButton onClick={() => runOnce(false)} disabled={busy || completed || !report || !everyRootAnswered} primary title={migrateWhy || undefined}>
            {running === 'real' ? 'Migrating…' : 'Migrate'}
          </MigrateButton>
          {completed && (
            <MigrateButton onClick={archiveAndClear} disabled={busy || !!archived} title={notCarried.length ? ARCHIVE_KEEPS_NOT_CARRIED : undefined}>
              {archived ? 'Archived' : 'Archive and clear local'}
            </MigrateButton>
          )}
        </Row>
      </Group>

      {/* BC3 (B9): the question, once per footage root a run found (after a
          real run too: a root left for now is named here and run again). */}
      {roots.length > 0 && (
        <Group label="Footage locations" actions={<span className="s-row-desc" data-testid="roots-progress">{answered} of {roots.length} answered</span>}>
          <Note>
            A clip in the cloud is a footage location — the company&apos;s share, saved once by its
            network address like <span className="s-data">\\server\footage</span> — plus its path
            inside it, the same on every computer. Each folder these clips were added from is
            named once: an existing location of the company by its address, or a new one. A
            folder left unnamed keeps its clips on this computer; they are listed in the report,
            and a later run brings them.
          </Note>
          {roots.map((root, i) => {
            const a = answers[root.key] || { unc_path: '', name: '', skip: false }
            const r = resolved[root.key] || { kind: 'unanswered' }
            const suggestion = r.kind === 'new' && a.confirmed === false
            const id = `root-${i}`
            return (
              <div key={root.key} className="s-row" data-stacked="true" data-footage-root={root.root} data-resolved={suggestion ? 'suggested' : r.kind}>
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
                    {/* Typing the address confirms it; leaving the field only tidies its spelling. */}
                    <Input id={id} surface="light" size="sm" aria-label="Network address" value={a.unc_path} onChange={(v) => setAnswer(root.key, { unc_path: v, confirmed: true })}
                      onBlur={() => setAnswer(root.key, { unc_path: normalizeUncInput(a.unc_path) })}
                      placeholder={'\\\\server\\footage'} className="flex-[2] min-w-[220px] s-data" />
                    {r.kind === 'new' || (r.kind !== 'existing' && a.name) ? (
                      <Input surface="light" size="sm" aria-label="Location name" value={a.name} onChange={(v) => setAnswer(root.key, { name: v })} placeholder="Footage NAS" className="flex-1 min-w-[160px]" />
                    ) : null}
                  </div>
                )}
                <div className="s-row-control">
                  {suggestion && (
                    <Button surface="light" size="sm" variant="primary" onClick={() => setAnswer(root.key, { confirmed: true })} title="Make this new footage location at the address suggested from the share.">{USE_THIS_ADDRESS}</Button>
                  )}
                  {a.skip
                    ? <Button surface="light" size="sm" variant="secondary" onClick={() => setAnswer(root.key, { skip: false })}>{NAME_IT_INSTEAD}</Button>
                    : <Button surface="light" size="sm" variant="ghost" onClick={() => setAnswer(root.key, { skip: true })} title="Its clips stay on this computer, listed in the report; a later run brings them once it is named.">{LEAVE_FOR_NOW}</Button>}
                </div>
                <p className={r.kind === 'invalid' ? 's-feedback' : 's-row-desc'} data-tone={r.kind === 'invalid' ? 'error' : undefined} role={r.kind === 'invalid' ? 'alert' : undefined} data-testid="root-resolution">
                  {suggestion ? `Suggested: ${resolutionWords(root, r)} ${USE_THIS_ADDRESS}, or type another.` : resolutionWords(root, r)}
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
          Local rabbit-data archived{archived.path ? <> to <span className="s-data">{archived.path}</span></> : null}. R.A.B.B.I.T. is now cloud-first.
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
          <p className="s-row-desc">{BINS_LEFT_BEHIND(r.binFiles.leftBehind)}{r.shotTakes?.leftBehind > 0 ? `, with ${r.shotTakes.leftBehind} take${r.shotTakes.leftBehind === 1 ? '' : 's'} of theirs` : ''}.</p>
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
      {r.shotTakes?.orphans > 0 && (
        <p className="s-row-desc mt-2" data-testid="orphan-takes">{ORPHAN_TAKES(r.shotTakes.orphans)}.</p>
      )}
      {/* Said BEFORE the archive is offered, so "Done" means what moved and
          this names what did not (review round 2). */}
      {r.notCarried?.length > 0 && (
        <p className="s-row-desc mt-2" data-testid="not-carried">{NOT_CARRIED_SENTENCE(r.notCarried)}</p>
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
