// =============================================================================
// otterRoutes.test.js — Session 10
//
// The route parser is the seam every O.T.T.E.R. read and write passes through
// in cloud mode, so a mis-parse is a silent data-loss bug. These cover the
// ordering hazards (literal sub-routes vs :sub), the URL shapes the call sites
// actually build, and the merge semantics copied out of electron/main.cjs.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  parseOtterRoute, slugify, migrateNodesData,
  mergeHotkeys, mergeFunctions, mergeNodes, mergeCorrections,
  readBody, okBody, needBody, otterCall,
} from './otterRoutes.js'
import { shareCall } from '../components/otterSharing.js'

const p = (path, method) => parseOtterRoute(path, method)

describe('parseOtterRoute — course routes', () => {
  it('lists and creates courses', () => {
    expect(p('/api/software', 'GET')).toEqual({ op: 'course.list' })
    expect(p('/api/software', 'POST')).toEqual({ op: 'course.create' })
  })

  it('gets and deletes a single course', () => {
    expect(p('/api/software/blender', 'GET')).toEqual({ op: 'course.get', slug: 'blender' })
    expect(p('/api/software/blender', 'DELETE')).toEqual({ op: 'course.delete', slug: 'blender' })
  })

  it('accepts a UUID as the slug (cloud mode uses course ids as opaque keys)', () => {
    const id = '0c000001-0000-0000-0000-000000000001'
    expect(p(`/api/software/${id}`, 'GET')).toEqual({ op: 'course.get', slug: id })
  })
})

describe('parseOtterRoute — subject routes', () => {
  it('lists and saves subjects', () => {
    expect(p('/api/software/blender/subjects', 'GET')).toEqual({ op: 'subject.list', slug: 'blender' })
    expect(p('/api/software/blender/subjects', 'POST')).toEqual({ op: 'subject.save', slug: 'blender' })
  })

  it('gets and deletes an individual subject', () => {
    expect(p('/api/software/blender/subjects/intro', 'GET'))
      .toEqual({ op: 'subject.get', slug: 'blender', sub: 'intro' })
    expect(p('/api/software/blender/subjects/intro', 'DELETE'))
      .toEqual({ op: 'subject.delete', slug: 'blender', sub: 'intro' })
  })

  // The ordering hazard: these are literal paths, not subject slugs.
  it('does not mistake renumber/reorder for a subject slug', () => {
    expect(p('/api/software/blender/subjects/renumber', 'POST'))
      .toEqual({ op: 'subject.renumber', slug: 'blender' })
    expect(p('/api/software/blender/subjects/reorder', 'POST'))
      .toEqual({ op: 'subject.reorder', slug: 'blender' })
  })

  // Validator.jsx:494 PUTs here (the citation read :441 until S30 re-measured
  // it). Cloud has always treated it as the intended save; Express had no PUT
  // route until S30, so applying a validator fix silently 404'd there — and
  // the call site did not check res.ok, so it reported success anyway.
  // validatorSave.test.js guards both halves.
  it('maps the Validator PUT onto a subject save', () => {
    expect(p('/api/software/blender/subjects/intro', 'PUT'))
      .toEqual({ op: 'subject.save', slug: 'blender', sub: 'intro' })
  })
})

describe('parseOtterRoute — per-course documents', () => {
  it.each(['hotkeys', 'functions', 'nodes', 'references', 'corrections'])(
    'reads %s', (doc) => {
      expect(p(`/api/software/blender/${doc}`, 'GET')).toEqual({ op: 'doc.get', slug: 'blender', doc })
    })

  it.each(['hotkeys', 'functions', 'nodes', 'corrections'])('merges %s', (doc) => {
    expect(p(`/api/software/blender/${doc}/merge`, 'POST'))
      .toEqual({ op: 'doc.merge', slug: 'blender', doc })
  })

  it('treats a plain POST to references as a whole-document write', () => {
    expect(p('/api/software/blender/references', 'POST'))
      .toEqual({ op: 'doc.put', slug: 'blender', doc: 'references' })
  })

  // The agent saves ONE correction at a time; Express merged by id. Routing
  // this to doc.put would erase the whole correction memory on every save.
  it('routes a plain POST to corrections through the MERGE path, not overwrite', () => {
    expect(p('/api/software/blender/corrections', 'POST'))
      .toEqual({ op: 'doc.merge', slug: 'blender', doc: 'corrections' })
  })
})

