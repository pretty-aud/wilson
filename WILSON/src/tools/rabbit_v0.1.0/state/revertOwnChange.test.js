// =============================================================================
// revertOwnChange.test.js — a failed optimistic write takes back its OWN
// change, and nothing that landed while it was in flight (post-overhaul S5d,
// review round 2, R2-02: the whole snapshot put back erased a second drag
// that had succeeded, and the rows an open had set aside). The provider's
// half, with the real provider and two writes in flight, is
// views/budget/bidVersionsReview.test.jsx "S5d R2-02".
// =============================================================================
import { describe, it, expect } from 'vitest'
import { revertOwnChange, revertRows, revertFields } from './revertOwnChange'

const t1 = { id: 't1', title: 'Comp', start_date: '2026-08-03', bid_days: 3 }
const t2 = { id: 't2', title: 'Light', start_date: '2026-08-10', bid_days: 5 }
const base = { project: { id: 'p1', name: 'Salt Hours', budget_active: false }, tasks: [t1, t2], phases: [] }
const patchTask = (id, patch) => (b) => ({ ...b, tasks: b.tasks.map(t => (t.id === id ? { ...t, ...patch } : t)) })

describe('a failed write takes back its own change only', () => {
  it('another write that landed meanwhile — another row, the same row\'s other field — stays', () => {
    const first = patchTask('t1', { start_date: '2026-08-05' })
    const applied = first(base)
    // While the first was in flight: t2 dragged, and t1 renamed; both landed.
    const now = patchTask('t1', { title: 'Comp v2' })(patchTask('t2', { bid_days: 8 })(applied))
    const back = revertOwnChange(now, base, applied)
    expect(back.tasks.find(t => t.id === 't1')).toEqual({ ...t1, title: 'Comp v2' })
    expect(back.tasks.find(t => t.id === 't2').bid_days).toBe(8)
    // CONTROL: the old rollback (the whole snapshot) erased both.
    expect(base.tasks.find(t => t.id === 't2').bid_days).toBe(5)
  })
  it('a later write to the SAME field keeps its own value (it reached the backend; the failed one did not)', () => {
    const first = patchTask('t1', { bid_days: 4 })
    const applied = first(base)
    const now = patchTask('t1', { bid_days: 9 })(applied)
    expect(revertOwnChange(now, base, applied).tasks[0].bid_days).toBe(9)
  })
  it('a row the write added goes; a row it removed comes back where it was; a row removed since stays removed', () => {
    const add = { id: 't3', title: 'New' }
    const addWrite = (b) => ({ ...b, tasks: [...b.tasks, add] })
    let applied = addWrite(base)
    expect(revertOwnChange(applied, base, applied).tasks.map(t => t.id)).toEqual(['t1', 't2'])
    const delWrite = (b) => ({ ...b, tasks: b.tasks.filter(t => t.id !== 't1') })
    applied = delWrite(base)
    expect(revertOwnChange(applied, base, applied).tasks.map(t => t.id)).toEqual(['t1', 't2'])
    // t2 deleted by a later write that landed: the failed edit of t2 does not bring it back.
    const editT2 = patchTask('t2', { title: 'x' })
    applied = editT2(base)
    const gone = { ...applied, tasks: applied.tasks.filter(t => t.id !== 't2') }
    expect(revertOwnChange(gone, base, applied).tasks.map(t => t.id)).toEqual(['t1'])
  })
  it('the project record field by field; a key that is not rows is put back only if nothing replaced it', () => {
    const write = (b) => ({ ...b, project: { ...b.project, budget_active: true } })
    const applied = write(base)
    const now = { ...applied, project: { ...applied.project, name: 'Renamed' } }
    expect(revertOwnChange(now, base, applied).project).toEqual({ id: 'p1', name: 'Renamed', budget_active: false })
    const flag = { ...base, mode: 'a' }
    const flagged = { ...flag, mode: 'b' }
    expect(revertOwnChange(flagged, flag, flagged).mode).toBe('a')
    expect(revertOwnChange({ ...flagged, mode: 'c' }, flag, flagged).mode).toBe('c')
  })
  it('nothing to take back: the same bundle, by identity', () => {
    const now = patchTask('t2', { bid_days: 8 })(base)
    expect(revertOwnChange(now, base, base)).toBe(now)
    expect(revertFields(t1, t1, t1)).toBe(t1)
    expect(revertRows(base.tasks, base.tasks, base.tasks)).toBe(base.tasks)
  })
})
