// =============================================================================
// update.test.mjs — the signed manifest (§8, R20), the artefact's archive, and
// the updater's swap as a state machine over a fake file system (§8, R7):
// the happy path, a deliberately broken build reverted, a planted file in the
// download folder that never reaches the swap, an artefact swapped after the
// gateway's check (refused by the updater's own check on its own copy), every
// crash point recovered at the updater's start, and rollback.
// =============================================================================

import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { verifyManifest, verifyArtefact, compareVersions, parseVersion, RELEASE_KEYS_WIRE, compiledReleaseKeys } from '../src/update/manifest.mjs';
import { readTar, writeTar, safeEntryName } from '../src/update/tar.mjs';
import { runSwap, recoverSwap, runRollback, swapPaths } from '../src/update/swap.mjs';
import { memfs } from './memfs.mjs';

const keyA = crypto.generateKeyPairSync('ed25519');
const keyB = crypto.generateKeyPairSync('ed25519');
const sign = (bytes, k = keyA.privateKey) => crypto.sign(null, Buffer.from(bytes), k).toString('base64');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function manifestFor(archive, over = {}) {
  return Buffer.from(JSON.stringify({
    version: '1.1.0', published_at: '2026-10-10T08:00:00Z', minimum_version: '1.0.0', hard_minimum_version: null,
    artefacts: { 'windows-x64': { url: 'https://releases.petalstudios.com/wilson-gateway/1.1.0/wilson-gateway-windows-x64.tar.gz', sha256: sha(archive), size: archive.length }, container: { image: 'ghcr.io/petal/wilson-gateway:1.1.0', digest: 'sha256:' + 'a'.repeat(64) } },
    notes: 'test', ...over,
  }));
}

describe('the manifest (§8)', () => {
  const archive = Buffer.from('the artefact');
  const m = manifestFor(archive);
  const base = { manifestBytes: m, signatureText: sign(m), keys: [keyA.publicKey, keyB.publicKey], runningVersion: '1.0.0', platformKey: 'windows-x64' };
  it('verifies with either compiled-in key and says whether it is newer', () => {
    expect(verifyManifest(base)).toMatchObject({ ok: true, newer: true });
    expect(verifyManifest({ ...base, signatureText: sign(m, keyB.privateKey) }).ok).toBe(true);
    expect(verifyManifest({ ...base, runningVersion: '1.1.0' })).toMatchObject({ ok: true, newer: false });
  });
  it('refuses another key, a flipped byte, a bad signature shape', () => {
    const other = crypto.generateKeyPairSync('ed25519');
    expect(verifyManifest({ ...base, signatureText: sign(m, other.privateKey) }).reason).toBe('signature');
    const flipped = Buffer.from(m); flipped[5] ^= 1;
    expect(verifyManifest({ ...base, manifestBytes: flipped }).reason).toBe('signature');
    expect(verifyManifest({ ...base, signatureText: 'abc' }).reason).toBe('signature_shape');
  });
  it('refuses a stale manifest: published_at must be newer than the last accepted (R20)', () => {
    expect(verifyManifest({ ...base, lastPublishedAt: '2026-10-10T08:00:00Z' }).reason).toBe('stale');
    expect(verifyManifest({ ...base, lastPublishedAt: '2026-10-11T00:00:00Z' }).reason).toBe('stale');
    expect(verifyManifest({ ...base, lastPublishedAt: '2026-10-09T00:00:00Z' }).ok).toBe(true);
  });
  it('refuses a signed manifest whose shape is wrong (http URL, short hash, bad version)', () => {
    for (const over of [{ version: '1.1' }, { published_at: 'yesterday' }, { artefacts: { 'windows-x64': { url: 'http://x/y', sha256: sha(archive), size: archive.length } } }, { artefacts: { 'windows-x64': { url: 'https://x/y', sha256: 'abc', size: 1 } } }, { minimum_version: 'one' }]) {
      const bad = manifestFor(archive, over);
      expect(verifyManifest({ ...base, manifestBytes: bad, signatureText: sign(bad) }).ok, JSON.stringify(over)).toBe(false);
    }
  });
  it('with NO compiled-in key (the slots are empty until GW4) every manifest is refused', () => {
    expect(RELEASE_KEYS_WIRE).toEqual([]);
    expect(compiledReleaseKeys()).toEqual([]);
    expect(verifyManifest({ ...base, keys: undefined }).reason).toBe('no_release_key');
  });
  it('the artefact must match size and hash', () => {
    expect(verifyArtefact(archive, { sha256: sha(archive), size: archive.length })).toBe(true);
    expect(verifyArtefact(Buffer.from('the artefacT'), { sha256: sha(archive), size: archive.length })).toBe(false);
    expect(verifyArtefact(archive, { sha256: sha(archive), size: archive.length + 1 })).toBe(false);
  });
  it('versions compare numerically', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('garbage', '0.0.1')).toBe(-1);
    expect(parseVersion('1.2.3-beta')).toBeNull();
  });
});

