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
// 🚨 THIS SELECT LIST IS THE DE-FACTO READ ALLOWLIST, and it is the only one —
// there is no WORKSPACE_STORAGE_COLUMNS constant, because this table is not
// read through the RABBIT adapter. A column missing from this string is
// invisible to every caller no matter what the database holds.
//
// It also has to stay in step with saveWorkspaceStorage below, which does a
// bare .select() (= *). Session 36 measured the consequence: with `provider`
// added to the table but not to this list, a LOADED row would have carried no
// provider while a SAVED row carried one, so the same component's `row` object
// changed shape halfway through a session depending on which path produced it.
export async function fetchWorkspaceStorage() {
  const { data, error } = await supabase
    .from('workspace_storage')
    .select('workspace_id, mode, provider, provider_config, root_path, root_kind, updated_at, updated_by')
    .maybeSingle()
  if (error) throw new Error(`workspace storage read failed: ${error.message}`)
  cachedRow = data
  return data
}

// ── Session 37: the cached storage choice, for the upload path ──────────────
// supabaseAdapter.uploadFile needs to know which provider accepts new bodies
// WITHOUT a PostgREST read per upload. One module-level slot, warmed by the
// reads and writes that already happen (App.jsx's sign-in fetch, every
// StorageSection save), lazily filled otherwise.
//
//   * undefined — never loaded this session. getWorkspaceStorageCached()
//     fetches; a FAILED fetch leaves it undefined and THROWS, so the caller
//     refuses its upload with a sentence rather than guessing where the
//     workspace stores media (guessing 'petal' would silently route a
//     customer's files to a store they may have moved away from).
//   * null — loaded, and the workspace has never configured storage
//     (= Petal cloud, today's behaviour exactly).
//
// Staleness matches the drive's own stated limit (S34): another admin's
// change reaches this session at its next launch or sign-in, not live.
let cachedRow

export async function getWorkspaceStorageCached() {
  if (cachedRow !== undefined) return cachedRow
  return await fetchWorkspaceStorage()
}

// Sign-out must forget the choice with the session (App.jsx's teardown
// branch) — the next account in this window may be a different workspace.
export function clearWorkspaceStorageCache() {
  cachedRow = undefined
}

// How many file bodies still live at a given provider (S37). Used by the
// Storage section to say how much is at stake BEFORE an admin switches
// provider — switching only changes where WILSON looks, so anything already
// written stays where it is and stops opening.
//
// Returns null when the count cannot be taken, and the caller must render
// that as unknown rather than as zero: "0 files affected" on the strength of
// a failed query is exactly the reassurance that makes someone click through.
// RLS scopes the count to the caller's own workspace.
export async function countFilesAtProvider(provider) {
  const { count, error } = await supabase
    .from('files')
    .select('id', { count: 'exact', head: true })
    .eq('storage_provider', provider)
  if (error) return null
  return count ?? 0
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
      cachedRow = ins.data
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
  cachedRow = data
  return data
}
