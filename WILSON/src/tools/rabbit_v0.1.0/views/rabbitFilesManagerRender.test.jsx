/** @vitest-environment jsdom */
// =============================================================================
// Lane B4, mounted: FileManager on the kit (surface 2). What it DOES — the
// table and the gallery the Tabs switch, every control named for its file,
// the W9 delete question on the kit Dialog in <body>, and the notes editor's
// own Escape — not how its source reads.
// =============================================================================

import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react'
import { _resetOverlaysForTests } from '../../../ui/overlay'

vi.mock('../../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))
vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))
// P1: the storage choice, read once by the empty state (a NAS company's
// sentence). Refused by default, as the unmocked read is here (no client).
const storage = vi.hoisted(() => ({ cached: vi.fn(() => Promise.reject(new Error('no storage read in this test'))) }))
vi.mock('../../../cloud/workspaceStorage', async (importOriginal) => ({
  ...(await importOriginal()),
  getWorkspaceStorageCached: (...a) => storage.cached(...a),
}))
const rabbit = vi.hoisted(() => ({ current: null }))

const { default: FileManager } = await import('../components/FileManager')
const { SERVER_MEDIA_SENTENCE } = await import('../storage')

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
    // The two unlabelled columns are named for a screen reader only, as every
    // other table's actions column (B4c review round two: ACTIONS showed).
    expect([...table.querySelectorAll('th')].filter((th) => th.querySelector('.ui-th-label > .sr-only')).map((th) => th.textContent))
      .toEqual(['Preview', 'Actions'])
    // Its scroller carries the name the asset popup frames it by.
    expect(table.parentElement.matches('.ui-table-scroll.rb-fm-scroll')).toBe(true)
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

