// =============================================================================
// editHistoryRevert.test.js — revert planning for edit_history entries
// (Session 7). Pure: entry in, executable plan out.
// =============================================================================

import { describe, it, expect } from 'vitest'
import {
  buildRevertPlan,
  canRevertEntry,
  revertActionLabel,
  REVERTABLE_TABLES,
} from './editHistoryRevert'

const base = { entity_type: 'assets', entity_id: 'a1' }

describe('buildRevertPlan — update entries', () => {
  it('inverts a plain field diff', () => {
    const plan = buildRevertPlan({
      ...base, action: 'update',
      diff: {
        name:   { old: 'Old name', new: 'New name' },
        status: { old: 'not_started', new: 'in_progress' },
      },
    })
    expect(plan).toEqual({
      kind: 'inverse-patch', table: 'assets', id: 'a1',
      patch: { name: 'Old name', status: 'not_started' },
      forwardPatch: { name: 'New name', status: 'in_progress' },
    })
  })

  it('forwardPatch mirrors the diffed fields at their .new values', () => {
    const plan = buildRevertPlan({
      ...base, action: 'update',
      diff: {
        phase_id:     { old: null, new: 'ph1' },
        workspace_id: { old: 'w1', new: 'w2' },
      },
    })
    expect(plan.forwardPatch).toEqual({ phase_id: 'ph1' })
  })

  it('inverts null → value edits back to null', () => {
    const plan = buildRevertPlan({
      ...base, action: 'update',
      diff: { phase_id: { old: null, new: 'ph1' } },
    })
    expect(plan.patch).toEqual({ phase_id: null })
  })

  it('never lets audit/tenancy/trash columns ride an inverse patch', () => {
    const plan = buildRevertPlan({
      ...base, action: 'update',
      diff: {
        name:         { old: 'A', new: 'B' },
        workspace_id: { old: 'w1', new: 'w2' },
        deleted_by:   { old: null, new: 'u1' },
        created_at:   { old: '2026-01-01', new: '2026-01-02' },
      },
    })
    expect(plan.patch).toEqual({ name: 'A' })
  })

  it('is a noop when only excluded columns changed', () => {
    const plan = buildRevertPlan({
      ...base, action: 'update',
      diff: { workspace_id: { old: 'w1', new: 'w2' } },
    })
    expect(plan.kind).toBe('noop')
  })

  it('classifies a Deleted transition as restore', () => {
    const plan = buildRevertPlan({
      ...base, action: 'update',
      diff: {
        deleted_at: { old: null, new: '2026-07-28T10:00:00Z' },
        deleted_by: { old: null, new: 'u1' },
      },
    })
    expect(plan).toEqual({ kind: 'restore', table: 'assets', id: 'a1' })
  })

  it('classifies a Restored transition as soft-delete', () => {
    const plan = buildRevertPlan({
      ...base, action: 'update',
      diff: { deleted_at: { old: '2026-07-28T10:00:00Z', new: null } },
    })
    expect(plan).toEqual({ kind: 'soft-delete', table: 'assets', id: 'a1' })
  })
})

describe('buildRevertPlan — create / delete entries', () => {
  it('reverts a create by trashing the entity', () => {
    const plan = buildRevertPlan({
      ...base, action: 'create',
      diff: { new: { id: 'a1', name: 'Asset' } },
    })
    expect(plan).toEqual({ kind: 'soft-delete', table: 'assets', id: 'a1' })
  })

  it('reverts a hard delete by recreating from the snapshot, id preserved', () => {
    const plan = buildRevertPlan({
      entity_type: 'tasks', entity_id: 't1', action: 'delete',
      diff: { old: {
        id: 't1', asset_id: 'a1', project_id: 'p1', title: 'Task',
        workspace_id: 'w1', created_at: '2026-01-01', updated_at: '2026-01-02',
        created_by: 'u1',
      } },
    })
    expect(plan.kind).toBe('recreate')
    expect(plan.row).toEqual({
      id: 't1', asset_id: 'a1', project_id: 'p1', title: 'Task',
    })
  })

  it('cannot recreate a hard-deleted project (fresh id would orphan children)', () => {
    const plan = buildRevertPlan({
      entity_type: 'projects', entity_id: 'p1', action: 'delete',
      diff: { old: { id: 'p1', title: 'Gone' } },
    })
    expect(plan.kind).toBe('unsupported')
  })

  it('rejects delete entries without a usable snapshot', () => {
    expect(buildRevertPlan({
      entity_type: 'tasks', entity_id: 't1', action: 'delete', diff: {},
    }).kind).toBe('unsupported')
  })
})

describe('buildRevertPlan — support boundaries', () => {
  it('supports exactly projects/phases/assets/tasks', () => {
    expect(Object.keys(REVERTABLE_TABLES).sort())
      .toEqual(['assets', 'phases', 'projects', 'tasks'])
  })

  it('declines tables without full mutator coverage', () => {
    for (const t of ['files', 'comments', 'rate_cards', 'task_links', 'ingestion_runs']) {
      expect(buildRevertPlan({
        entity_type: t, entity_id: 'x1', action: 'update',
        diff: { name: { old: 'a', new: 'b' } },
      }).kind).toBe('unsupported')
    }
  })

  it('declines malformed entries and unknown actions', () => {
    expect(buildRevertPlan(null).kind).toBe('unsupported')
    expect(buildRevertPlan({}).kind).toBe('unsupported')
    expect(buildRevertPlan({ ...base, action: 'truncate' }).kind).toBe('unsupported')
  })
})

describe('canRevertEntry / revertActionLabel', () => {
  it('canRevertEntry is true only for executable plans', () => {
    expect(canRevertEntry({
      ...base, action: 'update', diff: { name: { old: 'a', new: 'b' } },
    })).toBe(true)
    expect(canRevertEntry({
      ...base, action: 'update', diff: { workspace_id: { old: 'a', new: 'b' } },
    })).toBe(false)
    expect(canRevertEntry({
      entity_type: 'files', entity_id: 'f1', action: 'create', diff: { new: { id: 'f1' } },
    })).toBe(false)
  })

  it('labels match the plan kind', () => {
    expect(revertActionLabel({
      ...base, action: 'update', diff: { name: { old: 'a', new: 'b' } },
    })).toMatch(/field changes/i)
    expect(revertActionLabel({
      ...base, action: 'update',
      diff: { deleted_at: { old: null, new: '2026-07-28T10:00:00Z' } },
    })).toMatch(/restore/i)
    expect(revertActionLabel({
      ...base, action: 'create', diff: { new: { id: 'a1' } },
    })).toMatch(/delete/i)
  })
})
