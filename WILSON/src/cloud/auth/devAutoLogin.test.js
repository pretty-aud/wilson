// =============================================================================
// devAutoLogin.test.js — the dev auto sign-in can never reach a shipped build.
//
// Audrey asked for a login bypass for testing (2026-09-11). The only safe
// shape is one that `vite build` compiles out: every read of the
// VITE_DEV_AUTOLOGIN_* variables sits inside an effect whose first line is
// `if (!import.meta.env.DEV) return`. This test reads LoginScreen.jsx as text
// and pins that shape, so a refactor that hoists the env reads out of the
// guard — or a second copy of the bypass elsewhere in src — fails here.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(here, 'LoginScreen.jsx'), 'utf8')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p, out) }
    else if (/\.(jsx?|cjs|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(p)
  }
  return out
}

describe('the dev auto sign-in is gated on import.meta.env.DEV', () => {
  it('the guard is the first statement of the effect, before any VITE_DEV_AUTOLOGIN read', () => {
    const guard = src.indexOf('if (!import.meta.env.DEV) return')
    const firstRead = src.indexOf('VITE_DEV_AUTOLOGIN')
    expect(guard).toBeGreaterThan(-1)
    expect(firstRead).toBeGreaterThan(-1)
    // The comment block above the effect mentions the variables; the first
    // CODE read must come after the guard.
    const firstCodeRead = src.indexOf('import.meta.env.VITE_DEV_AUTOLOGIN')
    expect(firstCodeRead).toBeGreaterThan(guard)
    // …and inside the same effect (no other useEffect opens in between).
    const between = src.slice(guard, firstCodeRead)
    expect(between).not.toContain('useEffect(')
  })

  it('the password is read once and never rendered', () => {
    const reads = src.match(/VITE_DEV_AUTOLOGIN_PASSWORD/g) || []
    // One in the comment block (documentation), one code read.
    expect(reads.length).toBe(2)
    expect(src).not.toMatch(/\{\s*pw\s*\}/)          // never interpolated into JSX
    expect(src).not.toMatch(/console\.[a-z]+\([^)]*\bpw\b/) // never logged
  })

  it('the bypass exists in exactly two files in src, and both guard every read on import.meta.env.DEV', () => {
    const files = walk(resolve(here, '../..'))
    const hits = files.filter((f) => readFileSync(f, 'utf8').includes('VITE_DEV_AUTOLOGIN'))
    expect(hits.map((f) => f.replace(/\\/g, '/').split('/src/')[1]).sort()).toEqual(['App.jsx', 'cloud/auth/LoginScreen.jsx'])
    // App.jsx's tester mode (no credentials, no session) is a single `if`
    // whose condition names DEV before the variable, on the same line.
    const app = readFileSync(resolve(here, '../../App.jsx'), 'utf8')
    const codeReads = app.split('\n').filter((l) => l.includes('import.meta.env.VITE_DEV_AUTOLOGIN'))
    expect(codeReads.length).toBe(1)
    expect(codeReads[0]).toMatch(/import\.meta\.env\.DEV && import\.meta\.env\.VITE_DEV_AUTOLOGIN === 'tester'/)
  })

  it('the control: the checker would catch an unguarded read', () => {
    const bad = 'const x = import.meta.env.VITE_DEV_AUTOLOGIN\nuseEffect(() => { if (!import.meta.env.DEV) return })'
    expect(bad.indexOf('import.meta.env.VITE_DEV_AUTOLOGIN')).toBeLessThan(bad.indexOf('if (!import.meta.env.DEV) return'))
  })
})
