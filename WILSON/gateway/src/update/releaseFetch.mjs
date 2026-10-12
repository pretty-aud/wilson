// =============================================================================
// Fetching from the release channel (GW4, 2026-10-11; design §8 after GW4).
//
// The channel is GitHub Releases, and a release asset's URL redirects: the
// measured chain on 2026-10-11 was
//
//   github.com/<repo>/releases/latest/download/stable.json        302
//   github.com/<repo>/releases/download/<tag>/stable.json         302
//   release-assets.githubusercontent.com/github-production-…     200
//
// So the updater follows redirects, under four rules: HTTPS only (port 443,
// no credentials in a URL); at most MAX_REDIRECTS hops; EVERY hop's host,
// the first and the last included, exactly one of GitHub's on RELEASE_HOSTS
// (a redirect anywhere else is refused before anything is sent there); the
// body capped as it arrives. The design's "no redirects" is the reach probe's
// rule (§4, §10 row 16), not this one's.
//
// Node's own https, nothing else (the request-path rule: built-ins only). The
// `transport` option is for the tests alone (a resolver and a CA for a server
// on loopback); nothing in config.json or the environment reaches it.
// =============================================================================

import https from 'node:https';
import { VERSION } from '../version.mjs';

/** The hosts a release download may touch, exactly (GitHub's site and its two asset stores). */
export const RELEASE_HOSTS = Object.freeze(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
export const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class ReleaseFetchError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

/** Why a URL may not be fetched (a short code), or null when it may. */
export function hopRefusal(u) {
  if (u.protocol !== 'https:') return 'not_https';
  if (u.username || u.password) return 'credentials';
  if (u.port !== '') return 'port';
  if (!RELEASE_HOSTS.includes(u.hostname)) return 'host';
  return null;
}

function requestOnce(u, { timeoutMs, deadlineAt, transport, onResponse }) {
  return new Promise((resolve, reject) => {
    const left = deadlineAt - Date.now();
    if (!(left > 0)) { reject(new ReleaseFetchError('the download took longer than allowed', 'deadline')); return; }
    let timer = null;
    const settle = (fn) => (v) => { clearTimeout(timer); fn(v); };
    const req = https.request(u, {
      method: 'GET',
      headers: { 'user-agent': `wilson-gateway/${VERSION}`, accept: '*/*', 'accept-encoding': 'identity' },
      agent: false,
      ...(transport?.lookup ? { lookup: transport.lookup } : {}),
      ...(transport?.ca ? { ca: transport.ca } : {}),
      ...(transport?.port ? { port: transport.port } : {}),
      timeout: timeoutMs,
    }, (res) => { onResponse(res).then(settle(resolve), settle(reject)); });
    timer = setTimeout(() => req.destroy(new ReleaseFetchError('the download took longer than allowed', 'deadline')), left);
    req.on('timeout', () => req.destroy(new ReleaseFetchError(`${u.hostname}: no answer within ${Math.round(timeoutMs / 1000)} s`, 'timeout')));
    req.on('error', settle(reject));
    req.end();
  });
}

/**
 * GET `url`, following GitHub's redirects under the rules above.
 *
 * @param {string} url
 * @param {object} o
 * @param {number} o.maxBytes                 a longer body is refused (Content-Length first, then as it streams)
 * @param {number} [o.timeoutMs=30000]        per request: the longest silence (connect, headers, between chunks)
 * @param {number} [o.deadlineMs=1800000]     the whole fetch, every hop and the body, at most this long
 * @param {(chunk: Buffer) => any} [o.onChunk] streams the body to the caller (awaited per chunk), which then is not kept
 * @param {{ lookup?: Function, ca?: string, port?: number }} [o.transport]  tests only
 * @returns {Promise<{ body: Buffer|null, bytes: number, finalUrl: string, hops: string[] }>}
 */
export async function releaseFetch(url, { maxBytes, timeoutMs = 30_000, deadlineMs = 30 * 60_000, onChunk = null, transport = null } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new ReleaseFetchError('releaseFetch: maxBytes', 'usage');
  let u;
  try { u = new URL(url); } catch { throw new ReleaseFetchError('not a URL', 'url'); }
  const hops = [u.href];
  const deadlineAt = Date.now() + deadlineMs;
  for (let redirects = 0; ; redirects++) {
    const refused = hopRefusal(u);
    if (refused) throw new ReleaseFetchError(`refused ${u.hostname || u.protocol} (${refused})`, refused);
    const result = await requestOnce(u, {
      timeoutMs,
      deadlineAt,
      transport,
      onResponse: async (res) => {
        const status = res.statusCode;
        if (REDIRECT_STATUSES.has(status)) {
          res.resume();
          const loc = res.headers.location;
          if (typeof loc !== 'string' || !loc) throw new ReleaseFetchError(`${u.hostname}: a redirect without a Location`, 'location');
          let next;
          try { next = new URL(loc, u); } catch { throw new ReleaseFetchError(`${u.hostname}: a redirect to no URL`, 'location'); }
          return { redirect: next };
        }
        if (status !== 200) { res.resume(); throw new ReleaseFetchError(`${u.hostname}: ${status}`, 'status'); }
        const declared = Number(res.headers['content-length']);
        if (res.headers['content-length'] !== undefined && (!Number.isSafeInteger(declared) || declared > maxBytes)) {
          res.destroy();
          throw new ReleaseFetchError(`${u.hostname}: larger than ${maxBytes} bytes`, 'too_large');
        }
        const chunks = [];
        let n = 0;
        for await (const chunk of res) {
          n += chunk.length;
          if (n > maxBytes) { res.destroy(); throw new ReleaseFetchError(`${u.hostname}: larger than ${maxBytes} bytes`, 'too_large'); }
          if (onChunk) await onChunk(chunk); else chunks.push(chunk);
        }
        if (!res.complete) throw new ReleaseFetchError(`${u.hostname}: the answer was cut short`, 'truncated');
        return { body: onChunk ? null : Buffer.concat(chunks), bytes: n };
      },
    });
    if (!result.redirect) return { body: result.body, bytes: result.bytes, finalUrl: u.href, hops };
    if (redirects >= MAX_REDIRECTS) throw new ReleaseFetchError(`more than ${MAX_REDIRECTS} redirects`, 'redirects');
    u = result.redirect;
    hops.push(u.href);
  }
}

/**
 * The tag-specific URL a "latest" download resolved to, when GitHub's first
 * hop names it (github.com/<repo>/releases/download/<tag>/<asset>): the
 * signature is then fetched from the SAME release, never from whichever
 * release is latest a moment later.
 */
export function releaseAssetUrlOf(hops, repository, asset) {
  const prefix = `https://github.com/${repository}/releases/download/`;
  for (const h of hops) {
    if (!h.startsWith(prefix)) continue;
    const rest = h.slice(prefix.length);
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]{0,99})\/([A-Za-z0-9][A-Za-z0-9._-]{0,99})$/.exec(rest);
    if (m && m[2] === asset) return h;
  }
  return null;
}
