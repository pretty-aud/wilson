/** @vitest-environment jsdom */
// =============================================================================
// taskItemDrops.test.jsx — VW1m review round 2: a task dropped on a group or
// a row, through the REAL provider over the REAL dev dataset ("Salt Hours"),
// on the Tasks table, the Board and the Timeline.
//   R2-2: a refused or failed drop says why on screen. Each drop's catch
//         swallowed the error; the provider put the sentence in ctx.error,
//         which only the Scenes tab shows. The Tasks tab says it in the kit
//         Banner (the R.A.B.B.I.T. way a failed write is said: the file
//         manager's, the history drawer's), the Timeline in its own "Not
//         saved" strip.
//   R2-3: the Timeline's drop is queued WHOLE (ctx.setTaskItemsOfKinds: its
//         batch runs inside the history queue). Its batch was opened at the
//         drop, before its step's turn came: a change made in the wait landed
//         in the drop's undo step, and an undo that ran in it was swallowed.
// The refusal held here is the one R1-5's test holds: an undo still replaying
// past the queue's wait (__WILSON_TEST_HISTORY_STEP_WAIT_MS).
// =============================================================================
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, act, waitFor, screen, fireEvent, within } from '@testing-library/react'
import { mountRabbit } from '../state/mountRabbit'

const holder = vi.hoisted(() => ({ adapter: null, projectId: null }))
// Each test mounts the real provider over the whole dev dataset. Under a
// loaded run (CI's runner on 49086256, VW1d, 2026-10-25; this machine with
// every core busy) the first took 8.5s against the 5s default, and its body,
// still running after the timeout, dropped on the next test's empty page
// ("Unable to fire a drop event"). The waits inside each test bound it.
vi.setConfig({ testTimeout: 20_000 })

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
vi.mock('../../../permissions/usePermissions', () => ({ usePermissions: () => ({ role: 'admin', ready: true, can: () => true }) }))
vi.mock('../../../components/RateCard/useRateCard', () => ({ useRateCard: () => ({ entries: [], rateCards: [], settled: true, loading: false, error: null }) }))
vi.mock('../../../components/Budget/useProjectRateOverrides', () => ({ useProjectRateOverrides: () => ({ overrides: [], loading: false, error: null }) }))
vi.mock('../../../components/TeamMembers/useRosterMembers', () => ({ useRosterMembers: () => ({ members: [], mode: 'supabase' }) }))
vi.mock('../state/useProjectAccess', () => ({ useProjectAccess: () => ({ canWrite: true, writeReason: null }) }))
vi.mock('../components/FileManager', () => ({ default: () => null }))
vi.mock('../components/TaskDetailPopup', () => ({ default: () => null }))
vi.mock('../components/EditHistoryDrawer', () => ({ default: () => null }))
vi.mock('../../../components/TaskTemplates/TaskTemplateManager', () => ({ default: () => null }))
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
if (typeof document.elementFromPoint !== 'function') document.elementFromPoint = () => null

const { buildDevFixtures } = await import('../../../dev/fixtures/install')
const { PROJECT_ID, TASK_ID } = await import('../../../dev/fixtures/data/project')
const { fid } = await import('../../../dev/fixtures/ids')
holder.projectId = PROJECT_ID
const { RabbitProvider, useRabbit } = await import('../state/RabbitProvider')
const { default: ProjectTasksView } = await import('./ProjectTasksView')
const { default: TimelineView, loadRabbitSettings } = await import('./TimelineView.jsx')
const { itemsOfTask } = await import('../state/taskItemsModel')

const A = (n) => fid('asset', n) // 3: Lookbook
const T18 = TASK_ID(18) // Glass and rain rig test: Lighthouse Interior (7), Sea Spray Comp (12)
const T18_TITLE = 'Glass and rain rig test'
const T5 = TASK_ID(5)
const REFUSAL = 'an Undo is still running — try again once it has finished'

