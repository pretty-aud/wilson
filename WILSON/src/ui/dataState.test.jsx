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
import { readFileSync } from 'node:fs'
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

describe('the rule that keeps it fixed', () => {
  // The kit's own block only. A page stylesheet may key on presence if it also
  // controls every writer; index.css is written for callers it cannot see.
  it('leaves no presence-keyed .ui-* data selector in index.css', () => {
    const presence = [...css.matchAll(/\.ui-[a-z-]+\[data-[a-z-]+\]/g)].map(m => m[0])
    expect([...new Set(presence)]).toEqual([])
  })

  it('and the components emit the string, never a bare truthy value', () => {
    const dir = dirname(fileURLToPath(import.meta.url))
    const files = ['Table.jsx', 'Toolbar.jsx', 'SectionTitle.jsx', 'Card.jsx', 'Tabs.jsx', 'HoverActions.jsx']
    // Exactly the twelve. `data-align`, `data-surface`, `data-size` and
    // `data-dir` carry a VALUE, not a boolean — `data-dir={sort || undefined}`
    // is right as it stands — and are none of this rule's business.
    const BOOLEAN = new Set(CASES.map(c => c.attr))
    const offenders = []
    for (const f of files) {
      const src = readFileSync(resolve(dir, f), 'utf8')
      for (const m of src.matchAll(/data-([a-z-]+)=\{([^}]*)\}/g)) {
        const [, attr, expr] = m
        if (!BOOLEAN.has(attr)) continue
        if (!/\|\| undefined$/.test(expr.trim())) continue
        offenders.push(`${f}: data-${attr}={${expr}}`)
      }
    }
    // `x || undefined` renders a bare `true`, which happens to stringify to
    // "true" — but it also passes a 1, an object or a string straight through,
    // and those stop matching a value-keyed selector. The ternary is the only
    // spelling that maps every truthy value onto the one the stylesheet reads.
    expect(offenders).toEqual([])
  })
})
