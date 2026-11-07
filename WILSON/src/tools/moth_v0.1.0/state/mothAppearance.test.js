// mothAppearance.test.js — MO2: Settings' appearance, read back from moth_prefs as untrusted, and the colour and
// size functions it gives the renderer.
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_APPEARANCE, GLOW_SWATCHES, SIZE_BY, COLOUR_BY, LIGHTER,
  normalizeAppearance, fileFamily, colourFor, radiusFor,
} from './mothAppearance.js'
import { defaultRadius } from '../engine/model.js'
import { OVERRIDES } from '../engine/governor.js'

describe('normalizeAppearance', () => {
  it('keeps each value only in its own words, else the default', () => {
    expect(normalizeAppearance(null)).toEqual({ ...DEFAULT_APPEARANCE })
    expect(normalizeAppearance('x')).toEqual({ ...DEFAULT_APPEARANCE })
    expect(normalizeAppearance({ glow: '#9fd3ff', size_by: 'recency', colour_by: 'tag', light: 'light' }))
      .toEqual({ glow: '#9fd3ff', size_by: 'recency', colour_by: 'tag', light: 'light' })
    expect(normalizeAppearance({ glow: 'red', size_by: 'weight', colour_by: 'owner', light: 'dim' }))
      .toEqual({ ...DEFAULT_APPEARANCE })
  })
  it('takes a colour only as six lower-case hex digits', () => {
    expect(normalizeAppearance({ glow: '#ABCDEF' }).glow).toBe(DEFAULT_APPEARANCE.glow)
    expect(normalizeAppearance({ glow: '#abc' }).glow).toBe(DEFAULT_APPEARANCE.glow)
    expect(normalizeAppearance({ glow: '#abcdef; background:url(x)' }).glow).toBe(DEFAULT_APPEARANCE.glow)
    expect(normalizeAppearance({ glow: '#abcdef' }).glow).toBe('#abcdef')
  })
  it('offers only choices the governor and the renderer know', () => {
    expect(LIGHTER.map(([k]) => k).sort()).toEqual([...OVERRIDES].sort())
    expect(SIZE_BY.map(([k]) => k)).toContain(DEFAULT_APPEARANCE.size_by)
    expect(COLOUR_BY.map(([k]) => k)).toContain(DEFAULT_APPEARANCE.colour_by)
    for (const [hex] of GLOW_SWATCHES) expect(normalizeAppearance({ glow: hex }).glow).toBe(hex)
  })
})

describe('fileFamily', () => {
  it('reads the mime type and kind, never the name', () => {
    expect(fileFamily({ mime: 'image/png' })).toBe('image')
    expect(fileFamily({ mime: 'video/quicktime' })).toBe('video')
    expect(fileFamily({ mime: 'audio/wav' })).toBe('audio')
    expect(fileFamily({ mime: 'application/pdf' })).toBe('document')
    expect(fileFamily({ mime: 'model/gltf-binary' })).toBe('model')
    expect(fileFamily({ mime: null, fileKind: 'model' })).toBe('model')
    expect(fileFamily({ mime: null, label: 'shot.png' })).toBe('other')
    expect(fileFamily(null)).toBe('other')
  })
})

describe('colourFor', () => {
  const file = (extra) => ({ kind: 'file', tags: [], ...extra })
  it('what it is: the kind\'s own colour (no function)', () => {
    expect(colourFor('kind')).toBeNull()
  })
  it('type of file: a tint per family, none for other kinds or the unknown', () => {
    const f = colourFor('file_type')
    expect(f(file({ mime: 'image/png' }))).toMatch(/^#[0-9a-f]{6}$/)
    expect(f(file({ mime: 'image/png' }))).not.toBe(f(file({ mime: 'video/mp4' })))
    expect(f(file({ mime: 'application/zip' }))).toBeNull()
    expect(f({ kind: 'folder' })).toBeNull()
  })
  it('tag: the same tint for the same first tag, none untagged', () => {
    const f = colourFor('tag')
    expect(f(file({ tags: ['shots'] }))).toBe(f(file({ tags: ['shots', 'code'] })))
    expect(f(file({ tags: [] }))).toBeNull()
    expect(f({ kind: 'tag', tags: ['shots'] })).toBeNull()
  })
  it('who last changed it: a stable tint per person, none when nobody is known', () => {
    const editors = { a: 'u1', b: 'u1', c: 'u2' }
    const f = colourFor('editor', { editorOf: (n) => editors[n.rowId] ?? null })
    expect(f(file({ rowId: 'a' }))).toBe(f(file({ rowId: 'b' })))
    expect(f(file({ rowId: 'z' }))).toBeNull()
    expect(f({ kind: 'folder', rowId: 'a' })).toBeNull()
  })
  it('never uses the selection\'s orange', () => {
    for (const by of ['file_type', 'tag', 'editor']) {
      const f = colourFor(by, { editorOf: () => 'someone' })
      for (const n of [file({ mime: 'image/png', tags: ['code'] }), file({ mime: 'audio/wav', tags: ['shots'] })]) {
        const c = f(n)
        if (c) expect(['#ea580c', '#c2410c']).not.toContain(c.toLowerCase())
      }
    }
  })
})

describe('radiusFor', () => {
  it('what is inside is the engine\'s own', () => {
    expect(radiusFor('contents')).toBe(defaultRadius)
  })
  it('how recently: newer is larger, the unknown as a year old, never negative', () => {
    const now = Date.parse('2026-11-07T00:00:00Z')
    const r = radiusFor('recency', { now: () => now })
    const fresh = r({ kind: 'file', updatedAt: '2026-11-07T00:00:00Z' })
    const week = r({ kind: 'file', updatedAt: '2026-10-31T00:00:00Z' })
    const old = r({ kind: 'file', updatedAt: '2024-01-01T00:00:00Z' })
    const unknown = r({ kind: 'file', updatedAt: null })
    const future = r({ kind: 'file', updatedAt: '2027-01-01T00:00:00Z' })
    expect(fresh).toBeGreaterThan(week)
    expect(week).toBeGreaterThan(old)
    expect(old).toBe(unknown)
    expect(future).toBe(fresh)
    expect(old).toBeGreaterThan(0)
    expect(r({ kind: 'folder', updatedAt: null })).toBeGreaterThan(unknown)
  })
})
