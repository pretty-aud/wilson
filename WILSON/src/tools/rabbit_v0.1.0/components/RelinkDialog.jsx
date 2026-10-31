// ─────────────────────────────────────────────────────────────────────────────
// RelinkDialog — Session 14, Block A (storage relink — the headline feature).
//
// The ShotGrid/Blender "find missing files" model, as decided by Audrey
// (2026-07-29): find + preview + APPLY. Point WILSON at the folder where
// the files now live; the server walks it (relink-scan), the pure matcher
// (relinkMatcher.js) pairs dangling rows with found files, this dialog
// previews every proposed remap, and confirm applies them in one
// all-or-nothing server call (relink-apply). local_server only — the
// provider where folders actually move.
//
// THE PREVIEW IS THE SAFETY SURFACE: applying rewrites storage_path in
// bulk, so every row shows old path → new path before anything is written,
// and the confirm button states the exact count (the S13 approve-dialog
// pattern: say exactly what will happen, with numbers, before writing).
//
// UX laws applied (≥5 named, per the session requirement):
//   - Tesler's Law: the system absorbs the matching complexity (walk +
//     3-rung matcher); the user's decision is reduced to pick folder →
//     read the table → confirm.
//   - Cognitive Load / Working Memory: everything needed for the decision
//     is on ONE screen — matched, ambiguous and unmatched are chunked into
//     labelled groups (Chunking / Common Region) with counts.
//   - Hick's Law: one primary action per step (Choose folder → Relink N).
//   - Von Restorff: the confirm is the single filled-orange control.
//   - Doherty Threshold: scanning shows an immediate spinner state;
//     applying disables the confirm with feedback.
//   - Peak-End Rule: success ends on a green summary stating what changed.
//   - Postel's Law: any folder is accepted for scanning; the APPLY is
//     conservative — server-side containment + existence checks, and a 409
//     (stranding / vanished file) surfaces as a readable error, not a write.
//
// UI overhaul B4c, surface 7 (2026-09-25): the kit Dialog (R4-12) on lane
// B4's sheet, rabbitFiles.css (`rb-relink-`), portalled into <body> as the
// lane's other dialogs are (the kit Dialog does not portal, B4-KR-2). It
// keeps its 640px: the two tokens either side, 560 and 720, are 80 away each,
// and the preview's paths are what the width is for. The kit brings the one
// backdrop (a press there still closes it), surface, radius and shadow, the
// title at the H2 step in sentence case (it was capitals), the named Close,
// Escape and the focus trap (Q17), and `busy` while the apply runs — which
// holds the Close, Escape and the backdrop, as the hand-rolled one held its
// Close and its backdrop. The buttons are the kit's: Relink N and Done the
// primary, the rest secondary. Prose is the dialog's sans at the Body step;
// only a path is in the mono (R4-32). The error, the base-change disclosure
// and the success summary are the kit Banner; a proposal's confidence is the
// kit StatusBadge; the two waits are the kit Spinner; an empty group is the
// kit EmptyState. Every step, message and control does what it did (C1). It
// is reachable only in Local Server mode, so rabbitOverlaysRender.test.jsx
// proves it, not the walk. No window.confirm here.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FolderSearch, Check, AlertTriangle } from 'lucide-react'
import { Dialog, Button, Banner, Spinner, StatusBadge, EmptyState } from '../../../ui'
import '../views/rabbitFiles.css'
import { useRabbit } from '../state/RabbitProvider'
import { matchMissingFiles } from './relinkMatcher'

// A proposal's confidence: its words, and the tone of the kit StatusBadge
// that says them (the words were coloured text).
const CONFIDENCE_LABEL = {
  exact:  { text: 'Exact match', tone: 'success' },
  strong: { text: 'Name + size', tone: 'success' },
  name:   { text: 'Name only',   tone: 'warning' },
}

