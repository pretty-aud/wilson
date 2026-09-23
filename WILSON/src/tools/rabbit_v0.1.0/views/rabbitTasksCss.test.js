// =============================================================================
// rabbitTasks.css — the guards for lane B2's stylesheet (UI overhaul B2,
// 2026-09-23). Pattern: rabbitShellCss.test.js, whose scanners this file
// imports rather than re-types (T2 hand-off §5 trap 8).
//
// Pinned here:
//   1. the @layer statement comes first (a component-imported sheet can be
//      emitted before index.css; a layer named late loses to preflight);
//   2. every file that owns a class here imports the sheet;
//   3. every `rb-task-` / `rb-tpl-` class is declared AND used, and every
//      [data-x="v"] a rule matches is a value the JSX can produce;
//   4. no rule loses a fight it cannot see (a kit rule of equal weight, or a
//      utility on the same element);
//   5. the state extraction holds: in every B2 file already extracted, no
//      inline `style` or className decides a visual property by state.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  cssCode, jsCode, unreachableAttributeValues, weakAgainstKit, utilityConflicts, inlineStateTernaries,
} from '../rabbitCssGuards.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, rel), 'utf8').replace(/\r\n/g, '\n')

const sheet = read('rabbitTasks.css')

/** B2's four files, relative to this directory. */
const FILES = {
  tasks: 'ProjectTasksView.jsx',
  detail: '../components/TaskDetailPopup.jsx',
  create: '../components/NewTaskPopup.jsx',
  templates: '../../../components/TaskTemplates/TaskTemplateManager.jsx',
}
/** The files whose state extraction has landed (one commit per component). */
const EXTRACTED = ['tasks', 'detail', 'create', 'templates']

const source = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, read(f)]))
const jsx = Object.values(source).map(jsCode).join('\n')

const PREFIX = /(?<![\w.-])rb-(?:task|tpl)-[a-z0-9-]+/g
const declared = new Set((cssCode(sheet).match(/\.rb-(?:task|tpl)-[a-z0-9-]+/g) || []).map((s) => s.slice(1)))
const used = new Set(jsx.match(PREFIX) || [])

describe('rabbitTasks.css declares the cascade layer order before it uses a layer', () => {
  it('names all four layers, in Tailwind order, as a statement, before the first @layer block', () => {
    const src = cssCode(sheet)
    const statement = src.search(/@layer\s+theme\s*,\s*base\s*,\s*components\s*,\s*utilities\s*;/)
    const firstBlock = src.search(/@layer\s+components\s*\{/)
    expect(statement).toBeGreaterThanOrEqual(0)
    expect(statement).toBeLessThan(firstBlock)
  })
})

describe('every B2 file that wears a class from the sheet imports it', () => {
  for (const [key, file] of Object.entries(FILES)) {
    const wears = PREFIX.test(jsCode(source[key])); PREFIX.lastIndex = 0
    if (!wears) continue
    it(`${file} imports rabbitTasks.css`, () => {
      expect(jsCode(source[key])).toMatch(/import\s+['"][./]*(?:views\/|tools\/rabbit_v0\.1\.0\/views\/)?rabbitTasks\.css['"]/)
    })
  }
})

describe('every rb-task- / rb-tpl- class is both declared and used', () => {
  it('no rule without a caller', () => {
    expect([...declared].filter((c) => !used.has(c))).toEqual([])
  })
  it('no class without a rule', () => {
    expect([...used].filter((c) => !declared.has(c))).toEqual([])
  })
})

describe('the sheet keys on values the JSX can produce, and loses no fight', () => {
  it('no [data-x="v"] rule waits for a value nobody sets', () => {
    expect(unreachableAttributeValues(sheet, jsx)).toEqual([])
  })
  it('a rule on an element that also wears .ui-input / .ui-btn outranks the kit for the same property', () => {
    expect(weakAgainstKit(sheet, jsx)).toEqual([])
  })
  it('no rule sets a property that a utility on the same element also sets', () => {
    expect(utilityConflicts(sheet, jsx)).toEqual([])
  })
})

describe('the state extraction holds in every extracted B2 file', () => {
  for (const key of EXTRACTED) {
    it(`${FILES[key]}: no inline style or className decides a visual property by state`, () => {
      expect(inlineStateTernaries(source[key])).toEqual([])
    })
  }
  it('CONTROL: the scanner still fires on the shapes ProjectTasksView shipped (one line put back)', () => {
    const mutants = [
      // the checkbox's reveal, as an inline ternary
      source.tasks.replace("data-checked={isSelected ? 'all' : 'none'}", "style={{ opacity: isSelected ? 1 : 0 }}"),
      // a group's drop highlight, as it was
      source.tasks.replace("data-drag-over={dragOver ? 'true' : 'false'}>", "style={{ boxShadow: dragOver ? 'inset 3px 0 0 #ea580c' : 'none' }}>"),
      // the draggable cursor, as a template literal
      source.tasks.replace('className="rb-task-row rb-task-drop"', "className={`rb-task-row ${canWrite ? 'cursor-grab' : ''}`}"),
    ]
    for (const m of mutants) {
      expect(m).not.toBe(source.tasks)
      expect(inlineStateTernaries(m)).not.toEqual([])
    }
  })
  it('CONTROL: …and on the shapes TaskDetailPopup shipped', () => {
    const mutants = [
      // a property field's empty ink, as it was
      source.detail.replace("data-empty={task.phase_id ? 'false' : 'true'}", "style={{ color: task.phase_id ? '#f4a261' : '#57534e' }}"),
      // the priority's tone, as an inline colour picked by a call
      source.detail.replace(
        "data-tone={priorityTone(task.priority || 'medium')}>",
        "style={{ color: priorityColor(task.priority) }}>",
      ),
    ]
    for (const m of mutants) {
      expect(m).not.toBe(source.detail)
      expect(inlineStateTernaries(m)).not.toEqual([])
    }
  })
  it('CONTROL: …and on the shapes the template manager shipped', () => {
    const mutants = [
      // the scope checkbox's fill, as it was
      source.templates.replace("data-checked={isProjectSpecific ? 'true' : 'false'}", "style={{ backgroundColor: isProjectSpecific ? '#ea580c' : 'transparent' }}"),
      // the read-only cursor, as it was
      source.templates.replace("data-empty={value ? 'false' : 'true'}>", "style={{ cursor: readOnly ? 'default' : 'pointer' }}>"),
    ]
    for (const m of mutants) {
      expect(m).not.toBe(source.templates)
      expect(inlineStateTernaries(m)).not.toEqual([])
    }
  })
})
