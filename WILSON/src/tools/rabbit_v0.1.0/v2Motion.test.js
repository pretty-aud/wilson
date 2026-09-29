// =============================================================================
// V2, the second visual QA pass (2026-09-27): B4c §4.2 item 14. Plan §3.4:
// every state transition "honours prefers-reduced-motion with an instant end
// state, scoped by class". Three lane sheets still moved under it — Bins' four
// older fades (bins.css stopped one of five), Tasks' ten (rabbitTasks.css had
// no block at all) — and the Summary's module cards carried an inline 150ms
// transition no sheet could stop.
//
// `reducedMotionBlocks` and `motionCoverage` are rabbitFilesCss.test.js §9's,
// verbatim, pointed at these sheets: every selector a sheet gives a
// transition has its twin in the sheet's one reduced-motion block, declared
// before it, and the block does nothing but stop transitions.
// =============================================================================
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { rulesOf, cssCode, selectorsOf } from './rabbitCssGuards.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, rel), 'utf8').replace(/\r\n/g, '\n')

const sameSel = (s) => s.replace(/\s+/g, ' ').trim()
function reducedMotionBlocks(css) {
  const c = cssCode(css)
  const out = []
  const re = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g
  let m
  while ((m = re.exec(c))) {
    let depth = 1, i = re.lastIndex
    for (; i < c.length && depth > 0; i++) { if (c[i] === '{') depth++; else if (c[i] === '}') depth-- }
    out.push({ start: m.index, end: i, text: c.slice(re.lastIndex, i - 1) })
  }
  return out
}
function motionCoverage(css) {
  const c = cssCode(css)
  const blocks = reducedMotionBlocks(css)
  const inBlock = (i) => blocks.some((b) => i >= b.start && i < b.end)
  const moving = []
  for (const m of c.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim()
    if (sel.startsWith('@') || inBlock(m.index)) continue
    if (!/(?:^|;)\s*transition(?:-[a-z]+)?\s*:\s*(?!none\s*(?:;|$))/.test(m[2])) continue
    for (const one of selectorsOf(sel)) moving.push({ sel: sameSel(one), at: m.index })
  }
  const quiet = new Map()
  const loud = []
  for (const b of blocks) {
    for (const r of rulesOf(b.text)) {
      if (!/^\s*transition\s*:\s*none\s*;?\s*$/.test(r.body)) loud.push(`${sameSel(r.sel)} { ${r.body.trim()} }`)
      for (const one of selectorsOf(r.sel)) quiet.set(sameSel(one), b.start)
    }
  }
  return {
    blocks: blocks.length,
    moving: moving.length,
    uncovered: moving.filter((x) => !quiet.has(x.sel)).map((x) => x.sel),
    late: moving.filter((x) => quiet.has(x.sel) && x.at > quiet.get(x.sel)).map((x) => x.sel),
    loud,
  }
}

/** Each sheet, and the least number of transitions it declares today: a
    read that came back empty is not a pass. */
const SHEETS = {
  'views/bins/bins.css': 5,
  'views/rabbitTasks.css': 10,
  'rabbitShell.css': 3,
}

describe('V2: reduced motion stops every transition in the Bins, Tasks and shell sheets (plan §3.4; B4c §4.2 item 14)', () => {
  for (const [file, least] of Object.entries(SHEETS)) {
    it(`${file}: one block, only \`transition: none\` in it, no \`*\`, and every moving selector's twin declared before it`, () => {
      const css = read(file)
      const cov = motionCoverage(css)
      expect(cov.moving, 'the scan read nothing').toBeGreaterThanOrEqual(least)
      expect(cov.blocks).toBe(1)
      expect(cov.loud).toEqual([])
      expect(cov.uncovered).toEqual([])
      expect(cov.late).toEqual([])
      // C5: never a blanket selector — the pet's keyframes must keep playing.
      for (const b of reducedMotionBlocks(css)) expect(b.text).not.toMatch(/(^|[\s,])\*(\s|,|\{|$)/)
    })
  }

  it('the Summary\'s module cards carry no inline transition: it animated an opacity and a border colour the card no longer changes', () => {
    const src = read('views/ProjectSummaryView.jsx')
    expect(src.match(/className="rb-module /g)?.length, 'the module cards are gone').toBe(3)
    expect(src).not.toMatch(/transition:\s*'opacity 150ms/)
    expect(src).not.toMatch(/className="rb-module [^>]*\bstyle=/)
    // The premise, held: no rule gives the card itself (not its head or its
    // title) an opacity or a border colour that could change, so a
    // transition would animate nothing (R22: off reads through the Switch).
    const shell = cssCode(read('rabbitShell.css'))
    const onCard = rulesOf(shell).filter((r) => selectorsOf(r.sel).map(sameSel).some((s) => /^\.rb-module(\[[^\]]+\])*$/.test(s)))
    expect(onCard.length, 'the card rule moved').toBeGreaterThan(0)
    for (const r of onCard) expect(r.body, r.sel).not.toMatch(/(^|;)\s*(opacity|border-color|transition)\s*:/)
    expect(onCard.filter((r) => /\[data-enabled/.test(r.sel))).toEqual([])
  })

  it('CONTROL: a transition added above the block, and a block rule that does more than stop one, are caught', () => {
    const css = read('rabbitShell.css')
    const at = css.indexOf('@media (prefers-reduced-motion: reduce)')
    expect(at).toBeGreaterThan(0)
    expect(motionCoverage(`${css.slice(0, at)}.rb-v2-x { transition: opacity 1s; }\n  ${css.slice(at)}`).uncovered).toEqual(['.rb-v2-x'])
    const loud = css.replace('.rb-gen { transition: none; }', '.rb-gen { transition: none; opacity: 1; }')
    expect(loud).not.toBe(css)
    expect(motionCoverage(loud).loud).toHaveLength(1)
  })
})
