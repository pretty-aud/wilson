// =============================================================================
// Updates, the gateway's side (design §8, D13; G9).
//
//   when      at start, once a day at a random minute, and when the cloud says
//             check_update_now (the admin's Check now)
//   what      stable.json and stable.json.sig from the release channel, over
//             HTTPS; verified with the compiled-in release keys; published_at
//             newer than the last accepted; the version newer than this one
//   Windows   the artefact downloaded into the gateway's own folder
//             (ProgramData\WILSON Gateway\updates), its size and SHA-256
//             checked as it arrives, then ONE message to the updater service,
//             which copies it, verifies it again on its own copy, and swaps
//             (swap.mjs). The gateway never swaps anything itself: it is not an
//             administrator.
//   container the health line says "<version> is available: pull the image";
//             a process cannot replace its own image.
//
// With no release key compiled in (until GW4), nothing is fetched and the
// health line says updates are off.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CHANNEL_URL, verifyManifest, compiledReleaseKeys } from '../update/manifest.mjs';

const MAX_MANIFEST = 64 * 1024;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

async function fetchCapped(fetchImpl, url, max) {
  const res = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const reader = res.body.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { reader.cancel().catch(() => {}); throw new Error(`${url}: too large`); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export class Updates {
  /**
   * @param o { platform: 'windows'|'container', stateDir, version, fetchImpl?, keys?, askUpdater?: (msg) => Promise<object>, log?: (e, d) => void, now? }
   */
  constructor(o) {
    this.o = o;
    this.keys = o.keys ?? compiledReleaseKeys();
    this.fetch = o.fetchImpl || globalThis.fetch;
    this.log = o.log || (() => {});
    this.current = this.keys.length ? { state: 'up_to_date' } : { state: 'disabled' };
    this.running = null;
  }

  state() { return this.current; }

  async readFailure() {
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
    const lastFile = path.join(this.o.stateDir, 'last-manifest.json');
    let last = null;
    try { last = JSON.parse(await fs.promises.readFile(lastFile, 'utf8')); } catch { last = null; }
    let manifestBytes;
    let signatureText;
    try {
      manifestBytes = await fetchCapped(this.fetch, this.o.channelUrl || CHANNEL_URL, MAX_MANIFEST);
      signatureText = (await fetchCapped(this.fetch, `${this.o.channelUrl || CHANNEL_URL}.sig`, 4096)).toString('utf8');
    } catch (e) {
      this.log('update_check_failed', { why, reason: String(e.message).slice(0, 160) });
      return this.current;
    }
    const platformKey = this.o.platform === 'windows' ? 'windows-x64' : 'container';
    const v = verifyManifest({ manifestBytes, signatureText, keys: this.keys, lastPublishedAt: last?.published_at ?? null, runningVersion: this.o.version, platformKey });
    if (!v.ok) {
      if (v.reason !== 'stale') this.log('update_manifest_refused', { why, reason: v.reason });
      if (v.reason === 'stale' && this.current.state !== 'failed') this.current = { state: 'up_to_date' };
      return this.current;
    }
    if (!v.newer) { this.current = { state: 'up_to_date' }; return this.current; }
    if (this.o.platform !== 'windows') { this.current = { state: 'available', version: v.manifest.version }; return this.current; }

    const art = v.manifest.artefacts['windows-x64'];
    const name = path.basename(new URL(art.url).pathname);
    if (!NAME_RE.test(name)) { this.log('update_artefact_name_refused', { name: name.slice(0, 100) }); return this.current; }
    const dir = path.join(this.o.stateDir, 'updates');
    await fs.promises.mkdir(dir, { recursive: true });
    const target = path.join(dir, name);
    const part = `${target}.part`;
    try {
      const res = await this.fetch(art.url, { redirect: 'error', signal: AbortSignal.timeout(30 * 60_000) });
      if (!res.ok) throw new Error(`download ${res.status}`);
      const hash = crypto.createHash('sha256');
      const fh = await fs.promises.open(part, 'w', 0o600);
      let n = 0;
      try {
        const reader = res.body.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          n += value.length;
          if (n > art.size) { reader.cancel().catch(() => {}); throw new Error('larger than the manifest says'); }
          hash.update(value);
          await fh.write(value);
        }
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
