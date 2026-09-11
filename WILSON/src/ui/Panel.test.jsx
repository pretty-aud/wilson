/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Panel } from './Panel'

afterEach(cleanup)

describe('Panel', () => {
  it('renders an aside with a body, and no header when untitled', () => {
    const { container } = render(<Panel>tree</Panel>)
    const el = container.querySelector('aside.ui-panel')
    expect(el).not.toBeNull()
    expect(container.querySelector('.ui-panel-head')).toBeNull()
    expect(container.querySelector('.ui-panel-body').textContent).toBe('tree')
  })

  it('renders the Label-step header and its actions', () => {
    render(<Panel title="Folders" actions={<button type="button">New</button>}>x</Panel>)
    expect(screen.getByText('Folders').className).toBe('ui-panel-title')
    expect(screen.getByRole('button', { name: 'New' })).not.toBeNull()
  })

  it('takes one of the three width tokens, as data', () => {
    const { container, rerender } = render(<Panel>x</Panel>)
    expect(container.querySelector('.ui-panel').dataset.width).toBe('md')
    for (const w of ['sm', 'md', 'lg']) {
      rerender(<Panel width={w}>x</Panel>)
      expect(container.querySelector('.ui-panel').dataset.width).toBe(w)
    }
  })

  it('reports an off-scale width in dev rather than rendering it', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<Panel width="220px">x</Panel>)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('puts its hairline on the docked edge and writes no inline style', () => {
    const { container } = render(<Panel side="right" surface="light">x</Panel>)
    const el = container.querySelector('.ui-panel')
    expect(el.dataset.side).toBe('right')
    expect(el.dataset.surface).toBe('light')
    expect(el.getAttribute('style')).toBeNull()
  })
})
