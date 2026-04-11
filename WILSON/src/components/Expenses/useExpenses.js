// ============================================================
// useExpenses — CRUD hook for project expenses
// ============================================================
//
// Follows the useTeamMembers / useTaskTemplates pattern:
// optimistic UI, adapter-backed persistence, mounted-ref guard.
//
// Adds a 10-step undo / redo stack so the user can reverse
// accidental edits without round-tripping to the server.

import { useState, useCallback, useRef, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'

const MAX_HISTORY = 10

export function useExpenses() {
  const rabbit = useRabbit()
  const getAdapter  = rabbit?.getAdapter
  const project     = rabbit?.project
  const projectId   = project?.id
  const adapterMode = rabbit?.adapterMode
  const adapterStatus = rabbit?.adapterStatus

  const [expenses, setExpenses] = useState([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)

  // ── Undo / redo ──────────────────────────────────────────
  const undoStack = useRef([])   // past states (max MAX_HISTORY)
  const redoStack = useRef([])   // future states (max MAX_HISTORY)

  function pushUndo(snapshot) {
    undoStack.current = [...undoStack.current.slice(-(MAX_HISTORY - 1)), snapshot]
    redoStack.current = []  // any new edit clears redo
  }

  const canUndo = undoStack.current.length > 0
  const canRedo = redoStack.current.length > 0

  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return
    const prev = undoStack.current[undoStack.current.length - 1]
    undoStack.current = undoStack.current.slice(0, -1)
    setExpenses(cur => {
      redoStack.current = [...redoStack.current.slice(-(MAX_HISTORY - 1)), cur]
      return prev
    })
  }, [])

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return
    const next = redoStack.current[redoStack.current.length - 1]
    redoStack.current = redoStack.current.slice(0, -1)
    setExpenses(cur => {
      undoStack.current = [...undoStack.current.slice(-(MAX_HISTORY - 1)), cur]
      return next
    })
  }, [])

  // ── Mounted guard ────────────────────────────────────────
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  // ── Load ─────────────────────────────────────────────────
  const loadExpenses = useCallback(async () => {
    if (!getAdapter || !projectId) return
    const adapter = getAdapter()
    if (!adapter?.listExpenses) return
    setLoading(true)
    setError(null)
    try {
      let list = await adapter.listExpenses(projectId)
      if (!Array.isArray(list)) list = []
      if (mountedRef.current) {
        setExpenses(list)
        undoStack.current = []
        redoStack.current = []
      }
    } catch (err) {
      if (mountedRef.current) setError(err.message || String(err))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [getAdapter, projectId])

  useEffect(() => {
    loadExpenses()
  }, [loadExpenses, adapterMode, adapterStatus?.online])

  // ── Add ──────────────────────────────────────────────────
  const addExpense = useCallback(async (data) => {
    if (!getAdapter || !projectId) return null
    const adapter = getAdapter()
    if (!adapter?.upsertExpense) return null

    const now = new Date().toISOString()
    const expense = {
      id: uuidv4(),
      project_id: projectId,
      title: '',
      description: '',
      estimated_cost: 0,
      actual_cost: 0,
      purchase_date: '',
      asset_ids: [],
      phase_ids: [],
      task_ids: [],
      file_ids: [],
      created_at: now,
      updated_at: now,
      ...data,
    }

    setExpenses(prev => {
      pushUndo(prev)
      return [...prev, expense]
    })

    try {
      const saved = await adapter.upsertExpense(expense)
      if (mountedRef.current && saved?.id) {
        setExpenses(prev => prev.map(e => e.id === expense.id ? { ...expense, ...saved } : e))
      }
      return saved || expense
    } catch (err) {
      if (mountedRef.current) setError(err.message || String(err))
      return expense
    }
  }, [getAdapter, projectId])

  // ── Update ───────────────────────────────────────────────
  const updateExpense = useCallback(async (id, patch) => {
    if (!getAdapter || !projectId) return
    const adapter = getAdapter()

    setExpenses(prev => {
      pushUndo(prev)
      return prev.map(e => e.id === id ? { ...e, ...patch, updated_at: new Date().toISOString() } : e)
    })

    try {
      if (adapter?.updateExpense) {
        await adapter.updateExpense(id, projectId, patch)
      } else if (adapter?.upsertExpense) {
        const full = expenses.find(e => e.id === id)
        if (full) await adapter.upsertExpense({ ...full, ...patch })
      }
    } catch (err) {
      if (mountedRef.current) setError(err.message || String(err))
    }
  }, [getAdapter, projectId, expenses])

  // ── Delete ───────────────────────────────────────────────
  const deleteExpense = useCallback(async (id) => {
    if (!getAdapter || !projectId) return
    const adapter = getAdapter()

    setExpenses(prev => {
      pushUndo(prev)
      return prev.filter(e => e.id !== id)
    })

    try {
      if (adapter?.deleteExpense) await adapter.deleteExpense(id, projectId)
    } catch (err) {
      if (mountedRef.current) setError(err.message || String(err))
    }
  }, [getAdapter, projectId])

  return {
    expenses,
    loading,
    error,
    reload: loadExpenses,
    addExpense,
    updateExpense,
    deleteExpense,
    undo,
    redo,
    canUndo,
    canRedo,
  }
}