describe('parseOtterRoute — per-user state', () => {
  it('routes progress separately from course documents', () => {
    expect(p('/api/software/blender/progress', 'GET')).toEqual({ op: 'progress.get', slug: 'blender' })
    expect(p('/api/software/blender/progress', 'POST')).toEqual({ op: 'progress.put', slug: 'blender' })
  })

  // Session 30 (migration 0045). Quiz history is ONE personal history spanning
  // courses, so it cannot live under /api/software/:slug at all — a quiz built
  // from Blender AND Unity has no single course to be filed under.
  it('routes quiz history under /api/otter, not per course', () => {
    expect(p('/api/otter/quiz-history', 'GET')).toEqual({ op: 'quiz.list' })
    expect(p('/api/otter/quiz-history', 'POST')).toEqual({ op: 'quiz.add' })
  })

  // 🚨 The one route under /api/otter that is NOT cloudOnly. Express serves it
  // on Local Server too, so marking it cloudOnly would make otterFetch answer
  // 501 in the desktop app — where all of Audrey's courses actually are.
  it('quiz history is NOT cloudOnly — both backends serve it', () => {
    expect(p('/api/otter/quiz-history', 'GET').cloudOnly).toBeUndefined()
    expect(p('/api/otter/quiz-history', 'POST').cloudOnly).toBeUndefined()
  })

  // The retired per-course path must resolve to NOTHING, so a stale caller
  // falls through and fails loudly rather than filing a multi-course score
  // under one arbitrary course.
  it('the old per-course quiz-history route is gone', () => {
    expect(p('/api/software/blender/quiz-history', 'GET')).toBeNull()
    expect(p('/api/software/blender/quiz-history', 'POST')).toBeNull()
  })
})

