// avatarReads (FX3): a profile picture is drawn only through a SIGNED read of
// our own `user-avatars` bucket — never its public path — in one batched,
// cached call.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.co')
// The real client's auth subscription, captured: the tests drive the module's OWN
// callback (review round 2, R2-05: a copy of its logic proved nothing).
const auth = vi.hoisted(() => ({ cb: null, unsubscribed: 0 }))
vi.mock('../../cloud/auth/supabaseClient', () => ({ supabase: {
  auth: { onAuthStateChange: (cb) => { auth.cb = cb; return { data: { subscription: { unsubscribe() { auth.unsubscribed += 1 } } } } } },
  storage: { from: () => { throw new Error('the default client is not used here') } },
} }))

const { avatarObjectPath, signAvatarPaths, _resetAvatarReadsForTests, _avatarSignCallsForTests, AVATAR_BUCKET } = await import('./avatarReads')
const OWNER = { workspaceId: 'ws1', userId: 'u1' }
/** What the auth client tells the module: someone signed in, or (null) no one. */
const authAs = (id, event = id ? 'SIGNED_IN' : 'SIGNED_OUT') => auth.cb(event, id ? { user: { id } } : null)

const BASE = 'https://proj.supabase.co'
const PUBLIC = (p) => `${BASE}/storage/v1/object/public/user-avatars/${p}`
const SIGNED = (p) => `${BASE}/storage/v1/object/sign/user-avatars/${p}?token=t-${p}`

/** A client whose createSignedUrls answers per path (or as told). */
function clientFor({ answer, fail = false, throws = false } = {}) {
  const createSignedUrls = vi.fn(async (paths, ttl) => {
    if (throws) throw new Error('network')
    if (fail) return { data: null, error: { message: 'denied' } }
    return { data: paths.map((p) => answer ? answer(p, ttl) : ({ path: p, signedUrl: SIGNED(p), error: null })), error: null }
  })
  const from = vi.fn(() => ({ createSignedUrls }))
  return { client: { storage: { from } }, from, createSignedUrls }
}

beforeEach(() => _resetAvatarReadsForTests())

describe('avatarObjectPath: only the uploaders\' path in our own bucket, and only this member\'s', () => {
  it('reads {workspace}/{user}/{file} out of our public URL, without its query or fragment', () => {
    expect(avatarObjectPath(PUBLIC('ws1/u1/1700-me.png'), OWNER)).toBe('ws1/u1/1700-me.png')
    expect(avatarObjectPath(PUBLIC('ws1/u1/1700-my_face.png?t=1#x'), OWNER)).toBe('ws1/u1/1700-my_face.png')
  })
  it('refuses another host, another bucket, a data URI, nothing, and a path with an empty or a dot segment', () => {
    for (const url of [
      'https://evil.example/storage/v1/object/public/user-avatars/ws1/u1/a.png',
      'https://proj.supabase.co.evil.example/storage/v1/object/public/user-avatars/ws1/u1/a.png',
      `${BASE}/storage/v1/object/public/rabbit-files/ws1/u1/a.png`,
      'data:image/png;base64,AAAA',
      null, undefined, '',
      PUBLIC('ws1//a.png'), PUBLIC('ws1/../u2/a.png'), PUBLIC('ws1/./a.png'), PUBLIC(''),
      PUBLIC('ws1/%E0%A4%A.png'), // a malformed escape
    ]) expect(avatarObjectPath(url, OWNER), String(url)).toBeNull()
  })
  it('review round 1, R1-05: an allowlist, not a denylist — the uploaders\' alphabet and shape only', () => {
    for (const url of [
      PUBLIC('ws1/u1/..%5C..%5Cx.png'),      // backslashes: one segment to split('/'), a path to the URL parser
      PUBLIC('ws1/u1/%252e%252e'),          // double-encoded dots: '%2e%2e' after one decode
      PUBLIC('ws1/u1/a%2Fb.png'),           // an encoded slash: four segments
      PUBLIC('ws1/u1/my%20face.png'),       // a space: never written (the uploaders write _)
      PUBLIC('ws1/u1/caf%C3%A9.png'),       // outside [A-Za-z0-9._-]
      PUBLIC('ws1/u1/..'), PUBLIC('ws1/u1/.'),
      PUBLIC('ws1/u1/sub/a.png'),           // not three parts
      PUBLIC('ws1/a.png'),
    ]) expect(avatarObjectPath(url, OWNER), String(url)).toBeNull()
  })
  it('R1-05: only THIS member\'s object — not another member\'s, not another workspace\'s, and nothing without an owner', () => {
    expect(avatarObjectPath(PUBLIC('ws1/u2/b.png'), OWNER)).toBeNull()
    expect(avatarObjectPath(PUBLIC('ws2/u1/a.png'), OWNER)).toBeNull()
    expect(avatarObjectPath(PUBLIC('ws1/u1/a.png'), null)).toBeNull()
    expect(avatarObjectPath(PUBLIC('ws1/u1/a.png'), { workspaceId: 'ws1' })).toBeNull()
    // CONTROL: the same URL is read for its owner.
    expect(avatarObjectPath(PUBLIC('ws1/u1/a.png'), OWNER)).toBe('ws1/u1/a.png')
  })
})

