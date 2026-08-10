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
import {
  AUTH_INK, AUTH_ERROR_INK, AUTH_TEXT_STYLE,
  AUTH_BUTTON_STYLE, AUTH_BUTTON_QUIET_STYLE,
} from './AuthShell'

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

  it('the primary button is unfilled, so its label and its edge both sit on the well', () => {
    // Audrey: "do not have white buttons." With no fill, the button's label
    // AND its rule are read against the well itself — so both are governed by
    // the same ratio as body text, and the boundary requirement (1.4.11, 3:1)
    // is satisfied by the same ink.
    expect(AUTH_BUTTON_STYLE.background).toBe('transparent')
    expect(AUTH_BUTTON_STYLE.color).toBe(AUTH_INK)
    expect(AUTH_BUTTON_STYLE.border).toContain(AUTH_INK)
    expect(contrast(AUTH_BUTTON_STYLE.color, WELL)).toBeGreaterThanOrEqual(4.5)
  })

  it('no auth button is a white block', () => {
    // The literal instruction, in executable form, for both button tokens.
    for (const style of [AUTH_BUTTON_STYLE, AUTH_BUTTON_QUIET_STYLE]) {
      expect(['#fff', '#ffffff', 'white']).not.toContain(String(style.background).toLowerCase())
    }
  })

  it('the secondary button is the primary at a smaller size, not a new style', () => {
    // A third button treatment on a screen that needs one is how the system
    // starts drifting again.
    expect(AUTH_BUTTON_QUIET_STYLE.background).toBe(AUTH_BUTTON_STYLE.background)
    expect(AUTH_BUTTON_QUIET_STYLE.border).toBe(AUTH_BUTTON_STYLE.border)
    expect(AUTH_BUTTON_QUIET_STYLE.color).toBe(AUTH_BUTTON_STYLE.color)
  })

  it('AUTH_INK also clears AA on the dark orange bars', () => {
    // Nothing renders auth text on the bars today, but SPLIT_BAR_HEIGHT is a
    // tuned number and content that grows past the well lands here. One ink
    // that works on both surfaces means overflow degrades to ugly, not
    // invisible.
    expect(contrast(AUTH_INK, BARS)).toBeGreaterThanOrEqual(4.5)
  })
})
