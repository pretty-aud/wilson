/** @vitest-environment jsdom */
// =============================================================================
// AIFilesSection.test.jsx — FX12 (post-overhaul, 2026-10-25, DG1-03).
//
// The operator console's "AI files" section, MOUNTED against a stubbed
// operatorApi: the counts it shows (every environment's store, this
// environment's companies, what is left alone and why), that the sweep needs
// the stated confirm, and that nothing it renders is an id or a name.
// =============================================================================

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

vi.mock('../cloud/auth/supabaseClient', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }))
const aiFilesSummary = vi.fn()
const sweepAiFiles = vi.fn()
vi.mock('./operatorApi', () => ({
  aiFilesSummary: (...a) => aiFilesSummary(...a),
  sweepAiFiles: (...a) => sweepAiFiles(...a),
  isMissingFunction: (r) => r?.status === 404 && !r?.data?.error,
}))
const { default: AIFilesSection } = await import('./AIFilesSection.jsx')

const H = 3600 * 1000
const t = (count, bytes, hoursOld) => ({ count, total_bytes: bytes, oldest: count ? new Date(Date.now() - hoursOld * H).toISOString() : null })
const summary = (over = {}) => ({
  ok: true, status: 200,
  data: {
    older_than_hours: 24, pages: 1, truncated: false, malformed: 0,
    counts: {
      all: t(9, 9_000_000, 900), attributed: { ...t(4, 4_000_000, 60), workspaces: 2, sweepable: 3 },
      no_row: t(4, 4_000_000, 900), unbound: t(1, 1_000_000, 10), expired: 1,
      ...over,
    },
  },
})

beforeEach(() => { aiFilesSummary.mockReset(); sweepAiFiles.mockReset() })
afterEach(cleanup)

describe('AIFilesSection', () => {
  it('reads on first activation and shows the store as counts, with what is left alone named', async () => {
    aiFilesSummary.mockResolvedValue(summary())
    render(<AIFilesSection isActive />)
    expect(await screen.findByText('In the store (every environment)')).toBeTruthy()
    expect(screen.getByText('Tied to a company of this environment')).toBeTruthy()
    expect(screen.getByText(/No receipt here \(another environment.s\): left alone/)).toBeTruthy()
    expect(screen.getByText(/2 companies have files here; 3 of them/)).toBeTruthy()
    expect(aiFilesSummary).toHaveBeenCalledTimes(1)
  })

  it('CONTROL: an inactive section reads nothing', () => {
    render(<AIFilesSection isActive={false} />)
    expect(aiFilesSummary).not.toHaveBeenCalled()
  })

  it('the sweep needs the stated confirm, and reports what it certified', async () => {
    aiFilesSummary.mockResolvedValue(summary())
    sweepAiFiles.mockResolvedValue({ ok: true, status: 200, data: { ok: true, counts: { deleted: 3, gone: 0, failed: 0, skipped_recent: 1, workspaces: 2, older_than_hours: 24, truncated: false }, after: summary({ attributed: { ...t(1, 1, 2), workspaces: 1, sweepable: 0 } }).data.counts } })
    render(<AIFilesSection isActive />)
    fireEvent.click(await screen.findByRole('button', { name: /Delete files older than 24 hours/ }))
    expect(sweepAiFiles).not.toHaveBeenCalled()
    expect(screen.getByText(/Permanently delete 3 files older than 24 hours, across every company of this environment\?/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Yes, delete/ }))
    expect(await screen.findByText(/Deleted 3 file\(s\) across 2 companies\. Kept 1 younger than 24 hours\./)).toBeTruthy()
    expect(sweepAiFiles).toHaveBeenCalledTimes(1)
  })

  it('a function not deployed here is said, not shown as an empty store', async () => {
    aiFilesSummary.mockResolvedValue({ ok: false, status: 404, data: {} })
    render(<AIFilesSection isActive />)
    expect(await screen.findByText(/operator-ai-files is not deployed in this environment yet/)).toBeTruthy()
  })

  it('renders no id and no name', async () => {
    aiFilesSummary.mockResolvedValue(summary())
    const { container } = render(<AIFilesSection isActive />)
    await screen.findByText('In the store (every environment)')
    expect(container.textContent).not.toMatch(/file_|\.pdf|\.png/)
  })
})
