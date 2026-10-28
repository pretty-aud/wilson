// =============================================================================
// runMigration.test.js — Track A bundle A2 (2026-09-06), ruling 8.
//
// The desktop→cloud migration used to insert projects, phases, assets, tasks
// and files and never write `task_dependencies` or `phase_dependencies`
// (docs/OUTSTANDING.md, "A desktop→cloud migration silently drops the whole
// dependency graph"): a migrated project arrived with an empty Gantt link set,
// no error, no report line. This pins the edge inserts BY TABLE — the count
// for each table goes red the moment either insert is removed — and pins what
// the dry run reports, so the person sees "3 task links, 1 phase link" before
// anything is written.
//
// The Supabase client is a recorder; the desktop server is a two-URL fetch.
// Nothing here touches a network.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fake = vi.hoisted(() => {
  const state = { inserts: {}, log: [], failWith: null, uploads: [], rpcs: [], legalLocked: true, rpcError: null, existing: {}, selectError: null, eqColumns: [], cloud: {}, viewsReadError: null, revision: 0 }
  // VW1c (0098): the views' part goes through the cloud ADAPTER (its paged
  // reads of what the cloud holds, its INSERTs), so its two tables answer as
  // PostgREST does: a chainable, thenable query over `state.cloud` (the rows
  // the cloud holds, by project), an insert that lands there with the
  // database's revision, `state.failWith` for a refusal, `state.viewsReadError`
  // for a read the cloud refuses. Every other table keeps the fake below.
  const VIEW_TABLES = new Set(['table_views', 'item_groupings'])
  const sameSet = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === new Set(b).size && b.every(x => a.includes(x))
  function viewsBuilder(table) {
    const ops = []
    const b = {}
    for (const op of ['select', 'eq', 'order', 'range', 'single', 'maybeSingle', 'insert', 'contains', 'containedBy']) {
      b[op] = (...args) => { ops.push([op, ...args]); return b }
    }
    b.then = (resolve, reject) => {
      const op = (name) => ops.find(o => o[0] === name)
      let answer
      if (op('insert')) {
        const row = op('insert')[1]
        state.log.push(table)
        const refused = state.failWith?.(table, row)
        if (refused) answer = { data: null, error: refused }
        else {
          ;(state.inserts[table] ||= []).push(row)
          const stored = { ...row, ...(table === 'table_views' ? { revision: ++state.revision } : {}), created_by: 'u-mover' }
          ;(state.cloud[table] ||= []).push(stored)
          answer = { data: stored, error: null }
        }
      } else if (state.viewsReadError?.[table]) {
        answer = { data: null, error: state.viewsReadError[table] }
      } else {
        let rows = (state.cloud[table] || []).filter(x => ops.filter(o => o[0] === 'eq').every(([, c, v]) => x[c] === v))
        if (op('contains')) rows = rows.filter(x => sameSet(x.entity_ids, op('contains')[2]))
        const range = op('range')
        answer = op('maybeSingle') ? { data: rows[0] || null, error: null } : { data: range ? rows.slice(range[1], range[2] + 1) : rows, error: null }
      }
      return Promise.resolve(answer).then(resolve, reject)
    }
    return b
  }
  const client = {
    // The adapter's session read (its getClient); the runner never calls it.
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u-mover' } } } }) },
    from(table) {
      if (VIEW_TABLES.has(table)) return viewsBuilder(table)
      let id = null
      return {
        // The existence check before an upload (review round 2, R2-BEH-06).
        select() { return this },
        eq(col, value) { state.eqColumns.push(col); id = col === 'id' ? value : null; return this },
        maybeSingle: async () => (state.selectError
          ? { data: null, error: state.selectError }
          : { data: state.existing[table]?.[id] ?? null, error: null }),
        insert: async (row) => {
          state.log.push(table)
          const override = state.failWith?.(table, row)
          if (override) return { error: override }
          ;(state.inserts[table] ||= []).push(row)
          return { error: null }
        },
      }
    },
    storage: {
      from() {
        return {
          list:   async () => ({ data: [] }),
          upload: async (path) => { state.uploads.push(path); return { error: null } },
        }
      },
    },
    rpc: async (fn, args) => {
      state.rpcs.push([fn, args])
      if (fn === 'rabbit_money_segment') {
        if (state.rpcError) return { data: null, error: state.rpcError }
        return { data: args?.seg === 'LEGAL' ? state.legalLocked : false, error: null }
      }
      // S4d (0092): the Legal gate, probed with the nil project; a cloud
      // without 0092 answers "no such function".
      if (fn === 'can_access_project_legal') {
        if (state.gateMissing) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.can_access_project_legal(p_project) in the schema cache' } }
        return { data: false, error: null }
      }
      return { data: null, error: null }
    },
  }
  return { state, client }
})

vi.mock('../auth/supabaseClient', () => ({ supabase: fake.client }))

const { runMigration, assetRowForCloud, viewFiltersLeftBehind, VIEW_FILTERS_LEFT_BEHIND, TABLE_VIEWS_NOT_IN_CLOUD, TABLE_VIEWS_UNREAD } = await import('./runMigration')
const { resetTableViewsSchemaState } = await import('../../tools/rabbit_v0.1.0/adapters/supabaseAdapter')
const { viewNameProblem } = await import('../../tools/rabbit_v0.1.0/state/tableViewsModel')

function bundle() {
  return {
    project: { id: 'p1', title: 'Fixture' },
    phases: [{ id: 'ph1', project_id: 'p1', name: 'Pre' }, { id: 'ph2', project_id: 'p1', name: 'Prod' }],
    assets: [],
    tasks:  [{ id: 't1', project_id: 'p1' }, { id: 't2', project_id: 'p1' }, { id: 't3', project_id: 'p1' }],
    files:  [],
    dependencies: [
      { id: 'd1', kind: 'task',  predecessor_id: 't1',  successor_id: 't2',  type: 'FS', lag_days: 0, project_id: 'p1' },
      { id: 'd2', kind: 'task',  predecessor_id: 't2',  successor_id: 't3',  type: 'FS', lag_days: 2, project_id: 'p1' },
      { id: 'd3',                predecessor_id: 't1',  successor_id: 't3',  type: 'FS', lag_days: 0, project_id: 'p1' }, // legacy: no kind
      { id: 'd4', kind: 'phase', predecessor_id: 'ph1', successor_id: 'ph2', type: 'FS', lag_days: 0, project_id: 'p1' },
    ],
    taskLinks: [], assetVersions: [], comments: [], ingestionRuns: [],
  }
}

