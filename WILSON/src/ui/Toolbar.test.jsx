/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Toolbar } from './Toolbar'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8')

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

// ── F3: the one-baseline rule has to reach Tabs too (C1 kit request 1) ──────
describe('Toolbar: every child is 28px, including a tab bar', () => {
  it('holds .ui-tab to the small control height', () => {
    // `.ui-tab` is --control-md (36px) on its own, so a tab bar inside a
    // toolbar stood 8px proud and took the 44px row to 53px. It does not show
    // in tester mode, which is why F2 did not see it; Team Members hits it
    // the moment an admin has more than one saved view.
    const rule = css.match(/\.ui-toolbar \.ui-btn[\s\S]*?\{[^}]*\}/)
    expect(rule, 'no toolbar baseline rule in index.css').not.toBeNull()
    expect(rule[0]).toContain('.ui-toolbar .ui-tab')
    expect(rule[0]).toContain('height: var(--control-sm)')
  })

  it('the selector is specific enough to beat .ui-tab own height', () => {
    // `.ui-tab { height: var(--control-md) }` is (0,1,0); `.ui-toolbar .ui-tab`
    // is (0,2,0), so it wins on specificity rather than on source order.
    // 🚨 Read the `.ui-tab` BLOCK, not a lazy span from its selector: the
    // first cut used `[\s\S]*?` and would have matched `height:
    // var(--control-md)` in any later rule.
    const tab = css.match(/\n  \.ui-tab \{([^}]*)\}/)
    expect(tab, 'no .ui-tab block in index.css').not.toBeNull()
    expect(tab[1]).toContain('height: var(--control-md)')
    const units = (sel) => (sel.match(/\.[\w-]+|\[[^\]]+\]|:[a-z-]+(?!\()/g) || []).length
    expect(units('.ui-toolbar .ui-tab')).toBeGreaterThan(units('.ui-tab'))
  })
})
