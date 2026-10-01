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

const holder = vi.hoisted(() => ({ adapter: null, mode: 'local_server', session: null, writable: true }))

vi.mock('../adapters', () => ({
  selectAdapter: () => holder.adapter,
  ADAPTER_MODES: ['supabase', 'local_server', 'google_drive'],
  adapterSupportsWrites: () => holder.writable,
}))
vi.mock('../adapters/supabaseAdapter', () => ({ resetSupabaseAdapter: () => {} }))
vi.mock('../../../cloud/auth/supabaseClient', () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: holder.session } }),
    },
  },
}))
vi.mock('../../../lib/localData', () => ({
  hasLocalServer: () => true,
  loadOtterSettings: async () => ({ rabbit: { adapterMode: holder.mode, activeProjectId: 'p1' } }),
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
    hideFromLoad: new Set(),
    loadProject: async () => clone({
      project: db.project, scenes: db.scenes, shots: db.shots, tasks: db.tasks,
      shotLists: db.shotLists.filter(l => !a.hideFromLoad.has(l.id)), shotListItems: db.shotListItems, edits: db.edits,
    }),
    upsertScene: async (row) => { db.scenes = [...db.scenes.filter(s => s.id !== row.id), clone(row)]; return clone(row) },
    upsertShot: async (row) => { db.shots = [...db.shots.filter(s => s.id !== row.id), clone(row)]; return clone(row) },
    // Rule 8: out of every list, tasks un-linked (the cloud's CASCADE / SET NULL).
    // Rule 8 + round-1 C: the scene's shots go too (0040's CASCADE), each
    // swept out of every list, archived ones included, and tasks un-linked.
    deleteScene: async (sid) => {
      const shotIds = new Set(db.shots.filter(s => s.scene_id === sid).map(s => s.id))
      db.scenes = db.scenes.filter(s => s.id !== sid)
      db.shots = db.shots.filter(s => !shotIds.has(s.id))
      db.shotListItems = db.shotListItems.filter(i => i.scene_id !== sid && !shotIds.has(i.shot_id))
      db.tasks = db.tasks.map(t => ({
        ...t,
        ...(t.scene_id === sid ? { scene_id: null } : {}),
        ...(shotIds.has(t.shot_id) ? { shot_id: null } : {}),
      }))
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
      const next = { ...(stored || {}), ...clone(row), created_at: stored?.created_at || '2026-09-30',
        created_by: stored ? (stored.created_by ?? null) : (holder.session?.user?.id ?? null) }
      db.shotLists = [...db.shotLists.filter(l => l.id !== row.id), next]
      return clone(next)
    },
    failNextUpsert: false,
    upsertShotListItems: async (_pid, listId, items) => {
      calls.push(['upsertShotListItems', listId, items.length])
      if (a.failNextUpsert) { a.failNextUpsert = false; throw httpError(500, 'disk full') }
      const list = db.shotLists.find(l => l.id === listId)
      if (!list) throw httpError(404, 'shot list not found')
      const written = []
      for (const it of items) {
        const existing = db.shotListItems.find(i => i.id === it.id)
        if (existing && existing.shot_list_id !== listId) continue
        // Like the database: the row must name a real scene/shot, once per list.
        if (it.scene_id && !db.scenes.some(x => x.id === it.scene_id)) throw httpError(400, 'an item names a scene or shot that is not in this project')
        if (it.shot_id && !db.shots.some(x => x.id === it.shot_id)) throw httpError(400, 'an item names a scene or shot that is not in this project')
        const clash = db.shotListItems.find(i => i.shot_list_id === listId && i.id !== it.id
          && ((it.scene_id && i.scene_id === it.scene_id) || (it.shot_id && i.shot_id === it.shot_id)))
        if (clash) throw httpError(409, 'a shot list holds each scene and each shot once')
        const row = { id: it.id || id('item'), shot_list_id: listId, project_id: 'p1',
          scene_id: it.scene_id || null, shot_id: it.shot_id || null, position: it.position ?? 0 }
        db.shotListItems = [...db.shotListItems.filter(i => i.id !== row.id), row]
        written.push(row)
      }
      return clone(written)
    },
    // Positions only: an unknown id (or another list's) is skipped, never inserted.
    repositionShotListItems: async (_pid, listId, items) => {
      calls.push(['repositionShotListItems', listId, items.length])
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
      calls.push(['deleteShotListItems', listId, ids.length])
      const gone = db.shotListItems.filter(i => i.shot_list_id === listId && ids.includes(i.id)).map(i => i.id)
      db.shotListItems = db.shotListItems.filter(i => !gone.includes(i.id))
      return { deleted: gone }
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
      db.shotLists = db.shotLists.map(l => (l.id === listId ? { ...l, archived_at: archived ? (l.archived_at || 'T') : null,
        archived_by: archived ? (l.archived_by ?? holder.session?.user?.id ?? null) : null } : l))
      return clone(db.shotLists.find(l => l.id === listId))
    },
    upsertEdit: async (row) => {
      calls.push(['upsertEdit', row.id])
      const stored = db.edits.find(e => e.id === row.id)
      const next = { ...(stored || {}), ...clone(row), created_by: stored ? (stored.created_by ?? null) : (holder.session?.user?.id ?? null) }
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

async function mount(lists = 1) {
  render(<RabbitProvider><Probe /></RabbitProvider>)
  await waitFor(() => expect(ctxRef?.project?.id).toBe('p1'))
  await waitFor(() => expect(ctxRef.shotLists.length).toBe(lists))
}

const ids = (rows) => rows.map(r => r.id)

beforeEach(() => {
  holder.adapter = makeAdapter()
  holder.mode = 'local_server'
  holder.session = null
  holder.writable = true
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

  it('remove from the active list hides a scene ANOTHER list holds (D10); undo brings it back', async () => {
    await mount()
    await act(async () => { await ctxRef.addShotList({ title: 'Alt', from: 'L1' }) })
    await act(async () => { await ctxRef.removeFromShotList('L1', { sceneId: 'sc1' }) })
    expect(ids(ctxRef.scenes)).toEqual(['sc2'])
    expect(ids(ctxRef.shots)).toEqual(['sh2'])
    expect(ids(ctxRef.allScenes)).toEqual(['sc1', 'sc2'])
    await act(async () => { await ctxRef.undo() })
    expect(ids(ctxRef.scenes)).toEqual(['sc1', 'sc2'])
    expect(holder.adapter.db.shotListItems.filter(i => i.shot_list_id === 'L1')).toHaveLength(4)
  })

  it('D10 as ruled: a scene removed from its ONLY list leaves every other tab, and is reachable as unlisted', async () => {
    await mount()
    await act(async () => { await ctxRef.removeFromShotList('L1', { sceneId: 'sc1' }) })
    expect(ids(ctxRef.scenes)).toEqual(['sc2'])
    expect(ids(ctxRef.shots)).toEqual(['sh2'])
    expect(ids(ctxRef.unlistedScenes)).toEqual(['sc1'])
    expect(ids(ctxRef.unlistedShots)).toEqual(['sh1'])
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
    // Its shot went with it (0040's CASCADE, on every backend since round 1),
    // and both left every list.
    expect(ids(ctxRef.allShots)).toEqual(['sh1'])
    expect(ctxRef.shotListItems.some(i => i.scene_id === 'sc2' || i.shot_id === 'sh2')).toBe(false)
    expect(holder.adapter.db.shotListItems.some(i => i.scene_id === 'sc2' || i.shot_id === 'sh2')).toBe(false)
    expect(ctxRef.tasks.find(t => t.id === 't1').scene_id).toBeNull()
    await act(async () => { await ctxRef.undo() })
    // Visible again under D10: the scene, its shot, and their membership in
    // BOTH lists came back.
    await waitFor(() => expect(ids(ctxRef.scenes).sort()).toEqual(['sc1', 'sc2']))
    expect(ids(ctxRef.shots).sort()).toEqual(['sh1', 'sh2'])
    expect(ctxRef.shotListItems.filter(i => i.scene_id === 'sc2').map(i => i.shot_list_id).sort()).toEqual(['L1', alt.id].sort())
    expect(ctxRef.shotListItems.filter(i => i.shot_id === 'sh2').map(i => i.shot_list_id).sort()).toEqual(['L1', alt.id].sort())
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

  it('DELTAS: a collaborator\'s newer item survives this client\'s remove, reorder and their undo (review round 1)', async () => {
    await mount()
    // Another window adds sc9 to L1 after this client loaded (items are not broadcast).
    holder.adapter.db.scenes.push({ id: 'sc9', project_id: 'p1', name: 'Nine', scene_number: 9 })
    holder.adapter.db.shotListItems.push({ id: 'theirs', shot_list_id: 'L1', project_id: 'p1', scene_id: 'sc9', shot_id: null, position: 2 })
    await act(async () => { await ctxRef.removeFromShotList('L1', { sceneId: 'sc1' }) })
    await act(async () => { await ctxRef.reorderShotListItems('L1', ['sc2']) })
    await act(async () => { await ctxRef.undo() })
    await act(async () => { await ctxRef.undo() })
    expect(holder.adapter.db.shotListItems.some(i => i.id === 'theirs')).toBe(true)
    expect(holder.adapter.db.shotListItems.filter(i => i.shot_list_id === 'L1')).toHaveLength(5)
    // Control: no whole-list write happened at all.
    expect(holder.adapter.calls.some(c => c[0] === 'replaceShotListItems')).toBe(false)
  })

  it('a failed membership write takes the new scene back out and says why — nothing is left in no list by accident', async () => {
    await mount()
    holder.adapter.failNextUpsert = true
    let err = null
    await act(async () => { try { await ctxRef.addScene({ id: 'sc3', name: 'Three', scene_number: 3 }) } catch (e) { err = e } })
    expect(err?.message).toMatch(/disk full/)
    expect(ids(ctxRef.allScenes)).toEqual(['sc1', 'sc2'])
    expect(holder.adapter.db.scenes.some(s => s.id === 'sc3')).toBe(false)
    expect(ctxRef.canUndo).toBe(false)
    await waitFor(() => expect(ctxRef.error).toMatch(/disk full/))
  })

  it('an active list this client never loaded is fetched, and meanwhile every row shows', async () => {
    holder.adapter.db.shotLists.push({ id: 'L2', project_id: 'p1', title: 'Alt', version: 1, summary: null, snapshot: {}, archived_at: null, archived_by: null, created_at: '2026-09-02' })
    holder.adapter.db.shotListItems.push({ id: 'k1', shot_list_id: 'L2', project_id: 'p1', scene_id: 'sc2', shot_id: null, position: 0 })
    holder.adapter.db.project.active_shot_list_id = 'L2'
    holder.adapter.hideFromLoad.add('L2')
    render(<RabbitProvider><Probe /></RabbitProvider>)
    await waitFor(() => expect(ctxRef?.project?.id).toBe('p1'))
    await waitFor(() => expect(ctxRef.activeShotList?.id).toBe('L2'))
    expect(ids(ctxRef.scenes)).toEqual(['sc2'])
  })

  it('undoable: false leaves nothing a member\'s Ctrl+Z could land on', async () => {
    await mount()
    await act(async () => { await ctxRef.addShotList({ title: 'Alt', from: 'L1', undoable: false }) })
    expect(ctxRef.canUndo).toBe(false)
    await act(async () => { await ctxRef.createEditFrom({ listId: 'L1', title: 'Cut', undoable: false }) })
    expect(ctxRef.canUndo).toBe(false)
    // Control: the default records the undo.
    await act(async () => { await ctxRef.addShotList({ title: 'Alt', from: 'L1' }) })
    expect(ctxRef.canUndo).toBe(true)
  })

  it('edits form ONE chain per list (D6): a new edit continues from the tip; a second root or a branch is refused', async () => {
    await mount()
    let e1, e2
    await act(async () => { e1 = await ctxRef.createEditFrom({ listId: 'L1', title: 'Cut' }) })
    await act(async () => { e2 = await ctxRef.createEditFrom({ listId: 'L1', title: 'Cut' }) })
    expect(e2.parent_edit_id).toBe(e1.id)
    expect(e2.version).toBe(2)
    expect(ctxRef.editChainTip('L1').id).toBe(e2.id)
    await expect(ctxRef.createEditFrom({ listId: 'L1', title: 'Other', parentEditId: null })).rejects.toThrow("this shot list's edits form one chain — a new edit continues from the latest one")
    await expect(ctxRef.createEditFrom({ listId: 'L1', title: 'Other', parentEditId: e1.id })).rejects.toThrow("an edit's parent must be the latest edit of its shot list")
  })

  it('a delete\'s undo puts the row back into ARCHIVED lists too (round 2: the freeze made it lossy)', async () => {
    await mount()
    let alt
    await act(async () => { alt = await ctxRef.addShotList({ title: 'Alt', from: 'L1' }) })
    await act(async () => { await ctxRef.archiveShotList(alt.id) })
    await act(async () => { await ctxRef.deleteScene('sc2') })
    // The delete reaches the archived list too (the cloud's CASCADE).
    expect(holder.adapter.db.shotListItems.some(i => i.shot_list_id === alt.id && i.scene_id === 'sc2')).toBe(false)
    await act(async () => { await ctxRef.undo() })
    await waitFor(() => expect(ids(ctxRef.scenes).sort()).toEqual(['sc1', 'sc2']))
    expect(ctxRef.shotListItems.filter(i => i.scene_id === 'sc2').map(i => i.shot_list_id).sort()).toEqual(['L1', alt.id].sort())
    expect(holder.adapter.db.shotListItems.filter(i => i.shot_id === 'sh2').map(i => i.shot_list_id).sort()).toEqual(['L1', alt.id].sort())
    expect(ctxRef.tasks.find(t => t.id === 't1').scene_id).toBe('sc2')
    expect(ctxRef.error).toBeNull()
  })

  it('a reorder from a stale view never resurrects a row a collaborator removed (positions only)', async () => {
    await mount()
    let alt
    await act(async () => { alt = await ctxRef.addShotList({ title: 'Alt', from: 'L1' }) })
    const sc1Item = ctxRef.shotListItems.find(i => i.shot_list_id === alt.id && i.scene_id === 'sc1')
    // Another window removes sc1 from Alt after this client loaded it.
    holder.adapter.db.shotListItems = holder.adapter.db.shotListItems.filter(i => i.id !== sc1Item.id)
    await act(async () => { await ctxRef.reorderShotListItems(alt.id, ['sc2', 'sc1']) })
    await act(async () => { await ctxRef.undo() })
    await act(async () => { await ctxRef.redo() })
    expect(holder.adapter.db.shotListItems.some(i => i.id === sc1Item.id)).toBe(false)
    expect(holder.adapter.calls.filter(c => c[0] === 'upsertShotListItems' && c[1] === alt.id)).toHaveLength(1) // the copy only
    // Converged: the client stopped showing it too.
    await waitFor(() => expect(ctxRef.shotListItems.some(i => i.id === sc1Item.id)).toBe(false))
  })

  it('removing a row that is already gone server-side leaves state too (no stuck row, no silent retry)', async () => {
    await mount()
    const sc1Item = ctxRef.shotListItems.find(i => i.shot_list_id === 'L1' && i.scene_id === 'sc1')
    holder.adapter.db.shotListItems = holder.adapter.db.shotListItems.filter(i => i.id !== sc1Item.id)
    await act(async () => { await ctxRef.removeFromShotList('L1', { sceneId: 'sc1' }) })
    expect(ctxRef.shotListItems.some(i => i.id === sc1Item.id)).toBe(false)
  })

  it('an undone bulk delete (shots, then their scene, not awaited — ScenesView\'s shape) leaves no duplicate rows', async () => {
    await mount()
    await act(async () => {
      const a = ctxRef.deleteShot('sh2')
      const b = ctxRef.deleteScene('sc2')
      await Promise.all([a, b])
    })
    await act(async () => { await ctxRef.undo() })
    await act(async () => { await ctxRef.undo() })
    const shotIds = ctxRef.allShots.map(s => s.id)
    expect(shotIds.filter(x => x === 'sh2')).toHaveLength(1)
    expect(ctxRef.allScenes.map(s => s.id).filter(x => x === 'sc2')).toHaveLength(1)
  })

  it('a list whose copy fails still exists and its undo is still on the stack', async () => {
    await mount()
    holder.adapter.failNextUpsert = true
    let err = null
    await act(async () => { try { await ctxRef.addShotList({ title: 'Alt', from: 'L1' }) } catch (e) { err = e } })
    expect(err?.message).toMatch(/disk full/)
    expect(ctxRef.canUndo).toBe(true)
    const alt = ctxRef.shotLists.find(l => l.title === 'Alt')
    expect(alt).toBeTruthy()
    await act(async () => { await ctxRef.undo() })
    expect(ctxRef.shotLists.find(l => l.id === alt.id).archived_at).toBeTruthy()
  })

  it('a new scene placed while the active list is unknown is placed in it once the lists are read', async () => {
    await mount()
    // Another window made a new list L9 and activated it; this client has not seen L9.
    holder.adapter.db.shotLists.push({ id: 'L9', project_id: 'p1', title: 'Nine', version: 1, summary: null, snapshot: {}, archived_at: null, archived_by: null, created_at: '2026-09-03' })
    holder.adapter.db.project.active_shot_list_id = 'L9'
    holder.adapter.hideFromLoad.add('L9')
    let s4
    // S3b names the list the Scenes tab is viewing; this client never loaded it.
    await act(async () => { s4 = await ctxRef.addScene({ name: 'Four', scene_number: 4 }, { listId: 'L9' }) })
    expect(holder.adapter.db.shotListItems.some(i => i.shot_list_id === 'L9' && i.scene_id === s4.id)).toBe(true)
  })
})

// ── 0086: withdraw (Audrey, 2026-09-30) ────────────────────────────────────
// "allow users to view their most recently deleted list. only right after
// they deleted." The undo of New list / New edit WITHDRAWS the row (archived
// by its maker, never deleted); right after, it is ctx.recentlyWithdrawn.
const LIST_REFUSAL = 'only an untouched shot list you made can be withdrawn — a project manager or a workspace admin can archive it'
const EDIT_REFUSAL = 'only an untouched edit you made can be withdrawn — a project manager or a workspace admin can archive it'
const SEAT_REFUSAL = 'only a project manager or a workspace admin can archive or restore a shot list'
const cloudAs = (uid, role = 'member') => {
  holder.mode = 'supabase'
  holder.session = { user: { id: uid, app_metadata: {} } }
  holder.adapter.listProjectMembers = async () => [{ project_id: 'p1', user_id: uid, project_role: role }]
}
const listRow = (id) => ctxRef.shotLists.find(l => l.id === id)
const editRow = (id) => ctxRef.edits.find(e => e.id === id)

describe('0086 — withdraw through the real provider', () => {
  it('undo of "New list" WITHDRAWS it and marks it recently removed; redo puts it back and ends the mark', async () => {
    await mount()
    let alt
    await act(async () => { alt = await ctxRef.addShotList({ title: 'Alt' }) })
    expect(ctxRef.canWithdrawShotList(alt.id)).toBe(true)
    expect(ctxRef.canWithdrawShotList('L1')).toBe(false) // the active list (D4)
    expect(ctxRef.recentlyWithdrawn).toBeNull()
    await act(async () => { await ctxRef.undo() })
    expect(listRow(alt.id).archived_at).toBeTruthy()
    expect(ctxRef.recentlyWithdrawn).toMatchObject({ kind: 'shot_list', id: alt.id })
    expect(ctxRef.recentlyWithdrawn.row.title).toBe('Alt')
    // Openable: an archived list still reads its membership.
    expect(ctxRef.scenesOf(alt.id)).toEqual([])
    await act(async () => { await ctxRef.redo() })
    expect(listRow(alt.id).archived_at).toBeNull()
    expect(ctxRef.recentlyWithdrawn).toBeNull()
  })

  it('refuses, before any write and in the database\'s words, a Saved list, one with a live edit, and the active list', async () => {
    await mount()
    let saved, withEdit
    await act(async () => { saved = await ctxRef.addShotList({ title: 'Saved' }) })
    await act(async () => { await ctxRef.saveShotListSnapshot(saved.id) })
    await act(async () => { withEdit = await ctxRef.addShotList({ title: 'Cut list' }) })
    await act(async () => { await ctxRef.createEditFrom({ listId: withEdit.id, title: 'Cut' }) })
    const archives = () => holder.adapter.calls.filter(c => c[0] === 'archiveShotList').length
    const before = archives()
    await expect(ctxRef.withdrawShotList(saved.id)).rejects.toThrow(LIST_REFUSAL)
    await expect(ctxRef.withdrawShotList(withEdit.id)).rejects.toThrow(LIST_REFUSAL)
    await expect(ctxRef.withdrawShotList('L1')).rejects.toThrow('the active shot list cannot be archived — make another list active first')
    expect(archives()).toBe(before)
    expect(ctxRef.canWithdrawShotList(saved.id)).toBe(false)
    expect(ctxRef.canWithdrawShotList(withEdit.id)).toBe(false)
    expect(ctxRef.recentlyWithdrawn).toBeNull()
  })

  it('Ctrl+Z walks back New edit, then New list: the edit is withdrawn first, then the list; only the latest is marked', async () => {
    await mount()
    let list, edit
    await act(async () => { list = await ctxRef.addShotList({ title: 'Pickups' }) })
    await act(async () => { edit = await ctxRef.createEditFrom({ listId: list.id, title: 'Cut' }) })
    expect(ctxRef.canWithdrawShotList(list.id)).toBe(false) // a live edit is on it
    expect(ctxRef.canWithdrawEdit(edit.id)).toBe(true)
    await act(async () => { await ctxRef.undo() })
    expect(editRow(edit.id).archived_at).toBeTruthy()
    expect(ctxRef.recentlyWithdrawn).toMatchObject({ kind: 'edit', id: edit.id })
    await act(async () => { await ctxRef.undo() })
    expect(listRow(list.id).archived_at).toBeTruthy()
    expect(ctxRef.recentlyWithdrawn).toMatchObject({ kind: 'shot_list', id: list.id })
    expect(ctxRef.error).toBeNull()
  })

  it('an edit that a live edit continues, or a Saved one, cannot be withdrawn', async () => {
    await mount()
    let e1, e2
    await act(async () => { e1 = await ctxRef.createEditFrom({ listId: 'L1', title: 'Cut' }) })
    await act(async () => { e2 = await ctxRef.createEditFrom({ listId: 'L1', title: 'Cut' }) })
    expect(e2.parent_edit_id).toBe(e1.id)
    await expect(ctxRef.withdrawEdit(e1.id)).rejects.toThrow(EDIT_REFUSAL)
    await act(async () => { await ctxRef.saveEdit(e2.id, []) })
    await expect(ctxRef.withdrawEdit(e2.id)).rejects.toThrow(EDIT_REFUSAL)
    expect(holder.adapter.calls.some(c => c[0] === 'archiveEdit')).toBe(false)
    expect(ctxRef.canWithdrawEdit(e1.id)).toBe(false)
    expect(ctxRef.canWithdrawEdit(e2.id)).toBe(false)
  })

  it('restoreWithdrawn() puts the recently removed list back as ONE undo step; clearRecentlyWithdrawn() only ends the mark', async () => {
    await mount()
    let alt
    await act(async () => { alt = await ctxRef.addShotList({ title: 'Alt' }) })
    await act(async () => { await ctxRef.withdrawShotList(alt.id) })
    expect(ctxRef.recentlyWithdrawn?.id).toBe(alt.id)
    await act(async () => { await ctxRef.restoreWithdrawn() })
    expect(listRow(alt.id).archived_at).toBeNull()
    expect(ctxRef.recentlyWithdrawn).toBeNull()
    // Its undo withdraws the list again, and marks it again.
    await act(async () => { await ctxRef.undo() })
    expect(listRow(alt.id).archived_at).toBeTruthy()
    expect(ctxRef.recentlyWithdrawn?.id).toBe(alt.id)
    // Leaving the Scenes tab: the mark ends, the list stays set aside.
    await act(async () => { ctxRef.clearRecentlyWithdrawn() })
    expect(ctxRef.recentlyWithdrawn).toBeNull()
    expect(listRow(alt.id).archived_at).toBeTruthy()
  })

  it('a scene only the withdrawn list held is "Not in any list" at once, and listed again on restore', async () => {
    await mount()
    let alt, s4
    await act(async () => { alt = await ctxRef.addShotList({ title: 'Alt' }) })
    await act(async () => { s4 = await ctxRef.addScene({ name: 'Four', scene_number: 4 }, { listId: alt.id }) })
    expect(ids(ctxRef.unlistedScenes)).not.toContain(s4.id)
    await act(async () => { await ctxRef.withdrawShotList(alt.id) })
    expect(ids(ctxRef.unlistedScenes)).toContain(s4.id)
    expect(ids(ctxRef.scenes)).not.toContain(s4.id) // D10: still off the other tabs
    await act(async () => { await ctxRef.restoreWithdrawn() })
    expect(ids(ctxRef.unlistedScenes)).not.toContain(s4.id)
  })

  it('a restore by the manager\'s verb ends the mark too, so a later archive never reads as "recently removed"', async () => {
    await mount()
    let alt
    await act(async () => { alt = await ctxRef.addShotList({ title: 'Alt' }) })
    await act(async () => { await ctxRef.withdrawShotList(alt.id) })
    await act(async () => { await ctxRef.archiveShotList(alt.id, false) })
    expect(ctxRef.recentlyWithdrawn).toBeNull()
    await act(async () => { await ctxRef.archiveShotList(alt.id, true) })
    expect(listRow(alt.id).archived_at).toBeTruthy()
    expect(ctxRef.recentlyWithdrawn).toBeNull()
  })

  it('a Ctrl+Z whose withdraw is refused says why (undo swallows the throw) and leaves the list live', async () => {
    await mount()
    let alt
    await act(async () => { alt = await ctxRef.addShotList({ title: 'Alt' }) })
    // A collaborator Saves it in another window; this client reads it back.
    holder.adapter.db.shotLists = holder.adapter.db.shotLists.map(l => (l.id === alt.id ? { ...l, snapshot: { kind: 'shot_list' } } : l))
    await act(async () => { await ctxRef.refreshShotLists() })
    await act(async () => { await ctxRef.undo() })
    expect(listRow(alt.id).archived_at).toBeNull()
    expect(ctxRef.error).toBe(LIST_REFUSAL)
    expect(ctxRef.recentlyWithdrawn).toBeNull()
  })

  it('on the cloud the maker test applies: your own new list is withdrawable, someone else\'s is not', async () => {
    holder.mode = 'supabase'
    holder.session = { user: { id: 'u-me', app_metadata: {} } }
    holder.adapter.listProjectMembers = async () => [{ project_id: 'p1', user_id: 'u-me', project_role: 'member' }]
    holder.adapter.db.shotLists.push({ id: 'L9', project_id: 'p1', title: 'Theirs', version: 1, summary: null, snapshot: {},
      archived_at: null, archived_by: null, created_by: 'u-other', created_at: '2026-09-02' })
    await mount(2)
    expect(ctxRef.adapterMode).toBe('supabase')
    let mine
    await act(async () => { mine = await ctxRef.addShotList({ title: 'Mine' }) })
    expect(mine.created_by).toBe('u-me')
    await waitFor(() => expect(ctxRef.canWithdrawShotList(mine.id)).toBe(true))
    expect(ctxRef.canWithdrawShotList('L9')).toBe(false)
    await expect(ctxRef.withdrawShotList('L9')).rejects.toThrow(SEAT_REFUSAL)
    expect(holder.adapter.calls.some(c => c[0] === 'archiveShotList' && c[1] === 'L9')).toBe(false)
    await act(async () => { await ctxRef.undo() })
    expect(listRow(mine.id).archived_at).toBeTruthy()
    expect(listRow(mine.id).archived_by).toBe('u-me')
    expect(ctxRef.isWithdrawn(listRow(mine.id))).toBe(true)
    expect(ctxRef.recentlyWithdrawn?.id).toBe(mine.id)
  })
})

describe('0086 — review round 1 of the withdraw', () => {
  it('two Ctrl+Z presses fired together take back New edit, then New list: queued, neither refused', async () => {
    await mount()
    let list, edit
    await act(async () => { list = await ctxRef.addShotList({ title: 'Pickups' }) })
    await act(async () => { edit = await ctxRef.createEditFrom({ listId: list.id, title: 'Cut' }) })
    await act(async () => { await Promise.all([ctxRef.undo(), ctxRef.undo()]) })
    expect(editRow(edit.id).archived_at).toBeTruthy()
    expect(listRow(list.id).archived_at).toBeTruthy()
    expect(ctxRef.error).toBeNull()
    expect(ctxRef.recentlyWithdrawn).toMatchObject({ kind: 'shot_list', id: list.id })
    // Both entries reached the redo stack: two redos put both back.
    await act(async () => { await ctxRef.redo() })
    await act(async () => { await ctxRef.redo() })
    expect(listRow(list.id).archived_at).toBeNull()
    expect(editRow(edit.id).archived_at).toBeNull()
  })

  it('two Ctrl+Z presses one after the other, with no render between, see each other\'s writes', async () => {
    await mount()
    let list, edit
    await act(async () => { list = await ctxRef.addShotList({ title: 'Pickups' }) })
    await act(async () => { edit = await ctxRef.createEditFrom({ listId: list.id, title: 'Cut' }) })
    await act(async () => { await ctxRef.undo(); await ctxRef.undo() })
    expect(editRow(edit.id).archived_at).toBeTruthy()
    expect(listRow(list.id).archived_at).toBeTruthy()
    expect(ctxRef.error).toBeNull()
  })

  it('a rename from a stale view never erases a collaborator\'s newer Save, or an edit\'s newer items', async () => {
    await mount()
    let alt, cut
    await act(async () => { alt = await ctxRef.addShotList({ title: 'Alt' }) })
    await act(async () => { cut = await ctxRef.createEditFrom({ listId: alt.id, title: 'Cut', items: [{ scene_id: 'sc1', shot_id: null }] }) })
    // In another window a collaborator Saves the list and rewrites the edit; this client never hears of it.
    holder.adapter.db.shotLists = holder.adapter.db.shotLists.map(l => (l.id === alt.id ? { ...l, snapshot: { kind: 'shot_list', saved_by: 'them' } } : l))
    holder.adapter.db.edits = holder.adapter.db.edits.map(e => (e.id === cut.id
      ? { ...e, items: [{ id: 'x', scene_id: 'sc2', shot_id: null, label: null, notes: null }], snapshot: { kind: 'edit' } } : e))
    await act(async () => { await ctxRef.updateShotList(alt.id, { title: 'Alt renamed' }) })
    await act(async () => { await ctxRef.updateEdit(cut.id, { title: 'Cut renamed' }) })
    const storedList = holder.adapter.db.shotLists.find(l => l.id === alt.id)
    expect(storedList.title).toBe('Alt renamed')
    expect(storedList.snapshot).toEqual({ kind: 'shot_list', saved_by: 'them' })
    const storedEdit = holder.adapter.db.edits.find(e => e.id === cut.id)
    expect(storedEdit.title).toBe('Cut renamed')
    expect(storedEdit.items.map(i => i.id)).toEqual(['x'])
    expect(storedEdit.snapshot).toEqual({ kind: 'edit' })
    // …and the server's row is what this client now shows.
    expect(listRow(alt.id).snapshot).toEqual({ kind: 'shot_list', saved_by: 'them' })
  })

  it('restoreWithdrawn wired straight to onClick (it receives the click event) restores the marked row', async () => {
    await mount()
    let alt
    await act(async () => { alt = await ctxRef.addShotList({ title: 'Alt' }) })
    await act(async () => { await ctxRef.withdrawShotList(alt.id) })
    await act(async () => { await ctxRef.restoreWithdrawn({ type: 'click', target: {} }) })
    expect(listRow(alt.id).archived_at).toBeNull()
    expect(ctxRef.recentlyWithdrawn).toBeNull()
  })

  it('switching project ends the mark (her ruling), and switching back does not bring it back', async () => {
    await mount()
    const loadP1 = holder.adapter.loadProject
    holder.adapter.loadProject = async (pid) => (pid === 'p2'
      ? { project: { id: 'p2', title: 'Other', active_shot_list_id: null, scenes_enabled: true },
          scenes: [], shots: [], tasks: [], shotLists: [], shotListItems: [], edits: [] }
      : loadP1(pid))
    let alt
    await act(async () => { alt = await ctxRef.addShotList({ title: 'Alt' }) })
    await act(async () => { await ctxRef.withdrawShotList(alt.id) })
    expect(ctxRef.recentlyWithdrawn?.id).toBe(alt.id)
    await act(async () => { await ctxRef.setActiveProject('p2') })
    await waitFor(() => expect(ctxRef.project?.id).toBe('p2'))
    expect(ctxRef.recentlyWithdrawn).toBeNull()
    await act(async () => { await ctxRef.setActiveProject('p1') })
    await waitFor(() => expect(ctxRef.project?.id).toBe('p1'))
    expect(listRow(alt.id).archived_at).toBeTruthy()
    expect(ctxRef.recentlyWithdrawn).toBeNull()
  })

  it('a withdraw still in flight across a project switch and back does not mark when it lands', async () => {
    await mount()
    const loadP1 = holder.adapter.loadProject
    holder.adapter.loadProject = async (pid) => (pid === 'p2'
      ? { project: { id: 'p2', title: 'Other', active_shot_list_id: null, scenes_enabled: true },
          scenes: [], shots: [], tasks: [], shotLists: [], shotListItems: [], edits: [] }
      : loadP1(pid))
    let alt
    await act(async () => { alt = await ctxRef.addShotList({ title: 'Alt' }) })
    let release
    const gate = new Promise(r => { release = r })
    const realArchive = holder.adapter.archiveShotList
    holder.adapter.archiveShotList = async (...args) => { await gate; return realArchive(...args) }
    let pending
    await act(async () => { pending = ctxRef.withdrawShotList(alt.id) })
    await act(async () => { await ctxRef.setActiveProject('p2') })
    await act(async () => { await ctxRef.setActiveProject('p1') })
    await waitFor(() => expect(ctxRef.project?.id).toBe('p1'))
    await act(async () => { release(); await pending })
    expect(holder.adapter.db.shotLists.find(l => l.id === alt.id).archived_at).toBeTruthy()
    expect(ctxRef.recentlyWithdrawn).toBeNull()
  })

  it('without users (Local Server) a row seen live ends the mark, so a later archive never reads as "recently removed"', async () => {
    await mount()
    let alt
    await act(async () => { alt = await ctxRef.addShotList({ title: 'Alt' }) })
    await act(async () => { await ctxRef.withdrawShotList(alt.id) })
    // Another window restores it, and later archives it.
    holder.adapter.db.shotLists = holder.adapter.db.shotLists.map(l => (l.id === alt.id ? { ...l, archived_at: null } : l))
    await act(async () => { await ctxRef.refreshShotLists() })
    expect(ctxRef.recentlyWithdrawn).toBeNull()
    holder.adapter.db.shotLists = holder.adapter.db.shotLists.map(l => (l.id === alt.id ? { ...l, archived_at: 'T2' } : l))
    await act(async () => { await ctxRef.refreshShotLists() })
    expect(ctxRef.recentlyWithdrawn).toBeNull()
  })

  it('a read-only backend (Drive) offers no withdraw', async () => {
    holder.adapter.db.shotLists.push({ id: 'L2', project_id: 'p1', title: 'Spare', version: 1, summary: null, snapshot: {},
      archived_at: null, archived_by: null, created_at: '2026-09-02' })
    holder.writable = false
    await mount(2)
    expect(ctxRef.canWithdrawShotList('L2')).toBe(false)
    // Control: the same list on a writable backend.
    cleanup()
    holder.adapter = makeAdapter()
    holder.adapter.db.shotLists.push({ id: 'L2', project_id: 'p1', title: 'Spare', version: 1, summary: null, snapshot: {},
      archived_at: null, archived_by: null, created_at: '2026-09-02' })
    holder.writable = true
    await mount(2)
    expect(ctxRef.canWithdrawShotList('L2')).toBe(true)
  })

  it('on the cloud a failed roster read still knows the user, so the maker\'s Ctrl+Z of New list works', async () => {
    cloudAs('u-me')
    holder.adapter.listProjectMembers = async () => { throw httpError(503, 'roster unavailable') }
    await mount()
    let mine
    await act(async () => { mine = await ctxRef.addShotList({ title: 'Mine' }) })
    await waitFor(() => expect(ctxRef.canWithdrawShotList(mine.id)).toBe(true))
    await act(async () => { await ctxRef.undo() })
    expect(listRow(mine.id).archived_at).toBeTruthy()
    expect(listRow(mine.id).archived_by).toBe('u-me')
  })

  it('on the cloud, while the user is not known, the selectors say no but Ctrl+Z lets the database decide', async () => {
    holder.mode = 'supabase'
    holder.session = null // the session read names nobody yet
    holder.adapter.listProjectMembers = async () => []
    await mount()
    let alt
    await act(async () => { alt = await ctxRef.addShotList({ title: 'Alt' }) })
    expect(ctxRef.canWithdrawShotList(alt.id)).toBe(false)
    await act(async () => { await ctxRef.undo() })
    expect(listRow(alt.id).archived_at).toBeTruthy()
  })

  it('on the cloud the maker restores a withdrawn edit even after a newer edit continued it', async () => {
    cloudAs('u-me')
    await mount()
    let v1, v2
    await act(async () => { v1 = await ctxRef.createEditFrom({ listId: 'L1', title: 'Cut' }) })
    await waitFor(() => expect(ctxRef.canWithdrawEdit(v1.id)).toBe(true))
    await act(async () => { await ctxRef.undo() })
    expect(ctxRef.recentlyWithdrawn?.id).toBe(v1.id)
    await act(async () => { v2 = await ctxRef.createEditFrom({ listId: 'L1', title: 'Cut' }) })
    expect(v2.parent_edit_id).toBe(v1.id) // the chain continues from the withdrawn edit
    await act(async () => { await ctxRef.restoreWithdrawn() })
    expect(editRow(v1.id).archived_at).toBeNull()
    expect(ctxRef.recentlyWithdrawn).toBeNull()
  })

  it('on the cloud restoreWithdrawn refuses, before any write, a row this person did not set aside', async () => {
    cloudAs('u-me')
    holder.adapter.db.shotLists.push({ id: 'L8', project_id: 'p1', title: 'Theirs now', version: 1, summary: null, snapshot: {},
      archived_at: 'T', archived_by: 'u-boss', created_by: 'u-me', created_at: '2026-09-02' })
    await mount(2)
    await waitFor(() => expect(ctxRef.adapterMode).toBe('supabase'))
    const archives = () => holder.adapter.calls.filter(c => c[0] === 'archiveShotList').length
    const before = archives()
    await expect(ctxRef.restoreWithdrawn({ kind: 'shot_list', id: 'L8' })).rejects.toThrow(SEAT_REFUSAL)
    expect(archives()).toBe(before)
    expect(listRow('L8').archived_at).toBe('T')
  })

  it('on the cloud the mark shows only while the row is set aside by THIS person', async () => {
    cloudAs('u-me')
    await mount()
    let alt
    await act(async () => { alt = await ctxRef.addShotList({ title: 'Alt' }) })
    await waitFor(() => expect(ctxRef.canWithdrawShotList(alt.id)).toBe(true))
    await act(async () => { await ctxRef.withdrawShotList(alt.id) })
    expect(ctxRef.recentlyWithdrawn?.id).toBe(alt.id)
    // A manager in another window takes it over (restores, then archives it themselves).
    holder.adapter.db.shotLists = holder.adapter.db.shotLists.map(l => (l.id === alt.id ? { ...l, archived_at: 'T2', archived_by: 'u-boss' } : l))
    await act(async () => { await ctxRef.refreshShotLists() })
    expect(ctxRef.recentlyWithdrawn).toBeNull()
  })
})
