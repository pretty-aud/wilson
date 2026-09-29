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
  const state = { inserts: {}, log: [], failWith: null }
  const client = {
    from(table) {
      return {
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
          upload: async () => ({ error: null }),
        }
      },
    },
  }
  return { state, client }
})

vi.mock('../auth/supabaseClient', () => ({ supabase: fake.client }))

const { runMigration } = await import('./runMigration')

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
