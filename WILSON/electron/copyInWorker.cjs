// electron/copyInWorker.cjs — MO1 (MOTH §1.8): a copy as long as the file is big, off the main thread and
// off libuv's pool. Electron's main process has four pool threads and they serve the app's own reads
// (rootReachable.cjs, measured); a copy to a server that stops answering holds its thread for the OS
// timeout. Each call is synchronous work in its own short-lived worker thread, which is all it holds.
'use strict';

const { Worker } = require('node:worker_threads');

// Paths arrive as data (workerData), never as code.
const WORKER_CODE = `const { workerData, parentPort } = require('node:worker_threads');
const fs = require('node:fs');
const crypto = require('node:crypto');
function sha1Of(file) {
  const h = crypto.createHash('sha1');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      h.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}
function run({ job, from, to, exclusive, hash }) {
  if (job === 'same') return { ok: true, same: fs.statSync(from).size === fs.statSync(to).size && sha1Of(from) === sha1Of(to) };
  fs.copyFileSync(from, to, exclusive ? fs.constants.COPYFILE_EXCL : 0);
  const fd = fs.openSync(to, 'r+');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const copied = fs.statSync(to);
  if (fs.statSync(from).size !== copied.size || (hash && sha1Of(from) !== sha1Of(to))) {
    try { fs.unlinkSync(to); } catch { /* the answer below says it did not match */ }
    return { ok: false, code: 'not_verified' };
  }
  return { ok: true, size: copied.size, mtimeMs: copied.mtimeMs };
}
let out;
try { out = run(workerData); } catch (err) { out = { ok: false, code: err.code || 'failed', message: String(err.message || err) }; }
parentPort.postMessage(out);`;

function inWorker(input) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (answer) => {
      if (settled) return;
      settled = true;
      if (answer.ok) {
        resolve(answer);
      } else {
        const err = new Error(answer.message || 'the copy did not match its original');
        err.code = answer.code;
        reject(err);
      }
    };
    let worker;
    try {
      worker = new Worker(WORKER_CODE, { eval: true, workerData: input });
    } catch {
      done({ ok: false, code: 'failed' });
      return;
    }
    worker.once('message', done);
    worker.once('error', () => done({ ok: false, code: 'failed' }));
    worker.once('exit', () => done({ ok: false, code: 'failed' }));
  });
}

// { size, mtimeMs } of the copy, flushed and checked against its original. A copy that does not match is
// removed, and the error's code is not_verified.
const copyVerified = (from, to, { exclusive = false, hash = false } = {}) => inWorker({ job: 'copy', from, to, exclusive, hash });
const sameBytes = async (from, to) => (await inWorker({ job: 'same', from, to })).same;

module.exports = { copyVerified, sameBytes };
