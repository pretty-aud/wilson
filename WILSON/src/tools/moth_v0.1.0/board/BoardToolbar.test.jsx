// @vitest-environment jsdom
// BoardToolbar.test.jsx — MO4 boards: the tools, the shape picker (it takes Escape first), undo and redo, zoom; a
// read-only board offers only what does not write; larger targets under a finger or a pen. Also the board folder's
// source rule: Konva is imported only by BoardCanvas.jsx, which the panel reaches through React.lazy.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import BoardToolbar, { FILE_ACTIONS, TOOLS, actionForKey, toolForKey } from './BoardToolbar.jsx'
import { SHAPES, SHAPE_LABELS } from './shapes.js'

afterEach(cleanup)

function fakeEscape() {
  const stack = []
  return {
    stack,
    push: vi.fn((fn) => { stack.push(fn); return () => { const i = stack.indexOf(fn); if (i >= 0) stack.splice(i, 1) } }),
    press() { for (let i = stack.length - 1; i >= 0; i -= 1) if (stack[i]()) return true; return false },
  }
}

const mount = (props = {}) => {
  const all = { tool: 'select', shape: 'rectangle', onTool: vi.fn(), onShape: vi.fn(), canWrite: true, onUndo: vi.fn(), onRedo: vi.fn(), onZoomIn: vi.fn(), onZoomOut: vi.fn(), onFit: vi.fn(), ...props }
  const out = render(<BoardToolbar {...all} />)
  return { ...out, props: all, again: (more) => out.rerender(<BoardToolbar {...all} {...more} />) }
}

