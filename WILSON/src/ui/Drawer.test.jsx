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
import { allRules, decls, splitTop } from '../../scripts/ui-css-rules.mjs'

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

  it('xl (B3c-KR-1) is a width the sheet sizes, from its own token', () => {
    const { container } = render(<Drawer open width="xl" title="H">x</Drawer>)
    expect(container.querySelector('.ui-drawer').dataset.width).toBe('xl')
    expect(css).toMatch(/\.ui-drawer\[data-width="xl"\] \{ width: var\(--panel-xl\); \}/)
    expect(css).toMatch(/--panel-xl: 420px;/)
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

describe('Drawer head focus ring (A4-KR-10, P1-71)', () => {
  // The head's controls draw their ring inside themselves: a 28px button in
  // a 32px head with the app's 2px ring at a 1px offset reaches 3px past the
  // button, and the drawer opens flush with the window's top edge in a plain
  // browser, so the ring's top pixel was cut.
  const ruleFor = (sheet, selector) => {
    const at = sheet.indexOf(`\n  ${selector} {`)
    return at < 0 ? null : sheet.slice(at, sheet.indexOf('}', at))
  }
  // The offsets the kit declares for a control in a drawer head, by selector.
  const headOffsets = (sheet) => {
    const out = {}
    for (const r of allRules(sheet)) {
      const offset = decls(r.body).find(([p]) => p === 'outline-offset')?.[1]
      if (!offset) continue
      for (const sel of splitTop(r.sel)) if (/^\.ui-drawer-head\b/.test(sel)) out[sel] = offset
    }
    return out
  }
  it('is inset on the kit\'s buttons in every drawer head, and never as a bare :focus-visible', () => {
    expect(headOffsets(css)).toEqual({
      '.ui-drawer-head .ui-iconbtn:focus-visible': '-2px',
      '.ui-drawer-head .ui-btn:focus-visible': '-2px',
    })
    // A bare `:focus-visible` subject would read, to rabbitBudgetCss's
    // kitOffsetRules, as a kit offset on every element — the lane's inset
    // rings would then have to outweigh it (integration, P1).
    for (const sel of Object.keys(headOffsets(css))) expect(sel.split(/\s+/).pop()).not.toBe(':focus-visible')
  })
  it('every drawer head holds kit IconButtons only, which is what the rule names', () => {
    const callers = ['../tools/deck-outline-generator_v0.514/DeckOutlineGenerator.jsx', '../tools/otter_v0.3.1/Otter.jsx',
      '../tools/rabbit_v0.1.0/components/EditHistoryDrawer.jsx', '../tools/rabbit_v0.1.0/components/FileAuditDrawer.jsx',
      '../tools/rabbit_v0.1.0/views/TimelineView.jsx']
    // The `actions={…}` expression of the file's <Drawer>, braces balanced.
    const actionsOf = (src) => {
      const at = src.indexOf('actions=', src.indexOf('<Drawer'))
      const open = src.indexOf('{', at)
      if (at < 0 || open < 0) return null
      let depth = 0
      for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++
        else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1)
      }
      return null
    }
    // Every IconButton, with whatever icon it wraps, taken out; what is left
    // must hold no element at all.
    // Paired first, then self-closing; `[\s\S]*?` because props hold arrows.
    const withoutIconButtons = (expr) => expr
      .replace(/<IconButton\b(?:(?!\/>)[\s\S])*?<\/IconButton>/g, '')
      .replace(/<IconButton\b[\s\S]*?\/>/g, '')
    const tagsIn = (expr) => [...expr.matchAll(/<([A-Za-z][\w.]*)/g)].map((m) => m[1])
    for (const f of callers) {
      const actions = actionsOf(readFileSync(resolve(here, f), 'utf8'))
      expect(actions, f).not.toBeNull()
      expect(tagsIn(actions), f).toContain('IconButton')
      expect(tagsIn(withoutIconButtons(actions)), f).toEqual([])
    }
    // CONTROL: a head holding anything else is named.
    expect(tagsIn(withoutIconButtons(actionsOf('<Drawer title="x" actions={<><Select /><IconButton icon={X} /></>}>')))).toEqual(['Select'])
  })
  it('CONTROL: the geometry that cut it is still there, and a sheet without the rule, or with a bare subject, is caught', () => {
    expect(ruleFor(css, '.ui-drawer-head')).toMatch(/height:\s*var\(--panel-header\)/)
    expect(css).toMatch(/--panel-header:\s*32px/)
    expect(ruleFor(css, ':focus-visible')).toMatch(/outline:\s*2px solid[^;]*;\s*outline-offset:\s*1px/)
    const removed = css.replace(/\n {2}\.ui-drawer-head \.ui-iconbtn:focus-visible,\r?\n {2}\.ui-drawer-head \.ui-btn:focus-visible \{[^}]*\}/, '')
    expect(removed).not.toBe(css)
    expect(headOffsets(removed)).toEqual({})
    const bare = `${css}\n  .ui-drawer-head :focus-visible { outline-offset: -2px; }`
    expect(Object.keys(headOffsets(bare))).toContain('.ui-drawer-head :focus-visible')
  })
})
