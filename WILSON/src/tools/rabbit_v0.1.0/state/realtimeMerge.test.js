// =============================================================================
// realtimeMerge.test.js — the pure realtime event-application layer
// (Session 7). Bundle in, event in, bundle + effects out; no React.
// =============================================================================

import { describe, it, expect } from 'vitest'
import {
  applyRealtimeEvent,
  normalizeBroadcastPayload,
  mergeRow,
  isStaleIncoming,
  TABLE_TO_COLLECTION,
  stampKindFromTable,
} from './realtimeMerge'

const T0 = '2026-07-28T10:00:00.000Z'
const T1 = '2026-07-28T10:00:01.000Z'
const T2 = '2026-07-28T10:00:02.000Z'

function makeBundle(over = {}) {
  return {
    project: { id: 'p1', title: 'Project', updated_at: T0 },
    phases: [],
    assets: [
      { id: 'a1', project_id: 'p1', name: 'Asset 1', status: 'not_started', sort_order: 0, updated_at: T0 },
      { id: 'a2', project_id: 'p1', name: 'Asset 2', status: 'not_started', sort_order: 1, updated_at: T0 },
    ],
    tasks: [
      { id: 't1', asset_id: 'a1', project_id: 'p1', title: 'Task 1', updated_at: T0 },
      { id: 't2', asset_id: 'a2', project_id: 'p1', title: 'Task 2', updated_at: T0 },
    ],
    dependencies: [
      { id: 'd1', predecessor_id: 't1', successor_id: 't2', type: 'FS' },
    ],
    taskLinks: [{ id: 'l1', task_id: 't1', url: 'https://x.test' }],
    files: [{ id: 'f1', project_id: 'p1', name: 'ref.png' }],
    comments: [],
    assetVersions: [],
    ...over,
  }
}

const noPending = () => null

describe('normalizeBroadcastPayload', () => {
  it('maps the broadcast_changes payload shape', () => {
    const evt = normalizeBroadcastPayload({
      operation: 'UPDATE', table: 'assets', schema: 'public',
      record: { id: 'a1' }, old_record: { id: 'a1', name: 'old' },
    })
    expect(evt).toEqual({
      table: 'assets', op: 'UPDATE',
      record: { id: 'a1' }, oldRecord: { id: 'a1', name: 'old' },
    })
  })
  it('returns null for malformed payloads', () => {
    expect(normalizeBroadcastPayload(null)).toBeNull()
    expect(normalizeBroadcastPayload({})).toBeNull()
    expect(normalizeBroadcastPayload({ table: 'assets' })).toBeNull()
  })
})

describe('isStaleIncoming / mergeRow (LWW per field)', () => {
  it('drops rows older than the local copy', () => {
    expect(isStaleIncoming({ updated_at: T1 }, { updated_at: T0 })).toBe(true)
    expect(isStaleIncoming({ updated_at: T0 }, { updated_at: T1 })).toBe(false)
    expect(isStaleIncoming({ updated_at: T0 }, { updated_at: T0 })).toBe(false)
  })
  it('never trips without timestamps (files, comments, link tables)', () => {
    expect(isStaleIncoming({ id: 'f1' }, { id: 'f1' })).toBe(false)
    expect(isStaleIncoming({ updated_at: 'garbage' }, { updated_at: T1 })).toBe(false)
  })
  it('takes every incoming field when nothing is pending', () => {
    const current = { id: 'a1', name: 'local', status: 'blocked', updated_at: T0 }
    const incoming = { id: 'a1', name: 'remote', status: 'done', updated_at: T1 }
    expect(mergeRow(current, incoming, null)).toEqual(incoming)
  })
  it('keeps ONLY pending fields local — the per-field LWW contract', () => {
    const current = { id: 'a1', name: 'typing…', status: 'blocked', updated_at: T0 }
    const incoming = { id: 'a1', name: 'remote', status: 'done', updated_at: T1 }
    const merged = mergeRow(current, incoming, new Set(['name']))
    expect(merged.name).toBe('typing…')   // my in-flight write wins locally
    expect(merged.status).toBe('done')    // their field lands
    expect(merged.updated_at).toBe(T1)
  })
  it('returns the current reference for stale incoming rows', () => {
    const current = { id: 'a1', name: 'newer', updated_at: T2 }
    expect(mergeRow(current, { id: 'a1', name: 'older', updated_at: T1 }, null)).toBe(current)
  })
})

