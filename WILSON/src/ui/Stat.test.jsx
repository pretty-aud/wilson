/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { Stat } from './Stat'

afterEach(cleanup)

describe('Stat', () => {
  it('renders the label above the value', () => {
    const { container } = render(<Stat label="Members" value={12} />)
    const kids = [...container.querySelector('.ui-stat').children]
    expect(kids.map((k) => k.className)).toEqual(['ui-stat-label', 'ui-stat-value'])
    expect(kids[0].textContent).toBe('Members')
    expect(kids[1].textContent).toBe('12')
  })

  it('omits the delta entirely when there is none', () => {
    const { container } = render(<Stat label="Members" value={0} />)
    expect(container.querySelector('.ui-stat-delta')).toBeNull()
  })

  it('renders a zero value rather than treating it as absent', () => {
    const { container } = render(<Stat label="Blocked" value={0} delta={0} />)
    expect(container.querySelector('.ui-stat-value').textContent).toBe('0')
    expect(container.querySelector('.ui-stat-delta').textContent).toBe('0')
  })

  it('takes the delta tone from a status token, so no colour is written inline', () => {
    const { container } = render(<Stat label="Tasks" value={9} delta="+3" deltaStatus="approved" />)
    const d = container.querySelector('.ui-stat-delta')
    expect(d.dataset.tone).toBe('success')
    expect(d.getAttribute('style')).toBeNull()
  })

  it('falls back to neutral for an unknown status rather than blanking', () => {
    const { container } = render(<Stat label="X" value={1} delta="?" deltaStatus="brand_new" />)
    expect(container.querySelector('.ui-stat-delta').dataset.tone).toBe('neutral')
  })

  it('carries the surface as data', () => {
    const { container } = render(<Stat label="X" value={1} surface="light" />)
    expect(container.querySelector('.ui-stat').dataset.surface).toBe('light')
  })
})
