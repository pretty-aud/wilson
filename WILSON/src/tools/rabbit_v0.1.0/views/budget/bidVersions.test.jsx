/** @vitest-environment jsdom */
// =============================================================================
// bidVersions.test.jsx — post-overhaul S5c, steps 3–5: the Budget Summary's
// bid versions block and its questions, through the REAL provider over the
// REAL dev dataset ("Salt Hours": Bid v1 holds the first thirty-one tasks,
// Bid v2 all forty-two and is LOCKED and selected), driven as a person drives
// them — the buttons, the dropdown, the questions' answers, the undo toast.
//
// Audrey's model (F2, F9; her ruling (a)): a bid version is a living
// document — one OPEN (Save writes back into it), one SELECTED (the
// variance's baseline), one LOCKED (nothing opens; Save as new version only
// records). Each version shows exactly its own schedule: rows it does not
// hold LEAVE the Timeline and COME BACK, never lost.
//
// rabbitBudgetRender.test.jsx holds the block's look on a fake context;
// versionWords.test.js every sentence; setAsideProvider.test.jsx the
// provider's own constraints. This file holds what joins them: that the
// screen reaches the provider's verbs with the person's answers, and says
// what they did.
// =============================================================================
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import React from 'react'
import { render, cleanup, act, waitFor, screen, within, fireEvent } from '@testing-library/react'

const holder = vi.hoisted(() => ({ adapter: null, projectId: null }))

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
// BudgetView's module graph (the render test's mocks): its hooks reach the
// cloud client and the permission hook at import; SummaryTab is mounted here
// with its props handed in and calls neither.
vi.mock('../../../../permissions/usePermissions', () => ({ usePermissions: () => ({ role: 'admin', ready: true }) }))
vi.mock('../../../../components/RateCard/useRateCard', () => ({ useRateCard: () => ({ entries: [], rateCards: [] }) }))

const { buildDevFixtures } = await import('../../../../dev/fixtures/install')
const { PROJECT_ID, TASK_ID } = await import('../../../../dev/fixtures/data/project')
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
// The dataset's own rates (its rate card): the live schedule after Reset to
// bidding matches Bid v2 exactly, as setAsideProvider.test.jsx measured.
const RATES = BUDGET_VERSIONS.find(v => v.id === BV2).snapshot.roleRates
const T40 = TASK_ID(40)
// The dataset's own task with work on it that Bid v1 does not hold.
const WORKED = 'Call sheet template'

let ctx = null
let fx = null
let t40Title = null

/** BudgetView's Summary as BudgetView mounts it, with the dataset's rates, and the app's undo toast. */
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
        roleRates={RATES}
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

beforeEach(async () => {
  fx = buildDevFixtures()
  // Task 40 is NOT in Bid v1, and it carries work: logged days and a comment.
  const t40 = fx.store.tasks.find(t => t.id === T40)
  t40.logged_days = 1.5
  t40Title = t40.title
  fx.store.comments.push({ id: 'c-t40', entity_type: 'task', entity_id: T40, body: 'Keep the warm key', created_at: '2026-10-01T10:00:00Z' })
  holder.adapter = fx.rabbitAdapter()
  render(<RabbitProvider><Harness /></RabbitProvider>)
  await waitFor(() => expect(ctx?.project?.id).toBe(PROJECT_ID))
  await waitFor(() => expect(ctx.budgetVersions.length).toBe(2))
})
afterEach(() => { cleanup(); ctx = null; fx = null })

const blockEl = () => document.querySelector('section.rb-bv-block')
const inBlock = () => within(blockEl())
const press = (el) => act(async () => { fireEvent.click(el) })
const dialog = (name) => screen.getByRole('dialog', { name })
const footerWords = (d) => [...d.querySelectorAll('.ui-dialog-foot button')].map(b => b.textContent)
const run = (fn) => act(async () => { await fn() })
const reset = () => run(() => ctx.resetToBidding())
const select = (id) => run(() => ctx.selectBudgetVersion(id))
const openQuietly = (id) => run(() => ctx.openBudgetVersion(id, { roleRates: RATES }))
const selected = () => ctx.budgetVersions.find(v => v.is_active)?.id

