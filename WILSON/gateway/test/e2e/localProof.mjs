// =============================================================================
// The local proof (the GW2 brief, "Verification, on this computer"): the REAL
// executable (`node gateway/src/cli.mjs run`, a separate process) against the
// fake cloud over HTTPS on loopback, the outside door on loopback
// (outside.behind_local_proxy), a 256 MB file of random bytes read through
// \\localhost\C$\… as the spike did. Not part of vitest: it writes 256 MB, and
// it BINDS THIS COMPUTER'S LAN ADDRESS (the office door, for the own-address
// proof) for its duration only. Announce it before running it.
//
//   node gateway/test/e2e/localProof.mjs --scratch <empty scratch folder> [--inside-port 28443]
//
// It prints one JSON report: Appendix A's numbers measured again, every
// refusal with its status and body length, the renewal's refusals, the
// catalogue's, the office door's own-address and loopback proofs with the
// counter, and the outside port's close (the gateway's own measurement and
// netstat). Everything it made (the 256 MB file, the certificates, the
// state) is deleted in a finally.
// =============================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createFakeCloud, serveFakeCloud } from '../fakeCloud.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '..', '..', 'src', 'cli.mjs');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const scratch = path.resolve(arg('--scratch', ''));
if (!arg('--scratch', '')) { console.error('--scratch <folder> is required'); process.exit(2); }
const INSIDE_PORT = Number(arg('--inside-port', 28443));
const SIZE = 256 * 1024 * 1024;
const LOC = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CLIP = '99999999-8888-4777-b666-555555555555';
const MXF = '99999999-8888-4777-b666-555555555556';
const TRAV = '99999999-8888-4777-b666-555555555557';
const LINK = '99999999-8888-4777-b666-555555555558';
const UNCONFIRMED = '99999999-8888-4777-b666-555555555559';
const OTHER = '99999999-8888-4777-b666-55555555555a';
const SUB = '11111111-2222-4333-8444-555555555555';
const SUB2 = '22222222-3333-4444-8555-666666666666';

const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const median = (xs) => pct(xs, 50);
const r2 = (x) => Math.round(x * 100) / 100;

const report = { when: new Date().toISOString(), host: os.hostname(), node: process.versions.node, openssl: process.versions.openssl };
const dirs = { root: path.join(scratch, 'gw2-e2e') };
dirs.state = path.join(dirs.root, 'state');
dirs.share = path.join(dirs.root, 'share');
dirs.outside = path.join(dirs.root, 'outside');
dirs.fc = path.join(dirs.root, 'fake-cloud');
let gateway = null;
let fake = null;
const log = [];

function unc(p) { return '\\\\localhost\\' + p[0] + '$' + p.slice(2); }

