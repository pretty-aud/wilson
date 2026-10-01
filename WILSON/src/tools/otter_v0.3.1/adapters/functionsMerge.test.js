// =============================================================================
// functionsMerge.test.js — post-overhaul S2b (C10): the function library's
// category merge, on every backend.
//
// The client posts `{ categories: [{ category, functions }] }`. Until S2b both
// copies of the merge — otterRoutes.js's mergeFunctions (the cloud adapter and
// the dev fixtures, through DOC_MERGERS) and the Local Server's
// `/api/software/:slug/functions/merge` route in electron/main.cjs — keyed
// categories on `name`, so every incoming category matched the first nameless
// one and a generated library collapsed into ONE category with no heading.
// Audrey's real Python library is that: one keyless category holding 46
// functions.
//
// Each case below runs against BOTH backends. The Local Server's route is
// lifted out of main.cjs and replayed over an in-memory disk (the
// rabbitShotLists.routes.test.js technique), so the shipped text is what runs.
// CONTROL: the pre-S2b code of both, verbatim, must fail exactly the cases
// that are the defect, and pass the ones it got right by accident.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  mergeFunctions, functionCategoryName, DOC_MERGERS, CR_DOC_MERGE, parseOtterRoute,
} from './otterRoutes.js'
import { buildDevFixtures } from '../../../dev/fixtures/install'
import { COURSE_ID } from '../../../dev/fixtures/data/otter'

const MAIN_CJS = readFileSync(new URL('../../../../electron/main.cjs', import.meta.url), 'utf-8')
const ROUTE_HEAD = "expressApp.post('/api/software/:slug/functions/merge'"

/** The BODY block of an inline `expressApp.<verb>('<path>', (req, res) => { … })`. */
function extractRouteBody(source, head) {
  const start = source.indexOf(head)
  if (start < 0) throw new Error(`main.cjs no longer registers ${head}`)
  const open = source.indexOf('{', source.indexOf('=>', start))
  let depth = 0
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++
    else if (source[j] === '}') { depth--; if (depth === 0) return source.slice(open, j + 1) }
  }
  throw new Error(`unbalanced braces extracting ${head}`)
}

/** Lift `function name(...) { ... }` out of main.cjs (rabbitShotLists.routes.test.js's technique). */
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`main.cjs no longer defines ${name}() — the replay cannot run`)
  const open = source.indexOf('{', source.indexOf(')', start))
  let depth = 0
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++
    else if (source[j] === '}') { depth--; if (depth === 0) return source.slice(start, j + 1) }
  }
  throw new Error(`unbalanced braces extracting ${name}() from main.cjs`)
}
// eslint-disable-next-line no-new-func
const SHIPPED_HELPER = new Function(`return ${extractFunction(MAIN_CJS, 'mergeFunctionsDoc')}`)()

/** A route body as a merge: the disk is a Map of JSON text, so a read is a
 *  parsed COPY and only what the route writes is kept, as on the desktop.
 *  The route's helper is handed in, lifted from the same file. */
function routeAsMerge(body, helper = SHIPPED_HELPER) {
  // eslint-disable-next-line no-new-func
  const run = new Function('req', 'res', 'readJSON', 'writeJSON', 'path', 'getSoftwareDir', 'mergeFunctionsDoc', body)
  return (existing, incoming) => {
    const disk = new Map()
    const file = '/sw/python/_functions.json'
    if (existing) disk.set(file, JSON.stringify(existing))
    const readJSON = (p, fallback) => (disk.has(p) ? JSON.parse(disk.get(p)) : fallback)
    const writeJSON = (p, data) => disk.set(p, JSON.stringify(data))
    const res = { json(x) { this.body = x } }
    run({ params: { slug: 'python' }, body: { categories: incoming } }, res, readJSON, writeJSON,
      { join: (...parts) => parts.join('/') }, () => '/sw', helper)
    const written = JSON.parse(disk.get(file))
    expect(res.body, 'the route answers with what it wrote').toEqual(written)
    return written
  }
}

// ── the code before S2b, verbatim (the controls) ─────────────────────────────
function preS2bMergeFunctions(existing, incoming) {
  const out = { categories: (existing?.categories || []).map(c => ({
    ...c, functions: [...(c.functions || [])],
  })) }
  for (const inCat of incoming || []) {
    let cat = out.categories.find(c => c.name === inCat.name)
    if (!cat) { cat = { name: inCat.name, functions: [] }; out.categories.push(cat) }
    for (const fn of (inCat.functions || [])) {
      if (!cat.functions.some(f => f.name === fn.name)) cat.functions.push(fn)
    }
  }
  return out
}
const PRE_S2B_ROUTE_BODY = `{
      const filePath = path.join(getSoftwareDir(), req.params.slug, '_functions.json');
      const existing = readJSON(filePath, { categories: [] });
      const incoming = req.body.categories || [];
      for (const inCat of incoming) {
        let existCat = existing.categories.find(c => c.name === inCat.name);
        if (!existCat) { existCat = { name: inCat.name, functions: [] }; existing.categories.push(existCat); }
        for (const fn of (inCat.functions || [])) {
          if (!existCat.functions.some(f => f.name === fn.name)) existCat.functions.push(fn);
        }
      }
      writeJSON(filePath, existing);
      res.json(existing);
    }`

