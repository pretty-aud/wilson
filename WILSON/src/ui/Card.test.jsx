/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Card } from './Card'

afterEach(cleanup)

describe('Card', () => {
  it('renders its children in a section, with no header when untitled', () => {
    const { container } = render(<Card><p>body</p></Card>)
    expect(container.querySelector('section.ui-card')).not.toBeNull()
    expect(container.querySelector('.ui-card-head')).toBeNull()
    expect(container.textContent).toBe('body')
  })

  it('renders the title at the H3 step, with an actions slot beside it', () => {
    render(<Card title="Storage" actions={<button type="button">Edit</button>}>x</Card>)
    const h = screen.getByRole('heading', { level: 3 })
    expect(h.textContent).toBe('Storage')
    expect(h.className).toBe('ui-card-title')
    expect(screen.getByRole('button', { name: 'Edit' })).not.toBeNull()
  })

  it('pads by default and stops padding for a card that holds a table', () => {
    const { container, rerender } = render(<Card>x</Card>)
    expect(container.querySelector('.ui-card').dataset.pad).toBe('true')
    rerender(<Card pad={false}>x</Card>)
    expect(container.querySelector('.ui-card').dataset.pad).toBeUndefined()
  })

  it('takes its surface as data, never as an inline background (C9: no white card)', () => {
    const { container } = render(<Card surface="light">x</Card>)
    const el = container.querySelector('.ui-card')
    expect(el.dataset.surface).toBe('light')
    expect(el.getAttribute('style')).toBeNull()
  })
})
