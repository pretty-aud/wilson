// =============================================================================
// policy.test.mjs — the limits (D12), the health line (§8, verbatim), the
// user agent's family (§6) and the container's mount rule (§11, R15).
// =============================================================================

import { describe, it, expect } from 'vitest';
import { DEFAULT_LIMITS, resolveLimits, FixedWindow, Concurrency, Pools, peerLimiters } from '../src/rules/limits.mjs';
import { composeHealthLine, durationWords } from '../src/rules/health.mjs';
import { userAgentFamily } from '../src/rules/useragent.mjs';
import { parseUncPath, containerRootFor, locationRoot } from '../src/rules/mountRule.mjs';

describe('limits (D12)', () => {
  it('the defaults are the design\'s numbers', () => {
    expect(DEFAULT_LIMITS).toMatchObject({
      perPersonStreams: 8, perPersonRequestsPerMinute: 600, outsideBytesPerHourPerPerson: 30e9,
      outside: { newConnectionsPerMinutePerPeer: 60, handshakesPerSecondPerPeer: 20 },
      inside: { newConnectionsPerMinutePerPeer: 120, handshakesPerSecondPerPeer: 40 },
      connections: 400, streams: 200, insideReserve: 0.25,
      headerTimeoutMs: 10_000, handshakeTimeoutMs: 10_000, idleMs: 60_000, bodyBytes: 8192, streamMaxMs: 14_400_000,
    });
  });
  it('the config may change capacity; the security bounds may be lowered, never raised', () => {
    const { limits, ignored } = resolveLimits({ perPersonStreams: 4, connections: 1000, headerTimeoutMs: 60_000, idleMs: 5_000, bodyBytes: 1e9, streamMaxMs: 1e12, outside: { handshakesPerSecondPerPeer: 5 }, perPersonRequestsPerMinute: -1, insideReserve: 0.95 });
    expect(limits).toMatchObject({ perPersonStreams: 4, connections: 1000, headerTimeoutMs: 10_000, idleMs: 5_000, bodyBytes: 8192, streamMaxMs: 14_400_000, perPersonRequestsPerMinute: 600, insideReserve: 0.25 });
    expect(limits.outside.handshakesPerSecondPerPeer).toBe(5);
    expect(ignored).toEqual(['perPersonRequestsPerMinute', 'insideReserve']);
    expect(DEFAULT_LIMITS.perPersonStreams).toBe(8); // the defaults are not mutated
  });
  it('a fixed window refuses past its limit, says when to retry, and starts again', () => {
    let t = 0;
    const w = new FixedWindow({ limit: 3, windowMs: 60_000, now: () => t });
    expect([w.hit('a').ok, w.hit('a').ok, w.hit('a').ok]).toEqual([true, true, true]);
    expect(w.hit('a')).toEqual({ ok: false, retryAfterS: 60 });
    expect(w.hit('b').ok).toBe(true); // per key
    t = 45_000; expect(w.hit('a').retryAfterS).toBe(15);
    t = 60_000; expect(w.hit('a').ok).toBe(true);
    t = 200_000; w.prune(); expect(w.size).toBe(0);
  });
  it('bytes already sent are spent whatever the limit, and the window reports it is over', () => {
    let t = 0;
    const w = new FixedWindow({ limit: 100, windowMs: 3_600_000, now: () => t });
    expect(w.spend('p', 60)).toBe(false);
    expect(w.spend('p', 60)).toBe(true);
    expect(w.remaining('p')).toBe(0);
    expect(w.retryAfterS('p')).toBe(3600);
  });
  it('concurrency: at most the limit, released once, per key', () => {
    const c = new Concurrency({ limit: 2 });
    const r1 = c.acquire('p'); const r2 = c.acquire('p');
    expect(c.acquire('p')).toBeNull();
    r1(); r1(); // a double release frees one slot, not two
    expect(c.count('p')).toBe(1);
    expect(c.acquire('p')).not.toBeNull();
    r2();
  });
  it('the pools: 400 in all, the outside door at most three quarters, the inside reserve kept', () => {
    const p = new Pools({ connections: 8, streams: 4, insideReserve: 0.25 });
    for (let i = 0; i < 6; i++) expect(p.openConnection('outside')).toBe(true);
    expect(p.openConnection('outside')).toBe(false); // 6 = 8 × 0.75
    expect(p.openConnection('inside')).toBe(true);
    expect(p.openConnection('inside')).toBe(true);
    expect(p.openConnection('inside')).toBe(false); // 8 in all
    p.closeConnection('outside');
    expect(p.openConnection('inside')).toBe(true);
    expect(p.openStream('outside') && p.openStream('outside') && p.openStream('outside')).toBe(true);
    expect(p.openStream('outside')).toBe(false);
    expect(p.openStream('inside')).toBe(true);
  });
  it('per-peer limiters per door: the inside door is looser', () => {
    const l = peerLimiters(DEFAULT_LIMITS, () => 0);
    for (let i = 0; i < 20; i++) l.outside.handshakes.hit('203.0.113.1');
    expect(l.outside.handshakes.hit('203.0.113.1').ok).toBe(false);
    for (let i = 0; i < 39; i++) l.inside.handshakes.hit('192.168.1.5');
    expect(l.inside.handshakes.hit('192.168.1.5').ok).toBe(true);
  });
});

