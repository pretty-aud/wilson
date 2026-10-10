#!/usr/bin/env node
// =============================================================================
// wilson-gateway — the command (the brief, item 1).
//
//   run                          the service's and the container's entry
//   enrol <token> [--cloud <url>]   hand an enrolment token to the gateway
//   share-login <\\server\share>   (Windows, an administrator prompt) the share's login
//   doctor [--wait]              the health line, the doors, the fingerprint, the
//                                cloud, the versions: what Audrey pastes into
//                                walkthrough 61's report
//   rollback                     (Windows, administrators) the previous version back
//   version
//
// No flag of any of these admits a loopback or own-address peer to the inside
// door: there is no such flag (the brief).
// =============================================================================

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VERSION, platformName } from './version.mjs';
import { stateDirFor, FILES } from './platform/state.mjs';
import { displayFingerprint } from './certs/x509.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (name) => { const i = argv.indexOf(name); return i > 0 ? argv[i + 1] : null; };
const has = (name) => argv.includes(name);
const out = (s = '') => process.stdout.write(s + '\n');
const fail = (s, code = 1) => { process.stderr.write(s + '\n'); process.exit(code); };
const stateDir = stateDirFor();
const isWindows = process.platform === 'win32';
const usingDefaultState = !process.env.WILSON_GATEWAY_STATE_DIR;

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
const statusFile = () => path.join(stateDir, FILES.status);
function runningStatus(maxAgeMs = 20_000) {
  const s = readJson(statusFile());
  return s && Date.now() - Date.parse(s.at) < maxAgeMs ? s : null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  switch (cmd) {
    case 'run': return run();
    case 'enrol': case 'enroll': return enrol();
    case 'share-login': return shareLogin();
    case 'doctor': return doctor();
    case 'rollback': return rollback();
    case 'version': case '--version': case '-v':
      out(`wilson-gateway ${VERSION} (node ${process.versions.node}, openssl ${process.versions.openssl}, ${platformName()}, ${process.platform}-${process.arch})`);
      return undefined;
    default:
      out('wilson-gateway run | enrol <token> [--cloud <url>] | share-login <\\\\server\\share> | doctor [--wait] | rollback | version');
      process.exitCode = cmd ? 2 : 0;
      return undefined;
  }
}

