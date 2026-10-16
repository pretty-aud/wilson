/** @vitest-environment jsdom */
// =============================================================================
// VW1m (2026-10-16): the Budget with no main item. Audrey, batch 12: "lets
// not have main asset be a thing"; batch 13 (Q-M1): "Split between its
// assets". The contract is item 2 of docs/sessions/handoffs/po-vw1m-2026-10-16.md
// ("The Budget"):
//   * the reports that group by an item (By asset, By scene, By shot, By
//     level, By experience, and Custom grouped by one) split each task evenly
//     between its LIVE items of that kind, a task with none under "No …";
//   * By asset gains a No asset row, Custom says No asset (not Unknown asset);
//   * a scene or shot outside the active list sends its share to "No scene in
//     the active list", the tooltip naming it (her rule of 2 October);
//   * the shown rows add exactly to the shown total (largest remainder);
//   * the Tasks column counts a task once in each row it touches, the Custom
//     footer keeps the true number;
//   * By phase reads a task's own phase, else its live assets' shared phase,
//     else Unphased (the Timeline's rule), and the Phase filter keeps or drops
//     whole tasks;
//   * BudgetView reads ctx.taskItems / ctx.taskItemsAvailable through the
//     model's buildItemLookup.
// The single-link tests are rabbitBudgetRender.test.jsx's, unchanged.
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react'
import { _resetOverlaysForTests } from '../../../ui/overlay'

vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))
const rabbit = vi.hoisted(() => ({ current: { project: { budget_currency: 'USD' } } }))
// BudgetView's module graph, as the render test mocks it, plus the four hooks
// the whole view calls when it is mounted (the tabs below are handed props).
vi.mock('../../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))
vi.mock('../../../permissions/usePermissions', () => ({ usePermissions: () => ({ role: 'admin', ready: true }) }))
vi.mock('../../../components/RateCard/useRateCard', () => ({
  useRateCard: () => ({ entries: [{ role_slug: 'anim', day_rate: 500 }], rateCards: [], activeRateCardId: null, settled: true }),
}))
vi.mock('../../../components/Budget/useProjectRateOverrides', () => ({ useProjectRateOverrides: () => ({ overrides: [], loading: false }) }))
vi.mock('../../../components/Expenses/useExpenses', () => ({ useExpenses: () => ({ expenses: [] }) }))
vi.mock('../../../components/Budget/useBudgetLines', () => ({
  useBudgetLines: () => ({ lines: [], lineComputations: {}, actualsByLine: {} }),
  COLUMN_MODES: [],
}))
vi.mock('../../../components/TeamMembers/useTeamMembers', () => ({ useTeamMembers: () => ({ members: [] }) }))

const { default: BudgetView, CustomTab, byAssetRows, bySceneRows, byShotRows, byItemListRows, byPhaseRows, customRows } = await import('./BudgetView')
const { buildItemLookup } = await import('../state/taskItemsModel')
const { NO_SCENE_GROUP, NO_SHOT_GROUP } = await import('./scenes/linkHomes')

afterEach(() => { cleanup(); _resetOverlaysForTests(); try { localStorage.clear() } catch { /* ignore */ } })

const roleRates = { anim: 500 }
const phases = [{ id: 'ph1', name: 'Build', sort_order: 0 }, { id: 'ph2', name: 'Delivery', sort_order: 1 }]
const assets = [
  { id: 'as-li', name: 'Lighthouse Interior', phase_id: 'ph1' },
  { id: 'as-sl', name: 'Storm Lantern', phase_id: 'ph1' },
  { id: 'as-dk', name: 'Dock', phase_id: 'ph2' },
]
let n = 0
/** One task_items row. */
const item = (taskId, kind, entityId, position = 0) => ({
  id: `it-${++n}`, task_id: taskId, project_id: 'p1', entity_type: kind, entity_id: entityId, position,
  created_at: `2026-10-16T09:00:0${n % 10}Z`,
})
/** The four figures and the count a row shows. */
const shown = (r) => ({ name: r.name, tasks: r.taskCount, bid: r.bid, logged: r.logged, variance: r.variance, cost: r.cost })
const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0)
/** A sum of tenths read as tenths (0.4 + 0.3 + 0.3 is 1.0000000000000002 in floats). */
const tenths = (v) => Math.round(v * 10) / 10