async function main() {
  fs.mkdirSync(dirs.state, { recursive: true });
  fs.mkdirSync(path.join(dirs.share, 'A001'), { recursive: true });
  fs.mkdirSync(dirs.outside, { recursive: true });
  // 256 MB of random bytes, never footage.
  const clipPath = path.join(dirs.share, 'A001', 'clip.mp4');
  const fd = fs.openSync(clipPath, 'w');
  for (let i = 0; i < SIZE / (16 * 1024 * 1024); i++) fs.writeSync(fd, crypto.randomBytes(16 * 1024 * 1024));
  fs.closeSync(fd);
  fs.writeFileSync(path.join(dirs.share, 'A001', 'master.mxf'), crypto.randomBytes(4096));
  fs.writeFileSync(path.join(dirs.outside, 'secret.mp4'), crypto.randomBytes(4096));
  fs.symlinkSync(dirs.outside, path.join(dirs.share, 'link-out'), process.platform === 'win32' ? 'junction' : 'dir');

  const cloud = createFakeCloud();
  fake = await serveFakeCloud(cloud, { dir: dirs.fc });
  const shareUnc = process.platform === 'win32' ? unc(dirs.share) : dirs.share;
  cloud.addLocation({ id: LOC, unc_path: shareUnc, name: 'Footage (\\\\localhost\\C$ for this proof)' });
  cloud.addClip(CLIP, { loc: LOC, path: 'A001/clip.mp4', mt: 'video/mp4' });
  cloud.addClip(OTHER, { loc: LOC, path: 'A001/clip.mp4', mt: 'video/mp4' });
  cloud.addClip(MXF, { loc: LOC, path: 'A001/master.mxf', mt: 'application/mxf' });
  cloud.addClip(TRAV, { loc: LOC, path: '../outside/secret.mp4', mt: 'video/mp4' });
  cloud.addClip(LINK, { loc: LOC, path: 'link-out/secret.mp4', mt: 'video/mp4' });
  cloud.addMember(SUB);
  cloud.addMember(SUB2);
  const outsidePort = await freePort();
  cloud.state.switchOn = true;
  cloud.state.outsideAddress = { host: '127.0.0.1', port: outsidePort };
  fs.writeFileSync(path.join(dirs.state, 'config.json'), JSON.stringify({ inside: { port: INSIDE_PORT }, outside: { port: outsidePort, behind_local_proxy: true } }, null, 2));
  report.share = shareUnc;
  report.outside_port = outsidePort;

  gateway = spawn(process.execPath, [CLI, 'run'], {
    env: { ...process.env, WILSON_GATEWAY_STATE_DIR: dirs.state, WILSON_ENROL_TOKEN: cloud.newToken(), WILSON_CLOUD_URL: fake.url, NODE_EXTRA_CA_CERTS: fake.caFile, UV_THREADPOOL_SIZE: '32' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  gateway.stdout.on('data', (d) => log.push(...String(d).split('\n').filter(Boolean)));
  gateway.stderr.on('data', (d) => log.push(...String(d).split('\n').filter(Boolean).map((l) => `stderr ${l}`)));
  const waitLog = async (re, ms = 30_000) => { const t = Date.now(); while (Date.now() - t < ms) { if (log.some((l) => re.test(l))) return true; await sleep(50); } return false; };
  if (!(await waitLog(/ outside_open /))) throw new Error('the outside door did not open:\n' + log.join('\n'));
  report.first_log_lines = log.slice(0, 4);
  const rootPem = fs.readFileSync(path.join(dirs.state, 'certs', 'root.pem'), 'utf8');
  const hostname = os.hostname().toLowerCase();
  const agent = new https.Agent({ keepAlive: true, maxSockets: 1, ca: rootPem, servername: hostname });
  const req = (p, { headers = {}, method = 'GET', body = null, abortAfter = null, keep = true } = {}) => new Promise((resolve, reject) => {
    const t0 = process.hrtime.bigint();
    const r = https.request({ host: '127.0.0.1', port: outsidePort, path: p, method, headers, agent: keep ? agent : false, ca: rootPem, servername: hostname }, (res) => {
      let n = 0;
      const chunks = [];
      res.on('data', (c) => { n += c.length; if (n <= 65536 * 2) chunks.push(c); if (abortAfter && n >= abortAfter) { const ms = Number(process.hrtime.bigint() - t0) / 1e6; r.destroy(); resolve({ status: res.statusCode, n, ms, aborted: true }); } });
      res.on('end', () => resolve({ status: res.statusCode, n, ms: Number(process.hrtime.bigint() - t0) / 1e6, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', () => {});
    });
    r.on('error', (e) => (abortAfter ? undefined : reject(e)));
    if (body) r.write(body);
    r.end();
  });
  const t = (o = {}) => cloud.mint({ clip: CLIP, sub: SUB, ...o });

  // ── Appendix A, measured again ──────────────────────────────────────────
  const head = await req(`/v1/clips/${CLIP}?t=${t()}`, { method: 'HEAD' });
  report.head = { status: head.status, content_length: head.headers['content-length'], accept_ranges: head.headers['accept-ranges'], content_type: head.headers['content-type'], etag: head.headers.etag ?? null, last_modified: head.headers['last-modified'] ?? null, server: head.headers.server ?? null };
  const ticket = t();
  const first = await req(`/v1/clips/${CLIP}?t=${ticket}`, { headers: { range: 'bytes=0-65535' } });
  const seeks = [];
  for (let i = 0; i < 50; i++) {
    const off = crypto.randomInt(0, SIZE - 65536);
    const r = await req(`/v1/clips/${CLIP}?t=${ticket}`, { headers: { range: `bytes=${off}-${off + 65535}` } });
    if (r.status !== 206 || r.n !== 65536) throw new Error(`seek ${i}: ${r.status} ${r.n}`);
    seeks.push(r.ms);
  }
  report.seeks_64kb = { first_cold_ms: r2(first.ms), median_ms: r2(median(seeks)), p95_ms: r2(pct(seeks, 95)), worst_ms: r2(Math.max(...seeks)), spike: 'median 2.3, p95 4.0, worst 5.4' };
  const localSeeks = [];
  const lfd = fs.openSync(path.join(process.platform === 'win32' ? unc(dirs.share) : dirs.share, 'A001', 'clip.mp4'), 'r');
  const lb = Buffer.alloc(65536);
  for (let i = 0; i < 50; i++) { const off = crypto.randomInt(0, SIZE - 65536); const t0 = process.hrtime.bigint(); fs.readSync(lfd, lb, 0, 65536, off); localSeeks.push(Number(process.hrtime.bigint() - t0) / 1e6); }
  fs.closeSync(lfd);
  const directSeeks = [];
  const dfd = fs.openSync(clipPath, 'r');
  for (let i = 0; i < 50; i++) { const off = crypto.randomInt(0, SIZE - 65536); const t0 = process.hrtime.bigint(); fs.readSync(dfd, lb, 0, 65536, off); directSeeks.push(Number(process.hrtime.bigint() - t0) / 1e6); }
  fs.closeSync(dfd);
  report.same_reads_without_the_gateway = { unc_median_ms: r2(median(localSeeks)), unc_p95_ms: r2(pct(localSeeks, 95)), local_path_median_ms: r2(median(directSeeks)), local_path_p95_ms: r2(pct(directSeeks, 95)), spike_local_path: 'median 1.0, p95 1.8' };
  const t0 = process.hrtime.bigint();
  let total = 0;
  const seqTicket = t();
  for (let off = 0; off < SIZE; off += 4 * 1024 * 1024) {
    const r = await req(`/v1/clips/${CLIP}?t=${seqTicket}`, { headers: { range: `bytes=${off}-${off + 4 * 1024 * 1024 - 1}` } });
    total += r.n;
  }
  const secs = Number(process.hrtime.bigint() - t0) / 1e9;
  report.sequential_4mb_ranges = { bytes: total, seconds: r2(secs), mb_per_s: Math.round(total / 1024 / 1024 / secs), spike: '337 MB/s' };
  const open = await req(`/v1/clips/${CLIP}?t=${t()}`, { headers: { range: 'bytes=0-' }, abortAfter: 32 * 1024 * 1024, keep: false });
  await sleep(500);
  const servedLine = [...log].reverse().find((l) => / clip_served / .test(l) && l.includes('"status":206') && /"bytes":(\d+)/.test(l) && Number(/"bytes":(\d+)/.exec(l)[1]) > 30 * 1024 * 1024);
  const streamed = servedLine ? Number(/"bytes":(\d+)/.exec(servedLine)[1]) : null;
  report.open_ended_stopped_at_32mb = { status: open.status, client_ms: r2(open.ms), server_streamed_bytes: streamed, server_streamed_mb: streamed ? r2(streamed / 1024 / 1024) : null, of_total_mb: SIZE / 1024 / 1024, spike: '32 MB at 84 ms; nothing further' };

  // ── Every refusal, with its status and no body ──────────────────────────
  const refused = async (label, p, opts) => { const r = await req(p, opts); return { label, status: r.status, body_bytes: r.n }; };
  const [v, payload, sig] = t().split('.');
  const flipped = Buffer.from(sig, 'base64url'); flipped[5] ^= 1;
  report.refusals = [
    await refused('no ticket', `/v1/clips/${CLIP}`),
    await refused('forged (a flipped signature byte)', `/v1/clips/${CLIP}?t=${v}.${payload}.${flipped.toString('base64url')}`),
    await refused('expired', `/v1/clips/${CLIP}?t=${t({ iat: Math.floor(Date.now() / 1000) - 400 })}`),
    await refused('for another gateway', `/v1/clips/${CLIP}?t=${cloud.mint({ clip: CLIP, sub: SUB, gw: '7f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f602' })}`),
    await refused('rv false on the outside door', `/v1/clips/${CLIP}?t=${t({ rv: false })}`),
    await refused('a traversal path', `/v1/clips/${TRAV}?t=${cloud.mint({ clip: TRAV, sub: SUB })}`),
    await refused('a junction out of the share', `/v1/clips/${LINK}?t=${cloud.mint({ clip: LINK, sub: SUB })}`),
    await refused('a type off the list (.mxf)', `/v1/clips/${MXF}?t=${cloud.mint({ clip: MXF, sub: SUB })}`),
    await refused('an unsatisfiable range', `/v1/clips/${CLIP}?t=${t()}`, { headers: { range: `bytes=${SIZE}-` } }),
    await refused('a multi-range', `/v1/clips/${CLIP}?t=${t()}`, { headers: { range: 'bytes=0-1,5-9' } }),
  ];
  // The catalogue check: a clip minted, then removed from the catalogue.
  cloud.addClip(UNCONFIRMED, { loc: LOC, path: 'A001/clip.mp4', mt: 'video/mp4' });
  const unconfirmedTicket = cloud.mint({ clip: UNCONFIRMED, sub: SUB });
  cloud.state.files.delete(UNCONFIRMED);
  report.refusals.push(await refused('a clip the cloud does not confirm', `/v1/clips/${UNCONFIRMED}?t=${unconfirmedTicket}`, { headers: { range: 'bytes=0-0' } }));

  // ── Renewal ────────────────────────────────────────────────────────────
  const streamTicket = t();
  await req(`/v1/clips/${CLIP}?t=${streamTicket}`, { headers: { range: 'bytes=0-0' } });
  const jti = JSON.parse(Buffer.from(streamTicket.split('.')[1], 'base64url')).jti;
  const renew = async (label, body, id = CLIP) => { const r = await req(`/v1/clips/${id}/renew`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { label, status: r.status, body_bytes: r.n }; };
  report.renewals = [
    await renew('another clip\'s ticket', { jti, t: cloud.mint({ clip: OTHER, sub: SUB }) }),
    await renew('another viewer\'s ticket', { jti, t: cloud.mint({ clip: CLIP, sub: SUB2 }) }),
    await renew('a guessed jti', { jti: crypto.randomBytes(16).toString('hex'), t: t() }),
    await renew('the right one (control)', { jti, t: t() }),
  ];

  // ── The office door at the socket level, with this computer's two peers ─
  const lan = Object.values(os.networkInterfaces()).flat().find((a) => a && !a.internal && a.family === 'IPv4' && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address))?.address;
  report.office_door = { lan_address: lan || null, inside_port: INSIDE_PORT };
  if (lan && (await waitLog(/ inside_open /, 10_000))) {
    const rawBytes = (host) => new Promise((resolve) => {
      const s = net.connect(INSIDE_PORT, host);
      let got = 0;
      s.on('data', (c) => { got += c.length; });
      s.on('connect', () => s.write(Buffer.from('160301', 'hex')));
      s.on('close', () => resolve({ connected: true, bytes_received: got }));
      s.on('error', (e) => resolve({ connected: false, code: e.code, bytes_received: got }));
      setTimeout(() => s.destroy(), 3000);
    });
    report.office_door.own_address_peer = await rawBytes(lan);
    report.office_door.loopback_peer = await rawBytes('127.0.0.1');
    await sleep(5500); // the next status.json
    const st = JSON.parse(fs.readFileSync(path.join(dirs.state, 'status.json'), 'utf8'));
    report.office_door.counter = st.refused_peers;
    report.office_door.health_line = st.health_line;
  } else {
    report.office_door.note = 'the office door did not open (no LAN address, or it could not bind)';
  }

  // ── The switch off: the outside port unbound, measured ───────────────────
  cloud.state.switchOn = false;
  const closed = await waitLog(/ outside_closed /, 20_000);
  const closeLine = log.find((l) => / outside_closed /.test(l));
  report.switch_off = { closed, gateway_line: closeLine ? closeLine.slice(closeLine.indexOf('outside_closed')) : null };
  const netstat = execFileSync(process.platform === 'win32' ? 'netstat' : 'sh', process.platform === 'win32' ? ['-an'] : ['-c', 'netstat -an || ss -ltn'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  // Only sockets LISTENING on the port, or connections whose LOCAL end is the gateway's loopback port:
  // other programs' outgoing connections may use the same number as an ephemeral port on another address.
  const portRe = new RegExp(`^\\s*TCP\\s+(\\S+):${outsidePort}\\s+(\\S+)\\s+(\\S+)`, 'i');
  report.switch_off.netstat_listening_or_loopback = netstat.split('\n').map((l) => l.trim()).filter((l) => {
    const m = portRe.exec(l);
    return !!m && (/LISTEN/i.test(m[3]) || /^(127\.0\.0\.1|\[::1\])$/.test(m[1]));
  });
  report.switch_off.connect = await new Promise((resolve) => { const t1 = process.hrtime.bigint(); const s = net.connect(outsidePort, '127.0.0.1'); s.once('error', (e) => resolve({ code: e.code, ms: r2(Number(process.hrtime.bigint() - t1) / 1e6) })); s.once('connect', () => { s.destroy(); resolve({ code: 'connected' }); }); });
  agent.destroy();
}

main()
  .then(() => { console.log(JSON.stringify(report, null, 2)); })
  .catch((e) => { console.error(String(e?.stack || e)); console.error(log.slice(-30).join('\n')); process.exitCode = 1; })
  .finally(async () => {
    if (gateway && gateway.exitCode === null) gateway.kill();
    await sleep(500);
    if (fake) await fake.close();
    fs.rmSync(dirs.root, { recursive: true, force: true }); // the 256 MB file, every certificate, the state
    console.error(`cleaned: ${dirs.root} exists = ${fs.existsSync(dirs.root)}`);
  });
