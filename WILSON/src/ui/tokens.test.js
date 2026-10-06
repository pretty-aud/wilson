// =============================================================================
// tokens.test.js — the design system in executable form (plan §3, §7).
//
// Three things are asserted, each with a failing control so the assertion
// is known to discriminate rather than merely pass:
//
//   1. `@theme` in src/index.css and src/ui/tokens.js AGREE, entry for entry,
//      and neither carries a hex the other does not. index.css is the only
//      place a hex is written (C8); tokens.js repeats it for inline sites.
//   2. Every ink/ground pair the kit draws clears 4.5:1 for text, 3:1 for
//      text at 19px bold and above and for the focus ring (WCAG 1.4.3,
//      1.4.11). Alpha tokens are measured against the BLEND, not the raw
//      channels. The known-bad values the review found in the wild are
//      pinned as FAILING, so re-introducing one fails a test.
//   3. No reduced-motion rule in index.css can reach the pet (C5): the
//      selectors inside every `prefers-reduced-motion` block are the kit's
//      own classes, never `*` and never a pet class.
//
// Extends the pattern of authContrast.test.js and lightSurface.test.js,
// which is the only reason the light pages are as consistent as they are.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { contrast, over, screen, luminance } from './contrast'
import * as T from './tokens'
import { THEME } from './tokens'
import { allRules, decls, splitTop } from '../../scripts/ui-css-rules.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../index.css'), 'utf8')

