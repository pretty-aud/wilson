// =============================================================================
// localServerTableViews.test.js — VW1c (0098's twin): the Local Server
// adapter's views, groupings and last-used verbs, driven against a stubbed
// fetch. Each must hit the route electron/rabbitTableViews.cjs registers, with
// the verb and the body that route reads (the routes' own test,
// rabbitTableViews.routes.test.js, never sees the adapter), and turn the
// route's answers into the contract's (adapters/index.js): a view's
// conditional write answers a TableViewWrite — saved / removed, or, when
// nothing was written, deleted (404) / changed (409 table_view_stale, with the
// stored row); never `filtered` (the desktop has no roles). Every other
// refusal throws an Error carrying the route's status, code and words.
// =============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest'
import { localServerAdapter } from './localServerAdapter'

afterEach(() => { vi.unstubAllGlobals() })

const UUID = '6f1c2a9e-1b2c-4d3e-8f90-0a1b2c3d4e5f'

/** Each call takes the next answer (the last one repeats); answers `{ status, body }`. */
function spyFetch(...answers) {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    calls.push({
      url: String(url),
      method: init?.method || 'GET',
      body: init?.body === undefined ? undefined : JSON.parse(init.body),
    })
    const a = answers.length > 1 ? answers.shift() : answers[0]
    const status = a?.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => 'application/json' },
      json: async () => a?.body,
    }
  }))
  return calls
}
const ok = (body) => ({ status: 200, body })

const view = (id, table, position, created_at = '2026-10-17T10:00:00.000Z', extra = {}) =>
  ({ id, project_id: 'p1', table_key: table, name: id, position, revision: 1, revised_by: null, config: {}, created_at, ...extra })
const grouping = (id, table, kind, created_at) => ({ id, project_id: 'p1', table_key: table, kind, entity_ids: ['a'], created_at })

describe('loadProject carries the views and groupings, in the loads\' order', () => {
  it('views by table, then position, created_at (to the microsecond), id; groupings by table, kind, created_at, id — copies', async () => {
    const tableViews = [
      view('t-2', 'tasks', 1), view('a-1', 'assets', 5), view('t-1', 'tasks', 0),
      view('t-m1', 'tasks', 1, '2026-10-17T09:00:00.123789+00:00'), view('t-m2', 'tasks', 1, '2026-10-17T09:00:00.123456+00:00'),
    ]
    const itemGroupings = [
      grouping('g3', 'tasks', 'scene', '2026-10-17T01:00:00Z'), grouping('g2', 'tasks', 'asset', '2026-10-17T03:00:00Z'),
      grouping('g1', 'tasks', 'asset', '2026-10-17T02:00:00Z'), grouping('g0', 'levels', 'asset', '2026-10-17T09:00:00Z'),
    ]
    const payload = { project: { id: 'p1' }, tableViews, itemGroupings, tableViewRevision: 9 }
    spyFetch(ok(payload))
    const b = await localServerAdapter().loadProject('p1')
    expect(b.tableViews.map(v => v.id)).toEqual(['a-1', 't-1', 't-m2', 't-m1', 't-2'])
    expect(b.itemGroupings.map(g => g.id)).toEqual(['g0', 'g1', 'g2', 'g3'])
    // The server's arrays keep their order (the caller owns the bundle), and
    // the counter stays the server's.
    expect(payload.tableViews.map(v => v.id)).toEqual(['t-2', 'a-1', 't-1', 't-m1', 't-m2'])
    expect(b).not.toHaveProperty('tableViewRevision')
  })
  it('a bundle from before views answers [] for both', async () => {
    spyFetch(ok({ project: { id: 'p1' } }))
    const b = await localServerAdapter().loadProject('p1')
    expect(b.tableViews).toEqual([])
    expect(b.itemGroupings).toEqual([])
  })
})

