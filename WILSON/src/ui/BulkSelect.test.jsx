/** @vitest-environment jsdom */
// BulkSelect (post-overhaul F10, rabbit A6): a bulk bar's picker, one for the
// four R.A.B.B.I.T. bars. The bars' own uses (the "None" clear among them)
// are pinned in tools/rabbit_v0.1.0/views/kitInViews.test.jsx.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { BulkSelect } from './BulkSelect'

afterEach(cleanup)

const select = () => screen.getByRole('combobox', { name: 'Status' })

describe('BulkSelect', () => {
  it('the kit\'s small well with the caller\'s class (written once), its label first and disabled, then the options', () => {
    render(<BulkSelect label="Status" options={['in_progress', 'final']} onPick={() => {}} className="ui-input rb-x-tool" />)
    const s = select()
    expect([s.className, s.dataset.size]).toEqual(['ui-input rb-x-tool', 'sm'])
    expect([...s.options].map((o) => [o.value, o.textContent, o.disabled])).toEqual([
      ['', 'Status', true], ['in_progress', 'In progress', false], ['final', 'Final', false],
    ])
    expect(s.value).toBe('')
  })

  it('a pick answers its value and the select goes back to its label', () => {
    const onPick = vi.fn()
    render(<BulkSelect label="Status" options={['final']} onPick={onPick} />)
    fireEvent.change(select(), { target: { value: 'final' } })
    expect(onPick).toHaveBeenCalledWith('final')
    expect(select().value).toBe('')
  })

  it('"None" (allowEmpty) answers null: the clear its callers expect; the label itself answers nothing', () => {
    const onPick = vi.fn()
    render(<BulkSelect label="Status" options={['p1']} labels={{ p1: 'Shoot' }} onPick={onPick} allowEmpty />)
    const none = [...select().options].find((o) => o.textContent === 'None')
    expect(none.value).not.toBe('')
    fireEvent.change(select(), { target: { value: none.value } })
    expect(onPick).toHaveBeenCalledWith(null)
    expect(select().value).toBe('')
    onPick.mockClear()
    fireEvent.change(select(), { target: { value: '' } })
    expect(onPick).not.toHaveBeenCalled()
  })

  it('an option\'s words: its own label; else the labels map as written (the value where it is empty); else sentence case', () => {
    render(<BulkSelect label="Status" options={[{ value: 'a', label: 'Own' }, 'p_1', 'p2']} labels={{ p_1: 'VFX_cleanup', p2: '' }} onPick={() => {}} />)
    expect([...select().options].slice(1).map((o) => o.textContent)).toEqual(['Own', 'VFX_cleanup', 'p2'])
    cleanup()
    render(<BulkSelect label="Status" options={['time_of_day']} onPick={() => {}} />)
    expect(select().options[1].textContent).toBe('Time of day')
  })

  it("a caller's stray props cannot replace the picker's own: its change, its class pair, its size (F10 review round 1, 1A-09)", () => {
    const onPick = vi.fn()
    const stray = vi.fn()
    render(<BulkSelect label="Status" options={['final']} onPick={onPick} onChange={stray} data-size="md" className="rb-x-tool" />)
    fireEvent.change(select(), { target: { value: 'final' } })
    expect(onPick).toHaveBeenCalledWith('final')
    expect([select().className, select().dataset.size]).toEqual(['ui-input rb-x-tool', 'sm'])
  })
})