describe('the health line (§8)', () => {
  const NOW = Date.parse('2026-10-09T14:00:00Z');
  const example = {
    now: NOW, name: 'Studio NAS', version: '1.2.4', platform: 'container', lastSyncAt: NOW - 6_000,
    inside: { state: 'open', addresses: [{ address: '192.168.1.10', port: 8443 }] },
    outside: { state: 'closed_switch_off', port: 8444 },
    locations: [
      { name: 'Footage', state: 'reachable' },
      { name: 'Archive', state: 'not_mounted', hostFolder: '/volume1/archive', mountAt: '/locations/nas/archive' },
    ],
    certificate: { kind: 'gateway', leafUntil: Date.parse('2027-11-01T00:00:00Z'), rootUntil: Date.parse('2036-10-09T00:00:00Z') },
    update: { state: 'up_to_date' },
  };
  it('composes the design\'s example verbatim', () => {
    expect(composeHealthLine(example).text).toBe(
      '**Studio NAS** \u00b7 1.2.4 \u00b7 seen 6 s ago \u00b7 office door open (192.168.1.10:8443) \u00b7 outside door closed (the switch is off) \u00b7 Footage: reachable \u00b7 Archive: **not mounted** (mount /volume1/archive at /locations/nas/archive) \u00b7 certificate: renews itself (leaf until 2027-11-01; root until 2036-10-09) \u00b7 up to date');
  });
  it('seen: plain under 30 s, amber from 30 s, red from 5 minutes', () => {
    const seen = (age) => composeHealthLine({ ...example, lastSyncAt: NOW - age }).segments[4];
    expect(seen(29_000)).toEqual({ text: 'seen 29 s ago', tone: 'plain' });
    expect(seen(30_000)).toEqual({ text: 'not seen for 30 s', tone: 'amber' });
    expect(seen(4 * 60_000)).toEqual({ text: 'not seen for 4 minutes', tone: 'amber' });
    expect(seen(5 * 60_000).tone).toBe('red');
    expect(composeHealthLine({ ...example, lastSyncAt: null }).segments[4]).toEqual({ text: 'not seen yet', tone: 'amber' });
  });
  it('the outside door\'s states, in the design\'s words', () => {
    const o = (outside) => composeHealthLine({ ...example, outside }).text;
    expect(o({ state: 'closed_no_address' })).toContain('outside door closed (no outside address yet)');
    expect(o({ state: 'closed_no_cloud', noCloudForMs: 70_000 })).toContain('outside door closed (no cloud for 70 s)');
    expect(o({ state: 'open', port: 8444, reachOk: true, reachCheckedAt: NOW - 2 * 3_600_000 })).toContain('outside door open on 8444, reachable from the internet (checked 2 h ago)');
    expect(o({ state: 'open', port: 8444, reachOk: false })).toContain('outside door open on 8444, not reached yet: Check reach');
    expect(o({ state: 'closed_minimum_version', minimumVersion: '1.3.0' })).toContain('below 1.3.0 for viewing from outside');
  });
  it('locations: not reachable since, not connected, and the mount hint from the share when the NAS folder is unknown', () => {
    const t = composeHealthLine({ ...example, locations: [
      { name: 'Footage', state: 'not_reachable', since: Date.parse('2026-10-09T09:14:00Z') },
      { unc: '\\\\nas\\archive', state: 'not_mounted', mountAt: '/locations/nas/archive' },
      { name: 'Grade', state: 'not_connected' },
    ] }).text;
    expect(t).toContain('Footage: not reachable since 09:14');
    expect(t).toContain('\\\\nas\\archive: **not mounted** (mount the folder of \\\\nas\\archive at /locations/nas/archive)');
    expect(t).toContain('Grade: not connected (run share-login)');
  });
  it('a company\'s own certificate is warned at 30, 14 and 7 days and red when expired', () => {
    const c = (days) => composeHealthLine({ ...example, certificate: { kind: 'own', ownUntil: NOW + days * 86_400_000 } }).segments.find((s) => s.text.startsWith('certificate'));
    expect(c(60).tone).toBe('plain');
    expect(c(30)).toEqual({ text: 'certificate: your company\u2019s own expires in 30 days (2026-11-08)', tone: 'amber' });
    expect(c(7).tone).toBe('red');
    expect(c(-1).text).toContain('expired on');
  });
  it('the update\'s states', () => {
    const u = (update, platform = 'windows') => composeHealthLine({ ...example, platform, update }).segments.at(-1).text;
    expect(u({ state: 'available', version: '1.3.0' }, 'container')).toBe('1.3.0 is available: pull the image');
    expect(u({ state: 'failed', version: '1.3.0', reason: 'the inside door could not bind', running: '1.2.4' })).toBe('update to 1.3.0 failed (the inside door could not bind); running 1.2.4');
  });
  it('the lines under it: the red public-address line, the amber relay line, the root\'s notice', () => {
    const w = composeHealthLine({ ...example, inside: { ...example.inside, refusedPublic: 12, port: 8443, relay: { viewers: 14, address: '192.168.1.77' } }, certificate: { ...example.certificate, rootExpiryNotice: true }, revoked: true, smb: [{ unc: '\\\\nas\\footage', dialect: '2.1' }, { unc: '\\\\nas\\grade', dialect: '3.1.1' }] }).warnings;
    expect(w).toEqual([
      { text: 'WILSON has forgotten this gateway (its sign-in was refused): enrol it again', tone: 'red' },
      { text: 'the office door is being reached from public addresses (12 since the last sync): remove the router\u2019s forward to port 8443', tone: 'red' },
      { text: '14 people reached the office door through one address today, 192.168.1.77: a relay or proxy may be pointed at it', tone: 'amber' },
      { text: 'the gateway\u2019s root certificate expires on 2036-10-09; a new one will need installing on each office computer', tone: 'amber' },
      { text: '\\\\nas\\footage uses SMB 2.1: set SMB 3 with signing and encryption on the server', tone: 'amber' },
    ]);
  });
  it('an IPv6 door is bracketed', () => {
    expect(composeHealthLine({ ...example, inside: { state: 'open', addresses: [{ address: 'fd00::10', port: 8443 }] } }).text).toContain('office door open ([fd00::10]:8443)');
  });
  it('durations', () => {
    expect([durationWords(0), durationWords(70_000), durationWords(120_000), durationWords(4 * 60_000), durationWords(2 * 3_600_000), durationWords(49 * 3_600_000)]).toEqual(['0 s', '70 s', '2 minutes', '4 minutes', '2 h', '2 days']);
  });
});

