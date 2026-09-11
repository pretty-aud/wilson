/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { FolderOpen } from 'lucide-react'
import { EmptyState } from './EmptyState'

afterEach(cleanup)

describe('EmptyState', () => {
  it('renders icon, title, body and the action slot', () => {
    render(
      <EmptyState Icon={FolderOpen} title="No files in this bin" body="Drop files here or add them from the toolbar.">
        <button>Add files</button>
      </EmptyState>,
    )
    const e = screen.getByRole('status')
    expect(e.className).toContain('ui-empty')
    expect(e.querySelector('svg')).not.toBeNull()
    expect(screen.getByText('No files in this bin').className).toContain('ui-empty-title')
    expect(screen.getByText(/Drop files here/).className).toContain('ui-empty-body')
    expect(screen.getByRole('button', { name: 'Add files' }).closest('.ui-empty-actions')).not.toBeNull()
    expect(e.dataset.compact).toBeUndefined()
  })

  it('compact is a data attribute', () => {
    render(<EmptyState title="Nothing" compact />)
    expect(screen.getByRole('status').dataset.compact).toBe('true')
  })

  it('refuses to be the loading picture: a loading string is reported', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<EmptyState title="Loading…" />)
    expect(err).toHaveBeenCalledWith(expect.stringContaining('loading string'))
    err.mockClear()
    render(<EmptyState title="No tasks" body="Everything is done." />)
    expect(err).not.toHaveBeenCalled()
    err.mockRestore()
  })
})
