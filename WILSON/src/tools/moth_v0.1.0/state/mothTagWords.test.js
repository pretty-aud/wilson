// MO3 (0126): what Moth says while a person names a tag: their own of these words, the company's, and near ones.
import { describe, it, expect } from 'vitest'
import { tagNorm, lettersApart, tagAdvice } from './mothTagWords.js'

const ME = 'me'
const tags = [
  { id: 'c1', tier: 'company', label: 'Mira', type_id: 'character' },
  { id: 'c2', tier: 'company', label: 'Harbour', type_id: 'location', retired_at: '2026-10-01' },
  { id: 'm1', tier: 'personal', owner_id: ME, label: 'Blender 5.0', type_id: 'software' },
  { id: 'm2', tier: 'personal', owner_id: ME, label: 'Mira Lund', type_id: 'character' },
  { id: 'm3', tier: 'personal', owner_id: ME, label: 'old', type_id: 'software', canonical_id: 'c1' },
]

describe("a tag's words", () => {
  it('read in the database\'s form: case, width and spaces make no second tag', () => {
    expect(tagNorm('  Blender   5.0 ')).toBe('blender 5.0')
    expect(tagNorm('ＭＩＲＡ')).toBe('mira')
  })
  it('counts letters apart, and stops once past the limit', () => {
    expect(lettersApart('mira', 'mria')).toBe(2)
    expect(lettersApart('mira', 'miro')).toBe(1)
    expect(lettersApart('mira', 'harbour')).toBe(3)
  })
})

describe('what is said before a tag is made', () => {
  it('one\'s own tag of these words and type already', () => {
    expect(tagAdvice('blender 5.0', { tags, typeId: 'software', userId: ME }).duplicate?.id).toBe('m1')
    expect(tagAdvice('blender 5.0', { tags, typeId: 'other', userId: ME }).duplicate).toBeNull()
  })
  it('the company\'s tag of these words, whatever its type: use it instead', () => {
    expect(tagAdvice('MIRA', { tags, typeId: 'mine', userId: ME }).company?.id).toBe('c1')
  })
  it('near words, to catch a typo; never a retired or folded tag', () => {
    const near = tagAdvice('Mirra', { tags, typeId: 'character', userId: ME }).similar.map((t) => t.id)
    expect(near).toContain('c1')
    expect(tagAdvice('Harbor', { tags, userId: ME }).similar).toEqual([])
    expect(tagAdvice('old', { tags, userId: ME }).duplicate).toBeNull()
  })
  it('nothing for empty words, and no near words for one or two letters', () => {
    expect(tagAdvice('  ', { tags })).toEqual({ duplicate: null, company: null, similar: [] })
    expect(tagAdvice('mi', { tags }).similar).toEqual([])
  })
})