describe('under the lock (F9)', () => {
  it('Save as new version… records a copy — not opened, not selected — the form focuses its Name with Cancel first, the toast says it, and its Undo takes the copy back', async () => {
    expect(screen.getByText('Budget active — in production')).toBeTruthy()
    await press(inBlock().getByRole('button', { name: 'Save as new version…' }))
    const d = dialog('Save as new version')
    expect(d.textContent).toContain(`It is not opened or selected: the budget stays locked to “${V2}”.`)
    expect(document.activeElement).toBe(within(d).getByRole('textbox', { name: 'Name' }))
    expect(footerWords(d)).toEqual(['Cancel', 'Save as new version'])
    fireEvent.change(within(d).getByRole('textbox', { name: 'Name' }), { target: { value: 'Revision after week 2' } })
    await press(within(d).getByRole('button', { name: 'Save as new version' }))
    await waitFor(() => expect(ctx.budgetVersions).toHaveLength(3))
    const made = ctx.budgetVersions.find(v => v.name === 'Revision after week 2')
    expect(made.is_active).toBe(false)
    expect(ctx.project.open_budget_version_id ?? null).toBeNull()
    expect(selected()).toBe(BV2)
    await waitFor(() => expect(screen.getByText('Recorded “Revision after week 2”; the lock is unchanged')).toBeTruthy())
    await press(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(ctx.budgetVersions).toHaveLength(2))
  })

  it('Edit this version is greyed with the reason shown; the selected bid cannot be changed', () => {
    expect(inBlock().getByRole('button', { name: 'Edit this version' }).disabled).toBe(true)
    expect(blockEl().querySelector('.rb-bv-why').textContent).toBe('While the budget is active no version is opened: Reset to bidding first.')
    expect(inBlock().getByRole('combobox', { name: 'Selected bid' }).disabled).toBe(true)
  })

  it('Reset to bidding: one click, the toast its way back — Undo locks the same bid again and leaves the schedule as it was', async () => {
    const before = ctx.tasks.map(t => t.id).sort()
    await press(screen.getByRole('button', { name: 'Reset to bidding' }))
    await waitFor(() => expect(ctx.project.budget_active).toBe(false))
    expect(screen.getByText(`Back to bidding: “${V2}” is no longer locked`)).toBeTruthy()
    expect(screen.queryByText('Budget active — in production')).toBeNull()
    await press(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(ctx.project.budget_active).toBe(true))
    expect(ctx.project.budget_active_version_id).toBe(BV2)
    expect(ctx.tasks.map(t => t.id).sort()).toEqual(before)
  })
})

