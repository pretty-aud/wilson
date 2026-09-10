// ============================================================
// RABBIT — Bins: the poster frame of one bin file
// ============================================================
//
// An <img> pointed at the bins thumbnail route, with the FileThumbnail rule
// (S40): remember WHICH src failed, not that one did, so a poster that
// arrives later (a probe finished, a relink brought the file back, the rev
// counter bumped) repairs the tile without a remount. When there is no
// poster the media type's icon stands in; an offline row says so on the tile.

import { useState } from 'react'
import { Film, Image as ImageIcon, Music, Layers, Sparkles, FileText, File as FileIcon, Unplug, PenTool } from 'lucide-react'
import { C } from './binUi'
import { MEDIA_TYPE_META } from '../../bins/binMedia'

export function mediaIconFor(type) {
  switch (type) {
    case 'video': return Film
    case 'still': return ImageIcon
    case 'audio': return Music
    case 'sequence': return Layers
    case 'vfx': return Sparkles
    case 'graphic': return PenTool
    case 'document': return FileText
    default: return FileIcon
  }
}

export default function BinPoster({ row, src, width = 32, height = null, radius = 2, className = '', style = {}, iconSize = null }) {
  const [erroredSrc, setErroredSrc] = useState(null)
  const h = height ?? width
  const Icon = mediaIconFor(row?.media_type)
  const meta = MEDIA_TYPE_META[row?.media_type] || MEDIA_TYPE_META.other
  const offline = row?.online === false
  const showImg = !!src && erroredSrc !== src && !offline
  return (
    <div className={`relative overflow-hidden flex items-center justify-center flex-shrink-0 ${className}`}
      style={{ width, height: h, borderRadius: radius, backgroundColor: C.deep, border: `1px solid ${C.line}`, ...style }}>
      {showImg ? (
        <img key={src} src={src} alt="" loading="lazy" draggable={false}
          onError={() => setErroredSrc(src)}
          className="object-cover" style={{ width: '100%', height: '100%' }} />
      ) : (
        <Icon style={{ width: iconSize || Math.max(12, Math.min(40, width / 3)), height: iconSize || Math.max(12, Math.min(40, width / 3)), color: offline ? C.dimmer : meta.color, opacity: offline ? 0.6 : 0.9 }} />
      )}
      {offline && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 py-[2px]" style={{ backgroundColor: 'rgba(12,10,9,0.8)' }}>
          <Unplug style={{ width: 10, height: 10, color: C.amber }} />
          {width >= 96 && <span className="text-[8.5px] font-mono uppercase tracking-wider" style={{ color: C.amber }}>offline</span>}
        </div>
      )}
    </div>
  )
}
