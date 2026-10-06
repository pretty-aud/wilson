// Post-overhaul S3c, steps 3, 4 and 6: the cut on screen and the draft's
// changes (editModel.js). D6, D13, D14, D16, D17, D20.
import { describe, it, expect } from 'vitest'
import {
  cutRows, cutBands, cutTotals, draftName, labelled, bandAt,
  moveItemTo, moveBandTo, stepItem, stepBand, duplicateItem, removeItem, insertAfter, itemsForShots,
  duplicateBand, removeBand, dropOnCut, dropOnList,
} from './editModel'

const it_ = (id, scene, shot, label = shot) => ({ id, scene_id: scene, shot_id: shot, label, notes: '' })
// The cut: A1 A2 | B1 | A3 — scene A comes back after B (two bands for A).
const ITEMS = [it_('x1', 'A', 'a1'), it_('x2', 'A', 'a2'), it_('x3', 'B', 'b1'), it_('x4', 'A', 'a3')]
const SHOTS = {
  a1: { id: 'a1', scene_id: 'A', name: 'SC001_SH010', frame_count: 24 },
  a2: { id: 'a2', scene_id: 'A', name: 'SC001_SH020', frame_count: 48 },
  a3: { id: 'a3', scene_id: 'A', name: 'SC001_SH030', frame_count: 12 },
  b1: { id: 'b1', scene_id: 'B', name: 'SC002_SH010', frame_count: 100 },
}
const SCENES = { A: { id: 'A', name: 'Harbour' }, B: { id: 'B', name: 'Lighthouse' } }
const shotById = (id) => SHOTS[id] || null
const sceneById = (id) => SCENES[id] || null
const ids = (items) => items.map(i => i.id)
let n = 0
const newId = () => `new-${++n}`

describe('the cut on screen (step 3, D17, D20)', () => {
  it('rows resolve each item; a repeated shot is two rows; the bands follow the cut, a scene coming back as a second band', () => {
    const items = [...ITEMS, it_('x5', 'A', 'a3')]
    const rows = cutRows({ items, shotById, sceneById })
    expect(rows.map(r => r.name)).toEqual(['SC001_SH010', 'SC001_SH020', 'SC002_SH010', 'SC001_SH030', 'SC001_SH030'])
    const bands = cutBands(rows)
    expect(bands.map(b => [b.label, b.start, b.end])).toEqual([['Harbour', 0, 1], ['Lighthouse', 2, 2], ['Harbour', 3, 4]])
  })
  it('a shot deleted from the project is "Missing shot: <last-known name>" — the saved snapshot\'s name first, else the item\'s label', () => {
    const items = [it_('x1', 'A', 'gone', 'From the label'), it_('x2', 'A', 'gone2', 'Label two')]
    const snapshot = { shots: { gone: { name: 'From the snapshot' } } }
    const rows = cutRows({ items, shotById, sceneById, snapshot })
    expect(rows.map(r => [r.missing, r.name, r.frames])).toEqual([
      [true, 'Missing shot: From the snapshot', 0],
      [true, 'Missing shot: Label two', 0],
    ])
  })
  it('a band whose scene is gone says so, with the snapshot\'s name when there is one; items in no scene form their own band', () => {
    const rows = cutRows({ items: [it_('x1', 'Z', 'a1'), it_('x2', null, 'a2')], shotById, sceneById })
    expect(cutBands(rows, { snapshot: { scenes: { Z: { name: 'Pier' } } } }).map(b => b.label)).toEqual(['Missing scene: Pier', 'Shots without a scene'])
    expect(cutBands(rows).map(b => b.label)).toEqual(['Missing scene', 'Shots without a scene'])
  })
  it('D20: the totals count each item in order — repeats included, missing excluded — and distinct scenes', () => {
    const items = [...ITEMS, it_('x5', 'A', 'a1'), it_('x6', 'B', 'gone')]
    const t = cutTotals(cutRows({ items, shotById, sceneById }))
    expect(t).toEqual({ frames: 24 + 48 + 100 + 12 + 24, shots: 5, scenes: 2 })
  })
})

describe('what a draft is called (D13, D14)', () => {
  const list = { id: 'L1', title: 'Shoot' }
  it('the list\'s title at v1 when the list has no edit yet', () => {
    expect(draftName({ edits: [], list })).toEqual({ title: 'Shoot', version: 1 })
  })
  it('the chain\'s latest edit\'s title, at its next version — whichever edit is on screen', () => {
    const edits = [
      { id: 'e1', shot_list_id: 'L1', title: "Director's cut", version: 1, parent_edit_id: null, created_at: '2026-09-01' },
      { id: 'e2', shot_list_id: 'L1', title: "Director's cut", version: 2, parent_edit_id: 'e1', created_at: '2026-09-02' },
      { id: 'o1', shot_list_id: 'L2', title: "Director's cut", version: 7, parent_edit_id: null, created_at: '2026-09-03' },
    ]
    expect(draftName({ edits, list })).toEqual({ title: "Director's cut", version: 3 })
  })
  it('labelled refreshes each item\'s label to its shot\'s name; a missing shot keeps its label', () => {
    expect(labelled([it_('x1', 'A', 'a1', 'old'), it_('x2', 'A', 'gone', 'kept')], shotById).map(i => i.label)).toEqual(['SC001_SH010', 'kept'])
  })
})

