// =============================================================================
// adminTerminal.css — the guard, third version.
//
// Two adversarial rounds have now been run against this file, and each one
// broke its predecessor:
//
//   ROUND 1 broke version one. It compared two NAME SETS over the whole
//   directory — "every class the JSX names has a rule", "every rule has a
//   caller" — so deleting a whole state rule passed whenever the class's base
//   rule survived. Twelve mutants stayed green, including an inverted
//   `String(active)` and a transcribed value changed from 0.18 to 0.50.
//
//   ROUND 2 broke version two, harder and more usefully. Version two added a
//   hand-written pairing table and eleven pinned declarations, and 36 of 101
//   mutants still passed — INCLUDING putting back, verbatim, both of the HIGH
//   regressions round 1 had just found. Its pairing check measured a ±600
//   CHARACTER WINDOW around any occurrence of the class name anywhere in the
//   file, so a `title` string plus a `data-` attribute 450 characters away
//   satisfied it; the element did not have to exist. And it had no assertion
//   at all about the one thing that caused both regressions: an inline
//   `style` on an element whose class the CSS also paints.
//
// So the rule this version is built on: **the only thing worth asserting is
// the thing that actually broke.** Both HIGH regressions were an inline
// declaration beating a class rule. Version three parses JSX opening tags and
// compares, per element, the properties the CSS owns for that element's
// classes against the properties its inline `style` sets. Reverting either
// regression now fails here.
//
// What it still cannot do: prove a `String(...)` writer produces `'true'` for
// the right boolean. `data-on={String(!on)}` is syntactically perfect. Closing
// that needs a render, and the repo has `@testing-library/react` — it is
// recorded as the next honest step in the hand-off rather than faked here.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, 'adminTerminal.css'), 'utf8')

/** Strip comments so a rule can never be satisfied by its own documentation. */
const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const cssCode = stripCss(css)

const jsxFiles = readdirSync(here).filter((f) => f.endsWith('.jsx'))
const sources = Object.fromEntries(
  jsxFiles.map((f) => [f, readFileSync(join(here, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')]),
)
const jsx = Object.values(sources).join('\n')

// ── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Every JSX opening tag in `src`, as text.
 *
 * 🚨 Brace depth is tracked, so `style={{ fontSize: size >= 40 ? 16 : 10 }}`
 * does not end the tag at its `>`. Round 2's finding 4: a character window
 * around the class name is not a tag, and pairing across two elements is the
 * failure it lets through.
 */
function openingTags(src) {
  const tags = []
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '<' || !/[A-Za-z]/.test(src[i + 1] || '')) continue
    let depth = 0
    let quote = null
    let j = i + 1
    for (; j < src.length; j++) {
      const c = src[j]
      if (quote) { if (c === quote) quote = null; continue }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue }
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }
    tags.push(src.slice(i, j + 1))
    i = j
  }
  return tags
}

/** The `at-*` classes named in this tag's className literal, and nowhere else. */
function tagClasses(tag) {
  const m = tag.match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/)
  if (!m) return []
  return [...(m[1] ?? m[2]).matchAll(/\b(at-[a-z0-9-]+)/g)].map((x) => x[1])
}

const kebabToCamel = (p) => p.replace(/-([a-z])/g, (_, c) => c.toUpperCase())

/**
 * The body text of `const <name> = { … }`, following a leading `{ ...base }`
 * spread so a derived object reports the properties it actually carries.
 *
 * 🚨 It follows a SPREAD and deliberately does not follow a DESTRUCTURE. The
 * first draft of this file resolved `const { border: _x, ...rest } = base`
 * back to `base` and so reported a border the element did not have — this
 * test failed on its own first run because of it. The source was inverted to
 * `const derived = {…}; const base = { ...derived, border }` so the data
 * flows one way and a resolver cannot get it wrong.
 */
