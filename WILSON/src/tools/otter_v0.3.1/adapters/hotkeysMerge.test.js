// =============================================================================
// hotkeysMerge.test.js — post-overhaul S2c (S2b-02): the hotkeys merge keys a
// category as the function library's merge does (S2b), on every backend.
//
// Until S2c both copies of the hotkeys merge — otterRoutes.js's mergeHotkeys
// (the cloud adapter and the dev fixtures, through DOC_MERGERS and
// CR_DOC_MERGE) and the Local Server's `/api/software/:slug/hotkeys/merge`
// route in electron/main.cjs — keyed a category on `normKey`, a-z and 0-9
// only: "文字列" and "数学" both keyed to '' and merged into one, "C", "C++"
// and "C#" were one category, a name that was not a string threw on every
// later merge, and the stored side read `category` alone, so a stored
// `name`-keyed category was never matched — and was matched by any name with
// no Latin letters.
//
// Each case below runs against BOTH backends. The Local Server's route is
// lifted out of main.cjs and replayed over an in-memory disk (the
// functionsMerge.test.js technique), so the shipped text is what runs.
// CONTROL: the pre-S2c code of both, verbatim, must fail exactly the cases
// that are the defect for it, and pass the ones it got right.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  mergeHotkeys, mergeFunctions, functionCategoryName, DOC_MERGERS, CR_DOC_MERGE, parseOtterRoute,
} from './otterRoutes.js'
import { buildDevFixtures } from '../../../dev/fixtures/install'
import { COURSE_ID } from '../../../dev/fixtures/data/otter'

// LF whatever the checkout (a Windows working tree is CRLF, CI's is LF).
const MAIN_CJS = readFileSync(new URL('../../../../electron/main.cjs', import.meta.url), 'utf-8').replace(/\r\n/g, '\n')
const ROUTES_JS = readFileSync(new URL('./otterRoutes.js', import.meta.url), 'utf-8').replace(/\r\n/g, '\n')
const ROUTE_HEAD = "expressApp.post('/api/software/:slug/hotkeys/merge'"

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
/** Lift `function name(...) { ... }` out of main.cjs. */
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`main.cjs no longer defines ${name}()`)
  const open = source.indexOf('{', source.indexOf(')', start))
  let depth = 0
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++
    else if (source[j] === '}') { depth--; if (depth === 0) return source.slice(start, j + 1) }
  }
  throw new Error(`unbalanced braces extracting ${name}()`)
}

/** A route body as a merge: the disk is a Map of JSON text, so a read is a
 *  parsed COPY and only what the route writes is kept, as on the desktop. */
function routeAsMerge(body) {
  // eslint-disable-next-line no-new-func
  const run = new Function('req', 'res', 'readJSON', 'writeJSON', 'path', 'getSoftwareDir', body)
  return (existing, incoming) => {
    const disk = new Map()
    const file = '/sw/blender/_hotkeys.json'
    if (existing !== undefined) disk.set(file, JSON.stringify(existing))
    const readJSON = (p, fallback) => (disk.has(p) ? JSON.parse(disk.get(p)) : fallback)
    const writeJSON = (p, data) => disk.set(p, JSON.stringify(data))
    const res = { json(x) { this.body = x } }
    run({ params: { slug: 'blender' }, body: { categories: incoming } }, res, readJSON, writeJSON,
      { join: (...parts) => parts.join('/') }, () => '/sw')
    const written = JSON.parse(disk.get(file))
    expect(res.body, 'the route answers with what it wrote').toEqual(written)
    return written
  }
}

