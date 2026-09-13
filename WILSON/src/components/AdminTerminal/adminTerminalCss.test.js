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

// 🚨 `.test.jsx` IS EXCLUDED. Without this the scan reads ITSELF, and the
// pairing check below — written to defeat a decoy anywhere in a component —
// is satisfied by an element in a TEST file instead. The round-2 defect came
// back at file granularity rather than at character granularity.
const jsxFiles = readdirSync(here).filter((f) => f.endsWith('.jsx') && !f.includes('.test.'))
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
/**
 * 🚨 AN UNPARSED `style=` IS NOT A PROVEN-CLEAN `style=`.
 *
 * This used to read exactly two spellings — an object literal and a bare
 * identifier — and return an empty set for anything else, which the caller
 * then skipped. So `style={copied ? { color: SUCCESS } : undefined}` or
 * `style={makeStyle(x)}` re-admitted the whole class of defect this check
 * exists to catch: an inline colour beating a class rule that owns the same
 * property, which is the mechanism behind three separate findings on this
 * surface. `UNPARSED` is the third return, and the caller fails on it.
 */
const UNPARSED = Symbol('unparsed style')
function tagStyleProps(tag, src) {
  const literal = tag.match(/style=\{\{([\s\S]*?)\}\}/)
  let body
  if (literal) {
    body = literal[1]
  } else {
    const ref = tag.match(/style=\{([A-Za-z_$][\w$]*)\}/)
    if (ref) body = resolveObject(ref[1], src)
    else if (/\sstyle=/.test(tag)) return UNPARSED
    else body = ''
  }
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
      // 🚨 THE UNREADABLE-STYLE CHECK RUNS BEFORE THE CLASS FILTER. It used to
      // sit after it, so any element WITHOUT an `at-*` class was invisible —
      // which is the exact shape of the defect being guarded: the Storage
      // pickers' disabled state was killed by inline colours on Tailwind-
      // classed CHILDREN, not on the `.at-picker` itself. Round two reverted
      // that whole fix and the check stayed green.
      const inline = tagStyleProps(tag, src)
      if (inline === UNPARSED) {
        offenders.push(`${file}: <${(tag.match(/^<\s*([\w.]+)/) || [])[1]}> carries a \`style=\` this check cannot read — spell it as an object literal or a named const`)
        continue
      }
      if (!classes.length) continue
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
    // Doubled attribute: it beats `.ui-btn[data-variant]`'s (0,2,0) on
    // specificity rather than on which stylesheet the bundler emits last.
    [/\.at-copy-btn\[data-copied='true'\]\[data-copied\],\s*\.at-cred-copy\[data-copied='true'\]\[data-copied\]\s*\{[^}]*color:\s*var\(--color-success\)/, 'both copy buttons confirm alike, above the variant'],
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

describe('🚨 every state ATTRIBUTE is paired with a rule that reads it', () => {
  // The other direction. `PAIRS` runs CSS → JSX and asserts every rule has an
  // element; nothing ran JSX → CSS, so an attribute whose rule was DELETED
  // passed the whole suite as long as the class kept any other rule. That is
  // not hypothetical: `data-tone="chip"` on the department chip's remove
  // button survived the deletion of `.at-icon-btn[data-tone='chip']:hover`
  // and was read by nothing, in either stylesheet, for a whole commit.
  //
  // Attributes the KIT reads are exempt by name, because their rule is in
  // `index.css` rather than here — and each is listed with the component that
  // owns it so the list cannot quietly become a dumping ground.
  const KIT_OWNED = new Set([
    'data-active',      // Tabs, and this page's own nav and pickers
    'data-selected', 'data-inactive', 'data-interactive', 'data-highlighted',
    'data-numeric', 'data-dense',     // Table
    'data-size', 'data-variant', 'data-surface', 'data-width', 'data-tone',
    'data-pad', 'data-rule', 'data-align', 'data-compact', 'data-wrap',
    'data-always', 'data-checked', 'data-disabled', 'data-status',
    'data-testid',
  ])

  const WRITTEN = []
  for (const { file, tag } of ALL_TAGS) {
    const classes = tagClasses(tag)
    if (!classes.length) continue
    for (const m of tag.matchAll(/(data-[a-z-]+)=/g)) {
      if (KIT_OWNED.has(m[1])) continue
      WRITTEN.push({ file, attr: m[1], classes })
    }
  }

  it('finds the attributes it is checking', () => {
    expect(WRITTEN.length).toBeGreaterThan(4)
  })

  it('every page-owned state attribute has a selector that reads it', () => {
    const orphans = WRITTEN
      .filter(({ attr, classes }) => !classes.some((c) =>
        new RegExp(`\\.${c}\\[${attr}`).test(cssCode)))
      .map(({ file, attr, classes }) => `${file}: ${attr} on .${classes.join('.')} — no rule reads it`)
    expect(orphans).toEqual([])
  })

  it('\u{1F6A8} no literal attribute VALUE that no selector accepts', () => {
    // The exemption list above is by attribute NAME, which is too coarse on
    // its own and let the original defect back in when it was tested: the
    // kit does read `data-tone`, on `.ui-status` and `.ui-banner` — but not
    // on `.ui-iconbtn`, and the department chip's remove button carried
    // `data-tone="chip"`, a value that appears in no selector in either
    // stylesheet. An attribute name can be live while the value written into
    // it is dead, and the value is the part that carries the meaning.
    const sheets = cssCode + '\n' + readFileSync(join(here, '../../index.css'), 'utf8')
    const bare = new Set([...sheets.matchAll(/\[(data-[a-z-]+)\](?!=)/g)].map((m) => m[1]))
    const valued = new Set([...sheets.matchAll(/\[(data-[a-z-]+)=["']([^"']+)["']\]/g)]
      .map((m) => `${m[1]}=${m[2]}`))
    // A test hook, read by the test runner rather than by a stylesheet.
    const EXEMPT = new Set(['data-testid'])

    // 🚨 ALL THREE JSX SPELLINGS OF A LITERAL. `data-x="v"`, `data-x='v'` —
    // which is what a single-quote lint rule produces — and `data-x={'v'}`.
    // Round two reintroduced the dead `data-tone="chip"` in the second and
    // third spellings and the check stayed green in both.
    const LITERAL = /(data-[a-z-]+)=(?:"([^"]+)"|'([^']+)'|\{\s*['"]([^'"]+)['"]\s*\})/g
    const dead = []
    for (const { file, tag } of ALL_TAGS) {
      for (const m of tag.matchAll(LITERAL)) {
        const attr = m[1]
        const value = m[2] ?? m[3] ?? m[4]
        if (EXEMPT.has(attr) || bare.has(attr) || valued.has(`${attr}=${value}`)) continue
        dead.push(`${file}: ${attr}="${value}" — no selector in either stylesheet accepts that value`)
      }
    }
    expect(dead).toEqual([])
  })

  it('🚨 no state is written as a bare string instead of an expression', () => {
    // `data-selected="false"` and `data-x={c ? "true" : "false"}` both defeat
    // the String() guard AND the presence guard: one is a literal the source
    // scan does not recognise as a state, the other is a present attribute
    // wherever a rule keys on presence. Neither spelling appears; this is
    // what keeps it that way.
    const literals = []
    for (const { file, tag } of ALL_TAGS) {
      for (const m of tag.matchAll(/(data-[a-z-]+)="(true|false)"/g)) {
        literals.push(`${file}: ${m[1]}="${m[2]}" is a literal, not a state`)
      }
      for (const m of tag.matchAll(/(data-[a-z-]+)=\{[^}]*\?[^}]*'(?:true|false)'/g)) {
        literals.push(`${file}: ${m[1]} is a ternary over string literals`)
      }
    }
    expect(literals).toEqual([])
  })
})

