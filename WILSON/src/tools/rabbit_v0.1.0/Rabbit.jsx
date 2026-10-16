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
// removed entirely. Since FX11 (2026-10-16) the connection is ONE dot
// in the bottom-left corner of every tab, just above the orange bar
// (components/ConnectionDot.jsx: the database AND where the files are
// kept); the project bar keeps the project's name and status on the
// left and the faces of who else has it open, then Switch, on the
// right. Refreshing the projects index is no longer a manual user
// action — the Summary view refreshes on demand.
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

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { ListChecks, Settings as SettingsIcon, HelpCircle } from 'lucide-react'
import { useRabbit } from './state/RabbitProvider'
import { useAgent } from '../../agent'
import { useRosterMembers } from '../../components/TeamMembers/useRosterMembers'
import { usePermissions } from '../../permissions/usePermissions'
import { canSeeMoneyHere } from '../../permissions/projectRoleMatrix'
import { isOwnAvatarUrl } from '../../components/TeamMembers/useWorkspaceMembers'
import ViewTabs, { RABBIT_VIEW_PANEL_ID } from './components/ViewTabs'
import ProjectContextBar from './components/ProjectContextBar'
import ConnectionDot from './components/ConnectionDot'
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
// Post-overhaul S4a (E8): one explorer, two hosts — this is the second.
import ProjectFilesExplorer from '../../components/Resources/ProjectFilesExplorer'
import { loadHolidays, saveHolidays } from './holidays.js'
import { RABBIT_HELP_SIDEBAR_ITEMS } from './rabbitHelpContent.jsx'
import { subscribeNavigate, dropPendingNavigate } from './state/rabbitNavigate'
import { leaveTab } from './state/leaveGuard'
import { IconButton } from '../../ui/IconButton'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import './rabbitShell.css'