// ── the code before S2c, verbatim (the controls) ─────────────────────────────
const normKey = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
function preS2cMergeHotkeys(existing, incoming) {
  const out = { categories: (existing?.categories || []).map(c => ({
    ...c, shortcuts: [...(c.shortcuts || [])],
  })) }
  for (const inCat of incoming || []) {
    const catName = inCat.category || inCat.name || 'General'
    const inShortcuts = inCat.shortcuts || inCat.hotkeys || []
    let cat = out.categories.find(c => normKey(c.category) === normKey(catName))
    if (!cat) { cat = { category: catName, shortcuts: [] }; out.categories.push(cat) }
    for (const hk of inShortcuts) {
      const action = (hk.action || '').toLowerCase().trim()
      if (!cat.shortcuts.some(h => (h.action || '').toLowerCase().trim() === action)) {
        cat.shortcuts.push(hk)
      }
    }
  }
  return out
}
const PRE_S2C_ROUTE_BODY = `{
      const filePath = path.join(getSoftwareDir(), req.params.slug, '_hotkeys.json');
      const existing = readJSON(filePath, { categories: [] });
      const incoming = req.body.categories || [];
      const normalizeCat = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      for (const inCat of incoming) {
        const catName = inCat.category || inCat.name || 'General';
        const inShortcuts = inCat.shortcuts || inCat.hotkeys || [];
        const catNorm = normalizeCat(catName);
        let existCat = existing.categories.find(c => normalizeCat(c.category) === catNorm);
        if (!existCat) { existCat = { category: catName, shortcuts: [] }; existing.categories.push(existCat); }
        for (const hk of inShortcuts) {
          const actionNorm = (hk.action || '').toLowerCase().trim();
          if (!existCat.shortcuts.some(h => (h.action || '').toLowerCase().trim() === actionNorm)) existCat.shortcuts.push(hk);
        }
      }
      writeJSON(filePath, existing);
      res.json(existing);
    }`

// ── the cases ────────────────────────────────────────────────────────────────
const sk = (action) => ({ action, windows: 'Ctrl+K', mac: 'Cmd+K', notes: '' })
const actions = (cat) => (cat.shortcuts || cat.hotkeys).map((s) => s.action)
const heads = (out) => JSON.stringify(out.categories.map((c) => [functionCategoryName(c), actions(c)]))

