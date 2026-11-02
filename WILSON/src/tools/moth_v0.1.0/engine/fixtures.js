// =============================================================================
// fixtures.js — a deterministic catalogue generator for the engine's tests
// and benchmarks (MO2a, the brief's item 1).
//
// It makes rows in the shape of MO1's read path (MOTH_DESIGN.md MR-5): the
// same seed gives the same catalogue, byte for byte, on every machine. It is
// test data, never a stand-in for her projects: the acceptance replay on the
// debug sample and her saved local test project is MO2's (PLAN_MOTH §9 Q6).
// =============================================================================

/** mulberry32: a small seeded generator; returns floats in [0, 1). */
export function seededRandom(seed) {
  let a = (Number(seed) >>> 0) || 0x9e3779b9
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

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

/** The nine file tags of 0085, less the two the read path never returns. */
export const FIXTURE_TAGS = Object.freeze(['production', 'creative', 'reference', 'assets', 'code', 'shots', 'documentation'])
const MIMES = ['image/png', 'image/jpeg', 'video/mp4', 'text/markdown', 'application/pdf', 'model/gltf-binary']
const BASE = Date.UTC(2026, 0, 1)

/**
 * generateCatalogue({ seed, projects, foldersPerProject, filesPerProject,
 *                     maxDepth, tagPool, tagsPerFile, relations })
 *   tagsPerFile: an exact number (every file gets that many distinct tags).
 *   relations:   the number of distinct file-to-file relations (unordered pairs).
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
    islands.push({
      id: pid, title: `Project ${p + 1}`, is_personal: false, is_mine: false, is_private: false,
      my_project_role: 'member', is_staffed: true, can_write: true, updated_at: stamp(),
    })
    const fs = []
    const depthOf = new Map()
    for (let i = 0; i < foldersPerProject; i++) {
      const candidates = fs.filter((f) => depthOf.get(f.id) < maxDepth)
      const parentRow = candidates.length && rand() < 0.75 ? pick(candidates) : null
      const id = uuid(rand)
      depthOf.set(id, parentRow ? depthOf.get(parentRow.id) + 1 : 1)
      fs.push({
        id, parent_id: parentRow ? parentRow.id : null, kind: 'custom', entity_type: null,
        slug: `folder-${i + 1}`, label: `Folder ${i + 1}`, path: null, sort_order: i, updated_at: stamp(),
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
      const row = {
        id: uuid(rand), project_id: pid,
        folder_id: fs.length && rand() < 0.9 ? pick(fs).id : null,
        name: `file-${p + 1}-${i + 1}`, mime_type: pick(MIMES), size_bytes: Math.floor(rand() * 5e7),
        kind: 'file', document_kind: null, description: null, tags,
        thumbnail_url: null, duration_sec: null, source_modified_at: null, uploaded_at: stamp(), updated_at: stamp(),
      }
      rs.push(row)
      allFiles.push(row)
    }
    files[pid] = rs
  }
  const rel = []
  const seen = new Set()
  const maxPairs = (allFiles.length * (allFiles.length - 1)) / 2
  const want = Math.min(relations, maxPairs)
  while (rel.length < want) {
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
 * and 300 and 600 in low power. Returns { catalogue, view }.
 */
export function fixtureForTarget({ nodes, edges, seed = 7, tagPool = FIXTURE_TAGS } = {}) {
  const projects = Math.max(1, Math.round(nodes / 500))
  const rowsTotal = nodes - projects - tagPool.length
  if (rowsTotal < projects * 2) throw new Error('fixtureForTarget: too few dots for the shape')
  const perProject = Math.floor(rowsTotal / projects)
  const extra = rowsTotal - perProject * projects
  const foldersPerProject = Math.max(1, Math.round(perProject * 0.1))
  // Lines: one lives-in per folder and file, one tagged-with per file; the
  // rest are relations.
  const filesTotal = rowsTotal - foldersPerProject * projects
  const relations = edges - rowsTotal - filesTotal
  if (relations < 0) throw new Error('fixtureForTarget: too few lines for the shape')
  const catalogue = generateCatalogue({
    seed, projects, foldersPerProject, filesPerProject: perProject - foldersPerProject,
    tagPool, tagsPerFile: 1, relations: 0,
  })
  // The remainder goes to the first project, then relations are drawn over all files.
  if (extra > 0) {
    const pid = catalogue.islands[0].id
    const more = generateCatalogue({ seed: seed + 1, projects: 1, foldersPerProject: 0, filesPerProject: extra, tagPool, tagsPerFile: 1 })
    for (const r of more.files[more.islands[0].id]) catalogue.files[pid].push({ ...r, project_id: pid, folder_id: null })
  }
  const all = Object.values(catalogue.files).flat()
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
