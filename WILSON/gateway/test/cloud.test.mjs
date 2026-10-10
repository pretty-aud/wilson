// =============================================================================
// cloud.test.mjs — the cloud client's checks of every answer (client.mjs), the
// sync loop's rules (sync.mjs: never two calls at once, at most 100 confirms a
// call, on-demand calls held to 25 a minute), reach per location (reach.mjs),
// and the update client (platform/updates.mjs) with injected keys.
// =============================================================================

import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CloudClient, normalizeCloudUrl, cleanOrigins, cleanOutsideAddress, cleanEnrolAnswer, cleanSyncAnswer, MAX_ANSWER_BYTES } from '../src/cloud/client.mjs';
import { SyncLoop } from '../src/cloud/sync.mjs';
import { ReachChecker } from '../src/cloud/reach.mjs';
import { Updates } from '../src/platform/updates.mjs';
import { makeCredential } from '../src/wire/formats.mjs';
import { makeSigningKey } from './mint.mjs';

const UUID = '6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f601';
const WS = '0a1b2c3d-4e5f-4a6b-9c7d-8e9fa0b1c2d3';

describe('the cloud\'s address and the answers\' shapes (client.mjs)', () => {
  it('https only, no credentials, query or fragment, no trailing slash', () => {
    expect(normalizeCloudUrl('https://x.supabase.co/functions/v1/')).toBe('https://x.supabase.co/functions/v1');
    for (const bad of ['http://x.supabase.co/functions/v1', 'https://user:pw@x.co/f', 'https://x.co/f?a=1', 'https://x.co/f#h', 'ftp://x', '', null]) expect(normalizeCloudUrl(bad), String(bad)).toBeNull();
  });
  it('the web app\'s origins: https ones and the developer\'s loopback; nothing else', () => {
    expect(cleanOrigins(['https://wilson.petalstudios.com', 'http://localhost:5289', 'http://127.0.0.1:4173', 'http://evil.example', 'https://x.co/path', 'javascript:alert(1)', 7])).toEqual(['https://wilson.petalstudios.com', 'http://localhost:5289', 'http://127.0.0.1:4173']);
    expect(cleanOrigins('https://x.co')).toEqual([]);
  });
  it('the outside address: a host name or an address literal, a port 1–65535', () => {
    expect(cleanOutsideAddress({ host: 'gateway.example.com', port: 8444 })).toEqual({ host: 'gateway.example.com', port: 8444 });
    expect(cleanOutsideAddress({ host: '203.0.113.7', port: 443 })).toEqual({ host: '203.0.113.7', port: 443 });
    for (const bad of [{ host: 'x', port: 0 }, { host: 'x', port: 70000 }, { host: 'a b', port: 1 }, { host: '', port: 1 }, null, 'x:1']) expect(cleanOutsideAddress(bad)).toBeNull();
  });
  it('the enrol answer: its credential must be the wire\'s shape; the workspace is named', () => {
    const key = makeSigningKey('k1');
    const good = { gateway_id: UUID, credential: makeCredential(), workspace_id: WS, workspace_name: 'Salt Hours', signing_keys: [key.wire, { kid: 'BAD', public_key: 'x' }], web_app_origins: ['https://a.co'], sync_interval_s: 500 };
    const r = cleanEnrolAnswer(good);
    expect(r.ok).toBe(true);
    expect(r.value).toMatchObject({ gatewayId: UUID, workspaceId: WS, workspaceName: 'Salt Hours', origins: ['https://a.co'], syncIntervalS: 60 });
    expect(r.value.signingKeys.map((k) => k.kid)).toEqual(['k1']);
    expect(r.dropped).toEqual(['signing_keys[]']);
    expect(cleanEnrolAnswer({ ...good, credential: 'wgc_short' })).toEqual({ ok: false, reason: 'credential' });
    expect(cleanEnrolAnswer({ ...good, credential: 'wgt_' + 'A'.repeat(32) })).toEqual({ ok: false, reason: 'credential' });
    expect(cleanEnrolAnswer({ ...good, gateway_id: 'nope' })).toEqual({ ok: false, reason: 'gateway_id' });
    expect(cleanEnrolAnswer({ ...good, workspace_id: undefined }).value.workspaceId).toBeNull();
  });
  it('the sync answer: the switch reads ON only for `true`; every field checked; a bad one dropped', () => {
    const v = (a) => cleanSyncAnswer(a).value;
    for (const on of [true]) expect(v({ remote_viewing: on }).remoteViewing).toBe(true);
    for (const off of ['true', 1, 'yes', {}, undefined, null]) expect(v({ remote_viewing: off }).remoteViewing, String(off)).toBe(false);
    const a = cleanSyncAnswer({ remote_viewing: true, bin_locations: [{ id: UUID, unc_path: '\\\\nas\\footage', name: 'Footage' }, { id: 'x', unc_path: 7 }], confirmed: [UUID, 'nope'], minimum_version: '1.2.3', hard_minimum_version: 'one', reach_nonce: 'short', renamed: '  Studio NAS  ' });
    expect(a.value).toMatchObject({ locations: [{ id: UUID, unc: '\\\\nas\\footage', name: 'Footage' }], confirmed: [UUID], minimumVersion: '1.2.3', hardMinimumVersion: null, reachNonce: null, renamed: 'Studio NAS' });
    expect(a.dropped).toEqual(['bin_locations[]', 'hard_minimum_version']);
    expect(v({ signing_keys: undefined }).keysPresent).toBe(false);
  });
  it('a location whose address is no share is dropped and named (review round 1, finding 1); the cloud\'s words lose every control character (finding 3)', () => {
    const U = (n) => `aaaaaaaa-bbbb-4ccc-8ddd-${String(n).padStart(12, '0')}`;
    const bad = ['\\\\?\\C:\\Windows', '\\\\?\\GLOBALROOT\\Device\\HarddiskVolume3\\Users', '\\\\evil.example.com@SSL@443\\DavWWWRoot\\share', 'C:\\footage', '\\\\nas\\C$.', '\\\\nas\\foot\u001bage'];
    const a = cleanSyncAnswer({ bin_locations: [{ id: U(0), unc_path: '\\\\nas\\footage', name: 'Foot\u001b]0;pwned\u0007age\r\nfake line' }, ...bad.map((unc, i) => ({ id: U(i + 1), unc_path: unc }))], renamed: 'Studio\u001b]0;pwned\u0007NAS\r\nfake line\u202e' });
    expect(a.value.locations).toEqual([{ id: U(0), unc: '\\\\nas\\footage', name: 'Foot ]0;pwned age fake line' }]);
    expect(a.dropped).toEqual(bad.map((_, i) => `bin_locations[${U(i + 1)}] (not a share address)`));
    expect(a.value.renamed).toBe('Studio ]0;pwned NAS fake line');
    expect(cleanSyncAnswer({ renamed: '\u0007\u200b ' }).value.renamed).toBeNull();
    const e = cleanEnrolAnswer({ gateway_id: U(9), credential: makeCredential(), workspace_name: 'Salt\u001b[2JHours\u0085Studio' });
    expect(e.value.workspaceName).toBe('Salt [2JHours Studio');
  });
  it('the cloud\'s words for a refusal lose every control character before anyone prints them (review round 2, R2-3)', async () => {
    const answer = (status) => async () => new Response(JSON.stringify({ error: 'Refused\u001b]0;pwned\u0007\r\nfake line‮', code: 'bad\u001b[2J' }), { status });
    for (const status of [400, 401]) {
      const c = new CloudClient({ baseUrl: 'https://x.co/functions/v1', credential: () => 'wgc_cred', fetchImpl: answer(status) });
      const r = await c.call('gateway-enrol', {});
      expect(r.ok, String(status)).toBe(false);
      expect(r.error, String(status)).toBe('Refused ]0;pwned fake line');
      expect(r.code, String(status)).toBe('bad [2J');
    }
  });
  it('a call: Bearer, JSON, no redirects, a time limit; 401 is "forgotten", 5xx and the network "unreachable"', async () => {
    let seen = null;
    const fetchImpl = async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({ ok: 1 }), { status: 200 }); };
    const c = new CloudClient({ baseUrl: 'https://x.co/functions/v1', credential: () => 'wgc_cred', fetchImpl });
    expect(await c.sync({ a: 1 })).toEqual({ ok: true, status: 200, data: { ok: 1 } });
    expect(seen.url).toBe('https://x.co/functions/v1/gateway-sync');
    expect(seen.init).toMatchObject({ method: 'POST', redirect: 'error', headers: { authorization: 'Bearer wgc_cred', 'content-type': 'application/json' } });
    expect(seen.init.signal).toBeInstanceOf(AbortSignal);
    const statusOf = (status, body = {}) => new CloudClient({ baseUrl: 'https://x.co/f', fetchImpl: async () => new Response(JSON.stringify(body), { status }) }).sync({});
    expect(await statusOf(401, { error: 'gone', code: 'unknown_gateway' })).toMatchObject({ ok: false, status: 401, revoked: true });
    expect(await statusOf(503)).toMatchObject({ ok: false, unreachable: true });
    expect(await statusOf(400, { error: 'bad' })).toMatchObject({ ok: false, unreachable: false, error: 'bad' });
    const down = new CloudClient({ baseUrl: 'https://x.co/f', fetchImpl: async () => { throw new TypeError('fetch failed'); } });
    expect(await down.sync({})).toMatchObject({ ok: false, status: 0, unreachable: true });
    expect(() => new CloudClient({ baseUrl: 'http://x.co/f' })).toThrow(/https/);
  });
  it('an answer over 1 MB is not read', async () => {
    const big = 'x'.repeat(MAX_ANSWER_BYTES + 10);
    const c = new CloudClient({ baseUrl: 'https://x.co/f', fetchImpl: async () => new Response(JSON.stringify({ big }), { status: 200 }) });
    expect(await c.sync({})).toMatchObject({ ok: false, unreachable: true, error: 'ETOOBIG' });
  });
});

