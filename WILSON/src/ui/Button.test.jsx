/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { Button, BUTTON_VARIANTS, BUTTON_SIZES } from './Button'

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8')

afterEach(cleanup)

describe('Button', () => {
  it('renders a secondary md button by default with state as data attributes', () => {
    render(<Button>Save</Button>)
    const b = screen.getByRole('button', { name: 'Save' })
    expect(b.className).toContain('ui-btn')
    expect(b.dataset.variant).toBe('secondary')
    expect(b.dataset.size).toBe('md')
    expect(b.dataset.surface).toBe('dark')
    expect(b.getAttribute('type')).toBe('button')
    expect(b.getAttribute('style')).toBeNull()
  })

  it('takes every variant and size', () => {
    for (const variant of BUTTON_VARIANTS) {
      for (const size of BUTTON_SIZES) {
        const { unmount } = render(<Button variant={variant} size={size}>{variant}</Button>)
        const b = screen.getByRole('button', { name: variant })
        expect(b.dataset.variant).toBe(variant)
        expect(b.dataset.size).toBe(size)
        unmount()
      }
    }
  })

  it('honours Bins\' boolean props and never leaks them to the DOM', () => {
    render(<Button primary small>Add</Button>)
    const b = screen.getByRole('button', { name: 'Add' })
    expect(b.dataset.variant).toBe('primary')
    expect(b.dataset.size).toBe('sm')
    expect(b.hasAttribute('primary')).toBe(false)
    expect(b.hasAttribute('small')).toBe(false)
    render(<Button danger>Delete</Button>)
    expect(screen.getByRole('button', { name: 'Delete' }).dataset.variant).toBe('danger')
  })

  it('clicks, and does not click when disabled', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Go</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    render(<Button onClick={onClick} disabled>Stop</Button>)
    const d = screen.getByRole('button', { name: 'Stop' })
    expect(d.disabled).toBe(true)
    fireEvent.click(d)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('reports an unknown variant in dev rather than rendering it silently', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<Button variant="tertiary">?</Button>)
    expect(err).toHaveBeenCalledWith(expect.stringContaining('unknown variant'))
    err.mockRestore()
  })
})

// ============================================================================
// F3 — the two props the lanes asked for, and the light surface
// ============================================================================

const Glyph = (props) => <svg data-testid="glyph" {...props} />

describe('Button: Icon (D1 kit request 3)', () => {
  it('renders an Icon, where thirteen call sites passed one and got nothing', () => {
    render(<Button Icon={Glyph}>Add</Button>)
    const b = screen.getByRole('button', { name: 'Add' })
    const svg = b.querySelector('svg')
    expect(svg, 'no svg rendered for Icon').not.toBeNull()
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    // The control, which is the actual defect: the prop must not survive into
    // the DOM. It used to land in `rest`, so React was handed a
    // function-valued attribute and drew nothing at all.
    expect(b.hasAttribute('Icon')).toBe(false)
    expect(b.hasAttribute('icon')).toBe(false)
  })

  it('takes the lowercase icon too, the same spelling as IconButton', () => {
    render(<Button icon={Glyph}>Add</Button>)
    expect(screen.getByRole('button', { name: 'Add' }).querySelector('svg')).not.toBeNull()
  })

  it('an icon CHILD still works, and is still what the kit sizes', () => {
    render(<Button><Glyph />Add</Button>)
    expect(screen.getByRole('button', { name: 'Add' }).querySelector('svg')).not.toBeNull()
    expect(css).toContain('.ui-btn > svg')
  })
})

