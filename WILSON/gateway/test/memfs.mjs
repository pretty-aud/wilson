// =============================================================================
// A small in-memory file system for the updater's state machine (the brief:
// "prove the updater's swap as a state machine over a fake file system").
// Windows paths, case-insensitive like NTFS, the fs.promises subset swap.mjs
// and tar.mjs use. Every operation is recorded so a test can assert ORDER.
// =============================================================================

import path from 'node:path';

const P = path.win32;
const key = (p) => P.normalize(p).replace(/[\\]+$/, '').toLowerCase();

export function memfs(initial = {}) {
  const nodes = new Map(); // key → { type: 'dir'|'file', name, data }
  const log = [];
  const err = (code, p) => Object.assign(new Error(`${code}: ${p}`), { code });
  const parentOf = (p) => P.dirname(P.normalize(p));
  const ensureDir = (p) => {
    const parts = [];
    let cur = P.normalize(p).replace(/[\\]+$/, '');
    while (cur && !nodes.has(key(cur))) { parts.unshift(cur); const up = P.dirname(cur); if (up === cur) break; cur = up; }
    for (const d of parts) nodes.set(key(d), { type: 'dir', name: d });
  };
  for (const [p, data] of Object.entries(initial)) {
    if (data === null) ensureDir(p);
    else { ensureDir(parentOf(p)); nodes.set(key(p), { type: 'file', name: P.normalize(p), data: Buffer.from(data) }); }
  }
  const under = (k) => [...nodes.keys()].filter((n) => n === k || n.startsWith(k + '\\'));
  const fsp = {
    async stat(p) { const n = nodes.get(key(p)); if (!n) throw err('ENOENT', p); return { isFile: () => n.type === 'file', isDirectory: () => n.type === 'dir', size: n.data?.length ?? 0 }; },
    async readFile(p, enc) { const n = nodes.get(key(p)); if (!n || n.type !== 'file') throw err('ENOENT', p); log.push(['read', P.normalize(p)]); return enc ? n.data.toString(enc) : Buffer.from(n.data); },
    async writeFile(p, data) { if (!nodes.has(key(parentOf(p)))) throw err('ENOENT', p); log.push(['write', P.normalize(p)]); nodes.set(key(p), { type: 'file', name: P.normalize(p), data: Buffer.from(data) }); },
    async appendFile(p, data) { const n = nodes.get(key(p)); const prev = n ? n.data : Buffer.alloc(0); nodes.set(key(p), { type: 'file', name: P.normalize(p), data: Buffer.concat([prev, Buffer.from(data)]) }); },
    async mkdir(p) { log.push(['mkdir', P.normalize(p)]); ensureDir(p); },
    async rm(p, o = {}) {
      const k = key(p); const all = under(k);
      if (all.length === 0) { if (o.force) return; throw err('ENOENT', p); }
      if (nodes.get(k)?.type === 'dir' && all.length > 1 && !o.recursive) throw err('ENOTEMPTY', p);
      log.push(['rm', P.normalize(p)]);
      for (const n of all) nodes.delete(n);
    },
    async rename(a, b) {
      const ka = key(a); const kb = key(b);
      if (!nodes.has(ka)) throw err('ENOENT', a);
      if (nodes.has(kb) && nodes.get(kb).type === 'dir') throw err('EPERM', b); // Windows: no rename over a directory
      if (!nodes.has(key(parentOf(b)))) throw err('ENOENT', b);
      log.push(['rename', P.normalize(a), P.normalize(b)]);
      for (const n of under(ka)) { const node = nodes.get(n); nodes.delete(n); const rest = n.slice(ka.length); nodes.set(kb + rest, { ...node, name: P.normalize(b) + node.name.slice(P.normalize(a).replace(/[\\]+$/, '').length) }); }
    },
    async chmod() {},
  };
  return {
    fsp,
    log,
    exists: (p) => nodes.has(key(p)),
    read: (p) => nodes.get(key(p))?.data?.toString('utf8') ?? null,
    list: (dir) => under(key(dir)).filter((k) => k !== key(dir)).map((k) => nodes.get(k).name).sort(),
    plant: (p, data) => { ensureDir(parentOf(p)); nodes.set(key(p), { type: 'file', name: P.normalize(p), data: Buffer.from(data) }); },
  };
}
