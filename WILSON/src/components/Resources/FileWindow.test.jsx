/** @vitest-environment jsdom */
// =============================================================================
// FileWindow.test.jsx — post-overhaul S4a, step 4: the Files explorer's Details
// panel IS the editor now (Audrey's E-note, E2, E3, E4, E9, E10, E11).
//
// Mounted with real rows through the explorer's own seam (useRabbit), like
// ProjectFilesExplorer.test.jsx. Every rule carries a control a broken build
// would trip: the panel absent at rest AND present when selected; Finance never
// written AND shown; Legal refused below the money gate AND allowed above it;
// another project's write carrying ITS id AND the open project's carrying
// the open id; a refusal reverting AND a success staying.
// =============================================================================

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

vi.mock('../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))

const FOLDERS = [
  { id: 'root', kind: 'root', path: '', name: 'Project' },
  { id: 'hero', kind: 'entity', path: 'ASSETS/hero-shot', name: 'hero-shot', parent_id: 'root' },
]
const FILES = [
  { id: '1', project_id: 'p1', name: 'treatment.pdf', folder_id: 'root', size_bytes: 2048, mime_type: 'application/pdf',
    created_at: '2026-09-01T10:00:00Z', storage_provider: 'supabase', storage_path: 'projects/p1/project/x/1-treatment.pdf',
    description: 'First pass', is_core_definer: false, document_kind: null, tags: ['creative'], is_financial: false },
  { id: '2', project_id: 'p1', name: 'INV-0041.pdf', folder_id: 'root', size_bytes: 900, mime_type: 'application/pdf',
    created_at: '2026-09-02T10:00:00Z', storage_provider: 'supabase', storage_path: 'projects/p1/invoices/x/2-inv.pdf',
    tags: [], is_financial: true },
  { id: '3', project_id: 'p1', name: 'mood.png', folder_id: 'root', size_bytes: 400, mime_type: 'image/png',
    created_at: '2026-09-03T10:00:00Z', storage_provider: 'local_server', storage_path: 'projects/p1/project/x/3-mood.png',
    tags: ['reference'], is_financial: false },
]
const MANAGED = [
  { id: 'm1', project_id: 'p1', file_name: 'hero_v001.mov', stored_name: 'hero_v001.mov', folder_path: 'ASSETS/hero-shot/',
    notes: 'A take', tags: ['shots'], mime_type: 'video/quicktime', size_bytes: 1000 },
]

const ctx = {}
const perms = { role: 'admin', ready: true, workspaceId: 'w1', userId: 'u1' }
vi.mock('../../tools/rabbit_v0.1.0/state/RabbitProvider', () => ({ useRabbit: () => ctx }))
vi.mock('../../permissions/usePermissions', () => ({ usePermissions: () => perms }))

const { default: ProjectFilesExplorer } = await import('./ProjectFilesExplorer')

function reset() {
  for (const k of Object.keys(ctx)) delete ctx[k]
  Object.assign(ctx, {
    projectsIndex: { p1: { id: 'p1', title: 'One' }, p2: { id: 'p2', title: 'Two' } },
    activeProjectId: 'p1',
    adapterMode: 'supabase',
    myProjectRole: null,
    projectIsStaffed: false,
    calls: [],
    getAdapter: () => ({
      listFolders: async () => FOLDERS,
      listFiles: async () => FILES,
      listManagedFiles: async () => MANAGED,
      supportsFileTags: async () => true,
    }),
  })
  ctx.patchFile = vi.fn(async (id, patch, pid) => { ctx.calls.push(['patchFile', id, patch, pid]); return { id, ...FILES.find(f => f.id === id), ...patch } })
  ctx.markFileCoreDefiner = vi.fn(async (id, on, pid) => { ctx.calls.push(['markFileCoreDefiner', id, on, pid]); return { id, ...FILES.find(f => f.id === id), is_core_definer: on } })
  ctx.updateManagedFile = vi.fn(async (id, patch, pid) => { ctx.calls.push(['updateManagedFile', id, patch, pid]); return { id, ...MANAGED.find(f => f.id === id), ...patch } })
  perms.role = 'admin'
}

beforeEach(reset)
afterEach(() => { cleanup(); delete window.electronAPI })

/** Mount on the R.A.B.B.I.T. tab (or `host: 'resources'`), switch to Table. */
async function mount({ host = 'tab', projectId = 'p1' } = {}) {
  const utils = host === 'tab'
    ? render(<ProjectFilesExplorer projectId={projectId} showPicker={false} />)
    : render(<ProjectFilesExplorer />)
  fireEvent.click(await screen.findByRole('tab', { name: 'Table' }))
  return utils
}
const nameButton = (name) => screen.getByRole('button', { name })
const panel = () => document.querySelector('[data-file-details]')

describe('the file window: collapsed at rest, opened by a file (E10, Q60)', () => {
  it('draws NO panel until a file is selected, then the facts and the editor; Close collapses it', async () => {
    await mount()
    expect(panel()).toBeNull()
    fireEvent.click(nameButton('treatment.pdf'))
    expect(panel()).not.toBeNull()
    expect([...panel().querySelectorAll('dt')].map(d => d.textContent)).toEqual(
      ['Name', 'Type', 'Size', 'Created', 'Modified', 'Duration', 'Location', 'Stored'])
    expect(panel().querySelector('[data-file-editor]')).not.toBeNull()
    fireEvent.click(within(panel()).getByRole('button', { name: 'Close details' }))
    expect(panel()).toBeNull()
  })

  it('closing the window puts focus back on the file\'s name, not on <body> (round 1, R1-UI-07)', async () => {
    await mount()
    fireEvent.click(nameButton('treatment.pdf'))
    act(() => within(panel()).getByRole('button', { name: 'Close details' }).focus())
    fireEvent.click(within(panel()).getByRole('button', { name: 'Close details' }))
    await waitFor(() => expect(document.activeElement).toBe(nameButton('treatment.pdf')))
  })

  it('the Name cell of a FILE is a button (the keyboard reaches it); a folder\'s is not; the row stays a plain <tr>', async () => {
    await mount()
    const btn = nameButton('treatment.pdf')
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.closest('tr').hasAttribute('role')).toBe(false)
    expect(btn.closest('tr').hasAttribute('tabindex')).toBe(false)
    const folderRow = [...document.querySelectorAll('.ui-table[data-files-table] tbody tr')].find(r => r.getAttribute('data-node-kind') === 'folder')
    expect(folderRow.querySelector('button.fx-name-btn')).toBeNull()
  })
})

