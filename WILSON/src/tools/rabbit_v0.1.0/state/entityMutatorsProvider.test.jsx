/** @vitest-environment jsdom */
// =============================================================================
// The four 0040 entities' writers through the REAL RabbitProvider (post-
// overhaul F10, rabbit A7), mounted by N1's shared helper over a counting
// fake adapter (the shot-list provider suite's shape). The factory's own
// cases are entityMutators.test.js; this pins the provider's use of it: the
// rows the adapter sees, the undo, a refused write, and the one rule the
// factory made the same for the four kinds (an add de-duplicates by id: a
// level added twice was two rows before F10).
// =============================================================================

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import React from 'react'
import { cleanup, act } from '@testing-library/react'
import { mountRabbit } from './mountRabbit'

const holder = vi.hoisted(() => ({ adapter: null }))
vi.mock('../adapters', () => ({
  selectAdapter: () => holder.adapter,
  ADAPTER_MODES: ['supabase', 'local_server', 'google_drive'],
  adapterSupportsWrites: () => true,
}))
vi.mock('../adapters/supabaseAdapter', () => ({ resetSupabaseAdapter: () => {} }))
vi.mock('../../../cloud/auth/supabaseClient', () => ({
  supabase: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), getSession: async () => ({ data: { session: null } }) } },
}))
vi.mock('../../../lib/localData', () => ({
  hasLocalServer: () => true,
  loadOtterSettings: async () => ({ rabbit: { adapterMode: 'local_server', activeProjectId: 'p1' } }),
  saveOtterSettings: async () => {},
}))
vi.mock('../../../dev/devFixtures', () => ({ devFixtures: () => null }))
vi.mock('../intake/pipeline', () => ({ runIngestion: vi.fn() }))

const { RabbitProvider, useRabbit } = await import('./RabbitProvider')

function makeAdapter() {
  const clone = (x) => JSON.parse(JSON.stringify(x))
  const db = {
    project: { id: 'p1', title: 'Salt Hours', levels_enabled: true },
    levels: [{ id: 'l1', project_id: 'p1', name: 'Harbour', status: 'in_progress', sort_order: 0 }],
  }
  const calls = []
  return {
    mode: 'local_server', calls, db, refuse: false,
    status: async () => ({ online: true, lastSyncAt: null }),
    listProjects: async () => [clone(db.project)],
    loadProject: async () => clone({ project: db.project, levels: db.levels, shotLists: [], shotListItems: [], edits: [] }),
    listShotLists: async () => [],
    listShotListItems: async () => [],
    async upsertLevel(row) {
      calls.push(['upsertLevel', clone(row)])
      if (this.refuse) throw new Error('new row violates row-level security policy for table "levels"')
      db.levels = [...db.levels.filter(l => l.id !== row.id), clone(row)]
      return clone(row)
    },
    async deleteLevel(id, projectId) {
      calls.push(['deleteLevel', id, projectId])
      db.levels = db.levels.filter(l => l.id !== id)
    },
  }
}

let ctxRef
function Probe() { ctxRef = useRabbit(); return null }
async function mount() {
  await mountRabbit(<RabbitProvider><Probe /></RabbitProvider>, { adapter: holder.adapter, ctx: () => ctxRef, until: [
    () => expect(ctxRef?.project?.id).toBe('p1'),
    () => expect(ctxRef.levels.map(l => l.id)).toEqual(['l1']),
  ] })
}

beforeEach(() => { holder.adapter = makeAdapter() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('the levels\' writers through the provider', () => {
  it('a level added twice with one id (an undo replayed beside another) is one row', async () => {
    await mount()
    await act(async () => { await ctxRef.addLevel({ id: 'l9', name: 'Night' }) })
    await act(async () => { await ctxRef.addLevel({ id: 'l9', name: 'Night' }) })
    expect(ctxRef.levels.filter(l => l.id === 'l9')).toHaveLength(1)
  })
  it('an add: one upsert of the row at the end; Ctrl+Z deletes it through the adapter, with the project', async () => {
    await mount()
    await act(async () => { await ctxRef.addLevel({ name: 'Night' }) })
    const [, row] = holder.adapter.calls.find(c => c[0] === 'upsertLevel')
    expect([row.project_id, row.sort_order, row.name]).toEqual(['p1', 1, 'Night'])
    expect(ctxRef.levels.map(l => l.name)).toEqual(['Harbour', 'Night'])
    await act(async () => { await ctxRef.undo() })
    expect(holder.adapter.calls.at(-1)).toEqual(['deleteLevel', row.id, 'p1'])
    expect(ctxRef.levels.map(l => l.name)).toEqual(['Harbour'])
  })
  it('a refused rename (the database\'s gate) puts the screen back, says why, and leaves nothing to undo', async () => {
    await mount()
    holder.adapter.refuse = true
    await act(async () => { await ctxRef.updateLevel('l1', { name: 'Refused' }).catch(() => {}) })
    expect(ctxRef.levels.map(l => l.name)).toEqual(['Harbour'])
    expect(ctxRef.error).toMatch(/row-level security/)
    expect(ctxRef.canUndo).toBe(false)
  })
})
