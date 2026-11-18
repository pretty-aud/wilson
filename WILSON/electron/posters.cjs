// =============================================================================
// posters.cjs — "serve the cached JPEG, else make it once, atomically": the
// one poster maker and the one acceptor (F9; the desktop-build review's A2).
//
// It was written six times — main.cjs's managed-file, asset and entity GETs,
// the two generate channels, the bins' and the cloud bins' GETs — and three
// acceptors, and the hardening the bins' review round 2 gave its own copy
// reached that copy only. Measured at 81df858b: main.cjs's five sharp calls
// wrote in place through libvips, with no single flight; the cloud bins' GET
// had no single flight; the managed-file acceptor wrote in place; every part
// was `<poster>.part`, one name for every writer. Each GET serves a poster on
// its EXISTENCE alone, so a torn write is served for good.
//
//   makePoster({ src, dest, edge, quality, fit, replace })
//     sharp to a buffer (libvips cannot write past MAX_PATH on Windows; Node's
//     fs can — the bins' review round 2, measured on a 268-character cache
//     path), then the whole poster to a part of its own (pid + random) renamed
//     into place. One write in flight per poster: a second ask for a poster
//     being made waits and finds it made (`replace: false`, a GET); a NEW
//     picture (`replace: true`, the two generate channels) is made after the
//     one in flight, and wins — sharing the old write would keep the old
//     picture. Each caller keeps its geometry (`fit: 'width'` is resize(edge),
//     the main process's; `'inside'` is the bins' box, never enlarged), so a
//     poster made now matches the ones already cached.
//   putPoster(dest, buf)     an accepted poster, written the same way, in turn
//   clearPoster(dest)        after the write in flight, the poster goes
//   acceptPoster(base64)     the bins' narrowing: a string, decoded, at most
//                            256 KB (THUMBNAIL_MAX_BYTES, 0053's cap), a JPEG
//                            by its magic number — else { status, error }
//   generateVideoThumbOnce   the ffmpeg arm (moved here from main.cjs): one
//                            run per poster, a failure remembered five minutes
//   mountPosterRoutes        main.cjs's poster routes, moved here so they are
//                            served in tests: the managed-file GET and POST,
//                            the asset GET and the four entity GETs — the same
//                            paths and the same answers
//
// One module, one in-flight map per process: main.cjs (its routes and the
// four channels) and rabbitBins.cjs require it, so a GET, a channel and an
// acceptor asking for one still's poster take turns. The ffmpeg arm keeps its
// own single flight and is not in that order (review round 1; OUTSTANDING
// F9-04 says what that leaves). The bins' tests inject their own fakes for
// everything else and stay unedited.
// =============================================================================
'use strict';

const nodeFs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { LOCK_CODES } = require('./jsonFile.cjs');
const { sendMedia, requireSameOrigin } = require('./mediaSend.cjs');
const ffmpegModule = require('./ffmpeg.cjs');

const POSTER_MAX_BYTES = 262144; // THUMBNAIL_MAX_BYTES / migration 0053's bucket cap: the two tiers agree
const RENAME_ATTEMPTS = 5;
// A picture on a share that stops answering mid-read would hold its poster's
// turn — and a new picture picked for it — until the OS gave up (review
// round 1): a make that takes longer than this fails, writes nothing, and
// lets the next one go. Generous: a large TIFF from a slow share takes seconds.
const ENCODE_DEADLINE_MS = 30_000;

// ── one write in flight per poster ───────────────────────────────────────────
const tails = new Map();
// The file system's own rule for "the same file": case folds on Windows and
// macOS only (jsonFile.cjs's).
const FOLDS_CASE = process.platform === 'win32' || process.platform === 'darwin';
const keyOf = (dest) => { const p = path.resolve(String(dest)); return FOLDS_CASE ? p.toLowerCase() : p; };
function inTurn(dest, work) {
  const key = keyOf(dest);
  const run = (tails.get(key) || Promise.resolve()).then(work);
  const tail = run.then(() => {}, () => {}); // a failed write does not hold the next
  tails.set(key, tail);
  tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
  return run;
}

/** The whole poster to a part of its own, renamed into place; no part left
 *  behind. A rename Windows refuses while it holds a file (an indexer, a
 *  virus scan) is tried again after a pause that WAITS, never blocks: the
 *  main process keeps answering meanwhile (review round 1). */
