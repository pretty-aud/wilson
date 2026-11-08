// mothCatalogue.test.js — MO2: everything Moth shows, read once through Moth's own methods. The second look keeps
// a money or Legal row out even when a read lets it through, a failed read is not an empty one, a read that comes
// back after a newer one is dropped, and the light follows only what is read whole.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMothCatalogue, FILE_PAGE, MAX_FILE_PAGES } from './mothCatalogue.js'

const file = (id, extra = {}) => ({ id, name: `${id}.mov`, project_id: 'p1', folder_id: null, tags: [], storage_path: `p1/${id}.mov`, ...extra })
const absent = () => Object.assign(new Error('not on this database'), { code: 'moth_absent' })

let adapter
beforeEach(() => {
  adapter = {
    listMothIslands: vi.fn(async () => [{ id: 'p1', title: 'Salt Hours' }, { id: 'p2', title: 'Other' }]),
    listMothFolders: vi.fn(async () => [{ id: 'd1', parent_id: null, kind: 'custom', slug: 'shots', label: 'Shots' }]),
    listMothFiles: vi.fn(async (pid) => [file(`${pid}-a`, { project_id: pid })]),
    listMothItems: vi.fn(async () => ({ items: [{ id: 't1', kind: 'task', name: 'Grade' }], truncated: false })),
    listMothLinks: vi.fn(async () => ({ links: [{ source_kind: 'task', source_id: 't1', target_kind: 'folder', target_id: 'd1', link: 'entity_folder' }], truncated: false })),
    listMothFileFacts: vi.fn(async (pid) => [{ file_id: `${pid}-a`, editor_id: 'u1', task_id: 't1', asset_id: null }]),
  }
})

