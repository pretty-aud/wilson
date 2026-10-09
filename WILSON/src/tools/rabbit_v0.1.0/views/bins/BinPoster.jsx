// ============================================================
// RABBIT — Bins: the poster frame of one bin file
// ============================================================
//
// An <img> pointed at the bins thumbnail route, with the FileThumbnail rule
// (S40): remember WHICH src failed, not that one did, so a poster that
// arrives later (a probe finished, a relink brought the file back, the rev
// counter bumped) repairs the tile without a remount. When there is no
// poster the media type's icon stands in; an offline row says so on the tile.

import { useEffect, useState } from 'react'
import { Film, Image as ImageIcon, Music, Layers, Sparkles, FileText, File as FileIcon, Unplug, PenTool } from 'lucide-react'
import { C } from './binUi'
import { MEDIA_TYPE_META } from '../../bins/binMedia'
import { NOT_ON_THIS_COMPUTER } from '../../bins/binLocations'
// The provider's value from the context module, never the provider's own
// module: that builds the cloud client on import (CI has no Supabase address).
import { useRabbitContext } from '../../state/rabbitContext'

// ── BC2: a cloud clip's picture where THIS computer has none ──
// A clip of a company (it has a footage location) shows its picture even
// when this computer cannot reach the file (B3: "still shows, with its
// picture"): the poster cached here first (the `src` the caller gives), and
// when there is none, the one in the cloud — kept there only while the
// company allows it (B4) — signed per read by the provider and kept for a
// while, so a grid of clips signs each picture once, not on every render.
const signedPosters = new Map() // poster_path → { url, until }
const SIGNED_FOR_MS = 50 * 60 * 1000
function useCloudPoster(row, wanted) {
  const ctx = useRabbitContext()
  const sign = ctx?.binFilePosterUrl
  const key = wanted && row?.poster_path && typeof sign === 'function' ? row.poster_path : null
  const [url, setUrl] = useState(() => {
    const hit = key ? signedPosters.get(key) : null
    return hit && hit.until > Date.now() ? hit.url : null
  })
  useEffect(() => {
    if (!key) { setUrl(null); return undefined }
    const hit = signedPosters.get(key)
    if (hit && hit.until > Date.now()) { setUrl(hit.url); return undefined }
    let live = true
    Promise.resolve(sign(row, { expiresIn: 3600 })).then((u) => {
      if (u) signedPosters.set(key, { url: u, until: Date.now() + SIGNED_FOR_MS })
      if (live) setUrl(u || null)
    }).catch(() => { if (live) setUrl(null) })
    return () => { live = false }
    // The row's identity changes on every provider update; its picture's
    // key is what decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return url
}

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

// P1-62 (B5b-17): the placeholder glyph is on the icon scale, three sizes
// (plan §3.3: 14 inside dense controls, 16 in rows, 24 in empty states). It
// was computed from the frame, anything from 12 to 40px, and callers asked
// for 28 / 36 / 40. The largest step that fits a third of the frame (or the
// size a caller asks for); a frame given as a percentage takes the largest.
const ICON_STEPS = [24, 16, 14]
export function posterGlyphSize(width, iconSize = null) {
  const want = iconSize ?? (typeof width === 'number' ? width / 3 : Infinity)
  return ICON_STEPS.find((s) => s <= want) ?? ICON_STEPS[ICON_STEPS.length - 1]
}

// `contain`: the whole picture inside the frame (BC3's large view in a
// browser); every tile and row keeps the cover crop.
export default function BinPoster({ row, src, width = 32, height = null, radius = 3, className = '', style = {}, iconSize = null, primary = false, contain = false }) {
  // WHICH sources failed (S40), a set: a local poster and a cloud one may
  // both fail, and neither may be retried in a loop.
  const [failed, setFailed] = useState(() => new Set())
  const h = height ?? width
  const Icon = mediaIconFor(row?.media_type)
  const meta = MEDIA_TYPE_META[row?.media_type] || MEDIA_TYPE_META.other
  const offline = row?.online === false
  // BC2: a clip of a company keeps its picture when it is not on this
  // computer (B3); a clip of the signed-out desktop shows as it always has
  // (B12: no picture while its drive is out).
  const cloudRow = !!row?.location_id
  const localOk = !!src && !failed.has(src) && (!offline || cloudRow)
  const cloud = useCloudPoster(row, cloudRow && !localOk)
  const shown = localOk ? src : (cloud && !failed.has(cloud) ? cloud : null)
  const showImg = !!shown
  const glyph = posterGlyphSize(width, iconSize)
  return (
    <div className={`bn-poster relative overflow-hidden flex items-center justify-center flex-shrink-0 ${className}`}
      data-offline={offline ? 'true' : undefined}
      data-primary={primary ? 'true' : undefined}
      style={{ width, height: h, borderRadius: radius, ...style }}>
      {showImg ? (
        <img key={shown} src={shown} alt="" loading="lazy" draggable={false}
          onError={() => setFailed(s => new Set(s).add(shown))}
          className={contain ? 'object-contain' : 'object-cover'} style={{ width: '100%', height: '100%' }} />
      ) : (
        <Icon className="bn-poster-icon" style={{ width: glyph, height: glyph, '--poster-icon': meta.color }} />
      )}
      {offline && (
        <div className="bn-scrim absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 py-1">
          <Unplug style={{ width: 10, height: 10, color: C.amber }} />
          {width >= 96 && <span className="text-label uppercase" style={{ color: C.amber }}>{cloudRow ? NOT_ON_THIS_COMPUTER : 'offline'}</span>}
        </div>
      )}
    </div>
  )
}
