/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { TextArea } from './TextArea'

afterEach(cleanup)

describe('TextArea', () => {
  it('renders the same well as Input with rows, and reports typed values', () => {
    const onChange = vi.fn()
    render(<TextArea value="" onChange={onChange} placeholder="Notes" rows={5} />)
    const t = screen.getByPlaceholderText('Notes')
    expect(t.tagName).toBe('TEXTAREA')
    expect(t.className).toContain('ui-input')
    expect(t.getAttribute('rows')).toBe('5')
    fireEvent.change(t, { target: { value: 'two\nlines' } })
    expect(onChange).toHaveBeenCalledWith('two\nlines')
  })

  it('Escape reverts and commits nothing; blur otherwise commits', () => {
    const onChange = vi.fn()
    const onCommit = vi.fn()
    render(<TextArea value="was" onChange={onChange} onCommit={onCommit} aria-label="note" />)
    const t = screen.getByLabelText('note')
    fireEvent.focus(t, { target: { value: 'was' } })
    fireEvent.keyDown(t, { key: 'Escape' })
    expect(onChange).toHaveBeenLastCalledWith('was')
    fireEvent.blur(t)
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.focus(t, { target: { value: 'was' } })
    fireEvent.blur(t)
    expect(onCommit).toHaveBeenCalledTimes(1)
  })
})
