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
// One read for a whole gallery: every path the cards need is signed in ONE
// createSignedUrls call (the thumbnails' rule, storage/thumbnails.js: a grid
// that round-trips per tile crawls), and the result is cached per path until
// five minutes before it expires, so switching views or tabs does not sign
// again. The pictures themselves are `loading="lazy"`: the browser fetches
// the ones on screen. A path the caller may not read, or a failed call,
// simply yields no URL: the initials stand.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../cloud/auth/supabaseClient'
import { isOwnAvatarUrl } from './useWorkspaceMembers'

export const AVATAR_BUCKET = 'user-avatars'
const SIGN_TTL_S = 3600
const REFRESH_MARGIN_MS = 5 * 60 * 1000
const PUBLIC_MARK = `/storage/v1/object/public/${AVATAR_BUCKET}/`
const SIGNED_MARK = `/storage/v1/object/sign/${AVATAR_BUCKET}/`

/** A dev fixture's generated picture (dev builds only, via isOwnAvatarUrl). */
function isDevDataAvatar(url) {
  return typeof url === 'string' && url.startsWith('data:image/svg+xml') && isOwnAvatarUrl(url)
}

/**
 * The object path inside `user-avatars` for a URL our own bucket serves, or
 * null for anything else (another host, another bucket, a data URI, a path
 * with an empty or a dot segment).
 */
export function avatarObjectPath(url) {
  if (typeof url !== 'string' || url.startsWith('data:') || !isOwnAvatarUrl(url)) return null
  const at = url.indexOf(PUBLIC_MARK)
  if (at < 0) return null
  let path = url.slice(at + PUBLIC_MARK.length).split(/[?#]/)[0]
  try { path = decodeURIComponent(path) } catch { return null }
  if (!path || path.split('/').some((seg) => !seg || seg === '.' || seg === '..')) return null
  return path
}

/** Is this the signed read of an avatar on OUR Supabase (never a public path)? */
function isSignedAvatarUrl(url) {
  const base = import.meta.env.VITE_SUPABASE_URL
  return typeof url === 'string' && !!base && url.startsWith(`${base}${SIGNED_MARK}`)
}

// path → { url, expiresAt } and path → the call in flight for it.
const cache = new Map()
const inflight = new Map()
let signCalls = 0

/** Tests only: forget every signed URL and the call count. */
export function _resetAvatarReadsForTests() { cache.clear(); inflight.clear(); signCalls = 0 }
/** Tests only: how many createSignedUrls calls this module has made. */
export function _avatarSignCallsForTests() { return signCalls }

function fresh(path, now) {
  const c = cache.get(path)
  return c && c.expiresAt - REFRESH_MARGIN_MS > now ? c.url : null
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
    const job = (async () => {
      try {
        signCalls += 1
        const { data, error } = await client.storage.from(AVATAR_BUCKET).createSignedUrls(want, SIGN_TTL_S)
        if (error) return
        for (const row of data || []) {
          if (row?.path && !row.error && isSignedAvatarUrl(row.signedUrl)) {
            cache.set(row.path, { url: row.signedUrl, expiresAt: t + SIGN_TTL_S * 1000 })
          }
        }
      } catch {
        // No URL: the card keeps its initials.
      } finally {
        for (const p of want) inflight.delete(p)
      }
    })()
    for (const p of want) inflight.set(p, job)
  }
  await Promise.all([...new Set(unique.map((p) => inflight.get(p)).filter(Boolean))])
  const out = new Map()
  const after = now()
  for (const p of unique) {
    const c = cache.get(p)
    if (c && c.expiresAt > after) out.set(p, c.url)
  }
  return out
}

/**
 * For a list of avatar URLs: `srcFor(url)` is what a card may put in an
 * <img src> (a signed URL, a dev fixture's data URI, or null for the
 * initials), and `markFailed(url)` drops a picture that failed to load.
 */
export function useAvatarImages(urls, { client } = {}) {
  const list = useMemo(() => [...new Set((urls || []).filter(Boolean))], [urls])
  const key = list.join('\n')
  const [signed, setSigned] = useState(() => new Map())
  const [failed, setFailed] = useState(() => new Set())
  useEffect(() => {
    const paths = [...new Set(list.map(avatarObjectPath).filter(Boolean))]
    if (paths.length === 0) return undefined
    let live = true
    signAvatarPaths(paths, client ? { client } : undefined).then((m) => { if (live) setSigned(m) })
    return () => { live = false }
    // The key is the list's contents: a new array with the same URLs signs nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, client])
  const srcFor = useCallback((url) => {
    if (!url || failed.has(url)) return null
    if (isDevDataAvatar(url)) return url
    const path = avatarObjectPath(url)
    if (!path) return null
    return signed.get(path) || fresh(path, Date.now()) || null
  }, [signed, failed])
  const markFailed = useCallback((url) => {
    setFailed((prev) => (prev.has(url) ? prev : new Set(prev).add(url)))
  }, [])
  return { srcFor, markFailed }
}
