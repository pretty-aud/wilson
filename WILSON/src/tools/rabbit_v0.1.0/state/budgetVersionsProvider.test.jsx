/** @vitest-environment jsdom */
// =============================================================================
// budgetVersionsProvider.test.jsx — post-overhaul S5, step 2: the provider owns
// bid versions. The REAL provider over the REAL dev dataset (the fixtures
// adapter, "Salt Hours": two bids, the budget LOCKED to Bid v2), driven end to
// end with ctx.undo / ctx.redo.
//
// What it pins (Audrey's F2, F9, F12, F13):
//   · no version write reloads the project (F12.4: the reload wiped Undo);
//   · Save as new version: opened, and selected unless a budget is active;
//     ONE undo step takes all of it back;
//   · Save writes INTO the open version (its name kept), the locked one never;
//   · Edit this version writes its schedule, settings and rates into the
//     live rows as ONE undo step; tasks added since stay; logged days never
//     move; the locked version cannot be opened;
//   · the selected bid moves only while no budget is active (F9);
//   · deleting the open version closes it, and its undo puts it back in its
//     place; the lock stamps its real columns (F12.2) and Reset clears them.
// =============================================================================
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import React from 'react'
import { render, cleanup, act, waitFor } from '@testing-library/react'

const holder = vi.hoisted(() => ({ adapter: null }))

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
const { readVersion, selectedVersionOf } = await import('./budgetVersionModel')

const BV1 = fid('budgetVersion', 1)
const BV2 = fid('budgetVersion', 2)
const RATES = { director: 900, producer: 700, editor: 600, production_designer: 650, dop: 800, coordinator: 400, vfx_supervisor: 850, sound_designer: 600 }

let ctx = null
function Probe() { ctx = useRabbit(); return null }
let loads = 0

beforeEach(async () => {
  holder.adapter = buildDevFixtures().rabbitAdapter()
  loads = 0
  const real = holder.adapter.loadProject.bind(holder.adapter)
  holder.adapter.loadProject = async (...a) => { loads += 1; return real(...a) }
  render(<RabbitProvider><Probe /></RabbitProvider>)
  await waitFor(() => expect(ctx?.project?.id).toBe(PROJECT_ID))
  await waitFor(() => expect(ctx.budgetVersions.length).toBe(2))
})
afterEach(() => { cleanup(); ctx = null })

const versions = () => ctx.budgetVersions
const byId = (id) => versions().find(v => v.id === id)
const task = (n) => ctx.tasks.find(t => t.id === TASK_ID(n))
const run = (fn) => act(async () => { await fn() })

describe('the lock (F12.2) and Reset to bidding', () => {
  it('Reset clears the lock and its stamp; ONE undo puts both back', async () => {
    expect(ctx.project.budget_active).toBe(true)
    expect(byId(BV2).locked_at).toBeTruthy()
    await run(() => ctx.resetToBidding())
    expect(ctx.project.budget_active).toBe(false)
    expect(ctx.project.budget_active_version_id).toBeNull()
    expect(byId(BV2).locked_at).toBeNull()
    await run(() => ctx.undo())
    expect(ctx.project.budget_active).toBe(true)
    expect(ctx.project.budget_active_version_id).toBe(BV2)
    expect(byId(BV2).locked_at).toBeTruthy()
    expect(loads).toBe(1) // the boot load, and no other
  })

  it('Set budget active selects the version, stamps locked_at in its own column, and closes it if it was open', async () => {
    await run(() => ctx.resetToBidding())
    await run(() => ctx.openBudgetVersion(BV1, { roleRates: RATES }))
    expect(ctx.project.open_budget_version_id).toBe(BV1)
    await run(() => ctx.activateBudget(BV1))
    expect(ctx.project).toMatchObject({ budget_active: true, budget_active_version_id: BV1, open_budget_version_id: null })
    expect(selectedVersionOf(versions()).id).toBe(BV1)
    expect(byId(BV1).locked_at).toBeTruthy()
    await run(() => ctx.undo())
    expect(ctx.project.budget_active).toBe(false)
    expect(ctx.project.open_budget_version_id).toBe(BV1)
    expect(byId(BV1).locked_at).toBeNull()
  })
})

