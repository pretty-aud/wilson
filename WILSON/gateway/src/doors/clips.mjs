// =============================================================================
// GET/HEAD /v1/clips/{bin_file_id}?t=<ticket> and POST …/renew (design §5
// steps 6–7; Appendix C). The checks, in this order, and one answer per kind
// of failure (no body, no difference in words; §10 row 19):
//
//   401  any ticket failure: shape, signature (an unknown kid gets ONE extra
//        sync first), the URL's id is not the ticket's clip, the dates, this
//        gateway and workspace, on the outside door rv; and every renewal
//        failure
//   429  the person's requests a minute, concurrent streams, the global pool,
//        the outside bytes budget (with Retry-After)
//   404  any clip failure: an unknown location, a location known down, the
//        path's shape, the join leaving the root, the catalogue check (on the
//        inside door with the cloud unreachable and the clip never confirmed,
//        404 with the one sentence), realpath leaving the root, a sequence
//        without one, not a file
//   415  the type: the resolved on-disk extension not allow-listed, the
//        sequence's frame not an allow-listed still, mt disagreeing
//   416  the range
//
// GW2's order differs from the design's text in one place, on purpose: the
// catalogue check runs BEFORE any disk access (realpath, readdir, stat), so a
// forged ticket for an uncatalogued path learns nothing about the share, not
// even by timing (dated line in the design's review history).
//
// And one bound the design's D5 needs and does not spell out: a response
// still streaming when its stream's authority runs out (no renewal: the
// viewer was removed, the switch went off) is cut, checked every 5 s, so one
// long open-ended response cannot outlive a revocation.
// =============================================================================

import fs from 'node:fs';
import { pipeline, Transform } from 'node:stream';
import { authenticateTicket, checkTicketScope } from '../wire/ticket.mjs';
import { JTI_RE } from '../wire/formats.mjs';
import { joinUnderRoot, isStrictlyUnder, rootPathModule } from '../rules/paths.mjs';
import { detectSequence } from '../rules/sequence.mjs';
import { mediaTypeForPath, isAllowedStill, mtAgrees } from '../rules/media.mjs';
import { planRange, contentRange } from '../rules/range.mjs';
import { NEVER_CONFIRMED_SENTENCE } from '../cloud/catalogue.mjs';
import { respond, readBody, BASE_HEADERS } from './http.mjs';

export const FS_TIMEOUT_MS = 5_000;
const LIVE_CHECK_MS = 5_000;
const DOWN = new Set(['not_reachable', 'not_mounted', 'not_connected']);

export function withTimeout(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })), ms); })]).finally(() => clearTimeout(timer));
}

// Failed tickets on one connection (review round 1, finding 2; round 2,
// R2-5): at the limit the answer says "Connection: close" and Node ends the
// connection after it, pipelined requests and all, so every further try costs
// a new connection, which the door's per-peer caps count. Nobody else behind
// the same address pays for it.
const FAILED = Symbol('wilsonFailedTickets');
function failedOnConnection(req, ctx) {
  const socket = req.socket;
  socket[FAILED] = (socket[FAILED] || 0) + 1;
  return socket[FAILED] >= ctx.limits.authFailuresPerConnection;
}

async function authenticate(ctx, ticket) {
  let a = authenticateTicket(ticket, { keyFor: ctx.keyFor });
  if (!a.ok && a.reason === 'unknown_kid') {
    await ctx.syncForUnknownKid();
    a = authenticateTicket(ticket, { keyFor: ctx.keyFor });
  }
  return a;
}

function ticketFromUrl(url) {
  const q = new URLSearchParams(url.slice(url.indexOf('?') + 1));
  const all = url.includes('?') ? q.getAll('t') : [];
  return all.length === 1 ? all[0] : null;
}

/**
 * @param ctx the runtime's view (see runtime.mjs: clipContext)
 */
