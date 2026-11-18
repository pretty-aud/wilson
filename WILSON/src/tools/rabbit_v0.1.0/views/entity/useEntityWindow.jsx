// =============================================================================
// useEntityWindow — what a scene's, a shot's, a level's or an experience's
// window does, written once (post-overhaul F10, rabbit A1).
//
// The scene and shot windows (ScenesView) and the Levels/Experiences window
// (EntityListView) each wrote this, and a fix to one (focus, Escape, the
// discard question) was made two or three times. Each window keeps its own
// markup and classes (its suites and its sheet pin them); this hook is its
// behaviour:
//  · the description's and the notes' drafts, each following the saved words
//    while closed or untouched (useSavedDraft, R1-06), and focus back to their
//    words when an edit closes (useFocusBack, R2-05);
//  · `asks` — D21's question: closing with a changed description or notes
//    open (or a half-typed new task, S3b-05) asks "Discard your changes?"
//    first, Cancel focused; Escape in a changed box asks; an exit that would
//    take the window away (the tab strip, a project switch, a jump to another
//    row's window: the leave guard, S3b-08) asks. ON for scenes and shots.
//    OFF for levels and experiences: their suite pins today's behaviour (the
//    text goes without a word), and whether they should ask is Audrey's to
//    say (asked in F10's chat; OUTSTANDING F10-02). 🚨 A window wires all of
//    it whichever it is — `requestClose` on its Dialog and Close, `questions`
//    drawn, `escapeDraft` on its boxes' Escape, `setTaskDirty` on its task
//    form — so turning it on is the one word: a leave guard that asks with no
//    question drawn holds every exit until the window goes (review round 1,
//    1E-01);
//  · the opener (what opened the window, captured in render, as the kit
//    Dialog captures it) handed to a delete asked from the window;
//  · the thumbnail's two writers (entityThumbnail.js, the desktop channels);
//  · a write refused for a seat that may not write, in every funnel.
// What a task created from the window links to, and the task form's open
// state, stay in the window's own component: the gates' suite pins them there.
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { useSavedDraft, useFocusBack } from '../../../../ui'
import { useLeaveGuard } from '../scenes/useLeaveGuard'
import ListConfirm from '../scenes/ListConfirm'
import { pickEntityThumbnail, clearEntityThumbnail } from './entityThumbnail'

/** The exits that would take a window (and its typed text) away: leaving the tab, a project switch, another row's window. */
export const WINDOW_EXITS = ['tab', 'project', 'popup']

/** D21's words: which draft would go. `what` is 'close', 'description' or 'notes'. */
export function discardWords(what, dirty) {
  const parts = what === 'close'
    ? [dirty.description && 'the description', dirty.notes && 'the notes', dirty.task && 'the new task'].filter(Boolean)
    : [what === 'notes' ? 'the notes' : 'the description']
  const list = parts.length > 2 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts.join(' and ')
  // S3c (S3b-05): a task is created, not saved — the way back is to it.
  const back = what === 'close' && dirty.task ? 'go back to it' : 'go back and Save it'
  return `What you typed in ${list} is not saved. Discard it, or ${back}.`
}

/**
 * @param {object} p
 * @param {object|null} p.row       the thing, or null (gone: the window draws nothing)
 * @param {string} p.kind           'scene' | 'shot' | 'level' | 'experience' (the thumbnail channel's entityType)
 * @param {Function} p.update       (patch) => the kind's writer
 * @param {boolean} p.canWrite      the seat may write the thing
 * @param {Function} p.onClose
 * @param {Function} p.onRequestDelete  the view's question, asked with `deleteTarget(row, opener)`
 * @param {Function} p.deleteTarget
 * @param {Function} [p.onThumbChanged]
 * @param {boolean} [p.taskOpen]    the window's task form is open
 * @param {boolean} [p.asks]        D21's question (above)
 * @param {string} [p.say]          the console's word for a failed thumbnail ('scene')
 */
