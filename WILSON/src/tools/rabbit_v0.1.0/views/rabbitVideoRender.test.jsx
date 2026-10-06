/** @vitest-environment jsdom */
// =============================================================================
// Lane B4c, mounted: surface 5 — VideoPreview on the kit Dialog, portalled
// into <body>, and FileThumbnail on the lane's sheet. What they DO — the
// player named by its file, every state's words, its backdrop's press rule,
// its Escape taken on the modal stack inside a kit Dialog host and inside the
// asset popup (whose layer guard is gone); the tile's classes with no inline
// colour; FileManager's gallery cards named for their files — not how their
// source reads.
// =============================================================================

import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'
import { _resetOverlaysForTests } from '../../../ui/overlay'
import { Dialog } from '../../../ui/Dialog'

vi.mock('../../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))
vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))
vi.mock('../../../permissions/usePermissions', () => ({ usePermissions: () => perms.current }))
// The asset popup's hooks, as rabbitAssetsRender.test.jsx's: ONE object each
// for the whole run — the popup loads templates in an effect keyed on
// `loadProjectTemplates`, and a new function every render loads them forever.
const perms = vi.hoisted(() => ({ current: { role: 'admin', ready: true, can: () => true } }))
const templates = vi.hoisted(() => ({ api: { templates: [], loadProjectTemplates: async () => [] } }))
const team = vi.hoisted(() => ({ current: { members: [] } }))
vi.mock('../../../components/TeamMembers/useTeamMembers', () => ({ useTeamMembers: () => team.current }))
vi.mock('../../../components/TaskTemplates/useTaskTemplates', () => ({ useTaskTemplates: () => templates.api }))
const rabbit = vi.hoisted(() => ({ current: null }))

const { default: VideoPreview } = await import('../components/VideoPreview')
const { default: FileThumbnail } = await import('../components/FileThumbnail')
const { default: FileManager } = await import('../components/FileManager')
const { default: ProjectAssetsView } = await import('./ProjectAssetsView')

// FileManager asks the desktop route for video support on mount.
let realFetch
beforeAll(() => {
  realFetch = globalThis.fetch
  globalThis.fetch = vi.fn(() => Promise.reject(new Error('no network in this test')))
})
afterAll(() => { globalThis.fetch = realFetch })
afterEach(() => { cleanup(); _resetOverlaysForTests(); localStorage.clear() })

// The walk proves the preview open by these words: they must not move.
const OWN_BUCKET = 'Playback isn\'t available yet for media stored in your own bucket.'
const CUT = { id: 'f2', name: 'cut.mp4', asset_id: 'a1', size_bytes: 5_000_000, uploaded_at: '2026-09-18T10:00:00Z', storage_provider: 'supabase' }
const CLOUD = [
  { id: 'f1', name: 'brief.pdf', asset_id: 'a1', size_bytes: 2048, uploaded_at: '2026-09-19T10:00:00Z', storage_provider: 'supabase' },
  CUT,
]
const escape = () => fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })

// The player alone. `fileUrl` is the provider's signer: null is "this backend
// cannot mint a playable URL" (the fixtures' answer, and an s3 row's).
function preview({ file = CUT, managed = false, fileUrl = async () => null, onOpenExternally } = {}) {
  rabbit.current = { fileUrl }
  const onClose = vi.fn()
  const utils = render(
    <VideoPreview file={file} projectId="p1" managed={managed} onClose={onClose} onOpenExternally={onOpenExternally} />,
  )
  return { onClose, ...utils }
}

