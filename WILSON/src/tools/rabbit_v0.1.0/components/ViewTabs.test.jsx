/** @vitest-environment jsdom */
// ViewTabs — R.A.B.B.I.T.'s tab strip.
//
// History, because each step changed what this file has to prove:
//   V1 (2026-09-23): the active tab painted `#fff7ed` on the signal orange at
//     the Dense step, 3.35:1 — a C6 violation live on every R.A.B.B.I.T.
//     screen. V1's stopgap: `#1c1917` on the same fill (4.91:1).
//   B1 commit 1: the colours moved from the inline style to a data attribute.
//   B1 restyle: the strip is the kit's Tabs. The active tab takes §3.2's
//     treatment — a 2px signal underline and NO fill — so no ink sits on
//     orange at all, and the stopgap retires with the fill.
//
// So the C6 guarantee is now structural: nothing on the active tab may paint
// a ground (no inline fill, no fill utility, and the kit rule it relies on
// declares none), and its ink is the kit's `ink` on `paper`.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import ViewTabs, { RABBIT_VIEWS, RABBIT_VIEW_PANEL_ID, viewTabItems } from './ViewTabs'

afterEach(cleanup)

const here = dirname(fileURLToPath(import.meta.url))
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const indexCss = strip(readFileSync(resolve(here, '../../../index.css'), 'utf8'))
const rabbitSrc = readFileSync(resolve(here, '../Rabbit.jsx'), 'utf8')

/* A Tailwind utility that can set the text COLOUR or a BACKGROUND, behind any
   number of variant prefixes (`md:`, `enabled:`, `aria-[current=page]:` —
   V1's review showed `md:text-white!` and `text-(--color-white)!` both walked
   past a first version). Type steps and non-colour `text-` utilities share
   the prefix and are excluded. */
const NOT_COLOUR = new Set(['h1', 'h2', 'h3', 'body', 'dense', 'caption', 'label', 'left', 'right', 'center', 'justify',
  'start', 'end', 'wrap', 'nowrap', 'balance', 'pretty', 'ellipsis', 'clip'])
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
  if (base.startsWith('bg-')) return true
  if (!base.startsWith('text-')) return false
  const rest = base.slice(5)
  return !NOT_COLOUR.has(rest) && !rest.startsWith('shadow')
})

/** The declarations of the kit rule whose selector is exactly `selector`. */
const kitRule = (selector) => {
  // Anchored at the start of a line, so `.ui-tab` never matches the
  // `.ui-toolbar .ui-tab` rule that also ends in `.ui-tab {`.
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = indexCss.match(new RegExp(`(?:^|\\n)[ \\t]*${esc}\\s*\\{([^}]*)\\}`))
  expect(m, `no ${selector} rule in index.css`).not.toBeNull()
  return m[1]
}

const ALL = ['Intake', 'Summary', 'Team', 'Tasks', 'Timeline', 'Budget', 'Assets', 'Scenes', 'Bins', 'Levels', 'Experiences']
const tabLabels = (container) => [...container.querySelectorAll('[role="tab"]')].map((b) => b.textContent.trim())