export default function RelinkDialog({ projectId, onClose, onApplied }) {
  const { getAdapter } = useRabbit()
  const [phase, setPhase] = useState('idle') // idle | scanning | preview | applying | done
  const [error, setError] = useState(null)
  const [scan, setScan] = useState(null)        // { filesDir, missing, resolved }
  const [folder, setFolder] = useState(null)
  const [match, setMatch] = useState(null)      // matcher output
  const [walkTruncated, setWalkTruncated] = useState(false)
  const [applied, setApplied] = useState(null)  // { relinked, filesDir }
  const mountedRef = useRef(true)
  // StrictMode-safe (EditHistoryDrawer's fix): React's dev double mount runs
  // this cleanup once before the real mount, and a body that did not set the
  // flag back left it false — so in a dev build the census never landed and
  // a scan never reached the preview. A production build mounts once and is
  // unchanged.
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Initial dangling-file census (no folder yet).
  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const res = await getAdapter()?.relinkScan?.(projectId)
        if (live && mountedRef.current) setScan(res)
      } catch (err) {
        if (live && mountedRef.current) setError(err.message || String(err))
      }
    })()
    return () => { live = false }
  }, [getAdapter, projectId])

  const pickAndScan = useCallback(async () => {
    setError(null)
    const dir = await window.electronAPI?.rabbit?.pickDirectory?.()
    if (!dir) return
    setFolder(dir)
    setPhase('scanning')
    try {
      const res = await getAdapter()?.relinkScan?.(projectId, dir)
      if (!mountedRef.current) return
      setScan(res)
      setWalkTruncated(!!res.walkTruncated)
      setMatch(matchMissingFiles(res.missing, res.candidates || []))
      setPhase('preview')
    } catch (err) {
      if (!mountedRef.current) return
      setError(err.message || String(err))
      setPhase('idle')
    }
  }, [getAdapter, projectId])

  const apply = useCallback(async () => {
    if (!match || match.proposals.length === 0) return
    setPhase('applying')
    setError(null)
    try {
      const res = await getAdapter()?.relinkApply?.(
        projectId,
        folder,
        match.proposals.map(p => ({ fileId: p.id, newPath: p.newPath })),
      )
      if (!mountedRef.current) return
      setApplied(res)
      setPhase('done')
      onApplied?.(res)
    } catch (err) {
      if (!mountedRef.current) return
      setError(err.message || String(err))
      setPhase('preview')
    }
  }, [getAdapter, projectId, folder, match, onApplied])

  const missingCount = scan?.missing?.length ?? 0

  return createPortal(
    <Dialog
      width={640}
      // A title that is a node names nothing: the dialog carries its title
      // as its name.
      aria-label="Relink missing files"
      title={(
        <span className="rb-relink-title">
          <FolderSearch className="rb-relink-icon" aria-hidden="true" />
          Relink missing files
        </span>
      )}
      // A press on the backdrop closes it, as a click there did — except
      // while the apply runs, which `busy` holds.
      dismissOnBackdrop
      busy={phase === 'applying'}
      onClose={onClose}
      footer={phase === 'done' ? (
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      ) : (
        <>
          <Button onClick={onClose} disabled={phase === 'applying'}>
            Cancel
          </Button>
          {/* Folder picking stays available when the census FAILED —
              the folder scan recomputes `missing` server-side, so a
              transient census error must not strand the dialog
              (adversarial review, S14). Disabled only while the census
              is in flight, or when it proved nothing is missing. */}
          {(phase === 'idle' || phase === 'preview') && (
            <Button onClick={pickAndScan} disabled={scan == null ? !error : missingCount === 0}>
              {phase === 'preview' ? 'Pick a different folder' : 'Choose folder…'}
            </Button>
          )}
          {phase === 'preview' && (
            <Button variant="primary" onClick={apply} disabled={!match || match.proposals.length === 0}>
              Relink {match?.proposals.length ?? 0} file{(match?.proposals.length ?? 0) === 1 ? '' : 's'}
            </Button>
          )}
        </>
      )}
    >
      <div className="rb-relink-body">
        {error && (
          <Banner tone="danger" Icon={AlertTriangle} className="rb-relink-error">
            {error}
          </Banner>
        )}

        {phase === 'idle' && (
          <>
            <p className="rb-relink-prose">
              {scan == null
                ? 'Checking which files are missing on disk…'
                : missingCount === 0
                  ? 'Every file in this project resolves on disk — nothing needs relinking.'
                  : `${missingCount} file${missingCount === 1 ? '' : 's'} in this project cannot be found on disk. ` +
                    'Choose the folder the files now live in; WILSON walks it and matches them by name and size.'}
            </p>
            {scan != null && missingCount > 0 && (
              <div className="rb-relink-missing">
                {scan.missing.map(f => (
                  <div key={f.id} className="rb-relink-missing-row" title={f.storage_path}>
                    {f.name} <span className="rb-relink-missing-path">· {f.storage_path}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {phase === 'scanning' && (
          <div className="rb-relink-progress">
            <Spinner size="md" />
            <span>Walking <span className="rb-relink-path">{folder}</span>…</span>
          </div>
        )}

        {phase === 'preview' && match && (
          <>
            <p className="rb-relink-prose">
              Searched <span className="rb-relink-path">{folder}</span>
              {walkTruncated && <span className="rb-relink-capped"> (large folder — walk was capped; unmatched files may exist deeper)</span>}
            </p>
            {/* Base-change disclosure (adversarial review, S14): applying
                also repoints where NEW uploads are saved — say so BEFORE
                the write, not after. */}
            {scan?.filesDir && folder && match.proposals.length > 0
              && folder.toLowerCase() !== String(scan.filesDir).toLowerCase() && (
              <Banner tone="warning">
                This also makes the picked folder the project's files
                folder — new uploads will be saved there. You can reset it
                later under Files &amp; storage.
              </Banner>
            )}

            <PreviewGroup label={`Will relink (${match.proposals.length})`} tone="success" empty="No matches found in that folder.">
              {match.proposals.map(p => {
                const conf = CONFIDENCE_LABEL[p.confidence] || { text: p.confidence, tone: 'neutral' }
                return (
                  <div key={p.id} className="rb-relink-row">
                    <div className="rb-relink-row-head">
                      <span className="rb-relink-name">{p.name}</span>
                      <StatusBadge tone={conf.tone} label={conf.text} />
                    </div>
                    <s className="rb-relink-old" title={p.oldPath}>{p.oldPath}</s>
                    <span className="rb-relink-new" title={p.newPath}>
                      → {p.newPath}
                    </span>
                  </div>
                )
              })}
            </PreviewGroup>

            {match.ambiguous.length > 0 && (
              <PreviewGroup label={`Ambiguous — left untouched (${match.ambiguous.length})`} tone="warning">
                {match.ambiguous.map(a => (
                  <div key={a.id} className="rb-relink-row">
                    <span className="rb-relink-name">{a.name}</span>
                    <span className="rb-relink-note">
                      {a.candidates.length} same-name candidates — rename or remove duplicates, then rescan.
                    </span>
                  </div>
                ))}
              </PreviewGroup>
            )}

            {match.unmatched.length > 0 && (
              <PreviewGroup label={`Still missing (${match.unmatched.length})`} tone="danger">
                {match.unmatched.map(u => (
                  <div key={u.id} className="rb-relink-unmatched" title={u.oldPath}>
                    {u.name}
                  </div>
                ))}
              </PreviewGroup>
            )}
          </>
        )}

        {phase === 'applying' && (
          <div className="rb-relink-progress">
            <Spinner size="md" />
            <span>Relinking {match?.proposals.length} file{match?.proposals.length === 1 ? '' : 's'}…</span>
          </div>
        )}

        {phase === 'done' && applied && (
          <Banner tone="success" Icon={Check}>
            <span className="rb-relink-done">Relinked {applied.relinked} file{applied.relinked === 1 ? '' : 's'}.</span>{' '}
            This project's files now resolve from{' '}
            <span className="rb-relink-path">{applied.filesDir}</span>.
            Each relink is recorded in the file's activity stream.
          </Banner>
        )}
      </div>
    </Dialog>,
    document.body,
  )
}

// A labelled group with its count and its tone (the tone is the label's
// ink, read by the sheet from `data-tone`), an empty line of its own, and a
// bounded scroll.
function PreviewGroup({ label, tone, empty, children }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : !!children
  return (
    <div className="rb-relink-group">
      <div className="rb-relink-group-head" data-tone={tone}>
        {label}
      </div>
      <div className="rb-relink-group-list">
        {hasChildren ? children : <EmptyState compact title={empty} />}
      </div>
    </div>
  )
}
