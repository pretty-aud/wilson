// =============================================================================
// The outside door's free certificate (design §3, D4; review round 1, F15):
// Let's Encrypt by TLS-ALPN-01, the router-forward way only.
//
// When it applies (runtime.mjs decides; acmeNameFor below): the cloud's outside
// address is a DNS NAME at port 443 (the router maps public 443 to the outside
// door's port), there is no company PEM for the outside door (the company's
// own certificate always comes first), and no local proxy or tunnel stands in
// front of the door (it would hold its own certificate, and the challenge
// cannot pass through it; review round 2, R22).
//
// The life of it, ticked once a second by the runtime:
//
//   due          no certificate for the name, or it is within its renewal
//                window (a third of its lifetime, at most 30 days: 30 days for
//                Let's Encrypt's 90), or expired
//   only while   the outside door is open: the challenge is answered ON that
//                door, which exists only while the switch is on (F15). The first
//                certificate is therefore asked for when the switch first comes
//                on, and a certificate that lapsed while the switch was off is
//                asked for within a minute of it coming back on (the backoff is
//                cleared then)
//   an attempt   the account (made once: terms agreed, no contact); a new order
//                for the name; the tls-alpn-01 challenge's certificate held for
//                the door's hooks (challengeFor) while the CA validates; the
//                CSR from a fresh P-256 key; the chain checked (it is for the
//                name, it is the key's, its dates) and kept (the key through
//                `secrets`: DPAPI on Windows, mode 600 elsewhere)
//   a failure    its reason, in words, for the health line's warnings; tried
//                again after 1 minute, 10 minutes, an hour, then every 6 hours
//                (or the CA's own Retry-After), at most six attempts an hour
//                whatever happens (Let's Encrypt allows five failed validations
//                per name per hour)
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AcmeClient, AcmeError, LETS_ENCRYPT_DIRECTORY } from './client.mjs';
import { newP256Key, keyAuthorization } from './jose.mjs';
import { makeCsr, makeChallengeCertificate, acmeNameOk } from './certs.mjs';

const DAY = 86_400_000;
export const RENEW_BEFORE_MAX_MS = 30 * DAY;
export const BACKOFF_MS = Object.freeze([60_000, 10 * 60_000, 60 * 60_000, 6 * 3600_000]);
export const MAX_ATTEMPTS_PER_HOUR = 6;
/**
 * A rate limit's Retry-After is honoured for at most this long: seven days is
 * the longest of Let's Encrypt's windows, and a longer answer (a bug, or a
 * date in the year 9999) would stop the renewal for good (review round 1,
 * finding 4).
 */
export const MAX_RETRY_AFTER_MS = 7 * DAY;
const CHALLENGE_HOLD_MS = 3 * 60_000;

/** When a certificate is renewed: a third of its life before its end, at most 30 days before. */
export function renewAt({ notBefore, notAfter }) {
  return notAfter - Math.min(RENEW_BEFORE_MAX_MS, Math.max(0, notAfter - notBefore) / 3);
}

const PROBLEM = 'urn:ietf:params:acme:error:';

/** The reason a failure is shown with (the health line's warnings name it). */
export function reasonOf(err, name) {
  const type = String(err?.type || '').replace(PROBLEM, '');
  const detail = String(err?.detail || '');
  const couldNotConnect = `Let’s Encrypt could not connect to ${name} on port 443: forward port 443 on the router to this gateway’s outside port`;
  switch (type) {
    case 'connection': return couldNotConnect;
    case 'dns': return `the name ${name} could not be found in DNS`;
    case 'unauthorized':
    case 'incorrectResponse':
      // Let's Encrypt says `connection` for a port nobody answers on; Pebble
      // (its test server) says `unauthorized` with "Failed to connect to …"
      // (measured in CI, 2026-10-12). The detail decides.
      if (/failed to connect|connection refused|timed? ?out|no route to host/i.test(detail)) return couldNotConnect;
      return `something other than this gateway answered for ${name} on port 443`;
    case 'tls': return `the secure connection to ${name} on port 443 failed`;
    case 'caa': return `the CAA record of ${name} does not allow Let’s Encrypt`;
    case 'rateLimited': return 'Let’s Encrypt’s rate limit was reached: trying again later';
    case 'rejectedIdentifier': return `Let’s Encrypt does not issue certificates for ${name}`;
    case 'malformed': if (/resolv/i.test(detail)) return `the name ${name} could not be found in DNS`; break;
    default: break;
  }
  if (type) return `Let’s Encrypt refused (${type})`;
  if (/did not answer|took longer than|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket hang up/i.test(String(err?.message))) return 'Let’s Encrypt could not be reached from this computer';
  if (/still (pending|processing)/.test(String(err?.message))) return 'Let’s Encrypt did not finish checking in time';
  return 'the certificate could not be issued';
}

