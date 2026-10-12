// =============================================================================
// releasePipeline.test.mjs — GW4 item 2: the release pipeline's rules
// (gateway/pipeline/lib.mjs) and what the workflow promises
// (.github/workflows/gateway-release.yml), read from its file as GW2's
// container.test.mjs reads gateway.yml. The workflow itself runs on GitHub:
// its dry run's draft release is read back through the API (hand-off §3).
// =============================================================================

import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  planRelease, stampVersion, checkArtefact, floorsFor, makeManifest, privateKeyFromSecret, signManifest, readBack,
  artefactName, msiName, MANIFEST_NAME, SIGNATURE_NAME, TAG_RE,
} from '../pipeline/lib.mjs';
import { writeTar } from '../src/update/tar.mjs';
import { verifyManifest, RELEASE_KEYS_WIRE, CONTAINER_IMAGE } from '../src/update/manifest.mjs';
import { publicKeyToWire } from '../src/wire/formats.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GW = path.join(HERE, '..');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8').replace(/\r\n/g, '\n');
const workflow = read(GW, '..', '..', '.github', 'workflows', 'gateway-release.yml');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const DIGEST = 'sha256:' + 'd'.repeat(64);

describe('the plan: what a run is', () => {
  const base = { runId: '123', packageVersion: '0.1.0' };
  it('a pushed tag gateway-vX.Y.Z is a REAL release of X.Y.Z under that tag', () => {
    expect(planRelease({ ...base, event: 'push', refType: 'tag', refName: 'gateway-v1.2.3', dryRunInput: '' })).toEqual({ ok: true, dryRun: false, version: '1.2.3', tag: 'gateway-v1.2.3', releaseName: 'WILSON file gateway 1.2.3' });
  });
  it('a pushed tag gateway-vX.Y.Z-dryrun is a DRY RUN named gateway-dry-run-<run id>', () => {
    expect(planRelease({ ...base, event: 'push', refType: 'tag', refName: 'gateway-v0.0.0-dryrun', dryRunInput: '' })).toEqual({ ok: true, dryRun: true, version: '0.0.0', tag: 'gateway-dry-run-123', releaseName: 'gateway-dry-run-123' });
  });
  it('by hand: on a branch always a dry run (dry_run off is refused with the way to release); on a tag, dry_run off repeats the real release', () => {
    expect(planRelease({ ...base, event: 'workflow_dispatch', refType: 'branch', refName: 'main', dryRunInput: 'true' })).toMatchObject({ ok: true, dryRun: true, version: '0.1.0', tag: 'gateway-dry-run-123' });
    expect(planRelease({ ...base, event: 'workflow_dispatch', refType: 'branch', refName: 'main', dryRunInput: 'false' })).toMatchObject({ ok: false, error: expect.stringContaining('push gateway-vX.Y.Z') });
    expect(planRelease({ ...base, event: 'workflow_dispatch', refType: 'tag', refName: 'gateway-v1.2.3', dryRunInput: 'true' })).toMatchObject({ ok: true, dryRun: true });
    expect(planRelease({ ...base, event: 'workflow_dispatch', refType: 'tag', refName: 'gateway-v1.2.3', dryRunInput: 'false' })).toMatchObject({ ok: true, dryRun: false, tag: 'gateway-v1.2.3' });
    // A -dryrun tag is never real, whatever the input says.
    expect(planRelease({ ...base, event: 'workflow_dispatch', refType: 'tag', refName: 'gateway-v1.2.3-dryrun', dryRunInput: 'false' })).toMatchObject({ ok: true, dryRun: true });
  });
  it('any other tag, a leading zero, a pre-release word, or a package version that is not X.Y.Z is refused', () => {
    for (const refName of ['gateway-v1.2', 'gateway-v1.2.3-rc1', 'gateway-v01.2.3', 'v1.2.3', 'gateway-v1.2.3 ', 'gateway-v1.2.3-dryrun-x']) {
      expect(planRelease({ ...base, event: 'push', refType: 'tag', refName, dryRunInput: '' }).ok, refName).toBe(false);
    }
    expect(planRelease({ ...base, packageVersion: '0.1', event: 'workflow_dispatch', refType: 'branch', refName: 'x', dryRunInput: 'true' }).ok).toBe(false);
    expect(TAG_RE.test('gateway-v1.2.3')).toBe(true);
  });
});

