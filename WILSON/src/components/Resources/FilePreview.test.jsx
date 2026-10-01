/** @vitest-environment jsdom */
// =============================================================================
// FilePreview.test.jsx — post-overhaul S4a, step 5: the Files preview (E9, E13,
// E14) and the Local Server's URLs for it.
//
// Mounted through the explorer's own seam (useRabbit), with fileUrl answering
// URLs and fetch stubbed. Every rule carries the control that a broken build
// would trip: markup is text AND plain text is text; a refusal names itself AND
// a success shows the file; a read is logged once AND a second file is logged;
// the cloud logs AND the Local Server leaves it to its stream route.
// =============================================================================

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  previewKindFor, tooLargeToRead, PREVIEW_TEXT_MAX, PREVIEW_PDF_BLOB_MAX, unavailableSentence, CODE_LANGUAGE,
} from './filePreview'

vi.mock('../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))

const here = dirname(fileURLToPath(import.meta.url))
const ctx = {}
const perms = { role: 'admin', ready: true, workspaceId: 'w1', userId: 'u1' }
vi.mock('../../tools/rabbit_v0.1.0/state/RabbitProvider', () => ({ useRabbit: () => ctx }))
vi.mock('../../permissions/usePermissions', () => ({ usePermissions: () => perms }))

const { default: ProjectFilesExplorer, _resetPreviewReadsForTests } = await import('./ProjectFilesExplorer')
const { localServerAdapter } = await import('../../tools/rabbit_v0.1.0/adapters/localServerAdapter')
const { managedStreamUrl } = await import('../../tools/rabbit_v0.1.0/storage/managedVideoThumbnail')
const { readBounded } = await import('./FilePreviewDialog')

const FOLDERS = [{ id: 'root', kind: 'root', path: '', name: 'Project' }]
const row = (id, name, mime, extra = {}) => ({
  id, project_id: 'p1', name, folder_id: 'root', mime_type: mime, size_bytes: 1000,
  created_at: '2026-09-01T10:00:00Z', storage_provider: 'supabase', storage_path: `projects/p1/project/x/${id}-${name}`, tags: [], ...extra,
})
let FILES

let logged
beforeEach(() => {
  FILES = [
    row('a1', 'a-still.png', 'image/png'),
    row('b2', 'b-clip.mp4', 'video/mp4'),
    row('c3', 'c-voice.mp3', 'audio/mpeg'),
    row('d4', 'd-brief.pdf', 'application/pdf'),
    row('e5', 'e-notes.md', 'text/markdown'),
    row('f6', 'f-tool.js', 'text/javascript'),
    row('g7', 'g-page.html', 'text/html'),
    row('h8', 'h-board.psd', 'image/vnd.adobe.photoshop'),
    row('i9', 'i-huge.txt', 'text/plain', { size_bytes: PREVIEW_TEXT_MAX + 1 }),
    row('j0', 'j-plain.txt', 'text/plain'),
    // Opened ONLY by the E13 tests: the read log is once per file per SESSION
    // (module-level), so a file an earlier test previewed is already logged.
    row('l1', 'l-log-once.txt', 'text/plain'),
    row('m2', 'm-log-other.js', 'text/javascript'),
    row('n3', 'n-log-local.md', 'text/markdown'),
  ]
  logged = []
  // Each test is its own session: the read log is module-level (E13), and a
  // file an earlier test previewed (the ← → walk wraps onto the last one)
  // would otherwise already be logged.
  _resetPreviewReadsForTests()
  for (const k of Object.keys(ctx)) delete ctx[k]
  Object.assign(ctx, {
    projectsIndex: { p1: { id: 'p1', title: 'One' } },
    activeProjectId: 'p1',
    adapterMode: 'supabase',
    getAdapter: () => ({
      listFolders: async () => FOLDERS,
      listFiles: async () => FILES,
      listManagedFiles: async () => [],
      supportsFileTags: async () => true,
      logFileDownloaded: async (r) => { logged.push(r.id); return true },
    }),
    fileUrl: vi.fn(async (r) => `https://signed.example/${r.id}?token=1`),
  })
  globalThis.fetch = vi.fn(async (url) => {
    // The id from either URL shape: the signed one or the desktop's stream route.
    const id = (String(url).match(/(?:signed\.example|files)\/(\w+)/) || [])[1]
    const body = {
      e5: '# Heading\n\nSome *text* <b>raw</b> [a link](javascript:alert(1)) ![pic](https://tracker.example/p.png)',
      f6: 'const x = 1\nexport default x\n',
      g7: '<script>alert(1)</script><b>bold</b>',
      j0: 'just text',
    }[id] ?? 'plain'
    return new Response(body, { status: 200, headers: { 'content-type': 'application/octet-stream' } })
  })
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview-1')
  globalThis.URL.revokeObjectURL = vi.fn()
})
afterEach(() => { cleanup(); delete window.electronAPI })

async function mountTable() {
  const utils = render(<ProjectFilesExplorer projectId="p1" showPicker={false} />)
  fireEvent.click(await screen.findByRole('tab', { name: 'Table' }))
  return utils
}
const openByDoubleClick = (name) => {
  const btn = screen.getByRole('button', { name })
  fireEvent.doubleClick(btn.closest('tr'))
}
const dialog = () => document.querySelector('[data-file-preview]')

describe('previewKindFor: what the preview may show (E9, E6)', () => {
  const k = (name, mime) => previewKindFor({ name, mime_type: mime })
  it('maps the kinds', () => {
    expect(k('a.png', 'image/png').kind).toBe('image')
    expect(k('a.JPG', '').kind).toBe('image')
    expect(k('a.mov', 'video/quicktime').kind).toBe('video')
    expect(k('a.wav', '').kind).toBe('audio')
    expect(k('a.pdf', '').kind).toBe('pdf')
    expect(k('a.md', '').kind).toBe('markdown')
    expect(k('a.js', '')).toEqual({ kind: 'code', language: 'javascript' })
    expect(k('a.fdx', '')).toEqual({ kind: 'code', language: 'markup' })
    expect(k('a.txt', '').kind).toBe('text')
    expect(k('a.fountain', '').kind).toBe('text')
  })
  it('markup is TEXT, never rendered: .html, .htm, .svg, and their mime types', () => {
    for (const [n, m] of [['a.html', ''], ['a.htm', ''], ['a.svg', ''], ['x', 'image/svg+xml'], ['x', 'text/html']]) {
      expect(k(n, m), `${n} ${m}`).toEqual({ kind: 'text', escaped: true })
    }
  })
  it('.ts is TypeScript here, not a transport stream (videoThumbnails\' own rule)', () => {
    expect(k('a.ts', '')).toEqual({ kind: 'code', language: 'typescript' })
  })
  it('what cannot be shown says why: an image the browser cannot draw, 3D (E6), anything else', () => {
    expect(k('a.psd', 'image/vnd.adobe.photoshop')).toMatchObject({ kind: 'none', reason: expect.stringMatching(/cannot draw this image format/) })
    expect(k('a.exr', '')).toMatchObject({ kind: 'none' })
    expect(k('a.fbx', '')).toMatchObject({ kind: 'none', reason: expect.stringMatching(/no 3D preview/) })
    expect(k('a.aep', 'application/octet-stream')).toMatchObject({ kind: 'none', reason: 'There is no preview for this kind of file.' })
  })
  it('text is bounded at 2 MB, media is not', () => {
    expect(tooLargeToRead({ size_bytes: PREVIEW_TEXT_MAX + 1 }, 'text')).toBe(true)
    expect(tooLargeToRead({ size_bytes: PREVIEW_TEXT_MAX }, 'code')).toBe(false)
    expect(tooLargeToRead({ size_bytes: 10 * PREVIEW_TEXT_MAX }, 'video')).toBe(false)
    expect(Object.keys(CODE_LANGUAGE).length).toBeGreaterThan(30)
  })
  it('an unavailable state is a sentence', () => {
    expect(unavailableSentence({ storage_provider: 's3' }, 'supabase')).toMatch(/your own bucket/)
    expect(unavailableSentence({}, 'fixtures')).toMatch(/dev fixtures hold no file bytes/)
    expect(unavailableSentence({}, 'supabase')).toMatch(/cannot show a preview/)
  })
})

describe('the preview dialog (E9)', () => {
  it('a double-click opens it on the workbench Dialog, titled with the file; Enter on a name does too', async () => {
    await mountTable()
    openByDoubleClick('a-still.png')
    expect(await screen.findByRole('dialog', { name: 'a-still.png' })).toBeTruthy()
    expect(dialog().getAttribute('data-width')).toBe('workbench')
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(dialog()).toBeNull())
    fireEvent.keyDown(screen.getByRole('button', { name: 'j-plain.txt' }), { key: 'Enter' })
    expect(await screen.findByRole('dialog', { name: 'j-plain.txt' })).toBeTruthy()
  })

  it('an image is an <img> from the signed inline URL', async () => {
    await mountTable()
    openByDoubleClick('a-still.png')
    const img = await waitFor(() => { const i = dialog().querySelector('img[data-pv-image]'); expect(i).not.toBeNull(); return i })
    expect(img.getAttribute('src')).toBe('https://signed.example/a1?token=1')
  })

  it('video is VideoPreview\'s player with autoplay OFF; audio has controls and no autoplay', async () => {
    await mountTable()
    openByDoubleClick('b-clip.mp4')
    const v = await waitFor(() => { const x = dialog().querySelector('video'); expect(x).not.toBeNull(); return x })
    expect(v.hasAttribute('controls')).toBe(true)
    expect(v.hasAttribute('autoplay')).toBe(false)
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }))
    openByDoubleClick('c-voice.mp3')
    const a = await waitFor(() => { const x = dialog().querySelector('audio[data-pv-audio]'); expect(x).not.toBeNull(); return x })
    expect(a.hasAttribute('autoplay')).toBe(false)
    expect(a.hasAttribute('controls')).toBe(true)
  })

  it('🚨 a cloud PDF is read and handed to the viewer as a TYPED blob, never framed by its URL (round 1, R1-SEC-02)', async () => {
    // The stored type is the attacker's to choose: say text/html.
    globalThis.fetch = vi.fn(async () => new Response('<script>top.location="https://evil.example"</script>', { status: 200, headers: { 'content-type': 'text/html' } }))
    await mountTable()
    openByDoubleClick('d-brief.pdf')
    const f = await waitFor(() => { const x = dialog().querySelector('iframe[data-pv-pdf]'); expect(x).toBeTruthy(); return x })
    expect(f.getAttribute('src')).toBe('blob:preview-1')
    expect(globalThis.URL.createObjectURL.mock.calls[0][0].type).toBe('application/pdf')
    // Fetched from the signed URL without the app's cookies.
    expect(globalThis.fetch).toHaveBeenCalledWith('https://signed.example/d4?token=1', expect.objectContaining({ credentials: 'omit' }))
    expect(dialog().querySelector('iframe[src^="https://"]')).toBeNull()
  })

  it('a cloud PDF over the size bound is not read: "too large", with its action', async () => {
    globalThis.fetch = vi.fn(async () => new Response('x', { status: 200, headers: { 'content-length': String(PREVIEW_PDF_BLOB_MAX + 1) } }))
    await mountTable()
    openByDoubleClick('d-brief.pdf')
    expect(await within(dialog()).findByText(/This PDF is too large to preview here/)).toBeTruthy()
    expect(dialog().querySelector('iframe')).toBeNull()
  })

  it('a PDF from the desktop\'s own server is read and handed to the viewer as a typed blob', async () => {
    ctx.fileUrl = vi.fn(async (r) => `/api/rabbit/projects/p1/files/${r.id}/stream`)
    await mountTable()
    openByDoubleClick('d-brief.pdf')
    const f = await waitFor(() => { const x = dialog().querySelector('iframe[data-pv-pdf]'); expect(x).not.toBeNull(); return x })
    expect(f.getAttribute('src')).toBe('blob:preview-1')
    const made = globalThis.URL.createObjectURL.mock.calls[0][0]
    expect(made.type).toBe('application/pdf')
  })

  it('🚨 HTML is shown as TEXT: no element from the file reaches the page', async () => {
    await mountTable()
    openByDoubleClick('g-page.html')
    const pre = await waitFor(() => { const x = dialog().querySelector('pre[data-pv-text="escaped"]'); expect(x).not.toBeNull(); return x })
    expect(pre.textContent).toBe('<script>alert(1)</script><b>bold</b>')
    expect(dialog().querySelector('.fx-pv-stage script, .fx-pv-stage b')).toBeNull()
  })

  it('CONTROL: a plain text file is plain text', async () => {
    await mountTable()
    openByDoubleClick('j-plain.txt')
    const pre = await waitFor(() => { const x = dialog().querySelector('pre[data-pv-text="plain"]'); expect(x).not.toBeNull(); return x })
    expect(pre.textContent).toBe('just text')
  })

  it('markdown renders, without raw HTML, without following links, without fetching images', async () => {
    await mountTable()
    openByDoubleClick('e-notes.md')
    const md = await waitFor(() => { const x = dialog()?.querySelector('[data-pv-markdown]'); expect(x?.querySelector('h1')).toBeTruthy(); return x })
    expect(md.querySelector('h1').textContent).toBe('Heading')
    expect(md.querySelector('em').textContent).toBe('text')
    expect(md.querySelector('b')).toBeNull()
    expect(md.querySelector('a')).toBeNull()
    expect(md.querySelector('img')).toBeNull()
    expect(md.textContent).toContain('[image: pic]')
  })

  it('a markdown list keeps its markers (Tailwind\'s reset strips them; seen in Electron)', () => {
    const css = readFileSync(resolve(here, 'resources.css'), 'utf8')
    const rule = /\.fx-pv-reading ul, \.fx-pv-reading ol \{([^}]*)\}/.exec(css)
    expect(rule, 'the reading list rule').toBeTruthy()
    expect(rule[1]).toMatch(/list-style: revert;/)
  })

  it('code is highlighted (react-syntax-highlighter) in its language', async () => {
    await mountTable()
    openByDoubleClick('f-tool.js')
    const code = await waitFor(() => { const x = dialog().querySelector('[data-pv-code="javascript"]'); expect(x).not.toBeNull(); return x })
    expect(code.textContent).toContain('export default x')
  })

  it('a text file over 2 MB is never read: "too large", and its action', async () => {
    await mountTable()
    openByDoubleClick('i-huge.txt')
    expect(await within(dialog()).findByText(/too large to preview here/)).toBeTruthy()
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(within(dialog()).getAllByRole('button', { name: /Download/ }).length).toBeGreaterThan(0)
  })

  it('what cannot be shown is Drive\'s card: "No preview available", the reason, the action', async () => {
    await mountTable()
    openByDoubleClick('h-board.psd')
    expect(await within(dialog()).findByText('No preview available')).toBeTruthy()
    expect(within(dialog()).getByText(/cannot draw this image format/)).toBeTruthy()
    expect(ctx.fileUrl).not.toHaveBeenCalled()
  })

  it('no URL is a sentence, never a spinner (the fixtures, an s3 body)', async () => {
    // As the app really is (round 1, R1-TST-05): the provider reports the
    // fixtures as 'supabase'; the ADAPTER's own mode says 'fixtures'.
    ctx.adapterMode = 'supabase'
    const base = ctx.getAdapter()
    ctx.getAdapter = () => ({ ...base, mode: 'fixtures' })
    ctx.fileUrl = vi.fn(async () => null)
    await mountTable()
    openByDoubleClick('a-still.png')
    expect(await within(dialog()).findByText(/dev fixtures hold no file bytes/)).toBeTruthy()
    expect(dialog().querySelector('.ui-spinner')).toBeNull()
  })

  it('a failed image re-mints ONCE, then names the failure (VideoPreview\'s rule)', async () => {
    await mountTable()
    openByDoubleClick('a-still.png')
    const img1 = await waitFor(() => { const i = dialog().querySelector('img[data-pv-image]'); expect(i).not.toBeNull(); return i })
    fireEvent.error(img1)
    const img2 = await waitFor(() => { const i = dialog().querySelector('img[data-pv-image]'); expect(i).not.toBeNull(); return i })
    expect(ctx.fileUrl).toHaveBeenCalledTimes(2)
    fireEvent.error(img2)
    expect(await within(dialog()).findByText(/Download it to view it/)).toBeTruthy()
    expect(ctx.fileUrl).toHaveBeenCalledTimes(2)
  })

  it('← and → walk the table as it is shown, and the file window follows', async () => {
    await mountTable()
    openByDoubleClick('a-still.png')
    await screen.findByRole('dialog', { name: 'a-still.png' })
    fireEvent.keyDown(dialog(), { key: 'ArrowRight' })
    expect(await screen.findByRole('dialog', { name: 'b-clip.mp4' })).toBeTruthy()
    expect(document.querySelector('[data-file-details]').getAttribute('data-file-details')).toBe('f:b2')
    fireEvent.keyDown(dialog(), { key: 'ArrowLeft' })
    fireEvent.keyDown(dialog(), { key: 'ArrowLeft' })
    // Wrapped to the LAST file of the table as it is sorted (by name).
    const last = [...FILES].map(f => f.name).sort((a, b) => a.localeCompare(b)).pop()
    expect(await screen.findByRole('dialog', { name: last })).toBeTruthy()
  })

  it('CONTROL: an arrow pressed in a control that owns arrows does not walk', async () => {
    await mountTable()
    openByDoubleClick('c-voice.mp3')
    const a = await waitFor(() => { const x = dialog().querySelector('audio'); expect(x).not.toBeNull(); return x })
    fireEvent.keyDown(a, { key: 'ArrowRight' })
    expect(screen.getByRole('dialog', { name: 'c-voice.mp3' })).toBeTruthy()
  })
})