export async function serveClip(ctx, req, res, { door, clipId, extraHeaders = {} }) {
  const head = req.method === 'HEAD';
  const pathHeader = { 'Wilson-Gateway-Path': door };
  const source = ctx.sourceOf(req, door);
  const deny = (status, reason, more = {}) => {
    const closing = status === 401 && failedOnConnection(req, ctx);
    ctx.log('clip_refused', { door, status, reason, ...(closing ? { closing: true } : {}) });
    const headers = { ...extraHeaders, ...(door === 'inside' ? pathHeader : {}), ...(more.headers || {}), ...(closing ? { Connection: 'close' } : {}) };
    respond(req, res, status, { headers, body: more.body ?? null });
  };

  const ticket = ticketFromUrl(req.url);
  if (!ticket) return deny(401, 'no_ticket');
  const auth = await authenticate(ctx, ticket);
  if (!auth.ok) return deny(401, auth.reason);
  const claims = auth.claims;
  if (claims.clip !== clipId) return deny(401, 'clip_mismatch');

  const existing = ctx.streams.get(door, claims.jti);
  if (existing && (existing.clip !== clipId || existing.sub !== claims.sub)) return deny(401, 'stream_mismatch');
  const authority = existing ? existing.authority : claims;
  const { gatewayId, workspaceId } = ctx.ids();
  const scope = checkTicketScope(authority, { nowS: Math.floor(ctx.now() / 1000), gatewayId, workspaceId });
  if (!scope.ok) return deny(401, scope.reason);
  if (door === 'outside' && authority.rv !== true) return deny(401, 'rv');

  const rate = ctx.perPersonRequests.hit(authority.sub);
  if (!rate.ok) return deny(429, 'requests', { headers: { 'Retry-After': String(rate.retryAfterS) } });

  // The clip: by the authority's location and path only.
  const loc = ctx.location(authority.loc);
  if (!loc || !loc.root) return deny(404, 'unknown_location');
  if (DOWN.has(loc.state)) return deny(404, `location_${loc.state}`);
  const joined = joinUnderRoot(loc.root, authority.path);
  if (!joined) return deny(404, 'path');
  const cat = await ctx.catalogue.check({ clip: clipId, loc: authority.loc, path: authority.path, door });
  if (!cat.ok) {
    if (door === 'inside' && cat.reason === 'cloud_unreachable') return deny(404, 'never_confirmed', { body: NEVER_CONFIRMED_SENTENCE });
    return deny(404, cat.reason);
  }

  // The disk, through the share: as few round trips as the checks allow (each
  // open costs a trip through the SMB redirector, about a millisecond): the
  // root's realpath is kept per location (refreshed every ten seconds), the
  // clip's realpath is taken and contained, the type is read from that
  // resolved name before anything is opened, then ONE open: fstat and the
  // bytes come from the same handle.
  let target;
  let size;
  let fh = null;
  const closeHandle = () => { if (fh) { const h = fh; fh = null; h.close().catch(() => {}); } };
  try {
    const realRoot = await withTimeout(ctx.realRoot(authority.loc, loc.root), FS_TIMEOUT_MS);
    if (!realRoot) return deny(404, 'root');
    const resolved = await withTimeout(ctx.fs.realpath(joined), FS_TIMEOUT_MS).catch((e) => { if (e?.code === 'ETIMEDOUT') throw e; return null; });
    if (!resolved || !isStrictlyUnder(realRoot, resolved)) return deny(404, 'contained');
    target = resolved;
    if (authority.seq) {
      const mod = rootPathModule(loc.root);
      const seq = await withTimeout(detectSequence(resolved, { readdir: ctx.fs.readdir, join: mod.join }), FS_TIMEOUT_MS);
      if (!seq) return deny(404, 'not_a_sequence');
      const frame = await withTimeout(ctx.fs.realpath(seq.middle_frame_path), FS_TIMEOUT_MS).catch((e) => { if (e?.code === 'ETIMEDOUT') throw e; return null; });
      if (!frame || !isStrictlyUnder(realRoot, frame)) return deny(404, 'frame_contained');
      if (!isAllowedStill(frame)) return deny(415, 'frame_type');
      target = frame;
    }
    const type0 = mediaTypeForPath(target);
    if (!type0 || !mtAgrees(authority.mt, type0)) {
      // A refused type is a 415 only for a FILE; anything else is not a clip (404).
      // The extra trip through the share is paid by refusals only.
      const st = await withTimeout(ctx.fs.stat(target), FS_TIMEOUT_MS).catch(() => null);
      if (!st || !st.isFile()) return deny(404, 'not_a_file');
      return deny(415, type0 ? 'mt' : 'type');
    }
    fh = await withTimeout(ctx.fs.open(target), FS_TIMEOUT_MS).catch((e) => { if (e?.code === 'ETIMEDOUT') throw e; return null; });
    if (!fh) return deny(404, 'open');
    const st = await withTimeout(fh.stat(), FS_TIMEOUT_MS);
    if (!st.isFile()) { closeHandle(); return deny(404, 'not_a_file'); }
    size = st.size;
  } catch (e) {
    closeHandle();
    if (e?.code === 'ETIMEDOUT') ctx.locationSlow(authority.loc);
    return deny(404, e?.code === 'ETIMEDOUT' ? 'timeout' : 'stat');
  }

  const type = mediaTypeForPath(target);
  const plan = planRange(req.headers.range, size);
  if (plan.status === 416) { closeHandle(); return deny(416, plan.reason, { headers: { 'Content-Range': contentRange(plan, size), ...pathHeader } }); }

  // From here the request is served: the stream is opened (a ticket's first use) and its source recorded.
  const stream = ctx.streams.open(door, claims);
  const shared = ctx.streams.addSource(stream, source.address);
  if (door === 'inside') ctx.relayWatch(req.socket.remoteAddress, authority.sub);

  const headers = {
    ...extraHeaders,
    ...pathHeader,
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    ...(plan.status === 206 ? { 'Content-Range': contentRange(plan, size) } : {}),
  };
  if (head) {
    closeHandle();
    res.sendDate = false;
    for (const [k, v] of Object.entries(BASE_HEADERS)) res.setHeader(k, v);
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.setHeader('Content-Length', plan.length);
    res.writeHead(plan.status);
    res.end();
    return undefined;
  }

  const release = ctx.perPersonStreams.acquire(authority.sub);
  if (!release) { closeHandle(); return deny(429, 'streams', { headers: { 'Retry-After': '5' } }); }
  if (!ctx.pools.openStream(door)) { release(); closeHandle(); return deny(429, 'pool', { headers: { 'Retry-After': '5' } }); }
  if (door === 'outside' && ctx.outsideBytes.remaining(authority.sub) <= 0) {
    release(); ctx.pools.closeStream(door); closeHandle();
    return deny(429, 'bytes_budget', { headers: { 'Retry-After': String(ctx.outsideBytes.retryAfterS(authority.sub)) } });
  }
  const viewing = door === 'outside'
    ? ctx.viewings.begin({ sub: authority.sub, clip: clipId, jti: stream.jti, clipBytes: size, source: source.address, via: source.via, userAgent: ctx.userAgent(req), shared })
    : null;

  res.sendDate = false;
  for (const [k, v] of Object.entries(BASE_HEADERS)) res.setHeader(k, v);
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.setHeader('Content-Length', plan.length);
  res.writeHead(plan.status);
  if (plan.length === 0) {
    res.end();
    release(); ctx.pools.closeStream(door); closeHandle();
    return undefined;
  }

  let sent = 0;
  let finished = false;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      sent += chunk.length;
      if (door === 'outside' && ctx.outsideBytes.spend(authority.sub, chunk.length)) {
        cb(Object.assign(new Error('bytes budget'), { code: 'EBUDGET' }));
        return;
      }
      cb(null, chunk);
    },
  });
  const live = setInterval(() => { if (!ctx.streams.isLive(stream)) res.destroy(); }, ctx.liveCheckMs || LIVE_CHECK_MS);
  live.unref?.();
  const done = () => {
    if (finished) return;
    finished = true;
    clearInterval(live);
    release();
    ctx.pools.closeStream(door);
    if (viewing) ctx.viewings.served(viewing, { start: plan.start, bytes: sent });
    ctx.log('clip_served', { door, status: plan.status, jti: stream.jti, bytes: sent, peer: source.address, via: source.via });
  };
  // The bytes from the handle that was checked (autoClose: the stream closes it).
  const reader = fh.createReadStream({ start: plan.start, end: plan.end, highWaterMark: 256 * 1024, autoClose: true });
  fh = null;
  pipeline(reader, counter, res, () => done());
  res.once('close', done);
  return undefined;
}

