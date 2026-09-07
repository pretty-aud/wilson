// =============================================================================
// libraryMode.test.js — A4, Audrey's decision 3
//
// "Signing in on the desktop hides the six local courses with no way back."
// The way back is `setOtterAdapterMode`, which until this bundle had ZERO
// callers: the two comments elsewhere calling it "the Settings override"
// described a control nobody had built.
//
// These are BEHAVIOURAL, not a source scan. The module reads its pin at module
// load, so every test resets the module registry and imports it fresh with the
// globals it should see — which is also the only way to exercise the browser
// refusal, since `isBrowserBuild()` is decided from `window` at call time.
//
// The Supabase client is stubbed because importing the real one at module scope
// wants env the node test environment does not have; the stub's ONLY job is to
// answer getSession(), which is the input cloudActive() actually routes on.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let sessionToReturn = null

vi.mock('../../../cloud/auth/supabaseClient.js', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: sessionToReturn } }) },
  },
}))

const KEY = 'wilson.otter.libraryMode'

/** A token whose payload carries a workspace_id, which is what cloudActive
 *  decodes. Only the middle segment is ever read. */
function signedInSession(workspaceId = 'ws-1') {
  const payload = btoa(JSON.stringify({ app_metadata: { workspace_id: workspaceId } }))
  return { access_token: 'header.' + payload + '.signature' }
}

function installStorage(initial = {}) {
  const store = { ...initial }
  globalThis.localStorage = {
    getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v) },
    removeItem: k => { delete store[k] },
  }
  return store
}

/** Desktop = a window carrying electronAPI. Browser = a window without one.
 *  `undefined` leaves `window` absent, as the node environment has it. */
function installWindow(kind) {
  if (kind === 'desktop') globalThis.window = { electronAPI: {} }
  else if (kind === 'browser') globalThis.window = {}
  else delete globalThis.window
}

async function freshModule() {
  vi.resetModules()
  return import('./index.js')
}

beforeEach(() => {
  sessionToReturn = null
  installStorage()
  installWindow('desktop')
})

afterEach(() => {
  delete globalThis.localStorage
  installWindow(undefined)
})

describe('the library pin is remembered for this device', () => {
  it('defaults to auto when nothing is stored', async () => {
    const m = await freshModule()
    expect(m.getOtterAdapterMode()).toBe('auto')
  })

  it('🚨 a stored pin is in force at module load — not only after the UI sets it', async () => {
    // The case this closes is a RESTART: flip to "This computer", quit, reopen.
    // A pin held only in memory would silently be gone by then.
    installStorage({ [KEY]: 'local' })
    const m = await freshModule()
    expect(m.getOtterAdapterMode()).toBe('local')
  })

  it('writes the pin, and clears the key entirely when set back to auto', async () => {
    const store = installStorage()
    const m = await freshModule()
    m.setOtterAdapterMode('local')
    expect(store[KEY]).toBe('local')
    m.setOtterAdapterMode('auto')
    expect(Object.prototype.hasOwnProperty.call(store, KEY)).toBe(false)
  })

  it('persist:false changes the mode without touching storage', async () => {
    const store = installStorage()
    const m = await freshModule()
    m.setOtterAdapterMode('local', { persist: false })
    expect(m.getOtterAdapterMode()).toBe('local')
    expect(Object.prototype.hasOwnProperty.call(store, KEY)).toBe(false)
  })

  it('an unknown value falls back to auto rather than pinning nonsense', async () => {
    const m = await freshModule()
    expect(m.setOtterAdapterMode('sideways')).toBe('auto')
    expect(m.getOtterAdapterMode()).toBe('auto')
  })

  it('survives storage that throws — a pin is best-effort, the app is not', async () => {
    globalThis.localStorage = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
      removeItem: () => { throw new Error('denied') },
    }
    const m = await freshModule()
    expect(m.getOtterAdapterMode()).toBe('auto')
    expect(() => m.setOtterAdapterMode('local')).not.toThrow()
    expect(m.getOtterAdapterMode()).toBe('local')
  })
})

describe('the pin decides where otterFetch routes', () => {
  it('🚨 THE WHOLE POINT: signed in to a workspace, pinned local, cloud is OFF', async () => {
    sessionToReturn = signedInSession()
    const m = await freshModule()
    expect(await m.otterCloudActive()).toBe(true)      // control: auto follows the session
    m.setOtterAdapterMode('local')
    expect(await m.otterCloudActive()).toBe(false)     // the fix
  })

  it('auto with no session is local anyway', async () => {
    const m = await freshModule()
    expect(await m.otterCloudActive()).toBe(false)
  })

  it('a supabase pin forces cloud on even with no session', async () => {
    // Not offered by the Settings control precisely because of this; pinned
    // here only to prove the third arm is still wired.
    const m = await freshModule()
    m.setOtterAdapterMode('supabase')
    expect(await m.otterCloudActive()).toBe(true)
  })
})

