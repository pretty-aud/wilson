// =============================================================================
// doorsOutside.test.mjs — the OUTSIDE door over real TLS on loopback (on the
// outside door every request is outside, whatever its address, so loopback is
// an honest peer here): every refusal with its status and no body; the Range
// reads; renewals and their five bindings; the in-flight cut; the minimal
// health answer and the nonce echo; the limits; the viewing rows; and the
// close with a half-open TLS socket held open.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { makeShare, makeWorld, CLIP, CLIP2, SUB2, LOC } from './harness.mjs';
import { outsidePeerKey } from '../src/rules/ip.mjs';
import { resolveLimits, peerLimiters, Pools, FixedWindow } from '../src/rules/limits.mjs';
import { makeOutsideGate, makeCounters } from '../src/doors/gates.mjs';

let share;
beforeAll(() => { share = makeShare(); });
afterAll(() => { share.cleanup(); });

const NO_CACHE = { 'cache-control': 'no-store', pragma: 'no-cache', 'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'cross-origin', 'referrer-policy': 'no-referrer', 'strict-transport-security': 'max-age=31536000' };

describe('the outside door serves bytes (§5 step 6)', () => {
  let W;
  beforeAll(async () => { W = await makeWorld({ door: 'outside', share }); });
  afterAll(() => W.close());

  it('a Range read: 206, the exact header set, the bytes', async () => {
    const r = await W.request(W.clipUrl(W.ticket()), { headers: { range: 'bytes=100-199' } });
    expect(r.status).toBe(206);
    expect(r.body.equals(share.clipBytes.subarray(100, 200))).toBe(true);
    expect(r.headers).toMatchObject({ ...NO_CACHE, 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-length': '100', 'content-range': `bytes 100-199/${share.clipBytes.length}`, 'wilson-gateway-path': 'outside' });
    for (const h of ['etag', 'last-modified', 'server', 'date', 'x-powered-by']) expect(r.headers[h], h).toBeUndefined();
  });
  it('no Range: 200, the whole file; an open-ended and a suffix range: 206', async () => {
    const r = await W.request(W.clipUrl(W.ticket()));
    expect(r.status).toBe(200);
    expect(r.body.equals(share.clipBytes)).toBe(true);
    const tail = await W.request(W.clipUrl(W.ticket()), { headers: { range: 'bytes=-10' } });
    expect(tail.body.equals(share.clipBytes.subarray(-10))).toBe(true);
    const open = await W.request(W.clipUrl(W.ticket()), { headers: { range: `bytes=${share.clipBytes.length - 5}-` } });
    expect(open.status).toBe(206);
    expect(open.body.length).toBe(5);
  });
  it('HEAD: the GET\'s headers, Content-Length included, and no body', async () => {
    const r = await W.request(W.clipUrl(W.ticket()), { method: 'HEAD' });
    expect(r.status).toBe(200);
    expect(r.headers['content-length']).toBe(String(share.clipBytes.length));
    expect(r.body.length).toBe(0);
  });
  it('an empty file: 200 with no bytes; any range of it: 416', async () => {
    expect((await W.request(W.clipUrl(W.ticket({ path: 'A001/empty.mp4' })))).status).toBe(200);
    expect((await W.request(W.clipUrl(W.ticket({ path: 'A001/empty.mp4' })), { headers: { range: 'bytes=0-' } })).status).toBe(416);
  });
  it('the type comes from the file on disk: .MOV is video/quicktime whatever its case', async () => {
    const r = await W.request(W.clipUrl(W.ticket({ path: 'A001/Clip Two.MOV', mt: 'video/quicktime' })), { headers: { range: 'bytes=0-9' } });
    expect(r.status).toBe(206);
    expect(r.headers['content-type']).toBe('video/quicktime');
  });
  it('a sequence plays its middle frame, an allow-listed still', async () => {
    const r = await W.request(W.clipUrl(W.ticket({ path: 'VFX/plate_png', seq: true, mt: 'image/png' })));
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect(r.body.toString()).toBe('png frame 002');
  });
});

describe('every refusal: its status, and no body (§5 step 6, §10 row 19)', () => {
  let W;
  beforeAll(async () => { W = await makeWorld({ door: 'outside', share }); });
  afterAll(() => W.close());
  const expectRefused = async (url, status, opts) => {
    const r = await W.request(url, opts);
    expect(r.status).toBe(status);
    expect(r.body.length).toBe(0);
    expect(r.headers['cache-control']).toBe('no-store');
    return r;
  };

  it('401: no ticket, two tickets, a forged one, an expired one, one for another gateway or workspace', async () => {
    await expectRefused(`/v1/clips/${CLIP}`, 401);
    await expectRefused(`/v1/clips/${CLIP}?t=${W.ticket()}&t=${W.ticket()}`, 401);
    const [v, p, s] = W.ticket().split('.');
    const sig = Buffer.from(s, 'base64url'); sig[3] ^= 1;
    await expectRefused(W.clipUrl(`${v}.${p}.${sig.toString('base64url')}`), 401);
    await expectRefused(W.clipUrl(W.ticket({ iat: Math.floor(W.clock.t / 1000) - 400 })), 401);
    await expectRefused(W.clipUrl(W.ticket({ gw: '7f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f602' })), 401);
    await expectRefused(W.clipUrl(W.ticket({ ws: '7f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f603' })), 401);
  });
  it('401: a ticket for another clip than the URL names', async () => {
    await expectRefused(W.clipUrl(W.ticket({ clip: CLIP2 }), CLIP), 401);
  });
  it('401 on the outside door: a ticket whose rv is false (§9 point 5)', async () => {
    await expectRefused(W.clipUrl(W.ticket({ rv: false })), 401);
  });
  it('an unknown kid asks the cloud ONCE, then refuses', async () => {
    const before = W.state.unknownKidSyncs;
    await expectRefused(W.clipUrl(W.ticket({ kid: 'k9' })), 401);
    expect(W.state.unknownKidSyncs).toBe(before + 1);
  });
  it('…and a kid the extra sync brings is accepted', async () => {
    W.state.onUnknownKid = (keys) => { keys.set('k2', W.key.publicKey); };
    const r = await W.request(W.clipUrl(W.ticket({ kid: 'k2' })), { headers: { range: 'bytes=0-0' } });
    expect(r.status).toBe(206);
    W.state.onUnknownKid = null;
    W.keys.delete('k2');
  });
  it('404: a traversal path, a path through a link out of the share, a missing file, a folder, an unknown location', async () => {
    await expectRefused(W.clipUrl(W.ticket({ path: '../outside/secret.mp4' })), 404);
    await expectRefused(W.clipUrl(W.ticket({ path: 'A001/../../outside/secret.mp4' })), 404);
    await expectRefused(W.clipUrl(W.ticket({ path: 'link-out/secret.mp4' })), 404);
    await expectRefused(W.clipUrl(W.ticket({ path: 'A001/nope.mp4' })), 404);
    await expectRefused(W.clipUrl(W.ticket({ path: 'A001', mt: null })), 404);
    await expectRefused(W.clipUrl(W.ticket({ loc: '00000000-0000-4000-8000-00000000dead' })), 404);
    await expectRefused(W.clipUrl(W.ticket({ path: 'A001/clip.mp4', seq: true })), 404); // not a folder of frames
  });
  it('404 without touching the disk: a location the gateway knows is down', async () => {
    W.state.locations.get(LOC).state = 'not_reachable';
    await expectRefused(W.clipUrl(W.ticket()), 404);
    W.state.locations.get(LOC).state = 'reachable';
  });
  it('415: a type off the list, mt that disagrees, a sequence whose frame is no allow-listed still', async () => {
    await expectRefused(W.clipUrl(W.ticket({ path: 'A001/master.mxf', mt: 'application/mxf' })), 415);
    await expectRefused(W.clipUrl(W.ticket({ path: 'A001/renamed.png', mt: 'video/mp4' })), 415);
    await expectRefused(W.clipUrl(W.ticket({ path: 'VFX/plate_exr', seq: true, mt: 'image/x-exr' })), 415);
  });
  it('416: an unsatisfiable range, a multi-range, a malformed one; Content-Range says the size', async () => {
    const r = await expectRefused(W.clipUrl(W.ticket()), 416, { headers: { range: `bytes=${share.clipBytes.length}-` } });
    expect(r.headers['content-range']).toBe(`bytes */${share.clipBytes.length}`);
    await expectRefused(W.clipUrl(W.ticket()), 416, { headers: { range: 'bytes=0-1,5-9' } });
    await expectRefused(W.clipUrl(W.ticket()), 416, { headers: { range: 'bytes=abc' } });
  });
  it('an upper-case id or another route: 404 with no body', async () => {
    await expectRefused(`/v1/clips/${CLIP.toUpperCase()}?t=${W.ticket()}`, 404);
    await expectRefused('/v1/anything', 404);
    await expectRefused('/', 404);
    await expectRefused('/v1/path', 404);
  });
  it('the ticket never reaches the log; its jti does', async () => {
    const t = W.ticket();
    await W.request(W.clipUrl(t), { headers: { range: 'bytes=0-0' } });
    const logged = JSON.stringify(W.state.log);
    expect(logged).not.toContain(t.split('.')[2]);
    expect(logged).toContain(JSON.parse(Buffer.from(t.split('.')[1], 'base64url')).jti);
  });
});

describe('the catalogue check (D22) on the outside door', () => {
  it('a clip the cloud does not confirm: 404, no body; once confirmed it is not asked again for ten minutes', async () => {
    const W = await makeWorld({ door: 'outside', share, confirmed: new Set() });
    try {
      const r = await W.request(W.clipUrl(W.ticket()), { headers: { range: 'bytes=0-0' } });
      expect([r.status, r.body.length]).toEqual([404, 0]);
      W.state.confirmed.add(CLIP);
      expect((await W.request(W.clipUrl(W.ticket()), { headers: { range: 'bytes=0-0' } })).status).toBe(206);
      const calls = W.state.confirmCalls.length;
      await W.request(W.clipUrl(W.ticket()), { headers: { range: 'bytes=1-1' } });
      expect(W.state.confirmCalls.length).toBe(calls);
      W.clock.t += 10 * 60_000;
      await W.request(W.clipUrl(W.ticket()), { headers: { range: 'bytes=1-1' } });
      expect(W.state.confirmCalls.length).toBe(calls + 1);
      expect(W.state.confirmCalls.at(-1)).toEqual([{ clip: CLIP, loc: LOC, path: 'A001/clip.mp4' }]);
    } finally { await W.close(); }
  });
  it('the cloud unreachable: no grace outside, 404 with no body (the sentence is the inside door\'s)', async () => {
    const W = await makeWorld({ door: 'outside', share });
    try {
      expect((await W.request(W.clipUrl(W.ticket()), { headers: { range: 'bytes=0-0' } })).status).toBe(206);
      W.clock.t += 11 * 60_000;
      W.state.cloudReachable = false;
      const r = await W.request(W.clipUrl(W.ticket()), { headers: { range: 'bytes=0-0' } });
      expect([r.status, r.body.length]).toEqual([404, 0]);
    } finally { await W.close(); }
  });
});

describe('renewal (§5 step 7, R3): the five bindings', () => {
  let W;
  beforeEach(async () => { if (W) await W.close(); W = await makeWorld({ door: 'outside', share }); });
  afterAll(() => W.close());
  const renew = (body, id = CLIP, type = 'application/json') => W.request(`/v1/clips/${id}/renew`, { method: 'POST', headers: { 'content-type': type }, body: JSON.stringify(body) });
  const jtiOf = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url')).jti;

  it('a renewed stream outlives its URL\'s ticket; without a renewal the same URL is 401', async () => {
    const t = W.ticket();
    expect((await W.request(W.clipUrl(t), { headers: { range: 'bytes=0-0' } })).status).toBe(206);
    W.clock.t += 75_000;
    expect((await renew({ jti: jtiOf(t), t: W.ticket() })).status).toBe(204);
    W.clock.t += 100_000; // past the URL ticket's exp + skew
    expect((await W.request(W.clipUrl(t), { headers: { range: 'bytes=1-1' } })).status).toBe(206);
    const other = W.ticket();
    await W.request(W.clipUrl(other), { headers: { range: 'bytes=0-0' } });
    W.clock.t += 151_000;
    expect((await W.request(W.clipUrl(other), { headers: { range: 'bytes=0-0' } })).status).toBe(401);
  });
  it('401: another clip\'s ticket, another viewer\'s ticket, a guessed jti, rv false outside', async () => {
    const t = W.ticket();
    await W.request(W.clipUrl(t), { headers: { range: 'bytes=0-0' } });
    expect((await renew({ jti: jtiOf(t), t: W.ticket({ clip: CLIP2 }) })).status).toBe(401);
    expect((await renew({ jti: jtiOf(t), t: W.ticket({ clip: CLIP2 }) }, CLIP2)).status).toBe(401);
    expect((await renew({ jti: jtiOf(t), t: W.ticket({ sub: SUB2 }) })).status).toBe(401);
    expect((await renew({ jti: 'f'.repeat(32), t: W.ticket() })).status).toBe(401);
    expect((await renew({ jti: jtiOf(t), t: W.ticket({ rv: false }) })).status).toBe(401);
    expect((await renew({ jti: jtiOf(t), t: W.ticket() })).status).toBe(204); // the control
  });
  it('401: a malformed body, extra keys, the wrong content type, a forged fresh ticket; 413 past 8 KB', async () => {
    const t = W.ticket();
    await W.request(W.clipUrl(t), { headers: { range: 'bytes=0-0' } });
    expect((await renew({ jti: jtiOf(t), t: W.ticket(), x: 1 })).status).toBe(401);
    expect((await renew({ jti: jtiOf(t) })).status).toBe(401);
    expect((await renew({ jti: jtiOf(t), t: W.ticket() }, CLIP, 'text/plain')).status).toBe(401);
    // Forged: one bit of the signature flipped (the last two characters set to
    // "AA" changed nothing whenever the signature's last byte was already 0,
    // which Ed25519's top byte is about one time in sixteen: a CI flake).
    const [v, p, s] = W.ticket().split('.');
    const sig = Buffer.from(s, 'base64url');
    sig[0] ^= 0x01;
    expect((await renew({ jti: jtiOf(t), t: `${v}.${p}.${sig.toString('base64url')}` })).status).toBe(401);
    const big = await W.request(`/v1/clips/${CLIP}/renew`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jti: jtiOf(t), t: 'x'.repeat(9000) }) });
    expect(big.status).toBe(413);
  });
  it('a stream lives four hours at most, renewed or not', async () => {
    const t = W.ticket();
    await W.request(W.clipUrl(t), { headers: { range: 'bytes=0-0' } });
    for (let i = 0; i < 4 * 60 * 60 / 75; i++) {
      W.clock.t += 75_000;
      const r = await renew({ jti: jtiOf(t), t: W.ticket() });
      if (r.status !== 204) { expect(i).toBeGreaterThan(190); return; }
    }
    W.clock.t += 75_000;
    expect((await renew({ jti: jtiOf(t), t: W.ticket() })).status).toBe(401);
  }, 60_000);
});

