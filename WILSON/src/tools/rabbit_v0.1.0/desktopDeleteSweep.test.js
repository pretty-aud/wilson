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
import { createRequire } from 'node:module'

const MAIN_CJS = readFileSync(new URL('../../../electron/main.cjs', import.meta.url), 'utf-8')
// Post-overhaul S3a: rabbitSubentityRoutes now calls cascadeSceneOrShotDelete,
// which main.cjs requires from electron/rabbitShotLists.cjs. The REAL function
// is passed into the lifted factory, so the replay runs the shipped cascade
// and not a restatement of it.
const require = createRequire(import.meta.url)
const { cascadeSceneOrShotDelete } = require('../../../electron/rabbitShotLists.cjs')

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
    'ensureEntityFolderRow', 'materializeFolderDirs', 'uuidv4', 'cascadeSceneOrShotDelete',
    `${extractFunction(MAIN_CJS, 'rabbitTouch')}
     ${extractFunction(MAIN_CJS, 'rabbitUpsertInto')}
     ${extractFunction(MAIN_CJS, 'rabbitRemoveFrom')}
     ${extractFunction(MAIN_CJS, 'sweepDependencyEdges')}
     ${extractFunction(MAIN_CJS, 'rabbitSubentityRoutes')}
     return rabbitSubentityRoutes;`,
  )(expressApp, readRabbitBundle, writeRabbitBundle, rabbitNotFound, ensureEntityFolderRow, materializeFolderDirs, uuidv4, cascadeSceneOrShotDelete)
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


// ── Post-overhaul S3a, rule 8: a scene or shot delete leaves every shot list ─
//
// 0084's foreign keys do this in the cloud: shot_list_items' scene and shot
// FKs CASCADE, tasks' scene_id / shot_id FKs SET NULL. The desktop has no FKs,
// so the factory's DELETE runs cascadeSceneOrShotDelete in the same write when
// an entity is registered with `shotListLinks`. NOT swept, in either place:
// assets.scene_ids / shot_ids (arrays, not FKs) and edits' items (D17 —
// "Missing shot").
//
// Review R1 (addendum C): a SCENE delete also deletes the scene's SHOTS —
// 0040's shots.scene_id ON DELETE CASCADE, which the cloud always did and the
// desktop never did — and sweeps each. Before, ScenesView deleted "the
// scene's shots, then the scene" from ctx.shots, which since D10 holds only
// the ACTIVE list's shots; a shot only another list held survived with a
// dangling scene_id, its items and its tasks' shot_id. The fixture's L2 is
// ARCHIVED on purpose in those cases: the freeze (addendum B) is on
// membership writes, and a delete sweep must still reach it.

function s3aFixture() {
  return {
    project: { id: 'p1', title: 'Fixture', active_shot_list_id: 'L1' },
    scenes: [{ id: 'sc-1' }, { id: 'sc-2' }],
    shots: [{ id: 'sh-1', scene_id: 'sc-1' }, { id: 'sh-2', scene_id: 'sc-2' }],
    shotLists: [{ id: 'L1', title: 'Shot list 1', version: 1 }, { id: 'L2', title: 'Pickups', version: 1 }],
    shotListItems: [
      { id: 'i1', shot_list_id: 'L1', scene_id: 'sc-1', shot_id: null, position: 0 },
      { id: 'i2', shot_list_id: 'L1', scene_id: 'sc-2', shot_id: null, position: 1 },
      { id: 'i3', shot_list_id: 'L1', scene_id: null, shot_id: 'sh-1', position: 0 },
      { id: 'i4', shot_list_id: 'L1', scene_id: null, shot_id: 'sh-2', position: 0 },
      { id: 'i5', shot_list_id: 'L2', scene_id: 'sc-1', shot_id: null, position: 0 },
      { id: 'i6', shot_list_id: 'L2', scene_id: null, shot_id: 'sh-1', position: 0 },
    ],
    tasks: [
      { id: 't-sc1', scene_id: 'sc-1', shot_id: null, updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 't-sh1', scene_id: 'sc-1', shot_id: 'sh-1', updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 't-other', scene_id: 'sc-2', shot_id: 'sh-2', updated_at: '2026-01-01T00:00:00.000Z' },
    ],
    assets: [{ id: 'a1', scene_ids: ['sc-1', 'sc-2'], shot_ids: ['sh-1'] }],
    edits: [{ id: 'e1', shot_list_id: 'L1', items: [{ id: 'x1', scene_id: 'sc-1', shot_id: 'sh-1', label: 'A', notes: '' }] }],
    dependencies: [],
  }
}

const DEL_SCENE = '/api/rabbit/projects/:projectId/scenes/:id'
const DEL_SHOT  = '/api/rabbit/projects/:projectId/shots/:id'

