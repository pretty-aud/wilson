// =============================================================================
// Resources/fileTree.js — a project's folders and files as ONE tree (demo
// 2026-09-11), pure so the explorer's two views are tested without React.
//
// Audrey, 2026-09-11: "allow me to choose a project and have a way to view
// folders and files. it should look something like window explorer. have a
// way to view all files and folder in one table, and also have a view that
// works like the column system in finder for mac os."
//
// Inputs are the rows both backends already return — `folders` (0041's
// tree, planned by folderPaths.js on both sides: kind root/category/entity,
// parent_id, path), `files` (public.files / the local bundle's files) and,
// on the Local Server, `managedFiles` (the assets' managed files, placed by
// their folder_path). A file lands in its folder by folder_id when it has
// one (0043), else by the entity it belongs to (the folder row that carries
// the same asset_id / scene_id / shot_id / level_id / experience_id), else
// at the root. Nothing is dropped: a file whose folder is unknown is still
// listed, at the root, rather than hidden.
// =============================================================================

import { fileTypeLabel, mediaKind } from '../../tools/rabbit_v0.1.0/storage/mediaMetadata'

export const ROOT_ID = '__root__'
const ENTITY_FKS = ['asset_id', 'scene_id', 'shot_id', 'level_id', 'experience_id']

function lastSegment(p) {
  const s = String(p || '').replace(/[\\/]+$/, '')
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  return i === -1 ? s : s.slice(i + 1)
}

function norm(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase()
}

function byName(a, b) {
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
  return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base', numeric: true })
}

function folderNode(row) {
  const isRoot = row.kind === 'root' || norm(row.path) === ''
  return {
    id: String(row.id),
    kind: 'folder',
    name: row.name || (isRoot ? 'Project' : lastSegment(row.path)) || 'Folder',
    path: norm(row.path),
    parentId: row.parent_id ? String(row.parent_id) : null,
    folderKind: row.kind || null,
    isRoot,
    row,
    children: [],
  }
}

function fileMeta(row, source) {
  return {
    type: fileTypeLabel(row),
    kind: mediaKind(row),
    sizeBytes: row.size_bytes ?? null,
    createdAt: row.created_at || row.uploaded_at || row.added_at || null,
    modifiedAt: row.source_modified_at || null,
    durationSec: row.duration_sec ?? null,
    provider: row.storage_provider || (source === 'managed' ? 'local_managed' : null),
    source,
  }
}

/**
 * @returns {{ root, byId: Map, folderCount: number, fileCount: number }}
 */
