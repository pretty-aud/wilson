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
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const blank = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
// Every innermost rule, its selector and its declarations. `[^{}]` stops at
// the brace of an enclosing @layer or @media, so a nested rule's selector is
// its own. (No sheet in src uses CSS nesting at FX6.)
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
// A declaration that draws or sizes an edge, or that forced colours (Windows
// High Contrast) would paint out or be told to leave alone. A border's
// COLOUR is not one: forced colours replace it and keep the width, which is
// what keeps the line there with the tone gone (measured in Chromium, FX6).
// Case-insensitive, because CSS is (review round 1, R1-02).
const EDGE = /^(?:border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-(?:width|style))?|border-image(?:-[a-z]+)?|box-shadow|background-image|forced-color-adjust|outline(?:-(?:width|style))?)\s*:/i
const edgesOf = (r) => r.decls.filter((d) => EDGE.test(d)).map((d) => d.toLowerCase())
// The rules that name the banner: its own, the badge's (`.ui-status`, which
// the banner IS) and the band slot around it. By NAME, so a rule hung on a
// page's own ancestor (`.rb-tasks-view .ui-status-banner`) is caught too.
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
/** Every sheet, by SELECTOR MATCHING against the real markup (review round 1,
 *  R1-02: `.ui-dialog > *`, `.rb-task-detail [data-tone]`, `[class~=…]` reach
 *  the band or the banner without naming them): [] when no rule with an edge
 *  matches the band or the banner in any of the given renders, the ALLOWED
 *  rules of index.css aside. `:hover` is dropped (it is only a moment); a
 *  `::before`/`::after` is judged on its host (its box can draw a line
 *  there); any other pseudo-element styles something that is not the
 *  element's own edge, and is skipped; a keyframe's step is not a selector.
 *  A selector the matcher cannot read is REPORTED, never passed: a check
 *  that skipped what it could not parse would pass a reaching rule written
 *  in a syntax it does not know. */
const PSEUDO = /::?(?:before|after)\b/g
const KEYFRAME_STEP = /^(?:from|to|\d+(?:\.\d+)?%)$/i
const reachVerdict = (part, targets) => {
  if (KEYFRAME_STEP.test(part) || /::(?!before\b|after\b)/.test(part)) return null
  const sel = part.replace(/:hover\b/g, '').replace(PSEUDO, '') || '*'
  try { return targets.some((el) => el.matches(sel)) ? 'reaches the banner' : null } catch { return 'cannot be read by the matcher: judge it' }
}
const reachProblems = (files, targets) => files.flatMap(({ path, text }) => rules(text)
  .filter((r) => !r.sel.startsWith('@') && edgesOf(r).length && !(path === 'index.css' && ALLOWED.has(r.sel)))
  .flatMap((r) => r.sel.split(/,(?![^(]*\))/).map((p) => p.trim())
    .map((part) => [part, reachVerdict(part, targets)]).filter(([, v]) => v)
    .map(([part, v]) => `${path}: ${part} { ${edgesOf(r).join('; ')} } ${v}`)))
/** The callers: [] when every StatusBanner is handed its status and nothing
 *  else, and nothing outside the kit draws the banner another way: an
 *  aliased import, `createElement`, a spread, or the class written by hand
 *  (review round 1, R1-02). Comments are not code. */
const CALL = /<StatusBanner\b[^>]*>/g
const GOOD_TAG = /^<StatusBanner status=\{[^{}]*\} \/>$/
const KIT_FILES = new Set(['ui/StatusBanner.jsx', 'ui/index.js'])
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1 ')
const callerProblems = (files) => files.filter((f) => !KIT_FILES.has(f.path)).flatMap(({ path, text }) => {
  const c = code(text)
  const out = (c.match(CALL) || []).filter((tag) => !GOOD_TAG.test(tag)).map((tag) => `${path}: ${tag}`)
  const rest = c.replace(CALL, ' ')
    .replace(/import\s*\{[^}]*\}\s*from\s*['"][^'"]+['"]/g, (imp) => (/\bStatusBanner\s+as\b/.test(imp) ? imp : ' '))
  if (/\bStatusBanner\b/.test(rest)) out.push(`${path}: StatusBanner used other than as <StatusBanner status={…} />`)
  if (/ui-status-banner/.test(c)) out.push(`${path}: writes the class ui-status-banner itself`)
  return out
})

