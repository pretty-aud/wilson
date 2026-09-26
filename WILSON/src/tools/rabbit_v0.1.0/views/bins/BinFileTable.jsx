// ============================================================
// RABBIT — Bins: list view (Avid's Text view, Premiere's List view)
// ============================================================
//
// One row per bin file with the logging columns and the technical columns
// side by side, sortable by heading, multi-select with click / shift / ctrl,
// the whole selection draggable onto a bin. Names rename in place on a
// double-click; the marks column cycles the flag on click. Every keyboard
// path lives in BinsView, which owns the selection.
//
// ── B4c surface 8 (2026-09-25): the kit Table ────────────────────────────
// B6 restyled this in place and left it a CSS grid of 16 columns. It is now
// the kit's real <table> (Table / Th / Td / Row): the fourth file table the
// plan converges, after ProjectFilesTable, FileManager and the Assets table.
// A restyle (C1), so what the grid did it still does:
//   · every column, label and width is TABLE_COLUMNS', unchanged. A px width
//     is its header's; the one `minmax(<floor>, …)` track (Name) is the
//     table's auto column, which takes the rest. Its floor is held by the
//     table's min-width — the shown columns' sum, handed to bins.css as
//     `--bn-list-cols` (the one style this file writes) — so a pane narrower
//     than the columns scrolls sideways, as the grid's `max-content` did;
//   · the row states sit on the <tr> (`data-selected`, `data-current`,
//     `data-offline`), where bins.css paints them and lifts or dims every
//     cell's ink through the `--bn-*` properties. No `aria-selected`: the
//     kit's Row carries none (a plain table cannot own a selection);
//   · the grid's geometry — 8px cells, its 8px left gutter, 4px above and
//     below a two-line row — is bins.css', so each column's x and each
//     value's room are what they were.

import { useEffect, useRef, useState } from 'react'
import { Table, Row, Th, Td } from '../../../../ui'
import { MediaTag, FlagMark, ColorDot, EmptyState } from './binUi'
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
  { id: 'shoot_day',    label: 'Day',      width: '104px', sortable: true },
  { id: 'scene',        label: 'Scene',    width: '110px', sortable: false, mono: false },
  { id: 'used',         label: 'Used in',  width: '70px',  sortable: false, mono: false },
  { id: 'duration_sec', label: 'Duration', width: '72px',  sortable: true, align: 'right' },
  { id: 'dims',         label: 'Size px',  width: '90px',  sortable: false, align: 'right' },
  { id: 'fps',          label: 'fps',      width: '56px',  sortable: false, align: 'right' },
  { id: 'codec',        label: 'Codec',    width: '120px', sortable: false },
  { id: 'size_bytes',   label: 'Bytes',    width: '72px',  sortable: true, align: 'right' },
  { id: 'bin',          label: 'Bin',      width: '130px', sortable: false, mono: false },
]
// `mono: false` — a name (a scene's, a bin's) or words, not a figure or an
// identifier: set in the sans. Every other cell is data in the mono (plan
// §3.1: figures and identifiers; B27).

const FLAG_NEXT = { unflagged: 'select', select: 'reject', reject: 'unflagged' }

