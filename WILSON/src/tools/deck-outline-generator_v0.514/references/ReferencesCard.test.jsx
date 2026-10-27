/** @vitest-environment jsdom */
// =============================================================================
// ReferencesCard, D.O.G.'s second card — post-overhaul DG2 (2026-10-26).
//
// Audrey's ask, verbatim: "lets move the upload documents section in dog tool
// to the 2 References card". Her three answers (verbatim in
// docs/design/DOG_REFERENCES_QUESTIONS.md, its last section): card 1 becomes
// "1 Project"; "Uploads (n) is the first group, with its Choose file button;
// then Items, Files, Notes, the meter, Add references. What the AI reads, top
// to bottom."; "Each upload is a row with its glyph, name, size and Remove, in
// the same list style as Items, Files and Notes, so the card reads as one list
// of what the AI reads."
//
// The card only renders: the uploads' state and handlers stay in D.O.G.
// (DeckOutlineGenerator.jsx: uploadedFiles, isFileLoading, handleFileUpload,
// removeFile) and arrive as one `uploads` prop. The rendered D.O.G.
// (enterKey.render.test.jsx, its DG2 describe) pins the wiring, the let-go of
// the AI's store on Remove, the meter's figure and the Enter rule.
//
// Every name here is made up (a file name is content).
// =============================================================================
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen, within } from '@testing-library/react'
import ReferencesCard, { UPLOAD_ACCEPT, UPLOAD_LIMIT } from './ReferencesCard'

afterEach(cleanup)

let nextId = 1
const up = (name, type, size = 2048) => ({ id: nextId++, file: { name, size }, content: '', type })
const UPLOADS = () => [up('note-01.txt', 'text', 2048), up('picture-01.png', 'image', 5 * 1024), up('clip-01.mp4', 'video', 51200), up('paper-01.pdf', 'pdf', 1536)]

function fakeRefs(chosenList = [], over = {}) {
  return {
    chosenList, unavailable: new Set(), notice: '', undoable: false,
    chosenTokens: 0, chosenUncounted: 0, chosenBytes: 0, pdfPages: new Map(),
    untick: vi.fn(), removeAll: vi.fn(), undoRemoveAll: vi.fn(), clearNotice: vi.fn(),
    ...over,
  }
}
const ITEM = { key: 'scene:s1', kind: 'scene', name: 'Scene one', id: 's1' }
const FILE = { key: 'file:f1', kind: 'file', name: 'board-01.pdf', dogType: 'pdf', id: 'f1', size: 1000 }
const NOTE = { key: 'note:n1', kind: 'note', name: 'A note', id: 'n1' }

function mount({ files = [], busy = false, chosen = [], projectChosen = true, refs } = {}) {
  const uploads = { files, busy, add: vi.fn(), remove: vi.fn() }
  const r = refs || fakeRefs(chosen)
  const view = render(
    <ReferencesCard refs={r} uploads={uploads} projectChosen={projectChosen} onAdd={vi.fn()} onPreview={vi.fn()} />,
  )
  const body = () => view.container.querySelector('#dog-refs-body')
  const groups = () => [...view.container.querySelectorAll('#dog-refs-body .dog-refs-group')]
  const uploadsGroup = () => view.container.querySelector('#dog-refs-body .dog-refs-uploads')
  const uploadRows = () => [...view.container.querySelectorAll('#dog-refs-body .dog-refs-uploads .dog-refs-row')]
  const choose = () => uploadsGroup()?.querySelector('label.dog-upload') || null
  return { view, uploads, refs: r, body, groups, uploadsGroup, uploadRows, choose }
}
const before = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

