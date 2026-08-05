// =============================================================================
// localData.test.js — Session 30.
//
// 🚨 THE PET'S SAVES FAILED SILENTLY THROUGH THREE LAYERS AT ONCE, and each
// layer on its own looked defensible:
//
//   1. `writeLocal` was `catch { /* storage disabled */ }`. localStorage throws
//      QuotaExceededError when full and is unavailable in Safari private mode
//      and under some enterprise policies — none of them rare, all of them
//      indistinguishable from success.
//   2. `savePetData` never checked `res.ok` on its Express POST, so a 404, a
//      500 or a server that had not started yet all returned normally.
//   3. `App.jsx`'s savePet wrapped it in `catch { /* silent */ }` — a catch
//      that could not fire, because nothing beneath it ever threw.
//
// The pet is the worst possible subject for this: the old state stays on
// screen and looks completely right, so nothing whatsoever distinguishes
// "saved" from "lost until you next reload".
//
// These are BEHAVIOUR tests, not a source scan — this module is pure enough to
// drive directly, so drive it. The source-scan pattern used elsewhere in this
// repo is a fallback for code welded into a component, not a first choice.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { savePetData, loadPet, saveOtterSettings, saveAgentSkills } from './localData'

const KEY = 'wilson.pet'

/** A localStorage stand-in whose setItem can be told to fail. */
function stubStorage({ failWith = null } = {}) {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { if (failWith) throw failWith; map.set(k, v) },
    removeItem: (k) => map.delete(k),
    _map: map,
  }
}

let originalStorage

beforeEach(() => {
  originalStorage = globalThis.localStorage
  // No electronAPI → hasLocalServer() is false → the localStorage path.
  delete globalThis.window?.electronAPI
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (originalStorage) vi.stubGlobal('localStorage', originalStorage)
})

describe('the web path reports a storage failure', () => {
  it('saves normally when storage works', async () => {
    const store = stubStorage()
    vi.stubGlobal('localStorage', store)
    await expect(savePetData({ name: 'Ollie', hunger: 50 })).resolves.toBeUndefined()
    expect(JSON.parse(store._map.get(KEY)).name).toBe('Ollie')
  })

  it('THROWS when storage is full, instead of pretending', async () => {
    const quota = new Error('quota'); quota.name = 'QuotaExceededError'
    vi.stubGlobal('localStorage', stubStorage({ failWith: quota }))
    await expect(savePetData({ name: 'Ollie' })).rejects.toThrow(/storage is full/i)
  })

  it('THROWS when storage is blocked (private browsing, policy)', async () => {
    vi.stubGlobal('localStorage', stubStorage({ failWith: new Error('denied') }))
    await expect(savePetData({ name: 'Ollie' })).rejects.toThrow(/blocking local storage/i)
  })

  it('settings and agent skills report it too — they shared the defect', async () => {
    vi.stubGlobal('localStorage', stubStorage({ failWith: new Error('denied') }))
    await expect(saveOtterSettings({ a: 1 })).rejects.toThrow(/could not be saved/i)
    await expect(saveAgentSkills({ a: 1 })).rejects.toThrow(/could not be saved/i)
  })

  it('but READING still degrades to a default pet', async () => {
    // A broken store must not take the app down. loadPet seeds a default egg
    // and that seed write is allowed to fail quietly — the next REAL save is
    // what reports the problem.
    vi.stubGlobal('localStorage', stubStorage({ failWith: new Error('denied') }))
    const pet = await loadPet()
    expect(pet).toBeTruthy()
    expect(pet.form).toBe('egg')
  })
})

describe('the Electron path checks the response status', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { ...globalThis.window, electronAPI: {} })
  })

  it('resolves on 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))
    await expect(savePetData({ name: 'Ollie' })).resolves.toBeUndefined()
  })

  it('THROWS on a 404 — the unchecked await is the whole defect', async () => {
    // fetch RESOLVES for every status. Before S30 this returned normally and
    // App.jsx recorded a successful save.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 404, json: () => Promise.reject(new Error('not json')),
    }))
    await expect(savePetData({ name: 'Ollie' })).rejects.toThrow(/HTTP 404/)
  })

  it('prefers the server’s own message when there is one', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 500, json: () => Promise.resolve({ error: 'disk is full' }),
    }))
    await expect(savePetData({ name: 'Ollie' })).rejects.toThrow('disk is full')
  })

  it('a non-JSON error body does not mask the failure', async () => {
    // Express answers a bare 404 with HTML. The parse must be allowed to fail
    // without turning the rejection into a different, confusing error.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 502, json: () => Promise.reject(new SyntaxError('<html>')),
    }))
    await expect(savePetData({ name: 'Ollie' })).rejects.toThrow(/HTTP 502/)
  })
})
