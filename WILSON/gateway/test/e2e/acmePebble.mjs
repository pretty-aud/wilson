#!/usr/bin/env node
// =============================================================================
// acmePebble.mjs — the outside door's free certificate against Pebble, Let's
// Encrypt's test server (GW4, item 3), run by .github/workflows/gateway.yml's
// "ACME against Pebble" job on Ubuntu. Never on Audrey's computer: it needs
// Pebble, and it listens on the port Pebble's validator is told to use.
//
// Pebble (with pebble-challtestsrv as its DNS) is told: every name resolves
// to 127.0.0.1, except the refused name (127.0.0.2, where nothing listens);
// TLS-ALPN-01 is checked on --port (the outside door here, on 127.0.0.1); a
// certificate lives 90 s (a forced short lifetime); one name is on its block
// list; and it refuses a fifth of the nonces on purpose.
//
// The REAL door (createDoorServer with the ACME hooks) and the REAL state
// machine (AcmeManager) are proven to:
//   1  issue for --name: the challenge answered on the door, the chain
//      verified against Pebble's own root, the door re-armed with it
//   2  renew at a third of the short life before its end, by the manager's
//      own rule, with a new serial the door then serves
//   3  be refused for a name the account does not control (it points at an
//      address where nothing answers), and for a name the CA will not issue
//      for, each with the reason the health line would show
//
//   node acmePebble.mjs --directory https://127.0.0.1:14000/dir --ca pebble.minica.pem
//        --root https://127.0.0.1:15000/roots/0 --port 18444 --name gw.wilson.test
//        --refused refused.wilson.test --blocked blocked-domain.example
// =============================================================================

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { AcmeManager } = await import(new URL('../../src/acme/manager.mjs', import.meta.url));
const { createDoorServer } = await import(new URL('../../src/doors/server.mjs', import.meta.url));
const { DEFAULT_LIMITS } = await import(new URL('../../src/rules/limits.mjs', import.meta.url));
const { outsideCertificateWarning } = await import(new URL('../../src/rules/health.mjs', import.meta.url));
const { selfSignedFor } = await import(new URL('../releaseServer.mjs', import.meta.url));

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : null; };
const directoryUrl = arg('directory');
const ca = fs.readFileSync(arg('ca'), 'utf8');
const port = Number(arg('port'));
const name = arg('name');
const refused = arg('refused');
const blocked = arg('blocked');
const report = { steps: [] };
const say = (title, text) => process.stdout.write(`::notice title=${title}::${text}\n`);
const die = (text) => { process.stdout.write(`::error::${text}\n`); process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); process.exit(1); };
const plainSecrets = { protect: async (b) => Buffer.concat([Buffer.from('PLAIN:'), b]), unprotect: async (b) => b.subarray(6) };

/** Pebble's issuing root, from its management interface (it is made fresh at every start). */
function pebbleRoot() {
  return new Promise((resolve, reject) => {
    https.get(arg('root'), { ca }, (res) => { let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve(s)); }).on('error', reject);
  });
}

