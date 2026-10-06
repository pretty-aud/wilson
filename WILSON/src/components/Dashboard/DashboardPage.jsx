// ============================================================
// WILSON Dashboard (Session 8; UI overhaul C2)
// ============================================================
//
// The user's personal cross-tool surface (v1 = RABBIT data only), reached
// from Home below the tools. Three tabs:
//   MY TASKS — table / board / gallery of my assignments across projects
//   NOTES    — private rich-text notes (TipTap + Yjs)
//   PROFILE  — the shared ProfileSection (built in Session 4 for this reuse)
//
// Header carries the workspace presence strip ("who's online"), fed by the
// Session 8 workspace channel and rendered with real avatars where members
// have uploaded one.
//
// ── The overhaul ────────────────────────────────────────────────────────────
//
// Q1 moved this page onto the dark `paper` (the registry row flips in this
// commit, which is the rule: a page's `surface` changes with its own inks and
// never before). The hand-rolled tab bar — the third of three light-page tab
// bars, at its own size, its own tracking and its own padding, underlined in
// a `#f97316` that disagreed with the `#ea580c` bar 8px above it — is the
// kit's `Tabs`, and the strip that holds it is the kit's `Toolbar`, so the
// tabs and the presence chips finally share one baseline instead of being
// hand-nudged 4px apart (review D14, alignment 2).
//
// The page no longer sets its own padding or its own 32px gutter: it takes
// the 1240px data measure and the one 24px gutter, so the title in the orange
// bar and the first content column share a left edge (alignment 1, §3.3).
//
// 🚨 All three tabs stay MOUNTED (app-wide pattern): the notes editor must not
// lose its Y.Doc and the task views keep their scroll state. `authSelectors.
// test.js` reads this file as source and pins both that fact and the bare
// `<ProfileSection />` call, because the profile tab being in the DOM on every
// authed page is what makes two `getByLabel` values collide in Playwright.
// Do not change either string without reading that test.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'
import { useWorkspaceMembers, isOwnAvatarUrl } from '../TeamMembers/useWorkspaceMembers'
import ProfileSection from '../settings/ProfileSection'
import DashboardTasksView from './DashboardTasksView'
import NotesView from './NotesView'
import { StatusBadge, Tabs, Toolbar } from '../../ui'
import './dashboard.css'

const TABS = [
  { id: 'tasks', label: 'My tasks' },
  { id: 'notes', label: 'Notes' },
  { id: 'profile', label: 'Profile' },
]

const DASH_PANEL_ID = 'dashboard-panel'

export default function DashboardPage() {
  const [tab, setTab] = useState('tasks')
  const rabbit = useRabbit()

  return (
    <div className="dash-page">
      <Toolbar
        right={(
          <WorkspacePresenceStrip
            status={rabbit?.workspaceRealtimeStatus}
            users={rabbit?.workspacePresentUsers || []}
          />
        )}
      >
        <Tabs
          label="Dashboard views"
          panelId={DASH_PANEL_ID}
          items={TABS}
          value={tab}
          onChange={setTab}
        />
      </Toolbar>

      {/* The region the tabs switch. One tabpanel, three mounted children, of
          which one is shown — the hidden siblings are how this page keeps its
          state, not three panels the tablist has to point at. */}
      <div className="dash-panel" id={DASH_PANEL_ID} role="tabpanel" aria-label={`${TABS.find(t => t.id === tab)?.label} view`}>
        <div className="dash-tabpane" style={{ display: tab === 'tasks' ? 'flex' : 'none' }}>
          <DashboardTasksView />
        </div>
        <div className="dash-tabpane" style={{ display: tab === 'notes' ? 'flex' : 'none' }}>
          <NotesView />
        </div>
        <div className="dash-tabpane dash-tabpane-scroll" style={{ display: tab === 'profile' ? 'block' : 'none' }}>
          {/* 🚨 THE LIGHT BRIDGE, AND IT IS TEMPORARY.
              `ProfileSection` belongs to Settings (lane D1) and hard-codes
              `surface="light"` on every kit control it renders, because until
              this commit both of its hosts were the light ground. On `paper`
              those controls resolve `--color-ink-light` — which is #1c1917,
              the paper itself — so the whole tab would render black on black.
              The review is explicit that this component "must be scheduled
              with its owning pass and explicitly left alone here" (D35), and
              D1 filed the fix as kit request 6: ProfileSection needs a
              `surface` prop.
              Until that lands, this region re-points the four light-surface
              tokens at their dark equivalents, so the shared component reads
              correctly on this ground without being edited. It is a token
              remap in one scoped place, not a second copy of the component.
              DELETE this wrapper and pass `surface="dark"` the moment the
              prop exists. Re-filed in the C2 hand-off. */}
          <div className="dash-profile-bridge">
            <ProfileSection />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── workspace presence ("who's online") ─────────────────────
// Presence meta carries only { user_id, label } (auth user_metadata may be
// stale) — join against the workspace directory for display names + real
// avatars.
function WorkspacePresenceStrip({ status, users }) {
  const wm = useWorkspaceMembers()
  const rabbit = useRabbit()

  // Roster/avatar liveness (review finding M3): workspace_members events on
  // the workspace channel debounce into a directory reload so avatar and
  // name changes reach the chips without a page revisit.
  const reloadRef = useRef(wm.reload)
  useEffect(() => { reloadRef.current = wm.reload }, [wm.reload])
  useEffect(() => {
    const subscribe = rabbit?.subscribeWorkspaceEvents
    if (typeof subscribe !== 'function') return undefined
    let timer = null
    const unsub = subscribe((evt) => {
      if (evt.table !== 'workspace_members') return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        reloadRef.current?.()
      }, 400)
    })
    return () => {
      if (timer) clearTimeout(timer)
      unsub()
    }
  }, [rabbit?.subscribeWorkspaceEvents])

  const resolved = useMemo(() => {
    const byId = {}
    for (const m of wm.members || []) byId[m.user_id] = m
    return (users || []).slice(0, 5).map(u => {
      const m = byId[u.user_id]
      return {
        user_id: u.user_id,
        label: m?.display_name || m?.username || u.label || 'Member',
        avatar_url: m?.avatar_url || null,
      }
    })
  }, [users, wm.members])

  if (status !== 'live' && resolved.length === 0) return null

  const overflow = Math.max(0, (users?.length || 0) - resolved.length)

  return (
    <span className="dash-presence">
      {/* Was 9px #ea580c on an orange tint at 1.81:1 — the smallest and
          lowest-contrast text on the surface, and a fourth orange for its
          border. It is a status, so it is the one status component, at the
          11px floor, drawing its colour from the semantic source (D5). */}
      {status === 'live' && (
        <StatusBadge status="online" label="Live" title="Workspace live sync active" />
      )}
      {resolved.length > 0 && (
        <span className="dash-avatars">
          {resolved.map(u => (
            isOwnAvatarUrl(u.avatar_url) ? (
              <img
                key={u.user_id}
                src={u.avatar_url}
                alt=""
                title={u.label}
                className="dash-avatar"
              />
            ) : (
              <span key={u.user_id} title={u.label} className="dash-avatar dash-avatar-initial">
                {(u.label || '?').trim().charAt(0).toUpperCase()}
              </span>
            )
          ))}
          {overflow > 0 && (
            <span className="dash-avatar dash-avatar-overflow">+{overflow}</span>
          )}
        </span>
      )}
    </span>
  )
}
