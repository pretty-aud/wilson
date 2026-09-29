/** @vitest-environment jsdom */
// =============================================================================
// Lane B4, mounted: what the files and assets surface DOES, not how its source
// reads (B2's lesson — a source-text guard pins text; 45 of 84 mutants walked
// through one). Grows one describe per surface.
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import ProjectFilesTable, { DOCUMENT_KINDS } from '../components/ProjectFilesTable'
import ProjectsPage from '../../../components/Projects/ProjectsPage'

import { jsCode, jsxTags } from '../rabbitCssGuards.js'

// The Projects page, mounted for its upload (B4c review round one): its
// context, permissions and roster, each ONE object for the whole run.
vi.mock('../../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))
vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))
vi.mock('../../../permissions/usePermissions', () => ({ usePermissions: () => perms }))
vi.mock('../../../components/TeamMembers/useTeamMembers', () => ({ useTeamMembers: () => team }))
const rabbit = vi.hoisted(() => ({ current: null }))
const perms = vi.hoisted(() => ({ role: 'admin', ready: true, can: () => true }))
const team = vi.hoisted(() => ({ members: [] }))

const here = dirname(fileURLToPath(import.meta.url))
/** A file's CODE: comments stripped, so prose that names a retired form cannot match. */
const read = (rel) => jsCode(readFileSync(join(here, rel), 'utf8').replace(/\r\n/g, '\n'))

afterEach(cleanup)

const FILES = [
  { id: 'a', name: 'brief.pdf', size_bytes: 2048, document_kind: 'pitch_bible', description: 'The fund pitch', created_at: '2026-09-19T10:00:00Z', storage_path: 'p/a', is_core_definer: true, type: 'application/pdf' },
  { id: 'b', name: 'board.png', size_bytes: 1258291, document_kind: null, description: '', created_at: '2026-09-18T10:00:00Z', is_image: true },
  // A row in the retired local shape: `size` only. The table reads ONE field.
  { id: 'c', name: 'legacy.txt', size: 900, document_kind: 'notes' },
]

