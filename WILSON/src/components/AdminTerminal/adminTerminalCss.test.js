// =============================================================================
// adminTerminal.css — the guard.
//
// Modelled on `src/components/Dashboard/dashboardCss.test.js` and
// `src/components/settings/settingsCss.test.js`, then REWRITTEN after review
// round 1 took the first version apart. That version asserted two set
// comparisons over the whole directory — "every class the JSX names has a
// rule" and "every rule has a caller" — and the reviewer proved with twelve
// mutants that **deleting an entire state rule left it green** every time the
// class's base rule survived. It could not see a dropped `[data-on='true']`,
// a dropped `:hover`, an inverted `String(active)`, or a transcribed value
// changed from 0.18 to 0.50. A guard that cannot see the defect it exists to
// prevent is worse than no guard, because it is believed.
//
// What it guards now, in the order the failures actually happen:
//
//   1. THE CASCADE LAYER. D1 wrote `@layer components { … }` in a stylesheet
//      imported from a component; the bundler emitted it before
//      `src/index.css`, so `components` was created ahead of `base`, every
//      rule in it fell behind Tailwind's preflight, and the ENTIRE kit
//      rendered unstyled — with all 2136 tests green, because no test in this
//      repo applies CSS. Measured in the running app for THIS sheet: it is
//      emitted at stylesheet index 3 and `index.css` at index 4, so the
//      hazard is real here and not hypothetical.
//
//   2. PER-ELEMENT PAIRING. For every `.at-x[data-y]` rule there must be a
//      JSX element that carries BOTH `at-x` in a className literal and
//      `data-y=` in its own props. This is what catches a dropped state.
//
//   3. THE LOAD-BEARING VALUES, pinned literally. A count of hex digits
//      cannot tell a transcription from an invention — swapping `#b8b4b0`
//      for `#ff00ff` keeps the count identical. These assertions can.
//
//   4. THE TRANSCRIPTION LEDGER, kept for the one thing it is good at:
//      making the C8 cleanup in commit two impossible to forget.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, 'adminTerminal.css'), 'utf8')

/** Strip comments so a rule can never be satisfied by its own documentation. */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const cssCode = code(css)

