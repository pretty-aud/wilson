/** @vitest-environment jsdom */
// =============================================================================
// NotesView.test.jsx — UI overhaul C2, 2026-09-11.
//
// 🚨 WHY THIS FILE EXISTS. Review round 1 found that the bundle's biggest
// coverage hole was here: D21's hover and selected treatment, the format bar's
// active states, the save-state mapping and the note title's commit path could
// all have been deleted with every one of 2386 tests green. This view also
// carries the surface's only data-loss path — the Y.Doc save — and two live
// regressions were found in it by hand (Escape stopped cancelling; Escape on
// the date field issued a PATCH). Both are pinned below.
//
// The Y.Doc, TipTap and `noteSync` are NOT mocked away as a concept — the
// editor mounts for real. Only the cloud hook is a stand-in.
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'

vi.mock('../../cloud/auth/supabaseClient', () => ({
  supabase: {},
  hydrateSupabase: async () => {},
}))

const nb = vi.hoisted(() => ({ current: null }))
vi.mock('./useNotes', () => ({ useNotes: () => nb.current }))

const { default: NotesView } = await import('./NotesView')

afterEach(cleanup)

const note = (over = {}) => ({
  id: 'n1',
  title: 'Fox rig notes',
  subject: 'Rigging',
  note_date: '2026-09-10',
  updated_at: '2026-09-11T09:00:00Z',
  version: 1,
  body_preview: 'Spline IK on the tail',
  ...over,
})

const hook = (over = {}) => ({
  cloudReady: true,
  loading: false,
  error: null,
  notes: [note()],
  subjects: [{ id: 's1', label: 'Rigging' }, { id: 's2', label: 'Post' }],
  createNote: vi.fn(async () => ({ id: 'n2' })),
  deleteNote: vi.fn(async () => {}),
  openNote: vi.fn(async () => ({ ydoc_state: null, version: 1 })),
  saveNoteDoc: vi.fn(async () => ({ version: 2 })),
  patchNoteMeta: vi.fn(async () => {}),
  reflectSaved: vi.fn(),
  clearError: vi.fn(),
  ...over,
})

const mount = (over = {}) => {
  nb.current = hook(over)
  return render(<NotesView />)
}

const openFirstNote = () => {
  const r = mount()
  fireEvent.click(screen.getByText('Fox rig notes'))
  return r
}

describe('the note list', () => {
  it('a row has no fill of its own and carries the selected state as an attribute', () => {
    const { container } = mount()
    const row = container.querySelector('.dash-note-row')
    expect(row.getAttribute('data-selected')).toBe('false')
    fireEvent.click(row)
    expect(container.querySelector('.dash-note-row').getAttribute('data-selected')).toBe('true')
  })

  it('🚨 the selected treatment is a rule, not a swap — the row keeps its class either way', () => {
    // It used to swap the SURFACE from near-white to near-black and drop the
    // 1px border with it, so every line in the row moved a pixel on selection
    // (review D21, alignment 10).
    const { container } = mount()
    const row = container.querySelector('.dash-note-row')
    const before = row.className
    fireEvent.click(row)
    expect(container.querySelector('.dash-note-row').className).toBe(before)
  })

  it('the subject is a Badge and the date is the caption, not two more type objects', () => {
    const { container } = mount()
    const row = container.querySelector('.dash-note-row')
    expect(within(row).getByText('Rigging').className).toContain('ui-badge')
    expect(row.querySelector('.dash-note-date').textContent).toMatch(/Sep 10, 2026/)
  })

  it('loading and empty are two different pictures, and neither is the other', () => {
    // Scoped to the LIST: the editor pane always shows its own "no note
    // selected" EmptyState, which is a third, correct picture.
    const list = (r) => r.container.querySelector('.dash-notes-list')
    const l = mount({ notes: [], loading: true })
    expect(list(l).querySelector('.ui-skeleton-rows')).not.toBeNull()
    expect(list(l).querySelector('.ui-empty')).toBeNull()
    cleanup()
    const e = mount({ notes: [] })
    expect(list(e).querySelector('.ui-empty')).not.toBeNull()
    expect(list(e).querySelector('.ui-skeleton-rows')).toBeNull()
    expect(list(e).querySelector('.ui-empty').textContent).not.toMatch(/loading/i)
  })

  it('the cloud gate is an EmptyState, the same one as everywhere else', () => {
    const { container } = mount({ cloudReady: false })
    expect(container.querySelector('.ui-empty')).not.toBeNull()
    expect(screen.getByText('Notes need the cloud')).toBeTruthy()
  })

  it('New note is the one filled control in the column', () => {
    const { container } = mount()
    const filled = [...container.querySelectorAll('.dash-notes-list .ui-btn')]
      .filter((b) => b.getAttribute('data-variant') === 'primary')
    expect(filled.map((b) => b.textContent.trim())).toEqual(['New note'])
  })
})

