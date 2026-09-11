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
    expect(css).toContain('.ui-field-row > .ui-field + .ui-field { margin-top: 0; }')
    const row = css.match(/\.ui-field-row \{[^}]*\}/)
    expect(row, 'no .ui-field-row rule in index.css').not.toBeNull()
    expect(row[0]).toContain('display: flex')
    expect(row[0]).toContain('gap: 16px')
  })

  it('a column that supplies its own gap does too, or the two ADD', () => {
    // Measured by C1: 32px down one column of a form and 16px down the other,
    // on the same form, because splitting one column into groups broke the
    // sibling adjacency there and nowhere else.
    expect(css).toContain('.ui-field-stack > .ui-field + .ui-field { margin-top: 0; }')
    const stack = css.match(/\.ui-field-stack \{[^}]*\}/)
    expect(stack, 'no .ui-field-stack rule in index.css').not.toBeNull()
    expect(stack[0]).toContain('flex-direction: column')
  })
})
