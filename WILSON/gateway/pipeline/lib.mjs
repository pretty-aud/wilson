// =============================================================================
// The release pipeline's own rules (GW4; .github/workflows/gateway-release.yml).
// Run by the workflow's jobs, never by an installed gateway: nothing here is
// copied into the MSI, the Windows artefact or the image (build.ps1 and the
// Dockerfile copy package.json, src and updater only).
//
//   planRelease     what a run is, from its trigger: a REAL release only for a
//                   tag gateway-vX.Y.Z (pushed, or a run started by hand ON
//                   that tag with dry_run off); anything else is a dry run
//   stampVersion    the version written into the staged package.json and
//                   src/version.mjs (the updater's healthy check reads it)
//   checkArtefact   the Windows artefact read back with the gateway's own tar
//                   reader: node.exe and app\ exactly as current\ holds them
//   makeManifest    stable.json from the build's facts, its floors checked
//   signManifest    the exact bytes signed; the signature verified the way a
//                   gateway verifies it, with the gateway's own code
//   readBack        the release's assets as GitHub serves them, held to the
//                   manifest: sizes, SHA-256, the signature
// =============================================================================

import crypto from 'node:crypto';
import { readTar } from '../src/update/tar.mjs';
import {
  verifyManifest, parseVersion, compareVersions, compiledReleaseKeys, RELEASE_KEYS_WIRE, RELEASE_REPOSITORY,
  ARTEFACT_URL_PREFIX, CONTAINER_IMAGE, artefactUrlOk,
} from '../src/update/manifest.mjs';
import { publicKeyToWire } from '../src/wire/formats.mjs';

export const TAG_RE = /^gateway-v(\d{1,6})\.(\d{1,6})\.(\d{1,6})(-dryrun)?$/;
export const artefactName = (version) => `wilson-gateway-${version}-windows-x64.tar.gz`;
export const msiName = (version) => `WILSON-Gateway-Setup-${version}.msi`;
export const MANIFEST_NAME = 'stable.json';
export const SIGNATURE_NAME = 'stable.json.sig';

/**
 * @param o { event: 'push'|'workflow_dispatch', refType: 'tag'|'branch', refName, dryRunInput: 'true'|'false'|'', runId, packageVersion }
 * @returns {{ ok: true, dryRun: boolean, version: string, tag: string, releaseName: string } | { ok: false, error: string }}
 */
export function planRelease({ event, refType, refName, dryRunInput, runId, packageVersion }) {
  const runTag = `gateway-dry-run-${runId}`;
  if (refType === 'tag') {
    const m = TAG_RE.exec(String(refName || ''));
    if (!m) return { ok: false, error: `The tag ${refName} is not gateway-vX.Y.Z (or gateway-vX.Y.Z-dryrun for a dry run).` };
    const version = `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}`;
    if (version !== `${m[1]}.${m[2]}.${m[3]}`) return { ok: false, error: `The tag ${refName} has a leading zero; a version is written 1.2.3.` };
    const real = !m[4] && (event === 'push' || (event === 'workflow_dispatch' && dryRunInput === 'false'));
    return real
      ? { ok: true, dryRun: false, version, tag: refName, releaseName: `WILSON file gateway ${version}` }
      : { ok: true, dryRun: true, version, tag: runTag, releaseName: runTag };
  }
  if (event === 'workflow_dispatch' && dryRunInput === 'false') {
    return { ok: false, error: 'A real release is made from its tag: push gateway-vX.Y.Z (walkthrough 63), or start the workflow by hand ON that tag. A run started by hand on a branch is always a dry run.' };
  }
  if (!parseVersion(packageVersion)) return { ok: false, error: `gateway/package.json's version (${packageVersion}) is not X.Y.Z.` };
  return { ok: true, dryRun: true, version: packageVersion, tag: runTag, releaseName: runTag };
}

/** The staged package.json and version.mjs, rewritten to `version` (both, or neither). */
export function stampVersion({ packageJsonText, versionMjsText, version }) {
  if (!parseVersion(version)) throw new Error(`stamp: ${version} is not X.Y.Z`);
  const pkg = JSON.parse(packageJsonText);
  pkg.version = version;
  const re = /^export const VERSION = '(\d+\.\d+\.\d+)';$/m;
  if (!re.test(versionMjsText)) throw new Error('stamp: src/version.mjs has no `export const VERSION = \'X.Y.Z\';` line');
  return { packageJsonText: `${JSON.stringify(pkg, null, 2)}\n`, versionMjsText: versionMjsText.replace(re, `export const VERSION = '${version}';`) };
}

