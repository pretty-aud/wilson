// ============================================================
// RABBIT — BudgetView
// ============================================================
//
// Five-tab budget breakdown for the active project:
//
//   • Summary  — totals, variance, by-role rollup
//   • By Phase — phase-grouped bid/logged/variance/cost
//   • By Role  — role-grouped bid/logged/variance/cost
//   • By Asset — asset-grouped bid/logged/variance/cost
//   • Custom   — user picks group-by + filter + rate card override
//
// Costs come from `useRateCard()` — entries are flattened into a
// `{ role_slug → day_rate }` map and threaded through every cost
// computation. Tasks whose `assigned_role_slug` is missing from the
// active rate card fall back to a 0 day rate (the user sees a hint
// at the top of the Summary tab when this is the case).
//
// Custom tab settings are persisted per-project in localStorage so
// that picking "group by phase" once survives navigation. Nothing
// here writes back to the bundle — the budget view is read-only.

import { useEffect, useMemo, useState } from 'react'
import {
  DollarSign, Layers, Boxes, UserCircle, Sparkles,
  ArrowUp, ArrowDown, Minus, AlertCircle,
} from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
import { useRateCard } from '../../../components/RateCard/useRateCard'
import CurrencyDisplay from '../components/CurrencyDisplay'

const TABS = [
  { id: 'summary',   label: 'Summary',  icon: DollarSign },
  { id: 'by_phase',  label: 'By Phase', icon: Layers     },
  { id: 'by_role',   label: 'By Role',  icon: UserCircle },
  { id: 'by_asset',  label: 'By Asset', icon: Boxes      },
  { id: 'custom',    label: 'Custom',   icon: Sparkles   },
]

const GROUP_BY_OPTIONS = [
  { id: 'phase',    label: 'Phase'    },
  { id: 'role',     label: 'Role'     },
  { id: 'asset',    label: 'Asset'    },
  { id: 'status',   label: 'Status'   },
  { id: 'priority', label: 'Priority' },
]

const STATUS_FILTER_OPTIONS = [
  { id: '__all__', label: 'All statuses' },
  { id: 'bidding', label: 'Bidding' },
  { id: 'waiting_to_start', label: 'Waiting to start' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'on_hold', label: 'On hold' },
  { id: 'pending_review', label: 'Pending review' },
  { id: 'revisions', label: 'Revisions' },
  { id: 'approved', label: 'Approved' },
  { id: 'final', label: 'Final' },
  { id: 'omitted', label: 'Omitted' },
]

