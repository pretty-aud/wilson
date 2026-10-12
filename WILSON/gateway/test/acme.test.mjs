// =============================================================================
// acme.test.mjs — GW4 item 3: the outside door's free certificate (design §3,
// D4, F15), on this computer: the state machine and its pieces, against a fake
// ACME server whose validator connects to the REAL outside door the way Let's
// Encrypt's does (fakeAcme.mjs). No public name, no port 443: every listener
// is on 127.0.0.1 and an ephemeral port. The CI's Pebble job
// (gateway.yml, test/e2e/acmePebble.mjs) runs the same against Let's
// Encrypt's own test server.
// =============================================================================

import { describe, it, expect, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { b64u, jwkOf, thumbprint, keyAuthorization, signJws, newP256Key } from '../src/acme/jose.mjs';
import { makeCsr, makeChallengeCertificate, acmeNameOk, ACME_IDENTIFIER_OID } from '../src/acme/certs.mjs';
import { AcmeClient, retryAfterMs } from '../src/acme/client.mjs';
import { AcmeManager, acmeNameFor, renewAt, reasonOf, checkIssued, BACKOFF_MS, MAX_ATTEMPTS_PER_HOUR } from '../src/acme/manager.mjs';
import { createDoorServer, ACME_TLS_ALPN } from '../src/doors/server.mjs';
import { DEFAULT_LIMITS } from '../src/rules/limits.mjs';
import { outsideCertificatePhrase, outsideCertificateWarning, composeHealthLine } from '../src/rules/health.mjs';
import { startFakeAcme, parseCsr, challengeFacts } from './fakeAcme.mjs';
import { selfSignedFor } from './releaseServer.mjs';

const NAME = 'gw.example.test';
const DAY = 86_400_000;
const plainSecrets = { kind: 'file', protect: async (b) => Buffer.concat([Buffer.from('PLAIN:'), b]), unprotect: async (b) => b.subarray(6), status: () => ({ dpapi: false }) };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gw4-acme-'));
const opensslOk = (() => { try { execFileSync('openssl', ['version'], { stdio: 'pipe' }); return true; } catch { return false; } })();
const cleanups = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()(); });

/** The outside door on loopback with the ACME hook, answering "door" to a request. */
async function outsideDoor(acme, { cert = selfSignedFor(['door.local']), onEvent } = {}) {
  const d = createDoorServer({ door: 'outside', host: '127.0.0.1', port: 0, tls: { cert: cert.certPem, key: cert.keyPem }, limits: DEFAULT_LIMITS, gate: () => ({ admit: true }), handler: (_q, r) => r.end('door'), acme, ...(onEvent ? { onEvent } : {}) });
  await d.listen();
  cleanups.push(() => d.close());
  return d;
}

/** One TLS handshake: what certificate and protocol came back, and whether HTTP got through. */
function handshake(port, { servername = NAME, ALPNProtocols, maxVersion = 'TLSv1.3' } = {}) {
  return new Promise((resolve) => {
    const s = tls.connect({ host: '127.0.0.1', port, servername, ...(ALPNProtocols ? { ALPNProtocols } : {}), maxVersion, rejectUnauthorized: false }, () => {
      // getPeerCertificate() BEFORE getPeerX509Certificate(): after the latter, Node 24.13 answers an empty subject.
      const cn = s.getPeerCertificate()?.subject?.CN;
      const der = s.getPeerX509Certificate()?.raw;
      const out = { ok: true, alpn: s.alpnProtocol, facts: der ? challengeFacts(der) : null, cn };
      s.write(`GET / HTTP/1.1\r\nHost: ${servername}\r\n\r\n`);
      let body = '';
      s.on('data', (c) => { body += c; });
      s.on('close', () => resolve({ ...out, http: body }));
      setTimeout(() => s.destroy(), 1500);
    });
    s.on('error', (e) => resolve({ ok: false, error: e.code || e.message }));
  });
}

describe('JOSE (jose.mjs): the account key, its thumbprint, a signed request', () => {
  it('the JWK carries only the four members RFC 7638 orders, and the thumbprint is their canonical SHA-256', () => {
    const key = newP256Key();
    const jwk = jwkOf(key);
    expect(Object.keys(jwk).sort()).toEqual(['crv', 'kty', 'x', 'y']);
    const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
    expect(thumbprint(jwk)).toBe(crypto.createHash('sha256').update(canonical).digest('base64url'));
    expect(keyAuthorization('a'.repeat(43), 'tp')).toBe(`${'a'.repeat(43)}.tp`);
    expect(() => keyAuthorization('short', 'tp')).toThrow(/base64url/);
    expect(() => jwkOf(crypto.generateKeyPairSync('ed25519').privateKey)).toThrow(/P-256/);
  });
  it('a JWS is ES256 over protected.payload (raw r||s), with the jwk for a new account and the kid after; POST-as-GET has an empty payload', () => {
    const key = newP256Key();
    const a = signJws({ key, url: 'https://ca/acct', nonce: 'n1', payload: { termsOfServiceAgreed: true } });
    const ha = JSON.parse(Buffer.from(a.protected, 'base64url'));
    expect(ha).toEqual({ alg: 'ES256', nonce: 'n1', url: 'https://ca/acct', jwk: jwkOf(key) });
    expect(Buffer.from(a.signature, 'base64url')).toHaveLength(64);
    expect(crypto.verify('sha256', Buffer.from(`${a.protected}.${a.payload}`), { key: crypto.createPublicKey(key), dsaEncoding: 'ieee-p1363' }, Buffer.from(a.signature, 'base64url'))).toBe(true);
    const g = signJws({ key, url: 'https://ca/order/1', nonce: 'n2', payload: null, kid: 'https://ca/acct/1' });
    expect(g.payload).toBe('');
    expect(JSON.parse(Buffer.from(g.protected, 'base64url'))).toEqual({ alg: 'ES256', nonce: 'n2', url: 'https://ca/order/1', kid: 'https://ca/acct/1' });
    expect(b64u(Buffer.from([255, 254]))).toBe('__4');
  });
});

