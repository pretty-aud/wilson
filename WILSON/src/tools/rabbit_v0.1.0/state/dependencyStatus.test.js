// =============================================================================
// dependencyStatus.test.js — Phase 7, Track A bundle A2 (2026-09-06).
//
// The pure predecessor check, with the FAILING CONTROL the Phase 7 brief
// demands: an item whose predecessors ARE done must produce no warning. A
// check that fired on every status move would pass every positive case below
// and fail that one — and warning fatigue is the brief's first listed risk.
// =============================================================================

import { describe, it, expect, vi } from 'vitest'
import {
  DONE_STATUSES, COMPLETION_STATUSES, isDoneStatus, assertsCompletion, isDone, edgeKind,
  unfinishedPredecessors, statusWarning, itemLabel, humanStatus,
} from './dependencyStatus'

// The adapter is imported once below, to pin that its dependencyKind agrees
// with edgeKind; its module graph reaches the shared Supabase client, which
// columnAllowlist.test.js stubs the same way.
vi.mock('../../../cloud/auth/supabaseClient.js', () => ({ supabase: null }))

const TASK_STATUSES = [
  'waiting_to_start', 'in_progress', 'pending_review', 'needs_revisions',
  'approved', 'final', 'blocked', 'on_hold', 'omitted',
]
const PHASE_STATUSES = ['not_started', 'active', 'completed', 'delayed']

function graph() {
  const tasks = [
    { id: 'A', title: 'Model',   status: 'in_progress' },
    { id: 'B', title: 'Rig',     status: 'final' },
    { id: 'C', title: 'Animate', status: 'waiting_to_start' },
    { id: 'D', title: 'Groom',   status: 'omitted' },
    { id: 'E', title: 'Light',   status: 'waiting_to_start' },
  ]
  const phases = [
    { id: 'P', name: 'Pre-production', status: 'active' },
    { id: 'Q', name: 'Production',     status: 'not_started' },
    { id: 'R', name: 'Post',           status: 'completed' },
  ]
  const dependencies = [
    { id: 'd1', kind: 'task',  predecessor_id: 'A', successor_id: 'C' },
    { id: 'd2', kind: 'task',  predecessor_id: 'B', successor_id: 'C' },
    { id: 'd3', kind: 'task',  predecessor_id: 'D', successor_id: 'C' },
    { id: 'd4',                predecessor_id: 'A', successor_id: 'E' }, // legacy row: no kind
    { id: 'd5', kind: 'phase', predecessor_id: 'P', successor_id: 'Q' },
    { id: 'd6', kind: 'phase', predecessor_id: 'R', successor_id: 'Q' },
    { id: 'd7', kind: 'task',  predecessor_id: 'A', successor_id: 'C' }, // duplicate edge
    { id: 'd8', kind: 'task',  predecessor_id: 'ghost', successor_id: 'C' }, // unknown endpoint
  ]
  return { tasks, phases, dependencies }
}

describe('one definition of done', () => {
  it('names the four terminal statuses, and the three that assert completion', () => {
    expect([...DONE_STATUSES]).toEqual(['approved', 'final', 'omitted', 'completed'])
    expect([...COMPLETION_STATUSES]).toEqual(['approved', 'final', 'completed'])
    for (const s of DONE_STATUSES) expect(assertsCompletion(s), s).toBe(s !== 'omitted')
    for (const s of [...TASK_STATUSES, ...PHASE_STATUSES]) {
      expect(assertsCompletion(s), s).toBe(['approved', 'final', 'completed'].includes(s))
    }
  })

  it('is true for the task done states, including omitted, and false for every other task status', () => {
    for (const s of TASK_STATUSES) {
      expect(isDoneStatus(s)).toBe(['approved', 'final', 'omitted'].includes(s))
      expect(isDone({ status: s })).toBe(['approved', 'final', 'omitted'].includes(s))
    }
  })

  it('is true only for completed among the phase statuses', () => {
    for (const s of PHASE_STATUSES) expect(isDoneStatus(s)).toBe(s === 'completed')
  })

  it('treats a missing item or status as not done', () => {
    expect(isDone(null)).toBe(false)
    expect(isDone(undefined)).toBe(false)
    expect(isDone({})).toBe(false)
    expect(isDoneStatus(undefined)).toBe(false)
  })
})