// The widths are grid tracks. On the table a px track is its header's width,
// and `minmax(<floor>px, …)` is the auto column: it takes the rest and never
// goes under its floor.
const floorOf = (c) => Number(/^minmax\((\d+)px,/.exec(c.width)?.[1] || 0)
const headerWidth = (c) => (floorOf(c) ? undefined : c.width)
/** What the shown columns need side by side: the floor plus every px width. */
const columnsWidth = (cols) => cols.reduce((sum, c) => sum + (floorOf(c) || parseFloat(c.width)), 0)

export default function BinFileTable({
  rows, selection, currentId, onRowClick, onRowDoubleClick, onContextMenu, thumbUrlFor,
  binsById, showBin, sort, onSort, onInlinePatch, canWrite, scenesById, renamingId, onRenameEnd, dragIdsFor, usageCount = null,
}) {
  const cols = TABLE_COLUMNS.filter(c => showBin || c.id !== 'bin')
  const minWidth = columnsWidth(cols)
  const currentRef = useRef(null)
  useEffect(() => { currentRef.current?.scrollIntoView?.({ block: 'nearest' }) }, [currentId])

  return (
    <div className="bn-list">
      <Table className="bn-table" style={{ '--bn-list-cols': `${minWidth}px` }}
        head={(
          <Row>
            {cols.map(c => (
              <Th key={c.id} className="bn-th" width={headerWidth(c)} numeric={c.align === 'right'}
                sort={sort?.field === c.id ? sort.dir : null}
                onSort={c.sortable ? () => onSort?.(c.id) : undefined}
                data-sorted={sort?.field === c.id ? 'true' : undefined}>
                {c.label}
              </Th>
            ))}
          </Row>
        )}>
        {rows.map(row => {
          const selected = selection.has(row.id)
          const current = currentId === row.id
          return (
            <FileRow key={row.id} row={row} cols={cols} selected={selected} current={current}
              innerRef={current ? currentRef : null}
              thumbUrl={thumbUrlFor?.(row.id)}
              binName={showBin ? (binsById.get(row.bin_id)?.name || '—') : null}
              sceneName={row.scene_id ? (scenesById.get(row.scene_id)?.name || '?') : ''}
              used={usageCount?.get(row.id) || 0}
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
      </Table>
      {rows.length === 0 && (
        <EmptyState compact className="bn-list-empty" title="Nothing matches" body="Clear a filter or the search to see more." />
      )}
    </div>
  )
}

function FileRow({ row, cols, selected, current, innerRef, thumbUrl, binName, sceneName, used = 0, renaming, onRenameEnd, canWrite, onClick, onDoubleClick, onContextMenu, onPatch, onDragStart }) {
  const [draft, setDraft] = useState(row.display_name || '')
  const inputRef = useRef(null)
  useEffect(() => { if (renaming) { setDraft(row.display_name || ''); setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select() }, 0) } }, [renaming, row.display_name])
  const commit = () => { const v = draft.trim(); if (v && v !== row.display_name) onPatch({ display_name: v }); onRenameEnd?.() }
  // A cell's ink is its <td>'s (ink-2, bins.css); a span says where it is not.
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
                  className="ui-input" data-size="sm" aria-label="File name" />
              ) : (
                <div className="bn-trow-name truncate text-dense font-semibold" title={row.display_name}>{row.display_name || row.original_name}</div>
              )}
              <div className="bn-trow-sub truncate text-caption" title={row.source_path}>{row.original_name}{row.is_sequence && row.frame_count ? ` · ${row.frame_count} frames` : ''}</div>
            </div>
          </div>
        )
      case 'media_type': return <MediaTag type={row.media_type} small />
      case 'review_flag':
        return (
          <button type="button" title="Click to cycle select → reject → unflagged" disabled={!canWrite}
            onClick={e => { e.stopPropagation(); onPatch({ review_flag: FLAG_NEXT[row.review_flag || 'unflagged'] }) }}
            className="bn-trow-marks flex items-center gap-1 px-1 rounded-control hover:bg-hover disabled:cursor-default">
            <FlagMark flag={row.review_flag} circled={row.circled} />
            {row.color && <ColorDot color={row.color} size={8} />}
            {!row.color && row.review_flag === 'unflagged' && !row.circled && <span className="bn-trow-none text-dense">—</span>}
          </button>
        )
      case 'slate': return row.slate || ''
      case 'take_number': return <>{row.take_number ? `T${row.take_number}` : ''}{row.take_modifier ? <span className="bn-trow-accent"> {row.take_modifier}</span> : ''}</>
      case 'camera': return row.camera || ''
      case 'roll': return row.roll || ''
      case 'shoot_day': return row.shoot_day || ''
      case 'scene': return <span className="truncate block" title={sceneName}>{sceneName}</span>
      case 'used': return used ? <span className="bn-trow-accent tabular-nums" title={`Used in ${used} shot${used === 1 ? '' : 's'}`}>{used} shot{used === 1 ? '' : 's'}</span> : <span className="bn-trow-none">—</span>
      case 'duration_sec': return formatDuration(row.duration_sec)
      case 'dims': return row.width && row.height ? `${row.width}×${row.height}` : ''
      case 'fps': return row.fps ? (Number(row.fps) % 1 === 0 ? row.fps : Number(row.fps).toFixed(2)) : ''
      case 'codec': return row.codec ? String(row.codec).toUpperCase() : (row.probe_status === 'unavailable' ? <span className="bn-trow-none" title="No decoder on this machine">n/a</span> : '')
      case 'size_bytes': return formatBytes(row.size_bytes)
      case 'bin': return binName
      default: return null
    }
  }
  return (
    <Row ref={innerRef} className="bn-trow" draggable={canWrite && !renaming} onDragStart={onDragStart}
      onClick={onClick} onDoubleClick={onDoubleClick} onContextMenu={onContextMenu}
      data-selected={selected ? 'true' : undefined}
      data-current={current ? 'true' : undefined}
      data-offline={row.online === false ? 'true' : undefined}>
      {cols.map(c => (
        <Td key={c.id} numeric={c.align === 'right'} data-sans={c.mono === false ? 'true' : undefined}>{cell(c.id)}</Td>
      ))}
    </Row>
  )
}