describe('Button: loading (D2 kit request K3)', () => {
  it('owns the busy state: disabled, announced, a spinner, and the label swap', () => {
    const onClick = vi.fn()
    render(<Button variant="primary" loading loadingLabel="Saving" onClick={onClick}>Save</Button>)
    const b = screen.getByRole('button', { name: 'Saving' })
    expect(b.disabled).toBe(true)
    expect(b.getAttribute('aria-busy')).toBe('true')
    expect(b.querySelector('.ui-spinner')).not.toBeNull()
    expect(b.textContent).toBe('Saving')
    fireEvent.click(b)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('keeps the caller label when no loadingLabel is given, and hides the spinner from AT', () => {
    render(<Button loading>Save</Button>)
    const b = screen.getByRole('button', { name: 'Save' })
    expect(b.textContent).toBe('Save')
    expect(b.querySelector('.ui-spinner').getAttribute('aria-hidden')).toBe('true')
  })

  it('the worked example really passes it — a prop with no call site closes nothing', () => {
    // D2 filed K3 for five auth surfaces; F3 adopted it on the kit's own
    // worked example rather than editing a finished lane's files, and this
    // is where that claim is checked rather than asserted in a hand-off.
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../components/TeamMembers/TeamMembersPage.jsx'), 'utf8')
    expect(src).toContain('loading={busy}')
    expect(src).toContain('loadingLabel=')
    // The control: the old spelling is gone, so the two cannot both be there
    // and the button cannot be disabled twice by two mechanisms.
    expect(src).not.toContain("{busy ? 'Saving…'")
  })

  it('not loading is exactly as before: no spinner, no aria-busy, the icon back', () => {
    render(<Button loading={false} loadingLabel="Saving" Icon={Glyph}>Save</Button>)
    const b = screen.getByRole('button', { name: 'Save' })
    expect(b.querySelector('.ui-spinner')).toBeNull()
    expect(b.hasAttribute('aria-busy')).toBe(false)
    expect(b.disabled).toBe(false)
    expect(b.querySelector('svg')).not.toBeNull()
  })

  it('the spinner reads the button own ink, so no prop has to choose it', () => {
    // White inside a filled primary, ink-light inside a light secondary,
    // ink-3 once the button is disabled: one rule covers every combination.
    const rule = css.match(/\.ui-btn > \.ui-spinner \{[^}]*\}/)
    expect(rule, 'no .ui-btn > .ui-spinner rule in index.css').not.toBeNull()
    expect(rule[0]).toContain('border-top-color: currentColor')
    render(<Button loading surface="light">Save</Button>)
    // The control: the component must NOT stamp a surface on it, because
    // `.ui-spinner[data-surface="light"]` is written later and would win.
    expect(screen.getByRole('button').querySelector('.ui-spinner').dataset.surface).toBe('dark')
  })
})

describe('Button on the light ground (D1 kit request 4, D2 K7 and K8)', () => {
  it('a light ghost keeps its ink on hover: it used to turn near-white at 2.10 to 1', () => {
    const hover = css.match(/\.ui-btn\[data-surface="light"\]\[data-variant="secondary"\]:hover:not\(:disabled\),\r?\n\s*\.ui-btn\[data-surface="light"\]\[data-variant="ghost"\]:hover:not\(:disabled\) \{[^}]*\}/)
    expect(hover, 'no light hover rule in index.css').not.toBeNull()
    expect(hover[0]).toContain('color: var(--color-ink-light)')
  })

  it('a light DANGER button is filled, because on one ink an outline cannot say destructive', () => {
    const rule = css.match(/\.ui-btn\[data-surface="light"\]\[data-variant="danger"\] \{[^}]*\}/)
    expect(rule, 'no light danger rule in index.css').not.toBeNull()
    expect(rule[0]).toContain('background-color: var(--color-danger-light)')
    expect(rule[0]).toContain('color: var(--color-on-fill)')
    // The control, spelling-proof: the light danger selector appears EXACTLY
    // twice in the file — the fill and its hover — so it cannot also be in
    // the outlined trio, and no third rule can take the fill back off. The
    // first cut pinned one exact line-break spelling of the trio, which any
    // reformatting would have slipped past.
    const hits = css.match(/\.ui-btn\[data-surface="light"\]\[data-variant="danger"\]/g) || []
    expect(hits).toHaveLength(2)
  })

  it('a light DISABLED button differs in FORM, and its rule comes after the danger fill', () => {
    const rule = css.match(/\.ui-btn\[data-surface="light"\]:disabled \{[^}]*\}/)
    expect(rule, 'no light disabled rule in index.css').not.toBeNull()
    expect(rule[0]).toContain('background-color: var(--color-well-light)')
    expect(rule[0]).toContain('border-color: transparent')
    expect(rule[0]).toContain('color: var(--color-ink-light)')
    // Both selectors are (0,3,0), so the tie goes to source order and the
    // ORDER is half the fix: a disabled danger button must not stay red.
    expect(css.indexOf('.ui-btn[data-surface="light"]:disabled'))
      .toBeGreaterThan(css.indexOf('.ui-btn[data-surface="light"][data-variant="danger"] {'))
    // And a disabled state is never an opacity (plan section 3.1 bans it).
    expect(rule[0]).not.toContain('opacity')
  })

  it('🚨 a disabled kit control says not-allowed — @layer components beats @layer base', () => {
    // `:disabled { cursor: not-allowed }` lives in `@layer base` and every kit
    // control carries `cursor: pointer` in `@layer components`, a LATER
    // layer, which beats base whatever the selectors say. Measured in
    // Chromium before this was fixed: disabled `.ui-btn`, `.ui-iconbtn` and
    // `.ui-chip` all reported `pointer`. It matters twice here, because "the
    // state reads from the cursor" is half of what a disabled control on the
    // light ground has left once the ink cannot carry it.
    for (const sel of [
      /\.ui-btn:disabled \{[^}]*\}/,
      /\.ui-iconbtn:disabled \{[^}]*\}/,
      /\.ui-chip:disabled \{[^}]*\}/,
    ]) {
      const rule = css.match(sel)
      expect(rule, String(sel)).not.toBeNull()
      expect(rule[0], String(sel)).toContain('cursor: not-allowed')
    }
    // The control: the base rule is still there and is still in `base`, which
    // is exactly why repeating it in the component layer is necessary rather
    // than redundant.
    const base = css.slice(css.indexOf('@layer base {'), css.indexOf('@layer components {'))
    expect(base).toMatch(/:disabled,\r?\n\s*\[aria-disabled="true"\] \{\s*\r?\n\s*cursor: not-allowed/)
  })

  it('the press is one state duration, and reduced motion removes it rather than shortening it', () => {
    expect(css).toContain('.ui-btn:active:not(:disabled) { transform: scale(0.98); }')
    // 🚨 Inside the `.ui-btn` BLOCK. The first cut was
    // `/\.ui-btn \{[\s\S]*?transition:[^;]*transform/`, and `[\s\S]*?` walks
    // through as many closing braces as it likes — it was matching a
    // `transform` transition on `.ui-switch-knob` 267 lines further down, so
    // deleting the press transition entirely left the test green.
    const block = css.match(/\n  \.ui-btn \{([^}]*)\}/)
    expect(block, 'no .ui-btn block in index.css').not.toBeNull()
    expect(block[1]).toMatch(/transition:[^;]*transform var\(--duration-state\)/)
    // …and the reduced-motion block is the KIT's, not the first one in the
    // file: `.auth-step` opens one 1,200 lines earlier, so slicing from the
    // first match and reading to EOF proves nothing about which block the
    // rule is in.
    const rm = css.match(/@media \(prefers-reduced-motion: reduce\) \{\s*\n  \.ui-btn,[\s\S]*?\n\}/)
    expect(rm, 'no kit reduced-motion block').not.toBeNull()
    expect(rm[0]).toContain('.ui-btn:active:not(:disabled) { transform: none; }')
  })
})
