// =============================================================================
// releaseServer.mjs — GitHub Releases, played on loopback for the update path's
// tests (GW4). One HTTPS server on 127.0.0.1 with one self-signed certificate
// for GitHub's three release hosts and one host that is not GitHub's; the
// client reaches it through releaseFetch's test-only `transport` (a resolver
// that answers 127.0.0.1 for every name, this certificate as the CA, this
// port), so the code under test checks the REAL host names and allow-list.
//
// The chain it plays, as measured on 2026-10-11:
//   github.com/pretty-aud/wilson/releases/latest/download/<asset>   302
//   github.com/pretty-aud/wilson/releases/download/<tag>/<asset>    302
//   release-assets.githubusercontent.com/github-production-release-asset/<n>?sig=…   200
// Each route can be replaced by a test (a redirect elsewhere, other bytes).
// =============================================================================

import https from 'node:https';
import crypto from 'node:crypto';
import { seq, set, int, oid, bool, octets, bitString, utf8, time, explicit, implicitPrimitive } from '../src/certs/der.mjs';

export const RELEASE_TEST_NAMES = ['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'evil.example', 'github.com.evil.example'];

/** A self-signed ECDSA certificate (CA:TRUE, so it is its own trust anchor) for the given DNS names. */
export function selfSignedFor(names, { days = 2 } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const alg = seq(oid('1.2.840.10045.4.3.2'));
  const subject = seq(set(seq(oid('2.5.4.3'), utf8('release test'))));
  const now = Date.now();
  const ext = (id, critical, value) => seq(oid(id), ...(critical ? [bool(true)] : []), octets(value));
  const tbs = seq(
    explicit(0, int(2)),
    int(crypto.randomBytes(12)),
    alg,
    subject,
    seq(time(now - 3600_000), time(now + days * 86_400_000)),
    subject,
    spki,
    explicit(3, seq(
      ext('2.5.29.19', true, seq(bool(true))),
      ext('2.5.29.15', true, bitString(Buffer.from([0x84]), 2)), // digitalSignature | keyCertSign
      ext('2.5.29.37', false, seq(oid('1.3.6.1.5.5.7.3.1'))),
      ext('2.5.29.17', false, seq(...names.map((n) => implicitPrimitive(2, Buffer.from(n, 'ascii'))))),
    )),
  );
  const der = seq(tbs, alg, bitString(crypto.sign('sha256', tbs, privateKey)));
  const certPem = `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
  return { certPem, keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

/** Every name resolves to loopback (both of Node's lookup shapes). */
export function loopbackLookup(_host, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  if (opts && opts.all) cb(null, [{ address: '127.0.0.1', family: 4 }]);
  else cb(null, '127.0.0.1', 4);
}

const REPO = '/pretty-aud/wilson/releases';

/**
 * @param o.assets  { 'stable.json': Buffer, 'stable.json.sig': string|Buffer, '<artefact name>': Buffer }
 * @param o.tag     the tag "latest" resolves to
 */
export async function startReleaseServer({ assets = {}, tag = 'gateway-v9.0.0' } = {}) {
  const cert = selfSignedFor(RELEASE_TEST_NAMES);
  const hits = [];
  const state = { assets: { ...assets }, tag, override: null };
  const ids = new Map();
  const idFor = (name) => { if (!ids.has(name)) ids.set(name, String(100000 + ids.size)); return ids.get(name); };
  const server = https.createServer({ cert: cert.certPem, key: cert.keyPem }, (req, res) => {
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    const url = req.url;
    // For the asset store: which asset an id stands for (a test's override reads it).
    const storeId = host === 'release-assets.githubusercontent.com' ? /^\/github-production-release-asset\/(\d+)\?/.exec(url)?.[1] : null;
    const assetName = storeId ? [...ids.entries()].find(([, id]) => id === storeId)?.[0] ?? null : null;
    hits.push({ host, url, ua: req.headers['user-agent'] || null, servername: req.socket.servername || null, assetName });
    if (state.override) {
      const r = state.override({ host, url, req, res, state, assetName });
      if (r !== undefined) return;
    }
    const redirect = (to) => { res.writeHead(302, { location: to }); res.end(); };
    let m;
    if (host === 'github.com' && (m = new RegExp(`^${REPO}/latest/download/([^/?#]+)$`).exec(url))) return redirect(`https://github.com${REPO}/download/${state.tag}/${m[1]}`);
    if (host === 'github.com' && (m = new RegExp(`^${REPO}/download/([^/?#]+)/([^/?#]+)$`).exec(url))) {
      if (m[1] !== state.tag && !state.assets[`${m[1]}/${m[2]}`]) { res.writeHead(404); res.end(); return undefined; }
      const name = state.assets[`${m[1]}/${m[2]}`] ? `${m[1]}/${m[2]}` : m[2];
      return redirect(`https://release-assets.githubusercontent.com/github-production-release-asset/${idFor(name)}?sp=r&sig=${crypto.randomBytes(6).toString('hex')}`);
    }
    if (host === 'release-assets.githubusercontent.com' && (m = /^\/github-production-release-asset\/(\d+)\?/.exec(url))) {
      const name = [...ids.entries()].find(([, id]) => id === m[1])?.[0];
      const body = name != null ? state.assets[name] : undefined;
      if (body == null) { res.writeHead(404); res.end(); return undefined; }
      const b = Buffer.from(body);
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': b.length });
      res.end(b);
      return undefined;
    }
    res.writeHead(404); res.end();
    return undefined;
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    port,
    hits,
    state,
    transport: { lookup: loopbackLookup, ca: cert.certPem, port },
    channelUrl: `https://github.com${REPO}/latest/download/stable.json`,
    assetUrl: (name, t = state.tag) => `https://github.com${REPO}/download/${t}/${name}`,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}
