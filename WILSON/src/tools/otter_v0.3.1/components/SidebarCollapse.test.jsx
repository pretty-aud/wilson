/** @vitest-environment jsdom */
// =============================================================================
// SidebarCollapse.jsx and the kit Panel's resize, together as Otter.jsx puts
// them (SB1, 2026-11-01). Audrey: "this divider line from the courses sidebar
// and the overall otter window should be expanding by grabbing and putting the
// line to the desired width of the courses sidebar"; the brief: the collapse
// button and its rail keep working, and a collapsed sidebar opened again
// returns to the width it had.
//
// Otter.jsx is one component of some 6,400 lines that no test mounts, so its
// courses column is composed here from the same three pieces —
// useSidebarCollapse, SidebarCollapseButton, SidebarReopenRail — and the kit
// Panel with the props Otter.jsx passes, read from Otter.jsx itself by a parse
// (so the column below cannot drift from the file it stands for). The handle's
// own behaviour is src/ui/Panel.test.jsx's.
// =============================================================================
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parse } from '@babel/parser'
import traverseModule from '@babel/traverse'
import { Panel } from '../../../ui'
import { useSidebarCollapse, SidebarCollapseButton, SidebarReopenRail } from './SidebarCollapse.jsx'

const traverse = traverseModule.default ?? traverseModule
const here = dirname(fileURLToPath(import.meta.url))
const OTTER = readFileSync(resolve(here, '../Otter.jsx'), 'utf8')

/** The courses Panel's props as a file writes them: strings, numbers, and
 *  bare booleans; anything else reads "(expression)". */
function coursesPanelProps(src) {
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] })
  let props = null
  traverse(ast, {
    JSXOpeningElement(p) {
      const n = p.node
      if (props || n.name.name !== 'Panel') return
      const attrs = n.attributes.filter((a) => a.type === 'JSXAttribute')
      if (attrs.find((a) => a.name.name === 'className')?.value?.value !== 'otter-courses') return
      props = Object.fromEntries(attrs.map((a) => {
        const v = a.value
        if (v == null) return [a.name.name, true]
        if (v.type === 'StringLiteral') return [a.name.name, v.value]
        if (v.type === 'JSXExpressionContainer' && v.expression.type === 'NumericLiteral') return [a.name.name, v.expression.value]
        return [a.name.name, '(expression)']
      }))
    },
  })
  return props
}

const COURSES = coursesPanelProps(OTTER)
const WIDTH_KEY = 'otter.sidebar1.width'
const FLAG_KEY = 'otter.sidebar1.collapsed'

/** Otter.jsx's renderSoftwareSidebar, its shell: the rail when collapsed,
 *  else the Panel with Otter.jsx's own props and its collapse button. */
function CoursesColumn({ shortcut = true }) {
  const sidebar1 = useSidebarCollapse(FLAG_KEY, { shortcutEnabled: shortcut })
  if (sidebar1.collapsed) return <SidebarReopenRail onExpand={sidebar1.expand} label="Show courses" />
  const { className, title, actions, ...resize } = COURSES
  return (
    <Panel
      {...resize}
      className={className}
      title={title}
      actions={<SidebarCollapseButton onCollapse={sidebar1.toggle} label="Hide courses" />}
    >
      <div className="otter-course-list">courses</div>
    </Panel>
  )
}

const handle = () => document.querySelector('aside.otter-courses > [role="separator"]')
const size = () => document.querySelector('aside.otter-courses')?.style.getPropertyValue('--ui-panel-size') ?? null
const dragBy = (dx, { up = true } = {}) => {
  fireEvent.pointerDown(handle(), { pointerId: 1, button: 0, isPrimary: true, clientX: 200 })
  fireEvent.pointerMove(handle(), { pointerId: 1, clientX: 200 + dx })
  if (up) fireEvent.pointerUp(handle(), { pointerId: 1, clientX: 200 + dx })
}

beforeEach(() => { localStorage.clear() })
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
  document.documentElement.removeAttribute('data-ui-resizing')
})

