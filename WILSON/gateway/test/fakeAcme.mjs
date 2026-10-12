// =============================================================================
// fakeAcme.mjs — an ACME server for the tests (GW4), on loopback, with a
// validator that does what Let's Encrypt's does for TLS-ALPN-01 (RFC 8737 §3):
// it connects to the name's address (here: the door the test names), offers
// ONLY "acme-tls/1" with the name as SNI, and accepts the answer only when the
// certificate holds exactly that one dNSName and the CRITICAL acmeIdentifier
// extension with the SHA-256 of the key authorization. Every request's JWS is
// verified (ES256, the nonce, the url, jwk for newAccount and kid after). The
// CI's Pebble job is the independent proof; this one runs on every computer.
//
// Not a CA anyone trusts: its root is made here and given to the test.
// =============================================================================

import https from 'node:https';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { seq, set, int, oid, bool, octets, bitString, utf8, time, explicit, implicitPrimitive } from '../src/certs/der.mjs';
import { selfSignedFor, loopbackLookup } from './releaseServer.mjs';
import { thumbprint } from '../src/acme/jose.mjs';

const b64u = (b) => Buffer.from(b).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');
const ACME_OID = '1.3.6.1.5.5.7.1.31';

// ── a tiny DER reader (the CSR's parts, the challenge certificate's extensions) ──
function readTlv(buf, at = 0) {
  const tag = buf[at];
  let len = buf[at + 1];
  let hdr = 2;
  if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + buf[at + 2 + i]; hdr = 2 + n; }
  return { tag, start: at, contentStart: at + hdr, end: at + hdr + len, bytes: buf.subarray(at, at + hdr + len), content: buf.subarray(at + hdr, at + hdr + len) };
}
function children(t) {
  const out = [];
  for (let at = 0; at < t.content.length;) { const c = readTlv(t.content, at); out.push(c); at = c.end; }
  return out;
}

/** The CSR's info bytes, its SPKI (DER), its signature, and its SAN dNSNames. */
export function parseCsr(der) {
  const csr = readTlv(der);
  const [info, , sig] = children(csr);
  const [, , spki, attrs] = children(info);
  const names = [];
  const walk = (t) => {
    if (t.tag === 0x82) names.push(t.content.toString('ascii'));
    if (t.tag & 0x20) for (const c of children(t)) walk(c);
    if (t.tag === 0x04 && t.content[0] === 0x30) walk(readTlv(t.content)); // an extension's value is DER inside an OCTET STRING
  };
  if (attrs) walk(attrs);
  return { info: info.bytes, spki: spki.bytes, signature: sig.content.subarray(1), names };
}

/** The acmeIdentifier extension's value (critical required) and the SAN names of a challenge certificate. */
export function challengeFacts(certDer) {
  const cert = readTlv(certDer);
  const [tbs] = children(cert);
  const ext = children(tbs).find((c) => c.tag === 0xa3);
  const facts = { names: [], acme: null, acmeCritical: false };
  if (!ext) return facts;
  for (const e of children(children(ext)[0])) {
    const parts = children(e);
    const id = parts[0].content.toString('hex');
    const critical = parts.length === 3 && parts[1].tag === 0x01 && parts[1].content[0] === 0xff;
    const value = readTlv(parts[parts.length - 1].content);
    if (id === oid(ACME_OID).subarray(2).toString('hex')) { facts.acme = readTlv(value.bytes).content; facts.acmeCritical = critical; }
    if (id === oid('2.5.29.17').subarray(2).toString('hex')) for (const n of children(value)) if (n.tag === 0x82) facts.names.push(n.content.toString('ascii'));
  }
  return facts;
}

