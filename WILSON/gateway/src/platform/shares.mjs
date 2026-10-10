// =============================================================================
// Share logins on Windows (design §5 "The share, mounted read-only by the
// gateway's own account"; review round 2, R8; §11 B step 3).
//
// `wilson-gateway share-login \\nas\footage`, in an administrator prompt, asks
// for the read-only share account's name and password and hands them to the
// RUNNING service over the admin pipe (pipe.mjs); the service keeps them in
// shares.bin, DPAPI-protected under its own identity (one login per server),
// and opens the share session itself, in its own logon session, with
// New-SmbMapping (a deviceless mapping: no drive letter, no Credential
// Manager entry, no profile loading), the password passed on the child's
// stdin, never on a command line. At every start the sessions are opened
// again.
//
// The negotiated SMB dialect (TPN-CONT-016: SMB 3 with signing and
// encryption; SMB 1 refused): Get-SmbConnection is refused to a non-elevated
// account (measured on this computer: "Access is denied"), so the gateway
// asks the updater service (LocalSystem) for it over the updater pipe, and
// warns in the health line below 3.
//
// What a local administrator of this PC can do: impersonate the service and
// recover the login (read-only on the footage share). §10 row 18 says so.
// =============================================================================

import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { parseUncPath } from '../rules/mountRule.mjs';

const MAP_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$in = [Console]::In.ReadToEnd() | ConvertFrom-Json',
  'Remove-SmbMapping -RemotePath $in.unc -Force -ErrorAction SilentlyContinue | Out-Null',
  'New-SmbMapping -RemotePath $in.unc -UserName $in.user -Password $in.password -Persistent $false | Out-Null',
  "[Console]::Out.Write('mapped')",
].join('\n');

export function runMapping({ unc, user, password }, { spawnImpl = spawn, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let child;
    try { child = spawnImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', MAP_SCRIPT], { windowsHide: true }); } catch (e) { resolve({ ok: false, error: e.message }); return; }
    const timer = setTimeout(() => { child.kill(); resolve({ ok: false, error: 'timed out' }); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: e.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 && out.includes('mapped') ? { ok: true } : { ok: false, error: String(err).split('\n')[0].replace(/\s+/g, ' ').slice(0, 200) || `exit ${code}` });
    });
    child.stdin.end(JSON.stringify({ unc, user, password }));
  });
}

/** The share's root (\\server\share) of a UNC path, and its server, lower-cased. */
export function shareOf(unc) {
  const p = parseUncPath(unc);
  return p ? { host: p.host.toLowerCase(), root: `\\\\${p.host}\\${p.share}` } : null;
}

export class ShareLogins {
  constructor({ file, secrets, map = runMapping, now = Date.now }) {
    this.file = file;
    this.secrets = secrets;
    this.map = map;
    this.now = now;
    this.hosts = {}; // host → { root, user, password, at }
  }

  async load() {
    try {
      const blob = await fs.promises.readFile(this.file);
      const data = JSON.parse((await this.secrets.unprotect(blob)).toString('utf8'));
      this.hosts = data && typeof data.hosts === 'object' ? data.hosts : {};
    } catch {
      this.hosts = {};
    }
    return this.list();
  }

  has(host) { return Object.prototype.hasOwnProperty.call(this.hosts, String(host).toLowerCase()); }
  list() { return Object.entries(this.hosts).map(([host, v]) => ({ host, root: v.root, user: v.user, at: v.at })); }

  /** Keep a login (replacing the server's previous one) and open the session now. */
  async set({ unc, user, password }) {
    const s = shareOf(unc);
    if (!s) return { ok: false, error: 'That is not a network address (\\\\server\\share).' };
    if (typeof user !== 'string' || !user.trim() || user.length > 256 || typeof password !== 'string' || password.length > 1024) return { ok: false, error: 'A user name and a password are needed.' };
    const mapped = await this.map({ unc: s.root, user: user.trim(), password });
    if (!mapped.ok) return { ok: false, error: `Windows refused the login for ${s.root}: ${mapped.error}` };
    this.hosts[s.host] = { root: s.root, user: user.trim(), password, at: new Date(this.now()).toISOString() };
    await fs.promises.writeFile(this.file, await this.secrets.protect(Buffer.from(JSON.stringify({ hosts: this.hosts }), 'utf8')), { mode: 0o600 });
    return { ok: true, root: s.root };
  }

  /** At start: every kept session opened again in this service's own logon session. */
  async connectAll() {
    const out = [];
    for (const [host, v] of Object.entries(this.hosts)) out.push({ host, ...(await this.map({ unc: v.root, user: v.user, password: v.password })) });
    return out;
  }
}

/** Parses Get-SmbConnection's JSON (run by the updater as LocalSystem) into [{ unc, dialect }]. */
export function parseSmbConnections(json) {
  const raw = JSON.parse(json || '[]');
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter((c) => c && c.ServerName && c.ShareName).map((c) => ({ unc: `\\\\${c.ServerName}\\${c.ShareName}`, dialect: String(c.Dialect || '') }));
}