describe('signAvatarPaths: one batched call, cached, signed URLs only', () => {
  it('signs every path in ONE call to the avatars bucket, for an hour', async () => {
    const { client, from, createSignedUrls } = clientFor()
    const out = await signAvatarPaths(['ws1/a.png', 'ws1/b.png', 'ws1/a.png', null], { client })
    expect(from).toHaveBeenCalledTimes(1)
    expect(from).toHaveBeenCalledWith(AVATAR_BUCKET)
    expect(createSignedUrls).toHaveBeenCalledTimes(1)
    expect(createSignedUrls.mock.calls[0]).toEqual([['ws1/a.png', 'ws1/b.png'], 3600])
    expect([...out.entries()]).toEqual([['ws1/a.png', SIGNED('ws1/a.png')], ['ws1/b.png', SIGNED('ws1/b.png')]])
  })
  it('the cache: a second ask signs nothing; a new path alone is signed; near expiry it signs again', async () => {
    let t = 1_000_000
    const now = () => t
    const { client, createSignedUrls } = clientFor()
    await signAvatarPaths(['ws1/a.png'], { client, now })
    await signAvatarPaths(['ws1/a.png'], { client, now })
    expect(createSignedUrls).toHaveBeenCalledTimes(1)
    await signAvatarPaths(['ws1/a.png', 'ws1/c.png'], { client, now })
    expect(createSignedUrls.mock.calls[1][0]).toEqual(['ws1/c.png'])
    t += 56 * 60 * 1000 // inside the last five minutes of the hour
    await signAvatarPaths(['ws1/a.png'], { client, now })
    expect(createSignedUrls.mock.calls[2][0]).toEqual(['ws1/a.png'])
    expect(_avatarSignCallsForTests()).toBe(3)
  })
  it('two asks at once share the one call in flight', async () => {
    const { client, createSignedUrls } = clientFor()
    const [x, y] = await Promise.all([signAvatarPaths(['ws1/a.png'], { client }), signAvatarPaths(['ws1/a.png'], { client })])
    expect(createSignedUrls).toHaveBeenCalledTimes(1)
    expect([x.get('ws1/a.png'), y.get('ws1/a.png')]).toEqual([SIGNED('ws1/a.png'), SIGNED('ws1/a.png')])
  })
  it('never keeps a URL that is not a signed read of our avatars bucket (a public path, another host), nor a row with an error', async () => {
    const { client } = clientFor({ answer: (p) => ({
      'ws1/public.png': { path: p, signedUrl: PUBLIC(p), error: null },
      'ws1/other.png': { path: p, signedUrl: `https://evil.example/storage/v1/object/sign/user-avatars/${p}?token=x`, error: null },
      'ws1/denied.png': { path: p, signedUrl: null, error: 'Either the object does not exist or you do not have access to it' },
      'ws1/ok.png': { path: p, signedUrl: SIGNED(p), error: null },
    })[p] })
    const out = await signAvatarPaths(['ws1/public.png', 'ws1/other.png', 'ws1/denied.png', 'ws1/ok.png'], { client })
    expect([...out.keys()]).toEqual(['ws1/ok.png'])
    for (const url of out.values()) expect(url).not.toContain('/object/public/')
  })
  it('a refused call, or one that throws, yields nothing (the initials stand) and is asked again next time', async () => {
    const refused = clientFor({ fail: true })
    expect((await signAvatarPaths(['ws1/a.png'], { client: refused.client })).size).toBe(0)
    const thrown = clientFor({ throws: true })
    expect((await signAvatarPaths(['ws1/a.png'], { client: thrown.client })).size).toBe(0)
    const ok = clientFor()
    expect((await signAvatarPaths(['ws1/a.png'], { client: ok.client })).get('ws1/a.png')).toBe(SIGNED('ws1/a.png'))
  })
  it('nothing to sign: no call at all', async () => {
    const { client, createSignedUrls } = clientFor()
    expect((await signAvatarPaths([], { client })).size).toBe(0)
    expect(createSignedUrls).not.toHaveBeenCalled()
  })
  it('a row for a path that was not asked for is not kept (asked for later, it is signed afresh, not served from the cache)', async () => {
    const { client } = clientFor({ answer: () => ({ path: 'ws1/u9/planted.png', signedUrl: SIGNED('ws1/u9/planted.png'), error: null }) })
    expect((await signAvatarPaths(['ws1/a.png'], { client })).size).toBe(0)
    const refused = clientFor({ fail: true })
    expect((await signAvatarPaths(['ws1/u9/planted.png'], { client: refused.client })).size).toBe(0)
    expect(refused.createSignedUrls).toHaveBeenCalledTimes(1)
  })
  it('R1-07: a link past its hour is never handed out, even when signing it again fails', async () => {
    let t = 5_000_000
    const now = () => t
    const ok = clientFor()
    expect((await signAvatarPaths(['ws1/a.png'], { client: ok.client, now })).get('ws1/a.png')).toBe(SIGNED('ws1/a.png'))
    t += 61 * 60 * 1000
    const refused = clientFor({ fail: true })
    expect((await signAvatarPaths(['ws1/a.png'], { client: refused.client, now })).size).toBe(0)
  })
})

