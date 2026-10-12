// =============================================================================
// Updates, the gateway's side (design §8, D13; G9).
//
//   when      at start, once a day at a random minute, and when the cloud says
//             check_update_now (the admin's Check now)
//   what      stable.json and stable.json.sig from the release channel (GitHub
//             Releases since GW4: releaseFetch.mjs follows GitHub's redirect to
//             its asset store, HTTPS only, at most three hops, GitHub's hosts
//             only); verified with the compiled-in release keys; published_at
//             not older than the last manifest this gateway verified (the same
//             manifest seen again is not stale, so a failed download is tried
//             again the next day; the updater's own check at the swap is the
//             strict one); the version newer than this one
//   floors    the last verified manifest's minimum_version and
//             hard_minimum_version join the cloud's (runtime.mjs): the honest
//             gateway's floor for an incident (§10 row 14), even before the
//             cloud's own floor is set
//   Windows   the artefact downloaded into the gateway's own folder
//             (ProgramData\WILSON Gateway\updates), its size and SHA-256
//             checked as it arrives, then ONE message to the updater service,
//             which copies it, verifies it again on its own copy, and swaps
//             (swap.mjs). The gateway never swaps anything itself: it is not an
//             administrator.
//   container the health line says "<version> is available: pull the image";
//             a process cannot replace its own image.
//
// With no release key compiled in, nothing is fetched and the health line
// says updates are off.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CHANNEL_URL, RELEASE_REPOSITORY, verifyManifest, compiledReleaseKeys, parseVersion } from '../update/manifest.mjs';
import { releaseFetch, releaseAssetUrlOf } from '../update/releaseFetch.mjs';

const MAX_MANIFEST = 64 * 1024;
const MAX_SIGNATURE = 4096;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
export const LAST_MANIFEST_FILE = 'last-manifest.json';

export class Updates {
  /**
   * @param o { platform: 'windows'|'container', stateDir, version, keys?, askUpdater?: (msg) => Promise<object>, log?: (e, d) => void, now?: () => number, channelUrl?, transport? }
   *        `channelUrl` and `transport` are for the tests alone (a manifest server on loopback).
   */
  constructor(o) {
    this.o = o;
    this.keys = o.keys ?? compiledReleaseKeys();
    this.log = o.log || (() => {});
    this.now = o.now || Date.now;
    this.channelUrl = o.channelUrl || CHANNEL_URL;
    this.transport = o.transport || null;
    this.current = this.keys.length ? { state: 'up_to_date' } : { state: 'disabled' };
    this.last = null; // the last verified manifest: { version, published_at, minimum_version, hard_minimum_version }
    this.running = null;
  }

  state() { return this.current; }

  /** The floors the last verified manifest set (null when none). */
  floors() {
    return { minimum: this.last?.minimum_version ?? null, hard: this.last?.hard_minimum_version ?? null };
  }

  #lastFile() { return path.join(this.o.stateDir, LAST_MANIFEST_FILE); }

