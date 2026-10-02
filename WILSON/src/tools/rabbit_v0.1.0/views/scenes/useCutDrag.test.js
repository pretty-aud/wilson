// useCutDrag.test.js — what may land where, and which half (S3c step 6, D16).
import { describe, it, expect } from 'vitest'
import { dropAllowed, dropWhere } from './useCutDrag'

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
