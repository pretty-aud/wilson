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
import { render, cleanup, fireEvent } from '@testing-library/react'
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
const PROPER = new Set(['D.O.G.', 'O.T.T.E.R.', 'R.A.B.B.I.T.', 'Wilson', 'Slides', 'Google', 'AI', 'Nodes',
  'Midjourney', 'Flux', 'GPT', 'DALL-E', 'Tamagotchi'])
// A tool's spelled-out name, and a product's two-word name, are proper nouns.
const PROPER_PHRASES = ['Deck Outline Generator', 'Nano Banana', 'Chat GPT']
function titleCased(label) {
  let text = label
  for (const p of PROPER_PHRASES) text = text.split(p).join('name')
  // A list's own number ("1. Upload documents:") is not the first word.
  const words = text.replace(/[()]/g, ' ').split(/\s+/).filter(Boolean).filter((w, i) => !(i === 0 && /^\d+[.)]$/.test(w)))
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
  })
  // Review round one, R1-02: the run-in labels ("Safe to modify:") are not
  // the Label step (13px/600), so Q2 holds for them; the first pass read only
  // headings. Every page of every help, on both surfaces.
  it('every heading and run-in label on every page of every help, both surfaces', () => {
    const bad = []
    let read = 0
    for (const [tool, items, Content, themes] of SURFACES) {
      for (const theme of themes) {
        for (const { id } of items) {
          const { container } = render(<Content helpPage={id} theme={theme} />)
          const runIns = [...container.querySelectorAll('h3, h4, p, span, div')]
            .filter((e) => /\bfont-semibold\b/.test(e.getAttribute('class') || '') && /:$/.test(e.textContent.trim()) && e.children.length === 0)
          for (const e of [...container.querySelectorAll('h3, h4'), ...runIns]) {
            const t = e.textContent.trim()
            read++
            if (titleCased(t).length) bad.push(`${tool} ${theme || 'dialog'} ${id}: "${t}"`)
          }
          cleanup()
        }
      }
    }
    expect(read).toBeGreaterThan(100)
    expect([...new Set(bad)]).toEqual([])
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

// Review round one, R1-01: on the light Help page a role that only adds
// weight (em, accent, label, glyph, download) names no ink, and outside a
// list it inherited the app's white — 19 runs at 2.53:1 on the orange. On a
// light surface every text must sit under the one ink: `text-ink-light` on
// itself or on an ancestor inside the rendered help.
function inklessText(container) {
  const found = []
  for (const el of container.querySelectorAll('*')) {
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    if (!ownText) continue
    let inked = false
    for (let n = el; n && n !== container.parentElement; n = n.parentElement) {
      const cls = n.getAttribute?.('class') || ''
      // The one ink, or a kit part (`ui-*`: Kbd, Badge…), whose own sheet
      // sets its ink per surface.
      if (/(?:^|\s)(?:text-ink-light|ui-[a-z-]+)(?:\s|$)/.test(cls)) { inked = true; break }
    }
    if (!inked) found.push(`${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 40)}"`)
  }
  return found
}

describe('on the light surface every text sits under the one ink (R1-01, C6)', () => {
  for (const [tool, items, Content] of SURFACES) {
    it(`${tool} light: every page`, () => {
      const bad = []
      for (const { id } of items) {
        const { container } = render(<Content helpPage={id} theme="light" />)
        bad.push(...inklessText(container).map((b) => `${id}: ${b}`))
        cleanup()
      }
      expect(bad).toEqual([])
    })
  }
  it('CONTROL: a weight-only role in a card with no ink is caught; the same under an inked root passes', () => {
    const host = document.createElement('div')
    host.innerHTML = '<div><div class="bg-well-light border rounded-control p-3"><p class="text-dense font-semibold">Safe to modify:</p></div></div>'
    expect(inklessText(host)).toEqual(['p "Safe to modify:"'])
    host.firstChild.setAttribute('class', 'text-ink-light')
    expect(inklessText(host)).toEqual([])
  })
})

// Review round one, R1-03: the old guard read only the page Help opens on,
// so the names it looked for could not have been there. This one opens every
// tool section and every page, and proves it reached the Wilson pages.
describe('the Help page names things as the app does, on every page it can show (Q7, R1-03)', () => {
  it('no "System Settings", "Project Manager" or "Pet Mode ON/OFF" anywhere in Help', () => {
    const { container } = render(<HelpPage />)
    const seen = []
    const nav = container.querySelector('nav')
    for (const section of [...nav.querySelectorAll('button[aria-expanded]')]) {
      if (section.getAttribute('aria-expanded') !== 'true') fireEvent.click(section)
      const panel = container.querySelector(`#${section.getAttribute('aria-controls')}`)
      for (const item of [...(panel?.querySelectorAll('button') || [])]) {
        fireEvent.click(item)
        seen.push(container.textContent)
      }
    }
    const all = seen.join('\n')
    // CONTROL: the traversal really reached the Wilson section's pages.
    expect(all).toMatch(/Pet lifecycle/)
    expect(all).toMatch(/About Wilson/)
    for (const old of [/System Settings/, /Project Manager/, /Pet Mode (?:ON|OFF)/]) expect(all).not.toMatch(old)
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
