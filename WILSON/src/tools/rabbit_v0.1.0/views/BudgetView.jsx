// ============================================================
// RABBIT — BudgetView
// ============================================================
//
// Five-tab budget breakdown for the active project. Four of the
// tabs are hardcoded:
//
//   • Summary  — totals, variance, by-role rollup
//   • By Phase — phase-grouped bid/logged/variance/cost
//   • By Role  — role-grouped bid/logged/variance/cost
//   • By Asset — asset-grouped bid/logged/variance/cost
//
// The fifth ("Custom") is a placeholder slot Commit 16 wires up
// against the active rate card so users can drop a saved layout
// in. For Commit 15 we ship the four hardcoded tabs only and the
// Custom tab renders a coming-soon stub.
//
// Cost numbers in v0.1 fall back to 0 because the rate card glue
// is not yet plumbed in (Commit 16). Day counts are accurate today.

import { useMemo, useState } from 'react'
import {
  DollarSign, Layers, Boxes, UserCircle, Sparkles,
  ArrowUp, ArrowDown, Minus,
} from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
import CurrencyDisplay from '../components/CurrencyDisplay'

const TABS = [
  { id: 'summary',   label: 'Summary',  icon: DollarSign },
  { id: 'by_phase',  label: 'By Phase', icon: Layers     },
  { id: 'by_role',   label: 'By Role',  icon: UserCircle },
  { id: 'by_asset',  label: 'By Asset', icon: Boxes      },
  { id: 'custom',    label: 'Custom',   icon: Sparkles   },
]

export default function BudgetView() {
  const ctx = useRabbit()
  const project = ctx?.project
  const phases  = ctx?.phases  || []
  const assets  = ctx?.assets  || []
  const tasks   = ctx?.tasks   || []
  const loading = ctx?.loadingProject

  const [tab, setTab] = useState('summary')

  const variance = useMemo(
    () => ctx?.selectVarianceForProject?.() || { bid: 0, logged: 0, variance: 0 },
    [ctx]
  )

  const budget = useMemo(
    () => ctx?.selectProjectBudgetRollup?.() || { total: 0, byRole: {}, currency: 'USD' },
    [ctx]
  )

  if (loading) return <CenterMsg>Loading project…</CenterMsg>
  if (!project) return <CenterMsg>No project loaded</CenterMsg>

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: '#fef3e8' }}>
      {/* Tab strip */}
      <div
        className="flex items-center gap-1 px-4 py-2"
        style={{ backgroundColor: '#fff7ed', borderBottom: '1px solid #f4a261' }}
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
                color: active ? '#fff7ed' : '#7c2d12',
                backgroundColor: active ? '#ea580c' : 'transparent',
                border: '1px solid #7c2d12',
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
        {tab === 'summary'  && <SummaryTab variance={variance} budget={budget} tasks={tasks} />}
        {tab === 'by_phase' && <ByPhaseTab phases={phases} assets={assets} tasks={tasks} budget={budget} />}
        {tab === 'by_role'  && <ByRoleTab tasks={tasks} budget={budget} />}
        {tab === 'by_asset' && <ByAssetTab assets={assets} tasks={tasks} budget={budget} ctx={ctx} />}
        {tab === 'custom'   && <CustomTabStub />}
      </div>
    </div>
  )
}

