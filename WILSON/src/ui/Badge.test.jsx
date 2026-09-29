/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Star } from 'lucide-react'
import { Badge } from './Badge'

afterEach(cleanup)

describe('Badge', () => {
  it('renders an inert label, dark by default, light on request', () => {
    render(<Badge>Draft</Badge>)
    const b = screen.getByText('Draft')
    expect(b.className).toContain('ui-badge')
    expect(b.dataset.surface).toBe('dark')
    expect(b.tagName).toBe('SPAN')
    render(<Badge surface="light" Icon={Star} title="Starred">Primary</Badge>)
    const l = screen.getByText('Primary')
    expect(l.dataset.surface).toBe('light')
    expect(l.querySelector('svg')).not.toBeNull()
    expect(l.getAttribute('title')).toBe('Starred')
  })
})
