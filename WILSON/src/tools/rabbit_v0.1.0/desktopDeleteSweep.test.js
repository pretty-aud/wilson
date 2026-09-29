// =============================================================================
// desktopDeleteSweep.test.js — Track A bundle A2 (2026-09-06), ruling 8.
//
// A ROUTE REPLAY, not a source guard. The generic sub-entity route factory is
// lifted out of electron/main.cjs by brace matching (folderParity.test.js's
// technique), rebuilt with an in-memory bundle in place of the disk, and its
// DELETE handlers are called the way Express would call them. Everything the
// factory calls that is not the disk or Express is lifted from main.cjs too
// (rabbitTouch, rabbitUpsertInto, rabbitRemoveFrom, sweepDependencyEdges), so
// the replay runs the real helpers and not restatements of them.
//
// What it pins. Deleting a task or a phase on the desktop used to splice only
// its own collection, so every dependency edge naming the deleted row stayed
// in project.json and was re-mirrored into {Slug}_DATABASES/tasks.json and
// timeline.json on every write (docs/OUTSTANDING.md, "Deleting a task or a
// phase leaves orphaned dependency rows on the desktop"). RabbitProvider
// pruned its own copy, which hid the orphans for the session and brought them
// back on reload. The sweep now happens in the same write that removes the
// entity, so the mirrors — which are written FROM that bundle — never see the
// orphans again.
//
// The FAILING CONTROL: deleting a task that has NO edges must leave the edge
// array identical. A sweep written as `bundle.dependencies = []`, or one that
// filtered on the wrong field, passes the positive case and fails here.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const MAIN_CJS = readFileSync(new URL('../../../electron/main.cjs', import.meta.url), 'utf-8')

/** Lift `function name(...) { ... }` out of the source by brace matching. */
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`main.cjs no longer defines ${name}() — the replay cannot run`)
  // Skip the parameter list by paren matching FIRST: a default such as
  // `opts = {}` or a destructured parameter would otherwise be taken for the
  // body's opening brace and the extract would be garbage (measured — the
  // first version of this file did exactly that).
  let pd = 0
  let i = source.indexOf('(', start)
  for (; i < source.length; i++) {
    if (source[i] === '(') pd++
    else if (source[i] === ')') { pd--; if (pd === 0) break }
  }
  const open = source.indexOf('{', i)
  let depth = 0
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++
    else if (source[j] === '}') {
      depth--
      if (depth === 0) return source.slice(start, j + 1)
    }
  }
  throw new Error(`unbalanced braces extracting ${name}() from main.cjs`)
}

function fixture() {
  return {
    project: { id: 'p1', title: 'Fixture', updated_at: null },
    phases: [{ id: 'ph-p', name: 'Pre' }, { id: 'ph-q', name: 'Prod' }],
    assets: [{ id: 'as-1', name: 'Hero' }],
    tasks: [{ id: 't-a' }, { id: 't-b' }, { id: 't-c' }, { id: 't-lonely' }],
    dependencies: [
      { id: 'd1', kind: 'task',  predecessor_id: 't-a',  successor_id: 't-b' },
      { id: 'd2', kind: 'task',  predecessor_id: 't-b',  successor_id: 't-c' },
      { id: 'd3', kind: 'task',  predecessor_id: 't-a',  successor_id: 't-c' },
      { id: 'd4', kind: 'phase', predecessor_id: 'ph-p', successor_id: 'ph-q' },
      { id: 'd5',                predecessor_id: 't-c',  successor_id: 't-a' }, // legacy row: no kind
    ],
    taskLinks: [{ id: 'l1', task_id: 't-b', url: 'https://example.invalid' }],
    comments:  [{ id: 'c1', task_id: 't-b', body: 'note' }],
  }
}

/**
 * Rebuild rabbitSubentityRoutes over an in-memory bundle. Returns the route
 * table, the writes the disk would have received, and the factory itself so
 * a test can register whichever entities it needs.
 */
