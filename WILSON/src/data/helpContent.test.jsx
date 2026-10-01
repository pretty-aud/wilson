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
//
// Review round two widened three of these guards after finding each narrower
// than its title: the ink check read the first inked ancestor, not the
// nearest ink (R2-01); the case check read colon labels only (R2-02); and
// neither rendered the Help page's own Projects and Wilson pages (R2-03).
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

// No sidebar item reaches a tool's fallback, so the guards render it by name.
const NO_PAGE = 'no-such-page'

// The Help page as a reader meets it: open every tool section and every page
// it lists, and call `visit(where, pane, container)` on each. `pane` is the
// content pane (the prose cap's parent). R1-03's traversal, shared by the
// name, case and ink checks (review round two, R2-02 and R2-03).
function eachHelpPage(visit) {
  const { container } = render(<HelpPage />)
  const nav = container.querySelector('nav')
  const cap = [...container.querySelectorAll('[style]')].find((e) => e.getAttribute('style').includes('--measure-prose-max'))
  const pane = cap.parentElement
  let pages = 0
  for (const section of [...nav.querySelectorAll('button[aria-expanded]')]) {
    if (section.getAttribute('aria-expanded') !== 'true') fireEvent.click(section)
    const panel = container.querySelector(`#${section.getAttribute('aria-controls')}`)
    for (const item of [...(panel?.querySelectorAll('button') || [])]) {
      fireEvent.click(item)
      pages++
      visit(`Help ${section.getAttribute('aria-controls')} "${item.textContent.trim()}"`, pane, container)
    }
  }
  cleanup()
  return pages
}

const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())

