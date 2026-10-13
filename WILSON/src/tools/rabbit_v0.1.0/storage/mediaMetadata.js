// =============================================================================
// storage/mediaMetadata.js — what a file row says about the file itself
// (demo 2026-09-11).
//
// Audrey, 2026-09-11, verbatim: "make sure that in the databases for files,
// it states the name of the file, file type, creation date and time, file
// size, if its an audio or video file the duration as well."
//
// name, mime_type and size_bytes have always been on the row. This module
// adds the two the row could not say — the source file's own modified time
// (the only timestamp a browser File object carries; a file's birth time is
// not readable from a renderer) and, for audio/video, its DURATION, read
// from the bytes by a <video>/<audio> element as the file is added. That
// decodes what Chromium decodes (H.264/AAC MP4, WebM, MP3, WAV, FLAC, OGG);
// ProRes, DNxHD and MXF come back null and the row keeps no duration — the
// desktop's ffmpeg probe (electron/ffmpeg.cjs, the bins) is the only reader
// for those, and this machine has no ffmpeg. Bounded (8 s) and best-effort:
// a metadata miss never refuses an upload.
//
// Pure over injected DOM seams so it is tested in node; the defaults reach
// for the real document/URL at call time.
// =============================================================================

export const VIDEO_EXT = new Set(['mov', 'mp4', 'm4v', 'mkv', 'avi', 'webm', 'mxf', 'wmv', 'mpg', 'mpeg', 'mts', 'm2ts', 'r3d', 'braw', 'dnxhd', 'prores'])
export const AUDIO_EXT = new Set(['wav', 'mp3', 'aac', 'flac', 'aif', 'aiff', 'm4a', 'ogg', 'oga', 'opus', 'wma', 'caf'])
export const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'tif', 'tiff', 'bmp', 'exr', 'psd', 'avif', 'heic', 'heif', 'svg', 'dpx', 'tga', 'ai'])
export const DOC_EXT = new Set(['pdf', 'doc', 'docx', 'txt', 'md', 'rtf', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'key', 'pages', 'numbers', 'json'])

export const PROBE_TIMEOUT_MS = 8000

export function extensionOf(name) {
  const s = String(name || '')
  const i = s.lastIndexOf('.')
  if (i <= 0 || i === s.length - 1) return ''
  return s.slice(i + 1).toLowerCase()
}

/** 'video' | 'audio' | 'image' | 'document' | 'other' — mime first, then the extension. */
export function mediaKind(fileOrRow) {
  const mime = String(fileOrRow?.type || fileOrRow?.mime_type || '').toLowerCase()
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf' || mime.startsWith('text/') || /msword|officedocument|opendocument|rtf/.test(mime)) return 'document'
  const ext = extensionOf(fileOrRow?.name || fileOrRow?.file_name || fileOrRow?.stored_name)
  if (VIDEO_EXT.has(ext)) return 'video'
  if (AUDIO_EXT.has(ext)) return 'audio'
  if (IMAGE_EXT.has(ext)) return 'image'
  if (DOC_EXT.has(ext)) return 'document'
  return 'other'
}

export function isMediaFile(fileOrRow) {
  const k = mediaKind(fileOrRow)
  return k === 'video' || k === 'audio'
}

const KIND_LABEL = { video: 'Video', audio: 'Audio', image: 'Image', document: 'Document', other: 'File' }

/** "Video · MOV", "Image · PNG", "File · FBX"; "Folder" for a folder node. */
export function fileTypeLabel(row) {
  if (!row) return ''
  if (row.kind === 'folder' && !row.name && !row.mime_type) return 'Folder'
  const ext = extensionOf(row.name || row.file_name || row.stored_name)
  const label = KIND_LABEL[mediaKind(row)] || 'File'
  return ext ? `${label} · ${ext.toUpperCase()}` : label
}

/** 12.5 → "0:12"; 3725 → "1:02:05"; null/0 → "". */
export function formatDuration(sec) {
  const n = Number(sec)
  if (!Number.isFinite(n) || n <= 0) return ''
  const total = Math.round(n)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`
}

function defaultSeams() {
  const doc = typeof document !== 'undefined' ? document : null
  const url = typeof URL !== 'undefined' ? URL : null
  return {
    createElement: doc ? (tag) => doc.createElement(tag) : null,
    createObjectURL: url && typeof url.createObjectURL === 'function' ? (f) => url.createObjectURL(f) : null,
    revokeObjectURL: url && typeof url.revokeObjectURL === 'function' ? (u) => url.revokeObjectURL(u) : () => {},
  }
}

/**
 * The duration of an audio/video File in seconds (3 decimals), or null when
 * the file is not media, the element cannot decode it, or PROBE_TIMEOUT_MS
 * passes. Never throws.
 */
export function probeMediaDuration(file, seams = {}) {
  const { createElement, createObjectURL, revokeObjectURL, timeoutMs = PROBE_TIMEOUT_MS } = { ...defaultSeams(), ...seams }
  if (!file || !isMediaFile(file)) return Promise.resolve(null)
  if (typeof createElement !== 'function' || typeof createObjectURL !== 'function') return Promise.resolve(null)
  return new Promise((resolve) => {
    let el = null
    let url = null
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      try { if (el) { el.onloadedmetadata = null; el.onerror = null; el.src = ''; if (typeof el.load === 'function') el.load() } } catch { /* the element is disposable */ }
      try { if (url) revokeObjectURL(url) } catch { /* already revoked */ }
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    try {
      el = createElement(mediaKind(file) === 'audio' ? 'audio' : 'video')
      el.preload = 'metadata'
      el.muted = true
      el.onloadedmetadata = () => {
        clearTimeout(timer)
        const d = Number(el.duration)
        finish(Number.isFinite(d) && d > 0 ? Math.round(d * 1000) / 1000 : null)
      }
      el.onerror = () => { clearTimeout(timer); finish(null) }
      url = createObjectURL(file)
      el.src = url
    } catch {
      clearTimeout(timer)
      finish(null)
    }
  })
}

/** The two facts a row cannot know on its own: { durationSec, sourceModifiedAt }. */
export async function describeSourceFile(file, seams = {}) {
  let durationSec = null
  try { durationSec = await probeMediaDuration(file, seams) } catch { durationSec = null }
  const lm = Number(file?.lastModified)
  const sourceModifiedAt = Number.isFinite(lm) && lm > 0 ? new Date(lm).toISOString() : null
  return { durationSec, sourceModifiedAt }
}
