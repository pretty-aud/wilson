// =============================================================================
// localServerFetch.test.js — Bundle B3 (Track B).
//
// The security property under test is NEGATIVE and it is the one worth having:
// the per-launch loopback token must never be attached to a URL that is not
// ours. otterFetch hands this helper whatever a call site passed it, and
// `fetchImpl` is injected from outside in two more places, so "attach the
// header to everything" would post the launch secret to api.anthropic.com the
// first time somebody widened a caller.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  LOCAL_TOKEN_HEADER,
  localServerToken,
  isLocalServerUrl,
  withLocalToken,
  localFetch,
} from './localServerFetch.js'

const TOKEN = 'a'.repeat(64)

/** The desktop: a preload bridge carrying a token, on the loopback origin. */
function asDesktop({ token = TOKEN, origin = 'http://127.0.0.1:49876' } = {}) {
  globalThis.window = {
    electronAPI: { localServerToken: token },
    location: { origin, href: `${origin}/` },
  }
}

/** The web build: a window, no bridge. */
function asWeb(origin = 'https://beta.petalstudios.co') {
  globalThis.window = { location: { origin, href: `${origin}/wilson/` } }
}

beforeEach(() => { delete globalThis.window })
afterEach(() => { delete globalThis.window; vi.restoreAllMocks() })

describe('localServerToken', () => {
  it('is null with no window at all (node, vitest)', () => {
    expect(localServerToken()).toBeNull()
  })

  it('is null on the web build, where electronAPI does not exist', () => {
    asWeb()
    expect(localServerToken()).toBeNull()
  })

  it('is null rather than "" when the bridge hands back an empty string', () => {
    asDesktop({ token: '' })
    expect(localServerToken()).toBeNull()
  })

  it('reads the token off the preload bridge on the desktop', () => {
    asDesktop()
    expect(localServerToken()).toBe(TOKEN)
  })
})

describe('isLocalServerUrl', () => {
  beforeEach(() => asDesktop())

  it('accepts a root-relative path', () => {
    expect(isLocalServerUrl('/api/rabbit/projects')).toBe(true)
  })

  it('accepts an absolute URL on the renderer origin', () => {
    expect(isLocalServerUrl('http://127.0.0.1:49876/api/pet')).toBe(true)
  })

  it('refuses a protocol-relative URL, which points at another host', () => {
    expect(isLocalServerUrl('//evil.example/api/rabbit/projects')).toBe(false)
  })

  it('refuses another port on the same loopback host', () => {
    expect(isLocalServerUrl('http://127.0.0.1:1/api/pet')).toBe(false)
  })

  it('refuses an external https origin', () => {
    expect(isLocalServerUrl('https://api.anthropic.com/v1/messages')).toBe(false)
  })

  it('refuses an unparseable or empty URL instead of throwing', () => {
    expect(isLocalServerUrl('')).toBe(false)
    expect(isLocalServerUrl(undefined)).toBe(false)
    expect(isLocalServerUrl('http://[')).toBe(false)
  })

  it('reads .url off a Request-shaped input', () => {
    expect(isLocalServerUrl({ url: '/api/software' })).toBe(true)
    expect(isLocalServerUrl({ url: 'https://api.anthropic.com/v1/messages' })).toBe(false)
  })
})

describe('withLocalToken', () => {
  it('leaves init untouched when there is no bridge (web build)', () => {
    asWeb()
    expect(withLocalToken('/api/pet', undefined)).toBeUndefined()
    const init = { method: 'POST' }
    expect(withLocalToken('/api/pet', init)).toBe(init)
  })

  it('🚨 never attaches the token to a foreign origin', () => {
    asDesktop()
    const init = { headers: { 'content-type': 'application/json' } }
    expect(withLocalToken('https://api.anthropic.com/v1/messages', init)).toBe(init)
  })

  it('attaches the header for a loopback path', () => {
    asDesktop()
    const out = withLocalToken('/api/rabbit/projects', undefined)
    expect(out.headers[LOCAL_TOKEN_HEADER]).toBe(TOKEN)
  })

  it('keeps the caller’s own headers and does not mutate the caller’s init', () => {
    asDesktop()
    const init = { method: 'POST', headers: { 'content-type': 'application/json' } }
    const out = withLocalToken('/api/pet', init)
    expect(out.method).toBe('POST')
    expect(out.headers['content-type']).toBe('application/json')
    expect(out.headers[LOCAL_TOKEN_HEADER]).toBe(TOKEN)
    expect(init.headers[LOCAL_TOKEN_HEADER]).toBeUndefined()
  })

  it('handles a Headers instance', () => {
    asDesktop()
    const out = withLocalToken('/api/pet', { headers: new Headers({ accept: 'application/json' }) })
    expect(out.headers.get(LOCAL_TOKEN_HEADER)).toBe(TOKEN)
    expect(out.headers.get('accept')).toBe('application/json')
  })

  it('handles an entry-array HeadersInit', () => {
    asDesktop()
    const out = withLocalToken('/api/pet', { headers: [['accept', 'application/json']] })
    expect(out.headers).toContainEqual([LOCAL_TOKEN_HEADER, TOKEN])
    expect(out.headers).toContainEqual(['accept', 'application/json'])
  })

  it('keeps a Request’s own headers when init has none', () => {
    // fetch(request, { headers }) REPLACES rather than merges, so a Request's
    // content-type would vanish if we built headers from nothing.
    asDesktop()
    const req = { url: '/api/pet', headers: new Headers({ 'content-type': 'application/json' }) }
    const out = withLocalToken(req, undefined)
    expect(out.headers.get('content-type')).toBe('application/json')
    expect(out.headers.get(LOCAL_TOKEN_HEADER)).toBe(TOKEN)
  })

  it('a caller cannot spoof the header under a different case', () => {
    asDesktop()
    const out = withLocalToken('/api/pet', { headers: { 'X-Wilson-Local-Token': 'not-the-token' } })
    const values = Object.entries(out.headers)
      .filter(([k]) => k.toLowerCase() === LOCAL_TOKEN_HEADER)
      .map(([, v]) => v)
    expect(values).toEqual([TOKEN])
  })
})

describe('localFetch', () => {
  it('passes the token through to fetch for a loopback URL', async () => {
    asDesktop()
    const spy = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', spy)
    await localFetch('/api/pet')
    expect(spy.mock.calls[0][1].headers[LOCAL_TOKEN_HEADER]).toBe(TOKEN)
  })

  it('is a bare fetch off the desktop', async () => {
    asWeb()
    const spy = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', spy)
    await localFetch('/api/pet')
    expect(spy).toHaveBeenCalledWith('/api/pet', undefined)
  })
})
