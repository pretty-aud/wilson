/** @vitest-environment jsdom */
// P1 (§7 audit): the agent's outline proposal is the kit Dialog with the
// kit's Buttons — the same three actions, sentence case, no private overlay.
// The walk never opens it (the agent has to propose first), so this is its
// guard.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import LessonOutlinePopup from './LessonOutlinePopup'

afterEach(cleanup)

const course = { mode: 'full_course', softwareName: 'Houdini', description: 'Procedural FX.' }
const subject = { mode: 'single_subject', topic: 'VEX basics' }

describe('LessonOutlinePopup (P1)', () => {
  it('is a kit Dialog titled in sentence case, with the three actions as kit Buttons', () => {
    const fns = { onGenerate: vi.fn(), onRefresh: vi.fn(), onCancel: vi.fn() }
    render(<LessonOutlinePopup proposalData={course} {...fns} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('New course')
    expect(dialog.textContent).toContain('Houdini')
    for (const [name, fn] of [['Generate course', fns.onGenerate], ['Refresh', fns.onRefresh], ['Cancel', fns.onCancel]]) {
      const b = screen.getByRole('button', { name })
      expect(b.className).toMatch(/\bui-btn\b/)
      fireEvent.click(b)
      expect(fn).toHaveBeenCalledTimes(1)
    }
    expect(screen.getByRole('button', { name: 'Generate course' }).getAttribute('data-variant')).toBe('primary')
    // No private palette survived the move.
    expect(document.body.innerHTML).not.toMatch(/stone-|orange-|green-|shadow-2xl|opacity-50/)
  })
  it('a single subject reads "New subject" / "Generate subject"', () => {
    render(<LessonOutlinePopup proposalData={subject} onGenerate={() => {}} onRefresh={() => {}} onCancel={() => {}} />)
    expect(screen.getByRole('dialog').textContent).toContain('New subject')
    expect(screen.getByRole('button', { name: 'Generate subject' })).toBeTruthy()
  })
  it('CONTROL: the check for a private palette sees one', () => {
    expect('<div class="bg-stone-900 border border-orange-500 shadow-2xl">').toMatch(/stone-|orange-|green-|shadow-2xl|opacity-50/)
  })
})
