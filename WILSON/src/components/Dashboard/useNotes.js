// ============================================================
// WILSON Dashboard — useNotes (Session 8)
// ============================================================
//
// List + metadata state for the Notes tab. Cloud-only (owner-only tables,
// migration 0017): outside supabase mode everything resolves to empty and
// the view renders its "cloud required" state.
//
// The note BODY (Yjs doc) is deliberately NOT held here — NoteEditor owns
// one Y.Doc per open note and talks to the adapter via getNote/saveNoteDoc
// (see noteSync.js). This hook reflects saved metadata back into the list.
// Notes never ride a realtime channel (private content) — the list refreshes
// on load, on tab activation, and after every local mutation.
//
// MO3 (0125): a note has a tier — personal (its owner's alone, as before), shared (every active member reads it;
// its owner and live admins change it) or the company standard (live admins set, change and clear it) — and a
// trash, 30 days, with its way back. The list has a scope: 'mine' (one's own, of every tier), 'shared' (the
// company's shared and standard notes) or 'trash' (what one may bring back). A database before 0125 keeps none
// of it: `tiers` is false and the tab is the one it was.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'
import { usePermissions } from '../../permissions/usePermissions'

export function useNotes() {
  const rabbit = useRabbit()
  const perms = usePermissions()
  const adapterMode = rabbit?.adapterMode
  const getAdapter = rabbit?.getAdapter

  const [notes, setNotes] = useState([])
  const [scope, setScope] = useState('mine')
  const [tiers, setTiers] = useState(false)
  const [subjects, setSubjects] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  // MO3 (review): the scope the last finished load was for, null until one has finished. `loading` starts false
  // and is set by the load's own effect, so a note asked for from elsewhere waits on this, not on `loading` alone.
  // A load that failed counts as finished (its banner says so), so a request is never held for ever.
  const [loadedScope, setLoadedScope] = useState(null)

  // StrictMode-safe mounted flag (body resets to true).
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  const reqSeqRef = useRef(0)
  // Review: the scope of the rows held, set with them, so a failed load never leaves one scope's rows under another.
  const rowsScopeRef = useRef(null)

  const cloudReady = adapterMode === 'supabase' && !!perms?.userId

  const adapter = useCallback(() => (
    typeof getAdapter === 'function' ? getAdapter() : null
  ), [getAdapter])

  const load = useCallback(async () => {
    const seq = ++reqSeqRef.current
    const a = adapter()
    if (adapterMode !== 'supabase' || typeof a?.listNotes !== 'function') {
      setNotes([]); setSubjects([]); setLoading(false); setLoadedScope('mine')
      rowsScopeRef.current = 'mine'
      return
    }
    setLoading(true)
    setError(null)
    let want = 'mine'
    try {
      const hasTiers = typeof a.notesHaveTiers === 'function' ? await a.notesHaveTiers() : false
      want = hasTiers ? scope : 'mine'
      const [noteRows, subjectRows] = await Promise.all([
        a.listNotes({ scope: want }),
        typeof a.listNoteSubjects === 'function' ? a.listNoteSubjects() : [],
      ])
      if (!mountedRef.current || seq !== reqSeqRef.current) return
      setTiers(!!hasTiers)
      setNotes(Array.isArray(noteRows) ? noteRows : [])
      rowsScopeRef.current = want
      setSubjects(Array.isArray(subjectRows) ? subjectRows : [])
      setLoadedScope(want)
    } catch (err) {
      if (mountedRef.current && seq === reqSeqRef.current) {
        setError(err.message || String(err))
        // Review: rows of another scope than the one asked (and on screen) are not this scope's answer: the list is
        // emptied, so the tab shows its empty state under the error, and loadedScope describes the rows it shows. A
        // failed refresh of the same scope keeps its rows.
        if (rowsScopeRef.current !== want || want !== scope) {
          setNotes([])
          rowsScopeRef.current = want
        }
        setLoadedScope(want)
      }
    } finally {
      if (mountedRef.current && seq === reqSeqRef.current) setLoading(false)
    }
  }, [adapterMode, adapter, scope])

  // S2 (RECONNECT_DESIGN.md §11.9): and again when a sign-in held at an
  // offline launch is confirmed — the identity does not change then.
  const heldOffline = !!perms?.offline
  useEffect(() => { load() }, [load, perms?.userId, heldOffline])

  // ── notes CRUD (metadata; the body goes through NoteEditor) ──
  const createNote = useCallback(async (fields = {}) => {
    const a = adapter()
    if (typeof a?.createNote !== 'function') return null
    const row = await a.createNote(fields)
    // MO3 (review): a new note is one's own and personal, so it joins the list only where that list is Mine; the
    // trash or the shared list would show it as what it is not.
    if (mountedRef.current && row && (!tiers || scope === 'mine')) {
      setNotes(prev => [row, ...prev.filter(n => n.id !== row.id)])
    }
    return row
  }, [adapter, tiers, scope])

  const patchNoteMeta = useCallback(async (id, patch) => {
    const a = adapter()
    if (typeof a?.patchNote !== 'function') return null
    setNotes(prev => prev.map(n => (n.id === id ? { ...n, ...patch } : n)))
    try {
      return await a.patchNote(id, patch)
    } catch (err) {
      // Reconverge from the server rather than restoring a whole-array
      // snapshot — concurrent updates (reflectSaved, other patches) may
      // have landed since the snapshot and would be clobbered.
      setError(err.message || String(err))
      load()
      throw err
    }
  }, [adapter, load])

  // 0125: to the trash (its way back is restoreNote); before 0125, deleted, as it was.
  const deleteNote = useCallback(async (id) => {
    const a = adapter()
    if (typeof a?.deleteNote !== 'function') return
    const snapshot = notes
    setNotes(prev => prev.filter(n => n.id !== id))
    try {
      await a.deleteNote(id)
    } catch (err) {
      if (mountedRef.current) setNotes(snapshot)
      setError(err.message || String(err))
      throw err
    }
  }, [adapter, notes])

  const restoreNote = useCallback(async (id) => {
    const a = adapter()
    if (typeof a?.restoreNote !== 'function') return false
    try {
      const back = await a.restoreNote(id)
      await load()
      return back
    } catch (err) {
      setError(err.message || String(err))
      throw err
    }
  }, [adapter, load])

  // 0125: who reads the note. The server says no in words, and the words are shown.
  const setNoteTier = useCallback(async (id, tier) => {
    const a = adapter()
    if (typeof a?.setNoteTier !== 'function') return null
    setNotes(prev => prev.map(n => (n.id === id ? { ...n, tier } : n)))
    try {
      return await a.setNoteTier(id, tier)
    } catch (err) {
      setError(err.message || String(err))
      load()
      throw err
    }
  }, [adapter, load])

  // 0127: the keys of the typed links in the body just saved, with that save's version. Quiet on a database
  // without links: the words are saved either way. True when the links were made; false when the server did not
  // take them (the note moved on, or the call failed), which the editor tries once more; null when this database
  // keeps no links, which nothing retries.
  const syncNoteMentions = useCallback(async (id, version, keys) => {
    const a = adapter()
    if (typeof a?.syncNoteMentions !== 'function') return null
    try {
      return !!(await a.syncNoteMentions(id, version, keys))
    } catch (err) {
      if (err?.code === 'moth_absent') return null
      setError(err.message || String(err))
      return false
    }
  }, [adapter])

  // Editor callback — reflect a landed saveNoteDoc into the list row.
  const reflectSaved = useCallback((id, { version, updated_at, body_preview }) => {
    setNotes(prev => prev.map(n => (n.id === id
      ? {
          ...n,
          ...(version !== undefined ? { version } : {}),
          ...(updated_at ? { updated_at } : {}),
          ...(body_preview !== undefined ? { body_preview } : {}),
        }
      : n)))
  }, [])

  // ── subject options ─────────────────────────────────────
  const addSubject = useCallback(async (label) => {
    const a = adapter()
    if (typeof a?.createNoteSubject !== 'function') return null
    const trimmed = (label || '').trim()
    if (!trimmed) return null
    try {
      const row = await a.createNoteSubject({ label: trimmed, position: subjects.length })
      if (mountedRef.current && row) setSubjects(prev => [...prev, row])
      return row
    } catch (err) {
      const msg = err.message || String(err)
      // Unique per owner (case-insensitive) — surface a friendly message.
      setError(msg.includes('note_subjects_owner_label_uidx')
        ? `You already have a "${trimmed}" subject.`
        : msg)
      throw err
    }
  }, [adapter, subjects.length])

  const renameSubject = useCallback(async (id, label) => {
    const a = adapter()
    if (typeof a?.patchNoteSubject !== 'function') return null
    const trimmed = (label || '').trim()
    if (!trimmed) return null
    const oldLabel = subjects.find(s => s.id === id)?.label
    const snapshot = subjects
    setSubjects(prev => prev.map(s => (s.id === id ? { ...s, label: trimmed } : s)))
    try {
      const saved = await a.patchNoteSubject(id, { label: trimmed })
      // Cascade: notes store the label as text — re-tag them or the rename
      // silently un-tags every existing note (review finding C7).
      if (oldLabel && oldLabel !== trimmed && typeof a.retagNoteSubject === 'function') {
        await a.retagNoteSubject(oldLabel, trimmed)
        if (mountedRef.current) {
          setNotes(prev => prev.map(n => (n.subject === oldLabel ? { ...n, subject: trimmed } : n)))
        }
      }
      return saved
    } catch (err) {
      if (mountedRef.current) setSubjects(snapshot)
      setError(err.message || String(err))
      throw err
    }
  }, [adapter, subjects])

  const removeSubject = useCallback(async (id) => {
    const a = adapter()
    if (typeof a?.deleteNoteSubject !== 'function') return
    const snapshot = subjects
    setSubjects(prev => prev.filter(s => s.id !== id))
    try {
      await a.deleteNoteSubject(id)
    } catch (err) {
      if (mountedRef.current) setSubjects(snapshot)
      setError(err.message || String(err))
      throw err
    }
  }, [adapter, subjects])

  // Editor data access — passthroughs so NoteEditor never imports adapters.
  const openNote = useCallback(async (id) => {
    const a = adapter()
    if (typeof a?.getNote !== 'function') return null
    return a.getNote(id)
  }, [adapter])

  const saveNoteDoc = useCallback(async (id, args) => {
    const a = adapter()
    if (typeof a?.saveNoteDoc !== 'function') return null
    return a.saveNoteDoc(id, args)
  }, [adapter])

  return {
    cloudReady,
    // S2: the shell runs on a sign-in held at an offline launch (the view says so in one sentence).
    offline: heldOffline,
    notes,
    scope,
    setScope,
    loadedScope,
    tiers,
    userId: perms?.userId ?? null,
    isAdmin: perms?.role === 'admin',
    getAdapter: adapter,
    subjects,
    loading,
    error,
    clearError: () => setError(null),
    reload: load,
    createNote,
    patchNoteMeta,
    deleteNote,
    restoreNote,
    setNoteTier,
    syncNoteMentions,
    reflectSaved,
    addSubject,
    renameSubject,
    removeSubject,
    openNote,
    saveNoteDoc,
  }
}
