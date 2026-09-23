// ============================================================
// RABBIT — Bins: the bin tree (left rail)
// ============================================================
//
// docs/BINS_DESIGN.md §4.1: a tree of bins ordered by hand, one colour and
// one kind each, counts that include the children. Inline rename on
// double-click or F2; right-click for everything else; drop files (from the
// OS or from the table) or a bin (to nest it) onto a node.

import { useEffect, useRef, useState } from 'react'
import { ChevronRight, ChevronDown, Plus, FolderOpen, Layers, Unplug } from 'lucide-react'
import { C, ColorDot, IconBtn } from './binUi'
import { buildBinTree, flattenTree } from '../../bins/binSelectors'
import { COLOR_HEX } from '../../bins/binMedia'

export const DND_FILES = 'application/x-wilson-binfiles'
export const DND_BIN = 'application/x-wilson-bin'

export default function BinTree({
  bins, counts, offlineCounts, currentBinId, onSelect, expanded, onToggleExpand,
  onCreateBin, onRenameBin, onRenameStart, onContextMenu, onDropFiles, onDropBin, renamingId, onRenameEnd,
  allCount, allOffline, canWrite, width = 232,
}) {
  const tree = buildBinTree(bins)
  const rows = flattenTree(tree, expanded)
  const [dragOverId, setDragOverId] = useState(undefined) // undefined = none, null = "all files"

  const accepts = (e) => {
    const t = e.dataTransfer?.types || []
    return t.includes('Files') || t.includes(DND_FILES) || t.includes(DND_BIN)
  }
  const handleDrop = (e, binId) => {
    e.preventDefault(); e.stopPropagation()
    setDragOverId(undefined)
    const dt = e.dataTransfer
    if (!dt) return
    if (dt.types.includes(DND_BIN)) {
      const dragged = dt.getData(DND_BIN)
      if (dragged && dragged !== binId) onDropBin?.(dragged, binId)
      return
    }
    if (binId == null) return
    if (dt.types.includes(DND_FILES)) {
      let ids = []
      try { ids = JSON.parse(dt.getData(DND_FILES) || '[]') } catch { ids = [] }
      if (ids.length) onDropFiles?.(binId, { ids, copy: !!e.ctrlKey })
      return
    }
    if (dt.files && dt.files.length) onDropFiles?.(binId, { files: Array.from(dt.files) })
  }

  return (
    <div className="flex flex-col flex-shrink-0 h-full select-none" style={{ width, borderRight: `1px solid ${C.line}`, backgroundColor: C.bg }}>
      <div className="flex items-center justify-between px-3 py-2 flex-shrink-0" style={{ borderBottom: `1px solid ${C.line}` }}>
        <span className="text-label uppercase" style={{ color: C.dim }}>Bins</span>
        <IconBtn Icon={Plus} title="New bin" disabled={!canWrite} onClick={() => onCreateBin?.(null)} />
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        <TreeRow
          depth={0} label="All files" Icon={Layers} count={allCount} offline={allOffline}
          active={currentBinId == null} dragOver={dragOverId === null}
          onClick={() => onSelect?.(null)}
          onDragOver={e => { if (accepts(e) && e.dataTransfer.types.includes(DND_BIN)) { e.preventDefault(); setDragOverId(null) } }}
          onDragLeave={() => setDragOverId(undefined)}
          onDrop={e => handleDrop(e, null)}
        />
        {rows.length === 0 && (
          <div className="px-3 py-3 text-caption" style={{ color: C.dimmer }}>
            No bins yet. Make one with +, or drop a folder on the empty page.
          </div>
        )}
        {rows.map(({ bin, depth, hasChildren }) => (
          <BinNode
            key={bin.id} bin={bin} depth={depth + 1} hasChildren={hasChildren}
            isExpanded={expanded.has(bin.id)} onToggle={() => onToggleExpand?.(bin.id)}
            count={counts.get(bin.id) || 0} offline={offlineCounts.get(bin.id) || 0}
            active={currentBinId === bin.id} dragOver={dragOverId === bin.id}
            renaming={renamingId === bin.id} canWrite={canWrite}
            onSelect={() => onSelect?.(bin.id)}
            onRename={(name) => { onRenameBin?.(bin.id, name); onRenameEnd?.() }}
            onRenameCancel={() => onRenameEnd?.()}
            onContextMenu={e => { e.preventDefault(); onSelect?.(bin.id); onContextMenu?.(e, bin) }}
            onRenameStart={() => onRenameStart?.(bin.id)}
            onDragOver={e => { if (accepts(e) && canWrite) { e.preventDefault(); e.dataTransfer.dropEffect = e.dataTransfer.types.includes(DND_FILES) && e.ctrlKey ? 'copy' : 'move'; setDragOverId(bin.id) } }}
            onDragLeave={() => setDragOverId(undefined)}
            onDrop={e => handleDrop(e, bin.id)}
            onDragStart={e => { if (!canWrite) return; e.dataTransfer.setData(DND_BIN, bin.id); e.dataTransfer.effectAllowed = 'move' }}
          />
        ))}
      </div>
      <div className="px-3 py-2 flex-shrink-0 flex flex-col gap-1" style={{ borderTop: `1px solid ${C.line}` }}>
        {/* The project count the footer bar used to carry (Q10 removed the bar, C1 keeps the readout). */}
        <div className="text-caption tabular-nums" style={{ color: C.muted }} data-testid="bins-project-count">
          {allCount} file{allCount === 1 ? '' : 's'} in {bins.length} bin{bins.length === 1 ? '' : 's'}{allOffline ? ` · ${allOffline} offline` : ''}
        </div>
        <div className="text-caption" style={{ color: C.dimmer }}>
          Drop files or folders on a bin. Drag a bin onto another to nest it.
        </div>
      </div>
    </div>
  )
}

