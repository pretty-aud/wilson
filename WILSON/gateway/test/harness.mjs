// =============================================================================
// The doors' test harness: a temp "share" with real files (random bytes, never
// footage), a junction or symlink pointing out of it, the gateway's own root
// and leaf, a throwaway signing key, and one door listening on loopback with
// the context the runtime builds (doors/context.mjs).
//
// The inside door's ADDRESS RULE is the real one in doorsInside.test.mjs; the
// HTTP-level inside tests (proxy header, Host, status page, routes) pass a
// gate that admits loopback, because this computer has no other peer to send
// from. That gate is a parameter of the internal server factory, reachable
// from no config, environment variable or command: the runtime always builds
// the inside door with the real classifier (runtime.test.mjs proves it).
// =============================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { createDoorServer } from '../src/doors/server.mjs';
import { makeHandler } from '../src/doors/handler.mjs';
import { makeDoorContext } from '../src/doors/context.mjs';
import { Catalogue } from '../src/cloud/catalogue.mjs';
import { resolveLimits } from '../src/rules/limits.mjs';
import { makeRoot, makeLeaf } from '../src/certs/x509.mjs';
import { composeHealthLine } from '../src/rules/health.mjs';
import { claimsOf, mintTicket, makeSigningKey } from './mint.mjs';

export const GW = '6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f601';
export const WS = '0a1b2c3d-4e5f-4a6b-9c7d-8e9fa0b1c2d3';
export const LOC = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
export const SUB = '11111111-2222-4333-8444-555555555555';
export const SUB2 = '22222222-3333-4444-8555-666666666666';
export const CLIP = '99999999-8888-4777-b666-555555555555';
export const CLIP2 = '99999999-8888-4777-b666-555555555556';

const certs = (() => {
  const root = makeRoot({ hostname: 'studio-nas', insideAddresses: ['192.168.1.10'], now: Date.now() });
  const leaf = makeLeaf({ rootCertPem: root.certPem, rootKeyPem: root.keyPem, hostname: 'studio-nas', insideAddresses: ['192.168.1.10'], now: Date.now() });
  return { root, leaf };
})();

