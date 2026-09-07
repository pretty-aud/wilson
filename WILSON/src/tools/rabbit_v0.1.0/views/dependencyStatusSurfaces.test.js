// =============================================================================
// dependencyStatusSurfaces.test.js — Phase 7, Track A bundle A2 (2026-09-06).
//
// A source-level guard, in the shape writeGate.test.js established, for the
// Phase 7 brief's central warning: "There are at least seven places a status
// is written, and a warning wired into one of them is worse than none,
// because you will trust it and it will stay silent everywhere else."
//
// Nothing in this repo mounts React, so no runtime test can click a status
// dropdown and watch for the modal. The honest substitute is to assert, in
// the source, that every task- and phase-status write funnel routes through
// useDependencyStatusGuard, and that "done" is defined in exactly one place.
// Each assertion is scoped to the FUNCTION that writes, by brace matching, so
// the file cannot pass because the guard's name appears somewhere else in a
// 2,000-line component.
//
// ── THE SURFACES, enumerated by grep on 2026-09-06 ──────────────────────────
// Wired (each pinned below):
//   ProjectTasksView.jsx   TaskTable.bulkUpdate        — bulk status (one summary)
//   ProjectTasksView.jsx   TaskGroup.handleDrop         — drag a row into a status group
//   ProjectTasksView.jsx   TaskRow.handleUpdate         — inline status dropdown
//   ProjectTasksView.jsx   KanbanColumn.handleDrop      — drag a card into a status column
//   TaskDetailPopup.jsx    handleUpdate                 — the popup's status dropdown
//                          (rendered by the Tasks tab, the Timeline, Scenes,
//                          Levels, Experiences and the Dashboard)
//   ProjectAssetsView.jsx  AssetDetailPopup → TaskRowInPopup — task rows inside an asset
//   TimelineView.jsx       TaskEditor.handleSave        — the phase editor (the only
//                          phase-status surface in the product) and the task form
// Not wired, and why — the brief's failure mode is SILENCE, so these are
// stated rather than skipped:
//   NewTaskPopup.jsx       status on CREATE: the task does not exist yet, so it
//                          has no predecessors. Pinned below as create-only.
//   DashboardTasksView.jsx status select + kanban drop through useMyTasks: the
//                          cross-project task model loads no dependency rows,
//                          so the check has nothing to read (statusWarning
//                          returns null, not a clean bill). docs/OUTSTANDING.md.
//   rabbitAgentTools.js    set_status, AND update_task (an arbitrary patch that
//                          may carry a status): the agent's DiffView approval
//                          is the gate; the person approves the diff first.
//   RelationsPanel.jsx     NewTaskSidePopup's status select is CREATE-only
//                          (no updateTask in the file; pinned below).
//   editHistoryRevert.js   a revert restores an earlier status; interrupting
//                          undo with a warning is not wanted. The provider's
//                          own undo/redo (mutationsRef.current.updateTask with
//                          the old values) is the same case.
//   Assets, scenes, shots, levels, experiences: not endpoints of either
//                          dependency table, so they have no predecessors.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// fileURLToPath, not URL.pathname: a checkout under a path with a space would
// otherwise read as %20 and every readSrc below would fail (R1).
const SRC = fileURLToPath(new URL('../../../', import.meta.url))
const readSrc = (rel) => readFileSync(join(SRC, rel), 'utf8')

const TASKS_VIEW  = readSrc('tools/rabbit_v0.1.0/views/ProjectTasksView.jsx')
const ASSETS_VIEW = readSrc('tools/rabbit_v0.1.0/views/ProjectAssetsView.jsx')
const TIMELINE    = readSrc('tools/rabbit_v0.1.0/views/TimelineView.jsx')
const TASK_POPUP  = readSrc('tools/rabbit_v0.1.0/components/TaskDetailPopup.jsx')
const NEW_TASK    = readSrc('tools/rabbit_v0.1.0/components/NewTaskPopup.jsx')
const RELATIONS   = readSrc('tools/rabbit_v0.1.0/components/RelationsPanel.jsx')

const GUARD_IMPORT = /import \{ useDependencyStatusGuard \} from '[./]*components\/DependencyStatusGuard'/

/** The body of the FIRST `function <name>(` after `from`, by brace matching. */
function functionBody(source, name, from = 0) {
  const start = source.indexOf(`function ${name}(`, from)
  if (start === -1) return null
  // Skip the parameter list by paren matching FIRST: a React component's
  // destructured props `({ tasks, groups })` would otherwise be taken for the
  // body, and every assertion below would run against the props list.
  let pd = 0
  let i = source.indexOf('(', start)
  for (; i < source.length; i++) {
    if (source[i] === '(') pd++
    else if (source[i] === ')') { pd--; if (pd === 0) break }
  }
  const open = source.indexOf('{', i)
  let depth = 0
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++
    else if (source[j] === '}') {
      depth--
      if (depth === 0) return source.slice(open, j + 1)
    }
  }
  return null
}

/** Every `function <name>(` body in the source, in order. */
function functionBodies(source, name) {
  const out = []
  let from = 0
  for (;;) {
    const start = source.indexOf(`function ${name}(`, from)
    if (start === -1) return out
    const body = functionBody(source, name, start)
    if (!body) return out
    out.push(body)
    from = start + body.length
  }
}

