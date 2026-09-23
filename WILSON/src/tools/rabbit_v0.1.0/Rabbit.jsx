// ============================================================
// RABBIT v0.1 — top-level shell
// ============================================================
//
// Layout (v0.6.x — header bar removed):
//
//   ┌────────────────────────────────────────────────────┐
//   │ Intake │ Summary │ Assets │ Timeline │ Budget       │   ← tabs
//   ├────────────────────────────────────────────────────┤
//   │ Project: <name> │ Switch ▾ │ Gallery                 │   ← context bar
//   ├────────────────────────────────────────────────────┤
//   │                                                    │
//   │              <active view body>                    │
//   └────────────────────────────────────────────────────┘
//
// The old title + adapter pill + refresh-index header has been
// removed entirely. Adapter health is a single red or green dot.
// Since B1 (2026-09-23, Q10) it and the realtime presence pill dock in
// ProjectContextBar's two named slots instead of floating over the
// view body's bottom-left corner. Refreshing the projects index is no longer a
// manual user action — the Summary view refreshes on demand.
//
// As of WILSON v0.6.x the header no longer hosts a project
// picker — picking and creating projects happens exclusively
// inside the Summary tab. The context bar below the tabs always
// shows the active project and exposes a Switch dropdown for
// quickly jumping between projects without leaving the current
// view.
//
// activeTool wiring: when this page becomes visible the agent
// system needs to know that RABBIT is the foreground tool. The
// effect uses the `currentPage` prop passed down from App.jsx
// — calling setActiveTool('rabbit') on visibility.

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { ListChecks, Settings as SettingsIcon, HelpCircle } from 'lucide-react'
import { useRabbit } from './state/RabbitProvider'
import { useAgent } from '../../agent'
import { useRosterMembers } from '../../components/TeamMembers/useRosterMembers'
import { usePermissions } from '../../permissions/usePermissions'
import { canSeeProjectMoney } from '../../permissions/projectRoleMatrix'
import { isOwnAvatarUrl } from '../../components/TeamMembers/useWorkspaceMembers'
import ViewTabs, { RABBIT_VIEW_PANEL_ID } from './components/ViewTabs'
import ProjectContextBar from './components/ProjectContextBar'
import IngestionToast from './components/IngestionToast'
import IntakeWizardView from './views/IntakeWizardView'
import ProjectSummaryView from './views/ProjectSummaryView'
import ProjectAssetsView from './views/ProjectAssetsView'
import ProjectTasksView from './views/ProjectTasksView'
import TimelineView, { SettingsPanel, HelpModal, loadRabbitSettings, saveRabbitSettings } from './views/TimelineView'
import TeamView from './views/TeamView'
import BudgetView from './views/BudgetView'
import ScenesView from './views/ScenesView'
import BinsView from './views/BinsView'
import LevelsView from './views/LevelsView'
import ExperiencesView from './views/ExperiencesView'
import { loadHolidays, saveHolidays } from './holidays.js'
import { RABBIT_HELP_SIDEBAR_ITEMS } from './rabbitHelpContent.jsx'
import { subscribeNavigate } from './state/rabbitNavigate'
import { IconButton } from '../../ui/IconButton'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { StatusDot } from '../../ui/StatusDot'
import { StatusBadge } from '../../ui/StatusBadge'
import './rabbitShell.css'