describe('a response still streaming when its authority runs out is cut (D5\'s bound)', () => {
  it('no renewal: the open response stops; with renewals it would go on', async () => {
    const big = makeShare();
    // Larger than loopback's socket buffers, so backpressure holds the response open.
    fs.writeFileSync(path.join(big.root, 'A001', 'big.mp4'), Buffer.alloc(48 * 1024 * 1024, 7));
    const W = await makeWorld({ door: 'outside', share: big, liveCheckMs: 50 });
    try {
      const t = W.ticket({ path: 'A001/big.mp4' });
      // Ask for everything and read nothing, so backpressure holds the response
      // open; let the authority run out; then read what arrived. A paused
      // client cannot see the close until it reads its buffered bytes.
      const got = await new Promise((resolve) => {
        import('node:https').then(({ default: https }) => {
          const req = https.request({ host: '127.0.0.1', port: W.server.port, path: W.clipUrl(t), servername: 'studio-nas', ca: W.certs.root.certPem, headers: { host: `studio-nas:${W.server.port}` } }, (res) => {
            let n = 0;
            let settled = false;
            const settle = () => { if (!settled) { settled = true; resolve({ n, complete: res.complete }); } };
            res.pause();
            res.on('data', (c) => { n += c.length; });
            setTimeout(() => { W.clock.t += 151_000; }, 100);
            setTimeout(() => res.resume(), 600);
            res.on('end', settle);
            res.on('aborted', settle);
            res.on('error', settle);
            res.on('close', settle);
          });
          req.on('error', () => {});
          req.end();
        });
      });
      expect(got.complete).toBe(false);
      expect(got.n).toBeLessThan(48 * 1024 * 1024);
      const served = W.state.log.find((e) => e.event === 'clip_served');
      expect(served.bytes).toBeLessThan(48 * 1024 * 1024);
    } finally { await W.close(); big.cleanup(); }
  });
});

