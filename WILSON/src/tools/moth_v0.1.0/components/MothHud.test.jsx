// @vitest-environment jsdom
// MothHud.test.jsx — MO2: the HUD's own parts, mounted on their own. Folder cards (five pinned at most, a sixth
// refused with a sentence, the recent icon shows nothing until pressed), the preview bloom (what it may fetch, what it
// says instead), the time slider (it says what is not recorded), the first visit's three starts, and Settings.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import MothCards, { MAX_PINNED, SIXTH_SENTENCE } from './MothCards.jsx'
import MothBloom, { previewKind, noPreviewReason } from './MothBloom.jsx'
import MothTimeSlider from './MothTimeSlider.jsx'
import MothFirstVisit from './MothFirstVisit.jsx'
import MothSettings, { MothHelp } from './MothSettings.jsx'
import { indexCatalogue } from '../engine/model.js'
import { DEFAULT_APPEARANCE } from '../state/mothAppearance.js'
import { DESKTOP_PREVIEW_SENTENCE } from '../../rabbit_v0.1.0/storage/desktopFileOps.js'

afterEach(() => { cleanup(); vi.useRealTimers() })

const FOLDERS = Array.from({ length: 7 }, (_, i) => ({ id: `d${i}`, parent_id: null, kind: 'custom', slug: `f${i}`, label: `Folder ${i}` }))
const CAT = {
  islands: [{ id: 'p1', title: 'Salt Hours' }],
  folders: { p1: FOLDERS },
  files: { p1: [{ id: 'f1', project_id: 'p1', folder_id: 'd0', name: 'take.mov', tags: [] }] },
}
const INDEX = indexCatalogue(CAT)

