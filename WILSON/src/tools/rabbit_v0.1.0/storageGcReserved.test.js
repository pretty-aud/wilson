// =============================================================================
// storageGcReserved.test.js — Session 36.
//
// 🚨 THE GARBAGE COLLECTOR WOULD HAVE DELETED EVERY PROJECT'S MANIFEST AND
// EVERY PROJECT'S RATES MIRROR.
//
// MEASURED 2026-08-07. `storage-gc`'s orphan scan built its keep-set from
// `public.files.storage_path` alone and removed anything under
// `projects/<id>/` that no row pointed at and that was older than 24h,
// certifying each deletion "no files row references this object". Both of
// R.A.B.B.I.T.'s product-written files match that description exactly, and
// deliberately so:
//
//   projects/<id>/PROJECT.json          no files row, on purpose (S26)
//   projects/<id>/FINANCE/RATES.json    no files row, on purpose (S27)
//
// The rates mirror is the one that matters: it is the money-gated file, the
// per-member figures `can_access_project_money` exists to withhold from the
// team. The GC would have destroyed precisely what RLS was protecting.
//
// It had not bitten because the function is admin-invoked rather than a cron
// (§12.4) and had not been clicked since manifests started being written.
// Staging still held projects/9926a8f7-…/PROJECT.json, created 2026-08-05 and
// therefore already past the age floor — one click from gone.
//
//
// WHAT THIS FILE PINS, AND WHY EACH PART IS HERE.
//
// 1. THE STRINGS, across a boundary that cannot be crossed by import. Deno
//    cannot import the renderer's ESM modules, so the Edge side keeps its own
//    copy in _shared/reservedObjects.ts — the same unavoidable duplication
//    folderParity.test.js pins between the renderer and electron/main.cjs, and
//    the same treatment: rename MANIFEST_FILENAME on the product side and a
//    test fails instead of a file quietly becoming collectable again. 0042 is
//    the standing lesson that a reserved path with two definitions is how
//    these break silently.
//
// 2. THE PATHS THE WRITERS ACTUALLY PRODUCE — derived from the writers' own
//    expressions (`projectRatesPath`, and the manifest's template) rather than
//    retyped. A test that asserted a hand-written literal was reserved would
//    keep passing after the writer moved.
//
// 3. THE CALL SITES. A guard nobody calls is this project's single most
//    expensive pattern — seven features have shipped with no caller. There are
//    THREE call sites (the GC's queue drain, the GC's orphan scan, and
//    teardown's sweep) and all three are pinned, because writing a call-site
//    guard for half a change is exactly how the other half goes dead (S31).
//
// 🚨 THE SCANS BELOW READ COMMENT-STRIPPED SOURCE, AND THAT IS LOAD-BEARING.
// S36 lost a breaker to this: `expect(migration).toContain('is_financial')`
// stayed green with the code arm deleted, because the migration's own prose
// contained the word. Both files scanned here carry paragraphs about
// `isReservedProjectObject` by name, so a whole-file `toContain` would pass
// with every call site removed. `stripComments` is itself checked below —
// an instrument that cannot see a presence proves nothing about an absence.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

import { MANIFEST_FILENAME } from './projectManifest'
import { RATES_SEGMENT, RATES_FILENAME, projectRatesPath } from './projectRates'
import {
  MANIFEST_FILENAME as EDGE_MANIFEST_FILENAME,
  RATES_SEGMENT as EDGE_RATES_SEGMENT,
  RATES_FILENAME as EDGE_RATES_FILENAME,
  reservedProjectObjectPaths,
  isReservedProjectObject,
} from '../../../supabase/functions/_shared/reservedObjects.ts'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf-8')

const GC_SRC       = read('../../../supabase/functions/storage-gc/index.ts')
const TEARDOWN_SRC = read('../../../supabase/functions/operator-workspaces/index.ts')

