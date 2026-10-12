// ============================================================
// RABBIT — Bins: what the gateway serves and the browser plays (GW3)
// ============================================================
//
// G7, D8 (GATEWAY_DESIGN.md §5, §7): the gateway serves an allow-list
// narrower than the desktop's, and the browser plays what its own decoders
// take. A clip plays when its extension is on the list, `canPlayType` does
// not answer the empty string for its type (with the probe's codec where
// BC2 recorded one), and the first bytes decode; anything else shows the
// cloud picture and NEEDS_DESKTOP_FORMAT. No transcoding anywhere.
//
// Pure: `canPlayType` is injected (a <video>'s own in the app, a table in
// the tests).

/** The gateway's allow-list, extension → the type it serves (§5, D8). */
export const GATEWAY_PLAYABLE = Object.freeze({
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.bwf': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
})

// The codec names BC2's probe records (ffmpeg's, or a person's "ProRes 422
// HQ"), as RFC 6381 strings a browser can be asked about; matched on the
// name's letters and digits by prefix, so "H.264", "h264" and "x264" are
// one. Video only: an audio container decides its own decoder. A name not
// here is not asked about: the decode decides (§7: "the first bytes decode").
const CODEC_STRINGS = Object.freeze({
  h264: 'avc1.42E01E', avc1: 'avc1.42E01E', avc: 'avc1.42E01E', x264: 'avc1.42E01E',
  hevc: 'hvc1.1.6.L93.B0', h265: 'hvc1.1.6.L93.B0', hvc1: 'hvc1.1.6.L93.B0', hev1: 'hev1.1.6.L93.B0', x265: 'hvc1.1.6.L93.B0',
  vp8: 'vp8', vp9: 'vp09.00.10.08', av1: 'av01.0.05M.08',
  prores: 'apcn', apch: 'apch', apcn: 'apcn', dnxhd: 'AVdn', dnxhr: 'AVdh', mjpeg: 'mjpeg', mpeg2: 'mp4v.20.9', mpeg4: 'mp4v.20.9',
})
const CODEC_KEYS = Object.keys(CODEC_STRINGS).sort((a, b) => b.length - a.length)
export function codecStringFor(codec) {
  const key = String(codec || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!key) return null
  const hit = CODEC_KEYS.find((k) => key === k || key.startsWith(k))
  return hit ? CODEC_STRINGS[hit] : null
}

function extOf(row) {
  const raw = String(row?.extension || '').trim().toLowerCase()
  if (raw) return raw.startsWith('.') ? raw : `.${raw}`
  const name = String(row?.original_name || '')
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i).toLowerCase() : ''
}

/**
 * { playable, kind: 'video'|'audio'|'image'|null, mime, reason:
 *   'format' (not on the list) | 'codec' (the browser refuses the recorded
 *   codec) | null }. A sequence plays as its middle frame, which must be an
 * allow-listed still (§5).
 */
export function playabilityOf(row, { canPlayType = null } = {}) {
  const ext = extOf(row)
  const mime = GATEWAY_PLAYABLE[ext] || null
  if (!mime) return { playable: false, kind: null, mime: null, reason: 'format' }
  if (mime.startsWith('image/')) return { playable: true, kind: 'image', mime, reason: null }
  if (row?.is_sequence) return { playable: false, kind: null, mime: null, reason: 'format' }
  const kind = mime.startsWith('audio/') ? 'audio' : 'video'
  if (typeof canPlayType === 'function' && kind === 'video') {
    const codec = codecStringFor(row?.codec)
    // .mov decides nothing about the codec (§5): asked as MP4 with the codec
    // when one is recorded, and left to the decode when none is.
    const askMime = mime === 'video/quicktime' ? 'video/mp4' : mime
    const ask = mime === 'video/quicktime' && !codec ? null : (codec ? `${askMime}; codecs="${codec}"` : askMime)
    if (ask) {
      let answer = ''
      try { answer = canPlayType(ask) || '' } catch { answer = '' }
      if (answer === '') return { playable: false, kind, mime, reason: codec ? 'codec' : 'format' }
    }
  }
  return { playable: true, kind, mime, reason: null }
}

let probeEl = null
/** The page's own answer, memoised on one <video> (null outside a document). */
export function browserCanPlayType() {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null
  if (!probeEl) probeEl = document.createElement('video')
  return typeof probeEl.canPlayType === 'function' ? (s) => probeEl.canPlayType(s) : null
}