describe('Save as new version… (F2, F9)', () => {
  it('while bidding: the new version is OPEN and SELECTED, carries totals and the line against the newest before it; ONE undo removes it all', async () => {
    await run(() => ctx.resetToBidding())
    let created
    await run(async () => { created = await ctx.createBudgetVersion({ name: ' Mid ROM ', summary: 'mid range', roleRates: RATES }) })
    expect(created.name).toBe('Mid ROM')
    expect(ctx.project.open_budget_version_id).toBe(created.id)
    expect(selectedVersionOf(versions()).id).toBe(created.id)
    const read = readVersion(byId(created.id))
    expect(read.shape).toBe('living')
    expect(read.overall).toBeGreaterThan(read.beforeAgency)
    expect(byId(created.id).snapshot.delta.against).toBe('Bid v2 (pre-production)')
    expect(loads).toBe(1)
    await run(() => ctx.undo())
    expect(byId(created.id)).toBeUndefined()
    expect(ctx.project.open_budget_version_id).toBeNull()
    expect(selectedVersionOf(versions()).id).toBe(BV2)
    await run(() => ctx.redo())
    expect(byId(created.id)).toBeTruthy()
    expect(ctx.project.open_budget_version_id).toBe(created.id)
  })

  it('while a budget is active: the new version is opened and stays unlocked; the selected bid stays the locked one (F9)', async () => {
    let created
    await run(async () => { created = await ctx.createBudgetVersion({ name: 'revision after week 2', roleRates: RATES }) })
    expect(ctx.project.open_budget_version_id).toBe(created.id)
    expect(selectedVersionOf(versions()).id).toBe(BV2)
    expect(ctx.project.budget_active_version_id).toBe(BV2)
    expect(byId(created.id).locked_at ?? null).toBeNull()
  })

  it('a version needs a name', async () => {
    await expect(ctx.createBudgetVersion({ name: '   ', roleRates: RATES })).rejects.toThrow(/needs a name/)
  })
})

describe('Save — into the open version (F2)', () => {
  it('writes the live rows into it, keeps its name; undo puts the saved schedule back', async () => {
    let v
    await run(async () => { v = await ctx.createBudgetVersion({ name: 'Mid ROM', roleRates: RATES }) })
    await run(() => ctx.updateTask(TASK_ID(9), { end_date: '2026-12-24' }))
    await run(() => ctx.saveBudgetVersion(v.id, { roleRates: RATES }))
    const saved = byId(v.id)
    expect(saved.name).toBe('Mid ROM')
    expect(saved.snapshot.tasks.find(t => t.id === TASK_ID(9)).end_date).toBe('2026-12-24')
    await run(() => ctx.undo())
    expect(byId(v.id).snapshot.tasks.find(t => t.id === TASK_ID(9)).end_date).not.toBe('2026-12-24')
  })

  it('the locked version is never changed in place', async () => {
    await expect(ctx.saveBudgetVersion(BV2, { roleRates: RATES })).rejects.toThrow(/locked bid cannot be changed in place/)
  })
})