  async #readLast() {
    try {
      const j = JSON.parse(await fs.promises.readFile(this.#lastFile(), 'utf8'));
      if (j && typeof j.published_at === 'string' && Number.isFinite(Date.parse(j.published_at))) {
        this.last = {
          version: parseVersion(j.version) ? j.version : null,
          published_at: j.published_at,
          minimum_version: parseVersion(j.minimum_version) ? j.minimum_version : null,
          hard_minimum_version: parseVersion(j.hard_minimum_version) ? j.hard_minimum_version : null,
        };
      }
    } catch { /* none yet */ }
    return this.last;
  }

  async #writeLast(m) {
    const value = { version: m.version, published_at: m.published_at, minimum_version: m.minimum_version ?? null, hard_minimum_version: m.hard_minimum_version ?? null, verified_at: new Date(this.now()).toISOString() };
    const tmp = `${this.#lastFile()}.${process.pid}.tmp`;
    await fs.promises.mkdir(this.o.stateDir, { recursive: true });
    await fs.promises.writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    await fs.promises.rename(tmp, this.#lastFile());
    this.last = { version: value.version, published_at: value.published_at, minimum_version: value.minimum_version, hard_minimum_version: value.hard_minimum_version };
  }

  /** At start: an earlier update's failure, and the last verified manifest's floors. */
  async readFailure() {
    await this.#readLast();
    try {
      const f = JSON.parse(await fs.promises.readFile(path.join(this.o.stateDir, 'update-failed.json'), 'utf8'));
      this.current = { state: 'failed', version: String(f.version || '?'), reason: String(f.reason || 'unknown').slice(0, 120) };
    } catch { /* none */ }
  }

  check(why) {
    if (!this.running) this.running = this.#check(why).finally(() => { this.running = null; });
    return this.running;
  }

  async #check(why) {
    if (!this.keys.length) { this.current = { state: 'disabled' }; return this.current; }
    const last = this.last ?? (await this.#readLast());
    let manifestBytes;
    let signatureText;
    try {
      const m = await releaseFetch(this.channelUrl, { maxBytes: MAX_MANIFEST, transport: this.transport });
      manifestBytes = m.body;
      // The signature from the release the manifest came from, not from
      // whichever release is "latest" a moment later.
      const sigUrl = releaseAssetUrlOf(m.hops, RELEASE_REPOSITORY, 'stable.json')?.concat('.sig') ?? `${this.channelUrl}.sig`;
      signatureText = (await releaseFetch(sigUrl, { maxBytes: MAX_SIGNATURE, transport: this.transport })).body.toString('utf8');
    } catch (e) {
      this.log('update_check_failed', { why, reason: String(e.message).slice(0, 160) });
      return this.current;
    }
    const platformKey = this.o.platform === 'windows' ? 'windows-x64' : 'container';
    const v = verifyManifest({ manifestBytes, signatureText, keys: this.keys, lastPublishedAt: last?.published_at ?? null, runningVersion: this.o.version, platformKey, now: this.now(), sameIsStale: false });
    if (!v.ok) {
      this.log('update_manifest_refused', { why, reason: v.reason });
      if (v.reason === 'stale' && this.current.state !== 'failed') this.current = { state: 'up_to_date' };
      return this.current;
    }
    try { await this.#writeLast(v.manifest); } catch (e) { this.log('update_manifest_not_kept', { reason: String(e.message).slice(0, 120) }); }
    if (!v.newer) { if (this.current.state !== 'failed') this.current = { state: 'up_to_date' }; return this.current; }
    if (this.o.platform !== 'windows') { this.current = { state: 'available', version: v.manifest.version }; return this.current; }
    // A version whose swap already failed here (the updater rolled it back and
    // wrote update-failed.json) is not tried again by the daily check: each try
    // stops the gateway for the swap and the 90 s health wait. A newer version,
    // or an admin's Check now, tries again (GW4).
    if (this.current.state === 'failed' && this.current.version === v.manifest.version && why !== 'cloud asked') {
      this.log('update_skipped', { why, version: v.manifest.version, reason: 'this version failed here before; Check now tries it again' });
      return this.current;
    }

    const art = v.manifest.artefacts['windows-x64'];
    const name = path.posix.basename(new URL(art.url).pathname);
    if (!NAME_RE.test(name)) { this.log('update_artefact_name_refused', { name: name.slice(0, 100) }); return this.current; }
    const dir = path.join(this.o.stateDir, 'updates');
    await fs.promises.mkdir(dir, { recursive: true });
    const target = path.join(dir, name);
    const part = `${target}.part`;
    try {
      const hash = crypto.createHash('sha256');
      const fh = await fs.promises.open(part, 'w', 0o600);
      let n = 0;
      try {
        const got = await releaseFetch(art.url, {
          maxBytes: art.size,
          timeoutMs: 60_000,
          deadlineMs: 30 * 60_000,
          transport: this.transport,
          onChunk: async (chunk) => { hash.update(chunk); await fh.write(chunk); },
        });
        n = got.bytes;
      } finally { await fh.close(); }
      if (n !== art.size || hash.digest('hex') !== art.sha256) throw new Error('the download is not the artefact the manifest names');
      await fs.promises.rename(part, target);
    } catch (e) {
      await fs.promises.rm(part, { force: true });
      this.current = { state: 'failed', version: v.manifest.version, reason: String(e.message).slice(0, 120) };
      return this.current;
    }
    this.current = { state: 'updating', version: v.manifest.version };
    if (!this.o.askUpdater) return this.current;
    try {
      const r = await this.o.askUpdater({ type: 'swap', artefact: name, manifest: manifestBytes.toString('base64'), signature: signatureText });
      if (r && r.ok === false) this.current = { state: 'failed', version: v.manifest.version, reason: String(r.reason || 'refused').slice(0, 120) };
    } catch (e) {
      this.current = { state: 'failed', version: v.manifest.version, reason: `the updater service did not answer (${e.code || e.message})` };
    }
    return this.current;
  }
}