export default function BudgetView() {
  const ctx = useRabbit()
  const project = ctx?.project
  const phases  = ctx?.phases  || []
  const assets  = ctx?.assets  || []
  const tasks   = ctx?.tasks   || []
  const loading = ctx?.loadingProject

  const rateCard = useRateCard()
  const [tab, setTab] = useState('summary')

  // Build a slug → day_rate lookup from the active rate card.
  const roleRates = useMemo(() => {
    const map = {}
    for (const e of rateCard.entries || []) {
      if (!e.role_slug) continue
      const rate = Number(e.day_rate || 0)
      if (!Number.isFinite(rate)) continue
      // First entry wins per slug. Importers may produce multiple
      // rows per role across regions / project sizes — until the
      // custom tab adds region/size filters we just take the first.
      if (map[e.role_slug] == null) map[e.role_slug] = rate
    }
    return map
  }, [rateCard.entries])

  const variance = useMemo(
    () => ctx?.selectVarianceForProject?.() || { bid: 0, logged: 0, variance: 0 },
    [ctx]
  )

  const budget = useMemo(
    () => ctx?.selectProjectBudgetRollup?.({ roleRates }) || { total: 0, byRole: {}, currency: 'USD' },
    [ctx, roleRates]
  )

  // Count of tasks with a role that the rate card doesn't know about —
  // surfaced as a hint at the top of Summary so the user knows why
  // their numbers are 0.
  const missingRolesCount = useMemo(() => {
    let n = 0
    for (const t of tasks) {
      const slug = t.assigned_role_slug
      if (!slug) continue
      if (!(slug in roleRates)) n += 1
    }
    return n
  }, [tasks, roleRates])

  if (loading) return <CenterMsg>Loading project…</CenterMsg>
  if (!project) return <CenterMsg>No project loaded</CenterMsg>

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: '#1c1917' }}>
      {/* Tab strip */}
      <div
        className="flex items-center gap-1 px-4 py-2"
        style={{ backgroundColor: '#292524', borderBottom: '1px solid #44403c' }}
      >
        {TABS.map(t => {
          const active = tab === t.id
          const Icon = t.icon
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm"
              style={{
                color: active ? '#fff7ed' : '#a8a29e',
                backgroundColor: active ? '#ea580c' : 'transparent',
                border: `1px solid ${active ? '#c2410c' : '#44403c'}`,
              }}
            >
              <Icon className="w-3 h-3" />
              <span className="text-[10px] font-mono uppercase tracking-wider">
                {t.label}
              </span>
            </button>
          )
        })}
      </div>

      <div className="flex-1 overflow-auto p-6">
        {tab === 'summary'  && (
          <SummaryTab
            variance={variance}
            budget={budget}
            tasks={tasks}
            roleRates={roleRates}
            missingRolesCount={missingRolesCount}
            rateCardName={rateCard.rateCards.find(c => c.id === rateCard.activeRateCardId)?.name}
          />
        )}
        {tab === 'by_phase' && (
          <ByPhaseTab phases={phases} assets={assets} tasks={tasks} budget={budget} roleRates={roleRates} />
        )}
        {tab === 'by_role'  && (
          <ByRoleTab tasks={tasks} budget={budget} roleRates={roleRates} />
        )}
        {tab === 'by_asset' && (
          <ByAssetTab assets={assets} tasks={tasks} budget={budget} roleRates={roleRates} />
        )}
        {tab === 'custom'   && (
          <CustomTab
            project={project}
            phases={phases}
            assets={assets}
            tasks={tasks}
            budget={budget}
            roleRates={roleRates}
            rateCard={rateCard}
          />
        )}
      </div>
    </div>
  )
}

// ─── Cost helpers ───────────────────────────────────────────
function computeRowCost(taskList, roleRates) {
  let cost = 0
  for (const t of taskList) {
    const days = Number(t.bid_days || 0)
    const slug = t.assigned_role_slug
    const rate = slug ? Number(roleRates[slug] || 0) : 0
    cost += days * rate
  }
  return cost
}

function aggregateTasks(taskList, roleRates) {
  let bid = 0, logged = 0
  for (const t of taskList) {
    bid    += Number(t.bid_days || 0)
    logged += Number(t.logged_days || 0)
  }
  return {
    bid,
    logged,
    variance: logged - bid,
    cost: computeRowCost(taskList, roleRates),
    taskCount: taskList.length,
  }
}