describe('the editor chrome', () => {
  it('the note title is the page’s heading, not another form field', () => {
    const { container } = openFirstNote()
    const title = container.querySelector('.dash-note-title')
    expect(title).not.toBeNull()
    expect(title.value).toBe('Fox rig notes')
    // …and the metadata sits under it, at its own size.
    expect(container.querySelector('.dash-note-meta')).not.toBeNull()
  })

  it('the format bar is three groups of the kit’s IconButton, with aria-pressed', () => {
    const { container } = openFirstNote()
    expect(container.querySelectorAll('.dash-format-group')).toHaveLength(3)
    const btns = [...container.querySelectorAll('.dash-format-bar .ui-iconbtn')]
    expect(btns).toHaveLength(7)
    // 🚨 An earlier cut hand-rolled these seven and lost `aria-pressed` with
    // the kit component (review round 1, finding 4).
    expect(btns.every((b) => b.hasAttribute('aria-label'))).toBe(true)
    expect(btns.map((b) => b.getAttribute('title'))).toEqual([
      'Heading 1', 'Heading 2', 'Bullet list', 'Bold', 'Underline',
      'Add / edit link', 'Remove link',
    ])
    // Remove link recedes; it is the only one that does.
    expect(container.querySelectorAll('.dash-tb-quiet')).toHaveLength(1)
  })

  it('the save state is one element with a named state, not three inks in a ternary', () => {
    const { container } = openFirstNote()
    const s = container.querySelector('.dash-save-state')
    expect(s.getAttribute('data-state')).toBe('saved')
    expect(s.textContent).toBe('Saved')
  })

  it('the date field carries the dark colour-scheme class', () => {
    // Without it Chromium opens the native calendar in light chrome — a
    // near-white floating panel on a dark page, which C9 forbids outright
    // (review round 1, finding 2).
    const { container } = openFirstNote()
    expect(container.querySelector('input[type="date"]').className).toContain('dash-date')
  })
})

describe('🚨 the two regressions review round 1 found', () => {
  it('Escape on the date field does NOT write', () => {
    const { container } = openFirstNote()
    const date = container.querySelector('input[type="date"]')
    nb.current.patchNoteMeta.mockClear()
    // The kit's Input reverts by CALLING onChange with the focus-time value,
    // so on this field Escape used to issue a PATCH.
    fireEvent.focus(date)
    fireEvent.keyDown(date, { key: 'Escape' })
    expect(nb.current.patchNoteMeta).not.toHaveBeenCalled()
  })

  it('a real date pick still writes immediately', () => {
    const { container } = openFirstNote()
    const date = container.querySelector('input[type="date"]')
    nb.current.patchNoteMeta.mockClear()
    fireEvent.change(date, { target: { value: '2026-10-02' } })
    expect(nb.current.patchNoteMeta).toHaveBeenCalledWith('n1', { note_date: '2026-10-02' })
  })

  it('Escape closes the subject rename row, which is otherwise a dead end', () => {
    const { container } = mount()
    fireEvent.click(screen.getByTitle('Manage subjects'))
    // Two subjects, so two Rename triggers.
    fireEvent.click(screen.getAllByTitle('Rename')[0])
    expect(container.querySelector('input[aria-label="Rename Rigging"]')).not.toBeNull()
    fireEvent.keyDown(container.querySelector('input[aria-label="Rename Rigging"]'), { key: 'Escape' })
    // 🚨 The kit's Input swallows Escape and stops it propagating, so this
    // only works from a CAPTURE handler on the row.
    expect(container.querySelector('input[aria-label="Rename Rigging"]')).toBeNull()
  })

  it('Escape closes the link panel', () => {
    const { container } = openFirstNote()
    fireEvent.click(screen.getByTitle('Add / edit link'))
    expect(container.querySelector('.dash-link-panel')).not.toBeNull()
    fireEvent.keyDown(container.querySelector('input[aria-label="Link URL"]'), { key: 'Escape' })
    expect(container.querySelector('.dash-link-panel')).toBeNull()
  })
})

describe('W9: deleting a note asks in the app, not in Windows', () => {
  it('raises the Dialog and deletes nothing until it is confirmed', () => {
    const spy = vi.spyOn(window, 'confirm')
    const { container } = openFirstNote()
    fireEvent.click(screen.getByTitle('Delete note'))
    expect(spy).not.toHaveBeenCalled()
    expect(document.querySelector('.ui-dialog')).not.toBeNull()
    expect(nb.current.deleteNote).not.toHaveBeenCalled()
    // The warning the old confirm carried is still said, word for word.
    expect(document.body.textContent).toMatch(/Notes have no trash/)
    fireEvent.click(within(document.querySelector('.ui-dialog')).getByRole('button', { name: 'Delete note' }))
    expect(nb.current.deleteNote).toHaveBeenCalledWith('n1')
    expect(container.querySelector('.ui-dialog')).toBeNull()
    spy.mockRestore()
  })

  it('cancel deletes nothing', () => {
    openFirstNote()
    fireEvent.click(screen.getByTitle('Delete note'))
    fireEvent.click(within(document.querySelector('.ui-dialog')).getByRole('button', { name: 'Cancel' }))
    expect(nb.current.deleteNote).not.toHaveBeenCalled()
    expect(document.querySelector('.ui-dialog')).toBeNull()
  })
})