describe('notes (E2: the note IS files.description; E11: a managed file\'s notes)', () => {
  it('commits on blur through ctx.patchFile, with the project\'s id', async () => {
    await mount()
    fireEvent.click(nameButton('treatment.pdf'))
    const box = panel().querySelector('textarea[data-file-notes]')
    expect(box.value).toBe('First pass')
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: 'Second pass' } })
    fireEvent.blur(box)
    await waitFor(() => expect(ctx.patchFile).toHaveBeenCalledWith('1', { description: 'Second pass' }, 'p1'))
  })

  it('Escape reverts and saves nothing (the kit\'s useEscapeRevert)', async () => {
    await mount()
    fireEvent.click(nameButton('treatment.pdf'))
    const box = panel().querySelector('textarea[data-file-notes]')
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: 'oops' } })
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(box.value).toBe('First pass')
    expect(ctx.patchFile).not.toHaveBeenCalled()
  })

  it('caps at 2000 characters (0075\'s files_description_len_chk)', async () => {
    await mount()
    fireEvent.click(nameButton('treatment.pdf'))
    const box = panel().querySelector('textarea[data-file-notes]')
    expect(box.getAttribute('maxlength')).toBe('2000')
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: 'x'.repeat(2100) } })
    fireEvent.blur(box)
    await waitFor(() => expect(ctx.patchFile).toHaveBeenCalled())
    expect(ctx.patchFile.mock.calls[0][1].description.length).toBe(2000)
  })

  it('a managed file writes ITS notes through updateManagedFile; Core and Kind are not offered, with E11\'s reason', async () => {
    await mount()
    fireEvent.click(nameButton('hero_v001.mov'))
    const box = panel().querySelector('textarea[data-file-notes]')
    expect(box.value).toBe('A take')
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: 'Best take' } })
    fireEvent.blur(box)
    await waitFor(() => expect(ctx.updateManagedFile).toHaveBeenCalledWith('m1', { notes: 'Best take' }, 'p1'))
    expect(panel().querySelector('[data-file-core]')).toBeNull()
    expect(panel().querySelector('[data-file-kind]')).toBeNull()
    expect(panel().querySelector('[data-core-reason]').textContent).toBe('Core files are project files; add it to the project to mark it core.')
  })
})

