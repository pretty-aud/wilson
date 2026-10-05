/** @vitest-environment jsdom */
// =============================================================================
// timelineVersions.test.jsx — post-overhaul S5d: bid versions on the
// Timeline, through the REAL provider over the REAL dev dataset ("Salt Hours":
// Bid v1 holds the first thirty-one tasks, Bid v2 all forty-two and is LOCKED
// and selected), driven as a person drives them — the version bar's dropdown
// and verbs, the gantt's rows and bars, the keys, the questions, the toast.
//
// Audrey's words: F2 "viewing a version is read-only. to edit a version press
// "Edit this version" … while a version is open, Save writes the changes back
// INTO that version … a new version is only made on purpose with "Save as new
// version""; F9 "while the budget is active the Timeline dropdown is greyed
// out with the reason shown … i still edit the live Timeline during
// production as normal"; F10 the Timeline's dropdown only past the money gate,
// never money in its options; F13 newest first, "Name · date · Locked/Open".
//
// The span move (viewing is never a remount) is timelineWeekends.test.jsx's;
// what a view draws, row by row, is timelineVersionView.test.js's; the
// questions' words are versionWords.test.js's and the Budget's tests'.
// =============================================================================
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest'
import { render, cleanup, act, waitFor, screen, within, fireEvent } from '@testing-library/react'

const holder = vi.hoisted(() => ({
  adapter: null, projectId: null, card: null, overrides: null,
  cardCalls: 0, overrideCalls: 0, roster: { members: [] },
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
vi.mock('../../../permissions/usePermissions', () => ({ usePermissions: () => ({ role: 'admin', ready: true }) }))
// The two rate hooks, counted (F10: read only past the money gate) and stable
// (the dataset's general card — the plain rates its bids were saved with).
vi.mock('../../../components/RateCard/useRateCard', () => ({ useRateCard: () => { holder.cardCalls += 1; return holder.card } }))
vi.mock('../../../components/Budget/useProjectRateOverrides', () => ({ useProjectRateOverrides: () => { holder.overrideCalls += 1; return holder.overrides } }))
vi.mock('../../../components/TeamMembers/useRosterMembers', () => ({ useRosterMembers: () => holder.roster }))
vi.mock('../state/useProjectAccess', () => ({ useProjectAccess: () => ({ canWrite: true, writeReason: null }) }))
vi.mock('../components/FileManager', () => ({ default: () => null }))
// The task popup, as a mark that it opened (it reads the LIVE task).
vi.mock('../components/TaskDetailPopup', async () => {
  const React = await import('react')
  return { default: ({ taskId }) => React.createElement('div', { 'data-testid': 'task-popup' }, taskId) }
})
vi.mock('../../../components/TaskTemplates/TaskTemplateManager', () => ({ default: () => null }))
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
// The minimap draws its bars to its measured width; jsdom measures 0. It is
// given S5p's harness's 1400px (nothing else is measured here).
const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() { return this.classList?.contains('rb-tl-ov') ? 1400 : 0 },
  })
})
afterAll(() => { if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth); else delete HTMLElement.prototype.clientWidth })

const { buildDevFixtures } = await import('../../../dev/fixtures/install')
const { PROJECT_ID, TASK_ID } = await import('../../../dev/fixtures/data/project')
const { fid } = await import('../../../dev/fixtures/ids')
const { BUDGET_VERSIONS, RATE_CARD_ENTRIES, GENERAL_CARD_ID } = await import('../../../dev/fixtures/data/money')
holder.projectId = PROJECT_ID
const { RabbitProvider, useRabbit } = await import('../state/RabbitProvider')
const { default: TimelineView, loadRabbitSettings } = await import('./TimelineView.jsx')
const { default: UndoToast } = await import('../components/UndoToast')
const { versionOptionLabel, LOCKED_WHY } = await import('./budget/BidVersions')
const { versionDate } = await import('./budget/VersionQuestions')
const { versionView } = await import('./timelineVersionView')
const { selectCriticalPath } = await import('../state/selectors')

const BV1 = fid('budgetVersion', 1)
const BV2 = fid('budgetVersion', 2)
const V1 = 'Bid v1 (fund application)'
const V2 = 'Bid v2 (pre-production)'
const RATES = BUDGET_VERSIONS.find(v => v.id === BV2).snapshot.roleRates
const CARD = { entries: RATE_CARD_ENTRIES.filter(e => e.rate_card_id === GENERAL_CARD_ID), rateCards: [], settled: true, loading: false, error: null }
const OVERRIDES = { overrides: [], loading: false, error: null }
const SETTINGS = loadRabbitSettings()
const HOLIDAYS = new Map()
const VIEWING = 'Viewing a bid version is read-only: Current goes back to the live schedule.'

