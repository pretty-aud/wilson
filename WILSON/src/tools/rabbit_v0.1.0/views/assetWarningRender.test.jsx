/** @vitest-environment jsdom */
// =============================================================================
// assetWarningRender.test.jsx — what one render of the asset list costs in
// scans of the task list (F4, 2026-11-13; the review's rabbit C5).
//
// The measurement and the pin are one test (the brief's list item 1d): the
// real provider on the dev fixtures, the real Assets tab under it, and one
// render of the tab caused from above it with nothing in the project changed.
// Counted: the calls of `tasksAbout` (state/taskItemsModel.js) made during
// that one render, and the render's time as React's own <Profiler> reports it.
// The calls are pinned. The time is not: the test holds only that the
// Profiler reported the render, with a time above zero, and the times quoted
// below are this test's readings, reported and not pinned (they depend on the
// machine).
//
// MEASURED BEFORE F4's change (2026-11-13, at the brief's tip a71cd144; the
// pin below red): the fixture project holds 15 assets, 42 tasks and 54 task
// items, and ONE render of the tab called `tasksAbout` 15 times, once for each
// row's warning: each call walks all 54 items and filters all 42 tasks, so
// 1,440 row visits for a render in which nothing changed. The same rows' task
// counts come from one indexed pass (taskCountsByEntity). The render itself,
// as this test's Profiler read it (jsdom, fifteen renders, three runs, on the
// machine of that day): 4.5 to 5.6 ms at best, 5.4 to 11.7 ms at the median;
// the scans are a small part of it at this size, and grow with assets times
// tasks (state/assetWarnings.test.js times the scan alone on a generated
// project: 400 assets, 2,000 tasks and 2,600 items, 18.2 to 18.5 ms for one
// render's warnings).
//
// AFTER (the commit that indexes every asset's tasks in one pass): the same
// render calls `tasksAbout` 0 times; the same generated project's warnings
// take 0.43 to 0.44 ms, index and all.
// =============================================================================
import { renderSpy } from '../../../lib/renderSpy'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import React, { Profiler, useState } from 'react'
import { cleanup, act } from '@testing-library/react'
import { mountRabbit } from '../state/mountRabbit'

const holder = vi.hoisted(() => ({ adapter: null, projectId: null, tasksAboutCalls: 0 }))

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
  hydrateSupabase: async () => {},
}))
vi.mock('../../../lib/localData', () => ({
  hasLocalServer: () => false,
  loadOtterSettings: async () => ({ rabbit: { adapterMode: 'supabase', activeProjectId: holder.projectId } }),
  saveOtterSettings: async () => {},
}))
vi.mock('../../../dev/devFixtures', async (importOriginal) => ({ ...(await importOriginal()), devFixtures: () => null }))
vi.mock('../intake/pipeline', () => ({ runIngestion: vi.fn() }))
vi.mock('../../../permissions/usePermissions', () => ({ usePermissions: () => PERMS }))
const PERMS = { role: 'admin', ready: true, can: () => true, userId: 'u-1', workspaceId: 'w-1' }
const ROSTER = { members: [], loading: false, error: null }
vi.mock('../../../components/TeamMembers/useRosterMembers', () => ({ useRosterMembers: () => ROSTER }))
vi.mock('../../../components/TeamMembers/useTeamMembers', () => ({ useTeamMembers: () => ROSTER }))
const TEMPLATES = { templates: [], loadProjectTemplates: async () => [] }
vi.mock('../../../components/TaskTemplates/useTaskTemplates', () => ({ useTaskTemplates: () => TEMPLATES }))
// The count: every importer of tasksAbout gets this one, the provider among them.
vi.mock('../state/taskItemsModel', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, tasksAbout: (...args) => { holder.tasksAboutCalls++; return real.tasksAbout(...args) } }
})

const { buildDevFixtures } = await import('../../../dev/fixtures/install')
const { PROJECT_ID } = await import('../../../dev/fixtures/data/project')
holder.projectId = PROJECT_ID
const { RabbitProvider, useRabbit } = await import('../state/RabbitProvider')
const { default: ProjectAssetsView } = await import('./ProjectAssetsView')
const realModel = await vi.importActual('../state/taskItemsModel')
const { assetWarningOfTasks } = await import('../state/selectors')

let ctx = null
function Probe() { ctx = useRabbit(); return null }
let bump = null
const timings = []
function Bench() {
  const [, setN] = useState(0)
  bump = () => setN((n) => n + 1)
  return (
    <Profiler id="assets" onRender={(_id, phase, actualDuration) => { timings.push({ phase, actualDuration }) }}>
      <ProjectAssetsView />
    </Profiler>
  )
}

async function mount() {
  const fx = buildDevFixtures()
  holder.adapter = fx.rabbitAdapter()
  const view = await mountRabbit(<RabbitProvider><Probe /><Bench /></RabbitProvider>, {
    adapter: holder.adapter, ctx: () => ctx, until: () => expect(ctx?.project?.id).toBe(PROJECT_ID),
  })
  // The tab's own effects (the view's draft, the rows' pictures) settle before anything is counted.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
  return view
}

/** One render of the tab from above it; the project untouched. */
async function oneRender() {
  holder.tasksAboutCalls = 0
  timings.length = 0
  const mark = renderSpy.mark()
  await act(async () => { bump() })
  return { mark, calls: holder.tasksAboutCalls, phases: timings.map((t) => t.phase), ms: timings.reduce((sum, t) => sum + t.actualDuration, 0) }
}

beforeEach(() => { localStorage.clear() })
afterEach(() => { cleanup(); ctx = null; bump = null; renderSpy.reset() })

describe('one render of the asset list, nothing in the project changed', () => {
  it('the fixture project is the measured one: its rows, tasks and items, and a warning that is true and one that is false', async () => {
    const view = await mount()
    const rows = view.container.querySelectorAll('tbody tr[data-asset-id], tbody tr.rb-asset-row')
    const old = (asset) => assetWarningOfTasks(asset, realModel.tasksAbout(ctx.tasks, ctx.taskItems, 'asset', asset.id, ctx.taskItemsAvailable))
    const warned = ctx.assets.filter(old).length
    expect({
      assets: ctx.assets.length, tasks: ctx.tasks.length, items: ctx.taskItems.length,
      itemsKept: ctx.taskItemsAvailable, someWarned: warned > 0, someNot: warned < ctx.assets.length,
      rowsDrawn: rows.length > 0 || view.container.textContent.includes(ctx.assets[0].name),
    }).toEqual({ assets: 15, tasks: 42, items: 54, itemsKept: true, someWarned: true, someNot: true, rowsDrawn: true })
  })

  it('the rows\' warnings scan nothing: no call of tasksAbout in the render', async () => {
    await mount()
    const first = await oneRender()
    expect(renderSpy.renders('ProjectAssetsView', first.mark)).toBe(1)   // it did render
    expect(first.calls).toBe(0)
    // The Profiler reported that render, with a time: read, never pinned (it is the machine's).
    expect(first.phases).toContain('update')
    expect(first.ms).toBeGreaterThan(0)
  })

  it('the warning each row is given is the one the old scan gave, for every asset of the fixture', async () => {
    await mount()
    for (const asset of ctx.assets) {
      const old = assetWarningOfTasks(asset, realModel.tasksAbout(ctx.tasks, ctx.taskItems, 'asset', asset.id, ctx.taskItemsAvailable))
      expect(ctx.selectAssetStatusWarning(asset), asset.name).toBe(old)
    }
  })
})
