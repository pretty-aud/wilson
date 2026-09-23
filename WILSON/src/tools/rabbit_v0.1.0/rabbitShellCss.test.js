// =============================================================================
// rabbitShell.css — the guards for lane B1's stylesheet (UI overhaul B1,
// 2026-09-23). Pattern: dashboardCss.test.js, adminTerminalCss.test.js.
//
// Three things are pinned here:
//   1. the @layer statement comes first (D1 hand-off §5 trap 1: a component-
//      imported stylesheet can be emitted before index.css, and then every
//      rule in it loses to Tailwind's preflight — silently, with every test
//      green, because no test here applies CSS);
//   2. every `rb-` class is declared AND used — a rule with no caller is dead
//      code, and a class with no rule is a state that paints nothing;
//   3. the state extraction holds: in every file B1 has extracted, no inline
//      `style` object decides a colour, fill, border, opacity or shadow with a
//      ternary. That is the shape that silently beats a class (plan §1,
//      review R40), so the restyle depends on it never coming back.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, rel), 'utf8').replace(/\r\n/g, '\n')

/** Strip CSS comments so a rule can never be satisfied by its own documentation. */
const cssCode = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')
/** Strip JS block comments (JSX `{/* … *\/}` included) and whole-line `//` comments. */
const jsCode = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const shellCss = read('rabbitShell.css')

/* B1's files. EXTRACTED grows as each file's state-extraction commit lands;
   a file joins the inline-ternary guard in the same commit that extracts it. */
const OWNED = [
  'Rabbit.jsx', 'components/ViewTabs.jsx', 'components/ProjectContextBar.jsx',
  'views/IntakeWizardView.jsx', 'views/intake/IntakePrepare.jsx', 'views/intake/IntakeProgress.jsx',
  'views/intake/IntakeReview.jsx', 'views/ProjectSummaryView.jsx', 'views/TeamView.jsx',
]
const EXTRACTED = ['Rabbit.jsx', 'components/ViewTabs.jsx', 'components/ProjectContextBar.jsx']

describe('rabbitShell.css declares the cascade layer order before it uses a layer', () => {
  const src = cssCode(shellCss)
  it('names all four layers, in Tailwind order, as a statement, before the first @layer block', () => {
    const statement = src.search(/@layer\s+theme\s*,\s*base\s*,\s*components\s*,\s*utilities\s*;/)
    const firstBlock = src.search(/@layer\s+components\s*\{/)
    expect(statement).toBeGreaterThanOrEqual(0)
    expect(firstBlock).toBeGreaterThanOrEqual(0)
    expect(statement).toBeLessThan(firstBlock)
  })
})

/* ── every rb- class is declared and used ─────────────────────────────────── */
const declaredIn = (css) => new Set((cssCode(css).match(/\.rb-[a-z0-9-]+/g) || []).map((s) => s.slice(1)))
const usedIn = (sources) => new Set(sources.flatMap((s) => jsCode(s).match(/(?<![\w.-])rb-[a-z0-9-]+/g) || []))

describe('every rb- class is both declared and used', () => {
  const declared = declaredIn(shellCss)
  const used = usedIn(OWNED.map(read))

  it('no rule without a caller', () => {
    expect([...declared].filter((c) => !used.has(c))).toEqual([])
  })
  it('no class without a rule', () => {
    expect([...used].filter((c) => !declared.has(c))).toEqual([])
  })
  it('CONTROL: the scanners find a real pair and ignore comments', () => {
    expect(declared.has('rb-viewtab')).toBe(true)
    expect(used.has('rb-viewtab')).toBe(true)
    expect(declaredIn('/* .rb-ghost { } */ .rb-real { }')).toEqual(new Set(['rb-real']))
    expect(usedIn(['{/* className="rb-ghost" */}\n// rb-ghost2\nclassName="rb-real x"'])).toEqual(new Set(['rb-real']))
  })
})

/* ── the extraction holds: no state ternary inside an inline style ──────────
   Anchored on `style=` (T2 hand-off §5 trap 2: a scan that starts INSIDE an
   attribute inverts every quote after it), then walked to its balanced
   closing brace. */
const STATE_PROP = /\b(color|background[A-Za-z]*|border[A-Za-z]*|opacity|boxShadow|outline[A-Za-z]*|fill|stroke|cursor|transform|fontWeight|textDecoration)\s*:\s*[^,\n}]*\?/

export function inlineStateTernaries(src) {
  const code = jsCode(src)
  const hits = []
  // A className template literal that picks a class by state is the other
  // spelling the plan names (§5: "className template literals").
  for (const t of code.matchAll(/className=\{`[^`]*`\}/g)) {
    if (/\$\{[^}]*\?/.test(t[0])) hits.push(`${code.slice(0, t.index).split('\n').length}: ${t[0].slice(0, 90)}`)
  }
  const re = /style=\{/g
  let m
  while ((m = re.exec(code))) {
    let depth = 0
    let i = m.index + 'style='.length
    const start = i
    for (; i < code.length; i++) {
      if (code[i] === '{') depth++
      else if (code[i] === '}' && --depth === 0) break
    }
    const body = code.slice(start, i + 1)
    // `style={cond ? {…} : {…}}` decides the whole object by state.
    const whole = /^\{\s*[\w.?!]+\s*\?\s*\{/.test(body)
    if (whole || STATE_PROP.test(body)) {
      hits.push(`${code.slice(0, m.index).split('\n').length}: ${body.replace(/\s+/g, ' ').slice(0, 90)}`)
    }
  }
  return hits
}

describe('the state extraction holds in every extracted file', () => {
  for (const file of EXTRACTED) {
    it(`${file}: no inline style decides a colour, fill, border, opacity or shadow by state`, () => {
      expect(inlineStateTernaries(read(file))).toEqual([])
    })
  }

  it('CONTROL: the scanner fires on every spelling a state has shipped in, and not on a static style', () => {
    const fires = [
      `<b style={{ color: active ? '#fff' : '#000' }} />`,
      `<b style={{\n  backgroundColor: on ? 'a' : 'b',\n}} />`,
      `<b style={{ border: \`1px solid \${on ? 'a' : 'b'}\` }} />`,
      `<b style={{ opacity: disabled ? 0.3 : 1 }} />`,
      `<b style={{ boxShadow: isActive ? '0 0 0 1px x' : 'none' }} />`,
      `<b style={on ? { color: 'a' } : { color: 'b' }} />`,
      `<b style={{ cursor: disabled ? 'not-allowed' : 'pointer' }} />`,
      `<b style={{ transform: checked ? 'translateX(16px)' : 'none' }} />`,
      '<b className={`text-dense ${on ? \'font-semibold\' : \'\'}`} />',
    ]
    for (const f of fires) expect(inlineStateTernaries(f), f).toHaveLength(1)
    const quiet = [
      `<b style={{ color: '#fff', width: 16 }} />`,
      `<b style={{ width: open ? 200 : 0 }} />`,
      `{/* style={{ color: a ? 'x' : 'y' }} */}`,
      `// style={{ color: a ? 'x' : 'y' }}`,
      '<b className={`ui-x ${className}`} />',
    ]
    for (const q of quiet) expect(inlineStateTernaries(q), q).toEqual([])
  })
})
