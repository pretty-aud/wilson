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
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react'
import { X, FolderSearch, Loader2, Check, AlertTriangle } from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
import { matchMissingFiles } from './relinkMatcher'

const CONFIDENCE_LABEL = {
  exact:  { text: 'exact match',  color: '#4ade80' },
  strong: { text: 'name + size',  color: '#4ade80' },
  name:   { text: 'name only',    color: '#fbbf24' },
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
  useEffect(() => () => { mountedRef.current = false }, [])

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

  return (
    <>
      <div className="fixed inset-0 z-[70]" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={phase === 'applying' ? undefined : onClose} />
      <div className="fixed left-1/2 top-1/2 z-[70] flex flex-col -translate-x-1/2 -translate-y-1/2 rounded-lg overflow-hidden"
        style={{ width: 640, maxWidth: 'calc(100vw - 48px)', maxHeight: 'calc(100vh - 96px)',
                 backgroundColor: '#1c1917', border: '1px solid #44403c', boxShadow: '0 0 60px rgba(0,0,0,0.6)' }}
        role="dialog" aria-label="Relink files">

        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0"
          style={{ backgroundColor: '#292524', borderBottom: '1px solid #44403c', borderLeft: '3px solid #ea580c' }}>
          <FolderSearch className="w-4 h-4 flex-shrink-0" style={{ color: '#fb923c' }} />
          <div className="flex-1 text-[12.5px] font-mono uppercase tracking-wider font-bold" style={{ color: '#fb923c' }}>
            Relink missing files
          </div>
          <button type="button" onClick={onClose} disabled={phase === 'applying'} title="Close"
            className="p-1.5 rounded hover:bg-stone-700 transition-colors flex-shrink-0" style={{ color: '#a8a29e' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
          {error && (
            <div className="text-[11px] font-mono px-3 py-2 rounded flex items-start gap-2"
              style={{ color: '#fca5a5', backgroundColor: 'rgba(153,27,27,0.15)', border: '1px solid #7f1d1d' }}>
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span className="min-w-0 break-words">{error}</span>
            </div>
          )}

          {phase === 'idle' && (
            <>
              <p className="text-[11.5px] font-mono leading-relaxed" style={{ color: '#a8a29e' }}>
                {scan == null
                  ? 'Checking which files are missing on disk…'
                  : missingCount === 0
                    ? 'Every file in this project resolves on disk — nothing needs relinking.'
                    : `${missingCount} file${missingCount === 1 ? '' : 's'} in this project cannot be found on disk. ` +
                      'Choose the folder the files now live in; WILSON walks it and matches them by name and size.'}
              </p>
              {scan != null && missingCount > 0 && (
                <div className="rounded px-3 py-2 max-h-40 overflow-y-auto flex flex-col gap-1"
                  style={{ backgroundColor: '#292524', border: '1px solid #44403c' }}>
                  {scan.missing.map(f => (
                    <div key={f.id} className="text-[10.5px] font-mono truncate" style={{ color: '#78716c' }} title={f.storage_path}>
                      {f.name} <span style={{ color: '#57534e' }}>· {f.storage_path}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {phase === 'scanning' && (
            <div className="flex items-center gap-2 text-[11.5px] font-mono px-1 py-4" style={{ color: '#a8a29e' }}>
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#fb923c' }} />
              Walking {folder}…
            </div>
          )}

          {phase === 'preview' && match && (
            <>
              <p className="text-[11.5px] font-mono leading-relaxed" style={{ color: '#a8a29e' }}>
                Searched <span style={{ color: '#fb923c' }}>{folder}</span>
                {walkTruncated && <span style={{ color: '#fbbf24' }}> (large folder — walk was capped; unmatched files may exist deeper)</span>}
              </p>
              {/* Base-change disclosure (adversarial review, S14): applying
                  also repoints where NEW uploads are saved — say so BEFORE
                  the write, not after. */}
              {scan?.filesDir && folder && match.proposals.length > 0
                && folder.toLowerCase() !== String(scan.filesDir).toLowerCase() && (
                <p className="text-[10.5px] font-mono leading-relaxed px-3 py-2 rounded"
                  style={{ color: '#fbbf24', backgroundColor: 'rgba(146,64,14,0.15)', border: '1px solid #92400e' }}>
                  This also makes the picked folder the project's files
                  folder — new uploads will be saved there. You can reset it
                  later under Files &amp; Storage.
                </p>
              )}

              <PreviewGroup label={`Will relink (${match.proposals.length})`} color="#4ade80" empty="No matches found in that folder.">
                {match.proposals.map(p => (
                  <div key={p.id} className="flex flex-col gap-0.5 py-1.5 px-2 rounded" style={{ backgroundColor: '#1c1917' }}>
                    <div className="flex items-center gap-2">
                      <span className="text-[10.5px] font-mono truncate flex-1" style={{ color: '#e7e5e4' }}>{p.name}</span>
                      <span className="text-[9px] font-mono uppercase flex-shrink-0"
                        style={{ color: (CONFIDENCE_LABEL[p.confidence] || {}).color || '#a8a29e' }}>
                        {(CONFIDENCE_LABEL[p.confidence] || {}).text || p.confidence}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono truncate" style={{ color: '#78716c' }} title={p.oldPath}>
                      <s style={{ opacity: 0.7 }}>{p.oldPath}</s>
                    </span>
                    <span className="text-[10px] font-mono truncate" style={{ color: '#a8a29e' }} title={p.newPath}>
                      → {p.newPath}
                    </span>
                  </div>
                ))}
              </PreviewGroup>

              {match.ambiguous.length > 0 && (
                <PreviewGroup label={`Ambiguous — left untouched (${match.ambiguous.length})`} color="#fbbf24">
                  {match.ambiguous.map(a => (
                    <div key={a.id} className="py-1.5 px-2 rounded" style={{ backgroundColor: '#1c1917' }}>
                      <div className="text-[10.5px] font-mono truncate" style={{ color: '#e7e5e4' }}>{a.name}</div>
                      <div className="text-[10px] font-mono" style={{ color: '#78716c' }}>
                        {a.candidates.length} same-name candidates — rename or remove duplicates, then rescan.
                      </div>
                    </div>
                  ))}
                </PreviewGroup>
              )}

              {match.unmatched.length > 0 && (
                <PreviewGroup label={`Still missing (${match.unmatched.length})`} color="#f87171">
                  {match.unmatched.map(u => (
                    <div key={u.id} className="text-[10.5px] font-mono truncate py-1 px-2" style={{ color: '#78716c' }} title={u.oldPath}>
                      {u.name}
                    </div>
                  ))}
                </PreviewGroup>
              )}
            </>
          )}

          {phase === 'applying' && (
            <div className="flex items-center gap-2 text-[11.5px] font-mono px-1 py-4" style={{ color: '#a8a29e' }}>
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#fb923c' }} />
              Relinking {match?.proposals.length} file{match?.proposals.length === 1 ? '' : 's'}…
            </div>
          )}

          {phase === 'done' && applied && (
            <div className="rounded px-3 py-3 flex items-start gap-2"
              style={{ backgroundColor: 'rgba(22,101,52,0.15)', border: '1px solid #166534' }}>
              <Check className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#4ade80' }} />
              <div className="text-[11.5px] font-mono leading-relaxed" style={{ color: '#a8a29e' }}>
                <span style={{ color: '#4ade80' }}>Relinked {applied.relinked} file{applied.relinked === 1 ? '' : 's'}.</span>{' '}
                This project's files now resolve from{' '}
                <span style={{ color: '#e7e5e4' }}>{applied.filesDir}</span>.
                Each relink is recorded in the file's activity stream.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 flex-shrink-0"
          style={{ backgroundColor: '#292524', borderTop: '1px solid #44403c' }}>
          {phase === 'done' ? (
            <button type="button" onClick={onClose}
              className="px-3 py-1.5 rounded-md text-[10.5px] font-mono uppercase tracking-wider transition-all hover:brightness-125"
              style={{ backgroundColor: '#ea580c', color: '#fff7ed', border: '1px solid #c2410c' }}>
              Done
            </button>
          ) : (
            <>
              <button type="button" onClick={onClose} disabled={phase === 'applying'}
                className="px-3 py-1.5 rounded-md text-[10.5px] font-mono uppercase tracking-wider transition-colors hover:bg-stone-700"
                style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
                Cancel
              </button>
              {/* Folder picking stays available when the census FAILED —
                  the folder scan recomputes `missing` server-side, so a
                  transient census error must not strand the dialog
                  (adversarial review, S14). Disabled only while the census
                  is in flight, or when it proved nothing is missing. */}
              {(phase === 'idle' || phase === 'preview') && (
                <button type="button" onClick={pickAndScan}
                  disabled={scan == null ? !error : missingCount === 0}
                  className="px-3 py-1.5 rounded-md text-[10.5px] font-mono uppercase tracking-wider transition-colors hover:bg-stone-700 disabled:opacity-40"
                  style={{ color: '#fb923c', border: '1px solid #44403c' }}>
                  {phase === 'preview' ? 'Pick a different folder' : 'Choose folder…'}
                </button>
              )}
              {phase === 'preview' && (
                <button type="button" onClick={apply}
                  disabled={!match || match.proposals.length === 0}
                  className="px-3 py-1.5 rounded-md text-[10.5px] font-mono uppercase tracking-wider transition-all hover:brightness-125 disabled:opacity-40"
                  style={{ backgroundColor: '#ea580c', color: '#fff7ed', border: '1px solid #c2410c' }}>
                  Relink {match?.proposals.length ?? 0} file{(match?.proposals.length ?? 0) === 1 ? '' : 's'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

function PreviewGroup({ label, color, empty, children }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : !!children
  return (
    <div className="rounded-md overflow-hidden" style={{ backgroundColor: '#292524', border: '1px solid #44403c' }}>
      <div className="px-3 py-1.5 text-[9.5px] font-mono uppercase tracking-widest font-bold"
        style={{ color, borderBottom: '1px solid #44403c' }}>
        {label}
      </div>
      <div className="p-1.5 flex flex-col gap-1 max-h-56 overflow-y-auto">
        {hasChildren ? children : (
          <div className="text-[10.5px] font-mono px-2 py-1.5" style={{ color: '#78716c' }}>{empty}</div>
        )}
      </div>
    </div>
  )
}
