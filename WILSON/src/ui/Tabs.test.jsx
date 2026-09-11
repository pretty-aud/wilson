/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Tabs } from './Tabs'

afterEach(cleanup)

const ITEMS = [
  { id: 'admin', label: 'Admin' },
  { id: 'manager', label: 'Manager' },
  { separator: true },
  { id: 'user', label: 'User', count: 4 },
  { id: 'off', label: 'Archived', disabled: true },
]

describe('Tabs', () => {
  it('renders a tablist of tabs with one selected', () => {
    render(<Tabs items={ITEMS} value="manager" label="Saved views" />)
    expect(screen.getByRole('tablist', { name: 'Saved views' })).not.toBeNull()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent.replace(/\d+$/, ''))).toEqual(['Admin', 'Manager', 'User', 'Archived'])
    expect(tabs.filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.textContent)).toEqual(['Manager'])
  })

  it('marks the active tab with a data attribute, never a fill (C6)', () => {
    const { container } = render(<Tabs items={ITEMS} value="admin" />)
    const active = container.querySelectorAll('.ui-tab[data-active]')
    expect(active).toHaveLength(1)
    expect(active[0].textContent).toBe('Admin')
    for (const t of container.querySelectorAll('.ui-tab')) expect(t.getAttribute('style')).toBeNull()
  })

  it('calls onChange with the id, and never for a disabled tab', () => {
    const onChange = vi.fn()
    render(<Tabs items={ITEMS} value="admin" onChange={onChange} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Manager' }))
    expect(onChange).toHaveBeenCalledWith('manager')
    fireEvent.click(screen.getByRole('tab', { name: 'Archived' }))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('renders the group hairline as a separator, not as a tab', () => {
    const { container } = render(<Tabs items={ITEMS} value="admin" />)
    expect(container.querySelectorAll('.ui-tabs-sep')).toHaveLength(1)
    expect(screen.getAllByRole('tab')).toHaveLength(4)
  })

  it('moves focus with the arrow keys, skipping the disabled tab', () => {
    render(<Tabs items={ITEMS} value="admin" />)
    const [admin, manager, user] = screen.getAllByRole('tab')
    admin.focus()
    fireEvent.keyDown(admin, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(manager)
    fireEvent.keyDown(manager, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(user)
    fireEvent.keyDown(user, { key: 'Home' })
    expect(document.activeElement).toBe(admin)
    // Wraps, and never lands on the disabled one.
    fireEvent.keyDown(admin, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(user)
  })

  it('leaves every tab in the tab order — arrows are additive, not roving (C1)', () => {
    render(<Tabs items={ITEMS} value="admin" />)
    for (const t of screen.getAllByRole('tab')) {
      expect(t.getAttribute('tabindex')).toBeNull()
    }
  })

  it('renders a count beside the label when given one', () => {
    const { container } = render(<Tabs items={ITEMS} value="user" />)
    expect(container.querySelector('.ui-tab-count').textContent).toBe('4')
  })
})
