// =============================================================================
// contrast.test.js — the arithmetic every token assertion rests on.
//
// If these numbers drift, every "passes AA" claim in tokens.test.js is
// meaningless, so the helpers are pinned against WCAG's own published values
// and against the two incidents the repo already recorded (NaN from a
// three-digit hex; alpha wells measured against the raw channels instead of
// the blend).
// =============================================================================

import { describe, it, expect } from 'vitest'
import { hexToRgb, rgbToHex, parseRgba, luminance, contrast, over, screen } from './contrast'

describe('luminance and contrast', () => {
  it('matches the WCAG reference points', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1, 6)
    expect(luminance('#000000')).toBeCloseTo(0, 6)
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5)
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
    // #777777 on white is the canonical "just under 4.5" (4.48:1).
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
  })

  it('expands three-digit hexes instead of returning NaN (the authContrast incident)', () => {
    expect(contrast('#fff', '#000')).toBeCloseTo(21, 5)
    expect(hexToRgb('#abc')).toEqual([170, 187, 204])
  })

  it('refuses anything it cannot parse', () => {
    expect(() => luminance('orange')).toThrow(/unparseable/)
    expect(() => luminance('#12345')).toThrow(/unparseable/)
    expect(() => parseRgba('#ffffff')).toThrow(/not an rgba/)
  })

  it('reproduces the numbers the design docs quote', () => {
    // Plan §0 C6 and §3.2, review Part 3 — measured there, re-measured here.
    expect(contrast('#ffffff', '#ea580c')).toBeCloseTo(3.56, 2)
    expect(contrast('#1c1917', '#ea580c')).toBeCloseTo(4.91, 2)
    expect(contrast('#1c1917', '#f4a261')).toBeCloseTo(8.48, 1) // the docs round it to 8.49
    expect(contrast('#ffffff', '#c2410c')).toBeCloseTo(5.18, 2)
    expect(contrast('#f5f0ec', '#1c1917')).toBeCloseTo(15.45, 2)
  })
})

describe('compositing', () => {
  it('round-trips hex', () => {
    expect(rgbToHex(hexToRgb('#8d8986'))).toBe('#8d8986')
    expect(over('#8d8986', '#000000')).toBe('#8d8986')
  })

  it('flattens an alpha over a backdrop', () => {
    expect(over('rgba(255, 255, 255, 0.5)', '#000000')).toBe('#808080')
    expect(over('rgba(255, 255, 255, 1)', '#000000')).toBe('#ffffff')
    expect(over('rgb(0, 0, 0)', '#ffffff')).toBe('#000000')
  })

  it('derives the ink ladder the plan writes down (72 and 52 percent)', () => {
    expect(screen('#f5f0ec', 72, '#1c1917')).toBe('#b8b4b0')
    expect(screen('#f5f0ec', 52, '#1c1917')).toBe('#8d8986')
  })

  it('shows why 48 percent is not a token: the control', () => {
    const fortyEight = screen('#f5f0ec', 48, '#1c1917')
    expect(fortyEight).toBe('#84807d')
    expect(contrast(fortyEight, '#1c1917')).toBeLessThan(4.5)
    expect(contrast(screen('#f5f0ec', 52, '#1c1917'), '#1c1917')).toBeGreaterThanOrEqual(4.5)
  })
})
