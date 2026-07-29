// =============================================================================
// otterRoutes.js — Session 10
//
// Pure parser for O.T.T.E.R.'s local HTTP surface. Otter.jsx and Validator.jsx
// address their data through ~90 hand-written `fetch('/api/software/...')`
// calls against the Express server embedded in electron/main.cjs. Rewriting
// every call site into a method API would be a huge, risky diff across a
// 4,600-line component — and would still leave the web build broken, because
// a browser has no in-app Express server at all.
//
// Instead the call sites keep their shape and route through otterFetch(),
// which uses this parser to decide what a URL means and hands the request to
// whichever backend is active. Keeping the parse pure and separate is what
// makes it unit-testable without a database or a running server.
//
// Route order matters: /subjects/renumber and /subjects/reorder are literal
// paths that would otherwise be swallowed by /subjects/:sub.
// =============================================================================

/** Per-course singleton documents. Each is one whole-document JSON blob. */
export const COURSE_DOCS = {
  hotkeys:     { column: 'hotkeys',        empty: { categories: [] } },
  functions:   { column: 'functions',      empty: { categories: [] } },
  nodes:       { column: 'nodes',          empty: { systems: [] } },
  references:  { column: 'reference_urls', empty: { urls: [] } },
  corrections: { column: 'corrections',    empty: { corrections: [] } },
}

/**
 * Parse an O.T.T.E.R. API path + method into an operation descriptor.
 *
 * @param {string} pathname  e.g. '/api/software/blender/subjects/intro'
 * @param {string} method    HTTP verb, case-insensitive
 * @returns {{op: string, slug?: string, sub?: string, doc?: string}|null}
 *          null when the path is not an O.T.T.E.R. route (the caller should
 *          fall through to the real network).
 */
export function parseOtterRoute(pathname, method = 'GET') {
  if (typeof pathname !== 'string') return null

  // Tolerate absolute URLs and query strings — call sites build both.
  let path = pathname
  const schemeAt = path.indexOf('://')
  if (schemeAt !== -1) {
    const slashAt = path.indexOf('/', schemeAt + 3)
    path = slashAt === -1 ? '/' : path.slice(slashAt)
  }
  path = path.split('?')[0].split('#')[0]

  const verb = String(method || 'GET').toUpperCase()
  const parts = path.split('/').filter(Boolean)

  if (parts[0] !== 'api') return null

  if (parts.length === 2 && parts[1] === 'export-all' && verb === 'GET') {
    return { op: 'export.all' }
  }

  // Session 11 surfaces live under /api/otter/, NOT under /api/software/.
  // /api/software/:slug already swallows any second segment, so a literal
  // /api/software/trash would be ambiguous with a course whose slug is
  // "trash" — impossible in cloud mode (slugs are UUIDs there) but perfectly
  // possible in local mode, where slug = slugify(name). A separate prefix
  // removes the question instead of relying on that.
  //
  // Every one of these is cloudOnly: the Express server in electron/main.cjs
  // has no such routes and never will (sharing, grants and change requests are
  // meaningless without a workspace). otterFetch answers 501 in local mode
  // rather than letting Express 404 into a call site that does not check res.ok.
  if (parts[1] === 'otter') {
    const seg = parts.slice(2).map(decodeURIComponent)

    // /api/otter/trash
    if (seg.length === 1 && seg[0] === 'trash' && verb === 'GET') {
      return { op: 'trash.list', cloudOnly: true }
    }
    // /api/otter/trash/restore   body: { table, id }
    if (seg.length === 2 && seg[0] === 'trash' && seg[1] === 'restore' && verb === 'POST') {
      return { op: 'trash.restore', cloudOnly: true }
    }

    // /api/otter/courses/:id/{fork,editors[/:userId]}
    if (seg[0] === 'courses' && seg.length >= 3) {
      const slug = seg[1]
      if (seg.length === 3 && seg[2] === 'fork' && verb === 'POST') {
        return { op: 'course.fork', slug, cloudOnly: true }
      }
      if (seg.length === 3 && seg[2] === 'editors') {
        if (verb === 'GET')  return { op: 'editors.list', slug, cloudOnly: true }
        if (verb === 'POST') return { op: 'editors.add',  slug, cloudOnly: true }
        return null
      }
      if (seg.length === 4 && seg[2] === 'editors' && verb === 'DELETE') {
        return { op: 'editors.remove', slug, userId: seg[3], cloudOnly: true }
      }
      return null
    }

    // /api/otter/change-requests[/:id]
    if (seg[0] === 'change-requests') {
      if (seg.length === 1) {
        if (verb === 'GET')  return { op: 'cr.list', cloudOnly: true }
        if (verb === 'POST') return { op: 'cr.create', cloudOnly: true }
        return null
      }
      if (seg.length === 2 && verb === 'PATCH') {
        return { op: 'cr.update', id: seg[1], cloudOnly: true }
      }
      return null
    }

    return null
  }

  if (parts[1] !== 'software') return null

  const seg = parts.slice(2).map(decodeURIComponent)

  // /api/software
  if (seg.length === 0) {
    if (verb === 'GET')  return { op: 'course.list' }
    if (verb === 'POST') return { op: 'course.create' }
    return null
  }

  const slug = seg[0]

  // /api/software/:slug
  if (seg.length === 1) {
    if (verb === 'GET')    return { op: 'course.get', slug }
    if (verb === 'DELETE') return { op: 'course.delete', slug }
    if (verb === 'PATCH')  return { op: 'course.update', slug }
    return null
  }

  const tail = seg[1]

  // /api/software/:slug/subjects[...]
  if (tail === 'subjects') {
    if (seg.length === 2) {
      if (verb === 'GET')  return { op: 'subject.list', slug }
      if (verb === 'POST') return { op: 'subject.save', slug }
      return null
    }
    // Literal sub-routes must be tested before treating seg[2] as a slug.
    if (seg.length === 3 && seg[2] === 'renumber' && verb === 'POST') {
      return { op: 'subject.renumber', slug }
    }
    if (seg.length === 3 && seg[2] === 'reorder' && verb === 'POST') {
      return { op: 'subject.reorder', slug }
    }
    if (seg.length === 3) {
      const sub = seg[2]
      if (verb === 'GET')    return { op: 'subject.get', slug, sub }
      if (verb === 'DELETE') return { op: 'subject.delete', slug, sub }
      // Validator.jsx:441 issues a PUT here. No such Express route exists, so
      // against the local server it has always been a silent 404 — the
      // "apply fix" button never persisted anything. Cloud mode treats it as
      // the save it was clearly meant to be.
      if (verb === 'PUT')    return { op: 'subject.save', slug, sub }
      return null
    }
    return null
  }

  // /api/software/:slug/{hotkeys,functions,nodes,references,corrections}[/merge]
  if (Object.prototype.hasOwnProperty.call(COURSE_DOCS, tail)) {
    if (seg.length === 2) {
      if (verb === 'GET')  return { op: 'doc.get', slug, doc: tail }
      if (verb === 'POST') {
        // `references` is a whole-document write; `corrections` is NOT — the
        // Express handler (main.cjs:532-544) merged the posted corrections by
        // id into the stored document and returned the merged result. The agent
        // posts ONE correction at a time (Otter.jsx:276-280), so treating this
        // as an overwrite would erase the entire correction memory on every
        // save. hotkeys/functions/nodes only ever arrive via /merge.
        return { op: tail === 'corrections' ? 'doc.merge' : 'doc.put', slug, doc: tail }
      }
      return null
    }
    if (seg.length === 3 && seg[2] === 'merge' && verb === 'POST') {
      return { op: 'doc.merge', slug, doc: tail }
    }
    return null
  }

  // /api/software/:slug/progress — per-user, not a course document.
  if (tail === 'progress' && seg.length === 2) {
    if (verb === 'GET')  return { op: 'progress.get', slug }
    if (verb === 'POST') return { op: 'progress.put', slug }
    return null
  }

  // /api/software/:slug/quiz-history — per-user, alongside progress.
  if (tail === 'quiz-history' && seg.length === 2) {
    if (verb === 'GET')  return { op: 'quiz.get', slug }
    if (verb === 'POST') return { op: 'quiz.put', slug }
    return null
  }

  return null
}

