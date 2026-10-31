// =============================================================================
// timelineVersionView.test.js — post-overhaul S5d, step 2: what the Timeline
// draws while VIEWING a bid version. Its rows are the version's own, as saved;
// the live rows are read by id only for what a snapshot cannot carry (the
// assignee of a version saved before versions kept it), and the arrows are the
// edges between the version's rows as those rows carry them now.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { versionView, canViewVersion } from './timelineVersionView'
import { snapshotFromLive } from '../state/budgetVersionModel'

const project = { id: 'p1', budget_margin_pct: 0, budget_contingency_pct: 0, budget_agency_enabled: false }
const phases = [
  { id: 'ph1', name: 'Shoot', parent_phase_id: null, start_date: '2026-10-01', end_date: '2026-10-20' },
  { id: 'ph2', name: 'Post', parent_phase_id: null, start_date: '2026-10-21', end_date: '2026-11-20' },
]
const saved = [
  { id: 't1', title: 'Light the door', phase_id: 'ph1', start_date: '2026-10-02', end_date: '2026-10-05', bid_days: 3, assignee_id: 'u-mara' },
  { id: 't2', title: 'Grade', phase_id: 'ph2', start_date: '2026-10-22', end_date: '2026-10-29', bid_days: 5, assignee_id: null },
  { id: 't3', title: 'Conform', phase_id: 'ph2', start_date: '2026-11-02', end_date: '2026-11-06', bid_days: 4 },
]
const milestones = [{ id: 'm1', title: 'Picture lock', date: '2026-11-10' }]
const version = { id: 'v1', name: 'Mid ROM', snapshot: snapshotFromLive({ tasks: saved, phases, milestones, project, roleRates: {} }) }

describe('versionView — the version\'s own rows, as saved', () => {
  it('a task renamed and re-dated since the save shows its saved title and dates; one set aside or deleted since still shows', () => {
    const live = {
      // t1 renamed and moved a week; t2 set aside; t3 deleted (in neither list).
      tasks: [{ ...saved[0], title: 'Light the door (re-lit)', start_date: '2026-10-09', end_date: '2026-10-12' }],
      setAsideTasks: [{ ...saved[1] }],
    }
    const v = versionView(version, live)
    expect(v.tasks.map(t => [t.id, t.title, t.start_date, t.end_date])).toEqual([
      ['t1', 'Light the door', '2026-10-02', '2026-10-05'],
      ['t2', 'Grade', '2026-10-22', '2026-10-29'],
      ['t3', 'Conform', '2026-11-02', '2026-11-06'],
    ])
    expect(v.phases.map(p => p.id)).toEqual(['ph1', 'ph2'])
    expect(v.milestones).toEqual([expect.objectContaining({ id: 'm1', date: '2026-11-10' })])
  })
  it('copies: nothing it returns is the snapshot\'s own object, so no reader can write into a version', () => {
    const v = versionView(version, {})
    expect(v.tasks[0]).not.toBe(version.snapshot.tasks[0])
    expect(v.phases[0]).not.toBe(version.snapshot.phases[0])
    expect(v.milestones[0]).not.toBe(version.snapshot.milestones[0])
    v.tasks[0].title = 'scribbled'
    expect(version.snapshot.tasks[0].title).toBe('Light the door')
  })
  it('a version saved before S5 (no timeline captured) has no view — it cannot be viewed', () => {
    const old = { id: 'v0', name: 'Bid v0', snapshot: { grandTotal: 1000, tasks: [{ id: 't1', bid_days: 2 }] } }
    expect(versionView(old, {})).toBeNull()
    expect(canViewVersion(old)).toBe(false)
    expect(canViewVersion(version)).toBe(true)
    expect(versionView(null, {})).toBeNull()
  })
})