// Session 11. These live under /api/otter/ precisely so they can never be
// confused with /api/software/:slug — see the comment in the parser.
describe('parseOtterRoute — Session 11 cloud-only surfaces', () => {
  const id = '0c000001-0000-0000-0000-000000000001'

  it('routes the trash listing and restore', () => {
    expect(p('/api/otter/trash', 'GET')).toEqual({ op: 'trash.list', cloudOnly: true })
    expect(p('/api/otter/trash/restore', 'POST'))
      .toEqual({ op: 'trash.restore', cloudOnly: true })
  })

  it('routes forking', () => {
    expect(p(`/api/otter/courses/${id}/fork`, 'POST'))
      .toEqual({ op: 'course.fork', slug: id, cloudOnly: true })
  })

  it('routes editor grants including the per-user revoke', () => {
    expect(p(`/api/otter/courses/${id}/editors`, 'GET'))
      .toEqual({ op: 'editors.list', slug: id, cloudOnly: true })
    expect(p(`/api/otter/courses/${id}/editors`, 'POST'))
      .toEqual({ op: 'editors.add', slug: id, cloudOnly: true })
    expect(p(`/api/otter/courses/${id}/editors/user-1`, 'DELETE'))
      .toEqual({ op: 'editors.remove', slug: id, userId: 'user-1', cloudOnly: true })
  })

  it('routes change requests', () => {
    expect(p('/api/otter/change-requests', 'GET')).toEqual({ op: 'cr.list', cloudOnly: true })
    expect(p('/api/otter/change-requests', 'POST')).toEqual({ op: 'cr.create', cloudOnly: true })
    expect(p('/api/otter/change-requests/cr-1', 'PATCH'))
      .toEqual({ op: 'cr.update', id: 'cr-1', cloudOnly: true })
    // Session 13: approve is its own POST — it applies, it is not a status PATCH.
    expect(p('/api/otter/change-requests/cr-1/approve', 'POST'))
      .toEqual({ op: 'cr.approve', id: 'cr-1', cloudOnly: true })
  })

  // Phase 5 / 0064 — company-standard nominations.
  it('routes nominations', () => {
    expect(p('/api/otter/nominations', 'GET'))
      .toEqual({ op: 'nomination.list', cloudOnly: true })
    expect(p('/api/otter/nominations', 'POST'))
      .toEqual({ op: 'nomination.create', cloudOnly: true })
    expect(p('/api/otter/nominations/nom-1', 'PATCH'))
      .toEqual({ op: 'nomination.update', id: 'nom-1', cloudOnly: true })
    // Approve PROMOTES — it demotes the incumbent standard and raises this
    // course in one transaction. A bare status PATCH is refused by the trigger.
    expect(p('/api/otter/nominations/nom-1/approve', 'POST'))
      .toEqual({ op: 'nomination.approve', id: 'nom-1', cloudOnly: true })
  })

  it('refuses nomination verbs that do not exist', () => {
    // 🚨 cloudOnly is what makes otterFetch answer 501 instead of falling
    // through to the local Express server — where an unmatched GET under /api/
    // hits the SPA catch-all and returns 200 with index.html, i.e. an empty
    // nomination list that reads as a success.
    expect(p('/api/otter/nominations', 'DELETE')).toBeNull()
    expect(p('/api/otter/nominations/nom-1', 'DELETE')).toBeNull()
    expect(p('/api/otter/nominations/nom-1/approve', 'PATCH')).toBeNull()
    expect(p('/api/otter/nominations/nom-1/reject', 'POST')).toBeNull()
    expect(p('/api/otter/change-requests/cr-1/approve', 'PATCH')).toBeNull()
  })

  it('marks every Session 11 surface cloudOnly so local mode 501s instead of falling through to Express', () => {
    const paths = [
      ['/api/otter/trash', 'GET'],
      ['/api/otter/trash/restore', 'POST'],
      [`/api/otter/courses/${id}/fork`, 'POST'],
      [`/api/otter/courses/${id}/editors`, 'GET'],
      [`/api/otter/courses/${id}/editors`, 'POST'],
      [`/api/otter/courses/${id}/editors/u`, 'DELETE'],
      ['/api/otter/change-requests', 'GET'],
      ['/api/otter/change-requests', 'POST'],
      ['/api/otter/change-requests/x', 'PATCH'],
      ['/api/otter/change-requests/x/approve', 'POST'],
    ]
    for (const [path, verb] of paths) expect(p(path, verb).cloudOnly).toBe(true)
  })

  // A course legitimately named "Trash" produces slug "trash" in LOCAL mode.
  // Keeping the new surfaces off /api/software means that stays unambiguous.
  it('does not let a course slug collide with the new surfaces', () => {
    expect(p('/api/software/trash', 'GET')).toEqual({ op: 'course.get', slug: 'trash' })
    expect(p('/api/software/change-requests', 'GET'))
      .toEqual({ op: 'course.get', slug: 'change-requests' })
  })

  it('rejects unsupported verbs and shapes under /api/otter', () => {
    expect(p('/api/otter/trash', 'DELETE')).toBeNull()
    expect(p('/api/otter/change-requests/cr-1', 'DELETE')).toBeNull()
    expect(p(`/api/otter/courses/${id}`, 'GET')).toBeNull()
    expect(p('/api/otter/nonsense', 'GET')).toBeNull()
    expect(p('/api/otter', 'GET')).toBeNull()
  })
})

