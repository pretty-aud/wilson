// =============================================================================
// userModelPrefs.test.js — Session 19.
//
// The `user` tier of the cascade, and the thing that makes the settings-panel
// dropdown real rather than decorative. Two properties matter most and neither
// is visible by clicking around:
//
//   * a choice must reach the NEXT generation, not the next launch;
//   * stored junk must degrade to the default rather than nagging forever.
//
// S20 replaces the storage with Supabase tables. The keys do not change — they
// are REGISTRY keys — so these tests should survive that migration.
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest'
import { BUILTIN } from './aiModels'
import { modelFor, setModelSources, clearModelWarnings } from './activeModel'
import {
  loadUserModelPrefs, setUserModelPref, clearUserModelPrefs, initUserModelPrefs,
} from './userModelPrefs'

const KEY = 'wilson.modelPrefs.v1'

// Vitest runs these in the node environment, which has no localStorage. A
// minimal in-memory stand-in keeps the storage behaviour under test rather
// than switching the whole suite to jsdom for one module.
//
// The module is written to survive localStorage being absent entirely — that
// is the private-browsing and no-storage case — so the stub is here to make
// the *stored* paths testable, not to paper over a crash.
beforeEach(() => {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  }
  setModelSources({})
  clearModelWarnings()
})

describe('setUserModelPref', () => {
  it('takes effect on the very next resolve, not the next launch', () => {
    // The whole point. modelFor reads sources at call time, so a dropdown
    // change must be live immediately — a setting that needs a restart to work
    // is indistinguishable from one that is broken.
    expect(modelFor('dog.fullDeck')).toBe(BUILTIN.REASONING)
    setUserModelPref('dog.fullDeck', 'claude-opus-5')
    expect(modelFor('dog.fullDeck')).toBe('claude-opus-5')
  })

  it('persists across a reload', () => {
    setUserModelPref('dog.themes', 'claude-sonnet-5')
    setModelSources({})                    // simulate a fresh process
    expect(modelFor('dog.themes')).toBe(BUILTIN.FAST)
    initUserModelPrefs()                   // what main.jsx does at boot
    expect(modelFor('dog.themes')).toBe('claude-sonnet-5')
  })

  it('clears back to the default when passed null', () => {
    setUserModelPref('dog.fullDeck', 'claude-opus-5')
    setUserModelPref('dog.fullDeck', null)
    expect(modelFor('dog.fullDeck')).toBe(BUILTIN.REASONING)
    expect(loadUserModelPrefs()).toEqual({})
  })

  it('leaves other functions alone', () => {
    setUserModelPref('dog.fullDeck', 'claude-opus-5')
    expect(modelFor('otter.course')).toBe(BUILTIN.REASONING)
    expect(modelFor('dog.themes')).toBe(BUILTIN.FAST)
  })
})

describe('loadUserModelPrefs — hostile storage', () => {
  it('survives unparseable JSON', () => {
    globalThis.localStorage.setItem(KEY, '{not json')
    expect(loadUserModelPrefs()).toEqual({})
  })

  it('survives a non-object', () => {
    globalThis.localStorage.setItem(KEY, '["nope"]')
    expect(loadUserModelPrefs()).toEqual({})
  })

  it('drops keys that are not in the registry', () => {
    // A REGISTRY rename would otherwise leave a setting that can never apply
    // and can never be cleared from the UI, because nothing renders it.
    globalThis.localStorage.setItem(KEY, JSON.stringify({
      'dog.fullDeck': 'claude-opus-5',
      'dog.somethingRenamed': 'claude-opus-5',
    }))
    expect(loadUserModelPrefs()).toEqual({ 'dog.fullDeck': 'claude-opus-5' })
  })

  it('drops a model that has since been retired', () => {
    // Otherwise every generation shows a fallback banner for a choice the user
    // made months ago and cannot remember making.
    globalThis.localStorage.setItem(KEY, JSON.stringify({
      'dog.fullDeck': 'claude-sonnet-4-20250514',
    }))
    expect(loadUserModelPrefs()).toEqual({})
    initUserModelPrefs()
    expect(modelFor('dog.fullDeck')).toBe(BUILTIN.REASONING)
  })

  it('drops a malformed model id', () => {
    globalThis.localStorage.setItem(KEY, JSON.stringify({ 'dog.fullDeck': 'not a model' }))
    expect(loadUserModelPrefs()).toEqual({})
  })
})

describe('clearUserModelPrefs', () => {
  it('removes every choice and reverts to defaults', () => {
    setUserModelPref('dog.fullDeck', 'claude-opus-5')
    setUserModelPref('dog.themes', 'claude-sonnet-5')
    clearUserModelPrefs()
    expect(loadUserModelPrefs()).toEqual({})
    expect(modelFor('dog.fullDeck')).toBe(BUILTIN.REASONING)
    expect(modelFor('dog.themes')).toBe(BUILTIN.FAST)
  })
})