let warn
beforeEach(() => {
  fake.state.inserts = {}
  fake.state.log = []
  fake.state.failWith = null
  fake.state.uploads = []
  fake.state.rpcs = []
  fake.state.legalLocked = true
  fake.state.gateMissing = false
  fake.state.rpcError = null
  fake.state.existing = {}
  fake.state.selectError = null
  fake.state.eqColumns = []
  fake.state.cloud = {}
  fake.state.viewsReadError = null
  fake.state.revision = 0
  // The adapter's memory of what a probe found (module state, on purpose:
  // an auth event does not change the schema) is forgotten between tests.
  resetTableViewsSchemaState()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  globalThis.fetch = vi.fn(async (url) => {
    if (url === '/api/rabbit/projects')    return { ok: true, json: async () => [{ id: 'p1', title: 'Fixture' }] }
    if (url === '/api/rabbit/projects/p1') return { ok: true, json: async () => bundle() }
    return { ok: false, status: 404 }
  })
})
afterEach(() => { vi.restoreAllMocks() })

describe('a real run writes both edge tables after their endpoints', () => {
  it('inserts every task edge into task_dependencies and every phase edge into phase_dependencies', async () => {
    const report = await runMigration({ workspaceId: 'ws1' })
    const ins = fake.state.inserts
    expect(ins.projects).toHaveLength(1)
    expect(ins.phases).toHaveLength(2)
    expect(ins.tasks).toHaveLength(3)
    expect(ins.task_dependencies).toHaveLength(3)   // d1, d2 and the legacy d3
    expect(ins.phase_dependencies).toHaveLength(1)  // d4
    expect(report.taskLinks).toEqual({ total: 3, inserted: 3, skipped: 0, failed: 0 })
    expect(report.phaseLinks).toEqual({ total: 1, inserted: 1, skipped: 0, failed: 0 })
    expect(report.errors).toEqual([])
  })

  it('sends only columns the edge tables have: no kind, no project_id, no embed', async () => {
    await runMigration({ workspaceId: 'ws1' })
    for (const row of [...fake.state.inserts.task_dependencies, ...fake.state.inserts.phase_dependencies]) {
      expect(row).not.toHaveProperty('kind')
      expect(row).not.toHaveProperty('project_id')
      expect(row).not.toHaveProperty('predecessor')
      expect(row).toMatchObject({ id: expect.any(String), predecessor_id: expect.any(String), successor_id: expect.any(String), type: 'FS' })
    }
    expect(fake.state.inserts.task_dependencies.find(r => r.id === 'd2').lag_days).toBe(2)
    // A well-formed edge is stripped before toColumns sees it, so a migration
    // of a thousand edges does not log a thousand "dropped field" warnings.
    expect(warn).not.toHaveBeenCalled()
  })

  it('writes the edges only after the rows they reference', async () => {
    await runMigration({ workspaceId: 'ws1' })
    const log = fake.state.log
    const last = (t) => log.lastIndexOf(t)
    const first = (t) => log.indexOf(t)
    expect(first('task_dependencies')).toBeGreaterThan(last('tasks'))
    expect(first('task_dependencies')).toBeGreaterThan(last('phases'))
    expect(first('phase_dependencies')).toBeGreaterThan(last('phases'))
  })

  it('counts an already-migrated edge as skipped and a refused one as failed, and keeps going', async () => {
    fake.state.failWith = (table, row) => {
      if (table === 'task_dependencies' && row.id === 'd1') return { code: '23505', message: 'duplicate key' }
      if (table === 'task_dependencies' && row.id === 'd2') return { code: '23503', message: 'violates foreign key constraint' }
      return null
    }
    const report = await runMigration({ workspaceId: 'ws1' })
    expect(report.taskLinks).toEqual({ total: 3, inserted: 1, skipped: 1, failed: 1 })
    expect(report.phaseLinks).toEqual({ total: 1, inserted: 1, skipped: 0, failed: 0 })
    expect(report.errors).toEqual([
      expect.objectContaining({ scope: 'task_link', projectId: 'p1', id: 'd2' }),
    ])
    expect(fake.state.inserts.task_dependencies.map(r => r.id)).toEqual(['d3'])
  })
})

describe('the project row leaves the local active shot list behind (0084; S3a review round 1, scope#9)', () => {
  // The Local Server sets project.active_shot_list_id (its read-time backfill
  // on every legacy bundle, set-active after that). It names a LOCAL list the
  // runner never copies, so on a 0084 database the composite FK refused the
  // project — and the runner then skips all of its children.
  function servesAnActiveList() {
    globalThis.fetch = vi.fn(async (url) => {
      if (url === '/api/rabbit/projects')    return { ok: true, json: async () => [{ id: 'p1', title: 'Fixture' }] }
      if (url === '/api/rabbit/projects/p1') {
        return { ok: true, json: async () => ({ ...bundle(), project: { id: 'p1', title: 'Fixture', status: 'active', active_shot_list_id: 'local-list-1' } }) }
      }
      return { ok: false, status: 404 }
    })
    fake.state.failWith = (table, row) => (table === 'projects' && row.active_shot_list_id != null)
      ? { code: '23503', message: 'insert or update on table "projects" violates foreign key constraint "projects_active_shot_list_fk"' }
      : null
  }

  it('does not send active_shot_list_id, so the project and its children migrate', async () => {
    servesAnActiveList()
    const report = await runMigration({ workspaceId: 'ws1' })
    expect(report.errors).toEqual([])
    expect(report.projects).toEqual({ total: 1, inserted: 1, skipped: 0, failed: 0 })
    expect(fake.state.inserts.projects[0]).not.toHaveProperty('active_shot_list_id')
    expect(fake.state.inserts.phases).toHaveLength(2)
    expect(fake.state.inserts.tasks).toHaveLength(3)
  })

  it('every other project field still goes out, with the target workspace', async () => {
    servesAnActiveList()
    await runMigration({ workspaceId: 'ws1' })
    expect(fake.state.inserts.projects).toStrictEqual([
      { id: 'p1', title: 'Fixture', status: 'active', workspace_id: 'ws1' },
    ])
  })
})

