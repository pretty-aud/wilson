// =============================================================================
// activeModel.test.js — Session 19.
//
// `aiModels.test.js` covers resolution arithmetic. This covers delivery: that
// a warning actually reaches a subscriber, exactly once per distinct problem,
// and goes away when the problem does.
//
// The behaviour under test is the one decision D6 turns on — loud fallback
// over silent fallback. A regression here is invisible: generations keep
// working, the banner just stops appearing, and WILSON is back to the state
// that hid a dead model for 47 days.
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest'
import { BUILTIN } from './aiModels'
import {
  modelFor, setModelSources, getModelSources,
  subscribeModelWarnings, getModelWarnings, dismissModelWarning, clearModelWarnings,
} from './activeModel'

beforeEach(() => {
  setModelSources({})
  clearModelWarnings()
})

describe('modelFor', () => {
  it('returns the built-in for a known key with no overrides', () => {
    expect(modelFor('dog.fullDeck')).toBe(BUILTIN.REASONING)
    expect(modelFor('dog.themes')).toBe(BUILTIN.FAST)
  })

  it('warns nothing when everything resolves cleanly', () => {
    modelFor('dog.fullDeck')
    modelFor('otter.course')
    expect(getModelWarnings()).toEqual([])
  })

  it('honours an override', () => {
    setModelSources({ user: { 'dog.fullDeck': 'claude-opus-5' } })
    expect(modelFor('dog.fullDeck')).toBe('claude-opus-5')
    expect(getModelWarnings()).toEqual([])
  })

  it('reads sources at call time, not at import time', () => {
    // The property that lets RABBIT's non-React intake pipeline pick up S20
    // overrides without the provider injecting anything.
    expect(modelFor('rabbit.intake.script')).toBe(BUILTIN.REASONING)
    setModelSources({ workspace: { 'rabbit.intake.script': 'claude-opus-5' } })
    expect(modelFor('rabbit.intake.script')).toBe('claude-opus-5')
  })

  it('falls back and warns when a configured model is retired', () => {
    setModelSources({ user: { 'dog.fullDeck': 'claude-sonnet-4-20250514' } })
    const model = modelFor('dog.fullDeck')

    // The call must still succeed on a working model — never fail closed.
    expect(model).toBe(BUILTIN.REASONING)

    const [w] = getModelWarnings()
    expect(w.key).toBe('dog.fullDeck')
    expect(w.text).toContain('Full deck outline') // names the function
    expect(w.text).toContain('claude-sonnet-4-20250514') // names the bad model
    expect(w.text).toContain('2026-06-15') // names the retirement date
  })

  it('warns once per problem, not once per call', () => {
    // Every REASONING call site sits inside a retry loop. Three attempts must
    // not produce three banners.
    setModelSources({ user: { 'otter.course': 'claude-sonnet-4-20250514' } })
    modelFor('otter.course')
    modelFor('otter.course')
    modelFor('otter.course')
    expect(getModelWarnings()).toHaveLength(1)
  })

  it('retracts the warning once the setting is corrected', () => {
    setModelSources({ user: { 'otter.course': 'claude-sonnet-4-20250514' } })
    modelFor('otter.course')
    expect(getModelWarnings()).toHaveLength(1)

    setModelSources({ user: { 'otter.course': 'claude-opus-5' } })
    expect(modelFor('otter.course')).toBe('claude-opus-5')
    expect(getModelWarnings()).toEqual([])
  })

  it('warns on an unknown key — the typo case the static guard cannot see', () => {
    const model = modelFor('dog.fullDekc')
    expect(model).toBe(BUILTIN.REASONING) // still works
    expect(getModelWarnings()[0].text).toContain('dog.fullDekc')
  })

  it('keeps warnings for different keys separate', () => {
    setModelSources({
      user: {
        'dog.fullDeck': 'claude-sonnet-4-20250514',
        'otter.course': 'not a model id',
      },
    })
    modelFor('dog.fullDeck')
    modelFor('otter.course')
    expect(getModelWarnings().map((w) => w.key).sort())
      .toEqual(['dog.fullDeck', 'otter.course'])
  })
})

describe('warning subscription', () => {
  it('pushes the current list immediately on subscribe', () => {
    const seen = []
    const unsub = subscribeModelWarnings((w) => seen.push(w))
    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual([])
    unsub()
  })

  it('notifies subscribers when a warning appears', () => {
    let latest = null
    const unsub = subscribeModelWarnings((w) => { latest = w })
    setModelSources({ user: { 'agent.chat': 'claude-sonnet-4-20250514' } })
    modelFor('agent.chat')
    expect(latest).toHaveLength(1)
    expect(latest[0].key).toBe('agent.chat')
    unsub()
  })

  it('stops notifying after unsubscribe', () => {
    let calls = 0
    const unsub = subscribeModelWarnings(() => { calls += 1 })
    const afterSubscribe = calls
    unsub()
    setModelSources({ user: { 'agent.chat': 'claude-sonnet-4-20250514' } })
    modelFor('agent.chat')
    expect(calls).toBe(afterSubscribe)
  })

  it('lets the user dismiss one warning', () => {
    setModelSources({ user: { 'agent.chat': 'claude-sonnet-4-20250514' } })
    modelFor('agent.chat')
    dismissModelWarning('agent.chat')
    expect(getModelWarnings()).toEqual([])
  })
})

describe('setModelSources', () => {
  it('normalises missing tiers to null rather than undefined', () => {
    setModelSources({ user: { 'dog.themes': 'claude-opus-5' } })
    expect(getModelSources()).toEqual({
      user: { 'dog.themes': 'claude-opus-5' },
      workspace: null,
      platform: null,
    })
  })

  it('tolerates being called with nothing', () => {
    expect(() => setModelSources()).not.toThrow()
    expect(modelFor('dog.themes')).toBe(BUILTIN.FAST)
  })
})
