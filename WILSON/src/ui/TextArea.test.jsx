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

  it('forwards Escape to the caller after reverting, the same contract as Input (W2 / KR-6)', () => {
    const onChange = vi.fn()
    const mine = vi.fn()
    render(<TextArea value="was" onChange={onChange} onKeyDown={mine} aria-label="note" />)
    const t = screen.getByLabelText('note')
    fireEvent.focus(t, { target: { value: 'was' } })
    fireEvent.keyDown(t, { key: 'Escape' })
    expect(onChange).toHaveBeenLastCalledWith('was')
    expect(mine).toHaveBeenCalledTimes(1)
    expect(mine.mock.calls[0][0].key).toBe('Escape')
  })
})
