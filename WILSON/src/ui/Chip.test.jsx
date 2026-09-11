/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Chip } from './Chip'

afterEach(cleanup)

describe('Chip', () => {
  it('renders a pressed filter with its count, state as data attributes', () => {
    render(<Chip active count={12}>Video</Chip>)
    const c = screen.getByRole('button', { name: /Video/ })
    expect(c.className).toContain('ui-chip')
    expect(c.dataset.active).toBe('true')
    expect(c.getAttribute('aria-pressed')).toBe('true')
    expect(c.querySelector('.ui-chip-count').textContent).toBe('12')
    expect(c.getAttribute('style')).toBeNull()
  })

  it('carries a data colour as a custom property, never the state', () => {
    render(<Chip active color="#e11d48">Rose</Chip>)
    const c = screen.getByRole('button', { name: 'Rose' })
    expect(c.style.getPropertyValue('--chip-color')).toBe('#e11d48')
    expect(c.style.backgroundColor).toBe('')
  })

  it('clicks', () => {
    const onClick = vi.fn()
    render(<Chip onClick={onClick}>All</Chip>)
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'All' }).dataset.active).toBe('false')
  })
})