/**
 * The Windows artefact, read with the gateway's own tar reader: exactly
 * node.exe and app\ (package.json, src\, updater\), the version stamped in
 * both places, node.exe the pinned one, no test or Windows build file.
 */
export function checkArtefact(bytes, { version, nodeExeSha256 = null }) {
  const entries = readTar(bytes);
  const problems = [];
  const files = new Map(entries.filter((e) => e.type === 'file').map((e) => [e.name, e.data]));
  const tops = new Set(entries.map((e) => e.name.split('/')[0]));
  for (const t of tops) if (t !== 'node.exe' && t !== 'app') problems.push(`an entry outside node.exe and app/: ${t}`);
  for (const n of files.keys()) {
    if (n === 'node.exe') continue;
    if (!/^app\/(package\.json|src\/.+\.mjs|updater\/.+\.mjs)$/.test(n)) problems.push(`a file the app does not ship: ${n}`);
  }
  for (const need of ['node.exe', 'app/package.json', 'app/src/cli.mjs', 'app/src/runtime.mjs', 'app/src/version.mjs', 'app/updater/updater.mjs']) {
    if (!files.has(need)) problems.push(`missing ${need}`);
  }
  try { if (JSON.parse(files.get('app/package.json')?.toString('utf8') ?? '{}').version !== version) problems.push(`app/package.json is not version ${version}`); } catch { problems.push('app/package.json is not JSON'); }
  if (!(files.get('app/src/version.mjs')?.toString('utf8') ?? '').includes(`export const VERSION = '${version}';`)) problems.push(`app/src/version.mjs is not version ${version}`);
  if (nodeExeSha256 && files.has('node.exe') && crypto.createHash('sha256').update(files.get('node.exe')).digest('hex') !== nodeExeSha256) problems.push('node.exe is not the pinned build\'s');
  return { ok: problems.length === 0, problems, entries: entries.length, files: files.size };
}

/** The floors file, read and held below the release itself. */
export function floorsFor(floorsText, version) {
  const f = JSON.parse(floorsText);
  const out = {};
  for (const k of ['minimum_version', 'hard_minimum_version']) {
    const v = f[k] ?? null;
    if (v !== null && !parseVersion(v)) throw new Error(`floors.json: ${k} (${v}) is not X.Y.Z or null`);
    if (v !== null && compareVersions(v, version) > 0) throw new Error(`floors.json: ${k} ${v} is above this release (${version}): every gateway, this release's included, would close its outside door`);
    out[k] = v;
  }
  if (out.minimum_version && out.hard_minimum_version && compareVersions(out.hard_minimum_version, out.minimum_version) > 0) throw new Error('floors.json: the hard minimum is above the minimum');
  return out;
}

/**
 * stable.json's exact bytes, from the build's facts. Besides what a gateway
 * reads (the artefact for its platform), it names the MSI an administrator
 * installs (`installer`), so the one file a person runs is in the signed
 * record too (review round 1, finding 3); gateways ignore the field.
 */
export function makeManifest({ version, tag, publishedAt, artefact, installer, containerDigest, floors, notes }) {
  const url = `${ARTEFACT_URL_PREFIX}${tag}/${artefactName(version)}`;
  if (!artefactUrlOk(url)) throw new Error(`manifest: ${url} is not a release asset URL a gateway accepts`);
  const installerUrl = `${ARTEFACT_URL_PREFIX}${tag}/${msiName(version)}`;
  if (!artefactUrlOk(installerUrl)) throw new Error(`manifest: ${installerUrl} is not a release asset URL`);
  if (!Buffer.isBuffer(installer) || installer.length === 0) throw new Error('manifest: the installer (the MSI) is missing');
  if (!/^sha256:[0-9a-f]{64}$/.test(String(containerDigest))) throw new Error('manifest: the container digest is not sha256:<64 hex>');
  const m = {
    version,
    published_at: publishedAt,
    minimum_version: floors.minimum_version ?? null,
    hard_minimum_version: floors.hard_minimum_version ?? null,
    artefacts: {
      'windows-x64': { url, sha256: crypto.createHash('sha256').update(artefact).digest('hex'), size: artefact.length },
      container: { image: CONTAINER_IMAGE, digest: containerDigest },
    },
    installer: { url: installerUrl, sha256: crypto.createHash('sha256').update(installer).digest('hex'), size: installer.length },
    notes: String(notes || '').slice(0, 2000),
  };
  return Buffer.from(`${JSON.stringify(m, null, 2)}\n`, 'utf8');
}

