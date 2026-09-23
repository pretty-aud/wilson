/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { useState } from 'react'
import { flushSync } from 'react-dom'
import { Drawer } from './Drawer'
import { Dialog } from './Dialog'

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

  it('stands down on an Escape a layer above has already handled', () => {
    const onClose = vi.fn()
    render(<Drawer open onClose={onClose} title="H">x</Drawer>)
    const handled = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    handled.preventDefault()
    window.dispatchEvent(handled)
    expect(onClose).not.toHaveBeenCalled()
    // The control: an Escape nobody handled still closes it.
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  /* 🚨 A2 review round 1, measured in the running app: ONE Escape closed
     both D.O.G.'s Help (a Dialog) and the Settings drawer it was opened
     from. The Dialog listens on `document`, the Drawer on `window`; in a
     real browser React commits the Dialog's close in a microtask that runs
     BETWEEN the two listeners, so by the time the Drawer asked "is a
     .ui-dialog open?" it was already gone. The test above this one could
     not see it: a scripted dispatch runs no microtask between listeners.
     `flushSync` in the Dialog's onClose reproduces the browser's order —
     the dialog leaves the DOM before the Drawer hears the key — and the fix
     is that the Dialog marks the key handled and the Drawer honours that. */
  it('🚨 one Escape closes the Dialog on top and not the Drawer under it, even once the Dialog has left the DOM', () => {
    const drawerClose = vi.fn()
    function Harness() {
      const [help, setHelp] = useState(true)
      return (
        <>
          <Drawer open onClose={drawerClose} title="Settings">x</Drawer>
          {help && <Dialog title="Help" onClose={() => flushSync(() => setHelp(false))}>body</Dialog>}
        </>
      )
    }
    render(<Harness />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.querySelector('.ui-dialog'), 'the Dialog did not close').toBeNull()
    expect(drawerClose, 'the same Escape closed the Drawer too').not.toHaveBeenCalled()
    // The next Escape is the Drawer's.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(drawerClose).toHaveBeenCalledTimes(1)
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
    // The control: no literal pixel offset in the drawer's OWN rule. Bounded
    // by that rule's closing brace, not by another component's block — a
    // slice that ends at `.ui-stat {` returns '' the moment the kit's CSS is
    // reordered, and an empty string satisfies every `not.toContain`.
    const from = css.indexOf('.ui-drawer {')
    const rule = css.slice(from, css.indexOf('}', from))
    expect(rule).toContain('top: var(--titlebar-offset);')
    expect(rule).not.toMatch(/top:\s*\d+px/)
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