async function writePosterAtomically(dest, buf, { fsImpl = nodeFs, pauseMs = 20 } = {}) {
  const part = `${dest}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.part`;
  try {
    fsImpl.writeFileSync(part, buf);
    for (let attempt = 1; ; attempt += 1) {
      try {
        fsImpl.renameSync(part, dest);
        break;
      } catch (err) {
        if (attempt >= RENAME_ATTEMPTS || !LOCK_CODES.includes(err?.code)) throw err;
        await new Promise((resolve) => setTimeout(resolve, pauseMs * attempt));
      }
    }
  } catch (err) {
    try { fsImpl.unlinkSync(part); } catch { /* never made, or gone */ }
    throw err;
  }
}

/** The encode, or a POSTER_TIMEOUT once `ms` has passed (its late answer is dropped). */
function withDeadline(work, ms) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('the poster took too long to make'), { code: 'POSTER_TIMEOUT' })), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** A JPEG of `src` in the caller's geometry, as a buffer. */
async function encodePoster(src, { edge, quality, fit = 'width' }) {
  const sharp = require('sharp');
  const image = sharp(src);
  const sized = fit === 'inside'
    ? image.resize(edge, edge, { fit: 'inside', withoutEnlargement: true })
    : image.resize(edge);
  return sized.jpeg({ quality }).toBuffer();
}

function makePoster({ src, dest, edge, quality, fit = 'width', replace = false, encode = encodePoster, fsImpl = nodeFs, deadlineMs = ENCODE_DEADLINE_MS, pauseMs }) {
  if (fit !== 'width' && fit !== 'inside') return Promise.reject(new Error(`makePoster: unknown fit ${fit}`));
  return inTurn(dest, async () => {
    if (!replace && fsImpl.existsSync(dest)) return { made: false };
    const buf = await withDeadline(Promise.resolve().then(() => encode(src, { edge, quality, fit })), deadlineMs);
    await writePosterAtomically(dest, buf, { fsImpl, pauseMs });
    return { made: true };
  });
}

function putPoster(dest, buf, { fsImpl = nodeFs, pauseMs } = {}) {
  return inTurn(dest, () => writePosterAtomically(dest, buf, { fsImpl, pauseMs }));
}

function clearPoster(dest, { fsImpl = nodeFs } = {}) {
  return inTurn(dest, () => {
    if (fsImpl.existsSync(dest)) { try { fsImpl.unlinkSync(dest); } catch { /* next clear */ } }
  });
}

/** The three acceptors' rule, once: `{ ok: true, buf }` or `{ ok: false, status, error }`. */
function acceptPoster(base64) {
  if (!base64 || typeof base64 !== 'string') return { ok: false, status: 400, error: 'base64 required' };
  let buf;
  try { buf = Buffer.from(base64, 'base64'); } catch { buf = null; }
  if (!buf || buf.length === 0) return { ok: false, status: 400, error: 'unreadable body' };
  if (buf.length > POSTER_MAX_BYTES) return { ok: false, status: 413, error: 'thumbnail too large' };
  if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) return { ok: false, status: 415, error: 'not a JPEG' };
  return { ok: true, buf };
}

// ── Session 40: one ffmpeg run per thumbnail, and never a half-written one ───
//
// 🚨 THE PARTIAL FILE IS THE DEFECT THAT WOULD HAVE SHIPPED. Every caller of
// the GET route serves `thumbPath` straight back when it EXISTS — so a run that
// fails after creating the output leaves a zero-byte or truncated JPEG that is
// then served, cached and never regenerated. The unlink is what makes a failed
// decode retry next time instead of pinning a broken tile forever.
//
// 🚨 AND ONE RUN AT A TIME PER OUTPUT. A grid renders the same tile from more
// than one place, React re-renders, and a user can scroll back — all of which
// issue concurrent GETs for the same key. Two ffmpeg processes writing one path
// with `-y` means one truncates the file the other is serving. Decoding a frame
// out of a 5 GB ProRes file is also the most expensive thing this server does,
// so sharing the in-flight promise is worth it on cost alone.
// 🚨 AND A FAILURE IS REMEMBERED FOR A WHILE (adversarial review). Nothing
// recorded that a file is undecodable, so a folder of .r3d or .braw respawned
// probe + extract for EVERY visible tile on EVERY mount of the Files view —
// toggling table/gallery, scrolling back, reopening the popup. Each of those
// costs up to the full deadline. The TTL is short enough that installing
// ffmpeg, or fixing a NAS that was offline, is picked up without a restart.
const VIDEO_THUMB_FAIL_TTL_MS = 5 * 60_000;
const videoThumbFailedAt = new Map();

