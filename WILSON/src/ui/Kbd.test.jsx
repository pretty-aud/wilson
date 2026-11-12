/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Kbd } from './Kbd'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8')

afterEach(cleanup)

describe('Kbd', () => {
  it('renders a real <kbd> with the kit class and passes a title through', () => {
    render(<Kbd title="Play or pause">Space</Kbd>)
    const k = screen.getByText('Space')
    expect(k.tagName).toBe('KBD')
    expect(k.className).toContain('ui-kbd')
    expect(k.getAttribute('title')).toBe('Play or pause')
    expect(k.getAttribute('style')).toBeNull()
  })
})

// ── F3: the surface prop (D1 kit request 4) ─────────────────────────────────
describe('Kbd: surface', () => {
  it('is dark by default and takes a light surface', () => {
    const { container, rerender } = render(<Kbd>Esc</Kbd>)
    expect(container.querySelector('kbd').dataset.surface).toBe('dark')
    rerender(<Kbd surface="light">Esc</Kbd>)
    expect(container.querySelector('kbd').dataset.surface).toBe('light')
  })

  it('the light cap is the inert well, not paper-recessed floating on orange', () => {
    // Help is a light page and Help is where the keys are written down.
    const rule = css.match(/\.ui-kbd\[data-surface="light"\] \{[^}]*\}/)
    expect(rule, 'no light kbd rule in index.css').not.toBeNull()
    expect(rule[0]).toContain('background-color: var(--color-well-light)')
    expect(rule[0]).toContain('color: var(--color-ink-light)')
  })
})
