/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SectionTitle } from './SectionTitle'

afterEach(cleanup)

describe('SectionTitle', () => {
  it('renders an h2 at the section step', () => {
    render(<SectionTitle>Roster</SectionTitle>)
    const h = screen.getByRole('heading', { level: 2 })
    expect(h.textContent).toBe('Roster')
    expect(h.className).toBe('ui-section-title')
  })

  it('takes the heading level from `as`, so it can nest without breaking the outline', () => {
    render(<SectionTitle as="h3">Nested</SectionTitle>)
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Nested')
  })

  it('renders the eyebrow and description only when given', () => {
    const { container, rerender } = render(<SectionTitle>Bare</SectionTitle>)
    expect(container.querySelector('.ui-section-eyebrow')).toBeNull()
    expect(container.querySelector('.ui-section-desc')).toBeNull()
    rerender(<SectionTitle eyebrow="Workspace" description="Who can open this workspace.">Roster</SectionTitle>)
    expect(container.querySelector('.ui-section-eyebrow').textContent).toBe('Workspace')
    expect(container.querySelector('.ui-section-desc').textContent).toBe('Who can open this workspace.')
  })

  it('carries the hairline by default and drops it on request — never a filled bar', () => {
    const { container, rerender } = render(<SectionTitle>A</SectionTitle>)
    expect(container.querySelector('.ui-section').dataset.rule).toBe('true')
    rerender(<SectionTitle rule={false}>A</SectionTitle>)
    expect(container.querySelector('.ui-section').dataset.rule).toBeUndefined()
  })

  it('does not transform the case — sentence case is the caller’s string (Q2)', () => {
    render(<SectionTitle>Rate card access</SectionTitle>)
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Rate card access')
  })
})
