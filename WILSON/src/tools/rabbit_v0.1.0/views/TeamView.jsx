// ============================================================
// RABBIT — TeamView (project-level team management)
// ============================================================
//
// Shows which team members are assigned to the active project.
// Users can:
//   - Assign members from the workspace-level team members DB
//     (multi-select with checkboxes + confirm button)
//   - Remove members from the project
//   - Mark members as manager / reviewer (project-scoped role)
//   - View each member's assigned tasks in the project
//   - Filter, sort, group, and search members
//   - Save and load view profiles
//
// Only members assigned to this project can be selected as
// task assignees or reviewers in the Timeline and Assets views.
//
// Session 6: in supabase mode this view manages the project_members roster
// (migration 0013) via ProjectMembersPanel below — project-level
// manager / reviewer / member seats with projectRoleMatrix-parity gating.
// The legacy team_assignments UI is untouched and still drives the
// local_server / google_drive modes.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Users, UserPlus, UserMinus, X, Plus,
  Filter, Search, ArrowUpDown, Layers, Save,
  BookmarkPlus, ChevronDown, ChevronRight,
} from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
import { useTeamMembers } from '../../../components/TeamMembers/useTeamMembers'
import { useWorkspaceMembers } from '../../../components/TeamMembers/useWorkspaceMembers'
import { usePermissions } from '../../../permissions/usePermissions'
import { canOnProject } from '../../../permissions/projectRoleMatrix'

const ROLE_COLORS = {
  member:   { fg: '#d6d3d1', bg: '#1c1917', border: '#44403c' },
  manager:  { fg: '#fbbf24', bg: '#1c1917', border: '#78350f' },
  reviewer: { fg: '#a78bfa', bg: '#1c1917', border: '#4c1d95' },
}

const TEAM_ROLES = ['member', 'manager', 'reviewer']
const EMPLOYMENT_TYPES = ['full_time', 'freelancer']

const TEAM_FILTER_FIELDS = [
  { value: 'role', label: 'Role', type: 'select', options: TEAM_ROLES },
  { value: 'employment_type', label: 'Type', type: 'select', options: EMPLOYMENT_TYPES },
  { value: 'department', label: 'Department', type: 'text' },
  { value: 'name', label: 'Name', type: 'text' },
]