// B1 / migration 0100 — subject shares (design §5.1). Seven operations, all
// cloudOnly: a share is a row about two people in a workspace.
describe('parseOtterRoute — subject shares (0100)', () => {
  const sh = '0e000100-0000-0000-0000-000000000001'
  const subjectId = '05000100-0000-0000-0000-000000000001'

  it('routes the index and the single share', () => {
    expect(p('/api/otter/subject-shares', 'GET')).toEqual({ op: 'share.list', cloudOnly: true })
    expect(p('/api/otter/subject-shares', 'POST')).toEqual({ op: 'share.create', cloudOnly: true })
  })

  // The ordering hazard: `course` is a literal route, not a share id, and it
  // is matched BEFORE /:id/… (as /subjects/renumber is before /subjects/:sub).
  it('matches /subject-shares/course before /subject-shares/:id/…', () => {
    expect(p('/api/otter/subject-shares/course', 'POST'))
      .toEqual({ op: 'share.createCourse', cloudOnly: true })
    expect(p('/api/otter/subject-shares/course', 'GET')).toBeNull()
    expect(p('/api/otter/subject-shares/course/accept', 'POST')).toBeNull()
  })

  it('routes accept, decline and revoke by share id', () => {
    expect(p(`/api/otter/subject-shares/${sh}/accept`, 'POST'))
      .toEqual({ op: 'share.accept', id: sh, cloudOnly: true })
    expect(p(`/api/otter/subject-shares/${sh}/decline`, 'POST'))
      .toEqual({ op: 'share.decline', id: sh, cloudOnly: true })
    expect(p(`/api/otter/subject-shares/${sh}/revoke`, 'POST'))
      .toEqual({ op: 'share.revoke', id: sh, cloudOnly: true })
  })

  it('refuses share verbs and shapes that do not exist', () => {
    expect(p('/api/otter/subject-shares', 'DELETE')).toBeNull()
    expect(p('/api/otter/subject-shares', 'PATCH')).toBeNull()
    expect(p(`/api/otter/subject-shares/${sh}`, 'POST')).toBeNull()
    expect(p(`/api/otter/subject-shares/${sh}`, 'GET')).toBeNull()
    expect(p(`/api/otter/subject-shares/${sh}/accept`, 'GET')).toBeNull()
    expect(p(`/api/otter/subject-shares/${sh}/approve`, 'POST')).toBeNull()
    expect(p(`/api/otter/subject-shares/${sh}/accept/x`, 'POST')).toBeNull()
  })

  // One subject by its ROW id lives under /api/otter, where it cannot collide
  // with /api/software/:slug/subjects/:sub (by course and slug): the two
  // prefixes differ, so neither parse can swallow the other.
  it('reads one subject by id under /api/otter, apart from /api/software/:slug/subjects/:sub', () => {
    expect(p(`/api/otter/subjects/${subjectId}`, 'GET'))
      .toEqual({ op: 'subject.getById', id: subjectId, cloudOnly: true })
    expect(p('/api/software/blender/subjects/intro', 'GET'))
      .toEqual({ op: 'subject.get', slug: 'blender', sub: 'intro' })
    expect(p(`/api/software/${subjectId}/subjects`, 'GET'))
      .toEqual({ op: 'subject.list', slug: subjectId })
    expect(p('/api/otter/subjects', 'GET')).toBeNull()
    expect(p(`/api/otter/subjects/${subjectId}`, 'POST')).toBeNull()
    expect(p(`/api/otter/subjects/${subjectId}`, 'DELETE')).toBeNull()
    expect(p(`/api/otter/subjects/${subjectId}/x`, 'GET')).toBeNull()
  })

  it('marks every share route cloudOnly so local mode 501s instead of falling through to Express', () => {
    const paths = [
      ['/api/otter/subject-shares', 'GET'],
      ['/api/otter/subject-shares', 'POST'],
      ['/api/otter/subject-shares/course', 'POST'],
      [`/api/otter/subject-shares/${sh}/accept`, 'POST'],
      [`/api/otter/subject-shares/${sh}/decline`, 'POST'],
      [`/api/otter/subject-shares/${sh}/revoke`, 'POST'],
      [`/api/otter/subjects/${subjectId}`, 'GET'],
    ]
    for (const [path, verb] of paths) expect(p(path, verb).cloudOnly, path).toBe(true)
  })
})

