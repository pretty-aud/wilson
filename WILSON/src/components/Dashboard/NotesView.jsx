// ============================================================
// WILSON Dashboard — Notes (Session 8; UI overhaul C2)
// ============================================================
//
// Per-user private rich-text notes. TipTap v3 (StarterKit — headings, bold,
// underline, bullet lists, links included) with the note BODY backed by a
// Yjs document (locked decision #6: Yjs for long-form text ONLY, here and
// nowhere else). Persistence is snapshot-merge-write via noteSync — two
// logged-in devices can edit the same note and never clobber each other.
//
// Metadata: subject (user-defined dropdown options, owner-only table) +
// date, with sort / filter / group over both. Cloud-only feature.
//
// v3 traps encoded here: StarterKit must run with undoRedo: false when the
// Collaboration extension is active (it ships its own Yjs undo manager);
// one Y.Doc per open note, held OUTSIDE React state and keyed by note id.
//
// ── The overhaul ────────────────────────────────────────────────────────────
//
// 🚨 THE DOCUMENT MODEL IS UNTOUCHED. The Y.Doc, the snapshot-merge save, the
// version guard, the load-failure lock and every TipTap extension are exactly
// as they were. What changed is the chrome around them and the typography
// inside them.
//
// The editor's own type was the worst of it: the note body was hard-set to
// `ui-monospace` at 13px over an ~828px column, which is about 106 characters
// per line against a 66 target — the least readable long-form text in the
// app, on the one screen whose entire purpose is long-form text (D9). And the
// H1 rule applied `text-transform: uppercase` to the user's own heading, so a
// person typing in their private notebook had the app's system-label
// treatment written back at them with no way to opt out (D10). Body is the
// sans at 14/1.5 capped to 66ch and centred; H1 is 20/600 sentence case.
//
// Those rules lived in a `<style>` element inside `NoteEditor`, which is
// keyed by note id — so thirty lines of CSS were torn out of the document and
// reinserted on every click in the list (D29). They are in `dashboard.css`
// now, which is also what made the measure cap possible.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import {
  Plus, Trash2, Bold, Underline as UnderlineIcon, Heading1, Heading2,
  List, Link2, Link2Off, CloudOff, StickyNote, Settings2, X, Check,
  AlertTriangle,
} from 'lucide-react'
import { useNotes } from './useNotes'
import { u8ToB64, b64ToU8, saveWithMerge, toPreview } from './noteSync'
import {
  Badge, Banner, Button, Dialog, EmptyState, IconButton, Input, Loading,
  Select,
} from '../../ui'
import './dashboard.css'

const SAVE_DEBOUNCE_MS = 1200

const SORTS = [
  { value: 'updated_at', label: 'Updated' },
  { value: 'note_date', label: 'Date' },
  { value: 'title', label: 'Title' },
  { value: 'subject', label: 'Subject' },
]

const GROUPS = [
  { value: 'none', label: 'No groups' },
  { value: 'subject', label: 'By subject' },
  { value: 'month', label: 'By month' },
]

/**
 * "Did Escape just cause this change?"
 *
 * 🚨 THE VALUE CANNOT ANSWER THAT QUESTION, AND AN EARLIER FIX HERE ASSUMED
 * IT COULD. The kit's `Input` reverts by CALLING `onChange` with the value
 * the field held ON FOCUS (Input.jsx:26,30), so on a field whose `onChange`
 * writes, Escape is a write. Comparing the incoming value against the
 * PERSISTED one looks like it would catch that — and it does, right up until
 * the user actually changes something: `patchNoteMeta` is optimistic
 * (useNotes.js:86 updates the list before the network call), so after one
 * real pick the persisted value has already moved, the revert no longer
 * matches it, and Escape writes the OLD value back over the new one. On a
 * surface with no trash and no history. The same comparison also swallowed a
 * legitimate retry after a failed write, because then the row and the
 * database disagree and the "same" value is exactly the one that needs
 * sending (review round 2, findings 1 and 2).
 *
 * The key itself is the only reliable signal. `onKeyDownCapture` goes on the
 * Input, where it lands on the same element and React runs it before the
 * kit's own bubble handler; any other key clears the flag, so a stray Escape
 * elsewhere cannot swallow a later change.
 */
function useEscapeGuard() {
  const hit = useRef(false)
  return {
    onKeyDownCapture: (e) => { hit.current = e.key === 'Escape' },
    swallowed: () => { const was = hit.current; hit.current = false; return was },
  }
}

