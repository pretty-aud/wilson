/** @vitest-environment jsdom */
// =============================================================================
// AnswerLink.test.jsx — D3 (night 7, 2026-10-29; docs/design/
// RECONNECT_DESIGN.md §14.3; OUTSTANDING D2-06): on the web a web link in the
// pet's answer or an O.T.T.E.R. lesson opens in a new tab, and WILSON's tab
// stays.
//
// Measured on the tip bb14b169 (session-c, headless Chromium): both answers'
// web links had no target and no rel, and a click replaced WILSON's tab. Three
// parts, through the real code: the component (what each kind of address
// gets); the component inside react-markdown with remark-gfm, as the answers
// render them (an email address becomes a mailto: link; an untrusted scheme is
// emptied); the real PetCompanion with a canned answer, both of its
// renderers, and O.T.T.E.R.'s lesson renderer, parsed (its components hold the
// component). The desktop keeps its own route: electron/windowGuard.cjs sends
// a new window for a web address to the system browser
// (src/lib/windowGuard.test.js, unchanged).
// =============================================================================

import { describe, it, expect, afterEach, beforeAll } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'
import AnswerLink, { linkKind, opensInANewTab } from './AnswerLink'
import PetCompanion from './PetCompanion'

afterEach(cleanup)
beforeAll(() => {
  // jsdom has no scrollIntoView; the chat scrolls its last message into view.
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
})

const here = dirname(fileURLToPath(import.meta.url))
const WEB = 'https://d3-made-up.invalid/answer-link'
const own = () => window.location.origin

/** The one link a render drew, or the span that stands for one. */
const anchor = (container) => container.querySelector('a')

describe('D3 — opensInANewTab: an absolute web address on another origin, and nothing else', () => {
  it('http and https on another origin, a protocol-relative address included (it leaves the page as surely)', () => {
    expect(opensInANewTab(WEB, 'http://127.0.0.1:60598')).toBe(true)
    expect(opensInANewTab('http://d3-made-up.invalid/x', 'https://beta.example.invalid')).toBe(true)
    expect(opensInANewTab('//d3-made-up.invalid/x', 'https://beta.example.invalid/wilson/')).toBe(true)
    expect(opensInANewTab('//beta.example.invalid/wilson/x', 'https://beta.example.invalid/wilson/')).toBe(false)
  })
  it('never an email address, a relative address, a fragment, the page\'s own origin, an untrusted scheme or nothing', () => {
    for (const href of ['mailto:d3@example.invalid', '/wilson/', 'lesson-2', '#section', 'javascript:alert(1)', 'data:text/html,x', 'tel:+15550100', '', null, undefined]) {
      expect(opensInANewTab(href, 'http://127.0.0.1:60598'), String(href)).toBe(false)
    }
    expect(opensInANewTab('http://127.0.0.1:60598/api/rabbit/x', 'http://127.0.0.1:60598')).toBe(false)
  })
  it('reads the page\'s origin when it is not given', () => {
    expect(opensInANewTab(`${own()}/somewhere`)).toBe(false)
    expect(opensInANewTab(WEB)).toBe(true)
  })
})

describe('D3 — linkKind: a new tab, the plain anchor, or text, decided by the component itself (build review round 1, F3)', () => {
  const PAGE = 'http://127.0.0.1:60598/'
  it('another origin: a new tab; an email address, a relative address, a fragment, the page\'s own origin: the plain anchor', () => {
    expect(linkKind(WEB, PAGE)).toBe('tab')
    expect(linkKind('//d3-made-up.invalid/x', PAGE)).toBe('tab')
    for (const href of ['mailto:d3@example.invalid', '/wilson/', '#section', 'lesson-2', 'http://127.0.0.1:60598/projects']) expect(linkKind(href, PAGE), href).toBe('link')
  })
  it('every other scheme, an emptied address, nothing and junk: text, never a live anchor (javascript: and data: whatever renderer the component is given to)', () => {
    for (const href of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,<p>x</p>', 'blob:http://127.0.0.1:60598/x', 'tel:+15550100', 'irc://irc.example.invalid/x', 'xmpp:d3@example.invalid', 'file:///C:/x', 'ms-settings:privacy', '', undefined, null, 'http://[']) {
      expect(linkKind(href, PAGE), String(href)).toBe('text')
    }
  })
})

