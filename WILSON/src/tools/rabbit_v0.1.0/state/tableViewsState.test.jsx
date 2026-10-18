/** @vitest-environment jsdom */
// =============================================================================
// tableViewsState.test.jsx — VW1c (0098): custom table views in the provider
// (state/tableViewsState.js), against a fake backend that answers as the
// adapter contract says (adapters/index.js):
//   · the views and groupings come from the bundle; availability and a load's
//     read error come from the adapter;
//   · every mutator answers what the backend said and offers its undo in the
//     toast — never a keyboard-history step — and each undo is conditional as
//     design §4.4 says (a refused undo says why and closes; a failed request
//     keeps the toast to try again);
//   · nothing lands on another project than the one a write began on;
//   · the last used view: read once, its 2 s wait, written only when ready,
//     in order;
//   · the changes for now: per table, dropped on a project switch;
//   · the sweep's helpers for the provider's deletes.
// =============================================================================
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useTableViewsState, groupingsNaming, sweepGroupings, restoreGroupingRows,
  TABLE_VIEWS_UNAVAILABLE_WORDS, TABLE_VIEW_LAST_WAIT_MS,
} from './tableViewsState'

const P1 = 'p1'
const view = (id, extra = {}) => ({
  id, project_id: P1, table_key: 'tasks', name: `View ${id}`, position: 0, revision: 10,
  revised_by: null, config: { version: 1 }, created_at: '2026-10-17T10:00:00Z', ...extra,
})
const grouping = (id, ids, extra = {}) => ({
  id, project_id: P1, table_key: 'tasks', kind: 'asset', entity_ids: ids, created_at: '2026-10-17T10:00:00Z', ...extra,
})

// A fake backend keeping rows the way the cloud does: revisions from one
// counter, conditional writes answering the contract's statuses.
function fakeBackend({ views = [], groupings = [], available = true, loadError = null, last = { available: true, map: {} } } = {}) {
  let counter = 100
  const db = { views: views.map(v => ({ ...v })), groupings: groupings.map(g => ({ ...g })), map: { ...last.map } }
  const calls = []
  const a = {
    calls, db,
    tableViewsAvailable: () => available,
    tableViewsLoadError: () => loadError,
    addTableView: vi.fn(async (row) => {
      calls.push(['addTableView', row])
      if (db.views.some(v => v.id === row.id)) { const e = new Error('taken'); e.code = '23505'; throw e }
      const stored = { ...row, revision: ++counter, revised_by: 'u1', created_at: '2026-10-17T11:00:00Z' }
      db.views.push(stored)
      return { ...stored }
    }),
    updateTableView: vi.fn(async (id, patch, opts = {}) => {
      calls.push(['updateTableView', id, patch, opts])
      const row = db.views.find(v => v.id === id)
      if (!row) return { status: 'deleted' }
      if (opts.expectRevision != null && row.revision !== opts.expectRevision) return { status: 'changed', row: { ...row } }
      if (opts.expectName != null && row.name !== opts.expectName) return { status: 'changed', row: { ...row } }
      if (patch.config && JSON.stringify(patch.config) !== JSON.stringify(row.config)) { row.revision = ++counter; row.revised_by = 'u1' }
      Object.assign(row, patch)
      return { status: 'saved', row: { ...row } }
    }),
    deleteTableView: vi.fn(async (id, opts = {}) => {
      calls.push(['deleteTableView', id, opts])
      const row = db.views.find(v => v.id === id)
      if (!row) return { status: 'deleted' }
      if (opts.expectRevision != null && row.revision !== opts.expectRevision) return { status: 'changed', row: { ...row } }
      db.views = db.views.filter(v => v.id !== id)
      return { status: 'removed' }
    }),
    reorderTableViews: vi.fn(async (projectId, tableKey, ids) => {
      calls.push(['reorderTableViews', projectId, tableKey, ids])
      const rows = db.views.filter(v => v.table_key === tableKey)
      const rank = new Map(ids.map((id, i) => [id, i]))
      rows.sort((x, y) => (rank.has(x.id) ? rank.get(x.id) : 1e9) - (rank.has(y.id) ? rank.get(y.id) : 1e9) || x.position - y.position)
      const moved = []
      rows.forEach((r, i) => { if (r.position !== i) { r.position = i; moved.push({ ...r }) } })
      return moved
    }),
    addItemGrouping: vi.fn(async (row) => {
      calls.push(['addItemGrouping', row])
      const key = [...row.entity_ids].sort().join('|')
      const same = db.groupings.find(g => g.table_key === row.table_key && g.kind === row.kind && [...g.entity_ids].sort().join('|') === key)
      if (same) return { ...same }
      if (row.entity_ids.includes('gone')) { const e = new Error('not in the project'); e.code = '23503'; throw e }
      const stored = { ...row, created_at: '2026-10-17T11:00:00Z' }
      db.groupings.push(stored)
      return { ...stored }
    }),
    removeItemGrouping: vi.fn(async (id) => {
      calls.push(['removeItemGrouping', id])
      const had = db.groupings.some(g => g.id === id)
      db.groupings = db.groupings.filter(g => g.id !== id)
      return { removed: had }
    }),
    getTableViewLast: vi.fn(async () => ({ available: last.available, map: { ...db.map } })),
    setTableViewLast: vi.fn(async (key, viewId) => {
      calls.push(['setTableViewLast', key, viewId])
      db.map = { ...db.map, [key]: { view: viewId, at: Date.now() } }
      return { ...db.map }
    }),
  }
  return a
}

