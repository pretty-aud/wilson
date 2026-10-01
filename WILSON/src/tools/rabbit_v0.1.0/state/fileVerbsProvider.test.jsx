/** @vitest-environment jsdom */
// =============================================================================
// fileVerbsProvider.test.jsx — post-overhaul S4a: the file verbs and the
// project a file belongs to, through the REAL RabbitProvider.
//
// RESOURCES → FILES edits any project's files without opening it. Only the
// OPEN project's rows live in the bundle, and the verbs used to stamp every
// write with the open project's id — which, for another project's file, is the
// wrong URL on the Local Server and, in the cloud, would MOVE the row into the
// open project (project_id is a column). So patchFile / markFileCoreDefiner /
// updateManagedFile take the file's project; omitted, it is the open one,
// exactly as before (the CONTROL).
//
// Mounted the shotListsProvider.test.jsx way: the adapter seam and the
// session are mocked; the provider is real.
// =============================================================================

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, act, waitFor } from '@testing-library/react'

const holder = vi.hoisted(() => ({ adapter: null }))

vi.mock('../adapters', () => ({
  selectAdapter: () => holder.adapter,
  ADAPTER_MODES: ['supabase', 'local_server', 'google_drive'],
  adapterSupportsWrites: () => true,
}))
vi.mock('../adapters/supabaseAdapter', () => ({ resetSupabaseAdapter: () => {} }))
vi.mock('../../../cloud/auth/supabaseClient', () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: null } }),
    },
  },
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
  const calls = []
  const files = [{ id: 'f1', project_id: 'p1', name: 'a.pdf', description: null, tags: [], is_core_definer: false }]
  const managed = [{ id: 'm1', project_id: 'p1', file_name: 'b.mov', notes: '', tags: [] }]
  return {
    mode: 'local_server',
    calls,
    status: async () => ({ online: true, lastSyncAt: null }),
    listProjects: async () => [{ id: 'p1', title: 'One' }, { id: 'p2', title: 'Two' }],
    loadProject: async () => ({ project: { id: 'p1', title: 'One' }, files: files.map(f => ({ ...f })), managedFiles: managed.map(f => ({ ...f })) }),
    updateFile: async (id, patch) => { calls.push(['updateFile', id, patch]); return { id, ...patch } },
    updateManagedFile: async (id, patch) => { calls.push(['updateManagedFile', id, patch]); return { id, ...patch } },
  }
}

let ctxRef
function Probe() { ctxRef = useRabbit(); return null }

beforeEach(() => { holder.adapter = makeAdapter(); ctxRef = null })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

async function mount() {
  render(<RabbitProvider><Probe /></RabbitProvider>)
  await waitFor(() => expect(ctxRef?.project?.id).toBe('p1'))
  await waitFor(() => expect(ctxRef.files.length).toBe(1))
}

describe('the file verbs take the file\'s project (S4a)', () => {
  it('CONTROL: with no project given, the OPEN project — the bundle moves and the write names p1', async () => {
    await mount()
    await act(async () => { await ctxRef.patchFile('f1', { description: 'note' }) })
    expect(holder.adapter.calls).toEqual([['updateFile', 'f1', { description: 'note', project_id: 'p1' }]])
    expect(ctxRef.files[0].description).toBe('note')
  })

  it('another project\'s file: the write names THAT project and the open bundle is untouched', async () => {
    await mount()
    await act(async () => { await ctxRef.patchFile('f9', { tags: ['shots'] }, 'p2') })
    expect(holder.adapter.calls).toEqual([['updateFile', 'f9', { tags: ['shots'], project_id: 'p2' }]])
    expect(ctxRef.files.map(f => f.id)).toEqual(['f1'])
    expect(ctxRef.files[0].tags).toEqual([])
  })

  it('markFileCoreDefiner and updateManagedFile follow the same rule', async () => {
    await mount()
    await act(async () => { await ctxRef.markFileCoreDefiner('f9', true, 'p2') })
    await act(async () => { await ctxRef.updateManagedFile('m9', { notes: 'x' }, 'p2') })
    await act(async () => { await ctxRef.markFileCoreDefiner('f1', true) })
    await act(async () => { await ctxRef.updateManagedFile('m1', { tags: ['shots'] }, 'p1') })
    expect(holder.adapter.calls).toEqual([
      ['updateFile', 'f9', { is_core_definer: true, project_id: 'p2' }],
      ['updateManagedFile', 'm9', { notes: 'x', project_id: 'p2' }],
      ['updateFile', 'f1', { is_core_definer: true, project_id: 'p1' }],
      ['updateManagedFile', 'm1', { tags: ['shots'], project_id: 'p1' }],
    ])
    expect(ctxRef.files[0].is_core_definer).toBe(true)
    expect(ctxRef.managedFiles[0].tags).toEqual(['shots'])
  })
})