// ─── Summary tab ────────────────────────────────────────────
function SummaryTab({ variance, budget, tasks, roleRates, missingRolesCount, rateCardName }) {
  const knownRoles = Object.keys(roleRates).length
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <BigTile
          label="Bid days"
          value={variance.bid.toFixed(1)}
          hint={`${tasks.length} task${tasks.length === 1 ? '' : 's'}`}
        />
        <BigTile
          label="Logged days"
          value={variance.logged.toFixed(1)}
          hint={`${variance.bid > 0 ? Math.round((variance.logged / variance.bid) * 100) : 0}% of bid`}
        />
        <BigTile
          label="Variance"
          value={(variance.variance > 0 ? '+' : '') + variance.variance.toFixed(1)}
          hint={varianceLabel(variance.variance)}
          tone={varianceTone(variance.variance)}
        />
      </div>

      <Card title="Project total">
        <div className="flex items-end justify-between">
          <CurrencyDisplay
            value={budget.total}
            currency={budget.currency}
            className="text-2xl font-mono font-bold"
            style={{ color: '#d6d3d1' }}
          />
          <div className="flex flex-col items-end">
            <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: '#a8a29e' }}>
              {budget.currency} · {Object.keys(budget.byRole).length} role{Object.keys(budget.byRole).length === 1 ? '' : 's'}
            </span>
            {rateCardName && (
              <span className="text-[10px] font-mono italic" style={{ color: '#78716c' }}>
                via {rateCardName}
              </span>
            )}
          </div>
        </div>
        {missingRolesCount > 0 && (
          <div
            className="mt-3 flex items-start gap-2 p-2 rounded-sm"
            style={{ backgroundColor: '#1c1917', border: '1px solid #78350f' }}
          >
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: '#fcd34d' }} />
            <p className="text-[10px] font-mono leading-relaxed" style={{ color: '#fcd34d' }}>
              {missingRolesCount} task{missingRolesCount === 1 ? '' : 's'} reference roles
              the active rate card doesn't know about — those rows compute at 0.
              Add the missing role{missingRolesCount === 1 ? '' : 's'} to the
              rate card or remap them on the task. ({knownRoles} role
              {knownRoles === 1 ? '' : 's'} currently in the card.)
            </p>
          </div>
        )}
      </Card>

      <Card title="By role">
        {Object.keys(budget.byRole).length === 0 ? (
          <Empty>No roles assigned yet.</Empty>
        ) : (
          <RoleTable rows={Object.values(budget.byRole)} currency={budget.currency} />
        )}
      </Card>
    </div>
  )
}

