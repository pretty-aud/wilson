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
// Private keys go through `secrets` (DPAPI on Windows, sealed under the
// operator's key in the container: platform/secrets.mjs); certificates are
// public and stored plain.
//
// P8 (TPN-ENC-014): a write the secrets layer refuses (SecretsWriteRefused:
// DPAPI down, no sealing key) never throws out of ensure(): the key is sealed
// BEFORE any file moves, so nothing is half-written; what was loaded stays
// in memory and in place; the refusal rides state().writeRefused to a red
// line; a first run makes no root (the doors stay closed) rather than a root
// that would never be kept. And a certificate whose key file is there but
// does not open (a wrong key, a damaged file) is UNREADABLE, never "no root":
// ensure() refuses to make a new root over it (state().unreadable, red) —
// the old root's key would otherwise be overwritten, silently, and every
// office computer's trust with it. An earlier version's plain key file is
// sealed again on load, once secrets can be written.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { makeRoot, makeLeaf, certInfo, hostNames, permittedFor } from './x509.mjs';
import { cidrContains, normalizeIp } from '../rules/ip.mjs';

const DAY = 86_400_000;
const LEAF_RENEW_DAYS = 30;
const NEXT_ROOT_DAYS = 365;
const SWITCH_ROOT_DAYS = 31;

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
    // P8 (TPN-ENC-014): the last refused write's reason, and the pairs whose
    // key file is present but does not open.
    this.writeRefused = null;
    this.unreadable = new Map();
  }

  #f(name) { return path.join(this.dir, name); }

  async #readPair(prefix) {
    let certPem;
    try {
      certPem = await this.fsp.readFile(this.#f(`${prefix}.pem`), 'utf8');
    } catch {
      return null; // absent: nothing was ever made
    }
    try {
      const blob = await this.fsp.readFile(this.#f(`${prefix}-key.bin`));
      const keyPem = (await this.secrets.unprotect(blob)).toString('utf8');
      const meta = JSON.parse(await this.fsp.readFile(this.#f(`${prefix}.json`), 'utf8'));
      // P8 (TPN-ENC-014): an earlier version's plain key file, sealed again
      // once secrets can be written; a refusal leaves it as it is (counted).
      const sealed = typeof this.secrets.reseal === 'function' ? await this.secrets.reseal(blob).catch(() => null) : null;
      if (sealed) await this.fsp.writeFile(this.#f(`${prefix}-key.bin`), sealed, { mode: 0o600 }).catch(() => {});
      this.unreadable.delete(prefix);
      return { certPem, keyPem, meta };
    } catch (e) {
      // The certificate is there and its key does not open: never "no root".
      this.unreadable.set(prefix, String(e?.message || e).slice(0, 160));
      return null;
    }
  }

  /** The key sealed, before anything moves; null when the secrets layer refuses (kept for the line). */
  async #sealKey(pair) {
    try {
      const sealed = await this.secrets.protect(Buffer.from(pair.keyPem, 'utf8'));
      this.writeRefused = null;
      return sealed;
    } catch (e) {
      if (e?.name === 'SecretsWriteRefused') { this.writeRefused = e.reason || String(e.message || e).slice(0, 160); return null; }
      throw e;
    }
  }

  async #writePair(prefix, pair, sealedKey) {
    await this.fsp.writeFile(this.#f(`${prefix}-key.bin`), sealedKey, { mode: 0o600 });
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
    const out = { rootMade: false, rootReplacedFor: null, nextRootMade: false, nextRootPromoted: false, leafMade: false, refused: null, unreadable: null };
    await this.fsp.mkdir(this.dir, { recursive: true });

    // P8 (TPN-ENC-014): a root whose key file does not open is never replaced
    // by a new one — that would overwrite the key every office computer
    // trusts. The line says what to check; nothing is made.
    if (!this.root && this.unreadable.has('root')) {
      out.unreadable = this.unreadable.get('root');
      return out;
    }

    if (!this.root) {
      const fresh = this.#makeRootPair(addresses);
      const sealed = await this.#sealKey(fresh);
      if (!sealed) { out.refused = this.writeRefused; return out; } // no root over a refusal: the doors stay closed
      await this.#writePair('root', fresh, sealed);
      this.root = fresh;
      out.rootMade = true;
    } else {
      const cover = this.#covers(this.root, { names, addresses });
      if (!cover.ok) {
        const fresh = this.#makeRootPair(addresses);
        const sealed = await this.#sealKey(fresh);
        if (!sealed) { out.refused = this.writeRefused; return out; } // the old root stays, in memory and on disk
        await this.#movePair('root', 'root-previous');
        await this.#writePair('root', fresh, sealed);
        this.root = fresh;
        out.rootMade = true;
        out.rootReplacedFor = cover.uncovered || cover.nameMissing;
        this.next = null;
        await this.#movePair('root-next', 'root-next-dropped');
      }
    }

    const left = this.root.meta.notAfter - t;
    if (left < NEXT_ROOT_DAYS * DAY && !this.next) {
      const next = this.#makeRootPair(addresses);
      const sealed = await this.#sealKey(next);
      if (sealed) {
        await this.#writePair('root-next', next, sealed);
        this.next = next;
        out.nextRootMade = true;
      } else {
        out.refused = this.writeRefused; // tried again at the next start or address change
      }
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
        const pair = { certPem: l.certPem, keyPem: l.keyPem, meta: { rootFingerprint: this.root.meta.fingerprint, notAfter: l.notAfter, names: wantNames, addresses: wantAddresses, made: t } };
        const sealed = await this.#sealKey(pair);
        if (sealed) {
          await this.#writePair('leaf', pair, sealed);
          this.leaf = pair;
          out.leafMade = true;
        } else {
          out.refused = this.writeRefused; // the leaf loaded (if any) serves on; renewed when secrets can be written
        }
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
      // P8 (TPN-ENC-014): for the health line.
      writeRefused: this.writeRefused,
      unreadable: this.unreadable.get('root') ?? this.unreadable.get('leaf') ?? null,
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