/**
 * Merge semantics lifted verbatim from electron/main.cjs so cloud and local
 * behave identically. Each returns a NEW document; none mutates its input.
 *
 * The normalisation quirks are deliberate and load-bearing — the generator
 * emits `category`/`name`/`shortcuts`/`hotkeys` interchangeably, and the
 * on-disk data already contains every variant.
 */
const normKey = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export function mergeHotkeys(existing, incoming) {
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

export function mergeFunctions(existing, incoming) {
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

/** Old `{categories:[]}` node documents are upgraded to `{systems:[]}`. */
export function migrateNodesData(data) {
  if (data?.systems) return data
  if (!data?.categories || data.categories.length === 0) return { systems: [] }
  const systemMap = {}
  for (const cat of data.categories) {
    const catName = cat.category || 'General'
    const lower = catName.toLowerCase()
    let system = 'General'
    if (/shader|texture|material|shading/.test(lower)) system = 'Shader Nodes'
    else if (/geometry|instanc|distribut|primitiv|transform|mesh|curve|point/.test(lower)) system = 'Geometry Nodes'
    else if (/composit/.test(lower)) system = 'Compositing Nodes'
    if (!systemMap[system]) systemMap[system] = []
    systemMap[system].push(cat)
  }
  return { systems: Object.entries(systemMap).map(([system, categories]) => ({ system, categories })) }
}

export function mergeNodes(existing, incoming) {
  const base = migrateNodesData(existing || { systems: [] })
  const out = { systems: base.systems.map(s => ({
    ...s, categories: (s.categories || []).map(c => ({ ...c, nodes: [...(c.nodes || [])] })),
  })) }
  for (const inCat of incoming || []) {
    const systemName = inCat.system || 'General'
    const catName = inCat.category || 'General'
    let sys = out.systems.find(s => normKey(s.system) === normKey(systemName))
    if (!sys) { sys = { system: systemName, categories: [] }; out.systems.push(sys) }
    let cat = sys.categories.find(c => normKey(c.category) === normKey(catName))
    if (!cat) { cat = { category: catName, nodes: [] }; sys.categories.push(cat) }
    for (const node of (inCat.nodes || [])) {
      const nm = (node.name || '').toLowerCase().trim()
      if (!cat.nodes.some(n => (n.name || '').toLowerCase().trim() === nm)) cat.nodes.push(node)
    }
  }
  return out
}

/** Corrections merge by id: update in place, otherwise append. */
export function mergeCorrections(existing, incoming) {
  const out = { corrections: [...(existing?.corrections || [])] }
  for (const c of incoming || []) {
    const idx = out.corrections.findIndex(e => e.id === c.id)
    if (idx >= 0) out.corrections[idx] = c
    else out.corrections.push(c)
  }
  return out
}

export const DOC_MERGERS = {
  hotkeys: mergeHotkeys,
  functions: mergeFunctions,
  nodes: mergeNodes,
  corrections: mergeCorrections,
}

/** slugify, matching electron/main.cjs so local and cloud agree on ids. */
export function slugify(name) {
  return (name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