describe('the version stamp', () => {
  it('writes the same X.Y.Z into package.json and version.mjs, and only an X.Y.Z', () => {
    const s = stampVersion({ packageJsonText: read(GW, 'package.json'), versionMjsText: read(GW, 'src', 'version.mjs'), version: '7.8.9' });
    expect(JSON.parse(s.packageJsonText).version).toBe('7.8.9');
    expect(s.versionMjsText).toContain("export const VERSION = '7.8.9';");
    expect(s.versionMjsText.match(/export const VERSION/g)).toHaveLength(1);
    expect(() => stampVersion({ packageJsonText: '{}', versionMjsText: "export const VERSION = '0.1.0';", version: '7.8' })).toThrow(/X\.Y\.Z/);
    expect(() => stampVersion({ packageJsonText: '{}', versionMjsText: 'nothing', version: '7.8.9' })).toThrow(/VERSION/);
  });
});

describe('the Windows artefact, read back with the gateway\'s own reader', () => {
  const app = (v) => [
    { name: 'node.exe', type: 'file', data: 'MZ node' },
    { name: 'app', type: 'dir' },
    { name: 'app/package.json', type: 'file', data: JSON.stringify({ version: v }) },
    { name: 'app/src/cli.mjs', type: 'file', data: '//' },
    { name: 'app/src/runtime.mjs', type: 'file', data: '//' },
    { name: 'app/src/version.mjs', type: 'file', data: `export const VERSION = '${v}';\n` },
    { name: 'app/updater/updater.mjs', type: 'file', data: '//' },
  ];
  it('node.exe and app/ as current\\ holds them, the version stamped, node.exe the staged one', () => {
    expect(checkArtefact(writeTar(app('1.2.3')), { version: '1.2.3', nodeExeSha256: sha(Buffer.from('MZ node')) })).toMatchObject({ ok: true, problems: [] });
  });
  it('refuses a stray file, a test, another version, another node.exe, a missing piece', () => {
    expect(checkArtefact(writeTar([...app('1.2.3'), { name: 'app/test/x.test.mjs', type: 'file', data: '' }]), { version: '1.2.3' }).problems).toEqual(['a file the app does not ship: app/test/x.test.mjs']);
    expect(checkArtefact(writeTar([...app('1.2.3'), { name: 'evil.dll', type: 'file', data: 'MZ' }]), { version: '1.2.3' }).problems.join()).toContain('outside node.exe and app/');
    expect(checkArtefact(writeTar(app('1.2.4')), { version: '1.2.3' }).problems).toEqual(['app/package.json is not version 1.2.3', 'app/src/version.mjs is not version 1.2.3']);
    expect(checkArtefact(writeTar(app('1.2.3')), { version: '1.2.3', nodeExeSha256: sha(Buffer.from('another')) }).problems).toEqual(["node.exe is not the pinned build's"]);
    expect(checkArtefact(writeTar(app('1.2.3').filter((e) => e.name !== 'app/updater/updater.mjs')), { version: '1.2.3' }).problems).toEqual(['missing app/updater/updater.mjs']);
  });
});