describe('an asset goes up without its level and experience links (VW1e, 0099)', () => {
  // The runner carries no levels or experiences (NOT_CARRIED): the ids would
  // name rows the cloud does not have. Before 0099 the cloud had no such
  // column, and the asset was refused whole (PGRST204).
  function servesLinkedAsset() {
    globalThis.fetch = vi.fn(async (url) => {
      if (url === '/api/rabbit/projects') return { ok: true, json: async () => [{ id: 'p1', title: 'Fixture' }] }
      if (url === '/api/rabbit/projects/p1') {
        return { ok: true, json: async () => ({ ...bundle(), assets: [{ id: 'a1', project_id: 'p1', name: 'Lantern', scene_ids: ['sc1'], shot_ids: [], level_ids: ['lv1'], experience_ids: ['x1'] }] }) }
      }
      return { ok: false, status: 404 }
    })
    fake.state.failWith = (table, row) => (table === 'assets' && ('level_ids' in row || 'experience_ids' in row))
      ? { code: 'PGRST204', message: "Could not find the 'level_ids' column of 'assets' in the schema cache" }
      : null
  }

  it('sends the asset with its scene and shot links and without its level and experience links', async () => {
    servesLinkedAsset()
    const report = await runMigration({ workspaceId: 'ws1' })
    expect(report.assets).toEqual({ total: 1, inserted: 1, skipped: 0, failed: 0, linksLeftBehind: 1 })
    expect(fake.state.inserts.assets).toStrictEqual([{ id: 'a1', project_id: 'p1', name: 'Lantern', scene_ids: ['sc1'], shot_ids: [] }])
    // Said: the asset's links to levels stay on this computer.
    expect(report.notCarried).toContainEqual({ key: 'assetLevelLinks', count: 1, label: "asset's links to levels or experiences", part2: true })
  })

  it('the dry run counts the same, and writes nothing', async () => {
    servesLinkedAsset()
    const report = await runMigration({ workspaceId: 'ws1', dryRun: true })
    expect(report.assets.linksLeftBehind).toBe(1)
    expect(report.notCarried).toContainEqual(expect.objectContaining({ key: 'assetLevelLinks', count: 1 }))
    expect(fake.state.inserts.assets || []).toEqual([])
  })

  it('assetRowForCloud leaves every other key alone, and a row without links as it is', () => {
    expect(assetRowForCloud({ id: 'a1', name: 'A', level_ids: [], experience_ids: ['x'] })).toEqual({ id: 'a1', name: 'A' })
    expect(assetRowForCloud({ id: 'a2', name: 'B' })).toEqual({ id: 'a2', name: 'B' })
    expect(assetRowForCloud(null)).toBe(null)
  })
})

describe('the dry run reports the links it would write and writes nothing', () => {
  it('counts task links and phase links alongside the other tables', async () => {
    const notes = []
    const report = await runMigration({ workspaceId: 'ws1', dryRun: true, onProgress: (m) => notes.push(m) })
    expect(report.dryRun).toBe(true)
    expect(fake.state.log).toEqual([])
    expect(report.taskLinks.total).toBe(3)
    expect(report.phaseLinks.total).toBe(1)
    expect(report.phases.total).toBe(2)
    expect(report.tasks.total).toBe(3)
    expect(notes.some(m => /3 task links, 1 phase link\b/.test(m))).toBe(true)
  })

  it('pluralises the note honestly', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (url === '/api/rabbit/projects')    return { ok: true, json: async () => [{ id: 'p1', title: 'Fixture' }] }
      if (url === '/api/rabbit/projects/p1') {
        const b = bundle()
        b.dependencies = [b.dependencies[0]]
        return { ok: true, json: async () => b }
      }
      return { ok: false, status: 404 }
    })
    const notes = []
    await runMigration({ workspaceId: 'ws1', dryRun: true, onProgress: (m) => notes.push(m) })
    expect(notes.some(m => /1 task link, 0 phase links/.test(m))).toBe(true)
  })

  it('reports zero links, not a missing bucket, for a project with no edges', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (url === '/api/rabbit/projects')    return { ok: true, json: async () => [{ id: 'p1', title: 'Fixture' }] }
      if (url === '/api/rabbit/projects/p1') return { ok: true, json: async () => ({ ...bundle(), dependencies: undefined }) }
      return { ok: false, status: 404 }
    })
    const report = await runMigration({ workspaceId: 'ws1' })
    expect(report.taskLinks).toEqual({ total: 0, inserted: 0, skipped: 0, failed: 0 })
    expect(report.phaseLinks).toEqual({ total: 0, inserted: 0, skipped: 0, failed: 0 })
    expect(fake.state.inserts.task_dependencies).toBeUndefined()
  })
})

