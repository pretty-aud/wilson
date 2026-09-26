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
import { createPortal } from 'react-dom'
import { v4 as uuidv4 } from 'uuid'
import {
  DollarSign, Layers, Boxes, UserCircle, Sparkles, Receipt,
  ArrowUp, ArrowDown, Minus, AlertCircle, Save, Trash2,
  Lock, LockOpen, CheckCircle, Plus, Pencil, X, Undo2, Redo2,
  Upload, FileText, Paperclip, Search, Filter, ArrowUpDown, ArrowRight,
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
import CurrencyDisplay, { formatMoney, MONEY_LOCALE } from '../components/CurrencyDisplay'
import CrewTeamTab from './budget/CrewTeamTab'
import TalentTab from './budget/TalentTab'
import ClientViewTab from './budget/ClientViewTab'
import MarginContPopover from './budget/MarginContPopover'
import { INK_LIGHT } from '../../../ui/tokens.js'
import {
  Table, Th, Td, Row, Stat, StatusDot, StatusBadge, EmptyState, Loading,
  SectionTitle, Button, IconButton, Switch, Banner, Toolbar, Dialog, HoverActions, Badge,
} from '../../../ui'
import './rabbitBudget.css'

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
  { id: 'needs_revisions', label: 'Needs revisions' },
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
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-control transition-colors"
              style={{
                /* V1: the same stopgap as ViewTabs directly above it — `#fff7ed`
                   on the signal was 3.35:1 (C6). The fill is lane B5's to
                   remove (§3.2: the active tab takes the underline). */
                color: active ? INK_LIGHT : '#a8a29e',
                backgroundColor: active ? '#ea580c' : 'transparent',
                borderBottom: active ? '2px solid #ea580c' : '2px solid transparent',
              }}
            >
              <Icon className="w-3 h-3" />
              <span className="text-label uppercase">
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
          <div className="text-dense leading-relaxed" style={{ color: '#d6d3d1' }}>
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
    <div className="rb-budget-page">
      {/* ── Active budget banner: the kit Banner in the success tone. The
          words are the one ink and the tone is the tint and the icon, so
          nothing here is green text (R3-13). ── */}
      {isActive && lockedVersion && (
        <Banner
          tone="success"
          Icon={ShieldCheck}
          action={(
            <Button
              size="sm"
              Icon={RotateCcw}
              onClick={resetToTidding}
              title="Reset to bidding — re-enables bid version editing"
            >
              Reset to bidding
            </Button>
          )}
        >
          <span className="rb-budget-active-title">Budget active — in production</span>
          <span className="rb-budget-active-meta">
            Locked bid: <span className="rb-budget-active-name">{lockedVersion.name}</span>
            {' '}· {lockedVersion.snapshot?.lockedAt
              ? new Date(lockedVersion.snapshot.lockedAt).toLocaleDateString()
              : lockedVersion.created_at ? new Date(lockedVersion.created_at).toLocaleDateString() : ''}
            {' '}· <CurrencyDisplay value={lockedVersion.snapshot?.lineItemTotals?.grandTotal ?? lockedVersion.snapshot?.grandTotal ?? 0} currency={currency} />
          </span>
        </Banner>
      )}

      {/* ── Day totals row: three kit Stats in one row (R3-10). The hint is
          the Stat's visible delta line, never a tooltip; the variance's good
          or bad news is its value's tone. ── */}
      <div className="rb-budget-stats">
        <Stat
          className="rb-budget-stat"
          label="Bid days"
          value={formatTenths(variance.bid)}
          delta={`${tasks.length} task${tasks.length === 1 ? '' : 's'}`}
          deltaTone="neutral"
        />
        <Stat
          className="rb-budget-stat"
          label="Logged days"
          value={formatTenths(variance.logged)}
          delta={`${variance.bid > 0 ? Math.round((variance.logged / variance.bid) * 100) : 0}% of bid`}
          deltaTone="neutral"
        />
        <Stat
          className="rb-budget-stat"
          label="Variance"
          value={formatTenths(variance.variance, { signed: true })}
          valueTone={varianceTone(variance.variance)}
          delta={varianceLabel(variance.variance)}
          deltaTone="neutral"
        />
      </div>

      {/* ── Cost Breakdown — clean waterfall with inline controls ── */}
      {/* UX: Proximity (controls next to values), Fitts's (wide touch targets), */}
      {/* Miller's (single scannable list), Jakob's (receipt/invoice familiarity) */}
      <Card title="Cost breakdown">
        {/* One row treatment for the four inputs (R3-09): the label in the
            second ink, the amount in the ink, right-aligned to one amount
            column declared once in rabbitBudget.css (R3-35). A plus is the
            figure's sign, never the label's. */}
        <div className="rb-budget-wf">
          {/* Base cost — read only */}
          <div className="rb-budget-wf-row">
            <span className="rb-budget-wf-label">Base cost</span>
            <span className="rb-budget-wf-amount">
              <CurrencyDisplay value={baseCost} currency={currency} />
            </span>
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

          {/* Agency fee — the kit Switch (it was a hand-rolled one with no
              name) + inline editable. It toggles exactly as before. */}
          <div className="rb-budget-wf-row">
            <span className="rb-budget-wf-label">Agency fee</span>
            <Switch
              checked={agencyEnabled}
              onChange={() => {
                if (!agencyEnabled) {
                  updateProjectField('budget_agency_enabled', true)
                  if (!project?.budget_agency_pct) updateProjectField('budget_agency_pct', 20)
                } else {
                  updateProjectField('budget_agency_enabled', false)
                }
              }}
              disabled={isActive}
              aria-label="Agency fee"
            />
            {agencyEnabled && (
              <InlinePct value={agencyPct}
                onChange={v => updateProjectField('budget_agency_pct', v)}
                disabled={isActive} />
            )}
            <span className="rb-budget-wf-amount" data-off={agencyEnabled ? undefined : 'true'}>
              {agencyEnabled
                ? formatMoney(Math.round(baseCost * (agencyPct / 100)), currency, { sign: 'always' })
                : 'Off'}
            </span>
          </div>

          {/* Grand total: the page's one display number (R3-08), under the
              one signal rule. */}
          <div className="rb-budget-wf-total">
            <span className="rb-budget-wf-total-label">Grand total</span>
            <span className="rb-budget-wf-total-amount">
              <CurrencyDisplay
                value={grandTotal + (agencyEnabled ? Math.round(baseCost * (agencyPct / 100)) : 0)}
                currency={currency} />
            </span>
          </div>
        </div>

        {/* Footer info row */}
        <div className="rb-budget-wf-foot">
          <div className="rb-budget-wf-source">
            {rateCardName && (
              <span className="rb-budget-hint">
                Rates via <span className="rb-budget-wf-source-name">{rateCardName}</span>
              </span>
            )}
          </div>
          <div className="rb-budget-actuals">
            <span className="ui-field-label">Actuals</span>
            <select
              value={project?.budget_actual_column_mode || 'fortnightly'}
              onChange={e => updateProjectField('budget_actual_column_mode', e.target.value)}
              disabled={isActive}
              className="ui-input rb-budget-actuals-mode"
              data-size="sm"
              aria-label="Actuals"
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
              className="ui-input rb-budget-actuals-count"
              data-size="sm"
              aria-label="Actual columns"
            />
            <span className="rb-budget-hint">cols</span>
          </div>
        </div>

        {missingRolesCount > 0 && (
          <Banner tone="warning" Icon={AlertCircle}>
            {missingRolesCount} task{missingRolesCount === 1 ? '' : 's'} reference roles
            not in the rate card — those rows compute at $0.
            ({knownRoles} role{knownRoles === 1 ? '' : 's'} currently in the card.)
          </Banner>
        )}
      </Card>

      {/* ── Budget versioning ── */}
      <Card title="Budget versions">
        {/* Create new bid */}
        <div className="rb-budget-new-version">
          <Field label="Save current as bid version">
            <input
              type="text"
              value={versionName}
              onChange={e => setVersionName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') createBidVersion() }}
              placeholder="e.g. Bid v1 — initial estimate"
              disabled={isActive || versionBusy}
              className="ui-input"
              aria-label="Save current as bid version"
            />
          </Field>
          <Button
            variant="primary"
            Icon={Save}
            loading={versionBusy}
            onClick={createBidVersion}
            disabled={!versionName.trim() || isActive || versionBusy}
          >
            Save
          </Button>
        </div>

        {/* Saved versions list: the kit Table (R3-20, R3-28 — one cell
            padding head and body). Selection is said one way (R3-38): the
            ACTIVE version is the kit's selected row; LOCKED is a badge in its
            row, never a green row. */}
        {budgetVersions.length === 0 ? (
          <Empty compact title="No budget versions saved yet" body="Create one to track bid snapshots." />
        ) : (
          <Table
            className="rb-budget-versions"
            head={(
              <Row>
                <Th width="var(--rb-budget-col-mark)">Active</Th>
                <Th>Name</Th>
                <Th width="var(--rb-budget-col-date)">Date</Th>
                <Th width="var(--rb-budget-col-money)" numeric>Total</Th>
                <Th width="var(--rb-budget-col-days)" numeric>Days</Th>
                <Th width="var(--rb-budget-col-acts)" align="right">Actions</Th>
              </Row>
            )}
          >
            {budgetVersions
              .slice()
              .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
              .map(v => (
                <Row key={v.id} selected={v.is_active}>
                  <Td className="rb-budget-icon-cell">
                    {isActive && v.id === lockedVersionId ? (
                      <ShieldCheck className="rb-budget-mark" data-tone="success" aria-hidden="true" />
                    ) : v.is_active ? (
                      <CheckCircle className="rb-budget-mark" data-tone="signal" aria-hidden="true" />
                    ) : (
                      <IconButton
                        Icon={CheckCircle}
                        size="sm"
                        onClick={() => setActiveVersion(v.id)}
                        disabled={versionBusy || isActive}
                        title={isActive ? 'Reset to bidding to change versions' : 'Set as active'}
                      />
                    )}
                  </Td>
                  <Td>
                    <span className="rb-budget-version-name">
                      <span className="rb-budget-version-text">{v.name}</span>
                      {isActive && v.id === lockedVersionId && (
                        <StatusBadge tone="success" label="Locked" />
                      )}
                    </span>
                  </Td>
                  <Td className="rb-budget-date" data-empty={v.created_at ? undefined : 'true'}>
                    {v.created_at ? new Date(v.created_at).toLocaleDateString() : '—'}
                  </Td>
                  <Td numeric className="rb-budget-quiet">
                    <CurrencyDisplay
                      value={v.snapshot?.grandTotal ?? v.snapshot?.baseCost ?? 0}
                      currency={currency}
                    />
                  </Td>
                  <Td numeric className="rb-budget-quiet">
                    {formatTenths(v.snapshot?.totalBidDays ?? 0)}
                  </Td>
                  <Td align="right" className="rb-budget-icon-cell">
                    <IconButton
                      Icon={Trash2}
                      size="sm"
                      danger
                      onClick={() => deleteVersion(v.id)}
                      disabled={versionBusy || (isActive && v.id === lockedVersionId)}
                      title={isActive && v.id === lockedVersionId ? 'Cannot delete locked version' : 'Delete version'}
                    />
                  </Td>
                </Row>
              ))}
          </Table>
        )}

        {/* Variance against active version: the tone is the figure's alone
            (R19), never the box's edge. */}
        {versionVariance && (
          <div className="rb-budget-vs">
            <span className="rb-budget-eyebrow">
              Variance vs active bid ({activeVersion?.name})
            </span>
            <div className="rb-budget-vs-figures">
              <span
                className="rb-budget-vs-value"
                data-tone={Math.abs(versionVariance.diff) < 0.01 ? undefined : versionVariance.diff > 0 ? 'danger' : 'success'}
              >
                <CurrencyDisplay value={versionVariance.diff} currency={currency} signed />
              </span>
              <span className="rb-budget-vs-pct">
                ({formatTenths(versionVariance.pctChange, { signed: true })}%)
              </span>
              <span className="rb-budget-vs-detail">
                Bid: <CurrencyDisplay value={versionVariance.bidTotal} currency={currency} />
                {' '}| Current: <CurrencyDisplay value={versionVariance.currentTotal} currency={currency} />
              </span>
            </div>
          </div>
        )}

        {/* Set Active button + confirmation dialog */}
        {!isActive && budgetVersions.length > 0 && activeVersion && !showActivateConfirm && (
          <div className="rb-budget-actions">
            <Button Icon={ShieldCheck} onClick={() => setShowActivateConfirm(true)}>
              Set budget active
            </Button>
          </div>
        )}

        {/* Confirmation: an inline panel, as it has always been (C1). The
            caution is its one edge and its icon; every word is an ink. */}
        {showActivateConfirm && (
          <div className="rb-budget-confirm">
            <div className="rb-budget-confirm-body">
              <AlertCircle className="rb-budget-confirm-icon" aria-hidden="true" />
              <div>
                <span className="rb-budget-confirm-title">
                  Confirm: set budget to active
                </span>
                <p className="rb-budget-confirm-text">
                  This will lock <span className="rb-budget-confirm-name">"{activeVersion?.name}"</span> as
                  the approved bid for this project. A snapshot of all task counts, durations, and budget totals
                  will be frozen as the reference point for production.
                </p>
                <p className="rb-budget-confirm-note">
                  While active, you will not be able to create new bid versions or switch between versions.
                  You can reset this later if needed.
                </p>
              </div>
            </div>
            <div className="rb-budget-confirm-foot">
              <Button onClick={() => setShowActivateConfirm(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                Icon={Lock}
                loading={versionBusy}
                onClick={activateBudget}
                disabled={versionBusy}
              >
                Confirm — set active
              </Button>
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
      voice_actor:      'Voice actors',
      extra:            'Extras',
      background:       'Backgrounds',
      stunt_performer:  'Stunt performers',
      motion_capture:   'Motion capture performers',
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
        <Empty
          compact
          title="No budget data yet"
          body="Add team members, talent lines, or expenses to see the rollup here."
        />
      </Card>
    )
  }

  // The kit Table (R3-20). The money columns keep their order — Subtotal,
  // Agency, Bid, Actual, Variance (R3-05) — and share one width, declared once
  // in rabbitBudget.css. A section's row and the rows indented under it start
  // their words on one rail: the indent is the section icon plus its gap.
  const columns = agencyEnabled ? 6 : 5

  function DataRow({ label, subtotal, agencyFee, bidTotal, actualTotal, bold, indent }) {
    const v = actualTotal - bidTotal
    return (
      <Row className="rb-budget-top-row" data-total={bold ? 'true' : undefined}>
        <Td className="rb-budget-top-cat" data-indent={indent ? 'true' : undefined}>{label}</Td>
        <Td numeric className="rb-budget-quiet">{formatMoney(subtotal, currency)}</Td>
        {agencyEnabled && (
          <Td numeric className="rb-budget-quiet">
            <span className="rb-budget-dash" data-empty={agencyFee ? undefined : 'true'}>
              {agencyFee ? formatMoney(agencyFee, currency) : '—'}
            </span>
          </Td>
        )}
        <Td numeric>{formatMoney(bidTotal, currency)}</Td>
        <Td numeric>
          <span className="rb-budget-dash" data-empty={actualTotal ? undefined : 'true'}>
            {actualTotal ? formatMoney(actualTotal, currency) : '—'}
          </span>
        </Td>
        <Td numeric>
          <span className="rb-budget-var" data-tone={v > 0 ? 'danger' : v < 0 ? 'success' : 'zero'}>
            {bidTotal > 0 || actualTotal > 0 ? formatMoney(v, currency, { sign: 'exceptZero' }) : '—'}
          </span>
        </Td>
      </Row>
    )
  }

  function SectionHeader({ label, Icon }) {
    return (
      <Row>
        <Td colSpan={columns}>
          <span className="rb-budget-top-group">
            <Icon className="rb-budget-top-icon" aria-hidden="true" />
            {label}
          </span>
        </Td>
      </Row>
    )
  }

  return (
    <Card title="Topsheet rollup">
      <Table
        className="rb-budget-top"
        head={(
          <Row>
            <Th>Category</Th>
            <Th width="var(--rb-budget-col-money)" numeric>Subtotal</Th>
            {agencyEnabled && <Th width="var(--rb-budget-col-money)" numeric>Agency</Th>}
            <Th width="var(--rb-budget-col-money)" numeric>Bid</Th>
            <Th width="var(--rb-budget-col-money)" numeric>Actual</Th>
            <Th width="var(--rb-budget-col-money)" numeric>Variance</Th>
          </Row>
        )}
        foot={(
          <Row>
            <Td>Grand total</Td>
            <Td numeric>{formatMoney(grand.subtotal, currency)}</Td>
            {agencyEnabled && <Td numeric>{formatMoney(grand.agencyFee, currency)}</Td>}
            <Td numeric>{formatMoney(grand.bidTotal, currency)}</Td>
            <Td numeric>
              <span className="rb-budget-dash" data-empty={grand.actualTotal ? undefined : 'true'}>
                {grand.actualTotal ? formatMoney(grand.actualTotal, currency) : '—'}
              </span>
            </Td>
            <Td numeric>
              <span className="rb-budget-var" data-tone={grand.variance > 0 ? 'danger' : grand.variance < 0 ? 'success' : 'zero'}>
                {grand.bidTotal > 0 || grand.actualTotal > 0 ? formatMoney(grand.variance, currency, { sign: 'exceptZero' }) : '—'}
              </span>
            </Td>
          </Row>
        )}
      >
        {/* ── Crew / Team ── */}
        {crewData.departments.length > 0 && (
          <>
            <SectionHeader label="Crew / Team" Icon={Users} />
            {crewData.departments.map(d => (
              <DataRow key={d.department} label={d.department} indent subtotal={d.subtotal} agencyFee={d.agencyFee} bidTotal={d.bidTotal} actualTotal={d.actualTotal} />
            ))}
            <DataRow label="Crew / Team total" bold subtotal={crewData.total.subtotal} agencyFee={crewData.total.agencyFee} bidTotal={crewData.total.bidTotal} actualTotal={crewData.total.actualTotal} />
          </>
        )}

        {/* ── Talent ── */}
        {talentData.types.length > 0 && (
          <>
            <SectionHeader label="Talent" Icon={Star} />
            {talentData.types.map(t => (
              <DataRow key={t.type} label={t.label} indent subtotal={t.subtotal} agencyFee={t.agencyFee} bidTotal={t.bidTotal} actualTotal={t.actualTotal} />
            ))}
            <DataRow label="Talent total" bold subtotal={talentData.total.subtotal} agencyFee={talentData.total.agencyFee} bidTotal={talentData.total.bidTotal} actualTotal={talentData.total.actualTotal} />
          </>
        )}

        {/* ── Expenses ── */}
        {expenseData.count > 0 && (
          <>
            <SectionHeader label={`Expenses (${expenseData.count})`} Icon={Receipt} />
            <DataRow label="All expenses" indent subtotal={expenseData.estimated} agencyFee={0} bidTotal={expenseData.estimated} actualTotal={expenseData.actual} />
          </>
        )}
      </Table>
    </Card>
  )
}


// ─── Waterfall row — inline % control next to computed amount ──
// One of the waterfall's four input rows (R3-09). The amount carries its own
// sign: a margin is an amount added by definition, so its plus is the
// figure's (`sign: 'always'`, R3-14), never a prefix on the label.
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
    <div className="rb-budget-wf-row">
      <span className="rb-budget-wf-label">{label}</span>
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
          className="ui-input rb-budget-pct"
          data-size="sm"
          aria-label={`${label} percentage`}
        />
      ) : (
        <button
          type="button" onClick={start} disabled={disabled}
          className="ui-input rb-budget-pct"
          data-size="sm"
        >
          {pct}%
        </button>
      )}
      <span className="rb-budget-wf-amount">
        {formatMoney(amount, currency, { sign: 'always' })}
      </span>
    </div>
  )
}

