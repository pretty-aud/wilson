/** @vitest-environment jsdom */
// editDraftsProvider.test.jsx — the unsaved edit through the REAL provider
// (post-overhaul S3c, step 4; D13, D14, D17). The harness is
// shotListsProvider.test.jsx's: the provider over an in-memory adapter that
// keeps the contract's rules, driven end to end.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import React from 'react'
import { render, cleanup, act, waitFor, screen, within, fireEvent } from '@testing-library/react'
import { EDIT_DRAFTS_KEY, storedDraftKey } from './editDrafts'
import { confirmLeave, hasUnsavedWork, unsavedForClose, subscribeLeaveGuards, _resetLeaveGuardsForTests } from './leaveGuard'

const holder = vi.hoisted(() => ({ adapter: null, mode: 'local_server', session: null, writable: true, fixtures: null, authCbs: [] }))

vi.mock('../adapters', () => ({
  selectAdapter: () => holder.adapter,
  ADAPTER_MODES: ['supabase', 'local_server', 'google_drive'],
  adapterSupportsWrites: () => holder.writable,
}))
vi.mock('../adapters/supabaseAdapter', () => ({ resetSupabaseAdapter: () => {} }))
vi.mock('../../../cloud/auth/supabaseClient', () => ({
  supabase: {
    auth: {
      // Review round 1 (R1-02): the provider's auth events, played by the test.
      onAuthStateChange: (cb) => { holder.authCbs.push(cb); return { data: { subscription: { unsubscribe() {} } } } },
      getSession: async () => ({ data: { session: holder.session } }),
    },
  },
}))
vi.mock('../../../lib/localData', () => ({
  hasLocalServer: () => true,
  loadOtterSettings: async () => ({ rabbit: { adapterMode: holder.mode, activeProjectId: 'p1' } }),
  saveOtterSettings: async () => {},
}))
vi.mock('../../../dev/devFixtures', () => ({ devFixtures: () => holder.fixtures }))
vi.mock('../intake/pipeline', () => ({ runIngestion: vi.fn() }))

const { RabbitProvider, useRabbit } = await import('./RabbitProvider')
const { default: LeaveEditDialog, leaveWords } = await import('../views/scenes/LeaveEditDialog')

function httpError(status, message) {
  const e = new Error(message)
  e.status = status
  return e
}

function makeAdapter() {
  const db = {
    project: { id: 'p1', title: 'Salt Hours', active_shot_list_id: 'L1', scenes_enabled: true },
    scenes: [
      { id: 'sc1', project_id: 'p1', name: 'Harbour', scene_number: 1 },
      { id: 'sc2', project_id: 'p1', name: 'Lighthouse', scene_number: 2 },
    ],
    shots: [
      { id: 'sh1', project_id: 'p1', scene_id: 'sc1', name: 'Boats', shot_number: 10, frame_count: 48 },
      { id: 'sh2', project_id: 'p1', scene_id: 'sc2', name: 'The door', shot_number: 10, frame_count: 24 },
    ],
    shotLists: [
      { id: 'L1', project_id: 'p1', title: 'Shoot', version: 2, summary: null, snapshot: {}, archived_at: null, archived_by: null, created_at: '2026-09-01' },
      { id: 'L2', project_id: 'p1', title: 'Old', version: 1, summary: null, snapshot: {}, archived_at: '2026-09-02', archived_by: null, created_at: '2026-09-01' },
    ],
    shotListItems: [
      { id: 'i1', shot_list_id: 'L1', project_id: 'p1', scene_id: 'sc1', shot_id: null, position: 0 },
      { id: 'i2', shot_list_id: 'L1', project_id: 'p1', scene_id: 'sc2', shot_id: null, position: 1 },
      { id: 'i3', shot_list_id: 'L1', project_id: 'p1', scene_id: null, shot_id: 'sh1', position: 0 },
      { id: 'i4', shot_list_id: 'L1', project_id: 'p1', scene_id: null, shot_id: 'sh2', position: 0 },
    ],
    edits: [],
  }
  const clone = (x) => JSON.parse(JSON.stringify(x))
  const calls = []
  let n = 0
  const a = {
    mode: 'local_server',
    calls,
    db,
    failSave: false,
    status: async () => ({ online: true, lastSyncAt: null }),
    listProjects: async () => [clone(db.project)],
    loadProject: async () => clone({
      project: db.project, scenes: db.scenes, shots: db.shots, tasks: [],
      shotLists: db.shotLists, shotListItems: db.shotListItems, edits: db.edits,
    }),
    upsertShot: async (row) => { db.shots = [...db.shots.filter(s => s.id !== row.id), clone(row)]; return clone(row) },
    listShotLists: async () => clone(db.shotLists),
    listShotListItems: async () => clone(db.shotListItems),
    listEdits: async () => clone(db.edits),
    upsertShotListItems: async (_pid, listId, items) => {
      const written = items.map(it => ({ id: it.id || `item-${++n}`, shot_list_id: listId, project_id: 'p1', scene_id: it.scene_id || null, shot_id: it.shot_id || null, position: it.position ?? 0 }))
      db.shotListItems = [...db.shotListItems.filter(i => !written.some(w => w.id === i.id)), ...written]
      return clone(written)
    },
    repositionShotListItems: async (_pid, listId, items) => {
      const updated = []
      for (const it of items) {
        const row = db.shotListItems.find(i => i.id === it.id && i.shot_list_id === listId)
        if (!row) continue
        row.position = it.position
        updated.push({ ...row })
      }
      return clone(updated)
    },
    deleteShotListItems: async (_pid, listId, ids) => {
      const gone = db.shotListItems.filter(i => i.shot_list_id === listId && ids.includes(i.id)).map(i => i.id)
      db.shotListItems = db.shotListItems.filter(i => !gone.includes(i.id))
      return { deleted: gone }
    },
    // Review round 1 (R1-01): a list archived (and back), and one list's
    // edits refused on the way in.
    archiveShotList: async (_pid, listId, archived = true) => {
      calls.push(['archiveShotList', listId, archived])
      if (archived && db.project.active_shot_list_id === listId) throw httpError(409, 'the active shot list cannot be archived — make another list active first')
      db.shotLists = db.shotLists.map(l => (l.id === listId ? { ...l, archived_at: archived ? 'T' : null } : l))
      return clone(db.shotLists.find(l => l.id === listId))
    },
    failListId: null,
    // Review round 2 (R2-03): a write held open, for an event to land in the middle of it.
    gate: null,
    upsertEdit: async (row) => {
      if (a.gate) await a.gate
      const stored = db.edits.find(e => e.id === row.id)
      if (!stored && a.failListId && row.shot_list_id === a.failListId) throw httpError(500, 'disk full')
      if (stored && row.snapshot !== undefined && a.failSave) { a.failSave = false; throw httpError(500, 'disk full') }
      if (!stored && db.edits.some(e => e.shot_list_id === row.shot_list_id && e.title === row.title && e.version === row.version)) {
        throw httpError(409, 'This shot list already has an edit with this title and version.')
      }
      calls.push(['upsertEdit', row.id, stored ? 'update' : 'insert'])
      const next = { ...(stored || {}), ...clone(row), created_at: stored?.created_at || `2026-10-02T10:0${db.edits.length}:00Z`,
        created_by: stored ? (stored.created_by ?? null) : (holder.session?.user?.id ?? null) }
      db.edits = [...db.edits.filter(e => e.id !== row.id), next]
      return clone(next)
    },
    archiveEdit: async (_pid, editId, archived = true) => {
      calls.push(['archiveEdit', editId, archived])
      db.edits = db.edits.map(e => (e.id === editId ? { ...e, archived_at: archived ? 'T' : null,
        archived_by: archived ? (e.archived_by ?? holder.session?.user?.id ?? null) : null } : e))
      return clone(db.edits.find(e => e.id === editId))
    },
  }
  return a
}

