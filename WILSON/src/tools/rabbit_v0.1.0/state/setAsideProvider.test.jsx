/** @vitest-environment jsdom */
// =============================================================================
// setAsideProvider.test.jsx — post-overhaul S5b, step 0: rows SET ASIDE by the
// open bid version, through the REAL provider over the REAL dev dataset ("Salt
// Hours": Bid v1 holds the first thirty-one tasks, Bid v2 all forty-two and is
// LOCKED), driven with ctx.undo / ctx.redo. The cloud's trash is emulated as
// budgetVersionsProvider.test.jsx emulates it.
//
// Audrey's ruling (a) of 2026-10-05: each version shows EXACTLY its own
// schedule. The ten constraints of the brief, each with a control:
//   1 nothing attached is lost; the SAME row comes back
//   2 (the trash is not the store: suite 92 and the backend tests)
//   3 hidden from every reader — ctx.tasks, ctx.dependencies, the selectors
//   4 work on a row is named before it goes; Keep leaves it live, unsaved
//   5 (all three backends: the adapter and route tests)
//   6 under a lock nothing opens and Remove is off; the lock loads its version
//   7 one undo step takes an open back exactly
//   8 rows in no saved version: the question's Discard deletes them
//   9 Remove from this version vs Delete; history replays the raw verbs
//  10 deleting a version takes the set-aside rows only it held
// =============================================================================
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import React from 'react'
import { render, cleanup, act, waitFor } from '@testing-library/react'

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
const { PROJECT_ID, TASK_ID } = await import('../../../dev/fixtures/data/project')
const { fid } = await import('../../../dev/fixtures/ids')
holder.projectId = PROJECT_ID
const { RabbitProvider, useRabbit } = await import('./RabbitProvider')

const BV1 = fid('budgetVersion', 1)
const BV2 = fid('budgetVersion', 2)
// The dataset's OWN rates (what its rate card resolves to), so the live
// schedule after Reset to bidding matches Bid v2 exactly.
const { BUDGET_VERSIONS } = await import('../../../dev/fixtures/data/money')
const RATES = BUDGET_VERSIONS.find(v => v.id === fid('budgetVersion', 2)).snapshot.roleRates
const T40 = TASK_ID(40)

let ctx = null
function Probe() { ctx = useRabbit(); return null }
let fx = null

function cloudTrash(a) {
  const trashed = new Set()
  for (const [del, restore, upsert] of [['deleteTask', 'restoreTask', 'upsertTask'], ['deletePhase', 'restorePhase', 'upsertPhase'], ['deleteMilestone', 'restoreMilestone', 'upsertMilestone']]) {
    const d = a[del].bind(a); const r = a[restore].bind(a); const u = a[upsert].bind(a)
    a[del] = async (id, ...rest) => { trashed.add(id); return d(id, ...rest) }
    a[restore] = async (id, ...rest) => { const was = trashed.delete(id); await r(id, ...rest); return was }
    a[upsert] = async (row) => {
      if (trashed.has(row.id)) throw new Error('new row violates row-level security policy (USING expression)')
      return u(row)
    }
  }
  return a
}

beforeEach(async () => {
  fx = buildDevFixtures()
  // Task 40 is NOT in Bid v1: it carries everything a task can carry, so
  // setting it aside and bringing it back proves nothing on it is lost.
  const t40 = fx.store.tasks.find(t => t.id === T40)
  t40.logged_days = 1.5
  t40.scene_id = fx.store.scenes[0].id
  t40.shot_id = fx.store.shots.find(sh => sh.scene_id === t40.scene_id)?.id ?? fx.store.shots[0].id
  // Bid v2 was saved with these links (an open restores a version's links):
  // the row it brings back must carry them, untouched by the trip.
  const v2t40 = fx.store.budgetVersions.find(v => v.id === fid('budgetVersion', 2)).snapshot.tasks.find(t => t.id === T40)
  v2t40.scene_id = t40.scene_id
  v2t40.shot_id = t40.shot_id
  fx.store.comments.push({ id: 'c-t40', entity_type: 'task', entity_id: T40, body: 'Keep the warm key', created_at: '2026-10-01T10:00:00Z' })
  fx.store.taskLinks.push({ id: 'l-t40', task_id: T40, url: 'https://example.test/ref', label: 'Reference' })
  fx.store.dependencies.push({ id: 'd-t40', kind: 'task', type: 'FS', lag_days: 0, predecessor_id: TASK_ID(10), successor_id: T40 })
  fx.store.files.push({ id: 'f-t40', project_id: PROJECT_ID, task_id: T40, name: 'grade.png', storage_provider: 'supabase', storage_path: 'projects/x/grade.png', tags: [] })
  holder.adapter = cloudTrash(fx.rabbitAdapter())
  render(<RabbitProvider><Probe /></RabbitProvider>)
  await waitFor(() => expect(ctx?.project?.id).toBe(PROJECT_ID))
  await waitFor(() => expect(ctx.budgetVersions.length).toBe(2))
})
afterEach(() => { cleanup(); ctx = null; fx = null })