export default function Rabbit({ currentPage } = {}) {
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
  //
  // Post-overhaul S5c, step 7 (Audrey's F4: "open it. im just using this for
  // testing. its only me on this pc"): on the desktop's Local Server, which
  // has no roles, the money gate is open (canSeeMoneyHere); everywhere else
  // it is canSeeProjectMoney, unchanged.
  const canSeeMoney = canSeeMoneyHere({
    adapterMode: ctx?.adapterMode,
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

  // Post-overhaul S3c, step 7 (D12): leaving the Scenes tab — by the tab
  // strip, a jump out of it ("Show in Bins"), or a toast's shortcut — asks
  // first while an edit there is unsaved, or a popup's typed text would go
  // (state/leaveGuard.js; S3b-05, S3b-08). Keep editing stays, and a jump
  // that was asked for is dropped, not left pending for later. A jump INTO
  // Scenes leaves nothing: it opens its row over whatever is on screen. The
  // AUTOMATIC switches below (a tab hidden, the project cleared) never ask.
  const activeViewRef = useRef(activeView)
  activeViewRef.current = activeView
  const goToView = useCallback(async (view) => {
    if (!(await leaveTab(activeViewRef.current, view))) return false
    setActiveView(view)
    return true
  }, [])

  // Cross-tab navigation (milestone 2): "open this shot in Scenes" from the
  // bin inspector, "show this file in Bins" from a shot's takes. The shell
  // switches the tab; the target view consumes the payload when it mounts
  // (state/rabbitNavigate.js).
  useEffect(() => subscribeNavigate(d => {
    if (!d?.view) return
    goToView(d.view).then((went) => { if (!went) dropPendingNavigate(d) })
  }), [goToView])

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

  // Settings open from the gear at the right end of the tab strip (below).
  // The WILSON nav strip's "Tool settings" item, and the counter it bumped
  // to open them from the shell, are gone (post-overhaul S2a, Audrey's C6).

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
    goToView('intake')
  }

  // ── The faces, and the connection dot (FX11, 2026-10-16) ──
  // Audrey: "the project bar has three green dots and its confusing. remove
  // the live and additional green dot. just leave the icons that appear for
  // users" — and the project bar keeps "the project status there on that bar
  // next to project name. leave to the right the switch dropdown". So the
  // bar's right holds the faces of who else has the project open, then
  // Switch; the LIVE / Sync pill and the adapter dot are gone from it, and
  // from Summary's tab bar, where the faces alone dock (Summary draws no
  // context bar — its gallery IS the project picker, review R23).
  //
  // The connection is ONE dot, drawn here once for every tab, in the shell's
  // bottom-left corner just above the orange bar ("move the live dot to the
  // bottom left corner of the window right above the orange bar"). It sits in
  // the 24px gutter square, where no tab draws text (measured at 1280 and
  // 1440, FX11 hand-off §2); the Bins rail's counter, which did, moved up.
  // B1 took the old corner overlays out because they covered content (V1-08:
  // a pill and five faces). The dot's cell covers no text, but it does sit
  // over the left of whatever row is at the very bottom: x 18–24 of a row's
  // select button, a Timeline phase's chevron, the gantt scrollbar's first
  // 24px (review round 1, R1-6) — scrolled up, the row is whole again.
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
  const presence = <RealtimePresenceStrip realtimeStatus={ctx?.realtimeStatus} users={ctx?.presentUsers} avatarByUserId={avatarByUserId} />
  // On Summary the faces share the tab strip's one row with eleven tabs (twelve
  // since S4a's Files), so the strip shows three faces and "+N" for the rest (R2 finding 3: five
  // faces at 1024 pushed the last tab out of view). The bar shows five.
  const presenceCompact = <RealtimePresenceStrip realtimeStatus={ctx?.realtimeStatus} users={ctx?.presentUsers} avatarByUserId={avatarByUserId} max={3} />
  const statusInTabBar = activeView === 'summary'

  return (
    <div className="rb-shell relative h-full w-full flex flex-col">
      {/* ── View tabs ── */}
      <ViewTabs
        activeView={activeView}
        onChange={goToView}
        disabled={!activeProjectId && activeView !== 'summary'}
        hiddenTabs={hiddenTabs}
        rightSlot={(
          <>
            {statusInTabBar && (
              <span className="rb-tabbar-status" data-slot="presence">{presenceCompact}</span>
            )}
            {/* Help, then Settings at the far right: one order, one title
                pattern and one place in all three tools (post-overhaul S2a,
                Audrey's C1/C7, 2026-09-29: "settings at the right end"). */}
            <IconButton size="sm" Icon={HelpCircle} title="Help & documentation" onClick={() => setShowHelpModal(true)} />
            <IconButton size="sm" Icon={SettingsIcon} title="R.A.B.B.I.T. settings" onClick={() => setSettingsOpen(true)} />
          </>
        )}
      />

      {/* ── Project context bar ── */}
      {activeView !== 'summary' && (
        <ProjectContextBar presenceSlot={presence} />
      )}

      {/* ── View body ── */}
      <div className="flex-1 overflow-hidden relative" role="tabpanel" id={RABBIT_VIEW_PANEL_ID}>
        {!activeProjectId && activeView !== 'summary' ? (
          <NoProjectPlaceholder onPickSummary={() => setActiveView('summary')} />
        ) : (
          <div className="h-full">
            {activeView === 'intake'   && <IntakeWizardView   />}
            {activeView === 'summary'  && <ProjectSummaryView />}
            {/* pageActive (post-overhaul S4c): the Files tab's Backspace and
                arrows stand down while R.A.B.B.I.T. is not the page on
                screen, as the Bins and Scenes keys do. */}
            {activeView === 'files'    && <ProjectFilesExplorer projectId={activeProjectId} showPicker={false} pageActive={currentPage === 'rabbit'} />}
            {activeView === 'assets'   && <ProjectAssetsView  />}
            {activeView === 'team'     && <TeamView           />}
            {activeView === 'tasks'    && <ProjectTasksView   />}
            {/* pageActive (post-overhaul S3b, S4a-07): Scenes' Ctrl+Z / Ctrl+Y
                act only while R.A.B.B.I.T. is on screen, and its "Recently
                removed" mark ends when the person leaves it. */}
            {activeView === 'scenes'      && <ScenesView pageActive={currentPage === 'rabbit'} />}
            {/* BC2 (B11): the roster read once above names who added a clip. */}
            {activeView === 'bins'        && <BinsView pageActive={currentPage === 'rabbit'} people={rosterMembers} />}
            {activeView === 'levels'      && <LevelsView />}
            {activeView === 'experiences' && <ExperiencesView />}
            {/* pageActive (post-overhaul S3c, S4a-07): the Timeline's and the
                Budget's Ctrl+Z / Ctrl+Y act only while R.A.B.B.I.T. is on
                screen, as Scenes' and Bins' do. canSeeMoney (post-overhaul
                S5d, F10): the Timeline's bid version bar exists only past the
                money gate — the one predicate the Budget tab is hidden by. */}
            {activeView === 'timeline' && <TimelineView settings={settings} patchSettings={patchSettings} holidays={holidays} pageActive={currentPage === 'rabbit'} canSeeMoney={canSeeMoney} />}
            {activeView === 'budget'   && <BudgetView pageActive={currentPage === 'rabbit'} />}
          </div>
        )}
      </div>

      {/* ── The connection dot (FX11): once, every tab, the bottom-left
          corner just above the orange bar. It asks only while R.A.B.B.I.T.
          is the page on screen. ── */}
      <ConnectionDot active={currentPage === 'rabbit'} />

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

// ─── Realtime presence: the faces ───
// Up to five faces (three on Summary's tab bar) of who else has this project
// open (Session 7 presence, cloud mode only — nothing while realtime is off
// or nobody else is here). The LIVE / Sync pill that stood before them went
// in FX11: whether live updates are on is one of the connection dot's words
// now ("Live updates: on"), not a third green mark on the bar. With the pill
// gone, the faces show only while the channel is LIVE (review round 1,
// R1-11): on a channel error the last list stays in state, and faces with no
// pill beside them would say people are here when nothing is listening.
function RealtimePresenceStrip({ realtimeStatus, users, avatarByUserId = {}, max = 5 }) {
  // Session 8: presence meta only carries { user_id, label } — the roster is
  // joined in so chips can show real avatars where members uploaded one. The
  // shell fetches the roster and passes the map in (see Rabbit's comment).
  if (realtimeStatus !== 'live') return null
  const list = Array.isArray(users) ? users : []
  if (list.length === 0) return null
  const shown = list.slice(0, max)
  const overflow = list.length - shown.length
  const initials = (label) => (label || '?')
    .split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
  // The faces' names in words (FX11): each face is a picture or two initials
  // with the name only in its hover title, so the group carries the names.
  const names = list.map(u => u.label || 'Member').join(', ')
  return (
    <div className="rb-presence flex-shrink-0" role="group" aria-label={`Also on this project: ${names}`}>
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
