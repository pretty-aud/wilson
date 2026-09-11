/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Toolbar } from './Toolbar'

afterEach(cleanup)

describe('Toolbar', () => {
  it('has a left slot and, when given one, a right slot', () => {
    const { container } = render(
      <Toolbar right={<button type="button">Export</button>}>
        <button type="button">Invite</button>
      </Toolbar>,
    )
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

  // 🚨 F1 trap 10: a role promises a keyboard model. `toolbar` means
  // arrow-key navigation with a roving tabindex, and there is none — and it
  // may not own the `tablist` the worked example puts inside it.
  it('claims no ARIA role it does not implement', () => {
    const { container } = render(<Toolbar><button type="button">x</button></Toolbar>)
    expect(container.querySelector('.ui-toolbar').getAttribute('role')).toBeNull()
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('writes no inline style — its height and gutter are the stylesheet’s', () => {
    const { container } = render(<Toolbar surface="light">x</Toolbar>)
    const el = container.querySelector('.ui-toolbar')
    expect(el.getAttribute('style')).toBeNull()
    expect(el.dataset.surface).toBe('light')
  })
})
