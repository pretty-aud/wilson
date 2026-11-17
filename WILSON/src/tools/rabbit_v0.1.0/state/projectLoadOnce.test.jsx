/** @vitest-environment jsdom */
// =============================================================================
// projectLoadOnce.test.jsx — F5 item 1 (rabbit C2): one project open is one
// full load, and nothing the channel says between its join and that load is
// lost; a token refresh that changes nothing re-reads nothing and renders
// nothing.
//
// The measurement and the pin are the same test. The REAL provider over the
// dev fixtures (the shared mount, mountRabbit), with the project channel and
// the auth events faked, so a test is the channel joining, another window's
// write arriving, or the SDK refreshing a token. Before F5 an open cost two
// full loads (the open itself, then the refetch the channel's first
// SUBSCRIBED schedules), an event the channel delivered before the refetch
// landed was overwritten by it, and every TOKEN_REFRESHED re-read the project
// list and replaced the adapter's status with a new object.
// =============================================================================
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import React, { memo } from 'react'
import { cleanup, act, waitFor } from '@testing-library/react'
import { mountRabbit } from './mountRabbit'

const holder = vi.hoisted(() => ({
  adapter: null,
  projectId: null,
  authCbs: new Set(),
  session: { user: { id: 'u-open', app_metadata: { workspace_id: 'ws-open' } } },
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
      onAuthStateChange: (cb) => {
        holder.authCbs.add(cb)
        return { data: { subscription: { unsubscribe() { holder.authCbs.delete(cb) } } } }
      },
      getSession: async () => ({ data: { session: holder.session } }),
    },
  },
}))
vi.mock('../../../lib/localData', () => ({
  hasLocalServer: () => false,
  loadOtterSettings: async () => ({ rabbit: { adapterMode: 'supabase', activeProjectId: holder.projectId } }),
  saveOtterSettings: async () => {},
}))
vi.mock('../../../dev/devFixtures', async (importOriginal) => ({ ...(await importOriginal()), devFixtures: () => null }))
vi.mock('../intake/pipeline', () => ({ runIngestion: vi.fn() }))

const { buildDevFixtures } = await import('../../../dev/fixtures/install')
const { PROJECT_ID } = await import('../../../dev/fixtures/data/project')
holder.projectId = PROJECT_ID
const { RabbitProvider, useRabbit } = await import('./RabbitProvider')

let ctx = null
let renders = 0
function Probe() { ctx = useRabbit(); renders += 1; return null }
const StableProbe = memo(Probe)

const chan = { opts: null, emit: null, joins: 0 }
let loads = 0
let lists = 0
let loadDelay = 0
let task = null

beforeEach(async () => {
  holder.adapter = buildDevFixtures().rabbitAdapter()
  holder.authCbs = new Set()
  loads = 0
  lists = 0
  loadDelay = 0
  renders = 0
  // A task as the database holds it, read before the provider starts.
  task = (await holder.adapter.loadProject(PROJECT_ID)).tasks[0]
  const realLoad = holder.adapter.loadProject.bind(holder.adapter)
  holder.adapter.loadProject = async (pid) => {
    loads += 1
    const out = await realLoad(pid)
    if (loadDelay) await new Promise((r) => setTimeout(r, loadDelay))
    return out
  }
  const realList = holder.adapter.listProjects.bind(holder.adapter)
  holder.adapter.listProjects = async () => { lists += 1; return realList() }
  // The project channel joins when the test says so.
  chan.opts = null
  chan.emit = null
  chan.joins = 0
  holder.adapter.subscribeProjectChanges = (_pid, cb, opts) => {
    chan.emit = cb
    chan.opts = opts
    chan.joins += 1
    return () => {}
  }
  holder.adapter.subscribeWorkspaceChanges = () => () => {}
})
afterEach(() => { cleanup(); ctx = null })

const LONG = { timeout: 3000 }
const pause = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