describe('edgeKind', () => {
  it('routes only a literal phase kind to phases; everything else is a task edge', () => {
    expect(edgeKind({ kind: 'phase' })).toBe('phase')
    expect(edgeKind({ kind: 'task' })).toBe('task')
    expect(edgeKind({})).toBe('task')
    expect(edgeKind({ kind: 'PHASE' })).toBe('task')
    expect(edgeKind(null)).toBe('task')
  })

  it("agrees with the adapter's dependencyKind on every shape", async () => {
    const { dependencyKind } = await import('../adapters/supabaseAdapter')
    for (const dep of [{ kind: 'phase' }, { kind: 'task' }, {}, { kind: 'PHASE' }, { kind: 'phase ' }, null, undefined]) {
      expect(edgeKind(dep)).toBe(dependencyKind(dep))
    }
  })
})

describe('unfinishedPredecessors', () => {
  it('lists the not-done predecessors of a task, once each, skipping done, omitted and unknown ones', () => {
    const g = graph()
    const out = unfinishedPredecessors({ id: 'C', kind: 'task', ...g })
    expect(out.map(t => t.id)).toEqual(['A'])
  })

  it('treats a legacy edge with no kind as a task edge', () => {
    const g = graph()
    expect(unfinishedPredecessors({ id: 'E', kind: 'task', ...g }).map(t => t.id)).toEqual(['A'])
  })

  it('reads phase edges for phases and ignores completed predecessors', () => {
    const g = graph()
    expect(unfinishedPredecessors({ id: 'Q', kind: 'phase', ...g }).map(p => p.id)).toEqual(['P'])
  })

  it('never crosses kinds, even when an id appears in the other pool', () => {
    const g = graph()
    // A task edge that names a phase id as its successor must not surface
    // for the phase, and a phase edge must not surface for a task.
    g.dependencies.push({ id: 'x1', kind: 'task', predecessor_id: 'A', successor_id: 'Q' })
    g.tasks.push({ id: 'Q', title: 'A task that shares the phase id', status: 'waiting_to_start' })
    expect(unfinishedPredecessors({ id: 'Q', kind: 'phase', ...g }).map(p => p.id)).toEqual(['P'])
    expect(unfinishedPredecessors({ id: 'Q', kind: 'task', ...g }).map(t => t.id)).toEqual(['A'])
  })

  it('returns [] for an item with no edges and copes with missing arrays', () => {
    const g = graph()
    expect(unfinishedPredecessors({ id: 'A', kind: 'task', ...g })).toEqual([])
    expect(unfinishedPredecessors({ id: 'A', kind: 'task' })).toEqual([])
  })
})

