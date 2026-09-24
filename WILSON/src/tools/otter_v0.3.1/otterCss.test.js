// =============================================================================
// otterCss.test.js — A3 (2026-09-24). O.T.T.E.R.'s own stylesheet, pinned the
// way adminTerminalCss.test.js and dashboardCss.test.js pin theirs.
//
// otter.css has two halves: A3's restyle, and A4's to come below it. Its
// header states the rules both halves keep; these are the ones a source scan
// can hold without a browser. What it cannot hold — that a rule actually wins
// the cascade — is proved in the running app (the A3 hand-off, §2).
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const RAW = readFileSync(fileURLToPath(new URL('./otter.css', import.meta.url)), 'utf8')
/** Comments blanked to spaces, so offsets and line numbers survive. */
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))

/** A colour written as a value rather than read from a token: hex (also
 *  caught app-wide by typeScale's page-sheet row), the functional spellings,
 *  and the two keywords that are colours. `white-space` is not `white`. */
const COLOUR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\(|(?<![-\w])(?:white|black)(?![-\w])/gi

describe('otter.css', () => {
  it('names the cascade layers on its first line of code', () => {
    // It is imported from a component, so the bundler may emit it before
    // src/index.css, and a layer's place in the cascade is fixed where it is
    // FIRST named (D1 hand-off §5 trap 1). Deleting this line stayed green
    // before this file existed (A3 review round 1).
    const first = CODE.split(/\r?\n/).map((l) => l.trim()).find(Boolean)
    expect(first).toBe('@layer theme, base, components, utilities;')
  })

  it('writes no colour that is not a token (C8)', () => {
    // A3's half was extraction transcription (oklch, rgb, a keyword) until the
    // restyle replaced every one; this keeps the sheet that way.
    expect(CODE.match(COLOUR_LITERAL) || []).toEqual([])
  })

  it('has no `transition: all` and no `!important`', () => {
    expect(CODE).not.toMatch(/transition\s*:\s*all\b/i)
    expect(CODE).not.toMatch(/!\s*important/i)
  })

  it('CONTROL: the scan reads the sheet, and the detector fires on what it forbids', () => {
    expect(CODE.length).toBeGreaterThan(10000)
    expect(CODE).toMatch(/\.otter-nav\s*\{/)
    for (const s of ['color: #fff;', 'color: rgb(1 2 3);', 'color: rgba(0,0,0,.5);', 'color: oklch(70% 0.1 50);',
      'color: hsl(20 50% 50%);', 'color: white;', 'background: black;', 'border-color: color(srgb 1 0 0);']) {
      expect(s.match(COLOUR_LITERAL), s).not.toBeNull()
    }
    for (const s of ['white-space: nowrap;', 'color: var(--color-ink);', 'background: color-mix(in srgb, var(--node-color) 12%, transparent);']) {
      expect(s.match(COLOUR_LITERAL), s).toBeNull()
    }
  })
})
