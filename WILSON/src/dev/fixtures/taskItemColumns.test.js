// =============================================================================
// taskItemColumns.test.js — FX2 review round 2 (R2-7): the fake cloud keeps a
// task's single columns as 0096 does. An item write recomputes the column of
// ITS kind (0096 §7a) and no other: a column of another kind with no item
// behind it (a row written before 0096, like suite 99's cross-project asset)
// is the database's to keep, not the write's to clear.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { buildDevFixtures } from './install'
import { PROJECT_ID, TASK_ID } from './data/project'
import { fid } from './ids'

describe('an item write touches only its own kind\'s column', () => {
  it('adding, reordering and removing an asset item leave a scene column with no item as it is', async () => {
    const fx = buildDevFixtures()
    const a = fx.rabbitAdapter()
    const T5 = TASK_ID(5)
    const row = fx.store.tasks.find(t => t.id === T5)
    // A scene written straight onto the row, with no item behind it.
    row.scene_id = fid('scene', 1)
    expect(fx.store.taskItems.some(i => i.task_id === T5 && i.entity_type === 'scene')).toBe(false)
    const added = await a.addTaskItem({ task_id: T5, project_id: PROJECT_ID, entity_type: 'asset', entity_id: fid('asset', 12), position: 1 })
    expect(row.scene_id).toBe(fid('scene', 1))
    const assets = fx.store.taskItems.filter(i => i.task_id === T5 && i.entity_type === 'asset').map(i => i.id)
    await a.reorderTaskItems(PROJECT_ID, T5, 'asset', [added.id, ...assets.filter(id => id !== added.id)])
    expect(row.asset_id).toBe(fid('asset', 12))
    expect(row.scene_id).toBe(fid('scene', 1))
    await a.deleteTaskItem(added.id)
    expect(row.scene_id).toBe(fid('scene', 1))
  })
})
