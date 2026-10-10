// =============================================================================
// platform.test.mjs — the pieces that touch Windows or the host, proved
// without installing anything:
//   * the pipes' protocol (pipe.mjs): a message from a key holder is answered;
//     a server that does not hold the key (a process squatting the pipe's
//     name) gets NOTHING of the message; a client without the key is cut; a
//     tampered box is refused. On Windows over a real named pipe, elsewhere
//     over a UNIX socket.
//   * DPAPI through PowerShell (secrets.mjs): a real round trip on Windows,
//     tamper refused; the fallback when PowerShell refuses; plain elsewhere.
//   * the share logins (shares.mjs) with a fake mapper: kept protected, the
//     password never on a command line.
//   * Get-NetAdapter's and /sys/class/net's parsers (hostfacts.mjs).
//   * the updater's firewall request: its arguments only (netsh never runs).
//   * the command (cli.mjs) and the installer's helper (installer.mjs).
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { servePipe, callPipe, pipePath, seal, loadOrMakePipeKey } from '../src/platform/pipe.mjs';
import { makeSecrets, runPowerShell } from '../src/platform/secrets.mjs';
import { ShareLogins, shareOf, parseSmbConnections } from '../src/platform/shares.mjs';
import { parseAdapters, linuxNetFacts } from '../src/platform/hostfacts.mjs';
import { firewallArgs, firewallPortOk, FIREWALL_RULE } from '../updater/updater.mjs';
import { summaryText, enrolFile } from '../src/installer.mjs';
import { stateDirFor } from '../src/platform/state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'src', 'cli.mjs');
let tmp;
beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gw2-platform-')); });
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const uniquePipe = () => pipePath(`wilson-gw2-test-${process.pid}-${crypto.randomBytes(4).toString('hex')}`, process.platform, tmp);

describe('the pipes\' protocol (pipe.mjs)', () => {
  it('a key holder\'s message is answered, encrypted both ways', async () => {
    const key = crypto.randomBytes(32);
    const p = uniquePipe();
    const seen = [];
    const server = await servePipe({ path: p, key, handler: async (m) => { seen.push(m); return { ok: true, echo: m.n }; } });
    try {
      expect(await callPipe({ path: p, key, message: { type: 'status', n: 7 } })).toEqual({ ok: true, echo: 7 });
      expect(seen).toEqual([{ type: 'status', n: 7 }]);
    } finally { server.close(); }
  });
  it('a squatter on the pipe\'s name that does not hold the key receives NOTHING of the message', async () => {
    const key = crypto.randomBytes(32);
    const p = uniquePipe();
    const got = [];
    const squatter = net.createServer((s) => {
      s.on('data', (d) => got.push(String(d)));
      // Answers the client's hello with a made-up proof.
      s.once('data', () => s.write(JSON.stringify({ s: crypto.randomBytes(32).toString('hex'), sp: 'f'.repeat(64) }) + '\n'));
    });
    await new Promise((r) => squatter.listen(p, r));
    try {
      await expect(callPipe({ path: p, key, message: { type: 'share_login', user: 'u', password: 'the secret' } })).rejects.toMatchObject({ code: 'EBADSERVER' });
      expect(got.join('')).not.toContain('the secret');
      expect(got.join('')).not.toContain('share_login');
    } finally { squatter.close(); }
  });
  it('a client without the key is cut, and the handler never runs', async () => {
    const key = crypto.randomBytes(32);
    const p = uniquePipe();
    let ran = false;
    const server = await servePipe({ path: p, key, handler: async () => { ran = true; return { ok: true }; } });
    try {
      await expect(callPipe({ path: p, key: crypto.randomBytes(32), message: { type: 'rollback' } })).rejects.toBeTruthy();
      expect(ran).toBe(false);
    } finally { server.close(); }
  });
  it('a box that does not open (tampered, or under another key) is refused', () => {
    const k = crypto.randomBytes(32);
    const box = seal(k, { a: 1 });
    box.ct = Buffer.from(Buffer.from(box.ct, 'base64').map((b, i) => (i === 0 ? b ^ 1 : b))).toString('base64');
    return import('../src/platform/pipe.mjs').then(({ open }) => {
      expect(() => open(k, box)).toThrow();
      expect(() => open(crypto.randomBytes(32), seal(k, { a: 1 }))).toThrow();
    });
  });
  it('the key file: 32 bytes made once and kept', () => {
    const f = path.join(tmp, 'pipe.key');
    const k1 = loadOrMakePipeKey(f);
    const k2 = loadOrMakePipeKey(f);
    expect(k1.length).toBe(32);
    expect(k2.equals(k1)).toBe(true);
  });
});

