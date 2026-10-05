/** @vitest-environment jsdom */
// =============================================================================
// bidVersionsReview.test.jsx — post-overhaul S5c, review round 1: each finding
// the reviewer proved, held as it should be. The proofs are the reviewer's
// own (written to assert the right behaviour, so they failed on 5fd199d5),
// over bidVersions.test.jsx's harness with the live rates configurable.
//   R1-01 a step stopped part way: the toast is its way back, no "Ctrl+Z"
//         promised; a version's delete stopped part way sets its rows aside
//         again, so no Save folds another bid into the open version
//   R1-02 a version deleted while an undo replays still records its step
//   R1-03 a rate-card role no task uses calls no version unsaved
//   R1-04 a create or a revive answering after a project switch stays home
//   R1-05 the unsaved question's Save as new says the list it saves on
//   R1-06 Manage → Delete… → back keeps the person's list choice
// =============================================================================
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import React from 'react'
import { render, cleanup, act, waitFor, screen, within, fireEvent } from '@testing-library/react'

const holder = vi.hoisted(() => ({ adapter: null, projectId: null, rates: null }))

vi.mock('../../adapters', () => ({
  selectAdapter: () => holder.adapter,
  ADAPTER_MODES: ['supabase', 'local_server', 'google_drive'],
  adapterSupportsWrites: () => true,
}))
vi.mock('../../adapters/supabaseAdapter', () => ({ resetSupabaseAdapter: () => {} }))
vi.mock('../../../../cloud/auth/supabaseClient', () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: null } }),
    },
  },
}))
vi.mock('../../../../lib/localData', () => ({
  hasLocalServer: () => false,
  loadOtterSettings: async () => ({ rabbit: { adapterMode: 'supabase', activeProjectId: holder.projectId } }),
  saveOtterSettings: async () => {},
}))
vi.mock('../../../../dev/devFixtures', async (importOriginal) => ({ ...(await importOriginal()), devFixtures: () => null }))
vi.mock('../../intake/pipeline', () => ({ runIngestion: vi.fn() }))
vi.mock('../../../../permissions/usePermissions', () => ({ usePermissions: () => ({ role: 'admin', ready: true }) }))
vi.mock('../../../../components/RateCard/useRateCard', () => ({ useRateCard: () => ({ entries: [], rateCards: [] }) }))

const { buildDevFixtures } = await import('../../../../dev/fixtures/install')
const { PROJECT_ID } = await import('../../../../dev/fixtures/data/project')
const { fid } = await import('../../../../dev/fixtures/ids')
const { BUDGET_VERSIONS } = await import('../../../../dev/fixtures/data/money')
holder.projectId = PROJECT_ID
const { RabbitProvider, useRabbit } = await import('../../state/RabbitProvider')
const { SummaryTab } = await import('../BudgetView')
const { default: UndoToast } = await import('../../components/UndoToast')

const BV1 = fid('budgetVersion', 1)
const BV2 = fid('budgetVersion', 2)
const V1 = 'Bid v1 (fund application)'
const V2 = 'Bid v2 (pre-production)'
const RATES = BUDGET_VERSIONS.find(v => v.id === BV2).snapshot.roleRates
const LIST1 = fid('shotList', 1)

let ctx = null
let fx = null

function Harness() {
  ctx = useRabbit()
  if (!ctx?.project) return null
  return (
    <>
      <SummaryTab
        ctx={ctx}
        project={ctx.project}
        variance={ctx.selectVarianceForProject()}
        budget={{ total: 0, byRole: {}, currency: 'USD' }}
        tasks={ctx.tasks}
        roleRates={holder.rates}
        missingRolesCount={0}
        rateCardName="General"
        budgetHook={null}
        rateCard={{ entries: [] }}
        teamMembers={[]}
        expensesHook={{ expenses: [] }}
      />
      <UndoToast />
    </>
  )
}

