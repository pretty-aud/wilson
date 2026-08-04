// =============================================================================
// folderParity.test.js — Session 26.
//
// 🚨 THE ONE THING THAT MUST NOT DRIFT.
//
// The folder tree is built in two processes that cannot import from each
// other. `electron/main.cjs` is CommonJS in the Electron main process; it
// cannot require a module out of the renderer's Vite bundle. So `fileSlugify`
// and the category list exist in TWO copies, and a disagreement between them
// does not throw, does not fail a build and does not show an error — it
// quietly files one scene in two different folders.
//
// That is not hypothetical. `fileSlugify` had THREE copies until S25 removed
// one (43be524), explicitly so that this session could build on the slugs.
// The remaining duplicate is unavoidable; leaving it UNPINNED was not.
//
// This file reads electron/main.cjs as TEXT, extracts its copies, and
// compares them against the renderer's real exports. It fails when the two
// diverge, which is the only moment anyone could still cheaply fix it.
//
// Why text extraction rather than importing main.cjs: requiring it would
// execute the whole Electron main process — app.whenReady, BrowserWindow, an
// Express server. The functions under test are pure, so lifting them out is
// both sufficient and the only thing that runs in a test process.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileSlugify } from './entityNaming'
import {
  FOLDER_CATEGORIES, ENTITY_FK_COLUMN, planEntityFolder, planProjectFolders,
} from './folderPaths'

const MAIN_CJS = readFileSync(
  new URL('../../../electron/main.cjs', import.meta.url), 'utf-8',
)

/**
 * Lift a top-level `function name(...) { ... }` out of the source by brace
 * matching. A regex cannot do this correctly once the body contains braces,
 * and a wrong extraction would make this file pass while comparing nothing.
 */
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`main.cjs no longer defines ${name}() — parity cannot be checked`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`unbalanced braces extracting ${name}() from main.cjs`)
}

/** Lift a top-level `const NAME = [ … ];` array literal and evaluate it. */
function extractArrayLiteral(source, name) {
  const start = source.indexOf(`const ${name} = [`)
  if (start < 0) throw new Error(`main.cjs no longer defines ${name} — parity cannot be checked`)
  const open = source.indexOf('[', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '[') depth++
    else if (source[i] === ']') {
      depth--
      if (depth === 0) {
        // eslint-disable-next-line no-new-func
        return new Function(`return ${source.slice(open, i + 1)}`)()
      }
    }
  }
  throw new Error(`unbalanced brackets extracting ${name} from main.cjs`)
}

/** Lift a top-level `const NAME = { … };` object literal and evaluate it. */
function extractObjectLiteral(source, name) {
  const start = source.indexOf(`const ${name} = {`)
  if (start < 0) throw new Error(`main.cjs no longer defines ${name} — parity cannot be checked`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) {
        // eslint-disable-next-line no-new-func
        return new Function(`return (${source.slice(open, i + 1)})`)()
      }
    }
  }
  throw new Error(`unbalanced braces extracting ${name} from main.cjs`)
}

// eslint-disable-next-line no-new-func
const mainFileSlugify = new Function(
  `${extractFunction(MAIN_CJS, 'fileSlugify')}; return fileSlugify;`,
)()

const mainCategories = extractArrayLiteral(MAIN_CJS, 'FOLDER_CATEGORIES')
const mainEntityFk   = extractObjectLiteral(MAIN_CJS, 'FOLDER_ENTITY_FK')

// The main process's PLANNERS, rebuilt from source with their dependencies.
//
// Comparing only fileSlugify and the category list is not enough, and that is
// MEASURED rather than assumed: the empty-slug defect (a scene named '..'
// producing a path of 'SCENES/') lived in the planner, not in fileSlugify.
// Both copies had it, both copies were fixed, and nothing in this file would
// have noticed if only one had been.
const mainPlanners = new Function(`
  ${extractFunction(MAIN_CJS, 'fileSlugify')}
  const FOLDER_CATEGORIES = ${JSON.stringify(mainCategories)};
  const FOLDER_ENTITY_FK = ${JSON.stringify(mainEntityFk)};
  const FOLDER_FALLBACK_NAME = ${JSON.stringify(extractObjectLiteral(MAIN_CJS, 'FOLDER_FALLBACK_NAME'))};
  ${extractFunction(MAIN_CJS, 'slugOrFallback')}
  ${extractFunction(MAIN_CJS, 'planProjectFolderList')}
  ${extractFunction(MAIN_CJS, 'planEntityFolderFor')}
  return { planProjectFolderList, planEntityFolderFor };
`)()


