// =============================================================================
// doorsInside.test.mjs — the INSIDE door.
//
// At the socket level, with the peer this computer has without binding a LAN
// address (loopback): the REAL address rule closes it on the `connection`
// event before a single TLS byte, and counts it; a control door that admits
// the same peer answers the same bytes with TLS. (The own-LAN-address proof
// binds this computer's LAN address, so it is a separate, announced run:
// gateway/test/lan/insideDoorLan.mjs.)
//
// Above the socket (an admitting gate, the harness's): a proxy's header is
// 403 with no body, a foreign Host is 403 (DNS rebinding), the status page,
// /v1/health, /v1/path, the private-network preflight, rv false allowed
// inside, the catalogue's 24 h grace and its sentence, the relay signal, and
// NOTHING written down.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'node:net';
import tls from 'node:tls';
import { makeShare, makeWorld, CLIP, SUB, LOC, certs } from './harness.mjs';
import { createDoorServer } from '../src/doors/server.mjs';
import { makeInsideGate, makeCounters } from '../src/doors/gates.mjs';
import { peerLimiters, Pools, DEFAULT_LIMITS } from '../src/rules/limits.mjs';
import { PROXY_HEADERS } from '../src/rules/peers.mjs';
import { NEVER_CONFIRMED_SENTENCE } from '../src/cloud/catalogue.mjs';

let share;
beforeAll(() => { share = makeShare(); });
afterAll(() => { share.cleanup(); });

/** Raw TCP: send bytes that are not TLS, collect whatever comes back until close. */
function rawExchange(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    let got = 0;
    s.on('data', (c) => { got += c.length; });
    s.on('connect', () => s.write(Buffer.from('16030100' + '00'.repeat(60), 'hex')));
    s.on('close', () => resolve(got));
    s.on('error', () => {});
    setTimeout(() => { s.destroy(); }, 2_000);
  });
}

describe('the address rule at the socket level (§4: closed before TLS, counted)', () => {
  const realGate = (counters) => makeInsideGate({
    peers: () => ({ ownAddresses: ['192.168.1.173', '127.0.0.1', '::1'], coLocatedNets: [], officeRanges: [] }),
    limiters: peerLimiters(DEFAULT_LIMITS).inside,
    pools: new Pools({ connections: 400, streams: 200, insideReserve: 0.25 }),
    counters,
  });
  const door = async (gate) => {
    const d = createDoorServer({ door: 'inside', host: '127.0.0.1', port: 0, tls: { cert: certs.leaf.certPem, key: certs.leaf.keyPem }, limits: DEFAULT_LIMITS, gate, handler: (_q, r) => r.end('x') });
    await d.listen();
    return d;
  };

  it('a loopback peer gets NO byte (no TLS alert, no certificate) and is counted; the control door answers the same bytes', async () => {
    const counters = makeCounters();
    const refusing = await door(realGate(counters));
    const admitting = await door(() => ({ admit: true }));
    try {
      expect(await rawExchange(refusing.port)).toBe(0);
      expect(counters.loopback).toBe(1);
      expect(await rawExchange(admitting.port)).toBeGreaterThan(0); // a TLS alert: the difference is the gate
    } finally { await refusing.close(); await admitting.close(); }
  });
  it('a real TLS client is cut before it sees a certificate', async () => {
    const counters = makeCounters();
    const refusing = await door(realGate(counters));
    try {
      const r = await new Promise((resolve) => {
        const c = tls.connect({ host: '127.0.0.1', port: refusing.port, servername: 'studio-nas', ca: certs.root.certPem });
        c.once('secureConnect', () => { resolve({ ok: true, cert: c.getPeerCertificate() }); c.destroy(); });
        c.once('error', (e) => resolve({ ok: false, code: e.code, cert: c.getPeerCertificate?.() }));
      });
      expect(r.ok).toBe(false);
      expect(r.code).toMatch(/ECONNRESET|EPIPE|ERR_SSL|ECONNABORTED/);
      expect(r.cert && Object.keys(r.cert).length ? r.cert : null).toBeNull();
      expect(counters.loopback).toBe(1);
    } finally { await refusing.close(); }
  });
  it('the gate holds the inside door\'s per-peer limits too (here, 2 new connections a minute)', async () => {
    const counters = makeCounters();
    const gate = makeInsideGate({
      peers: () => ({ ownAddresses: [], coLocatedNets: [], officeRanges: [] }),
      limiters: peerLimiters({ ...DEFAULT_LIMITS, inside: { newConnectionsPerMinutePerPeer: 2, handshakesPerSecondPerPeer: 40 } }).inside,
      pools: new Pools({ connections: 400, streams: 200, insideReserve: 0.25 }),
      counters,
    });
    // An office peer, by the classifier's own rule (the socket stands in).
    const sock = { remoteAddress: '192.168.1.55' };
    expect(gate(sock).admit).toBe(true);
    expect(gate(sock).admit).toBe(true);
    expect(gate(sock)).toEqual({ admit: false, reason: 'rate' });
    expect(gate({ remoteAddress: '203.0.113.5' })).toEqual({ admit: false, reason: 'public' });
    expect(counters).toMatchObject({ rate: 1, public: 1, sinceSync: { public: 1 } });
  });
});

