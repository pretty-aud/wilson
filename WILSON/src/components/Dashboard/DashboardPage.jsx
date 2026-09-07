// ============================================================
// WILSON Dashboard (Session 8)
// ============================================================
//
// The user's personal cross-tool surface (v1 = RABBIT data only), reached
// from Home below the tools. Three tabs:
//   TASKS   — table / board / gallery of my assignments across projects
//   NOTES   — private rich-text notes (TipTap + Yjs)
//   PROFILE — the shared ProfileSection (built in Session 4 for this reuse)
//
// Header carries the workspace presence strip ("who's online"), fed by the
// Session 8 workspace channel and rendered with real avatars where members
// have uploaded one. Light resource-page layout, WILSON tokens throughout
// (SettingsPage tab-bar pattern).

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'
import { useWorkspaceMembers, isOwnAvatarUrl } from '../TeamMembers/useWorkspaceMembers'
import ProfileSection from '../settings/ProfileSection'
import DashboardTasksView from './DashboardTasksView'
import NotesView from './NotesView'
import { LIGHT_INK } from '../lightSurface'

const TABS = [
  { key: 'tasks',   label: 'My Tasks' },
  { key: 'notes',   label: 'Notes' },
  { key: 'profile', label: 'Profile' },
]

export default function DashboardPage() {
  const [tab, setTab] = useState('tasks')
  const rabbit = useRabbit()

  return (
    <div className="h-full flex flex-col" style={{ maxWidth: '1240px', margin: '0 auto', width: '100%', padding: '2rem 2rem' }}>
      {/* tab bar + presence */}
      <div className="flex items-end justify-between pb-4">
        <div className="flex gap-1">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider rounded-t-sm transition-colors"
              style={tab === t.key
                ? { backgroundColor: 'rgba(120, 70, 30, 0.55)', color: '#ffffff', borderBottom: '2px solid #f97316' }
                : { backgroundColor: 'transparent', color: LIGHT_INK, borderBottom: '2px solid transparent' }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <WorkspacePresenceStrip
          status={rabbit?.workspaceRealtimeStatus}
          users={rabbit?.workspacePresentUsers || []}
        />
      </div>

      {/* All three tabs stay mounted (app-wide pattern): the notes editor
          must not lose its Y.Doc, and the task views keep scroll state. */}
      <div className="flex-1 min-h-0" style={{ display: tab === 'tasks' ? 'flex' : 'none', flexDirection: 'column' }}>
        <DashboardTasksView />
      </div>
      <div className="flex-1 min-h-0" style={{ display: tab === 'notes' ? 'flex' : 'none', flexDirection: 'column' }}>
        <NotesView />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ display: tab === 'profile' ? 'block' : 'none' }}>
        <div style={{ maxWidth: '42rem' }}>
          <ProfileSection />
        </div>
      </div>
    </div>
  )
}

// ── workspace presence ("who's online") ─────────────────────
// Presence meta carries only { user_id, label } (auth user_metadata may be
// stale) — join against the workspace directory for display names + real
// avatars. Light-page treatment of the RealtimePresenceStrip pattern.
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
    <div className="flex items-center gap-2 pb-1">
      {status === 'live' && (
        <span
          className="px-1.5 py-0.5 rounded-sm text-[9px] font-bold uppercase tracking-wider"
          style={{ backgroundColor: 'rgba(251, 146, 60, 0.18)', color: '#ea580c', border: '1px solid #fb923c' }}
          title="Workspace live sync active"
        >
          Live
        </span>
      )}
      {resolved.length > 0 && (
        <div className="flex items-center -space-x-1.5">
          {resolved.map(u => (
            isOwnAvatarUrl(u.avatar_url) ? (
              <img
                key={u.user_id}
                src={u.avatar_url}
                alt=""
                title={u.label}
                className="w-6 h-6 rounded-full object-cover"
                style={{ border: '1.5px solid #f4a261' }}
              />
            ) : (
              <span
                key={u.user_id}
                title={u.label}
                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                style={{ backgroundColor: 'rgba(120, 70, 30, 0.55)', color: '#fde8d0', border: '1.5px solid #f4a261' }}
              >
                {(u.label || '?').trim().charAt(0).toUpperCase()}
              </span>
            )
          ))}
          {overflow > 0 && (
            <span
              className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold font-mono"
              style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1.5px solid #f4a261' }}
            >
              +{overflow}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
