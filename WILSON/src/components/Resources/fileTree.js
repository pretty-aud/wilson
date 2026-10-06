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
import { tagsMatch, isLegalFile, LEGAL_SEGMENT } from '../../tools/rabbit_v0.1.0/fileTags'

export const ROOT_ID = '__root__'

/**
 * Post-overhaul S4b (0088): Legal files sit in a LEGAL folder under the
 * project. There is no folder ROW for it — 0041's CHECK has no category for
 * it, and a row made when the first Legal file arrived would tell every
 * member that one had — so the tree draws this node from the Legal rows it
 * was GIVEN. A member is never given one (RLS on the cloud, the fixtures'
 * money gate), so a member never sees the folder at all: nothing about it,
 * not even that it exists, depends on what they cannot see.
 */
export const LEGAL_FOLDER_ID = '__legal__'
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
  // S4b: the LEGAL node, made only when a Legal row is here to sit in it.
  let legalNode = null
  const legalFolder = () => {
    if (legalNode) return legalNode
    legalNode = {
      id: LEGAL_FOLDER_ID, kind: 'folder', name: LEGAL_SEGMENT, path: norm(LEGAL_SEGMENT),
      parentId: root.id, folderKind: 'category', isRoot: false, isLegal: true, row: null, children: [],
      parent: root,
    }
    root.children.push(legalNode)
    byId.set(legalNode.id, legalNode)
    return legalNode
  }
  for (const row of files || []) {
    if (!row || row.deleted_at) continue
    if (isLegalFile(row)) {
      place({ id: `f:${row.id}`, kind: 'file', name: row.name || row.storage_path || 'file', row, meta: fileMeta(row, 'files'), children: [] }, legalFolder())
      fileCount += 1
      continue
    }
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
    if (!parent) {
      // S4c review round 2 (item 3): a record whose folder_path names no row
      // — its entity's folder was renamed, and on the Local Server a rename
      // moves the rows and leaves the directory and the records where they
      // are — belongs to its entity's folder, as a cloud row does. Without
      // this, renaming a scene dropped every shot's files to the root here.
      for (const fk of ENTITY_FKS) {
        if (row[fk]) { parent = findByFk(fk, row[fk]); if (parent) break }
      }
    }
    place({ id: `m:${row.id}`, kind: 'file', name: row.file_name || row.original_name || row.stored_name || 'file', row, meta: fileMeta(row, 'managed'), children: [] }, parent || root)
    fileCount += 1
  }
  const sortRec = (n) => { n.children.sort(byName); n.children.forEach(sortRec) }
  sortRec(root)
  return { root, byId, folderCount: folderNodes.filter(n => n !== root).length + (legalNode ? 1 : 0), fileCount }
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

/** Case-insensitive name filter over the flattened tree: the search. Since
 *  post-overhaul S4a a file also matches by one of its tags ("shots",
 *  "Legal"; Finance from is_financial) — E10's filter. Post-overhaul S4c:
 *  the MATCHES only. The flat list kept every ancestor of a match so its
 *  indent read; the Table shows a search with a Location column now, so a
 *  folder that only contains a match would be a row that matched nothing. */
export function filterFlat(rows, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return rows
  return rows.filter((r) => {
    const byTag = r.node.kind === 'file' && tagsMatch(r.node.row, q)
    return byTag || String(r.node.name).toLowerCase().includes(q) || String(r.node.path).toLowerCase().includes(q)
  })
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

// ── Post-overhaul S4c: the Table shows ONE folder at a time (Audrey, ──────────
// 2026-10-05: "there are folders in folders i need to be able to press the
// folder, and the table in the files tab should be everything in that
// folder. at the top i should see the breadcrumb path"). These three are the
// pure half of that: the crumb, the walk the Columns view's `selected` needs
// to open a folder from the root, and a folder's rows in the order an
// explorer lists them.

/** The folders from the root down to `folder`, root first: the crumb bar. */
export function crumbsFor(folder) {
  const out = []
  let n = folder
  while (n) {
    out.unshift(n)
    if (n.isRoot) break
    n = n.parent
  }
  return out
}

/**
 * The folder ids a `columnsFor` walk needs to reach `folder` from the root
 * (the root itself is where the walk starts, so it is not in the list). The
 * one shape the Table and the Columns view share for "where you are", so a
 * folder entered in one view is the folder open in the other.
 */
export function folderPathIds(folder) {
  return crumbsFor(folder).filter(n => !n.isRoot).map(n => n.id)
}

/**
 * One folder's rows for the Table: its folders first, then its files, each
 * group sorted by `key` — Explorer's and Finder's order. Sorting a folder's
 * CHILDREN, never the flattened tree, is what makes a sort honest here: every
 * row in the list has the same parent, which the crumb above the table names.
 */
export function folderRows(folder, key, dir = 'asc') {
  const rows = (folder?.children || []).map(node => ({ node, depth: 0 }))
  const folders = sortRows(rows.filter(r => r.node.kind === 'folder'), key, dir)
  const files = sortRows(rows.filter(r => r.node.kind === 'file'), key, dir)
  return [...folders, ...files]
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