// ── Post-overhaul S4b, review round 1 (R1-BEH-01): files keep their gate ────
// Every desktop file used to go to projects/{p}/files/{id}/{name} — a third
// segment every project member can read — with its row (and a Legal file's
// tag) inserted after. A Legal file now goes under LEGAL with its tag and is
// never core, and only where the cloud LOCKS that folder (0088); an invoice
// goes under INVOICES. And the body is read from the route that serves it.
describe('files keep their gate on the way to the cloud (S4b)', () => {
  const FILES = [
    { id: 'f-plain', project_id: 'p1', name: 'call sheet.pdf', storage_path: 'f-plain-call_sheet.pdf', storage_provider: 'local_server', tags: ['production'] },
    { id: 'f-label', project_id: 'p1', name: 'notes.pdf', storage_path: 'f-label-notes.pdf', storage_provider: 'local_server', tags: [] },
    { id: 'f-inv', project_id: 'p1', name: 'inv.pdf', storage_path: 'f-inv-inv.pdf', storage_provider: 'local_server', is_financial: true },
    { id: 'f-legal', project_id: 'p1', name: 'nda.pdf', storage_path: 'f-legal-nda.pdf', storage_provider: 'local_server', tags: ['legal', 'creative'], is_core_definer: true },
  ]
  const fetched = []
  beforeEach(() => {
    fetched.length = 0
    globalThis.fetch = vi.fn(async (url) => {
      if (url === '/api/rabbit/projects')    return { ok: true, json: async () => [{ id: 'p1', title: 'Fixture' }] }
      if (url === '/api/rabbit/projects/p1') return { ok: true, json: async () => ({ ...bundle(), files: FILES }) }
      const m = /^\/api\/rabbit\/projects\/p1\/files\/([^/]+)\/download$/.exec(url)
      if (m) { fetched.push(m[1]); return { ok: true, blob: async () => new Blob([`body of ${m[1]}`]) } }
      return { ok: false, status: 404 }
    })
  })
  const rowOf = (id) => (fake.state.inserts.files || []).find(r => r.id === id)

  it('reads each body from /files/:id/download (the route that exists)', async () => {
    await runMigration({ workspaceId: 'ws1' })
    expect(fetched.sort()).toEqual(['f-inv', 'f-label', 'f-legal', 'f-plain'])
  })

  it('a Legal file lands under LEGAL with its tag, never core; an invoice under INVOICES; the rest under files', async () => {
    await runMigration({ workspaceId: 'ws1' })
    expect(rowOf('f-legal').storage_path).toBe('projects/p1/LEGAL/f-legal/nda.pdf')
    expect(rowOf('f-legal').tags).toEqual(['legal', 'creative'])
    expect(rowOf('f-legal').is_core_definer).toBe(false)
    expect(rowOf('f-inv').storage_path).toBe('projects/p1/INVOICES/f-inv/inv.pdf')
    expect(rowOf('f-plain').storage_path).toBe('projects/p1/files/f-plain/call_sheet.pdf')
    expect(fake.state.uploads).toContain('projects/p1/LEGAL/f-legal/nda.pdf')
    expect(fake.state.uploads.filter(u => u.includes('/files/'))).toEqual(['projects/p1/files/f-plain/call_sheet.pdf', 'projects/p1/files/f-label/notes.pdf'])
  })

  it('where the cloud does not lock LEGAL, a Legal file is not migrated at all — its body is not even read — and the report says why', async () => {
    fake.state.legalLocked = false
    const report = await runMigration({ workspaceId: 'ws1' })
    expect(rowOf('f-legal')).toBeUndefined()
    expect(fetched).not.toContain('f-legal')
    expect(fake.state.uploads.some(u => u.includes('nda'))).toBe(false)
    // S4d (0092): the sentence names both migrations — the lock (0088) and the gate (0092).
    expect(report.errors.find(e => e.id === 'f-legal')?.message).toMatch(/^Legal file not migrated: Legal files need a database update \(migrations 0088 and 0092\)/)
    // CONTROL: the others still go.
    expect(rowOf('f-plain')).toBeTruthy()
    expect(rowOf('f-inv')).toBeTruthy()
  })

  it('asks the database once per run (the answer is the same for every Legal file)', async () => {
    await runMigration({ workspaceId: 'ws1' })
    expect(fake.state.rpcs.filter(r => r[0] === 'rabbit_money_segment')).toHaveLength(1)
    expect(fake.state.rpcs.filter(r => r[0] === 'can_access_project_legal')).toHaveLength(1)
  })

  it('on a cloud with 0088 but not 0092 (the folder locked, no Legal gate): a Legal file stays, with the same sentence (S4d, review round 2)', async () => {
    fake.state.gateMissing = true
    const report = await runMigration({ workspaceId: 'ws1' })
    expect(rowOf('f-legal')).toBeUndefined()
    expect(fetched).not.toContain('f-legal')
    expect(report.errors.find(e => e.id === 'f-legal')?.message).toMatch(/^Legal file not migrated: Legal files need a database update \(migrations 0088 and 0092\)/)
    // CONTROL: the invoice and the plain file still go — only the Legal gate is missing.
    expect(rowOf('f-plain')).toBeTruthy()
    expect(rowOf('f-inv')).toBeTruthy()
  })
})

// ── Review round 2 (R2-BEH-02, 06, 07; planted faults R2-2, R2-3, R2-9) ─────
describe('what a run cannot do, it says (S4b review round 2)', () => {
  const FILES = [
    { id: 'f-plain', project_id: 'p1', name: 'call sheet.pdf', storage_path: 'f-plain-call_sheet.pdf', storage_provider: 'local_server' },
    { id: 'f-legal', project_id: 'p1', name: 'nda.pdf', storage_path: 'f-legal-nda.pdf', storage_provider: 'local_server', tags: ['legal'] },
  ]
  let bodyStatus
  beforeEach(() => {
    bodyStatus = {}
    globalThis.fetch = vi.fn(async (url) => {
      if (url === '/api/rabbit/projects')    return { ok: true, json: async () => [{ id: 'p1', title: 'Fixture' }] }
      if (url === '/api/rabbit/projects/p1') return { ok: true, json: async () => ({ ...bundle(), files: FILES }) }
      const m = /^\/api\/rabbit\/projects\/p1\/files\/([^/]+)\/download$/.exec(url)
      if (m) {
        const status = bodyStatus[m[1]] ?? 200
        return status === 200
          ? { ok: true, status, blob: async () => new Blob([`body of ${m[1]}`]) }
          : { ok: false, status }
      }
      return { ok: false, status: 404 }
    })
  })
  const rowOf = (id) => (fake.state.inserts.files || []).find(r => r.id === id)

  it('a body the desktop cannot read is a FAILURE with its reason — never "skipped" (R2-BEH-02)', async () => {
    bodyStatus['f-plain'] = 410
    const report = await runMigration({ workspaceId: 'ws1' })
    expect(rowOf('f-plain')).toBeUndefined()
    expect(report.files.failed).toBe(1)
    expect(report.errors.find(e => e.id === 'f-plain')?.message).toBe('the file\'s body could not be read on this computer (HTTP 410)')
  })

  it('a Legal file left behind counts as skipped, beside its reason (R2-9)', async () => {
    fake.state.legalLocked = false
    const report = await runMigration({ workspaceId: 'ws1' })
    expect(report.files).toMatchObject({ total: 2, inserted: 1, skipped: 1, failed: 0 })
  })

  it('a probe that ERRORS is "not locked": the Legal file stays behind (fail closed, R2-2)', async () => {
    fake.state.rpcError = { message: 'boom' }
    const report = await runMigration({ workspaceId: 'ws1' })
    expect(rowOf('f-legal')).toBeUndefined()
    expect(fake.state.uploads.some(u => u.includes('nda'))).toBe(false)
    expect(report.errors.some(e => e.id === 'f-legal')).toBe(true)
  })

  it('a file already in the cloud is not uploaded again; at an older path, the report says so (R2-BEH-06)', async () => {
    fake.state.existing.files = {
      'f-plain': { id: 'f-plain', storage_path: 'projects/p1/files/f-plain/call_sheet.pdf' },
      'f-legal': { id: 'f-legal', storage_path: 'projects/p1/files/f-legal/nda.pdf' },
    }
    const report = await runMigration({ workspaceId: 'ws1' })
    expect(fake.state.uploads).toEqual([])
    expect(report.files).toMatchObject({ skipped: 2, inserted: 0 })
    // Same path: nothing to say. An older path (the Legal file migrated by the
    // pre-S4b code under files/): said, so the run is not called clean.
    expect(report.errors.find(e => e.id === 'f-plain')).toBeUndefined()
    expect(report.errors.find(e => e.id === 'f-legal')?.message).toMatch(/^already in the cloud at an older path \(projects\/p1\/files\/f-legal\/nda\.pdf\)/)
  })

  it('the existence check asks by id (planted fault R3-1), and an ERROR fails the file rather than uploading on a guess (R3-BEH-02)', async () => {
    fake.state.selectError = { message: 'network down' }
    const report = await runMigration({ workspaceId: 'ws1' })
    expect(fake.state.eqColumns).toContain('id')
    expect(fake.state.eqColumns.every(c => c === 'id')).toBe(true)
    expect(fake.state.uploads).toEqual([])
    expect(report.files.failed).toBe(2)
    expect(report.errors.find(e => e.id === 'f-plain')?.message).toBe('could not check whether the file is already in the cloud: network down')
  })

  it('the dry run says what will happen to Legal files, asked of the same database (R2-BEH-07)', async () => {
    const lines = []
    const report = await runMigration({ workspaceId: 'ws1', dryRun: true, onProgress: (m) => lines.push(m) })
    expect(lines).toContain("  1 Legal file will go to the cloud's locked LEGAL folder")
    expect(report.legalFiles).toBe(1)
    fake.state.legalLocked = false
    const later = []
    await runMigration({ workspaceId: 'ws1', dryRun: true, onProgress: (m) => later.push(m) })
    expect(later.some(l => l.startsWith('  1 Legal file will stay on this computer: Legal files need a database update (migrations 0088 and 0092)'))).toBe(true)
    expect(fake.state.uploads).toEqual([])
    expect(fake.state.inserts).toEqual({})
  })
})

