// =============================================================================
// setAsideDesktop.test.js — post-overhaul S5b, step 0, on the Local Server
// (0090's twins in electron/main.cjs). A ROUTE REPLAY, the instrument
// desktopMilestoneTrash.test.js and budgetVersionsRoutes.test.js use: the real
// code is lifted out of main.cjs by brace matching and run over an in-memory
// bundle, because vitest covers src/** only.
//
// Audrey's ruling (a): each bid version shows exactly its own schedule; the
// rows the open version does not hold are SET ASIDE — kept whole in
// project.json, never deleted — and come back when a version holding them is
// opened. The desktop's tasks and phases routes HARD-delete, so set-aside must
// never go near them.
//
//   POST …/set-aside      sets aside / brings back in ONE write; trashed rows
//                         and rows already in the asked state untouched
//   scheduleRow           the stamp never rides an ordinary POST or PATCH (the
//                         upsert MERGES: a stale copy would bring a row back)
//   a key date's trash    clears the stamp (a trashed row is never set aside)
//   the mirror files and the manifest counts   hide set-aside rows
// Each with a failing control.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const MAIN_CJS = readFileSync(new URL('../../../electron/main.cjs', import.meta.url), 'utf-8')
const require = createRequire(import.meta.url)
const { cascadeSceneOrShotDelete } = require('../../../electron/rabbitShotLists.cjs')
const AT = '2026-10-05T10:00:00.000Z'

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`main.cjs no longer defines ${name}()`)
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
    else if (source[j] === '}') { depth--; if (depth === 0) return source.slice(start, j + 1) }
  }
  throw new Error(`unbalanced braces extracting ${name}()`)
}
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
const rabbitNotFound = (res, what = 'project') => res.status(404).json({ error: `${what} not found` })
const response = () => ({ code: 200, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } })

function fixture() {
  return {
    project: { id: 'p1', title: 'P', folder_slug: 'P' },
    phases: [{ id: 'ph1', name: 'Pre' }, { id: 'ph2', name: 'High ROM' }],
    tasks: [
      { id: 't1', phase_id: 'ph1', title: 'Boards' },
      { id: 't2', phase_id: 'ph2', title: 'Lighting pass 2', logged_days: 1.5 },
      { id: 't3', title: 'Trashed one', deleted_at: '2026-10-01T00:00:00Z' },
    ],
    dependencies: [{ id: 'd1', kind: 'task', predecessor_id: 't1', successor_id: 't2' }],
    taskLinks: [{ id: 'l1', task_id: 't2', url: 'https://x.test' }],
    comments: [{ id: 'c1', entity_type: 'task', entity_id: 't2', body: 'keep' }],
    milestones: [{ id: 'm1', title: 'Review', date: '2026-11-02' }, { id: 'm2', title: 'Delivery', date: '2026-12-01' }],
  }
}

