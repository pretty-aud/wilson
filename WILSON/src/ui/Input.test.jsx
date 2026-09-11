/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Input } from './Input'

afterEach(cleanup)

describe('Input', () => {
  it('renders the well with size and surface as data attributes and reports typed values', () => {
    const onChange = vi.fn()
    render(<Input value="" onChange={onChange} placeholder="Search" size="sm" surface="light" />)
    const i = screen.getByPlaceholderText('Search')
    expect(i.className).toContain('ui-input')
    expect(i.dataset.size).toBe('sm')
    expect(i.dataset.surface).toBe('light')
    fireEvent.change(i, { target: { value: 'take 3' } })
    expect(onChange).toHaveBeenCalledWith('take 3')
  })

  it('Enter commits through blur', () => {
    const onCommit = vi.fn()
    render(<Input value="x" onChange={() => {}} onCommit={onCommit} aria-label="name" />)
    const i = screen.getByLabelText('name')
    i.focus()
    expect(document.activeElement).toBe(i)
    fireEvent.keyDown(i, { key: 'Enter' })
    // Enter blurs the field, and the blur is what commits — once.
    expect(document.activeElement).not.toBe(i)
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('Escape reverts to the value the field had on focus, commits nothing, and stops the key', () => {
    const onChange = vi.fn()
    const onCommit = vi.fn()
    const outer = vi.fn()
    render(
      <div onKeyDown={outer}>
        <Input value="original" onChange={onChange} onCommit={onCommit} aria-label="note" />
      </div>,
    )
    const i = screen.getByLabelText('note')
    fireEvent.focus(i, { target: { value: 'original' } })
    fireEvent.change(i, { target: { value: 'edited' } })
    fireEvent.keyDown(i, { key: 'Escape' })
    expect(onChange).toHaveBeenLastCalledWith('original')
    expect(outer).not.toHaveBeenCalled()      // a Dialog around it stays open
    fireEvent.blur(i)
    expect(onCommit).not.toHaveBeenCalled()
  })
})
