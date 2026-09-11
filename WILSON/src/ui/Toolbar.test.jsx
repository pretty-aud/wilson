/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Toolbar } from './Toolbar'

afterEach(cleanup)

describe('Toolbar', () => {
  it('is a toolbar with a left slot and, when given one, a right slot', () => {
    const { container } = render(
      <Toolbar right={<button type="button">Export</button>}>
        <button type="button">Invite</button>
      </Toolbar>,
    )
    expect(screen.getByRole('toolbar')).not.toBeNull()
    const slots = container.querySelectorAll('.ui-toolbar-slot')
    expect(slots).toHaveLength(2)
    expect(slots[0].textContent).toBe('Invite')
    expect(slots[1].className).toContain('ui-toolbar-right')
  })

  it('omits the right slot entirely when empty, so it cannot take up space', () => {
    const { container } = render(<Toolbar><span>only</span></Toolbar>)
    expect(container.querySelectorAll('.ui-toolbar-slot')).toHaveLength(1)
    expect(container.querySelector('.ui-toolbar-right')).toBeNull()
  })

  it('does not wrap unless asked — a wrapping toolbar hides that it is over-full', () => {
    const { container, rerender } = render(<Toolbar>x</Toolbar>)
    expect(container.querySelector('.ui-toolbar').dataset.wrap).toBeUndefined()
    rerender(<Toolbar wrap>x</Toolbar>)
    expect(container.querySelector('.ui-toolbar').dataset.wrap).toBe('true')
  })

  it('writes no inline style — its height and gutter are the stylesheet’s', () => {
    const { container } = render(<Toolbar surface="light">x</Toolbar>)
    const el = container.querySelector('.ui-toolbar')
    expect(el.getAttribute('style')).toBeNull()
    expect(el.dataset.surface).toBe('light')
  })
})