export function useEntityWindow({ row, kind, update, canWrite, onClose, onRequestDelete, deleteTarget, onThumbChanged, taskOpen = false, asks = true, say = null }) {
  const [editingDesc, setEditingDesc] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)
  const [descDraft, setDescDraft] = useSavedDraft(row?.description || '', editingDesc)
  const [notesDraft, setNotesDraft] = useSavedDraft(row?.notes || '', editingNotes)
  const descWordsRef = useFocusBack(editingDesc)
  const notesWordsRef = useFocusBack(editingNotes)
  const [nestedTaskId, setNestedTaskId] = useState(null)
  const [nestedAssetId, setNestedAssetId] = useState(null)
  // D21: the draft a question is about — 'close' (the window), 'description'
  // or 'notes' (Escape in its box) — while it asks.
  const [askDiscard, setAskDiscard] = useState(null)
  // S3c step 7 (S3b-05, S3b-08): the task form's typed work counts as the
  // window's, and an exit that would take the window away asks first.
  const [taskDirty, setTaskDirty] = useState(false)
  const [leaveAsk, setLeaveAsk] = useState(null)
  const dirtyRef = useRef(false)
  useLeaveGuard({ order: 1, reasons: WINDOW_EXITS, dirty: () => dirtyRef.current, ask: () => new Promise(resolve => setLeaveAsk({ resolve })) })
  // Review round 1 (R1-10): the thing gone under an open question (deleted
  // elsewhere) — it can never be answered here: the exit stays, the question
  // goes, and the leave guard's lock is let go.
  useEffect(() => {
    if (!row && leaveAsk) { leaveAsk.resolve(false); setLeaveAsk(null) }
  }, [row, leaveAsk])
  // What opened this window — a row's Open — captured in render, as the kit
  // Dialog captures it (an effect would read the window's own focus).
  const openerRef = useRef(null)
  if (openerRef.current === null && typeof document !== 'undefined') openerRef.current = document.activeElement

  // D21: a draft that differs from what is saved, in an open editor — and
  // (S3b-05) a task form with anything typed or chosen in it.
  const dirty = {
    description: editingDesc && descDraft !== (row?.description || ''),
    notes: editingNotes && notesDraft !== (row?.notes || ''),
    task: taskOpen && taskDirty,
  }
  dirtyRef.current = !!row && asks && (dirty.description || dirty.notes || dirty.task)
  /** The kit Dialog's onBeforeClose (Escape, ✕, the backdrop) and Close: ask first when a draft would go. */
  const requestClose = () => {
    if (!dirtyRef.current) return true
    setAskDiscard('close')
    return false
  }
  const discard = (what) => {
    setAskDiscard(null)
    if (what === 'close') { onClose(); return }
    if (what === 'description') { setDescDraft(row?.description || ''); setEditingDesc(false) }
    else { setNotesDraft(row?.notes || ''); setEditingNotes(false) }
  }
  /** Escape in the description's or the notes' box (D21): asks first where the window asks and the box is changed; else the draft goes, as Cancel. */
  const escapeDraft = (what) => {
    if (asks && dirty[what]) setAskDiscard(what)
    else discard(what)
  }

  function handleUpdate(patch) { return canWrite ? update(patch) : undefined }
  function handleSetThumbnail() {
    return pickEntityThumbnail({ canWrite, entityType: kind, entityId: row?.id, update: handleUpdate, onChanged: onThumbChanged, say })
  }
  function handleClearThumbnail() {
    return clearEntityThumbnail({ canWrite, entityType: kind, entityId: row?.id, update: handleUpdate, onChanged: onThumbChanged })
  }
  /** Delete, asked from the window: the window closes and the view's question opens, handed the opener. */
  function requestDelete() {
    if (!canWrite || !row) return
    onClose()
    onRequestDelete(deleteTarget(row, openerRef.current))
  }

  const questions = (
    <>
      {/* D21: the draft question, over the window. */}
      {askDiscard && (
        <ListConfirm title="Discard your changes?" confirmLabel="Discard"
          onCancel={() => setAskDiscard(null)} onConfirm={async () => discard(askDiscard)}>
          {discardWords(askDiscard, dirty)}
        </ListConfirm>
      )}
      {/* S3c step 7: the same question when an exit would take the window
          away (S3b-08); Cancel stays, Discard lets the exit go on. */}
      {leaveAsk && (
        <ListConfirm title="Discard your changes?" confirmLabel="Discard"
          onCancel={() => { setLeaveAsk(null); leaveAsk.resolve(false) }}
          onConfirm={async () => { setLeaveAsk(null); leaveAsk.resolve(true) }}>
          {discardWords('close', dirty)}
        </ListConfirm>
      )}
    </>
  )

  return {
    editingDesc, setEditingDesc, editingNotes, setEditingNotes,
    descDraft, setDescDraft, notesDraft, setNotesDraft, descWordsRef, notesWordsRef,
    nestedTaskId, setNestedTaskId, nestedAssetId, setNestedAssetId,
    setTaskDirty, setAskDiscard, dirty, requestClose, escapeDraft,
    handleUpdate, handleSetThumbnail, handleClearThumbnail, requestDelete,
    openerRef, questions,
  }
}