// Post-overhaul S5b (0090): a desktop row set aside by an open bid version
// arrives LIVE — bid versions are not copied, so nothing on the cloud could
// ever bring a set-aside row back.
describe('set-aside desktop rows arrive live on the cloud', () => {
  it('the stamp is dropped from every phase and task insert; the rows themselves are copied whole', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (url === '/api/rabbit/projects')    return { ok: true, json: async () => [{ id: 'p1', title: 'Fixture' }] }
      if (url === '/api/rabbit/projects/p1') {
        const b = bundle()
        b.tasks[1] = { ...b.tasks[1], title: 'Aside', set_aside_at: '2026-10-05T10:00:00Z' }
        b.phases[1] = { ...b.phases[1], set_aside_at: '2026-10-05T10:00:00Z' }
        return { ok: true, json: async () => b }
      }
      return { ok: false, status: 404 }
    })
    await runMigration({ workspaceId: 'ws1' })
    const ins = fake.state.inserts
    expect(ins.tasks.find(t => t.id === 't2')).toMatchObject({ id: 't2', title: 'Aside' })
    for (const row of [...ins.tasks, ...ins.phases]) expect(row).not.toHaveProperty('set_aside_at')
    expect(ins.tasks).toHaveLength(3)
    expect(ins.phases).toHaveLength(2)
  })
})