describe('VideoPreview — the player on the kit Dialog', () => {
  it('is the kit Dialog in <body>, named by the file as stored (never re-cased), at the form width; the own-bucket sentence keeps its words', async () => {
    const { container } = preview({ file: { id: 'm9', name: 'take.mov', stored_name: 'Take_03_v002.MOV' } })
    const dialog = screen.getByRole('dialog', { name: 'Take_03_v002.MOV' })
    expect(dialog.className).toBe('ui-dialog rb-vid-dialog')
    expect(dialog.getAttribute('data-width')).toBe('form')
    // Portalled: its hosts centre with a transform.
    expect(dialog.closest('.ui-dialog-backdrop').parentElement).toBe(document.body)
    expect(container.contains(dialog)).toBe(false)
    expect(dialog.querySelector('.ui-dialog-title').textContent).toBe('Take_03_v002.MOV')
    const words = await within(dialog).findByText(OWN_BUCKET)
    expect(words.className).toBe('rb-vid-detail')
    // A cloud row has nothing on this machine to reveal: no control is offered.
    expect(within(dialog).queryByRole('button', { name: 'Show in folder' })).toBeNull()
    // The Close is the kit's, with the name the old one had.
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeTruthy()
    for (const el of dialog.querySelectorAll('[style]')) expect(el.getAttribute('style')).not.toMatch(/color/)
  })

  it('while the URL is minted it shows the kit spinner under the title that names the file (R4-40)', () => {
    preview({ fileUrl: () => new Promise(() => {}) })
    const dialog = screen.getByRole('dialog', { name: 'cut.mp4' })
    expect(within(dialog).getByRole('status', { name: 'Loading' }).className).toContain('ui-spinner')
  })

  it('a playable URL is the <video> it always was — controls, autoplay, crossorigin — and only its box is the lane\'s', async () => {
    preview({ fileUrl: async () => 'https://signed.example/cut.mp4' })
    const dialog = screen.getByRole('dialog', { name: 'cut.mp4' })
    const video = await waitFor(() => {
      const v = dialog.querySelector('video')
      expect(v).not.toBeNull()
      return v
    })
    expect(video.getAttribute('src')).toBe('https://signed.example/cut.mp4')
    expect(video.hasAttribute('controls')).toBe(true)
    expect(video.hasAttribute('autoplay')).toBe(true)
    expect(video.getAttribute('crossorigin')).toBe('anonymous')
    expect(video.className).toBe('rb-vid-player')
    expect(video.hasAttribute('style')).toBe(false)
  })

  it('a managed file that will not decode names its format and offers Show in folder, the kit primary: it reveals the file and closes', async () => {
    const onOpenExternally = vi.fn()
    const { onClose } = preview({ managed: true, onOpenExternally, file: { id: 'm1', stored_name: 'A001_v001.mov', extension: '.mov' } })
    const dialog = screen.getByRole('dialog', { name: 'A001_v001.mov' })
    const video = await waitFor(() => {
      const v = dialog.querySelector('video')
      expect(v).not.toBeNull()
      return v
    })
    fireEvent.error(video)
    expect(within(dialog).getByText('Preview isn\'t available for this format. Open it from its folder instead.')).toBeTruthy()
    const show = within(dialog).getByRole('button', { name: 'Show in folder' })
    expect(show.className).toContain('ui-btn')
    expect(show.getAttribute('data-variant')).toBe('primary')
    fireEvent.click(show)
    expect(onOpenExternally).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the backdrop closes it on a press that BEGINS there; a scrub-drag that began inside and ends there does not (dismissOnBackdrop, the kit\'s rule)', () => {
    const { onClose } = preview()
    const dialog = screen.getByRole('dialog', { name: 'cut.mp4' })
    const backdrop = dialog.closest('.ui-dialog-backdrop')
    fireEvent.mouseDown(dialog.querySelector('.rb-vid-stage'))
    fireEvent.mouseUp(backdrop)
    fireEvent.click(backdrop)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.mouseDown(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a click inside the player stays inside it, as the hand-rolled panel\'s did (React would carry it through the portal)', () => {
    rabbit.current = { fileUrl: async () => null }
    const hostClick = vi.fn()
    render(
      <div onClick={hostClick}>
        <VideoPreview file={CUT} projectId="p1" managed={false} onClose={() => {}} />
      </div>,
    )
    fireEvent.click(screen.getByRole('dialog', { name: 'cut.mp4' }).querySelector('.rb-vid-stage'))
    expect(hostClick).not.toHaveBeenCalled()
  })
})

describe('VideoPreview in its hosts — ONE Escape closes the player and never the host', () => {
  it('opened from FileManager inside a kit Dialog host', async () => {
    rabbit.current = { supportsManagedFiles: false, files: CLOUD, thumbnailUrls: async () => new Map(), fileUrl: async () => null }
    const hostClose = vi.fn()
    render(
      <Dialog title="Storyboards" onClose={hostClose}>
        <FileManager assetId="a1" projectId="p1" mode="full" />
      </Dialog>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Play cut.mp4' }))
    const player = screen.getByRole('dialog', { name: 'cut.mp4' })
    expect(await within(player).findByText(OWN_BUCKET)).toBeTruthy()
    escape()
    expect(screen.queryByRole('dialog', { name: 'cut.mp4' })).toBeNull()
    expect(hostClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Storyboards' })).toBeTruthy()
    escape()
    expect(hostClose).toHaveBeenCalledTimes(1)
  })

  it('opened from the asset popup, whose layer guard is gone: the player closes and the popup stays; the next Escape closes the popup', async () => {
    rabbit.current = {
      project: { id: 'p1', name: 'Salt Hours' },
      assets: [{ id: 'a1', project_id: 'p1', name: 'Storyboards', type: 'storyboard', status: 'approved', phase_id: null, sort_order: 0 }],
      phases: [],
      tasks: [],
      myProjectRole: 'manager',
      projectIsStaffed: false,
      updateAsset: vi.fn(),
      deleteAsset: vi.fn(),
      deleteAssets: vi.fn(async () => {}),
      selectAssetStatusWarning: () => false,
      // Both lists, or FileManager re-keys an effect every render
      // (rabbitAssetsRender.test.jsx's note).
      files: CLOUD,
      managedFiles: [],
      thumbnailUrls: async () => new Map(),
      fileUrl: async () => null,
    }
    render(<ProjectAssetsView />)
    fireEvent.click(screen.getByRole('button', { name: 'View asset details' }))
    const popup = screen.getByRole('dialog', { name: 'Storyboards' })
    fireEvent.click(within(popup).getByRole('button', { name: 'Play cut.mp4' }))
    const player = screen.getByRole('dialog', { name: 'cut.mp4' })
    expect(popup.contains(player)).toBe(false)
    expect(await within(player).findByText(OWN_BUCKET)).toBeTruthy()
    escape()
    expect(screen.queryByRole('dialog', { name: 'cut.mp4' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Storyboards' })).toBeTruthy()
    escape()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('FileThumbnail — on the lane\'s sheet', () => {
  it('the large tile: the lane classes, the extension a label in no inline colour, the glyph hidden from the reader', () => {
    const { container } = render(<FileThumbnail file={{ id: 'f1', name: 'brief.pdf' }} size="large" />)
    const tile = container.querySelector('.rb-thumb-tile')
    expect(tile.getAttribute('data-size')).toBe('large')
    const ext = tile.querySelector('.rb-thumb-ext')
    expect(ext.textContent).toBe('PDF')
    expect(ext.hasAttribute('style')).toBe(false)
    expect(tile.querySelector('svg.rb-thumb-icon').getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelectorAll('[style]')).toHaveLength(0)
  })

  it('a picture is the lane\'s lazy <img>, named by the file; a failed URL falls back to the glyph (no label at the small size) and a NEW one brings the picture back', () => {
    const file = { id: 'f3', name: 'board_01.png' }
    const { container, rerender } = render(<FileThumbnail file={file} size="small" thumbnailUrl="https://signed.example/a.jpg" />)
    const img = container.querySelector('img.rb-thumb-img')
    expect(img.getAttribute('alt')).toBe('board_01.png')
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(img.closest('.rb-thumb-tile').getAttribute('data-size')).toBe('small')
    fireEvent.error(img)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.rb-thumb-icon')).not.toBeNull()
    expect(container.querySelector('.rb-thumb-ext')).toBeNull()
    rerender(<FileThumbnail file={file} size="small" thumbnailUrl="https://signed.example/b.jpg" />)
    expect(container.querySelector('img.rb-thumb-img').getAttribute('src')).toBe('https://signed.example/b.jpg')
    expect(container.querySelectorAll('[style]')).toHaveLength(0)
  })

  // The video carries a poster and the PDF its extension label: the content a
  // title loses to. Before B4c's review round one the video's tile was named
  // "animatic.mp4" (the poster's alt) and the PDF's "PDF".
  const GALLERY = [
    { id: 'g1', name: 'board_01.png', asset_id: 'a1', size_bytes: 10, uploaded_at: '2026-09-20T10:00:00Z', storage_provider: 'supabase', thumbnail_url: 'thumbs/g1.jpg' },
    { id: 'g2', name: 'board_02.png', asset_id: 'a1', size_bytes: 10, uploaded_at: '2026-09-19T10:00:00Z', storage_provider: 'supabase', thumbnail_url: 'thumbs/g2.jpg' },
    { id: 'g3', name: 'animatic.mp4', asset_id: 'a1', size_bytes: 10, uploaded_at: '2026-09-18T10:00:00Z', storage_provider: 'supabase', thumbnail_url: 'thumbs/g3.jpg' },
    { id: 'g4', name: 'brief.pdf', asset_id: 'a1', size_bytes: 10, uploaded_at: '2026-09-17T10:00:00Z', storage_provider: 'supabase' },
  ]
  const signed = async (keys) => new Map(keys.map((k) => [k, `https://signed.example/${k}`]))

  it('FileManager\'s gallery: every card control is named — a picture card for its file (the walk\'s two unnamed controls), a video card for what it does — by its ACCESSIBLE name, with a poster and a label present', async () => {
    rabbit.current = { supportsManagedFiles: false, files: GALLERY, thumbnailUrls: signed, fileUrl: async () => null }
    const { container } = render(<FileManager assetId="a1" projectId="p1" mode="full" />)
    fireEvent.click(screen.getByRole('tab', { name: 'Gallery' }))
    await waitFor(() => expect(container.querySelectorAll('.rb-fm-card img')).toHaveLength(3))
    const tiles = [...container.querySelectorAll('.rb-fm-card-media > button')]
    // What a reader hears, not the title attribute: each tile's name is its
    // title's words, and the content that used to win is really there.
    const names = ['board_01.png', 'board_02.png', 'Play animatic.mp4', 'brief.pdf']
    expect(tiles.map((b) => b.title)).toEqual(names)
    names.forEach((name, i) => expect(screen.getByRole('button', { name }), name).toBe(tiles[i]))
    expect(tiles[2].querySelector('img').getAttribute('alt')).toBe('animatic.mp4')
    expect(tiles[3].textContent).toBe('PDF')
    expect(screen.queryByRole('button', { name: 'animatic.mp4' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'PDF' })).toBeNull()
    // The picture and document cards are inert (C1: only a video plays), and still named.
    expect(tiles.map((b) => b.disabled)).toEqual([true, true, false, true])
    for (const b of container.querySelectorAll('.rb-fm-gallery button')) {
      expect(b.getAttribute('aria-label') || b.title || b.textContent.trim()).toBeTruthy()
    }
  })

  it('FileManager\'s table: the play tile over a poster is named for what it does ("Play …"), never by the poster\'s alt', async () => {
    rabbit.current = { supportsManagedFiles: false, files: [GALLERY[2]], thumbnailUrls: signed, fileUrl: async () => null }
    const { container } = render(<FileManager assetId="a1" projectId="p1" mode="full" />)
    await waitFor(() => expect(container.querySelector('.rb-fm-table .rb-fm-play img')).not.toBeNull())
    const tile = container.querySelector('.rb-fm-table .rb-fm-play')
    expect(tile.querySelector('img').getAttribute('alt')).toBe('animatic.mp4')
    expect(screen.getByRole('button', { name: 'Play animatic.mp4' })).toBe(tile)
    expect(screen.queryByRole('button', { name: 'animatic.mp4' })).toBeNull()
  })
})