/**
 * Remove block and line comments so a scan sees CODE.
 *
 * Deliberately crude: it can truncate a line at a `//` inside a string
 * literal (a URL import), which does not matter to any assertion here — none
 * of them looks for a URL. What it must do correctly is delete prose, and the
 * "the stripper actually strips" test below is what says it does.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')
    .replace(/\/\/.*$/gm, ' ')
}

const GC       = stripComments(GC_SRC)
const TEARDOWN = stripComments(TEARDOWN_SRC)

const PROJECT_ID = '9926a8f7-7c8d-43ef-b327-8a766d8c1b0d' // the staging row

// The paths as the WRITERS build them, not as a human retypes them.
// supabaseAdapter.writeProjectManifest uploads to this template;
// supabaseAdapter.writeProjectRates calls projectRatesPath directly.
const MANIFEST_PATH = `projects/${PROJECT_ID}/${MANIFEST_FILENAME}`
const RATES_PATH    = projectRatesPath(PROJECT_ID)


describe('the reserved names match the product constants across the Deno boundary', () => {
  // 🚨 A rename on the product side must fail HERE, not in production. The
  // Edge copy exists only because Deno cannot import the renderer's modules;
  // it has no independent right to a different value.
  it('the Edge copy equals projectManifest / projectRates', () => {
    expect(EDGE_MANIFEST_FILENAME).toBe(MANIFEST_FILENAME)
    expect(EDGE_RATES_SEGMENT).toBe(RATES_SEGMENT)
    expect(EDGE_RATES_FILENAME).toBe(RATES_FILENAME)
  })

  it('and the values are the ones the database and the bucket already carry', () => {
    // Asserted literally as well as compared: two identical copies of a WRONG
    // name satisfy the test above and are still wrong. RATES_SEGMENT in
    // particular is pinned by projectRates.test.js, folderParity.test.js and
    // pgTAP 53 — this is the fourth place it must agree.
    expect(EDGE_MANIFEST_FILENAME).toBe('PROJECT.json')
    expect(EDGE_RATES_SEGMENT).toBe('FINANCE')
    expect(EDGE_RATES_FILENAME).toBe('RATES.json')
  })
})


describe('the objects the product writes with no files row are reserved', () => {
  // THE REGRESSION. Before this fix both of these returned nothing at all —
  // there was no predicate — and the orphan scan deleted them.
  it('the manifest path the adapter uploads to is reserved', () => {
    expect(isReservedProjectObject(MANIFEST_PATH)).toBe(true)
  })

  it('the rates path projectRatesPath() returns is reserved', () => {
    expect(isReservedProjectObject(RATES_PATH)).toBe(true)
  })

  it('the list form and the predicate agree', () => {
    // Teardown deletes by key and uses the list; the GC scans and uses the
    // predicate. Two shapes of the same fact, so they are checked against
    // each other rather than each against a literal.
    const paths = reservedProjectObjectPaths(PROJECT_ID)
    expect(paths).toEqual([MANIFEST_PATH, RATES_PATH])
    for (const p of paths) expect(isReservedProjectObject(p)).toBe(true)
  })

  it('matches case-insensitively, because migration 0042 does', () => {
    // Not tidiness. `rabbit_money_segment()` compares with upper(), so
    // projects/<id>/finance/RATES.json IS money-gated by RLS. A GC that
    // recognised only one casing would delete an object the gate still
    // protects — the 0038/0039 disagreement between two spellings of one
    // reserved path, rebuilt in TypeScript.
    expect(isReservedProjectObject(`projects/${PROJECT_ID}/project.json`)).toBe(true)
    expect(isReservedProjectObject(`projects/${PROJECT_ID}/finance/rates.json`)).toBe(true)
    expect(isReservedProjectObject(`projects/${PROJECT_ID}/Finance/Rates.Json`)).toBe(true)
  })
})


describe('it does not reserve so much that real garbage becomes immortal', () => {
  // The other failure direction. A predicate that swallowed ordinary uploads
  // would silently switch the orphan scan off — no error, no symptom, just a
  // bucket that grows forever. uploadFile's real shape is five segments:
  //   projects/<pid>/<entity>/<entityId>/<ts>-<name>
  const NOT_RESERVED = [
    // ordinary uploads, including the money-gated ones (they have files rows)
    `projects/${PROJECT_ID}/scene/s1/1754524800000-plate.mov`,
    `projects/${PROJECT_ID}/INVOICES/l1/1754524800000-invoice.pdf`,
    `projects/${PROJECT_ID}/FINANCE/l1/1754524800000-anything.pdf`,
    // near-misses on the reserved names
    `projects/${PROJECT_ID}/PROJECT.json.bak`,
    `projects/${PROJECT_ID}/PROJECT.json/nested`,
    `projects/${PROJECT_ID}/FINANCE/RATES.json/nested`,
    `projects/${PROJECT_ID}/FINANCE/OTHER.json`,
    `projects/${PROJECT_ID}/OTHER/RATES.json`,
    `projects/${PROJECT_ID}/RATES.json`,          // rates at the manifest's depth
    `projects/${PROJECT_ID}/FINANCE/PROJECT.json`,
    // wrong root, or no project id at all
    'PROJECT.json',
    `${PROJECT_ID}/PROJECT.json`,
    'projects//PROJECT.json',
    'projects/PROJECT.json',
    '',
  ]

  it.each(NOT_RESERVED)('leaves %j collectable', (path) => {
    expect(isReservedProjectObject(path)).toBe(false)
  })

  it('survives a non-string without claiming it is reserved', () => {
    for (const junk of [null, undefined, 0, {}, []]) {
      expect(isReservedProjectObject(junk)).toBe(false)
    }
  })
})


describe('the guard is actually WIRED — all three call sites', () => {
  // 🚨 THE POINT OF THIS BLOCK. Every assertion above passes with a perfect
  // predicate that nothing calls, which is how seven features in this project
  // shipped dead. These read the comment-stripped source of the two Edge
  // functions and fail if a call site is deleted.

  it('the stripper actually strips — the instrument, checked first', () => {
    // Both files contain the identifiers below inside PROSE. If stripComments
    // silently did nothing, every scan in this block would pass with the code
    // removed, which is the exact trap S36 already fell into once.
    expect(GC_SRC).toContain('SAFETY RULES, in order of importance')
    expect(GC).not.toContain('SAFETY RULES, in order of importance')
    expect(TEARDOWN_SRC).toContain('KNOWN LIMIT, deliberately not handled here')
    expect(TEARDOWN).not.toContain('KNOWN LIMIT, deliberately not handled here')
    // And it left the code alone.
    expect(GC).toContain('Deno.serve')
    expect(TEARDOWN).toContain('Deno.serve')
  })

  it('storage-gc imports the shared definition rather than its own literal', () => {
    expect(GC).toMatch(/import\s*\{[^}]*isReservedProjectObject[^}]*\}\s*from\s*'\.\.\/_shared\/reservedObjects\.ts'/)
    // 🚨 And carries NO second copy of the names in its own code. This is the
    // 0042 rule: a reserved path with two definitions is how these break.
    expect(GC).not.toContain('PROJECT.json')
    expect(GC).not.toContain('RATES.json')
  })

  it('the ORPHAN SCAN checks it before removing the object', () => {
    const guard  = GC.indexOf('isReservedProjectObject(obj.path)')
    const remove = GC.indexOf('.from(RABBIT_BUCKET).remove([obj.path])')
    expect(guard, 'the orphan scan no longer calls the reserved guard').toBeGreaterThan(-1)
    expect(remove, 'the orphan scan no longer removes objects — check this test').toBeGreaterThan(-1)
    expect(guard).toBeLessThan(remove)
  })

  it('the QUEUE DRAIN checks it too — refusal in depth', () => {
    // Not belt-and-braces theatre. `files.storage_path` is unconstrained,
    // client-writable TEXT: a member can point a files row of their own at the
    // rates file, delete it, and have trg_files_gc_enqueue queue the rates
    // file for disposal. The restorability check cannot save it — the row they
    // just deleted was the only one referencing it.
    const guard  = GC.indexOf('isReservedProjectObject(row.object_path)')
    const remove = GC.indexOf('.from(row.bucket_id).remove(')
    expect(guard, 'the queue drain no longer calls the reserved guard').toBeGreaterThan(-1)
    expect(remove, 'the queue drain no longer removes objects — check this test').toBeGreaterThan(-1)
    expect(guard).toBeLessThan(remove)
  })

  it('every reserved skip is COUNTED, so a run can prove the guard fired', () => {
    // An inferred fix ships with its instrument. skipped_reserved reading 0 on
    // a workspace that has projects means the manifests are already gone.
    expect(GC).toContain('skipped_reserved')
    expect((GC.match(/counts\.skipped_reserved\+\+/g) ?? []).length).toBe(2)
  })

  it('TEARDOWN sweeps them, since a row-derived sweep cannot see them', () => {
    // The converse defect, same blind spot: teardown enumerates from `files`
    // and `storage_gc_queue`, so before this the money-gated rates mirror
    // survived its own tenant's certified destruction — permanently, because
    // after the CASCADE nothing can attribute a project folder to a workspace.
    expect(TEARDOWN).toMatch(/import\s*\{[^}]*reservedProjectObjectPaths[^}]*\}\s*from\s*'\.\.\/_shared\/reservedObjects\.ts'/)
    expect(TEARDOWN).toContain('reservedProjectObjectPaths(projectId)')
    expect(TEARDOWN).not.toContain('PROJECT.json')
    expect(TEARDOWN).not.toContain('RATES.json')
  })

  it('teardown builds them ONLY from project ids it proved it owns', () => {
    // Tenancy. The reserved paths are constructed, not discovered, so they
    // inherit whatever set they are built from — `projectIds` is the set
    // collectBlobPaths already proved belongs to this workspace, and the S15
    // cross-tenant finding is why that set exists.
    const build = TEARDOWN.indexOf('reservedProjectObjectPaths(projectId)')
    const loop  = TEARDOWN.lastIndexOf('for (const projectId of projectIds)', build)
    expect(loop, 'reserved paths are no longer built from the owned project ids')
      .toBeGreaterThan(-1)
  })
})
