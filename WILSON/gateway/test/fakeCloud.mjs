// =============================================================================
// A fake of WILSON's cloud for the gateway (the brief: "your cloud is a fake",
// built to Appendix C): the five functions' shapes, the switch, the
// locations, the catalogue, the members, the signing keys (the committed
// FIXTURE key from gateway/test/vectors.json, never a real one), the reach
// nonce, and a record of every call. No database, no Supabase, no network
// beyond loopback.
//
//   in-process     createFakeCloud().fetch: a `fetch` the gateway is handed,
//                  answering https://fake-cloud.test/functions/v1/<fn> from memory
//   as a server    node gateway/test/fakeCloud.mjs [--port 0] [--dir <scratch>]
//                  HTTPS on 127.0.0.1 with its own throwaway root (written to
//                  <dir>/fake-cloud-root.pem: give the gateway it as
//                  NODE_EXTRA_CA_CERTS), plus a control API on the same port,
//                  loopback only, for the tests and GW3's Playwright:
//                    POST /_control/state    merge { switch_on, outside_address, minimum_version, … }
//                    POST /_control/token    → { token } a fresh enrolment token
//                    POST /_control/location { id, unc_path, name }
//                    POST /_control/clip     { id, loc, path, seq, mt }
//                    POST /_control/member   { sub }
//                    POST /_control/mint     { clip, sub } → { ticket } (also gateway-ticket below)
//                    POST /_control/revoke   { gateway_id }
//                    GET  /_control/calls    → every call made, newest last
// =============================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { makeEnrolToken, makeCredential, sha256Hex, publicKeyToWire } from '../src/wire/formats.mjs';
import { makeRoot, makeLeaf } from '../src/certs/x509.mjs';
import { mintTicket, loadVectors } from './mint.mjs';

export const FAKE_BASE = 'https://fake-cloud.test/functions/v1';

