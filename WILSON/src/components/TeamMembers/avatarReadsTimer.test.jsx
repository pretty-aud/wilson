/** @vitest-environment jsdom */
// useAvatarImages over time (post-overhaul FX3 review round 2, R2-03): a
// gallery left open signs its pictures again five minutes before their hour
// ends, and a re-sign that fails (offline, refused) backs off — a minute, two,
// four, eight, then every ten — rather than asking once a second for as long
// as the gallery stays open. Fake clocks, the hook's own timers.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'

vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.co')
vi.mock('../../cloud/auth/supabaseClient', () => ({
  supabase: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } },
}))

const { useAvatarImages, _resetAvatarReadsForTests } = await import('./avatarReads')

const BASE = 'https://proj.supabase.co'
const PUBLIC = (p) => `${BASE}/storage/v1/object/public/user-avatars/${p}`
const OWNER = { workspaceId: 'ws1', userId: 'u1' }
const MIN = 60 * 1000

afterEach(() => { cleanup(); vi.useRealTimers() })

describe('useAvatarImages: the re-sign schedule', () => {
  it('signs again five minutes before the hour; offline, it backs off 1, 2, 4, 8, then 10 minutes — never once a second', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-10-12T10:00:00Z'))
    _resetAvatarReadsForTests()
    const state = { fail: false }
    const at = []
    const createSignedUrls = vi.fn(async (paths) => {
      at.push(Date.now())
      if (state.fail) return { data: null, error: { message: 'offline' } }
      return { data: paths.map((p) => ({ path: p, signedUrl: `${BASE}/storage/v1/object/sign/user-avatars/${p}?token=t${Date.now()}`, error: null })), error: null }
    })
    const client = { storage: { from: () => ({ createSignedUrls }) } }
    const items = [{ url: PUBLIC('ws1/u1/a.png'), owner: OWNER }]
    const { result } = renderHook(() => useAvatarImages(items, { client }))
    const step = async () => {
      await act(async () => { await vi.runOnlyPendingTimersAsync() })
      await act(async () => {})
    }
    await act(async () => {})
    expect(createSignedUrls).toHaveBeenCalledTimes(1)
    const first = result.current.srcFor(items[0].url, OWNER)
    expect(first).toContain('/object/sign/user-avatars/ws1/u1/a.png?token=')

    // The refresh: 55 minutes (and a second) after the first sign, a new link.
    await step()
    expect(at[1] - at[0]).toBe(55 * MIN + 1000)
    const second = result.current.srcFor(items[0].url, OWNER)
    expect(second).not.toBe(first)

    // Offline from here: the next refresh fails, and the retries back off.
    state.fail = true
    for (let k = 0; k < 7; k++) await step()
    const gaps = at.slice(2).map((t, i) => t - at[1 + i])
    expect(gaps).toEqual([55 * MIN + 1000, 1 * MIN, 2 * MIN, 4 * MIN, 8 * MIN, 10 * MIN, 10 * MIN])
    // Never sooner than a minute apart while failing.
    expect(Math.min(...gaps.slice(1))).toBeGreaterThanOrEqual(MIN)
    // Past the hour, the old link is not handed out: the initials.
    expect(result.current.srcFor(items[0].url, OWNER)).toBeNull()

    // Back online: the next attempt signs, and the schedule is an hour's again.
    state.fail = false
    await step()
    expect(result.current.srcFor(items[0].url, OWNER)).toContain('/object/sign/')
    await step()
    expect(at[at.length - 1] - at[at.length - 2]).toBe(55 * MIN + 1000)
  })
})
