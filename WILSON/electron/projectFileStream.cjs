// =============================================================================
// projectFileStream.cjs — a project file's body STREAMED to disk (demo
// 2026-09-11).
//
// Audrey, 2026-09-11, adding a file to a project on the Local Server backend:
// "[localServer] HTTP 413". The Local Server upload path since S12 read the
// File into memory, base64-encoded it and POSTed it inside JSON, so the
// server's global `express.json({ limit: '50mb' })` capped a project file at
// roughly 37 MB and answered 413 for anything larger — a single clip.
//
// This route is the same upload with a different transport:
//
//   PUT /api/rabbit/projects/:projectId/files-stream
//       ?name=<file name>&mimeType=<type>&sizeBytes=<n>&scope=<json>
//       body: the bytes, application/octet-stream
//
// The renderer hands `fetch` (or XHR, for progress) the File object itself,
// so Chromium reads it from disk in chunks; here it is piped straight to a
// temp file beside its final path and renamed on finish. Nothing is buffered
// on either side, and the global JSON parser never sees an octet-stream body.
//
// It records EXACTLY what the base64 POST records — the same row shape, the
// same directory choice (INVOICES for a financial scope, the project's
// files dir otherwise), the same 'uploaded' file event — so every reader of
// bundle.files is unchanged. The POST stays for anything that still calls
// it. Every host dependency is injected (the helpers are closures inside
// main.cjs's startLocalServer); projectFileStream.test.js drives it through
// a real express app on a temp root.
// =============================================================================
'use strict';

const fs = require('fs');
const path = require('path');

const ROUTE = '/api/rabbit/projects/:projectId/files-stream';

function parseScope(raw) {
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function parseSize(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

// Demo 2026-09-11: the file's own facts (storage/mediaMetadata.js) — a
// duration in seconds and the source's modified time — accepted only in the
// shapes the renderer sends; anything else is null, never an error.
function parseDuration(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : null;
}
function parseIsoDate(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function mountProjectFileStream(expressApp, {
  readRabbitBundle,
  writeRabbitBundle,
  rabbitTouch,
  rabbitLogFileEvent,
  rabbitNotFound,
  resolveProjectFilesDir,
  resolveProjectInvoicesDir,
  uuidv4,
  log = () => {},
} = {}) {
  for (const [name, fn] of Object.entries({
    readRabbitBundle, writeRabbitBundle, rabbitTouch, rabbitLogFileEvent, rabbitNotFound,
    resolveProjectFilesDir, resolveProjectInvoicesDir, uuidv4,
  })) {
    if (typeof fn !== 'function') throw new Error(`mountProjectFileStream: ${name} is required`);
  }

  expressApp.put(ROUTE, (req, res) => {
    const bundle = readRabbitBundle(req.params.projectId);
    if (!bundle) return rabbitNotFound(res);
    const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
    if (!name) return res.status(400).json({ error: 'name required' });
    const mimeType = typeof req.query.mimeType === 'string' && req.query.mimeType ? req.query.mimeType : null;
    const sizeBytes = parseSize(req.query.sizeBytes);
    const scope = parseScope(req.query.scope);
    const durationSec = parseDuration(req.query.durationSec);
    const sourceModifiedAt = parseIsoDate(req.query.sourceModifiedAt);

    const fileId = uuidv4();
    // The same sanitiser the POST uses: stored_name is joined under the
    // project root, and a name with a separator in it would walk out of it.
    const safeName = name.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const diskName = `${fileId}-${safeName}`;
    const isFinancial = !!scope.financial;
    let filesDir;
    try {
      filesDir = isFinancial
        ? resolveProjectInvoicesDir(bundle, req.params.projectId)
        : resolveProjectFilesDir(bundle, req.params.projectId);
      if (!filesDir) throw new Error('no files directory');
      if (!fs.existsSync(filesDir)) fs.mkdirSync(filesDir, { recursive: true });
    } catch (err) {
      return res.status(500).json({ error: `files directory unavailable: ${err.message}` });
    }
    const finalPath = path.join(filesDir, diskName);
    const tmpPath = `${finalPath}.part-${process.pid}-${Date.now()}`;

    let done = false;
    const fail = (status, message) => {
      if (done) return;
      done = true;
      try { fs.unlinkSync(tmpPath); } catch { /* never written, or already gone */ }
      if (!res.headersSent) res.status(status).json({ error: message });
    };

    let out;
    try {
      out = fs.createWriteStream(tmpPath, { flags: 'wx' });
    } catch (err) {
      return fail(500, `upload failed: ${err.message}`);
    }
    out.on('error', (err) => fail(500, `upload failed: ${err.message}`));
    req.on('aborted', () => { out.destroy(); fail(499, 'upload aborted'); });
    req.on('error', (err) => { out.destroy(); fail(500, `upload failed: ${err.message}`); });
    out.on('finish', () => {
      if (done) return;
      done = true;
      let written;
      try {
        fs.renameSync(tmpPath, finalPath);
        written = fs.statSync(finalPath).size;
      } catch (err) {
        try { fs.unlinkSync(tmpPath); } catch { /* already gone */ }
        if (!res.headersSent) res.status(500).json({ error: `upload failed: ${err.message}` });
        return;
      }
      // The row, field for field the one the base64 POST writes.
      const fresh = readRabbitBundle(req.params.projectId) || bundle;
      if (!fresh.files) fresh.files = [];
      const row = rabbitTouch({
        id:               fileId,
        project_id:       req.params.projectId,
        phase_id:         scope.phaseId || null,
        asset_id:         scope.assetId || null,
        task_id:          scope.taskId  || null,
        name,
        mime_type:        mimeType,
        size_bytes:       sizeBytes ?? written,
        storage_provider: 'local_server',
        storage_path:     diskName,
        kind:             scope.kind || 'source',
        is_core_definer:  !!scope.isCoreDefiner,
        is_financial:     isFinancial,
        uploaded_at:      new Date().toISOString(),
        // 0081's two columns, mirrored on the local row (demo 2026-09-11).
        duration_sec:       durationSec,
        source_modified_at: sourceModifiedAt,
      });
      fresh.files.push(row);
      rabbitLogFileEvent(fresh, {
        file_id:          row.id,
        project_id:       req.params.projectId,
        file_name:        row.name,
        storage_provider: row.storage_provider,
        event:            'uploaded',
        new_path:         row.storage_path,
        size_bytes:       row.size_bytes ?? null,
      });
      writeRabbitBundle(req.params.projectId, fresh);
      log(`[files-stream] ${req.params.projectId}: ${diskName} (${written} bytes)`);
      res.json(row);
    });
    req.pipe(out);
  });
}

module.exports = { mountProjectFileStream, parseScope, parseSize, parseDuration, parseIsoDate, ROUTE };
