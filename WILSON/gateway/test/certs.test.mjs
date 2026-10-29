// =============================================================================
// certs.test.mjs — the certificate maker (§3, D3, D26) and its life:
// read back by Node's own X.509 parser; a TLS handshake that trusts the root
// and one that does not; the name constraints ENFORCED (a leaf for
// bank.example.com, or for an address outside the /24, signed by the same
// root, is refused: "permitted subtree violation"), by Node's TLS and by the
// OpenSSL command line where it is installed; and the store's renewals.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { execFileSync } from 'node:child_process';
import { makeRoot, makeLeaf, certInfo, fingerprintOf, displayFingerprint, hostNames, permittedFor } from '../src/certs/x509.mjs';
import { CertStore, loadOwnCertificate } from '../src/certs/store.mjs';
import { makeSecrets, SecretsWriteRefused } from '../src/platform/secrets.mjs';

// OpenSSL reads the constraints back. Here it may be missing (the tests say
// so by skipping); in CI it must be there, so a missing one FAILS them
// instead of skipping them (review round 1, finding 6).
const OPENSSL = (() => { try { execFileSync('openssl', ['version'], { stdio: 'pipe' }); return true; } catch { return false; } })() || !!process.env.CI;
const NOW = Date.parse('2026-10-10T00:00:00Z');
const ADDR = ['192.168.1.10', 'fd00:1:2:3::10'];

let tmp;
beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gw2-certs-')); });
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function handshake({ cert, key, ca, servername }) {
  return new Promise((resolve) => {
    const server = tls.createServer({ cert, key, minVersion: 'TLSv1.2' }, (s) => s.end());
    server.listen(0, '127.0.0.1', () => {
      const c = tls.connect({ host: '127.0.0.1', port: server.address().port, ca, servername, minVersion: 'TLSv1.2' });
      const done = (r) => { c.destroy(); server.close(); resolve(r); };
      c.once('secureConnect', () => done({ ok: true }));
      c.once('error', (e) => done({ ok: false, code: e.code, message: e.message }));
    });
  });
}

