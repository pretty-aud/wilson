// electron/networkShareOps.cjs — MO1 (MOTH_DESIGN §1.8, NS-D7, NS-D12, NS-D13): what the desktop does to
// the real files on an office server. The server has written the row and journalled the operation (0117,
// 0118); these move the file, and the renderer then settles the operation with what happened.
//
//   GET  /api/network-share/reachable                                   is the server there, before anything is written
//   POST /api/network-share/look    { paths: [locator] }                what is at each, a bin's path too
//   POST /api/network-share/op      { pairs: [{ from, to, size? }] }    the renames
//   POST /api/network-share/put     { to, from: { picked } | { media_key } }   a copy in, never over
//   POST /api/network-share/purge   { paths: ['<space>/.wilson-bin/<id>'] }    a bin's file gone for good
//   GET  /api/rabbit/network-share/file/<locator>                        a file's bytes, with ranges
//
// Each pair and path answers for itself, because each settles for itself: { ok } or { ok: false, code }.
// A target that exists is refused, never overwritten: its name is reserved with an exclusive create, and
// the rename replaces only that empty reservation, as the add route does. An empty file at the target may be
// another rename under way, here or on another computer, and removing it then would remove the file as it
// lands: renames of one locator take turns here, and only a reservation too old to be anyone's is removed. A
// rename is verified by looking, and one that threw is looked at too: it may have happened, with only the
// answer lost.
// Same origin and the launch token are asked first, a UNC drive, and the drive reachable. File work is
// async and bounded, never synchronous on the main thread: a dead SMB path can hold a call for the OS
// timeout (bins, measured).
//
// A locator through a link or junction is refused here, as the walk never lists one (shareContain). A write in
// a personal folder asks who is calling, as the add route does: the folder's name is all that keeps it theirs.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { classifySequence, SEQUENCE_EXTS } = require('./frameSequence.cjs');
const { mimeForLeaf, contentDisposition } = require('./localMedia.cjs');
const { attachWhenAsked } = require('./fileReads.cjs');
const { copyVerified } = require('./copyInWorker.cjs');
const { isShareRoot: isShareRootReal, personalOwnerOf, STALE_UPLOAD_MS } = require('./networkShare.cjs');

const ROUTE = '/api/network-share/op';
const REACHABLE_ROUTE = '/api/network-share/reachable';
const LOOK_ROUTE = '/api/network-share/look';
const PUT_ROUTE = '/api/network-share/put';
const PURGE_ROUTE = '/api/network-share/purge';
const FILE_ROUTE = '/api/rabbit/network-share/file';
const MAX_PAIRS = 500;
// A rename follows its reservation at once, and a dead server holds it for the OS timeout (42 s, measured).
// Clocks differ between computers, so this is well past that.
const RESERVATION_STALE_MS = 10 * 60 * 1000;

const OFF = 'The office server cannot be reached from this computer.';
const NOT_HERE = 'This file is not on this computer.';

const refuse = (res, status, code, error) => res.status(status).json({ code, error });

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// A trash or a restore moves a file through <space>/.wilson-bin/<id>/<leaf>, which is the one dot-led
// segment a locator may hold, and only in exactly that shape (0117's network_share_bin_ok).
const BIN_FILE = new RegExp(`^(.+)/\\.wilson-bin/${UUID}/([^/]+)$`);
const BIN_FOLDER = new RegExp(`^(.+)/\\.wilson-bin/${UUID}$`);
function locatorOk(p, checkShareLocator) {
  if (typeof p !== 'string') return false;
  const bin = BIN_FILE.exec(p);
  return bin ? checkShareLocator(bin[1]) && checkShareLocator(bin[2]) : checkShareLocator(p);
}

const IN_USE = new Set(['EBUSY', 'EPERM', 'EACCES']);
const failure = (err) => (IN_USE.has(err?.code) ? 'in_use' : 'failed');

