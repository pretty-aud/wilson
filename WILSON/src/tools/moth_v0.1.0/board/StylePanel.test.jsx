// @vitest-environment jsdom
// StylePanel.test.jsx — MO4 boards: the selection's style. It offers only what every selected kind may carry,
// shows a shared value or "Mixed", and sends patches of the server's keys; stacking and Delete go through.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import StylePanel, { sharedKeys, sharedValue, SWATCHES } from './StylePanel.jsx'

afterEach(cleanup)

const shape = (over = {}) => ({ id: 'a', kind: 'shape', shape: 'rectangle', style: {}, ...over })
const mount = (elements, props = {}) => {
  const all = { elements, canWrite: true, onStyle: vi.fn(), onShape: vi.fn(), onStack: vi.fn(), onRemove: vi.fn(), ...props }
  render(<StylePanel {...all} />)
  return all
}

describe('StylePanel', () => {
  it('nothing selected, or a board that cannot be changed: no panel', () => {
    const { container } = render(<StylePanel elements={[]} canWrite />)
    expect(container.innerHTML).toBe('')
    render(<StylePanel elements={[shape()]} canWrite={false} />)
    expect(screen.queryByRole('complementary', { name: 'Style' })).toBeNull()
  })

  it('a shape: fill, line, words, sizes, the shape itself; each change is a patch of the server\'s keys', () => {
    const p = mount([shape({ style: { fill: '#FFE58A' } })])
    const fill = screen.getByRole('group', { name: 'Fill' })
    expect(within(fill).getByLabelText('Yellow').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(fill).getByLabelText('No colour'))
    expect(p.onStyle).toHaveBeenCalledWith({ fill: 'none' })
    fireEvent.click(within(screen.getByRole('group', { name: 'Line' })).getByLabelText('Blue'))
    expect(p.onStyle).toHaveBeenLastCalledWith({ stroke: '#9CC3FF' })
    fireEvent.change(screen.getByLabelText('Line width'), { target: { value: '8' } })
    expect(p.onStyle).toHaveBeenLastCalledWith({ width: 8 })
    fireEvent.change(screen.getByLabelText('Line style'), { target: { value: 'dotted' } })
    expect(p.onStyle).toHaveBeenLastCalledWith({ dash: 'dotted' })
    fireEvent.change(screen.getByLabelText('Size of words'), { target: { value: '32' } })
    expect(p.onStyle).toHaveBeenLastCalledWith({ font_size: 32 })
    fireEvent.click(screen.getByTitle('Words to the right'))
    expect(p.onStyle).toHaveBeenLastCalledWith({ align: 'right' })
    fireEvent.change(screen.getByLabelText('Opacity'), { target: { value: '40' } })
    expect(p.onStyle).toHaveBeenLastCalledWith({ opacity: 0.4 })
    fireEvent.change(screen.getByLabelText('Corners'), { target: { value: '12' } })
    expect(p.onStyle).toHaveBeenLastCalledWith({ corner: 12 })
    fireEvent.change(screen.getByLabelText('Shape'), { target: { value: 'hexagon' } })
    expect(p.onShape).toHaveBeenCalledWith('hexagon')
    expect(screen.queryByLabelText('Path')).toBeNull() // a connector's, not a shape's
  })

  it('a connector: its path and each end\'s head; no fill, no corners', () => {
    const p = mount([{ id: 'c', kind: 'connector', style: { route: 'elbow' } }])
    expect(screen.getByLabelText('Path').value).toBe('elbow')
    expect(screen.getByLabelText('End').value).toBe('arrow')
    expect(screen.getByLabelText('Start').value).toBe('none')
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: 'diamond' } })
    expect(p.onStyle).toHaveBeenLastCalledWith({ start_head: 'diamond' })
    fireEvent.change(screen.getByLabelText('Path'), { target: { value: 'curved' } })
    expect(p.onStyle).toHaveBeenLastCalledWith({ route: 'curved' })
    expect(screen.queryByRole('group', { name: 'Fill' })).toBeNull()
    expect(screen.queryByLabelText('Corners')).toBeNull()
    // A line must show: no "No colour" for a connector's line.
    expect(within(screen.getByRole('group', { name: 'Line' })).queryByLabelText('No colour')).toBeNull()
  })

  it('a mixed selection offers what they share, and says Mixed where they differ', () => {
    mount([shape({ style: { width: 2 } }), shape({ id: 'b', shape: 'oval', style: { width: 8 } }), { id: 'p', kind: 'pen', style: { width: 8 } }])
    expect(screen.queryByRole('group', { name: 'Fill' })).toBeNull() // a pen has no fill
    expect(screen.queryByLabelText('Shape')).toBeNull() // not all shapes
    expect(screen.getByLabelText('Line width').value).toBe('')
    expect(within(screen.getByLabelText('Line width')).getByText('Mixed')).toBeTruthy()
    expect(sharedKeys([shape(), { kind: 'pen' }])).toEqual(new Set(['stroke', 'width', 'dash', 'opacity']))
    expect(sharedValue([shape({ style: { fill: 'none' } }), shape({ style: { fill: 'none' } })], 'fill')).toBe('none')
    expect(sharedValue([shape(), shape({ style: { fill: '#000000' } })], 'fill')).toBeUndefined()
  })

  it('arranging and deleting', () => {
    const p = mount([shape()])
    fireEvent.click(screen.getByTitle('Bring forward'))
    fireEvent.click(screen.getByTitle('Send backward'))
    fireEvent.click(screen.getByTitle('Bring to front'))
    fireEvent.click(screen.getByTitle('Send to back'))
    expect(p.onStack.mock.calls.map((c) => c[0])).toEqual(['forward', 'backward', 'front', 'back'])
    fireEvent.click(screen.getByTitle('Delete'))
    expect(p.onRemove).toHaveBeenCalled()
  })

  it('the swatches have names a person reads', () => {
    for (const s of SWATCHES) {
      expect(s.label).toMatch(/^[A-Z][a-z ]+$/)
      expect(s.value).toMatch(/^#[0-9A-F]{6}$/)
    }
  })

  it('larger targets under a finger or a pen', () => {
    mount([shape()], { inputMode: 'touch' })
    const swatch = within(screen.getByRole('group', { name: 'Fill' })).getByLabelText('White')
    expect(swatch.style.width).toBe('30px')
  })
})