/** A share folder with real files, and a link pointing out of it. */
export function makeShare() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gw2-share-'));
  const root = path.join(base, 'Footage Share');
  const outside = path.join(base, 'outside');
  const w = (rel, bytes) => { const p = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, bytes); return p; };
  fs.mkdirSync(outside, { recursive: true });
  const clipBytes = crypto.randomBytes(1024 * 1024 + 17);
  w('A001/clip.mp4', clipBytes);
  w('A001/Clip Two.MOV', crypto.randomBytes(4096));
  w('A001/master.mxf', crypto.randomBytes(1000));
  w('A001/empty.mp4', Buffer.alloc(0));
  w('A001/renamed.png', crypto.randomBytes(500)); // a .png, whatever the row once said
  for (const n of ['001', '002', '003']) w(`VFX/plate_png/plate_${n}.png`, Buffer.from(`png frame ${n}`));
  for (const n of ['0001', '0002', '0003']) w(`VFX/plate_exr/plate.${n}.exr`, Buffer.from(`exr frame ${n}`));
  fs.writeFileSync(path.join(outside, 'secret.mp4'), crypto.randomBytes(2048));
  fs.symlinkSync(outside, path.join(root, 'link-out'), process.platform === 'win32' ? 'junction' : 'dir');
  return { base, root, clipBytes, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

export function memoryJournal() {
  const lines = [];
  return { lines, start: (row) => { lines.push({ t: 'start', row }); }, end: (row) => { lines.push({ t: 'end', row }); } };
}

/**
 * One door on loopback.
 * @param o { door, gate?, limits?, share, confirmed?: Set<clip>|'all', cloudReachable?: boolean, clock?: { t } }
 */
export async function makeWorld(o) {
  const door = o.door;
  const clock = o.clock || { t: Date.now() };
  const now = () => clock.t;
  const key = makeSigningKey('k1');
  const keys = new Map([['k1', key.publicKey]]);
  const state = {
    confirmed: o.confirmed ?? 'all',
    cloudReachable: o.cloudReachable ?? true,
    confirmCalls: [],
    unknownKidSyncs: 0,
    reachNonce: 'nonce-' + crypto.randomBytes(8).toString('hex'),
    locations: new Map([[LOC, { root: o.share.root, state: 'reachable' }]]),
    origins: ['https://wilson.petalstudios.com'],
    log: [],
  };
  const catalogue = new Catalogue({
    now,
    confirm: async (items) => {
      state.confirmCalls.push(items);
      if (!state.cloudReachable) return { reached: false };
      const c = state.confirmed === 'all' ? items.map((i) => i.clip) : items.map((i) => i.clip).filter((x) => state.confirmed.has(x));
      return { reached: true, confirmed: c };
    },
  });
  const journal = memoryJournal();
  const { limits } = resolveLimits(o.limits || {});
  const ctx = makeDoorContext({
    ids: () => ({ gatewayId: GW, workspaceId: WS }),
    keyFor: (kid) => keys.get(kid) || null,
    syncForUnknownKid: async () => { state.unknownKidSyncs += 1; if (state.onUnknownKid) state.onUnknownKid(keys); },
    location: (id) => state.locations.get(id) || null,
    catalogue,
    journal,
    now,
    log: (event, detail) => state.log.push({ event, ...detail }),
    limits,
    origins: () => state.origins,
    host: () => ({ names: ['studio-nas', 'studio-nas.local'], addresses: ['192.168.1.10', '127.0.0.1'], port: server.port }),
    health: () => ({ name: 'Studio NAS', version: '0.1.0', doors: {}, reach: {}, certificate: {} }),
    healthLine: () => composeHealthLine({ now: clock.t, name: 'Studio NAS', version: '0.1.0', lastSyncAt: clock.t, inside: { state: 'open', addresses: [{ address: '192.168.1.10', port: 8443 }] }, outside: { state: 'closed_switch_off' }, locations: [], certificate: null, update: null }),
    fingerprint: () => certs.root.fingerprint,
    reachNonce: () => state.reachNonce,
    version: '0.1.0',
    declaredProxy: () => o.declaredProxy || null,
    locationSlow: (id) => state.log.push({ event: 'slow', id }),
  });
  if (o.liveCheckMs) ctx.liveCheckMs = o.liveCheckMs;
  const gate = o.gate || (() => ({ admit: true }));
  const server = createDoorServer({ door, host: '127.0.0.1', port: 0, tls: { cert: certs.leaf.certPem, key: certs.leaf.keyPem }, limits, gate, handler: makeHandler(ctx, door), onEvent: (e, d) => state.log.push({ event: e, ...d }) });
  await server.listen();

  const ticket = (over = {}) => mintTicket(claimsOf({ kid: 'k1', gw: GW, ws: WS, sub: SUB, clip: CLIP, loc: LOC, path: 'A001/clip.mp4', mt: 'video/mp4', rv: door === 'outside', iat: Math.floor(clock.t / 1000) - 1, ...over }), key.privateKey);
  /** One HTTPS request; resolves { status, headers, body: Buffer }. */
  const request = (urlPath, { method = 'GET', headers = {}, body = null, abortAfterBytes = null, agent = false } = {}) => new Promise((resolve, reject) => {
    const req = https.request({
      host: '127.0.0.1', port: server.port, path: urlPath, method, agent,
      servername: 'studio-nas', ca: certs.root.certPem,
      headers: { host: `studio-nas:${server.port}`, ...headers },
    }, (res) => {
      const chunks = [];
      let n = 0;
      res.on('data', (c) => {
        chunks.push(c); n += c.length;
        if (abortAfterBytes !== null && n >= abortAfterBytes) { req.destroy(); resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), aborted: true }); }
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), aborted: true }));
    });
    req.on('error', (e) => (abortAfterBytes !== null ? undefined : reject(e)));
    if (body) req.write(body);
    req.end();
  });
  const clipUrl = (t, id = CLIP) => `/v1/clips/${id}?t=${t}`;
  return { door, clock, key, keys, state, ctx, server, journal, ticket, request, clipUrl, certs, close: () => server.close() };
}

export { certs };
