// =============================================================================
// elevationAndDisabled.test.js — two §7 audit rules, swept (UI overhaul P1).
//
// §3.3: ONE shadow, for floating surfaces only, from the `--shadow-float`
// token (`shadow-float` as a utility). Tailwind's own `shadow-sm … 2xl` are
// a second elevation language; P1's audit found five (the agent toast, the
// agent diff and outline overlays, the ingestion and undo toasts) and put
// them on the token.
// §3.1: disabled is the third ink plus `not-allowed`, never an opacity. P1
// moved the agent outline popup onto the kit Button; the three buttons in
// the Timeline task editor's footer still dim to 30% while saving and are
// listed here BY NAME, because their fix is the kit Button and the editor's
// look waits on Audrey (P1-31, walkthrough 42 Q6). The list may shrink,
// never grow.
// =============================================================================
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'
import { blankJsComments } from '../../scripts/ui-audit.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, '..')
const UNTOUCHABLE = /LayoutVisualizer\.jsx$|VideoThumbnail\.jsx$|[\\/]sprites[\\/]|PetCompanion\.jsx$/
const OUT_OF_SCOPE = /[\\/]admin[\\/]/ // the operator console (plan Q14)

function files(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) files(p, out)
    else if (/\.(js|jsx)$/.test(p) && !/\.test\./.test(p)) out.push(p)
  }
  return out
}

const TW_SHADOW = /(?<![\w-])shadow-(?:sm|md|lg|xl|2xl|inner)(?![\w-])/g
const OPACITY_DISABLED = /(?<![\w-])disabled:opacity-(?:30|40|50)(?![\w-])/g

function sweep(re) {
  const hits = []
  for (const f of files(SRC)) {
    if (UNTOUCHABLE.test(f) || OUT_OF_SCOPE.test(f)) continue
    const code = blankJsComments(readFileSync(f, 'utf8'))
    const rel = relative(SRC, f).split(sep).join('/')
    for (const m of code.matchAll(re)) hits.push(`${rel}:${code.slice(0, m.index).split('\n').length}`)
  }
  return hits
}

// The handler of the <button> a hit's class sits on: the nearest `onClick=`
// between the button's opening `<button` and the hit (review round one,
// R1-07: counting hits per file let a new site replace a fixed one).
function handlerAt(rel, line) {
  const lines = readFileSync(join(SRC, rel), 'utf8').split(/\r?\n/)
  const upTo = lines.slice(0, line).join('\n')
  const open = upTo.lastIndexOf('<button')
  const m = open < 0 ? null : upTo.slice(open).match(/onClick=\{([^}]*)\}/)
  return m ? m[1].replace(/\s+/g, ' ').trim() : null
}

describe('one elevation (§3.3) and one disabled treatment (§3.1)', () => {
  it('no Tailwind shadow scale outside the untouchables', () => {
    expect(sweep(TW_SHADOW)).toEqual([])
  })
  it('opacity as a disabled state only on the three task-editor buttons that wait on P1-31, each named by its handler', () => {
    const hits = sweep(OPACITY_DISABLED)
    const named = hits.map((h) => { const [rel, line] = h.split(':'); return [rel, handlerAt(rel, +line)] })
    expect(named).toEqual([
      ['tools/rabbit_v0.1.0/views/TimelineView.jsx', 'handleDelete'],
      ['tools/rabbit_v0.1.0/views/TimelineView.jsx', '() => !saving && onClose()'],
      ['tools/rabbit_v0.1.0/views/TimelineView.jsx', 'handleSave'],
    ])
  })
  it('CONTROL: both patterns see their old spellings and pass the token', () => {
    const count = (re, s) => [...s.matchAll(re)].length
    expect(count(TW_SHADOW, 'rounded-control shadow-2xl flex')).toBe(1)
    expect(count(TW_SHADOW, 'text-dense shadow-lg animate-fade-in-up')).toBe(1)
    expect(count(TW_SHADOW, 'rounded-float shadow-float')).toBe(0)
    expect(count(OPACITY_DISABLED, 'hover:bg-green-600 transition-colors disabled:opacity-50')).toBe(1)
    expect(count(OPACITY_DISABLED, 'opacity-50')).toBe(0)
  })
})
