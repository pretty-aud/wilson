/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { Drawer } from './Drawer'

afterEach(cleanup)

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../index.css'), 'utf8')

describe('Drawer', () => {
  it('renders nothing at all when closed', () => {
    const { container } = render(<Drawer open={false} title="History">x</Drawer>)
    expect(container.innerHTML).toBe('')
  })

  it('renders a labelled side panel with a header, body and optional footer', () => {
    const { container } = render(
      <Drawer open title="Edit history" footer={<button type="button">Close</button>}>rows</Drawer>,
    )
    expect(screen.getByRole('complementary', { name: 'Edit history' })).not.toBeNull()
    expect(container.querySelector('.ui-drawer-title').textContent).toBe('Edit history')
    expect(container.querySelector('.ui-drawer-body').textContent).toBe('rows')
    expect(container.querySelector('.ui-drawer-foot').textContent).toBe('Close')
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<Drawer open onClose={onClose} title="H">x</Drawer>)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('never steals Escape from an open Dialog above it', () => {
    const onClose = vi.fn()
    render(<Drawer open onClose={onClose} title="H">x</Drawer>)
    const dialog = document.createElement('div')
    dialog.className = 'ui-dialog'
    document.body.appendChild(dialog)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    dialog.remove()
  })

  it('has no backdrop unless asked — it is docked chrome, not a modal', () => {
    const { container, rerender } = render(<Drawer open title="H">x</Drawer>)
    expect(container.querySelector('.ui-drawer-backdrop')).toBeNull()
    rerender(<Drawer open backdrop title="H">x</Drawer>)
    expect(container.querySelector('.ui-drawer-backdrop')).not.toBeNull()
  })

  // 🚨 The reason this component exists. Three surfaces hand-compensate for
  // Electron's 32px title bar in three different ways and EditHistoryDrawer
  // does not, so it slides under the bar (TL-24).
  it('offsets from the title bar through ONE token, not a literal 32', () => {
    expect(css).toContain(':root { --titlebar-offset: 0px; }')
    expect(css).toContain('.electron-app { --titlebar-offset: var(--titlebar); }')
    expect(css).toMatch(/\.ui-drawer \{[^}]*top: var\(--titlebar-offset\);/)
    // The control: no literal pixel offset anywhere in the drawer's rules.
    const rules = css.slice(css.indexOf('.ui-drawer {'), css.indexOf('.ui-stat {'))
    expect(rules).not.toMatch(/top:\s*32px/)
  })

  it('writes no inline style: side, width and surface are all data', () => {
    const { container } = render(<Drawer open side="left" width="lg" surface="light" title="H">x</Drawer>)
    const el = container.querySelector('.ui-drawer')
    expect(el.dataset.side).toBe('left')
    expect(el.dataset.width).toBe('lg')
    expect(el.dataset.surface).toBe('light')
    expect(el.getAttribute('style')).toBeNull()
  })
})