describe('\u{1F6A8} a state that colours descendants reaches all of them', () => {
  // THE HOLE ROUND TWO FOUND IN THE PREVIOUS GUARD, stated precisely.
  //
  // `.at-picker:disabled` colours three named descendants, because a
  // container's colour does not inherit into a child that sets its own. The
  // inline-style check cannot see a child with no `at-*` class, and the
  // orphan-rule check cannot see a PARTIAL revert — round two swapped two of
  // the five `.at-prose` spans back to Tailwind classes with inline colours,
  // the class kept three other callers, and every guard stayed green while
  // the disabled pickers rendered at full strength again.
  //
  // What is actually invariant is countable: there are exactly two pickers on
  // this surface, each with a label, a blurb and an icon, and the disabled
  // rule names all three classes. If a span loses its class the count drops,
  // whether one span or five.
  const storage = sources['StorageSection.jsx'] || ''
  const count = (cls) => (storage.match(new RegExp(`className=\"[^\"]*\\b${cls}\\b`, 'g')) || []).length

  it('the disabled rule still names all three', () => {
    for (const cls of ['at-picker-label', 'at-prose', 'at-picker-icon']) {
      expect(cssCode).toMatch(new RegExp(`\\.at-picker:disabled[^{]*\\.${cls}`))
    }
  })

  it('both pickers carry a classed label, blurb and icon', () => {
    // Two pickers, two of each. `at-prose` is also the class for three plain
    // paragraphs elsewhere in the file, so its floor is five, not two.
    expect(count('at-picker-label')).toBe(2)
    expect(count('at-picker-icon')).toBe(2)
    expect(count('at-prose')).toBe(5)
  })

  it('no picker descendant sets a colour inline', () => {
    // The direct statement of the rule, for the one container whose state
    // depends on it. An inline colour here beats the class at any
    // specificity, which is how the state was lost the first time.
    const offenders = []
    for (const m of storage.matchAll(/<span className="(at-picker-label|at-prose|at-picker-text)"[^>]*>/g)) {
      if (/\sstyle=/.test(m[0])) offenders.push(m[0].slice(0, 80))
    }
    expect(offenders).toEqual([])
  })
})