let ctx = null
let fx = null
function Harness({ view }) {
  ctx = useRabbit()
  if (!ctx?.project) return null
  if (view === 'timeline') return <TimelineView settings={loadRabbitSettings()} patchSettings={() => {}} holidays={new Map()} pageActive />
  return <ProjectTasksView />
}
// mount() goes through state/mountRabbit.js, the gap-safe render and waits (N1; OUTSTANDING FX13-03, FX14-01).
async function mount(view) {
  fx = buildDevFixtures()
  holder.adapter = fx.rabbitAdapter()
  await mountRabbit(<RabbitProvider><Harness view={view} /></RabbitProvider>, { adapter: holder.adapter, ctx: () => ctx, until: [
    () => expect(ctx?.project?.id).toBe(PROJECT_ID),
    () => expect(ctx.tableViewLast?.status).toBe('ready'),
  ] })
}
afterEach(() => {
  cleanup(); ctx = null; fx = null
  delete globalThis.__WILSON_TEST_HISTORY_STEP_WAIT_MS
  vi.restoreAllMocks()
})

const kinds = (id, kind) => itemsOfTask(ctx.taskItems, id, kind).map(i => i.entity_id)
const sorted = (list) => list.slice().sort()

/**
 * R1-5's hold: an asset added to task 5, then its undo, whose delete waits on
 * a gate — the replay (history `suspended`) stays open until release().
 */
async function holdAnUndoOpen() {
  await act(async () => { await ctx.addTaskItem({ task_id: T5, entity_type: 'asset', entity_id: A(12) }) })
  let release
  const gate = new Promise((r) => { release = r })
  const del = holder.adapter.deleteTaskItem.bind(holder.adapter)
  vi.spyOn(holder.adapter, 'deleteTaskItem').mockImplementationOnce(async (...args) => { await gate; return del(...args) })
  let undoing = null
  await act(async () => { undoing = ctx.undo() })
  return async () => { await act(async () => { release(); await undoing }) }
}

// The Tasks table and the Board (ProjectTasksView).
const dt = (id) => ({ dataTransfer: { getData: () => id, setData: () => {}, effectAllowed: '' } })
const groupTasksBy = (value) => fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value } })
const band = (label) => [...document.querySelectorAll('tr.rb-task-group-row')].find((r) => r.querySelector('.rb-task-group-label').textContent === label)
const column = (label) => [...document.querySelectorAll('.rb-task-col')].find((c) => c.querySelector('.rb-task-group-label').textContent === label)

// The Timeline: the grip in the label column, mousedown, a move past 3px,
// mouseup over the target row (jsdom has no layout: the point resolves to it).
const gutterRow = (target) => document.querySelector(`.rb-tl-row[data-phase-drop-target="${target}"]`)
const taskRowEl = (title) => [...document.querySelectorAll('.rb-tl-row-label')].find(n => n.textContent === title)?.parentElement
async function dropOnRow(title, target) {
  const at = vi.spyOn(document, 'elementFromPoint').mockReturnValue(target)
  fireEvent.mouseDown(taskRowEl(title), { button: 0, clientX: 10, clientY: 10 })
  fireEvent.mouseMove(window, { clientX: 40, clientY: 40 })
  await act(async () => { fireEvent.mouseUp(window, { clientX: 40, clientY: 40 }) })
  at.mockRestore()
}

