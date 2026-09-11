/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Button, BUTTON_VARIANTS, BUTTON_SIZES } from './Button'

afterEach(cleanup)

describe('Button', () => {
  it('renders a secondary md button by default with state as data attributes', () => {
    render(<Button>Save</Button>)
    const b = screen.getByRole('button', { name: 'Save' })
    expect(b.className).toContain('ui-btn')
    expect(b.dataset.variant).toBe('secondary')
    expect(b.dataset.size).toBe('md')
    expect(b.dataset.surface).toBe('dark')
    expect(b.getAttribute('type')).toBe('button')
    expect(b.getAttribute('style')).toBeNull()
  })

  it('takes every variant and size', () => {
    for (const variant of BUTTON_VARIANTS) {
      for (const size of BUTTON_SIZES) {
        const { unmount } = render(<Button variant={variant} size={size}>{variant}</Button>)
        const b = screen.getByRole('button', { name: variant })
        expect(b.dataset.variant).toBe(variant)
        expect(b.dataset.size).toBe(size)
        unmount()
      }
    }
  })

  it('honours Bins\' boolean props and never leaks them to the DOM', () => {
    render(<Button primary small>Add</Button>)
    const b = screen.getByRole('button', { name: 'Add' })
    expect(b.dataset.variant).toBe('primary')
    expect(b.dataset.size).toBe('sm')
    expect(b.hasAttribute('primary')).toBe(false)
    expect(b.hasAttribute('small')).toBe(false)
    render(<Button danger>Delete</Button>)
    expect(screen.getByRole('button', { name: 'Delete' }).dataset.variant).toBe('danger')
  })

  it('clicks, and does not click when disabled', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Go</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    render(<Button onClick={onClick} disabled>Stop</Button>)
    const d = screen.getByRole('button', { name: 'Stop' })
    expect(d.disabled).toBe(true)
    fireEvent.click(d)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('reports an unknown variant in dev rather than rendering it silently', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<Button variant="tertiary">?</Button>)
    expect(err).toHaveBeenCalledWith(expect.stringContaining('unknown variant'))
    err.mockRestore()
  })
})
