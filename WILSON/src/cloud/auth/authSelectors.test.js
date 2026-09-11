// =============================================================================
// authSelectors.test.js — the Playwright suite's selectors, checked without a
// browser (UI overhaul D2).
//
// The e2e suite selects the auth screens by their VISIBLE TEXT and by their
// `aria-label`s. This session changed how those screens are typed, and one of
// the changes moves visible text: the page titles go to sentence case (Q2 —
// uppercase survives only in the page-transition title and the 11px Label
// step). `page.getByText(/^LOGIN$/)` was case-SENSITIVE, so "Login" would
// have walked straight past it.
//
// 🚨 Playwright cannot run here. It needs a live server and the probe admin's
// password, so the fix the plan prescribes — "source-text tests are updated in
// the same commit as the source they pin" — has no way to prove itself. This
// file is that proof: it reads the specs and the sources as text and asserts
// that every selector still resolves to something the app actually renders.
//
// It is deliberately blunt. It does not parse JSX; it collects candidate
// strings (text nodes and string literals) and asks whether each selector
// matches at least one of them. That cannot prove a selector finds exactly one
// element in a live DOM — only Playwright can — but it does catch the failure
// this session could actually cause: a selector whose text no longer exists
// anywhere. Every check ends with a failing control.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(here, '../..')
const E2E = resolve(here, '../../../tests/e2e')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p, out) }
    else if (/\.jsx?$/.test(name) && !/\.test\./.test(name)) out.push(p)
  }
  return out
}

const sources = walk(SRC).map((f) => readFileSync(f, 'utf8'))
const specs = readdirSync(E2E)
  .filter((f) => /\.ts$/.test(f))
  .map((f) => ({ name: f, text: readFileSync(join(E2E, f), 'utf8') }))

// Every string the app could plausibly render: JSX text nodes plus quoted
// literals. The union is what a `getByText` has to hit.
const RENDERED = (() => {
  const out = new Set()
  for (const s of sources) {
    for (const m of s.matchAll(/>([^<>{}]+)</g)) {
      const t = m[1].replace(/\s+/g, ' ').trim()
      if (t) out.add(t)
    }
    for (const m of s.matchAll(/'([^'\\\n]{2,120})'|"([^"\\\n]{2,120})"/g)) {
      const t = (m[1] ?? m[2]).replace(/\s+/g, ' ').trim()
      if (t) out.add(t)
    }
  }
  return [...out]
})()

const ARIA_LABELS = (() => {
  const out = new Set()
  for (const s of sources) {
    for (const m of s.matchAll(/aria-label="([^"]+)"/g)) out.add(m[1])
  }
  return out
})()

/** Every `getByText(/…/flags)` in the suite, as a live RegExp plus its origin. */
function textSelectors() {
  const out = []
  for (const { name, text } of specs) {
    for (const m of text.matchAll(/getByText\(\s*\/((?:\\.|[^/\\])+)\/([gimsuy]*)\s*\)/g)) {
      out.push({ spec: name, source: `/${m[1]}/${m[2]}`, re: new RegExp(m[1], m[2]) })
    }
  }
  return out
}

/** Every `getByLabel('…')` in the suite. */
function labelSelectors() {
  const out = []
  for (const { name, text } of specs) {
    for (const m of text.matchAll(/getByLabel\(\s*'([^']+)'\s*\)/g)) {
      out.push({ spec: name, label: m[1] })
    }
  }
  return out
}

/** Every `getByRole('button', { name: /…/flags })` in the suite. */
function buttonNameSelectors() {
  const out = []
  for (const { name, text } of specs) {
    const re = /getByRole\(\s*'button',\s*\{\s*name:\s*(?:\/((?:\\.|[^/\\])+)\/([gimsuy]*)|'([^']+)')\s*\}/g
    for (const m of text.matchAll(re)) {
      out.push({
        spec: name,
        source: m[1] ? `/${m[1]}/${m[2]}` : `'${m[3]}'`,
        re: m[1] ? new RegExp(m[1], m[2]) : new RegExp(`^${m[3].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
      })
    }
  }
  return out
}

describe('the e2e suite still has something to select', () => {
  it('the suite was actually found and read', () => {
    // A glob that silently matches nothing would make every loop below pass.
    expect(specs.map((s) => s.name).sort()).toEqual(['auth.spec.ts', 'authFlow.ts', 'web-path.spec.ts'])
    expect(RENDERED.length).toBeGreaterThan(500)
    expect(ARIA_LABELS.size).toBeGreaterThan(10)
  })
})

describe('every getByText in the e2e suite still matches rendered text', () => {
  const selectors = textSelectors()

  it('there are selectors to check', () => {
    expect(selectors.length).toBeGreaterThanOrEqual(10)
  })

  it.each(selectors.map((s) => [`${s.spec} ${s.source}`, s]))('%s', (_n, s) => {
    expect(RENDERED.some((t) => s.re.test(t)), `${s.source} matches nothing the app renders`).toBe(true)
  })

  it('the control: the pre-D2 case-sensitive login selector would now fail', () => {
    // This is the exact regex that was in authFlow.ts and web-path.spec.ts
    // before this session, and the reason both were loosened to /^login$/i.
    // If the titles ever go back to uppercase this control starts passing,
    // which is the signal to revisit the two specs.
    expect(RENDERED.some((t) => /^LOGIN$/.test(t))).toBe(false)
    expect(RENDERED.some((t) => /^login$/i.test(t))).toBe(true)
  })
})

describe('every getByLabel in the e2e suite still names a real aria-label', () => {
  const selectors = labelSelectors()

  it('there are selectors to check', () => {
    expect(selectors.length).toBeGreaterThanOrEqual(6)
  })

  it.each(selectors.map((s) => [`${s.spec} getByLabel('${s.label}')`, s]))('%s', (_n, s) => {
    expect([...ARIA_LABELS], `no aria-label="${s.label}" anywhere in src`).toContain(s.label)
  })

  it('the control: the visible field labels are NOT what the suite selects on', () => {
    // Every auth field pairs an UPPERCASE visible label (the Label role, which
    // is the one role that keeps uppercase) with a sentence-case `aria-label`.
    // The two deliberately differ, and a session that "tidied" them into
    // agreement would break every getByLabel in the suite.
    expect([...ARIA_LABELS]).toContain('New password')
    expect([...ARIA_LABELS]).not.toContain('NEW PASSWORD')
    expect(RENDERED).toContain('NEW PASSWORD')
  })
})

describe('every getByRole button name in the e2e suite still matches a label', () => {
  const selectors = buttonNameSelectors()

  it('there are selectors to check', () => {
    expect(selectors.length).toBeGreaterThanOrEqual(5)
  })

  it.each(selectors.map((s) => [`${s.spec} name: ${s.source}`, s]))('%s', (_n, s) => {
    expect(RENDERED.some((t) => s.re.test(t)), `${s.source} matches no button label`).toBe(true)
  })

  it('the control: a label this session could have "improved" is still verbatim', () => {
    // Sentence-casing a button's TEXT is not the same change as sentence-casing
    // its CSS, and these five are load-bearing for the suite.
    for (const label of ['Continue', 'Sign in', 'Send reset link', 'Set password', 'Send invite', 'Set up later']) {
      expect(RENDERED, label).toContain(label)
    }
  })
})