describe('the archive (ustar, files and directories only)', () => {
  it('round-trips files and directories, long names through the prefix field', () => {
    const long = 'app/' + 'd'.repeat(60) + '/' + 'f'.repeat(60) + '.mjs';
    const t = writeTar([{ name: 'app', type: 'dir' }, { name: 'node.exe', type: 'file', data: 'MZ', mode: 0o755 }, { name: long, type: 'file', data: 'x' }]);
    expect(readTar(t).map((e) => [e.name, e.type, e.data?.toString()])).toEqual([['app', 'dir', undefined], ['node.exe', 'file', 'MZ'], [long, 'file', 'x']]);
  });
  it('refuses the whole archive for a link, a traversal, an absolute or a drive-letter name', () => {
    expect(() => readTar(writeTar([{ name: 'a', type: 'file', data: 'x', typeflag: '2', linkname: '/etc/passwd' }]))).toThrow(/type/);
    for (const name of ['../evil.exe', '/abs.exe', 'C:/x.exe', 'a/../../b', 'a\\b']) expect(() => readTar(writeTar([{ name, type: 'file', data: 'x' }])), name).toThrow();
    expect(safeEntryName('ok/dir/')).toBe('ok/dir');
  });
  it('refuses a corrupt header', () => {
    const raw = writeTar([{ name: 'a.txt', type: 'file', data: 'x' }], { gzip: false });
    raw[0] ^= 1;
    expect(() => readTar(raw, { gzip: false })).toThrow(/checksum/);
  });
});

// ── the swap ────────────────────────────────────────────────────────────────
const PROGRAM = 'C:\\Program Files\\WILSON Gateway';
const STATE = 'C:\\ProgramData\\WILSON Gateway';
const paths = swapPaths(PROGRAM, STATE);

function world({ healthyAfterMs = 2_000, healthy = true, plantedFile = false } = {}) {
  const fs = memfs({
    [PROGRAM]: null, [STATE]: null, [paths.downloads]: null,
    [`${paths.current}\\node.exe`]: 'old node', [`${paths.current}\\app\\version.json`]: JSON.stringify({ version: '1.0.0' }),
  });
  const archive = writeTar([{ name: 'node.exe', type: 'file', data: 'new node' }, { name: 'app/version.json', type: 'file', data: JSON.stringify({ version: '1.1.0' }) }]);
  fs.plant(`${paths.downloads}\\wilson-gateway-1.1.0.tar.gz`, archive);
  if (plantedFile) fs.plant(`${paths.downloads}\\evil.dll`, 'MZ evil');
  const manifest = manifestFor(archive);
  let clock = Date.parse('2026-10-10T09:00:00Z');
  const events = [];
  let serviceRunning = true;
  const env = {
    fsp: fs.fsp,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
      if (healthy && serviceRunning && clock - startedAt >= healthyAfterMs && fs.exists(`${paths.current}\\node.exe`) && fs.read(`${paths.current}\\node.exe`) === 'new node') {
        fs.plant(paths.healthy, JSON.stringify({ version: '1.1.0', at: new Date(clock).toISOString() }));
      }
    },
    service: { stop: async () => { events.push('stop'); serviceRunning = false; }, start: async () => { events.push('start'); serviceRunning = true; startedAt = clock; } },
    runningVersion: async () => JSON.parse(fs.read(`${paths.current}\\app\\version.json`) || '{}').version,
    verify: async ({ manifestBytes, signatureText, archiveBytes, runningVersion, lastPublishedAt }) => {
      const r = verifyManifest({ manifestBytes, signatureText, keys: [keyA.publicKey], runningVersion, lastPublishedAt, platformKey: 'windows-x64' });
      if (!r.ok) return { ok: false, reason: r.reason };
      if (!r.newer) return { ok: false, reason: 'not_newer', version: r.manifest.version };
      if (!verifyArtefact(archiveBytes, r.manifest.artefacts['windows-x64'])) return { ok: false, reason: 'hash', version: r.manifest.version };
      return { ok: true, version: r.manifest.version, publishedAt: r.manifest.published_at };
    },
    extract: async (bytes, dir) => { for (const e of readTar(bytes)) if (e.type === 'file') fs.plant(`${dir}\\${e.name.replace(/\//g, '\\')}`, e.data); },
  };
  let startedAt = clock;
  const request = { artefact: 'wilson-gateway-1.1.0.tar.gz', manifest: manifest.toString('base64'), signature: sign(manifest) };
  return { fs, env, events, request, archive };
}

