/** @vitest-environment jsdom */
// StatusBanner (FX3, kit request FX3-KR-2): StatusBadge at a popup's full
// width, under its title. One source for the word and the tone; the band adds
// only geometry and a line of the tone (3px since FX6), never a colour or a
// type weight of its own.
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join, relative, sep } from 'node:path'
import { StatusBanner } from './StatusBanner'
import { StatusBadge } from './StatusBadge'
import { Dialog } from './Dialog'
import { statusMeta } from './StatusDot'

afterEach(cleanup)

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const ruleBody = (sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = css.match(new RegExp(`(?:^|[\\s}])${esc}\\s*\\{([^}]*)\\}`))
  return m ? m[1] : null
}

describe('StatusBanner', () => {
  it('is the badge at the band\'s width: the same element, word, tone and dot, plus its own class', () => {
    const { container } = render(<StatusBanner status="needs_revisions" />)
    const banner = container.firstElementChild
    expect([...banner.classList]).toEqual(['ui-status', 'ui-status-banner'])
    const m = statusMeta('needs_revisions')
    expect([banner.dataset.status, banner.dataset.tone, banner.textContent]).toEqual(['needs_revisions', m.tone, m.label])
    const dot = banner.querySelector('.ui-status-dot')
    expect([dot.dataset.tone, dot.getAttribute('aria-hidden')]).toEqual([m.tone, 'true'])
    expect(banner.getAttribute('style')).toBeNull()
    // The very markup StatusBadge draws, so the two can never disagree.
    const { container: badge } = render(<StatusBadge status="needs_revisions" />)
    expect(banner.innerHTML).toBe(badge.firstElementChild.innerHTML)
  })

  it('every status in the one map gives its own tone and word; a caller\'s class joins, never replaces', () => {
    for (const s of ['not_started', 'in_progress', 'approved', 'final', 'blocked', 'on_hold', 'omitted']) {
      const { container } = render(<StatusBanner status={s} className="x-extra" />)
      const b = container.firstElementChild
      expect([b.dataset.tone, b.textContent], s).toEqual([statusMeta(s).tone, statusMeta(s).label])
      expect(b.classList.contains('ui-status-banner') && b.classList.contains('ui-status') && b.classList.contains('x-extra'), s).toBe(true)
      cleanup()
    }
  })

  it('the stylesheet: full width, 28px, the gutter, square, NO tint behind the word, and one 3px line in the tone — no font, weight or ink of its own (those are .ui-status\'s)', () => {
    const body = ruleBody('.ui-status-banner')
    expect(body, 'the .ui-status-banner rule is gone').not.toBeNull()
    expect(body).toMatch(/display:\s*flex;/)
    expect(body).toMatch(/width:\s*100%;/)
    expect(body).toMatch(/height:\s*28px;/)
    expect(body).toMatch(/padding:\s*0 var\(--spacing-gutter\);/)
    expect(body).toMatch(/border-radius:\s*0;/)
    // Audrey, 2026-10-11: "remove the green bar the text is in ... leave just
    // the color dot and the color line below the title". The badge's tint is
    // cleared here; the dot and the line carry the colour.
    expect(body).toMatch(/background-color:\s*transparent;/)
    // FX6 (Audrey, 2026-10-12): "lets make the line thicker it feels to thin".
    expect(body).toMatch(/border-bottom:\s*3px solid var\(--status-color, var\(--color-ink-3\)\);/)
    // Nothing typographic, and no ink of its own.
    expect(body).not.toMatch(/font-|(?:^|[\s;])color:|background:|letter-spacing|text-transform/)
    // The rule comes AFTER `.ui-status` (same specificity), so the transparent
    // ground wins over the badge's tint.
    expect(css.indexOf('.ui-status-banner {')).toBeGreaterThan(css.search(/\.ui-status \{/))
    // On a light surface: no well behind the word either, and the line is the
    // light page's 1px rule (no status colour is drawn on the light ground, so
    // there is no status bar to thicken: FX6 review round 1, R1-03).
    const light = ruleBody('.ui-status-banner[data-surface="light"]')
    expect(light).toMatch(/background-color:\s*transparent;/)
    expect(light).toMatch(/border-bottom-color:\s*var\(--color-rule-light\);/)
    expect(light).toMatch(/border-bottom-width:\s*1px;/)
    expect(css.indexOf('.ui-status-banner[data-surface="light"]')).toBeGreaterThan(css.indexOf('.ui-status[data-surface="light"]'))
    // CONTROL: the reader finds a rule that is there and refuses one that is not.
    expect(ruleBody('.ui-status')).toMatch(/font-size:\s*var\(--text-label\);/)
    expect(ruleBody('.ui-status-banner-gone')).toBeNull()
  })
})

// ── FX6: the line is 3px, and its weight is set in ONE place ──────────────
// Audrey, 2026-10-12, her answer to walkthrough 66's question 2: "for the
// window/card that opens for assets/tasks/scenes/etc the status color line
// below the status title. lets make the line thicker it feels to thin". The
// weight is 3px (walkthrough 68: 2, 3 and 4 rendered on every tone, on both
// grounds) and `.ui-status-banner` is the only rule that sets it, so every
// popup that draws the banner follows it. The light-ground variant is the one
// other edge: no status colour is drawn there, so its line stays the light
// page's 1px rule (review round 1, R1-03). Each check is a function, run on
// the real files and, as its CONTROL, on a copy with the defect planted: a
// check that cannot fail would read as one that passes.
//
// ⚠️ WHAT THESE CHECKS CANNOT SEE (review round 2, R2-01): Tailwind utility
// classes on the page around a popup (the task popup is drawn inside its
// page, not portalled), inline styles, and anything not in a `.css` file
// under src/. The end-to-end check is `scripts/fx6-shots.mjs --phase after
// --expect 3`, which stops unless all six popups MEASURE 3px solid in their
// tone in the running app.
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Comments blanked, and statement at-rules (`@layer components;`,
// `@import …;`) too: a statement before a rule would otherwise be read as
// the start of its selector, and the rule skipped (review round 2, R2-03).
const blank = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
  .replace(/@[\w-]+[^{};]*;/g, (c) => c.replace(/[^\n]/g, ' '))
// Every innermost rule, its selector and its declarations. `[^{}]` stops at
// the brace of an enclosing @layer or @media, so a nested rule's selector is
// its own. (No sheet in src uses CSS nesting at FX6; a selector with `&` is
// reported by the matching check, never passed.)
const rules = (src) => [...blank(src).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  sel: m[1].trim().replace(/\s+/g, ' '),
  decls: m[2].split(';').map((d) => d.trim().replace(/\s+/g, ' ')).filter(Boolean),
}))
const LINE = 'border-bottom: 3px solid var(--status-color, var(--color-ink-3))'
const HAIRLINE = 'border-bottom-width: 1px'
// The only two rules that may give the banner an edge, and the edges they give.
const ALLOWED = new Map([
  ['.ui-status-banner', [LINE]],
  ['.ui-status-banner[data-surface="light"]', [HAIRLINE]],
])
// A declaration that draws, sizes, hides or redraws an edge, or that forced
// colours (Windows High Contrast) would paint out or be told to leave alone.
// A border's COLOUR is not one: forced colours replace it and keep the width,
// which is what keeps the line there with the tone gone (measured in
// Chromium, FX6). Case-insensitive, because CSS is (review round 1, R1-02);
// the `background` shorthand, `all`, an animation (whose keyframes can set a
// width), a clip and a mask added by review round 2 (R2-02: each made the
// live line go or change in the running app, and passed).
const EDGE = /^(?:border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-(?:width|style))?|border-image(?:-[a-z]+)?|box-shadow|background(?:-image)?|all|animation(?:-name)?|clip-path|mask(?:-[a-z]+)?|forced-color-adjust|outline(?:-(?:width|style))?)\s*:/i
const edgesOf = (r) => r.decls.filter((d) => EDGE.test(d)).map((d) => d.toLowerCase())
// The rules that name the banner: its own, the badge's (`.ui-status`, which
// the banner IS) and the band slot around it. By NAME, whatever else the
// selector says.
const REACHES = /\.ui-status(?![-\w])|\.ui-status-banner(?![-\w])|\.ui-dialog-band(?![-\w])/i

