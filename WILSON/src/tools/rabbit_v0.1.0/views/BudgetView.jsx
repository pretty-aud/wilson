// ============================================================
// RABBIT — BudgetView
// ============================================================
//
// Six-tab budget breakdown for the active project:
//
//   - Summary  — totals, margin, contingency, budget versioning, by-role
//   - By Phase — phase-grouped bid/logged/variance/cost
//   - By Role  — role-grouped bid/logged/variance/cost
//   - By Asset — asset-grouped bid/logged/variance/cost
//   - Custom   — user picks group-by + filter + rate card override
//
// Summary tab includes:
//   - Editable margin % and contingency % (stored on project)
//   - Budget versioning: create bid snapshots, select active, finalize
//   - Grand total: base + margin + contingency
//   - Variance against active bid version
//
// Costs come from `useRateCard()` — entries are flattened into a
// `{ role_slug → day_rate }` map. Tasks whose assigned_role_slug
// is missing fall back to 0 day rate.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import {
  DollarSign, Layers, Boxes, UserCircle, Sparkles, Receipt,
  ArrowUp, ArrowDown, Minus, AlertCircle, Save, Trash2,
  Lock, LockOpen, CheckCircle, Loader2, Plus, Pencil, X, Undo2, Redo2,
  Upload, FileText, Paperclip, Search, Filter, ArrowUpDown,
  BookmarkPlus, ChevronDown, ChevronRight, ShieldCheck, RotateCcw,
  Users, Star, Eye, CheckSquare, Square, MinusSquare,
  Film, Gamepad2, Zap,
} from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
import { useRateCard } from '../../../components/RateCard/useRateCard'
import { useExpenses } from '../../../components/Expenses/useExpenses'
import { useBudgetLines, COLUMN_MODES } from '../../../components/Budget/useBudgetLines'
import { useTeamMembers } from '../../../components/TeamMembers/useTeamMembers'
import { useProjectRateOverrides } from '../../../components/Budget/useProjectRateOverrides'
import { buildRoleRates } from '../../../components/Budget/budgetMath'
import CurrencyDisplay from '../components/CurrencyDisplay'
import CrewTeamTab from './budget/CrewTeamTab'
import TalentTab from './budget/TalentTab'
import ClientViewTab from './budget/ClientViewTab'

