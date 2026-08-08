// =============================================================================
// storage/thumbnails.js — Session 39: derived previews, generated on the
// machine doing the upload.
//
// NETWORK_STORAGE_DESIGN.md §5d.1. Audrey, 2026-08-05:
//   "all thumbnails need to be accessible on web and desktop"
//   "lets store thumbnails within the supabase storage ... and lets set a file
//    size limit for thumbnails. thats a very common thing."
//
// 🚨 WHY GENERATION HAPPENS HERE AND NOT ON A SERVER. The file is already in
// memory on the uploading machine, so this costs nothing. The alternative —
// generating on demand, or server-side — means DOWNLOADING THE SOURCE first:
// gigabytes of egress at Petal's expense to produce a postage stamp, on
// exactly the multi-GB media this product exists for (§4a2). That is the one
// expensive design and it is why `thumbnail_url` sat unwritten since 0000
// rather than being wired to the desktop's sharp pipeline.
//
// createImageBitmap + canvas runs IDENTICALLY in a browser and in the Electron
// renderer, which is what lets one implementation serve both surfaces. No
// library. `sharp` stays where it is — it is a main-process dependency and
// cannot run in a browser at all.
//
// ⚠️ THIS IS THE CLOUD PATH ONLY. The desktop's Local Server mode keeps its six
// Express thumbnail routes and its own on-disk cache; those serve managed files
// and entity images, which have no `files` row and no bucket. See §12.7b for
// what that leaves uneven.
// =============================================================================

export const THUMBNAIL_BUCKET = 'rabbit-thumbnails'

// The longest edge, in CSS pixels. Matches the desktop managed-file route
// (sharp .resize(256), main.cjs) so the two tiers agree about what a thumbnail
// IS. The entity routes use 512/q85 — a pre-existing inconsistency, recorded
// in §12.7b rather than silently adopted here.
export const THUMBNAIL_MAX_EDGE = 256

// 0.8 matches the desktop route's jpeg({ quality: 80 }).
export const THUMBNAIL_QUALITY = 0.8

// 🚨 MIRRORS migration 0053's bucket file_size_limit EXACTLY. Storage refuses
// anything larger, and a refusal after the source body has already landed is a
// confusing half-success; checking here turns it into a skipped thumbnail with
// a reason. The bucket is still the authority — this is the courtesy check, not
// the gate. If one changes, change both.
export const THUMBNAIL_MAX_BYTES = 262144

// Image types createImageBitmap cannot be relied on to decode in both a browser
// and Chromium's renderer, or that should not be rasterised at all:
//
//   * TIFF — no browser decodes it natively. The DESKTOP list (THUMB_EXTENSIONS
//     in main.cjs) includes .tiff/.tif because sharp does. Cloud cannot, and
//     pretending otherwise produces a failed decode per upload.
//   * SVG — deliberately excluded. Rasterising untrusted SVG in a canvas can
//     pull external references, and a vector file gains little from a 256px
//     raster preview.
const UNTHUMBNAILABLE = new Set([
  'image/tiff',
  'image/x-tiff',
  'image/svg+xml',
])

/**
 * Whether a body is worth attempting. Keyed on MIME TYPE, not on a filename
 * extension: a cloud `files` row HAS `mime_type` and has no `extension` column
 * at all (0000:221-236 — the absence that makes FileThumbnail's extension test
 * dead code on the web).
 */
export function canThumbnail(mimeType) {
  if (typeof mimeType !== 'string') return false
  const m = mimeType.trim().toLowerCase()
  if (!m.startsWith('image/')) return false
  return !UNTHUMBNAILABLE.has(m)
}

/**
 * The thumbnail's key is its source's key plus '.jpg', and that is load-bearing
 * rather than tidy.
 *
 * 🚨 Storage RLS keys on path SEGMENTS and the THIRD segment is the money gate
 * (public.rabbit_money_segment, 0042). Holding the layout identical is what
 * lets migration 0053 carry the same eight policies with only bucket_id
 * changed — so an invoice's thumbnail lands inside the same manager-only
 * namespace as the invoice. Introducing a `thumbs/` level, or rewriting the
 * name, shifts every segment and silently moves the derived image OUT of the
 * gate it is supposed to inherit.
 */
export function thumbnailKeyFor(storagePath) {
  if (typeof storagePath !== 'string' || storagePath.trim() === '') return null
  return `${storagePath}.jpg`
}

/** Fit within a square without distorting or upscaling. */
export function scaleToFit(width, height, maxEdge = THUMBNAIL_MAX_EDGE) {
  if (!(width > 0) || !(height > 0)) return null
  const ratio = Math.min(maxEdge / width, maxEdge / height, 1)
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  }
}

/**
 * Produce a 256px JPEG Blob, or null.
 *
 * 🚨 RETURNS null RATHER THAN THROWING, and every caller depends on it. A
 * thumbnail is a convenience; the upload of somebody's rushes is not. The
 * house pattern is one function away in uploadFile — the folder-row lookup is
 * "best-effort on purpose: a missing folder row must not refuse an upload".
 * A codec this browser lacks, a corrupt header, a canvas that will not
 * allocate: all of those must cost a preview, never the file.
 *
 * Dependencies are injected so the pure logic is testable without a DOM.
 */