// Review round 1: `fireEvent.focus` focuses nothing in jsdom, so the kit's
// Escape (`e.currentTarget.blur()`) fired no blur and the "saves nothing"
// half above could not fail (R1-TST-01). These focus the box FOR REAL.
describe('notes, with the box really focused (review round 1)', () => {
  const box = () => panel().querySelector('textarea[data-file-notes]')
  const tick = () => new Promise((r) => setTimeout(r, 0))
  const tab = () => <ProjectFilesExplorer projectId="p1" showPicker={false} />

  it('🚨 Escape reverts, LEAVES the box, and saves nothing (R1-TST-01)', async () => {
    await mount()
    fireEvent.click(nameButton('treatment.pdf'))
    act(() => box().focus())
    expect(document.activeElement).toBe(box())
    fireEvent.change(box(), { target: { value: 'oops' } })
    fireEvent.keyDown(box(), { key: 'Escape' })
    expect(document.activeElement).not.toBe(box())
    expect(box().value).toBe('First pass')
    await tick()
    expect(ctx.patchFile).not.toHaveBeenCalled()
  })

  it('CONTROL: the same focus, a change and a real blur DO save', async () => {
    await mount()
    fireEvent.click(nameButton('treatment.pdf'))
    act(() => box().focus())
    fireEvent.change(box(), { target: { value: 'Second pass' } })
    act(() => box().blur())
    await waitFor(() => expect(ctx.patchFile).toHaveBeenCalledWith('1', { description: 'Second pass' }, 'p1'))
  })

  it('focusing the box and leaving it as it was writes nothing (no PATCH, no history row)', async () => {
    await mount()
    fireEvent.click(nameButton('treatment.pdf'))
    act(() => box().focus())
    act(() => box().blur())
    await tick()
    expect(ctx.patchFile).not.toHaveBeenCalled()
  })

  it('🚨 a newer note reaches the box, and a click in and out does NOT write the old one over it (R1-UI-01)', async () => {
    const { rerender } = await mount()
    fireEvent.click(nameButton('treatment.pdf'))
    expect(box().value).toBe('First pass')
    // Written on the Resources page (or by a teammate): the provider's row changes.
    ctx.files = [{ ...FILES[0], description: 'Written on Resources' }, ...FILES.slice(1)]
    rerender(tab())
    await waitFor(() => expect(box().value).toBe('Written on Resources'))
    act(() => box().focus())
    act(() => box().blur())
    await tick()
    expect(ctx.patchFile).not.toHaveBeenCalled()
  })

  it('a newer note that lands WHILE the box is focused shows once it is left untouched', async () => {
    const { rerender } = await mount()
    fireEvent.click(nameButton('treatment.pdf'))
    act(() => box().focus())
    ctx.files = [{ ...FILES[0], description: 'Teammate: final boards' }, ...FILES.slice(1)]
    rerender(tab())
    await tick()
    expect(box().value).toBe('First pass') // not pulled from under her while she is in it
    act(() => box().blur())
    await waitFor(() => expect(box().value).toBe('Teammate: final boards'))
    expect(ctx.patchFile).not.toHaveBeenCalled()
  })

  it('Escape after a newer note landed shows the NEWER note, not what the box held when it took focus', async () => {
    const { rerender } = await mount()
    fireEvent.click(nameButton('treatment.pdf'))
    act(() => box().focus())
    ctx.files = [{ ...FILES[0], description: 'Teammate: final boards' }, ...FILES.slice(1)]
    rerender(tab())
    fireEvent.change(box(), { target: { value: 'half a thought' } })
    fireEvent.keyDown(box(), { key: 'Escape' })
    await waitFor(() => expect(box().value).toBe('Teammate: final boards'))
    expect(ctx.patchFile).not.toHaveBeenCalled()
  })

  it('a refused note goes back to what is stored, and says why (R1-UI-02)', async () => {
    ctx.patchFile = vi.fn(async () => { throw new Error('permission denied for table files') })
    await mount()
    fireEvent.click(nameButton('treatment.pdf'))
    act(() => box().focus())
    fireEvent.change(box(), { target: { value: 'REFUSE me' } })
    act(() => box().blur())
    expect(await within(panel()).findByText('Could not save: permission denied for table files')).toBeTruthy()
    await waitFor(() => expect(box().value).toBe('First pass'))
  })
})