// ─── Summary tab ────────────────────────────────────────────
function SummaryTab({ variance, budget, tasks }) {
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
            style={{ color: '#1c1917' }}
          />
          <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: '#7c2d12' }}>
            {budget.currency} · {Object.keys(budget.byRole).length} role{Object.keys(budget.byRole).length === 1 ? '' : 's'}
          </span>
        </div>
        {budget.total === 0 && (
          <p className="text-[10px] font-mono italic mt-2" style={{ color: '#7c2d12' }}>
            Costs are 0 until a rate card is wired in (next commit). Day counts above are live.
          </p>
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
function ByPhaseTab({ phases, assets, tasks, budget }) {
  const rows = useMemo(() => {
    const assetById = Object.fromEntries(assets.map(a => [a.id, a]))
    const phaseAggregate = {}
    for (const t of tasks) {
      const asset = assetById[t.asset_id]
      const phaseId = asset?.phase_id || '__unphased__'
      if (!phaseAggregate[phaseId]) {
        phaseAggregate[phaseId] = { phaseId, bid: 0, logged: 0, taskCount: 0 }
      }
      phaseAggregate[phaseId].bid    += Number(t.bid_days || 0)
      phaseAggregate[phaseId].logged += Number(t.logged_days || 0)
      phaseAggregate[phaseId].taskCount += 1
    }
    const phaseById = Object.fromEntries(phases.map(p => [p.id, p]))
    return Object.values(phaseAggregate)
      .map(row => ({
        ...row,
        name: row.phaseId === '__unphased__' ? 'Unphased' : (phaseById[row.phaseId]?.name || 'Unknown phase'),
        sortOrder: row.phaseId === '__unphased__' ? 9999 : (phaseById[row.phaseId]?.sort_order ?? 0),
        variance: row.logged - row.bid,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder)
  }, [phases, assets, tasks])

  if (rows.length === 0) return <Empty>No tasks yet — nothing to roll up.</Empty>

  return (
    <Card title="Phases">
      <BreakdownTable
        rows={rows}
        currency={budget.currency}
        labelHeader="Phase"
        countHeader="Tasks"
        countKey="taskCount"
      />
    </Card>
  )
}

// ─── By Role tab ────────────────────────────────────────────
function ByRoleTab({ tasks, budget }) {
  const rows = useMemo(() => {
    const agg = {}
    for (const t of tasks) {
      const role = t.assigned_role_slug || t.assigned_position || 'unassigned'
      if (!agg[role]) agg[role] = { name: role, bid: 0, logged: 0, taskCount: 0 }
      agg[role].bid    += Number(t.bid_days || 0)
      agg[role].logged += Number(t.logged_days || 0)
      agg[role].taskCount += 1
    }
    return Object.values(agg)
      .map(row => ({ ...row, variance: row.logged - row.bid }))
      .sort((a, b) => b.bid - a.bid)
  }, [tasks])

  if (rows.length === 0) return <Empty>No roles assigned yet.</Empty>

  return (
    <Card title="Roles">
      <BreakdownTable
        rows={rows}
        currency={budget.currency}
        labelHeader="Role"
        countHeader="Tasks"
        countKey="taskCount"
      />
    </Card>
  )
}

// ─── By Asset tab ───────────────────────────────────────────
function ByAssetTab({ assets, tasks, budget, ctx }) {
  const rows = useMemo(() => {
    const tasksByAsset = {}
    for (const t of tasks) {
      if (!tasksByAsset[t.asset_id]) tasksByAsset[t.asset_id] = []
      tasksByAsset[t.asset_id].push(t)
    }
    return assets
      .map(a => {
        const list = tasksByAsset[a.id] || []
        let bid = 0, logged = 0
        for (const t of list) {
          bid    += Number(t.bid_days || 0)
          logged += Number(t.logged_days || 0)
        }
        return {
          name: a.name,
          taskCount: list.length,
          bid,
          logged,
          variance: logged - bid,
        }
      })
      .filter(r => r.taskCount > 0 || r.bid > 0)
      .sort((a, b) => b.bid - a.bid)
  }, [assets, tasks])

  if (rows.length === 0) return <Empty>No assets carry any task hours yet.</Empty>

  return (
    <Card title="Assets">
      <BreakdownTable
        rows={rows}
        currency={budget.currency}
        labelHeader="Asset"
        countHeader="Tasks"
        countKey="taskCount"
      />
    </Card>
  )
}

// ─── Custom stub ────────────────────────────────────────────
function CustomTabStub() {
  return (
    <Card title="Custom breakdown">
      <div className="flex flex-col items-center gap-3 py-8">
        <Sparkles className="w-6 h-6" style={{ color: '#7c2d12' }} />
        <p className="text-[11px] font-mono text-center max-w-sm leading-relaxed" style={{ color: '#7c2d12' }}>
          Custom tab is wired up in the next commit. It will let you save a
          group-by + filter combo, drop in a rate card, and pin it as the
          default view for this project.
        </p>
      </div>
    </Card>
  )
}

// ─── Sub-components ─────────────────────────────────────────
function Card({ title, children }) {
  return (
    <div
      className="rounded-sm p-4 mb-4"
      style={{ backgroundColor: '#fff7ed', border: '2px solid #7c2d12' }}
    >
      {title && (
        <h3
          className="text-[11px] font-mono uppercase tracking-widest font-bold mb-3"
          style={{ color: '#1c1917' }}
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
    good:    { bg: '#dcfce7', border: '#15803d', text: '#15803d' },
    danger:  { bg: '#fee2e2', border: '#991b1b', text: '#991b1b' },
    neutral: { bg: '#fef3e8', border: '#7c2d12', text: '#1c1917' },
  }[tone]
  return (
    <div
      className="flex flex-col px-3 py-2 rounded-sm"
      style={{ backgroundColor: colors.bg, border: `2px solid ${colors.border}` }}
    >
      <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: colors.border }}>
        {label}
      </span>
      <span className="text-2xl font-mono font-bold" style={{ color: colors.text }}>{value}</span>
      {hint && (
        <span className="text-[10px] font-mono" style={{ color: colors.border }}>{hint}</span>
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
            style={{ backgroundColor: '#fef3e8', border: '1px solid #fed7aa' }}
          >
            <span style={{ color: '#1c1917' }}>{row.role}</span>
            <span style={{ color: '#7c2d12' }}>{row.days.toFixed(1)} d</span>
            <CurrencyDisplay
              value={row.cost}
              currency={currency}
              style={{ color: '#7c2d12' }}
            />
          </div>
        ))}
    </div>
  )
}

function BreakdownTable({ rows, currency, labelHeader, countHeader, countKey }) {
  return (
    <div className="flex flex-col gap-1">
      <HeaderRow cols={[labelHeader, countHeader, 'Bid', 'Logged', 'Variance', 'Cost']} sixCol />
      {rows.map((row, i) => (
        <div
          key={`${row.name}-${i}`}
          className="grid grid-cols-6 gap-2 px-2 py-1 rounded-sm text-[11px] font-mono items-center"
          style={{ backgroundColor: '#fef3e8', border: '1px solid #fed7aa' }}
        >
          <span className="truncate" style={{ color: '#1c1917' }}>{row.name}</span>
          <span style={{ color: '#7c2d12' }}>{row[countKey]}</span>
          <span style={{ color: '#7c2d12' }}>{row.bid.toFixed(1)}</span>
          <span style={{ color: '#7c2d12' }}>{row.logged.toFixed(1)}</span>
          <VarianceCell value={row.variance} />
          <CurrencyDisplay value={0} currency={currency} style={{ color: '#7c2d12' }} />
        </div>
      ))}
    </div>
  )
}

function HeaderRow({ cols, sixCol }) {
  return (
    <div
      className={`grid ${sixCol ? 'grid-cols-6' : 'grid-cols-3'} gap-2 px-2 py-1`}
      style={{ borderBottom: '1px solid #f4a261' }}
    >
      {cols.map(c => (
        <span
          key={c}
          className="text-[9px] font-mono uppercase tracking-widest"
          style={{ color: '#7c2d12' }}
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
    good:    '#15803d',
    danger:  '#991b1b',
    neutral: '#7c2d12',
  }[tone]
  const Icon = value > 0 ? ArrowUp : value < 0 ? ArrowDown : Minus
  return (
    <span className="flex items-center gap-1" style={{ color: colors }}>
      <Icon className="w-3 h-3" />
      {(value > 0 ? '+' : '') + value.toFixed(1)}
    </span>
  )
}

function CenterMsg({ children }) {
  return (
    <div className="h-full flex items-center justify-center" style={{ backgroundColor: '#fef3e8' }}>
      <span className="text-[11px] font-mono uppercase tracking-wider" style={{ color: '#7c2d12' }}>
        {children}
      </span>
    </div>
  )
}

function Empty({ children }) {
  return (
    <div className="text-[11px] font-mono italic" style={{ color: '#7c2d12' }}>
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