/** Scenes and shots exactly as main.cjs registers them. */
function registerScenesLikeMain(h) {
  h.register('scenes', 'scenes', 'scene', { shotListLinks: 'scene' })
  h.register('shots',  'shots',  'shot',  { shotListLinks: 'shot' })
}

describe('deleting a scene on the desktop takes it out of every shot list (S3a rule 8)', () => {
  it('removes its items from EVERY list, unlinks its tasks, and leaves assets and edits alone', () => {
    const bundle = s3aFixture()
    const before = structuredClone(bundle)
    const h = harness(bundle)
    registerScenesLikeMain(h)

    const res = call(h.routes, 'DELETE', DEL_SCENE, { projectId: 'p1', id: 'sc-1' })

    expect(res.code).toBe(200)
    // items: i1 + i5 (the scene's, in L1 and L2) and i3 + i6 (its shot sh-1's);
    // tasks: t-sc1 and t-sh1 — t-sh1 is linked to both and counts ONCE;
    // shots: sh-1 went with its scene (addendum C).
    expect(res.body).toEqual({ ok: true, swept: 0, unlinked: { items: 4, tasks: 2, shots: 1 } })
    expect(ids(bundle.scenes)).toEqual(['sc-2'])
    expect(ids(bundle.shots)).toEqual(['sh-2'])
    expect(ids(bundle.shotListItems)).toEqual(['i2', 'i4'])
    expect(bundle.tasks.find(t => t.id === 't-sc1').scene_id).toBeNull()
    expect(bundle.tasks.find(t => t.id === 't-sh1')).toMatchObject({ scene_id: null, shot_id: null })
    expect(bundle.tasks.find(t => t.id === 't-sc1').updated_at).not.toBe('2026-01-01T00:00:00.000Z')
    expect(bundle.tasks.find(t => t.id === 't-other')).toEqual(before.tasks[2])
    // Not foreign keys in the cloud either: untouched.
    expect(bundle.assets).toEqual(before.assets)
    expect(bundle.edits).toEqual(before.edits)
    expect(bundle.shotLists).toEqual(before.shotLists)
    expect(bundle.project).toEqual(before.project)
    // One write, and it carries the whole cascade (the mirrors render from it).
    expect(h.writes).toHaveLength(1)
    expect(ids(h.writes[0].shotListItems)).toEqual(['i2', 'i4'])
    expect(ids(h.writes[0].shots)).toEqual(['sh-2'])
  })

  it('R1 local#0: a shot only an ARCHIVED list holds goes with its scene — items, task link and all', () => {
    // The reviewer's replay: sh-b belongs to sc-1 but is in no active-list
    // view (only L2 holds it), so a screen deleting "the scene's shots" from
    // ctx.shots never named it. The backend must.
    const bundle = s3aFixture()
    bundle.shotLists[1].archived_at = '2026-09-01T00:00:00.000Z'
    bundle.shots.push({ id: 'sh-b', scene_id: 'sc-1' })
    bundle.shotListItems.push({ id: 'j3', shot_list_id: 'L2', scene_id: null, shot_id: 'sh-b', position: 1 })
    bundle.tasks.push({ id: 't-b', scene_id: null, shot_id: 'sh-b', updated_at: '2026-01-01T00:00:00.000Z' })
    const h = harness(bundle)
    registerScenesLikeMain(h)

    const res = call(h.routes, 'DELETE', DEL_SCENE, { projectId: 'p1', id: 'sc-1' })

    expect(res.body).toEqual({ ok: true, swept: 0, unlinked: { items: 5, tasks: 3, shots: 2 } })
    expect(ids(bundle.shots)).toEqual(['sh-2'])
    expect(bundle.shotListItems.some(i => i.id === 'j3' || i.shot_id === 'sh-b')).toBe(false)
    expect(bundle.tasks.find(t => t.id === 't-b')).toMatchObject({ scene_id: null, shot_id: null })
    // The archived list is still archived: a delete sweep is not a membership
    // write, so the freeze does not stop it (and does not undo the archive).
    expect(bundle.shotLists[1].archived_at).toBe('2026-09-01T00:00:00.000Z')
  })

  it('FAILING CONTROL: a shot of ANOTHER scene, and its items and tasks, survive the cascade', () => {
    // A cascade matching on the wrong field (id, or any scene_id) would take
    // sh-2 too; so would one that deleted every shot "of a deleted scene".
    const bundle = s3aFixture()
    const before = structuredClone(bundle)
    const h = harness(bundle)
    registerScenesLikeMain(h)
    call(h.routes, 'DELETE', DEL_SCENE, { projectId: 'p1', id: 'sc-1' })
    expect(bundle.shots).toEqual([before.shots[1]])
    expect(bundle.shotListItems.find(i => i.id === 'i4')).toEqual(before.shotListItems[3])
    expect(bundle.tasks.find(t => t.id === 't-other')).toEqual(before.tasks[2])
  })

  it('FAILING CONTROL: deleting a scene no list, task or shot names leaves items, tasks and shots identical', () => {
    const bundle = s3aFixture()
    bundle.scenes.push({ id: 'sc-lonely' })
    const before = structuredClone(bundle)
    const h = harness(bundle)
    registerScenesLikeMain(h)

    const res = call(h.routes, 'DELETE', DEL_SCENE, { projectId: 'p1', id: 'sc-lonely' })

    expect(res.body).toEqual({ ok: true, swept: 0, unlinked: { items: 0, tasks: 0, shots: 0 } })
    expect(bundle.shotListItems).toEqual(before.shotListItems)
    expect(bundle.tasks).toEqual(before.tasks)
    expect(bundle.shots).toEqual(before.shots)
    expect(ids(bundle.scenes)).toEqual(['sc-1', 'sc-2'])
  })

  it('answers 404 and sweeps nothing for a scene that does not exist', () => {
    const bundle = s3aFixture()
    const before = structuredClone(bundle)
    const h = harness(bundle)
    registerScenesLikeMain(h)
    const res = call(h.routes, 'DELETE', DEL_SCENE, { projectId: 'p1', id: 'sc-1-typo' })
    expect(res.code).toBe(404)
    expect(bundle).toEqual(before)
    expect(h.writes).toHaveLength(0)
  })
})

