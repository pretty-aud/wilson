// =============================================================================
// avatarReads — a member's profile picture, read through a SIGNED URL
// (post-overhaul FX3, the Team tab's gallery).
//
// What the avatar is today, measured rather than assumed: `avatar_url` is the
// text a member writes on their own row, and the uploaders store the PUBLIC
// URL of the object they put in `user-avatars` (ProfileSection,
// NewUserWelcome: getPublicUrl). Everything that draws one passes it through
// isOwnAvatarUrl (only our own bucket's prefix, so a member cannot plant a
// tracking beacon) and puts that public bucket path in an <img src>. There was
// no signed read of an avatar anywhere until this file.
//
// The gallery draws only:
//   · a SIGNED URL for an object in `user-avatars`, minted here from the path
//     inside our own bucket's public URL — never the public path itself, so
//     the picture keeps working, and the gallery leaks nothing new, the day
//     the bucket goes private (TPN-CLOUD-004: today its SELECT is
//     unconditional and the anon key can enumerate it);
//   · the dev fixtures' generated SVG data URIs, in dev builds only (the same
//     exemption isOwnAvatarUrl makes: a data URI cannot beacon and is no
//     bucket path);
//   · otherwise nothing, and the card draws the initials.
//
// The path must be the uploaders' own shape — `{workspace_id}/{user_id}/{file}`,
// each part in the alphabet they write (`[A-Za-z0-9._-]`, never `.` or `..`) —
// and it must be THIS member's: the workspace and the user the card is about
// (review round 1, R1-05: `avatar_url` is the member's own text, so without
// that a member could point their card at another member's, or another
// workspace's, object).
//
// One read for a whole gallery: every path the cards need is signed in ONE
// createSignedUrls call (the thumbnails' rule, storage/thumbnails.js: a grid
// that round-trips per tile crawls), and the result is cached per path until
// five minutes before it expires, so switching views or tabs does not sign
// again; a gallery left open signs again before its links expire (R1-07), and
// a picture that fails to load is signed once more before it falls back to
// the initials. The cache is the signed-in person's: a sign-out, or another
// person signing in on the same window, empties it (R1-06). The pictures
// themselves are `loading="lazy"`: the browser fetches the ones on screen. A
// path the caller may not read, or a failed call, simply yields no URL.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../cloud/auth/supabaseClient'
import { isOwnAvatarUrl } from './useWorkspaceMembers'

export const AVATAR_BUCKET = 'user-avatars'
const SIGN_TTL_S = 3600
const REFRESH_MARGIN_MS = 5 * 60 * 1000
const PUBLIC_MARK = `/storage/v1/object/public/${AVATAR_BUCKET}/`
const SIGNED_MARK = `/storage/v1/object/sign/${AVATAR_BUCKET}/`
const SEGMENT = /^[A-Za-z0-9._-]+$/

/** A dev fixture's generated picture (dev builds only, via isOwnAvatarUrl). */
function isDevDataAvatar(url) {
  return typeof url === 'string' && url.startsWith('data:image/svg+xml') && isOwnAvatarUrl(url)
}

/**
 * The object path inside `user-avatars` for a URL our own bucket serves — the
 * uploaders' `{workspace_id}/{user_id}/{file}`, in their alphabet, and
 * belonging to `owner` ({ workspaceId, userId }) — or null for anything else.
 */
