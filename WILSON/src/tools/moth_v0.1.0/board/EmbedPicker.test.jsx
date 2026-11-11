// @vitest-environment jsdom
// EmbedPicker.test.jsx — MO4 boards: "Embed a file". The project's files as Moth lists them, every page; the board's
// own folder and anything the office server could not find left out; a search that narrows by the words typed; a
// pick that hands the file on; Escape (the panel's stack, or the list itself) and a press elsewhere close it.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import EmbedPicker, {
  EMBED_EMPTY, EMBED_FAILED, EMBED_NO_MATCH, EMBED_TITLE, boardFolderSet, embedMoreWords, embeddableFiles, matchFiles,
  readProjectFiles,
} from './EmbedPicker.jsx'

afterEach(cleanup)

const BOARD = { id: 'b1', project_id: 'p1', folder_id: 'board-dir' }
const FOLDERS = [
  { id: 'scripts', parent_id: 'root', label: 'Scripts' },
  { id: 'board-dir', parent_id: 'root', label: 'Lookbook' },
  { id: 'board-sub', parent_id: 'board-dir', label: 'Inside the board' },
]
const FILES = [
  { id: 'f3', name: 'Harbour light.png', mime_type: 'image/png', folder_id: 'scripts' },
  { id: 'f1', name: 'Draft script.pdf', mime_type: 'application/pdf', folder_id: 'scripts' },
  { id: 'f2', name: 'On the board.png', mime_type: 'image/png', folder_id: 'board-dir' },
  { id: 'f4', name: 'Below the board.md', mime_type: 'text/markdown', folder_id: 'board-sub' },
  { id: 'f5', name: 'Lost clip.mov', mime_type: 'video/quicktime', folder_id: 'scripts', share_missing_since: '2026-11-01T00:00:00Z' },
  { id: 'f6', name: 'Top level notes.txt', mime_type: 'text/plain', folder_id: null },
]
const fakeAdapter = (files = FILES, folders = FOLDERS) => ({
  listMothFiles: vi.fn(async () => files),
  listMothFolders: vi.fn(async () => folders),
})
function fakeEscape() {
  const stack = []
  return {
    stack,
    push: vi.fn((fn) => { stack.push(fn); return () => { const i = stack.indexOf(fn); if (i >= 0) stack.splice(i, 1) } }),
    press() { for (let i = stack.length - 1; i >= 0; i -= 1) if (stack[i]()) return true; return false },
  }
}
const mount = (props = {}) => {
  const all = { adapter: fakeAdapter(), board: BOARD, onPick: vi.fn(), onClose: vi.fn(), ...props }
  const out = render(<EmbedPicker {...all} />)
  return { ...out, props: all }
}
const listed = () => [...document.querySelectorAll('[data-embed-file]')].map((b) => b.getAttribute('data-embed-file'))