describe('the create-user form still submits from the keyboard', () => {
  // The behavioural half is in `adminTerminalState.test.jsx`, which mounts
  // the dialog. This is the half that file cannot assert: it runs in jsdom,
  // where `import.meta.url` is an http URL and `readFileSync` refuses it.
  //
  // Both halves exist because the kit `Input` blurs the field on Enter, so
  // implicit submission never fires and the form has to listen for the key
  // itself. The `<textarea>` exemption keeps a newline a newline if one is
  // ever added; the form has none today, so nothing else can prove the
  // clause is still there.
  const src = sources['CreateUserDialog.jsx'] || ''

  it('the form listens for Enter itself', () => {
    expect(src).toMatch(/onKeyDown=\{\(e\) => \{[\s\S]*?e\.key !== 'Enter'/)
    expect(src).toMatch(/handleSubmit\(e\)/)
  })

  it('and exempts a textarea by tag', () => {
    expect(src).toMatch(/e\.target\?\.tagName === 'TEXTAREA'/)
  })

  it('the submit button still reaches the form by id', () => {
    expect(src).toMatch(/form=\{FORM_ID\}/)
    expect(src).toMatch(/<form\s+id=\{FORM_ID\}/)
  })
})

// ── Type and case ────────────────────────────────────────────────────────────
//
// 🚨 EVERY SCAN BELOW IS TOKEN-BASED AND READS BOTH SIDES OF THE SURFACE.
// The first two versions of this block were position-based (`/(^|\s|")font-
// bold\b/`), attribute-based (`/className="([^"]*)"/`) and JSX-only. Two
// adversarial reviews ran 59 mutations at them; 34 stayed green. The four
// families that got through, and what replaced each:
//
//   1. A className that is not a double-quoted literal. `className={'text-h3
//      uppercase'}`, a template literal, a ternary, and `className={darkBtn
//      Class}` where the constant is a plain string — all reach the DOM, none
//      is a `className="…"`. → every STRING LITERAL in the file is scanned,
//      wherever it sits. A literal with no class token in it is ignored.
//   2. A different spelling of the same property. `font-black`, `font-[700]`,
//      `h-3 w-3`, `w-3 shrink-0 h-3`, `size-3`, `size={9}`, `width={9}`,
//      `text-[0.5rem]`, `text-[length:9px]`. → tokens are compared EXACTLY
//      against the whole family, not matched as a prefix at a boundary.
//   3. The stylesheet. Eleven of the thirteen files carry their type in
//      `.at-*` rules, so a JSX-only scan is silent over most of the surface —
//      `text-transform: uppercase` on `.at-picker-label` put AT-08 back on
//      the exact class the previous commit exists to fix, and every test
//      stayed green. → each check has a sheet half.
//   4. An inline `style`. `fontWeight: 700`, `letterSpacing: '0.05em'`,
//      `textTransform: 'uppercase'`, `fontSize: '9px'`. → banned outright.
//
// And two went RED on CORRECT code, which is a defect of the same size:
// a trailing `//` comment quoting `tracking-wider` (the fixture strips only
// full-line comments), and converting every icon to Tailwind v4's `size-*`.
// Exact tokens fix the first; knowing `size-*` fixes the second.

/**
 * Whether a string literal is a class list rather than a sentence.
 *
 * 🚨 IT HAS TO BE BOTH GENEROUS AND WRONG-PROOF, AND THE TWO PULL APART.
 * Generous, because the scans below are the only thing standing between this
 * surface and AT-08, and a className reaches the DOM through a constant, a
 * ternary, a template chunk or a helper just as well as through an
 * attribute — so every string literal is a candidate. Wrong-proof, because
 * this directory's strings are mostly ENGLISH: placeholders, titles, refusal
 * messages. "bucket names are stored in uppercase" is all lowercase, has no
 * sentence punctuation, and contains the exact token `uppercase`; without
 * the stopword clause it fails "every uppercase sits on the Label step" and
 * the guard is blocking correct work, which is a defect of its own size.
 *
 * No class list contains `and`, `the` or `is`. No English sentence is made
 * only of hyphenated lowercase tokens. That is the whole discriminator.
 */
const STOPWORDS = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'with', 'you', 'your'])
const looksLikeClasses = (s) =>
  s.length > 0 &&
  !/[A-Z]/.test(s) &&
  !/[.!?,;:]\s|[.!?]$/.test(s) &&
  !s.trim().split(/\s+/).some((t) => STOPWORDS.has(t))

/**
 * The class tokens on one opening tag.
 *
 * 🚨 IT FILTERS, AND THE FIRST VERSION DID NOT. Pulling every quoted string
 * out of a tag also pulls its `placeholder`, `title` and `aria-label` — so
 * `placeholder="bucket names are stored in uppercase"` put the token
 * `uppercase` on the element and the inheritance check below went red on a
 * sentence. Only literals that read as a class list count.
 */