describe('deleting a shot on the desktop takes it out of every shot list (S3a rule 8)', () => {
  it('removes only that shot\'s items and unlinks only shot_id', () => {
    const bundle = s3aFixture()
    const before = structuredClone(bundle)
    const h = harness(bundle)
    registerScenesLikeMain(h)

    const res = call(h.routes, 'DELETE', DEL_SHOT, { projectId: 'p1', id: 'sh-1' })

    expect(res.body).toEqual({ ok: true, swept: 0, unlinked: { items: 2, tasks: 1 } })
    expect(ids(bundle.shotListItems)).toEqual(['i1', 'i2', 'i4', 'i5'])
    // The task keeps its scene; only the shot link goes.
    expect(bundle.tasks.find(t => t.id === 't-sh1')).toMatchObject({ scene_id: 'sc-1', shot_id: null })
    expect(bundle.tasks.find(t => t.id === 't-sc1')).toEqual(before.tasks[0])
    expect(bundle.edits).toEqual(before.edits) // D17: the edit keeps "Missing shot"
    expect(bundle.assets).toEqual(before.assets)
  })
})

describe('the shot-list sweep is opt-in, and main.cjs opts scenes and shots in', () => {
  it('an entity registered without the option neither sweeps nor changes its answer', () => {
    const bundle = s3aFixture()
    const before = structuredClone(bundle)
    const h = harness(bundle)
    h.register('scenes', 'scenes', 'scene') // the pre-S3a registration
    const res = call(h.routes, 'DELETE', DEL_SCENE, { projectId: 'p1', id: 'sc-1' })
    expect(res.body).toEqual({ ok: true, swept: 0 })
    expect(bundle.shotListItems).toEqual(before.shotListItems) // the orphans rule 8 exists to prevent
    expect(bundle.tasks).toEqual(before.tasks)
    expect(bundle.shots).toEqual(before.shots) // …and the shots addendum C exists to take
  })

  it('main.cjs registers scenes and shots with shotListLinks', () => {
    // The replay registers routes itself, so it would stay green if main.cjs
    // dropped the option. This is the assertion that it has not.
    expect(MAIN_CJS).toMatch(/rabbitSubentityRoutes\(\s*'scenes',\s*'scenes',\s*'scene',\s*\{\s*shotListLinks:\s*'scene'\s*\}\s*\)/)
    expect(MAIN_CJS).toMatch(/rabbitSubentityRoutes\(\s*'shots',\s*'shots',\s*'shot',\s*\{\s*shotListLinks:\s*'shot'\s*\}\s*\)/)
  })

  it('main.cjs takes cascadeSceneOrShotDelete from electron/rabbitShotLists.cjs — the function this replay runs', () => {
    expect(MAIN_CJS).toMatch(/cascadeSceneOrShotDelete,?\s*\n?\s*\}\s*=\s*require\('\.\/rabbitShotLists\.cjs'\)/)
    expect(MAIN_CJS).not.toMatch(/function cascadeSceneOrShotDelete\(/)
    // …and the factory calls it, not the links-only sweep (which would keep
    // a deleted scene's shots — the R1 local#0 defect).
    const factory = extractFunction(MAIN_CJS, 'rabbitSubentityRoutes')
    expect(factory).toMatch(/cascadeSceneOrShotDelete\(bundle, shotListLinks, req\.params\.id\)/)
    expect(factory).not.toMatch(/sweepShotListLinks\(/)
  })
})
