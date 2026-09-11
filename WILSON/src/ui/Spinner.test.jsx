/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Spinner } from './Spinner'

afterEach(cleanup)

describe('Spinner', () => {
  it('is an announced status at the icon sizes, and accepts Bins\' numeric size', () => {
    render(<Spinner />)
    const s = screen.getByRole('status', { name: 'Loading' })
    expect(s.className).toContain('ui-spinner')
    expect(s.style.width).toBe('16px')
    cleanup()
    render(<Spinner size="lg" label="Scanning" />)
    expect(screen.getByRole('status', { name: 'Scanning' }).style.width).toBe('24px')
    cleanup()
    render(<Spinner size={12} />)
    expect(screen.getByRole('status').style.width).toBe('12px')
  })
})
