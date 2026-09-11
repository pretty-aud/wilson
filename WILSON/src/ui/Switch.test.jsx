/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Switch } from './Switch'

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