describe('the outside door says nothing about itself (F5, R17)', () => {
  let W;
  beforeAll(async () => { W = await makeWorld({ door: 'outside', share }); });
  afterAll(() => W.close());
  it('/v1/health is { ok: true } and nothing else', async () => {
    const r = await W.request('/v1/health');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: true });
  });
  it('the cloud\'s current nonce is echoed; any other is not', async () => {
    expect(JSON.parse((await W.request('/v1/health', { headers: { 'wilson-reach-nonce': W.state.reachNonce } })).body)).toEqual({ ok: true, nonce_echo: W.state.reachNonce });
    expect(JSON.parse((await W.request('/v1/health', { headers: { 'wilson-reach-nonce': W.state.reachNonce + 'x' } })).body)).toEqual({ ok: true });
    W.state.reachNonce = null;
    expect(JSON.parse((await W.request('/v1/health', { headers: { 'wilson-reach-nonce': '' } })).body)).toEqual({ ok: true });
  });
  it('the preflight never says private network outside; another origin is refused', async () => {
    const ok = await W.request('/v1/clips/x', { method: 'OPTIONS', headers: { origin: 'https://wilson.petalstudios.com', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type', 'access-control-request-private-network': 'true' } });
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe('https://wilson.petalstudios.com');
    expect(ok.headers['access-control-allow-private-network']).toBeUndefined();
    const bad = await W.request('/v1/clips/x', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
    expect(bad.status).toBe(403);
  });
  it('a proxy header is not refused outside (the outside door may sit behind one)', async () => {
    expect((await W.request(W.clipUrl(W.ticket()), { headers: { range: 'bytes=0-0', 'x-forwarded-for': '203.0.113.9' } })).status).toBe(206);
  });
});

describe('the limits (D12) on the outside door', () => {
  it('600 requests a minute per person → 429 with Retry-After (here, 3)', async () => {
    const W = await makeWorld({ door: 'outside', share, limits: { perPersonRequestsPerMinute: 3 } });
    try {
      for (let i = 0; i < 3; i++) expect((await W.request(W.clipUrl(W.ticket()), { headers: { range: 'bytes=0-0' } })).status).toBe(206);
      const r = await W.request(W.clipUrl(W.ticket()), { headers: { range: 'bytes=0-0' } });
      expect(r.status).toBe(429);
      expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
      expect((await W.request(W.clipUrl(W.ticket({ sub: SUB2 })), { headers: { range: 'bytes=0-0' } })).status).toBe(206); // per person
    } finally { await W.close(); }
  });
  it('the outside bytes budget: refused once spent', async () => {
    const W = await makeWorld({ door: 'outside', share, limits: { outsideBytesPerHourPerPerson: 1000 } });
    try {
      expect((await W.request(W.clipUrl(W.ticket()), { headers: { range: 'bytes=0-999' } })).status).toBe(206);
      expect((await W.request(W.clipUrl(W.ticket()), { headers: { range: 'bytes=0-0' } })).status).toBe(429);
    } finally { await W.close(); }
  });
  it('concurrent streams per person: the ninth (here, the second) waits for one to end', async () => {
    const W = await makeWorld({ door: 'outside', share, limits: { perPersonStreams: 1 } });
    try {
      const first = W.request(W.clipUrl(W.ticket()), { abortAfterBytes: 1 });
      const r = await first;
      expect(r.status).toBe(200);
      await new Promise((res) => setTimeout(res, 50));
      expect((await W.request(W.clipUrl(W.ticket()), { headers: { range: 'bytes=0-0' } })).status).toBe(206);
    } finally { await W.close(); }
  });
});

describe('what is written down (G6, D7): one row per viewing, outside only', () => {
  it('a play and a scrub make one viewing; 60 s idle ends it; the row has counts and two offsets', async () => {
    const W = await makeWorld({ door: 'outside', share });
    try {
      const size = share.clipBytes.length;
      const t = W.ticket();
      await W.request(W.clipUrl(t), { headers: { range: 'bytes=0-524287', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36' } });
      W.clock.t += 5_000;
      await W.request(W.clipUrl(t), { headers: { range: `bytes=524288-${size - 1}` } });
      expect(W.journal.lines.map((l) => l.t)).toEqual(['start']);
      W.clock.t += 60_000;
      W.ctx.viewings.tick();
      const end = W.journal.lines.find((l) => l.t === 'end').row;
      expect(end).toMatchObject({ clip: CLIP, bytes: size, clip_bytes: size, fraction: 1, read_in_full: true, range_count: 2, first_offset: 0, last_offset: size - 1, source_address: '127.0.0.1', source_addresses: ['127.0.0.1'], shared_url: false, via: 'direct', user_agent: 'Chrome 142 on Windows', incomplete: false });
      expect(end.ticket_jti).toMatch(/^[0-9a-f]{32}$/);
      expect(Object.keys(end)).not.toContain('ranges');
    } finally { await W.close(); }
  });
  it('five minutes of activity close a row and the next byte starts another', async () => {
    const W = await makeWorld({ door: 'outside', share });
    try {
      for (let i = 0; i < 7; i++) {
        await W.request(W.clipUrl(W.ticket()), { headers: { range: `bytes=${i}-${i}` } });
        W.clock.t += 50_000;
      }
      expect(W.journal.lines.filter((l) => l.t === 'start')).toHaveLength(2);
    } finally { await W.close(); }
  });
  it('a declared local proxy: the forwarded address is recorded and via names the proxy', async () => {
    const W = await makeWorld({ door: 'outside', share, declaredProxy: { addresses: ['127.0.0.1'], name: 'local_proxy' } });
    try {
      await W.request(W.clipUrl(W.ticket()), { headers: { range: 'bytes=0-0', 'x-forwarded-for': '203.0.113.9' } });
      W.ctx.viewings.endAll();
      expect(W.journal.lines.find((l) => l.t === 'end').row).toMatchObject({ source_address: '203.0.113.9', via: 'local_proxy' });
    } finally { await W.close(); }
  });
});

describe('closing the outside door (§9 step 4; Appendix A, run 2)', () => {
  it('closes at once with a half-open TLS connection held, and the port refuses after', async () => {
    const W = await makeWorld({ door: 'outside', share });
    const port = W.server.port;
    const raw = net.connect(port, '127.0.0.1'); // TCP only: never starts TLS
    await new Promise((r) => raw.once('connect', r));
    await new Promise((r) => setTimeout(r, 50));
    expect(W.server.sockets.size).toBe(1);
    const ms = await W.server.close();
    expect(ms).toBeLessThan(1_000); // 120,002 ms without the tracking (the spike)
    await new Promise((r) => raw.once('close', r));
    const refused = await new Promise((r) => { const s = net.connect(port, '127.0.0.1'); s.once('error', (e) => r(e.code)); s.once('connect', () => { s.destroy(); r('connected'); }); });
    expect(refused).toBe('ECONNREFUSED');
  });
});

describe('a flood of forged tickets on one connection ends that connection (review round 1, finding 2; round 2, R2-5)', () => {
  let share;
  let W;
  let verifications = 0;
  beforeAll(async () => {
    share = makeShare();
    W = await makeWorld({ door: 'outside', share, clock: { t: Date.parse('2026-10-10T12:00:00Z') } });
    const keyFor = W.ctx.keyFor;
    W.ctx.keyFor = (kid) => { verifications += 1; return keyFor(kid); };
  });
  afterAll(async () => { await W.close(); share.cleanup(); });
  const forged = () => {
    const [v, p, s] = W.ticket().split('.');
    const sig = Buffer.from(s, 'base64url');
    sig[5] ^= 0x10;
    return `${v}.${p}.${sig.toString('base64url')}`;
  };
  // Many requests written at once on one TLS connection (HTTP/1.1 pipelining);
  // resolves the raw bytes the door answered before the connection ended.
  const pipelined = async (requests) => {
    const tls = await import('node:tls');
    return new Promise((resolve, reject) => {
      const chunks = [];
      const s = tls.connect({ host: '127.0.0.1', port: W.server.port, servername: 'studio-nas', ca: W.certs.root.certPem }, () => s.write(requests.join('')));
      s.on('data', (c) => chunks.push(c));
      s.on('error', reject);
      s.on('close', () => resolve(Buffer.concat(chunks).toString('latin1')));
      setTimeout(() => s.destroy(), 10_000).unref();
    });
  };
  const get = (t) => `GET /v1/clips/${CLIP}?t=${t} HTTP/1.1\r\nHost: studio-nas:${W.server.port}\r\nRange: bytes=0-0\r\n\r\n`;

  it('25 forged tickets pipelined in one write: the connection ends at the second, so at most one is ever checked (a browser never pipelines)', async () => {
    const before = verifications;
    const raw = await pipelined(Array.from({ length: 25 }, () => get(forged())));
    expect(raw.split('HTTP/1.1 ').length - 1).toBeLessThanOrEqual(1);
    expect(verifications - before).toBeLessThanOrEqual(1);
    expect(W.state.log.some((e) => e.event === 'pipelined_refused')).toBe(true);
  });
  it('one request at a time on a kept-alive connection: the 10th failed ticket\'s answer says "Connection: close", and the next try is on a new connection', async () => {
    const https = await import('node:https');
    const agent = new https.Agent({ keepAlive: true, maxSockets: 1 });
    try {
      const before = verifications;
      const seen = [];
      for (let i = 0; i < 11; i++) {
        const r = await W.request(W.clipUrl(forged()), { agent });
        seen.push([r.status, r.headers.connection]);
      }
      expect(seen.map((x) => x[0])).toEqual(Array(11).fill(401));
      expect(seen.slice(0, 9).every((x) => x[1] === 'keep-alive')).toBe(true);
      expect(seen[9][1]).toBe('close');
      expect(seen[10][1]).toBe('keep-alive'); // a new connection, its own count
      expect(verifications - before).toBe(11);
      expect(W.state.log.filter((e) => e.event === 'clip_refused' && e.closing)).toHaveLength(1);
    } finally { agent.destroy(); }
  });
  it('nobody else pays: a good ticket from the same address is served at once', async () => {
    expect((await W.request(W.clipUrl(W.ticket()), { headers: { range: 'bytes=0-0' } })).status).toBe(206);
  });
  it('a renewal\'s failures count on its connection the same way', async () => {
    const https = await import('node:https');
    const agent = new https.Agent({ keepAlive: true, maxSockets: 1 });
    try {
      const seen = [];
      for (let i = 0; i < 10; i++) {
        const r = await W.request(`/v1/clips/${CLIP}/renew`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jti: 'b'.repeat(32), t: forged() }), agent });
        seen.push([r.status, r.headers.connection]);
      }
      expect(seen.map((x) => x[0])).toEqual(Array(10).fill(401));
      expect(seen[8][1]).toBe('keep-alive');
      expect(seen[9][1]).toBe('close');
    } finally { agent.destroy(); }
  });
});

describe('the outside door counts an IPv6 /64 as one peer (review round 2, R2-4)', () => {
  it('outsidePeerKey: an IPv4 address as it is, an IPv6 address by its /64', () => {
    expect(outsidePeerKey('203.0.113.7')).toBe('203.0.113.7');
    expect(outsidePeerKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(outsidePeerKey('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64');
    expect(outsidePeerKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(outsidePeerKey('2001:db8:1:3::1')).toBe('2001:db8:1:3::/64');
  });
  it('rotating through one /64 does not buy a fresh connection budget; another /64 or another IPv4 address has its own', () => {
    const { limits } = resolveLimits({ outside: { newConnectionsPerMinutePerPeer: 4 } });
    const limiters = peerLimiters(limits, () => 1_000).outside;
    const pools = new Pools({ connections: limits.connections, streams: limits.streams, insideReserve: limits.insideReserve });
    const counters = makeCounters();
    const gate = makeOutsideGate({ limiters, pools, counters });
    const from = (remoteAddress) => gate({ remoteAddress }).admit;
    expect([1, 2, 3, 4, 5].map((n) => from(`2001:db8:1:2::${n}`))).toEqual([true, true, true, true, false]);
    expect(from('2001:db8:1:3::1')).toBe(true);
    expect([1, 2, 3, 4, 5].map((n) => from(`203.0.113.${n}`))).toEqual([true, true, true, true, true]);
    expect(counters.rate).toBe(1);
  });
  it('a limiter\'s map prunes its spent windows itself when a flood of new keys reaches its cap (R2-N3)', () => {
    let t = 0;
    const w = new FixedWindow({ limit: 1, windowMs: 1_000, now: () => t, maxKeys: 100 });
    for (let i = 0; i < 100; i++) w.hit(`k${i}`);
    expect(w.size).toBe(100);
    t = 5_000;
    w.hit('fresh');
    expect(w.size).toBe(1);
  });
});

describe('one connection serves a bounded number of requests (review round 1, finding 2)', () => {
  it('the last answer on a connection says "Connection: close", and the client connects again', async () => {
    const https = await import('node:https');
    const share = makeShare();
    const W = await makeWorld({ door: 'outside', share, limits: { requestsPerConnection: 3 } });
    const agent = new https.Agent({ keepAlive: true, maxSockets: 1 });
    try {
      const seen = [];
      for (let i = 0; i < 4; i++) {
        const r = await W.request(W.clipUrl(W.ticket()), { headers: { range: 'bytes=0-0' }, agent });
        seen.push([r.status, r.headers.connection]);
      }
      expect(seen.map((x) => x[0])).toEqual([206, 206, 206, 206]);
      expect(seen[2][1]).toBe('close');
      expect(seen[0][1]).toBe('keep-alive');
    } finally {
      agent.destroy();
      await W.close();
      share.cleanup();
    }
  });
});
