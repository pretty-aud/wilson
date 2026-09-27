/** @vitest-environment jsdom */
// =============================================================================
// helpContent.test.jsx — P1-35 / P1-78 (UI overhaul P1, 2026-09-27).
//
// The three tools' help content renders on two surfaces: the in-tool dialog
// (dark) and, for D.O.G. and O.T.T.E.R., the light Help page. Until P1 the
// light Help page drew D.O.G.'s through a sheet of !important overrides on
// its dark classes (translucent white cards on the orange, three stone greys,
// a dark grey notes box with orange text), and both D.O.G.'s and O.T.T.E.R.'s
// dark help used the stone ramp and orange-400 where R.A.B.B.I.T.'s had moved
// onto the kit's tokens (B6). Every assertion below has a control that shows
// it can fail.
// =============================================================================
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { DOG_HELP_SIDEBAR_ITEMS, DogHelpContent } from './dogHelpContent'
import { OTTER_HELP_SIDEBAR_ITEMS, OtterHelpContent } from './otterHelpContent'
import { RABBIT_HELP_SIDEBAR_ITEMS, RabbitHelpContent } from '../tools/rabbit_v0.1.0/rabbitHelpContent'
import HelpPage from '../components/HelpPage'

afterEach(cleanup)

// A class from the raw palette (the stone ramp, orange-400 and friends) or an
// inline hex: the two ways the old help painted itself.
const PALETTE = /(?:^|\s)(?:[a-z-]+:)*(?:text|bg|border)-(?:stone|orange|amber|gray|neutral)-\d/
function offTokens(container) {
  const found = []
  for (const el of container.querySelectorAll('*')) {
    const cls = el.getAttribute('class') || ''
    if (PALETTE.test(cls)) found.push(`${el.tagName.toLowerCase()}.${cls}`)
    const style = el.getAttribute('style') || ''
    if (/#[0-9a-f]{3,8}\b/i.test(style)) found.push(`${el.tagName.toLowerCase()}[style=${style}]`)
  }
  if (container.querySelector('style')) found.push('<style>')
  return found
}

const SURFACES = [
  ['D.O.G.', DOG_HELP_SIDEBAR_ITEMS, DogHelpContent, ['light', undefined]],
  ['O.T.T.E.R.', OTTER_HELP_SIDEBAR_ITEMS, OtterHelpContent, ['light', 'dark']],
  ['R.A.B.B.I.T.', RABBIT_HELP_SIDEBAR_ITEMS, RabbitHelpContent, ['light', 'dark']],
]

describe('the help content is on the tokens, on both surfaces (P1-35)', () => {
  for (const [tool, items, Content, themes] of SURFACES) {
    for (const theme of themes) {
      it(`${tool} ${theme || 'dialog (default)'}: no palette class, no inline hex, no override sheet, on every page`, () => {
        const bad = []
        let drawn = 0
        for (const { id } of items) {
          const { container } = render(<Content helpPage={id} theme={theme} />)
          if (container.textContent.trim()) drawn++
          bad.push(...offTokens(container).map((b) => `${id}: ${b}`))
          cleanup()
        }
        expect(drawn, 'no page rendered anything — the guard would pass on an empty tree').toBeGreaterThan(3)
        expect(bad).toEqual([])
      })
    }
  }
  it('CONTROL: the check names the old classes, an inline hex and a <style>', () => {
    const host = document.createElement('div')
    host.innerHTML = '<style>.help-light{}</style><p class="text-dense text-stone-400 leading-relaxed">a</p>'
      + '<a style="border-left: 3px solid #ea580c">b</a><span class="hover:bg-stone-800">c</span><h3 class="text-h2 text-ink">ok</h3>'
    expect(offTokens(host)).toEqual([
      'p.text-dense text-stone-400 leading-relaxed',
      'a[style=border-left: 3px solid #ea580c]',
      'span.hover:bg-stone-800',
      '<style>',
    ])
  })
})

// Sentence case (Q2): the first word keeps its capital; after it, only proper
// nouns and acronyms do.
const PROPER = new Set(['D.O.G.', 'O.T.T.E.R.', 'R.A.B.B.I.T.', 'Wilson', 'Slides', 'Google', 'AI', 'Nodes'])
// A tool's spelled-out name is a proper noun (the nav's subtitle under "D.O.G.").
const PROPER_PHRASES = ['Deck Outline Generator']
function titleCased(label) {
  let text = label
  for (const p of PROPER_PHRASES) text = text.replace(p, 'Name')
  const words = text.replace(/[()]/g, ' ').split(/\s+/).filter(Boolean)
  const rest = words.slice(1).filter((w) => /^[A-Z][a-z]/.test(w) && !PROPER.has(w.replace(/[:,?]$/, '')))
  // the word after a colon starts a label again ("Step 1: Sign in")
  return rest.filter((w, i) => !/:$/.test(words[words.indexOf(w) - 1] || ''))
}

describe('the help nav is in sentence case (Q2, P1-35)', () => {
  it('every sidebar label across D.O.G., O.T.T.E.R. and R.A.B.B.I.T.', () => {
    const bad = [...DOG_HELP_SIDEBAR_ITEMS, ...OTTER_HELP_SIDEBAR_ITEMS, ...RABBIT_HELP_SIDEBAR_ITEMS]
      .filter(({ label }) => titleCased(label).length)
      .map(({ label }) => label)
    expect(bad).toEqual([])
  })
  it('every heading the Help page draws on open (the D.O.G. overview) and its tool list', () => {
    const { container } = render(<HelpPage />)
    const texts = [...container.querySelectorAll('h3, h4, nav button')].map((e) => e.textContent.trim()).filter(Boolean)
    expect(texts.length).toBeGreaterThan(4)
    expect(texts.filter((t) => titleCased(t).length)).toEqual([])
    // Q7: the App settings section is called that here too.
    expect(container.textContent).not.toMatch(/System Settings/)
  })
  it('CONTROL: the check catches the labels the pass changed', () => {
    for (const was of ['Basic Workflow', 'Tips & Best Practices', 'Keyboard Shortcuts (Software Type)', '8 Pet Breeds']) {
      expect(titleCased(was).length, was).toBeGreaterThan(0)
    }
    for (const ok of ['Download the Slides extension', 'Step 1: Sign in', 'What is the Nodes page?', 'AI features', 'D.O.G. overview']) {
      expect(titleCased(ok), ok).toEqual([])
    }
  })
})

describe('one measure for every Help section (P1-35), and no 2px edge in its nav (P1-78)', () => {
  const capOf = (el) => {
    for (let n = el; n; n = n.parentElement) if ((n.getAttribute?.('style') || '').includes('--measure-prose-max')) return n
    return null
  }
  it('D.O.G.\'s content (the page Help opens on) sits inside the prose cap', () => {
    const { container } = render(<HelpPage />)
    const heading = [...container.querySelectorAll('h3')].find((h) => /overview/i.test(h.textContent))
    expect(heading, 'D.O.G. overview heading not drawn').toBeTruthy()
    expect(capOf(heading)).not.toBeNull()
    // CONTROL: the nav, outside the content area, is not capped — the check
    // discriminates rather than finding the cap on every element.
    expect(capOf(container.querySelector('nav'))).toBeNull()
  })
  it('the current nav item is marked with the inset ink, not a 2px border', () => {
    const { container } = render(<HelpPage />)
    const current = container.querySelector('nav button[aria-current="page"]')
    expect(current).toBeTruthy()
    const cls = current.getAttribute('class')
    expect(cls).not.toMatch(/(?:^|\s)border-l-2(?:\s|$)/)
    expect(cls).toMatch(/data-\[state=active\]:shadow-\[inset_2px_0_0_0_var\(--color-ink-light\)\]/)
    // CONTROL: the same pattern sees the old class list.
    expect('w-full border-l-2 border-l-transparent').toMatch(/(?:^|\s)border-l-2(?:\s|$)/)
  })
})
