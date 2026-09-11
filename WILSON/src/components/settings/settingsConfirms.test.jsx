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
    // The card's own error line still says what went wrong (the old outcome),
    // so once the dialog is dismissed the message is not lost under it.
    fireEvent.click(within(footerOf(dialog)).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('the drive is read-only')
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
// left on either file. The regex form is deliberate (D1 hand-off §5, trap 2):
// a comment that names the old API by name neither satisfies nor fails it.
describe('the Teams tab: remove a department, and no native confirm anywhere on the surface', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const settingsPage = readFileSync(join(here, '../SettingsPage.jsx'), 'utf8')
  const storageCard = readFileSync(join(here, 'StorageConnections.jsx'), 'utf8')
  const departmentRow = settingsPage.slice(settingsPage.indexOf('function DepartmentRow('))

  it('DepartmentRow asks in a confirm-width danger Dialog with the old wording', () => {
    expect(departmentRow).toContain('Remove department "{name}"?')
    expect(departmentRow).toMatch(/<Dialog\s[\s\S]{0,80}title="Remove department"[\s\S]{0,60}width="confirm"/)
    expect(departmentRow).toMatch(/<Button variant="danger" onClick=\{\(\) => \{ setRemoveConfirm\(false\); onRemove\(\) \}\}>/)
    expect(departmentRow).toContain('onClick={() => setRemoveConfirm(true)}')
  })

  it('no native confirm is left on either file, and the surface has exactly six confirm-width Dialogs', () => {
    for (const src of [settingsPage, storageCard]) expect(src).not.toMatch(/window\.confirm\s*\(/)
    // SettingsPage: the two pet dialogs D1 converted plus the department one.
    expect((settingsPage.match(/width="confirm"/g) || []).length).toBe(3)
    // StorageConnections: drive, close, reset.
    expect((storageCard.match(/width="confirm"/g) || []).length).toBe(3)
  })
})
