/** @vitest-environment jsdom */
// P1-77 (V1-05): the Electron title bar's three window controls are
// icon-only; each is named, with the tooltip that says it (plan §3.3), and
// its glyph is hidden from assistive tech. The walk's `anon` column is the
// in-app guard (shell-quit read anon=3 until P1); this is the unit one.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import TitleBar from './TitleBar'

// The bar draws only under Electron (it reads `window.electronAPI`).
beforeEach(() => { window.electronAPI = { minimize() {}, maximize() {}, close() {} } })
afterEach(() => { cleanup(); delete window.electronAPI })

const unnamed = (container) => [...container.querySelectorAll('button')]
  .filter((b) => !(b.getAttribute('aria-label') || b.textContent.trim()))

describe('TitleBar window controls (P1-77)', () => {
  it('names all three, with a matching tooltip, and hides their glyphs', () => {
    const { container } = render(<TitleBar />)
    const buttons = [...container.querySelectorAll('button')]
    expect(buttons.map((b) => [b.getAttribute('aria-label'), b.getAttribute('title')])).toEqual([
      ['Minimize', 'Minimize'], ['Maximize', 'Maximize'], ['Close', 'Close'],
    ])
    expect(unnamed(container)).toEqual([])
    for (const svg of container.querySelectorAll('button svg')) expect(svg.getAttribute('aria-hidden')).toBe('true')
  })
  it('CONTROL: a bare glyph button is caught', () => {
    const host = document.createElement('div')
    host.innerHTML = '<button><svg></svg></button><button aria-label="Close"><svg></svg></button>'
    expect(unnamed(host)).toHaveLength(1)
  })
})