describe('R2-2: a refused drop says why, on the Tasks table, the Board and the Timeline', () => {
  it('the Tasks table: a drop refused while an undo still replays shows the refusal\'s words, and nothing moved', async () => {
    globalThis.__WILSON_TEST_HISTORY_STEP_WAIT_MS = 50
    await mount('tasks')
    groupTasksBy('asset')
    // FX12 (2026-10-25) waited for the band here; FX14 measured that the
    // regroup draws it in the same act (16 bands at once), and that a band
    // missing for 1 s was the regroup wiped by the provider's pending drafts
    // reset, which `mount` now waits out (a longer timeout would not have
    // helped). The wait stays as a guard that names what is missing.
    await waitFor(() => expect(band('Lookbook')).toBeTruthy())
    const release = await holdAnUndoOpen()
    await act(async () => { fireEvent.drop(band('Lookbook'), dt(T18)) })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(REFUSAL), { timeout: 2000 })
    expect(screen.getByRole('alert').textContent).toContain(`“${T18_TITLE}”`)
    await release()
    expect(sorted(kinds(T18, 'asset'))).toEqual(sorted([A(7), A(12)]))
    // Its Dismiss takes the sentence down.
    await act(async () => { fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Dismiss' })) })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('the Board: the same refusal, said', async () => {
    globalThis.__WILSON_TEST_HISTORY_STEP_WAIT_MS = 50
    await mount('tasks')
    fireEvent.click(screen.getByRole('tab', { name: 'Board' }))
    groupTasksBy('asset')
    await waitFor(() => expect(column('Lookbook')).toBeTruthy())
    const release = await holdAnUndoOpen()
    await act(async () => { fireEvent.drop(column('Lookbook'), dt(T18)) })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(REFUSAL), { timeout: 2000 })
    await release()
  })

  it('the Timeline: the same refusal, in its "Not saved" strip', async () => {
    globalThis.__WILSON_TEST_HISTORY_STEP_WAIT_MS = 50
    await mount('timeline')
    fireEvent.click(screen.getByRole('tab', { name: 'Group by asset' }))
    // FX14, read for the same gap: the Timeline's grouping is its own state,
    // not a views draft, and `mount` waits the provider's effects out; the
    // rows it drops between are named here so a miss says which.
    expect(taskRowEl(T18_TITLE)).toBeTruthy()
    expect(gutterRow(A(3))).toBeTruthy()
    const release = await holdAnUndoOpen()
    await dropOnRow(T18_TITLE, gutterRow(A(3)))
    await waitFor(() => expect(document.body.textContent).toContain(REFUSAL), { timeout: 2000 })
    expect(document.body.textContent).toContain(`Could not move “${T18_TITLE}”`)
    await release()
    expect(sorted(kinds(T18, 'asset'))).toEqual(sorted([A(7), A(12)]))
  })
})

describe('R2-3: the Timeline drop is queued whole', () => {
  it('an edit made while the drop waits its turn is its own undo step: one undo takes back the drop alone', async () => {
    await mount('timeline')
    fireEvent.click(screen.getByRole('tab', { name: 'Group by asset' }))
    // A step ahead of the drop in the queue, held at its write: a version's
    // rename (it opens no batch of its own).
    const v = ctx.budgetVersions[0]
    let release
    const gate = new Promise((r) => { release = r })
    const patch = holder.adapter.patchBudgetVersion.bind(holder.adapter)
    vi.spyOn(holder.adapter, 'patchBudgetVersion').mockImplementationOnce(async (...args) => { await gate; return patch(...args) })
    let renaming = null
    await act(async () => { renaming = ctx.renameBudgetVersion(v.id, `${v.name} (renamed)`) })
    await dropOnRow(T18_TITLE, gutterRow(A(3)))
    // In the wait: an edit elsewhere. With the batch open from the drop, it
    // (and the rename ahead) landed in the drop's step.
    const was = ctx.tasks.find(t => t.id === T5).title
    await act(async () => { await ctx.updateTask(T5, { title: 'Edited in the wait' }) })
    await act(async () => { release(); await renaming })
    await waitFor(() => expect(kinds(T18, 'asset')).toEqual([A(3)]))
    await act(async () => { await ctx.undo() })
    expect(sorted(kinds(T18, 'asset'))).toEqual(sorted([A(7), A(12)]))
    expect(ctx.tasks.find(t => t.id === T5).title).toBe('Edited in the wait')
    expect(ctx.budgetVersions.find(x => x.id === v.id).name).toBe(`${v.name} (renamed)`)
    // CONTROL: each is a step of its own, taken back in turn.
    await act(async () => { await ctx.undo() })
    expect(ctx.budgetVersions.find(x => x.id === v.id).name).toBe(v.name)
    await act(async () => { await ctx.undo() })
    expect(ctx.tasks.find(t => t.id === T5).title).toBe(was)
  })
})