/** The private half from the secret's ONE line (standard base64 of PKCS#8 DER). Never logged. */
export function privateKeyFromSecret(line) {
  const t = String(line ?? '').trim();
  if (!/^[A-Za-z0-9+/]{43,100}={0,2}$/.test(t)) throw new Error('the signing secret is not one line of base64 (see walkthrough 63, step 1)');
  let key;
  try { key = crypto.createPrivateKey({ key: Buffer.from(t, 'base64'), format: 'der', type: 'pkcs8' }); } catch { throw new Error('the signing secret is not an Ed25519 private key (PKCS#8)'); }
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('the signing secret is not an Ed25519 key');
  return key;
}

/**
 * Signs the manifest's exact bytes. A REAL release refuses a key whose public
 * half is not in RELEASE_KEYS_WIRE (a gateway would refuse its manifests); the
 * signature is then verified with the gateway's own compiled-in keys, as a
 * gateway at version 0.0.0 would, for both platforms.
 */
export function signManifest(manifestBytes, privateKey, { dryRun }) {
  const publicKey = crypto.createPublicKey(privateKey);
  const wire = publicKeyToWire(publicKey);
  const slot = RELEASE_KEYS_WIRE.findIndex((k) => k.public_key === wire);
  if (!dryRun && slot < 0) throw new Error('the signing secret\'s public half is in no release key slot: gateways would refuse this release');
  const signature = crypto.sign(null, manifestBytes, privateKey).toString('base64');
  const keys = dryRun ? [publicKey] : compiledReleaseKeys();
  for (const platformKey of ['windows-x64', 'container']) {
    const v = verifyManifest({ manifestBytes, signatureText: signature, keys, runningVersion: '0.0.0', platformKey });
    if (!v.ok) throw new Error(`the signed manifest does not verify for ${platformKey} (${v.reason})`);
  }
  return { signature, publicKeyWire: wire, kid: slot >= 0 ? RELEASE_KEYS_WIRE[slot].kid : null };
}

/**
 * The release as GitHub serves it, held to its manifest: the update artefact
 * and the MSI each this release's own asset, of the size and SHA-256 the
 * manifest names; the signature over the served stable.json verified with
 * `keys`. (`sums` lists every asset's size and SHA-256 for the job's notices.)
 *
 * @param o { assets: Map<name, Buffer>, version, tag, keys: KeyObject[] }
 */
export function readBack({ assets, version, tag, keys }) {
  const problems = [];
  const manifestBytes = assets.get(MANIFEST_NAME);
  const signature = assets.get(SIGNATURE_NAME)?.toString('utf8') ?? '';
  if (!manifestBytes) return { ok: false, problems: ['stable.json is not an asset'] };
  let verdict = null;
  for (const platformKey of ['windows-x64', 'container']) {
    const v = verifyManifest({ manifestBytes, signatureText: signature, keys, runningVersion: '0.0.0', platformKey });
    if (!v.ok) problems.push(`the signature or shape does not hold for ${platformKey} (${v.reason})`);
    else verdict = v;
  }
  const m = verdict?.manifest ?? JSON.parse(manifestBytes.toString('utf8'));
  if (m.version !== version) problems.push(`stable.json says ${m.version}, the release is ${version}`);
  const win = m.artefacts?.['windows-x64'];
  // Gateways download what the manifest names: it must be THIS release's artefact.
  if (win?.url !== `${ARTEFACT_URL_PREFIX}${tag}/${artefactName(version)}`) problems.push(`the manifest's artefact URL is not this release's ${artefactName(version)}`);
  const art = assets.get(artefactName(version));
  if (!art) problems.push(`${artefactName(version)} is not an asset`);
  else {
    if (art.length !== win?.size) problems.push(`the artefact is ${art.length} bytes, the manifest says ${win?.size}`);
    if (crypto.createHash('sha256').update(art).digest('hex') !== win?.sha256) problems.push('the artefact\'s SHA-256 is not the manifest\'s');
  }
  const msi = assets.get(msiName(version));
  if (!msi) problems.push(`${msiName(version)} is not an asset`);
  else {
    // The MSI is held to the signed version list, not only found (review round 1, finding 3).
    const inst = m.installer;
    if (inst?.url !== `${ARTEFACT_URL_PREFIX}${tag}/${msiName(version)}`) problems.push(`the manifest's installer URL is not this release's ${msiName(version)}`);
    if (msi.length !== inst?.size) problems.push(`the installer is ${msi.length} bytes, the manifest says ${inst?.size}`);
    if (crypto.createHash('sha256').update(msi).digest('hex') !== inst?.sha256) problems.push('the installer\'s SHA-256 is not the manifest\'s');
  }
  const sums = [...assets.entries()].filter(([n]) => n !== 'SHA256SUMS').map(([n, b]) => ({ name: n, size: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex') }));
  return { ok: problems.length === 0, problems, sums, manifest: m };
}

export { RELEASE_REPOSITORY };
