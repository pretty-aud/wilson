// ============================================================
// RABBIT — Bins: the picture, large (BC3, the browser)
// ============================================================
//
// Where nothing can play (the capability object says `stream` is false: a
// browser), Space on the selected clip shows its picture large instead of
// playing a preview, so keyboard review — arrows, S / R / U, C, the colours —
// works without a player: the view is laid over the files pane, not on the
// overlay stack, so every Bins key keeps working under it, the clip it shows
// follows the current row, and Space or Escape closes it. The picture is the
// cloud's (BinPoster signs it once and keeps it), the whole of it inside the
// frame; a clip with no picture shows its kind's icon, never a broken image.
//
// Laws of UX (laws-of-ux, BC3): Paradox of the active user — the keys that
// work are written on the view itself, not in a manual; Common region — one
// raised surface with a hairline, no card inside a card; Cognitive load —
// the name, the marks, the slate and the one sentence, nothing else.

import { X, Unplug } from 'lucide-react'
import { C, IconBtn, MediaTag, FlagMark } from './binUi'
import BinPoster from './BinPoster'
import { slateLine, techLine } from '../../bins/binMedia'
import { NOT_ON_THIS_COMPUTER, PLAY_NEEDS_DESKTOP, browserClipSentence } from '../../bins/binLocations'

export default function PosterLarge({ row, location = null, catalogue = false, onClose }) {
  if (!row) return null
  const notHere = row.online === false && !!row.location_id
  return (
    <div className="bn-poster-large absolute inset-3 z-30 flex flex-col rounded-float shadow-float overflow-hidden" role="region" aria-label="The picture, large" data-testid="poster-large">
      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0 min-w-0" style={{ borderBottom: `1px solid ${C.line}` }}>
        <span className="truncate text-dense font-mono font-semibold" style={{ color: C.bright }} title={row.display_name || row.original_name}>{row.display_name || row.original_name}</span>
        <FlagMark flag={row.review_flag} circled={row.circled} size={12} />
        <MediaTag type={row.media_type} small />
        <span className="truncate text-caption" style={{ color: C.accentText }}>{slateLine(row)}</span>
        <span className="ml-auto text-caption flex-shrink-0" style={{ color: C.dim }}>Space or Esc closes · arrows move · S, R, U mark</span>
        <IconBtn Icon={X} title="Close (Space)" onClick={onClose} />
      </div>
      <div className="bn-poster-large-frame flex-1 min-h-0 flex items-center justify-center p-3">
        <BinPoster row={row} src={null} width="100%" height="100%" radius={0} iconSize={40} contain style={{ border: 'none', backgroundColor: 'transparent' }} />
      </div>
      <div className="px-3 py-2 text-caption flex items-center gap-3 flex-shrink-0 min-w-0" style={{ color: C.dim, borderTop: `1px solid ${C.line}` }}>
        <span className="truncate font-mono flex-shrink-0">{techLine(row) || row.original_name}</span>
        {notHere && <span className="inline-flex items-center gap-1 flex-shrink-0" style={{ color: C.amber }}><Unplug className="w-3 h-3" /> {NOT_ON_THIS_COMPUTER}</span>}
        <span className="truncate">{catalogue && notHere ? browserClipSentence(location?.name) : PLAY_NEEDS_DESKTOP}</span>
      </div>
    </div>
  )
}
