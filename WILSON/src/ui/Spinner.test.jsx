/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Spinner } from './Spinner'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8')

afterEach(cleanup)

describe('Spinner', () => {
  it('is an announced status at the icon sizes, and accepts Bins\' numeric size', () => {
    render(<Spinner />)
    const s = screen.getByRole('status', { name: 'Loading' })
    expect(s.className).toContain('ui-spinner')
    expect(s.style.width).toBe('16px')
    cleanup()
    render(<Spinner size="lg" label="Scanning" />)
    expect(screen.getByRole('status', { name: 'Scanning' }).style.width).toBe('24px')
    cleanup()
    render(<Spinner size={12} />)
    expect(screen.getByRole('status').style.width).toBe('12px')
  })
})

// ── F3: the surface prop (D1 kit request 4) ─────────────────────────────────
describe('Spinner: surface', () => {
  it('is dark by default and takes a light surface', () => {
    const { container, rerender } = render(<Spinner />)
    expect(container.querySelector('.ui-spinner').dataset.surface).toBe('dark')
    rerender(<Spinner surface="light" />)
    expect(container.querySelector('.ui-spinner').dataset.surface).toBe('light')
  })

  it('both of its colours flip, because both fail on the light ground', () => {
    // The ring is a screen of the near-white ink (1.05:1 there) and the
    // moving quarter is the signal (1.73:1, under the 3:1 a non-text
    // indicator needs). An indicator nobody can see is not an indicator.
    const rule = css.match(/\.ui-spinner\[data-surface="light"\] \{[^}]*\}/)
    expect(rule, 'no light spinner rule in index.css').not.toBeNull()
    expect(rule[0]).toContain('border-color: var(--color-rule-light)')
    expect(rule[0]).toContain('border-top-color: var(--color-ink-light)')
  })
})