describe('the root and the leaf (§3)', () => {
  const root = makeRoot({ hostname: 'Studio-NAS', insideAddresses: ADDR, now: NOW });
  const leaf = makeLeaf({ rootCertPem: root.certPem, rootKeyPem: root.keyPem, hostname: 'Studio-NAS', insideAddresses: ADDR, now: NOW });
  const rx = new crypto.X509Certificate(root.certPem);
  const lx = new crypto.X509Certificate(leaf.certPem);

  it('the root: a CA, three years (P8, TPN-ENC-016; ten before), P-256, its fingerprint the SHA-256 of its DER', () => {
    expect(rx.ca).toBe(true);
    expect(rx.publicKey.asymmetricKeyDetails.namedCurve).toBe('prime256v1');
    expect(Date.parse(rx.validTo) - NOW).toBeGreaterThan(2.99 * 365 * 86_400_000);
    expect(Date.parse(rx.validTo) - NOW).toBeLessThan(3.01 * 366 * 86_400_000);
    expect(root.fingerprint).toBe(crypto.createHash('sha256').update(rx.raw).digest('hex'));
    expect(fingerprintOf(root.certPem)).toBe(root.fingerprint);
    expect(displayFingerprint(root.fingerprint)).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(root.permitted).toEqual({ dns: ['studio-nas', 'studio-nas.local'], nets: ['192.168.1.0/24', 'fd00:1:2:3::/64'] });
  });
  it('the leaf: 397 days, not a CA, issued by the root, its names and addresses in the SAN', () => {
    expect(lx.ca).toBe(false);
    expect(lx.checkIssued(rx)).toBe(true);
    expect(lx.verify(rx.publicKey)).toBe(true);
    expect(Math.round((Date.parse(lx.validTo) - NOW) / 86_400_000)).toBe(397);
    expect(lx.subjectAltName).toContain('DNS:studio-nas');
    expect(lx.subjectAltName).toContain('DNS:studio-nas.local');
    expect(lx.subjectAltName).toContain('IP Address:192.168.1.10');
    expect(lx.subjectAltName).toMatch(/IP Address:FD00:1:2:3:0:0:0:10/i);
    expect(lx.checkPrivateKey(crypto.createPrivateKey(leaf.keyPem))).toBe(true);
  });
  it('a client that trusts the root completes the handshake by name; one that does not is refused', async () => {
    expect(await handshake({ cert: leaf.certPem, key: leaf.keyPem, ca: root.certPem, servername: 'studio-nas' })).toEqual({ ok: true });
    const r = await handshake({ cert: leaf.certPem, key: leaf.keyPem, ca: undefined, servername: 'studio-nas' });
    expect(r.ok).toBe(false);
    expect(r.code).toMatch(/UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED|UNABLE_TO_GET_ISSUER/);
  });
  it('THE CONSTRAINT IS ENFORCED: a leaf for bank.example.com signed by the same root is refused', async () => {
    const forged = makeLeaf({ rootCertPem: root.certPem, rootKeyPem: root.keyPem, hostname: '', insideAddresses: [], extraDnsNames: ['bank.example.com'], now: NOW });
    const r = await handshake({ cert: forged.certPem, key: forged.keyPem, ca: root.certPem, servername: 'bank.example.com' });
    expect(r.ok).toBe(false);
    expect(`${r.code} ${r.message}`).toMatch(/PERMITTED|permitted subtree/i);
  });
  // The handshakes below connect to 127.0.0.1 without a server name, so Node
  // checks the leaf's IP against 127.0.0.1: an IP leaf must name 127.0.0.1, or
  // it would fail on the name check and prove nothing about the constraint.
  const ipLeafFor = (r) => makeLeaf({ rootCertPem: r.certPem, rootKeyPem: r.keyPem, hostname: '', insideAddresses: ['127.0.0.1'], now: NOW });
  it('…and so is a leaf for an address outside the /24 (D26), or a sub-name of nothing permitted', async () => {
    const out = ipLeafFor(root); // 127.0.0.1 is outside 192.168.1.0/24
    const refused = await handshake({ cert: out.certPem, key: out.keyPem, ca: root.certPem, servername: undefined });
    expect(refused.ok).toBe(false);
    expect(refused.message).toMatch(/permitted subtree violation/);
    const covering = makeRoot({ hostname: 'studio-nas', insideAddresses: ['127.0.0.1'], now: NOW }); // the control: a /24 that holds it
    const inside = ipLeafFor(covering);
    expect(await handshake({ cert: inside.certPem, key: inside.keyPem, ca: covering.certPem, servername: undefined })).toEqual({ ok: true });
    const sub = makeLeaf({ rootCertPem: root.certPem, rootKeyPem: root.keyPem, hostname: '', insideAddresses: [], extraDnsNames: ['admin.studio-nas'], now: NOW });
    // A name below a permitted one is permitted by RFC 5280's rule (labels added on the left).
    expect((await handshake({ cert: sub.certPem, key: sub.keyPem, ca: root.certPem, servername: 'admin.studio-nas' })).ok).toBe(true);
  });
  it('a root with no address forbids every IP (review round 1, finding 1); one with no valid hostname forbids every name', async () => {
    const noAddr = makeRoot({ hostname: 'studio-nas', insideAddresses: [], now: NOW });
    expect(noAddr.permitted.nets).toEqual([]);
    const ipLeaf = ipLeafFor(noAddr);
    const refused = await handshake({ cert: ipLeaf.certPem, key: ipLeaf.keyPem, ca: noAddr.certPem, servername: undefined });
    expect(refused.ok).toBe(false);
    expect(refused.message).toMatch(/excluded subtree violation/);
    const byName = makeLeaf({ rootCertPem: noAddr.certPem, rootKeyPem: noAddr.keyPem, hostname: 'studio-nas', insideAddresses: [], now: NOW }); // the control
    expect(await handshake({ cert: byName.certPem, key: byName.keyPem, ca: noAddr.certPem, servername: 'studio-nas' })).toEqual({ ok: true });
    const noName = makeRoot({ hostname: 'not a dns label!', insideAddresses: ['192.168.1.10'], now: NOW });
    expect(noName.permitted.dns).toEqual([]);
    const nameLeaf = makeLeaf({ rootCertPem: noName.certPem, rootKeyPem: noName.keyPem, hostname: '', insideAddresses: [], extraDnsNames: ['anything.example'], now: NOW });
    expect((await handshake({ cert: nameLeaf.certPem, key: nameLeaf.keyPem, ca: noName.certPem, servername: 'anything.example' })).ok).toBe(false);
  });
  it.runIf(OPENSSL)('OpenSSL agrees: the leaf verifies, the forged one fails with "permitted subtree violation", the extensions are critical', () => {
    const w = (n, s) => { const p = path.join(tmp, n); fs.writeFileSync(p, s); return p; };
    const rootFile = w('root.pem', root.certPem);
    expect(execFileSync('openssl', ['verify', '-CAfile', rootFile, w('leaf.pem', leaf.certPem)], { encoding: 'utf8' })).toMatch(/OK/);
    const forged = makeLeaf({ rootCertPem: root.certPem, rootKeyPem: root.keyPem, hostname: '', insideAddresses: [], extraDnsNames: ['bank.example.com'], now: NOW });
    let out = '';
    try { execFileSync('openssl', ['verify', '-CAfile', rootFile, w('forged.pem', forged.certPem)], { encoding: 'utf8', stdio: 'pipe' }); } catch (e) { out = String(e.stdout) + String(e.stderr); }
    expect(out).toMatch(/permitted subtree violation/);
    const text = execFileSync('openssl', ['x509', '-in', rootFile, '-noout', '-text'], { encoding: 'utf8' });
    expect(text).toMatch(/X509v3 Name Constraints: critical/);
    expect(text).toMatch(/X509v3 Basic Constraints: critical\s+CA:TRUE, pathlen:0/);
    expect(text).toMatch(/IP:192\.168\.1\.0\/255\.255\.255\.0/);
    expect(text).toMatch(/DNS:studio-nas\.local/);
    expect(text).toMatch(/Signature Algorithm: ecdsa-with-SHA256/);
  });
  it.runIf(OPENSSL)('OpenSSL agrees on a root with no address: every IPv4 and IPv6 address excluded, so a leaf for any IP fails, a leaf by name passes', () => {
    const w = (n, s) => { const p = path.join(tmp, n); fs.writeFileSync(p, s); return p; };
    const noAddr = makeRoot({ hostname: 'studio-nas', insideAddresses: [], now: Date.now() });
    const rootFile = w('noaddr-root.pem', noAddr.certPem);
    const text = execFileSync('openssl', ['x509', '-in', rootFile, '-noout', '-text'], { encoding: 'utf8' });
    const nc = text.slice(text.indexOf('X509v3 Name Constraints'), text.indexOf('X509v3 Subject Key Identifier'));
    expect(nc).toMatch(/Permitted:\s+DNS:studio-nas\s+DNS:studio-nas\.local\s+Excluded:/);
    expect(nc).toMatch(/Excluded:\s+IP:0\.0\.0\.0\/0\.0\.0\.0\s+IP:0:0:0:0:0:0:0:0\/0:0:0:0:0:0:0:0/);
    expect(nc.slice(0, nc.indexOf('Excluded:'))).not.toMatch(/IP:/);
    const verify = (name, leafPem) => { try { return execFileSync('openssl', ['verify', '-CAfile', rootFile, w(name, leafPem)], { encoding: 'utf8', stdio: 'pipe' }); } catch (e) { return String(e.stdout) + String(e.stderr); } };
    for (const ip of ['8.8.8.8', '10.20.30.40', '192.168.1.10', '2001:db8::1', 'fd00::5']) {
      const leaf = makeLeaf({ rootCertPem: noAddr.certPem, rootKeyPem: noAddr.keyPem, hostname: '', insideAddresses: [ip], now: Date.now() });
      expect(verify(`noaddr-${ip.replace(/[:.]/g, '_')}.pem`, leaf.certPem), ip).toMatch(/excluded subtree violation/);
    }
    const byName = makeLeaf({ rootCertPem: noAddr.certPem, rootKeyPem: noAddr.keyPem, hostname: 'studio-nas', insideAddresses: [], now: Date.now() });
    expect(verify('noaddr-byname.pem', byName.certPem)).toMatch(/: OK/);
  });
  it('a host whose name is no DNS label: its own leaf (addresses only) still verifies under its own root', async () => {
    const r = makeRoot({ hostname: 'SUSAN_PC', insideAddresses: ['127.0.0.1'], now: NOW });
    expect(r.permitted.dns).toEqual([]);
    const own = makeLeaf({ rootCertPem: r.certPem, rootKeyPem: r.keyPem, hostname: 'SUSAN_PC', insideAddresses: ['127.0.0.1'], now: NOW });
    expect(new crypto.X509Certificate(own.certPem).subject).toMatch(/^CN=WILSON Gateway$/m);
    expect(await handshake({ cert: own.certPem, key: own.keyPem, ca: r.certPem, servername: undefined })).toEqual({ ok: true });
  });
  it('dates past 2049 are GeneralizedTime and still read back', () => {
    // P8 (TPN-ENC-016): a three-year root made in 2048 ends in 2051 (it was 2045 → 2055).
    const late = makeRoot({ hostname: 'nas', insideAddresses: ['10.0.0.5'], now: Date.parse('2048-01-01T00:00:00Z') });
    expect(certInfo(late.certPem).notAfter).toBe(Date.parse('2051-01-01T00:00:00Z'));
  });
  it('host names: lower-cased, .local added, nothing for a name that is no DNS label', () => {
    expect(hostNames('STUDIO-NAS')).toEqual(['studio-nas', 'studio-nas.local']);
    expect(hostNames('nas.local')).toEqual(['nas', 'nas.local']);
    expect(hostNames('under_score')).toEqual([]);
    expect(permittedFor({ hostname: 'x', insideAddresses: ['10.0.0.1', '10.0.0.200', 'nope'] }).netsText).toEqual(['10.0.0.0/24']);
  });
});

