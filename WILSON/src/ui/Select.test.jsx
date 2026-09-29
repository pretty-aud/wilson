/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { Select } from './Select'

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8')

afterEach(cleanup)

describe('Select', () => {
  it('renders options from objects or strings, with a placeholder that reports null', () => {
    const onChange = vi.fn()
    render(
      <Select
        value={null}
        onChange={onChange}
        placeholder="Choose a scene…"
        options={[{ value: 's1', label: 'Scene 1' }, 'Scene 2']}
        aria-label="scene"
      />,
    )
    const s = screen.getByLabelText('scene')
    expect(s.className).toContain('ui-input')
    expect([...s.options].map((o) => o.textContent)).toEqual(['Choose a scene…', 'Scene 1', 'Scene 2'])
    fireEvent.change(s, { target: { value: 's1' } })
    expect(onChange).toHaveBeenLastCalledWith('s1')
    fireEvent.change(s, { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith(null)
  })
})

// ── F4 (C3b request 5): the small select keeps its chevron clearance ────────
describe('a small Select still has room for its arrow', () => {
  // Specificity counted from the stylesheet's own selectors, never from a
  // string literal in the test — a count over a literal is a fact about the
  // test, not about the cascade (F3's rule in Toolbar.test.jsx).
  const spec = (sel) => {
    const ids = (sel.match(/#[\w-]+/g) || []).length
    const cls = (sel.match(/\.[\w-]+|\[[^\]]+\]|:[a-z-]+(?!\()/g) || []).length
    const els = (sel.match(/(^|[\s>+~])[a-z]+(?![\w-]*[([])/g) || []).length
    return ids * 10000 + cls * 100 + els
  }
  const ruleFor = (selector) => {
    const at = css.indexOf(selector + ' {')
    expect(at, `no "${selector}" rule in index.css`).toBeGreaterThan(-1)
    return css.slice(at + selector.length, css.indexOf('}', at))
  }
  // 🚨 The selector TEXT comes out of the stylesheet, never from a literal
  // here. The first cut passed `spec('.ui-input[data-size="sm"]')` — a string
  // typed in the test — so `200 > 101` was arithmetic about the test, and
  // deleting `select.ui-input { padding-right: 28px }` outright reddened
  // nothing. Each of the three is now looked up, so a rename or a deletion
  // fails the lookup before the comparison is reached.
  const selectorOf = (re, what) => {
    const m = css.match(re)
    expect(m, `no ${what} selector in index.css`).not.toBeNull()
    return m[1]
  }
  const SM = () => selectorOf(/\n {2}(\.ui-input\[data-size="sm"\]) \{/, 'sm input')
  const SELECT = () => selectorOf(/\n {2}(select\.ui-input) \{/, 'base select')
  const SM_SELECT = () => selectorOf(/\n {2}(select\.ui-input\[data-size="sm"\]) \{/, 'sm select')

  it('is overridden by the sm shorthand — the defect, asserted as a control', () => {
    // `.ui-input[data-size="sm"]` sets the PADDING SHORTHAND, which resets
    // padding-right to 8px. If this ever becomes longhands the guard below is
    // no longer the thing standing between the chevron and the text, and this
    // control says so rather than passing quietly.
    expect(ruleFor(SM())).toMatch(/padding:\s*0 8px/)
    // …and the base select rule really is the one it beats — asserted here so
    // that deleting it cannot pass unnoticed.
    expect(ruleFor(SELECT())).toMatch(/padding-right:\s*28px/)
    expect(spec(SM())).toBeGreaterThan(spec(SELECT()))
  })

  it('restores the 28px clearance at a specificity that beats it', () => {
    expect(ruleFor(SM_SELECT())).toMatch(/padding-right:\s*28px/)
    expect(spec(SM_SELECT())).toBeGreaterThan(spec(SM()))
  })

  it('the counter agrees with real CSS specificity on all four selectors', () => {
    // The counter is the thing every assertion above rests on, so it is
    // checked against hand-computed values: (0,1,0) (0,1,1) (0,2,0) (0,2,1).
    expect([spec('.ui-input'), spec('select.ui-input'),
      spec('.ui-input[data-size="sm"]'), spec('select.ui-input[data-size="sm"]')])
      .toEqual([100, 101, 200, 201])
  })

  it('reaches the element Select actually renders', () => {
    // The selector needs a <select> carrying both `.ui-input` and
    // `data-size="sm"`; `size` defaults elsewhere in the kit, so this asserts
    // what the component emits rather than what the prop was called.
    render(<Select size="sm" value="a" onChange={() => {}} options={['a']} aria-label="sev" />)
    const el = screen.getByLabelText('sev')
    expect(el.tagName).toBe('SELECT')
    expect(el.matches('select.ui-input[data-size="sm"]')).toBe(true)
  })
})