// =============================================================================
// P1 (night 4): the s3 arm — an s3 row's preview is signed in the company's
// own bucket (`thumbnailUrls(keys, { provider: 's3' })`), merged with the
// Petal batch without either erasing the other, renewed while on screen; and
// a NAS company's empty panel says where its media is.
// =============================================================================
describe('FileManager — previews on the company\'s own storage (P1)', () => {
  const P = (n) => ({ id: `p${n}`, name: `petal${n}.png`, asset_id: 'a1', size_bytes: 10, uploaded_at: '2026-10-01T10:00:00Z', storage_provider: 'supabase', thumbnail_url: `projects/x/assets/a1/${n}-petal.png.jpg` })
  const S = (n) => ({ id: `s${n}`, name: `bucket${n}.png`, asset_id: 'a1', size_bytes: 10, uploaded_at: '2026-10-02T10:00:00Z', storage_provider: 's3', thumbnail_url: `projects/x/assets/a1/${n}-bucket.png.jpg` })
  const srcs = (container) => [...container.querySelectorAll('img.rb-thumb-img')].map((i) => i.getAttribute('src')).sort()
  const signer = ({ refuse = [], s3Delay = 0, petalDelay = 0, s3Answer = null } = {}) => vi.fn(async (keys, opts) => {
    const s3 = opts?.provider === 's3'
    await new Promise((r) => setTimeout(r, s3 ? s3Delay : petalDelay))
    const given = s3 && s3Answer ? s3Answer() : null
    if (given) return given
    return new Map(keys.filter((k) => !refuse.includes(k)).map((k) => [k, `${s3 ? 'https://bucket.example/' : 'https://petal.example/'}${k}`]))
  })
  afterEach(() => { vi.useRealTimers(); storage.cached.mockReset(); storage.cached.mockRejectedValue(new Error('no storage read in this test')) })

  it('signs s3 rows in the company\'s bucket and the rest on Petal, and neither answer erases the other, whichever lands last', async () => {
    for (const [s3Delay, petalDelay] of [[0, 30], [30, 0]]) {
      const thumbnailUrls = signer({ s3Delay, petalDelay })
      cloud({ files: [P(1), S(1), S(2)], thumbnailUrls })
      const { container, unmount } = render(<FileManager assetId="a1" projectId="p" mode="full" />)
      await waitFor(() => expect(srcs(container)).toHaveLength(3))
      expect(srcs(container)).toEqual([
        'https://bucket.example/projects/x/assets/a1/1-bucket.png.jpg',
        'https://bucket.example/projects/x/assets/a1/2-bucket.png.jpg',
        'https://petal.example/projects/x/assets/a1/1-petal.png.jpg',
      ])
      const asks = thumbnailUrls.mock.calls.map(([keys, opts]) => [keys, opts?.provider ?? 'petal'])
      expect(asks).toEqual([
        [['projects/x/assets/a1/1-petal.png.jpg'], 'petal'],
        [['projects/x/assets/a1/1-bucket.png.jpg', 'projects/x/assets/a1/2-bucket.png.jpg'], 's3'],
      ])
      unmount()
    }
  })

  it('a key the bucket\'s signer refused is the file-type icon', async () => {
    cloud({ files: [S(1), S(2)], thumbnailUrls: signer({ refuse: ['projects/x/assets/a1/2-bucket.png.jpg'] }) })
    const { container } = render(<FileManager assetId="a1" projectId="p" mode="full" />)
    await waitFor(() => expect(srcs(container)).toHaveLength(1))
    expect(container.querySelectorAll('.rb-thumb-icon')).toHaveLength(1)
  })

  it('asks the bucket again every five minutes while s3 rows are on screen, and a failed renewal keeps the drawn tiles', async () => {
    vi.useFakeTimers()
    let answer = null
    const thumbnailUrls = signer({ s3Answer: () => answer })
    cloud({ files: [P(1), S(1)], thumbnailUrls })
    const { container } = render(<FileManager assetId="a1" projectId="p" mode="full" />)
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    expect(srcs(container)).toHaveLength(2)
    const s3Asks = () => thumbnailUrls.mock.calls.filter(([, o]) => o?.provider === 's3').length
    expect(s3Asks()).toBe(1)
    answer = new Map() // the renewal fails (RabbitProvider answers an empty map)
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 10) })
    expect(s3Asks()).toBe(2)
    expect(srcs(container)).toHaveLength(2) // nothing drawn was blanked
    // The Petal batch is not re-signed by the s3 timer.
    expect(thumbnailUrls.mock.calls.filter(([, o]) => !o?.provider)).toHaveLength(1)
  })

  it('asks again at once when the tab comes back into view', async () => {
    const thumbnailUrls = signer()
    cloud({ files: [S(1)], thumbnailUrls })
    render(<FileManager assetId="a1" projectId="p" mode="full" />)
    await waitFor(() => expect(thumbnailUrls).toHaveBeenCalledTimes(1))
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await waitFor(() => expect(thumbnailUrls).toHaveBeenCalledTimes(2))
    act(() => { window.dispatchEvent(new Event('online')) })
    await waitFor(() => expect(thumbnailUrls).toHaveBeenCalledTimes(3))
  })

  it('CONTROL: no s3 row, no s3 ask and no timer', async () => {
    const thumbnailUrls = signer()
    cloud({ files: [P(1)], thumbnailUrls })
    render(<FileManager assetId="a1" projectId="p" mode="full" />)
    await waitFor(() => expect(thumbnailUrls).toHaveBeenCalledTimes(1))
    expect(thumbnailUrls.mock.calls[0][1]).toBeUndefined()
  })

  it('a company that keeps its media on its own server: the empty panel says where it is', async () => {
    storage.cached.mockReset()
    storage.cached.mockResolvedValue({ mode: 'byos', provider: 'network', root_path: '\\\\nas\\projects' })
    cloud({ files: [], adapterMode: 'supabase' })
    const { container } = render(<FileManager assetId="a1" projectId="p" mode="full" />)
    expect(await screen.findByText(SERVER_MEDIA_SENTENCE)).toBeTruthy()
    expect(container.querySelector('[data-fm-empty="server"]')).not.toBeNull()
  })

  it.each([
    ['Petal', null],
    ['a retained, inactive NAS', { mode: 'central', provider: 'network', root_path: '\\\\nas\\projects' }],
    ['a bucket', { mode: 'byos', provider: 's3' }],
  ])('CONTROL: on %s the empty panel keeps its words', async (_label, row) => {
    storage.cached.mockReset()
    storage.cached.mockResolvedValue(row)
    cloud({ files: [], adapterMode: 'supabase' })
    const { container } = render(<FileManager assetId="a1" projectId="p" mode="full" />)
    await waitFor(() => expect(storage.cached).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.getByText('Click “Add files” to get started.')).toBeTruthy()
    expect(container.querySelector('[data-fm-empty="none"]')).not.toBeNull()
  })

  it('CONTROL: Drive (any backend but the cloud) never asks (round 1, finding 6)', async () => {
    storage.cached.mockReset()
    storage.cached.mockResolvedValue({ mode: 'byos', provider: 'network' })
    cloud({ files: [], adapterMode: 'google_drive' })
    render(<FileManager assetId="a1" projectId="p" mode="full" />)
    await act(async () => {})
    expect(storage.cached).not.toHaveBeenCalled()
  })

  it('CONTROL: the Local Server backend lists the files themselves and never asks', async () => {
    storage.cached.mockReset()
    storage.cached.mockResolvedValue({ mode: 'byos', provider: 'network' })
    cloud({ files: [], supportsManagedFiles: true, managedFiles: [] })
    render(<FileManager assetId="a1" projectId="p" mode="full" />)
    await act(async () => {})
    expect(storage.cached).not.toHaveBeenCalled()
  })
})