describe('stable.json and its signature', () => {
  const artefact = Buffer.from(crypto.randomBytes(5000));
  const floors0 = { minimum_version: null, hard_minimum_version: null };
  it('the manifest names the release asset and the image by digest, and a gateway would accept its shape', () => {
    const m = JSON.parse(makeManifest({ version: '1.2.3', tag: 'gateway-v1.2.3', publishedAt: '2026-10-11T10:00:00.000Z', artefact, containerDigest: DIGEST, floors: floors0, notes: 'n' }).toString());
    expect(m).toEqual({
      version: '1.2.3', published_at: '2026-10-11T10:00:00.000Z', minimum_version: null, hard_minimum_version: null,
      artefacts: { 'windows-x64': { url: `https://github.com/pretty-aud/wilson/releases/download/gateway-v1.2.3/${artefactName('1.2.3')}`, sha256: sha(artefact), size: artefact.length }, container: { image: CONTAINER_IMAGE, digest: DIGEST } },
      notes: 'n',
    });
    expect(() => makeManifest({ version: '1.2.3', tag: 'gateway-v1.2.3', publishedAt: 'x', artefact, containerDigest: 'sha256:short', floors: floors0 })).toThrow(/digest/);
  });
  it('the floors: X.Y.Z or null, never above the release, the hard one never above the other', () => {
    expect(floorsFor(read(GW, 'pipeline', 'floors.json'), '0.1.0')).toEqual({ minimum_version: null, hard_minimum_version: null });
    expect(floorsFor('{"minimum_version":"1.2.0","hard_minimum_version":"1.1.0"}', '1.2.3')).toEqual({ minimum_version: '1.2.0', hard_minimum_version: '1.1.0' });
    expect(() => floorsFor('{"minimum_version":"1.3.0"}', '1.2.3')).toThrow(/above this release/);
    expect(() => floorsFor('{"hard_minimum_version":"1.2.0","minimum_version":"1.1.0"}', '1.2.3')).toThrow(/hard minimum is above/);
    expect(() => floorsFor('{"minimum_version":"one"}', '1.2.3')).toThrow(/not X\.Y\.Z/);
  });
  it('a dry run signs with a throwaway pair; the signature verifies with its public half, as a gateway verifies it', () => {
    const mb = makeManifest({ version: '0.0.0', tag: 'gateway-dry-run-9', publishedAt: '2026-10-11T10:00:00.000Z', artefact, containerDigest: DIGEST, floors: floors0 });
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const s = signManifest(mb, privateKey, { dryRun: true });
    expect(s.publicKeyWire).toBe(publicKeyToWire(publicKey));
    expect(s.kid).toBeNull();
    expect(verifyManifest({ manifestBytes: mb, signatureText: s.signature, keys: [publicKey], runningVersion: '0.0.0', platformKey: 'windows-x64', now: Date.parse('2026-10-11T10:00:00Z') }).ok).toBe(true);
  });
  it('the signed manifest is checked as a gateway checks it before it leaves the job: a shape or a date a gateway would refuse is never signed', () => {
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    const base = JSON.parse(makeManifest({ version: '0.0.0', tag: 'gateway-dry-run-9', publishedAt: '2026-10-11T10:00:00.000Z', artefact, containerDigest: DIGEST, floors: floors0 }).toString());
    const elsewhere = { ...base, artefacts: { ...base.artefacts, 'windows-x64': { ...base.artefacts['windows-x64'], url: 'https://evil.example/wilson-gateway-0.0.0-windows-x64.tar.gz' } } };
    expect(() => signManifest(Buffer.from(JSON.stringify(elsewhere)), privateKey, { dryRun: true })).toThrow(/does not verify for windows-x64 \(shape\)/);
    const future = { ...base, published_at: new Date(Date.now() + 3 * 86_400_000).toISOString() };
    expect(() => signManifest(Buffer.from(JSON.stringify(future)), privateKey, { dryRun: true })).toThrow(/does not verify for windows-x64 \(future\)/);
    // CONTROL: the same key signs the manifest as made.
    expect(signManifest(Buffer.from(JSON.stringify(base)), privateKey, { dryRun: true }).signature).toMatch(/^[A-Za-z0-9+/]{86}==$/);
  });
  it('a REAL release refuses a key that is in no slot (gateways would refuse its manifests)', () => {
    const mb = makeManifest({ version: '1.2.3', tag: 'gateway-v1.2.3', publishedAt: '2026-10-11T10:00:00.000Z', artefact, containerDigest: DIGEST, floors: floors0 });
    const other = crypto.generateKeyPairSync('ed25519').privateKey;
    expect(() => signManifest(mb, other, { dryRun: false })).toThrow(/in no release key slot/);
    // CONTROL: the slot holds one key, and it is not this one.
    expect(RELEASE_KEYS_WIRE.some((k) => k.public_key === publicKeyToWire(crypto.createPublicKey(other)))).toBe(false);
  });
  it('the secret is ONE line of base64 PKCS#8 Ed25519; anything else is refused without echoing it', () => {
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    const line = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
    expect(line).toHaveLength(64);
    expect(privateKeyFromSecret(`  ${line}\n`).asymmetricKeyType).toBe('ed25519');
    const rsaLine = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
    for (const bad of ['', 'not base64!', `${line.slice(0, 40)}\n${line.slice(40)}`, rsaLine]) {
      let message = '';
      try { privateKeyFromSecret(bad); } catch (e) { message = e.message; }
      expect(message, bad.slice(0, 10)).toMatch(/the signing secret is not/);
      expect(message).not.toContain(line.slice(0, 20));
    }
  });
});