describe('the help content is on the tokens, on both surfaces (P1-35)', () => {
  for (const [tool, items, Content, themes] of SURFACES) {
    for (const theme of themes) {
      it(`${tool} ${theme || 'dialog (default)'}: no palette class, no inline hex, no override sheet, on every page and the fallback`, () => {
        const bad = []
        let drawn = 0
        for (const id of [...items.map((i) => i.id), NO_PAGE]) {
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
  it('CONTROL: the fallback is really drawn (review round two: O.T.T.E.R.\'s kept the stone ramp, unrendered)', () => {
    expect(render(<OtterHelpContent helpPage={NO_PAGE} />).container.textContent).toMatch(/Select a topic/)
    cleanup()
    expect(render(<RabbitHelpContent helpPage={NO_PAGE} theme="dark" />).container.textContent).toMatch(/Pick a topic/)
  })
})

// Sentence case (Q2): the first word keeps its capital; after it, only proper
// nouns, acronyms and other products' own names do.
const PROPER = new Set(['D.O.G.', 'O.T.T.E.R.', 'R.A.B.B.I.T.', 'Wilson', 'Slides', 'Google', 'AI', 'Nodes',
  'Midjourney', 'Flux', 'GPT', 'DALL-E', 'Tamagotchi', 'Markdown', 'Windows', 'Mac',
  // key legends ('Shift': the pet's key since post-overhaul S2a, C12)
  'Enter', 'Up/Down', 'Shift',
  // the pet breeds, as src/components/sprites/index.jsx labels them (C5)
  'Otter', 'Bird', 'Octopus', 'Blob', 'Rabbit', 'Pig', 'Monkey'])
// A tool's spelled-out name, a product's two-word name, a page's name as the
// nav writes it, D.O.G.'s layout names as its constants.js writes them, the
// name Help tells the reader to give their Apps Script project, and a name
// another app writes its own way (the Slides extension's two mode buttons,
// in public/extensions/Sidebar.html, which is not ours to edit) are proper.
const PROPER_PHRASES = ['Deck Outline Generator', 'Nano Banana', 'Chat GPT', 'Google Drive', 'Apps Script', 'App settings',
  'Section Header w/Gradient', 'Title Page w/Gradient', 'D.O.G. Bridge', 'Full Deck or Single Page']
function titleCased(label) {
  let text = label
  for (const p of PROPER_PHRASES) text = text.split(p).join('name')
  // A list's own number ("1. Upload documents:") is not the first word.
  const words = text.split(/\s+/).filter(Boolean).filter((w, i) => !(i === 0 && /^\d+[.)]$/.test(w)))
  return words.filter((w, i) => {
    if (i === 0) return false
    // The word after a colon starts a label again ("Step 1: Sign in"), so
    // does each step of a menu path ("Edit menu → Export all", the item as
    // the menu writes it), and so does a parenthesis ("O.T.T.E.R. (Training
    // & education)", the nav's own subtitle; "Difficulty (Low/Medium/High)",
    // the options' names).
    if (/:$/.test(words[i - 1]) || words[i - 1] === '→' || w.startsWith('(')) return false
    const bare = w.replace(/\)+$/, '').replace(/[:,?.]+$/, '')
    return /^[A-Z][a-z]/.test(bare) && !PROPER.has(bare)
  })
}

// Every heading, and every run-in: an element set in the semibold weight
// that holds text of its own. Review round two (R2-02): the first reader took
// only colon labels with no child element, so the "Term — explanation"
// run-ins every help also uses were never read, nor were HelpPage's pages.
function caseReads(root) {
  const els = [...root.querySelectorAll('h3, h4'),
    ...[...root.querySelectorAll('*')].filter((e) => /(?:^|\s)font-semibold(?:\s|$)/.test(e.getAttribute('class') || '') && ownText(e))]
  return [...new Set(els)].map((e) => e.textContent.trim()).filter(Boolean)
}

describe('the help is in sentence case (Q2, P1-35)', () => {
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
  // Review round one, R1-02, widened by round two, R2-02.
  it('every heading and run-in on every page of every help, both surfaces', () => {
    const bad = []
    let read = 0
    for (const [tool, items, Content, themes] of SURFACES) {
      for (const theme of themes) {
        for (const { id } of items) {
          const { container } = render(<Content helpPage={id} theme={theme} />)
          for (const t of caseReads(container)) {
            read++
            if (titleCased(t).length) bad.push(`${tool} ${theme || 'dialog'} ${id}: "${t}"`)
          }
          cleanup()
        }
      }
    }
    // Colon labels alone came to about 100 reads; every run-in is several times that.
    expect(read).toBeGreaterThan(400)
    expect([...new Set(bad)]).toEqual([])
  })
  it('every heading and run-in on every page the Help page shows, its own Projects and Wilson pages included', () => {
    const bad = []
    let read = 0
    const pages = eachHelpPage((where, pane) => {
      for (const t of caseReads(pane)) {
        read++
        if (titleCased(t).length) bad.push(`${where}: "${t}"`)
      }
    })
    expect(pages).toBeGreaterThan(25)
    expect(read).toBeGreaterThan(200)
    expect([...new Set(bad)]).toEqual([])
  })

  it('CONTROL: the check catches the labels the passes changed', () => {
    for (const was of ['Basic Workflow', 'Tips & Best Practices', 'Keyboard Shortcuts (Software Type)', '8 Pet Breeds',
      'Regenerate Page', 'Edit menu → Export All', 'O.T.T.E.R. (Training & Education)', 'Full Deck or Single Page Mode']) {
      expect(titleCased(was).length, was).toBeGreaterThan(0)
    }
    for (const ok of ['Download the Slides extension', 'Step 1: Sign in', 'What is the Nodes page?', 'AI features', 'D.O.G. overview',
      'Full Deck or Single Page mode', 'Edit menu → Export all', 'Toggle in App settings', 'O.T.T.E.R. (Training & education)']) {
      expect(titleCased(ok), ok).toEqual([])
    }
  })
  it('CONTROL: the reader takes a run-in with no colon and one with a child element, and skips unweighted prose', () => {
    const host = document.createElement('div')
    host.innerHTML = '<ul><li>• <span class="text-ink font-semibold">Revision Prompt</span> — Type specific instructions</li></ul>'
      + '<p class="font-semibold">Edit menu → <em>Export All</em></p><p>Plain Prose Is Not Read</p><h4>Key Features</h4>'
    expect(caseReads(host)).toEqual(['Key Features', 'Revision Prompt', 'Edit menu → Export All'])
    expect(caseReads(host).filter((t) => titleCased(t).length)).toHaveLength(3)
  })
})

// Review round one, R1-01: on the light Help page a role that only adds
// weight (em, accent, label, glyph, download) names no ink, and outside a
// list it inherited the app's white: 19 runs at 2.53:1 on the orange.
// Review round two, R2-01: the first guard stopped at the first
// `text-ink-light` (or any `ui-*`) ancestor, so once D.O.G.'s root carried
// the ink, a NEARER wrong ink passed: the dark surface's `text-ink`, white, a
// grey. The rule now: the nearest resting text colour, on the element or an
// ancestor, is the one ink; and a kit part counts only on its light surface
// (a Kbd left dark is the chip its own comment calls a bug).
const NOT_COLOUR = /^text-(?:h1|h2|h3|body|dense|caption|label|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)$/
function inkOf(el) {
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const cls = (n.getAttribute('class') || '').split(/\s+/).filter(Boolean)
    const kit = cls.find((c) => c.startsWith('ui-'))
    if (kit) return n.matches('.ui-kbd[data-surface="light"]') ? 'ui-kbd light' : `${kit}, not on its light surface`
    const ink = cls.find((c) => c.startsWith('text-') && !NOT_COLOUR.test(c))
    if (ink) return ink
  }
  return 'no ink'
}
function inklessText(root) {
  const found = []
  for (const el of root.querySelectorAll('*')) {
    if (!ownText(el)) continue
    const ink = inkOf(el)
    if (ink !== 'text-ink-light' && ink !== 'ui-kbd light') found.push(`${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 40)}" (${ink})`)
  }
  return found
}
const INK = /(?:^|\s)text-ink-light(?:\s|$)/

describe('on the light surface every text takes the one ink (R1-01, R2-01, C6)', () => {
  for (const [tool, items, Content] of SURFACES) {
    it(`${tool} light: every page and the fallback`, () => {
      const bad = []
      for (const id of [...items.map((i) => i.id), NO_PAGE]) {
        const { container } = render(<Content helpPage={id} theme="light" />)
        bad.push(...inklessText(container).map((b) => `${id}: ${b}`))
        cleanup()
      }
      expect(bad).toEqual([])
    })
  }
  // Review round two, R2-03: the Help page's own pages set no root ink, so
  // each text leaned on its role, R1-01's trap. The content pane carries the
  // one ink now, and every page Help can show keeps it.
  it('the Help page: the content pane carries the one ink, and no page it shows sets another', () => {
    const bad = []
    let paneInked = true
    const pages = eachHelpPage((where, pane) => {
      paneInked &&= INK.test(pane.getAttribute('class') || '')
      bad.push(...inklessText(pane).map((b) => `${where}: ${b}`))
    })
    expect(pages).toBeGreaterThan(25)
    expect(paneInked).toBe(true)
    expect(bad).toEqual([])
  })
  it('CONTROL: no ink, a nearer wrong ink, and a kit part left dark are each caught; the one ink and a light Kbd pass', () => {
    const host = document.createElement('div')
    host.innerHTML = '<div><div class="bg-well-light border rounded-control p-3"><p class="text-dense font-semibold">Safe to modify:</p></div></div>'
    expect(inklessText(host)).toEqual(['p "Safe to modify:" (no ink)'])
    host.firstChild.setAttribute('class', 'text-ink-light')
    expect(inklessText(host)).toEqual([])
    // Round two's plant: the root keeps the ink, three roles name a nearer one.
    host.innerHTML = '<div class="text-ink-light"><p class="text-dense text-ink font-semibold">a</p>'
      + '<p class="text-dense text-white font-semibold mb-1">b</p><span class="text-ink-3 text-dense">c</span><p class="text-dense">d</p></div>'
    expect(inklessText(host)).toEqual(['p "a" (text-ink)', 'p "b" (text-white)', 'span "c" (text-ink-3)'])
    host.innerHTML = '<div class="text-ink-light"><kbd class="ui-kbd" data-surface="dark">Ctrl</kbd><kbd class="ui-kbd" data-surface="light">K</kbd></div>'
    expect(inklessText(host)).toEqual(['kbd "Ctrl" (ui-kbd, not on its light surface)'])
    // …and the pane check sees a pane without the ink.
    expect(INK.test('flex-1 overflow-y-auto p-6 bg-ground-light')).toBe(false)
    expect(INK.test('flex-1 overflow-y-auto p-6 bg-ground-light text-ink-light')).toBe(true)
  })
})

// Review round one, R1-03: the old guard read only the page Help opens on,
// so the names it looked for could not have been there. This one opens every
// tool section and every page, and proves it reached the Wilson pages.
describe('the Help page names things as the app does, on every page it can show (Q7, R1-03)', () => {
  it('no "System Settings", "Project Manager" or "Pet Mode ON/OFF" anywhere in Help', () => {
    const seen = []
    eachHelpPage((where, pane, container) => seen.push(container.textContent))
    const all = seen.join('\n')
    // CONTROL: the traversal really reached the Wilson section's pages.
    expect(all).toMatch(/Pet lifecycle/)
    expect(all).toMatch(/About Wilson/)
    for (const old of [/System Settings/, /Project Manager/, /Pet Mode (?:ON|OFF)/]) expect(all).not.toMatch(old)
  })
})

// Post-overhaul S2a (Audrey's C6 and C7): a tool's settings open from the
// gear at the right end of the tool's OWN strip, with Help beside it; the
// WILSON nav strip holds App settings only. Help that sends a reader to the
// nav strip, the hamburger or a timeline header for a tool's settings points
// at a control that no longer opens them.
const THE_GEAR = "the gear at the right end of the tool's strip"
// Every unit of text a reader meets as one — a list item, a paragraph, a
// heading, a table row (its cells together), a term with its description —
// split into sentences. Text nodes are joined with a space, so a key legend
// in one element and its meaning in the next read "Enter Toggle the chat",
// not "EnterToggle the chat"; and a sentence is read whole, in either order,
// at any length (review round 1, G-R1-08: three exact phrases, a 40-character
// window and textContent let real spellings through).
function sentencesOf(root) {
  const text = (el) => {
    const parts = []
    const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType === 3) parts.push(c.textContent); else if (c.nodeType === 1) walk(c) } }
    walk(el)
    return parts.join(' ').replace(/\s+/g, ' ').trim()
  }
  const blocks = []
  for (const tr of root.querySelectorAll('tr')) blocks.push(text(tr))
  for (const dt of root.querySelectorAll('dt')) {
    const dd = dt.nextElementSibling?.tagName === 'DD' ? dt.nextElementSibling : null
    blocks.push(`${text(dt)} ${dd ? text(dd) : ''}`)
  }
  for (const el of root.querySelectorAll('li, p, h1, h2, h3, h4, h5, h6, blockquote, figcaption')) {
    if (!el.closest('tr, dt, dd')) blocks.push(text(el))
  }
  // …and text in any other element (a div, a span) outside those blocks,
  // read from its nearest container that is not an inline run, so a legend
  // in a <kbd> and its meaning in the <span> beside it are one sentence
  // (review round 2, G-R2-04: 34 text nodes in the help were never read).
  const INLINE = new Set(['SPAN', 'KBD', 'STRONG', 'EM', 'B', 'I', 'CODE', 'A', 'SMALL', 'MARK', 'SUB', 'SUP', 'SVG'])
  const BLOCKS = 'tr, dt, dd, li, p, h1, h2, h3, h4, h5, h6, blockquote, figcaption'
  for (const el of root.querySelectorAll('*')) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue
    if (el.closest(BLOCKS)) continue
    let box = el
    while (INLINE.has(box.tagName.toUpperCase()) && box !== root && box.parentElement) box = box.parentElement
    blocks.push(text(box))
  }
  // A sentence ends at . ! or ? and a space — not after "e.g.", "i.e." or "etc.".
  const sentences = blocks.flatMap((b) => b.split(/(?<!\b(?:e\.g|i\.e|etc)\.)(?<=[.!?])\s+/)).map((s) => s.trim()).filter(Boolean)
  return [...new Set(sentences)]
}
/** Every sentence of every page of every tool's help, both surfaces, and of the Help page. */
function allHelpSentences() {
  const out = []
  for (const [tool, items, Content, themes] of SURFACES) {
    for (const theme of themes) {
      for (const { id } of items) {
        const { container } = render(<Content helpPage={id} theme={theme} />)
        out.push(...sentencesOf(container).map((s) => [`${tool} ${theme || 'dialog'} ${id}`, s]))
        cleanup()
      }
    }
  }
  eachHelpPage((where, pane) => out.push(...sentencesOf(pane).map((s) => [where, s])))
  return out
}
// A tool's settings sent anywhere but its own strip: "Tool settings" in any
// case or wrapping, or a sentence that puts "settings" in a shell place (the
// nav strip, the navigation menu, the hamburger, a WILSON menu, a timeline
// header) — App settings excepted, which IS in the menu.
const SHELL_PLACES = /\bnav(?:igation)?\s+strip\b|\bnavigation\s+menu\b|\bhamburger\b|\bWILSON\s+(?:menu|nav)\b|\btimeline\s+header\b/i
const wrongWayToSettings = (s) => /\btool\s+settings\b/i.test(s)
  || (SHELL_PLACES.test(s) && /\bsettings\b/i.test(s) && !/\bApp settings\b/.test(s))
