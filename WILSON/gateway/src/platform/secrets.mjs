// =============================================================================
// The gateway's secrets at rest: the credential, the root's and the leaf's
// private keys, the free certificate's keys, the share logins (design §2
// step 4, §3, §5; review round 2, R8, R14; P8, TPN-ENC-014).
//
// Windows: DPAPI (CurrentUser scope, which under the service is the virtual
// account NT SERVICE\WilsonGateway: Windows manages its key, no password, so
// no installer can rotate it and strand the secrets; R8). Node has no DPAPI
// binding, and the brief's picks were, in order: a prebuilt N-API addon kept
// in the repo and built in CI; [System.Security.Cryptography.ProtectedData]
// through a PowerShell 5.1 child with the bytes on stdin; an ACL-protected
// file. GW2 chose the second, measured on this computer: ~250 ms a call (one
// call protects or unprotects every secret at once, so a start pays it once),
// a tampered blob refused ("The data is invalid"), nothing native to build,
// sign or keep in a public repository.
//
// P8 (TPN-ENC-014): NO PLAINTEXT IS EVER WRITTEN. Until P8, a DPAPI failure
// (PowerShell in Constrained Language mode) turned every later write into a
// plain file for the rest of the process, with an amber line; and the
// container wrote plain files always (mode 600 on the NAS's volume), so a
// backup or a copy of /data carried the office root's key and the
// credential. Now:
//   * Windows: when DPAPI refuses, the WRITE is refused (SecretsWriteRefused;
//     the caller keeps what it had and says so), and the health line is RED.
//   * The container: secrets are SEALED (AES-256-GCM, marker WGSEALD1) under
//     a key the operator provides — WILSON_GATEWAY_SECRETS_KEY (32 random
//     bytes, base64) or WILSON_GATEWAY_SECRETS_KEY_FILE (a Docker secret's
//     path; /run/secrets/wilson_gateway_secrets_key when it exists). Without
//     one, every write is refused and the line is red. What the key does and
//     does not protect is HARDENING.md §3 and §10: the owner of /data still
//     reads the sealed files; the key lives elsewhere (the compose file's
//     secret, the container's environment), which that NAS's administrator
//     can read too — it protects the folder from a backup or a copy, not
//     from them.
//   * WGPLAIN1 (an earlier version's files) stays READABLE, counted
//     (`unsealed`, amber), and `reseal(blob)` returns the sealed form so each
//     store writes it back on load, once secrets can be written.
//
// Every blob carries an 8-byte marker, so a file says how it was written.
// =============================================================================

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';

const DPAPI = Buffer.from('WGDPAPI1');
const PLAIN = Buffer.from('WGPLAIN1');
const SEALED = Buffer.from('WGSEALD1');
const IV_BYTES = 12;
const TAG_BYTES = 16;
export const SECRETS_KEY_ENV = 'WILSON_GATEWAY_SECRETS_KEY';
export const SECRETS_KEY_FILE_ENV = 'WILSON_GATEWAY_SECRETS_KEY_FILE';
export const SECRETS_KEY_DEFAULT_FILE = '/run/secrets/wilson_gateway_secrets_key';
const KEY_SENTENCE = `set ${SECRETS_KEY_ENV} (32 random bytes, base64: openssl rand -base64 32) or ${SECRETS_KEY_FILE_ENV} (a Docker secret's path) for this container`;

/** A write the secrets layer refused: the caller keeps what it had and the health line says why (red). */
export class SecretsWriteRefused extends Error {
  constructor(reason) {
    super(`secrets cannot be written: ${reason}`);
    this.name = 'SecretsWriteRefused';
    this.reason = reason;
  }
}

// Reads base64 lines on stdin, writes base64 lines on stdout, one per input, in order.
const PS_SCRIPT = (op) => [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Security',
  '$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser',
  '$out = New-Object System.Collections.Generic.List[string]',
  'while (($line = [Console]::In.ReadLine()) -ne $null) {',
  '  if ($line.Trim() -eq "") { continue }',
  '  $b = [Convert]::FromBase64String($line.Trim())',
  op === 'protect'
    ? '  $r = [System.Security.Cryptography.ProtectedData]::Protect($b, $null, $scope)'
    : '  $r = [System.Security.Cryptography.ProtectedData]::Unprotect($b, $null, $scope)',
  '  $out.Add([Convert]::ToBase64String($r))',
  '}',
  '[Console]::Out.Write(($out -join "`n"))',
].join('\n');

export function runPowerShell(op, blobs, { spawnImpl = spawn, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_SCRIPT(op)], { windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('DPAPI helper timed out')); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error(String(err).split('\n')[0].slice(0, 200) || `exit ${code}`)); return; }
      const lines = out.split('\n').map((s) => s.trim()).filter(Boolean);
      if (lines.length !== blobs.length) { reject(new Error('DPAPI helper answered the wrong count')); return; }
      resolve(lines.map((l) => Buffer.from(l, 'base64')));
    });
    child.stdin.end(blobs.map((b) => Buffer.from(b).toString('base64')).join('\n') + '\n');
  });
}

/**
 * The container's sealing key: the variable, else the file the variable
 * names, else the Docker secret's default path when it exists. 32 bytes,
 * base64. `{ key }` or `{ reason }`, never both.
 */
