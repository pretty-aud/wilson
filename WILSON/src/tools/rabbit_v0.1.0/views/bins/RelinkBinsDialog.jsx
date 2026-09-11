// ============================================================
// RABBIT — Bins: relink offline files
// ============================================================
//
// Audrey, 2026-09-10 (Q12): "offline state + relink by re-picking the
// folder (matches shown before applying)". Pick a folder (or rescan a known
// root), the server walks it, the existing matcher pairs offline rows with
// candidates by name and then size, and nothing changes until Apply. An
// ambiguous row (two files with the name) is chosen by hand or left alone.

import { useMemo, useState } from 'react'
import { FolderSearch, Link2, Unplug, Check, AlertTriangle, RefreshCw } from 'lucide-react'
import { C, Btn, Modal, Select, Spinner } from './binUi'
import { matchMissingFiles } from '../../components/relinkMatcher'

export default function RelinkBinsDialog({ offlineRows, roots, onPickFolder, onScan, onApply, onForgetRoot = null, onClose }) {
  const [phase, setPhase] = useState('idle') // idle | scanning | review | applying | done
  const [folder, setFolder] = useState(null)
  const [scan, setScan] = useState(null)
  const [choices, setChoices] = useState({})
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const missing = useMemo(() => offlineRows.map(r => ({ id: r.id, name: r.original_name, storage_path: r.source_path, size_bytes: r.is_sequence ? null : (r.size_bytes ?? null), is_sequence: !!r.is_sequence })), [offlineRows])

  const match = useMemo(() => {
    if (!scan?.candidates) return null
    const files = scan.candidates.filter(c => !c.is_sequence)
    const seqs = scan.candidates.filter(c => c.is_sequence)
    const m = matchMissingFiles(missing.filter(r => !r.is_sequence), files)
    // Sequences match by folder name only (one folder = one item).
    const seqRows = missing.filter(r => r.is_sequence)
    for (const r of seqRows) {
      const hits = seqs.filter(s => s.name.toLowerCase() === String(r.name || '').toLowerCase())
      if (hits.length === 1) m.proposals.push({ id: r.id, name: r.name, oldPath: r.storage_path, newPath: hits[0].relPath, confidence: 'exact' })
      else if (hits.length > 1) m.ambiguous.push({ id: r.id, name: r.name, oldPath: r.storage_path, candidates: hits })
      else m.unmatched.push({ id: r.id, name: r.name, oldPath: r.storage_path })
    }
    return m
  }, [scan, missing])

  const absFor = (relPath) => scan?.candidates?.find(c => c.relPath === relPath)?.abs || null

  const doScan = async (folderPath) => {
    setError(null); setPhase('scanning'); setFolder(folderPath); setChoices({})
    try {
      const res = await onScan(folderPath)
      setScan(res); setPhase('review')
    } catch (e) {
      setError(e?.message || String(e)); setPhase('idle')
    }
  }
  const pick = async () => {
    setError(null)
    try {
      const p = await onPickFolder()
      if (p) await doScan(p)
    } catch (e) { setError(e?.message || String(e)) }
  }
  const apply = async () => {
    if (!match) return
    const mappings = match.proposals.map(p => ({ id: p.id, newPath: absFor(p.newPath) })).filter(m => m.newPath)
    for (const a of match.ambiguous) { const rel = choices[a.id]; if (rel) { const abs = absFor(rel); if (abs) mappings.push({ id: a.id, newPath: abs }) } }
    // Never a silent no-op: a button that says "Relink 5" and does nothing
    // is the failure the review named.
    if (!mappings.length) { setError('No match could be resolved to a path in that folder. Scan again.'); return }
    setPhase('applying'); setError(null)
    try {
      const res = await onApply(mappings)
      setResult({ ...res, sent: mappings.length }); setPhase('done')
    } catch (e) { setError(e?.message || String(e)); setPhase('review') }
  }

  const applyCount = match ? match.proposals.length + Object.values(choices).filter(Boolean).length : 0

  return (
    <Modal title="Relink offline files" onClose={onClose} width={720} busy={phase === 'applying'}
      subtitle={`${offlineRows.length} file${offlineRows.length === 1 ? '' : 's'} cannot be found at ${offlineRows.length === 1 ? 'its' : 'their'} recorded path`}
      footer={<>
        {error && <span className="text-[10.5px] font-mono mr-auto flex items-center gap-1.5" style={{ color: '#fca5a5' }}><AlertTriangle className="w-3 h-3" /> {error}</span>}
        <Btn onClick={onClose} disabled={phase === 'applying'}>{phase === 'done' ? 'Close' : 'Cancel'}</Btn>
        {phase !== 'done' && <Btn primary onClick={apply} disabled={phase !== 'review' || applyCount === 0}><Link2 className="w-3 h-3" /> Relink {applyCount || ''}</Btn>}
      </>}>
      {phase === 'done' && result ? (
        <div className="flex flex-col gap-2 text-[11px] font-mono" style={{ color: C.text }}>
          <div className="flex items-center gap-2" style={{ color: C.green }}><Check className="w-4 h-4" /> {result.updated?.length || 0} file{(result.updated?.length || 0) === 1 ? '' : 's'} relinked{(result.updated?.length || 0) > (result.sent || 0) ? ' (instances included)' : ''}.</div>
          {result.failed?.length > 0 && <div style={{ color: C.amber }}>{result.failed.length} could not be relinked: {result.failed.map(f => f.reason).join(', ')}.</div>}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Btn primary onClick={pick} disabled={phase === 'scanning'}><FolderSearch className="w-3 h-3" /> Choose the folder they moved to…</Btn>
            {phase === 'scanning' && <span className="flex items-center gap-2 text-[10.5px] font-mono" style={{ color: C.muted }}><Spinner /> Walking {folder}…</span>}
          </div>
          {roots?.length > 0 && (
            <div className="rounded-sm" style={{ border: `1px solid ${C.line}` }}>
              <div className="px-2 py-1 text-[9.5px] font-mono uppercase tracking-wider" style={{ color: C.dim, borderBottom: `1px solid ${C.line}` }}>Known folders — scanned on open after a drive is plugged back in; scan one now, or forget it</div>
              {roots.map(r => (
                <div key={r.id} className="flex items-center gap-2 px-2 py-1 text-[10.5px] font-mono" style={{ borderBottom: `1px solid ${C.faint}` }}>
                  <span className="flex-1 truncate" style={{ color: C.text }} title={r.path}>{r.path}</span>
                  <Btn small onClick={() => doScan(r.path)} disabled={phase === 'scanning'}><RefreshCw className="w-3 h-3" /> Scan</Btn>
                  {onForgetRoot && <Btn small onClick={() => onForgetRoot(r.id).catch(e => setError(e?.message || String(e)))} disabled={phase === 'scanning' || phase === 'applying'} title="Forget this folder: it is no longer scanned on open. Files already in bins are untouched.">Forget</Btn>}
                </div>
              ))}
            </div>
          )}
          <div className="rounded-sm max-h-[40vh] overflow-y-auto" style={{ border: `1px solid ${C.line}`, backgroundColor: C.deep }}>
            {offlineRows.map(r => {
              const prop = match?.proposals.find(p => p.id === r.id)
              const amb = match?.ambiguous.find(a => a.id === r.id)
              return (
                <div key={r.id} className="px-2 py-1.5 text-[10.5px] font-mono" style={{ borderBottom: `1px solid ${C.faint}` }}>
                  <div className="flex items-center gap-1.5 truncate" style={{ color: C.text }}>
                    {prop ? <Check className="w-3 h-3 flex-shrink-0" style={{ color: C.green }} /> : amb ? <AlertTriangle className="w-3 h-3 flex-shrink-0" style={{ color: C.amber }} /> : <Unplug className="w-3 h-3 flex-shrink-0" style={{ color: match ? C.dimmer : C.amber }} />}
                    <span className="truncate">{r.display_name || r.original_name}</span>
                    <span className="truncate" style={{ color: C.dimmer }}>· {r.original_name}</span>
                  </div>
                  <div className="truncate pl-[18px]" style={{ color: C.dimmer }} title={r.source_path}>was {r.source_path}</div>
                  {prop && <div className="truncate pl-[18px]" style={{ color: C.green }} title={absFor(prop.newPath)}>→ {absFor(prop.newPath)}</div>}
                  {amb && (
                    <div className="pl-[18px] mt-1 flex items-center gap-2">
                      <span style={{ color: C.amber }}>{amb.candidates.length} files with this name:</span>
                      <Select value={choices[r.id] || ''} placeholder="— leave offline —" options={amb.candidates.map(c => ({ value: c.relPath, label: c.relPath }))} onChange={v => setChoices(ch => ({ ...ch, [r.id]: v }))} />
                    </div>
                  )}
                  {match && !prop && !amb && <div className="pl-[18px]" style={{ color: C.dimmer }}>not found in that folder</div>}
                </div>
              )
            })}
          </div>
          {scan?.truncated && <div className="text-[10px] font-mono flex items-center gap-1.5" style={{ color: C.amber }}><AlertTriangle className="w-3 h-3" /> The folder was too large to walk completely.</div>}
        </div>
      )}
    </Modal>
  )
}