describe('Core and Kind (E2)', () => {
  it('Core is the existing flag, through markFileCoreDefiner, in her words', async () => {
    await mount()
    fireEvent.click(nameButton('treatment.pdf'))
    const sw = panel().querySelector('[data-file-core]')
    expect(sw.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(sw)
    await waitFor(() => expect(ctx.markFileCoreDefiner).toHaveBeenCalledWith('1', true, 'p1'))
    expect(panel().textContent).toContain('the script, the treatment, storyboards, mood boards')
  })

  it('Kind writes files.document_kind from the ProjectFilesTable list', async () => {
    await mount()
    fireEvent.click(nameButton('treatment.pdf'))
    const sel = panel().querySelector('select[data-file-kind]')
    expect([...sel.options].map(o => o.value)).toEqual(['', 'script', 'treatment', 'gdd', 'brief', 'pitch_bible', 'lookbook', 'deck', 'outline', 'notes', 'other'])
    fireEvent.change(sel, { target: { value: 'treatment' } })
    await waitFor(() => expect(ctx.patchFile).toHaveBeenCalledWith('1', { document_kind: 'treatment' }, 'p1'))
  })
})

describe('tags (E3 nine, E4 Finance derived and Legal gated)', () => {
  const chip = (id) => panel().querySelector(`[data-tag="${id}"]`)

  it('nine chips, the file\'s own lit; a toggle writes the whole set, in order', async () => {
    await mount()
    fireEvent.click(nameButton('treatment.pdf'))
    expect([...panel().querySelectorAll('[data-tag]')].map(c => c.textContent)).toEqual(
      ['Production', 'Creative', 'Legal', 'Finance', 'Reference', 'Assets', 'Code', 'Shots', 'Documentation'])
    expect(chip('creative').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(chip('shots'))
    await waitFor(() => expect(ctx.patchFile).toHaveBeenCalledWith('1', { tags: ['creative', 'shots'] }, 'p1'))
  })

  it('Finance is is_financial: lit on an invoice, never clickable, never written', async () => {
    await mount()
    fireEvent.click(nameButton('INV-0041.pdf'))
    expect(chip('finance').getAttribute('aria-pressed')).toBe('true')
    expect(chip('finance').disabled).toBe(true)
    fireEvent.click(chip('code'))
    await waitFor(() => expect(ctx.patchFile).toHaveBeenCalled())
    expect(ctx.patchFile.mock.calls[0][1]).toEqual({ tags: ['code'] })
  })

  it('CONTROL: Finance is dark on a file that is not financial', async () => {
    await mount()
    fireEvent.click(nameButton('treatment.pdf'))
    expect(chip('finance').getAttribute('aria-pressed')).toBe('false')
    expect(chip('finance').disabled).toBe(true)
  })

  it('Legal: below the money gate it is refused with the reason; the hint says "not restricted yet"', async () => {
    perms.role = 'user'
    ctx.myProjectRole = 'member'
    await mount()
    fireEvent.click(nameButton('treatment.pdf'))
    expect(chip('legal').disabled).toBe(true)
    expect(chip('legal').getAttribute('title')).toMatch(/admins and the project's managers/)
    expect(chip('shots').disabled).toBe(false)
    expect(panel().querySelector('[data-legal-hint]').textContent).toMatch(/not restricted yet/)
  })

  it('CONTROL: a project manager may set Legal', async () => {
    perms.role = 'user'
    ctx.myProjectRole = 'manager'
    await mount()
    fireEvent.click(nameButton('treatment.pdf'))
    expect(chip('legal').disabled).toBe(false)
    fireEvent.click(chip('legal'))
    await waitFor(() => expect(ctx.patchFile).toHaveBeenCalledWith('1', { tags: ['creative', 'legal'] }, 'p1'))
  })

  it('a database without 0085 shows a sentence instead of the chips', async () => {
    const base = ctx.getAdapter()
    ctx.getAdapter = () => ({ ...base, supportsFileTags: async () => false })
    await mount()
    fireEvent.click(nameButton('treatment.pdf'))
    await waitFor(() => expect(panel().querySelector('[data-tags-unavailable]')).not.toBeNull())
    expect(panel().querySelector('[data-tag]')).toBeNull()
  })

  it('the filter matches a tag by its word', async () => {
    await mount()
    fireEvent.change(screen.getByLabelText('Filter'), { target: { value: 'reference' } })
    const names = [...document.querySelectorAll('.ui-table[data-files-table] .fx-name-text')].map(n => n.textContent)
    expect(names).toContain('mood.png')
    expect(names).not.toContain('treatment.pdf')
  })
})

describe('the change shows at once, and a refusal goes back (Doherty)', () => {
  it('a chip lights before the write returns; a refusal un-lights it and says why', async () => {
    let fail
    ctx.patchFile = vi.fn(() => new Promise((_, reject) => { fail = () => reject(new Error('permission denied for table files')) }))
    await mount()
    fireEvent.click(nameButton('treatment.pdf'))
    fireEvent.click(panel().querySelector('[data-tag="shots"]'))
    expect(panel().querySelector('[data-tag="shots"]').getAttribute('aria-pressed')).toBe('true')
    fail()
    await waitFor(() => expect(panel().querySelector('[data-tag="shots"]').getAttribute('aria-pressed')).toBe('false'))
    expect(panel().querySelector('[data-save-error]').textContent).toBe('Could not save: permission denied for table files')
  })

  it('a refusal does not follow you onto the next file you select', async () => {
    ctx.patchFile = vi.fn(async () => { throw new Error('permission denied for table files') })
    await mount()
    fireEvent.click(nameButton('treatment.pdf'))
    fireEvent.click(panel().querySelector('[data-tag="shots"]'))
    expect(await within(panel()).findByText(/Could not save/)).toBeTruthy()
    fireEvent.click(nameButton('mood.png'))
    expect(panel().querySelector('[data-save-error]')).toBeNull()
  })

  it('an OLDER write\'s answer does not clear a NEWER edit still in flight (the per-row version)', async () => {
    const pending = []
    ctx.patchFile = vi.fn((id, patch) => new Promise((resolve) => { pending.push(() => resolve({ id, ...FILES.find(f => f.id === id), ...patch })) }))
    await mount()
    fireEvent.click(nameButton('treatment.pdf'))
    fireEvent.click(panel().querySelector('[data-tag="shots"]')) // write 1: creative, shots
    fireEvent.click(panel().querySelector('[data-tag="code"]'))  // write 2: creative, code, shots
    expect(ctx.patchFile.mock.calls.map(c => c[1].tags)).toEqual([['creative', 'shots'], ['creative', 'code', 'shots']])
    await act(async () => { pending[0]() })
    // Write 1 has answered; write 2 has not: Code is still lit.
    expect(panel().querySelector('[data-tag="code"]').getAttribute('aria-pressed')).toBe('true')
    await act(async () => { pending[1]() })
    expect(panel().querySelector('[data-tag="code"]').getAttribute('aria-pressed')).toBe('true')
  })

  it('CONTROL: a write that succeeds stays lit after it returns', async () => {
    await mount()
    fireEvent.click(nameButton('treatment.pdf'))
    fireEvent.click(panel().querySelector('[data-tag="shots"]'))
    await waitFor(() => expect(ctx.patchFile).toHaveBeenCalled())
    await new Promise(r => setTimeout(r, 0))
    expect(panel().querySelector('[data-tag="shots"]').getAttribute('aria-pressed')).toBe('true')
    expect(panel().querySelector('[data-save-error]')).toBeNull()
  })
})

describe('who may edit, and for which project', () => {
  it('the Resources page editing a project that is NOT open sends THAT project\'s id', async () => {
    ctx.activeProjectId = 'p2'
    await mount({ host: 'resources' })
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p1' } })
    fireEvent.click(await screen.findByRole('button', { name: 'treatment.pdf' }))
    fireEvent.click(panel().querySelector('[data-tag="shots"]'))
    await waitFor(() => expect(ctx.patchFile).toHaveBeenCalledWith('1', { tags: ['creative', 'shots'] }, 'p1'))
  })

  it('…and fails closed below a workspace admin / manager, saying how to edit', async () => {
    perms.role = 'user'
    ctx.activeProjectId = 'p2'
    await mount({ host: 'resources' })
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p1' } })
    fireEvent.click(await screen.findByRole('button', { name: 'treatment.pdf' }))
    expect(panel().querySelector('textarea[data-file-notes]').disabled).toBe(true)
    expect(panel().querySelector('[data-tag="shots"]').disabled).toBe(true)
    // …and Core and Kind too (round 1, mutants 3 and 4: only the box and one
    // chip were read).
    expect(panel().querySelector('[data-file-core]').disabled).toBe(true)
    expect(panel().querySelector('select[data-file-kind]').disabled).toBe(true)
    expect(panel().querySelector('[data-write-reason]').textContent).toMatch(/^Open this project in R\.A\.B\.B\.I\.T\. to change its files/)
  })

  it('🚨 nothing is SENT without the seat, even by a control that fires anyway (R1-TST-06)', async () => {
    perms.role = 'user'
    ctx.activeProjectId = 'p2'
    await mount({ host: 'resources' })
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p1' } })
    fireEvent.click(await screen.findByRole('button', { name: 'treatment.pdf' }))
    // A disabled <select> still dispatches a change event: the save path is the gate.
    fireEvent.change(panel().querySelector('select[data-file-kind]'), { target: { value: 'treatment' } })
    await new Promise((r) => setTimeout(r, 0))
    expect(ctx.patchFile).not.toHaveBeenCalled()
    expect(panel().querySelector('[data-save-error]').textContent).toMatch(/Open this project in R\.A\.B\.B\.I\.T\./)
  })

  it('Legal on a project the Resources page shows WITHOUT opening it: a workspace admin only, not a manager', async () => {
    perms.role = 'manager'
    ctx.activeProjectId = 'p2'
    await mount({ host: 'resources' })
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p1' } })
    fireEvent.click(await screen.findByRole('button', { name: 'treatment.pdf' }))
    expect(panel().querySelector('[data-tag="shots"]').disabled).toBe(false) // a manager may write…
    expect(panel().querySelector('[data-tag="legal"]').disabled).toBe(true)  // …but not Legal, unopened
    cleanup()
    perms.role = 'admin'
    await mount({ host: 'resources' })
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p1' } })
    fireEvent.click(await screen.findByRole('button', { name: 'treatment.pdf' }))
    expect(panel().querySelector('[data-tag="legal"]').disabled).toBe(false) // CONTROL: an admin may
  })

  it('CONTROL: the same person on the OPEN, unstaffed project may edit', async () => {
    perms.role = 'user'
    await mount()
    fireEvent.click(nameButton('treatment.pdf'))
    expect(panel().querySelector('textarea[data-file-notes]').disabled).toBe(false)
    expect(panel().querySelector('[data-write-reason]')).toBeNull()
  })

  it('the Local Server has no roles: everything is allowed, Legal included', async () => {
    perms.role = null
    ctx.adapterMode = 'local_server'
    await mount()
    fireEvent.click(nameButton('treatment.pdf'))
    expect(panel().querySelector('[data-tag="legal"]').disabled).toBe(false)
    expect(panel().querySelector('textarea[data-file-notes]').disabled).toBe(false)
  })
})

describe('the actions (E9)', () => {
  it('a cloud row downloads through the signed URL', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    ctx.downloadUrl = vi.fn(async () => 'https://signed.example/x?token=1')
    await mount()
    fireEvent.click(nameButton('treatment.pdf'))
    fireEvent.click(within(panel()).getByRole('button', { name: /Download/ }))
    await waitFor(() => expect(ctx.downloadUrl).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }), 'treatment.pdf'))
    expect(click).toHaveBeenCalled()
    expect(within(panel()).queryByRole('button', { name: /Show in folder/ })).toBeNull()
    click.mockRestore()
  })

  it('where nothing can sign (an s3 body), the Blob downloads under the file\'s OWN name', async () => {
    const made = []
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { made.push({ href: this.href, download: this.download }) })
    const created = URL.createObjectURL
    URL.createObjectURL = vi.fn(() => 'blob:dl-1')
    ctx.downloadUrl = vi.fn(async () => null)
    ctx.downloadFile = vi.fn(async () => new Blob(['pdf']))
    try {
      await mount()
      fireEvent.click(nameButton('treatment.pdf'))
      fireEvent.click(within(panel()).getByRole('button', { name: /Download/ }))
      await waitFor(() => expect(made).toEqual([{ href: 'blob:dl-1', download: 'treatment.pdf' }]))
    } finally {
      click.mockRestore()
      URL.createObjectURL = created
    }
  })

  it('a refusal to download is shown, not swallowed', async () => {
    ctx.downloadUrl = vi.fn(async () => { throw new Error('Downloading a file is refused on the dev fixtures.') })
    await mount()
    fireEvent.click(nameButton('treatment.pdf'))
    fireEvent.click(within(panel()).getByRole('button', { name: /Download/ }))
    expect(await within(panel()).findByText('Downloading a file is refused on the dev fixtures.')).toBeTruthy()
  })

  it('on the Local Server a file is on this computer: Show in folder and Open name the ROW, never a path', async () => {
    const openPath = vi.fn(async () => ({ ok: true }))
    window.electronAPI = { rabbit: { openPath } }
    ctx.adapterMode = 'local_server'
    await mount()
    fireEvent.click(nameButton('treatment.pdf'))
    expect(within(panel()).queryByRole('button', { name: /^Download$/ })).toBeNull()
    fireEvent.click(within(panel()).getByRole('button', { name: /Show in folder/ }))
    await waitFor(() => expect(openPath).toHaveBeenCalledWith({ source: 'files', projectId: 'p1', fileId: '1', reveal: true }))
    fireEvent.click(within(panel()).getByRole('button', { name: 'Open in default app' }))
    await waitFor(() => expect(openPath).toHaveBeenLastCalledWith({ source: 'files', projectId: 'p1', fileId: '1', reveal: false }))
    for (const call of openPath.mock.calls) expect(JSON.stringify(call)).not.toMatch(/[A-Za-z]:\\|\/Users\//)
  })

  it('a managed file is "managed"; a private project\'s body on the cloud adapter is its media key', async () => {
    const openPath = vi.fn(async () => ({ ok: true }))
    window.electronAPI = { rabbit: { openPath } }
    await mount()
    fireEvent.click(nameButton('hero_v001.mov'))
    fireEvent.click(within(panel()).getByRole('button', { name: /Show in folder/ }))
    await waitFor(() => expect(openPath).toHaveBeenCalledWith({ source: 'managed', projectId: 'p1', fileId: 'm1', reveal: true }))
    fireEvent.click(nameButton('mood.png'))
    fireEvent.click(within(panel()).getByRole('button', { name: /Show in folder/ }))
    await waitFor(() => expect(openPath).toHaveBeenLastCalledWith({ source: 'media', mediaKey: 'projects/p1/project/x/3-mood.png', reveal: true }))
  })

  it('a refusal from the desktop (a program, a missing body) is shown', async () => {
    window.electronAPI = { rabbit: { openPath: async () => ({ ok: false, error: 'WILSON does not open programs or scripts. Use Show in folder to see it.' }) } }
    ctx.adapterMode = 'local_server'
    await mount()
    fireEvent.click(nameButton('treatment.pdf'))
    fireEvent.click(within(panel()).getByRole('button', { name: 'Open in default app' }))
    expect(await within(panel()).findByText('WILSON does not open programs or scripts. Use Show in folder to see it.')).toBeTruthy()
  })

  it('Show in folder and Open are ONE unit that wraps whole, and Preview fills its line (no stray icon in a narrow footer)', async () => {
    window.electronAPI = { rabbit: { openPath: vi.fn(async () => ({ ok: true })) } }
    ctx.adapterMode = 'local_server'
    await mount()
    fireEvent.click(nameButton('treatment.pdf'))
    const reveal = within(panel()).getByRole('button', { name: /Show in folder/ })
    const open = within(panel()).getByRole('button', { name: 'Open in default app' })
    expect(reveal.parentElement).toBe(open.parentElement)
    expect(reveal.parentElement.className).toBe('fx-actions-pair')
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'resources.css'), 'utf8')
    expect(css).toMatch(/\.fx-actions-pair \{ display: inline-flex;[^}]*\}/)
    expect(css).toMatch(/\.fx-actions-row > \[data-file-preview-open\] \{ flex: 1 0 auto; \}/)
    // CONTROL: a cloud row has no pair; its Download sits in the row itself.
    ctx.adapterMode = 'supabase'
    window.electronAPI = undefined
    cleanup()
    await mount()
    fireEvent.click(nameButton('treatment.pdf'))
    const dl = within(panel()).getByRole('button', { name: /Download/ })
    expect(dl.parentElement.className).toBe('fx-actions-row')
  })

  it('CONTROL: off the desktop (no bridge) a cloud row is not offered Show in folder or Open', async () => {
    await mount()
    fireEvent.click(nameButton('treatment.pdf'))
    expect(within(panel()).queryByRole('button', { name: /Show in folder/ })).toBeNull()
    expect(within(panel()).queryByRole('button', { name: 'Open in default app' })).toBeNull()
  })
})
