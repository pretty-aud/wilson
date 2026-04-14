// ============================================================
// TeamMembersPage — workspace-level team member database
// ============================================================
//
// Accessible from the Resources sub-menu alongside Projects
// and Rate Card. Shows a table of all team members in the
// workspace with inline-editable fields.

import { useState, useMemo, useEffect } from 'react'
import {
  Users, Plus, Search, Trash2, X, ChevronDown,
} from 'lucide-react'
import { useTeamMembers, PRONOUN_OPTIONS, EMPLOYMENT_TYPES } from './useTeamMembers'

export default function TeamMembersPage() {
  const tm = useTeamMembers()
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [departments, setDepartments] = useState([])

  // Load departments from settings
  useEffect(() => {
    fetch('/api/otter-settings').then(r => r.json()).then(data => {
      if (data?.rabbit?.departments && Array.isArray(data.rabbit.departments)) {
        setDepartments(data.rabbit.departments)
      } else {
        setDepartments([
          'CG Art', 'Production', 'Creatives', 'Post', 'QA',
          'Audio', 'Physical Production', 'Development', 'Executive', 'Operations',
        ])
      }
    }).catch(() => {})
  }, [])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    return tm.members
      .filter(m => !deptFilter || m.department === deptFilter)
      .filter(m => !s || (m.name || '').toLowerCase().includes(s) || (m.email || '').toLowerCase().includes(s) || (m.title || '').toLowerCase().includes(s))
  }, [tm.members, search, deptFilter])

  // Unique departments in the member list + the configured departments
  const allDepts = useMemo(() => {
    const set = new Set(departments)
    for (const m of tm.members) {
      if (m.department) set.add(m.department)
    }
    return [...set].sort()
  }, [departments, tm.members])

  async function handleAdd() {
    await tm.addMember({ name: 'New Member' })
  }

  const inputStyle = {
    backgroundColor: 'rgba(120, 70, 30, 0.55)',
    color: '#fde8d0',
    border: 'none',
  }

  return (
    <div className="h-full flex flex-col" style={{ maxWidth: '960px', margin: '0 auto', width: '100%', padding: '2rem 2rem' }}>
      <div className="flex items-center gap-3 mb-6">
        <Users className="w-6 h-6" style={{ color: '#1c1917' }} />
        <h1 className="text-lg font-bold uppercase tracking-widest" style={{ color: '#1c1917' }}>
          Team Members
        </h1>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button
          type="button"
          onClick={handleAdd}
          className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors"
          style={{ backgroundColor: '#1c1917', color: '#f4a261' }}
        >
          <Plus className="w-3 h-3" /> Add Member
        </button>
        <select
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          className="px-2 py-1.5 text-[11px] font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500 cursor-pointer"
          style={inputStyle}
        >
          <option value="">All departments</option>
          {allDepts.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <div className="flex items-center gap-1 flex-1 max-w-xs">
          <Search className="w-3 h-3" style={{ color: '#78716c' }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search members..."
            className="flex-1 px-2 py-1.5 text-[11px] font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            style={inputStyle}
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="p-0.5" style={{ color: '#78716c' }}>
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <span className="text-[10px] font-mono uppercase tracking-wider ml-auto" style={{ color: '#78716c' }}>
          {filtered.length} member{filtered.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Table */}
      {tm.loading && !tm.members.length ? (
        <div className="flex items-center justify-center py-20">
          <span className="text-xs font-mono italic" style={{ color: '#78716c' }}>Loading...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Users className="w-8 h-8" style={{ color: '#a8a29e' }} />
          <span className="text-xs font-mono italic" style={{ color: '#78716c' }}>
            {tm.members.length === 0 ? 'No team members yet. Click "Add Member" to get started.' : 'No matches.'}
          </span>
        </div>
      ) : (
        <div className="overflow-auto flex-1 rounded-sm" style={{ border: '1px solid #d6d3d1' }}>
          <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr style={{ backgroundColor: '#e7e5e4' }}>
                <ThLight>Name</ThLight>
                <ThLight>Title</ThLight>
                <ThLight>Department</ThLight>
                <ThLight>Location</ThLight>
                <ThLight>Email</ThLight>
                <ThLight>Type</ThLight>
                <ThLight>Pronouns</ThLight>
                <ThLight />
              </tr>
            </thead>
            <tbody>
              {filtered.map(m => (
                <MemberRow
                  key={m.id}
                  member={m}
                  departments={allDepts}
                  onUpdate={(patch) => tm.updateMember(m.id, patch)}
                  onDelete={() => {
                    if (window.confirm(`Remove "${m.name}" from the team members database?`)) {
                      tm.deleteMember(m.id)
                    }
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tm.error && (
        <div className="mt-2 text-xs font-mono" style={{ color: '#dc2626' }}>
          {tm.error}
        </div>
      )}
    </div>
  )
}

// ─── Member row ───
function MemberRow({ member, departments, onUpdate, onDelete }) {
  return (
    <tr style={{ borderBottom: '1px solid #e7e5e4' }}>
      <TdLight>
        <InlineLightText value={member.name || ''} onCommit={(name) => onUpdate({ name })} placeholder="Name" />
      </TdLight>
      <TdLight>
        <InlineLightText value={member.title || ''} onCommit={(title) => onUpdate({ title })} placeholder="Title" />
      </TdLight>
      <TdLight>
        <InlineLightSelect
          value={member.department || ''}
          options={[{ value: '', label: '--' }, ...departments.map(d => ({ value: d, label: d }))]}
          onCommit={(department) => onUpdate({ department })}
        />
      </TdLight>
      <TdLight>
        <InlineLightText value={member.location || ''} onCommit={(location) => onUpdate({ location })} placeholder="Location" />
      </TdLight>
      <TdLight>
        <InlineLightText value={member.email || ''} onCommit={(email) => onUpdate({ email })} placeholder="email@..." />
      </TdLight>
      <TdLight>
        <InlineLightSelect
          value={member.employment_type || 'fulltime'}
          options={EMPLOYMENT_TYPES}
          onCommit={(employment_type) => onUpdate({ employment_type })}
        />
      </TdLight>
      <TdLight>
        <PronounPicker
          value={member.pronouns || []}
          onCommit={(pronouns) => onUpdate({ pronouns })}
        />
      </TdLight>
      <TdLight>
        <button
          type="button"
          onClick={onDelete}
          className="p-1 rounded-sm hover:bg-stone-200 transition-colors"
          title="Delete member"
          style={{ color: '#dc2626' }}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </TdLight>
    </tr>
  )
}

// ─── Pronoun multi-select ───
function PronounPicker({ value, onCommit }) {
  const [open, setOpen] = useState(false)
  const selected = new Set(value || [])
  function toggle(p) {
    const next = new Set(selected)
    if (next.has(p)) next.delete(p)
    else next.add(p)
    onCommit([...next])
  }
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-mono rounded-sm hover:bg-stone-200 transition-colors"
        style={{ color: '#1c1917' }}
      >
        {value?.length ? value.join('/') : '--'}
        <ChevronDown className="w-3 h-3" style={{ color: '#78716c' }} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute z-50 top-full left-0 mt-1 py-1 rounded-sm shadow-lg"
            style={{ backgroundColor: '#fff', border: '1px solid #d6d3d1', minWidth: '100px' }}
          >
            {PRONOUN_OPTIONS.map(p => (
              <label key={p} className="flex items-center gap-2 px-3 py-1 text-[11px] font-mono hover:bg-stone-100 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(p)}
                  onChange={() => toggle(p)}
                  className="accent-orange-600"
                />
                {p}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Light-themed table atoms (for settings pages) ───
function ThLight({ children }) {
  return (
    <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-left" style={{ color: '#57534e' }}>
      {children}
    </th>
  )
}
function TdLight({ children }) {
  return <td className="px-3 py-2 align-middle">{children}</td>
}

function InlineLightText({ value, onCommit, placeholder }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  function commit() {
    setEditing(false)
    if (draft !== value) onCommit(draft)
  }
  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
        className="w-full px-1 py-0.5 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
        style={{ backgroundColor: 'rgba(120, 70, 30, 0.35)', color: '#1c1917', border: '1px solid #d6d3d1' }}
      />
    )
  }
  return (
    <button
      type="button"
      onClick={() => { setDraft(value); setEditing(true) }}
      className="text-xs font-mono text-left w-full truncate hover:bg-stone-200 px-1 py-0.5 rounded-sm transition-colors"
      style={{ color: value ? '#1c1917' : '#a8a29e' }}
    >
      {value || placeholder || '--'}
    </button>
  )
}

function InlineLightSelect({ value, options, onCommit }) {
  const opts = options.map(o => typeof o === 'string' ? { value: o, label: o } : o)
  return (
    <select
      value={value}
      onChange={(e) => onCommit(e.target.value)}
      className="px-1.5 py-0.5 text-[11px] font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500 cursor-pointer"
      style={{ backgroundColor: 'transparent', color: '#1c1917', border: '1px solid #d6d3d1' }}
    >
      {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}
