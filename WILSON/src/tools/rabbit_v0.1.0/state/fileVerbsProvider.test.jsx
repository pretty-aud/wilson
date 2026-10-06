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
    loadProject: async (id = 'p1') => (id === 'p1'
      ? { project: { id: 'p1', title: 'One' }, files: files.map(f => ({ ...f })), managedFiles: managed.map(f => ({ ...f })) }
      : { project: { id, title: 'Two' }, files: [{ id: 'f2', project_id: id, name: 'c.pdf', description: null, tags: [] }], managedFiles: [] }),
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
    const before = ctxRef.files
    await act(async () => { await ctxRef.patchFile('f9', { tags: ['shots'] }, 'p2') })
    expect(holder.adapter.calls).toEqual([['updateFile', 'f9', { tags: ['shots'], project_id: 'p2' }]])
    // UNTOUCHED, not merely unchanged in content (review round 1, R1-TST-15:
    // a write to f9 left f1 alone on any code path): no optimistic update and
    // no landing of the answer ran on the open bundle at all.
    expect(ctxRef.files).toBe(before)
    expect(ctxRef.files.map(f => f.id)).toEqual(['f1'])
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

  // S4b (0088): a Legal file is never core — Intake and D.O.G. read core files
  // as the project's context. The provider refuses it before anything is
  // sent, when the row is in hand; the database's CHECK refuses it anyway.
  it('Core on a Legal file is refused with its reason and nothing reaches the adapter; Core OFF is still sent', async () => {
    const base = holder.adapter.loadProject
    holder.adapter.loadProject = async (id) => {
      const b = await base(id)
      return id === 'p1' || id === undefined
        ? { ...b, files: [...b.files, { id: 'fL', project_id: 'p1', name: 'release.pdf', tags: ['legal'], is_core_definer: false }] }
        : b
    }
    render(<RabbitProvider><Probe /></RabbitProvider>)
    await waitFor(() => expect(ctxRef?.files?.length).toBe(2))
    const { LEGAL_NOT_CORE_REASON } = await import('../fileTags')
    await expect(ctxRef.markFileCoreDefiner('fL', true)).rejects.toThrow(LEGAL_NOT_CORE_REASON)
    expect(holder.adapter.calls).toEqual([])
    expect(ctxRef.files.find(f => f.id === 'fL').is_core_definer).toBe(false)
    // CONTROLS: turning it OFF is harmless and goes through; an ordinary file
    // still becomes core.
    await act(async () => { await ctxRef.markFileCoreDefiner('fL', false) })
    await act(async () => { await ctxRef.markFileCoreDefiner('f1', true) })
    expect(holder.adapter.calls).toEqual([
      ['updateFile', 'fL', { is_core_definer: false, project_id: 'p1' }],
      ['updateFile', 'f1', { is_core_definer: true, project_id: 'p1' }],
    ])
  })
})