describe('POST …/set-aside — the desktop\'s set_aside_schedule_rows', () => {
  const route = (bundle) => {
    const writes = []
    const body = extractRouteBody(MAIN_CJS, "expressApp.post('/api/rabbit/projects/:projectId/set-aside',")
    // eslint-disable-next-line no-new-func
    const handler = new Function('readRabbitBundle', 'writeRabbitBundle', 'rabbitNotFound', `return (req, res) => ${body}`)(
      () => bundle, (_id, b) => { writes.push(structuredClone(b)) }, rabbitNotFound)
    const call = (reqBody) => { const res = response(); handler({ params: { projectId: 'p1' }, body: reqBody, query: {} }, res); return res }
    return { call, writes }
  }

  it('sets a task, a phase and a key date aside in ONE write — kept whole, nothing deleted (constraint 1)', () => {
    const bundle = fixture()
    const { call, writes } = route(bundle)
    const res = call({ on: true, tasks: ['t2'], phases: ['ph2'], milestones: ['m1'] })
    expect(res.body).toMatchObject({ tasks: 1, phases: 1, milestones: 1 })
    expect(res.body.set_aside_at).toBeTruthy()
    expect(writes).toHaveLength(1)
    const w = writes[0]
    expect(w.tasks.find(t => t.id === 't2')).toMatchObject({ title: 'Lighting pass 2', logged_days: 1.5, set_aside_at: res.body.set_aside_at })
    expect(w.tasks).toHaveLength(3)
    expect(w.dependencies).toEqual(fixture().dependencies)
    expect(w.taskLinks).toEqual(fixture().taskLinks)
    expect(w.comments).toEqual(fixture().comments)
  })
  it('brings them back — the same rows, the stamp gone', () => {
    const bundle = fixture()
    const { call, writes } = route(bundle)
    call({ on: true, tasks: ['t2'], phases: ['ph2'] })
    const back = call({ on: false, tasks: ['t2'], phases: ['ph2'] })
    expect(back.body).toMatchObject({ set_aside_at: null, tasks: 1, phases: 1, milestones: 0 })
    expect(writes.at(-1).tasks.find(t => t.id === 't2')).toEqual(fixture().tasks[1])
  })
  it('a trashed row is never set aside; a row already aside keeps its first stamp; nothing to change, nothing written', () => {
    const bundle = fixture()
    bundle.tasks[1].set_aside_at = AT
    const { call, writes } = route(bundle)
    const res = call({ on: true, tasks: ['t2', 't3'] })
    expect(res.body).toMatchObject({ tasks: 0 })
    expect(writes).toEqual([])
    expect(bundle.tasks[1].set_aside_at).toBe(AT)
    expect(bundle.tasks[2].set_aside_at).toBeUndefined()
  })
})

// The generic factory, lifted as desktopMilestoneTrash.test.js lifts it.
function harness(bundle) {
  const routes = new Map()
  const writes = []
  const expressApp = {
    post: (p, h) => routes.set(`POST ${p}`, h),
    patch: (p, h) => routes.set(`PATCH ${p}`, h),
    delete: (p, h) => routes.set(`DELETE ${p}`, h),
  }
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
  )(expressApp, () => bundle, (_p, b) => { writes.push(structuredClone(b)) }, rabbitNotFound, () => {}, () => {}, () => 'uuid', cascadeSceneOrShotDelete)
  const call = (verb, pattern, params, body = {}, query = {}) => {
    const res = response()
    routes.get(`${verb} ${pattern}`)({ params, body, query }, res)
    return res
  }
  return { register, call, writes }
}

describe('scheduleRow — the stamp never rides an ordinary write', () => {
  it('a POST (the upsert MERGES) and a PATCH carrying set_aside_at: null leave a set-aside task aside', () => {
    const bundle = fixture()
    bundle.tasks[1].set_aside_at = AT
    const h = harness(bundle)
    h.register('tasks', 'tasks', null, { sweepDependencies: true, scheduleRow: true })
    h.call('POST', '/api/rabbit/projects/:projectId/tasks', { projectId: 'p1' }, { ...fixture().tasks[1], title: 'stale copy', set_aside_at: null })
    expect(bundle.tasks[1]).toMatchObject({ title: 'stale copy', set_aside_at: AT })
    h.call('PATCH', '/api/rabbit/projects/:projectId/tasks/:id', { projectId: 'p1', id: 't2' }, { set_aside_at: null, bid_days: 3 })
    expect(bundle.tasks[1]).toMatchObject({ bid_days: 3, set_aside_at: AT })
  })
  it('a new row cannot arrive set aside either', () => {
    const bundle = fixture()
    const h = harness(bundle)
    h.register('phases', 'phases', null, { sweepDependencies: true, scheduleRow: true })
    h.call('POST', '/api/rabbit/projects/:projectId/phases', { projectId: 'p1' }, { id: 'ph9', name: 'New', set_aside_at: AT })
    expect(bundle.phases.find(p => p.id === 'ph9')).not.toHaveProperty('set_aside_at')
  })
  it('FAILING CONTROL: registered without the opt, the same PATCH WOULD bring the row back', () => {
    const bundle = fixture()
    bundle.tasks[1].set_aside_at = AT
    const h = harness(bundle)
    h.register('tasks', 'tasks', null, { sweepDependencies: true })
    h.call('PATCH', '/api/rabbit/projects/:projectId/tasks/:id', { projectId: 'p1', id: 't2' }, { set_aside_at: null })
    expect(bundle.tasks[1].set_aside_at).toBeNull()
  })
  it('a key date trashed while set aside loses the stamp, so Recently deleted restores it LIVE', () => {
    const bundle = fixture()
    bundle.milestones[0].set_aside_at = AT
    const h = harness(bundle)
    h.register('milestones', 'milestones', null, { softDelete: true, scheduleRow: true })
    const res = h.call('DELETE', '/api/rabbit/projects/:projectId/milestones/:id', { projectId: 'p1', id: 'm1' })
    expect(res.body).toMatchObject({ softDeleted: true })
    expect(bundle.milestones[0].deleted_at).toBeTruthy()
    expect(bundle.milestones[0]).not.toHaveProperty('set_aside_at')
    h.call('POST', '/api/rabbit/projects/:projectId/milestones/:id/restore', { projectId: 'p1', id: 'm1' })
    expect(bundle.milestones[0]).not.toHaveProperty('deleted_at')
    expect(bundle.milestones[0]).not.toHaveProperty('set_aside_at')
  })
})