export function createFakeCloud({ now = () => Date.now(), workspaceId = '0a1b2c3d-4e5f-4a6b-9c7d-8e9fa0b1c2d3', workspaceName = 'Salt Hours Studio' } = {}) {
  const fixture = loadVectors();
  const S = {
    workspace: { id: workspaceId, name: workspaceName },
    tokens: new Map(), // sha → { expiresAt, usedAt }
    gateways: new Map(), // id → { credHash, revokedAt, lastReport, lastSeenAt, lastSource }
    keys: [{ kid: fixture.kid, privateKey: fixture.privateKey, wire: { kid: fixture.kid, public_key: fixture.public_key } }],
    origins: ['https://wilson.petalstudios.com', 'http://localhost:5289'],
    switchOn: false,
    outsideAddress: null,
    officeRanges: [],
    locations: [],
    files: new Map(), // clip → { loc, path, seq, mt }
    members: new Set(),
    minimumVersion: null,
    hardMinimumVersion: null,
    checkUpdateNow: false,
    checkReachNow: false,
    reachNonce: null,
    renamed: null,
    sendWorkspaceId: true,
    failNext: null, // { fn, status } or { fn, unreachable: true }
    events: [],
    mints: [],
    calls: [],
  };

  const answer = (status, json) => ({ status, json });
  const bearer = (headers) => { const h = headers.authorization || headers.Authorization || ''; return h.startsWith('Bearer ') ? h.slice(7) : null; };
  const gatewayOf = (headers) => {
    const cred = bearer(headers);
    if (!cred) return null;
    const hash = sha256Hex(cred);
    for (const [id, g] of S.gateways) if (g.credHash === hash) return { id, g };
    return null;
  };

  const fns = {
    'gateway-enrol': (headers, body) => {
      const token = bearer(headers);
      const row = token ? S.tokens.get(sha256Hex(token)) : null;
      // Spent in one step whether or not the answer is kept (§2 step 3).
      if (!row || row.usedAt || row.expiresAt <= now()) return answer(401, { error: 'That enrolment token was used already or has expired.', code: 'token_refused' });
      row.usedAt = now();
      if (!body || typeof body.root_cert_pem !== 'string' || typeof body.version !== 'string') return answer(400, { error: 'The enrolment is missing its certificate or version.', code: 'bad_body' });
      const id = crypto.randomUUID();
      const credential = makeCredential();
      S.gateways.set(id, { credHash: sha256Hex(credential), revokedAt: null, lastReport: null, lastSeenAt: null, enrolBody: body });
      return answer(200, {
        gateway_id: id,
        credential,
        ...(S.sendWorkspaceId ? { workspace_id: S.workspace.id } : {}),
        workspace_name: S.workspace.name,
        signing_keys: S.keys.map((k) => k.wire),
        web_app_origins: S.origins,
        sync_interval_s: 10,
      });
    },
    'gateway-sync': (headers, body) => {
      const found = gatewayOf(headers);
      if (!found || found.g.revokedAt) return answer(401, { error: 'This gateway is not enrolled.', code: 'unknown_gateway' });
      found.g.lastReport = body;
      found.g.lastSeenAt = now();
      const confirmed = [];
      for (const c of Array.isArray(body?.confirm) ? body.confirm.slice(0, 100) : []) {
        const f = S.files.get(c.clip);
        if (f && f.loc === c.loc && f.path === c.path) confirmed.push(c.clip);
      }
      const out = {
        remote_viewing: S.switchOn,
        outside_address: S.outsideAddress,
        office_ranges: S.officeRanges,
        signing_keys: S.keys.map((k) => k.wire),
        web_app_origins: S.origins,
        bin_locations: S.locations,
        confirmed,
        minimum_version: S.minimumVersion,
        hard_minimum_version: S.hardMinimumVersion,
        check_update_now: S.checkUpdateNow,
        check_reach_now: S.checkReachNow,
        reach_nonce: S.reachNonce,
        // GW1's rule: the answer names the row's name only when the report's differs.
        renamed: S.renamed !== null && body?.name !== S.renamed ? S.renamed : null,
        ...(S.sendWorkspaceId ? { workspace_id: S.workspace.id } : {}),
      };
      S.checkUpdateNow = false;
      S.checkReachNow = false;
      return answer(200, out);
    },
    'gateway-events': (headers, body) => {
      const found = gatewayOf(headers);
      if (!found || found.g.revokedAt) return answer(401, { error: 'This gateway is not enrolled.', code: 'unknown_gateway' });
      const rows = Array.isArray(body?.rows) ? body.rows : [];
      if (rows.length > 200) return answer(400, { error: 'At most 200 rows.', code: 'too_many' });
      const accepted = [];
      const rejected = [];
      for (const r of rows) {
        if (!r || typeof r.viewing_id !== 'string') continue;
        if (!S.files.has(r.clip)) { rejected.push({ viewing_id: r.viewing_id, reason: 'clip_not_in_workspace' }); continue; }
        if (!S.members.has(r.sub)) { rejected.push({ viewing_id: r.viewing_id, reason: 'viewer_not_in_workspace' }); continue; }
        const external = `${found.id}:${r.viewing_id}`;
        if (!S.events.some((e) => e.external_id === external)) {
          const minted = S.mints.some((m) => m.jti === r.ticket_jti && m.gw === found.id && m.sub === r.sub && m.clip === r.clip);
          S.events.push({ external_id: external, gateway_id: found.id, event: 'viewed_remote', unverified_mint: !minted, ...r });
        }
        accepted.push(r.viewing_id);
      }
      return answer(200, { accepted, rejected });
    },
    'gateway-ticket': (headers, body) => {
      // The web app's call, with a sign-in token; the fake's sign-in token is "user:<sub>".
      const who = bearer(headers);
      const sub = who && who.startsWith('user:') ? who.slice(5) : null;
      if (!sub || !S.members.has(sub)) return answer(401, { error: 'Sign in again.', code: 'not_signed_in' });
      const gw = body?.gateway_id;
      if (!S.gateways.has(gw) || S.gateways.get(gw).revokedAt) return answer(404, { error: 'No such gateway.', code: 'unknown_gateway' });
      const ids = Array.isArray(body?.bin_file_ids) ? body.bin_file_ids.slice(0, 50) : [];
      const tickets = {};
      const missing = [];
      const iat = Math.floor(now() / 1000);
      for (const clip of ids) {
        const f = S.files.get(clip);
        if (!f) { missing.push(clip); continue; }
        tickets[clip] = mintFor({ gw, sub, clip, f, iat });
      }
      return answer(200, { tickets, missing, expires_at: new Date((iat + 120) * 1000).toISOString() });
    },
    'gateway-reach': () => {
      // The fake writes a fresh nonce (delivered at the next sync); the probe itself is the test's (reachProbe below).
      S.reachNonce = crypto.randomBytes(24).toString('hex');
      return answer(200, { started: true });
    },
  };

  function mintFor({ gw, sub, clip, f, iat = Math.floor(now() / 1000), rv = S.switchOn, kid = S.keys[0].kid }) {
    const key = S.keys.find((k) => k.kid === kid) || S.keys[0];
    const claims = { v: 1, kid: key.kid, gw, ws: S.workspace.id, sub, clip, loc: f.loc, path: f.path, seq: !!f.seq, mt: f.mt ?? null, rv, iat, exp: iat + 120, jti: crypto.randomBytes(16).toString('hex') };
    S.mints.push({ jti: claims.jti, gw, sub, clip, at: now() });
    return mintTicket(claims, key.privateKey);
  }

  function handle(fn, headers, body) {
    S.calls.push({ fn, at: now(), body });
    if (S.failNext && S.failNext.fn === fn) {
      const f = S.failNext; S.failNext = null;
      if (f.unreachable) return { unreachable: true };
      return answer(f.status, { error: 'forced', code: 'forced' });
    }
    const h = fns[fn];
    return h ? h(headers, body) : answer(404, { error: 'No such function.' });
  }

  /** A fetch for the gateway, in memory. */
  async function fakeFetch(url, init = {}) {
    const u = new URL(url);
    if (!u.href.startsWith(FAKE_BASE + '/')) throw new TypeError('fetch failed');
    const fn = u.pathname.split('/').pop();
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch { body = null; }
    const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    const r = handle(fn, headers, body);
    if (r.unreachable) throw new TypeError('fetch failed');
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'content-type': 'application/json' } });
  }

  const api = {
    state: S,
    handle,
    fetch: fakeFetch,
    base: FAKE_BASE,
    newToken({ expiresInMs = 24 * 3600_000 } = {}) {
      const t = makeEnrolToken();
      S.tokens.set(sha256Hex(t), { expiresAt: now() + expiresInMs, usedAt: null });
      return t;
    },
    addLocation(loc) { S.locations = S.locations.filter((l) => l.id !== loc.id).concat([loc]); },
    addClip(id, f) { S.files.set(id, f); },
    addMember(sub) { S.members.add(sub); },
    onlyGateway() { const [id] = S.gateways.keys(); return id; },
    mint({ clip, sub, rv, kid, gw = api.onlyGateway(), iat }) { return mintFor({ gw, sub, clip, f: S.files.get(clip), rv: rv ?? S.switchOn, kid, iat }); },
    revoke(id = api.onlyGateway()) { S.gateways.get(id).revokedAt = now(); },
    rotateKey(kid) {
      const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
      S.keys.unshift({ kid, privateKey, wire: { kid, public_key: publicKeyToWire(publicKey) } });
    },
    lastReport(id = api.onlyGateway()) { return S.gateways.get(id)?.lastReport; },
    /** The reach probe's last step: GET /v1/health on the outside door with the nonce; reached only on the echo. */
    async reachProbe({ host, port, ca, servername }) {
      return new Promise((resolve) => {
        const req = https.request({ host, port, path: '/v1/health', method: 'GET', ca, servername, headers: { 'wilson-reach-nonce': S.reachNonce || '' }, timeout: 5_000 }, (res) => {
          let t = '';
          res.on('data', (c) => { t += c; if (t.length > 4096) req.destroy(); });
          res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch { j = null; } resolve({ status: res.statusCode, isThisGateway: !!S.reachNonce && j?.nonce_echo === S.reachNonce, body: j }); });
        });
        req.on('error', (e) => resolve({ status: 0, error: e.code, isThisGateway: false }));
        req.on('timeout', () => req.destroy());
        req.end();
      });
    },
  };
  return api;
}

