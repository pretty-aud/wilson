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
// Review round 2 (its proofs, on f3e502bf; adapted where the correction
// chose a different right answer, said at each):
//   R2-01 on the Local Server a step stopped part way keeps the tasks it
//         deleted within reach of its Undo
//   R2-03 a version step refuses while an undo still replays past the
//         queue's wait
//   R2-04 a version's list choice does not come back when it opens again
//   R2-05 every step that records offers the toast; a Save as new stopped
//         after making the version says so and offers only Close
//   R2-06 a version's delete undone after another was selected keeps one
//         selected
//   R2-07 the creates R1-04 missed stay home across a project switch
//   R2-08 an open or a lock that changed nothing says so, and offers no Undo
//   R2-09 the toast of a step stopped part way stays while it is promised
//   and, found during round 2: the toast names the step's own entry
// =============================================================================
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import React from 'react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
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
afterEach(() => {
  cleanup(); ctx = null; fx = null
  delete globalThis.__WILSON_TEST_HISTORY_STEP_WAIT_MS
  delete globalThis.__WILSON_TEST_UNDO_TOAST_MS
})

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

describe('the toast names the step\'s own entry, not one that ran before it (S5c, found during review round 2)', () => {
  // A version step waits its turn in the undo queue; the top of the stack at
  // the asking is no measure of what IT recorded.
  const deleteV1ThroughManage = async () => {
    await press(inBlock().getByRole('button', { name: 'Manage versions…' }))
    const picker = dialog('Bid versions')
    const row = within(picker).getAllByRole('row').find(r => r.textContent.includes(V1))
    await press(within(row).getByRole('button', { name: `Actions for “${V1}”` }))
    await press(screen.getByRole('button', { name: 'Delete…' }))
    const d = dialog(`Delete “${V1}”?`)
    await press(within(d).getByRole('button', { name: 'Delete version' }))
    return d
  }
  it('a select in flight records its step; the delete asked meanwhile fails before recording anything: no toast offers to undo the select', async () => {
    await mount()
    await reset()
    await run(() => ctx.dismissUndoToast())
    const origSel = holder.adapter.selectBudgetVersion.bind(holder.adapter)
    let release
    const gate = new Promise(r => { release = r })
    holder.adapter.selectBudgetVersion = async (...a) => { await gate; return origSel(...a) }
    let selecting
    await act(async () => { selecting = ctx.selectBudgetVersion(BV1) })
    holder.adapter.deleteBudgetVersion = async () => { throw new Error('network down') }
    const d = await deleteV1ThroughManage()
    await act(async () => { release(); await selecting })
    await waitFor(() => expect(d.textContent).toContain('network down'))
    expect(ctx.budgetVersions.find(v => v.id === BV1).is_active).toBe(true)
    // Nothing of the delete landed: no toast; the select stays chosen.
    expect(screen.queryByText('Stopped part way: Undo takes back what changed')).toBeNull()
  })
  it('CONTROL: the same delete answering, with the select in flight before it: the toast is the delete\'s and its Undo brings the version back', async () => {
    await mount()
    await reset()
    await run(() => ctx.dismissUndoToast())
    const origSel = holder.adapter.selectBudgetVersion.bind(holder.adapter)
    let release
    const gate = new Promise(r => { release = r })
    holder.adapter.selectBudgetVersion = async (...a) => { await gate; return origSel(...a) }
    let selecting
    await act(async () => { selecting = ctx.selectBudgetVersion(BV1) })
    await deleteV1ThroughManage()
    await act(async () => { release(); await selecting })
    await waitFor(() => expect(ctx.budgetVersions).toHaveLength(1))
    await waitFor(() => expect(screen.getByText(`Deleted “${V1}”`)).toBeTruthy())
    await press(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(ctx.budgetVersions).toHaveLength(2))
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

// ── Review round 2 ──────────────────────────────────────────────────────────

const status = () => blockEl().querySelector('.rb-bv-open-status').textContent

// The Local Server's shape (electron/main.cjs rabbitSubentityRoutes('tasks' |
// 'phases'): no softDelete, so no restore route; its DELETE removes the row;
// localServerAdapter has no restoreTask / restorePhase). `failAt`: the nth
// task DELETE answers 500.
function asLocalServer(failAt) {
  delete holder.adapter.restoreTask
  delete holder.adapter.restorePhase
  let n = 0
  holder.adapter.deleteTask = async (id) => {
    n += 1
    if (n === failAt) throw new Error('[localServer] HTTP 500')
    const i = fx.store.tasks.findIndex(t => t.id === id)
    if (i >= 0) fx.store.tasks.splice(i, 1)
  }
}

async function deleteFromManage(name) {
  await press(inBlock().getByRole('button', { name: 'Manage versions…' }))
  const picker = dialog('Bid versions')
  const row = within(picker).getAllByRole('row').find(r => r.textContent.includes(name))
  await press(within(row).getByRole('button', { name: `Actions for “${name}”` }))
  await press(screen.getByRole('button', { name: 'Delete…' }))
  const d = dialog(`Delete “${name}”?`)
  await press(within(d).getByRole('button', { name: 'Delete version' }))
  return d
}

describe('R2-01: on the Local Server a step stopped part way keeps what it deleted within reach of its Undo', () => {
  it('a version delete stopped at its 3rd task: the 2 that went leave the screen, the rest go aside again, and the toast\'s Undo brings all 11 back', async () => {
    await mount()
    await reset()
    await select(BV1)
    await openQuietly(BV1)
    await run(() => ctx.dismissUndoToast())
    const onlyV2 = ctx.setAsideTasks.map(t => t.id)
    expect(onlyV2).toHaveLength(11)
    asLocalServer(3)
    const d = await deleteFromManage(V2)
    await waitFor(() => expect(d.textContent).toContain('HTTP 500'))
    const toastSaid = !!screen.queryByText('Stopped part way: Undo takes back what changed')
    const shown = {
      live: ctx.tasks.filter(t => onlyV2.includes(t.id)).length,
      aside: ctx.setAsideTasks.filter(t => onlyV2.includes(t.id)).length,
    }
    await press(within(d).getByRole('button', { name: 'Cancel' }))
    await press(within(dialog('Bid versions')).getAllByRole('button', { name: 'Close' }).find(b => b.classList.contains('ui-btn')))
    await press(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(ctx.setAsideTasks.filter(t => onlyV2.includes(t.id))).toHaveLength(11))
    expect({
      toastSaid,
      shown,
      onDisk: onlyV2.filter(id => fx.store.tasks.some(t => t.id === id)).length,
      v2: ctx.budgetVersions.some(v => v.id === BV2),
    }).toEqual({ toastSaid: true, shown: { live: 0, aside: 9 }, onDisk: 11, v2: true })
  })

  it('the delete\'s error says which went and which stayed: 2 deleted, the 9 others not', async () => {
    await mount()
    await reset()
    await select(BV1)
    await openQuietly(BV1)
    asLocalServer(3)
    let err
    await act(async () => { err = await ctx.deleteBudgetVersion(BV2).then(() => null, (e) => e) })
    expect({ deleted: err?.deletedIds?.length, notDeleted: err?.notDeleted?.tasks?.length })
      .toEqual({ deleted: 2, notDeleted: 9 })
  })

  it('Edit this version → Discard, stopped at its 2nd task: "Undo takes back what changed" — and Undo brings the discarded task back, on disk and on screen', async () => {
    await mount()
    await reset()
    await select(BV1)
    await openQuietly(BV1)
    await run(() => ctx.addTask({ title: 'Pickup A', phase_id: ctx.phases[0].id, bid_days: 1 }))
    await run(() => ctx.addTask({ title: 'Pickup B', phase_id: ctx.phases[0].id, bid_days: 1 }))
    const a = ctx.tasks.find(t => t.title === 'Pickup A')
    await select(BV2)
    await run(() => ctx.dismissUndoToast())
    asLocalServer(2)
    await press(inBlock().getByRole('button', { name: 'Edit this version' }))
    await press(within(dialog(`Save the changes to “${V1}” first?`)).getByRole('button', { name: 'Discard changes' }))
    const d = dialog(`Edit “${V2}”?`)
    await press(within(d).getByRole('button', { name: 'Edit this version' }))
    await waitFor(() => expect(d.textContent).toContain('stopped part way'))
    const said = d.textContent.match(/Opening[^]*?changed\./)?.[0]
    const goneMeanwhile = !ctx.tasks.some(t => t.id === a.id)
    await press(within(d).getByRole('button', { name: 'Cancel' }))
    await press(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(ctx.project.open_budget_version_id).toBe(BV1))
    await waitFor(() => expect(ctx.tasks.some(t => t.id === a.id)).toBe(true))
    expect({ said, goneMeanwhile, aOnDisk: fx.store.tasks.some(t => t.id === a.id) })
      .toEqual({ said: expect.stringContaining('No version is open now; Undo takes back what changed.'), goneMeanwhile: true, aOnDisk: true })
  })
})

describe('R2-03: a version step refuses while an undo still replays past the queue\'s wait', () => {
  // The reviewer's proof asserted the delete recorded beside the replay; the
  // correction refuses it instead, with a sentence (their fix direction).
  it('the undo stalled past the wait: the delete is refused and says why, nothing deleted; once the undo ends the same delete records its step, and Undo brings the version back', async () => {
    globalThis.__WILSON_TEST_HISTORY_STEP_WAIT_MS = 50
    await mount()
    await reset()
    await select(BV1)
    await run(() => ctx.dismissUndoToast())
    const origSel = holder.adapter.selectBudgetVersion.bind(holder.adapter)
    let release
    const gate = new Promise(r => { release = r })
    holder.adapter.selectBudgetVersion = async (...a) => { await gate; return origSel(...a) }
    let undoing
    await act(async () => { undoing = ctx.undo() })
    const d = await deleteFromManage(V1)
    await waitFor(() => expect(d.textContent).toContain('an Undo is still running — try again once it has finished'), { timeout: 2000 })
    expect(ctx.budgetVersions).toHaveLength(2)
    await act(async () => { release(); await undoing })
    holder.adapter.selectBudgetVersion = origSel
    await press(within(d).getByRole('button', { name: 'Delete version' }))
    await waitFor(() => expect(ctx.budgetVersions).toHaveLength(1))
    await waitFor(() => expect(screen.getByText(`Deleted “${V1}”`)).toBeTruthy())
    await press(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(ctx.budgetVersions).toHaveLength(2))
  })
})

describe('R2-03: every queued version step refuses while a replay still runs past the wait', () => {
  for (const [what, call] of [
    ['select', (c) => c.selectBudgetVersion(BV2)],
    ['rename', (c) => c.renameBudgetVersion(BV2, 'Renamed')],
    ['note', (c) => c.updateBudgetVersionSummary(BV2, 'A note')],
    ['Save', (c) => c.saveBudgetVersion(BV1, { roleRates: RATES })],
    ['Save as new version', (c) => c.createBudgetVersion({ name: 'Mid ROM', roleRates: RATES })],
    ['Edit this version', (c) => c.openBudgetVersion(BV2, { roleRates: RATES })],
    ['Set budget active', (c) => c.activateBudget(BV2, { roleRates: RATES })],
    ['Reset to bidding', (c) => c.resetToBidding()],
    ['delete', (c) => c.deleteBudgetVersion(BV2)],
  ]) {
    it(`${what}: refused, and says why`, async () => {
      globalThis.__WILSON_TEST_HISTORY_STEP_WAIT_MS = 50
      await mount()
      await reset()
      await openQuietly(BV1)
      await select(BV2)
      // The select's undo (Bid v1 selected again) is held at its write.
      const origSel = holder.adapter.selectBudgetVersion.bind(holder.adapter)
      let release
      const gate = new Promise(r => { release = r })
      holder.adapter.selectBudgetVersion = async (...a) => { await gate; return origSel(...a) }
      let undoing
      await act(async () => { undoing = ctx.undo() })
      let outcome
      await act(async () => { outcome = await call(ctx).then(() => 'ran', (e) => e?.message) })
      await act(async () => { release(); await undoing })
      holder.adapter.selectBudgetVersion = origSel
      expect(outcome).toBe('an Undo is still running — try again once it has finished')
    })
  }
})

describe('R2-04: a version\'s list choice does not come back when that version opens again', () => {
  it('v1 + a list choice; open v2; open v1 again: v1 reads "Saved", the choice untouched', async () => {
    await mount()
    await reset()
    await select(BV1)
    await openQuietly(BV1)
    await act(async () => { fireEvent.change(inBlock().getByRole('combobox', { name: 'Based on shot list' }), { target: { value: LIST1 } }) })
    expect(status()).toBe('Unsaved changes')
    await openQuietly(BV2)
    await waitFor(() => expect(ctx.project.open_budget_version_id).toBe(BV2))
    await openQuietly(BV1)
    await waitFor(() => expect(ctx.project.open_budget_version_id).toBe(BV1))
    expect({ status: status(), basedOn: inBlock().getByRole('combobox', { name: 'Based on shot list' }).value })
      .toEqual({ status: expect.stringMatching(/^Saved /), basedOn: '' })
  })
  it('through the questions: the change Discarded, then the toast\'s Undo reopens v1 — the discarded choice stays discarded', async () => {
    await mount()
    await reset()
    await select(BV1)
    await openQuietly(BV1)
    await act(async () => { fireEvent.change(inBlock().getByRole('combobox', { name: 'Based on shot list' }), { target: { value: LIST1 } }) })
    await run(() => ctx.dismissUndoToast())
    await press(inBlock().getByRole('button', { name: 'Manage versions…' }))
    const picker = dialog('Bid versions')
    const row = within(picker).getAllByRole('row').find(r => r.textContent.includes(V2))
    await press(within(row).getByRole('button', { name: `Actions for “${V2}”` }))
    await press(screen.getAllByRole('button', { name: 'Edit this version' }).find(b => b.classList.contains('ui-menu-item')))
    await press(within(dialog(`Save the changes to “${V1}” first?`)).getByRole('button', { name: 'Discard changes' }))
    await press(within(dialog(`Edit “${V2}”?`)).getByRole('button', { name: 'Edit this version' }))
    await waitFor(() => expect(ctx.project.open_budget_version_id).toBe(BV2))
    await press(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(ctx.project.open_budget_version_id).toBe(BV1))
    expect({ status: status(), basedOn: inBlock().getByRole('combobox', { name: 'Based on shot list' }).value })
      .toEqual({ status: expect.stringMatching(/^Saved /), basedOn: '' })
  })
})

describe('R2-05: every step that records offers its toast', () => {
  it('Save as new version… stopped after the version was made: it says so, the toast holds its Undo, and the form offers only Close — one version, never two', async () => {
    await mount()
    await reset()
    await select(BV1)
    await openQuietly(BV1)
    await run(() => ctx.dismissUndoToast())
    const orig = holder.adapter.updateProject.bind(holder.adapter)
    holder.adapter.updateProject = async (id, fields) => {
      if ('open_budget_version_id' in fields) throw new Error('network down')
      return orig(id, fields)
    }
    await press(inBlock().getByRole('button', { name: 'Save as new version…' }))
    const d = dialog('Save as new version')
    fireEvent.change(within(d).getByRole('textbox', { name: 'Name' }), { target: { value: 'Mid ROM' } })
    await press(within(d).getByRole('button', { name: 'Save as new version' }))
    await waitFor(() => expect(d.textContent).toContain('network down'))
    const seen = {
      said: d.textContent.includes('“Mid ROM” was saved as a new version, then the step stopped part way: network down. Undo takes back what changed.'),
      recorded: ctx.canUndo,
      toast: !!screen.queryByRole('button', { name: 'Undo' }),
      saveLive: !within(d).getByRole('button', { name: 'Save as new version' }).disabled,
    }
    holder.adapter.updateProject = orig
    await press(within(d).getAllByRole('button', { name: 'Close' }).find(b => b.classList.contains('ui-btn')))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Save as new version' })).toBeNull())
    expect({ ...seen, midRoms: ctx.budgetVersions.filter(v => v.name === 'Mid ROM').length })
      .toEqual({ said: true, recorded: true, toast: true, saveLive: false, midRoms: 1 })
  })

  it('the block\'s Save stopped part way (deleting a row no version holds any more): the toast is its way back', async () => {
    await mount()
    await reset()
    await select(BV2)
    await openQuietly(BV2)
    // A task Bid v1 holds too, removed from the open Bid v2: set aside (v1 holds it).
    const v1Ids = new Set(BUDGET_VERSIONS.find(v => v.id === BV1).snapshot.tasks.map(t => t.id))
    const x = ctx.tasks.find(t => v1Ids.has(t.id))
    await run(() => ctx.deleteTask(x.id))
    expect(ctx.setAsideTasks.some(t => t.id === x.id)).toBe(true)
    // Another window deletes Bid v1 (versions are not broadcast): no version
    // but the open one's saved snapshot holds the row now, so Save deletes it.
    await act(async () => { await holder.adapter.deleteBudgetVersion(BV1, PROJECT_ID) })
    await run(() => ctx.reloadActiveProject())
    await waitFor(() => expect(ctx.budgetVersions).toHaveLength(1))
    await run(() => ctx.dismissUndoToast())
    holder.adapter.deleteTask = async () => { throw new Error('network down') }
    await press(within(blockEl()).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(blockEl().textContent).toContain('network down'))
    expect({
      toast: !!screen.queryByText('Stopped part way: Undo takes back what changed'),
      stillAside: ctx.setAsideTasks.some(t => t.id === x.id),
    }).toEqual({ toast: true, stillAside: true })
  })

  it('every recording version step in the Budget\'s files runs through the undo toast (source pin)', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const offenders = []
    for (const f of ['./BidVersions.jsx', './VersionQuestions.jsx', '../BudgetView.jsx']) {
      const lines = readFileSync(join(here, f), 'utf8').replace(/\r\n/g, '\n').split('\n')
      lines.forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return
        if (!/ctx\.(saveBudgetVersion|createBudgetVersion|openBudgetVersion|activateBudget|deleteBudgetVersion|resetToBidding)\(/.test(line)) return
        const span = `${lines[i - 1] || ''} ${line}`
        if (!/\b(step|runWithUndoToast)\(/.test(span)) offenders.push(`${f}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
  })
  it('CONTROL: the pin reads a bare call as one', () => {
    const line = '          await ctx.saveBudgetVersion(p.unsaved.version.id, { roleRates })'
    expect(/\b(step|runWithUndoToast)\(/.test(line)).toBe(false)
    expect(/ctx\.(saveBudgetVersion|createBudgetVersion)\(/.test(line)).toBe(true)
  })
})

describe('R2-06: a version\'s delete undone after another was selected', () => {
  it('delete the selected v2, select v1, then the toast\'s Undo: v2 comes back unselected — one selected bid, v1, in memory and on disk', async () => {
    await mount()
    await reset()
    await select(BV2)
    await run(() => ctx.dismissUndoToast())
    await deleteFromManage(V2)
    await waitFor(() => expect(ctx.budgetVersions).toHaveLength(1))
    const picker = dialog('Bid versions')
    const row = within(picker).getAllByRole('row').find(r => r.textContent.includes(V1))
    await press(within(row).getByRole('button', { name: `Actions for “${V1}”` }))
    await press(screen.getByRole('button', { name: 'Select as the bid' }))
    await waitFor(() => expect(ctx.budgetVersions.find(v => v.id === BV1).is_active).toBe(true))
    await press(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(ctx.budgetVersions).toHaveLength(2))
    expect({
      flagged: ctx.budgetVersions.filter(v => v.is_active).map(v => v.name).sort(),
      onDisk: fx.store.budgetVersions.filter(v => v.is_active).length,
    }).toEqual({ flagged: [V1], onDisk: 1 })
  })
  it('CONTROL: with nothing selected since, the Undo brings it back selected', async () => {
    await mount()
    await reset()
    await select(BV2)
    await run(() => ctx.dismissUndoToast())
    await deleteFromManage(V2)
    await waitFor(() => expect(ctx.budgetVersions).toHaveLength(1))
    await press(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(ctx.budgetVersions).toHaveLength(2))
    expect(ctx.budgetVersions.filter(v => v.is_active).map(v => v.name)).toEqual([V2])
  })
})

describe('R2-07: the creates R1-04 missed stay home across a project switch', () => {
  const P2 = 'p2-review'
  for (const [what, method, add, rows, inBundle] of [
    ['addAsset', 'upsertAsset', (c) => c.addAsset({ name: 'Added in P1' }), (s) => s.assets, (c) => c.assets],
    ['addScene', 'upsertScene', (c) => c.addScene({ name: 'Added in P1' }), (s) => s.scenes, (c) => c.scenes],
    ['addShot', 'upsertShot', (c) => c.addShot({ name: 'Added in P1' }), (s) => s.shots, (c) => c.shots],
    ['addLevel', 'upsertLevel', (c) => c.addLevel({ name: 'Added in P1' }), (s) => s.levels, (c) => c.levels],
    ['addExperience', 'upsertExperience', (c) => c.addExperience({ name: 'Added in P1' }), (s) => s.experiences, (c) => c.experiences],
  ]) {
    it(`${what}: answering after the switch, it is not shown in the next project and leaves no step there`, async () => {
      await mount()
      fx.store.projects.push({ ...fx.store.projects[0], id: P2, title: 'Other project', open_budget_version_id: null, budget_active: false, budget_active_version_id: null })
      const orig = holder.adapter[method].bind(holder.adapter)
      let release
      const gate = new Promise(r => { release = r })
      holder.adapter[method] = async (row) => { await gate; return orig(row) }
      let adding
      await act(async () => { adding = add(ctx).catch(e => e) })
      await run(() => ctx.setActiveProject(P2))
      await waitFor(() => expect(ctx.project.id).toBe(P2))
      await act(async () => { release(); await adding })
      holder.adapter[method] = orig
      const made = (rows(fx.store) || []).find(r => r.name === 'Added in P1')
      expect({ madeIn: made?.project_id, shownInP2: (inBundle(ctx) || []).some(r => r.id === made?.id), canUndoInP2: ctx.canUndo })
        .toEqual({ madeIn: PROJECT_ID, shownInP2: false, canUndoInP2: false })
    })
  }
})

describe('R2-08: an open or a lock that changed nothing says so', () => {
  it('Edit this version stopped at its first write (closing the open version): "Nothing changed", the version open before still open, no Undo offered', async () => {
    await mount()
    await reset()
    await select(BV1)
    await openQuietly(BV1)
    await select(BV2)
    await run(() => ctx.dismissUndoToast())
    const orig = holder.adapter.updateProject.bind(holder.adapter)
    holder.adapter.updateProject = async (id, fields) => {
      if ('open_budget_version_id' in fields && fields.open_budget_version_id === null) throw new Error('network down')
      return orig(id, fields)
    }
    await press(inBlock().getByRole('button', { name: 'Edit this version' }))
    const d = dialog(`Edit “${V2}”?`)
    await press(within(d).getByRole('button', { name: 'Edit this version' }))
    await waitFor(() => expect(d.textContent).toContain('Nothing changed'))
    expect({
      said: d.textContent.includes(`Could not open “${V2}”: network down. Nothing changed.`),
      open: ctx.project.open_budget_version_id,
      undoOffered: !!screen.queryByRole('button', { name: 'Undo' }),
    }).toEqual({ said: true, open: BV1, undoOffered: false })
  })
  it('Set budget active stopped at its first write: "Nothing changed", no Undo offered', async () => {
    await mount()
    await reset()
    await select(BV1)
    await openQuietly(BV1)
    await run(() => ctx.dismissUndoToast())
    const orig = holder.adapter.updateProject.bind(holder.adapter)
    holder.adapter.updateProject = async (id, fields) => {
      if ('open_budget_version_id' in fields && fields.open_budget_version_id === null) throw new Error('network down')
      return orig(id, fields)
    }
    await press(inBlock().getByRole('button', { name: 'Set budget active' }))
    const d = dialog(`Set “${V1}” active?`)
    await press(within(d).getByRole('button', { name: 'Set budget active' }))
    await waitFor(() => expect(d.textContent).toContain('Nothing changed'))
    expect({
      said: d.textContent.includes(`Could not set “${V1}” active: network down. Nothing changed.`),
      locked: ctx.project.budget_active,
      undoOffered: !!screen.queryByRole('button', { name: 'Undo' }),
    }).toEqual({ said: true, locked: false, undoOffered: false })
  })
})

describe('R2-09: the toast of a step stopped part way stays while it is promised', () => {
  it('Set budget active stopped part way: past the toast\'s time the question still says "Undo takes back what changed", and the toast\'s Undo is still there', async () => {
    globalThis.__WILSON_TEST_UNDO_TOAST_MS = 150
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
    await waitFor(() => expect(d.textContent).toContain('Undo takes back what changed'))
    await act(async () => { await new Promise(r => setTimeout(r, 450)) })
    expect({
      sentenceStill: d.isConnected && d.textContent.includes('Undo takes back what changed'),
      anyUndo: !!screen.queryByRole('button', { name: 'Undo' }),
      stepStillOnStack: ctx.canUndo,
    }).toEqual({ sentenceStill: true, anyUndo: true, stepStillOnStack: true })
  })
  it('CONTROL: an ordinary toast (a version deleted) still goes at its time', async () => {
    globalThis.__WILSON_TEST_UNDO_TOAST_MS = 150
    await mount()
    await reset()
    await select(BV2)
    await deleteFromManage(V1)
    await waitFor(() => expect(screen.getByText(`Deleted “${V1}”`)).toBeTruthy())
    await act(async () => { await new Promise(r => setTimeout(r, 450)) })
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })
})
