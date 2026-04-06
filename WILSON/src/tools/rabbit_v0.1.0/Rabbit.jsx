// ============================================================
// RABBIT v0.1 — top-level shell
// ============================================================
//
// Layout:
//
//   ┌────────────────────────────────────────────────────┐
//   │ Title │ ProjectPicker │ adapter status │ refresh   │   ← header
//   ├────────────────────────────────────────────────────┤
//   │ Intake │ Summary │ Assets │ Timeline │ Budget       │   ← tabs
//   ├────────────────────────────────────────────────────┤
//   │                                                    │
//   │              <active view body>                    │
//   │                                                    │
//   └────────────────────────────────────────────────────┘
//
// The shell never owns project data — every child consumes
// `useRabbit()` (or one of the narrower hooks) directly. The
// only piece of state that lives here is the currently
// selected view tab; the active project is workspace state
// owned by RabbitProvider so it survives navigation.
//
// activeTool wiring: when this page becomes visible the agent
// system needs to know that RABBIT is the foreground tool. The
// effect uses the `currentPage` prop passed down from App.jsx
// — calling setActiveTool('rabbit') on visibility.

import { useEffect, useState } from 'react'
import { ListChecks, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { useRabbit } from './state/RabbitProvider'
import { useAgent } from '../../agent'
import ProjectPicker from './components/ProjectPicker'
import ViewTabs from './components/ViewTabs'
import IntakeWizardView from './views/IntakeWizardView'
import ProjectSummaryView from './views/ProjectSummaryView'
import ProjectAssetsView from './views/ProjectAssetsView'
import TimelineView from './views/TimelineView'
import BudgetView from './views/BudgetView'

export default function Rabbit({ currentPage } = {}) {
  const ctx = useRabbit()
  const agent = useAgent()
  const [activeView, setActiveView] = useState('intake')

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

  // When the active project changes, jump to summary unless the
  // user is mid-intake. Picking a brand-new project should land
  // them on the intake wizard so they can run the importer.
  useEffect(() => {
    if (!activeProjectId) {
      setActiveView('intake')
    }
  }, [activeProjectId])

  return (
    <div className="h-full w-full flex flex-col" style={{ backgroundColor: '#fef3e8' }}>
      {/* ── Header ── */}
      <div
        className="flex items-center justify-between px-6 py-3"
        style={{ borderBottom: '2px solid #7c2d12', backgroundColor: '#f4a261' }}
      >
        <div className="flex items-center gap-3">
          <ListChecks className="w-5 h-5" style={{ color: '#1c1917' }} />
          <span
            className="font-bold text-sm tracking-widest uppercase"
            style={{ color: '#1c1917' }}
          >
            R.A.B.B.I.T.
          </span>
          <AdapterBadge mode={adapterMode} status={adapterStatus} />
        </div>

        <div className="flex items-center gap-2">
          <ProjectPicker />
          <button
            type="button"
            onClick={() => refreshProjectsIndex?.()}
            title="Refresh projects index"
            className="p-1.5 rounded-sm hover:bg-orange-200 transition-colors"
            style={{ color: '#1c1917' }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingProject ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ── View tabs ── */}
      <ViewTabs
        activeView={activeView}
        onChange={setActiveView}
        disabled={!activeProjectId && activeView !== 'intake'}
      />

      {/* ── View body ── */}
      <div className="flex-1 overflow-hidden relative">
        {!activeProjectId && activeView !== 'intake' ? (
          <NoProjectPlaceholder onPickIntake={() => setActiveView('intake')} />
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
        backgroundColor: '#fef3e8',
        color: online ? '#15803d' : '#7c2d12',
        border: `1px solid ${online ? '#15803d' : '#7c2d12'}`,
      }}
    >
      <Icon className="w-3 h-3" />
      {label}
    </span>
  )
}

// ─── No-project placeholder ───
function NoProjectPlaceholder({ onPickIntake }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4">
      <ListChecks className="w-10 h-10" style={{ color: '#7c2d12' }} />
      <div className="text-xs font-mono text-center max-w-sm leading-relaxed" style={{ color: '#7c2d12' }}>
        Pick a project from the header dropdown, or run the intake
        wizard to create one from a brief.
      </div>
      <button
        type="button"
        onClick={onPickIntake}
        className="px-4 py-1.5 text-xs font-mono uppercase tracking-wider rounded-sm transition-colors"
        style={{
          color: '#fff7ed',
          backgroundColor: '#ea580c',
          border: '2px solid #7c2d12',
        }}
      >
        Open intake wizard
      </button>
    </div>
  )
}
