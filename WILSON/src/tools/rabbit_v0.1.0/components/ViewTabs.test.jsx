/** @vitest-environment jsdom */
// ViewTabs — the active tab's ink against its own fill (V1, 2026-09-23).
//
// The active tab painted `#fff7ed` on the signal orange at the Dense step,
// 3.35:1 — a C6 violation live on every R.A.B.B.I.T. screen while
// tokens.test.js asserted that very pair fails. That test checks a PAIR OF
// CONSTANTS; nothing checked what the component set.
//
// ⚠️ What this reads is the INLINE style the component writes, which is the
// only place ViewTabs sets its colours. jsdom does not apply stylesheets, so
// a colour UTILITY on the button (`text-white!`, say) would win in the
// browser and never show here — round one of V1's review proved it. Hence
// the second assertion: the active tab carries no colour utility at all.
// ink-light is the STOPGAP, not the design: §3.2 takes the fill away and
// gives the active tab an underline, which is lane B1's.
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import ViewTabs from './ViewTabs'
import { contrast, parseRgba } from '../../../ui/contrast.js'

afterEach(cleanup)

const hex = (css) => {
  const { r, g, b, a } = parseRgba(css)
  expect(a ?? 1, `${css} is translucent; the ratio below would be wrong`).toBe(1)
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
}
/* A Tailwind colour utility: `text-<palette>` or `text-[…]`, but not the
   type-scale steps, which share the `text-` prefix. */
const COLOUR_UTILITY = /(^|\s)!?text-(?!(?:h1|h2|h3|body|dense|caption|label|left|right|center)\b)[\w[\]#/.-]+!?(?=\s|$)/

describe('ViewTabs', () => {
  it('marks exactly one tab as the current view, and it is the active one', () => {
    const { container } = render(<ViewTabs activeView="summary" onChange={() => {}} />)
    const current = [...container.querySelectorAll('button[aria-current]')]
    expect(current.map((b) => b.textContent.trim())).toEqual(['Summary'])
    expect(current[0].getAttribute('aria-current')).toBe('page')
  })

  it('the active tab writes ink-light on its fill, 4.91:1 (C6: small text on orange is #1c1917)', () => {
    const { container } = render(<ViewTabs activeView="tasks" onChange={() => {}} />)
    const tab = container.querySelector('button[aria-current]')
    // Guard the premise: if the fill ever stops being the opaque signal, the
    // ratio below is measured against the wrong ground and means nothing.
    expect(hex(tab.style.backgroundColor)).toBe('#ea580c')
    expect(hex(tab.style.color)).toBe('#1c1917')
    expect(contrast(hex(tab.style.color), hex(tab.style.backgroundColor))).toBeGreaterThanOrEqual(4.5)
  })

  it('no colour utility on the active tab can override that ink in the browser', () => {
    const { container } = render(<ViewTabs activeView="tasks" onChange={() => {}} />)
    const tab = container.querySelector('button[aria-current]')
    expect(tab.className).not.toMatch(COLOUR_UTILITY)
  })

  it('CONTROL: the colour-utility pattern fires on colours and not on type steps', () => {
    for (const c of ['text-white', 'text-white!', '!text-white', 'text-orange-100', 'text-[#fff]']) expect(`a ${c} b`, c).toMatch(COLOUR_UTILITY)
    for (const c of ['text-dense', 'text-body', 'text-label', 'text-h2', 'text-left']) expect(`a ${c} b`, c).not.toMatch(COLOUR_UTILITY)
  })
})