// Task t1, 4 days bid and 2 logged on Lighthouse Interior and Storm Lantern;
// t2, 1 day on all three assets; t3, 2 days on none.
const t1 = { id: 't1', title: 'Light the interior', assigned_role_slug: 'anim', bid_days: 4, logged_days: 2, status: 'in_progress' }
const t2 = { id: 't2', title: 'Rig the props', assigned_role_slug: 'anim', bid_days: 1, logged_days: 0, status: 'bidding' }
const t3 = { id: 't3', title: 'Edit', assigned_role_slug: 'anim', bid_days: 2, logged_days: 1, status: 'bidding' }
const ITEMS = [
  item('t1', 'asset', 'as-sl', 0), item('t1', 'asset', 'as-li', 1),
  item('t2', 'asset', 'as-li', 0), item('t2', 'asset', 'as-sl', 1), item('t2', 'asset', 'as-dk', 2),
]
const lookupOf = (extra = {}) => buildItemLookup({ items: ITEMS, available: true, assets, ...extra })

describe('By asset splits a task evenly between its assets (her Q-M1)', () => {
  it('a task on two assets puts half its days and money under each, and the rows add to the total', () => {
    const rows = byAssetRows({ assets, tasks: [t1], roleRates, lookup: lookupOf() })
    expect(rows.map(shown)).toEqual([
      { name: 'Lighthouse Interior', tasks: 1, bid: 2, logged: 1, variance: -1, cost: 1000 },
      { name: 'Storm Lantern', tasks: 1, bid: 2, logged: 1, variance: -1, cost: 1000 },
    ])
    expect([sum(rows, 'bid'), sum(rows, 'logged'), sum(rows, 'cost')]).toEqual([4, 2, 2000])
  })

  it('three ways, the rounding adds up exactly: 1 day and 500 make 0.4 + 0.3 + 0.3 and 167 + 167 + 166', () => {
    const rows = byAssetRows({ assets, tasks: [t2], roleRates, lookup: lookupOf() })
    // A tie gives the leftover tenth and unit to the earlier row, so the
    // column still reads largest first; the rows name A to Z on a tie.
    expect(rows.map(shown)).toEqual([
      { name: 'Dock', tasks: 1, bid: 0.4, logged: 0, variance: -0.4, cost: 167 },
      { name: 'Lighthouse Interior', tasks: 1, bid: 0.3, logged: 0, variance: -0.3, cost: 167 },
      { name: 'Storm Lantern', tasks: 1, bid: 0.3, logged: 0, variance: -0.3, cost: 166 },
    ])
    expect(tenths(sum(rows, 'bid'))).toBe(1)
    expect(tenths(sum(rows, 'variance'))).toBe(-1)
    expect(sum(rows, 'cost')).toBe(500)
  })

  it('a task with no asset is under No asset, last even when it is the largest, so the report adds up to the project total', () => {
    const big = { ...t3, bid_days: 9 }
    const rows = byAssetRows({ assets, tasks: [t1, t2, big], roleRates, lookup: lookupOf() })
    expect(rows.map(r => r.name)).toEqual(['Lighthouse Interior', 'Storm Lantern', 'Dock', 'No asset'])
    expect(shown(rows[3])).toEqual({ name: 'No asset', tasks: 1, bid: 9, logged: 1, variance: -8, cost: 4500 })
    // 4 + 1 + 9 days and 7,000 of money, every task in the report.
    expect(tenths(sum(rows, 'bid'))).toBe(14)
    expect(sum(rows, 'cost')).toBe(7000)
  })

  it('the Tasks column counts a task once in each row it touches', () => {
    const rows = byAssetRows({ assets, tasks: [t1, t2], roleRates, lookup: lookupOf() })
    expect(rows.map(r => [r.name, r.taskCount])).toEqual([['Lighthouse Interior', 2], ['Storm Lantern', 2], ['Dock', 1]])
  })

  it('an asset in the trash (not in the project\'s rows) is left out of the split, and the task is whole under its other asset (her Q-N4)', () => {
    const rows = byAssetRows({ assets: assets.filter(a => a.id !== 'as-sl'), tasks: [t1], roleRates,
      lookup: lookupOf({ assets: assets.filter(a => a.id !== 'as-sl') }) })
    expect(rows.map(shown)).toEqual([{ name: 'Lighthouse Interior', tasks: 1, bid: 4, logged: 2, variance: -2, cost: 2000 }])
  })

  it('a report that splits nothing adds up too: two quarter days are 0.3 and 0.2 under a total of 0.5', () => {
    const q1 = { id: 'q1', assigned_role_slug: 'anim', bid_days: 0.25, logged_days: 0, phase_id: 'ph1' }
    const q2 = { id: 'q2', assigned_role_slug: 'anim', bid_days: 0.25, logged_days: 0, phase_id: 'ph2' }
    const rows = byPhaseRows({ phases, assets, tasks: [q1, q2], roleRates, lookup: buildItemLookup({ items: [], available: true, assets }) })
    expect(rows.map(r => [r.name, r.bid, r.cost])).toEqual([['Build', 0.3, 125], ['Delivery', 0.2, 125]])
  })
})

