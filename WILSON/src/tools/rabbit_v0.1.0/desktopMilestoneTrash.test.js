// =============================================================================
// desktopMilestoneTrash.test.js — Track A bundle A2 session 2 (2026-09-07),
// ruling 38.
//
// A ROUTE REPLAY, the same instrument desktopDeleteSweep.test.js uses and for
// the same reason: vitest.config includes only src/**, so electron/main.cjs
// has no other coverage. The generic sub-entity factory is lifted out of
// main.cjs by paren-then-brace matching, rebuilt over an in-memory bundle in
// place of the disk, and its handlers are called the way Express would.
//
// What it pins. A milestone delete on the desktop used to splice the row out
// of the bundle, which made "Recently deleted" and Undo impossible on that
// backend — MASTER_PLAN §6 #10, "milestones have no undo path (kept confirm
// dialog)". The DELETE now stamps deleted_at and a restore route clears it, so
// the row survives the write and both affordances have something to act on.
// The cloud got the same behaviour from 0014's machinery via 0067.
//
// 🚨 THE FAILING CONTROLS ARE THE POINT, TWICE OVER:
//   * a soft delete must leave every OTHER collection byte-identical — a
//     handler that rewrote the bundle wholesale would pass the positive case;
//   * an entity registered WITHOUT the opt must still HARD delete. The opt was
//     added to a factory shared by nine entities, and a soft delete leaking
//     into scenes or levels would leave rows their adapters do not filter,
//     which is a data-shaped bug with no error anywhere.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const MAIN_CJS = readFileSync(new URL('../../../electron/main.cjs', import.meta.url), 'utf-8')

/** Lift `function name(...) { ... }` out of the source by brace matching. */
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`main.cjs no longer defines ${name}() — the replay cannot run`)
  // Paren-match the parameter list FIRST. `opts = {}` and destructured
  // parameters otherwise supply the "opening brace" and the extract is
  // garbage — the trap A2 session 1 recorded after hitting it.
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
    project: { id: 'p1', title: 'Fixture' },
    phases: [{ id: 'ph-p', name: 'Pre' }],
    tasks: [{ id: 't-a' }],
    dependencies: [{ id: 'd1', kind: 'task', predecessor_id: 't-a', successor_id: 't-a' }],
    scenes: [{ id: 'sc-1', name: 'WLSN_SC001' }],
    milestones: [
      { id: 'm-lock',  title: 'Lock picture', date: '2026-10-01' },
      { id: 'm-wrap',  title: 'Wrap',         date: '2026-12-20' },
      { id: 'm-gone',  title: 'Scouted',      date: '2026-08-01', deleted_at: '2026-09-01T10:00:00Z' },
    ],
  }
}

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

const DEL_MS     = '/api/rabbit/projects/:projectId/milestones/:id'
const RESTORE_MS = '/api/rabbit/projects/:projectId/milestones/:id/restore'
const DEL_SCENE  = '/api/rabbit/projects/:projectId/scenes/:id'
const ids = rows => rows.map(r => r.id)

/** Register exactly as main.cjs does. */
function registerLikeMain(h) {
  h.register('milestones', 'milestones', null, { softDelete: true })
  h.register('scenes', 'scenes')
}


describe('deleting a milestone on the desktop trashes it instead of destroying it', () => {
  it('stamps deleted_at, keeps the row, and moves nothing else', () => {
    const bundle = fixture()
    const before = structuredClone(bundle)
    const h = harness(bundle)
    registerLikeMain(h)

    const res = call(h.routes, 'DELETE', DEL_MS, { projectId: 'p1', id: 'm-lock' })

    expect(res.code).toBe(200)
    expect(res.body).toEqual({ ok: true, swept: 0, softDeleted: true })

    // The row is still there, now stamped.
    expect(ids(bundle.milestones)).toEqual(['m-lock', 'm-wrap', 'm-gone'])
    const row = bundle.milestones.find(m => m.id === 'm-lock')
    expect(row.deleted_at).toBeTruthy()
    expect(Number.isFinite(Date.parse(row.deleted_at))).toBe(true)
    // Everything else about the row survives, or Restore brings back a husk.
    expect(row.title).toBe('Lock picture')
    expect(row.date).toBe('2026-10-01')

    // 🚨 FAILING CONTROL: nothing outside `milestones` moved.
    expect(bundle.phases).toEqual(before.phases)
    expect(bundle.tasks).toEqual(before.tasks)
    expect(bundle.dependencies).toEqual(before.dependencies)
    expect(bundle.scenes).toEqual(before.scenes)
    expect(bundle.project).toEqual(before.project)
    // And the untouched milestones are byte-identical.
    expect(bundle.milestones.find(m => m.id === 'm-wrap')).toEqual(before.milestones[1])
    expect(bundle.milestones.find(m => m.id === 'm-gone')).toEqual(before.milestones[2])

    // The disk write — and therefore the _DATABASES mirrors, which are
    // rendered FROM this bundle — carries the stamp.
    expect(h.writes).toHaveLength(1)
    expect(h.writes[0].milestones.find(m => m.id === 'm-lock').deleted_at).toBe(row.deleted_at)
  })

  it('deleting an already-trashed milestone is a 404, not a second stamp', () => {
    // A second stamp would move the purge countdown and make "deleted 3 weeks
    // ago" read as "deleted just now".
    const bundle = fixture()
    const stampWas = bundle.milestones.find(m => m.id === 'm-gone').deleted_at
    const h = harness(bundle)
    registerLikeMain(h)

    const res = call(h.routes, 'DELETE', DEL_MS, { projectId: 'p1', id: 'm-gone' })

    expect(res.code).toBe(404)
    expect(bundle.milestones.find(m => m.id === 'm-gone').deleted_at).toBe(stampWas)
    expect(h.writes).toHaveLength(0)
  })

  it('deleting a milestone that never existed is a 404', () => {
    const bundle = fixture()
    const h = harness(bundle)
    registerLikeMain(h)
    const res = call(h.routes, 'DELETE', DEL_MS, { projectId: 'p1', id: 'nope' })
    expect(res.code).toBe(404)
    expect(h.writes).toHaveLength(0)
  })
})