function fmtCurrency(val, currency = 'USD') {
  const n = Number(val) || 0
  return n.toLocaleString('en-US', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

const TABS = [
  { id: 'summary',        label: 'Summary',       icon: DollarSign },
  { id: 'by_phase',       label: 'By Phase',      icon: Layers     },
  { id: 'by_role',        label: 'By Role',       icon: UserCircle },
  { id: 'by_asset',       label: 'By Asset',      icon: Boxes      },
  { id: 'by_scene',       label: 'By Scene',      icon: Film,      requires: 'scenes_enabled' },
  { id: 'by_shot',        label: 'By Shot',       icon: Film,      requires: 'scenes_enabled' },
  { id: 'by_level',       label: 'By Level',      icon: Gamepad2,  requires: 'levels_enabled' },
  { id: 'by_experience',  label: 'By Experience', icon: Zap,       requires: 'experiences_enabled' },
  { id: 'custom',         label: 'Custom',        icon: Sparkles   },
  { id: '__div1__' },
  { id: 'crew',           label: 'Crew/Team',     icon: Users      },
  { id: 'talent',         label: 'Talent',        icon: Star       },
  { id: 'expenses',       label: 'Expenses',      icon: Receipt    },
  { id: '__div2__' },
  { id: 'client',         label: 'Client View',   icon: Eye        },
]

const GROUP_BY_OPTIONS = [
  { id: 'phase',      label: 'Phase'      },
  { id: 'role',       label: 'Role'       },
  { id: 'asset',      label: 'Asset'      },
  { id: 'scene',      label: 'Scene',      requires: 'scenes_enabled' },
  { id: 'shot',       label: 'Shot',       requires: 'scenes_enabled' },
  { id: 'level',      label: 'Level',      requires: 'levels_enabled' },
  { id: 'experience', label: 'Experience', requires: 'experiences_enabled' },
  { id: 'status',     label: 'Status'     },
  { id: 'priority',   label: 'Priority'   },
]

const STATUS_FILTER_OPTIONS = [
  { id: '__all__', label: 'All statuses' },
  { id: 'bidding', label: 'Bidding' },
  { id: 'waiting_to_start', label: 'Waiting to start' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'on_hold', label: 'On hold' },
  { id: 'pending_review', label: 'Pending review' },
  { id: 'needs_revisions', label: 'Needs Revisions' },
  { id: 'approved', label: 'Approved' },
  { id: 'final', label: 'Final' },
  { id: 'omitted', label: 'Omitted' },
]

export default function BudgetView() {
  const ctx = useRabbit()
  const project = ctx?.project
  const phases       = ctx?.phases       || []
  const assets       = ctx?.assets       || []
  const tasks        = ctx?.tasks        || []
  const scenes       = ctx?.scenes       || []
  const shots        = ctx?.shots        || []
  const levels       = ctx?.levels       || []
  const experiences  = ctx?.experiences  || []
  const loading = ctx?.loadingProject
  const budgetVersions = ctx?.budgetVersions || []

  const projectTeam = ctx?.projectTeam || []
  const syncProjectTeam = ctx?.syncProjectTeam

  const rateCard = useRateCard()
  const rateOverrides = useProjectRateOverrides()
  const expensesHook = useExpenses()
  const budgetHook = useBudgetLines()
  const tm = useTeamMembers()
  const [tab, setTab] = useState('summary')

  // ── Project-scoped team ───────────────────────────────────
  // teamAssignments (from the bundle) is the source of truth for which
  // workspace members belong to THIS project. The TeamView manages them
  // (assign / remove). We resolve the full member objects here so the
  // budget tabs have name, department, title, etc.
  const teamAssignments = ctx?.teamAssignments || []

  const assignedTeam = useMemo(() => {
    if (!teamAssignments.length || !tm.members?.length) return []
    const assignedIds = new Set(teamAssignments.map(a => a.member_id))
    return tm.members.filter(m => assignedIds.has(m.id))
  }, [teamAssignments, tm.members])

  // Sync the resolved member list into the bundle's projectTeam so it
  // mirrors to _DATABASES/team.json. Only fires when assignments change.
  const syncedRef = useRef(null)
  useEffect(() => {
    if (!project?.id || !syncProjectTeam) return
    const fp = assignedTeam.map(m => m.id).sort().join(',')
    if (syncedRef.current === `${project.id}::${fp}`) return
    syncedRef.current = `${project.id}::${fp}`
    syncProjectTeam(assignedTeam).catch(err => {
      console.error('projectTeam sync failed:', err)
    })
  }, [project?.id, assignedTeam, syncProjectTeam])

  // Build a slug -> day_rate lookup: the company rate card, with this
  // PROJECT's own overrides layered on top.
  //
  // Session 24. A rate edited inside a project is project-scoped and must
  // never write back to the workspace rate card (Audrey, twice) — otherwise
  // negotiating one project's rate silently rewrites every other project's
  // numbers. The layering rule and its tests live in budgetMath.js.
  const roleRates = useMemo(
    () => buildRoleRates(rateCard.entries || [], rateOverrides.overrides || []),
    [rateCard.entries, rateOverrides.overrides]
  )

  // Session 24: the per-project JOB TITLE, keyed by member.
  //
  // 🚨 Read from `project_title`, NOT `project_role`. project_role is the
  // permission setting (manager/member/reviewer) behind every RLS gate;
  // Audrey's "project role" is a free-text job title like "Lead Animator".
  // They are separate columns and must stay that way.
  const projectTitles = useMemo(() => {
    const map = {}
    for (const a of teamAssignments) {
      if (a?.member_id) map[a.member_id] = a.project_title || ''
    }
    return map
  }, [teamAssignments])

  // MEASURED on the beta 2026-08-03: zero rate cards, zero entries. With no
  // rates, every total is legitimately zero — so say so, rather than
  // rendering a confident $0 that reads as a broken budget.
  const hasNoRates = (rateCard.entries || []).length === 0
                  && (rateOverrides.overrides || []).length === 0

  const variance = useMemo(
    () => ctx?.selectVarianceForProject?.() || { bid: 0, logged: 0, variance: 0 },
    [ctx]
  )

  const budget = useMemo(
    () => ctx?.selectProjectBudgetRollup?.({ roleRates }) || { total: 0, byRole: {}, currency: 'USD' },
    [ctx, roleRates]
  )

  const missingRolesCount = useMemo(() => {
    let n = 0
    for (const t of tasks) {
      const slug = t.assigned_role_slug
      if (!slug) continue
      if (!(slug in roleRates)) n += 1
    }
    return n
  }, [tasks, roleRates])

  if (loading) return <CenterMsg>Loading project...</CenterMsg>
  if (!project) return <CenterMsg>No project loaded</CenterMsg>

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: '#1c1917' }}>
      {/* Tab strip */}
      <div
        className="flex items-center gap-2 px-5 py-2.5"
        style={{ borderBottom: '1px solid #44403c' }}
      >
        {TABS.filter(t => !t.requires || project?.[t.requires]).map(t => {
          if (t.id.startsWith('__div')) {
            return <div key={t.id} className="self-stretch flex items-center mx-1"><div style={{ width: 1, height: 16, backgroundColor: '#292524' }} /></div>
          }
          const active = tab === t.id
          const Icon = t.icon
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm transition-colors"
              style={{
                color: active ? '#fff7ed' : '#a8a29e',
                backgroundColor: active ? '#ea580c' : 'transparent',
                borderBottom: active ? '2px solid #ea580c' : '2px solid transparent',
              }}
            >
              <Icon className="w-3 h-3" />
              <span className="text-[10.5px] font-mono uppercase tracking-wider">
                {t.label}
              </span>
            </button>
          )
        })}
      </div>

      {/* Session 24: an empty rate card is the difference between "this
          budget is zero" and "this budget cannot be calculated yet". Without
          this, both render as $0 and the second looks like a bug. */}
      {hasNoRates && (
        <div
          className="flex items-start gap-2 px-5 py-2.5"
          style={{ backgroundColor: '#292524', borderBottom: '1px solid #44403c' }}
        >
          <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" style={{ color: '#fb923c' }} />
          <div className="text-[10.5px] font-mono leading-relaxed" style={{ color: '#d6d3d1' }}>
            <span style={{ color: '#fb923c' }}>NO RATE CARD YET.</span>{' '}
            Bids are calculated as a role&rsquo;s rate &times; the days assigned to it, so
            every total below will stay at zero until this workspace has rate-card
            roles with rates. Add them in <span style={{ color: '#fff7ed' }}>Resources &rsaquo; Rate Card</span>.
            Everything else on this page — actuals, expenses, margin and contingency — works now.
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto p-6">
        {tab === 'summary'  && (
          <SummaryTab
            ctx={ctx}
            project={project}
            variance={variance}
            budget={budget}
            tasks={tasks}
            roleRates={roleRates}
            missingRolesCount={missingRolesCount}
            rateCardName={rateCard.rateCards.find(c => c.id === rateCard.activeRateCardId)?.name}
            budgetVersions={budgetVersions}
            budgetHook={budgetHook}
            rateCard={rateCard}
            teamMembers={assignedTeam}
            expensesHook={expensesHook}
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
        {tab === 'by_scene' && (
          <BySceneTab scenes={scenes} tasks={tasks} budget={budget} roleRates={roleRates} />
        )}
        {tab === 'by_shot' && (
          <ByShotTab shots={shots} scenes={scenes} tasks={tasks} budget={budget} roleRates={roleRates} />
        )}
        {tab === 'by_level' && (
          <ByLevelTab levels={levels} tasks={tasks} budget={budget} roleRates={roleRates} />
        )}
        {tab === 'by_experience' && (
          <ByExperienceTab experiences={experiences} tasks={tasks} budget={budget} roleRates={roleRates} />
        )}
        {tab === 'custom'   && (
          <CustomTab
            project={project}
            phases={phases}
            assets={assets}
            tasks={tasks}
            scenes={scenes}
            shots={shots}
            levels={levels}
            experiences={experiences}
            budget={budget}
            roleRates={roleRates}
          />
        )}
        {tab === 'crew' && (
          <CrewTeamTab
            budgetHook={budgetHook}
            project={project}
            tasks={tasks}
            roleRates={roleRates}
            rateCard={rateCard}
            teamMembers={assignedTeam}
            expenses={expensesHook.expenses}
            currency={budget.currency}
            projectTitles={projectTitles}
            onSaveProjectTitle={ctx?.updateProjectMemberTitle}
          />
        )}
        {tab === 'talent' && (
          <TalentTab
            budgetHook={budgetHook}
            project={project}
            expenses={expensesHook.expenses}
            currency={budget.currency}
          />
        )}
        {tab === 'expenses' && (
          <ExpensesTab
            ctx={ctx}
            project={project}
            phases={phases}
            assets={assets}
            tasks={tasks}
            expensesHook={expensesHook}
            currency={budget.currency}
          />
        )}
        {tab === 'client' && (
          <ClientViewTab
            budget={budget}
            budgetHook={budgetHook}
            project={project}
            tasks={tasks}
            roleRates={roleRates}
            expensesHook={expensesHook}
            currency={budget.currency}
          />
        )}
      </div>
    </div>
  )
}

// ─── Cost helpers ───────────────────────────────��───────────
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
function SummaryTab({ ctx, project, variance, budget, tasks, roleRates, missingRolesCount, rateCardName, budgetVersions, budgetHook, rateCard, teamMembers, expensesHook }) {
  const knownRoles = Object.keys(roleRates).length

  // ── Margin / Contingency (stored on project) ──
  const marginPct = Number(project.budget_margin_pct ?? 0) || 0
  const contingencyPct = Number(project.budget_contingency_pct ?? 0) || 0
  const agencyEnabled = project?.budget_agency_enabled === true
  const agencyPct     = Number(project?.budget_agency_pct ?? 20)
  const baseCost = budget.total
  const marginAmt = Math.round(baseCost * (marginPct / 100) * 100) / 100
  const contingencyAmt = Math.round(baseCost * (contingencyPct / 100) * 100) / 100
  const grandTotal = Math.round((baseCost + marginAmt + contingencyAmt) * 100) / 100
  const currency = budget.currency

  function updateProjectField(field, value) {
    ctx?.updateProject?.(project.id, { [field]: value })
  }

  // ── Budget versioning ──
  const adapter = ctx?.getAdapter?.()
  const [versionName, setVersionName] = useState('')
  const [versionBusy, setVersionBusy] = useState(false)
  const activeVersion = budgetVersions.find(v => v.is_active)
  const isFinal = project.budget_finalized === true

  async function createBidVersion() {
    if (!versionName.trim() || !adapter?.upsertBudgetVersion) return
    setVersionBusy(true)
    try {
      const snapshot = {
        tasks: tasks.map(t => ({
          id: t.id, asset_id: t.asset_id,
          assigned_role_slug: t.assigned_role_slug,
          assigned_position: t.assigned_position,
          bid_days: t.bid_days, logged_days: t.logged_days,
          status: t.status,
        })),
        roleRates: { ...roleRates },
        baseCost, marginPct, contingencyPct, grandTotal,
        totalBidDays: variance.bid,
      }
      await adapter.upsertBudgetVersion({
        id: uuidv4(),
        project_id: project.id,
        name: versionName.trim(),
        type: 'bid',
        is_active: budgetVersions.length === 0,
        created_at: new Date().toISOString(),
        snapshot,
      })
      setVersionName('')
      // Refresh bundle
      ctx?.setActiveProject?.(project.id)
    } catch (err) {
      console.error('Failed to create budget version:', err)
    } finally {
      setVersionBusy(false)
    }
  }

  async function setActiveVersion(versionId) {
    if (!adapter?.upsertBudgetVersion) return
    setVersionBusy(true)
    try {
      for (const v of budgetVersions) {
        if (v.is_active !== (v.id === versionId)) {
          await adapter.upsertBudgetVersion({
            ...v,
            is_active: v.id === versionId,
          })
        }
      }
      ctx?.setActiveProject?.(project.id)
    } catch (err) {
      console.error('Failed to set active version:', err)
    } finally {
      setVersionBusy(false)
    }
  }

  async function deleteVersion(versionId) {
    if (!adapter?.deleteBudgetVersion) return
    setVersionBusy(true)
    try {
      await adapter.deleteBudgetVersion(versionId, project.id)
      ctx?.setActiveProject?.(project.id)
    } catch (err) {
      console.error('Failed to delete budget version:', err)
    } finally {
      setVersionBusy(false)
    }
  }

  // ── Bid → Active workflow ──
  const [showActivateConfirm, setShowActivateConfirm] = useState(false)
  const isActive = project.budget_active === true
  const lockedVersionId = project.budget_active_version_id || null
  const lockedVersion = lockedVersionId ? budgetVersions.find(v => v.id === lockedVersionId) : null

  async function activateBudget() {
    if (!activeVersion) return
    // Enrich the snapshot with additional locked data
    const enrichedSnapshot = {
      ...(activeVersion.snapshot || {}),
      taskCount: tasks.length,
      taskDurations: tasks.map(t => ({ id: t.id, name: t.name || t.title, bid_days: t.bid_days, status: t.status })),
      lineItemTotals: {
        baseCost, marginPct, marginAmt, contingencyPct, contingencyAmt, grandTotal,
        agencyEnabled, agencyPct,
        agencyAmt: agencyEnabled ? Math.round(baseCost * (agencyPct / 100)) : 0,
      },
      lockedAt: new Date().toISOString(),
    }
    // Save the enriched snapshot back onto the version
    if (adapter?.upsertBudgetVersion) {
      await adapter.upsertBudgetVersion({ ...activeVersion, snapshot: enrichedSnapshot })
    }
    // Mark project as active with the locked version
    ctx?.updateProject?.(project.id, {
      budget_active: true,
      budget_active_version_id: activeVersion.id,
      budget_finalized: true,
    })
    setShowActivateConfirm(false)
    ctx?.setActiveProject?.(project.id)
  }

  async function resetToTidding() {
    ctx?.updateProject?.(project.id, {
      budget_active: false,
      budget_active_version_id: null,
      budget_finalized: false,
    })
    ctx?.setActiveProject?.(project.id)
  }

  // ── Active version variance ──
  const versionVariance = useMemo(() => {
    if (!activeVersion?.snapshot) return null
    const bidTotal = activeVersion.snapshot.grandTotal ?? activeVersion.snapshot.baseCost ?? 0
    const diff = grandTotal - bidTotal
    return { bidTotal, currentTotal: grandTotal, diff, pctChange: bidTotal > 0 ? (diff / bidTotal) * 100 : 0 }
  }, [activeVersion, grandTotal])

  return (
    <div className="flex flex-col gap-4">
      {/* ── Active budget banner ── */}
      {isActive && lockedVersion && (
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-sm"
          style={{ backgroundColor: '#14532d', border: '1px solid #22c55e' }}
        >
          <ShieldCheck className="w-5 h-5 flex-shrink-0" style={{ color: '#4ade80' }} />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-mono font-bold uppercase block" style={{ color: '#4ade80' }}>
              Budget active — In production
            </span>
            <span className="text-xs font-mono block mt-0.5" style={{ color: '#86efac' }}>
              Locked bid: <span className="font-bold">{lockedVersion.name}</span>
              {' '}· {lockedVersion.snapshot?.lockedAt
                ? new Date(lockedVersion.snapshot.lockedAt).toLocaleDateString()
                : lockedVersion.created_at ? new Date(lockedVersion.created_at).toLocaleDateString() : ''}
              {' '}· {fmtCurrency(lockedVersion.snapshot?.lineItemTotals?.grandTotal ?? lockedVersion.snapshot?.grandTotal ?? 0, currency)}
            </span>
          </div>
          <button
            type="button"
            onClick={resetToTidding}
            className="flex items-center gap-1.5 text-[10.5px] font-mono px-2.5 py-1 rounded-sm hover:bg-green-900 transition-colors flex-shrink-0"
            style={{ color: '#86efac', border: '1px solid #22c55e' }}
            title="Reset to bidding — re-enables bid version editing"
          >
            <RotateCcw className="w-3 h-3" />
            Reset to Bidding
          </button>
        </div>
      )}

      {/* ── Day totals row ── */}
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

      {/* ── Cost Breakdown — clean waterfall with inline controls ── */}
      {/* UX: Proximity (controls next to values), Fitts's (wide touch targets), */}
      {/* Miller's (single scannable list), Jakob's (receipt/invoice familiarity) */}
      <Card title="Cost breakdown">
        <div className="flex flex-col gap-0">
          {/* Base cost — read only */}
          <div className="flex items-center justify-between py-3 px-4 rounded-sm mb-1"
            style={{ backgroundColor: '#1c1917' }}>
            <span className="text-[13.5px] font-mono font-bold uppercase tracking-wider" style={{ color: '#d6d3d1' }}>
              Base cost
            </span>
            <div className="text-base font-mono font-bold text-right" style={{ color: '#d6d3d1', width: 160, flexShrink: 0 }}>
              <CurrencyDisplay value={baseCost} currency={currency} style={{ color: '#d6d3d1' }} />
            </div>
          </div>

          {/* Margin — inline editable */}
          <WaterfallRow
            label="Margin"
            pct={marginPct}
            amount={marginAmt}
            currency={currency}
            onPctChange={v => updateProjectField('budget_margin_pct', v)}
            disabled={isActive}
          />

          {/* Contingency — inline editable */}
          <WaterfallRow
            label="Contingency"
            pct={contingencyPct}
            amount={contingencyAmt}
            currency={currency}
            onPctChange={v => updateProjectField('budget_contingency_pct', v)}
            disabled={isActive}
          />

          {/* Agency fee — toggle + inline editable */}
          <div className="flex items-center justify-between py-3 px-4 rounded-sm mb-1"
            style={{ backgroundColor: '#1c1917' }}>
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-mono" style={{ color: '#a8a29e' }}>+ Agency fee</span>
              <button
                type="button"
                onClick={() => {
                  if (!agencyEnabled) {
                    updateProjectField('budget_agency_enabled', true)
                    if (!project?.budget_agency_pct) updateProjectField('budget_agency_pct', 20)
                  } else {
                    updateProjectField('budget_agency_enabled', false)
                  }
                }}
                disabled={isActive}
                className="relative w-8 h-4 rounded-full transition-colors"
                style={{ backgroundColor: agencyEnabled ? '#ea580c' : '#44403c', cursor: isFinal ? 'not-allowed' : 'pointer' }}
              >
                <span className="absolute top-[2px] left-0 rounded-full w-3 h-3 transition-transform"
                  style={{ backgroundColor: '#fff7ed', transform: agencyEnabled ? 'translateX(18px)' : 'translateX(2px)' }} />
              </button>
              {agencyEnabled && (
                <InlinePct value={agencyPct}
                  onChange={v => updateProjectField('budget_agency_pct', v)}
                  disabled={isActive} />
              )}
            </div>
            <div className="text-[13.5px] font-mono text-right" style={{ color: agencyEnabled ? '#a8a29e' : '#57534e', width: 160, flexShrink: 0 }}>
              {agencyEnabled ? `+` : ''}{' '}
              {agencyEnabled
                ? <CurrencyDisplay value={Math.round(baseCost * (agencyPct / 100))} currency={currency} style={{ color: '#a8a29e' }} />
                : 'OFF'}
            </div>
          </div>

          {/* Divider */}
          <div style={{ borderTop: '2px solid #57534e', margin: '4px 0 6px' }} />

          {/* Grand total */}
          <div className="flex items-center justify-between py-4 px-4 rounded-sm"
            style={{ backgroundColor: '#292524', border: '1px solid #57534e' }}>
            <span className="text-base font-mono font-bold uppercase tracking-wider" style={{ color: '#fb923c' }}>
              Grand Total
            </span>
            <div className="text-2xl font-mono font-bold text-right" style={{ color: '#d6d3d1', width: 160, flexShrink: 0 }}>
              <CurrencyDisplay
                value={grandTotal + (agencyEnabled ? Math.round(baseCost * (agencyPct / 100)) : 0)}
                currency={currency}
                style={{ color: '#d6d3d1' }} />
            </div>
          </div>
        </div>

        {/* Footer info row */}
        <div className="flex items-center justify-between mt-3 px-1">
          <div className="flex items-center gap-3">
            {rateCardName && (
              <span className="text-xs font-mono" style={{ color: '#78716c' }}>
                Rates via <span style={{ color: '#a8a29e' }}>{rateCardName}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11.5px] font-mono uppercase tracking-widest" style={{ color: '#78716c' }}>Actuals</span>
            <select
              value={project?.budget_actual_column_mode || 'fortnightly'}
              onChange={e => updateProjectField('budget_actual_column_mode', e.target.value)}
              disabled={isActive}
              className="px-2 py-1 text-xs font-mono rounded-sm focus:ring-1 focus:ring-orange-500"
              style={{ backgroundColor: '#1c1917', border: '1px solid #44403c', color: '#a8a29e' }}
            >
              {COLUMN_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <input
              type="number" min={1} max={100}
              value={Number(project?.budget_actual_column_count ?? 20)}
              onChange={e => {
                const n = parseInt(e.target.value, 10)
                if (Number.isFinite(n) && n > 0 && n <= 100) updateProjectField('budget_actual_column_count', n)
              }}
              disabled={isActive}
              className="w-12 px-2 py-1 text-xs font-mono rounded-sm text-center focus:ring-1 focus:ring-orange-500"
              style={{ backgroundColor: '#1c1917', border: '1px solid #44403c', color: '#a8a29e' }}
            />
            <span className="text-[11.5px] font-mono" style={{ color: '#78716c' }}>cols</span>
          </div>
        </div>

        {missingRolesCount > 0 && (
          <div
            className="mt-3 flex items-start gap-2 p-2 rounded-sm"
            style={{ backgroundColor: '#1c1917', border: '1px solid #78350f' }}
          >
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: '#fcd34d' }} />
            <p className="text-xs font-mono leading-relaxed" style={{ color: '#fcd34d' }}>
              {missingRolesCount} task{missingRolesCount === 1 ? '' : 's'} reference roles
              not in the rate card — those rows compute at $0.
              ({knownRoles} role{knownRoles === 1 ? '' : 's'} currently in the card.)
            </p>
          </div>
        )}
      </Card>

      {/* ── Budget versioning ── */}
      <Card title="Budget versions">
        {/* Create new bid */}
        <div className="flex items-end gap-2 mb-4">
          <div className="flex-1">
            <span className="text-[11.5px] font-mono uppercase tracking-widest block mb-1.5" style={{ color: '#fb923c' }}>
              Save current as bid version
            </span>
            <input
              type="text"
              value={versionName}
              onChange={e => setVersionName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') createBidVersion() }}
              placeholder="e.g. Bid v1 — initial estimate"
              disabled={isActive || versionBusy}
              className="w-full px-3 py-2 text-sm font-mono rounded-sm focus:ring-2 focus:ring-orange-500"
              style={{ backgroundColor: '#1c1917', border: '1px solid #44403c', color: '#f4a261' }}
            />
          </div>
          <button
            type="button"
            onClick={createBidVersion}
            disabled={!versionName.trim() || isActive || versionBusy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-mono uppercase tracking-wider font-bold transition-colors disabled:opacity-40"
            style={{ backgroundColor: '#ea580c', color: '#fff7ed', border: '1px solid #c2410c' }}
          >
            {versionBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            Save
          </button>
        </div>

        {/* Saved versions list */}
        {budgetVersions.length === 0 ? (
          <Empty>No budget versions saved yet. Create one to track bid snapshots.</Empty>
        ) : (
          <div className="flex flex-col gap-1">
            <div
              className="grid grid-cols-12 gap-2 px-3 py-1.5"
              style={{ borderBottom: '1px solid #44403c' }}
            >
              <span className="col-span-1 text-[10.5px] font-mono uppercase tracking-widest" style={{ color: '#78716c' }}>Active</span>
              <span className="col-span-4 text-[10.5px] font-mono uppercase tracking-widest" style={{ color: '#78716c' }}>Name</span>
              <span className="col-span-2 text-[10.5px] font-mono uppercase tracking-widest" style={{ color: '#78716c' }}>Date</span>
              <span className="col-span-2 text-[10.5px] font-mono uppercase tracking-widest text-right" style={{ color: '#78716c' }}>Total</span>
              <span className="col-span-1 text-[10.5px] font-mono uppercase tracking-widest text-right" style={{ color: '#78716c' }}>Days</span>
              <span className="col-span-2 text-[10.5px] font-mono uppercase tracking-widest text-right" style={{ color: '#78716c' }}>Actions</span>
            </div>
            {budgetVersions
              .slice()
              .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
              .map(v => (
                <div
                  key={v.id}
                  className="grid grid-cols-12 gap-2 px-2 py-2 rounded-sm text-xs font-mono items-center"
                  style={{
                    backgroundColor: isActive && v.id === lockedVersionId ? '#1a2e1a'
                      : v.is_active ? '#292524' : '#1c1917',
                    border: `1px solid ${isActive && v.id === lockedVersionId ? '#22c55e'
                      : v.is_active ? '#ea580c' : '#44403c'}`,
                  }}
                >
                  <span className="col-span-1">
                    {isActive && v.id === lockedVersionId ? (
                      <ShieldCheck className="w-3.5 h-3.5" style={{ color: '#4ade80' }} />
                    ) : v.is_active ? (
                      <CheckCircle className="w-3.5 h-3.5" style={{ color: '#fb923c' }} />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setActiveVersion(v.id)}
                        disabled={versionBusy || isActive}
                        className="p-0.5 rounded-sm hover:bg-stone-800 transition-colors disabled:opacity-30"
                        style={{ color: '#78716c' }}
                        title={isActive ? 'Reset to bidding to change versions' : 'Set as active'}
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </span>
                  <span className="col-span-4 truncate" style={{
                    color: isActive && v.id === lockedVersionId ? '#86efac'
                      : v.is_active ? '#fb923c' : '#d6d3d1'
                  }}>
                    {v.name}
                    {isActive && v.id === lockedVersionId && (
                      <span className="ml-1.5 text-[8.5px] uppercase tracking-wider px-1 py-0.5 rounded-sm"
                        style={{ backgroundColor: '#166534', color: '#4ade80', border: '1px solid #22c55e' }}>
                        Locked
                      </span>
                    )}
                  </span>
                  <span className="col-span-2" style={{ color: '#78716c' }}>
                    {v.created_at ? new Date(v.created_at).toLocaleDateString() : '—'}
                  </span>
                  <span className="col-span-2 text-right" style={{ color: '#a8a29e' }}>
                    <CurrencyDisplay
                      value={v.snapshot?.grandTotal ?? v.snapshot?.baseCost ?? 0}
                      currency={currency}
                    />
                  </span>
                  <span className="col-span-1 text-right" style={{ color: '#a8a29e' }}>
                    {(v.snapshot?.totalBidDays ?? 0).toFixed(1)}
                  </span>
                  <span className="col-span-2 flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => deleteVersion(v.id)}
                      disabled={versionBusy || (isActive && v.id === lockedVersionId)}
                      className="p-1 rounded-sm hover:bg-red-900/40 transition-colors disabled:opacity-20"
                      style={{ color: '#ef4444' }}
                      title={isActive && v.id === lockedVersionId ? 'Cannot delete locked version' : 'Delete version'}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </span>
                </div>
              ))}
          </div>
        )}

        {/* Variance against active version */}
        {versionVariance && (
          <div
            className="mt-3 p-3 rounded-sm"
            style={{
              backgroundColor: '#1c1917',
              border: `1px solid ${Math.abs(versionVariance.diff) < 0.01 ? '#44403c' : versionVariance.diff > 0 ? '#7f1d1d' : '#14532d'}`,
            }}
          >
            <span className="text-[11.5px] font-mono uppercase tracking-widest block mb-2" style={{ color: '#fb923c' }}>
              Variance vs active bid ({activeVersion?.name})
            </span>
            <div className="flex items-baseline gap-4">
              <span className="text-xl font-mono font-bold" style={{
                color: Math.abs(versionVariance.diff) < 0.01 ? '#a8a29e' : versionVariance.diff > 0 ? '#fca5a5' : '#86efac',
              }}>
                {versionVariance.diff > 0 ? '+' : ''}<CurrencyDisplay value={versionVariance.diff} currency={currency} />
              </span>
              <span className="text-xs font-mono" style={{ color: '#78716c' }}>
                ({versionVariance.pctChange > 0 ? '+' : ''}{versionVariance.pctChange.toFixed(1)}%)
              </span>
              <span className="text-xs font-mono" style={{ color: '#57534e' }}>
                Bid: <CurrencyDisplay value={versionVariance.bidTotal} currency={currency} />
                {' '}| Current: <CurrencyDisplay value={versionVariance.currentTotal} currency={currency} />
              </span>
            </div>
          </div>
        )}

        {/* Set Active button + confirmation dialog */}
        {!isActive && budgetVersions.length > 0 && activeVersion && !showActivateConfirm && (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => setShowActivateConfirm(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-sm text-xs font-mono uppercase tracking-wider font-bold transition-colors hover:brightness-110"
              style={{ backgroundColor: '#14532d', color: '#4ade80', border: '1px solid #22c55e' }}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Set Budget Active
            </button>
          </div>
        )}

        {/* Confirmation dialog */}
        {showActivateConfirm && (
          <div className="mt-3 p-4 rounded-sm" style={{ backgroundColor: '#1c1917', border: '2px solid #d97706' }}>
            <div className="flex items-start gap-3 mb-3">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#fbbf24' }} />
              <div>
                <span className="text-sm font-mono font-bold block" style={{ color: '#fbbf24' }}>
                  Confirm: Set budget to active
                </span>
                <p className="text-[11.5px] font-mono mt-1.5 leading-relaxed" style={{ color: '#d6d3d1' }}>
                  This will lock <span className="font-bold" style={{ color: '#fbbf24' }}>"{activeVersion?.name}"</span> as
                  the approved bid for this project. A snapshot of all task counts, durations, and budget totals
                  will be frozen as the reference point for production.
                </p>
                <p className="text-[11.5px] font-mono mt-2 leading-relaxed" style={{ color: '#a8a29e' }}>
                  While active, you will not be able to create new bid versions or switch between versions.
                  You can reset this later if needed.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-3 pt-3" style={{ borderTop: '1px solid #44403c' }}>
              <button
                type="button"
                onClick={() => setShowActivateConfirm(false)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-mono uppercase tracking-wider transition-colors hover:bg-stone-800"
                style={{ color: '#a8a29e', border: '1px solid #44403c' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={activateBudget}
                disabled={versionBusy}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-sm text-xs font-mono uppercase tracking-wider font-bold transition-colors hover:brightness-110"
                style={{ backgroundColor: '#d97706', color: '#fff7ed', border: '1px solid #b45309' }}
              >
                {versionBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
                Confirm — Set Active
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* ── Topsheet rollup (from budget lines) ── */}
      {budgetHook && (
        <TopsheetRollup
          budgetHook={budgetHook} project={project} currency={currency}
          tasks={tasks} roleRates={roleRates} rateCard={rateCard}
          teamMembers={teamMembers} expensesHook={expensesHook}
        />
      )}
    </div>
  )
}




// ─── Topsheet rollup — grouped by Crew/Team, Talent, Expenses ──
function TopsheetRollup({ budgetHook, project, currency, tasks, roleRates, rateCard, teamMembers, expensesHook }) {
  const { lines, lineComputations } = budgetHook
  const agencyEnabled = project?.budget_agency_enabled === true
  const agencyPct = Number(project?.budget_agency_pct ?? 0) / 100

  function fmtC(val) {
    return (Number(val) || 0).toLocaleString('en-US', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 })
  }

  // ── Crew/Team: derived from team members + rate card + tasks ──
  const crewData = useMemo(() => {
    const rateMap = {}
    for (const e of (rateCard?.entries || [])) {
      if (!e.role_slug) continue
      const rate = Number(e.wage || e.day_rate || 0)
      if (rate > 0 && !rateMap[e.role_slug]) rateMap[e.role_slug] = rate
    }
    if (roleRates) {
      for (const [slug, rate] of Object.entries(roleRates)) {
        if (!rateMap[slug]) rateMap[slug] = rate
      }
    }
    const bidDaysByRole = {}
    for (const t of (tasks || [])) {
      const slug = t.assigned_role_slug
      if (slug) bidDaysByRole[slug] = (bidDaysByRole[slug] || 0) + Number(t.bid_days || 0)
    }
    const deptMap = {}
    for (const m of (teamMembers || [])) {
      // Look up role via rate card entry (role_slug is on rate card, not on member)
      const memberEntry = (rateCard?.entries || []).find(e => e.member_id === m.id)
      const roleSlug = memberEntry?.role_slug
      const rate = memberEntry ? Number(memberEntry.wage || memberEntry.day_rate || 0) : (roleSlug ? (rateMap[roleSlug] || 0) : 0)
      const days = roleSlug ? Number(bidDaysByRole[roleSlug] || 0) : 0
      // Every project-team member gets a department bucket (even at zero)
      const dept = m.department || 'Uncategorized'
      if (!deptMap[dept]) deptMap[dept] = { department: dept, subtotal: 0, agencyFee: 0, bidTotal: 0, actualTotal: 0 }
      const sub = rate * days
      const agency = agencyEnabled ? sub * agencyPct : 0
      deptMap[dept].subtotal += sub
      deptMap[dept].agencyFee += agency
      deptMap[dept].bidTotal += sub + agency
    }
    // Actuals from crew budget lines
    for (const line of lines.filter(l => l.sheet === 'crew' && !l.is_section_header)) {
      const dept = line.department || 'Uncategorized'
      if (!deptMap[dept]) deptMap[dept] = { department: dept, subtotal: 0, agencyFee: 0, bidTotal: 0, actualTotal: 0 }
      const comp = lineComputations[line.id]
      if (comp) deptMap[dept].actualTotal += comp.actualTotal
    }
    const departments = Object.values(deptMap).filter(d => d.bidTotal > 0 || d.actualTotal > 0).sort((a, b) => b.bidTotal - a.bidTotal)
    const total = departments.reduce((acc, d) => ({
      subtotal: acc.subtotal + d.subtotal, agencyFee: acc.agencyFee + d.agencyFee,
      bidTotal: acc.bidTotal + d.bidTotal, actualTotal: acc.actualTotal + d.actualTotal,
    }), { subtotal: 0, agencyFee: 0, bidTotal: 0, actualTotal: 0 })
    return { departments, total }
  }, [teamMembers, rateCard?.entries, roleRates, tasks, lines, lineComputations, agencyEnabled, agencyPct])

  // ── Talent: from budget lines (grouped by talent_type) ──
  const talentData = useMemo(() => {
    const TALENT_TYPE_PLURAL = {
      actor:            'Actors',
      voice_actor:      'Voice Actors',
      extra:            'Extras',
      background:       'Backgrounds',
      stunt_performer:  'Stunt Performers',
      motion_capture:   'Motion Capture Performers',
      other:            'Others',
    }
    const typeMap = {}
    for (const line of lines.filter(l => l.sheet === 'talent' && !l.is_section_header)) {
      const type = line.talent_type || 'other'
      const label = TALENT_TYPE_PLURAL[type] || 'Others'
      if (!typeMap[type]) typeMap[type] = { type, label, subtotal: 0, agencyFee: 0, bidTotal: 0, actualTotal: 0 }
      const comp = lineComputations[line.id]
      if (comp) {
        typeMap[type].subtotal += comp.subtotal
        typeMap[type].agencyFee += comp.agencyFee
        typeMap[type].bidTotal += comp.bidTotal
        typeMap[type].actualTotal += comp.actualTotal
      }
    }
    const types = Object.values(typeMap).sort((a, b) => b.bidTotal - a.bidTotal)
    const total = types.reduce((acc, d) => ({
      subtotal: acc.subtotal + d.subtotal, agencyFee: acc.agencyFee + d.agencyFee,
      bidTotal: acc.bidTotal + d.bidTotal, actualTotal: acc.actualTotal + d.actualTotal,
    }), { subtotal: 0, agencyFee: 0, bidTotal: 0, actualTotal: 0 })
    return { types, departments: types, total }
  }, [lines, lineComputations])

  // ── Expenses: from expenses system ──
  const expenseData = useMemo(() => {
    const list = expensesHook?.expenses || []
    const estimated = list.reduce((s, e) => s + (Number(e.estimated_cost) || 0), 0)
    const actual = list.reduce((s, e) => s + (Number(e.actual_cost) || 0), 0)
    return { estimated, actual, count: list.length }
  }, [expensesHook?.expenses])

  // Grand totals
  const grand = {
    subtotal: crewData.total.subtotal + talentData.total.subtotal + expenseData.estimated,
    agencyFee: crewData.total.agencyFee + talentData.total.agencyFee,
    bidTotal: crewData.total.bidTotal + talentData.total.bidTotal + expenseData.estimated,
    actualTotal: crewData.total.actualTotal + talentData.total.actualTotal + expenseData.actual,
  }
  grand.variance = grand.actualTotal - grand.bidTotal

  const hasData = crewData.departments.length > 0 || talentData.departments.length > 0 || expenseData.count > 0

  if (!hasData) {
    return (
      <Card title="Topsheet rollup">
        <Empty>No budget data yet. Add team members, talent lines, or expenses to see the rollup here.</Empty>
      </Card>
    )
  }

  // Column header
  const colW = { dept: 'flex-1', sub: 90, agency: 80, bid: 100, actual: 100, variance: 100 }
  function HeaderRow() {
    return (
      <div className="flex gap-2 px-2 py-1" style={{ borderBottom: '2px solid #57534e' }}>
        <span className="flex-1 text-[9.5px] font-mono uppercase tracking-widest" style={{ color: '#fb923c' }}>Category</span>
        <span className="text-[9.5px] font-mono uppercase tracking-widest text-right" style={{ color: '#fb923c', width: colW.sub }}>Subtotal</span>
        {agencyEnabled && <span className="text-[9.5px] font-mono uppercase tracking-widest text-right" style={{ color: '#fb923c', width: colW.agency }}>Agency</span>}
        <span className="text-[9.5px] font-mono uppercase tracking-widest text-right font-bold" style={{ color: '#fb923c', width: colW.bid }}>Bid</span>
        <span className="text-[9.5px] font-mono uppercase tracking-widest text-right" style={{ color: '#fb923c', width: colW.actual }}>Actual</span>
        <span className="text-[9.5px] font-mono uppercase tracking-widest text-right" style={{ color: '#fb923c', width: colW.variance }}>Variance</span>
      </div>
    )
  }

  function DataRow({ label, subtotal, agencyFee, bidTotal, actualTotal, bold, indent }) {
    const v = actualTotal - bidTotal
    return (
      <div className="flex gap-2 px-2 py-1.5 rounded-sm" style={{ backgroundColor: bold ? '#292524' : '#1c1917', border: `1px solid ${bold ? '#57534e' : '#3a3733'}` }}>
        <span className={`flex-1 text-[11.5px] font-mono truncate ${bold ? 'font-bold' : ''}`} style={{ color: bold ? '#d6d3d1' : '#a8a29e', paddingLeft: indent ? 12 : 0 }}>{label}</span>
        <span className="text-[11.5px] font-mono text-right" style={{ color: '#a8a29e', width: colW.sub }}>{fmtC(subtotal)}</span>
        {agencyEnabled && <span className="text-[11.5px] font-mono text-right" style={{ color: '#a8a29e', width: colW.agency }}>{agencyFee ? fmtC(agencyFee) : '\u2014'}</span>}
        <span className={`text-[11.5px] font-mono text-right ${bold ? 'font-bold' : ''}`} style={{ color: '#d6d3d1', width: colW.bid }}>{fmtC(bidTotal)}</span>
        <span className="text-[11.5px] font-mono text-right" style={{ color: actualTotal ? '#d6d3d1' : '#57534e', width: colW.actual }}>{actualTotal ? fmtC(actualTotal) : '\u2014'}</span>
        <span className="text-[11.5px] font-mono text-right" style={{ width: colW.variance, color: v > 0 ? '#fca5a5' : v < 0 ? '#86efac' : '#78716c' }}>
          {bidTotal > 0 || actualTotal > 0 ? `${v > 0 ? '+' : ''}${fmtC(v)}` : '\u2014'}
        </span>
      </div>
    )
  }

  function SectionHeader({ label, icon }) {
    return (
      <div className="flex items-center gap-2 px-2 pt-3 pb-1">
        {icon}
        <span className="text-[10.5px] font-mono font-bold uppercase tracking-wider" style={{ color: '#fb923c' }}>{label}</span>
      </div>
    )
  }

  return (
    <Card title="Topsheet rollup">
      <div className="flex flex-col gap-0.5">
        <HeaderRow />

        {/* ── Crew / Team ── */}
        {crewData.departments.length > 0 && (
          <>
            <SectionHeader label="Crew / Team" icon={<Users className="w-3.5 h-3.5" style={{ color: '#fb923c' }} />} />
            {crewData.departments.map(d => (
              <DataRow key={d.department} label={d.department} indent subtotal={d.subtotal} agencyFee={d.agencyFee} bidTotal={d.bidTotal} actualTotal={d.actualTotal} />
            ))}
            <DataRow label="Crew / Team total" bold subtotal={crewData.total.subtotal} agencyFee={crewData.total.agencyFee} bidTotal={crewData.total.bidTotal} actualTotal={crewData.total.actualTotal} />
          </>
        )}

        {/* ── Talent ── */}
        {talentData.types.length > 0 && (
          <>
            <SectionHeader label="Talent" icon={<Star className="w-3.5 h-3.5" style={{ color: '#fb923c' }} />} />
            {talentData.types.map(t => (
              <DataRow key={t.type} label={t.label} indent subtotal={t.subtotal} agencyFee={t.agencyFee} bidTotal={t.bidTotal} actualTotal={t.actualTotal} />
            ))}
            <DataRow label="Talent total" bold subtotal={talentData.total.subtotal} agencyFee={talentData.total.agencyFee} bidTotal={talentData.total.bidTotal} actualTotal={talentData.total.actualTotal} />
          </>
        )}

        {/* ── Expenses ── */}
        {expenseData.count > 0 && (
          <>
            <SectionHeader label={`Expenses (${expenseData.count})`} icon={<Receipt className="w-3.5 h-3.5" style={{ color: '#fb923c' }} />} />
            <DataRow label="All expenses" indent subtotal={expenseData.estimated} agencyFee={0} bidTotal={expenseData.estimated} actualTotal={expenseData.actual} />
          </>
        )}

        {/* ── Grand total ── */}
        <div className="mt-2" style={{ borderTop: '2px solid #fb923c' }}>
          <div className="flex gap-2 px-2 py-2.5 rounded-sm mt-1" style={{ backgroundColor: '#292524', border: '1px solid #57534e' }}>
            <span className="flex-1 text-[12.5px] font-mono font-bold uppercase tracking-wider" style={{ color: '#fb923c' }}>Grand Total</span>
            <span className="text-[12.5px] font-mono text-right font-bold" style={{ color: '#d6d3d1', width: colW.sub }}>{fmtC(grand.subtotal)}</span>
            {agencyEnabled && <span className="text-[12.5px] font-mono text-right font-bold" style={{ color: '#d6d3d1', width: colW.agency }}>{fmtC(grand.agencyFee)}</span>}
            <span className="text-[12.5px] font-mono text-right font-bold" style={{ color: '#d6d3d1', width: colW.bid }}>{fmtC(grand.bidTotal)}</span>
            <span className="text-[12.5px] font-mono text-right font-bold" style={{ color: '#d6d3d1', width: colW.actual }}>{grand.actualTotal ? fmtC(grand.actualTotal) : '\u2014'}</span>
            <span className="text-[12.5px] font-mono text-right font-bold" style={{ width: colW.variance, color: grand.variance > 0 ? '#fca5a5' : grand.variance < 0 ? '#86efac' : '#a8a29e' }}>
              {grand.bidTotal > 0 || grand.actualTotal > 0 ? `${grand.variance > 0 ? '+' : ''}${fmtC(grand.variance)}` : '\u2014'}
            </span>
          </div>
        </div>
      </div>
    </Card>
  )
}


// ─── Margin/contingency % input ─────────────��───────────────
function PctInput({ label, value, onChange, disabled }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    if (editing && ref.current) { ref.current.focus(); ref.current.select() }
  }, [editing])

  function start() {
    if (disabled) return
    setDraft(String(value || 0))
    setEditing(true)
  }

  function commit() {
    setEditing(false)
    const num = parseFloat(draft)
    if (Number.isFinite(num) && num !== value) onChange(num)
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[9.5px] font-mono uppercase tracking-widest" style={{ color: '#fb923c' }}>
        {label}
      </span>
      <div
        className="relative"
        style={{ width: 120, height: 34 }}
      >
        {editing ? (
          <div className="absolute inset-0 flex items-center gap-1">
            <input
              ref={ref}
              type="text"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commit() }
                else if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
              }}
              className="w-full px-2 py-1.5 text-sm font-mono font-bold rounded-sm focus:ring-2 focus:ring-orange-500"
              style={{ backgroundColor: '#1c1917', border: '1px solid #ea580c', color: '#f4a261', textAlign: 'right' }}
            />
            <span className="absolute right-2 text-xs font-mono pointer-events-none" style={{ color: '#78716c' }}>%</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={start}
            disabled={disabled}
            className="absolute inset-0 text-right px-2 py-1.5 text-sm font-mono font-bold rounded-sm transition-colors disabled:cursor-not-allowed"
            style={{
              backgroundColor: '#1c1917',
              border: '1px solid #44403c',
              color: disabled ? '#57534e' : '#f4a261',
            }}
          >
            {value}%
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Cost row in the waterfall ──────────��───────────────────
function CostRow({ label, amount, currency, prefix, bold, large }) {
  return (
    <div className="flex items-baseline justify-between">
      <span
        className={`text-[11.5px] font-mono ${bold ? 'font-bold uppercase tracking-wider' : ''}`}
        style={{ color: bold ? '#d6d3d1' : '#a8a29e' }}
      >
        {prefix && <span style={{ color: '#57534e' }}>{prefix} </span>}
        {label}
      </span>
      <CurrencyDisplay
        value={amount}
        currency={currency}
        className={`font-mono ${bold ? 'font-bold' : ''} ${large ? 'text-xl' : 'text-sm'}`}
        style={{ color: bold ? '#d6d3d1' : '#a8a29e' }}
      />
    </div>
  )
}

// ─── Waterfall row — inline % control next to computed amount ──
function WaterfallRow({ label, pct, amount, currency, onPctChange, disabled }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    if (editing && ref.current) { ref.current.focus(); ref.current.select() }
  }, [editing])

  function start() {
    if (disabled) return
    setDraft(String(pct || 0))
    setEditing(true)
  }

  function commit() {
    setEditing(false)
    const num = parseFloat(draft)
    if (Number.isFinite(num) && num !== pct) onPctChange(num)
  }

  return (
    <div className="flex items-center justify-between py-3 px-4 rounded-sm mb-1"
      style={{ backgroundColor: '#1c1917' }}>
      <div className="flex items-center gap-2.5">
        <span className="text-xs font-mono" style={{ color: '#a8a29e' }}>+ {label}</span>
        {editing ? (
          <input
            ref={ref}
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commit() }
              else if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
            }}
            className="w-16 px-2 py-0.5 text-[13.5px] font-mono font-bold rounded-sm text-right focus:ring-1 focus:ring-orange-500"
            style={{ backgroundColor: '#292524', border: '1px solid #ea580c', color: '#f4a261' }}
          />
        ) : (
          <button
            type="button" onClick={start} disabled={disabled}
            className="px-2 py-0.5 text-[13.5px] font-mono font-bold rounded-sm transition-colors hover:bg-stone-800 disabled:cursor-not-allowed"
            style={{ border: '1px solid #44403c', color: disabled ? '#57534e' : '#f4a261' }}
          >
            {pct}%
          </button>
        )}
      </div>
      <div className="text-[13.5px] font-mono text-right" style={{ color: '#a8a29e', width: 160, flexShrink: 0 }}>
        <CurrencyDisplay value={amount} currency={currency} style={{ color: '#a8a29e' }} />
      </div>
    </div>
  )
}

// ─── Compact inline % input (for agency row) ──────────────
function InlinePct({ value, onChange, disabled }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    if (editing && ref.current) { ref.current.focus(); ref.current.select() }
  }, [editing])

  function start() {
    if (disabled) return
    setDraft(String(value || 0))
    setEditing(true)
  }

  function commit() {
    setEditing(false)
    const num = parseFloat(draft)
    if (Number.isFinite(num) && num !== value) onChange(num)
  }

  if (editing) {
    return (
      <input
        ref={ref}
        type="text"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          else if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
        }}
        className="w-14 px-1.5 py-0.5 text-[11.5px] font-mono font-bold rounded-sm text-right focus:ring-1 focus:ring-orange-500"
        style={{ backgroundColor: '#292524', border: '1px solid #ea580c', color: '#f4a261' }}
      />
    )
  }

  return (
    <button
      type="button" onClick={start} disabled={disabled}
      className="px-1.5 py-0.5 text-[11.5px] font-mono font-bold rounded-sm transition-colors hover:bg-stone-800 disabled:cursor-not-allowed"
      style={{ border: '1px solid #44403c', color: disabled ? '#57534e' : '#f4a261' }}
    >
      {value}%
    </button>
  )
}

// ─── By Phase tab ───────────────────────────────���───────────
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
      <BreakdownTable rows={rows} currency={budget.currency} labelHeader="Phase" countHeader="Tasks" />
    </Card>
  )
}

