/** @vitest-environment jsdom */
// =============================================================================
// The boolean data-attribute contract, asserted where the two sides MEET.
//
// C3b, 2026-09-12, trap 2 — the defect that cost a screenshot round:
//
//   The kit's `Row` wrote `data-selected={selected || undefined}` and
//   index.css keyed on the attribute's PRESENCE (`.ui-tr[data-selected]`).
//   C3's page spelled the same state `data-x={String(<expr>)}`, which renders
//   `data-selected="false"` — PRESENT, so it painted. Every roster row came
//   out selected and deactivated at once, while the source-scan guard passed,
//   seven render tests passed (they asserted the string "false"), the suite
//   passed and the build passed. Only the screenshot was wrong.
//
//   "Both spellings are correct for their own side; the defect is the two
//   meeting."
//
// So this file tests the MEETING, not either side. For each boolean state it
// reads the real selector out of index.css and asks the real rendered node
// `Element.matches(thatSelector)`. A test that asserted `toHaveAttribute` or
// a hard-coded `[data-x="true"]` would keep passing through the exact
// regression that caused this: it is the stylesheet's own spelling that has
// to refuse "false", and only the stylesheet can be asked.
//
// F4's fix (2026-09-13) has two halves and this file fails if either is undone:
//   · index.css keys every one of the twelve on the VALUE, `[data-x="true"]`;
//   · every kit component emits `x ? 'true' : undefined`.
// Keyed on the value, `"false"` from ANY source stops painting — a `{...rest}`
// override (the measured case), a raw `<tr className="ui-tr" data-selected=
// {false}>`, a `String(false)`, a "0". The React idiom `data-x={boolean}` is
// then correct in BOTH directions, which presence-keying never was.
// =============================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { Table, Th, Td, Row } from './Table'
import { Toolbar } from './Toolbar'
import { SectionTitle } from './SectionTitle'
import { Card } from './Card'
import { Tabs } from './Tabs'
import { HoverActions } from './HoverActions'

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8')

afterEach(cleanup)

/**
 * The stylesheet's OWN spelling of one state, lifted verbatim.
 *
 * Returns e.g. `.ui-tr[data-selected="true"]` today and `.ui-tr[data-selected]`
 * if anyone puts presence-keying back — which is the point: the assertions
 * below then fail on the "false" cases instead of silently passing.
 */
function selectorFor(cls, attr) {
  const m = css.match(new RegExp(`\\.${cls}\\[data-${attr}(?:="[^"]*")?\\]`))
  if (!m) throw new Error(`index.css has no .${cls}[data-${attr}…] selector to test against`)
  return m[0]
}

