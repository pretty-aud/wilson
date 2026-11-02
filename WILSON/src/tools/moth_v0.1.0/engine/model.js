// =============================================================================
// model.js — M.O.T.H.'s graph model (MO2a, PLAN_MOTH.md §5 Session 2, step 2).
//
// Pure functions that turn the catalogue Moth's read path returns into dots
// and lines. The read path is MO1's 0111 (docs/design/MOTH_DESIGN.md MR-1,
// MR-5 and SEC-9): moth_islands(), moth_project_folders(p) and
// moth_project_files(p, after, limit). Folders carry no project_id there, so
// the catalogue is keyed by project:
//
//   catalogue = {
//     islands:   [{ id, title, is_personal, is_mine, is_private, my_project_role,
//                   is_staffed, can_write, updated_at }],                      // moth_islands()
//     folders:   { [projectId]: [{ id, parent_id, kind, entity_type, slug, label,
//                   path, sort_order, updated_at }] },                         // moth_project_folders(p)
//     files:     { [projectId]: [{ id, project_id, folder_id, name, mime_type, size_bytes,
//                   kind, document_kind, description, tags, storage_provider, storage_path,
//                   thumbnail_url, duration_sec, source_modified_at, uploaded_at,
//                   updated_at }] },                                           // moth_project_files(p, …)
//     relations: [{ source: { kind, id }, target: { kind, id }, label }],   // Session 3 supplies these
//   }
//
// The project's own folder (0041: kind 'root', parent_id NULL, path '') is
// the project dot itself, never a dot of its own: a folder or file filed under
// it sits directly under the project. Only the columns the graph draws are
// copied (never storage_path).
//
// The rules (the brief, §2):
//   * One engine, many views. A view picks which kinds are dots, which kinds
//     of line connect them and which containers are open.
//   * Three line kinds: lives in (the folder hierarchy), tagged with (dot to
//     tag dot), related to (relationships, Session 3).
//   * A folder is ONE dot with a count until it is opened. Its contents are
//     absent, and their lines are re-routed to that dot and summed (weight).
//   * Focus: one or two steps from a chosen dot; everything else is mist
//     (dim), not removed.
//   * Stable identities: `${kind}:${rowId}` for a dot, `${kind}|${from}|${to}`
//     for a line, and output sorted by id, so the same rows in any order give
//     the same graph.
//   * A row whose kind is not on show makes no dot and no line, even inside a
//     closed container (it still counts in that container's count).
//
// Privacy (brief §8): the engine draws only the rows it is handed. The RPCs
// already exclude money, Legal and other people's personal spaces; a count
// here is counted from those rows, never a server total, and a relation
// whose end is not among them is dropped, never drawn as a hint.
// =============================================================================

export const NODE_KINDS = Object.freeze(['project', 'folder', 'file', 'tag'])
export const EDGE_KINDS = Object.freeze(['lives_in', 'tagged_with', 'related_to'])
export const FOCUS_MAX_DEPTH = 2

/** The folder walk stops here, as the server's folder-chain walk does (0111). */
const MAX_WALK = 64

export const nodeId = (kind, rowId) => `${kind}:${rowId}`
export const edgeId = (kind, from, to) => `${kind}|${from}|${to}`

const CONTAINERS = new Set(['project', 'folder'])
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** A file's tags as the graph sees them: trimmed, lower case, unique, sorted. */
function tagsOf(row) {
  if (!Array.isArray(row.tags)) return []
  const out = new Set()
  for (const t of row.tags) {
    if (typeof t !== 'string') continue
    const v = t.trim().toLowerCase()
    if (v) out.add(v)
  }
  return [...out].sort()
}

/**
 * Index the catalogue once: every row the person was given, its parent in
 * the hierarchy, and the counts. Pure; depends on nothing but the catalogue.
 */