// The provider's wiring, in miniature: the bundle in state and a ref, the
// project visit's generation, the toast and the notice recorded.
function useHarness({ adapter, bundle: initial, activeProjectId, adapterMode = 'supabase', authUserId = 'u1' }) {
  const [bundle, setBundle] = useState(initial)
  const bundleRef = useRef(bundle)
  useEffect(() => { bundleRef.current = bundle }, [bundle])
  const adapterRef = useRef(adapter)
  const projectVisitRef = useRef(0)
  const seenProject = useRef(undefined)
  if (seenProject.current !== activeProjectId) { seenProject.current = activeProjectId; projectVisitRef.current += 1 }
  const toasts = useRef([])
  const notices = useRef([])
  const showUndoToast = useCallback((message, onUndo) => { toasts.current.push({ message, onUndo }) }, [])
  const setError = useCallback((m) => { notices.current.push(m) }, [])
  const api = useTableViewsState({
    adapterRef, bundleRef, setBundle, bundle, activeProjectId, adapterMode, authUserId,
    projectVisitRef, showUndoToast, setError,
  })
  return { api, bundle, bundleRef, toasts, notices, projectVisitRef }
}

function setup({ backend, bundle, activeProjectId = P1, adapterMode, authUserId } = {}) {
  const adapter = backend || fakeBackend()
  const start = bundle || { tableViews: adapter.db.views.map(v => ({ ...v })), itemGroupings: adapter.db.groupings.map(g => ({ ...g })) }
  const hook = renderHook((props) => useHarness(props), {
    initialProps: { adapter, bundle: start, activeProjectId, adapterMode, authUserId },
  })
  return { adapter, hook, current: () => hook.result.current }
}

afterEach(() => { vi.useRealTimers() })

describe('what the provider reads', () => {
  it('the bundle\'s views and groupings, the selectors, availability and a load\'s error', () => {
    const backend = fakeBackend({
      views: [view('v2', { position: 1 }), view('v1'), view('a1', { table_key: 'assets' })],
      groupings: [grouping('g1', ['A1'])], loadError: 'The views could not be read.',
    })
    const { current } = setup({ backend })
    expect(current().api.available).toBe(true)
    expect(current().api.loadError).toBe('The views could not be read.')
    expect(current().api.viewsOf('tasks').map(v => v.id)).toEqual(['v1', 'v2'])
    expect(current().api.viewsOf('assets').map(v => v.id)).toEqual(['a1'])
    expect(current().api.groupingsOf('tasks', 'asset').map(g => g.id)).toEqual(['g1'])
    expect(current().api.allViewOf('tasks')).toMatchObject({ id: 'all', builtIn: true })
  })

  it('a backend without views (a cloud before 0098, Drive): every write refuses before any request, in words', async () => {
    const backend = fakeBackend({ available: false })
    const { current } = setup({ backend })
    expect(current().api.available).toBe(false)
    await expect(current().api.addTableView({ tableKey: 'tasks', name: 'Mine' })).rejects.toMatchObject({ code: 'table_views_unavailable', message: TABLE_VIEWS_UNAVAILABLE_WORDS })
    await expect(current().api.addItemGrouping({ tableKey: 'tasks', kind: 'asset', entityIds: ['A1'] })).rejects.toMatchObject({ code: 'table_views_unavailable' })
    expect(backend.calls).toEqual([])
  })
})

