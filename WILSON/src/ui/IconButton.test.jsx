/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { X } from 'lucide-react'
import { IconButton } from './IconButton'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8')

afterEach(cleanup)

describe('IconButton', () => {
  it('renders the glyph, names itself from the title, ghost md by default', () => {
    render(<IconButton icon={X} title="Close" />)
    const b = screen.getByRole('button', { name: 'Close' })
    expect(b.className).toContain('ui-iconbtn')
    expect(b.getAttribute('title')).toBe('Close')
    expect(b.dataset.size).toBe('md')
    expect(b.dataset.active).toBeUndefined()
    expect(b.querySelector('svg')).not.toBeNull()
    expect(b.querySelector('svg').getAttribute('aria-hidden')).toBe('true')
  })

  it('honours Bins\' Icon prop and numeric size, and marks active as pressed', () => {
    const onClick = vi.fn()
    render(<IconButton Icon={X} title="Pin" size={3.5} active onClick={onClick} />)
    const b = screen.getByRole('button', { name: 'Pin' })
    expect(b.dataset.size).toBe('sm')
    expect(b.dataset.active).toBe('true')
    expect(b.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(b)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('reports a missing title in dev — an unnamed icon button is a defect', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<IconButton icon={X} />)
    expect(err).toHaveBeenCalledWith(expect.stringContaining('`title` is required'))
    err.mockRestore()
  })

  it('an explicit aria-label wins over the title for the accessible name', () => {
    render(<IconButton icon={X} title="Remove file" aria-label="Remove report.pdf" />)
    expect(screen.getByRole('button', { name: 'Remove report.pdf' })).toBeTruthy()
  })
})

// ── F4: the scale has TWO control heights, and C3b's request 3 is open ──────
describe('IconButton: no third control height (C3b request 3, still open)', () => {
  const block = (sel) => {
    const at = css.indexOf(sel + ' {')
    expect(at, `no "${sel}" rule in index.css`).toBeGreaterThan(-1)
    return css.slice(at + sel.length, css.indexOf('}', at))
  }

  it('offers sm and md and nothing smaller', () => {
    // §3.3: "Control heights 28 (sm …) and 36 (md …)". F4 built an `xs` at
    // 16/10 for the department chips and took it back out: the button renders
    // 28x28 today, which clears the 24px minimum target size, and 16x16 does
    // not — so shrinking it trades an accessibility floor for 4px of chip
    // height. That is a ruling, not a kit fix (hand-off §4b).
    expect(block('.ui-iconbtn[data-size="sm"]')).toContain('var(--control-sm)')
    expect(css).not.toMatch(/--control-xs/)
    expect(css).not.toMatch(/--icon-xs/)
    expect(css).not.toContain('.ui-iconbtn[data-size="xs"]')
  })

  it('and the arithmetic that makes it a trade, so the next session has it', () => {
    // `.ui-badge` is 20px; `sm` is 28. The overflow C3b reported is 4px top
    // and bottom, and it is what the chip pays for a target that clears 24.
    expect(block('.ui-badge')).toContain('height: 20px')
    const px = (name) => Number(css.match(new RegExp(`--${name}:\\s*(\\d+)px`))[1])
    expect(px('control-sm')).toBe(28)
    expect((px('control-sm') - 20) / 2).toBe(4)
    expect(px('control-sm')).toBeGreaterThanOrEqual(24)
  })

  it('an unknown size falls back to md and says so, rather than taking it silently', () => {
    // An unrecognised size used to reach `data-size` verbatim, match no rule,
    // and leave the button at 36px with nothing said — Panel and Drawer fixed
    // the same shape for `data-width="220px"`.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<IconButton icon={X} title="Odd" size="tiny" />)
    expect(screen.getByRole('button', { name: 'Odd' }).dataset.size).toBe('md')
    expect(err).toHaveBeenCalledWith(expect.stringContaining('unknown size "tiny"'))
    err.mockRestore()
  })

  it('still reads a numeric size as sm, which Bins passes', () => {
    // The fallback must not eat binUi's compatibility path.
    render(<IconButton Icon={X} title="Pin" size={3.5} />)
    expect(screen.getByRole('button', { name: 'Pin' }).dataset.size).toBe('sm')
  })
})

// ── F3: disabled on light was decided by ORDER, not specificity ─────────────
describe('IconButton: disabled on a light surface (D1 kit request 4)', () => {
  it('has its own rule, because the base disabled rule ties it and is written later', () => {
    // Both are (0,2,0). `.ui-iconbtn:disabled { color: ink-3 }` comes after
    // `.ui-iconbtn[data-surface="light"]`, so every disabled icon button on a
    // light page resolved to a grey at 1.68:1 on #f4a261 — the control that
    // is telling you it cannot be used was the one you could not see.
    const rule = css.match(/\.ui-iconbtn\[data-surface="light"\]:disabled \{[^}]*\}/)
    expect(rule, 'no light disabled icon-button rule in index.css').not.toBeNull()
    expect(rule[0]).toContain('color: var(--color-ink-light)')
    // 🚨 SPECIFICITY is what settles it, so that is what is asserted. The
    // first cut asserted SOURCE ORDER, which is inert: this selector is
    // (0,3,0) against the base rule's (0,2,0) and wins wherever it sits, so
    // moving it above the base rule — the change the assertion pretended to
    // catch — leaves the page correct and the test green.
    // 🚨 Both selectors are read OUT OF THE STYLESHEET. Counting units of a
    // string typed in the test proves something about the test: rename the
    // rule in index.css and the assertion sails on.
    const units = (sel) => (sel.match(/\.[\w-]+|\[[^\]]+\]|:[a-z-]+(?!\()/g) || []).length
    const mine = css.match(/(\.ui-iconbtn\[data-surface="light"\]:disabled) \{/)
    const base = css.match(/\n  (\.ui-iconbtn:disabled) \{/)
    expect(mine, 'no light disabled selector in index.css').not.toBeNull()
    expect(base, 'no base disabled selector in index.css').not.toBeNull()
    expect(units(mine[1])).toBeGreaterThan(units(base[1]))
  })

  it('the orange frame gets the same treatment, where a grey is forbidden outright', () => {
    const rule = css.match(/\.ui-iconbtn\[data-surface="chrome"\]:disabled \{[^}]*\}/)
    expect(rule, 'no chrome disabled icon-button rule').not.toBeNull()
    expect(rule[0]).toContain('color: var(--color-on-fill)')
  })

  it('renders disabled on light without an opacity anywhere near it', () => {
    render(<IconButton icon={() => <svg />} title="Delete" surface="light" disabled />)
    const b = screen.getByRole('button', { name: 'Delete' })
    expect(b.disabled).toBe(true)
    expect(b.dataset.surface).toBe('light')
    expect(b.getAttribute('style')).toBeNull()
  })
})