// Every one of the twelve, with the component that feeds it, a node picker,
// and the three ways the state can arrive. `rest` is the measured C3b case:
// a caller-supplied attribute, which lands AFTER the component's own prop in
// the JSX spread and therefore wins.
const CASES = [
  {
    label: 'Table dense',
    cls: 'ui-table', attr: 'dense', pick: '.ui-table',
    on: <Table dense><Row><Td>x</Td></Row></Table>,
    off: <Table><Row><Td>x</Td></Row></Table>,
    rest: <Table data-dense={String(false)}><Row><Td>x</Td></Row></Table>,
  },
  {
    label: 'Row selected',
    cls: 'ui-tr', attr: 'selected', pick: '.ui-tr',
    on: <table><tbody><Row selected><Td>x</Td></Row></tbody></table>,
    off: <table><tbody><Row selected={false}><Td>x</Td></Row></tbody></table>,
    rest: <table><tbody><Row data-selected={String(false)}><Td>x</Td></Row></tbody></table>,
  },
  {
    label: 'Row highlighted',
    cls: 'ui-tr', attr: 'highlighted', pick: '.ui-tr',
    on: <table><tbody><Row highlighted><Td>x</Td></Row></tbody></table>,
    off: <table><tbody><Row highlighted={false}><Td>x</Td></Row></tbody></table>,
    rest: <table><tbody><Row data-highlighted={String(false)}><Td>x</Td></Row></tbody></table>,
  },
  {
    label: 'Row interactive',
    cls: 'ui-tr', attr: 'interactive', pick: '.ui-tr',
    on: <table><tbody><Row interactive><Td>x</Td></Row></tbody></table>,
    off: <table><tbody><Row interactive={false}><Td>x</Td></Row></tbody></table>,
    rest: <table><tbody><Row data-interactive={String(false)}><Td>x</Td></Row></tbody></table>,
  },
  {
    label: 'Row inactive',
    cls: 'ui-tr', attr: 'inactive', pick: '.ui-tr',
    on: <table><tbody><Row inactive><Td>x</Td></Row></tbody></table>,
    off: <table><tbody><Row inactive={false}><Td>x</Td></Row></tbody></table>,
    rest: <table><tbody><Row data-inactive={String(false)}><Td>x</Td></Row></tbody></table>,
  },
  {
    label: 'Th numeric',
    cls: 'ui-th', attr: 'numeric', pick: '.ui-th',
    on: <table><thead><tr><Th numeric>x</Th></tr></thead></table>,
    off: <table><thead><tr><Th numeric={false}>x</Th></tr></thead></table>,
    rest: <table><thead><tr><Th data-numeric={String(false)}>x</Th></tr></thead></table>,
  },
  {
    label: 'Td numeric',
    cls: 'ui-td', attr: 'numeric', pick: '.ui-td',
    on: <table><tbody><tr><Td numeric>x</Td></tr></tbody></table>,
    off: <table><tbody><tr><Td numeric={false}>x</Td></tr></tbody></table>,
    rest: <table><tbody><tr><Td data-numeric={String(false)}>x</Td></tr></tbody></table>,
  },
  {
    label: 'Toolbar wrap',
    cls: 'ui-toolbar', attr: 'wrap', pick: '.ui-toolbar',
    on: <Toolbar wrap>x</Toolbar>,
    off: <Toolbar wrap={false}>x</Toolbar>,
    rest: <Toolbar data-wrap={String(false)}>x</Toolbar>,
  },
  {
    label: 'SectionTitle rule',
    cls: 'ui-section', attr: 'rule', pick: '.ui-section',
    on: <SectionTitle rule>x</SectionTitle>,
    off: <SectionTitle rule={false}>x</SectionTitle>,
    rest: <SectionTitle data-rule={String(false)}>x</SectionTitle>,
  },
  {
    label: 'Card pad',
    cls: 'ui-card', attr: 'pad', pick: '.ui-card',
    on: <Card pad>x</Card>,
    off: <Card pad={false}>x</Card>,
    rest: <Card data-pad={String(false)}>x</Card>,
  },
  {
    label: 'HoverActions always',
    cls: 'ui-hover-actions', attr: 'always', pick: '.ui-hover-actions',
    on: <HoverActions always>x</HoverActions>,
    off: <HoverActions always={false}>x</HoverActions>,
    rest: <HoverActions data-always={String(false)}>x</HoverActions>,
  },
  {
    // Tabs writes `data-active` per ITEM, so there is no prop to pass `false`
    // to and no rest slot to override: the "off" case is a tab that is simply
    // not the current value, and the raw case is the DOM spelling a page would
    // hand-roll. Both must refuse to light up.
    label: 'Tabs active',
    cls: 'ui-tab', attr: 'active', pick: '.ui-tab',
    on: <Tabs panelId="p" value="a" items={[{ id: 'a', label: 'A' }]} />,
    off: <Tabs panelId="p" value="b" items={[{ id: 'a', label: 'A' }]} />,
    rest: <button type="button" className="ui-tab" data-active={String(false)}>A</button>,
  },
]

describe('boolean data attributes: the component and the stylesheet must agree', () => {
  it('covers every presence-shaped state the kit writes (twelve, per C3b)', () => {
    expect(CASES).toHaveLength(12)
  })

  describe.each(CASES)('$label', ({ cls, attr, pick, on, off, rest }) => {
    const sel = () => selectorFor(cls, attr)

    // The failing control. If this ever goes quiet the two below prove nothing,
    // because a selector that matches NOTHING passes every negative assertion.
    it('paints when the state is on', () => {
      const { container } = render(on)
      expect(container.querySelector(pick).matches(sel())).toBe(true)
    })

    it('does not paint when the prop is false', () => {
      const { container } = render(off)
      expect(container.querySelector(pick).matches(sel())).toBe(false)
    })

    // 🚨 The measured regression. `{...rest}` is spread AFTER the component's
    // own `data-*`, so a caller-supplied `String(false)` WINS and the node
    // really does carry `data-x="false"`. Under presence-keying it painted.
    it('does not paint on a caller-supplied String(false)', () => {
      const { container } = render(rest)
      const el = container.querySelector(pick)
      expect(el.getAttribute(`data-${attr}`)).toBe('false')
      expect(el.matches(sel())).toBe(false)
    })
  })
})

