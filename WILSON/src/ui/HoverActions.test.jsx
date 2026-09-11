/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { HoverActions } from './HoverActions'

afterEach(cleanup)

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../index.css'), 'utf8')

describe('HoverActions', () => {
  it('renders its controls in a reserved slot', () => {
    const { container } = render(
      <HoverActions><button type="button">Remove</button></HoverActions>,
    )
    const slot = container.querySelector('.ui-hover-actions')
    expect(slot).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Remove' })).not.toBeNull()
    expect(slot.getAttribute('style')).toBeNull()
  })

  it('keeps the controls in the DOM and in the tab order while hidden', () => {
    render(<HoverActions><button type="button">Remove</button></HoverActions>)
    const btn = screen.getByRole('button', { name: 'Remove' })
    // Hidden by opacity, not by `display: none` — so the slot reserves its
    // width and the row cannot reflow under the pointer.
    expect(btn.isConnected).toBe(true)
    btn.focus()
    expect(document.activeElement).toBe(btn)
  })

  it('opts out with `always`, for a row’s primary action', () => {
    const { container, rerender } = render(<HoverActions>x</HoverActions>)
    expect(container.querySelector('.ui-hover-actions').dataset.always).toBeUndefined()
    rerender(<HoverActions always>x</HoverActions>)
    expect(container.querySelector('.ui-hover-actions').dataset.always).toBe('true')
  })

  // 🚨 Q17(b), the whole reason it is not just `group-hover`. Six files hide
  // row controls on hover today and none reveal them on focus, so every one is
  // a keyboard dead end: focusable, focused, and invisible.
  it('reveals on focus-within as well as hover, and only fades opacity', () => {
    expect(css).toMatch(/\.ui-hover-actions \{[^}]*opacity: 0;/)
    expect(css).toContain(':where(tr, li, .ui-hover-host):hover .ui-hover-actions')
    expect(css).toContain(':where(tr, li, .ui-hover-host):focus-within .ui-hover-actions')
    expect(css).toContain('.ui-hover-actions:focus-within { opacity: 1; }')
    // The control: the slot must not be removed from the layout when hidden,
    // or the row reflows on hover — which is the bug it exists to avoid.
    const rule = css.slice(css.indexOf('.ui-hover-actions {'), css.indexOf('.ui-hover-actions[data-always]'))
    expect(rule).not.toContain('display: none')
    expect(rule).not.toContain('visibility: hidden')
  })
})
