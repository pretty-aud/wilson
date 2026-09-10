// ============================================================
// RABBIT — bins: media vocabulary (renderer copy)
// ============================================================
//
// The server (electron/rabbitBins.cjs) decides a file's media type when it is
// added; the renderer needs the same tables to colour the tag chips, to know
// what Chromium can play, and to re-guess when the user changes a type by
// hand. Two copies, ESM here and CJS there, kept honest by binMedia.test.js —
// the S40 pattern for VIDEO_EXTENSIONS.

export const VIDEO_EXTS = new Set([
  '.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi', '.wmv', '.flv', '.mpg',
  '.mpeg', '.m2v', '.mts', '.m2ts',
  '.mxf', '.r3d', '.ari', '.arri', '.braw', '.dnx', '.dnxhd', '.dnxhr',
])
export const STILL_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.tiff', '.tif', '.bmp', '.avif', '.heic', '.heif',
])
export const AUDIO_EXTS = new Set(['.wav', '.bwf', '.aif', '.aiff', '.mp3', '.flac', '.m4a', '.ogg', '.aac', '.wma'])
export const GRAPHIC_EXTS = new Set(['.psd', '.psb', '.ai', '.svg', '.eps', '.indd', '.afdesign', '.sketch', '.fig'])
export const VFX_EXTS = new Set(['.exr', '.dpx', '.tga', '.hdr', '.cin'])
export const DOC_EXTS = new Set(['.pdf', '.txt', '.md', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.rtf', '.pages', '.numbers'])
export const SEQUENCE_EXTS = new Set(['.exr', '.dpx', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.tga'])
export const BROWSER_VIDEO_EXTS = new Set(['.mp4', '.m4v', '.webm'])
// Chromium's own audio decoders. AIFF and BWF are NOT in the list on purpose:
// a <audio> pointed at them errors, and the panel must say so, not spin.
export const BROWSER_AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac'])
export const BROWSER_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif', '.svg'])

export const MEDIA_TYPES = ['video', 'still', 'sequence', 'audio', 'graphic', 'vfx', 'document', 'other']
export const REVIEW_FLAGS = ['unflagged', 'select', 'reject']
export const COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink']
export const BIN_KINDS = ['footage', 'audio', 'stills', 'graphics', 'vfx', 'selects', 'other']

// The tag chip per media type. Stone surface, one hue each, readable at 11px.
export const MEDIA_TYPE_META = {
  video:    { label: 'Video',    short: 'VID', color: '#fb923c', bg: 'rgba(251,146,60,0.14)' },
  still:    { label: 'Still',    short: 'IMG', color: '#38bdf8', bg: 'rgba(56,189,248,0.14)' },
  sequence: { label: 'Sequence', short: 'SEQ', color: '#a78bfa', bg: 'rgba(167,139,250,0.14)' },
  audio:    { label: 'Audio',    short: 'AUD', color: '#4ade80', bg: 'rgba(74,222,128,0.14)' },
  graphic:  { label: 'Graphic',  short: 'GFX', color: '#f472b6', bg: 'rgba(244,114,182,0.14)' },
  vfx:      { label: 'VFX',      short: 'VFX', color: '#c084fc', bg: 'rgba(192,132,252,0.14)' },
  document: { label: 'Document', short: 'DOC', color: '#a8a29e', bg: 'rgba(168,162,158,0.14)' },
  other:    { label: 'Other',    short: 'OTH', color: '#78716c', bg: 'rgba(120,113,108,0.14)' },
}

export const COLOR_HEX = {
  red: '#ef4444', orange: '#f97316', yellow: '#eab308', green: '#22c55e',
  cyan: '#06b6d4', blue: '#3b82f6', purple: '#a855f7', pink: '#ec4899',
}

export const BIN_KIND_META = {
  footage:  { label: 'Footage' },
  audio:    { label: 'Audio' },
  stills:   { label: 'Stills' },
  graphics: { label: 'Graphics' },
  vfx:      { label: 'VFX' },
  selects:  { label: 'Selects' },
  other:    { label: 'Other' },
}

export const TAKE_MODIFIERS = ['PU', 'SER', 'MOS', 'PLATE', 'TONE', 'WILD']

export function extOf(name) {
  const s = String(name || '')
  const i = s.lastIndexOf('.')
  if (i < 0) return ''
  const e = s.slice(i).toLowerCase()
  return /^\.[a-z0-9]{1,12}$/.test(e) ? e : ''
}

export function guessMediaType(ext) {
  const e = String(ext || '').toLowerCase()
  if (VIDEO_EXTS.has(e)) return 'video'
  if (STILL_EXTS.has(e)) return 'still'
  if (AUDIO_EXTS.has(e)) return 'audio'
  if (VFX_EXTS.has(e)) return 'vfx'
  if (GRAPHIC_EXTS.has(e)) return 'graphic'
  if (DOC_EXTS.has(e)) return 'document'
  return 'other'
}

/** What the preview panel can do with a row, decided by extension, never by a spinner. */
export function previewKindFor(row) {
  if (!row) return 'none'
  const ext = String(row.extension || '').toLowerCase()
  if (row.is_sequence) return 'frame'
  if (row.media_type === 'video' || VIDEO_EXTS.has(ext)) return BROWSER_VIDEO_EXTS.has(ext) ? 'video' : 'poster'
  if (row.media_type === 'still' || STILL_EXTS.has(ext)) return BROWSER_IMAGE_EXTS.has(ext) ? 'image' : 'poster'
  if (row.media_type === 'audio' || AUDIO_EXTS.has(ext)) return BROWSER_AUDIO_EXTS.has(ext) ? 'audio' : 'none'
  if (row.media_type === 'vfx' || VFX_EXTS.has(ext)) return 'poster'
  if (row.media_type === 'graphic') return 'poster'
  return 'none'
}

/** True when a tile can hover-scrub (Chromium decodes it and it is not a still). */
export function canHoverScrub(row) {
  return previewKindFor(row) === 'video'
}

export function formatDuration(sec) {
  const n = Number(sec)
  if (!Number.isFinite(n) || n <= 0) return ''
  const h = Math.floor(n / 3600)
  const m = Math.floor((n % 3600) / 60)
  const s = Math.floor(n % 60)
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function formatBytes(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n < 0) return ''
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let u = 0
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++ }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`
}

/** hh:mm:ss:ff at the given fps; the timecode column for rows without a source TC. */
export function secondsToTimecode(sec, fps = 24) {
  const n = Number(sec)
  const f = Number(fps) > 0 ? Number(fps) : 24
  if (!Number.isFinite(n) || n < 0) return ''
  const totalFrames = Math.round(n * f)
  const frames = totalFrames % Math.round(f)
  const totalSec = Math.floor(totalFrames / Math.round(f))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const p = (x) => String(x).padStart(2, '0')
  return `${p(h)}:${p(m)}:${p(s)}:${p(frames)}`
}

/** The text a card shows under a name: what the research calls the technical columns. */
export function techLine(row) {
  if (!row) return ''
  const parts = []
  if (row.is_sequence && row.frame_count) parts.push(`${row.frame_count} fr`)
  if (row.duration_sec) parts.push(formatDuration(row.duration_sec))
  if (row.width && row.height) parts.push(`${row.width}×${row.height}`)
  if (row.fps) parts.push(`${Number(row.fps) % 1 === 0 ? row.fps : Number(row.fps).toFixed(2)} fps`)
  if (row.codec) parts.push(String(row.codec).toUpperCase())
  return parts.join(' · ')
}

/** "24A · T3 PU · A cam" — the slate line, only the parts that exist. */
export function slateLine(row) {
  if (!row) return ''
  const parts = []
  if (row.slate) parts.push(row.slate)
  if (row.take_number) parts.push(`T${row.take_number}${row.take_modifier ? ' ' + row.take_modifier : ''}`)
  else if (row.take_modifier) parts.push(row.take_modifier)
  if (row.camera) parts.push(`${row.camera} cam`)
  return parts.join(' · ')
}