describe('the views\' verbs', () => {
  it('tableViewsAvailable() is true and tableViewsLoadError() is null: the desktop always keeps views', () => {
    const a = localServerAdapter()
    expect(a.tableViewsAvailable()).toBe(true)
    expect(a.tableViewsLoadError()).toBeNull()
  })

  it('listTableViews GETs …/projects/:id/table-views and answers them in the loads\' order', async () => {
    const calls = spyFetch(ok([view('t', 'tasks', 0), view('a', 'assets', 0)]))
    expect((await localServerAdapter().listTableViews('p1')).map(v => v.id)).toEqual(['a', 't'])
    expect(calls).toEqual([{ url: '/api/rabbit/projects/p1/table-views', method: 'GET', body: undefined }])
  })

  it('addTableView POSTs only the five columns a client writes, and answers the stored row', async () => {
    const row = view(UUID, 'tasks', 3, undefined, { revision: 4 })
    const calls = spyFetch(ok(row))
    const sent = { id: UUID, project_id: 'p1', table_key: 'tasks', name: 'Mine', position: 3, config: { version: 1 }, revision: 99, created_by: 'me' }
    expect(await localServerAdapter().addTableView(sent)).toEqual(row)
    expect(calls).toEqual([{
      url: '/api/rabbit/projects/p1/table-views', method: 'POST',
      body: { id: UUID, table_key: 'tasks', name: 'Mine', position: 3, config: { version: 1 } },
    }])
  })
  it('addTableView leaves out what it was not given (the route\'s defaults), and refuses a row with no project without a request', async () => {
    const calls = spyFetch(ok({}))
    await localServerAdapter().addTableView({ project_id: 'p1', table_key: 'assets', name: 'x' })
    expect(calls[0].body).toEqual({ table_key: 'assets', name: 'x' })
    await expect(localServerAdapter().addTableView({ table_key: 'assets', name: 'x' })).rejects.toThrow(/project/)
    expect(calls).toHaveLength(1)
  })
  it('addTableView: a refusal (the cap, an id taken) arrives as an Error with the route\'s status, code and words', async () => {
    spyFetch({ status: 422, body: { error: 'A project\'s Tasks table holds at most 200 saved views.', code: 'table_view_cap' } })
    const err = await localServerAdapter().addTableView({ project_id: 'p1', table_key: 'tasks', name: 'x' }).catch(e => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).toMatchObject({ status: 422, code: 'table_view_cap', message: '[localServer] A project\'s Tasks table holds at most 200 saved views.' })
  })

  it('updateTableView PATCHes the patch\'s name / position / config and the expectations it is given', async () => {
    const row = view('v1', 'tasks', 0, undefined, { revision: 6 })
    let calls = spyFetch(ok(row))
    const a = localServerAdapter()
    expect(await a.updateTableView('v1', { config: { version: 1 }, revision: 5, table_key: 'assets' }, { projectId: 'p1', expectRevision: 5 }))
      .toEqual({ status: 'saved', row })
    expect(calls).toEqual([{ url: '/api/rabbit/projects/p1/table-views/v1', method: 'PATCH', body: { config: { version: 1 }, expectRevision: 5 } }])
    calls = spyFetch(ok(row))
    await a.updateTableView('v1', { name: 'Back' }, { projectId: 'p1', expectName: 'Renamed' })
    expect(calls[0].body).toEqual({ name: 'Back', expectName: 'Renamed' })
    calls = spyFetch(ok(row))
    await a.updateTableView('v1', { name: 'New', position: 2 }, { projectId: 'p1' })
    expect(calls[0].body).toEqual({ name: 'New', position: 2 })
  })
  it('updateTableView: 404 answers deleted; 409 table_view_stale answers changed WITH the stored row — nothing thrown', async () => {
    const storedRow = view('v1', 'tasks', 0, undefined, { revision: 9, name: 'Theirs' })
    spyFetch({ status: 404, body: { error: 'That view is no longer in this project.', code: 'table_view_not_found' } })
    expect(await localServerAdapter().updateTableView('v1', { name: 'x' }, { projectId: 'p1' })).toEqual({ status: 'deleted' })
    spyFetch({ status: 404, body: { error: 'project not found' } })
    expect(await localServerAdapter().updateTableView('v1', { name: 'x' }, { projectId: 'p1' })).toEqual({ status: 'deleted' })
    spyFetch({ status: 409, body: { error: 'That view has changed since it was read, so nothing was written.', code: 'table_view_stale', row: storedRow } })
    expect(await localServerAdapter().updateTableView('v1', { config: {} }, { projectId: 'p1', expectRevision: 8 }))
      .toEqual({ status: 'changed', row: storedRow })
  })
  it('FAILING CONTROL: any other refusal — a 409 of another code, a 400 — throws with its status, code and words', async () => {
    spyFetch({ status: 409, body: { error: 'something else', code: 'conflict' } })
    const conflict = await localServerAdapter().updateTableView('v1', { name: 'x' }, { projectId: 'p1' }).catch(e => e)
    expect(conflict).toBeInstanceOf(Error)
    expect(conflict).toMatchObject({ status: 409, code: 'conflict', message: '[localServer] something else' })
    spyFetch({ status: 400, body: { error: 'A view needs a name.', code: 'table_view_invalid' } })
    const invalid = await localServerAdapter().updateTableView('v1', { name: '' }, { projectId: 'p1' }).catch(e => e)
    expect(invalid).toMatchObject({ status: 400, code: 'table_view_invalid', message: '[localServer] A view needs a name.' })
    spyFetch({ status: 503, body: { error: 'the demo folder is not available: X:\\demo' } })
    const offline = await localServerAdapter().updateTableView('v1', { name: 'x' }, { projectId: 'p1' }).catch(e => e)
    expect(offline).toMatchObject({ status: 503 })
  })
  it('updateTableView and deleteTableView refuse without a project id, before any request', async () => {
    const calls = spyFetch(ok({}))
    await expect(localServerAdapter().updateTableView('v1', { name: 'x' }, {})).rejects.toThrow(/project/)
    await expect(localServerAdapter().updateTableView('v1', { name: 'x' })).rejects.toThrow(/project/)
    await expect(localServerAdapter().deleteTableView('v1', {})).rejects.toThrow(/project/)
    expect(calls).toEqual([])
  })

  it('deleteTableView DELETEs, the revision it expects in the query string; removed / deleted / changed', async () => {
    let calls = spyFetch(ok({ ok: true, removed: true }))
    const a = localServerAdapter()
    expect(await a.deleteTableView('v1', { projectId: 'p1', expectRevision: 7 })).toEqual({ status: 'removed' })
    expect(calls).toEqual([{ url: '/api/rabbit/projects/p1/table-views/v1?expectRevision=7', method: 'DELETE', body: undefined }])
    calls = spyFetch(ok({ ok: true, removed: true }))
    await a.deleteTableView('v1', { projectId: 'p1' })
    expect(calls[0].url).toBe('/api/rabbit/projects/p1/table-views/v1')
    spyFetch({ status: 404, body: { code: 'table_view_not_found', error: 'gone' } })
    expect(await a.deleteTableView('v1', { projectId: 'p1' })).toEqual({ status: 'deleted' })
    const row = view('v1', 'tasks', 0, undefined, { revision: 8 })
    spyFetch({ status: 409, body: { code: 'table_view_stale', error: 'changed', row } })
    expect(await a.deleteTableView('v1', { projectId: 'p1', expectRevision: 7 })).toEqual({ status: 'changed', row })
  })

  it('reorderTableViews POSTs { table_key, ids } to …/table-views/reorder and answers the moved rows; a refusal throws its code', async () => {
    const moved = [view('b', 'tasks', 0), view('a', 'tasks', 1)]
    const calls = spyFetch(ok(moved))
    expect(await localServerAdapter().reorderTableViews('p1', 'tasks', ['b', 'a'])).toEqual(moved)
    expect(calls).toEqual([{ url: '/api/rabbit/projects/p1/table-views/reorder', method: 'POST', body: { table_key: 'tasks', ids: ['b', 'a'] } }])
    spyFetch({ status: 400, body: { error: 'a view is named twice', code: 'table_view_invalid' } })
    const err = await localServerAdapter().reorderTableViews('p1', 'tasks', ['a', 'a']).catch(e => e)
    expect(err).toMatchObject({ status: 400, code: 'table_view_invalid', message: '[localServer] a view is named twice' })
  })

  it('ids are put in the path encoded', async () => {
    const calls = spyFetch(ok({ ok: true, removed: true }))
    await localServerAdapter().deleteTableView('a/b?c', { projectId: 'p 1' })
    expect(calls[0].url).toBe('/api/rabbit/projects/p%201/table-views/a%2Fb%3Fc')
  })
})

