// =============================================================================
// storage/managedVideoThumbnail.js — Session 40: a still frame for a DESKTOP
// managed file. NETWORK_STORAGE_DESIGN.md §5d.1b.
//
// ── 🚨 WHY THIS EXISTS AT ALL, AND WHY IT IS NOT THE CLOUD PATH ─────────────
//
// S39's cloud machinery does NOT cover desktop managed files, and assuming it
// does is the fastest way to waste this session. `putThumbnailTo` needs a
// storage provider and a Supabase client; `thumbnailKeyFor` needs a
// `files.storage_path`; `thumbnail_url` is a column on `public.files`. A
// managed file has NONE of the three — it lives in the project bundle's
// `managedFiles` array and its preview is an on-disk JPEG at
// `getThumbCacheDir()/{id}.jpg`, served by an Express route. There is no
// rabbit-thumbnails write to make and nowhere to record a key.
//
// ── THE TWO DECODERS, SERVER FIRST ──────────────────────────────────────────
//
//   1. ffmpeg, in the main process. Covers ProRes, DNxHD, MXF — everything a
//      browser cannot read — and it INPUT-SEEKS a local file, which beats
//      streaming megabytes over HTTP to reach one frame. Preferred whenever the
//      binary is installed.
//   2. The renderer's own `<video>`, through the Range-capable stream route.
//      Covers H.264/AAC MP4, VP8/VP9 WebM and AV1 — most of what is not
//      professional footage — and needs no binary at all.
//
// Asking the server FIRST is what makes (2) a fallback rather than a competitor:
// one GET either returns a frame ffmpeg made, or answers `415 ffmpeg_missing`
// and costs nothing. Trying the renderer first would stream a 5 GB ProRES file
// over HTTP only to fail at the decode.
//
// 🚨 THE RENDERER ARM COSTS NO EGRESS AND THAT IS NOT AN ACCIDENT. The stream
// route reads local disk, so `<video>` fetches a few ranges off the same
// machine. This is the one place §12.7b's "never download the source to make a
// postage stamp" rule is satisfied by the source already being local.
//
// ── ⚠️ BEST-EFFORT, LIKE EVERY OTHER PREVIEW PATH ──────────────────────────
// The file has ALREADY been copied into the project folder when this runs.
// Never throws; the worst outcome is a file-type icon.
// =============================================================================

import { generateVideoThumbnail, isVideoExtension } from './videoThumbnails.js'
// B3 (Track B): the thumbnail HEAD/POST below hit the desktop loopback API,
// which refuses /api without the per-launch token. The <video> arm needs no
// change — it is an element load, and main's httpOnly cookie rides on it.
import { localFetch } from '../../../lib/localServerFetch.js'

export function managedThumbnailUrl(projectId, fileId) {
  return `/api/rabbit/projects/${projectId}/managed-files/${fileId}/thumbnail`
}

export function managedStreamUrl(projectId, fileId, { probe = false } = {}) {
  const base = `/api/rabbit/projects/${projectId}/managed-files/${fileId}/stream`
  // 🚨 `probe=1` SUPPRESSES THE AS-2.9 'downloaded' AUDIT EVENT, and it has to.
  // The renderer fallback below points a hidden <video> at this route purely to
  // decode one frame — a MACHINE fetch, not a person opening a file. Without
  // the marker, importing thirty clips wrote thirty 'downloaded' events
  // timestamped at import, so the audit drawer asserted that someone had
  // watched footage nobody had opened; and because rabbitLogFileEvent evicts
  // the oldest non-'purged' entries at 2000, that churn pushed out the
  // project's real upload and relink history to make room. Exactly the failure
  // the stream route's own throttle was written to prevent, reintroduced by a
  // caller. Found by the pre-push adversarial review.
  return probe ? `${base}?probe=1` : base
}

/**
 * base64 for the POST body.
 *
 * 🚨 CHUNKED. `String.fromCharCode(...bytes)` on a 256 KB buffer spreads a
 * quarter of a million arguments onto the call stack and throws
 * RangeError: Maximum call stack size exceeded — on the LARGEST thumbnails
 * only, which is exactly the shape that passes every small test and fails on
 * real footage.
 */
export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/**
 * Make sure a managed video row has a cached preview, by whichever decoder can.
 *
 * @returns {Promise<{ok: boolean, via: string|null, reason: string|null}>}
 *   `via` is 'ffmpeg' or 'renderer' — worth knowing at the call site, because
 *   'renderer' means this machine has no professional-codec decoder installed
 *   and the §5f notice should stop pointing at the desktop app.
 */
export async function ensureManagedVideoThumbnail({
  projectId,
  fileId,
  extension,
  fetchImpl = typeof fetch === 'function' ? localFetch : null,
  generate = generateVideoThumbnail,
  toBase64 = blobToBase64,
} = {}) {
  if (!projectId || !fileId) return { ok: false, via: null, reason: 'missing_ids' }
  if (!isVideoExtension(extension)) return { ok: false, via: null, reason: 'not_video' }
  if (!fetchImpl) return { ok: false, via: null, reason: 'no_fetch' }

  const thumbUrl = managedThumbnailUrl(projectId, fileId)

  // 1. Server first. A HEAD runs the same generation as a GET without sending
  //    the JPEG back over the loopback — the point is to make the cache entry
  //    exist, not to look at it.
  try {
    const head = await fetchImpl(thumbUrl, { method: 'HEAD' })
    if (head?.ok) return { ok: true, via: 'ffmpeg', reason: null }
  } catch { /* the server arm is optional; fall through */ }

  // 2. The renderer's own decoder, through the Range-capable stream route.
  let blob = null
  try {
    blob = await generate(managedStreamUrl(projectId, fileId, { probe: true }))
  } catch { /* generateVideoThumbnail returns null rather than throwing, but a
                 stub in a test might not */ }
  if (!blob) return { ok: false, via: null, reason: 'undecodable' }

  try {
    const base64 = await toBase64(blob)
    const res = await fetchImpl(thumbUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base64 }),
    })
    // 🚨 CHECK res.ok. fetch RESOLVES for every status — the trap this repo has
    // documented since supabaseOtterAdapter.js:253-255, and the reason an
    // unchecked await turned a 404 into a green tick for every Validator fix
    // Audrey ever accepted. A refused write here must not report success.
    if (!res?.ok) return { ok: false, via: null, reason: `post_${res?.status ?? 'failed'}` }
    return { ok: true, via: 'renderer', reason: null }
  } catch (err) {
    return { ok: false, via: null, reason: err?.message || 'post_failed' }
  }
}
