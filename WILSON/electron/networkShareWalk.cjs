// electron/networkShareWalk.cjs — MO1 (MOTH §1.8, NS-D5, NS-D7, NS-X05, NS-X07): what is in a space's
// folder on the office server. Metadata only, and the catalogue decides what to do with it.
//
//   POST /api/network-share/walk   body { folder, start? }, locators under the drive
//   answers { dirs: [{ d, complete, subdirs, files: [{ n, s, m?, t? }] }], bin, stopped_at, counts }
//
// That is network_share_catalogue_apply's p_dirs: whole directories, each speaking for itself, so a walk
// split across calls stays correct. A directory refused by the server, or cut by a limit or the deadline,
// says complete: false, and nothing under it is called missing. stopped_at is where the next call starts;
// there is no cursor here, the walk rotates from network_share_checks.next_start.
//
// The walk runs in its own worker thread with synchronous calls: a dead server holds that thread, never
// the window or libuv's pool (bins, measured). walkFolder and classifySequence close over nothing, because
// their source is what the worker runs. A link or junction is never followed or listed.
'use strict';

const { Worker } = require('node:worker_threads');
const { classifySequence, SEQUENCE_EXTS } = require('./frameSequence.cjs');
const { isShareRoot: isShareRootReal, personalOwnerOf } = require('./networkShare.cjs');

const ROUTE = '/api/network-share/walk';
const MAX_FILES = 5000;
const MAX_DIRS = 2000;
const MAX_DEPTH = 8;
const DEADLINE_MS = 60000;
// A worker stuck in a call cannot read the clock, so the route gives it this long past the deadline.
const GRACE_MS = 5000;
// A frame folder this big is summed from this many frames and scaled: its size is told, not certified.
const MAX_FRAME_STATS = 5000;
const SEQUENCE_MIME = 'inode/x-frame-sequence';

