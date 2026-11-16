// =============================================================================
// fixtures.js — a deterministic catalogue generator for the engine's tests
// and benchmarks (MO2a, the brief's item 1).
//
// It makes rows in the shape of MO1's read path (MOTH_DESIGN.md MR-5): the
// same seed gives the same catalogue, byte for byte, on every machine. It is
// test data, never a stand-in for her projects: the acceptance replay on the
// debug sample and her saved local test project is MO2's (PLAN_MOTH §9 Q6).
// =============================================================================

import { seededRandom } from './model.js'
export { seededRandom }

const HEX = '0123456789abcdef'
function uuid(rand) {
  let s = ''
  for (let i = 0; i < 32; i++) {
    let d = Math.floor(rand() * 16)
    if (i === 12) d = 4
    if (i === 16) d = 8 + (d & 3)
    s += HEX[d]
    if (i === 7 || i === 11 || i === 15 || i === 19) s += '-'
  }
  return s
}

/** The nine file tags of 0085, less the two the read path never returns (finance, legal). */
const FIXTURE_TAGS = Object.freeze(['production', 'creative', 'reference', 'assets', 'code', 'shots', 'documentation'])
const MIMES = ['image/png', 'image/jpeg', 'video/mp4', 'text/markdown', 'application/pdf', 'model/gltf-binary']
const FILE_KINDS = ['source', 'reference', 'deliverable', 'export', 'other'] // 0000's file_kind enum
const BASE = Date.UTC(2026, 0, 1)

/**
 * generateCatalogue({ seed, projects, foldersPerProject, filesPerProject,
 *                     maxDepth, tagPool, tagsPerFile, relations })
 * Rows in the read path's shape (MR-5) and 0041's: each project has its root
 * folder (kind 'root', parent_id null, path ''), the folders under it with
 * slug paths, and files in the root, in a folder, or (a few) with folder_id
 * null, as moth_project_files returns a folder that is not the project's.
 *   foldersPerProject: folders besides the root.
 *   tagsPerFile: an exact number (every file gets that many distinct tags).
 *   relations: the number of distinct file-to-file relations (unordered pairs).
 */
export function generateCatalogue({
  seed = 1, projects = 2, foldersPerProject = 10, filesPerProject = 60,
  maxDepth = 4, tagPool = FIXTURE_TAGS, tagsPerFile = 1, relations = 0,
} = {}) {
  const rand = seededRandom(seed)
  const pick = (list) => list[Math.floor(rand() * list.length)]
  const stamp = () => new Date(BASE + Math.floor(rand() * 300) * 86400000).toISOString()
  const islands = []
  const folders = {}
  const files = {}
  const allFiles = []
  for (let p = 0; p < projects; p++) {
    const pid = uuid(rand)
    const title = `Project ${p + 1}`
    islands.push({
      id: pid, title, is_personal: false, is_mine: false, is_private: false,
      my_project_role: 'member', is_staffed: true, can_write: true, updated_at: stamp(),
    })
    const root = {
      id: uuid(rand), parent_id: null, kind: 'root', entity_type: null,
      slug: `project-${p + 1}`, label: title, path: '', sort_order: 0, updated_at: stamp(),
    }
    const fs = [root]
    const depthOf = new Map([[root.id, 0]])
    for (let i = 0; i < foldersPerProject; i++) {
      const deeper = fs.filter((f) => f.kind !== 'root' && depthOf.get(f.id) < maxDepth)
      const parentRow = deeper.length && rand() < 0.75 ? pick(deeper) : root
      const id = uuid(rand)
      const slug = `folder-${i + 1}`
      depthOf.set(id, depthOf.get(parentRow.id) + 1)
      fs.push({
        id, parent_id: parentRow.id, kind: parentRow === root ? 'category' : 'custom', entity_type: null,
        slug, label: `Folder ${i + 1}`, path: parentRow.path ? `${parentRow.path}/${slug}` : slug,
        sort_order: i + 1, updated_at: stamp(),
      })
    }
    folders[pid] = fs
    const rs = []
    for (let i = 0; i < filesPerProject; i++) {
      const tags = []
      const n = Math.min(tagsPerFile, tagPool.length)
      while (tags.length < n) {
        const t = pick(tagPool)
        if (!tags.includes(t)) tags.push(t)
      }
      const roll = rand()
      const folder = roll < 0.05 ? null : roll < 0.2 || fs.length === 1 ? root : pick(fs.slice(1))
      const name = `file-${p + 1}-${i + 1}`
      const row = {
        id: uuid(rand), project_id: pid, folder_id: folder ? folder.id : null,
        name, mime_type: pick(MIMES), size_bytes: Math.floor(rand() * 5e7),
        kind: pick(FILE_KINDS), document_kind: null, description: null, tags,
        storage_provider: 'supabase', storage_path: `projects/${pid}/${folder && folder.path ? `${folder.path}/` : ''}${name}`,
        thumbnail_url: null, duration_sec: null, source_modified_at: null, uploaded_at: stamp(), updated_at: stamp(),
      }
      rs.push(row)
      allFiles.push(row)
    }
    files[pid] = rs
  }
  const maxPairs = (allFiles.length * (allFiles.length - 1)) / 2
  if (relations > maxPairs) throw new Error(`generateCatalogue: ${relations} relations asked, only ${maxPairs} distinct pairs of files`)
  const rel = []
  const seen = new Set()
  while (rel.length < relations) {
    const a = pick(allFiles).id
    const b = pick(allFiles).id
    if (a === b) continue
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    if (seen.has(key)) continue
    seen.add(key)
    rel.push({ source: { kind: 'file', id: a }, target: { kind: 'file', id: b }, label: rand() < 0.3 ? 'see also' : null })
  }
  return { islands, folders, files, relations: rel }
}