// ── the cases ────────────────────────────────────────────────────────────────
const fn = (name) => ({ name, syntax: `${name}()`, parameters: '', returns: '', description: '', example: '' })
const names = (cat) => cat.functions.map((f) => f.name)

/** Each case returns null when the merge is right, or why it is wrong. */
const CASES = {
  'two categories the client posts stay two, each written with `category`': (merge) => {
    const out = merge({ categories: [] }, [
      { category: 'Built-in functions', functions: [fn('print'), fn('len')] },
      { category: 'String methods', functions: [fn('upper')] },
    ])
    const got = out.categories.map((c) => [c.category, 'name' in c, names(c)])
    const want = [['Built-in functions', false, ['print', 'len']], ['String methods', false, ['upper']]]
    return JSON.stringify(got) === JSON.stringify(want) ? null : JSON.stringify(got)
  },
  'a category arriving again joins its own heading, case and punctuation aside': (merge) => {
    const out = merge({ categories: [{ category: 'String methods', functions: [fn('upper')] }] },
      [{ category: 'string-methods', functions: [fn('upper'), fn('lower')] }])
    return out.categories.length === 1 && out.categories[0].category === 'String methods'
      && JSON.stringify(names(out.categories[0])) === '["upper","lower"]' ? null : JSON.stringify(out)
  },
  'a stored `name`-keyed category is the same category as an incoming `category`': (merge) => {
    const out = merge({ categories: [{ name: 'Math', functions: [fn('abs')] }] },
      [{ category: 'Math', functions: [fn('abs'), fn('ceil')] }])
    return out.categories.length === 1 && out.categories[0].name === 'Math' && !('category' in out.categories[0])
      && JSON.stringify(names(out.categories[0])) === '["abs","ceil"]' ? null : JSON.stringify(out)
  },
  'the collapsed (nameless) category reads as General and takes an incoming General, kept as stored': (merge) => {
    const out = merge({ categories: [{ functions: [fn('if')] }] }, [{ category: 'General', functions: [fn('while')] }])
    return out.categories.length === 1 && !('category' in out.categories[0]) && !('name' in out.categories[0])
      && JSON.stringify(names(out.categories[0])) === '["if","while"]' ? null : JSON.stringify(out)
  },
  'an incoming category with no name is written as General, never as undefined': (merge) => {
    const out = merge({ categories: [] }, [{ functions: [fn('x')] }])
    return JSON.stringify(out.categories.map((c) => [c.category, 'name' in c])) === '[["General",false]]' ? null : JSON.stringify(out)
  },
  'a stored category keeps every key it had': (merge) => {
    const out = merge({ categories: [{ category: 'Files', note: 'kept', functions: [fn('open')] }] },
      [{ category: 'Files', functions: [fn('close')] }])
    const c = out.categories[0]
    return out.categories.length === 1 && c.note === 'kept' && !('name' in c) && JSON.stringify(names(c)) === '["open","close"]'
      ? null : JSON.stringify(out)
  },
  'a new category never lands in the stored nameless one (the defect itself)': (merge) => {
    const out = merge({ categories: [{ functions: [fn('if')] }] }, [{ category: 'Strings', functions: [fn('upper')] }])
    return out.categories.length === 2 && JSON.stringify(names(out.categories[0])) === '["if"]'
      && out.categories[1].category === 'Strings' && JSON.stringify(names(out.categories[1])) === '["upper"]' ? null : JSON.stringify(out)
  },
  // ── review round 1 (S2b) ──
  'a function already anywhere in the library is not added again (the de-duplication the collapsed library had)': (merge) => {
    // Her real file is one nameless category; a generation that files `len`
    // under "Built-ins" must not put a second `len` beside the first.
    const out = merge({ categories: [{ functions: [fn('len'), fn('print')] }] },
      [{ category: 'Built-ins', functions: [fn('LEN'), fn('zip'), fn('zip')] }])
    return JSON.stringify(out.categories.map((c) => [functionCategoryName(c), names(c)]))
      === '[["General",["len","print"]],["Built-ins",["zip"]]]' ? null : JSON.stringify(out)
  },
  'a stored category the merge adds nothing to is left exactly as stored, and duplicates make no empty heading': (merge) => {
    const stored = { categories: [{ category: 'Empty' }, { category: 'A', functions: [fn('a')] }] }
    const out = merge(stored, [{ category: 'Empty', functions: [fn('a')] }, { category: 'Dupes', functions: [fn('A ')] }])
    return JSON.stringify(out) === JSON.stringify(stored) ? null : JSON.stringify(out)
  },
  'a category sent with no functions is made as sent (a fork\'s empty category moves on approval)': (merge) => {
    const out = merge({ categories: [] }, [{ category: 'Later', functions: [] }])
    return JSON.stringify(out.categories) === JSON.stringify([{ category: 'Later', functions: [] }]) ? null : JSON.stringify(out)
  },
  'entries that are not categories are carried over untouched and never matched': (merge) => {
    const out = merge({ categories: [null, 'x', { category: 'Str', functions: 'ab' }, { category: 'General', functions: [fn('f1')] }] },
      [{ category: 'Str', functions: [fn('g')] }, { functions: [fn('h')] }, null, 'junk', { category: 'Bad', functions: [null, 'k', fn('m')] }])
    return JSON.stringify(out.categories) === JSON.stringify([
      null, 'x', { category: 'Str', functions: 'ab' }, { category: 'General', functions: [fn('f1'), fn('h')] },
      { category: 'Str', functions: [fn('g')] }, { category: 'Bad', functions: [fn('m')] },
    ]) ? null : JSON.stringify(out)
  },
  'a stored document with no category list gets one, and keeps its other keys': (merge) => {
    const out = merge({ version: 2 }, [{ category: 'A', functions: [fn('a')] }])
    return JSON.stringify(out) === JSON.stringify({ version: 2, categories: [{ category: 'A', functions: [fn('a')] }] }) ? null : JSON.stringify(out)
  },
  'a name that is not a non-empty string is no name; names with no Latin letters keep their own heading': (merge) => {
    const out = merge({ categories: [] }, [
      { category: 5, name: 'Math', functions: [fn('abs')] }, { category: '   ', functions: [fn('x')] },
      { category: '文字列', functions: [fn('s1')] }, { category: '数学', functions: [fn('m1')] },
    ])
    return JSON.stringify(out.categories.map((c) => [c.category, names(c)]))
      === '[["Math",["abs"]],["General",["x"]],["文字列",["s1"]],["数学",["m1"]]]' ? null : JSON.stringify(out)
  },
  'a category carrying both keys is its `category`; words run together are another heading': (merge) => {
    // Reviewer C (M7, M8b): the two copies could read the keys in another
    // order, or normalise differently, and no case told them apart.
    const out = merge({ categories: [{ category: 'Strings', name: 'Text', functions: [fn('a')] }] },
      [{ name: 'Text', functions: [fn('b')] }, { category: 'Strings', name: 'Other', functions: [fn('c')] },
        { category: 'String methods', functions: [fn('d')] }, { category: 'Stringmethods', functions: [fn('e')] }])
    return JSON.stringify(out.categories.map((c) => [functionCategoryName(c), names(c)]))
      === '[["Strings",["a","c"]],["Text",["b"]],["String methods",["d"]],["Stringmethods",["e"]]]' ? null : JSON.stringify(out)
  },
  'a padded name is written trimmed and joins its stored heading': (merge) => {
    const out = merge({ categories: [{ category: 'Strings', functions: [fn('a')] }] }, [{ category: '  strings  ', functions: [fn('b')] }])
    return JSON.stringify(out.categories.map((c) => [c.category, names(c)])) === '[["Strings",["a","b"]]]' ? null : JSON.stringify(out)
  },
}
/** The cases the pre-S2b keying gets WRONG — and only these. */
const DEFECT_CASES = [
  'two categories the client posts stay two, each written with `category`',
  'a stored `name`-keyed category is the same category as an incoming `category`',
  'an incoming category with no name is written as General, never as undefined',
  'a new category never lands in the stored nameless one (the defect itself)',
  'a function already anywhere in the library is not added again (the de-duplication the collapsed library had)',
  'a stored category the merge adds nothing to is left exactly as stored, and duplicates make no empty heading',
  'a category sent with no functions is made as sent (a fork\'s empty category moves on approval)',
  'entries that are not categories are carried over untouched and never matched',
  'a stored document with no category list gets one, and keeps its other keys',
  'a name that is not a non-empty string is no name; names with no Latin letters keep their own heading',
  'a category carrying both keys is its `category`; words run together are another heading',
]
/** A check that throws is a failure too (the pre-S2b copies crash on some). */
const failures = (merge) => Object.entries(CASES).filter(([, check]) => {
  try { return check(merge) !== null } catch { return true }
}).map(([title]) => title)

