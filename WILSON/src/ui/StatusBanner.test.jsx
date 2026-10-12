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
    // On a light surface: no well behind the word either, and the line takes
    // the rule's colour (no status colour is drawn on the light ground).
    const light = ruleBody('.ui-status-banner[data-surface="light"]')
    expect(light).toMatch(/background-color:\s*transparent;/)
    expect(light).toMatch(/border-bottom-color:\s*var\(--color-rule-light\);/)
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
// popup that draws the banner follows it. Each check is a function, run on
// the real files and, as its CONTROL, on a copy with the defect planted: a
// check that cannot fail would read as one that passes.
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const blank = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
// Every innermost rule, its selector and its declarations. `[^{}]` stops at
// the brace of an enclosing @layer or @media, so a nested rule's selector is
// its own.
const rules = (src) => [...blank(src).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  sel: m[1].trim().replace(/\s+/g, ' '),
  decls: m[2].split(';').map((d) => d.trim().replace(/\s+/g, ' ')).filter(Boolean),
}))
const LINE = 'border-bottom: 3px solid var(--status-color, var(--color-ink-3))'
// A declaration that draws or sizes an edge, or that forced colours (Windows
// High Contrast) would paint out or be told to leave alone. A border's
// COLOUR is not one: forced colours replace it and keep the width, which is
// what keeps the line there with the tone gone (measured in Chromium, FX6).
const EDGE = /^(?:border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-(?:width|style))?|box-shadow|background-image|forced-color-adjust|outline(?:-(?:width|style))?)\s*:/
// The rules that reach the banner: its own, the badge's (`.ui-status`, which
// the banner IS) and the band slot around it.
const REACHES = /\.ui-status(?![-\w])|\.ui-status-banner(?![-\w])|\.ui-dialog-band(?![-\w])/

/** index.css: [] when `.ui-status-banner` is one rule whose only edge is
 *  LINE, and no other rule that reaches the banner has an edge at all. */
const kitProblems = (src) => {
  const out = []
  const all = rules(src)
  const own = all.filter((r) => r.sel === '.ui-status-banner')
  if (own.length !== 1) out.push(`${own.length} rules named exactly .ui-status-banner`)
  for (const r of own) {
    const edges = r.decls.filter((d) => EDGE.test(d))
    if (edges.length !== 1 || edges[0] !== LINE) out.push(`.ui-status-banner draws ${JSON.stringify(edges)}, not ${LINE}`)
  }
  for (const r of all) {
    if (r.sel === '.ui-status-banner' || !REACHES.test(r.sel)) continue
    for (const d of r.decls.filter((x) => EDGE.test(x))) out.push(`${r.sel} { ${d} }`)
  }
  return out
}
/** Any other stylesheet: [] when no rule reaching the banner has an edge. */
const sheetsProblems = (files) => files.flatMap(({ path, text }) => rules(text)
  .filter((r) => REACHES.test(r.sel))
  .flatMap((r) => r.decls.filter((d) => EDGE.test(d)).map((d) => `${path}: ${r.sel} { ${d} }`)))
/** The callers: [] when every StatusBanner is handed its status and nothing
 *  else — no class or style that could give one popup a line of its own. */
const CALL = /<StatusBanner\b[^>]*>/g
const callerProblems = (files) => files.flatMap(({ path, text }) => [...text.matchAll(CALL)]
  .map((m) => m[0])
  .filter((tag) => !/^<StatusBanner status=\{[^{}]*\} \/>$/.test(tag))
  .map((tag) => `${path}: ${tag}`))

const walk = (dir, name) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = join(dir, e.name)
  return e.isDirectory() ? walk(p, name) : name.test(e.name) ? [p] : []
})
const read = (p) => ({ path: relative(SRC, p).split(sep).join('/'), text: readFileSync(p, 'utf8') })
const KIT = readFileSync(join(SRC, 'index.css'), 'utf8')
const SHEETS = walk(SRC, /\.css$/).map(read).filter((f) => f.path !== 'index.css')
const SOURCES = walk(SRC, /\.jsx?$/).filter((p) => !/\.test\.jsx?$/.test(p)).map(read)

