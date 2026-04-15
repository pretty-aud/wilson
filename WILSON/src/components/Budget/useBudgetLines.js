// ============================================================
// useBudgetLines — CRUD hook for budget line items & actuals
// ============================================================
//
// Manages the spreadsheet-style budget:
//   - Budget lines: role/expense rows with bid (rate, days, qty)
//   - Budget actuals: per-cell values for invoices/timecards
//
// Follows the useExpenses/useTeamMembers pattern:
// optimistic UI, adapter-backed persistence, mounted-ref guard.

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'

// ── Sheets that budget lines belong to ──
export const BUDGET_SHEETS = {
  crew:            'crew',
  talent:          'talent',
  expenses_travel: 'expenses_travel',
}

// ── Default department groupings for crew sheet ──
export const DEFAULT_CREW_DEPARTMENTS = [
  'Production',
  'Creative',
  'Studio/Art',
  'Post-Production',
  'Development',
]

// ── Column mode options ──
export const COLUMN_MODES = [
  { value: 'fortnightly', label: 'Bi-Weekly (2-week periods)' },
  { value: 'weekly',      label: 'Weekly' },
  { value: 'count',       label: 'Numbered (no dates)' },
]


export function useBudgetLines() {
  const rabbit = useRabbit()
  const getAdapter    = rabbit?.getAdapter
  const project       = rabbit?.project
  const projectId     = project?.id
  const adapterMode   = rabbit?.adapterMode
  const adapterStatus = rabbit?.adapterStatus

  const [lines, setLines]       = useState([])
  const [actuals, setActuals]   = useState([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)

  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  // ── Load ─────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    if (!getAdapter || !projectId) return
    const adapter = getAdapter()
    if (!adapter?.listBudgetLines) return
    setLoading(true)
    setError(null)
    try {
      let lineList   = await adapter.listBudgetLines(projectId)
      let actualList = await adapter.listBudgetActuals(projectId)
      if (!Array.isArray(lineList))   lineList = []
      if (!Array.isArray(actualList)) actualList = []
      if (mountedRef.current) {
        setLines(lineList)
        setActuals(actualList)
      }
    } catch (err) {
      if (mountedRef.current) setError(err.message || String(err))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [getAdapter, projectId])

  useEffect(() => {
    loadAll()
  }, [loadAll, adapterMode, adapterStatus?.online])

  // ── Budget Lines CRUD ────────────────────────────────────
  const addLine = useCallback(async (data) => {
    if (!getAdapter || !projectId) return null
    const adapter = getAdapter()
    if (!adapter?.upsertBudgetLine) return null

    const now = new Date().toISOString()
    const line = {
      id: uuidv4(),
      project_id: projectId,
      sheet: 'crew',
      department: '',
      sort_order: 0,
      label: '',
      team_member_id: null,
      rate: 0,
      days: 0,
      qty: 1,
      is_section_header: false,
      agency_opt_out: false,
      talent_agency_fee_pct: null,
      description: '',
      cost: 0,
      is_na_days: false,
      is_na_qty: false,
      created_at: now,
      updated_at: now,
      ...data,
    }

    setLines(prev => [...prev, line])
    try {
      const saved = await adapter.upsertBudgetLine(line)
      if (mountedRef.current && saved?.id) {
        setLines(prev => prev.map(l => l.id === line.id ? { ...line, ...saved } : l))
      }
      return saved || line
    } catch (err) {
      if (mountedRef.current) setError(err.message || String(err))
      return line
    }
  }, [getAdapter, projectId])

  const updateLine = useCallback(async (id, patch) => {
    if (!getAdapter || !projectId) return
    const adapter = getAdapter()

    setLines(prev => prev.map(l =>
      l.id === id ? { ...l, ...patch, updated_at: new Date().toISOString() } : l
    ))

    try {
      if (adapter?.updateBudgetLine) {
        await adapter.updateBudgetLine(id, projectId, patch)
      } else if (adapter?.upsertBudgetLine) {
        const full = lines.find(l => l.id === id)
        if (full) await adapter.upsertBudgetLine({ ...full, ...patch })
      }
    } catch (err) {
      if (mountedRef.current) setError(err.message || String(err))
    }
  }, [getAdapter, projectId, lines])

  const deleteLine = useCallback(async (id) => {
    if (!getAdapter || !projectId) return
    const adapter = getAdapter()

    setLines(prev => prev.filter(l => l.id !== id))
    // Also remove actuals for this line
    setActuals(prev => prev.filter(a => a.line_id !== id))

    try {
      if (adapter?.deleteBudgetLine) await adapter.deleteBudgetLine(id, projectId)
      // Clean up orphaned actuals
      const orphaned = actuals.filter(a => a.line_id === id)
      for (const a of orphaned) {
        if (adapter?.deleteBudgetActual) await adapter.deleteBudgetActual(a.id, projectId)
      }
    } catch (err) {
      if (mountedRef.current) setError(err.message || String(err))
    }
  }, [getAdapter, projectId, actuals])

  // ── Budget Actuals CRUD ──────────────────────────────────
  const upsertActual = useCallback(async (data) => {
    if (!getAdapter || !projectId) return null
    const adapter = getAdapter()
    if (!adapter?.upsertBudgetActual) return null

    const now = new Date().toISOString()
    const actual = {
      id: data.id || uuidv4(),
      project_id: projectId,
      line_id: data.line_id,
      column_index: data.column_index ?? 0,
      value: data.value ?? 0,
      invoice_number: data.invoice_number || null,
      expense_id: data.expense_id || null,
      source: data.source || 'manual',
      notes: data.notes || null,
      created_at: now,
      updated_at: now,
      ...data,
    }

    setActuals(prev => {
      const idx = prev.findIndex(a => a.id === actual.id)
      if (idx >= 0) return prev.map(a => a.id === actual.id ? actual : a)
      return [...prev, actual]
    })

    try {
      const saved = await adapter.upsertBudgetActual(actual)
      if (mountedRef.current && saved?.id) {
        setActuals(prev => prev.map(a => a.id === actual.id ? { ...actual, ...saved } : a))
      }
      return saved || actual
    } catch (err) {
      if (mountedRef.current) setError(err.message || String(err))
      return actual
    }
  }, [getAdapter, projectId])

  const deleteActual = useCallback(async (id) => {
    if (!getAdapter || !projectId) return
    const adapter = getAdapter()

    setActuals(prev => prev.filter(a => a.id !== id))
    try {
      if (adapter?.deleteBudgetActual) await adapter.deleteBudgetActual(id, projectId)
    } catch (err) {
      if (mountedRef.current) setError(err.message || String(err))
    }
  }, [getAdapter, projectId])

  // ── Computed: index actuals by line_id ───────────────────
  const actualsByLine = useMemo(() => {
    const map = {}
    for (const a of actuals) {
      if (!map[a.line_id]) map[a.line_id] = []
      map[a.line_id].push(a)
    }
    return map
  }, [actuals])

  // ── Computed: line subtotals and bid totals ──────────────
  const lineComputations = useMemo(() => {
    const agencyPct    = Number(project?.budget_agency_pct ?? 0) / 100
    const agencyOn     = project?.budget_agency_enabled === true

    const map = {}
    for (const line of lines) {
      if (line.is_section_header) continue
      const rate = Number(line.rate || 0)
      const days = line.is_na_days ? 0 : Number(line.days || 0)
      const qty  = line.is_na_qty  ? 1 : Number(line.qty || 1)
      const cost = line.sheet === 'expenses_travel' ? Number(line.cost || 0) : 0

      // Subtotal: rate × days × qty for crew/talent, cost × days × qty for expenses
      const subtotal = line.sheet === 'expenses_travel'
        ? cost * (line.is_na_days ? 1 : days) * (line.is_na_qty ? 1 : qty)
        : rate * days * qty

      // Agency fee — global project agency fee and per-row talent rep fee
      // are separate concerns and apply additively.
      let agencyFee = 0
      // Global project agency fee (applies to crew + talent + expenses unless opted out)
      if (agencyOn && !line.agency_opt_out) {
        agencyFee += subtotal * agencyPct
      }
      // Per-row talent agent representation fee (in addition to global)
      if (line.sheet === 'talent' && line.talent_agency_fee_pct != null) {
        agencyFee += subtotal * (Number(line.talent_agency_fee_pct) / 100)
      }

      const bidTotal = subtotal + agencyFee

      // Actual total from actuals
      const lineActuals = actualsByLine[line.id] || []
      const actualTotal = lineActuals.reduce((sum, a) => sum + (Number(a.value) || 0), 0)

      const variance = actualTotal - bidTotal

      map[line.id] = { subtotal, agencyFee, bidTotal, actualTotal, variance }
    }
    return map
  }, [lines, actualsByLine, project?.budget_agency_pct, project?.budget_agency_enabled])

  // ── Computed: lines grouped by sheet + department ────────
  const linesBySheet = useMemo(() => {
    const map = { crew: {}, talent: {}, expenses_travel: {} }
    for (const line of lines) {
      const sheet = map[line.sheet] || map.crew
      const dept = line.department || 'Uncategorized'
      if (!sheet[dept]) sheet[dept] = []
      sheet[dept].push(line)
    }
    // Sort within each department by sort_order
    for (const sheet of Object.values(map)) {
      for (const dept of Object.keys(sheet)) {
        sheet[dept].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      }
    }
    return map
  }, [lines])

  return {
    lines,
    actuals,
    loading,
    error,
    reload: loadAll,
    // Line CRUD
    addLine,
    updateLine,
    deleteLine,
    // Actual CRUD
    upsertActual,
    deleteActual,
    // Computed
    actualsByLine,
    lineComputations,
    linesBySheet,
  }
}
