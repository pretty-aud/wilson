// =============================================================================
// viewScreenModel.test.js — VW1d (2026-10-25): the custom views' rules on
// screen (docs/design/CUSTOM_VIEWS_DESIGN.md §4.2 to §4.5, as VW1d's step 0
// review corrected them). Each rule with a CONTROL the rule's absence fails.
// =============================================================================
import { describe, it, expect } from 'vitest'
import {
  effectiveFields, fieldsToStore, moveField, filterCount, matchesFilter, applyViewFilters,
  withFilterField, withFilterOp, applyViewSorts, withFirstSort, withFirstSortReversed, moveItem,
  sameEffect, filtersSummary, sortSummary, groupSummary, fieldsSummary, barStateOf, viewOnScreen, copyName, BAR_WORDS,
} from './viewScreenModel'
import { tasksDescription } from './tasksTableView'
import { defaultViewConfig } from '../../state/tableViewsModel'

const KEYS = ['title', 'status', 'priority', 'asset', 'phase_id', 'assignee_id']
const fixed = ['title']

describe('fields: order and visibility (Q6, Q7)', () => {
  it('no list: every field shows at its default place, the name fixed', () => {
    expect(effectiveFields([], KEYS, { fixed })).toEqual(KEYS.map(k => ({ key: k, visible: true, fixed: k === 'title' })))
  })
  it('the listed keys fill the listed keys\' places in the listed order; an unlisted key keeps its default place', () => {
    const out = effectiveFields([{ key: 'assignee_id', visible: true }, { key: 'status', visible: false }], KEYS, { fixed })
    expect(out.map(f => f.key)).toEqual(['title', 'assignee_id', 'priority', 'asset', 'phase_id', 'status'])
    expect(out.find(f => f.key === 'status').visible).toBe(false)
    // CONTROL: the unlisted ones are where the default puts them.
    expect(out.map(f => f.key).slice(2, 5)).toEqual(['priority', 'asset', 'phase_id'])
  })
  it('the name cannot be hidden or moved; a key the table does not have now is left out', () => {
    const out = effectiveFields([{ key: 'title', visible: false }, { key: 'level', visible: true }], KEYS, { fixed })
    expect(out[0]).toEqual({ key: 'title', visible: true, fixed: true })
    expect(out.some(f => f.key === 'level')).toBe(false)
  })
  it('fieldsToStore: the default is stored as [], else every field in order, with absent keys kept after', () => {
    const def = effectiveFields([], KEYS, { fixed })
    expect(fieldsToStore(def, [], KEYS)).toEqual([])
    const hidden = def.map(f => (f.key === 'priority' ? { ...f, visible: false } : f))
    expect(fieldsToStore(hidden, [{ key: 'level', visible: false }], KEYS)).toEqual([
      { key: 'status', visible: true }, { key: 'priority', visible: false }, { key: 'asset', visible: true },
      { key: 'phase_id', visible: true }, { key: 'assignee_id', visible: true }, { key: 'level', visible: false },
    ])
  })
  it('moveField moves among the movable fields; the name never moves and nothing moves past it', () => {
    const def = effectiveFields([], KEYS, { fixed })
    expect(moveField(def, 'priority', -1).map(f => f.key)).toEqual(['title', 'priority', 'status', 'asset', 'phase_id', 'assignee_id'])
    expect(moveField(def, 'status', -1).map(f => f.key)).toEqual(KEYS) // past the name: nothing
    expect(moveField(def, 'title', 1).map(f => f.key)).toEqual(KEYS)
  })
})