describe('views: the mutators, their answers and their undos (design §4.4)', () => {
  it('a new view is inserted after the table\'s last, starting as All; its undo deletes it only while it has the revision it was made with', async () => {
    const backend = fakeBackend({ views: [view('v1', { position: 4 })] })
    const { current } = setup({ backend })
    let stored
    await act(async () => { stored = await current().api.addTableView({ tableKey: 'tasks', name: '  Shoot week ' }) })
    const sent = backend.calls.find(c => c[0] === 'addTableView')[1]
    expect(sent).toMatchObject({ project_id: P1, table_key: 'tasks', name: 'Shoot week', position: 5, config: { version: 1 } })
    expect(Object.keys(sent).sort()).toEqual(['config', 'id', 'name', 'position', 'project_id', 'table_key'])
    expect(current().api.viewsOf('tasks').map(v => v.id)).toEqual(['v1', stored.id])
    expect(current().toasts.current.at(-1).message).toBe('Shoot week saved for everyone')
    await act(async () => { await current().toasts.current.at(-1).onUndo() })
    expect(backend.calls.at(-1)).toEqual(['deleteTableView', stored.id, { projectId: P1, expectRevision: stored.revision }])
    expect(current().api.viewsOf('tasks').map(v => v.id)).toEqual(['v1'])
  })

  it('CONTROL: a teammate saved the new view meanwhile — the undo keeps it, and says why', async () => {
    const backend = fakeBackend()
    const { current } = setup({ backend })
    let stored
    await act(async () => { stored = await current().api.addTableView({ tableKey: 'tasks', name: 'Shoot week' }) })
    backend.db.views[0].revision = 999 // their save
    await act(async () => { await current().toasts.current.at(-1).onUndo() })
    expect(backend.db.views.map(v => v.id)).toEqual([stored.id])
    expect(current().notices.current.at(-1)).toMatch(/changed meanwhile/)
    expect(current().api.viewsOf('tasks')[0].revision).toBe(999)
  })

  it('a settings save is conditional on the revision it started from (the view\'s own by default)', async () => {
    const backend = fakeBackend({ views: [view('v1', { config: { version: 1, keep: 'me' } })] })
    const { current } = setup({ backend })
    let res
    await act(async () => { res = await current().api.updateTableView('v1', { sorts: [{ field: 'title', dir: 'asc' }] }) })
    expect(res.status).toBe('saved')
    const [, , patch, opts] = backend.calls.at(-1)
    expect(opts).toEqual({ projectId: P1, expectRevision: 10 })
    // The stored keys this build does not know are kept (design §5.1).
    expect(patch.config).toEqual({ version: 1, keep: 'me', sorts: [{ field: 'title', dir: 'asc' }] })
    expect(current().api.viewsOf('tasks')[0].revision).toBe(res.row.revision)
    expect(current().toasts.current.at(-1).message).toBe('View v1 saved')
    // Its undo writes the old config only while the view has the revision the save left.
    await act(async () => { await current().toasts.current.at(-1).onUndo() })
    expect(backend.calls.at(-1)).toEqual(['updateTableView', 'v1', { config: { version: 1, keep: 'me' } }, { projectId: P1, expectRevision: res.row.revision }])
    expect(current().api.viewsOf('tasks')[0].config).toEqual({ version: 1, keep: 'me' })
  })

  it('a save from an old revision: changed meanwhile — the stored row comes in, nothing is offered to undo', async () => {
    const backend = fakeBackend({ views: [view('v1')] })
    const { current } = setup({ backend })
    backend.db.views[0].revision = 55
    backend.db.views[0].config = { version: 1, theirs: true }
    let res
    await act(async () => { res = await current().api.updateTableView('v1', { sorts: [] }, { expectRevision: 10 }) })
    expect(res).toMatchObject({ status: 'changed', row: { revision: 55 } })
    expect(current().api.viewsOf('tasks')[0]).toMatchObject({ revision: 55, config: { version: 1, theirs: true } })
    expect(current().toasts.current).toEqual([])
  })

  it('a save of a view a teammate deleted: deleted — the row leaves', async () => {
    const backend = fakeBackend({ views: [view('v1')] })
    const { current } = setup({ backend })
    backend.db.views = []
    let res
    await act(async () => { res = await current().api.updateTableView('v1', { sorts: [] }) })
    expect(res.status).toBe('deleted')
    expect(current().api.viewsOf('tasks')).toEqual([])
  })

  it('a rename is never conditional and never a new revision; its undo is conditional on the name it set', async () => {
    const backend = fakeBackend({ views: [view('v1', { name: 'Old' })] })
    const { current } = setup({ backend })
    let res
    await act(async () => { res = await current().api.renameTableView('v1', 'New ') })
    expect(res.row).toMatchObject({ name: 'New', revision: 10 })
    expect(backend.calls.at(-1)).toEqual(['updateTableView', 'v1', { name: 'New' }, { projectId: P1 }])
    expect(current().toasts.current.at(-1).message).toBe('Renamed to New')
    backend.db.views[0].name = 'Theirs'
    await act(async () => { await current().toasts.current.at(-1).onUndo() })
    expect(backend.calls.at(-1)).toEqual(['updateTableView', 'v1', { name: 'Old' }, { projectId: P1, expectName: 'New' }])
    expect(backend.db.views[0].name).toBe('Theirs')
    expect(current().notices.current.at(-1)).toMatch(/changed meanwhile/)
  })

  it('a name the rules refuse is refused before any request', async () => {
    const backend = fakeBackend({ views: [view('v1')] })
    const { current } = setup({ backend })
    await expect(current().api.renameTableView('v1', '   ')).rejects.toMatchObject({ code: 'table_view_invalid' })
    await expect(current().api.addTableView({ tableKey: 'budget', name: 'x' })).rejects.toMatchObject({ code: 'table_view_invalid' })
    expect(backend.calls).toEqual([])
  })

  it('a delete\'s undo makes the view again with its id, name, place and settings (a new revision)', async () => {
    const backend = fakeBackend({ views: [view('v1', { name: 'Shoot week', position: 3, config: { version: 1, sorts: [] } })] })
    const { current } = setup({ backend })
    await act(async () => { await current().api.deleteTableView('v1') })
    expect(current().api.viewsOf('tasks')).toEqual([])
    expect(current().toasts.current.at(-1).message).toBe('Shoot week deleted')
    await act(async () => { await current().toasts.current.at(-1).onUndo() })
    expect(backend.calls.at(-1)).toEqual(['addTableView', { id: 'v1', project_id: P1, table_key: 'tasks', name: 'Shoot week', position: 3, config: { version: 1, sorts: [] } }])
    expect(current().api.viewsOf('tasks')[0]).toMatchObject({ id: 'v1', revision: 101 })
  })

  it('a reorder is on screen at once and put back when refused; its undo restores the old order', async () => {
    const backend = fakeBackend({ views: [view('v1', { position: 0 }), view('v2', { position: 1 }), view('v3', { position: 2 })] })
    const { current } = setup({ backend })
    await act(async () => { await current().api.reorderTableViews('tasks', ['v3']) })
    expect(current().api.viewsOf('tasks').map(v => v.id)).toEqual(['v3', 'v1', 'v2'])
    expect(current().toasts.current.at(-1).message).toBe('Views reordered')
    await act(async () => { await current().toasts.current.at(-1).onUndo() })
    expect(backend.calls.at(-1)).toEqual(['reorderTableViews', P1, 'tasks', ['v3', 'v1', 'v2']].slice(0, 3).concat([['v1', 'v2', 'v3']]))
    expect(current().api.viewsOf('tasks').map(v => v.id)).toEqual(['v1', 'v2', 'v3'])
    // Refused: put back.
    backend.reorderTableViews.mockRejectedValueOnce(Object.assign(new Error('You can no longer change views on this project.'), { code: '42501' }))
    await act(async () => { await expect(current().api.reorderTableViews('tasks', ['v2'])).rejects.toMatchObject({ code: '42501' }) })
    expect(current().api.viewsOf('tasks').map(v => v.id)).toEqual(['v1', 'v2', 'v3'])
  })

  it('a write that finishes after a project switch lands on neither project, and its undo does nothing', async () => {
    const backend = fakeBackend({ views: [view('v1')] })
    let release
    backend.updateTableView.mockImplementationOnce((id, patch) => new Promise((resolve) => {
      release = () => resolve({ status: 'saved', row: { ...view('v1'), ...patch, revision: 77 } })
    }))
    const { current, hook } = setup({ backend })
    let pending
    act(() => { pending = current().api.updateTableView('v1', { sorts: [] }) })
    hook.rerender({ adapter: backend, bundle: current().bundle, activeProjectId: 'p2' })
    await act(async () => { release(); await pending })
    expect(current().bundle.tableViews[0].revision).toBe(10)
    expect(current().toasts.current).toEqual([])
  })
})