describe('the store: the certificates\' life (§3 "The day it expires")', () => {
  const plain = { protect: async (b) => Buffer.from(b), unprotect: async (b) => Buffer.from(b) };
  const store = (dir, now) => new CertStore({ dir, secrets: plain, hostname: 'studio-nas', now: () => now.t });

  it('first run makes both; a second start with the same addresses changes nothing', async () => {
    const dir = path.join(tmp, 's1'); const now = { t: NOW };
    const s = store(dir, now);
    await s.load();
    expect(await s.ensure({ insideAddresses: ['192.168.1.10'] })).toMatchObject({ rootMade: true, leafMade: true });
    const again = store(dir, now);
    expect(await again.load()).toBe(true);
    expect(await again.ensure({ insideAddresses: ['192.168.1.10'] })).toMatchObject({ rootMade: false, leafMade: false });
    expect(again.state().rootFingerprint).toBe(s.state().rootFingerprint);
  });
  // P8 (TPN-ENC-013): with the addresses IN the leaf (inside.ip_sans true, or an
  // earlier install); a names-only leaf, the new default, follows no address at
  // all (its own describe at the end of this file).
  it('an address change inside the /24 makes a new leaf only; outside it, a new root (and the line says so) — when the leaf names addresses', async () => {
    const dir = path.join(tmp, 's2'); const now = { t: NOW };
    const s = store(dir, now); await s.load();
    await s.ensure({ insideAddresses: ['192.168.1.10'], ipSans: true });
    const fp = s.state().rootFingerprint;
    expect(await s.ensure({ insideAddresses: ['192.168.1.77'], ipSans: true })).toMatchObject({ rootMade: false, leafMade: true });
    expect(s.state().rootFingerprint).toBe(fp);
    expect(await s.ensure({ insideAddresses: ['10.0.5.20'], ipSans: true })).toMatchObject({ rootMade: true, rootReplacedFor: '10.0.5.20', leafMade: true });
    expect(s.state().rootFingerprint).not.toBe(fp);
    expect(fs.existsSync(path.join(dir, 'root-previous.pem'))).toBe(true);
  });
  it('the leaf renews 30 days before its end and when found expired at start', async () => {
    const dir = path.join(tmp, 's3'); const now = { t: NOW };
    const s = store(dir, now); await s.load();
    await s.ensure({ insideAddresses: ['192.168.1.10'] });
    now.t = NOW + 366 * 86_400_000;
    expect((await s.ensure({ insideAddresses: ['192.168.1.10'] })).leafMade).toBe(false);
    now.t = NOW + 368 * 86_400_000; // 29 days left
    expect((await s.ensure({ insideAddresses: ['192.168.1.10'] })).leafMade).toBe(true);
    now.t = NOW + 5 * 365 * 86_400_000; // switched off for years: past the three-year root's end too
    const later = store(dir, now); await later.load();
    // P8 (TPN-ENC-016): with a three-year root the five-year jump is also a root
    // replacement — the next root made and promoted at once, the leaf on it.
    expect(await later.ensure({ insideAddresses: ['192.168.1.10'] })).toMatchObject({ nextRootMade: true, nextRootPromoted: true, leafMade: true });
    expect(later.state().leafNotAfter).toBeGreaterThan(now.t);
    expect(later.state().rootNotAfter).toBeGreaterThan(now.t);
    expect(new crypto.X509Certificate(later.state().leafPem).checkIssued(new crypto.X509Certificate(later.state().rootPem))).toBe(true);
  });
  it('the next root twelve months before the old one ends; the leaf moves to it one month before', async () => {
    const dir = path.join(tmp, 's4'); const now = { t: NOW };
    const s = store(dir, now); await s.load();
    await s.ensure({ insideAddresses: ['192.168.1.10'] });
    const first = s.state().rootFingerprint;
    now.t = s.state().rootNotAfter - 300 * 86_400_000;
    expect(await s.ensure({ insideAddresses: ['192.168.1.10'] })).toMatchObject({ nextRootMade: true, nextRootPromoted: false });
    expect(s.state()).toMatchObject({ rootFingerprint: first, rootExpiryNotice: true });
    expect(s.state().nextRootPem).toMatch(/BEGIN CERTIFICATE/);
    now.t = s.state().rootNotAfter - 20 * 86_400_000;
    expect(await s.ensure({ insideAddresses: ['192.168.1.10'] })).toMatchObject({ nextRootPromoted: true, leafMade: true });
    expect(s.state().rootFingerprint).not.toBe(first);
    expect(new crypto.X509Certificate(s.state().leafPem).checkIssued(new crypto.X509Certificate(s.state().rootPem))).toBe(true);
  });
  it('the private keys go through the protector; the certificates do not', async () => {
    const dir = path.join(tmp, 's5'); const now = { t: NOW };
    const marker = { protect: async (b) => Buffer.concat([Buffer.from('PROT:'), b]), unprotect: async (b) => b.subarray(5) };
    const s = new CertStore({ dir, secrets: marker, hostname: 'nas', now: () => now.t });
    await s.load(); await s.ensure({ insideAddresses: ['10.1.1.1'] });
    expect(fs.readFileSync(path.join(dir, 'root-key.bin'), 'utf8').startsWith('PROT:')).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'leaf-key.bin'), 'utf8').startsWith('PROT:')).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'root.pem'), 'utf8')).toMatch(/^-----BEGIN CERTIFICATE/);
    const back = new CertStore({ dir, secrets: marker, hostname: 'nas', now: () => now.t });
    await back.load();
    expect(back.state().leafKeyPem).toMatch(/BEGIN PRIVATE KEY/);
  });
  it('a company\'s own certificate is read with its key, and a mismatched key is refused', async () => {
    const r = makeRoot({ hostname: 'own', insideAddresses: ['10.2.2.2'], now: NOW });
    const l = makeLeaf({ rootCertPem: r.certPem, rootKeyPem: r.keyPem, hostname: 'own', insideAddresses: ['10.2.2.2'], now: NOW });
    const cf = path.join(tmp, 'own.pem'); const kf = path.join(tmp, 'own-key.pem'); const wrong = path.join(tmp, 'wrong-key.pem');
    fs.writeFileSync(cf, l.certPem); fs.writeFileSync(kf, l.keyPem); fs.writeFileSync(wrong, r.keyPem);
    expect((await loadOwnCertificate({ certFile: cf, keyFile: kf })).notAfter).toBe(l.notAfter - (l.notAfter % 1000));
    await expect(loadOwnCertificate({ certFile: cf, keyFile: wrong })).rejects.toThrow(/does not belong/);
  });
});