let ctxRef
function Probe() {
  ctxRef = useRabbit()
  return null
}

async function mount(lists = 2) {
  render(<RabbitProvider><Probe /></RabbitProvider>)
  await waitFor(() => expect(ctxRef?.project?.id).toBe('p1'))
  await waitFor(() => expect(ctxRef.shotLists.length).toBe(lists))
}

const item = (id, shot, scene, label = '') => ({ id, scene_id: scene, shot_id: shot, label, notes: '' })
const BASE = [item('a', 'sh1', 'sc1', 'Boats'), item('b', 'sh2', 'sc2', 'The door')]
const MOVED = [item('b', 'sh2', 'sc2', 'The door'), item('a', 'sh1', 'sc1', 'Boats')]
const ids = (rows) => rows.map(r => r.id)
const stored = () => JSON.parse(localStorage.getItem(EDIT_DRAFTS_KEY) || '{}')

async function startDraft(extra = {}) {
  let d
  await act(async () => { d = ctxRef.startEditDraft({ listId: 'L1', title: 'Shoot', version: 1, base: BASE, items: MOVED, ...extra }) })
  return d
}

beforeEach(() => {
  holder.adapter = makeAdapter()
  holder.mode = 'local_server'
  holder.session = null
  holder.writable = true
  holder.fixtures = null
  holder.authCbs = []
  ctxRef = null
  localStorage.clear()
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('S3c — the draft lives in the provider (D13)', () => {
  it('Yes makes a draft of the list: dirty, keyed by list, written nowhere but a localStorage copy', async () => {
    await mount()
    expect(ctxRef.editDraftOf('L1')).toBeNull()
    expect(ctxRef.hasUnsavedEdit).toBe(false)
    await startDraft()
    const d = ctxRef.editDraftOf('L1')
    expect(d).toMatchObject({ listId: 'L1', basedOnEditId: null, title: 'Shoot', version: 1, dirty: true })
    expect(ids(d.items)).toEqual(['b', 'a'])
    expect(ctxRef.hasUnsavedEdit).toBe(true)
    expect(ctxRef.editDrafts).toHaveLength(1)
    expect(holder.adapter.calls).toEqual([])
    expect(stored()[storedDraftKey('local', 'p1', 'L1')]).toMatchObject({ listId: 'L1', projectId: 'p1', title: 'Shoot' })
  })

  it('one draft per list; none on an archived list (in the backend\'s words)', async () => {
    await mount()
    await startDraft()
    expect(() => ctxRef.startEditDraft({ listId: 'L1', title: 'X', version: 1, base: [], items: [] })).toThrow('this shot list already has an unsaved edit')
    expect(() => ctxRef.startEditDraft({ listId: 'L2', title: 'X', version: 1, base: [], items: [] })).toThrow('this shot list is archived — restore it before changing it')
  })

  it('each change is a step of the draft\'s own undo; its copy follows every change', async () => {
    await mount()
    await startDraft()
    await act(async () => { ctxRef.changeEditDraft('L1', [MOVED[0]]) })
    expect(ids(ctxRef.editDraftOf('L1').items)).toEqual(['b'])
    expect(ids(stored()[storedDraftKey('local', 'p1', 'L1')].items)).toEqual(['b'])
    let did
    await act(async () => { did = ctxRef.undoEditDraft('L1') })
    expect(did).toBe(true)
    expect(ids(ctxRef.editDraftOf('L1').items)).toEqual(['b', 'a'])
    await act(async () => { ctxRef.undoEditDraft('L1') })
    expect(ids(ctxRef.editDraftOf('L1').items)).toEqual(['a', 'b'])
    await act(async () => { did = ctxRef.undoEditDraft('L1') })
    expect(did).toBe(false)
    // Back where it started, it is still a draft (D13: no second question).
    expect(ctxRef.editDraftOf('L1').dirty).toBe(true)
    await act(async () => { ctxRef.redoEditDraft('L1') })
    expect(ids(ctxRef.editDraftOf('L1').items)).toEqual(['b', 'a'])
  })

  it('the provider\'s Ctrl+Z / Ctrl+Y stand down while a draft is dirty, and come back when it goes', async () => {
    await mount()
    await act(async () => { await ctxRef.reorderShotListItems('L1', ['sc2', 'sc1']) })
    expect(ids(ctxRef.scenesOf('L1'))).toEqual(['sc2', 'sc1'])
    expect(ctxRef.canUndo).toBe(true)
    await startDraft()
    expect(ctxRef.canUndo).toBe(false)
    await act(async () => { await ctxRef.undo() })
    expect(ids(ctxRef.scenesOf('L1'))).toEqual(['sc2', 'sc1'])
    await act(async () => { ctxRef.discardEditDraft('L1') })
    expect(ctxRef.canUndo).toBe(true)
    await act(async () => { await ctxRef.undo() })
    expect(ids(ctxRef.scenesOf('L1'))).toEqual(['sc1', 'sc2'])
    // …and Ctrl+Y the same: standing down under a draft, back after it.
    expect(ctxRef.canRedo).toBe(true)
    await startDraft()
    expect(ctxRef.canRedo).toBe(false)
    await act(async () => { await ctxRef.redo() })
    expect(ids(ctxRef.scenesOf('L1'))).toEqual(['sc1', 'sc2'])
    await act(async () => { ctxRef.discardEditDraft('L1') })
    await act(async () => { await ctxRef.redo() })
    expect(ids(ctxRef.scenesOf('L1'))).toEqual(['sc2', 'sc1'])
  })

  it('Discard changes: the draft and its copy go, nothing was written', async () => {
    await mount()
    await startDraft()
    let did
    await act(async () => { did = ctxRef.discardEditDraft('L1') })
    expect(did).toBe(true)
    expect(ctxRef.editDraftOf('L1')).toBeNull()
    expect(ctxRef.hasUnsavedEdit).toBe(false)
    expect(localStorage.getItem(EDIT_DRAFTS_KEY)).toBeNull()
    expect(holder.adapter.db.edits).toEqual([])
  })
})

describe('S3c — Save edit (D13, D14, D17)', () => {
  it('writes the chain\'s next edit, Saved with the names it holds, labels as the shots are named now; the draft goes', async () => {
    await mount()
    await startDraft()
    // Renamed while the draft was open: the saved label is the name now.
    await act(async () => { await ctxRef.updateShot('sh2', { name: 'The red door' }) })
    let row
    await act(async () => { row = await ctxRef.saveEditDraft('L1', { title: 'Shoot', summary: '  Door first  ' }) })
    const db = holder.adapter.db.edits
    expect(db).toHaveLength(1)
    expect(db[0]).toMatchObject({ shot_list_id: 'L1', title: 'Shoot', version: 1, summary: 'Door first', parent_edit_id: null })
    expect(db[0].items.map(i => [i.id, i.shot_id, i.label])).toEqual([['b', 'sh2', 'The red door'], ['a', 'sh1', 'Boats']])
    expect(db[0].snapshot).toMatchObject({ kind: 'edit', item_count: 2 })
    expect(db[0].snapshot.shots.sh2.name).toBe('The red door')
    expect(db[0].snapshot.scenes.sc2.name).toBe('Lighthouse')
    expect(row.id).toBe(db[0].id)
    expect(ctxRef.editDraftOf('L1')).toBeNull()
    expect(localStorage.getItem(EDIT_DRAFTS_KEY)).toBeNull()
    expect(ctxRef.hasUnsavedEdit).toBe(false)
  })

  it('is ONE undo step: Ctrl+Z takes the Save back and withdraws the edit (Recently removed); Ctrl+Y restores and re-Saves it', async () => {
    await mount()
    await startDraft()
    let row
    await act(async () => { row = await ctxRef.saveEditDraft('L1', { title: 'Shoot' }) })
    await act(async () => { await ctxRef.undo() })
    let e = holder.adapter.db.edits.find(x => x.id === row.id)
    expect(e.snapshot).toBeNull()
    expect(e.archived_at).toBeTruthy()
    expect(ctxRef.recentlyWithdrawn).toMatchObject({ kind: 'edit', id: row.id })
    // ONE step: nothing of the Save is left under it.
    expect(ctxRef.canUndo).toBe(false)
    await act(async () => { await ctxRef.redo() })
    e = holder.adapter.db.edits.find(x => x.id === row.id)
    expect(e.archived_at).toBeNull()
    expect(e.snapshot).toMatchObject({ kind: 'edit' })
    // …and the step before it is still the one before (nothing joined it).
    await act(async () => { await ctxRef.undo() })
    expect(holder.adapter.db.edits.find(x => x.id === row.id).archived_at).toBeTruthy()
  })

  it('a draft begun from an OLDER edit saves as the chain\'s next edit, with that edit\'s items changed', async () => {
    await mount()
    await startDraft()
    let v1
    await act(async () => { v1 = await ctxRef.saveEditDraft('L1', { title: 'Shoot' }) })
    await startDraft({ basedOnEditId: v1.id, base: MOVED, items: [MOVED[1]], version: 2 })
    let v2
    await act(async () => { v2 = await ctxRef.saveEditDraft('L1', { title: 'Shoot' }) })
    await startDraft({ basedOnEditId: v1.id, base: MOVED, items: BASE, version: 3 })
    let v3
    await act(async () => { v3 = await ctxRef.saveEditDraft('L1', { title: 'Shoot' }) })
    expect([v1.version, v2.version, v3.version]).toEqual([1, 2, 3])
    expect(v2.parent_edit_id).toBe(v1.id)
    expect(v3.parent_edit_id).toBe(v2.id)
    expect(v3.items.map(i => i.id)).toEqual(['a', 'b'])
  })

  it('a refusal before the write is thrown verbatim and the draft stays', async () => {
    await mount()
    await startDraft()
    await act(async () => { await ctxRef.saveEditDraft('L1', { title: 'Shoot' }) })
    await startDraft({ version: 2 })
    await expect(ctxRef.saveEditDraft('L1', { title: 'Shoot', version: 1 })).rejects.toThrow('This shot list already has an edit called "Shoot · v1".')
    expect(ctxRef.editDraftOf('L1')).not.toBeNull()
    expect(holder.adapter.db.edits).toHaveLength(1)
  })

  it('once written the draft goes; a Save refused after it says the edit WAS saved, and its undo is the plain withdraw', async () => {
    await mount()
    await startDraft()
    holder.adapter.failSave = true
    let err
    await act(async () => { try { await ctxRef.saveEditDraft('L1', { title: 'Shoot' }) } catch (e) { err = e } })
    expect(err.message).toBe('The edit was saved as “Shoot · v1”, but the names it holds were not: disk full')
    expect(err.savedRow.id).toBe(holder.adapter.db.edits[0].id)
    expect(ctxRef.editDraftOf('L1')).toBeNull()
    expect(holder.adapter.db.edits[0].snapshot).toBeNull()
    await act(async () => { await ctxRef.undo() })
    expect(holder.adapter.db.edits[0].archived_at).toBeTruthy()
  })
})

describe('S3c — "Recover unsaved edit?"', () => {
  function seedCopy(extra = {}) {
    const copy = { personKey: 'local', projectId: 'p1', listId: 'L1', basedOnEditId: null, title: 'Shoot', version: 1, base: BASE, items: MOVED, changedAt: '2026-10-02T09:00:00Z', ...extra }
    localStorage.setItem(EDIT_DRAFTS_KEY, JSON.stringify({ [storedDraftKey(copy.personKey, copy.projectId, copy.listId)]: copy }))
    return copy
  }

  it('a copy a previous run left is offered for its project, and Recover makes it the list\'s draft again', async () => {
    seedCopy()
    await mount()
    expect(ctxRef.editDraftOf('L1')).toBeNull()
    expect(ctxRef.recoverableEditDrafts.map(c => c.listId)).toEqual(['L1'])
    await act(async () => { ctxRef.recoverEditDraft('L1') })
    const d = ctxRef.editDraftOf('L1')
    expect(ids(d.items)).toEqual(['b', 'a'])
    expect(d.dirty).toBe(true)
    expect(ctxRef.recoverableEditDrafts).toEqual([])
    expect(ctxRef.hasUnsavedEdit).toBe(true)
  })

  it('Discard drops the copy; someone else\'s copy, or another project\'s, is not offered', async () => {
    seedCopy()
    const all = JSON.parse(localStorage.getItem(EDIT_DRAFTS_KEY))
    all['u9|p1|L1'] = { ...all['local|p1|L1'], personKey: 'u9' }
    all['local|p2|L1'] = { ...all['local|p1|L1'], projectId: 'p2' }
    localStorage.setItem(EDIT_DRAFTS_KEY, JSON.stringify(all))
    await mount()
    expect(ctxRef.recoverableEditDrafts).toHaveLength(1)
    await act(async () => { ctxRef.dismissStoredEditDraft('L1') })
    expect(ctxRef.recoverableEditDrafts).toEqual([])
    expect(Object.keys(JSON.parse(localStorage.getItem(EDIT_DRAFTS_KEY))).sort()).toEqual(['local|p2|L1', 'u9|p1|L1'])
  })

  it('a copy of an archived list cannot be recovered (the backend\'s words); a new draft of the list supersedes a copy', async () => {
    seedCopy({ listId: 'L2' })
    await mount()
    expect(() => ctxRef.recoverEditDraft('L2')).toThrow('this shot list is archived — restore it before changing it')
    localStorage.clear()
    seedCopy()
    cleanup()
    await mount()
    expect(ctxRef.recoverableEditDrafts).toHaveLength(1)
    await startDraft()
    expect(ctxRef.recoverableEditDrafts).toEqual([])
  })
})

describe('S3c step 7 — the unsaved edit asks before every exit (D12)', () => {
  const mountWithQuestion = async () => {
    render(<RabbitProvider><Probe /><LeaveEditDialog /></RabbitProvider>)
    await waitFor(() => expect(ctxRef?.project?.id).toBe('p1'))
    await waitFor(() => expect(ctxRef.shotLists.length).toBe(2))
  }
  afterEach(() => _resetLeaveGuardsForTests())

  it('nothing unsaved: an exit goes on at once, asking nothing', async () => {
    await mountWithQuestion()
    expect(hasUnsavedWork('tab')).toBe(false)
    expect(await confirmLeave('tab')).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('with a draft every exit but a popup jump asks, in the kit Dialog: the edit named, Keep editing first and focused', async () => {
    await mountWithQuestion()
    await startDraft()
    for (const reason of ['tab', 'page', 'project', 'edit', 'close']) expect(hasUnsavedWork(reason), reason).toBe(true)
    expect(hasUnsavedWork('popup')).toBe(false)
    let went
    act(() => { confirmLeave('tab').then((g) => { went = g }) })
    const q = await screen.findByRole('dialog', { name: 'Save the edit before leaving?' })
    expect(q.textContent).toContain('“Shoot · v1”, an edit of “Shoot · v2”, is not saved. Save edit keeps it as its next version; Discard changes drops it; Keep editing goes back to it.')
    expect([...q.querySelectorAll('.ui-dialog-foot button')].map(b => b.textContent)).toEqual(['Keep editing', 'Discard changes', 'Save edit'])
    expect(document.activeElement.textContent).toBe('Keep editing')
    await act(async () => { fireEvent.click(within(q).getByRole('button', { name: 'Keep editing' })) })
    expect(went).toBe(false)
    expect(ctxRef.editDraftOf('L1')).not.toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Save edit writes it as its next version, then the exit goes on; Discard changes drops it, then goes on', async () => {
    await mountWithQuestion()
    await startDraft()
    let went
    act(() => { confirmLeave('page').then((g) => { went = g }) })
    let q = await screen.findByRole('dialog', { name: 'Save the edit before leaving?' })
    await act(async () => { fireEvent.click(within(q).getByRole('button', { name: 'Save edit' })) })
    await waitFor(() => expect(went).toBe(true))
    expect(holder.adapter.db.edits.map(e => [e.title, e.version])).toEqual([['Shoot', 1]])
    expect(ctxRef.hasUnsavedEdit).toBe(false)
    await startDraft({ version: 2 })
    went = undefined
    act(() => { confirmLeave('project').then((g) => { went = g }) })
    q = await screen.findByRole('dialog', { name: 'Save the edit before leaving?' })
    await act(async () => { fireEvent.click(within(q).getByRole('button', { name: 'Discard changes' })) })
    await waitFor(() => expect(went).toBe(true))
    expect(ctxRef.editDraftOf('L1')).toBeNull()
    expect(holder.adapter.db.edits).toHaveLength(1)
  })

  it('a refused Save stays in the question, verbatim, and the exit waits', async () => {
    await mountWithQuestion()
    await startDraft()
    await act(async () => { await ctxRef.saveEditDraft('L1', { title: 'Shoot' }) })
    await startDraft({ version: 2 })
    // Someone else's "Shoot · v2" landed meanwhile, unseen here: the backend refuses.
    holder.adapter.db.edits.push({ ...holder.adapter.db.edits[0], id: 'clash', version: 2 })
    let went
    act(() => { confirmLeave('tab').then((g) => { went = g }) })
    const q = await screen.findByRole('dialog', { name: 'Save the edit before leaving?' })
    await act(async () => { fireEvent.click(within(q).getByRole('button', { name: 'Save edit' })) })
    expect(within(q).getByRole('alert').textContent).toBe('This shot list already has an edit with this title and version.')
    expect(went).toBeUndefined()
    expect(ctxRef.editDraftOf('L1')).not.toBeNull()
    await act(async () => { fireEvent.click(within(q).getByRole('button', { name: 'Keep editing' })) })
    expect(went).toBe(false)
  })

  it('the window\'s close folds the same three answers in: the words, Save, Discard (no second dialog)', async () => {
    await mountWithQuestion()
    await startDraft()
    const [g] = unsavedForClose()
    expect(g.describe()).toBe('“Shoot · v1”, an edit of “Shoot · v2”, is not saved.')
    await act(async () => { await g.save() })
    expect(holder.adapter.db.edits).toHaveLength(1)
    expect(unsavedForClose()).toEqual([])
    await startDraft({ version: 2 })
    act(() => { unsavedForClose()[0].discard() })
    expect(ctxRef.editDraftOf('L1')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('S3c review round 1 — a draft whose list goes, two drafts, another person', () => {
  const PICKUPS = { id: 'L3', project_id: 'p1', title: 'Pickups', version: 1, summary: null, snapshot: {}, archived_at: null, archived_by: null, created_at: '2026-09-03' }
  const withPickups = () => {
    holder.adapter.db.shotLists.push({ ...PICKUPS })
    holder.adapter.db.shotListItems.push(
      { id: 'i5', shot_list_id: 'L3', project_id: 'p1', scene_id: 'sc1', shot_id: null, position: 0 },
      { id: 'i6', shot_list_id: 'L3', project_id: 'p1', scene_id: null, shot_id: 'sh1', position: 0 },
    )
  }
  const pickupsDraft = async () => {
    await act(async () => { ctxRef.startEditDraft({ listId: 'L3', title: 'Pickups', version: 1, base: [item('x', 'sh1', 'sc1', 'Boats')], items: [] }) })
  }
  afterEach(() => _resetLeaveGuardsForTests())

  it('R1-01: its list archived, a draft goes dormant — off screen, asking nothing, the undo keys back — and comes back with the list', async () => {
    withPickups()
    await mount(3)
    await pickupsDraft()
    expect(ctxRef.hasUnsavedEdit).toBe(true)
    expect(hasUnsavedWork('tab')).toBe(true)
    await act(async () => { await ctxRef.archiveShotList('L3') })
    // Dormant: nobody's question, not on screen, the provider's undo back.
    expect(ctxRef.editDraftOf('L3')).toBeNull()
    expect(ctxRef.hasUnsavedEdit).toBe(false)
    for (const reason of ['tab', 'page', 'project', 'edit', 'close']) expect(hasUnsavedWork(reason), reason).toBe(false)
    expect(unsavedForClose()).toEqual([])
    expect(ctxRef.canUndo).toBe(true)
    // …and not lost: its copy waits, and Ctrl+Z (the archive's undo) brings
    // the list back with its draft as it was.
    expect(stored()[storedDraftKey('local', 'p1', 'L3')]).toBeTruthy()
    await act(async () => { await ctxRef.undo() })
    expect(ctxRef.shotLists.find(l => l.id === 'L3').archived_at).toBeFalsy()
    expect(ctxRef.editDraftOf('L3')?.items).toEqual([])
    expect(hasUnsavedWork('tab')).toBe(true)
  })

  it('R1-01: a dormant draft beside a live one — the questions are about the live one alone: its words, its count, and Save edit saves it without trying the other', async () => {
    withPickups()
    await mount(3)
    await startDraft()
    await pickupsDraft()
    await act(async () => { await ctxRef.archiveShotList('L3') })
    expect(ctxRef.unsavedEditCount()).toBe(1)
    expect(ctxRef.describeUnsavedEdits()).toBe('“Shoot · v1”, an edit of “Shoot · v2”, is not saved.')
    expect(unsavedForClose()[0].count()).toBe(1)
    await act(async () => { await ctxRef.saveOpenDrafts() })
    expect(holder.adapter.db.edits.map(e => e.shot_list_id)).toEqual(['L1'])
    // The dormant one is still there, waiting for its list.
    expect(stored()[storedDraftKey('local', 'p1', 'L3')]).toBeTruthy()
    expect(hasUnsavedWork('tab')).toBe(false)
  })

  it('R1-01: with two drafts, Save edit saves every one it can — a refusal does not stop the rest — and names what was not saved', async () => {
    withPickups()
    await mount(3)
    await startDraft()
    await pickupsDraft()
    holder.adapter.failListId = 'L3'
    let err
    await act(async () => { try { await ctxRef.saveOpenDrafts() } catch (e) { err = e } })
    expect(err?.message).toBe('“Pickups · v1” was not saved: disk full')
    expect(holder.adapter.db.edits.map(e => e.shot_list_id)).toEqual(['L1'])
    expect(ctxRef.editDraftOf('L1')).toBeNull()
    expect(ctxRef.editDraftOf('L3')).not.toBeNull()
    expect(ctxRef.unsavedEditCount()).toBe(1)
  })

  it('R1-01: one draft refused keeps the backend\'s own words (as before); the leave words count the drafts', async () => {
    withPickups()
    await mount(3)
    await startDraft()
    await pickupsDraft()
    expect(ctxRef.unsavedEditCount()).toBe(2)
    expect(ctxRef.describeUnsavedEdits()).toBe('2 edits are not saved: “Shoot · v1” (of “Shoot · v2”) and “Pickups · v1” (of “Pickups · v1”).')
    // R1-12: of two, the leave question says "each" and "them", not "it".
    expect(leaveWords(ctxRef.describeUnsavedEdits(), ctxRef.unsavedEditCount()))
      .toBe('2 edits are not saved: “Shoot · v1” (of “Shoot · v2”) and “Pickups · v1” (of “Pickups · v1”). Save edit keeps each as its next version; Discard changes drops them; Keep editing goes back to them.')
    expect(unsavedForClose()[0].count()).toBe(2)
    act(() => { ctxRef.discardEditDraft('L3') })
    expect(leaveWords(ctxRef.describeUnsavedEdits(), ctxRef.unsavedEditCount())).toContain('Save edit keeps it as its next version; Discard changes drops it; Keep editing goes back to it.')
    holder.adapter.failListId = 'L1'
    let err
    await act(async () => { try { await ctxRef.saveOpenDrafts() } catch (e) { err = e } })
    expect(err?.message).toBe('disk full')
  })

  it('R1-02: a draft in memory is the signed-in person\'s — a sign-out takes it from memory, the next person never meets it, and its copy waits for its own person', async () => {
    await mount()
    const signIn = async (id) => { await act(async () => { for (const cb of holder.authCbs) cb('SIGNED_IN', { user: { id } }); await new Promise(r => setTimeout(r, 5)) }) }
    const signOut = async () => { await act(async () => { for (const cb of holder.authCbs) cb('SIGNED_OUT', null); await new Promise(r => setTimeout(r, 5)) }) }
    await signIn('user-A')
    await startDraft()
    expect(Object.keys(stored())).toEqual([storedDraftKey('user-A', 'p1', 'L1')])
    expect(ctxRef.hasUnsavedEdit).toBe(true)
    await signOut()
    await signIn('user-B')
    expect(ctxRef.editDraftOf('L1')).toBeNull()
    expect(ctxRef.hasUnsavedEdit).toBe(false)
    expect(hasUnsavedWork('tab')).toBe(false)
    expect(ctxRef.recoverableEditDrafts).toEqual([])
    // A's copy is still A's, and A signing back in is offered it.
    expect(stored()[storedDraftKey('user-A', 'p1', 'L1')]).toBeTruthy()
    await signOut()
    await signIn('user-A')
    expect(ctxRef.recoverableEditDrafts.map(c => [c.personKey, c.listId])).toEqual([['user-A', 'L1']])
  })
})

describe('S3c review round 2 — a question about drafts that went; whose copy a save removes', () => {
  const PICKUPS = { id: 'L3', project_id: 'p1', title: 'Pickups', version: 1, summary: null, snapshot: {}, archived_at: null, archived_by: null, created_at: '2026-09-03' }
  const withPickups = () => {
    holder.adapter.db.shotLists.push({ ...PICKUPS })
    holder.adapter.db.shotListItems.push(
      { id: 'i5', shot_list_id: 'L3', project_id: 'p1', scene_id: 'sc1', shot_id: null, position: 0 },
      { id: 'i6', shot_list_id: 'L3', project_id: 'p1', scene_id: null, shot_id: 'sh1', position: 0 },
    )
  }
  const mountWithQuestion = async (lists = 2) => {
    render(<RabbitProvider><Probe /><LeaveEditDialog /></RabbitProvider>)
    await waitFor(() => expect(ctxRef?.project?.id).toBe('p1'))
    await waitFor(() => expect(ctxRef.shotLists.length).toBe(lists))
  }
  const auth = async (event, id) => {
    holder.session = id ? { user: { id } } : null
    await act(async () => { for (const cb of holder.authCbs) cb(event, holder.session); await new Promise(r => setTimeout(r, 5)) })
  }
  const ask = (reason = 'tab') => {
    const out = { went: undefined }
    act(() => { confirmLeave(reason).then((g) => { out.went = g }) })
    return out
  }
  afterEach(() => _resetLeaveGuardsForTests())

  it('R2-01: a sign-out under the open leave question settles it as "go" — no question about nothing, no Save edit that saves nothing; the copy waits for its person', async () => {
    await mountWithQuestion()
    await auth('SIGNED_IN', 'user-A')
    await startDraft()
    const out = ask('tab')
    const q = await screen.findByRole('dialog', { name: 'Save the edit before leaving?' })
    expect(q.textContent).toContain('“Shoot · v1”, an edit of “Shoot · v2”, is not saved.')
    await auth('SIGNED_OUT', null)
    await waitFor(() => expect(out.went).toBe(true))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ctxRef.leaveAsk).toBeNull()
    expect(ctxRef.describeUnsavedEdits()).toBe('')
    expect(holder.adapter.db.edits).toEqual([])
    expect(stored()[storedDraftKey('user-A', 'p1', 'L1')]).toBeTruthy()
    // The lock is let go: the next exit asks (or not) afresh.
    expect(await confirmLeave('tab')).toBe(true)
  })

  // The question settles in the commit after its drafts go; the commit
  // between draws it with nothing to name (a passive effect runs after the
  // paint). Its words in that commit are read off the DOM's own mutation
  // records, which keep a text node's last words after it is gone.
  it('R2-01: the question never draws itself with nothing to name, not even for the commit before it settles', async () => {
    await mountWithQuestion()
    await auth('SIGNED_IN', 'user-A')
    await startDraft()
    const out = ask('tab')
    await screen.findByRole('dialog', { name: 'Save the edit before leaving?' })
    const words = []
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'characterData') words.push(r.target.data)
        for (const n of r.addedNodes) words.push(n.textContent)
      }
    })
    mo.observe(document.body, { subtree: true, childList: true, characterData: true })
    await auth('SIGNED_OUT', null)
    await waitFor(() => expect(out.went).toBe(true))
    await new Promise((r) => setTimeout(r, 0))
    mo.disconnect()
    expect(words.filter(w => /^\s*Save edit keeps/.test(w || ''))).toEqual([])
  })

  it('R2-01: its list archived elsewhere (a refresh) under the open question — settled as "go", the draft dormant and kept', async () => {
    withPickups()
    await mountWithQuestion(3)
    await act(async () => { ctxRef.startEditDraft({ listId: 'L3', title: 'Pickups', version: 1, base: [item('x', 'sh1', 'sc1', 'Boats')], items: [] }) })
    const out = ask('page')
    await screen.findByRole('dialog', { name: 'Save the edit before leaving?' })
    holder.adapter.db.shotLists = holder.adapter.db.shotLists.map(l => (l.id === 'L3' ? { ...l, archived_at: 'T' } : l))
    await act(async () => { await ctxRef.refreshShotLists() })
    await waitFor(() => expect(out.went).toBe(true))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(stored()[storedDraftKey('local', 'p1', 'L3')]).toBeTruthy()
    expect(holder.adapter.db.edits).toEqual([])
  })

  it('R2-01: CONTROL — while a live draft remains the question stays (a draft going beside it does not settle it)', async () => {
    withPickups()
    await mountWithQuestion(3)
    await startDraft()
    await act(async () => { ctxRef.startEditDraft({ listId: 'L3', title: 'Pickups', version: 1, base: [item('x', 'sh1', 'sc1', 'Boats')], items: [] }) })
    const out = ask('tab')
    const q = await screen.findByRole('dialog', { name: 'Save the edit before leaving?' })
    await act(async () => { ctxRef.discardEditDraft('L3') })
    expect(out.went).toBeUndefined()
    expect(q.textContent).toContain('“Shoot · v1”, an edit of “Shoot · v2”, is not saved. Save edit keeps it as its next version;')
    await act(async () => { fireEvent.click(within(q).getByRole('button', { name: 'Keep editing' })) })
    expect(out.went).toBe(false)
  })

  it('R2-01: the close guard read when the question opened follows the work — no words and not dirty once it has gone (never "0 edits … undefined")', async () => {
    await mountWithQuestion()
    await auth('SIGNED_IN', 'user-A')
    await startDraft()
    const [g] = unsavedForClose()
    expect(g.describe()).toBe('“Shoot · v1”, an edit of “Shoot · v2”, is not saved.')
    expect(g.dirty()).toBe(true)
    await auth('SIGNED_OUT', null)
    expect(g.describe()).toBe('')
    expect(g.describe()).not.toMatch(/undefined|0 edits/)
    expect(g.dirty()).toBe(false)
    expect(g.count()).toBe(0)
    expect(unsavedForClose()).toEqual([])
  })

  it('R2-01: an edit written whose names alone were refused is SAVED — the leave question goes, the exit goes on, and the refusal is the provider\'s error', async () => {
    await mountWithQuestion()
    await startDraft()
    holder.adapter.failSave = true
    const out = ask('tab')
    const q = await screen.findByRole('dialog', { name: 'Save the edit before leaving?' })
    await act(async () => { fireEvent.click(within(q).getByRole('button', { name: 'Save edit' })) })
    await waitFor(() => expect(out.went).toBe(true))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(holder.adapter.db.edits).toHaveLength(1)
    expect(holder.adapter.db.edits[0].snapshot).toBeNull()
    expect(ctxRef.error).toBe('The edit was saved as “Shoot · v1”, but the names it holds were not: disk full')
  })

  it('R2-01: two drafts, one written without its names and one refused — the question stays about the one left, and says both', async () => {
    withPickups()
    await mountWithQuestion(3)
    await startDraft()
    await act(async () => { ctxRef.startEditDraft({ listId: 'L3', title: 'Pickups', version: 1, base: [item('x', 'sh1', 'sc1', 'Boats')], items: [] }) })
    holder.adapter.failSave = true
    holder.adapter.failListId = 'L3'
    let err
    await act(async () => { try { await ctxRef.saveOpenDrafts() } catch (e) { err = e } })
    expect(err?.message).toBe('The edit was saved as “Shoot · v1”, but the names it holds were not: disk full “Pickups · v1” was not saved: disk full')
    expect(ctxRef.unsavedEditCount()).toBe(1)
    expect(ctxRef.describeUnsavedEdits()).toBe('“Pickups · v1”, an edit of “Pickups · v1”, is not saved.')
  })

  it('R2-03: a sign-out landing in the middle of Save edit — the saved draft\'s copy is removed under ITS person, and is never offered back as unsaved', async () => {
    await mount()
    await auth('SIGNED_IN', 'user-A')
    await startDraft()
    expect(ctxRef.editDraftOf('L1').personKey).toBe('user-A')
    let release
    holder.adapter.gate = new Promise((r) => { release = r })
    let saving
    act(() => { saving = ctxRef.saveEditDraft('L1', { title: 'Shoot' }).catch(e => e) })
    await auth('SIGNED_OUT', null)
    let res
    await act(async () => { release(); res = await saving })
    holder.adapter.gate = null
    expect(res).not.toBeInstanceOf(Error)
    expect(holder.adapter.db.edits.map(e => [e.title, e.version])).toEqual([['Shoot', 1]])
    expect(stored()[storedDraftKey('user-A', 'p1', 'L1')]).toBeUndefined()
    await auth('SIGNED_IN', 'user-A')
    expect(ctxRef.recoverableEditDrafts).toEqual([])
  })

  it('R2-03: the late save of one person\'s draft never ends the NEXT person\'s draft of the same list', async () => {
    await mount()
    await auth('SIGNED_IN', 'user-A')
    await startDraft()
    let release
    holder.adapter.gate = new Promise((r) => { release = r })
    let saving
    act(() => { saving = ctxRef.saveEditDraft('L1', { title: 'Shoot' }).catch(e => e) })
    await auth('SIGNED_OUT', null)
    await auth('SIGNED_IN', 'user-B')
    await startDraft({ version: 2 })
    expect(ctxRef.editDraftOf('L1').personKey).toBe('user-B')
    await act(async () => { release(); await saving })
    holder.adapter.gate = null
    expect(ctxRef.editDraftOf('L1')?.personKey).toBe('user-B')
    expect(stored()[storedDraftKey('user-B', 'p1', 'L1')]).toBeTruthy()
    expect(stored()[storedDraftKey('user-A', 'p1', 'L1')]).toBeUndefined()
    // A's save finished (written, with its names) but its undo step is A's:
    // B's Ctrl+Z, once B's own draft is gone, has nothing of it to take back.
    expect(holder.adapter.db.edits.find(e => e.version === 1)?.snapshot).toMatchObject({ kind: 'edit' })
    await act(async () => { ctxRef.discardEditDraft('L1') })
    expect(ctxRef.canUndo).toBe(false)
  })
  it('R2-03: CONTROL — the same save with nobody signing in meanwhile is one undo step, as before', async () => {
    await mount()
    await auth('SIGNED_IN', 'user-A')
    await startDraft()
    await act(async () => { await ctxRef.saveEditDraft('L1', { title: 'Shoot' }) })
    expect(ctxRef.canUndo).toBe(true)
  })

  it('R2-01: whoever follows the unsaved work (App\'s close question) is told when a draft starts, changes and goes', async () => {
    await mount()
    const seen = vi.fn()
    const off = subscribeLeaveGuards(seen)
    try {
      await startDraft()
      const started = seen.mock.calls.length
      expect(started).toBeGreaterThan(0)
      await act(async () => { ctxRef.changeEditDraft('L1', [MOVED[0]]) })
      expect(seen.mock.calls.length).toBeGreaterThan(started)
      const changed = seen.mock.calls.length
      await act(async () => { ctxRef.discardEditDraft('L1') })
      expect(seen.mock.calls.length).toBeGreaterThan(changed)
    } finally {
      off()
    }
  })

  it('R2-03: CONTROL — a sign-out with nothing being saved keeps the copy for its person (offered back)', async () => {
    await mount()
    await auth('SIGNED_IN', 'user-A')
    await startDraft()
    await auth('SIGNED_OUT', null)
    await auth('SIGNED_IN', 'user-A')
    expect(ctxRef.recoverableEditDrafts.map(c => [c.personKey, c.listId])).toEqual([['user-A', 'L1']])
  })
})
