/** @vitest-environment jsdom */
// shotListsProvider.test.jsx — S3a's provider-level test.
//
// Every other test in the repo mocks useRabbit and hands a view a hand-built
// ctx, so nothing had ever checked at RUNTIME that an undo reverts state
// (history was pinned by reading RabbitProvider.jsx as text). This mounts the
// REAL provider over an in-memory adapter that keeps the contract's rules
// (docs/sessions/handoffs/po-s3a-*.md, "The API for S3b and S3c"), and drives
// the shot-list mutators and ctx.undo / ctx.redo end to end.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import React from 'react'
import { render, cleanup, act, waitFor } from '@testing-library/react'

const holder = vi.hoisted(() => ({ adapter: null }))

vi.mock('../adapters', () => ({
  selectAdapter: () => holder.adapter,
  ADAPTER_MODES: ['supabase', 'local_server', 'google_drive'],
  adapterSupportsWrites: () => true,
}))
vi.mock('../adapters/supabaseAdapter', () => ({ resetSupabaseAdapter: () => {} }))
vi.mock('../../../cloud/auth/supabaseClient', () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: null } }),
    },
  },
}))
vi.mock('../../../lib/localData', () => ({
  hasLocalServer: () => true,
  loadOtterSettings: async () => ({ rabbit: { adapterMode: 'local_server', activeProjectId: 'p1' } }),
  saveOtterSettings: async () => {},
}))
vi.mock('../../../dev/devFixtures', () => ({ devFixtures: () => null }))
vi.mock('../intake/pipeline', () => ({ runIngestion: vi.fn() }))

const { RabbitProvider, useRabbit } = await import('./RabbitProvider')

// ── an in-memory backend with the contract's rules ─────────────────────────
function httpError(status, message) {
  const e = new Error(message)
  e.status = status
  return e
}

