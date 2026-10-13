// =============================================================================
// The certificates' life (design §3 "The day it expires").
//
//   first run        the root and the leaf are made; the fingerprint printed
//   every start and  the leaf is re-made when it is missing, expired, within 30
//   every address      days of its end, signed by another root, or its names and
//   change             addresses are not exactly the host's now
//   an address that  a NEW root (the old one kept as root-previous): browsers
//   leaves the root's  must trust it again, and the health line says so in red
//   /24s (or /64s)
//   twelve months    the next root is made and offered beside the old one
//   before the root's
//   end
//   one month before  the leaf moves to the next root
//
// Private keys go through `secrets` (DPAPI on Windows, the file's mode
// elsewhere: platform/secrets.mjs); certificates are public and stored plain.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { makeRoot, makeLeaf, certInfo, hostNames, permittedFor } from './x509.mjs';
import { cidrContains, normalizeIp } from '../rules/ip.mjs';

const DAY = 86_400_000;
export const LEAF_RENEW_DAYS = 30;
export const NEXT_ROOT_DAYS = 365;
export const SWITCH_ROOT_DAYS = 31;

const sameSet = (a, b) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

export class CertStore {
  constructor({ dir, secrets, hostname, now = Date.now, fsp = fs.promises }) {
    this.dir = dir;
    this.secrets = secrets;
    this.hostname = hostname;
    this.now = now;
    this.fsp = fsp;
    this.root = null; // { certPem, keyPem, meta }
    this.next = null;
    this.leaf = null; // { certPem, keyPem, meta }
  }

  #f(name) { return path.join(this.dir, name); }