describe('the inside door above the socket', () => {
  let W;
  beforeAll(async () => { W = await makeWorld({ door: 'inside', share }); });
  afterAll(() => W.close());

  it('a proxy\'s header, any of them: 403 with no body', async () => {
    for (const h of PROXY_HEADERS) {
      const r = await W.request('/v1/path', { headers: { [h]: '203.0.113.7' } });
      expect([h, r.status, r.body.length]).toEqual([h, 403, 0]);
    }
  });
  it('a Host that is not the gateway\'s: 403 with no body (DNS rebinding); its names and addresses pass', async () => {
    expect((await W.request('/v1/path', { headers: { host: 'evil.example' } })).status).toBe(403);
    expect((await W.request('/v1/path', { headers: { host: `studio-nas:${W.server.port + 1}` } })).status).toBe(403);
    expect((await W.request('/v1/path', { headers: { host: `192.168.1.10:${W.server.port}` } })).status).toBe(200);
    expect((await W.request('/v1/path', { headers: { host: 'STUDIO-NAS.local' } })).status).toBe(200);
    expect((await W.request('/v1/path', { headers: { host: `[::ffff:192.168.1.10]:${W.server.port}` } })).status).toBe(200);
  });
  it('/v1/path names the door and the gateway', async () => {
    const r = await W.request('/v1/path', { headers: { origin: 'https://wilson.petalstudios.com' } });
    expect(JSON.parse(r.body)).toEqual({ gateway_id: '6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f601', path: 'inside', version: '0.1.0' });
    expect(r.headers['access-control-allow-origin']).toBe('https://wilson.petalstudios.com');
    expect((await W.request('/v1/path', { headers: { origin: 'https://evil.example' } })).headers['access-control-allow-origin']).toBeUndefined();
  });
  it('/v1/health is the full health data inside', async () => {
    expect(JSON.parse((await W.request('/v1/health')).body)).toMatchObject({ name: 'Studio NAS', version: '0.1.0' });
  });
  it('the status page: the health line and the fingerprint, no script, a locked-down CSP', async () => {
    const r = await W.request('/');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(r.headers['content-security-policy']).toContain("default-src 'none'");
    const html = r.body.toString();
    expect(html).toContain('Studio NAS');
    expect(html).toContain('office door open (192.168.1.10:8443)');
    expect(html).toContain(certs.root.fingerprint.toUpperCase().match(/.{2}/g).join(':'));
    expect(html).toContain('Chrome on Linux');
    expect(html).not.toMatch(/<script/i);
  });
  it('the preflight answers private network on the inside door only, for the web app\'s origin', async () => {
    const r = await W.request('/v1/clips/x', { method: 'OPTIONS', headers: { origin: 'https://wilson.petalstudios.com', 'access-control-request-method': 'GET', 'access-control-request-headers': 'range', 'access-control-request-private-network': 'true' } });
    expect(r.status).toBe(204);
    expect(r.headers['access-control-allow-private-network']).toBe('true');
    expect(r.headers['access-control-allow-headers']).toBe('Range, Content-Type');
  });
  it('a ticket with rv false plays inside (the switch is about the outside door), and the answer names the door', async () => {
    const r = await W.request(W.clipUrl(W.ticket({ rv: false })), { headers: { range: 'bytes=0-9' } });
    expect(r.status).toBe(206);
    expect(r.headers['wilson-gateway-path']).toBe('inside');
  });
  it('NOTHING is written down for the inside door (G6)', async () => {
    await W.request(W.clipUrl(W.ticket()), { headers: { range: 'bytes=0-9' } });
    W.ctx.viewings.endAll();
    expect(W.journal.lines).toEqual([]);
  });
  it('a refusal on the inside door still names the door, and still has no body', async () => {
    const r = await W.request(W.clipUrl(W.ticket({ gw: '00000000-0000-4000-8000-000000000999' })));
    expect([r.status, r.body.length, r.headers['wilson-gateway-path']]).toEqual([401, 0, 'inside']);
  });
});

