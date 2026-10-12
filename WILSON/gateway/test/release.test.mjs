// =============================================================================
// release.test.mjs — GW4 item 1: the release channel on GitHub Releases.
//
// The update path against a manifest server on LOOPBACK that plays GitHub's
// redirect chain (releaseServer.mjs), with the real release key's public half
// compiled in (manifest.mjs, slot 1) and a THROWAWAY private half made here:
//   * a manifest the throwaway key signed is refused by the compiled-in key
//     (only the release workflow's secret can sign one a gateway takes);
//   * with the throwaway's public half injected: a newer manifest is taken,
//     the redirect chain followed (two hops, GitHub's hosts, the signature
//     from the same release), the artefact downloaded and its hash checked,
//     ONE message to the updater; a stale manifest refused (here and by the
//     updater's own check at the swap); a tampered artefact refused; a
//     redirect to a host that is not GitHub's refused before anything is
//     sent there; plain http, a port, credentials and a fourth redirect too.
// Every listener is on 127.0.0.1.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RELEASE_KEYS_WIRE, RELEASE_KEY_SLOTS, CHANNEL_URL, ARTEFACT_URL_PREFIX, CONTAINER_IMAGE, compiledReleaseKeys,
  verifyManifest, artefactUrlOk, highestVersion, FUTURE_SLACK_MS,
} from '../src/update/manifest.mjs';
import { releaseFetch, RELEASE_HOSTS, MAX_REDIRECTS, hopRefusal, releaseAssetUrlOf } from '../src/update/releaseFetch.mjs';
import { Updates, LAST_MANIFEST_FILE, REFUSED_WORDS } from '../src/platform/updates.mjs';
import { composeHealthLine, channelPhrase, CHANNEL_QUIET_MS } from '../src/rules/health.mjs';
import { makeUpdaterEnv } from '../updater/updater.mjs';
import { signingKeyFromWire, publicKeyToWire } from '../src/wire/formats.mjs';
import { startReleaseServer } from './releaseServer.mjs';

const throwaway = crypto.generateKeyPairSync('ed25519');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gw4-release-'));
const ARTEFACT = 'wilson-gateway-9.0.0-windows-x64.tar.gz';

function manifestFor(artefact, over = {}) {
  return Buffer.from(JSON.stringify({
    version: '9.0.0',
    published_at: '2026-10-11T08:00:00.000Z',
    minimum_version: null,
    hard_minimum_version: null,
    artefacts: {
      'windows-x64': { url: `${ARTEFACT_URL_PREFIX}gateway-v9.0.0/${ARTEFACT}`, sha256: sha(artefact), size: artefact.length },
      container: { image: CONTAINER_IMAGE, digest: 'sha256:' + 'c'.repeat(64) },
    },
    notes: 'a release made in a test',
    ...over,
  }, null, 2));
}
const signWith = (bytes, key = throwaway.privateKey) => crypto.sign(null, bytes, key).toString('base64');

describe('the release key slots and the channel (GW4)', () => {
  it('slot 1 holds the release key GW4 made, slot 2 is empty for a rotation, and nothing else is trusted', () => {
    expect(RELEASE_KEY_SLOTS).toBe(2);
    expect(RELEASE_KEYS_WIRE).toHaveLength(1);
    expect(RELEASE_KEYS_WIRE[0].kid).toBe('rel2026a');
    const k = signingKeyFromWire(RELEASE_KEYS_WIRE[0]);
    expect(k).not.toBeNull();
    expect(compiledReleaseKeys()).toHaveLength(1);
    // The SPKI fingerprint the hand-off names, so a swapped key is caught here.
    expect(sha(k.key.export({ format: 'der', type: 'spki' }))).toBe('11aedaf2d7c56f75400482912d4c70175cd4f7686e9c409c6853f6a18fde7a9a');
    // CONTROL: the wire form round-trips through the gateway's own encoder.
    expect(publicKeyToWire(k.key)).toBe(RELEASE_KEYS_WIRE[0].public_key);
  });
  it('the channel is the public repository\'s latest release on GitHub; the placeholder host is retired', () => {
    expect(CHANNEL_URL).toBe('https://github.com/pretty-aud/wilson/releases/latest/download/stable.json');
    expect(CHANNEL_URL).not.toContain('petalstudios');
  });
  it('a manifest the throwaway key signed is refused by the compiled-in key (only the workflow\'s secret signs a release)', () => {
    const m = manifestFor(Buffer.from('x'));
    expect(verifyManifest({ manifestBytes: m, signatureText: signWith(m), runningVersion: '0.1.0', platformKey: 'windows-x64' })).toEqual({ ok: false, reason: 'signature' });
    // CONTROL: the same bytes and signature with the throwaway's public half pass.
    expect(verifyManifest({ manifestBytes: m, signatureText: signWith(m), keys: [throwaway.publicKey], runningVersion: '0.1.0', platformKey: 'windows-x64' }).ok).toBe(true);
  });
});

