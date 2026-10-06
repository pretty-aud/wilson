// =============================================================================
// storage/videoThumbnails.js — Session 40: a still frame, automatically.
//
// NETWORK_STORAGE_DESIGN.md §5d.1b. Audrey, 2026-08-05:
//   "for videos i would want to be able to get a single still frame and make it
//    the thumbnail automatically lets add that."
//
// ── 🚨 WHY THIS IS A SEPARATE MODULE AND NOT AN OPTION ON generateThumbnail ──
//
// thumbnails.js `canThumbnail()` requires `startsWith('image/')` and REFUSES
// video deliberately. Two green, deliberately-worded guard tests pin that
// refusal — one asserts `canThumbnail('video/quicktime') === false`, the other
// asserts `generateThumbnail({type:'video/quicktime'})` returns null WITHOUT
// invoking the decoder. Widening it would mean rewriting both, and they are
// right: the seams `generateThumbnail` injects are `createImageBitmap` and a
// canvas factory, and **createImageBitmap cannot express seek-and-decode on an
// HTMLVideoElement**. It is a different decoder reached a different way, so it
// is a different entry point.
//
// What IS reused, because it is the same afterwards: `scaleToFit`, the
// THUMBNAIL_* constants, the canvas → JPEG encoder, `thumbnailKeyFor`, and
// `putThumbnailTo` / `removeThumbnailFrom`. One 256px JPEG, one bucket rule,
// one key derivation. Only the frame's origin differs.
//
// ── 🚨 THE CONTRACT IS S39'S, UNCHANGED: null, NEVER A THROW ────────────────
// Every caller runs after the source body has already landed. A codec this
// browser lacks, a seek past a truncated file, a canvas that will not allocate:
// all of those must cost a preview, never the file.
//
// ── ⚠️ THE CODEC LIMIT, STATED HONESTLY ─────────────────────────────────────
// This is the BROWSER's decoder. Chromium plays H.264/AAC MP4, VP8/VP9 WebM and
// AV1; it cannot play ProRes, DNxHD/DNxHR or most professional MOV/MXF
// variants. Those are ffmpeg's job (electron/ffmpeg.cjs), desktop-side. It is
// ONE decoder answering both questions, which is why a file that will not
// preview will not thumbnail either — and why the accurate detection in §5f is
// "we tried and it failed", not an extension guess.
//
// ── 🚨 TAINTED CANVAS, AND THE MEASURED CORRECTION ──────────────────────────
// Drawing a cross-origin video into a canvas taints it, and `toBlob` then
// throws SecurityError — which this module's own best-effort contract would
// swallow as `null`. So the failure mode is EVERY VIDEO SILENTLY GETS NO
// THUMBNAIL, with nothing in any log. `crossOrigin = 'anonymous'` (set BEFORE
// `src`, or it does not apply) is the guard.
//
// ⚠️ Measured 2026-08-09, correcting the S40 brief: the DESKTOP half of that
// warning is wrong. `mainWindow.loadURL('http://127.0.0.1:' + port)` — the
// renderer is served BY the same Express app that serves the stream route, so
// they are SAME-ORIGIN and tainting was never reachable there. It is a real
// risk on a presigned s3 URL, which is cross-origin by construction; that path
// is deferred, and the attribute is set here so it is already right when it
// lands. Setting it on a same-origin URL costs nothing.
// =============================================================================

import {
  THUMBNAIL_MAX_EDGE,
  THUMBNAIL_QUALITY,
  THUMBNAIL_MAX_BYTES,
  scaleToFit,
  canvasToJpeg,
  defaultCanvasFactory,
} from './thumbnails.js'

/**
 * Which frame. NOT frame 0 — video routinely opens on black, a fade-in or a
 * slate, and a wall of black thumbnails is worse than icons (§5d.1b).
 *
 * ~10% of duration, clamped to 1–10s. The clamp means the answer is ALWAYS in
 * [1, 10]: a clip of 10s or less takes 1s, anything from 100s up takes 10s.
 *
 * 🚨 THESE THREE NUMBERS ARE DUPLICATED IN electron/ffmpeg.cjs AND THE
 * DUPLICATE IS UNAVOIDABLE — that file is CJS in the main process and this is
 * ESM in the renderer. thumbnails.test.js asserts the two agree, so a change
 * here that is not mirrored there fails a test rather than producing two
 * different thumbnails for the same file depending on which decoder ran.
 */
export const SEEK_FRACTION = 0.1
export const SEEK_MIN_SEC = 1
export const SEEK_MAX_SEC = 10

export function seekTimestampFor(durationSec) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return SEEK_MIN_SEC
  return Math.min(SEEK_MAX_SEC, Math.max(SEEK_MIN_SEC, durationSec * SEEK_FRACTION))
}

// A decode that never settles must not hold a spinner open. Metadata for a
// multi-GB file over a NAS is a header read, not a full transfer, so this is
// generous rather than tight.
export const VIDEO_DECODE_TIMEOUT_MS = 30_000