const jsxFiles = readdirSync(here).filter((f) => f.endsWith('.jsx'))
const sources = Object.fromEntries(
  jsxFiles.map((f) => [f, readFileSync(join(here, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')]),
)
const jsx = Object.values(sources).join('\n')

// 🚨 `used` is scanned ONLY out of className literals. Review round 1 showed
// that a free-text scan counts `title="Close (Esc) at-phantom"` as a caller,
// so any title, aria-label or dead string could keep a dead rule alive.
const classNameLiterals = [...jsx.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)]
  .map((m) => m[1] ?? m[2])
  .join(' ')
const used = new Set([...classNameLiterals.matchAll(/\b(at-[a-z0-9-]+)/g)].map((m) => m[1]))
const rules = new Set([...cssCode.matchAll(/\.(at-[a-z0-9-]+)/g)].map((m) => m[1]))

describe('adminTerminal.css declares the cascade layer before it uses one', () => {
  it('names the four layers as its first statement', () => {
    expect(cssCode.trim().startsWith('@layer theme, base, components, utilities;')).toBe(true)
  })

  it('the declaration precedes the first `@layer components {` block', () => {
    expect(cssCode.indexOf('@layer theme, base, components, utilities;'))
      .toBeLessThan(cssCode.indexOf('@layer components {'))
  })

  it('the order matches the one Tailwind emits', () => {
    expect(cssCode).toMatch(/@layer\s+theme,\s*base,\s*components,\s*utilities;/)
  })

  it('🚨 not one rule sits outside `@layer components`', () => {
    // The first version asserted `afterDeclaration.endsWith('}')`, which any
    // CSS file ending in a closing brace satisfies — so an unlayered rule
    // appended after the block passed (review round 1, finding 8). An
    // unlayered rule beats EVERY Tailwind utility at any specificity, so
    // that mutant would stop a caller ever adding a layout class on top.
    // Count braces instead and assert nothing survives outside the block.
    const start = cssCode.indexOf('@layer components {')
    let depth = 0
    let end = -1
    for (let i = start; i < cssCode.length; i++) {
      if (cssCode[i] === '{') depth++
      else if (cssCode[i] === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    expect(end, 'the `@layer components` block never closes').toBeGreaterThan(-1)
    const outside = (cssCode.slice(0, start) + cssCode.slice(end + 1))
      .replace(/@layer theme, base, components, utilities;/, '')
      .trim()
    expect(outside).toBe('')
  })
})

describe('🚨 every state rule is paired with an element that can trigger it', () => {
  // Each entry: the rule's class, the data attribute it keys on, and the
  // files an element carrying both is allowed to live in. This is the
  // assertion the first version lacked entirely.
  const PAIRS = [
    ['at-nav-item', 'data-active', 'AdminTerminalPage.jsx'],
    ['at-chip', 'data-active', 'LogsSection.jsx'],
    ['at-chip', 'data-active', 'ChangeRequestsSection.jsx'],
    ['at-chip', 'data-active', 'UsersSection.jsx'],
    ['at-log-row', 'data-expanded', 'LogsSection.jsx'],
    ['at-roster-row', 'data-selected', 'UsersSection.jsx'],
    ['at-roster-row', 'data-inactive', 'UsersSection.jsx'],
    ['at-icon-btn', 'data-copied', 'CompanySection.jsx'],
    ['at-icon-btn', 'data-tone', 'CompanySection.jsx'],
    ['at-picker', 'data-active', 'StorageSection.jsx'],
    ['at-model-row', 'data-overridden', 'ModelsSection.jsx'],
    ['at-cred-copy', 'data-copied', 'CredentialsPopup.jsx'],
    ['at-cred-close', 'data-armed', 'CredentialsPopup.jsx'],
    ['at-toggle', 'data-on', 'UsersSection.jsx'],
    ['at-toggle', 'data-disabled', 'UsersSection.jsx'],
    ['at-toggle-row', 'data-disabled', 'UsersSection.jsx'],
    ['at-invite-row', 'data-sent', 'MultiInviteDialog.jsx'],
    ['at-invite-name', 'data-invalid', 'MultiInviteDialog.jsx'],
    ['at-hint', 'data-invalid', 'CreateUserDialog.jsx'],
    ['at-check-row', 'data-dim', 'CreateUserDialog.jsx'],
    ['at-detail-panel', 'data-entered', 'UsersSection.jsx'],
  ]

  it.each(PAIRS)('%s[%s] has a rule AND an element in %s', (cls, attr, file) => {
    // The CSS half: a rule keyed on that attribute, for that class.
    const rule = new RegExp(`\\.${cls}\\[${attr}=`)
    expect(cssCode, `no \`.${cls}[${attr}=…]\` rule`).toMatch(rule)

    // The JSX half: ONE element carrying both. The window is a heuristic —
    // this codebase writes a component's props within a few lines of its
    // className — and it is deliberately tight so a match means the two are
    // on the same element rather than merely in the same file.
    const src = sources[file]
    const hits = [...src.matchAll(new RegExp(`\\b${cls}\\b`, 'g'))]
    expect(hits.length, `${file} never names ${cls}`).toBeGreaterThan(0)
    const paired = hits.some((h) => {
      const window = src.slice(Math.max(0, h.index - 300), h.index + 600)
      return window.includes(`${attr}=`)
    })
    expect(paired, `${file} names ${cls} but no element also writes ${attr}=`).toBe(true)
  })

  it('every class a className literal names has a rule', () => {
    expect([...used].filter((c) => !rules.has(c))).toEqual([])
  })

  it('every rule has a caller in a className literal', () => {
    expect([...rules].filter((c) => !used.has(c))).toEqual([])
  })

  it('every data attribute the CSS selects on is written by the JSX', () => {
    const selected = new Set([...cssCode.matchAll(/\[(data-[a-z-]+)=/g)].map((m) => m[1]))
    const written = new Set([...jsx.matchAll(/(data-[a-z-]+)=/g)].map((m) => m[1]))
    expect([...selected].filter((a) => !written.has(a))).toEqual([])
  })

  it('🚨 every data attribute is written with String(), so `=\'true\'` can match', () => {
    // A `flag || undefined` writer produces an ABSENT attribute, which
    // `[data-x='true']` never matches — the two spellings cannot be mixed.
    // Every writer in this directory must be the String() form.
    const writers = [...jsx.matchAll(/data-[a-z-]+=\{([^}]*)\}/g)].map((m) => m[1].trim())
    const bad = writers.filter((w) => !w.startsWith('String('))
    expect(bad).toEqual([])
  })
})

describe('🚨 the load-bearing values, pinned literally', () => {
  // A hex COUNT cannot tell a transcription from an invention (review round 1,
  // finding 11: `#b8b4b0` → `#ff00ff` keeps the count at 35). These can.
  const DECLARATIONS = [
    // the nav's selected fill and its 3px signal edge
    [/\.at-nav-item\[data-active='true'\]\s*\{[^}]*background-color:\s*rgba\(234, 88, 12, 0\.18\)/, 'nav active fill'],
    [/\.at-nav-item\[data-active='true'\]\s*\{[^}]*border-left-color:\s*#ea580c/, 'nav active edge'],
    // the chip pair, the same object in three files
    [/\.at-chip\[data-active='true'\]\s*\{[^}]*background-color:\s*#1c1917/, 'chip active fill'],
    [/\.at-chip\[data-active='true'\]\s*\{[^}]*color:\s*#f4a261/, 'chip active ink'],
    // AT-01: the whole point of the second commit
    [/\.at-menu-item \.at-menu-hint\s*\{\s*color:\s*#b8b4b0/, 'AT-01 menu hint ink'],
    // the toggle, whose ON branch review round 1 had to prove by hand
    [/\.at-toggle\[data-on='true'\]\s*\{\s*background-color:\s*#ea580c/, 'toggle on track'],
    [/\.at-toggle\[data-on='true'\] \.at-toggle-knob\s*\{\s*transform:\s*translateX\(14px\)/, 'toggle on knob'],
    // the two dropped states review round 1 found
    [/\.at-icon-btn\[data-copied='true'\]\s*\{\s*color:\s*#22c55e/, 'copy confirmed ink'],
    [/\.at-invite-name\[data-invalid='true'\]\s*\{\s*border-color:\s*#dc2626/, 'invalid username edge'],
    // the roster selection, and the transition that went missing with it
    [/\.at-roster-row\[data-selected='true'\]\s*\{\s*background-color:\s*rgba\(234, 88, 12, 0\.10\)/, 'roster selected fill'],
    [/\.at-roster-row\s*\{[^}]*transition:\s*background-color 150ms/, 'roster row transition'],
  ]

  it.each(DECLARATIONS)('pins %s', (pattern) => {
    expect(cssCode).toMatch(pattern)
  })

  it('🚨 no state rule sets a border via the `border` shorthand', () => {
    // Review round 1, finding 2: an inline `border` shorthand sets
    // `border-color`, so a `border-color` rule can never win against one. The
    // inverse discipline belongs here — a `[data-…]` rule that reaches for
    // the shorthand is about to fight the same battle from the other side.
    const stateRules = [...cssCode.matchAll(/\.at-[a-z0-9-]+\[data-[a-z-]+='[^']*'\][^{]*\{([^}]*)\}/g)]
    const offenders = stateRules.map((m) => m[1]).filter((body) => /(^|;)\s*border:\s/.test(body))
    expect(offenders).toEqual([])
  })
})

describe('no surviving Tailwind state utility in this directory', () => {
  it('🚨 no `hover:` utility of any kind', () => {
    // The first version asserted `/hover:bg-/` while its comment claimed "no
    // Tailwind hover utility left at all"; `hover:text-orange-500` passed
    // (review round 1, finding 12).
    expect(jsx).not.toMatch(/(^|\s|")hover:/)
  })

  it('🚨 no `disabled:` utility of any kind', () => {
    // Plan §3.1: disabled is one token (ink at 52 percent plus
    // `cursor: not-allowed`), never an opacity — and never a second spelling
    // of an ink either, which `/disabled:opacity-/` alone allowed through.
    // `disabled:cursor-not-allowed` is the ONE spelling plan §3.1 asks for
    // and is exempted by name; everything else is a second disabled treatment.
    expect(jsx).not.toMatch(/(^|\s|")disabled:(?!cursor-not-allowed)/)
  })

  it('the two transcribed disabled classes are still the only disabled treatment', () => {
    expect(cssCode).toMatch(/\.at-disable-40:disabled\s*\{\s*opacity:\s*0\.4/)
    expect(cssCode).toMatch(/\.at-disable-50:disabled\s*\{\s*opacity:\s*0\.5/)
  })
})

describe('the transcription ledger (commit one only)', () => {
  // 🚨 WHEN COMMIT TWO LANDS, THIS NUMBER GOES TO 0 AND THE `toBe` BELOW
  // BECOMES THE C8 ASSERTION THE OTHER PAGE SHEETS CARRY:
  //     expect(hexes).toEqual([])
  // Until then it is a ledger, not a licence: it may only ever go DOWN.
  // It proves nothing on its own — see the pinned declarations above, which
  // are what actually catch a changed value.
  const TRANSCRIBED_HEXES = 37

  it('carries exactly the transcribed hex values, and no more', () => {
    const hexes = [...cssCode.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0])
    expect(hexes.length).toBe(TRANSCRIBED_HEXES)
  })

  it('reads no design token yet, because commit one changes nothing visually', () => {
    expect(cssCode).not.toMatch(/var\(--color-/)
  })
})