function helpText(Content, items) {
  const seen = []
  for (const { id } of items) {
    seen.push(render(<Content helpPage={id} />).container.textContent)
    cleanup()
  }
  return seen.join('\n')
}
describe('help sends a reader to the gear in the tool\'s own strip (S2a, C6/C7)', () => {
  it('no help, on either surface, names the nav strip, the hamburger or a timeline header as the way to a tool\'s settings', () => {
    const all = allHelpSentences()
    expect(all.length, 'the reader found no sentences').toBeGreaterThan(300)
    expect(all.filter(([, s]) => wrongWayToSettings(s)).map(([w, s]) => `${w}: ${s}`)).toEqual([])
  })
  it('the three passages that did now name the gear: O.T.T.E.R.\'s tip, R.A.B.B.I.T.\'s settings page, the Help page\'s navigation card', () => {
    expect(helpText(OtterHelpContent, OTTER_HELP_SIDEBAR_ITEMS)).toContain(THE_GEAR)
    expect(helpText(RabbitHelpContent, RABBIT_HELP_SIDEBAR_ITEMS)).toContain(THE_GEAR)
    // The Help page's own "Navigation menu" card, read from THAT page's pane:
    // the Help page also draws O.T.T.E.R.'s help, whose tip names the gear,
    // so the whole traversal's text would pass without the card (review of
    // this guard's first cut, a surviving mutant).
    const nav = []
    eachHelpPage((where, pane) => { if (/"Navigation"$/.test(where)) nav.push(pane.textContent) })
    expect(nav, 'the traversal never reached the Navigation page').toHaveLength(1)
    expect(nav[0]).toMatch(/Navigation menu/)
    expect(nav[0]).toContain(THE_GEAR)
    // D.O.G.'s already said it the interface's way.
    expect(helpText(DogHelpContent, DOG_HELP_SIDEBAR_ITEMS)).toContain('The Settings panel (gear icon)')
  })
  it('CONTROL: the old sentences, and the spellings the first cut missed, are caught; the new ones and App settings are not', () => {
    for (const was of [
      'You can customize the generation prompts in the O.T.T.E.R. settings panel (hamburger menu icon).',
      'Click the gear icon in the timeline header (or the settings entry on the WILSON nav strip) to open the slide-out.',
      'Open Tool settings from the menu.',
      'Open tool settings from the menu.',
      'The settings live in the WILSON menu.',
      'Click the gear in the timeline header to change settings.',
    ]) expect(wrongWayToSettings(was), was).toBe(true)
    for (const ok of [
      "Click the gear at the right end of the tool's strip (Help sits beside it) to open the slide-out, from any tab.",
      "A tool's own settings — the gear at the right end of the tool's strip, with Help beside it; the menu holds App settings only",
      'Quick access to Home, other tools, and App settings from any page',
      'Click outside the nav strip to dismiss it',
    ]) expect(wrongWayToSettings(ok), ok).toBe(false)
    // A sentence wrapped over two lines of JSX is read as one.
    const host = document.createElement('div')
    host.innerHTML = '<p>Open Tool\n   settings from the strip.</p>'
    expect(sentencesOf(host).some(wrongWayToSettings)).toBe(true)
  })
})