describe('the groupings\' verbs', () => {
  it('listItemGroupings GETs …/item-groupings and answers them in the loads\' order', async () => {
    const calls = spyFetch(ok([grouping('g2', 'tasks', 'scene', 'x'), grouping('g1', 'tasks', 'asset', 'x')]))
    expect((await localServerAdapter().listItemGroupings('p1')).map(g => g.id)).toEqual(['g1', 'g2'])
    expect(calls).toEqual([{ url: '/api/rabbit/projects/p1/item-groupings', method: 'GET', body: undefined }])
  })
  it('addItemGrouping POSTs { id, table_key, kind, entity_ids } and answers the row (the stored one for a set already there)', async () => {
    const storedRow = grouping('g1', 'tasks', 'asset', 'x')
    const calls = spyFetch(ok(storedRow))
    const row = { id: UUID, project_id: 'p1', table_key: 'tasks', kind: 'asset', entity_ids: ['a'], created_by: 'me' }
    expect(await localServerAdapter().addItemGrouping(row)).toEqual(storedRow)
    expect(calls).toEqual([{
      url: '/api/rabbit/projects/p1/item-groupings', method: 'POST',
      body: { id: UUID, table_key: 'tasks', kind: 'asset', entity_ids: ['a'] },
    }])
    await expect(localServerAdapter().addItemGrouping({ table_key: 'tasks', kind: 'asset', entity_ids: ['a'] })).rejects.toThrow(/project/)
    expect(calls).toHaveLength(1)
  })
  it('addItemGrouping: an item no longer in the project throws code item_grouping_entity_not_found (the undo\'s branch)', async () => {
    spyFetch({ status: 422, body: { error: 'A grouping can name only this project\'s own assets: 1 of the 1 named are not in it.', code: 'item_grouping_entity_not_found' } })
    const err = await localServerAdapter().addItemGrouping({ project_id: 'p1', table_key: 'tasks', kind: 'asset', entity_ids: ['a'] }).catch(e => e)
    expect(err).toMatchObject({ status: 422, code: 'item_grouping_entity_not_found' })
  })
  it('removeItemGrouping DELETEs …/item-groupings/:id and answers { removed }', async () => {
    let calls = spyFetch(ok({ ok: true, removed: true }))
    expect(await localServerAdapter().removeItemGrouping('g1', 'p1')).toEqual({ removed: true })
    expect(calls).toEqual([{ url: '/api/rabbit/projects/p1/item-groupings/g1', method: 'DELETE', body: undefined }])
    calls = spyFetch(ok({ ok: true, removed: false }))
    expect(await localServerAdapter().removeItemGrouping('g1', 'p1')).toEqual({ removed: false })
    await expect(localServerAdapter().removeItemGrouping('g1')).rejects.toThrow(/project/)
    expect(calls).toHaveLength(1)
  })
})