describe('statusWarning', () => {
  it('FAILING CONTROL: an item whose predecessors are all done produces no warning', () => {
    const g = graph()
    g.tasks.find(t => t.id === 'A').status = 'approved'
    const w = statusWarning({ items: [g.tasks.find(t => t.id === 'C')], kind: 'task', toStatus: 'final', ...g })
    expect(w).toBeNull()
  })

  it('warns for a task moving to a done status over an unfinished predecessor, naming it', () => {
    const g = graph()
    const w = statusWarning({ items: [g.tasks.find(t => t.id === 'C')], kind: 'task', toStatus: 'final', ...g })
    expect(w).not.toBeNull()
    expect(w.kind).toBe('task')
    expect(w.toStatus).toBe('final')
    expect(w.total).toBe(1)
    expect(w.offenders).toHaveLength(1)
    expect(w.offenders[0].item.id).toBe('C')
    expect(w.offenders[0].unfinished.map(t => t.id)).toEqual(['A'])
  })

  it('fires for the completion statuses and for no other task status — marking Omitted is a skip', () => {
    const g = graph()
    const c = g.tasks.find(t => t.id === 'C')
    for (const s of TASK_STATUSES) {
      const w = statusWarning({ items: [c], kind: 'task', toStatus: s, ...g })
      expect(w === null, s).toBe(!['approved', 'final'].includes(s))
    }
  })

  it('un-omitting straight to a completion status warns — the mirror of the skip', () => {
    const g = graph()
    // D is omitted today and depends on A, which is in progress.
    g.dependencies.push({ id: 'x3', kind: 'task', predecessor_id: 'A', successor_id: 'D' })
    const d = g.tasks.find(t => t.id === 'D')
    const w = statusWarning({ items: [d], kind: 'task', toStatus: 'approved', ...g })
    expect(w).not.toBeNull()
    expect(w.offenders[0].unfinished.map(t => t.id)).toEqual(['A'])
    // …and Omitted → Omitted is silent too (every other origin → Omitted is in
    // the loop above).
    expect(statusWarning({ items: [d], kind: 'task', toStatus: 'omitted', ...g })).toBeNull()
  })

  it('does not fire when the item is already done (approved → final is not a move to done)', () => {
    const g = graph()
    const b = g.tasks.find(t => t.id === 'B')
    g.dependencies.push({ id: 'x2', kind: 'task', predecessor_id: 'C', successor_id: 'B' })
    expect(statusWarning({ items: [b], kind: 'task', toStatus: 'final', ...g })).toBeNull()
  })

  it('warns for a phase moving to completed while a predecessor phase is active', () => {
    const g = graph()
    const w = statusWarning({ items: [g.phases.find(p => p.id === 'Q')], kind: 'phase', toStatus: 'completed', ...g })
    expect(w).not.toBeNull()
    expect(w.offenders[0].unfinished.map(p => p.id)).toEqual(['P'])
    g.phases.find(p => p.id === 'P').status = 'completed'
    expect(statusWarning({ items: [g.phases.find(p => p.id === 'Q')], kind: 'phase', toStatus: 'completed', ...g })).toBeNull()
  })

  it('gives a bulk write ONE summary: total counts every item, offenders only the ones that warn', () => {
    const g = graph()
    const items = ['A', 'C', 'E', 'D'].map(id => g.tasks.find(t => t.id === id))
    const w = statusWarning({ items, kind: 'task', toStatus: 'approved', ...g })
    expect(w.total).toBe(4)
    expect(w.offenders.map(o => o.item.id)).toEqual(['C', 'E'])
  })

  it('returns null, not a clean bill, when there is no dependency data to check', () => {
    const g = graph()
    const c = g.tasks.find(t => t.id === 'C')
    expect(statusWarning({ items: [c], kind: 'task', toStatus: 'final', tasks: g.tasks, phases: g.phases })).toBeNull()
    expect(statusWarning({ items: [c], kind: 'task', toStatus: 'final', dependencies: null, tasks: g.tasks })).toBeNull()
  })

  it('ignores empty or missing item lists', () => {
    const g = graph()
    expect(statusWarning({ items: [], kind: 'task', toStatus: 'final', ...g })).toBeNull()
    expect(statusWarning({ items: [null, undefined], kind: 'task', toStatus: 'final', ...g })).toBeNull()
    expect(statusWarning({ kind: 'task', toStatus: 'final', ...g })).toBeNull()
  })
})

describe('labels', () => {
  it('never renders an empty name', () => {
    expect(itemLabel({ title: 'Rig' })).toBe('Rig')
    expect(itemLabel({ assigned_position: 'Rigger' })).toBe('Rigger')
    expect(itemLabel({}, 'task')).toBe('Untitled task')
    expect(itemLabel({ name: 'Post' }, 'phase')).toBe('Post')
    expect(itemLabel({}, 'phase')).toBe('Untitled phase')
    expect(itemLabel(null, 'phase')).toBe('Untitled phase')
  })

  it('humanises a status key', () => {
    expect(humanStatus('waiting_to_start')).toBe('Waiting to start')
    expect(humanStatus('final')).toBe('Final')
    expect(humanStatus(undefined)).toBe('—')
  })
})
