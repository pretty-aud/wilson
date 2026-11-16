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
//
// DG4 (2026-10-28, Audrey: "lets consolidates cards 1 (project) and 2
// (References) into one card"): this is card 1's lower part now, with no
// header or fold of its own (D.O.G. draws the card; ReferencesCount is its
// header's number), and Core files only beside Add references (her note 4).
//
// DG7 (2026-11-05, Audrey: "lets have references and the uploads be side by
// side in the card ... the uploads and references selected/uploaded files
// should show up on the list together showing what its reading"): the two
// sections hold their controls, and one list under them holds every tile.
// =============================================================================
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import ReferencesCard, { UPLOAD_ACCEPT, UPLOAD_LIMIT, ReferencesCount, ReferencesMeter, meterSentence, CORE_TITLE, focusAfterRemove } from './ReferencesCard'
import { meterState } from './referenceModel'
import { setModelSources } from '../../../lib/activeModel'

afterEach(cleanup)

let nextId = 1
const up = (name, type, size = 2048) => ({ id: nextId++, file: { name, size }, content: '', type })
const UPLOADS = () => [up('note-01.txt', 'text', 2048), up('picture-01.png', 'image', 5 * 1024), up('clip-01.mp4', 'video', 51200), up('paper-01.pdf', 'pdf', 1536)]