describe('the user agent\'s family (§6)', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36', 'Chrome 142 on Windows'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0', 'Edge 142 on Windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15', 'Safari 18 on macOS'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1', 'Safari 18 on iOS'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox 131 on Linux'],
    ['Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', 'Chrome 141 on Android'],
    ['curl/8.9.1', 'Other'],
    ['', 'unknown'],
  ])('%s', (ua, family) => { expect(userAgentFamily(ua)).toBe(family); });
});

describe('the container\'s mount rule (R15)', () => {
  it('host and share lower-cased, the folders below keep their spelling', () => {
    expect(containerRootFor('\\\\NAS\\Footage')).toBe('/locations/nas/footage');
    expect(containerRootFor('\\\\Studio-NAS\\Footage\\Day 1\\A-Cam')).toBe('/locations/studio-nas/footage/Day 1/A-Cam');
    expect(locationRoot('\\\\NAS\\Footage', 'windows')).toBe('\\\\NAS\\Footage');
    expect(locationRoot('\\\\NAS\\Footage', 'container')).toBe('/locations/nas/footage');
  });
  it('second-guesses nothing about which share (the local proof hands it the admin share)…', () => {
    expect(containerRootFor('\\\\localhost\\C$\\Users\\x')).toBe('/locations/localhost/c$/Users/x');
    expect(locationRoot('\\\\localhost\\C$\\Users\\x', 'windows')).toBe('\\\\localhost\\C$\\Users\\x');
  });
  it('…but refuses a shape that is no safe path', () => {
    for (const bad of ['\\\\nas', '\\\\nas\\..\\x', '\\\\nas\\footage\\..', '\\\\nas\\foot/age', '\\\\nas\\\\footage', '//nas/footage', 'C:\\footage', '\\\\nas\\foo\u0000tage', '', null]) {
      expect(containerRootFor(bad), String(bad)).toBeNull();
    }
    expect(parseUncPath('\\\\nas\\footage\\a')).toEqual({ host: 'nas', share: 'footage', rest: ['a'] });
  });
  it('refuses what is no share address at all: the device namespace, WebDAV, aliases Windows strips, invisible characters (review round 1, finding 2)', () => {
    for (const bad of [
      '\\\\?\\C:\\Windows', '\\\\?\\GLOBALROOT\\Device\\HarddiskVolume3\\Users', '\\\\?\\UNC\\nas\\footage', '\\\\.\\pipe\\WilsonGatewayAdmin',
      '\\\\evil.example.com@SSL@443\\DavWWWRoot\\share', '\\\\evil.example.com@SSL\\share', '\\\\nas@8080\\footage',
      '\\\\nas:445\\footage', '\\\\fe80::1\\footage', '\\\\[::1]\\footage', '\\\\fe80::1%12\\footage', '\\\\na s\\footage', '\\\\-nas\\footage', '\\\\nas.\\footage',
      '\\\\nas\\C$.', '\\\\nas\\footage \\x', '\\\\nas\\footage\\Day 1.', '\\\\nas\\foot:age', '\\\\nas\\foot*age', '\\\\nas\\foot?age', '\\\\nas\\foot"age', '\\\\nas\\foot<age', '\\\\nas\\foot|age',
      '\\\\nas\\foot\u200bage', '\\\\nas\\footage\u202e', '\\\\nas\\foot\u0085age', '\\\\nas\u2028\\footage',
      // round 2, R2-N1: not a share of files, or a DOS device name
      '\\\\nas\\pipe\\evil.mp4', '\\\\SUSAN-FAIRCHILD\\PIPE', '\\\\nas\\mailslot\\x', '\\\\nas\\IPC$', '\\\\nas\\footage\\CON', '\\\\nas\\footage\\con.mp4', '\\\\nas\\LPT1\\x', '\\\\nas\\footage\\Nul\\clip.mp4', '\\\\nas\\footage\\COM9.txt',
    ]) {
      expect(parseUncPath(bad), JSON.stringify(bad)).toBeNull();
      expect(locationRoot(bad, 'windows'), JSON.stringify(bad)).toBeNull();
      expect(containerRootFor(bad), JSON.stringify(bad)).toBeNull();
    }
    for (const good of ['\\\\SUSAN_PC\\footage', '\\\\192.168.1.20\\Footage', '\\\\fe80--1.ipv6-literal.net\\footage', '\\\\nas.corp.example.com\\Footage Share\\Day 1', '\\\\nas\\footage$', '\\\\NAS\\Día 02', '\\\\nas\\pipes', '\\\\nas\\footage\\console', '\\\\nas\\footage\\COM10', '\\\\nas\\footage\\CONTROL.mp4']) {
      expect(parseUncPath(good), good).not.toBeNull();
      expect(locationRoot(good, 'windows'), good).toBe(good);
    }
  });
});

describe('the version', () => {
  it('VERSION is package.json\'s, so the two cannot drift', async () => {
    const { VERSION } = await import('../src/version.mjs');
    const fs = await import('node:fs');
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(VERSION).toBe(pkg.version);
    expect(pkg.dependencies).toEqual({}); // Node built-ins only (the brief, item 1)
  });
});
