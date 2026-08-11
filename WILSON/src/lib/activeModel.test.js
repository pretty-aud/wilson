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
import { BUILTIN, REGISTRY, EFFORT_LEVELS } from './aiModels'
import {
  modelFor, defaultModelFor, tuningFor, setModelSources, getModelSources,
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

describe('defaultModelFor', () => {
  it('ignores the user tier so the picker can name the real default', () => {
    // The bug this exists to prevent: the settings picker used modelFor() to
    // label the default, so after choosing Opus 5 it read "overridden — was
    // Opus 5". It was showing people their own choice as what they replaced.
    setModelSources({ user: { 'dog.fullDeck': 'claude-opus-5' } })
    expect(modelFor('dog.fullDeck')).toBe('claude-opus-5')
    expect(defaultModelFor('dog.fullDeck')).toBe(BUILTIN.REASONING)
  })

  it('still honours the tiers above the user', () => {
    // Not the same as reading BUILTIN[tier] — that only looks correct while
    // workspace and platform are empty, which stops being true in S20.
    setModelSources({
      workspace: { 'dog.fullDeck': 'claude-sonnet-4-6' },
      user: { 'dog.fullDeck': 'claude-opus-5' },
    })
    expect(defaultModelFor('dog.fullDeck')).toBe('claude-sonnet-4-6')
  })

  it('equals the effective model when the user has chosen nothing', () => {
    expect(defaultModelFor('dog.themes')).toBe(modelFor('dog.themes'))
  })
})

describe('tuningFor', () => {
  it('returns {} for a function with no measured tuning', () => {
    // Most call sites are nowhere near ai-proxy's Edge deadline. Spreading an
    // empty object must be a no-op, not an accidental parameter.
    expect(tuningFor('otter.course')).toEqual({})
    expect(tuningFor('dog.themes')).toEqual({})
  })

  it('caps effort on the full-deck call, which was measured against a hard limit', () => {
    // S19: unset ran 137.9s against a ~150s Edge deadline and used 15194 of
    // 16384 tokens; medium ran 69.1s and 7642. If this stops being sent, that
    // call site silently goes back to a coin flip on every long deck.
    expect(tuningFor('dog.fullDeck')).toEqual({
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
    })
  })

  it('ignores an unknown key rather than throwing mid-request', () => {
    expect(tuningFor('nope.nope')).toEqual({})
  })

  it('only ever emits effort levels Anthropic accepts', () => {
    // A typo here is a 400 at generation time, on the heaviest call WILSON
    // makes — long after anyone would connect it to this line.
    for (const entry of REGISTRY) {
      if (entry.effort === undefined) continue
      expect(EFFORT_LEVELS, `${entry.key} has effort "${entry.effort}"`)
        .toContain(entry.effort)
    }
  })

  it('is spreadable into a request body without disturbing it', () => {
    // 16384 is the shipped value and it is NOT implicated in the 546 outage:
    // that is an input-side worker kill, measured 2026-08-11 (see the comment
    // above the continuation loop in DeckOutlineGenerator.jsx). Lowering this
    // was tried the same day and reverted — it governs output, and it forces
    // continuations that resend the whole ~232k-token payload.
    const body = { model: modelFor('dog.fullDeck'), ...tuningFor('dog.fullDeck'), max_tokens: 16384 }
    expect(body.model).toBe(BUILTIN.REASONING)
    expect(body.max_tokens).toBe(16384)
    expect(body.output_config.effort).toBe('medium')
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