/** What the door serves to a browser for `servername`, verified against `rootPem`. */
function served(servername, rootPem) {
  return new Promise((resolve) => {
    const s = tls.connect({ host: '127.0.0.1', port, servername, ca: rootPem, ALPNProtocols: ['http/1.1'] }, () => {
      const c = s.getPeerCertificate();
      resolve({ authorized: s.authorized, serial: c.serialNumber, valid_to: c.valid_to, san: c.subjectaltname });
      s.end();
    });
    s.on('error', (e) => resolve({ authorized: false, error: e.code || e.message }));
  });
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw4-pebble-'));
const logs = [];
const m = new AcmeManager({ dir, secrets: plainSecrets, directoryUrl, transport: { ca }, log: (e, d) => logs.push({ e, ...d }) });
await m.load();
const fallback = selfSignedFor(['door.local']);
const door = createDoorServer({
  door: 'outside', host: '127.0.0.1', port, tls: { cert: fallback.certPem, key: fallback.keyPem }, limits: DEFAULT_LIMITS,
  gate: () => ({ admit: true }), handler: (_q, r) => r.end('door'), acme: { challengeFor: (n) => m.challengeFor(n) },
  onEvent: (e, d) => logs.push({ e, ...d }),
});
await door.listen();
const arm = () => { const t = m.tls(name); if (t) door.setCertificate(t); return !!t; };

try {
  // 1. Issued.
  const first = await m.tick({ name, doorOpen: true });
  if (!first?.ok) die(`not issued for ${name}: ${first?.reason} (${JSON.stringify(logs.slice(-3))})`);
  arm();
  const root = await pebbleRoot();
  const s1 = await served(name, root);
  report.steps.push({ step: 'issued', ...s1, challenges_answered: logs.filter((l) => l.e === 'acme_challenge_answered').length });
  if (!s1.authorized || s1.san !== `DNS:${name}`) die(`the door does not serve a certificate Pebble's root verifies for ${name}: ${JSON.stringify(s1)}`);
  say('Pebble issued', `${name}: serial ${s1.serial}, valid to ${s1.valid_to}, verified against Pebble's root; ${report.steps[0].challenges_answered} TLS-ALPN-01 handshake(s) answered on the door`);

  // 2. Renewed by the manager's own rule (a third of 90 s before the end).
  const until = Date.now() + 120_000;
  let renewed = null;
  while (Date.now() < until) {
    const p = m.tick({ name, doorOpen: true });
    if (p) { renewed = await p; break; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!renewed?.ok) die(`not renewed within 120 s: ${renewed?.reason ?? 'no attempt was due'}`);
  arm();
  const s2 = await served(name, root);
  report.steps.push({ step: 'renewed', ...s2 });
  if (!s2.authorized || s2.serial === s1.serial) die(`the renewal did not reach the door: ${JSON.stringify({ s1, s2 })}`);
  say('Pebble renewed', `${name}: a new serial ${s2.serial} (was ${s1.serial}), valid to ${s2.valid_to}, served by the door`);

  // 3. Refused: a name that points where this gateway is not; a name the CA will not issue for.
  for (const [label, n, want] of [['not controlled', refused, /could not connect to/], ['blocked', blocked, /does not issue certificates for|refused/]]) {
    const r = await m.tick({ name: n, doorOpen: true });
    const warning = outsideCertificateWarning({ ...m.status(n), doorOpen: true }, Date.now());
    const failed = logs.filter((l) => l.e === 'acme_failed' && l.name === n).at(-1) || null;
    const answered = logs.filter((l) => l.e === 'acme_challenge_answered' && l.servername === n).length;
    report.steps.push({ step: `refused (${label})`, name: n, result: r, warning: warning?.text ?? null, ca_said: failed?.detail ?? null, type: failed?.type ?? null, answered_on_this_door: answered });
    if (!r || r.ok || !want.test(r.reason) || m.tls(n)) {
      // What the CA's DNS says for the name, and what answers there for acme-tls/1.
      const { Resolver } = await import('node:dns/promises');
      const resolver = new Resolver(); resolver.setServers(['127.0.0.1:8053']);
      const a = await resolver.resolve4(n).catch((e) => `A: ${e.code}`);
      const aaaa = await resolver.resolve6(n).catch((e) => `AAAA: ${e.code}`);
      const there = Array.isArray(a) && a[0] ? await new Promise((resolve) => {
        const s = tls.connect({ host: a[0], port, servername: n, ALPNProtocols: ['acme-tls/1'], rejectUnauthorized: false }, () => { resolve({ alpn: s.alpnProtocol, san: s.getPeerCertificate().subjectaltname }); s.end(); });
        s.on('error', (e) => resolve({ error: e.code || e.message }));
      }) : null;
      die(`${n} was not refused as expected: ${JSON.stringify(r)}; the CA said: ${failed?.type} ${failed?.detail}; challenges for it answered on this door: ${answered}; its DNS here: A ${JSON.stringify(a)}, AAAA ${JSON.stringify(aaaa)}; at that address: ${JSON.stringify(there)}`);
    }
    say(`Pebble refused (${label})`, `${n}: ${r.reason}; the health line says: ${warning?.text}`);
  }
  report.ok = true;
  report.nonce_retries_survived = 'PEBBLE_WFE_NONCEREJECT';
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await door.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
void HERE;
