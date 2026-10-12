// =============================================================================
// What every response carries (design §5 step 6), CORS (the web app's origins
// only; F19: CORS protects no byte here, the ticket does, it only keeps other
// origins' scripts from reading /v1/path and the renew answer), and the body
// cap (8 KB; only renew has a body).
//
// Every response: Cache-Control: no-store, Pragma: no-cache,
// X-Content-Type-Options: nosniff, Cross-Origin-Resource-Policy: cross-origin,
// Referrer-Policy: no-referrer, Strict-Transport-Security: max-age=31536000
// (effective on the outside door's name only: browsers keep no HSTS for an
// address literal, F18). No ETag, no Last-Modified, no Date, no Server.
// =============================================================================

export const BASE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'Pragma': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000',
});

export const EXPOSED_HEADERS = 'Content-Range, Content-Length, Accept-Ranges, Wilson-Gateway-Path';

/** Sets the base headers (and any given), writes the status and the body (none for HEAD), ends. */
export function respond(req, res, status, { headers = {}, body = null, type = null } = {}) {
  if (res.headersSent || res.writableEnded) { res.destroy(); return; }
  res.sendDate = false;
  for (const [k, v] of Object.entries(BASE_HEADERS)) res.setHeader(k, v);
  for (const [k, v] of Object.entries(headers)) if (v !== undefined && v !== null) res.setHeader(k, v);
  const buf = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  if (buf) res.setHeader('Content-Type', type || 'text/plain; charset=utf-8');
  res.setHeader('Content-Length', buf ? buf.length : 0);
  res.writeHead(status);
  res.end(req.method === 'HEAD' || !buf ? undefined : buf);
}

/** The CORS headers for a request whose Origin is one of the web app's; none otherwise. */
export function corsHeaders(req, origins) {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || !origins || !origins.includes(origin)) return {};
  return { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Expose-Headers': EXPOSED_HEADERS };
}

/**
 * The preflight: the web app's origins only, GET/HEAD/POST, the Range and
 * Content-Type headers; `Access-Control-Allow-Private-Network: true` on the
 * inside door only (Chrome's older Private Network Access preflight; Chrome
 * 142's Local Network Access asks the person instead, and the header is then
 * inert). The outside door never says it is on a private network (R17).
 */
export function preflight(req, res, { door, origins }) {
  const origin = req.headers.origin;
  const method = String(req.headers['access-control-request-method'] || '').toUpperCase();
  const asked = String(req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  const okHeaders = asked.every((h) => h === 'range' || h === 'content-type');
  if (typeof origin !== 'string' || !origins?.includes(origin) || !['GET', 'HEAD', 'POST'].includes(method) || !okHeaders) {
    respond(req, res, 403);
    return;
  }
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Max-Age': '600',
  };
  if (door === 'inside' && String(req.headers['access-control-request-private-network']).toLowerCase() === 'true') {
    headers['Access-Control-Allow-Private-Network'] = 'true';
  }
  respond(req, res, 204, { headers });
}

/**
 * The request body, at most `max` bytes; null when it is longer (the caller
 * answers 413). An over-long body of up to DRAIN_MAX bytes is read to its end
 * and dropped first, so the client has finished writing when the 413 comes
 * (otherwise it may see a reset instead of the answer); a longer one is not
 * read at all and the connection closes with the answer.
 */
export const DRAIN_MAX = 64 * 1024;
export function readBody(req, max) {
  return new Promise((resolve) => {
    const declared = Number(req.headers['content-length']);
    const chunks = [];
    let n = 0;
    let over = Number.isFinite(declared) && declared > max;
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    if (over && declared > DRAIN_MAX) { finish(null); return; }
    req.on('data', (c) => {
      n += c.length;
      if (n > DRAIN_MAX) { finish(null); req.destroy(); return; }
      if (n > max) over = true;
      if (!over) chunks.push(c);
    });
    req.on('end', () => finish(over ? null : Buffer.concat(chunks)));
    req.on('error', () => finish(null));
  });
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
