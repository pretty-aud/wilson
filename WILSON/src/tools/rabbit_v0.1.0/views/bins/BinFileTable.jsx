// ============================================================
// RABBIT — Bins: list view (Avid's Text view, Premiere's List view)
// ============================================================
//
// One row per bin file with the logging columns and the technical columns
// side by side, sortable by heading, multi-select with click / shift / ctrl,
// the whole selection draggable onto a bin. Names rename in place on a
// double-click; the marks column cycles the flag on click. Every keyboard
// path lives in BinsView, which owns the selection.

import { useEffect, useRef, useState } from 'react'
import { ArrowUp, ArrowDown } from 'lucide-react'
import { C, MediaTag, FlagMark, ColorDot } from './binUi'
import BinPoster from './BinPoster'
import { DND_FILES } from './BinTree'
import { formatDuration, formatBytes } from '../../bins/binMedia'

export const TABLE_COLUMNS = [
  { id: 'display_name', label: 'Name',     width: 'minmax(220px, 2fr)', sortable: true },
  { id: 'media_type',   label: 'Type',     width: '78px',  sortable: true },
  { id: 'review_flag',  label: 'Marks',    width: '64px',  sortable: true },
  { id: 'slate',        label: 'Slate',    width: '72px',  sortable: true },
  { id: 'take_number',  label: 'Take',     width: '64px',  sortable: true },
  { id: 'camera',       label: 'Cam',      width: '48px',  sortable: true },
  { id: 'roll',         label: 'Roll',     width: '70px',  sortable: true },
  { id: 'shoot_day',    label: 'Day',      width: '92px',  sortable: true },
  { id: 'scene',        label: 'Scene',    width: '110px', sortable: false },
  { id: 'duration_sec', label: 'Duration', width: '72px',  sortable: true, align: 'right' },
  { id: 'dims',         label: 'Size px',  width: '90px',  sortable: false, align: 'right' },
  { id: 'fps',          label: 'fps',      width: '56px',  sortable: false, align: 'right' },
  { id: 'codec',        label: 'Codec',    width: '80px',  sortable: false },
  { id: 'size_bytes',   label: 'Bytes',    width: '72px',  sortable: true, align: 'right' },
  { id: 'bin',          label: 'Bin',      width: '130px', sortable: false },
]

const FLAG_NEXT = { unflagged: 'select', select: 'reject', reject: 'unflagged' }

export default function BinFileTable({
  rows, selection, currentId, onRowClick, onRowDoubleClick, onContextMenu, thumbUrlFor,
  binsById, showBin, sort, onSort, onInlinePatch, canWrite, scenesById, renamingId, onRenameEnd, dragIdsFor,
}) {
  const cols = TABLE_COLUMNS.filter(c => showBin || c.id !== 'bin')
  const template = cols.map(c => c.width).join(' ')
  const currentRef = useRef(null)
  useEffect(() => { currentRef.current?.scrollIntoView?.({ block: 'nearest' }) }, [currentId])

  return (
    <div className="flex-1 min-h-0 overflow-auto" style={{ backgroundColor: C.bg }}>
      <div className="sticky top-0 z-10 grid items-center px-2" style={{ gridTemplateColumns: template, backgroundColor: C.deep, borderBottom: `1px solid ${C.line}`, minWidth: 'max-content' }}>
        {cols.map(c => (
          <button key={c.id} type="button" disabled={!c.sortable} onClick={() => c.sortable && onSort?.(c.id)}
            className={`flex items-center gap-1 px-2 py-1.5 text-[9.5px] font-mono uppercase tracking-wider ${c.align === 'right' ? 'justify-end' : ''} ${c.sortable ? 'hover:text-stone-200' : 'cursor-default'}`}
            style={{ color: sort?.field === c.id ? C.accentText : C.dim }}>
            {c.label}
            {sort?.field === c.id && (sort.dir === 'desc' ? <ArrowDown className="w-2.5 h-2.5" /> : <ArrowUp className="w-2.5 h-2.5" />)}
          </button>
        ))}
      </div>
      {rows.map(row => {
        const selected = selection.has(row.id)
        const current = currentId === row.id
        return (
          <Row key={row.id} row={row} cols={cols} template={template} selected={selected} current={current}
            innerRef={current ? currentRef : null}
            thumbUrl={thumbUrlFor?.(row.id)}
            binName={showBin ? (binsById.get(row.bin_id)?.name || '—') : null}
            sceneName={row.scene_id ? (scenesById.get(row.scene_id)?.name || '?') : ''}
            renaming={renamingId === row.id}
            onRenameEnd={onRenameEnd}
            canWrite={canWrite}
            onClick={e => onRowClick?.(row.id, e)}
            onDoubleClick={() => onRowDoubleClick?.(row.id)}
            onContextMenu={e => { e.preventDefault(); onContextMenu?.(e, row.id) }}
            onPatch={patch => onInlinePatch?.(row.id, patch)}
            onDragStart={e => {
              const ids = dragIdsFor?.(row.id) || [row.id]
              e.dataTransfer.setData(DND_FILES, JSON.stringify(ids))
              e.dataTransfer.effectAllowed = 'copyMove'
            }}
          />
        )
      })}
      {rows.length === 0 && (
        <div className="px-4 py-6 text-[11px] font-mono" style={{ color: C.dimmer }}>Nothing matches.</div>
      )}
    </div>
  )
}