let ctx = null
let fx = null

function Harness({ canSeeMoney, pageActive, showTimeline }) {
  ctx = useRabbit()
  if (!ctx?.project) return null
  return (
    <>
      {showTimeline && <TimelineView settings={SETTINGS} patchSettings={() => {}} holidays={HOLIDAYS} pageActive={pageActive} canSeeMoney={canSeeMoney} />}
      <UndoToast />
    </>
  )
}
const app = (props) => (
  <RabbitProvider><Harness canSeeMoney pageActive showTimeline {...props} /></RabbitProvider>
)

async function mount({ before, card = CARD, ...props } = {}) {
  holder.card = card
  holder.overrides = OVERRIDES
  holder.cardCalls = 0
  holder.overrideCalls = 0
  fx = buildDevFixtures()
  before?.(fx)
  holder.adapter = fx.rabbitAdapter()
  const r = render(app(props))
  await waitFor(() => expect(ctx?.project?.id).toBe(PROJECT_ID))
  await waitFor(() => expect(ctx.budgetVersions.length).toBeGreaterThanOrEqual(2))
  return r
}
afterEach(() => {
  cleanup(); ctx = null; fx = null
  delete globalThis.__WILSON_TEST_HISTORY_STEP_WAIT_MS
})

const bar = () => document.querySelector('.rb-tl-ver-bar')
const combo = () => within(bar()).getByRole('combobox', { name: 'Bid version' })
const words = () => bar().querySelector('.rb-tl-ver-state').textContent
/** The bar's refusal, on its own line right under the bar (R1-05). */
const errorLine = () => document.querySelector('[data-version-error]')
const verbs = () => [...bar().querySelectorAll('.rb-tl-ver-verbs button')].map(b => b.textContent.trim())
const verb = (name) => within(bar().querySelector('.rb-tl-ver-verbs')).getByRole('button', { name })
const press = (el) => act(async () => { fireEvent.click(el) })
const run = (fn) => act(async () => { await fn() })
const choose = (value) => act(async () => { fireEvent.change(combo(), { target: { value } }) })
const stat = (label) => [...document.querySelectorAll('.rb-tl-band .ui-stat')]
  .find(s => s.querySelector('.ui-stat-label')?.textContent === label)?.querySelector('.ui-stat-value')?.textContent
const rowLabels = () => [...document.querySelectorAll('.rb-tl-row-label')].map(n => n.textContent)
const rowOf = (text) => [...document.querySelectorAll('.rb-tl-row-label')].find(n => n.textContent === text)?.parentElement
const barOf = (taskId) => document.querySelector(`[data-row-bar="task:${taskId}"]`)
const reset = () => run(() => ctx.resetToBidding())
const openQuietly = (id) => run(() => ctx.openBudgetVersion(id, { roleRates: RATES }))
const titleOf = (id) => fx.store.tasks.find(t => t.id === id)?.title
/** Every write the adapter is asked for, by name, from now on. */
function countWrites() {
  const calls = []
  const a = holder.adapter
  for (const k of Object.keys(a)) {
    if (typeof a[k] !== 'function' || !/^(upsert|update|patch|delete|remove|add|create|set|restore|save|link|unlink|reorder|activate|stamp|archive|withdraw|assign|replace|move|copy|post|apply|bulk)/i.test(k)) continue
    const orig = a[k].bind(a)
    a[k] = (...args) => { calls.push(k); return orig(...args) }
  }
  return calls
}

// =============================================================================
describe('F10: the bar exists only past the money gate', () => {
  it('closed (a member, a reviewer): no bar, no rate read, no question — and open, all three', async () => {
    await mount({ canSeeMoney: false })
    expect(document.querySelector('.rb-tl-gantt')).not.toBeNull()
    expect({ bar: bar(), card: holder.cardCalls, overrides: holder.overrideCalls }).toEqual({ bar: null, card: 0, overrides: 0 })
    cleanup()
    // CONTROL: past the gate the bar renders and the rates are read.
    await mount({ canSeeMoney: true })
    expect(bar()).not.toBeNull()
    expect(holder.cardCalls).toBeGreaterThan(0)
    expect(holder.overrideCalls).toBeGreaterThan(0)
  })
})