// ─── Compact inline % input (for agency row) ──────────────
// The same % control as WaterfallRow's (it was a size smaller), so the three
// read as one kind of control.
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
        className="ui-input rb-budget-pct"
        data-size="sm"
        aria-label="Agency fee percentage"
      />
    )
  }

  return (
    <button
      type="button" onClick={start} disabled={disabled}
      className="ui-input rb-budget-pct"
      data-size="sm"
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

  if (rows.length === 0) return <Empty title="No tasks yet" body="Nothing to roll up." />

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

  if (rows.length === 0) return <Empty title="No roles assigned yet" />

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

  if (rows.length === 0) return <Empty title="No assets carry any task hours yet" />

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

  if (rows.length === 0) return <Empty title="No tasks linked to scenes yet" />

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

  if (rows.length === 0) return <Empty title="No tasks linked to shots yet" />

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

  if (rows.length === 0) return <Empty title="No tasks linked to levels yet" />

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

  if (rows.length === 0) return <Empty title="No tasks linked to experiences yet" />

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
    <div className="rb-budget-page">
      <Card title="Custom view">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Group by">
            <Select
              value={prefs.groupBy}
              onChange={v => setPrefs(p => ({ ...p, groupBy: v }))}
              options={GROUP_BY_OPTIONS.filter(o => !o.requires || project?.[o.requires]).map(o => ({ value: o.id, label: o.label }))}
              aria-label="Group by"
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
              aria-label="Phase filter"
            />
          </Field>
          <Field label="Status filter">
            {/* The status is the kit's dot, from the one STATUS map (R3-11);
                the select's words are the one ink. A status the map does not
                know ("bidding") is the kit's neutral dot. */}
            <span className="rb-budget-status-select" data-dot={prefs.statusFilter === '__all__' ? undefined : 'true'}>
              {prefs.statusFilter !== '__all__' && (
                <StatusDot status={prefs.statusFilter} aria-hidden="true" role={undefined} aria-label={undefined} title="" />
              )}
              <Select
                value={prefs.statusFilter}
                onChange={v => setPrefs(p => ({ ...p, statusFilter: v }))}
                options={STATUS_FILTER_OPTIONS.map(o => ({ value: o.id, label: o.label }))}
                aria-label="Status filter"
              />
            </span>
          </Field>
        </div>
      </Card>

      <Card title={`Breakdown · ${rows.length} group${rows.length === 1 ? '' : 's'}`}>
        {rows.length === 0 ? (
          <Empty compact title="No tasks match the current filters" />
        ) : (
          /* The totals are the table's own footer row (R3-04): the same
             grid, the same cell padding and the same right edges as the
             columns they total. */
          <BreakdownTable
            rows={rows}
            currency={budget.currency}
            labelHeader={GROUP_BY_OPTIONS.find(o => o.id === prefs.groupBy)?.label || 'Group'}
            countHeader="Tasks"
            foot={(
              <Row>
                <Td>Total</Td>
                <Td numeric>{filteredTasks.length}</Td>
                <Td numeric>{formatTenths(totalBid)}</Td>
                <Td />
                <Td />
                <Td numeric><CurrencyDisplay value={totalCost} currency={budget.currency} /></Td>
              </Row>
            )}
          />
        )}
      </Card>
    </div>
  )
}