/**
 * Every extension WILSON treats as video.
 *
 * 🚨 DELIBERATELY WIDER THAN WHAT A BROWSER CAN DECODE. This answers "is this
 * row a video at all" — the question the stream route, the ffmpeg arm and the
 * thumbnail gate all ask. Whether the bytes are decodable is answered by the
 * decoder that actually tries, never by a name: a `.mov` holds ProRes *or*
 * H.264 and nothing about the filename says which.
 *
 * ⚠️ MIRRORED IN electron/main.cjs (VIDEO_EXTENSIONS) for the same CJS/ESM
 * reason as the seek constants, and pinned by the same test.
 */
export const VIDEO_EXTENSIONS = new Set([
  // ⚠️ '.ts' IS DELIBERATELY ABSENT. MPEG transport streams use it, and so does
  // every TypeScript source file — and a creative-production tool sees far more
  // of the latter. With it in, a .ts file got a play button, spawned an ffmpeg
  // process against a text file, was streamed into a <video>, and earned a
  // "won't have a preview image" batch line. '.mts' and '.m2ts', which cameras
  // actually write, stay. Found by the pre-push adversarial review.
  '.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi', '.wmv', '.flv', '.mpg',
  '.mpeg', '.m2v', '.mts', '.m2ts',
  '.mxf', '.r3d', '.ari', '.arri', '.braw', '.dnx', '.dnxhd', '.dnxhr',
])

export function isVideoExtension(ext) {
  return VIDEO_EXTENSIONS.has(String(ext || '').toLowerCase())
}

/**
 * §5f's PRE-UPLOAD heuristic: extensions that are usually a professional codec.
 *
 * ⚠️ A COURTESY, AND WRONG IN THE HARMLESS DIRECTION ON PURPOSE. An H.264 `.mov`
 * gets a notice it did not need; nothing is blocked either way. The ACCURATE
 * answer comes after the attempt — if the browser could not decode it, it
 * genuinely cannot, and that is the same decoder answering the same question.
 * `.mov` is here because it is the common professional container even though it
 * frequently holds H.264.
 */
export const PROFESSIONAL_VIDEO_EXTENSIONS = new Set([
  '.mov', '.mxf', '.r3d', '.ari', '.arri', '.braw', '.dnx', '.dnxhd', '.dnxhr',
])

export function isProbablyProfessionalCodec(ext) {
  return PROFESSIONAL_VIDEO_EXTENSIONS.has(String(ext || '').toLowerCase())
}

/**
 * Whether a body is worth attempting as a video.
 *
 * Keyed on MIME TYPE for the same reason `canThumbnail` is: a cloud `files` row
 * has `mime_type` and no `extension` column at all.
 *
 * 🚨 THIS IS NOT canThumbnail AND MUST NOT BE FOLDED INTO IT. That function's
 * refusal of video is pinned by two tests and is correct — see the header.
 */
export function canThumbnailVideo(mimeType) {
  if (typeof mimeType !== 'string') return false
  return mimeType.trim().toLowerCase().startsWith('video/')
}

/**
 * Whether a picked `File` is worth handing to the video decoder.
 *
 * 🚨 MIME **OR** EXTENSION, AND THE `OR` IS THE POINT (adversarial review).
 * `File.type` comes from the OS MIME registry, and Chromium's built-in table
 * has no entry for .mov/.mkv/.avi/.wmv — so on a machine whose registry lacks
 * them `file.type` is the EMPTY STRING. Gating on the type alone meant no
 * `<video>` was ever constructed for an H.264 `.mov` the browser decodes
 * perfectly well: `canThumbnailVideo('')` is false, `canThumbnail('')` is false,
 * no decoder ran, and the row kept an icon.
 *
 * That is the expensive direction. Generation is the ONE-WAY DOOR — a preview
 * never made can only be made later by downloading the whole source — while a
 * wrong guess here costs one failed decode. Note the asymmetry with S39: the
 * image gate never had this exposure, because browsers DO carry MIME entries
 * for jpeg/png/gif/webp/avif.
 */
export function looksLikeVideoFile(file) {
  if (!file) return false
  if (canThumbnailVideo(file.type)) return true
  const name = String(file.name || '')
  const dot = name.lastIndexOf('.')
  return dot > 0 && isVideoExtension(name.slice(dot))
}

// ── The decode ──────────────────────────────────────────────────────────────

function defaultVideoFactory() {
  if (typeof document === 'undefined') return null
  return document.createElement('video')
}

/**
 * Produce a 256px JPEG Blob from one frame of a video, or null.
 *
 * @param {string} src   A URL the <video> can load: an object URL for a File in
 *                       memory, or the desktop stream route for a managed file.
 *                       🚨 Callers that mint an object URL must revoke it —
 *                       this function does not own the URL it is handed.
 *
 * Dependencies are injected so the logic is testable without a DOM, matching
 * generateThumbnail's shape.
 */
