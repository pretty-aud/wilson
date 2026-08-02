// =============================================================================
// AdminTerminalPage — the Session 9 admin console shell.
//
// UX laws embodied:
//   Jakob's Law — classic admin-console shape: fixed left nav, section pane.
//   Miller's / Hick's Law — exactly four nav items, no more.
//   Pareto Principle — USERS is the default section (the 80% job).
//
// No props (App renders every page simultaneously). All four sections stay
// MOUNTED with display toggling (app-wide pattern), so scroll and filter
// state survive section hops — but each section lazy-fetches on its FIRST
// activation via the isActive prop; initial mount stays cheap. The roster
// hook lives here (single instance) and is passed to the sections that
// need it.
//
// Access: workspace admins only ('admin.terminal.access' is admin-scoped in
// the role matrix; the role check below is the equivalent presentation
// gate). Every mutation behind this page is enforced server-side.
// =============================================================================

import { useState } from 'react'
import {
  Users, Building2, ScrollText, Activity, Lock, Terminal, GitPullRequestArrow, Cpu,
} from 'lucide-react'
import { usePermissions } from '../../permissions'
import { useWorkspaceMembers } from '../TeamMembers/useWorkspaceMembers'
import UsersSection from './UsersSection'
import CompanySection from './CompanySection'
import LogsSection from './LogsSection'
import DiagnosticsSection from './DiagnosticsSection'
import ChangeRequestsSection from './ChangeRequestsSection'
import ModelsSection from './ModelsSection'

// Session 11 adds a fifth item. Miller's Law still holds (5 ≤ 7±2), and
// Serial Position keeps the two most-used sections at the ends: Users first,
// Diagnostics last. Requests sits next to Company because deciding what the
// company's standard courses say is company administration.
//
// Session 20 adds a sixth — still inside 7±2. Models sits beside Company for
// the same reason Requests does: choosing which model the whole company
// generates on is company administration, not a per-user preference. The
// per-user one lives in SYSTEM SETTINGS and beats this.
const NAV = [
  { key: 'users', label: 'Users', icon: Users },
  { key: 'company', label: 'Company', icon: Building2 },
  { key: 'models', label: 'Models', icon: Cpu },
  { key: 'requests', label: 'Requests', icon: GitPullRequestArrow },
  { key: 'logs', label: 'Logs', icon: ScrollText },
  { key: 'diagnostics', label: 'Diagnostics', icon: Activity },
]

export default function AdminTerminalPage() {
  const perms = usePermissions()

  if (!perms.ready) return null

  if (perms.role !== 'admin') {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
        <Lock className="w-8 h-8" style={{ color: '#a8a29e' }} />
        <span className="text-xs font-mono italic" style={{ color: '#78716c' }}>
          The Admin Terminal is available to workspace admins.
        </span>
      </div>
    )
  }

  // The roster hook mounts ONLY for admins (this page renders for everyone
  // in the all-pages-mounted shell — a page-level hook would fire a
  // workspace_directory RPC for every user at every launch).
  return <AdminTerminalBody workspaceId={perms.workspaceId} />
}

function AdminTerminalBody({ workspaceId }) {
  const wm = useWorkspaceMembers()
  const [section, setSection] = useState('users')

  return (
    <div className="h-full flex flex-col" style={{ maxWidth: '1240px', margin: '0 auto', width: '100%', padding: '2rem 2rem' }}>
      <div className="flex items-center gap-3 mb-6">
        <Terminal className="w-6 h-6" style={{ color: '#1c1917' }} />
        <h1 className="text-lg font-bold uppercase tracking-widest" style={{ color: '#1c1917' }}>
          Admin Terminal
        </h1>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Left nav — four items, uppercase, orange active accent. */}
        <nav className="flex-shrink-0 flex flex-col gap-1 pr-4" style={{ width: '190px' }}>
          {NAV.map(item => {
            const Icon = item.icon
            const active = section === item.key
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setSection(item.key)}
                className="flex items-center gap-2 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-left rounded-sm transition-colors"
                style={active
                  ? { backgroundColor: 'rgba(234, 88, 12, 0.18)', color: '#1c1917', borderLeft: '3px solid #ea580c' }
                  : { backgroundColor: 'transparent', color: '#57534e', borderLeft: '3px solid transparent' }}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: active ? '#ea580c' : '#78716c' }} />
                {item.label}
              </button>
            )
          })}
        </nav>

        {/* Sections stay mounted; display toggles (state survives hops),
            fetches gate on isActive so inactive sections stay idle. */}
        <div className="flex-1 min-w-0 min-h-0 pl-4" style={{ borderLeft: '1px solid #e7e5e4' }}>
          <div className="h-full min-h-0" style={{ display: section === 'users' ? 'block' : 'none' }}>
            <UsersSection isActive={section === 'users'} wm={wm} />
          </div>
          <div className="h-full min-h-0 overflow-y-auto wilson-light-scroll" style={{ display: section === 'company' ? 'block' : 'none' }}>
            <CompanySection isActive={section === 'company'} wm={wm} />
          </div>
          <div className="h-full min-h-0" style={{ display: section === 'models' ? 'block' : 'none' }}>
            <ModelsSection isActive={section === 'models'} />
          </div>
          <div className="h-full min-h-0" style={{ display: section === 'requests' ? 'block' : 'none' }}>
            <ChangeRequestsSection isActive={section === 'requests'} />
          </div>
          <div className="h-full min-h-0" style={{ display: section === 'logs' ? 'block' : 'none' }}>
            <LogsSection isActive={section === 'logs'} workspaceId={workspaceId} />
          </div>
          <div className="h-full min-h-0 overflow-y-auto wilson-light-scroll" style={{ display: section === 'diagnostics' ? 'block' : 'none' }}>
            <DiagnosticsSection isActive={section === 'diagnostics'} />
          </div>
        </div>
      </div>
    </div>
  )
}