describe('every task-status write in the Tasks tab routes through the guard', () => {
  it('imports the guard', () => {
    expect(TASKS_VIEW).toMatch(GUARD_IMPORT)
  })

  it('TaskTable.bulkUpdate warns once for the whole selection', () => {
    const table = functionBody(TASKS_VIEW, 'TaskTable')
    expect(table).toBeTruthy()
    expect(table).toContain('useDependencyStatusGuard(ctx)')
    const bulk = functionBody(table, 'bulkUpdate')
    expect(bulk).toBeTruthy()
    expect(bulk).toContain('guard.update(')
    expect(bulk).toContain('ids')
    expect(table).toContain('{guard.modal}')
  })

  it('both drop targets (row group and kanban column) warn before a status drop lands', () => {
    const drops = functionBodies(TASKS_VIEW, 'handleDrop')
    expect(drops).toHaveLength(2)
    for (const body of drops) {
      expect(body).toContain('buildGroupPatch(')
      expect(body).toContain('guard.update(')
      expect(body).not.toMatch(/^\s*ctx\.updateTask\(taskId, patch\)\s*$/m)
    }
    for (const name of ['TaskGroup', 'KanbanColumn']) {
      const body = functionBody(TASKS_VIEW, name)
      expect(body, `${name} mounts the modal`).toContain('{guard.modal}')
      expect(body, `${name} owns a guard`).toContain('useDependencyStatusGuard(ctx)')
    }
  })

  it('TaskRow.handleUpdate (the inline dropdown funnel) warns', () => {
    const row = functionBody(TASKS_VIEW, 'TaskRow')
    expect(row).toBeTruthy()
    const update = functionBody(row, 'handleUpdate')
    expect(update).toBeTruthy()
    expect(update).toContain('guard.update(')
    expect(row).toContain('{guard.modal}')
  })
})

describe('the shared task popup warns', () => {
  it('routes handleUpdate through the guard and mounts the modal', () => {
    expect(TASK_POPUP).toMatch(GUARD_IMPORT)
    const update = functionBody(TASK_POPUP, 'handleUpdate')
    expect(update).toBeTruthy()
    expect(update).toContain('guard.update(')
    expect(TASK_POPUP).toContain('{guard.modal}')
  })
})

describe('task rows inside an asset warn', () => {
  it('AssetDetailPopup routes its task-row status writes through the guard', () => {
    expect(ASSETS_VIEW).toMatch(GUARD_IMPORT)
    const popup = functionBody(ASSETS_VIEW, 'AssetDetailPopup')
    expect(popup).toBeTruthy()
    expect(popup).toContain('useDependencyStatusGuard(ctx)')
    expect(popup).toMatch(/onUpdateTask=\{\(patch\) => guard\.update\(/)
    expect(popup).toContain('{guard.modal}')
  })
})

describe('the timeline editor warns for phases (and for its task form)', () => {
  it('handleSave checks before performSave writes', () => {
    expect(TIMELINE).toMatch(GUARD_IMPORT)
    const editor = functionBody(TIMELINE, 'TaskEditor')
    expect(editor).toBeTruthy()
    expect(editor).toContain('useDependencyStatusGuard(ctx)')
    const save = functionBody(editor, 'handleSave')
    expect(save).toBeTruthy()
    expect(save).toContain('guard.update(')
    expect(save).toContain("kind: 'phase'")
    expect(save).toContain('performSave')
    expect(functionBody(editor, 'performSave')).toBeTruthy()
    expect(editor).toContain('{guard.modal}')
  })
})

describe('stated non-surfaces', () => {
  it('NewTaskPopup only creates — it has no update path to guard', () => {
    expect(NEW_TASK).not.toContain('updateTask')
  })

  it("RelationsPanel's side popup only creates — the day it gains an update path, wire it", () => {
    expect(RELATIONS).not.toContain('updateTask')
  })
})

describe('"done" is defined in exactly one place', () => {
  function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        if (entry === 'node_modules' || entry === 'dist') continue
        walk(full, out)
      } else if (/\.(js|jsx)$/.test(entry) && !/\.test\.jsx?$/.test(entry)) {
        out.push(full)
      }
    }
    return out
  }

  // Scope, stated: this matches a second copy SHAPED like the old ones (an
  // isDone / isTaskDone function, a *_DONE_STATES set, the literal three-item
  // array). A KPI tile that counts approved + final is a different measure —
  // it leaves omitted out on purpose — and is not a definition of done.
  it('no second isDone-shaped definition exists outside dependencyStatus.js', () => {
    const offenders = []
    for (const file of walk(join(SRC, 'tools/rabbit_v0.1.0'))) {
      if (file.endsWith('dependencyStatus.js')) continue
      const text = readFileSync(file, 'utf8')
      if (/function isDone\(|function isTaskDone\(|DONE_STATES\b|\['approved', 'final', 'omitted'\]/.test(text)) {
        offenders.push(file.slice(SRC.length))
      }
    }
    expect(offenders).toEqual([])
  })

  it('both original consumers import it', () => {
    expect(readSrc('tools/rabbit_v0.1.0/state/selectors.js')).toContain("import { isDone } from './dependencyStatus'")
    expect(readSrc('tools/rabbit_v0.1.0/components/AssetStatusWarningModal.jsx')).toContain("import { isDone } from '../state/dependencyStatus'")
  })
})
