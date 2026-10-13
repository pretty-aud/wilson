/** @vitest-environment jsdom */
// =============================================================================
// budgetVersionsProvider.test.jsx — post-overhaul S5, step 2: the provider owns
// bid versions. The REAL provider over the REAL dev dataset (the fixtures
// adapter, "Salt Hours": two bids, the budget LOCKED to Bid v2), driven end to
// end with ctx.undo / ctx.redo.
//
// What it pins (Audrey's F2, F9, F12, F13; review round 1's corrections):
//   · no version write reloads the project (F12.4: the reload wiped Undo);
//   · Save as new version: opened and selected while bidding; while a budget
//     is active it only RECORDS (not opened, not selected); ONE undo step;
//   · Save writes INTO the open version only, never while locked;
//   · Edit this version writes its schedule, settings and rates into the live
//     rows as ONE undo step; tasks added since stay; logged days never sent;
//     refused while a budget is active; a row the project lost comes back
//     under its SAVED id — out of the trash first where the backend has one
//     (the cloud refuses an upsert onto a trashed row: emulated here) — so
//     re-opening never makes it twice (R1-01), and its redo survives the
//     trash its undo made (R1-06);
//   · a project switch part way stops a composite (R1-03); an undo pressed
//     while one runs does nothing (R1-02); activating always selects (R1-04);
//   · the selected bid moves only while bidding; deleting the open version
//     closes it and its undo keeps its place; the lock stamps its columns.
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
const { readVersion, selectedVersionOf } = await import('./budgetVersionModel')

const BV1 = fid('budgetVersion', 1)
const BV2 = fid('budgetVersion', 2)
const RATES = { director: 900, producer: 700, editor: 600, production_designer: 650, dop: 800, coordinator: 400, vfx_supervisor: 850, sound_designer: 600 }

let ctx = null
function Probe() { ctx = useRabbit(); return null }
let loads = 0

/**
 * The cloud's trash, on the fixtures: a trashed row hides behind its SELECT
 * policy, so an upsert onto it is refused; restore_soft_deleted brings it back.
 * The fixtures' own upsert would merge into the trashed row instead.
 */
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
  holder.adapter = cloudTrash(buildDevFixtures().rabbitAdapter())
  loads = 0
  const real = holder.adapter.loadProject.bind(holder.adapter)
  holder.adapter.loadProject = async (...a) => { loads += 1; return real(...a) }
  render(<RabbitProvider><Probe /></RabbitProvider>)
  await waitFor(() => expect(ctx?.project?.id).toBe(PROJECT_ID))
  await waitFor(() => expect(ctx.budgetVersions.length).toBe(2))
})
afterEach(() => { cleanup(); ctx = null; delete globalThis.__WILSON_TEST_HISTORY_STEP_WAIT_MS })

const versions = () => ctx.budgetVersions
const byId = (id) => versions().find(v => v.id === id)
const task = (n) => ctx.tasks.find(t => t.id === TASK_ID(n))
const run = (fn) => act(async () => { await fn() })
const bidding = () => run(() => ctx.resetToBidding())

