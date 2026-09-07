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
  let n = hex.replace('#', '')
  // Expand #fff → #ffffff. Without this the slices below yield NaN and every
  // ratio silently becomes NaN, which fails an assertion in a way that looks
  // like a contrast problem rather than a parsing one. (It did exactly that.)
  if (n.length === 3) n = n.split('').map((c) => c + c).join('')
  if (n.length !== 6) throw new Error(`unparseable colour: ${hex}`)
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

  it('the primary button label clears AA on its own fill', () => {
    // Audrey, 2026-08-10: "lets round the corners. lets also make it a
    // different darker orange. not the same as the header and footer."
    //
    // Asserting the RATIO rather than the hex: whichever fill is chosen, the
    // label has to survive on it. Going darker is what flipped the label back
    // to white — see the control below.
    expect(AUTH_BUTTON_STYLE.border).toBe('none')
    expect(contrast(AUTH_BUTTON_STYLE.color, AUTH_BUTTON_STYLE.background))
      .toBeGreaterThanOrEqual(4.5)
  })

  it('the button fill is NOT the bar orange — it must read as a distinct surface', () => {
    // The literal instruction. #ea580c is the header/footer.
    expect(AUTH_BUTTON_STYLE.background).not.toBe(BARS)
    // And it must actually be darker, not merely different.
    expect(luminance(AUTH_BUTTON_STYLE.background)).toBeLessThan(luminance(BARS))
  })

  it('the label choice is forced by the fill, not by taste — the control', () => {
    // On the BAR orange white fails (3.56:1) and black passes; on the darker
    // button fill it inverts. Pinning both directions means a future fill
    // change cannot quietly keep a label that no longer works.
    expect(contrast('#ffffff', BARS)).toBeLessThan(4.5)
    expect(contrast(AUTH_INK, AUTH_BUTTON_STYLE.background)).toBeLessThan(4.5)
  })

  it('no auth button is a white block', () => {
    // The earlier instruction, still in executable form, for both tokens.
    for (const style of [AUTH_BUTTON_STYLE, AUTH_BUTTON_QUIET_STYLE]) {
      expect(['#fff', '#ffffff', 'white']).not.toContain(String(style.background).toLowerCase())
    }
  })

  it('the secondary button is distinguishable from the primary', () => {
    // Now that the primary is filled, the secondary carries the outline. If
    // they ever converge, one of them is not doing its job.
    expect(AUTH_BUTTON_QUIET_STYLE.background).not.toBe(AUTH_BUTTON_STYLE.background)
    expect(AUTH_BUTTON_QUIET_STYLE.color).toBe(AUTH_INK)
    expect(contrast(AUTH_BUTTON_QUIET_STYLE.color, WELL)).toBeGreaterThanOrEqual(4.5)
  })

  it('AUTH_INK also clears AA on the dark orange bars', () => {
    // Nothing renders auth text on the bars today, but SPLIT_BAR_HEIGHT is a
    // tuned number and content that grows past the well lands here. One ink
    // that works on both surfaces means overflow degrades to ugly, not
    // invisible.
    expect(contrast(AUTH_INK, BARS)).toBeGreaterThanOrEqual(4.5)
  })
})