describe('applyRealtimeEvent — INSERT', () => {
  it('adds a new row and keeps sort_order ordering for assets', () => {
    const bundle = makeBundle()
    const { bundle: next, effects } = applyRealtimeEvent(bundle, {
      table: 'assets', op: 'INSERT',
      record: { id: 'a0', project_id: 'p1', name: 'First', sort_order: -1, updated_at: T1 },
    }, { pendingFields: noPending })
    expect(effects).toEqual([])
    expect(next.assets.map(a => a.id)).toEqual(['a0', 'a1', 'a2'])
  })
  it('dedupes an echo of a row this client already added', () => {
    const bundle = makeBundle()
    const { bundle: next } = applyRealtimeEvent(bundle, {
      table: 'assets', op: 'INSERT',
      record: { ...bundle.assets[0], updated_at: T1 },
    }, { pendingFields: noPending })
    expect(next.assets).toHaveLength(2)
  })
  it('ignores inserts of already-trashed rows', () => {
    const bundle = makeBundle()
    const { bundle: next } = applyRealtimeEvent(bundle, {
      table: 'assets', op: 'INSERT',
      record: { id: 'a9', deleted_at: T1 },
    }, { pendingFields: noPending })
    expect(next).toBe(bundle)
  })
})

describe('applyRealtimeEvent — UPDATE (plain)', () => {
  it('merges an incoming edit into the row', () => {
    const bundle = makeBundle()
    const { bundle: next } = applyRealtimeEvent(bundle, {
      table: 'tasks', op: 'UPDATE',
      record: { id: 't1', asset_id: 'a1', project_id: 'p1', title: 'Renamed', updated_at: T1 },
      oldRecord: { id: 't1', title: 'Task 1', updated_at: T0 },
    }, { pendingFields: noPending })
    expect(next.tasks.find(t => t.id === 't1').title).toBe('Renamed')
  })
  it('preserves in-flight local fields (pending) while taking the rest', () => {
    const bundle = makeBundle()
    const pending = (table, id) => (table === 'tasks' && id === 't1' ? new Set(['title']) : null)
    const { bundle: next } = applyRealtimeEvent(bundle, {
      table: 'tasks', op: 'UPDATE',
      record: { id: 't1', title: 'Their title', status: 'in_progress', updated_at: T1 },
      oldRecord: { id: 't1', title: 'Task 1', updated_at: T0 },
    }, { pendingFields: pending })
    const t1 = next.tasks.find(t => t.id === 't1')
    expect(t1.title).toBe('Task 1')            // pending field stays local
    expect(t1.status).toBe('in_progress')      // their field lands
  })
  it('drops out-of-order (stale) updates without touching state', () => {
    const bundle = makeBundle({
      tasks: [{ id: 't1', title: 'Newest', updated_at: T2 }],
    })
    const { bundle: next } = applyRealtimeEvent(bundle, {
      table: 'tasks', op: 'UPDATE',
      record: { id: 't1', title: 'Stale', updated_at: T1 },
      oldRecord: { id: 't1', title: 'Task 1', updated_at: T0 },
    }, { pendingFields: noPending })
    expect(next).toBe(bundle)
  })
  it('upserts an UPDATE for a row this client never saw (insert-or-merge)', () => {
    const bundle = makeBundle()
    const { bundle: next } = applyRealtimeEvent(bundle, {
      table: 'tasks', op: 'UPDATE',
      record: { id: 't9', asset_id: 'a1', title: 'Late joiner', updated_at: T1 },
      oldRecord: { id: 't9', title: 'x', updated_at: T0 },
    }, { pendingFields: noPending })
    expect(next.tasks.some(t => t.id === 't9')).toBe(true)
  })
})

