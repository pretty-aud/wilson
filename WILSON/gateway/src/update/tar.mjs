// =============================================================================
// The Windows artefact's container: a gzipped POSIX ustar archive (node.exe
// and the gateway's files), because Node has no archive reader and the
// gateway takes no dependency on the request path or anywhere else. Only what
// a release needs is accepted: regular files and directories, under safe
// relative names. A link, a device, a PAX or GNU extension header, an
// absolute name, a '..' segment, a backslash, a drive letter, a NUL, a bad
// checksum or a size past the caps refuses the WHOLE archive: the updater
// swaps all of it or none of it. GW4's pipeline makes it with
// `tar --format=ustar -czf`.
// =============================================================================

import zlib from 'node:zlib';
import path from 'node:path';

const BLOCK = 512;
export const MAX_UNPACKED = 768 * 1024 * 1024;
export const MAX_ENTRIES = 20_000;

const str = (buf, start, len) => {
  const raw = buf.subarray(start, start + len);
  const nul = raw.indexOf(0);
  return raw.subarray(0, nul < 0 ? raw.length : nul).toString('utf8');
};
const octal = (buf, start, len) => {
  const s = str(buf, start, len).trim();
  if (!/^[0-7]*$/.test(s)) return NaN;
  return s === '' ? 0 : parseInt(s, 8);
};

/** A safe relative POSIX name, or null. */
export function safeEntryName(name) {
  if (typeof name !== 'string' || !name || name.length > 255) return null;
  if (name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) return null;
  const segs = name.split('/').filter((s, i, a) => !(s === '' && i === a.length - 1)); // a trailing slash on a dir
  if (segs.length === 0 || segs.some((s) => s === '' || s === '.' || s === '..' || /[\u0000-\u001f]/.test(s))) return null;
  return segs.join('/');
}

/** @returns {Array<{ name: string, type: 'file'|'dir', data?: Buffer, mode: number }>} */
export function readTar(input, { gzip = true } = {}) {
  const buf = gzip ? zlib.gunzipSync(input, { maxOutputLength: MAX_UNPACKED }) : Buffer.from(input);
  const out = [];
  let off = 0;
  let total = 0;
  while (off + BLOCK <= buf.length) {
    const h = buf.subarray(off, off + BLOCK);
    if (h.every((b) => b === 0)) return out; // the end marker
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i];
    if (octal(h, 148, 8) !== sum) throw new Error('tar: bad header checksum');
    const magic = str(h, 257, 6);
    if (magic !== 'ustar') throw new Error('tar: not a ustar archive');
    const type = String.fromCharCode(h[156] || 0x30);
    const prefix = str(h, 345, 155);
    const rawName = prefix ? `${prefix}/${str(h, 0, 100)}` : str(h, 0, 100);
    const size = octal(h, 124, 12);
    const mode = octal(h, 100, 8) & 0o777;
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('tar: bad size');
    if (type !== '0' && type !== '5') throw new Error(`tar: entry type ${JSON.stringify(type)} refused (${rawName})`);
    const name = safeEntryName(rawName);
    if (!name) throw new Error(`tar: unsafe name ${JSON.stringify(rawName)}`);
    if (out.length >= MAX_ENTRIES) throw new Error('tar: too many entries');
    off += BLOCK;
    if (type === '5') {
      if (size !== 0) throw new Error('tar: a directory with a size');
      out.push({ name, type: 'dir', mode });
      continue;
    }
    if (off + size > buf.length) throw new Error('tar: truncated');
    total += size;
    if (total > MAX_UNPACKED) throw new Error('tar: too large');
    out.push({ name, type: 'file', data: Buffer.from(buf.subarray(off, off + size)), mode });
    off += Math.ceil(size / BLOCK) * BLOCK;
  }
  throw new Error('tar: no end marker');
}

/** Writes a ustar archive (the release pipeline's shape; used by the tests). */
export function writeTar(entries, { gzip = true } = {}) {
  const blocks = [];
  for (const e of entries) {
    const h = Buffer.alloc(BLOCK);
    const data = e.type === 'dir' ? Buffer.alloc(0) : Buffer.from(e.data || '');
    let name = e.name + (e.type === 'dir' && !e.name.endsWith('/') ? '/' : '');
    let prefix = '';
    if (Buffer.byteLength(name) > 100) { const cut = name.lastIndexOf('/', name.length - 2); prefix = name.slice(0, cut); name = name.slice(cut + 1); }
    h.write(name, 0, 100, 'utf8');
    h.write(((e.mode ?? (e.type === 'dir' ? 0o755 : 0o644)) & 0o777).toString(8).padStart(7, '0') + '\0', 100, 8, 'ascii');
    h.write('0000000\0', 108, 8, 'ascii');
    h.write('0000000\0', 116, 8, 'ascii');
    h.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
    h.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136, 12, 'ascii');
    h.write('        ', 148, 8, 'ascii');
    h[156] = (e.typeflag ?? (e.type === 'dir' ? '5' : '0')).charCodeAt(0);
    if (e.linkname) h.write(e.linkname, 157, 100, 'utf8');
    h.write('ustar\0', 257, 6, 'ascii');
    h.write('00', 263, 2, 'ascii');
    if (prefix) h.write(prefix, 345, 155, 'utf8');
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += h[i];
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    blocks.push(h, data, Buffer.alloc((BLOCK - (data.length % BLOCK)) % BLOCK));
  }
  blocks.push(Buffer.alloc(BLOCK * 2));
  const tar = Buffer.concat(blocks);
  return gzip ? zlib.gzipSync(tar) : tar;
}

/** Writes entries under `dir` (which must exist and be empty), never outside it. */
export async function extractTo(entries, dir, fsp) {
  const root = path.resolve(dir);
  for (const e of entries) {
    const target = path.resolve(root, ...e.name.split('/'));
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error('tar: entry escapes the target');
    if (e.type === 'dir') await fsp.mkdir(target, { recursive: true });
    else {
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, e.data, { mode: e.mode & 0o111 ? 0o755 : 0o644 });
    }
  }
}