describe('the lock (F12.2) and Reset to bidding', () => {
  it('Reset clears the lock and its stamp; ONE undo puts both back', async () => {
    expect(ctx.project.budget_active).toBe(true)
    expect(byId(BV2).locked_at).toBeTruthy()
    await bidding()
    expect(ctx.project.budget_active).toBe(false)
    expect(ctx.project.budget_active_version_id).toBeNull()
    expect(byId(BV2).locked_at).toBeNull()
    await run(() => ctx.undo())
    expect(ctx.project.budget_active).toBe(true)
    expect(ctx.project.budget_active_version_id).toBe(BV2)
    expect(byId(BV2).locked_at).toBeTruthy()
    expect(loads).toBe(1) // the boot load, and no other
  })

  it('Set budget active selects the version, stamps locked_at in its own column, and closes the open version', async () => {
    await bidding()
    await run(() => ctx.openBudgetVersion(BV1, { roleRates: RATES }))
    expect(ctx.project.open_budget_version_id).toBe(BV1)
    await run(() => ctx.activateBudget(BV2))
    expect(ctx.project).toMatchObject({ budget_active: true, budget_active_version_id: BV2, open_budget_version_id: null })
    expect(selectedVersionOf(versions()).id).toBe(BV2)
    expect(byId(BV2).locked_at).toBeTruthy()
    await run(() => ctx.undo())
    expect(ctx.project.budget_active).toBe(false)
    expect(ctx.project.open_budget_version_id).toBe(BV1)
    expect(selectedVersionOf(versions()).id).toBe(BV1)
  })

  it('R1-04: activating writes the selection even when the row is already flagged — two flagged rows left one', async () => {
    await run(() => holder.adapter.patchBudgetVersion(PROJECT_ID, BV1, { is_active: true }))
    await run(() => ctx.reloadActiveProject())
    expect(versions().filter(v => v.is_active).length).toBe(2)
    await bidding()
    await run(() => ctx.activateBudget(BV1))
    expect(versions().filter(v => v.is_active).map(v => v.id)).toEqual([BV1])
    expect(selectedVersionOf(versions()).id).toBe(BV1)
  })
})