/** index.css, by name: [] when each ALLOWED rule exists once with exactly its
 *  edges, and no other rule naming the banner, the badge or the band has one. */
const kitProblems = (src) => {
  const out = []
  const all = rules(src)
  for (const [sel, want] of ALLOWED) {
    const own = all.filter((r) => r.sel === sel)
    if (own.length !== 1) out.push(`${own.length} rules named exactly ${sel}`)
    for (const r of own) if (JSON.stringify(edgesOf(r)) !== JSON.stringify(want)) out.push(`${sel} draws ${JSON.stringify(edgesOf(r))}, not ${JSON.stringify(want)}`)
  }
  for (const r of all) {
    if (ALLOWED.has(r.sel) || !REACHES.test(r.sel)) continue
    for (const d of edgesOf(r)) out.push(`${r.sel} { ${d} }`)
  }
  return out
}
/** Any other stylesheet, by name: [] when no rule naming the banner, the
 *  badge or the band has an edge. */
const sheetsProblems = (files) => files.flatMap(({ path, text }) => rules(text)
  .filter((r) => REACHES.test(r.sel))
  .flatMap((r) => edgesOf(r).map((d) => `${path}: ${r.sel} { ${d} }`)))

/* By MATCHING (review rounds 1 and 2, R1-02, R2-01): a rule that never names
   the banner can still reach it (`.ui-dialog > *`, `.rb-task-detail
   [data-tone]`, `.rb-task-view [data-status]` from the page the task popup
   sits in). Each selector is matched right to left along the chain the kit
   renders (the banner, the band, the dialog, the backdrop), each compound by
   jsdom's own `matches`; everything ABOVE the backdrop (the page around the
   popup) and beside it is unknown, so a compound that would have to match
   there is taken to match. That over-reaches on purpose: `.anything
   [data-status]` with an edge is reported, because some page could hold
   it. A state is dropped where it could hold: `:hover`, `:focus-within` and
   `:active` anywhere (the pointer goes everywhere; an open popup holds the
   focus), `:focus` and `:focus-visible` on an ANCESTOR (the dialog's own
   surface takes focus); on the band or the banner themselves they stay,
   since neither can take focus. `::before`/`::after` is judged on its host (its box can
   draw a line there); any other pseudo-element styles something that is not
   the element's own edge, and is skipped; a keyframe's step is not a
   selector. A selector the matcher cannot read, or that nests with `&`, is
   REPORTED, never passed. */