async function mount(rates = RATES) {
  holder.rates = rates
  fx = buildDevFixtures()
  holder.adapter = fx.rabbitAdapter()
  render(<RabbitProvider><Harness /></RabbitProvider>)
  await waitFor(() => expect(ctx?.project?.id).toBe(PROJECT_ID))
  await waitFor(() => expect(ctx.budgetVersions.length).toBe(2))
}
afterEach(() => { cleanup(); ctx = null; fx = null })

const blockEl = () => document.querySelector('section.rb-bv-block')
const inBlock = () => within(blockEl())
const press = (el) => act(async () => { fireEvent.click(el) })
const dialog = (name) => screen.getByRole('dialog', { name })
const run = (fn) => act(async () => { await fn() })
const reset = () => run(() => ctx.resetToBidding())
const select = (id) => run(() => ctx.selectBudgetVersion(id))
const openQuietly = (id) => run(() => ctx.openBudgetVersion(id, { roleRates: holder.rates }))

describe('R1-03: a rate-card role no version holds', () => {
  it('the Timeline IS Bid v2 exactly, yet Edit asks "Save what the Timeline shows first?"; and right after the open the version reads unsaved', async () => {
    // The workspace rate card gained a role after the bids were saved (no task uses it).
    await mount({ ...RATES, colorist: 900 })
    await reset()
    await select(BV1)
    await press(inBlock().getByRole('button', { name: 'Edit this version' }))
    // Correct: straight to the open question (the schedule is Bid v2's, saved).
    const first = screen.getByRole('dialog')
    const firstTitle = first.querySelector('.ui-dialog-title, h2')?.textContent || first.getAttribute('aria-label') || first.textContent.slice(0, 60)
    let afterOpen = null
    if (screen.queryByRole('dialog', { name: 'Save what the Timeline shows first?' })) {
      await press(within(dialog('Save what the Timeline shows first?')).getByRole('button', { name: 'Discard' }))
    }
    await press(within(dialog(`Edit “${V1}”?`)).getByRole('button', { name: 'Edit this version' }))
    await waitFor(() => expect(ctx.project.open_budget_version_id).toBe(BV1))
    afterOpen = blockEl().querySelector('.rb-bv-open-status').textContent
    expect({ firstTitle, afterOpen }).toEqual({ firstTitle: `Edit “${V1}”?`, afterOpen: expect.stringMatching(/^Saved /) })
  })
})

describe('R1-01: an open stopped part way', () => {
  it('the open stops after 11 tasks left the Timeline; the sentence says "Undo (Ctrl+Z)"; there is no toast and Ctrl+Z does nothing here', async () => {
    await mount()
    await reset()
    await select(BV1)
    await run(() => ctx.dismissUndoToast())
    const orig = holder.adapter.updateProject.bind(holder.adapter)
    holder.adapter.updateProject = async (id, fields) => {
      if ('budget_contingency_pct' in fields) throw new Error('network down')
      return orig(id, fields)
    }
    await press(inBlock().getByRole('button', { name: 'Edit this version' }))
    const d = dialog(`Edit “${V1}”?`)
    await press(within(d).getByRole('button', { name: 'Edit this version' }))
    await waitFor(() => expect(d.textContent).toContain('stopped part way'))
    const said = d.textContent
    const tasksAfterFailure = ctx.tasks.length
    const canUndo = ctx.canUndo
    const toastUndo = screen.queryByRole('button', { name: 'Undo' })
    await press(within(d).getByRole('button', { name: 'Cancel' }))
    await act(async () => { fireEvent.keyDown(window, { key: 'z', ctrlKey: true }) })
    await act(async () => { await new Promise(r => setTimeout(r, 50)) })
    // Correct: no promise of Ctrl+Z on a page that binds none, or a way back on this page.
    expect({
      promisesCtrlZ: said.includes('Undo (Ctrl+Z)'),
      tasksAfterFailure,
      canUndo,
      toastOffered: !!toastUndo,
      tasksAfterCtrlZ: ctx.tasks.length,
    }).toEqual({ promisesCtrlZ: false, tasksAfterFailure: 31, canUndo: true, toastOffered: true, tasksAfterCtrlZ: 31 })
  })
})