describe('By scene and By shot: a share outside the active list goes to "No … in the active list" (her rule of 2 October)', () => {
  const harbour = { id: 'sA', name: 'Harbour', scene_number: 1 }
  const lighthouse = { id: 'sB', name: 'Lighthouse', scene_number: 2 }
  const shotA = { id: 'hA', scene_id: 'sA', name: 'SC001_SH010', shot_number: 10 }
  const shotB = { id: 'hB', scene_id: 'sB', name: 'SC002_SH010', shot_number: 10 }
  const every = { sA: harbour, sB: lighthouse, hA: shotA, hB: shotB }
  const find = (id) => every[id] || null
  const homeOf = (id) => ({
    lists: id === 'sB' || id === 'hB' ? [{ id: 'L2', title: 'Pickups', version: 1 }] : [{ id: 'L1', title: 'Shoot', version: 2 }],
    title: (name) => `${name}\nIn: ${id === 'sB' || id === 'hB' ? 'Pickups · v1' : 'Shoot · v2 (active)'}`,
  })
  const k1 = { id: 'k1', assigned_role_slug: 'anim', bid_days: 2, logged_days: 0 }
  const items = [item('k1', 'scene', 'sA'), item('k1', 'scene', 'sB'), item('k1', 'shot', 'hA'), item('k1', 'shot', 'hB')]
  // Every scene and shot of the project is live (ctx.allScenes / allShots);
  // the active list holds Harbour and its shot.
  const lookup = buildItemLookup({ items, available: true, scenes: [harbour, lighthouse], shots: [shotA, shotB] })

  it('By scene: half under Harbour, half under "No scene in the active list", whose tooltip names Lighthouse', () => {
    const rows = bySceneRows({ scenes: [harbour], shots: [shotA], sceneById: find, homeOf, tasks: [k1], roleRates, lookup })
    expect(rows.map(shown)).toEqual([
      { name: 'Harbour', tasks: 1, bid: 1, logged: 0, variance: -1, cost: 500 },
      { name: NO_SCENE_GROUP, tasks: 1, bid: 1, logged: 0, variance: -1, cost: 500 },
    ])
    expect(rows[0].title).toBe('Harbour\nIn: Shoot · v2 (active)')
    expect(rows[1].title).toBe('Tasks here are linked outside the active list:\nScene “Lighthouse”: in Pickups · v1, not in the active list')
  })

  it('By shot: the same, "Harbour › SC001_SH010" and "No shot in the active list"', () => {
    const rows = byShotRows({ shots: [shotA], scenes: [harbour], sceneById: find, shotById: find, homeOf, tasks: [k1], roleRates, lookup })
    expect(rows.map(r => [r.name, r.taskCount, r.bid, r.cost])).toEqual([
      ['Harbour › SC001_SH010', 1, 1, 500],
      [NO_SHOT_GROUP, 1, 1, 500],
    ])
    expect(rows[1].title).toBe('Tasks here are linked outside the active list:\nShot “SC002_SH010”: in Pickups · v1, not in the active list')
  })

  it('two scenes outside the active list are one task under "No scene in the active list", counted once with both shares', () => {
    const third = { id: 'sC', name: 'Cliff path', scene_number: 3 }
    const k2 = { id: 'k2', assigned_role_slug: 'anim', bid_days: 3, logged_days: 0 }
    const l = buildItemLookup({
      items: [item('k2', 'scene', 'sA'), item('k2', 'scene', 'sB'), item('k2', 'scene', 'sC')],
      available: true, scenes: [harbour, lighthouse, third],
    })
    const rows = bySceneRows({ scenes: [harbour], shots: [], sceneById: (id) => ({ ...every, sC: third })[id] || null, homeOf: null, tasks: [k2], roleRates, lookup: l })
    expect(rows.map(r => [r.name, r.taskCount, r.bid])).toEqual([['Harbour', 1, 1], [NO_SCENE_GROUP, 1, 2]])
  })

  it('a scene no longer in the project is left out of the split: the task is whole under Harbour', () => {
    const l = buildItemLookup({ items: [item('k3', 'scene', 'sA'), item('k3', 'scene', 'gone')], available: true, scenes: [harbour] })
    const rows = bySceneRows({ scenes: [harbour], shots: [], sceneById: find, homeOf, tasks: [{ id: 'k3', assigned_role_slug: 'anim', bid_days: 2 }], roleRates, lookup: l })
    expect(rows.map(r => [r.name, r.bid])).toEqual([['Harbour', 2]])
  })
})