describe('the assignee: the version\'s own; the row\'s as it is now only when the version could not carry it', () => {
  it('a version that carries assignees keeps them, even when the live row was re-assigned since (and keeps "none" as none)', () => {
    const live = { tasks: [{ ...saved[0], assignee_id: 'u-tom' }, { ...saved[1], assignee_id: 'u-tom' }] }
    const v = versionView(version, live)
    expect(v.tasks.map(t => t.assignee_id)).toEqual(['u-mara', null, null])
  })
  it('a version saved before versions kept the assignee takes the row\'s as it is now — live first, then set aside — and none when the row is gone', () => {
    const before = { id: 'vb', name: 'Before', snapshot: { ...version.snapshot, tasks: version.snapshot.tasks.map(({ assignee_id, ...t }) => t) } }
    expect(before.snapshot.tasks.some(t => 'assignee_id' in t)).toBe(false)
    const live = { tasks: [{ id: 't1', assignee_id: 'u-tom' }], setAsideTasks: [{ id: 't1', assignee_id: 'u-old' }, { id: 't2', assignee_id: 'u-ana' }] }
    const v = versionView(before, live)
    expect(v.tasks.map(t => [t.id, t.assignee_id])).toEqual([['t1', 'u-tom'], ['t2', 'u-ana'], ['t3', null]])
  })
})

// VW1m (2026-10-16), Q-N7 (batch 16; interim: a version keeps every item of
// every kind): a viewed version groups by its OWN items — the snapshot's,
// never the task's items as they are now — handed to the Timeline as kept
// task_items rows; a version saved before hands its single fields, one each.
describe('the items: the version\'s own, as saved (VW1m)', () => {
  const row = (task, kind, entity) => ({ task_id: task, entity_type: kind, entity_id: entity })
  it('a version saved with items hands every item of every kind as rows', () => {
    const items = [
      { id: 'i1', task_id: 't1', entity_type: 'asset', entity_id: 'A2', position: 0 },
      { id: 'i2', task_id: 't1', entity_type: 'asset', entity_id: 'A1', position: 1 },
      { id: 'i3', task_id: 't2', entity_type: 'level', entity_id: 'L1', position: 0 },
    ]
    const withItems = { id: 'v2', name: 'Items', snapshot: snapshotFromLive({ tasks: saved, items, phases, milestones, project, roleRates: {} }) }
    // The task's items now (one asset, another) are never read.
    const v = versionView(withItems, { tasks: [{ ...saved[0], asset_id: 'A9' }] })
    expect(v.taskItems).toEqual([row('t1', 'asset', 'A1'), row('t1', 'asset', 'A2'), row('t2', 'level', 'L1')])
  })
  it('a version saved before hands each task\'s single fields, one item each (and none for a task with none)', () => {
    const older = { id: 'v0', name: 'Older', snapshot: snapshotFromLive({ tasks: [{ ...saved[0], asset_id: 'A1', scene_id: 'S1' }, saved[1], saved[2]], phases, milestones, project, roleRates: {} }) }
    expect(versionView(older, {}).taskItems).toEqual([row('t1', 'asset', 'A1'), row('t1', 'scene', 'S1')])
  })
})

describe('the arrows: the edges between the version\'s rows, as those rows carry them now', () => {
  const edge = (id, a, b, kind = 'task') => ({ id, kind, predecessor_id: a, successor_id: b })
  it('keeps an edge only when both its ends are rows of the version — a set-aside row\'s edges included, one to a row it does not hold dropped', () => {
    const live = {
      dependencies: [edge('d1', 't1', 't2'), edge('d2', 't2', 'tX'), edge('d3', 'ph1', 'ph2', 'phase')],
      setAsideDependencies: [edge('d4', 't2', 't3'), edge('d1', 't1', 't2')],
    }
    expect(versionView(version, live).dependencies.map(d => d.id)).toEqual(['d1', 'd3', 'd4'])
  })
  it('a phase edge is read against the version\'s phases, a task edge against its tasks (an id is not a phase because a task has it)', () => {
    const live = { dependencies: [edge('d5', 't1', 't2', 'phase'), edge('d6', 'ph1', 'ph2')] }
    expect(versionView(version, live).dependencies).toEqual([])
  })
})
