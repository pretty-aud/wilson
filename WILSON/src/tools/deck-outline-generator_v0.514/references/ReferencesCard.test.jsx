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
// =============================================================================
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, screen, within } from '@testing-library/react'
import ReferencesCard, { UPLOAD_ACCEPT, UPLOAD_LIMIT, ReferencesCount, CORE_TITLE } from './ReferencesCard'

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
  const groups = () => [...view.container.querySelectorAll('.dog-refs .dog-refs-group')]
  const uploadsGroup = () => view.container.querySelector('.dog-refs .dog-refs-uploads')
  const uploadRows = () => [...view.container.querySelectorAll('.dog-refs .dog-refs-uploads .dog-refs-row')]
  // DG3 (OUTSTANDING DG2-01): Choose file is a kit button beside the hidden
  // input (it was a <label> round it, which Tab never reached).
  const choose = () => uploadsGroup()?.querySelector('button.dog-upload') || null
  const chooseInput = () => uploadsGroup()?.querySelector('input[type=file]') || null
  return { view, uploads, refs: r, body, groups, uploadsGroup, uploadRows, choose, chooseInput }
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
    fireEvent.click(c.uploadsGroup().querySelector('.dog-refs-group-label'))
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
    // The hidden input just before it (DG3), outside the button.
    expect(choose.previousElementSibling).toBe(c.chooseInput())
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
    expect(v.container.querySelector('.dog-refs-count').textContent).toBe('3 chosen · over the limit')
    expect(v.container.querySelector('.dog-refs-head-warn').textContent).toBe(' · over the limit')
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
    expect(group.querySelector('button.dog-upload').nextElementSibling).toBe(alert)
    cleanup()
    const many = Array.from({ length: UPLOAD_LIMIT }, (_, i) => up(`note-${String(i + 1).padStart(2, '0')}.txt`, 'text', 100))
    const full = render(<ReferencesCard refs={fakeRefs()} uploads={{ ...uploads, files: many, error: 'Maximum 20 files allowed' }} projectChosen onAdd={vi.fn()} onPreview={vi.fn()} />)
    expect(full.container.querySelector('button.dog-upload')).toBe(null)
    expect(full.container.querySelector('.dog-refs-uploads [role="alert"]').textContent).toBe('Maximum 20 files allowed')
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
  const said = (c) => c.body().querySelector('.dog-refs-core-said')
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
    ['no project chosen', { projectChosen: false, core: { state: 'no-project', count: 0, legacy: 0 } }, 'Core files come from a project: choose one above.'],
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
    const files = c.groups().find((g) => g.getAttribute('aria-label') === 'Files')
    expect(files.querySelector('.dog-refs-group-label').textContent).toBe('Files (2)')
    expect([...files.querySelectorAll('.dog-refs-row')].map((r) => r.querySelector('.dog-refs-core')?.textContent)).toEqual(['Core', 'Core'])
    expect(within(files).queryAllByRole('button', { name: /^Remove/ })).toHaveLength(0)
    expect(within(files).getAllByRole('button', { name: /^Preview/ })).toHaveLength(2)
    // The upload keeps its Remove: uploads still go.
    expect(within(c.uploadsGroup()).getAllByRole('button', { name: /^Remove/ })).toHaveLength(1)
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
    expect(said(gone).textContent).toBe('Core files come from a project: choose one above. Your 1 chosen reference is set aside while this is ticked; it comes back when you clear it.')
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

  it('an upload\'s Remove: focus goes to the next row\'s Remove, across the groups', () => {
    const files = UPLOADS().slice(0, 2)
    const c = mount({ files, chosen: [ITEM] })
    press(removeOf(files[0].file.name))
    expect(c.uploads.remove).toHaveBeenCalledWith(files[0].id)
    expect(document.activeElement).toBe(removeOf(files[1].file.name))
    press(removeOf(files[1].file.name))
    expect(document.activeElement).toBe(removeOf('Scene one'))            // the next row is Items' first
  })

  it('the last row\'s Remove goes to the previous row\'s; a reference\'s Remove the same', () => {
    const files = UPLOADS().slice(0, 1)
    const c = mount({ files, chosen: [ITEM, NOTE] })
    press(removeOf('A note'))
    expect(c.refs.untick).toHaveBeenCalledWith(['note:n1'])
    expect(document.activeElement).toBe(removeOf('Scene one'))
  })

  it('the only row\'s Remove goes to Add references', () => {
    const files = UPLOADS().slice(0, 1)
    mount({ files })
    press(removeOf(files[0].file.name))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add references' }))
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