describe('By level and By experience split the same way', () => {
  const levels = [{ id: 'lv1', name: 'Docks', sort_order: 0 }, { id: 'lv2', name: 'Tower', sort_order: 1 }]
  const experiences = [{ id: 'ex1', name: 'Arrival', sort_order: 0 }, { id: 'ex2', name: 'Storm', sort_order: 1 }]
  const g1 = { id: 'g1', assigned_role_slug: 'anim', bid_days: 3, logged_days: 1 }
  const g2 = { id: 'g2', assigned_role_slug: 'anim', bid_days: 1, logged_days: 0 }
  const items = [
    item('g1', 'level', 'lv2'), item('g1', 'level', 'lv1'),
    item('g1', 'experience', 'ex1'), item('g1', 'experience', 'ex2'),
  ]
  const lookup = buildItemLookup({ items, available: true, levels, experiences })

  it('By level: half each, in the levels\' order, then No level', () => {
    const rows = byItemListRows({ kind: 'level', list: levels, tasks: [g1, g2], roleRates, lookup })
    expect(rows.map(shown)).toEqual([
      { name: 'Docks', tasks: 1, bid: 1.5, logged: 0.5, variance: -1, cost: 750 },
      { name: 'Tower', tasks: 1, bid: 1.5, logged: 0.5, variance: -1, cost: 750 },
      { name: 'No level', tasks: 1, bid: 1, logged: 0, variance: -1, cost: 500 },
    ])
  })

  it('By experience: the same', () => {
    const rows = byItemListRows({ kind: 'experience', list: experiences, tasks: [g1, g2], roleRates, lookup })
    expect(rows.map(r => [r.name, r.taskCount, r.bid, r.cost])).toEqual([
      ['Arrival', 1, 1.5, 750], ['Storm', 1, 1.5, 750], ['No experience', 1, 1, 500],
    ])
  })
})