describe('the certificates ACME needs (certs.mjs)', () => {
  it('a name to ask for: a DNS name of two labels or more, lower case, never an address', () => {
    for (const ok of ['gw.example.test', 'gateway.studio-name.co.uk', 'a.b']) expect(acmeNameOk(ok), ok).toBe(true);
    for (const bad of ['localhost', 'GW.example.com', '192.168.1.10', '10.0.0.1', 'gw.example.com.', '-gw.example.com', `${'a'.repeat(64)}.com`, 'gw_1.example.com', '', null, 'x'.repeat(250) + '.com']) expect(acmeNameOk(bad), String(bad)).toBe(false);
  });
  it('the CSR: one name, CN and SAN, signed by the certificate\'s own key (and OpenSSL reads it so)', () => {
    const key = newP256Key();
    const der = makeCsr(NAME, key);
    const p = parseCsr(der);
    expect(p.names).toEqual([NAME]);
    expect(crypto.verify('sha256', p.info, crypto.createPublicKey({ key: p.spki, format: 'der', type: 'spki' }), p.signature)).toBe(true);
    expect(Buffer.compare(p.spki, crypto.createPublicKey(key).export({ type: 'spki', format: 'der' }))).toBe(0);
    expect(() => makeCsr('192.168.1.10', key)).toThrow(/not a DNS name/);
    if (opensslOk) {
      const dir = tmp(); const f = path.join(dir, 'csr.der'); fs.writeFileSync(f, der);
      const text = execFileSync('openssl', ['req', '-inform', 'DER', '-in', f, '-noout', '-text', '-verify'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      expect(text).toContain(`DNS:${NAME}`);
      expect(text).toMatch(/Subject: CN\s*=\s*gw\.example\.test/);
    }
  });
  it('the challenge certificate: exactly one dNSName, the acmeIdentifier extension CRITICAL with SHA-256(key authorization) (and OpenSSL reads it so)', () => {
    const ka = `${'t'.repeat(43)}.thumb`;
    const c = makeChallengeCertificate(NAME, ka);
    const x = new crypto.X509Certificate(c.certPem);
    expect(x.subjectAltName).toBe(`DNS:${NAME}`);
    const facts = challengeFacts(x.raw);
    expect(facts).toMatchObject({ names: [NAME], acmeCritical: true });
    expect(facts.acme.equals(crypto.createHash('sha256').update(ka).digest())).toBe(true);
    expect(ACME_IDENTIFIER_OID).toBe('1.3.6.1.5.5.7.1.31');
    if (opensslOk) {
      const dir = tmp(); const f = path.join(dir, 'c.pem'); fs.writeFileSync(f, c.certPem);
      const text = execFileSync('openssl', ['x509', '-in', f, '-noout', '-text'], { encoding: 'utf8' });
      expect(text).toMatch(/1\.3\.6\.1\.5\.5\.7\.1\.31: critical/);
    }
  });
});

describe('the outside door\'s hooks: TLS-ALPN-01 answered without touching a browser\'s connection', () => {
  const pendingFor = (name) => { const c = makeChallengeCertificate(name, `${'k'.repeat(43)}.tp`); return { challengeFor: (n) => (n === name ? { context: c.context } : null) }; };

  it('a validator (TLS 1.3, ALPN exactly acme-tls/1, SNI the name) gets the challenge certificate, then the connection ends before HTTP', async () => {
    const d = await outsideDoor(pendingFor(NAME));
    const r = await handshake(d.port, { ALPNProtocols: [ACME_TLS_ALPN] });
    expect(r).toMatchObject({ ok: true, alpn: 'acme-tls/1' });
    expect(r.facts).toMatchObject({ names: [NAME], acmeCritical: true });
    expect(r.http).toBe('');
  });
  it('a browser during the same pending challenge (h2 and http/1.1, the same SNI) gets the door\'s own certificate and its answer', async () => {
    const d = await outsideDoor(pendingFor(NAME));
    const r = await handshake(d.port, { ALPNProtocols: ['h2', 'http/1.1'] });
    expect(r).toMatchObject({ ok: true, alpn: 'http/1.1', cn: 'release test' });
    expect(r.facts.acme).toBeNull();
    expect(r.http).toMatch(/door$/);
    // A client with no ALPN at all: the door's own too.
    const plain = await handshake(d.port, {});
    expect(plain).toMatchObject({ ok: true, alpn: false, cn: 'release test' });
  });
  it('acme-tls/1 for a name with no pending challenge, or over TLS 1.2 (the certificate is chosen before ALPN there), is refused', async () => {
    const events = [];
    const d = await outsideDoor(pendingFor(NAME), { onEvent: (e, detail) => events.push(`${e}:${detail.reason ?? ''}`) });
    expect((await handshake(d.port, { servername: 'other.example.test', ALPNProtocols: [ACME_TLS_ALPN] })).ok).toBe(false);
    expect((await handshake(d.port, { ALPNProtocols: [ACME_TLS_ALPN], maxVersion: 'TLSv1.2' })).ok).toBe(false);
    // In TLS 1.2 the door ends an acme-tls/1 connection before the client's
    // handshake completes, whatever the door chose, so the client's failure
    // alone proves nothing: the door's own events say it REFUSED both, and
    // answered no challenge.
    expect(events).toEqual(['acme_alpn_refused:no_challenge', 'acme_alpn_refused:tls12']);
    // CONTROL: TLS 1.2 for a browser is fine.
    expect(await handshake(d.port, { ALPNProtocols: ['http/1.1'], maxVersion: 'TLSv1.2' })).toMatchObject({ ok: true, alpn: 'http/1.1' });
    // CONTROL: a validator in TLS 1.3 is answered, and the door says so.
    expect(await handshake(d.port, { ALPNProtocols: [ACME_TLS_ALPN] })).toMatchObject({ ok: true, alpn: 'acme-tls/1' });
    await new Promise((r) => setTimeout(r, 50));
    expect(events.at(-1)).toBe('acme_challenge_answered:');
  });
  it('acme-tls/1 offered among other protocols is a browser\'s offer, not a validator\'s', async () => {
    const d = await outsideDoor(pendingFor(NAME));
    expect(await handshake(d.port, { ALPNProtocols: [ACME_TLS_ALPN, 'http/1.1'] })).toMatchObject({ ok: true, alpn: 'http/1.1', cn: 'release test' });
  });
  it('CONTROL: a door without the hook (the office door) never negotiates acme-tls/1', async () => {
    const cert = selfSignedFor(['door.local']);
    const d = createDoorServer({ door: 'inside', host: '127.0.0.1', port: 0, tls: { cert: cert.certPem, key: cert.keyPem }, limits: DEFAULT_LIMITS, gate: () => ({ admit: true }), handler: (_q, r) => r.end('door') });
    await d.listen();
    cleanups.push(() => d.close());
    const r = await handshake(d.port, { ALPNProtocols: [ACME_TLS_ALPN] });
    expect(r.alpn).not.toBe('acme-tls/1');
    expect(r.facts?.acme ?? null).toBeNull();
  });
});

describe('when the free certificate applies (acmeNameFor)', () => {
  const cfg = (outside = {}) => ({ outside: { certificate: null, behind_local_proxy: false, declared_proxy: null, ...outside } });
  it('a DNS name at port 443, no company PEM, no local proxy, no declared tunnel', () => {
    expect(acmeNameFor({ outsideAddress: { host: 'Gateway.Example.COM', port: 443 }, config: cfg() })).toBe('gateway.example.com');
    expect(acmeNameFor({ outsideAddress: { host: 'gateway.example.com', port: 8444 }, config: cfg() })).toBeNull();
    expect(acmeNameFor({ outsideAddress: { host: '203.0.113.5', port: 443 }, config: cfg() })).toBeNull();
    expect(acmeNameFor({ outsideAddress: { host: 'gateway.example.com', port: 443 }, config: cfg({ certificate: { cert: 'a.pem', key: 'b.pem' } }) })).toBeNull();
    expect(acmeNameFor({ outsideAddress: { host: 'gateway.example.com', port: 443 }, config: cfg({ behind_local_proxy: true }) })).toBeNull();
    expect(acmeNameFor({ outsideAddress: { host: 'gateway.example.com', port: 443 }, config: cfg({ declared_proxy: { addresses: ['10.0.0.2'], name: 't' } }) })).toBeNull();
    expect(acmeNameFor({ outsideAddress: null, config: cfg() })).toBeNull();
  });
  it('renewal: a third of the life before the end, at most 30 days (30 days for Let\'s Encrypt\'s 90)', () => {
    expect(renewAt({ notBefore: 0, notAfter: 90 * DAY })).toBe(60 * DAY);
    expect(renewAt({ notBefore: 0, notAfter: 6 * DAY })).toBe(4 * DAY);
    expect(renewAt({ notBefore: 0, notAfter: 90_000 })).toBe(60_000);
    expect(renewAt({ notBefore: 0, notAfter: 365 * DAY })).toBe(335 * DAY);
  });
  it('the reasons a failure is shown with', () => {
    expect(reasonOf({ type: 'urn:ietf:params:acme:error:connection' }, NAME)).toMatch(/could not connect to gw\.example\.test on port 443: forward port 443/);
    expect(reasonOf({ type: 'urn:ietf:params:acme:error:dns' }, NAME)).toMatch(/could not be found in DNS/);
    expect(reasonOf({ type: 'urn:ietf:params:acme:error:malformed', detail: 'Error occurred while resolving URL' }, NAME)).toMatch(/could not be found in DNS/);
    expect(reasonOf({ type: 'urn:ietf:params:acme:error:unauthorized' }, NAME)).toMatch(/something other than this gateway/);
    // Pebble's wording for a refused connection (measured in CI): unauthorized, "Failed to connect to …".
    expect(reasonOf({ type: 'urn:ietf:params:acme:error:unauthorized', detail: 'Failed to connect to 127.0.0.2:18444 for the tls-alpn-01 challenge' }, NAME)).toMatch(/could not connect to gw\.example\.test on port 443/);
    expect(reasonOf({ type: 'urn:ietf:params:acme:error:unauthorized', detail: 'Incorrect validation certificate for tls-alpn-01 challenge.' }, NAME)).toMatch(/something other than this gateway/);
    expect(reasonOf({ type: 'urn:ietf:params:acme:error:rateLimited' }, NAME)).toMatch(/rate limit/);
    expect(reasonOf({ type: 'urn:ietf:params:acme:error:caa' }, NAME)).toMatch(/CAA/);
    expect(reasonOf({ message: 'acme: x: ECONNREFUSED' }, NAME)).toMatch(/could not be reached/);
    expect(reasonOf({ type: 'urn:ietf:params:acme:error:somethingNew' }, NAME)).toBe('Let’s Encrypt refused (somethingNew)');
    expect(retryAfterMs('120')).toBe(120_000);
    expect(retryAfterMs(new Date(Date.now() + 60_000).toUTCString())).toBeGreaterThan(55_000);
    expect(retryAfterMs('soon')).toBeNull();
  });
});

describe('the state machine against a fake CA (manager.mjs, client.mjs)', () => {
  async function world({ lifetimeMs = 90 * DAY, badNonceEvery = 0, answer = true, tlsMaxVersion } = {}) {
    const clock = { t: Date.now() };
    const now = () => clock.t;
    let door = null;
    const fake = await startFakeAcme({ doorFor: () => (answer && door ? { host: '127.0.0.1', port: door.port } : null), lifetimeMs, badNonceEvery, now, tlsMaxVersion });
    cleanups.push(() => fake.close());
    const installed = [];
    const logs = [];
    const dir = tmp();
    const m = new AcmeManager({ dir, secrets: plainSecrets, now, directoryUrl: fake.directoryUrl, transport: fake.transport, sleep: async () => {}, log: (e, d) => logs.push([e, d]), onCertificate: (c) => installed.push(c) });
    await m.load();
    door = await outsideDoor({ challengeFor: (n) => m.challengeFor(n) });
    return { m, fake, clock, installed, logs, dir, door, setAnswer: (v) => { answer = v; } };
  }

  it('issues: the account made once (terms agreed, NO contact), the challenge answered on the door, the chain checked and kept (the keys through secrets)', async () => {
    const W = await world();
    expect(W.m.status(NAME)).toMatchObject({ state: 'missing' });
    const r = await W.m.tick({ name: NAME, doorOpen: true });
    expect(r).toMatchObject({ ok: true });
    expect(W.fake.accounts.size).toBe(1);
    const acct = W.fake.log.find((l) => l.path === '/acct');
    expect(acct.payload).toEqual({ termsOfServiceAgreed: true });
    expect(W.fake.log.find((l) => l.validated === NAME)).toMatchObject({ alpn: 'acme-tls/1', names: [NAME], ok: true });
    const pair = W.m.tls(NAME);
    expect(pair.cert).toMatch(/BEGIN CERTIFICATE[\s\S]+BEGIN CERTIFICATE/); // the leaf and its issuer
    expect(new crypto.X509Certificate(pair.cert).checkPrivateKey(crypto.createPrivateKey(pair.key))).toBe(true);
    expect(W.installed).toHaveLength(1);
    expect(W.m.status(NAME)).toMatchObject({ state: 'valid', failing: null });
    for (const f of ['account-key.bin', 'outside-key.bin']) expect(fs.readFileSync(path.join(W.dir, f)).subarray(0, 6).toString()).toBe('PLAIN:');
    expect(W.m.challengeFor(NAME)).toBeNull(); // nothing held once validated
    // Kept: a new manager over the same folder knows the account and the certificate.
    const again = await new AcmeManager({ dir: W.dir, secrets: plainSecrets, now: () => W.clock.t, directoryUrl: W.fake.directoryUrl, transport: W.fake.transport }).load();
    expect(again.account.kid).toBe(W.m.account.kid);
    expect(again.tls(NAME)?.cert).toBe(pair.cert);
    // Another directory is another account.
    const other = await new AcmeManager({ dir: W.dir, secrets: plainSecrets, directoryUrl: 'https://elsewhere.test/dir' }).load();
    expect(other.account).toBeNull();
  });
  it('bad nonces are retried with the nonce the refusal carries', async () => {
    const W = await world({ badNonceEvery: 3 });
    expect(await W.m.tick({ name: NAME, doorOpen: true })).toMatchObject({ ok: true });
  });
  it('renews at a third of a short life before its end (a forced short lifetime), and only then', async () => {
    const W = await world({ lifetimeMs: 90_000 });
    await W.m.tick({ name: NAME, doorOpen: true });
    const first = W.m.cert.serial;
    W.clock.t += 50_000;
    expect(W.m.tick({ name: NAME, doorOpen: true })).toBeNull(); // 40 s left: not due (renews at 30 s left)
    W.clock.t += 11_000;
    expect(await W.m.tick({ name: NAME, doorOpen: true })).toMatchObject({ ok: true });
    expect(W.m.cert.serial).not.toBe(first);
    expect(W.installed).toHaveLength(2);
    expect(W.fake.accounts.size).toBe(1); // the same account
  });
  it('only while the outside door is open (F15): nothing with the switch off; within a tick of it coming back on, even mid-backoff', async () => {
    const W = await world({ answer: false });
    expect(W.m.tick({ name: NAME, doorOpen: false })).toBeNull();
    expect(W.fake.log).toEqual([]);
    expect(await W.m.tick({ name: NAME, doorOpen: true })).toMatchObject({ ok: false });
    expect(W.m.tick({ name: NAME, doorOpen: true })).toBeNull(); // backing off
    W.m.tick({ name: NAME, doorOpen: false }); // the switch goes off …
    W.setAnswer(true);
    expect(await W.m.tick({ name: NAME, doorOpen: true })).toMatchObject({ ok: true }); // … and on: at once
  });
  it('a failure names its reason and backs off 1 minute, 10 minutes, an hour, 6 hours; never more than six attempts an hour', async () => {
    const W = await world({ answer: false });
    const start = W.clock.t;
    expect(await W.m.tick({ name: NAME, doorOpen: true })).toMatchObject({ ok: false, reason: expect.stringContaining('forward port 443') });
    expect(W.m.state.nextAttemptAt - start).toBe(BACKOFF_MS[0]);
    expect(W.m.status(NAME)).toMatchObject({ state: 'failing', failing: { reason: expect.stringContaining('could not connect to gw.example.test') } });
    W.clock.t += BACKOFF_MS[0];
    await W.m.tick({ name: NAME, doorOpen: true });
    expect(W.m.state.nextAttemptAt - W.clock.t).toBe(BACKOFF_MS[1]);
    expect(BACKOFF_MS).toEqual([60_000, 600_000, 3_600_000, 21_600_000]);
    // The cap: the door flapping cannot make more than six attempts in an hour.
    let made = 2;
    for (let i = 0; i < 10; i++) { W.m.tick({ name: NAME, doorOpen: false }); const p = W.m.tick({ name: NAME, doorOpen: true }); if (p) { made++; await p; } }
    expect(made).toBe(MAX_ATTEMPTS_PER_HOUR);
  });
  it('something else answering for the name (acme-tls/1 with the wrong certificate) is refused by the CA: unauthorized, said so', async () => {
    // Another program on port 443 that speaks acme-tls/1 with a certificate of its own.
    const other = selfSignedFor(['door.local']);
    const imposter = tls.createServer({ cert: other.certPem, key: other.keyPem, ALPNProtocols: [ACME_TLS_ALPN] }, (s) => s.end());
    await new Promise((r) => imposter.listen(0, '127.0.0.1', r));
    cleanups.push(() => new Promise((r) => imposter.close(r)));
    const clock = { t: Date.now() };
    const fake = await startFakeAcme({ doorFor: () => ({ host: '127.0.0.1', port: imposter.address().port }), now: () => clock.t });
    cleanups.push(() => fake.close());
    const m = await new AcmeManager({ dir: tmp(), secrets: plainSecrets, now: () => clock.t, directoryUrl: fake.directoryUrl, transport: fake.transport, sleep: async () => {} }).load();
    expect(await m.tick({ name: NAME, doorOpen: true })).toMatchObject({ ok: false, reason: expect.stringContaining('something other than this gateway answered for gw.example.test on port 443') });
    expect(fake.log.find((l) => l.validated === NAME)).toMatchObject({ alpn: 'acme-tls/1', names: ['door.local'], ok: false });
    expect(m.tls(NAME)).toBeNull();
  });
  it('a program on port 443 that refuses acme-tls/1 (a web server, the office door) reads as no connection', async () => {
    const cert = selfSignedFor(['door.local']);
    const plainDoor = createDoorServer({ door: 'outside', host: '127.0.0.1', port: 0, tls: { cert: cert.certPem, key: cert.keyPem }, limits: DEFAULT_LIMITS, gate: () => ({ admit: true }), handler: (_q, r) => r.end() });
    await plainDoor.listen();
    cleanups.push(() => plainDoor.close());
    const fake = await startFakeAcme({ doorFor: () => ({ host: '127.0.0.1', port: plainDoor.port }) });
    cleanups.push(() => fake.close());
    const m = await new AcmeManager({ dir: tmp(), secrets: plainSecrets, directoryUrl: fake.directoryUrl, transport: fake.transport, sleep: async () => {} }).load();
    expect(await m.tick({ name: NAME, doorOpen: true })).toMatchObject({ ok: false, reason: expect.stringContaining('could not connect to gw.example.test on port 443') });
  });
  it('a CA that validates over TLS 1.2 only cannot pass (the door refuses acme-tls/1 there rather than show the wrong certificate)', async () => {
    const W = await world({ tlsMaxVersion: 'TLSv1.2' });
    expect(await W.m.tick({ name: NAME, doorOpen: true })).toMatchObject({ ok: false });
    expect(W.m.tls(NAME)).toBeNull();
  });
  it('a new outside name: the old certificate is not used for it, a new one is asked for at once', async () => {
    const W = await world();
    await W.m.tick({ name: NAME, doorOpen: true });
    expect(W.m.tls('gw2.example.test')).toBeNull();
    expect(await W.m.tick({ name: 'gw2.example.test', doorOpen: true })).toMatchObject({ ok: true });
    expect(W.m.tls('gw2.example.test')).not.toBeNull();
    expect(W.m.tls(NAME)).toBeNull(); // one certificate kept, the current name's
  });
  it('an expired certificate (the switch off past its end) says so, and is renewed within a tick of the door opening', async () => {
    const W = await world({ lifetimeMs: 90_000 });
    await W.m.tick({ name: NAME, doorOpen: true });
    W.m.tick({ name: NAME, doorOpen: false });
    W.clock.t += 120_000;
    expect(W.m.status(NAME)).toMatchObject({ state: 'expired' });
    expect(W.m.tls(NAME)).toBeNull();
    expect(await W.m.tick({ name: NAME, doorOpen: true })).toMatchObject({ ok: true });
    expect(W.m.status(NAME)).toMatchObject({ state: 'valid' });
  });
  it('a CA\'s answers that name another host are refused (no surprise hosts)', async () => {
    const key = newP256Key();
    const c = new AcmeClient({ directoryUrl: 'https://acme.test/dir', accountKey: key });
    c.dir = { newNonce: 'https://acme.test/n', newAccount: 'https://acme.test/a', newOrder: 'https://acme.test/o' };
    await expect(c.post('https://evil.test/x', null)).rejects.toThrow(/another host/);
    await expect(c.post('http://acme.test/x', null)).rejects.toThrow(/another host/);
  });
  it('checkIssued refuses a chain for another name or another key', () => {
    const key = newP256Key();
    const other = selfSignedFor(['other.example.test']);
    expect(() => checkIssued(other.certPem, other.keyPem, NAME)).toThrow(/not for gw\.example\.test/);
    expect(() => checkIssued(other.certPem, key.export({ type: 'pkcs8', format: 'pem' }), 'other.example.test')).toThrow(/not for the key/);
  });
});

describe('the health line: the outside certificate and its three warnings', () => {
  const now = Date.parse('2026-10-11T12:00:00Z');
  const acme = (o) => ({ kind: 'acme', name: NAME, doorOpen: true, failing: null, notAfter: now + 60 * DAY, ...o });
  it('the phrase for each state', () => {
    expect(outsideCertificatePhrase(acme({ state: 'valid' }), now).text).toBe('outside certificate: Let’s Encrypt for gw.example.test, renews itself (until 2026-12-10)');
    expect(outsideCertificatePhrase(acme({ state: 'issuing', notAfter: null }), now).text).toBe('outside certificate: getting your free certificate for gw.example.test (about a minute)');
    expect(outsideCertificatePhrase(acme({ state: 'expired', notAfter: now - DAY }), now)).toMatchObject({ tone: 'red', text: 'outside certificate: Let’s Encrypt for gw.example.test expired on 2026-10-10' });
    expect(outsideCertificatePhrase(acme({ state: 'missing', notAfter: null, doorOpen: false }), now).text).toContain('it is asked for when the switch is on');
    expect(outsideCertificatePhrase({ kind: 'own', until: now + 40 * DAY }, now).text).toBe('outside certificate: your company’s own (until 2026-11-20)');
    expect(outsideCertificatePhrase(null, now)).toBeNull();
  });
  it('a renewal failing: nothing beyond 30 days; amber from 30 with the days and the reason; red from 7; red once expired', () => {
    const failing = { reason: 'Let’s Encrypt could not connect to gw.example.test on port 443: forward port 443 on the router to this gateway’s outside port', at: now };
    expect(outsideCertificateWarning(acme({ state: 'valid', failing, notAfter: now + 31 * DAY }), now)).toBeNull();
    expect(outsideCertificateWarning(acme({ state: 'valid', failing, notAfter: now + 30 * DAY }), now)).toEqual({ tone: 'amber', text: `the outside door’s free certificate could not be renewed (${failing.reason}); it expires in 30 days, on 2026-11-10` });
    expect(outsideCertificateWarning(acme({ state: 'valid', failing, notAfter: now + 14 * DAY }), now).text).toContain('it expires in 14 days');
    expect(outsideCertificateWarning(acme({ state: 'valid', failing, notAfter: now + 7 * DAY }), now).tone).toBe('red');
    expect(outsideCertificateWarning(acme({ state: 'expired', failing, notAfter: now - DAY }), now)).toMatchObject({ tone: 'red', text: expect.stringContaining('expired on 2026-10-10 (Let’s Encrypt could not connect') });
    // A renewal that is not failing warns nothing, even inside 30 days (it renews itself).
    expect(outsideCertificateWarning(acme({ state: 'valid', notAfter: now + 20 * DAY }), now)).toBeNull();
    expect(outsideCertificateWarning(acme({ state: 'failing', notAfter: null, failing }), now).text).toContain('the outside door has no free certificate yet');
    // The company's own PEM: the same three steps.
    expect(outsideCertificateWarning({ kind: 'own', until: now + 31 * DAY }, now)).toBeNull();
    expect(outsideCertificateWarning({ kind: 'own', until: now + 30 * DAY }, now).tone).toBe('amber');
    expect(outsideCertificateWarning({ kind: 'own', until: now + 7 * DAY }, now).tone).toBe('red');
    expect(outsideCertificateWarning({ kind: 'own', until: now - 1 }, now).tone).toBe('red');
  });
  it('in the line, after the office certificate; its warning before the root\'s twelve-month notice (the sync\'s expires_warning is the first)', () => {
    const failing = { reason: 'why', at: now };
    const line = composeHealthLine({ now, name: 'PC', version: '1.0.0', lastSyncAt: now, inside: { state: 'open', addresses: [{ address: '192.168.1.10', port: 8443 }] }, outside: { state: 'open', port: 8444 }, locations: [], certificate: { kind: 'gateway', leafUntil: now + 300 * DAY, rootUntil: now + 200 * DAY, rootExpiryNotice: true }, outsideCertificate: acme({ state: 'valid', failing, notAfter: now + 10 * DAY }), update: { state: 'up_to_date' } });
    expect(line.text).toContain('certificate: renews itself (leaf until 2027-08-07; root until 2027-04-29) · outside certificate: Let’s Encrypt for gw.example.test, renews itself (until 2026-10-21) · up to date');
    expect(line.warnings.find((w) => w.text.includes('certificate')).text).toContain('the outside door’s free certificate could not be renewed (why)');
  });
});

describe('the CI job against Pebble (gateway.yml), as written', () => {
  const workflow = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..', '.github', 'workflows', 'gateway.yml'), 'utf8').replace(/\r\n/g, '\n');
  const job = workflow.slice(workflow.indexOf('\n  acme:\n'));
  it('Pebble and its DNS pinned by digest; the validator on the outside door\'s loopback port; a 90-second lifetime; nonces refused on purpose', () => {
    expect(job).toContain('ghcr.io/letsencrypt/pebble:2.10.1@sha256:ddf230642b1a584f519f32e347de1b05a6e4c1f6c35c1863b33effeab5f78199');
    expect(job).toContain('ghcr.io/letsencrypt/pebble-challtestsrv:2.10.1@sha256:12ce21884def456bcf9786542113949e1f19dc7738d2c70e156c2d0c38a1405b');
    expect(job).toContain('"tlsPort": 18444');
    expect(job).toMatch(/--port 18444/);
    expect(job).toContain('"validityPeriod": 90');
    expect(job).toContain('PEBBLE_WFE_NONCEREJECT=20');
    expect(job).toContain('PEBBLE_AUTHZREUSE=0');
    expect(job).toContain('"listenAddress": "127.0.0.1:14000"');
    expect(job).not.toMatch(/PEBBLE_VA_ALWAYS_VALID/);
    expect(job).toContain('{"host":"refused.wilson.test","addresses":["127.0.0.2"]}');
    expect(job).toContain('"domainBlocklist": ["blocked-domain.example"]');
    expect(job).not.toMatch(/^\s{4}needs:/m);
  });
  it('the script it runs proves issued, renewed and refused with the real door and the real state machine', () => {
    const script = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'e2e', 'acmePebble.mjs'), 'utf8');
    for (const s of ["import(new URL('../../src/acme/manager.mjs'", "import(new URL('../../src/doors/server.mjs'", 'acme: { challengeFor: (n) => m.challengeFor(n) }', "say('Pebble issued'", "say('Pebble renewed'", 'Pebble refused (${label})']) expect(script, s).toContain(s);
  });
});