function Row({ row, cols, template, selected, current, innerRef, thumbUrl, binName, sceneName, renaming, onRenameEnd, canWrite, onClick, onDoubleClick, onContextMenu, onPatch, onDragStart }) {
  const [draft, setDraft] = useState(row.display_name || '')
  const inputRef = useRef(null)
  useEffect(() => { if (renaming) { setDraft(row.display_name || ''); setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select() }, 0) } }, [renaming, row.display_name])
  const commit = () => { const v = draft.trim(); if (v && v !== row.display_name) onPatch({ display_name: v }); onRenameEnd?.() }
  const cell = (id) => {
    switch (id) {
      case 'display_name':
        return (
          <div className="flex items-center gap-2 min-w-0">
            <BinPoster row={row} src={thumbUrl} width={36} height={22} />
            <div className="min-w-0 flex-1">
              {renaming ? (
                <input ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)}
                  onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } if (e.key === 'Escape') { e.preventDefault(); onRenameEnd?.() } e.stopPropagation() }}
                  onBlur={commit}
                  className="w-full px-1 text-[11.5px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
                  style={{ backgroundColor: C.panel, color: C.bright, border: `1px solid ${C.line}` }} />
              ) : (
                <div className="truncate text-[11.5px]" style={{ color: row.online === false ? C.dim : C.bright }} title={row.display_name}>{row.display_name || row.original_name}</div>
              )}
              <div className="truncate text-[9.5px]" style={{ color: C.dimmer }} title={row.source_path}>{row.original_name}{row.is_sequence && row.frame_count ? ` · ${row.frame_count} frames` : ''}</div>
            </div>
          </div>
        )
      case 'media_type': return <MediaTag type={row.media_type} small />
      case 'review_flag':
        return (
          <button type="button" title="Click to cycle select → reject → unflagged" disabled={!canWrite}
            onClick={e => { e.stopPropagation(); onPatch({ review_flag: FLAG_NEXT[row.review_flag || 'unflagged'] }) }}
            className="flex items-center gap-1 px-1 rounded-sm hover:bg-stone-700 disabled:cursor-default" style={{ minHeight: 18 }}>
            <FlagMark flag={row.review_flag} circled={row.circled} />
            {row.color && <ColorDot color={row.color} size={8} />}
            {!row.color && row.review_flag === 'unflagged' && !row.circled && <span className="text-[9px]" style={{ color: C.dimmer }}>—</span>}
          </button>
        )
      case 'slate': return <span style={{ color: C.text }}>{row.slate || ''}</span>
      case 'take_number': return <span style={{ color: C.text }}>{row.take_number ? `T${row.take_number}` : ''}{row.take_modifier ? <span style={{ color: C.accentText }}> {row.take_modifier}</span> : ''}</span>
      case 'camera': return <span style={{ color: C.text }}>{row.camera || ''}</span>
      case 'roll': return <span style={{ color: C.text }}>{row.roll || ''}</span>
      case 'shoot_day': return <span style={{ color: C.text }}>{row.shoot_day || ''}</span>
      case 'scene': return <span className="truncate block" style={{ color: C.muted }} title={sceneName}>{sceneName}</span>
      case 'duration_sec': return <span className="tabular-nums" style={{ color: C.muted }}>{formatDuration(row.duration_sec)}</span>
      case 'dims': return <span className="tabular-nums" style={{ color: C.muted }}>{row.width && row.height ? `${row.width}×${row.height}` : ''}</span>
      case 'fps': return <span className="tabular-nums" style={{ color: C.muted }}>{row.fps ? (Number(row.fps) % 1 === 0 ? row.fps : Number(row.fps).toFixed(2)) : ''}</span>
      case 'codec': return <span style={{ color: C.muted }}>{row.codec ? String(row.codec).toUpperCase() : (row.probe_status === 'unavailable' ? <span style={{ color: C.dimmer }} title="No decoder on this machine">n/a</span> : '')}</span>
      case 'size_bytes': return <span className="tabular-nums" style={{ color: C.muted }}>{formatBytes(row.size_bytes)}</span>
      case 'bin': return <span className="truncate block" style={{ color: C.muted }}>{binName}</span>
      default: return null
    }
  }
  return (
    <div ref={innerRef} role="row" aria-selected={selected} draggable={canWrite && !renaming} onDragStart={onDragStart}
      onClick={onClick} onDoubleClick={onDoubleClick} onContextMenu={onContextMenu}
      className="grid items-center px-2 cursor-default"
      style={{
        gridTemplateColumns: template, minWidth: 'max-content', minHeight: 34,
        backgroundColor: selected ? 'rgba(234,88,12,0.16)' : 'transparent',
        borderBottom: `1px solid ${C.faint}`,
        boxShadow: current ? `inset 2px 0 0 ${C.accent}` : 'none',
        opacity: row.online === false ? 0.75 : 1,
      }}>
      {cols.map(c => (
        <div key={c.id} className={`px-2 py-1 text-[11px] font-mono min-w-0 ${c.align === 'right' ? 'text-right' : ''}`}>{cell(c.id)}</div>
      ))}
    </div>
  )
}