const task = (n) => ctx.tasks.find(t => t.id === TASK_ID(n))
const aside = (n) => ctx.setAsideTasks.find(t => t.id === TASK_ID(n))
const run = (fn) => act(async () => { await fn() })
const bidding = () => run(() => ctx.resetToBidding())
const open = (id, opts = {}) => run(() => ctx.openBudgetVersion(id, { roleRates: RATES, ...opts }))

describe('constraints 1, 3 and 7 — set aside, hidden, and back whole', () => {
  it('opening Bid v1 sets task 40 aside: off the live schedule, its edge with it, out of the bid days', async () => {
    await bidding()
    const bidBefore = ctx.selectVarianceForProject().bid
    await open(BV1)
    expect(task(40)).toBeUndefined()
    expect(aside(40)).toBeTruthy()
    expect(ctx.dependencies.some(d => d.id === 'd-t40')).toBe(false)
    // The selectors read the live rows only: the bid days drop by what v1 does not hold.
    const live = ctx.tasks.reduce((s, t) => s + Number(t.bid_days || 0), 0)
    expect(ctx.selectVarianceForProject().bid).toBe(live)
    expect(ctx.selectVarianceForProject().bid).toBeLessThan(bidBefore)
  })
  it('opening Bid v2 brings back the SAME row — id, logged days, comment, link, file and edge all on it', async () => {
    await bidding()
    const before = structuredClone(task(40))
    await open(BV1)
    await open(BV2)
    expect(before.scene_id).toBeTruthy()
    expect(task(40)).toMatchObject({ id: T40, title: before.title, logged_days: 1.5, scene_id: before.scene_id, shot_id: before.shot_id })
    expect(ctx.setAsideTasks).toEqual([])
    expect(ctx.dependencies.some(d => d.id === 'd-t40')).toBe(true)
    expect(ctx.comments.some(c => c.id === 'c-t40')).toBe(true)
    expect(ctx.taskLinks.some(l => l.id === 'l-t40')).toBe(true)
    expect(ctx.files.some(f => f.id === 'f-t40' && f.task_id === T40)).toBe(true)
    // Never in the trash on the way (constraint 2): the store row was never deleted.
    expect(fx.store.tasks.find(t => t.id === T40).deleted_at ?? null).toBeNull()
  })
  it('ONE undo takes an open back exactly — what it set aside returns; its redo sets it aside again (constraint 7)', async () => {
    await bidding()
    await open(BV1)
    expect(ctx.tasks).toHaveLength(31)
    await run(() => ctx.undo())
    expect(ctx.tasks).toHaveLength(42)
    expect(ctx.setAsideTasks).toEqual([])
    await run(() => ctx.redo())
    expect(ctx.tasks).toHaveLength(31)
    expect(aside(40)).toBeTruthy()
  })
  it('a history revert of a set-aside task is refused with a sentence, not re-made', async () => {
    await bidding()
    await open(BV1)
    await expect(ctx.revertHistoryEntry({ entity_type: 'tasks', entity_id: T40, action: 'update', diff: { title: { old: 'A', new: 'B' } } }))
      .rejects.toThrow(/set aside: the open bid version does not hold it/)
  })
})

describe('constraint 4 — work on a row is named before it goes', () => {
  it('the preview lists task 40 with its logged days, comment and file; Keep leaves it live and the version unsaved', async () => {
    await bidding()
    const p = ctx.previewOpenBudgetVersion(BV1, { roleRates: RATES })
    const w = p.work.find(r => r.id === T40)
    expect(w).toMatchObject({ kind: 'tasks', work: { loggedDays: 1.5, comments: 1, files: 1 } })
    expect(p.leaving.tasks.map(t => t.id)).toContain(T40)
    // CONTROL: a task with nothing on it is not named.
    expect(p.work.some(r => r.id === TASK_ID(41))).toBe(false)
    await open(BV1, { keep: { tasks: [T40] } })
    expect(task(40)).toBeTruthy()
    expect(aside(41)).toBeTruthy()
    expect(ctx.previewOpenBudgetVersion(BV2, { roleRates: RATES }).unsaved?.kind).toBe('open')
  })
})

describe('constraint 8 — rows in no saved version are never set aside for good', () => {
  it('the question comes first and names them; Discard deletes them the ordinary way, in the open\'s undo step', async () => {
    await bidding()
    await open(BV1)
    await run(() => ctx.addTask({ id: 'new-task', project_id: PROJECT_ID, title: 'Made after Bid v1', bid_days: 2 }))
    const p = ctx.previewOpenBudgetVersion(BV2, { roleRates: RATES })
    expect(p.unsaved.kind).toBe('open')
    expect(p.unsaved.inNoVersion.tasks.map(t => t.id)).toEqual(['new-task'])
    await open(BV2, { discard: true })
    expect(ctx.tasks.some(t => t.id === 'new-task')).toBe(false)
    expect(ctx.setAsideTasks.some(t => t.id === 'new-task')).toBe(false)
    expect(fx.store.tasks.find(t => t.id === 'new-task').deleted_at).toBeTruthy()
    await run(() => ctx.undo())
    expect(ctx.tasks.some(t => t.id === 'new-task')).toBe(true)
  })
  it('with no version open, a live schedule that matches no version asks too; one that matches does not (CONTROL)', async () => {
    await bidding()
    expect(ctx.previewOpenBudgetVersion(BV1, { roleRates: RATES }).unsaved).toBeNull()
    await run(() => ctx.addTask({ id: 'loose', project_id: PROJECT_ID, title: 'Loose', bid_days: 1 }))
    const p = ctx.previewOpenBudgetVersion(BV1, { roleRates: RATES })
    expect(p.unsaved.kind).toBe('none')
    expect(p.unsaved.inNoVersion.tasks.map(t => t.id)).toEqual(['loose'])
  })
})