async function openAndJoin() {
  await mountRabbit(<RabbitProvider><StableProbe /></RabbitProvider>, { until: [
    () => expect(ctx?.activeProjectId).toBe(PROJECT_ID),
    () => expect(chan.opts?.onStatus).toBeTypeOf('function'),
  ] })
  await act(async () => { chan.opts.onStatus('SUBSCRIBED') })
}

describe('one open, one load', () => {
  it('opening the saved project costs one loadProject, the channel\'s join included', async () => {
    await openAndJoin()
    await waitFor(() => expect(ctx?.project?.id).toBe(PROJECT_ID), LONG)
    await pause(700)
    expect(loads).toBe(1)
  })

  it('an event sent between the join and the load is still applied when the load lands', async () => {
    loadDelay = 60
    await mountRabbit(<RabbitProvider><StableProbe /></RabbitProvider>, { until: [
      () => expect(ctx?.activeProjectId).toBe(PROJECT_ID),
      () => expect(chan.opts?.onStatus).toBeTypeOf('function'),
    ] })
    const renamed = { ...task, title: 'Renamed in another window', updated_at: new Date(Date.now() + 60_000).toISOString() }
    await act(async () => {
      chan.opts.onStatus('SUBSCRIBED')
      chan.emit({ table: 'tasks', op: 'UPDATE', record: renamed, oldRecord: task })
    })
    await waitFor(() => expect(ctx?.project?.id).toBe(PROJECT_ID), LONG)
    await pause(800)
    expect((ctx.tasks || []).find((t) => t.id === task.id)?.title).toBe('Renamed in another window')
  })

  it('a join after a drop still refetches (the reconnect\'s missed-events window)', async () => {
    await openAndJoin()
    await waitFor(() => expect(ctx?.project?.id).toBe(PROJECT_ID), LONG)
    await pause(700)
    const before = loads
    await act(async () => { chan.opts.onStatus('CLOSED') })
    await act(async () => { chan.opts.onStatus('SUBSCRIBED') })
    await waitFor(() => expect(loads).toBe(before + 1), LONG)
  })
})

describe('a token refresh that changes nothing', () => {
  it('re-reads no project list, keeps the status object and renders nothing', async () => {
    holder.adapter.mode = 'supabase'
    await openAndJoin()
    await waitFor(() => expect(ctx?.project?.id).toBe(PROJECT_ID), LONG)
    await pause(700)
    const status = ctx.adapterStatus
    const listsBefore = lists
    const rendersBefore = renders
    await act(async () => { for (const cb of [...holder.authCbs]) cb('TOKEN_REFRESHED', holder.session) })
    await pause(100)
    expect(lists).toBe(listsBefore)
    expect(ctx.adapterStatus).toBe(status)
    expect(renders).toBe(rendersBefore)
  })
})

describe('the wait for the join has an end, and a newer open ends it', () => {
  it('a channel that never joins still loads once, at the wait\'s end, and its late join refetches', async () => {
    await mountRabbit(<RabbitProvider><StableProbe /></RabbitProvider>, { until: [
      () => expect(chan.opts?.onStatus).toBeTypeOf('function'),
    ] })
    await waitFor(() => expect(ctx?.project?.id).toBe(PROJECT_ID), LONG)
    expect(loads).toBe(1)
    await act(async () => { chan.opts.onStatus('SUBSCRIBED') })
    await waitFor(() => expect(loads).toBe(2), LONG)
  })

  it('a project closed while it waits for its join is never loaded', async () => {
    await mountRabbit(<RabbitProvider><StableProbe /></RabbitProvider>, { until: [
      () => expect(ctx?.activeProjectId).toBe(PROJECT_ID),
      () => expect(chan.opts?.onStatus).toBeTypeOf('function'),
    ] })
    await act(async () => { await ctx.setActiveProject(null) })
    await pause(700)
    expect(loads).toBe(0)
    expect(ctx.project).toBeFalsy()
  })
})