describe('fileSlugify agrees between the renderer and the Electron main process', () => {
  // The corpus is the point. Comparing the two on 'Hero Film' proves almost
  // nothing; every case below is one where two plausible slugify
  // implementations diverge, which is how the copies would actually drift.
  const CORPUS = [
    'Hero Film 2026',
    'WLSN_SC001',                 // the auto-naming output — the main case
    'WLSN_SC001_SH0001',
    'Level 1',
    'A/B Test',                   // a separator that would create a SUBFOLDER
    'back\\slash',                // ditto, on Windows
    '../escape',                  // traversal, if punctuation survived
    'Trailing   spaces   ',
    '   leading',
    'MiXeD CaSe NaMe',
    'Ünïcödé Ñame',               // non-ASCII is stripped by both, not kept
    'punctuation!@#$%^&*()name',
    'hyphen-already-there',
    'dots.in.the.name',
    '2026',
    'a',
    '',                           // empty in, empty out
    '   ',
    'multi\tword\ttabs',
    'emoji 🎬 shot',
  ]

  it.each(CORPUS)('slugifies %j identically', (input) => {
    expect(mainFileSlugify(input)).toBe(fileSlugify(input))
  })

  it('produces a path segment with no separator, for every corpus entry', () => {
    // The reason the two must agree at all: the output is concatenated into
    // `path`, and 0041's folders_slug_shape_chk refuses a separator outright.
    // A copy that let one through would fail the write rather than misfile —
    // but only on the Supabase side, so the local bundle would happily build
    // a nested directory nobody asked for.
    for (const input of CORPUS) {
      const slug = fileSlugify(input)
      expect(slug, `${JSON.stringify(input)} produced ${JSON.stringify(slug)}`)
        .not.toMatch(/[/\\]|\.\./)
    }
  })

  it('differs ONLY on null and undefined, which is a known and harmless gap', () => {
    // MEASURED 2026-08-04, and the plan document said these were "identical
    // today" — they are not, quite. entityNaming.js guards with
    // `String(str ?? '')`; main.cjs calls `str.trim()` directly and throws.
    //
    // It does not matter for slug agreement: every caller on both sides
    // passes `x || 'Untitled-Something'`, so a nullish value never reaches
    // either one. It is asserted rather than "fixed" because the assertion is
    // what makes it a known difference instead of a lurking one — and because
    // silently changing main.cjs to swallow null would turn a loud
    // programming error into a folder named after nothing.
    expect(fileSlugify(null)).toBe('')
    expect(fileSlugify(undefined)).toBe('')
    expect(() => mainFileSlugify(null)).toThrow()
    expect(() => mainFileSlugify(undefined)).toThrow()
  })
})


describe('the folder categories agree between the two processes', () => {
  it('is the same list, in the same order, with the same reveal flags', () => {
    // Order matters as well as content: it decides the order folders are
    // planned in, and therefore parent_id resolution and sort_order.
    expect(mainCategories).toEqual(FOLDER_CATEGORIES)
  })

  it('still spells INVOICES exactly that way', () => {
    // The case is load-bearing on the Supabase side: migration 0039 matches
    // this segment with upper(), and 0038 had shipped it lowercase. Renaming
    // it in one place without the other inverted the invoice gate completely
    // — the object missed the money-gated storage policy and fell through to
    // the base ones, i.e. readable by every project member.
    for (const list of [mainCategories, FOLDER_CATEGORIES]) {
      expect(list.map(c => c.slug)).toContain('INVOICES')
    }
  })

  it('keeps every entity type mapped to a foreign-key column', () => {
    // A category with no FK column would produce entity folders that link to
    // nothing, which 0041's folders_entity_link_chk refuses — so this would
    // surface as every scene folder failing to write, with no clue why.
    for (const c of FOLDER_CATEGORIES) {
      if (c.entityType === 'invoice' || c.entityType === 'file') continue
      expect(ENTITY_FK_COLUMN[c.entityType], `${c.slug} has no FK column`).toBeTruthy()
    }
    expect(mainEntityFk).toEqual(ENTITY_FK_COLUMN)
  })

  it('plans the same category set for the same project', () => {
    for (const project of [
      { id: 'p1', title: 'Hero Film 2026' },
      { id: 'p2', title: 'Space Game', scenes_enabled: true },
      { id: 'p3', title: 'Everything', scenes_enabled: true, levels_enabled: true, experiences_enabled: true },
      { id: 'p4', title: 'Renamed', folder_slug: 'Original-Slug' },
    ]) {
      const mine   = planProjectFolders(project).map(f => `${f.kind}:${f.slug}:${f.path}`)
      const theirs = mainPlanners.planProjectFolderList(project).map(f => `${f.kind}:${f.slug}:${f.path}`)
      expect(theirs, `plan differs for ${project.title}`).toEqual(mine)
    }
  })

  it('plans the same entity folder for the same entity, hostile names included', () => {
    // 🚨 '..' and '###' are the cases that caught the real defect: they are
    // TRUTHY names that slugify to nothing, so `name || 'Untitled'` lets an
    // empty final segment through. Keep them in this list.
    const NAMES = [
      'WLSN_SC001', 'Hero Ship', 'Level 1', '..', '###', '   ', '',
      'A/B Test', 'back\\slash', undefined,
    ]
    const project = { id: 'p1', title: 'Space Game', scenes_enabled: true, levels_enabled: true, experiences_enabled: true }
    for (const entityType of ['asset', 'scene', 'shot', 'level', 'experience']) {
      for (const name of NAMES) {
        const entity = { id: 'e1', name }
        const mine   = planEntityFolder(project, entityType, entity)
        const theirs = mainPlanners.planEntityFolderFor(entityType, entity)
        expect(theirs.folder.path, `${entityType} named ${JSON.stringify(name)}`)
          .toBe(mine.folder.path)
        expect(theirs.folder.slug).toBe(mine.folder.slug)
        expect(theirs.category.path).toBe(mine.category.path)
        // Whatever the name, the segment must never be empty — that is the
        // invariant public.folders enforces and the bundle cannot.
        expect(theirs.folder.slug).not.toBe('')
      }
    }
  })

  it('does not model <slug>_DATABASES — the second-datastore trap', () => {
    // On `main` that folder was the DATASTORE, not a files folder:
    // mirrorProjectDatabases writes project.json, team.json, tasks.json,
    // timeline.json and budget.json into it. Database information lives in
    // Supabase. Adding it to this list would give every project a second,
    // diverging copy of itself — the exact thing the manifest decision
    // (database authoritative, file a MIRROR) exists to prevent.
    for (const list of [mainCategories, FOLDER_CATEGORIES]) {
      expect(list.some(c => /DATABASES/i.test(c.slug))).toBe(false)
    }
  })
})
