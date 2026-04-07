// ============================================================
// RABBIT v0.1 — top-level shell
// ============================================================
//
// Layout:
//
//   ┌────────────────────────────────────────────────────┐
//   │ Title │ adapter status │ refresh                   │   ← header
//   ├────────────────────────────────────────────────────┤
//   │ Intake │ Summary │ Assets │ Timeline │ Budget       │   ← tabs
//   ├────────────────────────────────────────────────────┤
//   │ Project: <name> │ Switch ▾ │ Gallery                 │   ← context bar
//   ├────────────────────────────────────────────────────┤
//   │                                                    │
//   │              <active view body>                    │
//   │                                                    │
//   └────────────────────────────────────────────────────┘
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

import { useEffect, useRef, useState } from 'react'
import { ListChecks, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { useRabbit } from './state/RabbitProvider'
import { useAgent } from '../../agent'
import ViewTabs from './components/ViewTabs'
import ProjectContextBar from './components/ProjectContextBar'
import IngestionToast from './components/IngestionToast'
import IntakeWizardView from './views/IntakeWizardView'
import ProjectSummaryView from './views/ProjectSummaryView'
import ProjectAssetsView from './views/ProjectAssetsView'
import TimelineView from './views/TimelineView'
import BudgetView from './views/BudgetView'

export default function Rabbit({ currentPage, openSettingsTrigger = 0 } = {}) {
  const ctx = useRabbit()
  const agent = useAgent()
  const [activeView, setActiveView] = useState('summary')

  // When the WILSON nav strip "SETTINGS" item is clicked the parent
  // bumps `openSettingsTrigger`. We need to (a) make sure the
  // Timeline view is the active view (because that's where the
  // settings panel lives) and (b) tell the timeline to open it.
  // Communication with TimelineView happens via a window-level
  // custom event so we don't need to thread refs through.
  const prevSettingsTrigger = useRef(openSettingsTrigger)
  useEffect(() => {
    if (openSettingsTrigger !== prevSettingsTrigger.current) {
      prevSettingsTrigger.current = openSettingsTrigger
      setActiveView('timeline')
      // Defer the dispatch one tick so the timeline view is mounted
      // by the time the event is fired.
      setTimeout(() => {
        try {
          window.dispatchEvent(new CustomEvent('rabbit:open-settings'))
        } catch {}
      }, 0)
    }
  }, [openSettingsTrigger])

  const adapterMode = ctx?.adapterMode
  const adapterStatus = ctx?.adapterStatus
  const refreshProjectsIndex = ctx?.refreshProjectsIndex
  const activeProjectId = ctx?.activeProjectId
  const loadingProject = ctx?.loadingProject

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
    <div className="h-full w-full flex flex-col" style={{ backgroundColor: '#1c1917' }}>
      {/* ── Header ── */}
      <div
        className="flex items-center justify-between px-6 py-3"
        style={{ borderBottom: '1px solid #44403c', backgroundColor: '#292524' }}
      >
        <div className="flex items-center gap-3">
          <ListChecks className="w-5 h-5" style={{ color: '#fb923c' }} />
          <span
            className="font-bold text-sm tracking-widest uppercase"
            style={{ color: '#fb923c' }}
          >
            R.A.B.B.I.T.
          </span>
          <AdapterBadge mode={adapterMode} status={adapterStatus} />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => refreshProjectsIndex?.()}
            title="Refresh projects index"
            className="p-1.5 rounded-sm transition-colors"
            style={{ color: '#a8a29e', border: '1px solid #44403c', backgroundColor: '#1c1917' }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingProject ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ── View tabs ── */}
      <ViewTabs
        activeView={activeView}
        onChange={setActiveView}
        disabled={!activeProjectId && activeView !== 'summary'}
      />

      {/* ── Project context bar ── */}
      <ProjectContextBar onJumpToSummary={() => setActiveView('summary')} />

      {/* ── View body ── */}
      <div className="flex-1 overflow-hidden relative">
        {!activeProjectId && activeView !== 'summary' ? (
          <NoProjectPlaceholder onPickSummary={() => setActiveView('summary')} />
        ) : (
          <div className="h-full">
            {activeView === 'intake'   && <IntakeWizardView   />}
            {activeView === 'summary'  && <ProjectSummaryView />}
            {activeView === 'assets'   && <ProjectAssetsView  />}
            {activeView === 'timeline' && <TimelineView       />}
            {activeView === 'budget'   && <BudgetView         />}
          </div>
        )}
      </div>

      {/* ── Background ingestion toast ── */}
      <IngestionToast onJumpToReview={handleJumpToReview} />
    </div>
  )
}

// ─── Adapter status pill ───
function AdapterBadge({ mode, status }) {
  if (!mode) return null
  const online = !!status?.online
  const Icon = online ? Wifi : WifiOff
  const label = (mode || '').replace('_', ' ')
  return (
    <span
      className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded-sm"
      style={{
        backgroundColor: '#1c1917',
        color: online ? '#86efac' : '#fca5a5',
        border: `1px solid ${online ? '#15803d' : '#7f1d1d'}`,
      }}
    >
      <Icon className="w-3 h-3" />
      {label}
    </span>
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
