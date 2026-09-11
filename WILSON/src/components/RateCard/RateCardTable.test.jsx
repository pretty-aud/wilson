/** @vitest-environment jsdom */
// =============================================================================
// RateCardTable.test.jsx — UI overhaul C1.
//
// The rate card is the one table on this surface where getting it wrong writes
// to a financial record, and the review says so twice:
//
//   Risk 1: six sub-components whose editing-versus-display state is expressed
//   ONLY as a swap between two returned JSX branches. "Any extraction must
//   preserve BOTH branches; converting only the display branch silently leaves
//   the editor unstyled, and the editor is what the user sees while typing."
//
//   Risk 8: "The Rate Card's ghost rows, draft row and dept-default editors
//   write through the same `handleUpdate` path; a restyle that changes which
//   element receives the click can convert a ghost row into a real entry on a
//   stray click, which is a write to a financial record. Verify against the
//   ghost branch before and after."
//
// Neither is checkable from a screenshot, and neither is checkable at all in
// the browser here: tester mode has no session, so the page renders its
// permission notice and never a row. This mounts it with fixture rows on F1's
// harness and checks both, plus the column contract and the totals.
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// 🚨 THE VITEST JOB HAS NO `.env.local`. This file mounts a real component, so
// it pulls in whatever that component's imports pull in — and somewhere down
// that graph is `supabaseClient`, which calls `createClient` AT MODULE LOAD
// and throws "supabaseUrl is required." when the env vars are absent. Locally
// the file is there and everything is green; in CI the whole test file fails
// to import, with a message that says nothing about this test.
//
// `pages.test.js` hit the same wall and solved it the same way (commit
// 720affb). The mock is the smallest shape the client's importers touch.
vi.mock('../../cloud/auth/supabaseClient', () => ({
  supabase: {},
  hydrateSupabase: async () => {},
}))

import RateCardTable from './RateCardTable'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../Resources/resources.css'), 'utf8')
// 🚨 WHAT THE `css` ASSERTIONS IN THIS FILE DO AND DO NOT PROVE.
// jsdom does not apply stylesheets, so these read the sheet as TEXT. They pin
// the VALUES lane B has to converge on (hand-off §8) and they catch a value
// being changed by hand; they cannot catch the rule losing the cascade or the
// class being misspelled in the JSX — which is the failure D1 actually
// shipped. That half is checked in the running app, by measuring, and the
// measurements are in the hand-off. `flat` collapses whitespace so a rule
// reformatted across lines does not fail a test about its value.
const flat = css.replace(/\s+/g, ' ')
const source = readFileSync(resolve(here, 'RateCardTable.jsx'), 'utf8')
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/)
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n')

afterEach(cleanup)

const DEPT_DEFAULTS = [{ department: 'Production', burden_pct: 20, overhead_pct: 10 }]

const ENTRIES = [
  {
    id: 'e1', role_label: 'Producer', role_slug: 'producer', department: 'Production',
    wage: 800, burden: null, burden_type: 'percent', overhead: null,
    overhead_type: 'percent', currency: 'USD', region: 'LA', project_size: 'tier_2',
  },
  {
    id: 'e2', role_label: 'Editor', role_slug: 'editor', department: 'Post',
    wage: 600, burden: 15, burden_type: 'percent', overhead: 50,
    overhead_type: 'fixed', currency: 'USD', region: 'NY', project_size: null,
  },
  {
    id: 'e3', role_label: 'Colourist', role_slug: 'colourist', department: 'Post',
    wage: 500, burden: null, burden_type: 'percent', overhead: null,
    overhead_type: 'percent', currency: 'GBP', region: 'London', project_size: null,
  },
]

const makeSlug = (s) => String(s || '').toLowerCase().replace(/\s+/g, '-')

function mount(props = {}) {
  const api = {
    addEntry: vi.fn(async () => {}),
    updateEntry: vi.fn(async () => {}),
    deleteEntry: vi.fn(async () => {}),
    updateDeptDefault: vi.fn(),
  }
  const utils = render(
    <RateCardTable
      entries={ENTRIES}
      deptDefaults={DEPT_DEFAULTS}
      cardType="general"
      teamMembers={[]}
      makeSlug={makeSlug}
      {...api}
      {...props}
    />,
  )
  return { ...utils, ...api }
}

