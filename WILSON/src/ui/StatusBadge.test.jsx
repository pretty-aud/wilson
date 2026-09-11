/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { StatusBadge } from './StatusBadge'

afterEach(cleanup)

describe('StatusBadge', () => {
  it('renders the word next to a dot, tone on both, from one source', () => {
    render(<StatusBadge status="approved" />)
    const b = screen.getByText('Approved').closest('.ui-status')
    expect(b.dataset.tone).toBe('success')
    expect(b.dataset.status).toBe('approved')
    const dot = b.querySelector('.ui-status-dot')
    expect(dot.dataset.tone).toBe('success')
    expect(dot.getAttribute('aria-hidden')).toBe('true')
    expect(b.getAttribute('style')).toBeNull()
  })

  it('lets a caller override the word without changing the tone', () => {
    render(<StatusBadge status="in_progress">3 running</StatusBadge>)
    const b = screen.getByText('3 running').closest('.ui-status')
    expect(b.dataset.tone).toBe('signal')
  })

  it('on a light surface the tone is carried by the word alone', () => {
    render(<StatusBadge status="blocked" surface="light" />)
    const b = screen.getByText('Blocked').closest('.ui-status')
    expect(b.dataset.surface).toBe('light')
    expect(b.querySelector('.ui-status-dot').dataset.surface).toBe('light')
  })

  it('composes StatusDot rather than repeating its markup, and hides it from AT', () => {
    const { container } = render(<StatusBadge status="blocked" />)
    const dot = container.querySelector('.ui-status-dot')
    expect(dot).not.toBeNull()
    expect(dot.dataset.tone).toBe('danger')
    // The badge already says the word, so the dot must not be announced twice.
    expect(dot.getAttribute('aria-hidden')).toBe('true')
    expect(dot.getAttribute('role')).toBeNull()
    expect(dot.getAttribute('aria-label')).toBeNull()
    // Exactly one dot: the old markup drew its own alongside.
    expect(container.querySelectorAll('.ui-status-dot')).toHaveLength(1)
  })
})