export default function Rabbit({ currentPage, openSettingsTrigger = 0 } = {}) {
  const ctx = useRabbit()
  const agent = useAgent()
  const perms = usePermissions()
  const project = ctx?.project
  const [activeView, setActiveView] = useState('summary')

  // ── Dynamic tab visibility based on project toggle fields ──
  //
  // Session 24: Budget joins this list, but on PERMISSION rather than a
  // project toggle. Audrey: "only managers should see anything relating to
  // money … reviewers and team members should not see financial values
  // anywhere." Migration 0037 already makes that true of the DATA — a
  // non-manager reads zero rows from every money table — but they were still
  // shown the tab and a page of zeroes, with nothing saying why.
  //
  // canSeeProjectMoney mirrors can_access_project_money(uuid) exactly, and
  // fails CLOSED: see its comment for why the tab APPEARS late for a project
  // manager rather than vanishing late for a reviewer.
  const canSeeMoney = canSeeProjectMoney({
    appRole: perms?.role,
    projectRole: ctx?.myProjectRole,
  })

  const hiddenTabs = useMemo(() => {
    const hidden = new Set()
    if (!project?.scenes_enabled) { hidden.add('scenes'); hidden.add('bins') } // bins ride on the scenes toggle (DEMO_BINS_BRIEF §2)
    if (!project?.levels_enabled) hidden.add('levels')
    if (!project?.experiences_enabled) hidden.add('experiences')
    if (!canSeeMoney) hidden.add('budget')
    return hidden
  }, [project?.scenes_enabled, project?.levels_enabled, project?.experiences_enabled, canSeeMoney])

  // A hidden tab must not stay open. Without this, someone already sitting on
  // Budget when their access resolves keeps the view mounted with only the
  // button gone — and the same applies to toggling scenes/levels off while
  // viewing them.
  useEffect(() => {
    if (hiddenTabs.has(activeView)) setActiveView('summary')
  }, [hiddenTabs, activeView])

  // Cross-tab navigation (milestone 2): "open this shot in Scenes" from the
  // bin inspector, "show this file in Bins" from a shot's takes. The shell
  // switches the tab; the target view consumes the payload when it mounts
  // (state/rabbitNavigate.js).
  useEffect(() => subscribeNavigate(d => { if (d?.view) setActiveView(d.view) }), [])

  // ── Settings, help & holidays (shared across all RABBIT tabs) ──
  const [settings, setSettings] = useState(() => loadRabbitSettings())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState('settings')
  const [showHelpModal, setShowHelpModal] = useState(false)
  const [helpPage, setHelpPage] = useState(RABBIT_HELP_SIDEBAR_ITEMS[0]?.id || 'rabbit-overview')
  const [holidays, setHolidays] = useState(() => loadHolidays())

  const patchSettings = useCallback((p) => {
    setSettings(prev => {
      const next = { ...prev, ...p }
      saveRabbitSettings(next)
      return next
    })
  }, [])

  const handleHolidaysChange = useCallback((next) => {
    setHolidays(next)
    saveHolidays(next)
  }, [])

  // When the WILSON nav strip "SETTINGS" item is clicked the parent
  // bumps `openSettingsTrigger`. Now that settings live at the shell
  // level we just open the panel directly — no tab switch needed.
  const prevSettingsTrigger = useRef(openSettingsTrigger)
  useEffect(() => {
    if (openSettingsTrigger !== prevSettingsTrigger.current) {
      prevSettingsTrigger.current = openSettingsTrigger
      setSettingsOpen(true)
    }
  }, [openSettingsTrigger])

  const adapterMode = ctx?.adapterMode
  const adapterStatus = ctx?.adapterStatus
  const activeProjectId = ctx?.activeProjectId

  // Tell the agent system this tool is in the foreground whenever
  // the page is visible. The all-pages-rendered pattern means we
  // can't rely on mount/unmount — we have to gate on currentPage.
  useEffect(() => {
    if (!agent) return
    if (currentPage === 'rabbit') {
      agent.setActiveTool?.('rabbit')
    }
  }, [agent, currentPage])

  // Whenever the active project clears, snap to Summary so the user
  // lands on the gallery / project picker.
  useEffect(() => {
    if (!activeProjectId) {
      setActiveView('summary')
    }
  }, [activeProjectId])

  // When ingestion finishes and the user clicks "Review breakdown"
  // on the toast, jump them straight to the intake wizard so they
  // can hit save.
  function handleJumpToReview() {
    setActiveView('intake')
  }

  // ── The adapter dot and the presence pill (Q10, B1 2026-09-23) ──
  // They used to be absolutely positioned over the view body's bottom-left
  // corner, where they covered content on every view but Bins (V1-08: Tasks'
  // last row, Timeline's task label, Summary's "Project Files"). Q10 moves
  // them into ProjectContextBar's two named slots. Summary draws no context
  // bar — its gallery IS the project picker, and the bar would state the
  // project a fourth time on one scroll (review R23) — so on Summary they
  // dock at the tab bar's right end, beside settings and help. Hidden on no
  // view (C1).
  //
  // The roster the presence avatars need is fetched HERE, once for the life of
  // the shell. The strip is rendered under two different parents (the context
  // bar, or the tab strip on Summary), so React remounts it whenever Summary
  // is crossed — and when it owned this hook, every crossing re-ran the
  // workspace directory RPC and the team fetch, and the avatars flashed back
  // to initials while they loaded (R1 finding 4). Before B1 the strip mounted
  // once; this keeps that cost.
  const { members: rosterMembers } = useRosterMembers()
  const avatarByUserId = useMemo(() => {
    const out = {}
    for (const m of rosterMembers || []) {
      if (m.avatar_url) out[m.id] = m.avatar_url
    }
    return out
  }, [rosterMembers])
  const adapterDot = <AdapterStatusDot mode={adapterMode} status={adapterStatus} />
  const presence = <RealtimePresenceStrip realtimeStatus={ctx?.realtimeStatus} users={ctx?.presentUsers} avatarByUserId={avatarByUserId} />
  const statusInTabBar = activeView === 'summary'

  return (
    <div className="rb-shell relative h-full w-full flex flex-col">
      {/* ── View tabs ── */}
      <ViewTabs
        activeView={activeView}
        onChange={setActiveView}
        disabled={!activeProjectId && activeView !== 'summary'}
        hiddenTabs={hiddenTabs}
        rightSlot={(
          <>
            {statusInTabBar && (
              <span className="rb-ctx-status-group rb-tabbar-status" data-slot="status">
                <span className="contents" data-slot="presence">{presence}</span>
                <span className="contents" data-slot="adapter">{adapterDot}</span>
              </span>
            )}
            <IconButton size="sm" Icon={SettingsIcon} title="RABBIT settings" onClick={() => setSettingsOpen(true)} />
            <IconButton size="sm" Icon={HelpCircle} title="Help & Documentation" onClick={() => setShowHelpModal(true)} />
          </>
        )}
      />

      {/* ── Project context bar ── */}
      {activeView !== 'summary' && (
        <ProjectContextBar adapterSlot={adapterDot} presenceSlot={presence} />
      )}

      {/* ── View body ── */}
      <div className="flex-1 overflow-hidden relative" role="tabpanel" id={RABBIT_VIEW_PANEL_ID}>
        {!activeProjectId && activeView !== 'summary' ? (
          <NoProjectPlaceholder onPickSummary={() => setActiveView('summary')} />
        ) : (
          <div className="h-full">
            {activeView === 'intake'   && <IntakeWizardView   />}
            {activeView === 'summary'  && <ProjectSummaryView />}
            {activeView === 'assets'   && <ProjectAssetsView  />}
            {activeView === 'team'     && <TeamView           />}
            {activeView === 'tasks'    && <ProjectTasksView   />}
            {activeView === 'scenes'      && <ScenesView />}
            {activeView === 'bins'        && <BinsView />}
            {activeView === 'levels'      && <LevelsView />}
            {activeView === 'experiences' && <ExperiencesView />}
            {activeView === 'timeline' && <TimelineView settings={settings} patchSettings={patchSettings} holidays={holidays} />}
            {activeView === 'budget'   && <BudgetView         />}
          </div>
        )}
      </div>

      {/* ── Settings slide-out (shared across all tabs) ── */}
      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          patchSettings={patchSettings}
          settingsTab={settingsTab}
          setSettingsTab={setSettingsTab}
          holidays={holidays}
          onHolidaysChange={handleHolidaysChange}
          onClose={() => setSettingsOpen(false)}
          onOpenHelp={() => {
            setSettingsOpen(false)
            setShowHelpModal(true)
          }}
        />
      )}

      {/* ── Help & Documentation modal ── */}
      {showHelpModal && (
        <HelpModal
          helpPage={helpPage}
          setHelpPage={setHelpPage}
          onClose={() => setShowHelpModal(false)}
        />
      )}

      {/* ── Background ingestion toast ── */}
      <IngestionToast onJumpToReview={handleJumpToReview} />

      {/* NOTE: the undo toast (soft-delete forgiveness window) is
          mounted once at the App.jsx level, inside <RabbitProvider>,
          so it stays visible when deletes fire from pages that keep
          this shell display:none (e.g. ProjectsPage). */}
    </div>
  )
}

