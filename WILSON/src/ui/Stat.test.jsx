/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { Stat } from './Stat'

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8')

afterEach(cleanup)

describe('Stat', () => {
  it('renders the label above the value', () => {
    const { container } = render(<Stat label="Members" value={12} />)
    const kids = [...container.querySelector('.ui-stat').children]
    expect(kids.map((k) => k.className)).toEqual(['ui-stat-label', 'ui-stat-value'])
    expect(kids[0].textContent).toBe('Members')
    expect(kids[1].textContent).toBe('12')
  })

  it('omits the delta entirely when there is none', () => {
    const { container } = render(<Stat label="Members" value={0} />)
    expect(container.querySelector('.ui-stat-delta')).toBeNull()
  })

  it('renders a zero value rather than treating it as absent', () => {
    const { container } = render(<Stat label="Blocked" value={0} delta={0} />)
    expect(container.querySelector('.ui-stat-value').textContent).toBe('0')
    expect(container.querySelector('.ui-stat-delta').textContent).toBe('0')
  })

  it('takes the delta tone from a status token, so no colour is written inline', () => {
    const { container } = render(<Stat label="Tasks" value={9} delta="+3" deltaStatus="approved" />)
    const d = container.querySelector('.ui-stat-delta')
    expect(d.dataset.tone).toBe('success')
    expect(d.getAttribute('style')).toBeNull()
  })

  // 🚨 The attribute above is only half the story, and it was the half that
  // was right. The first cut read `var(--status-color)`, which is set ONLY by
  // the `.ui-status` / `.ui-status-dot` tone rules — so every delta rendered
  // the fallback ink and BOTH tone props were inert. A state extracted to a
  // data attribute that no rule consumes is the same dead state as an inline
  // style beating a class, written the other way round.
  it('has a stylesheet rule for every tone it can emit', () => {
    for (const tone of ['signal', 'success', 'warning', 'danger']) {
      expect(css, tone).toContain(`.ui-stat-delta[data-tone="${tone}"]`)
    }
    // The control: the base rule must not resolve its colour through a
    // variable that is scoped to another component's selectors.
    const rule = css.slice(css.indexOf('.ui-stat-delta {'), css.indexOf('.ui-stat-delta[data-tone="signal"]'))
    expect(rule).not.toContain('var(--status-color')
  })

  it('falls back to neutral for an unknown status rather than blanking', () => {
    const { container } = render(<Stat label="X" value={1} delta="?" deltaStatus="brand_new" />)
    expect(container.querySelector('.ui-stat-delta').dataset.tone).toBe('neutral')
  })

  it('carries the surface as data', () => {
    const { container } = render(<Stat label="X" value={1} surface="light" />)
    expect(container.querySelector('.ui-stat').dataset.surface).toBe('light')
  })

  // B2 kit request K1: a value that IS the good or bad news (Tasks'
  // "Tasks completed") takes a tone on the value, not on the tile's border.
  it('puts a value tone on the value as data, and none by default', () => {
    const plain = render(<Stat label="A" value={1} />).container.querySelector('.ui-stat-value')
    expect(plain.hasAttribute('data-tone')).toBe(false)
    cleanup()
    const toned = render(<Stat label="B" value={2} valueTone="success" />).container.querySelector('.ui-stat-value')
    expect(toned.dataset.tone).toBe('success')
    expect(toned.getAttribute('style')).toBeNull()
  })

  it('has a stylesheet rule for every value tone, and the light surface keeps its one ink', () => {
    // Comments out; EVERY rule whose target is a toned value, in any spelling
    // (B2 round one: a `toContain` passed with the rule commented out, with
    // the success tone painting danger, and with the rule made heavier than
    // the light surface's; round two: a LATER rule painting success danger,
    // and a `.ui-stat > .ui-stat-value[…]` spelling that ties the light rule
    // and wins by order, both passed a check that matched one exact text).
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const rules = [...code.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .flatMap(([, sel, body]) => sel.split(',').map((s) => ({ sel: s.trim(), body })))
      .filter(({ sel }) => !sel.startsWith('@'))
    const target = (sel) => sel.split(/[\s>+~]+/).pop()
    const weight = (sel) => (sel.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) || []).length
    const colours = (body) => [...body.matchAll(/(?:^|;)\s*color\s*:\s*([^;]+)/g)].map((m) => m[1].trim())
    const LIGHT = '.ui-stat[data-surface="light"] .ui-stat-value'
    const light = rules.filter((r) => r.sel === LIGHT)
    expect(light.length).toBeGreaterThan(0)
    for (const r of light) expect(colours(r.body)).toEqual(['var(--color-ink-light)'])
    for (const tone of ['signal', 'success', 'warning', 'danger']) {
      const toned = rules.filter(({ sel }) => /\.ui-stat-value(?![\w-])/.test(target(sel)) && target(sel).includes(`[data-tone="${tone}"]`))
      expect(toned.length, tone).toBeGreaterThan(0)
      for (const r of toned) {
        // every colour any rule for this tone writes is the tone …
        for (const c of colours(r.body)) expect(c, r.sel).toBe(`var(--color-${tone})`)
        // … and no spelling of it reaches the light rule's weight.
        expect(weight(r.sel), r.sel).toBeLessThan(weight(LIGHT))
      }
    }
  })
})