describe('applyRealtimeEvent — soft delete / restore', () => {
  it('remote asset soft-delete removes the asset AND mirrors the local task cascade', () => {
    const bundle = makeBundle()
    const { bundle: next } = applyRealtimeEvent(bundle, {
      table: 'assets', op: 'UPDATE',
      record: { id: 'a1', deleted_at: T1, updated_at: T1 },
      oldRecord: { id: 'a1', deleted_at: null, updated_at: T0 },
    }, { pendingFields: noPending })
    expect(next.assets.map(a => a.id)).toEqual(['a2'])
    expect(next.tasks.map(t => t.id)).toEqual(['t2']) // t1 hidden with its asset
  })
  it('remote task soft-delete also drops its dependency edges', () => {
    const bundle = makeBundle()
    const { bundle: next } = applyRealtimeEvent(bundle, {
      table: 'tasks', op: 'UPDATE',
      record: { id: 't1', deleted_at: T1, updated_at: T1 },
      oldRecord: { id: 't1', deleted_at: null, updated_at: T0 },
    }, { pendingFields: noPending })
    expect(next.tasks.map(t => t.id)).toEqual(['t2'])
    expect(next.dependencies).toEqual([])
  })
  it('remote restore reinstates the row and requests a refetch for hidden children', () => {
    const bundle = makeBundle({ assets: [makeBundle().assets[1]], tasks: [makeBundle().tasks[1]] })
    const { bundle: next, effects } = applyRealtimeEvent(bundle, {
      table: 'assets', op: 'UPDATE',
      record: { id: 'a1', project_id: 'p1', name: 'Asset 1', deleted_at: null, sort_order: 0, updated_at: T2 },
      oldRecord: { id: 'a1', deleted_at: T1, updated_at: T1 },
    }, { pendingFields: noPending })
    expect(next.assets.map(a => a.id)).toEqual(['a1', 'a2'])
    expect(effects).toEqual([{ type: 'refetch' }])
  })
  it('trashed → still trashed (purge stamp churn) is a no-op', () => {
    const bundle = makeBundle()
    const { bundle: next } = applyRealtimeEvent(bundle, {
      table: 'assets', op: 'UPDATE',
      record: { id: 'a1', deleted_at: T2, updated_at: T2 },
      oldRecord: { id: 'a1', deleted_at: T1, updated_at: T1 },
    }, { pendingFields: noPending })
    // a1 is still visible locally only because this client hasn't processed
    // the original trash event in this synthetic sequence — the event must
    // not resurrect or duplicate anything.
    expect(next).toBe(bundle)
  })
})

describe('applyRealtimeEvent — hard DELETE', () => {
  it('removes link-table rows by id (old_record only carries the row)', () => {
    const bundle = makeBundle()
    const { bundle: next } = applyRealtimeEvent(bundle, {
      table: 'task_links', op: 'DELETE',
      record: null,
      oldRecord: { id: 'l1', task_id: 't1' },
    }, { pendingFields: noPending })
    expect(next.taskLinks).toEqual([])
  })
  it('mirrors cascades for hard-deleted tasks too', () => {
    const bundle = makeBundle()
    const { bundle: next } = applyRealtimeEvent(bundle, {
      table: 'tasks', op: 'DELETE',
      record: null,
      oldRecord: { id: 't1' },
    }, { pendingFields: noPending })
    expect(next.tasks.map(t => t.id)).toEqual(['t2'])
    expect(next.dependencies).toEqual([])
  })
})

describe('applyRealtimeEvent — projects & roster', () => {
  it('project rename patches bundle.project and emits an index patch', () => {
    const bundle = makeBundle()
    const record = { id: 'p1', title: 'Renamed', updated_at: T1 }
    const { bundle: next, effects } = applyRealtimeEvent(bundle, {
      table: 'projects', op: 'UPDATE',
      record, oldRecord: { id: 'p1', title: 'Project', updated_at: T0 },
    }, { pendingFields: noPending })
    expect(next.project.title).toBe('Renamed')
    expect(effects).toEqual([{ type: 'project-patch', record }])
  })
  it('project soft-delete emits project-trashed and leaves the bundle to the provider', () => {
    const bundle = makeBundle()
    const { bundle: next, effects } = applyRealtimeEvent(bundle, {
      table: 'projects', op: 'UPDATE',
      record: { id: 'p1', deleted_at: T1 },
      oldRecord: { id: 'p1', deleted_at: null },
    }, { pendingFields: noPending })
    expect(next).toBe(bundle)
    expect(effects).toEqual([{ type: 'project-trashed', id: 'p1' }])
  })
  it('project_members events only signal a roster refresh', () => {
    const bundle = makeBundle()
    const { bundle: next, effects } = applyRealtimeEvent(bundle, {
      table: 'project_members', op: 'INSERT',
      record: { project_id: 'p1', user_id: 'u1', project_role: 'member' },
    }, { pendingFields: noPending })
    expect(next).toBe(bundle)
    expect(effects).toEqual([{ type: 'roster' }])
  })
})

