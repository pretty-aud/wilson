/** @vitest-environment jsdom */
// =============================================================================
// mountRabbit.test.jsx — the one CONTROL for the gap state/mountRabbit.js
// waits out (N1, 2026-10-27; before N1 six test files each held a copy:
// tasksViews, taskItemDrops, assetsViews, entityViews, scenesViews,
// tableViewsProvider).
//
// The gap, held open on purpose: a MutationObserver resolves in the
// microtasks of the commit that draws the project, before that commit's
// effects run (state/gapPremise.test.jsx holds why: React asks for a paint in
// every commit, so a non-sync commit leaves its passive effects for a later
// task). Two of those effects undo what a test does there, and the control
// holds both (review round 1: the six controls it replaced held the second):
// the project's visit count (a view added there offers an Undo that does
// nothing: the add took the visit before the project's own effect counts it)
// and the views' drafts reset (a change for now made there is wiped, as a
// grouping was in the view tests). Mounted by mountRabbit, the same add's Undo
// takes the view back and the same change stays. Without the helper's waits
// (the render outside act, the status wait gone) the second half goes red as
// the first: N1's hand-off has the run.
// =============================================================================
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import React from 'react'
import { render, cleanup, act } from '@testing-library/react'

const holder = vi.hoisted(() => ({ adapter: null, projectId: null }))

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
const { mountRabbit } = await import('./mountRabbit')

let ctx = null
function Probe() { ctx = useRabbit(); return null }
// No view is drawn, so a marker carries the project's id into the DOM: the
// observer below sees the project's commit, and so would a waitFor's.
function Marker() { const c = useRabbit(); return <i data-project={c?.project?.id || ''} /> }
const run = (fn) => act(async () => { await fn() })
let fx = null

beforeEach(() => { fx = buildDevFixtures() })
afterEach(() => { cleanup(); ctx = null; fx = null })

describe('CONTROL: the gap mountRabbit waits out', () => {
  it('between the project\'s commit and its effects a view\'s add offers an Undo that does nothing and a change for now is wiped; mounted by mountRabbit, the Undo takes the view back and the change stays', async () => {
    holder.adapter = fx.rabbitAdapter()
    expect(typeof holder.adapter.getTableViewLast).toBe('function')   // the fixtures read the views map, so the status wait applies
    const committed = new Promise((resolve) => {
      const mo = new MutationObserver(() => {
        if (ctx?.project?.id === PROJECT_ID) { mo.disconnect(); resolve() }
      })
      mo.observe(document.body, { subtree: true, childList: true, attributes: true })
    })
    render(<RabbitProvider><Probe /><Marker /></RabbitProvider>)
    await committed
    expect(ctx.tableViewLast.status).toBe('unavailable')   // the provider's effects for the adapter not run yet
    // A change for now on another table (the add below sets none there), then the add, in one act.
    await run(async () => { ctx.setViewDraft('assets', { viewId: 'all' }); await ctx.addTableView({ tableKey: 'tasks', name: 'In the gap' }) })
    expect(ctx.viewDraftOf('assets')).toBeNull()   // the drafts reset ran after it and wiped it
    expect(ctx.undoToast?.message).toBe('In the gap saved for everyone')
    await run(() => ctx.undoToast.onUndo())
    expect(fx.store.tableViews.map(v => v.name)).toEqual(['In the gap'])   // the Undo did nothing

    cleanup(); ctx = null
    fx = buildDevFixtures()
    holder.adapter = fx.rabbitAdapter()
    await mountRabbit(<RabbitProvider><Probe /><Marker /></RabbitProvider>, {
      adapter: holder.adapter,
      ctx: () => ctx,
      until: () => expect(ctx?.project?.id).toBe(PROJECT_ID),
    })
    expect(ctx.tableViewLast.status).not.toBe('unavailable')
    await run(async () => { ctx.setViewDraft('assets', { viewId: 'all' }); await ctx.addTableView({ tableKey: 'tasks', name: 'Mounted' }) })
    expect(ctx.viewDraftOf('assets')).toMatchObject({ viewId: 'all' })   // the change stays
    expect(ctx.undoToast?.message).toBe('Mounted saved for everyone')
    await run(() => ctx.undoToast.onUndo())
    expect(fx.store.tableViews.map(v => v.name)).toEqual([])   // the Undo took it back
  })
})