describe('restore clears the stamp', () => {
  it('brings a trashed milestone back and reports restored: true', () => {
    const bundle = fixture()
    const h = harness(bundle)
    registerLikeMain(h)

    const res = call(h.routes, 'POST', RESTORE_MS, { projectId: 'p1', id: 'm-gone' })

    expect(res.code).toBe(200)
    expect(res.body).toEqual({ ok: true, restored: true })
    const row = bundle.milestones.find(m => m.id === 'm-gone')
    // The KEY is removed, not set to null: the adapter filters on
    // `!m.deleted_at`, and a lingering null would pass that but still show up
    // in anything checking for the property's presence.
    expect('deleted_at' in row).toBe(false)
    expect(row.title).toBe('Scouted')
  })

  it('restoring a live milestone answers restored: false, matching the cloud RPC', () => {
    // restore_soft_deleted returns false when the row was already live —
    // someone else restored it first. A 404 here would make the two backends
    // disagree about a case the UI has copy for.
    const bundle = fixture()
    const h = harness(bundle)
    registerLikeMain(h)

    const res = call(h.routes, 'POST', RESTORE_MS, { projectId: 'p1', id: 'm-wrap' })

    expect(res.code).toBe(200)
    expect(res.body).toEqual({ ok: true, restored: false })
    expect(h.writes).toHaveLength(0)
  })

  it('restoring a milestone that never existed is a 404', () => {
    const bundle = fixture()
    const h = harness(bundle)
    registerLikeMain(h)
    const res = call(h.routes, 'POST', RESTORE_MS, { projectId: 'p1', id: 'nope' })
    expect(res.code).toBe(404)
  })
})


describe('the opt does not leak to the other eight entities', () => {
  it('🚨 FAILING CONTROL: an entity without the opt still HARD deletes', () => {
    // rabbitSubentityRoutes is shared by phases, milestones, scenes, shots,
    // levels, experiences and more. If softDelete were read from the wrong
    // place — or defaulted true — a scene delete would leave a stamped row
    // that ScenesView's adapter does not filter, so the scene would come back
    // on the next load with no error anywhere.
    const bundle = fixture()
    const h = harness(bundle)
    registerLikeMain(h)

    const res = call(h.routes, 'DELETE', DEL_SCENE, { projectId: 'p1', id: 'sc-1' })

    expect(res.code).toBe(200)
    expect(res.body).toEqual({ ok: true, swept: 0 })
    expect(bundle.scenes).toEqual([])
  })

  it('an entity without the opt registers NO restore route', () => {
    const bundle = fixture()
    const h = harness(bundle)
    registerLikeMain(h)
    expect(h.routes.has(`POST ${RESTORE_MS}`)).toBe(true)
    expect(h.routes.has('POST /api/rabbit/projects/:projectId/scenes/:id/restore')).toBe(false)
  })
})


describe('main.cjs registers milestones with the opt', () => {
  it('the registration carries softDelete, and no dependency sweep', () => {
    // The replay above proves the FACTORY behaves; this proves main.cjs asks
    // it to. Both halves are needed — A2 session 1 shipped the same pair for
    // the dependency sweep after noticing the opt-in could be forgotten.
    const line = MAIN_CJS.split(/\r?\n/).find(
      l => l.includes("rabbitSubentityRoutes('milestones'"),
    )
    expect(line, "main.cjs no longer registers a 'milestones' sub-entity route").toBeTruthy()
    expect(line).toMatch(/softDelete:\s*true/)
    // A milestone is not a dependency endpoint; sweeping would be a no-op that
    // implies otherwise.
    expect(line).not.toMatch(/sweepDependencies/)
  })
})