// Post-overhaul S2a (Audrey's C12): the pet's key is a bare Shift tap, and
// Enter presses whatever has focus. Help that still says Enter opens the pet
// teaches the one key that no longer does it.
// A sentence (sentencesOf) that names Enter and the pet at all — in any
// order, at any distance, with any verb ("Press Enter to talk to your pet"
// passed a verb list: review round 2, G-R2-04). No help sentence today names
// both, so none needs excusing.
const enterOpensPet = (s) => /\benter\b/i.test(s) && /\b(?:chat|companion|pet)\b/i.test(s)
describe('help teaches the pet\'s Shift tap, and never Enter (S2a, C12)', () => {
  it('no help, on either surface, says Enter opens or closes the pet', () => {
    const all = allHelpSentences()
    expect(all.length, 'the reader found no sentences').toBeGreaterThan(300)
    expect(all.filter(([, s]) => enterOpensPet(s)).map(([w, s]) => `${w}: ${s}`)).toEqual([])
  })
  it('the three passages that taught Enter teach the Shift tap', () => {
    const otter = helpText(OtterHelpContent, OTTER_HELP_SIDEBAR_ITEMS)
    expect(otter).toContain('(or tap Shift on its own)')
    expect(otter).toMatch(/Shift — Tap it on its own to toggle companion chat/)
    // The Help page's own "Pet companion" page, read from its own pane.
    const pet = []
    eachHelpPage((where, pane) => { if (/"Pet companion"$/.test(where)) pet.push(pane.textContent) })
    expect(pet, 'the traversal never reached the Pet companion page').toHaveLength(1)
    expect(pet[0]).toMatch(/Tap Shift on its own to toggle the chat window/)
  })
  it('CONTROL: the old sentences and the spellings the first cut missed are caught; the new ones and D.O.G.\'s own Enter keys are not', () => {
    for (const was of [
      'Click the sprite to open/close the chat window (or press Enter)',
      'Enter — Toggle companion chat (when not typing in an input)',
      'Press Enter to toggle the chat window (when not typing in an input)',
      'The chat opens and closes with Enter.',
      'Press Enter, wherever you are in the app and whatever you were doing, to open the pet.',
      'Press Enter to talk to your pet.',
    ]) expect(enterOpensPet(was), was).toBe(true)
    for (const ok of [
      'Click the sprite to open/close the chat window (or tap Shift on its own)',
      'Shift — Tap it on its own to toggle companion chat (not while typing in a field, and not over a dialog)',
      'Enter — Presses the focused button, as anywhere else',
      'Press Enter in the revision prompt field to trigger regeneration quickly',
      'Enter — Go to selected search result',
      'Enter presses the focused button.',
    ]) expect(enterOpensPet(ok), ok).toBe(false)
    // A key legend in one element and its meaning in the next is one row.
    const host = document.createElement('div')
    host.innerHTML = '<dl><dt>Enter</dt><dd>Toggle the companion chat</dd></dl><table><tr><td><kbd>Enter</kbd></td><td>Open the pet</td></tr></table>'
    expect(sentencesOf(host).filter(enterOpensPet).sort()).toEqual(['Enter Open the pet', 'Enter Toggle the companion chat'])
    // A legend and its meaning in plain divs and spans, and "etc." mid-sentence (G-R2-04).
    const loose = document.createElement('div')
    loose.innerHTML = '<div><kbd>Enter</kbd><span>Toggle the companion chat</span></div><div>Hit Enter etc. to open the pet.</div>'
    expect(sentencesOf(loose).filter(enterOpensPet).sort()).toEqual(['Enter Toggle the companion chat', 'Hit Enter etc. to open the pet.'])
  })
})