describe('Edit this version (F2; ruling (a); steps 4 and 5)', () => {
  it('names what leaves the Timeline — the worked row first, with the checkbox OFF — opens it, says so in the toast, and nothing is unsaved after', async () => {
    await reset()
    // The dropdown selects at once (F13): the provider's verb, no question.
    await act(async () => { fireEvent.change(inBlock().getByRole('combobox', { name: 'Selected bid' }), { target: { value: BV1 } }) })
    await waitFor(() => expect(selected()).toBe(BV1))
    await press(inBlock().getByRole('button', { name: 'Edit this version' }))
    const d = dialog(`Edit “${V1}”?`)
    expect(document.activeElement.textContent).toBe('Cancel')
    expect(footerWords(d)).toEqual(['Cancel', 'Edit this version'])
    // Two of the eleven carry work: the dataset's own "Call sheet template"
    // (logged days and a file) and task 40 (this file's): named first.
    expect(d.textContent).toContain(`11 tasks that are not part of it leave the Timeline: “${WORKED}”, “${t40Title}”,`)
    expect(d.textContent).toContain(`2 of them have work on them: “${WORKED}” (0.5 days logged and 1 file) and “${t40Title}” (1.5 days logged and 1 comment).`)
    const keep = within(d).getByRole('checkbox', { name: `Keep them on the Timeline in “${V1}” (they become unsaved changes)` })
    expect(keep.checked).toBe(false)
    await press(within(d).getByRole('button', { name: 'Edit this version' }))
    await waitFor(() => expect(ctx.project.open_budget_version_id).toBe(BV1))
    expect(ctx.tasks).toHaveLength(31)
    expect(ctx.setAsideTasks.some(t => t.id === T40)).toBe(true)
    expect(screen.getByText(`Editing “${V1}”: 11 tasks left the Timeline`)).toBeTruthy()
    // Step 5: right after the open, nothing is unsaved.
    const b = blockEl()
    expect(b.querySelector('.rb-bv-open-name').textContent).toBe(V1)
    expect(b.querySelector('.rb-bv-open-status').textContent).toMatch(/^Saved /)
    expect(within(b).getByRole('button', { name: 'Save' }).disabled).toBe(true)
    expect(b.querySelector('.ui-btn-attention')).toBeNull()
  })

  it('constraint 4: ticked, the worked row stays on the Timeline in the version opened — and that is an unsaved change at once', async () => {
    await reset()
    await select(BV1)
    await press(inBlock().getByRole('button', { name: 'Edit this version' }))
    const d = dialog(`Edit “${V1}”?`)
    await press(within(d).getByRole('checkbox'))
    // Ticked, the two worked rows no longer leave — and the box stays, under the pointer.
    expect(d.textContent).toContain('9 tasks that are not part of it leave the Timeline')
    expect(within(d).getByRole('checkbox').checked).toBe(true)
    await press(within(d).getByRole('button', { name: 'Edit this version' }))
    await waitFor(() => expect(ctx.project.open_budget_version_id).toBe(BV1))
    expect(ctx.tasks.some(t => t.id === T40)).toBe(true)
    expect(ctx.tasks.some(t => t.title === WORKED)).toBe(true)
    expect(ctx.tasks).toHaveLength(33)
    expect(blockEl().querySelector('.rb-bv-open-status').textContent).toBe('Unsaved changes')
    expect(within(blockEl()).getByRole('button', { name: 'Save' }).getAttribute('data-attention')).toBe('true')
  })

  it('constraint 8: no version open and a row no version holds — Save what the Timeline shows first? Discard deletes that row, by name, and the open goes on', async () => {
    await reset()
    await select(BV1)
    await run(() => ctx.addTask({ title: 'Pickup day', phase_id: ctx.phases[0].id, bid_days: 1 }))
    const made = ctx.tasks.find(t => t.title === 'Pickup day')
    expect(made).toBeTruthy()
    await press(inBlock().getByRole('button', { name: 'Edit this version' }))
    let d = dialog('Save what the Timeline shows first?')
    expect(footerWords(d)).toEqual(['Cancel', 'Discard', 'Save as new version…'])
    expect(d.textContent).toContain('Discard deletes the 1 task no bid version holds: “Pickup day”. Undo brings it back.')
    await press(within(d).getByRole('button', { name: 'Discard' }))
    d = dialog(`Edit “${V1}”?`)
    await press(within(d).getByRole('button', { name: 'Edit this version' }))
    await waitFor(() => expect(ctx.project.open_budget_version_id).toBe(BV1))
    expect(ctx.tasks.some(t => t.id === made.id)).toBe(false)
    expect(ctx.setAsideTasks.some(t => t.id === made.id)).toBe(false)
  })

  it('Cancel changes nothing', async () => {
    await reset()
    await select(BV1)
    await press(inBlock().getByRole('button', { name: 'Edit this version' }))
    await press(within(dialog(`Edit “${V1}”?`)).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ctx.project.open_budget_version_id ?? null).toBeNull()
    expect(ctx.tasks).toHaveLength(42)
  })
})

