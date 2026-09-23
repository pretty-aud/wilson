// =============================================================================
// binsGuards.js — the predicates the Bins tests share (UI overhaul B6).
//
// Not a test file: binsCss.test.js and binsState.test.jsx both import these,
// and a test importing another test file would run that file's suites twice
// (review round 1). Node-only (reads files); nothing in the app imports it.
//
// Every predicate here was hardened by the round-one test reviewer, who ran
// seventy mutations against the first versions and found thirty that passed:
// the inline-state scanner read only `style={{`, only `?`, only six keys; a
// deleted colour rule passed because its selector was still named in the
// lift list; the painted-state check was `>= 8`. Each function below says
// what it now refuses.
// =============================================================================

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const BS = String.fromCharCode(92)

/** Comments out of JSX / JS: a comment may quote a class, a selector or a call. */
export const stripJs = (s) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')

/** Comments out of CSS. */
export const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

/** Every rendering file on the Bins tab: views/bins/**.jsx (not tests) and BinsView. */
export function binsJsx(binsDir) {
  const out = {}
  const walk = (dir, rel = '') => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) { walk(p, `${rel}${name}/`); continue }
      if (name.endsWith('.jsx') && !name.includes('.test.')) out[`${rel}${name}`] = readFileSync(p, 'utf8')
    }
  }
  walk(binsDir)
  out['BinsView.jsx'] = readFileSync(join(binsDir, '..', 'BinsView.jsx'), 'utf8')
  return out
}

