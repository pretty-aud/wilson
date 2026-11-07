// mothViewState.test.js — MO2: a view as plain data. A config never holds an id; what is open or in focus comes
// from the view's places, and the quick starts are views that are never stored.
import { describe, it, expect } from 'vitest'
import {
  QUICK_VIEWS, isQuick, normalizeConfig, configHasId, engineView, filterByTags, containersOf, searchCatalogue,
  DOT_CHOICES, LINE_CHOICES, TAG_WORDS, projectDot,
} from './mothViewState.js'
import { NODE_KINDS, EDGE_KINDS, FOCUS_MAX_DEPTH } from '../engine/model.js'

const catalogue = {
  islands: [{ id: 'p1', title: 'Salt Hours' }, { id: 'p2', title: 'Other' }],
  folders: {
    p1: [{ id: 'd1', parent_id: null, kind: 'custom', slug: 'shots', label: 'Shots' },
      { id: 'd2', parent_id: 'd1', kind: 'custom', slug: 'day-one', label: 'Day one' }],
    p2: [],
  },
  files: {
    p1: [{ id: 'f1', project_id: 'p1', folder_id: 'd2', name: 'saltshot.mov', tags: ['shots'] },
      { id: 'f2', project_id: 'p1', folder_id: 'd1', name: 'salt.png', tags: ['reference', 'Shots '] },
      { id: 'f3', project_id: 'p1', folder_id: null, name: 'notes.txt', tags: [] }],
    p2: [{ id: 'f4', project_id: 'p2', folder_id: null, name: 'basalt.pdf', tags: ['documentation'] }],
  },
}

describe('QUICK_VIEWS', () => {
  it('are the two quick starts, each a valid config with no id', () => {
    expect(Object.keys(QUICK_VIEWS)).toEqual(['q:folders', 'q:tags'])
    for (const [key, v] of Object.entries(QUICK_VIEWS)) {
      expect(isQuick(key)).toBe(true)
      expect(normalizeConfig(v.config)).toMatchObject({ nodeKinds: v.config.nodeKinds, edgeKinds: v.config.edgeKinds })
      expect(configHasId(v.config)).toBe(false)
    }
    expect(isQuick('toString')).toBe(false)
    expect(isQuick('11111111-1111-1111-1111-111111111111')).toBe(false)
  })
})

describe('normalizeConfig', () => {
  it('keeps only known keys of their own shape', () => {
    expect(normalizeConfig({ nodeKinds: ['file', 'tag', 'file', 'person'], edgeKinds: ['tagged_with', 'owns'], layout: 'grid', focusDepth: 9, tags: ['shots', 'secret'], openAll: 'yes', extra: 1 }))
      .toEqual({ nodeKinds: ['file', 'tag'], edgeKinds: ['tagged_with'], layout: 'force', focusDepth: 1, tags: ['shots'], openAll: false })
  })
  it('falls back to folders and files when nothing usable is chosen', () => {
    for (const raw of [null, [], 'x', { nodeKinds: [] }, { nodeKinds: ['nobody'] }]) {
      expect(normalizeConfig(raw).nodeKinds).toEqual(['project', 'folder', 'file'])
    }
    expect(normalizeConfig({ edgeKinds: [] }).edgeKinds).toEqual([])
    expect(normalizeConfig({}).edgeKinds).toEqual(['lives_in'])
  })
  it('takes radial and a focus of two', () => {
    expect(normalizeConfig({ layout: 'radial', focusDepth: 2, openAll: true })).toMatchObject({ layout: 'radial', focusDepth: 2, openAll: true })
  })
  it('offers exactly the engine\'s kinds and lines', () => {
    expect(DOT_CHOICES.map(([k]) => k).sort()).toEqual([...NODE_KINDS].sort())
    expect(LINE_CHOICES.map(([k]) => k).sort()).toEqual([...EDGE_KINDS].sort())
    for (const [, words] of [...DOT_CHOICES, ...LINE_CHOICES]) expect(typeof words).toBe('string')
    expect(TAG_WORDS).not.toContain('legal')
    expect(TAG_WORDS).not.toContain('money')
  })
})

describe('configHasId', () => {
  it('finds anything shaped like an id, with or without dashes, in any case', () => {
    expect(configHasId({ name: 'a' })).toBe(false)
    expect(configHasId({ tags: ['11111111-2222-3333-4444-555555555555'] })).toBe(true)
    expect(configHasId({ note: 'AAAAAAAABBBBCCCCDDDDEEEEEEEEEEEE' })).toBe(true)
    expect(configHasId(null)).toBe(false)
  })
})

describe('engineView', () => {
  it('opens what the places say, or everything, and caps the focus depth', () => {
    const v = engineView({ nodeKinds: ['file'], focusDepth: 2 }, { open: ['project:p1'], focusId: 'file:f1' })
    expect(v.expanded).toEqual(new Set(['project:p1']))
    expect(v.focus).toEqual({ id: 'file:f1', depth: Math.min(FOCUS_MAX_DEPTH, 2) })
    expect(engineView({ openAll: true }).expanded).toBe('all')
    expect(engineView({}).focus).toBeNull()
  })
})

describe('filterByTags', () => {
  it('keeps the files carrying a chosen tag, matched trimmed and lower-cased; none chosen keeps all', () => {
    expect(filterByTags(catalogue, [])).toBe(catalogue)
    const shots = filterByTags(catalogue, ['shots'])
    expect(shots.files.p1.map((f) => f.id)).toEqual(['f1', 'f2'])
    expect(shots.files.p2).toEqual([])
    expect(shots.folders).toBe(catalogue.folders)
  })
})

describe('containersOf', () => {
  it('lists a dot\'s containers outermost first', () => {
    expect(containersOf(catalogue, 'file:f1')).toEqual(['project:p1', 'folder:d1', 'folder:d2'])
    expect(containersOf(catalogue, 'file:f3')).toEqual(['project:p1'])
    expect(containersOf(catalogue, 'project:p1')).toEqual([])
    expect(containersOf(catalogue, 'file:nobody')).toEqual([])
  })
})

describe('searchCatalogue', () => {
  it('finds names across every project, a word start before a match inside a word', () => {
    const hits = searchCatalogue(catalogue, 'salt')
    expect(hits.map((h) => h.id)).toEqual(['file:f2', 'project:p1', 'file:f1', 'file:f4'])
    expect(hits[0]).toEqual({ id: 'file:f2', kind: 'file', label: 'salt.png', projectId: 'p1' })
  })
  it('says nothing for no words, and keeps to its limit', () => {
    expect(searchCatalogue(catalogue, '   ')).toEqual([])
    expect(searchCatalogue(catalogue, 's', { limit: 2 })).toHaveLength(2)
  })
  it('names a project as its dot', () => {
    expect(projectDot('p1')).toBe('project:p1')
  })
})