describe('the dropdown (F13): what the gantt shows', () => {
  it('Current first; the versions newest first in F13\'s words, the open one marked Open; then Manage versions…; never money', async () => {
    await mount()
    await reset()
    await openQuietly(BV1)
    const v = (id) => ctx.budgetVersions.find(x => x.id === id)
    expect([...combo().options].map(o => o.textContent)).toEqual([
      'Current',
      versionOptionLabel(v(BV2), { openId: BV1 }),
      versionOptionLabel(v(BV1), { openId: BV1 }),
      'Manage versions…',
    ])
    expect(combo().options[2].textContent).toBe(`${V1} · ${versionDate(v(BV1))} · Open`)
    expect([...combo().querySelectorAll('optgroup')].map(g => g.label)).toEqual(['Bid versions'])
    expect(combo().textContent).not.toMatch(/[$€£]|\d,\d{3}/)
    expect(combo().value).toBe('__current__')
  })
  it('a version saved before versions kept their schedule is greyed with that reason, and choosing it shows nothing new', async () => {
    await mount({
      before: (f) => f.store.budgetVersions.push({
        id: 'bv-old', project_id: PROJECT_ID, workspace_id: f.store.budgetVersions[0].workspace_id, name: 'Bid v0', type: 'bid', is_active: false,
        snapshot: { grandTotal: 1000, totalBidDays: 2, tasks: [{ id: TASK_ID(1), bid_days: 2 }] }, created_at: '2026-07-01T09:00:00Z', updated_at: '2026-07-01T09:00:00Z',
      }),
    })
    await waitFor(() => expect(ctx.budgetVersions).toHaveLength(3))
    await reset()
    const old = [...combo().options].find(o => o.value === 'bv-old')
    expect([old.textContent, old.disabled]).toEqual([`Bid v0 · ${versionDate({ created_at: '2026-07-01T09:00:00Z' })} · no timeline captured`, true])
    await choose('bv-old')
    expect([bar().dataset.mode, stat('Tasks')]).toEqual(['current', '42'])
  })
})

