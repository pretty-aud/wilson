/** @vitest-environment jsdom */
// =============================================================================
// Lane B5, mounted: the Budget's surfaces on the kit and rabbitBudget.css.
// rabbitBudgetCss.test.js reads source text; this renders each surface and
// asserts what a user would meet. One describe per surface, added in the
// commit that moves it.
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, within } from '@testing-library/react'
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
const { SummaryTab, BreakdownTable, CustomTab, ByPhaseTab, CenterMsg } = await import('./BudgetView')

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