describe('ViewTabs: the active view', () => {
  it('exactly one tab is selected, and it is the active view', () => {
    const { container } = render(<ViewTabs activeView="summary" onChange={() => {}} />)
    const selected = [...container.querySelectorAll('[role="tab"][aria-selected="true"]')]
    expect(selected.map((b) => b.textContent.trim())).toEqual(['Summary'])
    expect(selected[0].getAttribute('data-active')).toBe('true')
    expect(container.querySelectorAll('[role="tab"][data-active]')).toHaveLength(1)
  })

  it('C6, structurally: the active tab paints no ground — no inline fill, no fill or colour utility', () => {
    const { container } = render(<ViewTabs activeView="tasks" onChange={() => {}} />)
    const tab = container.querySelector('[role="tab"][aria-selected="true"]')
    expect(tab.style.backgroundColor).toBe('')
    expect(tab.style.color).toBe('')
    expect(colourUtilities(tab.className)).toEqual([])
  })

  it("the kit rule the active tab relies on is an underline and declares no background", () => {
    const active = kitRule('.ui-tab[data-active="true"]')
    expect(active).toMatch(/border-bottom-color:\s*var\(--color-signal\)/)
    expect(active).not.toMatch(/background/)
    expect(kitRule('.ui-tab')).toMatch(/background:\s*none/)
  })

  it('CONTROL: the utility scanner fires on every colour and fill spelling, and not on type steps or layout', () => {
    for (const c of ['text-white', 'text-white!', '!text-white', 'text-orange-100', 'text-[#fff]', 'md:text-white!',
      'aria-[current=page]:text-white!', 'enabled:text-white!', 'text-(--color-white)!', 'text-[var(--color-white)]!',
      'text-[rgb(255,255,255)]!', 'hover:md:text-orange-50/80', 'text-[color:var(--x)]', 'md:text-[color:var(--x)]!',
      'bg-orange-600', 'aria-selected:bg-[#ea580c]!']) expect(colourUtilities(`a ${c} b`), c).toEqual([c])
    for (const c of ['text-dense', 'text-body', 'text-label', 'text-h2', 'text-left', 'text-nowrap', 'text-wrap',
      'text-balance', 'text-start', 'text-end', 'text-ellipsis', 'text-shadow-sm', 'md:text-dense']) expect(colourUtilities(`a ${c} b`), c).toEqual([])
  })
})

describe('ViewTabs: eleven peers, grouped, none removed (C1)', () => {
  it('renders all eleven views, in their order, when nothing is hidden', () => {
    const { container } = render(<ViewTabs activeView="summary" onChange={() => {}} />)
    expect(tabLabels(container)).toEqual(ALL)
    expect(RABBIT_VIEWS.map((v) => v.label)).toEqual(ALL)
  })

  it('draws a hairline between the three groups: project | plan | material', () => {
    const items = viewTabItems({})
    const shape = items.map((i) => (i.separator ? '|' : i.id)).join(' ')
    expect(shape).toBe('intake summary team | tasks timeline budget | assets scenes bins levels experiences')
    const { container } = render(<ViewTabs activeView="summary" onChange={() => {}} />)
    expect(container.querySelectorAll('.ui-tabs-sep')).toHaveLength(2)
  })

  it('a hidden tab leaves no gap and a fully hidden group leaves no doubled hairline', () => {
    const hidden = new Set(['budget', 'tasks', 'timeline'])
    const shape = viewTabItems({ hiddenTabs: hidden }).map((i) => (i.separator ? '|' : i.id)).join(' ')
    expect(shape).toBe('intake summary team | assets scenes bins levels experiences')
    const shape2 = viewTabItems({ hiddenTabs: ['scenes', 'bins', 'levels', 'experiences', 'assets'] })
      .map((i) => (i.separator ? '|' : i.id)).join(' ')
    expect(shape2).toBe('intake summary team | tasks timeline budget')
  })

  it('the whole-strip disabled flag disables every tab, as before', () => {
    const { container } = render(<ViewTabs activeView="summary" onChange={() => {}} disabled />)
    const tabs = [...container.querySelectorAll('[role="tab"]')]
    expect(tabs).toHaveLength(11)
    expect(tabs.every((t) => t.disabled)).toBe(true)
  })

  it('a click still switches the view (C1: what a click does is unchanged)', () => {
    const onChange = vi.fn()
    const { container } = render(<ViewTabs activeView="summary" onChange={onChange} />)
    const team = [...container.querySelectorAll('[role="tab"]')].find((b) => b.textContent.trim() === 'Team')
    fireEvent.click(team)
    expect(onChange).toHaveBeenCalledWith('team')
  })

  it('every tab points at the view region, and Rabbit.jsx gives that region the tabpanel role and id', () => {
    const { container } = render(<ViewTabs activeView="summary" onChange={() => {}} rightSlot={<i data-testid="r" />} />)
    for (const t of container.querySelectorAll('[role="tab"]')) expect(t.getAttribute('aria-controls')).toBe(RABBIT_VIEW_PANEL_ID)
    expect(container.querySelector('.rb-viewtabs-right [data-testid="r"]')).not.toBeNull()
    expect(rabbitSrc).toMatch(/role="tabpanel" id=\{RABBIT_VIEW_PANEL_ID\}/)
  })
})