function fmtDate(d) {
  if (!d) return ''
  const dt = new Date(`${d}T00:00:00`)
  if (Number.isNaN(dt.getTime())) return d
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function monthLabel(d) {
  if (!d) return 'No date'
  const dt = new Date(`${d}T00:00:00`)
  if (Number.isNaN(dt.getTime())) return 'No date'
  return dt.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

export default function NotesView() {
  const nb = useNotes()
  const [selectedId, setSelectedId] = useState(null)
  const [sortKey, setSortKey] = useState('updated_at')
  const [groupKey, setGroupKey] = useState('none') // none | subject | month
  const [subjectFilter, setSubjectFilter] = useState('')
  const [manageSubjects, setManageSubjects] = useState(false)
  // The note the delete Dialog is asking about (W9). Null when it is closed.
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  const visible = useMemo(() => {
    let rows = nb.notes
    if (subjectFilter) rows = rows.filter(n => (n.subject || '') === subjectFilter)
    const sorted = [...rows]
    sorted.sort((a, b) => {
      let va = a[sortKey] ?? ''
      let vb = b[sortKey] ?? ''
      if (typeof va === 'string') { va = va.toLowerCase(); vb = (vb || '').toLowerCase() }
      const aEmpty = va === ''
      const bEmpty = vb === ''
      if (aEmpty !== bEmpty) return aEmpty ? 1 : -1
      // Updated/date sort newest-first; text sorts ascending.
      const dir = (sortKey === 'updated_at' || sortKey === 'note_date') ? -1 : 1
      if (va < vb) return -1 * dir
      if (va > vb) return 1 * dir
      return 0
    })
    return sorted
  }, [nb.notes, subjectFilter, sortKey])

  const groups = useMemo(() => {
    if (groupKey === 'none') return [{ key: '__all__', label: null, notes: visible }]
    const map = new Map()
    for (const n of visible) {
      const key = groupKey === 'subject'
        ? (n.subject || 'No subject')
        : monthLabel(n.note_date)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(n)
    }
    return [...map.entries()].map(([key, notes]) => ({ key, label: key, notes }))
  }, [visible, groupKey])

  const selected = selectedId ? nb.notes.find(n => n.id === selectedId) : null

  const handleCreate = useCallback(async () => {
    try {
      const row = await nb.createNote({
        title: 'Untitled note',
        note_date: new Date().toISOString().slice(0, 10),
      })
      if (row?.id) setSelectedId(row.id)
    } catch { /* surfaced via nb.error */ }
  }, [nb])

  // W9, ruled 2026-09-11: every `window.confirm` in the app becomes the kit
  // Dialog, each lane converting its own as it passes. The warning this one
  // carries is not boilerplate — notes have no trash and no history — so the
  // copy is kept word for word and the button takes the danger variant.
  const handleDelete = useCallback(async (id) => {
    try {
      await nb.deleteNote(id)
      setSelectedId(cur => (cur === id ? null : cur))
    } catch { /* surfaced via nb.error */ }
  }, [nb])

  if (!nb.cloudReady) {
    return (
      <div className="dash-body">
        <EmptyState
          Icon={CloudOff}
          title="Notes need the cloud"
          body="Notes are private to your account and sync across your devices. Sign in and switch R.A.B.B.I.T. to the Supabase adapter to use them."
        />
      </div>
    )
  }

  return (
    <div className="dash-notes">
      {/* ── Left: list ── */}
      <div className="dash-notes-list">
        {/* New note is the one filled control in this column, because it is
            the entry action for the column's one job. Everything else here is
            configuration and takes the quiet treatment (review D11, Hick's
            hotspot 4). */}
        {/* Two rows, and which control sits on which is MEASURED, not
            guessed. A select shows its longest option plus the native arrow —
            85, 97 and 103px here — and the 300px column has 284px of usable
            width, so three of them cannot share a row and two of them plus
            the primary button cannot either. The first cut clipped "All
            subjects" to "All subjec" and the second clipped "No groups". The
            entry action takes the first row with the sort; the two controls
            that organise the list take the second, beside the subject
            manager they belong with. */}
        <div className="dash-notes-head">
          <Button variant="primary" size="sm" onClick={handleCreate}>
            <Plus aria-hidden="true" /> New note
          </Button>
          <Select
            size="sm"
            value={sortKey}
            onChange={v => setSortKey(v ?? 'updated_at')}
            options={SORTS}
            aria-label="Sort notes"
            title="Sort notes"
          />
        </div>
        <div className="dash-notes-head">
          <Select
            size="sm"
            value={groupKey}
            onChange={v => setGroupKey(v ?? 'none')}
            options={GROUPS}
            aria-label="Group notes"
            title="Group notes"
          />
          <Select
            size="sm"
            value={subjectFilter}
            onChange={v => setSubjectFilter(v ?? '')}
            placeholder="All subjects"
            options={nb.subjects.map(s => ({ value: s.label, label: s.label }))}
            aria-label="Filter notes by subject"
            title="Filter notes by subject"
          />
          <IconButton
            icon={Settings2}
            size="sm"
            title="Manage subjects"
            active={manageSubjects}
            onClick={() => setManageSubjects(v => !v)}
          />
        </div>

        {manageSubjects && <SubjectManager nb={nb} />}

        {nb.error && (
          <Banner
            tone="danger"
            Icon={AlertTriangle}
            action={<IconButton icon={X} size="sm" title="Dismiss" onClick={nb.clearError} />}
          >
            {nb.error}
          </Banner>
        )}

        <div className="dash-notes-scroll wilson-dark-scroll">
          {/* "Not yet" and "nothing here" were the same italic line. */}
          {nb.loading && visible.length === 0 ? (
            <Loading rows={5} columns={1} label="Loading your notes" />
          ) : visible.length === 0 ? (
            <EmptyState
              compact
              Icon={StickyNote}
              title={nb.notes.length === 0 ? 'No notes yet' : 'No matches'}
              body={nb.notes.length === 0
                ? 'Create one to start writing.'
                : 'No note matches the current filter.'}
            />
          ) : groups.map(group => (
            <div key={group.key} className="dash-note-group">
              {group.label && (
                <div className="dash-note-group-head">
                  <span className="dash-group-name">{group.label}</span>
                  <span className="dash-group-count">{group.notes.length}</span>
                </div>
              )}
              <ul className="dash-note-rows">
                {group.notes.map(n => (
                  <li key={n.id}>
                    {/* Selected was a SURFACE swap — near-white to near-black,
                        and the 1px border dropped with it, so every line in
                        the row shifted a pixel up and left at the moment of
                        selection. It is a fill plus a 2px signal left edge
                        now, the same selected treatment the table uses, with
                        the border present in both states so nothing moves
                        (review D21, alignment 10). */}
                    <button
                      type="button"
                      className="dash-note-row"
                      data-selected={String(selectedId === n.id)}
                      onClick={() => setSelectedId(n.id)}
                    >
                      <span className="dash-note-row-title">{n.title || 'Untitled note'}</span>
                      <span className="dash-note-row-meta">
                        {n.subject && <Badge>{n.subject}</Badge>}
                        <span className="dash-note-date">{fmtDate(n.note_date)}</span>
                      </span>
                      {n.body_preview && (
                        <span className="dash-note-row-preview">{n.body_preview}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right: editor ── */}
      <div className="dash-notes-editor">
        {selected ? (
          <NoteEditor
            key={selected.id}
            note={selected}
            nb={nb}
            onDelete={() => setConfirmDeleteId(selected.id)}
          />
        ) : (
          <EmptyState
            Icon={StickyNote}
            title="No note selected"
            body="Pick a note from the list, or create one."
          />
        )}
      </div>

      {confirmDeleteId && (
        <Dialog
          width="confirm"
          title="Delete this note permanently?"
          onClose={() => setConfirmDeleteId(null)}
          footer={(
            <>
              <Button autoFocus onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={() => {
                  const id = confirmDeleteId
                  setConfirmDeleteId(null)
                  handleDelete(id)
                }}
              >
                Delete note
              </Button>
            </>
          )}
        >
          Notes have no trash.
        </Dialog>
      )}
    </div>
  )
}

// ── Subject options manager ─────────────────────────────────
function SubjectManager({ nb }) {
  const [draft, setDraft] = useState('')
  const [renaming, setRenaming] = useState(null) // { id, label }
  // 🚨 The kit's Input calls `blur()` on Enter before it calls the caller's
  // onKeyDown (Input.jsx:69), so this field loses focus on every commit and
  // typing a run of subjects meant clicking back in each time. Putting the
  // focus back is the smallest fix that does not touch the kit.
  const draftRef = useRef(null)
  const addDraft = useCallback(() => {
    if (!draft.trim()) return
    nb.addSubject(draft)
      .then(() => { setDraft(''); draftRef.current?.focus() })
      .catch(() => {})
  }, [draft, nb])

  return (
    // 🚨 `onKeyDownCapture`, and on the PANEL rather than on each row. The
    // kit's Input handles Escape itself and calls `stopPropagation()`, so a
    // handler on an ANCESTOR still never sees it — that has not changed, and
    // it is what W2's "the first press does not close the dialog" rests on.
    // (F3 did change the other half: `Input` now calls the caller's own
    // `onKeyDown` after reverting instead of returning first, so a handler on
    // the INPUT ITSELF works too. Capture is still correct here because this
    // handler is on the panel, not on the field.) The rename row had an
    // Escape exit before it moved
    // to the kit Input and lost it — and it was the row's only exit besides
    // Enter and the tick, so losing it made the row a dead end (review round
    // 1, finding 1). It sits here rather than on each row because per-row
    // handlers meant Escape on row three closed row one's rename while Escape
    // in the "new subject" field closed nothing (round 2, finding 7).
    //
    // One press closes it, which is what it did before the kit and is
    // therefore what C1 requires. Ruling W2 — "Escape inside a DIALOG field
    // reverts the edit first, closes on the second press" — governs a field
    // inside a `Dialog`; this is an inline row and neither it nor the link
    // panel is one.
    <div className="dash-subjects" onKeyDownCapture={e => { if (e.key === 'Escape') setRenaming(null) }}>
      <div className="dash-subjects-head">Your subjects</div>
      {nb.subjects.length === 0 && (
        <span className="dash-subjects-empty">None yet — add one below.</span>
      )}
      {nb.subjects.map(s => (
        // 🚨 `onKeyDownCapture`, not `onKeyDown`. The kit's Input handles
        // Escape itself and calls `stopPropagation()`, so a BUBBLING handler
        // here — on the row, above the field — still never runs. (F3 made
        // Input forward the key to its own `onKeyDown` after reverting; that
        // helps a handler ON the field, not one above it.) The rename row had
        // an Escape exit before it moved to the
        // kit Input and lost it — and it is the row's only exit besides Enter
        <div key={s.id} className="dash-subject-row">
          {renaming?.id === s.id ? (
            <>
              <Input
                size="sm"
                autoFocus
                value={renaming.label}
                // Never resurrect a row Escape just closed: the kit's
                // cancel path calls onChange after the capture handler above
                // has already set this to null.
                onChange={(v) => setRenaming((r) => (r === null ? null : { id: s.id, label: v }))}
                onKeyDown={e => {
                  if (e.key === 'Enter') { nb.renameSubject(s.id, renaming.label).catch(() => {}); setRenaming(null) }
                }}
                aria-label={`Rename ${s.label}`}
              />
              <IconButton
                icon={Check}
                size="sm"
                title="Save name"
                onClick={() => { nb.renameSubject(s.id, renaming.label).catch(() => {}); setRenaming(null) }}
              />
            </>
          ) : (
            <>
              <button
                type="button"
                className="dash-subject-name"
                onClick={() => setRenaming({ id: s.id, label: s.label })}
                title="Rename"
              >
                {s.label}
              </button>
              <IconButton
                icon={Trash2}
                size="sm"
                danger
                title="Delete subject option"
                onClick={() => nb.removeSubject(s.id).catch(() => {})}
              />
            </>
          )}
        </div>
      ))}
      <div className="dash-subject-row">
        <Input
          ref={draftRef}
          size="sm"
          value={draft}
          onChange={setDraft}
          onKeyDown={e => { if (e.key === 'Enter') addDraft() }}
          placeholder="New subject"
          aria-label="New subject"
        />
        <IconButton icon={Plus} size="sm" title="Add subject" onClick={addDraft} />
      </div>
    </div>
  )
}

// ── Editor ──────────────────────────────────────────────────
// One Y.Doc per mounted editor; the parent keys this component by note id
// so switching notes rebuilds doc + editor from scratch.
function NoteEditor({ note, nb, onDelete }) {
  const ydocRef = useRef(null)
  if (!ydocRef.current) ydocRef.current = new Y.Doc()
  const ydoc = ydocRef.current

  const [docReady, setDocReady] = useState(false)
  // Load failure LOCKS editing (review finding C5): an empty doc plus the
  // list row's version would pass the save guard and overwrite the real
  // body — notes have no trash and no history, so that loss is permanent.
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [saveState, setSaveState] = useState('saved') // saved | dirty | saving | error
  const versionRef = useRef(note.version ?? 0)
  const saveTimerRef = useRef(null)
  const savingRef = useRef(false)
  const queuedRef = useRef(false)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  // The hook's return object is a fresh literal every render — depending on
  // it would re-run the snapshot load (a full-ydoc GET) on every keystroke
  // (review finding C6). Route access through a ref instead.
  const nbRef = useRef(nb)
  useEffect(() => { nbRef.current = nb }, [nb])

  const editor = useEditor({
    extensions: [
      // v3: 'history' became 'undoRedo' — it MUST be off with Collaboration
      // (which ships its own Yjs undo manager). Underline + Link are part
      // of the v3 StarterKit.
      StarterKit.configure({
        undoRedo: false,
        link: { openOnClick: false },
      }),
      Collaboration.configure({ document: ydoc }),
    ],
    editable: true,
    shouldRerenderOnTransaction: true, // toolbar active-states need it
  }, [ydoc])

  // Load the snapshot AFTER the editor exists, then start listening for
  // local changes. StrictMode-safe: the fetch is idempotent (applyUpdate
  // is idempotent) and gated by a cancelled flag. On ANY failure the editor
  // stays locked (loadFailed) — editing an unloaded doc is the data-loss
  // path C5 describes. Deps deliberately exclude `nb` (see nbRef).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const row = await nbRef.current.openNote(note.id)
        if (cancelled) return
        if (!row) throw new Error('note not found')
        if (row.ydoc_state) Y.applyUpdate(ydoc, b64ToU8(row.ydoc_state), 'remote-load')
        if (row.version !== undefined && row.version !== null) versionRef.current = row.version
        setLoadFailed(false)
        setDocReady(true)
      } catch {
        if (!cancelled) setLoadFailed(true)
      }
    })()
    return () => { cancelled = true }
  }, [note.id, ydoc, loadAttempt])

  const runSave = useCallback(async () => {
    if (savingRef.current) { queuedRef.current = true; return }
    savingRef.current = true
    if (mountedRef.current) setSaveState('saving')
    try {
      const res = await saveWithMerge({
        encode: () => u8ToB64(Y.encodeStateAsUpdate(ydoc)),
        save: (b64, version) => nbRef.current.saveNoteDoc(note.id, {
          ydocState: b64,
          bodyPreview: toPreview(editor?.getText?.() || ''),
          expectedVersion: version,
        }),
        fetchRemote: async () => {
          const row = await nbRef.current.openNote(note.id)
          return row ? { ydocState: row.ydoc_state, version: row.version } : null
        },
        applyRemote: (b64) => Y.applyUpdate(ydoc, b64ToU8(b64), 'remote-merge'),
        expectedVersion: versionRef.current,
      })
      versionRef.current = res.version
      nbRef.current.reflectSaved(note.id, {
        version: res.version,
        updated_at: new Date().toISOString(),
        body_preview: toPreview(editor?.getText?.() || ''),
      })
      if (mountedRef.current) setSaveState('saved')
    } catch {
      if (mountedRef.current) setSaveState('error')
    } finally {
      savingRef.current = false
      if (queuedRef.current) {
        queuedRef.current = false
        runSave()
      }
    }
  }, [ydoc, note.id, editor])

  const runSaveRef = useRef(runSave)
  useEffect(() => { runSaveRef.current = runSave }, [runSave])

  // Local edits → debounced save. Remote-merge/load updates re-encode on
  // the retry that applied them, so they don't need their own schedule —
  // filtering BOTH injected origins prevents the conflict path from
  // scheduling a redundant second save (review finding M9).
  useEffect(() => {
    if (!docReady) return undefined
    const onUpdate = (_update, origin) => {
      if (origin === 'remote-load' || origin === 'remote-merge') return
      if (mountedRef.current) setSaveState('dirty')
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null
        runSaveRef.current()
      }, SAVE_DEBOUNCE_MS)
    }
    ydoc.on('update', onUpdate)
    return () => {
      ydoc.off('update', onUpdate)
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
        // Flush the pending edit instead of dropping it on note switch.
        runSaveRef.current()
      }
    }
  }, [docReady, ydoc])

  // Inline link editor — window.prompt throws in Electron renderers
  // ('prompt() is and will not be supported'), so the URL entry is an
  // in-app input row (review finding C8).
  const [linkPanel, setLinkPanel] = useState(null) // null | { value }
  const openLinkPanel = useCallback(() => {
    if (!editor) return
    setLinkPanel({ value: editor.getAttributes('link').href || '' })
  }, [editor])
  const applyLink = useCallback(() => {
    if (!editor || linkPanel === null) return
    const url = (linkPanel.value || '').trim()
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    }
    setLinkPanel(null)
  }, [editor, linkPanel])

  // Title commits are debounced (review finding M8: a PATCH per keystroke),
  // flushed on commit. The component is keyed by note.id, so mount-time init
  // is sufficient.
  const [titleDraft, setTitleDraft] = useState(note.title || '')
  const titleTimerRef = useRef(null)
  const titleEsc = useEscapeGuard()
  const dateEsc = useEscapeGuard()
  const commitTitle = useCallback((value) => {
    if (titleTimerRef.current) { clearTimeout(titleTimerRef.current); titleTimerRef.current = null }
    if (value !== note.title) {
      nbRef.current.patchNoteMeta(note.id, { title: value }).catch(() => {})
    }
  }, [note.id, note.title])
  const onTitleChange = useCallback((value) => {
    const v = value.slice(0, 200)
    setTitleDraft(v)
    // Escape cancels a pending write as well as declining to make a new one.
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
    // 🚨 `onCommit` is correctly skipped on Escape — but the kit's cancel
    // path calls `onChange`, and this one SCHEDULES a write, so the PATCH
    // arrived through the other door and the comment on `onCommit` below was
    // asserting an invariant this field did not have. Escape turned "nothing
    // written" into one write of the focus-time title (review round 2,
    // finding 3). The revert is still shown; it is simply not saved.
    if (titleEsc.swallowed()) return
    titleTimerRef.current = setTimeout(() => {
      titleTimerRef.current = null
      nbRef.current.patchNoteMeta(note.id, { title: v }).catch(() => {})
    }, 500)
  }, [note.id])
  useEffect(() => () => {
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
  }, [])


  return (
    <div className="dash-editor">
      {/* The note's name was an input with the same well, the same 12px mono
          and the same height as the subject dropdown and the date picker
          beside it, so the Notes tab had no heading at all and a person's own
          note had no visible name until they read the third control in a row
          of four. It is the page's dominant element now — the H1 step, 600,
          no fill, no border until focus — and the subject and date drop to
          the caption step beneath it (review D27). */}
      <div className="dash-note-head">
        <Input
          className="dash-note-title"
          value={titleDraft}
          onKeyDownCapture={titleEsc.onKeyDownCapture}
          onChange={onTitleChange}
          // 🚨 `onCommit`, never `onBlur`. The kit's Input handles Escape
          // itself and its cancel path calls blur() — which fires onBlur
          // unconditionally — so an onBlur commit would PERSIST the edit
          // Escape is cancelling (D1 hand-off §5 trap 4).
          onCommit={() => commitTitle(titleDraft)}
          placeholder="Untitled note"
          aria-label="Note title"
        />
        <IconButton icon={Trash2} size="sm" danger title="Delete note" onClick={onDelete} />
      </div>

      <div className="dash-note-meta">
        <Select
          size="sm"
          value={note.subject || ''}
          // No Escape guard: `Select` has no revert path, so a guard here
          // could only ever swallow a legitimate retry after a failed write
          // (review round 2, finding 2).
          onChange={v => nb.patchNoteMeta(note.id, { subject: v || null }).catch(() => {})}
          placeholder="No subject"
          options={[
            ...nb.subjects.map(s => ({ value: s.label, label: s.label })),
            // A note can keep a subject whose option was deleted.
            ...(note.subject && !nb.subjects.some(s => s.label === note.subject)
              ? [{ value: note.subject, label: note.subject }]
              : []),
          ]}
          aria-label="Note subject"
        />
        {/* Escape here means "dismiss the picker", not "write the old date
            back" — see `useEscapeGuard`. A real pick still commits
            immediately, exactly as it did before the kit. */}
        <Input
          size="sm"
          type="date"
          className="dash-date"
          value={note.note_date || ''}
          onKeyDownCapture={dateEsc.onKeyDownCapture}
          onChange={v => {
            if (dateEsc.swallowed()) return
            nb.patchNoteMeta(note.id, { note_date: v || null }).catch(() => {})
          }}
          aria-label="Note date"
        />
        <span className="dash-save-state" data-state={saveState}>
          {saveState === 'saving' ? 'Saving…'
            : saveState === 'dirty' ? 'Unsaved'
              : saveState === 'error' ? 'Save failed — retrying on next edit'
                : 'Saved'}
        </span>
      </div>

      {/* Seven identical squares in one gap-1 run, at Miller's limit, with a
          destructive-ish control sitting inside the constructive ones. Three
          proximity groups now — block level, inline marks, link — and Remove
          link recedes. Nothing moved out of reach and no behaviour changed;
          this is proximity and weight only (review D24, Hick's hotspot 5).

          🚨 These are the kit's `IconButton`, not seven hand-rolled buttons.
          An earlier cut of this bundle re-implemented IconButton's box, hover
          and active treatment in `dashboard.css` and justified it by saying
          the active state "comes from TipTap rather than from a prop" — which
          is not a reason, because `editor.isActive('bold')` is just a value
          you pass to a prop. The kit version also brings `aria-pressed`,
          which the hand-rolled seven did not have (C8; review round 1). */}
      <div className="dash-format-bar">
        <span className="dash-format-group">
          <IconButton icon={Heading1} size="sm" title="Heading 1"
            active={!!editor?.isActive('heading', { level: 1 })}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} />
          <IconButton icon={Heading2} size="sm" title="Heading 2"
            active={!!editor?.isActive('heading', { level: 2 })}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} />
          <IconButton icon={List} size="sm" title="Bullet list"
            active={!!editor?.isActive('bulletList')}
            onClick={() => editor?.chain().focus().toggleBulletList().run()} />
        </span>
        <span className="dash-format-group">
          <IconButton icon={Bold} size="sm" title="Bold"
            active={!!editor?.isActive('bold')}
            onClick={() => editor?.chain().focus().toggleBold().run()} />
          <IconButton icon={UnderlineIcon} size="sm" title="Underline"
            active={!!editor?.isActive('underline')}
            onClick={() => editor?.chain().focus().toggleUnderline().run()} />
        </span>
        <span className="dash-format-group">
          <IconButton icon={Link2} size="sm" title="Add / edit link"
            active={!!(editor?.isActive('link') || linkPanel !== null)}
            onClick={openLinkPanel} />
          {/* The one that recedes: it is the only destructive-ish control in
              a run of constructive ones (D24). One page rule, not a variant. */}
          <IconButton icon={Link2Off} size="sm" title="Remove link"
            className="dash-tb-quiet"
            onClick={() => editor?.chain().focus().unsetLink().run()} />
        </span>
      </div>

      {/* inline link URL entry (window.prompt is unavailable in Electron) */}
      {linkPanel !== null && (
        <div className="dash-link-panel" onKeyDownCapture={e => { if (e.key === 'Escape') setLinkPanel(null) }}>
          <Input
            size="sm"
            autoFocus
            value={linkPanel.value}
            // Same shape as the rename row above: the kit's Escape revert
            // calls onChange, and a plain object here re-opened the panel.
            onChange={(v) => setLinkPanel((p) => (p === null ? null : { value: v }))}
            onKeyDown={e => { if (e.key === 'Enter') applyLink() }}
            placeholder="https://…  (empty removes the link)"
            aria-label="Link URL"
          />
          <Button size="sm" variant="primary" onClick={applyLink}>Apply</Button>
          <Button size="sm" onClick={() => setLinkPanel(null)}>Cancel</Button>
        </div>
      )}

      <div
        className="dash-note-editor wilson-dark-scroll"
        onClick={() => { if (docReady) editor?.chain().focus().run() }}
      >
        {loadFailed ? (
          // Editing stays LOCKED: typing into an unloaded doc would save an
          // empty body over the real one (no trash, no history — permanent).
          <div className="dash-note-failed">
            <Banner tone="danger" Icon={AlertTriangle}>
              Couldn&apos;t load this note&apos;s content. Editing is disabled so nothing gets overwritten.
            </Banner>
            <Button
              variant="primary"
              size="sm"
              onClick={() => { setLoadFailed(false); setLoadAttempt(a => a + 1) }}
            >
              Retry
            </Button>
          </div>
        ) : docReady ? (
          <EditorContent editor={editor} />
        ) : (
          <Loading label="Loading this note" />
        )}
      </div>
    </div>
  )
}
