/** @vitest-environment jsdom */
// ViewTabs — the active tab's ink against its own fill (V1, 2026-09-23).
//
// The active tab painted `#fff7ed` on the signal orange at the Dense step,
// 3.35:1 — a C6 violation live on every R.A.B.B.I.T. screen while
// tokens.test.js asserted that very pair fails. That test checks a PAIR OF
// CONSTANTS; nothing checked what the component actually painted. This does,
// from the rendered style, so changing either the ink or the fill is caught.
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import ViewTabs from './ViewTabs'
import { contrast, parseRgba } from '../../../ui/contrast.js'

afterEach(cleanup)

const hex = (css) => {
  const { r, g, b } = parseRgba(css)
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
}

describe('ViewTabs', () => {
  it('marks exactly one tab as the current view, and it is the active one', () => {
    const { container } = render(<ViewTabs activeView="summary" onChange={() => {}} />)
    const current = [...container.querySelectorAll('button[aria-current]')]
    expect(current.map((b) => b.textContent.trim())).toEqual(['Summary'])
    expect(current[0].getAttribute('aria-current')).toBe('page')
  })

  it('the active tab clears 4.5:1 against its own fill (C6: small text on orange is #1c1917)', () => {
    const { container } = render(<ViewTabs activeView="tasks" onChange={() => {}} />)
    const tab = container.querySelector('button[aria-current]')
    const ink = hex(tab.style.color)
    const fill = hex(tab.style.backgroundColor)
    // Guard the premise: if the fill ever stops being opaque orange, the
    // ratio below is measured against the wrong ground and means nothing.
    expect(fill).toBe('#ea580c')
    expect(contrast(ink, fill)).toBeGreaterThanOrEqual(4.5)
  })
})
