/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { RowTitle } from './RowTitle'

afterEach(cleanup)

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../index.css'), 'utf8').replace(/\r\n/g, '\n')
/** The one rule whose selector list is exactly `sel`, comments out. */
const rule = (sel) => {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const m = [...code.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, s]) => s.trim() === sel)
  return m ? m[2] : null
}

describe('RowTitle (FX8-KR-1)', () => {
  it('draws the words, then the buttons in the kit HoverActions, in the order given', () => {
    const { container } = render(
      <RowTitle actions={<>
        <button type="button">Open Harbour</button>
        <button type="button">Delete Harbour</button>
      </>}>
        <button type="button">Harbour</button>
      </RowTitle>,
    )
    const title = container.querySelector('.ui-row-title')
    expect([...title.children].map((c) => c.className)).toEqual(['ui-row-title-words', 'ui-hover-actions ui-row-title-acts'])
    expect(title.querySelector('.ui-row-title-words').textContent).toBe('Harbour')
    // DOM order is the Tab order: the words, then Open, then Delete.
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Harbour', 'Open Harbour', 'Delete Harbour'])
  })

  it('draws no slot when the row has no buttons, and passes its class and attributes through', () => {
    const { container } = render(<RowTitle className="rb-x" data-k="1"><span>Words</span></RowTitle>)
    const title = container.querySelector('.ui-row-title')
    expect(title.classList.contains('rb-x')).toBe(true)
    expect(title.dataset.k).toBe('1')
    expect(container.querySelector('.ui-hover-actions')).toBeNull()
  })

  it('lays the buttons 4px after the words and never shrinks them; the words cut first', () => {
    expect(rule('.ui-row-title')).toMatch(/display: flex;/)
    expect(rule('.ui-row-title')).toMatch(/gap: 4px;/)
    expect(rule('.ui-row-title')).toMatch(/min-width: 0;/)
    // The words: their need, up to the cell (flex-basis auto, shrinkable to 0).
    expect(rule('.ui-row-title-words')).toMatch(/flex: 0 1 auto;/)
    expect(rule('.ui-row-title-words')).toMatch(/min-width: 0;/)
    // The slot: never shrinks, so a button never moves for a long name.
    expect(rule('.ui-row-title-acts')).toMatch(/flex: none;/)
    // A rename's field takes the cell.
    expect(rule('.ui-row-title-words:has(input)')).toMatch(/flex: 1 1 auto;/)
  })

  it('keeps the kit reveal: the slot is the HoverActions every row reveals on hover and on focus', () => {
    // The reveal is HoverActions' own rule, so a RowTitle in a <tr> fades in
    // on the row's hover and focus-within with nothing of its own.
    expect(css).toContain(':where(tr, li, .ui-hover-host):hover .ui-hover-actions')
    expect(css).toContain(':where(tr, li, .ui-hover-host):focus-within .ui-hover-actions')
    expect(rule('.ui-row-title')).not.toMatch(/opacity/)
    expect(rule('.ui-row-title-acts')).not.toMatch(/opacity|display/)
  })
})