// ─── Expenses: constants ───────────────────────────────────
const EXPENSE_FILTER_FIELDS = [
  { value: 'title',         label: 'Title',         type: 'text' },
  { value: 'description',   label: 'Description',   type: 'text' },
  { value: 'purchase_date', label: 'Date',          type: 'text' },
  { value: 'cost_status',   label: 'Cost status',   type: 'select', options: ['over_budget', 'under_budget', 'on_budget', 'no_estimate'] },
  { value: 'has_files',     label: 'Has receipts',  type: 'select', options: ['yes', 'no'] },
  { value: 'asset_id',      label: 'Linked asset',  type: 'select', dynamic: 'assets' },
  { value: 'phase_id',      label: 'Linked phase',  type: 'select', dynamic: 'phases' },
  { value: 'task_id',       label: 'Linked task',   type: 'select', dynamic: 'tasks' },
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
  { value: 'estimated_cost', label: 'Estimated cost' },
  { value: 'actual_cost',    label: 'Actual cost' },
  { value: 'variance',       label: 'Variance' },
  { value: 'purchase_date',  label: 'Date' },
  { value: 'created_at',     label: 'Created' },
]

const EXPENSE_GROUPABLE_FIELDS = [
  { value: '',               label: 'No grouping' },
  { value: 'cost_status',    label: 'Cost status' },
  { value: 'purchase_month', label: 'Month' },
  { value: 'has_files',      label: 'Has receipts' },
]