describe('review round 1: the walk, the chevrons, the Columns view', () => {
  const sortedNames = () => [...FILES].map(f => f.name).sort((a, b) => a.localeCompare(b))
  const subtitle = () => dialog().querySelector('.ui-dialog-subtitle, [data-dialog-subtitle]')?.textContent || dialog().textContent

  it('the chevrons: Next goes FORWARD, Previous back, and the position counts from one', async () => {
    await mountTable()
    openByDoubleClick('a-still.png')
    await screen.findByRole('dialog', { name: 'a-still.png' })
    expect(within(dialog()).getByText(`1 of ${FILES.length} · Image · PNG · 1000 B`)).toBeTruthy()
    fireEvent.click(dialog().querySelector('[data-pv-next]'))
    expect(await screen.findByRole('dialog', { name: sortedNames()[1] })).toBeTruthy()
    expect(within(dialog()).getByText(new RegExp(`^2 of ${FILES.length} · `))).toBeTruthy()
    fireEvent.click(dialog().querySelector('[data-pv-prev]'))
    expect(await screen.findByRole('dialog', { name: 'a-still.png' })).toBeTruthy()
    expect(subtitle()).toBeTruthy()
  })

  it('the table walk honours the FILTER (it never steps onto a file the filter hides)', async () => {
    await mountTable()
    fireEvent.change(screen.getByLabelText('Filter'), { target: { value: 'mp' } }) // b-clip.mp4, c-voice.mp3
    openByDoubleClick('b-clip.mp4')
    await screen.findByRole('dialog', { name: 'b-clip.mp4' })
    fireEvent.keyDown(dialog(), { key: 'ArrowLeft' }) // wraps within the two
    expect(await screen.findByRole('dialog', { name: 'c-voice.mp3' })).toBeTruthy()
    expect(within(dialog()).getByText(/^2 of 2 · /)).toBeTruthy()
  })

  it('in the Columns view (the default) a double-click previews, and the walk is that FOLDER\'s files', async () => {
    const base = ctx.getAdapter()
    ctx.getAdapter = () => ({
      ...base,
      listFolders: async () => [...FOLDERS, { id: 'sub', kind: 'entity', path: 'ASSETS/sub', name: 'sub', parent_id: 'root' }],
      listFiles: async () => FILES.map(f => (f.id === 'e5' || f.id === 'f6' ? { ...f, folder_id: 'sub' } : f)),
    })
    render(<ProjectFilesExplorer projectId="p1" showPicker={false} />)
    // Columns is the default view: open the folder, then double-click a file in it.
    fireEvent.click(await screen.findByRole('button', { name: /sub/ }))
    fireEvent.doubleClick(await screen.findByRole('button', { name: /e-notes\.md/ }))
    expect(await screen.findByRole('dialog', { name: 'e-notes.md' })).toBeTruthy()
    expect(within(dialog()).getByText(/^1 of 2 · /)).toBeTruthy()
    fireEvent.keyDown(dialog(), { key: 'ArrowRight' })
    expect(await screen.findByRole('dialog', { name: 'f-tool.js' })).toBeTruthy()
    fireEvent.keyDown(dialog(), { key: 'ArrowRight' }) // wraps inside the folder, not onto a root file
    expect(await screen.findByRole('dialog', { name: 'e-notes.md' })).toBeTruthy()
  })

  it('an arrow pressed on a focused VIDEO seeks it and does not change the file', async () => {
    await mountTable()
    openByDoubleClick('b-clip.mp4')
    const v = await waitFor(() => { const x = dialog().querySelector('video'); expect(x).toBeTruthy(); return x })
    fireEvent.keyDown(v, { key: 'ArrowRight' })
    expect(screen.getByRole('dialog', { name: 'b-clip.mp4' })).toBeTruthy()
  })

  it('a step from a control INSIDE the stage keeps ← → working (focus goes to the dialog, R1-UI-08)', async () => {
    await mountTable()
    openByDoubleClick('h-board.psd')
    await within(dialog()).findByText('No preview available')
    const inStage = within(dialog().querySelector('.fx-pv-stage')).getAllByRole('button')[0]
    act(() => inStage.focus())
    fireEvent.keyDown(inStage, { key: 'ArrowRight' })
    expect(await screen.findByRole('dialog', { name: sortedNames()[sortedNames().indexOf('h-board.psd') + 1] })).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(dialog()))
    fireEvent.keyDown(document.activeElement, { key: 'ArrowRight' })
    expect(await screen.findByRole('dialog', { name: sortedNames()[sortedNames().indexOf('h-board.psd') + 2] })).toBeTruthy()
  })

  it('closing after a walk puts focus on the CURRENT file\'s name, not the one it opened on (R1-UI-06)', async () => {
    await mountTable()
    act(() => screen.getByRole('button', { name: 'a-still.png' }).focus())
    fireEvent.keyDown(screen.getByRole('button', { name: 'a-still.png' }), { key: 'Enter' })
    await screen.findByRole('dialog', { name: 'a-still.png' })
    fireEvent.keyDown(dialog(), { key: 'ArrowRight' })
    await screen.findByRole('dialog', { name: 'b-clip.mp4' })
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'b-clip.mp4' })))
  })

  it('a refusal from the preview\'s own button is shown INSIDE the preview (R1-UI-05)', async () => {
    ctx.downloadUrl = vi.fn(async () => { throw new Error('Downloading a file is refused on the dev fixtures.') })
    await mountTable()
    openByDoubleClick('h-board.psd')
    await within(dialog()).findByText('No preview available')
    fireEvent.click(within(dialog().querySelector('.fx-pv-bar')).getByRole('button', { name: /Download/ }))
    const shown = await waitFor(() => { const x = dialog().querySelector('[data-pv-action-error]'); expect(x).toBeTruthy(); return x })
    expect(shown.textContent).toBe('Downloading a file is refused on the dev fixtures.')
  })

  it('a managed file previews from ITS row id\'s stream (not the tree node\'s m: id)', async () => {
    const base = ctx.getAdapter()
    ctx.getAdapter = () => ({
      ...base,
      listManagedFiles: async () => [{ id: 'mm1', project_id: 'p1', file_name: 'z-hero.png', stored_name: 'z-hero.png', folder_path: '', mime_type: 'image/png', size_bytes: 10 }],
    })
    await mountTable()
    openByDoubleClick('z-hero.png')
    const img = await waitFor(() => { const i = dialog().querySelector('img[data-pv-image]'); expect(i).toBeTruthy(); return i })
    expect(img.getAttribute('src')).toBe(managedStreamUrl('p1', 'mm1'))
  })

  it('a cloud video does not re-mint (and rewind) when the tree is rebuilt under it (R1-UI-04)', async () => {
    const { rerender } = await mountTable()
    openByDoubleClick('b-clip.mp4')
    await waitFor(() => expect(dialog().querySelector('video')).toBeTruthy())
    expect(ctx.fileUrl).toHaveBeenCalledTimes(1)
    ctx.files = FILES.map(f => ({ ...f })) // a teammate's save: every row a new object
    rerender(<ProjectFilesExplorer projectId="p1" showPicker={false} />)
    await new Promise((r) => setTimeout(r, 20))
    expect(ctx.fileUrl).toHaveBeenCalledTimes(1)
  })
})

