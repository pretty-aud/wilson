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

describe('ProjectFilesTable — its callers (four until post-overhaul S4a; two since)', () => {
  // Post-overhaul S4a, Audrey's E1 (2026-09-29): "both go" — the Summary's
  // read-only "Project files" card AND the Control Panel's file list are gone;
  // the project's files are the Files tab (ProjectFilesExplorer). Summary
  // draws NO ProjectFilesTable now, and that zero is asserted, not omitted.
  const CALLERS = {
    'views/ProjectSummaryView.jsx': 0,
    'views/intake/IntakePrepare.jsx': 1,
    '../../components/Projects/ProjectDetailPanel.jsx': 1,
  }
  /** Every `<ProjectFilesTable …>` element in a source, WHOLE: walked to its
      closing `>` at brace depth 0 (rabbitCssGuards' jsxTags). The first cut,
      `/<ProjectFilesTable\b[^>]*>/`, stopped at the `>` of the first arrow
      prop (Summary's `onUpdate={(id, patch) => …}`), so a `variant=` after
      it was never read (B4c review round one). */
  const usesIn = (src) => jsxTags(src).filter((t) => /^<ProjectFilesTable(?![\w.])/.test(t))
  it('Intake and the Projects page draw it (Summary no longer does), and none passes a variant or maps a size', () => {
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
    expect(total).toBe(2)
    // …and the Summary does not even import it any more (E1).
    expect(read('../views/ProjectSummaryView.jsx')).not.toMatch(/import ProjectFilesTable/)
  })
  it('E1: the Control Panel keeps the project-folder controls and nothing of the file list', () => {
    const summary = read('../views/ProjectSummaryView.jsx')
    const at = summary.indexOf('function ProjectFilesSection(')
    expect(at).toBeGreaterThan(-1)
    const section = summary.slice(at, summary.indexOf('\nfunction ', at + 10))
    // Kept: the folder, its picker / Open, the relink's files folder and reset.
    expect(section).toContain('<SettingsField label="Project folder">')
    expect(section).toContain('pickAndSetProjectFolder(ctx, project)')
    expect(section).toContain('<SettingsField label="Files folder (set by relink)">')
    expect(section).toContain("update?.('files_dir', null)")
    // Gone, to the Files tab: the list, Add files, the relink notice and
    // dialog, File activity.
    for (const gone of ['ProjectFilesTable', 'uploadFile', 'RelinkDialog', 'FileAuditDrawer', 'relinkScan', 'missingCount']) {
      expect(section, gone).not.toContain(gone)
    }
    expect(section).toContain('data-files-moved')
    // …and the Summary's own read-only card with it — in any attribute order
    // or quoting (review round 1, R1-TST-16: the first cut read one spelling),
    // read as WHOLE tags (round 2, R2-TST, M13: `[^>]*` stopped at the `=>`
    // of an arrow prop written before the title).
    const PROJECT_FILES_TITLE = /\btitle=(?:"|'|\{\s*["'`])Project files/
    const projectFilesCards = (src) => jsxTags(src).filter((t) => /^<Card(?![\w.])/.test(t) && PROJECT_FILES_TITLE.test(t))
    expect(projectFilesCards(summary)).toEqual([])
    for (const card of ['<Card title="Project files">', '<Card pad={false} title="Project files">', "<Card title={'Project files'}>", '<Card\n  icon={X}\n  title={`Project files`}>',
      '<Card onClick={() => {}} title="Project files" icon={Layers}>']) {
      expect(projectFilesCards(card), card).toHaveLength(1)
    }
    expect(projectFilesCards('<Card title="Budget snapshot" icon={DollarSign}>')).toEqual([])
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
    // The Projects page makes no rows of its own since Track C / C3: every
    // upload is a store row (the local route records `size_bytes` from the
    // body), and the two legacy arrays are READ with the one field mapped
    // from the saved `size` — once, where the list is built.
    const projects = read('../../../components/Projects/ProjectsPage.jsx')
    expect(projects.match(/size_bytes: f\.size_bytes \?\? f\.size \?\? null,/g)).toHaveLength(2)
    expect(projects).not.toMatch(/readAsDataURL/)
    // The store rows are spread, not mapped back to `size`.
    expect(projects).not.toMatch(/size:\s+f\.size_bytes/)
  })
})

describe('ProjectsPage — an upload goes to the file store (Track C / C3), never to the legacy arrays', () => {
  it('a Local Server upload calls adapter.uploadFile per file — documents kinded, everything CORE — and leaves the project row alone', async () => {
    // D.O.G. still reads a LEGACY row's size by `size` (B4c review round
    // one): those arrays are read, never written, since C3. A STORED row's
    // size is `size_bytes`, which the local route records from the body.
    const dog = read('../../deck-outline-generator_v0.514/DeckOutlineGenerator.jsx')
    expect(dog).toMatch(/size: doc\.size \|\| 0/)
    expect(dog).toMatch(/size: asset\.size \|\| 0/)
    expect(dog).toMatch(/const size = row\.size_bytes \?\? 0;/)

    const stored = []
    const adapter = {
      listFiles: vi.fn(async () => stored.slice()),
      uploadFile: vi.fn(async (projectId, scope, file) => {
        const row = {
          id: `f${stored.length + 1}`, project_id: projectId, name: file.name, mime_type: file.type,
          size_bytes: file.size, document_kind: scope.documentKind, is_core_definer: !!scope.isCoreDefiner,
        }
        stored.push(row)
        return row
      }),
    }
    const updateProject = vi.fn(async () => {})
    rabbit.current = {
      adapterMode: 'local_server',
      getAdapter: () => adapter,
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
    await waitFor(() => expect(adapter.uploadFile).toHaveBeenCalledTimes(2))
    const calls = adapter.uploadFile.mock.calls
    expect(calls.map(([id]) => id)).toEqual(['p1', 'p1'])
    expect(calls.map(([, , f]) => f.name)).toEqual(['brief.txt', 'board.png'])
    // A document carries its kind (the name heuristic; 'other' when none
    // fits), media carries none; both are CORE, the legacy default (§6 #31 b).
    expect(calls[0][1]).toEqual({ documentKind: 'brief', isCoreDefiner: true })
    expect(calls[1][1]).toEqual({ documentKind: null, isCoreDefiner: true })
    // Nothing is written to `documents` / `visualAssets` any more.
    expect(updateProject).not.toHaveBeenCalled()
    // The list is re-read from the store after the batch: once on opening the
    // project, once after the uploads.
    await waitFor(() => expect(adapter.listFiles.mock.calls.length).toBeGreaterThanOrEqual(2))
    await waitFor(() => expect(screen.getByText('board.png')).toBeTruthy())
  })
})
