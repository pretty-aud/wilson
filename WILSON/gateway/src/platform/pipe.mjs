// =============================================================================
// The two local pipes (Windows named pipes; a UNIX socket in the tests), and
// how a message on them is trusted.
//
//   \\.\pipe\WilsonGatewayAdmin    served by the gateway service: share-login,
//                                  enrol-now, status. Node's default DACL,
//                                  MEASURED on this computer (2026-10-10, a
//                                  Node 24 pipe, its descriptor read back
//                                  through a .NET pipe client):
//                                    D:(A;;FR;;;WD)(A;;FR;;;AN)(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;<creator>)
//                                  Everyone and Anonymous may only READ; SYSTEM,
//                                  elevated Administrators and the service itself
//                                  may write. So only an administrator prompt
//                                  can send a share login (design §5, R8).
//   \\.\pipe\WilsonGatewayUpdater  served by the updater (LocalSystem): swap,
//                                  rollback, firewall. The gateway's own
//                                  virtual account must WRITE to it, and Node
//                                  can grant that only to everyone
//                                  (`writableAll`, measured: Everyone gets
//                                  write AND create-instance, 0x120196). So
//                                  everyone may connect, and the brief's rule
//                                  applies: authenticate the message instead.
//
// Both pipes speak the same protocol, keyed by `pipe.key` (32 random bytes in
// the state folder, whose ACL the installer sets with icacls to SYSTEM,
// Administrators and NT SERVICE\WilsonGateway):
//
//   client → server   { c: <client nonce> }
//   server → client   { s: <server nonce>, sp: HMAC(key, "server|c|s") }
//   client            checks sp: the server knows the key (a process that
//                     squatted the pipe's name cannot: nothing is sent to it)
//   client → server   { cp: HMAC(key, "client|c|s"), box: AES-256-GCM(message) }
//   server            checks cp, opens the box (the key derived by HKDF from
//                     the pipe key and both nonces), answers in a box
//
// One message per connection; nonces fresh each time, so nothing can be
// replayed; frames are newline-delimited JSON, at most 64 KB.
// =============================================================================

import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';

export const PIPES = Object.freeze({ admin: 'WilsonGatewayAdmin', updater: 'WilsonGatewayUpdater' });
export const pipePath = (name, platform = process.platform, dir = null) => (platform === 'win32' ? `\\\\.\\pipe\\${name}` : `${dir || '/tmp'}/${name}.sock`);
const MAX_FRAME = 64 * 1024;
const TIMEOUT_MS = 30_000;

const hmac = (key, ...parts) => crypto.createHmac('sha256', key).update(parts.join('|')).digest('hex');
const boxKey = (key, c, s) => Buffer.from(crypto.hkdfSync('sha256', key, Buffer.from(c + s, 'hex'), Buffer.from('wilson-gateway-pipe/1'), 32));
const eq = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function seal(k, obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), ct: ct.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}
export function open(k, box) {
  const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(String(box?.iv), 'base64'));
  d.setAuthTag(Buffer.from(String(box?.tag), 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(String(box?.ct), 'base64')), d.final()]).toString('utf8'));
}

/** Reads newline-delimited JSON frames from a socket. */
function frames(socket, onFrame) {
  let buf = '';
  socket.setEncoding('utf8');
  socket.on('data', (d) => {
    buf += d;
    if (buf.length > MAX_FRAME) { socket.destroy(); return; }
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      let msg;
      try { msg = JSON.parse(line); } catch { socket.destroy(); return; }
      onFrame(msg);
    }
  });
}
const send = (socket, obj) => socket.write(JSON.stringify(obj) + '\n');

/** The key file: made once (32 random bytes, mode 600) when missing. */
export function loadOrMakePipeKey(file) {
  try {
    const k = fs.readFileSync(file);
    if (k.length === 32) return k;
  } catch { /* made below */ }
  const k = crypto.randomBytes(32);
  fs.writeFileSync(file, k, { mode: 0o600, flag: 'wx' });
  return fs.readFileSync(file);
}

/**
 * Serves one message per connection. `handler(message) → Promise<answer>`.
 * `listenOptions` lets the updater pass { writableAll: true } (see above).
 */
export function servePipe({ path, key, handler, listenOptions = {}, onError = () => {} }) {
  const server = net.createServer((socket) => {
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy());
    socket.on('error', () => {});
    let c = null;
    let s = null;
    let k = null;
    frames(socket, async (msg) => {
      try {
        if (c === null) {
          if (typeof msg.c !== 'string' || !/^[0-9a-f]{64}$/.test(msg.c)) { socket.destroy(); return; }
          c = msg.c;
          s = crypto.randomBytes(32).toString('hex');
          k = boxKey(key, c, s);
          send(socket, { s, sp: hmac(key, 'server', c, s) });
          return;
        }
        if (!eq(msg.cp, hmac(key, 'client', c, s))) { socket.destroy(); return; }
        const message = open(k, msg.box);
        const answer = await handler(message);
        send(socket, { box: seal(k, answer ?? { ok: true }) });
        socket.end();
      } catch (e) {
        onError(e);
        socket.destroy();
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ path, ...listenOptions }, () => { server.off('error', reject); resolve(server); });
  });
}

/** Sends one message; resolves the answer, or rejects (no such pipe, refused, or a server that does not know the key). */
export function callPipe({ path, key, message, timeoutMs = 60_000 }) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ path });
    const c = crypto.randomBytes(32).toString('hex');
    let k = null;
    let done = false;
    const finish = (err, v) => { if (done) return; done = true; clearTimeout(timer); socket.destroy(); if (err) reject(err); else resolve(v); };
    const timer = setTimeout(() => finish(Object.assign(new Error('the pipe did not answer'), { code: 'ETIMEDOUT' })), timeoutMs);
    socket.on('error', (e) => finish(e));
    socket.on('connect', () => send(socket, { c }));
    frames(socket, (msg) => {
      try {
        if (k === null) {
          if (!/^[0-9a-f]{64}$/.test(String(msg.s)) || !eq(msg.sp, hmac(key, 'server', c, msg.s))) {
            finish(Object.assign(new Error('the process on the pipe does not hold the gateway\u2019s key: nothing was sent'), { code: 'EBADSERVER' }));
            return;
          }
          k = boxKey(key, c, msg.s);
          send(socket, { cp: hmac(key, 'client', c, msg.s), box: seal(k, message) });
          return;
        }
        finish(null, open(k, msg.box));
      } catch (e) { finish(e); }
    });
    socket.on('close', () => finish(Object.assign(new Error('the pipe closed without an answer'), { code: 'ECLOSED' })));
  });
}
