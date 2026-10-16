// Vitest — Dashboard task view model (Session 8).

import { describe, it, expect } from 'vitest'
import {
  TASK_STATUSES, PRIORITIES,
  applyTaskFilters, applyTaskSort, groupTasks, buildGroupPatch,
  myRoleOnTask, resolveGroupLabel, itemNamesOf, taskAssetIds,
} from './dashboardTaskModel'

const ME = 'user-me'
const OTHER = 'user-other'

const mk = (over = {}) => ({
  id: over.id || Math.random().toString(36).slice(2),
  title: 'Task',
  status: 'waiting_to_start',
  priority: 'medium',
  project_id: 'p1',
  project: { id: 'p1', title: 'Alpha' },
  asset: { id: 'a1', name: 'Asset', phase_id: 'ph1' },
  assignee_id: ME,
  reviewer_id: null,
  ...over,
})

describe('myRoleOnTask', () => {
  it('distinguishes assigned / reviewing / neither', () => {
    expect(myRoleOnTask(mk(), ME)).toBe('assigned')
    expect(myRoleOnTask(mk({ assignee_id: OTHER, reviewer_id: ME }), ME)).toBe('reviewing')
    expect(myRoleOnTask(mk({ assignee_id: OTHER }), ME)).toBe(null)
    expect(myRoleOnTask(mk(), null)).toBe(null)
  })

  it('assignee wins when the user holds both roles', () => {
    expect(myRoleOnTask(mk({ reviewer_id: ME }), ME)).toBe('assigned')
  })
})

describe('applyTaskFilters', () => {
  const tasks = [
    mk({ id: 't1', title: 'Model the fox', status: 'in_progress' }),
    mk({ id: 't2', title: 'Rig the fox', status: 'final', project: { id: 'p2', title: 'Beta' }, project_id: 'p2' }),
    mk({ id: 't3', title: 'Comp shot 12', assignee_id: OTHER, reviewer_id: ME }),
  ]

  it('searches title and project title', () => {
    expect(applyTaskFilters(tasks, { search: 'fox' }).map(t => t.id)).toEqual(['t1', 't2'])
    expect(applyTaskFilters(tasks, { search: 'beta' }).map(t => t.id)).toEqual(['t2'])
  })

  it('filters by status is / is_not', () => {
    expect(applyTaskFilters(tasks, { filters: [{ field: 'status', op: 'is', value: 'final' }] })
      .map(t => t.id)).toEqual(['t2'])
    expect(applyTaskFilters(tasks, { filters: [{ field: 'status', op: 'is_not', value: 'final' }] })
      .map(t => t.id)).toEqual(['t1', 't3'])
  })

  it('filters by my role', () => {
    expect(applyTaskFilters(tasks, { filters: [{ field: 'role', op: 'is', value: 'reviewing' }], userId: ME })
      .map(t => t.id)).toEqual(['t3'])
  })
})

describe('applyTaskSort', () => {
  it('sorts priority by ordinal, not alphabetically', () => {
    const tasks = [mk({ id: 'a', priority: 'urgent' }), mk({ id: 'b', priority: 'low' }), mk({ id: 'c', priority: 'high' })]
    expect(applyTaskSort(tasks, { sortField: 'priority', sortDir: 'asc' }).map(t => t.id))
      .toEqual(['b', 'c', 'a'])
  })

  it('sinks empty due dates to the end in both directions', () => {
    const tasks = [mk({ id: 'a', end_date: null }), mk({ id: 'b', end_date: '2026-08-01' }), mk({ id: 'c', end_date: '2026-07-01' })]
    expect(applyTaskSort(tasks, { sortField: 'end_date', sortDir: 'asc' }).map(t => t.id))
      .toEqual(['c', 'b', 'a'])
    expect(applyTaskSort(tasks, { sortField: 'end_date', sortDir: 'desc' }).map(t => t.id))
      .toEqual(['b', 'c', 'a'])
  })

  it('sorts by embedded project title', () => {
    const tasks = [mk({ id: 'a', project: { title: 'Zeta' } }), mk({ id: 'b', project: { title: 'Alpha' } })]
    expect(applyTaskSort(tasks, { sortField: 'project', sortDir: 'asc' }).map(t => t.id))
      .toEqual(['b', 'a'])
  })
})

