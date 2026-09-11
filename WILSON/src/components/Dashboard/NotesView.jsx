// ============================================================
// WILSON Dashboard — Notes (Session 8)
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import {
  Plus, Trash2, Bold, Underline as UnderlineIcon, Heading1, Heading2,
  List, Link2, Link2Off, CloudOff, StickyNote, Settings2, X, Check,
} from 'lucide-react'
import { useNotes } from './useNotes'
import { u8ToB64, b64ToU8, saveWithMerge, toPreview } from './noteSync'
import { LIGHT_INK, LIGHT_RULE, LIGHT_WELL } from '../lightSurface'

// ── WILSON light-page tokens (local per page, by convention) ──
// The Dashboard is a LIGHT page (#f4a261), so every ink here is LIGHT_INK —
// hierarchy comes from size, weight and italic, never from a lighter grey.
const L = {
  text:        '#1c1917',
  label:       LIGHT_INK,
  muted:       LIGHT_INK,
  border:      LIGHT_RULE,
  headRow:     LIGHT_WELL,
  inputBg:     'rgba(120, 70, 30, 0.55)',
  inputText:   '#fde8d0',
  chipBg:      '#1c1917',
  chipText:    '#f4a261',
  primary:     '#ea580c',
  primaryText: '#ffffff',
  surface:     'rgba(255, 255, 255, 0.45)',
}

const inputClass = 'px-3 py-2 text-xs font-mono rounded-sm focus:ring-2 focus:ring-orange-500'
const SAVE_DEBOUNCE_MS = 1200