describe('under a lock (F9): greyed with the reason, the live Timeline still editable', () => {
  it('the dropdown is greyed and pinned to the locked bid, the Summary\'s sentence in words; + Task is live; Save as new version… records a copy, says so, and its Undo takes it back', async () => {
    await mount()
    expect(ctx.project.budget_active).toBe(true)
    expect(bar().dataset.mode).toBe('locked')
    expect([combo().disabled, combo().value]).toEqual([true, BV2])
    expect(combo().selectedOptions[0].textContent).toBe(`${V2} · ${versionDate(ctx.budgetVersions.find(v => v.id === BV2))} · Locked`)
    expect(words()).toBe(LOCKED_WHY)
    expect(document.getElementById(combo().getAttribute('aria-describedby'))?.textContent).toBe(LOCKED_WHY)
    // The live Timeline is production's: nothing in the toolbar is gated.
    expect(document.querySelectorAll('.ui-toolbar [aria-disabled="true"]')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Task' }).disabled).toBe(false)
    expect(verbs()).toEqual(['Save as new version…'])
    await press(verb('Save as new version…'))
    const d = screen.getByRole('dialog', { name: 'Save as new version' })
    expect(d.textContent).toContain(`It is not opened or selected: the budget stays locked to “${V2}”.`)
    fireEvent.change(within(d).getByRole('textbox', { name: 'Name' }), { target: { value: 'Revision after week 2' } })
    await press(within(d).getByRole('button', { name: 'Save as new version' }))
    await waitFor(() => expect(ctx.budgetVersions).toHaveLength(3))
    const made = ctx.budgetVersions.find(v => v.name === 'Revision after week 2')
    expect({ open: ctx.project.open_budget_version_id, selected: made.is_active, locked: ctx.project.budget_active_version_id })
      .toEqual({ open: null, selected: false, locked: BV2 })
    await waitFor(() => expect(screen.getByText('Recorded “Revision after week 2”; the lock is unchanged')).toBeTruthy())
    await press(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(ctx.budgetVersions).toHaveLength(2))
  })
})

describe('viewing a version (F2: read-only — nothing written, nothing set aside or brought back)', () => {
  it('Bid v1 is drawn as saved: its 31 tasks, a task renamed since under its saved title, a task re-dated since on its saved dates — and not one write', async () => {
    await mount()
    await reset()
    const t1 = titleOf(TASK_ID(1))
    await run(() => ctx.updateTask(TASK_ID(1), { title: 'Renamed since the bid' }))
    const t2 = ctx.tasks.find(t => t.id === TASK_ID(2))
    await run(() => ctx.updateTask(TASK_ID(2), { start_date: '2026-11-02', end_date: '2026-11-06' }))
    expect(rowLabels()).toContain('Renamed since the bid')
    const liveLeft = barOf(TASK_ID(2))?.style.left
    const writes = countWrites()
    await choose(BV1)
    expect([bar().dataset.mode, stat('Tasks')]).toEqual(['viewing', '31'])
    expect(rowLabels()).toContain(t1)
    expect(rowLabels()).not.toContain('Renamed since the bid')
    expect(barOf(TASK_ID(2))?.style.left).not.toBe(liveLeft)
    expect(barOf(TASK_ID(40))).toBeNull() // Bid v1 does not hold task 40
    await press(verb('Current'))
    expect([bar().dataset.mode, stat('Tasks'), barOf(TASK_ID(2))?.style.left]).toEqual(['current', '42', liveLeft])
    expect({ writes, setAside: ctx.setAsideTasks.length, open: ctx.project.open_budget_version_id }).toEqual({ writes: [], setAside: 0, open: null })
    expect(t2.start_date).not.toBe('2026-11-02')
  })
  it('the bar says what is shown — "Viewing bid version: Bid v1 · date", Read-only — and offers Edit this version and Current, never the save verbs', async () => {
    await mount()
    await reset()
    await openQuietly(BV2)
    await choose(BV1)
    const v1 = ctx.budgetVersions.find(v => v.id === BV1)
    expect(words()).toBe(`Viewing bid version: ${V1} · ${versionDate(v1)}Read-only`)
    expect(verbs()).toEqual(['Edit this version', 'Current'])
    expect(combo().value).toBe(BV1)
    // Choosing the OPEN version is Current: it is what Current shows.
    await choose(BV2)
    expect([bar().dataset.mode, combo().value]).toEqual(['current', '__current__'])
    expect(verbs()).toEqual(['Save', 'Save as new version…'])
  })
  it('while viewing: the create buttons are greyed with the reason, Undo and Redo stand down and the keys are left alone, a task opens no popup and a drop zone no editor — and at Current each works again', async () => {
    await mount()
    await reset()
    const t1 = titleOf(TASK_ID(1))
    await run(() => ctx.updateTask(TASK_ID(1), { title: 'Undo me' }))
    await choose(BV1)
    const gated = [...document.querySelectorAll('.ui-toolbar [aria-disabled="true"]')]
    expect(gated.length).toBe(3) // + Phase (by phase), Key date, + Task
    for (const g of gated) expect(g.getAttribute('title')).toBe(VIEWING)
    expect(screen.getByTitle('Undo (Ctrl+Z)').disabled).toBe(true)
    expect(fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })).toBe(true) // not cancelled: left alone
    await run(async () => {})
    expect(titleOf(TASK_ID(1))).toBe('Undo me')
    await press(rowOf(t1))
    expect(screen.queryByTestId('task-popup')).toBeNull()
    expect(rowOf(t1).getAttribute('title') || '').not.toMatch(/Click to/)
    const dz = document.querySelector('.rb-tl-dz')
    expect(dz.getAttribute('title')).toBe(VIEWING)
    await press(dz)
    expect(document.querySelector('.rb-tl-ed-title')).toBeNull()
    // Nothing on the view promises a click, nor says the PROJECT is read-only
    // (the bar says the view is): a bar, a minimap bar, a key date.
    expect(screen.queryByText('Read only')).toBeNull()
    expect(barOf(TASK_ID(3)).getAttribute('title')).toMatch(/· Viewing a bid version is read-only: Current goes back to the live schedule\.$/)
    expect(barOf(TASK_ID(3)).getAttribute('title')).not.toMatch(/click to/)
    const minis = [...document.querySelectorAll('[data-minimap-bar]')]
    expect(minis.length).toBeGreaterThan(0)
    for (const b of minis) expect(b.getAttribute('title')).not.toMatch(/click to/)
    const diamonds = [...document.querySelectorAll('.rb-tl-ms')]
    expect(diamonds.length).toBeGreaterThan(0)
    for (const d of diamonds) expect(d.dataset.opens).toBe('false')
    // CONTROL: at Current the key undoes, the row opens the popup, the bars
    // and the key dates open again.
    await press(verb('Current'))
    expect(fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })).toBe(false)
    await waitFor(() => expect(titleOf(TASK_ID(1))).toBe(t1))
    expect(barOf(TASK_ID(3)).getAttribute('title')).toMatch(/click to edit/)
    for (const d of document.querySelectorAll('.rb-tl-ms')) expect(d.dataset.opens).toBe('true')
    await press(rowOf(t1))
    expect(screen.getByTestId('task-popup').textContent).toBe(TASK_ID(1))
  })
  it('a popup or an editor open on a live row goes when a version is chosen, and does not come back at Current', async () => {
    await mount()
    await reset()
    const t1 = titleOf(TASK_ID(1))
    await press(rowOf(t1))
    expect(screen.getByTestId('task-popup').textContent).toBe(TASK_ID(1))
    await choose(BV1)
    expect(screen.queryByTestId('task-popup')).toBeNull()
    await press(verb('Current'))
    expect(screen.queryByTestId('task-popup')).toBeNull()
    await press(screen.getByRole('button', { name: 'Task' }))
    expect(document.querySelector('.rb-tl-ed-title')).not.toBeNull()
    await choose(BV1)
    expect(document.querySelector('.rb-tl-ed-title')).toBeNull()
    await press(verb('Current'))
    expect(document.querySelector('.rb-tl-ed-title')).toBeNull()
  })
  // S5d review round 1 (R1-04): the undo toast on screen when a look starts
  // is a live step's. It goes with the look, as the keys and the toolbar's
  // Undo stand down: its Undo took back a live row under the version shown.
  it('a live step\'s undo toast goes when a version is chosen — its Undo cannot take back a live row under the view — and Ctrl+Z at Current still can', async () => {
    await mount()
    await reset()
    await run(() => ctx.dismissUndoToast())
    await run(() => ctx.deleteTask(TASK_ID(5)))
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
    await choose(BV1)
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    await press(verb('Current'))
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(ctx.tasks.some(t => t.id === TASK_ID(5))).toBe(false)
    // CONTROL: the step is still on the stack — the key at Current takes it back.
    expect(fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })).toBe(false)
    await waitFor(() => expect(ctx.tasks.some(t => t.id === TASK_ID(5))).toBe(true))
  })
  it('the arrows a viewed version draws are its rows\' links as they are now — exactly what Edit this version would show', async () => {
    await mount()
    await reset()
    // Bid v1 open: tasks 32–42 leave the Timeline, and their links with them
    // (task 17 → 41, 34 → 35 → 36 are set aside).
    await openQuietly(BV1)
    const arrows = () => document.querySelectorAll('.rb-tl-dep').length
    const atBidV1 = arrows()
    await choose(BV2)
    const viewed = arrows()
    await press(verb('Current'))
    await openQuietly(BV2)
    await waitFor(() => expect(ctx.project.open_budget_version_id).toBe(BV2))
    expect({ viewed, edited: arrows() }).toEqual({ viewed, edited: viewed })
    expect(viewed).toBeGreaterThan(atBidV1)
  })
  it('a viewed version\'s critical path is its own: its tasks\' bid days over the links between its rows', async () => {
    // Tasks 34 → 35 → 36 (not in Bid v1) made the live project's longest chain.
    await mount({ before: (f) => { for (const n of [34, 35, 36]) f.store.tasks.find(t => t.id === TASK_ID(n)).bid_days = 40 } })
    await reset()
    const live = stat('Critical')
    await choose(BV1)
    const v1 = versionView(ctx.budgetVersions.find(v => v.id === BV1), {
      tasks: ctx.tasks, setAsideTasks: ctx.setAsideTasks, dependencies: ctx.dependencies, setAsideDependencies: ctx.setAsideDependencies,
    })
    expect(stat('Critical')).toBe(String(selectCriticalPath(v1.tasks, v1.dependencies).length))
    expect(stat('Critical')).not.toBe(live)
  })
  it('Edit this version from the bar asks the question; its Edit opens the version, the look ends, and the toast says what moved', async () => {
    await mount()
    await reset()
    await choose(BV1)
    await press(verb('Edit this version'))
    const d = screen.getByRole('dialog', { name: `Edit “${V1}”?` })
    await press(within(d).getByRole('button', { name: 'Edit this version' }))
    await waitFor(() => expect(ctx.project.open_budget_version_id).toBe(BV1))
    expect(bar().dataset.mode).toBe('current')
    expect(words()).toMatch(new RegExp(`^Open: ${V1.replace(/[()]/g, '\\$&')} · Saved `))
    expect(stat('Tasks')).toBe('31')
    await waitFor(() => expect(screen.getByText(`11 tasks left the Timeline: editing “${V1}”`)).toBeTruthy())
  })
  it('leaving the Timeline tab and coming back is Current again (a look, not a state to restore)', async () => {
    const r = await mount()
    await reset()
    await choose(BV1)
    expect(bar().dataset.mode).toBe('viewing')
    r.rerender(app({ showTimeline: false }))
    r.rerender(app({ showTimeline: true }))
    expect([bar().dataset.mode, stat('Tasks')]).toEqual(['current', '42'])
  })
  it('the version looked at, deleted meanwhile: the look ends at Current — and the delete\'s Undo brings the version back, not the look', async () => {
    await mount()
    await reset()
    await choose(BV1)
    await run(() => ctx.deleteBudgetVersion(BV1))
    await waitFor(() => expect(ctx.budgetVersions.some(v => v.id === BV1)).toBe(false))
    expect([bar().dataset.mode, stat('Tasks')]).toEqual(['current', '42'])
    await run(() => ctx.undo())
    await waitFor(() => expect(ctx.budgetVersions.some(v => v.id === BV1)).toBe(true))
    expect([bar().dataset.mode, stat('Tasks')]).toEqual(['current', '42'])
  })
})

