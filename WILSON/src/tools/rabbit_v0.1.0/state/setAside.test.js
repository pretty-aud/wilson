// =============================================================================
// setAside.test.js — post-overhaul S5b, step 0: the one pure answer for rows
// SET ASIDE by the open bid version (migration 0090). Every "hidden" or
// "kept" case has a CONTROL one field over, so a helper that always hides, or
// never does, fails here.
// =============================================================================

import { describe, it, expect } from 'vitest'
import {
  SET_ASIDE_KEYS, isSetAside, splitSetAside, joinSetAside, hasSetAside,
  holdersOf, workOn, workWords, removalOf, rowsInNoVersion, countRows,
} from './setAside'

const AT = '2026-10-05T10:00:00.000Z'
const version = (id, rows, extra = {}) => ({
  id, name: id, created_at: extra.created_at || '2026-10-01T09:00:00Z',
  snapshot: { kind: 'bid', totals: { overall: 0, beforeAgency: 0 }, tasks: rows.tasks || [], phases: rows.phases || [], milestones: rows.milestones || [] },
})
const OLD = { id: 'old', name: 'Bid v1', snapshot: { grandTotal: 100, tasks: [{ id: 't9' }] } }

describe('isSetAside', () => {
  it('a stamped row that is not in the trash', () => {
    expect(isSetAside({ id: 't', set_aside_at: AT })).toBe(true)
    expect(isSetAside({ id: 't', set_aside_at: null })).toBe(false)
    expect(isSetAside({ id: 't' })).toBe(false)
  })
  it('a trashed row is never set aside (the trash wins, as 0090\'s guard clears the stamp)', () => {
    expect(isSetAside({ id: 't', set_aside_at: AT, deleted_at: AT })).toBe(false)
  })
})

describe('splitSetAside — the loaders\' split', () => {
  const bundle = {
    project: { id: 'p' },
    tasks: [{ id: 't1' }, { id: 't2', set_aside_at: AT }],
    phases: [{ id: 'ph1' }, { id: 'ph2', set_aside_at: AT }],
    milestones: [{ id: 'm1', set_aside_at: AT }, { id: 'm2' }],
    dependencies: [
      { id: 'd1', predecessor_id: 't1', successor_id: 't2', kind: 'task' },
      { id: 'd2', predecessor_id: 'ph1', successor_id: 'ph2', kind: 'phase' },
      { id: 'd3', predecessor_id: 't1', successor_id: 't3', kind: 'task' },
    ],
    comments: [{ id: 'c1', entity_type: 'task', entity_id: 't2' }],
  }
  it('live rows stay; set-aside rows and the edges touching them move to the four keys', () => {
    const b = splitSetAside(bundle)
    expect(b.tasks.map(r => r.id)).toEqual(['t1'])
    expect(b.phases.map(r => r.id)).toEqual(['ph1'])
    expect(b.milestones.map(r => r.id)).toEqual(['m2'])
    expect(b.dependencies.map(d => d.id)).toEqual(['d3'])
    expect(b[SET_ASIDE_KEYS.tasks].map(r => r.id)).toEqual(['t2'])
    expect(b[SET_ASIDE_KEYS.phases].map(r => r.id)).toEqual(['ph2'])
    expect(b[SET_ASIDE_KEYS.milestones].map(r => r.id)).toEqual(['m1'])
    expect(b[SET_ASIDE_KEYS.dependencies].map(d => d.id)).toEqual(['d1', 'd2'])
  })
  it('nothing attached is dropped: comments and the rest ride along untouched (constraint 1)', () => {
    expect(splitSetAside(bundle).comments).toBe(bundle.comments)
  })
  it('a row that came back moves back, its edges with it', () => {
    const b = splitSetAside(bundle)
    const back = splitSetAside({ ...b, setAsideTasks: [{ id: 't2', set_aside_at: null }] })
    expect(back.tasks.map(r => r.id)).toEqual(['t1', 't2'])
    expect(back.dependencies.map(d => d.id).sort()).toEqual(['d1', 'd3'])
    expect(back.setAsideDependencies.map(d => d.id)).toEqual(['d2'])
  })
  it('keeps every array\'s identity when nothing is set aside (the realtime merge splits after every event)', () => {
    const plain = { tasks: [{ id: 'a' }], phases: [], milestones: [], dependencies: [{ id: 'd', predecessor_id: 'a', successor_id: 'b' }] }
    const b = splitSetAside(plain)
    expect(b.tasks).toBe(plain.tasks)
    expect(b.dependencies).toBe(plain.dependencies)
    // CONTROL: one stamp and the array is new.
    expect(splitSetAside({ ...plain, tasks: [{ id: 'a', set_aside_at: AT }] }).tasks).not.toBe(plain.tasks)
  })
  it('joinSetAside puts every row back in one array per collection; split ∘ join is the split', () => {
    const b = splitSetAside(bundle)
    const j = joinSetAside(b)
    expect(j.tasks.map(r => r.id).sort()).toEqual(['t1', 't2'])
    expect(hasSetAside(j)).toBe(false)
    expect(hasSetAside(b)).toBe(true)
    expect(splitSetAside(j).setAsideTasks.map(r => r.id)).toEqual(['t2'])
  })
})