const COST_STATUS_LABELS = {
  over_budget:  'Over budget',
  under_budget: 'Under budget',
  on_budget:    'On budget',
  no_estimate:  'No estimate',
}

/** The expenses table's columns — the checkbox, Title, the five money
    columns, Date, Related, Files and the row's actions: what a group's
    header row spans. */
const EXPENSE_COLUMNS = 11

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

// A stored key in words, in sentence case (Q2): `over_budget` -> "Over
// budget". It capitalised every word.
function fmtExpLabel(str) {
  const words = (str || '').replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}


// ─── Expenses tab ──────────────────────────────────────────
// Surface 2b: the tiles, the toolbar, the filter strip and the list on the
// kit and rabbitBudget.css, with every control, its order and its behaviour
// as they were (C1).
//   · The list is the kit Table (R3-20): the same columns in the same order,
//     the money in the lane's one order — Estimated, Margin, Contingency,
//     Actual, Variance (R3-05) — every figure a numeric cell, a group's
//     header a full-width row of the table.
//   · A row's hover is the kit Row's (R3-23), its selection the kit Row's
//     `selected` (R3-38), its checkbox a 28px square (R3-40), its Edit and
//     Delete the kit HoverActions, revealed by focus as well as hover (R3-24,
//     Q17(b)).
//   · The two questions window.confirm asked are the kit Dialog (W9).
//   · The toolbar, the tiles, the filters and the table share one left edge
//     (R3-31): the shell's gutter.
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
  // W9: the two questions window.confirm used to ask, as kit Dialogs.
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [confirmResetMc, setConfirmResetMc]       = useState(false)

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
  // What window.confirm's OK did; the question is the Dialog below.
  function expBulkDelete() {
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

  // Keyboard shortcuts: Ctrl+Z / Ctrl+Shift+Z. R3-15 asked for a shortcut
  // bar; Q10 rules there is none, so the keys and the Undo / Redo titles
  // that name them stay exactly as they were (recorded).
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
           : groupBy === 'purchase_month' ? (key === '__no_date__' ? 'No date' : key)
           : groupBy === 'has_files'      ? (key === 'yes' ? 'Has receipts' : 'No receipts')
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

  // What window.confirm's OK did; the question is the Dialog below.
  async function resetAllMarginCont() {
    for (const exp of expenses) {
      if (exp.margin_pct != null || exp.contingency_pct != null) {
        await updateExpense(exp.id, { margin_pct: null, contingency_pct: null })
      }
    }
  }

  // A header click sorts by its column, and a second click turns it round.
  function sortBy(field) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  // The checkbox, the margin and contingency cells and the actions are not
  // the row's click (which edits): their cells keep the click to themselves,
  // as the wrappers they replace did.
  const keepClick = e => e.stopPropagation()

  if (expLoading) return <Loading label="Loading expenses..." />

  const allSelected = processed.length > 0 && processed.every(e => expSelected.has(e.id))

  // ── One expense, as a row of the table ──
  // A render function, not a component declared in here: that was a new
  // component type on every render, so React remounted every row each time
  // anything changed, and a row's checkbox or Edit dropped the keyboard focus
  // the moment it was used — the focus HoverActions reveals the row by.
  function expenseRow(exp) {
    const est = Number(exp.estimated_cost) || 0
    const act = Number(exp.actual_cost) || 0
    const v = act - est
    const status = expenseCostStatus(exp)
    const assetCount = exp.asset_ids?.length || 0
    const phaseCount = exp.phase_ids?.length || 0
    const taskCount  = exp.task_ids?.length || 0
    const fileCount  = exp.file_ids?.length || 0
    const isChecked = expSelected.has(exp.id)
    const mPct = exp.margin_pct != null ? Number(exp.margin_pct) : defaultMarginPct
    const cPct = exp.contingency_pct != null ? Number(exp.contingency_pct) : defaultContPct
    const mAmt = est * mPct / 100
    const cAmt = est * cPct / 100
    return (
      <Row
        key={exp.id}
        interactive
        selected={isChecked}
        className="rb-budget-exp-row"
        data-ticked={isChecked ? 'true' : 'false'}
        onClick={() => handleEdit(exp.id)}
      >
        <Td className="rb-budget-exp-check-cell" onClick={keepClick}>
          <button
            type="button"
            onClick={() => expToggleOne(exp.id)}
            className="rb-budget-check"
            data-checked={isChecked ? 'all' : 'none'}
            aria-pressed={isChecked}
            aria-label={`Select "${exp.title || 'Untitled'}"`}
          >
            {isChecked ? <CheckSquare aria-hidden="true" /> : <Square aria-hidden="true" />}
          </button>
        </Td>
        <Td>
          <span className="rb-budget-exp-title" data-empty={exp.title ? undefined : 'true'}>
            {exp.title || 'Untitled'}
          </span>
          {exp.description && <span className="rb-budget-exp-desc">{exp.description}</span>}
        </Td>
        <Td numeric className="rb-budget-quiet">
          <span className="rb-budget-dash" data-empty={est ? undefined : 'true'}>
            <CurrencyDisplay value={est} currency={currency} />
          </span>
        </Td>
        <Td numeric className="rb-budget-exp-mc-cell" onClick={keepClick}>
          <button type="button" onClick={e => handleMcCellClick(e, exp.id)} className="ui-input rb-budget-exp-mc" data-size="sm">
            {mAmt > 0
              ? <CurrencyDisplay value={mAmt} currency={currency} signed />
              : <span className="rb-budget-dash" data-empty="true">{'—'}</span>}
          </button>
        </Td>
        <Td numeric className="rb-budget-exp-mc-cell" onClick={keepClick}>
          <button type="button" onClick={e => handleMcCellClick(e, exp.id)} className="ui-input rb-budget-exp-mc" data-size="sm">
            {cAmt > 0
              ? <CurrencyDisplay value={cAmt} currency={currency} signed />
              : <span className="rb-budget-dash" data-empty="true">{'—'}</span>}
          </button>
        </Td>
        <Td numeric>
          <span className="rb-budget-dash" data-empty={act ? undefined : 'true'}>
            <CurrencyDisplay value={act} currency={currency} />
          </span>
        </Td>
        <Td numeric className="rb-budget-quiet">
          {est > 0 ? (
            <span className="rb-budget-var" data-tone={status === 'over_budget' ? 'danger' : status === 'under_budget' ? 'success' : undefined}>
              <CurrencyDisplay value={v} currency={currency} signed />
            </span>
          ) : <span className="rb-budget-dash" data-empty="true">{'—'}</span>}
        </Td>
        <Td className="rb-budget-date" data-empty={exp.purchase_date ? undefined : 'true'}>
          {exp.purchase_date || '—'}
        </Td>
        <Td className="rb-budget-exp-related">
          {assetCount + phaseCount + taskCount > 0 ? (
            <span className="rb-budget-exp-rels">
              {assetCount > 0 && <Badge>{assetCount} asset{assetCount !== 1 ? 's' : ''}</Badge>}
              {phaseCount > 0 && <Badge>{phaseCount} phase{phaseCount !== 1 ? 's' : ''}</Badge>}
              {taskCount > 0 && <Badge>{taskCount} task{taskCount !== 1 ? 's' : ''}</Badge>}
            </span>
          ) : <span className="rb-budget-dash" data-empty="true">{'—'}</span>}
        </Td>
        <Td numeric>
          {fileCount > 0 ? (
            <span className="rb-budget-exp-files">
              <Paperclip className="rb-budget-exp-files-icon" aria-hidden="true" />
              {fileCount}
            </span>
          ) : <span className="rb-budget-dash" data-empty="true">{'—'}</span>}
        </Td>
        <Td align="right" className="rb-budget-icon-cell" onClick={keepClick}>
          <HoverActions>
            <IconButton size="sm" Icon={Pencil} title="Edit" onClick={() => handleEdit(exp.id)} />
            <IconButton size="sm" Icon={Trash2} danger title="Delete" onClick={() => setDeleteConfirmId(exp.id)} />
          </HoverActions>
        </Td>
      </Row>
    )
  }

  // ── A group's header: a full-width row of the table ──
  function groupRow(g) {
    return (
      <Row key={`group-${g.key}`} className="rb-budget-exp-group">
        <Td colSpan={EXPENSE_COLUMNS} className="rb-budget-exp-group-cell">
          <span className="rb-budget-exp-group-head">
            <span className="rb-budget-exp-group-label">{g.label}</span>
            <span className="rb-budget-exp-group-count">({g.items.length})</span>
            <span className="rb-budget-exp-group-totals">
              Est: <CurrencyDisplay value={g.items.reduce((s, e) => s + (Number(e.estimated_cost) || 0), 0)} currency={currency} />
              {' / '}
              Act: <span className="rb-budget-exp-group-act"><CurrencyDisplay value={g.items.reduce((s, e) => s + (Number(e.actual_cost) || 0), 0)} currency={currency} /></span>
            </span>
          </span>
        </Td>
      </Row>
    )
  }

  const body = groups
    ? groups.flatMap(g => [groupRow(g), ...g.items.map(exp => expenseRow(exp))])
    : processed.map(exp => expenseRow(exp))

  return (
    <div className="rb-budget-exp-tab">
      {/* Summary tiles: the kit Stat, through the tab's BigTile (R3-10). */}
      <div className="rb-budget-stats">
        <BigTile label="Estimated total" value={formatMoney(totalEstimated, currency)} />
        <BigTile label="Actual total" value={totalActual > 0 ? formatMoney(totalActual, currency) : '—'} />
        <BigTile
          label="Variance"
          value={totalEstimated > 0 || totalActual > 0
            ? formatMoney(totalVariance, currency, { sign: 'exceptZero' })
            : '—'}
          tone={totalVariance > 0 ? 'danger' : totalVariance < 0 ? 'good' : 'neutral'}
        />
        <BigTile label="Expenses" value={expenses.length} />
      </div>

      {/* The toolbar: the kit Toolbar, the same eleven controls in the same
          order at the 28px height (C1; the Hick's hotspot's regrouping and
          any overflow for Reset M/C are recorded for Audrey, not applied).
          Search and the count keep the far end. */}
      <Toolbar
        wrap
        className="rb-budget-exp-toolbar"
        right={(
          <>
            <span className="rb-budget-search">
              <Search className="rb-budget-search-icon" aria-hidden="true" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search expenses…"
                aria-label="Search expenses"
                className="ui-input rb-budget-search-input"
                data-size="sm"
              />
              {search && (
                <IconButton size="sm" Icon={X} title="Clear search" className="rb-budget-search-clear" onClick={() => setSearch('')} />
              )}
            </span>
            <span className="rb-budget-count">{processed.length}/{expenses.length}</span>
          </>
        )}
      >
        <Button size="sm" variant="primary" Icon={Plus} onClick={handleCreate}>
          New expense
        </Button>

        <IconButton size="sm" Icon={Undo2} title="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo} />
        <IconButton size="sm" Icon={Redo2} title="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo} />

        <span className="rb-budget-divider" aria-hidden="true" />

        <Button
          size="sm"
          Icon={Filter}
          className="rb-budget-tool"
          data-active={filters.length > 0 ? 'true' : 'false'}
          aria-expanded={showFilterPanel}
          onClick={() => setShowFilterPanel(!showFilterPanel)}
        >
          Filter{filters.length > 0 ? ` (${filters.length})` : ''}
        </Button>

        <span className="rb-budget-tool-group">
          <ArrowUpDown className="rb-budget-tool-icon" aria-hidden="true" />
          <select
            value={sortField}
            onChange={e => setSortField(e.target.value)}
            aria-label="Sort"
            className="ui-input rb-budget-tool"
            data-size="sm"
          >
            <option value="">No sort</option>
            {EXPENSE_SORTABLE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          {/* Its words and its name are "A→Z" / "Z→A", as they were. The
              arrow is drawn as the kit's icon: Geist's Latin subset has no
              U+2192, so the glyph came from Segoe UI (the walk's V1-01). */}
          {sortField && (
            <Button
              size="sm"
              aria-label={sortDir === 'asc' ? 'A→Z' : 'Z→A'}
              onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            >
              <span className="rb-budget-sort-dir">
                {sortDir === 'asc' ? 'A' : 'Z'}
                <ArrowRight className="rb-budget-sort-dir-icon" aria-hidden="true" />
                {sortDir === 'asc' ? 'Z' : 'A'}
              </span>
            </Button>
          )}
        </span>

        <span className="rb-budget-divider" aria-hidden="true" />

        <span className="rb-budget-tool-group">
          <Layers className="rb-budget-tool-icon" aria-hidden="true" />
          <select
            value={groupBy}
            onChange={e => setGroupBy(e.target.value)}
            aria-label="Group"
            className="ui-input rb-budget-tool"
            data-size="sm"
          >
            {EXPENSE_GROUPABLE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </span>

        <span className="rb-budget-divider" aria-hidden="true" />

        <ExpenseSavedViewsDropdown views={savedViews} onLoad={loadView} onDelete={deleteSavedView} onSave={() => setShowSaveDialog(true)} />

        <span className="rb-budget-divider" aria-hidden="true" />

        <Button size="sm" Icon={RotateCcw} onClick={() => setConfirmResetMc(true)}>
          Reset M/C
        </Button>
      </Toolbar>

      {/* Filter panel */}
      {showFilterPanel && (
        <ExpenseFilterPanel
          filters={filters}
          phases={phases} assets={assets} tasks={tasks}
          onAdd={addFilter} onUpdate={updateFilter} onRemove={removeFilter}
          onClose={() => setShowFilterPanel(false)}
        />
      )}

      <div className="rb-budget-exp-table">
        {/* The bulk-action bar overlays the header, right of the checkbox
            column, where it always did. The kit has no bulk bar (B2's is
            its own too): this is the lane's, on the kit's Button. */}
        {expSomeSelected && (
          <div className="rb-budget-bulk">
            <span className="rb-budget-bulk-count">{expSelected.size} selected</span>
            <span className="rb-budget-divider" aria-hidden="true" />
            <Button size="sm" variant="danger" Icon={Trash2} onClick={() => setConfirmBulkDelete(true)}>
              Delete
            </Button>
            <IconButton size="sm" Icon={X} title="Clear the selection" onClick={expClearSelection} />
          </div>
        )}

        <Table
          className="rb-budget-exp"
          head={(
            <Row>
              <Th width="var(--rb-budget-exp-col-check)" className="rb-budget-exp-check-cell">
                <button
                  type="button"
                  onClick={() => expToggleAll(processed.map(e => e.id))}
                  className="rb-budget-check"
                  data-checked={allSelected ? 'all' : expSomeSelected ? 'some' : 'none'}
                  aria-label={allSelected ? 'Clear the selection' : 'Select every expense'}
                  title={allSelected ? 'Clear the selection' : 'Select every expense'}
                >
                  {allSelected
                    ? <CheckSquare aria-hidden="true" />
                    : expSomeSelected
                      ? <MinusSquare aria-hidden="true" />
                      : <Square aria-hidden="true" />}
                </button>
              </Th>
              <Th>Title</Th>
              <Th width="var(--rb-budget-exp-col-money)" numeric sort={sortField === 'estimated_cost' ? sortDir : null} onSort={() => sortBy('estimated_cost')}>Estimated</Th>
              <Th width="var(--rb-budget-exp-col-money)" numeric>Margin</Th>
              <Th width="var(--rb-budget-exp-col-money)" numeric>Conting.</Th>
              <Th width="var(--rb-budget-exp-col-money)" numeric sort={sortField === 'actual_cost' ? sortDir : null} onSort={() => sortBy('actual_cost')}>Actual</Th>
              <Th width="var(--rb-budget-exp-col-money)" numeric sort={sortField === 'variance' ? sortDir : null} onSort={() => sortBy('variance')}>Variance</Th>
              <Th width="var(--rb-budget-exp-col-date)" sort={sortField === 'purchase_date' ? sortDir : null} onSort={() => sortBy('purchase_date')}>Date</Th>
              <Th width="var(--rb-budget-exp-col-related)">Related</Th>
              <Th width="var(--rb-budget-exp-col-files)" numeric>Files</Th>
              <Th width="var(--rb-budget-exp-col-acts)" align="right"><span className="sr-only">Actions</span></Th>
            </Row>
          )}
        >
          {body}
        </Table>
      </div>

      {/* Nothing to list: the kit EmptyState in sentence case (R3-19), under
          the header as the empty line always was. */}
      {processed.length === 0 && (
        search || filters.length
          ? <Empty compact title="No matching expenses" />
          : <Empty compact title="No expenses yet" body={'Click "New expense" to add one.'} />
      )}

      {/* A row's Delete: the confirm it always asked, on the kit Dialog. Its
          backdrop still closes it, as it always did. Every dialog here is
          portalled into <body> (W9), so no container the shell gives this
          tab can hold it. */}
      {deleteConfirmId && createPortal(
        <Dialog
          width="confirm"
          title="Delete expense"
          dismissOnBackdrop
          onClose={() => setDeleteConfirmId(null)}
          footer={(
            <>
              <Button autoFocus onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => handleDelete(deleteConfirmId)}>Delete</Button>
            </>
          )}
        >
          This will permanently remove this expense. You can undo with Ctrl+Z.
        </Dialog>,
        document.body,
      )}

      {/* W9: the bulk Delete's window.confirm, word for word. */}
      {confirmBulkDelete && createPortal(
        <Dialog
          width="confirm"
          title="Delete expenses"
          onClose={() => setConfirmBulkDelete(false)}
          footer={(
            <>
              <Button autoFocus onClick={() => setConfirmBulkDelete(false)}>Cancel</Button>
              <Button variant="danger" onClick={() => { setConfirmBulkDelete(false); expBulkDelete() }}>Delete</Button>
            </>
          )}
        >
          {`Delete ${expSelected.size} expense${expSelected.size === 1 ? '' : 's'}?`}
        </Dialog>,
        document.body,
      )}

      {/* W9: Reset M/C's window.confirm, word for word. */}
      {confirmResetMc && createPortal(
        <Dialog
          width="confirm"
          title="Reset margin & contingency"
          onClose={() => setConfirmResetMc(false)}
          footer={(
            <>
              <Button autoFocus onClick={() => setConfirmResetMc(false)}>Cancel</Button>
              <Button variant="danger" onClick={() => { setConfirmResetMc(false); resetAllMarginCont() }}>Reset</Button>
            </>
          )}
        >
          Reset all margin & contingency values to the project defaults? This cannot be undone.
        </Dialog>,
        document.body,
      )}

      {/* Save view: the kit Dialog, as the Tasks toolbar's (B2). */}
      {showSaveDialog && createPortal(
        <Dialog
          width="confirm"
          title="Save current view"
          dismissOnBackdrop
          onClose={() => setShowSaveDialog(false)}
          footer={(
            <>
              <Button onClick={() => setShowSaveDialog(false)}>Cancel</Button>
              <Button variant="primary" onClick={saveCurrentView}>Save</Button>
            </>
          )}
        >
          <input
            autoFocus
            type="text"
            value={saveName}
            onChange={e => setSaveName(e.target.value)}
            placeholder="View name…"
            aria-label="View name"
            onKeyDown={e => { if (e.key === 'Enter') saveCurrentView() }}
            className="ui-input"
          />
        </Dialog>,
        document.body,
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

      {/* ── Margin/Contingency popover: the lane's one (R3-32) ── */}
      {mcPopover && (() => {
        const exp = expenses.find(e => e.id === mcPopover.expId)
        if (!exp) return null
        const est = Number(exp.estimated_cost) || 0
        const mPct = exp.margin_pct != null ? Number(exp.margin_pct) : defaultMarginPct
        const cPct = exp.contingency_pct != null ? Number(exp.contingency_pct) : defaultContPct
        return (
          <MarginContPopover
            anchor={mcPopover}
            amountLabel="Estimated cost"
            baseAmount={est}
            marginPct={mPct}
            contPct={cPct}
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


// ─── Expense filter panel ──────────────────────────────────
// B2's filter strip, in this tab's gutter: a hairline box under the toolbar,
// the kit's 28px fields and buttons, "Where" / "And" at the Label step.
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
    <div className="rb-budget-filters">
      {filters.map((f, i) => {
        const type = getType(f)
        const ops = EXPENSE_FILTER_OPS[type] || EXPENSE_FILTER_OPS.text
        const needsValue = !['is_empty', 'is_not_empty'].includes(f.op)
        return (
          <div key={i} className="rb-budget-filter-row">
            <span className="rb-budget-eyebrow rb-budget-filter-where">{i === 0 ? 'Where' : 'And'}</span>
            <select
              value={f.field}
              onChange={e => onUpdate(i, { field: e.target.value, value: '' })}
              aria-label="Field"
              className="ui-input rb-budget-filter-field"
              data-size="sm"
            >
              {EXPENSE_FILTER_FIELDS.map(ff => <option key={ff.value} value={ff.value}>{ff.label}</option>)}
            </select>
            <select
              value={f.op}
              onChange={e => onUpdate(i, { op: e.target.value })}
              aria-label="Condition"
              className="ui-input rb-budget-filter-op"
              data-size="sm"
            >
              {ops.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {needsValue && (
              type === 'select' ? (
                <select
                  value={f.value}
                  onChange={e => onUpdate(i, { value: e.target.value })}
                  aria-label="Value"
                  className="ui-input rb-budget-tool"
                  data-size="sm"
                >
                  <option value="">— select —</option>
                  {getOptions(f).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input
                  type="text"
                  value={f.value || ''}
                  onChange={e => onUpdate(i, { value: e.target.value })}
                  placeholder="value…"
                  aria-label="Value"
                  className="ui-input rb-budget-filter-text"
                  data-size="sm"
                />
              )
            )}
            <IconButton size="sm" Icon={X} danger title="Remove this filter" onClick={() => onRemove(i)} />
          </div>
        )
      })}
      <div className="rb-budget-filter-actions">
        <Button size="sm" Icon={Plus} onClick={onAdd}>Add filter</Button>
        {filters.length > 0 && (
          <Button size="sm" variant="ghost" onClick={onClose}>Done</Button>
        )}
      </div>
    </div>
  )
}


// ─── Expense saved views dropdown ──────────────────────────
// Restyled in place on the kit's float tokens, as the Tasks toolbar's is
// (B2). The kit Menu cannot carry it unchanged: a Menu item has no trailing
// action (load a view AND delete it from one row — B2's kit request K2), it
// opens at a point rather than under its button, and it would add an
// Escape and a capture-phase outside press this one never had.
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
      <Button size="sm" Icon={BookmarkPlus} aria-expanded={open} onClick={() => setOpen(!open)}>
        Views
      </Button>
      {open && (
        <div className="rb-budget-menu">
          {views.length === 0 && <div className="rb-budget-menu-empty">No saved views</div>}
          {views.map(v => (
            <div
              key={v.id}
              className="rb-budget-menu-item"
              onClick={() => { onLoad(v); setOpen(false) }}
            >
              <span className="rb-budget-menu-label">{v.name}</span>
              <IconButton
                size="sm"
                Icon={X}
                danger
                title={`Delete the saved view "${v.name}"`}
                onClick={e => { e.stopPropagation(); onDelete(v.id) }}
              />
            </div>
          ))}
          <div className="rb-budget-menu-foot">
            <button type="button" onClick={() => { onSave(); setOpen(false) }} className="rb-budget-menu-item">
              <Save className="rb-budget-menu-icon" aria-hidden="true" />
              <span className="rb-budget-menu-label">Save current view</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}


// ─── Expense create / edit popup ───────────────────────────
// The kit Dialog at the form width (560: the nearest token, and it holds
// every field — the two cost fields are 190px each beside the variance).
// Every field, its order and its save are as they were; the relation
// pickers are restyled in place. Q17: Escape closes it now, and focus stays
// inside it; its backdrop still closes it, as it always did. Portalled into
// <body> (W9).
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

  return createPortal(
    <Dialog
      width="form"
      title={isEdit ? 'Edit expense' : 'New expense'}
      dismissOnBackdrop
      onClose={onClose}
      footer={(
        <>
          <span className="rb-budget-hint rb-budget-exp-note">
            {isEdit ? 'Changes are saved when you press Save.' : 'Nothing is saved until you press Create.'}
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!title.trim() || busy}>
            {busy ? 'Saving...' : isEdit ? 'Save' : 'Create'}
          </Button>
        </>
      )}
    >
      <div className="rb-budget-exp-form">
        <Field label="Title *">
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Software license, equipment rental"
            aria-label="Title"
            className="ui-input"
            autoFocus
          />
        </Field>

        {/* Costs row: Estimated + Actual + the variance they make */}
        <div className="rb-budget-exp-costs">
          <Field label={`Estimated cost (${currency})`}>
            <input
              type="number" step="0.01" min="0"
              value={estimatedCost}
              onChange={e => setEstimatedCost(e.target.value)}
              placeholder="0.00"
              aria-label="Estimated cost"
              className="ui-input"
            />
          </Field>
          <Field label={`Actual cost (${currency})`}>
            <input
              type="number" step="0.01" min="0"
              value={actualCost}
              onChange={e => setActualCost(e.target.value)}
              placeholder="0.00"
              aria-label="Actual cost"
              className="ui-input"
            />
          </Field>
          <Field label="Variance">
            <span className="rb-budget-exp-variance">
              {est > 0 ? (
                <span className="rb-budget-var" data-tone={variance > 0 ? 'danger' : variance < 0 ? 'success' : undefined}>
                  <CurrencyDisplay value={variance} currency={currency} signed />
                </span>
              ) : <span className="rb-budget-dash" data-empty="true">{'—'}</span>}
            </span>
          </Field>
        </div>

        <Field label="Purchase date">
          <input
            type="date"
            value={purchaseDate}
            onChange={e => setPurchaseDate(e.target.value)}
            aria-label="Purchase date"
            className="ui-input rb-budget-exp-date"
          />
        </Field>

        <Field label="Description / reason">
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Why was this expense incurred?"
            rows={3}
            aria-label="Description / reason"
            className="ui-input rb-budget-exp-desc-input"
          />
        </Field>

        <Field label="Related items">
          <div className="rb-budget-exp-pickers">
            <RelationPicker label="Assets" icon={<Boxes className="rb-budget-rel-icon" aria-hidden="true" />} items={assets} selectedIds={assetIds} onChange={setAssetIds} nameKey="name" />
            <RelationPicker label="Phases" icon={<Layers className="rb-budget-rel-icon" aria-hidden="true" />} items={phases} selectedIds={phaseIds} onChange={setPhaseIds} nameKey="name" />
            <RelationPicker label="Tasks" icon={<FileText className="rb-budget-rel-icon" aria-hidden="true" />} items={tasks} selectedIds={taskIds} onChange={setTaskIds} nameKey="name" />
          </div>
        </Field>

        <Field label="Invoices / receipts">
          <div className="rb-budget-exp-uploads">
            {allFiles.length > 0 && (
              <div className="rb-budget-exp-file-list">
                {allFiles.map(f => (
                  <div key={f.id} className="rb-budget-exp-file">
                    <Paperclip className="rb-budget-exp-file-icon" aria-hidden="true" />
                    <span className="rb-budget-exp-file-name">{f.name}</span>
                    <IconButton size="sm" Icon={X} danger title={`Remove ${f.name}`} onClick={() => removeFile(f.id)} />
                  </div>
                ))}
              </div>
            )}
            <Button
              size="sm"
              Icon={Upload}
              loading={uploading}
              loadingLabel="Uploading..."
              onClick={() => fileInputRef.current?.click()}
            >
              Upload files
            </Button>
            {uploadError && (
              <p className="rb-budget-exp-error">{uploadError}</p>
            )}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={e => { setUploadError(null); handleFileUpload(e) }}
            />
          </div>
        </Field>
      </div>
    </Dialog>,
    document.body,
  )
}


// ─── Relation picker (multi-select dropdown) ───────────────
// Restyled in place: its button is the kit's 28px field, its count the kit
// Badge (it was white on the signal fill, C6), its list on the kit's float
// tokens. It opens, searches, ticks and closes exactly as before.
// The expense popup is the kit Dialog now, and its relation pickers' open
// lists are not on the kit's modal stack: an Escape pressed inside one closed
// the whole popup, draft and all — before the kit, Escape did nothing there.
// The kit Dialog skips an Escape already marked handled, so the list marks the
// ones pressed in its own DOM and does nothing else (C1), as RelationsPanel's
// in-panel layers do (B4c).
function markOwnEscape(e) {
  if (e.key === 'Escape' && e.currentTarget.contains(e.target)) e.preventDefault()
}

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
    <div ref={ref} className="rb-budget-rel">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="ui-input rb-budget-rel-toggle"
        data-size="sm"
      >
        {icon}<span className="rb-budget-rel-label">{label}</span>
        {selectedIds.length > 0 && <Badge className="rb-budget-rel-count">{selectedIds.length}</Badge>}
      </button>
      {open && (
        <div className="rb-budget-rel-menu" onKeyDown={markOwnEscape}>
          {items.length > 5 && (
            <div className="rb-budget-rel-search">
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={`Search ${label.toLowerCase()}...`}
                aria-label={`Search ${label.toLowerCase()}`}
                className="ui-input"
                data-size="sm"
                autoFocus
              />
            </div>
          )}
          <div className="rb-budget-rel-options">
            {filtered.length === 0 ? <div className="rb-budget-rel-empty">No items</div> : (
              filtered.map(it => {
                const checked = selectedIds.includes(it.id)
                return (
                  <label key={it.id} className="rb-budget-rel-option" data-checked={checked ? 'true' : 'false'}>
                    <input type="checkbox" checked={checked} onChange={() => toggle(it.id)} className="rb-budget-rel-check" />
                    <span className="rb-budget-rel-name">{it[nameKey] || 'Unnamed'}</span>
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

// A figure to one decimal place (days, a percentage) in the money's one
// locale, with Intl's sign when `signed` (R3-14: the sign is Intl's, never a
// '+' glued on). No grouping: `toFixed(1)`, which it replaces, had none.
function formatTenths(value, { signed = false } = {}) {
  return new Intl.NumberFormat(MONEY_LOCALE, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    useGrouping: false,
    signDisplay: signed ? 'exceptZero' : 'auto',
  }).format(Number(value) || 0)
}

// A section of a Budget tab: the kit SectionTitle (H2, sentence case, a
// hairline above) over its content, with no box and no fill (R3-30). The
// parent's gap is the only rhythm between sections (rabbitBudget.css).
function Card({ title, children }) {
  return (
    <section className="rb-budget-section">
      {title && <SectionTitle>{title}</SectionTitle>}
      {children}
    </section>
  )
}

// Kept for the Expenses tab's four tiles: a thin wrapper over the kit Stat,
// so every tile on the Budget is the kit's (R3-10). `tone` keeps its words.
function BigTile({ label, value, hint, tone = 'neutral' }) {
  return (
    <Stat
      className="rb-budget-stat"
      label={label}
      value={value}
      delta={hint}
      deltaTone="neutral"
      valueTone={tone === 'good' ? 'success' : tone === 'danger' ? 'danger' : undefined}
    />
  )
}

// The table behind the seven reports and Custom: the kit Table (R3-20). Name
// left; Tasks, Bid, Logged, Variance and Cost numeric, header included
// (R3-03), in the lane's one order (R3-05). A totals row is its `foot`
// (R3-04), so it shares the columns it totals.
function BreakdownTable({ rows, currency, labelHeader, countHeader, foot }) {
  return (
    <Table
      className="rb-budget-report"
      foot={foot}
      head={(
        <Row>
          <Th>{labelHeader}</Th>
          <Th width="var(--rb-budget-col-count)" numeric>{countHeader}</Th>
          <Th width="var(--rb-budget-col-days)" numeric>Bid</Th>
          <Th width="var(--rb-budget-col-days)" numeric>Logged</Th>
          <Th width="var(--rb-budget-col-var)" numeric>Variance</Th>
          <Th width="var(--rb-budget-col-money)" numeric>Cost</Th>
        </Row>
      )}
    >
      {rows.map((row, i) => (
        <Row key={`${row.name}-${i}`}>
          <Td>{row.name}</Td>
          <Td numeric className="rb-budget-quiet">{row.taskCount}</Td>
          <Td numeric className="rb-budget-quiet">{formatTenths(row.bid)}</Td>
          <Td numeric className="rb-budget-quiet">{formatTenths(row.logged)}</Td>
          <VarianceCell value={row.variance} />
          <Td numeric className="rb-budget-quiet">
            <CurrencyDisplay value={row.cost} currency={currency} />
          </Td>
        </Row>
      ))}
    </Table>
  )
}

// A day variance: the good or bad news is the figure's tone, and the arrow
// says which way.
function VarianceCell({ value }) {
  const Icon = value > 0 ? ArrowUp : value < 0 ? ArrowDown : Minus
  return (
    <Td numeric>
      <span className="rb-budget-var" data-tone={value > 0 ? 'danger' : value < 0 ? 'success' : 'zero'}>
        <Icon className="rb-budget-var-icon" aria-hidden="true" />
        {formatTenths(value, { signed: true })}
      </span>
    </Td>
  )
}

// A field: its label at the Label step over a Dense control (R3-06). A
// <div>, not a <label>: the words were never a click target and do not
// become one (C1); each control carries its own name.
function Field({ label, children }) {
  return (
    <div className="rb-budget-field">
      <span className="ui-field-label">{label}</span>
      {children}
    </div>
  )
}

// The native select in the kit's well at the Dense step. The status colours
// it used to paint on itself and its options are gone (R3-11): a status is
// the kit's StatusDot beside it.
function Select({ value, onChange, options, 'aria-label': ariaLabel }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="ui-input"
      data-size="sm"
      aria-label={ariaLabel}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

// The whole view's "not yet" and "nothing" (R3-19). A message about loading
// is the kit Loading, never the empty state — read with the kit's own test
// for a loading string, so the shell's two calls need no change; anything
// else is the kit EmptyState.
function CenterMsg({ children, loading = /\bloading\b/i.test(String(children ?? '')) }) {
  return (
    <div className="rb-budget-center">
      {loading ? <Loading label={children} /> : <EmptyState title={children} />}
    </div>
  )
}

// "Nothing here" (R3-19): the kit EmptyState, `compact` inside a section.
// A call that passes one string passes the title.
function Empty({ children, title = children, body, compact = false }) {
  return <EmptyState compact={compact} title={title} body={body} />
}

function varianceLabel(v) {
  if (v > 0) return 'Over budget'
  if (v < 0) return 'Under budget'
  return 'On target'
}

// A variance's tone in the kit's words (Stat's `valueTone`): over the bid is
// the bad news.
function varianceTone(v) {
  if (v > 0) return 'danger'
  if (v < 0) return 'success'
  return 'neutral'
}

// Surfaces 2a and 2b's mounted tests render these directly; the default
// export is unchanged.
export { SummaryTab, BreakdownTable, CustomTab, ByPhaseTab, CenterMsg, ExpensesTab, ExpensePopup }
