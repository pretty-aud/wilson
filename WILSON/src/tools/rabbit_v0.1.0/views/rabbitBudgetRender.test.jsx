/** @vitest-environment jsdom */
// =============================================================================
// Lane B5, mounted: the Budget's surfaces on the kit and rabbitBudget.css.
// rabbitBudgetCss.test.js reads source text; this renders each surface and
// asserts what a user would meet. One describe per surface, added in the
// commit that moves it.
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, within, screen, fireEvent, act } from '@testing-library/react'
import { _resetOverlaysForTests } from '../../../ui/overlay'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))
const rabbit = vi.hoisted(() => ({ current: { project: { budget_currency: 'EUR' } } }))
// BudgetView's module graph (surface 2a): its hooks reach the cloud client
// and the permission hook at import; the tabs mounted below are handed their
// data as props and call neither.
vi.mock('../../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))
vi.mock('../../../permissions/usePermissions', () => ({ usePermissions: () => ({ role: 'admin', ready: true }) }))
vi.mock('../../../components/RateCard/useRateCard', () => ({ useRateCard: () => ({ entries: [], rateCards: [] }) }))

const { default: CurrencyDisplay, formatMoney, MONEY_LOCALE } = await import('../components/CurrencyDisplay')
const { SummaryTab, BreakdownTable, CustomTab, ByPhaseTab, CenterMsg, ExpensesTab, ExpensePopup } = await import('./BudgetView')
const { default: BudgetPopover, placePopover } = await import('./budget/BudgetPopover')
const { default: MarginContPopover } = await import('./budget/MarginContPopover')
const clientModule = await import('./budget/ClientViewTab')

afterEach(() => { cleanup() })

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, rel), 'utf8').replace(/\r\n/g, '\n')
const BUDGET_FILES = ['./BudgetView.jsx', './budget/CrewTeamTab.jsx', './budget/TalentTab.jsx', './budget/ClientViewTab.jsx']