function resolveObject(name, src, seen = new Set()) {
  if (seen.has(name)) return ''
  seen.add(name)
  const decl = src.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n?\\}`))
  if (!decl) return ''
  const body = decl[1]
  const spread = body.match(/\.\.\.([A-Za-z_$][\w$]*)/)
  return spread ? `${resolveObject(spread[1], src, seen)},${body}` : body
}

/**
 * The data attributes the sheet selects on with `='true'` — the BOOLEAN
 * states, which must be written as expressions so they can ever be true.
 * `data-tone='chip'` is a static variant marker, correctly a string literal,
 * and is excluded by construction rather than by an exception list.
 */
function booleanAttrs() {
  return [...new Set([...cssCode.matchAll(/\[(data-[a-z-]+)='true'\]/g)].map((m) => m[1]))]
}

/**
 * The CSS property names this tag sets inline, camelCased.
 * Handles `style={{ … }}` and `style={someObject}`, resolving the latter
 * against a module-level `const someObject = { … }` in the same file — which
 * is exactly how the invite dialog's `fieldStyle` hid a `border` shorthand.
 */
function tagStyleProps(tag, src) {
  const literal = tag.match(/style=\{\{([\s\S]*?)\}\}/)
  const body = literal
    ? literal[1]
    : (() => {
        const ref = tag.match(/style=\{([A-Za-z_$][\w$]*)\}/)
        return ref ? resolveObject(ref[1], src) : ''
      })()
  return new Set([...body.matchAll(/(?:^|[{,\s])([A-Za-z][\w]*)\s*:/g)].map((m) => m[1]))
}

/** class → the set of CSS properties this sheet declares for it, camelCased. */
function cssPropsByClass(sheet) {
  const out = {}
  for (const m of sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1]
    const props = [...m[2].matchAll(/(?:^|;)\s*([a-z-]+)\s*:/g)].map((p) => kebabToCamel(p[1]))
    if (!props.length) continue
    for (const c of [...selector.matchAll(/\.(at-[a-z0-9-]+)/g)].map((x) => x[1])) {
      out[c] = out[c] || new Set()
      for (const p of props) out[c].add(p)
    }
  }
  return out
}

const CSS_PROPS = cssPropsByClass(cssCode)
const ALL_TAGS = Object.entries(sources).flatMap(([file, src]) =>
  openingTags(src).map((tag) => ({ file, tag, src })))

// ── The cascade layer ────────────────────────────────────────────────────────

describe('adminTerminal.css declares the cascade layer before it uses one', () => {
  it('names the four layers as its first statement', () => {
    expect(cssCode.trim().startsWith('@layer theme, base, components, utilities;')).toBe(true)
  })

  it('the declaration precedes the first `@layer components {` block', () => {
    expect(cssCode.indexOf('@layer theme, base, components, utilities;'))
      .toBeLessThan(cssCode.indexOf('@layer components {'))
  })

  it('🚨 not one rule sits outside `@layer components`', () => {
    // Version two asserted `endsWith('}')`, which any CSS file satisfies, so
    // an appended unlayered rule passed (round 1, finding 8). An unlayered
    // rule beats every Tailwind utility at any specificity.
    const start = cssCode.indexOf('@layer components {')
    let depth = 0
    let end = -1
    for (let i = start; i < cssCode.length; i++) {
      if (cssCode[i] === '{') depth++
      else if (cssCode[i] === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    expect(end, 'the `@layer components` block never closes').toBeGreaterThan(-1)
    const outside = (cssCode.slice(0, start) + cssCode.slice(end + 1))
      .replace('@layer theme, base, components, utilities;', '')
      .trim()
    expect(outside).toBe('')
  })
})

// ── The assertion both HIGH regressions needed ───────────────────────────────

describe('🚨 no element fights its own stylesheet', () => {
  it('no `.at-*` element sets inline a property the CSS owns for that class', () => {
    // THE ONE THAT MATTERS. Both HIGH regressions round 1 found were this:
    //   1. the copy tick kept `style={{ color: LIGHT_INK }}` while the CSS
    //      owned `color`, so the confirmed branch could never paint;
    //   2. the invite field kept `style={fieldStyle}` whose `border`
    //      SHORTHAND sets border-color, while the CSS owned `border`.
    // Round 2 proved version two of this test passed with BOTH put back
    // verbatim. This fails on either.
    const offenders = []
    for (const { file, tag, src } of ALL_TAGS) {
      const classes = tagClasses(tag)
      if (!classes.length) continue
      const inline = tagStyleProps(tag, src)
      if (!inline.size) continue
      for (const c of classes) {
        for (const p of CSS_PROPS[c] || []) {
          if (inline.has(p)) offenders.push(`${file}: .${c} owns \`${p}\`, element also sets it inline`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

// ── Per-element pairing, derived from the sheet ──────────────────────────────

describe('🚨 every state rule is paired with an element that can trigger it', () => {
  // Derived from the CSS, not transcribed. Round 2, finding 8: a hand-written
  // table falls behind the sheet, so a NEW rule arrives unguarded.
  const PAIRS = [...new Set(
    [...cssCode.matchAll(/\.(at-[a-z0-9-]+)\[(data-[a-z-]+)=/g)].map((m) => `${m[1]} ${m[2]}`),
  )].map((s) => s.split(' '))

  it('the sheet actually declares state rules (the derivation is not empty)', () => {
    // 19 distinct class+attribute pairs. `.at-chip[data-active]` is ONE pair
    // serving three files, which is the deduplication the hand-written table
    // of 21 rows did not have. A floor to be raised, never lowered: a rule
    // that disappears takes its pair — and so its coverage — with it.
    expect(PAIRS.length).toBeGreaterThanOrEqual(19)
  })

  it.each(PAIRS)('.%s[%s] has an element carrying BOTH', (cls, attr) => {
    // Both on ONE opening tag. Round 2, finding 4: a ±600-character window
    // let a decoy `<i title="at-chip" data-active="true" />` anywhere in the
    // file satisfy a chip that had lost its own attribute.
    const paired = ALL_TAGS.filter(({ tag }) =>
      tagClasses(tag).includes(cls) && new RegExp(`(^|\\s)${attr}=`).test(tag))
    expect(paired.length, `no single element carries both ${cls} and ${attr}=`).toBeGreaterThan(0)
  })

  it('every class a className literal names has a rule', () => {
    const used = new Set(ALL_TAGS.flatMap(({ tag }) => tagClasses(tag)))
    const rules = new Set([...cssCode.matchAll(/\.(at-[a-z0-9-]+)/g)].map((m) => m[1]))
    expect([...used].filter((c) => !rules.has(c))).toEqual([])
  })

  it('every rule has a caller in a className literal', () => {
    const used = new Set(ALL_TAGS.flatMap(({ tag }) => tagClasses(tag)))
    const rules = new Set([...cssCode.matchAll(/\.(at-[a-z0-9-]+)/g)].map((m) => m[1]))
    expect([...rules].filter((c) => !used.has(c))).toEqual([])
  })

  it('🚨 every selected data attribute is written as an expression, never a literal', () => {
    // Round 2, finding 6: `data-on="false"` freezes a state permanently off
    // and passed, because the old regex only matched the `={…}` form.
    const selected = booleanAttrs()
    const bad = []
    for (const { file, tag } of ALL_TAGS) {
      for (const attr of selected) {
        const lit = new RegExp(`(^|\\s)${attr}="`).test(tag)
        if (lit) bad.push(`${file}: ${attr} written as a string literal`)
      }
    }
    expect(bad).toEqual([])
  })

  it('🚨 every selected data attribute is written with String(<expression>)', () => {
    // Still only a spelling check — `String(!on)` passes. Round 2, finding 6
    // is right that only a render closes it; what this DOES stop is the
    // `flag || undefined` form, which produces an absent attribute that
    // `[data-x='true']` can never match, and a bare literal inside String().
    const selected = new Set(booleanAttrs())
    const bad = []
    for (const { file, tag } of ALL_TAGS) {
      for (const m of tag.matchAll(/(data-[a-z-]+)=\{([\s\S]*?)\}(?=\s|\/|>)/g)) {
        if (!selected.has(m[1])) continue
        const expr = m[2].trim()
        if (!/^String\([\s\S]*\)$/.test(expr)) bad.push(`${file}: ${m[1]}={${expr}}`)
        else if (/^String\(\s*(['"`]|\d)/.test(expr)) bad.push(`${file}: ${m[1]} wraps a literal`)
      }
    }
    expect(bad).toEqual([])
  })
})

// ── The values ───────────────────────────────────────────────────────────────

describe('🚨 the load-bearing values, pinned literally', () => {
  // Round 2, finding 9: eleven pins out of ~37 declarations, and the rest
  // rested on a hex COUNT that an 8-digit hex defeats. Every pin below ends
  // at a boundary so `#22c55e` cannot be satisfied by `#22c55eff`.
  const H = (hex) => `${hex}(?![0-9a-fA-F])`
  const DECLARATIONS = [
    // the nav
    [new RegExp(`\\.at-nav-item\\[data-active='true'\\]\\s*\\{[^}]*background-color:\\s*rgba\\(234, 88, 12, 0\\.18\\)`), 'nav active fill'],
    [new RegExp(`\\.at-nav-item\\[data-active='true'\\]\\s*\\{[^}]*border-left-color:\\s*${H('#ea580c')}`), 'nav active edge'],
    [/\.at-nav-item\s*\{[^}]*border-left:\s*3px solid transparent/, 'nav inactive slot'],
    // the chip, one object in three files
    [new RegExp(`\\.at-chip\\[data-active='true'\\]\\s*\\{[^}]*background-color:\\s*${H('#1c1917')}`), 'chip active fill'],
    [new RegExp(`\\.at-chip\\[data-active='true'\\]\\s*\\{[^}]*color:\\s*${H('#f4a261')}`), 'chip active ink'],
    // AT-01
    [new RegExp(`\\.at-menu-item \\.at-menu-hint\\s*\\{\\s*color:\\s*${H('#b8b4b0')}`), 'AT-01 menu hint ink'],
    // the toggle
    [new RegExp(`\\.at-toggle\\[data-on='true'\\]\\s*\\{\\s*background-color:\\s*${H('#ea580c')}`), 'toggle on track'],
    [/\.at-toggle\[data-on='true'\] \.at-toggle-knob\s*\{\s*transform:\s*translateX\(14px\)/, 'toggle on knob'],
    [/\.at-toggle\[data-disabled='true'\]\s*\{\s*cursor:\s*default/, 'toggle disabled cursor'],
    // 🚨 round 1's two HIGH fixes. Round 2, finding 3: deleting either was
    // caught ONLY by the hex count, which commit two drives to zero.
    [new RegExp(`\\.at-icon-btn\\s*\\{\\s*color:\\s*${H('#1c1917')}`), 'icon-button rest ink'],
    [new RegExp(`\\.at-icon-btn\\[data-copied='true'\\]\\s*\\{\\s*color:\\s*${H('#22c55e')}`), 'copy confirmed ink'],
    [new RegExp(`\\.at-invite-name\\s*\\{\\s*border:\\s*1px solid ${H('#44403c')}`), 'invite name valid edge'],
    [new RegExp(`\\.at-invite-name\\[data-invalid='true'\\]\\s*\\{\\s*border-color:\\s*${H('#dc2626')}`), 'invite name invalid edge'],
    // the roster
    [/\.at-roster-row\[data-selected='true'\]\s*\{\s*background-color:\s*rgba\(234, 88, 12, 0\.10\)/, 'roster selected fill'],
    [/\.at-roster-row\[data-inactive='true'\]\s*\{\s*opacity:\s*0\.55/, 'roster deactivated dim'],
    // ── motion. Round 2, finding 7: the curve round 1 restored was unpinned,
    //    and so was the promise that the roster's opacity must NOT fade.
    [/\.at-roster-row\s*\{[^}]*transition:\s*background-color 150ms cubic-bezier\(0\.4, 0, 0\.2, 1\);/, 'roster transition, colour only'],
    [/\.at-log-row\s*\{[^}]*transition:\s*background-color 150ms cubic-bezier\(0\.4, 0, 0\.2, 1\)/, 'log row transition'],
    [/\.at-toggle-knob\s*\{[^}]*transition:\s*transform 150ms cubic-bezier\(0\.4, 0, 0\.2, 1\)/, 'knob transition'],
    [/\.at-detail-panel\s*\{[^}]*transform:\s*translateX\(24px\)/, 'panel entry offset'],
    [/\.at-detail-panel\s*\{[^}]*transition:\s*opacity 200ms cubic-bezier\(0\.4, 0, 0\.2, 1\),\s*transform 200ms cubic-bezier\(0\.4, 0, 0\.2, 1\)/, 'panel transition'],
    [/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.at-detail-panel \{ transition: none; \}/, 'reduced-motion gate'],
    // the rest of the transcription
    [new RegExp(`\\.at-picker\\[data-active='true'\\]\\s*\\{[^}]*border-color:\\s*${H('#ea580c')}`), 'picker selected edge'],
    [/\.at-model-row\[data-overridden='true'\]\s*\{\s*background-color:\s*rgba\(234, 88, 12, 0\.05\)/, 'overridden model row'],
    [new RegExp(`\\.at-cred-copy\\[data-copied='true'\\]\\s*\\{[^}]*color:\\s*${H('#22c55e')}`), 'credentials copied'],
    [new RegExp(`\\.at-cred-close\\[data-armed='true'\\]\\s*\\{[^}]*color:\\s*${H('#f4a261')}`), 'credentials armed'],
    [/\.at-invite-row\[data-sent='true'\]\s*\{\s*opacity:\s*0\.75/, 'invite row sent'],
    [new RegExp(`\\.at-hint\\[data-invalid='true'\\]\\s*\\{\\s*color:\\s*${H('#fbbf24')}`), 'create-user hint invalid'],
    [/\.at-check-row\[data-dim='true'\]\s*\{\s*opacity:\s*0\.6/, 'check row dimmed'],
    [new RegExp(`\\.at-log-row:hover\\s*\\{\\s*background-color:\\s*${H('#f5f5f4')}`), 'log row hover'],
    [new RegExp(`\\.at-icon-btn:hover\\s*\\{\\s*background-color:\\s*${H('#e7e5e4')}`), 'icon button hover'],
    [new RegExp(`\\.at-icon-btn\\[data-tone='chip'\\]:hover\\s*\\{\\s*background-color:\\s*${H('#d6d3d1')}`), 'chip remove hover'],
    [/\.at-disable-40:disabled\s*\{\s*opacity:\s*0\.4/, 'disabled at 40'],
    [/\.at-disable-50:disabled\s*\{\s*opacity:\s*0\.5/, 'disabled at 50'],
  ]

  it.each(DECLARATIONS)('pins %#: %s', (pattern) => {
    expect(cssCode).toMatch(pattern)
  })

  it('🚨 no state rule sets a border via the `border` shorthand', () => {
    const stateRules = [...cssCode.matchAll(/\.at-[a-z0-9-]+\[data-[a-z-]+='[^']*'\][^{]*\{([^}]*)\}/g)]
    expect(stateRules.map((m) => m[1]).filter((b) => /(^|;)\s*border:\s/.test(b))).toEqual([])
  })
})

describe('no surviving Tailwind state utility in this directory', () => {
  it('🚨 no `hover:` utility of any kind', () => {
    expect(jsx).not.toMatch(/(^|\s|")hover:/)
  })

  it('🚨 no `disabled:` utility of any kind', () => {
    // `disabled:cursor-not-allowed` is the ONE spelling plan §3.1 asks for
    // and is exempted by name; everything else is a second disabled treatment.
    expect(jsx).not.toMatch(/(^|\s|")disabled:(?!cursor-not-allowed)/)
  })
})

describe('the transcription ledger (commit one only)', () => {
  // 🚨 THE WHOLE TRANSCRIPTION, VALUE BY VALUE, NOT A COUNT.
  //
  // Round 2, finding 9: eleven pinned declarations left roughly two dozen
  // values resting on a COUNT, which an 8-digit hex or a compensating hex
  // elsewhere defeats. The last surviving mutant of this session's own
  // re-run was `.at-hint { color: #78716c }` → `#ff00ff`, which changed no
  // count and broke no pin.
  //
  // This is the ledger the C8 cleanup needs anyway — commit two replaces the
  // whole table with `expect(literals).toEqual([])` — and as a side effect it
  // is total coverage: no value in this sheet can change, in either
  // direction, without saying so here.
  const TRANSCRIBED = [
    ['#1c1917', 8], ['#22c55e', 4], ['#292524', 1], ['#44403c', 3],
    ['#78716c', 2], ['#b45309', 1], ['#b8b4b0', 1], ['#d6d3d1', 1],
    ['#dc2626', 1], ['#e7e5e4', 2], ['#ea580c', 5], ['#f4a261', 5],
    ['#f5f5f4', 1], ['#fbbf24', 1], ['#fff', 1],
    ['rgba(120, 70, 30, 0.3)', 1], ['rgba(234, 88, 12, 0.05)', 1],
    ['rgba(234, 88, 12, 0.10)', 2], ['rgba(234, 88, 12, 0.18)', 1],
    ['rgba(28, 25, 23, 0.35)', 1], ['rgba(34, 197, 94, 0.15)', 1],
  ]

  it('carries exactly the transcribed colour values, each the right number of times', () => {
    const found = {}
    for (const m of cssCode.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)) {
      found[m[0]] = (found[m[0]] || 0) + 1
    }
    expect(Object.fromEntries(TRANSCRIBED)).toEqual(found)
  })

  it('reads no design token yet, because commit one changes nothing visually', () => {
    expect(cssCode).not.toMatch(/var\(--color-/)
  })
})
