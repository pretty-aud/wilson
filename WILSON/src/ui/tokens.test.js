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

describe('@theme and tokens.js agree', () => {
  it('every tokens.js entry is in @theme with the same value', () => {
    for (const [name, value] of Object.entries(THEME)) {
      expect(theme[name], `--${name} missing from @theme`).toBeDefined()
      expect(theme[name], `--${name}`).toBe(value)
    }
  })

  it('every @theme entry a JS site could need is in tokens.js', () => {
    // The `--text-*--line-height` style sub-properties are Tailwind's own
    // extension mechanism for the text utilities and have no JS consumer.
    const jsFacing = Object.keys(theme).filter((k) => !k.includes('--'))
    for (const name of jsFacing) {
      expect(THEME[name], `--${name} is in @theme but not in tokens.js`).toBeDefined()
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
]

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
// Two legacy blocks at the bottom of index.css (O.T.T.E.R.'s lesson-content
// rules and the agent panel's companion-chat rules) still carry their own
// hexes; they belong to lane A / the unreviewed agent surface and were left
// byte-for-byte. This pins the set so nothing new can join it unnoticed.
describe('hexes in index.css outside @theme', () => {
  const themeBlock = css.match(/@theme[^{]*\{[\s\S]*?\n\}/)[0]
  // Code only: the comments quote hexes when they explain a measurement.
  const rest = css.replace(themeBlock, '').replace(/\/\*[\s\S]*?\*\//g, '')
  const outside = new Set((rest.match(HEX) || []).map((h) => h.toLowerCase()))
  const LEGACY = new Set(['#f97316', '#fb923c', '#fdba74', '#d6d3d1', '#a8a29e', '#fbbf24', '#292524', '#0c0a09', '#57534e', '#44403c'])

  it('is exactly the lesson-content / companion-chat legacy set', () => {
    expect([...outside].sort()).toEqual([...LEGACY].sort())
  })

  it('every one of them sits in a .lesson-content or .companion-chat-md rule', () => {
    // Per rule, not per line: some of those rules wrap their declarations.
    // (String.match with a /g regex resets lastIndex; RegExp.test does not.)
    for (const rule of rest.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const [, selector, body] = rule
      if ((body.match(HEX) || []).length === 0) continue
      expect(selector.trim(), selector.trim()).toMatch(/\.lesson-content|\.companion-chat-md/)
    }
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

describe('reduced motion never touches the pet (C5)', () => {
  it('index.css has reduced-motion rules, and each names a class', () => {
    const sel = reducedMotionSelectors(css)
    expect(sel.length).toBeGreaterThan(0)
    for (const s of sel) {
      expect(s, s).not.toMatch(/(^|[\s,])\*(\s|,|$)/)
      expect(s, s).toMatch(/\./)
      for (const mark of PET_MARKS) expect(s.toLowerCase(), `${s} reaches ${mark}`).not.toContain(mark)
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