describe('Save writes back INTO the open version (F2: "v2 mid ROM stays v2")', () => {
  it('a change makes it unsaved — Save the one orange, in its attention state — and Save keeps its id, name and place', async () => {
    await reset()
    await select(BV1)
    await openQuietly(BV1)
    const task = ctx.tasks[0]
    const days = Number(task.bid_days || 0) + 2
    await run(() => ctx.updateTask(task.id, { bid_days: days }))
    const b = blockEl()
    const save = within(b).getByRole('button', { name: 'Save' })
    expect(save.getAttribute('data-attention')).toBe('true')
    expect(save.getAttribute('data-variant')).toBe('primary')
    expect(b.querySelector('.rb-bv-open-status').textContent).toBe('Unsaved changes')
    await press(save)
    await waitFor(() => expect(within(blockEl()).getByRole('button', { name: 'Save' }).disabled).toBe(true))
    const v1 = ctx.budgetVersions.find(v => v.id === BV1)
    expect(v1.name).toBe(V1)
    expect(ctx.budgetVersions).toHaveLength(2)
    expect(v1.snapshot.tasks.find(t => t.id === task.id).bid_days).toBe(days)
    expect(blockEl().querySelector('.ui-btn-attention')).toBeNull()
  })

  it('editing another version while the open one is unsaved asks first — Cancel first and focused, then Discard changes, then the open itself', async () => {
    await reset()
    await select(BV1)
    await openQuietly(BV1)
    const task = ctx.tasks[0]
    const saved = ctx.budgetVersions.find(v => v.id === BV1).snapshot.tasks.find(t => t.id === task.id).bid_days
    await run(() => ctx.updateTask(task.id, { bid_days: 9 }))
    await act(async () => { fireEvent.change(inBlock().getByRole('combobox', { name: 'Selected bid' }), { target: { value: BV2 } }) })
    await waitFor(() => expect(selected()).toBe(BV2))
    await press(inBlock().getByRole('button', { name: 'Edit this version' }))
    let d = dialog(`Save the changes to “${V1}” first?`)
    expect(footerWords(d)).toEqual(['Cancel', 'Discard changes', `Save to “${V1}”`])
    expect(document.activeElement.textContent).toBe('Cancel')
    await press(within(d).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ctx.project.open_budget_version_id).toBe(BV1)
    expect(ctx.tasks.find(t => t.id === task.id).bid_days).toBe(9)
    // Again — Discard changes, then the open question, then Edit this version.
    await press(inBlock().getByRole('button', { name: 'Edit this version' }))
    d = dialog(`Save the changes to “${V1}” first?`)
    await press(within(d).getByRole('button', { name: 'Discard changes' }))
    d = dialog(`Edit “${V2}”?`)
    expect(d.textContent).toContain('11 tasks of its own come back')
    await press(within(d).getByRole('button', { name: 'Edit this version' }))
    await waitFor(() => expect(ctx.project.open_budget_version_id).toBe(BV2))
    expect(ctx.tasks).toHaveLength(42)
    // The discarded change never reached Bid v1.
    expect(ctx.budgetVersions.find(v => v.id === BV1).snapshot.tasks.find(t => t.id === task.id).bid_days).toBe(saved)
  })
})

describe('ctx.runWithUndoToast — the Budget\'s one way back', () => {
  it('a step that recorded an undo step says so, and the toast\'s Undo takes back exactly that step', async () => {
    await reset()
    await run(() => ctx.runWithUndoToast(() => ctx.selectBudgetVersion(BV1), 'Selected'))
    expect(screen.getByText('Selected')).toBeTruthy()
    await press(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(selected()).toBe(BV2))
  })
  it('a step that recorded nothing shows no toast (its Undo would take back an older step)', async () => {
    await reset()
    await run(() => ctx.dismissUndoToast())
    // Bid v2 is the selected bid already: nothing is written, nothing recorded.
    await run(() => ctx.runWithUndoToast(() => ctx.selectBudgetVersion(BV2), 'Selected'))
    expect(screen.queryByText('Selected')).toBeNull()
  })
  it('a step that ran across a project switch shows no toast (its Undo would reach the other project\'s step)', async () => {
    await reset()
    await run(() => ctx.dismissUndoToast())
    await run(() => ctx.runWithUndoToast(async () => {
      ctx.clearHistory()
      await ctx.selectBudgetVersion(BV1)
    }, 'Selected'))
    expect(screen.queryByText('Selected')).toBeNull()
  })
})