describe('the read-back: the release as GitHub serves it, held to its manifest', () => {
  const artefact = Buffer.from(crypto.randomBytes(3000));
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const mb = makeManifest({ version: '0.0.0', tag: 'gateway-dry-run-9', publishedAt: '2026-10-11T10:00:00.000Z', artefact, containerDigest: DIGEST, floors: { minimum_version: null, hard_minimum_version: null } });
  const assets = () => new Map([
    [msiName('0.0.0'), Buffer.from('MSI')],
    [artefactName('0.0.0'), artefact],
    [MANIFEST_NAME, mb],
    [SIGNATURE_NAME, Buffer.from(crypto.sign(null, mb, privateKey).toString('base64'))],
  ]);
  it('every asset served as made: ok, with each one\'s size and SHA-256', () => {
    const r = readBack({ assets: assets(), version: '0.0.0', tag: 'gateway-dry-run-9', keys: [publicKey] });
    expect(r).toMatchObject({ ok: true, problems: [] });
    expect(r.sums.map((s) => s.name)).toEqual([msiName('0.0.0'), artefactName('0.0.0'), MANIFEST_NAME, SIGNATURE_NAME]);
  });
  it('a tampered artefact, a missing MSI, another key, a flipped manifest byte: each named', () => {
    const t = assets(); const a = Buffer.from(artefact); a[0] ^= 1; t.set(artefactName('0.0.0'), a);
    expect(readBack({ assets: t, version: '0.0.0', tag: 'gateway-dry-run-9', keys: [publicKey] }).problems).toEqual(["the artefact's SHA-256 is not the manifest's"]);
    const m = assets(); m.delete(msiName('0.0.0'));
    expect(readBack({ assets: m, version: '0.0.0', tag: 'gateway-dry-run-9', keys: [publicKey] }).problems).toEqual([`${msiName('0.0.0')} is not an asset`]);
    const other = crypto.generateKeyPairSync('ed25519').publicKey;
    expect(readBack({ assets: assets(), version: '0.0.0', tag: 'gateway-dry-run-9', keys: [other] }).problems.join()).toContain('(signature)');
    const f = assets(); const fm = Buffer.from(mb); fm[20] ^= 1; f.set(MANIFEST_NAME, fm);
    expect(readBack({ assets: f, version: '0.0.0', tag: 'gateway-dry-run-9', keys: [publicKey] }).ok).toBe(false);
  });
  it('a manifest for another version, or naming another release\'s artefact, is named (gateways download what it names)', () => {
    const resigned = (bytes) => {
      const x = assets();
      x.set(MANIFEST_NAME, bytes);
      x.set(SIGNATURE_NAME, Buffer.from(crypto.sign(null, bytes, privateKey).toString('base64')));
      return x;
    };
    const floors = { minimum_version: null, hard_minimum_version: null };
    const v1 = makeManifest({ version: '0.0.1', tag: 'gateway-dry-run-9', publishedAt: '2026-10-11T10:00:00.000Z', artefact, containerDigest: DIGEST, floors });
    expect(readBack({ assets: resigned(v1), version: '0.0.0', tag: 'gateway-dry-run-9', keys: [publicKey] }).problems).toEqual([
      'stable.json says 0.0.1, the release is 0.0.0',
      `the manifest's artefact URL is not this release's ${artefactName('0.0.0')}`,
    ]);
    const elsewhere = makeManifest({ version: '0.0.0', tag: 'gateway-dry-run-8', publishedAt: '2026-10-11T10:00:00.000Z', artefact, containerDigest: DIGEST, floors });
    expect(readBack({ assets: resigned(elsewhere), version: '0.0.0', tag: 'gateway-dry-run-9', keys: [publicKey] }).problems).toEqual([
      `the manifest's artefact URL is not this release's ${artefactName('0.0.0')}`,
    ]);
  });
});

