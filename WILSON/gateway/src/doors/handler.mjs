// =============================================================================
// The routes of each door (Appendix C's "gateway's HTTP surface").
//
//   GET /v1/health   inside: { name, version, doors, reach, certificate }, the
//                    health line's data; outside: { ok: true } only, plus
//                    `nonce_echo` when the request carries the cloud's CURRENT
//                    reach nonce (header Wilson-Reach-Nonce; compared in
//                    constant time). Nothing else leaves the outside door
//                    (F5, R17).
//   GET /v1/path     inside: { gateway_id, path: 'inside', version };
//                    outside: 404 (R17)
//   GET|HEAD /v1/clips/{id}?t=…      both (clips.mjs)
//   POST /v1/clips/{id}/renew        both (clips.mjs)
//   GET /            inside: the status page (the health line and the
//                    fingerprint, nothing else); outside: 404
//   OPTIONS          the preflight, the web app's origins only (http.mjs)
//   anything else    404, no body
//
// The inside door, before any route: a proxy's header → 403 with no body
// (§4: every tunnel and reverse proxy adds one); a Host that is not one of
// the gateway's own names or addresses → 403 with no body (DNS rebinding,
// §10 row 6).
// =============================================================================

import { serveClip, renewClip } from './clips.mjs';
import { respond, corsHeaders, preflight, escapeHtml } from './http.mjs';
import { hasProxyHeader } from '../rules/peers.mjs';
import { constantTimeEqual } from '../wire/formats.mjs';
import { displayFingerprint } from '../certs/x509.mjs';
import { normalizeIp } from '../rules/ip.mjs';

const CLIP_RE = /^\/v1\/clips\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/renew)?$/;

/** The Host header names this gateway: one of its names or inside addresses, with or without the door's port. */
export function hostIsOurs(hostHeader, { names = [], addresses = [], port }) {
  if (typeof hostHeader !== 'string' || !hostHeader || hostHeader.length > 300) return false;
  let host = hostHeader.trim().toLowerCase();
  let p = null;
  const m = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(host);
  if (m) { host = m[1]; p = m[2] ?? null; }
  else if ((host.match(/:/g) || []).length === 1) { const i = host.lastIndexOf(':'); p = host.slice(i + 1); host = host.slice(0, i); }
  if (p !== null && Number(p) !== Number(port)) return false;
  if (names.map((n) => n.toLowerCase()).includes(host.replace(/\.$/, ''))) return true;
  const ip = normalizeIp(host);
  return !!ip && addresses.some((a) => normalizeIp(a) === ip);
}

const TONE_STYLE = { plain: '', bold: 'font-weight:600', amber: 'color:#9a5b00', red: 'color:#b3261e;font-weight:600' };

export function statusPage({ line, fingerprint }) {
  const seg = (s) => `<span style="${TONE_STYLE[s.tone] || ''}">${escapeHtml(s.text)}</span>`;
  const warnings = (line.warnings || []).map((w) => `<li>${seg(w)}</li>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>WILSON file gateway</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:24px;color:#1d1d1f;background:#fff;max-width:960px}p{margin:0 0 12px}ul{padding-left:18px}code{font:13px ui-monospace,monospace;word-break:break-all}small{color:#555}</style>
</head><body>
<p>${line.segments.map(seg).join('')}</p>
${warnings ? `<ul>${warnings}</ul>` : ''}
<p>Certificate fingerprint (SHA-256): <code>${escapeHtml(fingerprint ? displayFingerprint(fingerprint) : 'not made yet')}</code></p>
<p><small>Compare this fingerprint with the one the installer or the container’s log printed, and confirm it in WILSON (Settings, Storage, File gateway) before installing the certificate. The certificate only vouches for this gateway’s names and the addresses around it (name constraints): Windows, macOS and Firefox enforce that limit; Chrome on Linux has not always enforced it for a root you install yourself, so on Linux install it only on computers you control.</small></p>
</body></html>
`;
}

/**
 * @param {'inside'|'outside'} door
 * @param ctx the runtime's view: ids(), origins(), host(), health(), healthLine(), fingerprint(), reachNonce(), and the clip context
 */
export function makeHandler(ctx, door) {
  return async function handle(req, res) {
    try {
      if (door === 'inside') {
        if (hasProxyHeader(req.headers)) { ctx.log('proxy_header_refused', { door, peer: req.socket.remoteAddress }); respond(req, res, 403); return; }
        if (!hostIsOurs(req.headers.host, ctx.host())) { ctx.log('host_refused', { door }); respond(req, res, 403); return; }
      }
      const url = String(req.url || '/');
      const pathname = url.split('?')[0];
      const cors = corsHeaders(req, ctx.origins());

      if (req.method === 'OPTIONS') { preflight(req, res, { door, origins: ctx.origins() }); return; }

      const clip = CLIP_RE.exec(pathname);
      if (clip) {
        const [, clipId, renew] = clip;
        if (renew && req.method === 'POST') return await renewClip(ctx, req, res, { door, clipId, extraHeaders: cors });
        if (!renew && (req.method === 'GET' || req.method === 'HEAD')) return await serveClip(ctx, req, res, { door, clipId, extraHeaders: cors });
        respond(req, res, 404, { headers: cors });
        return;
      }

      if (pathname === '/v1/health' && (req.method === 'GET' || req.method === 'HEAD')) {
        if (door === 'outside') {
          const asked = req.headers['wilson-reach-nonce'];
          const current = ctx.reachNonce();
          const body = { ok: true };
          if (typeof asked === 'string' && current && constantTimeEqual(asked, current)) body.nonce_echo = current;
          respond(req, res, 200, { headers: cors, body: JSON.stringify(body), type: 'application/json' });
          return;
        }
        respond(req, res, 200, { headers: cors, body: JSON.stringify(ctx.health()), type: 'application/json' });
        return;
      }

      if (door === 'inside' && pathname === '/v1/path' && (req.method === 'GET' || req.method === 'HEAD')) {
        const { gatewayId } = ctx.ids();
        respond(req, res, 200, { headers: cors, body: JSON.stringify({ gateway_id: gatewayId, path: 'inside', version: ctx.version }), type: 'application/json' });
        return;
      }

      if (door === 'inside' && pathname === '/' && (req.method === 'GET' || req.method === 'HEAD')) {
        respond(req, res, 200, {
          headers: { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" },
          body: statusPage({ line: ctx.healthLine(), fingerprint: ctx.fingerprint() }),
          type: 'text/html; charset=utf-8',
        });
        return;
      }

      respond(req, res, 404, { headers: cors });
    } catch (e) {
      ctx.log('handler_error', { door, message: String(e?.message || e).slice(0, 200) });
      if (!res.headersSent) respond(req, res, 500); else res.destroy();
    }
  };
}
