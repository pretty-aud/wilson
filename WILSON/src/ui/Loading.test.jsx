/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Loading } from './Loading'

afterEach(cleanup)

describe('Loading', () => {
  it('renders skeleton rows for a table, announced once', () => {
    render(<Loading rows={3} columns={5} />)
    const l = screen.getByRole('status', { name: 'Loading' })
    expect(l.className).toContain('ui-skeleton-rows')
    expect(l.querySelectorAll('.ui-skeleton-row').length).toBe(3)
    expect(l.querySelectorAll('.ui-skeleton').length).toBe(15)
    expect(l.querySelector('.ui-skeleton-row').getAttribute('aria-hidden')).toBe('true')
  })

  it('renders a spinner with a label elsewhere', () => {
    render(<Loading label="Fetching bins" />)
    const l = screen.getByRole('status', { name: 'Fetching bins' })
    expect(l.className).toContain('ui-loading-inline')
    expect(l.querySelector('.ui-spinner')).not.toBeNull()
    expect(l.textContent).toContain('Fetching bins')
  })
})
