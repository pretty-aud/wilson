// =============================================================================
// _shared/reservedObjects.ts — Session 36.
//
// 🚨 THE OBJECTS THE PRODUCT WRITES AND `public.files` DOES NOT KNOW ABOUT.
//
// Every disposal path in this project decides what to destroy by asking a ROW.
// storage-gc's orphan scan certifies each deletion "no files row references
// this object"; teardown's sweep enumerates from `files` + `storage_gc_queue`.
// Both are correct about user uploads, because `uploadFile` always writes the
// row. Both are WRONG about the two objects R.A.B.B.I.T. writes DIRECTLY to
// the bucket with no row at all, on purpose:
//
//   projects/<id>/PROJECT.json          supabaseAdapter.writeProjectManifest
//   projects/<id>/FINANCE/RATES.json    supabaseAdapter.writeProjectRates
//
// The rowlessness is deliberate and documented at both call sites — a manifest
// in the Files list invites someone to delete the thing the folder describes
// itself with, and neither file has the lifecycle 0027 models. What was never
// considered is that "no row points at it" is exactly storage-gc's definition
// of garbage.
//
// MEASURED 2026-08-07 (S36): storage-gc's orphan scan would delete BOTH files
// for EVERY project on its next run. It has not bitten only because the
// function is admin-invoked rather than a cron (§12.4) and evidently has not
// been clicked since manifests started being written; staging still holds
// projects/9926a8f7-7c8d-43ef-b327-8a766d8c1b0d/PROJECT.json, created
// 2026-08-05 and therefore already past the 24h floor.
//
// RATES.json is the one that matters. It is the money-gated mirror — the
// per-member rates that `can_access_project_money` exists to keep from the
// team. The GC would have destroyed the figures RLS was protecting.
//
//
// WHY THIS FILE EXISTS RATHER THAN TWO STRING LITERALS IN THE GC.
//
// 0042 is the standing lesson: a reserved path with a second definition is how
// these break. `public.rabbit_money_segment(text)` was reduced to the ONE
// definition of a money-gated path precisely because 0038 spelled the invoice
// segment differently from the policies that compared it and inverted the gate
// silently. A GC that carried its own copy of 'PROJECT.json' would have the
// same shape of defect with the opposite sign: rename the constant on the
// product side, and the GC quietly resumes deleting the file.
//
// The Deno runtime cannot import the renderer's ESM modules, so ONE definition
// across that boundary is not achievable — the same wall that forced
// electron/main.cjs to keep its own copies of fileSlugify and the folder
// categories. What IS achievable is the treatment folderParity.test.js gives
// those copies: a single definition on THIS side of the wall, imported by
// every Edge caller and by the test, with the strings pinned against the
// product's exports so a rename fails a test instead of deleting a file.
//
//   pinned by: src/tools/rabbit_v0.1.0/storageGcReserved.test.js
//   against:   projectManifest.MANIFEST_FILENAME
//              projectRates.RATES_SEGMENT / RATES_FILENAME
// =============================================================================

/** `projectManifest.MANIFEST_FILENAME`. Pinned — do not edit alone. */
export const MANIFEST_FILENAME = 'PROJECT.json'

/** `projectRates.RATES_SEGMENT`. Pinned — do not edit alone. */
export const RATES_SEGMENT = 'FINANCE'

/** `projectRates.RATES_FILENAME`. Pinned — do not edit alone. */
export const RATES_FILENAME = 'RATES.json'

/**
 * The reserved objects for one project, as bucket-relative paths.
 *
 * Used by teardown, which needs the LIST (it deletes by key and has no scan).
 * storage-gc walks the bucket and needs the PREDICATE below instead.
 */
export function reservedProjectObjectPaths(projectId: string): string[] {
  return [
    `projects/${projectId}/${MANIFEST_FILENAME}`,
    `projects/${projectId}/${RATES_SEGMENT}/${RATES_FILENAME}`,
  ]
}

/** Case-insensitive segment compare — see the note on the predicate. */
function seg(a: string | undefined, b: string): boolean {
  return typeof a === 'string' && a.toUpperCase() === b.toUpperCase()
}

/**
 * Is this bucket-relative path one of the product's row-less objects?
 *
 * Two deliberate properties, both chosen in the SAFE direction for a predicate
 * that gates a delete:
 *
 * 1. ANCHORED. The shape is matched exactly — three segments for the manifest,
 *    four for the rates file — not "any object called PROJECT.json". A user
 *    file that happens to be named PROJECT.json deeper in the tree is a normal
 *    upload with a normal `files` row, so the reference check already keeps it;
 *    reserving the name globally would only make genuine orphans immortal.
 *
 * 2. CASE-INSENSITIVE. Not tidiness — it matches the database. 0042 made
 *    `rabbit_money_segment()` compare with upper(), so `projects/<id>/finance/
 *    RATES.json` IS money-gated by RLS. A GC that recognised only the exact
 *    casing would happily delete an object the gate still considers protected,
 *    which is the same disagreement between two spellings of one reserved path
 *    that 0038/0039 spent two migrations on.
 *
 * The cost of (2) is that a stray object under a differently-cased FINANCE
 * folder is never collected. That is the correct trade: this predicate decides
 * whether to DESTROY something, so being wrong in the direction of keeping is
 * recoverable and being wrong in the direction of deleting is not.
 */
export function isReservedProjectObject(path: string): boolean {
  if (typeof path !== 'string' || path.length === 0) return false
  const s = path.split('/')
  if (s[0] !== 'projects') return false
  if (!s[1]) return false // no project id — not a shape we write
  if (s.length === 3) return seg(s[2], MANIFEST_FILENAME)
  if (s.length === 4) return seg(s[2], RATES_SEGMENT) && seg(s[3], RATES_FILENAME)
  return false
}
