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

  // ── W2 / C2 KR-6 (F3): revert first, forward second ───────────────────────
  it('hands Escape to the caller AFTER reverting, so an adopted call site keeps its own branch', () => {
    const onChange = vi.fn()
    const mine = vi.fn()
    render(<Input value="original" onChange={onChange} onKeyDown={mine} aria-label="note" />)
    const i = screen.getByLabelText('note')
    fireEvent.focus(i, { target: { value: 'original' } })
    fireEvent.change(i, { target: { value: 'edited' } })
    fireEvent.keyDown(i, { key: 'Escape' })

    // Both halves, and in this order: the field reverted, and the key still
    // reached the caller. It used to `return` before the second half, so two
    // call sites lost their Escape exit on adoption and one of them had no
    // other way out.
    expect(onChange).toHaveBeenLastCalledWith('original')
    expect(mine).toHaveBeenCalledTimes(1)
    expect(mine.mock.calls[0][0].key).toBe('Escape')
    // The caller can tell the revert happened: `cancel` preventDefaults.
    expect(mine.mock.calls[0][0].defaultPrevented).toBe(true)
  })

  it('forwarding does NOT re-open the bubble: W2 still needs a second press to close the dialog', () => {
    const onChange = vi.fn()
    const dialogEscape = vi.fn()
    render(
      <div onKeyDown={dialogEscape}>
        <Input value="original" onChange={onChange} onKeyDown={() => {}} aria-label="note" />
      </div>,
    )
    const i = screen.getByLabelText('note')
    fireEvent.focus(i, { target: { value: 'original' } })
    fireEvent.keyDown(i, { key: 'Escape' })
    expect(dialogEscape).not.toHaveBeenCalled()
  })

  it('every other key is forwarded untouched, as it always was', () => {
    const mine = vi.fn()
    render(<Input value="x" onChange={() => {}} onKeyDown={mine} aria-label="note" />)
    fireEvent.keyDown(screen.getByLabelText('note'), { key: 'a' })
    expect(mine).toHaveBeenCalledTimes(1)
    expect(mine.mock.calls[0][0].defaultPrevented).toBe(false)
  })
})
