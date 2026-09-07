#!/usr/bin/env node
// =============================================================================
// scripts/local-server-lock-harness.mjs — Bundle B3 (Track B).
//
// Proves the desktop loopback lock over a REAL listening socket:
//
//     no token        -> 401
//     header          -> 200
//     cookie          -> 200
//     wrong token     -> 401
//     header + cookie -> 200
//     static shell    -> 200 unauthenticated (deliberate; see localToken.cjs)
//
// ── 🚨 THE FAILING CONTROL ──────────────────────────────────────────────────
//
// A green harness only means something if it can go red. The last phase
// re-runs the "no token" case with the expectation FLIPPED to 200 and requires
// that assertion to FAIL. A harness whose control passes is a harness that is
// not really asserting, and it exits non-zero saying so. Run with
// `--show-control` to see the failure printed the way a real one would look.
//
// ── WHY THIS IS THE REAL CODE AND NOT A COPY ────────────────────────────────
//
// It mounts `applyLocalServerLock` from electron/localToken.cjs — the same
// function `startLocalServer` calls, with the same cors package, in the same
// order — onto an Express app with stub routes standing in for the 94 real
// ones. What it therefore does NOT prove is that main.cjs mounts it ahead of
// everything; that is proven by grep (one call site, before express.json and
// before any route) and by running the app, which is what walkthrough
// 12_desktop_local_mode.md is for.
//
// Run: node scripts/local-server-lock-harness.mjs   (from WILSON/)
// =============================================================================

import express from 'express';
import cors from 'cors';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const {
  TOKEN_HEADER,
  TOKEN_COOKIE,
  mintLaunchToken,
  applyLocalServerLock,
} = require(path.join(HERE, '..', 'electron', 'localToken.cjs'));

const SHOW_CONTROL = process.argv.includes('--show-control');

// ── a scratch "dist" so the static arm is real too ───────────────────────────
const distPath = fs.mkdtempSync(path.join(os.tmpdir(), 'wilson-lock-harness-'));
fs.writeFileSync(path.join(distPath, 'index.html'), '<!doctype html>shell');

const token = mintLaunchToken();
let rendererOrigin = null;

const app = express();
applyLocalServerLock(app, {
  cors,
  getToken: () => token,
  getOrigin: () => rendererOrigin,
});
app.use(express.json({ limit: '50mb' }));

// Stand-ins for the two routes OUTSTANDING.md's MEASURED S40 names by hand:
// the enumeration that hands out ids, and the stream that returns original
// media bytes for them.
app.get('/api/rabbit/projects', (_req, res) => res.json([{ id: 'p1' }]));
app.get('/api/rabbit/projects/:pid/managed-files/:fid/stream', (_req, res) =>
  res.type('video/mp4').send('ORIGINAL-MEDIA-BYTES'));
app.use(express.static(distPath));
app.get('/{*splat}', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));

const server = await new Promise((resolve, reject) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
  s.on('error', reject);
});
const port = server.address().port;
rendererOrigin = `http://127.0.0.1:${port}`;

// ── assertions ───────────────────────────────────────────────────────────────
const results = [];

async function check(label, { path: p = '/api/rabbit/projects', headers = {} } = {}, expected) {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, { headers });
  const pass = res.status === expected;
  results.push({ label, expected, actual: res.status, pass });
  return pass;
}

const ENUMERATE = '/api/rabbit/projects';
const STREAM = '/api/rabbit/projects/p1/managed-files/f1/stream';

await check('no token                → 401', { path: ENUMERATE }, 401);
await check('no token, stream route  → 401', { path: STREAM }, 401);
await check('header                  → 200', { path: ENUMERATE, headers: { [TOKEN_HEADER]: token } }, 200);
await check('header, stream route    → 200', { path: STREAM, headers: { [TOKEN_HEADER]: token } }, 200);
await check('cookie                  → 200', { path: ENUMERATE, headers: { cookie: `${TOKEN_COOKIE}=${token}` } }, 200);
await check('cookie among others     → 200', { path: ENUMERATE, headers: { cookie: `a=1; ${TOKEN_COOKIE}=${token}; b=2` } }, 200);
await check('header + cookie         → 200', {
  path: ENUMERATE,
  headers: { [TOKEN_HEADER]: token, cookie: `${TOKEN_COOKIE}=${token}` },
}, 200);
await check('wrong token (header)    → 401', { path: ENUMERATE, headers: { [TOKEN_HEADER]: 'b'.repeat(64) } }, 401);
await check('wrong token (cookie)    → 401', { path: ENUMERATE, headers: { cookie: `${TOKEN_COOKIE}=${'b'.repeat(64)}` } }, 401);
await check('truncated token         → 401', { path: ENUMERATE, headers: { [TOKEN_HEADER]: token.slice(0, 32) } }, 401);
await check('empty token             → 401', { path: ENUMERATE, headers: { [TOKEN_HEADER]: '' } }, 401);
await check('static shell, no token  → 200', { path: '/index.html' }, 200);
await check('SPA fallback, no token  → 200', { path: '/anything' }, 200);
// 🚨 An /api path with NO matching route must be refused by the guard, not
// fall through to the SPA catch-all — otherwise probing for routes gets a 200
// and an HTML body, which is both an oracle and a very confusing 200.
await check('unmatched /api, no token→ 401', { path: '/api/does-not-exist' }, 401);
await check('/api exactly, no token   → 401', { path: '/api' }, 401);
// …and a path that merely STARTS with the four letters is not /api.
await check('/apiary is not /api      → 200', { path: '/apiary' }, 200);