export function loadSealKey({ env = process.env, readFileSync = fs.readFileSync } = {}) {
  let text = typeof env[SECRETS_KEY_ENV] === 'string' ? env[SECRETS_KEY_ENV] : '';
  let from = SECRETS_KEY_ENV;
  if (!text.trim()) {
    const file = typeof env[SECRETS_KEY_FILE_ENV] === 'string' && env[SECRETS_KEY_FILE_ENV].trim() ? env[SECRETS_KEY_FILE_ENV].trim() : null;
    const candidates = file ? [file] : [SECRETS_KEY_DEFAULT_FILE];
    for (const f of candidates) {
      try { text = String(readFileSync(f, 'utf8')); from = file ? SECRETS_KEY_FILE_ENV : SECRETS_KEY_DEFAULT_FILE; break; } catch { /* not there */ }
    }
  }
  if (!text.trim()) return { key: null, reason: KEY_SENTENCE };
  let bytes;
  try { bytes = Buffer.from(text.trim(), 'base64'); } catch { bytes = Buffer.alloc(0); }
  if (bytes.length !== 32 || Buffer.from(bytes).toString('base64') !== text.trim().replace(/-/g, '+').replace(/_/g, '/')) {
    return { key: null, reason: `${from} must be exactly 32 random bytes, base64 (openssl rand -base64 32)` };
  }
  return { key: bytes, reason: null };
}

function seal(key, plain) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(plain)), cipher.final()]);
  return Buffer.concat([SEALED, iv, ct, cipher.getAuthTag()]);
}

function open(key, blob) {
  const b = Buffer.from(blob).subarray(8);
  if (b.length < IV_BYTES + TAG_BYTES) throw new Error('a sealed secret file is truncated');
  const iv = b.subarray(0, IV_BYTES);
  const tag = b.subarray(b.length - TAG_BYTES);
  const ct = b.subarray(IV_BYTES, b.length - TAG_BYTES);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new Error(`a secret file does not open with ${SECRETS_KEY_ENV}: is it the key this install was made with, or was the file changed?`);
  }
}

/**
 * @returns {{ kind: 'dpapi'|'key'|'none', protect(b): Promise<Buffer>, unprotect(b): Promise<Buffer>, protectMany, unprotectMany, reseal(b): Promise<Buffer|null>, probe(): Promise<boolean>, status(): { dpapi: boolean|null, reason: string|null, sealed: 'dpapi'|'key'|'none', unsealed: number } }}
 */
export function makeSecrets({ platform = process.platform, run = runPowerShell, env = process.env, readFileSync = fs.readFileSync } = {}) {
  const isWin = platform === 'win32';
  let dpapiOk = isWin;
  let reason = null;
  let sealKey = null;
  if (!isWin) {
    const k = loadSealKey({ env, readFileSync });
    sealKey = k.key;
    reason = k.reason;
  }
  let unsealed = 0;
  const method = () => (isWin ? (dpapiOk ? 'dpapi' : 'none') : (sealKey ? 'key' : 'none'));
  const refusal = () => new SecretsWriteRefused(isWin ? `Windows data protection is unavailable (${reason || 'unknown'})` : reason);

  async function protectMany(list) {
    if (isWin) {
      if (!dpapiOk) throw refusal();
      try {
        const out = await run('protect', list);
        return out.map((b) => Buffer.concat([DPAPI, b]));
      } catch (e) {
        dpapiOk = false;
        reason = String(e.message || e).slice(0, 160);
        throw refusal();
      }
    }
    if (!sealKey) throw refusal();
    return list.map((b) => seal(sealKey, b));
  }

  async function unprotectMany(list) {
    const results = new Array(list.length);
    const viaDpapi = [];
    list.forEach((raw, i) => {
      const b = Buffer.from(raw);
      const mark = b.subarray(0, 8);
      if (mark.equals(PLAIN)) { unsealed++; results[i] = b.subarray(8); }
      else if (mark.equals(SEALED)) {
        if (!sealKey) throw new Error(`a sealed secret file cannot be read: ${reason}`);
        results[i] = open(sealKey, b);
      }
      else if (mark.equals(DPAPI)) viaDpapi.push(i);
      else throw new Error('a secret file in no known format');
    });
    if (viaDpapi.length) {
      if (!isWin) throw new Error('a DPAPI secret cannot be read off Windows');
      const out = await run('unprotect', viaDpapi.map((i) => Buffer.from(list[i]).subarray(8)));
      viaDpapi.forEach((i, k) => { results[i] = out[k]; });
    }
    return results;
  }

  /**
   * P8 round 1 (finding 4): on Windows the layer learns that data protection
   * refuses only at its first write — this proves it once (one byte protected
   * and opened), so a caller can refuse BEFORE a token is spent. True when
   * secrets can be written now.
   */
  async function probe() {
    if (isWin && dpapiOk) {
      try {
        const [p] = await run('protect', [Buffer.from('wg')]);
        const [u] = await run('unprotect', [p]);
        if (!Buffer.from(u).equals(Buffer.from('wg'))) throw new Error('DPAPI round trip mismatch');
      } catch (e) {
        dpapiOk = false;
        reason = String(e.message || e).slice(0, 160);
      }
    }
    return method() !== 'none';
  }

  /** The sealed form of an earlier version's plain blob, or null (already sealed, or nothing to seal it with). */
  async function reseal(raw) {
    const b = Buffer.from(raw);
    if (!b.subarray(0, 8).equals(PLAIN) || method() === 'none') return null;
    const [sealed] = await protectMany([b.subarray(8)]);
    unsealed = Math.max(0, unsealed - 1);
    return sealed;
  }

  return {
    get kind() { return method(); },
    protectMany,
    unprotectMany,
    reseal,
    probe,
    protect: async (b) => (await protectMany([b]))[0],
    unprotect: async (b) => (await unprotectMany([b]))[0],
    status: () => ({ dpapi: isWin ? dpapiOk : null, reason: method() === 'none' ? (isWin ? `Windows data protection is unavailable (${reason || 'unknown'})` : reason) : null, sealed: method(), unsealed }),
  };
}
