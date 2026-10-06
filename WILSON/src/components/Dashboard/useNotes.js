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

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'
import { usePermissions } from '../../permissions/usePermissions'

export function useNotes() {
  const rabbit = useRabbit()
  const perms = usePermissions()
  const adapterMode = rabbit?.adapterMode
  const getAdapter = rabbit?.getAdapter

  const [notes, setNotes] = useState([])
  const [subjects, setSubjects] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // StrictMode-safe mounted flag (body resets to true).
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  const reqSeqRef = useRef(0)

  const cloudReady = adapterMode === 'supabase' && !!perms?.userId

  const adapter = useCallback(() => (
    typeof getAdapter === 'function' ? getAdapter() : null
  ), [getAdapter])

  const load = useCallback(async () => {
    const seq = ++reqSeqRef.current
    const a = adapter()
    if (adapterMode !== 'supabase' || typeof a?.listNotes !== 'function') {
      setNotes([]); setSubjects([]); setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [noteRows, subjectRows] = await Promise.all([
        a.listNotes(),
        typeof a.listNoteSubjects === 'function' ? a.listNoteSubjects() : [],
      ])
      if (!mountedRef.current || seq !== reqSeqRef.current) return
      setNotes(Array.isArray(noteRows) ? noteRows : [])
      setSubjects(Array.isArray(subjectRows) ? subjectRows : [])
    } catch (err) {
      if (mountedRef.current && seq === reqSeqRef.current) {
        setError(err.message || String(err))
      }
    } finally {
      if (mountedRef.current && seq === reqSeqRef.current) setLoading(false)
    }
  }, [adapterMode, adapter])

  useEffect(() => { load() }, [load, perms?.userId])

  // ── notes CRUD (metadata; the body goes through NoteEditor) ──
  const createNote = useCallback(async (fields = {}) => {
    const a = adapter()
    if (typeof a?.createNote !== 'function') return null
    const row = await a.createNote(fields)
    if (mountedRef.current && row) {
      setNotes(prev => [row, ...prev.filter(n => n.id !== row.id)])
    }
    return row
  }, [adapter])

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
    notes,
    subjects,
    loading,
    error,
    clearError: () => setError(null),
    reload: load,
    createNote,
    patchNoteMeta,
    deleteNote,
    reflectSaved,
    addSubject,
    renameSubject,
    removeSubject,
    openNote,
    saveNoteDoc,
  }
}
