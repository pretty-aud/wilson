// =============================================================================
// lightSurface.test.js — Session 43 §B, the colour rule in executable form.
//
// Audrey, 2026-08-10: "there is also a lot of light gray in all of these pages
// which make it very hard to read against the orange" and "DO NOT USE GRAY TEXT
// AGAINST ORANGE AS IT IS HARD TO SEE ONLY WHITE OR BLACK."
//
// The controls matter as much as the assertions here: without them, "the ink
// passes" says nothing about whether the threshold discriminates on this
// background. Each stone step that was actually in use is pinned as FAILING,
// so re-introducing one fails a test rather than shipping.
// =============================================================================

import { describe, it, expect } from 'vitest'
import {
  LIGHT_INK, LIGHT_RULE, LIGHT_WELL,
  LIGHT_TABLE_FRAME, LIGHT_TABLE_HEAD_ROW, LIGHT_TABLE_HEAD_CELL,
} from './lightSurface'

// The surface every light page paints (App.jsx: isDarkPage ? '#1c1917' : '#f4a261').
const PAGE = '#f4a261'

function srgb(hex) {
  let n = hex.replace('#', '')
  if (n.length === 3) n = n.split('').map((c) => c + c).join('')
  if (n.length !== 6) throw new Error(`unparseable colour: ${hex}`)
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
}

function luminance(hex) {
  const [r, g, b] = srgb(hex).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)]
  const [hi, lo] = x > y ? [x, y] : [y, x]
  return (hi + 0.05) / (lo + 0.05)
}

// Composite an `rgba(r, g, b, a)` string over an opaque hex backdrop, because
// the wells and rules are alphas — their real contrast is against the blend,
// not against the raw colour.
function over(rgba, backdropHex) {
  const m = rgba.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/)
  if (!m) throw new Error(`not an rgba string: ${rgba}`)
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const a = m[4] === undefined ? 1 : Number(m[4])
  const bd = srgb(backdropHex).map((v) => v * 255)
  const mix = [r, g, b].map((c, i) => Math.round(a * c + (1 - a) * bd[i]))
  return '#' + mix.map((c) => c.toString(16).padStart(2, '0')).join('')
}

describe('the light-page ink survives the orange it sits on', () => {
  it('LIGHT_INK clears AA on the page', () => {
    expect(contrast(LIGHT_INK, PAGE)).toBeGreaterThanOrEqual(4.5)
  })

  it('every stone step that was in use FAILS — these are the controls', () => {
    // Measured 2026-08-10. If any of these ever passes, the page background
    // changed and every decision in §B needs re-deriving.
    for (const grey of ['#a8a29e', '#78716c', '#57534e', '#d6d3d1', '#e7e5e4']) {
      expect(contrast(grey, PAGE)).toBeLessThan(4.5)
    }
  })

  it('LIGHT_INK also clears AA on the table header well', () => {
    // The header is a translucent brown over the page, so the real question is
    // the composite — a token that passes on the page can still fail on a well.
    expect(contrast(LIGHT_INK, over(LIGHT_WELL, PAGE))).toBeGreaterThanOrEqual(4.5)
  })

  it('the existing input well is recorded as failing, not quietly adopted', () => {
    // rgba(120,70,30,0.55) is WILSON's light-page input well. Black on it is
    // 4.32:1 and the #fde8d0 it actually uses is 3.38:1 — both under AA. This
    // is pre-existing and out of §B's scope, but pinning it means the next
    // person to reach for it as a text surface sees the number first.
    const well = over('rgba(120, 70, 30, 0.55)', PAGE)
    expect(contrast(LIGHT_INK, well)).toBeLessThan(4.5)
    expect(contrast('#fde8d0', well)).toBeLessThan(4.5)
  })

  it('LIGHT_RULE is visible as a boundary without becoming a second ink', () => {
    // 1.4.11 wants 3:1 for a meaningful component boundary; a hairline that
    // reads as text-weight would just be the grey problem again.
    const rule = over(LIGHT_RULE, PAGE)
    expect(contrast(rule, PAGE)).toBeGreaterThanOrEqual(1.5)
    expect(contrast(rule, PAGE)).toBeLessThan(contrast(LIGHT_INK, PAGE))
  })
})

describe('the shared table treatment (§B3)', () => {
  it('is one definition, so Team Members / Users / Logs cannot drift', () => {
    // Three local copies is exactly how they became three different tables.
    expect(LIGHT_TABLE_FRAME.border).toContain(LIGHT_RULE)
    expect(LIGHT_TABLE_HEAD_ROW.backgroundColor).toBe(LIGHT_WELL)
    expect(LIGHT_TABLE_HEAD_CELL.color).toBe(LIGHT_INK)
  })

  it('carries emphasis with WEIGHT, not with a second colour', () => {
    // §B2: once everything is legible, the hierarchy that used to come from
    // "darker grey vs lighter grey" has to come from somewhere else.
    expect(LIGHT_TABLE_HEAD_CELL.fontWeight).toBeGreaterThanOrEqual(600)
  })

  it('the header is NOT a near-white card — that was the actual complaint', () => {
    // "there is a white box and white header for the box that doesnt fit the
    // visual language." A white/near-white fill is lighter than the page.
    expect(luminance(over(LIGHT_WELL, PAGE))).toBeLessThan(luminance(PAGE))
    for (const nearWhite of ['#ffffff', '#e7e5e4', '#d6d3d1']) {
      expect(luminance(nearWhite)).toBeGreaterThan(luminance(over(LIGHT_WELL, PAGE)))
    }
  })
})