/**
 * The name the free certificate is for, or null when it does not apply: a DNS
 * name at port 443, no company PEM, no local proxy, no declared tunnel.
 */
export function acmeNameFor({ outsideAddress, config }) {
  if (!outsideAddress || outsideAddress.port !== 443) return null;
  if (config?.outside?.certificate || config?.outside?.behind_local_proxy || config?.outside?.declared_proxy) return null;
  const name = String(outsideAddress.host || '').toLowerCase().replace(/\.$/, '');
  return acmeNameOk(name) ? name : null;
}

/** The issued chain, held to what was asked: the name, the key, the dates. */
export function checkIssued(chainPem, keyPem, name, now = Date.now()) {
  const first = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/.exec(chainPem)?.[0];
  if (!first) throw new AcmeError('acme: the chain holds no certificate');
  const leaf = new crypto.X509Certificate(first);
  if (!leaf.checkPrivateKey(crypto.createPrivateKey(keyPem))) throw new AcmeError('acme: the certificate is not for the key that asked');
  if (leaf.checkHost(name, { subject: 'never' }) !== name) throw new AcmeError(`acme: the certificate is not for ${name}`);
  const notBefore = Date.parse(leaf.validFrom);
  const notAfter = Date.parse(leaf.validTo);
  if (!(notAfter > now) || !(notBefore < notAfter)) throw new AcmeError('acme: the certificate\'s dates are not usable');
  return { notBefore, notAfter, serial: leaf.serialNumber };
}

export class AcmeManager {
  /**
   * @param o { dir, secrets, now?, directoryUrl?, transport?, log?, onCertificate?: ({ cert, key, name }) => void, sleep?, fsp? }
   *        `directoryUrl` and `transport` are for the tests and the CI's Pebble run alone.
   */
  constructor(o) {
    this.dir = o.dir;
    this.secrets = o.secrets;
    this.now = o.now || Date.now;
    this.directoryUrl = o.directoryUrl || LETS_ENCRYPT_DIRECTORY;
    this.transport = o.transport || null;
    this.requestDeadlineMs = o.requestDeadlineMs; // tests only (the client's own default otherwise)
    this.log = o.log || (() => {});
    this.onCertificate = o.onCertificate || (() => {});
    this.sleep = o.sleep;
    this.fsp = o.fsp || fs.promises;
    this.account = null; // { kid, key }
    this.cert = null; // { name, certPem, keyPem, notBefore, notAfter, serial }
    this.state = { name: null, failures: 0, lastError: null, nextAttemptAt: 0, lastAttemptAt: null, lastSuccessAt: null };
    this.attempts = [];
    this.pending = new Map(); // name -> { context, until }
    this.running = null;
    this.doorWasOpen = false;
  }

  #f(n) { return path.join(this.dir, n); }