describe('Save from the Timeline: the Summary\'s mutator, its words and its toast', () => {
  it('a version open and changed: "Unsaved changes" and Save in the attention state ("● Unsaved"); Save writes into it — the same version — and says "Saved", with no toast', async () => {
    await mount()
    await reset()
    await openQuietly(BV1)
    await run(() => ctx.dismissUndoToast())
    expect(words()).toMatch(/· Saved /)
    expect(verb('Save').disabled).toBe(true)
    const t3 = ctx.tasks.find(t => t.id === TASK_ID(3))
    await run(() => ctx.updateTask(TASK_ID(3), { bid_days: Number(t3.bid_days) + 1 }))
    expect(words()).toBe(`Open: ${V1} · Unsaved changes`)
    expect(verb('Save').getAttribute('data-attention')).toBe('true')
    expect(bar().querySelector('.ui-btn-attention')?.textContent).toBe('Unsaved')
    await press(verb('Save'))
    await waitFor(() => expect(words()).toMatch(/· Saved /))
    expect({ versions: ctx.budgetVersions.length, open: ctx.project.open_budget_version_id }).toEqual({ versions: 2, open: BV1 })
    expect(ctx.budgetVersions.find(v => v.id === BV1).snapshot.tasks.find(t => t.id === TASK_ID(3)).bid_days).toBe(Number(t3.bid_days) + 1)
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })
  it('the rates not read yet: nothing reads unsaved, and Save and Save as new version… are greyed with the Summary\'s sentence', async () => {
    await mount({ card: { ...CARD, settled: false } })
    await reset()
    await openQuietly(BV1)
    await run(() => ctx.updateTask(TASK_ID(3), { bid_days: 9 }))
    expect(words()).toBe(`Open: ${V1} · Reading the rate card…`)
    expect([verb('Save').disabled, verb('Save').getAttribute('title')]).toEqual([true, 'Reading the rate card…'])
    expect(verb('Save as new version…').disabled).toBe(true)
  })
  it('a Save refused while an Undo still replays says why in the bar — not swallowed — and writes nothing', async () => {
    globalThis.__WILSON_TEST_HISTORY_STEP_WAIT_MS = 50
    await mount()
    await reset()
    await openQuietly(BV1)
    await run(() => ctx.updateTask(TASK_ID(3), { bid_days: 9 }))
    await run(() => ctx.selectBudgetVersion(BV2))
    const origSel = holder.adapter.selectBudgetVersion.bind(holder.adapter)
    let release
    const gate = new Promise(r => { release = r })
    holder.adapter.selectBudgetVersion = async (...a) => { await gate; return origSel(...a) }
    let undoing
    await act(async () => { undoing = ctx.undo() })
    await press(verb('Save'))
    await waitFor(() => expect(errorLine()?.textContent).toBe('an Undo is still running — try again once it has finished'), { timeout: 2000 })
    // R1-05: said on its own line right under the bar — the kit's danger
    // Banner, which wraps, its Dismiss in reach — not squeezed into the bar,
    // where it was clipped mid-word and its Dismiss with it.
    expect(bar().querySelector('[data-version-error]')).toBeNull()
    expect(bar().nextElementSibling).toBe(errorLine())
    expect([errorLine().className, errorLine().dataset.tone, errorLine().getAttribute('role')]).toEqual(['ui-banner', 'danger', 'alert'])
    await press(within(errorLine()).getByRole('button', { name: 'Dismiss' }))
    expect(errorLine()).toBeNull()
    await act(async () => { release(); await undoing })
    holder.adapter.selectBudgetVersion = origSel
    expect(ctx.budgetVersions.find(v => v.id === BV1).snapshot.tasks.find(t => t.id === TASK_ID(3)).bid_days).not.toBe(9)
  })
  // S5d review round 1 (R1-02): the Timeline stands still while the Save
  // runs. A drag made then joined the Save's undo step, so its Undo — or the
  // "Stopped part way" toast's — took the drag back with it; an Undo pressed
  // then waited its turn and took back the Save, not the edit before it.
  it('while the Save runs the Timeline takes no change — greyed with the reason, Undo and the keys stand down, a task opens no popup — and once it lands, each works again', async () => {
    const SAVING = 'Saving the open bid version: the Timeline takes changes again in a moment.'
    await mount()
    await reset()
    await openQuietly(BV1)
    await run(() => ctx.dismissUndoToast())
    const t1 = titleOf(TASK_ID(1))
    const days = Number(ctx.tasks.find(t => t.id === TASK_ID(3)).bid_days) + 1
    await run(() => ctx.updateTask(TASK_ID(3), { bid_days: days }))
    const orig = holder.adapter.patchBudgetVersion.bind(holder.adapter)
    let release
    const gate = new Promise(r => { release = r })
    holder.adapter.patchBudgetVersion = async (...a) => { await gate; return orig(...a) }
    expect(verb('Save').disabled).toBe(false)
    await press(verb('Save'))
    const gated = [...document.querySelectorAll('.ui-toolbar [aria-disabled="true"]')]
    expect(gated.length).toBe(3) // + Phase (by phase), Key date, + Task
    for (const g of gated) expect(g.getAttribute('title')).toBe(SAVING)
    expect(barOf(TASK_ID(3)).getAttribute('title')).toMatch(/· Saving the open bid version: the Timeline takes changes again in a moment\.$/)
    expect(document.querySelector('.rb-tl-dz').getAttribute('title')).toBe(SAVING)
    expect(screen.getByTitle('Undo (Ctrl+Z)').disabled).toBe(true)
    expect(fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })).toBe(true) // not cancelled: left alone
    await press(rowOf(t1))
    expect(screen.queryByTestId('task-popup')).toBeNull()
    // Landed: Saved, and the Timeline takes changes again — nothing undone.
    await act(async () => { release() })
    await waitFor(() => expect(words()).toMatch(/· Saved /))
    holder.adapter.patchBudgetVersion = orig
    expect(ctx.tasks.find(t => t.id === TASK_ID(3)).bid_days).toBe(days)
    expect(ctx.budgetVersions.find(v => v.id === BV1).snapshot.tasks.find(t => t.id === TASK_ID(3)).bid_days).toBe(days)
    expect(document.querySelectorAll('.ui-toolbar [aria-disabled="true"]').length).toBe(0)
    expect(barOf(TASK_ID(3)).getAttribute('title')).toMatch(/click to edit/)
    expect(screen.getByTitle('Undo (Ctrl+Z)').disabled).toBe(false)
    await press(rowOf(t1))
    expect(screen.getByTestId('task-popup').textContent).toBe(TASK_ID(1))
  })
  it('a Save that fails lets the Timeline go too: the error is said, and the Timeline takes changes again', async () => {
    await mount()
    await reset()
    await openQuietly(BV1)
    await run(() => ctx.dismissUndoToast())
    await run(() => ctx.updateTask(TASK_ID(3), { bid_days: 9 }))
    const orig = holder.adapter.patchBudgetVersion.bind(holder.adapter)
    holder.adapter.patchBudgetVersion = async () => { throw new Error('[supabase] network') }
    await press(verb('Save'))
    await waitFor(() => expect(errorLine()).not.toBeNull())
    holder.adapter.patchBudgetVersion = orig
    expect(document.querySelectorAll('.ui-toolbar [aria-disabled="true"]').length).toBe(0)
    expect(barOf(TASK_ID(3)).getAttribute('title')).toMatch(/click to edit/)
  })
})

