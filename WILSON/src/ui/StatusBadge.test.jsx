/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { StatusBadge } from './StatusBadge'

afterEach(cleanup)

describe('StatusBadge', () => {
  // B1 kit request 1 (2026-09-23): the inner dot passed `title={undefined}`,
  // and StatusDot's `title ?? name` then gave it a tooltip of its OWN — the
  // status's label, or "Unknown" for a badge called with a tone and a word
  // but no status key (R.A.B.B.I.T.'s LIVE pill, Summary's row tags). The
  // dot sits inside the badge, so the dot's tooltip won the hover.
  // B1 review round two: `title=""` was no better — Chromium takes the
  // tooltip from the first ancestor with a title attribute, and "" counts, so
  // the dot became a dead zone. The dot carries the BADGE's title instead.
  it('the inner dot shows the badge title, never one of its own', () => {
    const { container } = render(<StatusBadge tone="success" label="Live" title="Live sync connected" />)
    const dot = container.querySelector('.ui-status .ui-status-dot')
    expect(dot).not.toBeNull()
    expect(dot.getAttribute('title')).toBe('Live sync connected')
    expect(container.querySelector('.ui-status').getAttribute('title')).toBe('Live sync connected')
  })

  it('with no badge title the dot has none either (not "Unknown", not a status label)', () => {
    const { container } = render(<StatusBadge tone="danger" label="Blocked tag" />)
    const dot = container.querySelector('.ui-status .ui-status-dot')
    expect(dot.getAttribute('title')).toBe('')
  })

  it('renders the word next to a dot, tone on both, from one source', () => {
    render(<StatusBadge status="approved" />)
    const b = screen.getByText('Approved').closest('.ui-status')
    expect(b.dataset.tone).toBe('success')
    expect(b.dataset.status).toBe('approved')
    const dot = b.querySelector('.ui-status-dot')
    expect(dot.dataset.tone).toBe('success')
    expect(dot.getAttribute('aria-hidden')).toBe('true')
    expect(b.getAttribute('style')).toBeNull()
  })

  it('lets a caller override the word without changing the tone', () => {
    render(<StatusBadge status="in_progress">3 running</StatusBadge>)
    const b = screen.getByText('3 running').closest('.ui-status')
    expect(b.dataset.tone).toBe('signal')
  })

  it('on a light surface the tone is carried by the word alone', () => {
    render(<StatusBadge status="blocked" surface="light" />)
    const b = screen.getByText('Blocked').closest('.ui-status')
    expect(b.dataset.surface).toBe('light')
    expect(b.querySelector('.ui-status-dot').dataset.surface).toBe('light')
  })

  it('composes StatusDot rather than repeating its markup, and hides it from AT', () => {
    const { container } = render(<StatusBadge status="blocked" />)
    const dot = container.querySelector('.ui-status-dot')
    expect(dot).not.toBeNull()
    expect(dot.dataset.tone).toBe('danger')
    // The badge already says the word, so the dot must not be announced twice.
    expect(dot.getAttribute('aria-hidden')).toBe('true')
    expect(dot.getAttribute('role')).toBeNull()
    expect(dot.getAttribute('aria-label')).toBeNull()
    // Exactly one dot: the old markup drew its own alongside.
    expect(container.querySelectorAll('.ui-status-dot')).toHaveLength(1)
  })
})