function fakeRefs(chosenList = [], over = {}) {
  return {
    chosenList, chosen: new Set(chosenList.map((s) => s.key)), listedKeys: new Set(chosenList.map((s) => s.key)),
    unavailable: new Set(), notice: '', undoable: false,
    chosenTokens: 0, chosenUncounted: 0, chosenBytes: 0, pdfPages: new Map(),
    coreOnly: false, core: { state: 'ready', count: 2, legacy: 0 },
    untick: vi.fn(), removeAll: vi.fn(), undoRemoveAll: vi.fn(), clearNotice: vi.fn(),
    setCoreOnly: vi.fn(), loadPool: vi.fn(),
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
  const body = () => view.container.querySelector('.dog-refs')
  const uploadsGroup = () => view.container.querySelector('.dog-refs .dog-refs-uploads')
  // DG7: the one list, in the last section; a tile says its own kind.
  const list = () => view.container.querySelector('.dog-refs .dog-sec-foot > ul.dog-refs-rows')
  const uploadRows = () => [...view.container.querySelectorAll('.dog-refs .dog-sec-foot .dog-refs-row[data-kind="upload"]')]
  const refRows = () => [...view.container.querySelectorAll('.dog-refs .dog-sec-foot .dog-refs-row[data-kind="reference"]')]
  // DG3 (OUTSTANDING DG2-01): Choose file is a kit button beside the hidden
  // input (it was a <label> round it, which Tab never reached).
  const choose = () => uploadsGroup()?.querySelector('button.dog-upload') || null
  const chooseInput = () => uploadsGroup()?.querySelector('input[type=file]') || null
  return { view, uploads, refs: r, body, list, uploadsGroup, uploadRows, refRows, choose, chooseInput }
}
const before = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

describe('DG2: the References card reads as one list of what the AI reads', () => {
  // DG6's follow-up (Audrey, 2026-10-31, verbatim: "project select needs to
  // go above the add references and below the references should be the
  // upload option"; "we need a title or something for each function").
  // Before: the contract line, Uploads, Items, Files, Notes, the meter, Add
  // references. After: the References section (Items, Files, Notes, Add
  // references), the Uploads section, then the contract line and the meter.
  // DG7 (her words at the head of this file). Before: the References section
  // (Items, Files, Notes, Add references), the Uploads section (its rows, Choose
  // file), then the contract line and the meter. After: the two sections with
  // their controls side by side, then one section of the list, the contract line
  // and the meter.
  it('top to bottom: References and Uploads in one row, then one section of the list, the contract line and the meter; each section titled', () => {
    const c = mount({ files: UPLOADS().slice(0, 2), chosen: [NOTE, FILE, ITEM] })
    const titles = [...c.body().querySelectorAll('h3.dog-sec-title')].map((h) => h.textContent)
    expect(titles).toEqual(['References', 'Uploads (2)', 'The deck reads'])
    const add = screen.getByRole('button', { name: 'Add references' })
    const contract = c.body().querySelector('.dog-refs-contract')
    const meter = c.body().querySelector('.dog-refs-meter')
    expect(before(add, c.uploadsGroup())).toBe(true)
    expect(before(c.uploadsGroup(), c.list())).toBe(true)
    expect(before(c.list(), contract)).toBe(true)
    expect(before(contract, meter)).toBe(true)
    // The row and the last section are the part's two children; the row holds
    // the two sections and nothing else.
    expect([...c.body().children].map((s) => s.className)).toEqual(['dog-refs-pair', 'dog-sec dog-sec-foot'])
    expect([...c.body().children[0].children].map((s) => s.className)).toEqual(['dog-sec dog-sec-refs', 'dog-sec dog-refs-uploads'])
    // No list in either section: a tile is only ever in the one list.
    expect(c.body().querySelector('.dog-sec-refs ul, .dog-refs-uploads ul')).toBe(null)
  })

  it('the one list: items, then files, then notes, then the uploads, whatever order they were chosen in, and no group labels', () => {
    const SCENE = { key: 'scene:s2', kind: 'scene', name: 'Scene two', id: 's2' }
    const c = mount({ files: UPLOADS().slice(0, 2), chosen: [NOTE, FILE, ITEM, SCENE] })
    expect([...c.list().children].map((r) => r.querySelector('.dog-refs-name').textContent))
      .toEqual(['Scene · Scene one', 'Scene · Scene two', 'board-01.pdf', 'A note', 'note-01.txt', 'picture-01.png'])
    expect(c.view.container.querySelectorAll('ul.dog-refs-rows')).toHaveLength(1)
    // The labels Items (n), Files (n) and Notes (n) are gone, and their groups.
    expect(c.body().querySelector('.dog-refs-group, .dog-refs-group-label')).toBe(null)
    expect(c.body().textContent).not.toMatch(/Items \(|Files \(|Notes \(/)
    expect(screen.queryByRole('group', { name: 'Items' })).toBe(null)
    expect(screen.queryByRole('group', { name: 'Files' })).toBe(null)
    expect(screen.queryByRole('group', { name: 'Notes' })).toBe(null)
    // The list is named by its section's title.
    expect(screen.getByRole('list', { name: 'The deck reads' })).toBe(c.list())
    expect(document.getElementById(c.list().getAttribute('aria-labelledby'))).toBe(c.body().querySelector('.dog-sec-foot > h3'))
  })

  it('said, not only shown: a file, a note and an upload say their kind in a hidden word before the name; an item\'s words say it; Preview and Remove keep their names', () => {
    const c = mount({ files: UPLOADS().slice(0, 1), chosen: [ITEM, FILE, NOTE] })
    const heard = [...c.list().children].map((r) => {
      const hidden = r.querySelector('.sr-only')
      if (hidden) expect(hidden.nextElementSibling).toBe(r.querySelector('.dog-refs-name'))
      return [hidden?.textContent ?? null, r.querySelector('.dog-refs-name').textContent]
    })
    expect(heard).toEqual([[null, 'Scene · Scene one'], ['File', 'board-01.pdf'], ['Note', 'A note'], ['Upload', 'note-01.txt']])
    for (const name of ['Preview Scene one', 'Remove Scene one', 'Preview board-01.pdf', 'Remove board-01.pdf', 'Preview A note', 'Remove A note', 'Remove note-01.txt']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
    // CONTROL: the hidden word is not in the name a sighted person reads.
    expect(c.list().children[1].querySelector('.dog-refs-name').textContent).not.toMatch(/^File/)
  })

  it('the Tab walk: Add references, Core files only, Remove all references, Choose file, then each tile\'s Preview and Remove', () => {
    const c = mount({ files: UPLOADS().slice(0, 1), chosen: [ITEM, NOTE] })
    const stops = [...c.body().querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.textContent.trim())
    expect(stops).toEqual(['Add references', 'Core files only', 'Remove all references', 'Choose file',
      'Preview Scene one', 'Remove Scene one', 'Preview A note', 'Remove A note', 'Remove note-01.txt'])
  })

  it('each section\'s first control comes right under its title, with no project and with one, so the two sit on one line beside each other; the sentences follow', () => {
    for (const opts of [{}, { projectChosen: false }, { files: UPLOADS().slice(0, 1) }, { refs: fakeRefs([ITEM, NOTE], { core: { state: 'none', count: 0, legacy: 0 } }) }]) {
      const c = mount(opts)
      const refsTitle = c.body().querySelector('.dog-sec-refs > h3')
      const upTitle = c.uploadsGroup().querySelector(':scope > h3')
      expect(refsTitle.nextElementSibling).toBe(c.body().querySelector('.dog-refs-actions'))
      expect(upTitle.nextElementSibling).toBe(c.choose())
      expect(c.choose().nextElementSibling).toBe(c.chooseInput())
      expect(c.chooseInput().nextElementSibling.textContent).toBe('Source material for generating slide content (max 20 files)')
      cleanup()
    }
  })

  it('the Uploads group is always drawn: nothing uploaded and nothing chosen, it still has its title, its hint and Choose file; the last section is drawn too, with no empty list', () => {
    const c = mount({ files: [], chosen: [] })
    expect(c.list()).toBe(null)
    expect(c.body().querySelector('.dog-sec-foot > h3').textContent).toBe('The deck reads')
    const g = c.uploadsGroup()
    expect(g.getAttribute('role')).toBe('group')
    // DG6's follow-up: its label is the section's title, an h3 (was a
    // `ui-field-label` paragraph); the words and the count are the same.
    const title = g.querySelector('.dog-sec-title')
    expect(title.textContent).toBe('Uploads (0)')
    expect(title.tagName).toBe('H3')
    expect(title.className).toBe('dog-sec-title')
    expect(g.querySelector('.dog-refs-group-label')).toBe(null)
    expect(g.querySelector('.ui-field-hint').textContent).toBe('Source material for generating slide content (max 20 files)')
    expect(c.uploadRows()).toHaveLength(0)
    expect(g.querySelector('ul')).toBe(null)
    const choose = c.choose()
    expect(choose.textContent.replace(/\s+/g, ' ').trim()).toBe('Choose file(PDF, MD, TXT, images)')
    expect(choose.querySelector('.dog-upload-hint').textContent).toBe('(PDF, MD, TXT, images)')
    expect(choose.className).toBe('ui-btn dog-upload')
    expect(choose.getAttribute('data-variant')).toBe('secondary')
    expect(choose.getAttribute('data-size')).toBe('md')
    const input = c.chooseInput()
    expect(input.className).toBe('hidden')
    expect(input.getAttribute('accept')).toBe(UPLOAD_ACCEPT)
    expect(input.hasAttribute('multiple')).toBe(false)
  })

  // DG3 (OUTSTANDING DG2-01): a <label> styled as a button round an input
  // Tailwind hides (display: none) took no focus, so Tab never reached it and
  // Chromium named it `LabelText ""` (DG2's measurement). It is a real button.
  it('Choose file is a kit button named "Choose file", a Tab stop, its kinds its description; the input stays hidden beside it, outside it', () => {
    const c = mount({ files: [] })
    const b = screen.getByRole('button', { name: 'Choose file' })
    expect(b).toBe(c.choose())
    expect(b.tagName).toBe('BUTTON')
    expect(b.getAttribute('type')).toBe('button')
    expect(b.disabled).toBe(false)
    expect(b.tabIndex).toBe(0)
    // Its words name it; the kinds in brackets are its description.
    const hint = document.getElementById(b.getAttribute('aria-describedby'))
    expect(hint).toBe(b.querySelector('.dog-upload-hint'))
    expect(hint.textContent).toBe('(PDF, MD, TXT, images)')
    expect([...b.querySelectorAll('svg')].every((g) => g.getAttribute('aria-hidden') === 'true')).toBe(true)
    // No control inside the button (HTML allows none); the input is its
    // sibling, hidden, and no label wraps anything any more.
    expect(b.querySelector('input, label')).toBe(null)
    expect(c.chooseInput().parentElement).toBe(c.uploadsGroup())
    expect(c.uploadsGroup().querySelector('label')).toBe(null)
    // CONTROL: the name is the words alone, not the description too.
    expect(screen.queryByRole('button', { name: 'Choose file (PDF, MD, TXT, images)' })).toBe(null)
  })

  it('a press on Choose file clicks the hidden input (jsdom opens no picker: the click is what a browser turns into one); nothing else is called', () => {
    const c = mount({ files: UPLOADS().slice(0, 1), chosen: [ITEM] })
    const click = vi.spyOn(c.chooseInput(), 'click')
    fireEvent.click(c.choose())
    expect(click).toHaveBeenCalledTimes(1)
    // Enter and Space press a button by its click (pressEnter / pressSpace in
    // enterKey.render.test.jsx); a second press, a second click.
    fireEvent.click(c.choose())
    expect(click).toHaveBeenCalledTimes(2)
    expect(c.uploads.add).not.toHaveBeenCalled()       // only a picked file reaches the handler
    expect(c.uploads.remove).not.toHaveBeenCalled()
    expect(c.refs.untick).not.toHaveBeenCalled()
    // CONTROL: the click is the input's own, not a click anywhere in the group.
    fireEvent.click(c.uploadsGroup().querySelector('.dog-sec-title'))
    expect(click).toHaveBeenCalledTimes(2)
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
    expect(rows.every((r) => r.tagName === 'LI' && r.parentElement === c.list())).toBe(true)
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
    expect(c.uploadRows()).toHaveLength(4)
    expect(c.uploadRows().flatMap((r) => within(r).queryAllByRole('button', { name: /^Preview/ }))).toHaveLength(0)
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

  it('Choose file sits under its title, its hidden input after it, and hands the picked file to D.O.G.\'s handler', () => {
    const c = mount({ files: UPLOADS().slice(0, 2) })
    const choose = c.choose()
    expect(choose.parentElement).toBe(c.uploadsGroup())
    // DG7: the tiles left this section, so the button is the title's next
    // sibling, and the sentence follows the hidden input.
    expect(choose.previousElementSibling).toBe(c.uploadsGroup().querySelector('h3'))
    expect(choose.nextElementSibling).toBe(c.chooseInput())
    expect(c.chooseInput().nextElementSibling).toBe(c.uploadsGroup().querySelector('.dog-sec-desc'))
    expect(c.uploadsGroup().querySelector('ul, .dog-refs-row')).toBe(null)
    fireEvent.change(c.chooseInput(), { target: { files: [] } })
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
    expect(c20.uploadsGroup().querySelector('.dog-sec-title').textContent).toBe('Uploads (20)')
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
    // DG5: "in step 2", not "below" (her answer to walkthrough 89's Q1: as
    // built); since DG6 the Generate outline card is below card 1 at every
    // width again, and "step 2" names it by its numeral.
    expect(contract.textContent).toBe('What goes to the AI: what is listed here, the project’s title and description, and what you write in step 2.')
    expect(contract.getAttribute('title')).toBe('PDFs and pictures are placed in the AI\'s file store to be read. Your notes always travel in the request itself.')
  })

  // DG4: the number is card 1's header's (ReferencesCount, which D.O.G. draws
  // there); the fold is card 1's. The rendered D.O.G. pins both together
  // (enterKey.render.test.jsx, DG4).
  it('the header counts the uploads and the references as one number', () => {
    const count = (opts) => {
      const v = render(<ReferencesCount refs={fakeRefs(opts.chosen || [])} uploads={(opts.files || []).length} />)
      const t = v.container.querySelector('.dog-refs-count').textContent
      cleanup()
      return t
    }
    expect(count({})).toBe('None chosen')
    expect(count({ files: UPLOADS().slice(0, 1) })).toBe('1 chosen')
    expect(count({ files: UPLOADS().slice(0, 2) })).toBe('2 chosen')
    expect(count({ chosen: [ITEM, FILE, NOTE] })).toBe('3 chosen')
    expect(count({ files: UPLOADS().slice(0, 2), chosen: [ITEM, FILE, NOTE] })).toBe('5 chosen')
  })

  it('the header\'s number carries the meter\'s warning, so a folded card 1 still says it', () => {
    const v = render(<ReferencesCount refs={fakeRefs([ITEM], { chosenTokens: 250000 })} uploads={2} />)
    expect(v.container.querySelector('.dog-refs-count').textContent).toBe('3 chosen')
    cleanup()
    // DG7: past the limit it still gives the number.
    const past = render(<ReferencesCount refs={fakeRefs([ITEM], { chosenTokens: 1200000 })} uploads={2} />)
    expect(past.container.querySelector('.dog-refs-count').textContent).toBe('3 chosen · over the limit, about 122%')
    expect(past.container.querySelector('.dog-refs-head-warn').textContent).toBe(' · over the limit, about 122%')
  })

  it('an upload\'s tile shows the size warning a chosen file\'s tile shows, from D.O.G.\'s count of its pages', () => {
    const files = [up('script.pdf', 'pdf', 1024 * 1024), up('huge.pdf', 'pdf', 40 * 1024 * 1024), up('long.pdf', 'pdf', 1024 * 1024)]
    const uploads = { files, busy: false, add: vi.fn(), remove: vi.fn(), pdfPages: new Map([[files[0].id, 110], [files[1].id, 10], [files[2].id, 700]]) }
    const view = render(<ReferencesCard refs={fakeRefs()} uploads={uploads} projectChosen onAdd={vi.fn()} onPreview={vi.fn()} />)
    const words = [...view.container.querySelectorAll('.dog-refs-row[data-kind="upload"]')].map((r) => r.querySelector('.dog-refs-warn')?.textContent ?? null)
    expect(words).toEqual([null, '40 MB: the AI may refuse a PDF over 32 MB', '700 pages: the AI may refuse a PDF over 600'])
    // The same words on a chosen file's tile, for the same file.
    cleanup()
    const chosen = { key: 'file:f9', kind: 'file', name: 'long.pdf', dogType: 'pdf', id: 'f9', size: 1024 * 1024 }
    const c = mount({ refs: fakeRefs([chosen], { pdfPages: new Map([['f9', 700]]) }) })
    expect(c.refRows()[0].querySelector('.dog-refs-warn').textContent).toBe('700 pages: the AI may refuse a PDF over 600')
  })

  // Review round 1 (READ: placementFrom has no size check; an upload is in
  // memory): "too large to place" is a stored file's rule, and was false here.
  it('a video upload past the placing cap says nothing of being too large; a chosen video does', () => {
    const big = 300 * 1024 * 1024
    const files = [up('clip.mp4', 'video', big)]
    const view = render(<ReferencesCard refs={fakeRefs()} uploads={{ files, busy: false, add: vi.fn(), remove: vi.fn() }} projectChosen onAdd={vi.fn()} onPreview={vi.fn()} />)
    const tile = view.container.querySelector('.dog-refs-row[data-kind="upload"]')
    expect(tile.querySelector('.dog-refs-warn')).toBe(null)
    expect(tile.querySelector('.dog-refs-sub').textContent).toBe('placed only, not read')
    cleanup()
    const c = mount({ chosen: [{ key: 'file:v1', kind: 'file', name: 'clip.mp4', dogType: 'video', id: 'v1', size: big }] })
    expect(c.refRows()[0].querySelector('.dog-refs-warn').textContent).toBe('300 MB: too large to place in a slide')
  })

  it('CONTROL: an upload\'s tile with no count of its pages warns of nothing a person has not been told', () => {
    const files = [up('script.pdf', 'pdf', 1024 * 1024)]
    const view = render(<ReferencesCard refs={fakeRefs()} uploads={{ files, busy: false, add: vi.fn(), remove: vi.fn() }} projectChosen onAdd={vi.fn()} onPreview={vi.fn()} />)
    expect(view.container.querySelector('.dog-refs-warn')).toBe(null)
  })

  it('DG4: this is card 1\'s lower part, with no header, title or fold of its own', () => {
    const c = mount({ files: UPLOADS().slice(0, 1), chosen: [ITEM] })
    expect(c.body().parentElement).toBe(c.view.container)
    expect(c.view.container.querySelector('header, h2, .dog-card, [aria-expanded], .dog-refs-count')).toBe(null)
    expect(screen.queryByRole('button', { name: 'References' })).toBe(null)
  })

  // Review round 1, finding 3: "Remove all" in a card that lists uploads it
  // leaves alone misled; it is named for what it removes, beside Add references.
  it('Remove all references removes the chosen references only, says so, and shows from two of them (uploads not counted)', () => {
    const files = UPLOADS().slice(0, 2)
    mount({ files, chosen: [ITEM] })
    expect(screen.queryByRole('button', { name: /^Remove all/ })).toBe(null)
    cleanup()
    const two = mount({ files, chosen: [ITEM, NOTE] })
    const removeAll = screen.getByRole('button', { name: 'Remove all references' })
    expect(removeAll.getAttribute('title')).toBe('Removes the chosen items, files and notes. Your uploads stay.')
    expect(screen.queryByRole('button', { name: 'Remove all' })).toBe(null)
    fireEvent.click(removeAll)
    expect(two.refs.removeAll).toHaveBeenCalledTimes(1)
    expect(two.uploads.remove).not.toHaveBeenCalled()
    expect(two.uploadRows()).toHaveLength(2)
    cleanup()
    const uploadsOnly = mount({ files: UPLOADS() })
    expect(screen.queryByRole('button', { name: /^Remove all/ })).toBe(null)
    expect(uploadsOnly.uploadRows()).toHaveLength(4)
  })

  // Review round 1, finding 2: the refusal was said only in the banner at the
  // top of the page, out of sight once Choose file had moved down the list.
  it('an upload\'s refusal is said under Choose file, as an alert; with Choose file gone at 20 it is still said', () => {
    const c = mount({ files: UPLOADS().slice(0, 1) })
    expect(c.uploadsGroup().querySelector('[role="alert"]')).toBe(null)
    cleanup()
    const uploads = { files: UPLOADS().slice(0, 1), busy: false, add: vi.fn(), remove: vi.fn(), error: 'Please upload a PDF, Markdown, Text, Image, or Video file' }
    const view = render(<ReferencesCard refs={fakeRefs()} uploads={uploads} projectChosen onAdd={vi.fn()} onPreview={vi.fn()} />)
    const group = view.container.querySelector('.dog-refs-uploads')
    const alert = group.querySelector('[role="alert"]')
    expect(alert.textContent).toBe('Please upload a PDF, Markdown, Text, Image, or Video file')
    expect(alert.getAttribute('data-tone')).toBe('danger')
    expect(before(group.querySelector('button.dog-upload'), alert)).toBe(true)
    // Under Choose file and its sentence, last in the section (DG7): the
    // sentence stays where it is when a refusal arrives.
    expect(group.querySelector('.dog-sec-desc').nextElementSibling).toBe(alert)
    expect(group.lastElementChild).toBe(alert)
    cleanup()
    const many = Array.from({ length: UPLOAD_LIMIT }, (_, i) => up(`note-${String(i + 1).padStart(2, '0')}.txt`, 'text', 100))
    const full = render(<ReferencesCard refs={fakeRefs()} uploads={{ ...uploads, files: many, error: 'Maximum 20 files allowed' }} projectChosen onAdd={vi.fn()} onPreview={vi.fn()} />)
    expect(full.container.querySelector('button.dog-upload')).toBe(null)
    expect(full.container.querySelector('.dog-refs-uploads [role="alert"]').textContent).toBe('Maximum 20 files allowed')
  })

  // Before DG7 the note opened the References section, under its title, so with
  // no project Add references sat lower than Choose file; now it follows the
  // actions, before Core's sentence, its words the same.
  it('with no project, the "Choose a project" note follows the actions in the References section, in its own words, before Core\'s sentence', () => {
    const c = mount({ files: UPLOADS().slice(0, 1), chosen: [NOTE], projectChosen: false })
    const note = [...c.body().querySelectorAll('.dog-details-note')].find((p) => /^Choose a project/.test(p.textContent))
    expect(note.textContent).toBe('Choose a project to reference its items and files. Your notes can be referenced without one.')
    const section = c.body().querySelector('.dog-sec-refs')
    expect(note.parentElement).toBe(section)
    expect(section.querySelector('.dog-refs-actions').nextElementSibling).toBe(note)
    expect(before(note, c.uploadsGroup())).toBe(true)
  })

  // DG7 review round 1 (MEASURED in Chromium): after the actions, the Tab from
  // Add references to Undo crossed Core files only, where Enter ticks or makes a
  // deck. Remove all leaves focus on Add references, so one Shift+Tab reaches it.
  it('the notice opens the References section: Undo and Dismiss come before Add references, and no Tab from Add references to Undo crosses the Core files only box', () => {
    const c = mount({ projectChosen: false, refs: fakeRefs([ITEM, NOTE], { notice: '2 references removed.', undoable: true }) })
    const section = c.body().querySelector('.dog-sec-refs')
    const notice = section.querySelector('.dog-refs-notice')
    expect(section.querySelector('h3').nextElementSibling).toBe(notice)
    expect(notice.nextElementSibling).toBe(section.querySelector('.dog-refs-actions'))
    expect(section.querySelector('.dog-refs-actions').nextElementSibling.textContent).toMatch(/^Choose a project/)
    expect(notice.getAttribute('role')).toBe('status')
    const stops = [...c.body().querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.textContent.trim())
    expect(stops.slice(0, 5)).toEqual(['Undo', 'Dismiss', 'Add references', 'Core files only', 'Remove all references'])
    // CONTROL: the same walk with the notice after the actions has the box between.
    const moved = section.cloneNode(true)
    moved.append(moved.querySelector('.dog-refs-notice'))
    const walk = [...moved.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.textContent.trim())
    expect(walk.indexOf('Undo')).toBeGreaterThan(walk.indexOf('Core files only'))
  })
})

// =============================================================================
// DG8, her words of 2026-11-06, verbatim: "sorry dont say that its an estimate".
// Everything the bar and the header put on screen or hand to a screen reader, in
// every state, with and without what follows the sentence, so the word cannot
// come back unseen in any letter case or form (estimated, estimation).
// =============================================================================
describe('DG8: the limit bar does not say it is an estimate', () => {
  /** An element's words and every attribute's value, its children's too. */
  const said = (root) => [root, ...root.querySelectorAll('*')].flatMap((el) => [el.textContent, ...[...el.attributes].map((a) => a.value)]).join(' | ')
  const WORD = /estimat/i
  const STATES = [['zero tokens', 0, 'About 0%'], ['under 1 percent', 100, 'Less than 1%'], ['under the limit', 330000, 'About 34%'], ['past it', 1200000, 'about 122%']]

  it.each(STATES)('%s: not in the bar, its hover, what a screen reader hears, or the header', (_, tokens, number) => {
    for (const [uncounted, bytes] of [0, 1, 2].flatMap((n) => [[n, 0], [n, 30 * 1024 * 1024]])) {
      const bar = render(<ReferencesMeter tokens={tokens} uncounted={uncounted} bytes={bytes} />).container
      const head = render(<ReferencesCount refs={fakeRefs([ITEM], { chosenTokens: tokens, chosenUncounted: uncounted })} uploads={2} />).container
      // Each really holds what it is checked for, so the check is not of nothing.
      const track = bar.querySelector('[role="meter"]')
      expect(bar.querySelector('.dog-refs-meter-words').textContent).toContain(number)
      expect(track.getAttribute('aria-valuetext')).toContain(number)
      expect(bar.querySelector('.dog-refs-meter').getAttribute('title')).toMatch(/^About [\d,]+ of 983,616 tokens$/)
      expect(head.querySelector('.dog-refs-count').textContent).toContain('3 chosen')
      expect(said(bar)).not.toMatch(WORD)
      expect(said(head)).not.toMatch(WORD)
      cleanup()
    }
  })

  it('the header\'s warning is checked too: past the limit it says the percent, and only that', () => {
    const head = render(<ReferencesCount refs={fakeRefs([ITEM], { chosenTokens: 1200000 })} uploads={0} />).container
    expect(head.querySelector('.dog-refs-head-warn').textContent).toBe(' · over the limit, about 122%')
    expect(said(head)).not.toMatch(WORD)
  })

  it('the header with nothing chosen is checked too', () => {
    const head = render(<ReferencesCount refs={fakeRefs([])} uploads={0} />).container
    expect(head.querySelector('.dog-refs-count').textContent).toBe('None chosen')
    expect(said(head)).not.toMatch(WORD)
  })

  it('CONTROL: the walk finds the word in text, in an attribute and in any letter case', () => {
    const planted = (html) => { const el = document.createElement('div'); el.innerHTML = html; return said(el) }
    expect(planted('<p>About 34%, an estimate</p>')).toMatch(WORD)
    expect(planted('<p><span>An Estimate: about 1</span></p>')).toMatch(WORD)
    expect(planted('<p title="AN ESTIMATE">About 34%</p>')).toMatch(WORD)
    expect(planted('<i aria-valuetext="estimated"></i>')).toMatch(WORD)
    expect(planted('<p>By estimation</p>')).toMatch(WORD)
    expect(planted('<p title="About 1 of 2 tokens">About 34%</p>')).not.toMatch(WORD)
  })
})

// =============================================================================
// DG7, the meter (2026-11-05; her words at the "Size: the meter" comment in
// referenceModel.js; OUTSTANDING MTR-01): past the limit it still gives the
// number; its limit is the model a full deck resolves to, less the answer's
// reserve. DG8 took the word estimate out of it (its describe, above).
// =============================================================================
describe('DG7: the reading meter says what is true', () => {
  afterEach(() => { setModelSources({}) })
  const limit = 1000000 - 16384
  const words = (tokens, ...rest) => meterSentence(meterState(tokens, limit, ...rest))
  const meter = (props) => {
    const view = render(<ReferencesMeter {...props} />)
    const el = view.container.querySelector('.dog-refs-meter')
    return { el, words: el.querySelector('.dog-refs-meter-words').textContent, hover: el.getAttribute('title'), over: el.getAttribute('data-over'), track: el.querySelector('[role="meter"]') }
  }

  it('under the limit: today\'s words', () => {
    expect(words(330000)).toBe('About 34% of what D.O.G. can read for one deck')
    expect(words(100)).toBe('Less than 1% of what D.O.G. can read for one deck')
    expect(words(0)).toBe('About 0% of what D.O.G. can read for one deck')
  })

  it('past the limit: today\'s words and the number; it warns and does not block', () => {
    expect(words(1200000)).toBe('Past what D.O.G. can read for one deck (about 122%): generating may be slow, cost more, or fail.')
  })

  it('what it has not counted and what Generate downloads still follow, as they did', () => {
    expect(words(330000, 2)).toBe('About 34% of what D.O.G. can read for one deck · 2 PDFs not counted until read')
    expect(meterSentence(meterState(10, limit), 30 * 1024 * 1024)).toBe('Less than 1% of what D.O.G. can read for one deck · about 30 MB to download')
  })

  it('the bar measures against the model a full deck resolves to, less the answer\'s reserve: built in, Sonnet 5', () => {
    const m = meter({ tokens: 330000 })
    expect(m.hover).toBe('About 330,000 of 983,616 tokens')
    expect(m.words).toBe('About 34% of what D.O.G. can read for one deck')
    expect(m.over).toBe('false')
    expect(m.track.getAttribute('aria-valuetext')).toBe(m.words)
    expect(m.track.getAttribute('aria-valuenow')).toBe('34')
  })

  it('a person, a company or the platform choosing another model moves the limit', () => {
    setModelSources({ user: { 'dog.fullDeck': 'claude-haiku-4-5-20251001' } })
    expect(meter({ tokens: 330000 }).hover).toBe('About 330,000 of 183,616 tokens')
    cleanup()
    setModelSources({ workspace: { 'dog.fullDeck': 'claude-haiku-4-5-20251001' } })
    expect(meter({ tokens: 330000 }).over).toBe('true')
    cleanup()
    // Another function's choice is not the full deck's.
    setModelSources({ user: { 'dog.pageOutline': 'claude-haiku-4-5-20251001' } })
    expect(meter({ tokens: 330000 }).hover).toBe('About 330,000 of 983,616 tokens')
  })

  it('a model with no recorded limit keeps 200,000', () => {
    setModelSources({ platform: { 'dog.fullDeck': 'claude-future-9' } })
    expect(meter({ tokens: 150000 }).hover).toBe('About 150,000 of 200,000 tokens')
  })

  it('the header and the bar say one number: the same limit, the same model', () => {
    setModelSources({ user: { 'dog.fullDeck': 'claude-haiku-4-5-20251001' } })
    const v = render(<ReferencesCount refs={fakeRefs([ITEM], { chosenTokens: 330000 })} uploads={0} />)
    expect(v.container.querySelector('.dog-refs-count').textContent).toBe('1 chosen · over the limit, about 180%')
    expect(meter({ tokens: 330000 }).words).toBe('Past what D.O.G. can read for one deck (about 180%): generating may be slow, cost more, or fail.')
  })

  it('the page cap on a tile follows the model too: a 200k model warns from 101 pages', () => {
    setModelSources({ user: { 'dog.fullDeck': 'claude-haiku-4-5-20251001' } })
    const files = [up('script.pdf', 'pdf', 1024 * 1024)]
    const view = render(<ReferencesCard refs={fakeRefs()} uploads={{ files, busy: false, add: vi.fn(), remove: vi.fn(), pdfPages: new Map([[files[0].id, 110]]) }} projectChosen onAdd={vi.fn()} onPreview={vi.fn()} />)
    expect(view.container.querySelector('.dog-refs-warn').textContent).toBe('110 pages: the AI may refuse a PDF over 100')
  })

  // The Add references window draws from a pool this file does not build; its
  // meter is ReferencesMeter (above), and its warning asks the same two functions.
  it('the window says what the card says: its warning asks the same model\'s cap, its footer is this meter', () => {
    const picker = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'ReferencesPicker.jsx'), 'utf8')
    expect(picker).toContain('sizeWarning(f.dogType, f.size, refs.pdfPages?.get(f.id) || null, pdfPageLimit(deckModel()))')
    expect(picker).toContain('<ReferencesMeter tokens={refs.chosenTokens + extraTokens}')
    expect(picker).not.toMatch(/meterState|readingLimit|REFERENCE_TOKEN_LIMIT/)
  })

  it('never blocks: past the limit nothing is disabled and nothing else changes', () => {
    const c = mount({ files: UPLOADS().slice(0, 1), refs: fakeRefs([ITEM], { chosenTokens: 2000000 }) })
    expect(c.body().querySelector('.dog-refs-meter').getAttribute('data-over')).toBe('true')
    expect(screen.getByRole('button', { name: 'Add references' }).disabled).toBe(false)
    expect(screen.getByRole('button', { name: 'Choose file' }).disabled).toBe(false)
  })
})

// =============================================================================
// DG4 (Audrey, 2026-10-28, note 4, verbatim): "lets also add a way for the
// user to just press a checkbox to bypass selecting files and letting the
// generator just reference the files marked as core project files." A
// standing D.O.G. checkbox beside Add references. What it lists and sends is
// the hook's (useReferences.test.jsx, DG4); here, what the card shows for
// each state the hook reports.
// =============================================================================
describe('DG4: Core files only, beside Add references', () => {
  const box = () => screen.getByRole('checkbox', { name: 'Core files only' })
  const said = (c) => c.body().querySelector('#dog-refs-core-said')
  const add = () => screen.getByRole('button', { name: 'Add references' })
  // Off is `aria-disabled`, never `disabled` (review round 2, finding 1): a
  // disabled button loses focus in Chromium, to <body>.
  const off = () => { expect(box().disabled).toBe(false); return box().getAttribute('aria-disabled') === 'true' }

  it('a D.O.G. checkbox right after Add references, sentence case, its hover saying what it does; off at the start', () => {
    mount({ chosen: [ITEM] })
    const b = box()
    expect(b.tagName).toBe('BUTTON')
    expect(b.matches('button.dog-check[role="checkbox"]')).toBe(true)
    expect(b.getAttribute('aria-checked')).toBe('false')
    expect(off()).toBe(false)
    expect(b.getAttribute('title')).toBe(CORE_TITLE)
    const row = b.closest('.dog-check-row')
    expect(row.querySelector('.dog-check-label').textContent).toBe('Core files only')
    expect(row.querySelector('.dog-check-label').getAttribute('title')).toBe(CORE_TITLE)
    expect(add().nextElementSibling).toBe(row)
    expect(row.parentElement.className).toBe('dog-refs-actions')
  })

  const OFF = [
    ['no project chosen', { projectChosen: false, core: { state: 'no-project', count: 0, legacy: 0 } }, 'Core files come from a project: choose one.'],
    ['the project still being listed', { core: { state: 'listing', count: 0, legacy: 0 } }, 'Looking for the project’s Core files…'],
    ['its files could not be listed', { core: { state: 'failed', count: 0, legacy: 0 } }, 'The project’s files could not be listed.'],
    ['no Core file D.O.G. can read', { core: { state: 'none', count: 0, legacy: 0 } }, 'This project has no Core files D.O.G. can read.'],
  ]
  for (const [why, { projectChosen = true, core }, words] of OFF) {
    it(`off, with one sentence, when ${why}; still a Tab stop, and a press does nothing`, () => {
      const c = mount({ projectChosen, refs: fakeRefs([], { core }) })
      expect(off()).toBe(true)
      expect(box().tabIndex).toBe(0)
      expect(said(c).textContent).toBe(words)
      expect(box().getAttribute('aria-describedby')).toBe(said(c).id)
      expect(document.getElementById(box().getAttribute('aria-describedby'))).toBe(said(c))
      fireEvent.click(box())
      expect(c.refs.setCoreOnly).not.toHaveBeenCalled()
      expect(c.refs.loadPool).not.toHaveBeenCalled()
    })
  }

  it('on when the project has Core files D.O.G. can read, with no sentence; a press ticks it and lists the project again', () => {
    const c = mount({ refs: fakeRefs([ITEM], { core: { state: 'ready', count: 3, legacy: 0 } }) })
    expect(off()).toBe(false)
    expect(said(c)).toBe(null)
    expect(box().hasAttribute('aria-describedby')).toBe(false)
    fireEvent.click(box())
    expect(c.refs.setCoreOnly).toHaveBeenCalledWith(true)
    expect(c.refs.loadPool).toHaveBeenCalledTimes(1)
  })

  it('ticked: the rows are the Core files with no Remove, Add references and Remove all references are off, and the sentence says where the choices went', () => {
    const CORE_A = { key: 'file:c1', kind: 'file', name: 'core-01.pdf', dogType: 'pdf', id: 'c1', size: 1000, isCore: true }
    const CORE_B = { key: 'file:c2', kind: 'file', name: 'core-02.txt', dogType: 'text', id: 'c2', size: 100, isCore: true }
    const refs = fakeRefs([CORE_A, CORE_B], { coreOnly: true, chosen: new Set(['scene:s1', 'note:n1']) })
    const c = mount({ files: UPLOADS().slice(0, 1), refs })
    expect(box().getAttribute('aria-checked')).toBe('true')
    expect(box().querySelector('svg.dog-check-glyph')).not.toBe(null)
    expect(add().disabled).toBe(true)
    expect(screen.queryByRole('button', { name: /^Remove all/ })).toBe(null)
    expect(c.refRows().map((r) => r.querySelector('.dog-refs-core')?.textContent)).toEqual(['Core', 'Core'])
    expect(c.refRows().flatMap((r) => within(r).queryAllByRole('button', { name: /^Remove/ }))).toHaveLength(0)
    expect(c.refRows().flatMap((r) => within(r).getAllByRole('button', { name: /^Preview/ }))).toHaveLength(2)
    // The upload keeps its Remove: uploads still go.
    expect(c.uploadRows().flatMap((r) => within(r).getAllByRole('button', { name: /^Remove/ }))).toHaveLength(1)
    expect(said(c).textContent).toBe('Your 2 chosen references are set aside while this is ticked; they come back when you clear it.')
    fireEvent.click(box())
    expect(c.refs.setCoreOnly).toHaveBeenCalledWith(false)
    expect(c.refs.loadPool).not.toHaveBeenCalled()
  })

  // Review round 1, finding 6: ticked, the sentence also says where the
  // window's choices went, whatever the state.
  it('ticked, it can always be cleared: a project with no Core files since, or none chosen, leaves it on and says so', () => {
    const none = mount({ refs: fakeRefs([], { coreOnly: true, core: { state: 'none', count: 0, legacy: 0 } }) })
    expect(off()).toBe(false)
    expect(said(none).textContent).toBe('This project has no Core files D.O.G. can read. Clear this to choose references yourself.')
    cleanup()
    const gone = mount({ projectChosen: false, refs: fakeRefs([], { coreOnly: true, core: { state: 'no-project', count: 0, legacy: 0 }, chosen: new Set(['note:n1']) }) })
    expect(off()).toBe(false)
    expect(said(gone).textContent).toBe('Core files come from a project: choose one. Your 1 chosen reference is set aside while this is ticked; it comes back when you clear it.')
  })

  it('the count of what is set aside leaves out a chosen file that is listed anyway, as one of the Core files', () => {
    const CORE_A = { key: 'file:c1', kind: 'file', name: 'core-01.pdf', dogType: 'pdf', id: 'c1', size: 1000, isCore: true }
    const c = mount({ refs: fakeRefs([CORE_A], { coreOnly: true, chosen: new Set(['file:c1', 'note:n1']) }) })
    expect(said(c).textContent).toBe('Your 1 chosen reference is set aside while this is ticked; it comes back when you clear it.')
  })

  it('ticked with nothing chosen in the window, or on a legacy Local Server project, the sentence says that instead', () => {
    const c = mount({ refs: fakeRefs([], { coreOnly: true, chosen: new Set() }) })
    expect(said(c).textContent).toBe('Clear this to choose references yourself.')
    cleanup()
    const one = mount({ refs: fakeRefs([], { coreOnly: true, chosen: new Set(['note:n1']), core: { state: 'ready', count: 2, legacy: 2 } }) })
    expect(said(one).textContent).toBe('Your 1 chosen reference is set aside while this is ticked; it comes back when you clear it. Older attachments count as Core unless marked Ref.')
  })
})

// =============================================================================
// Review round 1, finding 1: Enter on a row's × took the row away with focus
// on it, focus fell to <body>, and the next Enter was D.O.G.'s "Enter
// generates": a full deck from what was left. Keyboard focus now stays in the
// list. jsdom never matches :focus-visible, so here it follows Chromium's rule
// (FX14's stub in src/ui/Toast.test.jsx): visible unless the last input before
// focus arrived was the mouse.
// =============================================================================
describe('DG2 review round 1: a Remove from the keyboard keeps focus in the list', () => {
  let mouse = false
  let visibleFocus = null
  let spy
  const onKey = () => { mouse = false }
  const onMouse = () => { mouse = true }
  const onFocusIn = (e) => { visibleFocus = mouse ? null : e.target }
  beforeEach(() => {
    mouse = false
    visibleFocus = null
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onMouse, true)
    document.addEventListener('focusin', onFocusIn, true)
    const matches = Element.prototype.matches
    spy = vi.spyOn(Element.prototype, 'matches').mockImplementation(function (sel) {
      if (sel === ':focus-visible') return this === this.ownerDocument.activeElement && this === visibleFocus
      return matches.call(this, sel)
    })
  })
  afterEach(() => {
    spy.mockRestore()
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('mousedown', onMouse, true)
    document.removeEventListener('focusin', onFocusIn, true)
  })
  const removeOf = (name) => screen.getByRole('button', { name: `Remove ${name}` })
  const press = (b) => { b.focus(); fireEvent.keyDown(b, { key: 'Enter' }); fireEvent.click(b) }

  // DG6's follow-up: a Remove stays in its own section. DG7: the tiles are one
  // list, so it stays among its own kind (`data-kind`).
  it('an upload\'s Remove: focus goes to the next upload\'s Remove, else the previous one\'s; never across to the references', () => {
    const files = UPLOADS().slice(0, 2)
    const c = mount({ files, chosen: [ITEM] })
    press(removeOf(files[0].file.name))
    expect(c.uploads.remove).toHaveBeenCalledWith(files[0].id)
    expect(document.activeElement).toBe(removeOf(files[1].file.name))
    // The mock leaves the rows drawn, so the first upload's Remove is still
    // there: the last upload's Remove goes back to it, not to Scene one.
    press(removeOf(files[1].file.name))
    expect(document.activeElement).toBe(removeOf(files[0].file.name))
  })

  it('a reference\'s last Remove goes to the previous reference\'s, never forward into Uploads', () => {
    const files = UPLOADS().slice(0, 1)
    mount({ files, chosen: [ITEM, NOTE] })
    press(removeOf('A note'))
    expect(document.activeElement).toBe(removeOf('Scene one'))
    expect(document.activeElement).not.toBe(removeOf(files[0].file.name))
  })

  it('the last row\'s Remove goes to the previous row\'s; a reference\'s Remove the same', () => {
    const files = UPLOADS().slice(0, 1)
    const c = mount({ files, chosen: [ITEM, NOTE] })
    press(removeOf('A note'))
    expect(c.refs.untick).toHaveBeenCalledWith(['note:n1'])
    expect(document.activeElement).toBe(removeOf('Scene one'))
  })

  // DG6's follow-up: each section's own way to add (before, Add references
  // for any row).
  it('the only upload\'s Remove goes to Choose file; the only reference\'s Remove to Add references', () => {
    const files = UPLOADS().slice(0, 1)
    mount({ files })
    press(removeOf(files[0].file.name))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Choose file' }))
    cleanup()
    mount({ files: [], chosen: [ITEM] })
    press(removeOf('Scene one'))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add references' }))
  })

  // DG7 (the brief: the test today's suite lacks): with the tiles in one list a
  // scope by section finds the other kind's tile; these fail with that scope.
  it('the last upload\'s Remove with a reference listed goes to Choose file, never to the reference\'s Remove', () => {
    const files = UPLOADS().slice(0, 1)
    mount({ files, chosen: [ITEM] })
    press(removeOf(files[0].file.name))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Choose file' }))
    expect(document.activeElement).not.toBe(removeOf('Scene one'))
  })

  it('the last reference\'s Remove with an upload listed goes to Add references, never to the upload\'s Remove', () => {
    const files = UPLOADS().slice(0, 1)
    mount({ files, chosen: [ITEM] })
    press(removeOf('Scene one'))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add references' }))
    expect(document.activeElement).not.toBe(removeOf(files[0].file.name))
  })

  // Review round 1 (MEASURED: previous-first passed every test, none pressed a
  // middle tile): next, else previous.
  it('a middle tile\'s Remove goes to the next of its kind, not the previous', () => {
    const files = UPLOADS().slice(0, 3)
    mount({ files, chosen: [ITEM, FILE, NOTE] })
    press(removeOf('board-01.pdf'))
    expect(document.activeElement).toBe(removeOf('A note'))
    press(removeOf(files[1].file.name))
    expect(document.activeElement).toBe(removeOf(files[2].file.name))
  })

  it('a reference\'s first Remove goes to the next reference\'s, over nothing else; the last upload\'s goes back over no reference', () => {
    const files = UPLOADS().slice(0, 2)
    mount({ files, chosen: [ITEM, FILE, NOTE] })
    press(removeOf('Scene one'))
    expect(document.activeElement).toBe(removeOf('board-01.pdf'))
    press(removeOf(files[1].file.name))
    expect(document.activeElement).toBe(removeOf(files[0].file.name))
  })

  // "Else the other's": no state of the card reaches it today (Core files only
  // takes the references' Removes away with Add references, and Choose file goes
  // only at 20 uploads, when an upload has a neighbour), so it is pinned on the
  // function itself, on a part built by hand.
  it('else the other\'s way to add: a kind with no tile left and no way of its own hands focus to the other kind\'s', () => {
    const part = document.createElement('div')
    part.className = 'dog-refs'
    part.innerHTML = '<div class="dog-refs-actions"><button class="ui-btn">Add references</button></div><div class="dog-refs-uploads"><button class="ui-btn dog-upload">Choose file</button></div><ul><li class="dog-refs-row" data-kind="upload"><button class="dog-refs-remove">x</button></li><li class="dog-refs-row" data-kind="reference"><button class="dog-refs-remove">x</button></li></ul>'
    const view = render(<div ref={(el) => { el?.append(part) }} />)
    const [upload, reference] = part.querySelectorAll('.dog-refs-remove')
    const add = part.querySelector('.dog-refs-actions button')
    const chooseFile = part.querySelector('button.dog-upload')
    upload.focus()
    expect(focusAfterRemove(upload)).toBe(chooseFile)
    reference.focus()
    expect(focusAfterRemove(reference)).toBe(add)
    chooseFile.remove()
    upload.focus()
    expect(focusAfterRemove(upload)).toBe(add)
    part.querySelector('.dog-refs-uploads').append(chooseFile)
    add.disabled = true
    reference.focus()
    expect(focusAfterRemove(reference)).toBe(chooseFile)
    view.unmount()
  })

  // The brief's two nevers, over every Remove in the states that take a way to
  // add away: Core files only ticked (Add references off), the 20th upload
  // (Choose file gone), and both.
  it('never the Core files only box and never the page, in any of the states a Remove can leave', () => {
    const many = Array.from({ length: UPLOAD_LIMIT }, (_, i) => up(`note-${String(i + 1).padStart(2, '0')}.txt`, 'text', 100))
    for (const opts of [
      { files: UPLOADS().slice(0, 1), chosen: [ITEM] },
      { files: UPLOADS().slice(0, 1), refs: fakeRefs([], { coreOnly: true }) },
      { files: many, chosen: [ITEM] },
      { files: many, refs: fakeRefs([], { coreOnly: true }) },
      { files: [], chosen: [ITEM, NOTE] },
    ]) {
      const c = mount(opts)
      for (const b of [...c.body().querySelectorAll('.dog-refs-remove')]) {
        press(b)
        expect(document.activeElement).not.toBe(document.body)
        expect(document.activeElement.matches('.dog-check')).toBe(false)
        expect(document.activeElement).not.toBe(b)
      }
      cleanup()
    }
  })

  // DG4: Core files only ticked holds Add references off, so focus goes to
  // Choose file; never to the checkbox, a D.O.G. tick box, where the next
  // Enter would make a deck (enterGenerates.js), nor stays on a gone row.
  it('Core files only ticked: the only upload\'s Remove goes to Choose file, never to the checkbox', () => {
    const files = UPLOADS().slice(0, 1)
    mount({ files, refs: fakeRefs([], { coreOnly: true }) })
    expect(screen.getByRole('button', { name: 'Add references' }).disabled).toBe(true)
    press(removeOf(files[0].file.name))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Choose file' }))
    expect(document.activeElement.matches('.dog-check')).toBe(false)
  })

  // Review round 1, finding 2 (MEASURED in Chromium): Add references off,
  // Choose file gone at the 20th upload, and the notice's buttons found
  // nothing to hand focus to; it fell to <body>.
  for (const [name, call] of [['Dismiss', 'clearNotice'], ['Undo', 'undoRemoveAll']]) {
    it(`20 uploads and Core files only ticked: the notice's ${name} from the keyboard goes to the first upload's Remove`, () => {
      const files = Array.from({ length: UPLOAD_LIMIT }, (_, i) => up(`note-${String(i + 1).padStart(2, '0')}.txt`, 'text', 100))
      const c = mount({ files, refs: fakeRefs([], { coreOnly: true, notice: '2 references removed.', undoable: true }) })
      expect(screen.queryByRole('button', { name: 'Choose file' })).toBe(null)
      expect(screen.getByRole('button', { name: 'Add references' }).disabled).toBe(true)
      press(screen.getByRole('button', { name }))
      expect(c.refs[call]).toHaveBeenCalledTimes(1)
      expect(document.activeElement).toBe(removeOf('note-01.txt'))
    })
  }

  // Review rounds 1 and 2, finding 1 (MEASURED in Chromium): the box went off
  // under the keyboard's focus, after a clear where it could not be ticked
  // again (round 1) or after a list at Generate that failed or found no Core
  // file (round 2), and Chromium dropped focus on <body>, where D.O.G.'s next
  // Enter makes a deck. jsdom keeps focus on a disabled button, so what is
  // pinned is the cause: in no state is the box `disabled`; off, it stays
  // focusable and a Tab stop. Chromium's own result is in the DG4 hand-off.
  const props = (over) => ({
    refs: fakeRefs([], over),
    uploads: { files: [], busy: false, add: vi.fn(), remove: vi.fn() }, projectChosen: true, onAdd: vi.fn(), onPreview: vi.fn(),
  })
  it('the box is never disabled: off after a clear from the keyboard, it keeps focus', () => {
    const first = props({ coreOnly: true, core: { state: 'none', count: 0, legacy: 0 } })
    const view = render(<ReferencesCard {...first} />)
    const b = screen.getByRole('checkbox', { name: 'Core files only' })
    press(b)
    expect(first.refs.setCoreOnly).toHaveBeenCalledWith(false)
    view.rerender(<ReferencesCard {...props({ coreOnly: false, core: { state: 'none', count: 0, legacy: 0 } })} />)
    expect(b.getAttribute('aria-disabled')).toBe('true')
    expect(b.hasAttribute('disabled')).toBe(false)
    expect(document.activeElement).toBe(b)
  })

  it('the box is never disabled: turned off by a list while it holds focus (a failed list, or no Core file left), it keeps focus', () => {
    for (const state of ['failed', 'none', 'listing']) {
      const view = render(<ReferencesCard {...props({ core: { state: 'ready', count: 2, legacy: 0 } })} />)
      const b = screen.getByRole('checkbox', { name: 'Core files only' })
      b.focus()
      view.rerender(<ReferencesCard {...props({ core: { state, count: 0, legacy: 0 } })} />)
      expect(b.getAttribute('aria-disabled')).toBe('true')
      expect(b.hasAttribute('disabled')).toBe(false)
      expect(document.activeElement).toBe(b)
      cleanup()
    }
  })

  it('Remove all references from the keyboard goes to Add references (it goes itself)', () => {
    const c = mount({ chosen: [ITEM, NOTE] })
    press(screen.getByRole('button', { name: 'Remove all references' }))
    expect(c.refs.removeAll).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add references' }))
  })

  // Review round 2, finding 1: the notice's Undo and Dismiss take themselves
  // (and the notice) away too; from the keyboard focus fell to <body>.
  for (const [name, call] of [['Undo', 'undoRemoveAll'], ['Dismiss', 'clearNotice']]) {
    it(`the notice's ${name} from the keyboard goes to Add references`, () => {
      const c = mount({ refs: fakeRefs([ITEM, NOTE], { notice: '2 references removed.', undoable: true }) })
      press(screen.getByRole('button', { name }))
      expect(c.refs[call]).toHaveBeenCalledTimes(1)
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add references' }))
    })
  }

  it('CONTROL, the pointer as before: a Remove the mouse put focus on moves nothing', () => {
    const files = UPLOADS().slice(0, 2)
    const c = mount({ files })
    const b = removeOf(files[0].file.name)
    fireEvent.mouseDown(b)
    b.focus()
    fireEvent.click(b)
    expect(c.uploads.remove).toHaveBeenCalledWith(files[0].id)
    expect(document.activeElement).toBe(b)
  })

  // DG3 (OUTSTANDING DG2-01): Choose file is a Tab stop now, and it goes at
  // the 20th upload. Pressed from the keyboard, it took focus to the page with
  // it (Chromium: <body>; the next Enter there made a full deck, MEASURED in
  // the DG3 hand-off), so focus goes to the upload it added. The card meets
  // the 20th as D.O.G.'s next render, after the picked file is read.
  function nineteen() {
    const files = Array.from({ length: UPLOAD_LIMIT }, (_, i) => up(`note-${String(i + 1).padStart(2, '0')}.txt`, 'text', 100))
    const props = (n) => ({ refs: fakeRefs([ITEM]), uploads: { files: files.slice(0, n), busy: false, add: vi.fn(), remove: vi.fn() }, projectChosen: true, onAdd: vi.fn(), onPreview: vi.fn() })
    const view = render(<ReferencesCard {...props(UPLOAD_LIMIT - 1)} />)
    return { choose: () => screen.queryByRole('button', { name: 'Choose file' }), reach20: () => view.rerender(<ReferencesCard {...props(UPLOAD_LIMIT)} />) }
  }

  it('the 20th upload from Choose file pressed by keyboard: Choose file goes, and focus goes to that upload\'s Remove, never to the page', () => {
    const c = nineteen()
    const b = c.choose()
    press(b)                                            // Enter: the press that opens the picker
    expect(document.activeElement).toBe(b)              // the picker leaves focus where it was
    c.reach20()
    expect(c.choose()).toBe(null)
    expect(document.activeElement).toBe(removeOf('note-20.txt'))
  })

  it('CONTROL, the pointer as before: Choose file clicked, the 20th upload takes it away and focus falls with it', () => {
    const c = nineteen()
    const b = c.choose()
    fireEvent.mouseDown(b)
    b.focus()
    fireEvent.click(b)
    c.reach20()
    expect(c.choose()).toBe(null)
    expect(document.activeElement).toBe(document.body)
  })

  // DG3 review round 1, note 2 (MEASURED in Chromium by the reviewer): a
  // picker closed unused leaves focus on Choose file with the keyboard's ring
  // still on it; a click on it then does not move focus, so the ring (and
  // `:focus-visible`) stays, and the 20th upload that click adds hands focus
  // on as the keyboard's would, never to the page.
  it('a click on Choose file still holding the keyboard\'s ring counts as the keyboard\'s: the 20th upload hands focus to its Remove', () => {
    const c = nineteen()
    const b = c.choose()
    press(b)                                            // Enter: the picker opens, and is closed unused
    fireEvent.mouseDown(b, { detail: 1 })               // the same button, already focused: no focus move,
    fireEvent.click(b, { detail: 1 })                   // so its ring stays (a mouse's click, detail 1)
    expect(document.activeElement).toBe(b)
    expect(b.matches(':focus-visible')).toBe(true)
    c.reach20()
    expect(document.activeElement).toBe(removeOf('note-20.txt'))
  })

  it('focus moved on by the time the 20th is read stays where it went', () => {
    const c = nineteen()
    press(c.choose())
    const add = screen.getByRole('button', { name: 'Add references' })
    add.focus()
    c.reach20()
    expect(document.activeElement).toBe(add)
  })

})