/** Each case returns null when the merge is right, or why it is wrong. */
const CASES = {
  'names with no Latin letters keep their own heading (the defect itself)': (merge) => {
    const out = merge({ categories: [] }, [{ category: '文字列', shortcuts: [sk('Find text')] }, { category: '数学', shortcuts: [sk('Insert equation')] }])
    return heads(out) === '[["文字列",["Find text"]],["数学",["Insert equation"]]]' ? null : heads(out)
  },
  'a stored name with no Latin letters is not joined by another': (merge) => {
    const out = merge({ categories: [{ category: '文字列', shortcuts: [sk('a')] }] }, [{ category: '数学', shortcuts: [sk('b')] }, { category: 'Строки', shortcuts: [sk('c')] }])
    return heads(out) === '[["文字列",["a"]],["数学",["b"]],["Строки",["c"]]]' ? null : heads(out)
  },
  '"C", "C++" and "C#" are three headings': (merge) => {
    const out = merge({ categories: [] }, [{ category: 'C', shortcuts: [sk('a')] }, { category: 'C++', shortcuts: [sk('b')] }, { category: 'C#', shortcuts: [sk('c')] }])
    return heads(out) === '[["C",["a"]],["C++",["b"]],["C#",["c"]]]' ? null : heads(out)
  },
  'an incoming name that is not a string never throws: it reads `name`, else General': (merge) => {
    const out = merge({ categories: [] }, [{ category: 5, name: 'Math', shortcuts: [sk('x')] }, { category: { a: 1 }, shortcuts: [sk('y')] }, { category: ['z'], shortcuts: [sk('z')] }])
    return JSON.stringify(out.categories.map((c) => [c.category, actions(c)])) === '[["Math",["x"]],["General",["y","z"]]]' ? null : JSON.stringify(out)
  },
  'a stored name that is not a string does not break every later merge': (merge) => {
    const stored = { categories: [{ category: 5, shortcuts: [sk('a')] }, { category: 'Edit', shortcuts: [sk('Undo')] }] }
    const out = merge(stored, [{ category: 'edit', shortcuts: [sk('Redo')] }, { category: 'View', shortcuts: [sk('Zoom')] }])
    return JSON.stringify(out.categories) === JSON.stringify([{ category: 5, shortcuts: [sk('a')] }, { category: 'Edit', shortcuts: [sk('Undo'), sk('Redo')] },
      { category: 'View', shortcuts: [sk('Zoom')] }]) ? null : JSON.stringify(out)
  },
  'a stored `name`-keyed category is the same category as an incoming `category`, kept in its own list': (merge) => {
    const out = merge({ categories: [{ name: 'Transform', hotkeys: [sk('Grab')] }] }, [{ category: 'transform', shortcuts: [sk('grab'), sk('Rotate')] }])
    return JSON.stringify(out.categories) === JSON.stringify([{ name: 'Transform', hotkeys: [sk('Grab'), sk('Rotate')] }]) ? null : JSON.stringify(out)
  },
  'a `name`-keyed stored category is never taken for a name with no Latin letters': (merge) => {
    const out = merge({ categories: [{ name: 'Transform', hotkeys: [sk('Grab')] }] }, [{ category: '文字列', shortcuts: [sk('Find')] }])
    return JSON.stringify(out.categories) === JSON.stringify([{ name: 'Transform', hotkeys: [sk('Grab')] }, { category: '文字列', shortcuts: [sk('Find')] }]) ? null : JSON.stringify(out)
  },
  'the stored nameless category reads as General and takes an incoming General, kept as stored': (merge) => {
    const out = merge({ categories: [{ shortcuts: [sk('a')] }] }, [{ category: 'General', shortcuts: [sk('b')] }])
    return JSON.stringify(out.categories) === JSON.stringify([{ shortcuts: [sk('a'), sk('b')] }]) ? null : JSON.stringify(out)
  },
  'an incoming category with no name, or a blank or invisible one, is written as General': (merge) => {
    const out = merge({ categories: [] }, [{ shortcuts: [sk('a')] }, { category: '   ', shortcuts: [sk('b')] }, { category: '​', name: '', shortcuts: [sk('c')] }])
    return JSON.stringify(out.categories) === JSON.stringify([{ category: 'General', shortcuts: [sk('a'), sk('b'), sk('c')] }]) ? null : JSON.stringify(out)
  },
  'the same name, case and punctuation aside, joins its own heading; a shortcut it has is not added again (as before)': (merge) => {
    const out = merge({ categories: [{ category: '3D Viewport Navigation', shortcuts: [sk('Orbit')] }] },
      [{ category: '  3d viewport-navigation!', shortcuts: [sk(' orbit '), sk('Pan'), sk('pan')] }])
    return heads(out) === '[["3D Viewport Navigation",["Orbit","Pan"]]]' ? null : heads(out)
  },
  'a padded new name is written trimmed': (merge) => {
    const out = merge({ categories: [] }, [{ category: '  Tools  ', shortcuts: [sk('x')] }])
    return JSON.stringify(out.categories.map((c) => c.category)) === '["Tools"]' ? null : JSON.stringify(out)
  },
  'an action that is not a string never throws (it reads as none)': (merge) => {
    const out = merge({ categories: [{ category: 'Edit', shortcuts: [{ action: 5, windows: 'X' }] }] },
      [{ category: 'Edit', shortcuts: [{ action: { a: 1 } }, sk('Cut')] }])
    return JSON.stringify(out.categories) === JSON.stringify([{ category: 'Edit', shortcuts: [{ action: 5, windows: 'X' }, sk('Cut')] }]) ? null : JSON.stringify(out)
  },
  'a stored `hotkeys` list takes the new shortcuts, deduplicated against it': (merge) => {
    const out = merge({ categories: [{ category: 'Mesh', hotkeys: [sk('Extrude')] }] }, [{ category: 'Mesh', shortcuts: [sk('extrude'), sk('Inset')] }])
    return JSON.stringify(out.categories) === JSON.stringify([{ category: 'Mesh', hotkeys: [sk('Extrude'), sk('Inset')] }]) ? null : JSON.stringify(out)
  },
  'a stored category the merge adds nothing to is left exactly as stored, and the document keeps its other keys': (merge) => {
    const stored = { version: 2, categories: [{ category: 'Edit', note: 'kept', shortcuts: [sk('Undo')] }, { category: 'View', hotkeys: [] }] }
    const out = merge(stored, [{ category: 'edit', shortcuts: [sk('undo')] }])
    return JSON.stringify(out) === JSON.stringify(stored) ? null : JSON.stringify(out)
  },
  'entries that are not categories are carried over untouched and never matched': (merge) => {
    const out = merge({ categories: [null, 'x', { category: 'Str', shortcuts: 'ab' }, { category: 'General', shortcuts: [sk('f1')] }] },
      [{ category: 'Str', shortcuts: [sk('g')] }, { shortcuts: [sk('h')] }, null, 'junk', { category: 'Bad', shortcuts: [null, 'k', sk('m')] }])
    return JSON.stringify(out.categories) === JSON.stringify([
      null, 'x', { category: 'Str', shortcuts: 'ab' }, { category: 'General', shortcuts: [sk('f1'), sk('h')] },
      { category: 'Str', shortcuts: [sk('g')] }, { category: 'Bad', shortcuts: [sk('m')] },
    ]) ? null : JSON.stringify(out)
  },
  'a category whose every shortcut is not an object makes no empty heading': (merge) => {
    const out = merge({ categories: [] }, [{ category: 'Junk', shortcuts: [null, 'x', 4] }])
    return JSON.stringify(out.categories) === '[]' ? null : JSON.stringify(out)
  },
  'a category sent with no shortcuts is made as sent (a fork\'s empty category moves on approval)': (merge) => {
    const out = merge({ categories: [] }, [{ category: 'Later', shortcuts: [] }])
    return JSON.stringify(out.categories) === JSON.stringify([{ category: 'Later', shortcuts: [] }]) ? null : JSON.stringify(out)
  },
  'a stored document that is not a library is left exactly as it is': (merge) => {
    for (const stored of [[{ category: 'A', shortcuts: [] }], { categories: 'not a list', keep: 1 }, { categories: { A: [] } }]) {
      const out = merge(stored, [{ category: 'X', shortcuts: [sk('x')] }])
      if (JSON.stringify(out) !== JSON.stringify(stored)) return JSON.stringify(out)
    }
    return null
  },
  'a stored document with no category list gets one, and keeps its other keys': (merge) => {
    const out = merge({ version: 2 }, [{ category: 'A', shortcuts: [sk('a')] }])
    return JSON.stringify(out) === JSON.stringify({ version: 2, categories: [{ category: 'A', shortcuts: [sk('a')] }] }) ? null : JSON.stringify(out)
  },
  'a category carrying both keys is its `category`; words run together are another heading; `hotkeys` is read when `shortcuts` is not a list': (merge) => {
    const out = merge({ categories: [{ category: 'Strings', name: 'Text', shortcuts: [sk('a')] }] },
      [{ name: 'Text', shortcuts: [sk('b')] }, { category: 'Strings', name: 'Other', hotkeys: [sk('c')] },
        { category: 'String methods', shortcuts: [sk('d')] }, { category: 'Stringmethods', shortcuts: 'no', hotkeys: [sk('e')] }])
    return heads(out) === '[["Strings",["a","c"]],["Text",["b"]],["String methods",["d"]],["Stringmethods",["e"]]]' ? null : heads(out)
  },
}
/** The cases each pre-S2c copy gets WRONG — and only these. */
const DEFECT_CASES = {
  cloud: [
    'names with no Latin letters keep their own heading (the defect itself)',
    'a stored name with no Latin letters is not joined by another',
    '"C", "C++" and "C#" are three headings',
    'an incoming name that is not a string never throws: it reads `name`, else General',
    'a stored name that is not a string does not break every later merge',
    'a stored `name`-keyed category is the same category as an incoming `category`, kept in its own list',
    'a `name`-keyed stored category is never taken for a name with no Latin letters',
    'the stored nameless category reads as General and takes an incoming General, kept as stored',
    'an incoming category with no name, or a blank or invisible one, is written as General',
    'a padded new name is written trimmed',
    'an action that is not a string never throws (it reads as none)',
    'a stored `hotkeys` list takes the new shortcuts, deduplicated against it',
    'a stored category the merge adds nothing to is left exactly as stored, and the document keeps its other keys',
    'entries that are not categories are carried over untouched and never matched',
    'a category whose every shortcut is not an object makes no empty heading',
    'a stored document that is not a library is left exactly as it is',
    'a stored document with no category list gets one, and keeps its other keys',
    'a category carrying both keys is its `category`; words run together are another heading; `hotkeys` is read when `shortcuts` is not a list',
  ],
  local: [
    'names with no Latin letters keep their own heading (the defect itself)',
    'a stored name with no Latin letters is not joined by another',
    '"C", "C++" and "C#" are three headings',
    'an incoming name that is not a string never throws: it reads `name`, else General',
    'a stored name that is not a string does not break every later merge',
    'a stored `name`-keyed category is the same category as an incoming `category`, kept in its own list',
    'a `name`-keyed stored category is never taken for a name with no Latin letters',
    'the stored nameless category reads as General and takes an incoming General, kept as stored',
    'an incoming category with no name, or a blank or invisible one, is written as General',
    'a padded new name is written trimmed',
    'an action that is not a string never throws (it reads as none)',
    'a stored `hotkeys` list takes the new shortcuts, deduplicated against it',
    'entries that are not categories are carried over untouched and never matched',
    'a category whose every shortcut is not an object makes no empty heading',
    'a stored document that is not a library is left exactly as it is',
    'a stored document with no category list gets one, and keeps its other keys',
    'a category carrying both keys is its `category`; words run together are another heading; `hotkeys` is read when `shortcuts` is not a list',
  ],
}
/** A check that throws is a failure too (the pre-S2c copies crash on some). */
const failures = (merge) => Object.entries(CASES).filter(([, check]) => {
  try { return check(merge) !== null } catch { return true }
}).map(([title]) => title)