const FILTER_OPS = {
  select: [
    { value: 'is', label: 'is' },
    { value: 'is_not', label: 'is not' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
  text: [
    { value: 'contains', label: 'contains' },
    { value: 'not_contains', label: 'does not contain' },
    { value: 'is', label: 'is' },
    { value: 'is_not', label: 'is not' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
}

const TEAM_SORTABLE_FIELDS = [
  { value: 'name', label: 'Name' },
  { value: 'title', label: 'Title' },
  { value: 'department', label: 'Department' },
  { value: 'role', label: 'Role' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'start_date', label: 'Start Date' },
  { value: 'end_date', label: 'End Date' },
]

const TEAM_GROUPABLE_FIELDS = [
  { value: '', label: 'No grouping' },
  { value: 'role', label: 'Role' },
  { value: 'department', label: 'Department' },
  { value: 'employment_type', label: 'Type' },
]

const SAVED_VIEWS_KEY = 'rabbit_team_saved_views'

function fmt(s) { return (s || '').replace(/_/g, ' ') }

export default function TeamView() {
  const ctx = useRabbit()
  const tm = useTeamMembers()
  const [showPicker, setShowPicker] = useState(false)

  // ── Filter / sort / group / search state ──
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState([])
  const [sortField, setSortField] = useState('')
  const [sortDir, setSortDir] = useState('asc')
  const [groupBy, setGroupBy] = useState('')
  const [showFilterPanel, setShowFilterPanel] = useState(false)
  const [savedViews, setSavedViews] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) || '[]') } catch { return [] }
  })
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState(new Set())

  const project = ctx?.project
  const cloudMode = ctx?.adapterMode === 'supabase'
  const teamAssignments = ctx?.teamAssignments || []
  const tasks = ctx?.tasks || []

  // Build member lookup from workspace DB
  const memberById = useMemo(() => {
    const map = {}
    for (const m of tm.members) map[m.id] = m
    return map
  }, [tm.members])

  // Set of member IDs already assigned to this project
  const assignedIds = useMemo(() => {
    return new Set(teamAssignments.map(a => a.member_id))
  }, [teamAssignments])

  // Available members (not yet assigned)
  const availableMembers = useMemo(() => {
    return tm.members.filter(m => !assignedIds.has(m.id))
  }, [tm.members, assignedIds])

  // Task counts per member (assignee_id on tasks)
  const taskCountByMember = useMemo(() => {
    const map = {}
    for (const t of tasks) {
      if (t.assignee_id) {
        map[t.assignee_id] = (map[t.assignee_id] || 0) + 1
      }
      if (t.reviewer_id && t.reviewer_id !== t.assignee_id) {
        map[t.reviewer_id] = (map[t.reviewer_id] || 0) + 1
      }
    }
    return map
  }, [tasks])

  // ── Data pipeline: resolve, filter, sort, group ──

  const resolvedMembers = useMemo(() => {
    return teamAssignments.map(a => {
      const member = memberById[a.member_id]
      if (!member) return null
      return {
        ...a,
        member,
        name: member.name || '',
        title: member.title || '',
        department: member.department || '',
        employment_type: member.employment_type || 'full_time',
        email: member.email || '',
        taskCount: taskCountByMember[member.id] || 0,
      }
    }).filter(Boolean)
  }, [teamAssignments, memberById, taskCountByMember])

  const filtered = useMemo(() => {
    let result = resolvedMembers
    const s = search.trim().toLowerCase()
    if (s) result = result.filter(r =>
      r.name.toLowerCase().includes(s) ||
      r.email.toLowerCase().includes(s) ||
      r.title.toLowerCase().includes(s) ||
      r.department.toLowerCase().includes(s)
    )
    for (const f of filters) {
      if (!f.field) continue
      result = result.filter(r => {
        const val = r[f.field]
        switch (f.op) {
          case 'is': return val === f.value
          case 'is_not': return val !== f.value
          case 'is_empty': return !val
          case 'is_not_empty': return !!val
          case 'contains': return (val || '').toLowerCase().includes((f.value || '').toLowerCase())
          case 'not_contains': return !(val || '').toLowerCase().includes((f.value || '').toLowerCase())
          default: return true
        }
      })
    }
    return result
  }, [resolvedMembers, search, filters])

  const sorted = useMemo(() => {
    if (!sortField) return filtered
    const list = [...filtered]
    const dir = sortDir === 'desc' ? -1 : 1
    list.sort((a, b) => {
      let va, vb
      if (sortField === 'tasks') {
        va = a.taskCount; vb = b.taskCount
      } else if (sortField === 'role') {
        va = TEAM_ROLES.indexOf(a.role); vb = TEAM_ROLES.indexOf(b.role)
      } else {
        va = (a[sortField] || '').toLowerCase(); vb = (b[sortField] || '').toLowerCase()
      }
      if (va < vb) return -1 * dir
      if (va > vb) return 1 * dir
      return 0
    })
    return list
  }, [filtered, sortField, sortDir])

  const groups = useMemo(() => {
    if (!groupBy) return null
    const map = {}
    for (const r of sorted) {
      const key = r[groupBy] || '__none__'
      if (!map[key]) map[key] = []
      map[key].push(r)
    }
    let orderedKeys
    if (groupBy === 'role') orderedKeys = TEAM_ROLES.filter(k => map[k])
    else if (groupBy === 'employment_type') orderedKeys = EMPLOYMENT_TYPES.filter(k => map[k])
    else orderedKeys = Object.keys(map).sort()
    if (map.__none__ && !orderedKeys.includes('__none__')) orderedKeys.push('__none__')
    return orderedKeys.map(key => ({
      key,
      label: key === '__none__' ? 'Unassigned' : fmt(key),
      members: map[key] || [],
    }))
  }, [sorted, groupBy])

  const processed = groups ? groups.flatMap(g => g.members) : sorted

  // Open picker — refresh the member list first so it's fresh
  const openPicker = useCallback(() => {
    tm.reload()
    setShowPicker(true)
  }, [tm])

  // ── CRUD: filters & saved views ──

  function addFilter() { setFilters(prev => [...prev, { field: 'role', op: 'is', value: '' }]) }
  function updateFilter(idx, patch) { setFilters(prev => prev.map((f, i) => i === idx ? { ...f, ...patch } : f)) }
  function removeFilter(idx) { setFilters(prev => prev.filter((_, i) => i !== idx)) }

  function toggleGroup(key) {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function saveCurrentView() {
    if (!saveName.trim()) return
    const view = { id: Date.now().toString(), name: saveName.trim(), filters, sortField, sortDir, groupBy }
    const next = [...savedViews, view]
    setSavedViews(next)
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next))
    setSaveName('')
    setShowSaveDialog(false)
  }
  function loadView(view) {
    setFilters(view.filters || [])
    setSortField(view.sortField || '')
    setSortDir(view.sortDir || 'asc')
    setGroupBy(view.groupBy || '')
  }
  function deleteSavedView(id) {
    const next = savedViews.filter(v => v.id !== id)
    setSavedViews(next)
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next))
  }

  // ── Assignment CRUD ──

  async function handleAssignMultiple(memberIds) {
    if (!ctx?.addTeamAssignment) return
    for (const memberId of memberIds) {
      try {
        await ctx.addTeamAssignment({ member_id: memberId, role: 'member' })
      } catch (err) {
        console.error('[TeamView] assign failed:', err)
      }
    }
    setShowPicker(false)
  }

  async function handleRemove(assignmentId) {
    if (!ctx?.removeTeamAssignment) return
    try {
      await ctx.removeTeamAssignment(assignmentId)
    } catch (err) {
      console.error('[TeamView] remove failed:', err)
    }
  }

  async function handleRoleChange(assignmentId, role) {
    if (!ctx?.updateTeamAssignment) return
    try {
      await ctx.updateTeamAssignment(assignmentId, { role })
    } catch (err) {
      console.error('[TeamView] role change failed:', err)
    }
  }

  async function handleDateChange(assignmentId, field, value) {
    if (!ctx?.updateTeamAssignment) return
    try {
      await ctx.updateTeamAssignment(assignmentId, { [field]: value || null })
    } catch (err) {
      console.error('[TeamView] date change failed:', err)
    }
  }

  // ── Row renderer ──

  function renderMemberRow(r) {
    const member = r.member
    const roleColor = ROLE_COLORS[r.role] || ROLE_COLORS.member
    return (
      <tr key={r.id} className="hover:!bg-stone-800 transition-colors" style={{ borderBottom: '1px solid #44403c', backgroundColor: '#1c1917' }}>
        <Td>
          <div className="flex items-center gap-2">
            <MemberAvatar member={member} size={24} />
            <span className="text-xs font-mono" style={{ color: '#d6d3d1' }}>
              {member.name || 'Unnamed'}
            </span>
          </div>
        </Td>
        <Td>
          <span className="text-[11.5px] font-mono" style={{ color: '#a8a29e' }}>
            {member.title || '--'}
          </span>
        </Td>
        <Td>
          <span className="text-[11.5px] font-mono" style={{ color: '#a8a29e' }}>
            {member.department || '--'}
          </span>
        </Td>
        <Td>
          <span className="text-[10.5px] font-mono px-1.5 py-0.5 rounded-sm" style={{
            color: member.employment_type === 'freelancer' ? '#fbbf24' : '#86efac',
            backgroundColor: member.employment_type === 'freelancer' ? '#1c1917' : '#1c1917',
            border: `1px solid ${member.employment_type === 'freelancer' ? '#78350f' : '#14532d'}`,
          }}>
            {member.employment_type === 'freelancer' ? 'Freelancer' : 'Full-Time'}
          </span>
        </Td>
        <Td>
          <select
            value={r.role || 'member'}
            onChange={(e) => handleRoleChange(r.id, e.target.value)}
            className="px-1.5 py-0.5 text-[11.5px] font-mono rounded-sm focus:ring-2 focus:ring-orange-500 cursor-pointer"
            style={{
              backgroundColor: roleColor.bg,
              color: roleColor.fg,
              border: `1px solid ${roleColor.border}`,
            }}
          >
            <option value="member">Member</option>
            <option value="manager">Manager</option>
            <option value="reviewer">Reviewer</option>
          </select>
        </Td>
        <Td>
          <span className="text-[11.5px] font-mono" style={{ color: '#a8a29e' }}>
            {r.taskCount}
          </span>
        </Td>
        <Td>
          <input
            type="date"
            value={r.start_date || ''}
            onChange={(e) => handleDateChange(r.id, 'start_date', e.target.value)}
            className="text-[11.5px] font-mono px-1.5 py-0.5 rounded-sm focus:ring-2 focus:ring-orange-500"
            style={{
              backgroundColor: '#1c1917',
              color: r.start_date ? '#a8a29e' : '#57534e',
              border: '1px solid #44403c',
              colorScheme: 'dark',
            }}
          />
        </Td>
        <Td>
          <input
            type="date"
            value={r.end_date || ''}
            onChange={(e) => handleDateChange(r.id, 'end_date', e.target.value)}
            className="text-[11.5px] font-mono px-1.5 py-0.5 rounded-sm focus:ring-2 focus:ring-orange-500"
            style={{
              backgroundColor: '#1c1917',
              color: r.end_date ? '#a8a29e' : '#57534e',
              border: '1px solid #44403c',
              colorScheme: 'dark',
            }}
          />
        </Td>
        <Td>
          <span className="text-[11.5px] font-mono" style={{ color: '#78716c' }}>
            {member.email || '--'}
          </span>
        </Td>
        <Td>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Remove "${member.name}" from this project?`)) {
                handleRemove(r.id)
              }
            }}
            className="p-1 rounded-sm hover:bg-stone-700 transition-colors"
            title="Remove from project"
            style={{ color: '#fca5a5' }}
          >
            <UserMinus className="w-3.5 h-3.5" />
          </button>
        </Td>
      </tr>
    )
  }

  if (!project) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: '#1c1917' }}>
        <span className="text-[11.5px] font-mono uppercase tracking-wider" style={{ color: '#a8a29e' }}>
          No project loaded
        </span>
      </div>
    )
  }

  // ── Cloud branch (Session 6) ──
  // Supabase mode staffs projects through project_members (0013), not the
  // legacy team_assignments JSON. Everything below this return is the
  // local/drive UI, kept exactly as it was.
  if (cloudMode) {
    return <ProjectMembersPanel ctx={ctx} />
  }

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: '#1c1917' }}>
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 px-4 py-2 flex-wrap flex-shrink-0" style={{ borderBottom: '1px solid #44403c' }}>
        {/* Filter */}
        <button type="button" onClick={() => setShowFilterPanel(!showFilterPanel)}
          className="flex items-center gap-1.5 px-2 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm hover:bg-stone-700 transition-colors"
          style={{ color: filters.length > 0 ? '#fb923c' : '#78716c', border: '1px solid #44403c' }}>
          <Filter className="w-3 h-3" />
          Filter{filters.length > 0 ? ` (${filters.length})` : ''}
        </button>

        {/* Sort */}
        <div className="flex items-center gap-1">
          <select value={sortField} onChange={e => setSortField(e.target.value)}
            className="px-2 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm cursor-pointer"
            style={{ backgroundColor: '#292524', color: sortField ? '#fb923c' : '#78716c', border: '1px solid #44403c' }}>
            <option value="">Sort…</option>
            {TEAM_SORTABLE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          {sortField && (
            <button type="button" onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
              className="p-1.5 rounded-sm hover:bg-stone-700 transition-colors"
              style={{ color: '#fb923c' }}>
              <ArrowUpDown className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div style={{ width: 1, height: 16, backgroundColor: '#292524' }} />

        {/* Group */}
        <select value={groupBy} onChange={e => setGroupBy(e.target.value)}
          className="px-2 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm cursor-pointer"
          style={{ backgroundColor: '#292524', color: groupBy ? '#fb923c' : '#78716c', border: '1px solid #44403c' }}>
          {TEAM_GROUPABLE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>

        <div style={{ width: 1, height: 16, backgroundColor: '#292524' }} />

        {/* Saved views */}
        <TeamSavedViewsDropdown views={savedViews} onLoad={loadView} onDelete={deleteSavedView} onSaveRequest={() => setShowSaveDialog(true)} />

        <div style={{ width: 1, height: 16, backgroundColor: '#292524' }} />

        {/* Search */}
        <div className="flex items-center flex-1 min-w-[120px] max-w-[240px] rounded-sm" style={{ border: '1px solid #44403c', backgroundColor: '#292524' }}>
          <Search className="w-3 h-3 ml-2 flex-shrink-0" style={{ color: '#57534e' }} />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search members…"
            className="flex-1 px-2 py-1.5 text-[10.5px] font-mono bg-transparent"
            style={{ color: '#d6d3d1' }} />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="p-1 mr-0.5 hover:bg-stone-700 rounded transition-colors" style={{ color: '#78716c' }}>
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Right: count + assign button */}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-[10.5px] font-mono uppercase tracking-wider" style={{ color: '#a8a29e' }}>
            {processed.length}/{teamAssignments.length} member{teamAssignments.length === 1 ? '' : 's'}
          </span>
          <button type="button" onClick={openPicker}
            className="flex items-center gap-1 px-3 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded-sm"
            style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}>
            <UserPlus className="w-3 h-3" /> Assign Members
          </button>
        </div>
      </div>

      {/* ── Filter panel ── */}
      {showFilterPanel && (
        <TeamFilterPanel filters={filters} onAdd={addFilter} onUpdate={updateFilter} onRemove={removeFilter} onClose={() => setShowFilterPanel(false)} />
      )}

      {/* ── Body ── */}
      <div className="flex-1 overflow-auto">
        {teamAssignments.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3">
            <Users className="w-8 h-8" style={{ color: '#57534e' }} />
            <span className="text-[11.5px] font-mono italic" style={{ color: '#78716c' }}>
              No team members assigned to this project yet.
            </span>
          </div>
        ) : (
          <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: '0 2px' }}>
            <thead className="sticky top-0 z-10">
              <tr style={{ borderBottom: '1px solid #44403c' }}>
                <Th>Name</Th>
                <Th>Title</Th>
                <Th>Department</Th>
                <Th>Type</Th>
                <Th>Role</Th>
                <Th>Tasks</Th>
                <Th>Start</Th>
                <Th>End</Th>
                <Th>Email</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {groups ? (
                groups.map(g => (
                  <React.Fragment key={g.key}>
                    <tr>
                      <td colSpan={10}>
                        <div className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-stone-800/30 transition-colors"
                          onClick={() => toggleGroup(g.key)}
                          style={{ borderBottom: '1px solid #292524' }}>
                          {collapsedGroups.has(g.key) ? <ChevronRight className="w-3 h-3" style={{ color: '#78716c' }} /> : <ChevronDown className="w-3 h-3" style={{ color: '#78716c' }} />}
                          <span className="text-[11.5px] font-mono font-bold uppercase tracking-wider" style={{ color: '#fb923c' }}>{g.label}</span>
                          <span className="text-[9.5px] font-mono" style={{ color: '#57534e' }}>{g.members.length}</span>
                        </div>
                      </td>
                    </tr>
                    {!collapsedGroups.has(g.key) && g.members.map(r => renderMemberRow(r))}
                  </React.Fragment>
                ))
              ) : (
                sorted.map(r => renderMemberRow(r))
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Save view dialog ── */}
      {showSaveDialog && (
        <>
          <div className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={() => setShowSaveDialog(false)} />
          <div className="fixed z-50 top-1/2 left-1/2 rounded-sm overflow-hidden" style={{ transform: 'translate(-50%, -50%)', backgroundColor: '#292524', border: '1px solid #44403c', padding: 24, minWidth: 300 }}>
            <div className="text-[11.5px] font-mono uppercase tracking-wider mb-3" style={{ color: '#fb923c' }}>Save current view</div>
            <input autoFocus value={saveName} onChange={e => setSaveName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveCurrentView() }}
              placeholder="View name…"
              className="w-full px-3 py-2 text-[11.5px] font-mono rounded-sm focus:ring-2 focus:ring-orange-500 mb-3"
              style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c' }} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowSaveDialog(false)}
                className="px-3 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm hover:bg-stone-700 transition-colors"
                style={{ color: '#a8a29e', border: '1px solid #44403c' }}>Cancel</button>
              <button type="button" onClick={saveCurrentView}
                className="px-3 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm transition-colors"
                style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}>Save</button>
            </div>
          </div>
        </>
      )}

      {/* ── Member picker modal ── */}
      {showPicker && (
        <MemberPickerModal
          members={availableMembers}
          loading={tm.loading}
          onConfirm={handleAssignMultiple}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  )
}

// ─── Cloud roster panel (Supabase project_members, Session 6) ───
//
// One card = the whole roster (common region). The add-member picker sits
// first in the card (serial position), each row groups avatar + name +
// username + title tight on the left (proximity), the role select carries
// a one-line description of the selected role (exactly 3 choices, default
// 'member'), and remove is a subdued icon at the far right, well away from
// the select (Fitts). Mutations go through the provider's optimistic
// project-member API; the DB (0013 RLS) is the real gate — canOnProject()
// here is presentation only. Non-managers get the read-only list.

const PROJECT_ROLE_OPTIONS = [
  { value: 'member',   label: 'Member',   desc: 'Edits project content' },
  { value: 'manager',  label: 'Manager',  desc: 'Edits everything and manages this roster' },
  { value: 'reviewer', label: 'Reviewer', desc: 'Read-only, can comment' },
]
const PROJECT_ROLE_RANK = { manager: 0, member: 1, reviewer: 2 }

function ProjectMembersPanel({ ctx }) {
  const perms = usePermissions()
  const dir = useWorkspaceMembers()
  const [search, setSearch] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef(null)

  const projectMembers = ctx?.projectMembers || []
  // 🚨 Session 29 added `ready`. `project.roster.manage` has no unstaffed
  // opening and admits ONLY a project manager, so without it this panel drops
  // to the read-only list for a real manager until their session resolves —
  // and permanently if getSession() hangs. Same omission as
  // DashboardTasksView and TaskDetailPopup; all three were found by
  // writeGate.test.js rather than by anyone hitting them.
  const canManage = canOnProject({
    appRole:     perms.role,
    projectRole: ctx?.myProjectRole,
    isStaffed:   ctx?.projectIsStaffed,
    ready:       perms.ready,
  }, 'project.roster.manage')

  // user_id → directory row (display_name / username / title / avatar)
  const dirById = useMemo(() => {
    const map = {}
    for (const m of dir.members) map[m.user_id] = m
    return map
  }, [dir.members])

  const seatedIds = useMemo(
    () => new Set(projectMembers.map(pm => pm.user_id)),
    [projectMembers],
  )

  // Active directory members without a seat yet, narrowed by the search box.
  const available = useMemo(() => {
    const s = search.trim().toLowerCase()
    return dir.members.filter(m => {
      if (seatedIds.has(m.user_id) || m.is_active === false) return false
      if (!s) return true
      return (m.display_name || '').toLowerCase().includes(s)
        || (m.username || '').toLowerCase().includes(s)
        || (m.title || '').toLowerCase().includes(s)
    })
  }, [dir.members, seatedIds, search])

  // Managers first, then members, then reviewers; name within each.
  const seated = useMemo(() => {
    return [...projectMembers].sort((a, b) => {
      const ra = PROJECT_ROLE_RANK[a.project_role] ?? 9
      const rb = PROJECT_ROLE_RANK[b.project_role] ?? 9
      if (ra !== rb) return ra - rb
      const na = (dirById[a.user_id]?.display_name || dirById[a.user_id]?.username || '').toLowerCase()
      const nb = (dirById[b.user_id]?.display_name || dirById[b.user_id]?.username || '').toLowerCase()
      return na.localeCompare(nb)
    })
  }, [projectMembers, dirById])

  // Close the picker dropdown on outside click (same pattern as the saved
  // views dropdown below).
  useEffect(() => {
    if (!pickerOpen) return
    function handleClick(e) {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [pickerOpen])

  async function handleAdd(userId) {
    if (!ctx?.addProjectMember) return
    setSearch('')
    setPickerOpen(false)
    try {
      await ctx.addProjectMember(userId, 'member')
    } catch (err) {
      console.error('[TeamView] add project member failed:', err)
    }
  }

  async function handleSeatRoleChange(userId, role) {
    if (!ctx?.updateProjectMemberRole) return
    try {
      await ctx.updateProjectMemberRole(userId, role)
    } catch (err) {
      console.error('[TeamView] project role change failed:', err)
    }
  }

  async function handleSeatRemove(userId, name) {
    if (!ctx?.removeProjectMember) return
    if (!window.confirm(`Remove "${name}" from this project's roster?`)) return
    try {
      await ctx.removeProjectMember(userId)
    } catch (err) {
      console.error('[TeamView] remove project member failed:', err)
    }
  }

  return (
    <div className="h-full overflow-auto" style={{ backgroundColor: '#1c1917' }}>
      <div className="max-w-2xl mx-auto px-6 py-6">
        {/* ── Roster card ── */}
        <div className="rounded-sm" style={{ backgroundColor: '#292524', border: '1px solid #44403c' }}>
          <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid #44403c' }}>
            <Users className="w-4 h-4 flex-shrink-0" style={{ color: '#fb923c' }} />
            <span className="text-xs font-mono uppercase tracking-wider font-bold" style={{ color: '#fb923c' }}>
              Project Roster
            </span>
            <span className="ml-auto text-[10.5px] font-mono" style={{ color: '#78716c' }}>
              {seated.length} seat{seated.length === 1 ? '' : 's'}
            </span>
          </div>

          {/* Add-member picker — first thing in the card */}
          {canManage && (
            <div ref={pickerRef} className="relative px-4 py-3" style={{ borderBottom: '1px solid #44403c' }}>
              <div className="flex items-center gap-2 px-2 rounded-sm" style={{ border: '1px solid #44403c', backgroundColor: '#1c1917' }}>
                <UserPlus className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#fb923c' }} />
                <input
                  type="text"
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPickerOpen(true) }}
                  onFocus={() => setPickerOpen(true)}
                  placeholder="Add member — search the workspace directory…"
                  className="flex-1 py-1.5 text-[11.5px] font-mono bg-transparent"
                  style={{ color: '#d6d3d1' }}
                />
              </div>
              {pickerOpen && (
                <div className="absolute left-4 right-4 mt-1 z-40 rounded-sm shadow-2xl overflow-y-auto"
                  style={{ backgroundColor: '#292524', border: '1px solid #44403c', maxHeight: 220 }}>
                  {dir.loading ? (
                    <div className="px-3 py-2 text-[10.5px] font-mono italic" style={{ color: '#57534e' }}>
                      Loading directory…
                    </div>
                  ) : available.length === 0 ? (
                    <div className="px-3 py-2 text-[10.5px] font-mono italic" style={{ color: '#57534e' }}>
                      {search.trim() ? 'No matches.' : 'Every active workspace member is already on the roster.'}
                    </div>
                  ) : (
                    available.map(m => (
                      <button
                        key={m.user_id}
                        type="button"
                        onClick={() => handleAdd(m.user_id)}
                        className="flex items-center gap-2.5 w-full px-3 py-2 text-left hover:bg-stone-700 transition-colors"
                        style={{ borderBottom: '1px solid #1c1917' }}
                      >
                        <MemberAvatar member={{ name: m.display_name || m.username }} size={24} />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-mono" style={{ color: '#d6d3d1' }}>
                            {m.display_name || m.username || 'Unnamed'}
                          </div>
                          <div className="text-[10.5px] font-mono truncate" style={{ color: '#78716c' }}>
                            {[m.username ? `@${m.username}` : null, m.title].filter(Boolean).join(' — ') || '--'}
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          {/* Seats (or the unstaffed explainer) */}
          {seated.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
              <Users className="w-6 h-6" style={{ color: '#57534e' }} />
              <span className="text-[11.5px] font-mono italic" style={{ color: '#78716c' }}>
                No roster yet — everyone in the workspace can edit this project. Add members to restrict it.
              </span>
            </div>
          ) : (
            seated.map(pm => {
              const m = dirById[pm.user_id]
              const name = m?.display_name || m?.username || 'Unknown member'
              const role = pm.project_role || 'member'
              const roleDef = PROJECT_ROLE_OPTIONS.find(o => o.value === role) || PROJECT_ROLE_OPTIONS[0]
              const roleColor = ROLE_COLORS[role] || ROLE_COLORS.member
              return (
                <div key={pm.user_id} className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid #1c1917' }}>
                  {/* identity cluster */}
                  <MemberAvatar member={{ name }} size={28} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-mono" style={{ color: '#d6d3d1' }}>{name}</div>
                    <div className="text-[10.5px] font-mono truncate" style={{ color: '#78716c' }}>
                      {[m?.username ? `@${m.username}` : null, m?.title].filter(Boolean).join(' — ') || '--'}
                    </div>
                  </div>
                  {/* role control (read-only badge for non-managers) */}
                  <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                    {canManage ? (
                      <select
                        value={role}
                        onChange={e => handleSeatRoleChange(pm.user_id, e.target.value)}
                        className="px-1.5 py-0.5 text-[11.5px] font-mono rounded-sm focus:ring-2 focus:ring-orange-500 cursor-pointer"
                        style={{ backgroundColor: roleColor.bg, color: roleColor.fg, border: `1px solid ${roleColor.border}` }}
                      >
                        {PROJECT_ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : (
                      <span className="px-1.5 py-0.5 text-[11.5px] font-mono rounded-sm"
                        style={{ backgroundColor: roleColor.bg, color: roleColor.fg, border: `1px solid ${roleColor.border}` }}>
                        {roleDef.label}
                      </span>
                    )}
                    <span className="text-[9.5px] font-mono" style={{ color: '#57534e' }}>{roleDef.desc}</span>
                  </div>
                  {/* remove — far right, clear of the role select */}
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => handleSeatRemove(pm.user_id, name)}
                      className="p-1 ml-3 rounded-sm hover:bg-stone-700 transition-colors flex-shrink-0"
                      title="Remove from roster"
                      style={{ color: '#57534e' }}
                    >
                      <UserMinus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )
            })
          )}
        </div>

        {dir.error && (
          <div className="mt-2 text-[10.5px] font-mono" style={{ color: '#fca5a5' }}>
            Directory unavailable: {dir.error}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Member picker modal (multi-select with checkboxes) ───
function MemberPickerModal({ members, loading, onConfirm, onClose }) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [assigning, setAssigning] = useState(false)

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return members
    return members.filter(m =>
      (m.name || '').toLowerCase().includes(s) ||
      (m.email || '').toLowerCase().includes(s) ||
      (m.department || '').toLowerCase().includes(s)
    )
  }, [members, search])

  function toggleMember(id) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(filtered.map(m => m.id)))
  }

  function selectNone() {
    setSelected(new Set())
  }

  async function handleConfirm() {
    if (selected.size === 0) return
    setAssigning(true)
    try {
      await onConfirm([...selected])
    } catch (err) {
      console.error('[MemberPicker] confirm failed:', err)
    } finally {
      setAssigning(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50"
        style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
        onClick={onClose}
      />
      {/* Modal */}
      <div
        className="fixed z-50 top-1/2 left-1/2 w-full max-w-md rounded-sm overflow-hidden flex flex-col"
        style={{
          transform: 'translate(-50%, -50%)',
          backgroundColor: '#292524',
          border: '1px solid #44403c',
          maxHeight: '70vh',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #44403c' }}>
          <span className="text-xs font-mono uppercase tracking-wider" style={{ color: '#fb923c' }}>
            Assign Team Members
          </span>
          <button type="button" onClick={onClose} className="p-1 hover:bg-stone-700 rounded-sm" style={{ color: '#a8a29e' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2 flex items-center gap-2" style={{ borderBottom: '1px solid #44403c' }}>
          <input
            autoFocus
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or department..."
            className="flex-1 px-2 py-1.5 text-xs font-mono rounded-sm focus:ring-2 focus:ring-orange-500"
            style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
          />
          {filtered.length > 0 && (
            <button
              type="button"
              onClick={selected.size === filtered.length ? selectNone : selectAll}
              className="text-[10.5px] font-mono uppercase tracking-wider px-2 py-1 rounded-sm hover:bg-stone-700 transition-colors whitespace-nowrap"
              style={{ color: '#a8a29e' }}
            >
              {selected.size === filtered.length ? 'None' : 'All'}
            </button>
          )}
        </div>

        {/* List */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <span className="text-[11.5px] font-mono italic" style={{ color: '#78716c' }}>Loading members...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <Users className="w-6 h-6" style={{ color: '#57534e' }} />
              <span className="text-[11.5px] font-mono italic" style={{ color: '#78716c' }}>
                {members.length === 0 ? 'All members are already assigned, or none exist in the database.' : 'No matches.'}
              </span>
            </div>
          ) : (
            filtered.map(m => {
              const checked = selected.has(m.id)
              return (
                <label
                  key={m.id}
                  className="flex items-center gap-3 w-full px-4 py-2.5 cursor-pointer transition-colors"
                  style={{
                    borderBottom: '1px solid #1c1917',
                    backgroundColor: checked ? 'rgba(234, 88, 12, 0.12)' : 'transparent',
                  }}
                  onMouseEnter={(e) => { if (!checked) e.currentTarget.style.backgroundColor = '#44403c' }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = checked ? 'rgba(234, 88, 12, 0.12)' : 'transparent' }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleMember(m.id)}
                    className="accent-orange-600 w-4 h-4 flex-shrink-0 cursor-pointer"
                  />
                  <MemberAvatar member={m} size={28} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-mono" style={{ color: '#d6d3d1' }}>{m.name || 'Unnamed'}</div>
                    <div className="text-[10.5px] font-mono truncate" style={{ color: '#78716c' }}>
                      {[m.title, m.department].filter(Boolean).join(' \u2014 ') || '--'}
                    </div>
                  </div>
                  <span className="text-[10.5px] font-mono flex-shrink-0" style={{ color: '#78716c' }}>{m.email || ''}</span>
                </label>
              )
            })
          )}
        </div>

        {/* Footer with confirm button */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderTop: '1px solid #44403c', backgroundColor: '#1c1917' }}
        >
          <span className="text-[10.5px] font-mono" style={{ color: '#a8a29e' }}>
            {selected.size} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:bg-stone-700"
              style={{ color: '#a8a29e', border: '1px solid #44403c' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={selected.size === 0 || assigning}
              className="px-3 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                color: '#fff7ed',
                backgroundColor: '#ea580c',
                border: '1px solid #c2410c',
              }}
            >
              {assigning ? 'Adding...' : `Add ${selected.size || ''} Member${selected.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Member avatar (initials circle) ───
function MemberAvatar({ member, size = 24 }) {
  const initials = (member?.name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() || '')
    .join('')
  return (
    <div
      className="flex items-center justify-center rounded-full flex-shrink-0"
      style={{
        width: size,
        height: size,
        backgroundColor: '#44403c',
        color: '#d6d3d1',
        fontSize: Math.max(8, size * 0.38),
        fontFamily: 'monospace',
        fontWeight: 'bold',
      }}
    >
      {initials}
    </div>
  )
}

// ─── Table atoms (dark theme) ───
function Th({ children }) {
  return (
    <th className="px-4 py-2.5 text-[10.5px] font-mono uppercase tracking-widest text-left" style={{ color: '#78716c', borderBottom: '1px solid #44403c' }}>
      {children}
    </th>
  )
}
function Td({ children }) {
  return <td className="px-4 py-2.5 align-middle">{children}</td>
}

// ─── Filter panel ───
function TeamFilterPanel({ filters, onAdd, onUpdate, onRemove, onClose }) {
  function getOptions(f) {
    const def = TEAM_FILTER_FIELDS.find(ff => ff.value === f.field)
    if (!def) return []
    return (def.options || []).map(o => ({ value: o, label: fmt(o) }))
  }
  function getType(f) {
    return TEAM_FILTER_FIELDS.find(ff => ff.value === f.field)?.type || 'text'
  }
  return (
    <div className="px-4 py-2.5 flex flex-col gap-2 flex-shrink-0" style={{ borderBottom: '1px solid #44403c', backgroundColor: '#1c1917' }}>
      {filters.map((f, i) => {
        const type = getType(f)
        const ops = FILTER_OPS[type] || FILTER_OPS.text
        const needsValue = !['is_empty','is_not_empty'].includes(f.op)
        return (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[9.5px] font-mono uppercase font-semibold" style={{ color: '#78716c', width: 40 }}>
              {i === 0 ? 'Where' : 'And'}
            </span>
            <select value={f.field} onChange={e => onUpdate(i, { field: e.target.value, value: '' })}
              className="px-2 py-1.5 text-[10.5px] font-mono rounded-sm focus:ring-1 focus:ring-orange-500"
              style={{ backgroundColor: '#292524', color: '#d6d3d1', border: '1px solid #44403c' }}>
              {TEAM_FILTER_FIELDS.map(ff => <option key={ff.value} value={ff.value}>{ff.label}</option>)}
            </select>
            <select value={f.op} onChange={e => onUpdate(i, { op: e.target.value })}
              className="px-2 py-1.5 text-[10.5px] font-mono rounded-sm focus:ring-1 focus:ring-orange-500"
              style={{ backgroundColor: '#292524', color: '#d6d3d1', border: '1px solid #44403c' }}>
              {ops.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {needsValue && (
              type === 'select' ? (
                <select value={f.value} onChange={e => onUpdate(i, { value: e.target.value })}
                  className="px-2 py-1.5 text-[10.5px] font-mono rounded-sm focus:ring-1 focus:ring-orange-500"
                  style={{ backgroundColor: '#292524', color: '#d6d3d1', border: '1px solid #44403c' }}>
                  <option value="">Select…</option>
                  {getOptions(f).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input type="text" value={f.value || ''} onChange={e => onUpdate(i, { value: e.target.value })}
                  className="px-2 py-1.5 text-[10.5px] font-mono rounded-sm focus:ring-1 focus:ring-orange-500 w-32"
                  style={{ backgroundColor: '#292524', color: '#d6d3d1', border: '1px solid #44403c' }}
                  placeholder="value…" />
              )
            )}
            <button type="button" onClick={() => onRemove(i)}
              className="p-1 rounded-sm hover:bg-stone-700 transition-colors" style={{ color: '#78716c' }}>
              <X className="w-3 h-3" />
            </button>
          </div>
        )
      })}
      <div className="flex items-center gap-2">
        <button type="button" onClick={onAdd}
          className="flex items-center gap-1 px-2.5 py-1 text-[10.5px] font-mono uppercase tracking-wider rounded-sm hover:bg-stone-700 transition-colors"
          style={{ color: '#fb923c', border: '1px solid #44403c' }}>
          <Plus className="w-3 h-3" /> Add filter
        </button>
        <button type="button" onClick={onClose}
          className="px-2.5 py-1 text-[10.5px] font-mono uppercase tracking-wider rounded-sm hover:bg-stone-700 transition-colors"
          style={{ color: '#78716c', border: '1px solid #44403c' }}>
          Done
        </button>
      </div>
    </div>
  )
}

// ─── Saved views dropdown ───
function TeamSavedViewsDropdown({ views, onLoad, onDelete, onSaveRequest }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="p-1.5 rounded-sm hover:bg-stone-700 transition-colors"
        style={{ color: views.length > 0 ? '#fb923c' : '#57534e' }}
        title="Saved views">
        <BookmarkPlus className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-40 rounded-sm shadow-2xl overflow-hidden"
          style={{ backgroundColor: '#292524', border: '1px solid #44403c', minWidth: 180, maxHeight: 240 }}>
          <div className="overflow-y-auto" style={{ maxHeight: 200 }}>
            {views.length === 0 ? (
              <div className="px-3 py-2 text-[10.5px] font-mono italic" style={{ color: '#57534e' }}>
                No saved views yet
              </div>
            ) : (
              views.map(v => (
                <div key={v.id}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-stone-700 transition-colors cursor-pointer"
                  style={{ borderBottom: '1px solid #1c1917' }}>
                  <span className="flex-1 text-[11.5px] font-mono truncate" style={{ color: '#d6d3d1' }}
                    onClick={() => { onLoad(v); setOpen(false) }}>
                    {v.name}
                  </span>
                  <button type="button" onClick={() => onDelete(v.id)}
                    className="p-0.5 rounded-sm hover:bg-stone-600 transition-colors" style={{ color: '#78716c' }}>
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>
          <button type="button" onClick={() => { onSaveRequest(); setOpen(false) }}
            className="w-full px-3 py-2 text-[10.5px] font-mono uppercase tracking-wider hover:bg-stone-700 transition-colors text-left"
            style={{ color: '#fb923c', borderTop: '1px solid #44403c' }}>
            <Save className="w-3 h-3 inline-block mr-1.5" /> Save current view
          </button>
        </div>
      )}
    </div>
  )
}