describe('a local pin cannot strand the web build', () => {
  it('🚨 refuses a stored local pin in a browser, where there is no Express server', async () => {
    // Honouring it would answer 401 on every content route and leave the
    // library permanently empty, with the control that undoes it off-screen.
    installWindow('browser')
    installStorage({ [KEY]: 'local' })
    const m = await freshModule()
    expect(m.getOtterAdapterMode()).toBe('auto')
  })

  it('refuses a local pin set at runtime in a browser', async () => {
    installWindow('browser')
    const m = await freshModule()
    expect(m.setOtterAdapterMode('local')).toBe('auto')
    expect(m.getOtterAdapterMode()).toBe('auto')
  })

  it('control: the same pin IS honoured on the desktop', async () => {
    installWindow('desktop')
    const m = await freshModule()
    expect(m.setOtterAdapterMode('local')).toBe('local')
  })
})

describe('subscribers, so nothing keeps answering from the old library', () => {
  it('notifies on a real change, with the new mode', async () => {
    const m = await freshModule()
    const seen = []
    m.subscribeOtterAdapterMode(v => seen.push(v))
    m.setOtterAdapterMode('local')
    expect(seen).toEqual(['local'])
  })

  it('🚨 does NOT notify when the mode did not actually move', async () => {
    // Otter.jsx's listener throws away every cached course and closes the open
    // one. Firing that on a no-op click would look like the app losing the
    // user's place for no reason.
    const m = await freshModule()
    m.setOtterAdapterMode('local')
    const seen = []
    m.subscribeOtterAdapterMode(v => seen.push(v))
    m.setOtterAdapterMode('local')
    expect(seen).toEqual([])
  })

  it('🚨 listeners receive the NORMALISED mode, not the raw argument', async () => {
    // Otter.jsx mirrors the value straight into state and compares it against
    // 'local'. Handing it the unnormalised argument would leave the Settings
    // control highlighting nothing and the notice reading the wrong way round,
    // while getOtterAdapterMode() said something else entirely.
    const m = await freshModule()
    m.setOtterAdapterMode('local')
    const seen = []
    m.subscribeOtterAdapterMode(v => seen.push(v))
    m.setOtterAdapterMode('sideways')      // normalises to 'auto'
    expect(seen).toEqual(['auto'])
    expect(m.getOtterAdapterMode()).toBe('auto')
  })

  it('unsubscribes', async () => {
    const m = await freshModule()
    const seen = []
    const off = m.subscribeOtterAdapterMode(v => seen.push(v))
    off()
    m.setOtterAdapterMode('local')
    expect(seen).toEqual([])
  })

  it('🚨 one listener that throws does not strand the others', async () => {
    // The pet-index clear and the Otter view reset are independent listeners.
    // Losing the index clear because the view reset threw is the Phase 6 bug back.
    const m = await freshModule()
    const seen = []
    m.subscribeOtterAdapterMode(() => { throw new Error('boom') })
    m.subscribeOtterAdapterMode(v => seen.push(v))
    expect(() => m.setOtterAdapterMode('local')).not.toThrow()
    expect(seen).toEqual(['local'])
  })

  it('🚨 a listener that subscribes DURING a notify is not called in that pass', async () => {
    // The reason the notify loop iterates a COPY. Two earlier versions of
    // this test asserted self-unsubscription instead and were vacuous:
    // deleting the current element of a Set mid-iteration is well defined and
    // skips nothing, so they passed against the live-Set mutation too.
    // Subscribing mid-pass is the case that actually differs -- live
    // iteration calls the new listener for a change it never subscribed to,
    // and a listener that resubscribes would not terminate at all.
    const m = await freshModule()
    const late = []
    m.subscribeOtterAdapterMode(() => {
      m.subscribeOtterAdapterMode(v => late.push(v))
    })
    m.setOtterAdapterMode('local')
    expect(late).toEqual([])            // not this pass
    m.setOtterAdapterMode('auto')
    expect(late).toEqual(['auto'])      // but it IS subscribed for the next one
  })

  it('a listener that unsubscribes itself still lets the others run', async () => {
    const m = await freshModule()
    const seen = []
    let off1
    off1 = m.subscribeOtterAdapterMode(() => { off1() })
    m.subscribeOtterAdapterMode(v => seen.push(v))
    m.setOtterAdapterMode('local')
    expect(seen).toEqual(['local'])
    // …and it really did come off: the next change reaches only the second.
    m.setOtterAdapterMode('auto')
    expect(seen).toEqual(['local', 'auto'])
  })
})