describe('secrets at rest (secrets.mjs)', () => {
  it.runIf(process.platform === 'win32')('Windows: DPAPI round trip through PowerShell, several at once; a tampered blob is refused', async () => {
    const s = makeSecrets({ platform: 'win32' });
    const a = crypto.randomBytes(40);
    const b = Buffer.from('wgc_' + crypto.randomBytes(32).toString('base64url'));
    const [pa, pb] = await s.protectMany([a, b]);
    expect(pa.subarray(0, 8).toString()).toBe('WGDPAPI1');
    expect(pa.includes(a)).toBe(false);
    const [ua, ub] = await s.unprotectMany([pa, pb]);
    expect(ua.equals(a) && ub.equals(b)).toBe(true);
    const bad = Buffer.from(pa); bad[bad.length - 3] ^= 1;
    await expect(s.unprotect(bad)).rejects.toThrow();
    expect(s.status()).toEqual({ dpapi: true, reason: null });
  }, 30_000);
  it('when PowerShell refuses (Constrained Language mode), the folder\'s ACL is the protection, and the status says so', async () => {
    const s = makeSecrets({ platform: 'win32', run: async () => { throw new Error('Cannot invoke method. Method invocation is supported only on core types in this language mode.'); } });
    const p = await s.protect(Buffer.from('x'));
    expect(p.subarray(0, 8).toString()).toBe('WGPLAIN1');
    expect(s.status().dpapi).toBe(false);
    expect(s.status().reason).toMatch(/language mode/);
    expect((await s.unprotect(p)).toString()).toBe('x');
  });
  it('off Windows: plain, mode-600 files; a DPAPI blob cannot be read there', async () => {
    const s = makeSecrets({ platform: 'linux' });
    expect((await s.unprotect(await s.protect(Buffer.from('k')))).toString()).toBe('k');
    await expect(s.unprotect(Buffer.concat([Buffer.from('WGDPAPI1'), Buffer.from('x')]))).rejects.toThrow(/off Windows/);
    await expect(s.unprotect(Buffer.from('garbage-no-marker'))).rejects.toThrow(/no known format/);
  });
});

describe('share logins (shares.mjs)', () => {
  const plain = makeSecrets({ platform: 'linux' });
  it('kept protected, one per server, the session opened with the password on stdin', async () => {
    const calls = [];
    const logins = new ShareLogins({ file: path.join(tmp, 'shares.bin'), secrets: plain, map: async (x) => { calls.push(x); return { ok: true }; } });
    expect(await logins.set({ unc: '\\\\NAS\\Footage\\Day 1', user: 'wilson-gateway', password: 'p@ss' })).toEqual({ ok: true, root: '\\\\NAS\\Footage' });
    expect(calls).toEqual([{ unc: '\\\\NAS\\Footage', user: 'wilson-gateway', password: 'p@ss' }]);
    expect(logins.has('nas')).toBe(true);
    expect(fs.readFileSync(path.join(tmp, 'shares.bin')).subarray(0, 8).toString()).toBe('WGPLAIN1');
    const again = new ShareLogins({ file: path.join(tmp, 'shares.bin'), secrets: plain, map: async (x) => { calls.push(x); return { ok: true }; } });
    expect(await again.load()).toEqual([expect.objectContaining({ host: 'nas', root: '\\\\NAS\\Footage', user: 'wilson-gateway' })]);
    await again.connectAll();
    expect(calls).toHaveLength(2);
  });
  it('a login Windows refuses is not kept', async () => {
    const logins = new ShareLogins({ file: path.join(tmp, 'shares2.bin'), secrets: plain, map: async () => ({ ok: false, error: 'The user name or password is incorrect.' }) });
    expect((await logins.set({ unc: '\\\\nas\\footage', user: 'u', password: 'p' })).error).toMatch(/refused the login for \\\\nas\\footage/);
    expect(fs.existsSync(path.join(tmp, 'shares2.bin'))).toBe(false);
    expect((await logins.set({ unc: 'C:\\footage', user: 'u', password: 'p' })).ok).toBe(false);
  });
  it('the mapping script takes the password on stdin, never in its command line', async () => {
    const { runMapping } = await import('../src/platform/shares.mjs');
    let argv = null;
    let stdin = '';
    const fakeSpawn = (file, args) => {
      argv = [file, ...args];
      const ee = new (require_events())();
      ee.stdout = new (require_events())(); ee.stderr = new (require_events())();
      ee.stdin = { end: (d) => { stdin = d; setImmediate(() => { ee.stdout.emit('data', 'mapped'); ee.emit('close', 0); }); } };
      ee.kill = () => {};
      return ee;
    };
    expect(await runMapping({ unc: '\\\\nas\\footage', user: 'u', password: 'hunter2' }, { spawnImpl: fakeSpawn })).toEqual({ ok: true });
    expect(argv.join(' ')).not.toContain('hunter2');
    expect(JSON.parse(stdin)).toEqual({ unc: '\\\\nas\\footage', user: 'u', password: 'hunter2' });
  });
  it('shareOf and Get-SmbConnection\'s rows', () => {
    expect(shareOf('\\\\Nas01\\Footage\\A')).toEqual({ host: 'nas01', root: '\\\\Nas01\\Footage' });
    expect(shareOf('/x')).toBeNull();
    expect(parseSmbConnections('{"ServerName":"nas","ShareName":"footage","Dialect":"3.1.1"}')).toEqual([{ unc: '\\\\nas\\footage', dialect: '3.1.1' }]);
    expect(parseSmbConnections('[{"ServerName":"nas","ShareName":"a","Dialect":"2.1"},{"ServerName":null}]')).toEqual([{ unc: '\\\\nas\\a', dialect: '2.1' }]);
  });
});
function require_events() { return EventEmitterClass; }
import { EventEmitter as EventEmitterClass } from 'node:events';

