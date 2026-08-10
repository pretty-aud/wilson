// =============================================================================
// authContrast.test.js — Session 43's colour rule, in executable form.
//
// Audrey, 2026-08-10, in capitals: "DO NOT USE GRAY TEXT AGAINST ORANGE AS IT
// IS HARD TO SEE ONLY WHITE OR BLACK" / "keep the orange make the light text
// black instead."
//
// 🚨 The auth surfaces render on the LIGHT orange well (#f4a261), not on the
// dark orange bars — AuthShell paints #f4a261 across the middle and centres
// the content in it. That is easy to misread from a screenshot, and it
// inverts the correct answer: white measures 2.06:1 there. The screens shipped
// white for eighteen sessions.
//
// This asserts the MEASURED ratio of the actual exported tokens, so flipping
// AUTH_INK back to '#fff' fails a test instead of shipping. A comment saying
// "must be black" would not have caught it.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { AUTH_INK, AUTH_ERROR_INK, AUTH_TEXT_STYLE, AUTH_BUTTON_STYLE } from './AuthShell'

// The two surfaces auth content can sit on. AuthShell owns both.
const WELL = '#f4a261'   // light orange — the content area between the bars
const BARS = '#ea580c'   // dark orange — the panels themselves

function luminance(hex) {
  const n = hex.replace('#', '')
  const parts = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
  const [r, g, b] = parts.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)]
  const [hi, lo] = x > y ? [x, y] : [y, x]
  return (hi + 0.05) / (lo + 0.05)
}

describe('the auth ink survives the surface it actually sits on', () => {
  it('AUTH_INK clears AA on the light-orange well', () => {
    expect(contrast(AUTH_INK, WELL)).toBeGreaterThanOrEqual(4.5)
  })

  it('AUTH_TEXT_STYLE.color IS AUTH_INK — the style is what components spread', () => {
    // Asserting the constant alone would pass while the style object carried
    // something else. The style object is the thing that reaches the DOM.
    expect(AUTH_TEXT_STYLE.color).toBe(AUTH_INK)
  })

  it('white would NOT clear it — this is why the rule exists', () => {
    // The control. Without it, "AUTH_INK passes" proves nothing about whether
    // the threshold is meaningful on this background.
    expect(contrast('#ffffff', WELL)).toBeLessThan(3)
  })

  it('the error ink clears AA on the well, where #ef4444 does not', () => {
    expect(contrast(AUTH_ERROR_INK, WELL)).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#ef4444', WELL)).toBeLessThan(3)
  })

  it('the primary button reads on its own fill AND has a boundary', () => {
    // Two different jobs. The label must be legible against the button; the
    // button must be findable against the page. A white fill alone gives
    // 2.06:1 of edge, which is why AUTH_BUTTON_STYLE carries a 2px rule.
    expect(contrast(AUTH_BUTTON_STYLE.color, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(AUTH_BUTTON_STYLE.border).toContain(AUTH_INK)
  })

  it('AUTH_INK also clears AA on the dark orange bars', () => {
    // Nothing renders auth text on the bars today, but SPLIT_BAR_HEIGHT is a
    // tuned number and content that grows past the well lands here. One ink
    // that works on both surfaces means overflow degrades to ugly, not
    // invisible.
    expect(contrast(AUTH_INK, BARS)).toBeGreaterThanOrEqual(4.5)
  })
})