describe('the swap (§8, R7)', () => {
  it('the happy path: stop, current → previous, staged → current, start, healthy within 90 s', async () => {
    const w = world();
    const r = await runSwap(w.env, paths, w.request, { pollMs: 500 });
    expect(r).toEqual({ ok: true, version: '1.1.0' });
    expect(w.fs.read(`${paths.current}\\node.exe`)).toBe('new node');
    expect(w.fs.read(`${paths.previous}\\node.exe`)).toBe('old node');
    expect(w.fs.exists(paths.swapJson)).toBe(false);
    expect(w.fs.exists(paths.stagedArchive)).toBe(false);
    expect(JSON.parse(w.fs.read(paths.lastManifest))).toEqual({ version: '1.1.0', published_at: '2026-10-10T08:00:00Z' });
    expect(w.events).toEqual(['stop', 'start']);
    // swap.json was written before each rename
    const order = w.fs.log.filter((e) => e[0] === 'rename' || (e[0] === 'write' && e[1].endsWith('swap.json'))).map((e) => (e[0] === 'rename' ? `rename ${e[1].split('\\').pop()}` : 'journal'));
    expect(order).toEqual(['journal', 'journal', 'rename current', 'journal', 'rename staged', 'journal']);
  });

  it('a deliberately broken build (never healthy) is reverted: the old version back, update-failed.json written', async () => {
    const w = world({ healthy: false });
    const r = await runSwap(w.env, paths, w.request, { pollMs: 5_000 });
    expect(r).toMatchObject({ ok: false, reverted: true, reason: 'the new version did not report healthy within 90 s' });
    expect(w.fs.read(`${paths.current}\\node.exe`)).toBe('old node');
    expect(w.fs.read(`${paths.failed}\\node.exe`)).toBe('new node');
    expect(JSON.parse(w.fs.read(paths.updateFailed))).toMatchObject({ version: '1.1.0', running: '1.0.0' });
    expect(w.events).toEqual(['stop', 'start', 'stop', 'start']);
    expect(w.fs.exists(paths.swapJson)).toBe(false);
  });

  it('a file planted in the download folder never reaches the swap', async () => {
    const w = world({ plantedFile: true });
    expect((await runSwap(w.env, paths, w.request, { pollMs: 500 })).ok).toBe(true);
    expect(w.fs.list(paths.current).some((f) => /evil/i.test(f))).toBe(false);
    expect(w.fs.log.some((e) => e[0] === 'read' && /evil/i.test(e[1]))).toBe(false);
  });

  it('an artefact replaced after the gateway checked it is refused by the updater\'s own check, before anything stops', async () => {
    const w = world();
    w.fs.plant(`${paths.downloads}\\wilson-gateway-1.1.0.tar.gz`, writeTar([{ name: 'node.exe', type: 'file', data: 'trojan' }]));
    const r = await runSwap(w.env, paths, w.request, { pollMs: 500 });
    expect(r).toMatchObject({ ok: false, reason: 'verification', detail: 'hash' });
    expect(w.events).toEqual([]);
    expect(w.fs.read(`${paths.current}\\node.exe`)).toBe('old node');
    expect(w.fs.exists(paths.staged)).toBe(false);
    expect(JSON.parse(w.fs.read(paths.updateFailed)).reason).toContain('verification failed');
  });

  it('the copy that is verified is the copy in Program Files, read back, not the download', async () => {
    const w = world();
    await runSwap(w.env, paths, w.request, { pollMs: 500 });
    const reads = w.fs.log.filter((e) => e[0] === 'read').map((e) => e[1]);
    const iDownload = reads.findIndex((p) => p.includes('updates'));
    const iCopy = reads.findIndex((p) => p.endsWith('staged.archive'));
    expect(iDownload).toBeGreaterThanOrEqual(0);
    expect(iCopy).toBeGreaterThan(iDownload);
  });

  it('a request naming anything but one file in the download folder is refused before any read', async () => {
    for (const artefact of ['..\\..\\Windows\\evil.exe', 'a/b.tar.gz', '', '.', '..', 'x'.repeat(101), 'C:evil']) {
      const w = world();
      expect((await runSwap(w.env, paths, { ...w.request, artefact }, { pollMs: 500 })).reason, artefact).toBe('bad_request');
      expect(w.fs.log.filter((e) => e[0] === 'read')).toEqual([]);
    }
  });

  it('an older or equal version, or a stale manifest, is refused', async () => {
    const w = world();
    w.fs.plant(paths.lastManifest, JSON.stringify({ version: '1.0.5', published_at: '2026-10-11T00:00:00Z' }));
    expect(await runSwap(w.env, paths, w.request, { pollMs: 500 })).toMatchObject({ ok: false, detail: 'stale' });
  });

  it('a second swap while one is journalled is refused', async () => {
    const w = world();
    w.fs.plant(paths.swapJson, JSON.stringify({ step: 'starting' }));
    expect((await runSwap(w.env, paths, w.request)).reason).toBe('swap_in_progress');
  });
});

