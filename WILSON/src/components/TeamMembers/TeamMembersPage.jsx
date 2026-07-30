// ============================================================
// TeamMembersPage — workspace membership, single source of truth
// ============================================================
//
// Session 4: reads Supabase `workspace_members` via useWorkspaceMembers
// (workspace_directory RPC), NOT the RABBIT team_members entity. Members
// join via Invite (invite-member Edge Function); the old local "Add Member"
// path is gone. RABBIT's own team_members JSON entity keeps serving the
// RABBIT views until Session 6 unifies project assignment.
//
// Three saved views (Admin / Manager / User) control column visibility.
// You can only open views at or below your own role — switching down
// previews what that role sees. Rate-card columns exist only in the Admin
// view and are additionally gated by rate_card.view / rate_card.edit.
// All edits are enforced DB-side (RLS + the 0010 guard trigger); the UI
// checks are presentation only.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Users, Search, Trash2, X, UserPlus, Eye, RotateCcw,
} from 'lucide-react'
import { useWorkspaceMembers, isOwnAvatarUrl } from './useWorkspaceMembers'
import { useRateCard, computeEntryTotal } from '../RateCard/useRateCard'
import { useRateCardAccess } from '../RateCard/useRateCardAccess'
import { atLeast } from '../../permissions/roleMatrix'
import PermissionGate from '../../permissions/PermissionGate'
import InviteMemberDialog from '../../cloud/auth/InviteMemberDialog'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'
import { supabase } from '../../cloud/auth/supabaseClient'
import { adminSetActive, isMissingFunction } from '../../cloud/adminApi'
import { loadOtterSettings } from '../../lib/localData'

const VIEW_STORAGE_KEY = 'wilson.team-members.view'
const VIEWS = [
  { key: 'admin',   label: 'Admin' },
  { key: 'manager', label: 'Manager' },
  { key: 'user',    label: 'User' },
]
const ROLE_LABELS = { admin: 'Admin', manager: 'Manager', user: 'User' }

const DEFAULT_DEPARTMENTS = [
  'CG Art', 'Production', 'Creatives', 'Post', 'QA',
  'Audio', 'Physical Production', 'Development', 'Executive', 'Operations',
]


function formatMoney(value, currency) {
  if (value == null || value === '' || Number.isNaN(Number(value))) return null
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0,
    }).format(Number(value))
  } catch {
    return `$${Number(value)}`
  }
}

