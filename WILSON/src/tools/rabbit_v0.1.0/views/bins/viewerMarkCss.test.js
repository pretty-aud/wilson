// =============================================================================
// viewerMarkCss.test.js — GW3 review round 2 (2026-10-11), notes 5, 6 and 7:
// the viewer's mark held to what the reviewer measured in Chromium.
//
//   7  legible on a bright frame: the ink and its backing, composited over a
//      white frame, a mid grey and black, clear 3:1 everywhere and 4:1 over
//      white (55% on 45% measured 1.99:1 over white);
//   5  the upper-right position clears the frame's own Fullscreen button (a
//      28 px kit icon button 4 px in from the corner: the clock's digits ran
//      under it);
//   6  on a narrow tile the mark wraps between its three parts instead of
//      losing the clock to an ellipsis (205 px tiles cut it at 1440x900).
//
// Source-text checks on bins.css and the theme's two tokens; the computed
// contrast uses the kit's own WCAG helpers (src/ui/contrast.js).
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { contrast, screen as flatten } from '../../../../ui/contrast'

const css = readFileSync(fileURLToPath(new URL('./bins.css', import.meta.url)), 'utf8')
const theme = readFileSync(fileURLToPath(new URL('../../../../index.css', import.meta.url)), 'utf8')
const rule = (selector) => {
  const m = css.match(new RegExp(`${selector.replace(/[.[\]]/g, (c) => `\\${c}`)}\\s*\\{([^}]*)\\}`))
  return m ? m[1] : ''
}
const token = (name) => theme.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))[1]
const mixPercent = (decl, tokenName) => Number(decl.match(new RegExp(`var\\(--${tokenName}\\)\\s+(\\d+)%`))?.[1])

describe('the mark on a bright frame (note 7)', () => {
  const mark = rule('.bn-viewer-mark')
  const ink = mixPercent(mark.match(/(?:^|;|\s)color:\s*([^;]+)/)?.[1] || '', 'color-on-fill')
  const backing = mixPercent(mark.match(/background-color:\s*([^;]+)/)?.[1] || '', 'color-paper-recessed')
  const ratioOver = (frame) => {
    const ground = flatten(token('color-paper-recessed'), backing, frame)
    return contrast(flatten(token('color-on-fill'), ink, ground), ground)
  }
  it('reads its ink and backing as mixes of the theme\'s on-fill white and recessed paper', () => {
    expect(token('color-on-fill')).toBe('#ffffff')
    expect(token('color-paper-recessed')).toBe('#0c0a09')
    expect(ink).toBe(70)
    expect(backing).toBe(65)
  })
  it('clears 4:1 over a white frame and 3:1 over mid grey and black', () => {
    expect(ratioOver('#ffffff')).toBeGreaterThanOrEqual(4)
    expect(ratioOver('#808080')).toBeGreaterThanOrEqual(3)
    expect(ratioOver('#000000')).toBeGreaterThanOrEqual(3)
  })
  it('CONTROL: the look round 2 measured (55% on 45%) is under 2:1 over white by the same arithmetic', () => {
    const ground = flatten('#0c0a09', 45, '#ffffff')
    expect(contrast(flatten('#ffffff', 55, ground), ground)).toBeLessThan(2)
  })
})

describe('the mark never covers the frame\'s Fullscreen button (note 5)', () => {
  it('the upper right sits left of a 28 px button 4 px in, with room to spare', () => {
    const right = Number(rule('.bn-mark-tr').match(/right:\s*(\d+)px/)?.[1])
    expect(right).toBeGreaterThanOrEqual(4 + 28 + 4)
    // The other positions are where they were: the lower two above the control strip.
    expect(rule('.bn-mark-bl')).toMatch(/bottom:\s*48px/)
    expect(rule('.bn-mark-br')).toMatch(/bottom:\s*48px/)
  })
})

describe('on a narrow tile the mark wraps between its parts (note 6)', () => {
  it('the mark itself may wrap; each part keeps its own line and only a part too long ends in an ellipsis', () => {
    const mark = rule('.bn-viewer-mark')
    expect(mark).not.toMatch(/white-space:\s*nowrap/)
    expect(mark).not.toMatch(/text-overflow/)
    const part = rule('.bn-mark-part')
    expect(part).toMatch(/display:\s*inline-block/)
    expect(part).toMatch(/white-space:\s*nowrap/)
    expect(part).toMatch(/text-overflow:\s*ellipsis/)
  })
})