describe('groupings (Q-D2, Q-D5)', () => {
  it('a new set is made and offered to undo; a set already stored answers it and writes nothing', async () => {
    const backend = fakeBackend({ groupings: [grouping('g1', ['A1', 'A2'])] })
    const { current } = setup({ backend })
    let got
    await act(async () => { got = await current().api.addItemGrouping({ tableKey: 'tasks', kind: 'asset', entityIds: ['A2', 'A1'] }) })
    expect(got.id).toBe('g1')
    expect(backend.calls).toEqual([])
    await act(async () => { got = await current().api.addItemGrouping({ tableKey: 'tasks', kind: 'asset', entityIds: ['A3', 'A1', 'A3'] }) })
    expect(backend.calls.at(-1)[1]).toMatchObject({ project_id: P1, table_key: 'tasks', kind: 'asset', entity_ids: ['A1', 'A3'] })
    expect(current().api.groupingsOf('tasks', 'asset').map(g => g.id)).toEqual(['g1', got.id])
    expect(current().toasts.current.at(-1).message).toBe('Grouping created')
    await act(async () => { await current().toasts.current.at(-1).onUndo() })
    expect(current().api.groupingsOf('tasks', 'asset').map(g => g.id)).toEqual(['g1'])
  })

  it('a pair or a set the rules refuse is refused before any request', async () => {
    const backend = fakeBackend()
    const { current } = setup({ backend })
    await expect(current().api.addItemGrouping({ tableKey: 'assets', kind: 'asset', entityIds: ['A1'] })).rejects.toMatchObject({ code: 'item_grouping_invalid' })
    await expect(current().api.addItemGrouping({ tableKey: 'tasks', kind: 'asset', entityIds: [] })).rejects.toMatchObject({ code: 'item_grouping_invalid' })
    expect(backend.calls).toEqual([])
  })

  it('a removal\'s undo makes it again; one whose item is gone says why instead of retrying', async () => {
    const backend = fakeBackend({ groupings: [grouping('g1', ['A1']), grouping('g2', ['gone'])] })
    const { current } = setup({ backend })
    await act(async () => { await current().api.removeItemGrouping('g1') })
    await act(async () => { await current().toasts.current.at(-1).onUndo() })
    // Made again, it takes a new created_at and sorts last (the loads' order).
    expect(current().api.groupingsOf('tasks', 'asset').map(g => g.id)).toEqual(['g2', 'g1'])
    await act(async () => { await current().api.removeItemGrouping('g2') })
    await act(async () => { await current().toasts.current.at(-1).onUndo() }) // resolves: the toast closes
    expect(current().notices.current.at(-1)).toMatch(/no longer in the project/)
    expect(current().api.groupingsOf('tasks', 'asset').map(g => g.id)).toEqual(['g1'])
  })
})