describe('host facts (hostfacts.mjs)', () => {
  it('Get-NetAdapter\'s JSON, one adapter or many', () => {
    const m = parseAdapters('[{"Name":"Ethernet 5","InterfaceDescription":"Intel(R) Ethernet Connection (22) I219-V","HardwareInterface":true,"Virtual":false},{"Name":"vEthernet (WSL)","InterfaceDescription":"Hyper-V Virtual Ethernet Adapter","HardwareInterface":false,"Virtual":true}]');
    expect(m.get('Ethernet 5')).toEqual({ hardware: true, virtual: false, description: 'Intel(R) Ethernet Connection (22) I219-V' });
    expect(m.get('vEthernet (WSL)').hardware).toBe(false);
    expect(parseAdapters('{"Name":"Wi-Fi","HardwareInterface":true}').get('Wi-Fi').hardware).toBe(true);
  });
  it('/sys/class/net: ifindex, iflink and DEVTYPE per interface', () => {
    const root = path.join(tmp, 'sys-class-net');
    const mk = (n, files) => { fs.mkdirSync(path.join(root, n), { recursive: true }); for (const [f, v] of Object.entries(files)) fs.writeFileSync(path.join(root, n, f), v); };
    mk('eth0', { ifindex: '2\n', iflink: '2\n', uevent: 'INTERFACE=eth0\nIFINDEX=2\n' });
    mk('veth9', { ifindex: '9\n', iflink: '10\n', uevent: 'INTERFACE=veth9\n' });
    mk('eth0.10', { ifindex: '5\n', iflink: '2\n', uevent: 'DEVTYPE=vlan\nINTERFACE=eth0.10\n' });
    const f = linuxNetFacts({ root });
    expect(f.available).toBe(true);
    expect(f.byName).toEqual({ eth0: { ifindex: 2, iflink: 2, devtype: null }, veth9: { ifindex: 9, iflink: 10, devtype: null }, 'eth0.10': { ifindex: 5, iflink: 2, devtype: 'vlan' } });
    expect(linuxNetFacts({ root: path.join(tmp, 'none') }).available).toBe(false);
  });
});

describe('the updater\'s firewall request (arguments only: netsh never runs here)', () => {
  it('the outside door\'s rule: inbound TCP on one port, for this program only; removed by name', () => {
    expect(firewallArgs('open', { port: 8444, program: 'C:\\Program Files\\WILSON Gateway\\current\\node.exe' })).toEqual(['advfirewall', 'firewall', 'add', 'rule', `name=${FIREWALL_RULE}`, 'dir=in', 'action=allow', 'protocol=TCP', 'localport=8444', 'program=C:\\Program Files\\WILSON Gateway\\current\\node.exe', 'enable=yes', 'profile=any']);
    expect(firewallArgs('close', {})).toEqual(['advfirewall', 'firewall', 'delete', 'rule', `name=${FIREWALL_RULE}`]);
  });
  it('never the inside door\'s port, never a privileged port, never a non-integer', () => {
    expect(firewallPortOk(8444, 8443)).toBe(true);
    expect(firewallPortOk(8443, 8443)).toBe(false);
    expect(firewallPortOk(443, 8443)).toBe(false);
    expect(firewallPortOk('8444', 8443)).toBe(false);
    expect(firewallPortOk(70000, 8443)).toBe(false);
  });
});

