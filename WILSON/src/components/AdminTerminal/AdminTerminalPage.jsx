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
  Users, Building2, ScrollText, Activity, Lock, GitPullRequestArrow, Cpu, HardDrive,
} from 'lucide-react'
import { usePermissions } from '../../permissions'
import { useWorkspaceMembers } from '../TeamMembers/useWorkspaceMembers'
import EmptyState from '../../ui/EmptyState'
import UsersSection from './UsersSection'
import CompanySection from './CompanySection'
import LogsSection from './LogsSection'
import DiagnosticsSection from './DiagnosticsSection'
import ChangeRequestsSection from './ChangeRequestsSection'
import ModelsSection from './ModelsSection'
import StorageSection from './StorageSection'
import './adminTerminal.css'

// Session 11 adds a fifth item. Miller's Law still holds (5 ≤ 7±2), and
// Serial Position keeps the two most-used sections at the ends: Users first,
// Diagnostics last. Requests sits next to Company because deciding what the
// company's standard courses say is company administration.
//
// Session 20 adds a sixth — still inside 7±2. Models sits beside Company for
// the same reason Requests does: choosing which model the whole company
// generates on is company administration, not a per-user preference. The
// per-user one lives in SYSTEM SETTINGS and beats this.
//
// Session 34 adds the seventh — AT the 7±2 limit now; the next section must
// argue for merging, not appending. Storage sits in the Company/Models block
// for the same reason both of them do: where the whole company's media lives
// is company administration (Audrey: "the admins can set the drive in the
// admin terminal").
//
// UI overhaul C3b, AT-33: the strip is at its own stated 7±2 ceiling and the
// next section has nowhere to go. Two hairlines group it into the three things
// an admin is actually here to do — people, the company's settings, and what
// the system is doing — WITHOUT removing an item or putting one behind a
// click. All seven stay one click away, which is what C1 requires; `group` is
// the only new field and it is purely visual.
const NAV = [
  { key: 'users', label: 'Users', icon: Users, group: 'people' },
  { key: 'company', label: 'Company', icon: Building2, group: 'company' },
  { key: 'models', label: 'Models', icon: Cpu, group: 'company' },
  { key: 'storage', label: 'Storage', icon: HardDrive, group: 'company' },
  { key: 'requests', label: 'Requests', icon: GitPullRequestArrow, group: 'company' },
  { key: 'logs', label: 'Logs', icon: ScrollText, group: 'system' },
  { key: 'diagnostics', label: 'Diagnostics', icon: Activity, group: 'system' },
]

export default function AdminTerminalPage() {
  const perms = usePermissions()

  if (!perms.ready) return null

  if (perms.role !== 'admin') {
    return (
      <div className="at-page at-page-gate">
        <EmptyState
          Icon={Lock}
          title="Admins only"
          body="The Admin terminal is available to workspace admins."
        />
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
    /* THE PAGE'S OWN `2rem 2rem` PADDING AND ITS `maxWidth` ARE GONE (AT-29).
       It capped itself at 1240px INSIDE its own padding, so the first column
       started 32px in while the page title in the orange bar above started at
       24px — an 8px offset small enough to read as an accident rather than an
       indent, and the only vertical line the page had. The measure is the data
       cap PLUS the one gutter outside it, the same arithmetic `PageHeader`
       does with `measure="data"`, so the title sits directly above the first
       row. Three stacked gutters become one.

       The duplicate <h1> and its Terminal icon go with it (AT-09): the page
       title was drawn twice, once in white in the bar and once in black 20px
       below. F2 deleted exactly this on Team Members. */
    <div className="at-page">
      <div className="at-body">
        {/* Left nav — seven items in three hairline-separated groups. */}
        <nav className="at-nav" aria-label="Admin sections">
          {NAV.map((item, i) => {
            const Icon = item.icon
            const active = section === item.key
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setSection(item.key)}
                className="at-nav-item"
                data-active={String(active)}
                data-group-start={String(i > 0 && NAV[i - 1].group !== item.group)}
                aria-current={active ? 'page' : undefined}
              >
                {/* Inactive nav is weight-and-fill, not a lighter ink:
                    #57534e measured 3.70:1 on this page and #78716c 2.33:1.
                    Both branches now live in adminTerminal.css, and the icon
                    follows the button rather than repeating its ternary. */}
                <Icon className="at-nav-icon" aria-hidden="true" />
                {item.label}
              </button>
            )
          })}
        </nav>

        {/* Sections stay mounted; display toggles (state survives hops),
            fetches gate on isActive so inactive sections stay idle. */}
        {/* THE `display` TERNARIES STAY EXACTLY AS THEY ARE. Every section is
            mounted and only its display toggles, so scroll and filter state
            survive a section hop; five of the seven lazy-fetch on FIRST
            activation behind a `loadedRef`, and anything that changes a
            section's identity or key remounts it, resets that ref and refires
            the RPCs — including a `workspace_directory` call — on every hop
            (review Risk 3). This is not a paint, so C3's state extraction left
            it alone and so does this conversion. */}
        <div className="at-pane">
          <div className="at-view" style={{ display: section === 'users' ? 'block' : 'none' }}>
            <UsersSection isActive={section === 'users'} wm={wm} />
          </div>
          <div className="at-view at-view-scroll wilson-dark-scroll" style={{ display: section === 'company' ? 'block' : 'none' }}>
            <CompanySection isActive={section === 'company'} wm={wm} />
          </div>
          <div className="at-view" style={{ display: section === 'models' ? 'block' : 'none' }}>
            <ModelsSection isActive={section === 'models'} />
          </div>
          <div className="at-view at-view-scroll wilson-dark-scroll" style={{ display: section === 'storage' ? 'block' : 'none' }}>
            <StorageSection isActive={section === 'storage'} workspaceId={workspaceId} />
          </div>
          <div className="at-view" style={{ display: section === 'requests' ? 'block' : 'none' }}>
            <ChangeRequestsSection isActive={section === 'requests'} />
          </div>
          <div className="at-view" style={{ display: section === 'logs' ? 'block' : 'none' }}>
            <LogsSection isActive={section === 'logs'} workspaceId={workspaceId} />
          </div>
          <div className="at-view at-view-scroll wilson-dark-scroll" style={{ display: section === 'diagnostics' ? 'block' : 'none' }}>
            <DiagnosticsSection isActive={section === 'diagnostics'} />
          </div>
        </div>
      </div>
    </div>
  )
}