describe('ProjectFilesTable — one table, on the kit', () => {
  it('draws the kit Table, dense, with one row per file and the Label-step header', () => {
    const { container } = render(<ProjectFilesTable files={FILES} readOnly />)
    const table = container.querySelector('table.ui-table')
    expect(table).not.toBeNull()
    expect(table.getAttribute('data-dense')).toBe('true')
    expect(table.querySelectorAll('tbody tr')).toHaveLength(3)
    expect([...table.querySelectorAll('th')].map((th) => th.textContent)).toEqual(
      ['Core', 'Name', 'Kind', 'Type', 'Size', 'Description', 'Created'])
    // Size is the numeric column: right-aligned, tabular, in the mono.
    expect(table.querySelector('th[data-numeric="true"]').textContent).toBe('Size')
  })

  it('one language: a `variant` prop changes nothing (the warm arm is gone)', () => {
    const a = render(<ProjectFilesTable files={FILES} readOnly />).container.innerHTML
    cleanup()
    const b = render(<ProjectFilesTable files={FILES} readOnly variant="warm" />).container.innerHTML
    expect(b).toBe(a)
  })

  it('Size reads `size_bytes` and nothing else', () => {
    const { container } = render(<ProjectFilesTable files={FILES} readOnly />)
    const sizes = [...container.querySelectorAll('tbody td[data-numeric="true"]')].map((td) => td.textContent)
    expect(sizes).toEqual(['2.0 KB', '1.2 MB', '—'])
    expect(container.querySelectorAll('tbody td[data-numeric="true"][data-empty="true"]')).toHaveLength(1)
  })

  it('read-only: words, not controls; the tick disabled; Kind in sentence case, "—" when empty', () => {
    const { container } = render(<ProjectFilesTable files={FILES} readOnly />)
    expect(container.querySelector('select')).toBeNull()
    expect(container.querySelector('input[type="text"]')).toBeNull()
    for (const box of container.querySelectorAll('input[type="checkbox"]')) expect(box.disabled).toBe(true)
    const kinds = [...container.querySelectorAll('tbody tr')].map((tr) => tr.children[2].textContent)
    expect(kinds).toEqual(['Pitch bible', '—', 'Notes'])
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })

  it('editable: every control is named for its file, and each edit reports the right patch', () => {
    const onUpdate = vi.fn()
    const onDelete = vi.fn()
    const onAudit = vi.fn()
    render(<ProjectFilesTable files={FILES} onUpdate={onUpdate} onDelete={onDelete} onAudit={onAudit} />)

    fireEvent.change(screen.getByLabelText('Kind for board.png'), { target: { value: 'lookbook' } })
    expect(onUpdate).toHaveBeenLastCalledWith('b', { document_kind: 'lookbook' })
    fireEvent.change(screen.getByLabelText('Kind for brief.pdf'), { target: { value: '' } })
    expect(onUpdate).toHaveBeenLastCalledWith('a', { document_kind: null })

    fireEvent.click(screen.getByLabelText('Core file: board.png'))
    expect(onUpdate).toHaveBeenLastCalledWith('b', { is_core_definer: true })

    const desc = screen.getByLabelText('Description for board.png')
    fireEvent.change(desc, { target: { value: 'Key art' } })
    expect(onUpdate).not.toHaveBeenCalledWith('b', { description: 'Key art' })
    fireEvent.blur(desc)
    expect(onUpdate).toHaveBeenLastCalledWith('b', { description: 'Key art' })

    fireEvent.click(screen.getByRole('button', { name: 'Delete legacy.txt' }))
    expect(onDelete).toHaveBeenLastCalledWith('c')
    // File activity only where the row has an event stream (storage_path).
    expect(screen.getAllByRole('button', { name: /^File activity for / })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'File activity for brief.pdf' }))
    expect(onAudit).toHaveBeenLastCalledWith(FILES[0])
    // The Control Panel had 32 unnamed trash buttons: none is unnamed now.
    for (const b of screen.getAllByRole('button')) expect(b.getAttribute('aria-label') || b.title).toBeTruthy()
  })

  it('offers every document kind, labelled in sentence case, with the stored value unchanged', () => {
    render(<ProjectFilesTable files={FILES} onUpdate={() => {}} />)
    const s = screen.getByLabelText('Kind for brief.pdf')
    expect([...s.options].map((o) => o.value)).toEqual(['', ...DOCUMENT_KINDS])
    expect(within(s).getByText('GDD').value).toBe('gdd')
    expect(within(s).getByText('Pitch bible').value).toBe('pitch_bible')
  })

  it('an empty list says so instead of drawing nothing (R4-13)', () => {
    render(<ProjectFilesTable files={[]} />)
    expect(screen.getByRole('status').textContent).toContain('No files attached')
  })

  it('a caller-given height makes it a scroller, carried as a custom property', () => {
    const { container } = render(<ProjectFilesTable files={FILES} readOnly maxHeight={220} />)
    const frame = container.querySelector('.rb-files-frame')
    expect(frame.getAttribute('data-scroll')).toBe('true')
    expect(frame.style.getPropertyValue('--rb-files-max')).toBe('220px')
  })
})