// S5d review round 1 (R1-05): the words are pieces, so that where room runs
// out only the version's name gives way (rabbitTimeline.css: the lead and the
// tail are `flex: none`, the name takes the ellipsis). As one clipped line
// the state went first — "Open: Bid v1 (fund …" at 1280. The sheet's half is
// rabbitTimelineCss.test.js's.
describe('the bar\'s words in pieces (R1-05): only the name gives way', () => {
  // Each piece by its own class (lucide gives the eye two of its own).
  const pieces = () => [...bar().querySelector('.rb-tl-ver-state').children]
    .map(n => n.getAttribute('class').split(' ').filter(c => c.startsWith('rb-tl-ver-')).join(' '))
  it('locked and none open: one sentence; open: "Open: ", the name, " · " and the state; viewing: the eye, the lead, the name, " · date", Read-only — and the words read as before', async () => {
    await mount()
    expect([pieces(), words()]).toEqual([['rb-tl-ver-line'], LOCKED_WHY])
    await reset()
    expect([pieces(), words()]).toEqual([['rb-tl-ver-line'], 'No version is open.'])
    await openQuietly(BV2)
    await run(() => ctx.dismissUndoToast())
    expect(pieces()).toEqual(['rb-tl-ver-lead', 'rb-tl-ver-name', 'rb-tl-ver-tail'])
    const state = bar().querySelector('.rb-tl-ver-state')
    expect(state.querySelector('.rb-tl-ver-lead').textContent).toBe('Open: ')
    expect(state.querySelector('.rb-tl-ver-name').textContent).toBe(V2)
    expect(state.querySelector('.rb-tl-ver-tail').textContent).toMatch(/^ · Saved /)
    expect(state.querySelector('.rb-tl-ver-tail .rb-tl-ver-status')).not.toBeNull()
    await choose(BV1)
    const v1 = ctx.budgetVersions.find(v => v.id === BV1)
    expect(pieces()).toEqual(['rb-tl-ver-icon', 'rb-tl-ver-lead', 'rb-tl-ver-name', 'rb-tl-ver-tail', 'rb-tl-ver-quiet'])
    expect(words()).toBe(`Viewing bid version: ${V1} · ${versionDate(v1)}Read-only`)
    expect(bar().querySelector('.rb-tl-ver-tail').textContent).toBe(` · ${versionDate(v1)}`)
  })
})