function walkFolder(input, fs, path, classify) {
  const { root, folder, start, lists, limits } = input;
  const deadline = Date.now() + limits.deadlineMs;
  const refused = new RegExp(lists.refusedChars, 'u');
  const shortName = new RegExp(lists.shortName, 'u');
  const device = new RegExp(lists.deviceName, 'i');
  const money = new Set(lists.refusedExact);
  const skipped = new Set(['NODE_MODULES', 'DESKTOP.INI', 'THUMBS.DB']);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const at = (rel) => path.join(root, ...rel.split('/'));
  const nameOk = (name, rel) => {
    const upper = name.toUpperCase();
    if (name.startsWith('.') || skipped.has(upper) || money.has(upper)) return false;
    if (lists.refusedSuffix.some((suffix) => upper.endsWith(suffix))) return false;
    if (refused.test(name) || shortName.test(name) || device.test(name) || /[. ]$/.test(name)) return false;
    if (name.normalize('NFC') !== name) return false;
    const whole = `${rel}/${name}`;
    return Array.from(whole).length <= 1024 && Buffer.byteLength(whole, 'utf8') <= lists.maxBytes;
  };
  const timeOf = (ms) => (ms >= limits.oldestMs && ms <= Date.now() + 86400000 ? new Date(ms).toISOString() : undefined);

  let realRoot;
  let realFolder;
  try {
    realRoot = fs.realpathSync(root);
    if (fs.lstatSync(at(folder)).isSymbolicLink()) return { ok: false, code: 'a_link' };
    realFolder = fs.realpathSync(at(folder));
  } catch (err) {
    return { ok: false, code: err.code === 'ENOENT' || err.code === 'ENOTDIR' ? 'not_there' : 'no_access' };
  }
  const low = (p) => p.toLowerCase();
  // A link anywhere on the way is refused as shareContain refuses it, not only one that leads out: a
  // junction inside the drive would list a money folder under an innocent name.
  if (low(realFolder).normalize('NFC') !== low(path.join(realRoot, ...folder.split('/'))).normalize('NFC')) return { ok: false, code: 'a_link' };

  const compare = (a, b) => { const x = low(a); const y = low(b); return x < y ? -1 : x > y ? 1 : 0; };
  // A folder of one frame series is one entry, in its parent's list (NS-X07). One that cannot be read now
  // says so: it may be a series, and its row must not be called missing because the look failed.
  const UNREADABLE = { unreadable: true };
  // The same question without a frame's lstat, for a folder whose parent this walk is only passing through.
  function isSeries(rel) {
    let entries;
    try { entries = fs.readdirSync(at(rel), { withFileTypes: true }); } catch { return false; }
    if (entries.some((e) => !e.name.startsWith('.') && !e.isFile())) return false;
    return Boolean(classify(entries.filter((e) => !e.name.startsWith('.')).map((e) => e.name), lists.sequenceExts));
  }
  function asSequence(rel) {
    let entries;
    try { entries = fs.readdirSync(at(rel), { withFileTypes: true }); } catch { return UNREADABLE; }
    if (entries.some((e) => !e.name.startsWith('.') && !e.isFile())) return null;
    const names = entries.filter((e) => !e.name.startsWith('.')).map((e) => e.name);
    const seq = classify(names, lists.sequenceExts);
    if (!seq) return null;
    let size = 0;
    let newest = 0;
    let counted = 0;
    for (const frame of seq.frames) {
      if (counted >= limits.maxFrameStats || Date.now() > deadline) break;
      try {
        const st = fs.lstatSync(path.join(at(rel), frame.name));
        size += st.size;
        if (st.mtimeMs > newest) newest = st.mtimeMs;
        counted += 1;
      } catch { /* a frame that went while counting */ }
    }
    if (counted === 0) return UNREADABLE;
    return { size: Math.round((size / counted) * seq.frames.length), newest };
  }

  const dirs = [];
  let bin = [];
  let files = 0;
  let stoppedAt = null;
  let reached = !start || compare(start, folder) === 0;
  const stack = [{ rel: folder, depth: 0 }];

  if (!start) {
    try {
      // An empty id folder holds nothing to ask about, and must not take a place in this list.
      for (const name of fs.readdirSync(path.join(at(folder), '.wilson-bin')).filter((n) => uuid.test(n))) {
        if (bin.length >= limits.maxBin || Date.now() > deadline) break;
        try {
          if (fs.readdirSync(path.join(at(folder), '.wilson-bin', name)).length > 0) bin.push(name);
        } catch { /* not there now */ }
      }
    } catch { /* no bin yet */ }
  }

  while (stack.length > 0) {
    const { rel, depth } = stack.pop();
    if (Date.now() > deadline || dirs.length >= limits.maxDirs) { stoppedAt = rel; break; }
    // On the way down to where the last call stopped: nothing is told about what it has passed.
    const onTheWay = !reached && low(start).startsWith(`${low(rel)}/`);
    if (!reached && !onTheWay) reached = true;
    const record = { d: rel, complete: true, subdirs: [], files: [] };
    let entries;
    try {
      entries = fs.readdirSync(at(rel), { withFileTypes: true });
    } catch {
      if (!onTheWay) { record.complete = false; dirs.push(record); }
      continue;
    }
    entries.sort((a, b) => compare(a.name, b.name));
    const kept = entries.filter((e) => nameOk(e.name, rel));
    const fileCount = kept.filter((e) => e.isFile()).length;
    // Whole directories: this one goes in the next call, unless it would not fit in any.
    if (!onTheWay && dirs.length > 0 && files + fileCount > limits.maxFiles) { stoppedAt = rel; break; }
    const below = [];
    for (const entry of kept) {
      if (Date.now() > deadline) { record.complete = false; break; }
      const child = `${rel}/${entry.name}`;
      if (onTheWay) {
        const order = compare(child, start.split('/').slice(0, rel.split('/').length + 1).join('/'));
        // A later frame folder is one entry, which its parent's call told: walked as a folder here, each of
        // its frames would become a row, called missing by the next walk from the top.
        if (entry.isDirectory() && order >= 0 && !(order > 0 && isSeries(child))) below.push(child);
        continue;
      }
      let st;
      try {
        st = fs.lstatSync(at(child));
      } catch {
        record.complete = false;
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        const seq = asSequence(child);
        if (seq === UNREADABLE) {
          record.complete = false;
          record.subdirs.push(entry.name);
          if (depth + 1 <= limits.maxDepth) below.push(child);
        } else if (seq) {
          if (files + record.files.length >= limits.maxFiles) { record.complete = false; continue; }
          const entryOut = { n: entry.name, s: String(seq.size), t: lists.sequenceMime };
          const m = timeOf(seq.newest);
          if (m) entryOut.m = m;
          record.files.push(entryOut);
        } else {
          record.subdirs.push(entry.name);
          if (depth + 1 <= limits.maxDepth) below.push(child);
        }
      } else if (st.isFile()) {
        if (files + record.files.length >= limits.maxFiles) { record.complete = false; continue; }
        const out = { n: entry.name, s: String(st.size) };
        const m = timeOf(st.mtimeMs);
        if (m) out.m = m;
        record.files.push(out);
      }
    }
    if (!onTheWay) {
      dirs.push(record);
      files += record.files.length;
    }
    for (let i = below.length - 1; i >= 0; i -= 1) stack.push({ rel: below[i], depth: depth + 1 });
  }
  return { ok: true, dirs, bin, stopped_at: stoppedAt, counts: { dirs: dirs.length, files } };
}