export default function TeamMembersPage() {
  const wm = useWorkspaceMembers()
  const rc = useRateCard()

  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [departments, setDepartments] = useState([])
  const [inviteOpen, setInviteOpen] = useState(false)
  const [rateModal, setRateModal] = useState(null) // { member, entry } | null
  const [view, setView] = useState(() => {
    try { return localStorage.getItem(VIEW_STORAGE_KEY) || '' } catch { return '' }
  })

  // Load departments from settings (same source the RABBIT views use).
  // localData: Express in Electron, localStorage on the web (Session 12).
  useEffect(() => {
    loadOtterSettings().then(data => {
      if (data?.rabbit?.departments && Array.isArray(data.rabbit.departments)) {
        setDepartments(data.rabbit.departments)
      } else {
        setDepartments(DEFAULT_DEPARTMENTS)
      }
    }).catch(() => setDepartments(DEFAULT_DEPARTMENTS))
  }, [])

  // Session 9: workspace-channel liveness + grant-aware rate access.
  const rabbit = useRabbit()
  const subscribeWorkspaceEvents = rabbit?.subscribeWorkspaceEvents
  const rateAccess = useRateCardAccess(subscribeWorkspaceEvents)
  const [adminError, setAdminError] = useState(null)

  // Roster liveness (§6 gap #13): workspace_members events → debounced
  // reload. Refs keep the subscription stable across re-renders; RESYNC
  // closes the missed-events window after every channel (re)join.
  const wmReloadRef = useRef(wm.reload)
  useEffect(() => { wmReloadRef.current = wm.reload }, [wm.reload])
  useEffect(() => {
    if (typeof subscribeWorkspaceEvents !== 'function') return undefined
    let timer = null
    const unsub = subscribeWorkspaceEvents((evt) => {
      if (evt.op !== 'RESYNC' && evt.table !== 'workspace_members') return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { timer = null; wmReloadRef.current?.() }, 400)
    })
    return () => { if (timer) clearTimeout(timer); unsub() }
  }, [subscribeWorkspaceEvents])

  // Assigned-projects column (§10-E): project_members with embedded titles,
  // live off the same channel. Missing-table tolerance keeps pre-0013 envs
  // rendering the placeholder.
  const [assignments, setAssignments] = useState(() => new Map())
  const assignSeqRef = useRef(0)
  const assignMountedRef = useRef(true)
  useEffect(() => {
    assignMountedRef.current = true
    return () => { assignMountedRef.current = false }
  }, [])
  useEffect(() => {
    if (!wm.workspaceId) { setAssignments(new Map()); return }
    let timer = null
    const load = async () => {
      const seq = ++assignSeqRef.current
      try {
        const { data, error } = await supabase
          .from('project_members')
          .select('user_id, project_id, projects(title, deleted_at)')
          .eq('workspace_id', wm.workspaceId)
        if (!assignMountedRef.current || seq !== assignSeqRef.current) return
        if (error) { setAssignments(new Map()); return }
        const map = new Map()
        for (const row of data || []) {
          if (row.projects?.deleted_at) continue
          const list = map.get(row.user_id) || []
          list.push(row.projects?.title || 'Untitled')
          map.set(row.user_id, list)
        }
        setAssignments(map)
      } catch {
        if (assignMountedRef.current && seq === assignSeqRef.current) setAssignments(new Map())
      }
    }
    load()
    if (typeof subscribeWorkspaceEvents !== 'function') return undefined
    const unsub = subscribeWorkspaceEvents((evt) => {
      const relevant = evt.op === 'RESYNC'
        || evt.table === 'project_members' || evt.table === 'projects'
      if (!relevant) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { timer = null; load() }, 400)
    })
    return () => { if (timer) clearTimeout(timer); unsub() }
  }, [wm.workspaceId, subscribeWorkspaceEvents])

  // Producer / Creative-Director highlight (§10-B): both ids live on the
  // project rows, which the provider's projectsIndex keeps live-merged.
  const staffBadgesByUser = useMemo(() => {
    const idx = rabbit?.projectsIndex || {}
    const map = new Map()
    for (const p of Object.values(idx)) {
      if (!p || p.deleted_at) continue
      if (p.producer_id) {
        const s = map.get(p.producer_id) || new Set()
        s.add('PRODUCER'); map.set(p.producer_id, s)
      }
      if (p.director_id) {
        const s = map.get(p.director_id) || new Set()
        s.add('DIRECTOR'); map.set(p.director_id, s)
      }
    }
    return map
  }, [rabbit?.projectsIndex])

  // The rate columns read the INTERNAL rate card (per-member entries). The
  // hook instance is local to this page, so switching its active card does
  // not disturb the Rate Card page. The flip effect lives below the view
  // flags — it only runs when the rate columns are actually shown.
  const internalCard = rc.rateCards.find(c => c.type === 'internal') || null

  // ── Saved views ──
  // You can open your own role's view or preview any view below it.
  const availableViews = VIEWS.filter(v => atLeast(wm.role, v.key))
  const activeView = availableViews.some(v => v.key === view)
    ? view
    : (wm.role || 'user')
  function pickView(key) {
    setView(key)
    try { localStorage.setItem(VIEW_STORAGE_KEY, key) } catch { /* private mode */ }
  }

  // ── Column flags ──
  const isAdminView   = activeView === 'admin'
  const showEmail     = activeView !== 'user'
  const showStatus    = isAdminView
  // Session 9: rate access = role matrix OR per-user grants (live rows).
  const showRate      = isAdminView && rateAccess.canView
  const showActions   = isAdminView && wm.can('member.remove')
  // Title/department inline editing: admin + manager working views only.
  // The User view is strictly read-only (it previews what a user sees).
  const canEditProfile = activeView !== 'user' && wm.can('member.profile.edit_others')
  // Editing also requires the internal card to exist — writes land on
  // whatever card is active, and without the internal card they would hit
  // the General card (or vanish).
  const canEditRate    = showRate && rateAccess.canEdit && !!internalCard

  // Flip this page's rate-card hook to the INTERNAL card — gated on
  // showRate so non-admin clients never fetch per-person wage entries.
  useEffect(() => {
    if (showRate && internalCard && rc.activeRateCardId !== internalCard.id) {
      rc.setActiveRateCardId(internalCard.id)
    }
  }, [showRate, internalCard, rc.activeRateCardId, rc.setActiveRateCardId])

  const allDepts = useMemo(() => {
    const set = new Set(departments)
    for (const m of wm.members) {
      if (m.department) set.add(m.department)
    }
    return [...set].sort()
  }, [departments, wm.members])

  const entryByUserId = useMemo(() => {
    const map = new Map()
    // Only trust entries while the internal card is the ACTIVE one — during
    // the general → internal flip the hook briefly holds the General card's
    // rows, which must not render (or be written) as member rates.
    if (!internalCard || rc.activeRateCardId !== internalCard.id) return map
    for (const e of rc.entries) {
      if (e.member_id) map.set(e.member_id, e)
    }
    return map
  }, [rc.entries, rc.activeRateCardId, internalCard])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    return wm.members
      .filter(m => isAdminView || m.is_active)
      .filter(m => !deptFilter || m.department === deptFilter)
      .filter(m => !s
        || (m.display_name || '').toLowerCase().includes(s)
        || (m.username || '').toLowerCase().includes(s)
        || (m.email || '').toLowerCase().includes(s)
        || (m.title || '').toLowerCase().includes(s))
  }, [wm.members, search, deptFilter, isAdminView])

  const inputStyle = {
    backgroundColor: 'rgba(120, 70, 30, 0.55)',
    color: '#fde8d0',
    border: 'none',
  }

  const pageError = wm.error || (showRate ? rc.error : null)

  return (
    <div className="h-full flex flex-col" style={{ maxWidth: '1080px', margin: '0 auto', width: '100%', padding: '2rem 2rem' }}>
      <div className="flex items-center gap-3 mb-6">
        <Users className="w-6 h-6" style={{ color: '#1c1917' }} />
        <h1 className="text-lg font-bold uppercase tracking-widest" style={{ color: '#1c1917' }}>
          Team Members
        </h1>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {/* Saved views — only the views at or below your role */}
        {availableViews.length > 1 && (
          <div className="flex items-center gap-1 rounded-sm p-0.5" style={{ backgroundColor: 'rgba(120, 70, 30, 0.18)' }}>
            <Eye className="w-3 h-3 ml-1" style={{ color: '#78716c' }} />
            {availableViews.map(v => (
              <button
                key={v.key}
                type="button"
                onClick={() => pickView(v.key)}
                className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors"
                style={activeView === v.key
                  ? { backgroundColor: '#1c1917', color: '#f4a261' }
                  : { backgroundColor: 'transparent', color: '#57534e' }}
              >
                {v.label}
              </button>
            ))}
          </div>
        )}
        <PermissionGate requires="member.invite">
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors"
            style={{ backgroundColor: '#ea580c', color: '#fff' }}
          >
            <UserPlus className="w-3 h-3" /> Invite User
          </button>
        </PermissionGate>
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
      {(wm.loading || !wm.ready) && !wm.members.length ? (
        <div className="flex items-center justify-center py-20">
          <span className="text-xs font-mono italic" style={{ color: '#78716c' }}>Loading...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Users className="w-8 h-8" style={{ color: '#a8a29e' }} />
          <span className="text-xs font-mono italic" style={{ color: '#78716c' }}>
            {wm.members.length === 0 ? 'No members yet. Invite your first teammate.' : 'No matches.'}
          </span>
        </div>
      ) : (
        <div className="overflow-auto flex-1 rounded-sm" style={{ border: '1px solid #d6d3d1' }}>
          <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr style={{ backgroundColor: '#e7e5e4' }}>
                <ThLight>Member</ThLight>
                <ThLight>Username</ThLight>
                <ThLight>Title</ThLight>
                <ThLight>Department</ThLight>
                <ThLight>Pronouns</ThLight>
                <ThLight>Role</ThLight>
                {showEmail && <ThLight>Email</ThLight>}
                {showStatus && <ThLight>Status</ThLight>}
                {showRate && <ThLight>Day Rate</ThLight>}
                <ThLight>Projects</ThLight>
                {showActions && <ThLight />}
              </tr>
            </thead>
            <tbody>
              {filtered.map(m => (
                <MemberRow
                  key={m.user_id}
                  member={m}
                  isSelf={m.user_id === wm.userId}
                  departments={allDepts}
                  canEditProfile={canEditProfile}
                  roleEditable={activeView !== 'user'}
                  showEmail={showEmail}
                  showStatus={showStatus}
                  showRate={showRate}
                  canEditRate={canEditRate}
                  showActions={showActions}
                  rateEntry={entryByUserId.get(m.user_id) || null}
                  staffBadges={[...(staffBadgesByUser.get(m.user_id) || [])]}
                  assignedProjects={assignments.get(m.user_id) || []}
                  onUpdate={(patch) => wm.updateMember(m.user_id, patch).catch(() => {})}
                  onSetRole={(app_role) => wm.setRole(m.user_id, app_role).catch(() => {})}
                  onEditRate={() => setRateModal({ member: m, entry: entryByUserId.get(m.user_id) || null })}
                  onDeactivate={() => {
                    // Session 9: the Edge Function adds token revocation +
                    // last-admin protection. Fall back to the direct update
                    // ONLY when the function isn't deployed (bare 404) —
                    // a 404 with { error: 'not_found' } is a real business
                    // error, and a network failure must not silently skip
                    // the revocation the confirm dialog just promised.
                    if (!window.confirm(`Deactivate "${m.display_name || m.username}"? Access cuts immediately; they are signed out everywhere within the hour.`)) return
                    setAdminError(null)
                    adminSetActive(m.user_id, false).then((res) => {
                      if (res.ok) { wm.reload(); return }
                      if (isMissingFunction(res)) {
                        wm.setActive(m.user_id, false).catch(() => {})
                        return
                      }
                      setAdminError(res.data.friendly)
                    })
                  }}
                  onReactivate={() => {
                    setAdminError(null)
                    adminSetActive(m.user_id, true).then((res) => {
                      if (res.ok) { wm.reload(); return }
                      if (isMissingFunction(res)) {
                        wm.setActive(m.user_id, true).catch(() => {})
                        return
                      }
                      setAdminError(res.data.friendly)
                    })
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageError && (
        <div className="mt-2 text-xs font-mono" style={{ color: '#dc2626' }}>
          {pageError}
        </div>
      )}

      {adminError && (
        <div className="mt-2 text-xs font-mono px-3 py-2 rounded-sm" style={{ backgroundColor: 'rgba(220,38,38,0.1)', color: '#dc2626' }}>
          {adminError}
        </div>
      )}

      <InviteMemberDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvited={(resp) => {
          // Push the new row straight into the list — no refetch needed now
          // that the page tracks workspace_members (the entity the invite
          // actually created).
          wm.injectMember(resp)
        }}
      />

      {rateModal && (
        <RateCardEditorModal
          member={rateModal.member}
          entry={rateModal.entry}
          deptDefaults={rc.deptDefaults}
          onCancel={() => setRateModal(null)}
          onConfirm={async (draft) => {
            const { member, entry } = rateModal
            // The hook writes to whatever card is active. Refuse unless that
            // is provably the Internal card — rate cards may still be
            // loading, or the internal-card auto-create may have failed
            // (useRateCard.addEntry would return null WITHOUT throwing, and
            // the modal would close as if saved).
            if (!internalCard || rc.activeRateCardId !== internalCard.id) {
              throw new Error('Rate cards are still loading — try again in a moment.')
            }
            if (entry) {
              await rc.updateEntry(entry.id, draft)
            } else {
              await rc.addEntry({
                member_id:  member.user_id,
                role_label: member.title || member.display_name || member.username,
                department: member.department || null,
                ...draft,
              })
            }
            setRateModal(null)
          }}
        />
      )}
    </div>
  )
}

// ─── Member row ───
function MemberRow({
  member, isSelf, departments,
  canEditProfile, roleEditable,
  showEmail, showStatus, showRate, canEditRate, showActions,
  rateEntry, staffBadges = [], assignedProjects = [],
  onUpdate, onSetRole, onEditRate, onDeactivate, onReactivate,
}) {
  const inactive = !member.is_active
  // §10-B: producers / creative directors get a highlighted row + badge.
  const highlighted = !inactive && staffBadges.length > 0
  return (
    <tr style={{
      borderBottom: '1px solid #e7e5e4',
      opacity: inactive ? 0.5 : 1,
      backgroundColor: highlighted ? 'rgba(244, 162, 97, 0.14)' : undefined,
    }}>
      <TdLight>
        <div className="flex items-center gap-2">
          <Avatar member={member} />
          <span className="text-xs font-mono truncate" style={{ color: '#1c1917' }}>
            {member.display_name || member.username || '--'}
          </span>
          {staffBadges.map(b => (
            <span
              key={b}
              className="text-[9px] font-bold uppercase tracking-wider px-1 rounded-sm flex-shrink-0"
              style={{ backgroundColor: '#f4a261', color: '#7c2d12' }}
              title={b === 'PRODUCER' ? 'Producer on at least one project' : 'Director on at least one project'}
            >
              {b}
            </span>
          ))}
          {isSelf && (
            <span className="text-[9px] font-bold uppercase tracking-wider px-1 rounded-sm" style={{ backgroundColor: '#ea580c', color: '#fff' }}>
              you
            </span>
          )}
        </div>
      </TdLight>
      <TdLight>
        <span className="text-xs font-mono" style={{ color: '#57534e' }}>{member.username}</span>
      </TdLight>
      <TdLight>
        {canEditProfile ? (
          <InlineLightText value={member.title || ''} onCommit={(title) => onUpdate({ title: title || null })} placeholder="Title" />
        ) : (
          <ReadCell value={member.title} />
        )}
      </TdLight>
      <TdLight>
        {canEditProfile ? (
          <InlineLightSelect
            value={member.department || ''}
            options={[{ value: '', label: '--' }, ...departments.map(d => ({ value: d, label: d }))]}
            onCommit={(department) => onUpdate({ department: department || null })}
          />
        ) : (
          <ReadCell value={member.department} />
        )}
      </TdLight>
      <TdLight>
        <ReadCell value={member.pronouns} />
      </TdLight>
      <TdLight>
        {roleEditable ? (
          <PermissionGate
            requires="member.role.change"
            fallback={<RolePill role={member.app_role} />}
          >
            {isSelf ? (
              <span title="Ask another admin to change your role.">
                <RolePill role={member.app_role} />
              </span>
            ) : (
              <InlineLightSelect
                value={member.app_role}
                options={[
                  { value: 'user',    label: 'User' },
                  { value: 'manager', label: 'Manager' },
                  { value: 'admin',   label: 'Admin' },
                ]}
                onCommit={onSetRole}
              />
            )}
          </PermissionGate>
        ) : (
          <RolePill role={member.app_role} />
        )}
      </TdLight>
      {showEmail && (
        <TdLight>
          <ReadCell value={member.email} muted />
        </TdLight>
      )}
      {showStatus && (
        <TdLight>
          <span
            className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
            style={inactive
              ? { backgroundColor: 'rgba(120, 70, 30, 0.12)', color: '#78716c' }
              : { backgroundColor: 'rgba(34, 197, 94, 0.15)', color: '#15803d' }}
          >
            {inactive ? 'Inactive' : 'Active'}
          </span>
        </TdLight>
      )}
      {showRate && (
        <TdLight>
          <RateCell entry={rateEntry} editable={canEditRate} onEdit={onEditRate} />
        </TdLight>
      )}
      <TdLight>
        {/* §10-E: live project assignments (project_members via the
            workspace channel). */}
        {assignedProjects.length > 0 ? (
          <span
            className="text-xs font-mono"
            style={{ color: '#1c1917' }}
            title={assignedProjects.join(', ')}
          >
            {assignedProjects.slice(0, 2).join(', ')}
            {assignedProjects.length > 2 ? ` +${assignedProjects.length - 2}` : ''}
          </span>
        ) : (
          <span className="text-xs font-mono" style={{ color: '#a8a29e' }} title="No project assignments">
            --
          </span>
        )}
      </TdLight>
      {showActions && (
        <TdLight>
          {inactive ? (
            <button
              type="button"
              onClick={onReactivate}
              className="p-1 rounded-sm hover:bg-stone-200 transition-colors"
              title="Reactivate member"
              style={{ color: '#15803d' }}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          ) : isSelf ? null : (
            <button
              type="button"
              onClick={onDeactivate}
              className="p-1 rounded-sm hover:bg-stone-200 transition-colors"
              title="Deactivate member"
              style={{ color: '#dc2626' }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </TdLight>
      )}
    </tr>
  )
}

function Avatar({ member }) {
  const initial = (member.display_name || member.username || '?').trim().charAt(0).toUpperCase()
  if (isOwnAvatarUrl(member.avatar_url)) {
    return (
      <img
        src={member.avatar_url}
        alt=""
        className="w-6 h-6 rounded-full object-cover flex-shrink-0"
        style={{ border: '1px solid #d6d3d1' }}
      />
    )
  }
  return (
    <div
      className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold"
      style={{ backgroundColor: 'rgba(120, 70, 30, 0.55)', color: '#fde8d0' }}
    >
      {initial}
    </div>
  )
}

function RolePill({ role }) {
  return (
    <span className="text-xs font-mono" style={{ color: '#1c1917' }}>
      {ROLE_LABELS[role] || role || '--'}
    </span>
  )
}

function ReadCell({ value, muted }) {
  return (
    <span className="text-xs font-mono truncate" style={{ color: value ? (muted ? '#57534e' : '#1c1917') : '#a8a29e' }}>
      {value || '--'}
    </span>
  )
}

function RateCell({ entry, editable, onEdit }) {
  const wage = formatMoney(entry?.wage, entry?.currency)
  const total = formatMoney(entry?.day_rate, entry?.currency) // day_rate = computed total
  const label = wage
    ? <>{wage}{total && total !== wage ? <span style={{ color: '#78716c' }}> / {total}</span> : null}</>
    : <span style={{ color: '#a8a29e' }}>{editable ? 'Set rate' : '--'}</span>
  if (!editable) {
    return <span className="text-xs font-mono">{label}</span>
  }
  return (
    <button
      type="button"
      onClick={onEdit}
      className="text-xs font-mono text-left hover:bg-stone-200 px-1 py-0.5 rounded-sm transition-colors"
      style={{ color: '#1c1917' }}
      title="Edit rate card entry"
    >
      {label}
    </button>
  )
}

// ─── Rate card editor — admin confirmation flow ───
// Phase 'form' collects wage/burden/overhead; phase 'confirm' shows the
// before → after summary and requires an explicit confirm click before the
// entry is written (rate_card.edit is admin-only; the modal is the second
// look the scope asks for).
function RateCardEditorModal({ member, entry, deptDefaults, onCancel, onConfirm }) {
  const [phase, setPhase] = useState('form')
  const [busy, setBusy] = useState(false)

  // Escape closes (matches InviteMemberDialog), never mid-save.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onCancel])
  const [error, setError] = useState('')
  const [wage, setWage] = useState(entry?.wage ?? '')
  const [burden, setBurden] = useState(entry?.burden ?? '')
  const [burdenType, setBurdenType] = useState(entry?.burden_type || 'percent')
  const [overhead, setOverhead] = useState(entry?.overhead ?? '')
  const [overheadType, setOverheadType] = useState(entry?.overhead_type || 'percent')

  const draft = {
    wage:          wage === '' ? null : Number(wage),
    burden:        burden === '' ? null : Number(burden),
    burden_type:   burdenType,
    overhead:      overhead === '' ? null : Number(overhead),
    overhead_type: overheadType,
  }
  // day_rate: null — rc.entries rows carry day_rate = previously computed
  // TOTAL, and computeEntryTotal falls back to it when wage is cleared,
  // which would preview a phantom rate.
  const nextTotal = computeEntryTotal({ ...entry, day_rate: null, ...draft, department: member.department }, deptDefaults).total
  const prevTotal = entry ? computeEntryTotal(entry, deptDefaults).total : null

  function toConfirm() {
    if (wage !== '' && (Number.isNaN(Number(wage)) || Number(wage) < 0)) {
      setError('Day rate must be a non-negative number.')
      return
    }
    setError('')
    setPhase('confirm')
  }

  async function confirm() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await onConfirm(draft)
    } catch (err) {
      setError(err?.message || String(err))
      setBusy(false)
      setPhase('form')
    }
  }

  const fieldStyle = {
    width: '100%', padding: '6px 8px', fontSize: 12,
    backgroundColor: 'rgba(244, 162, 97, 0.12)', color: '#f4a261',
    border: '1px solid #44403c', borderRadius: 3,
  }
  const labelClass = 'block text-[10px] font-bold uppercase tracking-wider mb-1'

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 80, backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel() }}
    >
      <div
        style={{
          backgroundColor: '#1c1917', border: '2px solid #ea580c', borderRadius: '6px',
          padding: '20px 22px', width: 'min(420px, 92vw)', color: '#f4a261',
        }}
      >
        <h2 className="font-mono uppercase text-sm tracking-widest mb-4" style={{ color: '#ea580c' }}>
          {entry ? 'Edit rate' : 'Set rate'} — {member.display_name || member.username}
        </h2>

        {phase === 'form' ? (
          <>
            <div className="mb-3">
              <label className={labelClass} style={{ color: '#a8a29e' }}>Day rate (wage)</label>
              <input type="number" min="0" value={wage} onChange={(e) => setWage(e.target.value)} style={fieldStyle} autoFocus />
            </div>
            <div className="flex gap-2 mb-3">
              <div className="flex-1">
                <label className={labelClass} style={{ color: '#a8a29e' }}>Burden</label>
                <input type="number" min="0" value={burden} onChange={(e) => setBurden(e.target.value)} style={fieldStyle} placeholder="dept default" />
              </div>
              <div className="w-24">
                <label className={labelClass} style={{ color: '#a8a29e' }}>Type</label>
                <select value={burdenType} onChange={(e) => setBurdenType(e.target.value)} style={fieldStyle}>
                  <option value="percent">%</option>
                  <option value="fixed">$</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 mb-4">
              <div className="flex-1">
                <label className={labelClass} style={{ color: '#a8a29e' }}>Overhead</label>
                <input type="number" min="0" value={overhead} onChange={(e) => setOverhead(e.target.value)} style={fieldStyle} placeholder="dept default" />
              </div>
              <div className="w-24">
                <label className={labelClass} style={{ color: '#a8a29e' }}>Type</label>
                <select value={overheadType} onChange={(e) => setOverheadType(e.target.value)} style={fieldStyle}>
                  <option value="percent">%</option>
                  <option value="fixed">$</option>
                </select>
              </div>
            </div>
          </>
        ) : (
          <div className="mb-4 text-xs font-mono leading-relaxed">
            <p className="mb-2" style={{ color: '#d6d3d1' }}>
              Confirm the rate card change for{' '}
              <strong style={{ color: '#f4a261' }}>{member.display_name || member.username}</strong>:
            </p>
            <p>
              Total day rate:{' '}
              {prevTotal != null && <span style={{ color: '#a8a29e' }}>{formatMoney(prevTotal, entry?.currency)} &rarr; </span>}
              <strong style={{ color: '#f4a261' }}>{formatMoney(nextTotal, entry?.currency) || '--'}</strong>
            </p>
          </div>
        )}

        {error && (
          <div className="mb-3 text-xs font-mono" style={{ color: '#ef4444' }}>{error}</div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={phase === 'confirm' ? () => setPhase('form') : onCancel}
            disabled={busy}
            className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors disabled:opacity-40"
            style={{ backgroundColor: 'transparent', color: '#a8a29e', border: '1px solid #44403c' }}
          >
            {phase === 'confirm' ? 'Back' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={phase === 'confirm' ? confirm : toConfirm}
            disabled={busy}
            className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors disabled:opacity-40"
            style={{ backgroundColor: '#ea580c', color: '#fff' }}
          >
            {busy ? 'Saving…' : phase === 'confirm' ? 'Confirm change' : 'Review'}
          </button>
        </div>
      </div>
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
