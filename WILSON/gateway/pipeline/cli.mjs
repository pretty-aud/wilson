#!/usr/bin/env node
// =============================================================================
// The release pipeline's steps (GW4), called by
// .github/workflows/gateway-release.yml. Each prints what it did as GitHub
// annotations (`::notice` / `::error`), which the public API serves, since a
// job's log needs an admin to read (GW2's trap 3).
//
//   plan                       the run's kind, version, tag and name ($GITHUB_OUTPUT)
//   stamp <version>            package.json and src/version.mjs in this checkout
//   check-artefact <tgz> <version> <node.exe>
//   manifest --version --tag --artefact --digest --out
//   sign --manifest --out [--dry-run]
//                              a real release signs with GATEWAY_RELEASE_SIGNING_KEY
//                              (never printed); a dry run makes a throwaway pair
//                              here and prints its PUBLIC half
//   container-digest <metadata.json> [<image.oci.tar>]
//   github-release --dir       a draft release with every asset, read back
//                              through the API and held to the manifest; a real
//                              release is published (and made latest) only then
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  planRelease, stampVersion, checkArtefact, floorsFor, makeManifest, privateKeyFromSecret, signManifest, readBack,
  artefactName, msiName, MANIFEST_NAME, SIGNATURE_NAME, RELEASE_REPOSITORY,
} from './lib.mjs';
import { compiledReleaseKeys, CONTAINER_IMAGE } from '../src/update/manifest.mjs';
import { signingKeyFromWire } from '../src/wire/formats.mjs';
import { readTar } from '../src/update/tar.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATEWAY = path.join(HERE, '..');
const [, , cmd, ...rest] = process.argv;
const flag = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
const has = (name) => rest.includes(`--${name}`);
// An annotation's text: one line, no workflow-command characters.
const clean = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const notice = (title, text) => process.stdout.write(`::notice title=${clean(title).replace(/[,:]/g, ' ')}::${clean(text)}\n`);
const fail = (text) => { process.stdout.write(`::error::${clean(text)}\n`); process.exit(1); };
const output = (k, v) => { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

async function main() {
  switch (cmd) {
    case 'plan': {
      const pkg = JSON.parse(fs.readFileSync(path.join(GATEWAY, 'package.json'), 'utf8'));
      const p = planRelease({
        event: process.env.GITHUB_EVENT_NAME,
        refType: process.env.GITHUB_REF_TYPE,
        refName: process.env.GITHUB_REF_NAME,
        dryRunInput: process.env.INPUT_DRY_RUN ?? '',
        runId: process.env.GITHUB_RUN_ID,
        packageVersion: pkg.version,
      });
      if (!p.ok) fail(p.error);
      for (const [k, v] of Object.entries({ dry_run: String(p.dryRun), version: p.version, tag: p.tag, release_name: p.releaseName })) output(k, v);
      notice('Release plan', p.dryRun
        ? `A DRY RUN of ${p.version}: a throwaway key, a DRAFT pre-release named ${p.releaseName}, nothing pushed to the registry.`
        : `The REAL release ${p.tag} (${p.version}): signed with the release key, the image pushed by digest, published as the latest release.`);
      return;
    }
    case 'stamp': {
      const version = rest[0];
      const pj = path.join(GATEWAY, 'package.json');
      const vm = path.join(GATEWAY, 'src', 'version.mjs');
      const s = stampVersion({ packageJsonText: fs.readFileSync(pj, 'utf8'), versionMjsText: fs.readFileSync(vm, 'utf8'), version });
      fs.writeFileSync(pj, s.packageJsonText);
      fs.writeFileSync(vm, s.versionMjsText);
      const { VERSION } = await import(`${new URL('../src/version.mjs', import.meta.url).href}?v=${Date.now()}`);
      if (VERSION !== version) fail(`stamp: version.mjs reads ${VERSION}`);
      notice('Version stamped', `${version} in gateway/package.json and gateway/src/version.mjs (this checkout only)`);
      return;
    }
    case 'check-artefact': {
      const [file, version, nodeExe] = rest;
      const bytes = fs.readFileSync(file);
      const r = checkArtefact(bytes, { version, nodeExeSha256: nodeExe ? sha(fs.readFileSync(nodeExe)) : null });
      if (!r.ok) fail(`The Windows artefact: ${r.problems.join('; ')}`);
      notice('Windows artefact', `${path.basename(file)}: ${bytes.length} bytes, sha256 ${sha(bytes)}, ${r.entries} entries read back by the gateway's own tar reader; node.exe and app/ as current\\ holds them`);
      return;
    }
    case 'manifest': {
      const version = flag('version');
      const artefact = fs.readFileSync(flag('artefact'));
      const floors = floorsFor(fs.readFileSync(path.join(HERE, 'floors.json'), 'utf8'), version);
      const bytes = makeManifest({
        version,
        tag: flag('tag'),
        publishedAt: new Date().toISOString(),
        artefact,
        containerDigest: flag('digest'),
        floors,
        notes: `WILSON file gateway ${version}.`,
      });
      fs.writeFileSync(flag('out'), bytes);
      notice('stable.json', `${bytes.length} bytes, sha256 ${sha(bytes)}; floors ${floors.minimum_version ?? 'none'} / ${floors.hard_minimum_version ?? 'none'}`);
      return;
    }
    case 'sign': {
      const dryRun = has('dry-run');
      const manifestBytes = fs.readFileSync(flag('manifest'));
      let key;
      if (dryRun) {
        key = crypto.generateKeyPairSync('ed25519').privateKey; // made here, used once, never kept
      } else {
        try { key = privateKeyFromSecret(process.env.GATEWAY_RELEASE_SIGNING_KEY); } catch (e) { fail(e.message); }
      }
      let s;
      try { s = signManifest(manifestBytes, key, { dryRun }); } catch (e) { fail(e.message); }
      fs.writeFileSync(flag('out'), s.signature);
      output('public_key', s.publicKeyWire);
      if (dryRun) notice('Dry-run release key (public half)', `${s.publicKeyWire} (a throwaway made in this job; no gateway trusts it)`);
      else notice('Signed', `stable.json signed with the release key ${s.kid} (in RELEASE_KEYS_WIRE); verified with the gateway's compiled-in keys for windows-x64 and container`);
      return;
    }
    case 'container-digest': {
      const [metaFile, ociTar] = rest;
      let digest = null;
      try { digest = JSON.parse(fs.readFileSync(metaFile, 'utf8'))['containerimage.digest'] ?? null; } catch { digest = null; }
      if (!/^sha256:[0-9a-f]{64}$/.test(String(digest)) && ociTar) {
        // The OCI layout's index.json names the image index (an OCI tar is a plain, uncompressed tar).
        const entries = readTar(fs.readFileSync(ociTar), { gzip: false }).filter((e) => e.type === 'file');
        const index = entries.find((e) => e.name === 'index.json');
        digest = index ? JSON.parse(index.data.toString('utf8')).manifests?.[0]?.digest ?? null : null;
      }
      if (!/^sha256:[0-9a-f]{64}$/.test(String(digest))) fail('the image\'s digest could not be read from the build');
      output('digest', digest);
      notice('Container image', `${CONTAINER_IMAGE}@${digest}`);
      return;
    }
    case 'github-release': return githubRelease(flag('dir'));
    default:
      process.stderr.write('pipeline/cli.mjs plan | stamp <v> | check-artefact <tgz> <v> <node.exe> | manifest … | sign … | container-digest … | github-release --dir <d>\n');
      process.exit(2);
  }
}

// ── GitHub's REST API, with the workflow's own token ──────────────────────────
async function api(method, url, { body, contentType = 'application/json', accept = 'application/vnd.github+json', raw = false } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      accept,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'wilson-gateway-release',
      ...(body !== undefined ? { 'content-type': contentType } : {}),
    },
    body: body === undefined ? undefined : (Buffer.isBuffer(body) ? body : JSON.stringify(body)),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`${method} ${url.replace(/\?.*/, '')}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return raw ? Buffer.from(await res.arrayBuffer()) : (res.status === 204 ? null : res.json());
}

/**
 * An asset's bytes through the API: the API answers with a redirect to GitHub's
 * asset store, which is followed WITHOUT the token (the store's URL is signed;
 * the token never leaves api.github.com).
 */
async function downloadAsset(url) {
  const first = await fetch(url, { headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/octet-stream', 'user-agent': 'wilson-gateway-release', 'x-github-api-version': '2022-11-28' }, redirect: 'manual' });
  if (first.status === 200) return Buffer.from(await first.arrayBuffer());
  const to = first.headers.get('location');
  if (![301, 302, 303, 307, 308].includes(first.status) || !to) throw new Error(`GET ${url}: ${first.status}`);
  const res = await fetch(to, { headers: { accept: 'application/octet-stream', 'user-agent': 'wilson-gateway-release' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`GET ${new URL(to).hostname}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function githubRelease(dir) {
  const env = process.env;
  const repo = env.GITHUB_REPOSITORY;
  if (repo !== RELEASE_REPOSITORY) fail(`this workflow releases ${RELEASE_REPOSITORY} only (running in ${repo})`);
  const API = env.GITHUB_API_URL || 'https://api.github.com';
  const dryRun = env.DRY_RUN === 'true';
  const version = env.VERSION;
  const tag = env.TAG;
  const names = [msiName(version), artefactName(version), MANIFEST_NAME, SIGNATURE_NAME];
  const files = new Map(names.map((n) => [n, fs.readFileSync(path.join(dir, n))]));
  const sums = names.map((n) => `${sha(files.get(n))}  ${n}`).join('\n') + '\n';
  files.set('SHA256SUMS', Buffer.from(sums));
  const digest = JSON.parse(files.get(MANIFEST_NAME).toString('utf8')).artefacts.container.digest;
  const body = [
    dryRun ? `**A dry run of the release pipeline (run ${env.GITHUB_RUN_ID}): a DRAFT, signed with a throwaway key no gateway trusts. Delete it when you have looked.**` : `WILSON file gateway ${version}.`,
    '',
    `- **Windows**: \`${msiName(version)}\` (not signed yet: Windows SmartScreen warns; **More info → Run anyway** gets past it, and a signed build will stop the warning later). An installed gateway updates itself from \`${artefactName(version)}\`.`,
    `- **NAS (a container)**: \`${CONTAINER_IMAGE}@${digest}\`${dryRun ? ' (a dry run pushes no image; this is the digest of the image it built)' : ''}.`,
    `- **The signed version list**: \`${MANIFEST_NAME}\` and \`${SIGNATURE_NAME}\` (Ed25519); \`SHA256SUMS\` lists every file.`,
    '',
    `Built from ${env.GITHUB_SHA} by ${env.GITHUB_WORKFLOW} run ${env.GITHUB_RUN_ID}.`,
  ].join('\n');

  // A real tag released before is never replaced from here.
  if (!dryRun) {
    const existing = await fetch(`${API}/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, { headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'wilson-gateway-release' } });
    if (existing.status === 200) fail(`${tag} is released already; a release is never replaced. Tag the next version.`);
    if (existing.status !== 404) fail(`could not tell whether ${tag} is released already (GitHub answered ${existing.status}); nothing was made. Run the job again.`);
  }
  const rel = await api('POST', `${API}/repos/${repo}/releases`, {
    body: { tag_name: tag, target_commitish: env.GITHUB_SHA, name: env.RELEASE_NAME, body, draft: true, prerelease: dryRun, make_latest: 'false' },
  });
  notice('Release created (draft)', `${rel.name}: id ${rel.id}`);
  for (const [name, bytes] of files) {
    await api('POST', `${rel.upload_url.replace(/\{.*$/, '')}?name=${encodeURIComponent(name)}`, { body: bytes, contentType: 'application/octet-stream' });
  }

  // Read back through the API: the assets as GitHub serves them.
  const listed = await api('GET', `${API}/repos/${repo}/releases/${rel.id}/assets?per_page=100`);
  const served = new Map();
  for (const a of listed) served.set(a.name, await downloadAsset(`${API}/repos/${repo}/releases/assets/${a.id}`));
  for (const n of files.keys()) if (!served.has(n)) fail(`read back: ${n} is not among the release's assets`);
  const keys = dryRun ? [signingKeyFromWire({ kid: 'dryrun', public_key: env.PUBLIC_KEY })?.key].filter(Boolean) : compiledReleaseKeys();
  if (!keys.length) fail('read back: no key to verify the signature with');
  const r = readBack({ assets: served, version, tag, keys });
  for (const s of r.sums) notice(`Asset ${s.name}`, `${s.size} bytes, sha256 ${s.sha256}`);
  notice('stable.json as served (base64)', served.get(MANIFEST_NAME).toString('base64'));
  notice('stable.json.sig as served', served.get(SIGNATURE_NAME).toString('utf8'));
  if (!r.ok) fail(`read back: ${r.problems.join('; ')}`);
  notice('Read back', `${listed.length} assets; the artefact's size and SHA-256 are the manifest's; the signature over the served stable.json verifies with ${dryRun ? `the dry run's throwaway key ${env.PUBLIC_KEY}` : 'the compiled-in release key'}`);

  if (dryRun) {
    notice('Dry run', `left as a DRAFT pre-release: ${rel.html_url} (delete it when you have looked; nothing was published and no image was pushed)`);
    return;
  }
  const pub = await api('PATCH', `${API}/repos/${repo}/releases/${rel.id}`, { body: { draft: false, make_latest: 'true' } });
  notice('Published', `${pub.html_url}: the latest release; gateways take it within a day`);
}

main().catch((e) => fail(String(e?.message || e).slice(0, 500)));