describe('parseOtterRoute — non-routes and tolerance', () => {
  it('returns null for anything that is not an O.T.T.E.R. route', () => {
    expect(p('/api/rabbit/projects', 'GET')).toBeNull()
    expect(p('/api/otter-settings', 'GET')).toBeNull()
    expect(p('/api/pet', 'GET')).toBeNull()
    expect(p('/index.html', 'GET')).toBeNull()
    expect(p(undefined, 'GET')).toBeNull()
  })

  it('returns null for verbs a route does not support', () => {
    expect(p('/api/software/blender/subjects', 'DELETE')).toBeNull()
    expect(p('/api/software', 'PATCH')).toBeNull()
  })

  it('tolerates absolute URLs, query strings and encoded slugs', () => {
    expect(p('http://127.0.0.1:53210/api/software/blender/subjects', 'GET'))
      .toEqual({ op: 'subject.list', slug: 'blender' })
    expect(p('/api/software/blender?x=1', 'GET')).toEqual({ op: 'course.get', slug: 'blender' })
    expect(p('/api/software/my%20course', 'GET')).toEqual({ op: 'course.get', slug: 'my course' })
  })

  it('routes export-all', () => {
    expect(p('/api/export-all', 'GET')).toEqual({ op: 'export.all' })
  })
})

describe('slugify matches the Express implementation', () => {
  it.each([
    ['Blender 5.0', 'blender-5-0'],
    ['  Trailing  ', 'trailing'],
    ['C++ Basics', 'c-basics'],
  ])('%s -> %s', (input, expected) => {
    expect(slugify(input)).toBe(expected)
  })
})

describe('merge semantics', () => {
  it('merges hotkeys by category then action, tolerating name/hotkeys aliases', () => {
    const existing = { categories: [{ category: 'General', shortcuts: [{ action: 'Save' }] }] }
    const out = mergeHotkeys(existing, [
      { name: 'general', hotkeys: [{ action: 'save' }, { action: 'Open' }] },
    ])
    expect(out.categories).toHaveLength(1)
    expect(out.categories[0].shortcuts.map(s => s.action)).toEqual(['Save', 'Open'])
  })

  it('does not mutate the existing hotkeys document', () => {
    const existing = { categories: [{ category: 'General', shortcuts: [{ action: 'Save' }] }] }
    mergeHotkeys(existing, [{ category: 'General', shortcuts: [{ action: 'Open' }] }])
    expect(existing.categories[0].shortcuts).toHaveLength(1)
  })

  it('merges functions by category name then function name', () => {
    const out = mergeFunctions(
      { categories: [{ name: 'Math', functions: [{ name: 'abs' }] }] },
      [{ name: 'Math', functions: [{ name: 'abs' }, { name: 'ceil' }] }],
    )
    expect(out.categories[0].functions.map(f => f.name)).toEqual(['abs', 'ceil'])
  })

  it('upgrades legacy node documents to the systems shape', () => {
    const out = migrateNodesData({ categories: [{ category: 'Shader Basics', nodes: [] }] })
    expect(out.systems[0].system).toBe('Shader Nodes')
  })

  it('merges nodes into system > category > node', () => {
    const out = mergeNodes({ systems: [] }, [
      { system: 'Geometry Nodes', category: 'Mesh', nodes: [{ name: 'Cube' }] },
      { system: 'geometry nodes', category: 'mesh', nodes: [{ name: 'cube' }, { name: 'Sphere' }] },
    ])
    expect(out.systems).toHaveLength(1)
    expect(out.systems[0].categories[0].nodes.map(n => n.name)).toEqual(['Cube', 'Sphere'])
  })

  it('merges corrections by id, updating in place', () => {
    const out = mergeCorrections(
      { corrections: [{ id: 'a', text: 'old' }] },
      [{ id: 'a', text: 'new' }, { id: 'b', text: 'added' }],
    )
    expect(out.corrections).toEqual([{ id: 'a', text: 'new' }, { id: 'b', text: 'added' }])
  })
})