describe('ProjectFilesTable — the four callers', () => {
  const CALLERS = {
    'views/ProjectSummaryView.jsx': 2,
    'views/intake/IntakePrepare.jsx': 1,
    '../../components/Projects/ProjectDetailPanel.jsx': 1,
  }
  /** Every `<ProjectFilesTable …>` element in a source, WHOLE: walked to its
      closing `>` at brace depth 0 (rabbitCssGuards' jsxTags). The first cut,
      `/<ProjectFilesTable\b[^>]*>/`, stopped at the `>` of the first arrow
      prop (Summary's `onUpdate={(id, patch) => …}`), so a `variant=` after
      it was never read (B4c review round one). */
  const usesIn = (src) => jsxTags(src).filter((t) => /^<ProjectFilesTable(?![\w.])/.test(t))
  it('Intake, Summary (twice) and the Projects page all draw it, and none passes a variant or maps a size', () => {
    let total = 0
    for (const [file, n] of Object.entries(CALLERS)) {
      const src = read(`../${file}`)
      const uses = usesIn(src)
      expect(uses, file).toHaveLength(n)
      total += uses.length
      for (const u of uses) {
        // The whole element was read: every caller passes a height, and
        // Summary's comes after its three arrow props.
        expect(u, file).toMatch(/\smaxHeight=\{\d+\}/)
        expect(u, file).not.toMatch(/\svariant=/)
      }
      expect(src, file).not.toMatch(/withDisplaySize/)
    }
    expect(total).toBe(4)
  })
  it('CONTROL: a variant after an arrow prop is read (the first cut missed it)', () => {
    const src = '<ProjectFilesTable files={f} onUpdate={(id, p) => save(id, p)} variant="warm" maxHeight={300} />'
    expect(src.match(/<ProjectFilesTable\b[^>]*>/gs)[0]).not.toMatch(/\svariant=/)
    expect(usesIn(src)).toHaveLength(1)
    expect(usesIn(src)[0]).toMatch(/\svariant=/)
    expect(usesIn('<ProjectFilesTableX files={f} />')).toEqual([])
  })
  it('the rows that are not `files` rows carry `size_bytes` where they are made', () => {
    expect(read('../views/intake/IntakePrepare.jsx')).toMatch(/size_bytes: f\.size,/)
    const projects = read('../../../components/Projects/ProjectsPage.jsx')
    expect(projects).toMatch(/size_bytes:\s+file\.size,/)
    // The cloud rows are spread, not mapped back to `size`.
    expect(projects).not.toMatch(/size:\s+f\.size_bytes/)
  })
})

describe('ProjectsPage — an upload is written in both size spellings', () => {
  it('a local upload writes `size_bytes` (ProjectFilesTable\'s one field) AND `size` (what D.O.G. reads from the same two arrays)', async () => {
    // The premise, in D.O.G.'s own source (not edited here): it reads a
    // project's documents and visual assets by `size`. With `size_bytes`
    // alone, a file uploaded here reached it as 0 bytes (B4c review round one).
    const dog = read('../../deck-outline-generator_v0.514/DeckOutlineGenerator.jsx')
    expect(dog).toMatch(/size: doc\.size \|\| 0/)
    expect(dog).toMatch(/size: asset\.size \|\| 0/)

    const updateProject = vi.fn(async () => {})
    rabbit.current = {
      adapterMode: 'local',
      projectsIndex: { p1: { id: 'p1', title: 'Salt Hours', documents: [], visualAssets: [] } },
      updateProject,
      setActiveProject: vi.fn(),
    }
    const { container } = render(<ProjectsPage />)
    fireEvent.click(screen.getByText('Salt Hours'))
    const picker = container.querySelector('input[type="file"]')
    const brief = new File(['hello'], 'brief.txt', { type: 'text/plain' })
    const board = new File(['12345678'], 'board.png', { type: 'image/png' })
    fireEvent.change(picker, { target: { files: [brief, board] } })
    await waitFor(() => expect(updateProject).toHaveBeenCalledTimes(1))
    const [id, patch] = updateProject.mock.calls[0]
    expect(id).toBe('p1')
    // A document to `documents`, a picture to `visualAssets` — each in both spellings.
    expect(patch.documents.map((f) => [f.name, f.size, f.size_bytes])).toEqual([['brief.txt', 5, 5]])
    expect(patch.visualAssets.map((f) => [f.name, f.size, f.size_bytes])).toEqual([['board.png', 8, 8]])
  })
})
