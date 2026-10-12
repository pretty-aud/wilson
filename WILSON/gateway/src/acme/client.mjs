// =============================================================================
// The ACME client (RFC 8555), for one thing: a certificate for the outside
// door's name by TLS-ALPN-01 (RFC 8737). Node's https and crypto only (the
// request-path rule: built-ins, no dependency).
//
//   * HTTPS only, to the directory's own origin and the URLs its answers name;
//     no redirect is followed (ACME never redirects); every answer capped
//     (1 MB) and timed (30 s)
//   * every POST a JWS (jose.mjs); a badNonce answer is retried with the nonce
//     it carries, at most three times (RFC 8555 §6.5)
//   * Retry-After honoured, capped, when polling
//   * the account: made once with the terms agreed and NO contact (no email
//     is sent anywhere), its URL kept as the kid
//
// `transport` ({ ca, lookup, port }) is for the tests and the CI's Pebble run
// alone; nothing in config.json or the environment reaches it.
// =============================================================================

import https from 'node:https';
import { signJws, jwkOf, thumbprint } from './jose.mjs';
import { VERSION } from '../version.mjs';

export const LETS_ENCRYPT_DIRECTORY = 'https://acme-v02.api.letsencrypt.org/directory';
const MAX_BODY = 1024 * 1024;
const TIMEOUT_MS = 30_000;
/** One request, start to end, at most this long (review round 1, finding 4). */
export const REQUEST_DEADLINE_MS = 120_000;
const PROBLEM = 'urn:ietf:params:acme:error:';

export class AcmeError extends Error {
  constructor(message, { type = null, status = null, retryAfterMs = null, detail = null } = {}) {
    super(message);
    this.type = type;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.detail = detail;
  }
}

/** Retry-After as milliseconds (seconds or an HTTP date), or null. */
export function retryAfterMs(value, now = Date.now()) {
  if (value == null) return null;
  const s = String(value).trim();
  if (/^\d{1,7}$/.test(s)) return Number(s) * 1000;
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.max(0, t - now) : null;
}