const videoThumbInFlight = new Map();
function generateVideoThumbOnce(srcPath, thumbPath) {
  const failedAt = videoThumbFailedAt.get(thumbPath);
  if (failedAt !== undefined && Date.now() - failedAt < VIDEO_THUMB_FAIL_TTL_MS) {
    return Promise.resolve({ ok: false, reason: 'no_frame_cached' });
  }
  const existing = videoThumbInFlight.get(thumbPath);
  if (existing) return existing;
  const run = (async () => {
    const out = await ffmpegModule.extractFrame({ input: srcPath, output: thumbPath, maxEdge: 256 });
    if (!out.ok) {
      // extractFrame writes to `<output>.part` and renames, so `thumbPath`
      // should never exist after a failure — this is the belt to that braces,
      // and cheap. `ffmpeg_missing` is NOT cached: it is a machine state the
      // user can change by dropping a binary in, not a property of this file.
      try { if (nodeFs.existsSync(thumbPath)) nodeFs.unlinkSync(thumbPath); } catch { /* next run overwrites */ }
      if (out.reason !== 'ffmpeg_missing') {
        if (videoThumbFailedAt.size > 500) {
          const cutoff = Date.now() - VIDEO_THUMB_FAIL_TTL_MS;
          for (const [k, t] of videoThumbFailedAt) if (t < cutoff) videoThumbFailedAt.delete(k);
        }
        videoThumbFailedAt.set(thumbPath, Date.now());
      }
    } else {
      videoThumbFailedAt.delete(thumbPath);
    }
    return out;
  })().finally(() => videoThumbInFlight.delete(thumbPath));
  videoThumbInFlight.set(thumbPath, run);
  return run;
}

// 🚨 Session 40: the managed-file id is CLIENT-CHOSEN on create
// (`id: req.body.id || uuidv4()`), and the thumbnail cache is ONE flat
// directory shared with the asset/scene/shot/level/experience caches, which use
// the un-namespaced keys `asset-<id>.jpg`, `scene-<id>.jpg` and so on. So a
// caller could create a managed row with id `asset-<a real asset uuid>` and
// then POST arbitrary JPEG bytes to it, permanently replacing that asset's
// thumbnail — those routes serve the cached file before ever consulting the
// source. resolveContainedFilePath stops traversal but not COLLISION: both
// namespaces are the same folder. Requiring a bare UUID closes it without
// touching the existing cache layout. Found by the pre-push adversarial review.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const POSTER = Object.freeze({ mime: 'image/jpeg' });
const ENTITY_KINDS = Object.freeze(['scenes', 'shots', 'levels', 'experiences']);

/**
 * main.cjs's poster routes (moved here word for word but for the one maker
 * and the one sender). Every route's first line is the same-origin gate: a
 * poster is the renderer's own <img> (and the probe's HEAD, through
 * localFetch). Every poster is sent by sendMedia: through a demo folder's
 * dot-folder (F3-01) and no-store, where the asset and entity posters said
 * `public, max-age=60` (TPN-CONT-003).
 */
