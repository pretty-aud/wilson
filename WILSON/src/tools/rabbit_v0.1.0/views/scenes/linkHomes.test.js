// Post-overhaul S3c, step 1: which shot list holds a linked scene or shot,
// and which edits use it (linkHomes.js) — the words LinkHome prints beside a
// name and every dense row carries in its tooltip.
import { describe, it, expect } from 'vitest'
import { homeIndex, homeIndexOf, pickerRows, otherListRows, NO_LIST_WORDS } from './linkHomes'

const L = (id, title, version, extra = {}) => ({ id, title, version, created_at: `2026-09-0${version}T00:00:00Z`, archived_at: null, ...extra })
const item = (id, listId, ref) => ({ id, shot_list_id: listId, position: 0, scene_id: null, shot_id: null, ...ref })

// Shoot · v2 (active) holds scene A and shots a1, a2; Pickups · v1 holds
// shot a2 (so, implied, scene A) and scene B with b1; an archived list holds
// b2; one live edit of Shoot uses a1 twice and a2; an archived edit uses b1.
const shots = [
  { id: 'a1', scene_id: 'A', name: 'SC001_SH010' },
  { id: 'a2', scene_id: 'A', name: 'SC001_SH020' },
  { id: 'b1', scene_id: 'B', name: 'SC002_SH010' },
  { id: 'b2', scene_id: 'B', name: 'SC002_SH020' },
  { id: 'c1', scene_id: null, name: 'Loose' },
]
const shotLists = [
  L('shoot', 'Shoot', 2),
  L('pick', 'Pickups', 1),
  L('old', 'Old', 1, { archived_at: '2026-09-20T00:00:00Z' }),
]
const shotListItems = [
  item('i1', 'shoot', { scene_id: 'A' }),
  item('i2', 'shoot', { shot_id: 'a1' }),
  item('i3', 'shoot', { shot_id: 'a2' }),
  item('i4', 'pick', { shot_id: 'a2' }),
  item('i5', 'pick', { scene_id: 'B' }),
  item('i6', 'pick', { shot_id: 'b1' }),
  item('i7', 'old', { shot_id: 'b2' }),
]
const edits = [
  { id: 'e1', shot_list_id: 'shoot', title: "Director's cut", version: 3, created_at: '2026-09-10T00:00:00Z', archived_at: null,
    items: [{ id: 'x1', scene_id: 'A', shot_id: 'a1' }, { id: 'x2', scene_id: 'A', shot_id: 'a1' }, { id: 'x3', scene_id: 'A', shot_id: 'a2' }] },
  { id: 'e0', shot_list_id: 'pick', title: 'Gone', version: 1, created_at: '2026-09-09T00:00:00Z', archived_at: '2026-09-11T00:00:00Z',
    items: [{ id: 'y1', scene_id: 'B', shot_id: 'b1' }] },
]
const index = homeIndex({ shotLists, shotListItems, shots, edits, activeId: 'shoot' })

describe('homeIndex: a row\'s lists and edits (S3c step 1, D10, Audrey\'s "clearly indicate")', () => {
  it('a shot in the active list and another: the active one leads, "+N" counts the other list and the edit', () => {
    const h = index('a2')
    expect(h.lists.map(l => l.id)).toEqual(['shoot', 'pick'])
    expect(h.primary).toBe('Shoot · v2')
    expect(h.edits.map(e => e.id)).toEqual(['e1'])
    expect(h.more).toBe(2)
    expect(h.title('SC001_SH020')).toBe("SC001_SH020\nIn: Shoot · v2 (active), Pickups · v1\nEdits: Director's cut · v3 (Shoot · v2)")
  })
  it('a shot only ANOTHER list holds names that list — the link the active-list tabs used to drop', () => {
    const h = index('b1')
    expect(h.primary).toBe('Pickups · v1')
    // The archived edit that used it is not counted, nor named.
    expect(h.edits).toEqual([])
    expect(h.more).toBe(0)
    expect(h.title('SC002_SH010')).toBe('SC002_SH010\nIn: Pickups · v1')
  })
  it('a scene is held through its own item or one of its shots\' (S3a\'s rule), and an edit uses it through its items\' scene', () => {
    const a = index('A')
    expect(a.lists.map(l => l.id)).toEqual(['shoot', 'pick'])
    expect(a.edits.map(e => e.id)).toEqual(['e1'])
    expect(index('B').lists.map(l => l.id)).toEqual(['pick'])
  })
  it('an archived list is no home: a shot only it holds reads "In no shot list", with no label', () => {
    const h = index('b2')
    expect(h.lists).toEqual([])
    expect(h.primary).toBeNull()
    expect(h.title('SC002_SH020')).toBe(`SC002_SH020\n${NO_LIST_WORDS}`)
  })
  it('a repeated shot counts its edit once', () => {
    expect(index('a1').edits).toHaveLength(1)
    expect(index('a1').more).toBe(1)
  })
  it('the tooltip without a name starts at the lists (what a screen reader is told)', () => {
    expect(index('a2').title(null).split('\n')[0]).toBe('In: Shoot · v2 (active), Pickups · v1')
  })
  it('homeIndexOf reads ctx\'s rows — every shot (allShots), not the active list\'s', () => {
    const ctx = { shotLists, shotListItems, allShots: shots, shots: shots.slice(0, 2), edits, project: { active_shot_list_id: 'shoot' } }
    expect(homeIndexOf(ctx)('A').lists.map(l => l.id)).toEqual(['shoot', 'pick'])
    // CONTROL: fed only the active list's shots, scene B's implied home is still its own item; scene A's second
    // home (Pickups, through a2) needs a2 among the shots — so the index must read every row.
    expect(homeIndex({ shotLists, shotListItems, shots: [], edits, activeId: 'shoot' })('A').lists.map(l => l.id)).toEqual(['shoot'])
    expect(homeIndexOf(null)('a1').title('x')).toBe(`x\n${NO_LIST_WORDS}`)
  })
})

describe('pickerRows / otherListRows: the active list by default, every row on "Show all lists" (S3c step 1)', () => {
  const active = [{ id: 'a1' }, { id: 'a2' }]
  const all = [...active, { id: 'b1' }, { id: 'b2' }]
  it('the active list\'s rows by default, in their order', () => {
    expect(pickerRows({ active, all, showAll: false }).map(r => r.id)).toEqual(['a1', 'a2'])
  })
  it('the row already linked is offered even when only another list holds it (a select must never read empty)', () => {
    expect(pickerRows({ active, all, showAll: false, keep: 'b1' }).map(r => r.id)).toEqual(['a1', 'a2', 'b1'])
    expect(pickerRows({ active, all, showAll: false, keep: ['b2', 'a1', null] }).map(r => r.id)).toEqual(['a1', 'a2', 'b2'])
  })
  it('every row with the switch on', () => {
    expect(pickerRows({ active, all, showAll: true }).map(r => r.id)).toEqual(['a1', 'a2', 'b1', 'b2'])
  })
  it('the switch is offered only when it would add something', () => {
    expect(otherListRows({ active, all })).toBe(true)
    expect(otherListRows({ active: all, all })).toBe(false)
  })
})
