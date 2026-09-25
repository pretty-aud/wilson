/** @vitest-environment jsdom */
// =============================================================================
// Lane B4, mounted: FileManager on the kit (surface 2). What it DOES — the
// table and the gallery the Tabs switch, every control named for its file,
// the W9 delete question on the kit Dialog in <body>, and the notes editor's
// own Escape — not how its source reads.
// =============================================================================

import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { _resetOverlaysForTests } from '../../../ui/overlay'

vi.mock('../../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))
vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))
const rabbit = vi.hoisted(() => ({ current: null }))

const { default: FileManager } = await import('../components/FileManager')

let realFetch
beforeAll(() => {
  realFetch = globalThis.fetch
  globalThis.fetch = vi.fn(() => Promise.reject(new Error('no network in this test')))
})
afterAll(() => { globalThis.fetch = realFetch })
afterEach(() => { cleanup(); _resetOverlaysForTests() })

const CLOUD = [
  { id: 'f1', name: 'brief.pdf', asset_id: 'a1', size_bytes: 2048, uploaded_at: '2026-09-19T10:00:00Z', storage_provider: 'supabase' },
  { id: 'f2', name: 'cut.mp4', asset_id: 'a1', size_bytes: 5_000_000, uploaded_at: '2026-09-18T10:00:00Z', storage_provider: 'supabase' },
  { id: 'f3', name: 'other.pdf', asset_id: 'a2', size_bytes: 10, uploaded_at: '2026-09-17T10:00:00Z' },
]
const cloud = (over = {}) => {
  const ctx = {
    supportsManagedFiles: false,
    files: CLOUD,
    thumbnailUrls: async () => new Map(),
    deleteFile: vi.fn(async () => {}),
    ...over,
  }
  rabbit.current = ctx
  return ctx
}

describe('FileManager — on the kit', () => {
  it('draws the kit Table with this asset\'s files only, the size a numeric cell', () => {
    cloud()
    const { container } = render(<FileManager assetId="a1" projectId="p" mode="full" />)
    const table = container.querySelector('table.ui-table')
    expect(table).not.toBeNull()
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2)
    expect([...table.querySelectorAll('th')].map((th) => th.textContent)).toEqual(
      ['Preview', 'Name', 'Version', 'Size', 'Date', 'Actions'])
    expect([...table.querySelectorAll('td[data-numeric="true"]')].map((td) => td.textContent)).toEqual(['2.0 KB', '4.8 MB'])
    // A cloud row has no version: an em dash, never "--" (R4-19).
    expect(container.textContent).not.toMatch(/--/)
  })

  it('Add files is the kit primary, and the view switch is the kit Tabs over a named panel', () => {
    cloud()
    const { container } = render(<FileManager assetId="a1" projectId="p" mode="full" />)
    const add = screen.getByRole('button', { name: 'Add files' })
    expect(add.className).toContain('ui-btn')
    expect(add.getAttribute('data-variant')).toBe('primary')
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Table', 'Gallery'])
    const panel = screen.getByRole('tabpanel')
    expect(tabs[0].getAttribute('aria-controls')).toBe(panel.id)
    fireEvent.click(tabs[1])
    expect(container.querySelector('[data-file-view="gallery"]')).not.toBeNull()
    expect(container.querySelector('table')).toBeNull()
    // The gallery still draws both thumbnails through the signed map (the
    // wiring suite counts the two render sites).
    expect(container.querySelectorAll('.rb-fm-card')).toHaveLength(2)
  })

  it('every icon button is named for its file; a video tile is the play control', () => {
    cloud()
    render(<FileManager assetId="a1" projectId="p" mode="full" />)
    expect(screen.getByRole('button', { name: 'Download brief.pdf' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete cut.mp4' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Play cut.mp4' })).toBeTruthy()
    for (const b of screen.getAllByRole('button')) expect(b.getAttribute('aria-label') || b.title || b.textContent.trim()).toBeTruthy()
  })

  it('W9: Delete asks on the kit Dialog in <body>; Escape answers only it; Delete deletes', async () => {
    const ctx = cloud()
    const { container } = render(<FileManager assetId="a1" projectId="p" mode="full" />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete brief.pdf' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete file' })
    // Portalled: not inside the manager (the hosts centre with a transform).
    expect(container.contains(dialog)).toBe(false)
    expect(dialog.textContent).toContain('Delete "brief.pdf"? It can be restored by an admin.')
    expect(document.activeElement.textContent).toBe('Cancel')
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ctx.deleteFile).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete brief.pdf' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete' })) })
    expect(ctx.deleteFile).toHaveBeenCalledWith('f1')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('an empty asset says so with the kit EmptyState, in sentence case', () => {
    cloud()
    render(<FileManager assetId="nothing" projectId="p" mode="full" />)
    const empty = screen.getByRole('status')
    expect(empty.textContent).toContain('No files yet')
    expect(empty.textContent).not.toMatch(/--/)
  })
})

describe('FileManager — the managed notes editor owns its Escape', () => {
  it('Escape cancels the note and MARKS the key handled, so a dialog around it stands down', () => {
    rabbit.current = { supportsManagedFiles: true, updateManagedFile: vi.fn(async () => {}) }
    const files = [{ id: 'm1', stored_name: 'take_v001.mov', asset_id: 'a1', size_bytes: 10, notes: '' }]
    render(<FileManager files={files} assetId="a1" projectId="p" mode="full" />)
    fireEvent.click(screen.getByRole('button', { name: 'Add notes…' }))
    const note = screen.getByRole('textbox', { name: 'Notes for take_v001.mov' })
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => { note.dispatchEvent(ev) })
    expect(ev.defaultPrevented).toBe(true)
    expect(screen.queryByRole('textbox', { name: 'Notes for take_v001.mov' })).toBeNull()
  })
})
