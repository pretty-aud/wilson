// ============================================================
// RABBIT — shot takes: the ordered list for one shot (milestone 2)
// ============================================================
//
// Audrey (BINS_DESIGN §6 Q6): "a reworked shot shows its takes in order with
// roles and a count"; the primary take's poster fills an EMPTY shot thumbnail
// only; frame_count is never overwritten, "use take length" is offered.
//
// One row per take, in position order: poster, name, slate and technical
// lines, the role (a select: primary / part / alt), the editor's note, and the
// controls — move up / down, make primary, unassign. The panel is embedded in
// the shot detail popup and wrapped in a modal (ShotTakesDialog) for the table
// rows; both hand the picker to their host through onOpenPicker.

import { useState } from 'react'
import { ArrowUp, ArrowDown, Star, X, Plus, Clock, FolderOpen, Info } from 'lucide-react'
import { C, Btn, IconBtn, Modal, Select, TextInput } from './binUi'
import BinPoster from './BinPoster'
import { slateLine, techLine } from '../../bins/binMedia'
import { TAKE_ROLES, TAKE_ROLE_META, primaryOf, takeLengthFrames, takesSummary } from '../../bins/shotTakeSelectors'
import { navigateTo } from '../../state/rabbitNavigate'

function NoteInput({ take, canWrite, onUpdate }) {
  const [draft, setDraft] = useState(take.notes || '')
  const [key, setKey] = useState(take.id + '|' + (take.notes || ''))
  const cur = take.id + '|' + (take.notes || '')
  if (key !== cur) { setKey(cur); setDraft(take.notes || '') }
  return (
    <TextInput value={draft} onChange={setDraft} disabled={!canWrite} placeholder="Why this take…"
      className="!py-0.5 !text-[10.5px]"
      onCommit={() => { const v = draft.trim(); if (v !== (take.notes || '')) onUpdate(take.id, { notes: v }) }} />
  )
}

export function RoleLegend() {
  return (
    <div className="flex items-start gap-2 text-[9.5px] font-mono" style={{ color: C.dimmer }}>
      <Info className="w-3 h-3 flex-shrink-0 mt-px" />
      <div className="grid gap-x-4 gap-y-0.5" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        {TAKE_ROLES.map(r => (
          <span key={r} title={TAKE_ROLE_META[r].help}><span style={{ color: TAKE_ROLE_META[r].color }}>{TAKE_ROLE_META[r].label}</span> — {TAKE_ROLE_META[r].help}</span>
        ))}
      </div>
    </div>
  )
}

