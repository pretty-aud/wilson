// =============================================================================
// otterRoutes.test.js — Session 10
//
// The route parser is the seam every O.T.T.E.R. read and write passes through
// in cloud mode, so a mis-parse is a silent data-loss bug. These cover the
// ordering hazards (literal sub-routes vs :sub), the URL shapes the call sites
// actually build, and the merge semantics copied out of electron/main.cjs.
// =============================================================================

import { describe, it, expect } from 'vitest'
import {
  parseOtterRoute, slugify, migrateNodesData,
  mergeHotkeys, mergeFunctions, mergeNodes, mergeCorrections,
} from './otterRoutes.js'

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