describe('the command and the installer\'s helper', () => {
  const env = (extra = {}) => ({ ...process.env, WILSON_GATEWAY_STATE_DIR: path.join(tmp, 'cli-state'), ...extra });
  it('version names the gateway, Node and OpenSSL', () => {
    const out = execFileSync(process.execPath, [CLI, 'version'], { encoding: 'utf8', env: env() });
    expect(out).toMatch(/^wilson-gateway 0\.1\.0 \(node \d+\.\d+\.\d+, openssl [^,]+, (windows|container), /);
  });
  it('doctor without a running gateway says so and exits 1', () => {
    const r = spawnSync(process.execPath, [CLI, 'doctor'], { encoding: 'utf8', env: env() });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/has written no status/);
  });
  it('enrol refuses a malformed token before anything else', () => {
    const r = spawnSync(process.execPath, [CLI, 'enrol', 'not-a-token', '--cloud', 'https://fake-cloud.test/functions/v1'], { encoding: 'utf8', env: env(), timeout: 60_000 });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not an enrolment token/);
  }, 60_000);
  it('an unknown command prints the usage', () => {
    const r = spawnSync(process.execPath, [CLI, 'frobnicate'], { encoding: 'utf8', env: env() });
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(/run \| enrol <token>/);
  });
  it('the state folder: ProgramData on Windows, /data elsewhere, moved only by WILSON_GATEWAY_STATE_DIR', () => {
    expect(stateDirFor({ platform: 'win32', env: { ProgramData: 'C:\\ProgramData' } })).toBe('C:\\ProgramData\\WILSON Gateway');
    expect(stateDirFor({ platform: 'linux', env: {} })).toBe('/data');
    expect(stateDirFor({ platform: 'linux', env: { WILSON_GATEWAY_STATE_DIR: tmp } })).toBe(path.resolve(tmp));
  });
  it('the installer writes the token for the SERVICE to enrol with, and nothing for a non-token', () => {
    const dir = path.join(tmp, 'msi-state');
    expect(enrolFile(dir, 'wgt_ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', 'https://x.supabase.co/functions/v1')).toEqual({ ok: true });
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'enrol.json'), 'utf8'))).toEqual({ token: 'wgt_ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', cloud: 'https://x.supabase.co/functions/v1' });
    expect(enrolFile(dir, 'nope', null).ok).toBe(false);
  });
  it('the installer\'s last screen: the fingerprint, the addresses, what next', () => {
    const t = summaryText({ result: { ok: true, fingerprint_display: 'AB:CD' }, status: { doors: { inside: { open: [{ address: '192.168.1.10', port: 8443 }], refused: [{ address: '10.8.0.6', iface: 'OpenVPN', reason: 'VPN adapter' }] } }, health_line: '**PC** \u00b7 0.1.0' }, waitedS: 3 });
    expect(t).toContain('AB:CD');
    expect(t).toContain('192.168.1.10:8443');
    expect(t).toContain('not used: 10.8.0.6 on OpenVPN (VPN adapter)');
    expect(t).toContain('SmartScreen');
    expect(summaryText({ result: { ok: false, error: 'used already' }, status: null, waitedS: 60 })).toContain('The enrolment did not work: used already');
  });
});

describe('PowerShell as the secrets\' helper (the command line it runs)', () => {
  it('the bytes travel on stdin; the script is fixed', async () => {
    let argv = null;
    let stdin = '';
    const fakeSpawn = (file, args) => {
      argv = [file, ...args];
      const ee = new EventEmitterClass();
      ee.stdout = new EventEmitterClass(); ee.stderr = new EventEmitterClass();
      ee.stdin = { end: (d) => { stdin = d; setImmediate(() => { ee.stdout.emit('data', Buffer.from('xyz').toString('base64')); ee.emit('close', 0); }); } };
      ee.kill = () => {};
      return ee;
    };
    const out = await runPowerShell('protect', [Buffer.from('secret-bytes')], { spawnImpl: fakeSpawn });
    expect(out[0].toString()).toBe('xyz');
    expect(argv.join(' ')).not.toContain(Buffer.from('secret-bytes').toString('base64'));
    expect(stdin.trim()).toBe(Buffer.from('secret-bytes').toString('base64'));
  });
});
