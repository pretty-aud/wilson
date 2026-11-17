/** @vitest-environment jsdom */
// =============================================================================
// rosterReads.test.jsx — F5 item 1 (shared B1, rabbit B1): the roster is read
// once for any number of readers, and once more per member event.
//
// The measurement and the pin are the same test. The three roster hooks are
// mounted as the app mounts them (useRosterMembers on the Rate Card page, in
// R.A.B.B.I.T. and twice in the Timeline; useWorkspaceMembers on the
// Dashboard, the Team Members page and the Admin terminal; useTeamMembers in
// Scenes and the entity views) over a client that counts every
// workspace_directory() call. Before F5 each mount read the roster itself,
// and on the cloud each useRosterMembers read it twice (both of its source
// hooks reach the same RPC); a member event reached only the pages that
// listened for it.
// =============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, cleanup, act, waitFor } from '@testing-library/react'

const holder = vi.hoisted(() => ({
  calls: [],
  rows: [],
  perms: null,
  rabbit: null,
  listeners: new Set(),
}))

function directoryRow(id, name, extra = {}) {
  return {
    workspace_id: holder.perms?.workspaceId ?? 'ws-1', user_id: id, app_role: 'user', username: name.toLowerCase(),
    display_name: name, pronouns: null, title: 'Artist', department: 'CG Art', avatar_url: null,
    is_active: true, onboarded_at: null, created_at: null, email: `${name.toLowerCase()}@example.test`, ...extra,
  }
}

const client = vi.hoisted(() => ({
  rpc: async (name) => {
    holder.calls.push({ name, userId: holder.perms?.userId, workspaceId: holder.perms?.workspaceId })
    // The rows as the caller is answered: read when the request is SENT.
    const rows = holder.rows.map((r) => ({ ...r }))
    // A turn of the event loop, as a real request takes (or a hold, to land late).
    await (holder.hold ? holder.hold : new Promise((r) => setTimeout(r, 5)))
    return { data: rows, error: null }
  },
  from: () => { throw new Error('the fallback table read is not expected here') },
}))

vi.mock('../../cloud/auth/supabaseClient', () => ({ supabase: client }))
vi.mock('../../permissions/usePermissions', () => ({
  usePermissions: () => holder.perms,
}))
vi.mock('../../tools/rabbit_v0.1.0/state/RabbitProvider', () => ({
  useRabbit: () => holder.rabbit,
}))
vi.mock('../../tools/rabbit_v0.1.0/state/rabbitLive', async (importOriginal) => ({
  ...(await importOriginal()),
  useRabbitOnline: () => true,
}))
vi.mock('../../dev/devFixtures', async (importOriginal) => ({ ...(await importOriginal()), devFixtures: () => null }))

const { useRosterMembers } = await import('./useRosterMembers')
const { useWorkspaceMembers, noteRosterEvent, __resetRosterCache } = await import('./useWorkspaceMembers')
const { useTeamMembers, __resetTeamMembersCache } = await import('./useTeamMembers')

// The cloud adapter's listTeamMembers, as supabaseAdapter.js writes it: the
// same RPC, mapped onto the local shape.
const cloudAdapter = {
  async listTeamMembers() {
    const { data } = await client.rpc('workspace_directory')
    return (data || []).filter((r) => r.is_active !== false).map((r) => ({ id: r.user_id, user_id: r.user_id, name: r.display_name }))
  },
}

const seen = new Map()
function RosterProbe({ k }) { seen.set(k, useRosterMembers().members.map((m) => m.name)); return null }
function WorkspaceProbe({ k }) { seen.set(k, useWorkspaceMembers().members.map((m) => m.display_name)); return null }
function TeamProbe({ k }) { seen.set(k, useTeamMembers().members.map((m) => m.name)); return null }

function App() {
  return (
    <>
      <RosterProbe k="rate-card" />
      <RosterProbe k="rabbit" />
      <RosterProbe k="timeline" />
      <WorkspaceProbe k="dashboard" />
      <WorkspaceProbe k="team-members" />
      <TeamProbe k="scenes" />
      <TeamProbe k="entity-list" />
    </>
  )
}

// What R.A.B.B.I.T.'s workspace channel does with an event (RabbitProvider's
// handleWorkspaceEvent, and the RESYNC of every join), plus the pages'
// listeners that F5 removed, if any were left.
function emit(evt) {
  noteRosterEvent(evt)
  for (const cb of [...holder.listeners]) cb(evt)
}