describe('review round 1: what a read is, and how it is fetched', () => {
  it('a cloud text read carries NO credentials (the signed URL is the grant)', async () => {
    await mountTable()
    openByDoubleClick('e-notes.md')
    await waitFor(() => expect(dialog().querySelector('[data-pv-markdown]')).toBeTruthy())
    expect(globalThis.fetch).toHaveBeenCalledWith('https://signed.example/e5?token=1', expect.objectContaining({ credentials: 'omit' }))
  })

  it('the 2 MB bound holds at READ time too: a Content-Length over it, or a body over it', async () => {
    globalThis.fetch = vi.fn(async () => new Response('x', { status: 200, headers: { 'content-length': String(PREVIEW_TEXT_MAX + 1) } }))
    await mountTable()
    openByDoubleClick('j-plain.txt')
    expect(await within(dialog()).findByText(/too large to preview here/)).toBeTruthy()
    cleanup()
    globalThis.fetch = vi.fn(async () => new Response('x'.repeat(PREVIEW_TEXT_MAX + 1), { status: 200 }))
    await mountTable()
    openByDoubleClick('j-plain.txt')
    expect(await within(dialog()).findByText(/too large to preview here/)).toBeTruthy()
  })

  it('🚨 a body with NO true length stops being read at the bound (round 2, R2-SEC-04): text and PDF', async () => {
    // A chunked answer: 1 MB at a time, no Content-Length, up to 160 MB.
    const pulled = { n: 0 }
    const chunk = new Uint8Array(1024 * 1024)
    const endless = () => new Response(new ReadableStream({
      pull(c) { pulled.n += 1; if (pulled.n > 160) c.close(); else c.enqueue(chunk) },
    }), { status: 200 })
    globalThis.fetch = vi.fn(async () => endless())
    await mountTable()
    openByDoubleClick('j-plain.txt')
    expect(await within(dialog()).findByText(/too large to preview here/)).toBeTruthy()
    expect(pulled.n).toBeLessThanOrEqual(5) // 2 MB bound: stopped at the third megabyte, not the 160th
    cleanup()
    pulled.n = 0
    await mountTable()
    openByDoubleClick('d-brief.pdf')
    expect(await within(dialog()).findByText(/This PDF is too large to preview here/)).toBeTruthy()
    expect(pulled.n).toBeLessThanOrEqual(PREVIEW_PDF_BLOB_MAX / chunk.byteLength + 3)
    expect(pulled.n).toBeLessThan(160)
  })

  it('CONTROL: readBounded returns the whole body when it fits', async () => {
    const r = await readBounded(new Response('hello'), 10, new AbortController())
    expect(r.tooLarge).toBe(false)
    expect(await r.blob.text()).toBe('hello')
    expect((await readBounded(new Response('x'.repeat(11)), 10, new AbortController())).tooLarge).toBe(true)
  })

  it('an image is logged when it has LOADED, not when its URL was minted (R1-UI-10)', async () => {
    await mountTable()
    openByDoubleClick('a-still.png')
    const img = await waitFor(() => { const i = dialog().querySelector('img[data-pv-image]'); expect(i).toBeTruthy(); return i })
    await new Promise((r) => setTimeout(r, 0))
    expect(logged).not.toContain('a1')
    fireEvent.load(img)
    await waitFor(() => expect(logged).toContain('a1'))
  })

  it('a cloud video is logged when its first frame has loaded (it was never logged)', async () => {
    await mountTable()
    openByDoubleClick('b-clip.mp4')
    const v = await waitFor(() => { const x = dialog().querySelector('video'); expect(x).toBeTruthy(); return x })
    expect(logged).not.toContain('b2')
    fireEvent.loadedData(v)
    await waitFor(() => expect(logged).toContain('b2'))
  })

  it('the log is per SESSION, not per mount: coming back to the tab does not log the file again', async () => {
    await mountTable()
    openByDoubleClick('l-log-once.txt')
    await waitFor(() => expect(logged).toContain('l1'))
    cleanup()
    await mountTable()
    openByDoubleClick('l-log-once.txt')
    await waitFor(() => expect(dialog().querySelector('pre[data-pv-text]')).toBeTruthy())
    expect(logged.filter(x => x === 'l1')).toEqual(['l1'])
  })

  it('a read the server did NOT record is tried again next time (round 2, R2-SEC-06)', async () => {
    const base = ctx.getAdapter()
    let n = 0
    ctx.getAdapter = () => ({ ...base, logFileDownloaded: async (r) => { n += 1; logged.push(r.id); return n > 1 } })
    await mountTable()
    openByDoubleClick('l-log-once.txt')
    await waitFor(() => expect(logged).toEqual(['l1'])) // refused (false)
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }))
    openByDoubleClick('l-log-once.txt')
    await waitFor(() => expect(logged).toEqual(['l1', 'l1'])) // tried again, recorded
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }))
    openByDoubleClick('l-log-once.txt')
    await waitFor(() => expect(dialog().querySelector('pre[data-pv-text]')).toBeTruthy())
    expect(logged).toEqual(['l1', 'l1']) // recorded once: not again
  })

  it('…and per PERSON: the next one signed in at this window has their own first read (R1-TST-04)', async () => {
    await mountTable()
    openByDoubleClick('l-log-once.txt')
    await waitFor(() => expect(logged).toContain('l1'))
    cleanup()
    perms.userId = 'u2'
    try {
      await mountTable()
      openByDoubleClick('l-log-once.txt')
      await waitFor(() => expect(logged.filter(x => x === 'l1')).toEqual(['l1', 'l1']))
    } finally {
      perms.userId = 'u1'
    }
  })
})