describe('the running gateway: the free certificate on the outside door, end to end on loopback', () => {
  it('switch on with a name at 443: issued within a tick, the door re-armed with it, the line and the sync say acme; the switch off stops nothing it holds', async () => {
    const { Gateway } = await import('../src/runtime.mjs');
    const { createFakeCloud } = await import('./fakeCloud.mjs');
    const stateDir = tmp();
    fs.writeFileSync(path.join(stateDir, 'config.json'), JSON.stringify({ outside: { port: 0 } }));
    const cloud = createFakeCloud({});
    const lines = [];
    let gw;
    const fake = await startFakeAcme({ doorFor: () => (gw?.outsidePort ? { host: '127.0.0.1', port: gw.outsidePort } : null) });
    cleanups.push(() => fake.close());
    gw = new Gateway({
      env: { WILSON_CLOUD_URL: cloud.base, WILSON_ENROL_TOKEN: cloud.newToken() }, stateDir, hostname: 'studio-nas', fetchImpl: cloud.fetch, secrets: plainSecrets,
      netInterfaces: () => ({ lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true, netmask: '255.0.0.0', cidr: '127.0.0.1/8' }] }), print: (l) => lines.push(l),
      tickMs: 3_600_000, addressMs: 3_600_000, eventsMs: 3_600_000, statusMs: 3_600_000, enrolPollMs: 3_600_000,
      outsideHosts: ['127.0.0.1'], acmeDirectoryUrl: fake.directoryUrl, acmeTransport: fake.transport, acmeSleep: async () => {},
    });
    await gw.start();
    cleanups.push(async () => { await gw.stop(); });
    cloud.state.switchOn = true;
    cloud.state.outsideAddress = { host: NAME, port: 443 };
    await gw.syncNow();
    for (let i = 0; i < 50 && gw.outsideState !== 'open'; i++) { await gw.tickNow(); await new Promise((r) => setTimeout(r, 50)); }
    expect(gw.outsideState).toBe('open');
    expect(gw.acmeName()).toBe(NAME);
    // The next tick starts the attempt; wait for it, then a tick re-arms the door.
    await gw.tickNow();
    expect(gw.acme.running).toBeTruthy();
    await gw.acme.running;
    await gw.tickNow();
    const served = await new Promise((resolve, reject) => {
      const s = tls.connect({ host: '127.0.0.1', port: gw.outsidePort, servername: NAME, ca: fake.rootPem }, () => { resolve({ authorized: s.authorized, cn: s.getPeerCertificate().subject.CN }); s.end(); });
      s.on('error', reject);
    });
    expect(served).toEqual({ authorized: true, cn: NAME });
    expect(gw.healthLine().text).toMatch(/outside certificate: Let’s Encrypt for gw\.example\.test, renews itself \(until \d{4}-\d{2}-\d{2}\)/);
    await gw.syncNow();
    const report = cloud.state.gateways.get(cloud.onlyGateway()).lastReport;
    expect(report.health.certificate.outside).toBe('acme');
    expect(lines.some((l) => l.includes('acme_issued'))).toBe(true);
    // A browser's request through the door works with the issued certificate.
    const status = await new Promise((resolve, reject) => {
      const req = https.request({ host: '127.0.0.1', port: gw.outsidePort, path: '/v1/health', servername: NAME, ca: fake.rootPem, headers: { host: NAME } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(200);
  }, 30_000);
  it('switch off with a name at 443: nothing is asked of the CA, however many ticks (F15: only while the outside door is open)', async () => {
    const { Gateway } = await import('../src/runtime.mjs');
    const { createFakeCloud } = await import('./fakeCloud.mjs');
    const stateDir = tmp();
    fs.writeFileSync(path.join(stateDir, 'config.json'), JSON.stringify({ outside: { port: 0 } }));
    const cloud = createFakeCloud({});
    const fake = await startFakeAcme({ doorFor: () => null });
    cleanups.push(() => fake.close());
    const gw = new Gateway({
      env: { WILSON_CLOUD_URL: cloud.base, WILSON_ENROL_TOKEN: cloud.newToken() }, stateDir, hostname: 'studio-nas', fetchImpl: cloud.fetch, secrets: plainSecrets,
      netInterfaces: () => ({ lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true, netmask: '255.0.0.0', cidr: '127.0.0.1/8' }] }), print: () => {},
      tickMs: 3_600_000, addressMs: 3_600_000, eventsMs: 3_600_000, statusMs: 3_600_000, enrolPollMs: 3_600_000,
      outsideHosts: ['127.0.0.1'], acmeDirectoryUrl: fake.directoryUrl, acmeTransport: fake.transport, acmeSleep: async () => {},
    });
    await gw.start();
    cleanups.push(async () => { await gw.stop(); });
    cloud.state.switchOn = false;
    cloud.state.outsideAddress = { host: NAME, port: 443 };
    await gw.syncNow();
    expect(gw.acmeName()).toBe(NAME); // the name applies; only the switch holds the attempt back
    for (let i = 0; i < 5; i++) { await gw.tickNow(); await gw.acme.running; }
    expect(gw.outsideState).not.toBe('open');
    expect(gw.acme.running).toBeFalsy();
    expect({ accounts: fake.accounts.size, orders: fake.orders.size, validations: fake.log.length }).toEqual({ accounts: 0, orders: 0, validations: 0 });
  }, 30_000);
});
