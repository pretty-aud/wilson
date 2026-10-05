#!/usr/bin/env node
/**
 * Post-overhaul S2c — O.T.T.E.R.'s readers and merges, replayed over Audrey's
 * REAL library (post-overhaul plan §4 item 10), with no browser:
 *
 *   node scripts/otter-library-replay.mjs [pet] [hotkeys] [readers] [--library <dir>]
 *
 *   pet      S2b-01: the pet's knowledge index (petKnowledge.js, the shipped
 *            module) built over her library through a read-only stand-in for
 *            the Local Server's GET routes — every function row's group, per
 *            course, and the REFERENCE ENTRIES lines the pet is handed for a
 *            Python question.
 *   hotkeys  S2b-02: her six hotkey documents through BOTH copies of the
 *            hotkeys merge — otterRoutes.js's mergeHotkeys (the cloud adapter
 *            and the dev fixtures) and the Local Server's
 *            `/api/software/:slug/hotkeys/merge` route, lifted out of
 *            electron/main.cjs as text and run over an in-memory disk — on
 *            three batches: her own categories sent again, names with no Latin
 *            letters, and a name that is not a string.
 *   readers  S2b-05: her Python library with entries that are not objects
 *            planted IN MEMORY (null, a string, a number, a list), through the
 *            pet's flattenDoc and the Search dialog's function search (lifted
 *            out of Otter.jsx as text, between "// Functions search" and
 *            "// Nodes search"). The Functions view's card is replayed in the
 *            browser by scripts/otter-reading-shots.mjs --plant.
 *
 * READ-ONLY: the library is read with readFileSync and nothing is written
 * anywhere — no subject list is "renumbered" (the Local Server's GET
 * /:slug/subjects rewrites every subject file; this stand-in does not), no
 * merge result reaches a disk.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { clearPetKnowledgeCache, loadKnowledgeIndex, retrieveOtterKnowledge, flattenDoc } from '../src/tools/otter_v0.3.1/petKnowledge.js'
import * as routes from '../src/tools/otter_v0.3.1/adapters/otterRoutes.js'

const { mergeHotkeys, functionCategoryName } = routes
// S2c's reader (S2b-05); absent before it, when the lifted search does not name it.
const functionEntries = routes.functionEntries || (() => [])

const args = process.argv.slice(2)
const flag = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : dflt }
const LIBRARY = flag('library', join(process.env.APPDATA || '', 'wilson', 'otter-data', 'software'))
const wanted = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')))
const RUN = new Set(wanted.length ? wanted : ['pet', 'hotkeys', 'readers'])
if (!existsSync(LIBRARY)) { console.error(`no library at ${LIBRARY}`); process.exit(1) }
const readJson = (p, fallback) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return fallback } }
const slugs = readdirSync(LIBRARY).filter((s) => statSync(join(LIBRARY, s)).isDirectory() && existsSync(join(LIBRARY, s, '_meta.json')))
const out = (o) => console.log(JSON.stringify(o))
out({ library: LIBRARY, courses: slugs.length, subjects: slugs.reduce((n, s) => n + (existsSync(join(LIBRARY, s, 'subjects')) ? readdirSync(join(LIBRARY, s, 'subjects')).filter((f) => f.endsWith('.json')).length : 0), 0) })

// ── a read-only stand-in for the Local Server's GET routes ──────────────────
function libraryFetch(root) {
  const json = (data) => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(data)) })
  const missing = { ok: false, status: 404, json: async () => ({}) }
  return async (url) => {
    const seg = url.split('?')[0].split('/').filter(Boolean).map(decodeURIComponent) // api, software, …
    if (seg[0] !== 'api' || seg[1] !== 'software') return missing
    if (seg.length === 2) {
      return json(slugs.map((slug) => {
        const meta = readJson(join(root, slug, '_meta.json'), {})
        return { slug, name: meta.name || slug, type: meta.type || 'software', skill_level: meta.skill_level || 'beginner', created_at: meta.created_at }
      }))
    }
    const dir = join(root, seg[2])
    if (!existsSync(dir)) return missing
    if (seg[3] === 'subjects' && seg.length === 4) {
      const sdir = join(dir, 'subjects')
      const files = existsSync(sdir) ? readdirSync(sdir).filter((f) => f.endsWith('.json')) : []
      return json(files.map((f) => readJson(join(sdir, f), null)).filter(Boolean).map((s) => ({
        slug: s.slug, title: s.title || s.slug, description: s.description || '', skill_level: s.skill_level || 'beginner', is_stub: !!s.is_stub, subject_order: s.subject_order,
      })))
    }
    if (seg[3] === 'subjects' && seg.length === 5) {
      const s = readJson(join(dir, 'subjects', `${seg[4]}.json`), null)
      return s ? json(s) : missing
    }
    if (['hotkeys', 'functions'].includes(seg[3]) && seg.length === 4) return json(readJson(join(dir, `_${seg[3]}.json`), { categories: [] }))
    if (seg[3] === 'nodes' && seg.length === 4) {
      const raw = readJson(join(dir, '_nodes.json'), { systems: [] })
      // main.cjs migrateNodesData, for the shapes her library holds.
      return json(raw.systems ? raw : { systems: (raw.categories || []).length ? [{ system: 'General', categories: raw.categories }] : [] })
    }
    return missing
  }
}

// ── pet: S2b-01 ─────────────────────────────────────────────────────────────
if (RUN.has('pet')) {
  clearPetKnowledgeCache()
  const fetchImpl = libraryFetch(LIBRARY)
  const index = await loadKnowledgeIndex(fetchImpl)
  for (const c of index.courses) {
    const fnRows = c.docRows.filter((r) => r.kind === 'functions')
    const groups = {}
    for (const r of fnRows) groups[JSON.stringify(r.group)] = (groups[JSON.stringify(r.group)] || 0) + 1
    out({ pet: c.name, rows: c.docRows.length, functionRows: fnRows.length, functionGroups: groups })
  }
  clearPetKnowledgeCache()
  // A question her Python rows answer (one that needs a stem a row does not
  // carry — "function" — finds nothing, before and after alike).
  const question = 'how do I use print in python'
  const { block } = await retrieveOtterKnowledge({ question, fetchImpl })
  const lines = block.split('\n').filter((l) => /^- \[Python → functions/.test(l))
  out({ pet: 'REFERENCE ENTRIES for Python functions', question, lines: lines.length, first: lines.slice(0, 3).map((l) => l.slice(0, 110)) })
  clearPetKnowledgeCache()
}

// ── hotkeys: S2b-02 ─────────────────────────────────────────────────────────
/** The BODY of an inline `expressApp.<verb>('<path>', (req, res) => { … })`
 *  (functionsMerge.test.js's reader). */
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
if (RUN.has('hotkeys')) {
  const MAIN = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8')
  // eslint-disable-next-line no-new-func
  const run = new Function('req', 'res', 'readJSON', 'writeJSON', 'path', 'getSoftwareDir', extractRouteBody(MAIN, "expressApp.post('/api/software/:slug/hotkeys/merge'"))
  const local = (existing, incoming) => {
    const disk = new Map([['/sw/x/_hotkeys.json', JSON.stringify(existing)]])
    const res = { json(x) { this.body = x } }
    run({ params: { slug: 'x' }, body: { categories: incoming } }, res,
      (p, fb) => (disk.has(p) ? JSON.parse(disk.get(p)) : fb), (p, d) => disk.set(p, JSON.stringify(d)),
      { join: (...p) => p.join('/') }, () => '/sw')
    return JSON.parse(disk.get('/sw/x/_hotkeys.json'))
  }
  const cloud = (existing, incoming) => JSON.parse(JSON.stringify(mergeHotkeys(JSON.parse(JSON.stringify(existing)), JSON.parse(JSON.stringify(incoming)))))
  const attempt = (merge, doc, batch) => { try { return { doc: merge(JSON.parse(JSON.stringify(doc)), JSON.parse(JSON.stringify(batch))) } } catch (e) { return { threw: e.message } } }
  const heads = (r) => (r.threw ? `threw: ${r.threw}` : r.doc.categories.map((c) => `${typeof c?.category === 'string' ? c.category : JSON.stringify(c?.category)} (${(c?.shortcuts || []).length})`))
  const sk = (action) => ({ action, windows: 'Ctrl+K', mac: 'Cmd+K', notes: '' })
  const BATCHES = {
    'her own categories sent again': (doc) => doc.categories,
    'two names with no Latin letters': () => [{ category: '文字列', shortcuts: [sk('Find text')] }, { category: '数学', shortcuts: [sk('Insert equation')] }],
    'a name that is not a string': () => [{ category: 5, shortcuts: [sk('Five')] }],
    'the same name, case and punctuation aside': (doc) => (doc.categories[0] ? [{ category: `  ${doc.categories[0].category.toUpperCase()}!`, shortcuts: [sk('Extra')] }] : []),
  }
  for (const slug of slugs) {
    const doc = readJson(join(LIBRARY, slug, '_hotkeys.json'), { categories: [] })
    const before = JSON.stringify(doc)
    for (const [label, make] of Object.entries(BATCHES)) {
      const batch = make(doc)
      if (!batch.length) continue
      const c = attempt(cloud, doc, batch), l = attempt(local, doc, batch)
      const same = JSON.stringify(c) === JSON.stringify(l)
      const added = (r) => (r.threw ? null : r.doc.categories.length - doc.categories.length)
      const unchanged = (r) => (r.threw ? null : JSON.stringify(r.doc) === before)
      out({ hotkeys: slug, batch: label, cloud: { added: added(c), unchanged: unchanged(c), threw: c.threw || null }, local: { added: added(l), unchanged: unchanged(l), threw: l.threw || null }, backendsAgree: same,
        ...(label === 'her own categories sent again' ? {} : { cloudTail: c.threw ? heads(c) : heads(c).slice(doc.categories.length - 1), localTail: l.threw ? heads(l) : heads(l).slice(doc.categories.length - 1) }) })
    }
    if (JSON.stringify(doc) !== before) throw new Error('a merge mutated the document it was handed')
  }
}

