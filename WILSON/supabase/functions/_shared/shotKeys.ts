// =============================================================================
// _shared/shotKeys.ts — post-overhaul S4c (review round 1, item 1).
//
// A shot's objects in rabbit-files have TWO key shapes:
//
//   projects/<pid>/shots/<shotId>/<leaf…>               before S4c
//   projects/<pid>/scenes/<sceneId>/<shotId>/<leaf…>    since S4c
//
// The one-time re-filing (supabaseAdapter.refileShotFolders) moves each
// object from the first to the second and rewrites its files row at once —
// but "at once" is one round trip, and a run that stops between the two (the
// app closed, the laptop asleep) leaves an object that NO row names. Under
// storage-gc's rule as it stood, that object was certified garbage 24 hours
// later: "no files row references this object". It is not garbage; it is a
// file mid-move, and the next run of the re-filing finds it (an object at
// its new key with nothing at the old is "landed earlier") and rewrites its
// row. So an object whose TWIN key a row names is kept.
//
// The predicate below gives the LIKE pattern of the other shape: for a
// legacy key the scene id is not in the key, so any scene matches; for a
// nested key the twin is exact. The pattern is LIKE-escaped (a leaf may
// carry `_`, which LIKE would read as a wildcard). It is pinned against the
// renderer's shotRefiling.js — the same two shapes, from the other side of
// the Deno wall — by storageGcShotTwins.test.js, the treatment
// reservedObjects.ts gets.
// =============================================================================

function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/**
 * The LIKE pattern a files row's storage_path would match if it names the
 * OTHER shape of this shot object's key, or null for a key that is not a
 * shot object's (a scene's own file, a project-root object, anything else).
 */
export function shotKeyTwinPattern(path: string): string | null {
  if (typeof path !== 'string') return null
  const s = path.split('/')
  if (s[0] !== 'projects' || !s[1]) return null
  if (s[2] === 'shots' && s.length >= 5 && s[3] && s[4]) {
    return `projects/${likeEscape(s[1])}/scenes/%/${likeEscape(s[3])}/${likeEscape(s.slice(4).join('/'))}`
  }
  if (s[2] === 'scenes' && s.length >= 6 && s[3] && s[4] && s[5]) {
    return `projects/${likeEscape(s[1])}/shots/${likeEscape(s[4])}/${likeEscape(s.slice(5).join('/'))}`
  }
  return null
}