// ─── By Role tab ───────────────────────────���────────────────
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
      <BreakdownTable rows={rows} currency={budget.currency} labelHeader="Role" countHeader="Tasks" />
    </Card>
  )
}

// ─── By Asset tab ───────────��───────────────────────────────
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
      <BreakdownTable rows={rows} currency={budget.currency} labelHeader="Asset" countHeader="Tasks" />
    </Card>
  )
}

// ─── By Scene tab (conditional — visible when scenes_enabled) ──
function BySceneTab({ scenes, tasks, budget, roleRates }) {
  const rows = useMemo(() => {
    const groups = {}
    for (const t of tasks) {
      const sceneId = t.scene_id || '__unscened__'
      if (!groups[sceneId]) groups[sceneId] = []
      groups[sceneId].push(t)
    }
    const sceneById = Object.fromEntries(scenes.map(s => [s.id, s]))
    return Object.entries(groups)
      .map(([sceneId, list]) => ({
        ...aggregateTasks(list, roleRates),
        name: sceneId === '__unscened__' ? 'No scene' : (sceneById[sceneId]?.name || 'Unknown scene'),
        sortOrder: sceneId === '__unscened__' ? 9999 : (sceneById[sceneId]?.scene_number ?? 0),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder)
  }, [scenes, tasks, roleRates])

  if (rows.length === 0) return <Empty>No tasks linked to scenes yet.</Empty>

  return (
    <Card title="Scenes">
      <BreakdownTable rows={rows} currency={budget.currency} labelHeader="Scene" countHeader="Tasks" />
    </Card>
  )
}

// ─── By Shot tab (conditional — visible when scenes_enabled) ──
function ByShotTab({ shots, scenes, tasks, budget, roleRates }) {
  const rows = useMemo(() => {
    const groups = {}
    for (const t of tasks) {
      const shotId = t.shot_id || '__unshot__'
      if (!groups[shotId]) groups[shotId] = []
      groups[shotId].push(t)
    }
    const shotById = Object.fromEntries(shots.map(s => [s.id, s]))
    const sceneById = Object.fromEntries(scenes.map(s => [s.id, s]))
    return Object.entries(groups)
      .map(([shotId, list]) => {
        const shot = shotById[shotId]
        const parentScene = shot ? sceneById[shot.scene_id] : null
        const prefix = parentScene ? `${parentScene.name} › ` : ''
        return {
          ...aggregateTasks(list, roleRates),
          name: shotId === '__unshot__' ? 'No shot' : `${prefix}${shot?.name || 'Unknown shot'}`,
          sortOrder: shotId === '__unshot__' ? 9999 : (shot?.shot_number ?? 0),
        }
      })
      .sort((a, b) => a.sortOrder - b.sortOrder)
  }, [shots, scenes, tasks, roleRates])

  if (rows.length === 0) return <Empty>No tasks linked to shots yet.</Empty>

  return (
    <Card title="Shots">
      <BreakdownTable rows={rows} currency={budget.currency} labelHeader="Shot" countHeader="Tasks" />
    </Card>
  )
}

// ─── By Level tab (conditional — visible when levels_enabled) ──
function ByLevelTab({ levels, tasks, budget, roleRates }) {
  const rows = useMemo(() => {
    const groups = {}
    for (const t of tasks) {
      const levelId = t.level_id || '__unleveled__'
      if (!groups[levelId]) groups[levelId] = []
      groups[levelId].push(t)
    }
    const levelById = Object.fromEntries(levels.map(l => [l.id, l]))
    return Object.entries(groups)
      .map(([levelId, list]) => ({
        ...aggregateTasks(list, roleRates),
        name: levelId === '__unleveled__' ? 'No level' : (levelById[levelId]?.name || 'Unknown level'),
        sortOrder: levelId === '__unleveled__' ? 9999 : (levelById[levelId]?.sort_order ?? 0),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder)
  }, [levels, tasks, roleRates])

  if (rows.length === 0) return <Empty>No tasks linked to levels yet.</Empty>

  return (
    <Card title="Levels">
      <BreakdownTable rows={rows} currency={budget.currency} labelHeader="Level" countHeader="Tasks" />
    </Card>
  )
}

// ─── By Experience tab (conditional — visible when experiences_enabled) ──
function ByExperienceTab({ experiences, tasks, budget, roleRates }) {
  const rows = useMemo(() => {
    const groups = {}
    for (const t of tasks) {
      const expId = t.experience_id || '__unexperienced__'
      if (!groups[expId]) groups[expId] = []
      groups[expId].push(t)
    }
    const expById = Object.fromEntries(experiences.map(e => [e.id, e]))
    return Object.entries(groups)
      .map(([expId, list]) => ({
        ...aggregateTasks(list, roleRates),
        name: expId === '__unexperienced__' ? 'No experience' : (expById[expId]?.name || 'Unknown experience'),
        sortOrder: expId === '__unexperienced__' ? 9999 : (expById[expId]?.sort_order ?? 0),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder)
  }, [experiences, tasks, roleRates])

  if (rows.length === 0) return <Empty>No tasks linked to experiences yet.</Empty>

  return (
    <Card title="Experiences">
      <BreakdownTable rows={rows} currency={budget.currency} labelHeader="Experience" countHeader="Tasks" />
    </Card>
  )
}

// ─── Custom tab ───────────────────────────────────────────
function CustomTab({ project, phases, assets, tasks, scenes, shots, levels, experiences, budget, roleRates }) {
  const storageKey = `rabbit-budget-custom-${project.id}`

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
    const sceneById = Object.fromEntries((scenes || []).map(s => [s.id, s]))
    const shotById  = Object.fromEntries((shots || []).map(s => [s.id, s]))
    const levelById = Object.fromEntries((levels || []).map(l => [l.id, l]))
    const expById   = Object.fromEntries((experiences || []).map(e => [e.id, e]))
    const groups = {}
    for (const t of filteredTasks) {
      let key, label
      switch (prefs.groupBy) {
        case 'phase': {
          const a = assetById[t.asset_id]
          key = a?.phase_id || '__unphased__'
          label = key === '__unphased__' ? 'Unphased' : (phaseById[key]?.name || 'Unknown phase')
          break
        }
        case 'role':       key = t.assigned_role_slug || t.assigned_position || 'unassigned'; label = key; break
        case 'asset':      key = t.asset_id; label = assetById[key]?.name || 'Unknown asset'; break
        case 'scene':      key = t.scene_id || '__none__'; label = key === '__none__' ? 'No scene' : (sceneById[key]?.name || 'Unknown scene'); break
        case 'shot': {
          key = t.shot_id || '__none__'
          if (key === '__none__') { label = 'No shot' } else {
            const sh = shotById[key]; const sc = sh ? sceneById[sh.scene_id] : null
            label = sc ? `${sc.name} › ${sh?.name || 'Unknown'}` : (sh?.name || 'Unknown shot')
          }
          break
        }
        case 'level':      key = t.level_id || '__none__'; label = key === '__none__' ? 'No level' : (levelById[key]?.name || 'Unknown level'); break
        case 'experience': key = t.experience_id || '__none__'; label = key === '__none__' ? 'No experience' : (expById[key]?.name || 'Unknown experience'); break
        case 'status':     key = t.status || 'unset'; label = key; break
        case 'priority':   key = t.priority || 'medium'; label = key; break
        default:           key = 'all'; label = 'All'
      }
      if (!groups[key]) groups[key] = { key, label, tasks: [] }
      groups[key].tasks.push(t)
    }
    return Object.values(groups)
      .map(g => ({ ...aggregateTasks(g.tasks, roleRates), name: g.label }))
      .sort((a, b) => b.bid - a.bid)
  }, [filteredTasks, assets, phases, scenes, shots, levels, experiences, prefs.groupBy, roleRates])

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
              options={GROUP_BY_OPTIONS.filter(o => !o.requires || project?.[o.requires]).map(o => ({ value: o.id, label: o.label }))}
            />
          </Field>
          <Field label="Phase filter">
            <Select
              value={prefs.phaseFilter}
              onChange={v => setPrefs(p => ({ ...p, phaseFilter: v }))}
              options={[
                { value: '__all__', label: 'All phases' },
                ...phases.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map(p => ({ value: p.id, label: p.name })),
                { value: '__unphased__', label: 'Unphased' },
              ]}
            />
          </Field>
          <Field label="Status filter">
            <Select
              value={prefs.statusFilter}
              onChange={v => setPrefs(p => ({ ...p, statusFilter: v }))}
              options={STATUS_FILTER_OPTIONS.map(o => ({ value: o.id, label: o.label }))}
              colorFn={budgetStatusColor}
            />
          </Field>
        </div>
      </Card>

      <Card title={`Breakdown · ${rows.length} group${rows.length === 1 ? '' : 's'}`}>
        {rows.length === 0 ? (
          <Empty>No tasks match the current filters.</Empty>
        ) : (
          <>
            <BreakdownTable rows={rows} currency={budget.currency} labelHeader={GROUP_BY_OPTIONS.find(o => o.id === prefs.groupBy)?.label || 'Group'} countHeader="Tasks" />
            <div
              className="grid grid-cols-6 gap-2 px-2 py-2 mt-2 rounded-sm text-[11.5px] font-mono items-center"
              style={{ backgroundColor: '#1c1917', border: '1px solid #57534e' }}
            >
              <span className="font-bold uppercase tracking-wider" style={{ color: '#fb923c' }}>Total</span>
              <span style={{ color: '#a8a29e' }}>{filteredTasks.length}</span>
              <span style={{ color: '#a8a29e' }}>{totalBid.toFixed(1)}</span>
              <span />
              <span />
              <CurrencyDisplay value={totalCost} currency={budget.currency} className="font-bold" style={{ color: '#d6d3d1' }} />
            </div>
          </>
        )}
      </Card>
    </div>
  )
}

// ─── Expenses: constants ───────────────────────────────────
const EXPENSE_FILTER_FIELDS = [
  { value: 'title',         label: 'Title',         type: 'text' },
  { value: 'description',   label: 'Description',   type: 'text' },
  { value: 'purchase_date', label: 'Date',           type: 'text' },
  { value: 'cost_status',   label: 'Cost Status',    type: 'select', options: ['over_budget', 'under_budget', 'on_budget', 'no_estimate'] },
  { value: 'has_files',     label: 'Has Receipts',   type: 'select', options: ['yes', 'no'] },
  { value: 'asset_id',      label: 'Linked Asset',   type: 'select', dynamic: 'assets' },
  { value: 'phase_id',      label: 'Linked Phase',   type: 'select', dynamic: 'phases' },
  { value: 'task_id',       label: 'Linked Task',    type: 'select', dynamic: 'tasks' },
]

const EXPENSE_FILTER_OPS = {
  select: [
    { value: 'is',           label: 'is' },
    { value: 'is_not',       label: 'is not' },
    { value: 'is_empty',     label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
  text: [
    { value: 'contains',     label: 'contains' },
    { value: 'not_contains', label: 'does not contain' },
    { value: 'is',           label: 'is' },
    { value: 'is_not',       label: 'is not' },
    { value: 'is_empty',     label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
}

const EXPENSE_SORTABLE_FIELDS = [
  { value: 'title',          label: 'Title' },
  { value: 'estimated_cost', label: 'Estimated Cost' },
  { value: 'actual_cost',    label: 'Actual Cost' },
  { value: 'variance',       label: 'Variance' },
  { value: 'purchase_date',  label: 'Date' },
  { value: 'created_at',     label: 'Created' },
]

const EXPENSE_GROUPABLE_FIELDS = [
  { value: '',                label: 'No grouping' },
  { value: 'cost_status',    label: 'Cost Status' },
  { value: 'purchase_month', label: 'Month' },
  { value: 'has_files',      label: 'Has Receipts' },
]

const COST_STATUS_LABELS = {
  over_budget:  'Over Budget',
  under_budget: 'Under Budget',
  on_budget:    'On Budget',
  no_estimate:  'No Estimate',
}

function expenseCostStatus(exp) {
  const est = Number(exp.estimated_cost) || 0
  const act = Number(exp.actual_cost) || 0
  if (est === 0) return 'no_estimate'
  if (act > est) return 'over_budget'
  if (act < est) return 'under_budget'
  return 'on_budget'
}

function expenseVariance(exp) {
  return (Number(exp.actual_cost) || 0) - (Number(exp.estimated_cost) || 0)
}

function fmtExpLabel(str) {
  return (str || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}


// ─── Expenses tab ──────────────────────────────────────────
function ExpensesTab({ ctx, project, phases, assets, tasks, expensesHook, currency }) {
  const {
    expenses, loading: expLoading, addExpense, updateExpense, deleteExpense,
    undo, redo, canUndo, canRedo,
  } = expensesHook

  const SAVED_VIEWS_KEY = `rabbit_expense_saved_views_${project?.id || ''}`

  // Project-level defaults for margin & contingency
  const defaultMarginPct = Number(project?.budget_margin_pct ?? 0) || 0
  const defaultContPct   = Number(project?.budget_contingency_pct ?? 0) || 0

  const [showPopup, setShowPopup]         = useState(false)
  const [editingId, setEditingId]         = useState(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)
  // Margin/contingency popover: { expId, x, y, h }
  const [mcPopover, setMcPopover] = useState(null)

  // ── Multi-select ──
  const [expSelected, setExpSelected] = useState(new Set())
  const expSomeSelected = expSelected.size > 0
  function expToggleOne(id) {
    setExpSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }
  function expToggleAll(ids) {
    const allIn = ids.every(id => expSelected.has(id))
    if (allIn) setExpSelected(new Set())
    else setExpSelected(new Set(ids))
  }
  function expClearSelection() { setExpSelected(new Set()) }
  function expBulkDelete() {
    if (!window.confirm(`Delete ${expSelected.size} expense${expSelected.size === 1 ? '' : 's'}?`)) return
    for (const id of expSelected) deleteExpense(id)
    expClearSelection()
  }

  // ── Filtering, sorting, grouping, saved views ──
  const [search, setSearch]               = useState('')
  const [filters, setFilters]             = useState([])
  const [showFilterPanel, setShowFilterPanel] = useState(false)
  const [sortField, setSortField]         = useState('purchase_date')
  const [sortDir, setSortDir]             = useState('desc')
  const [groupBy, setGroupBy]             = useState('')
  const [savedViews, setSavedViews]       = useState(() => {
    try { return JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) || '[]') } catch { return [] }
  })
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveName, setSaveName]           = useState('')

  // ── Filter CRUD ──
  function addFilter() {
    setFilters(prev => [...prev, { field: 'title', op: 'contains', value: '' }])
  }
  function updateFilter(idx, patch) {
    setFilters(prev => prev.map((f, i) => i === idx ? { ...f, ...patch } : f))
  }
  function removeFilter(idx) {
    setFilters(prev => prev.filter((_, i) => i !== idx))
  }

  // ── Saved views CRUD ──
  function saveCurrentView() {
    if (!saveName.trim()) return
    const view = {
      id: Date.now().toString(),
      name: saveName.trim(),
      filters, sortField, sortDir, groupBy,
    }
    const next = [...savedViews, view]
    setSavedViews(next)
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next))
    setSaveName('')
    setShowSaveDialog(false)
  }
  function loadView(view) {
    setFilters(view.filters || [])
    setSortField(view.sortField || 'purchase_date')
    setSortDir(view.sortDir || 'desc')
    setGroupBy(view.groupBy || '')
  }
  function deleteSavedView(id) {
    const next = savedViews.filter(v => v.id !== id)
    setSavedViews(next)
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next))
  }

  // Keyboard shortcuts: Ctrl+Z / Ctrl+Shift+Z
  useEffect(() => {
    function onKey(e) {
      const t = e.target
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.tagName === 'SELECT') return
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const k = (e.key || '').toLowerCase()
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  // ── Lookups ──
  const phaseById = useMemo(() => Object.fromEntries(phases.map(p => [p.id, p])), [phases])
  const assetById = useMemo(() => Object.fromEntries(assets.map(a => [a.id, a])), [assets])
  const taskById  = useMemo(() => Object.fromEntries(tasks.map(t => [t.id, t])), [tasks])

  // ── Apply filters ──
  const applyFilters = useCallback((list) => {
    let result = list
    // Text search
    const s = search.trim().toLowerCase()
    if (s) result = result.filter(e =>
      (e.title || '').toLowerCase().includes(s) ||
      (e.description || '').toLowerCase().includes(s)
    )
    // Complex filters
    for (const f of filters) {
      if (!f.field) continue
      result = result.filter(exp => {
        // Derived fields
        let val
        if (f.field === 'cost_status')   val = expenseCostStatus(exp)
        else if (f.field === 'has_files') val = (exp.file_ids?.length || 0) > 0 ? 'yes' : 'no'
        else if (f.field === 'asset_id')  val = exp.asset_ids || []
        else if (f.field === 'phase_id')  val = exp.phase_ids || []
        else if (f.field === 'task_id')   val = exp.task_ids || []
        else val = exp[f.field]

        // Array fields (linked assets/phases/tasks)
        if (Array.isArray(val)) {
          switch (f.op) {
            case 'is':           return val.includes(f.value)
            case 'is_not':       return !val.includes(f.value)
            case 'is_empty':     return val.length === 0
            case 'is_not_empty': return val.length > 0
            default: return true
          }
        }
        switch (f.op) {
          case 'is':           return val === f.value
          case 'is_not':       return val !== f.value
          case 'is_empty':     return !val
          case 'is_not_empty': return !!val
          case 'contains':     return (val || '').toLowerCase().includes((f.value || '').toLowerCase())
          case 'not_contains': return !(val || '').toLowerCase().includes((f.value || '').toLowerCase())
          default: return true
        }
      })
    }
    return result
  }, [search, filters])

  // ── Apply sort ──
  const applySort = useCallback((list) => {
    if (!sortField) return list
    const sorted = [...list]
    const dir = sortDir === 'desc' ? -1 : 1
    sorted.sort((a, b) => {
      let va, vb
      if (sortField === 'variance') {
        va = expenseVariance(a); vb = expenseVariance(b)
      } else if (sortField === 'estimated_cost' || sortField === 'actual_cost') {
        va = Number(a[sortField] || 0); vb = Number(b[sortField] || 0)
      } else {
        va = String(a[sortField] || '').toLowerCase()
        vb = String(b[sortField] || '').toLowerCase()
      }
      if (va < vb) return -1 * dir
      if (va > vb) return 1 * dir
      return 0
    })
    return sorted
  }, [sortField, sortDir])

  const processed = useMemo(() => applySort(applyFilters(expenses)), [expenses, applyFilters, applySort])

  // ── Grouping ──
  const groups = useMemo(() => {
    if (!groupBy) return null
    const map = {}
    for (const exp of processed) {
      let key
      if (groupBy === 'cost_status')    key = expenseCostStatus(exp)
      else if (groupBy === 'purchase_month') {
        const d = exp.purchase_date || ''
        key = d.length >= 7 ? d.slice(0, 7) : '__no_date__'
      }
      else if (groupBy === 'has_files') key = (exp.file_ids?.length || 0) > 0 ? 'yes' : 'no'
      else key = '__all__'
      if (!map[key]) map[key] = []
      map[key].push(exp)
    }
    let sortedKeys
    if (groupBy === 'cost_status') {
      sortedKeys = ['over_budget', 'under_budget', 'on_budget', 'no_estimate'].filter(k => map[k])
    } else if (groupBy === 'purchase_month') {
      sortedKeys = Object.keys(map).sort((a, b) => b.localeCompare(a)) // newest first
    } else {
      sortedKeys = Object.keys(map).sort()
    }
    return sortedKeys.map(key => ({
      key,
      label: groupBy === 'cost_status'    ? (COST_STATUS_LABELS[key] || key)
           : groupBy === 'purchase_month' ? (key === '__no_date__' ? 'No Date' : key)
           : groupBy === 'has_files'      ? (key === 'yes' ? 'Has Receipts' : 'No Receipts')
           : key,
      items: map[key] || [],
    }))
  }, [processed, groupBy])

  // ── Totals ──
  const totalEstimated = useMemo(() => expenses.reduce((s, e) => s + (Number(e.estimated_cost) || 0), 0), [expenses])
  const totalActual    = useMemo(() => expenses.reduce((s, e) => s + (Number(e.actual_cost) || 0), 0), [expenses])
  const totalVariance  = totalActual - totalEstimated
  const totalMargin = useMemo(() => expenses.reduce((s, e) => {
    const est = Number(e.estimated_cost) || 0
    const pct = e.margin_pct != null ? Number(e.margin_pct) : defaultMarginPct
    return s + est * pct / 100
  }, 0), [expenses, defaultMarginPct])
  const totalCont = useMemo(() => expenses.reduce((s, e) => {
    const est = Number(e.estimated_cost) || 0
    const pct = e.contingency_pct != null ? Number(e.contingency_pct) : defaultContPct
    return s + est * pct / 100
  }, 0), [expenses, defaultContPct])

  // ── Handlers ──
  function handleCreate() { setEditingId(null); setShowPopup(true) }
  function handleEdit(id) { setEditingId(id); setShowPopup(true) }
  async function handleDelete(id) { await deleteExpense(id); setDeleteConfirmId(null) }
  async function handleSave(data) {
    if (editingId) await updateExpense(editingId, data)
    else await addExpense(data)
    setShowPopup(false); setEditingId(null)
  }

  function handleMcCellClick(e, expId) {
    e.stopPropagation()
    if (mcPopover?.expId === expId) { setMcPopover(null); return }
    const rect = e.currentTarget.getBoundingClientRect()
    setMcPopover({ expId, x: rect.left, y: rect.top, h: rect.height })
  }

  async function handleMcSave(expId, data) {
    await updateExpense(expId, { margin_pct: data.margin_pct, contingency_pct: data.contingency_pct })
    setMcPopover(null)
  }

  async function resetAllMarginCont() {
    if (!window.confirm('Reset all margin & contingency values to the project defaults? This cannot be undone.')) return
    for (const exp of expenses) {
      if (exp.margin_pct != null || exp.contingency_pct != null) {
        await updateExpense(exp.id, { margin_pct: null, contingency_pct: null })
      }
    }
  }

  if (expLoading) return <Empty>Loading expenses...</Empty>

  // ── Render a single expense row ──
  function ExpenseRow({ exp }) {
    const est = Number(exp.estimated_cost) || 0
    const act = Number(exp.actual_cost) || 0
    const v = act - est
    const status = expenseCostStatus(exp)
    const relCount = (exp.asset_ids?.length || 0) + (exp.phase_ids?.length || 0) + (exp.task_ids?.length || 0)
    const fileCount = exp.file_ids?.length || 0
    const statusColor = status === 'over_budget' ? '#fca5a5' : status === 'under_budget' ? '#86efac' : '#a8a29e'
    const isChecked = expSelected.has(exp.id)

    return (
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-sm transition-colors hover:bg-stone-800 cursor-pointer group"
        style={{ backgroundColor: isChecked ? 'rgba(234, 88, 12, 0.1)' : '#1c1917', border: `1px solid ${isChecked ? '#ea580c' : '#44403c'}` }}
        onClick={() => handleEdit(exp.id)}
      >
        {/* Checkbox */}
        <div className="flex-shrink-0" onClick={e => e.stopPropagation()}>
          <button type="button" onClick={() => expToggleOne(exp.id)}
            className="p-0.5 rounded hover:bg-stone-700 transition-colors"
            style={{ opacity: isChecked ? 1 : undefined }}
          >
            {isChecked
              ? <CheckSquare className="w-3.5 h-3.5" style={{ color: '#fb923c' }} />
              : <Square className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: '#57534e' }} />}
          </button>
        </div>
        <div style={{ flex: 2 }} className="min-w-0">
          <div className="text-[11.5px] font-mono truncate" style={{ color: '#d6d3d1' }}>
            {exp.title || <span style={{ color: '#78716c', fontStyle: 'italic' }}>Untitled</span>}
          </div>
          {exp.description && <div className="text-[10.5px] truncate mt-0.5" style={{ color: '#78716c' }}>{exp.description}</div>}
        </div>
        <div style={{ flex: 1 }} className="text-[11.5px] font-mono">
          <CurrencyDisplay value={est} currency={currency} style={{ color: est ? '#a8a29e' : '#57534e' }} />
        </div>
        {(() => {
          const mPct = exp.margin_pct != null ? Number(exp.margin_pct) : defaultMarginPct
          const cPct = exp.contingency_pct != null ? Number(exp.contingency_pct) : defaultContPct
          const mAmt = est * mPct / 100
          const cAmt = est * cPct / 100
          return (<>
            <div style={{ flex: 0.6 }} className="text-[10.5px] font-mono" onClick={e => e.stopPropagation()}>
              <button type="button" onClick={e => handleMcCellClick(e, exp.id)}
                className="px-1 py-0.5 rounded-sm transition-colors hover:bg-stone-700"
                style={{ color: mAmt > 0 ? '#fb923c' : '#57534e', border: '1px solid #33302e' }}>
                {mAmt > 0 ? `+${fmtCurrency(mAmt, currency)}` : '\u2014'}
              </button>
            </div>
            <div style={{ flex: 0.6 }} className="text-[10.5px] font-mono" onClick={e => e.stopPropagation()}>
              <button type="button" onClick={e => handleMcCellClick(e, exp.id)}
                className="px-1 py-0.5 rounded-sm transition-colors hover:bg-stone-700"
                style={{ color: cAmt > 0 ? '#fb923c' : '#57534e', border: '1px solid #33302e' }}>
                {cAmt > 0 ? `+${fmtCurrency(cAmt, currency)}` : '\u2014'}
              </button>
            </div>
          </>)
        })()}
        <div style={{ flex: 1 }} className="text-[11.5px] font-mono">
          <CurrencyDisplay value={act} currency={currency} style={{ color: act ? '#d6d3d1' : '#57534e' }} />
        </div>
        <div style={{ flex: 0.8 }} className="text-[11.5px] font-mono">
          {est > 0 ? (
            <span style={{ color: statusColor }}>
              {v > 0 ? '+' : ''}{<CurrencyDisplay value={v} currency={currency} style={{ color: statusColor }} />}
            </span>
          ) : <span style={{ color: '#57534e' }}>{'\u2014'}</span>}
        </div>
        <div style={{ flex: 1 }} className="text-[11.5px] font-mono">
          <span style={{ color: exp.purchase_date ? '#a8a29e' : '#57534e' }}>{exp.purchase_date || '\u2014'}</span>
        </div>
        <div style={{ flex: 1.2 }} className="flex items-center gap-1 text-[10.5px] font-mono flex-wrap">
          {relCount > 0 ? (
            <>
              {(exp.asset_ids?.length || 0) > 0 && <span className="px-1 py-0.5 rounded-sm" style={{ backgroundColor: '#292524', border: '1px solid #44403c', color: '#a8a29e' }}>{exp.asset_ids.length} asset{exp.asset_ids.length !== 1 ? 's' : ''}</span>}
              {(exp.phase_ids?.length || 0) > 0 && <span className="px-1 py-0.5 rounded-sm" style={{ backgroundColor: '#292524', border: '1px solid #44403c', color: '#a8a29e' }}>{exp.phase_ids.length} phase{exp.phase_ids.length !== 1 ? 's' : ''}</span>}
              {(exp.task_ids?.length || 0) > 0  && <span className="px-1 py-0.5 rounded-sm" style={{ backgroundColor: '#292524', border: '1px solid #44403c', color: '#a8a29e' }}>{exp.task_ids.length} task{exp.task_ids.length !== 1 ? 's' : ''}</span>}
            </>
          ) : <span style={{ color: '#57534e' }}>{'\u2014'}</span>}
        </div>
        <div style={{ flex: 0.5 }} className="text-[11.5px] font-mono">
          {fileCount > 0
            ? <span className="flex items-center gap-1" style={{ color: '#a8a29e' }}><Paperclip className="w-3 h-3" /> {fileCount}</span>
            : <span style={{ color: '#57534e' }}>{'\u2014'}</span>}
        </div>
        <div style={{ flex: 0.5 }} className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
          <button type="button" onClick={() => handleEdit(exp.id)} className="p-1 rounded-sm hover:bg-stone-700 transition-colors" style={{ color: '#a8a29e' }} title="Edit"><Pencil className="w-3 h-3" /></button>
          <button type="button" onClick={() => setDeleteConfirmId(exp.id)} className="p-1 rounded-sm hover:bg-stone-700 transition-colors" style={{ color: '#ef4444' }} title="Delete"><Trash2 className="w-3 h-3" /></button>
        </div>
      </div>
    )
  }

  const COL_HEADER = [
    { label: 'Title',       flex: 2 },
    { label: 'Estimated',   flex: 1, field: 'estimated_cost' },
    { label: 'Margin',      flex: 0.6, color: '#fb923c' },
    { label: 'Conting.',    flex: 0.6, color: '#fb923c' },
    { label: 'Actual',      flex: 1, field: 'actual_cost' },
    { label: 'Variance',    flex: 0.8, field: 'variance' },
    { label: 'Date',        flex: 1, field: 'purchase_date' },
    { label: 'Related',     flex: 1.2 },
    { label: 'Files',       flex: 0.5 },
    { label: '',             flex: 0.5 },
  ]

  return (
    <div className="flex flex-col gap-3">
      {/* Summary tiles */}
      <div className="flex gap-3 flex-wrap">
        <BigTile label="Estimated Total" value={fmtCurrency(totalEstimated, currency)} />
        <BigTile label="Actual Total" value={totalActual > 0 ? fmtCurrency(totalActual, currency) : '\u2014'} />
        <BigTile
          label="Variance"
          value={totalEstimated > 0 || totalActual > 0
            ? `${totalVariance > 0 ? '+' : ''}${fmtCurrency(totalVariance, currency)}`
            : '\u2014'}
          tone={totalVariance > 0 ? 'danger' : totalVariance < 0 ? 'good' : 'neutral'}
        />
        <BigTile label="Expenses" value={expenses.length} />
      </div>

      {/* Toolbar — matching RABBIT pattern */}
      <div className="flex items-center gap-3 px-1 flex-wrap">
        {/* New expense */}
        <button type="button" onClick={handleCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded-sm transition-colors"
          style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}>
          <Plus className="w-3.5 h-3.5" /> New expense
        </button>

        {/* Undo / redo */}
        <div className="flex items-center gap-1">
          <button type="button" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)"
            className="p-1.5 rounded-sm transition-colors hover:bg-stone-700 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ color: '#a8a29e', border: '1px solid #44403c' }}><Undo2 className="w-3.5 h-3.5" /></button>
          <button type="button" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)"
            className="p-1.5 rounded-sm transition-colors hover:bg-stone-700 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ color: '#a8a29e', border: '1px solid #44403c' }}><Redo2 className="w-3.5 h-3.5" /></button>
        </div>

        <div style={{ width: 1, height: 20, backgroundColor: '#44403c' }} />

        {/* Filter */}
        <button type="button" onClick={() => setShowFilterPanel(!showFilterPanel)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded-sm hover:bg-stone-700 transition-colors"
          style={{ color: filters.length > 0 ? '#fb923c' : '#a8a29e', border: '1px solid #44403c' }}>
          <Filter className="w-3.5 h-3.5" /> Filter{filters.length > 0 ? ` (${filters.length})` : ''}
        </button>

        {/* Sort */}
        <div className="flex items-center gap-1.5">
          <ArrowUpDown className="w-3.5 h-3.5" style={{ color: '#78716c' }} />
          <select value={sortField} onChange={e => setSortField(e.target.value)}
            className="px-2 py-1.5 text-[11.5px] font-mono rounded-sm focus:ring-2 focus:ring-orange-500"
            style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}>
            <option value="">No sort</option>
            {EXPENSE_SORTABLE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          {sortField && (
            <button type="button" onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
              className="px-2 py-1.5 text-[10.5px] font-mono uppercase rounded-sm hover:bg-stone-700 transition-colors"
              style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
              {sortDir === 'asc' ? 'A\u2192Z' : 'Z\u2192A'}
            </button>
          )}
        </div>

        <div style={{ width: 1, height: 20, backgroundColor: '#44403c' }} />

        {/* Group */}
        <div className="flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5" style={{ color: '#78716c' }} />
          <select value={groupBy} onChange={e => setGroupBy(e.target.value)}
            className="px-2 py-1.5 text-[11.5px] font-mono rounded-sm focus:ring-2 focus:ring-orange-500"
            style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}>
            {EXPENSE_GROUPABLE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>

        <div style={{ width: 1, height: 20, backgroundColor: '#44403c' }} />

        {/* Saved views */}
        <ExpenseSavedViewsDropdown views={savedViews} onLoad={loadView} onDelete={deleteSavedView} onSave={() => setShowSaveDialog(true)} />

        <div style={{ width: 1, height: 20, backgroundColor: '#44403c' }} />

        {/* Reset margin/contingency */}
        <button type="button" onClick={resetAllMarginCont}
          className="flex items-center gap-1 px-2 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm hover:bg-stone-700 transition-colors"
          style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
          <RotateCcw className="w-3 h-3" /> Reset M/C
        </button>

        {/* Search */}
        <div className="flex items-center gap-1.5 flex-1 max-w-xs ml-auto">
          <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#78716c' }} />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search expenses..."
            className="flex-1 px-2.5 py-1.5 text-[11.5px] font-mono rounded-sm focus:ring-2 focus:ring-orange-500"
            style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }} />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="p-0.5 hover:bg-stone-700 rounded transition-colors" style={{ color: '#a8a29e' }}><X className="w-3.5 h-3.5" /></button>
          )}
        </div>

        <span className="text-[10.5px] font-mono uppercase tracking-wider px-1" style={{ color: '#78716c' }}>{processed.length}/{expenses.length}</span>
      </div>

      {/* Filter panel */}
      {showFilterPanel && (
        <ExpenseFilterPanel
          filters={filters}
          phases={phases} assets={assets} tasks={tasks}
          onAdd={addFilter} onUpdate={updateFilter} onRemove={removeFilter}
          onClose={() => setShowFilterPanel(false)}
        />
      )}

      {/* Column header */}
      <div className="relative flex gap-2 px-3 py-1.5" style={{ borderBottom: '1px solid #44403c' }}>
        {/* ── Bulk-action bar (overlays header) ── */}
        {expSomeSelected && (
          <div className="absolute top-0 z-20 flex items-center gap-3 h-full px-3 rounded-sm"
            style={{ left: 32, backgroundColor: '#292524', border: '1px solid #ea580c', width: 'fit-content' }}>
            <span className="text-[11.5px] font-mono font-bold flex-shrink-0" style={{ color: '#fb923c' }}>
              {expSelected.size} selected
            </span>
            <div style={{ width: 1, height: 18, backgroundColor: '#44403c' }} />
            <button type="button" onClick={expBulkDelete}
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-red-900/40 transition-colors"
              style={{ color: '#fca5a5' }}>
              <Trash2 className="w-3 h-3" /> <span className="text-[10.5px] font-mono uppercase">Delete</span>
            </button>
            <button type="button" onClick={expClearSelection}
              className="p-1 rounded hover:bg-stone-700 transition-colors" style={{ color: '#78716c' }}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {/* Select-all checkbox */}
        <div className="flex items-center flex-shrink-0" style={{ width: 20 }}>
          <button type="button" onClick={() => expToggleAll(processed.map(e => e.id))} className="p-0.5 rounded hover:bg-stone-700 transition-colors">
            {processed.length > 0 && processed.every(e => expSelected.has(e.id))
              ? <CheckSquare className="w-3 h-3" style={{ color: '#fb923c' }} />
              : expSomeSelected
                ? <MinusSquare className="w-3 h-3" style={{ color: '#fb923c' }} />
                : <Square className="w-3 h-3" style={{ color: '#57534e' }} />}
          </button>
        </div>
        {COL_HEADER.map((col, i) => (
          <div key={i}
            className={`text-[9.5px] font-mono uppercase tracking-widest ${col.field ? 'cursor-pointer hover:text-orange-300' : ''}`}
            style={{ flex: col.flex, color: col.color ? col.color : sortField === col.field ? '#fb923c' : '#78716c' }}
            onClick={() => col.field && (sortField === col.field ? setSortDir(d => d === 'asc' ? 'desc' : 'asc') : (setSortField(col.field), setSortDir('asc')))}
          >
            {col.label}
            {sortField === col.field && <span className="ml-1">{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>}
          </div>
        ))}
      </div>

      {/* Table body — flat or grouped */}
      {processed.length === 0 ? (
        <Empty>{search || filters.length ? 'No matching expenses.' : 'No expenses yet \u2014 click "New expense" to add one.'}</Empty>
      ) : groups ? (
        <div className="flex flex-col gap-3">
          {groups.map(g => (
            <div key={g.key}>
              <div className="flex items-center gap-2 px-2 py-1.5 mb-1 rounded-sm" style={{ backgroundColor: '#292524', borderLeft: '3px solid #fb923c' }}>
                <span className="text-[10.5px] font-mono font-bold uppercase tracking-wider" style={{ color: '#fb923c' }}>{g.label}</span>
                <span className="text-[10.5px] font-mono" style={{ color: '#78716c' }}>({g.items.length})</span>
                <span className="ml-auto text-[10.5px] font-mono" style={{ color: '#a8a29e' }}>
                  Est: <CurrencyDisplay value={g.items.reduce((s, e) => s + (Number(e.estimated_cost) || 0), 0)} currency={currency} className="inline" style={{ color: '#a8a29e' }} />
                  {' / '}
                  Act: <CurrencyDisplay value={g.items.reduce((s, e) => s + (Number(e.actual_cost) || 0), 0)} currency={currency} className="inline" style={{ color: '#d6d3d1' }} />
                </span>
              </div>
              <div className="flex flex-col gap-1">
                {g.items.map(exp => <ExpenseRow key={exp.id} exp={exp} />)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {processed.map(exp => <ExpenseRow key={exp.id} exp={exp} />)}
        </div>
      )}


      {/* Delete confirmation */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDeleteConfirmId(null)} />
          <div className="relative rounded-sm p-5 flex flex-col gap-3" style={{ backgroundColor: '#292524', border: '2px solid #44403c', width: 360 }}>
            <div className="flex items-center gap-2"><AlertCircle className="w-5 h-5 text-red-400" /><span className="text-sm font-bold" style={{ color: '#fca5a5' }}>Delete Expense</span></div>
            <p className="text-[11.5px] font-mono" style={{ color: '#a8a29e' }}>This will permanently remove this expense. You can undo with Ctrl+Z.</p>
            <div className="flex justify-end gap-2 mt-1">
              <button type="button" onClick={() => setDeleteConfirmId(null)} className="px-3 py-1.5 text-[11.5px] font-mono rounded-sm hover:bg-stone-700 transition-colors" style={{ color: '#a8a29e', border: '1px solid #44403c' }}>Cancel</button>
              <button type="button" onClick={() => handleDelete(deleteConfirmId)} className="px-3 py-1.5 text-[11.5px] font-mono rounded-sm transition-colors" style={{ color: '#fff7ed', backgroundColor: '#dc2626', border: '1px solid #991b1b' }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Save view dialog */}
      {showSaveDialog && (
        <>
          <div className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={() => setShowSaveDialog(false)} />
          <div className="fixed z-50 top-1/2 left-1/2 w-80 rounded-sm p-5 flex flex-col gap-4"
            style={{ backgroundColor: '#292524', border: '2px solid #f97316', transform: 'translate(-50%,-50%)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <span className="text-[13.5px] font-mono uppercase tracking-wider font-bold" style={{ color: '#fb923c' }}>Save current view</span>
            <input autoFocus type="text" value={saveName} onChange={e => setSaveName(e.target.value)}
              placeholder="View name..." onKeyDown={e => { if (e.key === 'Enter') saveCurrentView() }}
              className="px-3 py-2 text-xs font-mono rounded-sm focus:ring-2 focus:ring-orange-500"
              style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }} />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowSaveDialog(false)} className="px-4 py-1.5 text-[11.5px] font-mono rounded-sm hover:bg-stone-700 transition-colors" style={{ color: '#a8a29e', border: '1px solid #44403c' }}>Cancel</button>
              <button type="button" onClick={saveCurrentView} className="px-4 py-1.5 text-[11.5px] font-mono rounded-sm transition-colors" style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}>Save</button>
            </div>
          </div>
        </>
      )}

      {/* Create / Edit popup */}
      {showPopup && (
        <ExpensePopup
          expense={editingId ? expenses.find(e => e.id === editingId) : null}
          phases={phases} assets={assets} tasks={tasks}
          projectId={project.id} ctx={ctx} currency={currency}
          onSave={handleSave}
          onClose={() => { setShowPopup(false); setEditingId(null) }}
        />
      )}

      {/* ── Margin/Contingency popover ── */}
      {mcPopover && (() => {
        const exp = expenses.find(e => e.id === mcPopover.expId)
        if (!exp) return null
        const est = Number(exp.estimated_cost) || 0
        const mPct = exp.margin_pct != null ? Number(exp.margin_pct) : defaultMarginPct
        const cPct = exp.contingency_pct != null ? Number(exp.contingency_pct) : defaultContPct
        return (
          <ExpenseMarginContPopover
            pos={mcPopover}
            marginPct={mPct}
            contPct={cPct}
            estimatedCost={est}
            defaultMargin={defaultMarginPct}
            defaultCont={defaultContPct}
            currency={currency}
            onSave={data => handleMcSave(mcPopover.expId, data)}
            onClose={() => setMcPopover(null)}
          />
        )
      })()}
    </div>
  )
}


// ─── Expense margin/contingency popover ─────────────────���─
function ExpenseMarginContPopover({ pos, marginPct, contPct, estimatedCost, defaultMargin, defaultCont, currency, onSave, onClose }) {
  const [margin, setMargin] = useState(marginPct ?? '')
  const [cont, setCont]     = useState(contPct ?? '')
  const ref = useRef(null)

  useEffect(() => {
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [onClose])

  const popW = 280
  const popH = 280
  const left = Math.min(pos.x, window.innerWidth - popW - 12)
  const top  = pos.y + pos.h + 4 + popH > window.innerHeight
    ? pos.y - popH - 4
    : pos.y + pos.h + 4

  const mPct = Number(margin) || 0
  const cPct = Number(cont) || 0
  const marginAmt = estimatedCost * mPct / 100
  const contAmt   = estimatedCost * cPct / 100

  return (
    <div ref={ref} className="fixed z-[9999] rounded-sm shadow-2xl flex flex-col gap-2.5 p-3"
      style={{ backgroundColor: '#292524', border: '2px solid #ea580c', width: popW,
        top, left, boxShadow: '0 12px 40px rgba(0,0,0,0.6)' }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9.5px] font-mono uppercase tracking-widest" style={{ color: '#fb923c' }}>Margin & Contingency</span>
        <button type="button" onClick={onClose} className="p-0.5 hover:bg-stone-700 rounded transition-colors">
          <X className="w-3 h-3" style={{ color: '#a8a29e' }} />
        </button>
      </div>
      <div className="flex flex-col gap-0.5">
        <label className="text-[9.5px] font-mono uppercase tracking-widest" style={{ color: '#78716c' }}>Margin %</label>
        <div className="flex items-center gap-2">
          <input type="number" step="0.5" min="0" max="100" value={margin} onChange={e => setMargin(e.target.value)}
            placeholder={String(defaultMargin)}
            className="flex-1 px-2 py-1.5 text-[11.5px] font-mono rounded-sm focus:ring-1 focus:ring-orange-500"
            style={{ backgroundColor: '#1c1917', border: '1px solid #44403c', color: '#f4a261' }} autoFocus />
          <span className="text-[10.5px] font-mono" style={{ color: '#fb923c' }}>+{fmtCurrency(marginAmt, currency)}</span>
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        <label className="text-[9.5px] font-mono uppercase tracking-widest" style={{ color: '#78716c' }}>Contingency %</label>
        <div className="flex items-center gap-2">
          <input type="number" step="0.5" min="0" max="100" value={cont} onChange={e => setCont(e.target.value)}
            placeholder={String(defaultCont)}
            className="flex-1 px-2 py-1.5 text-[11.5px] font-mono rounded-sm focus:ring-1 focus:ring-orange-500"
            style={{ backgroundColor: '#1c1917', border: '1px solid #44403c', color: '#f4a261' }} />
          <span className="text-[10.5px] font-mono" style={{ color: '#fb923c' }}>+{fmtCurrency(contAmt, currency)}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <button type="button" onClick={() => onSave({ margin_pct: Number(margin) || 0, contingency_pct: Number(cont) || 0 })}
          className="flex-1 px-2 py-1.5 text-[10.5px] font-mono uppercase tracking-wider font-bold rounded-sm"
          style={{ backgroundColor: '#ea580c', color: '#fff7ed', border: '1px solid #c2410c' }}>Save</button>
        <button type="button" onClick={() => { setMargin(String(defaultMargin)); setCont(String(defaultCont)) }}
          className="flex items-center gap-1 px-2 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm"
          style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
          <RotateCcw className="w-3 h-3" /> Default
        </button>
      </div>
    </div>
  )
}

// ─── Expense filter panel ──────────────────────────────────
function ExpenseFilterPanel({ filters, phases, assets, tasks, onAdd, onUpdate, onRemove, onClose }) {
  function getOptions(f) {
    const def = EXPENSE_FILTER_FIELDS.find(ff => ff.value === f.field)
    if (!def) return []
    if (def.dynamic === 'assets') return assets.map(a => ({ value: a.id, label: a.name || 'Untitled' }))
    if (def.dynamic === 'phases') return phases.map(p => ({ value: p.id, label: p.name || 'Untitled' }))
    if (def.dynamic === 'tasks')  return tasks.map(t => ({ value: t.id, label: t.name || 'Untitled' }))
    return (def.options || []).map(o => ({ value: o, label: fmtExpLabel(o) }))
  }
  function getType(f) { return EXPENSE_FILTER_FIELDS.find(ff => ff.value === f.field)?.type || 'text' }

  return (
    <div className="px-4 py-3 flex flex-col gap-2 rounded-sm" style={{ border: '1px solid #44403c', backgroundColor: '#1c1917' }}>
      {filters.map((f, i) => {
        const type = getType(f)
        const ops = EXPENSE_FILTER_OPS[type] || EXPENSE_FILTER_OPS.text
        const needsValue = !['is_empty', 'is_not_empty'].includes(f.op)
        return (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[10.5px] font-mono uppercase font-semibold" style={{ color: '#78716c', width: 40 }}>{i === 0 ? 'Where' : 'And'}</span>
            <select value={f.field} onChange={e => onUpdate(i, { field: e.target.value, value: '' })}
              className="px-2 py-1.5 text-[11.5px] font-mono rounded-sm focus:ring-2 focus:ring-orange-500"
              style={{ backgroundColor: '#292524', color: '#f4a261', border: '1px solid #44403c' }}>
              {EXPENSE_FILTER_FIELDS.map(ff => <option key={ff.value} value={ff.value}>{ff.label}</option>)}
            </select>
            <select value={f.op} onChange={e => onUpdate(i, { op: e.target.value })}
              className="px-2 py-1.5 text-[11.5px] font-mono rounded-sm focus:ring-2 focus:ring-orange-500"
              style={{ backgroundColor: '#292524', color: '#f4a261', border: '1px solid #44403c' }}>
              {ops.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {needsValue && (
              type === 'select' ? (
                <select value={f.value} onChange={e => onUpdate(i, { value: e.target.value })}
                  className="px-2 py-1.5 text-[11.5px] font-mono rounded-sm focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#292524', color: '#f4a261', border: '1px solid #44403c' }}>
                  <option value="">-- select --</option>
                  {getOptions(f).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input type="text" value={f.value || ''} onChange={e => onUpdate(i, { value: e.target.value })}
                  placeholder="value..."
                  className="px-2 py-1.5 text-[11.5px] font-mono rounded-sm focus:ring-2 focus:ring-orange-500 w-36"
                  style={{ backgroundColor: '#292524', color: '#f4a261', border: '1px solid #44403c' }} />
              )
            )}
            <button type="button" onClick={() => onRemove(i)} className="p-1 hover:bg-stone-700 rounded-sm transition-colors" style={{ color: '#fca5a5' }}><X className="w-3.5 h-3.5" /></button>
          </div>
        )
      })}
      <div className="flex items-center gap-2 mt-1">
        <button type="button" onClick={onAdd}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded-sm hover:bg-stone-800 transition-colors"
          style={{ color: '#fb923c', border: '1px solid #44403c' }}>
          <Plus className="w-3.5 h-3.5" /> Add filter
        </button>
        {filters.length > 0 && (
          <button type="button" onClick={onClose}
            className="px-2.5 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded-sm hover:bg-stone-800 transition-colors"
            style={{ color: '#a8a29e', border: '1px solid #44403c' }}>Done</button>
        )}
      </div>
    </div>
  )
}


// ─── Expense saved views dropdown ──────────────────────────
function ExpenseSavedViewsDropdown({ views, onLoad, onDelete, onSave }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2.5 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded-sm hover:bg-stone-700 transition-colors"
        style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
        <BookmarkPlus className="w-3.5 h-3.5" /> Views
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 rounded-sm overflow-hidden z-30"
          style={{ backgroundColor: '#292524', border: '1px solid #44403c', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
          {views.length === 0 && <div className="px-3 py-2.5 text-[11.5px] font-mono italic" style={{ color: '#78716c' }}>No saved views</div>}
          {views.map(v => (
            <div key={v.id} className="flex items-center justify-between px-3 py-2 hover:bg-stone-700 cursor-pointer transition-colors"
              onClick={() => { onLoad(v); setOpen(false) }}>
              <span className="text-[11.5px] font-mono truncate" style={{ color: '#d6d3d1' }}>{v.name}</span>
              <button type="button" onClick={e => { e.stopPropagation(); onDelete(v.id) }}
                className="p-0.5 hover:bg-stone-600 rounded-sm transition-colors" style={{ color: '#fca5a5' }}><X className="w-3 h-3" /></button>
            </div>
          ))}
          <div style={{ borderTop: '1px solid #44403c' }}>
            <button type="button" onClick={() => { onSave(); setOpen(false) }}
              className="w-full flex items-center gap-1.5 px-3 py-2 hover:bg-stone-700 text-[11.5px] font-mono transition-colors"
              style={{ color: '#fb923c' }}>
              <Save className="w-3 h-3" /> Save current view
            </button>
          </div>
        </div>
      )}
    </div>
  )
}


// ─── Expense create / edit popup ───────────────────────────
function ExpensePopup({ expense, phases, assets, tasks, projectId, ctx, currency, onSave, onClose }) {
  const isEdit = !!expense
  const [title, setTitle]                 = useState(expense?.title || '')
  const [description, setDescription]     = useState(expense?.description || '')
  const [estimatedCost, setEstimatedCost] = useState(expense?.estimated_cost ?? '')
  const [actualCost, setActualCost]       = useState(expense?.actual_cost ?? '')
  const [purchaseDate, setPurchaseDate]   = useState(expense?.purchase_date || '')
  const [assetIds, setAssetIds]           = useState(expense?.asset_ids || [])
  const [phaseIds, setPhaseIds]           = useState(expense?.phase_ids || [])
  const [taskIds, setTaskIds]             = useState(expense?.task_ids || [])
  const [fileIds, setFileIds]             = useState(expense?.file_ids || [])
  const [uploadedFiles, setUploadedFiles] = useState([])
  const [uploading, setUploading]         = useState(false)
  const [uploadError, setUploadError]     = useState(null)
  const [busy, setBusy]                   = useState(false)
  const fileInputRef = useRef(null)

  const [existingFiles, setExistingFiles] = useState([])
  useEffect(() => {
    if (!isEdit || fileIds.length === 0) return
    const adapter = ctx?.getAdapter?.()
    if (!adapter?.listFiles) return
    adapter.listFiles(projectId).then(files => {
      setExistingFiles(files.filter(f => fileIds.includes(f.id)))
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const allFiles = useMemo(() => {
    const map = new Map()
    for (const f of existingFiles) map.set(f.id, f)
    for (const f of uploadedFiles) map.set(f.id, f)
    return [...map.values()]
  }, [existingFiles, uploadedFiles])

  async function handleFileUpload(e) {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    setUploading(true)
    const adapter = ctx?.getAdapter?.()
    if (!adapter?.uploadFile) { setUploading(false); return }
    try {
      const results = []
      for (const file of files) {
        const uploaded = await adapter.uploadFile(projectId, { type: 'expense' }, file)
        if (uploaded?.id) results.push({ id: uploaded.id, name: file.name, mime_type: file.type })
      }
      setUploadedFiles(prev => [...prev, ...results])
      setFileIds(prev => [...prev, ...results.map(r => r.id)])
    } catch (err) {
      // 🚨 A REFUSAL MUST BE READ, NOT LOGGED. Session 37 gave uploadFile
      // three new guaranteed-throw paths (a workspace on its own server has
      // no cloud upload route; an unreadable storage choice; a bucket the
      // browser was blocked from reaching) — and this catch turned every one
      // of them into a spinner that stops with no file and no explanation.
      // console.error is invisible to the person the sentence was written for.
      console.error('Upload failed', err)
      setUploadError(err?.message || 'Upload failed.')
    }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = '' }
  }
  function removeFile(id) {
    setFileIds(prev => prev.filter(fid => fid !== id))
    setUploadedFiles(prev => prev.filter(f => f.id !== id))
    setExistingFiles(prev => prev.filter(f => f.id !== id))
  }
  function handleSubmit() {
    if (!title.trim()) return
    setBusy(true)
    onSave({
      title: title.trim(), description: description.trim(),
      estimated_cost: Number(estimatedCost) || 0,
      actual_cost: Number(actualCost) || 0,
      purchase_date: purchaseDate,
      asset_ids: assetIds, phase_ids: phaseIds, task_ids: taskIds, file_ids: fileIds,
    })
  }

  const est = Number(estimatedCost) || 0
  const act = Number(actualCost) || 0
  const variance = act - est

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative flex flex-col rounded-sm shadow-2xl" style={{ backgroundColor: '#292524', border: '2px solid #44403c', width: 620, maxHeight: '85vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b-2 border-stone-600 flex-shrink-0" style={{ backgroundColor: '#1c1917' }}>
          <div className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-orange-400" />
            <span className="text-sm font-bold text-orange-400 uppercase tracking-wide">{isEdit ? 'Edit Expense' : 'New Expense'}</span>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-stone-700 transition-colors"><X className="w-5 h-5" style={{ color: '#a8a29e' }} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Title */}
          <div className="flex flex-col gap-1">
            <label className="text-[9.5px] font-mono uppercase tracking-widest" style={{ color: '#fb923c' }}>Title *</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Software License, Equipment Rental" autoFocus
              className="px-3 py-2 text-[11.5px] font-mono rounded-sm focus:ring-1 focus:ring-orange-500"
              style={{ backgroundColor: '#1c1917', border: '1px solid #44403c', color: '#d6d3d1' }} />
          </div>

          {/* Costs row: Estimated + Actual + Variance display */}
          <div className="flex gap-4">
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-[9.5px] font-mono uppercase tracking-widest" style={{ color: '#fb923c' }}>Estimated Cost ({currency})</label>
              <input type="number" step="0.01" min="0" value={estimatedCost} onChange={e => setEstimatedCost(e.target.value)} placeholder="0.00"
                className="px-3 py-2 text-[11.5px] font-mono rounded-sm focus:ring-1 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', border: '1px solid #44403c', color: '#d6d3d1' }} />
            </div>
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-[9.5px] font-mono uppercase tracking-widest" style={{ color: '#fb923c' }}>Actual Cost ({currency})</label>
              <input type="number" step="0.01" min="0" value={actualCost} onChange={e => setActualCost(e.target.value)} placeholder="0.00"
                className="px-3 py-2 text-[11.5px] font-mono rounded-sm focus:ring-1 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', border: '1px solid #44403c', color: '#d6d3d1' }} />
            </div>
            <div className="flex flex-col gap-1 flex-shrink-0" style={{ minWidth: 100 }}>
              <label className="text-[9.5px] font-mono uppercase tracking-widest" style={{ color: '#fb923c' }}>Variance</label>
              <div className="px-3 py-2 text-[11.5px] font-mono rounded-sm" style={{ backgroundColor: '#1c1917', border: '1px solid #44403c' }}>
                {est > 0 ? (
                  <span style={{ color: variance > 0 ? '#fca5a5' : variance < 0 ? '#86efac' : '#a8a29e' }}>
                    {variance > 0 ? '+' : ''}<CurrencyDisplay value={variance} currency={currency} className="inline" style={{ color: 'inherit' }} />
                  </span>
                ) : <span style={{ color: '#57534e' }}>{'\u2014'}</span>}
              </div>
            </div>
          </div>

          {/* Date */}
          <div className="flex flex-col gap-1" style={{ maxWidth: 220 }}>
            <label className="text-[9.5px] font-mono uppercase tracking-widest" style={{ color: '#fb923c' }}>Purchase Date</label>
            <input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)}
              className="px-3 py-2 text-[11.5px] font-mono rounded-sm focus:ring-1 focus:ring-orange-500"
              style={{ backgroundColor: '#1c1917', border: '1px solid #44403c', color: '#d6d3d1' }} />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1">
            <label className="text-[9.5px] font-mono uppercase tracking-widest" style={{ color: '#fb923c' }}>Description / Reason</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Why was this expense incurred?" rows={3}
              className="px-3 py-2 text-[11.5px] font-mono rounded-sm focus:ring-1 focus:ring-orange-500 resize-none"
              style={{ backgroundColor: '#1c1917', border: '1px solid #44403c', color: '#d6d3d1' }} />
          </div>

          {/* Relations */}
          <div className="flex flex-col gap-2">
            <label className="text-[9.5px] font-mono uppercase tracking-widest" style={{ color: '#fb923c' }}>Related Items</label>
            <div className="space-y-2">
              <RelationPicker label="Assets" icon={<Boxes className="w-3 h-3" />} items={assets} selectedIds={assetIds} onChange={setAssetIds} nameKey="name" />
              <RelationPicker label="Phases" icon={<Layers className="w-3 h-3" />} items={phases} selectedIds={phaseIds} onChange={setPhaseIds} nameKey="name" />
              <RelationPicker label="Tasks"  icon={<FileText className="w-3 h-3" />} items={tasks} selectedIds={taskIds} onChange={setTaskIds} nameKey="name" />
            </div>
          </div>

          {/* File upload */}
          <div className="flex flex-col gap-2">
            <label className="text-[9.5px] font-mono uppercase tracking-widest" style={{ color: '#fb923c' }}>Invoices / Receipts</label>
            {allFiles.length > 0 && (
              <div className="flex flex-col gap-1">
                {allFiles.map(f => (
                  <div key={f.id} className="flex items-center gap-2 px-2 py-1.5 rounded-sm" style={{ backgroundColor: '#1c1917', border: '1px solid #44403c' }}>
                    <Paperclip className="w-3 h-3 flex-shrink-0" style={{ color: '#78716c' }} />
                    <span className="text-[11.5px] font-mono truncate flex-1" style={{ color: '#a8a29e' }}>{f.name}</span>
                    <button type="button" onClick={() => removeFile(f.id)} className="p-0.5 rounded hover:bg-stone-700 transition-colors flex-shrink-0" style={{ color: '#ef4444' }}><X className="w-3 h-3" /></button>
                  </div>
                ))}
              </div>
            )}
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11.5px] font-mono rounded-sm transition-colors hover:bg-stone-700 self-start"
              style={{ color: '#a8a29e', border: '1px dashed #44403c' }}>
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              {uploading ? 'Uploading...' : 'Upload files'}
            </button>
            {uploadError && (
              <p className="text-[11px] font-mono leading-relaxed" style={{ color: '#ef4444' }}>{uploadError}</p>
            )}
            <input ref={fileInputRef} type="file" multiple className="hidden"
              onChange={e => { setUploadError(null); handleFileUpload(e) }} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t-2 border-stone-600 flex-shrink-0">
          <p className="text-[10.5px] font-mono" style={{ color: '#78716c' }}>{isEdit ? 'Changes are saved when you press Save.' : 'Nothing is saved until you press Create.'}</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-[11.5px] font-mono rounded-sm hover:bg-stone-700 transition-colors" style={{ color: '#a8a29e', border: '1px solid #44403c' }}>Cancel</button>
            <button type="button" onClick={handleSubmit} disabled={!title.trim() || busy}
              className="px-4 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}>{busy ? 'Saving...' : isEdit ? 'Save' : 'Create'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}


// ─── Relation picker (multi-select dropdown) ───────────────
function RelationPicker({ label, icon, items, selectedIds, onChange, nameKey }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])
  const filtered = useMemo(() => {
    if (!search.trim()) return items
    const q = search.toLowerCase()
    return items.filter(it => (it[nameKey] || '').toLowerCase().includes(q))
  }, [items, search, nameKey])
  function toggle(id) {
    if (selectedIds.includes(id)) onChange(selectedIds.filter(x => x !== id))
    else onChange([...selectedIds, id])
  }
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11.5px] font-mono rounded-sm transition-colors hover:bg-stone-700 w-full text-left"
        style={{ backgroundColor: '#1c1917', border: '1px solid #44403c', color: '#a8a29e' }}>
        {icon}<span>{label}</span>
        {selectedIds.length > 0 && <span className="ml-auto px-1.5 py-0.5 rounded-sm text-[10.5px]" style={{ backgroundColor: '#ea580c', color: '#fff7ed' }}>{selectedIds.length}</span>}
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1 rounded-sm shadow-xl flex flex-col" style={{ backgroundColor: '#292524', border: '1px solid #44403c', maxHeight: 220 }}>
          {items.length > 5 && (
            <div className="p-1.5 border-b border-stone-700">
              <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search ${label.toLowerCase()}...`} autoFocus
                className="w-full px-2 py-1 text-[11.5px] font-mono rounded-sm focus:ring-1 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', border: '1px solid #44403c', color: '#d6d3d1' }} />
            </div>
          )}
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 ? <div className="px-3 py-2 text-[10.5px] font-mono" style={{ color: '#78716c' }}>No items</div> : (
              filtered.map(it => {
                const checked = selectedIds.includes(it.id)
                return (
                  <label key={it.id} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-stone-700 transition-colors">
                    <input type="checkbox" checked={checked} onChange={() => toggle(it.id)} className="accent-orange-500 w-3.5 h-3.5" />
                    <span className="text-[11.5px] font-mono truncate" style={{ color: checked ? '#d6d3d1' : '#a8a29e' }}>{it[nameKey] || 'Unnamed'}</span>
                  </label>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}


// ─── Sub-components ───────────────────────────────────────
function Card({ title, children }) {
  return (
    <div className="rounded-sm p-5 mb-4" style={{ border: '1px solid #44403c' }}>
      {title && (
        <h3 className="text-[10.5px] font-mono uppercase tracking-widest font-bold mb-4 px-1" style={{ color: '#fb923c' }}>
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
    <div className="flex-1 min-w-[120px] flex flex-col rounded-sm px-4 py-3"
      style={{ backgroundColor: colors.bg, border: `1px solid ${colors.border}` }}>
      <span className="text-[11.5px] font-mono uppercase tracking-widest block mb-1" style={{ color: colors.label }}>{label}</span>
      <span className="text-xl font-mono font-bold" style={{ color: colors.text }}>{value}</span>
      {hint && <span className="text-[10.5px] font-mono mt-0.5" style={{ color: colors.label }}>{hint}</span>}
    </div>
  )
}

function BreakdownTable({ rows, currency, labelHeader, countHeader }) {
  return (
    <div className="flex flex-col gap-1 p-3">
      <HeaderRow cols={[labelHeader, countHeader, 'Bid', 'Logged', 'Variance', 'Cost']} sixCol />
      {rows.map((row, i) => (
        <div key={`${row.name}-${i}`} className="grid grid-cols-6 gap-2 px-3 py-2 rounded-sm text-[11.5px] font-mono items-center transition-colors hover:bg-stone-800" style={{ backgroundColor: '#1c1917', border: '1px solid #44403c' }}>
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
    <div className={`grid ${sixCol ? 'grid-cols-6' : 'grid-cols-3'} gap-2 px-3 py-1.5`} style={{ borderBottom: '1px solid #44403c' }}>
      {cols.map(c => (
        <span key={c} className="text-[10.5px] font-mono uppercase tracking-widest" style={{ color: '#78716c' }}>{c}</span>
      ))}
    </div>
  )
}

function VarianceCell({ value }) {
  const tone = varianceTone(value)
  const colors = { good: '#86efac', danger: '#fca5a5', neutral: '#a8a29e' }[tone]
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
      <span className="text-[9.5px] font-mono uppercase tracking-widest" style={{ color: '#fb923c' }}>{label}</span>
      {children}
    </div>
  )
}

function budgetStatusColor(id) {
  switch (id) {
    case 'in_progress':     return '#fb923c'
    case 'pending_review':  return '#fbbf24'
    case 'needs_revisions': return '#e879f9'
    case 'approved':        return '#4ade80'
    case 'final':           return '#22c55e'
    case 'blocked':         return '#ef4444'
    case 'on_hold':         return '#fcd34d'
    case 'omitted':         return '#57534e'
    case 'bidding':         return '#c084fc'
    default:                return '#a8a29e'
  }
}

function Select({ value, onChange, options, colorFn }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="px-2 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm cursor-pointer"
      style={{ backgroundColor: '#292524', border: '1px solid #44403c', color: colorFn ? colorFn(value) : '#d6d3d1' }}
    >
      {options.map(o => <option key={o.value} value={o.value} style={colorFn ? { color: colorFn(o.value) } : undefined}>{o.label}</option>)}
    </select>
  )
}

function CenterMsg({ children }) {
  return (
    <div className="h-full flex items-center justify-center" style={{ backgroundColor: '#1c1917' }}>
      <span className="text-[11.5px] font-mono uppercase tracking-wider" style={{ color: '#a8a29e' }}>{children}</span>
    </div>
  )
}

function Empty({ children }) {
  return <div className="text-[11.5px] font-mono italic" style={{ color: '#78716c' }}>{children}</div>
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