describe('D3 — AnswerLink: what each address is drawn as', () => {
  it('a web address on another origin: a new tab, no opener, no referrer', () => {
    const a = anchor(render(<AnswerLink href={WEB}>the Electron website</AnswerLink>).container)
    expect(a.getAttribute('href')).toBe(WEB)
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    expect(a.textContent).toBe('the Electron website')
  })
  it('a protocol-relative address (//elsewhere): a new tab too, read against the page\'s own address', () => {
    const a = anchor(render(<AnswerLink href="//d3-made-up.invalid/x">elsewhere</AnswerLink>).container)
    expect(a.getAttribute('href')).toBe('//d3-made-up.invalid/x')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
  })
  it('an email address, a relative address, a fragment and the page\'s own origin: the plain anchor, as before', () => {
    for (const href of ['mailto:d3@example.invalid', '/wilson/?x=1', '#section', `${own()}/projects`]) {
      cleanup()
      const a = anchor(render(<AnswerLink href={href}>x</AnswerLink>).container)
      expect(a.getAttribute('href'), href).toBe(href)
      expect(a.hasAttribute('target'), href).toBe(false)
      expect(a.hasAttribute('rel'), href).toBe(false)
    }
  })
  it('a javascript: or data: address handed to it directly (no react-markdown in front): its text, never a live anchor', () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,<script>x</script>']) {
      cleanup()
      const { container } = render(<AnswerLink href={href}>a trap</AnswerLink>)
      expect(container.querySelector('a'), href).toBeNull()
      expect(container.textContent).toBe('a trap')
    }
  })
  it('an address react-markdown emptied, or none: its text, never an anchor that reloads WILSON\'s page', () => {
    for (const href of ['', undefined]) {
      cleanup()
      const { container } = render(<AnswerLink href={href}>looks like a link</AnswerLink>)
      expect(container.querySelector('a'), String(href)).toBeNull()
      expect(container.querySelector('span').textContent).toBe('looks like a link')
    }
  })
  it('react-markdown\'s node never reaches the anchor; a title and the children are kept, and its own target and rel win', () => {
    const node = { type: 'element', tagName: 'a', properties: { href: WEB } }
    const a = anchor(render(<AnswerLink node={node} href={WEB} title="the site" target="_self" rel="opener"><b>bold</b></AnswerLink>).container)
    expect(a.hasAttribute('node')).toBe(false)
    expect(a.getAttribute('title')).toBe('the site')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    expect(a.querySelector('b').textContent).toBe('bold')
  })
})

describe('D3 — inside react-markdown, as the answers render them', () => {
  const md = '[the Electron website](https://d3-made-up.invalid/x), write to d3@example.invalid, and [a trap](javascript:alert(1)).'
  it('the web link opens a new tab; the email address stays a plain mailto: link; the emptied one is text', () => {
    const { container } = render(<ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: AnswerLink }}>{md}</ReactMarkdown>)
    const links = [...container.querySelectorAll('a')]
    expect(links.map((a) => [a.getAttribute('href'), a.getAttribute('target'), a.getAttribute('rel')])).toEqual([
      ['https://d3-made-up.invalid/x', '_blank', 'noopener noreferrer'],
      ['mailto:d3@example.invalid', null, null],
    ])
    expect(container.textContent).toContain('a trap')
    for (const a of links) expect(a.hasAttribute('node')).toBe(false)
  })
  it('the CONTROL: react-markdown\'s own anchor, without the component, has no target (the tip\'s answers, measured)', () => {
    const { container } = render(<ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>)
    expect(container.querySelector('a').hasAttribute('target')).toBe(false)
  })
})

describe('D3 — the pet\'s answers, both renderers (the real PetCompanion)', () => {
  const noop = () => {}
  const pet = (content) => render(
    <PetCompanion
      petData={{ name: 'Ollie', form: 'adult', breed: 'otter', state: 'content', petMode: true, hunger: 80, happiness: 80 }}
      companionOpen
      onCompanionToggle={noop}
      chatMessages={[{ role: 'user', content: 'link me' }, { role: 'assistant', content }]}
      chatInput="" onChatInputChange={noop} onSendChat={noop} onClearChat={noop}
      onThumbRating={noop} onFeed={noop} onPetAction={noop}
    />,
  )
  it('a plain answer: its web link opens a new tab, its email address stays plain', () => {
    const { container } = pet(`Here: [the Electron website](${WEB}). Or write to d3@example.invalid.`)
    const links = [...container.querySelectorAll('.companion-chat-md a')]
    expect(links.map((a) => [a.getAttribute('target'), a.getAttribute('rel')])).toEqual([['_blank', 'noopener noreferrer'], [null, null]])
  })
  it('an answer with a [[nav:…]] button (the renderer agent mode shares): the same', () => {
    const { container } = pet(`Open [[nav:rabbit:timeline|the timeline]] or read [the Electron website](${WEB}).`)
    expect(container.querySelector('.companion-chat-md button').textContent).toBe('the timeline')
    const a = container.querySelector('.companion-chat-md a')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
  })
})

describe('D3 — O.T.T.E.R.\'s lesson renderer, parsed: its components hold the component', () => {
  const src = readFileSync(resolve(here, '../tools/otter_v0.3.1/Otter.jsx'), 'utf8')
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] })
  const found = []
  const walk = (n) => {
    if (!n || typeof n.type !== 'string') return
    if (n.type === 'JSXElement' && n.openingElement.name.name === 'ReactMarkdown') {
      const attr = n.openingElement.attributes.find((a) => a.name?.name === 'components')
      const obj = attr?.value?.expression
      const a = obj?.type === 'ObjectExpression' ? obj.properties.find((p) => p.key?.name === 'a') : null
      found.push(a ? a.value?.name ?? null : null)
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'extra' || k.endsWith('Comments')) continue
      const v = n[k]
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v.type === 'string') walk(v)
    }
  }
  walk(ast.program)
  it('the one ReactMarkdown in Otter.jsx draws its links with AnswerLink, imported from the shared component', () => {
    expect(found).toEqual(['AnswerLink'])
    expect(src).toContain("import AnswerLink from '../../components/AnswerLink';")
  })
})
