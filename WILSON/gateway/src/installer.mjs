// =============================================================================
// The MSI's two helpers, run by its deferred custom actions as SYSTEM with the
// node.exe it has just installed (windows/wix/Package.wxs):
//
//   enrol-file <stateDir> <token> <cloudUrl>
//       writes enrol.json (mode 600) for the service to pick up when it
//       starts: the SERVICE enrols itself, so the credential is protected
//       under its own identity (NT SERVICE\WilsonGateway), never SYSTEM's
//       or the installing administrator's. The token is spent by the cloud
//       either way.
//   fresh-pipe-key <stateDir>
//       writes a new pipe.key (32 random bytes) after the state folder's owner
//       and ACL are reset and before the services start, so a pipe.key a
//       local user planted in the folder before the ACL step (ProgramData
//       lets any user create files there) is replaced, never used (review
//       round 1, finding 5). Unlike the other two, a failure fails the
//       install.
//   summary <stateDir> <outFile>
//       waits up to 60 s for the enrolment's result and the gateway's status,
//       then writes what the installer shows at the end: the addresses the
//       office door uses, the certificate's fingerprint, the health line and
//       what to do next.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { FILES } from './platform/state.mjs';
import { displayFingerprint } from './certs/x509.mjs';
import { isEnrolToken } from './wire/formats.mjs';
import { normalizeCloudUrl } from './cloud/client.mjs';

const [, , cmd, ...args] = process.argv;
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function enrolFile(stateDir, token, cloud) {
  const t = String(token || '').trim();
  if (!isEnrolToken(t)) return { ok: false, error: 'not an enrolment token' };
  const url = normalizeCloudUrl(cloud) || null;
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, FILES.enrol), JSON.stringify({ token: t, cloud: url }), { mode: 0o600 });
  return { ok: true };
}

export function freshPipeKey(stateDir) {
  const file = path.join(stateDir, FILES.pipeKey);
  fs.rmSync(file, { force: true });
  fs.writeFileSync(file, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' });
  return file;
}

export function summaryText({ status, result, waitedS }) {
  const lines = ['WILSON Gateway is installed.', ''];
  if (result && !result.ok) lines.push(`The enrolment did not work: ${result.error}`, 'Make a new token in WILSON (Settings, Storage, File gateway) and run, in an administrator prompt:', '  wilson-gateway enrol <token>', '');
  const fp = result?.fingerprint_display || (status?.fingerprint ? displayFingerprint(status.fingerprint) : null);
  if (fp) lines.push('The gateway’s certificate fingerprint (SHA-256):', `  ${fp}`, 'Type or paste it in WILSON beside the new gateway: that proves it is the one you installed and unlocks Download certificate.', '');
  const open = status?.doors?.inside?.open || [];
  const chosen = status?.doors?.inside?.chosen || [];
  if (open.length) lines.push('The office door is open on:', ...open.map((a) => `  ${a.address.includes(':') ? `[${a.address}]` : a.address}:${a.port}`), '');
  else if (chosen.length) lines.push('The office door will use:', ...chosen.map((a) => `  ${a.address} (${a.iface})`), '');
  else lines.push('No office network address was found on this PC: the office door stays closed until it has one (a VPN or virtual adapter does not count).', '');
  for (const r of status?.doors?.inside?.refused || []) lines.push(`  not used: ${r.address} on ${r.iface} (${r.reason})`);
  if (status?.health_line) lines.push('', 'Now:', `  ${status.health_line.replace(/\*\*/g, '')}`);
  if (!status) lines.push(`The gateway had not reported within ${waitedS} s. Run \`wilson-gateway doctor\` in an administrator prompt in a minute.`);
  lines.push('', 'Next: give it the share’s login (an administrator prompt): wilson-gateway share-login \\\\server\\share', 'Windows SmartScreen warned about this installer because it is not signed yet; that is expected for this test build.');
  return lines.join('\r\n') + '\r\n';
}

async function main() {
  if (cmd === 'enrol-file') {
    const [stateDir, token, cloud] = args;
    const r = enrolFile(stateDir, token, cloud);
    if (!r.ok) { process.stderr.write(`enrol-file: ${r.error}\n`); process.exit(0); } // never fail the install: the summary says it
    return;
  }
  if (cmd === 'fresh-pipe-key') {
    try { freshPipeKey(args[0]); } catch (e) { process.stderr.write(`fresh-pipe-key: ${e.message}\n`); process.exit(1); }
    return;
  }
  if (cmd === 'summary') {
    const [stateDir, outFile] = args;
    const started = Date.now();
    let result = null;
    let status = null;
    while (Date.now() - started < 60_000) {
      result = readJson(path.join(stateDir, FILES.enrolResult));
      status = readJson(path.join(stateDir, FILES.status));
      const enrolPending = fs.existsSync(path.join(stateDir, FILES.enrol));
      if (status && !enrolPending && (result || status.enrolled)) break;
      await sleep(1000);
    }
    fs.writeFileSync(outFile, summaryText({ status, result, waitedS: Math.round((Date.now() - started) / 1000) }));
    return;
  }
  process.stderr.write('installer.mjs enrol-file <stateDir> <token> <cloud> | fresh-pipe-key <stateDir> | summary <stateDir> <outFile>\n');
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('src', 'installer.mjs'))) main().catch(() => process.exit(0));
