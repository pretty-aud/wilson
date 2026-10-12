// avatarReads (FX3): a profile picture is drawn only through a SIGNED read of
// our own `user-avatars` bucket — never its public path — in one batched,
// cached call.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.co')
vi.mock('../../cloud/auth/supabaseClient', () => ({ supabase: { storage: { from: () => { throw new Error('the default client is not used here') } } } }))

const { avatarObjectPath, signAvatarPaths, _resetAvatarReadsForTests, _avatarSignCallsForTests, AVATAR_BUCKET } = await import('./avatarReads')

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

describe('avatarObjectPath: only a path inside our own bucket', () => {
  it('reads the object path out of our public URL, decoded, without its query', () => {
    expect(avatarObjectPath(PUBLIC('ws1/u1/1700-me.png'))).toBe('ws1/u1/1700-me.png')
    expect(avatarObjectPath(PUBLIC('ws1/u1/my%20face.png?t=1'))).toBe('ws1/u1/my face.png')
  })
  it('refuses another host, another bucket, a data URI, nothing, and a path with an empty or a dot segment', () => {
    for (const url of [
      'https://evil.example/storage/v1/object/public/user-avatars/ws1/u1/a.png',
      `${BASE}/storage/v1/object/public/rabbit-files/ws1/u1/a.png`,
      'data:image/png;base64,AAAA',
      null, undefined, '',
      PUBLIC('ws1//a.png'), PUBLIC('ws1/../u2/a.png'), PUBLIC('ws1/./a.png'), PUBLIC(''),
      PUBLIC('ws1/%E0%A4%A.png'), // a malformed escape
    ]) expect(avatarObjectPath(url), String(url)).toBeNull()
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
})
