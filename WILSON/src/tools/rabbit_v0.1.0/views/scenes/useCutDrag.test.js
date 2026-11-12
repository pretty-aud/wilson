// useCutDrag.test.js — what may land where, and which half (S3c step 6, D16).
import { describe, it, expect } from 'vitest'
import { dropAllowed, dropWhere, blockLine, dropTarget } from './useCutDrag'

// Review round 1 (R1-07): a block (or a list's scene) dropped AFTER a block
// lands after that block's last row, so the line is drawn there, not under
// the heading — while the block shows rows; a shot onto a block is its top.
describe('blockLine: where a block\'s drop line is drawn', () => {
  it('a block after a block, rows showing: under the last row, not the heading', () => {
    expect(blockLine({ where: 'after', drag: 'band' }, 'band', true)).toEqual({ head: undefined, lastRow: 'after' })
    expect(blockLine({ where: 'after', drag: 'scene' }, 'scene', true)).toEqual({ head: undefined, lastRow: 'after' })
  })
  it('before a block, a shot onto a block, or a block with nothing showing: on the heading, as before', () => {
    expect(blockLine({ where: 'before', drag: 'band' }, 'band', true)).toEqual({ head: 'before', lastRow: undefined })
    expect(blockLine({ where: 'after', drag: 'item' }, 'band', true)).toEqual({ head: 'after', lastRow: undefined })
    expect(blockLine({ where: 'after', drag: 'shot' }, 'scene', true)).toEqual({ head: 'after', lastRow: undefined })
    expect(blockLine({ where: 'after', drag: 'scene' }, 'scene', false)).toEqual({ head: 'after', lastRow: undefined })
    expect(blockLine(undefined, 'band', true)).toEqual({ head: undefined, lastRow: undefined })
  })
})

describe('a drop: what lands where', () => {
  it('the same kind, or a shot onto its block — never a scene onto a shot, a block onto an item, or across the list and the cut', () => {
    expect(dropAllowed('scene', 'scene')).toBe(true)
    expect(dropAllowed('shot', 'shot')).toBe(true)
    expect(dropAllowed('shot', 'scene')).toBe(true)
    expect(dropAllowed('scene', 'shot')).toBe(false)
    expect(dropAllowed('band', 'band')).toBe(true)
    expect(dropAllowed('item', 'item')).toBe(true)
    expect(dropAllowed('item', 'band')).toBe(true)
    expect(dropAllowed('band', 'item')).toBe(false)
    expect(dropAllowed('shot', 'item')).toBe(false)
    expect(dropAllowed('item', 'scene')).toBe(false)
  })
  it('before or after by the half of the row the pointer is over; onto a block, always its top', () => {
    const rect = { top: 100, height: 40 }
    expect(dropWhere('item', 'item', 119, rect)).toBe('before')
    expect(dropWhere('item', 'item', 120, rect)).toBe('after')
    expect(dropWhere('scene', 'scene', 101, rect)).toBe('before')
    expect(dropWhere('shot', 'scene', 101, rect)).toBe('after')
    expect(dropWhere('item', 'band', 101, rect)).toBe('after')
    expect(dropWhere('band', 'band', 101, rect)).toBe('before')
  })
})

// Review round 2 (R2-06): R1-07 drew a block's line under the target block's
// last row — a row that refused the block. A row of a block now takes a block
// dragged over it, as after that block.
describe('dropTarget: a block over a row of another block', () => {
  const band = { kind: 'band', id: 'B2' }
  it('a block over an item lands on that item\'s block (after it); a scene over a shot, on the shot\'s scene', () => {
    expect(dropTarget({ kind: 'band', id: 'B1' }, 'item', 'i7', { block: band })).toEqual({ kind: 'band', id: 'B2', inBlock: true })
    expect(dropTarget({ kind: 'scene', id: 'S1' }, 'shot', 'sh7', { block: { kind: 'scene', id: 'S2' } })).toEqual({ kind: 'scene', id: 'S2', inBlock: true })
    // A list's nest takes nothing of its own: only a scene, as its scene.
    expect(dropTarget({ kind: 'scene', id: 'S1' }, 'nest', 'S2', { block: { kind: 'scene', id: 'S2' } })).toEqual({ kind: 'scene', id: 'S2', inBlock: true })
  })
  it('what a row takes itself is unchanged: the row, by its halves', () => {
    expect(dropTarget({ kind: 'item', id: 'i1' }, 'item', 'i7', { block: band })).toEqual({ kind: 'item', id: 'i7', inBlock: false })
    expect(dropTarget({ kind: 'shot', id: 'sh1' }, 'scene', 'S2', undefined)).toEqual({ kind: 'scene', id: 'S2', inBlock: false })
  })
  it('CONTROL: a row with no block, a shot over a nest, an item over a band\'s item of the wrong kind, no drag — nothing', () => {
    expect(dropTarget({ kind: 'band', id: 'B1' }, 'item', 'i7', undefined)).toBeNull()
    expect(dropTarget({ kind: 'shot', id: 'sh1' }, 'nest', 'S2', { block: { kind: 'scene', id: 'S2' } })).toBeNull()
    expect(dropTarget({ kind: 'scene', id: 'S1' }, 'item', 'i7', { block: band })).toBeNull()
    expect(dropTarget({ kind: 'band', id: 'B1' }, 'item', 'i7', { block: { kind: 'band', id: null } })).toBeNull()
    expect(dropTarget(null, 'item', 'i7', { block: band })).toBeNull()
  })
})
