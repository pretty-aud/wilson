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
    editOpts: [],
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
    // FX4 review round 1 (R1-03): the contract's conditional write — an
    // existing edit is written only while its stored Save is the one named.
    upsertEdit: async (row, opts) => {
      a.editOpts.push(opts)
      if (a.gate) await a.gate
      // FX4 review round 2 (R2-04): hold only the writes to an edit that exists (a new edit's Save, not its making).
      if (a.gateUpdates && db.edits.some(e => e.id === row.id)) await a.gateUpdates
      const stored = db.edits.find(e => e.id === row.id)
      if (stored && opts && 'expectSavedAt' in opts && (stored.snapshot?.saved_at ?? null) !== (opts.expectSavedAt ?? null)) {
        const e = httpError(409, 'this edit has been saved by someone else since — nothing was written')
        e.code = 'edit_saved_since'
        throw e
      }
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
    expect(q.textContent).toContain('“Shoot · v1”, a new edit of “Shoot · v2”, is not saved. Save edit saves it; Discard changes drops what is not saved; Keep editing goes back to it.')
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
    expect(g.describe()).toBe('“Shoot · v1”, a new edit of “Shoot · v2”, is not saved.')
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
    expect(ctxRef.describeUnsavedEdits()).toBe('“Shoot · v1”, a new edit of “Shoot · v2”, is not saved.')
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
    expect(ctxRef.describeUnsavedEdits()).toBe('2 edits have changes that are not saved: “Shoot · v1” (a new edit, of “Shoot · v2”) and “Pickups · v1” (a new edit, of “Pickups · v1”).')
    // R1-12: of two, the leave question says "each" and "them", not "it".
    expect(leaveWords(ctxRef.describeUnsavedEdits(), ctxRef.unsavedEditCount()))
      .toBe('2 edits have changes that are not saved: “Shoot · v1” (a new edit, of “Shoot · v2”) and “Pickups · v1” (a new edit, of “Pickups · v1”). Save edit saves each; Discard changes drops what is not saved; Keep editing goes back to them.')
    expect(unsavedForClose()[0].count()).toBe(2)
    act(() => { ctxRef.discardEditDraft('L3') })
    expect(leaveWords(ctxRef.describeUnsavedEdits(), ctxRef.unsavedEditCount())).toContain('Save edit saves it; Discard changes drops what is not saved; Keep editing goes back to it.')
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
    expect(q.textContent).toContain('“Shoot · v1”, a new edit of “Shoot · v2”, is not saved.')
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
    expect(q.textContent).toContain('“Shoot · v1”, a new edit of “Shoot · v2”, is not saved. Save edit saves it;')
    await act(async () => { fireEvent.click(within(q).getByRole('button', { name: 'Keep editing' })) })
    expect(out.went).toBe(false)
  })

  it('R2-01: the close guard read when the question opened follows the work — no words and not dirty once it has gone (never "0 edits … undefined")', async () => {
    await mountWithQuestion()
    await auth('SIGNED_IN', 'user-A')
    await startDraft()
    const [g] = unsavedForClose()
    expect(g.describe()).toBe('“Shoot · v1”, a new edit of “Shoot · v2”, is not saved.')
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
    expect(ctxRef.describeUnsavedEdits()).toBe('“Pickups · v1”, a new edit of “Pickups · v1”, is not saved.')
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

// ── Post-overhaul FX4 (Audrey, 2026-10-12): an edit changes in place ─────────
// "when i make changes to an edit, it should start to edit the current
// selected edit instead of asking me to always make a new one ... only when i
// press save as should it ask me to make a new edit version." A draft with
// `editId` is that saved edit's unsaved changes: Save edit writes them INTO
// it; Save as… (saveEditAs) is the one way to a new version.
describe('FX4 — Save edit writes into the edit on screen; Save as… makes the new version', () => {
  const auth = async (event, id) => {
    holder.session = id ? { user: { id } } : null
    await act(async () => { for (const cb of holder.authCbs) cb(event, holder.session); await new Promise(r => setTimeout(r, 5)) })
  }
  /** v1, saved as a new edit from the list's order (D13's path, unchanged): items b (The door), a (Boats). */
  async function savedV1() {
    await startDraft()
    let v1
    await act(async () => { v1 = await ctxRef.saveEditDraft('L1', { title: 'Shoot', summary: 'First assembly' }) })
    return JSON.parse(JSON.stringify(holder.adapter.db.edits.find(e => e.id === v1.id)))
  }
  /** That edit's unsaved changes — as useEditChanges starts them, asking nothing. */
  async function changing(edit, items, extra = {}) {
    await act(async () => {
      ctxRef.startEditDraft({ listId: 'L1', basedOnEditId: edit.id, editId: edit.id, title: edit.title, version: edit.version, baseSavedAt: edit.snapshot?.saved_at ?? null, base: edit.items, items, ...extra })
    })
  }
  const BOATS_ONLY = (v1) => [v1.items.find(i => i.id === 'a')]
  const upserts = () => holder.adapter.calls.filter(c => c[0] === 'upsertEdit')
  afterEach(() => _resetLeaveGuardsForTests())

  it('Save edit writes the changes INTO the edit: one update, its title, version, summary and place in the chain kept, a fresh snapshot of the names; the draft and its copy go', async () => {
    await mount()
    const v1 = await savedV1()
    expect(v1.items.map(i => i.id)).toEqual(['b', 'a'])
    holder.adapter.calls.length = 0
    await changing(v1, BOATS_ONLY(v1))
    expect(ctxRef.editDraftOf('L1')).toMatchObject({ editId: v1.id, title: 'Shoot', version: 1, baseSavedAt: v1.snapshot.saved_at })
    // Renamed while the changes were open: the saved label is the name now.
    await act(async () => { await ctxRef.updateShot('sh1', { name: 'Boats, wide' }) })
    let saved
    await act(async () => { saved = await ctxRef.saveEditDraft('L1') })
    expect(upserts()).toEqual([['upsertEdit', v1.id, 'update']])
    expect(holder.adapter.db.edits).toHaveLength(1)
    const e = holder.adapter.db.edits[0]
    expect(e).toMatchObject({ id: v1.id, title: 'Shoot', version: 1, summary: 'First assembly', parent_edit_id: null, archived_at: null })
    expect(e.items.map(i => [i.id, i.shot_id, i.label])).toEqual([['a', 'sh1', 'Boats, wide']])
    expect(e.snapshot.shots.sh1.name).toBe('Boats, wide')
    expect(e.snapshot.item_count).toBe(1)
    expect(saved.id).toBe(v1.id)
    expect(ctxRef.editDraftOf('L1')).toBeNull()
    expect(localStorage.getItem(EDIT_DRAFTS_KEY)).toBeNull()
    expect(ctxRef.hasUnsavedEdit).toBe(false)
  })

  it('is ONE undo step: Ctrl+Z puts the edit\'s cut and snapshot back as they were saved; Ctrl+Y writes the save again', async () => {
    await mount()
    const v1 = await savedV1()
    await changing(v1, BOATS_ONLY(v1))
    await act(async () => { await ctxRef.saveEditDraft('L1') })
    const after = JSON.parse(JSON.stringify(holder.adapter.db.edits[0]))
    expect(after.items.map(i => i.id)).toEqual(['a'])
    await act(async () => { await ctxRef.undo() })
    let e = holder.adapter.db.edits[0]
    expect(e.items.map(i => i.id)).toEqual(['b', 'a'])
    expect(e.snapshot).toEqual(v1.snapshot)
    expect(e.archived_at).toBeNull()
    await act(async () => { await ctxRef.redo() })
    e = holder.adapter.db.edits[0]
    expect(e.items.map(i => i.id)).toEqual(['a'])
    expect(e.snapshot).toEqual(after.snapshot)
    // Under it, v1's own making, one step: its undo withdraws v1.
    await act(async () => { await ctxRef.undo() })
    await act(async () => { await ctxRef.undo() })
    expect(holder.adapter.db.edits[0].archived_at).toBeTruthy()
  })

  it('two people on one edit: a Save made since these changes began is never written over — refused, in words that name Save as…, the changes kept; Save as… keeps them', async () => {
    await mount()
    const v1 = await savedV1()
    await changing(v1, BOATS_ONLY(v1))
    // Someone else saves v1 meanwhile (edits are not broadcast: only a read sees it).
    holder.adapter.db.edits = holder.adapter.db.edits.map(e => ({ ...e, items: [e.items[0]], snapshot: { ...e.snapshot, saved_at: '2099-01-01T00:00:00.000Z' } }))
    holder.adapter.calls.length = 0
    await expect(ctxRef.saveEditDraft('L1')).rejects.toThrow('Someone saved “Shoot · v1” since these changes began, and Save edit would write over that. Save as… keeps your changes as a new version; Discard changes shows the edit as they saved it.')
    expect(upserts()).toEqual([])
    expect(holder.adapter.db.edits[0].snapshot.saved_at).toBe('2099-01-01T00:00:00.000Z')
    expect(holder.adapter.db.edits[0].items.map(i => i.id)).toEqual(['b'])
    expect(ctxRef.editDraftOf('L1')).toMatchObject({ editId: v1.id })
    await act(async () => { await ctxRef.saveEditAs('L1', { title: 'Shoot', version: 2 }) })
    const v2 = holder.adapter.db.edits.find(e => e.version === 2)
    expect(v2).toMatchObject({ parent_edit_id: v1.id })
    expect(v2.items.map(i => i.id)).toEqual(['a'])
    expect(holder.adapter.db.edits.find(e => e.id === v1.id).snapshot.saved_at).toBe('2099-01-01T00:00:00.000Z')
    expect(ctxRef.editDraftOf('L1')).toBeNull()
  })

  it('CONTROL: read again with no Save since — written', async () => {
    await mount()
    const v1 = await savedV1()
    await changing(v1, BOATS_ONLY(v1))
    await act(async () => { await ctxRef.saveEditDraft('L1') })
    expect(holder.adapter.db.edits[0].items.map(i => i.id)).toEqual(['a'])
  })

  it('an edit archived since the changes began is not saved into (the words say why and name Save as…); the changes stay', async () => {
    await mount()
    const v1 = await savedV1()
    await changing(v1, BOATS_ONLY(v1))
    holder.adapter.db.edits = holder.adapter.db.edits.map(e => ({ ...e, archived_at: 'T' }))
    holder.adapter.calls.length = 0
    await expect(ctxRef.saveEditDraft('L1')).rejects.toThrow('“Shoot · v1” has been archived since these changes began, so they cannot be saved into it. Save as… keeps them as a new version.')
    expect(upserts()).toEqual([])
    expect(ctxRef.editDraftOf('L1')).not.toBeNull()
  })

  it('the edit not read again (the backend unreachable) saves nothing, says so, and keeps the changes', async () => {
    await mount()
    const v1 = await savedV1()
    await changing(v1, BOATS_ONLY(v1))
    holder.adapter.listEdits = async () => { throw httpError(503, 'offline') }
    holder.adapter.calls.length = 0
    await expect(ctxRef.saveEditDraft('L1')).rejects.toThrow()
    expect(upserts()).toEqual([])
    expect(ctxRef.editDraftOf('L1')).not.toBeNull()
  })

  it('Save as… from the changes: the chain\'s next version, as one undo step; the edit they began from stays exactly as it was saved', async () => {
    await mount()
    const v1 = await savedV1()
    await changing(v1, BOATS_ONLY(v1))
    let v2
    await act(async () => { v2 = await ctxRef.saveEditAs('L1', { title: 'Shoot', version: 2, summary: '  Boats only ' }) })
    const db = holder.adapter.db.edits
    expect(db).toHaveLength(2)
    expect(db.find(e => e.id === v1.id)).toEqual(v1)
    expect(db.find(e => e.id === v2.id)).toMatchObject({ title: 'Shoot', version: 2, summary: 'Boats only', parent_edit_id: v1.id })
    expect(db.find(e => e.id === v2.id).items.map(i => i.shot_id)).toEqual(['sh1'])
    expect(db.find(e => e.id === v2.id).snapshot).toMatchObject({ kind: 'edit' })
    expect(ctxRef.editDraftOf('L1')).toBeNull()
    await act(async () => { await ctxRef.undo() })
    expect(holder.adapter.db.edits.find(e => e.id === v2.id).archived_at).toBeTruthy()
    expect(holder.adapter.db.edits.find(e => e.id === v1.id)).toEqual(v1)
  })

  it('Save as… with nothing changed copies the saved edit as the next version; with neither changes nor an edit named it is refused', async () => {
    await mount()
    const v1 = await savedV1()
    let v2
    await act(async () => { v2 = await ctxRef.saveEditAs('L1', { title: 'Shoot', version: 2, fromEditId: v1.id }) })
    expect(holder.adapter.db.edits.find(e => e.id === v2.id).items.map(i => i.shot_id)).toEqual(['sh2', 'sh1'])
    expect(v2.parent_edit_id).toBe(v1.id)
    // The changes went while the dialog was up: never the saved cut in their place.
    await expect(ctxRef.saveEditAs('L1', { title: 'Shoot', version: 3 })).rejects.toThrow('there is no unsaved edit of this shot list')
    expect(holder.adapter.db.edits).toHaveLength(2)
  })

  it('the leave and close questions say a saved edit\'s changes as changes TO it, and their Save edit saves them into it', async () => {
    await mount()
    const v1 = await savedV1()
    await changing(v1, BOATS_ONLY(v1))
    expect(ctxRef.describeUnsavedEdits()).toBe('“Shoot · v1”, an edit of “Shoot · v2”, has changes that are not saved.')
    expect(leaveWords(ctxRef.describeUnsavedEdits(), ctxRef.unsavedEditCount())).toBe('“Shoot · v1”, an edit of “Shoot · v2”, has changes that are not saved. Save edit saves it; Discard changes drops what is not saved; Keep editing goes back to it.')
    expect(unsavedForClose()[0].describe()).toBe('“Shoot · v1”, an edit of “Shoot · v2”, has changes that are not saved.')
    await act(async () => { await ctxRef.saveOpenDrafts() })
    expect(holder.adapter.db.edits).toHaveLength(1)
    expect(holder.adapter.db.edits[0].items.map(i => i.id)).toEqual(['a'])
    expect(hasUnsavedWork('tab')).toBe(false)
  })

  it('a change whose round trip ended after another began the changes goes onto them (orApply); without it, one draft per list still refuses', async () => {
    await mount()
    const v1 = await savedV1()
    await changing(v1, BOATS_ONLY(v1))
    let d
    await act(async () => { d = ctxRef.startEditDraft({ listId: 'L1', editId: v1.id, title: 'Shoot', version: 1, base: v1.items, items: [], orApply: (items) => [...items, item('c', 'sh2', 'sc2', 'The door')], made: ['sh9'] }) })
    expect(d.items.map(i => i.id)).toEqual(['a', 'c'])
    expect(ctxRef.editDraftOf('L1').items.map(i => i.id)).toEqual(['a', 'c'])
    expect(ctxRef.editDraftOf('L1').made).toEqual(['sh9'])
    // One undo of the changes takes back the late change alone.
    await act(async () => { ctxRef.undoEditDraft('L1') })
    expect(ctxRef.editDraftOf('L1').items.map(i => i.id)).toEqual(['a'])
    expect(() => ctxRef.startEditDraft({ listId: 'L1', editId: v1.id, title: 'Shoot', version: 1, base: [], items: [] })).toThrow('this shot list already has an unsaved edit')
  })

  it('a stored copy of a saved edit\'s changes recovers as those changes, and Save edit writes them into that edit', async () => {
    await mount()
    const v1 = await savedV1()
    await changing(v1, BOATS_ONLY(v1))
    expect(stored()[storedDraftKey('local', 'p1', 'L1')]).toMatchObject({ editId: v1.id, baseSavedAt: v1.snapshot.saved_at, title: 'Shoot', version: 1 })
    cleanup()
    // The next run: the copy is offered back, and recovered.
    await mount()
    expect(ctxRef.recoverableEditDrafts.map(c => c.editId)).toEqual([v1.id])
    await act(async () => { ctxRef.recoverEditDraft('L1') })
    expect(ctxRef.editDraftOf('L1')).toMatchObject({ editId: v1.id, baseSavedAt: v1.snapshot.saved_at })
    await act(async () => { await ctxRef.saveEditDraft('L1') })
    expect(holder.adapter.db.edits).toHaveLength(1)
    expect(holder.adapter.db.edits[0].items.map(i => i.id)).toEqual(['a'])
  })

  // v1 already saved when the provider loads (no undo step of its making).
  const SAVED_V1 = () => ({ id: 'e1', project_id: 'p1', shot_list_id: 'L1', title: 'Shoot', version: 1, summary: null, parent_edit_id: null, items: MOVED, snapshot: { kind: 'edit', saved_at: '2026-10-01T09:00:00.000Z', shots: {}, scenes: {} }, archived_at: null, archived_by: null, created_at: '2026-10-01T09:00:00Z' })
  it('a sign-out in the middle of Save edit: the save finishes, its copy goes under ITS person, and the next person gets no undo step of it', async () => {
    holder.adapter.db.edits = [SAVED_V1()]
    await mount()
    await auth('SIGNED_IN', 'user-A')
    expect(ctxRef.canUndo).toBe(false)
    const v1 = SAVED_V1()
    await changing(v1, BOATS_ONLY(v1))
    let release
    holder.adapter.gate = new Promise((r) => { release = r })
    let saving
    act(() => { saving = ctxRef.saveEditDraft('L1').catch(e => e) })
    await auth('SIGNED_OUT', null)
    await auth('SIGNED_IN', 'user-B')
    await act(async () => { release(); await saving })
    holder.adapter.gate = null
    expect(holder.adapter.db.edits[0].items.map(i => i.id)).toEqual(['a'])
    expect(stored()[storedDraftKey('user-A', 'p1', 'L1')]).toBeUndefined()
    expect(ctxRef.canUndo).toBe(false)
  })
  it('CONTROL: the same save with nobody signing in meanwhile is the one undo step', async () => {
    holder.adapter.db.edits = [SAVED_V1()]
    await mount()
    await auth('SIGNED_IN', 'user-A')
    const v1 = SAVED_V1()
    await changing(v1, BOATS_ONLY(v1))
    await act(async () => { await ctxRef.saveEditDraft('L1') })
    expect(ctxRef.canUndo).toBe(true)
  })
})

// ── FX4 review round 1: what a save in flight, a Save landing between the
//    check and the write, a missing name, a gone edit and a late change do ──
describe('FX4 review round 1 — Save edit in flight, conditional writes, frozen names', () => {
  const SAVED_V1 = (extra = {}) => ({ id: 'e1', project_id: 'p1', shot_list_id: 'L1', title: 'Shoot', version: 1, summary: null, parent_edit_id: null, items: MOVED, snapshot: { kind: 'edit', saved_at: '2026-10-01T09:00:00.000Z', shots: {}, scenes: {} }, archived_at: null, archived_by: null, created_at: '2026-10-01T09:00:00Z', ...extra })
  const changingV1 = async (items, v1 = SAVED_V1()) => {
    await act(async () => { ctxRef.startEditDraft({ listId: 'L1', basedOnEditId: v1.id, editId: v1.id, title: v1.title, version: v1.version, baseSavedAt: v1.snapshot?.saved_at ?? null, base: v1.items, items }) })
  }
  const BOATS = () => [item('a', 'sh1', 'sc1', 'Boats')]
  const upserts = () => holder.adapter.calls.filter(c => c[0] === 'upsertEdit')
  const hold = () => { let release; holder.adapter.gate = new Promise((r) => { release = r }); return () => { holder.adapter.gate = null; release() } }
  afterEach(() => _resetLeaveGuardsForTests())

  it('R1-01: a change made WHILE Save edit writes is not lost — the save writes what it began with, and the change stays unsaved, on the version just saved', async () => {
    holder.adapter.db.edits = [SAVED_V1()]
    await mount()
    await changingV1(BOATS())
    const release = hold()
    let saving
    act(() => { saving = ctxRef.saveEditDraft('L1') })
    await act(async () => { await new Promise(r => setTimeout(r, 5)) })
    // Duplicate while it writes.
    await act(async () => { ctxRef.changeEditDraft('L1', (its) => [...its, item('a2', 'sh1', 'sc1', 'Boats')]) })
    await act(async () => { release(); await saving })
    const stored = holder.adapter.db.edits[0]
    expect(stored.items.map(i => i.id)).toEqual(['a'])
    const d = ctxRef.editDraftOf('L1')
    expect(d).not.toBeNull()
    expect(d.items.map(i => i.id)).toEqual(['a', 'a2'])
    expect(d).toMatchObject({ editId: 'e1', baseSavedAt: stored.snapshot.saved_at })
    expect(ctxRef.hasUnsavedEdit).toBe(true)
    // …and saving it again writes it, into the same edit, refused by nothing.
    await act(async () => { await ctxRef.saveEditDraft('L1') })
    expect(holder.adapter.db.edits).toHaveLength(1)
    expect(holder.adapter.db.edits[0].items.map(i => i.id)).toEqual(['a', 'a2'])
    expect(ctxRef.editDraftOf('L1')).toBeNull()
  })

  it('R1-01: the same for a NEW edit from List order — the change made meanwhile stays, as changes to the edit just made (never a second new edit)', async () => {
    await mount()
    await startDraft()
    const release = hold()
    let saving
    act(() => { saving = ctxRef.saveEditDraft('L1') })
    await act(async () => { await new Promise(r => setTimeout(r, 5)) })
    await act(async () => { ctxRef.changeEditDraft('L1', (its) => its.slice(0, 1)) })
    await act(async () => { release(); await saving })
    expect(holder.adapter.db.edits).toHaveLength(1)
    const made = holder.adapter.db.edits[0]
    expect(made.items.map(i => i.id)).toEqual(['b', 'a'])
    const d = ctxRef.editDraftOf('L1')
    expect(d).toMatchObject({ editId: made.id, title: 'Shoot', version: 1, baseSavedAt: made.snapshot.saved_at })
    expect(d.items.map(i => i.id)).toEqual(['b'])
    await act(async () => { await ctxRef.saveEditDraft('L1') })
    expect(holder.adapter.db.edits).toHaveLength(1)
    expect(holder.adapter.db.edits[0].items.map(i => i.id)).toEqual(['b'])
  })

  it('R1-01: a second Save edit while the first writes (the leave or close question\'s) waits for it, and writes nothing more', async () => {
    holder.adapter.db.edits = [SAVED_V1()]
    await mount()
    await changingV1(BOATS())
    holder.adapter.calls.length = 0
    const release = hold()
    let one
    let two
    act(() => { one = ctxRef.saveEditDraft('L1'); two = ctxRef.saveOpenDrafts() })
    await act(async () => { release(); await one; await two })
    expect(upserts()).toEqual([['upsertEdit', 'e1', 'update']])
    expect(ctxRef.editDraftOf('L1')).toBeNull()
  })

  // Review round 2 (R2-01) replaced round 1's wait: the question opens at
  // once (modal, as it always was), and settles as "go" by itself when the
  // save in flight lands and leaves nothing unsaved.
  it('R2-01: an exit pressed while Save edit writes asks at once; when the save lands with nothing left, the question goes by itself and the exit goes on', async () => {
    holder.adapter.db.edits = [SAVED_V1()]
    render(<RabbitProvider><Probe /><LeaveEditDialog /></RabbitProvider>)
    await waitFor(() => expect(ctxRef?.shotLists?.length).toBe(2))
    await changingV1(BOATS())
    const release = hold()
    let saving
    act(() => { saving = ctxRef.saveEditDraft('L1') })
    const out = { went: undefined }
    act(() => { confirmLeave('tab').then((g) => { out.went = g }) })
    await act(async () => { await new Promise(r => setTimeout(r, 5)) })
    expect(screen.getByRole('dialog', { name: 'Save the edit before leaving?' })).toBeTruthy()
    await act(async () => { release(); await saving })
    await waitFor(() => expect(out.went).toBe(true))
    expect(screen.queryByRole('dialog', { name: 'Save the edit before leaving?' })).toBeNull()
    expect(upserts()).toEqual([['upsertEdit', 'e1', 'update']])
  })

  it('R2-01: CONTROL — a change made while it saves keeps the question up after the save lands; its Save edit then saves that change, once', async () => {
    holder.adapter.db.edits = [SAVED_V1()]
    render(<RabbitProvider><Probe /><LeaveEditDialog /></RabbitProvider>)
    await waitFor(() => expect(ctxRef?.shotLists?.length).toBe(2))
    await changingV1(BOATS())
    holder.adapter.calls.length = 0
    const release = hold()
    let saving
    act(() => { saving = ctxRef.saveEditDraft('L1') })
    await act(async () => { await new Promise(r => setTimeout(r, 5)) })
    await act(async () => { ctxRef.changeEditDraft('L1', (its) => [...its, item('y', 'sh2', 'sc2', 'The door')]) })
    const out = { went: undefined }
    act(() => { confirmLeave('tab').then((g) => { out.went = g }) })
    await act(async () => { release(); await saving })
    const q = await screen.findByRole('dialog', { name: 'Save the edit before leaving?' })
    expect(out.went).toBeUndefined()
    await act(async () => { fireEvent.click(within(q).getByRole('button', { name: 'Save edit' })) })
    await waitFor(() => expect(out.went).toBe(true))
    expect(holder.adapter.db.edits[0].items.map(i => i.id)).toEqual(['a', 'y'])
    expect(upserts()).toEqual([['upsertEdit', 'e1', 'update'], ['upsertEdit', 'e1', 'update']])
  })

  it('R2-01: Discard from the window\'s close question never waits on a save in flight — a write that never settles cannot hold it — and nothing unsaved is left', async () => {
    holder.adapter.db.edits = [SAVED_V1()]
    await mount()
    await changingV1(BOATS())
    const release = hold()
    let saving
    act(() => { saving = ctxRef.saveEditDraft('L1') })
    await act(async () => { await new Promise(r => setTimeout(r, 5)) })
    await act(async () => { ctxRef.changeEditDraft('L1', (its) => [...its, item('z', 'sh2', 'sc2', 'The door')]) })
    let discarded = false
    await act(async () => { await unsavedForClose()[0].discard(); discarded = true })
    // Resolved while the write still hangs.
    expect(discarded).toBe(true)
    expect(ctxRef.editDraftOf('L1')).toBeNull()
    // The save pressed before it still lands; nothing comes back unsaved.
    await act(async () => { release(); await saving })
    expect(holder.adapter.db.edits[0].items.map(i => i.id)).toEqual(['a'])
    expect(ctxRef.editDraftOf('L1')).toBeNull()
  })

  it('R1-03: a Save landing between the re-read and the write is refused by the backend itself — the same words, the changes kept, ctx.error the words', async () => {
    holder.adapter.db.edits = [SAVED_V1()]
    await mount()
    await changingV1(BOATS())
    const read = holder.adapter.listEdits
    holder.adapter.listEdits = async (pid) => {
      const rows = await read(pid)
      // Someone saves right after this client has read.
      holder.adapter.db.edits = holder.adapter.db.edits.map(e => ({ ...e, items: [], snapshot: { ...e.snapshot, saved_at: '2099-01-01T00:00:00.000Z' } }))
      return rows
    }
    const words = 'Someone saved “Shoot · v1” since these changes began, and Save edit would write over that. Save as… keeps your changes as a new version; Discard changes shows the edit as they saved it.'
    let err
    await act(async () => { try { await ctxRef.saveEditDraft('L1') } catch (e) { err = e } })
    expect(err.message).toBe(words)
    expect(holder.adapter.editOpts.at(-1)).toEqual({ expectSavedAt: '2026-10-01T09:00:00.000Z' })
    expect(holder.adapter.db.edits[0].snapshot.saved_at).toBe('2099-01-01T00:00:00.000Z')
    expect(holder.adapter.db.edits[0].items).toEqual([])
    expect(ctxRef.editDraftOf('L1')).toMatchObject({ editId: 'e1' })
    expect(ctxRef.error).toBe(words)
  })

  it('R1-03: the undo and redo of a Save edit are conditional on the Save they expect too', async () => {
    holder.adapter.db.edits = [SAVED_V1()]
    await mount()
    await changingV1(BOATS())
    await act(async () => { await ctxRef.saveEditDraft('L1') })
    const after = holder.adapter.db.edits[0].snapshot.saved_at
    await act(async () => { await ctxRef.undo() })
    expect(holder.adapter.editOpts.at(-1)).toEqual({ expectSavedAt: after })
    await act(async () => { await ctxRef.redo() })
    expect(holder.adapter.editOpts.at(-1)).toEqual({ expectSavedAt: '2026-10-01T09:00:00.000Z' })
  })

  it('R1-02: a Save edit keeps the names its edit froze for a scene and a shot the project no longer has; so does Save as…', async () => {
    const v1 = SAVED_V1({
      items: [item('a', 'sh1', 'sc1', 'Boats'), item('g', 'gone-shot', 'gone-scene', 'Salt pan')],
      snapshot: { kind: 'edit', saved_at: '2026-10-01T09:00:00.000Z', shots: { 'gone-shot': { name: 'Salt pan', shot_number: 10, scene_id: 'gone-scene' } }, scenes: { 'gone-scene': { name: 'Salt hours', scene_number: 6 } } },
    })
    holder.adapter.db.edits = [v1]
    await mount()
    await changingV1([v1.items[1], v1.items[0]], v1)
    await act(async () => { await ctxRef.saveEditDraft('L1') })
    const snap = holder.adapter.db.edits[0].snapshot
    expect(snap.scenes['gone-scene']).toEqual({ name: 'Salt hours', scene_number: 6 })
    expect(snap.shots['gone-shot']).toMatchObject({ name: 'Salt pan' })
    expect(snap.shots.sh1.name).toBe('Boats')
    let v2
    await act(async () => { v2 = await ctxRef.saveEditAs('L1', { title: 'Shoot', version: 2, fromEditId: 'e1' }) })
    expect(holder.adapter.db.edits.find(e => e.id === v2.id).snapshot.scenes['gone-scene'].name).toBe('Salt hours')
  })

  it('R1-08: a stored copy of changes to an edit the list no longer holds recovers as a NEW edit, at the next free version — Save edit makes it', async () => {
    holder.adapter.db.edits = []
    localStorage.setItem(EDIT_DRAFTS_KEY, JSON.stringify({
      [storedDraftKey('local', 'p1', 'L1')]: { personKey: 'local', projectId: 'p1', listId: 'L1', basedOnEditId: 'gone', editId: 'gone', baseSavedAt: '2026-10-01T09:00:00.000Z', title: 'Shoot', version: 3, base: [], items: BASE, changedAt: 't' },
    }))
    await mount()
    await act(async () => { ctxRef.recoverEditDraft('L1') })
    expect(ctxRef.editDraftOf('L1')).toMatchObject({ editId: null, basedOnEditId: null, baseSavedAt: null, title: 'Shoot', version: 1 })
    await act(async () => { await ctxRef.saveEditDraft('L1') })
    expect(holder.adapter.db.edits.map(e => [e.title, e.version])).toEqual([['Shoot', 1]])
  })

  it('R1-08: changes to an edit the list no longer holds (gone under them) are saved as a NEW edit, never refused as "no longer in this list"', async () => {
    holder.adapter.db.edits = []
    await mount()
    await act(async () => { ctxRef.startEditDraft({ listId: 'L1', basedOnEditId: 'gone', editId: 'gone', title: 'Shoot', version: 4, baseSavedAt: 'T', base: [], items: BASE }) })
    await act(async () => { await ctxRef.saveEditDraft('L1') })
    expect(holder.adapter.db.edits.map(e => [e.title, e.version, e.items.length])).toEqual([['Shoot', 1, 2]])
    expect(ctxRef.editDraftOf('L1')).toBeNull()
  })

  it('R1-09: a late change lands only on the SAME edit\'s changes — never another edit\'s, never a new edit\'s', async () => {
    holder.adapter.db.edits = [SAVED_V1()]
    await mount()
    await startDraft()
    expect(() => ctxRef.startEditDraft({ listId: 'L1', editId: 'e1', title: 'Shoot', version: 1, base: [], items: [], orApply: (its) => [...its, item('q', 'sh1', 'sc1')] }))
      .toThrow('another edit of this list has unsaved changes now, so this change was not made')
    expect(() => ctxRef.changeEditDraft('L1', [item('q', 'sh1', 'sc1')], { draftId: 'someone-else' }))
      .toThrow('another edit of this list has unsaved changes now, so this change was not made')
    expect(ctxRef.editDraftOf('L1').items.map(i => i.id)).toEqual(['b', 'a'])
    // CONTROL: the same changes (by their identity) take it, as a function of the items NOW.
    let d
    await act(async () => { d = ctxRef.changeEditDraft('L1', (its) => its.slice(1), { draftId: ctxRef.editDraftOf('L1').draftId }) })
    expect(d.items.map(i => i.id)).toEqual(['a'])
  })
})

// ── FX4 review round 2: a change still in flight across a save, the undo of
//    a rebase, a new edit between its two writes, three saves, a sign-out ──
describe('FX4 review round 2 — changes across a save, by their identity', () => {
  const SAVED_V1 = (extra = {}) => ({ id: 'e1', project_id: 'p1', shot_list_id: 'L1', title: 'Shoot', version: 1, summary: null, parent_edit_id: null, items: MOVED, snapshot: { kind: 'edit', saved_at: '2026-10-01T09:00:00.000Z', shots: {}, scenes: {} }, archived_at: null, archived_by: null, created_at: '2026-10-01T09:00:00Z', ...extra })
  const changingV1 = async (items, v1 = SAVED_V1()) => {
    await act(async () => { ctxRef.startEditDraft({ listId: 'L1', basedOnEditId: v1.id, editId: v1.id, title: v1.title, version: v1.version, baseSavedAt: v1.snapshot?.saved_at ?? null, base: v1.items, items }) })
  }
  const BOATS = () => [item('a', 'sh1', 'sc1', 'Boats')]
  const upserts = () => holder.adapter.calls.filter(c => c[0] === 'upsertEdit')
  const hold = (key = 'gate') => { let release; holder.adapter[key] = new Promise((r) => { release = r }); return () => { holder.adapter[key] = null; release() } }
  const auth = async (event, id) => {
    holder.session = id ? { user: { id } } : null
    await act(async () => { for (const cb of holder.authCbs) cb(event, holder.session); await new Promise(r => setTimeout(r, 5)) })
  }
  afterEach(() => _resetLeaveGuardsForTests())

  it('R2-02a: a change made to changes that were SAVED meanwhile (nothing left unsaved) starts the changes of the edit they became, from it as it is now', async () => {
    holder.adapter.db.edits = [SAVED_V1()]
    await mount()
    await changingV1(BOATS())
    const draftId = ctxRef.editDraftOf('L1').draftId
    await act(async () => { await ctxRef.saveEditDraft('L1') })
    expect(ctxRef.editDraftOf('L1')).toBeNull()
    const saved = holder.adapter.db.edits[0]
    // The New shot's change, whose round trip outlived the save.
    let d
    await act(async () => { d = ctxRef.changeEditDraft('L1', (its) => [...its, item('n', 'sh2', 'sc2', 'The door')], { draftId, made: ['sh2'] }) })
    expect(d).toMatchObject({ draftId, editId: 'e1', baseSavedAt: saved.snapshot.saved_at, made: ['sh2'] })
    expect(d.items.map(i => i.id)).toEqual(['a', 'n'])
    expect(d.base.map(i => i.id)).toEqual(['a'])
    // …and it saves, refused by nothing.
    await act(async () => { await ctxRef.saveEditDraft('L1') })
    expect(holder.adapter.db.edits[0].items.map(i => i.id)).toEqual(['a', 'n'])
  })

  it('R2-02b: a new edit\'s changes rebased by its save keep their identity — a late change made to them still lands', async () => {
    await mount()
    await startDraft()
    const draftId = ctxRef.editDraftOf('L1').draftId
    const release = hold()
    let saving
    act(() => { saving = ctxRef.saveEditDraft('L1') })
    await act(async () => { await new Promise(r => setTimeout(r, 5)) })
    await act(async () => { ctxRef.changeEditDraft('L1', (its) => its.slice(0, 1), { draftId }) })
    await act(async () => { release(); await saving })
    const rebased = ctxRef.editDraftOf('L1')
    expect(rebased).toMatchObject({ draftId, editId: holder.adapter.db.edits[0].id })
    await act(async () => { ctxRef.changeEditDraft('L1', (its) => [...its, item('n', 'sh1', 'sc1')], { draftId }) })
    expect(ctxRef.editDraftOf('L1').items.map(i => i.id)).toEqual(['b', 'n'])
  })

  it('R2-02c: a first change to a saved edit, pressed before a Save edit of it landed and finishing after, starts from the edit as SAVED — its cut and its Save', async () => {
    holder.adapter.db.edits = [SAVED_V1()]
    await mount()
    // Another change was made and saved while this one's round trip ran.
    await changingV1(BOATS())
    await act(async () => { await ctxRef.saveEditDraft('L1') })
    const saved = holder.adapter.db.edits[0]
    const stale = SAVED_V1()
    await act(async () => {
      ctxRef.startEditDraft({ listId: 'L1', basedOnEditId: 'e1', editId: 'e1', title: 'Shoot', version: 1, baseSavedAt: stale.snapshot.saved_at, base: stale.items, items: [...stale.items, item('n', 'sh2', 'sc2')], orApply: (its) => [...its, item('n', 'sh2', 'sc2')] })
    })
    const d = ctxRef.editDraftOf('L1')
    expect(d.items.map(i => i.id)).toEqual(['a', 'n'])
    expect(d.baseSavedAt).toBe(saved.snapshot.saved_at)
    await act(async () => { await ctxRef.saveEditDraft('L1') })
    expect(holder.adapter.db.edits[0].items.map(i => i.id)).toEqual(['a', 'n'])
  })

  it('R2-03: changes rebased by a save undo back to the cut just saved — one step — and a change undone during the save leaves nothing unsaved', async () => {
    holder.adapter.db.edits = [SAVED_V1()]
    await mount()
    await changingV1(BOATS())
    let release = hold()
    let saving
    act(() => { saving = ctxRef.saveEditDraft('L1') })
    await act(async () => { await new Promise(r => setTimeout(r, 5)) })
    await act(async () => { ctxRef.changeEditDraft('L1', (its) => [...its, item('a2', 'sh1', 'sc1')]) })
    await act(async () => { release(); await saving })
    expect(ctxRef.editDraftOf('L1').items.map(i => i.id)).toEqual(['a', 'a2'])
    let did
    await act(async () => { did = ctxRef.undoEditDraft('L1') })
    expect(did).toBe(true)
    expect(ctxRef.editDraftOf('L1').items.map(i => i.id)).toEqual(['a'])
    // Never past the save (the save is the provider's own undo step).
    await act(async () => { did = ctxRef.undoEditDraft('L1') })
    expect(did).toBe(false)
    await act(async () => { ctxRef.discardEditDraft('L1') })
    // A change and its undo during the save: nothing is left unsaved after it.
    await changingV1([], { ...SAVED_V1(), items: holder.adapter.db.edits[0].items, snapshot: holder.adapter.db.edits[0].snapshot })
    release = hold()
    act(() => { saving = ctxRef.saveEditDraft('L1') })
    await act(async () => { await new Promise(r => setTimeout(r, 5)) })
    await act(async () => { ctxRef.changeEditDraft('L1', (its) => [...its, item('x', 'sh1', 'sc1')]) })
    await act(async () => { ctxRef.undoEditDraft('L1') })
    await act(async () => { release(); await saving })
    expect(ctxRef.editDraftOf('L1')).toBeNull()
  })

  it('R2-04: a new edit\'s changes stay on screen between its two writes (made, then Saved) — never List order in between', async () => {
    await mount()
    await startDraft()
    const release = hold('gateUpdates')
    let saving
    act(() => { saving = ctxRef.saveEditDraft('L1') })
    await waitFor(() => expect(holder.adapter.db.edits).toHaveLength(1))
    expect(ctxRef.editDraftOf('L1')).not.toBeNull()
    await act(async () => { release(); await saving })
    expect(ctxRef.editDraftOf('L1')).toBeNull()
    expect(holder.adapter.db.edits[0].snapshot).toMatchObject({ kind: 'edit' })
  })

  it('R2-06: changes to an edit archived since — the leave question offers no Save edit (it could only fail), and says Save as… keeps them', async () => {
    holder.adapter.db.edits = [SAVED_V1()]
    render(<RabbitProvider><Probe /><LeaveEditDialog /></RabbitProvider>)
    await waitFor(() => expect(ctxRef?.shotLists?.length).toBe(2))
    await changingV1(BOATS())
    holder.adapter.db.edits = holder.adapter.db.edits.map(e => ({ ...e, archived_at: 'T' }))
    await act(async () => { await ctxRef.refreshShotLists?.() })
    await waitFor(() => expect(ctxRef.canSaveOpenDrafts()).toBe(false))
    act(() => { confirmLeave('tab') })
    const q = await screen.findByRole('dialog', { name: 'Save the edit before leaving?' })
    expect(within(q).queryByRole('button', { name: 'Save edit' })).toBeNull()
    expect(within(q).getByRole('button', { name: 'Discard changes' })).toBeTruthy()
    expect(q.textContent).toContain('Its edit has been archived since, so they cannot be saved into it: Keep editing goes back to them, where Save as… keeps them as a new version; Discard changes drops what is not saved.')
    // CONTROL: changes to a live edit: Save edit is offered.
    expect(leaveWords('x', 1, true)).toBe('x Save edit saves it; Discard changes drops what is not saved; Keep editing goes back to it.')
  })

  it('R2-07: three Save edits at once run one after another — one write in all', async () => {
    holder.adapter.db.edits = [SAVED_V1()]
    await mount()
    await changingV1(BOATS())
    holder.adapter.calls.length = 0
    const release = hold()
    let all
    act(() => { all = Promise.all([ctxRef.saveEditDraft('L1'), ctxRef.saveEditDraft('L1'), ctxRef.saveEditDraft('L1')]) })
    await act(async () => { release(); await all })
    expect(upserts()).toEqual([['upsertEdit', 'e1', 'update']])
  })

  it('R2-08: a sign-out while Save edit writes keeps the stored copy of changes made meanwhile — on the version just saved — for its person', async () => {
    holder.adapter.db.edits = [SAVED_V1()]
    await mount()
    await auth('SIGNED_IN', 'user-A')
    await changingV1(BOATS())
    const release = hold()
    let saving
    act(() => { saving = ctxRef.saveEditDraft('L1').catch(e => e) })
    await act(async () => { await new Promise(r => setTimeout(r, 5)) })
    await act(async () => { ctxRef.changeEditDraft('L1', (its) => [...its, item('m', 'sh2', 'sc2')]) })
    await auth('SIGNED_OUT', null)
    await act(async () => { release(); await saving })
    const copy = stored()[storedDraftKey('user-A', 'p1', 'L1')]
    expect(copy.items.map(i => i.id)).toEqual(['a', 'm'])
    expect(copy).toMatchObject({ editId: 'e1', baseSavedAt: holder.adapter.db.edits[0].snapshot.saved_at })
    // CONTROL: with nothing changed meanwhile, the copy goes (S3c R2-03).
  })
})
