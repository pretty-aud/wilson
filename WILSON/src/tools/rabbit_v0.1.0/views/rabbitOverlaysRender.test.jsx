/** @vitest-environment jsdom */
// =============================================================================
// Lane B4c, mounted: surface 7 — the three hand-rolled overlays left on this
// surface (R4-12). AssetStatusWarningModal and RelinkDialog on the kit
// Dialog, portalled into <body>; FileAuditDrawer on the kit Drawer. What they
// DO — every word the message had, a status badge keyed on each status
// (R4-30), what each button does, Escape and the backdrop, the drawer's
// states and its stream, every relink step from the census to the summary,
// and both loaders under StrictMode's double mount — not how their source
// reads. RelinkDialog is reachable only in Local Server mode, so the walk
// cannot open it and this file is its proof: the desktop folder picker and
// the adapter's two relink calls are stubbed. None of the three asks through
// window.confirm (W9 had nothing to convert here): every test below fails if
// one does.
// =============================================================================

import { StrictMode } from 'react'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor, act } from '@testing-library/react'
import { _resetOverlaysForTests } from '../../../ui/overlay'
import { formatHistoryTimestamp } from '../components/editHistoryFormat'

vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))
const rabbit = vi.hoisted(() => ({ current: null }))

const { default: AssetStatusWarningModal } = await import('../components/AssetStatusWarningModal')
const { default: FileAuditDrawer, FILE_EVENT_META } = await import('../components/FileAuditDrawer')
const { default: RelinkDialog } = await import('../components/RelinkDialog')

let confirmSpy
beforeEach(() => { confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => true) })
afterEach(() => {
  expect(confirmSpy).not.toHaveBeenCalled()
  cleanup()
  _resetOverlaysForTests()
  delete window.electronAPI
  vi.restoreAllMocks()
})

const escape = () => fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
/** No element inside `root` decides a colour inline (a size is allowed: the kit's). */
const inlineColours = (root) => [...root.querySelectorAll('[style]')]
  .map((el) => el.getAttribute('style')).filter((s) => /color|background|border|opacity/.test(s))

/* ── AssetStatusWarningModal ─────────────────────────────────────────────── */

// A blocked asset: R4-30 was a GREEN chip whatever the status. Three of its
// four tasks are still in flight (one of them has no status at all); the
// approved one is done, and another asset's task is not this one's.
const MARA = { id: 'a1', name: 'Mara', status: 'blocked' }
const TASKS = [
  { id: 't1', asset_id: 'a1', title: 'Wardrobe fitting', status: 'in_progress' },
  { id: 't2', asset_id: 'a1', title: 'Hair test', status: 'pending_review' },
  { id: 't3', asset_id: 'a1', title: 'Casting', status: 'approved' },
  { id: 't4', asset_id: 'a1', title: 'Contract', status: null },
  { id: 't5', asset_id: 'a2', title: 'Another asset\'s task', status: 'in_progress' },
]

function warning({ asset = MARA, tasks = TASKS, updateAsset = vi.fn(async () => {}) } = {}) {
  rabbit.current = { tasks, updateAsset }
  const onClose = vi.fn()
  const utils = render(<AssetStatusWarningModal asset={asset} onClose={onClose} />)
  return { onClose, updateAsset, ...utils }
}
const warningDialog = () => screen.getByRole('dialog', { name: 'Status mismatch' })