// ─── Adapter status dot ───
// A coloured circle: red when offline, green when online, dim grey while
// the adapter isn't configured. Hovering reveals the adapter mode and
// status. Docked in a slot since B1 (Q10); it no longer positions itself.
// Since B1's restyle it is the kit's StatusDot: one 8px dot from the
// status tones, no glow (§3.3 deletes the status-dot glow). The adapter's
// "offline" is a fault, so it takes the danger tone explicitly — the kit's
// own `offline` key is presence semantics (a person away), which is neutral.
const ADAPTER_TONE = { unconfigured: 'neutral', online: 'success', offline: 'danger' }

function AdapterStatusDot({ mode, status }) {
  const configured = !!mode
  const online = !!status?.online
  const state = !configured ? 'unconfigured' : (online ? 'online' : 'offline')
  const label = configured
    ? `${(mode || '').replace('_', ' ')} — ${online ? 'online' : 'offline'}`
    : 'adapter not configured'
  return <StatusDot tone={ADAPTER_TONE[state]} label={label} data-state={state} />
}

// ─── Realtime presence strip ───
// Docked beside the adapter dot: a LIVE/SYNC pill plus up to five
// initial chips for who else has this project open (Session 7
// presence, cloud mode only — hidden when realtime is off).
function RealtimePresenceStrip({ realtimeStatus, users, avatarByUserId = {} }) {
  // Session 8: presence meta only carries { user_id, label } — the roster is
  // joined in so chips can show real avatars where members uploaded one. The
  // shell fetches the roster and passes the map in (see Rabbit's comment).
  if (!realtimeStatus || realtimeStatus === 'off') return null
  // The pill is the kit's StatusBadge, which sets its word at the Label
  // step (uppercase, tracked) itself — so the words here are sentence case.
  const pill = {
    live:       { label: 'Live',       tone: 'success' },
    connecting: { label: 'Sync',       tone: 'neutral' },
    error:      { label: 'Sync error', tone: 'danger'  },
  }[realtimeStatus] || { label: realtimeStatus, tone: 'neutral' }
  const list = Array.isArray(users) ? users : []
  const shown = list.slice(0, 5)
  const overflow = list.length - shown.length
  const initials = (label) => (label || '?')
    .split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
  return (
    <div className="rb-presence flex-shrink-0">
      <StatusBadge
        tone={pill.tone}
        label={pill.label}
        data-status={realtimeStatus}
        title={realtimeStatus === 'live'
          ? 'Live sync connected — edits from teammates appear instantly'
          : realtimeStatus === 'error'
            ? 'Live sync error — changes still save; the view refreshes on reconnect'
            : 'Connecting live sync…'}
      />
      {shown.map(u => {
        const avatar = avatarByUserId[u.user_id]
        return isOwnAvatarUrl(avatar) ? (
          <img
            key={u.user_id || u.label}
            src={avatar}
            alt=""
            title={u.label || 'Member'}
            className="rb-presence-avatar object-cover"
          />
        ) : (
          <span
            key={u.user_id || u.label}
            title={u.label || 'Member'}
            className="rb-presence-avatar text-label uppercase"
          >
            {initials(u.label)}
          </span>
        )
      })}
      {overflow > 0 && (
        <span className="rb-presence-more text-caption">
          +{overflow}
        </span>
      )}
    </div>
  )
}

// ─── No-project placeholder ───
function NoProjectPlaceholder({ onPickSummary }) {
  return (
    <div className="h-full flex items-center justify-center">
      <EmptyState
        Icon={ListChecks}
        title="No project selected"
        body="Open the Summary tab to pick an existing project or scaffold a new one."
      >
        <Button variant="primary" onClick={onPickSummary}>Go to Summary</Button>
      </EmptyState>
    </div>
  )
}
