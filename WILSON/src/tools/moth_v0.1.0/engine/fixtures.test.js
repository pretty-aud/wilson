// =============================================================================
// fixtures.test.js — the deterministic catalogue generator (MO2a, the brief's
// item 1). Same seed, same catalogue; rows in MO1's read-path shape (MR-5);
// the benchmark fixtures land exactly on the plan's targets.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { seededRandom, generateCatalogue, fixtureForTarget } from './fixtures.js'
import { buildGraph } from './model.js'

// MOTH_DESIGN.md MR-5: the three RPCs' result columns.
const ISLAND = ['id', 'title', 'is_personal', 'is_mine', 'is_private', 'my_project_role', 'is_staffed', 'can_write', 'updated_at']
const FOLDER = ['id', 'parent_id', 'kind', 'entity_type', 'slug', 'label', 'path', 'sort_order', 'updated_at']
const FILE = ['id', 'project_id', 'folder_id', 'name', 'mime_type', 'size_bytes', 'kind', 'document_kind', 'description', 'tags',
  'storage_provider', 'storage_path', 'thumbnail_url', 'duration_sec', 'source_modified_at', 'uploaded_at', 'updated_at']
// What the read path never returns (MR-5's post-conditions).
const NEVER = ['is_financial', 'created_by', 'count']
const FILE_KINDS = ['source', 'reference', 'deliverable', 'export', 'other'] // 0000's file_kind enum

describe('fixture generator', () => {
  it('the seeded generator is deterministic and differs by seed', () => {
    const a = seededRandom(42)
    const b = seededRandom(42)
    const c = seededRandom(43)
    const xs = [a(), a(), a()]
    expect([b(), b(), b()]).toEqual(xs)
    expect(c()).not.toBe(xs[0])
  })

  it('the same seed gives the same catalogue, byte for byte', () => {
    const o = { seed: 9, projects: 3, foldersPerProject: 12, filesPerProject: 40, relations: 25 }
    expect(JSON.stringify(generateCatalogue(o))).toBe(JSON.stringify(generateCatalogue(o)))
    expect(JSON.stringify(generateCatalogue({ ...o, seed: 10 }))).not.toBe(JSON.stringify(generateCatalogue(o)))
  })

  it('every row has exactly the read path columns (MR-5) and none it never returns', () => {
    const cat = generateCatalogue({ seed: 3 })
    for (const island of cat.islands) {
      expect(Object.keys(island).sort()).toEqual([...ISLAND].sort())
      for (const f of cat.folders[island.id]) expect(Object.keys(f).sort()).toEqual([...FOLDER].sort())
      for (const r of cat.files[island.id]) {
        expect(Object.keys(r).sort()).toEqual([...FILE].sort())
        expect(FILE_KINDS).toContain(r.kind)
      }
      for (const row of [island, ...cat.folders[island.id], ...cat.files[island.id]]) {
        for (const k of NEVER) expect(k in row).toBe(false)
      }
    }
  })

  it('folders obey 0041: one root per project (the only folder without a parent, path empty), slug paths below it', () => {
    const cat = generateCatalogue({ seed: 4, foldersPerProject: 25 })
    for (const island of cat.islands) {
      const fs = cat.folders[island.id]
      const roots = fs.filter((f) => f.kind === 'root')
      expect(roots.length).toBe(1)
      for (const f of fs) expect(f.kind === 'root').toBe(f.parent_id === null) // folders_root_shape_chk
      expect(roots[0].path).toBe('')
      const byId = new Map(fs.map((f) => [f.id, f]))
      for (const f of fs) {
        if (f.kind === 'root') continue
        const parent = byId.get(f.parent_id)
        expect(f.path).toBe(parent.path ? `${parent.path}/${f.slug}` : f.slug)
      }
    }
  })

  it('CONTROL: the root-shape check catches a top-level folder with no parent', () => {
    const cat = generateCatalogue({ seed: 4 })
    const f = cat.folders[cat.islands[0].id][1]
    f.parent_id = null
    expect(cat.folders[cat.islands[0].id].every((x) => (x.kind === 'root') === (x.parent_id === null))).toBe(false)
  })

  it('folders stay within the depth limit and files point at their own project', () => {
    const cat = generateCatalogue({ seed: 5, projects: 2, foldersPerProject: 40, filesPerProject: 80, maxDepth: 3 })
    for (const island of cat.islands) {
      const byId = new Map(cat.folders[island.id].map((f) => [f.id, f]))
      for (const f of byId.values()) {
        let d = 0 // the root is depth 0
        for (let p = f.parent_id; p != null; p = byId.get(p).parent_id) d++
        expect(d).toBeLessThanOrEqual(3)
      }
      for (const r of cat.files[island.id]) {
        expect(r.project_id).toBe(island.id)
        if (r.folder_id != null) expect(byId.has(r.folder_id)).toBe(true)
      }
    }
  })

  it('relations are distinct unordered pairs of different files', () => {
    const cat = generateCatalogue({ seed: 2, filesPerProject: 30, relations: 50 })
    const keys = cat.relations.map((r) => [r.source.id, r.target.id].sort().join('|'))
    expect(new Set(keys).size).toBe(50)
    expect(cat.relations.every((r) => r.source.id !== r.target.id)).toBe(true)
  })

  it('the benchmark fixtures land exactly on the targets (1,000/2,000 and 300/600)', () => {
    for (const [nodes, edges] of [[1000, 2000], [300, 600]]) {
      const { catalogue, view } = fixtureForTarget({ nodes, edges })
      const g = buildGraph(catalogue, view)
      expect([g.nodes.length, g.edges.length]).toEqual([nodes, edges])
    }
  })

  it('CONTROL: the same count check catches a fixture one line short', () => {
    const { catalogue, view } = fixtureForTarget({ nodes: 300, edges: 600 })
    catalogue.relations.pop()
    expect(buildGraph(catalogue, view).edges.length).not.toBe(600)
  })

  it('refuses a shape it cannot make rather than returning the wrong counts or looping', () => {
    expect(() => fixtureForTarget({ nodes: 1000, edges: 10 })).toThrow(/too few lines/)
    expect(() => fixtureForTarget({ nodes: 20, edges: 1000 })).toThrow(/distinct pairs/)
    expect(() => fixtureForTarget({ nodes: 14, edges: 15 })).toThrow(/every tag/)
    expect(() => generateCatalogue({ projects: 1, filesPerProject: 3, relations: 4 })).toThrow(/distinct pairs/)
  })

  it('small targets that can be made are exact', () => {
    for (const [nodes, edges] of [[60, 100], [16, 20]]) {
      const { catalogue, view } = fixtureForTarget({ nodes, edges })
      const g = buildGraph(catalogue, view)
      expect([g.nodes.length, g.edges.length]).toEqual([nodes, edges])
    }
  })
})