const SORTS = [
  { key: 'updated_at', label: 'Updated' },
  { key: 'note_date',  label: 'Date' },
  { key: 'title',      label: 'Title' },
  { key: 'subject',    label: 'Subject' },
]

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

  const handleDelete = useCallback(async (id) => {
    if (!window.confirm('Delete this note permanently? Notes have no trash.')) return
    try {
      await nb.deleteNote(id)
      setSelectedId(cur => (cur === id ? null : cur))
    } catch { /* surfaced via nb.error */ }
  }, [nb])

  if (!nb.cloudReady) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <CloudOff className="w-8 h-8" style={{ color: L.muted }} />
        <div className="text-sm font-bold uppercase tracking-widest" style={{ color: L.label }}>
          Notes need the cloud
        </div>
        <div className="text-xs font-mono text-center max-w-md" style={{ color: L.muted }}>
          Notes are private to your account and sync across your devices.
          Sign in and switch R.A.B.B.I.T. to the Supabase adapter to use them.
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-4 h-full min-h-0">
      {/* ── Left: list ── */}
      <div className="flex flex-col flex-shrink-0" style={{ width: 300 }}>
        <div className="flex items-center gap-1.5 pb-2 flex-wrap">
          <button
            type="button"
            onClick={handleCreate}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider"
            style={{ backgroundColor: L.primary, color: L.primaryText }}
          >
            <Plus className="w-3.5 h-3.5" /> New note
          </button>
          <div className="flex-1" />
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value)}
            title="Sort"
            className={`${inputClass} !py-1`}
            style={{ backgroundColor: L.inputBg, color: L.inputText, border: 'none' }}
          >
            {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <select
            value={groupKey}
            onChange={e => setGroupKey(e.target.value)}
            title="Group"
            className={`${inputClass} !py-1`}
            style={{ backgroundColor: L.inputBg, color: L.inputText, border: 'none' }}
          >
            <option value="none">No groups</option>
            <option value="subject">By subject</option>
            <option value="month">By month</option>
          </select>
        </div>
        <div className="flex items-center gap-1.5 pb-2">
          <select
            value={subjectFilter}
            onChange={e => setSubjectFilter(e.target.value)}
            className={`${inputClass} flex-1 !py-1`}
            style={{ backgroundColor: L.inputBg, color: L.inputText, border: 'none' }}
          >
            <option value="">All subjects</option>
            {nb.subjects.map(s => <option key={s.id} value={s.label}>{s.label}</option>)}
          </select>
          <button
            type="button"
            title="Manage subjects"
            onClick={() => setManageSubjects(v => !v)}
            className="p-1.5 rounded-sm"
            style={manageSubjects
              ? { backgroundColor: L.primary, color: L.primaryText }
              : { backgroundColor: L.chipBg, color: L.chipText }}
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {manageSubjects && <SubjectManager nb={nb} />}

        {nb.error && (
          <div className="text-xs font-mono mb-2 px-3 py-2 rounded-sm flex items-start justify-between gap-2"
            style={{ backgroundColor: 'rgba(220,38,38,0.1)', color: '#dc2626' }}>
            <span>{nb.error}</span>
            <button type="button" onClick={nb.clearError}><X className="w-3 h-3" /></button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto flex flex-col gap-1.5 pr-1">
          {visible.length === 0 && !nb.loading && (
            <div className="flex flex-col items-center py-10 gap-2">
              <StickyNote className="w-6 h-6" style={{ color: L.muted }} />
              <span className="text-xs font-mono italic" style={{ color: L.muted }}>
                {nb.notes.length === 0 ? 'No notes yet.' : 'No notes match the filter.'}
              </span>
            </div>
          )}
          {groups.map(group => (
            <div key={group.key}>
              {group.label && (
                <div className="px-1 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: L.label }}>
                  {group.label} <span className="font-mono" style={{ color: L.muted }}>{group.notes.length}</span>
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                {group.notes.map(n => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => setSelectedId(n.id)}
                    className="text-left rounded-sm px-3 py-2 transition-colors"
                    style={selectedId === n.id
                      ? { backgroundColor: L.chipBg, color: L.chipText }
                      : { backgroundColor: L.surface, color: L.text, border: `1px solid ${L.border}` }}
                  >
                    <div className="text-xs font-mono font-bold truncate">{n.title || 'Untitled note'}</div>
                    <div className="flex items-center gap-2 pt-0.5">
                      {n.subject && (
                        <span className="px-1.5 rounded-sm text-[9px] font-bold uppercase tracking-wider"
                          style={{ backgroundColor: L.inputBg, color: L.inputText }}>
                          {n.subject}
                        </span>
                      )}
                      <span className="text-[10px] font-mono" style={{ color: selectedId === n.id ? '#a8a29e' : L.muted }}>
                        {fmtDate(n.note_date)}
                      </span>
                    </div>
                    {n.body_preview && (
                      <div className="text-[10.5px] font-mono truncate pt-0.5"
                        style={{ color: selectedId === n.id ? '#a8a29e' : L.muted }}>
                        {n.body_preview}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right: editor ── */}
      <div className="flex-1 min-w-0 flex flex-col">
        {selected ? (
          <NoteEditor
            key={selected.id}
            note={selected}
            nb={nb}
            onDelete={() => handleDelete(selected.id)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center flex-1 gap-3">
            <StickyNote className="w-8 h-8" style={{ color: L.muted }} />
            <span className="text-xs font-mono italic" style={{ color: L.muted }}>
              Select a note, or create one.
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Subject options manager ─────────────────────────────────
function SubjectManager({ nb }) {
  const [draft, setDraft] = useState('')
  const [renaming, setRenaming] = useState(null) // { id, label }

  return (
    <div className="mb-2 p-2 rounded-sm flex flex-col gap-1.5" style={{ backgroundColor: L.surface, border: `1px solid ${L.border}` }}>
      <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: L.label }}>
        Your subjects
      </div>
      {nb.subjects.length === 0 && (
        <span className="text-[10.5px] font-mono italic" style={{ color: L.muted }}>None yet — add one below.</span>
      )}
      {nb.subjects.map(s => (
        <div key={s.id} className="flex items-center gap-1.5">
          {renaming?.id === s.id ? (
            <>
              <input
                value={renaming.label}
                onChange={e => setRenaming({ id: s.id, label: e.target.value })}
                onKeyDown={e => {
                  if (e.key === 'Enter') { nb.renameSubject(s.id, renaming.label).catch(() => {}); setRenaming(null) }
                  if (e.key === 'Escape') setRenaming(null)
                }}
                autoFocus
                className={`${inputClass} flex-1 !py-1`}
                style={{ backgroundColor: L.inputBg, color: L.inputText, border: 'none' }}
              />
              <button type="button" onClick={() => { nb.renameSubject(s.id, renaming.label).catch(() => {}); setRenaming(null) }}
                className="p-1 rounded-sm" style={{ color: '#15803d' }}>
                <Check className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setRenaming({ id: s.id, label: s.label })}
                className="flex-1 text-left text-xs font-mono truncate hover:underline"
                style={{ color: L.text }}
                title="Rename"
              >
                {s.label}
              </button>
              <button
                type="button"
                onClick={() => nb.removeSubject(s.id).catch(() => {})}
                className="p-1 rounded-sm"
                style={{ color: L.muted }}
                title="Delete subject option"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </>
          )}
        </div>
      ))}
      <div className="flex items-center gap-1.5 pt-1">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && draft.trim()) {
              nb.addSubject(draft).then(() => setDraft('')).catch(() => {})
            }
          }}
          placeholder="New subject..."
          className={`${inputClass} flex-1 !py-1`}
          style={{ backgroundColor: L.inputBg, color: L.inputText, border: 'none' }}
        />
        <button
          type="button"
          onClick={() => { if (draft.trim()) nb.addSubject(draft).then(() => setDraft('')).catch(() => {}) }}
          className="p-1.5 rounded-sm"
          style={{ backgroundColor: L.chipBg, color: L.chipText }}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
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
  // flushed on blur. The component is keyed by note.id, so mount-time init
  // is sufficient.
  const [titleDraft, setTitleDraft] = useState(note.title || '')
  const titleTimerRef = useRef(null)
  const commitTitle = useCallback((value) => {
    if (titleTimerRef.current) { clearTimeout(titleTimerRef.current); titleTimerRef.current = null }
    if (value !== note.title) {
      nbRef.current.patchNoteMeta(note.id, { title: value }).catch(() => {})
    }
  }, [note.id, note.title])
  const onTitleChange = useCallback((value) => {
    const v = value.slice(0, 200)
    setTitleDraft(v)
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
    titleTimerRef.current = setTimeout(() => {
      titleTimerRef.current = null
      nbRef.current.patchNoteMeta(note.id, { title: v }).catch(() => {})
    }, 500)
  }, [note.id])
  useEffect(() => () => {
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
  }, [])

  const tbBtn = (active) => ({
    backgroundColor: active ? L.primary : L.chipBg,
    color: active ? L.primaryText : L.chipText,
  })

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* metadata row */}
      <div className="flex items-center gap-2 pb-2 flex-wrap">
        <input
          value={titleDraft}
          onChange={e => onTitleChange(e.target.value)}
          onBlur={e => commitTitle(e.target.value.slice(0, 200))}
          placeholder="Untitled note"
          className={`${inputClass} flex-1 min-w-40 font-bold`}
          style={{ backgroundColor: L.inputBg, color: L.inputText, border: 'none' }}
        />
        <select
          value={note.subject || ''}
          onChange={e => nb.patchNoteMeta(note.id, { subject: e.target.value || null }).catch(() => {})}
          className={inputClass}
          style={{ backgroundColor: L.inputBg, color: L.inputText, border: 'none' }}
        >
          <option value="">No subject</option>
          {nb.subjects.map(s => <option key={s.id} value={s.label}>{s.label}</option>)}
          {/* A note can keep a subject whose option was deleted. */}
          {note.subject && !nb.subjects.some(s => s.label === note.subject) && (
            <option value={note.subject}>{note.subject}</option>
          )}
        </select>
        <input
          type="date"
          value={note.note_date || ''}
          onChange={e => nb.patchNoteMeta(note.id, { note_date: e.target.value || null }).catch(() => {})}
          className={inputClass}
          style={{ backgroundColor: L.inputBg, color: L.inputText, border: 'none' }}
        />
        <button
          type="button"
          onClick={onDelete}
          title="Delete note"
          className="p-2 rounded-sm transition-colors"
          style={{ backgroundColor: L.chipBg, color: '#ef4444' }}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* toolbar */}
      <div className="flex items-center gap-1 pb-2">
        <button type="button" title="Heading 1" style={tbBtn(editor?.isActive('heading', { level: 1 }))}
          className="p-1.5 rounded-sm" onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}>
          <Heading1 className="w-3.5 h-3.5" />
        </button>
        <button type="button" title="Heading 2" style={tbBtn(editor?.isActive('heading', { level: 2 }))}
          className="p-1.5 rounded-sm" onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 className="w-3.5 h-3.5" />
        </button>
        <button type="button" title="Bold" style={tbBtn(editor?.isActive('bold'))}
          className="p-1.5 rounded-sm" onClick={() => editor?.chain().focus().toggleBold().run()}>
          <Bold className="w-3.5 h-3.5" />
        </button>
        <button type="button" title="Underline" style={tbBtn(editor?.isActive('underline'))}
          className="p-1.5 rounded-sm" onClick={() => editor?.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon className="w-3.5 h-3.5" />
        </button>
        <button type="button" title="Bullet list" style={tbBtn(editor?.isActive('bulletList'))}
          className="p-1.5 rounded-sm" onClick={() => editor?.chain().focus().toggleBulletList().run()}>
          <List className="w-3.5 h-3.5" />
        </button>
        <button type="button" title="Add / edit link" style={tbBtn(editor?.isActive('link') || linkPanel !== null)}
          className="p-1.5 rounded-sm" onClick={openLinkPanel}>
          <Link2 className="w-3.5 h-3.5" />
        </button>
        <button type="button" title="Remove link" style={tbBtn(false)}
          className="p-1.5 rounded-sm" onClick={() => editor?.chain().focus().unsetLink().run()}>
          <Link2Off className="w-3.5 h-3.5" />
        </button>
        <div className="flex-1" />
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{
          color: saveState === 'error' ? '#dc2626' : saveState === 'saved' ? '#15803d' : L.muted,
        }}>
          {saveState === 'saving' ? 'Saving…'
            : saveState === 'dirty' ? 'Unsaved'
            : saveState === 'error' ? 'Save failed — retrying on next edit'
            : 'Saved'}
        </span>
      </div>

      {/* inline link URL entry (window.prompt is unavailable in Electron) */}
      {linkPanel !== null && (
        <div className="flex items-center gap-1.5 pb-2">
          <input
            autoFocus
            value={linkPanel.value}
            onChange={e => setLinkPanel({ value: e.target.value })}
            onKeyDown={e => {
              if (e.key === 'Enter') applyLink()
              if (e.key === 'Escape') setLinkPanel(null)
            }}
            placeholder="https://…  (empty removes the link)"
            className={`${inputClass} flex-1`}
            style={{ backgroundColor: L.inputBg, color: L.inputText, border: 'none' }}
          />
          <button type="button" onClick={applyLink}
            className="px-2.5 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider"
            style={{ backgroundColor: L.primary, color: L.primaryText }}>
            Apply
          </button>
          <button type="button" onClick={() => setLinkPanel(null)}
            className="px-2.5 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider"
            style={{ backgroundColor: L.chipBg, color: L.chipText }}>
            Cancel
          </button>
        </div>
      )}

      {/* editor surface */}
      <style>{`
        .wilson-note-editor .ProseMirror {
          outline: none;
          min-height: 320px;
          font-size: 13px;
          line-height: 1.65;
          color: ${L.text};
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        }
        .wilson-note-editor .ProseMirror h1 {
          font-size: 20px; font-weight: 700; letter-spacing: -0.01em;
          margin: 0.6em 0 0.3em; text-transform: uppercase;
        }
        .wilson-note-editor .ProseMirror h2 {
          font-size: 16px; font-weight: 700; margin: 0.6em 0 0.3em;
        }
        .wilson-note-editor .ProseMirror ul {
          list-style: disc; padding-left: 1.4em; margin: 0.3em 0;
        }
        .wilson-note-editor .ProseMirror ol {
          list-style: decimal; padding-left: 1.4em; margin: 0.3em 0;
        }
        .wilson-note-editor .ProseMirror a {
          color: ${L.primary}; text-decoration: underline; cursor: pointer;
        }
        .wilson-note-editor .ProseMirror p { margin: 0.25em 0; }
        .wilson-note-editor .ProseMirror blockquote {
          border-left: 2px solid ${L.border}; padding-left: 0.8em;
          color: ${L.muted}; margin: 0.4em 0;
        }
      `}</style>
      <div
        className="wilson-note-editor flex-1 overflow-y-auto rounded-sm px-4 py-3"
        style={{ backgroundColor: L.surface, border: `1px solid ${L.border}` }}
        onClick={() => { if (docReady) editor?.chain().focus().run() }}
      >
        {loadFailed ? (
          // Editing stays LOCKED: typing into an unloaded doc would save an
          // empty body over the real one (no trash, no history — permanent).
          <div className="flex flex-col items-start gap-2 py-4">
            <span className="text-xs font-mono" style={{ color: '#dc2626' }}>
              Couldn't load this note's content. Editing is disabled so nothing gets overwritten.
            </span>
            <button
              type="button"
              onClick={() => { setLoadFailed(false); setLoadAttempt(a => a + 1) }}
              className="px-2.5 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider"
              style={{ backgroundColor: L.primary, color: L.primaryText }}
            >
              Retry
            </button>
          </div>
        ) : docReady ? (
          <EditorContent editor={editor} />
        ) : (
          <span className="text-xs font-mono italic" style={{ color: L.muted }}>Loading…</span>
        )}
      </div>
    </div>
  )
}