const walk = (dir, name) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = join(dir, e.name)
  return e.isDirectory() ? walk(p, name) : name.test(e.name) ? [p] : []
})
const read = (p) => ({ path: relative(SRC, p).split(sep).join('/'), text: readFileSync(p, 'utf8') })
const KIT = readFileSync(join(SRC, 'index.css'), 'utf8')
const SHEETS = walk(SRC, /\.css$/).map(read).filter((f) => f.path !== 'index.css')
const SOURCES = walk(SRC, /\.jsx?$/).filter((p) => !/\.test\.jsx?$/.test(p)).map(read)
// The class each popup gives its Dialog, read from its own file below, so the
// renders carry the ancestors a page sheet could key on.
const POPUPS = [
  ['tools/rabbit_v0.1.0/components/TaskDetailPopup.jsx', 'rb-task-detail'],
  ['tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx', 'rb-asset-detail'],
  ['tools/rabbit_v0.1.0/views/ScenesView.jsx', 'rb-scene-detail wilson-dark-scroll'],
  ['tools/rabbit_v0.1.0/views/EntityListView.jsx', 'rb-ent-detail'],
]
/** The band and the banner as the kit renders them: every popup's class,
 *  every Dialog width, the dark and the light surface. */
const renderTargets = () => POPUPS.flatMap(([, cls]) => ['form', 'reading', 'workbench'].flatMap((width) => ['dark', 'light'].flatMap((surface) => {
  const { container } = render(<Dialog title="T" className={cls} width={width} band={<StatusBanner status="final" surface={surface} />}>body</Dialog>)
  const band = container.querySelector('.ui-dialog-band')
  return [band, band.querySelector('.ui-status-banner')]
})))

