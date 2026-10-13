/** @vitest-environment jsdom */
// =============================================================================
// settingsConfirms.test.jsx — UI overhaul D1b (W9, ruled 2026-09-11).
//
// The four native confirms on the Settings surface became the kit Dialog:
// remove a department, disconnect Google Drive, close the demo folder, reset
// the demo folder. This file proves the three on the Storage card BY MOUNTING
// THEM — the first render test on this surface — and pins the fourth (inside
// SettingsPage's DepartmentRow, which is not exported) by source text.
//
// What a source-text test cannot see and this one does: that Escape really
// cancels without running the action, that the one filled button really runs
// it once, that a failed attempt really lands in the dialog's footer with the
// dialog still open and the lock released, and that the busy lock really
// holds the X and Escape while the bridge call is in flight.
//
// 🚨 Every finding here carries a control: the action that must NOT run is
// asserted not to have run, not merely the one that must.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _resetOverlaysForTests, overlayOpen } from '../../ui/overlay'

// `reloadApp` is `window.location.reload()`, which jsdom does not implement.
const reloadApp = vi.fn()
vi.mock('../local/localDemoClient', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, reloadApp: () => reloadApp() }
})
// A solo user with no workspace has full control (S34): the gate is open, so
// the dialogs are reachable. The gate itself is pinned by workspaceRootWiring.
vi.mock('../../permissions', () => ({
  usePermissions: () => ({ ready: true, workspaceId: null, role: 'admin' }),
}))
vi.mock('../../permissions/GatedAction', () => ({ default: ({ children }) => children }))
// Outside the provider, as on the page when R.A.B.B.I.T. is not mounted;
// the real module would pull the adapters and the Supabase client in.
vi.mock('../../tools/rabbit_v0.1.0/state/RabbitProvider', () => ({ useRabbit: () => null }))

import StorageConnections from './StorageConnections'
import { resetConfirmText } from '../local/localDemoClient'

const FOLDER = 'D:\\Demos\\Friday'

// The two preload bridges the card feature-detects. Every method is a spy so
// the "did NOT run" controls are real.
function installBridges({ reset, close, clearGdrive } = {}) {
  const localDemo = {
    getState: vi.fn(async () => ({ active: FOLDER, recent: [], appDataDir: 'C:\\AppData' })),
    close: close ?? vi.fn(async () => ({ ok: true })),
    reset: reset ?? vi.fn(async () => ({ ok: true })),
    pick: vi.fn(), open: vi.fn(), forget: vi.fn(), openInExplorer: vi.fn(),
  }
  const rabbit = {
    readFilesConfig: vi.fn(async () => ({ defaultRootDir: 'C:\\Files' })),
    readGdriveTokens: vi.fn(async () => ({ access_token: 'x' })),
    clearGdrive: clearGdrive ?? vi.fn(async () => {}),
    pickDirectory: vi.fn(), writeFilesConfig: vi.fn(),
  }
  window.electronAPI = { localDemo, rabbit }
  return { localDemo, rabbit }
}

const dialogNamed = (name) => screen.getByRole('dialog', { name })
const footerOf = (dialog) => dialog.querySelector('.ui-dialog-foot')
const bodyOf = (dialog) => dialog.querySelector('.ui-dialog-body')

beforeEach(() => { _resetOverlaysForTests(); reloadApp.mockClear() })
afterEach(() => { cleanup(); delete window.electronAPI })