  async load() {
    await this.fsp.mkdir(this.dir, { recursive: true });
    try {
      const a = JSON.parse(await this.fsp.readFile(this.#f('account.json'), 'utf8'));
      const accountBlob = await this.fsp.readFile(this.#f('account-key.bin'));
      const keyPem = (await this.secrets.unprotect(accountBlob)).toString('utf8');
      if (a.directory === this.directoryUrl && typeof a.kid === 'string') this.account = { kid: a.kid, key: crypto.createPrivateKey(keyPem) };
      await this.#resealOnLoad('account-key.bin', accountBlob);
    } catch { this.account = null; }
    try {
      const m = JSON.parse(await this.fsp.readFile(this.#f('outside.json'), 'utf8'));
      const certPem = await this.fsp.readFile(this.#f('outside.pem'), 'utf8');
      const outsideBlob = await this.fsp.readFile(this.#f('outside-key.bin'));
      const keyPem = (await this.secrets.unprotect(outsideBlob)).toString('utf8');
      const checked = checkIssued(certPem, keyPem, m.name, Math.min(this.now(), m.notAfter - 1));
      await this.#resealOnLoad('outside-key.bin', outsideBlob);
      this.cert = { name: m.name, certPem, keyPem, notBefore: checked.notBefore, notAfter: checked.notAfter, serial: checked.serial };
    } catch { this.cert = null; }
    try {
      const s = JSON.parse(await this.fsp.readFile(this.#f('status.json'), 'utf8'));
      if (s && typeof s === 'object') this.state = { ...this.state, ...s };
    } catch { /* first run */ }
    return this;
  }

  /** P8 (TPN-ENC-014): an earlier version's plain key file, sealed again once secrets can be written. */
  async #resealOnLoad(name, blob) {
    try {
      const sealed = typeof this.secrets.reseal === 'function' ? await this.secrets.reseal(blob) : null;
      if (sealed) await this.fsp.writeFile(this.#f(name), sealed, { mode: 0o600 });
    } catch { /* counted on the line; tried again at the next start */ }
  }

  async #saveState() {
    await this.fsp.writeFile(this.#f('status.json'), JSON.stringify(this.state, null, 2), { mode: 0o600 }).catch(() => {});
  }

  async #client() {
    if (!this.account) {
      const key = newP256Key();
      const c = new AcmeClient({ directoryUrl: this.directoryUrl, accountKey: key, transport: this.transport, requestDeadlineMs: this.requestDeadlineMs, now: this.now, sleep: this.sleep });
      const kid = await c.account();
      await this.fsp.writeFile(this.#f('account-key.bin'), await this.secrets.protect(Buffer.from(key.export({ type: 'pkcs8', format: 'pem' }), 'utf8')), { mode: 0o600 });
      await this.fsp.writeFile(this.#f('account.json'), JSON.stringify({ directory: this.directoryUrl, kid, created: new Date(this.now()).toISOString(), terms: c.termsOfService }, null, 2), { mode: 0o600 });
      this.account = { kid, key };
      this.log('acme_account', { directory: this.directoryUrl, terms: c.termsOfService });
      return c;
    }
    return new AcmeClient({ directoryUrl: this.directoryUrl, accountKey: this.account.key, kid: this.account.kid, transport: this.transport, requestDeadlineMs: this.requestDeadlineMs, now: this.now, sleep: this.sleep });
  }

  /** The challenge the outside door answers for this SNI name now, or null (the door's hook). */
  challengeFor(servername) {
    const p = this.pending.get(String(servername || '').toLowerCase());
    if (!p) return null;
    if (this.now() > p.until) { this.pending.delete(String(servername).toLowerCase()); return null; }
    return p;
  }

  /** The certificate for the outside door when it is this name's and not expired; null otherwise. */
  tls(name) {
    const c = this.cert;
    if (!name || !c || c.name !== name || !(this.now() < c.notAfter)) return null;
    return { cert: c.certPem, key: c.keyPem };
  }

  /**
   * Once a second: starts an attempt when one is due and allowed. `name` is
   * acmeNameFor's (null: nothing to do); `doorOpen` whether the outside door
   * is open now. Answers the attempt in flight, if any.
   */
  tick({ name, doorOpen }) {
    const t = this.now();
    const opened = doorOpen && !this.doorWasOpen;
    this.doorWasOpen = !!doorOpen;
    if (!name || !doorOpen) return this.running;
    if (this.running) return this.running;
    if (this.state.name !== name) this.state = { ...this.state, name, failures: 0, lastError: null, nextAttemptAt: 0 };
    // F15: the switch came back on: a due certificate is asked for now, not
    // after the backoff (but never before a rate limit's own Retry-After).
    if (opened && this.state.lastError?.type !== `${PROBLEM}rateLimited`) this.state.nextAttemptAt = 0;
    const c = this.cert && this.cert.name === name ? this.cert : null;
    if (c && t < renewAt(c)) return null;
    if (t < (this.state.nextAttemptAt || 0)) return null;
    this.attempts = this.attempts.filter((a) => t - a < 3600_000);
    if (this.attempts.length >= MAX_ATTEMPTS_PER_HOUR) return null;
    this.attempts.push(t);
    this.running = this.#attempt(name).finally(() => { this.running = null; });
    return this.running;
  }

  async #attempt(name) {
    this.state.lastAttemptAt = this.now();
    this.log('acme_attempt', { name, renewing: !!(this.cert && this.cert.name === name) });
    try {
      const client = await this.#client();
      const { url: orderUrl, order } = await client.newOrder(name);
      for (const authzUrl of order.authorizations) {
        let authz = await client.get(authzUrl);
        if (authz?.status === 'valid') continue;
        if (authz?.status !== 'pending') throw new AcmeError(`acme: the authorization is ${authz?.status}`, challengeProblem(authz));
        if (authz.identifier?.type !== 'dns' || String(authz.identifier.value).toLowerCase() !== name) throw new AcmeError('acme: an authorization for another name');
        const ch = (authz.challenges || []).find((c) => c.type === 'tls-alpn-01');
        if (!ch) throw new AcmeError('acme: Let’s Encrypt offered no tls-alpn-01 challenge');
        const cert = makeChallengeCertificate(name, keyAuthorization(ch.token, client.thumbprint), { now: this.now() });
        this.pending.set(name, { context: cert.context, until: this.now() + CHALLENGE_HOLD_MS });
        try {
          await client.respond(ch.url);
          authz = await client.poll(authzUrl, ['valid'], { timeoutMs: 120_000 });
        } finally {
          this.pending.delete(name);
        }
        if (authz?.status !== 'valid') throw new AcmeError(`acme: the challenge failed (${authz?.status})`, challengeProblem(authz));
      }
      let o = await client.poll(orderUrl, ['ready', 'valid'], { timeoutMs: 60_000 });
      const key = newP256Key();
      if (o.status === 'ready') {
        await client.finalize(o.finalize, makeCsr(name, key));
        o = await client.poll(orderUrl, ['valid'], { timeoutMs: 120_000 });
      } else if (o.status === 'valid') {
        throw new AcmeError('acme: the order was valid before it was finalized'); // never ours to use: its key is not this one
      }
      if (o.status !== 'valid' || typeof o.certificate !== 'string') throw new AcmeError(`acme: the order is ${o.status}`, challengeProblem(o));
      const chain = await client.certificate(o.certificate);
      const keyPem = key.export({ type: 'pkcs8', format: 'pem' });
      const issued = checkIssued(chain, keyPem, name, this.now());
      await this.fsp.writeFile(this.#f('outside-key.bin'), await this.secrets.protect(Buffer.from(keyPem, 'utf8')), { mode: 0o600 });
      await this.fsp.writeFile(this.#f('outside.pem'), chain, { mode: 0o644 });
      await this.fsp.writeFile(this.#f('outside.json'), JSON.stringify({ name, notBefore: issued.notBefore, notAfter: issued.notAfter, serial: issued.serial, issuedAt: this.now(), directory: this.directoryUrl }, null, 2), { mode: 0o600 });
      this.cert = { name, certPem: chain, keyPem, ...issued };
      this.state = { ...this.state, name, failures: 0, lastError: null, nextAttemptAt: 0, lastSuccessAt: this.now() };
      this.log('acme_issued', { name, not_after: new Date(issued.notAfter).toISOString(), serial: issued.serial });
      try { this.onCertificate({ cert: chain, key: keyPem, name }); } catch (e) { this.log('acme_install_failed', { reason: String(e.message).slice(0, 120) }); }
      return { ok: true, notAfter: issued.notAfter };
    } catch (e) {
      const reason = reasonOf(e, name);
      const failures = (this.state.failures || 0) + 1;
      const wait = Math.max(BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)], Math.min(e?.retryAfterMs ?? 0, MAX_RETRY_AFTER_MS));
      this.state = { ...this.state, name, failures, lastError: { reason, type: e?.type ?? null, at: this.now() }, nextAttemptAt: this.now() + wait };
      this.log('acme_failed', { name, reason, type: e?.type ?? null, detail: String(e?.detail || e?.message || '').slice(0, 200), next_in_s: Math.round(wait / 1000) });
      return { ok: false, reason };
    } finally {
      await this.#saveState();
    }
  }

  /** For the health line: the free certificate's state for `name` (null when it does not apply). */
  status(name) {
    if (!name) return null;
    const t = this.now();
    const c = this.cert && this.cert.name === name ? this.cert : null;
    const failing = this.state.name === name ? this.state.lastError : null;
    let state;
    if (this.running && this.state.name === name) state = c && t < c.notAfter ? 'renewing' : 'issuing';
    else if (!c) state = failing ? 'failing' : 'missing';
    else if (t >= c.notAfter) state = 'expired';
    else state = 'valid';
    return { kind: 'acme', name, state, notAfter: c?.notAfter ?? null, failing, nextAttemptAt: this.state.nextAttemptAt || null };
  }
}

/** The problem an invalid authorization or order carries, as AcmeError's fields. */
function challengeProblem(obj) {
  const p = (obj?.challenges || []).find((c) => c?.error)?.error || obj?.error || null;
  return p ? { type: typeof p.type === 'string' ? p.type : null, detail: typeof p.detail === 'string' ? p.detail.slice(0, 300) : null } : {};
}