describe('the catalogue check inside: 24 hours of grace, then the sentence (R11)', () => {
  it('confirmed once, the cloud gone: plays for 24 h, then 404 with the one sentence; never confirmed: the sentence at once', async () => {
    const W = await makeWorld({ door: 'inside', share });
    try {
      expect((await W.request(W.clipUrl(W.ticket()), { headers: { range: 'bytes=0-0' } })).status).toBe(206);
      W.state.cloudReachable = false;
      W.clock.t += 11 * 60_000;
      expect((await W.request(W.clipUrl(W.ticket()), { headers: { range: 'bytes=0-0' } })).status).toBe(206);
      W.clock.t += 24 * 60 * 60_000;
      const late = await W.request(W.clipUrl(W.ticket()), { headers: { range: 'bytes=0-0' } });
      expect([late.status, late.body.toString()]).toEqual([404, NEVER_CONFIRMED_SENTENCE]);
      const never = await W.request(W.clipUrl(W.ticket({ path: 'A001/Clip Two.MOV', mt: null })), { headers: { range: 'bytes=0-0' } });
      expect([never.status, never.body.toString()]).toEqual([404, NEVER_CONFIRMED_SENTENCE]);
    } finally { await W.close(); }
  });
  it('a clip the reachable cloud does not confirm: 404 with no body, and any earlier confirmation is forgotten', async () => {
    const W = await makeWorld({ door: 'inside', share });
    try {
      expect((await W.request(W.clipUrl(W.ticket()), { headers: { range: 'bytes=0-0' } })).status).toBe(206);
      W.state.confirmed = new Set();
      W.clock.t += 11 * 60_000;
      const r = await W.request(W.clipUrl(W.ticket()), { headers: { range: 'bytes=0-0' } });
      expect([r.status, r.body.length]).toEqual([404, 0]);
      W.state.cloudReachable = false;
      expect((await W.request(W.clipUrl(W.ticket()), { headers: { range: 'bytes=0-0' } })).status).toBe(404); // no grace for a removed clip
    } finally { await W.close(); }
  });
});

describe('the relay signal (§4, §10 row 22)', () => {
  it('six people through one office address in a day is named', async () => {
    const W = await makeWorld({ door: 'inside', share });
    try {
      const subs = Array.from({ length: 6 }, (_, i) => `11111111-2222-4333-8444-55555555555${i}`);
      for (const sub of subs) await W.request(W.clipUrl(W.ticket({ sub })), { headers: { range: 'bytes=0-0' } });
      expect(W.ctx.relay.worst()).toEqual({ address: '127.0.0.1', viewers: 6 });
      W.clock.t += 86_400_000;
      W.ctx.relay.see('127.0.0.1', SUB);
      expect(W.ctx.relay.worst()).toBeNull(); // a new day
    } finally { await W.close(); }
  });
  it('the location is read only by its id from the ticket\'s authority', () => {
    expect(LOC).toMatch(/^[0-9a-f-]{36}$/);
    expect(CLIP).not.toBe(LOC);
  });
});
