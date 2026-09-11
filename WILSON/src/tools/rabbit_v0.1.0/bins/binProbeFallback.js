// ============================================================
// RABBIT — bins: the renderer's own probe (no ffmpeg on this machine)
// ============================================================
//
// docs/BINS_DESIGN.md §4.1: "without ffmpeg the renderer reads duration and
// size from a hidden <video> for browser-playable files, as the thumbnail
// fallback does today." This is that path. Chromium decodes H.264/AAC MP4,
// WebM, the common audio formats and the common images; for a row the server
// marked `unavailable` (no decoder) the view calls this, stores what came
// back through a history-free provider call, and posts the frame it drew as
// the poster. Never called for professional codecs: previewKindFor decides,
// and the element's own error ends the attempt.

import { seekTimestampFor } from '../storage/videoThumbnails.js'

const MAX_EDGE = 256

function withTimeout(promise, ms, label) {
  let t
  const timeout = new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`${label} timed out`)), ms) })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t))
}

/**
 * True when a drawn frame is uniformly (near-)black: every sampled pixel
 * under the threshold. Pure, so the test can pin it. A real black frame
 * (a fade-in) looks the same as a frame drawn before the decoder had one,
 * and the caller treats both the same way: wait, and draw again.
 */
export function isBlankFrame(data, threshold = 8) {
  if (!data || !data.length) return true
  const step = Math.max(4, Math.floor(data.length / 4 / 512) * 4)
  for (let i = 0; i < data.length; i += step) {
    if (data[i] > threshold || data[i + 1] > threshold || data[i + 2] > threshold) return false
  }
  return true
}

function drawToJpeg(source, width, height) {
  if (!width || !height || typeof document === 'undefined') return null
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx2d = canvas.getContext('2d')
  if (!ctx2d) return null
  ctx2d.drawImage(source, 0, 0, canvas.width, canvas.height)
  let blank = false
  try { blank = isBlankFrame(ctx2d.getImageData(0, 0, canvas.width, canvas.height).data) } catch { /* tainted canvas: keep the frame */ }
  const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
  const i = dataUrl.indexOf(',')
  return { jpegBase64: i > 0 ? dataUrl.slice(i + 1) : null, blank }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/**
 * Chromium fires `seeked` before the frame at the new position is always
 * ready for drawImage (measured 2026-09-10: one poster in seven came out
 * black on a colour-bar clip, while the same clip drew fine a minute
 * earlier). Wait for a presented frame where the browser can say so, else
 * for HAVE_CURRENT_DATA, bounded.
 */
function framePresented(v, ms = 1500) {
  return new Promise((resolve) => {
    let done = false
    const finish = () => { if (!done) { done = true; clearTimeout(t); resolve() } }
    const t = setTimeout(finish, ms)
    if (typeof v.requestVideoFrameCallback === 'function') v.requestVideoFrameCallback(finish)
    if (v.readyState >= 2) { requestAnimationFrame(finish) }
    else v.addEventListener('loadeddata', () => requestAnimationFrame(finish), { once: true })
  })
}

/**
 * @param {'video'|'audio'|'image'} kind
 * @param {string} src  the stream URL (with ?probe=1 where the caller wants no audit event)
 * @returns {Promise<{ duration_sec?: number, width?: number, height?: number, jpegBase64?: string|null }>}
 *   Rejects on decode failure or timeout; the caller marks the row failed.
 */
export async function probeInBrowser(kind, src, { timeoutMs = 20000 } = {}) {
  if (typeof document === 'undefined') throw new Error('no DOM')
  if (kind === 'image') {
    const img = new Image()
    await withTimeout(new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('image failed')); img.src = src }), timeoutMs, 'image')
    return { width: img.naturalWidth || null, height: img.naturalHeight || null, jpegBase64: null }
  }
  if (kind === 'audio') {
    const a = document.createElement('audio')
    a.preload = 'metadata'
    await withTimeout(new Promise((resolve, reject) => { a.onloadedmetadata = resolve; a.onerror = () => reject(new Error('audio failed')); a.src = src }), timeoutMs, 'audio')
    const d = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : null
    a.removeAttribute('src'); try { a.load() } catch { /* released */ }
    return { duration_sec: d, jpegBase64: null }
  }
  const v = document.createElement('video')
  v.muted = true; v.preload = 'metadata'; v.playsInline = true
  await withTimeout(new Promise((resolve, reject) => { v.onloadedmetadata = resolve; v.onerror = () => reject(new Error('video failed')); v.src = src }), timeoutMs, 'video metadata')
  const duration = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null
  const width = v.videoWidth || null
  const height = v.videoHeight || null
  let jpegBase64 = null
  try {
    const ts = Math.min(seekTimestampFor(duration), Math.max(0, (duration || 1) - 0.05))
    await withTimeout(new Promise((resolve, reject) => { v.onseeked = resolve; v.onerror = () => reject(new Error('seek failed')); v.currentTime = ts }), timeoutMs, 'video seek')
    await framePresented(v)
    let drawn = drawToJpeg(v, width, height)
    // A blank frame is drawn again after a beat, then once more a second
    // further in (a clip that fades in from black gets its first real
    // frame that way); a clip that is black all through keeps the frame.
    if (drawn?.blank) { await sleep(300); drawn = drawToJpeg(v, width, height) }
    if (drawn?.blank && duration && ts + 1 < duration - 0.05) {
      await withTimeout(new Promise((resolve, reject) => { v.onseeked = resolve; v.onerror = () => reject(new Error('seek failed')); v.currentTime = ts + 1 }), timeoutMs, 'video seek')
      await framePresented(v)
      drawn = drawToJpeg(v, width, height)
    }
    jpegBase64 = drawn?.jpegBase64 || null
  } catch { /* the columns are still worth keeping */ }
  v.removeAttribute('src'); try { v.load() } catch { /* released */ }
  return { duration_sec: duration, width, height, jpegBase64 }
}