const tagClassTokens = (tag) =>
  [...tag.matchAll(/(['"`])([^'"`\n]*)\1/g)]
    .map((m) => m[2])
    .filter(looksLikeClasses)
    .join(' ')
    .split(/\s+/)
    .filter(Boolean)

/** Every class token named anywhere in a source, with where it was written. */
const CLASS_TOKENS = Object.entries(sources).flatMap(([file, src]) =>
  [...src.matchAll(/(['"`])([^'"`\n]*)\1/g)]
    .filter((m) => looksLikeClasses(m[2]))
    .flatMap((m) => {
      const where = `${file}:${src.slice(0, m.index).split('\n').length}`
      return m[2].trim().split(/\s+/).filter(Boolean).map((t) => ({ where, cls: m[2], t }))
    }),
)

const STEP_PX = { h1: 20, h2: 16, h3: 14, body: 14, dense: 13, caption: 12, label: 11 }
const STEPS = new Set([20, 16, 14, 13, 12, 11])
const TO_PX = { px: 1, pt: 4 / 3, rem: 16, em: 16 }

/** Every `.at-*` class the sheet gives a `font-size`. An element wearing one
 *  is sized, even though it names no utility — which is how eleven of the
 *  thirteen files are written. */
const SIZED_AT = new Set(
  [...cssCode.matchAll(/([^{};]+)\{([^}]*)\}/g)]
    .filter((m) => /font-size:/.test(m[2]))
    .flatMap((m) => [...m[1].matchAll(/\.(at-[a-z0-9-]+)/g)].map((x) => x[1])),
)

describe('C7: one scale, and every size taken from it by name', () => {
  // "The floor is 11px; nothing smaller ships" (plan §0 C7, §3.1). The review
  // counted 50 occurrences at 10px or smaller on this surface and named
  // `text-[9px]` for deletion outright.

  /** A size spelled as an arbitrary value, in any unit and either syntax. */
  const RAW = CLASS_TOKENS.flatMap(({ where, t }) => {
    const m = t.match(/^text-\[(?:length:)?([\d.]+)(px|rem|em|pt)\]$/)
    return m ? [{ where, t, px: Number(m[1]) * TO_PX[m[2]] }] : []
  })

  /** A size taken from the scale by name. */
  const NAMED = CLASS_TOKENS.flatMap(({ where, t }) => {
    const m = t.match(/^text-(h1|h2|h3|body|dense|caption|label)$/)
    return m ? [{ where, t, px: STEP_PX[m[1]] }] : []
  })

  /**
   * A size set from JS. AT-07's own named evidence was an inline `fontSize`
   * and one is still live (`UsersSection.jsx`, the avatar).
   *
   * 🚨 AN EXPRESSION IT CANNOT PARSE IS RECORDED, NOT SKIPPED — C3b's round
   * two found that treating an unparsed `style=` as clean re-admitted the
   * whole inline-beats-class family in one token. The live expression is a
   * ternary whose CONDITION is `size >= 40`, and 40 is a threshold rather
   * than a size, so the two branches are read and the condition is not.
   */
  const INLINE = []
  const UNPARSED = []
  for (const [file, src] of Object.entries(sources)) {
    for (const m of src.matchAll(/fontSize:\s*([^,}\n]+)/g)) {
      const where = `${file}:${src.slice(0, m.index).split('\n').length}`
      const v = m[1].trim()
      if (/^'?var\(--text-[a-z0-9-]+\)'?$/.test(v)) continue
      const ternary = v.match(/\?\s*'?([\d.]+)(?:px)?'?\s*:\s*'?([\d.]+)(?:px)?'?$/)
      const bare = v.match(/^'?([\d.]+)(?:px)?'?$/)
      if (ternary) INLINE.push({ where, t: v, px: Number(ternary[1]) }, { where, t: v, px: Number(ternary[2]) })
      else if (bare) INLINE.push({ where, t: v, px: Number(bare[1]) })
      else UNPARSED.push(`${where} — \`fontSize: ${v}\` is a shape this scan cannot read`)
    }
  }

  /** And the sizes the page stylesheet sets, mapped back onto the scale. */
  const CSS_SIZES = [...cssCode.matchAll(/font-size:\s*([^;]+);/g)].map((m) => {
    const v = m[1].trim()
    const named = v.match(/^var\(--text-(h1|h2|h3|body|dense|caption|label)\)$/)
    const px = v.match(/^([\d.]+)px$/)
    return { where: 'adminTerminal.css', t: v, px: named ? STEP_PX[named[1]] : px ? Number(px[1]) : NaN }
  })

  // 🚨 FOUR SOURCES, AND THAT IS THE POINT. C3b's version scanned
  // `text-[Npx]` alone and left a note saying the scan would reach zero when
  // the type pass finished — it did, and C3c's first repair pointed the floor
  // and scale checks at the NAMED steps instead. A review then observed that
  // every value in `STEP_PX` is ≥ 11 and every value is in `STEPS`, so both
  // assertions had become incapable of failing: populated and inert, which is
  // C3b trap 8 one level up. Arbitrary values, inline `fontSize` and the
  // sheet's own declarations can each carry an off-scale number.
  const SIZES = [...RAW, ...NAMED, ...INLINE, ...CSS_SIZES]

  it('finds the sizes it is checking (the scans are not empty)', () => {
    // 🚨 THESE READ THREE INDEPENDENT SOURCES BECAUSE ANY ONE OF THEM MAY
    // LEGITIMATELY EMPTY. A review pointed out that moving the last
    // `text-label uppercase` spans into `.at-*` rules — which is the
    // direction this directory is already travelling, and which the previous
    // commit moved `.at-picker-label` in — would have turned a
    // utilities-only companion red on correct work.
    expect(CSS_SIZES.length).toBeGreaterThan(0)
    expect(INLINE.length).toBeGreaterThan(0)
    expect(NAMED.length + [...SIZED_AT].length).toBeGreaterThan(0)
  })

  it('🚨 reads every inline `fontSize` it finds, or says it cannot', () => {
    expect(UNPARSED).toEqual([])
  })

  it('🚨 writes no size as an arbitrary value — every size is a named step', () => {
    // The point of a scale is that a size has a NAME. `text-[13px]` is the
    // right number and the wrong statement.
    expect(RAW).toEqual([])
  })

  it('🚨 writes no size below the 11px floor', () => {
    expect(SIZES.filter((s) => s.px < 11)).toEqual([])
  })

  it('writes no size that is not a step on the scale', () => {
    // 20 / 16 / 14 / 13 / 12 / 11 (plan §3.1). 14 appears twice on the scale
    // — Body and H3 — which is deliberate, not a duplicate.
    expect(SIZES.filter((s) => !STEPS.has(s.px))).toEqual([])
  })

  it("🚨 no second scale: Tailwind's own size utilities are not used", () => {
    // `text-xs` is 12px and `text-sm` is 14px, so both LOOK like steps and
    // neither is one — they come from Tailwind's scale, not WILSON's, and
    // drift the moment a step changes in `@theme`. The review counted 64
    // `text-xs` on this surface before the conversion.
    expect(CLASS_TOKENS.filter(({ t }) => /^text-(xs|sm|base|lg|xl|[2-9]xl)$/.test(t))).toEqual([])
  })

  it('🚨 no `leading-*` utility: the step carries its own leading', () => {
    // 15 `leading-relaxed` were deleted on exactly this reasoning, which only
    // holds if nothing may put one back — `leading-none` on a Dense paragraph
    // is 13px text on a 13px line, and no size check would notice.
    expect(CLASS_TOKENS.filter(({ t }) => /^leading-/.test(t))).toEqual([])
  })

  it('🚨 no type property is set from an inline style', () => {
    // Every one of these was a live evasion in review: `fontWeight: 700`,
    // `letterSpacing: '0.05em'`, `textTransform: 'uppercase'`, `fontSize:
    // '9px'`. The existing inline-beats-class guard only reaches elements
    // that wear an `.at-*` class; type is set on Tailwind-classed elements
    // here, so it needs its own flat rule. `fontSize` is exempt because the
    // scan above READS it — one live site, the avatar, both branches on the
    // scale.
    const bad = []
    for (const [file, src] of Object.entries(sources)) {
      for (const m of src.matchAll(/\b(fontWeight|letterSpacing|textTransform)\s*:/g)) {
        bad.push(`${file}:${src.slice(0, m.index).split('\n').length} — inline \`${m[1]}\``)
      }
    }
    expect(bad).toEqual([])
  })

  it('🚨 `.at-prose` is prose, and prose is the one thing 11px is not for', () => {
    // Pinned by value, and the sheet-wide check is exactly why it has to be:
    // that one asks only that a size reads SOME `--text-*`, which a revert to
    // `--text-label` — where these five strings started — satisfies.
    //
    // 🚨 EVERY `.at-prose` RULE, AND THE LAST DECLARATION IN EACH. A review
    // beat the first version twice: `match()` without `/g` reads only the
    // first rule, so a second `.at-prose { font-size: var(--text-label) }`
    // appended to the sheet won; and `toMatch` is satisfied by the FIRST
    // `font-size`, so a second declaration inside the same rule won.
    // Last-wins is what the cascade does, so last-wins is what this reads.
    const bodies = [...cssCode.matchAll(/\.at-prose\s*\{([^}]*)\}/g)].map((m) => m[1])
    expect(bodies.length).toBeGreaterThan(0)
    const decls = bodies.flatMap((b) => [...b.matchAll(/(font-size|line-height):\s*([^;]+);/g)])
    const last = (prop) => decls.filter((d) => d[1] === prop).at(-1)?.[2].trim()
    expect(last('font-size')).toBe('var(--text-dense)')
    // And its leading comes from the step too, so an `.at-prose` span and a
    // `text-dense` span beside it agree by construction rather than by luck.
    expect(last('line-height')).toBe('var(--text-dense--line-height)')
  })

  it('🚨 the page stylesheet reads the scale rather than spelling a size', () => {
    // The sheet's own type comes from `--text-*`; a raw `font-size: 12px`
    // there is a scale invented in a second place.
    const raw = [...cssCode.matchAll(/font-size:\s*([^;]+);/g)]
      .map((m) => m[1].trim())
      .filter((v) => !v.startsWith('var(--text-'))
    expect(raw).toEqual([])
  })

  it('🚨 and the `font` shorthand is not used to smuggle one past it', () => {
    // `font: 600 9px/1.2 var(--font-sans)` sets a size, a weight and a
    // leading in one declaration that the three longhand scans above cannot
    // see. A review put 9px on a live class that way and every test stayed
    // green. This sheet has no legitimate use for the shorthand.
    expect(cssCode).not.toMatch(/(^|[;{\s])font:\s/)
  })

  it('🚨 Q4: the mono is on data, never on prose', () => {
    // "Data only: numerics in tables, sizes, durations, budgets, counts, ids,
    // file paths, timecode, keyboard keys, code blocks, the version footer.
    // It leaves every label, heading, button, tab, chip and paragraph."
    //
    // A BARE `font-mono` on an inline span is always wrapping a value — a UNC
    // path, a bucket name, a drive letter — and is correct. Three things make
    // it prose: a size utility beside it, an `.at-*` class the sheet sizes,
    // or a block-level tag. 🚨 The last two are the repair: the detector knew
    // a size only as `text-[Npx]` or a Tailwind default, and this session
    // converted the last of both, so `<p className="font-mono">` and
    // `<span className="font-mono at-row-value">` — the spelling the other
    // eleven files use — both walked through a green guard.
    const prose = []
    for (const [file, src] of Object.entries(sources)) {
      for (const tag of openingTags(src)) {
        const cls = tagClassTokens(tag)
        if (!cls.includes('font-mono')) continue
        const name = tag.match(/^<\s*([A-Za-z][A-Za-z0-9]*)/)?.[1] ?? '?'
        const why = cls.some((t) => /^text-(\[|xs$|sm$|base$|lg$|xl$|h1$|h2$|h3$|body$|dense$|caption$|label$)/.test(t))
          ? 'a size utility'
          : cls.some((t) => SIZED_AT.has(t))
            ? 'an `.at-*` class the sheet sizes'
            : /^(p|h[1-6]|li|blockquote)$/.test(name)
              ? 'a block-level tag'
              : /fontSize:/.test(tag)
                ? 'an inline fontSize'
                : null
        if (why) prose.push(`${file} <${name}> — \`font-mono\` with ${why}, so it is prose, not data`)
      }
    }
    expect(prose).toEqual([])
  })

  it('finds the icons it is checking (the scan is not empty)', () => {
    // 🚨 ITS OWN `it`. When this lived inside the assertion below, emptying
    // the scan reported "three icon sizes, not eleven" — the opposite of what
    // had happened — and a review hit exactly that by converting every icon
    // to `size-*`, which is correct code.
    expect(ICONS.length).toBeGreaterThan(0)
    // And the set it filters against is real: a regex that matched no import
    // would scan an empty glyph list and pass everything (C3b trap 8, which
    // this file has already been bitten by twice).
    expect(Object.values(LUCIDE).reduce((n, s) => n + s.size, 0)).toBeGreaterThan(20)
  })

  it('🚨 §3.3: three icon sizes, not eleven', () => {
    // "Icons 14 inside dense controls, 16 in rows and buttons, 24 in empty
    // states. Three icon sizes, not eleven."
    //
    // 🚨 A UTILITY BEATS THE KIT HERE, WHICH IS WHY IT SURVIVED SO LONG.
    // `.ui-btn[data-size="sm"] > svg` is 14px and lives in `@layer
    // components`; `w-3 h-3` lives in `@layer utilities`, declared LATER, so
    // eleven icons inside kit buttons really did render at 12px with the
    // kit's own rule losing silently. The fix is to drop the utility, not to
    // restate the kit's number on top of it.
    expect(ICONS.filter((i) => i.w !== i.h || !new Set([14, 16, 24]).has(i.w))).toEqual([])
  })
})

/**
 * Every sized glyph in the directory. Reads whole tags via the brace-aware
 * `openingTags()`, not a character window.
 *
 * 🚨 NINE SPELLINGS OF A 12px ICON WALKED PAST THE FIRST VERSION: `h-3 w-3`
 * (wrong order), `w-3 shrink-0 h-3` (not adjacent), `w-3  h-3` (two spaces),
 * `w-[9px] h-[9px]`, `size-3` (Tailwind v4's square utility, and the spelling
 * a future session is likeliest to reach for), `size={9}` (lucide's own
 * prop), `width={9} height={9}` (SVG attributes), a template literal, and a
 * className more than 120 characters into the tag.
 */
const LUCIDE = Object.fromEntries(
  Object.entries(sources).map(([file, src]) => [
    file,
    new Set(
      [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'lucide-react'/g)]
        .flatMap((m) => m[1].split(',').map((n) => n.trim().split(/\s+as\s+/).pop()))
        .filter(Boolean),
    ),
  ]),
)

const ICONS = Object.entries(sources).flatMap(([file, src]) =>
  openingTags(src).flatMap((tag) => {
    const name = tag.match(/^<\s*([A-Z][A-Za-z0-9]*)/)?.[1]
    // 🚨 LUCIDE GLYPHS ONLY, AND THAT IS NOT FUSSINESS. The first version
    // read `size=`/`width=` off any capitalised tag and went red on two
    // correct elements: `<Table width={110}>`, a COLUMN width, and
    // `<Avatar size={40}>`, which has a scale of its own. §3.3 is about
    // icons — "Icons stay lucide-react; no emoji" — so the set is derived
    // from each file's own lucide import.
    if (!name || !LUCIDE[file].has(name)) return []
    const where = `${file} <${name}>`
    const cls = tagClassTokens(tag)
    const scale = (p) => {
      const bare = cls.find((t) => new RegExp(`^${p}-[\\d.]+$`).test(t))
      if (bare) return Number(bare.slice(p.length + 1)) * 4
      const arb = cls.find((t) => new RegExp(`^${p}-\\[[\\d.]+px\\]$`).test(t))
      return arb ? Number(arb.match(/[\d.]+/)[0]) : null
    }
    const prop = (p) => {
      const m = tag.match(new RegExp(`\\b${p}=\\{?\\s*"?([\\d.]+)"?\\s*\\}?`))
      return m ? Number(m[1]) : null
    }
    const sq = scale('size') ?? prop('size')
    const w = sq ?? scale('w') ?? prop('width')
    const h = sq ?? scale('h') ?? prop('height')
    return w === null && h === null ? [] : [{ where, w, h }]
  }),
)

describe('🚨 Q2: sentence case everywhere except the Label step', () => {
  // "Uppercase appears only in the Label step and the transition title, both
  // tracked; everything else is sentence case with zero tracking" (§3.1), and
  // Q2 ruled the same thing. AT-08 counted 91 `uppercase` and 86 letterspaced
  // elements across these thirteen files: a nav item, a section title, a card
  // title, a field label, a table header, a button label, a status chip, a
  // group heading and a danger-zone warning were one typographic object, so
  // nothing could be scanned because nothing differed.
  const UPPER_CLASS = CLASS_TOKENS.filter(({ t }) => t === 'uppercase')
  const UPPER_CSS = [...cssCode.matchAll(/([^{};]+)\{([^}]*)\}/g)]
    .filter((m) => /text-transform:\s*uppercase/.test(m[2]))
    .map((m) => ({ sel: m[1].trim(), body: m[2] }))

  it('finds the uppercase runs it is checking (the scans are not empty)', () => {
    // 🚨 IT COUNTS BOTH SIDES. Seven `text-label uppercase` spans in the two
    // converted files and five `text-transform: uppercase` rules in the
    // sheet. A review noted that a utilities-only companion goes red on
    // correct work the day someone moves those seven spans into `.at-*`
    // rules, which is the direction this directory is already travelling.
    expect(UPPER_CLASS.length + UPPER_CSS.length).toBeGreaterThan(0)
  })

  it('🚨 every `uppercase` utility sits on the Label step', () => {
    // Capitals are a ROLE here, not an emphasis: they say "this is a label
    // for the thing below it". On any other step they are just loud.
    expect(UPPER_CLASS.filter(({ cls }) => !cls.split(/\s+/).includes('text-label'))).toEqual([])
  })

  it('🚨 and no `uppercase` is handed down to a child that is not', () => {
    // The subtlest evasion either review found: `uppercase` on a WRAPPER that
    // also carries `text-label` satisfies the check above, while the
    // `text-h3` title and `text-caption` subtitle nested inside it render in
    // capitals at 14 and 12px with the parent's 0.06em inherited — no step
    // resets `letter-spacing`. A tag carrying `uppercase` has to be the thing
    // that holds the words.
    const bad = []
    for (const [file, src] of Object.entries(sources)) {
      for (const tag of openingTags(src)) {
        if (!tagClassTokens(tag).includes('uppercase')) continue
        const after = src.slice(src.indexOf(tag) + tag.length)
        if (/^\s*</.test(after)) bad.push(`${file} — \`uppercase\` on a tag whose first child is an element`)
      }
    }
    expect(bad).toEqual([])
  })

  it('🚨 and so does every `text-transform: uppercase` in the stylesheet', () => {
    // 🚨 THE JSX SCAN CANNOT SEE A RULE, AND ELEVEN OF THE THIRTEEN FILES
    // CARRY THEIR TYPE IN RULES. A review put `text-transform: uppercase`
    // back on `.at-picker-label` — the one class the previous commit exists
    // to fix — and all 79 tests stayed green.
    expect(UPPER_CSS.filter((r) => !/font-size:\s*var\(--text-label\)/.test(r.body)).map((r) => r.sel)).toEqual([])
  })

  it('🚨 no `tracking-*` utility: the Label token carries its own 0.06em', () => {
    // All fourteen of these were `tracking-wider`, which is 0.05em against
    // the token's 0.06em — a second tracking scale, one step out, on top of
    // the one the theme already applies.
    //
    // `tracking-normal` is exempt BY NAME because it is the one utility that
    // REMOVES tracking rather than inventing some: a sentence-case child of a
    // Label-step parent inherits 0.06em, and cancelling that is correct. A
    // guard that blocks the only right answer is a defect of its own.
    expect(CLASS_TOKENS.filter(({ t }) => /^tracking-(tighter|tight|wide|wider|widest|\[)/.test(t))).toEqual([])
  })

  it('🚨 and no second tracking scale in the stylesheet', () => {
    const bad = [...cssCode.matchAll(/letter-spacing:\s*([^;]+);/g)]
      .map((m) => m[1].trim())
      .filter((v) => !['0', 'normal', '0.06em', 'var(--text-label--letter-spacing)'].includes(v))
    expect(bad).toEqual([])
  })

  it('🚨 the weight axis is 400 and 600, and nothing else', () => {
    // §3: "Weights: 2 (400, 600)". `font-bold` is 700 and there is no 700 —
    // and on the Label and H3 steps the theme already emits 600, so a
    // `font-bold` beside either was overriding the scale to LEAVE it.
    // `font-semibold` and `font-normal` are the two legal spellings; the
    // first version named `font-bold` alone and `font-black`, `font-medium`,
    // `font-extrabold` and `font-[700]` all walked past it.
    expect(
      CLASS_TOKENS.filter(({ t }) => /^font-(bold|extrabold|black|medium|light|thin|extralight|\[)/.test(t)),
    ).toEqual([])
  })

  it('🚨 and the stylesheet stays on it too', () => {
    const ALLOWED = new Set([
      '400', '600', 'inherit',
      'var(--text-h1--font-weight)', 'var(--text-h2--font-weight)',
      'var(--text-h3--font-weight)', 'var(--text-label--font-weight)',
    ])
    const bad = [...cssCode.matchAll(/font-weight:\s*([^;]+);/g)]
      .map((m) => m[1].trim())
      .filter((v) => !ALLOWED.has(v))
    expect(bad).toEqual([])
  })

  it('🚨 §3.3 reaches the stylesheet too', () => {
    // One survivor, named here rather than left invisible: a 10px glyph in a
    // 16px box inside a 20px `.ui-badge`, which exists only because the kit
    // has no badge below its default and no icon button below 28px — the
    // request is open in the hand-off's §6. Naming it is the difference
    // between a known exemption and a rule nobody is keeping.
    const EXEMPT = new Set(['.at-dept-remove svg'])
    const bad = []
    for (const m of cssCode.matchAll(/([^{};]+)\{([^}]*)\}/g)) {
      const sel = m[1].trim()
      if (!/svg\s*$/.test(sel) || EXEMPT.has(sel)) continue
      for (const d of m[2].matchAll(/(?:width|height):\s*([^;]+);/g)) {
        const v = d[1].trim()
        if (/^var\(--icon-(sm|md|lg)\)$/.test(v)) continue
        const px = v.match(/^([\d.]+)px$/)
        if (!px || ![14, 16, 24].includes(Number(px[1]))) bad.push(`${sel} — ${v}`)
      }
    }
    expect(bad).toEqual([])
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

  it('🚨 and neither does the JSX', () => {
    // The stylesheet was the only thing this checked, and the thirteen files
    // were not. Two raw hexes survived in `StorageSection`'s quota meter
    // behind a comment calling them "the file's own two tokens" — and the
    // alarm one measured 2.21:1 against its own track, so the bar faded out
    // at exactly the moment it meant "uploads are being refused".
    //
    // Comments are stripped first: this file and several components discuss
    // the old values by name, and a guard that cannot tell code from prose
    // gets deleted by the next person who trips over it.
    // 🚨 A FLAT SCAN, NOT A QUOTE-PAIRING ONE, AND THAT IS THE SECOND
    // ATTEMPT. The first spelling matched a hex only as the ENTIRE contents
    // of a single-quoted token, so round two put both hexes back as
    // `"#9a3412"` and the check stayed green. The obvious repair — pair the
    // quotes properly and look inside — was ALSO green against the same
    // mutation: these files are CRLF and full of apostrophes in JSX prose
    // ("this company's media"), so a quote-pairing matcher mispairs almost
    // immediately and every offset after it is fiction.
    //
    // There is no legitimate colour literal in these thirteen files, so the
    // honest check is the simplest one: strip comments, then a hex or an
    // rgb() ANYWHERE in what is left is a finding. Nothing to evade by
    // changing quotes, by concatenating, or by hiding it in a longer string.
    const offenders = []
    for (const [file, src] of Object.entries(sources)) {
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
      for (const m of code.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)) {
        const line = code.slice(0, m.index).split('\n').length
        offenders.push(`${file}:~${line} writes ${m[0]} — colours come from @theme (C8)`)
      }
    }
    expect(offenders).toEqual([])
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
