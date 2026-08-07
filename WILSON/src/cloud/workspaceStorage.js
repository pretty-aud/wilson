// =============================================================================
// workspaceStorage.js — Session 34: read/write the workspace storage root
// (public.workspace_storage, migration 0048).
//
// Rides the shared authed client directly, like every Admin Terminal data
// path (CompanySection reads `workspaces` the same way) — NOT the RABBIT
// adapter, because the storage root is workspace infrastructure that must
// load even when the RABBIT adapter is pinned to Local Server.
//
// RLS supplies the workspace scope on reads (members SELECT their own
// workspace's row and nothing else), and enforces admin-only writes. The
// checks below exist because supabase-js reports refusals on its error
// channel — and an RLS-refused UPDATE matches ZERO rows and raises nothing
// (the trap that cost the Validator every fix Audrey ever accepted, S30).
//
// Callers: App.jsx (fetch → push root into the Electron main process) and
// AdminTerminal/StorageSection.jsx (fetch + save). workspaceRootWiring.test.js
// pins both call sites — a green unit test over a dead path is the repo's
// most expensive pattern (six instances).
// =============================================================================

import { supabase } from './auth/supabaseClient'

// The workspace's storage row, or null when storage has never been
// configured. Throws on a real error — callers must not treat a broken read
// as "unconfigured" (useRosterMembers' silent [] is the standing example of
// why not).
export async function fetchWorkspaceStorage() {
  const { data, error } = await supabase
    .from('workspace_storage')
    .select('workspace_id, mode, root_path, root_kind, updated_at, updated_by')
    .maybeSingle()
  if (error) throw new Error(`workspace storage read failed: ${error.message}`)
  return data
}

// Create or patch the row. `exists` comes from the caller's loaded state:
// updates PATCH only the named columns (two admins changing two different
// settings must not clobber each other — the §5b rule the legacy JSONB blob
// could never honour), inserts write the full row.
//
// The `!data` throw is load-bearing: an UPDATE refused by RLS (a demoted
// admin's stale tab, a revoked membership) matches no rows and returns
// success with nothing in it. Without this check that refusal renders as a
// green save — the exact shape S30 fixed in the Validator.
export async function saveWorkspaceStorage({ workspaceId, exists, patch }) {
  if (!workspaceId) throw new Error('workspace storage save failed: no workspace')
  if (!exists) {
    const ins = await supabase
      .from('workspace_storage')
      .insert({ workspace_id: workspaceId, ...patch })
      .select()
      .maybeSingle()
    if (!ins.error) {
      if (!ins.data) throw new Error('workspace storage save failed: the write was refused (are you still an admin of this workspace?)')
      return ins.data
    }
    // 23505: another admin created the row between this tab's load and this
    // save. Falling through to UPDATE recovers instead of stranding the
    // section in a PK-conflict loop (S34 review).
    if (ins.error.code !== '23505') {
      throw new Error(`workspace storage save failed: ${ins.error.message}`)
    }
  }
  const { data, error } = await supabase
    .from('workspace_storage')
    .update(patch)
    .eq('workspace_id', workspaceId)
    .select()
    .maybeSingle()
  if (error) throw new Error(`workspace storage save failed: ${error.message}`)
  if (!data) throw new Error('workspace storage save failed: the write was refused (are you still an admin of this workspace?)')
  return data
}
