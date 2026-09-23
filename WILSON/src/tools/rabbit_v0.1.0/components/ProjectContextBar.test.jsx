/** @vitest-environment jsdom */
// ProjectContextBar — the two named slots (Q10; B1, 2026-09-23).
//
// Lane B6 removes the Bins footer bar on the strength of this contract: the
// storage adapter dot and the presence pill are docked in the context bar,
// not floating over the view body. If the slots stop rendering, the two
// indicators vanish from every view but Summary and nothing else in the suite
// would notice, because no test mounts Rabbit.jsx.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ctx = {
  project: { id: 'p1', title: 'Salt Hours', status: 'active' },
  projectsIndex: { p1: { id: 'p1', title: 'Salt Hours', status: 'active' } },
  activeProjectId: 'p1',
  setActiveProject: () => {},
}
vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => ctx }))

// eslint-disable-next-line import/first
import ProjectContextBar from './ProjectContextBar'

afterEach(cleanup)

const here = dirname(fileURLToPath(import.meta.url))
const rabbitSrc = readFileSync(resolve(here, '../Rabbit.jsx'), 'utf8').replace(/\r\n/g, '\n')

describe('ProjectContextBar: the two named slots', () => {
  it('renders presence then adapter, each in its named wrapper, before the Switch button', () => {
    const { container } = render(
      <ProjectContextBar presenceSlot={<i data-testid="p">LIVE</i>} adapterSlot={<i data-testid="a" />} />,
    )
    const status = container.querySelector('[data-slot="status"]')
    expect(status).not.toBeNull()
    expect(status.querySelector('[data-slot="presence"] [data-testid="p"]')).not.toBeNull()
    expect(status.querySelector('[data-slot="adapter"] [data-testid="a"]')).not.toBeNull()
    // Order: presence, adapter, then the Switch control.
    const order = [...container.querySelectorAll('[data-testid], button')].map((n) => n.dataset.testid || n.textContent.trim())
    expect(order).toEqual(['p', 'a', 'Switch'])
  })

  it('an empty slot takes no box: the wrappers are display: contents', () => {
    const { container } = render(<ProjectContextBar adapterSlot={<i data-testid="a" />} />)
    for (const w of container.querySelectorAll('[data-slot="presence"], [data-slot="adapter"]')) {
      expect(w.classList.contains('contents')).toBe(true)
    }
  })

  it('with no slots the bar renders no status group at all', () => {
    const { container } = render(<ProjectContextBar />)
    expect(container.querySelector('[data-slot="status"]')).toBeNull()
    expect(container.textContent).toContain('Salt Hours')
  })
})

describe('Rabbit.jsx docks the dot and the pill instead of floating them', () => {
  it('passes both to the context bar', () => {
    expect(rabbitSrc).toMatch(/<ProjectContextBar adapterSlot=\{adapterDot\} presenceSlot=\{presence\} \/>/)
  })

  it('on Summary, where no context bar is drawn, docks them in the tab bar instead (C1: hidden on no view)', () => {
    expect(rabbitSrc).toMatch(/activeView !== 'summary' && \(\s*<ProjectContextBar/)
    expect(rabbitSrc).toMatch(/const statusInTabBar = activeView === 'summary'/)
    expect(rabbitSrc).toMatch(/\{statusInTabBar && \([\s\S]{0,200}\{presence\}[\s\S]{0,120}\{adapterDot\}/)
  })

  it('renders each exactly once per view: no stray floating copy remains', () => {
    expect(rabbitSrc.match(/<AdapterStatusDot /g)).toHaveLength(1)
    expect(rabbitSrc.match(/<RealtimePresenceStrip /g)).toHaveLength(1)
  })

  it('neither component positions itself over the view body any more', () => {
    const dot = rabbitSrc.slice(rabbitSrc.indexOf('function AdapterStatusDot'), rabbitSrc.indexOf('function RealtimePresenceStrip'))
    const strip = rabbitSrc.slice(rabbitSrc.indexOf('function RealtimePresenceStrip'), rabbitSrc.indexOf('function NoProjectPlaceholder'))
    for (const body of [dot, strip]) {
      expect(body).not.toMatch(/\babsolute\b/)
      expect(body).not.toMatch(/\b(left|bottom|zIndex)\s*:/)
    }
  })
})