describe('recovery at the updater\'s start (an unfinished swap completed or reverted)', () => {
  async function crashAt(step) {
    // Run a swap, then rewind the world to the moment the step was journalled.
    const w = world();
    const meta = { version: '1.1.0', publishedAt: '2026-10-10T08:00:00Z', running: '1.0.0' };
    await w.env.extract(w.archive, paths.staged);
    if (step === 'renaming_staged-before') {
      await w.fs.fsp.rename(paths.current, paths.previous);
      w.fs.plant(paths.swapJson, JSON.stringify({ step: 'renaming_staged', ...meta }));
    } else if (step === 'renaming_staged-after' || step === 'starting') {
      await w.fs.fsp.rename(paths.current, paths.previous);
      await w.fs.fsp.rename(paths.staged, paths.current);
      w.fs.plant(paths.swapJson, JSON.stringify({ step: step === 'starting' ? 'starting' : 'renaming_staged', ...meta }));
    } else if (step === 'renaming_current') {
      w.fs.plant(paths.swapJson, JSON.stringify({ step, ...meta }));
    } else if (step === 'reverting') {
      await w.fs.fsp.rename(paths.current, paths.previous);
      await w.fs.fsp.rename(paths.staged, paths.current);
      w.fs.plant(paths.swapJson, JSON.stringify({ step, ...meta, reason: 'not healthy' }));
    }
    return w;
  }
  it('crashed before current moved: reverted (nothing to undo), the old version started', async () => {
    const w = await crashAt('renaming_current');
    expect((await recoverSwap(w.env, paths)).action).toBe('reverted');
    expect(w.fs.read(`${paths.current}\\node.exe`)).toBe('old node');
    expect(w.events).toEqual(['start']);
  });
  it('crashed between the two renames: previous moved back', async () => {
    const w = await crashAt('renaming_staged-before');
    expect((await recoverSwap(w.env, paths)).action).toBe('reverted');
    expect(w.fs.read(`${paths.current}\\node.exe`)).toBe('old node');
    expect(w.fs.exists(paths.swapJson)).toBe(false);
  });
  it('crashed after both renames: the new version gets its 90 s and is completed', async () => {
    const w = await crashAt('renaming_staged-after');
    expect((await recoverSwap(w.env, paths, { pollMs: 500 })).action).toBe('completed');
    expect(w.fs.read(`${paths.current}\\node.exe`)).toBe('new node');
  });
  it('crashed while starting a broken build: reverted', async () => {
    const w = await crashAt('starting');
    w.env.sleep = async (ms) => { w.env.now = ((t) => () => t)(w.env.now() + ms); };
    expect((await recoverSwap(w.env, paths, { pollMs: 10_000 })).action).toBe('reverted');
    expect(w.fs.read(`${paths.current}\\node.exe`)).toBe('old node');
  });
  it('crashed while reverting: the revert is finished', async () => {
    const w = await crashAt('reverting');
    expect((await recoverSwap(w.env, paths)).action).toBe('reverted');
    expect(w.fs.read(`${paths.current}\\node.exe`)).toBe('old node');
    expect(w.fs.exists(paths.updateFailed)).toBe(true);
  });
  it('nothing journalled: nothing done', async () => {
    const w = world();
    expect(await recoverSwap(w.env, paths)).toEqual({ action: 'none' });
    expect(w.events).toEqual([]);
  });
});

describe('rollback (administrators)', () => {
  it('swaps current and previous, and a second rollback swaps them back', async () => {
    const w = world();
    await runSwap(w.env, paths, w.request, { pollMs: 500 });
    expect((await runRollback(w.env, paths)).ok).toBe(true);
    expect(w.fs.read(`${paths.current}\\node.exe`)).toBe('old node');
    expect(w.fs.read(`${paths.previous}\\node.exe`)).toBe('new node');
    await runRollback(w.env, paths);
    expect(w.fs.read(`${paths.current}\\node.exe`)).toBe('new node');
  });
  it('without a previous version there is nothing to roll back to', async () => {
    expect(await runRollback(world().env, paths)).toEqual({ ok: false, reason: 'no_previous_version' });
  });
  it('a rollback interrupted after its first rename is finished at the updater\'s start', async () => {
    const w = world();
    await runSwap(w.env, paths, w.request, { pollMs: 500 });
    await w.fs.fsp.rename(paths.current, paths.rollbackTmp);
    w.fs.plant(paths.swapJson, JSON.stringify({ step: 'rollback_1' }));
    expect((await recoverSwap(w.env, paths)).action).toBe('rolled_back');
    expect(w.fs.read(`${paths.current}\\node.exe`)).toBe('old node');
    expect(w.fs.read(`${paths.previous}\\node.exe`)).toBe('new node');
  });
});