describe('Save as new version… (F2, F9)', () => {
  it('while bidding: OPEN and SELECTED, with totals and the line against the newest before it; ONE undo removes it all', async () => {
    await bidding()
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

  it('while a budget is active it only RECORDS: not opened, not selected, unlocked (F9)', async () => {
    let created
    await run(async () => { created = await ctx.createBudgetVersion({ name: 'revision after week 2', roleRates: RATES }) })
    expect(byId(created.id)).toBeTruthy()
    expect(ctx.project.open_budget_version_id).toBeNull()
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
    await bidding()
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

  it('only the open version is saved into, and the locked one never', async () => {
    await expect(ctx.saveBudgetVersion(BV2, { roleRates: RATES })).rejects.toThrow(/locked bid cannot be changed in place/)
    await bidding()
    await expect(ctx.saveBudgetVersion(BV1, { roleRates: RATES })).rejects.toThrow(/only the open bid version is saved into/)
  })
})

describe('Edit this version — opening (F2)', () => {
  it('writes its schedule and settings into the live rows as ONE undo step; tasks it does not hold are SET ASIDE (S5b, ruling (a)); logged days never move', async () => {
    await bidding()
    // Bid v1 holds the first thirty-one tasks at a contingency of 8.
    const logged = task(9).logged_days
    await run(() => ctx.updateTask(TASK_ID(9), { start_date: '2026-11-02', end_date: '2026-11-20' }))
    const v1Task9 = byId(BV1).snapshot.tasks.find(t => t.id === TASK_ID(9))
    await run(() => ctx.openBudgetVersion(BV1, { roleRates: RATES }))
    expect(ctx.project.open_budget_version_id).toBe(BV1)
    expect(selectedVersionOf(versions()).id).toBe(BV1)
    expect(task(9).start_date).toBe(v1Task9.start_date)
    expect(task(9).end_date).toBe(v1Task9.end_date)
    expect(task(9).logged_days).toBe(logged)
    expect(Number(ctx.project.budget_contingency_pct)).toBe(8)
    // Part 1 pinned "added since v1 was saved: it stays" — the controller's
    // draft sentence, withdrawn by Audrey's ruling (a): v1 shows EXACTLY its
    // own schedule. Task 42 (not in v1) is set aside, kept whole.
    expect(task(42)).toBeUndefined()
    expect(ctx.tasks).toHaveLength(31)
    expect(ctx.setAsideTasks.map(t => t.id)).toContain(TASK_ID(42))
    expect(loads).toBe(1)
    await run(() => ctx.undo())
    expect(ctx.project.open_budget_version_id).toBeNull()
    expect(selectedVersionOf(versions()).id).toBe(BV2)
    expect(Number(ctx.project.budget_contingency_pct)).toBe(10)
    expect(task(9).start_date).toBe('2026-11-02')
    // ONE undo brought every set-aside task back (constraint 7).
    expect(task(42)).toBeTruthy()
    expect(ctx.tasks).toHaveLength(42)
    expect(ctx.setAsideTasks).toEqual([])
  })

  it('R1-01: a trashed task comes back under its SAVED id — restored, not re-made — and re-opening never makes it twice', async () => {
    await bidding()
    const sent = []
    const upsert = holder.adapter.upsertTask
    holder.adapter.upsertTask = async (row) => { sent.push(row); return upsert(row) }
    await run(() => ctx.deleteTask(TASK_ID(3)))
    expect(task(3)).toBeUndefined()
    await run(() => ctx.openBudgetVersion(BV1, { roleRates: RATES }))
    await run(() => ctx.openBudgetVersion(BV2, { roleRates: RATES }))
    await run(() => ctx.openBudgetVersion(BV1, { roleRates: RATES }))
    const copies = ctx.tasks.filter(t => t.id === TASK_ID(3) || t.title === byId(BV1).snapshot.tasks.find(s => s.id === TASK_ID(3)).title)
    expect(copies.map(t => t.id)).toEqual([TASK_ID(3)])
    expect(sent.filter(r => r.id === TASK_ID(3)).every(r => !('logged_days' in r))).toBe(true)
    const reloaded = (await holder.adapter.loadProject(PROJECT_ID)).tasks.filter(t => t.id === TASK_ID(3))
    expect(reloaded.length).toBe(1)
  })

  it('R1-06: undo trashes the revived row again; redo brings it back through the trash', async () => {
    await bidding()
    await run(() => ctx.deleteTask(TASK_ID(3)))
    await run(() => ctx.openBudgetVersion(BV1, { roleRates: RATES }))
    expect(task(3)).toBeTruthy()
    await run(() => ctx.undo())
    expect(task(3)).toBeUndefined()
    await run(() => ctx.redo())
    expect(task(3)).toBeTruthy()
    expect((await holder.adapter.loadProject(PROJECT_ID)).tasks.some(t => t.id === TASK_ID(3))).toBe(true)
  })

  it('a trashed phase comes back under its saved id, and its tasks keep pointing at it', async () => {
    await bidding()
    const phaseId = fid('phase', 2)
    await run(() => ctx.deletePhase(phaseId))
    await run(() => ctx.openBudgetVersion(BV1, { roleRates: RATES }))
    expect(ctx.phases.filter(p => p.id === phaseId).length).toBe(1)
    const child = byId(BV1).snapshot.tasks.find(t => t.phase_id === phaseId)
    expect(ctx.tasks.find(t => t.id === child.id).phase_id).toBe(phaseId)
  })

  it('opening writes the version\'s role rates as project overrides, and the undo takes them back', async () => {
    await bidding()
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

  it('while a budget is active nothing opens — the locked bid or any other (F9; R1-10)', async () => {
    await expect(ctx.openBudgetVersion(BV2, { roleRates: RATES })).rejects.toThrow(/locked bid cannot be opened/)
    await expect(ctx.openBudgetVersion(BV1, { roleRates: RATES })).rejects.toThrow(/no bid version is opened/)
    expect(Number(ctx.project.budget_contingency_pct)).toBe(10)
  })

  it('R1-07: a refusal part way leaves NO version open (never the old one over a mix), and one undo takes back what landed', async () => {
    await bidding()
    let v
    await run(async () => { v = await ctx.createBudgetVersion({ name: 'Mid ROM', roleRates: RATES }) })
    expect(ctx.project.open_budget_version_id).toBe(v.id)
    await run(() => ctx.updateTask(TASK_ID(9), { start_date: '2026-11-02', end_date: '2026-11-20' }))
    const patchTask = holder.adapter.patchTask
    holder.adapter.patchTask = async () => { throw new Error('the network went away') }
    let err = null
    await run(async () => { try { await ctx.openBudgetVersion(BV1, { roleRates: RATES }) } catch (e) { err = e } })
    holder.adapter.patchTask = patchTask
    expect(err?.message).toMatch(/stopped part way.*No version is open now/)
    expect(ctx.project.open_budget_version_id).toBeNull()
    await run(() => ctx.undo())
    expect(ctx.project.open_budget_version_id).toBe(v.id)
  })
})

describe('composites and the undo stack (review round 1)', () => {
  function gate(a, method) {
    let release
    const gateP = new Promise(r => { release = r })
    let hit
    const hitP = new Promise(r => { hit = r })
    const real = a[method].bind(a)
    let first = true
    a[method] = async (...args) => {
      if (first) { first = false; hit(); await gateP }
      return real(...args)
    }
    return { hitP, release }
  }

  it('R1-02: an undo pressed while a composite holds the batch does nothing; the composite\'s step lands whole', async () => {
    await bidding()
    globalThis.__WILSON_TEST_HISTORY_STEP_WAIT_MS = 5
    await run(() => ctx.updateTask(TASK_ID(9), { start_date: '2026-11-02', end_date: '2026-11-20' }))
    const g = gate(holder.adapter, 'patchTask')
    let opening
    await act(async () => { opening = ctx.openBudgetVersion(BV1, { roleRates: RATES }) })
    await act(async () => { await g.hitP })
    // The queue's wait (5ms here) has passed, so this undo RUNS beside the
    // open (awaited: it finishes) — and must do nothing.
    await act(async () => { await new Promise(r => setTimeout(r, 20)); await ctx.undo() })
    // Nothing was undone: an undo that ran would have moved the task move
    // onto the redo stack. (Task 9's date is no witness here: the open's own
    // optimistic write already shows the version's date while its request
    // waits on the gate.)
    expect(ctx.canRedo).toBe(false)
    g.release()
    await act(async () => { await opening })
    expect(ctx.project.open_budget_version_id).toBe(BV1)
    // ONE undo takes the whole open back, the next the task move — and the
    // Reset to bidding before it is still on the stack, untouched.
    await run(() => ctx.undo())
    expect(ctx.project.open_budget_version_id).toBeNull()
    expect(task(9).start_date).toBe('2026-11-02')
    await run(() => ctx.undo())
    expect(task(9).start_date).not.toBe('2026-11-02')
    expect(ctx.project.budget_active).toBe(false)
  })

  it('R1-03: switching project part way stops the composite; nothing more is written to either project', async () => {
    await bidding()
    let other
    await run(async () => { other = await ctx.createProject({ title: 'Other', budget_contingency_pct: 3 }) })
    await run(() => ctx.updateTask(TASK_ID(9), { start_date: '2026-11-02', end_date: '2026-11-20' }))
    const g = gate(holder.adapter, 'patchTask')
    let opening
    let err = null
    await act(async () => { opening = ctx.openBudgetVersion(BV1, { roleRates: RATES }).catch(e => { err = e }) })
    await act(async () => { await g.hitP })
    await act(async () => { ctx.setActiveProject(other.id) })
    await waitFor(() => expect(ctx.project?.id).toBe(other.id))
    g.release()
    await act(async () => { await opening })
    expect(err?.message).toMatch(/another project was opened/)
    expect(Number(ctx.project.budget_contingency_pct ?? 0)).toBe(3)
    const back = await holder.adapter.loadProject(PROJECT_ID)
    expect(back.project.open_budget_version_id ?? null).toBeNull()
    expect(Number(back.project.budget_contingency_pct)).toBe(10)
  })
})

describe('the selected bid (F9, F13)', () => {
  it('refused while a budget is active; after Reset it moves at once and undoes', async () => {
    await expect(ctx.selectBudgetVersion(BV1)).rejects.toThrow(/Reset to bidding/)
    await bidding()
    await run(() => ctx.selectBudgetVersion(BV1))
    expect(versions().filter(v => v.is_active).map(v => v.id)).toEqual([BV1])
    await run(() => ctx.undo())
    expect(versions().filter(v => v.is_active).map(v => v.id)).toEqual([BV2])
  })

  it('deleting the selected bid leaves none selected — nothing is promoted (F13)', async () => {
    await bidding()
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
    await bidding()
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