function harness(bundle) {
  const routes = new Map()
  const writes = []
  const expressApp = {
    post:   (pattern, h) => routes.set(`POST ${pattern}`, h),
    patch:  (pattern, h) => routes.set(`PATCH ${pattern}`, h),
    delete: (pattern, h) => routes.set(`DELETE ${pattern}`, h),
  }
  const readRabbitBundle  = () => bundle
  const writeRabbitBundle = (_projectId, b) => { writes.push(structuredClone(b)) }
  const rabbitNotFound    = (res, what = 'project') => res.status(404).json({ error: `${what} not found` })
  const ensureEntityFolderRow = () => {}
  const materializeFolderDirs = () => {}
  const uuidv4 = () => `uuid-${writes.length + 1}`
  // eslint-disable-next-line no-new-func
  const register = new Function(
    'expressApp', 'readRabbitBundle', 'writeRabbitBundle', 'rabbitNotFound',
    'ensureEntityFolderRow', 'materializeFolderDirs', 'uuidv4',
    `${extractFunction(MAIN_CJS, 'rabbitTouch')}
     ${extractFunction(MAIN_CJS, 'rabbitUpsertInto')}
     ${extractFunction(MAIN_CJS, 'rabbitRemoveFrom')}
     ${extractFunction(MAIN_CJS, 'sweepDependencyEdges')}
     ${extractFunction(MAIN_CJS, 'rabbitSubentityRoutes')}
     return rabbitSubentityRoutes;`,
  )(expressApp, readRabbitBundle, writeRabbitBundle, rabbitNotFound, ensureEntityFolderRow, materializeFolderDirs, uuidv4)
  return { routes, writes, register }
}

function call(routes, verb, pattern, params, body = {}) {
  const handler = routes.get(`${verb} ${pattern}`)
  if (!handler) throw new Error(`no route registered for ${verb} ${pattern}`)
  const res = {
    code: 200, body: null,
    status(c) { this.code = c; return this },
    json(b) { this.body = b; return this },
  }
  handler({ params, body }, res)
  return res
}

const DEL_TASK  = '/api/rabbit/projects/:projectId/tasks/:id'
const DEL_PHASE = '/api/rabbit/projects/:projectId/phases/:id'
const ids = rows => rows.map(r => r.id)

/** Register tasks and phases exactly as main.cjs does (with the sweep). */
function registerLikeMain(h) {
  h.register('phases', 'phases', null, { sweepDependencies: true })
  h.register('tasks',  'tasks',  null, { sweepDependencies: true })
  h.register('comments', 'comments')
}