function request(url, { method = 'GET', body = null, headers = {}, transport = null, deadlineMs = REQUEST_DEADLINE_MS }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    if (u.protocol !== 'https:') { reject(new AcmeError(`acme: ${u.protocol} is not https`)); return; }
    let timer = null;
    let ours = null; // a refusal of ours that ended the request: the silence, the deadline, the size
    const settle = (fn) => (v) => { clearTimeout(timer); fn(v); };
    const failed = (e) => settle(reject)(ours ?? (e instanceof AcmeError ? e : new AcmeError(`acme: ${u.hostname}: ${e.code || e.message}`)));
    const end = (e) => { ours = ours ?? e; req.destroy(e); };
    const req = https.request(u, {
      method,
      headers: { 'user-agent': `wilson-gateway/${VERSION} (acme)`, accept: 'application/json', ...headers, ...(body ? { 'content-length': Buffer.byteLength(body) } : {}) },
      agent: false,
      timeout: TIMEOUT_MS,
      ...(transport?.ca ? { ca: transport.ca } : {}),
      ...(transport?.lookup ? { lookup: transport.lookup } : {}),
      ...(transport?.port ? { port: transport.port } : {}),
    }, (res) => {
      const chunks = [];
      let n = 0;
      res.on('data', (c) => {
        n += c.length;
        if (n > MAX_BODY) { ours = ours ?? new AcmeError(`acme: ${u.hostname} answered more than ${MAX_BODY} bytes`); res.destroy(ours); return; }
        chunks.push(c);
      });
      res.on('end', () => settle(resolve)({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', failed);
    });
    // The whole call, however the peer paces its bytes: a CA, or something on
    // the path, that answers a byte at a time cannot hold the renewal for
    // ever (review round 1, finding 4). TIMEOUT_MS is the longest silence.
    timer = setTimeout(() => end(new AcmeError(`acme: ${u.hostname} took longer than ${Math.round(deadlineMs / 1000)} s`)), deadlineMs);
    req.on('timeout', () => end(new AcmeError(`acme: ${u.hostname} did not answer within ${TIMEOUT_MS / 1000} s`)));
    req.on('error', failed);
    if (body) req.write(body);
    req.end();
  });
}

function parseJson(res) {
  try { return JSON.parse(res.body.toString('utf8')); } catch { return null; }
}

export class AcmeClient {
  /**
   * @param o { directoryUrl, accountKey: KeyObject (P-256 private), kid?: string, transport?, now?, sleep? }
   */
  constructor(o) {
    this.directoryUrl = o.directoryUrl || LETS_ENCRYPT_DIRECTORY;
    this.key = o.accountKey;
    this.kid = o.kid || null;
    this.transport = o.transport || null;
    this.requestDeadlineMs = o.requestDeadlineMs || REQUEST_DEADLINE_MS; // tests only: a shorter one
    this.now = o.now || Date.now;
    this.sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.dir = null;
    this.nonces = [];
    this.thumbprint = thumbprint(jwkOf(this.key));
  }

  /** A URL an answer named, held to the directory's own origin (no surprise hosts). */
  #sameOrigin(url) {
    let u;
    try { u = new URL(url); } catch { throw new AcmeError('acme: an answer named no URL'); }
    if (u.protocol !== 'https:' || u.origin !== new URL(this.directoryUrl).origin) throw new AcmeError(`acme: an answer named another host (${u.origin})`);
    return u.href;
  }

  async directory() {
    if (this.dir) return this.dir;
    const res = await request(this.directoryUrl, { transport: this.transport, deadlineMs: this.requestDeadlineMs });
    const d = res.status === 200 ? parseJson(res) : null;
    if (!d || typeof d.newNonce !== 'string' || typeof d.newAccount !== 'string' || typeof d.newOrder !== 'string') throw new AcmeError(`acme: the directory at ${this.directoryUrl} is not an ACME directory (${res.status})`);
    for (const k of ['newNonce', 'newAccount', 'newOrder']) d[k] = this.#sameOrigin(d[k]);
    this.dir = d;
    return d;
  }

  async #nonce() {
    if (this.nonces.length) return this.nonces.pop();
    const d = await this.directory();
    const res = await request(d.newNonce, { method: 'HEAD', transport: this.transport, deadlineMs: this.requestDeadlineMs });
    const n = res.headers['replay-nonce'];
    if (!n) throw new AcmeError('acme: no Replay-Nonce from newNonce');
    return n;
  }

  #keep(res) {
    const n = res.headers['replay-nonce'];
    if (typeof n === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(n)) this.nonces = [n];
  }

  /**
   * One signed POST (payload null = POST-as-GET). Answers { status, headers,
   * json, body }; an ACME problem becomes an AcmeError with its type.
   */
  async post(url, payload, { jwk = false, accept = 'application/json' } = {}) {
    const target = this.#sameOrigin(url);
    for (let attempt = 0; ; attempt++) {
      const nonce = await this.#nonce();
      const jws = signJws({ key: this.key, url: target, nonce, payload, kid: jwk ? null : this.kid });
      const res = await request(target, { method: 'POST', body: JSON.stringify(jws), headers: { 'content-type': 'application/jose+json', accept }, transport: this.transport, deadlineMs: this.requestDeadlineMs });
      this.#keep(res);
      if (res.status < 400) return { status: res.status, headers: res.headers, json: parseJson(res), body: res.body };
      const p = parseJson(res) || {};
      const type = typeof p.type === 'string' ? p.type : null;
      if (type === `${PROBLEM}badNonce` && attempt < 3) continue;
      const detail = typeof p.detail === 'string' ? p.detail.slice(0, 300) : null;
      throw new AcmeError(`acme: ${type ? type.replace(PROBLEM, '') : res.status}${detail ? `: ${detail}` : ''}`, { type, status: res.status, retryAfterMs: retryAfterMs(res.headers['retry-after'], this.now()), detail });
    }
  }

  /** The account: found or made (terms agreed, no contact). Answers its URL, kept as the kid. */
  async account() {
    if (this.kid) return this.kid;
    const d = await this.directory();
    const r = await this.post(d.newAccount, { termsOfServiceAgreed: true }, { jwk: true });
    const kid = r.headers.location;
    if (typeof kid !== 'string' || !kid) throw new AcmeError('acme: the account has no URL');
    this.kid = this.#sameOrigin(kid);
    return this.kid;
  }

  get termsOfService() { return this.dir?.meta?.termsOfService ?? null; }

  async newOrder(name) {
    const d = await this.directory();
    await this.account();
    const r = await this.post(d.newOrder, { identifiers: [{ type: 'dns', value: name }] });
    const url = r.headers.location;
    if (typeof url !== 'string' || !r.json || !Array.isArray(r.json.authorizations) || typeof r.json.finalize !== 'string') throw new AcmeError('acme: the order is not an order');
    return { url: this.#sameOrigin(url), order: r.json };
  }

  async get(url) { return (await this.post(url, null)).json; }

  /**
   * Polls `url` (POST-as-GET) until its status is one of `done`, honouring
   * Retry-After (at most `maxWaitMs` a wait), for at most `timeoutMs`.
   */
  async poll(url, done, { timeoutMs = 90_000, maxWaitMs = 10_000, minWaitMs = 1_000 } = {}) {
    const until = this.now() + timeoutMs;
    for (;;) {
      const r = await this.post(url, null);
      const s = r.json?.status;
      if (done.includes(s)) return r.json;
      if (s === 'invalid') return r.json;
      if (this.now() >= until) throw new AcmeError(`acme: still ${s} after ${Math.round(timeoutMs / 1000)} s`);
      const wait = Math.min(maxWaitMs, Math.max(minWaitMs, retryAfterMs(r.headers['retry-after'], this.now()) ?? minWaitMs));
      await this.sleep(wait);
    }
  }

  async respond(challengeUrl) { return (await this.post(challengeUrl, {})).json; }

  async finalize(finalizeUrl, csrDer) {
    return (await this.post(finalizeUrl, { csr: Buffer.from(csrDer).toString('base64url') })).json;
  }

  /** The certificate chain, PEM. */
  async certificate(url) {
    const r = await this.post(url, null, { accept: 'application/pem-certificate-chain' });
    const pem = r.body.toString('utf8');
    if (!/^-----BEGIN CERTIFICATE-----/.test(pem.trim())) throw new AcmeError('acme: the certificate is not PEM');
    return pem;
  }
}
