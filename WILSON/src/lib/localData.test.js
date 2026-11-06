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

// =============================================================================
// Track A, bundle A3 (2026-09-07) — the pet cache is keyed by ACCOUNT.
//
// It was one localStorage key per origin and one pet.json per install, and
// nothing removed either on sign-out — while userState.resolveUserPet read that
// cache to decide whether to ADOPT it into the account. On a shared computer
// that hands person A's pet to person B, underneath RLS, through the
// filesystem (docs/OUTSTANDING.md, "The per-device pet cache is keyed to the
// machine, not the account").
// =============================================================================

import { petCacheKey, clearPetCache } from './localData'

describe('A3 — the cache names its owner', () => {
  const UID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

  it('one key per account, and the historical one when signed out', () => {
    expect(petCacheKey(UID)).toBe('wilson.pet.' + UID)
    expect(petCacheKey(null)).toBe('wilson.pet')
    expect(petCacheKey()).toBe('wilson.pet')
  })

  it('🚨 two accounts on one browser never share a key', () => {
    const other = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
    expect(petCacheKey(UID)).not.toBe(petCacheKey(other))
  })

  it('reads and writes THIS account\'s copy, not the shared one', async () => {
    const store = stubStorage()
    vi.stubGlobal('localStorage', store)
    await savePetData({ name: 'Dee', form: 'adult', hunger: 40 }, UID)
    expect(store._map.has('wilson.pet.' + UID)).toBe(true)
    // 🚨 The failing control. A save that also (or instead) wrote the
    // unattributed key would leave the leak exactly where it was.
    expect(store._map.has('wilson.pet')).toBe(false)
    expect(JSON.parse(store._map.get('wilson.pet.' + UID)).name).toBe('Dee')
  })

  it('🚨 returns NULL rather than minting when this account is new here', async () => {
    // Minting would hand resolveUserPet a pristine egg to reason about on every
    // first sign-in, and would flash a blank egg on screen before the account's
    // real pet arrives.
    vi.stubGlobal('localStorage', stubStorage())
    expect(await loadPet(UID)).toBeNull()
  })

  it('and still mints for the signed-out store, unchanged since Session 12', async () => {
    const store = stubStorage()
    vi.stubGlobal('localStorage', store)
    const pet = await loadPet()
    expect(pet).toBeTruthy()
    expect(pet.form).toBe('egg')
    expect(store._map.has('wilson.pet')).toBe(true)
  })

  it('🚨 one account cannot read another\'s cached pet', async () => {
    const store = stubStorage()
    vi.stubGlobal('localStorage', store)
    await savePetData({ name: 'Ollie', form: 'ghost' }, UID)
    expect(await loadPet('dddddddd-dddd-dddd-dddd-dddddddddddd')).toBeNull()
  })

  it('sign-out forgets that account\'s copy and leaves the others', async () => {
    const other = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
    const store = stubStorage()
    vi.stubGlobal('localStorage', store)
    await savePetData({ name: 'Ollie' }, UID)
    await savePetData({ name: 'Dee' }, other)
    expect(await clearPetCache(UID)).toBe(true)
    expect(store._map.has('wilson.pet.' + UID)).toBe(false)
    expect(store._map.has('wilson.pet.' + other)).toBe(true)
  })

  it('🚨 clearPetCache REFUSES to touch the unattributed store', async () => {
    // That file is nobody's account state, nothing reads it into an account any
    // more, and Audrey's original Ollie lives in one of them. A sign-out has no
    // business deleting a file it cannot attribute.
    const store = stubStorage()
    vi.stubGlobal('localStorage', store)
    await loadPet()                       // mints wilson.pet
    expect(await clearPetCache(null)).toBe(false)
    expect(store._map.has('wilson.pet')).toBe(true)
  })

  it('never throws, whatever the store does — a sign-out must not be trapped', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    })
    await expect(clearPetCache(UID)).resolves.toBe(false)
  })
})

describe('A3 — the desktop arm carries the owner in the query', () => {
  const UID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

  afterEach(() => { delete globalThis.window.electronAPI })

  function withServer(response) {
    globalThis.window = globalThis.window || {}
    globalThis.window.electronAPI = {}
    const fetchMock = vi.fn(async () => response)
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('names the account on the GET', async () => {
    const f = withServer({ ok: true, status: 200, json: async () => ({ name: 'Ollie' }) })
    await loadPet(UID)
    expect(f.mock.calls[0][0]).toBe('/api/pet?user=' + UID)
  })

  it('🚨 a 404 on the account arm is NULL, not an error', async () => {
    // "This account has never been cached on this computer" is the ordinary
    // first sign-in, and reporting it as a failure would put "your pet could
    // not be loaded" in front of everybody who opens WILSON on a new machine.
    const f = withServer({ ok: false, status: 404, json: async () => ({ error: 'none' }) })
    await expect(loadPet(UID)).resolves.toBeNull()
    expect(f).toHaveBeenCalledOnce()
  })

  it('but a 500 is still an error', async () => {
    withServer({ ok: false, status: 500, json: async () => ({ error: 'disk full' }) })
    await expect(loadPet(UID)).rejects.toThrow(/disk full/)
  })

  it('names the account on the POST and the DELETE', async () => {
    const f = withServer({ ok: true, status: 200, json: async () => ({ ok: true }) })
    await savePetData({ name: 'Ollie' }, UID)
    expect(f.mock.calls[0][0]).toBe('/api/pet?user=' + UID)
    expect(f.mock.calls[0][1].method).toBe('POST')
    await clearPetCache(UID)
    expect(f.mock.calls[1][0]).toBe('/api/pet?user=' + UID)
    expect(f.mock.calls[1][1].method).toBe('DELETE')
  })

  it('and sends no query at all when there is no account', async () => {
    const f = withServer({ ok: true, status: 200, json: async () => ({ form: 'egg' }) })
    await loadPet()
    expect(f.mock.calls[0][0]).toBe('/api/pet')
  })
})