function mountPosterRoutes(expressApp, deps) {
  const {
    readRabbitBundle, rabbitNotFound, getThumbCacheDir, resolveContainedFilePath, dataFileOrThrow,
    resolveProjectFolderRoot, resolveManagedFileDiskPath, thumbnailSourceAllowed, isThumbableExt, isVideoExt,
    ffmpeg = ffmpegModule, encode = encodePoster, log = console,
  } = deps;
  for (const [name, fn] of Object.entries({
    readRabbitBundle, rabbitNotFound, getThumbCacheDir, resolveContainedFilePath, dataFileOrThrow,
    resolveProjectFolderRoot, resolveManagedFileDiskPath, thumbnailSourceAllowed, isThumbableExt, isVideoExt,
  })) {
    if (typeof fn !== 'function') throw new Error(`mountPosterRoutes: ${name} is required`);
  }
  const P = '/api/rabbit/projects/:projectId';

  // A managed file's poster: a 256px-wide JPEG via sharp, or a frame via ffmpeg.
  expressApp.get(`${P}/managed-files/:id/thumbnail`, async (req, res) => {
    if (!requireSameOrigin(req, res)) return;
    const bundle = readRabbitBundle(req.params.projectId);
    if (!bundle) return rabbitNotFound(res);
    const mf = (bundle.managedFiles || []).find(f => f.id === req.params.id);
    if (!mf) return rabbitNotFound(res, 'managed-file');
    // Session 40: video joins raster here. The two arms are NOT the same
    // decoder — sharp cannot open a ProRes MOV — so the branch is explicit
    // rather than a widened extension set feeding one pipeline.
    const isImage = isThumbableExt(mf.extension);
    const isVideo = isVideoExt(mf.extension);
    if (!isImage && !isVideo) {
      return res.status(415).json({ error: 'not an image or video', code: 'unsupported_type' });
    }
    // Session 17 containment (#45). Three of the segments below are
    // client-writable: mf.id (chosen on create), mf.stored_name, and
    // asset.folder_slug (the asset POST/PATCH spread req.body). Each is
    // resolved under its own base and refused on escape, so this route
    // cannot be turned into an arbitrary-file read or .jpg overwrite.
    const thumbPath = resolveContainedFilePath(getThumbCacheDir(), `${mf.id}.jpg`);
    if (!thumbPath) return res.status(400).json({ error: 'invalid thumbnail path' });
    if (nodeFs.existsSync(thumbPath)) return sendMedia(res, thumbPath, POSTER);
    const root = resolveProjectFolderRoot(bundle);
    if (!root) return res.status(404).json({ error: 'no file root configured' });
    // Session 40: one resolver, shared with the stream route: the record's OWN
    // folder_path, so a managed file under SCENES/ or SHOTS/ resolves.
    const srcPath = resolveManagedFileDiskPath(bundle, mf);
    if (!srcPath) return res.status(400).json({ error: 'invalid source path' });
    if (!nodeFs.existsSync(srcPath)) return res.status(410).json({ error: 'source file missing' });

    if (isVideo) {
      // 🚨 THE BINARY'S ABSENCE IS A NAMED STATE, NOT A 500. The renderer uses
      // this code to decide whether to decode the format itself through the
      // stream route; "no decoder installed" must not read as "corrupt".
      if (!ffmpeg.hasFfmpeg()) {
        return res.status(415).json({ error: 'no video decoder installed on this machine', code: 'ffmpeg_missing' });
      }
      try {
        const out = await generateVideoThumbOnce(srcPath, thumbPath);
        if (!out.ok) return res.status(422).json({ error: 'could not decode a frame', code: out.reason });
        return sendMedia(res, thumbPath, POSTER);
      } catch (err) {
        log.error('video thumbnail failed:', err?.message || err);
        return res.status(500).json({ error: 'thumbnail generation failed' });
      }
    }

    try {
      await makePoster({ src: srcPath, dest: thumbPath, edge: 256, quality: 80, encode });
      sendMedia(res, thumbPath, POSTER);
    } catch (err) {
      log.error('thumbnail generation failed:', err?.message || err);
      res.status(500).json({ error: 'thumbnail generation failed' });
    }
  });

  // ── Session 40: accept a frame the RENDERER decoded ──────────────────────
  // The fallback that makes browser-native video work with no ffmpeg: the
  // renderer points a hidden <video> at the stream route, grabs a frame to a
  // canvas, and POSTs the JPEG here. 🚨 THIS WRITES TO DISK FROM THE LOOPBACK
  // SERVER, so the caller is not trusted and the route is narrowed in four
  // ways: the row must exist and be a video, the destination is contained
  // under the cache dir by mf.id (a bare UUID, UUID_RE), the body is capped,
  // and the bytes must START WITH A JPEG MAGIC NUMBER (acceptPoster) — else
  // this is a "write arbitrary content to a path ending .jpg" primitive the
  // GET would serve back with an image type. Written whole, in turn (F9).
  expressApp.post(`${P}/managed-files/:id/thumbnail`, async (req, res) => {
    const bundle = readRabbitBundle(req.params.projectId);
    if (!bundle) return rabbitNotFound(res);
    const mf = (bundle.managedFiles || []).find(f => f.id === req.params.id);
    if (!mf) return rabbitNotFound(res, 'managed-file');
    if (!isVideoExt(mf.extension)) {
      return res.status(415).json({ error: 'not a video', code: 'unsupported_type' });
    }
    if (!UUID_RE.test(String(mf.id))) {
      return res.status(400).json({ error: 'unsupported file id' });
    }
    const accepted = acceptPoster(req.body?.base64);
    if (!accepted.ok) return res.status(accepted.status).json({ error: accepted.error });
    const thumbPath = resolveContainedFilePath(getThumbCacheDir(), `${mf.id}.jpg`);
    if (!thumbPath) return res.status(400).json({ error: 'invalid thumbnail path' });
    try {
      await putPoster(thumbPath, accepted.buf);
    } catch (err) {
      log.error('thumbnail write failed:', err?.message || err);
      return res.status(500).json({ error: 'thumbnail write failed' });
    }
    res.json({ ok: true });
  });

  // An asset's poster: a cached 512px JPEG of its thumbnail_image.
  expressApp.get(`${P}/assets/:id/thumbnail`, async (req, res) => {
    if (!requireSameOrigin(req, res)) return;
    const bundle = readRabbitBundle(req.params.projectId);
    if (!bundle) return rabbitNotFound(res);
    const asset = (bundle.assets || []).find(a => a.id === req.params.id);
    if (!asset) return rabbitNotFound(res, 'asset');
    if (!asset.thumbnail_image) return res.status(404).json({ error: 'no thumbnail set' });
    // (review round 2, H2) the id is client-written (the assets POST spreads
    // req.body) and was joined raw onto the cache dir: contained now.
    const thumbPath = dataFileOrThrow(getThumbCacheDir(), `asset-${asset.id}`, '.jpg', 'asset');
    if (nodeFs.existsSync(thumbPath)) return sendMedia(res, thumbPath, POSTER);
    const srcPath = asset.thumbnail_image;
    if (!nodeFs.existsSync(srcPath)) return res.status(410).json({ error: 'source image missing' });
    // (review round 2, H2) thumbnail_image is an absolute path the bundle
    // carries — a copied folder's, or a drive-by POST's; only a picture
    // under a folder the person chose is opened and transcoded.
    if (!thumbnailSourceAllowed(bundle, req.params.projectId, srcPath)) return res.status(403).json({ error: 'source image is outside the folders this app may read' });
    try {
      await makePoster({ src: srcPath, dest: thumbPath, edge: 512, quality: 85, encode });
      sendMedia(res, thumbPath, POSTER);
    } catch (err) {
      log.error('asset thumbnail generation failed:', err?.message || err);
      res.status(500).json({ error: 'thumbnail generation failed' });
    }
  });

  // ── Generic entity posters (scene, shot, level, experience) ──
  for (const etype of ENTITY_KINDS) {
    const singular = etype.replace(/s$/, ''); // 'scene', 'shot', 'level', 'experience'
    expressApp.get(`${P}/${etype}/:id/thumbnail`, async (req, res) => {
      if (!requireSameOrigin(req, res)) return;
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      const entity = (bundle[etype] || []).find(e => e.id === req.params.id);
      if (!entity) return rabbitNotFound(res, singular);
      if (!entity.thumbnail_image) return res.status(404).json({ error: 'no thumbnail set' });
      const thumbPath = dataFileOrThrow(getThumbCacheDir(), `${singular}-${entity.id}`, '.jpg', singular); // (review 2, H2)
      if (nodeFs.existsSync(thumbPath)) return sendMedia(res, thumbPath, POSTER);
      const srcPath = entity.thumbnail_image;
      if (!nodeFs.existsSync(srcPath)) return res.status(410).json({ error: 'source image missing' });
      if (!thumbnailSourceAllowed(bundle, req.params.projectId, srcPath)) return res.status(403).json({ error: 'source image is outside the folders this app may read' }); // (review 2, H2)
      try {
        await makePoster({ src: srcPath, dest: thumbPath, edge: 512, quality: 85, encode });
        sendMedia(res, thumbPath, POSTER);
      } catch (err) {
        log.error(`${singular} thumbnail generation failed:`, err?.message || err);
        res.status(500).json({ error: 'thumbnail generation failed' });
      }
    });
  }
}

module.exports = {
  makePoster, putPoster, clearPoster, acceptPoster, encodePoster, writePosterAtomically,
  generateVideoThumbOnce, mountPosterRoutes,
  POSTER_MAX_BYTES, VIDEO_THUMB_FAIL_TTL_MS, UUID_RE,
};
