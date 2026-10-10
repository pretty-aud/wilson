// =============================================================================
// The gateway's secrets at rest: the credential, the root's and the leaf's
// private keys, the share logins (design §2 step 4, §3, §5; review round 2,
// R8, R14).
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
// sign or keep in a public repository. If PowerShell cannot do it (Constrained
// Language mode on a locked-down server), the third pick applies and the
// health line says so in amber: the files are then protected by the state
// folder's ACL only.
//
// Container: mode 600 files on the NAS's volume (the volume's encryption is
// the NAS's, §10 row 18).
//
// Every blob carries an 8-byte marker, so a file says how it was written.
// =============================================================================

import { spawn } from 'node:child_process';

const DPAPI = Buffer.from('WGDPAPI1');
const PLAIN = Buffer.from('WGPLAIN1');

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
 * @returns {{ kind: 'dpapi'|'file', protect(b): Promise<Buffer>, unprotect(b): Promise<Buffer>, protectMany, unprotectMany, status(): { dpapi: boolean, reason: string|null } }}
 */
export function makeSecrets({ platform = process.platform, run = runPowerShell } = {}) {
  let dpapiOk = platform === 'win32';
  let reason = platform === 'win32' ? null : 'not Windows';
  const plain = (b) => Buffer.concat([PLAIN, Buffer.from(b)]);

  async function protectMany(list) {
    if (dpapiOk) {
      try {
        const out = await run('protect', list);
        return out.map((b) => Buffer.concat([DPAPI, b]));
      } catch (e) {
        dpapiOk = false;
        reason = String(e.message || e).slice(0, 160);
      }
    }
    return list.map(plain);
  }

  async function unprotectMany(list) {
    const results = new Array(list.length);
    const viaDpapi = [];
    list.forEach((raw, i) => {
      const b = Buffer.from(raw);
      const mark = b.subarray(0, 8);
      if (mark.equals(PLAIN)) results[i] = b.subarray(8);
      else if (mark.equals(DPAPI)) viaDpapi.push(i);
      else throw new Error('a secret file in no known format');
    });
    if (viaDpapi.length) {
      if (platform !== 'win32') throw new Error('a DPAPI secret cannot be read off Windows');
      const out = await run('unprotect', viaDpapi.map((i) => Buffer.from(list[i]).subarray(8)));
      viaDpapi.forEach((i, k) => { results[i] = out[k]; });
    }
    return results;
  }

  return {
    get kind() { return dpapiOk ? 'dpapi' : 'file'; },
    protectMany,
    unprotectMany,
    protect: async (b) => (await protectMany([b]))[0],
    unprotect: async (b) => (await unprotectMany([b]))[0],
    status: () => ({ dpapi: platform === 'win32' ? dpapiOk : null, reason }),
  };
}
