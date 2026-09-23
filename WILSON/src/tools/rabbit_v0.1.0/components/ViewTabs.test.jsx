/** @vitest-environment jsdom */
// ViewTabs — the active tab's ink against its own fill (V1, 2026-09-23).
//
// The active tab painted `#fff7ed` on the signal orange at the Dense step,
// 3.35:1 — a C6 violation live on every R.A.B.B.I.T. screen while
// tokens.test.js asserted that very pair fails. That test checks a PAIR OF
// CONSTANTS; nothing checked what the component set.
//
// ⚠️ What this reads is the INLINE style the component writes, which is the
// only place ViewTabs sets its colours. jsdom does not apply stylesheets, so
// a colour UTILITY on the button (`text-white!`, say) would win in the
// browser and never show here — V1's review proved it twice. Hence
// the second assertion: the active tab carries no colour utility at all.
// ink-light is the STOPGAP, not the design: §3.2 takes the fill away and
// gives the active tab an underline, which is lane B1's.
//
// B1 commit 1 (2026-09-23), the state extraction: the colours left the inline
// style for `data-active` + `.rb-viewtab` in rabbitShell.css. So the test now
// asserts two things where it asserted one: NO inline colour survives (an
// inline style would beat the stylesheet and silently undo it), and the
// stylesheet's rule for the active data attribute carries the legal pair.
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import ViewTabs from './ViewTabs'
import { contrast } from '../../../ui/contrast.js'

afterEach(cleanup)

/* rabbitShell.css with its comments stripped, so a rule can never be
   satisfied by its own documentation. */
const shellCss = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../rabbitShell.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
/* The declarations of the one rule whose selector is exactly `selector`. */
const cssRule = (selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = shellCss.match(new RegExp(`(?:^|[\\s}])${esc}\\s*\\{([^}]*)\\}`))
  expect(m, `no rule for ${selector} in rabbitShell.css`).not.toBeNull()
  return Object.fromEntries(m[1].split(';').map((d) => d.split(':').map((s) => s.trim())).filter(([k, v]) => k && v))
}
const opaqueHex = (v) => {
  expect(v, `${v} is not an opaque hex; the ratio below would be wrong`).toMatch(/^#[0-9a-f]{6}$/i)
  return v.toLowerCase()
}
/* A Tailwind utility that can set the text COLOUR: `text-` followed by
   anything, behind any number of variant prefixes (`md:`, `enabled:`,
   `aria-[current=page]:` — round two of V1's review showed `md:text-white!`
   and `text-(--color-white)!` both walked past the first version, and the
   first is ALWAYS on at desktop width). Excluded: the type-scale steps and
   the non-colour `text-` utilities, which share the prefix. */
const NOT_COLOUR = new Set(['h1', 'h2', 'h3', 'body', 'dense', 'caption', 'label', 'left', 'right', 'center', 'justify',
  'start', 'end', 'wrap', 'nowrap', 'balance', 'pretty', 'ellipsis', 'clip'])
/* The utility after its variants: the text after the last `:` that is NOT
   inside [...] or (...) — `text-[color:var(--x)]` carries a colon of its own. */
const afterVariants = (cls) => {
  let depth = 0, cut = 0
  for (let i = 0; i < cls.length; i++) {
    const ch = cls[i]
    if (ch === '[' || ch === '(') depth++
    else if (ch === ']' || ch === ')') depth--
    else if (ch === ':' && depth === 0) cut = i + 1
  }
  return cls.slice(cut)
}
const colourUtilities = (className) => className.split(/\s+/).filter(Boolean).filter((cls) => {
  const base = afterVariants(cls).replace(/^!|!$/g, '')
  if (!base.startsWith('text-')) return false
  const rest = base.slice(5)
  return !NOT_COLOUR.has(rest) && !rest.startsWith('shadow')
})

describe('ViewTabs', () => {
  it('marks exactly one tab as the current view, and it is the active one', () => {
    const { container } = render(<ViewTabs activeView="summary" onChange={() => {}} />)
    const current = [...container.querySelectorAll('button[aria-current]')]
    expect(current.map((b) => b.textContent.trim())).toEqual(['Summary'])
    expect(current[0].getAttribute('aria-current')).toBe('page')
  })

  it('the active tab writes ink-light on its fill, 4.91:1 (C6: small text on orange is #1c1917)', () => {
    const { container } = render(<ViewTabs activeView="tasks" onChange={() => {}} />)
    const tab = container.querySelector('button[aria-current]')
    // Nothing inline may compete with the stylesheet: an inline colour or
    // fill wins over any class, which is exactly how the old hover states
    // died (plan §1, review R40).
    expect(tab.style.color).toBe('')
    expect(tab.style.backgroundColor).toBe('')
    expect(tab.classList.contains('rb-viewtab')).toBe(true)
    expect(tab.getAttribute('data-active')).toBe('true')
    const rule = cssRule('.rb-viewtab[data-active="true"]')
    // Guard the premise: if the fill ever stops being the opaque signal, the
    // ratio below is measured against the wrong ground and means nothing.
    expect(opaqueHex(rule['background-color'])).toBe('#ea580c')
    expect(opaqueHex(rule.color)).toBe('#1c1917')
    expect(contrast(rule.color, rule['background-color'])).toBeGreaterThanOrEqual(4.5)
  })

  it('only the active tab carries data-active, so that rule paints one tab', () => {
    const { container } = render(<ViewTabs activeView="tasks" onChange={() => {}} />)
    const marked = [...container.querySelectorAll('button[data-active]')]
    expect(marked.map((b) => b.textContent.trim())).toEqual(['Tasks'])
  })

  it('no text-colour utility on the active tab, under any variant, can override that ink', () => {
    const { container } = render(<ViewTabs activeView="tasks" onChange={() => {}} />)
    const tab = container.querySelector('button[aria-current]')
    expect(colourUtilities(tab.className)).toEqual([])
  })

  it('CONTROL: fires on colour utilities in every spelling, and not on type steps or layout', () => {
    for (const c of ['text-white', 'text-white!', '!text-white', 'text-orange-100', 'text-[#fff]', 'md:text-white!',
      'aria-[current=page]:text-white!', 'enabled:text-white!', 'text-(--color-white)!', 'text-[var(--color-white)]!',
      'text-[rgb(255,255,255)]!', 'hover:md:text-orange-50/80', 'text-[color:var(--x)]', 'md:text-[color:var(--x)]!']) expect(colourUtilities(`a ${c} b`), c).toEqual([c])
    for (const c of ['text-dense', 'text-body', 'text-label', 'text-h2', 'text-left', 'text-nowrap', 'text-wrap',
      'text-balance', 'text-start', 'text-end', 'text-ellipsis', 'text-shadow-sm', 'md:text-dense']) expect(colourUtilities(`a ${c} b`), c).toEqual([])
  })
})