export async function generateVideoThumbnail(src, {
  maxEdge = THUMBNAIL_MAX_EDGE,
  quality = THUMBNAIL_QUALITY,
  maxBytes = THUMBNAIL_MAX_BYTES,
  timeoutMs = VIDEO_DECODE_TIMEOUT_MS,
  makeVideo = defaultVideoFactory,
  makeCanvas = defaultCanvasFactory,
} = {}) {
  if (!src || typeof src !== 'string') return null
  const video = makeVideo()
  if (!video || !makeCanvas) return null

  try {
    // 🚨 crossOrigin BEFORE src. Setting it afterwards does not apply to a load
    // already in flight, which is how this silently reverts to a tainted canvas.
    video.crossOrigin = 'anonymous'
    video.preload = 'auto'
    // muted + playsInline keep autoplay policy out of it — nothing is played,
    // but some engines refuse to decode a frame for an element they consider
    // blocked from playback.
    video.muted = true
    video.playsInline = true
    video.src = src

    await waitForEvent(video, 'loadedmetadata', timeoutMs)

    const width = video.videoWidth
    const height = video.videoHeight
    const size = scaleToFit(width, height, maxEdge)
    // 0x0 means the metadata loaded but no VIDEO track decoded — an audio-only
    // file with a video container extension, or a codec the engine listed and
    // cannot actually read.
    if (!size) return null

    // A live stream reports Infinity; seekTimestampFor floors that to 1s, and
    // the clamp below keeps the request inside a finite duration when there is
    // one. The 0.05 backstop is for a file whose duration is shorter than the
    // floor — seeking past the end never fires 'seeked' on some engines.
    const duration = video.duration
    let target = seekTimestampFor(duration)
    if (Number.isFinite(duration) && duration > 0) {
      target = Math.min(target, Math.max(0, duration - 0.05))
    }

    video.currentTime = target
    await waitForEvent(video, 'seeked', timeoutMs)

    const canvas = makeCanvas(size.width, size.height)
    if (!canvas) return null
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, size.width, size.height)

    // 🚨 THIS is where a tainted canvas surfaces — as a thrown SecurityError,
    // caught below and reported as "no preview". See the header for why that
    // silence is the dangerous shape and what prevents it.
    const blob = await canvasToJpeg(canvas, quality)
    if (!blob) return null
    if (typeof blob.size === 'number' && blob.size > maxBytes) return null
    return blob
  } catch {
    return null
  } finally {
    // Release the decoder and stop any buffering still in flight. Without the
    // load() an Electron renderer keeps the pipeline alive, and a batch of
    // thirty clips holds thirty of them.
    try {
      video.removeAttribute('src')
      video.load?.()
    } catch { /* a stub element in tests has neither */ }
  }
}

/**
 * Resolve on `name`, reject on the element's own 'error' or a timeout.
 *
 * 🚨 A <video> THAT CANNOT DECODE FIRES 'error' AND NOTHING ELSE — no
 * 'loadedmetadata', ever. Waiting on the success event alone would hang for
 * every ProRes file until the timeout, thirty seconds at a time, which on a
 * folder of professional footage is indistinguishable from the app freezing.
 */
function waitForEvent(target, name, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timer = null
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      target.removeEventListener?.(name, onOk)
      target.removeEventListener?.('error', onErr)
    }
    const onOk = () => { cleanup(); resolve() }
    const onErr = () => { cleanup(); reject(new Error(`[video] ${name} failed`)) }
    target.addEventListener?.(name, onOk, { once: true })
    target.addEventListener?.('error', onErr, { once: true })
    timer = setTimeout(() => { cleanup(); reject(new Error(`[video] ${name} timed out`)) }, timeoutMs)
  })
}

/**
 * The convenience the upload path wants: a File in memory → a JPEG Blob, with
 * the object URL created and revoked here so no caller can leak one.
 *
 * A `blob:` URL is same-origin, so this path can never taint a canvas.
 */
export async function generateVideoThumbnailFromFile(file, opts = {}) {
  // looksLikeVideoFile, not canThumbnailVideo — see its header: File.type is
  // '' for .mov/.mkv/.avi/.wmv on a machine whose OS MIME registry lacks them.
  if (!looksLikeVideoFile(file)) return null
  const makeUrl = opts.makeObjectUrl
    || (typeof URL !== 'undefined' && URL.createObjectURL ? (f) => URL.createObjectURL(f) : null)
  const revokeUrl = opts.revokeObjectUrl
    || (typeof URL !== 'undefined' && URL.revokeObjectURL ? (u) => URL.revokeObjectURL(u) : () => {})
  if (!makeUrl) return null

  let url = null
  try {
    url = makeUrl(file)
    return await generateVideoThumbnail(url, opts)
  } catch {
    return null
  } finally {
    if (url) { try { revokeUrl(url) } catch { /* nothing to release */ } }
  }
}
