// =============================================================================
// fileReads.cjs — the Local Server's inline read of a project file (post-overhaul
// S4a): GET /api/rabbit/projects/:projectId/files/:id/stream, which gives a
// Local Server project an INLINE URL (localServerAdapter.fileUrl) so the Files
// explorer can preview it — an <img>, a <video> that seeks (Range, from
// sendFile), an <audio>, a text fetch, a PDF read into a typed blob — and the
// download route's `?download=1` attachment.
//
// Moved out of main.cjs by S4a's review round 1 (R1-TST-09) so both are SERVED
// in tests (src/lib/fileReads.test.js) instead of pinned by their source text:
// a gate that also admitted `same-site`, a misspelled header and a dropped
// bundle write each passed the source pins.
//
// The stream's rules are the managed-files stream route's, for its reasons:
//   · one 'downloaded' event per file per MINUTE (a <video> issues dozens of
//     Range requests; rabbitLogFileEvent evicts real history at 2000) — the
//     same throttle, namespaced `f:` so a file and a managed file never share
//     a window — and none for `?probe=1`, a machine read;
//   · the Content-Type is allowlisted media (safeMediaContentType) and
//     sniffing is off: this server is the renderer's own origin, and
//     `mime_type` is client-written;
//   · the completion callback, because a cancelled range is the normal shape
//     of playback.
// And the bins' gate (rabbitBins.cjs): same-origin only, failing closed — the
// page's own <img>, <video> and fetch carry `Sec-Fetch-Site: same-origin`; a
// page on another local origin (another port is `same-site`) cannot forge it.
//
// F9 (A5): the gate's rule and the sending live in mediaSend.cjs, one each for
// every route that answers with a file; isSameOriginRequest is re-exported
// here, the same function, for networkShare.cjs and main.cjs's share mount.
// =============================================================================

const { isSameOriginRequest, requireSameOrigin, sendMedia } = require('./mediaSend.cjs');

/**
 * The download route's `?download=1`: an ATTACHMENT under the file's own name,
 * what localServerAdapter.downloadUrl asks for, so an <a href> click saves the
 * file instead of navigating the window to it.
 */
function attachWhenAsked(req, res, fileName, contentDisposition) {
  if (req.query && req.query.download === '1') {
    res.setHeader('Content-Disposition', contentDisposition(fileName));
  }
}

function mountFileStreamRead(expressApp, deps) {
  const {
    fs, readRabbitBundle, rabbitNotFound, resolveContainedFilePath, resolveFileBaseDir,
    rabbitLogFileEvent, writeRabbitBundle, safeMediaContentType, shouldLogManagedRead,
    warn = (...args) => console.warn(...args),
  } = deps;
  expressApp.get('/api/rabbit/projects/:projectId/files/:id/stream', (req, res) => {
    if (!requireSameOrigin(req, res)) return;
    const bundle = readRabbitBundle(req.params.projectId);
    if (!bundle) return rabbitNotFound(res);
    const file = (bundle.files || []).find(f => f.id === req.params.id);
    if (!file) return rabbitNotFound(res, 'file');
    const diskPath = resolveContainedFilePath(
      resolveFileBaseDir(bundle, req.params.projectId, file), file.storage_path);
    if (!diskPath) return res.status(400).json({ error: 'invalid storage path' });
    if (!fs.existsSync(diskPath)) return res.status(410).json({ error: 'file body missing on disk' });
    const isProbe = req.query.probe === '1';
    if (!isProbe && shouldLogManagedRead(`f:${file.id}`)) {
      try {
        rabbitLogFileEvent(bundle, {
          file_id:          file.id,
          project_id:       req.params.projectId,
          file_name:        file.name,
          storage_provider: file.storage_provider,
          event:            'downloaded',
          old_path:         file.storage_path,
          size_bytes:       file.size_bytes ?? null,
        });
        // F3: an audit append, tried once (main.cjs's writer retries a held
        // file; a folder she can only read must not hold every stream 0.2 s).
        writeRabbitBundle(req.params.projectId, bundle, { touch: false, attempts: 1 });
      } catch (e) {
        warn('file read not logged:', e?.message || e);
      }
    }
    // sendMedia: the allowlisted type, nosniff, no-store (F9), Range, the
    // cancel-tolerant callback and `dotfiles: 'allow'` (review round 2,
    // R2-SEC-05: a demo folder's `.wilson\rabbit-data`). Containment was
    // decided above by resolveContainedFilePath.
    sendMedia(res, diskPath, { mime: safeMediaContentType(file.mime_type), failText: 'stream failed' });
  });
}

module.exports = { isSameOriginRequest, attachWhenAsked, mountFileStreamRead };
