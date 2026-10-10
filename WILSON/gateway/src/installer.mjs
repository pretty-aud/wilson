// =============================================================================
// The MSI's helpers, run by its deferred custom actions as SYSTEM with the
// node.exe it has just installed (windows/wix/Package.wxs):
//
//   check-state <stateDir>
//       before the install's owner reset and ACL, which are recursive (icacls
//       /T): the state folder must be a real folder, not a link, hold no link,
//       and hold nothing made by an account other than SYSTEM, Administrators,
//       TrustedInstaller or the gateway's own service. ProgramData lets any
//       user create a folder there, and before a first install a local user
//       could have made "WILSON Gateway" a junction into a tree of their
//       choosing, which /T would follow as SYSTEM (review round 2, R2-1), or
//       put a config.json in it, which the service would honour (R2-2). The
//       folder's own ACL is set first (not recursive), so nothing can be
//       added between the check and the reset. A failure fails the install,
//       and the MSI log names what was found.
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
import { spawnSync, execFileSync } from 'node:child_process';
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

/** A service's SID, as Windows derives it: S-1-5-80- and SHA-1 of its upper-case name (UTF-16LE). */
export function serviceSid(name) {
  const h = crypto.createHash('sha1').update(Buffer.from(String(name).toUpperCase(), 'utf16le')).digest();
  const parts = [];
  for (let i = 0; i < 20; i += 4) parts.push(h.readUInt32LE(i));
  return `S-1-5-80-${parts.join('-')}`;
}

// The owners the state folder may hold: SYSTEM, Administrators,
// TrustedInstaller, and NT SERVICE\WilsonGateway.
export const TRUSTED_OWNERS = Object.freeze(['S-1-5-18', 'S-1-5-32-544', serviceSid('TrustedInstaller'), serviceSid('WilsonGateway')]);

// Paths in as base64 of their UTF-8 (any name survives the console's code
// page), owner SIDs out, one line each; an unreadable owner is UNREADABLE,
// which no trusted list holds.
const OWNERS_PS = [
  "$ErrorActionPreference = 'Stop'",
  'while (($line = [Console]::In.ReadLine()) -ne $null) {',
  '  if ($line.Trim() -eq "") { continue }',
  '  $p = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line.Trim()))',
  '  try { [Console]::Out.WriteLine((Get-Acl -LiteralPath $p).GetOwner([System.Security.Principal.SecurityIdentifier]).Value) } catch { [Console]::Out.WriteLine("UNREADABLE") }',
  '}',
].join('\n');

/** Windows: each path's owner SID, by one PowerShell 5.1 child. */
export function ownersOfWindows(paths, { spawn = spawnSync } = {}) {
  if (!paths.length) return [];
  const r = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', OWNERS_PS], { input: paths.map((p) => Buffer.from(p, 'utf8').toString('base64')).join('\n') + '\n', encoding: 'utf8', windowsHide: true, timeout: 120_000 });
  const lines = String(r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (r.status !== 0 || lines.length !== paths.length) throw new Error(`the owners could not be read (${r.status}): ${String(r.stderr || '').split('\n')[0].slice(0, 200)}`);
  return lines;
}

/** Windows: the folder's own ACL, not recursive: SYSTEM, Administrators, the service. */
export function lockFolderWindows(dir, { exec = execFileSync } = {}) {
  const icacls = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'icacls.exe');
  exec(icacls, [dir, '/inheritance:r', '/grant:r', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', 'NT SERVICE\\WilsonGateway:(OI)(CI)M', '/C', '/Q'], { stdio: 'pipe', windowsHide: true });
}

/**
 * check-state's rule (see the head of this file). `ownersOf(paths)` answers
 * each path's owner SID in order; `lockFolder(dir)` sets the folder's own
 * ACL. Answers { ok: true, checked } or { ok: false, error }.
 */
export function checkState(stateDir, { ownersOf, lockFolder, lstat = fs.lstatSync, readdir = fs.readdirSync, trusted = TRUSTED_OWNERS }) {
  const dir = path.resolve(stateDir);
  const refuse = (error) => ({ ok: false, error: `${error}. The install stops so that nothing in the folder is trusted: remove it (after looking at what it holds), then run the installer again.` });
  let st;
  try { st = lstat(dir); } catch (e) { return refuse(`${dir} cannot be read (${e.code || e.message})`); }
  if (st.isSymbolicLink()) return refuse(`${dir} is a link (a junction or a symbolic link), not a folder`);
  if (!st.isDirectory()) return refuse(`${dir} is not a folder`);
  const [owner] = ownersOf([dir]);
  if (!trusted.includes(owner)) return refuse(`${dir} was made by another account (${owner})`);
  lockFolder(dir);
  const all = [];
  const walk = (d) => {
    for (const name of readdir(d)) {
      const p = path.join(d, name);
      const s = lstat(p);
      if (s.isSymbolicLink()) return p;
      all.push(p);
      if (s.isDirectory()) { const found = walk(p); if (found) return found; }
    }
    return null;
  };
  const link = walk(dir);
  if (link) return refuse(`${link} is a link (a junction or a symbolic link)`);
  const owners = ownersOf(all);
  const foreign = all.map((p, i) => [p, owners[i]]).filter(([, o]) => !trusted.includes(o));
  if (foreign.length) return refuse(`${foreign.length} item(s) in ${dir} were made by another account: ${foreign.slice(0, 5).map(([p, o]) => `${path.relative(dir, p)} (${o})`).join(', ')}`);
  return { ok: true, checked: all.length };
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
  if (cmd === 'check-state') {
    let r;
    try { r = checkState(args[0], { ownersOf: ownersOfWindows, lockFolder: lockFolderWindows }); } catch (e) { r = { ok: false, error: `check-state: ${e.message}` }; }
    if (!r.ok) { process.stderr.write(`check-state: ${r.error}\n`); process.exit(1); }
    process.stdout.write(`check-state: ${r.checked} item(s), every one SYSTEM's, Administrators', TrustedInstaller's or the gateway's\n`);
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
  process.stderr.write('installer.mjs check-state <stateDir> | enrol-file <stateDir> <token> <cloud> | fresh-pipe-key <stateDir> | summary <stateDir> <outFile>\n');
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('src', 'installer.mjs'))) main().catch(() => process.exit(0));