// FX2 (0096): a task's items move with the project — after the rows they name,
// keeping their ids and positions; a level's item stays (levels are not
// carried). VW1m (2026-10-16): EVERY item goes up as an item, the assets
// included, and the task row carries no link field at all; an item the cloud
// already holds (a move run again) answers 23505 and reads as skipped.
describe("a task's items move with the project (FX2)", () => {
  it('lands asset items after the tasks and assets, skips one already there, fails a refused one, leaves level items behind', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (url === '/api/rabbit/projects')    return { ok: true, json: async () => [{ id: 'p1', title: 'Fixture' }] }
      if (url === '/api/rabbit/projects/p1') {
        const b = bundle()
        b.assets = [{ id: 'a1', project_id: 'p1', name: 'A1' }, { id: 'a2', project_id: 'p1', name: 'A2' }]
        b.taskItems = [
          { id: 'i1', task_id: 't1', project_id: 'p1', entity_type: 'asset', entity_id: 'a1', position: 0, created_at: '2026-10-11T00:00:00Z' },
          { id: 'i2', task_id: 't1', project_id: 'p1', entity_type: 'asset', entity_id: 'a2', position: 1, created_at: '2026-10-11T00:00:00Z' },
          { id: 'i3', task_id: 't2', project_id: 'p1', entity_type: 'asset', entity_id: 'a9', position: 0 },
          { id: 'i4', task_id: 't1', project_id: 'p1', entity_type: 'level', entity_id: 'l1', position: 0 },
        ]
        return { ok: true, json: async () => b }
      }
      return { ok: false, status: 404 }
    })
    fake.state.failWith = (table, row) => {
      if (table === 'task_items' && row.id === 'i1') return { code: '23505', message: 'duplicate key value violates unique constraint "task_items_task_entity_key"' }
      if (table === 'task_items' && row.id === 'i3') return { code: '23503', message: 'violates foreign key constraint "task_items_asset_fk"' }
      return null
    }
    const report = await runMigration({ workspaceId: 'ws1' })
    expect(report.taskItems).toEqual({ total: 4, inserted: 1, skipped: 1, failed: 1, leftBehind: 1 })
    const landed = fake.state.inserts.task_items
    expect(landed).toEqual([{ id: 'i2', task_id: 't1', project_id: 'p1', entity_type: 'asset', entity_id: 'a2', position: 1, created_at: '2026-10-11T00:00:00Z' }])
    const log = fake.state.log
    expect(log.indexOf('task_items')).toBeGreaterThan(log.lastIndexOf('tasks'))
    expect(log.indexOf('task_items')).toBeGreaterThan(log.lastIndexOf('assets'))
    expect(report.errors.map(e => [e.scope, e.id])).toEqual([['task_item', 'i3']])
  })

  // VW1m (2026-10-16): the row's asset_id was the older builds' copy of the
  // first asset, and tasks.asset_id's key refused the whole task when that
  // asset had not gone up. Now the task lands, and only that asset's item
  // fails. The fake refuses exactly what the cloud's keys refuse.
  it('VW1m: a task whose first asset failed no longer fails whole; that asset\'s item fails alone and the next lands', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (url === '/api/rabbit/projects')    return { ok: true, json: async () => [{ id: 'p1', title: 'Fixture' }] }
      if (url === '/api/rabbit/projects/p1') {
        const b = bundle()
        b.assets = [{ id: 'a1', project_id: 'p1', name: 'A1' }, { id: 'a2', project_id: 'p1', name: 'A2' }]
        b.tasks[0] = { ...b.tasks[0], asset_id: 'a1' }
        b.taskItems = [
          { id: 'i1', task_id: 't1', project_id: 'p1', entity_type: 'asset', entity_id: 'a1', position: 0 },
          { id: 'i2', task_id: 't1', project_id: 'p1', entity_type: 'asset', entity_id: 'a2', position: 1 },
        ]
        return { ok: true, json: async () => b }
      }
      return { ok: false, status: 404 }
    })
    const landed = (t, id) => (fake.state.inserts[t] || []).some(r => r.id === id)
    fake.state.failWith = (table, row) => {
      if (table === 'assets' && row.id === 'a1') return { code: '23514', message: 'new row for relation "assets" violates check constraint "assets_status_check"' }
      if (table === 'tasks' && row.asset_id && !landed('assets', row.asset_id)) return { code: '23503', message: 'insert or update on table "tasks" violates foreign key constraint "tasks_asset_id_fkey"' }
      if (table === 'task_items' && row.entity_type === 'asset' && !landed('assets', row.entity_id)) return { code: '23503', message: 'insert or update on table "task_items" violates foreign key constraint "task_items_asset_fk"' }
      return null
    }
    const report = await runMigration({ workspaceId: 'ws1' })
    expect(report.assets).toMatchObject({ inserted: 1, failed: 1 })
    expect(report.tasks).toMatchObject({ total: 3, inserted: 3, failed: 0 })
    expect(fake.state.inserts.tasks.find(t => t.id === 't1')).not.toHaveProperty('asset_id')
    expect(report.taskItems).toMatchObject({ total: 2, inserted: 1, failed: 1 })
    expect(fake.state.inserts.task_items.map(i => `${i.task_id}:${i.entity_id}`)).toEqual(['t1:a2'])
    expect(report.errors.filter(e => e.scope === 'task' || e.scope === 'task_item').map(e => [e.scope, e.id])).toEqual([['task_item', 'i1']])
  })

  it('VW1m: an asset a task row names and no item does (a bundle no Local Server reconciled) is carried as an item', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (url === '/api/rabbit/projects')    return { ok: true, json: async () => [{ id: 'p1', title: 'Fixture' }] }
      if (url === '/api/rabbit/projects/p1') {
        const b = bundle()
        b.assets = [{ id: 'a1', project_id: 'p1', name: 'A1' }]
        b.tasks[1] = { ...b.tasks[1], asset_id: 'a1' }
        return { ok: true, json: async () => b }
      }
      return { ok: false, status: 404 }
    })
    const report = await runMigration({ workspaceId: 'ws1' })
    for (const t of fake.state.inserts.tasks) expect(t, t.id).not.toHaveProperty('asset_id')
    expect(fake.state.inserts.task_items).toEqual([{ task_id: 't2', project_id: 'p1', entity_type: 'asset', entity_id: 'a1', position: 0 }])
    expect(report.taskItems).toMatchObject({ total: 1, inserted: 1, failed: 0 })
  })

  // Review round 1, R1-2: the tasks land before the scenes and shots (BC3),
  // tasks_scene_fk / tasks_shot_fk are not deferrable, and the cloud has no
  // level or experience column; FX2's desktop wrote all five keys on a task.
  // The fake refuses exactly what the cloud does. VW1m: the asset goes the
  // same way (above).
  it('R1-2: a task goes up without its scene, shot, level and experience links; its scene and shot land as items after the shots', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (url === '/api/rabbit/projects')    return { ok: true, json: async () => [{ id: 'p1', title: 'Fixture' }] }
      if (url === '/api/rabbit/projects/p1') {
        const b = bundle()
        b.scenes = [{ id: 's1', project_id: 'p1', name: 'S1' }]
        b.shots = [{ id: 'h1', project_id: 'p1', scene_id: 's1', name: 'H1' }]
        b.tasks[0] = { ...b.tasks[0], scene_id: 's1', shot_id: 'h1', level_id: null, experience_id: null }
        // A scene on the row and in no item (a bundle no Local Server reconciled).
        b.tasks[1] = { ...b.tasks[1], scene_id: 's1' }
        b.taskItems = [
          { id: 'i1', task_id: 't1', project_id: 'p1', entity_type: 'scene', entity_id: 's1', position: 0 },
          { id: 'i2', task_id: 't1', project_id: 'p1', entity_type: 'shot', entity_id: 'h1', position: 0 },
        ]
        return { ok: true, json: async () => b }
      }
      return { ok: false, status: 404 }
    })
    fake.state.failWith = (table, row) => {
      if (table !== 'tasks') return null
      if ('level_id' in row || 'experience_id' in row) return { code: 'PGRST204', message: "Could not find the 'level_id' column of 'tasks' in the schema cache" }
      const landed = (t, id) => (fake.state.inserts[t] || []).some(r => r.id === id)
      if (row.scene_id && !landed('scenes', row.scene_id)) return { code: '23503', message: 'insert or update on table "tasks" violates foreign key constraint "tasks_scene_fk"' }
      if (row.shot_id && !landed('shots', row.shot_id)) return { code: '23503', message: 'insert or update on table "tasks" violates foreign key constraint "tasks_shot_fk"' }
      return null
    }
    const report = await runMigration({ workspaceId: 'ws1' })
    // (This fake cannot answer the paged read of what the cloud holds, which
    // the scenes and shots say as their own errors; the tasks and items none.)
    expect(report.errors.filter(e => e.scope === 'task' || e.scope === 'task_item')).toEqual([])
    expect(fake.state.inserts.tasks).toHaveLength(3)
    for (const t of fake.state.inserts.tasks) {
      for (const f of ['asset_id', 'scene_id', 'shot_id', 'level_id', 'experience_id']) expect(t, `${t.id}.${f}`).not.toHaveProperty(f)
    }
    expect(fake.state.inserts.task_items.map(i => `${i.task_id}:${i.entity_type}:${i.entity_id}`))
      .toEqual(['t1:scene:s1', 't1:shot:h1', 't2:scene:s1'])
    expect(report.taskItems).toMatchObject({ total: 3, inserted: 3, failed: 0 })
    const log = fake.state.log
    expect(log.indexOf('task_items')).toBeGreaterThan(log.lastIndexOf('shots'))
  })

  it('the dry run counts the items and the ones that stay', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (url === '/api/rabbit/projects')    return { ok: true, json: async () => [{ id: 'p1', title: 'Fixture' }] }
      if (url === '/api/rabbit/projects/p1') {
        const b = bundle()
        b.taskItems = [
          { id: 'i1', task_id: 't1', project_id: 'p1', entity_type: 'asset', entity_id: 'a1', position: 0 },
          { id: 'i2', task_id: 't1', project_id: 'p1', entity_type: 'experience', entity_id: 'x1', position: 0 },
        ]
        return { ok: true, json: async () => b }
      }
      return { ok: false, status: 404 }
    })
    const report = await runMigration({ workspaceId: 'ws1', dryRun: true })
    expect(report.taskItems).toMatchObject({ total: 2, leftBehind: 1 })
    expect(fake.state.inserts.task_items).toBeUndefined()
  })
})

