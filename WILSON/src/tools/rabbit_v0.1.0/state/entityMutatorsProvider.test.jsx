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

// The two kinds the factory makes alike: levels and (review round 1, 1D-03)
// experiences, which no suite drove through the provider.
const KINDS = [
  { Kind: 'Level', col: 'levels', first: 'l1' },
  { Kind: 'Experience', col: 'experiences', first: 'x1' },
]

function makeAdapter() {
  const clone = (x) => JSON.parse(JSON.stringify(x))
  const db = {
    project: { id: 'p1', title: 'Salt Hours', levels_enabled: true },
    levels: [{ id: 'l1', project_id: 'p1', name: 'Harbour', status: 'in_progress', sort_order: 0 }],
    experiences: [{ id: 'x1', project_id: 'p1', name: 'Harbour', status: 'in_progress', sort_order: 0 }],
  }
  const calls = []
  const adapter = {
    mode: 'local_server', calls, db, refuse: false,
    status: async () => ({ online: true, lastSyncAt: null }),
    listProjects: async () => [clone(db.project)],
    loadProject: async () => clone({ project: db.project, levels: db.levels, experiences: db.experiences, shotLists: [], shotListItems: [], edits: [] }),
    listShotLists: async () => [],
    listShotListItems: async () => [],
  }
  for (const { Kind, col } of KINDS) {
    adapter[`upsert${Kind}`] = async function upsert(row) {
      calls.push([`upsert${Kind}`, clone(row)])
      if (adapter.refuse) throw new Error(`new row violates row-level security policy for table "${col}"`)
      db[col] = [...db[col].filter(l => l.id !== row.id), clone(row)]
      return clone(row)
    }
    adapter[`delete${Kind}`] = async function remove(id, projectId) {
      calls.push([`delete${Kind}`, id, projectId])
      db[col] = db[col].filter(l => l.id !== id)
    }
  }
  return adapter
}

let ctxRef
function Probe() { ctxRef = useRabbit(); return null }
async function mount() {
  await mountRabbit(<RabbitProvider><Probe /></RabbitProvider>, { adapter: holder.adapter, ctx: () => ctxRef, until: [
    () => expect(ctxRef?.project?.id).toBe('p1'),
    () => expect(ctxRef.levels.map(l => l.id)).toEqual(['l1']),
    () => expect(ctxRef.experiences.map(l => l.id)).toEqual(['x1']),
  ] })
}

beforeEach(() => { holder.adapter = makeAdapter() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe.each(KINDS)('the $col writers through the provider', ({ Kind, col, first }) => {
  it(`one added twice with one id (an undo replayed beside another) is one row`, async () => {
    await mount()
    await act(async () => { await ctxRef[`add${Kind}`]({ id: 'n9', name: 'Night' }) })
    await act(async () => { await ctxRef[`add${Kind}`]({ id: 'n9', name: 'Night' }) })
    expect(ctxRef[col].filter(l => l.id === 'n9')).toHaveLength(1)
  })
  it('an add: one upsert of the row at the end; Ctrl+Z deletes it through the adapter, with the project', async () => {
    await mount()
    await act(async () => { await ctxRef[`add${Kind}`]({ name: 'Night' }) })
    const [, row] = holder.adapter.calls.find(c => c[0] === `upsert${Kind}`)
    expect([row.project_id, row.sort_order, row.name]).toEqual(['p1', 1, 'Night'])
    expect(ctxRef[col].map(l => l.name)).toEqual(['Harbour', 'Night'])
    await act(async () => { await ctxRef.undo() })
    expect(holder.adapter.calls.at(-1)).toEqual([`delete${Kind}`, row.id, 'p1'])
    expect(ctxRef[col].map(l => l.name)).toEqual(['Harbour'])
  })
  it('a refused rename (the database\'s gate) puts the screen back, says why, and leaves nothing to undo', async () => {
    await mount()
    holder.adapter.refuse = true
    await act(async () => { await ctxRef[`update${Kind}`](first, { name: 'Refused' }).catch(() => {}) })
    expect(ctxRef[col].map(l => l.name)).toEqual(['Harbour'])
    expect(ctxRef.error).toMatch(/row-level security/)
    expect(ctxRef.canUndo).toBe(false)
  })
})
