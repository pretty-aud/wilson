// ============================================================
// RABBIT — Bins: frame view (Avid's Frame view, Premiere's Icon view)
// ============================================================
//
// One tile per bin file: the poster, the name, the slate line, the technical
// line, the marks. Hover-scrub on tiles Chromium can decode (docs/BINS_DESIGN
// §4.1, Audrey's yes on 2026-09-10): moving the mouse across the tile maps
// left→right onto the clip through the stream route, muted, no audio, and
// the video element is dropped the moment the mouse leaves. Other formats
// keep their poster.

import { useEffect, useRef, useState } from 'react'
import { Clapperboard } from 'lucide-react'
import { C, MediaTag, FlagMark, ColorDot } from './binUi'
import BinPoster from './BinPoster'
import { DND_FILES } from './BinTree'
import { canHoverScrub, techLine, slateLine, COLOR_HEX } from '../../bins/binMedia'

export default function BinFileGrid({
  rows, selection, currentId, onRowClick, onRowDoubleClick, onContextMenu, thumbUrlFor, streamUrlFor,
  tileWidth = 200, canWrite, dragIdsFor, binsById, showBin, usageCount = null,
}) {
  const currentRef = useRef(null)
  useEffect(() => { currentRef.current?.scrollIntoView?.({ block: 'nearest' }) }, [currentId])
  return (
    <div className="flex-1 min-h-0 overflow-auto p-3" style={{ backgroundColor: C.bg }}>
      {rows.length === 0 && <div className="px-2 py-6 text-[11px] font-mono" style={{ color: C.dimmer }}>Nothing matches.</div>}
      {/* data-bin-grid: the keyboard handler reads the REAL column count from
          this element's computed grid (review round 2: a formula guessed it and
          the cursor drifted diagonally at some pane widths). */}
      <div className="grid gap-3" data-bin-grid="" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${tileWidth}px, 1fr))` }}>
        {rows.map(row => (
          <Tile key={row.id} row={row} selected={selection.has(row.id)} current={currentId === row.id}
            innerRef={currentId === row.id ? currentRef : null}
            thumbUrl={thumbUrlFor?.(row.id)} streamUrl={canHoverScrub(row) && row.online !== false ? streamUrlFor?.(row.id) : null}
            binName={showBin ? (binsById?.get(row.bin_id)?.name || '') : null} binColor={binsById?.get(row.bin_id)?.color || null}
            used={usageCount?.get(row.id) || 0}
            canWrite={canWrite}
            onClick={e => onRowClick?.(row.id, e)}
            onDoubleClick={() => onRowDoubleClick?.(row.id)}
            onContextMenu={e => { e.preventDefault(); onContextMenu?.(e, row.id) }}
            onDragStart={e => {
              const ids = dragIdsFor?.(row.id) || [row.id]
              e.dataTransfer.setData(DND_FILES, JSON.stringify(ids))
              e.dataTransfer.effectAllowed = 'copyMove'
            }}
          />
        ))}
      </div>
    </div>
  )
}

function Tile({ row, selected, current, innerRef, thumbUrl, streamUrl, binName, binColor, used = 0, canWrite, onClick, onDoubleClick, onContextMenu, onDragStart }) {
  const [hover, setHover] = useState(false)
  const [scrubFrac, setScrubFrac] = useState(null)
  const [failed, setFailed] = useState(false)
  const videoRef = useRef(null)
  const boxRef = useRef(null)
  const scrubbing = hover && !!streamUrl && !failed

  useEffect(() => {
    const v = videoRef.current
    if (!v || scrubFrac == null) return
    const d = v.duration
    if (!Number.isFinite(d) || d <= 0) return
    const t = Math.max(0, Math.min(d - 0.05, d * scrubFrac))
    // Seeking on every mousemove is fine: the browser coalesces seeks and a
    // seek in flight is simply superseded by the next.
    try { v.currentTime = t } catch { /* not ready yet */ }
  }, [scrubFrac])

  const hex = row.color ? COLOR_HEX[row.color] : null
  return (
    <div ref={innerRef} role="gridcell" aria-selected={selected} draggable={canWrite} onDragStart={onDragStart}
      onClick={onClick} onDoubleClick={onDoubleClick} onContextMenu={onContextMenu}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setScrubFrac(null) }}
      onMouseMove={e => {
        if (!scrubbing) return
        const r = boxRef.current?.getBoundingClientRect()
        if (!r || r.width <= 0) return
        setScrubFrac(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)))
      }}
      className="rounded-sm overflow-hidden cursor-default flex flex-col"
      style={{
        backgroundColor: selected ? 'rgba(234,88,12,0.14)' : C.panel,
        border: `1px solid ${selected ? C.accentBorder : C.line}`,
        boxShadow: current ? `0 0 0 1px ${C.accent}` : 'none',
        opacity: row.online === false ? 0.8 : 1,
      }}>
      <div ref={boxRef} className="relative w-full" style={{ aspectRatio: '16 / 9', backgroundColor: C.deep }}>
        <BinPoster row={row} src={thumbUrl} width="100%" height="100%" radius={0} style={{ border: 'none', position: 'absolute', inset: 0 }} iconSize={36} />
        {scrubbing && (
          <video ref={videoRef} src={streamUrl} muted preload="metadata" playsInline
            onError={() => setFailed(true)}
            className="absolute inset-0 w-full h-full object-cover" style={{ pointerEvents: 'none', backgroundColor: C.deep }} />
        )}
        {scrubbing && scrubFrac != null && (
          <div className="absolute bottom-0 left-0 h-[2px]" style={{ width: `${scrubFrac * 100}%`, backgroundColor: C.accent }} />
        )}
        {hex && <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ backgroundColor: hex }} />}
        {used > 0 && (
          <div className="absolute top-1 left-1 inline-flex items-center gap-0.5 px-1 rounded-sm text-[8.5px] font-mono tabular-nums" style={{ backgroundColor: 'rgba(12,10,9,0.7)', color: C.accentText }}
            title={`Used in ${used} shot${used === 1 ? '' : 's'}`}>
            <Clapperboard style={{ width: 9, height: 9 }} /> {used}
          </div>
        )}
        <div className="absolute top-1 right-1 flex items-center gap-1 px-1 rounded-sm" style={{ backgroundColor: 'rgba(12,10,9,0.7)' }}>
          <FlagMark flag={row.review_flag} circled={row.circled} size={11} />
        </div>
        <div className="absolute bottom-1 left-1"><MediaTag type={row.media_type} small /></div>
        {row.is_sequence && row.frame_count ? (
          <div className="absolute bottom-1 right-1 px-1 rounded-sm text-[8.5px] font-mono" style={{ backgroundColor: 'rgba(12,10,9,0.7)', color: C.muted }}>{row.frame_count} fr</div>
        ) : null}
      </div>
      <div className="px-2 py-1.5 min-w-0">
        <div className="truncate text-[11px] font-mono" style={{ color: C.bright }} title={row.display_name}>{row.display_name || row.original_name}</div>
        <div className="truncate text-[9.5px] font-mono" style={{ color: C.accentText, minHeight: 13 }}>{slateLine(row)}</div>
        <div className="truncate text-[9.5px] font-mono" style={{ color: C.dim, minHeight: 13 }} title={row.source_path}>
          {techLine(row) || row.original_name}
        </div>
        {binName != null && <div className="truncate text-[9px] font-mono mt-0.5 flex items-center gap-1" style={{ color: C.dimmer }}><ColorDot color={binColor} size={6} />{binName}</div>}
      </div>
    </div>
  )
}