/** Parse `@theme … { --name: value; … }` into { name: value }. */
function parseTheme(source) {
  const m = source.match(/@theme[^{]*\{([\s\S]*?)\n\}/)
  if (!m) throw new Error('no @theme block in index.css')
  const out = {}
  for (const line of m[1].split('\n')) {
    const mm = line.match(/^\s*--([a-z0-9-]+):\s*(.+?);\s*(?:\/\*.*\*\/)?\s*$/i)
    if (mm) out[mm[1]] = mm[2].trim()
  }
  return out
}

const theme = parseTheme(css)
const HEX = /#[0-9a-f]{3,8}\b/gi
/** The same, without the /g flag, for .test() (a /g regex keeps its lastIndex). */
const HEX1 = new RegExp(HEX.source, HEX.flags.replace('g', ''))

describe('@theme and tokens.js agree', () => {
  it('every tokens.js entry is in @theme with the same value', () => {
    for (const [name, value] of Object.entries(THEME)) {
      expect(theme[name], `--${name} missing from @theme`).toBeDefined()
      expect(theme[name], `--${name}`).toBe(value)
    }
  })

  it('every @theme entry a JS site could need is in tokens.js', () => {
    // The `--text-*--<sub>` properties are Tailwind's extension mechanism for
    // the text utilities, so a site that can use a CLASS never needs them.
    // They are not optional for a site that cannot — this filter says "not
    // required here", not "has no consumer", and T3 exported all thirteen
    // through LEADING / TRACKING / WEIGHT after finding inline sites
    // restating them by hand. The first assertion in this block checks the
    // ones that ARE in tokens.js against @theme, which is what matters.
    const jsFacing = Object.keys(theme).filter((k) => !k.includes('--'))
    for (const name of jsFacing) {
      expect(THEME[name], `--${name} is in @theme but not in tokens.js`).toBeDefined()
    }
  })

  // §3.1's table has four columns — size, leading, tracking, weight — and
  // until T3 this module carried one. A step that is missing any of the four
  // sends its callers back to restating the value from memory, which is the
  // drift the module exists to stop.
  it('every step carries all four columns of §3.1', () => {
    const steps = Object.keys(T.TYPE)
    expect(steps).toHaveLength(7)
    for (const step of steps) {
      expect(T.TYPE[step], `TYPE.${step}`).toBeGreaterThan(0)
      expect(T.LEADING[step], `LEADING.${step}`).toBeGreaterThan(1)
      expect(T.TRACKING[step], `TRACKING.${step}`).toBeTypeOf('string')
      expect([400, 600], `WEIGHT.${step} is not one of the system's two weights`)
        .toContain(T.WEIGHT[step])
    }
  })

  /* 🚨 THE STEPS ARE PINNED TO THEIR OWN VALUES, not just to a shape. A
     reviewer pointed out that `LEADING` and `TRACKING` are DERIVED from
     `THEME`, and `THEME` is pinned entry-for-entry against `@theme` — so
     tokens.js cannot drift from index.css, but SWAPPING two steps' leadings
     inside index.css passed every assertion in this file. §3.1's table is
     the specification and these are its numbers; an editor who means to
     change one now has to change it here too, which is the point. */
  it('each step has the leading §3.1 gives it, not merely a leading', () => {
    expect(T.LEADING).toEqual({
      h1: 1.2, h2: 1.3, h3: 1.4, body: 1.5, dense: 1.45, caption: 1.4, label: 1.3,
    })
    // Tight leading belongs to the big steps and loose to the small ones —
    // the invariant behind the numbers, so a future re-tuning that keeps the
    // shape but inverts the intent still fails.
    expect(T.LEADING.h1).toBeLessThan(T.LEADING.body)
    expect(T.LEADING.h2).toBeLessThan(T.LEADING.body)
  })

  it('each step has the weight §3.1 gives it', () => {
    expect(T.WEIGHT).toEqual({
      h1: 600, h2: 600, h3: 600, body: 400, dense: 400, caption: 400, label: 600,
    })
  })

  // The two tracked steps are tracked and the other five are not: §3.1 gives
  // tracking to H1 (+0.01em) and Label (+0.06em) and says everything else is
  // "sentence case with zero tracking". A control, because a TRACKING map
  // that returned '0' for all seven would pass the shape test above.
  it('only H1 and Label are tracked, and by the amounts @theme declares', () => {
    expect(T.TRACKING.h1).toBe(theme['text-h1--letter-spacing'])
    expect(T.TRACKING.label).toBe(theme['text-label--letter-spacing'])
    expect(T.TRACKING.h1).not.toBe('0')
    expect(T.TRACKING.label).not.toBe('0')
    for (const step of ['h2', 'h3', 'body', 'dense', 'caption']) {
      expect(T.TRACKING[step], `TRACKING.${step}`).toBe('0')
      expect(theme[`text-${step}--letter-spacing`], `@theme tracks ${step}`).toBeUndefined()
    }
  })

  it('every hex in tokens.js is a hex that @theme wrote first', () => {
    const themeHexes = new Set((Object.values(theme).join(' ').match(HEX) || []).map((h) => h.toLowerCase()))
    const tokenSource = readFileSync(resolve(here, 'tokens.js'), 'utf8')
    for (const hex of tokenSource.match(HEX) || []) {
      expect(themeHexes.has(hex.toLowerCase()), `${hex} is written in tokens.js but not in @theme`).toBe(true)
    }
  })

  it('the parser is not vacuous: it refuses a file without a theme block', () => {
    expect(() => parseTheme('body { color: red }')).toThrow(/no @theme/)
    expect(Object.keys(theme).length).toBeGreaterThan(40)
  })

  it('the type scale is whole pixels with an 11px floor (C7)', () => {
    for (const [role, size] of Object.entries(T.TYPE)) {
      expect(Number.isInteger(size), `${role} = ${size}`).toBe(true)
      expect(size, role).toBeGreaterThanOrEqual(T.TYPE_FLOOR)
    }
    expect(T.TYPE_FLOOR).toBe(11)
    expect(T.TYPE.body).toBe(14)
  })

  it('the ink ladder is 100 / 72 / 52 percent, pre-flattened', () => {
    expect(screen(T.INK, 72, T.PAPER)).toBe(T.INK_2)
    expect(screen(T.INK, 52, T.PAPER)).toBe(T.INK_3)
  })
})

// ── The pairs the kit draws. `min` 4.5 = text; 3 = large text or non-text. ──
const PAIRS = [
  // dark surfaces
  ['ink on paper', T.INK, T.PAPER, 4.5],
  ['ink-2 on paper', T.INK_2, T.PAPER, 4.5],
  ['ink-3 on paper (placeholder, disabled, captions)', T.INK_3, T.PAPER, 4.5],
  ['ink on paper-raised', T.INK, T.PAPER_RAISED, 4.5],
  ['ink-2 on paper-raised', T.INK_2, T.PAPER_RAISED, 4.5],
  ['ink-3 on paper-raised', T.INK_3, T.PAPER_RAISED, 4.5],
  ['ink-2 on paper-recessed (Kbd)', T.INK_2, T.PAPER_RECESSED, 4.5],
  ['ink on the hover tint', T.INK, over(T.HOVER, T.PAPER), 4.5],
  ['ink on the signal tint (active chip, selected row)', T.INK, over(T.SIGNAL_TINT, T.PAPER), 4.5],
  ['ink on the selection screen', T.INK, over(T.SELECTION, T.PAPER), 4.5],
  ['success on paper', T.SUCCESS, T.PAPER, 4.5],
  ['danger on paper', T.DANGER, T.PAPER, 4.5],
  ['warning on paper', T.WARNING, T.PAPER, 4.5],
  ['danger on paper-raised (menu danger item, dialog error)', T.DANGER, T.PAPER_RAISED, 4.5],
  ['warning on paper-raised', T.WARNING, T.PAPER_RAISED, 4.5],
  // the two oranges
  ['white on signal-fill (the filled primary button, Q16)', T.ON_FILL, T.SIGNAL_FILL, 4.5],
  ['white on signal at 19px bold and above (page titles, wordmarks)', T.ON_FILL, T.SIGNAL, 3],
  ['ink-light on signal (everything smaller on the frame)', T.INK_LIGHT, T.SIGNAL, 4.5],
  ['ink-light knob on the signal switch track (non-text)', T.INK_LIGHT, T.SIGNAL, 3],
  ['ink-light knob on the ink-3 switch track (non-text)', T.INK_LIGHT, T.INK_3, 3],
  // the signal as an INK, never a fill — Audrey's named exceptions
  // (post-overhaul S2a, C3 and C8; UI_OVERHAUL_PLAN §3.2, the signal row)
  ['signal as an ink on paper (O.T.T.E.R.\'s "Course library")', T.SIGNAL, T.PAPER, 4.5],
  ['signal as an ink on paper-raised (D.O.G.\'s section titles and numerals, the lesson cards\' titles and icons)', T.SIGNAL, T.PAPER_RAISED, 4.5],
  ['signal as an ink on paper-recessed (the key caps\' text in both hotkey tables)', T.SIGNAL, T.PAPER_RECESSED, 4.5],
  // The signal ink (post-overhaul S1, ruling B1): the Timeline's phase and
  // sub-phase names in the gutter, at 13px 600 — text, so 4.5:1 — on every
  // ground that row paints: the paper, the phase band (a 7% screen of the
  // ink, as `color-mix(in srgb, ink 7%, transparent)` composites over the
  // paper), the band under the pointer (11%), and the drop tint under a
  // dragged task (the signal at 20%). Measured beforehand 7.73 / 6.47 / 5.71.
  ['signal-ink on paper (phase names)', T.SIGNAL_INK, T.PAPER, 4.5],
  ['signal-ink on the phase band (7% ink)', T.SIGNAL_INK, screen(T.INK, 7, T.PAPER), 4.5],
  ['signal-ink on the hovered phase band (11% ink)', T.SIGNAL_INK, screen(T.INK, 11, T.PAPER), 4.5],
  ['signal-ink on the drop tint (20% signal)', T.SIGNAL_INK, over('rgba(234, 88, 12, 0.2)', T.PAPER), 4.5],
  // light surfaces: one ink
  ['ink-light on ground-light', T.INK_LIGHT, T.GROUND_LIGHT, 4.5],
  ['ink-light on well-light', T.INK_LIGHT, over(T.WELL_LIGHT, T.GROUND_LIGHT), 4.5],
  ['ink-light on surface-light-solid', T.INK_LIGHT, T.SURFACE_LIGHT_SOLID, 4.5],
  ['ink-light on the light hover tint', T.INK_LIGHT, over(T.HOVER_LIGHT, T.GROUND_LIGHT), 4.5],
  ['ink-light on the light selection screen', T.INK_LIGHT, over(T.SELECTION_LIGHT, T.GROUND_LIGHT), 4.5],
  // focus rings are non-text: 3:1 against the surface they sit on
  ['focus ring on paper', T.FOCUS, T.PAPER, 3],
  ['focus ring on paper-raised', T.FOCUS, T.PAPER_RAISED, 3],
  ['ink-light focus ring on ground-light', T.INK_LIGHT, T.GROUND_LIGHT, 3],
  ['ink-light focus ring on the orange chrome (.wilson-chrome)', T.INK_LIGHT, T.SIGNAL, 3],
  // disabled on light is the ink itself (a screen of it fails, see the controls)
  ['ink-light disabled on ground-light', T.INK_LIGHT, T.GROUND_LIGHT, 4.5],
  ['ink-light disabled on well-light', T.INK_LIGHT, over(T.WELL_LIGHT, T.GROUND_LIGHT), 4.5],
  // F3 — the one status colour on the light ground, and the light switch.
  // `danger-light` has exactly two grounds and this is both of them; every
  // other surface it could land on is a failing control below.
  ['danger-light error text on ground-light (the only place it is an INK)', T.DANGER_LIGHT, T.GROUND_LIGHT, 4.5],
  ['white on danger-light (the light destructive button, K7)', T.ON_FILL, T.DANGER_LIGHT, 4.5],
  // The light Switch: one ink, so the state is form — an outlined track with
  // a solid knob, or a solid track with a cut-out one. Non-text, so 3:1.
  ['light switch track on ground-light, both states (non-text)', T.INK_LIGHT, T.GROUND_LIGHT, 3],
  ['light switch knob on the ON track (non-text)', T.GROUND_LIGHT, T.INK_LIGHT, 3],
  // The light Kbd cap and the light disabled Button share this ground.
  ['ink-light on well-light (the light Kbd cap, the light disabled button)', T.INK_LIGHT, over(T.WELL_LIGHT, T.GROUND_LIGHT), 4.5],
]

// P1's §7 caller audit (2026-09-27). Two things the audit deleted must stay
// deleted: the shortcut bar's height (Q10 ruled "no shortcut bar anywhere";
// the token outlived the bar with no consumer), and the four LIGHT_TABLE_*
// objects no table reads since Team Members, Users and Logs moved onto the
// kit Table (V1-15). The check is a function so its control can run it on a
// planted copy; a guard that only ever sees the clean tree proves nothing.
function retiredTokens(names, themeVars) {
  const found = []
  for (const n of names) if (/^SHORTCUT_BAR$|^LIGHT_TABLE_/i.test(n)) found.push(n)
  for (const v of themeVars) if (/^shortcut-bar$/i.test(v)) found.push(`--${v}`)
  return found
}

describe('retired tokens stay retired (P1 §7 audit)', () => {
  it('tokens.js exports no SHORTCUT_BAR or LIGHT_TABLE_*, and neither @theme nor THEME carries --shortcut-bar', () => {
    expect(retiredTokens(Object.keys(T), [...Object.keys(theme), ...Object.keys(THEME)])).toEqual([])
  })
  it('CONTROL: the check names each planted leftover', () => {
    expect(retiredTokens(['LIGHT_TABLE_FRAME', 'SHORTCUT_BAR', 'ROW'], ['shortcut-bar', 'row']))
      .toEqual(['LIGHT_TABLE_FRAME', 'SHORTCUT_BAR', '--shortcut-bar'])
  })
})

describe('every ink/ground pair clears its ratio', () => {
  for (const [label, ink, ground, min] of PAIRS) {
    it(`${label}: ≥ ${min}:1`, () => {
      expect(contrast(ink, ground), `${ink} on ${ground}`).toBeGreaterThanOrEqual(min)
    })
  }

  it('the rule hairlines are visible boundaries but never a second ink', () => {
    const dark = over(T.RULE, T.PAPER)
    const light = over(T.RULE_LIGHT, T.GROUND_LIGHT)
    expect(contrast(dark, T.PAPER)).toBeGreaterThanOrEqual(1.4)
    expect(contrast(dark, T.PAPER)).toBeLessThan(contrast(T.INK_3, T.PAPER))
    expect(contrast(light, T.GROUND_LIGHT)).toBeGreaterThanOrEqual(1.4)
    expect(contrast(light, T.GROUND_LIGHT)).toBeLessThan(contrast(T.INK_LIGHT, T.GROUND_LIGHT))
  })

  it('no surface token is white or near-white (C9)', () => {
    const surfaces = [T.PAPER, T.PAPER_RAISED, T.PAPER_RECESSED, T.GROUND_LIGHT, T.SURFACE_LIGHT_SOLID,
      over(T.WELL_LIGHT, T.GROUND_LIGHT)]
    for (const s of surfaces) {
      expect(luminance(s), s).toBeLessThan(luminance('#e7e5e4'))
    }
  })
})

describe('the controls: values the review found in the wild, pinned as FAILING', () => {
  it('the greys that were text on dark', () => {
    for (const grey of ['#78716c', '#57534e', '#44403c']) {
      expect(contrast(grey, T.PAPER), grey).toBeLessThan(4.5)
    }
  })

  it('the third ink under the hover wash and on the signal tint (A3 review round 2)', () => {
    // Why every third-ink text on a row that takes the hover or the selected
    // tint moves up to the second ink there (otter.css; the kit's Chip count
    // and Menu hint, A3-KR-4 and A3-KR-5): 4.33, 3.99 and 4.18 at 11-13px.
    const grounds = [over(T.HOVER, T.PAPER), over(T.HOVER, T.PAPER_RAISED), over(T.SIGNAL_TINT, T.PAPER)]
    for (const g of grounds) expect(contrast(T.INK_3, g), g).toBeLessThan(4.5)
    // …and the second ink clears all three.
    for (const g of grounds) expect(contrast(T.INK_2, g), g).toBeGreaterThanOrEqual(4.5)
  })

  it('the signal as an ink under the hover wash or on its own tint (S2a) — why D.O.G.\'s section titles revert to the ink on hover', () => {
    // Option c (Audrey's C3): the titles are orange at rest and the ink under
    // the pointer, because on the header's wash the signal is 3.86:1 (3.88
    // once the wash is rounded to the 8-bit colour the screen paints).
    expect(contrast(T.SIGNAL, over(T.HOVER, T.PAPER_RAISED))).toBeLessThan(4.5)
    expect(contrast(T.SIGNAL, over(T.HOVER, T.PAPER))).toBeLessThan(4.5)
    expect(contrast(T.SIGNAL, over(T.SIGNAL_TINT, T.PAPER))).toBeLessThan(4.5)
    // …and the ink it reverts to clears the wash.
    expect(contrast(T.INK, over(T.HOVER, T.PAPER_RAISED))).toBeGreaterThanOrEqual(4.5)
    // Selected, every one of the new oranges sits on the selection screen
    // (the signal at 35%), where it is about 3:1 on all three grounds — why
    // each reverts to the ink when selected (S2a review round 1, V-R1-02).
    for (const ground of [T.PAPER, T.PAPER_RAISED, T.PAPER_RECESSED]) {
      expect(contrast(T.SIGNAL, over(T.SELECTION, ground)), ground).toBeLessThan(4.5)
      expect(contrast(T.INK, over(T.SELECTION, ground)), ground).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('the plain signal as a phase name fails the signal ink\'s own pairs — why the token exists (post-overhaul S1, B1)', () => {
    // The pairs' own assertion, run on each signal-ink pair with the signal
    // (#ea580c) planted in its place: 4.91 on paper passes, and on the band
    // (4.11:1), its hover (3.63:1) and the drop tint it must throw.
    const own = PAIRS.filter(([label]) => label.startsWith('signal-ink '))
    expect(own).toHaveLength(4)
    expect(own[1][2]).toBe('#2b2826') // the band, flattened exactly as contrast.js does
    const planted = own.map(([label, , ground, min]) => [label, T.SIGNAL, ground, min])
    const throws = (ink, ground, min) => {
      try { expect(contrast(ink, ground)).toBeGreaterThanOrEqual(min); return false } catch { return true }
    }
    expect(planted.map(([label, ink, ground, min]) => [label, throws(ink, ground, min)])).toEqual([
      ['signal-ink on paper (phase names)', false],
      ['signal-ink on the phase band (7% ink)', true],
      ['signal-ink on the hovered phase band (11% ink)', true],
      ['signal-ink on the drop tint (20% signal)', true],
    ])
    expect(contrast(T.SIGNAL, own[1][2])).toBeCloseTo(4.11, 2)
  })

  it('the ink at 48 percent — the number six reviews copied', () => {
    expect(contrast(screen(T.INK, 48, T.PAPER), T.PAPER)).toBeLessThan(4.5)
  })

  it('the greys and tints that were text on orange', () => {
    for (const grey of ['#7c4f1f', '#a8a29e', '#78716c', '#57534e', '#fed7aa']) {
      expect(contrast(grey, T.GROUND_LIGHT), grey).toBeLessThan(4.5)
    }
  })

  it('the light status colours the system review proposed (2.43 / 3.14 / 1.41)', () => {
    expect(contrast('#15803d', T.GROUND_LIGHT)).toBeLessThan(4.5)
    expect(contrast('#b91c1c', T.GROUND_LIGHT)).toBeLessThan(4.5)
    expect(contrast('#b45309', T.SIGNAL)).toBeLessThan(4.5)
    expect(contrast('#dc2626', T.PAPER)).toBeLessThan(4.5)
  })

  it('white on the signal orange below 19px bold — the most-copied wrong fix', () => {
    expect(contrast('#ffffff', T.SIGNAL)).toBeLessThan(4.5)
    expect(contrast('#fff7ed', T.SIGNAL)).toBeLessThan(4.5)
    // …but the signal IS a legible ink on paper (4.91:1, the same pair as
    // ink-light on signal), and on paper-raised: recorded so nobody
    // "corrects" an orange label on dark into a contrast failure it is not.
    expect(contrast(T.SIGNAL, T.PAPER)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(T.SIGNAL, T.PAPER_RAISED)).toBeGreaterThanOrEqual(4.5)
  })

  it('the near-whites that were surfaces (C9)', () => {
    for (const s of ['#f5efe6', '#ffffff', '#fff7ed', '#d6d3d1', '#e7e5e4']) {
      expect(luminance(s), s).toBeGreaterThanOrEqual(luminance('#d6d3d1'))
    }
  })

  it('the 40-percent focus ring the review proposed is not a focus ring on paper', () => {
    expect(contrast(over('rgba(234, 88, 12, 0.4)', T.PAPER), T.PAPER)).toBeLessThan(3)
  })

  it('the signal ring is invisible on the orange chrome and on the light ground — why those scopes switch it to ink-light', () => {
    // Review round 1: 1.00:1 on the bars, 1.60:1 on the sign-in well.
    expect(contrast(T.FOCUS, T.SIGNAL)).toBeLessThan(3)
    expect(contrast(T.FOCUS, T.GROUND_LIGHT)).toBeLessThan(3)
    expect(css).toMatch(/\.wilson-chrome :focus-visible/)
    expect(css).toMatch(/\[data-surface="light"\] :focus-visible/)
    // …and an ink-light ring is invisible on a dark island inside a light page
    // (review round 2: 1.00:1 on paper, 1.08:1 on paper-raised), so a dark
    // surface takes the signal back, and the scope is declared AFTER the
    // light/chrome scopes so it wins at equal specificity.
    expect(contrast(T.INK_LIGHT, T.PAPER_RAISED)).toBeLessThan(3)
    const light = css.indexOf('.wilson-chrome :focus-visible')
    const dark = css.indexOf('[data-surface="dark"] :focus-visible')
    expect(dark).toBeGreaterThan(light)
    // Every orange-painted chrome element with focusable controls carries the scope.
    for (const f of ['../components/TitleBar.jsx', '../components/ModelWarningBanner.jsx']) {
      expect(readFileSync(resolve(here, f), 'utf8'), f).toContain('className="wilson-chrome"')
    }
    expect((readFileSync(resolve(here, '../App.jsx'), 'utf8').match(/className="wilson-chrome"/g) || []).length).toBe(3)
  })

  it('the light disabled ink is never a screen of the ink (2.9:1) — the kit uses the ink itself', () => {
    expect(contrast(over('rgba(28, 25, 23, 0.52)', T.GROUND_LIGHT), T.GROUND_LIGHT)).toBeLessThan(4.5)
    expect(css).not.toMatch(/data-surface="light"\]:disabled\s*\{[^}]*color-mix\(in srgb, var\(--color-ink-light\) 52%/)
  })
})

// ── "The only place a hex is written", made countable ──────────────────────
// Until P1 (2026-09-27) one legacy block at the bottom of index.css — the pet
// chat's companion-chat rules — carried five hexes of its own, pinned here so
// nothing could join them; O.T.T.E.R.'s lesson-content block carried ten more
// until A3 (2026-09-24). P1-36 put the chat's markdown on the bubble's ink and
// the kit's tokens, so the set is empty: @theme is the only place a hex is
// written in this file.
describe('hexes in index.css outside @theme', () => {
  const themeBlock = css.match(/@theme[^{]*\{[\s\S]*?\n\}/)[0]
  // Code only: the comments quote hexes when they explain a measurement.
  const rest = css.replace(themeBlock, '').replace(/\/\*[\s\S]*?\*\//g, '')
  const outside = new Set((rest.match(HEX) || []).map((h) => h.toLowerCase()))

  it('there are none (P1-36 retired the companion-chat set)', () => {
    expect([...outside].sort()).toEqual([])
    // CONTROL: the same reading finds a planted one below the theme.
    const planted = `${rest}\n.companion-chat-md strong { color: #fbbf24; }`
    expect(new Set((planted.match(HEX) || []).map((h) => h.toLowerCase()))).toEqual(new Set(['#fbbf24']))
  })

  it('the chat markdown is on the scale, the two weights, one hairline and the control radius (P1-36)', () => {
    const offScale = (source) => {
      const bad = []
      for (const r of allRules(source)) {
        if (r.sel.startsWith('@') || !/\.companion-chat-md(?![\w-])/.test(r.sel)) continue
        for (const [prop, v] of decls(r.body)) {
          if (prop === 'font-size' && !/^(inherit|var\(--text-[a-z]+\))$/.test(v)) bad.push(`${r.sel} ${prop}: ${v}`)
          if (prop === 'font-weight' && !/^(400|600)$/.test(v)) bad.push(`${r.sel} ${prop}: ${v}`)
          if (/^border(-(top|right|bottom|left))?(-width)?$/.test(prop) && /\b([2-9]|\d\d)px\b/.test(v)) bad.push(`${r.sel} ${prop}: ${v}`)
          if (prop === 'border-radius' && v !== 'var(--radius-control)') bad.push(`${r.sel} ${prop}: ${v}`)
          if (/^(color|background(-color)?)$/.test(prop) && !/^(inherit|currentColor|var\(--color-[a-z0-9-]+\))$/.test(v)) bad.push(`${r.sel} ${prop}: ${v}`)
        }
      }
      return bad
    }
    expect(offScale(css)).toEqual([])
    // CONTROL: the block as it stood before P1 names five kinds of break.
    const before = `.companion-chat-md h1 { font-size: 0.85rem; font-weight: 700; color: #fb923c; }
      .companion-chat-md code:not(pre code) { border-radius: 2px; }
      .companion-chat-md blockquote { border-left: 2px solid #f97316; }`
    expect(offScale(before)).toHaveLength(5)
  })

  it('a hex-bearing rule, if one ever returns, must be the chat\'s and never reach the lesson', () => {
    /* Brace-walked (A3 review round 2). A leaf-rule regex read
       `color: #f97316; & svg { … }` in a kit rule as part of a selector, so
       that hex passed; and `.companion-chat-md ~ * .lesson-content strong`
       began with the right class while styling the lesson. Every rule is read
       now, a nested one in the context of the rule it sits in: the OUTERMOST
       selector of its chain must be the companion chat's, list member by list
       member, and no selector in the chain may reach `.lesson-content`. */
    const hexRuleViolations = (source) => {
      const bad = []
      let read = 0
      for (const r of allRules(source)) {
        if (r.sel.startsWith('@')) continue
        if (!decls(r.body).some(([, v]) => HEX1.test(v))) continue
        read++
        const chain = [...r.parents.filter((q) => !q.startsWith('@')), r.sel]
        if (!splitTop(chain[0]).every((sel) => /^\.companion-chat-md(?![\w-])/.test(sel))) bad.push(chain.join(' > '))
        else if (chain.some((sel) => /\.lesson-content\b/.test(sel))) bad.push(chain.join(' > '))
      }
      return { bad, read }
    }
    const { bad, read } = hexRuleViolations(css)
    expect(bad, bad.join('\n')).toEqual([])
    // P1-36: none is left to read (it was five rules before P1).
    expect(read).toBe(0)
    // CONTROL: round two's two survivors, and a clean rule.
    expect(hexRuleViolations(`
      .ui-x { color: #f97316; & svg { width: 1px; } }
      .companion-chat-md ~ * .lesson-content strong { color: #fbbf24; }
      .companion-chat-md p { color: #a8a29e; }
    `).bad).toHaveLength(2)
  })
})

describe('the rest of the controls', () => {

  it('ink-light at 52 percent is a grey on orange, which is why the light placeholder is the ink itself', () => {
    expect(contrast(screen(T.INK_LIGHT, 52, T.GROUND_LIGHT), T.GROUND_LIGHT)).toBeLessThan(4.5)
  })
})

// ── C5: no reduced-motion rule reaches the pet ─────────────────────────────
const PET_MARKS = ['otter', 'egg', 'ghost', 'cloud', 'z-float', 'hunger', 'hatch', 'pet-', 'attention', 'dot-pulse', 'slide']

/** The selector lists of every rule inside every `prefers-reduced-motion` block. */
function reducedMotionSelectors(source) {
  const selectors = []
  const re = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g
  let m
  while ((m = re.exec(source))) {
    let depth = 1
    let i = re.lastIndex
    const start = i
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth++
      else if (source[i] === '}') depth--
      i++
    }
    const block = source.slice(start, i - 1)
    for (const rule of block.matchAll(/([^{}]+)\{[^{}]*\}/g)) selectors.push(rule[1].trim())
  }
  return selectors
}

/** A selector's own words, as the pet marks are read in them: comments out,
    and a kit STATE attribute (`[data-…]`) out — post-overhaul S3c's
    `.ui-btn[data-attention="true"]` is the kit Button (D15), not the pet's
    `.attention-jump`. A `[class…]` attribute is still read: it can reach a
    pet class by name. */
function selectorWords(selector) {
  return selector
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\[data-[\w-]+(?:[~|^$*]?=(?:"[^"]*"|'[^']*'|[^\]]*))?\]/g, '')
}

describe('reduced motion never touches the pet (C5)', () => {
  it('index.css has reduced-motion rules, and each names a class', () => {
    const sel = reducedMotionSelectors(css)
    expect(sel.length).toBeGreaterThan(0)
    for (const s of sel) {
      expect(s, s).not.toMatch(/(^|[\s,])\*(\s|,|$)/)
      expect(s, s).toMatch(/\./)
      for (const mark of PET_MARKS) expect(selectorWords(s).toLowerCase(), `${s} reaches ${mark}`).not.toContain(mark)
    }
  })

  it('the checker catches a blanket rule — the control', () => {
    const bad = '@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }'
    const sel = reducedMotionSelectors(bad)
    expect(sel).toEqual(['*'])
    expect(sel[0]).toMatch(/(^|[\s,])\*(\s|,|$)/)
    const worse = '@media (prefers-reduced-motion: reduce) { .otter-bob, .ui-btn { animation: none; } }'
    expect(reducedMotionSelectors(worse)[0].toLowerCase()).toContain('otter')
  })

  it('CONTROL (post-overhaul S3c): the kit Button\'s attention state is not the pet; the pet\'s attention class, or one reached through [class], still is', () => {
    const reaches = (rule) => {
      const [s] = reducedMotionSelectors(`@media (prefers-reduced-motion: reduce) { ${rule} }`)
      return PET_MARKS.filter((mark) => selectorWords(s).toLowerCase().includes(mark))
    }
    expect(reaches('.ui-btn[data-attention="true"] { animation: none; }')).toEqual([])
    expect(reaches('/* the attention ring stops */ .ui-btn { animation: none; }')).toEqual([])
    expect(reaches('.attention-jump { animation: none; }')).toEqual(['attention'])
    expect(reaches('.ui-btn[class*="attention"] { animation: none; }')).toEqual(['attention'])
    expect(reaches('.ui-btn[data-attention="true"], .otter-bob { animation: none; }')).toEqual(['otter'])
    // Unread, the attribute WOULD have read as the pet: the loosening is the
    // stripping, and it strips only `[data-…]`.
    expect('.ui-btn[data-attention="true"]').toContain('attention')
  })

  it('the pet keyframes are still declared in index.css', () => {
    for (const k of ['otterBob', 'otterBlink', 'eggWobble', 'ghostFloat', 'cloudBob', 'zFloat', 'hungerPulse', 'hatchBurst', 'petSlideIn']) {
      expect(css).toContain(`@keyframes ${k}`)
    }
  })
})

// ── The face and the scrollbar classes ─────────────────────────────────────
describe('the typeface and the scrollbar classes are declared once, here', () => {
  it('self-hosts Geist and Geist Mono from public/fonts, never a CDN (Q3, ruled)', () => {
    expect(css).toMatch(/@font-face\s*\{[^}]*font-family:\s*'Geist'/)
    expect(css).toMatch(/@font-face\s*\{[^}]*font-family:\s*'Geist Mono'/)
    expect(css).toMatch(/url\(\/fonts\/geist-latin-wght\.woff2\)/)
    expect(css).toMatch(/url\(\/fonts\/geist-mono-latin-wght\.woff2\)/)
    expect(css).not.toMatch(/fonts\.googleapis|fonts\.gstatic|cdn\./)
    expect(css).toMatch(/html\s*\{\s*font-family:\s*var\(--font-sans\)/)
    // The files exist beside their licences (the build copies public/ as is).
    for (const f of ['geist-latin-wght.woff2', 'geist-latin-ext-wght.woff2', 'geist-mono-latin-wght.woff2', 'geist-mono-latin-ext-wght.woff2', 'LICENSE-Geist.txt', 'LICENSE-GeistMono.txt']) {
      expect(existsSync(resolve(here, '../../public/fonts', f)), f).toBe(true)
    }
  })

  it('declares two weights only: the variable axis is clamped to 400–600', () => {
    const faces = css.match(/@font-face\s*\{[^}]*\}/g) || []
    expect(faces.length).toBe(4)
    for (const face of faces) expect(face).toMatch(/font-weight:\s*400 600;/)
    // The pair is metric-matched: no mono compensation, but the token stays.
    expect(theme['mono-size-adjust']).toBe('1.0')
    expect(T.MONO_SIZE_ADJUST).toBe(1)
  })

  it('the scale has seven steps and no Display step (Q18: the transition title is exempt)', () => {
    expect(Object.keys(T.TYPE)).toEqual(['h1', 'h2', 'h3', 'body', 'dense', 'caption', 'label'])
    expect(theme['text-display']).toBeUndefined()
  })

  it('the radii are 3 and 6 (Q5, ruled)', () => {
    expect(T.RADIUS_CONTROL).toBe(3)
    expect(T.RADIUS_FLOAT).toBe(6)
  })

  it('declares both scrollbar classes and applies the light one after the dark one', () => {
    const dark = css.indexOf('.wilson-dark-scroll::-webkit-scrollbar')
    const light = css.indexOf('.wilson-light-scroll::-webkit-scrollbar')
    expect(dark).toBeGreaterThan(-1)
    expect(light).toBeGreaterThan(dark)
    // The universal Firefox rule D.O.G. used to inject must not come back.
    expect(css).not.toMatch(/\n\s*\*\s*\{[^}]*scrollbar-width/)
    expect(css).not.toContain('.settings-scrollbar')
  })

  it('has the focus-visible rule and no bare outline reset', () => {
    expect(css).toMatch(/:focus-visible\s*\{\s*outline:\s*2px solid var\(--color-focus\)/)
    expect(css).toMatch(/:focus:not\(:focus-visible\)\s*\{\s*outline:\s*none/)
  })
})


// ============================================================================
// F3 — the kit requests: two tokens, `color-scheme`, and the values that were
// wrong on the light ground until this session.
// ============================================================================

describe('F3 tokens', () => {
  it('danger-light is in @theme, in tokens.js, and is the value that was measured', () => {
    expect(theme['color-danger-light']).toBe('#7f1d1d')
    expect(T.DANGER_LIGHT).toBe('#7f1d1d')
    // AuthShell shipped this locally as the last hex in that file (K6); the
    // value is unchanged, which is the point — it was measured until it
    // passed and the measurement is what survives.
    expect(contrast(T.DANGER_LIGHT, T.GROUND_LIGHT)).toBeGreaterThanOrEqual(4.5)
  })

  it('skeleton-light is an ink screen, the opposite direction to the dark one', () => {
    expect(theme['color-skeleton-light']).toBe('rgba(28, 25, 23, 0.22)')
    const light = over(theme['color-skeleton-light'], T.GROUND_LIGHT)
    const wrong = over(theme['color-skeleton'], T.GROUND_LIGHT)
    // 🚨 The yardstick is the DARK skeleton on its own ground, not the 3:1 a
    // state indicator needs: a skeleton is a placeholder block, it carries no
    // state, and holding it to 3:1 would make it darker than the rule
    // hairlines and read as content. What it must not be is what the dark
    // token becomes here — 1.05:1, an invisible lightening of the ground.
    const darkOnPaper = contrast(over(theme['color-skeleton'], T.PAPER), T.PAPER)
    expect(contrast(light, T.GROUND_LIGHT)).toBeGreaterThanOrEqual(darkOnPaper)
    expect(contrast(wrong, T.GROUND_LIGHT)).toBeLessThan(1.1)
    // …and it is a screen of the ink, so it darkens rather than lightens.
    expect(luminance(light)).toBeLessThan(luminance(T.GROUND_LIGHT))
  })
})

describe('the F3 controls: what the light surfaces resolved to before', () => {
  it('Chip: ink-2 on the light ground is not a grey, it is 1.00:1', () => {
    const r = contrast(T.INK_2, T.GROUND_LIGHT)
    expect(r).toBeLessThan(1.05)
    expect(r).toBeLessThan(4.5)
  })

  it('IconButton disabled and the Switch OFF track: ink-3 on the light ground', () => {
    expect(contrast(T.INK_3, T.GROUND_LIGHT)).toBeLessThan(3)
  })

  it('the Switch ON track and the Spinner arc: the signal on the light ground', () => {
    // Under 3:1, which is the floor a non-text indicator has to clear.
    expect(contrast(T.SIGNAL, T.GROUND_LIGHT)).toBeLessThan(3)
  })

  it('the light ghost hover: the near-white ink on the light hover tint (K8)', () => {
    expect(contrast(T.INK, over(T.HOVER_LIGHT, T.GROUND_LIGHT))).toBeLessThan(4.5)
  })

  it('danger-light is an ink on ONE ground: it fails on both of the raised ones', () => {
    expect(contrast(T.DANGER_LIGHT, over(T.WELL_LIGHT, T.GROUND_LIGHT))).toBeLessThan(4.5)
    expect(contrast(T.DANGER_LIGHT, T.SURFACE_LIGHT_SOLID)).toBeLessThan(4.5)
  })

  it('the two reds that were proposed for this job before it was measured', () => {
    expect(contrast('#ef4444', T.GROUND_LIGHT)).toBeLessThan(4.5)
    expect(contrast('#b91c1c', T.GROUND_LIGHT)).toBeLessThan(4.5)
  })
})

describe('color-scheme: the native panels follow the ground (C1 kit request 5, C2 KR-4)', () => {
  it('is declared at all — until F3 the string appeared nowhere in src/', () => {
    expect(css).toMatch(/:root \{ color-scheme: dark; \}/)
  })

  it('the two surface scopes are the same ones the focus ring uses', () => {
    expect(css).toMatch(/\.wilson-light-scroll,\r?\n\s*\[data-surface="light"\] \{ color-scheme: light; \}/)
    expect(css).toMatch(/\[data-surface="dark"\] \{ color-scheme: dark; \}/)
  })

  it('the dark-island rule is written LAST, so a Dialog inside a light page paints dark', () => {
    // Every one of these selectors is (0,1,0), so source order is the whole
    // mechanism — the same tie that decided the focus ring's scopes.
    expect(css.indexOf('[data-surface="dark"] { color-scheme: dark; }'))
      .toBeGreaterThan(css.indexOf('[data-surface="light"] { color-scheme: light; }'))
    expect(css.indexOf('[data-surface="light"] { color-scheme: light; }'))
      .toBeGreaterThan(css.indexOf(':root { color-scheme: dark; }'))
  })

  it('it sits in @layer base with the other global rules, not unlayered', () => {
    const base = css.slice(css.indexOf('@layer base {'), css.indexOf('@layer components {'))
    expect(base).toContain(':root { color-scheme: dark; }')
    expect(base).toContain('[data-surface="dark"] { color-scheme: dark; }')
  })
})