function TreeRow({ depth, label, Icon, count, offline, active, dragOver, onClick, onDragOver, onDragLeave, onDrop }) {
  return (
    <div role="treeitem" aria-selected={active}
      onClick={onClick} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
      className="bn-tree-row flex items-center gap-1.5 pr-2 py-1 cursor-pointer text-dense"
      data-active={active ? 'true' : undefined}
      data-drag-over={dragOver ? 'true' : undefined}
      style={{ paddingLeft: 10 + depth * 14 }}>
      <span style={{ width: 12 }} />
      <Icon className="bn-tree-icon w-3 h-3 flex-shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      {offline > 0 && <span title={`${offline} offline`}><Unplug className="w-3 h-3" style={{ color: C.amber }} /></span>}
      <span className="text-dense tabular-nums" style={{ color: C.dimmer }}>{count}</span>
    </div>
  )
}

function BinNode({ bin, depth, hasChildren, isExpanded, onToggle, count, offline, active, dragOver, renaming, canWrite,
  onSelect, onRename, onRenameCancel, onRenameStart, onContextMenu, onDragOver, onDragLeave, onDrop, onDragStart }) {
  const [draft, setDraft] = useState(bin.name || '')
  const inputRef = useRef(null)
  useEffect(() => { if (renaming) { setDraft(bin.name || ''); setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select() }, 0) } }, [renaming, bin.name])
  const hex = bin.color ? COLOR_HEX[bin.color] : null
  return (
    <div role="treeitem" aria-selected={active} aria-expanded={hasChildren ? isExpanded : undefined}
      draggable={canWrite && !renaming}
      onDragStart={onDragStart}
      onClick={onSelect} onContextMenu={onContextMenu}
      onDoubleClick={e => { e.stopPropagation(); if (canWrite) onRenameStart?.() }}
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
      className="bn-tree-row flex items-center gap-1.5 pr-2 py-1 cursor-pointer text-dense tabular-nums group"
      data-active={active ? 'true' : undefined}
      data-drag-over={dragOver ? 'true' : undefined}
      style={{ paddingLeft: 10 + depth * 14 }}>
      <span className="flex-shrink-0 flex items-center justify-center" style={{ width: 12 }}
        onClick={e => { e.stopPropagation(); if (hasChildren) onToggle() }}>
        {hasChildren && (isExpanded ? <ChevronDown className="w-3 h-3" style={{ color: C.dim }} /> : <ChevronRight className="w-3 h-3" style={{ color: C.dim }} />)}
      </span>
      {hex ? <ColorDot color={bin.color} size={8} /> : <FolderOpen className="bn-tree-icon w-3 h-3 flex-shrink-0" />}
      {renaming ? (
        <input ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)}
          onClick={e => e.stopPropagation()}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onRename(draft.trim() || bin.name) } if (e.key === 'Escape') { e.preventDefault(); onRenameCancel() } }}
          onBlur={() => onRename(draft.trim() || bin.name)}
          className="ui-input flex-1" data-size="sm" aria-label="Bin name" />
      ) : (
        <span className="flex-1 truncate" title={bin.description || bin.name}>{bin.name || 'Untitled'}</span>
      )}
      {offline > 0 && <span title={`${offline} offline`}><Unplug className="w-3 h-3" style={{ color: C.amber }} /></span>}
      <span className="text-dense tabular-nums" style={{ color: C.dimmer }}>{count}</span>
    </div>
  )
}