describe('the last used view (Q4, design §4.5)', () => {
  it('reads once, then writes merge one key, in order, answered by the backend\'s map', async () => {
    const backend = fakeBackend({ last: { available: true, map: { 'p1:assets': { view: 'all', at: 1 } } } })
    const { current } = setup({ backend })
    await waitFor(() => expect(current().api.tableViewLast.status).toBe('ready'))
    expect(current().api.lastViewOf('assets')).toBe('all')
    expect(current().api.lastViewOf('tasks')).toBe(null)
    await act(async () => {
      current().api.setTableViewLast('tasks', 'v1')
      await current().api.setTableViewLast('tasks', 'v2')
    })
    expect(backend.calls.filter(c => c[0] === 'setTableViewLast').map(c => c[2])).toEqual(['v1', 'v2'])
    expect(current().api.lastViewOf('tasks')).toBe('v2')
    expect(current().api.lastViewOf('assets')).toBe('all')
  })

  it('a backend without the map is unavailable: nothing is written', async () => {
    const backend = fakeBackend({ last: { available: false, map: {} } })
    const { current } = setup({ backend })
    await waitFor(() => expect(current().api.tableViewLast.status).toBe('unavailable'))
    await act(async () => { await current().api.setTableViewLast('tasks', 'v1') })
    expect(backend.calls.filter(c => c[0] === 'setTableViewLast')).toEqual([])
  })

  it('a read that takes longer than 2 s fails for the visit: the table opens on All and nothing is written, even when it answers late', async () => {
    vi.useFakeTimers()
    const backend = fakeBackend({ last: { available: true, map: { 'p1:tasks': { view: 'v9', at: 1 } } } })
    let answer
    backend.getTableViewLast.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve }))
    const { current } = setup({ backend })
    expect(current().api.tableViewLast.status).toBe('loading')
    await act(async () => { vi.advanceTimersByTime(TABLE_VIEW_LAST_WAIT_MS + 1) })
    expect(current().api.tableViewLast.status).toBe('failed')
    await act(async () => { answer({ available: true, map: { 'p1:tasks': { view: 'v9', at: 1 } } }) })
    expect(current().api.tableViewLast.status).toBe('failed')
    expect(current().api.lastViewOf('tasks')).toBe(null)
    await act(async () => { await current().api.setTableViewLast('tasks', 'v1') })
    expect(backend.calls.filter(c => c[0] === 'setTableViewLast')).toEqual([])
  })

  it('is read again for another person', async () => {
    const backend = fakeBackend()
    const { current, hook } = setup({ backend })
    await waitFor(() => expect(current().api.tableViewLast.status).toBe('ready'))
    hook.rerender({ adapter: backend, bundle: current().bundle, activeProjectId: P1, authUserId: 'u2' })
    await waitFor(() => expect(backend.getTableViewLast).toHaveBeenCalledTimes(2))
  })
})