describe('the updater keeps the keys it was installed with (review round 1, note 6)', () => {
  it('a release signed only with a key the updater lacks is refused at its swap, whatever the gateway took; the swap never moves the updater\'s own folder', async () => {
    const k1 = crypto.generateKeyPairSync('ed25519');
    const k2 = crypto.generateKeyPairSync('ed25519');
    const artefact = Buffer.from(crypto.randomBytes(1000));
    const m = manifestFor(artefact);
    const dir = tmp();
    const { env, paths } = makeUpdaterEnv({ programDir: path.join(dir, 'program'), stateDir: path.join(dir, 'state'), keys: [k1.publicKey] });
    // The gateway, updated to a build that trusts both keys, would take it …
    expect(verifyManifest({ manifestBytes: m, signatureText: signWith(m, k2.privateKey), keys: [k1.publicKey, k2.publicKey], runningVersion: '0.1.0', platformKey: 'windows-x64' }).ok).toBe(true);
    // … the updater, still the MSI's, refuses it; the same release signed with the old key passes.
    expect(await env.verify({ manifestBytes: m, signatureText: signWith(m, k2.privateKey), archiveBytes: artefact, runningVersion: '0.1.0', lastPublishedAt: null })).toEqual({ ok: false, reason: 'signature' });
    expect(await env.verify({ manifestBytes: m, signatureText: signWith(m, k1.privateKey), archiveBytes: artefact, runningVersion: '0.1.0', lastPublishedAt: null })).toMatchObject({ ok: true, version: '9.0.0' });
    expect(Object.values(paths).some((p) => /[\\/]updater$/i.test(String(p)))).toBe(false);
  });
});

describe('what a manifest may name (artefact URLs on GitHub, the container by digest)', () => {
  const ok = `${ARTEFACT_URL_PREFIX}gateway-v1.2.3/wilson-gateway-1.2.3-windows-x64.tar.gz`;
  it('a release asset of THIS repository, exactly', () => {
    expect(artefactUrlOk(ok)).toBe(true);
    for (const bad of [
      'https://github.com/someone-else/wilson/releases/download/gateway-v1.2.3/a.tar.gz',
      'https://github.com/pretty-aud/wilson-fork/releases/download/gateway-v1.2.3/a.tar.gz',
      'http://github.com/pretty-aud/wilson/releases/download/gateway-v1.2.3/a.tar.gz',
      'https://github.com:444/pretty-aud/wilson/releases/download/gateway-v1.2.3/a.tar.gz',
      'https://user@github.com/pretty-aud/wilson/releases/download/gateway-v1.2.3/a.tar.gz',
      `${ok}?x=1`,
      `${ok}#x`,
      `${ARTEFACT_URL_PREFIX}gateway-v1.2.3/../../../x.tar.gz`,
      `${ARTEFACT_URL_PREFIX}gateway-v1.2.3/sub/a.tar.gz`,
      `${ARTEFACT_URL_PREFIX}a.tar.gz`,
      `${ARTEFACT_URL_PREFIX}gateway-v1.2.3/%2e%2e`,
      'https://release-assets.githubusercontent.com/github-production-release-asset/1',
      'https://evil.example/pretty-aud/wilson/releases/download/gateway-v1.2.3/a.tar.gz',
    ]) expect(artefactUrlOk(bad), bad).toBe(false);
  });
  it('a signed manifest naming another place, or another image, is refused (shape)', () => {
    const art = Buffer.from('y');
    for (const over of [
      { artefacts: { 'windows-x64': { url: 'https://evil.example/a.tar.gz', sha256: sha(art), size: 1 } } },
      { artefacts: { 'windows-x64': { url: 'https://github.com/x/y/releases/download/t/a.tar.gz', sha256: sha(art), size: 1 } } },
    ]) {
      const m = manifestFor(art, over);
      expect(verifyManifest({ manifestBytes: m, signatureText: signWith(m), keys: [throwaway.publicKey], runningVersion: '0.1.0', platformKey: 'windows-x64' }).reason).toBe('shape');
    }
    const c = manifestFor(art, { artefacts: { container: { image: 'docker.io/evil/wilson-gateway', digest: 'sha256:' + 'c'.repeat(64) } } });
    expect(verifyManifest({ manifestBytes: c, signatureText: signWith(c), keys: [throwaway.publicKey], runningVersion: '0.1.0', platformKey: 'container' }).reason).toBe('shape');
    // CONTROL: the right image passes.
    const good = manifestFor(art);
    expect(verifyManifest({ manifestBytes: good, signatureText: signWith(good), keys: [throwaway.publicKey], runningVersion: '0.1.0', platformKey: 'container' }).ok).toBe(true);
  });
  it('a manifest dated more than a day ahead of this clock is refused (it would make every later one stale)', () => {
    const now = Date.parse('2026-10-11T08:00:00Z');
    const ahead = manifestFor(Buffer.from('z'), { published_at: new Date(now + FUTURE_SLACK_MS + 60_000).toISOString() });
    expect(verifyManifest({ manifestBytes: ahead, signatureText: signWith(ahead), keys: [throwaway.publicKey], runningVersion: '0.1.0', platformKey: 'windows-x64', now }).reason).toBe('future');
    const near = manifestFor(Buffer.from('z'), { published_at: new Date(now + FUTURE_SLACK_MS - 60_000).toISOString() });
    expect(verifyManifest({ manifestBytes: near, signatureText: signWith(near), keys: [throwaway.publicKey], runningVersion: '0.1.0', platformKey: 'windows-x64', now }).ok).toBe(true);
  });
  it('the same manifest seen again: stale for the updater\'s swap, not for the gateway\'s daily check', () => {
    const m = manifestFor(Buffer.from('w'));
    const base = { manifestBytes: m, signatureText: signWith(m), keys: [throwaway.publicKey], runningVersion: '0.1.0', platformKey: 'windows-x64', now: Date.parse('2026-10-12T00:00:00Z') };
    expect(verifyManifest({ ...base, lastPublishedAt: '2026-10-11T08:00:00.000Z' }).reason).toBe('stale');
    expect(verifyManifest({ ...base, lastPublishedAt: '2026-10-11T08:00:00.000Z', sameIsStale: false }).ok).toBe(true);
    expect(verifyManifest({ ...base, lastPublishedAt: '2026-10-11T08:00:00.001Z', sameIsStale: false }).reason).toBe('stale');
  });
  it('the highest of the floors', () => {
    expect(highestVersion(null, '1.2.0', 'garbage', '1.10.0', undefined)).toBe('1.10.0');
    expect(highestVersion(null, undefined)).toBeNull();
  });
});