/** HTTPS on loopback, for a gateway running as its own process. Resolves { url, caFile, port, close }. */
export async function serveFakeCloud(cloud, { dir, port = 0 } = {}) {
  const root = makeRoot({ hostname: 'localhost', insideAddresses: ['127.0.0.1'], now: Date.now() });
  // The fake cloud's leaf names 127.0.0.1 itself: its throwaway root permits it (a /24 of loopback, for this fake only).
  const leaf = makeLeaf({ rootCertPem: root.certPem, rootKeyPem: root.keyPem, hostname: 'localhost', insideAddresses: ['127.0.0.1'], now: Date.now() });
  fs.mkdirSync(dir, { recursive: true });
  const caFile = path.join(dir, 'fake-cloud-root.pem');
  fs.writeFileSync(caFile, root.certPem);
  const server = https.createServer({ cert: leaf.certPem, key: leaf.keyPem }, async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = null;
    try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null; } catch { body = null; }
    const send = (status, json) => { const b = JSON.stringify(json); res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(b) }); res.end(b); };
    const p = req.url.split('?')[0];
    if (p.startsWith('/_control/')) {
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return send(403, { error: 'loopback only' });
      const action = p.slice('/_control/'.length);
      const S = cloud.state;
      if (action === 'state') { for (const [k, v] of Object.entries(body || {})) { const key = { switch_on: 'switchOn', outside_address: 'outsideAddress', minimum_version: 'minimumVersion', hard_minimum_version: 'hardMinimumVersion', office_ranges: 'officeRanges', check_update_now: 'checkUpdateNow', check_reach_now: 'checkReachNow', renamed: 'renamed' }[k]; if (key) S[key] = v; } return send(200, { ok: true }); }
      if (action === 'token') return send(200, { token: cloud.newToken() });
      if (action === 'location') { cloud.addLocation(body); return send(200, { ok: true }); }
      if (action === 'clip') { cloud.addClip(body.id, { loc: body.loc, path: body.path, seq: !!body.seq, mt: body.mt ?? null }); return send(200, { ok: true }); }
      if (action === 'member') { cloud.addMember(body.sub); return send(200, { ok: true }); }
      if (action === 'mint') return send(200, { ticket: cloud.mint({ clip: body.clip, sub: body.sub, rv: body.rv }) });
      if (action === 'revoke') { cloud.revoke(body?.gateway_id); return send(200, { ok: true }); }
      if (action === 'reach') { S.reachNonce = crypto.randomBytes(24).toString('hex'); return send(200, { nonce_set: true }); }
      if (action === 'probe') return send(200, await cloud.reachProbe(body));
      if (action === 'calls') return send(200, { calls: S.calls.map((c) => ({ fn: c.fn, at: c.at })), events: S.events, gateways: [...S.gateways.keys()] });
      return send(404, { error: 'no such control' });
    }
    const fn = p.replace(/^\/functions\/v1\//, '');
    const r = cloud.handle(fn, Object.fromEntries(Object.entries(req.headers)), body);
    if (r.unreachable) { req.socket.destroy(); return undefined; }
    return send(r.status, r.json);
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const actual = server.address().port;
  return { url: `https://127.0.0.1:${actual}/functions/v1`, control: `https://127.0.0.1:${actual}/_control`, caFile, port: actual, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) };
}

// As a program: node gateway/test/fakeCloud.mjs [--port N] [--dir DIR]
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name, d) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : d; };
  const dir = arg('--dir', path.join(process.cwd(), 'fake-cloud'));
  const cloud = createFakeCloud();
  const s = await serveFakeCloud(cloud, { dir, port: Number(arg('--port', 0)) });
  console.log(JSON.stringify({ url: s.url, control: s.control, ca_file: s.caFile, port: s.port }));
}
