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
//   │  ●                                                 │   ← server status dot (bottom-left)
//   └────────────────────────────────────────────────────┘
//
// The old title + adapter pill + refresh-index header has been
// removed entirely. Adapter health now lives as a single red or
// green dot in the bottom-left corner of the frame, just above
// the scroll bar. Refreshing the projects index is no longer a
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
import ViewTabs from './components/ViewTabs'
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
import LevelsView from './views/LevelsView'
import ExperiencesView from './views/ExperiencesView'
import { loadHolidays, saveHolidays } from './holidays.js'
import { RABBIT_HELP_SIDEBAR_ITEMS } from './rabbitHelpContent.jsx'

export default function Rabbit({ currentPage, openSettingsTrigger = 0 } = {}) {
  const ctx = useRabbit()
  const agent = useAgent()
  const project = ctx?.project
  const [activeView, setActiveView] = useState('summary')

  // ── Dynamic tab visibility based on project toggle fields ──
  const hiddenTabs = useMemo(() => {
    const hidden = new Set()
    if (!project?.scenes_enabled) hidden.add('scenes')
    if (!project?.levels_enabled) hidden.add('levels')
    if (!project?.experiences_enabled) hidden.add('experiences')
    return hidden
  }, [project?.scenes_enabled, project?.levels_enabled, project?.experiences_enabled])

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

  return (
    <div className="relative h-full w-full flex flex-col" style={{ backgroundColor: '#1c1917' }}>
      {/* ── View tabs ── */}
      <ViewTabs
        activeView={activeView}
        onChange={setActiveView}
        disabled={!activeProjectId && activeView !== 'summary'}
        hiddenTabs={hiddenTabs}
        rightSlot={(
          <>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              title="RABBIT settings"
              className="p-1.5 rounded-sm transition-colors hover:bg-stone-700"
              style={{ color: '#a8a29e', border: '1px solid #44403c', backgroundColor: '#1c1917' }}
            >
              <SettingsIcon className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setShowHelpModal(true)}
              title="Help & Documentation"
              className="p-1.5 rounded-sm transition-colors hover:bg-stone-700"
              style={{ color: '#a8a29e', border: '1px solid #44403c', backgroundColor: '#1c1917' }}
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      />

      {/* ── Project context bar ── */}
      {activeView !== 'summary' && (
        <ProjectContextBar />
      )}

      {/* ── View body ── */}
      <div className="flex-1 overflow-hidden relative">
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

      {/* ── Adapter status dot ── */}
      {/* Replaces the old header adapter pill. A single 10px
          circle pinned to the bottom-right corner of the frame,
          offset up so it sits just above a horizontal scroll bar
          if one appears. Red = offline, green = online. Hovering
          reveals the adapter mode + status text. */}
      <AdapterStatusDot mode={adapterMode} status={adapterStatus} />
    </div>
  )
}

// ─── Adapter status dot ───
// Tiny corner indicator — just a colored circle. Red when offline,
// green when online, dim gray while the adapter isn't configured.
function AdapterStatusDot({ mode, status }) {
  const configured = !!mode
  const online = !!status?.online
  const color = !configured ? '#57534e' : (online ? '#22c55e' : '#ef4444')
  const glow  = !configured ? 'none'     : (online ? '0 0 6px rgba(34,197,94,0.7)' : '0 0 6px rgba(239,68,68,0.7)')
  const label = configured
    ? `${(mode || '').replace('_', ' ')} — ${online ? 'online' : 'offline'}`
    : 'adapter not configured'
  return (
    <div
      title={label}
      className="absolute rounded-full pointer-events-auto"
      style={{
        left: 10,
        bottom: 18,
        width: 10,
        height: 10,
        backgroundColor: color,
        border: '1px solid rgba(0,0,0,0.5)',
        boxShadow: glow,
        zIndex: 50,
      }}
    />
  )
}

// ─── No-project placeholder ───
function NoProjectPlaceholder({ onPickSummary }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4" style={{ backgroundColor: '#1c1917' }}>
      <ListChecks className="w-10 h-10" style={{ color: '#78716c' }} />
      <div className="text-xs font-mono text-center max-w-sm leading-relaxed" style={{ color: '#a8a29e' }}>
        No project selected. Open the Summary tab to pick an
        existing project or scaffold a new one.
      </div>
      <button
        type="button"
        onClick={onPickSummary}
        className="px-4 py-1.5 text-xs font-mono uppercase tracking-wider rounded-sm transition-colors"
        style={{
          color: '#fff7ed',
          backgroundColor: '#ea580c',
          border: '1px solid #c2410c',
        }}
      >
        Go to Summary
      </button>
    </div>
  )
}