describe('the rules', () => {
  it('reads every page of Moth\'s file list, following the last id, until a short page', async () => {
    const pages = [[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }, { id: 'd' }], [{ id: 'e' }]]
    const adapter = { listMothFiles: vi.fn(async (projectId, after) => pages[{ null: 0, b: 1, d: 2 }[String(after)]]) }
    expect((await readProjectFiles(adapter, 'p1', { pageSize: 2 })).map((f) => f.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(adapter.listMothFiles.mock.calls).toEqual([['p1', null, 2], ['p1', 'b', 2], ['p1', 'd', 2]])
    // A page that does not move on ends the read, and so does the most it will ask.
    const stuck = { listMothFiles: vi.fn(async () => [{ id: 'x' }, { id: 'y' }]) }
    await readProjectFiles(stuck, 'p1', { pageSize: 2 })
    expect(stuck.listMothFiles).toHaveBeenCalledTimes(2)
    const endless = { listMothFiles: vi.fn(async (p, after) => [{ id: `${after}1` }, { id: `${after}2` }]) }
    await readProjectFiles(endless, 'p1', { pageSize: 2, maxPages: 3 })
    expect(endless.listMothFiles).toHaveBeenCalledTimes(3)
  })

  it('leaves out the board\'s own folder and below, a missing file and a repeat; sorted by name', () => {
    expect([...boardFolderSet('board-dir', FOLDERS)].sort()).toEqual(['board-dir', 'board-sub'])
    expect([...boardFolderSet(null, FOLDERS)]).toEqual([])
    const out = embeddableFiles([...FILES, FILES[0], { id: 'gone', name: 'Gone', missing: true }], BOARD, FOLDERS)
    expect(out.map((f) => f.id)).toEqual(['f1', 'f3', 'f6'])
    // Without the folders, the board's own folder is still left out.
    expect(embeddableFiles(FILES, BOARD).map((f) => f.id)).toEqual(['f4', 'f1', 'f3', 'f6'])
  })

  it('a search keeps the files whose name holds every word typed, in any order, any case', () => {
    const files = embeddableFiles(FILES, BOARD, FOLDERS)
    expect(matchFiles(files, '').map((f) => f.id)).toEqual(['f1', 'f3', 'f6'])
    expect(matchFiles(files, 'SCRIPT draft').map((f) => f.id)).toEqual(['f1'])
    expect(matchFiles(files, '  light  ').map((f) => f.id)).toEqual(['f3'])
    expect(matchFiles(files, 'nothing here')).toEqual([])
  })
})

describe('EmbedPicker', () => {
  it('lists the project\'s files with their folder, and a pick hands the file on', async () => {
    const { props } = mount()
    expect(screen.getByRole('dialog', { name: EMBED_TITLE })).toBeTruthy()
    await waitFor(() => expect(listed()).toEqual(['f1', 'f3', 'f6']))
    expect(props.adapter.listMothFiles).toHaveBeenCalledWith('p1', null, 500)
    expect(props.adapter.listMothFolders).toHaveBeenCalledWith('p1')
    expect(document.querySelector('[data-embed-file="f1"]').textContent).toBe('Draft script.pdfScripts')
    fireEvent.click(document.querySelector('[data-embed-file="f3"]'))
    expect(props.onPick).toHaveBeenCalledWith(FILES[0])
  })

  it('the search box takes the words at once; Enter picks the first match; no match says so', async () => {
    const { props } = mount()
    await waitFor(() => expect(listed()).toHaveLength(3))
    const box = screen.getByLabelText('Search files')
    expect(document.activeElement).toBe(box)
    fireEvent.change(box, { target: { value: 'harbour' } })
    expect(listed()).toEqual(['f3'])
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(props.onPick).toHaveBeenCalledWith(FILES[0])
    fireEvent.change(box, { target: { value: 'nowhere' } })
    expect(listed()).toEqual([])
    expect(screen.getByRole('status').textContent).toBe(EMBED_NO_MATCH)
  })

  it('says when there is nothing to embed, and when the files could not be listed', async () => {
    mount({ adapter: fakeAdapter([FILES[2]]) })
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(EMBED_EMPTY))
    cleanup()
    mount({ adapter: { listMothFiles: vi.fn(async () => { throw new Error('permission denied for function moth_project_files') }) } })
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(EMBED_FAILED))
    cleanup()
    mount({ adapter: {} })
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(EMBED_FAILED))
    // A folder list that fails costs the folders' names and what sits below the board's own folder; the board's
    // own folder is still left out.
    cleanup()
    mount({ adapter: { listMothFiles: vi.fn(async () => FILES), listMothFolders: vi.fn(async () => { throw new Error('no') }) } })
    await waitFor(() => expect(listed()).toEqual(['f4', 'f1', 'f3', 'f6']))
  })

  it('shows at most two hundred, and says how many more there are', async () => {
    const many = Array.from({ length: 230 }, (_, i) => ({ id: `m${String(i).padStart(3, '0')}`, name: `Still ${String(i).padStart(3, '0')}.png`, folder_id: 'scripts' }))
    mount({ adapter: fakeAdapter(many) })
    await waitFor(() => expect(listed()).toHaveLength(200))
    expect(screen.getByText(embedMoreWords(200, 230))).toBeTruthy()
  })

  it('takes Escape first on the panel\'s stack, and lets go when it closes', async () => {
    const escape = fakeEscape()
    const { props, unmount } = mount({ escape })
    expect(escape.stack).toHaveLength(1)
    act(() => { expect(escape.press()).toBe(true) })
    expect(props.onClose).toHaveBeenCalledTimes(1)
    // With the stack, the key goes on to the panel (which asks the stack).
    const key = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    screen.getByLabelText('Search files').dispatchEvent(key)
    expect(key.defaultPrevented).toBe(false)
    unmount()
    expect(escape.stack).toHaveLength(0)
  })

  it('without a stack, Escape closes it and goes no further', async () => {
    const outer = vi.fn()
    const props = { adapter: fakeAdapter(), board: BOARD, onPick: vi.fn(), onClose: vi.fn() }
    render(<div onKeyDown={outer}><EmbedPicker {...props} /></div>)
    fireEvent.keyDown(screen.getByLabelText('Search files'), { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
  })

  it('a press elsewhere closes it; the button that opened it, or a press inside, does not', async () => {
    const { props } = mount()
    const toggle = document.createElement('button')
    toggle.setAttribute('data-board-embed-toggle', '')
    document.body.appendChild(toggle)
    fireEvent.pointerDown(screen.getByLabelText('Search files'))
    fireEvent.pointerDown(toggle)
    expect(props.onClose).not.toHaveBeenCalled()
    fireEvent.pointerDown(document.body)
    expect(props.onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTitle('Close'))
    expect(props.onClose).toHaveBeenCalledTimes(2)
    toggle.remove()
  })

  it('larger rows under a finger or a pen', async () => {
    mount({ inputMode: 'touch' })
    await waitFor(() => expect(listed()).toHaveLength(3))
    expect(document.querySelector('[data-moth-board-embed]').getAttribute('data-input')).toBe('touch')
    expect(document.querySelector('[data-embed-file="f1"]').style.minHeight).toBe('44px')
  })
})