describe('review round 1, R1-06: the cache is the signed-in person\'s', () => {
  it('the module follows the real auth client: it subscribed once, at load (R2-05)', () => {
    expect(typeof auth.cb).toBe('function')
  })
  it('another person signing in (or a sign-out) empties it: the next ask signs under the new session', async () => {
    authAs('user-a')
    const { client, createSignedUrls } = clientFor()
    await signAvatarPaths(['ws1/a.png'], { client })
    await signAvatarPaths(['ws1/a.png'], { client })
    expect(createSignedUrls).toHaveBeenCalledTimes(1)
    authAs('user-a', 'TOKEN_REFRESHED') // the same person again: kept
    await signAvatarPaths(['ws1/a.png'], { client })
    expect(createSignedUrls).toHaveBeenCalledTimes(1)
    authAs('user-b')
    await signAvatarPaths(['ws1/a.png'], { client })
    expect(createSignedUrls).toHaveBeenCalledTimes(2)
    authAs(null) // signed out
    await signAvatarPaths(['ws1/a.png'], { client })
    expect(createSignedUrls).toHaveBeenCalledTimes(3)
  })
  it('a call still in flight for the person before writes nothing into the cache of the person after', async () => {
    authAs('user-a')
    let release
    const gate = new Promise((r) => { release = r })
    const slow = clientFor({ answer: (p) => ({ path: p, signedUrl: SIGNED(p), error: null }) })
    slow.createSignedUrls.mockImplementationOnce(async (paths) => { await gate; return { data: paths.map((p) => ({ path: p, signedUrl: SIGNED(p), error: null })), error: null } })
    const pending = signAvatarPaths(['ws1/a.png'], { client: slow.client })
    authAs('user-b')
    release()
    expect((await pending).size).toBe(0)
    // …and user B's own ask signs afresh.
    const b = clientFor()
    expect((await signAvatarPaths(['ws1/a.png'], { client: b.client })).get('ws1/a.png')).toBe(SIGNED('ws1/a.png'))
    expect(b.createSignedUrls).toHaveBeenCalledTimes(1)
  })
})