describe('DG2: the References card reads as one list of what the AI reads', () => {
  it('top to bottom: Uploads, then Items, Files, Notes, the meter, Add references', () => {
    const c = mount({ files: UPLOADS().slice(0, 2), chosen: [NOTE, FILE, ITEM] })
    const labels = c.groups().map((g) => g.querySelector('.dog-refs-group-label').textContent)
    expect(labels).toEqual(['Uploads (2)', 'Items (1)', 'Files (1)', 'Notes (1)'])
    expect(c.groups().map((g) => g.getAttribute('aria-label'))).toEqual(['Uploads', 'Items', 'Files', 'Notes'])
    expect(c.groups()[0]).toBe(c.uploadsGroup())
    const meter = c.body().querySelector('.dog-refs-meter')
    const add = screen.getByRole('button', { name: 'Add references' })
    expect(before(c.groups()[3], meter)).toBe(true)
    expect(before(meter, add)).toBe(true)
    // The contract sentence above them all.
    expect(before(c.body().querySelector('.dog-refs-contract'), c.uploadsGroup())).toBe(true)
  })

  it('the Uploads group is always drawn: nothing uploaded and nothing chosen, it still has its label, its hint and Choose file', () => {
    const c = mount({ files: [], chosen: [] })
    expect(c.groups()).toHaveLength(1)
    const g = c.uploadsGroup()
    expect(g.getAttribute('role')).toBe('group')
    expect(g.querySelector('.dog-refs-group-label').textContent).toBe('Uploads (0)')
    expect(g.querySelector('.dog-refs-group-label').className).toBe('ui-field-label dog-refs-group-label')
    expect(g.querySelector('.ui-field-hint').textContent).toBe('Source material for generating slide content (max 20 files)')
    expect(c.uploadRows()).toHaveLength(0)
    expect(g.querySelector('ul')).toBe(null)
    const choose = c.choose()
    expect(choose.textContent.replace(/\s+/g, ' ').trim()).toBe('Choose file(PDF, MD, TXT, images)')
    expect(choose.querySelector('.dog-upload-hint').textContent).toBe('(PDF, MD, TXT, images)')
    expect(choose.className).toBe('ui-btn dog-upload')
    expect(choose.getAttribute('data-variant')).toBe('secondary')
    const input = choose.querySelector('input[type=file]')
    expect(input.className).toBe('hidden')
    expect(input.getAttribute('accept')).toBe(UPLOAD_ACCEPT)
  })

  it('the file kinds are exactly the ones the upload block admitted', () => {
    expect(UPLOAD_ACCEPT).toBe('.pdf,.md,.txt,text/plain,text/markdown,application/pdf,image/*,video/*')
    expect(UPLOAD_LIMIT).toBe(20)
  })

  it('each upload is a row in the references\' list style: its glyph by type, its name, its size as the chip showed it, and Remove named by it', () => {
    const files = UPLOADS()
    const c = mount({ files })
    const rows = c.uploadRows()
    expect(rows).toHaveLength(4)
    expect(rows.every((r) => r.tagName === 'LI' && r.parentElement.matches('ul.dog-refs-rows'))).toBe(true)
    const glyph = (r) => r.querySelector('svg.dog-file-icon')
    expect(glyph(rows[0]).classList.contains('lucide-file-text')).toBe(true)
    expect(glyph(rows[1]).classList.contains('lucide-image')).toBe(true)
    expect(glyph(rows[2]).classList.contains('lucide-video')).toBe(true)
    expect(glyph(rows[3]).classList.contains('lucide-file-text')).toBe(true)
    expect(rows.every((r) => glyph(r).getAttribute('aria-hidden') === 'true')).toBe(true)
    expect(rows.map((r) => r.querySelector('.dog-refs-name').textContent)).toEqual(files.map((f) => f.file.name))
    expect(rows.map((r) => r.querySelector('.dog-refs-name').getAttribute('title'))).toEqual(files.map((f) => f.file.name))
    // The chip's own arithmetic: (size / 1024).toFixed(1) KB, in brackets.
    expect(rows.map((r) => r.querySelector('.dog-file-size').textContent)).toEqual(['(2.0 KB)', '(5.0 KB)', '(50.0 KB)', '(1.5 KB)'])
    for (const [i, r] of rows.entries()) {
      const buttons = r.querySelectorAll('button')
      expect(buttons).toHaveLength(1)
      expect(buttons[0].getAttribute('aria-label')).toBe(`Remove ${files[i].file.name}`)
      expect(buttons[0].classList.contains('dog-refs-remove')).toBe(true)
    }
  })

  it('a video\'s row says it is placed only, not read; the others do not', () => {
    const c = mount({ files: UPLOADS() })
    expect(c.uploadRows().map((r) => r.querySelector('.dog-refs-sub')?.textContent || null))
      .toEqual([null, null, 'placed only, not read', null])
  })

  it('no Preview on an upload (it is the person\'s own file, in memory): the eye is the references\' alone', () => {
    const c = mount({ files: UPLOADS(), chosen: [ITEM] })
    expect(within(c.uploadsGroup()).queryAllByRole('button', { name: /^Preview/ })).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Preview Scene one' })).toBeTruthy()
  })

  it('Remove on an upload row removes that upload, through D.O.G.\'s handler, and nothing of the references', () => {
    const files = UPLOADS()
    const c = mount({ files, chosen: [ITEM, NOTE] })
    fireEvent.click(screen.getByRole('button', { name: `Remove ${files[2].file.name}` }))
    expect(c.uploads.remove).toHaveBeenCalledTimes(1)
    expect(c.uploads.remove).toHaveBeenCalledWith(files[2].id)
    expect(c.refs.untick).not.toHaveBeenCalled()
    expect(c.refs.removeAll).not.toHaveBeenCalled()
  })

  it('Choose file sits at the group\'s foot and hands the picked file to D.O.G.\'s handler', () => {
    const c = mount({ files: UPLOADS().slice(0, 2) })
    const choose = c.choose()
    expect(choose.parentElement).toBe(c.uploadsGroup())
    expect(choose).toBe(c.uploadsGroup().lastElementChild)
    expect(before(c.uploadsGroup().querySelector('ul'), choose)).toBe(true)
    fireEvent.change(choose.querySelector('input'), { target: { files: [] } })
    expect(c.uploads.add).toHaveBeenCalledTimes(1)
  })

  it('Choose file is there while under 20 and gone at 20, the rows still drawn', () => {
    const many = (n) => Array.from({ length: n }, (_, i) => up(`note-${String(i + 1).padStart(2, '0')}.txt`, 'text', 100))
    const c19 = mount({ files: many(UPLOAD_LIMIT - 1) })
    expect(c19.choose()).not.toBe(null)
    expect(c19.uploadRows()).toHaveLength(19)
    cleanup()
    const c20 = mount({ files: many(UPLOAD_LIMIT) })
    expect(c20.choose()).toBe(null)
    expect(c20.view.container.querySelector('input[type=file]')).toBe(null)
    expect(c20.uploadRows()).toHaveLength(20)
    expect(c20.uploadsGroup().querySelector('.dog-refs-group-label').textContent).toBe('Uploads (20)')
  })

  it('while a file is being read, Choose file shows the spinner in place of its glyph', () => {
    const idle = mount({ files: [] })
    expect(idle.choose().querySelector('svg').classList.contains('lucide-upload')).toBe(true)
    cleanup()
    const busy = mount({ files: [], busy: true })
    const svg = busy.choose().querySelector('svg')
    expect(svg.classList.contains('animate-spin')).toBe(true)
    expect(svg.getAttribute('aria-hidden')).toBe('true')
  })

  it('the contract sentence no longer names uploads apart; its hover is as before', () => {
    const c = mount({ files: UPLOADS().slice(0, 1) })
    const contract = c.body().querySelector('.dog-refs-contract')
    expect(contract.textContent).toBe('What goes to the AI: what is listed here and the project’s title and description, with what you write below.')
    expect(contract.getAttribute('title')).toBe('PDFs and pictures are placed in the AI\'s file store to be read. Your notes always travel in the request itself.')
  })

  it('the header counts the uploads and the references as one number', () => {
    const count = (opts) => { const c = mount(opts); const t = c.view.container.querySelector('.dog-refs-count').textContent; cleanup(); return t }
    expect(count({})).toBe('None chosen')
    expect(count({ files: UPLOADS().slice(0, 1) })).toBe('1 chosen')
    expect(count({ files: UPLOADS().slice(0, 2) })).toBe('2 chosen')
    expect(count({ chosen: [ITEM, FILE, NOTE] })).toBe('3 chosen')
    expect(count({ files: UPLOADS().slice(0, 2), chosen: [ITEM, FILE, NOTE] })).toBe('5 chosen')
  })

  it('folded, the header keeps the one number and its warning; the body and Choose file are not drawn', () => {
    const c = mount({ files: UPLOADS().slice(0, 2), chosen: [ITEM], refs: fakeRefs([ITEM], { chosenTokens: 250000 }) })
    fireEvent.click(screen.getByRole('button', { name: 'References' }))
    expect(c.body()).toBe(null)
    expect(c.view.container.querySelector('input[type=file]')).toBe(null)
    expect(c.view.container.querySelector('.dog-refs-count').textContent).toBe('3 chosen · over the limit')
  })

  it('Remove all removes the chosen references only, and shows from two of them (uploads not counted)', () => {
    const files = UPLOADS().slice(0, 2)
    const one = mount({ files, chosen: [ITEM] })
    expect(screen.queryByRole('button', { name: 'Remove all' })).toBe(null)
    cleanup()
    const two = mount({ files, chosen: [ITEM, NOTE] })
    fireEvent.click(screen.getByRole('button', { name: 'Remove all' }))
    expect(two.refs.removeAll).toHaveBeenCalledTimes(1)
    expect(two.uploads.remove).not.toHaveBeenCalled()
    expect(two.uploadRows()).toHaveLength(2)
    cleanup()
    const uploadsOnly = mount({ files: UPLOADS() })
    expect(screen.queryByRole('button', { name: 'Remove all' })).toBe(null)
    expect(uploadsOnly.uploadRows()).toHaveLength(4)
  })

  it('with no project, the "Choose a project" note sits under the uploads group, above the references', () => {
    const c = mount({ files: UPLOADS().slice(0, 1), chosen: [NOTE], projectChosen: false })
    const note = [...c.body().querySelectorAll('.dog-details-note')].find((p) => /^Choose a project/.test(p.textContent))
    expect(note.textContent).toBe('Choose a project to reference its items and files. Your notes can be referenced without one.')
    expect(before(c.uploadsGroup(), note)).toBe(true)
    expect(before(note, c.groups()[1])).toBe(true)
    expect(c.uploadsGroup().nextElementSibling).toBe(note)
  })
})