describe('the sync loop (sync.mjs)', () => {
  const answer = (confirmedFrom) => async (body) => ({ ok: true, status: 200, data: { confirmed: confirmedFrom ? body.confirm.map((c) => c.clip) : [] } });
  it('calls never overlap: what is asked while one runs rides the next', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let calls = 0;
    const loop = new SyncLoop({
      call: async (body) => { inFlight++; calls++; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise((r) => setTimeout(r, 20)); inFlight--; return answer(true)(body); },
      report: () => ({}), onResult: () => {}, intervalMs: () => 3_600_000,
    });
    loop.stopped = false;
    await Promise.all([loop.requestNow(), loop.requestNow(), loop.confirm([{ clip: 'a', loc: 'l', path: 'p' }]), loop.requestNow()]);
    loop.stop();
    expect(maxInFlight).toBe(1);
    expect(calls).toBeLessThanOrEqual(2);
  });
  it('at most 100 confirms a call, however many wait while one runs', async () => {
    const sizes = [];
    let release;
    const first = new Promise((r) => { release = r; });
    let calls = 0;
    const loop = new SyncLoop({
      call: async (body) => { calls++; if (calls === 1) await first; sizes.push(body.confirm.length); return answer(true)(body); },
      report: () => ({}), onResult: () => {}, intervalMs: () => 3_600_000,
    });
    loop.stopped = false;
    const items = (n, p) => Array.from({ length: n }, (_, i) => ({ clip: `${p}${i}`, loc: 'l', path: 'p' }));
    const blocker = loop.requestNow(); // holds the first call open…
    await new Promise((r) => setTimeout(r, 10));
    const waiting = [loop.confirm(items(60, 'a')), loop.confirm(items(60, 'b')), loop.confirm(items(30, 'c'))]; // …while 150 pile up
    release();
    const results = await Promise.all(waiting);
    await blocker;
    loop.stop();
    expect(sizes[0]).toBe(0); // the blocked call carried none
    expect(Math.max(...sizes)).toBeLessThanOrEqual(100);
    expect(sizes.slice(1)).toEqual([60, 90]);
    expect(results.map((r) => r.confirmed.length)).toEqual([60, 60, 30]);
  });
  it('on-demand calls beyond the heartbeat are held to 25 a minute', async () => {
    let calls = 0;
    const loop = new SyncLoop({ call: async () => { calls++; return { ok: true, status: 200, data: {} }; }, report: () => ({}), onResult: () => {}, intervalMs: () => 3_600_000, now: () => 1_000 });
    loop.stopped = false;
    for (let i = 0; i < 30; i++) { const p = loop.requestNow(); if (i < 25) await p; }
    await new Promise((r) => setTimeout(r, 50));
    loop.stop();
    expect(calls).toBe(25);
  });
  it('a confirm while the cloud is unreachable answers reached: false', async () => {
    const loop = new SyncLoop({ call: async () => ({ ok: false, status: 0, unreachable: true }), report: () => ({}), onResult: () => {}, intervalMs: () => 3_600_000 });
    loop.stopped = false;
    expect(await loop.confirm([{ clip: 'a', loc: 'l', path: 'p' }])).toEqual({ reached: false, confirmed: [] });
    loop.stop();
  });
});