// ── readers: S2b-05 ─────────────────────────────────────────────────────────
if (RUN.has('readers')) {
  const OTTER = readFileSync(new URL('../src/tools/otter_v0.3.1/Otter.jsx', import.meta.url), 'utf8')
  const a = OTTER.indexOf('// Functions search'), b = OTTER.indexOf('// Nodes search', a)
  if (a < 0 || b < 0) throw new Error('Otter.jsx no longer marks the function search')
  // FunctionCard.jsx's cardText, which the search reads each field through
  // since S2c — a COPY, because Node cannot import a .jsx module.
  const cardText = (v) => {
    if (v == null || typeof v === 'boolean') return ''
    if (Array.isArray(v)) return v.map(cardText).join('')
    if (typeof v === 'object') { try { return JSON.stringify(v) } catch { return String(v) } }
    return String(v)
  }
  // eslint-disable-next-line no-new-func
  const search = new Function('cached', 'q', 'sw', 'results', 'functionCategoryName', 'functionEntries', 'cardText', OTTER.slice(a, b))
  const PLANTS = { null: null, 'a string': 'print', 'a number': 5, 'a list': ['len'] }
  // …and one level up: a category that is not one, a list that is not one.
  const CATEGORY_PLANTS = { 'a null category': null, 'a category whose list is a number': { category: 'Bad', functions: 5 } }
  for (const slug of slugs) {
    const doc = readJson(join(LIBRARY, slug, '_functions.json'), { categories: [] })
    const cats = (doc.categories || []).filter((c) => c && Array.isArray(c.functions) && c.functions.length)
    if (!cats.length) continue
    const real = cats.reduce((n, c) => n + c.functions.length, 0)
    const report = { readers: slug, functions: real, headings: cats.map(functionCategoryName) }
    // Her library as stored, then each plant alone, IN MEMORY.
    for (const [label, value] of [['as stored', undefined], ...Object.entries(PLANTS), ...Object.entries(CATEGORY_PLANTS)]) {
      const copy = JSON.parse(JSON.stringify(doc))
      if (label in CATEGORY_PLANTS) copy.categories.splice(0, 0, value)
      else if (label !== 'as stored') copy.categories.find((c) => c && Array.isArray(c.functions) && c.functions.length).functions.splice(1, 0, value)
      let pet, dialog
      try { const rows = flattenDoc(copy, 'functions'); pet = { rows: rows.length, groups: [...new Set(rows.map((r) => r.group))] } } catch (e) { pet = { threw: e.message } }
      try {
        const results = []
        search({ functions: copy }, 'print', { name: 'Python', slug }, results, functionCategoryName, functionEntries, cardText)
        dialog = results.length ? { matches: results[0].matches, cards: results[0].matchedCategories.reduce((n, c) => n + c.functions.length, 0) } : { results: 0 }
      } catch (e) { dialog = { threw: e.message } }
      report[label] = { pet, searchDialog: dialog }
    }
    out(report)
  }
}