describe('BoardToolbar', () => {
  it('offers every tool, each named with its key', () => {
    const { props } = mount()
    for (const t of TOOLS) expect(screen.getByTitle(`${t.label} (${t.key.toUpperCase()})`)).toBeTruthy()
    fireEvent.click(screen.getByTitle('Pen (P)'))
    expect(props.onTool).toHaveBeenCalledWith('pen')
    expect(screen.getByTitle('Select (V)').getAttribute('aria-pressed')).toBe('true')
  })

  it('the picker shows the nineteen shapes; a pick takes the shape tool and closes', () => {
    const { props } = mount()
    fireEvent.click(screen.getByTitle('Choose a shape'))
    const picker = screen.getByRole('group', { name: 'Shapes' })
    expect(picker.querySelectorAll('[data-shape]')).toHaveLength(SHAPES.length)
    for (const s of SHAPES) expect(screen.getByTitle(SHAPE_LABELS[s])).toBeTruthy()
    fireEvent.click(screen.getByTitle('Speech bubble'))
    expect(props.onShape).toHaveBeenCalledWith('speech_bubble')
    expect(props.onTool).toHaveBeenCalledWith('shape')
    expect(screen.queryByRole('group', { name: 'Shapes' })).toBeNull()
  })

  it('while the picker is open it takes Escape first, and lets go when it closes', () => {
    const escape = fakeEscape()
    mount({ escape })
    expect(escape.stack).toHaveLength(0)
    fireEvent.click(screen.getByTitle('Choose a shape'))
    expect(escape.stack).toHaveLength(1)
    act(() => { expect(escape.press()).toBe(true) })
    expect(screen.queryByRole('group', { name: 'Shapes' })).toBeNull()
    expect(escape.stack).toHaveLength(0)
  })

  it('a press elsewhere closes the picker', () => {
    mount()
    fireEvent.click(screen.getByTitle('Choose a shape'))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('group', { name: 'Shapes' })).toBeNull()
  })

  it('undo and redo follow the store; zoom says where it is', () => {
    const { props, again } = mount({ zoom: 0.5 })
    expect(screen.getByTitle('Undo').disabled).toBe(true)
    expect(screen.getByTitle('Redo').disabled).toBe(true)
    again({ canUndo: true })
    fireEvent.click(screen.getByTitle('Undo'))
    expect(props.onUndo).toHaveBeenCalled()
    expect(document.querySelector('[data-zoom]').textContent).toBe('50%')
    fireEvent.click(screen.getByTitle('Zoom in'))
    fireEvent.click(screen.getByTitle('Zoom out'))
    fireEvent.click(screen.getByTitle('Show the whole board'))
    expect(props.onZoomIn).toHaveBeenCalled()
    expect(props.onZoomOut).toHaveBeenCalled()
    expect(props.onFit).toHaveBeenCalled()
  })

  it('a board this person may only read offers only Select and Move around', () => {
    const { props } = mount({ canWrite: false, tool: 'pen' })
    expect(screen.getByTitle('Select (V)')).toBeTruthy()
    expect(screen.getByTitle('Move around (H)')).toBeTruthy()
    for (const t of TOOLS.filter((x) => x.writes)) expect(screen.queryByTitle(`${t.label} (${t.key.toUpperCase()})`)).toBeNull()
    expect(screen.queryByTitle('Undo')).toBeNull()
    // A writing tool in hand when the board turned read-only goes back to Select.
    expect(props.onTool).toHaveBeenCalledWith('select')
  })

  it('a single key picks a tool; a read-only board only the ones that do not write', () => {
    expect(toolForKey('V', true)).toBe('select')
    expect(toolForKey('n', true)).toBe('sticky')
    expect(toolForKey('l', true)).toBe('connector')
    expect(toolForKey('p', false)).toBeNull()
    expect(toolForKey('h', false)).toBe('hand')
    expect(toolForKey('q', true)).toBeNull()
    expect(toolForKey(undefined, true)).toBeNull()
  })

  it('"Picture or file" and "Embed a file" act at once; the embed list says whether it is open', () => {
    const onPickFiles = vi.fn()
    const onEmbed = vi.fn()
    const { again } = mount({ onPickFiles, onEmbed })
    const group = screen.getByRole('group', { name: 'Add a file' })
    expect([...group.querySelectorAll('[data-action]')].map((b) => b.getAttribute('data-action'))).toEqual(['media', 'embed'])
    fireEvent.click(screen.getByTitle('Picture or file (I)'))
    expect(onPickFiles).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTitle('Embed a file (E)'))
    expect(onEmbed).toHaveBeenCalledTimes(1)
    const embed = screen.getByTitle('Embed a file (E)')
    expect(embed.getAttribute('aria-expanded')).toBe('false')
    expect(embed.hasAttribute('data-board-embed-toggle')).toBe(true)
    expect(screen.getByTitle('Picture or file (I)').hasAttribute('data-board-embed-toggle')).toBe(false)
    again({ onPickFiles, onEmbed, embedOpen: true })
    expect(screen.getByTitle('Embed a file (E)').getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTitle('Embed a file (E)').getAttribute('aria-pressed')).toBe('true')
    // Neither is a tool in hand: the tool stays as it was.
    expect(screen.getByTitle('Select (V)').getAttribute('aria-pressed')).toBe('true')
  })

  it('a board this person may only read offers neither file action; their keys pick nothing there', () => {
    mount({ canWrite: false })
    expect(screen.queryByRole('group', { name: 'Add a file' })).toBeNull()
    for (const a of FILE_ACTIONS) expect(screen.queryByTitle(`${a.label} (${a.key.toUpperCase()})`)).toBeNull()
    expect(actionForKey('i', false)).toBeNull()
    expect(actionForKey('e', false)).toBeNull()
    expect(actionForKey('I', true)).toBe('media')
    expect(actionForKey('e', true)).toBe('embed')
    expect(actionForKey('v', true)).toBeNull()
    expect(actionForKey(undefined, true)).toBeNull()
    // No key is two things.
    const keys = [...TOOLS, ...FILE_ACTIONS].map((t) => t.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  describe('the background', () => {
    const bg = (more = {}) => mount({ canSetBackground: true, background: 'dots', onBackground: vi.fn(), ...more })
    const list = () => screen.queryByRole('group', { name: 'Board background' })
    const toggle = () => document.querySelector('[data-board-background-toggle]')

    it('"Background" in the foot bar opens the three choices, each a drawn swatch and its name, the current one pressed', () => {
      bg({ background: 'lines' })
      expect(toggle().closest('[data-moth-board-view]')).toBeTruthy()
      expect(toggle().getAttribute('title')).toBe('Background')
      expect(toggle().getAttribute('aria-expanded')).toBe('false')
      expect(list()).toBeNull()
      fireEvent.click(toggle())
      expect(toggle().getAttribute('aria-expanded')).toBe('true')
      const picker = list()
      expect(picker.hasAttribute('data-board-background-picker')).toBe(true)
      const choices = [...picker.querySelectorAll('[data-background]')]
      expect(choices.map((c) => c.getAttribute('data-background'))).toEqual(['dots', 'blank', 'lines'])
      expect(choices.map((c) => c.textContent)).toEqual(['Dotted grid', 'Blank', 'Lined grid'])
      expect(choices.map((c) => c.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true'])
      // Each swatch draws its own pattern: dots, nothing, lines.
      expect(choices[0].querySelectorAll('svg[data-swatch="dots"] circle').length).toBeGreaterThan(0)
      expect(choices[1].querySelectorAll('svg[data-swatch="blank"] circle, svg[data-swatch="blank"] line')).toHaveLength(0)
      expect(choices[2].querySelectorAll('svg[data-swatch="lines"] line').length).toBeGreaterThan(0)
    })

    it('a choice is handed on and closes the list; the current one again asks nothing', () => {
      const { props } = bg()
      fireEvent.click(toggle())
      fireEvent.click(screen.getByText('Lined grid'))
      expect(props.onBackground).toHaveBeenCalledWith('lines')
      expect(list()).toBeNull()
      fireEvent.click(toggle())
      fireEvent.click(screen.getByText('Dotted grid'))
      expect(props.onBackground).toHaveBeenCalledTimes(1)
      expect(list()).toBeNull()
    })

    it('takes Escape first while open, before anything under it, and lets go when it closes', () => {
      const escape = fakeEscape()
      const under = vi.fn(() => true)
      escape.push(under)
      bg({ escape })
      fireEvent.click(toggle())
      expect(escape.stack).toHaveLength(2)
      act(() => { expect(escape.press()).toBe(true) })
      expect(list()).toBeNull()
      expect(under).not.toHaveBeenCalled()
      expect(escape.stack).toHaveLength(1)
    })

    it('a press elsewhere closes it; a press on its own button only toggles it', () => {
      bg()
      fireEvent.click(toggle())
      fireEvent.pointerDown(toggle())
      expect(list()).toBeTruthy()
      fireEvent.pointerDown(document.body)
      expect(list()).toBeNull()
    })

    it('not offered to a person who may only read, nor where the server does not know backgrounds', () => {
      const { again } = bg({ canWrite: false })
      expect(toggle()).toBeNull()
      again({ canWrite: true, canSetBackground: false })
      expect(toggle()).toBeNull()
      again({ canWrite: true, canSetBackground: true })
      fireEvent.click(toggle())
      expect(list()).toBeTruthy()
      // Taken away while open: gone, and not open again when offered again.
      again({ canWrite: false, canSetBackground: true })
      expect(list()).toBeNull()
      again({ canWrite: true, canSetBackground: true })
      expect(list()).toBeNull()
    })

    it('larger targets under a finger or a pen', () => {
      const { again } = bg({ inputMode: 'mouse' })
      expect(toggle().getAttribute('data-size')).toBe('sm')
      fireEvent.click(toggle())
      expect(list().querySelector('[data-background]').getAttribute('data-size')).toBe('sm')
      again({ inputMode: 'touch' })
      expect(toggle().getAttribute('data-size')).toBe('md')
      expect(list().querySelector('[data-background]').getAttribute('data-size')).toBe('md')
    })
  })

  it('larger targets under a finger or a pen', () => {
    const { again } = mount({ inputMode: 'mouse' })
    expect(screen.getByTitle('Pen (P)').getAttribute('data-size')).toBe('sm')
    again({ inputMode: 'touch' })
    expect(screen.getByTitle('Pen (P)').getAttribute('data-size')).toBe('md')
    expect(document.querySelector('[data-moth-board-tools]').getAttribute('data-input')).toBe('touch')
  })
})

describe('🚨 Konva stays in the board\'s own chunk', () => {
  const dir = path.join(process.cwd(), 'src', 'tools', 'moth_v0.1.0', 'board')
  const KONVA = /(?:from\s*|import\s*\(?\s*)['"]konva(?:\/[^'"]*)?['"]/
  const mine = ['shapes.js', 'connectors.js', 'snapping.js', 'background.js', 'BoardToolbar.jsx', 'StylePanel.jsx', 'EmbedPicker.jsx', 'BoardCanvas.jsx']
  it('only BoardCanvas.jsx imports Konva; the geometry and the panels stay free of it', () => {
    const importing = mine.filter((f) => KONVA.test(fs.readFileSync(path.join(dir, f), 'utf8')))
    expect(importing).toEqual(['BoardCanvas.jsx'])
  })
  it('the scan bites', () => {
    expect(KONVA.test("import Konva from 'konva'")).toBe(true)
    expect(KONVA.test("import { Rect } from 'konva/lib/shapes/Rect'")).toBe(true)
    expect(KONVA.test("const k = await import('konva')")).toBe(true)
    expect(KONVA.test("import x from './konvaish.js'")).toBe(false)
  })
  it('none of them reads the catalogue directly (Moth\'s source rule)', () => {
    const FORBIDDEN = /\.from\(\s*['"](?:projects|files|folders)['"]|\b(?:listPersonalSpaces|listFiles|listFolders|listManagedFiles|loadProject|listProjects|listProjectMembers|projectsIndex)\b/
    expect(mine.filter((f) => FORBIDDEN.test(fs.readFileSync(path.join(dir, f), 'utf8')))).toEqual([])
  })
})