  async #readPair(prefix) {
    try {
      const certPem = await this.fsp.readFile(this.#f(`${prefix}.pem`), 'utf8');
      const keyPem = (await this.secrets.unprotect(await this.fsp.readFile(this.#f(`${prefix}-key.bin`)))).toString('utf8');
      const meta = JSON.parse(await this.fsp.readFile(this.#f(`${prefix}.json`), 'utf8'));
      return { certPem, keyPem, meta };
    } catch {
      return null;
    }
  }

  async #writePair(prefix, pair) {
    await this.fsp.writeFile(this.#f(`${prefix}-key.bin`), await this.secrets.protect(Buffer.from(pair.keyPem, 'utf8')), { mode: 0o600 });
    await this.fsp.writeFile(this.#f(`${prefix}.pem`), pair.certPem, { mode: 0o644 });
    await this.fsp.writeFile(this.#f(`${prefix}.json`), JSON.stringify(pair.meta, null, 2), { mode: 0o600 });
  }

  async #movePair(from, to) {
    for (const ext of ['.pem', '-key.bin', '.json']) {
      await this.fsp.rm(this.#f(`${to}${ext}`), { force: true });
      await this.fsp.rename(this.#f(`${from}${ext}`), this.#f(`${to}${ext}`)).catch(() => {});
    }
  }

  async load() {
    this.root = await this.#readPair('root');
    this.next = await this.#readPair('root-next');
    this.leaf = await this.#readPair('leaf');
    return !!this.root;
  }

  #covers(root, { names, addresses }) {
    const nets = root.meta.permitted?.nets || [];
    const dns = root.meta.permitted?.dns || [];
    const uncovered = addresses.find((a) => !nets.some((n) => cidrContains(n, a)));
    const nameMissing = names.find((n) => !dns.includes(n));
    return { ok: !uncovered && !nameMissing, uncovered: uncovered || null, nameMissing: nameMissing || null };
  }

  #makeRootPair(addresses) {
    const r = makeRoot({ hostname: this.hostname, insideAddresses: addresses, now: this.now() });
    return { certPem: r.certPem, keyPem: r.keyPem, meta: { fingerprint: r.fingerprint, notAfter: r.notAfter, permitted: r.permitted, made: this.now() } };
  }

  /**
   * @param {{ insideAddresses: string[] }} p
   */
  async ensure({ insideAddresses }) {
    const t = this.now();
    const addresses = [...new Set((insideAddresses || []).map(normalizeIp).filter(Boolean))];
    const names = hostNames(this.hostname);
    const out = { rootMade: false, rootReplacedFor: null, nextRootMade: false, nextRootPromoted: false, leafMade: false };
    await this.fsp.mkdir(this.dir, { recursive: true });

    if (!this.root) {
      this.root = this.#makeRootPair(addresses);
      await this.#writePair('root', this.root);
      out.rootMade = true;
    } else {
      const cover = this.#covers(this.root, { names, addresses });
      if (!cover.ok) {
        await this.#movePair('root', 'root-previous');
        this.root = this.#makeRootPair(addresses);
        await this.#writePair('root', this.root);
        out.rootMade = true;
        out.rootReplacedFor = cover.uncovered || cover.nameMissing;
        this.next = null;
        await this.#movePair('root-next', 'root-next-dropped');
      }
    }

    const left = this.root.meta.notAfter - t;
    if (left < NEXT_ROOT_DAYS * DAY && !this.next) {
      this.next = this.#makeRootPair(addresses);
      await this.#writePair('root-next', this.next);
      out.nextRootMade = true;
    }
    if (left < SWITCH_ROOT_DAYS * DAY && this.next) {
      await this.#movePair('root', 'root-previous');
      await this.#movePair('root-next', 'root');
      this.root = this.next;
      this.next = null;
      out.nextRootPromoted = true;
    }

    const wantNames = names;
    const wantAddresses = addresses;
    const leafOk = this.leaf
      && this.leaf.meta.rootFingerprint === this.root.meta.fingerprint
      && this.leaf.meta.notAfter - t > LEAF_RENEW_DAYS * DAY
      && sameSet(this.leaf.meta.names || [], wantNames)
      && sameSet(this.leaf.meta.addresses || [], wantAddresses);
    if (!leafOk) {
      if (wantNames.length === 0 && wantAddresses.length === 0) {
        this.leaf = null; // nothing to name: the doors stay closed anyway
      } else {
        const l = makeLeaf({ rootCertPem: this.root.certPem, rootKeyPem: this.root.keyPem, hostname: this.hostname, insideAddresses: wantAddresses, now: t });
        this.leaf = { certPem: l.certPem, keyPem: l.keyPem, meta: { rootFingerprint: this.root.meta.fingerprint, notAfter: l.notAfter, names: wantNames, addresses: wantAddresses, made: t } };
        await this.#writePair('leaf', this.leaf);
        out.leafMade = true;
      }
    }
    return out;
  }

  state() {
    const t = this.now();
    return {
      rootPem: this.root?.certPem ?? null,
      rootFingerprint: this.root?.meta.fingerprint ?? null,
      rootNotAfter: this.root?.meta.notAfter ?? null,
      rootPermitted: this.root?.meta.permitted ?? null,
      nextRootPem: this.next?.certPem ?? null,
      nextRootFingerprint: this.next?.meta.fingerprint ?? null,
      leafPem: this.leaf?.certPem ?? null,
      leafKeyPem: this.leaf?.keyPem ?? null,
      leafNotAfter: this.leaf?.meta.notAfter ?? null,
      rootExpiryNotice: !!this.root && this.root.meta.notAfter - t < NEXT_ROOT_DAYS * DAY,
    };
  }
}

/** A company's own PEM pair for a door (config.json), checked: it parses, the key matches, and its dates. */
export async function loadOwnCertificate({ certFile, keyFile }, fsp = fs.promises) {
  const certPem = await fsp.readFile(certFile, 'utf8');
  const keyPem = await fsp.readFile(keyFile, 'utf8');
  const info = certInfo(certPem);
  const crypto = await import('node:crypto');
  const x = new crypto.X509Certificate(certPem);
  if (!x.checkPrivateKey(crypto.createPrivateKey(keyPem))) throw new Error('the key does not belong to the certificate');
  return { certPem, keyPem, notAfter: info.notAfter, subjectAltName: info.subjectAltName };
}

export { permittedFor };
