// mothJumps.js — MO2: opening a thing in its own tool, after a short question (her ruling, the brief §12a.4).
//
// WILSON had one cross-tool event (wilson:open-otter-course). Moth adds two, each with its destination's handler:
//   wilson:open-rabbit-item  { projectId, kind, id }   a project, phase, asset, task, scene, shot, level or experience
//                                                      opens in R.A.B.B.I.T., on its project, at its own tab
//   wilson:open-project-file { projectId, fileId }     a file opens in R.A.B.B.I.T.'s Files, selected
// Notes and courses are not dots yet (Session 3 brings workspace notes), so wilson:open-dashboard-note waits for
// them and wilson:open-otter-course stays the Dashboard's.
export const OPEN_RABBIT_ITEM = 'wilson:open-rabbit-item'
export const OPEN_PROJECT_FILE = 'wilson:open-project-file'
export const JUMP_WORDS = Object.freeze({ rabbit: 'R.A.B.B.I.T.', files: 'Files in R.A.B.B.I.T.' })
const RABBIT_KINDS = new Set(['project', 'phase', 'asset', 'task', 'scene', 'shot', 'level', 'experience'])

/** Where a dot can be opened, or null. `go()` sends the event; the page asks first. */
export function mothJump(node, { target = typeof window !== 'undefined' ? window : null } = {}) {
  if (!node || !node.projectId || node.rowId == null) return null
  const send = (type, detail) => () => target?.dispatchEvent(new CustomEvent(type, { detail }))
  if (node.kind === 'file') {
    return { tool: 'files', label: 'Open in Files', go: send(OPEN_PROJECT_FILE, { projectId: node.projectId, fileId: node.rowId }) }
  }
  if (RABBIT_KINDS.has(node.kind)) {
    return { tool: 'rabbit', label: 'Open in R.A.B.B.I.T.', go: send(OPEN_RABBIT_ITEM, { projectId: node.projectId, kind: node.kind, id: node.rowId }) }
  }
  return null
}