export async function generateThumbnail(file, {
  maxEdge = THUMBNAIL_MAX_EDGE,
  quality = THUMBNAIL_QUALITY,
  maxBytes = THUMBNAIL_MAX_BYTES,
  createBitmap = typeof createImageBitmap === 'function' ? createImageBitmap : null,
  makeCanvas = defaultCanvasFactory,
} = {}) {
  if (!file || !canThumbnail(file.type)) return null
  if (!createBitmap || !makeCanvas) return null

  let bitmap = null
  try {
    bitmap = await createBitmap(file)
    const size = scaleToFit(bitmap.width, bitmap.height, maxEdge)
    if (!size) return null

    const canvas = makeCanvas(size.width, size.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, size.width, size.height)

    const blob = await canvasToJpeg(canvas, quality)
    if (!blob) return null

    // The bucket would refuse it anyway (0053: 256 KB); refusing here means the
    // caller reports "no preview" instead of a storage error after the source
    // has already landed.
    if (typeof blob.size === 'number' && blob.size > maxBytes) return null
    return blob
  } catch {
    return null
  } finally {
    // OffscreenCanvas bitmaps hold GPU memory until closed, and an upload
    // screen can run this dozens of times in a row.
    try { bitmap?.close?.() } catch { /* not all implementations have it */ }
  }
}

function defaultCanvasFactory(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height)
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  return c
}

// OffscreenCanvas exposes convertToBlob (a promise); HTMLCanvasElement exposes
// toBlob (a callback). Both appear depending on surface and browser version.
function canvasToJpeg(canvas, quality) {
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: 'image/jpeg', quality })
  }
  if (typeof canvas.toBlob === 'function') {
    return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
  }
  return Promise.resolve(null)
}

/**
 * Upload one thumbnail. Separate from the storage REGISTRY on purpose.
 *
 * 🚨 The registry is keyed by `files.storage_provider` — it answers "where does
 * THIS BODY live", and a thumbnail is not a body: it has no `files` row of its
 * own and its provider is always Supabase, even for a workspace whose media
 * sits in its own S3 bucket (0053's header states that decision). Registering
 * a thumbnail entry there would put a second meaning into a vocabulary that
 * already carries exactly one.
 *
 * And the bucket is NOT a parameter, for the reason supabaseProvider.js:18-21
 * already gives: "a `bucket` argument here would be an invitation to point
 * project files at the wrong policy set."
 *
 * upsert:true, unlike the source. A source object is immutable — every upload
 * is a distinct user action and a silent overwrite destroys a version nobody
 * asked to replace. A thumbnail is derived, its key is a pure function of its
 * source's key, and regenerating it must be able to replace a stale render.
 * That is what migration 0053's UPDATE policies are for.
 */
export async function putThumbnail(client, key, blob) {
  const { error } = await client.storage.from(THUMBNAIL_BUCKET).upload(key, blob, {
    contentType: 'image/jpeg',
    cacheControl: '3600',
    upsert: true,
  })
  if (error) throw new Error(`[thumbnails] upload failed: ${error.message}`)
  return { key }
}

/**
 * Removal, for the compensating delete when a files row is refused.
 *
 * 🚨 THROWS ON REFUSAL, and that is the point. This is the ONLY cleanup path a
 * stranded thumbnail has — with no files row there is no `thumbnail_url`, so
 * the purge trigger never sees it and the orphan scan does not walk this
 * bucket. supabase-js RESOLVES on an error rather than throwing (the trap this
 * repo has documented since `supabaseOtterAdapter.js:253-255`), so an
 * unchecked `await` here would turn an expired token into a silent success and
 * leave a legible frame of the content in the bucket with nothing to find it.
 * The caller logs; it cannot log what it is never told.
 * Same shape as `supabaseProvider.del`.
 */
export async function removeThumbnail(client, key) {
  if (!key) return
  const { error } = await client.storage.from(THUMBNAIL_BUCKET).remove([key])
  if (error) throw new Error(`[thumbnails] delete failed: ${error.message}`)
}

/**
 * Mint display URLs for a batch of thumbnail keys.
 *
 * 🚨 BATCHED ON PURPOSE. The bucket is PRIVATE (0053; a public one would be
 * TPN-CLOUD-004 repeated for pre-release frames), so every tile needs a signed
 * URL. A file grid renders dozens at once and a per-tile round trip is the
 * difference between a grid that paints and one that crawls.
 *
 * Keys the caller is not allowed to read simply come back without a URL — RLS
 * decides, and an invoice thumbnail requested by a non-manager yields nothing
 * rather than an error to handle. Failure of the whole call yields an empty
 * map, so the UI falls back to icons rather than breaking.
 */
export async function signedThumbnailUrls(client, keys, expiresIn = 3600) {
  const unique = [...new Set((keys || []).filter(Boolean))]
  if (unique.length === 0) return new Map()
  try {
    const { data, error } = await client
      .storage.from(THUMBNAIL_BUCKET)
      .createSignedUrls(unique, expiresIn)
    if (error) return new Map()
    const out = new Map()
    for (const row of data || []) {
      if (row?.path && row?.signedUrl && !row.error) out.set(row.path, row.signedUrl)
    }
    return out
  } catch {
    return new Map()
  }
}