describe('releaseFetch: GitHub\'s redirects, and nowhere else', () => {
  let srv;
  beforeAll(async () => { srv = await startReleaseServer({ assets: { 'stable.json': Buffer.from('{"a":1}'), [ARTEFACT]: Buffer.alloc(70_000, 7) } }); });
  afterAll(async () => { await srv.close(); });

  it('follows the two hops to the asset store, every one on GitHub\'s hosts, with a user agent and SNI', async () => {
    const r = await releaseFetch(srv.channelUrl, { maxBytes: 1024, transport: srv.transport });
    expect(r.body.toString()).toBe('{"a":1}');
    expect(r.hops.map((h) => new URL(h).hostname)).toEqual(['github.com', 'github.com', 'release-assets.githubusercontent.com']);
    expect(r.hops[1]).toBe('https://github.com/pretty-aud/wilson/releases/download/gateway-v9.0.0/stable.json');
    expect(releaseAssetUrlOf(r.hops, 'pretty-aud/wilson', 'stable.json')).toBe(r.hops[1]);
    const last = srv.hits.slice(-3);
    expect(last.map((h) => h.servername)).toEqual(['github.com', 'github.com', 'release-assets.githubusercontent.com']);
    expect(last[0].ua).toMatch(/^wilson-gateway\/\d+\.\d+\.\d+$/);
  });
  it('the list is GitHub\'s three hosts, exactly', () => {
    expect(RELEASE_HOSTS).toEqual(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
    expect(MAX_REDIRECTS).toBe(3);
    expect(hopRefusal(new URL('https://github.com.evil.example/'))).toBe('host');
    expect(hopRefusal(new URL('https://objects.githubusercontent.com/x'))).toBeNull();
  });
  it('a redirect to a host that is not GitHub\'s is refused, and nothing is sent there', async () => {
    for (const to of ['https://evil.example/stable.json', 'https://github.com.evil.example/stable.json']) {
      srv.state.override = ({ host, res }) => { if (host === 'github.com') { res.writeHead(302, { location: to }); res.end(); return true; } return undefined; };
      const before = srv.hits.length;
      await expect(releaseFetch(srv.channelUrl, { maxBytes: 1024, transport: srv.transport })).rejects.toMatchObject({ code: 'host' });
      expect(srv.hits.slice(before).map((h) => h.host)).toEqual(['github.com']);
    }
    srv.state.override = null;
  });
  it('plain http, a port, credentials and a fourth redirect are refused', async () => {
    const cases = [['http://github.com/x', 'not_https'], ['https://github.com:8443/x', 'port'], ['https://u:p@github.com/x', 'credentials'], ['https://release-assets.githubusercontent.com.evil.example/x', 'host']];
    for (const [to, code] of cases) {
      srv.state.override = ({ host, res }) => { if (host === 'github.com') { res.writeHead(302, { location: to }); res.end(); return true; } return undefined; };
      await expect(releaseFetch(srv.channelUrl, { maxBytes: 1024, transport: srv.transport }), to).rejects.toMatchObject({ code });
    }
    let n = 0;
    srv.state.override = ({ res }) => { n++; res.writeHead(302, { location: `https://github.com/loop/${n}` }); res.end(); return true; };
    await expect(releaseFetch(srv.channelUrl, { maxBytes: 1024, transport: srv.transport })).rejects.toMatchObject({ code: 'redirects' });
    expect(n).toBe(MAX_REDIRECTS + 1);
    srv.state.override = null;
    // CONTROL: the starting URL is held to the same rules.
    await expect(releaseFetch('https://evil.example/stable.json', { maxBytes: 10, transport: srv.transport })).rejects.toMatchObject({ code: 'host' });
  });
  it('a body past the cap is refused, by its length and as it streams', async () => {
    await expect(releaseFetch(srv.assetUrl(ARTEFACT), { maxBytes: 1000, transport: srv.transport })).rejects.toMatchObject({ code: 'too_large' });
    srv.state.override = ({ host, res }) => {
      if (host !== 'release-assets.githubusercontent.com') return undefined;
      res.writeHead(200, { 'content-type': 'application/octet-stream' }); // no length: chunked
      const t = setInterval(() => { if (!res.write(Buffer.alloc(16_384))) { /* backpressure */ } }, 1);
      res.on('close', () => clearInterval(t));
      return true;
    };
    await expect(releaseFetch(srv.assetUrl(ARTEFACT), { maxBytes: 50_000, transport: srv.transport })).rejects.toMatchObject({ code: 'too_large' });
    srv.state.override = null;
  });
  it('a length declared past the cap is refused at once, before the body (a body that then stalls does not wait out the timeout)', async () => {
    srv.state.override = ({ host, res }) => {
      if (host !== 'release-assets.githubusercontent.com') return undefined;
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': 10_000_000 });
      res.write(Buffer.alloc(10)); // and then nothing: the connection stays open
      return true;
    };
    const t0 = Date.now();
    await expect(releaseFetch(srv.assetUrl(ARTEFACT), { maxBytes: 1000, timeoutMs: 4000, transport: srv.transport })).rejects.toMatchObject({ code: 'too_large' });
    expect(Date.now() - t0).toBeLessThan(3000);
    srv.state.override = null;
  });
  it('an answer cut short is refused and named so (the length unmet, a chunked body never ended, a reset), not in Node\'s own word', async () => {
    try {
      for (const how of ['length', 'chunked', 'reset']) {
        srv.state.override = ({ host, res }) => {
          if (host !== 'release-assets.githubusercontent.com') return undefined;
          res.writeHead(200, how === 'chunked' ? { 'content-type': 'application/octet-stream' } : { 'content-type': 'application/octet-stream', 'content-length': 5000 });
          res.write(Buffer.alloc(1000), () => setTimeout(() => {
            // A reset is sent on the TCP socket under the TLS one (the TLS socket's own handle cannot reset).
            if (how === 'reset') (res.socket._parent ?? res.socket).resetAndDestroy();
            else res.socket.destroy();
          }, 20));
          return true;
        };
        await expect(releaseFetch(srv.assetUrl(ARTEFACT), { maxBytes: 50_000, transport: srv.transport }), how)
          .rejects.toMatchObject({ code: 'truncated', message: 'release-assets.githubusercontent.com: the answer was cut short' });
      }
      // CONTROL: our own refusals keep their names (a stall is a timeout, the whole fetch's limit the deadline).
      srv.state.override = ({ host, res }) => {
        if (host !== 'release-assets.githubusercontent.com') return undefined;
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': 5000 });
        res.write(Buffer.alloc(1000));
        return true;
      };
      await expect(releaseFetch(srv.assetUrl(ARTEFACT), { maxBytes: 50_000, timeoutMs: 800, transport: srv.transport })).rejects.toMatchObject({ code: 'timeout' });
      await expect(releaseFetch(srv.assetUrl(ARTEFACT), { maxBytes: 50_000, timeoutMs: 10_000, deadlineMs: 800, transport: srv.transport })).rejects.toMatchObject({ code: 'deadline' });
    } finally { srv.state.override = null; }
  }, 20_000); // five fetches in a row: under a full run's load they can pass vitest's 5 s, and the override would outlive the test
  it('a status other than 200 at the end is refused', async () => {
    await expect(releaseFetch('https://github.com/pretty-aud/wilson/releases/download/gateway-v9.0.0/missing', { maxBytes: 10, transport: srv.transport })).rejects.toMatchObject({ code: 'status' });
  });
});

describe('the gateway\'s update check against the loopback channel (Updates)', () => {
  let srv;
  const artefact = Buffer.from(crypto.randomBytes(40_000));
  const manifest = manifestFor(artefact);
  beforeAll(async () => {
    srv = await startReleaseServer({ assets: { 'stable.json': manifest, 'stable.json.sig': signWith(manifest), [ARTEFACT]: artefact } });
  });
  afterAll(async () => { await srv.close(); });
  const make = (dir, o = {}) => new Updates({ platform: 'windows', stateDir: dir, version: '0.1.0', keys: [throwaway.publicKey], channelUrl: srv.channelUrl, transport: srv.transport, now: () => Date.parse('2026-10-11T12:00:00Z'), ...o });

  it('with the compiled-in key only, the throwaway\'s manifest is refused and nothing is downloaded', async () => {
    const dir = tmp();
    const logs = [];
    const u = new Updates({ platform: 'windows', stateDir: dir, version: '0.1.0', channelUrl: srv.channelUrl, transport: srv.transport, log: (e, d) => logs.push([e, d]) });
    expect(u.state()).toEqual({ state: 'up_to_date' });
    const before = srv.hits.length;
    expect(await u.check('test')).toEqual({ state: 'up_to_date' });
    expect(logs).toContainEqual(['update_manifest_refused', { why: 'test', reason: 'signature' }]);
    expect(srv.hits.slice(before).filter((h) => h.url.endsWith(ARTEFACT) || h.assetName === ARTEFACT)).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'updates'))).toBe(false);
  });
  it('a newer manifest is taken: the chain followed, the signature from the same release, the artefact checked, ONE message to the updater', async () => {
    const dir = tmp();
    const asked = [];
    const before = srv.hits.length;
    const u = make(dir, { askUpdater: async (m) => { asked.push(m); return { ok: true, accepted: true }; } });
    expect(await u.check('test')).toEqual({ state: 'updating', version: '9.0.0' });
    const hits = srv.hits.slice(before);
    // The .sig came from the tag the manifest resolved to, not from "latest" again.
    expect(hits.some((h) => h.host === 'github.com' && h.url === '/pretty-aud/wilson/releases/download/gateway-v9.0.0/stable.json.sig')).toBe(true);
    expect(hits.filter((h) => h.url.endsWith('/latest/download/stable.json.sig'))).toEqual([]);
    expect(fs.readFileSync(path.join(dir, 'updates', ARTEFACT)).equals(artefact)).toBe(true);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ type: 'swap', artefact: ARTEFACT });
    expect(Buffer.from(asked[0].manifest, 'base64').equals(manifest)).toBe(true);
    // The last verified manifest is kept (its date and floors).
    expect(JSON.parse(fs.readFileSync(path.join(dir, LAST_MANIFEST_FILE), 'utf8'))).toMatchObject({ version: '9.0.0', published_at: '2026-10-11T08:00:00.000Z' });
  });
  it('a stale manifest (older than the last verified one) is refused and nothing is downloaded', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, LAST_MANIFEST_FILE), JSON.stringify({ version: '9.0.1', published_at: '2026-10-11T09:00:00.000Z' }));
    const logs = [];
    const asked = [];
    const u = make(dir, { log: (e, d) => logs.push([e, d]), askUpdater: async (m) => { asked.push(m); return { ok: true }; } });
    await u.readFailure();
    expect(await u.check('test')).toEqual({ state: 'up_to_date' });
    expect(logs).toContainEqual(['update_manifest_refused', { why: 'test', reason: 'stale' }]);
    expect(asked).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'updates'))).toBe(false);
  });
  it('the same manifest seen again after a failed download is tried again (not stale for the gateway)', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, LAST_MANIFEST_FILE), JSON.stringify({ version: '9.0.0', published_at: '2026-10-11T08:00:00.000Z' }));
    const asked = [];
    const u = make(dir, { askUpdater: async (m) => { asked.push(m); return { ok: true }; } });
    await u.readFailure();
    expect(await u.check('test')).toEqual({ state: 'updating', version: '9.0.0' });
    expect(asked).toHaveLength(1);
  });
  it('a tampered artefact is refused and deleted, and the updater is not asked', async () => {
    const dir = tmp();
    const asked = [];
    srv.state.override = ({ assetName, res }) => {
      // The asset store answers for the artefact with other bytes of the same length.
      if (assetName !== ARTEFACT) return undefined;
      const tampered = Buffer.from(artefact); tampered[100] ^= 0xff;
      res.writeHead(200, { 'content-length': tampered.length }); res.end(tampered); return true;
    };
    const u = make(dir, { askUpdater: async (m) => { asked.push(m); return { ok: true }; } });
    const s = await u.check('test');
    srv.state.override = null;
    expect(s).toMatchObject({ state: 'failed', version: '9.0.0', reason: 'the download is not the artefact the manifest names' });
    expect(asked).toEqual([]);
    expect(fs.readdirSync(path.join(dir, 'updates'))).toEqual([]);
  });
  it('an artefact larger than the manifest says, or one that never ends, is cut at the manifest\'s size and refused (GW2\'s two, moved here)', async () => {
    for (const shape of ['longer', 'endless']) {
      const dir = tmp();
      const asked = [];
      let sent = 0;
      srv.state.override = ({ assetName, res }) => {
        if (assetName !== ARTEFACT) return undefined;
        if (shape === 'longer') { const b = Buffer.concat([artefact, Buffer.alloc(10)]); res.writeHead(200, { 'content-length': b.length }); res.end(b); return true; }
        res.writeHead(200, {});
        const t = setInterval(() => { sent += 65_536; res.write(Buffer.alloc(65_536)); }, 1);
        res.on('close', () => clearInterval(t));
        return true;
      };
      const u = make(dir, { askUpdater: async (m) => { asked.push(m); return { ok: true }; } });
      const s = await u.check('test');
      srv.state.override = null;
      expect(s.state, shape).toBe('failed');
      expect(s.reason, shape).toMatch(/larger than 40000 bytes/);
      expect(asked, shape).toEqual([]);
      expect(fs.readdirSync(path.join(dir, 'updates')), shape).toEqual([]);
      if (shape === 'endless') expect(sent).toBeLessThan(4 * 1024 * 1024);
    }
  }, 20_000);
  it('not newer: up to date, nothing downloaded', async () => {
    const dir = tmp();
    const before = srv.hits.length;
    const u = make(dir, { version: '9.0.0' });
    expect(await u.check('test')).toEqual({ state: 'up_to_date' });
    expect(srv.hits.slice(before).filter((h) => h.assetName === ARTEFACT)).toEqual([]);
  });
  it('a channel redirecting to a host that is not GitHub\'s: the check fails, logged, nothing fetched from there', async () => {
    const dir = tmp();
    const logs = [];
    srv.state.override = ({ host, url, res }) => { if (host === 'github.com' && url.includes('/latest/')) { res.writeHead(302, { location: 'https://evil.example/stable.json' }); res.end(); return true; } return undefined; };
    const before = srv.hits.length;
    const u = make(dir, { log: (e, d) => logs.push([e, d]) });
    expect(await u.check('test')).toEqual({ state: 'up_to_date' });
    srv.state.override = null;
    expect(logs[0][0]).toBe('update_check_failed');
    expect(logs[0][1].reason).toMatch(/evil\.example \(host\)/);
    expect(srv.hits.slice(before).map((h) => h.host)).toEqual(['github.com']);
  });
  it('container: a newer signed version is "available" (pull the image), and its floors are the manifest\'s', async () => {
    const dir = tmp();
    const m2 = manifestFor(artefact, { minimum_version: '8.0.0', hard_minimum_version: '7.0.0' });
    srv.state.assets['stable.json'] = m2;
    srv.state.assets['stable.json.sig'] = signWith(m2);
    try {
      const u = make(dir, { platform: 'container' });
      expect(await u.check('test')).toEqual({ state: 'available', version: '9.0.0' });
      expect(u.floors()).toEqual({ minimum: '8.0.0', hard: '7.0.0' });
      // Kept across a restart.
      const again = make(dir, { platform: 'container' });
      await again.readFailure();
      expect(again.floors()).toEqual({ minimum: '8.0.0', hard: '7.0.0' });
    } finally {
      srv.state.assets['stable.json'] = manifest;
      srv.state.assets['stable.json.sig'] = signWith(manifest);
    }
  });
  it('a version that failed here (rolled back) is not retried by the daily check; Check now and a newer version are', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'update-failed.json'), JSON.stringify({ version: '9.0.0', reason: 'the new version did not report healthy within 90 s', running: '0.1.0' }));
    const asked = [];
    const logs = [];
    const u = make(dir, { askUpdater: async (m) => { asked.push(m); return { ok: true }; }, log: (e, d) => logs.push([e, d]) });
    await u.readFailure();
    const before = srv.hits.length;
    expect(await u.check('daily')).toMatchObject({ state: 'failed', version: '9.0.0' });
    expect(asked).toEqual([]);
    expect(srv.hits.slice(before).filter((h) => h.assetName === ARTEFACT)).toEqual([]);
    expect(logs.map((l) => l[0])).toContain('update_skipped');
    // The admin's Check now tries it again.
    expect(await u.check('cloud asked')).toEqual({ state: 'updating', version: '9.0.0' });
    expect(asked).toHaveLength(1);
    // CONTROL: a failure of ANOTHER version does not hold this one back.
    const dir2 = tmp();
    fs.writeFileSync(path.join(dir2, 'update-failed.json'), JSON.stringify({ version: '8.9.9', reason: 'x' }));
    const asked2 = [];
    const u2 = make(dir2, { askUpdater: async (m) => { asked2.push(m); return { ok: true }; } });
    await u2.readFailure();
    expect(await u2.check('daily')).toEqual({ state: 'updating', version: '9.0.0' });
    expect(asked2).toHaveLength(1);
  });
  it('a swap the updater refused at its own check is read back while it is in flight: "updating" becomes "failed"', async () => {
    const dir = tmp();
    let t = Date.parse('2026-10-11T12:00:00Z');
    const u = make(dir, { now: () => t, askUpdater: async () => ({ ok: true, accepted: true }) });
    // CONTROL: an older failure (from before this update was asked for) changes nothing.
    fs.writeFileSync(path.join(dir, 'update-failed.json'), JSON.stringify({ version: null, reason: 'old', at: new Date(t - 60_000).toISOString() }));
    expect(await u.check('test')).toEqual({ state: 'updating', version: '9.0.0' });
    expect(await u.refreshFailure()).toEqual({ state: 'updating', version: '9.0.0' });
    t += 5_000;
    fs.writeFileSync(path.join(dir, 'update-failed.json'), JSON.stringify({ version: null, reason: 'verification failed (stale)', running: '0.1.0', at: new Date(t).toISOString() }));
    expect(await u.refreshFailure()).toEqual({ state: 'failed', version: '9.0.0', reason: 'verification failed (stale)' });
    expect(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.mjs'), 'utf8')).toMatch(/setInterval\(\(\) => \{ gw\.updates\.refreshFailure\(\)\.catch\(\(\) => \{\}\); \}, 15_000\)\.unref\(\);/);
  });
  it('a lower version list never replaces the last one taken, whatever its date: the floors stay, and the health line says it was not taken (review round 2, finding 4)', async () => {
    const dir = tmp();
    // The gateway took 9.1.0, with floors 9.0.0 (an incident's release), signed at 07:00 …
    fs.writeFileSync(path.join(dir, LAST_MANIFEST_FILE), JSON.stringify({ version: '9.1.0', published_at: '2026-10-11T07:00:00.000Z', minimum_version: '9.0.0', hard_minimum_version: '9.0.0' }));
    const logs = [];
    const asked = [];
    const u = make(dir, { log: (e, d) => logs.push([e, d]), askUpdater: async (m) => { asked.push(m); return { ok: true }; } });
    await u.readFailure();
    // … and the channel now serves 9.0.0, signed LATER (08:00), with no floors.
    expect(await u.check('test')).toEqual({ state: 'up_to_date' });
    expect(u.floors()).toEqual({ minimum: '9.0.0', hard: '9.0.0' });
    expect(asked).toEqual([]);
    expect(logs).toContainEqual(['update_manifest_lower', { why: 'test', version: '9.0.0', kept: '9.1.0' }]);
    expect(JSON.parse(fs.readFileSync(path.join(dir, LAST_MANIFEST_FILE), 'utf8')).version).toBe('9.1.0');
    expect(u.channel().failure).toMatchObject({ kind: 'lower', version: '9.0.0', kept: '9.1.0' });
    expect(channelPhrase(u.channel(), Date.parse('2026-10-11T12:00:00Z'))).toEqual({ text: 'updates: the latest release was not taken: it names 9.0.0, below 9.1.0, the last version list this gateway took; a newer release will reach this gateway', tone: 'amber' });
    // CONTROL: the same list after a LOWER one was taken is taken (a higher version, whatever the dates).
    const dir2 = tmp();
    fs.writeFileSync(path.join(dir2, LAST_MANIFEST_FILE), JSON.stringify({ version: '8.0.0', published_at: '2026-10-11T07:00:00.000Z' }));
    const u2 = make(dir2, { askUpdater: async () => ({ ok: true, accepted: true }) });
    await u2.readFailure();
    expect(await u2.check('test')).toEqual({ state: 'updating', version: '9.0.0' });
    expect(u2.channel().failure).toBeNull();
  });
  it('the channel\'s trouble is said instead of "up to date": a refused list at once, with why; an unreadable channel after two days; a good check clears it (review round 2, findings 2 and 4)', async () => {
    let t = Date.parse('2026-10-11T12:00:00Z');
    const dir = tmp();
    const u = make(dir, { now: () => t, version: '9.0.0' }); // running 9.0.0: nothing newer to take
    const line = () => composeHealthLine({ now: t, name: 'PC', version: '9.0.0', lastSyncAt: t, inside: { state: 'open', addresses: [] }, outside: {}, locations: [], certificate: null, update: { ...u.state(), channel: u.channel() } }).text;
    await u.check('test');
    expect(u.channel()).toEqual({ lastOkAt: t, failure: null });
    expect(line()).toContain('up to date');
    // The channel answers 404 (another release is the repository's Latest): nothing said for two days …
    srv.state.override = ({ host, url, res }) => { if (host === 'github.com' && url.includes('/latest/')) { res.writeHead(404); res.end(); return true; } return undefined; };
    try {
      t += 3_600_000;
      expect(await u.check('daily')).toEqual({ state: 'up_to_date' });
      expect(u.channel().failure).toMatchObject({ kind: 'unreadable' });
      expect(channelPhrase(u.channel(), t)).toBeNull();
      expect(line()).toContain('up to date');
      // … then said, with the day of the last good check.
      t += CHANNEL_QUIET_MS;
      await u.check('daily');
      expect(channelPhrase(u.channel(), t)).toEqual({ text: 'updates: not checked since 2026-10-11: the release channel could not be read (github.com: 404)', tone: 'amber' });
      expect(line()).toContain('updates: not checked since 2026-10-11');
      expect(line()).not.toContain('up to date');
    } finally { srv.state.override = null; }
    // A list whose signature does not verify: said at once, with the version it names.
    srv.state.assets['stable.json.sig'] = signWith(manifest, crypto.generateKeyPairSync('ed25519').privateKey);
    try {
      await u.check('daily');
      expect(channelPhrase(u.channel(), t)).toEqual({ text: 'updates: the latest release’s version list was refused: its signature does not verify with this gateway’s release key (it names 9.0.0)', tone: 'amber' });
    } finally { srv.state.assets['stable.json.sig'] = signWith(manifest); }
    expect(REFUSED_WORDS.stale).toBe('it is older than the last one this gateway took');
    // A gateway that has not read the channel once since it started counts from its first failed try.
    let t2 = Date.parse('2026-10-20T09:00:00Z');
    const fresh = make(tmp(), { now: () => t2, version: '9.0.0' });
    srv.state.override = ({ host, url, res }) => { if (host === 'github.com' && url.includes('/latest/')) { res.writeHead(404); res.end(); return true; } return undefined; };
    try {
      await fresh.check('start');
      t2 += 24 * 3_600_000;
      await fresh.check('daily');
      expect(channelPhrase(fresh.channel(), t2)).toBeNull();
      t2 += 24 * 3_600_000;
      await fresh.check('daily');
      expect(channelPhrase(fresh.channel(), t2)).toEqual({ text: 'updates: not checked since 2026-10-20: the release channel could not be read (github.com: 404)', tone: 'amber' });
    } finally { srv.state.override = null; }
    // A good check clears it.
    await u.check('daily');
    expect(u.channel()).toEqual({ lastOkAt: t, failure: null });
    expect(line()).toContain('up to date');
    expect(CHANNEL_QUIET_MS).toBe(48 * 3_600_000);
  });
  it('no release key: updates are off and nothing is fetched', async () => {
    const before = srv.hits.length;
    const u = new Updates({ platform: 'windows', stateDir: tmp(), version: '0.1.0', keys: [], channelUrl: srv.channelUrl, transport: srv.transport });
    expect(u.state()).toEqual({ state: 'disabled' });
    await u.check('test');
    expect(srv.hits.length).toBe(before);
  });
});