describe('R1-05: the unsaved question\'s Save as new version… says the list it saves on', () => {
  it('"Based on no shot list." while the version is saved based on the active list', async () => {
    await mount()
    await reset()
    await select(BV1)
    await run(() => ctx.addTask({ title: 'Pickup day', phase_id: ctx.phases[0].id, bid_days: 1 }))
    await press(inBlock().getByRole('button', { name: 'Edit this version' }))
    await press(within(dialog('Save what the Timeline shows first?')).getByRole('button', { name: 'Save as new version…' }))
    const d = dialog('Save as new version')
    const said = d.textContent
    fireEvent.change(within(d).getByRole('textbox', { name: 'Name' }), { target: { value: 'With pickup' } })
    await press(within(d).getByRole('button', { name: 'Save as new version' }))
    await waitFor(() => expect(ctx.budgetVersions.some(v => v.name === 'With pickup')).toBe(true))
    const made = ctx.budgetVersions.find(v => v.name === 'With pickup')
    expect({ says: said.includes('Based on no shot list.'), savedList: made.shot_list_id ?? null })
      .toEqual({ says: made.shot_list_id ? false : true, savedList: made.shot_list_id ?? null })
  })
})

describe('R1-06: Manage → Delete… → Cancel keeps the person\'s unsaved shot-list choice', () => {
  it('after the detour, Edit this version asks nothing and the choice is dropped (directly from Manage it asks)', async () => {
    await mount()
    await reset()
    await select(BV1)
    await openQuietly(BV1)
    await act(async () => { fireEvent.change(inBlock().getByRole('combobox', { name: 'Based on shot list' }), { target: { value: LIST1 } }) })
    expect(blockEl().querySelector('.rb-bv-open-status').textContent).toBe('Unsaved changes')
    await press(inBlock().getByRole('button', { name: 'Manage versions…' }))
    let picker = dialog('Bid versions')
    let row = within(picker).getAllByRole('row').find(r => r.textContent.includes(V2))
    await press(within(row).getByRole('button', { name: `Actions for “${V2}”` }))
    await press(screen.getByRole('button', { name: 'Delete…' }))
    await press(within(dialog(`Delete “${V2}”?`)).getByRole('button', { name: 'Cancel' }))
    picker = dialog('Bid versions')
    row = within(picker).getAllByRole('row').find(r => r.textContent.includes(V2))
    await press(within(row).getByRole('button', { name: `Actions for “${V2}”` }))
    await press(screen.getAllByRole('button', { name: 'Edit this version' }).find(b => b.classList.contains('ui-menu-item')))
    const asked = !!screen.queryByRole('dialog', { name: `Save the changes to “${V1}” first?` })
    const straight = !!screen.queryByRole('dialog', { name: `Edit “${V2}”?` })
    expect({ asked, straight }).toEqual({ asked: true, straight: false })
  })
})

