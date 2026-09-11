/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { Table, Th, Td, Row } from './Table'

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8')

afterEach(cleanup)

const basic = (props = {}) => render(
  <Table head={<Row><Th width="40%">Member</Th><Th numeric>Day rate</Th></Row>} {...props}>
    <Row><Td>Ada</Td><Td numeric>1200</Td></Row>
    <Row selected><Td>Grace</Td><Td numeric>1400</Td></Row>
  </Table>,
)

describe('Table', () => {
  // The DOM decision, asserted rather than described: the review left it open
  // and four separate findings are the same flex-header-drift bug.
  it('is a REAL table with table-layout: fixed, not a flex grid', () => {
    const { container } = basic()
    const t = container.querySelector('table')
    expect(t).not.toBeNull()
    expect(t.className).toContain('ui-table')
    expect(t.querySelector('thead')).not.toBeNull()
    expect(t.querySelector('tbody')).not.toBeNull()
    // Header cells are real <th scope="col">, so the alignment is the
    // browser's job and cannot drift from the body.
    const th = screen.getAllByRole('columnheader')
    expect(th).toHaveLength(2)
    expect(th[0].getAttribute('scope')).toBe('col')
    expect(screen.getAllByRole('row')).toHaveLength(3)
  })

  it('declares column widths on the header row (fixed layout reads the first row)', () => {
    const { container } = basic()
    expect(container.querySelector('.ui-th').style.width).toBe('40%')
  })

  it('marks numeric cells so they right-align with tabular figures', () => {
    const { container } = basic()
    const nums = [...container.querySelectorAll('.ui-td[data-numeric]')]
    expect(nums).toHaveLength(2)
    for (const n of nums) expect(n.dataset.align).toBe('right')
    // …and the header above them agrees, which is the alignment bug.
    expect(container.querySelectorAll('.ui-th[data-numeric]')[0].dataset.align).toBe('right')
  })

  it('renders the sort slot on every header, sorted or not, so the label never shifts', () => {
    const { container } = render(
      <Table head={<Row><Th sort="asc">A</Th><Th>B</Th></Row>}><Row><Td>1</Td><Td>2</Td></Row></Table>,
    )
    expect(container.querySelectorAll('.ui-th-sort')).toHaveLength(2)
    const [a, b] = container.querySelectorAll('.ui-th-sort')
    expect(a.dataset.dir).toBe('asc')
    expect(b.dataset.dir).toBeUndefined()
    expect(container.querySelectorAll('.ui-th')[0].getAttribute('aria-sort')).toBe('ascending')
  })

  it('makes a sortable header a real button and calls onSort', () => {
    const onSort = vi.fn()
    render(<Table head={<Row><Th onSort={onSort}>Name</Th></Row>}><Row><Td>x</Td></Row></Table>)
    fireEvent.click(screen.getByRole('button', { name: 'Name' }))
    expect(onSort).toHaveBeenCalledTimes(1)
  })

  it('carries selection as a data attribute, not an inline style', () => {
    const { container } = basic()
    const rows = container.querySelectorAll('tbody .ui-tr')
    expect(rows[0].dataset.selected).toBeUndefined()
    expect(rows[1].dataset.selected).toBe('true')
    for (const r of rows) expect(r.getAttribute('style')).toBeNull()
  })

  // `aria-selected` is not supported on `row` inside `role="table"` — only in
  // a grid or a treegrid — and this renders a plain <table>. Announcing a
  // selection the table cannot own is worse than announcing none.
  it('never writes aria-selected on a row', () => {
    const { container } = basic()
    for (const r of container.querySelectorAll('.ui-tr')) {
      expect(r.getAttribute('aria-selected')).toBeNull()
    }
  })

  // A standing role (a producer) is not a selection the user made, so it must
  // not take the selection treatment. Two states, two attributes.
  it('distinguishes a highlighted row from a selected one', () => {
    const { container } = render(
      <Table><Row highlighted><Td>Producer</Td></Row><Row selected><Td>Picked</Td></Row></Table>,
    )
    const [hi, sel] = container.querySelectorAll('.ui-tr')
    expect(hi.dataset.highlighted).toBe('true')
    expect(hi.dataset.selected).toBeUndefined()
    expect(sel.dataset.selected).toBe('true')
    expect(sel.dataset.highlighted).toBeUndefined()
  })

  // 🚨 The selected fill has to out-specify the hover fill, or a table that
  // is both selectable and clickable loses its selection under the pointer.
  // ON BOTH SURFACES: the light hover rule is scoped through the table and so
  // is (0,6,0), which a (0,4,0) selected rule loses to — and the three light
  // data pages (Files, Projects, Rate Card) are exactly the tables this
  // component is scheduled for.
  it('keeps the selected fill on hover, on both surfaces', () => {
    const at = (sel) => {
      const i = css.indexOf(sel)
      expect(i, `missing rule: ${sel}`).toBeGreaterThan(-1)
      return i
    }
    // dark: equal specificity (0,4,0), declared later
    expect(at('.ui-tr[data-selected][data-selected] > .ui-td'))
      .toBeGreaterThan(at('.ui-tr[data-interactive]:hover > .ui-td'))
    // light: equal specificity (0,6,0), declared later
    expect(at('.ui-table[data-surface="light"] .ui-tr[data-selected][data-selected] > .ui-td'))
      .toBeGreaterThan(at('.ui-table[data-surface="light"] .ui-tr[data-interactive]:hover > .ui-td'))
  })

  // 🚨 `highlighted` must not be the hover token. It was, on both surfaces —
  // so a standing role rendered identically to "the row your mouse is on",
  // and hover on a highlighted row was invisible. It is an edge now, and the
  // selection edge is declared after it so a row that is both reads selected.
  it('draws a highlighted row as an edge, never as the hover fill', () => {
    const hi = css.indexOf('.ui-tr[data-highlighted] > .ui-td:first-child')
    const sel = css.indexOf('.ui-tr[data-selected] > .ui-td:first-child')
    expect(hi).toBeGreaterThan(-1)
    expect(sel).toBeGreaterThan(hi)
    // The control: no background-color rule for the highlight at all, on
    // either surface — that is what made it collide with hover.
    expect(css).not.toMatch(/\.ui-tr\[data-highlighted\][^{]*\{[^}]*background-color/)
  })

  it('takes `dense` from the view and the light surface from the page', () => {
    const { container } = basic({ dense: true, surface: 'light' })
    const t = container.querySelector('table')
    expect(t.dataset.dense).toBe('true')
    expect(t.dataset.surface).toBe('light')
    // The scroll container takes the matching scrollbar class.
    expect(container.querySelector('.ui-table-scroll').className).toContain('wilson-light-scroll')
  })

  it('marks a deactivated row without using opacity (plan §3.1)', () => {
    const { container } = render(
      <Table><Row inactive><Td>Gone</Td></Row></Table>,
    )
    const row = container.querySelector('.ui-tr')
    expect(row.dataset.inactive).toBe('true')
    expect(row.getAttribute('style')).toBeNull()
  })

  it('omits the thead entirely when there is no head row', () => {
    const { container } = render(<Table><Row><Td>only</Td></Row></Table>)
    expect(container.querySelector('thead')).toBeNull()
  })

  // ── The footer slot (F3, C1 kit request 3) ────────────────────────────────
  it('renders `foot` into a real <tfoot>, after the tbody, and omits it when absent', () => {
    const { container } = basic({
      foot: <Row className="rc-total-row"><Td colSpan={1}>Average</Td><Td numeric>1300</Td></Row>,
    })
    const t = container.querySelector('table')
    const foot = t.querySelector('tfoot')
    expect(foot).not.toBeNull()
    // A summary OF the rows, not another row: the element is what says so,
    // and it is the only thing a screen reader can use to say it.
    expect(foot.querySelector('.ui-tr')).not.toBeNull()
    expect(screen.getByText('Average').closest('tfoot')).toBe(foot)
    expect(screen.getByText('Average').closest('tbody')).toBeNull()
    // Document order: thead, tbody, tfoot.
    expect([...t.children].map((el) => el.tagName)).toEqual(['THEAD', 'TBODY', 'TFOOT'])
    cleanup()
    expect(basic().container.querySelector('tfoot')).toBeNull()
  })

  it('the tfoot is opaque, the mirror of the sticky head', () => {
    // R06's bug in the other direction: a transparent sticky band lets the
    // rows scroll through it and read as garbage.
    const rule = css.match(/\.ui-table tfoot > \.ui-tr > \.ui-td \{[^}]*\}/)
    expect(rule, 'no tfoot rule in index.css').not.toBeNull()
    expect(rule[0]).toContain('background-color: var(--color-paper-raised)')
    expect(rule[0]).toContain('border-top: 1px solid var(--color-rule)')
    // The light surface gets its own opaque fill, not the dark one.
    const light = css.match(/\.ui-table\[data-surface="light"\] tfoot > \.ui-tr > \.ui-td \{[^}]*\}/)
    expect(light, 'no light tfoot rule').not.toBeNull()
    expect(light[0]).toContain('var(--color-surface-light-solid)')
  })

  it('🚨 only a ONE-row footer sticks: two pinned rows would cover each other', () => {
    // `position: sticky; bottom: 0` pins each cell independently. The rate
    // card summarises per currency, so a card holding USD and GBP has two
    // footer rows — and both would pin to the same line, showing one average
    // and hiding the other. CSS cannot offset a row by the heights of the
    // rows below it, so one row sticks and a multi-row footer scrolls.
    const sticky = css.match(/\.ui-table tfoot > \.ui-tr:only-child > \.ui-td \{[^}]*\}/)
    expect(sticky, 'no :only-child sticky rule').not.toBeNull()
    expect(sticky[0]).toContain('position: sticky')
    expect(sticky[0]).toContain('bottom: 0')
    // The control: the unqualified rule must NOT stick, or the guard is a
    // second rule that changes nothing.
    const base = css.match(/\.ui-table tfoot > \.ui-tr > \.ui-td \{[^}]*\}/)[0]
    expect(base).not.toContain('position: sticky')
    // 🚨 The DECLARATION, not the substring: this block legitimately carries
    // `border-bottom: 0`, and the first cut of this assertion matched that
    // and failed for a reason that had nothing to do with stickiness.
    expect(base).not.toMatch(/(^|[;{])\s*bottom:\s*0/m)
    expect(base).toMatch(/border-bottom:\s*0/)
    // …and `bottom` is on the CELLS, because a <tr> is not a positioning box.
    expect(css).not.toMatch(/\.ui-table tfoot > \.ui-tr[^>{]*\{[^}]*position: sticky/)

    // Two footer rows render as two rows, in order.
    const { container } = basic({
      foot: (
        <>
          <Row><Td colSpan={1}>Average USD</Td><Td numeric>1300</Td></Row>
          <Row><Td colSpan={1}>Average GBP</Td><Td numeric>1100</Td></Row>
        </>
      ),
    })
    const rows = container.querySelectorAll('tfoot tr')
    expect(rows.length).toBe(2)
    expect(rows[0].textContent).toContain('USD')
    expect(rows[1].textContent).toContain('GBP')
  })
})
