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
  'thumbnail_url', 'duration_sec', 'source_modified_at', 'uploaded_at', 'updated_at']
// What the read path never returns (MR-5's post-conditions).
const NEVER = ['is_financial', 'created_by', 'count', 'storage_path']

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

  it('rows have the read path columns and none it never returns', () => {
    const cat = generateCatalogue({ seed: 3 })
    const pid = cat.islands[0].id
    expect(Object.keys(cat.islands[0]).sort()).toEqual([...ISLAND].sort())
    expect(Object.keys(cat.folders[pid][0]).sort()).toEqual([...FOLDER].sort())
    expect(Object.keys(cat.files[pid][0]).sort()).toEqual([...FILE].sort())
    for (const row of [cat.islands[0], cat.folders[pid][0], cat.files[pid][0]]) {
      for (const k of NEVER) expect(k in row).toBe(false)
    }
  })

  it('folders stay within the depth limit and files point at their own project', () => {
    const cat = generateCatalogue({ seed: 5, projects: 2, foldersPerProject: 40, filesPerProject: 80, maxDepth: 3 })
    for (const island of cat.islands) {
      const byId = new Map(cat.folders[island.id].map((f) => [f.id, f]))
      for (const f of byId.values()) {
        let d = 1
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

  it('refuses a shape it cannot make rather than returning the wrong counts', () => {
    expect(() => fixtureForTarget({ nodes: 1000, edges: 10 })).toThrow(/too few lines/)
  })
})
