/** @vitest-environment jsdom */
// =============================================================================
// ProjectFilesTable.legal.test.jsx — post-overhaul S4b, review round 2.
//
// The Projects page lists a Legal file to the people the database gives it to
// (a member never receives the row), because it is the one page where a
// project file is deleted. Its Core box is off and locked with the reason —
// a Legal file is never core (files_legal_not_core_chk) — and Delete works as
// on any file. The CONTROL is an ordinary row beside it.
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

const { default: ProjectFilesTable } = await import('./ProjectFilesTable')
const { LEGAL_NOT_CORE_REASON } = await import('../fileTags')

afterEach(cleanup)

const LEGAL = {
  id: 'L1', name: 'nda.pdf', storage_provider: 'supabase', mime_type: 'application/pdf',
  storage_path: 'projects/3f9b6a52-1c0e-4d7a-9a51-2b8c7d6e5f40/LEGAL/3f9b6a52-1c0e-4d7a-9a51-2b8c7d6e5f40/1-nda.pdf',
  tags: ['legal'], is_core_definer: true, created_at: '2026-10-01T10:00:00Z',
}
const PLAIN = {
  id: 'P1', name: 'brief.pdf', storage_provider: 'supabase', mime_type: 'application/pdf',
  storage_path: 'projects/3f9b6a52-1c0e-4d7a-9a51-2b8c7d6e5f40/project/3f9b6a52-1c0e-4d7a-9a51-2b8c7d6e5f40/1-brief.pdf',
  tags: [], is_core_definer: false, created_at: '2026-10-01T10:00:00Z',
}

describe('a Legal file on the Projects page', () => {
  it('its Core box is off and locked, with the reason; Delete works; an ordinary row beside it is unchanged', () => {
    const onUpdate = vi.fn()
    const onDelete = vi.fn()
    render(<ProjectFilesTable files={[LEGAL, PLAIN]} onUpdate={onUpdate} onDelete={onDelete} />)
    const legalBox = screen.getByLabelText('Core file: nda.pdf')
    expect(legalBox.disabled).toBe(true)
    // Off even if the row says core (a CHECK keeps that from existing; the
    // table must not show it either).
    expect(legalBox.checked).toBe(false)
    expect(legalBox.getAttribute('title')).toBe(LEGAL_NOT_CORE_REASON)
    fireEvent.click(legalBox)
    expect(onUpdate).not.toHaveBeenCalled()

    const plainBox = screen.getByLabelText('Core file: brief.pdf')
    expect(plainBox.disabled).toBe(false)
    expect(plainBox.getAttribute('title')).toBe(null)
    fireEvent.click(plainBox)
    expect(onUpdate).toHaveBeenCalledWith('P1', { is_core_definer: true })

    const deletes = document.querySelectorAll('button[aria-label^="Delete"]')
    expect(deletes.length).toBe(2)
    fireEvent.click(deletes[0])
    expect(onDelete).toHaveBeenCalledWith('L1')
  })
})
