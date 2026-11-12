// MO3 (0127): where a typed link, a "Mentioned in" entry or a note's dot opens, by the events M.O.T.H.'s jumps send
// (tools/moth_v0.1.0/state/mothJumps.js):
//   wilson:open-rabbit-item     { projectId, kind, id }  a project, phase, asset, task, scene, shot, level or
//                                                       experience, in R.A.B.B.I.T., on its project (a folder opens
//                                                       its project)
//   wilson:open-project-file    { projectId, fileId }   a file, in R.A.B.B.I.T.'s Files
//   wilson:open-dashboard-note  { noteId }              a note, on the Dashboard's Notes tab
// The shell goes to the tool (App.jsx); the tool opens the thing. The Dashboard may not be on screen when a note is
// asked for, so the request also waits here until it is taken (takePendingNote).

export const OPEN_RABBIT_ITEM = 'wilson:open-rabbit-item'
export const OPEN_PROJECT_FILE = 'wilson:open-project-file'
export const OPEN_DASHBOARD_NOTE = 'wilson:open-dashboard-note'

const RABBIT_KINDS = new Set(['project', 'phase', 'asset', 'task', 'scene', 'shot', 'level', 'experience'])

export const KIND_WORDS = Object.freeze({
  project: 'Project', folder: 'Folder', file: 'File', phase: 'Phase', asset: 'Asset', task: 'Task',
  scene: 'Scene', shot: 'Shot', level: 'Level', experience: 'Experience', note: 'Note',
})

let pendingNote = null

/** A note asked for, kept until the Notes tab takes it. */
export function openDashboardNote(noteId, target = typeof window !== 'undefined' ? window : null) {
  if (!noteId) return
  pendingNote = noteId
  target?.dispatchEvent(new CustomEvent(OPEN_DASHBOARD_NOTE, { detail: { noteId } }))
}

/** Whether a note waits to be opened, without taking it: the Dashboard opens on its Notes tab then. */
export function peekPendingNote() {
  return pendingNote
}

/** The note waiting to be opened, once: the Dashboard takes it when it mounts or hears the event. */
export function takePendingNote() {
  const id = pendingNote
  pendingNote = null
  return id
}

/**
 * How a linked thing opens, or null when nothing opens it. `thing` is a link end as the reads give it:
 * { kind, target_id | id, project_id }.
 */
export function linkedThingOpener(thing, target = typeof window !== 'undefined' ? window : null) {
  const kind = thing?.kind
  const id = thing?.target_id ?? thing?.id
  const projectId = thing?.project_id ?? null
  if (!kind || !id) return null
  const send = (type, detail) => () => target?.dispatchEvent(new CustomEvent(type, { detail }))
  if (kind === 'note') return () => openDashboardNote(id, target)
  if (!projectId) return null
  if (kind === 'file') return send(OPEN_PROJECT_FILE, { projectId, fileId: id })
  if (kind === 'folder') return send(OPEN_RABBIT_ITEM, { projectId, kind: 'project', id: projectId })
  if (RABBIT_KINDS.has(kind)) return send(OPEN_RABBIT_ITEM, { projectId, kind, id })
  return null
}