// ── raw-socket bypass probes ───────────────────────────────────────────
// 🚨 THESE EXIST BECAUSE TWO OF THEM WERE REAL, and B3's own review round is
// where they were found — both complete authentication bypasses, both invisible
// to every check above:
//
//   * `GET /API/RABBIT/PROJECTS` — Express's router is case-INSENSITIVE by
//     default, so it matched the route and returned the project list while a
//     case-sensitive `startsWith('/api/')` said "not an /api path".
//   * `GET http://127.0.0.1:<port>/api/... HTTP/1.1` — the absolute-form
//     request target (RFC 9112 §3.2.2), which Node accepts and puts in
//     `req.url` whole, so the prefix test missed it and the router did not.
//
// A raw socket is REQUIRED to see either: `fetch()` normalises the request
// target before it leaves the process, so the same probes through fetch are
// green against a guard that is wide open.
const CRLF = '\r\n';
function rawGet(target) {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(
        `GET ${target} HTTP/1.1${CRLF}Host: 127.0.0.1:${port}${CRLF}Connection: close${CRLF}${CRLF}`);
    });
    let buf = '';
    sock.on('data', (d) => { buf += d; });
    sock.on('end', () => resolve({
      status: Number((buf.split(CRLF)[0] || '').split(' ')[1]),
      leaked: buf.includes('"p1"') || buf.includes('ORIGINAL-MEDIA-BYTES'),
    }));
    sock.on('error', () => resolve({ status: 0, leaked: false }));
  });
}

for (const target of [
  '/API/RABBIT/PROJECTS',
  '/Api/Rabbit/Projects',
  '//api/rabbit/projects',
  '/api//rabbit/projects',
  '/./api/rabbit/projects',
  '/foo/../api/rabbit/projects',
  '/api/rabbit/projects;x=1',
  '/api/rabbit/projects/',
]) {
  const r = await rawGet(target);
  results.push({
    label: `raw ${target.padEnd(28)} no leak`,
    expected: 'no data', actual: r.leaked ? `LEAKED (${r.status})` : 'no data', pass: !r.leaked,
  });
}
{
  const r = await rawGet(`http://127.0.0.1:${port}${ENUMERATE}`);
  results.push({
    label: 'raw absolute-form target      no leak',
    expected: 'no data', actual: r.leaked ? `LEAKED (${r.status})` : 'no data', pass: !r.leaked,
  });
}

// A refusal must say nothing about WHY.
const refused = await fetch(`http://127.0.0.1:${port}${ENUMERATE}`);
const body = await refused.text();
results.push({
  label: '401 body is empty       → ""',
  expected: '""', actual: JSON.stringify(body), pass: body === '',
});

// CORS is defence in depth, not the gate: a foreign origin gets no
// Access-Control-Allow-Origin even when it somehow holds the token.
const foreign = await fetch(`http://127.0.0.1:${port}${ENUMERATE}`, {
  headers: { origin: 'http://evil.example', [TOKEN_HEADER]: token },
});
results.push({
  label: 'foreign origin: no ACAO',
  expected: 'absent',
  actual: foreign.headers.get('access-control-allow-origin') ?? 'absent',
  pass: foreign.headers.get('access-control-allow-origin') === null,
});

// …and the renderer's own origin IS echoed, which is what keeps the
// `<img crossOrigin="anonymous">` entity thumbnails loading.
const own = await fetch(`http://127.0.0.1:${port}${ENUMERATE}`, {
  headers: { origin: rendererOrigin, [TOKEN_HEADER]: token },
});
results.push({
  label: 'renderer origin: ACAO set',
  expected: rendererOrigin,
  actual: own.headers.get('access-control-allow-origin') ?? 'absent',
  pass: own.headers.get('access-control-allow-origin') === rendererOrigin,
});

// ── the control ──────────────────────────────────────────────────────────────
// Deliberately wrong: an unauthenticated call is 401, so expecting 200 MUST
// fail. If it passes, the assertions above are not assertions.
//
// With --show-control the flipped expectation is registered as a REAL result,
// so the harness prints a genuine FAIL line and exits 1. That is the difference
// between demonstrating the control and describing it.
const controlBefore = results.length;
await check('CONTROL no token        → 200', { path: ENUMERATE }, 200);
const control = results[controlBefore];
if (!SHOW_CONTROL) results.length = controlBefore;

// 🚨 closeAllConnections() BEFORE close(). Node's global fetch keeps its
// sockets alive, so close() alone leaves the process hanging; and calling
// process.exit() out from under them aborts libuv on Windows with
// "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" and an exit code of
// 127 — a green harness that reports failure to CI.
server.closeAllConnections?.();
server.close();
fs.rmSync(distPath, { recursive: true, force: true });

// ── report ───────────────────────────────────────────────────────────────────
let failed = 0;
console.log('\nWILSON desktop loopback lock — harness\n');
for (const r of results) {
  const mark = r.pass ? 'ok  ' : 'FAIL';
  if (!r.pass) failed++;
  console.log(`  ${mark}  ${r.label}${r.pass ? '' : `   (expected ${r.expected}, got ${r.actual})`}`);
}

console.log('\n  control (expects 200 without a token, and MUST fail):');
if (control.pass) {
  console.log('    FAIL  the control PASSED — the assertions above prove nothing.');
  failed++;
} else if (SHOW_CONTROL) {
  console.log('    the FAIL line above is the control, run for real. Exit code is 1.');
} else {
  console.log(`    ok    control failed as designed (expected 200, got ${control.actual})`);
  console.log('    re-run with --show-control to see it go red.');
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAILED'}: ${results.length} checks, ${failed} failing\n`);
// exitCode, not process.exit(): see the closeAllConnections note above.
process.exitCode = failed === 0 ? 0 : 1;
