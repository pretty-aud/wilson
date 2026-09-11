/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Table, Th, Td, Row } from './Table'

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
    expect(rows[1].getAttribute('aria-selected')).toBe('true')
    for (const r of rows) expect(r.getAttribute('style')).toBeNull()
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
})
