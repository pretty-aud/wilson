// =============================================================================
// mutationsRegistry.test.js — every mutator a history op names is registered.
//
// RabbitProvider's undo/redo entries call `mutationsRef.current.<name>(…)` so
// they always reach the latest mutator; the registry is a hand-written list
// of `mutationsRef.current.<name> = <name>` assignments near the end of the
// file. The undo loop SWALLOWS a throw, so a name missing from that list
// fails silently: Ctrl+Z appears to work and nothing changes. Measured on
// 2026-09-10 with the shot-takes mutators (milestone 2). This pins the two
// sets against each other on the source, the way the bins wiring test pins
// the mount order in main.cjs.
// =============================================================================

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'

const src = fs.readFileSync(new URL('./RabbitProvider.jsx', import.meta.url), 'utf8')

describe('RabbitProvider mutations registry', () => {
  const registered = new Set([...src.matchAll(/mutationsRef\.current\.([A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$]/g)].map(m => m[1]))
  const called = new Set([...src.matchAll(/mutationsRef\.current\.([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]))

  it('finds both sets (the pin is only as good as its regexes)', () => {
    expect(registered.size).toBeGreaterThan(20)
    expect(called.size).toBeGreaterThan(10)
    expect(registered.has('addShot')).toBe(true)
    expect(called.has('replaceShotTakes')).toBe(true)
  })

  it('every mutator a history op calls is registered', () => {
    const missing = [...called].filter(n => !registered.has(n))
    expect(missing, `history ops call unregistered mutators: ${missing.join(', ')}`).toEqual([])
  })
})