const STATES = /:(?:hover|focus-within|focus-visible|focus|active)\b/g
const SUBJECT_STATES = /:(?:hover|focus-within|active)\b/g
const stateless = (compound, subject) => compound.replace(subject ? SUBJECT_STATES : STATES, '') || '*'
const PSEUDO = /::?(?:before|after)\b/g
/* The rules the matcher reports only because it cannot see the page, each
   judged by hand: the page element its selector hangs on can never hold a
   popup. Keyed on file and selector part; a copy anywhere else is reported. */
const JUDGED_NOT_REACHING = new Map([
  // The pet companion's typing bubble (PetCompanion.jsx): three dot spans
  // and nothing else; the banner is a first-child span, so the matcher
  // cannot rule it out.
  ['index.css :: .dot-pulse span:nth-child(1)', 'the pet\'s typing dots'],
])
const KEYFRAME_STEP = /^(?:from|to|\d+(?:\.\d+)?%)$/i
/** A selector as compounds and the combinators between them (outside
 *  brackets and parentheses). */
const compounds = (sel) => {
  const parts = ['']
  const combs = []
  let depth = 0
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    if (depth === 0 && /[\s>+~]/.test(c)) {
      let comb = ' '
      while (i < sel.length && /[\s>+~]/.test(sel[i])) {
        if (!/\s/.test(sel[i])) {
          if (comb !== ' ') throw new Error(`two combinators in a row: ${sel}`)
          comb = sel[i]
        }
        i++
      }
      i--
      combs.push(comb)
      parts.push('')
      continue
    }
    parts[parts.length - 1] += c
  }
  return { parts: parts.map((p) => p || '*'), combs }
}
/** Could compounds 0..i match with compound i on `el`? `top` is the backdrop:
 *  past it, nothing is known, so anything could match. */
