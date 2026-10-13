// Vitest — Dashboard task view model (Session 8).

import { describe, it, expect } from 'vitest'
import {
  TASK_STATUSES, PRIORITIES,
  applyTaskFilters, applyTaskSort, groupTasks, buildGroupPatch,
  myRoleOnTask, resolveGroupLabel,
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

  it('phase grouping reads the embedded asset phase', () => {
    const tasks = [mk({ id: 't1' }), mk({ id: 't2', asset: { id: 'a2', name: 'B', phase_id: null } })]
    const groups = groupTasks(tasks, 'phase', { phasesById: { ph1: { name: 'Previz' } } })
    expect(groups.find(g => g.key === 'ph1').label).toBe('Previz')
    expect(groups.find(g => g.key === '__none__').tasks.map(t => t.id)).toEqual(['t2'])
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