// VW1c (0098): a project's saved views and groupings move with it — with
// their ids, by INSERT through the cloud adapter (its column allowlist: the
// desktop's revision and stamps stay behind, the cloud makes its own), after
// the scenes and shots they may name. A second run finds them there and skips
// them; a grouping of levels or experiences stays (the move carries neither),
// counted and named; a view that filters by one goes, counted (its filter
// matches nothing up there). A cloud without 0098 takes none, says so once,
// and the run is not done.
describe('saved views and groupings move with the project (VW1c, 0098)', () => {
  const STAMPS = { revision: 41, revised_by: 'desk', created_at: '2026-10-17T09:00:00.000Z', created_by: null, updated_at: '2026-10-17T09:00:00.000Z', updated_by: null }
  const V1 = { id: 'v1', project_id: 'p1', table_key: 'tasks', name: 'Shoot week', position: 0, config: { version: 1, filters: [{ field: 'status', op: 'is', values: ['blocked'] }] }, ...STAMPS }
  const V2 = { id: 'v2', project_id: 'p1', table_key: 'assets', name: 'By level', position: 0, config: { version: 1, filters: [{ field: 'level', op: 'is', values: ['l1'] }] }, ...STAMPS }
  const G1 = { id: 'g1', project_id: 'p1', table_key: 'tasks', kind: 'scene', entity_ids: ['s1'], created_at: STAMPS.created_at, created_by: null }
  const G2 = { id: 'g2', project_id: 'p1', table_key: 'levels', kind: 'asset', entity_ids: ['a1'], created_at: STAMPS.created_at, created_by: null }
  const G3 = { id: 'g3', project_id: 'p1', table_key: 'tasks', kind: 'level', entity_ids: ['l1', 'l2'], created_at: STAMPS.created_at, created_by: null }
  function serves(extra = {}) {
    globalThis.fetch = vi.fn(async (url) => {
      if (url === '/api/rabbit/projects')    return { ok: true, json: async () => [{ id: 'p1', title: 'Fixture' }] }
      if (url === '/api/rabbit/projects/p1') {
        return { ok: true, json: async () => ({
          ...bundle(),
          assets: [{ id: 'a1', project_id: 'p1', name: 'A1' }],
          scenes: [{ id: 's1', project_id: 'p1', name: 'S1' }],
          shots: [{ id: 'h1', project_id: 'p1', scene_id: 's1', name: 'H1' }],
          tableViews: [V1, V2],
          itemGroupings: [G1, G2, G3],
          ...extra,
        }) }
      }
      return { ok: false, status: 404 }
    })
  }
  const viewErrors = (report) => report.errors.filter(e => ['table_view', 'table_views', 'item_grouping'].includes(e.scope))

  it('carried with their ids by INSERT through the adapter — the granted columns only — after the assets, scenes and shots', async () => {
    serves()
    const report = await runMigration({ workspaceId: 'ws1' })
    expect(viewErrors(report)).toEqual([])
    expect(fake.state.inserts.table_views).toEqual([
      { id: 'v1', project_id: 'p1', table_key: 'tasks', name: 'Shoot week', position: 0, config: V1.config },
      { id: 'v2', project_id: 'p1', table_key: 'assets', name: 'By level', position: 0, config: V2.config },
    ])
    expect(fake.state.inserts.item_groupings).toEqual([
      { id: 'g1', project_id: 'p1', table_key: 'tasks', kind: 'scene', entity_ids: ['s1'] },
      { id: 'g2', project_id: 'p1', table_key: 'levels', kind: 'asset', entity_ids: ['a1'] },
    ])
    const log = fake.state.log
    for (const before of ['assets', 'scenes', 'shots', 'task_items']) {
      if (log.includes(before)) expect(log.indexOf('item_groupings'), before).toBeGreaterThan(log.lastIndexOf(before))
    }
    expect(log.indexOf('item_groupings')).toBeGreaterThan(log.lastIndexOf('shots'))
    // The desktop's revision and stamps stay behind without a word.
    expect(warn.mock.calls.filter(c => /table_views|item_groupings/.test(c[0]))).toEqual([])
    expect(report.tableViews).toEqual({ total: 2, inserted: 2, skipped: 0, failed: 0, filtersLeftBehind: 1 })
    expect(report.itemGroupings).toEqual({ total: 3, inserted: 2, skipped: 0, failed: 0, leftBehind: 1 })
    // The grouping of levels stays, and is named before the archive is offered.
    expect(report.notCarried).toContainEqual({ key: 'levelGroupings', label: 'grouping of levels or experiences', count: 1, part2: true })
  })

  it('a second run finds them already there and counts them skipped, writing nothing', async () => {
    serves()
    await runMigration({ workspaceId: 'ws1' })
    fake.state.inserts = {}
    fake.state.log = []
    const again = await runMigration({ workspaceId: 'ws1' })
    expect(fake.state.log.filter(t => t === 'table_views' || t === 'item_groupings')).toEqual([])
    expect(again.tableViews).toEqual({ total: 2, inserted: 0, skipped: 2, failed: 0, filtersLeftBehind: 1 })
    expect(again.itemGroupings).toEqual({ total: 3, inserted: 0, skipped: 2, failed: 0, leftBehind: 1 })
    expect(viewErrors(again)).toEqual([])
  })

  it('a grouping whose set the cloud holds under another id (a teammate made it) is skipped: the cloud answers its row', async () => {
    serves()
    fake.state.cloud.item_groupings = [{ id: 'theirs', project_id: 'p1', table_key: 'tasks', kind: 'scene', entity_ids: ['s1'], created_by: 'mara' }]
    fake.state.failWith = (table, row) => (table === 'item_groupings' && fake.state.cloud.item_groupings.some(g => g.id !== row.id && g.table_key === row.table_key && g.kind === row.kind && g.entity_ids.join() === [...row.entity_ids].sort().join())
      ? { code: '23505', message: 'duplicate key value violates unique constraint "item_groupings_set_key"' } : null)
    const report = await runMigration({ workspaceId: 'ws1' })
    expect(report.itemGroupings).toEqual({ total: 3, inserted: 1, skipped: 1, failed: 0, leftBehind: 1 })
    expect(viewErrors(report)).toEqual([])
  })

  it('a refused one fails alone, in the adapter\'s words; an id another project\'s row holds is said so', async () => {
    serves({ tableViews: [{ ...V1, name: 'Tab\there' }, V2] })
    fake.state.failWith = (table, row) => {
      if (table === 'table_views' && row.id === 'v1') return { code: '23514', message: 'new row for relation "table_views" violates check constraint "table_views_name_chk"' }
      if (table === 'table_views' && row.id === 'v2') return { code: '23505', message: 'duplicate key value violates unique constraint "table_views_pkey"' }
      if (table === 'item_groupings' && row.id === 'g1') return { code: '23503', message: 'A grouping can name only this project\'s own scenes: 1 of the 1 named are not in it (or are in the trash).' }
      return null
    }
    const report = await runMigration({ workspaceId: 'ws1' })
    expect(viewErrors(report)).toEqual([
      { scope: 'table_view', projectId: 'p1', id: 'v1', message: `table_views: ${viewNameProblem('Tab\there')}` },
      { scope: 'table_view', projectId: 'p1', id: 'v2', message: 'table_views: a row with this id is in the cloud but is not this project\'s, so nothing was written for it ([supabase] duplicate key value violates unique constraint "table_views_pkey")' },
      { scope: 'item_grouping', projectId: 'p1', id: 'g1', message: 'item_groupings: A grouping can name only this project\'s own scenes: 1 of the 1 named are not in it (or are in the trash).' },
    ])
    expect(report.tableViews).toMatchObject({ total: 2, inserted: 0, failed: 2 })
    expect(report.itemGroupings).toMatchObject({ total: 3, inserted: 1, failed: 1, leftBehind: 1 })
  })

  it('a cloud without 0098 takes none of them: said once, counted failed (so the run is not done), nothing written', async () => {
    serves()
    const missing = (t) => ({ code: 'PGRST205', message: `Could not find the table 'public.${t}' in the schema cache` })
    fake.state.viewsReadError = { table_views: missing('table_views'), item_groupings: missing('item_groupings') }
    const report = await runMigration({ workspaceId: 'ws1' })
    expect(viewErrors(report)).toEqual([{ scope: 'table_views', projectId: 'p1', message: TABLE_VIEWS_NOT_IN_CLOUD(2, 2) }])
    expect(TABLE_VIEWS_NOT_IN_CLOUD(2, 2)).toMatch(/migration 0098/)
    expect(report.tableViews).toEqual({ total: 2, inserted: 0, skipped: 0, failed: 2, filtersLeftBehind: 1 })
    expect(report.itemGroupings).toEqual({ total: 3, inserted: 0, skipped: 0, failed: 2, leftBehind: 1 })
    expect(fake.state.inserts.table_views).toBeUndefined()
    expect(fake.state.inserts.item_groupings).toBeUndefined()
  })

  it('a read of what the cloud holds that fails writes none either, and says why', async () => {
    serves()
    fake.state.viewsReadError = { item_groupings: { code: '57014', message: 'canceling statement due to statement timeout' } }
    const report = await runMigration({ workspaceId: 'ws1' })
    expect(viewErrors(report)).toEqual([{ scope: 'table_views', projectId: 'p1', message: TABLE_VIEWS_UNREAD('[supabase] canceling statement due to statement timeout') }])
    expect(report.tableViews.failed).toBe(2)
    expect(fake.state.inserts.table_views).toBeUndefined()
  })

  it('the dry run counts what would go, what is there and what stays, and writes nothing', async () => {
    serves()
    fake.state.cloud.table_views = [{ ...V1, revision: 3 }]
    const notes = []
    const report = await runMigration({ workspaceId: 'ws1', dryRun: true, onProgress: (m) => notes.push(m) })
    expect(report.tableViews).toEqual({ total: 2, inserted: 1, skipped: 1, failed: 0, filtersLeftBehind: 1 })
    expect(report.itemGroupings).toEqual({ total: 3, inserted: 2, skipped: 0, failed: 0, leftBehind: 1 })
    expect(report.notCarried).toContainEqual({ key: 'levelGroupings', label: 'grouping of levels or experiences', count: 1, part2: true })
    expect(fake.state.log).toEqual([])
    expect(notes).toContain('  2 saved views and 3 groupings; 1 grouping of levels or experiences stays on this computer')
  })

  it('CONTROL: a project with none reads nothing of them, and counts zeros', async () => {
    const report = await runMigration({ workspaceId: 'ws1' })
    expect(report.tableViews).toEqual({ total: 0, inserted: 0, skipped: 0, failed: 0, filtersLeftBehind: 0 })
    expect(report.itemGroupings).toEqual({ total: 0, inserted: 0, skipped: 0, failed: 0, leftBehind: 0 })
    expect(fake.state.log.filter(t => t === 'table_views' || t === 'item_groupings')).toEqual([])
    expect(report.notCarried.find(n => n.key === 'levelGroupings')).toBeUndefined()
  })

  it('which views count: a complete filter by a level or an experience; never a malformed config', () => {
    const v = (filters) => ({ table_key: 'tasks', config: { version: 1, filters } })
    expect(viewFiltersLeftBehind(v([{ field: 'level', op: 'is', values: ['l1'] }]))).toBe(true)
    expect(viewFiltersLeftBehind(v([{ field: 'experience', op: 'is_empty' }]))).toBe(true)
    expect(viewFiltersLeftBehind(v([{ field: 'level', op: 'is', values: [] }]))).toBe(false) // incomplete: never stored, never read
    expect(viewFiltersLeftBehind(v([{ field: 'scene', op: 'is', values: ['s1'] }]))).toBe(false)
    expect(viewFiltersLeftBehind({ table_key: 'tasks', config: 'not an object' })).toBe(false)
    expect(VIEW_FILTERS_LEFT_BEHIND(1)).toBe('1 saved view filters by a level or an experience, which the migration does not carry: in the cloud that filter matches nothing')
    expect(VIEW_FILTERS_LEFT_BEHIND(2)).toMatch(/^2 saved views filter by .* those filters match nothing$/)
  })
})