const WORKER_CODE = `const { workerData, parentPort } = require('node:worker_threads');
const walk = ${walkFolder.toString()};
const classify = ${classifySequence.toString()};
let out;
try { out = walk(workerData, require('node:fs'), require('node:path'), classify); } catch { out = { ok: false, code: 'failed' }; }
parentPort.postMessage(out);`;

function walkInWorker(input, deadlineMs) {
  return new Promise((resolve) => {
    let worker;
    let timer = null;
    const done = (answer) => {
      clearTimeout(timer);
      resolve(answer);
    };
    try {
      worker = new Worker(WORKER_CODE, { eval: true, workerData: input });
    } catch {
      done({ ok: false, code: 'failed' });
      return;
    }
    timer = setTimeout(() => {
      worker.terminate();
      done({ ok: false, code: 'timed_out' });
    }, deadlineMs + GRACE_MS);
    worker.once('message', done);
    worker.once('error', () => done({ ok: false, code: 'failed' }));
    worker.once('exit', () => done({ ok: false, code: 'failed' }));
    worker.unref();
  });
}

const STATUS = { not_there: 404, a_link: 403, no_access: 403, timed_out: 503, failed: 500 };

function mountNetworkShareWalk(expressApp, {
  getWorkspaceRoot,
  isSameOriginRequest,
  checkShareLocator,
  reach,
  lists,
  isShareRoot = isShareRootReal,
  verifyBearer = async () => ({ userId: null }),
  deadlineMs = DEADLINE_MS,
  limits = {},
} = {}) {
  for (const [name, fn] of Object.entries({ getWorkspaceRoot, isSameOriginRequest, checkShareLocator })) {
    if (typeof fn !== 'function') throw new Error(`mountNetworkShareWalk: ${name} is required`);
  }
  expressApp.post(ROUTE, async (req, res) => {
    if (!isSameOriginRequest(req)) return res.status(403).json({ code: 'not_allowed', error: 'This can only be asked by WILSON itself.' });
    const folder = req.body?.folder;
    const start = req.body?.start ?? null;
    if (!checkShareLocator(folder)) return res.status(400).json({ code: 'bad_locator', error: 'That is not a folder WILSON can read.' });
    if (start !== null && (!checkShareLocator(start) || !(start === folder || start.toLowerCase().startsWith(`${folder.toLowerCase()}/`)))) {
      return res.status(400).json({ code: 'bad_locator', error: 'That is not a folder WILSON can read.' });
    }
    const root = getWorkspaceRoot();
    if (!root || !isShareRoot(root)) return res.status(409).json({ code: 'no_drive', error: 'This company is not on an office server from this computer.' });
    if (!(await reach.rootReachable(root))) return res.status(503).json({ code: 'unreachable', error: 'The office server cannot be reached from this computer.' });
    // A personal space's walk is its owner's (0117's _network_share_may_check), so this says what the server would.
    const owner = personalOwnerOf(folder);
    if (owner) {
      const verified = await verifyBearer(req.headers?.authorization);
      if (verified.unreachable) return res.status(503).json({ code: 'cannot_check', error: 'WILSON could not check who you are just now. Try again.' });
      if (owner !== String(verified.userId ?? '').toLowerCase()) return res.status(403).json({ code: 'not_your_folder', error: 'This is somebody else\'s personal space.' });
    }
    const answer = await walkInWorker({
      root,
      folder,
      start,
      lists: {
        refusedChars: lists.refusedChars,
        shortName: lists.shortName,
        deviceName: lists.deviceName,
        refusedExact: lists.refusedExact,
        refusedSuffix: lists.refusedSuffix,
        maxBytes: lists.maxBytes,
        sequenceExts: SEQUENCE_EXTS,
        sequenceMime: SEQUENCE_MIME,
      },
      limits: {
        deadlineMs,
        maxFiles: limits.maxFiles ?? MAX_FILES,
        maxDirs: limits.maxDirs ?? MAX_DIRS,
        maxDepth: limits.maxDepth ?? MAX_DEPTH,
        maxBin: 500,
        maxFrameStats: MAX_FRAME_STATS,
        oldestMs: Date.UTC(1980, 0, 1),
      },
    }, deadlineMs);
    if (!answer.ok) return res.status(STATUS[answer.code] ?? 500).json({ code: answer.code, error: 'WILSON could not read this folder on the office server.' });
    const { ok: _ok, ...body } = answer;
    return res.json(body);
  });
}

module.exports = { mountNetworkShareWalk, walkFolder, ROUTE, SEQUENCE_MIME };
