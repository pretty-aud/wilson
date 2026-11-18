/** @vitest-environment jsdom */
// =============================================================================
// useInlineText (post-overhaul F10, rabbit A6): the one behaviour the eight
// inline editors of R.A.B.B.I.T. share, on the kit's own elements and on a
// caller's. The views' own suites pin each editor's markup in place; the
// P1-06 focus return is pinned per view in
// tools/rabbit_v0.1.0/views/kitInViews.test.jsx.
// =============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { useInlineText } from './useInlineText'

// The editor as a view draws it: one component that calls the hook.
function InlineText(props) { return useInlineText(props) }
import { contrast, over } from './contrast'
import { PAPER, PAPER_RAISED, INK, INK_2, INK_3, HOVER } from './tokens'

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8')
  .replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '')
const rule = (sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = css.match(new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`))
  return m ? m[1] : null
}

afterEach(cleanup)

/** A saved value a parent holds, as a view's row does. */
function Saved({ initial = 'Lighthouse', onCommit = () => {}, ...props }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <InlineText value={value} label="Name" onCommit={(v) => { onCommit(v); setValue(v) }} {...props} />
      <button type="button" onClick={() => setValue('From elsewhere')}>change it</button>
      <button type="button">next</button>
    </>
  )
}
const words = () => screen.getByText(/Lighthouse|From elsewhere|Night/)
const field = () => screen.getByRole('textbox', { name: 'Name' })

describe('InlineText: the behaviour', () => {
  it('a click opens the field on the saved words and focuses it; Enter commits the TRIMMED draft once and hands focus back to the words', () => {
    const onCommit = vi.fn()
    render(<Saved onCommit={onCommit} />)
    fireEvent.click(words())
    expect(document.activeElement).toBe(field())
    expect(field().value).toBe('Lighthouse')
    fireEvent.change(field(), { target: { value: '  Night  ' } })
    fireEvent.keyDown(field(), { key: 'Enter' })
    // The blur that can follow as the field goes must not write again.
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith('Night')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(document.activeElement).toBe(words())
    expect(words().textContent).toBe('Night')
  })

  it('a blur commits; a draft equal to the saved words (after trimming) writes nothing', () => {
    const onCommit = vi.fn()
    render(<Saved onCommit={onCommit} />)
    fireEvent.click(words())
    fireEvent.change(field(), { target: { value: 'Lighthouse  ' } })
    fireEvent.blur(field())
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.click(words())
    fireEvent.change(field(), { target: { value: 'Night' } })
    fireEvent.blur(field())
    expect(onCommit).toHaveBeenCalledWith('Night')
  })

  it('a Tab away commits and keeps where focus went (no focus taken back)', () => {
    render(<Saved />)
    fireEvent.click(words())
    fireEvent.change(field(), { target: { value: 'Night' } })
    const next = screen.getByRole('button', { name: 'next' })
    // jsdom moves focus with its blur and focusout, as a Tab does.
    act(() => { next.focus() })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(document.activeElement).toBe(next)
    expect(words().textContent).toBe('Night')
  })

  it('Escape reverts, writes nothing, is marked handled and stopped, still reaches the caller\'s onKeyDown, and hands focus back', () => {
    const onCommit = vi.fn()
    const onKeyDown = vi.fn()
    const outside = vi.fn()
    document.addEventListener('keydown', outside)
    try {
      render(<Saved onCommit={onCommit} onKeyDown={onKeyDown} />)
      fireEvent.click(words())
      fireEvent.change(field(), { target: { value: 'Oops' } })
      const handled = !fireEvent.keyDown(field(), { key: 'Escape' })
      expect(handled).toBe(true)
      expect(onKeyDown).toHaveBeenCalledTimes(1)
      expect(onKeyDown.mock.calls[0][0].key).toBe('Escape')
      // Stopped: a kit Dialog's document listener never sees it (W2).
      expect(outside).not.toHaveBeenCalled()
      expect(onCommit).not.toHaveBeenCalled()
      expect(words().textContent).toBe('Lighthouse')
      expect(document.activeElement).toBe(words())
    } finally {
      document.removeEventListener('keydown', outside)
    }
  })

  it('the draft follows the saved words while untouched, and keeps what was typed (R1-06)', () => {
    render(<Saved />)
    fireEvent.click(words())
    // Untouched: the saved words change under the open field and it follows.
    fireEvent.mouseDown(screen.getByRole('button', { name: 'change it' }))
    fireEvent.click(screen.getByRole('button', { name: 'change it' }))
    expect(field().value).toBe('From elsewhere')
    fireEvent.change(field(), { target: { value: 'Typed' } })
    fireEvent.click(screen.getByRole('button', { name: 'change it' }))
    expect(field().value).toBe('Typed')
  })

  it('readOnly: the words alone — no click, no field, no tab stop', () => {
    render(<InlineText value="" label="Name" placeholder="Untitled" readOnly />)
    const still = screen.getByText('Untitled')
    expect(still.tagName).toBe('SPAN')
    expect(still.getAttribute('data-static')).toBe('true')
    expect(still.getAttribute('data-empty')).toBe('true')
    expect(still.hasAttribute('tabindex')).toBe(false)
    fireEvent.click(still)
    expect(screen.queryByRole('textbox')).toBeNull()
    cleanup()
    render(<InlineText value="" label="Name" placeholder="Add" staticEmpty="—" readOnly />)
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('`display` draws the words at rest; the field edits the raw value', () => {
    render(<InlineText value="See [[asset:a1|Lamp]]" label="Name" display={(v) => v.replace(/\[\[[^|]*\|([^\]]*)\]\]/g, '$1')} />)
    fireEvent.click(screen.getByText('See Lamp'))
    expect(field().value).toBe('See [[asset:a1|Lamp]]')
  })
})

describe('InlineText: a caller\'s own elements', () => {
  it('draws the caller\'s words, field and read-only words exactly as written, with the behaviour added', () => {
    const onCommit = vi.fn()
    const el = (readOnly) => (
      <InlineText value="" placeholder="Untitled level" label="Name" onCommit={onCommit} readOnly={readOnly}
        words={<button type="button" className="rb-x-text" data-quiet="false" data-empty="true" title="t" />}
        still={<span className="rb-x-text" data-static="true" data-empty="true" />}
        field={<input className="ui-input rb-x-input" data-size="sm" data-quiet="false" />} />
    )
    const { rerender } = render(el(false))
    const b = screen.getByRole('button', { name: 'Untitled level' })
    // Nothing of the kit's own: the class, the data and the title as written.
    expect(b.className).toBe('rb-x-text')
    expect([b.dataset.quiet, b.dataset.empty, b.title]).toEqual(['false', 'true', 't'])
    fireEvent.click(b)
    const f = field()
    expect(f.className).toBe('ui-input rb-x-input')
    expect([f.getAttribute('type'), f.dataset.size, f.dataset.quiet]).toEqual(['text', 'sm', 'false'])
    fireEvent.change(f, { target: { value: 'Harbour' } })
    fireEvent.keyDown(f, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith('Harbour')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Untitled level' }))
    rerender(el(true))
    const s = screen.getByText('Untitled level')
    expect([s.tagName, s.className, s.dataset.static]).toEqual(['SPAN', 'rb-x-text', 'true'])
  })

  it('a span for words is focusable by script only (tabIndex -1), so focus can come back without a new tab stop; its click can stop there', () => {
    const rowClick = vi.fn()
    render(
      <div onClick={rowClick}>
        <InlineText value="Dawn" label="Name" stopClick words={<span className="rb-x-inline" />} field={<input className="ui-input rb-x-field" />} />
      </div>,
    )
    const span = screen.getByText('Dawn')
    expect(span.tabIndex).toBe(-1)
    expect(span.getAttribute('tabindex')).toBe('-1')
    fireEvent.click(span)
    expect(rowClick).not.toHaveBeenCalled()
    fireEvent.click(field())
    expect(rowClick).not.toHaveBeenCalled()
    fireEvent.keyDown(field(), { key: 'Escape' })
    expect(document.activeElement).toBe(screen.getByText('Dawn'))
  })

  it('a read-only element with its own children is drawn as given', () => {
    render(<InlineText value="Dawn" label="Name" readOnly still={<span className="rb-x-inert"><span className="rb-x-words">Dawn as given</span></span>} />)
    expect(screen.getByText('Dawn as given').parentElement.className).toBe('rb-x-inert')
  })
})

describe('InlineText: the kit\'s own look', () => {
  it('a caller with no elements gets the kit\'s words and the kit\'s small well', () => {
    render(<InlineText value="" label="Name" placeholder="Add a name" />)
    const b = screen.getByRole('button', { name: 'Add a name' })
    expect([b.className, b.dataset.empty]).toEqual(['ui-inline-text', 'true'])
    fireEvent.click(b)
    expect([field().className, field().dataset.size, field().getAttribute('type')]).toEqual(['ui-input', 'sm', 'text'])
  })

  it('the sheet: the words as a cell\'s text in the one ink, the hover fill, the empty ink rule, the inert words plain; no colour that is not a token', () => {
    const base = rule('.ui-inline-text')
    expect(base).toMatch(/color:\s*var\(--color-ink\)/)
    expect(base).toMatch(/background-color:\s*transparent/)
    expect(base).toMatch(/border:\s*0/)
    expect(base).toMatch(/font-size:\s*var\(--text-dense\)/)
    expect(base).toMatch(/border-radius:\s*var\(--radius-control\)/)
    expect(base).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i)
    expect(rule('.ui-inline-text:hover:not([data-static="true"])')).toMatch(/background-color:\s*var\(--color-hover\)/)
    expect(rule('.ui-inline-text[data-empty="true"]')).toMatch(/color:\s*var\(--color-ink-3\)/)
    expect(css).toMatch(/\.ui-inline-text\[data-empty="true"\]:hover:not\(\[data-static="true"\]\),\s*\n\s*\.ui-inline-text\[data-empty="true"\]:focus \{ color: var\(--color-ink-2\); \}/)
    expect(rule('.ui-inline-text[data-static="true"]')).toMatch(/cursor:\s*default/)
    // No focus rule of its own: the kit's one :focus-visible ring.
    expect(css).not.toMatch(/\.ui-inline-text[^{]*:focus-visible/)
  })

  it('contrast: the ink and the second ink pass on both papers and on the fill; the third ink passes at rest, which is why the fill takes the second', () => {
    for (const ground of [PAPER, PAPER_RAISED]) {
      expect(contrast(INK, ground)).toBeGreaterThan(4.5)
      expect(contrast(INK_3, ground)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(INK_2, over(HOVER, ground))).toBeGreaterThan(4.5)
      expect(contrast(INK, over(HOVER, ground))).toBeGreaterThan(4.5)
    }
    // CONTROL: the reason for the second ink on the fill (CellSelect's measure).
    expect(contrast(INK_3, over(HOVER, PAPER))).toBeLessThan(4.5)
  })
})
