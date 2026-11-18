// =============================================================================
// mediaSend.cjs — the one way the Local Server sends a file's bytes (F9; the
// desktop-build review's A5; OUTSTANDING F3-01 and S4a-06; TPN-CONT-003).
//
// "Send this file's bytes safely" was written at every route that answers with
// a file — the files download and stream, the managed-file stream and
// thumbnail, the asset and entity thumbnails, the bins' posters and streams, a
// private project's media, a file on the office server — and the copies had
// drifted: `no-store` reached the bins' two streams only, the same-origin gate
// four routes of nine, and `dotfiles: 'allow'` seven sends of twenty-two, so a
// cached thumbnail under a demo folder's `.wilson\rabbit-data` answered 500
// (F3-01, measured: `send` refuses an absolute path through a dot-folder and
// localServerErrorHandler answers "internal error").
//
// sendMedia carries the whole of it, once:
//   · the Content-Type through the media allowlist (safeMediaContentType):
//     this server is the renderer's own origin, and a type a client wrote
//     (`mime_type` on a row) would otherwise run as script here;
//   · `X-Content-Type-Options: nosniff`;
//   · `Cache-Control: no-store` and `Pragma: no-cache` (TPN-CONT-003 and
//     TPN-CONT-019: footage and its previews never land in the window's HTTP
//     cache), but for a stream with a named reason (`cache: 'revalidate'`);
//   · `dotfiles: 'allow'`: containment is the caller's, decided before this
//     is called, and a demo folder or a worktree sits under a dot-folder;
//   · Range (`acceptRanges`, so a <video> seeks: 206, If-Range) and the
//     cancel-tolerant callback, because a <video> aborts a range request on
//     every seek and an aborted send is the normal case, not a fault.
//
// The gate is NOT inside sendMedia: a route that reads the bundle or appends
// a 'downloaded' event before it sends must refuse first, so a refused request
// writes nothing. `requireSameOrigin(req, res)` is that route's first line.
//
// A leaf: no other electron module is required here, so any route module may
// require it (fileReads.cjs and localMedia.cjs re-export what moved here).
// =============================================================================
'use strict';

const path = require('node:path');

/** True only for the renderer's own requests (failing closed). Moved from
 *  fileReads.cjs, which re-exports it. The page's own <img>, <video> and
 *  fetch carry `Sec-Fetch-Site: same-origin`; a page on another local origin
 *  (another port is `same-site`) cannot forge it, and a request with neither
 *  header passes only on an Origin naming this very host. */
function isSameOriginRequest(req) {
  const site = req.headers['sec-fetch-site'];
  if (site) return site === 'same-origin';
  const origin = req.headers.origin;
  const host = req.headers.host;
  return !!origin && !!host && (origin === `http://${host}` || origin === `https://${host}`);
}

/** A media route's first line: true for the renderer's own request; anything
 *  else is answered 403 here (fileReads.cjs's body) and false comes back. */
function requireSameOrigin(req, res) {
  if (isSameOriginRequest(req)) return true;
  res.status(403).json({ error: 'file streams answer WILSON only', code: 'cross_origin' });
  return false;
}

// 🚨 Session 40: never echo a client-supplied Content-Type from a route this
// app's own renderer shares an origin with. `mime_type` is written verbatim
// from req.body, and text/html served from 127.0.0.1:<port> executes as script
// on WILSON's origin. Only obvious media passes; everything else becomes an
// opaque download, which a <video> ignores and a browser cannot run. (Moved
// here from main.cjs by F9; main requires it from here for its injections.)
const SAFE_MEDIA_TYPE_RE = /^(video|audio|image)\/[a-z0-9][a-z0-9.+-]*$/;
function safeMediaContentType(mime) {
  const m = String(mime || '').trim().toLowerCase();
  // image/svg+xml is scriptable in its own right, so it is excluded even though
  // it matches the media shape.
  if (m === 'image/svg+xml') return 'application/octet-stream';
  return SAFE_MEDIA_TYPE_RE.test(m) ? m : 'application/octet-stream';
}

/** attachment; filename="<ascii>"; filename*=UTF-8''<utf8> — both forms, so
 *  the browser's own download manager gets the real name whatever it reads.
 *  (Moved here from localMedia.cjs, which re-exports it.) */
function contentDisposition(name) {
  const clean = String(name || 'download').replace(/[\r\n"\\/]/g, '_').slice(0, 200) || 'download';
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

const NO_STORE = 'no-store';
// `send`'s own `Cache-Control: public, max-age=0`, kept for one family only:
// the bins' and cloud bins' posters. Not a measured need — their route test
// (rabbitBins.routes.test.js, the control beside the stream's no-store) pins
// that a poster is NOT no-store, and the bins' tests stay unedited this
// session (OUTSTANDING F9-01 carries it to the session that owns them).
const REVALIDATE = 'revalidate';

/**
 * Send the file at `diskPath` (already contained by the caller) as media.
 * @param {object} res  Express's response
 * @param {string} diskPath  absolute, or resolved against the process's cwd
 * @param {object} [opts]
 * @param {string} [opts.mime]  the row's type or the extension's; always
 *   passed through safeMediaContentType here
 * @param {string} [opts.attachmentName]  set: an attachment under this name
 * @param {'no-store'|'revalidate'} [opts.cache]  'no-store' unless named
 * @param {string|null} [opts.failText]  the JSON `error` of a failed read
 *   (`null`: an empty body, the office-server route's answer)
 */
function sendMedia(res, diskPath, { mime = null, attachmentName = null, cache = NO_STORE, failText = 'could not read the file' } = {}) {
  if (cache !== NO_STORE && cache !== REVALIDATE) throw new Error(`sendMedia: unknown cache rule ${cache}`);
  res.setHeader('Content-Type', safeMediaContentType(mime));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (attachmentName) res.setHeader('Content-Disposition', contentDisposition(attachmentName));
  const revalidate = cache === REVALIDATE;
  if (!revalidate) {
    // `cacheControl: false` below only keeps send from writing its own
    // header; one set here survives (send sets one only when none is set).
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
  }
  res.sendFile(path.resolve(String(diskPath)), { acceptRanges: true, dotfiles: 'allow', cacheControl: revalidate }, (err) => {
    if (!err) return;
    // A cancelled range request is the normal shape of video playback.
    if (res.headersSent) {
      // A read that failed mid-body (a network share that dropped): end it,
      // or the window waits for ever — the server sets no request timeout
      // (F9 review rounds 1 and 2; the error handler ended these before).
      // Whatever the code: a read error can carry ECONNABORTED too, and for
      // a client that really left, destroying its closed socket does nothing.
      if (!res.writableEnded) res.destroy();
      return;
    }
    if (res.writableEnded || res.destroyed) return;
    // The answer is an error, not the file: none of the file's own headers.
    for (const h of ['Content-Disposition', 'ETag', 'Last-Modified', 'Accept-Ranges']) res.removeHeader(h);
    res.status(err.status || err.statusCode || 500);
    if (failText === null) {
      res.removeHeader('Content-Type');
      res.end();
    } else {
      res.type('application/json').json({ error: failText });
    }
  });
}

module.exports = {
  isSameOriginRequest, requireSameOrigin, safeMediaContentType, contentDisposition, sendMedia,
  SAFE_MEDIA_TYPE_RE, NO_STORE, REVALIDATE,
};
