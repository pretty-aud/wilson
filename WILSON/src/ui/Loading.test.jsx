/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Loading } from './Loading'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8')

afterEach(cleanup)

describe('Loading', () => {
  it('renders skeleton rows for a table, announced once', () => {
    render(<Loading rows={3} columns={5} />)
    const l = screen.getByRole('status', { name: 'Loading' })
    expect(l.className).toContain('ui-skeleton-rows')
    expect(l.querySelectorAll('.ui-skeleton-row').length).toBe(3)
    expect(l.querySelectorAll('.ui-skeleton').length).toBe(15)
    expect(l.querySelector('.ui-skeleton-row').getAttribute('aria-hidden')).toBe('true')
  })

  it('renders a spinner with a label elsewhere', () => {
    render(<Loading label="Fetching bins" />)
    const l = screen.getByRole('status', { name: 'Fetching bins' })
    expect(l.className).toContain('ui-loading-inline')
    expect(l.querySelector('.ui-spinner')).not.toBeNull()
    expect(l.textContent).toContain('Fetching bins')
  })
})

// ── F3: the light surface (D1 kit request 4) ────────────────────────────────
describe('Loading on the light ground', () => {
  it('the skeleton is an ink screen there, not the ink-on-dark one', () => {
    const { container } = render(<Loading rows={2} columns={2} surface="light" />)
    expect(container.querySelector('.ui-skeleton-rows').dataset.surface).toBe('light')
    // --color-skeleton over #f4a261 flattens to #f4a86c, a 1.05:1 lightening
    // of the ground: a placeholder you cannot see is not a placeholder.
    expect(css).toMatch(/\.ui-skeleton-rows\[data-surface="light"\] \.ui-skeleton \{[^}]*var\(--color-skeleton-light\)/)
  })

  it('the inline label and its spinner take the one ink too', () => {
    const { container } = render(<Loading surface="light" />)
    expect(container.querySelector('.ui-loading-inline').dataset.surface).toBe('light')
    expect(css).toMatch(/\.ui-loading-inline\[data-surface="light"\] \{[^}]*var\(--color-ink-light\)/)
    expect(css).toMatch(/\.ui-loading-inline\[data-surface="light"\] > \.ui-spinner \{[^}]*var\(--color-ink-light\)/)
  })
})