describe('deleting a task on the desktop sweeps its dependency edges in the same write', () => {
  it('removes every edge whose predecessor or successor is the deleted task, and nothing else', () => {
    const bundle = fixture()
    const before = structuredClone(bundle)
    const h = harness(bundle)
    registerLikeMain(h)

    const res = call(h.routes, 'DELETE', DEL_TASK, { projectId: 'p1', id: 't-b' })

    expect(res.code).toBe(200)
    expect(res.body).toEqual({ ok: true, swept: 2 })
    expect(ids(bundle.tasks)).toEqual(['t-a', 't-c', 't-lonely'])
    expect(ids(bundle.dependencies)).toEqual(['d3', 'd4', 'd5'])
    // Nothing else moved.
    expect(bundle.phases).toEqual(before.phases)
    expect(bundle.assets).toEqual(before.assets)
    expect(bundle.taskLinks).toEqual(before.taskLinks)
    expect(bundle.comments).toEqual(before.comments)
    // The disk write — and therefore the _DATABASES mirrors, which are
    // rendered from this very bundle — carries the swept array.
    expect(h.writes).toHaveLength(1)
    expect(ids(h.writes[0].dependencies)).toEqual(['d3', 'd4', 'd5'])
    expect(ids(h.writes[0].tasks)).toEqual(['t-a', 't-c', 't-lonely'])
  })

  it('FAILING CONTROL: deleting a task with no edges leaves the edge array identical', () => {
    const bundle = fixture()
    const before = structuredClone(bundle)
    const h = harness(bundle)
    registerLikeMain(h)

    const res = call(h.routes, 'DELETE', DEL_TASK, { projectId: 'p1', id: 't-lonely' })

    expect(res.body).toEqual({ ok: true, swept: 0 })
    expect(bundle.dependencies).toEqual(before.dependencies)
    expect(ids(bundle.tasks)).toEqual(['t-a', 't-b', 't-c'])
    expect(bundle.phases).toEqual(before.phases)
    expect(bundle.assets).toEqual(before.assets)
    expect(bundle.taskLinks).toEqual(before.taskLinks)
    expect(bundle.comments).toEqual(before.comments)
    expect(h.writes[0].dependencies).toEqual(before.dependencies)
  })

  it('sweeps a legacy edge that has no kind field', () => {
    const bundle = fixture()
    const h = harness(bundle)
    registerLikeMain(h)
    call(h.routes, 'DELETE', DEL_TASK, { projectId: 'p1', id: 't-a' })
    expect(ids(bundle.dependencies)).toEqual(['d2', 'd4'])
  })

  it('answers 404 and writes nothing for a task that does not exist', () => {
    const bundle = fixture()
    const before = structuredClone(bundle)
    const h = harness(bundle)
    registerLikeMain(h)
    const res = call(h.routes, 'DELETE', DEL_TASK, { projectId: 'p1', id: 'nope' })
    expect(res.code).toBe(404)
    expect(bundle).toEqual(before)
    expect(h.writes).toHaveLength(0)
  })
})

describe('deleting a phase on the desktop sweeps its phase edges and leaves task edges alone', () => {
  it('removes only the edges that name the phase', () => {
    const bundle = fixture()
    const h = harness(bundle)
    registerLikeMain(h)
    const res = call(h.routes, 'DELETE', DEL_PHASE, { projectId: 'p1', id: 'ph-q' })
    expect(res.body).toEqual({ ok: true, swept: 1 })
    expect(ids(bundle.phases)).toEqual(['ph-p'])
    expect(ids(bundle.dependencies)).toEqual(['d1', 'd2', 'd3', 'd5'])
    expect(ids(bundle.tasks)).toEqual(['t-a', 't-b', 't-c', 't-lonely'])
  })
})

describe('the sweep is opt-in per entity, and main.cjs opts tasks and phases in', () => {
  it('an entity registered without the option does not sweep', () => {
    const bundle = fixture()
    const before = structuredClone(bundle)
    const h = harness(bundle)
    h.register('tasks', 'tasks') // the pre-A2 registration
    const res = call(h.routes, 'DELETE', DEL_TASK, { projectId: 'p1', id: 't-b' })
    expect(res.body).toEqual({ ok: true, swept: 0 })
    expect(bundle.dependencies).toEqual(before.dependencies) // the orphans the entry described
  })

  it('main.cjs registers tasks and phases with sweepDependencies: true', () => {
    // The replay above registers routes itself, so it would stay green if
    // main.cjs forgot the option. This is the assertion that it has not.
    expect(MAIN_CJS).toMatch(/rabbitSubentityRoutes\(\s*'tasks',\s*'tasks',\s*null,\s*\{\s*sweepDependencies:\s*true\s*\}\s*\)/)
    expect(MAIN_CJS).toMatch(/rabbitSubentityRoutes\(\s*'phases',\s*'phases',\s*null,\s*\{\s*sweepDependencies:\s*true\s*\}\s*\)/)
  })

  it('assets keep their own DELETE route and are never a dependency endpoint', () => {
    // task_dependencies and phase_dependencies reference tasks and phases;
    // an asset id can appear in neither, so the custom asset route (folder
    // trash + managed-file soft delete) needs no sweep. Pinned so a future
    // refactor that folds assets into the generic factory notices.
    expect(MAIN_CJS).toMatch(/expressApp\.delete\('\/api\/rabbit\/projects\/:projectId\/assets\/:id'/)
  })
})