describe('filters (Q13; defects 1 and 2)', () => {
  it('a row with no value filters nothing and is not counted (defect 1); CONTROL: with a value it is', () => {
    const empty = { field: 'status', op: 'is', values: [] }
    expect(filterCount([empty])).toBe(0)
    expect(matchesFilter(['final'], empty)).toBe(true)
    const full = { field: 'status', op: 'is', values: ['in_progress'] }
    expect(filterCount([empty, full])).toBe(1)
    expect(matchesFilter(['final'], full)).toBe(false)
  })
  it('is matches any of several values; is not, none of them (her Q13)', () => {
    const f = { field: 'status', op: 'is', values: ['in_progress', 'pending_review'] }
    expect(matchesFilter(['pending_review'], f)).toBe(true)
    expect(matchesFilter(['final'], f)).toBe(false)
    const n = { ...f, op: 'is_not' }
    expect(matchesFilter(['final'], n)).toBe(true)
    expect(matchesFilter(['in_progress'], n)).toBe(false)
  })
  it('a linked kind: is = one of the row\'s items is among the values; is empty = none', () => {
    expect(matchesFilter(['a1', 'a2'], { field: 'asset', op: 'is', values: ['a2'] })).toBe(true)
    expect(matchesFilter(['a1', 'a2'], { field: 'asset', op: 'is_not', values: ['a2'] })).toBe(false)
    expect(matchesFilter([], { field: 'asset', op: 'is_empty', values: [] })).toBe(true)
    expect(matchesFilter(['a1'], { field: 'asset', op: 'is_not_empty', values: [] })).toBe(true)
  })
  it('a value whose row is gone matches nothing', () => {
    expect(matchesFilter(['a1'], { field: 'asset', op: 'is', values: ['gone'] })).toBe(false)
  })
  it('text: contains and is ignore case; an empty text is no value', () => {
    expect(matchesFilter(['Rig Test'], { field: 'title', op: 'contains', values: ['rig'] })).toBe(true)
    expect(matchesFilter(['Rig Test'], { field: 'title', op: 'is', values: ['rig test'], text: true })).toBe(true)
    // CONTROL: a choice's is is exact.
    expect(matchesFilter(['Final'], { field: 'status', op: 'is', values: ['final'] })).toBe(false)
  })
  it('a field change resets the condition and the value (defect 2); a condition with no value keeps none', () => {
    const d = tasksDescription({ itemKinds: ['asset'] })
    const row = { field: 'status', op: 'is_not', values: ['in_progress'] }
    expect(withFilterField(row, 'title', d)).toEqual({ field: 'title', op: 'contains', values: [] })
    expect(withFilterField(row, 'priority', d)).toEqual({ field: 'priority', op: 'is', values: [] })
    expect(withFilterOp(row, 'is_empty')).toEqual({ field: 'status', op: 'is_empty', values: [] })
    // CONTROL: a condition that takes a value keeps the values.
    expect(withFilterOp(row, 'is').values).toEqual(['in_progress'])
  })
  it('every complete filter must match; a field the table does not have filters nothing', () => {
    const d = tasksDescription({ itemKinds: ['asset'] })
    const rows = [{ id: 1, status: 'in_progress', priority: 'high' }, { id: 2, status: 'in_progress', priority: 'low' }, { id: 3, status: 'final', priority: 'high' }]
    const out = applyViewFilters(rows, [
      { field: 'status', op: 'is', values: ['in_progress'] },
      { field: 'priority', op: 'is', values: ['high'] },
      { field: 'level', op: 'is', values: ['l1'] },
    ], d)
    expect(out.map(r => r.id)).toEqual([1])
  })
})

describe('sorts (Q14)', () => {
  const d = tasksDescription({ itemKinds: ['asset'], phases: [{ id: 'p2', name: 'B' }, { id: 'p1', name: 'A' }] })
  const rows = [
    { id: 1, title: 'b', phase_id: 'p1', start_date: '2026-01-02' },
    { id: 2, title: 'a', phase_id: 'p2', start_date: '2026-01-03' },
    { id: 3, title: 'c', phase_id: 'p2', start_date: '2026-01-01' },
  ]
  it('several sorts in order, each breaking the previous one\'s ties; Phase by the project\'s phases', () => {
    expect(applyViewSorts(rows, [{ field: 'phase_id', dir: 'asc' }, { field: 'start_date', dir: 'asc' }], d).map(r => r.id)).toEqual([3, 2, 1])
    expect(applyViewSorts(rows, [{ field: 'phase_id', dir: 'asc' }, { field: 'start_date', dir: 'desc' }], d).map(r => r.id)).toEqual([2, 3, 1])
    // CONTROL: no sort keeps the order.
    expect(applyViewSorts(rows, [], d).map(r => r.id)).toEqual([1, 2, 3])
  })
  it('the toolbar\'s Sort sets the first: a field used later moves to the front; Sort… takes the first away', () => {
    const s = [{ field: 'title', dir: 'desc' }, { field: 'start_date', dir: 'asc' }]
    // Start, used second, replaces the first (Title) and leaves its later place.
    expect(withFirstSort(s, 'start_date')).toEqual([{ field: 'start_date', dir: 'desc' }])
    expect(withFirstSort(s, 'status')).toEqual([{ field: 'status', dir: 'desc' }, { field: 'start_date', dir: 'asc' }])
    expect(withFirstSort(s, '')).toEqual([{ field: 'start_date', dir: 'asc' }])
    expect(withFirstSortReversed(s)[0]).toEqual({ field: 'title', dir: 'asc' })
    expect(moveItem(s, 1, -1).map(x => x.field)).toEqual(['start_date', 'title'])
  })
})