describe('holdersOf — the versions that can bring a row back', () => {
  const v2 = version('v2', { tasks: [{ id: 't1' }] })
  const v3 = version('v3', { tasks: [{ id: 't1' }, { id: 't9' }], phases: [{ id: 'ph9' }] })
  it('finds every version holding the id, of the kind asked', () => {
    expect(holdersOf([v2, v3], 'tasks', 't1').map(v => v.id)).toEqual(['v2', 'v3'])
    expect(holdersOf([v2, v3], 'phases', 'ph9').map(v => v.id)).toEqual(['v3'])
    expect(holdersOf([v2, v3], 'tasks', 'ph9')).toEqual([])
  })
  it('leaves out the one named in `except` (the open version, for "another version")', () => {
    expect(holdersOf([v2, v3], 'tasks', 't1', { except: 'v2' }).map(v => v.id)).toEqual(['v3'])
  })
  it('a version saved before S5 (no timeline captured) is never a holder — it cannot be opened', () => {
    expect(holdersOf([OLD], 'tasks', 't9')).toEqual([])
    // CONTROL: the same id in a living version is held.
    expect(holdersOf([OLD, v3], 'tasks', 't9').map(v => v.id)).toEqual(['v3'])
  })
})

describe('workOn — what a person made or the Budget counts (constraint 4)', () => {
  const comments = [
    { id: 'c1', entity_type: 'task', entity_id: 't1' },
    { id: 'c2', entity_type: 'task', entity_id: 't1', deleted_at: AT },
    { id: 'c3', entity_type: 'phase', entity_id: 'ph1' },
    { id: 'c4', entity_type: 'asset', entity_id: 't1' },
  ]
  const files = [{ id: 'f1', task_id: 't1' }, { id: 'f2', phase_id: 'ph1' }, { id: 'f3', task_id: 't1', deleted_at: AT }]
  const managedFiles = [{ id: 'mf1', task_id: 't1' }]
  it('a task: its logged days, the live comments ON IT, its files (managed ones too)', () => {
    expect(workOn('tasks', { id: 't1', logged_days: 1.5 }, { comments, files, managedFiles })).toEqual({ loggedDays: 1.5, comments: 1, files: 2 })
  })
  it('a phase: its comments and files; never logged days', () => {
    expect(workOn('phases', { id: 'ph1', logged_days: 4 }, { comments, files })).toEqual({ loggedDays: 0, comments: 1, files: 1 })
  })
  it('a row with nothing on it, and every key date, carry no work', () => {
    expect(workOn('tasks', { id: 't2', logged_days: 0 }, { comments, files })).toBeNull()
    expect(workOn('milestones', { id: 'm1' }, { comments, files })).toBeNull()
  })
  it('the words', () => {
    expect(workWords({ loggedDays: 1.5, comments: 2, files: 1 })).toBe('1.5 days logged, 2 comments, 1 file')
    expect(workWords({ loggedDays: 1, comments: 0, files: 0 })).toBe('1 day logged')
    expect(workWords(null)).toBe('')
  })
})

describe('removalOf — Remove from this version, or Delete (constraint 9)', () => {
  const v2 = version('v2', { tasks: [{ id: 't1' }, { id: 't2' }] })
  const v3 = version('v3', { tasks: [{ id: 't1' }, { id: 't3' }] })
  const vs = [v2, v3]
  it('while v2 is open: a row ANOTHER version holds is removed (set aside); one only v2 holds, or none, is deleted', () => {
    const r = removalOf({ kind: 'tasks', ids: ['t1', 't2', 't4'], versions: vs, openVersionId: 'v2' })
    expect(r.map(x => [x.id, x.verb, x.holders.map(v => v.id)])).toEqual([
      ['t1', 'remove', ['v3']],
      ['t2', 'delete', []],
      ['t4', 'delete', []],
    ])
  })
  it('a row kept from another version (only v3 holds it) is removed from v2, and stays in v3', () => {
    expect(removalOf({ kind: 'tasks', ids: ['t3'], versions: vs, openVersionId: 'v2' })[0].verb).toBe('remove')
  })
  it('CONTROL: with no version open, or under a lock, every delete is the ordinary one', () => {
    expect(removalOf({ kind: 'tasks', ids: ['t1'], versions: vs, openVersionId: null })[0].verb).toBe('delete')
    expect(removalOf({ kind: 'tasks', ids: ['t1'], versions: vs, openVersionId: 'v2', locked: true })[0].verb).toBe('delete')
  })
  it('a version that cannot be opened holds nothing it could give back', () => {
    expect(removalOf({ kind: 'tasks', ids: ['t9'], versions: [v2, OLD], openVersionId: 'v2' })[0].verb).toBe('delete')
  })
})

describe('rowsInNoVersion — what setting aside would strand (constraint 8)', () => {
  it('the live rows no openable version holds', () => {
    const v2 = version('v2', { tasks: [{ id: 't1' }], phases: [{ id: 'ph1' }], milestones: [] })
    const live = { tasks: [{ id: 't1' }, { id: 't9' }], phases: [{ id: 'ph1' }], milestones: [{ id: 'm1' }] }
    const none = rowsInNoVersion(live, [v2, OLD])
    expect(none.tasks.map(r => r.id)).toEqual(['t9']) // OLD holds t9 but can never bring it back
    expect(none.phases).toEqual([])
    expect(none.milestones.map(r => r.id)).toEqual(['m1'])
    expect(countRows(none)).toBe(2)
    // CONTROL: once a version holds them, nothing is stranded.
    expect(countRows(rowsInNoVersion(live, [v2, version('v3', { tasks: [{ id: 't9' }], milestones: [{ id: 'm1' }] })]))).toBe(0)
  })
})