describe('one measure for every Help section (P1-35), and no 2px edge in its nav (P1-78)', () => {
  const capOf = (el) => {
    for (let n = el; n; n = n.parentElement) if ((n.getAttribute?.('style') || '').includes('--measure-prose-max')) return n
    return null
  }
  // Review round two, R2-04: R1-04 put the Body step on the cap, so its 72ch
  // resolve at 14px (668px) rather than the inherited 16px (764px); removing
  // the class failed nothing.
  const onBodyStep = (cap) => /(?:^|\s)text-body(?:\s|$)/.test(cap?.getAttribute('class') || '')
  it('D.O.G.\'s content (the page Help opens on) sits inside the prose cap, and the cap is on the Body step', () => {
    const { container } = render(<HelpPage />)
    const heading = [...container.querySelectorAll('h3')].find((h) => /overview/i.test(h.textContent))
    expect(heading, 'D.O.G. overview heading not drawn').toBeTruthy()
    expect(capOf(heading)).not.toBeNull()
    expect(onBodyStep(capOf(heading))).toBe(true)
    // CONTROL: the nav, outside the content area, is not capped — the check
    // discriminates rather than finding the cap on every element.
    expect(capOf(container.querySelector('nav'))).toBeNull()
  })
  it('CONTROL: a cap that inherits its size is caught', () => {
    const host = document.createElement('div')
    host.innerHTML = '<div style="max-width: var(--measure-prose-max)"><h3>x</h3></div>'
    expect(onBodyStep(capOf(host.querySelector('h3')))).toBe(false)
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