// ── The one response reader (F6, B5) ─────────────────────────────────────────
//
// `otterFetch` resolves for every status and `res.json()` throws on any body
// that is not JSON, so these four are the only ways an O.T.T.E.R. answer is
// read. The table drives each shape with the answers that broke the old reads:
// a JSON refusal (which `res.json()` without `res.ok` handed on as data) and
// an HTML error page (which `res.json()` turned into a SyntaxError).
describe('the one response reader (F6, B5)', () => {
  const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
  const raw = (status, text) => new Response(text, { status })
  const HTML = '<!DOCTYPE html><html><body>Cannot POST /api/otter/x</body></html>'

  it('readBody: JSON, or null for empty, HTML, "null" and a missing body reader; never throws', async () => {
    expect(await readBody(json(200, { slug: 'c-1' }))).toEqual({ slug: 'c-1' })
    expect(await readBody(json(409, { error: 'Already shared.' }))).toEqual({ error: 'Already shared.' })
    expect(await readBody(raw(200, ''))).toBeNull()
    expect(await readBody(raw(404, HTML))).toBeNull()
    expect(await readBody(raw(200, 'null'))).toBeNull()
    expect(await readBody({ ok: true, json: async () => ({}) })).toBeNull()
    expect(await readBody(undefined)).toBeNull()
  })

  it('okBody: the body of a success only', async () => {
    expect(await okBody(json(200, [{ slug: 's' }]))).toEqual([{ slug: 's' }])
    expect(await okBody(json(403, { error: 'No.' }))).toBeNull()
    expect(await okBody(raw(500, HTML))).toBeNull()
    expect(await okBody(raw(200, HTML))).toBeNull()
  })

  it('needBody: the body of a success, else a rejection in the refusal\'s own words', async () => {
    expect(await needBody(json(200, { title: 'Modifiers' }))).toEqual({ title: 'Modifiers' })
    await expect(needBody(json(404, { error: 'That subject is gone.' }))).rejects.toThrow('That subject is gone.')
    await expect(needBody(raw(404, HTML))).rejects.toThrow('That could not be read (HTTP 404).')
    await expect(needBody(raw(200, ''))).rejects.toThrow('That could not be read (HTTP 200).')
  })

  it("otterCall: shareCall's shape for every outcome, an abort rethrown", async () => {
    const via = (res) => async () => res
    expect(await otterCall(via(json(200, { ok: 1 })), '/u')).toEqual({ ok: true, status: 200, data: { ok: 1 }, text: null })
    expect(await otterCall(via(json(409, { error: 'Already shared.' })), '/u'))
      .toEqual({ ok: false, status: 409, data: { error: 'Already shared.' }, text: 'Already shared.' })
    expect(await otterCall(via(raw(500, HTML)), '/u')).toEqual({ ok: false, status: 500, data: null, text: null })
    expect(await otterCall(async () => { throw new TypeError('Failed to fetch') }, '/u'))
      .toEqual({ ok: false, status: 0, data: null, text: 'Failed to fetch' })
    const abort = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })
    await expect(otterCall(async () => { throw abort }, '/u')).rejects.toBe(abort)
  })

  it('shareCall still never rejects: an abort reads as a share that did not reach the workspace (review round 1)', async () => {
    const abort = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })
    const out = await shareCall(async () => { throw abort }, '/u')
    expect(out).toMatchObject({ ok: false, status: 0, data: null })
    expect(out.text).toMatch(/did not reach the workspace/)
  })
})

describe('no file that reads O.T.T.E.R.\'s answers calls .json() (F6, B5)', () => {
  // The files B5 counted (82 reads), the Validator's included. petKnowledge.js
  // keeps its own readJson (status first, then json(); its suite's fakes have
  // no text()) and is the one recorded exception, so it is not listed.
  const FILES = [
    '../Otter.jsx', '../Validator.jsx',
    '../components/RequestsView.jsx', '../components/ChangeRequestDialog.jsx',
    '../components/ShareCourseDialog.jsx', '../components/otterSharing.js',
    '../../../components/AdminTerminal/ChangeRequestsSection.jsx',
  ]
  const code = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')

  it('the instrument works: it counts a planted read', () => {
    expect((code('const a = await res.json()\n// res.json() in a comment\n/* res.json() */').match(/\.json\(\)/g) ?? []).length).toBe(1)
  })

  it.each(FILES)('%s reads through the one reader', (rel) => {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    expect(src.length).toBeGreaterThan(500)
    expect(code(src).match(/\.json\(\)/g) ?? [], 'use readBody(res), okBody or needBody from adapters/otterRoutes.js').toEqual([])
  })
})
