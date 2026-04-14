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
//
// Only members assigned to this project can be selected as
// task assignees or reviewers in the Timeline and Assets views.

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Users, UserPlus, UserMinus, X,
} from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
import { useTeamMembers } from '../../../components/TeamMembers/useTeamMembers'

const ROLE_COLORS = {
  member:   { fg: '#d6d3d1', bg: '#1c1917', border: '#44403c' },
  manager:  { fg: '#fbbf24', bg: '#1c1917', border: '#78350f' },
  reviewer: { fg: '#a78bfa', bg: '#1c1917', border: '#4c1d95' },
}

export default function TeamView() {
  const ctx = useRabbit()
  const tm = useTeamMembers()
  const [showPicker, setShowPicker] = useState(false)

  const project = ctx?.project
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

  // Open picker — refresh the member list first so it's fresh
  const openPicker = useCallback(() => {
    tm.reload()
    setShowPicker(true)
  }, [tm])

  // Assign multiple members at once
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

  if (!project) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: '#1c1917' }}>
        <span className="text-[11px] font-mono uppercase tracking-wider" style={{ color: '#a8a29e' }}>
          No project loaded
        </span>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: '#1c1917' }}>
      {/* Toolbar */}
      <div
        className="flex items-center gap-2 px-6 py-3"
        style={{ borderBottom: '1px solid #44403c', backgroundColor: '#292524' }}
      >
        <button
          type="button"
          onClick={openPicker}
          className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-sm"
          style={{
            color: '#fff7ed',
            backgroundColor: '#ea580c',
            border: '1px solid #c2410c',
          }}
        >
          <UserPlus className="w-3 h-3" /> Assign Members
        </button>
        <span className="text-[10px] font-mono uppercase tracking-wider ml-auto" style={{ color: '#a8a29e' }}>
          {teamAssignments.length} member{teamAssignments.length === 1 ? '' : 's'} assigned
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {teamAssignments.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3">
            <Users className="w-8 h-8" style={{ color: '#57534e' }} />
            <span className="text-[11px] font-mono italic" style={{ color: '#78716c' }}>
              No team members assigned to this project yet.
            </span>
          </div>
        ) : (
          <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead className="sticky top-0 z-10">
              <tr style={{ backgroundColor: '#44403c' }}>
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
              {teamAssignments.map(assignment => {
                const member = memberById[assignment.member_id]
                if (!member) return null
                const roleColor = ROLE_COLORS[assignment.role] || ROLE_COLORS.member
                return (
                  <tr key={assignment.id} style={{ borderBottom: '1px solid #1c1917', backgroundColor: '#292524' }}>
                    <Td>
                      <div className="flex items-center gap-2">
                        <MemberAvatar member={member} size={24} />
                        <span className="text-xs font-mono" style={{ color: '#d6d3d1' }}>
                          {member.name || 'Unnamed'}
                        </span>
                      </div>
                    </Td>
                    <Td>
                      <span className="text-[11px] font-mono" style={{ color: '#a8a29e' }}>
                        {member.title || '--'}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-[11px] font-mono" style={{ color: '#a8a29e' }}>
                        {member.department || '--'}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm" style={{
                        color: member.employment_type === 'freelancer' ? '#fbbf24' : '#86efac',
                        backgroundColor: member.employment_type === 'freelancer' ? '#1c1917' : '#1c1917',
                        border: `1px solid ${member.employment_type === 'freelancer' ? '#78350f' : '#14532d'}`,
                      }}>
                        {member.employment_type === 'freelancer' ? 'Freelancer' : 'Full-Time'}
                      </span>
                    </Td>
                    <Td>
                      <select
                        value={assignment.role || 'member'}
                        onChange={(e) => handleRoleChange(assignment.id, e.target.value)}
                        className="px-1.5 py-0.5 text-[11px] font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500 cursor-pointer"
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
                      <span className="text-[11px] font-mono" style={{ color: '#a8a29e' }}>
                        {taskCountByMember[member.id] || 0}
                      </span>
                    </Td>
                    <Td>
                      <input
                        type="date"
                        value={assignment.start_date || ''}
                        onChange={(e) => handleDateChange(assignment.id, 'start_date', e.target.value)}
                        className="text-[11px] font-mono px-1.5 py-0.5 rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                        style={{
                          backgroundColor: '#1c1917',
                          color: assignment.start_date ? '#a8a29e' : '#57534e',
                          border: '1px solid #44403c',
                          colorScheme: 'dark',
                        }}
                      />
                    </Td>
                    <Td>
                      <input
                        type="date"
                        value={assignment.end_date || ''}
                        onChange={(e) => handleDateChange(assignment.id, 'end_date', e.target.value)}
                        className="text-[11px] font-mono px-1.5 py-0.5 rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                        style={{
                          backgroundColor: '#1c1917',
                          color: assignment.end_date ? '#a8a29e' : '#57534e',
                          border: '1px solid #44403c',
                          colorScheme: 'dark',
                        }}
                      />
                    </Td>
                    <Td>
                      <span className="text-[11px] font-mono" style={{ color: '#78716c' }}>
                        {member.email || '--'}
                      </span>
                    </Td>
                    <Td>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Remove "${member.name}" from this project?`)) {
                            handleRemove(assignment.id)
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
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Member picker modal */}
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
            className="flex-1 px-2 py-1.5 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
          />
          {filtered.length > 0 && (
            <button
              type="button"
              onClick={selected.size === filtered.length ? selectNone : selectAll}
              className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-sm hover:bg-stone-700 transition-colors whitespace-nowrap"
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
              <span className="text-[11px] font-mono italic" style={{ color: '#78716c' }}>Loading members...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <Users className="w-6 h-6" style={{ color: '#57534e' }} />
              <span className="text-[11px] font-mono italic" style={{ color: '#78716c' }}>
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
                    <div className="text-[10px] font-mono truncate" style={{ color: '#78716c' }}>
                      {[m.title, m.department].filter(Boolean).join(' \u2014 ') || '--'}
                    </div>
                  </div>
                  <span className="text-[10px] font-mono flex-shrink-0" style={{ color: '#78716c' }}>{m.email || ''}</span>
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
          <span className="text-[10px] font-mono" style={{ color: '#a8a29e' }}>
            {selected.size} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:bg-stone-700"
              style={{ color: '#a8a29e', border: '1px solid #44403c' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={selected.size === 0 || assigning}
              className="px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
    <th className="px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-left" style={{ color: '#fb923c' }}>
      {children}
    </th>
  )
}
function Td({ children }) {
  return <td className="px-3 py-2 align-middle">{children}</td>
}