describe('E13: a preview is a read, logged once per file per session', () => {
  it('the cloud logs it through log_file_downloaded once, however often it is opened', async () => {
    await mountTable()
    openByDoubleClick('l-log-once.txt')
    await waitFor(() => expect(logged).toContain('l1'))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }))
    openByDoubleClick('l-log-once.txt')
    await screen.findByRole('dialog', { name: 'l-log-once.txt' })
    await waitFor(() => expect(dialog().querySelector('pre[data-pv-text]')).toBeTruthy())
    expect(logged.filter(x => x === 'l1')).toEqual(['l1'])
  })

  it('CONTROL: another file is logged too', async () => {
    await mountTable()
    openByDoubleClick('m-log-other.js')
    await waitFor(() => expect(logged).toContain('m2'))
  })

  it('nothing is logged when nothing could be read (no URL)', async () => {
    ctx.fileUrl = vi.fn(async () => null)
    await mountTable()
    openByDoubleClick('a-still.png')
    await within(dialog()).findByText(/cannot show a preview/)
    expect(logged).not.toContain('a1')
  })

  it('the Local Server leaves it to its stream route (throttled there), so nothing is sent', async () => {
    ctx.adapterMode = 'local_server'
    ctx.fileUrl = vi.fn(async (r) => `/api/rabbit/projects/p1/files/${r.id}/stream`)
    await mountTable()
    openByDoubleClick('n-log-local.md')
    await waitFor(() => expect(dialog().querySelector('[data-pv-markdown]')).toBeTruthy())
    expect(logged).not.toContain('n3')
    // CONTROL: the read did happen — through the stream route's own URL.
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/rabbit/projects/p1/files/n3/stream', expect.anything())
  })
})

describe('the Local Server has URLs at last (localServerAdapter, main.cjs)', () => {
  const main = readFileSync(resolve(here, '../../../electron/main.cjs'), 'utf8')
  it('fileUrl is the stream route, downloadUrl the download route as an attachment', async () => {
    const a = localServerAdapter()
    expect(await a.fileUrl({ id: 'f1', project_id: 'p1' })).toBe('/api/rabbit/projects/p1/files/f1/stream')
    expect(await a.downloadUrl({ id: 'f1', project_id: 'p1' })).toBe('/api/rabbit/projects/p1/files/f1/download?download=1')
    expect(await a.fileUrl({ id: 'f1' })).toBeNull()
  })
  // The stream route and ?download=1 are SERVED in src/lib/fileReads.test.js
  // (round 1, R1-TST-09: the source pins that stood here passed a gate that
  // admitted same-site, a misspelled header and a dropped bundle write).
  it('the routes the adapter names are fileReads.cjs\'s, mounted by main', () => {
    expect(main).toContain("require('./fileReads.cjs').mountFileStreamRead(expressApp, {")
    expect(main).toContain("require('./fileReads.cjs').attachWhenAsked(req, res, file.name, require('./localMedia.cjs').contentDisposition);")
  })
})