describe('AssetStatusWarningModal — the kit Dialog', () => {
  it('is the kit Dialog in <body> at the confirm width, titled in sentence case with its glyph; every control named', () => {
    const { container } = warning()
    const dialog = warningDialog()
    expect(dialog.className).toBe('ui-dialog')
    expect(dialog.getAttribute('data-width')).toBe('confirm')
    // Portalled, as the lane's other dialogs are.
    expect(dialog.closest('.ui-dialog-backdrop').parentElement).toBe(document.body)
    expect(container.contains(dialog)).toBe(false)
    const title = dialog.querySelector('.ui-dialog-title')
    expect(title.textContent).toBe('Status mismatch')
    expect(title.querySelector('svg.rb-warn-icon').getAttribute('aria-hidden')).toBe('true')
    // The ✕ is the kit's, and it has a name now (the walk counted it unnamed).
    expect(within(dialog).getByRole('button', { name: 'Close' }).className).toBe('ui-iconbtn')
    for (const b of within(dialog).getAllByRole('button')) expect(b.getAttribute('aria-label') || b.textContent.trim()).toBeTruthy()
    expect(inlineColours(dialog)).toEqual([])
  })

  it('keeps every word of its message; the asset\'s status is the kit StatusBadge on its OWN status (R4-30)', () => {
    warning()
    const msg = warningDialog().querySelector('.rb-warn-msg')
    expect(msg.textContent).toBe('Mara is marked Blocked but 3 of its 4 tasks are still in flight.')
    // The walk proves the dialog open by these words, in one text node.
    expect([...msg.childNodes].some((n) => n.nodeType === 3 && n.textContent.includes('still in flight'))).toBe(true)
    const badge = msg.querySelector('.ui-status')
    expect(badge.getAttribute('data-status')).toBe('blocked')
    expect(badge.getAttribute('data-tone')).toBe('danger')
    expect(msg.querySelector('.rb-warn-name').textContent).toBe('Mara')
  })

  it('one task in flight reads in the singular', () => {
    warning({ asset: { id: 'a9', name: 'Lamp', status: 'final' }, tasks: [{ id: 'x', asset_id: 'a9', title: 'Wire it', status: 'not_started' }] })
    const msg = warningDialog().querySelector('.rb-warn-msg')
    expect(msg.textContent).toBe('Lamp is marked Final but 1 of its 1 task is still in flight.')
    expect(msg.querySelector('.ui-status').getAttribute('data-tone')).toBe('success')
  })

  it('lists each pending task with the kit StatusBadge on the task\'s own status; a task with no status keeps its dash', () => {
    warning()
    const dialog = warningDialog()
    expect(dialog.querySelector('.rb-warn-tasks-head').textContent).toBe('Pending tasks')
    const rows = [...dialog.querySelectorAll('.rb-warn-task')]
    expect(rows.map((r) => r.querySelector('.rb-warn-task-title').textContent)).toEqual(['Wardrobe fitting', 'Hair test', 'Contract'])
    const badges = rows.map((r) => r.querySelector('.ui-status'))
    expect(badges.map((b) => b.textContent)).toEqual(['In progress', 'Pending review', '—'])
    expect(badges.map((b) => b.getAttribute('data-tone'))).toEqual(['signal', 'warning', 'neutral'])
  })

  it('with nothing in flight there is no pending list', () => {
    warning({ tasks: [{ id: 't3', asset_id: 'a1', title: 'Casting', status: 'approved' }] })
    expect(warningDialog().querySelector('.rb-warn-tasks')).toBeNull()
  })

  it('"Bump to in-progress" is the kit primary: it sets the asset to in_progress, then closes', async () => {
    const { onClose, updateAsset } = warning()
    const bump = screen.getByRole('button', { name: 'Bump to in-progress' })
    expect(bump.className).toBe('ui-btn')
    expect(bump.getAttribute('data-variant')).toBe('primary')
    fireEvent.click(bump)
    expect(updateAsset).toHaveBeenCalledWith('a1', { status: 'in_progress' })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('a bump that fails still closes, and says why in the console', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { onClose } = warning({ updateAsset: vi.fn(async () => { throw new Error('offline') }) })
    fireEvent.click(screen.getByRole('button', { name: 'Bump to in-progress' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(warn).toHaveBeenCalledWith('[RABBIT] failed to bump asset status:', expect.any(Error))
  })

  it('"Keep as-is" is the kit secondary and only closes; the Close, Escape and a press on the backdrop close it too', () => {
    const { onClose, updateAsset } = warning()
    const dialog = warningDialog()
    const keep = within(dialog).getByRole('button', { name: 'Keep as-is' })
    expect(keep.getAttribute('data-variant')).toBe('secondary')
    fireEvent.click(keep)
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    escape()
    expect(onClose).toHaveBeenCalledTimes(3)
    // A press inside is not a press on the backdrop.
    fireEvent.mouseDown(dialog.querySelector('.rb-warn-msg'))
    expect(onClose).toHaveBeenCalledTimes(3)
    fireEvent.mouseDown(dialog.closest('.ui-dialog-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(4)
    expect(updateAsset).not.toHaveBeenCalled()
  })

  it('no asset, no dialog', () => {
    rabbit.current = { tasks: TASKS, updateAsset: vi.fn() }
    render(<AssetStatusWarningModal asset={null} onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

/* ── FileAuditDrawer ─────────────────────────────────────────────────────── */

const EVENTS = [
  { id: 'e1', event: 'uploaded', actor_label: 'Theo Lindqvist', created_at: '2026-09-19T10:00:00Z' },
  { id: 'e2', event: 'moved', actor_label: 'Dev Patel', created_at: '2026-09-20T10:00:00Z', old_path: 'ASSETS/brief.pdf', new_path: 'ASSETS/Mara/brief.pdf' },
  { id: 'e3', event: 'downloaded', actor_user_id: '1234567890abcdef', created_at: '2026-09-21T10:00:00Z' },
  { id: 'e4', event: 'purged', created_at: '2026-09-22T10:00:00Z', old_path: 'ASSETS/Mara/brief.pdf' },
  // An event this build has no word for: its own name, the quiet tone.
  { id: 'e5', event: 'exported', actor_label: 'Ada', created_at: '2026-09-23T10:00:00Z' },
]

// ONE adapter and ONE getAdapter per drawer: `load` is keyed on getAdapter,
// and a new function every render would reload the stream for ever.
function audit({ listFileEvents = vi.fn(async () => EVENTS), adapterMode = 'supabase', adapter, strict = false } = {}) {
  const a = adapter ?? { listFileEvents }
  rabbit.current = { getAdapter: () => a, adapterMode }
  const onClose = vi.fn()
  const drawer = <FileAuditDrawer fileId="f1" projectId="p1" fileName="brief.pdf" onClose={onClose} />
  const utils = render(strict ? <StrictMode>{drawer}</StrictMode> : drawer)
  return { onClose, listFileEvents, ...utils }
}
const auditDrawer = () => screen.getByRole('complementary', { name: 'File activity' })
const settled = (drawer) => waitFor(() => expect(drawer.querySelector('.rb-audit-spin').getAttribute('data-spinning')).toBe('false'))

describe('FileAuditDrawer — the kit Drawer', () => {
  it('is the kit Drawer, right, xl, with its backdrop; its title the kit\'s own (the Label step, as EditHistoryDrawer\'s); Refresh and Close named', async () => {
    const { container } = audit()
    const drawer = auditDrawer()
    expect(drawer.tagName).toBe('ASIDE')
    expect(drawer.className).toBe('ui-drawer')
    expect(drawer.getAttribute('data-side')).toBe('right')
    expect(drawer.getAttribute('data-width')).toBe('xl')
    expect(container.querySelector('.ui-drawer-backdrop')).not.toBeNull()
    const title = drawer.querySelector('.ui-drawer-title')
    expect(title.textContent).toBe('File activity')
    // A plain string title: no glyph and no lane class over the kit's rule (C8).
    expect(title.children.length).toBe(0)
    expect(within(drawer).getByRole('button', { name: 'Refresh' }).className).toBe('ui-iconbtn')
    expect(within(drawer).getByRole('button', { name: 'Close' }).className).toBe('ui-iconbtn')
    // The file's name under the head, in the mono (the sheet's).
    expect(drawer.querySelector('.rb-audit-file').textContent).toBe('brief.pdf')
    await settled(drawer)
  })

  it('draws one card per event: the kit Badge in its tone, the actor, the time, and old → new with the old struck', async () => {
    const { listFileEvents } = audit()
    const drawer = auditDrawer()
    await within(drawer).findByText('Theo Lindqvist')
    expect(listFileEvents).toHaveBeenCalledWith('f1', 'p1')
    const cards = [...drawer.querySelectorAll('.rb-audit-entry')]
    expect(cards).toHaveLength(5)
    const badges = cards.map((c) => c.querySelector('.ui-badge.rb-audit-event'))
    expect(badges.map((b) => b.textContent)).toEqual(['Uploaded', 'Moved', 'Downloaded', 'Purged', 'exported'])
    expect(badges.map((b) => b.getAttribute('data-tone'))).toEqual(['create', 'change', 'read', 'destroy', 'other'])
    for (const b of badges) expect(b.querySelector('svg')).not.toBeNull()
    // The actor: its label, else the first eight of its user id, else system.
    expect(cards.map((c) => c.querySelector('.rb-audit-actor').textContent)).toEqual(['Theo Lindqvist', 'Dev Patel', '12345678', 'system', 'Ada'])
    expect(cards[0].querySelector('.rb-audit-when').textContent).toBe(formatHistoryTimestamp('2026-09-19T10:00:00Z'))
    // A move: the old path struck through, the new one after the arrow.
    expect(cards[1].querySelector('s.rb-audit-from').textContent).toBe('ASSETS/brief.pdf')
    expect(cards[1].querySelector('.rb-audit-to').textContent).toBe('→ ASSETS/Mara/brief.pdf')
    expect(cards[1].querySelector('.rb-audit-to').title).toBe('ASSETS/Mara/brief.pdf')
    // A purge names the path it left, not struck.
    expect(cards[3].querySelector('s')).toBeNull()
    expect(cards[3].querySelector('.rb-audit-path').textContent).toBe('ASSETS/Mara/brief.pdf')
    // The colour language is the sheet's: the map carries tones, never a colour.
    expect(Object.values(FILE_EVENT_META).filter((m) => 'color' in m)).toEqual([])
    expect(inlineColours(drawer)).toEqual([])
    await settled(drawer)
  })

  it('while the stream loads: the kit Loading, and Refresh\'s glyph turns — then it stops', async () => {
    let finish
    audit({ listFileEvents: vi.fn(() => new Promise((r) => { finish = r })) })
    const drawer = auditDrawer()
    expect(within(drawer).getByRole('status', { name: 'Loading…' }).className).toBe('ui-loading-inline')
    expect(drawer.querySelector('.rb-audit-spin').getAttribute('data-spinning')).toBe('true')
    await act(async () => { finish([]) })
    expect(drawer.querySelector('.rb-audit-spin').getAttribute('data-spinning')).toBe('false')
  })

  it('an empty stream is the kit EmptyState; Refresh asks the adapter again', async () => {
    const { listFileEvents } = audit({ listFileEvents: vi.fn(async () => []) })
    const drawer = auditDrawer()
    const empty = await within(drawer).findByText('No recorded activity for this file.')
    expect(empty.closest('.ui-empty')).not.toBeNull()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(listFileEvents).toHaveBeenCalledTimes(2))
    await settled(drawer)
    expect(within(drawer).getByText('No recorded activity for this file.')).toBeTruthy()
  })

  it('a failed load is the kit danger Banner with the reason', async () => {
    audit({ listFileEvents: vi.fn(async () => { throw new Error('permission denied') }) })
    const alert = await within(auditDrawer()).findByRole('alert')
    expect(alert.className).toBe('ui-banner')
    expect(alert.getAttribute('data-tone')).toBe('danger')
    expect(alert.textContent).toBe('Could not load file activity: permission denied')
  })

  it('an adapter that records no stream says so in the kit info Banner, and the foot says where it is recorded', async () => {
    audit({ adapter: {}, adapterMode: 'local_server' })
    const drawer = auditDrawer()
    await settled(drawer)
    const notice = within(drawer).getByText(/File activity is not recorded/).closest('.ui-banner')
    expect(notice.getAttribute('data-tone')).toBe('info')
    expect(notice.textContent).toBe('File activity is not recorded by the current adapter (local_server).')
    expect(drawer.querySelector('.rb-audit-foot').textContent).toBe('Recorded locally for uploads, relinks and deletes in this project.')
    cleanup()
    audit()
    await settled(auditDrawer())
    expect(auditDrawer().querySelector('.rb-audit-foot').textContent)
      .toBe('Recorded server-side for every upload, move, relink, trash, restore and purge.')
  })

  it('the Close, Escape and a click on the backdrop each close it', async () => {
    const { onClose, container } = audit()
    const drawer = auditDrawer()
    await settled(drawer)
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    escape()
    expect(onClose).toHaveBeenCalledTimes(2)
    fireEvent.click(container.querySelector('.ui-drawer-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('under StrictMode\'s double mount the stream still lands (a dev build said "Loading…" for ever)', async () => {
    audit({ strict: true })
    expect(await within(auditDrawer()).findByText('Theo Lindqvist')).toBeTruthy()
    await settled(auditDrawer())
  })
})

/* ── RelinkDialog ────────────────────────────────────────────────────────── */

const FILES_DIR = 'D:\\Projects\\Salt Hours\\files'
const PICKED = 'E:\\Moved\\Salt Hours'
// Five files the census cannot find, and a walked folder that holds one of
// each rung's answer: the disk name (exact), the name and the size (strong),
// the name alone (name only), two same-named copies (ambiguous), and nothing.
const MISSING = [
  { id: 'm1', name: 'script_v4.pdf', storage_path: 'files/1a2b-script_v4.pdf', size_bytes: 421888 },
  { id: 'm2', name: 'Lookbook_v2.pdf', storage_path: 'files/3c4d-Lookbook_v2.pdf', size_bytes: 18800000 },
  { id: 'm3', name: 'palette.png', storage_path: 'files/5e6f-palette.png', size_bytes: 778000 },
  { id: 'm4', name: 'Boards_sh010.png', storage_path: 'files/7a8b-Boards_sh010.png', size_bytes: 1000 },
  { id: 'm5', name: 'Animatic_v2.mp4', storage_path: 'files/9c0d-Animatic_v2.mp4', size_bytes: 5 },
]
const CANDIDATES = [
  { relPath: 'scripts/1a2b-script_v4.pdf', name: '1a2b-script_v4.pdf', size: 421888 },
  { relPath: 'lookbook/Lookbook_v2.pdf', name: 'Lookbook_v2.pdf', size: 18800000 },
  { relPath: 'refs/palette.png', name: 'palette.png', size: 1 },
  { relPath: 'boards/a/Boards_sh010.png', name: 'Boards_sh010.png', size: 2 },
  { relPath: 'boards/b/Boards_sh010.png', name: 'Boards_sh010.png', size: 3 },
]
const MAPPINGS = [
  { fileId: 'm1', newPath: 'scripts/1a2b-script_v4.pdf' },
  { fileId: 'm2', newPath: 'lookbook/Lookbook_v2.pdf' },
  { fileId: 'm3', newPath: 'refs/palette.png' },
]

// `relinkScan(projectId)` is the census; `relinkScan(projectId, dir)` walks
// the picked folder. The picker is the desktop bridge's.
function relink({
  census = async () => ({ filesDir: FILES_DIR, missing: MISSING, resolved: 17 }),
  scan = async () => ({ filesDir: FILES_DIR, missing: MISSING, candidates: CANDIDATES, walkTruncated: false }),
  relinkApply = vi.fn(async (projectId, folder, mappings) => ({ relinked: mappings.length, filesDir: folder })),
  pick = async () => PICKED,
  strict = false,
} = {}) {
  const relinkScan = vi.fn((projectId, dir) => (dir ? scan(projectId, dir) : census(projectId)))
  const adapter = { relinkScan, relinkApply }
  rabbit.current = { getAdapter: () => adapter }
  const pickDirectory = vi.fn(pick)
  window.electronAPI = { rabbit: { pickDirectory } }
  const onClose = vi.fn()
  const onApplied = vi.fn()
  const dialog = <RelinkDialog projectId="p1" onClose={onClose} onApplied={onApplied} />
  const utils = render(strict ? <StrictMode>{dialog}</StrictMode> : dialog)
  return { onClose, onApplied, relinkScan, relinkApply, pickDirectory, ...utils }
}
const relinkDialog = () => screen.getByRole('dialog', { name: 'Relink missing files' })
const censusDone = () => within(relinkDialog()).findByText(/cannot be found on disk/)
/** Choose folder…, and wait for the preview. */
async function choose() {
  fireEvent.click(within(relinkDialog()).getByRole('button', { name: 'Choose folder…' }))
  await within(relinkDialog()).findByText(/^Will relink/)
}

describe('RelinkDialog — the kit Dialog, every step', () => {
  it('is the kit Dialog in <body> at its own 640, titled in sentence case with its glyph; while the census runs it says so and the picker waits', () => {
    const { container, relinkScan } = relink({ census: () => new Promise(() => {}) })
    const dialog = relinkDialog()
    expect(dialog.className).toBe('ui-dialog')
    expect(dialog.style.width).toBe('640px')
    expect(dialog.closest('.ui-dialog-backdrop').parentElement).toBe(document.body)
    expect(container.contains(dialog)).toBe(false)
    const title = dialog.querySelector('.ui-dialog-title')
    expect(title.textContent).toBe('Relink missing files')
    expect(title.querySelector('svg.rb-relink-icon').getAttribute('aria-hidden')).toBe('true')
    expect(relinkScan).toHaveBeenCalledWith('p1')
    expect(within(dialog).getByText('Checking which files are missing on disk…').className).toBe('rb-relink-prose')
    expect(within(dialog).getByRole('button', { name: 'Choose folder…' }).disabled).toBe(true)
    expect(within(dialog).getByRole('button', { name: 'Cancel' }).getAttribute('data-variant')).toBe('secondary')
    expect(within(dialog).getByRole('button', { name: 'Close' }).className).toBe('ui-iconbtn')
  })

  it('the census lists every missing file with its stored path; a cancelled pick changes nothing', async () => {
    const { pickDirectory, relinkScan } = relink({ pick: async () => null })
    const dialog = relinkDialog()
    expect((await censusDone()).textContent).toBe('5 files in this project cannot be found on disk. '
      + 'Choose the folder the files now live in; WILSON walks it and matches them by name and size.')
    const rows = [...dialog.querySelectorAll('.rb-relink-missing-row')]
    expect(rows.map((r) => r.textContent)).toEqual(MISSING.map((f) => `${f.name} · ${f.storage_path}`))
    expect(rows[0].title).toBe('files/1a2b-script_v4.pdf')
    expect(rows[0].querySelector('.rb-relink-missing-path').textContent).toBe('· files/1a2b-script_v4.pdf')
    const pickButton = within(dialog).getByRole('button', { name: 'Choose folder…' })
    expect(pickButton.disabled).toBe(false)
    fireEvent.click(pickButton)
    await waitFor(() => expect(pickDirectory).toHaveBeenCalledTimes(1))
    expect(relinkScan).toHaveBeenCalledTimes(1)
    expect(within(dialog).getByRole('button', { name: 'Choose folder…' })).toBeTruthy()
  })

  it('a census that finds nothing missing says so, and there is nothing to pick', async () => {
    relink({ census: async () => ({ filesDir: FILES_DIR, missing: [], resolved: 22 }) })
    const dialog = relinkDialog()
    expect(await within(dialog).findByText('Every file in this project resolves on disk — nothing needs relinking.')).toBeTruthy()
    expect(dialog.querySelector('.rb-relink-missing')).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Choose folder…' }).disabled).toBe(true)
  })

  it('a failed census is the kit danger Banner — and a folder can still be picked (S14)', async () => {
    relink({ census: async () => { throw new Error('the local server is not answering') } })
    const alert = await within(relinkDialog()).findByRole('alert')
    expect(alert.className).toBe('ui-banner rb-relink-error')
    expect(alert.getAttribute('data-tone')).toBe('danger')
    expect(alert.textContent).toBe('the local server is not answering')
    expect(within(relinkDialog()).getByRole('button', { name: 'Choose folder…' }).disabled).toBe(false)
  })

  it('while the picked folder is walked: the kit Spinner and the folder in the mono', async () => {
    let finish
    const { relinkScan } = relink({ scan: () => new Promise((r) => { finish = r }) })
    const dialog = relinkDialog()
    await censusDone()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose folder…' }))
    await waitFor(() => expect(dialog.querySelector('.rb-relink-progress')).not.toBeNull())
    expect(relinkScan).toHaveBeenLastCalledWith('p1', PICKED)
    const walking = dialog.querySelector('.rb-relink-progress')
    expect(walking.textContent).toBe(`Walking ${PICKED}…`)
    expect(walking.querySelector('.ui-spinner')).not.toBeNull()
    expect(walking.querySelector('.rb-relink-path').textContent).toBe(PICKED)
    // Only Cancel while it walks, and it still cancels.
    expect(within(dialog).queryByRole('button', { name: 'Choose folder…' })).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Cancel' }).disabled).toBe(false)
    await act(async () => { finish({ filesDir: FILES_DIR, missing: MISSING, candidates: CANDIDATES }) })
    expect(within(dialog).getByText(/^Will relink/)).toBeTruthy()
  })

  it('the preview: each group with its count and tone, old → new with the old struck, the confidence a kit StatusBadge, Relink N the primary', async () => {
    relink({ scan: async () => ({ filesDir: FILES_DIR, missing: MISSING, candidates: CANDIDATES, walkTruncated: true }) })
    const dialog = relinkDialog()
    await censusDone()
    await choose()
    const searched = dialog.querySelector('.rb-relink-prose')
    expect(searched.textContent).toBe(`Searched ${PICKED} (large folder — walk was capped; unmatched files may exist deeper)`)
    expect(searched.querySelector('.rb-relink-path').textContent).toBe(PICKED)
    expect(searched.querySelector('.rb-relink-capped')).not.toBeNull()
    // Applying moves where new uploads go, so the dialog says so first (S14).
    const disclosure = within(dialog).getByText(/also makes the picked folder/).closest('.ui-banner')
    expect(disclosure.getAttribute('data-tone')).toBe('warning')
    expect(disclosure.textContent).toBe('This also makes the picked folder the project\'s files folder — new uploads '
      + 'will be saved there. You can reset it later under Files & storage.')
    expect([...dialog.querySelectorAll('.rb-relink-group-head')].map((h) => [h.textContent, h.getAttribute('data-tone')])).toEqual([
      ['Will relink (3)', 'success'],
      ['Ambiguous — left untouched (1)', 'warning'],
      ['Still missing (1)', 'danger'],
    ])
    const [will, ambiguous, still] = dialog.querySelectorAll('.rb-relink-group')
    const rows = [...will.querySelectorAll('.rb-relink-row')]
    expect(rows.map((r) => r.querySelector('.rb-relink-name').textContent)).toEqual(['script_v4.pdf', 'Lookbook_v2.pdf', 'palette.png'])
    expect(rows.map((r) => [r.querySelector('.ui-status').textContent, r.querySelector('.ui-status').getAttribute('data-tone')])).toEqual([
      ['Exact match', 'success'], ['Name + size', 'success'], ['Name only', 'warning'],
    ])
    const old = rows[0].querySelector('s.rb-relink-old')
    expect(old.textContent).toBe('files/1a2b-script_v4.pdf')
    expect(old.title).toBe('files/1a2b-script_v4.pdf')
    expect(rows[0].querySelector('.rb-relink-new').textContent).toBe('→ scripts/1a2b-script_v4.pdf')
    expect(ambiguous.querySelector('.rb-relink-name').textContent).toBe('Boards_sh010.png')
    expect(ambiguous.querySelector('.rb-relink-note').textContent).toBe('2 same-name candidates — rename or remove duplicates, then rescan.')
    expect(still.querySelector('.rb-relink-unmatched').textContent).toBe('Animatic_v2.mp4')
    expect(still.querySelector('.rb-relink-unmatched').title).toBe('files/9c0d-Animatic_v2.mp4')
    const go = within(dialog).getByRole('button', { name: 'Relink 3 files' })
    expect(go.getAttribute('data-variant')).toBe('primary')
    expect(go.disabled).toBe(false)
    expect(within(dialog).getByRole('button', { name: 'Pick a different folder' }).getAttribute('data-variant')).toBe('secondary')
    expect(inlineColours(dialog)).toEqual([])
  })

  it('"Pick a different folder" opens the picker again and walks the new folder', async () => {
    let n = 0
    const { relinkScan, pickDirectory } = relink({ pick: async () => (++n === 1 ? PICKED : 'F:\\Elsewhere') })
    await censusDone()
    await choose()
    fireEvent.click(within(relinkDialog()).getByRole('button', { name: 'Pick a different folder' }))
    await waitFor(() => expect(relinkScan).toHaveBeenLastCalledWith('p1', 'F:\\Elsewhere'))
    expect(pickDirectory).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(relinkDialog().querySelector('.rb-relink-prose').textContent).toBe('Searched F:\\Elsewhere'))
  })

  it('no disclosure when the picked folder IS the files folder; a folder with no match leaves Relink 0 files disabled and says so', async () => {
    relink({ pick: async () => FILES_DIR.toUpperCase() })
    await censusDone()
    await choose()
    expect(within(relinkDialog()).queryByText(/also makes the picked folder/)).toBeNull()
    cleanup()
    _resetOverlaysForTests()
    relink({ scan: async () => ({ filesDir: FILES_DIR, missing: MISSING, candidates: [] }) })
    await censusDone()
    await choose()
    const dialog = relinkDialog()
    expect(within(dialog).getByText('No matches found in that folder.').closest('.ui-empty')).not.toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Relink 0 files' }).disabled).toBe(true)
    expect(within(dialog).getByText('Still missing (5)')).toBeTruthy()
    expect(within(dialog).queryByText(/^Ambiguous/)).toBeNull()
  })

  it('apply: busy while it runs — Close, Cancel, Escape and the backdrop all held — then the summary, onApplied, and Done closes', async () => {
    let finish
    const relinkApply = vi.fn(() => new Promise((r) => { finish = r }))
    const { onClose, onApplied } = relink({ relinkApply })
    const dialog = relinkDialog()
    await censusDone()
    await choose()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Relink 3 files' }))
    expect(relinkApply).toHaveBeenCalledWith('p1', PICKED, MAPPINGS)
    expect(dialog.getAttribute('aria-busy')).toBe('true')
    expect(dialog.querySelector('.rb-relink-progress').textContent).toBe('Relinking 3 files…')
    expect(within(dialog).getByRole('button', { name: 'Close' }).disabled).toBe(true)
    expect(within(dialog).getByRole('button', { name: 'Cancel' }).disabled).toBe(true)
    expect(within(dialog).queryByRole('button', { name: /^Relink \d/ })).toBeNull()
    escape()
    fireEvent.mouseDown(dialog.closest('.ui-dialog-backdrop'))
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => { finish({ relinked: 3, filesDir: PICKED }) })
    expect(onApplied).toHaveBeenCalledWith({ relinked: 3, filesDir: PICKED })
    expect(dialog.getAttribute('aria-busy')).toBeNull()
    const summary = dialog.querySelector('.ui-banner[data-tone="success"]')
    expect(summary.textContent).toBe(`Relinked 3 files. This project's files now resolve from ${PICKED}. `
      + 'Each relink is recorded in the file\'s activity stream.')
    expect(summary.querySelector('.rb-relink-done').textContent).toBe('Relinked 3 files.')
    expect(summary.querySelector('.rb-relink-path').textContent).toBe(PICKED)
    expect(within(dialog).queryByRole('button', { name: 'Cancel' })).toBeNull()
    const done = within(dialog).getByRole('button', { name: 'Done' })
    expect(done.getAttribute('data-variant')).toBe('primary')
    fireEvent.click(done)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a failed apply is the kit danger Banner with the reason, back on the preview with its button', async () => {
    const { onApplied } = relink({ relinkApply: vi.fn(async () => { throw new Error('409: a file vanished') }) })
    const dialog = relinkDialog()
    await censusDone()
    await choose()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Relink 3 files' }))
    await waitFor(() => expect(dialog.querySelector('.ui-banner[data-tone="danger"]')).not.toBeNull())
    expect(dialog.querySelector('.ui-banner[data-tone="danger"]').textContent).toBe('409: a file vanished')
    expect(within(dialog).getByRole('button', { name: 'Relink 3 files' }).disabled).toBe(false)
    expect(dialog.getAttribute('aria-busy')).toBeNull()
    expect(onApplied).not.toHaveBeenCalled()
  })

  it('outside the apply: Cancel, the Close, Escape and a press on the backdrop each close it', async () => {
    const { onClose } = relink()
    const dialog = relinkDialog()
    await censusDone()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    escape()
    expect(onClose).toHaveBeenCalledTimes(3)
    fireEvent.mouseDown(dialog.closest('.ui-dialog-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(4)
  })

  it('under StrictMode\'s double mount the census lands and a walk reaches the preview (a dev build stalled on both)', async () => {
    relink({ strict: true })
    await censusDone()
    await choose()
    expect(within(relinkDialog()).getByRole('button', { name: 'Relink 3 files' })).toBeTruthy()
  })
})
