// =============================================================================
// aiModels.test.js — Session 19.
//
// The registry is a contract with persisted data: keys are written into user
// settings, workspace overrides and platform defaults. Most of what follows
// guards that contract rather than the resolution arithmetic, because a
// renamed key silently discards someone's configuration and no runtime error
// ever fires.
//
// It also pins the outage that caused all this: `claude-sonnet-4-20250514` was
// retired 2026-06-15 and must never be reachable as a default again.
// =============================================================================

import { describe, it, expect } from 'vitest'
import {
  BUILTIN, REGISTRY, BY_KEY, RETIRED,
  isWellFormedModelId, resolveModel, modelsInUse, configWarnings, registryByTool,
} from './aiModels'

describe('REGISTRY integrity', () => {
  it('covers every call site the S19 audit found', () => {
    // 28 call sites across six files. If this number moves, the audit moved —
    // re-run the mapping before changing it, don't just bump the constant.
    expect(REGISTRY).toHaveLength(28)
  })

  it('has unique keys', () => {
    const keys = REGISTRY.map((e) => e.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('gives every entry a tier that exists in BUILTIN', () => {
    for (const e of REGISTRY) expect(BUILTIN).toHaveProperty(e.tier)
  })

  it('gives every entry a user-facing label', () => {
    for (const e of REGISTRY) expect(e.label.length).toBeGreaterThan(0)
  })

  it('never ships a retired model as a built-in default', () => {
    // The regression that started this. Both built-ins must be live models.
    for (const model of Object.values(BUILTIN)) {
      expect(RETIRED[model], `${model} is retired and cannot be a default`).toBeUndefined()
    }
  })

  it('keeps Haiku 4.5 as the FAST default', () => {
    // Deliberate: every call site on Haiku kept working through the outage.
    // A change here should be a decision, not a drive-by modernisation.
    expect(BUILTIN.FAST).toBe('claude-haiku-4-5-20251001')
  })
})

describe('isWellFormedModelId', () => {
  it.each([
    'claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-6',
  ])('accepts %s', (id) => expect(isWellFormedModelId(id)).toBe(true))

  it.each([
    ['empty', ''],
    ['not a claude id', 'gpt-4'],
    ['bare prefix', 'claude-'],
    ['too short', 'claude-a'],
    ['uppercase', 'Claude-Sonnet-5'],
    ['a sentence', 'the latest sonnet please'],
    ['null', null],
    ['a number', 5],
  ])('rejects %s', (_label, id) => expect(isWellFormedModelId(id)).toBe(false))

  it('tolerates surrounding whitespace, since it comes from a text field', () => {
    expect(isWellFormedModelId('  claude-sonnet-5  ')).toBe(true)
  })
})

describe('resolveModel — the cascade', () => {
  it('falls back to the built-in when nothing is configured', () => {
    const r = resolveModel('dog.fullDeck')
    expect(r.model).toBe(BUILTIN.REASONING)
    expect(r.source).toBe('builtin')
    expect(r.warning).toBeNull()
  })

  it('uses the platform default over the built-in', () => {
    const r = resolveModel('dog.fullDeck', { platform: { 'dog.fullDeck': 'claude-opus-5' } })
    expect(r).toMatchObject({ model: 'claude-opus-5', source: 'platform', warning: null })
  })

  it('lets a workspace override the platform default', () => {
    const r = resolveModel('dog.fullDeck', {
      platform: { 'dog.fullDeck': 'claude-opus-5' },
      workspace: { 'dog.fullDeck': 'claude-sonnet-5' },
    })
    expect(r).toMatchObject({ model: 'claude-sonnet-5', source: 'workspace' })
  })

  it('lets a user override the workspace', () => {
    const r = resolveModel('dog.fullDeck', {
      platform: { 'dog.fullDeck': 'claude-opus-5' },
      workspace: { 'dog.fullDeck': 'claude-sonnet-5' },
      user: { 'dog.fullDeck': 'claude-haiku-4-5-20251001' },
    })
    expect(r).toMatchObject({ model: 'claude-haiku-4-5-20251001', source: 'user' })
  })

  it('ignores an override set for a different function', () => {
    const r = resolveModel('dog.fullDeck', { user: { 'otter.quiz': 'claude-opus-5' } })
    expect(r.source).toBe('builtin')
  })

  it('treats an empty-string override as unset rather than invalid', () => {
    // Clearing a text field must fall through to the next tier, not warn.
    const r = resolveModel('dog.fullDeck', {
      user: { 'dog.fullDeck': '' },
      workspace: { 'dog.fullDeck': 'claude-opus-5' },
    })
    expect(r).toMatchObject({ model: 'claude-opus-5', source: 'workspace', warning: null })
  })
})

describe('resolveModel — degrading loudly', () => {
  it('refuses a retired model, substitutes, and says so with the date', () => {
    const r = resolveModel('dog.fullDeck', {
      user: { 'dog.fullDeck': 'claude-sonnet-4-20250514' },
    })
    expect(r.model).toBe(BUILTIN.REASONING)
    expect(r.source).toBe('builtin')
    expect(r.warning).toContain('claude-sonnet-4-20250514')
    expect(r.warning).toContain('2026-06-15')
    expect(r.warning).toContain('Full deck outline') // names the function, not the key
  })

  it('refuses a malformed id and names it back to the user', () => {
    const r = resolveModel('otter.quiz', { workspace: { 'otter.quiz': 'sonnet please' } })
    expect(r.model).toBe(BUILTIN.FAST)
    expect(r.warning).toContain('sonnet please')
  })

  it('does not fall through to a lower tier when a higher one is bad', () => {
    // A user who typo'd should be told, not silently served the workspace
    // value — otherwise the setting they can see is not the one in effect.
    const r = resolveModel('dog.fullDeck', {
      user: { 'dog.fullDeck': 'claude-sonnet-4-20250514' },
      workspace: { 'dog.fullDeck': 'claude-opus-5' },
    })
    expect(r.model).toBe(BUILTIN.REASONING)
    expect(r.warning).not.toBeNull()
  })

  it('survives an unknown key with a working model and a bug warning', () => {
    const r = resolveModel('dog.doesNotExist')
    expect(r.model).toBe(BUILTIN.REASONING)
    expect(r.warning).toContain('not in the registry')
    expect(r.entry).toBeNull()
  })
})

describe('the S19 outage, pinned', () => {
  it('no registry entry resolves to the retired Sonnet 4 by default', () => {
    for (const e of REGISTRY) {
      expect(resolveModel(e.key).model).not.toBe('claude-sonnet-4-20250514')
    }
  })

  it('a clean config produces no warnings', () => {
    expect(configWarnings()).toEqual([])
  })

  it('reports one warning per misconfigured function', () => {
    const warnings = configWarnings({
      platform: {
        'dog.fullDeck': 'claude-sonnet-4-20250514',
        'otter.course': 'claude-sonnet-4-20250514',
      },
    })
    expect(warnings).toHaveLength(2)
  })
})

describe('views for the settings panel', () => {
  it('groups by tool without losing an entry', () => {
    const grouped = registryByTool()
    expect([...grouped.keys()]).toEqual(['D.O.G.', 'O.T.T.E.R.', 'R.A.B.B.I.T.', 'Assistant'])
    expect([...grouped.values()].flat()).toHaveLength(REGISTRY.length)
  })

  it('summarises the two built-ins in use by default', () => {
    const inUse = modelsInUse()
    expect([...inUse.keys()].sort()).toEqual([BUILTIN.FAST, BUILTIN.REASONING].sort())
    expect([...inUse.values()].flat()).toHaveLength(REGISTRY.length)
  })

  it('reflects an override in the in-use summary', () => {
    const inUse = modelsInUse({ user: { 'dog.fullDeck': 'claude-opus-5' } })
    expect(inUse.get('claude-opus-5').map((e) => e.key)).toEqual(['dog.fullDeck'])
  })

  it('exposes every entry through BY_KEY', () => {
    for (const e of REGISTRY) expect(BY_KEY[e.key]).toBe(e)
  })
})