describe('a change is only what changes the table (the bar, design §4.4)', () => {
  const fx = { tableKey: 'tasks', fieldKeys: KEYS, fixed }
  const base = defaultViewConfig('tasks')
  it('an empty filter row, a field list equal to the default and key order change nothing', () => {
    expect(sameEffect({ ...base, filters: [{ field: 'status', op: 'is', values: [] }] }, base, fx)).toBe(true)
    expect(sameEffect({ ...base, fields: KEYS.slice(1).map(k => ({ key: k, visible: true })) }, base, fx)).toBe(true)
    expect(sameEffect({ ...base, filters: [{ field: 'status', op: 'is', values: ['a', 'b'] }] }, { ...base, filters: [{ field: 'status', op: 'is', values: ['b', 'a'] }] }, fx)).toBe(true)
  })
  it('CONTROLS: a complete filter, a sort, a grouping, its switch, the layout, a hidden field, the key dates do', () => {
    expect(sameEffect({ ...base, filters: [{ field: 'status', op: 'is', values: ['final'] }] }, base, fx)).toBe(false)
    expect(sameEffect({ ...base, sorts: [{ field: 'title', dir: 'asc' }] }, base, fx)).toBe(false)
    expect(sameEffect({ ...base, group: { field: 'status', hideEmpty: false } }, base, fx)).toBe(false)
    expect(sameEffect({ ...base, group: { field: 'status', hideEmpty: true } }, { ...base, group: { field: 'status', hideEmpty: false } }, fx)).toBe(false)
    expect(sameEffect({ ...base, layout: 'board' }, base, fx)).toBe(false)
    expect(sameEffect({ ...base, fields: [{ key: 'status', visible: false }] }, base, fx)).toBe(false)
    expect(sameEffect({ ...base, keyDates: false }, base, fx)).toBe(false)
  })
})

describe('the summaries (design §4.2)', () => {
  const d = tasksDescription({ itemKinds: ['asset'] })
  it('Filters, Sort, Group and Fields read as the design writes them', () => {
    const c = { ...defaultViewConfig('tasks'), filters: [{ field: 'status', op: 'is', values: ['x'] }, { field: 'title', op: 'contains', values: [] }] }
    expect(filtersSummary(c)).toBe('1 filter')
    expect(filtersSummary(defaultViewConfig('tasks'))).toBe('None')
    expect(sortSummary({ sorts: [{ field: 'phase_id', dir: 'asc' }, { field: 'start_date', dir: 'asc' }] }, d)).toBe('Phase, then Start')
    expect(sortSummary({ sorts: [] }, d)).toBe('Default order')
    expect(groupSummary({ layout: 'table', group: { field: 'status' } }, d)).toBe('By status')
    expect(groupSummary({ layout: 'table', group: null }, d)).toBe('None')
    expect(groupSummary({ layout: 'board', board: { field: 'status' } }, d)).toBe('Columns by status')
    expect(fieldsSummary([{ visible: true }, { visible: false }, { visible: true }])).toBe('2 of 3 shown')
  })
})