export default function ShotTakesPanel({
  shot, entries, fps, canWrite, thumbUrlFor, binPathFor,
  onUpdate, onRemove, onReorder, onOpenPicker, onUseLength, compact = false,
}) {
  const list = entries || []
  const primary = primaryOf(list)
  const summary = takesSummary(list)
  const length = primary ? takeLengthFrames(primary.file, fps) : null
  const offerLength = length != null && Number(shot?.frame_count || 0) !== length
  const move = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= list.length) return
    const ids = list.map(e => e.take.id)
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    onReorder?.(shot.id, ids)
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10.5px] font-mono" style={{ color: C.muted }}>
          {list.length === 0 ? 'No takes assigned' : `${list.length} take${list.length === 1 ? '' : 's'}`}
          {summary.parts > 0 && <span style={{ color: TAKE_ROLE_META.part.color }}> · {summary.parts} part{summary.parts === 1 ? '' : 's'}</span>}
          {summary.alts > 0 && <span style={{ color: C.dim }}> · {summary.alts} alt{summary.alts === 1 ? '' : 's'}</span>}
          {primary && <span style={{ color: C.dim }}> · primary: <span style={{ color: C.text }}>{primary.file.display_name || primary.file.original_name}</span></span>}
        </span>
        <span className="ml-auto flex items-center gap-1.5 flex-wrap">
          {offerLength && canWrite && (
            <Btn small onClick={() => onUseLength?.(shot.id, length)} title={`Set this shot's frame count to the primary take's length (${length} frames at ${fps} fps). Nothing is written until you click.`}>
              <Clock className="w-3 h-3" /> Use take length ({length} fr)
            </Btn>
          )}
          {canWrite && <Btn small primary onClick={onOpenPicker}><Plus className="w-3 h-3" /> Add takes…</Btn>}
        </span>
      </div>

      {list.length === 0 ? (
        <div className="px-3 py-4 text-center text-[10.5px] font-mono rounded-sm leading-relaxed" style={{ color: C.dim, backgroundColor: C.deep, border: `1px dashed ${C.line}` }}>
          Assign the bin files this shot is cut from. The first becomes the primary take; a shot rebuilt from several takes lists them in order as parts.
        </div>
      ) : (
        <div className="rounded-sm overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
          {list.map(({ take, file }, i) => {
            const meta = TAKE_ROLE_META[take.role] || TAKE_ROLE_META.alt
            const isPrimary = take.role === 'primary'
            return (
              <div key={take.id} className="flex items-start gap-2.5 px-2.5 py-2"
                style={{ backgroundColor: isPrimary ? 'rgba(234,88,12,0.06)' : C.bg, borderBottom: i < list.length - 1 ? `1px solid ${C.faint}` : 'none', borderLeft: `3px solid ${meta.color}` }}>
                <span className="text-[10px] font-mono tabular-nums pt-2 w-4 text-right flex-shrink-0" style={{ color: C.dimmer }}>{i + 1}</span>
                <BinPoster row={file} src={thumbUrlFor?.(file.id)} width={compact ? 56 : 72} height={compact ? 32 : 41} />
                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate text-[11.5px] font-mono" style={{ color: C.bright }} title={file.display_name || file.original_name}>{file.display_name || file.original_name}</span>
                    {isPrimary && <Star className="w-3 h-3 flex-shrink-0" style={{ color: C.accentText, fill: C.accentText }} />}
                    {file.online === false && <span className="text-[9px] font-mono uppercase" style={{ color: C.amber }}>offline</span>}
                  </div>
                  <div className="truncate text-[9.5px] font-mono" style={{ color: C.dim }}>
                    {[slateLine(file), techLine(file), binPathFor?.(file.bin_id)].filter(Boolean).join(' · ') || file.original_name}
                  </div>
                  <NoteInput take={take} canWrite={canWrite} onUpdate={onUpdate} />
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <Select value={take.role} disabled={!canWrite} className="!w-24 !py-0.5 !text-[10px]"
                    options={TAKE_ROLES.map(r => ({ value: r, label: TAKE_ROLE_META[r].label }))}
                    onChange={v => v && v !== take.role && onUpdate(take.id, { role: v })} />
                  <div className="flex items-center gap-0.5">
                    <IconBtn Icon={ArrowUp} title="Move up" size={3} disabled={!canWrite || i === 0} onClick={() => move(i, -1)} />
                    <IconBtn Icon={ArrowDown} title="Move down" size={3} disabled={!canWrite || i === list.length - 1} onClick={() => move(i, 1)} />
                    <IconBtn Icon={Star} title={isPrimary ? 'This is the primary take' : 'Make this the primary take'} size={3} active={isPrimary} disabled={!canWrite || isPrimary} onClick={() => onUpdate(take.id, { role: 'primary' })} />
                    <IconBtn Icon={FolderOpen} title="Show in Bins" size={3} onClick={() => navigateTo({ view: 'bins', fileId: file.id })} />
                    <IconBtn Icon={X} title="Unassign from this shot" size={3} danger disabled={!canWrite} onClick={() => onRemove([take.id])} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {!compact && <RoleLegend />}
    </div>
  )
}

/** The panel in a modal, for the table rows and the gallery cards. */
export function ShotTakesDialog({ shot, scene, onClose, children, ...panelProps }) {
  const title = `Takes — ${shot?.name || 'Untitled shot'}`
  return (
    <Modal title={title} subtitle={scene ? `${scene.name || 'Untitled scene'} · shot #${shot?.shot_number ?? '—'}` : `shot #${shot?.shot_number ?? '—'}`} onClose={onClose} width={720}
      footer={<Btn onClick={onClose}>Close</Btn>}>
      <ShotTakesPanel shot={shot} {...panelProps} />
      {children}
    </Modal>
  )
}
