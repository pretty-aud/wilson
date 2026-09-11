/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Chip } from './Chip'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8')

afterEach(cleanup)

describe('Chip', () => {
  it('renders a pressed filter with its count, state as data attributes', () => {
    render(<Chip active count={12}>Video</Chip>)
    const c = screen.getByRole('button', { name: /Video/ })
    expect(c.className).toContain('ui-chip')
    expect(c.dataset.active).toBe('true')
    expect(c.getAttribute('aria-pressed')).toBe('true')
    expect(c.querySelector('.ui-chip-count').textContent).toBe('12')
    expect(c.getAttribute('style')).toBeNull()
  })

  it('carries a data colour as a custom property, never the state', () => {
    render(<Chip active color="#e11d48">Rose</Chip>)
    const c = screen.getByRole('button', { name: 'Rose' })
    expect(c.style.getPropertyValue('--chip-color')).toBe('#e11d48')
    expect(c.style.backgroundColor).toBe('')
  })

  it('clicks', () => {
    const onClick = vi.fn()
    render(<Chip onClick={onClick}>All</Chip>)
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'All' }).dataset.active).toBe('false')
  })
})

// ── F3: the light surface (D1 kit request 4) ────────────────────────────────
describe('Chip on the light ground', () => {
  it('stamps the surface AND index.css resolves it: it used to measure 1.00 to 1', () => {
    render(<Chip surface="light">Shots</Chip>)
    expect(screen.getByRole('button', { name: 'Shots' }).dataset.surface).toBe('light')
    // The component stamped this from the first commit and no rule read it,
    // so a chip on a light page kept ink-2 (#b8b4b0) on #f4a261. Not "a grey":
    // one to one, invisible.
    const rule = css.match(/\.ui-chip\[data-surface="light"\] \{[^}]*\}/)
    expect(rule, 'no light chip rule in index.css').not.toBeNull()
    expect(rule[0]).toContain('color: var(--color-ink-light)')
  })

  it('the active treatment is form, not the signal, which is 1.73 to 1 there', () => {
    const rule = css.match(/\.ui-chip\[data-surface="light"\]\[data-active="true"\] \{[^}]*\}/)
    expect(rule, 'no light active chip rule').not.toBeNull()
    expect(rule[0]).toContain('var(--color-well-light)')
    expect(rule[0]).toContain('var(--color-ink-light)')
    expect(rule[0]).not.toContain('--color-signal-tint')
    // 🚨 And it does NOT honour `--chip-color` here. The ink is fixed at
    // `ink-light` because this ground has only one, so a caller's data colour
    // underneath it would be a fill the component cannot measure. The dark
    // rule keeps it; Bins is the only caller that passes one and Bins is dark.
    expect(rule[0]).not.toContain('--chip-color')
    expect(css).toMatch(/\.ui-chip\[data-active="true"\] \{[^}]*var\(--chip-color,/)
  })

  it('has no inert :disabled rule on light — there is no second ink to screen to', () => {
    // `.ui-chip[data-surface="light"]` is already `ink-light` and is written
    // after `.ui-chip:disabled` at equal specificity, so it already wins. A
    // `:disabled` rule setting `ink-light` again would change nothing.
    expect(css).not.toMatch(/\.ui-chip\[data-surface="light"\]:disabled \{/)
    // The control: the light rule really is the later of the two, which is
    // what makes a disabled light chip legible at all.
    expect(css.indexOf('.ui-chip[data-surface="light"] {'))
      .toBeGreaterThan(css.indexOf('.ui-chip:disabled'))
  })

  it('the count and the hover take the one ink too, not the dark-side pair', () => {
    expect(css).toMatch(/\.ui-chip\[data-surface="light"\]:hover:not\(:disabled\) \{[^}]*color: var\(--color-ink-light\)/)
    // The DECLARATION, not the selector: `.ui-chip-count` is `ink-3` on dark,
    // which is 1.68:1 here, and a test that only proves the selector was
    // typed would pass with the grey left in it.
    const count = css.match(/\.ui-chip\[data-surface="light"\] \.ui-chip-count,[\s\S]{0,120}?\{[^}]*\}/)
    expect(count, 'no light chip-count rule').not.toBeNull()
    expect(count[0]).toContain('color: var(--color-ink-light)')
    expect(count[0]).not.toContain('--color-ink-3')
  })
})