describe('R1-02: a version deleted while an undo replays keeps its undo', () => {
  it('the delete records no step and shows no toast; the version cannot be brought back', async () => {
    await mount()
    await reset()
    await select(BV1)
    await run(() => ctx.dismissUndoToast())
    // The person's Undo (the toast's, standing in) of the select is in flight.
    const origSel = holder.adapter.selectBudgetVersion.bind(holder.adapter)
    let release
    const gate = new Promise(r => { release = r })
    holder.adapter.selectBudgetVersion = async (...a) => { await gate; return origSel(...a) }
    let undoing
    await act(async () => { undoing = ctx.undo() })
    // Meanwhile: Manage versions… → Delete Bid v1 (it holds no set-aside row only it holds).
    await press(inBlock().getByRole('button', { name: 'Manage versions…' }))
    const picker = dialog('Bid versions')
    const row = within(picker).getAllByRole('row').find(r => r.textContent.includes(V1))
    await press(within(row).getByRole('button', { name: `Actions for “${V1}”` }))
    await press(screen.getByRole('button', { name: 'Delete…' }))
    const d = dialog(`Delete “${V1}”?`)
    const promised = d.textContent.includes('Undo brings back the version')
    await press(within(d).getByRole('button', { name: 'Delete version' }))
    // It waits its turn behind the undo in flight (before the correction it
    // ran beside it, and recorded nothing).
    expect(ctx.budgetVersions).toHaveLength(2)
    await act(async () => { release(); await undoing })
    await waitFor(() => expect(ctx.budgetVersions).toHaveLength(1))
    const toast = await waitFor(() => screen.getByText(`Deleted “${V1}”`))
    // Ctrl+Z / the queue can only take back older steps now:
    await run(() => ctx.undo())
    await run(() => ctx.undo())
    expect({ promised, toast: !!toast, versionsAfterUndos: ctx.budgetVersions.length })
      .toEqual({ promised: true, toast: true, versionsAfterUndos: 2 })
  })
  it('CONTROL: the same delete with no undo in flight shows the toast and its Undo brings the version back', async () => {
    await mount()
    await reset()
    await select(BV1)
    await press(inBlock().getByRole('button', { name: 'Manage versions…' }))
    const picker = dialog('Bid versions')
    const row = within(picker).getAllByRole('row').find(r => r.textContent.includes(V1))
    await press(within(row).getByRole('button', { name: `Actions for “${V1}”` }))
    await press(screen.getByRole('button', { name: 'Delete…' }))
    await press(within(dialog(`Delete “${V1}”?`)).getByRole('button', { name: 'Delete version' }))
    await waitFor(() => expect(ctx.budgetVersions).toHaveLength(1))
    expect(screen.getByText(`Deleted “${V1}”`)).toBeTruthy()
    await press(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(ctx.budgetVersions).toHaveLength(2))
  })
})

describe('R1-02: the person\'s select waits its turn too', () => {
  it('chosen while an undo replays, it runs after it and records its step (Undo takes it back)', async () => {
    await mount()
    await reset()
    await run(() => ctx.renameBudgetVersion(BV2, 'Renamed'))
    // The rename's undo is in flight, held at its write.
    const origPatch = holder.adapter.patchBudgetVersion.bind(holder.adapter)
    let release
    const gate = new Promise(r => { release = r })
    holder.adapter.patchBudgetVersion = async (...a) => { await gate; return origPatch(...a) }
    let undoing
    await act(async () => { undoing = ctx.undo() })
    let selecting
    await act(async () => { selecting = ctx.selectBudgetVersion(BV1) })
    // Waiting behind the undo, not run beside it.
    expect(ctx.budgetVersions.find(v => v.id === BV1).is_active).toBe(false)
    await act(async () => { release(); await undoing; await selecting })
    holder.adapter.patchBudgetVersion = origPatch
    expect(ctx.budgetVersions.find(v => v.id === BV1).is_active).toBe(true)
    await run(() => ctx.undo())
    expect(ctx.budgetVersions.find(v => v.id === BV2).is_active).toBe(true)
  })
})

describe('R1-01: Set budget active stopped part way', () => {
  it('says it stopped and that the budget is not locked, and the toast is its way back', async () => {
    await mount()
    await reset()
    await select(BV1)
    await run(() => ctx.dismissUndoToast())
    const orig = holder.adapter.updateProject.bind(holder.adapter)
    holder.adapter.updateProject = async (id, fields) => {
      if ('budget_active' in fields) throw new Error('network down')
      return orig(id, fields)
    }
    await press(inBlock().getByRole('button', { name: 'Set budget active' }))
    const d = dialog(`Set “${V1}” active?`)
    await press(within(d).getByRole('button', { name: 'Set budget active' }))
    await waitFor(() => expect(d.textContent).toContain(`Setting “${V1}” active stopped part way: network down. The budget is not locked; Undo takes back what changed.`))
    expect(ctx.project.budget_active).toBe(false)
    expect(screen.getByText('Stopped part way: Undo takes back what changed')).toBeTruthy()
  })
})

