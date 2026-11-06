// =============================================================================
// networkShare.cjs — the desktop's hands on a company's office server (M.O.T.H.
// Session 1, docs/design/MOTH_DESIGN.md §2.2 PS-7, §2.4 NS-D7).
//
// Her answer 3, verbatim "Yes, say so": a personal space in an office-server company
// keeps its files on that server. The cloud never sees a body: the renderer copies a
// file here, and then tells the catalogue (network_share_record_added, or a walk
// through network_share_catalogue_apply, 0117). This module's first route is that copy:
//
//   POST /api/network-share/personal-space/files
//        ?root=<the drive>&folder=<locator>&name=<file name>&sizeBytes=<n>
//        body: the bytes, application/octet-stream
//
// §1.2 item e settled the folder: _WILSON_PERSONAL/<owner uuid>, computed in the
// database by network_share_space_folder, and checked here against the person signed
// in. The renderer holds the launch token, so this check is not a wall against it: it
// stops a stale or mistaken call from writing into somebody else's folder, on a server
// where the only thing keeping that folder theirs is its name. A page that is not WILSON's
// cannot push the id (ipcGate) or call this (same origin, launch token), and sign-out
// clears it; script running on WILSON's own page can still name someone else's id, which
// is why the walk's route must take the id from a verified token before it ships. The
// drive has to be the one the signed-in renderer pushed, so a laptop with an old root
// writes nothing.
//
// File work is async and bounded: a dead SMB path can hang a synchronous call for the
// OS timeout and freeze the window (bins, measured). The temp file sits beside its final
// path, dot-led so a walk never lists it. A file is never overwritten: its name is
// reserved with an exclusive create, which is atomic on both Windows and POSIX, and the
// next free ' (2)' is taken instead.
//
// The rest of the design's routes (walk, file, op, put, purge) land with the client
// changes that call them, in this module. A route or guard that runs ahead of a route in
// main.cjs goes in its own module, because tests lift those bodies (hand-off §5).
// =============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isSameOriginRequest } = require('./fileReads.cjs');
const { makeContainment } = require('./pathContainment.cjs');

const ROUTE = '/api/network-share/personal-space/files';
const PERSONAL_PARENT = '_WILSON_PERSONAL';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REACH_WAIT_MS = 3000;
const MAX_NAME_TRIES = 999;
// An add takes as long as the server takes, so main.cjs lifts Node's request limit. What
// ends a dead one is this: nothing moved on the connection for two minutes.
const STALL_MS = 120000;
// What a killed add left behind, removed at this person's next add. Young ones may be
// another add's, still writing.
const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;
const LOCATOR_MAX_BYTES = 2000;

// The two lists network_share_locator_ok holds: rabbit_money_segment's names, and the
// suffixes of the folders a project's money sits in. networkShare.routes.test.js holds
// them equal to the SQL's text.
const SHARE_REFUSED_EXACT = ['INVOICES', 'FINANCE', 'LEGAL'];
const SHARE_REFUSED_SUFFIX = ['_RECEIPTS&INVOICES', '_CREWINVOICES', '_TALENTINVOICES', '_DATABASES'];