export function avatarObjectPath(url, owner) {
  if (!owner?.workspaceId || !owner?.userId) return null
  if (typeof url !== 'string' || url.startsWith('data:') || !isOwnAvatarUrl(url)) return null
  const at = url.indexOf(PUBLIC_MARK)
  if (at < 0) return null
  let path = url.slice(at + PUBLIC_MARK.length).split(/[?#]/)[0]
  try { path = decodeURIComponent(path) } catch { return null }
  const parts = path.split('/')
  if (parts.length !== 3) return null
  if (parts.some((seg) => !SEGMENT.test(seg) || seg === '.' || seg === '..')) return null
  if (parts[0] !== String(owner.workspaceId) || parts[1] !== String(owner.userId)) return null
  return path
}

/** Is this the signed read of an avatar on OUR Supabase (never a public path)? */
function isSignedAvatarUrl(url) {
  const base = import.meta.env.VITE_SUPABASE_URL
  return typeof url === 'string' && !!base && url.startsWith(`${base}${SIGNED_MARK}`)
}

// path → { url, expiresAt } and path → the call in flight for it. `generation`
// moves when the signed-in person changes, so a call still in flight for the
// person before writes nothing into the cache of the person after.
const cache = new Map()
const inflight = new Map()
let generation = 0
let signCalls = 0
let cacheUser

/** Empty the cache (a sign-out, another person signing in). */
function forget() { cache.clear(); inflight.clear(); generation += 1 }

try {
  supabase?.auth?.onAuthStateChange?.((_event, session) => {
    const uid = session?.user?.id ?? null
    if (uid !== cacheUser) { cacheUser = uid; forget() }
  })
} catch { /* no auth client (tests, a broken env): nothing to follow */ }

/** Tests only: forget every signed URL and the call count. */
export function _resetAvatarReadsForTests() { forget(); signCalls = 0; cacheUser = undefined }
/** Tests only: how many createSignedUrls calls this module has made. */
export function _avatarSignCallsForTests() { return signCalls }
/** Tests only: what an auth change does. */
export function _authChangedForTests(userId) { if (userId !== cacheUser) { cacheUser = userId; forget() } }

function fresh(path, now) {
  const c = cache.get(path)
  return c && c.expiresAt - REFRESH_MARGIN_MS > now ? c.url : null
}
function live(path, now) {
  const c = cache.get(path)
  return c && c.expiresAt > now ? c.url : null
}

/**
 * Sign the paths that are not already signed (or about to expire), in one
 * call, and resolve to path → signed URL for every path that has one.
 */
export async function signAvatarPaths(paths, { client = supabase, now = Date.now } = {}) {
  const unique = [...new Set((paths || []).filter(Boolean))]
  const t = now()
  const want = unique.filter((p) => !fresh(p, t) && !inflight.has(p))
  if (want.length > 0) {
    const gen = generation
    const job = (async () => {
      try {
        signCalls += 1
        const { data, error } = await client.storage.from(AVATAR_BUCKET).createSignedUrls(want, SIGN_TTL_S)
        if (error || gen !== generation) return
        for (const row of data || []) {
          if (row?.path && want.includes(row.path) && !row.error && isSignedAvatarUrl(row.signedUrl)) {
            cache.set(row.path, { url: row.signedUrl, expiresAt: t + SIGN_TTL_S * 1000 })
          }
        }
      } catch {
        // No URL: the card keeps its initials.
      } finally {
        if (gen === generation) for (const p of want) inflight.delete(p)
      }
    })()
    for (const p of want) inflight.set(p, job)
  }
  await Promise.all([...new Set(unique.map((p) => inflight.get(p)).filter(Boolean))])
  const out = new Map()
  const after = now()
  for (const p of unique) {
    const url = live(p, after)
    if (url) out.set(p, url)
  }
  return out
}

/**
 * For a list of `{ url, owner }`: `srcFor(url, owner)` is what a card may put
 * in an <img src> (a signed URL, a dev fixture's data URI, or null for the
 * initials), and `onFailed(url, owner)` handles a picture that failed to load
 * (signed once more, then the initials).
 */
export function useAvatarImages(items, { client } = {}) {
  const list = useMemo(() => (items || []).filter((i) => i?.url), [items])
  const paths = useMemo(() => [...new Set(list.map((i) => avatarObjectPath(i.url, i.owner)).filter(Boolean))], [list])
  const key = paths.join('\n')
  const [round, setRound] = useState(0)        // a re-sign: before expiry, or after a failed load
  const [, setSigned] = useState(0)            // a render once the call answers
  const [failed, setFailed] = useState(() => new Set())
  const [retried, setRetried] = useState(() => new Set())
  useEffect(() => {
    if (paths.length === 0) return undefined
    let alive = true
    let timer = null
    signAvatarPaths(paths, client ? { client } : undefined).then(() => {
      if (!alive) return
      setSigned((n) => n + 1)
      // Sign again five minutes before the earliest link ends.
      const ends = paths.map((p) => cache.get(p)?.expiresAt).filter(Boolean)
      if (ends.length > 0) {
        const wait = Math.max(0, Math.min(...ends) - REFRESH_MARGIN_MS - Date.now()) + 1000
        timer = setTimeout(() => { if (alive) setRound((r) => r + 1) }, wait)
      }
    })
    return () => { alive = false; if (timer) clearTimeout(timer) }
    // The key is the paths' contents: a new array with the same paths signs nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, client, round])
  const srcFor = useCallback((url, owner) => {
    if (!url || failed.has(url)) return null
    if (isDevDataAvatar(url)) return url
    const path = avatarObjectPath(url, owner)
    return path ? live(path, Date.now()) : null
  }, [failed])
  const onFailed = useCallback((url, owner) => {
    const path = avatarObjectPath(url, owner)
    if (path && !retried.has(url)) {
      // An expired or refused link: sign it once more.
      cache.delete(path)
      setRetried((prev) => new Set(prev).add(url))
      setRound((r) => r + 1)
      return
    }
    setFailed((prev) => (prev.has(url) ? prev : new Set(prev).add(url)))
  }, [retried])
  return { srcFor, onFailed }
}