describe('FX6: the status line is 3px, set in ONE place', () => {
  it('index.css: `.ui-status-banner` draws the line, 3px solid in the tone, and no other rule that reaches the banner draws, sizes or opts out of an edge (so forced colours keep it, recoloured)', () => {
    expect(kitProblems(KIT)).toEqual([])
  })

  it('no other stylesheet gives the banner, the badge or the band an edge', () => {
    // The denominator: the scan opened the sheets (13 besides index.css at FX6).
    expect(SHEETS.length).toBeGreaterThanOrEqual(13)
    expect(SHEETS.map((f) => f.path)).toContain('tools/rabbit_v0.1.0/views/rabbitScenes.css')
    expect(sheetsProblems(SHEETS)).toEqual([])
  })

  it('every popup draws the banner with its status alone, so every popup follows the one rule', () => {
    expect(callerProblems(SOURCES)).toEqual([])
    // The denominator: the five popups (task, asset, scene, shot, and the
    // entity popup for levels and experiences), in their four files.
    const callers = SOURCES.filter((f) => (f.text.match(CALL) || []).length > 0)
    expect(callers.map((f) => f.path).sort()).toEqual(expect.arrayContaining([
      'tools/rabbit_v0.1.0/components/TaskDetailPopup.jsx',
      'tools/rabbit_v0.1.0/views/EntityListView.jsx',
      'tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx',
      'tools/rabbit_v0.1.0/views/ScenesView.jsx',
    ]))
    expect(callers.reduce((n, f) => n + [...f.text.matchAll(CALL)].length, 0)).toBeGreaterThanOrEqual(5)
  })

  it('CONTROL: each check finds its defect planted in a copy', () => {
    const plant = (from, to) => {
      const s = KIT.replace(from, to)
      expect(s, `nothing was planted: ${from}`).not.toBe(KIT)
      return kitProblems(s)
    }
    const LIGHT = '.ui-status-banner[data-surface="light"] { background-color: transparent; border-bottom-color: var(--color-rule-light); }'
    // The weight changed in the one rule, either way.
    expect(plant(`${LINE};`, `${LINE.replace('3px', '2px')};`)).not.toEqual([])
    expect(plant(`${LINE};`, `${LINE.replace('3px', '1px')};`)).not.toEqual([])
    // The weight set a second time: on the light rule, or in a new rule.
    expect(plant(LIGHT, LIGHT.replace('; }', '; border-bottom-width: 1px; }'))).not.toEqual([])
    expect(kitProblems(`${KIT}\n@layer components { .ui-dialog-band > .ui-status-banner { border-bottom: 1px solid red; } }`)).not.toEqual([])
    // The bar redrawn as a shadow (forced colours paint it out), or the band
    // opted out of forced colours.
    expect(plant(`${LINE};`, 'box-shadow: inset 0 -3px 0 var(--status-color);')).not.toEqual([])
    expect(kitProblems(`${KIT}\n.ui-dialog-band { forced-color-adjust: none; }`)).not.toEqual([])
    // The rule renamed away.
    expect(plant('.ui-status-banner {', '.ui-status-banner-x {')).not.toEqual([])
    // A colour change is not an edge: the light rule as it is passes.
    expect(plant(LIGHT, LIGHT.replace('var(--color-rule-light)', 'red'))).toEqual([])
    // Another sheet, and a caller.
    expect(sheetsProblems([{ path: 'x.css', text: '@layer components { .rb-x .ui-status-banner { border-bottom-width: 1px; } }' }])).toHaveLength(1)
    expect(sheetsProblems([{ path: 'x.css', text: '.rb-x > .ui-status { border: 1px solid red }' }])).toHaveLength(1)
    expect(sheetsProblems([{ path: 'x.css', text: '.rb-x > .ui-status-dot { border: 1px solid red }' }])).toEqual([])
    expect(callerProblems([{ path: 'x.jsx', text: 'band={<StatusBanner status={s} className="thin" />}' }])).toHaveLength(1)
    expect(callerProblems([{ path: 'x.jsx', text: 'band={<StatusBanner status={s} style={{ borderBottomWidth: 1 }} />}' }])).toHaveLength(1)
    expect(callerProblems([{ path: 'x.jsx', text: 'band={<StatusBanner status={s} />}' }])).toEqual([])
  })
})
