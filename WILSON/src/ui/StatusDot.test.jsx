/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { StatusDot, STATUS, STATUS_TONES, statusMeta, humanizeStatus } from './StatusDot'

afterEach(cleanup)

describe('StatusDot', () => {
  it('maps every known status to a tone the stylesheet knows', () => {
    for (const [key, meta] of Object.entries(STATUS)) {
      expect(STATUS_TONES, key).toContain(meta.tone)
      expect(meta.label.length, key).toBeGreaterThan(0)
    }
    // The plan's fourteen plus the two keys the data actually uses.
    for (const k of ['not_started', 'in_progress', 'blocked', 'on_hold', 'pending_review', 'needs_revisions',
      'approved', 'final', 'omitted', 'active', 'draft', 'archived', 'online', 'offline', 'waiting_to_start', 'wrapped']) {
      expect(STATUS[k], k).toBeDefined()
    }
  })

  it('renders a dot with an accessible name and the tone as a data attribute, no inline colour', () => {
    render(<StatusDot status="blocked" />)
    const d = screen.getByRole('img', { name: 'Blocked' })
    expect(d.className).toContain('ui-status-dot')
    expect(d.dataset.tone).toBe('danger')
    expect(d.getAttribute('style')).toBeNull()
  })

  it('never blanks on an unknown status: neutral, humanised', () => {
    expect(statusMeta('needs_client_ok')).toEqual({ tone: 'neutral', label: 'Needs client ok' })
    expect(humanizeStatus('')).toBe('')
    render(<StatusDot status="needs_client_ok" />)
    expect(screen.getByRole('img', { name: 'Needs client ok' }).dataset.tone).toBe('neutral')
  })
})
