/** @vitest-environment jsdom */
// =============================================================================
// Lane B5, mounted: the Budget's surfaces on the kit and rabbitBudget.css.
// rabbitBudgetCss.test.js reads source text; this renders each surface and
// asserts what a user would meet. One describe per surface, added in the
// commit that moves it.
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))
const rabbit = vi.hoisted(() => ({ current: { project: { budget_currency: 'EUR' } } }))

const { default: CurrencyDisplay, formatMoney, MONEY_LOCALE } = await import('../components/CurrencyDisplay')

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