describe('the rate card is the shared table', () => {
  it('declares eleven columns whose widths sum to exactly 100', () => {
    mount()
    const ths = [...document.querySelectorAll('table.ui-table th')]
    expect(ths.map(t => t.textContent.trim())).toEqual([
      'Role', 'Dept', 'Hourly', 'Day', 'Burden', 'Overhead', 'Total',
      'Curr', 'Region', 'Tier', 'Actions',
    ])
    const total = ths.reduce((n, t) => n + parseFloat(t.style.width), 0)
    expect(total).toBe(100)
  })

  it('heads the Member column on the internal card, and only there', () => {
    mount({ cardType: 'internal', teamMembers: [] })
    expect(document.querySelector('table.ui-table th').textContent.trim()).toBe('Member')
  })

  it('ends the six-px column offset: one cell inset on th AND td (F-R09)', () => {
    mount()
    // The kit owns the cell, and every control in it is padded to zero — the
    // defect was `th` at 6px/4px against `td` at 1px/2px plus an inner px-2.
    expect(readFileSync(resolve(here, '../../index.css'), 'utf8'))
      .toMatch(/padding: var\(--cell-pad-y\) var\(--cell-pad-x\)/)
    expect(css).toMatch(/\.rc-cell \{[^}]*padding: 0;/s)
    expect(css).toMatch(/\.rc-select \{[^}]*padding: 0;/s)
    expect(css).toMatch(/\.rc-currency-face \{[^}]*padding: 0;/s)
    // …and the row height is declared on the row, not inherited from a
    // child's minHeight, which is where it used to come from.
    expect(code).not.toMatch(/minHeight/)
  })

  it('right-aligns every money column with tabular mono (F-R10, R3-02)', () => {
    mount()
    const numericHeads = [...document.querySelectorAll('table.ui-table th[data-numeric]')]
      .map(t => t.textContent.trim())
    expect(numericHeads).toEqual(['Hourly', 'Day', 'Burden', 'Overhead', 'Total'])
    for (const th of document.querySelectorAll('table.ui-table th[data-numeric]')) {
      expect(th.getAttribute('data-align')).toBe('right')
    }
  })

  it('drops the near-white peach divider, the bare page-colour header and the greens', () => {
    for (const dead of ['#fed7aa', '#f4a261', '#166534', '#fef3e8', 'orange-100', 'red-100', 'orange-900/10']) {
      expect(code, `${dead} is gone from the rate card`).not.toContain(dead)
    }
    expect(code).not.toMatch(/#[0-9a-fA-F]{6}\b/)
  })
})

describe('both branches of every inline editor survive (review Risk 1)', () => {
  it('the display branch opens an editor that is styled, full-width and zero-inset', () => {
    mount()
    const dayCell = [...document.querySelectorAll('tbody tr')][1].querySelectorAll('td')[3]
    const button = within(dayCell).getByRole('button')
    expect(button.className).toContain('rc-cell')
    fireEvent.click(button)
    const input = dayCell.querySelector('input')
    expect(input, 'the editing branch renders an input').toBeTruthy()
    expect(input.className, 'and it is STYLED, not bare').toContain('rc-cell-input')
    // The two branches share width and inset, so the cell does not jump when
    // it opens — which is the whole reason the editor is worth styling.
    expect(css).toMatch(/\.rc-cell-input \{[^}]*width: 100%;/s)
    expect(css).toMatch(/\.rc-cell-input \{[^}]*padding: 0;/s)
  })

  it('keeps Escape-reverts-the-edit and Enter-commits', () => {
    const { updateEntry } = mount()
    const dayCell = [...document.querySelectorAll('tbody tr')][1].querySelectorAll('td')[3]
    fireEvent.click(within(dayCell).getByRole('button'))
    const input = dayCell.querySelector('input')
    fireEvent.change(input, { target: { value: '999' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(updateEntry, 'Escape writes nothing').not.toHaveBeenCalled()

    fireEvent.click(within(dayCell).getByRole('button'))
    const again = dayCell.querySelector('input')
    fireEvent.change(again, { target: { value: '999' } })
    fireEvent.keyDown(again, { key: 'Enter' })
    expect(updateEntry).toHaveBeenCalledWith('e1', { wage: 999 })
  })

  it('gives the %/$ toggle a real target in BOTH branches (F-R21)', () => {
    mount()
    const burdenCell = [...document.querySelectorAll('tbody tr')][1].querySelectorAll('td')[4]
    const toggle = burdenCell.querySelector('.rc-comp-type')
    expect(toggle, 'the toggle exists at rest').toBeTruthy()
    // 28px square, 8px clear of the value, full-strength ink — it was 9px at
    // opacity 0.45 in a ~16x14px area, 2px from a different action, and the
    // mis-click changed a percentage into a dollar amount on a rate.
    // 20px and not the 28px control token: a 28px control stacked above the
    // derived line inside an 8px-padded cell makes a 63px row in the densest
    // table on the surface, against the 36px declared everywhere else. Still
    // 2.5x the old target and still 8px clear of the value.
    expect(flat).toMatch(/\.rc-comp-type \{[^}]*width: 20px; height: 20px;/)
    // The cell is a GRID, and the shape is load-bearing rather than
    // cosmetic — two flex layouts were wrong here first. A 28px toggle with
    // the derived amount stacked under it made a 63px row; everything on one
    // line crushed `.rc-comp-value` to THREE PIXELS at the 1080px table
    // width, so the editable figure vanished and the read-only one it derives
    // from survived. Measured in the running app both times.
    expect(flat).toMatch(/\.rc-comp \{ display: grid;/)
    expect(flat).toMatch(/grid-template-columns: minmax\(0, 1fr\) 20px;/)
    // The value never shares row 1 with anything but the toggle, and the
    // derived amount gets the whole cell width on row 2 — so neither a rate
    // nor a money figure can be truncated to make room for the other.
    expect(flat).toMatch(/\.rc-comp-value \{ grid-column: 1; grid-row: 1;/)
    expect(flat).toMatch(/\.rc-comp-derived \{[^}]*grid-column: 1 \/ -1;/)

    // 🚨 AND THE SHAPE ITSELF, IN THE DOM. The four assertions above read the
    // stylesheet as text, and every one of them passed while the derived
    // amount was a SIBLING of `.rc-comp` rather than a child — so
    // `grid-column`, `grid-row` and `width: 100%` were no-ops on an inline
    // span and the money figure truncated anyway. A test that pins a
    // declaration does not pin a shape; this is the one that does.
    const derived = document.querySelector('.rc-comp-derived')
    expect(derived, 'a row with a computed amount renders one').toBeTruthy()
    expect(derived.parentElement.classList.contains('rc-comp'),
      'the derived amount must be a CHILD of the grid, not a sibling').toBe(true)
    expect(code).not.toMatch(/opacity: 0\.45/)
    // …and the editing branch renders the SAME toggle, so the two states line
    // up rather than the toggle changing size when the cell opens.
    fireEvent.click(within(burdenCell).getAllByRole('button')[0])
    expect(burdenCell.querySelector('.rc-comp-type')).toBeTruthy()
    expect(burdenCell.querySelector('input.rc-cell-input')).toBeTruthy()
  })

  it('toggling the type writes the type and nothing else', () => {
    const { updateEntry } = mount()
    const burdenCell = [...document.querySelectorAll('tbody tr')][1].querySelectorAll('td')[4]
    fireEvent.click(burdenCell.querySelector('.rc-comp-type'))
    expect(updateEntry).toHaveBeenCalledWith('e1', { burden_type: 'fixed' })
  })
})

describe('the ghost branch (review Risk 8 — a write to a financial record)', () => {
  const MEMBERS = [
    { id: 'm1', name: 'Ada', title: 'Producer', department: 'Production', is_full_time: true },
    { id: 'm2', name: 'Grace', title: 'Editor', department: 'Post', is_full_time: true },
  ]

  it('renders a ghost row per unrated member, marked and not selected', () => {
    mount({ cardType: 'internal', entries: [], teamMembers: MEMBERS })
    const ghosts = [...document.querySelectorAll('tbody tr[data-ghost]')]
    expect(ghosts).toHaveLength(2)
    // A quiet wash, never the SELECTED treatment: a row that looks selected
    // and is not is worse than no marking (the shared Row's own note).
    for (const g of ghosts) expect(g.hasAttribute('data-selected')).toBe(false)
    expect(screen.getAllByLabelText('No rate set')).toHaveLength(2)
  })

  it('🚨 a click anywhere on a ghost row does NOT create an entry', () => {
    const { addEntry } = mount({ cardType: 'internal', entries: [], teamMembers: MEMBERS })
    const ghost = document.querySelector('tbody tr[data-ghost]')
    // The row itself, and the cells that are not editors. Nothing was wrapped
    // in a clickable element by the restyle, and the row is not `interactive`.
    expect(ghost.hasAttribute('data-interactive')).toBe(false)
    fireEvent.click(ghost)
    fireEvent.click(ghost.querySelectorAll('td')[0])
    fireEvent.click(ghost.querySelectorAll('td')[6])
    expect(addEntry).not.toHaveBeenCalled()
  })

  it('…and the first real EDIT on a ghost row still creates it', () => {
    const { addEntry } = mount({ cardType: 'internal', entries: [], teamMembers: MEMBERS })
    const ghost = document.querySelector('tbody tr[data-ghost]')
    const dayCell = ghost.querySelectorAll('td')[3]
    fireEvent.click(within(dayCell).getByRole('button'))
    const input = dayCell.querySelector('input')
    fireEvent.change(input, { target: { value: '750' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(addEntry).toHaveBeenCalledTimes(1)
    const created = addEntry.mock.calls[0][0]
    expect(created.wage).toBe(750)
    expect(created.member_id).toBe('m1')
    expect(created.id, 'the ghost id never reaches the backend').toBeUndefined()
  })

  it('offers no duplicate or delete on a ghost row', () => {
    mount({ cardType: 'internal', entries: [], teamMembers: MEMBERS })
    const ghost = document.querySelector('tbody tr[data-ghost]')
    const slot = ghost.querySelector('.ui-hover-actions')
    expect(slot, 'the slot is reserved either way, so the column cannot shift').toBeTruthy()
    expect(slot.querySelectorAll('button')).toHaveLength(0)
  })
})

describe('the summary row', () => {
  it('is an AVERAGE, not a sum, and one row per currency', () => {
    mount()
    const rows = [...document.querySelectorAll('tr.rc-total-row')]
    // A rate card is a price list, not a bill. Adding a producer's day rate to
    // an editor's produces a figure true only if every role works exactly one
    // day — the fabricated-number defect Q22 removed from O.T.T.E.R. Adding
    // across currencies is worse. The first cut of this file summed anyway.
    expect(rows).toHaveLength(2)
    const labels = rows.map(r => r.querySelector('.rc-total-label').textContent)
    expect(labels[0]).toMatch(/^Average · GBP · 1 rate$/)
    expect(labels[1]).toMatch(/^Average · USD · 2 rates$/)
  })

  it('averages the day rate and the computed total of its own currency only', () => {
    mount()
    const usd = [...document.querySelectorAll('tr.rc-total-row')]
      .find(r => r.textContent.includes('USD'))
    const cells = usd.querySelectorAll('td')
    // Day: (Producer 800 + Editor 600) / 2 = 700.
    expect(cells[1].textContent).toMatch(/700/)
    // Total: Producer 800 + 20% dept burden (160) + 10% dept overhead (80) =
    // 1040; Editor 600 + 15% burden (90) + 50 fixed overhead = 740.
    // (1040 + 740) / 2 = 890.
    expect(cells[3].textContent).toMatch(/890/)
    // The GBP row is computed from its one rate and never sees the USD ones.
    const gbp = [...document.querySelectorAll('tr.rc-total-row')]
      .find(r => r.textContent.includes('GBP'))
    expect(gbp.querySelectorAll('td')[1].textContent).toMatch(/500/)
  })

  it('leaves unrated rows out of the average entirely', () => {
    // Otherwise every unrated member on the internal card drags the mean down
    // and the figure describes the roster rather than the rates.
    mount({
      cardType: 'internal',
      entries: [ENTRIES[0]],
      teamMembers: [
        { id: 'm1', name: 'Ada', title: 'Producer', department: 'Production', is_full_time: true },
        { id: 'm2', name: 'Grace', title: 'Editor', department: 'Post', is_full_time: true },
      ],
    })
    const row = document.querySelector('tr.rc-total-row')
    expect(row.querySelector('.rc-total-label').textContent).toMatch(/1 rate$/)
  })

  it('renders no summary row when nothing has a rate', () => {
    mount({ entries: [] })
    expect(document.querySelectorAll('tr.rc-total-row')).toHaveLength(0)
  })
})

describe('the row actions and the department bar', () => {
  it('keeps duplicate and delete VISIBLE at rest, in a reserved slot', () => {
    mount()
    const row = [...document.querySelectorAll('tbody tr')][1]
    const slot = row.querySelector('.ui-hover-actions')
    expect(slot.querySelectorAll('button')).toHaveLength(2)
    // 🚨 The assertion an earlier cut of this file did not make, which let a
    // C1 violation look intentional: these were visible before the restyle, so
    // hiding them until hover is "a disclosure that hides a control". Q17(b)
    // adds the FOCUS reveal to controls that already hide; it does not licence
    // hiding one that did not. An invisible Delete on a financial record is
    // also still clickable on any input that never generates hover.
    expect(slot.dataset.always, 'row actions must not hide at rest').toBe('true')
    // Reserved, so the row cannot reflow under the pointer; revealed on
    // focus-within too, which is what stops the controls being keyboard dead
    // ends (Q17b).
    expect(readFileSync(resolve(here, '../../index.css'), 'utf8'))
      .toMatch(/:where\(tr, li, \.ui-hover-host\):focus-within \.ui-hover-actions/)
  })

  it('indents the department bar to the first column\'s text inset', () => {
    mount()
    const bar = document.querySelector('.rc-dept')
    expect(bar).toBeTruthy()
    // Alignment list #10: it spanned eleven columns with its own 12px inset,
    // so the group label did not line up with the Role column it names.
    expect(flat).toMatch(/\.rc-dept \{[^}]*padding: 0 var\(--cell-pad-x\);/)
    expect(flat).toMatch(/\.rc-dept-cell \{ padding: 0;/)
  })

  it('keeps the department defaults editable in BOTH places (Hick\'s #3)', () => {
    mount()
    // On the bar…
    expect(document.querySelectorAll('.rc-dept .rc-dd').length).toBeGreaterThan(0)
    // …and in the bulk panel, which is collapsed at rest and now says so.
    const toggle = screen.getByRole('button', { name: /Edit all department defaults/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(document.querySelectorAll('.rc-defaults-card').length).toBeGreaterThan(0)
  })

  it('collapses a department without removing its rows from the model', () => {
    mount()
    const before = document.querySelectorAll('tbody tr[data-ghost], tbody tr').length
    fireEvent.click(screen.getByRole('button', { name: /Post/ }))
    expect(document.querySelectorAll('tbody tr').length).toBeLessThan(before)
    fireEvent.click(screen.getByRole('button', { name: /Post/ }))
    expect(document.querySelectorAll('tbody tr').length).toBe(before)
  })
})

describe('read-only', () => {
  it('opens no editor and offers no row action when the grant is view-only', () => {
    const { updateEntry } = mount({ readOnly: true, updateDeptDefault: undefined })
    const dayCell = [...document.querySelectorAll('tbody tr')][1].querySelectorAll('td')[3]
    fireEvent.click(within(dayCell).getByRole('button'))
    expect(dayCell.querySelector('input')).toBeNull()
    expect(updateEntry).not.toHaveBeenCalled()
    for (const slot of document.querySelectorAll('tbody .ui-hover-actions')) {
      expect(slot.querySelectorAll('button')).toHaveLength(0)
    }
    // The draft row is an edit affordance too, so it is absent.
    expect(document.querySelector('tr[data-draft]')).toBeNull()
  })
})