/**
 * A catalogue whose fully opened graph has exactly `nodes` dots and `edges`
 * lines (all kinds on show), for the performance targets: 1,000 and 2,000,
 * and 300 and 600 in low power. Returns { catalogue, view }. It refuses a
 * shape it cannot make exactly rather than return different counts.
 *   dots  = projects + folders + files + tags in use (the root rows are the projects)
 *   lines = one lives-in per folder and file + one tagged-with per file + relations
 */
export function fixtureForTarget({ nodes, edges, seed = 7, tagPool = FIXTURE_TAGS } = {}) {
  const projects = Math.max(1, Math.round(nodes / 500))
  const rowsTotal = nodes - projects - tagPool.length
  if (rowsTotal < projects * 2) throw new Error('fixtureForTarget: too few dots for the shape')
  const perProject = Math.floor(rowsTotal / projects)
  const extra = rowsTotal - perProject * projects
  const foldersPerProject = Math.max(1, Math.round(perProject * 0.1))
  const filesTotal = rowsTotal - foldersPerProject * projects
  if (filesTotal < tagPool.length) throw new Error('fixtureForTarget: too few files to use every tag')
  const relations = edges - rowsTotal - filesTotal
  if (relations < 0) throw new Error('fixtureForTarget: too few lines for the shape')
  if (relations > (filesTotal * (filesTotal - 1)) / 2) throw new Error('fixtureForTarget: more lines than distinct pairs of files')
  const catalogue = generateCatalogue({
    seed, projects, foldersPerProject, filesPerProject: perProject - foldersPerProject,
    tagPool, tagsPerFile: 1, relations: 0,
  })
  // The remainder goes to the first project's root, then relations are drawn over all files.
  if (extra > 0) {
    const pid = catalogue.islands[0].id
    const rootId = catalogue.folders[pid][0].id
    const more = generateCatalogue({ seed: seed + 1, projects: 1, foldersPerProject: 0, filesPerProject: extra, tagPool, tagsPerFile: 1 })
    for (const r of more.files[more.islands[0].id]) catalogue.files[pid].push({ ...r, project_id: pid, folder_id: rootId, storage_path: `projects/${pid}/${r.name}` })
  }
  const all = Object.values(catalogue.files).flat()
  // Every tag in the pool must be in use, or there would be fewer tag dots.
  const used = new Set(all.flatMap((r) => r.tags))
  for (let i = 0; used.size < tagPool.length && i < all.length; i++) {
    const missing = tagPool.find((t) => !used.has(t))
    if (used.has(all[i].tags[0]) && all.filter((r) => r.tags[0] === all[i].tags[0]).length > 1) {
      used.delete(all[i].tags[0])
      all[i].tags = [missing]
      for (const r of all) for (const t of r.tags) used.add(t)
    }
  }
  if (used.size !== tagPool.length) throw new Error('fixtureForTarget: could not use every tag')
  const rand = seededRandom(seed + 2)
  const seen = new Set()
  while (catalogue.relations.length < relations) {
    const a = all[Math.floor(rand() * all.length)].id
    const b = all[Math.floor(rand() * all.length)].id
    if (a === b) continue
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    if (seen.has(key)) continue
    seen.add(key)
    catalogue.relations.push({ source: { kind: 'file', id: a }, target: { kind: 'file', id: b }, label: null })
  }
  return { catalogue, view: { expanded: 'all' } }
}
