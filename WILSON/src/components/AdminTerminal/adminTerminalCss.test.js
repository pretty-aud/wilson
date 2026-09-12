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
  // `Table` names its scroll container through a SECOND prop, so a rule used
  // only there read as uncalled — a false positive that pushes the next
  // session to delete a rule the page needs. Both spellings count, and a tag
  // carrying both contributes both.
  const out = []
  for (const m of tag.matchAll(/(?:className|scrollClassName)=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    out.push(...[...(m[1] ?? m[2]).matchAll(/\b(at-[a-z0-9-]+)/g)].map((x) => x[1]))
  }
  return out
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
    // C3 set this floor at 19 and wrote "never lowered", because a rule that
    // disappears takes its pair — and so its coverage — with it.
    //
    // 🚨 C3b LOWERS IT ON PURPOSE, AND THIS IS THE JUSTIFICATION. Five of
    // those pairs did not disappear, they MOVED INTO THE KIT, where a
    // component test guards each one instead:
    //
    //   .at-chip[data-active]        -> `Chip`      (Chip.test.jsx)
    //   .at-picker[data-active]      -> stays here, still counted
    //   .at-toggle[data-on]          -> `Switch`    (Switch.test.jsx)
    //   .at-cred-copy[data-copied]   -> stays here, still counted
    //   .at-cred-close[data-armed]   -> `Dialog`'s footer button
    //   .at-menu-item (hover)        -> `Menu`      (Menu.test.jsx)
    //
    // A floor that cannot be lowered is a floor that prevents the
    // convergence this whole lane exists to do. What it still has to do is
    // stop a rule vanishing UNNOTICED, so the number is exact and any change
    // to it has to be argued here, in this comment, the way this one is.
    expect(PAIRS.length).toBe(15)
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
  // C3 pinned this sheet value by value because it was a TRANSCRIPTION and a
  // changed value would otherwise be invisible. C3b replaced every value with
  // a token, so the pins move with them: what has to hold now is that each
  // state still resolves to the RIGHT token, not to a plausible neighbour.
  // `--color-signal-tint` and `--color-signal` are one letter apart in a
  // stylesheet and a whole state apart on screen.
  const DECLARATIONS = [
    // the nav: one active treatment, tint plus a signal edge plus the full ink
    [/\.at-nav-item\[data-active='true'\]\s*\{[^}]*background-color:\s*var\(--color-signal-tint\)/, 'nav active fill'],
    [/\.at-nav-item\[data-active='true'\]\s*\{[^}]*box-shadow:\s*inset 2px 0 0 var\(--color-signal\)/, 'nav active edge'],
    [/\.at-nav-item\[data-active='true'\]\s*\{[^}]*font-weight:\s*600/, 'nav active weight'],
    [/\.at-nav-item\s*\{[^}]*color:\s*var\(--color-ink-2\)/, 'nav idle ink'],
    // AT-33's two group separators, which is the whole of that finding's fix
    [/\.at-nav-item\[data-group-start='true'\]\s*\{[^}]*border-top:\s*1px solid var\(--color-rule\)/, 'AT-33 nav group separator'],
    // the expanded log row keeps its context block attached
    [/\.at-log-row\[data-expanded='true'\] \.ui-td\s*\{\s*border-bottom-color:\s*transparent/, 'expanded log row'],
    // AT-27: the models row is a grid with a RESERVED reset track
    [/\.at-model-cells\s*\{[^}]*display:\s*grid/, 'AT-27 models row is a grid'],
    [/\.at-model-cells\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 190px 84px/, 'AT-27 reserved reset track'],
    [/\.at-model-row\[data-overridden='true'\]\s*\{\s*background-color:\s*var\(--color-signal-tint\)/, 'overridden model row'],
    // AT-17: label/value pairs are a grid, never `justify-between`
    [/\.at-sec-row\s*\{[^}]*display:\s*grid/, 'AT-17 label/value grid'],
    [/\.at-sec-row\s*\{[^}]*grid-template-columns:\s*104px 1fr/, 'AT-17 one label track'],
    // the states that survived the conversion as data attributes
    [/\.at-invite-name\[data-invalid='true'\]\s*\{\s*border-color:\s*var\(--color-danger\)/, 'invite name invalid edge'],
    [/\.at-invite-row\[data-sent='true'\] \.at-invite-email\s*\{\s*color:\s*var\(--color-ink-3\)/, 'invite row sent'],
    [/\.at-hint\[data-invalid='true'\]\s*\{\s*color:\s*var\(--color-warning\)/, 'create-user hint invalid'],
    [/\.at-check-row\[data-dim='true'\]\s*\{[^}]*color:\s*var\(--color-ink-3\)/, 'check row dimmed by ink'],
    [/\.at-icon-btn\[data-copied='true'\]\s*\{\s*color:\s*var\(--color-success\)/, 'copy confirmed ink'],
    [/\.at-copy-btn\[data-copied='true'\],\s*\.at-cred-copy\[data-copied='true'\]\s*\{[^}]*color:\s*var\(--color-success\)/, 'both copy buttons confirm alike'],
    [/\.at-toggle-row\[data-disabled='true'\] \.at-row-label\s*\{\s*color:\s*var\(--color-ink-3\)/, 'toggle row disabled ink'],
    // AT-25: named properties, a symmetric exit, and a scoped reduced-motion
    // gate. A blanket rule in index.css would kill the pet (C5).
    [/\.at-detail-panel\s*\{[^}]*transition:\s*opacity var\(--duration-panel\) var\(--ease-response\),\s*transform var\(--duration-panel\) var\(--ease-response\)/, 'AT-25 named-property panel motion'],
    [/\.at-detail-panel\[data-entered='true'\]\s*\{\s*opacity:\s*1;\s*transform:\s*translateX\(0\)/, 'panel entered end state'],
    [/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.at-detail-panel \{ transition: none;/, 'AT-25 reduced-motion gate'],
    // AT-29: the measure is the data cap PLUS one gutter, the same arithmetic
    // `PageHeader` does with `measure="data"` — they have to agree or the
    // title and the first row sit on two different vertical lines.
    [/\.at-page\s*\{[^}]*max-width:\s*calc\(var\(--width-data-max\) \+ 2 \* var\(--spacing-gutter\)\)/, 'AT-29 page measure'],
  ]

  it.each(DECLARATIONS)('pins %#: %s', (pattern) => {
    expect(cssCode).toMatch(pattern)
  })

  it('🚨 no state rule sets a border via the `border` shorthand', () => {
    const stateRules = [...cssCode.matchAll(/\.at-[a-z0-9-]+\[data-[a-z-]+='[^']*'\][^{]*\{([^}]*)\}/g)]
    expect(stateRules.map((m) => m[1]).filter((b) => /(^|;)\s*border:\s/.test(b))).toEqual([])
  })
})

describe('🚨 a String()-spelled attribute never meets a presence selector', () => {
  // THE DEFECT THIS EXISTS TO PREVENT, because it shipped for the length of
  // one commit and only the running app showed it.
  //
  // C3's extraction spells every state `data-x={String(<expr>)}`, which is
  // what makes the value assertable and is right for a rule this page owns:
  // `.at-log-row[data-expanded='true']` reads the VALUE, so "false" simply
  // does not match. The kit does the opposite. `Row` writes
  // `data-selected={selected || undefined}` and `index.css` keys on the
  // attribute's PRESENCE — `.ui-tr[data-selected]` — so an attribute spelled
  // `String(false)` is present and the rule fires.
  //
  // Handing `data-selected={String(...)}` and `data-inactive={String(...)}`
  // straight to `<Row>` therefore painted EVERY roster row as selected and
  // deactivated at once. Every `<td>` measured `rgba(234, 88, 12, 0.16)`
  // while its own row reported `data-selected="false"`, and every test in
  // this file passed, because the source scan checks the spelling and the
  // render tests check the value. Neither can see a paint.
  //
  // The fix is to pass the kit's PROPS. The rule is that the two spellings
  // must never meet, and this is where that is enforced.
  const PRESENCE = [...new Set(
    [...readFileSync(join(here, '../../index.css'), 'utf8')
      .matchAll(/\.ui-[a-z-]+\[(data-[a-z-]+)\](?!=)/g)].map((m) => m[1]),
  )]

  /**
   * Every component name this directory imports from the kit, in all three
   * import shapes it actually uses:
   *
   *   import Button from '../../ui/Button'
   *   import { Th, Td, Row } from '../../ui/Table'
   *   import Table, { Th, Td, Row } from '../../ui/Table'
   *
   * A pattern that reads only the third shape finds neither `Button` nor
   * `Table`, and the guard below then scans nothing while passing — which is
   * what it did on the first attempt, and is why the check after it exists.
   */
  const kitComponents = new Set(
    Object.values(sources).flatMap((src) =>
      [...src.matchAll(/import\s+([\w\s,{}]+?)\s+from\s+'\.\.\/\.\.\/ui\/\w+'/g)]
        .flatMap((m) => m[1].split(/[,{}]/).map((n) => n.trim()).filter(Boolean)),
    ),
  )

  it('the derivations can see the things they are meant to check', () => {
    // Two derivations deep — the presence list from `index.css`, the
    // component list from the imports — and either going empty makes the
    // guard pass while checking nothing.
    expect(PRESENCE).toContain('data-selected')
    expect(PRESENCE).toContain('data-inactive')
    expect(kitComponents.has('Table')).toBe(true)
    expect(kitComponents.has('Row')).toBe(true)
    expect(kitComponents.has('Button')).toBe(true)
    expect(ALL_TAGS.some(({ tag }) => /^<\s*Row\b/.test(tag))).toBe(true)
  })

  it('no KIT element in this directory is handed one as String(<expression>)', () => {
    // Scoped to kit elements, and only to kit elements. `.at-nav-item` and
    // `.at-picker` both carry `data-active={String(…)}` and both are correct:
    // `index.css` keys `data-active` on presence for `.ui-tab`, and neither
    // of those is a `.ui-tab`. The page's own rules read the VALUE
    // (`[data-active='true']`), where "false" simply does not match. The
    // collision exists only where a String()-spelled attribute is handed to a
    // KIT component, which is exactly where it was found.
    const offenders = []
    for (const { file, tag } of ALL_TAGS) {
      const name = (tag.match(/^<\s*([A-Za-z][\w.]*)/) || [])[1]
      if (!name || !kitComponents.has(name)) continue
      for (const attr of PRESENCE) {
        if (new RegExp(`${attr}=\\{String\\(`).test(tag)) {
          offenders.push(`${file}: <${name}> is handed ${attr}={String(…)}, which index.css matches by presence — pass the component's own prop instead`)
        }
      }
    }
    expect(offenders).toEqual([])
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

describe('C8: the sheet is tokens now, and the transcription ledger is closed', () => {
  // 🚨 THIS IS THE ASSERTION C3 WROTE THIS FILE TO REACH.
  //
  // C3's commit was a transcription, so it carried 35 hex and rgba literals
  // and this file pinned every one of them by value — not by count, because
  // a count is defeated by an 8-digit hex or by a compensating change
  // elsewhere. That ledger existed to make the SECOND commit's diff the
  // visual change and nothing else, and to make a forgotten cleanup fail.
  //
  // The cleanup happened. What replaces the ledger is the rule the other
  // page sheets carry: a colour that is not in `@theme` does not exist (C8,
  // plan §3). An empty array is the whole assertion.
  it('writes no colour literal at all', () => {
    const literals = [...cssCode.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)].map((m) => m[0])
    expect(literals).toEqual([])
  })

  // The other half of the same claim: a sheet with no literals and no tokens
  // is a sheet that paints nothing, and would pass the assertion above.
  it('reads the design tokens instead', () => {
    const tokens = new Set([...cssCode.matchAll(/var\(--(color-[a-z0-9-]+)\)/g)].map((m) => m[1]))
    expect(tokens.size).toBeGreaterThan(6)
    // The three the surface cannot be correct without: the one selection, the
    // one destructive tone, and the third ink that replaced every opacity.
    expect(tokens.has('color-signal')).toBe(true)
    expect(tokens.has('color-danger')).toBe(true)
    expect(tokens.has('color-ink-3')).toBe(true)
  })

  // The light page is gone, so the tokens that only exist to survive
  // `#f4a261` have no business here. This is the check that a later edit
  // reaching for the old palette fails loudly rather than looking fine on a
  // reviewer's screen.
  it('reads no light-surface token', () => {
    expect(cssCode).not.toMatch(/var\(--color-(ink-light|rule-light|well-light|ground-light|surface-light-solid|hover-light)\)/)
  })

  it('🚨 the thirteen files import nothing from `../lightSurface`', () => {
    // `dashboardCss.test.js` asserts exactly this for its three files. The
    // module still exists for the other importers; what must not survive is
    // this directory reaching for a LIGHT token on a DARK page, which is the
    // mechanism behind AT-01 — an element classified by the file it lives in
    // rather than by the surface it sits on.
    const importers = Object.entries(sources)
      .filter(([, src]) => /from '\.\.\/lightSurface'/.test(src))
      .map(([f]) => f)
    expect(importers).toEqual([])
  })
})