describe('the readable mirror files and the manifest hide set-aside rows', () => {
  const asideBundle = () => {
    const b = fixture()
    b.tasks = b.tasks.filter(t => !t.deleted_at)
    b.tasks[1].set_aside_at = AT
    b.phases[1].set_aside_at = AT
    return b
  }
  const mirror = (bundle) => {
    const files = {}
    // eslint-disable-next-line no-new-func
    const fn = new Function('resolveProjectFolder', 'fileSlugify', 'path', 'fs', 'writeJSON', 'console',
      `${extractFunction(MAIN_CJS, 'mirrorProjectDatabases')}\nreturn mirrorProjectDatabases;`)(
      () => '/root', (s) => s, { join: (...p) => p.join('/') }, { existsSync: () => true, mkdirSync: () => {} },
      (file, data) => { files[file.split('/').pop()] = data }, { error: (...a) => { throw new Error(a.join(' ')) } })
    fn('p1', bundle)
    return files
  }
  it('tasks.json and timeline.json: no set-aside task, phase, edge or link', () => {
    const files = mirror(asideBundle())
    expect(files['tasks.json'].tasks.map(t => t.id)).toEqual(['t1'])
    expect(files['tasks.json'].dependencies).toEqual([])
    expect(files['tasks.json'].taskLinks).toEqual([])
    expect(files['timeline.json'].phases.map(p => p.id)).toEqual(['ph1'])
    expect(files['timeline.json'].tasks.map(t => t.id)).toEqual(['t1'])
  })
  it('CONTROL: with nothing set aside, every row is mirrored', () => {
    const b = fixture()
    b.tasks = b.tasks.filter(t => !t.deleted_at)
    const files = mirror(b)
    expect(files['tasks.json'].tasks.map(t => t.id)).toEqual(['t1', 't2'])
    expect(files['tasks.json'].dependencies).toHaveLength(1)
    expect(files['timeline.json'].phases).toHaveLength(2)
  })
  it('the manifest counts the live schedule only', () => {
    // eslint-disable-next-line no-new-func
    const build = new Function(`${extractFunction(MAIN_CJS, 'buildProjectManifestFor')}\nreturn buildProjectManifestFor;`)()
    expect(build(asideBundle()).counts).toMatchObject({ phases: 1, tasks: 1 })
    const b = fixture()
    b.tasks = b.tasks.filter(t => !t.deleted_at)
    expect(build(b).counts).toMatchObject({ phases: 2, tasks: 2 })
  })
})
