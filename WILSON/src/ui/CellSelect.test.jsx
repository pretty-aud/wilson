/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { CellSelect } from './CellSelect'

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8')
  .replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '')
const rule = (sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = css.match(new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`))
  return m ? m[1] : null
}

afterEach(cleanup)

describe('CellSelect', () => {
  it('renders the empty option and the options, and reports null for the empty one', () => {
    const onChange = vi.fn()
    render(
      <CellSelect value={null} onChange={onChange} placeholder="—"
        options={[{ value: 'script', label: 'script' }, 'deck']} aria-label="Kind for brief.pdf" />,
    )
    const s = screen.getByLabelText('Kind for brief.pdf')
    expect(s.tagName).toBe('SELECT')
    expect(s.parentElement.className).toBe('ui-cell-select')
    expect([...s.options].map((o) => o.textContent)).toEqual(['—', 'script', 'deck'])
    expect(s.getAttribute('data-empty')).toBe('true')
    fireEvent.change(s, { target: { value: 'deck' } })
    expect(onChange).toHaveBeenLastCalledWith('deck')
    fireEvent.change(s, { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('drops the empty mark once a value is chosen, and passes disabled through', () => {
    render(<CellSelect value="deck" options={['deck']} disabled aria-label="k" />)
    const s = screen.getByLabelText('k')
    expect(s.hasAttribute('data-empty')).toBe(false)
    expect(s.disabled).toBe(true)
  })

  it('is a borderless, transparent 28px control whose caret appears only on the row\'s hover or focus', () => {
    const base = rule('.ui-cell-select > select')
    expect(base).toMatch(/border:\s*0/)
    expect(base).toMatch(/background-color:\s*transparent/)
    expect(base).toMatch(/height:\s*var\(--control-sm\)/)
    expect(base).toMatch(/appearance:\s*none/)
    expect(rule('.ui-cell-select::after')).toMatch(/opacity:\s*0/)
    expect(css).toMatch(/\.ui-tr:hover \.ui-cell-select::after,\s*\n\s*\.ui-tr:focus-within \.ui-cell-select::after/)
    // A disabled cell shows no caret at all: nothing to open.
    expect(css).toMatch(/\.ui-cell-select:has\(> select:disabled\)::after \{ display: none; \}/)
  })
})