function makeRoot() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const alg = seq(oid('1.2.840.10045.4.3.2'));
  const subject = seq(set(seq(oid('2.5.4.3'), utf8('Fake ACME root (tests)'))));
  const now = Date.now();
  const ext = (id, critical, value) => seq(oid(id), ...(critical ? [bool(true)] : []), octets(value));
  const tbs = seq(explicit(0, int(2)), int(crypto.randomBytes(8)), alg, subject, seq(time(now - 3600_000), time(now + 7 * 86_400_000)), subject, spki,
    explicit(3, seq(ext('2.5.29.19', true, seq(bool(true))), ext('2.5.29.15', true, bitString(Buffer.from([0x06]), 1)))));
  const der = seq(tbs, alg, bitString(crypto.sign('sha256', tbs, privateKey)));
  return { der, subject, key: privateKey, pem: pemOf(der) };
}
const pemOf = (der) => `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;

function issue(root, { name, spkiDer, lifetimeMs, now }) {
  const alg = seq(oid('1.2.840.10045.4.3.2'));
  const ext = (id, critical, value) => seq(oid(id), ...(critical ? [bool(true)] : []), octets(value));
  const serial = crypto.randomBytes(12); serial[0] &= 0x7f;
  const tbs = seq(explicit(0, int(2)), int(serial), alg, root.subject, seq(time(now), time(now + lifetimeMs)), seq(set(seq(oid('2.5.4.3'), utf8(name)))), spkiDer,
    explicit(3, seq(ext('2.5.29.19', true, seq()), ext('2.5.29.37', false, seq(oid('1.3.6.1.5.5.7.3.1'))), ext('2.5.29.17', false, seq(implicitPrimitive(2, Buffer.from(name, 'ascii')))))));
  return pemOf(seq(tbs, alg, bitString(crypto.sign('sha256', tbs, root.key))));
}

/**
 * @param o.doorFor(name) → { host, port } | null   where the validator connects for a name (null: nothing answers)
 * @param o.lifetimeMs     the certificates' lifetime (a short one forces renewals)
 * @param o.badNonceEvery  every Nth signed request is answered badNonce (0: never)
 * @param o.now            the CA's clock for the certificates' dates
 */
export async function startFakeAcme({ doorFor, lifetimeMs = 90 * 86_400_000, badNonceEvery = 0, now = () => Date.now(), tlsMaxVersion = 'TLSv1.3', rateLimitOrders = null } = {}) {
  let stallOrders = false; // a new order answered a byte at a time, never finished (stallOrders(true))
  const host = 'acme.test';
  const cert = selfSignedFor([host]);
  const root = makeRoot();
  const nonces = new Set();
  const accounts = new Map(); // kid -> jwk
  const orders = new Map();
  const authzs = new Map();
  const certs = new Map();
  const log = [];
  let signed = 0;
  let n = 0;
  let base = '';
  const newNonce = () => { const v = b64u(crypto.randomBytes(16)); nonces.add(v); return v; };

  const verifyJws = (body, url) => {
    const jws = JSON.parse(body);
    const header = JSON.parse(fromB64u(jws.protected).toString('utf8'));
    if (header.alg !== 'ES256') throw Object.assign(new Error('alg'), { type: 'badSignatureAlgorithm' });
    if (header.url !== url) throw Object.assign(new Error(`url ${header.url} != ${url}`), { type: 'unauthorized' });
    if (!nonces.delete(header.nonce)) throw Object.assign(new Error('nonce'), { type: 'badNonce' });
    let jwk;
    if (header.jwk) jwk = header.jwk;
    else if (header.kid && accounts.has(header.kid)) jwk = accounts.get(header.kid);
    else throw Object.assign(new Error('no account'), { type: 'accountDoesNotExist' });
    const key = crypto.createPublicKey({ key: { ...jwk }, format: 'jwk' });
    const ok = crypto.verify('sha256', Buffer.from(`${jws.protected}.${jws.payload}`, 'ascii'), { key, dsaEncoding: 'ieee-p1363' }, fromB64u(jws.signature));
    if (!ok) throw Object.assign(new Error('signature'), { type: 'unauthorized' });
    return { header, jwk, payload: jws.payload === '' ? null : JSON.parse(fromB64u(jws.payload).toString('utf8')) };
  };

  async function validate(a) {
    const target = doorFor(a.name);
    const ka = `${a.token}.${thumbprint(a.jwk)}`;
    const expected = crypto.createHash('sha256').update(ka, 'utf8').digest();
    if (!target) { a.status = 'invalid'; a.error = { type: 'urn:ietf:params:acme:error:connection', detail: `${a.name}: connection refused` }; return; }
    await new Promise((resolve) => {
      const s = tls.connect({ host: target.host, port: target.port, servername: a.name, ALPNProtocols: ['acme-tls/1'], rejectUnauthorized: false, maxVersion: tlsMaxVersion }, () => {
        const der = s.getPeerX509Certificate()?.raw;
        const facts = der ? challengeFacts(der) : { names: [] };
        const ok = s.alpnProtocol === 'acme-tls/1' && facts.names.length === 1 && facts.names[0] === a.name && facts.acmeCritical && facts.acme && crypto.timingSafeEqual(facts.acme, expected);
        log.push({ validated: a.name, alpn: s.alpnProtocol, names: facts.names, ok });
        a.status = ok ? 'valid' : 'invalid';
        if (!ok) a.error = { type: 'urn:ietf:params:acme:error:unauthorized', detail: 'Incorrect validation certificate for tls-alpn-01 challenge' };
        s.end();
        resolve();
      });
      s.on('error', (e) => { a.status = 'invalid'; a.error = { type: 'urn:ietf:params:acme:error:connection', detail: `${a.name}: ${e.code || e.message}` }; log.push({ validated: a.name, error: e.code || e.message }); resolve(); });
    });
  }

  const server = https.createServer({ cert: cert.certPem, key: cert.keyPem }, (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const url = `${base}${req.url}`;
      const send = (status, body, headers = {}) => {
        res.writeHead(status, { 'replay-nonce': newNonce(), 'content-type': 'application/json', ...headers });
        res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
      };
      const problem = (status, type, detail, headers = {}) => send(status, { type: `urn:ietf:params:acme:error:${type}`, detail, status }, { 'content-type': 'application/problem+json', ...headers });
      try {
        if (req.method === 'GET' && req.url === '/dir') return send(200, { newNonce: `${base}/nonce`, newAccount: `${base}/acct`, newOrder: `${base}/order`, meta: { termsOfService: `${base}/terms` } });
        if (req.url === '/nonce') { res.writeHead(200, { 'replay-nonce': newNonce(), 'cache-control': 'no-store' }); return res.end(); }
        if (req.method !== 'POST') return problem(405, 'malformed', 'POST only');
        if (req.headers['content-type'] !== 'application/jose+json') return problem(415, 'malformed', 'content-type');
        signed++;
        if (badNonceEvery && signed % badNonceEvery === 0) return problem(400, 'badNonce', 'a nonce refused on purpose');
        const { header, jwk, payload } = verifyJws(Buffer.concat(chunks).toString('utf8'), url);
        log.push({ method: 'POST', path: req.url, kid: !!header.kid, payload });
        if (req.url === '/acct') {
          if (!payload?.termsOfServiceAgreed) return problem(400, 'malformed', 'terms');
          const tp = thumbprint(jwk);
          const kid = `${base}/acct/${tp.slice(0, 12)}`;
          const fresh = !accounts.has(kid);
          accounts.set(kid, jwk);
          return send(fresh ? 201 : 200, { status: 'valid', contact: payload.contact ?? [] }, { location: kid });
        }
        if (req.url === '/order') {
          if (rateLimitOrders) return problem(429, 'rateLimited', 'too many new orders recently', { 'retry-after': rateLimitOrders });
          if (stallOrders) { res.writeHead(201, { 'content-type': 'application/json' }); const drip = setInterval(() => res.write(' '), 50); res.on('close', () => clearInterval(drip)); return undefined; }
          const name = payload?.identifiers?.[0]?.value;
          const id = ++n;
          const authzId = `a${id}`;
          authzs.set(authzId, { name, status: 'pending', token: b64u(crypto.randomBytes(32)), jwk, error: null });
          orders.set(String(id), { name, status: 'pending', authz: authzId, cert: null });
          return send(201, { status: 'pending', identifiers: [{ type: 'dns', value: name }], authorizations: [`${base}/authz/${authzId}`], finalize: `${base}/finalize/${id}` }, { location: `${base}/order/${id}` });
        }
        let m;
        if ((m = /^\/authz\/(a\d+)$/.exec(req.url))) {
          const a = authzs.get(m[1]);
          return send(200, { status: a.status, identifier: { type: 'dns', value: a.name }, challenges: [
            { type: 'http-01', url: `${base}/chall/${m[1]}/http`, token: a.token, status: 'pending' },
            { type: 'tls-alpn-01', url: `${base}/chall/${m[1]}`, token: a.token, status: a.status === 'invalid' ? 'invalid' : a.status, ...(a.error ? { error: a.error } : {}) },
          ] }, { 'retry-after': '1' });
        }
        if ((m = /^\/chall\/(a\d+)$/.exec(req.url))) {
          const a = authzs.get(m[1]);
          if (a.status === 'pending') { a.status = 'processing'; validate(a).catch(() => {}); }
          return send(200, { type: 'tls-alpn-01', status: a.status, token: a.token });
        }
        if ((m = /^\/order\/(\d+)$/.exec(req.url))) {
          const o = orders.get(m[1]);
          const a = authzs.get(o.authz);
          if (o.status === 'pending' && a.status === 'valid') o.status = 'ready';
          if (o.status === 'pending' && a.status === 'invalid') o.status = 'invalid';
          return send(200, { status: o.status, identifiers: [{ type: 'dns', value: o.name }], authorizations: [`${base}/authz/${o.authz}`], finalize: `${base}/finalize/${m[1]}`, ...(o.cert ? { certificate: `${base}/cert/${m[1]}` } : {}) });
        }
        if ((m = /^\/finalize\/(\d+)$/.exec(req.url))) {
          const o = orders.get(m[1]);
          if (o.status !== 'ready') return problem(403, 'orderNotReady', o.status);
          const csr = parseCsr(fromB64u(payload.csr));
          const pub = crypto.createPublicKey({ key: csr.spki, format: 'der', type: 'spki' });
          if (!crypto.verify('sha256', csr.info, pub, csr.signature)) return problem(400, 'badCSR', 'signature');
          if (csr.names.length !== 1 || csr.names[0] !== o.name) return problem(400, 'badCSR', `names ${csr.names}`);
          o.cert = issue(root, { name: o.name, spkiDer: csr.spki, lifetimeMs, now: now() }) + root.pem;
          o.status = 'valid';
          certs.set(m[1], o.cert);
          return send(200, { status: 'processing', finalize: `${base}/finalize/${m[1]}` }, { 'retry-after': '1' });
        }
        if ((m = /^\/cert\/(\d+)$/.exec(req.url))) return send(200, certs.get(m[1]), { 'content-type': 'application/pem-certificate-chain' });
        return problem(404, 'malformed', 'no such route');
      } catch (e) {
        return problem(e.type === 'badNonce' ? 400 : 403, e.type || 'serverInternal', e.message);
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  base = `https://${host}:${port}`;
  return {
    directoryUrl: `${base}/dir`,
    transport: { ca: cert.certPem, lookup: loopbackLookup, port },
    rootPem: root.pem,
    log,
    accounts,
    stallOrders: (v) => { stallOrders = !!v; },
    orders,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}
