/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Select } from './Select'

afterEach(cleanup)

describe('Select', () => {
  it('renders options from objects or strings, with a placeholder that reports null', () => {
    const onChange = vi.fn()
    render(
      <Select
        value={null}
        onChange={onChange}
        placeholder="Choose a scene…"
        options={[{ value: 's1', label: 'Scene 1' }, 'Scene 2']}
        aria-label="scene"
      />,
    )
    const s = screen.getByLabelText('scene')
    expect(s.className).toContain('ui-input')
    expect([...s.options].map((o) => o.textContent)).toEqual(['Choose a scene…', 'Scene 1', 'Scene 2'])
    fireEvent.change(s, { target: { value: 's1' } })
    expect(onChange).toHaveBeenLastCalledWith('s1')
    fireEvent.change(s, { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith(null)
  })
})