describe('Edit this version — opening (F2)', () => {
  it('writes its schedule and settings into the live rows as ONE undo step; tasks added since stay; logged days never move', async () => {
    // Bid v1 holds the first thirty-one tasks at a contingency of 8.
    const logged = task(9).logged_days
    await run(() => ctx.updateTask(TASK_ID(9), { start_date: '2026-11-02', end_date: '2026-11-20' }))
    const v1Task9 = byId(BV1).snapshot.tasks.find(t => t.id === TASK_ID(9))
    await run(() => ctx.openBudgetVersion(BV1, { roleRates: RATES }))
    expect(ctx.project.open_budget_version_id).toBe(BV1)
    expect(task(9).start_date).toBe(v1Task9.start_date)
    expect(task(9).end_date).toBe(v1Task9.end_date)
    expect(task(9).logged_days).toBe(logged)
    expect(Number(ctx.project.budget_contingency_pct)).toBe(8)
    expect(task(42)).toBeTruthy() // added since v1 was saved: it stays
    // While the budget is active the selected bid stays the locked one (F9).
    expect(selectedVersionOf(versions()).id).toBe(BV2)
    expect(loads).toBe(1)
    await run(() => ctx.undo())
    expect(ctx.project.open_budget_version_id).toBeNull()
    expect(Number(ctx.project.budget_contingency_pct)).toBe(10)
    expect(task(9).start_date).toBe('2026-11-02')
  })

  it('a task the version holds that the project lost comes back under its saved id — live after a reload, logged days never sent', async () => {
    const sent = []
    const upsert = holder.adapter.upsertTask.bind(holder.adapter)
    holder.adapter.upsertTask = async (row) => { sent.push(row); return upsert(row) }
    await run(() => ctx.deleteTask(TASK_ID(3)))
    expect(task(3)).toBeUndefined()
    await run(() => ctx.openBudgetVersion(BV1, { roleRates: RATES }))
    expect(task(3)).toBeTruthy()
    const wire = sent.find(r => r.id === TASK_ID(3))
    expect(wire).not.toHaveProperty('logged_days')
    expect(wire.deleted_at).toBeNull() // a trashed row's stamp cleared with it
    expect((await holder.adapter.loadProject(PROJECT_ID)).tasks.some(t => t.id === TASK_ID(3))).toBe(true)
  })

  it('where the backend refuses the saved id (the cloud\'s trash), the row comes back under a new id, and its tasks follow a re-made phase', async () => {
    const phaseId = fid('phase', 2)
    const v1 = byId(BV1).snapshot
    const childTask = v1.tasks.find(t => t.phase_id === phaseId)
    await run(() => ctx.deletePhase(phaseId))
    const upsertPhase = holder.adapter.upsertPhase.bind(holder.adapter)
    holder.adapter.upsertPhase = async (row) => {
      if (row.id === phaseId) throw new Error('new row violates row-level security policy for table "phases"')
      return upsertPhase(row)
    }
    await run(() => ctx.openBudgetVersion(BV1, { roleRates: RATES }))
    const remade = ctx.phases.find(p => p.name === v1.phases.find(p2 => p2.id === phaseId).name && p.id !== phaseId)
    expect(remade).toBeTruthy()
    expect(ctx.tasks.find(t => t.id === childTask.id).phase_id).toBe(remade.id)
    expect(ctx.error).toBeFalsy()
  })

  it('opening writes the version\'s role rates as project overrides, and the undo takes them back', async () => {
    const before = ctx.rateOverridesEpoch
    const live = { ...RATES, editor: RATES.editor + 100 }
    const v1Rates = byId(BV1).snapshot.roleRates
    await run(() => ctx.openBudgetVersion(BV1, { roleRates: live }))
    expect(ctx.rateOverridesEpoch).toBeGreaterThan(before)
    const overrides = await holder.adapter.listProjectRateOverrides(PROJECT_ID)
    const editorRow = overrides.find(o => o.role_slug === 'editor' && !o.member_id)
    expect(Number(editorRow.day_rate)).toBe(Number(v1Rates.editor))
    await run(() => ctx.undo())
    const after = await holder.adapter.listProjectRateOverrides(PROJECT_ID)
    expect(after.find(o => o.role_slug === 'editor' && !o.member_id)).toBeUndefined()
  })

  it('the locked version cannot be opened for editing', async () => {
    await expect(ctx.openBudgetVersion(BV2, { roleRates: RATES })).rejects.toThrow(/locked bid cannot be opened/)
  })
})

describe('the selected bid (F9, F13)', () => {
  it('refused while a budget is active; after Reset it moves at once and undoes', async () => {
    await expect(ctx.selectBudgetVersion(BV1)).rejects.toThrow(/Reset to bidding/)
    await run(() => ctx.resetToBidding())
    await run(() => ctx.selectBudgetVersion(BV1))
    expect(versions().filter(v => v.is_active).map(v => v.id)).toEqual([BV1])
    await run(() => ctx.undo())
    expect(versions().filter(v => v.is_active).map(v => v.id)).toEqual([BV2])
  })

  it('deleting the selected bid leaves none selected — nothing is promoted (F13)', async () => {
    await run(() => ctx.resetToBidding())
    await run(() => ctx.deleteBudgetVersion(BV2))
    expect(selectedVersionOf(versions())).toBeNull()
  })
})

describe('rename, note, delete', () => {
  it('rename and the note each undo; the locked version cannot be deleted', async () => {
    await run(() => ctx.renameBudgetVersion(BV1, 'Fund bid'))
    await run(() => ctx.updateBudgetVersionSummary(BV1, 'sent 12 Aug'))
    expect(byId(BV1)).toMatchObject({ name: 'Fund bid', summary: 'sent 12 Aug' })
    await run(() => ctx.undo())
    await run(() => ctx.undo())
    expect(byId(BV1).name).toBe('Bid v1 (fund application)')
    await expect(ctx.deleteBudgetVersion(BV2)).rejects.toThrow(/locked bid cannot be deleted/)
  })

  it('deleting the open version closes it; undo puts it back in its place and opens it again', async () => {
    await run(() => ctx.openBudgetVersion(BV1, { roleRates: RATES }))
    const createdAt = byId(BV1).created_at
    await run(() => ctx.deleteBudgetVersion(BV1))
    expect(byId(BV1)).toBeUndefined()
    expect(ctx.project.open_budget_version_id).toBeNull()
    await run(() => ctx.undo())
    expect(byId(BV1).created_at).toBe(createdAt)
    expect(ctx.project.open_budget_version_id).toBe(BV1)
    expect(loads).toBe(1)
  })
})