const BACKENDS = {
  'cloud and dev fixtures (otterRoutes.mergeFunctions)': mergeFunctions,
  'Local Server (main.cjs /functions/merge, replayed)': routeAsMerge(extractRouteBody(MAIN_CJS, ROUTE_HEAD)),
}

describe('the function library merge keys categories as the client writes them (S2b, C10)', () => {
  for (const [backend, merge] of Object.entries(BACKENDS)) {
    describe(backend, () => {
      for (const [title, check] of Object.entries(CASES)) it(title, () => expect(check(merge)).toBeNull())
      it('does not mutate the stored document it is given', () => {
        const stored = { categories: [{ functions: [fn('if')] }] }
        const before = JSON.stringify(stored)
        merge(stored, [{ category: 'Strings', functions: [fn('upper')] }])
        expect(JSON.stringify(stored)).toBe(before)
      })
    })
  }

  it('the two backends write the same document for every case (cloud and local behave alike)', () => {
    const local = BACKENDS['Local Server (main.cjs /functions/merge, replayed)']
    for (const [title, check] of Object.entries(CASES)) {
      const seen = []
      const record = (m) => (e, i) => { const out = m(e, i); seen.push(JSON.stringify(out)); return out }
      check(record(mergeFunctions))
      check(record(local))
      expect(seen[0], title).toBe(seen[1])
    }
  })

  it('CONTROL: the pre-S2b keying fails exactly the defect cases, on both backends', () => {
    expect(failures(preS2bMergeFunctions)).toEqual(DEFECT_CASES)
    expect(failures(routeAsMerge(PRE_S2B_ROUTE_BODY))).toEqual(DEFECT_CASES)
  })

  it('CONTROL: the route reader lifts the shipped route, not a stale copy', () => {
    const shipped = extractRouteBody(MAIN_CJS, ROUTE_HEAD)
    expect(shipped).toMatch(/_functions\.json/)
    expect(shipped, 'the route merges through its helper').toMatch(/mergeFunctionsDoc\(/)
    expect(shipped).not.toMatch(/c\.name === inCat\.name/)
    expect(extractFunction(MAIN_CJS, 'mergeFunctionsDoc')).toMatch(/^function mergeFunctionsDoc\(stored, incoming\) \{[\s\S]*return out;\s*\}$/)
    expect(() => extractRouteBody('nothing here', ROUTE_HEAD)).toThrow(/no longer registers/)
    expect(() => extractFunction('nothing here', 'mergeFunctionsDoc')).toThrow(/no longer defines/)
  })
})

describe('every merge path reaches the fixed merge', () => {
  it('the cloud adapter and the fixtures merge through DOC_MERGERS, and an approval through CR_DOC_MERGE', () => {
    expect(DOC_MERGERS.functions).toBe(mergeFunctions)
    // A fork's stored library is the generator's shape or the collapsed one.
    const out = CR_DOC_MERGE.functions({ categories: [{ category: 'Strings', functions: [fn('upper')] }] },
      { categories: [{ functions: [fn('print')] }, { category: 'strings', functions: [fn('lower')] }] })
    expect(out.categories.map((c) => [functionCategoryName(c), names(c)])).toEqual([
      ['Strings', ['upper', 'lower']], ['General', ['print']],
    ])
  })

  it('the dev fixtures: a generated library posted to /functions/merge reads back as its own categories', () => {
    const fx = buildDevFixtures()
    const call = (path, method = 'GET', body) => fx.otter.handle(parseOtterRoute(path, method), body)
    const before = call(`/api/software/${COURSE_ID}/functions`).body.categories.length
    const merged = call(`/api/software/${COURSE_ID}/functions/merge`, 'POST', { categories: [
      { category: 'Media pool', functions: [fn('Import')] }, { category: 'Fusion', functions: [fn('Merge')] },
    ] })
    expect(merged.status).toBe(200)
    const after = call(`/api/software/${COURSE_ID}/functions`).body.categories
    expect(after).toHaveLength(before + 2)
    expect(after.slice(-2).map((c) => [c.category, names(c)])).toEqual([['Media pool', ['Import']], ['Fusion', ['Merge']]])
  })
})

describe('functionCategoryName — what a heading reads', () => {
  it('category, then name, then General', () => {
    expect(functionCategoryName({ category: 'A', name: 'B' })).toBe('A')
    expect(functionCategoryName({ name: 'B' })).toBe('B')
    expect(functionCategoryName({ functions: [] })).toBe('General')
    expect(functionCategoryName({ category: '', name: '' })).toBe('General')
    expect(functionCategoryName(null)).toBe('General')
    expect(functionCategoryName(undefined)).toBe('General')
  })
})
