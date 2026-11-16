/** @vitest-environment jsdom */
// =============================================================================
// AIFileStoreCard.test.jsx — FX12 (post-overhaul, 2026-10-25, DG1-03).
//
// The Admin Terminal's "The AI's file store" card, MOUNTED: what it shows from
// ai-files' list, that nothing is deleted without the stated confirm (TS-1.5's
// second factor: the click on the strip, never the first button), what it
// says after, and that nothing it renders could carry a filename. The calls
// are stubbed at src/cloud/aiFiles.js; the function's own rules are pinned in
// src/cloud/aiFileStore.test.js.
// =============================================================================

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../cloud/auth/supabaseClient', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}))
const listAIFiles = vi.fn()
const sweepAIFiles = vi.fn()
vi.mock('../../cloud/aiFiles', () => ({
  listAIFiles: (...a) => listAIFiles(...a),
  sweepAIFiles: (...a) => sweepAIFiles(...a),
}))

const { default: AIFileStoreCard, ageOf } = await import('./AIFileStoreCard.jsx')

const H = 3600 * 1000
const list = (over = {}) => ({
  scope: 'workspace', older_than_hours: 24, count: 3, total_bytes: 2_827_657,
  oldest: new Date(Date.now() - 52 * H).toISOString(), sweepable: 2, unreachable: 0,
  files: [], ...over,
})

beforeEach(() => { listAIFiles.mockReset(); sweepAIFiles.mockReset() })
afterEach(cleanup)

describe('AIFileStoreCard', () => {
  it('shows the company\'s stored files as counts: files, size, oldest, older than the age', async () => {
    listAIFiles.mockResolvedValue(list())
    render(<AIFileStoreCard />)
    expect(await screen.findByText('3')).toBeTruthy()
    expect(screen.getByText('2.7 MB')).toBeTruthy()
    expect(screen.getByText('2 days')).toBeTruthy()
    expect(screen.getByText('Older than 24 h')).toBeTruthy()
    expect(listAIFiles).toHaveBeenCalledTimes(1)
    expect(listAIFiles.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal)
  })

  it('deletes NOTHING on the first click: the stated confirm comes first, and Cancel goes back', async () => {
    listAIFiles.mockResolvedValue(list())
    render(<AIFileStoreCard />)
    fireEvent.click(await screen.findByRole('button', { name: /Delete files older than 24 hours/ }))
    expect(sweepAIFiles).not.toHaveBeenCalled()
    expect(screen.getByText('Permanently delete 2 files older than 24 hours?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(/Permanently delete/)).toBeNull()
    expect(sweepAIFiles).not.toHaveBeenCalled()
  })

  it('the confirm runs the sweep once and says what it certified', async () => {
    listAIFiles.mockResolvedValue(list())
    sweepAIFiles.mockResolvedValue({
      ok: true,
      counts: { deleted: 2, gone: 0, failed: 0, skipped_recent: 1, certify_failed: 0, truncated: false, older_than_hours: 24 },
      after: { count: 1, total_bytes: 96_211, oldest: new Date(Date.now() - 2 * H).toISOString(), sweepable: 0 },
    })
    render(<AIFileStoreCard />)
    fireEvent.click(await screen.findByRole('button', { name: /Delete files older than 24 hours/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }))
    expect(await screen.findByText(/Deleted 2 files\./)).toBeTruthy()
    expect(screen.getByText(/Kept 1 younger than 24 hours\./)).toBeTruthy()
    expect(sweepAIFiles).toHaveBeenCalledTimes(1)
    // The counts after the run replace the ones before.
    expect(screen.getByText('94 KB')).toBeTruthy()
  })

  it('CONTROL: with nothing past the age, the delete button cannot be pressed', async () => {
    listAIFiles.mockResolvedValue(list({ sweepable: 0 }))
    render(<AIFileStoreCard />)
    const btn = await screen.findByRole('button', { name: /Delete files older than 24 hours/ })
    await waitFor(() => expect(btn.disabled).toBe(true))
  })

  it('a refusal is said, in words', async () => {
    listAIFiles.mockRejectedValue(Object.assign(new Error('x'), { code: 'list_failed', status: 502 }))
    render(<AIFileStoreCard />)
    expect(await screen.findByText(/could not be read just now/)).toBeTruthy()
  })

  it('a failed run says FAILED and points at Logs', async () => {
    listAIFiles.mockResolvedValue(list())
    sweepAIFiles.mockResolvedValue({ ok: true, counts: { deleted: 1, gone: 1, failed: 1, skipped_recent: 0, certify_failed: 0, truncated: true }, after: { count: 1, total_bytes: 5, oldest: null, sweepable: 1 } })
    render(<AIFileStoreCard />)
    fireEvent.click(await screen.findByRole('button', { name: /Delete files older than 24 hours/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }))
    expect(await screen.findByText(/1 FAILED \(see Logs, WIL-6002\)/)).toBeTruthy()
    expect(screen.getByText(/1 was already gone\./)).toBeTruthy()
    expect(screen.getByText(/More are waiting: run it again\./)).toBeTruthy()
  })

  it('nothing the card renders carries an id, a filename or a file\'s type', async () => {
    listAIFiles.mockResolvedValue(list({ files: [{ id: 'file_011SECRETIDSHOULDNOTSHOW', created_at: new Date().toISOString(), size_bytes: 9, expires_at: null, expired: false, filename: 'NOT-SHOWN.pdf' }] }))
    const { container } = render(<AIFileStoreCard />)
    await screen.findByText('3')
    expect(container.textContent).not.toMatch(/file_011|NOT-SHOWN|\.pdf/)
  })

  it('the oldest file\'s age reads in hours, then days', () => {
    const now = Date.parse('2026-10-25T12:00:00Z')
    expect(ageOf(new Date(now - 20 * 60000).toISOString(), now)).toBe('under an hour')
    expect(ageOf(new Date(now - 1 * H).toISOString(), now)).toBe('1 hour')
    expect(ageOf(new Date(now - 30 * H).toISOString(), now)).toBe('30 hours')
    expect(ageOf(new Date(now - 72 * H).toISOString(), now)).toBe('3 days')
    expect(ageOf(null, now)).toBe('—')
  })
})