export function indexCatalogue(catalogue) {
  const rows = new Map() // nodeId -> { id, kind, rowId, projectId, label, … }
  const parent = new Map() // nodeId -> parent nodeId (project or folder)
  const tagFiles = new Map() // tag nodeId -> number of files carrying it
  const islands = Array.isArray(catalogue?.islands) ? catalogue.islands : []
  const projectIds = new Set()

  for (const island of islands) {
    if (!island || island.id == null || projectIds.has(String(island.id))) continue
    const pid = String(island.id)
    projectIds.add(pid)
    rows.set(nodeId('project', pid), {
      id: nodeId('project', pid), kind: 'project', rowId: pid, projectId: pid,
      label: island.title ?? '', updatedAt: island.updated_at ?? null,
    })
  }

  for (const pid of [...projectIds].sort()) {
    const P = nodeId('project', pid)
    const folderRows = Array.isArray(catalogue?.folders?.[pid]) ? catalogue.folders[pid] : []
    const folders = new Map()
    for (const f of folderRows) {
      // The root row is the project itself (0041). Leaving it out of the
      // folders makes every parent_id and folder_id that names it fall back to
      // the project, below.
      if (!f || f.id == null || f.kind === 'root') continue
      const fid = String(f.id)
      const id = nodeId('folder', fid)
      if (rows.has(id)) continue // a folder id is one row; a duplicate is ignored
      folders.set(fid, f)
      rows.set(id, {
        id, kind: 'folder', rowId: fid, projectId: pid,
        label: f.label || f.slug || '', updatedAt: f.updated_at ?? null,
      })
    }
    // Parents. A parent that was not read files the folder at the project's
    // root. A loop is cut at one link (the one that closes it, walking the
    // folders in id order, so the cut does not depend on row order), and a
    // chain deeper than the walk limit is filed at the root where it passes
    // the limit. Everything else keeps its real parent.
    const up = (fid) => {
      const p = folders.get(fid).parent_id
      return p == null ? null : String(p)
    }
    const resolved = new Map() // fid -> depth below the project (1 = top level)
    const setParent = (fid, pFid) => {
      parent.set(nodeId('folder', fid), pFid == null ? P : nodeId('folder', pFid))
      resolved.set(fid, pFid == null ? 1 : resolved.get(pFid) + 1)
    }
    for (const fid of [...folders.keys()].sort()) {
      const path = []
      const onPath = new Set()
      for (let cur = fid; !resolved.has(cur);) {
        if (onPath.has(cur)) { setParent(path.pop(), null); break } // the link that closes a loop
        path.push(cur)
        onPath.add(cur)
        const p = up(cur)
        if (p == null || !folders.has(p)) { setParent(path.pop(), null); break }
        cur = p
      }
      while (path.length) {
        const f = path.pop()
        const p = up(f)
        setParent(f, resolved.get(p) + 1 > MAX_WALK ? null : p)
      }
    }
    const fileRows = Array.isArray(catalogue?.files?.[pid]) ? catalogue.files[pid] : []
    for (const r of fileRows) {
      if (!r || r.id == null) continue
      const rid = String(r.id)
      const id = nodeId('file', rid)
      if (rows.has(id)) continue
      if (r.project_id != null && String(r.project_id) !== pid) continue // not this island's row
      const tags = tagsOf(r)
      rows.set(id, {
        id, kind: 'file', rowId: rid, projectId: pid,
        label: r.name ?? '', updatedAt: r.updated_at ?? null,
        mime: r.mime_type ?? null, sizeBytes: Number.isFinite(r.size_bytes) ? r.size_bytes : null,
        fileKind: r.kind ?? null, tags,
      })
      const fid = r.folder_id == null ? null : String(r.folder_id)
      parent.set(id, fid != null && folders.has(fid) ? nodeId('folder', fid) : P)
      for (const t of tags) {
        const T = nodeId('tag', t)
        tagFiles.set(T, (tagFiles.get(T) || 0) + 1)
      }
    }
  }

  // Counts: everything read beneath a container (folders and files), and
  // its direct children. Counted from the rows themselves, never a total.
  const count = new Map()
  const directCount = new Map()
  for (const [id] of rows) {
    const p = parent.get(id)
    if (p == null) continue
    directCount.set(p, (directCount.get(p) || 0) + 1)
    for (let a = p, steps = 0; a != null && steps <= MAX_WALK + 1; a = parent.get(a), steps++) {
      count.set(a, (count.get(a) || 0) + 1)
    }
  }

  return { rows, parent, tagFiles, count, directCount }
}

/**
 * The size the light follows (brief §1.1): every project, folder and file the
 * person was given. It reads the catalogue only, never a view, so opening a
 * folder, focusing a dot or changing layout cannot change it.
 */
export function catalogueSize(catalogue) {
  return indexCatalogue(catalogue).rows.size
}

function normaliseView(view) {
  const nodeKinds = new Set(Array.isArray(view?.nodeKinds) ? view.nodeKinds.filter((k) => NODE_KINDS.includes(k)) : NODE_KINDS)
  const edgeKinds = new Set(Array.isArray(view?.edgeKinds) ? view.edgeKinds.filter((k) => EDGE_KINDS.includes(k)) : EDGE_KINDS)
  const all = view?.expanded === 'all'
  const expanded = all ? null : new Set(view?.expanded instanceof Set || Array.isArray(view?.expanded) ? view.expanded : [])
  let focus = null
  if (view?.focus && view.focus.id != null) {
    const d = Math.round(Number(view.focus.depth) || 1)
    focus = { id: String(view.focus.id), depth: Math.min(FOCUS_MAX_DEPTH, Math.max(1, d)) }
  }
  return { nodeKinds, edgeKinds, isOpen: (id) => all || expanded.has(id), focus }
}