describe('FX6: the status line is 3px, set in ONE place', () => {
  it('index.css: `.ui-status-banner` draws the line, 3px solid in the tone; its light variant keeps the 1px rule; no other rule naming the banner, the badge or the band draws, sizes or opts out of an edge (so forced colours keep the line, recoloured)', () => {
    expect(kitProblems(KIT)).toEqual([])
  })

  it('no other stylesheet gives the banner, the badge or the band an edge', () => {
    // The denominator: the scan opened the sheets (13 besides index.css at FX6).
    expect(SHEETS.length).toBeGreaterThanOrEqual(13)
    expect(SHEETS.map((f) => f.path)).toContain('tools/rabbit_v0.1.0/views/rabbitScenes.css')
    expect(sheetsProblems(SHEETS)).toEqual([])
  })

  it('no rule in any sheet reaches the rendered band or banner with an edge, whatever its selector names', () => {
    for (const [file, cls] of POPUPS) {
      const f = SOURCES.find((s) => s.path === file)
      expect(f?.text, `${file}: the popup's Dialog class`).toContain(`className="${cls}"`)
    }
    const targets = renderTargets()
    expect(targets).toHaveLength(POPUPS.length * 3 * 2 * 2)
    expect(targets.every(Boolean)).toBe(true)
    expect(reachProblems([{ path: 'index.css', text: KIT }, ...SHEETS], targets)).toEqual([])
  })

  it('every popup draws the banner with its status alone, so every popup follows the one rule', () => {
    expect(callerProblems(SOURCES)).toEqual([])
    // The denominator: the five popups (task, asset, scene, shot, and the
    // entity popup for levels and experiences), in their four files.
    const callers = SOURCES.filter((f) => (code(f.text).match(CALL) || []).length > 0)
    expect(callers.map((f) => f.path).sort()).toEqual(POPUPS.map(([file]) => file).sort())
    expect(callers.reduce((n, f) => n + code(f.text).match(CALL).length, 0)).toBe(5)
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
    // The weight set again in a new rule that names the banner, in any case.
    expect(kitProblems(`${KIT}\n@layer components { .ui-dialog-band > .ui-status-banner { border-bottom: 1px solid red; } }`)).not.toEqual([])
    expect(kitProblems(`${KIT}\n.UI-STATUS-BANNER.x { BORDER-BOTTOM-WIDTH: 1px; }`)).not.toEqual([])
    // The bar redrawn as a shadow or an image (forced colours paint both out),
    // or the band opted out of forced colours.
    expect(plant(`${LINE};`, 'box-shadow: inset 0 -3px 0 var(--status-color);')).not.toEqual([])
    expect(plant(`${LINE};`, `${LINE}; border-image: linear-gradient(red, red) 1;`)).not.toEqual([])
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
    const targets = renderTargets()
    const reach = (text, path = 'x.css') => reachProblems([{ path, text }], targets)
    expect(reach('.ui-dialog > * { border-bottom-width: 1px; }', 'index.css')).toHaveLength(1)
    expect(reach('.ui-dialog [data-status] { border-bottom: 1px solid red; }', 'index.css')).toHaveLength(1)
    expect(reach('[class~="ui-status-banner"] { border-bottom-width: 1px; }', 'index.css')).toHaveLength(1)
    expect(reach('.ui-dialog-head + div > span { border-bottom: 0; }', 'index.css')).toHaveLength(1)
    expect(reach('.rb-task-detail > * { BORDER-BOTTOM: 1px solid red; }')).toHaveLength(1)
    expect(reach('.rb-ent-detail [data-tone]:hover { border-image: linear-gradient(red, red) 1; }')).toHaveLength(1)
    expect(reach('.rb-scene-detail > div::after { border-bottom: 2px solid red; }')).toHaveLength(1)
    expect(reach('.ui-dialog[data-width="workbench"] > div:nth-child(2) { border-bottom: 2px solid red; }')).toHaveLength(1)
    expect(reach('.ui-dialog-band > [data-surface="light"] { border-bottom-width: 3px; }')).toHaveLength(1)
    // …and rules that do not reach it stay out: another popup part, a
    // scrollbar, an ALLOWED rule of the kit's own.
    expect(reach('.rb-scene-detail-task > div { border: 0; } .ui-dialog-foot { border-top: 1px solid red; }')).toEqual([])
    expect(reach('.ui-dialog-band::-webkit-scrollbar { border: 1px solid red; }')).toEqual([])
    expect(reach('@keyframes x { 50% { border-bottom-width: 2px; } }')).toEqual([])
    // A selector the matcher cannot read is reported, not passed.
    expect(reach('.ui-dialog-band >>> span { border-bottom: 1px solid red; }')).toEqual([expect.stringMatching(/cannot be read by the matcher/)])
    expect(reach(`.ui-status-banner { ${LINE}; }`, 'index.css')).toEqual([])
    expect(reach(`.ui-status-banner { ${LINE}; }`, 'pages.css')).toHaveLength(1)
    // The callers.
    expect(callerProblems([{ path: 'x.jsx', text: 'band={<StatusBanner status={s} className="thin" />}' }])).toHaveLength(1)
    expect(callerProblems([{ path: 'x.jsx', text: 'band={<StatusBanner status={s} style={{ borderBottomWidth: 1 }} />}' }])).toHaveLength(1)
    expect(callerProblems([{ path: 'x.jsx', text: 'band={<StatusBanner\n  status={s}\n  {...rest}\n/>}' }])).toHaveLength(1)
    expect(callerProblems([{ path: 'x.jsx', text: "import { Dialog, StatusBanner as SB } from '../ui'\nband={<SB status={s} />}" }])).toHaveLength(1)
    expect(callerProblems([{ path: 'x.jsx', text: "import { StatusBanner } from '../ui'\nband={createElement(StatusBanner, { status: s, style })}" }])).toHaveLength(1)
    expect(callerProblems([{ path: 'x.jsx', text: 'band={<StatusBadge status={s} className="ui-status-banner" />}' }])).toHaveLength(1)
    expect(callerProblems([{ path: 'x.jsx', text: "import {\n  Dialog,\n  StatusBanner,\n} from '../ui'\n// a <StatusBanner className=\"x\" /> in a comment is not code\nband={<StatusBanner status={s} />}" }])).toEqual([])
  })
})
