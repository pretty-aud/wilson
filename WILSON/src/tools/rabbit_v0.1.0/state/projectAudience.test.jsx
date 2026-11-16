/** @vitest-environment jsdom */
// =============================================================================
// projectAudience.test.jsx — MO1 (migration 0109, MOTH_DESIGN §2.6 R11): the
// provider's half of the private-project channels. The REAL provider over the
// dev fixtures, with both channels faked so a test can be another window's
// write arriving.
//
// What it pins:
//   · an AUDIENCE (who may see a project changed; no row) reads the project
//     list once, through the adapter (RLS on the cloud); if the open project
//     is gone from it, the project closes as a trashed one does, the saved
//     activeProjectId is cleared and the notice says why; if it is still
//     listed (its creator, an admin) it stays open;
//   · a join refetch already pending, then an AUDIENCE: the one coalesced
//     read still revalidates (the reason lives in a ref, not in the timer);
//   · a list read that a newer one overtook is dropped, never landed;
//   · a workspace projects row marked private is never merged into the index;
//     it revalidates instead (a server without 0109 still sends one);
//   · a new topic_epoch in the list re-joins the project channel at it;
//   · the project channel's own AUDIENCE (realtimeMerge's 'audience' effect)
//     revalidates too.
// =============================================================================
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import React from 'react'
import { cleanup, act, waitFor } from '@testing-library/react'
import { mountRabbit } from './mountRabbit'

const holder = vi.hoisted(() => ({
  adapter: null,
  projectId: null,
  saved: [],
  session: { user: { id: 'u-audience', app_metadata: { workspace_id: 'ws-audience' } } },
}))

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
      getSession: async () => ({ data: { session: holder.session } }),
    },
  },
}))
vi.mock('../../../lib/localData', () => ({
  hasLocalServer: () => false,
  loadOtterSettings: async () => ({ rabbit: { adapterMode: 'supabase', activeProjectId: holder.projectId } }),
  saveOtterSettings: async (s) => { holder.saved.push(s) },
}))
vi.mock('../../../dev/devFixtures', async (importOriginal) => ({ ...(await importOriginal()), devFixtures: () => null }))
vi.mock('../intake/pipeline', () => ({ runIngestion: vi.fn() }))

const { buildDevFixtures } = await import('../../../dev/fixtures/install')
const { PROJECT_ID } = await import('../../../dev/fixtures/data/project')
holder.projectId = PROJECT_ID
const { RabbitProvider, useRabbit } = await import('./RabbitProvider')

const NOTICE = 'This project is no longer shared with you.'
const AUDIENCE = { table: 'projects', op: 'AUDIENCE', record: null, oldRecord: null }

let ctx = null
function Probe() { ctx = useRabbit(); return null }

const ws = { emit: null, opts: null }
const proj = { emit: null, calls: [] }
let listCalls = 0
let hide = false
let listImpl = null

beforeEach(async () => {
  holder.adapter = buildDevFixtures().rabbitAdapter()
  holder.saved = []
  hide = false
  listImpl = null
  const realList = holder.adapter.listProjects.bind(holder.adapter)
  holder.adapter.listProjects = async () => {
    listCalls += 1
    if (listImpl) return listImpl(realList)
    const list = await realList()
    // The cloud's RLS, emulated: a project this window may no longer see is not listed.
    return hide ? list.filter(p => p.id !== PROJECT_ID) : list
  }
  ws.emit = null
  ws.opts = null
  holder.adapter.subscribeWorkspaceChanges = (_ws, cb, opts) => { ws.emit = cb; ws.opts = opts; return () => {} }
  const subscribe = holder.adapter.subscribeProjectChanges.bind(holder.adapter)
  proj.calls = []
  holder.adapter.subscribeProjectChanges = (pid, cb, opts) => {
    proj.calls.push({ pid, epoch: opts?.topicEpoch })
    proj.emit = cb
    return subscribe(pid, cb, opts)
  }
  await mountRabbit(<RabbitProvider><Probe /></RabbitProvider>, { adapter: holder.adapter, ctx: () => ctx, until: [
    () => expect(ctx?.project?.id).toBe(PROJECT_ID),
    () => expect(ws.emit).toBeTypeOf('function'),
  ] })
})
afterEach(() => { cleanup(); ctx = null })

const LONG = { timeout: 3000 }

describe('AUDIENCE: the list is read again, and the open project closes if it is gone', () => {
  it('gone: closes, clears the saved project and says why — after one read', async () => {
    const before = listCalls
    hide = true
    await act(async () => { ws.emit(AUDIENCE) })
    await waitFor(() => expect(ctx.activeProjectId).toBe(null), LONG)
    expect(listCalls).toBe(before + 1)
    expect(ctx.project).toBeFalsy()
    expect(ctx.error).toBe(NOTICE)
    await waitFor(() => expect(holder.saved.some(s => s?.rabbit && s.rabbit.activeProjectId === null)).toBe(true))
  })

  it('still listed (its creator, an admin): stays open, no notice', async () => {
    const before = listCalls
    await act(async () => { ws.emit(AUDIENCE) })
    await waitFor(() => expect(listCalls).toBe(before + 1), LONG)
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    expect(ctx.activeProjectId).toBe(PROJECT_ID)
    expect(ctx.error).not.toBe(NOTICE)
  })

  it('a join refetch already pending, then AUDIENCE: the one coalesced read still revalidates', async () => {
    const before = listCalls
    hide = true
    await act(async () => { ws.opts.onStatus('SUBSCRIBED'); ws.emit(AUDIENCE) })
    await waitFor(() => expect(ctx.activeProjectId).toBe(null), LONG)
    expect(listCalls).toBe(before + 1)
  })

  // Review round 1, finding 4: the order in which the reason must survive the
  // debounce — a plain join refetch replacing the revalidating timer.
  it('AUDIENCE, then a join refetch within the debounce: the read still revalidates', async () => {
    const before = listCalls
    hide = true
    await act(async () => { ws.emit(AUDIENCE); ws.opts.onStatus('SUBSCRIBED') })
    await waitFor(() => expect(ctx.activeProjectId).toBe(null), LONG)
    expect(listCalls).toBe(before + 1)
  })

  it('the project channel\'s own AUDIENCE revalidates too', async () => {
    hide = true
    await act(async () => { proj.emit(AUDIENCE) })
    await waitFor(() => expect(ctx.activeProjectId).toBe(null), LONG)
    expect(ctx.error).toBe(NOTICE)
  })
})

