// =============================================================================
// fileTree.test.js — the explorer's tree over the rows both backends return.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { buildFileTree, flattenTree, filterFlat, columnsFor, breadcrumb, sortRows, ROOT_ID } from './fileTree.js'

const folders = [
  { id: 'r', kind: 'root', path: '', parent_id: null },
  { id: 'a', kind: 'category', path: 'ASSETS', parent_id: 'r' },
  { id: 'a1', kind: 'entity', path: 'ASSETS/hero-shot', parent_id: 'a', asset_id: 'asset-1' },
  { id: 's', kind: 'category', path: 'SCENES', parent_id: 'r' },
  { id: 's1', kind: 'entity', path: 'SCENES/sc01', parent_id: 's', scene_id: 'scene-1' },
  { id: 'orphan', kind: 'entity', path: 'SHOTS/sh01', parent_id: 'gone' }, // parent missing → by path → missing → root
]
const files = [
  { id: 'f1', name: 'clip.mov', mime_type: 'video/quicktime', size_bytes: 1000, folder_id: 'a1', uploaded_at: '2026-09-11T01:00:00Z', duration_sec: 12.5, storage_provider: 'local_server' },
  { id: 'f2', name: 'board.png', mime_type: 'image/png', size_bytes: 20, asset_id: 'asset-1', created_at: '2026-09-11T00:00:00Z', storage_provider: 'supabase' },
  { id: 'f3', name: 'notes.txt', mime_type: 'text/plain', size_bytes: 5, created_at: '2026-09-10T00:00:00Z', storage_provider: 'supabase' },
  { id: 'f4', name: 'gone.txt', deleted_at: '2026-09-10T00:00:00Z' },
  { id: 'f5', name: 'take.wav', mime_type: 'audio/wav', scene_id: 'scene-1', size_bytes: 300, source_modified_at: '2026-09-09T00:00:00Z' },
]
const managedFiles = [
  { id: 'm1', file_name: 'Hero_v001.mov', stored_name: 'x_Hero_v001.mov', folder_path: 'ASSETS/hero-shot/', size_bytes: 4000, uploaded_at: '2026-09-11T02:00:00Z', mime_type: 'video/quicktime', duration_sec: 4 },
  { id: 'm2', file_name: 'loose.png', folder_path: 'ASSETS/unknown/', size_bytes: 1 },
]

describe('buildFileTree', () => {
  const t = buildFileTree({ folders, files, managedFiles })
  it('uses the root folder row, files folders by parent_id, and parks an orphan at the root', () => {
    expect(t.root.id).toBe('r')
    expect(t.folderCount).toBe(5)
    expect(t.root.children.filter(c => c.kind === 'folder').map(c => c.name)).toEqual(['ASSETS', 'SCENES', 'sh01'])
    expect(t.byId.get('a1').parent.id).toBe('a')
    expect(t.byId.get('orphan').parent.id).toBe('r')
  })
  it('places a file by folder_id, then by its entity, else at the root; a deleted row is skipped', () => {
    const hero = t.byId.get('a1')
    expect(hero.children.map(c => c.name)).toEqual(['clip.mov', 'Hero_v001.mov', 'board.png'].sort((x, y) => x.localeCompare(y, undefined, { sensitivity: 'base' })))
    expect(t.byId.get('s1').children.map(c => c.name)).toEqual(['take.wav'])
    expect(t.root.children.filter(c => c.kind === 'file').map(c => c.name)).toEqual(['loose.png', 'notes.txt'])
    expect(t.fileCount).toBe(6)
    expect([...t.byId.keys()]).not.toContain('f:f4')
  })
  it('carries the facts the details panel prints', () => {
    const clip = t.byId.get('f:f1')
    expect(clip.meta).toMatchObject({ type: 'Video · MOV', kind: 'video', sizeBytes: 1000, createdAt: '2026-09-11T01:00:00Z', durationSec: 12.5, provider: 'local_server', source: 'files' })
    expect(clip.path).toBe('assets/hero-shot/clip.mov')
    const managed = t.byId.get('m:m1')
    expect(managed.meta).toMatchObject({ type: 'Video · MOV', sizeBytes: 4000, durationSec: 4, provider: 'local_managed', source: 'managed', createdAt: '2026-09-11T02:00:00Z' })
    expect(t.byId.get('f:f5').meta.modifiedAt).toBe('2026-09-09T00:00:00Z')
    expect(breadcrumb(clip)).toBe('ASSETS › hero-shot › clip.mov')
  })
  it('makes a synthetic root when the rows have none, and sorts folders before files', () => {
    const u = buildFileTree({ folders: [{ id: 'x', kind: 'category', path: 'ASSETS' }], files: [{ id: '1', name: 'z.txt' }, { id: '2', name: 'a.txt' }] })
    expect(u.root.id).toBe(ROOT_ID)
    expect(u.root.children.map(c => c.name)).toEqual(['ASSETS', 'a.txt', 'z.txt'])
  })
  it('tolerates nothing at all', () => {
    const e = buildFileTree({})
    expect(e.root.children).toEqual([])
    expect(flattenTree(e.root)).toEqual([])
    expect(columnsFor(e.root, ['nope'])).toHaveLength(1)
  })
})

describe('flattenTree / filterFlat / sortRows', () => {
  const t = buildFileTree({ folders, files, managedFiles })
  const flat = flattenTree(t.root)
  it('lists every node once, depth-first, with depth', () => {
    expect(flat.length).toBe(t.folderCount + t.fileCount)
    const assets = flat.find(r => r.node.id === 'a')
    const clip = flat.find(r => r.node.id === 'f:f1')
    expect(assets.depth).toBe(0)
    expect(clip.depth).toBe(2)
    expect(flat.indexOf(assets)).toBeLessThan(flat.indexOf(clip))
  })
  it('filters by name or path and keeps the ancestors so the path reads', () => {
    const rows = filterFlat(flat, 'CLIP')
    expect(rows.map(r => r.node.id)).toEqual(['a', 'a1', 'f:f1'])
    expect(filterFlat(flat, '')).toBe(flat)
  })
  it('sorts by size, duration and created, folders first on ties', () => {
    const bySize = sortRows(flat.filter(r => r.node.kind === 'file'), 'size', 'desc').map(r => r.node.name)
    expect(bySize.slice(0, 2)).toEqual(['Hero_v001.mov', 'clip.mov'])
    const byDur = sortRows(flat.filter(r => r.node.kind === 'file'), 'duration', 'desc').map(r => r.node.meta.durationSec)
    expect(byDur.slice(0, 2)).toEqual([12.5, 4])
    const byCreated = sortRows(flat.filter(r => r.node.kind === 'file' && r.node.meta.createdAt), 'created', 'asc').map(r => r.node.name)
    expect(byCreated[0]).toBe('notes.txt')
  })
})

describe('columnsFor — one column per folder level', () => {
  const t = buildFileTree({ folders, files, managedFiles })
  it('opens a column per selected folder and stops at a file', () => {
    const cols = columnsFor(t.root, ['a', 'a1', 'f:f1'])
    expect(cols.map(c => c.folder.id)).toEqual(['r', 'a', 'a1'])
    expect(cols[2].items.map(i => i.name)).toContain('clip.mov')
  })
  it('ignores a selection that is not in the previous column', () => {
    const cols = columnsFor(t.root, ['a', 's1'])
    expect(cols.map(c => c.folder.id)).toEqual(['r', 'a'])
  })
})