// Review round 2 (R2-UI-01, measured in a browser with two hosts): the
// optimistic write kept the row's OLD updated_at, so an explorer whose own copy
// carried the server's newer one kept it — the other host showed the note from
// before the write, and a line added there wrote the older note back. The
// server's row now lands in the bundle when the write does.
describe('the saved row lands in the bundle (review round 2, R2-UI-01)', () => {
  const at = (s) => `2026-10-01T10:00:${String(s).padStart(2, '0')}.000Z`
  function deferredWrites(method) {
    const pending = []
    holder.adapter[method] = (id, patch) => new Promise((resolve, reject) => {
      pending.push({ id, patch, resolve, reject })
    })
    return pending
  }

  it('each verb: the row takes the SERVER\'s row once the write lands, not only the patch', async () => {
    holder.adapter.updateFile = async (id, patch) => ({ id, ...patch, description: patch.description && `${patch.description} (as saved)`, updated_at: at(1) })
    holder.adapter.updateManagedFile = async (id, patch) => ({ id, ...patch, updated_at: at(2) })
    await mount()
    await act(async () => { await ctxRef.patchFile('f1', { description: 'note' }) })
    expect(ctxRef.files[0]).toMatchObject({ id: 'f1', name: 'a.pdf', description: 'note (as saved)', updated_at: at(1) })
    holder.adapter.updateFile = async (id, patch) => ({ id, ...patch, updated_at: at(3) })
    await act(async () => { await ctxRef.markFileCoreDefiner('f1', true) })
    expect(ctxRef.files[0]).toMatchObject({ is_core_definer: true, updated_at: at(3) })
    await act(async () => { await ctxRef.updateManagedFile('m1', { notes: 'n' }) })
    expect(ctxRef.managedFiles[0]).toMatchObject({ id: 'm1', file_name: 'b.mov', notes: 'n', updated_at: at(2) })
  })

  it('only the latest write for a row lands: an earlier answer, early or late, never undoes a later edit', async () => {
    await mount()
    const pending = deferredWrites('updateFile')
    let a, b
    act(() => { a = ctxRef.patchFile('f1', { description: 'A' }) })
    act(() => { b = ctxRef.patchFile('f1', { description: 'AB' }) })
    await waitFor(() => expect(pending.length).toBe(2))
    expect(ctxRef.files[0].description).toBe('AB')
    // A answers first, while B is still out: the box must not fall back to 'A'.
    await act(async () => { pending[0].resolve({ id: 'f1', description: 'A', updated_at: at(1) }); await a })
    expect(ctxRef.files[0].description).toBe('AB')
    expect(ctxRef.files[0].updated_at).toBeUndefined()
    await act(async () => { pending[1].resolve({ id: 'f1', description: 'AB', updated_at: at(2) }); await b })
    expect(ctxRef.files[0]).toMatchObject({ description: 'AB', updated_at: at(2) })

    // And the other order: the later write answers first, the earlier one after.
    let c, d
    act(() => { c = ctxRef.patchFile('f1', { description: 'C' }) })
    act(() => { d = ctxRef.patchFile('f1', { description: 'CD' }) })
    await waitFor(() => expect(pending.length).toBe(4))
    await act(async () => { pending[3].resolve({ id: 'f1', description: 'CD', updated_at: at(4) }); await d })
    await act(async () => { pending[2].resolve({ id: 'f1', description: 'C', updated_at: at(3) }); await c })
    expect(ctxRef.files[0]).toMatchObject({ description: 'CD', updated_at: at(4) })
  })

  it('an answer that is not this row (none, or another id) lands nothing', async () => {
    await mount()
    holder.adapter.updateFile = async () => ({ id: 'f-other', description: 'not mine', updated_at: at(5) })
    await act(async () => { await ctxRef.patchFile('f1', { description: 'mine' }) })
    expect(ctxRef.files[0]).toMatchObject({ id: 'f1', description: 'mine' })
    expect(ctxRef.files[0].updated_at).toBeUndefined()
    holder.adapter.updateManagedFile = async () => undefined
    await act(async () => { await ctxRef.updateManagedFile('m1', { notes: 'kept' }) })
    expect(ctxRef.managedFiles[0]).toMatchObject({ id: 'm1', notes: 'kept' })
  })

  it('a project opened while the write was out: the answer leaves the new project\'s bundle untouched', async () => {
    await mount()
    const pending = deferredWrites('updateFile')
    let w
    act(() => { w = ctxRef.patchFile('f1', { description: 'late' }) })
    await waitFor(() => expect(pending.length).toBe(1))
    await act(async () => { await ctxRef.setActiveProject('p2', false) })
    await waitFor(() => expect(ctxRef.project?.id).toBe('p2'))
    await waitFor(() => expect(ctxRef.files.map(f => f.id)).toEqual(['f2']))
    const before = ctxRef.files
    await act(async () => { pending[0].resolve({ id: 'f1', description: 'late', updated_at: at(6) }); await w })
    expect(ctxRef.files).toBe(before)
  })
})
