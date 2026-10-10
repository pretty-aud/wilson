// =============================================================================
// runtime.test.mjs — the gateway running in-process against the fake cloud
// (gateway/test/fakeCloud.mjs, Appendix C's shapes): enrolment once (the
// token spent), the sync's report, the switch's lifecycle end to end (§9
// point 4: the outside door bound only while the switch is on AND an outside
// address is set AND the cloud was seen within 60 s; closed and measured the
// moment one stops), the minimum version, a 401 closing both doors, a rotated
// key fetched by one extra sync, the catalogue check, the events batch and the
// journal emptied by the acknowledgement.
//
// The outside door listens with `outside.behind_local_proxy` (loopback only),
// so this suite binds no LAN address; the inside door never binds loopback at
// all, which is itself proved here.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import net from 'node:net';
import { Gateway } from '../src/runtime.mjs';
import { createFakeCloud, FAKE_BASE } from './fakeCloud.mjs';
import { makeShare, SUB, SUB2, CLIP, CLIP2, LOC } from './harness.mjs';
import { VERSION } from '../src/version.mjs';

const LOOPBACK_ONLY = { 'Loopback Pseudo-Interface 1': [{ address: '127.0.0.1', family: 'IPv4', internal: true, cidr: '127.0.0.1/8' }, { address: '::1', family: 'IPv6', internal: true, cidr: '::1/128' }] };
const plainSecrets = { kind: 'file', protect: async (b) => Buffer.concat([Buffer.from('WGPLAIN1'), Buffer.from(b)]), unprotect: async (b) => Buffer.from(b).subarray(8), status: () => ({ dpapi: null, reason: null }) };

async function waitFor(fn, ms = 5_000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

let share;
beforeAll(() => { share = makeShare(); });
afterAll(() => { share.cleanup(); });

// The test share's server is one this gateway may contact (on Windows: as an
// administrator's share login would make it); gw: other Gateway options.
const NAS_LOGIN = { has: (h) => h === 'nas', list: () => [], dialects: async () => [] };
async function world({ config = {}, token = true, clock = { offset: 0 }, cloudOpts = {}, beforeStart = null, gw: gwOpts = {} } = {}) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw2-state-'));
  fs.writeFileSync(path.join(stateDir, 'config.json'), JSON.stringify({ outside: { port: 0, behind_local_proxy: true }, ...config }));
  const now = () => Date.now() + clock.offset;
  const cloud = createFakeCloud({ now, ...cloudOpts });
  cloud.addLocation({ id: LOC, unc_path: '\\\\nas\\footage', name: 'Footage' });
  cloud.addClip(CLIP, { loc: LOC, path: 'A001/clip.mp4', seq: false, mt: 'video/mp4' });
  cloud.addMember(SUB);
  cloud.addMember(SUB2);
  if (beforeStart) beforeStart(cloud);
  const lines = [];
  const env = { WILSON_CLOUD_URL: cloud.base };
  if (token) env.WILSON_ENROL_TOKEN = typeof token === 'string' ? token : cloud.newToken();
  const gw = new Gateway({
    env, stateDir, now, hostname: 'studio-nas', fetchImpl: cloud.fetch, secrets: plainSecrets,
    netInterfaces: () => LOOPBACK_ONLY, print: (l) => lines.push(l),
    locationRootFor: () => share.root, shareLogins: NAS_LOGIN,
    tickMs: 3_600_000, addressMs: 3_600_000, eventsMs: 3_600_000, statusMs: 3_600_000, enrolPollMs: 3_600_000,
    ...gwOpts,
  });
  await gw.start();
  const get = (urlPath, { headers = {}, method = 'GET' } = {}) => new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port: gw.outsidePort, path: urlPath, method, rejectUnauthorized: false, headers }, (res) => {
      const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c) }));
    });
    req.on('error', reject);
    req.end();
  });
  const close = async () => { await gw.stop(); fs.rmSync(stateDir, { recursive: true, force: true }); };
  return { gw, cloud, lines, stateDir, clock, get, close };
}

const switchOn = async (W) => {
  W.cloud.state.switchOn = true;
  W.cloud.state.outsideAddress = { host: '127.0.0.1', port: 8444 };
  await W.gw.syncNow();
  await waitFor(() => W.gw.outsideState === 'open');
};