// ── The inline-state scanner ───────────────────────────────────────────────
// A visual property chosen by a condition, in any of the spellings round one
// used to get past the first version: a ternary or `&&` inside `style={{ }}`;
// a whole style object chosen by a condition; a conditional spread; a style
// object built elsewhere and passed as `style={id}`; a className template that
// picks a colour utility by condition. A custom property (`'--x': …`) carries
// DATA and is exempt by design — that is the one way round it, on purpose.
export const VISUAL = /^(?:color|background\w*|border\w*|boxShadow|opacity|outline\w*|fill|stroke|textDecoration\w*|fontWeight|filter|textShadow|visibility)$/
const choice = (v) => /\?|&&/.test(v.replace(/\?\?|\?\./g, ''))
function balanced(src, open) {
  let d = 0, j = open, q = null
  for (; j < src.length; j++) {
    const c = src[j]
    if (q) { if (c === q && src[j - 1] !== BS) q = null; continue }
    if (c === "'" || c === '"' || c === '`') { q = c; continue }
    if ('{(['.includes(c)) d++
    else if ('})]'.includes(c)) { d--; if (d === 0) break }
  }
  return src.slice(open + 1, j)
}
function topLevel(body) {
  const out = []; let d = 0, s = 0, q = null
  for (let k = 0; k < body.length; k++) {
    const c = body[k]
    if (q) { if (c === q && body[k - 1] !== BS) q = null; continue }
    if (c === "'" || c === '"' || c === '`') { q = c; continue }
    if ('([{'.includes(c)) d++
    else if (')]}'.includes(c)) d--
    else if (c === ',' && d === 0) { out.push(body.slice(s, k)); s = k + 1 }
  }
  out.push(body.slice(s))
  return out.map(p => p.trim()).filter(Boolean)
}
const visualKeyIn = (e) => [...e.matchAll(/(?<![\w$-])['"]?([A-Za-z]+)['"]?\s*:/g)].some(m => VISUAL.test(m[1]))
function scanObject(body, hits) {
  for (const p of topLevel(body)) {
    if (p.startsWith('...')) { if (choice(p) && visualKeyIn(p)) hits.push(`spread ${p.slice(0, 70)}`); continue }
    const m = /^['"]?([A-Za-z-]+)['"]?\s*:\s*([\s\S]*)$/.exec(p)
    if (m && !m[1].startsWith('--') && VISUAL.test(m[1]) && choice(m[2])) hits.push(`${m[1]}: ${m[2].replace(/\s+/g, ' ').slice(0, 70)}`)
  }
}
const COLOUR_UTIL = /\b(?:bg|text|border|ring|outline|fill|stroke|shadow|decoration|accent|caret|divide)-(?:ink|paper|signal|rule|hover|success|danger|warning|focus|white|black|transparent|current|(?:stone|orange|red|green|amber|yellow|blue|sky|cyan|purple|pink|violet|gray|zinc|neutral|slate|emerald|teal|lime|rose|fuchsia|indigo)-\d+|\[#)|\bopacity-\d+/
export function stateLeaks(raw) {
  const src = stripJs(raw), hits = []
  for (const m of src.matchAll(/\bstyle=\{/g)) {
    let e = balanced(src, m.index + 6).trim()
    const id = /^[A-Za-z_$][\w$]*$/.test(e) ? e : null
    if (id) {
      const d = new RegExp(`(?:const|let|var)[ ]+${id}[ ]*=[ ]*[{]`).exec(src)
      if (!d) continue
      e = `{${balanced(src, d.index + d[0].length - 1)}}`
    }
    if (e.startsWith('{') && e.endsWith('}') && balanced(e, 0).length === e.length - 2) scanObject(e.slice(1, -1), hits)
    else if (choice(e) && visualKeyIn(e)) hits.push(`style={${e.slice(0, 70)}}`)
  }
  for (const m of src.matchAll(/className=\{`/g)) {
    const tpl = balanced(src, m.index + 10)
    for (const x of tpl.matchAll(/\$\{([^}]*)\}/g)) if (choice(x[1]) && COLOUR_UTIL.test(x[1])) hits.push(`className \${${x[1].slice(0, 70)}}`)
  }
  return hits
}

// ── bins.css ───────────────────────────────────────────────────────────────
/** The rules inside `@layer components { … }`, as { selectors, body }. */
export function rules(code) {
  const open = code.search(/@layer\s+components\s*\{/)
  const inner = code.slice(code.indexOf('{', open) + 1, code.lastIndexOf('}'))
  return [...inner.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({
    selectors: m[1].split(',').map(s => s.trim()).filter(Boolean),
    body: m[2],
  }))
}

/** Does some rule that LISTS this selector actually PAINT it — set a real
 *  declaration, or the dim's `--bn-ink` — rather than merely name it (the lift
 *  names every painted state and sets only the two quiet-ink properties)? */
export function paintsSelector(code, s) {
  return rules(code).some(r => r.selectors.includes(s)
    && r.body.split(';').map(d => d.trim()).some(d => /^[a-z-]+\s*:/.test(d) && (!d.startsWith('--') || /^--bn-ink\s*:/.test(d))))
}

const paintsGround = (b) => /(?:^|[;{\s])background(?:-color|-image)?\s*:(?!\s*(?:transparent|none)\s*(?:;|$))/.test(b)
const STATE = /^\.bn-[a-z-]+(?::[a-z-]+(?:\([^)]*\))?|\[data-[a-z-]+="true"\])+$/
/** Every state selector that paints a ground (the hover fill, the selection tint, the drop mix). */
export const paintedStates = (code) => rules(code).filter(r => paintsGround(r.body)).flatMap(r => r.selectors.filter(s => STATE.test(s)))
/** The lift rule's selectors — the rule that sets BOTH quiet-ink properties. */
export function liftRule(code) {
  return rules(code).find(r => /--bn-ink-3\s*:/.test(r.body) && /--bn-signal-ink\s*:/.test(r.body) && !/--bn-ink\s*:/.test(r.body)) || { selectors: [], body: '' }
}
/** A state is covered by the lift when it is listed, or refines a listed one (`:hover:not(…)`). */
export const coveredBy = (s, list) => list.some(l => s === l || s.startsWith(l))

/** Where the layer block ends: nothing may follow it (an unlayered rule beats every utility). */
export function afterLayer(code) {
  const at = code.search(/@layer\s+components\s*\{/)
  let d = 0
  for (let i = code.indexOf('{', at); i < code.length; i++) {
    if (code[i] === '{') d++
    else if (code[i] === '}' && --d === 0) return code.slice(i + 1)
  }
  return null
}