function mountNetworkShareOps(expressApp, {
  getWorkspaceRoot,
  isSameOriginRequest,
  checkShareLocator,
  reach,
  contain,
  isShareRoot = isShareRootReal,
  fsp = fs.promises,
  pathImpl = path,
  verifyBearer = async () => ({ userId: null }),
  // The two sources a copy may come from: a file the person picked in this session's OS dialog, or a
  // private project's body under the local media root (a copy-up).
  isAuthorizedFile = () => false,
  resolveMediaKey = () => null,
  safeMediaContentType = (m) => m,
} = {}) {
  for (const [name, fn] of Object.entries({ getWorkspaceRoot, isSameOriginRequest, checkShareLocator, contain })) {
    if (typeof fn !== 'function') throw new Error(`mountNetworkShareOps: ${name} is required`);
  }
  if (!reach || typeof reach.rootReachable !== 'function') throw new Error('mountNetworkShareOps: reach is required');

  const at = (root, rel) => pathImpl.join(root, ...rel.split('/'));
  const parentOf = (rel) => rel.split('/').slice(0, -1).join('/');
  // A call on the server here takes one of the contained slots (shareContain.cjs). Two do not: a file's bytes
  // (sendFile, below) and the add route (networkShare.cjs), each of which holds a pool thread for as long as a
  // dead server takes. A stream cannot wait in a slot for its whole length, and adds run one at a time.
  const io = (call) => (contain.withSlot ? contain.withSlot(call) : call());
  const lookAt = (p) => io(() => fsp.lstat(p)).catch((err) => (err.code === 'ENOENT' || err.code === 'ENOTDIR' ? null : Promise.reject(err)));
  const reserve = (p) => io(async () => { await (await fsp.open(p, 'wx')).close(); });
  const leftLongAgo = (stat) => Date.now() - stat.mtimeMs > RESERVATION_STALE_MS;

  // Asks for the same file take turns: a banner's refresh and a page's settle can send one pair together.
  const running = new Map();
  async function inTurn(locators, call) {
    const keys = [...new Set(locators.map((locator) => String(locator).toLowerCase()))];
    for (;;) {
      const waits = keys.map((key) => running.get(key)).filter(Boolean);
      if (waits.length === 0) break;
      await Promise.all(waits);
    }
    let free;
    const finished = new Promise((ok) => { free = ok; });
    for (const key of keys) running.set(key, finished);
    try {
      return await call();
    } finally {
      for (const key of keys) running.delete(key);
      free();
    }
  }

  async function gate(req, res) {
    if (!isSameOriginRequest(req)) { refuse(res, 403, 'not_allowed', 'This can only be asked by WILSON itself.'); return null; }
    const root = getWorkspaceRoot();
    if (!root || !isShareRoot(root)) { refuse(res, 409, 'no_drive', 'This company is not on an office server from this computer.'); return null; }
    if (!(await reach.rootReachable(root))) { refuse(res, 503, 'unreachable', OFF); return null; }
    return root;
  }

  async function mayTouch(req, res, locators) {
    const owners = [...new Set(locators.map(personalOwnerOf).filter(Boolean))];
    if (owners.length === 0) return true;
    const verified = await verifyBearer(req.headers?.authorization);
    if (verified.unreachable) { refuse(res, 503, 'cannot_check', 'WILSON could not check who you are just now. Try again.'); return false; }
    if (!verified.userId || owners.some((owner) => owner !== String(verified.userId).toLowerCase())) {
      refuse(res, 403, 'not_your_folder', 'This is somebody else\'s personal space.');
      return false;
    }
    return true;
  }

  // The folders a target needs, each looked at before it is used, so a link planted on the way does not
  // get a folder made through it. Once per folder per request.
  async function ensureDir(root, rel, checked) {
    if (!rel) return true;
    let cur = '';
    for (const segment of rel.split('/')) {
      cur = cur ? `${cur}/${segment}` : segment;
      if (checked.has(cur)) continue;
      const here = await lookAt(at(root, cur));
      if (here && (here.isSymbolicLink() || !here.isDirectory())) return false;
      if (!here) await io(() => fsp.mkdir(at(root, cur))).catch((err) => { if (err.code !== 'EEXIST') throw err; });
      checked.add(cur);
    }
    return true;
  }

  // A catalogue row may be a folder of one frame series (NS-X07), and nothing else that is a folder
  // moves: a folder's contents are not what the row was asked about.
  async function isFrameFolder(dir) {
    const entries = await io(() => fsp.readdir(dir, { withFileTypes: true }));
    if (entries.some((e) => !e.name.startsWith('.') && !e.isFile())) return false;
    return Boolean(classifySequence(entries.filter((e) => !e.name.startsWith('.')).map((e) => e.name), SEQUENCE_EXTS));
  }

  async function onePair(root, pair, checked) {
    const from = typeof pair?.from === 'string' ? pair.from : '';
    const to = typeof pair?.to === 'string' ? pair.to : '';
    const answer = (extra) => ({ from, to, ...extra });
    if (!locatorOk(from, checkShareLocator) || !locatorOk(to, checkShareLocator)) return answer({ ok: false, code: 'bad_locator' });
    try {
      const source = await contain(root, from);
      if (!source.ok) {
        if (source.code !== 'not_there') return answer({ ok: false, code: source.code === 'not_contained' ? 'bad_locator' : source.code });
        // Already at the far end: a repeat of a rename that worked, whose answer was lost, if what is
        // there is what left. A colleague's other file at that name is not, or the row would claim it. A far
        // end that cannot be read says nothing about where the file is, so the row must not go back on it.
        const target = await contain(root, to);
        if (!target.ok) return answer({ ok: false, code: target.code === 'not_there' || target.code === 'unreachable' ? target.code : 'failed' });
        if (target.stat.isFile()) {
          if (Number.isFinite(pair?.size) && target.stat.size !== pair.size) return answer({ ok: false, code: 'not_there' });
          if (!Number.isFinite(pair?.size) && target.stat.size === 0) return answer({ ok: false, code: 'not_verified' });
        }
        return answer({ ok: true, already: true });
      }
      const fromAt = source.abs;
      const toAt = at(root, to);
      const folder = source.stat.isDirectory();
      if (folder ? !(await isFrameFolder(fromAt)) : !source.stat.isFile()) return answer({ ok: false, code: 'not_a_file' });
      const inTheWay = await lookAt(toAt);
      if (inTheWay) {
        // A reservation an interrupted rename left: empty, while the file it was for is still here. A young
        // one may be that rename still under way, so nobody can say yet, and this stays pending.
        if (folder || !inTheWay.isFile() || inTheWay.size !== 0 || source.stat.size === 0) return answer({ ok: false, code: 'name_taken' });
        if (!leftLongAgo(inTheWay)) return answer({ ok: false, code: 'failed' });
        await io(() => fsp.unlink(toAt));
      }
      if (!(await ensureDir(root, parentOf(to), checked))) return answer({ ok: false, code: 'a_link' });
      if (folder) {
        // Windows will not rename over a folder, so there is no reservation to make; it refuses a
        // target that has appeared since, and so does POSIX when that target holds anything.
        await io(() => fsp.rename(fromAt, toAt));
      } else {
        try {
          await reserve(toAt);
        } catch (err) {
          if (err.code === 'EEXIST') return answer({ ok: false, code: 'name_taken' });
          throw err;
        }
        try {
          await io(() => fsp.rename(fromAt, toAt));
        } catch (err) {
          // It may have happened, with only the answer lost: the file is what is at the far end then,
          // and removing that would lose it. Only the empty reservation is ours to clear.
          const stillHere = await lookAt(fromAt);
          const landed = await lookAt(toAt);
          if (stillHere || !landed || landed.size !== source.stat.size) {
            if (stillHere && landed && landed.size === 0) await io(() => fsp.unlink(toAt)).catch(() => {});
            throw err;
          }
        }
      }
      const after = await lookAt(toAt);
      if ((await lookAt(fromAt)) || !after || (!folder && after.size !== source.stat.size)) return answer({ ok: false, code: 'not_verified' });
      // A restore leaves its <id> folder empty, and an empty one must not hold a place in the walk's bin list.
      if (BIN_FILE.test(from)) await io(() => fsp.rmdir(pathImpl.dirname(fromAt))).catch(() => {});
      return answer({ ok: true });
    } catch (err) {
      return answer({ ok: false, code: failure(err) });
    }
  }

  expressApp.get(REACHABLE_ROUTE, async (req, res) => {
    const root = await gate(req, res);
    return root ? res.json({ ok: true }) : undefined;
  });

  // What a person is told before a move is called off, because only a look can say where the file is. A bin's
  // path is looked at too, which the file route will not serve.
  expressApp.post(LOOK_ROUTE, async (req, res) => {
    const root = await gate(req, res);
    if (!root) return undefined;
    const paths = req.body?.paths;
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_PAIRS) {
      return refuse(res, 400, 'bad_request', `Between 1 and ${MAX_PAIRS} files are looked at a time.`);
    }
    if (!(await mayTouch(req, res, paths))) return undefined;
    const results = [];
    for (const rel of paths) {
      if (!locatorOk(rel, checkShareLocator)) {
        results.push({ path: rel, code: 'bad_locator' });
        continue;
      }
      const found = await contain(root, rel);
      if (found.ok) results.push({ path: rel, there: true, size: found.stat.isFile() ? found.stat.size : null });
      else results.push(found.code === 'not_there' ? { path: rel, there: false } : { path: rel, code: found.code });
    }
    return res.json({ results });
  });

  expressApp.post(ROUTE, async (req, res) => {
    const root = await gate(req, res);
    if (!root) return undefined;
    const pairs = req.body?.pairs;
    if (!Array.isArray(pairs) || pairs.length === 0 || pairs.length > MAX_PAIRS) {
      return refuse(res, 400, 'bad_request', `Between 1 and ${MAX_PAIRS} renames are asked at a time.`);
    }
    if (!(await mayTouch(req, res, pairs.flatMap((pair) => [pair?.from, pair?.to])))) return undefined;
    // One at a time, in the order asked: a batch may free a name for a later pair.
    const results = [];
    const checked = new Set();
    for (const pair of pairs) results.push(await inTurn([pair?.from, pair?.to], () => onePair(root, pair, checked)));
    return res.json({ results });
  });

  // A killed copy's temp file is dot-led, so no walk lists it and nothing else would ever remove it. Not waited
  // on, as the add route's is not.
  async function sweepStaleCopies(dir) {
    const cutoff = Date.now() - STALE_UPLOAD_MS;
    for (const name of await io(() => fsp.readdir(dir))) {
      if (!name.startsWith('.wilson-upload-') || !name.endsWith('.tmp')) continue;
      const where = pathImpl.join(dir, name);
      const stat = await lookAt(where);
      if (stat && stat.mtimeMs < cutoff) await io(() => fsp.unlink(where));
    }
  }

  expressApp.post(PUT_ROUTE, async (req, res) => {
    const root = await gate(req, res);
    if (!root) return undefined;
    const to = req.body?.to;
    if (!checkShareLocator(to)) return refuse(res, 400, 'bad_locator', 'WILSON cannot keep a file with this name on the office server.');
    const asked = req.body?.from || {};
    const sourceAt = typeof asked.picked === 'string' && isAuthorizedFile(asked.picked)
      ? asked.picked
      : (typeof asked.media_key === 'string' ? resolveMediaKey(asked.media_key) : null);
    if (!sourceAt) return refuse(res, 403, 'not_allowed_source', 'Pick the file again, then try once more.');
    if (!(await mayTouch(req, res, [to]))) return undefined;
    let tmp = null;
    let reserved = null;
    const removeQuietly = (p) => (p ? io(() => fsp.unlink(p)).catch(() => {}) : Promise.resolve());
    try {
      const source = await fsp.stat(sourceAt).catch(() => null);
      if (!source || !source.isFile()) return refuse(res, 404, 'not_there', NOT_HERE);
      const toAt = at(root, to);
      const inTheWay = await lookAt(toAt);
      if (inTheWay) {
        // A reservation a crash left: empty, where this copy is not. A young one may be a copy finishing.
        if (!inTheWay.isFile() || inTheWay.size !== 0 || source.size === 0) return refuse(res, 409, 'name_taken', 'A file with this name is already there.');
        if (!leftLongAgo(inTheWay)) return refuse(res, 409, 'in_use', 'A file with this name is arriving on the office server just now. Try again in a few minutes.');
        await io(() => fsp.unlink(toAt));
      }
      if (!(await ensureDir(root, parentOf(to), new Set()))) return refuse(res, 403, 'a_link', 'WILSON does not write through a link on the office server.');
      sweepStaleCopies(pathImpl.dirname(toAt)).catch(() => {});
      // Dot-led, so a walk never lists a copy that has not finished. In a worker: as long as the file is big,
      // and a server that stops answering holds that thread and no other.
      tmp = pathImpl.join(pathImpl.dirname(toAt), `.wilson-upload-${crypto.randomUUID()}.tmp`);
      let copied;
      try {
        copied = await copyVerified(sourceAt, tmp, { exclusive: true });
      } catch (err) {
        if (err.code !== 'not_verified') throw err;
        tmp = null;
        return refuse(res, 500, 'not_verified', 'The copy did not arrive whole. Nothing was kept. Try again.');
      }
      try {
        await reserve(toAt);
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        await removeQuietly(tmp);
        tmp = null;
        return refuse(res, 409, 'name_taken', 'A file with this name is already there.');
      }
      reserved = toAt;
      await io(() => fsp.rename(tmp, toAt));
      tmp = null;
      reserved = null;
      // It has arrived, whatever a look at it now says.
      const landed = await lookAt(toAt).catch(() => null);
      return res.status(201).json({
        locator: to,
        size_bytes: landed?.size ?? copied.size,
        modified_at: new Date(landed?.mtimeMs ?? copied.mtimeMs).toISOString(),
      });
    } catch {
      await removeQuietly(tmp);
      await removeQuietly(reserved);
      return refuse(res, 500, 'failed', 'The file could not be copied to the office server. Nothing was kept.');
    }
  });

  // A folder's files, and what a NAS keeps in it (.@__thumb, .AppleDouble) if that holds only files. Read whole
  // before anything is removed: a purge stopped half way leaves a bin entry that can be neither restored nor cleared.
  async function whatIsIn(dir) {
    const entries = await io(() => fsp.readdir(dir, { withFileTypes: true }));
    const files = entries.filter((e) => e.isFile()).map((e) => pathImpl.join(dir, e.name));
    const folders = [];
    for (const entry of entries) {
      if (entry.isFile()) continue;
      if (!entry.isDirectory() || !entry.name.startsWith('.')) return null;
      const inner = pathImpl.join(dir, entry.name);
      const within = await io(() => fsp.readdir(inner, { withFileTypes: true }));
      if (within.some((e) => !e.isFile())) return null;
      files.push(...within.map((e) => pathImpl.join(inner, e.name)));
      folders.push(inner);
    }
    return { dir, files, folders };
  }

  // A bin holds <id>/<leaf>: one file, or one frame folder, and what a NAS keeps beside them. Anything else in it
  // is not WILSON's to remove.
  async function purgeOne(root, rel) {
    const shape = typeof rel === 'string' ? BIN_FOLDER.exec(rel) : null;
    if (!shape || !checkShareLocator(shape[1])) return { path: rel, ok: false, code: 'bad_locator' };
    try {
      const found = await contain(root, rel);
      if (!found.ok) {
        if (found.code === 'not_there') return { path: rel, ok: true, already: true };
        return { path: rel, ok: false, code: found.code };
      }
      if (!found.stat.isDirectory()) return { path: rel, ok: false, code: 'bad_locator' };
      const entries = await io(() => fsp.readdir(found.abs, { withFileTypes: true }));
      const plans = [];
      for (const dir of entries.filter((e) => e.isDirectory())) {
        const inside = pathImpl.join(found.abs, dir.name);
        const plan = dir.name.startsWith('.') || (await isFrameFolder(inside)) ? await whatIsIn(inside) : null;
        if (!plan) return { path: rel, ok: false, code: 'not_a_file' };
        plans.push(plan);
      }
      if (entries.some((e) => !e.isDirectory() && !e.isFile())) return { path: rel, ok: false, code: 'a_link' };
      for (const plan of plans) {
        for (const file of plan.files) await io(() => fsp.unlink(file));
        for (const folder of plan.folders) await io(() => fsp.rmdir(folder));
        await io(() => fsp.rmdir(plan.dir));
      }
      for (const entry of entries) if (entry.isFile()) await io(() => fsp.unlink(pathImpl.join(found.abs, entry.name)));
      await io(() => fsp.rmdir(found.abs));
      return { path: rel, ok: true };
    } catch (err) {
      return { path: rel, ok: false, code: failure(err) };
    }
  }

  expressApp.post(PURGE_ROUTE, async (req, res) => {
    const root = await gate(req, res);
    if (!root) return undefined;
    const paths = req.body?.paths;
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_PAIRS) {
      return refuse(res, 400, 'bad_request', `Between 1 and ${MAX_PAIRS} files are removed at a time.`);
    }
    if (!(await mayTouch(req, res, paths))) return undefined;
    const results = [];
    for (const rel of paths) results.push(await purgeOne(root, rel));
    return res.json({ results });
  });

  expressApp.get(`${FILE_ROUTE}/*locator`, async (req, res) => {
    const root = await gate(req, res);
    if (!root) return undefined;
    const raw = req.params.locator;
    const locator = Array.isArray(raw) ? raw.join('/') : String(raw ?? '');
    if (!checkShareLocator(locator)) return refuse(res, 404, 'not_there', NOT_HERE);
    const found = await contain(root, locator);
    if (!found.ok) return found.code === 'unreachable' ? refuse(res, 503, 'unreachable', OFF) : refuse(res, 404, 'not_there', NOT_HERE);
    if (!found.stat.isFile()) return refuse(res, 404, 'not_there', NOT_HERE);
    const leaf = locator.split('/').pop();
    res.setHeader('Content-Type', safeMediaContentType(mimeForLeaf(leaf)));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    attachWhenAsked(req, res, leaf, contentDisposition);
    // A <video> aborts range requests on every seek, so an aborted send is the normal case here.
    return res.sendFile(found.abs, { dotfiles: 'allow' }, (err) => {
      if (err && !res.headersSent) res.status(err.statusCode || 500).end();
    });
  });
}

// What rabbit:open-path asks before it reveals or opens a file on the drive (NS-X06): never a sync call.
function makeShareLocate({ getWorkspaceRoot, checkShareLocator, reach, contain, isShareRoot = isShareRootReal }) {
  return async (locator) => {
    const root = getWorkspaceRoot();
    if (!root || !isShareRoot(root) || !checkShareLocator(locator)) return { ok: false, error: NOT_HERE };
    if (!(await reach.rootReachable(root))) return { ok: false, error: OFF };
    const found = await contain(root, locator);
    if (!found.ok) return { ok: false, error: found.code === 'unreachable' ? OFF : NOT_HERE };
    return { ok: true, diskPath: found.abs, isFile: found.stat.isFile() };
  };
}

module.exports = { mountNetworkShareOps, makeShareLocate, ROUTE, REACHABLE_ROUTE, LOOK_ROUTE, PUT_ROUTE, PURGE_ROUTE, FILE_ROUTE };