describe('the updater\'s own check at the swap, with the throwaway key injected', () => {
  it('a newer manifest is taken; a stale one (dated as the last swap) is refused; a tampered copy is refused', async () => {
    const artefact = Buffer.from('the archive the updater copied');
    const m = manifestFor(artefact);
    const { env } = makeUpdaterEnv({ programDir: 'C:\\PF\\WILSON Gateway', stateDir: 'C:\\PD\\WILSON Gateway', keys: [throwaway.publicKey] });
    const req = { manifestBytes: m, signatureText: signWith(m), archiveBytes: artefact, runningVersion: '0.1.0' };
    expect(await env.verify({ ...req, lastPublishedAt: null })).toMatchObject({ ok: true, version: '9.0.0' });
    expect(await env.verify({ ...req, lastPublishedAt: '2026-10-11T08:00:00.000Z' })).toMatchObject({ ok: false, reason: 'stale' });
    const tampered = Buffer.from(artefact); tampered[0] ^= 1;
    expect(await env.verify({ ...req, archiveBytes: tampered, lastPublishedAt: null })).toMatchObject({ ok: false, reason: 'hash' });
    // CONTROL: the updater's default keys are the compiled-in ones, which refuse the throwaway's manifest.
    const { env: real } = makeUpdaterEnv({ programDir: 'C:\\PF\\WILSON Gateway', stateDir: 'C:\\PD\\WILSON Gateway' });
    expect(await real.verify({ ...req, lastPublishedAt: null })).toMatchObject({ ok: false, reason: 'signature' });
  });
});