const could = ({ parts, combs }, i, el, top) => {
  if (!el || !el.matches(stateless(parts[i], i === parts.length - 1))) return false
  if (i === 0 || el === top) return true
  const comb = combs[i - 1]
  if (comb === '>') return could({ parts, combs }, i - 1, el.parentElement, top)
  if (comb === '+') return could({ parts, combs }, i - 1, el.previousElementSibling, top)
  if (comb === '~') {
    for (let s = el.previousElementSibling; s; s = s.previousElementSibling) if (could({ parts, combs }, i - 1, s, top)) return true
    return false
  }
  // A descendant: any ancestor in the chain, or one above it, unknown.
  for (let a = el.parentElement; a; a = a.parentElement) {
    if (could({ parts, combs }, i - 1, a, top)) return true
    if (a === top) break
  }
  return true
}
const reachVerdict = (part, targets) => {
  if (KEYFRAME_STEP.test(part) || /::(?!before\b|after\b)/.test(part)) return null
  if (part.includes('&')) return 'nests with &: judge it'
  const sel = part.replace(PSEUDO, '').trim() || '*'
  try {
    // The whole selector must be one jsdom can read before it is cut into
    // compounds (`a >>> b` cuts into two readable ones).
    targets[0].el.matches(sel)
    const c = compounds(sel)
    return targets.some(({ el, top }) => could(c, c.parts.length - 1, el, top)) ? 'could reach the banner' : null
  } catch { return 'cannot be read by the matcher: judge it' }
}
const reachProblems = (files, targets) => files.flatMap(({ path, text }) => rules(text)
  .filter((r) => !r.sel.startsWith('@') && edgesOf(r).length && !(path === 'index.css' && ALLOWED.has(r.sel)))
  .flatMap((r) => r.sel.split(/,(?![^(]*\))/).map((p) => p.trim())
    .filter((part) => !JUDGED_NOT_REACHING.has(`${path} :: ${part}`))
    .map((part) => [part, reachVerdict(part, targets)]).filter(([, v]) => v)
    .map(([part, v]) => `${path}: ${part} { ${edgesOf(r).join('; ')} } ${v}`)))

/** The callers: [] when every StatusBanner is handed its status and nothing
 *  else, and nothing outside the kit draws the banner another way: an
 *  aliased import, `createElement`, a spread, or the class written by hand
 *  (review round 1, R1-02). The tags and the class are read from the RAW
 *  text, so nothing can hide them (round 2, R2-05: a `//` inside a string
 *  hid a tag from the comment stripper); the other uses of the name are read
 *  with one-line strings emptied and then comments removed. */
