/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { X } from 'lucide-react'
import { IconButton } from './IconButton'

afterEach(cleanup)

describe('IconButton', () => {
  it('renders the glyph, names itself from the title, ghost md by default', () => {
    render(<IconButton icon={X} title="Close" />)
    const b = screen.getByRole('button', { name: 'Close' })
    expect(b.className).toContain('ui-iconbtn')
    expect(b.getAttribute('title')).toBe('Close')
    expect(b.dataset.size).toBe('md')
    expect(b.dataset.active).toBeUndefined()
    expect(b.querySelector('svg')).not.toBeNull()
    expect(b.querySelector('svg').getAttribute('aria-hidden')).toBe('true')
  })

  it('honours Bins\' Icon prop and numeric size, and marks active as pressed', () => {
    const onClick = vi.fn()
    render(<IconButton Icon={X} title="Pin" size={3.5} active onClick={onClick} />)
    const b = screen.getByRole('button', { name: 'Pin' })
    expect(b.dataset.size).toBe('sm')
    expect(b.dataset.active).toBe('true')
    expect(b.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(b)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('reports a missing title in dev — an unnamed icon button is a defect', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<IconButton icon={X} />)
    expect(err).toHaveBeenCalledWith(expect.stringContaining('`title` is required'))
    err.mockRestore()
  })

  it('an explicit aria-label wins over the title for the accessible name', () => {
    render(<IconButton icon={X} title="Remove file" aria-label="Remove report.pdf" />)
    expect(screen.getByRole('button', { name: 'Remove report.pdf' })).toBeTruthy()
  })
})