describe('enrolment (§2)', () => {
  it('the container\'s token at first start: enrolled once, the token spent, the fingerprint printed, the credential kept', async () => {
    const W = await world();
    try {
      expect(fs.existsSync(path.join(W.stateDir, 'credential.bin'))).toBe(true);
      const st = JSON.parse(fs.readFileSync(path.join(W.stateDir, 'state.json'), 'utf8'));
      expect(st).toMatchObject({ gateway_id: W.cloud.onlyGateway(), workspace_id: W.cloud.state.workspace.id, workspace_name: 'Salt Hours Studio', cloud_url: W.cloud.base });
      expect(W.lines.some((l) => /^Certificate fingerprint \(SHA-256\): ([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(l))).toBe(true);
      expect([...W.cloud.state.tokens.values()][0].usedAt).not.toBeNull();
      expect(fs.readFileSync(path.join(W.stateDir, 'credential.bin'), 'utf8')).not.toContain('wgc_' + 'x'); // not a plain wgc_ line for the eye
      const enrolBody = W.cloud.state.gateways.get(W.cloud.onlyGateway()).enrolBody;
      expect(enrolBody).toMatchObject({ name: 'studio-nas', hostname: 'studio-nas', version: VERSION, inside_addresses: [], inside_names: ['studio-nas', 'studio-nas.local'] });
      expect(enrolBody.root_cert_pem).toMatch(/BEGIN CERTIFICATE/);
      expect(enrolBody.root_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    } finally { await W.close(); }
  });
  it('a spent or malformed token is refused with a sentence, and nothing is kept', async () => {
    const W = await world({ token: false });
    try {
      expect(await W.gw.enrol('wgt_nope', null)).toEqual({ ok: false, error: expect.stringContaining('not an enrolment token') });
      const t = W.cloud.newToken();
      W.cloud.state.tokens.get([...W.cloud.state.tokens.keys()][0]).usedAt = Date.now();
      expect((await W.gw.enrol(t, W.cloud.base)).error).toMatch(/used already or is older than 24 hours/);
      expect(fs.existsSync(path.join(W.stateDir, 'state.json'))).toBe(false);
      expect((await W.gw.enrol(W.cloud.newToken(), 'http://insecure.example/functions/v1')).error).toMatch(/https/);
    } finally { await W.close(); }
  });
  it('the command\'s one-shot enrolment (enrolOnly) makes no bind attempt, no sync and no status; a normal start does try to bind', async () => {
    // An office address this computer does not have: a bind attempt fails (EADDRNOTAVAIL) and is logged,
    // so the control below can see an attempt without anything being bound.
    const notHere = () => ({ Ethernet: [{ address: '192.168.77.5', family: 'IPv4', internal: false, cidr: '192.168.77.5/24' }] });
    for (const enrolOnly of [true, false]) {
      const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw2-enrolonly-'));
      const cloud = createFakeCloud();
      const lines = [];
      const gw = new Gateway({ env: { WILSON_CLOUD_URL: cloud.base }, stateDir, hostname: 'studio-nas', fetchImpl: cloud.fetch, secrets: plainSecrets, netInterfaces: notHere, print: (l) => lines.push(l), enrolOnly, tickMs: 3_600_000, addressMs: 3_600_000, eventsMs: 3_600_000, statusMs: 3_600_000, enrolPollMs: 3_600_000 });
      try {
        await gw.start();
        expect((await gw.enrol(cloud.newToken(), cloud.base)).ok).toBe(true);
        const tried = lines.some((l) => / inside_(open|bind_failed) /.test(l));
        if (enrolOnly) {
          expect(tried).toBe(false);
          expect(gw.insideServers.size).toBe(0);
          expect(fs.existsSync(path.join(stateDir, 'status.json'))).toBe(false);
          expect(cloud.state.calls.filter((c) => c.fn === 'gateway-sync')).toHaveLength(0);
        } else {
          expect(tried).toBe(true); // the control: a running gateway does open its office door
        }
      } finally {
        await gw.stop();
        fs.rmSync(stateDir, { recursive: true, force: true });
      }
    }
  });
  it('an enrolled gateway refuses a second enrolment', async () => {
    const W = await world();
    try { expect((await W.gw.enrol(W.cloud.newToken(), W.cloud.base)).error).toMatch(/already enrolled/); } finally { await W.close(); }
  });
});

describe('the sync\'s report and the doors\' states', () => {
  it('reports its version, addresses, doors, certificate and the root\'s PEM once', async () => {
    const W = await world();
    try {
      await waitFor(() => W.cloud.lastReport());
      const r = W.cloud.lastReport();
      expect(r).toMatchObject({ name: 'studio-nas', version: VERSION, platform: process.platform === 'win32' ? 'windows' : 'container', hostname: 'studio-nas', inside_addresses: [], health: { doors: { inside: 'closed_no_address', outside: 'closed_switch_off', refused_public: 0, inside_bound: [], relay_warning: null }, update: 'disabled', cloud: FAKE_BASE, smb_dialect: null, minimum_version_ok: null, certificate: { kind: 'gateway', outside: 'gateway', expires_warning: null } } });
      expect(r.health.certificate.leaf_not_after).toMatch(/^\d{4}-\d\d-\d\dT/);
      expect(r.health.certificate.root_not_after).toMatch(/^\d{4}-\d\d-\d\dT/);
      expect(r.root_cert_pem).toMatch(/BEGIN CERTIFICATE/);
      expect(r.health.line).toContain('office door closed (no office network address)');
      await W.gw.syncNow();
      expect(W.cloud.lastReport().root_cert_pem).toBeUndefined();
    } finally { await W.close(); }
  });
  it('the inside door never binds loopback: only loopback here, so it stays closed, and a loopback pin is refused', async () => {
    const W = await world({ config: { inside: { addresses: ['127.0.0.1'] } } });
    try {
      expect(W.gw.insideServers.size).toBe(0);
      const status = JSON.parse(fs.readFileSync(path.join(W.stateDir, 'status.json'), 'utf8'));
      expect(status.doors.inside.refused).toContainEqual({ iface: 'pinned', address: '127.0.0.1', reason: 'not private (loopback)' });
    } finally { await W.close(); }
  });
  it('office ranges are applied and echoed, the refused ones named', async () => {
    const W = await world();
    try {
      W.cloud.state.officeRanges = ['10.8.0.0/24', '0.0.0.0/0'];
      await W.gw.syncNow();
      await W.gw.syncNow();
      expect(W.cloud.lastReport().health).toMatchObject({ office_ranges_applied: ['10.8.0.0/24'], office_ranges_refused: [{ range: '0.0.0.0/0', reason: 'not_private' }] });
    } finally { await W.close(); }
  });
  it('the report has the shape GW1\'s gateway-sync reads, field by field (its parseSyncRequest keeps every value)', async () => {
    // GW1's parser (origin/po/gw1-gateway-cloud 376c4b25, gatewayShapes.ts)
    // drops a field whose type or size it does not take; these are its rules.
    const str = (n) => (v) => typeof v === 'string' && v.length <= n;
    const strOrNull = (n) => (v) => v === null || str(n)(v);
    const int = (v) => Number.isInteger(v) && v >= 0;
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const keeps = (r) => {
      const h = r.health;
      const d = h.doors;
      const c = h.certificate;
      return {
        name: str(80)(r.name),
        version: typeof r.version === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+/.test(r.version),
        hostname: str(255)(r.hostname),
        inside_addresses: Array.isArray(r.inside_addresses) && r.inside_addresses.every((a) => typeof a.host === 'string' && Number.isInteger(a.port)),
        reach: Object.entries(r.reach).every(([k, v]) => UUID.test(k) && ['reachable', 'not_reachable', 'not_mounted', 'not_connected'].includes(v)),
        'doors.inside': str(64)(d.inside),
        'doors.outside': str(64)(d.outside),
        'doors.refused_public': int(d.refused_public),
        'doors.inside_bound': Array.isArray(d.inside_bound) && d.inside_bound.every(str(60)),
        'doors.relay_warning': d.relay_warning === null || (str(45)(d.relay_warning.address) && int(d.relay_warning.viewers)),
        update: str(128)(h.update),
        'certificate.leaf_not_after': strOrNull(40)(c.leaf_not_after),
        'certificate.root_not_after': strOrNull(40)(c.root_not_after),
        'certificate.outside': strOrNull(40)(c.outside),
        'certificate.expires_warning': strOrNull(120)(c.expires_warning),
        office_ranges_applied: Array.isArray(h.office_ranges_applied) && h.office_ranges_applied.every(str(49)),
        cloud: str(255)(h.cloud),
        smb_dialect: strOrNull(16)(h.smb_dialect),
        minimum_version_ok: h.minimum_version_ok === null || typeof h.minimum_version_ok === 'boolean',
      };
    };
    const W = await world();
    try {
      W.cloud.state.officeRanges = ['10.8.0.0/24'];
      W.cloud.state.minimumVersion = '0.0.1';
      W.gw.smbDialects = [{ unc: '\\nas\footage', dialect: '3.1.1' }, { unc: '\\old\share', dialect: '2.1' }];
      await switchOn(W);
      await waitFor(() => W.gw.locations.get(LOC) && W.gw.locations.get(LOC).state !== 'unknown'); // the share named and checked once
      await W.gw.syncNow();
      const r = W.cloud.lastReport();
      for (const [field, ok] of Object.entries(keeps(r))) expect(ok, `${field}: ${JSON.stringify(field.split('.').reduce((o, k) => o?.[k], { ...r, ...r.health, ...r.health }))}`).toBe(true);
      expect(r.health.doors.outside).toBe(`open:${W.gw.outsidePort}`);
      expect(r.health.smb_dialect).toBe('2.1');
      expect(r.health.minimum_version_ok).toBe(true);
      expect(r.reach).toEqual({ [LOC]: expect.any(String) });
    } finally { await W.close(); }
  });
  it('a location not checked yet is left out of the report\'s reach (GW1 takes the four words only)', async () => {
    const W = await world();
    try {
      await waitFor(() => W.gw.locations.get(LOC)); // the first sync's answer named it
      let next = 'unknown'; // every check from here answers what the test says
      W.gw.reach.check = async (list) => new Map(list.map((l) => [l.id, { state: next, since: null }]));
      await Promise.all([...W.gw.reachRuns]); // and the real ones already started have landed
      W.gw.locations.get(LOC).state = 'unknown';
      await W.gw.syncNow();
      expect(W.cloud.lastReport().reach).toEqual({});
      next = 'not_connected';
      W.gw.locations.get(LOC).state = 'not_connected';
      await W.gw.syncNow();
      expect(W.cloud.lastReport().reach).toEqual({ [LOC]: 'not_connected' });
    } finally { await W.close(); }
  });
  it('a rename in Settings: the gateway takes the name, reports it, and the cloud stops naming it', async () => {
    const W = await world();
    try {
      await W.gw.syncNow();
      expect(W.cloud.lastReport().name).toBe('studio-nas');
      W.cloud.state.renamed = 'Studio NAS';
      await W.gw.syncNow();
      expect(W.gw.healthState().name).toBe('Studio NAS');
      await W.gw.syncNow();
      expect(W.cloud.lastReport().name).toBe('Studio NAS');
    } finally { await W.close(); }
  });
});

describe('the switch, end to end (§9 point 4)', () => {
  it('off: the outside port is not bound; on with an address: it opens and serves; off again: closed at once and refused', async () => {
    const W = await world();
    try {
      await W.gw.syncNow();
      expect(W.gw.outsideState).toBe('closed_switch_off');
      expect(W.gw.outsidePort).toBeNull();
      W.cloud.state.switchOn = true;
      await W.gw.syncNow();
      expect(W.gw.outsideState).toBe('closed_no_address');
      await switchOn(W);
      const port = W.gw.outsidePort;
      const t = W.cloud.mint({ clip: CLIP, sub: SUB });
      const r = await W.get(`/v1/clips/${CLIP}?t=${t}`, { headers: { range: 'bytes=0-99' } });
      expect(r.status).toBe(206);
      expect(r.body.equals(share.clipBytes.subarray(0, 100))).toBe(true);
      W.cloud.state.switchOn = false;
      await W.gw.syncNow();
      await waitFor(() => W.gw.outsideState === 'closed_switch_off');
      const refused = await new Promise((res) => { const s = net.connect(port, '127.0.0.1'); s.once('error', (e) => res(e.code)); s.once('connect', () => { s.destroy(); res('connected'); }); });
      expect(refused).toBe('ECONNREFUSED');
      const status = await W.gw.health();
      expect(status.doors.outside.state).toBe('closed_switch_off');
    } finally { await W.close(); }
  });
  it('a ticket minted while the switch was off (rv false) is refused on the outside door', async () => {
    const W = await world();
    try {
      await switchOn(W);
      const t = W.cloud.mint({ clip: CLIP, sub: SUB, rv: false });
      expect((await W.get(`/v1/clips/${CLIP}?t=${t}`, { headers: { range: 'bytes=0-0' } })).status).toBe(401);
    } finally { await W.close(); }
  });
  it('no cloud for 60 s closes the outside door (D15), and it opens again when the cloud is back', async () => {
    const W = await world();
    try {
      await switchOn(W);
      // No successful sync for 61 s (the heartbeat's own timer is ten seconds of
      // real time away; the clock is moved, not waited).
      W.clock.offset += 61_000;
      await W.gw.tickNow();
      expect(W.gw.outsideState).toBe('closed_no_cloud');
      W.clock.offset = 0;
      await W.gw.syncNow();
      await waitFor(() => W.gw.outsideState === 'open');
    } finally { await W.close(); }
  });
  it('below minimum_version the outside door closes with its sentence; the office is untouched', async () => {
    const W = await world();
    try {
      await switchOn(W);
      W.cloud.state.minimumVersion = '99.0.0';
      await W.gw.syncNow();
      await waitFor(() => W.gw.outsideState === 'closed_minimum_version');
      expect(W.gw.healthLine().text).toContain('below 99.0.0 for viewing from outside');
    } finally { await W.close(); }
  });
  it('a 401 on sync (Forget) closes both doors and says so', async () => {
    const W = await world();
    try {
      await switchOn(W);
      W.cloud.revoke();
      await W.gw.syncNow();
      await waitFor(() => W.gw.outsideState === 'closed_revoked');
      expect(W.gw.healthLine().warnings.map((w) => w.text)).toContain('WILSON has forgotten this gateway (its sign-in was refused): enrol it again');
    } finally { await W.close(); }
  });
});

describe('tickets at the running gateway', () => {
  it('a rotated key: the first ticket with the new kid makes one extra sync and is served', async () => {
    const W = await world();
    try {
      await switchOn(W);
      W.cloud.rotateKey('k2026b');
      const t = W.cloud.mint({ clip: CLIP, sub: SUB, kid: 'k2026b' });
      const before = W.cloud.state.calls.filter((c) => c.fn === 'gateway-sync').length;
      expect((await W.get(`/v1/clips/${CLIP}?t=${t}`, { headers: { range: 'bytes=0-0' } })).status).toBe(206);
      expect(W.cloud.state.calls.filter((c) => c.fn === 'gateway-sync').length).toBeGreaterThan(before);
    } finally { await W.close(); }
  });
  it('Windows: a share server without an administrator\'s consent is never contacted, its clips 404 (review round 1, finding 2); listed in connect_without_login, it serves', async () => {
    const noLogin = { has: () => false, list: () => [], dialects: async () => [] };
    const W = await world({ gw: { platform: 'win32', shareLogins: noLogin } });
    try {
      expect(W.gw.platform).toBe('windows');
      await switchOn(W);
      await waitFor(() => W.gw.locations.get(LOC) && W.gw.locations.get(LOC).state !== 'unknown');
      expect(W.gw.locations.get(LOC).state).toBe('not_connected');
      const r = await W.get(`/v1/clips/${CLIP}?t=${W.cloud.mint({ clip: CLIP, sub: SUB })}`, { headers: { range: 'bytes=0-0' } });
      expect(r.status).toBe(404);
      expect(r.body.length).toBe(0);
      expect(W.lines.some((l) => l.includes('clip_refused') && l.includes('location_not_connected'))).toBe(true);
      await W.gw.syncNow();
      expect(W.cloud.lastReport().reach).toEqual({ [LOC]: 'not_connected' });
    } finally { await W.close(); }
    const W2 = await world({ gw: { platform: 'win32', shareLogins: noLogin }, config: { connect_without_login: ['NAS'] } });
    try {
      await switchOn(W2);
      expect((await W2.get(`/v1/clips/${CLIP}?t=${W2.cloud.mint({ clip: CLIP, sub: SUB })}`, { headers: { range: 'bytes=0-0' } })).status).toBe(206);
    } finally { await W2.close(); }
  });
  it('the catalogue check: a clip the cloud does not hold is 404; the confirm rides a sync at once', async () => {
    const W = await world();
    try {
      await switchOn(W);
      W.cloud.addClip(CLIP2, { loc: LOC, path: 'A001/clip.mp4', seq: false, mt: 'video/mp4' });
      const t = W.cloud.mint({ clip: CLIP2, sub: SUB });
      W.cloud.state.files.delete(CLIP2); // removed from the catalogue after the mint
      const r = await W.get(`/v1/clips/${CLIP2}?t=${t}`, { headers: { range: 'bytes=0-0' } });
      expect([r.status, r.body.length]).toEqual([404, 0]);
      expect(W.cloud.state.calls.at(-1).body.confirm).toEqual([{ clip: CLIP2, loc: LOC, path: 'A001/clip.mp4' }]);
    } finally { await W.close(); }
  });
  it('a cloud that does not name the workspace: every ticket refused, and the log says why (the ws check needs it)', async () => {
    const W = await world({ beforeStart: (cloud) => { cloud.state.sendWorkspaceId = false; } });
    try {
      expect(JSON.parse(fs.readFileSync(path.join(W.stateDir, 'state.json'), 'utf8')).workspace_id).toBeNull();
      expect(W.lines.some((l) => l.includes('workspace_id_missing'))).toBe(true);
      await switchOn(W);
      const t = W.cloud.mint({ clip: CLIP, sub: SUB });
      expect((await W.get(`/v1/clips/${CLIP}?t=${t}`, { headers: { range: 'bytes=0-0' } })).status).toBe(401);
      // …and a later sync that names it repairs the gateway.
      W.cloud.state.sendWorkspaceId = true;
      await W.gw.syncNow();
      expect((await W.get(`/v1/clips/${CLIP}?t=${W.cloud.mint({ clip: CLIP, sub: SUB })}`, { headers: { range: 'bytes=0-0' } })).status).toBe(206);
    } finally { await W.close(); }
  });
});

describe('the container\'s own mount rule, end to end', () => {
  it('in the image, a location is read at /locations/<host>/<share>; missing, it is "not mounted" with the hint', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw2-image-'));
    fs.writeFileSync(path.join(stateDir, 'config.json'), JSON.stringify({ outside: { port: 0, behind_local_proxy: true } }));
    const cloud = createFakeCloud();
    cloud.addLocation({ id: LOC, unc_path: '\\\\NAS-01\\Archive\\Day 1', name: 'Archive' });
    const gw = new Gateway({ env: { WILSON_GATEWAY_IMAGE: '1', WILSON_CLOUD_URL: cloud.base, WILSON_ENROL_TOKEN: cloud.newToken() }, stateDir, hostname: 'nas-01', fetchImpl: cloud.fetch, secrets: plainSecrets, netInterfaces: () => LOOPBACK_ONLY, print: () => {}, tickMs: 3_600_000, addressMs: 3_600_000, eventsMs: 3_600_000, statusMs: 3_600_000, enrolPollMs: 3_600_000 });
    try {
      await gw.start();
      await gw.syncNow();
      await waitFor(async () => { await gw.syncNow(); return W2line(gw).includes('not mounted'); }, 8_000);
      expect(W2line(gw)).toContain('Archive: **not mounted** (mount the folder of \\\\NAS-01\\Archive\\Day 1 at /locations/nas-01/archive/Day 1)');
      expect(cloud.lastReport().reach).toEqual({ [LOC]: 'not_mounted' });
    } finally {
      await gw.stop();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
const W2line = (gw) => gw.healthLine().text;

describe('what is written down reaches the cloud (§6)', () => {
  it('an outside viewing: journal start and end, posted as one row, acknowledged, the journal emptied', async () => {
    const W = await world();
    try {
      await switchOn(W);
      const t = W.cloud.mint({ clip: CLIP, sub: SUB });
      await W.get(`/v1/clips/${CLIP}?t=${t}`, { headers: { range: 'bytes=0-1023', 'x-forwarded-for': '203.0.113.50' } });
      W.clock.offset += 61_000;
      await W.gw.tickNow();
      await waitFor(() => W.cloud.state.events.length === 1, 8_000);
      const e = W.cloud.state.events[0];
      expect(e).toMatchObject({ event: 'viewed_remote', clip: CLIP, sub: SUB, bytes: 1024, range_count: 1, first_offset: 0, last_offset: 1023, source_address: '203.0.113.50', via: 'local_proxy', unverified_mint: false, incomplete: false });
      expect(e.external_id).toBe(`${W.cloud.onlyGateway()}:${e.viewing_id}`);
      await waitFor(() => fs.readFileSync(path.join(W.stateDir, 'journal'), 'utf8') === '');
    } finally { await W.close(); }
  });
});
