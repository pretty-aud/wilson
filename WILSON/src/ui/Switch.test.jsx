/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Switch } from './Switch'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8')

afterEach(cleanup)

describe('Switch', () => {
  it('is a real switch: role, aria-checked, and the state as a data attribute', () => {
    render(<Switch checked label="Autoplay" onChange={() => {}} />)
    const s = screen.getByRole('switch', { name: 'Autoplay' })
    expect(s.getAttribute('aria-checked')).toBe('true')
    expect(s.closest('.ui-switch').dataset.checked).toBe('true')
    expect(s.querySelector('.ui-switch-knob')).not.toBeNull()
  })

  it('reports the inverted value on click; the label text is NOT a click target (C1)', () => {
    const onChange = vi.fn()
    render(<Switch checked={false} label="Dense rows" onChange={onChange} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Dense rows' }))
    expect(onChange).toHaveBeenLastCalledWith(true)
    // The old Toggle's label text did nothing; a <label> wrapper would have
    // forwarded this click to the button. It must stay inert.
    fireEvent.click(screen.getByText('Dense rows'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Dense rows').closest('label')).toBeNull()
  })

  it('does nothing when disabled', () => {
    const onChange = vi.fn()
    render(<Switch checked disabled label="Locked" onChange={onChange} />)
    const s = screen.getByRole('switch')
    expect(s.disabled).toBe(true)
    fireEvent.click(s)
    expect(onChange).not.toHaveBeenCalled()
    expect(s.closest('.ui-switch').dataset.disabled).toBe('true')
  })
})

// ── F3: the light track (D1 kit request 4) ──────────────────────────────────
describe('Switch on the light ground', () => {
  it('the TRACK follows the surface, not just the label', () => {
    render(<Switch checked onChange={() => {}} label="Notify" surface="light" />)
    expect(screen.getByRole('switch').closest('.ui-switch').dataset.surface).toBe('light')
    // surface="light" reached the label and stopped, so the track stayed the
    // dark-side pair: ink-3 off (1.68:1 on #f4a261) and signal on (1.73:1).
    // D1 records that as why the six Settings toggles are still buttons.
    expect(css).toMatch(/\.ui-switch\[data-surface="light"\] > \.ui-switch-track \{[^}]*\}/)
    expect(css).toMatch(/\.ui-switch\[data-surface="light"\]\[data-checked="true"\] > \.ui-switch-track \{[^}]*\}/)
  })

  it('one ink means the state is FORM: outlined track and solid knob, or the reverse', () => {
    const off = css.match(/\.ui-switch\[data-surface="light"\] > \.ui-switch-track \{[^}]*\}/)[0]
    const on = css.match(/\.ui-switch\[data-surface="light"\]\[data-checked="true"\] > \.ui-switch-track \{[^}]*\}/)[0]
    expect(off).toContain('background-color: transparent')
    expect(off).toContain('inset 0 0 0 1px var(--color-ink-light)')
    expect(on).toContain('background-color: var(--color-ink-light)')
    expect(on).toContain('box-shadow: none')
    // The knob inverts with it, so it is legible against the track in both.
    expect(css).toMatch(/\.ui-switch\[data-surface="light"\]\[data-checked="true"\] \.ui-switch-knob \{[^}]*var\(--color-ground-light\)/)
    // The ring is an inset shadow rather than a border ON PURPOSE: a border
    // is inside the border box and would move the 36x20 track and its knob.
    expect(off).not.toContain('border:')
  })

  it('🚨 a disabled Switch says not-allowed on the TRACK, which is what you point at', () => {
    // The wrapper is a <span> with no cursor of its own; `.ui-switch-track`
    // is the button, and it sets `cursor: pointer` in the SAME layer. The
    // global `:disabled { cursor: not-allowed }` is in `@layer base`, which
    // `@layer components` beats whatever the selectors say. Measured in
    // Chromium before this: a disabled Switch's track reported `pointer`.
    const rule = css.match(/\.ui-switch\[data-disabled="true"\],\r?\n\s*\.ui-switch\[data-disabled="true"\] > \.ui-switch-track \{[^}]*\}/)
    expect(rule, 'the disabled cursor does not reach the track').not.toBeNull()
    expect(rule[0]).toContain('cursor: not-allowed')
    // The control: the track really does claim `pointer` at rest, which is
    // why repeating the declaration is necessary rather than decorative.
    const track = css.match(/\n  \.ui-switch-track \{([^}]*)\}/)
    expect(track[1]).toContain('cursor: pointer')
  })

  it('the disabled rules come after the checked ones, because they tie at (0,4,x)', () => {
    expect(css.indexOf('.ui-switch[data-surface="light"][data-disabled="true"] > .ui-switch-track'))
      .toBeGreaterThan(css.indexOf('.ui-switch[data-surface="light"][data-checked="true"] > .ui-switch-track'))
  })
})