// P8 (TPN-ENC-014): the store when secrets cannot be written (DPAPI down, no
// sealing key) or a key file does not open. Nothing plain is ever written; a
// refusal makes nothing and keeps what there is; an unreadable root is never
// replaced by a fresh one (every office computer trusts the old one).
describe('P8 (TPN-ENC-014): the store under a refusing secrets layer, and over a key file that does not open', () => {
  const plain = { protect: async (b) => Buffer.concat([Buffer.from('WGPLAIN1'), Buffer.from(b)]), unprotect: async (b) => Buffer.from(b).subarray(8) };
  const REASON = 'set WILSON_GATEWAY_SECRETS_KEY (test)';
  const refusing = { protect: async () => { throw new SecretsWriteRefused(REASON); }, unprotect: plain.unprotect };
  const mk = (dir, secrets, now) => new CertStore({ dir, secrets, hostname: 'studio-nas', now: () => now.t });

  it('a first run under a refusal makes no root and no leaf (nothing to open a door with), writes nothing, and says why', async () => {
    const dir = path.join(tmp, 'p1'); const now = { t: NOW };
    const s = mk(dir, refusing, now);
    expect(await s.load()).toBe(false);
    expect(await s.ensure({ insideAddresses: ['192.168.1.10'] })).toMatchObject({ rootMade: false, leafMade: false, nextRootMade: false, refused: REASON, unreadable: null });
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(s.state()).toMatchObject({ rootPem: null, leafPem: null, writeRefused: REASON, unreadable: null });
  });
  it('an address change outside the /24 under a refusal keeps the old root, on disk and in memory; the next ensure() with writes working replaces it', async () => {
    const dir = path.join(tmp, 'p2'); const now = { t: NOW };
    const s = mk(dir, plain, now);
    // ipSans true throughout: the addresses in the leaf, so an address change does ask for a new root (P8, TPN-ENC-013).
    await s.load(); await s.ensure({ insideAddresses: ['192.168.1.10'], ipSans: true });
    const fp = s.state().rootFingerprint;
    const rootPem = fs.readFileSync(path.join(dir, 'root.pem'), 'utf8');
    const leafPem = fs.readFileSync(path.join(dir, 'leaf.pem'), 'utf8');
    s.secrets = refusing;
    expect(await s.ensure({ insideAddresses: ['10.0.5.20'], ipSans: true })).toMatchObject({ rootMade: false, rootReplacedFor: null, leafMade: false, refused: REASON });
    expect(s.state().rootFingerprint).toBe(fp);
    expect(s.state().writeRefused).toBe(REASON);
    expect(fs.readFileSync(path.join(dir, 'root.pem'), 'utf8')).toBe(rootPem);
    expect(fs.readFileSync(path.join(dir, 'leaf.pem'), 'utf8')).toBe(leafPem);
    expect(fs.existsSync(path.join(dir, 'root-previous.pem'))).toBe(false);
    // The leaf's renewal under a refusal: the loaded leaf serves on.
    s.secrets = refusing; now.t = NOW + 380 * 86_400_000;
    expect(await s.ensure({ insideAddresses: ['192.168.1.10'], ipSans: true })).toMatchObject({ leafMade: false, refused: REASON });
    expect(fs.readFileSync(path.join(dir, 'leaf.pem'), 'utf8')).toBe(leafPem);
    s.secrets = plain;
    expect(await s.ensure({ insideAddresses: ['10.0.5.20'], ipSans: true })).toMatchObject({ rootMade: true, rootReplacedFor: '10.0.5.20', leafMade: true, refused: null });
    expect(s.state().writeRefused).toBeNull();
    expect(fs.existsSync(path.join(dir, 'root-previous.pem'))).toBe(true);
  });
  it('a root whose key file does not open is UNREADABLE, never "no root": nothing is made over it, the files stay, the line says so', async () => {
    const dir = path.join(tmp, 'p3'); const now = { t: NOW };
    const s = mk(dir, plain, now);
    await s.load(); await s.ensure({ insideAddresses: ['192.168.1.10'] });
    const before = Object.fromEntries(fs.readdirSync(dir).map((f) => [f, fs.readFileSync(path.join(dir, f))]));
    const wrongKey = { protect: plain.protect, unprotect: async () => { throw new Error('a secret file does not open with WILSON_GATEWAY_SECRETS_KEY: is it the key this install was made with, or was the file changed?'); } };
    const back = mk(dir, wrongKey, now);
    expect(await back.load()).toBe(false);
    expect(await back.ensure({ insideAddresses: ['192.168.1.10'] })).toMatchObject({ rootMade: false, leafMade: false, refused: null, unreadable: expect.stringMatching(/does not open with WILSON_GATEWAY_SECRETS_KEY/) });
    expect(back.state()).toMatchObject({ rootPem: null, leafPem: null, unreadable: expect.stringMatching(/does not open/) });
    expect(Object.fromEntries(fs.readdirSync(dir).map((f) => [f, fs.readFileSync(path.join(dir, f))]))).toEqual(before);
    // CONTROL: the same files under the right layer load as before.
    const again = mk(dir, plain, now);
    expect(await again.load()).toBe(true);
    expect(again.state()).toMatchObject({ rootFingerprint: s.state().rootFingerprint, unreadable: null });
  });
  it('an earlier version\'s plain key files are sealed again on load under the real layer, once', async () => {
    const dir = path.join(tmp, 'p4'); const now = { t: NOW };
    const s = mk(dir, plain, now);
    await s.load(); await s.ensure({ insideAddresses: ['192.168.1.10'] });
    expect(fs.readFileSync(path.join(dir, 'root-key.bin')).subarray(0, 8).toString()).toBe('WGPLAIN1');
    // A throwaway key, made here and nowhere else.
    const real = makeSecrets({ platform: 'linux', env: { WILSON_GATEWAY_SECRETS_KEY: crypto.randomBytes(32).toString('base64') }, readFileSync: () => { throw new Error('ENOENT'); } });
    const back = mk(dir, real, now);
    expect(await back.load()).toBe(true);
    for (const f of ['root-key.bin', 'leaf-key.bin']) expect(fs.readFileSync(path.join(dir, f)).subarray(0, 8).toString()).toBe('WGSEALD1');
    expect(real.status().unsealed).toBe(0);
    expect(back.state().rootFingerprint).toBe(s.state().rootFingerprint);
    expect(back.state().leafKeyPem).toMatch(/BEGIN PRIVATE KEY/);
    const third = mk(dir, real, now);
    expect(await third.load()).toBe(true);
    expect(real.status().unsealed).toBe(0);
  });
});