function makeAdapter() {
  let n = 0
  const id = (p) => `${p}-${++n}`
  const db = {
    project: { id: 'p1', title: 'Salt Hours', active_shot_list_id: 'L1', scenes_enabled: true },
    scenes: [
      { id: 'sc1', project_id: 'p1', name: 'One', scene_number: 1 },
      { id: 'sc2', project_id: 'p1', name: 'Two', scene_number: 2 },
    ],
    shots: [
      { id: 'sh1', project_id: 'p1', scene_id: 'sc1', name: '1A', shot_number: 10 },
      { id: 'sh2', project_id: 'p1', scene_id: 'sc2', name: '2A', shot_number: 10 },
    ],
    tasks: [{ id: 't1', project_id: 'p1', title: 'Board sc2', scene_id: 'sc2', shot_id: null }],
    shotLists: [{ id: 'L1', project_id: 'p1', title: 'Shot list 1', version: 1, summary: 'Created from existing scenes', snapshot: {}, archived_at: null, archived_by: null, created_at: '2026-09-01' }],
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
  const a = {
    mode: 'local_server',
    calls,
    db,
    status: async () => ({ online: true, lastSyncAt: null }),
    listProjects: async () => [clone(db.project)],
    loadProject: async () => clone({
      project: db.project, scenes: db.scenes, shots: db.shots, tasks: db.tasks,
      shotLists: db.shotLists, shotListItems: db.shotListItems, edits: db.edits,
    }),
    upsertScene: async (row) => { db.scenes = [...db.scenes.filter(s => s.id !== row.id), clone(row)]; return clone(row) },
    upsertShot: async (row) => { db.shots = [...db.shots.filter(s => s.id !== row.id), clone(row)]; return clone(row) },
    // Rule 8: out of every list, tasks un-linked (the cloud's CASCADE / SET NULL).
    deleteScene: async (sid) => {
      db.scenes = db.scenes.filter(s => s.id !== sid)
      db.shotListItems = db.shotListItems.filter(i => i.scene_id !== sid)
      db.tasks = db.tasks.map(t => (t.scene_id === sid ? { ...t, scene_id: null } : t))
    },
    deleteShot: async (sid) => {
      db.shots = db.shots.filter(s => s.id !== sid)
      db.shotListItems = db.shotListItems.filter(i => i.shot_id !== sid)
      db.tasks = db.tasks.map(t => (t.shot_id === sid ? { ...t, shot_id: null } : t))
    },
    patchTask: async (tid, patch) => {
      db.tasks = db.tasks.map(t => (t.id === tid ? { ...t, ...patch } : t))
      return clone(db.tasks.find(t => t.id === tid))
    },
    listShotLists: async () => clone(db.shotLists),
    listShotListItems: async () => clone(db.shotListItems),
    listEdits: async () => clone(db.edits),
    upsertShotList: async (row) => {
      calls.push(['upsertShotList', row.id])
      const stored = db.shotLists.find(l => l.id === row.id)
      if (stored?.archived_at) throw httpError(409, 'this shot list is archived — restore it before changing it')
      const next = { ...(stored || {}), ...clone(row), created_at: stored?.created_at || '2026-09-30' }
      db.shotLists = [...db.shotLists.filter(l => l.id !== row.id), next]
      return clone(next)
    },
    replaceShotListItems: async (_pid, listId, items) => {
      calls.push(['replaceShotListItems', listId, items.length])
      if (!db.shotLists.some(l => l.id === listId)) throw httpError(404, 'shot list not found')
      const rows = items.map((it, i) => ({ id: it.id || id('item'), shot_list_id: listId, project_id: 'p1',
        scene_id: it.scene_id || null, shot_id: it.shot_id || null, position: it.position ?? i }))
      db.shotListItems = [...db.shotListItems.filter(i => i.shot_list_id !== listId), ...rows]
      return clone(rows)
    },
    setActiveShotList: async (_pid, listId) => {
      calls.push(['setActiveShotList', listId])
      db.project.active_shot_list_id = listId
      return listId
    },
    archiveShotList: async (_pid, listId, archived = true) => {
      calls.push(['archiveShotList', listId, archived])
      if (archived && db.project.active_shot_list_id === listId) throw httpError(409, 'the active shot list cannot be archived — make another list active first')
      db.shotLists = db.shotLists.map(l => (l.id === listId ? { ...l, archived_at: archived ? (l.archived_at || 'T') : null } : l))
      return clone(db.shotLists.find(l => l.id === listId))
    },
    upsertEdit: async (row) => {
      calls.push(['upsertEdit', row.id])
      db.edits = [...db.edits.filter(e => e.id !== row.id), clone(row)]
      return clone(row)
    },
    archiveEdit: async (_pid, editId, archived = true) => {
      db.edits = db.edits.map(e => (e.id === editId ? { ...e, archived_at: archived ? 'T' : null } : e))
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

async function mount() {
  render(<RabbitProvider><Probe /></RabbitProvider>)
  await waitFor(() => expect(ctxRef?.project?.id).toBe('p1'))
  await waitFor(() => expect(ctxRef.shotLists.length).toBe(1))
}

const ids = (rows) => rows.map(r => r.id)

beforeEach(() => {
  holder.adapter = makeAdapter()
  ctxRef = null
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('S3a — shot lists through the real provider', () => {
  it('after load, ctx.scenes / ctx.shots are the active list\'s rows — every row after the backfill (D10)', async () => {
    await mount()
    expect(ctxRef.activeShotList.id).toBe('L1')
    expect(ids(ctxRef.scenes)).toEqual(['sc1', 'sc2'])
    expect(ids(ctxRef.shots)).toEqual(['sh1', 'sh2'])
    expect(ids(ctxRef.allScenes)).toEqual(['sc1', 'sc2'])
    expect(ctxRef.formatShotListLabel(ctxRef.activeShotList)).toBe('Shot list 1 · v1')
  })

  it('"New list from the current one" links the SAME scene and shot rows (D1 + D3), as one undo', async () => {
    await mount()
    let created
    await act(async () => { created = await ctxRef.addShotList({ title: 'Alt', from: 'L1' }) })
    expect(created.version).toBe(1)
    expect(ids(ctxRef.scenesOf(created.id))).toEqual(ids(ctxRef.scenesOf('L1')))
    expect(ids(ctxRef.shotsOf(created.id))).toEqual(ids(ctxRef.shotsOf('L1')))
    const newItems = ctxRef.shotListItems.filter(i => i.shot_list_id === created.id)
    expect(newItems).toHaveLength(4)
    expect(newItems.some(i => ['i1', 'i2', 'i3', 'i4'].includes(i.id))).toBe(false)
    expect(ctxRef.listsContaining('sh1').map(l => l.id).sort()).toEqual(['L1', created.id].sort())
    // One undo entry for the list AND its items: undo archives the new list.
    await act(async () => { await ctxRef.undo() })
    expect(ctxRef.shotLists.find(l => l.id === created.id).archived_at).toBeTruthy()
    await act(async () => { await ctxRef.redo() })
    expect(ctxRef.shotLists.find(l => l.id === created.id).archived_at).toBeNull()
  })

  it('the ACTIVE list cannot be archived — refused before any backend call; a non-active one can', async () => {
    await mount()
    await expect(ctxRef.archiveShotList('L1')).rejects.toThrow('the active shot list cannot be archived — make another list active first')
    expect(holder.adapter.calls.some(c => c[0] === 'archiveShotList')).toBe(false)
    let alt
    await act(async () => { alt = await ctxRef.addShotList({ title: 'Alt', from: 'L1' }) })
    await act(async () => { await ctxRef.archiveShotList(alt.id) })
    expect(ctxRef.shotLists.find(l => l.id === alt.id).archived_at).toBeTruthy()
    // An archived list refuses edits in the database's words.
    await expect(ctxRef.addToShotList(alt.id, { sceneId: 'sc1' })).rejects.toThrow('this shot list is archived — restore it before changing it')
    await expect(ctxRef.setActiveShotList(alt.id)).rejects.toThrow('an archived shot list cannot be made active — restore it first')
  })

  it('set active switches what ctx.scenes shows, and undo switches it back', async () => {
    await mount()
    let alt
    await act(async () => { alt = await ctxRef.addShotList({ title: 'Alt' }) })
    await act(async () => { await ctxRef.addToShotList(alt.id, { shotId: 'sh2' }) })
    // A shot brings its scene along.
    expect(ids(ctxRef.scenesOf(alt.id))).toEqual(['sc2'])
    await act(async () => { await ctxRef.setActiveShotList(alt.id) })
    expect(ctxRef.activeShotList.id).toBe(alt.id)
    expect(ids(ctxRef.scenes)).toEqual(['sc2'])
    expect(ids(ctxRef.shots)).toEqual(['sh2'])
    expect(ids(ctxRef.allScenes)).toEqual(['sc1', 'sc2'])
    await act(async () => { await ctxRef.undo() })
    expect(ctxRef.activeShotList.id).toBe('L1')
    expect(ids(ctxRef.scenes)).toEqual(['sc1', 'sc2'])
  })

  it('remove from the active list hides the scene everywhere else (D10); undo brings it back', async () => {
    await mount()
    await act(async () => { await ctxRef.removeFromShotList('L1', { sceneId: 'sc1' }) })
    expect(ids(ctxRef.scenes)).toEqual(['sc2'])
    expect(ids(ctxRef.shots)).toEqual(['sh2'])
    expect(ids(ctxRef.allScenes)).toEqual(['sc1', 'sc2'])
    await act(async () => { await ctxRef.undo() })
    expect(ids(ctxRef.scenes)).toEqual(['sc1', 'sc2'])
    expect(holder.adapter.db.shotListItems.filter(i => i.shot_list_id === 'L1')).toHaveLength(4)
  })

  it('reorder is one undo step on the list order', async () => {
    await mount()
    await act(async () => { await ctxRef.reorderShotListItems('L1', ['sc2', 'sc1']) })
    expect(ids(ctxRef.scenesOf('L1'))).toEqual(['sc2', 'sc1'])
    await act(async () => { await ctxRef.undo() })
    expect(ids(ctxRef.scenesOf('L1'))).toEqual(['sc1', 'sc2'])
  })

  it('deleting a scene takes it out of every list and un-links its tasks; UNDO restores both, so it is visible again', async () => {
    await mount()
    let alt
    await act(async () => { alt = await ctxRef.addShotList({ title: 'Alt', from: 'L1' }) })
    await act(async () => { await ctxRef.deleteScene('sc2') })
    expect(ids(ctxRef.scenes)).toEqual(['sc1'])
    // Its own items left every list. (Its shot sh2 is a separate row that
    // ScenesView deletes first; while it remains, lists still IMPLY sc2.)
    expect(ctxRef.shotListItems.some(i => i.scene_id === 'sc2')).toBe(false)
    expect(holder.adapter.db.shotListItems.some(i => i.scene_id === 'sc2')).toBe(false)
    expect(ctxRef.tasks.find(t => t.id === 't1').scene_id).toBeNull()
    await act(async () => { await ctxRef.undo() })
    // Visible again under D10: its membership in BOTH lists came back.
    await waitFor(() => expect(ids(ctxRef.scenes).sort()).toEqual(['sc1', 'sc2']))
    expect(ctxRef.shotListItems.filter(i => i.scene_id === 'sc2').map(i => i.shot_list_id).sort()).toEqual(['L1', alt.id].sort())
    expect(ctxRef.tasks.find(t => t.id === 't1').scene_id).toBe('sc2')
    expect(holder.adapter.db.tasks.find(t => t.id === 't1').scene_id).toBe('sc2')
  })

  it('a new scene joins the ACTIVE list by default, or the list the caller names', async () => {
    await mount()
    let alt
    await act(async () => { alt = await ctxRef.addShotList({ title: 'Alt' }) })
    let s3
    await act(async () => { s3 = await ctxRef.addScene({ name: 'Three', scene_number: 3 }) })
    expect(ids(ctxRef.scenes)).toContain(s3.id)
    expect(ids(ctxRef.scenesOf(alt.id))).not.toContain(s3.id)
    let s4
    await act(async () => { s4 = await ctxRef.addScene({ name: 'Four', scene_number: 4 }, { listId: alt.id }) })
    expect(ids(ctxRef.scenesOf(alt.id))).toEqual([s4.id])
    expect(ids(ctxRef.scenes)).not.toContain(s4.id)
    expect(ids(ctxRef.allScenes)).toContain(s4.id)
  })

  it('edits: create on a list, Save the items with a name snapshot (D17), undo restores the previous items', async () => {
    await mount()
    let edit
    await act(async () => { edit = await ctxRef.createEditFrom({ listId: 'L1', title: 'Assembly' }) })
    expect(edit.version).toBe(1)
    expect(edit.items).toEqual([])
    await act(async () => {
      await ctxRef.saveEdit(edit.id, [{ shot_id: 'sh2' }, { shot_id: 'sh1' }, { shot_id: 'sh2' }], 'first pass')
    })
    const saved = ctxRef.edits.find(e => e.id === edit.id)
    expect(saved.items.map(i => i.shot_id)).toEqual(['sh2', 'sh1', 'sh2'])
    expect(saved.summary).toBe('first pass')
    expect(saved.snapshot.shots.sh2.name).toBe('2A')
    expect(ctxRef.editsOf('L1').map(e => e.id)).toEqual([edit.id])
    let v2
    await act(async () => { v2 = await ctxRef.createEditFrom({ listId: 'L1', parentEditId: edit.id, title: 'Assembly' }) })
    expect(v2.version).toBe(2)
    expect(v2.items.map(i => i.id)).toEqual(saved.items.map(i => i.id))
    await act(async () => { await ctxRef.undo() }) // archives v2
    await act(async () => { await ctxRef.undo() }) // un-saves v1
    expect(ctxRef.edits.find(e => e.id === edit.id).items).toEqual([])
  })

  it('validation refuses before any write: duplicate title + version, blank title', async () => {
    await mount()
    await expect(ctxRef.addShotList({ title: 'Shot list 1', version: 1 })).rejects.toThrow('There is already a shot list called "Shot list 1 · v1".')
    await expect(ctxRef.addShotList({ title: '   ' })).rejects.toThrow('A shot list needs a title.')
    expect(holder.adapter.calls.some(c => c[0] === 'upsertShotList')).toBe(false)
    // The next free version is the default.
    let v2
    await act(async () => { v2 = await ctxRef.addShotList({ title: 'Shot list 1', from: 'L1' }) })
    expect(v2.version).toBe(2)
  })
})