// A backslash, a stream or drive colon, what Windows refuses in a name, the C0 and C1
// controls, and what makes a name read as something else: bidi marks, zero-width marks,
// the BOM, variation selectors and TAG code points. network_share_path_shape_ok's class.
const REFUSED_CHARS = /[\\:*?"<>|\u0001-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufe00-\ufe0f\ufeff\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/u;

// A short name: Windows and Samba can answer to '_WILSO~1' for a longer folder, and every
// name test would read it as some other folder. network_share_path_shape_ok's.
const SHORT_NAME = /(^|\/)[^./~]{1,6}~[0-9a-zA-Z]{1,3}([.][^./]{0,3})?(\/|$)/u;

// Device names Windows opens as devices, with or without an extension. A walk could not
// find a file called this; the add route must not make one.
const DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/** The JS twin of network_share_locator_ok (0117): can this path be a locator at all? */
function checkShareLocator(p) {
  if (typeof p !== 'string' || p === '') return false;
  if (Array.from(p).length > 1024) return false;
  if (Buffer.byteLength(p, 'utf8') > LOCATOR_MAX_BYTES) return false;
  if (p.normalize('NFC') !== p) return false;
  if (/^\/|\/$|\/\//.test(p)) return false;
  if (REFUSED_CHARS.test(p)) return false;
  if (/(^|\/)\./.test(p)) return false;
  if (/[. ](\/|$)/.test(p)) return false;
  if (SHORT_NAME.test(p)) return false;
  for (const seg of p.split('/')) {
    const upper = seg.toUpperCase();
    if (SHARE_REFUSED_EXACT.includes(upper)) return false;
    if (SHARE_REFUSED_SUFFIX.some((suffix) => upper.endsWith(suffix))) return false;
  }
  return true;
}

// 'clip.mov' → 'clip (2).mov'; a name with no extension, or only a leading dot, keeps
// the number at its end.
function numberedName(name, n) {
  if (n === 1) return name;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return `${name} (${n})`;
  return `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
}

// The body into the temp file, closed before this settles. Not stream.pipeline: when a write
// fails it destroys the request, and with it the socket the answer has to go back on. The stall
// watch stops when the body has all arrived, because from then on Node would close the socket
// without telling the request.
function writeBody(req, out, stallMs) {
  return new Promise((resolve, reject) => {
    let failure = null;
    const fail = (err) => {
      if (!failure) failure = err || new Error('aborted');
      req.unpipe(out);
      out.destroy();
    };
    out.on('error', fail);
    req.on('error', fail);
    req.on('close', () => { if (!req.complete) fail(new Error('aborted')); });
    out.on('close', () => { if (failure) reject(failure); else resolve(); });
    req.setTimeout(stallMs, () => req.destroy(new Error('stalled')));
    req.once('end', () => req.setTimeout(0));
    req.pipe(out);
  });
}

function refuse(res, status, code, error) {
  // The body may be huge and is not wanted. Say so, and close.
  res.setHeader('Connection', 'close');
  res.status(status).json({ error, code });
}

function mountNetworkShare(expressApp, {
  getWorkspaceRoot,
  getSignedInUserId,
  // Seams for the tests: a UNC path cannot exist on the runner.
  isShareRoot = (root) => /^[\\/]{2}/.test(root),
  fsp = fs.promises,
  createWriteStream = fs.createWriteStream,
  pathImpl = path,
  reachWaitMs = REACH_WAIT_MS,
  stallMs = STALL_MS,
  staleUploadMs = STALE_UPLOAD_MS,
  log = () => {},
} = {}) {
  for (const [name, fn] of Object.entries({ getWorkspaceRoot, getSignedInUserId })) {
    if (typeof fn !== 'function') throw new Error(`mountNetworkShare: ${name} is required`);
  }
  const { resolveContainedFilePath } = makeContainment(pathImpl);
  const samePath = (a, b) => pathImpl.resolve(a).toLowerCase() === pathImpl.resolve(b).toLowerCase();

  // Is the server there? The race bounds the wait, not the call: a dead SMB path can
  // hold a stat for the OS timeout, and nothing here waits for it.
  async function rootReachable(root) {
    let timer;
    const timedOut = new Promise((resolve) => { timer = setTimeout(() => resolve(false), reachWaitMs); });
    const stat = fsp.stat(root).then((s) => s.isDirectory(), () => false);
    try {
      return await Promise.race([stat, timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }

  // A killed add's temp file is dot-led, so no walk lists it and nothing else would ever
  // remove it. Not waited on: an add does not depend on this.
  async function sweepStaleUploads(dir) {
    const cutoff = Date.now() - staleUploadMs;
    for (const entry of await fsp.readdir(dir)) {
      if (!entry.startsWith('.wilson-upload-') || !entry.endsWith('.tmp')) continue;
      const stat = await fsp.stat(pathImpl.join(dir, entry));
      if (stat.mtimeMs < cutoff) await fsp.unlink(pathImpl.join(dir, entry));
    }
  }

  expressApp.post(ROUTE, async (req, res) => {
    // Same origin, failing closed. The launch token has been asked for already: every
    // /api path is behind it (localToken.cjs).
    if (!isSameOriginRequest(req)) return refuse(res, 403, 'forbidden', 'Forbidden.');

    const q = req.query || {};
    const wantRoot = typeof q.root === 'string' ? q.root.trim() : '';
    const root = getWorkspaceRoot();
    // A UNC drive, before any fs call, and the one the signed-in renderer pushed.
    if (!root || !isShareRoot(root)) {
      return refuse(res, 409, 'no_drive', 'This company does not keep its files on an office server.');
    }
    if (wantRoot.toLowerCase() !== String(root).toLowerCase()) {
      return refuse(res, 409, 'drive_changed', 'The office server\'s address has changed. Sign in again and try once more.');
    }

    // Exactly the signed-in person's own folder, whatever else the call says.
    const userId = getSignedInUserId();
    const folder = typeof q.folder === 'string' ? q.folder : '';
    if (!userId || !UUID_RE.test(userId) || folder !== `${PERSONAL_PARENT}/${userId}`) {
      return refuse(res, 403, 'not_your_folder', 'Files can be added only to your own personal space.');
    }

    const name = typeof q.name === 'string' ? q.name.normalize('NFC') : '';
    if (!name || name.includes('/') || DEVICE_NAME.test(name) || !checkShareLocator(`${folder}/${name}`)) {
      return refuse(res, 400, 'bad_name', 'WILSON cannot keep a file with this name on the office server. Rename it and try again.');
    }

    const sizeBytes = /^[0-9]{1,15}$/.test(String(q.sizeBytes ?? '')) ? Number(q.sizeBytes) : null;
    if (sizeBytes === null) return refuse(res, 400, 'bad_size', 'The file\'s size is missing.');

    if (!(await rootReachable(root))) {
      return refuse(res, 503, 'server_off', 'The office server cannot be reached from this computer right now.');
    }

    const dir = resolveContainedFilePath(root, folder);
    if (!dir || pathImpl.resolve(dir).toLowerCase() === pathImpl.resolve(root).toLowerCase()) {
      return refuse(res, 403, 'not_your_folder', 'Files can be added only to your own personal space.');
    }

    let tmp = null;
    let reserved = null;
    // True when nothing is left at the path, so a sentence can say so honestly.
    const removeQuietly = async (p) => {
      if (!p) return true;
      try {
        await fsp.unlink(p);
        return true;
      } catch (err) {
        return Boolean(err && err.code === 'ENOENT');
      }
    };
    const LEFT_BEHIND = 'The file did not finish, and part of it may still be in your personal space on the office server. Try again.';
    try {
      // Exactly this person's folder, on disk as well as written. A link or junction planted
      // in the share must not carry the file anywhere else, inside the drive or out of it, and
      // one on the parent must not get a folder made for it.
      const realRoot = await fsp.realpath(root);
      const realParent = await fsp.realpath(pathImpl.dirname(dir)).catch((err) => {
        if (err && err.code === 'ENOENT') return null;
        throw err;
      });
      if (realParent !== null && !samePath(realParent, pathImpl.join(realRoot, PERSONAL_PARENT))) {
        return refuse(res, 403, 'not_your_folder', 'Files can be added only to your own personal space.');
      }
      await fsp.mkdir(dir, { recursive: true });
      const realDir = await fsp.realpath(dir);
      if (!samePath(realDir, pathImpl.join(realRoot, PERSONAL_PARENT, userId))) {
        return refuse(res, 403, 'not_your_folder', 'Files can be added only to your own personal space.');
      }
      sweepStaleUploads(dir).catch(() => {});

      tmp = pathImpl.join(dir, `.wilson-upload-${crypto.randomUUID()}.tmp`);
      const out = createWriteStream(tmp, { flags: 'wx' });
      await writeBody(req, out, stallMs);
      // Whoever sent it has gone, so nobody will be told where it landed. A retry would make a
      // second copy.
      if (req.socket?.destroyed) throw new Error('the connection has gone');
      if (out.bytesWritten !== sizeBytes) {
        const clean = await removeQuietly(tmp);
        tmp = null;
        return refuse(res, 400, 'size_mismatch', clean ? 'The file did not arrive whole. Nothing was kept. Try again.' : LEFT_BEHIND);
      }

      // Never overwrite: an exclusive create reserves the name, and the rename replaces
      // only that empty reservation.
      let finalName = null;
      for (let n = 1; n <= MAX_NAME_TRIES && !finalName; n += 1) {
        const candidate = numberedName(name, n);
        if (!checkShareLocator(`${folder}/${candidate}`)) break;
        try {
          const handle = await fsp.open(pathImpl.join(dir, candidate), 'wx');
          await handle.close();
          finalName = candidate;
          reserved = pathImpl.join(dir, candidate);
        } catch (err) {
          if (err && err.code === 'EEXIST') continue;
          throw err;
        }
      }
      if (!finalName) {
        const clean = await removeQuietly(tmp);
        tmp = null;
        return refuse(res, 409, 'name_taken', clean ? 'Too many files here already have this name. Rename it and try again.' : LEFT_BEHIND);
      }

      await fsp.rename(tmp, reserved);
      tmp = null;
      // The folder could have been swapped for a link since the check above.
      if (!samePath(await fsp.realpath(reserved), pathImpl.join(realDir, finalName))) {
        const clean = await removeQuietly(reserved);
        reserved = null;
        return refuse(res, 403, 'not_your_folder', clean ? 'Files can be added only to your own personal space.' : LEFT_BEHIND);
      }
      const stat = await fsp.stat(reserved);
      if (stat.size !== sizeBytes) {
        const clean = await removeQuietly(reserved);
        reserved = null;
        return refuse(res, 500, 'size_mismatch', clean ? 'The file did not arrive whole. Nothing was kept. Try again.' : LEFT_BEHIND);
      }
      reserved = null;
      return res.status(201).json({
        locator: `${folder}/${finalName}`,
        name: finalName,
        sizeBytes,
        modifiedAt: stat.mtime.toISOString(),
      });
    } catch (err) {
      const [cleanTmp, cleanReserved] = await Promise.all([removeQuietly(tmp), removeQuietly(reserved)]);
      // Said without the file's name or the path.
      log(`[network-share] an add failed: ${err && err.code ? err.code : 'error'}`);
      // The connection, not the request: a request read to its end is already destroyed, and
      // whoever sent it is still waiting for an answer.
      if (res.headersSent || res.destroyed || req.socket?.destroyed) return undefined;
      return refuse(res, 500, 'write_failed', cleanTmp && cleanReserved
        ? 'The file could not be written to the office server. Nothing was kept.'
        : LEFT_BEHIND);
    }
  });
}

module.exports = {
  mountNetworkShare,
  checkShareLocator,
  SHARE_REFUSED_EXACT,
  SHARE_REFUSED_SUFFIX,
};
