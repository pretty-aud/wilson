/** @vitest-environment jsdom */
// ProjectContextBar — what the bar holds (Q10, B1 2026-09-23; FX11 2026-10-16).
//
// Since FX11 (Audrey: "the project bar has three green dots and its
// confusing. remove the live and additional green dot. just leave the icons
// that appear for users"; "i just want the project status there on that bar
// next to project name. leave to the right the switch dropdown"): the
// project's name and status on the left; the faces of who else has the
// project open, then Switch, on the right. No LIVE / Sync pill, no adapter
// dot — the connection is ONE dot in the shell's bottom-left corner
// (ConnectionDot.jsx; its own test). No test mounts Rabbit.jsx, so the
// shell's half is pinned on its source below.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'
import { addLeaveGuard, _resetLeaveGuardsForTests } from '../state/leaveGuard'
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

describe('ProjectContextBar (FX11): the name and status left; the faces, then Switch, right', () => {
  const rightOf = (container) => container.querySelector('.ui-toolbar.rb-ctx > .ui-toolbar-slot:last-child')
  it('the right holds the faces in their wrapper, then Switch, and nothing else', () => {
    const { container } = render(<ProjectContextBar presenceSlot={<i data-testid="p" />} />)
    const right = rightOf(container)
    expect(right.querySelector('[data-slot="presence"] [data-testid="p"]')).not.toBeNull()
    const order = [...right.querySelectorAll('[data-testid], button')].map((n) => n.dataset.testid || n.textContent.trim())
    expect(order).toEqual(['p', 'Switch'])
  })

  it('the right draws no status of its own: no pill, no dot, no adapter slot', () => {
    const { container } = render(<ProjectContextBar presenceSlot={<i data-testid="p" />} />)
    const right = rightOf(container)
    expect(right.querySelector('.ui-status, .ui-status-dot, [data-slot="adapter"], [data-slot="status"]')).toBeNull()
    expect(right.textContent).not.toMatch(/\b(Live|Sync)\b/i)
    // The left keeps the project's status beside its name (her "project
    // status there on that bar next to project name").
    const left = container.querySelector('.ui-toolbar.rb-ctx > .ui-toolbar-slot:first-child')
    expect([...left.querySelectorAll('.ui-status')].map((s) => s.textContent)).toEqual(['Active'])
  })

  it('the faces wrapper takes no box (display: contents); with no faces there is no wrapper at all', () => {
    const { container } = render(<ProjectContextBar presenceSlot={<i data-testid="p" />} />)
    expect(container.querySelector('[data-slot="presence"]').classList.contains('contents')).toBe(true)
    const bare = render(<ProjectContextBar />)
    expect(bare.container.querySelector('[data-slot="presence"]')).toBeNull()
    expect(bare.container.textContent).toContain('Salt Hours')
  })

  it('the bar takes no adapter slot any more (an adapterSlot prop is ignored)', () => {
    const { container } = render(<ProjectContextBar adapterSlot={<i data-testid="a" />} />)
    expect(container.querySelector('[data-testid="a"]')).toBeNull()
    expect(readFileSync(resolve(here, 'ProjectContextBar.jsx'), 'utf8')).not.toMatch(/adapterSlot/)
  })
})

// Post-overhaul FX7 (Audrey, 2026-10-12: "bid ver and project should be same
// sizing and color. if anything project should stand out more. lets remove
// the folder icon before the word project"). The two labels' one class and
// one column, measured against the Timeline's bar, are timelineVersions.test
// .jsx's and rabbitTimelineCss.test.js's; this is the title bar's own half.
describe('FX7: PROJECT is the kit\'s label, first on the gutter, with no icon before it', () => {
  const leftOf = (container) => container.querySelector('.ui-toolbar.rb-ctx > .ui-toolbar-slot:first-child')
  // Each child's tag, class, words and inline style (none: review round 1,
  // R1-01 — a style on the label or the name would undo the column unseen).
  const shape = (left) => [...left.children].map((n) => [n.tagName.toLowerCase(), n.getAttribute('class'), n.textContent, n.getAttribute('style')])
  it('the left slot is PROJECT (the kit\'s label, nothing else on it), the name at the Title step, the status — and no icon anywhere in it', () => {
    const { container } = render(<ProjectContextBar />)
    const left = leftOf(container)
    expect(shape(left)).toEqual([
      ['span', 'ui-field-label', 'Project', null],
      ['span', 'rb-ctx-title text-h3', 'Salt Hours', null],
      ['span', 'ui-status', 'Active', null],
    ])
    expect(left.querySelector('svg')).toBeNull()
  })
  it('with no project the label still comes first, with nothing before it', () => {
    const was = { project: ctx.project, id: ctx.activeProjectId }
    ctx.project = null
    ctx.activeProjectId = null
    try {
      const { container } = render(<ProjectContextBar />)
      expect(shape(leftOf(container))).toEqual([
        ['span', 'ui-field-label', 'Project', null],
        ['span', 'rb-ctx-title text-body', 'No project selected', null],
      ])
      expect(leftOf(container).querySelector('svg')).toBeNull()
    } finally {
      ctx.project = was.project
      ctx.activeProjectId = was.id
    }
  })
  it('the source keeps no folder icon and no eyebrow of its own', () => {
    const src = readFileSync(resolve(here, 'ProjectContextBar.jsx'), 'utf8')
    expect(src).not.toMatch(/\bFolder\b/)
    expect(src).not.toMatch(/rb-ctx-(icon|eyebrow)/)
    expect(src).toContain('<span className="ui-field-label">Project</span>')
  })
})