describe('the list behind a sequence number', () => {
  it('a read that a newer one overtook is dropped, never landed', async () => {
    let n = 0
    let release = null
    listImpl = async (realList) => {
      const list = await realList()
      n += 1
      if (n === 1) {
        await new Promise(r => { release = r })
        return [...list, { id: 'stale-only', title: 'Stale', updated_at: '2030-01-01T00:00:00.000Z' }]
      }
      return list
    }
    let first = null
    await act(async () => { first = ctx.refreshProjectsIndex() })
    await act(async () => { await ctx.refreshProjectsIndex() })
    await waitFor(() => expect(release).toBeTypeOf('function'))
    await act(async () => { release(); expect(await first).toBe(null) })
    expect(ctx.projectsIndex['stale-only']).toBeUndefined()
    expect(ctx.projectsIndex[PROJECT_ID]).toBeTruthy()
  })
})

describe('the workspace channel never merges a private row', () => {
  it('a projects row marked private is not merged; it revalidates instead', async () => {
    const before = listCalls
    await act(async () => {
      ws.emit({ table: 'projects', op: 'UPDATE', oldRecord: null,
        record: { id: PROJECT_ID, title: 'Leaked title', is_private: true, updated_at: '2030-01-01T00:00:00.000Z' } })
    })
    expect(ctx.projectsIndex[PROJECT_ID]?.title).not.toBe('Leaked title')
    await waitFor(() => expect(listCalls).toBe(before + 1), LONG)
    expect(ctx.projectsIndex[PROJECT_ID]?.title).not.toBe('Leaked title')
  })
})

describe('the topic epoch', () => {
  it('a new topic_epoch in the list re-joins the project channel at it', async () => {
    expect(proj.calls[0]).toEqual({ pid: PROJECT_ID, epoch: 0 })
    listImpl = async (realList) => (await realList()).map(p => (p.id === PROJECT_ID ? { ...p, topic_epoch: 1 } : p))
    await act(async () => { await ctx.refreshProjectsIndex() })
    await waitFor(() => expect(proj.calls.at(-1)).toEqual({ pid: PROJECT_ID, epoch: 1 }))
  })
})

// MO1 (0110, MOTH_DESIGN §2.2 PSA-08): neither path ever merges a personal space,
// or a private row, into the project list; the list is read again through RLS.
describe('neither channel merges a personal space or a private row', () => {
  const STAMP = '2030-01-01T00:00:00.000Z'
  const personal = { id: 'ps-1', title: 'Personal space', is_private: true, personal_owner_id: 'u2', updated_at: STAMP }
  const projectsEvent = (record) => ({ table: 'projects', op: 'UPDATE', oldRecord: null, record })

  it('the workspace channel: a personal row stays out, and one that got in leaves', async () => {
    const before = listCalls
    await act(async () => { ws.emit(projectsEvent(personal)) })
    expect(ctx.projectsIndex['ps-1']).toBeUndefined()
    await waitFor(() => expect(listCalls).toBe(before + 1), LONG)
    expect(ctx.projectsIndex['ps-1']).toBeUndefined()
  })

  it('the project channel: a personal row stays out, and the list is read again', async () => {
    const before = listCalls
    await act(async () => { proj.emit(projectsEvent(personal)) })
    expect(ctx.projectsIndex['ps-1']).toBeUndefined()
    await waitFor(() => expect(listCalls).toBe(before + 1), LONG)
  })

  it('the project channel: a private row\'s words are not merged, and the list is read again', async () => {
    const before = listCalls
    await act(async () => {
      proj.emit(projectsEvent({ id: PROJECT_ID, title: 'Leaked title', is_private: true, updated_at: STAMP }))
    })
    expect(ctx.projectsIndex[PROJECT_ID]?.title).not.toBe('Leaked title')
    await waitFor(() => expect(listCalls).toBe(before + 1), LONG)
  })

  it('FAILING CONTROL: both channels still merge an ordinary row', async () => {
    await act(async () => { ws.emit(projectsEvent({ id: 'open-1', title: 'From the workspace', updated_at: STAMP })) })
    expect(ctx.projectsIndex['open-1']?.title).toBe('From the workspace')
    await act(async () => { proj.emit(projectsEvent({ id: 'open-2', title: 'From the project', updated_at: STAMP })) })
    expect(ctx.projectsIndex['open-2']?.title).toBe('From the project')
  })
})