describe('Save as new version… from the Timeline, while bidding', () => {
  it('the form focuses Name with Cancel first; the new version opens and is selected, and the bar names it', async () => {
    await mount()
    await reset()
    await press(verb('Save as new version…'))
    const d = screen.getByRole('dialog', { name: 'Save as new version' })
    expect(document.activeElement).toBe(within(d).getByRole('textbox', { name: 'Name' }))
    expect([...d.querySelectorAll('.ui-dialog-foot button')].map(b => b.textContent)).toEqual(['Cancel', 'Save as new version'])
    fireEvent.change(within(d).getByRole('textbox', { name: 'Name' }), { target: { value: 'Mid ROM' } })
    await press(within(d).getByRole('button', { name: 'Save as new version' }))
    await waitFor(() => expect(ctx.budgetVersions).toHaveLength(3))
    const made = ctx.budgetVersions.find(v => v.name === 'Mid ROM')
    expect({ open: ctx.project.open_budget_version_id, selected: made.is_active }).toEqual({ open: made.id, selected: true })
    expect(words()).toMatch(/^Open: Mid ROM · Saved /)
  })
  it('the shot list it is based on (D18) is the open version\'s own — archived or not — else the project\'s active list', async () => {
    const LIST2 = fid('shotList', 2) // "Pickups", archived
    await mount({ before: (f) => { f.store.budgetVersions.find(v => v.id === BV1).shot_list_id = LIST2 } })
    await reset()
    await press(verb('Save as new version…'))
    expect(screen.getByRole('dialog', { name: 'Save as new version' }).textContent).toContain('Based on the shot list “Shot list 1 · v1”.')
    await press(within(screen.getByRole('dialog', { name: 'Save as new version' })).getByRole('button', { name: 'Cancel' }))
    await openQuietly(BV1)
    await press(verb('Save as new version…'))
    expect(screen.getByRole('dialog', { name: 'Save as new version' }).textContent).toContain('Based on the shot list “Pickups · v1 (archived)”.')
  })
})