describe('O.T.T.E.R.\'s courses Panel, as Otter.jsx writes it', () => {
  it('is the kit Panel sm, titled Courses, resizable 180 to 480, the row keeping 720, remembered beside the collapse flag', () => {
    expect(COURSES).toEqual({
      width: 'sm', className: 'otter-courses', title: 'Courses', actions: '(expression)',
      resizable: true, storageKey: WIDTH_KEY, minWidth: 180, maxWidth: 480, minBeside: 720,
    })
    expect(OTTER).toContain(`useSidebarCollapse('${FLAG_KEY}', {`)
  })

  it('CONTROL: the parse sees a dropped resizable, another key and a moved limit', () => {
    const one = '<Panel width="sm" className="otter-courses" title="Courses" resizable storageKey="otter.sidebar1.width" minWidth={180} maxWidth={480} minBeside={720}>x</Panel>'
    const read = (s) => coursesPanelProps(`const x = ${s}`)
    expect(read(one)).toMatchObject({ resizable: true, storageKey: WIDTH_KEY, minWidth: 180 })
    expect(read(one.replace(' resizable', ''))).not.toHaveProperty('resizable')
    expect(read(one.replace('otter.sidebar1.width', 'otter.width')).storageKey).toBe('otter.width')
    expect(read(one.replace('{480}', '{600}')).maxWidth).toBe(600)
    expect(read(one.replace('className="otter-courses"', 'className="otter-lessons"'))).toBe(null)
  })
})

describe('the collapse and the resize, together (SB1)', () => {
  it('a width chosen survives a collapse: the rail as it was, no handle on it, and the Panel back at that width', () => {
    render(<CoursesColumn />)
    expect(size()).toBe('200px')
    dragBy(100)
    expect([size(), localStorage.getItem(WIDTH_KEY)]).toEqual(['300px', '300'])
    fireEvent.click(screen.getByRole('button', { name: 'Hide courses' }))
    const rail = screen.getByRole('button', { name: 'Show courses' })
    expect(rail.className).toBe('otter-rail')
    expect(rail.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('[role="separator"]')).toBe(null)
    expect([localStorage.getItem(FLAG_KEY), localStorage.getItem(WIDTH_KEY)]).toEqual(['1', '300'])
    fireEvent.click(rail)
    expect([size(), handle().getAttribute('aria-valuenow'), localStorage.getItem(FLAG_KEY)]).toEqual(['300px', '300', '0'])
  })

  it('resizing never writes the collapse flag, and the collapse never writes the width', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    render(<CoursesColumn />)
    dragBy(60)
    fireEvent.keyDown(handle(), { key: 'ArrowRight' })
    fireEvent.doubleClick(handle())
    expect(setItem.mock.calls.map(([k]) => k)).not.toContain(FLAG_KEY)
    setItem.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Hide courses' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show courses' }))
    expect(setItem.mock.calls.map(([k]) => k)).toEqual([FLAG_KEY, FLAG_KEY])
  })

  it('Ctrl+\\ still collapses and reopens; a collapse mid-drag hands the page back and keeps the width last chosen', () => {
    render(<CoursesColumn />)
    dragBy(48)
    expect(size()).toBe('248px')
    dragBy(150, { up: false })
    expect(document.documentElement.hasAttribute('data-ui-resizing')).toBe(true)
    fireEvent.keyDown(window, { key: '\\', ctrlKey: true })
    expect(screen.getByRole('button', { name: 'Show courses' })).toBeTruthy()
    expect(document.documentElement.hasAttribute('data-ui-resizing')).toBe(false)
    fireEvent.keyDown(window, { key: '\\', ctrlKey: true })
    expect([size(), localStorage.getItem(WIDTH_KEY)]).toEqual(['248px', '248'])
  })

  it('a width kept from an earlier visit is the first one drawn, collapsed or not', () => {
    localStorage.setItem(WIDTH_KEY, '264')
    render(<CoursesColumn />)
    expect(size()).toBe('264px')
    cleanup()
    localStorage.setItem(FLAG_KEY, '1')
    render(<CoursesColumn />)
    expect(handle()).toBe(null)
    fireEvent.click(screen.getByRole('button', { name: 'Show courses' }))
    expect(size()).toBe('264px')
  })
})
