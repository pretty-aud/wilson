/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Trash2 } from 'lucide-react'
import { Menu } from './Menu'
import { overlayOpen, _resetOverlaysForTests } from './overlay'

afterEach(cleanup)
beforeEach(() => _resetOverlaysForTests())

const items = (onRename, onDelete) => [
  { header: 'Bin' },
  { label: 'Rename', onClick: onRename, hint: 'F2' },
  { divider: true },
  { label: 'Delete', Icon: Trash2, onClick: onDelete, danger: true },
  { label: 'Locked', disabled: true },
  null,
]

describe('Menu', () => {
  it('renders header, divider, items, hints and danger; registers as an open overlay', () => {
    render(<Menu x={10} y={10} items={items(() => {}, () => {})} onClose={() => {}} />)
    const menu = screen.getByRole('menu')
    expect(menu.className).toContain('ui-menu')
    expect(overlayOpen()).toBe(true)
    expect(screen.getByText('Bin').className).toContain('ui-menu-header')
    expect(menu.querySelector('.ui-menu-divider')).not.toBeNull()
    expect(screen.getByText('F2').className).toContain('ui-menu-hint')
    const del = screen.getByRole('menuitem', { name: 'Delete' })
    expect(del.dataset.danger).toBe('true')
    expect(del.querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Locked' }).disabled).toBe(true)
  })

  it('an item runs its action and closes; Escape and an outside click close', () => {
    const onRename = vi.fn()
    const onClose = vi.fn()
    render(<Menu x={10} y={10} items={items(onRename, () => {})} onClose={onClose} />)
    fireEvent.click(screen.getByRole('menuitem', { name: /Rename/ }))
    expect(onRename).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('unregisters on unmount and clamps to the viewport', () => {
    const { unmount } = render(<Menu x={5000} y={10} items={[{ label: 'A' }]} onClose={() => {}} minWidth={200} />)
    const menu = screen.getByRole('menu')
    expect(parseInt(menu.style.left, 10)).toBeLessThanOrEqual(window.innerWidth - 200 - 12)
    unmount()
    expect(overlayOpen()).toBe(false)
  })
})