// The release job's steps against a fake GitHub API on loopback (plain HTTP):
// the draft, the uploads, the read-back through the API (the asset download
// redirected to a storage route that must NOT see the token), and the publish.
describe('github-release against a fake GitHub API on loopback', () => {
  const runCli = (env) => new Promise((resolve) => {
    import('node:child_process').then(({ execFile }) => {
      execFile(process.execPath, [path.join(GW, 'pipeline', 'cli.mjs'), 'github-release', '--dir', env.DIR], { env: { ...process.env, ...env }, timeout: 30_000 }, (err, stdout, stderr) => resolve({ code: err ? err.code ?? 1 : 0, stdout, stderr }));
    });
  });
  async function fakeGitHub({ tagStatus = 404 } = {}) {
    const http = await import('node:http');
    const calls = [];
    const assets = new Map();
    let published = null;
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const u = new URL(req.url, 'http://x');
        calls.push({ method: req.method, path: u.pathname, auth: req.headers.authorization || null, query: u.search });
        const json = (status, v) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
        const base = `http://127.0.0.1:${server.address().port}`;
        if (req.method === 'GET' && /\/releases\/tags\//.test(u.pathname)) return json(tagStatus, tagStatus === 200 ? { id: 5, draft: false, tag_name: decodeURIComponent(u.pathname.split('/').pop()) } : { message: tagStatus === 404 ? 'Not Found' : 'Server Error' });
        if (req.method === 'POST' && u.pathname === '/repos/pretty-aud/wilson/releases') {
          const b = JSON.parse(body.toString());
          calls.at(-1).create = b;
          return json(201, { id: 77, name: b.name, html_url: `${base}/release/77`, upload_url: `${base}/upload/77/assets{?name,label}` });
        }
        if (req.method === 'POST' && u.pathname === '/upload/77/assets') {
          const id = 900 + assets.size;
          assets.set(id, { name: u.searchParams.get('name'), bytes: body });
          return json(201, { id });
        }
        if (req.method === 'GET' && u.pathname === '/repos/pretty-aud/wilson/releases/77/assets') return json(200, [...assets.entries()].map(([id, a]) => ({ id, name: a.name })));
        let m;
        if (req.method === 'GET' && (m = /^\/repos\/pretty-aud\/wilson\/releases\/assets\/(\d+)$/.exec(u.pathname))) { res.writeHead(302, { location: `${base}/storage/${m[1]}?sig=abc` }); return res.end(); }
        if (req.method === 'GET' && (m = /^\/storage\/(\d+)$/.exec(u.pathname))) { res.writeHead(200); return res.end(assets.get(Number(m[1])).bytes); }
        if (req.method === 'PATCH' && u.pathname === '/repos/pretty-aud/wilson/releases/77') { published = JSON.parse(body.toString()); return json(200, { html_url: `${base}/release/77` }); }
        return json(404, { message: `no route ${req.method} ${u.pathname}` });
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    return { calls, assets, published: () => published, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
  }
  function releaseDir(version, { keyPair = crypto.generateKeyPairSync('ed25519'), tag = 'gateway-dry-run-5' } = {}) {
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'gw4-ghr-'));
    const artefact = Buffer.from(crypto.randomBytes(4000));
    const mb = makeManifest({ version, tag, publishedAt: new Date().toISOString(), artefact, containerDigest: DIGEST, floors: { minimum_version: null, hard_minimum_version: null } });
    fs.writeFileSync(path.join(dir, msiName(version)), 'MSI bytes');
    fs.writeFileSync(path.join(dir, artefactName(version)), artefact);
    fs.writeFileSync(path.join(dir, MANIFEST_NAME), mb);
    fs.writeFileSync(path.join(dir, SIGNATURE_NAME), crypto.sign(null, mb, keyPair.privateKey).toString('base64'));
    return { dir, publicWire: publicKeyToWire(keyPair.publicKey) };
  }
  const env = (gh, over) => ({ GITHUB_TOKEN: 'ghs_test_token', GITHUB_REPOSITORY: 'pretty-aud/wilson', GITHUB_API_URL: gh.base, GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '5', GITHUB_WORKFLOW: 'Gateway release', ...over });

  it('a dry run: a DRAFT pre-release with five assets, read back through the API, verified with the throwaway key, never published; the token never reaches the storage', async () => {
    const gh = await fakeGitHub();
    try {
      const { dir, publicWire } = releaseDir('0.0.0');
      const r = await runCli(env(gh, { DIR: dir, DRY_RUN: 'true', VERSION: '0.0.0', TAG: 'gateway-dry-run-5', RELEASE_NAME: 'gateway-dry-run-5', PUBLIC_KEY: publicWire }));
      expect(r.code, r.stdout + r.stderr).toBe(0);
      const create = gh.calls.find((c) => c.create)?.create;
      expect(create).toMatchObject({ tag_name: 'gateway-dry-run-5', name: 'gateway-dry-run-5', draft: true, prerelease: true, make_latest: 'false', target_commitish: 'a'.repeat(40) });
      expect([...gh.assets.values()].map((a) => a.name).sort()).toEqual(['SHA256SUMS', 'WILSON-Gateway-Setup-0.0.0.msi', 'stable.json', 'stable.json.sig', 'wilson-gateway-0.0.0-windows-x64.tar.gz']);
      expect(gh.published()).toBeNull();
      expect(gh.calls.filter((c) => c.path.startsWith('/storage/')).every((c) => c.auth === null)).toBe(true);
      expect(gh.calls.filter((c) => c.path.startsWith('/repos/')).every((c) => c.auth === 'Bearer ghs_test_token')).toBe(true);
      expect(r.stdout).toContain(`::notice title=Read back::5 assets; the artefact's size and SHA-256 are the manifest's; the signature over the served stable.json verifies with the dry run's throwaway key ${publicWire}`);
      expect(r.stdout).toContain('::notice title=Dry run::left as a DRAFT pre-release');
      expect(r.stdout).not.toContain('ghs_test_token');
    } finally { await gh.close(); }
  });
  it('a REAL release whose signature the compiled-in key does not verify is never published (the read-back stops it)', async () => {
    const gh = await fakeGitHub();
    try {
      const { dir } = releaseDir('1.2.3', { tag: 'gateway-v1.2.3' });
      const r = await runCli(env(gh, { DIR: dir, DRY_RUN: 'false', VERSION: '1.2.3', TAG: 'gateway-v1.2.3', RELEASE_NAME: 'WILSON file gateway 1.2.3', PUBLIC_KEY: '' }));
      expect(r.code).not.toBe(0);
      expect(r.stdout).toMatch(/::error::read back: the signature or shape does not hold for windows-x64 \(signature\)/);
      expect(gh.published()).toBeNull();
      expect(gh.calls.find((c) => c.create)?.create).toMatchObject({ tag_name: 'gateway-v1.2.3', draft: true, prerelease: false });
    } finally { await gh.close(); }
  });
  it('a REAL release of a tag released before is refused before anything is made; so is a tag GitHub cannot answer for', async () => {
    for (const [tagStatus, said] of [
      [200, 'gateway-v1.2.3 is released already; a release is never replaced. Tag the next version.'],
      [502, 'could not tell whether gateway-v1.2.3 is released already (GitHub answered 502)'],
    ]) {
      const gh = await fakeGitHub({ tagStatus });
      try {
        const { dir } = releaseDir('1.2.3', { tag: 'gateway-v1.2.3' });
        const r = await runCli(env(gh, { DIR: dir, DRY_RUN: 'false', VERSION: '1.2.3', TAG: 'gateway-v1.2.3', RELEASE_NAME: 'WILSON file gateway 1.2.3', PUBLIC_KEY: '' }));
        expect(r.code, String(tagStatus)).not.toBe(0);
        expect(r.stdout).toContain(said);
        expect(gh.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /repos/pretty-aud/wilson/releases/tags/gateway-v1.2.3']);
        expect(gh.published()).toBeNull();
      } finally { await gh.close(); }
    }
  });
  it('refuses to release any other repository', async () => {
    const gh = await fakeGitHub();
    try {
      const { dir, publicWire } = releaseDir('0.0.0');
      const r = await runCli(env(gh, { DIR: dir, GITHUB_REPOSITORY: 'someone/fork', DRY_RUN: 'true', VERSION: '0.0.0', TAG: 'gateway-dry-run-5', RELEASE_NAME: 'x', PUBLIC_KEY: publicWire }));
      expect(r.code).not.toBe(0);
      expect(r.stdout).toContain('this workflow releases pretty-aud/wilson only');
      expect(gh.calls).toEqual([]);
    } finally { await gh.close(); }
  });
});

describe('the workflow (gateway-release.yml), as written', () => {
  const steps = workflow.split('\n');
  it('runs on a tag gateway-v* and by hand with a dry_run input that defaults to a dry run', () => {
    expect(workflow).toMatch(/on:\n  push:\n    tags:\n      - 'gateway-v\*'\n  workflow_dispatch:\n    inputs:\n      dry_run:/);
    expect(workflow).toMatch(/dry_run:\n        description: [^\n]+\n        type: boolean\n        default: true/);
  });
  it('every action is GitHub\'s own, pinned to a full commit; nothing third-party', () => {
    const uses = [...workflow.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(10);
    for (const u of uses) expect(u, u).toMatch(/^actions\/(checkout|setup-node|setup-dotnet|upload-artifact|download-artifact)@[0-9a-f]{40}$/);
  });
  it('read-only by default; only the registry job may write packages and only the release job may write contents', () => {
    expect(workflow).toMatch(/^permissions:\n  contents: read$/m);
    const writes = [...workflow.matchAll(/^ {6}(contents|packages): write$/gm)].map((m) => m[1]);
    expect(writes.sort()).toEqual(['contents', 'packages']);
    expect(workflow).toMatch(/release:\n {4}name: [^\n]+\n {4}needs: [^\n]+\n {4}if: >-[\s\S]+?permissions:\n {6}contents: write/);
  });
  it('the signing secret reaches one step of the real sign job only (in its environment), and the dry run never sees it', () => {
    const uses = workflow.match(/secrets\.GATEWAY_RELEASE_SIGNING_KEY/g) || [];
    expect(uses).toHaveLength(1);
    const job = workflow.slice(workflow.indexOf('\n  sign:\n'), workflow.indexOf('\n  release:\n'));
    expect(job).toContain('environment: gateway-release');
    expect(job).toContain("if: needs.plan.outputs.dry_run == 'false'");
    expect(job).toContain('GATEWAY_RELEASE_SIGNING_KEY: ${{ secrets.GATEWAY_RELEASE_SIGNING_KEY }}');
    const dry = workflow.slice(workflow.indexOf('\n  sign_dry_run:\n'), workflow.indexOf('\n  sign:\n'));
    expect(dry).toContain("if: needs.plan.outputs.dry_run == 'true'");
    expect(dry).toContain('--dry-run');
    expect(dry).not.toContain('secrets.');
  });
  it('the Authenticode steps are in place and skipped while no certificate secret is set (D14)', () => {
    expect(workflow).toContain("AUTHENTICODE_SET: ${{ secrets.GATEWAY_AUTHENTICODE_PFX != '' }}");
    const signing = steps.filter((l) => /name: Authenticode, the (host|MSI)/.test(l));
    expect(signing).toHaveLength(2);
    expect(workflow.match(/if: env\.AUTHENTICODE_SET == 'true'/g)).toHaveLength(2);
    expect(workflow).toMatch(/name: Unsigned \(D14\)\n {8}if: env\.AUTHENTICODE_SET != 'true'/);
    expect(read(GW, 'windows', 'sign.ps1')).toContain('/fd SHA256 /td SHA256 /tr');
  });
  it('the artefact is tar --format=ustar -czf of the MSI\'s own current\\, read back by the gateway\'s reader; the base is pinned; a dry run pushes nothing', () => {
    expect(workflow).toMatch(/tar --format=ustar [^\n]*-czf "\$T\/release\/\$ART" -C "\$STAGE" node\.exe app/);
    expect(workflow).toContain('STAGE="$T/gw/stage/current"');
    expect(workflow).toContain('pipeline/cli.mjs check-artefact');
    expect(workflow).toContain('-HostExe');
    expect(workflow).toMatch(/if \[ "\$DRY_RUN" = false \]; then args\+=\(--tag "\$IMAGE:\$VERSION" --tag "\$IMAGE:stable" --push\)/);
    expect(workflow).toMatch(/else args\+=\(--output "type=oci,dest=/);
    expect(workflow).toMatch(/name: Sign in to GitHub's registry \(a real release only\)\n {8}if: env\.DRY_RUN == 'false'/);
    expect(workflow).toContain('--platform linux/amd64,linux/arm64');
  });
  it('the release job makes a draft, reads it back, and publishes only a real one', () => {
    const cli = read(GW, 'pipeline', 'cli.mjs');
    expect(cli).toContain("draft: true, prerelease: dryRun, make_latest: 'false'");
    expect(cli).toContain("{ draft: false, make_latest: 'true' }");
    expect(cli.indexOf("{ draft: false, make_latest: 'true' }")).toBeGreaterThan(cli.indexOf('const r = readBack('));
    expect(cli).toMatch(/if \(dryRun\) \{\n\s+notice\('Dry run'/);
  });
  it.runIf(process.platform === 'win32')('the MSI build packs the host -HostExe names as it is (build.ps1\'s own step, run by PowerShell on a scratch folder)', () => {
    const build = read(GW, 'windows', 'wix', 'build.ps1');
    const from = build.indexOf('# 1. The host');
    const to = build.indexOf('# 2. node.exe');
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'gw4-host-'));
    try {
      const prebuilt = path.join(dir, 'prebuilt.exe');
      fs.writeFileSync(prebuilt, 'the prebuilt, perhaps signed, host');
      const q = (p) => `'${p.replace(/'/g, "''")}'`;
      const script = [
        "$ErrorActionPreference = 'Stop'",
        `$HostExe = ${q(prebuilt)}`,
        `$stage = ${q(path.join(dir, 'stage'))}`,
        `$gateway = ${q(path.join(dir, 'no-gateway-here'))}`, // building the host from source would fail here
        build.slice(from, to),
      ].join('\n');
      const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', timeout: 60_000, windowsHide: true });
      expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
      expect(fs.readFileSync(path.join(dir, 'stage', 'host', 'WilsonGatewayHost.exe'), 'utf8')).toBe('the prebuilt, perhaps signed, host');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('the pipeline\'s scripts are not shipped: not in the image, not in the MSI', () => {
    expect(read(GW, '.dockerignore').split('\n').map((s) => s.trim())).toContain('pipeline');
    const build = read(GW, 'windows', 'wix', 'build.ps1');
    expect(build).toContain("Copy-Item -Recurse (Join-Path $gateway 'src') (Join-Path $app 'src')");
    expect(build).not.toMatch(/Join-Path \$gateway 'pipeline'/);
    // The folder is named pipeline, not release: WILSON/.gitignore ignores every release/ (Electron's output).
    expect(fs.existsSync(path.join(GW, 'pipeline', 'cli.mjs'))).toBe(true);
  });
});