describe('Rabbit.jsx (FX11): the faces on the bar, one connection dot in the corner', () => {
  it('passes the faces, and only the faces, to the context bar', () => {
    expect(rabbitSrc).toMatch(/<ProjectContextBar presenceSlot=\{presence\} \/>/)
    expect(rabbitSrc).not.toMatch(/adapterSlot|adapterDot|AdapterStatusDot/)
  })

  it('on Summary, where no context bar is drawn, docks the faces alone in the tab bar (C1: hidden on no view)', () => {
    expect(rabbitSrc).toMatch(/activeView !== 'summary' && \(\s*<ProjectContextBar/)
    expect(rabbitSrc).toMatch(/const statusInTabBar = activeView === 'summary'/)
    // On Summary the compact strip (three faces and "+N"; R2 finding 3), and
    // nothing else in its wrapper.
    expect(rabbitSrc).toMatch(/\{statusInTabBar && \(\s*<span className="rb-tabbar-status" data-slot="presence">\{presenceCompact\}<\/span>\s*\)\}/)
  })

  it('the faces carry no LIVE / Sync pill: the strip draws no StatusBadge and says neither word', () => {
    const strip = rabbitSrc.slice(rabbitSrc.indexOf('function RealtimePresenceStrip'), rabbitSrc.indexOf('function NoProjectPlaceholder'))
    expect(strip.length).toBeGreaterThan(200)
    expect(strip).not.toMatch(/StatusBadge|StatusDot/)
    expect(strip).not.toMatch(/'Live'|'Sync'|Sync error/)
    expect(rabbitSrc).not.toMatch(/import \{ StatusBadge \}|import \{ StatusDot \}/)
  })

  it('renders each once: one strip per dock, one connection dot for every tab', () => {
    // `presence` for the context bar, `presenceCompact` for Summary's tab strip —
    // the two docks are never on screen together (activeView decides).
    expect(rabbitSrc.match(/<RealtimePresenceStrip /g)).toHaveLength(2)
    expect(rabbitSrc.match(/\{presence\}|presenceSlot=\{presence\}/g)).toHaveLength(1)
    expect(rabbitSrc.match(/\{presenceCompact\}/g)).toHaveLength(1)
    expect(rabbitSrc.match(/<ConnectionDot /g)).toHaveLength(1)
    // Outside the view body (so every tab has it, Summary included) and never
    // behind a view or project condition.
    const body = rabbitSrc.indexOf('role="tabpanel"')
    const at = rabbitSrc.indexOf('<ConnectionDot ')
    const bodyEnd = rabbitSrc.indexOf('{/* ── Settings slide-out')
    expect(at).toBeGreaterThan(body)
    expect(at).toBeLessThan(bodyEnd)
    expect(rabbitSrc).toMatch(/\n {6}<ConnectionDot active=\{currentPage === 'rabbit'\} \/>/)
  })

  it('the faces strip never positions itself over the view body', () => {
    const strip = rabbitSrc.slice(rabbitSrc.indexOf('function RealtimePresenceStrip'), rabbitSrc.indexOf('function NoProjectPlaceholder'))
    expect(strip).not.toMatch(/\babsolute\b/)
    expect(strip).not.toMatch(/\b(left|bottom|zIndex)\s*:/)
  })
})

// Post-overhaul S3c, step 7 (D12): another project is an exit.
describe('S3c step 7: switching project asks first while work is unsaved', () => {
  afterEach(() => _resetLeaveGuardsForTests())
  it('Keep editing stays where it is; going on switches; the project already open asks nothing', async () => {
    const was = { index: ctx.projectsIndex, set: ctx.setActiveProject }
    ctx.projectsIndex = { ...was.index, p2: { id: 'p2', title: 'Pier', status: 'active' } }
    ctx.setActiveProject = vi.fn()
    const answer = { go: false }
    const ask = vi.fn(async () => answer.go)
    addLeaveGuard({ order: 2, applies: (r) => r === 'project', dirty: () => true, ask })
    try {
      const { getByRole } = render(<ProjectContextBar />)
      const pick = async (title) => {
        fireEvent.click(getByRole('button', { name: /^Switch/ }))
        await act(async () => { fireEvent.click(getByRole('button', { name: new RegExp(`^${title}`) })) })
      }
      await pick('Pier')
      expect(ask).toHaveBeenCalledWith('project')
      expect(ctx.setActiveProject).not.toHaveBeenCalled()
      answer.go = true
      await pick('Pier')
      expect(ctx.setActiveProject).toHaveBeenCalledWith('p2')
      ask.mockClear()
      await pick('Salt Hours')
      expect(ask).not.toHaveBeenCalled()
    } finally {
      ctx.projectsIndex = was.index
      ctx.setActiveProject = was.set
    }
  })
})