export function buildFileTree({ folders = [], files = [], managedFiles = [] } = {}) {
  const byId = new Map()
  const folderNodes = (folders || []).map(folderNode)
  let root = folderNodes.find(n => n.isRoot) || null
  if (!root) {
    root = { id: ROOT_ID, kind: 'folder', name: 'Project', path: '', parentId: null, folderKind: 'root', isRoot: true, row: null, children: [] }
  }
  byId.set(root.id, root)
  for (const n of folderNodes) if (n !== root) byId.set(n.id, n)
  // parents: by parent_id, else by the path's parent, else the root
  const byPath = new Map()
  for (const n of folderNodes) if (!n.isRoot) byPath.set(n.path, n)
  for (const n of folderNodes) {
    if (n === root) continue
    let parent = n.parentId ? byId.get(n.parentId) : null
    if (!parent && n.path.includes('/')) parent = byPath.get(n.path.slice(0, n.path.lastIndexOf('/')))
    if (!parent || parent === n) parent = root
    n.parent = parent
    parent.children.push(n)
  }
  const findByFk = (fk, value) => folderNodes.find(n => n.row && n.row[fk] && String(n.row[fk]) === String(value))
  const place = (node, parent) => {
    node.parent = parent
    node.path = parent.path ? `${parent.path}/${norm(node.name)}` : norm(node.name)
    parent.children.push(node)
    byId.set(node.id, node)
  }
  let fileCount = 0
  for (const row of files || []) {
    if (!row || row.deleted_at) continue
    let parent = row.folder_id ? byId.get(String(row.folder_id)) : null
    if (!parent) {
      for (const fk of ENTITY_FKS) {
        if (row[fk]) { parent = findByFk(fk, row[fk]); if (parent) break }
      }
    }
    place({ id: `f:${row.id}`, kind: 'file', name: row.name || row.storage_path || 'file', row, meta: fileMeta(row, 'files'), children: [] }, parent || root)
    fileCount += 1
  }
  for (const row of managedFiles || []) {
    if (!row || row.deleted_at) continue
    const fp = norm(row.folder_path)
    let parent = fp ? byPath.get(fp) : null
    if (!parent && fp) {
      // the managed folder_path is SLUG-shaped (ASSETS/hero-shot/); a folder
      // row whose path ends the same way is the same folder
      parent = folderNodes.find(n => !n.isRoot && (n.path === fp || n.path.endsWith(`/${fp}`) || fp.endsWith(`/${n.path}`)))
    }
    place({ id: `m:${row.id}`, kind: 'file', name: row.file_name || row.original_name || row.stored_name || 'file', row, meta: fileMeta(row, 'managed'), children: [] }, parent || root)
    fileCount += 1
  }
  const sortRec = (n) => { n.children.sort(byName); n.children.forEach(sortRec) }
  sortRec(root)
  return { root, byId, folderCount: folderNodes.filter(n => n !== root).length, fileCount }
}

/** Every node under the root, depth-first, with its depth — the table view. */
export function flattenTree(root) {
  const out = []
  const walk = (n, depth) => {
    for (const c of n.children) {
      out.push({ node: c, depth })
      if (c.kind === 'folder') walk(c, depth + 1)
    }
  }
  if (root) walk(root, 0)
  return out
}

/** Case-insensitive name filter over the flattened tree; folders whose
 *  descendants match are kept so the path stays readable. */
export function filterFlat(rows, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return rows
  const keep = new Set()
  for (const r of rows) {
    if (String(r.node.name).toLowerCase().includes(q) || String(r.node.path).toLowerCase().includes(q)) {
      keep.add(r.node)
      let p = r.node.parent
      while (p) { keep.add(p); p = p.parent }
    }
  }
  return rows.filter(r => keep.has(r.node))
}

/**
 * The Finder-style columns: column 0 is the root's children; each selected
 * folder id (in order) opens its children in the next column. A selection
 * that is not a folder in the previous column ends the walk.
 */
export function columnsFor(root, selectedIds = []) {
  const cols = []
  let current = root
  cols.push({ folder: root, items: root ? root.children : [] })
  for (const id of selectedIds) {
    const next = current ? current.children.find(c => c.id === id) : null
    if (!next || next.kind !== 'folder') break
    cols.push({ folder: next, items: next.children })
    current = next
  }
  return cols
}

/** "ASSETS › hero-shot › clip.mov" for the details panel. */
export function breadcrumb(node) {
  const parts = []
  let n = node
  while (n && !n.isRoot) { parts.unshift(n.name); n = n.parent }
  return parts.join(' › ')
}

export function sortRows(rows, key, dir = 'asc') {
  const sign = dir === 'desc' ? -1 : 1
  const val = (r) => {
    const m = r.node.meta || {}
    switch (key) {
      case 'name': return String(r.node.name).toLowerCase()
      case 'type': return r.node.kind === 'folder' ? '' : String(m.type || '').toLowerCase()
      case 'size': return m.sizeBytes ?? -1
      case 'created': return m.createdAt || ''
      case 'modified': return m.modifiedAt || ''
      case 'duration': return m.durationSec ?? -1
      case 'path': return String(r.node.path).toLowerCase()
      default: return ''
    }
  }
  return [...rows].sort((a, b) => {
    const va = val(a); const vb = val(b)
    if (va < vb) return -1 * sign
    if (va > vb) return 1 * sign
    return byName(a.node, b.node)
  })
}