describe('R1-01: a version\'s delete stopped part way', () => {
  it('Bid v2\'s 11 set-aside tasks are back on the Timeline under the open Bid v1, no toast, v2 still there — and the one orange Save folds them into v1', async () => {
    await mount()
    await reset()
    await select(BV1)
    await openQuietly(BV1)
    await run(() => ctx.dismissUndoToast())
    expect(ctx.tasks).toHaveLength(31)
    holder.adapter.deleteTask = async () => { throw new Error('network down') }
    await press(inBlock().getByRole('button', { name: 'Manage versions…' }))
    const picker = dialog('Bid versions')
    const row = within(picker).getAllByRole('row').find(r => r.textContent.includes(V2))
    await press(within(row).getByRole('button', { name: `Actions for “${V2}”` }))
    await press(screen.getByRole('button', { name: 'Delete…' }))
    const d = dialog(`Delete “${V2}”?`)
    await press(within(d).getByRole('button', { name: 'Delete version' }))
    await waitFor(() => expect(d.textContent).toContain('network down'))
    await press(within(d).getByRole('button', { name: 'Cancel' }))
    await press(within(dialog('Bid versions')).getAllByRole('button', { name: 'Close' }).find(b => b.classList.contains('ui-btn')))
    const after = {
      tasks: ctx.tasks.length,
      v2: ctx.budgetVersions.some(v => v.id === BV2),
      status: blockEl().querySelector('.rb-bv-open-status').textContent,
      toast: !!screen.queryByRole('button', { name: 'Undo' }),
    }
    await press(within(blockEl()).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(within(blockEl()).getByRole('button', { name: 'Save' }).disabled).toBe(true))
    const v1Tasks = ctx.budgetVersions.find(v => v.id === BV1).snapshot.tasks.length
    expect({ ...after, v1Tasks }).toEqual({ tasks: 31, v2: true, status: expect.stringMatching(/^Saved/), toast: true, v1Tasks: 31 })
  })
})

describe('R1-06 control', () => {
  it('CONTROL: straight from Manage (no delete detour) the unsaved question is asked', async () => {
    await mount()
    await reset()
    await select(BV1)
    await openQuietly(BV1)
    await act(async () => { fireEvent.change(inBlock().getByRole('combobox', { name: 'Based on shot list' }), { target: { value: LIST1 } }) })
    await press(inBlock().getByRole('button', { name: 'Manage versions…' }))
    const picker = dialog('Bid versions')
    const row = within(picker).getAllByRole('row').find(r => r.textContent.includes(V2))
    await press(within(row).getByRole('button', { name: `Actions for “${V2}”` }))
    await press(screen.getAllByRole('button', { name: 'Edit this version' }).find(b => b.classList.contains('ui-menu-item')))
    expect(screen.queryByRole('dialog', { name: `Save the changes to “${V1}” first?` })).toBeTruthy()
  })
})

