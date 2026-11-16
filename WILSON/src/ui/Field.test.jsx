/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Field } from './Field'
import { Input } from './Input'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8')

afterEach(cleanup)

describe('Field', () => {
  it('labels the control inside it', () => {
    render(<Field label="Scene"><Input value="" onChange={() => {}} /></Field>)
    const input = screen.getByLabelText('Scene')
    expect(input.tagName).toBe('INPUT')
    const field = input.closest('.ui-field')
    expect(field.tagName).toBe('LABEL')
    expect(field.querySelector('.ui-field-label').textContent).toBe('Scene')
  })

  it('renders inline, mixed and hint as data and content, not as inline styles', () => {
    render(<Field label="Roll" inline mixed hint="Differs across the selection"><Input value="" onChange={() => {}} /></Field>)
    const field = screen.getByText(/Roll/).closest('.ui-field')
    expect(field.dataset.inline).toBe('true')
    expect(field.dataset.mixed).toBe('true')
    expect(field.querySelector('.ui-field-label').textContent).toBe('Roll · mixed')
    expect(field.querySelector('.ui-field-hint').textContent).toBe('Differs across the selection')
    expect(field.getAttribute('style')).toBeNull()
  })
})

// ── F3: the 16px is a normal-flow rule (C1 kit request 4) ───────────────────
describe('Field spacing: the parent says which way it stacks', () => {
  it('the sibling margin is still there for the callers in real normal flow', () => {
    // InviteMemberDialog's bare <form> is one, and it is correct there.
    expect(css).toContain('.ui-field + .ui-field { margin-top: 16px; }')
  })

  it('a horizontal pair stands the margin down, which is what misaligned both edges', () => {
    const { container } = render(
      <div className="ui-field-row">
        <Field label="Start"><input /></Field>
        <Field label="End"><input /></Field>
      </div>,
    )
    expect(container.querySelectorAll('.ui-field-row > .ui-field').length).toBe(2)
    // BOTH stack rules have to stand down, and the inline one is (0,4,0):
    // `.ui-field[data-inline="true"] + .ui-field[data-inline="true"]` carries
    // 8px, so a single-class reset at (0,3,0) loses to it and a row of inline
    // fields kept its top margin.
    const reset = css.match(/\.ui-field-row > \.ui-field \+ \.ui-field,[\s\S]{0,160}?\{[^}]*\}/)
    expect(reset, 'no .ui-field-row margin reset').not.toBeNull()
    expect(reset[0]).toContain('margin-top: 0')
    expect(reset[0]).toContain('[data-inline="true"] + .ui-field[data-inline="true"]')
    const row = css.match(/\.ui-field-row \{[^}]*\}/)
    expect(row, 'no .ui-field-row rule in index.css').not.toBeNull()
    expect(row[0]).toContain('display: flex')
    expect(row[0]).toContain('gap: 16px')
  })

  it('🚨 the row lays out and does NOT size: a flex-basis here kills a caller width', () => {
    // The first cut set `flex: 1 1 0` on the children. Team Members' rate
    // pair declares `width: 88px` on its second field, and `flex-basis: 0`
    // makes `width` dead — measured in the running app, the 88px Type select
    // became a 251px half. A container that silently re-sizes its caller's
    // columns is the C1 breach this rule exists to fix, pointing the other
    // way.
    const child = css.match(/\.ui-field-row > \.ui-field \{[^}]*\}/)
    expect(child, 'no .ui-field-row > .ui-field rule').not.toBeNull()
    expect(child[0]).toContain('min-width: 0')
    expect(child[0]).not.toMatch(/\bflex\b/)
    expect(child[0]).not.toContain('width: 100%')
  })

  it('a column that supplies its own gap does too, or the two ADD', () => {
    // Measured by C1: 32px down one column of a form and 16px down the other,
    // on the same form, because splitting one column into groups broke the
    // sibling adjacency there and nowhere else.
    const reset = css.match(/\.ui-field-stack > \.ui-field \+ \.ui-field,[\s\S]{0,160}?\{[^}]*\}/)
    expect(reset, 'no .ui-field-stack margin reset').not.toBeNull()
    expect(reset[0]).toContain('margin-top: 0')
    expect(reset[0]).toContain('[data-inline="true"] + .ui-field[data-inline="true"]')
    const stack = css.match(/\.ui-field-stack \{[^}]*\}/)
    expect(stack, 'no .ui-field-stack rule in index.css').not.toBeNull()
    expect(stack[0]).toContain('flex-direction: column')
  })
})