describe('the last used view: this computer\'s settings', () => {
  it('getTableViewLast GETs /api/rabbit/machine-settings and answers { available: true, map }', async () => {
    const map = { [`${UUID}:tasks`]: { view: 'all', at: 5 } }
    const calls = spyFetch(ok({ tableViewLast: map }))
    expect(await localServerAdapter().getTableViewLast()).toEqual({ available: true, map })
    expect(calls).toEqual([{ url: '/api/rabbit/machine-settings', method: 'GET', body: undefined }])
    spyFetch(ok({ tableViewLast: [1] }))
    expect(await localServerAdapter().getTableViewLast()).toEqual({ available: true, map: {} })
  })
  it('setTableViewLast POSTs { key, view } to …/machine-settings/table-view-last and answers the map; a refusal throws its code', async () => {
    const map = { [`${UUID}:tasks`]: { view: 'v1', at: 9 } }
    const calls = spyFetch(ok({ tableViewLast: map }))
    expect(await localServerAdapter().setTableViewLast(`${UUID}:tasks`, 'v1')).toEqual(map)
    expect(calls).toEqual([{ url: '/api/rabbit/machine-settings/table-view-last', method: 'POST', body: { key: `${UUID}:tasks`, view: 'v1' } }])
    spyFetch({ status: 400, body: { error: 'tasks is not a project id and a table', code: 'table_view_last_invalid' } })
    const err = await localServerAdapter().setTableViewLast('tasks', 'v1').catch(e => e)
    expect(err).toMatchObject({ status: 400, code: 'table_view_last_invalid' })
  })
})