describe('the bar\'s ten rows (design §4.4), derived', () => {
  const on = { name: 'Shoot week', ownChange: true, canWrite: true, available: true }
  it('no change of one\'s own: no bar (her Q-A3)', () => {
    expect(barStateOf({ ...on, ownChange: false })).toBe(null)
  })
  it('a change of one\'s own; on All; for a seat that cannot write; on a backend without views', () => {
    expect(barStateOf(on)).toMatchObject({ tone: 'info', words: 'Shoot week: changed for now', actions: ['reset', 'saveAsNew', 'save'] })
    expect(barStateOf({ ...on, isAll: true, name: 'All' })).toMatchObject({ words: 'All: changed for now', actions: ['reset', 'saveAsNew'] })
    expect(barStateOf({ ...on, canWrite: false })).toMatchObject({ words: `Shoot week: changed for now. ${BAR_WORDS.cannotWrite}`, actions: ['reset'] })
    expect(barStateOf({ ...on, available: false })).toMatchObject({ words: BAR_WORDS.unavailable, actions: ['reset'] })
  })
  it('a teammate saved meanwhile, by name; the same person in another window; another computer — Save asks first (Q-G3)', () => {
    const moved = { ...on, moved: true, me: 'u1' }
    expect(barStateOf({ ...moved, revisedBy: 'u2', whoName: 'Mara' })).toMatchObject({ words: 'Mara changed Shoot week. Your changes are still on screen.', actions: ['reset', 'saveAsNew', 'save'], asks: true })
    expect(barStateOf({ ...moved, revisedBy: 'u2', whoName: null }).words).toBe('Someone changed Shoot week. Your changes are still on screen.')
    expect(barStateOf({ ...moved, revisedBy: 'u1' }).words).toBe('You changed Shoot week in another window. Your changes here are still on screen.')
    expect(barStateOf({ ...moved, revisedBy: null }).words).toBe('Shoot week was changed on another computer. Your changes are still on screen.')
    // CONTROL: not moved, Save does not ask.
    expect(barStateOf(on).asks).toBeUndefined()
  })
  it('deleted meanwhile; may no longer change views; a save that failed; a newer WILSON\'s view', () => {
    expect(barStateOf({ ...on, deleted: true })).toMatchObject({ words: 'Shoot week was deleted. Your changes are still on screen.', actions: ['reset', 'saveAsNew'] })
    expect(barStateOf({ ...on, refusal: { kind: 'filtered' } })).toMatchObject({ tone: 'danger', words: BAR_WORDS.gate, actions: ['reset', 'saveAsNew'], disabled: { saveAsNew: BAR_WORDS.gate } })
    expect(barStateOf({ ...on, refusal: { kind: 'failed', reason: 'Network down.' } })).toMatchObject({ tone: 'danger', words: 'Shoot week could not be saved: Network down.', actions: ['retry', 'reset'] })
    expect(barStateOf({ ...on, newer: true }).disabled).toEqual({ save: BAR_WORDS.newer })
  })
  it('code review round 1, R1-7: a newer WILSON\'s view says why Save is greyed in the words too; CONTROL: not newer, it does not', () => {
    expect(barStateOf({ ...on, newer: true }).words).toBe(`Shoot week: changed for now ${BAR_WORDS.newer}`)
    expect(barStateOf({ ...on, newer: true, moved: true, revisedBy: 'u2', whoName: 'Mara' }).words).toContain(BAR_WORDS.newer)
    expect(barStateOf(on).words).not.toContain(BAR_WORDS.newer)
  })
})

describe('code review round 1, R1-4: dragging a field or a sort to another\'s place', () => {
  it('moveFieldTo: the field takes the target\'s place; the name never moves and nothing goes before it', async () => {
    const { moveFieldTo, moveItemTo } = await import('./viewScreenModel')
    const def = effectiveFields([], KEYS, { fixed })
    expect(moveFieldTo(def, 'assignee_id', 'status').map(f => f.key)).toEqual(['title', 'assignee_id', 'status', 'priority', 'asset', 'phase_id'])
    expect(moveFieldTo(def, 'status', 'title').map(f => f.key)).toEqual(KEYS)
    expect(moveFieldTo(def, 'title', 'asset').map(f => f.key)).toEqual(KEYS)
    expect(moveItemTo(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    expect(moveItemTo(['a', 'b'], 0, 5)).toEqual(['a', 'b'])
  })
})

describe('the view on screen (design §4.5)', () => {
  const views = [{ id: 'v1', name: 'Shoot week' }, { id: 'v2', name: 'Props' }]
  it('the change for now\'s view first; else the last used one while the map is ready; else All', () => {
    expect(viewOnScreen({ draft: { viewId: 'v2' }, views, lastStatus: 'ready', lastId: 'v1' }).id).toBe('v2')
    expect(viewOnScreen({ views, lastStatus: 'ready', lastId: 'v1' }).id).toBe('v1')
    expect(viewOnScreen({ views, lastStatus: 'failed', lastId: 'v1' }).id).toBe('all')
    expect(viewOnScreen({ views, lastStatus: 'unavailable', lastId: 'v1' }).id).toBe('all')
  })
  it('the map not answered yet: waiting (the Loading line); a last used view deleted since: All, quietly', () => {
    expect(viewOnScreen({ views, lastStatus: 'loading' })).toMatchObject({ id: 'all', waiting: true })
    expect(viewOnScreen({ views, lastStatus: 'ready', lastId: 'gone' })).toMatchObject({ id: 'all', deleted: false })
  })
  it('the change for now\'s view deleted since: kept, said deleted (the bar says so)', () => {
    expect(viewOnScreen({ draft: { viewId: 'gone' }, views })).toMatchObject({ id: 'gone', row: null, deleted: true })
  })
  it('copyName stays within 80 characters', () => {
    expect(copyName('Shoot week')).toBe('Shoot week copy')
    expect([...copyName('x'.repeat(80))].length).toBe(80)
  })
})
