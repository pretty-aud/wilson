/** @vitest-environment jsdom */
// StatusBanner (FX3, kit request FX3-KR-2): StatusBadge at a popup's full
// width, under its title. One source for the word and the tone; the band adds
// only geometry and a hairline of the tone, never a colour or a weight of its own.
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { StatusBanner } from './StatusBanner'
import { StatusBadge } from './StatusBadge'
import { statusMeta } from './StatusDot'

afterEach(cleanup)

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const ruleBody = (sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = css.match(new RegExp(`(?:^|[\\s}])${esc}\\s*\\{([^}]*)\\}`))
  return m ? m[1] : null
}

describe('StatusBanner', () => {
  it('is the badge at the band\'s width: the same element, word, tone and dot, plus its own class', () => {
    const { container } = render(<StatusBanner status="needs_revisions" />)
    const banner = container.firstElementChild
    expect([...banner.classList]).toEqual(['ui-status', 'ui-status-banner'])
    const m = statusMeta('needs_revisions')
    expect([banner.dataset.status, banner.dataset.tone, banner.textContent]).toEqual(['needs_revisions', m.tone, m.label])
    const dot = banner.querySelector('.ui-status-dot')
    expect([dot.dataset.tone, dot.getAttribute('aria-hidden')]).toEqual([m.tone, 'true'])
    expect(banner.getAttribute('style')).toBeNull()
    // The very markup StatusBadge draws, so the two can never disagree.
    const { container: badge } = render(<StatusBadge status="needs_revisions" />)
    expect(banner.innerHTML).toBe(badge.firstElementChild.innerHTML)
  })

  it('every status in the one map gives its own tone and word; a caller\'s class joins, never replaces', () => {
    for (const s of ['not_started', 'in_progress', 'approved', 'final', 'blocked', 'on_hold', 'omitted']) {
      const { container } = render(<StatusBanner status={s} className="x-extra" />)
      const b = container.firstElementChild
      expect([b.dataset.tone, b.textContent], s).toEqual([statusMeta(s).tone, statusMeta(s).label])
      expect(b.classList.contains('ui-status-banner') && b.classList.contains('ui-status') && b.classList.contains('x-extra'), s).toBe(true)
      cleanup()
    }
  })

  it('the stylesheet: full width, 28px, the gutter, square, NO tint behind the word, and one 1px hairline in the tone — no font, weight or ink of its own (those are .ui-status\'s)', () => {
    const body = ruleBody('.ui-status-banner')
    expect(body, 'the .ui-status-banner rule is gone').not.toBeNull()
    expect(body).toMatch(/display:\s*flex;/)
    expect(body).toMatch(/width:\s*100%;/)
    expect(body).toMatch(/height:\s*28px;/)
    expect(body).toMatch(/padding:\s*0 var\(--spacing-gutter\);/)
    expect(body).toMatch(/border-radius:\s*0;/)
    // Audrey, 2026-10-11: "remove the green bar the text is in ... leave just
    // the color dot and the color line below the title". The badge's tint is
    // cleared here; the dot and the line carry the colour.
    expect(body).toMatch(/background-color:\s*transparent;/)
    expect(body).toMatch(/border-bottom:\s*1px solid var\(--status-color, var\(--color-ink-3\)\);/)
    // No 2px edge, and nothing typographic, and no ink of its own.
    expect(body).not.toMatch(/\b[2-9]px solid/)
    expect(body).not.toMatch(/font-|(?:^|[\s;])color:|background:|letter-spacing|text-transform/)
    // The rule comes AFTER `.ui-status` (same specificity), so the transparent
    // ground wins over the badge's tint.
    expect(css.indexOf('.ui-status-banner {')).toBeGreaterThan(css.search(/\.ui-status \{/))
    // On a light surface: no well behind the word either, and the rule is the hairline.
    const light = ruleBody('.ui-status-banner[data-surface="light"]')
    expect(light).toMatch(/background-color:\s*transparent;/)
    expect(light).toMatch(/border-bottom-color:\s*var\(--color-rule-light\);/)
    expect(css.indexOf('.ui-status-banner[data-surface="light"]')).toBeGreaterThan(css.indexOf('.ui-status[data-surface="light"]'))
    // CONTROL: the reader finds a rule that is there and refuses one that is not.
    expect(ruleBody('.ui-status')).toMatch(/font-size:\s*var\(--text-label\);/)
    expect(ruleBody('.ui-status-banner-gone')).toBeNull()
  })
})