/**
 * POST /v1/clips/{id}/renew with { "jti": "<the stream's first jti>", "t": "<the fresh ticket>" }
 * → 204, or 401 for every failure (the wire); 413 when the body is over 8 KB.
 */
export async function renewClip(ctx, req, res, { door, clipId, extraHeaders = {} }) {
  const deny = (status, reason, headers = {}) => {
    const closing = status === 401 && failedOnConnection(req, ctx);
    ctx.log('renew_refused', { door, status, reason, ...(closing ? { closing: true } : {}) });
    respond(req, res, status, { headers: { ...extraHeaders, ...headers, ...(closing ? { Connection: 'close' } : {}) } });
  };
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const body = await readBody(req, ctx.limits.bodyBytes);
  if (body === null) return deny(413, 'body_too_large');
  if (type !== 'application/json') return deny(401, 'content_type');
  let msg;
  try { msg = JSON.parse(body.toString('utf8')); } catch { return deny(401, 'json'); }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return deny(401, 'shape');
  const keys = Object.keys(msg).sort();
  if (keys.length !== 2 || keys[0] !== 'jti' || keys[1] !== 't' || typeof msg.jti !== 'string' || !JTI_RE.test(msg.jti) || typeof msg.t !== 'string') return deny(401, 'shape');
  const auth = await authenticate(ctx, msg.t);
  if (!auth.ok) return deny(401, auth.reason);
  const fresh = auth.claims;
  const { gatewayId, workspaceId } = ctx.ids();
  const scope = checkTicketScope(fresh, { nowS: Math.floor(ctx.now() / 1000), gatewayId, workspaceId });
  if (!scope.ok) return deny(401, scope.reason);
  const rate = ctx.perPersonRequests.hit(fresh.sub);
  if (!rate.ok) { ctx.log('renew_refused', { door, status: 429 }); return respond(req, res, 429, { headers: { ...extraHeaders, 'Retry-After': String(rate.retryAfterS) } }); }
  const r = ctx.streams.renew({ door, jti: msg.jti, urlClip: clipId, fresh });
  if (!r.ok) return deny(401, r.reason);
  ctx.log('renewed', { door, jti: msg.jti, fresh_jti: fresh.jti });
  respond(req, res, 204, { headers: { ...extraHeaders, 'Wilson-Gateway-Path': door } });
  return undefined;
}

export const defaultFs = {
  realpath: (p) => fs.promises.realpath(p),
  readdir: (p, o) => fs.promises.readdir(p, o),
  stat: (p) => fs.promises.stat(p),
  open: (p) => fs.promises.open(p, 'r'),
  createReadStream: (p, o) => fs.createReadStream(p, o),
};