// ─── By Phase tab ───────────────────────────────────────────
function ByPhaseTab({ phases, assets, tasks, budget, roleRates }) {
  const rows = useMemo(() => {
    const assetById = Object.fromEntries(assets.map(a => [a.id, a]))
    const groups = {}
    for (const t of tasks) {
      const asset = assetById[t.asset_id]
      const phaseId = asset?.phase_id || '__unphased__'
      if (!groups[phaseId]) groups[phaseId] = []
      groups[phaseId].push(t)
    }
    const phaseById = Object.fromEntries(phases.map(p => [p.id, p]))
    return Object.entries(groups)
      .map(([phaseId, list]) => ({
        ...aggregateTasks(list, roleRates),
        name: phaseId === '__unphased__' ? 'Unphased' : (phaseById[phaseId]?.name || 'Unknown phase'),
        sortOrder: phaseId === '__unphased__' ? 9999 : (phaseById[phaseId]?.sort_order ?? 0),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder)
  }, [phases, assets, tasks, roleRates])

  if (rows.length === 0) return <Empty>No tasks yet — nothing to roll up.</Empty>

  return (
    <Card title="Phases">
      <BreakdownTable
        rows={rows}
        currency={budget.currency}
        labelHeader="Phase"
        countHeader="Tasks"
      />
    </Card>
  )
}

// ─── By Role tab ────────────────────────────────────────────
function ByRoleTab({ tasks, budget, roleRates }) {
  const rows = useMemo(() => {
    const groups = {}
    for (const t of tasks) {
      const role = t.assigned_role_slug || t.assigned_position || 'unassigned'
      if (!groups[role]) groups[role] = []
      groups[role].push(t)
    }
    return Object.entries(groups)
      .map(([role, list]) => ({
        ...aggregateTasks(list, roleRates),
        name: role,
      }))
      .sort((a, b) => b.bid - a.bid)
  }, [tasks, roleRates])

  if (rows.length === 0) return <Empty>No roles assigned yet.</Empty>

  return (
    <Card title="Roles">
      <BreakdownTable
        rows={rows}
        currency={budget.currency}
        labelHeader="Role"
        countHeader="Tasks"
      />
    </Card>
  )
}

// ─── By Asset tab ───────────────────────────────────────────
function ByAssetTab({ assets, tasks, budget, roleRates }) {
  const rows = useMemo(() => {
    const groups = {}
    for (const t of tasks) {
      if (!groups[t.asset_id]) groups[t.asset_id] = []
      groups[t.asset_id].push(t)
    }
    return assets
      .map(a => ({
        ...aggregateTasks(groups[a.id] || [], roleRates),
        name: a.name,
      }))
      .filter(r => r.taskCount > 0 || r.bid > 0)
      .sort((a, b) => b.bid - a.bid)
  }, [assets, tasks, roleRates])

  if (rows.length === 0) return <Empty>No assets carry any task hours yet.</Empty>

  return (
    <Card title="Assets">
      <BreakdownTable
        rows={rows}
        currency={budget.currency}
        labelHeader="Asset"
        countHeader="Tasks"
      />
    </Card>
  )
}

// ─── Custom tab ─────────────────────────────────────────────
function CustomTab({ project, phases, assets, tasks, budget, roleRates, rateCard }) {
  const storageKey = `rabbit-budget-custom-${project.id}`

  // Hydrate prefs from localStorage on mount.
  const [prefs, setPrefs] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) return { groupBy: 'phase', phaseFilter: '__all__', statusFilter: '__all__', ...JSON.parse(raw) }
    } catch { /* ignore */ }
    return { groupBy: 'phase', phaseFilter: '__all__', statusFilter: '__all__' }
  })

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(prefs)) } catch { /* ignore */ }
  }, [storageKey, prefs])

  const filteredTasks = useMemo(() => {
    const assetById = Object.fromEntries(assets.map(a => [a.id, a]))
    return tasks.filter(t => {
      if (prefs.statusFilter !== '__all__' && t.status !== prefs.statusFilter) return false
      if (prefs.phaseFilter !== '__all__') {
        const a = assetById[t.asset_id]
        const pid = a?.phase_id || '__unphased__'
        if (pid !== prefs.phaseFilter) return false
      }
      return true
    })
  }, [tasks, assets, prefs.statusFilter, prefs.phaseFilter])

  const rows = useMemo(() => {
    const assetById = Object.fromEntries(assets.map(a => [a.id, a]))
    const phaseById = Object.fromEntries(phases.map(p => [p.id, p]))
    const groups = {}
    for (const t of filteredTasks) {
      let key
      let label
      switch (prefs.groupBy) {
        case 'phase': {
          const a = assetById[t.asset_id]
          key = a?.phase_id || '__unphased__'
          label = key === '__unphased__' ? 'Unphased' : (phaseById[key]?.name || 'Unknown phase')
          break
        }
        case 'role': {
          key = t.assigned_role_slug || t.assigned_position || 'unassigned'
          label = key
          break
        }
        case 'asset': {
          key = t.asset_id
          label = assetById[key]?.name || 'Unknown asset'
          break
        }
        case 'status': {
          key = t.status || 'unset'
          label = key
          break
        }
        case 'priority': {
          key = t.priority || 'medium'
          label = key
          break
        }
        default:
          key = 'all'
          label = 'All'
      }
      if (!groups[key]) groups[key] = { key, label, tasks: [] }
      groups[key].tasks.push(t)
    }
    return Object.values(groups)
      .map(g => ({ ...aggregateTasks(g.tasks, roleRates), name: g.label }))
      .sort((a, b) => b.bid - a.bid)
  }, [filteredTasks, assets, phases, prefs.groupBy, roleRates])

  const totalCost = rows.reduce((acc, r) => acc + r.cost, 0)
  const totalBid  = rows.reduce((acc, r) => acc + r.bid, 0)

  return (
    <div className="flex flex-col gap-4">
      <Card title="Custom view">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Group by">
            <Select
              value={prefs.groupBy}
              onChange={v => setPrefs(p => ({ ...p, groupBy: v }))}
              options={GROUP_BY_OPTIONS.map(o => ({ value: o.id, label: o.label }))}
            />
          </Field>
          <Field label="Phase filter">
            <Select
              value={prefs.phaseFilter}
              onChange={v => setPrefs(p => ({ ...p, phaseFilter: v }))}
              options={[
                { value: '__all__', label: 'All phases' },
                ...phases
                  .slice()
                  .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                  .map(p => ({ value: p.id, label: p.name })),
                { value: '__unphased__', label: 'Unphased' },
              ]}
            />
          </Field>
          <Field label="Status filter">
            <Select
              value={prefs.statusFilter}
              onChange={v => setPrefs(p => ({ ...p, statusFilter: v }))}
              options={STATUS_FILTER_OPTIONS.map(o => ({ value: o.id, label: o.label }))}
            />
          </Field>
        </div>
        {rateCard.rateCards.length > 1 && (
          <div className="mt-3">
            <Field label="Rate card">
              <Select
                value={rateCard.activeRateCardId || ''}
                onChange={v => rateCard.setActiveRateCardId(v)}
                options={rateCard.rateCards.map(c => ({ value: c.id, label: c.name }))}
              />
            </Field>
          </div>
        )}
      </Card>

      <Card title={`Breakdown · ${rows.length} group${rows.length === 1 ? '' : 's'}`}>
        {rows.length === 0 ? (
          <Empty>No tasks match the current filters.</Empty>
        ) : (
          <>
            <BreakdownTable
              rows={rows}
              currency={budget.currency}
              labelHeader={GROUP_BY_OPTIONS.find(o => o.id === prefs.groupBy)?.label || 'Group'}
              countHeader="Tasks"
            />
            <div
              className="grid grid-cols-6 gap-2 px-2 py-2 mt-2 rounded-sm text-[11px] font-mono items-center"
              style={{ backgroundColor: '#1c1917', border: '1px solid #57534e' }}
            >
              <span className="font-bold uppercase tracking-wider" style={{ color: '#fb923c' }}>Total</span>
              <span style={{ color: '#a8a29e' }}>{filteredTasks.length}</span>
              <span style={{ color: '#a8a29e' }}>{totalBid.toFixed(1)}</span>
              <span />
              <span />
              <CurrencyDisplay
                value={totalCost}
                currency={budget.currency}
                className="font-bold"
                style={{ color: '#d6d3d1' }}
              />
            </div>
          </>
        )}
      </Card>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────
function Card({ title, children }) {
  return (
    <div
      className="rounded-sm p-4 mb-4"
      style={{ backgroundColor: '#292524', border: '1px solid #44403c' }}
    >
      {title && (
        <h3
          className="text-[11px] font-mono uppercase tracking-widest font-bold mb-3"
          style={{ color: '#fb923c' }}
        >
          {title}
        </h3>
      )}
      {children}
    </div>
  )
}

function BigTile({ label, value, hint, tone = 'neutral' }) {
  const colors = {
    good:    { bg: '#1c1917', border: '#15803d', text: '#86efac', label: '#86efac' },
    danger:  { bg: '#1c1917', border: '#7f1d1d', text: '#fca5a5', label: '#fca5a5' },
    neutral: { bg: '#1c1917', border: '#44403c', text: '#d6d3d1', label: '#a8a29e' },
  }[tone]
  return (
    <div
      className="flex flex-col px-3 py-2 rounded-sm"
      style={{ backgroundColor: colors.bg, border: `1px solid ${colors.border}` }}
    >
      <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: colors.label }}>
        {label}
      </span>
      <span className="text-2xl font-mono font-bold" style={{ color: colors.text }}>{value}</span>
      {hint && (
        <span className="text-[10px] font-mono" style={{ color: colors.label }}>{hint}</span>
      )}
    </div>
  )
}