const LOCAL = 'Local Server (main.cjs /hotkeys/merge, replayed)'
const BACKENDS = {
  'cloud and dev fixtures (otterRoutes.mergeHotkeys)': mergeHotkeys,
  [LOCAL]: routeAsMerge(extractRouteBody(MAIN_CJS, ROUTE_HEAD)),
}

describe('the hotkeys merge keys a category as the function library\'s merge does (S2c, S2b-02)', () => {
  for (const [backend, merge] of Object.entries(BACKENDS)) {
    describe(backend, () => {
      for (const [title, check] of Object.entries(CASES)) it(title, () => expect(check(merge)).toBeNull())
      it('does not mutate the stored document it is given', () => {
        const stored = { categories: [{ name: 'Transform', hotkeys: [sk('Grab')] }, { category: '文字列', shortcuts: [sk('a')] }] }
        const before = JSON.stringify(stored)
        merge(stored, [{ category: 'transform', shortcuts: [sk('Rotate')] }, { category: '数学', shortcuts: [sk('b')] }])
        expect(JSON.stringify(stored)).toBe(before)
      })
    })
  }

  it('the two backends write the same document for every case (cloud and local behave alike)', () => {
    for (const [title, check] of Object.entries(CASES)) {
      const record = (m, seen) => (e, i) => { const out = m(e, i); seen.push(JSON.stringify(out)); return out }
      const cloud = [], desk = []
      check(record(mergeHotkeys, cloud))
      check(record(BACKENDS[LOCAL], desk))
      expect(cloud.length, title).toBeGreaterThan(0)
      expect(desk, title).toEqual(cloud)
    }
  })

  it('CONTROL: the pre-S2c keying fails exactly its defect cases, on each backend', () => {
    expect(failures(preS2cMergeHotkeys)).toEqual(DEFECT_CASES.cloud)
    expect(failures(routeAsMerge(PRE_S2C_ROUTE_BODY))).toEqual(DEFECT_CASES.local)
  })

  it('the two copies agree on 600 seeded random documents and batches (drift outside the cases)', () => {
    let seed = 20261005
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
    const pick = (xs) => xs[Math.floor(rnd() * xs.length)]
    const NAMES = ['Edit', 'edit', ' Edit ', 'Edit-mode', 'Edit mode', 'Editmode', 'C', 'C++', 'C#', 'Строки', 'строки',
      'Python строки', '文字列', '数学', '', '   ', '​', 'General', 'general', 5, null, ['x'], { a: 1 }]
    const ACTIONS = ['Undo', 'undo', ' Undo ', 'Redo', 'Cut', '', null, 7, { a: 1 }, 'Найти']
    const hkOf = () => (rnd() < 0.1 ? pick([null, 'raw', 3, ['h']]) : (rnd() < 0.1 ? { windows: 'X' } : { action: pick(ACTIONS), windows: `k${Math.floor(rnd() * 3)}` }))
    const listOf = () => Array.from({ length: Math.floor(rnd() * 4) }, hkOf)
    const catOf = () => {
      if (rnd() < 0.08) return pick([null, 'junk', 4, []])
      const c = {}
      if (rnd() < 0.7) c.category = pick(NAMES)
      if (rnd() < 0.3) c.name = pick(NAMES)
      const r = rnd()
      if (r < 0.55) c.shortcuts = listOf()
      else if (r < 0.75) c.hotkeys = listOf()
      else if (r < 0.82) { c.shortcuts = pick(['ab', 5, { x: 1 }, null]); if (rnd() < 0.5) c.hotkeys = listOf() }
      else if (r < 0.86) c.hotkeys = pick(['ab', 5, null])
      if (rnd() < 0.1) c.note = 'kept'
      return c
    }
    const docOf = () => {
      const r = rnd()
      if (r < 0.05) return pick([null, [], 'x', { categories: 'not a list' }, { categories: { a: 1 } }])
      const d = { categories: Array.from({ length: Math.floor(rnd() * 4) }, catOf) }
      if (rnd() < 0.1) d.version = 2
      if (rnd() < 0.05) delete d.categories
      return d
    }
    const local = BACKENDS[LOCAL]
    const apart = []
    for (let n = 0; n < 600 && apart.length < 3; n++) {
      const doc = docOf()
      const batch = rnd() < 0.05 ? pick([null, 'x', {}]) : Array.from({ length: Math.floor(rnd() * 4) }, catOf)
      const a = JSON.stringify(mergeHotkeys(JSON.parse(JSON.stringify(doc)), JSON.parse(JSON.stringify(batch))))
      let b
      try { b = JSON.stringify(local(JSON.parse(JSON.stringify(doc)), JSON.parse(JSON.stringify(batch)))) } catch (e) { b = `threw ${e.message}` }
      if (a !== b) apart.push({ doc, batch, cloud: a, local: b })
    }
    expect(apart, JSON.stringify(apart, null, 1)).toEqual([])
  })

  it('ONE keying: the hotkeys merge matches a heading exactly when the function library\'s merge does', () => {
    // The cloud copies share the helper (categoryKeyOf); this holds them to
    // it by behaviour, over every pair of a set of names that tell keyings
    // apart, so a hotkeys-only key could not creep back in.
    const NAMES = ['Edit', ' edit!', 'Edit mode', 'Editmode', 'C', 'C++', 'C#', '文字列', '数学', 'Строки', 'строки', 'General', '', '​', 5]
    const bad = []
    for (const stored of NAMES) for (const sent of NAMES) {
      const hk = mergeHotkeys({ categories: [{ category: stored, shortcuts: [sk('a')] }] }, [{ category: sent, shortcuts: [sk('b')] }]).categories.length === 1
      const fn = mergeFunctions({ categories: [{ category: stored, functions: [{ name: 'a' }] }] }, [{ category: sent, functions: [{ name: 'b' }] }]).categories.length === 1
      if (hk !== fn) bad.push(`${JSON.stringify(stored)} ← ${JSON.stringify(sent)}: hotkeys ${hk ? 'joins' : 'apart'}, functions ${fn ? 'joins' : 'apart'}`)
    }
    expect(bad).toEqual([])
    // Both cloud merges key through the one helper, and nothing else keys a library category.
    const body = (name) => ROUTES_JS.slice(ROUTES_JS.indexOf(`export function ${name}(`), ROUTES_JS.indexOf('\n}\n', ROUTES_JS.indexOf(`export function ${name}(`)))
    for (const name of ['mergeHotkeys', 'mergeFunctions']) {
      expect(body(name), name).toMatch(/categoryKeyOf\(c\) === categoryKeyOf\(inCat\)/)
      expect(body(name), name).not.toMatch(/normKey\(/)
    }
  })

  it('ONE algorithm on the desktop: the route keys exactly as mergeFunctionsDoc does (S2b)', () => {
    const route = extractRouteBody(MAIN_CJS, ROUTE_HEAD)
    const helper = extractFunction(MAIN_CJS, 'mergeFunctionsDoc')
    for (const line of [
      "const clean = (v) => (typeof v === 'string' ? v.replace(/\\p{Cf}/gu, '').trim() : '');",
      "const catName = (c) => clean(c && c.category) || clean(c && c.name) || 'General';",
      "const catKey = (n) => n.toLowerCase().replace(/[^\\p{L}\\p{N}#+]+/gu, ' ').trim() || n.toLowerCase();",
    ]) {
      expect(helper, 'the functions helper keys with this line').toContain(line)
      expect(route, 'the hotkeys route keys with the same line').toContain(line)
    }
    expect(route).toMatch(/findIndex\(c => isCat\(c\) && catKey\(catName\(c\)\) === catKey\(name\)\)/)
  })

  it('CONTROL: the route reader lifts the shipped route, not a stale copy', () => {
    const shipped = extractRouteBody(MAIN_CJS, ROUTE_HEAD)
    expect(shipped).toMatch(/_hotkeys\.json/)
    expect(shipped).not.toMatch(/normalizeCat|\[\^a-z0-9\]/)
    expect(MAIN_CJS.split(ROUTE_HEAD)).toHaveLength(2) // registered once
    expect(() => extractRouteBody('nothing here', ROUTE_HEAD)).toThrow(/no longer registers/)
  })
})

describe('every hotkeys merge path reaches the fixed merge', () => {
  it('the cloud adapter and the fixtures merge through DOC_MERGERS, and an approval through CR_DOC_MERGE', () => {
    expect(DOC_MERGERS.hotkeys).toBe(mergeHotkeys)
    // A fork's stored library: the generator's shape, a `name`/`hotkeys` one, and names with no Latin letters.
    const out = CR_DOC_MERGE.hotkeys({ categories: [{ category: 'Edit', shortcuts: [sk('Undo')] }, { category: '文字列', shortcuts: [sk('a')] }] },
      { categories: [{ name: 'edit', hotkeys: [sk('Redo')] }, { category: '数学', shortcuts: [sk('b')] }] })
    expect(heads(out)).toBe('[["Edit",["Undo","Redo"]],["文字列",["a"]],["数学",["b"]]]')
  })

  it('the dev fixtures: categories with no Latin letters posted to /hotkeys/merge read back apart', () => {
    const fx = buildDevFixtures()
    const call = (path, method = 'GET', body) => fx.otter.handle(parseOtterRoute(path, method), body)
    const before = call(`/api/software/${COURSE_ID}/hotkeys`).body.categories.length
    const merged = call(`/api/software/${COURSE_ID}/hotkeys/merge`, 'POST', { categories: [
      { category: '文字列', shortcuts: [sk('Find text')] }, { category: '数学', shortcuts: [sk('Insert equation')] },
    ] })
    expect(merged.status).toBe(200)
    const after = call(`/api/software/${COURSE_ID}/hotkeys`).body.categories
    expect(after).toHaveLength(before + 2)
    expect(after.slice(-2).map((c) => [c.category, actions(c)])).toEqual([['文字列', ['Find text']], ['数学', ['Insert equation']]])
  })
})