describe('the draft\'s changes (D16)', () => {
  it('bandAt finds the run an item sits in', () => {
    expect(bandAt(ITEMS, 1)).toEqual({ start: 0, end: 1, sceneId: 'A' })
    expect(bandAt(ITEMS, 2)).toEqual({ start: 2, end: 2, sceneId: 'B' })
    expect(bandAt(ITEMS, 9)).toBeNull()
  })
  it('a shot moved within its scene keeps its scene', () => {
    const next = moveItemTo(ITEMS, 'x2', 'x1', 'before')
    expect(ids(next)).toEqual(['x2', 'x1', 'x3', 'x4'])
    expect(next[0].scene_id).toBe('A')
  })
  it('a shot moved into another scene\'s block joins it (its own name and row are untouched)', () => {
    const next = moveItemTo(ITEMS, 'x1', 'x3', 'after')
    expect(ids(next)).toEqual(['x2', 'x3', 'x1', 'x4'])
    expect(next[2]).toEqual({ ...ITEMS[0], scene_id: 'B' })
    expect(ITEMS[0].scene_id).toBe('A') // the input is untouched
  })
  it('a move onto itself, or one that changes nothing, is null', () => {
    expect(moveItemTo(ITEMS, 'x1', 'x1')).toBeNull()
    expect(moveItemTo(ITEMS, 'x1', 'x2', 'before')).toBeNull()
  })
  it('a band moves whole, its items keeping their scene; onto itself it is null', () => {
    const next = moveBandTo(ITEMS, 0, 1, 3, 'after')
    expect(ids(next)).toEqual(['x3', 'x4', 'x1', 'x2'])
    expect(next.map(i => i.scene_id)).toEqual(['B', 'A', 'A', 'A'])
    expect(moveBandTo(ITEMS, 0, 1, 1, 'after')).toBeNull()
  })
  it('Move up / Move down swap inside a band, cross a band\'s edge into the neighbour\'s scene, and stop at the cut\'s ends', () => {
    expect(ids(stepItem(ITEMS, 'x2', -1))).toEqual(['x2', 'x1', 'x3', 'x4'])
    const crossed = stepItem(ITEMS, 'x3', -1)
    expect(ids(crossed)).toEqual(['x1', 'x2', 'x3', 'x4'])
    expect(crossed[2].scene_id).toBe('A')
    expect(stepItem(ITEMS, 'x1', -1)).toBeNull()
    expect(stepItem(ITEMS, 'x4', 1)).toBeNull()
  })
  it('a band steps past its neighbour', () => {
    expect(ids(stepBand(ITEMS, 2, 2, -1))).toEqual(['x3', 'x1', 'x2', 'x4'])
    expect(ids(stepBand(ITEMS, 0, 1, 1))).toEqual(['x3', 'x1', 'x2', 'x4'])
    expect(stepBand(ITEMS, 0, 1, -1)).toBeNull()
    expect(stepBand(ITEMS, 3, 3, 1)).toBeNull()
  })
  it('duplicate puts a repeat right after it, with its own id; remove takes one item out', () => {
    const dup = duplicateItem(ITEMS, 'x2', newId)
    expect(dup.map(i => i.shot_id)).toEqual(['a1', 'a2', 'a2', 'b1', 'a3'])
    expect(new Set(ids(dup)).size).toBe(5)
    expect(ids(removeItem(ITEMS, 'x3'))).toEqual(['x1', 'x2', 'x4'])
  })
  it('new items go after the item named, or at the end; each added shot sits in its own scene', () => {
    const add = itemsForShots([SHOTS.b1], newId)
    expect(add[0]).toMatchObject({ scene_id: 'B', shot_id: 'b1', label: 'SC002_SH010' })
    expect(insertAfter(ITEMS, 'x1', add).map(i => i.shot_id)).toEqual(['a1', 'b1', 'a2', 'b1', 'a3'])
    expect(insertAfter(ITEMS, null, add).map(i => i.shot_id)).toEqual(['a1', 'a2', 'b1', 'a3', 'b1'])
    expect(insertAfter(ITEMS, 'x1', [])).toBeNull()
  })
  it('shots added INTO a block join it (as a moved shot does); null is the no-scene block', () => {
    const add = itemsForShots([SHOTS.b1, SHOTS.a1], newId, { sceneId: 'A' })
    expect(add.map(i => i.scene_id)).toEqual(['A', 'A'])
    expect(itemsForShots([SHOTS.b1], newId, { sceneId: null })[0].scene_id).toBeNull()
    // Added after x1, inside the first Harbour band: the band stays one band.
    const rows = cutRows({ items: insertAfter(ITEMS, 'x1', add), shotById, sceneById })
    expect(cutBands(rows).map(b => [b.label, b.rows.length])).toEqual([['Harbour', 4], ['Lighthouse', 1], ['Harbour', 1]])
  })
  it('a scene block repeats right after itself with new ids, or leaves the cut whole', () => {
    const dup = duplicateBand(ITEMS, 0, 1, newId)
    expect(dup.map(i => i.shot_id)).toEqual(['a1', 'a2', 'a1', 'a2', 'b1', 'a3'])
    expect(dup.map(i => i.scene_id)).toEqual(['A', 'A', 'A', 'A', 'B', 'A'])
    expect(new Set(ids(dup)).size).toBe(6)
    expect(ids(removeBand(ITEMS, 0, 1))).toEqual(['x3', 'x4'])
    expect(removeBand(ITEMS, 2, 9)).toBeNull()
    expect(duplicateBand(ITEMS, 3, 2, newId)).toBeNull()
  })
})