function RoleTable({ rows, currency }) {
  return (
    <div className="flex flex-col gap-1">
      <HeaderRow cols={['Role', 'Days', 'Cost']} />
      {rows
        .slice()
        .sort((a, b) => b.cost - a.cost)
        .map(row => (
          <div
            key={row.role}
            className="grid grid-cols-3 gap-2 px-2 py-1 rounded-sm text-[11px] font-mono"
            style={{ backgroundColor: '#1c1917', border: '1px solid #44403c' }}
          >
            <span style={{ color: '#d6d3d1' }}>{row.role}</span>
            <span style={{ color: '#a8a29e' }}>{row.days.toFixed(1)} d</span>
            <CurrencyDisplay
              value={row.cost}
              currency={currency}
              style={{ color: '#a8a29e' }}
            />
          </div>
        ))}
    </div>
  )
}

function BreakdownTable({ rows, currency, labelHeader, countHeader }) {
  return (
    <div className="flex flex-col gap-1">
      <HeaderRow cols={[labelHeader, countHeader, 'Bid', 'Logged', 'Variance', 'Cost']} sixCol />
      {rows.map((row, i) => (
        <div
          key={`${row.name}-${i}`}
          className="grid grid-cols-6 gap-2 px-2 py-1 rounded-sm text-[11px] font-mono items-center"
          style={{ backgroundColor: '#1c1917', border: '1px solid #44403c' }}
        >
          <span className="truncate" style={{ color: '#d6d3d1' }}>{row.name}</span>
          <span style={{ color: '#a8a29e' }}>{row.taskCount}</span>
          <span style={{ color: '#a8a29e' }}>{row.bid.toFixed(1)}</span>
          <span style={{ color: '#a8a29e' }}>{row.logged.toFixed(1)}</span>
          <VarianceCell value={row.variance} />
          <CurrencyDisplay value={row.cost} currency={currency} style={{ color: '#a8a29e' }} />
        </div>
      ))}
    </div>
  )
}