describe('R1-04: a write in flight across a project switch (S5b R1-05 / S5 R1-03, second look)', () => {
  const P2 = 'p2-review'
  const addP2 = () => fx.store.projects.push({ ...fx.store.projects[0], id: P2, title: 'Other project', open_budget_version_id: null, budget_active: false, budget_active_version_id: null })
  it('addTask (no visit stamp): its step lands on the next project\'s stack, and Ctrl+Z there trashes the first project\'s task', async () => {
    await mount()
    addP2()
    const orig = holder.adapter.upsertTask.bind(holder.adapter)
    let release
    const gate = new Promise(r => { release = r })
    holder.adapter.upsertTask = async (t) => { await gate; return orig(t) }
    let adding
    await act(async () => { adding = ctx.addTask({ title: 'Added in P1', phase_id: ctx.phases[0].id, bid_days: 1 }) })
    await run(() => ctx.setActiveProject(P2))
    await waitFor(() => expect(ctx.project.id).toBe(P2))
    await act(async () => { release(); await adding })
    holder.adapter.upsertTask = orig
    const made = fx.store.tasks.find(t => t.title === 'Added in P1')
    const shownInP2 = ctx.tasks.some(t => t.id === made.id)
    const canUndoInP2 = ctx.canUndo
    await run(() => ctx.undo())
    const trashedInP1 = !!fx.store.tasks.find(t => t.id === made.id)?.deleted_at
    expect({ madeIn: made.project_id, shownInP2, canUndoInP2, trashedInP1 })
      .toEqual({ madeIn: PROJECT_ID, shownInP2: false, canUndoInP2: false, trashedInP1: false })
  })
  // The same for the two other creates (by trace in the report; held here):
  // a phase, and a key date — whose undo DESTROYS, so on the other project's
  // stack it would erase this project's key date for good.
  for (const [what, method, add, rows] of [
    ['addPhase', 'upsertPhase', (c) => c.addPhase({ name: 'Added in P1' }), (s) => s.phases],
    ['addMilestone', 'upsertMilestone', (c) => c.addMilestone({ title: 'Added in P1', date: '2026-12-01' }), (s) => s.milestones],
  ]) {
    it(`${what}: answering after the switch, it is not shown in the next project and leaves no step there`, async () => {
      await mount()
      addP2()
      const orig = holder.adapter[method].bind(holder.adapter)
      let release
      const gate = new Promise(r => { release = r })
      holder.adapter[method] = async (row) => { await gate; return orig(row) }
      let adding
      await act(async () => { adding = add(ctx) })
      await run(() => ctx.setActiveProject(P2))
      await waitFor(() => expect(ctx.project.id).toBe(P2))
      await act(async () => { release(); await adding })
      holder.adapter[method] = orig
      const made = rows(fx.store).find(r => (r.name || r.title) === 'Added in P1')
      const shownInP2 = [...ctx.phases, ...ctx.milestones].some(r => r.id === made.id)
      expect({ madeIn: made.project_id, shownInP2, canUndoInP2: ctx.canUndo })
        .toEqual({ madeIn: PROJECT_ID, shownInP2: false, canUndoInP2: false })
    })
  }
  it('reviveBudgetRow (compositeGuard checks before the write, not after): the revived row lands in the next project\'s Timeline', async () => {
    await mount()
    addP2()
    await reset()
    await select(BV1)
    const t = ctx.tasks[0] // Bid v1 holds it
    await run(() => ctx.deleteTask(t.id))
    expect(ctx.tasks.some(x => x.id === t.id)).toBe(false)
    const orig = holder.adapter.upsertTask.bind(holder.adapter)
    let release
    let reached
    const atUpsert = new Promise(r => { reached = r })
    const gate = new Promise(r => { release = r })
    holder.adapter.upsertTask = async (row) => { reached(); await gate; return orig(row) }
    let opening
    await act(async () => { opening = ctx.openBudgetVersion(BV1, { roleRates: RATES }).catch(e => e) })
    await act(async () => { await atUpsert })
    await run(() => ctx.setActiveProject(P2))
    await waitFor(() => expect(ctx.project.id).toBe(P2))
    let outcome
    await act(async () => { release(); outcome = await opening })
    holder.adapter.upsertTask = orig
    const leaked = ctx.tasks.filter(x => x.id === t.id).map(x => x.project_id)
    expect({ stopped: /another project was opened/.test(outcome?.message || ''), project: ctx.project.id, leaked })
      .toEqual({ stopped: true, project: P2, leaked: [] })
  })
})