describe('MothCards', () => {
  const mount = (extra = {}) => {
    const props = { selectedId: null, index: INDEX, recent: [], onSelect: vi.fn(), onOpenCard: vi.fn(), onDropFile: vi.fn(), onNote: vi.fn(), ...extra }
    const out = render(<MothCards {...props} />)
    return { ...out, props, again: (more) => out.rerender(<MothCards {...props} {...more} />) }
  }
  it('a selected folder shows its card with what is in it; a file or a project shows none', () => {
    const { again } = mount({ selectedId: 'folder:d0' })
    expect(screen.getByRole('region', { name: 'Folder 0' })).toBeTruthy()
    expect(screen.getByText('take.mov')).toBeTruthy()
    again({ selectedId: 'file:f1' })
    expect(screen.queryByRole('region')).toBeNull()
    again({ selectedId: 'project:p1' })
    expect(screen.queryByRole('region')).toBeNull()
  })
  it('five cards pin at most; the sixth is refused with a sentence and the five stay', () => {
    const { props, again } = mount()
    for (let i = 0; i < MAX_PINNED; i++) {
      again({ selectedId: `folder:d${i}` })
      fireEvent.click(screen.getByRole('button', { name: 'Pin this card' }))
    }
    expect(document.querySelectorAll('[data-moth-card="pinned"]')).toHaveLength(MAX_PINNED)
    again({ selectedId: 'folder:d5' })
    fireEvent.click(screen.getByRole('button', { name: 'Pin this card' }))
    expect(props.onNote).toHaveBeenCalledWith(SIXTH_SENTENCE)
    expect(document.querySelectorAll('[data-moth-card="pinned"]')).toHaveLength(MAX_PINNED)
    fireEvent.click(screen.getAllByRole('button', { name: 'Unpin this card' })[0])
    expect(document.querySelectorAll('[data-moth-card="pinned"]')).toHaveLength(MAX_PINNED - 1)
    // Every folder whose card showed is noted among those opened last.
    for (let i = 0; i < MAX_PINNED; i++) expect(props.onOpenCard).toHaveBeenCalledWith(`folder:d${i}`)
  })
  it('a new selection is followed afresh: a shut card comes back for it, and every shown card is noted as opened', () => {
    const { props, again } = mount({ selectedId: 'folder:d0' })
    fireEvent.click(screen.getByRole('button', { name: 'Close this card' }))
    expect(screen.queryByRole('region')).toBeNull()
    again({ selectedId: 'folder:d1' })
    again({ selectedId: 'folder:d0' })
    expect(screen.getByRole('region', { name: 'Folder 0' })).toBeTruthy()
    expect(props.onOpenCard).toHaveBeenCalledWith('folder:d1')
  })
  it('a card closes, and a click on a row selects it', () => {
    const { props } = mount({ selectedId: 'folder:d0' })
    fireEvent.click(screen.getByText('take.mov'))
    expect(props.onSelect).toHaveBeenCalledWith('file:f1')
    fireEvent.click(screen.getByRole('button', { name: 'Close this card' }))
    expect(screen.queryByRole('region')).toBeNull()
  })
  it('the recent icon shows nothing until pressed, then the folders opened last that still show', () => {
    const { props } = mount({ recent: [{ k: 'folder', id: 'd3' }, { k: 'folder', id: 'gone' }] })
    expect(document.querySelector('[data-moth-recent-list]')).toBeNull()
    expect(screen.queryByRole('region')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Folders opened last' }))
    const list = document.querySelector('[data-moth-recent-list]')
    expect(list.textContent).toBe('Folder 3')
    fireEvent.click(screen.getByText('Folder 3'))
    expect(screen.getByRole('region', { name: 'Folder 3' })).toBeTruthy()
    expect(props.onOpenCard).toHaveBeenCalledWith('folder:d3')
  })
  it('a file dropped on a card asks the page to move it there', () => {
    const { props } = mount({ selectedId: 'folder:d1' })
    const card = screen.getByRole('region', { name: 'Folder 1' })
    const data = { types: ['application/x-wilson-moth-file'], getData: () => 'f1' }
    fireEvent.dragOver(card, { dataTransfer: data })
    fireEvent.drop(card, { dataTransfer: data })
    expect(props.onDropFile).toHaveBeenCalledWith('f1', 'folder:d1')
  })
})

describe('MothBloom', () => {
  it('knows what it can preview, from the type and the name', () => {
    expect(previewKind({ mime_type: 'image/png' })).toBe('image')
    expect(previewKind({ mime_type: 'video/mp4' })).toBe('video')
    expect(previewKind({ mime_type: 'text/plain' })).toBe('text')
    expect(previewKind({ mime_type: null, name: 'Notes.MD' })).toBe('text')
    expect(previewKind({ mime_type: 'application/zip', thumbnail_url: 't' })).toBe('image')
    expect(previewKind({ mime_type: 'application/zip' })).toBe('none')
  })
  it('says why a file kept on the office server or one computer is not fetched from a browser', () => {
    expect(noPreviewReason({ storage_provider: 'network_share' }, { onDesktop: false })).toBe(DESKTOP_PREVIEW_SENTENCE)
    expect(noPreviewReason({ storage_provider: 'network_share' }, { onDesktop: true })).toBeNull()
    expect(noPreviewReason({ storage_provider: 'local_server' }, { onDesktop: false })).toMatch(/computer that added it/)
    expect(noPreviewReason({ storage_provider: 'supabase' }, { onDesktop: false })).toBeNull()
  })
  it('a folder blooms with its kind and name and asks for nothing; it fades when the pointer leaves', () => {
    vi.useFakeTimers()
    const adapter = { fileUrl: vi.fn() }
    const node = { kind: 'folder', label: 'Shots' }
    const { rerender } = render(<MothBloom at={{ x: 10, y: 10, r: 4 }} node={node} file={null} adapter={adapter} onDesktop={false} />)
    expect(screen.getByRole('tooltip').textContent).toContain('Shots')
    expect(adapter.fileUrl).not.toHaveBeenCalled()
    rerender(<MothBloom at={null} node={node} file={null} adapter={adapter} onDesktop={false} />)
    expect(screen.getByRole('tooltip').className).toContain('is-leaving')
    act(() => { vi.advanceTimersByTime(300) })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
  it('a file on the office server, from a browser, fetches nothing and says why', () => {
    const adapter = { fileUrl: vi.fn() }
    const file = { id: 'f1', name: 'take.mov', mime_type: 'video/mp4', storage_provider: 'network_share' }
    render(<MothBloom at={{ x: 1, y: 1, r: 1 }} node={{ kind: 'file' }} file={file} adapter={adapter} onDesktop={false} />)
    expect(document.querySelector('[data-moth-bloom-desktop]').textContent).toBe(DESKTOP_PREVIEW_SENTENCE)
    expect(adapter.fileUrl).not.toHaveBeenCalled()
  })
  it('an image asks for its address once and shows it', async () => {
    const adapter = { fileUrl: vi.fn(async () => 'blob:one') }
    const file = { id: 'img-once', name: 'still.png', mime_type: 'image/png', storage_provider: 'supabase' }
    render(<MothBloom at={{ x: 1, y: 1, r: 1 }} node={{ kind: 'file' }} file={file} adapter={adapter} onDesktop={false} />)
    await vi.waitFor(() => expect(document.querySelector('img.moth-bloom-media')?.getAttribute('src')).toBe('blob:one'))
    expect(adapter.fileUrl).toHaveBeenCalledTimes(1)
  })
})

describe('MothTimeSlider', () => {
  const NOW = Date.parse('2026-11-07T12:00:00Z')
  it('says when history is not on this database, or not kept for a project on this computer', () => {
    const { rerender } = render(<MothTimeSlider history={{ available: false }} />)
    expect(screen.getByText('History is not on this database yet.')).toBeTruthy()
    rerender(<MothTimeSlider history={{ available: false, localOnly: true }} />)
    expect(screen.getByText(/not recorded for projects kept only on this computer/)).toBeTruthy()
  })
  it('moves between the floor and now, says what is not recorded, and comes back to now', () => {
    const setAt = vi.fn()
    const floor = NOW - 10 * 86400000
    const { rerender } = render(<MothTimeSlider history={{ available: true, now: NOW, floor, at: null, setAt }} />)
    const range = screen.getByLabelText('Look back')
    expect(Number(range.min)).toBe(floor)
    expect(Number(range.max)).toBe(NOW)
    expect(document.querySelector('[data-moth-time-says]').textContent).toMatch(/^Now\. Not recorded before /)
    fireEvent.change(range, { target: { value: String(NOW - 3 * 86400000) } })
    expect(setAt).toHaveBeenLastCalledWith(NOW - 3 * 86400000)
    // The page holds the time: shown three days back, then dragged to the end, it is now again.
    rerender(<MothTimeSlider history={{ available: true, now: NOW, floor, at: NOW - 3 * 86400000, setAt }} />)
    fireEvent.change(screen.getByLabelText('Look back'), { target: { value: String(NOW) } })
    expect(setAt).toHaveBeenLastCalledWith(null)
    rerender(<MothTimeSlider history={{ available: true, now: NOW, floor, at: NOW - 86400000, setAt, incomplete: true }} />)
    expect(document.querySelector('[data-moth-time-says]').textContent).toMatch(/Looking back changes nothing\..*Only part of this period could be read\./)
    fireEvent.click(screen.getByRole('button', { name: 'Back to now' }))
    expect(setAt).toHaveBeenLastCalledWith(null)
  })
  it('MO3: before the start of the record of notes, typed tags and links, it says so', () => {
    const floor = NOW - 10 * 86400000
    const s3Floor = NOW - 2 * 86400000
    const { rerender } = render(<MothTimeSlider history={{ available: true, now: NOW, floor, s3Floor, at: NOW - 86400000, setAt: () => {} }} />)
    expect(document.querySelector('[data-moth-time-says]').textContent).not.toMatch(/Notes, typed tags and links/)
    rerender(<MothTimeSlider history={{ available: true, now: NOW, floor, s3Floor, at: NOW - 5 * 86400000, setAt: () => {} }} />)
    expect(document.querySelector('[data-moth-time-says]').textContent).toMatch(/Notes, typed tags and links are recorded from .+: they show as they were then\./)
  })
  it('says it is reading when the record begins until it knows', () => {
    render(<MothTimeSlider history={{ available: true, now: NOW, floor: null, at: null, setAt: () => {} }} />)
    expect(document.querySelector('[data-moth-time-says]').textContent).toMatch(/Reading when the record begins/)
  })
  it('shows nothing with no history to give', () => {
    const { container } = render(<MothTimeSlider history={null} />)
    expect(container.textContent).toBe('')
  })
})

describe('MothFirstVisit', () => {
  it('offers three starts; building your own needs at least one kind of dot', () => {
    const onChoose = vi.fn()
    const onClose = vi.fn()
    render(<MothFirstVisit first onChoose={onChoose} onClose={onClose} />)
    fireEvent.click(screen.getByText('Everything by tags'))
    expect(onChoose).toHaveBeenLastCalledWith('q:tags')
    fireEvent.click(screen.getByText('Everything by folders'))
    expect(onChoose).toHaveBeenLastCalledWith('q:folders')
    fireEvent.click(screen.getByText('Build your own'))
    for (const name of ['Projects', 'Folders', 'Files']) fireEvent.click(screen.getByRole('button', { name }))
    expect(screen.getByRole('button', { name: 'Map it' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }))
    fireEvent.click(screen.getByRole('button', { name: 'Map it' }))
    expect(onChoose).toHaveBeenLastCalledWith('unsaved', { nodeKinds: ['task'], edgeKinds: ['lives_in'], layout: 'force' })
  })
  it('offers Tags only with Files, and turning Files off takes Tags with it (MO2a R1-13)', () => {
    const onChoose = vi.fn()
    render(<MothFirstVisit first onChoose={onChoose} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Build your own'))
    fireEvent.click(screen.getByRole('button', { name: 'Tags' }))
    fireEvent.click(screen.getByRole('button', { name: 'Files' }))
    expect(screen.getByRole('button', { name: 'Tags' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Map it' }))
    expect(onChoose).toHaveBeenLastCalledWith('unsaved', { nodeKinds: ['project', 'folder'], edgeKinds: ['lives_in'], layout: 'force' })
  })
  it('the first time it offers Not now; afterwards Cancel', () => {
    const onClose = vi.fn()
    const { rerender } = render(<MothFirstVisit first onChoose={() => {}} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(onClose).toHaveBeenCalled()
    rerender(<MothFirstVisit first={false} onChoose={() => {}} onClose={onClose} />)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })
})

describe('MothSettings', () => {
  it('the light\'s colour, what sizes and colours a dot, and the lighter mode', () => {
    const onChange = vi.fn()
    render(<MothSettings appearance={{ ...DEFAULT_APPEARANCE }} onChange={onChange} calm={false} />)
    const warm = screen.getByRole('radio', { name: 'Warm' })
    expect(warm.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: 'Moonlight' }))
    expect(onChange).toHaveBeenLastCalledWith({ glow: '#9fd3ff' })
    fireEvent.change(screen.getByLabelText('Another colour for the light'), { target: { value: '#ABCDEF' } })
    expect(onChange).toHaveBeenLastCalledWith({ glow: '#abcdef' })
    fireEvent.change(document.querySelector('[data-moth-size-by]'), { target: { value: 'recency' } })
    expect(onChange).toHaveBeenLastCalledWith({ size_by: 'recency' })
    fireEvent.change(document.querySelector('[data-moth-colour-by]'), { target: { value: 'editor' } })
    expect(onChange).toHaveBeenLastCalledWith({ colour_by: 'editor' })
    fireEvent.change(document.querySelector('[data-moth-lighter]'), { target: { value: 'light' } })
    expect(onChange).toHaveBeenLastCalledWith({ light: 'light' })
  })
  it('says when the light holds still, and when nothing is kept', () => {
    render(<MothSettings appearance={{ ...DEFAULT_APPEARANCE, glow: '#123456' }} onChange={() => {}} calm available={false} />)
    expect(screen.getByText(/asks for less motion/)).toBeTruthy()
    expect(screen.getByText(/last for this visit only/)).toBeTruthy()
    expect(screen.getByText('Yours')).toBeTruthy()
  })
  it('Help says what Moth never shows', () => {
    render(<MothHelp />)
    expect(screen.getByText('What Moth never shows')).toBeTruthy()
    expect(screen.getByText(/Invoices, finance and legal files/)).toBeTruthy()
  })
})