// P8 (TPN-ENC-013): the office-door leaf names the host, not its private
// addresses. The root's permitted networks are unchanged (turning addresses
// on later needs no new root); an earlier install keeps its addresses until
// inside.ip_sans says; a host with no DNS-label name keeps them always.
describe('P8 (TPN-ENC-013): the office-door leaf names the host, not its addresses', () => {
  const plain = { protect: async (b) => Buffer.from(b), unprotect: async (b) => Buffer.from(b) };
  const san = (dir) => certInfo(fs.readFileSync(path.join(dir, 'leaf.pem'), 'utf8')).subjectAltName;
  const mk = (dir, now, hostname = 'studio-nas') => new CertStore({ dir, secrets: plain, hostname, now: () => now.t });

  it('a new store: DNS names only, no IP Address SAN; an address change outside the /24 replaces no root; ip_sans true adds the addresses under the same root; false drops them', async () => {
    const dir = path.join(tmp, 'n1'); const now = { t: NOW };
    const s = mk(dir, now); await s.load();
    expect(await s.ensure({ insideAddresses: ['192.168.1.10'] })).toMatchObject({ rootMade: true, leafMade: true });
    expect(san(dir)).toContain('DNS:studio-nas');
    expect(san(dir)).toContain('DNS:studio-nas.local');
    expect(san(dir)).not.toContain('IP Address');
    expect(s.state()).toMatchObject({ ipSans: null, rootPermitted: { dns: ['studio-nas', 'studio-nas.local'], nets: ['192.168.1.0/24'] } });
    const fp = s.state().rootFingerprint;
    expect(await s.ensure({ insideAddresses: ['10.0.5.20'] })).toMatchObject({ rootMade: false, rootReplacedFor: null, leafMade: false });
    expect(s.state().rootFingerprint).toBe(fp);
    expect(await s.ensure({ insideAddresses: ['192.168.1.10'], ipSans: true })).toMatchObject({ rootMade: false, leafMade: true });
    expect(san(dir)).toContain('IP Address:192.168.1.10');
    expect(s.state()).toMatchObject({ ipSans: 'config', rootFingerprint: fp });
    expect(await s.ensure({ insideAddresses: ['192.168.1.10'], ipSans: false })).toMatchObject({ rootMade: false, leafMade: true });
    expect(san(dir)).not.toContain('IP Address');
    expect(s.state().ipSans).toBeNull();
  });
  it('an earlier install (its leaf names addresses) keeps them while ip_sans is unset, with the reason for the line; false drops them at the next ensure()', async () => {
    const dir = path.join(tmp, 'n2'); const now = { t: NOW };
    const s = mk(dir, now); await s.load();
    await s.ensure({ insideAddresses: ['192.168.1.10'], ipSans: true });
    const back = mk(dir, now); await back.load();
    expect(back.legacyIpSans()).toBe(true);
    expect(await back.ensure({ insideAddresses: ['192.168.1.10'] })).toMatchObject({ leafMade: false });
    expect(back.state().ipSans).toBe('legacy');
    expect(san(dir)).toContain('IP Address:192.168.1.10');
    expect(await back.ensure({ insideAddresses: ['192.168.1.77'] })).toMatchObject({ rootMade: false, leafMade: true });
    expect(san(dir)).toContain('IP Address:192.168.1.77');
    expect(back.state().ipSans).toBe('legacy');
    expect(await back.ensure({ insideAddresses: ['192.168.1.77'], ipSans: false })).toMatchObject({ leafMade: true });
    expect(san(dir)).not.toContain('IP Address');
    expect(back.state().ipSans).toBeNull();
    const third = mk(dir, now); await third.load();
    expect(third.legacyIpSans()).toBe(false);
    expect(await third.ensure({ insideAddresses: ['192.168.1.77'] })).toMatchObject({ leafMade: false });
    expect(third.state().ipSans).toBeNull();
  });
  it('a host whose name is no DNS label keeps its addresses in the leaf whatever ip_sans says (never a leafless door), and the state says why', async () => {
    const dir = path.join(tmp, 'n3'); const now = { t: NOW };
    const s = mk(dir, now, 'studio nas!'); await s.load();
    expect(await s.ensure({ insideAddresses: ['192.168.1.10'], ipSans: false })).toMatchObject({ rootMade: true, leafMade: true });
    expect(san(dir)).toBe('IP Address:192.168.1.10');
    expect(s.state().ipSans).toBe('no_name');
  });
});