/**
 * The graph for one view.
 *
 *   view = {
 *     nodeKinds: subset of NODE_KINDS (default all),
 *     edgeKinds: subset of EDGE_KINDS (default all),
 *     expanded:  Set or array of project/folder node ids that are open, or 'all',
 *     focus:     { id, depth: 1 | 2 } or null,
 *   }
 *
 * Returns { nodes, edges, focus } where
 *   node = { id, kind, rowId, projectId, label, parent, depth, collapsed, count,
 *            directCount, updatedAt, mime, sizeBytes, fileKind, tags, dim }
 *   edge = { id, kind, source, target, weight, label }
 * nodes and edges are sorted by id.
 */
export function buildGraph(catalogue, view, index = indexCatalogue(catalogue)) {
  const { rows, parent, tagFiles, count, directCount } = index
  const v = normaliseView(view)
  const included = (kind) => v.nodeKinds.has(kind)

  const chainMemo = new Map()
  const chain = (id) => {
    // Ancestors, nearest first. Parents are acyclic by construction.
    if (chainMemo.has(id)) return chainMemo.get(id)
    const out = []
    for (let a = parent.get(id); a != null && out.length <= MAX_WALK + 1; a = parent.get(a)) out.push(a)
    chainMemo.set(id, out)
    return out
  }
  // The dot that stands for a row: its outermost closed container among the
  // kinds on show, else the row itself when its kind is on show, else none.
  const repMemo = new Map()
  const rep = (id) => {
    if (repMemo.has(id)) return repMemo.get(id)
    if (!included(rows.get(id).kind)) { repMemo.set(id, null); return null } // no dot, no line
    const anc = chain(id)
    let r = null
    for (let i = anc.length - 1; i >= 0; i--) {
      const a = anc[i]
      const k = rows.get(a).kind
      if (included(k) && !v.isOpen(a)) { r = a; break }
    }
    if (r == null) r = id
    repMemo.set(id, r)
    return r
  }

  const nodes = new Map()
  for (const [id, row] of rows) {
    if (rep(id) !== id) continue
    const anc = chain(id)
    let p = null
    let depth = 0
    for (const a of anc) {
      if (!included(rows.get(a).kind)) continue
      if (p == null) p = a
      depth++
    }
    const container = CONTAINERS.has(row.kind)
    nodes.set(id, {
      id, kind: row.kind, rowId: row.rowId, projectId: row.projectId, label: row.label,
      parent: p, depth,
      collapsed: container ? !v.isOpen(id) : false,
      count: container ? count.get(id) || 0 : 0,
      directCount: container ? directCount.get(id) || 0 : 0,
      updatedAt: row.updatedAt ?? null,
      mime: row.mime ?? null, sizeBytes: row.sizeBytes ?? null, fileKind: row.fileKind ?? null,
      tags: row.tags ?? [],
      dim: false,
    })
  }

  const edges = new Map()
  // A relation keeps its own direction while it is one relation; once two or
  // more are summed into one line it has no single direction, so its ends are
  // stored in id order (the same graph whatever order the rows came in).
  const addEdge = (kind, a, b, label, undirected) => {
    if (a == null || b == null || a === b) return
    const [s, t] = undirected && b < a ? [b, a] : [a, b]
    const id = edgeId(kind, s, t)
    const e = edges.get(id)
    if (e) { e.weight += 1; e.label = null; e.source = s; e.target = t; return }
    edges.set(id, { id, kind, source: a, target: b, weight: 1, label: label ?? null })
  }

  if (v.edgeKinds.has('lives_in')) {
    for (const n of nodes.values()) if (n.parent != null) addEdge('lives_in', n.id, n.parent, null, false)
  }

  if (included('tag')) {
    for (const [id, row] of rows) {
      if (row.kind !== 'file' || !row.tags.length) continue
      const r = rep(id)
      if (r == null) continue
      for (const t of row.tags) {
        const T = nodeId('tag', t)
        if (!nodes.has(T)) {
          nodes.set(T, {
            id: T, kind: 'tag', rowId: t, projectId: null, label: t, parent: null, depth: 0,
            collapsed: false, count: tagFiles.get(T) || 0, directCount: 0, updatedAt: null,
            mime: null, sizeBytes: null, fileKind: null, tags: [], dim: false,
          })
        }
        if (v.edgeKinds.has('tagged_with')) addEdge('tagged_with', r, T, null, false)
      }
    }
  }

  if (v.edgeKinds.has('related_to') && Array.isArray(catalogue?.relations)) {
    for (const rel of catalogue.relations) {
      const a = endpoint(rel?.source, rows, nodes)
      const b = endpoint(rel?.target, rows, nodes)
      if (a === undefined || b === undefined) continue // an end not read: never drawn
      const ra = a.kind === 'tag' ? a.id : rep(a.id)
      const rb = b.kind === 'tag' ? b.id : rep(b.id)
      if (ra == null || rb == null || !nodes.has(ra) || !nodes.has(rb)) continue
      addEdge('related_to', ra, rb, typeof rel.label === 'string' ? rel.label : null, true)
    }
  }

  const nodeList = [...nodes.values()].sort(byId)
  const edgeList = [...edges.values()].sort(byId)
  const focus = applyFocus(nodeList, edgeList, nodes, v.focus)
  return { nodes: nodeList, edges: edgeList, focus }
}

