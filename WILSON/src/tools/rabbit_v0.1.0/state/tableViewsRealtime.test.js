// =============================================================================
// tableViewsRealtime.test.js — VW1c (0098): table_views and item_groupings
// joined the broadcast's project_id arm (her Q3d: a teammate's save reaches an
// open table at once), and the merge takes their events into `tableViews` and
// `itemGroupings`:
//   · a row lands where a load puts it (views by table, position, created_at,
//     id; groupings by table, kind, created_at, id);
//   · a teammate's save (an UPDATE with a newer revision) replaces the view's
//     row, so the provider can tell a change for now that it was changed
//     meanwhile; a stale event is ignored;
//   · a grouping is unique by (table, kind, set): this window's own copy under
//     another id gives way to the stored one;
//   · a DELETE removes the row (a teammate's delete; the sweep's).
// =============================================================================

import { describe, it, expect } from 'vitest'
import { applyRealtimeEvent, normalizeBroadcastPayload, TABLE_TO_COLLECTION } from './realtimeMerge'

const view = (id, tableKey, position, extra = {}) => ({
  id, project_id: 'p1', workspace_id: 'w1', table_key: tableKey, name: `View ${id}`, position,
  revision: 1, revised_by: null, config: { version: 1 },
  created_at: '2026-10-17T10:00:00.000001+00:00', updated_at: '2026-10-17T10:00:00.000001+00:00', ...extra,
})
const grouping = (id, tableKey, kind, ids, extra = {}) => ({
  id, project_id: 'p1', workspace_id: 'w1', table_key: tableKey, kind, entity_ids: ids,
  created_at: '2026-10-17T10:00:00.000001+00:00', updated_at: '2026-10-17T10:00:00.000001+00:00', ...extra,
})
const evt = (table, op, record, oldRecord = null) => normalizeBroadcastPayload({ table, operation: op, record, old_record: oldRecord })
const base = () => ({
  project: { id: 'p1' },
  tableViews: [view('v1', 'tasks', 0), view('v2', 'tasks', 1), view('a1', 'assets', 0)],
  itemGroupings: [grouping('g1', 'tasks', 'asset', ['A1', 'A2'])],
})

describe('table_views and item_groupings on the project channel', () => {
  it('map to their collections', () => {
    expect(TABLE_TO_COLLECTION.table_views).toBe('tableViews')
    expect(TABLE_TO_COLLECTION.item_groupings).toBe('itemGroupings')
  })

  it('a new view lands in the dropdown\'s order, among its own table\'s', () => {
    const { bundle } = applyRealtimeEvent(base(), evt('table_views', 'INSERT', view('v3', 'tasks', 0, { created_at: '2026-10-17T10:00:00.000002+00:00' })))
    expect(bundle.tableViews.map(v => v.id)).toEqual(['a1', 'v1', 'v3', 'v2'])
  })

  it('a teammate\'s save replaces the row (its revision with it); an older event changes nothing', () => {
    const saved = view('v1', 'tasks', 0, { revision: 7, revised_by: 'u2', config: { version: 1, sorts: [{ field: 'title', dir: 'asc' }] }, updated_at: '2026-10-17T11:00:00+00:00' })
    const after = applyRealtimeEvent(base(), evt('table_views', 'UPDATE', saved, view('v1', 'tasks', 0))).bundle
    expect(after.tableViews.find(v => v.id === 'v1')).toMatchObject({ revision: 7, revised_by: 'u2', config: saved.config })
    const stale = view('v1', 'tasks', 0, { revision: 3, updated_at: '2026-10-17T10:30:00+00:00' })
    const again = applyRealtimeEvent(after, evt('table_views', 'UPDATE', stale, view('v1', 'tasks', 0)))
    expect(again.bundle.tableViews.find(v => v.id === 'v1').revision).toBe(7)
  })

  it('a reorder elsewhere moves the rows into their new order', () => {
    const b1 = applyRealtimeEvent(base(), evt('table_views', 'UPDATE', view('v2', 'tasks', 0, { updated_at: '2026-10-17T11:00:00+00:00' }))).bundle
    const b2 = applyRealtimeEvent(b1, evt('table_views', 'UPDATE', view('v1', 'tasks', 1, { updated_at: '2026-10-17T11:00:00+00:00' }))).bundle
    expect(b2.tableViews.filter(v => v.table_key === 'tasks').map(v => v.id)).toEqual(['v2', 'v1'])
  })

  it('a deleted view leaves', () => {
    const { bundle } = applyRealtimeEvent(base(), evt('table_views', 'DELETE', null, view('v2', 'tasks', 1)))
    expect(bundle.tableViews.map(v => v.id)).toEqual(['v1', 'a1'])
  })

  it('a grouping is unique by (table, kind, set): this window\'s own copy under another id gives way', () => {
    const b = base()
    b.itemGroupings.push(grouping('mine', 'tasks', 'asset', ['B2', 'B1']))
    const { bundle } = applyRealtimeEvent(b, evt('item_groupings', 'INSERT', grouping('theirs', 'tasks', 'asset', ['B1', 'B2'])))
    expect(bundle.itemGroupings.map(g => g.id).sort()).toEqual(['g1', 'theirs'])
  })

  it('CONTROL: the same set for another table or kind is its own grouping', () => {
    const b = base()
    const one = applyRealtimeEvent(b, evt('item_groupings', 'INSERT', grouping('g2', 'tasks', 'scene', ['A1', 'A2']))).bundle
    const two = applyRealtimeEvent(one, evt('item_groupings', 'INSERT', grouping('g3', 'levels', 'asset', ['A1', 'A2']))).bundle
    expect(two.itemGroupings.map(g => g.id).sort()).toEqual(['g1', 'g2', 'g3'])
  })

  it('the sweep elsewhere: a shrunk grouping is replaced, a removed one leaves', () => {
    const shrunk = applyRealtimeEvent(base(), evt('item_groupings', 'UPDATE',
      grouping('g1', 'tasks', 'asset', ['A1'], { updated_at: '2026-10-17T12:00:00+00:00' }), grouping('g1', 'tasks', 'asset', ['A1', 'A2']))).bundle
    expect(shrunk.itemGroupings[0].entity_ids).toEqual(['A1'])
    const gone = applyRealtimeEvent(shrunk, evt('item_groupings', 'DELETE', null, grouping('g1', 'tasks', 'asset', ['A1']))).bundle
    expect(gone.itemGroupings).toEqual([])
  })
})