describe('the Storage card: close the demo folder', () => {
  it('asks in a confirm-width Dialog with the old wording; Escape cancels and runs nothing', async () => {
    const { localDemo } = installBridges()
    render(<StorageConnections />)
    fireEvent.click(await screen.findByRole('button', { name: /Close folder/ }))
    const dialog = dialogNamed('Close demo folder')
    expect(dialog.dataset.width).toBe('confirm')
    expect(overlayOpen()).toBe(true)
    expect(bodyOf(dialog).textContent).toContain('Close the demo folder "Friday"?')
    expect(bodyOf(dialog).textContent).toContain("Nothing is deleted. WILSON goes back to the projects in this computer's app data until you open a folder again.")
    expect(within(footerOf(dialog)).getByRole('button', { name: 'Close folder' }).dataset.variant).toBe('primary')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(overlayOpen()).toBe(false)
    expect(localDemo.close).not.toHaveBeenCalled()
    expect(reloadApp).not.toHaveBeenCalled()
  })

  it('the filled button closes the folder once and reloads', async () => {
    const { localDemo } = installBridges()
    render(<StorageConnections />)
    fireEvent.click(await screen.findByRole('button', { name: /Close folder/ }))
    fireEvent.click(within(footerOf(dialogNamed('Close demo folder'))).getByRole('button', { name: 'Close folder' }))
    await waitFor(() => expect(reloadApp).toHaveBeenCalledTimes(1))
    expect(localDemo.close).toHaveBeenCalledTimes(1)
  })

  it('a failure reports in the footer, keeps the dialog open, releases the lock, and reaches the card too', async () => {
    installBridges({ close: vi.fn(async () => { throw new Error('the drive is read-only') }) })
    render(<StorageConnections />)
    fireEvent.click(await screen.findByRole('button', { name: /Close folder/ }))
    const dialog = dialogNamed('Close demo folder')
    fireEvent.click(within(footerOf(dialog)).getByRole('button', { name: 'Close folder' }))
    const alert = await within(footerOf(dialog)).findByRole('alert')
    expect(alert.textContent).toContain('the drive is read-only')
    expect(screen.getByRole('dialog', { name: 'Close demo folder' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Close' }).disabled).toBe(false)   // the X: lock released
    expect(reloadApp).not.toHaveBeenCalled()
    // One live region at a time: while the dialog is up the footer carries
    // the message and the card does not (a failure used to be ONE alert).
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    // The card's own error line still says what went wrong (the old outcome),
    // so once the dialog is dismissed the message is not lost under it.
    fireEvent.click(within(footerOf(dialog)).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('the drive is read-only')
  })

  it('the X and Cancel dismiss a fresh dialog and run nothing; the card is inert only while a dialog is up', async () => {
    const { localDemo } = installBridges()
    const { container } = render(<StorageConnections />)
    const trigger = await screen.findByRole('button', { name: /Close folder/ })
    expect(container.querySelector('[inert]')).toBeNull()
    fireEvent.click(trigger)
    let dialog = dialogNamed('Close demo folder')
    // The card's content is inert behind the backdrop; the dialog is not inside it.
    const inertWrapper = container.querySelector('[inert]')
    expect(inertWrapper).not.toBeNull()
    expect(inertWrapper.contains(dialog)).toBe(false)
    expect(inertWrapper.contains(trigger)).toBe(true)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))   // the X
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(container.querySelector('[inert]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Close folder/ }))
    dialog = dialogNamed('Close demo folder')
    fireEvent.click(within(footerOf(dialog)).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(localDemo.close).not.toHaveBeenCalled()
    expect(reloadApp).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()   // nothing failed, nothing promoted to the card
  })
})

describe('the Storage card: reset the demo folder', () => {
  it('the body is resetConfirmText verbatim and the one filled button is the danger variant', async () => {
    installBridges()
    render(<StorageConnections />)
    fireEvent.click(await screen.findByRole('button', { name: /Reset demo folder/ }))
    const dialog = dialogNamed('Reset demo folder')
    expect(dialog.dataset.width).toBe('confirm')
    expect(bodyOf(dialog).textContent).toBe(resetConfirmText(FOLDER))
    expect(bodyOf(dialog).textContent).toContain('D:\\Demos\\Friday\\projects')
    expect(within(footerOf(dialog)).getByRole('button', { name: 'Reset folder' }).dataset.variant).toBe('danger')
    // The line breaks the helper writes are kept, not collapsed.
    expect(bodyOf(dialog).firstElementChild.className).toContain('whitespace-pre-wrap')
  })

  it('a refused reset lands in the footer; the next attempt can still succeed', async () => {
    const reset = vi.fn().mockResolvedValueOnce({ ok: false, error: 'the folder is locked' }).mockResolvedValueOnce({ ok: true })
    const { localDemo } = installBridges({ reset })
    render(<StorageConnections />)
    fireEvent.click(await screen.findByRole('button', { name: /Reset demo folder/ }))
    const dialog = dialogNamed('Reset demo folder')
    const go = () => fireEvent.click(within(footerOf(dialog)).getByRole('button', { name: 'Reset folder' }))
    go()
    expect((await within(footerOf(dialog)).findByRole('alert')).textContent).toContain('the folder is locked')
    expect(reloadApp).not.toHaveBeenCalled()
    go()
    // The retry clears the footer at once: a locked dialog must not still
    // show the previous failure while the new attempt is in flight.
    expect(within(footerOf(dialog)).queryByRole('alert')).toBeNull()
    await waitFor(() => expect(reloadApp).toHaveBeenCalledTimes(1))
    expect(localDemo.reset).toHaveBeenCalledTimes(2)
  })

  it('the busy lock holds the X, Cancel and Escape while the bridge call is in flight', async () => {
    let settle
    installBridges({ reset: vi.fn(() => new Promise((resolve) => { settle = resolve })) })
    render(<StorageConnections />)
    fireEvent.click(await screen.findByRole('button', { name: /Reset demo folder/ }))
    const dialog = dialogNamed('Reset demo folder')
    fireEvent.click(within(footerOf(dialog)).getByRole('button', { name: 'Reset folder' }))
    await waitFor(() => expect(dialog.getAttribute('aria-busy')).toBe('true'))
    expect(within(dialog).getByRole('button', { name: 'Close' }).disabled).toBe(true)
    expect(within(footerOf(dialog)).getByRole('button', { name: 'Cancel' }).disabled).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: 'Reset demo folder' })).toBeTruthy()
    expect(reloadApp).not.toHaveBeenCalled()
    settle({ ok: true })
    await waitFor(() => expect(reloadApp).toHaveBeenCalledTimes(1))
  })

  // jsdom does not enforce `inert`, so a click can still reach the Forget
  // button behind the backdrop here — which is exactly the case the guard
  // exists for: the folder goes away under the open dialog. The load-bearing
  // line is the `[inert]` one: the dialog's own render guard unmounts it
  // either way, and only a cleared `pending` un-inerts the card. (Under the
  // real GatedAction a denied control renders its own `inert` span, so
  // `[inert]` is unambiguous only because GatedAction is mocked here.)
  it.each([
    ['Reset demo folder', /Reset demo folder/, 'reset'],
    ['Close demo folder', /Close folder/, 'close'],
  ])('when the folder goes away under the open %s dialog, the dialog AND the confirming state go with it', async (title, trigger, action) => {
    const { localDemo } = installBridges()
    localDemo.getState = vi.fn(async () => ({ active: FOLDER, recent: [{ path: 'E:\\Other' }] }))
    localDemo.forget = vi.fn(async () => ({ ok: true, state: { active: null, recent: [] } }))
    const { container } = render(<StorageConnections />)
    fireEvent.click(await screen.findByRole('button', { name: trigger }))
    expect(dialogNamed(title)).toBeTruthy()
    expect(container.querySelector('[inert]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Forget' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // The slot cleared with the dialog: the card is no longer inert and the
    // next dialog opens clean.
    await waitFor(() => expect(container.querySelector('[inert]')).toBeNull())
    expect(localDemo[action]).not.toHaveBeenCalled()
    expect(reloadApp).not.toHaveBeenCalled()
  })
})

describe('the Storage card: disconnect Google Drive', () => {
  it('asks with the old sentence; Escape keeps the tokens; the filled primary clears them and closes', async () => {
    const { rabbit } = installBridges()
    render(<StorageConnections />)
    fireEvent.click(await screen.findByRole('button', { name: /Disconnect/ }))
    const dialog = dialogNamed('Disconnect Google Drive')
    expect(dialog.dataset.width).toBe('confirm')
    expect(bodyOf(dialog).textContent).toBe('Disconnect Google Drive? Cached tokens are removed from this machine.')
    const confirmBtn = within(footerOf(dialog)).getByRole('button', { name: 'Disconnect' })
    expect(confirmBtn.dataset.variant).toBe('primary')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(rabbit.clearGdrive).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Disconnect/ }))
    fireEvent.click(within(footerOf(dialogNamed('Disconnect Google Drive'))).getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(rabbit.clearGdrive).toHaveBeenCalledTimes(1)
    expect(rabbit.readGdriveTokens.mock.calls.length).toBeGreaterThanOrEqual(2)   // refreshed after
  })
})

// ── The fourth confirm, and the surface as a whole, by source text ───────────
// DepartmentRow is a private function inside SettingsPage.jsx, and mounting
// SettingsPage would mean mounting the app. The pin: the same Dialog, the
// same width, the old wording, the danger variant, and no native confirm
// left on either file. Source-text pins cannot tell code from prose (D1
// hand-off §5, trap 2), in both directions: the negative pin is the CALL
// form, `window.confirm(` with its paren, so a comment naming the old API
// without the paren neither satisfies nor fails it, and one that spells the
// call out does fail it; the positive pin on the danger button could be
// satisfied by a comment quoting it, so a second assertion refuses any
// comment line that carries the pattern. Describe, never quote.
describe('the Teams tab: remove a department, and no native confirm anywhere on the surface', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const settingsPage = readFileSync(join(here, '../SettingsPage.jsx'), 'utf8')
  const storageCard = readFileSync(join(here, 'StorageConnections.jsx'), 'utf8')
  const departmentRow = settingsPage.slice(settingsPage.indexOf('function DepartmentRow('))

  it('DepartmentRow asks in a confirm-width danger Dialog with the old wording', () => {
    expect(departmentRow).toContain('Remove department "{name}"?')
    expect(departmentRow).toMatch(/<Dialog\s[\s\S]{0,80}title="Remove department"[\s\S]{0,60}width="confirm"/)
    // The danger button is the one whose handler calls onRemove; neither the
    // statement order nor the handler's shape is pinned (both orders are
    // correct under React 19 batching — review round 1 traced the removal of
    // a middle row; round 2 found the earlier shape-pin went red for four
    // correct refactors).
    expect(departmentRow).toMatch(/<Button variant="danger"[^>]*onClick=\{[\s\S]{0,120}?onRemove\(/)
    expect(departmentRow).not.toMatch(/\/[/*][^\n]*variant="danger"/)   // no comment may quote the pattern
    expect(departmentRow).toContain('onClick={() => setRemoveConfirm(true)}')
  })

  it('no native confirm is left on either file, and the surface has exactly six confirm-width Dialogs', () => {
    for (const src of [settingsPage, storageCard]) expect(src).not.toMatch(/window\.confirm\s*\(/)
    // Exact counts on purpose: a LOST dialog is the defect this guards. A
    // later session that adds a confirm here updates the number and says so.
    expect((settingsPage.match(/width="confirm"/g) || []).length,
      'SettingsPage confirm-width Dialogs: the two pet dialogs (D1) plus remove-department (D1b). Added one? Update this count.').toBe(3)
    expect((storageCard.match(/width="confirm"/g) || []).length,
      'StorageConnections confirm-width Dialogs: disconnect Drive, close folder, reset folder (D1b). Added one? Update this count.').toBe(3)
  })
})
