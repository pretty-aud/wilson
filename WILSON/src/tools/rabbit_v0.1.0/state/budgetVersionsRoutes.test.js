// =============================================================================
// budgetVersionsRoutes.test.js — post-overhaul S5 (0089) on the Local Server.
//
// Two inline routes in electron/main.cjs, lifted by brace matching and replayed
// over an in-memory bundle (rabbitShotLists.routes.test.js's technique):
//
//   1. the project PATCH — the desktop's copy of 0089's same-project FK: the
//      OPEN bid version must be one of this project's versions. (The money
//      guard has no twin: the Local Server has no roles, A9's one line.)
//   2. POST …/budget-versions/select — the desktop's select_budget_version:
//      the SELECTED bid in one write, every other cleared, null clears all.
// Each with a failing control: the refusal is the rule, not the route.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const MAIN_CJS = readFileSync(new URL('../../../../electron/main.cjs', import.meta.url), 'utf-8')
const PID = 'p1'

/** Lift the BODY block of an inline `expressApp.<verb>('<path>', (req, res) => { … })`. */
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

function replay(head, params, bundle, extraNames = [], extraValues = []) {
  const writes = []
  const body = extractRouteBody(MAIN_CJS, head)
  // eslint-disable-next-line no-new-func
  const handler = new Function(
    'readRabbitBundle', 'writeRabbitBundle', 'rabbitNotFound', ...extraNames,
    `return (req, res) => ${body}`,
  )(() => bundle, (_id, b) => { writes.push(structuredClone(b)) }, rabbitNotFound, ...extraValues)
  const call = (reqBody) => { const res = response(); handler({ params, body: reqBody, query: {} }, res); return res }
  return { call, writes }
}

describe('the project PATCH — the OPEN bid version must be this project\'s (0089\'s FK, desktop)', () => {
  const patchRoute = (bundle) => replay(
    "expressApp.patch('/api/rabbit/projects/:id',", { id: PID }, bundle,
    ['folderRootRefusal', 'fileSlugify', 'path', 'fs', 'resolveConfiguredRootDir', 'ensureProjectFolderRows', 'materializeFolderDirs'],
    [() => ({ error: 'no' }), (s) => String(s), path, { existsSync: () => false, renameSync: () => { throw new Error('no disk') } }, () => null, () => false, () => {}],
  )
  const seeded = () => ({
    project: { id: PID, title: 'P', open_budget_version_id: null },
    budgetVersions: [{ id: 'bv1', project_id: PID }, { id: 'bv2', project_id: PID }],
  })

  it('a pointer to a version this project does not hold is refused, and nothing is written', () => {
    const bundle = seeded()
    const { call, writes } = patchRoute(bundle)
    const res = call({ open_budget_version_id: 'elsewhere', description: 'x' })
    expect(res.code).toBe(404)
    expect(res.body).toEqual({ error: 'bid version not found in this project', code: 'not_found' })
    expect(writes).toEqual([])
    expect(bundle.project.open_budget_version_id).toBeNull()
  })
  it('FAILING CONTROL: one of its own versions opens; clearing it and an echoed pointer pass', () => {
    const bundle = seeded()
    const { call, writes } = patchRoute(bundle)
    expect(call({ open_budget_version_id: 'bv2' }).code).toBe(200)
    expect(writes.at(-1).project.open_budget_version_id).toBe('bv2')
    expect(call({ id: PID, title: 'P', open_budget_version_id: 'bv2', description: 'echo' }).code).toBe(200)
    expect(call({ open_budget_version_id: null }).code).toBe(200)
    expect(writes.at(-1).project.open_budget_version_id).toBeNull()
    expect(writes).toHaveLength(3)
  })
  it('a body without the key is untouched by the check', () => {
    const { call } = patchRoute(seeded())
    expect(call({ description: 'only this' }).code).toBe(200)
  })
})

describe('POST …/budget-versions/select — the SELECTED bid in one write (desktop)', () => {
  const selectRoute = (bundle) => replay(
    "expressApp.post('/api/rabbit/projects/:projectId/budget-versions/select',", { projectId: PID }, bundle,
  )
  const seeded = () => ({
    project: { id: PID },
    // Two left selected, as the old client loop could leave them.
    budgetVersions: [
      { id: 'bv1', is_active: true, updated_at: 'old' },
      { id: 'bv2', is_active: true, updated_at: 'old' },
      { id: 'bv3', is_active: false, updated_at: 'old' },
    ],
  })

  it('selects one and clears every other in the same write', () => {
    const { call, writes } = selectRoute(seeded())
    const res = call({ version_id: 'bv3' })
    expect(res).toMatchObject({ code: 200, body: { selected: 'bv3' } })
    expect(writes).toHaveLength(1)
    expect(writes[0].budgetVersions.map(v => [v.id, v.is_active])).toEqual([['bv1', false], ['bv2', false], ['bv3', true]])
  })
  it('null clears the selection — nothing is promoted (F13)', () => {
    const { call, writes } = selectRoute(seeded())
    expect(call({ version_id: null }).body).toEqual({ selected: null })
    expect(writes[0].budgetVersions.every(v => v.is_active === false)).toBe(true)
  })
  it('an unknown version is 404 and nothing is written', () => {
    const { call, writes } = selectRoute(seeded())
    expect(call({ version_id: 'nope' }).code).toBe(404)
    expect(writes).toEqual([])
  })
  it('FAILING CONTROL: a row already as wanted keeps its updated_at; only the rows that change are stamped', () => {
    const { call, writes } = selectRoute({ project: { id: PID }, budgetVersions: [{ id: 'bv1', is_active: true, updated_at: 'old' }, { id: 'bv2', is_active: false, updated_at: 'old' }] })
    call({ version_id: 'bv1' })
    expect(writes[0].budgetVersions.map(v => v.updated_at)).toEqual(['old', 'old'])
  })
})
