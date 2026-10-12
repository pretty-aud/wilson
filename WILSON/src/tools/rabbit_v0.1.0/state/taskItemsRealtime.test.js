// =============================================================================
// taskItemsRealtime.test.js — FX2 (0096): task_items joined the broadcast's
// project_id arm, and the merge takes its events into `taskItems`:
//   · a row arrives in the shape a load gives (the five GENERATED columns the
//     database sends are dropped);
//   · a task names an item once: this window's own row for the same (task,
//     kind, entity) under another id gives way to the stored one;
//   · an UPDATE (a reorder elsewhere) moves the position; a DELETE removes it;
//   · the main item ctx.tasks shows follows (withItemLinks over the merge).
// =============================================================================

import { describe, it, expect } from 'vitest'
import { applyRealtimeEvent, normalizeBroadcastPayload, TABLE_TO_COLLECTION } from './realtimeMerge'
import { withItemLinks } from './taskItemsModel'

const row = (id, entity, position, extra = {}) => ({
  id, task_id: 't1', project_id: 'p1', workspace_id: 'w1', entity_type: 'asset', entity_id: entity, position,
  created_at: '2026-10-11T00:00:00Z', updated_at: '2026-10-11T00:00:00Z', ...extra,
})
const GENERATED = { asset_id: 'x', scene_id: null, shot_id: null, level_id: null, experience_id: null }
const base = () => ({ project: { id: 'p1' }, tasks: [{ id: 't1', asset_id: 'A1' }], taskItems: [row('i1', 'A1', 0)] })
const evt = (op, record, oldRecord = null) => normalizeBroadcastPayload({ table: 'task_items', operation: op, record, old_record: oldRecord })

describe('task_items on the project channel', () => {
  it('maps to the taskItems collection (never taskLinks, the URL links)', () => {
    expect(TABLE_TO_COLLECTION.task_items).toBe('taskItems')
    expect(TABLE_TO_COLLECTION.task_links).toBe('taskLinks')
  })

  it('an INSERT lands in the load\'s shape: the generated columns are dropped', () => {
    const { bundle } = applyRealtimeEvent(base(), evt('INSERT', { ...row('i2', 'A2', 1), ...GENERATED, asset_id: 'A2' }))
    const got = bundle.taskItems.find(i => i.id === 'i2')
    expect(got).toEqual(row('i2', 'A2', 1))
    for (const k of Object.keys(GENERATED)) expect(got).not.toHaveProperty(k)
  })

  it('the stored row for a (task, kind, entity) replaces this window\'s own copy under another id', () => {
    const b = base()
    b.taskItems.push(row('mine', 'A2', 1))
    const { bundle } = applyRealtimeEvent(b, evt('INSERT', row('theirs', 'A2', 1)))
    expect(bundle.taskItems.map(i => i.id).sort()).toEqual(['i1', 'theirs'])
  })

  it('an UPDATE moves a position, and the main item ctx.tasks shows follows', () => {
    const b = base()
    b.taskItems.push(row('i2', 'A2', 1))
    const moved = applyRealtimeEvent(b, evt('UPDATE', { ...row('i2', 'A2', 0), updated_at: '2026-10-11T01:00:00Z', ...GENERATED }, row('i2', 'A2', 1))).bundle
    const moved2 = applyRealtimeEvent(moved, evt('UPDATE', { ...row('i1', 'A1', 1), updated_at: '2026-10-11T01:00:00Z' }, row('i1', 'A1', 0))).bundle
    expect(withItemLinks(moved2.tasks, moved2.taskItems, true)[0].asset_id).toBe('A2')
  })

  it('a DELETE removes the row by id', () => {
    const { bundle } = applyRealtimeEvent(base(), evt('DELETE', null, row('i1', 'A1', 0)))
    expect(bundle.taskItems).toEqual([])
  })

  it('another table\'s rows are untouched by the shape rule', () => {
    const b = { ...base(), tasks: [] }
    const { bundle } = applyRealtimeEvent(b, normalizeBroadcastPayload({ table: 'tasks', operation: 'INSERT', record: { id: 't9', project_id: 'p1', asset_id: 'A1', scene_id: null } }))
    expect(bundle.tasks.find(t => t.id === 't9')).toMatchObject({ asset_id: 'A1', scene_id: null })
  })
})