describe('constraint 9 — Remove from this version, or Delete', () => {
  it('with Bid v1 open, deleting a task Bid v2 also holds sets it ASIDE (not the trash); one only v1… or nothing holds is deleted', async () => {
    await bidding()
    await open(BV1)
    await run(() => ctx.addTask({ id: 'only-live', project_id: PROJECT_ID, title: 'Only live', bid_days: 1 }))
    const plan = ctx.removalPlanFor({ tasks: [TASK_ID(5), 'only-live'] })
    expect(plan.rows.map(r => [r.id, r.verb])).toEqual([[TASK_ID(5), 'remove'], ['only-live', 'delete']])
    expect(plan.rows[0].holders.map(h => h.id)).toEqual([BV2])
    await run(() => ctx.deleteTasks([TASK_ID(5), 'only-live']))
    expect(aside(5)).toBeTruthy()
    expect(fx.store.tasks.find(t => t.id === TASK_ID(5)).deleted_at ?? null).toBeNull()
    expect(fx.store.tasks.find(t => t.id === 'only-live').deleted_at).toBeTruthy()
    expect(ctx.undoToast?.message).toMatch(/^Removed 1 rows|^Removed “/)
    // ONE undo step takes both back.
    await run(() => ctx.undo())
    expect(task(5)).toBeTruthy()
    expect(ctx.tasks.some(t => t.id === 'only-live')).toBe(true)
  })
  it('CONTROL: with no version open, the same delete is the ordinary one', async () => {
    await bidding()
    await run(() => ctx.deleteTask(TASK_ID(5)))
    expect(fx.store.tasks.find(t => t.id === TASK_ID(5)).deleted_at).toBeTruthy()
    expect(aside(5)).toBeUndefined()
  })
})

describe('constraint 6 — under a lock', () => {
  it('Set budget active locks the version AS SAVED: the live schedule becomes it first; then nothing opens and every delete is ordinary', async () => {
    await bidding()
    await run(() => ctx.activateBudget(BV1, { roleRates: RATES }))
    expect(ctx.project.budget_active).toBe(true)
    expect(ctx.project.open_budget_version_id).toBeNull()
    expect(ctx.tasks).toHaveLength(31)
    expect(aside(40)).toBeTruthy()
    await expect(ctx.openBudgetVersion(BV2, { roleRates: RATES })).rejects.toThrow(/while the budget is active/)
    await run(() => ctx.deleteTask(TASK_ID(5)))
    expect(fx.store.tasks.find(t => t.id === TASK_ID(5)).deleted_at).toBeTruthy()
    // ONE undo takes the delete back; the next takes the whole lock back, the schedule with it.
    await run(() => ctx.undo())
    await run(() => ctx.undo())
    expect(ctx.project.budget_active).toBe(false)
    expect(ctx.tasks).toHaveLength(42)
  })
})

describe('constraint 10 — deleting a version takes the set-aside rows only it held', () => {
  it('a task only Bid v3 holds is named, deleted with it, and comes back with it on Undo — set aside again', async () => {
    await bidding()
    await run(() => ctx.addTask({ id: 'v3-only', project_id: PROJECT_ID, title: 'High ROM extra', bid_days: 3 }))
    let v3 = null
    await run(async () => { v3 = await ctx.createBudgetVersion({ name: 'High ROM', roleRates: RATES }) })
    await open(BV1)
    expect(ctx.setAsideTasks.some(t => t.id === 'v3-only')).toBe(true)
    const p = ctx.previewDeleteBudgetVersion(v3.id)
    expect(p.only.tasks.map(t => t.id)).toEqual(['v3-only'])
    // CONTROL: a task Bid v2 also holds is not "only" v3's.
    expect(p.only.tasks.some(t => t.id === T40)).toBe(false)
    await run(() => ctx.deleteBudgetVersion(v3.id))
    expect(ctx.budgetVersions.some(v => v.id === v3.id)).toBe(false)
    expect(ctx.setAsideTasks.some(t => t.id === 'v3-only')).toBe(false)
    expect(fx.store.tasks.find(t => t.id === 'v3-only').deleted_at).toBeTruthy()
    await run(() => ctx.undo())
    expect(ctx.budgetVersions.some(v => v.id === v3.id)).toBe(true)
    expect(ctx.setAsideTasks.some(t => t.id === 'v3-only')).toBe(true)
  })
})