describe('groupTasks', () => {
  it('status grouping keeps all 9 columns, empties included', () => {
    const groups = groupTasks([mk()], 'status', {})
    expect(groups.map(g => g.key)).toEqual(TASK_STATUSES)
  })

  it('priority grouping is most-urgent-first with empties', () => {
    const groups = groupTasks([mk()], 'priority', {})
    expect(groups.map(g => g.key)).toEqual([...PRIORITIES].reverse())
  })

  it('project grouping drops empty groups and resolves labels', () => {
    const tasks = [
      mk({ id: 't1' }),
      mk({ id: 't2', project_id: 'p2', project: { id: 'p2', title: 'Beta' } }),
    ]
    const groups = groupTasks(tasks, 'project', { projectsById: { p1: { title: 'Alpha' }, p2: { title: 'Beta' } } })
    expect(groups.map(g => g.label)).toEqual(['Alpha', 'Beta'])
    expect(groups.every(g => g.tasks.length > 0)).toBe(true)
  })

  it('role grouping splits assigned from reviewing', () => {
    const tasks = [
      mk({ id: 't1' }),
      mk({ id: 't2', assignee_id: OTHER, reviewer_id: ME }),
    ]
    const groups = groupTasks(tasks, 'role', { userId: ME })
    expect(groups.find(g => g.key === 'assigned').tasks.map(t => t.id)).toEqual(['t1'])
    expect(groups.find(g => g.key === 'reviewing').tasks.map(t => t.id)).toEqual(['t2'])
  })

  // VW1m (2026-10-16): a task's phase is its own. It used to be its first
  // asset's (`t.asset.phase_id`), so a task with a phase and no asset read
  // None, and one whose asset sat in another phase was filed there.
  it('phase grouping reads the task\'s own phase, never an asset\'s', () => {
    const tasks = [
      mk({ id: 't1', phase_id: 'ph1' }),
      mk({ id: 't2', phase_id: null }),
      // CONTROL: the asset's phase (the old reading) says ph1; its own says ph2.
      mk({ id: 't3', phase_id: 'ph2', asset: { id: 'a1', name: 'Asset', phase_id: 'ph1' } }),
      mk({ id: 't4', phase_id: 'ph2', asset: undefined, items: [] }),
    ]
    const groups = groupTasks(tasks, 'phase', { phasesById: { ph1: { name: 'Previz' }, ph2: { name: 'Shoot' } } })
    expect(groups.map(g => [g.label, g.tasks.map(t => t.id)])).toEqual([
      ['Previz', ['t1']], ['Shoot', ['t3', 't4']], ['None', ['t2']],
    ])
  })
})

describe('buildGroupPatch', () => {
  it('patches status and priority', () => {
    expect(buildGroupPatch('status', 'in_progress')).toEqual({ status: 'in_progress' })
    expect(buildGroupPatch('priority', 'urgent')).toEqual({ priority: 'urgent' })
  })
  it('refuses cross-project / phase / role drags', () => {
    expect(buildGroupPatch('project', 'p2')).toBe(null)
    expect(buildGroupPatch('phase', 'ph2')).toBe(null)
    expect(buildGroupPatch('role', 'assigned')).toBe(null)
  })
})

describe('resolveGroupLabel', () => {
  it('labels the sentinel per group mode', () => {
    expect(resolveGroupLabel('role', '__none__')).toBe('Other')
    expect(resolveGroupLabel('phase', '__none__')).toBe('None')
  })
})

// VW1m (2026-10-16), Q-N6's interim ("Every asset, 'A, B'"): a row of
// listMyTasks carries every item it can read as `items: [{ kind, id, name }]`;
// the Asset column, the cards and the window name them all, A to Z. There is
// no first asset any more: the old `asset` embed rode tasks.asset_id.
describe('itemNamesOf: every item of a kind, by name A to Z', () => {
  const row = mk({
    asset: { id: 'a9', name: 'Old first asset', phase_id: 'ph1' },
    items: [
      { kind: 'asset', id: 'a2', name: 'Storm Lantern' },
      { kind: 'scene', id: 's1', name: 'The cove' },
      { kind: 'asset', id: 'a1', name: 'lighthouse Interior' },
      { kind: 'shot', id: 'h10', name: 'Shot 10' },
      { kind: 'shot', id: 'h2', name: 'Shot 2' },
      { kind: 'asset', id: 'a3', name: '' },
    ],
  })
  it('names every asset, case ignored, an unnamed one Untitled, joined with a comma', () => {
    expect(itemNamesOf(row, 'asset')).toBe('lighthouse Interior, Storm Lantern, Untitled')
    expect(itemNamesOf(row)).toBe('lighthouse Interior, Storm Lantern, Untitled')
  })
  it('each kind on its own, numbers read as numbers', () => {
    expect(itemNamesOf(row, 'scene')).toBe('The cove')
    expect(itemNamesOf(row, 'shot')).toBe('Shot 2, Shot 10')
    expect(itemNamesOf(row, 'level')).toBe('')
  })
  it('CONTROL: the old embedded asset alone names nothing; a row with no items names nothing', () => {
    expect(itemNamesOf(mk(), 'asset')).toBe('')
    expect(itemNamesOf(mk({ items: null }), 'asset')).toBe('')
    expect(itemNamesOf(null, 'asset')).toBe('')
  })
})

describe('taskAssetIds: every asset the tasks are about (the live filter in useMyTasks)', () => {
  it('reads the items of every task, assets only, never the old embed', () => {
    const tasks = [
      mk({ items: [{ kind: 'asset', id: 'a1', name: 'A' }, { kind: 'asset', id: 'a2', name: 'B' }, { kind: 'scene', id: 's1', name: 'S' }] }),
      mk({ items: [{ kind: 'asset', id: 'a2', name: 'B' }] }),
      mk({ asset: { id: 'a9', name: 'Old', phase_id: null } }),
    ]
    expect([...taskAssetIds(tasks)].sort()).toEqual(['a1', 'a2'])
    expect(taskAssetIds(null).size).toBe(0)
  })
})