// ── run ──────────────────────────────────────────────────────────────────────
async function run() {
  const { Gateway } = await import('./runtime.mjs');
  const { makeSecrets } = await import('./platform/secrets.mjs');
  const { windowsAdapters, linuxNetFacts } = await import('./platform/hostfacts.mjs');
  const { Updates } = await import('./platform/updates.mjs');
  const { ShareLogins } = await import('./platform/shares.mjs');
  const pipes = await import('./platform/pipe.mjs');
  const asService = process.env.WILSON_GATEWAY_SERVICE === '1'; // set by the Windows service host for its child

  // The first-run failure a container meets most: /data not writable by its user. One line, then out.
  try {
    await fs.promises.mkdir(stateDir, { recursive: true });
    const probe = path.join(stateDir, `.write-probe-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.rmSync(probe);
  } catch (e) {
    const who = platformName() === 'container' ? 'this container’s user (uid 65532): give that user write access to the folder mounted at /data' : 'this account';
    fail(`The gateway cannot write its folder ${stateDir} (${e.code}): ${who}.`);
  }
  const secrets = makeSecrets();
  const keyFile = path.join(stateDir, FILES.pipeKey);
  const pipeKey = isWindows ? (() => { try { return pipes.loadOrMakePipeKey(keyFile); } catch { return null; } })() : null;
  const askUpdater = (message) => (pipeKey ? pipes.callPipe({ path: pipes.pipePath(pipes.PIPES.updater), key: pipeKey, message, timeoutMs: 15_000 }) : Promise.reject(new Error('no pipe key')));
  const shares = isWindows ? new ShareLogins({ file: path.join(stateDir, FILES.shares), secrets }) : null;
  if (shares) await shares.load();

  const gw = new Gateway({
    stateDir,
    secrets,
    adapters: isWindows ? () => windowsAdapters() : async () => null,
    linuxFacts: process.platform === 'linux' ? async () => linuxNetFacts() : async () => null,
    shareLogins: shares ? { has: (h) => shares.has(h), list: () => shares.list() } : undefined,
    firewall: isWindows && asService
      ? { open: (port) => askUpdater({ type: 'firewall_open', port }).catch((e) => ({ ok: false, reason: e.code || e.message })), close: (port) => askUpdater({ type: 'firewall_close', port }).catch((e) => ({ ok: false, reason: e.code || e.message })) }
      : undefined,
  });
  gw.updates = new Updates({ platform: gw.platform, stateDir, version: VERSION, askUpdater: isWindows && asService ? askUpdater : null, log: (e, d) => gw.log(e, d) });
  await gw.updates.readFailure();
  if (shares) {
    for (const r of await shares.connectAll()) gw.log(r.ok ? 'share_connected' : 'share_not_connected', { host: r.host, error: r.error });
  }
  await gw.start();

  // The admin pipe (Windows): share-login, enrol-now, status. Node's default DACL: administrators and the service may write.
  let adminPipe = null;
  if (isWindows && asService && pipeKey) {
    try {
      adminPipe = await pipes.servePipe({
        path: pipes.pipePath(pipes.PIPES.admin),
        key: pipeKey,
        handler: async (m) => {
          if (m?.type === 'share_login' && shares) {
            const r = await shares.set({ unc: m.unc, user: m.user, password: m.password });
            if (r.ok) gw.log('share_login_kept', { root: r.root });
            return r;
          }
          if (m?.type === 'status') return { ok: true, line: gw.healthLine().text };
          return { ok: false, error: 'unknown message' };
        },
        onError: (e) => gw.log('admin_pipe_error', { message: String(e.message).slice(0, 120) }),
      });
    } catch (e) {
      gw.log('admin_pipe_unavailable', { code: e.code, effect: 'share-login cannot reach this gateway (another process may hold the name)' });
    }
  }

  // Daily update check at a random minute, and at start.
  const { randomMinuteMs } = await import('./runtime.mjs');
  setTimeout(() => gw.updates.check('start').catch(() => {}), 60_000).unref();
  const daily = setTimeout(function again() { gw.updates.check('daily').catch(() => {}); setTimeout(again, 24 * 3600_000).unref(); }, randomMinuteMs());
  daily.unref();
  if (isWindows && asService) {
    setInterval(async () => {
      try { const r = await askUpdater({ type: 'smb_dialects' }); if (r?.ok) gw.smbDialects = r.dialects; } catch { /* the updater is not there */ }
    }, 15 * 60_000).unref();
  }

  let stopping = false;
  const stop = async (why) => {
    if (stopping) return;
    stopping = true;
    gw.log('stopping', { why });
    adminPipe?.close();
    await gw.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  // The service host stops its child by closing the child's stdin.
  if (asService) { process.stdin.on('end', () => stop('service stop')); process.stdin.resume(); }
  process.on('uncaughtException', (e) => { gw.log('uncaught', { message: String(e?.stack || e).slice(0, 500) }); stop('uncaught exception').then(() => process.exit(1)); });
}

// ── enrol ────────────────────────────────────────────────────────────────────
async function enrol() {
  const token = argv[1];
  const cloud = opt('--cloud');
  if (!token) fail('wilson-gateway enrol <token> [--cloud <https://…/functions/v1>]');
  const requestedAt = Date.now();
  if (runningStatus()) {
    // A gateway runs for this state folder: hand it the token; it enrols itself, under its own identity.
    const file = path.join(stateDir, FILES.enrol);
    fs.writeFileSync(file, JSON.stringify({ token, cloud }), { mode: 0o600 });
    out('Handing the token to the running gateway…');
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      const r = readJson(path.join(stateDir, FILES.enrolResult));
      if (r && Date.parse(r.at) >= requestedAt - 1000) return printEnrol(r);
    }
    fs.rmSync(file, { force: true });
    fail('The gateway did not answer within 45 seconds. Run `wilson-gateway doctor` to see its state.');
  }
  if (isWindows && usingDefaultState) {
    fail('The WILSON Gateway service is not running. Start it (Start-Service WilsonGateway), then run this again: the service enrols itself, so its secrets are protected under its own account, not yours.');
  }
  const { Gateway } = await import('./runtime.mjs');
  const gw = new Gateway({ stateDir, enrolOnly: true, print: () => {} }); // opens no door, prints only the result
  await gw.start();
  const r = await gw.enrol(token, cloud);
  await gw.stop();
  printEnrol({ ...r, fingerprint_display: r.fingerprint ? displayFingerprint(r.fingerprint) : null });
  return undefined;
}

function printEnrol(r) {
  if (!r.ok) fail(r.error || 'The enrolment failed.');
  out(`Enrolled in ${r.workspaceName || 'the workspace'} (gateway ${r.gatewayId}).`);
  out(`Certificate fingerprint (SHA-256): ${r.fingerprint_display}`);
  out('Type or paste this fingerprint in WILSON (Settings, Storage, File gateway), beside the new gateway: that unlocks Download certificate.');
}

// ── share-login ──────────────────────────────────────────────────────────────
function prompt(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    let value = '';
    if (hidden && stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') { stdin.off('data', onData); if (hidden && stdin.isTTY) stdin.setRawMode(false); stdin.pause(); process.stdout.write('\n'); resolve(value); return; }
        if (c === '\u0003') { process.stdout.write('\n'); process.exit(130); }
        if (c === '\u0008' || c === '\u007f') { value = value.slice(0, -1); continue; }
        value += c;
      }
    };
    stdin.on('data', onData);
  });
}

async function shareLogin() {
  if (!isWindows) fail('share-login is for the Windows service: in a container, mount the share’s folder at /locations/<host>/<share> instead.');
  const unc = argv[1];
  if (!unc || !unc.startsWith('\\\\')) fail('wilson-gateway share-login \\\\server\\share   (in an administrator prompt)');
  const pipes = await import('./platform/pipe.mjs');
  let key;
  try { key = fs.readFileSync(path.join(stateDir, FILES.pipeKey)); } catch { fail('Run this in an administrator prompt (the gateway’s key is readable by administrators only), with the service running.'); }
  const user = await prompt(`User name for ${unc} (read-only on the footage share): `);
  const password = await prompt('Password (not shown): ', { hidden: true });
  try {
    const r = await pipes.callPipe({ path: pipes.pipePath(pipes.PIPES.admin), key, message: { type: 'share_login', unc, user, password } });
    if (!r.ok) fail(r.error || 'The gateway refused the login.');
    out(`Kept: the gateway reads ${r.root} with that login, in its own session. It is protected under the service's own account.`);
  } catch (e) {
    if (e.code === 'EACCES' || e.code === 'EPERM') fail('Run this in an administrator prompt: only administrators may hand the gateway a share login.');
    if (e.code === 'ENOENT') fail('The WILSON Gateway service is not running (Start-Service WilsonGateway).');
    fail(`The gateway could not be reached: ${e.message}`);
  }
  return undefined;
}

// ── doctor ───────────────────────────────────────────────────────────────────
async function doctor() {
  if (has('--wait')) {
    for (let i = 0; i < 120 && !(runningStatus(15_000)?.enrolled); i++) await sleep(500);
  }
  const s = readJson(statusFile());
  const st = readJson(path.join(stateDir, FILES.state));
  out(`WILSON file gateway ${VERSION} · node ${process.versions.node} · OpenSSL ${process.versions.openssl} · ${platformName()} · ${os.hostname()}`);
  if (!s) {
    out(`The gateway has written no status in ${stateDir}: it is not running, or this prompt cannot read its folder (run it as an administrator).`);
    process.exitCode = 1;
    return undefined;
  }
  const age = Math.round((Date.now() - Date.parse(s.at)) / 1000);
  if (age > 20) out(`! The gateway's status is ${age} s old: it may have stopped.`);
  out(s.health_line);
  for (const w of s.warnings || []) out(`  ! ${w}`);
  const inside = s.doors?.inside || {};
  out(`Office door:  ${inside.open?.length ? inside.open.map((a) => `${a.address.includes(':') ? `[${a.address}]` : a.address}:${a.port}`).join(', ') : `closed (${inside.closed})`}`);
  for (const r of inside.refused || []) out(`              not used: ${r.address} on ${r.iface} (${r.reason})`);
  const outside = s.doors?.outside || {};
  out(`Outside door: ${outside.state}${outside.port ? ` (port ${outside.port})` : ''}${outside.last_close_ms != null ? `; last closed in ${outside.last_close_ms.toFixed(1)} ms` : ''}`);
  out(`Certificate fingerprint (SHA-256): ${s.fingerprint ? displayFingerprint(s.fingerprint) : 'not made'}`);
  out(`Cloud: ${s.cloud} · ${s.enrolled ? `enrolled as ${s.gateway_id} in ${s.workspace || st?.workspace_name || '?'}` : 'not enrolled'}`);
  out(`Refused peers on the office door: ${Object.entries(s.refused_peers || {}).filter(([k, v]) => typeof v === 'number' && v > 0).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  out(`Secrets: ${s.secrets?.dpapi === true ? 'Windows data protection' : s.secrets?.dpapi === false ? `folder permissions only (${s.secrets.reason})` : 'mode 600 files'}`);
  if (s.config_problems?.length) for (const p of s.config_problems) out(`  ! config.json: ${p}`);
  out(`State: ${s.state_dir} · status written ${age} s ago by pid ${s.pid}`);
  return undefined;
}

// ── rollback ─────────────────────────────────────────────────────────────────
async function rollback() {
  if (!isWindows) fail('A container is rolled back by pulling the previous image (by its digest).');
  const pipes = await import('./platform/pipe.mjs');
  let key;
  try { key = fs.readFileSync(path.join(stateDir, FILES.pipeKey)); } catch { fail('Run this in an administrator prompt.'); }
  try {
    const r = await pipes.callPipe({ path: pipes.pipePath(pipes.PIPES.updater), key, message: { type: 'rollback' } });
    if (!r.ok) fail(`The updater refused: ${r.reason || 'unknown'}`);
    out('The previous version is back in place and the gateway restarted; the version it replaced is kept as the previous one.');
  } catch (e) {
    fail(e.code === 'ENOENT' ? 'The WILSON Gateway Updater service is not running.' : `The updater could not be reached: ${e.message}`);
  }
  return undefined;
}

main().catch((e) => fail(String(e?.stack || e)));
