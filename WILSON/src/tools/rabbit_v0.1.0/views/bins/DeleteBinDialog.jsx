// ============================================================
// RABBIT — Bins: delete a bin (says what is inside first)
// ============================================================
//
// Audrey, 2026-09-10 (Q10): "deleting a bin with files asks: move them or
// remove them". The dialog names the bins and files that would go, offers
// every bin outside the subtree as a destination, and the confirm button
// says what it will do. Removing never touches a file on disk.

import { useMemo, useState } from 'react'
import { Trash2, FolderInput } from 'lucide-react'
import { C, Btn, Modal, Select } from './binUi'
import { descendantIds, binPathLabel } from '../../bins/binSelectors'

export default function DeleteBinDialog({ bin, bins, files, onConfirm, onCancel, busy, error = null }) {
  const subtree = useMemo(() => descendantIds(bins, bin.id), [bins, bin.id])
  const childBins = useMemo(() => bins.filter(b => subtree.has(b.id) && b.id !== bin.id), [bins, subtree])
  const inside = useMemo(() => files.filter(f => subtree.has(f.bin_id)), [files, subtree])
  const targets = useMemo(() => bins.filter(b => !subtree.has(b.id)).map(b => ({ value: b.id, label: binPathLabel(bins, b.id) })), [bins, subtree])
  const [mode, setMode] = useState(inside.length && targets.length ? 'move' : 'remove')
  const [target, setTarget] = useState(targets[0]?.value || null)

  const n = inside.length
  const confirmLabel = n === 0
    ? 'Delete bin'
    : mode === 'move'
      ? `Delete bin, move ${n} file${n === 1 ? '' : 's'}`
      : `Delete bin and remove ${n} file${n === 1 ? '' : 's'}`

  return (
    <Modal title={`Delete "${bin.name}"`} onClose={onCancel} width={520} busy={busy} error={error}
      subtitle={childBins.length ? `Includes ${childBins.length} nested bin${childBins.length === 1 ? '' : 's'}: ${childBins.map(b => b.name).join(', ')}` : null}
      footer={<>
        <Btn onClick={onCancel} disabled={busy}>Cancel</Btn>
        <Btn danger onClick={() => onConfirm({ mode: n === 0 ? 'remove' : mode, target: mode === 'move' ? target : null })} disabled={busy || (mode === 'move' && n > 0 && !target)}>
          <Trash2 className="w-3 h-3" /> {confirmLabel}
        </Btn>
      </>}>
      {n === 0 ? (
        <div className="text-[11px] font-mono leading-relaxed" style={{ color: C.text }}>The bin is empty. Nothing on disk changes.</div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="text-[11px] font-mono leading-relaxed" style={{ color: C.text }}>
            This bin holds <span style={{ color: C.bright }}>{n} file{n === 1 ? '' : 's'}</span>. Files are references; the media on disk is never touched.
          </div>
          <div className="rounded-sm max-h-40 overflow-y-auto" style={{ border: `1px solid ${C.line}`, backgroundColor: C.deep }}>
            {inside.slice(0, 200).map(f => (
              <div key={f.id} className="px-2 py-1 text-[10.5px] font-mono truncate" style={{ color: C.muted, borderBottom: `1px solid ${C.faint}` }}>
                {f.display_name || f.original_name}
                <span style={{ color: C.dimmer }}> · {binPathLabel(bins, f.bin_id)}</span>
              </div>
            ))}
            {inside.length > 200 && <div className="px-2 py-1 text-[10px] font-mono" style={{ color: C.dimmer }}>…and {inside.length - 200} more</div>}
          </div>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="radio" name="delmode" checked={mode === 'move'} onChange={() => setMode('move')} disabled={!targets.length} className="mt-0.5 accent-orange-600" />
            <span className="flex-1 flex flex-col gap-1">
              <span className="text-[11px] font-mono flex items-center gap-1.5" style={{ color: targets.length ? C.text : C.dimmer }}><FolderInput className="w-3 h-3" /> Move the files to another bin{targets.length ? '' : ' (no other bin exists)'}</span>
              {mode === 'move' && targets.length > 0 && <Select value={target} onChange={setTarget} options={targets} />}
            </span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="radio" name="delmode" checked={mode === 'remove'} onChange={() => setMode('remove')} className="mt-0.5 accent-orange-600" />
            <span className="text-[11px] font-mono flex items-center gap-1.5" style={{ color: C.text }}><Trash2 className="w-3 h-3" /> Remove the files from the project (undo restores them)</span>
          </label>
        </div>
      )}
    </Modal>
  )
}