/* ── surface 1: the money primitives (R3-01, R3-02, R3-14, R3-34) ────────── */
describe('one money formatter', () => {
  it('formats in one locale, whatever the viewer\'s is', () => {
    expect(MONEY_LOCALE).toBe('en-US')
    expect(formatMoney(1234567, 'USD')).toBe('$1,234,567')
    expect(formatMoney(1234.6, 'EUR')).toBe('€1,235')
    expect(formatMoney(1234.5, 'USD', { fractionDigits: 2 })).toBe('$1,234.50')
  })
  it('reads a missing amount as zero, as the four copies it replaces did', () => {
    expect(formatMoney(null, 'USD')).toBe('$0')
    expect(formatMoney(undefined, 'USD')).toBe('$0')
    expect(formatMoney('12', 'USD')).toBe('$12')
  })
  it('places a sign where Intl places a negative\'s: before the symbol, both ways, and none on zero', () => {
    const signed = (v) => formatMoney(v, 'USD', { sign: 'exceptZero' })
    expect([signed(1234), signed(-1234), signed(0)]).toEqual(['+$1,234', '-$1,234', '$0'])
    // An amount added by definition keeps its plus at zero, as the popovers print it.
    expect(formatMoney(0, 'USD', { sign: 'always' })).toBe('+$0')
  })
  it('says what an unknown currency code is rather than throwing', () => {
    expect(formatMoney(12.4, 'NOPE')).toBe('NOPE 12')
  })
  it('every copy is gone: no view formats money itself', () => {
    for (const f of BUDGET_FILES) {
      const src = read(f)
      expect(src, f).not.toMatch(/function fmtC(urrency)?\(|toLocaleString\('en-US', \{ style: 'currency'/)
      expect(src, f).not.toMatch(/'\+' : ''\}\$\{|`\+\$\{|'\+' : ''\}\s*\{?<CurrencyDisplay/)
      expect(src, f).toMatch(/formatMoney/)
    }
  })
})

describe('CurrencyDisplay: the figure', () => {
  it('is the tabular mono figure, in the caller\'s ink and size (no style of its own)', () => {
    const { container } = render(<p style={{ color: 'rgb(1, 2, 3)' }}><CurrencyDisplay value={1200} currency="USD" /></p>)
    const span = container.querySelector('span')
    expect(span.className).toBe('rb-money-figure')
    expect(span.getAttribute('style')).toBeNull()
    expect(span.textContent).toBe('$1,200')
  })
  it('takes the project\'s currency when none is passed', () => {
    const { container } = render(<CurrencyDisplay value={50} />)
    expect(container.textContent).toBe('€50')
  })
  it('`signed` shows the sign Intl places; a missing value is the fallback dash', () => {
    const { container, rerender } = render(<CurrencyDisplay value={-40} currency="USD" signed />)
    expect(container.textContent).toBe('-$40')
    rerender(<CurrencyDisplay value={40} currency="USD" signed />)
    expect(container.textContent).toBe('+$40')
    rerender(<CurrencyDisplay value={null} currency="USD" />)
    expect(container.textContent).toBe('—')
    rerender(<CurrencyDisplay value={Number.NaN} currency="USD" fallback="n/a" />)
    expect(container.textContent).toBe('n/a')
  })
  it('a caller\'s class joins the figure\'s', () => {
    const { container } = render(<CurrencyDisplay value={1} currency="USD" className="rb-budget-x" />)
    expect(container.querySelector('span').className).toBe('rb-money-figure rb-budget-x')
  })
})

/* ── surface 2a: Summary, the seven reports, Custom (R3-03 … R3-38) ───────── */
describe('surface 2a', () => {
  const phases = [{ id: 'ph1', name: 'Pre-production', sort_order: 0 }, { id: 'ph2', name: 'Delivery', sort_order: 1 }]
  const assets = [{ id: 'a1', name: 'Hero', phase_id: 'ph1' }, { id: 'a2', name: 'Logo', phase_id: 'ph2' }]
  const tasks = [
    { id: 't1', asset_id: 'a1', assigned_role_slug: 'anim', bid_days: 4, logged_days: 5, status: 'in_progress' },
    { id: 't2', asset_id: 'a1', assigned_role_slug: 'anim', bid_days: 2, logged_days: 1, status: 'approved' },
    { id: 't3', asset_id: 'a2', assigned_role_slug: 'anim', bid_days: 3, logged_days: 0, status: 'bidding' },
  ]
  const roleRates = { anim: 500 }
  const budget = { total: 4500, byRole: {}, currency: 'USD' }

  /** Every declaration of a colour, a ground or an edge in an inline style —
      what this surface moved into rabbitBudget.css. A width (the kit Th's) is
      not one. */
  const inlineColours = (root) => [...root.querySelectorAll('[style]')]
    .map((el) => el.getAttribute('style'))
    .filter((s) => /(^|;)\s*(color|background(-color)?|border(-[a-z]+)*|fill|stroke|opacity)\s*:/i.test(s))

  it('a report is a real <table>: Name left, every figure a right-aligned numeric cell, header included (R3-03, R3-20)', () => {
    const { container } = render(<ByPhaseTab phases={phases} assets={assets} tasks={tasks} budget={budget} roleRates={roleRates} />)
    const table = container.querySelector('table.ui-table.rb-budget-report')
    expect(table).not.toBeNull()
    const ths = [...table.querySelectorAll('thead th')]
    expect(ths.map((th) => th.textContent)).toEqual(['Phase', 'Tasks', 'Bid', 'Logged', 'Variance', 'Cost'])
    expect(ths[0].getAttribute('data-numeric')).toBeNull()
    for (const th of ths.slice(1)) {
      expect(th.getAttribute('data-numeric'), th.textContent).toBe('true')
      expect(th.getAttribute('data-align'), th.textContent).toBe('right')
    }
    const rows = [...table.querySelectorAll('tbody tr')]
    expect(rows).toHaveLength(2)
    const first = [...rows[0].querySelectorAll('td')]
    expect(first.map((td) => td.textContent)).toEqual(['Pre-production', '2', '6.0', '6.0', '0.0', '$3,000'])
    expect(first[0].getAttribute('data-numeric')).toBeNull()
    for (const td of first.slice(1)) {
      expect(td.getAttribute('data-numeric')).toBe('true')
      expect(td.getAttribute('data-align')).toBe('right')
    }
    // The day variance's sign is Intl's, and its news is its tone.
    const second = [...rows[1].querySelectorAll('td')]
    expect(second[4].textContent).toBe('-3.0')
    expect(second[4].querySelector('.rb-budget-var').getAttribute('data-tone')).toBe('success')
    expect(inlineColours(container)).toEqual([])
  })

  it('Custom\'s totals are the <tfoot> of the table they total, not a sibling row (R3-04)', () => {
    try { localStorage.clear() } catch { /* ignore */ }
    const { container } = render(
      <CustomTab project={{ id: 'p1' }} phases={phases} assets={assets} tasks={tasks}
        scenes={[]} shots={[]} levels={[]} experiences={[]} budget={budget} roleRates={roleRates} />,
    )
    const tables = container.querySelectorAll('table')
    expect(tables).toHaveLength(1)
    const foot = tables[0].querySelector('tfoot')
    expect(foot).not.toBeNull()
    const cells = [...foot.querySelectorAll('td')]
    expect(cells.map((td) => td.textContent)).toEqual(['Total', '3', '9.0', '', '', '$4,500'])
    expect(cells.filter((td) => td.getAttribute('data-numeric') === 'true').map((td) => td.textContent)).toEqual(['3', '9.0', '$4,500'])
    // The same six columns as the header: the total sits under what it totals.
    expect(cells).toHaveLength(tables[0].querySelectorAll('thead th').length)
    // The status filter is the kit's field, with no status colour of its own.
    const status = container.querySelector('select[aria-label="Status filter"]')
    expect(status.className).toContain('ui-input')
    expect(status.getAttribute('style')).toBeNull()
    expect([...status.options].map((o) => o.textContent)).toContain('Needs revisions')
    expect(inlineColours(container)).toEqual([])
  })

  it('BreakdownTable passes its `foot` through into the one table', () => {
    const { container } = render(
      <BreakdownTable
        rows={[{ name: 'A', taskCount: 1, bid: 1, logged: 1, variance: 0, cost: 10 }]}
        currency="USD" labelHeader="Phase" countHeader="Tasks"
        foot={<tr><td>foot</td></tr>}
      />,
    )
    expect(container.querySelector('table > tfoot')?.textContent).toBe('foot')
  })

  describe('the Summary', () => {
    const versions = [
      { id: 'v1', name: 'Bid v1', is_active: true, created_at: '2026-09-01T12:00:00Z', snapshot: { grandTotal: 5600, totalBidDays: 9 } },
      { id: 'v0', name: 'Bid v0', is_active: false, created_at: '2026-08-01T12:00:00Z', snapshot: { grandTotal: 4000, totalBidDays: 8 } },
    ]
    const summary = (over = {}) => (
      <SummaryTab
        ctx={{ updateProject: vi.fn(), setActiveProject: vi.fn(), getAdapter: () => ({ upsertBudgetVersion: vi.fn(), deleteBudgetVersion: vi.fn() }) }}
        project={{
          id: 'p1', budget_margin_pct: 10, budget_contingency_pct: 5, budget_agency_enabled: true, budget_agency_pct: 20,
          budget_active: true, budget_active_version_id: 'v1', budget_finalized: true, ...over,
        }}
        variance={{ bid: 9, logged: 6, variance: -3 }}
        budget={budget}
        tasks={tasks}
        roleRates={roleRates}
        missingRolesCount={0}
        rateCardName="General"
        budgetVersions={versions}
        budgetHook={{ lines: [], lineComputations: {} }}
        rateCard={{ entries: [] }}
        teamMembers={[]}
        expensesHook={{ expenses: [{ estimated_cost: 300, actual_cost: 450 }] }}
      />
    )

    it('the three day tiles are the kit Stat, the hint a visible line, the news the value\'s tone (R3-10)', () => {
      const { container } = render(summary())
      const tiles = [...container.querySelectorAll('.ui-stat')]
      expect(tiles).toHaveLength(3)
      for (const t of tiles) expect(t.classList.contains('rb-budget-stat')).toBe(true)
      expect(tiles.map((t) => t.querySelector('.ui-stat-label').textContent)).toEqual(['Bid days', 'Logged days', 'Variance'])
      expect(tiles.map((t) => t.querySelector('.ui-stat-delta')?.textContent)).toEqual(['3 tasks', '67% of bid', 'Under budget'])
      const variance = tiles[2].querySelector('.ui-stat-value')
      expect(variance.textContent).toBe('-3.0')
      expect(variance.getAttribute('data-tone')).toBe('success')
    })

    it('the waterfall: one row treatment, the plus is the figure\'s sign, the grand total under one signal rule (R3-08, R3-09)', () => {
      const { container } = render(summary())
      const rows = [...container.querySelectorAll('.rb-budget-wf-row')]
      expect(rows.map((r) => r.querySelector('.rb-budget-wf-label').textContent)).toEqual(['Base cost', 'Margin', 'Contingency', 'Agency fee'])
      expect(rows.map((r) => r.querySelector('.rb-budget-wf-amount').textContent)).toEqual(['$4,500', '+$450', '+$225', '+$900'])
      const total = container.querySelector('.rb-budget-wf-total')
      expect(total.querySelector('.rb-budget-wf-total-label').textContent).toBe('Grand total')
      expect(total.querySelector('.rb-money-figure').textContent).toBe('$6,075')
      // The agency toggle is the kit Switch, named, and locked while the budget is active.
      const toggle = container.querySelector('button[role="switch"]')
      expect(toggle.getAttribute('aria-label')).toBe('Agency fee')
      expect(toggle.getAttribute('aria-checked')).toBe('true')
      expect(toggle.disabled).toBe(true)
    })

    it('the versions table: the ACTIVE version is the kit\'s selected row, LOCKED a badge in it, no row fill (R3-28, R3-38)', () => {
      const { container } = render(summary())
      const table = container.querySelector('table.ui-table.rb-budget-versions')
      expect(table).not.toBeNull()
      expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Active', 'Name', 'Date', 'Total', 'Days', 'Actions'])
      const rows = [...table.querySelectorAll('tbody tr')]
      expect(rows.map((r) => r.getAttribute('data-selected'))).toEqual(['true', null])
      const active = within(rows[0])
      expect(active.getByText('Bid v1')).toBeTruthy()
      const badge = rows[0].querySelector('.ui-status')
      expect(badge?.textContent).toBe('Locked')
      expect(badge.getAttribute('data-tone')).toBe('success')
      expect(rows[1].querySelector('.ui-status')).toBeNull()
      for (const r of rows) {
        expect(r.getAttribute('style')).toBeNull()
        for (const td of r.querySelectorAll('td')) expect(td.getAttribute('style')).toBeNull()
      }
      // Every existing control stays: set-active on the other row, delete on both.
      expect(within(rows[1]).getByRole('button', { name: 'Reset to bidding to change versions' })).toBeTruthy()
      expect(within(rows[0]).getByRole('button', { name: 'Cannot delete locked version' }).disabled).toBe(true)
      expect(within(rows[1]).getByRole('button', { name: 'Delete version' })).toBeTruthy()
      // Money and days are numeric cells.
      expect([...rows[0].querySelectorAll('td[data-numeric="true"]')].map((td) => td.textContent)).toEqual(['$5,600', '9.0'])
    })

    it('the Topsheet: a real table whose grand total is its <tfoot>, figures numeric (R3-20, R3-08)', () => {
      const { container } = render(summary())
      const table = container.querySelector('table.ui-table.rb-budget-top')
      expect(table).not.toBeNull()
      expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Category', 'Subtotal', 'Agency', 'Bid', 'Actual', 'Variance'])
      const foot = [...table.querySelectorAll('tfoot td')]
      expect(foot.map((td) => td.textContent)).toEqual(['Grand total', '$300', '$0', '$300', '$450', '+$150'])
      expect(foot.slice(1).every((td) => td.getAttribute('data-numeric') === 'true')).toBe(true)
      expect(foot[5].querySelector('.rb-budget-var').getAttribute('data-tone')).toBe('danger')
    })

    it('no element in the mounted Summary carries an inline colour, ground or edge', () => {
      const { container } = render(summary())
      expect(inlineColours(container)).toEqual([])
      // …bidding too: the unlocked Summary shows the version form and the activate button.
      cleanup()
      const again = render(summary({ budget_active: false, budget_active_version_id: null, budget_finalized: false }))
      expect(again.getByRole('button', { name: 'Set budget active' })).toBeTruthy()
      expect(inlineColours(again.container)).toEqual([])
    })
  })

  it('the view\'s "not yet" is the kit Loading, never the empty state; its "nothing" is the kit EmptyState (R3-19)', () => {
    const { container, rerender } = render(<CenterMsg>Loading project...</CenterMsg>)
    expect(container.querySelector('.ui-loading-inline')?.getAttribute('aria-label')).toBe('Loading project...')
    expect(container.querySelector('.ui-empty')).toBeNull()
    rerender(<CenterMsg>No project loaded</CenterMsg>)
    expect(container.querySelector('.ui-empty .ui-empty-title')?.textContent).toBe('No project loaded')
    expect(container.querySelector('.ui-loading-inline')).toBeNull()
  })
})

/* ── surface 2b: the Expenses tab (R3-15 … R3-40, W9) ────────────────────── */
describe('surface 2b', () => {
  afterEach(() => {
    cleanup()
    _resetOverlaysForTests()
    try { localStorage.clear() } catch { /* ignore */ }
  })

  /** Every declaration of a colour, a ground or an edge in an inline style. */
  const inlineColours = (root) => [...root.querySelectorAll('[style]')]
    .map((el) => el.getAttribute('style'))
    .filter((s) => /(^|;)\s*(color|background(-color)?|border(-[a-z]+)*|fill|stroke|opacity)\s*:/i.test(s))

  const EXPENSES = [
    { id: 'e1', title: 'Camera package hire', description: 'Two-week hire', estimated_cost: 16800, actual_cost: 16800, purchase_date: '2026-09-08', phase_ids: ['ph1'], file_ids: ['f1'], contingency_pct: 10 },
    { id: 'e2', title: 'Set timber and paint', estimated_cost: 4200, actual_cost: 3860, purchase_date: '2026-09-05', asset_ids: ['a1'], phase_ids: ['ph1'], task_ids: ['t1'], margin_pct: 5 },
    { id: 'e3', title: '', estimated_cost: 260, actual_cost: 284, purchase_date: '' },
  ]
  /** The useExpenses hook, mocked: what the tab reads and the writes it makes. */
  const hook = (over = {}) => ({
    expenses: EXPENSES,
    loading: false,
    addExpense: vi.fn(async () => {}),
    updateExpense: vi.fn(async () => {}),
    deleteExpense: vi.fn(async () => {}),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: true,
    ...over,
  })
  const PROJECT = { id: 'p1', budget_margin_pct: 0, budget_contingency_pct: 0 }
  const tab = (h = hook(), project = PROJECT) => (
    <ExpensesTab ctx={{ getAdapter: () => ({}) }} project={project} phases={[]} assets={[]} tasks={[]} expensesHook={h} currency="USD" />
  )
  const rowsOf = (root) => [...root.querySelectorAll('table.rb-budget-exp tbody tr.rb-budget-exp-row')]
  const titles = (root) => rowsOf(root).map((r) => r.querySelector('.rb-budget-exp-title').textContent)

  it('the list is the kit Table: the same columns, the lane\'s one money order, every figure a numeric cell (R3-20, R3-05)', () => {
    const { container } = render(tab())
    const table = container.querySelector('table.ui-table.rb-budget-exp')
    expect(table).not.toBeNull()
    const ths = [...table.querySelectorAll('thead th')]
    expect(ths.map((th) => th.textContent)).toEqual(['', 'Title', 'Estimated', 'Margin', 'Conting.', 'Actual', 'Variance', 'Date', 'Related', 'Files', 'Actions'])
    // Figures right-aligned, their headers with them; the words left.
    expect(ths.filter((th) => th.getAttribute('data-numeric') === 'true').map((th) => th.textContent))
      .toEqual(['Estimated', 'Margin', 'Conting.', 'Actual', 'Variance', 'Files'])
    // The tab's default order, newest first; an untitled expense says so.
    expect(titles(container)).toEqual(['Camera package hire', 'Set timber and paint', 'Untitled'])
    const rows = rowsOf(container)
    const numeric = (r) => [...r.querySelectorAll('td[data-numeric="true"]')].map((td) => td.textContent)
    expect(numeric(rows[0])).toEqual(['$16,800', '—', '+$1,680', '$16,800', '$0', '1'])
    expect(numeric(rows[1])).toEqual(['$4,200', '+$210', '—', '$3,860', '-$340', '—'])
    expect(numeric(rows[2])).toEqual(['$260', '—', '—', '$284', '+$24', '—'])
    // Money is the one figure (CurrencyDisplay); a variance is signed and its
    // news is its tone.
    expect(rows[1].querySelectorAll('td[data-numeric="true"] .rb-money-figure')).toHaveLength(4)
    expect(rows[0].querySelector('.rb-budget-var').getAttribute('data-tone')).toBeNull()
    expect(rows[1].querySelector('.rb-budget-var').getAttribute('data-tone')).toBe('success')
    expect(rows[2].querySelector('.rb-budget-var').getAttribute('data-tone')).toBe('danger')
    // A header sorts its column, as its click always did; the kit's arrow and
    // aria-sort say which way.
    expect(ths[7].getAttribute('aria-sort')).toBe('descending')
    fireEvent.click(within(ths[2]).getByRole('button'))
    expect(ths[2].getAttribute('aria-sort')).toBe('ascending')
    expect(titles(container)).toEqual(['Untitled', 'Set timber and paint', 'Camera package hire'])
    expect(inlineColours(container)).toEqual([])
  })

  it('a row: the kit Row\'s one hover and one selection, a 28px checkbox that keeps its focus, Edit and Delete in the kit HoverActions (R3-23, R3-38, R3-40, R3-24)', () => {
    const { container } = render(tab())
    const row = rowsOf(container)[0]
    expect(row.getAttribute('data-interactive')).toBe('true')
    // Edit and Delete: the kit's reserved slot, hidden at rest as they were,
    // and reachable by focus, which reveals them (Q17(b)).
    const slot = row.querySelector('.ui-hover-actions')
    expect(slot.getAttribute('data-always')).toBeNull()
    expect(within(slot).getByRole('button', { name: 'Delete' })).toBeTruthy()
    const edit = within(slot).getByRole('button', { name: 'Edit' })
    edit.focus()
    expect(document.activeElement).toBe(edit)
    expect(row.contains(document.activeElement)).toBe(true)
    expect(readFileSync(join(here, '../../../index.css'), 'utf8'))
      .toMatch(/:where\(tr, li, \.ui-hover-host\):focus-within \.ui-hover-actions/)
    // One slot width, declared once for every row.
    expect(container.querySelector('thead th:last-child').style.width).toBe('var(--rb-budget-exp-col-acts)')
    // The checkbox ticks without opening the row, and it is the same element
    // afterwards: the row is not remounted, so the focus stays on it.
    const check = within(row).getByRole('button', { name: 'Select "Camera package hire"' })
    expect(check.className).toBe('rb-budget-check')
    check.focus()
    fireEvent.click(check)
    expect(row.getAttribute('data-selected')).toBe('true')
    expect(check.getAttribute('aria-pressed')).toBe('true')
    expect(check.isConnected).toBe(true)
    expect(document.activeElement).toBe(check)
    expect(screen.queryByRole('dialog')).toBeNull()
    // Selected is said one way, the kit Row's: no inline tint, no border.
    for (const el of [row, ...row.querySelectorAll('td')]) expect(el.getAttribute('style')).toBeNull()
  })

  it('W9: the bulk Delete and Reset M/C ask on the kit Dialog in <body>; Cancel changes nothing, the action does what OK did', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    const h = hook()
    const { container } = render(tab(h))
    const rows = rowsOf(container)
    fireEvent.click(within(rows[0]).getByRole('button', { name: /^Select/ }))
    fireEvent.click(within(rows[2]).getByRole('button', { name: /^Select/ }))
    const bar = () => container.querySelector('.rb-budget-bulk')
    expect(bar().textContent).toContain('2 selected')

    // The bulk Delete: the confirm's own words, portalled.
    fireEvent.click(within(bar()).getByRole('button', { name: 'Delete' }))
    let dialog = screen.getByRole('dialog', { name: 'Delete expenses' })
    expect(dialog.closest('.ui-dialog-backdrop').parentElement).toBe(document.body)
    expect(container.contains(dialog)).toBe(false)
    expect(dialog.querySelector('.ui-dialog-body').textContent).toBe('Delete 2 expenses?')
    expect(document.activeElement.textContent).toBe('Cancel')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(h.deleteExpense).not.toHaveBeenCalled()
    expect(rowsOf(container)).toHaveLength(3)
    expect(container.querySelectorAll('tbody tr[data-selected="true"]')).toHaveLength(2)
    fireEvent.click(within(bar()).getByRole('button', { name: 'Delete' }))
    dialog = screen.getByRole('dialog', { name: 'Delete expenses' })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' })) })
    expect(h.deleteExpense.mock.calls.map((c) => c[0]).sort()).toEqual(['e1', 'e3'])
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(bar()).toBeNull()

    // Reset M/C: the same.
    fireEvent.click(screen.getByRole('button', { name: 'Reset M/C' }))
    dialog = screen.getByRole('dialog', { name: 'Reset margin & contingency' })
    expect(dialog.closest('.ui-dialog-backdrop').parentElement).toBe(document.body)
    expect(dialog.querySelector('.ui-dialog-body').textContent)
      .toBe('Reset all margin & contingency values to the project defaults? This cannot be undone.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(h.updateExpense).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Reset M/C' }))
    dialog = screen.getByRole('dialog', { name: 'Reset margin & contingency' })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Reset' })) })
    // Only the two with values of their own are written, as OK wrote them.
    expect(h.updateExpense.mock.calls).toEqual([
      ['e1', { margin_pct: null, contingency_pct: null }],
      ['e2', { margin_pct: null, contingency_pct: null }],
    ])
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(confirm).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('a row\'s Delete asks as it always did, now on the kit Dialog in <body>; Delete deletes that one', async () => {
    const h = hook()
    const { container } = render(tab(h))
    fireEvent.click(within(rowsOf(container)[1]).getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete expense' })
    expect(dialog.closest('.ui-dialog-backdrop').parentElement).toBe(document.body)
    expect(dialog.textContent).toContain('This will permanently remove this expense. You can undo with Ctrl+Z.')
    // The row's own click (edit) did not fire.
    expect(screen.queryByRole('dialog', { name: 'Edit expense' })).toBeNull()
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' })) })
    expect(h.deleteExpense).toHaveBeenCalledWith('e2')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the margin & contingency popover is the lane\'s one: portalled to <body>, closed by an outside mousedown and by Escape, no inline colour (R3-32)', async () => {
    const h = hook()
    const { container } = render(tab(h))
    const contCell = rowsOf(container)[0].querySelectorAll('.rb-budget-exp-mc')[1]
    const open = () => { fireEvent.click(contCell); return screen.getByRole('dialog', { name: 'Margin & contingency' }) }
    let pop = open()
    expect(pop.parentElement).toBe(document.body)
    expect(container.contains(pop)).toBe(false)
    expect(pop.className).toBe('rb-pop-panel')
    // Its one style is its width and its measured place, as custom
    // properties; nothing in it or the page is an inline colour.
    expect(pop.getAttribute('style')).toMatch(/^--rb-pop-w: 280; --rb-pop-x: \d+; --rb-pop-y: \d+;$/)
    expect(inlineColours(document.body)).toEqual([])
    // A cell opens the popover, not the row's edit dialog.
    expect(screen.queryByRole('dialog', { name: 'Edit expense' })).toBeNull()
    // The line's values, and the amount each adds (a plus even at zero).
    const margin = within(pop).getByRole('spinbutton', { name: 'Margin %' })
    expect(document.activeElement).toBe(margin)
    expect(margin.value).toBe('0')
    expect(within(pop).getByRole('spinbutton', { name: 'Contingency %' }).value).toBe('10')
    expect([...pop.querySelectorAll('.rb-pop-amount')].map((a) => a.textContent)).toEqual(['+$0', '+$1,680'])
    // A press inside keeps it; one outside closes it, as the hand-rolled ones did.
    fireEvent.mouseDown(margin)
    expect(pop.isConnected).toBe(true)
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('dialog', { name: 'Margin & contingency' })).toBeNull()
    // Escape closes it too (Q17: none of the five did) and marks the key handled.
    pop = open()
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => { document.activeElement.dispatchEvent(esc) })
    expect(esc.defaultPrevented).toBe(true)
    expect(screen.queryByRole('dialog', { name: 'Margin & contingency' })).toBeNull()
    // Save writes through the hook and closes.
    pop = open()
    fireEvent.change(within(pop).getByRole('spinbutton', { name: 'Margin %' }), { target: { value: '12' } })
    expect([...pop.querySelectorAll('.rb-pop-amount')].map((a) => a.textContent)).toEqual(['+$2,016', '+$1,680'])
    await act(async () => { fireEvent.click(within(pop).getByRole('button', { name: 'Save' })) })
    expect(h.updateExpense).toHaveBeenCalledWith('e1', { margin_pct: 12, contingency_pct: 10 })
    expect(screen.queryByRole('dialog', { name: 'Margin & contingency' })).toBeNull()
  })

  it('BudgetPopover places itself by its own measured box, never a written 280 x 320 (R3-32)', () => {
    // Below the anchor if it fits; else above; else as low as the window allows.
    expect(placePopover({ x: 40, y: 100, h: 28 }, 280, 200, 1024, 768)).toEqual({ x: 40, y: 132 })
    expect(placePopover({ x: 900, y: 700, h: 28 }, 300, 250, 1024, 768)).toEqual({ x: 712, y: 446 })
    expect(placePopover({ x: 40, y: 300, h: 28 }, 280, 700, 1024, 768)).toEqual({ x: 40, y: 56 })
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300)
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(250)
    try {
      render(<BudgetPopover anchor={{ x: 900, y: 700, h: 28 }} title="Actual" onClose={() => {}} width={300}><p>Body</p></BudgetPopover>)
      const pop = screen.getByRole('dialog', { name: 'Actual' })
      expect(pop.style.getPropertyValue('--rb-pop-x')).toBe('712')
      expect(pop.style.getPropertyValue('--rb-pop-y')).toBe('446')
    } finally {
      width.mockRestore()
      height.mockRestore()
    }
  })

  it('MarginContPopover takes general props, ready for Crew and Talent: the base, its name, the defaults', () => {
    const onSave = vi.fn()
    const onClose = vi.fn()
    render(
      <MarginContPopover anchor={{ x: 10, y: 10, h: 28 }} amountLabel="Bid" baseAmount={1000} marginPct={10} contPct={5}
        defaultMargin={20} defaultCont={15} currency="USD" onSave={onSave} onClose={onClose} />,
    )
    const pop = screen.getByRole('dialog', { name: 'Margin & contingency' })
    const amounts = [...pop.querySelectorAll('.rb-pop-amount')]
    expect(amounts.map((a) => a.textContent)).toEqual(['+$100', '+$50'])
    expect(amounts[0].getAttribute('title')).toBe('Bid $1,000 × 10%')
    expect(within(pop).getByRole('spinbutton', { name: 'Margin %' }).getAttribute('placeholder')).toBe('20')
    fireEvent.click(within(pop).getByRole('button', { name: 'Default' }))
    fireEvent.click(within(pop).getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith({ margin_pct: 20, contingency_pct: 15 })
    fireEvent.click(within(pop).getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('New expense and a row open ExpensePopup: the kit Dialog named by its title, in <body>, every field in its order (Q17)', async () => {
    const h = hook()
    const { container } = render(tab(h))
    fireEvent.click(screen.getByRole('button', { name: 'New expense' }))
    const dialog = screen.getByRole('dialog', { name: 'New expense' })
    expect(dialog.className).toContain('ui-dialog')
    expect(dialog.getAttribute('data-width')).toBe('form')
    expect(dialog.closest('.ui-dialog-backdrop').parentElement).toBe(document.body)
    expect([...dialog.querySelectorAll('.ui-field-label')].map((l) => l.textContent)).toEqual([
      'Title *', 'Estimated cost (USD)', 'Actual cost (USD)', 'Variance', 'Purchase date',
      'Description / reason', 'Related items', 'Invoices / receipts',
    ])
    const title = within(dialog).getByRole('textbox', { name: 'Title' })
    expect(document.activeElement).toBe(title)
    const create = within(dialog).getByRole('button', { name: 'Create' })
    expect(create.disabled).toBe(true)
    fireEvent.change(title, { target: { value: 'Lens rental' } })
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Estimated cost' }), { target: { value: '500' } })
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Actual cost' }), { target: { value: '650' } })
    // The variance they make: the one figure, signed, its news its tone.
    expect(dialog.querySelector('.rb-budget-exp-variance').textContent).toBe('+$150')
    expect(dialog.querySelector('.rb-budget-exp-variance .rb-budget-var').getAttribute('data-tone')).toBe('danger')
    await act(async () => { fireEvent.click(create) })
    expect(h.addExpense).toHaveBeenCalledWith({
      title: 'Lens rental', description: '', estimated_cost: 500, actual_cost: 650, purchase_date: '',
      asset_ids: [], phase_ids: [], task_ids: [], file_ids: [],
    })
    expect(screen.queryByRole('dialog')).toBeNull()

    // A row opens it to edit; Escape closes it now (Q17) and saves nothing.
    fireEvent.click(rowsOf(container)[1].querySelector('.rb-budget-exp-title'))
    const edit = screen.getByRole('dialog', { name: 'Edit expense' })
    expect(within(edit).getByRole('textbox', { name: 'Title' }).value).toBe('Set timber and paint')
    expect(within(edit).getByRole('button', { name: 'Save' })).toBeTruthy()
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(h.updateExpense).not.toHaveBeenCalled()
    expect(inlineColours(document.body)).toEqual([])
  })

  it('the toolbar is the kit Toolbar: the same controls in the same order at 28px; the undo keys and their titles as they were (C1, R3-15)', () => {
    const h = hook()
    const { container } = render(tab(h))
    const bar = container.querySelector('.ui-toolbar.rb-budget-exp-toolbar')
    expect(bar).not.toBeNull()
    const named = [...bar.querySelectorAll('button, select, input')].map((el) => el.getAttribute('aria-label') || el.textContent.trim())
    expect(named).toEqual(['New expense', 'Undo (Ctrl+Z)', 'Redo (Ctrl+Shift+Z)', 'Filter', 'Sort', 'Z→A', 'Group', 'Views', 'Reset M/C', 'Search expenses'])
    expect(screen.getByRole('button', { name: 'New expense' }).getAttribute('data-variant')).toBe('primary')
    for (const el of bar.querySelectorAll('button')) expect(el.getAttribute('data-size')).toBe('sm')
    for (const el of bar.querySelectorAll('select, input')) {
      expect(el.className).toContain('ui-input')
      expect(el.getAttribute('data-size')).toBe('sm')
    }
    expect(screen.getByRole('button', { name: 'Undo (Ctrl+Z)' }).disabled).toBe(true)
    // The keys still undo and redo; Q10 rules out a bar to show them.
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true })
    expect(h.undo).toHaveBeenCalledTimes(1)
    expect(h.redo).toHaveBeenCalledTimes(1)
    // Filter while filters apply: its count and the kit's active edge.
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
    const filter = screen.getByRole('button', { name: 'Filter (1)' })
    expect(filter.getAttribute('data-active')).toBe('true')
    expect(filter.getAttribute('aria-expanded')).toBe('true')
    const strip = container.querySelector('.rb-budget-filters')
    expect([...within(strip).getByRole('combobox', { name: 'Field' }).options].map((o) => o.textContent)).toContain('Cost status')
    expect(inlineColours(container)).toEqual([])
  })

  it('saved views: the menu restyled in place (the kit Menu has no trailing action), its Save on the kit Dialog', () => {
    const { container } = render(tab())
    fireEvent.click(screen.getByRole('button', { name: 'Views' }))
    const menu = container.querySelector('.rb-budget-menu')
    expect(menu.textContent).toContain('No saved views')
    fireEvent.click(within(menu).getByRole('button', { name: 'Save current view' }))
    expect(container.querySelector('.rb-budget-menu')).toBeNull()
    const dialog = screen.getByRole('dialog', { name: 'Save current view' })
    expect(dialog.closest('.ui-dialog-backdrop').parentElement).toBe(document.body)
    const name = within(dialog).getByRole('textbox', { name: 'View name' })
    fireEvent.change(name, { target: { value: 'Receipts' } })
    fireEvent.keyDown(name, { key: 'Enter' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Views' }))
    expect(within(container.querySelector('.rb-budget-menu')).getByRole('button', { name: 'Delete the saved view "Receipts"' })).toBeTruthy()
    // An outside press closes it, as it always did.
    fireEvent.mouseDown(document.body)
    expect(container.querySelector('.rb-budget-menu')).toBeNull()
  })

  it('grouped, a group\'s header is a full-width row of the same table, in sentence case', () => {
    const { container } = render(tab())
    fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value: 'cost_status' } })
    const tables = container.querySelectorAll('table')
    expect(tables).toHaveLength(1)
    const groups = [...tables[0].querySelectorAll('tbody tr.rb-budget-exp-group')]
    expect(groups.map((g) => g.querySelector('.rb-budget-exp-group-label').textContent)).toEqual(['Over budget', 'Under budget', 'On budget'])
    for (const g of groups) {
      const cells = g.querySelectorAll('td')
      expect(cells).toHaveLength(1)
      expect(cells[0].getAttribute('colspan')).toBe(String(tables[0].querySelectorAll('thead th').length))
    }
    expect(groups[0].querySelector('.rb-budget-exp-group-totals').textContent).toBe('Est: $260 / Act: $284')
  })

  it('"Loading expenses..." is the kit Loading, never the empty state; no expenses is the kit EmptyState, in sentence case (R3-19)', () => {
    const { container, rerender } = render(tab(hook({ loading: true })))
    expect(container.querySelector('.ui-loading-inline')?.getAttribute('aria-label')).toBe('Loading expenses...')
    expect(container.querySelector('.ui-empty')).toBeNull()
    rerender(tab(hook({ expenses: [] })))
    expect(container.querySelector('.ui-loading-inline')).toBeNull()
    expect(container.querySelector('.ui-empty .ui-empty-title').textContent).toBe('No expenses yet')
    expect(container.querySelector('.ui-empty .ui-empty-body').textContent).toBe('Click "New expense" to add one.')
    // The header stays over the empty list, as it did.
    expect(container.querySelector('table.rb-budget-exp thead')).not.toBeNull()
    // A search that matches nothing says so.
    rerender(tab(hook()))
    fireEvent.change(screen.getByRole('textbox', { name: 'Search expenses' }), { target: { value: 'zzz' } })
    expect(container.querySelector('.ui-empty .ui-empty-title').textContent).toBe('No matching expenses')
  })

  it('ExpensePopup renders on its own, portalled, for any caller', () => {
    render(<ExpensePopup expense={null} phases={[]} assets={[]} tasks={[]} projectId="p1" ctx={null} currency="EUR" onSave={() => {}} onClose={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: 'New expense' })
    expect(dialog.closest('.ui-dialog-backdrop').parentElement).toBe(document.body)
    expect(within(dialog).getByText('Estimated cost (EUR)')).toBeTruthy()
  })
  it('Escape inside an open relation picker keeps the popup and its draft; Escape anywhere else closes it (Q17)', () => {
    const onClose = vi.fn()
    const phases = [{ id: 'ph1', name: 'Pre-production' }]
    render(<ExpensePopup expense={null} phases={phases} assets={[]} tasks={[]} projectId="p1" ctx={null} currency="EUR" onSave={() => {}} onClose={onClose} />)
    const dialog = screen.getByRole('dialog', { name: 'New expense' })
    fireEvent.click(within(dialog).getByRole('button', { name: /Phases/ }))
    const option = within(dialog).getByRole('checkbox', { name: 'Pre-production' })
    option.focus()
    fireEvent.keyDown(option, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    const toggle = within(dialog).getByRole('button', { name: /Phases/ })
    toggle.focus()
    fireEvent.keyDown(toggle, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

/* ── surface 5: the client estimate (R3-27, R3-39, C9) ───────────────────── */
describe('the client estimate', () => {
  const { default: ClientViewTab, estimateDocument } = clientModule
  const TASKS = [
    { assigned_role_slug: 'editor', bid_days: 10 },
    { assigned_role_slug: 'dop', assigned_position: 'Camera', bid_days: 4 },
  ]
  const props = {
    project: { title: 'Salt <b>Hours</b>', project_code: 'SH-01', budget_margin_pct: 10, budget_contingency_pct: 5 },
    tasks: TASKS,
    roleRates: { editor: 500, dop: 1000 },
    budgetHook: { lines: [{ id: 't1', sheet: 'talent' }], lineComputations: { t1: { bidTotal: 2000 } } },
    expensesHook: { expenses: [{ estimated_cost: 750 }] },
    currency: 'USD',
  }
  // 5000 (editor) + 4000 (Camera) + 2000 (Talent) + 750 (Expenses) = 11750;
  // contingency 5% = 587.5, production fee 10% = 1175; total 13512.5.
  const LABELS = ['editor', 'Camera', 'Talent', 'Expenses / travel', 'Contingency', 'Production fee']

  function printed() {
    let html = ''
    const win = { document: { write: (s) => { html += s }, close: vi.fn() }, focus: vi.fn(), print: vi.fn(), close: vi.fn() }
    const open = vi.spyOn(window, 'open').mockReturnValue(win)
    const utils = render(<ClientViewTab {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Print / export' }))
    open.mockRestore()
    return { html, win, ...utils }
  }
  const styleOf = (html) => html.match(/<style>([\s\S]*?)<\/style>/)[1]

  it('the preview is the kit Table on the paper: numeric figures, the total in its <tfoot>, no inline colour (C9, R3-20)', () => {
    const { container } = render(<ClientViewTab {...props} />)
    const table = container.querySelector('table.ui-table')
    expect(table).toBeTruthy()
    expect([...table.querySelectorAll('tbody tr')].map((r) => r.cells[0].textContent)).toEqual(LABELS)
    for (const r of table.querySelectorAll('tbody tr')) expect(r.cells[1].getAttribute('data-numeric')).toBe('true')
    expect(table.querySelector('tfoot').textContent).toBe('Total$13,513')
    expect(container.querySelector('.rb-client-sheet')).toBeTruthy()
    for (const el of container.querySelectorAll('[style]')) expect(el.getAttribute('style')).not.toMatch(/color|background/)
  })
  it('says Client view, Estimated budget, Production fee and the signature lines in sentence case (Q2)', () => {
    const { container } = render(<ClientViewTab {...props} />)
    const text = container.textContent
    for (const s of ['Client view', 'Estimated budget', 'Project code', 'Production fee', 'Estimate approved by:', 'Approver signature:', 'Date signed:']) expect(text).toContain(s)
    expect(text).not.toMatch(/Client View|Estimated Budget|Production Fee|Approver Signature|Date Signed/)
  })
  it('prints in the app\'s face at the app\'s scale — never Courier, nothing under 11px (R3-27)', () => {
    const { html } = printed()
    const css = styleOf(html)
    expect(html).not.toMatch(/Courier/i)
    expect(css).toMatch(/body \{ font-family: Geist, /)
    const sizes = [...css.matchAll(/font-size: (\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]))
    expect(sizes.length).toBeGreaterThan(3)
    for (const s of sizes) expect([11, 12, 13, 14, 16, 20]).toContain(s)
    expect(css).toMatch(/h1 \{ font-size: 20px;/)
    expect(css).toMatch(/th \{[^}]*font-size: 11px;[^}]*text-transform: uppercase;/)
    expect(css).toMatch(/body \{[^}]*font-size: 13px;/)
  })
  // jsdom's CSSOM keeps only `font-family` of an @font-face rule, so the
  // reader is fed a document the way Chromium presents one; the Playwright
  // capture in the hand-off proves the real window loads both faces.
  it('appFontFaces carries the app\'s own @font-face rules for Geist — every descriptor, each url() absolute against its sheet — and no other face', () => {
    const face = (family, src, extra = '') => ({
      cssText: `@font-face { font-family: "${family}"; src: url("${src}") format("woff2-variations"); font-weight: 400 600;${extra} }`,
      style: { getPropertyValue: (p) => (p === 'font-family' ? `"${family}"` : '') },
    })
    const doc = {
      baseURI: 'http://localhost:5267/rabbit',
      styleSheets: [
        { href: null, cssRules: [face('Geist', '/fonts/geist-latin-wght.woff2', ' unicode-range: U+0-FF;'), { cssText: '.x { color: red }', style: { getPropertyValue: () => '' } }] },
        // A built stylesheet: a relative url resolves against the SHEET.
        { href: 'file:///C:/app/dist/assets/index-abc.css', cssRules: [{ cssRules: [face('Geist Mono', '../fonts/geist-mono-latin-wght.woff2')] }] },
        { href: 'https://cdn.example/x.css', get cssRules() { throw new Error('SecurityError') } },
        { href: null, cssRules: [face('Pixel', '/fonts/pixel.woff2')] },
      ],
    }
    const faces = clientModule.appFontFaces(doc).split('\n').map((s) => s.trim())
    expect(faces).toEqual([
      '@font-face { font-family: "Geist"; src: url(http://localhost:5267/fonts/geist-latin-wght.woff2) format("woff2-variations"); font-weight: 400 600; unicode-range: U+0-FF; }',
      '@font-face { font-family: "Geist Mono"; src: url(file:///C:/app/dist/fonts/geist-mono-latin-wght.woff2) format("woff2-variations"); font-weight: 400 600; }',
    ])
  })
  it('the print document carries those rules first in its sheet', () => {
    const faces = '@font-face { font-family: "Geist"; src: url(http://h/fonts/g.woff2); }'
    const html = estimateDocument({ title: 'T', code: 'C', date: 'd', rows: [], total: 0, currency: 'USD', faces })
    expect(styleOf(html).trim().startsWith(faces)).toBe(true)
  })
  it('prints what the preview shows: the same lines in the same order, the same figures', () => {
    const { html, container } = printed()
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const printedRows = [...doc.querySelectorAll('tbody tr')].map((r) => [r.cells[0].textContent, r.cells[1].textContent])
    const shown = [...container.querySelectorAll('table.ui-table tbody tr, table.ui-table tfoot tr')].map((r) => [r.cells[0].textContent, r.cells[1].textContent])
    expect(printedRows).toEqual(shown)
  })
  it('escapes the user\'s own words into the print document', () => {
    const { html } = printed()
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(doc.querySelector('h1').textContent).toBe('Salt <b>Hours</b>')
    expect(doc.querySelector('h1 b')).toBeNull()
  })
  it('prints once the page has laid out and its face has loaded, then closes', async () => {
    vi.useFakeTimers()
    try {
      const { win } = printed()
      expect(win.print).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(250)
      expect(win.print).toHaveBeenCalledTimes(1)
      expect(win.close).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })
  it('estimateDocument is pure: the same input, the same document', () => {
    const input = { title: 'T', code: 'C', date: '1/1/2026', rows: [{ label: 'a', amount: 1 }], total: 1, currency: 'USD', faces: '' }
    expect(estimateDocument(input)).toBe(estimateDocument(input))
  })
})
