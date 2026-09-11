/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Field } from './Field'
import { Input } from './Input'

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