function HeaderRow({ cols, sixCol }) {
  return (
    <div
      className={`grid ${sixCol ? 'grid-cols-6' : 'grid-cols-3'} gap-2 px-2 py-1`}
      style={{ borderBottom: '1px solid #44403c' }}
    >
      {cols.map(c => (
        <span
          key={c}
          className="text-[9px] font-mono uppercase tracking-widest"
          style={{ color: '#fb923c' }}
        >
          {c}
        </span>
      ))}
    </div>
  )
}

function VarianceCell({ value }) {
  const tone = varianceTone(value)
  const colors = {
    good:    '#86efac',
    danger:  '#fca5a5',
    neutral: '#a8a29e',
  }[tone]
  const Icon = value > 0 ? ArrowUp : value < 0 ? ArrowDown : Minus
  return (
    <span className="flex items-center gap-1" style={{ color: colors }}>
      <Icon className="w-3 h-3" />
      {(value > 0 ? '+' : '') + value.toFixed(1)}
    </span>
  )
}

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: '#fb923c' }}>
        {label}
      </span>
      {children}
    </div>
  )
}

function Select({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-2 py-1 text-[11px] font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
      style={{
        backgroundColor: '#1c1917',
        border: '1px solid #44403c',
        color: '#f4a261',
      }}
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

function CenterMsg({ children }) {
  return (
    <div className="h-full flex items-center justify-center" style={{ backgroundColor: '#1c1917' }}>
      <span className="text-[11px] font-mono uppercase tracking-wider" style={{ color: '#a8a29e' }}>
        {children}
      </span>
    </div>
  )
}

function Empty({ children }) {
  return (
    <div className="text-[11px] font-mono italic" style={{ color: '#78716c' }}>
      {children}
    </div>
  )
}

function varianceLabel(v) {
  if (v > 0) return 'Over budget'
  if (v < 0) return 'Under budget'
  return 'On target'
}

function varianceTone(v) {
  if (v > 0) return 'danger'
  if (v < 0) return 'good'
  return 'neutral'
}
