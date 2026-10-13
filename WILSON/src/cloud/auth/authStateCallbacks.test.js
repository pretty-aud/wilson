// =============================================================================
// authStateCallbacks.test.js — Session 17.
//
// A source-level guard, not a behaviour test, because the failure it prevents
// cannot be observed until it deadlocks in production.
//
// auth-js runs every `onAuthStateChange` subscriber from inside
// `_acquireLock`, and AWAITS each one (GoTrueClient `_notifyAllSubscribers`).
// So any Supabase call awaited inside a subscriber calls `_getAccessToken()`
// -> `getSession()` -> `_acquireLock()`, and waits for the lock it is already
// holding. Self-deadlock, and it strands the entire auth operation.
//
// What that looked like in practice, S17: `POST /factors/../verify` returned
// 200 in 113 ms, the challenge was verified server-side, NO further network
// request was ever issued, and `mfa.verify()` never resolved — so MFA sign-in
// was impossible while every server-side signal looked perfectly healthy.
// Five separate theories were wrong before the source was read.
//
// The rule this pins: a subscriber must return synchronously. Defer real work
// with setTimeout(..., 0) so the lock is released first.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue
      walk(full, out)
    } else if (/\.(js|jsx)$/.test(entry) && !/\.test\.jsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

describe('onAuthStateChange subscribers', () => {
  const files = walk(SRC)

  it('finds the source tree (guard against a silently empty sweep)', () => {
    // A test that scans zero files passes for the wrong reason.
    expect(files.length).toBeGreaterThan(50)
  })

  it('never registers an async callback', () => {
    const offenders = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      if (!text.includes('onAuthStateChange')) continue
      // Match the callback opener in either arrow or function form.
      const re = /onAuthStateChange\s*\(\s*(async\b)?/g
      let m
      while ((m = re.exec(text)) !== null) {
        if (m[1]) {
          const line = text.slice(0, m.index).split('\n').length
          offenders.push(`${relative(SRC, file).replace(/\\/g, '/')}:${line}`)
        }
      }
    }
    expect(offenders, [
      'An onAuthStateChange callback is declared `async`.',
      'auth-js awaits subscribers while holding the auth lock, so awaiting a',
      'Supabase call inside one self-deadlocks and strands the whole auth',
      'operation. Keep the callback synchronous and defer the work:',
      '  onAuthStateChange((event) => { setTimeout(async () => { ... }, 0) })',
      'See RabbitProvider.jsx and MASTER_PLAN §6 #72.',
    ].join('\n')).toEqual([])
  })
})