function endpoint(end, rows, nodes) {
  if (!end || end.id == null || !NODE_KINDS.includes(end.kind)) return undefined
  if (end.kind === 'tag') {
    const T = nodeId('tag', String(end.id).trim().toLowerCase())
    return nodes.has(T) ? { kind: 'tag', id: T } : undefined
  }
  const id = nodeId(end.kind, String(end.id))
  return rows.has(id) ? { kind: end.kind, id } : undefined
}

/** Mark everything further than `depth` steps from the focus as mist. */
function applyFocus(nodeList, edgeList, nodes, focus) {
  if (!focus || !nodes.has(focus.id)) return null
  const adj = new Map()
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, [])
    adj.get(a).push(b)
  }
  for (const e of edgeList) { link(e.source, e.target); link(e.target, e.source) }
  const near = new Set([focus.id])
  let frontier = [focus.id]
  for (let d = 0; d < focus.depth; d++) {
    const next = []
    for (const id of frontier) for (const m of adj.get(id) || []) if (!near.has(m)) { near.add(m); next.push(m) }
    frontier = next
  }
  for (const n of nodeList) n.dim = !near.has(n.id)
  return { id: focus.id, depth: focus.depth, ids: near }
}

// ── The graph as layout input, and positions as data ───────────────────────
// These live here, not in layout.js, so the page's chunk (renderer and model)
// never pulls in the D3 modules: only the layout worker's chunk carries them.

export const EDGE_CODE = Object.freeze({ lives_in: 0, tagged_with: 1, related_to: 2 })

/** A dot's world radius: containers grow with what is inside them. */
export const defaultRadius = (node) => (node.kind === 'file' ? 3.5 : node.kind === 'tag' ? 5 : 5 + 1.6 * Math.sqrt(node.count || 0))

/**
 * The graph as layout input, in the graph's own node order (sorted by id),
 * which the renderer shares.
 *   nodes: [{ id, parent, r, loose }]   (loose: outside the hierarchy, a tag dot)
 *   links: [[sourceIndex, targetIndex, EDGE_CODE]]
 */
export function toLayoutInput(graph, radiusOf = defaultRadius) {
  const index = new Map()
  graph.nodes.forEach((n, i) => index.set(n.id, i))
  const nodes = graph.nodes.map((n) => ({ id: n.id, parent: n.parent ?? null, r: radiusOf(n), loose: n.kind === 'tag' }))
  const links = []
  for (const e of graph.edges) {
    const s = index.get(e.source)
    const t = index.get(e.target)
    if (s === undefined || t === undefined) continue
    links.push([s, t, EDGE_CODE[e.kind] ?? EDGE_CODE.related_to])
  }
  return { nodes, links }
}

/**
 * Positions as plain data for a later session to save with the view:
 * { [nodeId]: { x, y, pinned? } }. A dot that was never given a place
 * (placed(i) false) is left out, so a saved view never records a guess.
 */
export function positionsToData(ids, xy, { pinned = () => false, placed = () => true } = {}) {
  const out = {}
  for (let i = 0; i < ids.length; i++) {
    const x = xy[2 * i]
    const y = xy[2 * i + 1]
    if (!placed(i) || !Number.isFinite(x) || !Number.isFinite(y)) continue
    const p = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }
    if (pinned(i)) p.pinned = true
    out[ids[i]] = p
  }
  return out
}