describe('a drop, as a change (step 6, D16)', () => {
  it('on a cut: an item lands before or after an item, joining its block; onto a block, at its top', () => {
    expect(ids(dropOnCut(ITEMS, { kind: 'item', id: 'x4' }, { kind: 'item', id: 'x1' }, 'before'))).toEqual(['x4', 'x1', 'x2', 'x3'])
    const after = dropOnCut(ITEMS, { kind: 'item', id: 'x1' }, { kind: 'item', id: 'x3' }, 'after')
    expect(ids(after)).toEqual(['x2', 'x3', 'x1', 'x4'])
    expect(after[2].scene_id).toBe('B')
    const top = dropOnCut(ITEMS, { kind: 'item', id: 'x4' }, { kind: 'band', id: 'x3' }, 'after')
    expect(ids(top)).toEqual(['x1', 'x2', 'x4', 'x3'])
    expect(top[2].scene_id).toBe('B')
  })
  it('on a cut: a block moves whole (named by its first item); onto itself, or a block onto an item, nothing', () => {
    expect(ids(dropOnCut(ITEMS, { kind: 'band', id: 'x1' }, { kind: 'band', id: 'x3' }, 'after'))).toEqual(['x3', 'x1', 'x2', 'x4'])
    expect(ids(dropOnCut(ITEMS, { kind: 'band', id: 'x4' }, { kind: 'band', id: 'x1' }, 'before'))).toEqual(['x4', 'x1', 'x2', 'x3'])
    expect(dropOnCut(ITEMS, { kind: 'band', id: 'x1' }, { kind: 'band', id: 'x1' }, 'after')).toBeNull()
    expect(dropOnCut(ITEMS, { kind: 'band', id: 'x1' }, { kind: 'item', id: 'x3' }, 'after')).toBeNull()
  })
  // The list's string-out: Harbour (a1, a2), Lighthouse (b1), Pier (empty: no block).
  const OUT = [it_('s1', 'A', 'a1'), it_('s2', 'A', 'a2'), it_('s3', 'B', 'b1')]
  it('on the list: a shot before or after a shot, or to the top of a scene\'s block, in the string-out', () => {
    expect(dropOnList(OUT, { kind: 'shot', id: 'b1' }, { kind: 'shot', id: 'a2' }, 'before').map(i => i.shot_id)).toEqual(['a1', 'b1', 'a2'])
    const top = dropOnList(OUT, { kind: 'shot', id: 'a2' }, { kind: 'scene', id: 'B' }, 'after')
    expect(top.map(i => [i.shot_id, i.scene_id])).toEqual([['a1', 'A'], ['a2', 'B'], ['b1', 'B']])
  })
  it('on the list: a scene\'s block before or after another\'s; a scene with no shot is no block, and changes nothing', () => {
    expect(dropOnList(OUT, { kind: 'scene', id: 'B' }, { kind: 'scene', id: 'A' }, 'before').map(i => i.shot_id)).toEqual(['b1', 'a1', 'a2'])
    expect(dropOnList(OUT, { kind: 'scene', id: 'A' }, { kind: 'scene', id: 'B' }, 'after').map(i => i.shot_id)).toEqual(['b1', 'a1', 'a2'])
    expect(dropOnList(OUT, { kind: 'shot', id: 'a1' }, { kind: 'scene', id: 'P' }, 'after')).toBeNull()
    expect(dropOnList(OUT, { kind: 'scene', id: 'P' }, { kind: 'scene', id: 'A' }, 'before')).toBeNull()
    expect(dropOnList(OUT, { kind: 'scene', id: 'A' }, { kind: 'shot', id: 'b1' }, 'before')).toBeNull()
  })
})