describe('By phase reads a task\'s own phase (the Timeline\'s rule)', () => {
  const lookup = buildItemLookup({
    items: [
      item('p1', 'asset', 'as-li'),
      item('p2', 'asset', 'as-li'), item('p2', 'asset', 'as-sl'),
      item('p3', 'asset', 'as-li'), item('p3', 'asset', 'as-dk'),
    ],
    available: true,
    assets,
  })
  const task = (id, extra) => ({ id, assigned_role_slug: 'anim', bid_days: 1, logged_days: 0, ...extra })

  it('its own phase first; else the phase all its live assets share; else Unphased', () => {
    const tasks = [
      task('p1', { phase_id: 'ph2' }),    // its own Delivery, though its asset is in Build
      task('p2'),                         // two assets, both in Build
      task('p3'),                         // assets in Build and Delivery: no one phase
      task('p4', { phase_id: 'ph1' }),    // a phase and no asset (Unphased before VW1m)
      task('p5'),                         // neither
    ]
    const rows = byPhaseRows({ phases, assets, tasks, roleRates, lookup })
    expect(rows.map(r => [r.name, r.taskCount])).toEqual([['Build', 2], ['Delivery', 1], ['Unphased', 2]])
  })

  it('the Custom tab groups by the same rule, and its Phase filter keeps or drops whole tasks', () => {
    const tasks = [task('p1', { phase_id: 'ph2' }), task('p2'), task('p3'), task('p4', { phase_id: 'ph1' })]
    const grouped = customRows({ groupBy: 'phase', tasks, phases, assets, roleRates, lookup })
    expect(grouped.map(r => [r.name, r.taskCount]).sort()).toEqual([['Build', 2], ['Delivery', 1], ['Unphased', 1]])

    // Filtered to Build and grouped by asset: p2 and p4, whole tasks (p3 is
    // Unphased, so it goes though it shares an asset with Build).
    localStorage.setItem('rabbit-budget-custom-p1', JSON.stringify({ groupBy: 'asset', phaseFilter: 'ph1' }))
    const { container } = render(
      <CustomTab project={{ id: 'p1' }} phases={phases} assets={assets} tasks={tasks}
        scenes={[]} shots={[]} levels={[]} experiences={[]} budget={{ currency: 'USD' }} roleRates={roleRates} lookup={lookup} />,
    )
    const body = [...container.querySelectorAll('tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent))
    expect(body).toEqual([
      ['No asset', '1', '1.0', '0.0', '-1.0', '$500'],
      ['Lighthouse Interior', '1', '0.5', '0.0', '-0.5', '$250'],
      ['Storm Lantern', '1', '0.5', '0.0', '-0.5', '$250'],
    ])
    expect([...container.querySelectorAll('tfoot td')].map(td => td.textContent)).toEqual(['Total', '2', '2.0', '', '', '$1,000'])
  })
})

describe('the Custom tab splits as the reports do', () => {
  it('grouped by asset: half and thirds, "No asset" (never "Unknown asset"), the footer\'s Tasks the true number', () => {
    localStorage.setItem('rabbit-budget-custom-p2', JSON.stringify({ groupBy: 'asset' }))
    const { container } = render(
      <CustomTab project={{ id: 'p2' }} phases={phases} assets={assets} tasks={[t1, t2, t3]}
        scenes={[]} shots={[]} levels={[]} experiences={[]} budget={{ currency: 'USD' }} roleRates={roleRates} lookup={lookupOf()} />,
    )
    const body = [...container.querySelectorAll('tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent))
    // t1's 4 days in halves and t2's 1 day in thirds: 2 + 1/3 each under the
    // two it shares, 1/3 under Dock; t3 whole under No asset.
    // The Custom tab sorts every group by its bid days, a "No …" one too.
    expect(body).toEqual([
      ['Lighthouse Interior', '2', '2.4', '1.0', '-1.4', '$1,167'],
      ['Storm Lantern', '2', '2.3', '1.0', '-1.3', '$1,167'],
      ['No asset', '1', '2.0', '1.0', '-1.0', '$1,000'],
      ['Dock', '1', '0.3', '0.0', '-0.3', '$166'],
    ])
    expect(container.textContent).not.toContain('Unknown asset')
    // The rows add to the footer, and the footer counts three tasks, not six.
    expect([...container.querySelectorAll('tfoot td')].map(td => td.textContent)).toEqual(['Total', '3', '7.0', '', '', '$3,500'])
  })
})

describe('BudgetView reads a task\'s items from the provider (ctx.taskItems, ctx.taskItemsAvailable)', () => {
  const project = { id: 'pv', budget_currency: 'USD', budget_margin_pct: 0, budget_contingency_pct: 0 }
  async function openTab(name) {
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name })) })
    return [...document.querySelectorAll('table.rb-budget-report tbody tr')]
      .map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent))
  }

  it('where items are kept: the tasks carry no link field, and By asset splits them by their items', async () => {
    rabbit.current = { project, phases, assets, tasks: [t1, t2, t3], taskItems: ITEMS, taskItemsAvailable: true, teamAssignments: [] }
    render(<BudgetView />)
    expect(await openTab('By asset')).toEqual([
      ['Lighthouse Interior', '2', '2.4', '1.0', '-1.4', '$1,167'],
      ['Storm Lantern', '2', '2.3', '1.0', '-1.3', '$1,167'],
      ['Dock', '1', '0.3', '0.0', '-0.3', '$166'],
      ['No asset', '1', '2.0', '1.0', '-1.0', '$1,000'],
    ])
  })

  it('where the backend keeps no items: each task\'s own single field is its one item', async () => {
    rabbit.current = {
      project, phases, assets,
      tasks: [{ ...t1, asset_id: 'as-sl' }, { ...t2, asset_id: 'as-dk' }, t3],
      taskItems: ITEMS, taskItemsAvailable: false, teamAssignments: [],
    }
    render(<BudgetView />)
    expect(await openTab('By asset')).toEqual([
      ['Storm Lantern', '1', '4.0', '2.0', '-2.0', '$2,000'],
      ['Dock', '1', '1.0', '0.0', '-1.0', '$500'],
      ['No asset', '1', '2.0', '1.0', '-1.0', '$1,000'],
    ])
  })

  it('By phase reads the items too: a task with no phase of its own is under its assets\' shared phase', async () => {
    rabbit.current = { project, phases, assets, tasks: [t1, t2, { ...t3, phase_id: 'ph2' }], taskItems: ITEMS, taskItemsAvailable: true, teamAssignments: [] }
    render(<BudgetView />)
    expect((await openTab('By phase')).map(r => [r[0], r[1]])).toEqual([['Build', '1'], ['Delivery', '1'], ['Unphased', '1']])
  })
})