const CALL = /<StatusBanner\b[^>]*>/g
const GOOD_TAG = /^<StatusBanner status=\{[^{}]*\} \/>$/
const KIT_FILES = new Set(['ui/StatusBanner.jsx', 'ui/index.js'])
// One-line strings only: a lone quote or backtick in a comment ("it's",
// `a code span`) must not swallow the code after it.
const STRINGS = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\\n]|\\.)*`/g
const code = (t) => t.replace(STRINGS, (s) => s[0] + s[0])
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
const callerProblems = (files) => files.filter((f) => !KIT_FILES.has(f.path)).flatMap(({ path, text }) => {
  const out = (text.match(CALL) || []).filter((tag) => !GOOD_TAG.test(tag)).map((tag) => `${path}: ${tag}`)
  const rest = code(text).replace(CALL, ' ')
    .replace(/import\s*\{[^}]*\}\s*from\s*['"]['"]/g, (imp) => (/\bStatusBanner\s+as\b/.test(imp) ? imp : ' '))
    .replace(/import\s+StatusBanner\s+from\s*['"]['"]/g, ' ')
  if (/\bStatusBanner\b/.test(rest)) out.push(`${path}: StatusBanner used other than as <StatusBanner status={…} />`)
  if (/ui-status-banner/.test(text)) out.push(`${path}: writes the class ui-status-banner itself`)
  return out
})
/** For each banner tag in a file, the className of the Dialog that carries
 *  it: the nearest `<Dialog` before the tag, its opening tag read to its end
 *  and only its OWN props kept (what sits inside a `{…}` prop, a title's
 *  span say, is not the Dialog's), the tag required to lie inside it (review
 *  round 2, R2-01: a check that the class appeared ANYWHERE in the file let
 *  one of ScenesView's two Dialogs change class unseen). null when there is
 *  no such Dialog or its class is not a literal. */
const dialogClassesOf = (text) => [...text.matchAll(CALL)].map((m) => {
  const open = text.lastIndexOf('<Dialog', m.index)
  if (open < 0) return null
  let depth = 0
  let own = ''
  let i = open + '<Dialog'.length
  for (; i < text.length; i++) {
    const c = text[i]
    // A comment between props is not a prop (ScenesView's says "In <body>").
    if (depth === 0 && text.startsWith('//', i)) { i = text.indexOf('\n', i); if (i < 0) break; continue }
    if (depth === 0 && text.startsWith('/*', i)) { i = text.indexOf('*/', i) + 1; if (i < 1) break; continue }
    if (depth === 0 && c === '"') {
      const close = text.indexOf('"', i + 1)
      own += text.slice(i, close + 1)
      i = close
      continue
    }
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) break
    else if (depth === 0) own += c
  }
  if (i < m.index) return null
  const cls = own.match(/\bclassName="([^"]+)"/)
  return cls ? cls[1] : null
})

const walk = (dir, name) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = join(dir, e.name)
  return e.isDirectory() ? walk(p, name) : name.test(e.name) ? [p] : []
})
const read = (p) => ({ path: relative(SRC, p).split(sep).join('/'), text: readFileSync(p, 'utf8') })
const KIT = readFileSync(join(SRC, 'index.css'), 'utf8')
const SHEETS = walk(SRC, /\.css$/).map(read).filter((f) => f.path !== 'index.css')
const SOURCES = walk(SRC, /\.jsx?$/).filter((p) => !/\.test\.jsx?$/.test(p)).map(read)
// The popups that draw the banner, and the Dialog class each tag sits in.
const POPUP_FILES = [
  'tools/rabbit_v0.1.0/components/TaskDetailPopup.jsx',
  'tools/rabbit_v0.1.0/views/EntityListView.jsx',
  'tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx',
  'tools/rabbit_v0.1.0/views/ScenesView.jsx',
]
const TAG_CLASSES = SOURCES.filter((f) => !KIT_FILES.has(f.path)).flatMap((f) => dialogClassesOf(f.text).map((cls) => ({ path: f.path, cls })))
/** The band and the banner as the kit renders them, inside each popup's own
 *  Dialog class, with a footer (every popup has one), at every string width
 *  and at a number (four of the five popups pass one, which writes no
 *  `data-width`), on the dark and the light surface. Each target carries the
 *  backdrop, past which the matcher knows nothing. */
const renderTargets = (classes) => [...new Set(classes)].flatMap((cls) => ['form', 'reading', 'workbench', 896].flatMap((width) => ['dark', 'light'].flatMap((surface) => {
  const { container } = render(
    <Dialog title="T" className={cls} width={width} footer={<button type="button">Done</button>} band={<StatusBanner status="final" surface={surface} />}>body</Dialog>,
  )
  const top = container.querySelector('.ui-dialog-backdrop')
  const band = container.querySelector('.ui-dialog-band')
  return [{ el: band, top }, { el: band.querySelector('.ui-status-banner'), top }]
})))

describe('FX6: the status line is 3px, set in ONE place', () => {
  it('index.css: `.ui-status-banner` draws the line, 3px solid in the tone; its light variant keeps the 1px rule; no other rule naming the banner, the badge or the band draws, sizes, hides or opts out of an edge (so forced colours keep the line, recoloured)', () => {
    expect(kitProblems(KIT)).toEqual([])
  })

  it('no other stylesheet gives the banner, the badge or the band an edge', () => {
    // The denominator: the scan opened the sheets (13 besides index.css at FX6).
    expect(SHEETS.length).toBeGreaterThanOrEqual(13)
    expect(SHEETS.map((f) => f.path)).toContain('tools/rabbit_v0.1.0/views/rabbitScenes.css')
    expect(sheetsProblems(SHEETS)).toEqual([])
  })

  it('no rule in any sheet could reach the rendered band or banner with an edge, whatever its selector names and whatever page the popup sits in', () => {
    // Every banner tag sits in a Dialog with a literal class: those classes
    // are the renders'.
    expect(TAG_CLASSES).toHaveLength(5)
    expect(TAG_CLASSES.filter((t) => !t.cls), 'a popup whose Dialog class is not a literal').toEqual([])
    const targets = renderTargets(TAG_CLASSES.map((t) => t.cls))
    expect(targets).toHaveLength(new Set(TAG_CLASSES.map((t) => t.cls)).size * 4 * 2 * 2)
    expect(targets.every(({ el, top }) => el && top)).toBe(true)
    expect(reachProblems([{ path: 'index.css', text: KIT }, ...SHEETS], targets)).toEqual([])
  })

  it('every popup draws the banner with its status alone, so every popup follows the one rule', () => {
    expect(callerProblems(SOURCES)).toEqual([])
    // The denominator: the five popups (task, asset, scene, shot, and the
    // entity popup for levels and experiences), in their four files.
    expect([...new Set(TAG_CLASSES.map((t) => t.path))].sort()).toEqual([...POPUP_FILES].sort())
    expect(TAG_CLASSES).toHaveLength(5)
  })

  it('CONTROL: each check finds its defect planted in a copy', () => {
    const plant = (from, to) => {
      const s = KIT.replace(from, to)
      expect(s, `nothing was planted: ${from}`).not.toBe(KIT)
      return kitProblems(s)
    }
    const LIGHT = '.ui-status-banner[data-surface="light"] { background-color: transparent; border-bottom-color: var(--color-rule-light); border-bottom-width: 1px; }'
    // The weight changed in the one rule, either way.
    expect(plant(`${LINE};`, `${LINE.replace('3px', '2px')};`)).not.toEqual([])
    expect(plant(`${LINE};`, `${LINE.replace('3px', '1px')};`)).not.toEqual([])
    // The light rule at the bar's weight, or without its hairline.
    expect(plant(LIGHT, LIGHT.replace('width: 1px', 'width: 3px'))).not.toEqual([])
    expect(plant(LIGHT, LIGHT.replace(' border-bottom-width: 1px;', ''))).not.toEqual([])
    // The weight set again in a new rule that names the banner, in any case,
    // or after a statement at-rule.
    expect(kitProblems(`${KIT}\n@layer components { .ui-dialog-band > .ui-status-banner { border-bottom: 1px solid red; } }`)).not.toEqual([])
    expect(kitProblems(`${KIT}\n.UI-STATUS-BANNER.x { BORDER-BOTTOM-WIDTH: 1px; }`)).not.toEqual([])
    expect(kitProblems(`${KIT}\n@layer components;\n.ui-status-banner.x { border-bottom-width: 1px; }`)).not.toEqual([])
    // The bar redrawn or removed another way: a shadow, an image, a
    // background, `all`, an animation, a clip, a mask; or the band opted out
    // of forced colours.
    expect(plant(`${LINE};`, 'box-shadow: inset 0 -3px 0 var(--status-color);')).not.toEqual([])
    expect(plant(`${LINE};`, `${LINE}; border-image: linear-gradient(red, red) 1;`)).not.toEqual([])
    for (const d of ['background: linear-gradient(red, red)', 'all: unset', 'animation: thin 1s', 'animation-name: thin', 'clip-path: inset(0 0 2px 0)', 'mask-image: linear-gradient(red, red)']) {
      expect(kitProblems(`${KIT}\n.ui-status-banner.x { ${d}; }`), d).not.toEqual([])
    }
    expect(kitProblems(`${KIT}\n.ui-dialog-band { forced-color-adjust: none; }`)).not.toEqual([])
    // The rule renamed away.
    expect(plant('.ui-status-banner {', '.ui-status-banner-x {')).not.toEqual([])
    // A colour change is not an edge.
    expect(plant(LIGHT, LIGHT.replace('var(--color-rule-light)', 'red'))).toEqual([])
    // Another sheet, by name.
    expect(sheetsProblems([{ path: 'x.css', text: '@layer components { .rb-x .ui-status-banner { border-bottom-width: 1px; } }' }])).toHaveLength(1)
    expect(sheetsProblems([{ path: 'x.css', text: '.rb-x > .ui-status { border: 1px solid red }' }])).toHaveLength(1)
    expect(sheetsProblems([{ path: 'x.css', text: '.rb-x > .ui-status-dot { border: 1px solid red }' }])).toEqual([])
    // Any sheet, by matching: selectors that never name the banner.
    const targets = renderTargets(TAG_CLASSES.map((t) => t.cls))
    const reach = (text, path = 'x.css') => reachProblems([{ path, text }], targets)
    for (const [text, path] of [
      ['.ui-dialog > * { border-bottom-width: 1px; }', 'index.css'],
      ['.ui-dialog [data-status] { border-bottom: 1px solid red; }', 'index.css'],
      ['[class~="ui-status-banner"] { border-bottom-width: 1px; }', 'index.css'],
      ['.ui-dialog-head + div > span { border-bottom: 0; }', 'index.css'],
      ['.rb-task-detail > * { BORDER-BOTTOM: 1px solid red; }'],
      ['.rb-ent-detail [data-tone]:hover { border-image: linear-gradient(red, red) 1; }'],
      ['.rb-scene-detail > div::after { border-bottom: 2px solid red; }'],
      ['.ui-dialog[data-width="workbench"] > div:nth-child(2) { border-bottom: 2px solid red; }'],
      ['.ui-dialog-band > [data-surface="light"] { border-bottom-width: 3px; }'],
      // Round 2's (R2-01, R2-02, R2-03): each changed the live line in the
      // running app and passed the round-1 check.
      ['.rb-task-view [data-status] { border-bottom: 1px solid red; }'],
      ['.rb-task-detail:focus-within [data-status] { border-bottom: 1px solid red; }'],
      ['.ui-dialog:not([data-width]) > div:nth-child(2) > * { border-bottom: 1px solid red; }'],
      ['.rb-shell .ui-dialog-backdrop > .ui-dialog > div > span { border-bottom-width: 1px; }'],
      ['.rb-task-detail [data-status] { all: unset; }'],
      ['.rb-task-detail [data-status] { background: linear-gradient(red, red); }'],
      ['@layer components;\n.rb-task-detail [data-status] { border-bottom-width: 1px; }'],
      // An ancestor's focus holds (the dialog's surface takes it); a judged
      // rule is judged in its own file only.
      ['.ui-dialog:focus > div { border-bottom: 1px solid red; }'],
      ['.dot-pulse span:nth-child(1) { animation: dotPulse 1.4s infinite 0s; }'],
    ]) expect(reach(text, path), text).toHaveLength(1)
    // The band and the banner cannot take focus: a focus ring on the focused
    // element alone does not reach them.
    expect(reach(':focus-visible { outline: 2px solid red; } :focus:not(:focus-visible) { outline: none; }', 'index.css')).toEqual([])
    expect(reach('.dot-pulse span:nth-child(1) { animation: dotPulse 1.4s infinite 0s; }', 'index.css')).toEqual([])
    // CSS nesting is reported, not passed.
    expect(reach('.rb-task-detail { & [data-status] { border-bottom-width: 1px; } }')).toEqual([expect.stringMatching(/nests with &/)])
    // …and rules that do not reach it stay out: another popup part (whose
    // parent is never the band's), the footer, a scrollbar, a keyframe step,
    // an ALLOWED rule of the kit's own.
    expect(reach('.rb-scene-detail-task > div { border: 0; } .ui-dialog-foot { border-top: 1px solid red; }')).toEqual([])
    expect(reach('.ui-dialog-band::-webkit-scrollbar { border: 1px solid red; }')).toEqual([])
    expect(reach('@keyframes x { 50% { border-bottom-width: 2px; } }')).toEqual([])
    expect(reach(`.ui-status-banner { ${LINE}; }`, 'index.css')).toEqual([])
    expect(reach(`.ui-status-banner { ${LINE}; }`, 'pages.css')).toHaveLength(1)
    // A selector the matcher cannot read is reported, not passed.
    expect(reach('.ui-dialog-band >>> span { border-bottom: 1px solid red; }')).toEqual([expect.stringMatching(/cannot be read by the matcher/)])
    // The callers.
    for (const text of [
      'band={<StatusBanner status={s} className="thin" />}',
      'band={<StatusBanner status={s} style={{ borderBottomWidth: 1 }} />}',
      'band={<StatusBanner\n  status={s}\n  {...rest}\n/>}',
      "import { Dialog, StatusBanner as SB } from '../ui'\nband={<SB status={s} />}",
      "import { StatusBanner } from '../ui'\nband={createElement(StatusBanner, { status: s, style })}",
      'band={<StatusBadge status={s} className="ui-status-banner" />}',
      // Round 2's (R2-05): a `//` in a string or in JSX text before the tag.
      'const u = "a // b"; const el = <StatusBanner status={s} className="thin" />',
      '<p>see // notes</p>{<StatusBanner status={s} style={{ height: 1 }} />}',
    ]) expect(callerProblems([{ path: 'x.jsx', text }]), text).toHaveLength(1)
    expect(callerProblems([{ path: 'x.jsx', text: "import {\n  Dialog,\n  StatusBanner,\n} from '../ui'\n// the kit's StatusBanner, under the title\nband={<StatusBanner status={s} />}" }])).toEqual([])
    // The Dialog class is read from the Dialog that carries the tag.
    expect(dialogClassesOf('<Dialog className="a">x</Dialog>\n<Dialog className="b" band={<StatusBanner status={s} />}>')).toEqual(['b'])
    expect(dialogClassesOf('<Dialog className={cls} band={<StatusBanner status={s} />}>')).toEqual([null])
    expect(dialogClassesOf('<Dialog title={<span className="t">x</span>} band={<StatusBanner status={s} />} className="c" width={896}>')).toEqual(['c'])
    expect(dialogClassesOf('<Dialog className="d">x</Dialog>\n<Card band={<StatusBanner status={s} />} />')).toEqual([null])
    expect(dialogClassesOf('<Dialog\n  // In <body> it is outside\n  className="e"\n  band={<StatusBanner status={s} />}\n>')).toEqual(['e'])
  })
})
