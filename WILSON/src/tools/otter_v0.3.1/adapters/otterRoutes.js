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
  // Almost every one of these is cloudOnly: sharing, editor grants, trash and
  // change requests are meaningless without a workspace, and the Express
  // server in electron/main.cjs has no such routes. otterFetch answers 501 in
  // local mode rather than letting Express 404 into a call site that does not
  // check res.ok.
  //
  // ⚠️ `quiz-history` (S30) is the ONE exception and lives here for a
  // different reason: it is not course-scoped, so it cannot sit under
  // /api/software/:slug at all. Express serves it on both backends, so it is
  // deliberately NOT cloudOnly. This comment used to say "and never will";
  // that is now false and the exception is stated rather than left to be
  // discovered.
  if (parts[1] === 'otter') {
    const seg = parts.slice(2).map(decodeURIComponent)

    // /api/otter/quiz-history — ONE personal history, spanning courses.
    // Replaces /api/software/:slug/quiz-history, which was per-course and
    // whose writer had no caller on either backend (see 0045's header).
    if (seg.length === 1 && seg[0] === 'quiz-history') {
      if (verb === 'GET')  return { op: 'quiz.list' }
      if (verb === 'POST') return { op: 'quiz.add' }
      return null
    }

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

    // /api/otter/change-requests[/:id[/approve]]
    if (seg[0] === 'change-requests') {
      if (seg.length === 1) {
        if (verb === 'GET')  return { op: 'cr.list', cloudOnly: true }
        if (verb === 'POST') return { op: 'cr.create', cloudOnly: true }
        return null
      }
      if (seg.length === 2 && verb === 'PATCH') {
        return { op: 'cr.update', id: seg[1], cloudOnly: true }
      }
      // Session 13: approving is NOT a status PATCH — it calls otter_cr_apply,
      // which archives the target and applies the proposer's subjects
      // additively in one transaction. The server refuses a bare status flip.
      if (seg.length === 3 && seg[2] === 'approve' && verb === 'POST') {
        return { op: 'cr.approve', id: seg[1], cloudOnly: true }
      }
      return null
    }

    // /api/otter/nominations[/:id[/approve]]  (0064)
    // cloudOnly throughout: there is no local-server equivalent. The Express
    // server has no nominations table, and an unmatched GET under /api/ hits
    // the SPA catch-all and returns 200 with index.html — so without the guard
    // a signed-out `nomination.list` would read as an empty success.
    if (seg[0] === 'nominations') {
      if (seg.length === 1) {
        if (verb === 'GET')  return { op: 'nomination.list', cloudOnly: true }
        if (verb === 'POST') return { op: 'nomination.create', cloudOnly: true }
        return null
      }
      if (seg.length === 2 && verb === 'PATCH') {
        return { op: 'nomination.update', id: seg[1], cloudOnly: true }
      }
      // Approving is NOT a status PATCH — it calls otter_nomination_apply,
      // which demotes the incumbent standard and promotes this course in one
      // transaction. The trigger refuses a bare status flip, because the pin
      // trigger would silently revert the promotion and leave an "approved"
      // nomination whose course never moved.
      if (seg.length === 3 && seg[2] === 'approve' && verb === 'POST') {
        return { op: 'nomination.approve', id: seg[1], cloudOnly: true }
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
      // Validator.jsx:444 issues a PUT here (`method: 'PUT'` on :445 — the
      // citation read :441 for two sessions, which is one line past the guard
      // above the call; re-verify a line number before repeating it).
      //
      // Cloud has always treated this as the save it was clearly meant to be.
      // Session 30 closed the other half: Express had no PUT route, so against
      // Local Server every "apply fix" 404ed — and the call site did not check
      // res.ok, so it reported the fix APPLIED regardless. Both ends are real
      // now (electron/main.cjs, beside the subject GET).
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

  // NOTE: /api/software/:slug/quiz-history is deliberately GONE (S30). Quiz
  // history is no longer per-course — see /api/otter/quiz-history above. It
  // returns null here, so a stale caller falls through to the real network and
  // fails loudly rather than being answered by a route that files a
  // multi-course score under one arbitrary course.

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

// ── A4 / decision 37: the documents an APPROVAL carries ─────────────────────
//
// Until this bundle, approving a change request moved subjects and left the
// five per-course documents untouched (MASTER_PLAN §6 #29, and the approve
// dialog said so). Audrey's decision 37: move them too.
//
// 🚨 THE MERGERS ABOVE DO NOT TAKE A STORED DOCUMENT. They were written for the
// GENERATOR's output shape — `doc.merge` feeds them `body.categories` — and the
// stored shape is different for two of the four. Passing a stored document
// straight in is the silent-no-op this area specialises in: for `nodes` the
// stored form is `{systems:[…]}`, so `body.categories` is undefined and the
// merge would move NOTHING while reporting success. CR_DOC_MERGE is the
// adapter between the two shapes, and it exists so that fact is written down
// once rather than rediscovered.

/** Reference URLs merge by `url` — the same key the library's own add-a-URL
 *  path dedupes on (Otter.jsx: `referenceUrls.some(r => r.url === fullUrl)`).
 *  Additive, like every other merger here: a URL the proposer deleted from
 *  their fork stays on the standard. */
export function mergeReferenceUrls(existing, incoming) {
  const out = { urls: [...(existing?.urls || [])] }
  for (const r of incoming || []) {
    const key = (r?.url || '').trim()
    if (!key) continue
    if (!out.urls.some(e => (e?.url || '').trim() === key)) out.urls.push(r)
  }
  return out
}

/** A STORED nodes document, flattened into the `{system, category, nodes}`
 *  rows mergeNodes expects. migrateNodesData first, so a course still holding
 *  the pre-0.3 `{categories:[…]}` shape is upgraded rather than dropped. */
export function flattenNodesForMerge(stored) {
  const doc = migrateNodesData(stored || { systems: [] })
  const rows = []
  for (const sys of doc.systems || []) {
    for (const cat of sys.categories || []) {
      rows.push({ system: sys.system, category: cat.category, nodes: cat.nodes || [] })
    }
  }
  return rows
}

/**
 * Merge a fork's STORED document into the standard's STORED document.
 * Keyed by the COURSE_DOCS name, value takes (targetStored, forkStored).
 *
 * 🚨 `corrections` IS DELIBERATELY ABSENT, and this is the one judgement call
 * in decision 37. §6 #29 lists five documents, but `otter_fork_course` blanks
 * corrections when it makes a fork, with the reason in its own body: *"Corrections
 * are the original author's agent memory, not content."* A fork therefore never
 * inherits them, so anything in a proposer's corrections is memory they
 * accumulated privately — and pushing that onto the company standard on
 * approval would contradict the rule the fork states, in the direction that
 * leaks one person's agent history to everyone.
 *
 * Four documents move; corrections do not. If Audrey wants all five, adding
 * `corrections: (t, f) => mergeCorrections(t, f?.corrections ?? [])` here is
 * the whole change — the caller iterates this map.
 */
export const CR_DOC_MERGE = {
  hotkeys:    (target, fork) => mergeHotkeys(target, fork?.categories ?? []),
  functions:  (target, fork) => mergeFunctions(target, fork?.categories ?? []),
  nodes:      (target, fork) => mergeNodes(target, flattenNodesForMerge(fork)),
  references: (target, fork) => mergeReferenceUrls(target, fork?.urls ?? []),
}

/** slugify, matching electron/main.cjs so local and cloud agree on ids. */
export function slugify(name) {
  return (name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