describe('the unsaved question\'s Save (F2)', () => {
  it('Save to the open version first, then the open itself: the change lands in the version that was open, and the other opens', async () => {
    await reset()
    await select(BV1)
    await openQuietly(BV1)
    const task = ctx.tasks[0]
    await run(() => ctx.updateTask(task.id, { bid_days: 7 }))
    // A network's pace: the Save's request answers in a later task, so the
    // screen renders while it is in flight. (The question reads the moment it
    // was asked — VersionFlow's `first` — so a Save landing under it cannot
    // empty it; no probe here sees that layer go: the provider's bundleRef
    // trails a render, and the Save's last write lands in one batch with the
    // next question. S5c's hand-off, trap 5.)
    const patch = holder.adapter.patchBudgetVersion.bind(holder.adapter)
    let release
    const held = new Promise(r => { release = r })
    holder.adapter.patchBudgetVersion = async (...args) => {
      const out = await patch(...args)
      await held
      return out
    }
    await act(async () => { fireEvent.change(inBlock().getByRole('combobox', { name: 'Selected bid' }), { target: { value: BV2 } }) })
    await waitFor(() => expect(selected()).toBe(BV2))
    await press(inBlock().getByRole('button', { name: 'Edit this version' }))
    const asked = dialog(`Save the changes to “${V1}” first?`)
    await press(within(asked).getByRole('button', { name: `Save to “${V1}”` }))
    // In flight: the question stays, busy (no Escape, no second answer).
    expect(asked.isConnected).toBe(true)
    expect(asked.getAttribute('aria-busy')).toBe('true')
    await act(async () => { release() })
    const d = await waitFor(() => dialog(`Edit “${V2}”?`))
    await press(within(d).getByRole('button', { name: 'Edit this version' }))
    await waitFor(() => expect(ctx.project.open_budget_version_id).toBe(BV2))
    expect(ctx.budgetVersions.find(v => v.id === BV1).snapshot.tasks.find(t => t.id === task.id).bid_days).toBe(7)
  })
})

describe('a version\'s delete (constraint 10) and the lock (F9)', () => {
  it('names the rows only it holds — off the Timeline now, the worked one first — they go with it, and the toast\'s Undo brings back the version and them', async () => {
    await reset()
    await select(BV1)
    await openQuietly(BV1)
    expect(ctx.setAsideTasks).toHaveLength(11)
    await press(inBlock().getByRole('button', { name: 'Manage versions…' }))
    const picker = dialog('Bid versions')
    const row = within(picker).getAllByRole('row').find(r => r.textContent.includes(V2))
    await press(within(row).getByRole('button', { name: `Actions for “${V2}”` }))
    await press(screen.getByRole('button', { name: 'Delete…' }))
    const d = dialog(`Delete “${V2}”?`)
    expect(d.textContent).toContain(`It is the only version that holds 11 tasks that are off the Timeline now: “${WORKED}”, “${t40Title}”,`)
    expect(d.textContent).toContain(`2 of them have work on them: “${WORKED}” (0.5 days logged and 1 file) and “${t40Title}” (1.5 days logged and 1 comment).`)
    expect(d.textContent).toContain('Undo brings back the version and those rows.')
    expect(footerWords(d)).toEqual(['Cancel', 'Delete version'])
    await press(within(d).getByRole('button', { name: 'Delete version' }))
    await waitFor(() => expect(ctx.budgetVersions).toHaveLength(1))
    expect(ctx.setAsideTasks).toHaveLength(0)
    await waitFor(() => expect(screen.getByText(`Deleted “${V2}” and the 11 tasks only it held`)).toBeTruthy())
    // Back to the picker it was asked from.
    expect(dialog('Bid versions')).toBeTruthy()
    await press(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(ctx.budgetVersions).toHaveLength(2))
    expect(ctx.setAsideTasks).toHaveLength(11)
    expect(ctx.setAsideTasks.find(t => t.id === T40).logged_days).toBe(1.5)
  })

  it('Set budget active on the open, saved version: it is on the Timeline already; it locks, the banner names it, the toast says it', async () => {
    await reset()
    await select(BV1)
    await openQuietly(BV1)
    await press(inBlock().getByRole('button', { name: 'Set budget active' }))
    const d = dialog(`Set “${V1}” active?`)
    expect(d.textContent).toContain('It is the open version, so the Timeline already shows it.')
    expect(footerWords(d)).toEqual(['Cancel', 'Set budget active'])
    await press(within(d).getByRole('button', { name: 'Set budget active' }))
    await waitFor(() => expect(ctx.project.budget_active).toBe(true))
    expect(ctx.project.budget_active_version_id).toBe(BV1)
    expect(ctx.project.open_budget_version_id ?? null).toBeNull()
    expect(screen.getByText(`“${V1}” is the budget in production, locked as it was saved`)).toBeTruthy()
    expect(document.querySelector('.rb-budget-active-meta').textContent).toContain(`Locked bid: ${V1}`)
  })
})
