// editDrafts.test.js — the unsaved edit's pure store (post-overhaul S3c, step 4).
import { describe, it, expect } from 'vitest'
import {
  EDIT_DRAFTS_KEY, DRAFT_HISTORY_CAP, draftKey, storedDraftKey, startDraft, changeDraft, undoDraft, redoDraft,
  storedCopy, draftFromCopy, readStoredDrafts, writeStoredDraft,
} from './editDrafts'

const item = (id, shot, scene = 'sc1') => ({ id, scene_id: scene, shot_id: shot, label: shot, notes: '' })
const A = [item('a', 'sh1'), item('b', 'sh2')]
const B = [item('b', 'sh2'), item('a', 'sh1')]
const C = [item('b', 'sh2')]

function memoryStorage() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    raw: m,
  }
}

const start = () => startDraft({ projectId: 'p1', listId: 'L1', basedOnEditId: 'e1', title: 'Cut', version: 3, base: A, items: B, now: 't1' })

describe('the draft (D13)', () => {
  it('starts from what was on screen with the first change applied, dirty, its undo going back to the start', () => {
    const d = start()
    expect(d).toMatchObject({ projectId: 'p1', listId: 'L1', basedOnEditId: 'e1', title: 'Cut', version: 3, dirty: true, changedAt: 't1' })
    expect(d.items.map(i => i.id)).toEqual(['b', 'a'])
    expect(d.base.map(i => i.id)).toEqual(['a', 'b'])
    const u = undoDraft(d, 't2')
    expect(u.items.map(i => i.id)).toEqual(['a', 'b'])
    // Taken back to where it started, it is still a draft: unsaved until Save
    // edit or Discard changes (no second question, D13).
    expect(u.dirty).toBe(true)
    expect(undoDraft(u, 't3')).toBeNull()
  })

  it('a change pushes one undo step and clears the redo; undo and redo walk them in order', () => {
    let d = changeDraft(start(), C, 't2')
    expect(d.items.map(i => i.id)).toEqual(['b'])
    d = undoDraft(d, 't3')
    expect(d.items.map(i => i.id)).toEqual(['b', 'a'])
    d = redoDraft(d, 't4')
    expect(d.items.map(i => i.id)).toEqual(['b'])
    expect(redoDraft(d, 't5')).toBeNull()
    d = undoDraft(d, 't6')
    d = changeDraft(d, A, 't7')
    expect(redoDraft(d, 't8')).toBeNull()
  })

  it('keeps at most DRAFT_HISTORY_CAP undo steps (the oldest go)', () => {
    let d = start()
    for (let i = 0; i < DRAFT_HISTORY_CAP + 5; i += 1) d = changeDraft(d, i % 2 ? A : C, `t${i}`)
    expect(d.past).toHaveLength(DRAFT_HISTORY_CAP)
  })

  it('never shares an item object with what it was given (a later edit of the source cannot reach it)', () => {
    const base = [item('a', 'sh1')]
    const d = startDraft({ projectId: 'p1', listId: 'L1', title: 'T', version: 1, base, items: base, now: 't' })
    base[0].shot_id = 'changed'
    expect(d.items[0].shot_id).toBe('sh1')
    expect(d.base[0].shot_id).toBe('sh1')
    expect(d.basedOnEditId).toBeNull()
  })

  it('is keyed by project and list; its stored copy by person, project and list', () => {
    expect(draftKey('p1', 'L1')).toBe('p1|L1')
    expect(storedDraftKey('u1', 'p1', 'L1')).toBe('u1|p1|L1')
    expect(storedDraftKey(null, 'p1', 'L1')).toBe('local|p1|L1')
  })
})

describe('the stored copy ("Recover unsaved edit?")', () => {
  it('holds what the draft needs — not its undo stacks — and comes back as a dirty draft with an empty undo', () => {
    const d = changeDraft(start(), C, 't2')
    const copy = storedCopy(d, 'u1')
    expect(copy).toEqual({ personKey: 'u1', projectId: 'p1', listId: 'L1', basedOnEditId: 'e1', title: 'Cut', version: 3, base: d.base, items: d.items, changedAt: 't2', made: [] })
    expect(copy.past).toBeUndefined()
    const back = draftFromCopy(JSON.parse(JSON.stringify(copy)))
    expect(back).toMatchObject({ projectId: 'p1', listId: 'L1', basedOnEditId: 'e1', title: 'Cut', version: 3, dirty: true, past: [], future: [], made: [] })
    expect(back.items.map(i => i.id)).toEqual(['b'])
  })

  // Review round 1 (R1-04): the shots New shot wrote to the list for a draft
  // are kept on it — through its changes, its undo, its stored copy — so
  // Discard changes can say they stay.
  it('keeps the shots it wrote (made) through changes, undo and redo, and in its stored copy', () => {
    const first = startDraft({ projectId: 'p1', listId: 'L1', title: 'Cut', version: 1, base: A, items: B, now: 't0', made: ['s9'] })
    expect(first.made).toEqual(['s9'])
    const second = changeDraft(first, C, 't1', ['s10'])
    expect(second.made).toEqual(['s9', 's10'])
    expect(changeDraft(second, A, 't2').made).toEqual(['s9', 's10'])
    expect(undoDraft(second, 't3').made).toEqual(['s9', 's10'])
    expect(redoDraft(undoDraft(second, 't3'), 't4').made).toEqual(['s9', 's10'])
    expect(storedCopy(second, 'u1').made).toEqual(['s9', 's10'])
    expect(draftFromCopy({ ...storedCopy(second, 'u1') }).made).toEqual(['s9', 's10'])
    // A copy from before this field reads as none.
    const { made: _gone, ...older } = storedCopy(second, 'u1')
    expect(draftFromCopy(older).made).toEqual([])
  })

  it('is written and removed one key at a time; the key goes when the last copy does', () => {
    const s = memoryStorage()
    writeStoredDraft('u1|p1|L1', storedCopy(start(), 'u1'), s)
    writeStoredDraft('u1|p1|L2', { ...storedCopy(start(), 'u1'), listId: 'L2' }, s)
    expect(Object.keys(readStoredDrafts(s)).sort()).toEqual(['u1|p1|L1', 'u1|p1|L2'])
    writeStoredDraft('u1|p1|L1', null, s)
    expect(Object.keys(readStoredDrafts(s))).toEqual(['u1|p1|L2'])
    writeStoredDraft('u1|p1|L2', null, s)
    expect(s.raw.has(EDIT_DRAFTS_KEY)).toBe(false)
  })

  it('reads nothing from garbage, and drops a copy that names no list or holds no items', () => {
    const s = memoryStorage()
    s.setItem(EDIT_DRAFTS_KEY, 'not json')
    expect(readStoredDrafts(s)).toEqual({})
    s.setItem(EDIT_DRAFTS_KEY, JSON.stringify([1, 2]))
    expect(readStoredDrafts(s)).toEqual({})
    s.setItem(EDIT_DRAFTS_KEY, JSON.stringify({ a: { projectId: 'p1', title: 'T', items: [] }, b: { projectId: 'p1', listId: 'L1', title: 'T', items: 'x' }, c: storedCopy(start(), 'u1') }))
    expect(Object.keys(readStoredDrafts(s))).toEqual(['c'])
  })

  it('a storage that refuses is not an error (the draft lives on in memory)', () => {
    const refusing = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') }, removeItem: () => { throw new Error('denied') } }
    expect(readStoredDrafts(refusing)).toEqual({})
    expect(() => writeStoredDraft('k', storedCopy(start(), 'u1'), refusing)).not.toThrow()
  })
})