describe('the changes for now (Q3b)', () => {
  it('are kept per table, cleared on request, and dropped on a project switch', async () => {
    const { current, hook, adapter } = setup()
    act(() => { current().api.setViewDraft('tasks', { viewId: 'v1', baseRevision: 10, config: { sorts: [] }, extra: 'dropped' }) })
    expect(current().api.viewDraftOf('tasks')).toEqual({ viewId: 'v1', baseRevision: 10, config: { sorts: [] } })
    expect(current().api.viewDraftOf('assets')).toBe(null)
    act(() => { current().api.setViewDraft('assets', { viewId: 'all', baseRevision: 0, config: {} }) })
    act(() => { current().api.clearViewDraft('assets') })
    expect(current().api.viewDraftOf('assets')).toBe(null)
    hook.rerender({ adapter, bundle: current().bundle, activeProjectId: 'p2' })
    expect(current().api.viewDraftOf('tasks')).toBe(null)
  })
})

describe('the sweep\'s helpers for the provider\'s deletes (design §5.2)', () => {
  const groupings = [grouping('g1', ['A1', 'A2']), grouping('g2', ['A1']), grouping('g3', ['A2', 'A3']), grouping('s1', ['S1'], { kind: 'scene' })]

  it('names the groupings a delete touches, copied', () => {
    const touched = groupingsNaming(groupings, 'asset', ['A2'])
    expect(touched.map(g => g.id)).toEqual(['g1', 'g3'])
    touched[0].entity_ids.push('X')
    expect(groupings[0].entity_ids).toEqual(['A1', 'A2'])
  })

  it('mirrors the backend\'s sweep, item by item', () => {
    expect(sweepGroupings(groupings, 'asset', ['A2', 'A3']).map(g => [g.id, g.entity_ids.join(',')])).toEqual([
      ['g2', 'A1'], ['s1', 'S1'],
    ])
  })

  it('the undo puts each grouping back as it was: made again where it went, removed and made again where it shrank', async () => {
    const adapter = fakeBackend({ groupings: [grouping('g2', ['A1'])] })
    const bundleRef = { current: { itemGroupings: [grouping('g2', ['A1'])] } }
    const setBundle = (f) => { bundleRef.current = f(bundleRef.current) }
    // After the delete of A2: g1 {A1, A2} went (a repeat of g2), g3 {A2, A3} shrank to {A3}.
    adapter.db.groupings.push(grouping('g3', ['A3']))
    bundleRef.current.itemGroupings.push(grouping('g3', ['A3']))
    await restoreGroupingRows({ adapter, projectId: P1, originals: [grouping('g1', ['A1', 'A2']), grouping('g3', ['A2', 'A3'])], bundleRef, setBundle })
    expect(adapter.calls.map(c => c[0])).toEqual(['addItemGrouping', 'removeItemGrouping', 'addItemGrouping'])
    expect(bundleRef.current.itemGroupings.map(g => [g.id, g.entity_ids.join(',')]).sort()).toEqual([
      ['g1', 'A1,A2'], ['g2', 'A1'], ['g3', 'A2,A3'],
    ])
    // CONTROL: a grouping already as it was is left alone.
    adapter.calls.length = 0
    await restoreGroupingRows({ adapter, projectId: P1, originals: [grouping('g2', ['A1'])], bundleRef, setBundle })
    expect(adapter.calls).toEqual([])
  })
})
