// =============================================================================
// modelSources.test.js — Session 20.
//
// `activeModel.test.js` covers delivery of a warning. This covers the thing S20
// adds underneath it: three override tiers arriving from three separate queries
// at three different moments.
//
// The bug this file exists to prevent is specific and was found by review, not
// by a failure: `setModelSources` REPLACES all three tiers, which was correct
// when localStorage was the only writer and knows everything. With three
// asynchronous loaders, a call of `setModelSources({ workspace })` silently
// blanks the user's own choices — and nothing complains, because resolution
// just falls through to the next tier and generates happily with the wrong
// model. `updateModelSource` exists for that reason and the first test here is
// the proof.
//
// The second theme is that a failed read must NOT blank a tier. If the network
// drops, the cached value has to stand — otherwise a catalogue outage silently
// downgrades every company to the built-in floor, which is the 47-day failure
// wearing different clothes.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Supabase stub ────────────────────────────────────────────────────────────
// A chainable query object whose terminal await resolves to whatever the test
// queued for that table.

const responses = new Map()

function queueTable(table, result) {
  responses.set(table, result)
}

function makeQuery(table) {
  const result = responses.get(table) ?? { data: [], error: null }
  const chain = {
    select: () => chain,
    is: () => chain,
    eq: () => chain,
    order: () => chain,
    upsert: () => chain,
    delete: () => chain,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

vi.mock('../cloud/auth/supabaseClient', () => ({
  supabase: {
    from: (table) => makeQuery(table),
    auth: {
      getSession: async () => ({
        data: {
          session: {
            user: { id: 'user-1', app_metadata: { workspace_id: 'ws-1' } },
          },
        },
      }),
    },
  },
}))

import { BUILTIN } from './aiModels'
import {
  modelFor, setModelSources, getModelSources, updateModelSource,
  areModelSourcesLoaded, markModelSourcesLoaded, clearModelWarnings,
  setPlatformEffort, tuningFor,
} from './activeModel'
import {
  hydrateModelSourcesFromCache, cachedApprovedModels, loadModelSources,
} from './modelSources'

// Minimal localStorage, since the vitest environment is 'node'.
function installStorage(initial = {}) {
  const store = new Map(Object.entries(initial))
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
  return store
}

beforeEach(() => {
  setModelSources({})
  clearModelWarnings()
  markModelSourcesLoaded(false)
  setPlatformEffort({})
  responses.clear()
  installStorage()
})

describe('platform effort', () => {
  it('falls back to the registry value when the operator has set nothing', () => {
    // dog.fullDeck carries effort 'medium' in the REGISTRY, from a measurement.
    expect(tuningFor('dog.fullDeck')).toEqual({
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
    })
    expect(tuningFor('dog.themes')).toEqual({})
  })

  it('lets the operator override the registry value', () => {
    setPlatformEffort({ 'dog.fullDeck': 'low' })
    expect(tuningFor('dog.fullDeck')).toEqual({
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
    })
  })

  it('ignores an effort level Anthropic would reject', () => {
    // A bad value must not reach the request body — ai-proxy forwards
    // output_config verbatim, so this would 400 the whole generation.
    setPlatformEffort({ 'dog.fullDeck': 'ludicrous' })
    expect(tuningFor('dog.fullDeck')).toEqual({
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
    })
  })

  it('is loaded from the platform tier', async () => {
    queueTable('platform_model_defaults', {
      data: [{ registry_key: 'dog.fullDeck', model_id: 'claude-sonnet-5', effort: 'high' }],
      error: null,
    })
    await loadModelSources()
    expect(tuningFor('dog.fullDeck').output_config).toEqual({ effort: 'high' })
  })
})

describe('updateModelSource', () => {
  it('replaces ONE tier and leaves the others alone', () => {
    setModelSources({
      user: { 'dog.fullDeck': 'claude-opus-5' },
      workspace: { 'dog.themes': 'claude-sonnet-5' },
      platform: { 'otter.quiz': 'claude-sonnet-5' },
    })

    updateModelSource('workspace', { 'dog.themes': 'claude-haiku-4-5-20251001' })

    const s = getModelSources()
    // The point of the test: the tier we did not touch is intact.
    expect(s.user).toEqual({ 'dog.fullDeck': 'claude-opus-5' })
    expect(s.platform).toEqual({ 'otter.quiz': 'claude-sonnet-5' })
    expect(s.workspace).toEqual({ 'dog.themes': 'claude-haiku-4-5-20251001' })
  })

  it('does not let a workspace load clobber a user choice', () => {
    updateModelSource('user', { 'dog.fullDeck': 'claude-opus-5' })
    updateModelSource('workspace', { 'dog.fullDeck': 'claude-sonnet-5' })

    // User beats workspace — if the workspace load had wiped the user tier this
    // would return sonnet, silently and with no warning anywhere.
    expect(modelFor('dog.fullDeck')).toBe('claude-opus-5')
  })

  it('accepts null to clear a tier', () => {
    updateModelSource('user', { 'dog.fullDeck': 'claude-opus-5' })
    updateModelSource('user', null)
    expect(modelFor('dog.fullDeck')).toBe(BUILTIN.REASONING)
  })

  it('throws on an unknown tier rather than silently doing nothing', () => {
    expect(() => updateModelSource('nonsense', {})).toThrow(/unknown tier/)
  })
})

describe('load state', () => {
  it('starts false and flips when the loader says so', () => {
    expect(areModelSourcesLoaded()).toBe(false)
    markModelSourcesLoaded(true)
    expect(areModelSourcesLoaded()).toBe(true)
  })
})

describe('hydrateModelSourcesFromCache', () => {
  it('returns false when there is nothing cached', () => {
    expect(hydrateModelSourcesFromCache()).toBe(false)
  })

  it('applies cached tiers synchronously', () => {
    installStorage({
      'wilson.modelSources.v1': JSON.stringify({
        user: { 'dog.fullDeck': 'claude-opus-5' },
        workspace: null,
        platform: { 'dog.themes': 'claude-sonnet-5' },
      }),
    })

    expect(hydrateModelSourcesFromCache()).toBe(true)
    // This is what closes the window between app start and the queries landing.
    expect(modelFor('dog.fullDeck')).toBe('claude-opus-5')
    expect(modelFor('dog.themes')).toBe('claude-sonnet-5')
  })

  it('degrades to defaults on a corrupt cache instead of throwing', () => {
    installStorage({ 'wilson.modelSources.v1': 'not json{' })
    expect(hydrateModelSourcesFromCache()).toBe(false)
    expect(modelFor('dog.fullDeck')).toBe(BUILTIN.REASONING)
  })
})

describe('cachedApprovedModels', () => {
  it('is empty with no cache', () => {
    expect(cachedApprovedModels()).toEqual([])
  })

  it('is empty when the cached value is not an array', () => {
    installStorage({ 'wilson.modelCatalogue.v1': JSON.stringify({ nope: true }) })
    expect(cachedApprovedModels()).toEqual([])
  })

  it('returns the cached catalogue', () => {
    installStorage({
      'wilson.modelCatalogue.v1': JSON.stringify([
        { model_id: 'claude-opus-5', label: 'Opus 5' },
      ]),
    })
    expect(cachedApprovedModels()).toHaveLength(1)
  })
})

describe('loadModelSources', () => {
  it('applies all three tiers', async () => {
    queueTable('platform_model_defaults', {
      data: [{ registry_key: 'dog.themes', model_id: 'claude-sonnet-5' }], error: null,
    })
    queueTable('workspace_model_overrides', {
      data: [{ registry_key: 'otter.quiz', model_id: 'claude-opus-5' }], error: null,
    })
    queueTable('user_model_overrides', {
      data: [{ registry_key: 'dog.fullDeck', model_id: 'claude-opus-5' }], error: null,
    })

    const res = await loadModelSources()
    expect(res.ok).toBe(true)
    expect(modelFor('dog.themes')).toBe('claude-sonnet-5')
    expect(modelFor('otter.quiz')).toBe('claude-opus-5')
    expect(modelFor('dog.fullDeck')).toBe('claude-opus-5')
    expect(areModelSourcesLoaded()).toBe(true)
  })

  it('drops rows naming an unknown function or a malformed model id', async () => {
    queueTable('user_model_overrides', {
      data: [
        { registry_key: 'dog.fullDeck', model_id: 'claude-opus-5' },
        { registry_key: 'not.a.real.function', model_id: 'claude-opus-5' },
        { registry_key: 'dog.themes', model_id: 'gpt-4' },
      ],
      error: null,
    })

    await loadModelSources()
    expect(getModelSources().user).toEqual({ 'dog.fullDeck': 'claude-opus-5' })
    // The malformed one must not reach the resolver at all — not even as a
    // warning, because it was never a real setting.
    expect(modelFor('dog.themes')).toBe(BUILTIN.FAST)
  })

  it('leaves a hydrated tier standing when its read fails', async () => {
    installStorage({
      'wilson.modelSources.v1': JSON.stringify({
        user: { 'dog.fullDeck': 'claude-opus-5' }, workspace: null, platform: null,
      }),
    })
    hydrateModelSourcesFromCache()

    queueTable('user_model_overrides', { data: null, error: { message: 'network down' } })

    const res = await loadModelSources()
    expect(res.ok).toBe(false)
    expect(res.error).toBeTruthy()
    // THE POINT: a failed read must not blank the tier. If it did, an outage
    // would silently downgrade every choice to the built-in floor.
    expect(modelFor('dog.fullDeck')).toBe('claude-opus-5')
    // And a partial load is not reported as loaded.
    expect(areModelSourcesLoaded()).toBe(false)
  })
})