describe('applyRealtimeEvent — robustness', () => {
  it('ignores unknown tables and malformed events', () => {
    const bundle = makeBundle()
    expect(applyRealtimeEvent(bundle, { table: 'ingestion_runs', op: 'INSERT', record: { id: 'x' } }, {}).bundle).toBe(bundle)
    expect(applyRealtimeEvent(bundle, null, {}).bundle).toBe(bundle)
    expect(applyRealtimeEvent(bundle, { table: 'assets' }, {}).bundle).toBe(bundle)
    expect(applyRealtimeEvent(bundle, { table: 'assets', op: 'UPDATE', record: null }, {}).bundle).toBe(bundle)
  })
  it('covers every broadcast table with a collection or special-case', () => {
    // 0016 broadcast 10 tables; 0061 added phase_dependencies as an 11th.
    // projects + project_members are handled specially, the other 9 map
    // through TABLE_TO_COLLECTION.
    expect(Object.keys(TABLE_TO_COLLECTION).sort()).toEqual([
      'asset_versions', 'assets', 'comments', 'files',
      'phase_dependencies', 'phases', 'task_dependencies', 'task_links', 'tasks',
    ])
  })
})

// ── 0061: two edge tables, one collection ───────────────────────────────────
describe('dependency kind stamping (0061)', () => {
  it('stamps kind from the source table, because the DB has no such column', () => {
    // `kind` is not a column on either edge table — it is implied by WHICH
    // TABLE the row came from. A broadcast payload comes straight from the
    // trigger, so it arrives with no kind at all.
    expect(stampKindFromTable('phase_dependencies', { id: 'd1' })).toEqual({ id: 'd1', kind: 'phase' })
    expect(stampKindFromTable('task_dependencies',  { id: 'd2' })).toEqual({ id: 'd2', kind: 'task' })
  })

  it('leaves non-dependency tables and null rows untouched', () => {
    const row = { id: 't1', title: 'x' }
    expect(stampKindFromTable('tasks', row)).toBe(row)
    expect(stampKindFromTable('phase_dependencies', null)).toBe(null)
  })

  it('a phase edge arriving over the wire lands in dependencies WITH its kind', () => {
    // 🚨 THE REGRESSION THIS GUARDS. Without the stamp the row lands with
    // kind undefined; DetailPane reads `d.kind || 'task'`, looks the endpoints
    // up in rowIndexByTaskId, misses, and draws nothing. The edge would be in
    // local state and invisible on screen — then appear correctly after a
    // reload, because the LOADER stamps kind. Worst possible bug shape.
    const bundle = makeBundle()
    const { bundle: next } = applyRealtimeEvent(bundle, {
      table: 'phase_dependencies',
      op: 'INSERT',
      record: { id: 'pd1', predecessor_id: 'ph1', successor_id: 'ph2' },
    }, {})
    const added = next.dependencies.find(d => d.id === 'pd1')
    expect(added).toBeTruthy()
    expect(added.kind).toBe('phase')
  })

  it('deleting a phase drops its edges, mirroring the DB cascade', () => {
    // Before 0061 a phase edge could not exist in cloud, so removeWithMirror
    // had no 'phases' case and nothing pruned them. deleteTask has always done
    // this; the phase side is new.
    const bundle = {
      ...makeBundle(),
      phases: [{ id: 'ph1' }, { id: 'ph2' }],
      dependencies: [
        { id: 'pd1', kind: 'phase', predecessor_id: 'ph1', successor_id: 'ph2' },
        { id: 'td1', kind: 'task',  predecessor_id: 't1',  successor_id: 't2'  },
      ],
    }
    const { bundle: next } = applyRealtimeEvent(bundle, {
      table: 'phases', op: 'DELETE', oldRecord: { id: 'ph1' },
    }, {})
    expect(next.dependencies.map(d => d.id)).toEqual(['td1'])
    expect(next.phases.map(p => p.id)).toEqual(['ph2'])
  })
})