// 🚨 A SURFACE VARIANT IS A SECOND SELECTOR, and the twelve above only walk
// the dark one. Round one found the light tab rule still presence-keyed three
// lines below the dark one that had been fixed — latent, because `Tabs` emits
// `undefined`, but live for any `{...rest}` override or hand-rolled `.ui-tab`,
// and on the surface class Q1 gives Home, Settings and Help.
describe('the light-surface variants refuse "false" too', () => {
  const lightSelectors = () => [...css.matchAll(/^[ \t]*(\.ui-[^{\n\r]*\[data-surface="light"\][^{\n\r]*?)\s*\{/gm)]
    .map((m) => m[1].trim())
    .filter((h) => /\[data-(active|selected|checked|interactive|inactive|highlighted|disabled|pad|rule|wrap|always|numeric|dense)/.test(h))

  it('has light variants that carry a boolean state, so this is not vacuous', () => {
    expect(lightSelectors().length).toBeGreaterThan(0)
  })

  it('none of them keys on presence', () => {
    expect(lightSelectors().filter((h) => /\[data-[a-z-]+\]/.test(h))).toEqual([])
  })

  it('a light tab spelled String(false) does not light up', () => {
    const { container } = render(
      <button type="button" className="ui-tab" data-surface="light" data-active={String(false)}>A</button>,
    )
    const el = container.querySelector('.ui-tab')
    expect(el.getAttribute('data-active')).toBe('false')
    for (const sel of lightSelectors()) expect(el.matches(sel), sel).toBe(false)
    // The control: the same node with "true" DOES match the light active rule.
    el.setAttribute('data-active', 'true')
    expect(lightSelectors().some((sel) => el.matches(sel))).toBe(true)
  })
})

describe('the rule that keeps it fixed', () => {
  // 🚨 SCAN THE RULE HEAD, not the class-plus-attribute. The first cut was
  // `/\.ui-[a-z-]+\[data-[a-z-]+\]/`, which requires the attribute to sit
  // IMMEDIATELY after the class — so it returned [] while four presence-keyed
  // selectors sat in the file, because two of them put the attribute second
  // and two hid it inside `:not()`:
  //
  //   .ui-card:not([data-pad])                     ×3
  //   .ui-tab[data-surface="light"][data-active]   ×1   ← live on the light pages
  //
  // Round one found all four. A guard that cannot see the shape it is named
  // after is the same class of defect as the one it is guarding against.
  const RULE_HEADS = [...css.matchAll(/^[ \t]*(\.ui-[^{\n\r]*?)\s*\{/gm)].map((m) => m[1].trim())

  it('reads every .ui-* rule head in index.css, so it can see what it claims to', () => {
    // The control. Two derivations deep and either going empty makes the guard
    // pass while checking nothing (the shape `adminTerminalCss.test.js` warns
    // about two files over).
    expect(RULE_HEADS.length).toBeGreaterThan(150)
    expect(RULE_HEADS.some((h) => h.includes(':not('))).toBe(true)
    expect(RULE_HEADS.some((h) => /\[data-[a-z-]+="/.test(h))).toBe(true)
    // …and it really would catch each of the four shapes that got past the
    // first cut, asserted against the spellings themselves.
    const bare = (h) => /\[data-[a-z-]+\]/.test(h)
    expect(bare('.ui-card:not([data-pad])')).toBe(true)
    expect(bare('.ui-tab[data-surface="light"][data-active]')).toBe(true)
    expect(bare('.ui-tr[data-selected]')).toBe(true)
    expect(bare('.ui-tab[data-surface="light"][data-active="true"]')).toBe(false)
  })

  it('leaves no presence-keyed .ui-* data selector in index.css', () => {
    const presence = RULE_HEADS.filter((h) => /\[data-[a-z-]+\]/.test(h))
    expect([...new Set(presence)]).toEqual([])
  })

  // 🚨 EVERY kit file, derived — not a list. The first cut named six files and
  // missed `IconButton.jsx` (`data-active={active || undefined}`) and
  // `Chip.jsx` (`data-active={active}`), both writing an attribute their own
  // stylesheet reads by value. And it blacklisted ONE spelling, so
  // `{selected}`, `{selected || null}` and `{String(selected)}` all walked
  // past it. It is a whitelist now: the one correct spelling, or nothing.
  const KIT_DIR = dirname(fileURLToPath(import.meta.url))
  const KIT_FILES = readdirSync(KIT_DIR).filter((n) => n.endsWith('.jsx') && !n.endsWith('.test.jsx'))

  // Boolean STATES. `align`, `surface`, `size`, `dir`, `tone`, `status`,
  // `width`, `side`, `measure`, `variant` and `toast-id` carry a value, not a
  // state — `data-dir={sort || undefined}` is right exactly as it stands.
  const BOOLEAN = new Set([
    ...CASES.map((c) => c.attr),
    'danger', 'checked', 'disabled', 'inline', 'mixed', 'compact',
  ])

  it('scans every kit component, and finds the attributes it is looking for', () => {
    expect(KIT_FILES.length).toBeGreaterThan(20)
    expect(KIT_FILES).toContain('IconButton.jsx')
    expect(KIT_FILES).toContain('Chip.jsx')
    const all = KIT_FILES.flatMap((f) => [...readFileSync(resolve(KIT_DIR, f), 'utf8')
      .matchAll(/data-([a-z-]+)=\{/g)].map((m) => m[1]))
    expect(all.filter((a) => BOOLEAN.has(a)).length).toBeGreaterThan(12)
  })

  it('and the components emit the string, never a bare truthy value', () => {
    const offenders = []
    for (const f of KIT_FILES) {
      const src = readFileSync(resolve(KIT_DIR, f), 'utf8')
      for (const [, attr, expr] of src.matchAll(/data-([a-z-]+)=\{([^}]*)\}/g)) {
        if (!BOOLEAN.has(attr)) continue
        // The ONE legal spelling. `x || undefined` renders a bare `true`,
        // which happens to stringify to "true" — but it also passes a 1, an
        // object or a string straight through, and a value-keyed selector
        // then matches nothing at all.
        if (/^[\w.]+ \? 'true' : undefined$/.test(expr.trim())) continue
        offenders.push(`${f}: data-${attr}={${expr}}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