describe('reach per location (reach.mjs)', () => {
  const loc = (id, unc) => ({ id, unc });
  it('container: a folder is reachable, a missing mount is not_mounted, anything else not_reachable', async () => {
    const answers = { '/locations/nas/footage': 'dir', '/locations/nas/archive': 'E:ENOENT', '/locations/nas/grade': 'timeout' };
    const r = new ReachChecker({ platform: 'container', ask: async (root) => answers[root] });
    const out = await r.check([loc('a', '\\\\NAS\\Footage'), loc('b', '\\\\nas\\archive'), loc('c', '\\\\nas\\grade'), loc('d', '\\\\nas\\..\\x')]);
    expect(Object.fromEntries([...out].map(([k, v]) => [k, v.state]))).toEqual({ a: 'reachable', b: 'not_mounted', c: 'not_reachable', d: 'not_mounted' });
  });
  it('Windows: refused with no login held is not_connected (run share-login); with one, not_reachable', async () => {
    const r = new ReachChecker({ platform: 'windows', ask: async () => 'E:EACCES', hasShareLogin: (h) => h === 'nas2' });
    const out = await r.check([loc('a', '\\\\nas1\\footage'), loc('b', '\\\\NAS2\\footage')]);
    expect(out.get('a').state).toBe('not_connected');
    expect(out.get('b').state).toBe('not_reachable');
  });
  it('Windows: a server this gateway may not contact yet is not_connected WITHOUT being asked (review round 1, finding 2)', async () => {
    const asked = [];
    const r = new ReachChecker({ platform: 'windows', ask: async (root) => { asked.push(root); return 'dir'; }, mayContact: (unc) => unc.toLowerCase().startsWith('\\\\nas\\') });
    const out = await r.check([loc('a', '\\\\evil.example.com\\share'), loc('b', '\\\\NAS\\footage'), loc('c', '\\\\8.8.8.8\\x')]);
    expect(Object.fromEntries([...out].map(([k, v]) => [k, v.state]))).toEqual({ a: 'not_connected', b: 'reachable', c: 'not_connected' });
    expect(asked).toEqual(['\\\\NAS\\footage']);
  });
  it('one question per root at a time, and "since" kept while it stays down', async () => {
    let asked = 0;
    let t = 1_000;
    let release;
    const gate = new Promise((r) => { release = r; });
    const r = new ReachChecker({ platform: 'container', ask: async () => { asked++; await gate; return 'timeout'; }, now: () => t });
    const p = r.check([loc('a', '\\\\nas\\footage'), loc('b', '\\\\nas\\footage')]);
    await new Promise((res) => setTimeout(res, 10));
    expect(asked).toBe(1);
    release();
    const out = await p;
    expect(out.get('a')).toMatchObject({ state: 'not_reachable', since: 1_000 });
    t = 9_000;
    expect((await r.check([loc('a', '\\\\nas\\footage')])).get('a').since).toBe(1_000);
  });
  it('a real worker answers for a real folder and a missing one (the root as data, never code)', async () => {
    const { askRootInWorker } = await import('../src/cloud/reach.mjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw2-reach-'));
    try {
      expect(await askRootInWorker(dir)).toBe('dir');
      expect(await askRootInWorker(path.join(dir, 'nope'))).toBe('E:ENOENT');
      expect(await askRootInWorker("'); process.exit(7); ('")).toMatch(/^E:/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('the update client (platform/updates.mjs)', () => {
  const release = crypto.generateKeyPairSync('ed25519');
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
  function channel({ artefact, version = '9.0.0', size, hash, platformKey = 'windows-x64' } = {}) {
    const art = artefact ?? Buffer.from('the release archive');
    const manifest = Buffer.from(JSON.stringify({ version, published_at: '2026-10-10T08:00:00Z', minimum_version: null, hard_minimum_version: null, artefacts: { 'windows-x64': { url: 'https://releases.example/wilson-gateway-9.0.0.tar.gz', sha256: hash ?? sha(art), size: size ?? art.length }, container: { image: 'x', digest: 'sha256:' + 'a'.repeat(64) } } }));
    const sig = crypto.sign(null, manifest, release.privateKey).toString('base64');
    const fetchImpl = async (url) => {
      if (url.endsWith('stable.json')) return new Response(manifest);
      if (url.endsWith('stable.json.sig')) return new Response(sig);
      if (url.endsWith('.tar.gz')) return new Response(art);
      return new Response('', { status: 404 });
    };
    void platformKey;
    return { fetchImpl, manifest, sig, art };
  }
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gw2-updates-'));
  it('no release key compiled in: updates are off and nothing is fetched', async () => {
    let fetched = 0;
    const u = new Updates({ platform: 'windows', stateDir: tmp(), version: '0.1.0', fetchImpl: async () => { fetched++; return new Response(''); } });
    expect(u.state()).toEqual({ state: 'disabled' });
    await u.check('test');
    expect(fetched).toBe(0);
  });
  it('container: a newer signed version is "available" (pull the image)', async () => {
    const { fetchImpl } = channel();
    const u = new Updates({ platform: 'container', stateDir: tmp(), version: '0.1.0', fetchImpl, keys: [release.publicKey] });
    expect(await u.check('test')).toEqual({ state: 'available', version: '9.0.0' });
  });
  it('Windows: downloaded into the gateway\'s own folder, size and hash checked, then ONE message to the updater', async () => {
    const dir = tmp();
    const { fetchImpl, art } = channel();
    const asked = [];
    const u = new Updates({ platform: 'windows', stateDir: dir, version: '0.1.0', fetchImpl, keys: [release.publicKey], askUpdater: async (m) => { asked.push(m); return { ok: true, accepted: true }; } });
    expect(await u.check('test')).toEqual({ state: 'updating', version: '9.0.0' });
    expect(fs.readFileSync(path.join(dir, 'updates', 'wilson-gateway-9.0.0.tar.gz')).equals(art)).toBe(true);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ type: 'swap', artefact: 'wilson-gateway-9.0.0.tar.gz' });
    expect(fs.readdirSync(path.join(dir, 'updates'))).toEqual(['wilson-gateway-9.0.0.tar.gz']); // no .part left
  });
  it('a download that is not the named artefact (hash, or larger than the manifest says) is refused, deleted, and the updater is not asked', async () => {
    for (const bad of [{ hash: 'b'.repeat(64) }, { size: 3 }]) {
      const dir = tmp();
      const { fetchImpl } = channel(bad);
      const asked = [];
      const u = new Updates({ platform: 'windows', stateDir: dir, version: '0.1.0', fetchImpl, keys: [release.publicKey], askUpdater: async (m) => { asked.push(m); return { ok: true }; } });
      const s = await u.check('test');
      expect(s.state, JSON.stringify(bad)).toBe('failed');
      expect(asked).toEqual([]);
      expect(fs.existsSync(path.join(dir, 'updates')) ? fs.readdirSync(path.join(dir, 'updates')) : []).toEqual([]);
    }
  });
  it('a download that runs on past the manifest\'s size is cut at that size, not read to its end (a hostile mirror\'s endless body)', async () => {
    const dir = tmp();
    const { fetchImpl: base } = channel({ size: 4 * 1024 * 1024 });
    let pulled = 0;
    const endless = () => new ReadableStream({ pull(c) { pulled += 65536; c.enqueue(new Uint8Array(65536)); } });
    const fetchImpl = async (url) => (url.endsWith('.tar.gz') ? new Response(endless()) : base(url));
    const u = new Updates({ platform: 'windows', stateDir: dir, version: '0.1.0', fetchImpl, keys: [release.publicKey], askUpdater: async () => ({ ok: true }) });
    const s = await u.check('test');
    expect(s).toMatchObject({ state: 'failed', reason: 'larger than the manifest says' });
    expect(pulled).toBeLessThan(6 * 1024 * 1024);
  }, 15_000);
  it('not newer: up to date; a manifest signed by another key: refused and the state kept', async () => {
    const { fetchImpl } = channel({ version: '0.1.0' });
    expect(await new Updates({ platform: 'container', stateDir: tmp(), version: '0.1.0', fetchImpl, keys: [release.publicKey] }).check('t')).toEqual({ state: 'up_to_date' });
    const other = crypto.generateKeyPairSync('ed25519');
    expect(await new Updates({ platform: 'container', stateDir: tmp(), version: '0.1.0', fetchImpl: channel().fetchImpl, keys: [other.publicKey] }).check('t')).toEqual({ state: 'up_to_date' });
  });
  it('a failed swap reported by the updater is read at start', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'update-failed.json'), JSON.stringify({ version: '1.3.0', reason: 'the inside door could not bind' }));
    const u = new Updates({ platform: 'windows', stateDir: dir, version: '1.2.4', keys: [release.publicKey] });
    await u.readFailure();
    expect(u.state()).toEqual({ state: 'failed', version: '1.3.0', reason: 'the inside door could not bind' });
  });
});
