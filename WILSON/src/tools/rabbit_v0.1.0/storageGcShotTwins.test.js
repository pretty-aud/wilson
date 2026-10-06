// =============================================================================
// storageGcShotTwins.test.js — post-overhaul S4c, review round 1 (item 1).
//
// 🚨 THE GARBAGE COLLECTOR WOULD HAVE DELETED A SHOT'S FILE MID-MOVE.
//
// The one-time re-filing moves each shot object from its old key
// (projects/<pid>/shots/<shotId>/<leaf>) to its nested one
// (projects/<pid>/scenes/<sceneId>/<shotId>/<leaf>) and rewrites the files
// row at once — but "at once" is one round trip, and a run that stops
// between the two (the app closed, the laptop asleep, the network gone)
// leaves an object no row names. storage-gc's orphan scan deleted exactly
// that, 24 hours later, certified "no files row references this object".
// The next re-filing run would have found the object at its new key with
// nothing at the old and counted it landed — had it still been there.
//
// So the scan now asks, for an unreferenced object, whether a row names the
// OTHER shape of its key, and keeps it if one does. The predicate lives in
// _shared/shotKeys.ts (Deno cannot import the renderer's modules — the
// reservedObjects.ts precedent), and this file pins it against the
// renderer's own two shapes (shotRefiling.js), so the two sides of the wall
// cannot drift, and pins the CALL SITE in comment-stripped source (S36's
// lesson: a guard nobody calls is this project's most expensive pattern).
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

import { shotKeyTwinPattern } from '../../../supabase/functions/_shared/shotKeys.ts'
import { shotObjectPrefix, nestedShotKey } from './shotRefiling'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf-8')
const GC_SRC = read('../../../supabase/functions/storage-gc/index.ts')

/** Comments out, so a scan sees CODE (storageGcReserved.test.js's stripper). */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')
    .replace(/\/\/.*$/gm, ' ')
}
const GC = stripComments(GC_SRC)

/** Postgres LIKE, as a RegExp: `%` any run, `_` any one character, backslash escapes. */
function likeToRegExp(pattern) {
  const esc = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let out = '^'
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '\\' && i + 1 < pattern.length) { out += esc(pattern[++i]); continue }
    if (c === '%') { out += '.*'; continue }
    if (c === '_') { out += '.'; continue }
    out += esc(c)
  }
  return new RegExp(out + '$')
}
const matches = (pattern, key) => likeToRegExp(pattern).test(key)

const PID = '9926a8f7-7c8d-43ef-b327-8a766d8c1b0d'
const SC = '1b7c1e2a-0000-4000-8000-000000000001'
const SH = '2c8d2f3b-0000-4000-8000-000000000002'
const ctx = { projectId: PID, sceneId: SC, shotId: SH }

describe('the twin pattern agrees with the renderer\'s two key shapes', () => {
  const legacy = `${shotObjectPrefix(PID, null, SH)}/1759700000000-plate_v001.exr`
  const nested = nestedShotKey(legacy, ctx)

  it('the old key\'s twin pattern matches the nested key the re-filing writes (any scene), and nothing else of the shot', () => {
    expect(nested).toBe(`projects/${PID}/scenes/${SC}/${SH}/1759700000000-plate_v001.exr`)
    const pattern = shotKeyTwinPattern(legacy)
    expect(matches(pattern, nested)).toBe(true)
    // The leaf is matched whole: `_` in it is a character, not a wildcard.
    expect(matches(pattern, nested.replace('plate_v001', 'plateXv001'))).toBe(false)
    expect(matches(pattern, nested.replace('.exr', '.exr.jpg'))).toBe(false)
    // Another shot's object under the same scene is not this one's twin.
    expect(matches(pattern, nested.replace(SH, '3d9e3a4c-0000-4000-8000-000000000003'))).toBe(false)
  })

  it('the nested key\'s twin is the old key, exactly', () => {
    const pattern = shotKeyTwinPattern(nested)
    expect(matches(pattern, legacy)).toBe(true)
    expect(pattern.includes('%')).toBe(false)
    expect(matches(pattern, legacy.replace('plate_v001', 'plateXv001'))).toBe(false)
  })

  it('the thumbnail\'s keys (the same shapes with .jpg) twin the same way', () => {
    const thumb = `${legacy}.jpg`
    expect(matches(shotKeyTwinPattern(thumb), `${nested}.jpg`)).toBe(true)
    expect(matches(shotKeyTwinPattern(`${nested}.jpg`), thumb)).toBe(true)
  })

  it('CONTROL: a scene\'s own file, an asset\'s, a project-root object and a reserved object have no twin', () => {
    expect(shotKeyTwinPattern(`projects/${PID}/scenes/${SC}/1759700000000-board.png`)).toBeNull()
    expect(shotKeyTwinPattern(`projects/${PID}/assets/${SH}/1759700000000-model.fbx`)).toBeNull()
    expect(shotKeyTwinPattern(`projects/${PID}/PROJECT.json`)).toBeNull()
    expect(shotKeyTwinPattern(`projects/${PID}/FINANCE/RATES.json`)).toBeNull()
    expect(shotKeyTwinPattern(`projects/${PID}/shots/${SH}`)).toBeNull()
    expect(shotKeyTwinPattern('avatars/u1.png')).toBeNull()
    expect(shotKeyTwinPattern('')).toBeNull()
    expect(shotKeyTwinPattern(null)).toBeNull()
  })
})

describe('the orphan scan asks before it deletes', () => {
  it('the stripper actually strips (an instrument that cannot see a presence proves nothing about an absence)', () => {
    expect(stripComments('a // b\n/* c */ d').replace(/\s+/g, ' ').trim()).toBe('a d')
  })

  it('storage-gc imports the predicate, asks it of each unreferenced object BEFORE the reserved check and the remove, and counts what it kept', () => {
    expect(GC).toMatch(/import \{ shotKeyTwinPattern \} from '\.\.\/_shared\/shotKeys\.ts'/)
    const ask = GC.indexOf('shotKeyTwinPattern(obj.path)')
    const kept = GC.indexOf('counts.skipped_twin++')
    const reserved = GC.indexOf('isReservedProjectObject(obj.path)')
    const remove = GC.indexOf('.remove([obj.path])')
    for (const i of [ask, kept, reserved, remove]) expect(i).toBeGreaterThan(-1)
    expect(ask).toBeLessThan(kept)
    expect(kept).toBeLessThan(reserved)
    expect(reserved).toBeLessThan(remove)
    // The question is answered by the files table, live or trashed rows
    // alike (the admin client), by the pattern, with one row enough.
    expect(GC).toMatch(/from\('files'\)\.select\('id'\)\.like\('storage_path', pattern\)\.limit\(1\)/)
    expect(GC).toMatch(/skipped_twin: number/)
    expect(GC).toMatch(/skipped_twin: 0/)
  })
})
