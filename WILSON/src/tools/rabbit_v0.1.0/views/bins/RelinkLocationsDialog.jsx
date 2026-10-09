// ============================================================
// RABBIT — Bins on the cloud: finding clips again, by LOCATION (BC2 item 6)
// ============================================================
//
// On the cloud a clip is a footage location (the company's share, by its
// network address) plus a path inside it, the same for everyone. So a clip
// this computer cannot reach is found again by telling THIS computer where
// the location is (B2's fallback: the share seen as a drive letter, kept in
// this computer's settings) — never by rewriting the clip's path, which
// would move it for every teammate. The signed-out desktop's dialog
// (RelinkBinsDialog: re-pick a folder, match by name and size, rewrite the
// path) stays the signed-out desktop's (B12).
//
// Two groups:
//   * locations this computer cannot reach, each with its clip count and
//     "Where is it on this computer?" (or, when a folder is saved and still
//     unreachable, "Choose another folder" / "Forget this computer's folder");
//   * clips missing inside a location this computer DOES reach: the file is
//     not at its path on the share. Nothing here can fix that for everyone:
//     the sentence says to put the file back, or remove the clip.

import { useState } from 'react'
import { Server, Unplug, FolderSearch, Check } from 'lucide-react'
import { C, Btn, Modal } from './binUi'
import { locationReachWords } from '../../bins/binLocations'

function said(e) {
  return String(e?.message || e || '').replace(/^\[(supabase|localServer)\]\s*/, '')
}

export default function RelinkLocationsDialog({ offlineRows, locations, locationStatus, onPickLocal, onForgetLocal, onClose }) {
  const statusById = new Map((locationStatus || []).map(s => [s.id, s]))
  const byLocation = new Map()
  for (const r of offlineRows || []) {
    if (!r.location_id) continue
    if (!byLocation.has(r.location_id)) byLocation.set(r.location_id, [])
    byLocation.get(r.location_id).push(r)
  }
  const out = []      // locations this computer cannot reach, with their clips
  const missing = []  // clips not at their path in a location it does reach
  for (const [id, rows] of byLocation) {
    const st = statusById.get(id)
    const loc = (locations || []).find(l => l.id === id) || { id, name: 'A location no longer in the list', unc_path: '' }
    if (st && st.reachable) missing.push(...rows.map(r => ({ ...r, location: loc })))
    else out.push({ loc, st, count: rows.length })
  }
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  const run = async (id, fn, ok) => {
    setBusy(id); setError(null); setDone(null)
    try { const r = await fn(); if (!r?.canceled) setDone(ok) } catch (e) { setError(said(e)) } finally { setBusy(null) }
  }

  const n = (offlineRows || []).length
  return (
    <Modal title="Clips not on this computer" onClose={onClose} width="reading" busy={!!busy} error={error}
      subtitle={`${n} clip${n === 1 ? '' : 's'} this computer cannot reach. A clip keeps its path for everyone; this computer is told where its location is.`}
      footer={<Btn onClick={onClose} disabled={!!busy}>Close</Btn>}>
      <div className="flex flex-col gap-3">
        {done && <div className="flex items-center gap-2 text-dense" style={{ color: C.green }}><Check className="w-4 h-4" /> {done}</div>}
        {out.map(({ loc, st, count }) => (
          <div key={loc.id} className="rounded-control p-3 flex flex-col gap-2" style={{ border: `1px solid ${C.line}`, backgroundColor: C.deep }} data-testid="relink-location">
            <div className="flex items-center gap-2 min-w-0">
              <Server className="w-3.5 h-3.5 flex-shrink-0" style={{ color: C.amber }} />
              <span className="text-dense font-semibold truncate" style={{ color: C.bright }}>{loc.name}</span>
              <span className="text-dense font-mono truncate" style={{ color: C.dim }} title={loc.unc_path}>{loc.unc_path}</span>
              <span className="ml-auto text-caption tabular-nums flex-shrink-0" style={{ color: C.dim }}>{count} clip{count === 1 ? '' : 's'}</span>
            </div>
            <div className="text-dense" style={{ color: C.text }}>
              {locationReachWords(st) || 'Not reachable from this computer'}. If this computer sees the share as a drive letter, or under another folder, choose that folder: only this computer keeps it.
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Btn small primary disabled={!!busy} onClick={() => run(loc.id, () => onPickLocal(loc.id), `"${loc.name}" is set for this computer.`)}>
                <FolderSearch className="w-3 h-3" /> {st?.local_path ? 'Choose another folder…' : 'Where is it on this computer?'}
              </Btn>
              {st?.local_path && (
                <Btn small disabled={!!busy} onClick={() => run(loc.id, () => onForgetLocal(loc.id), `"${loc.name}" is read at its network address again.`)}>
                  Forget this computer's folder
                </Btn>
              )}
            </div>
          </div>
        ))}
        {missing.length > 0 && (
          <div className="rounded-control" style={{ border: `1px solid ${C.line}` }} data-testid="relink-missing">
            <div className="px-3 py-2 text-dense" style={{ color: C.text, borderBottom: `1px solid ${C.line}` }}>
              {missing.length === 1 ? 'This clip is' : `These ${missing.length} clips are`} not at {missing.length === 1 ? 'its path' : 'their paths'} on a share this computer reaches. A clip keeps its path for everyone, so it cannot be relinked from here: put the file back where it was on the share, or remove the clip from its bin.
            </div>
            <div className="max-h-[30vh] overflow-y-auto">
              {missing.map(r => (
                <div key={r.id} className="px-3 py-1.5 text-dense font-mono flex items-center gap-1.5 min-w-0" style={{ borderBottom: `1px solid ${C.faint}` }}>
                  <Unplug className="w-3 h-3 flex-shrink-0" style={{ color: C.amber }} />
                  <span className="truncate" style={{ color: C.text }}>{r.display_name || r.original_name}</span>
                  <span className="truncate" style={{ color: C.dimmer }} title={`${r.location.unc_path}\\${String(r.relative_path || '').replace(/\//g, '\\')}`}>· {r.location.name} / {r.relative_path}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {out.length === 0 && missing.length === 0 && (
          <div className="text-dense" style={{ color: C.dim }}>Every clip of this project is reachable from this computer.</div>
        )}
      </div>
    </Modal>
  )
}
