// =============================================================================
// noHardcodedModels.test.js — Session 19.
//
// A source-level guard, in the same shape and for the same reason as
// `authStateCallbacks.test.js`: the failure it prevents is invisible at
// runtime until it bites in front of a user.
//
// What happened: `claude-sonnet-4-20250514` was written as a string literal at
// 17 call sites across six files. Anthropic retired it on 2026-06-15, every
// one of those calls began returning 404, and nobody noticed for 47 days —
// because there was no inventory of which model ran what, and the failure
// reached the user as a generic "try again".
//
// Swapping the string fixed that day. This fixes the class. Three checks:
//
//   1. No raw `claude-…` literal anywhere in `src/` outside the registry.
//      A model id in a call site is invisible; a model id in the registry is
//      one line, next to the retirement list, covered by the test that
//      refuses to ship a retired default.
//   2. Every registry key passed to `modelFor()` actually exists. The keys
//      are hand-typed at 28 call sites and a typo does NOT throw — it
//      resolves to a working model and silently discards whatever the user
//      configured for the real key. That is the same silent-degradation
//      shape as the outage, so it gets caught here rather than in support.
//   3. The `operator-ai-keys` Edge Function validates keys against a model id
//      it hardcodes. It cannot import from `src/`, so it is exempt from
//      check 1 — but if that model is ever retired, every operator's "Set
//      key" flow starts failing with no obvious cause. Check its id against
//      the retirement list instead.
//
// Scope note: `.test.js` files are excluded, matching the existing precedent.
// A model id in a test fixture cannot reach a user. `anthropicStream.test.js`
// deliberately keeps `claude-sonnet-4-20250514` in its recorded SSE fixture —
// it is a recording of a real response, and editing it would make it a
// forgery rather than a fixture.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { REGISTRY, RETIRED } from './aiModels'

const SRC = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const REPO = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

// The registry is the one place a model id is allowed to appear.
const ALLOWED = new Set(['lib/aiModels.js'])

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

const rel = (f) => relative(SRC, f).replace(/\\/g, '/')

/**
 * Lines that are wholly a comment. Prose legitimately names retired models
 * (this file does), so scanning them would make the guard fire on its own
 * documentation. Anything on a code line still counts, including a trailing
 * comment — a model id there is close enough to executable to be worth
 * flagging.
 */
function codeLines(text) {
  return text.split('\n').filter((line) => {
    const t = line.trim()
    return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
  })
}

describe('no hardcoded model ids', () => {
  const files = walk(SRC)

  it('finds the source tree (guard against a silently empty sweep)', () => {
    // A test that scans zero files passes for the wrong reason. This is the
    // check that makes the two below mean something.
    expect(files.length).toBeGreaterThan(50)
  })

  it('never writes a claude- model id outside the registry', () => {
    const offenders = []
    for (const file of files) {
      if (ALLOWED.has(rel(file))) continue
      const lines = codeLines(readFileSync(file, 'utf8'))
      for (const line of lines) {
        const m = line.match(/['"`]claude-[a-z0-9][a-z0-9.\-]*['"`]/)
        if (m) offenders.push(`${rel(file)}: ${m[0]}`)
      }
    }
    expect(offenders, [
      'A Claude model id is hardcoded outside src/lib/aiModels.js.',
      '',
      'This is what caused the 47-day outage: seventeen literals across six',
      'files, all silently dead the day Anthropic retired the model. Use the',
      'registry instead, so a retirement is one edit and not a hunt:',
      '',
      "  import { modelFor } from '<path>/lib/activeModel'",
      "  const data = await callAI({ model: modelFor('dog.fullDeck'), ... })",
      '',
      'If this is a genuinely new call site, add it to REGISTRY in aiModels.js',
      'first — the key is what user settings persist against.',
    ].join('\n')).toEqual([])
  })

  it('only ever asks modelFor() for keys that exist in the registry', () => {
    const known = new Set(REGISTRY.map((e) => e.key))
    const offenders = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      // Only literal keys can be checked statically. A computed key (RABBIT's
      // intake does this) is covered by MODEL_KEYS' own test instead.
      const re = /\bmodelFor\(\s*['"]([^'"]+)['"]\s*\)/g
      let m
      while ((m = re.exec(text)) !== null) {
        if (!known.has(m[1])) {
          const line = text.slice(0, m.index).split('\n').length
          offenders.push(`${rel(file)}:${line} — unknown key "${m[1]}"`)
        }
      }
    }
    expect(offenders, [
      'modelFor() was called with a key that is not in REGISTRY.',
      '',
      'This does not throw at runtime — it falls back to a working model and',
      'silently ignores whatever the user configured for the real key. Check',
      'the spelling against REGISTRY in aiModels.js.',
    ].join('\n')).toEqual([])
  })

  it('maps every RABBIT document kind to a real registry key', () => {
    // RABBIT's intake resolves its model through a variable, so the literal
    // check above cannot see it. Read the map out of the source rather than
    // importing pipeline.js, which would drag in the Supabase client.
    const known = new Set(REGISTRY.map((e) => e.key))
    const src = readFileSync(
      join(SRC, 'tools', 'rabbit_v0.1.0', 'intake', 'pipeline.js'), 'utf8',
    )
    const block = src.match(/export const MODEL_KEYS = \{([\s\S]*?)\n\}/)
    expect(block, 'MODEL_KEYS not found in pipeline.js').not.toBeNull()

    const entries = [...block[1].matchAll(/^\s*(\w+):\s*'([^']+)'/gm)]
    expect(entries.length, 'MODEL_KEYS looks empty — check the regex').toBe(10)

    const bad = entries.filter(([, , key]) => !known.has(key))
      .map(([, kind, key]) => `${kind} -> "${key}"`)
    expect(bad, 'MODEL_KEYS points at a key that is not in REGISTRY').toEqual([])

    // Every chunker needs a model, and `other` is the classifier's fallback.
    const kinds = new Set(entries.map(([, kind]) => kind))
    const chunkerKinds = [...src.matchAll(/^\s*(\w+):\s+\w+Chunker,/gm)].map((m) => m[1])
    const missing = chunkerKinds.filter((k) => !kinds.has(k))
    expect(missing, 'a chunker has no MODEL_KEYS entry').toEqual([])
    expect(kinds.has('other'), 'MODEL_KEYS needs an `other` fallback').toBe(true)
  })

  it('does not let the Edge Function validate keys with a retired model', () => {
    // supabase/functions/ runs on Deno and cannot import from src/, so it is
    // exempt from the literal ban. It is not exempt from the retirement that
    // caused all this: if this id dies, every operator's "Set key" flow fails
    // and the message will be about the key, not the model.
    const fn = join(REPO, 'supabase', 'functions', 'operator-ai-keys', 'index.ts')
    const text = readFileSync(fn, 'utf8')
    const m = text.match(/VALIDATION_MODEL\s*=\s*['"]([^'"]+)['"]/)
    expect(m, 'VALIDATION_MODEL not found in operator-ai-keys/index.ts').not.toBeNull()
    expect(
      RETIRED[m[1]],
      `operator-ai-keys validates with ${m[1]}, which Anthropic retired on ${RETIRED[m[1]]}`,
    ).toBeUndefined()
  })
})
