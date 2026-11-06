/** @vitest-environment jsdom */
// P1-62 (B5b-17): a bin poster's placeholder glyph is on the icon scale —
// 14 / 16 / 24 (plan §3.3) — never a size computed from its frame.
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import BinPoster, { posterGlyphSize } from './BinPoster'

afterEach(cleanup)

const SCALE = [14, 16, 24]
// Every frame and iconSize the app passes today (BinFileTable 36x22,
// AssignToShot 44, TakePicker 64, ShotTakesPanel 72, the Scenes card 142,
// the grid and inspector at 100%, the inspector's iconSize 28, and the
// 36 / 40 the lane recorded).
const CASES = [[36], [44], [64], [72], [142], ['100%'], [64, 28], [120, 36], [120, 40], [32]]

describe('the poster glyph is on the icon scale (P1-62)', () => {
  it('every size the callers ask for lands on 14, 16 or 24', () => {
    for (const [w, icon] of CASES) expect(SCALE, `${w} / ${icon}`).toContain(posterGlyphSize(w, icon ?? null))
  })
  it('it is the largest step that fits a third of the frame, or the step under an asked size', () => {
    expect(posterGlyphSize(36)).toBe(14)
    expect(posterGlyphSize(64)).toBe(16)
    expect(posterGlyphSize(72)).toBe(24)
    expect(posterGlyphSize('100%')).toBe(24)
    expect(posterGlyphSize(64, 28)).toBe(24)
  })
  it('the drawn icon takes it', () => {
    const { container } = render(<BinPoster row={{ media_type: 'video' }} src={null} width={36} height={22} />)
    const icon = container.querySelector('.bn-poster-icon')
    expect(icon.style.width).toBe('14px')
    expect(icon.style.height).toBe('14px')
  })
  it('CONTROL: the frame-derived size it replaced falls off the scale', () => {
    const old = (w, icon) => icon || Math.max(12, Math.min(40, w / 3))
    expect(SCALE).not.toContain(old(36))
    expect(SCALE).not.toContain(old(64, 28))
  })
})
