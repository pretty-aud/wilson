// ============================================================
// useRosterMembers — adapter-aware roster identity seam
// ============================================================
//
// One hook, one member shape, whatever the backend. Consumers that
// staff projects (roster pickers, assignee dropdowns) read people
// from here instead of choosing between useWorkspaceMembers (cloud
// workspace_directory) and useTeamMembers (legacy RABBIT JSON
// registry) themselves.
//
// Canonical person id per mode:
//   supabase     → auth user_id (workspace_members.user_id) — the same
//                  id project_members and tasks.assignee_id key on
//   local_server → the legacy RABBIT team-member uuid
//   google_drive → none (read-only, no roster)
// Consumers must treat ids as OPAQUE — never parse or cross-map them
// between modes.
//
// Returned shape:
//   { members: [{ id, name, title, department, email, avatar_url,
//                 location, is_active }],
//     mode, loading }
//
// `location` is only populated in local_server mode (the cloud
// workspace_directory has no such column — null there). RateCardTable's
// ghost-row region prefill reads it.

import { useMemo } from 'react'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'
import { useWorkspaceMembers } from './useWorkspaceMembers'
import { useTeamMembers } from './useTeamMembers'

export function useRosterMembers() {
  const rabbit = useRabbit()
  const mode = rabbit?.adapterMode || 'local_server'

  // Both source hooks run unconditionally (rules of hooks). Each is
  // cheap when its backend isn't active: useTeamMembers no-ops without
  // adapter.listTeamMembers (supabase/drive), useWorkspaceMembers
  // no-ops without a signed-in workspace claim (local).
  const workspace = useWorkspaceMembers()
  const team = useTeamMembers()

  const members = useMemo(() => {
    if (mode === 'supabase') {
      return (workspace.members || [])
        .filter(m => m.is_active)
        .map(m => ({
          id:         m.user_id,
          name:       m.display_name || m.username || '',
          title:      m.title || '',
          department: m.department || '',
          email:      m.email || '',
          avatar_url: m.avatar_url || null,
          location:   null,
          is_active:  !!m.is_active,
        }))
    }
    if (mode === 'local_server') {
      return (team.members || []).map(m => ({
        id:         m.id,
        name:       m.name || '',
        title:      m.title || '',
        department: m.department || '',
        email:      m.email || '',
        avatar_url: m.profile_picture_url || null,
        location:   m.location || '',
        is_active:  true,
      }))
    }
    // google_drive — read-only, no roster.
    return []
  }, [mode, workspace.members, team.members])

  const loading =
    mode === 'supabase'     ? workspace.loading :
    mode === 'local_server' ? team.loading :
    false

  return { members, mode, loading }
}