function signIn(userId, workspaceId, role = 'admin') {
  holder.perms = { ready: true, userId, workspaceId, role, can: () => true, workspaceIds: [workspaceId] }
}

const directoryCalls = () => holder.calls.filter((c) => c.name === 'workspace_directory')

beforeEach(() => {
  __resetRosterCache()
  __resetTeamMembersCache()
  holder.hold = null
  holder.calls = []
  holder.listeners = new Set()
  seen.clear()
  signIn('u-admin', 'ws-1')
  holder.rows = [directoryRow('u-ada', 'Ada'), directoryRow('u-bo', 'Bo')]
  holder.rabbit = {
    adapterMode: 'supabase',
    getAdapter: () => cloudAdapter,
    DEFAULT_WORKSPACE_ID: 'ws-default',
    subscribeWorkspaceEvents: (cb) => { holder.listeners.add(cb); return () => holder.listeners.delete(cb) },
  }
})
afterEach(() => { cleanup(); __resetRosterCache(); __resetTeamMembersCache() })

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
const LONG = { timeout: 3000 }

describe('the roster: one read for every reader', () => {
  it('seven readers on the cloud make one workspace_directory call, and all of them hold the roster', async () => {
    await act(async () => { render(<App />) })
    await waitFor(() => expect([...seen.values()].every((names) => names.length === 2)).toBe(true), LONG)
    await settle()
    expect(directoryCalls().length).toBe(1)
  })

  it('a workspace_members event reads it once more, and every reader sees the change', async () => {
    await act(async () => { render(<App />) })
    await waitFor(() => expect([...seen.values()].every((names) => names.length === 2)).toBe(true), LONG)
    await settle()
    const before = directoryCalls().length
    holder.rows = [directoryRow('u-ada', 'Ada Renamed'), directoryRow('u-bo', 'Bo')]
    await act(async () => { emit({ table: 'workspace_members', op: 'UPDATE', record: {}, oldRecord: null }) })
    await waitFor(() => expect([...seen.values()].every((names) => names.includes('Ada Renamed'))).toBe(true), LONG)
    await settle()
    expect(directoryCalls().length).toBe(before + 1)
  })
})

describe('the roster across a change of person, a rejoin and the Local Server', () => {
  it("a second person over the first never sees the first person's rows, even when the first read lands late", async () => {
    let release
    holder.hold = new Promise((r) => { release = r })
    holder.rows = [directoryRow('u-ada', 'Ada', { email: 'ada@admins-only.test' })]
    const { rerender } = render(<App />)
    await settle()
    // The admin's read is still out when a member signs in over them, in the same company.
    signIn('u-member', 'ws-1', 'user')
    holder.hold = null
    holder.rows = [directoryRow('u-ada', 'Ada', { email: null })]
    await act(async () => { rerender(<App />) })
    await act(async () => { release() })
    await waitFor(() => expect([...seen.values()].every((names) => names.length === 1)).toBe(true), LONG)
    await settle()
    expect(directoryCalls().map((c) => c.userId)).toEqual(['u-admin', 'u-member'])
  })

  it('a RESYNC (every join of the workspace channel) reads it once more, however many readers', async () => {
    await act(async () => { render(<App />) })
    await waitFor(() => expect([...seen.values()].every((names) => names.length === 2)).toBe(true), LONG)
    await settle()
    const before = directoryCalls().length
    await act(async () => { emit({ table: null, op: 'RESYNC', record: null, oldRecord: null }) })
    await act(async () => { await new Promise((r) => setTimeout(r, 600)) })
    expect(directoryCalls().length).toBe(before + 1)
  })

  it('on the Local Server the registry is read once for every reader, and the RPC is not called by them', async () => {
    let listed = 0
    const localAdapter = {
      async listTeamMembers() { listed += 1; await new Promise((r) => setTimeout(r, 5)); return [{ id: 'tm-1', name: 'Local Lee' }] },
    }
    holder.rabbit = { ...holder.rabbit, adapterMode: 'local_server', getAdapter: () => localAdapter }
    function Local() { return <><RosterProbe k="a" /><RosterProbe k="b" /><TeamProbe k="c" /><TeamProbe k="d" /></> }
    await act(async () => { render(<Local />) })
    await waitFor(() => expect(['a', 'b', 'c', 'd'].every((k) => (seen.get(k) || []).includes('Local Lee'))).toBe(true), LONG)
    await settle()
    expect(listed).toBe(1)
  })
})