describe('createMothCatalogue', () => {
  it('reads every island whole and hands the engine one catalogue', async () => {
    const store = createMothCatalogue({ adapter })
    await store.loadAll()
    const snap = store.getSnapshot()
    expect(snap).toMatchObject({ total: 2, ready: 2, failed: 0, complete: true, islandsFailed: false, itemsAbsent: false })
    const c = store.catalogue()
    expect(c.islands.map((i) => i.id)).toEqual(['p1', 'p2'])
    expect(c.files.p1.map((f) => f.id)).toEqual(['p1-a'])
    expect(c.items.p2).toEqual([{ id: 't1', kind: 'task', name: 'Grade' }])
    expect(c.relations).toContainEqual({ source: { kind: 'task', id: 't1' }, target: { kind: 'folder', id: 'd1' }, label: 'entity_folder' })
    expect(c.relations).toContainEqual({ source: { kind: 'file', id: 'p1-a' }, target: { kind: 'task', id: 't1' }, label: 'file_task' })
    expect(store.catalogue()).toBe(c)
    expect(store.editorOf('p1', 'p1-a')).toBe('u1')
    expect(store.editorOf('p1', 'nobody')).toBeNull()
  })

  it('the second look drops a money or Legal row the read let through, and its lines and editor with it', async () => {
    adapter.listMothFiles = vi.fn(async () => [file('ok'), file('legal', { tags: ['legal'] }), file('money', { is_financial: true })])
    adapter.listMothFileFacts = vi.fn(async () => [{ file_id: 'legal', editor_id: 'u9', task_id: 't1' }])
    const store = createMothCatalogue({ adapter })
    await store.loadAll()
    expect(store.catalogue().files.p1.map((f) => f.id)).toEqual(['ok'])
    expect(store.catalogue().relations.some((r) => r.source.id === 'legal')).toBe(false)
    expect(store.editorOf('p1', 'legal')).toBeNull()
  })

  it('reads files a page at a time on the last id, and says when a project is not shown whole', async () => {
    const page = (n, from = 0) => Array.from({ length: n }, (_, i) => file(`f${String(from + i).padStart(6, '0')}`))
    adapter.listMothIslands = vi.fn(async () => [{ id: 'p1', title: 'Salt Hours' }])
    adapter.listMothFiles = vi.fn(async (_p, after) => (after ? page(3, FILE_PAGE) : page(FILE_PAGE)))
    let store = createMothCatalogue({ adapter })
    await store.loadAll()
    expect(adapter.listMothFiles).toHaveBeenNthCalledWith(1, 'p1', null, FILE_PAGE)
    expect(adapter.listMothFiles).toHaveBeenNthCalledWith(2, 'p1', `f${String(FILE_PAGE - 1).padStart(6, '0')}`, FILE_PAGE)
    expect(store.catalogue().files.p1).toHaveLength(FILE_PAGE + 3)
    expect(store.getSnapshot().project('p1').truncated).toBe(false)

    let n = 0
    adapter.listMothFiles = vi.fn(async () => page(FILE_PAGE, FILE_PAGE * n++))
    store = createMothCatalogue({ adapter })
    await store.loadAll()
    expect(adapter.listMothFiles).toHaveBeenCalledTimes(MAX_FILE_PAGES)
    expect(store.getSnapshot().project('p1').truncated).toBe(true)
  })

  it('a failed read is kept apart from an empty one, and the rest still show', async () => {
    adapter.listMothFolders = vi.fn(async (pid) => { if (pid === 'p2') throw new Error('no answer'); return [] })
    const store = createMothCatalogue({ adapter })
    await store.loadAll()
    const snap = store.getSnapshot()
    expect(snap).toMatchObject({ ready: 1, failed: 1, complete: true })
    expect(snap.project('p2')).toMatchObject({ status: 'failed', error: 'no answer', files: [] })
    expect(store.catalogue().files.p2).toBeUndefined()
    expect(store.catalogue().files.p1).toHaveLength(1)
    adapter.listMothFolders = vi.fn(async () => [])
    await store.retryProject('p2')
    expect(store.getSnapshot().project('p2').status).toBe('ready')
  })

  it('on a database without the graph reads, it shows files and folders and says nothing is wrong', async () => {
    adapter.listMothItems = vi.fn(async () => { throw absent() })
    adapter.listMothLinks = vi.fn(async () => { throw absent() })
    adapter.listMothFileFacts = vi.fn(async () => { throw absent() })
    const store = createMothCatalogue({ adapter })
    await store.loadAll()
    expect(store.getSnapshot()).toMatchObject({ ready: 2, failed: 0, itemsAbsent: true })
    expect(store.catalogue().relations).toEqual([])
    expect(store.catalogue().files.p1).toHaveLength(1)
  })

  it('any other failure of those reads fails the project, never shows it half read', async () => {
    adapter.listMothLinks = vi.fn(async () => { throw new Error('denied') })
    const store = createMothCatalogue({ adapter })
    await store.loadAll()
    expect(store.getSnapshot().project('p1')).toMatchObject({ status: 'failed', error: 'denied' })
  })

  it('a read that comes back after a newer read of the same project is dropped', async () => {
    adapter.listMothIslands = vi.fn(async () => [{ id: 'p1', title: 'Salt Hours' }])
    let release
    let first = true
    adapter.listMothFiles = vi.fn(async () => {
      if (first) { first = false; await new Promise((ok) => { release = ok }); return [file('late')] }
      return [file('fresh')]
    })
    const store = createMothCatalogue({ adapter })
    const loading = store.loadAll()
    await vi.waitFor(() => expect(release).toBeTruthy())
    await store.refresh(['p1', 'nobody'])
    release()
    await loading
    expect(store.catalogue().files.p1.map((f) => f.id)).toEqual(['fresh'])
    expect(adapter.listMothFolders).toHaveBeenCalledTimes(2)
  })

  it('the light follows only projects read whole', async () => {
    adapter.listMothFolders = vi.fn(async (pid) => { if (pid === 'p2') throw new Error('no'); return [] })
    const store = createMothCatalogue({ adapter })
    expect(store.glowSize()).toBe(0)
    await store.loadAll()
    const one = store.glowSize()
    expect(one).toBeGreaterThan(0)
    adapter.listMothFolders = vi.fn(async () => [])
    await store.refresh(['p2'])
    expect(store.glowSize()).toBeGreaterThan(one)
  })

  it('a project gone from the islands is forgotten; a failed island read says so', async () => {
    const store = createMothCatalogue({ adapter })
    await store.loadAll()
    adapter.listMothIslands = vi.fn(async () => [{ id: 'p1', title: 'Salt Hours' }])
    await store.loadAll()
    expect(store.getSnapshot().project('p2')).toBeNull()
    adapter.listMothIslands = vi.fn(async () => { throw new Error('offline') })
    await store.loadAll()
    expect(store.getSnapshot()).toMatchObject({ islandsFailed: true })
    expect(store.getSnapshot().islands.map((i) => i.id)).toEqual(['p1'])
  })

  it('tells its listeners, and nothing after it is destroyed', async () => {
    const store = createMothCatalogue({ adapter })
    const heard = vi.fn()
    store.subscribe(heard)
    await store.loadAll()
    expect(heard).toHaveBeenCalled()
    const before = heard.mock.calls.length
    store.destroy()
    await store.refresh(['p1'])
    expect(heard.mock.calls.length).toBe(before)
  })

  it('on the signed-out desktop, the second look is told what a row cannot say', async () => {
    adapter.mothHiddenFacts = vi.fn(async () => ({ expenseFileIds: ['p1-a'] }))
    const store = createMothCatalogue({ adapter })
    await store.loadAll()
    expect(store.catalogue().files.p1).toEqual([])
    expect(store.catalogue().files.p2.map((f) => f.id)).toEqual(['p2-a'])
  })

  it('MO3: a failed workspace read keeps what was drawn of that kind, says so, and replaces only the kinds it read', async () => {
    Object.assign(adapter, {
      listMothNotes: vi.fn(async () => [{ id: 'n1', title: 'Look of the film' }]),
      listMothTagTypes: vi.fn(async () => [{ id: 'ty1', name: 'Character', shape: 'star', colour: 'rose' }]),
      listMothTags: vi.fn(async () => [{ id: 'c1', label: 'Mira', type_id: 'ty1' }]),
      listMothTagAssignments: vi.fn(async () => [{ id: 'a1', tag_id: 'c1', target_type: 'file', target_id: 'p1-a' }]),
      listMothRelationships: vi.fn(async () => ({ links: [{ id: 'r1', source_kind: 'file', source_id: 'p1-a', target_kind: 'note', target_id: 'n1' }], truncated: true })),
    })
    const store = createMothCatalogue({ adapter })
    await store.loadAll()
    await store.readWorkspace()
    expect(store.getSnapshot().workspaceError).toBeNull()
    const offline = () => { throw new Error('offline') }
    adapter.listMothTagTypes = vi.fn(offline)
    adapter.listMothRelationships = vi.fn(offline)
    adapter.listMothNotes = vi.fn(async () => [{ id: 'n1', title: 'Look of the film' }, { id: 'n2', title: 'Second' }])
    await store.readWorkspace()
    const snap = store.getSnapshot()
    expect(snap.workspaceError).toBe('offline')
    expect(snap.workspace.mtags).toEqual([{ id: 'c1', label: 'Mira', type_id: 'ty1', shape: 'star', colour: 'rose', type_name: 'Character' }])
    expect(snap.workspace.types.map((t) => t.id)).toEqual(['ty1'])
    expect(snap.workspace.relationships.map((r) => r.id)).toEqual(['r1'])
    expect(snap.workspace.truncated).toBe(true)
    expect(snap.workspace.notes.map((n) => n.id)).toEqual(['n1', 'n2'])
    expect(store.catalogue().relations.some((r) => r.relationship === 'r1')).toBe(true)
    // A good read again clears the words.
    adapter.listMothTagTypes = vi.fn(async () => [])
    adapter.listMothRelationships = vi.fn(async () => ({ links: [], truncated: false }))
    await store.readWorkspace()
    expect(store.getSnapshot().workspaceError).toBeNull()
    expect(store.getSnapshot().workspace.relationships).toEqual([])
    expect(store.getSnapshot().workspace.mtags[0].type_name).toBe('')
  })

  it('MO3: a list of notes or typed tags read to its bound says so; a failed read keeps the sign, a whole one clears it', async () => {
    const cut = (rows) => Object.defineProperty(rows, 'truncated', { value: true, enumerable: false })
    Object.assign(adapter, {
      listMothNotes: vi.fn(async () => []),
      listMothTagTypes: vi.fn(async () => []),
      listMothTags: vi.fn(async () => cut([{ id: 'c1', label: 'Mira', type_id: null }])),
      listMothTagAssignments: vi.fn(async () => []),
      listMothRelationships: vi.fn(async () => ({ links: [], truncated: false })),
    })
    const store = createMothCatalogue({ adapter })
    await store.loadAll()
    await store.readWorkspace()
    expect(store.getSnapshot().workspace.cut).toBe(true)
    expect(store.getSnapshot().workspace.truncated).toBe(false)
    adapter.listMothTags = vi.fn(async () => { throw new Error('offline') })
    await store.readWorkspace()
    expect(store.getSnapshot().workspace.cut).toBe(true)
    adapter.listMothTags = vi.fn(async () => [{ id: 'c1', label: 'Mira', type_id: null }])
    await store.readWorkspace()
    expect(store.getSnapshot().workspace.cut).toBe(false)
  })

  it('MO3: the sign is kept per kind: the uses read whole again clear it while the notes fail', async () => {
    const cut = (rows) => Object.defineProperty(rows, 'truncated', { value: true, enumerable: false })
    Object.assign(adapter, {
      listMothNotes: vi.fn(async () => [{ id: 'n1', title: 'Look of the film' }]),
      listMothTagTypes: vi.fn(async () => []),
      listMothTags: vi.fn(async () => []),
      listMothTagAssignments: vi.fn(async () => cut([{ id: 'a1', tag_id: 'c1', target_type: 'file', target_id: 'p1-a' }])),
      listMothRelationships: vi.fn(async () => ({ links: [], truncated: false })),
    })
    const store = createMothCatalogue({ adapter })
    await store.loadAll()
    await store.readWorkspace()
    expect(store.getSnapshot().workspace.cut).toBe(true)
    adapter.listMothTagAssignments = vi.fn(async () => [])
    adapter.listMothNotes = vi.fn(async () => { throw new Error('timeout') })
    await store.readWorkspace()
    expect(store.getSnapshot().workspaceError).toBe('timeout')
    expect(store.getSnapshot().workspace.notes.map((n) => n.id)).toEqual(['n1'])
    expect(store.getSnapshot().workspace.cut).toBe(false)
    // A cut kind that fails keeps its own sign.
    adapter.listMothNotes = vi.fn(async () => cut([{ id: 'n1', title: 'Look of the film' }]))
    await store.readWorkspace()
    adapter.listMothNotes = vi.fn(async () => { throw new Error('timeout') })
    await store.readWorkspace()
    expect(store.getSnapshot().workspace.cut).toBe(true)
  })
})
