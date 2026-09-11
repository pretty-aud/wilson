// =============================================================================
// UsersSection — the Admin Terminal's primary surface (Session 9): roster
// table, ADD PEOPLE (invite / create-with-password), and the per-user
// detail panel (identity / access / security / danger zone).
//
// UX laws embodied:
//   Pareto Principle — user management is the 80% admin job; it gets the
//     default section and the richest surface.
//   Fitts's Law — one large primary ADD PEOPLE target; destructive actions
//     small, separated, at the panel's bottom.
//   Hick's Law — the add flow forks into exactly two choices.
//   Miller's Law / Chunking — the detail panel is four labeled groups.
//   Doherty Threshold — optimistic toggles + tiny spinners; per-action
//     feedback lands immediately, rollback comes from the hook.
//
// Enforcement note: every mutation is enforced DB/Edge-side (RLS, guard
// trigger, admin-* functions). UI gates are presentation only.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Users, Search, X, UserPlus, KeyRound, Power, Loader2, ChevronDown,
} from 'lucide-react'
import { isOwnAvatarUrl } from '../TeamMembers/useWorkspaceMembers'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'
import { adminResetPassword, adminSetActive, adminUserSecurity } from '../../cloud/adminApi'
import CreateUserDialog from './CreateUserDialog'
import MultiInviteDialog from './MultiInviteDialog'
import CredentialsPopup from './CredentialsPopup'
// Session 43 §B — this section renders on the Admin Terminal, which is a LIGHT
// page (#f4a261). The greys inside the DISABLE-USER MODAL below are left alone
// on purpose: that modal paints #1c1917, where a grey is correct.
import {
  LIGHT_INK, LIGHT_RULE, LIGHT_WELL,
  LIGHT_TABLE_FRAME, LIGHT_TABLE_HEAD_ROW, LIGHT_TABLE_HEAD_CELL,
} from '../lightSurface'

const ROLE_LABELS = { admin: 'Admin', manager: 'Manager', user: 'User' }

const lightInputStyle = {
  backgroundColor: 'rgba(120, 70, 30, 0.55)',
  color: '#fde8d0',
  border: 'none',
}

function fmtDate(iso) {
  if (!iso) return '--'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '--'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function timeAgo(iso) {
  if (!iso) return 'never'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'never'
  const mins = Math.floor((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return fmtDate(iso)
}

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Deactivated' },
]

// isActive is accepted for section parity but unused: the roster comes from
// useWorkspaceMembers (loads once app-wide) and the security lookup is
// gated on panel open — nothing here fetches on mount.
export default function UsersSection({ wm }) {
  const rabbit = useRabbit()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedId, setSelectedId] = useState(null)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [dialog, setDialog] = useState(null)   // 'invite' | 'create' | null
  const [creds, setCreds] = useState(null)     // { username, password, context } | null
  const addMenuRef = useRef(null)

  // Roster liveness: workspace_members changes (and full RESYNCs after a
  // reconnect) debounce into a directory reload — Dashboard pattern.
  // Callback held behind a ref so re-renders never resubscribe.
  const reloadRef = useRef(wm.reload)
  useEffect(() => { reloadRef.current = wm.reload }, [wm.reload])
  useEffect(() => {
    const subscribe = rabbit?.subscribeWorkspaceEvents
    if (typeof subscribe !== 'function') return undefined
    let timer = null
    const unsub = subscribe((evt) => {
      if (evt.table !== 'workspace_members' && evt.op !== 'RESYNC') return
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

  // Anchored ADD PEOPLE menu — click-outside / Escape dismissal.
  useEffect(() => {
    if (!addMenuOpen) return undefined
    const onDown = (e) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target)) setAddMenuOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setAddMenuOpen(false) }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [addMenuOpen])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    return wm.members
      .filter(m => statusFilter === 'all'
        || (statusFilter === 'active' ? m.is_active : !m.is_active))
      .filter(m => !s
        || (m.username || '').toLowerCase().includes(s)
        || (m.display_name || '').toLowerCase().includes(s)
        || (m.email || '').toLowerCase().includes(s))
  }, [wm.members, search, statusFilter])

  const selectedMember = selectedId
    ? wm.members.find(m => m.user_id === selectedId) || null
    : null

  function handleCreated(data, extra) {
    setDialog(null)
    // Show-once credentials go straight to the popup; the roster gets the
    // new row immediately (inject) and the grants land via reload.
    setCreds({ username: data.username, password: data.password, context: 'created' })
    wm.injectMember({ ...data, display_name: extra?.displayName || data.username })
    wm.reload()
  }

  return (
    <div className="h-full flex min-h-0">
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <div className="flex items-center gap-1 flex-1 max-w-xs">
            <Search className="w-3 h-3" style={{ color: LIGHT_INK }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search username, name, email..."
              className="flex-1 px-2 py-1.5 text-[11px] font-mono rounded-sm focus:ring-2 focus:ring-orange-500"
              style={lightInputStyle}
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} className="p-0.5" style={{ color: LIGHT_INK }}>
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 rounded-sm p-0.5" style={{ backgroundColor: 'rgba(120, 70, 30, 0.18)' }}>
            {STATUS_FILTERS.map(f => (
              <button
                key={f.key}
                type="button"
                onClick={() => setStatusFilter(f.key)}
                className="at-chip px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors"
                data-active={String(statusFilter === f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <div className="relative" ref={addMenuRef}>
            <button
              type="button"
              onClick={() => setAddMenuOpen(v => !v)}
              className="flex items-center gap-1.5 px-5 py-2.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors"
              style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}
            >
              <UserPlus className="w-3.5 h-3.5" /> Add people <ChevronDown className="w-3 h-3" />
            </button>
            {addMenuOpen && (
              <div
                className="absolute right-0 mt-1 py-1 rounded-sm z-30"
                style={{ backgroundColor: '#1c1917', border: '1px solid #ea580c', minWidth: '210px' }}
              >
                <MenuItem
                  label="Invite by email…"
                  hint="They set their own password"
                  onClick={() => { setAddMenuOpen(false); setDialog('invite') }}
                />
                <MenuItem
                  label="Create with password…"
                  hint="You hand over the credentials"
                  onClick={() => { setAddMenuOpen(false); setDialog('create') }}
                />
              </div>
            )}
          </div>
        </div>

        {wm.error && (
          <div
            className="flex items-center justify-between mb-3 text-xs font-mono px-3 py-2 rounded-sm"
            style={{ backgroundColor: 'rgba(220, 38, 38, 0.1)', color: '#dc2626' }}
          >
            <span>{wm.error}</span>
            <button type="button" onClick={wm.clearError} className="p-0.5">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Table */}
        {(wm.loading || !wm.ready) && !wm.members.length ? (
          <div className="flex items-center justify-center py-20">
            <span className="text-xs font-mono italic" style={{ color: LIGHT_INK }}>Loading...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Users className="w-8 h-8" style={{ color: LIGHT_INK }} />
            <span className="text-xs font-mono italic" style={{ color: LIGHT_INK }}>
              {wm.members.length === 0 ? 'No members yet. Add your first teammate.' : 'No matches.'}
            </span>
          </div>
        ) : (
          <div className="overflow-auto flex-1 rounded-sm wilson-light-scroll" style={{ border: `1px solid ${LIGHT_RULE}` }}>
            <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead>
                <tr style={LIGHT_TABLE_HEAD_ROW}>
                  <ThLight>Member</ThLight>
                  <ThLight>Username</ThLight>
                  <ThLight>Role</ThLight>
                  <ThLight>Rate access</ThLight>
                  <ThLight>Status</ThLight>
                  <ThLight>Joined</ThLight>
                </tr>
              </thead>
              <tbody>
                {filtered.map(m => (
                  <tr
                    key={m.user_id}
                    onClick={() => setSelectedId(m.user_id)}
                    className="at-roster-row cursor-pointer"
                    data-selected={String(selectedId === m.user_id)}
                    data-inactive={String(!m.is_active)}
                    style={{ borderBottom: `1px solid ${LIGHT_RULE}` }}
                  >
                    <TdLight>
                      <div className="flex items-center gap-2">
                        <Avatar member={m} />
                        <span className="text-xs font-mono truncate" style={{ color: '#1c1917' }}>
                          {m.display_name || m.username || '--'}
                        </span>
                        {m.user_id === wm.userId && (
                          <span className="text-[9px] font-bold uppercase tracking-wider px-1 rounded-sm" style={{ backgroundColor: '#ea580c', color: '#fff' }}>
                            you
                          </span>
                        )}
                      </div>
                    </TdLight>
                    <TdLight>
                      <span className="text-xs font-mono" style={{ color: LIGHT_INK }}>{m.username}</span>
                    </TdLight>
                    <TdLight>
                      <span className="text-xs font-mono" style={{ color: '#1c1917' }}>
                        {ROLE_LABELS[m.app_role] || m.app_role || '--'}
                      </span>
                    </TdLight>
                    <TdLight>
                      <GrantChips member={m} />
                    </TdLight>
                    <TdLight>
                      <StatusDot active={!!m.is_active} />
                    </TdLight>
                    <TdLight>
                      <span className="text-xs font-mono" style={{ color: LIGHT_INK }}>{fmtDate(m.created_at)}</span>
                    </TdLight>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedMember && (
        <UserDetailPanel
          member={selectedMember}
          isSelf={selectedMember.user_id === wm.userId}
          wm={wm}
          escapeDisabled={!!dialog || !!creds}
          onClose={() => setSelectedId(null)}
          onCredentials={setCreds}
        />
      )}

      <MultiInviteDialog
        open={dialog === 'invite'}
        onClose={() => setDialog(null)}
        onInvited={(row) => wm.injectMember(row)}
      />
      <CreateUserDialog
        open={dialog === 'create'}
        onClose={() => setDialog(null)}
        onCreated={handleCreated}
      />
      <CredentialsPopup
        open={!!creds}
        username={creds?.username || ''}
        password={creds?.password || ''}
        context={creds?.context || 'created'}
        onClose={() => setCreds(null)}
      />
    </div>
  )
}

// ─── Detail panel (Miller/Chunking: four labeled groups) ───
function UserDetailPanel({ member, isSelf, wm, escapeDisabled, onClose, onCredentials }) {
  const [entered, setEntered] = useState(false)
  const [modal, setModal] = useState(null)      // { kind: 'grant'|'reset'|'active', ... } | null
  const [grantBusy, setGrantBusy] = useState(null) // 'view' | 'edit' | null
  const [security, setSecurity] = useState(null)
  const [secLoading, setSecLoading] = useState(false)
  const [secError, setSecError] = useState(null)

  // StrictMode-safe mounted flag: body sets true, cleanup sets false.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Slide-in on mount.
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(id)
  }, [])

  // Escape closes the panel — unless a modal owns the key right now.
  useEffect(() => {
    if (escapeDisabled || modal) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [escapeDisabled, modal, onClose])

  // SECURITY group lazy-loads per member; seq guard drops stale responses
  // when the admin clicks through rows faster than the Edge Function replies.
  const secSeqRef = useRef(0)
  useEffect(() => {
    const seq = ++secSeqRef.current
    setSecurity(null)
    setSecError(null)
    setSecLoading(true)
    adminUserSecurity(member.user_id)
      .then((res) => {
        if (!mountedRef.current || seq !== secSeqRef.current) return
        if (res.ok) setSecurity(res.data)
        else setSecError(res.data?.friendly || `Security lookup failed (${res.status}).`)
        setSecLoading(false)
      })
      .catch((err) => {
        if (!mountedRef.current || seq !== secSeqRef.current) return
        setSecError(err?.message || 'Security lookup failed.')
        setSecLoading(false)
      })
  }, [member.user_id])

  const name = member.display_name || member.username
  const grantView = !!member.grant_rate_card_view
  const grantEdit = !!member.grant_rate_card_edit

  // Optimistic grant write: the hook flips the row synchronously and rolls
  // back on failure (wm.error banner) — we only track the tiny spinner.
  function applyGrant(key, next) {
    setModal(null)
    setGrantBusy(key)
    const patch = key === 'view'
      ? { grant_rate_card_view: next }
      : { grant_rate_card_edit: next }
    wm.updateMember(member.user_id, patch)
      .catch(() => {})
      .finally(() => { if (mountedRef.current) setGrantBusy(null) })
  }

  return (
    <div
      className="at-detail-panel flex-shrink-0 ml-4 pl-4 overflow-y-auto wilson-light-scroll"
      data-entered={String(entered)}
      style={{ width: '360px', borderLeft: `1px solid ${LIGHT_RULE}` }}
    >
      <div className="flex items-start justify-between mb-4">
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: LIGHT_INK }}>
          Member detail
        </span>
        <button type="button" onClick={onClose} className="at-icon-btn p-1 rounded-sm transition-colors" title="Close (Esc)">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* IDENTITY */}
      <GroupLabel>Identity</GroupLabel>
      <div className="flex items-center gap-3 mb-2">
        <Avatar member={member} size={40} />
        <div className="min-w-0">
          <div className="text-sm font-bold truncate" style={{ color: '#1c1917' }}>
            {name}
            {isSelf && (
              <span className="ml-2 text-[9px] font-bold uppercase tracking-wider px-1 rounded-sm align-middle" style={{ backgroundColor: '#ea580c', color: '#fff' }}>
                you
              </span>
            )}
          </div>
          <div className="text-xs font-mono truncate" style={{ color: LIGHT_INK }}>@{member.username}</div>
        </div>
      </div>
      <div className="text-xs font-mono mb-1" style={{ color: LIGHT_INK }}>
        {[member.title, member.department].filter(Boolean).join(' · ') || '--'}
      </div>
      <div className="text-[11px] font-mono mb-5" style={{ color: LIGHT_INK }}>
        Joined {fmtDate(member.created_at)}
      </div>

      {/* ACCESS */}
      <GroupLabel>Access</GroupLabel>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs" style={{ color: '#1c1917' }}>Role</span>
        {isSelf ? (
          <span className="text-xs font-mono" style={{ color: '#1c1917' }} title="Ask another admin to change your role.">
            {ROLE_LABELS[member.app_role] || member.app_role}
          </span>
        ) : (
          <select
            value={member.app_role}
            onChange={(e) => wm.setRole(member.user_id, e.target.value).catch(() => {})}
            className="px-1.5 py-0.5 text-[11px] font-mono rounded-sm focus:ring-2 focus:ring-orange-500 cursor-pointer"
            style={{ backgroundColor: 'transparent', color: '#1c1917', border: `1px solid ${LIGHT_RULE}` }}
          >
            <option value="user">User</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>
        )}
      </div>
      {isSelf && (
        <div className="text-[10px] mb-3 -mt-2" style={{ color: LIGHT_INK }}>
          Ask another admin to change your role.
        </div>
      )}
      <ToggleRow
        label="Can view rate card"
        on={grantView || grantEdit}
        busy={grantBusy === 'view'}
        disabled={grantEdit}
        note={grantEdit ? 'Included with edit access' : null}
        onToggle={() => setModal({ kind: 'grant', key: 'view', next: !grantView })}
      />
      <ToggleRow
        label="Can edit rate card"
        on={grantEdit}
        busy={grantBusy === 'edit'}
        onToggle={() => setModal({ kind: 'grant', key: 'edit', next: !grantEdit })}
      />

      {/* SECURITY */}
      <div className="mt-5">
        <GroupLabel>Security</GroupLabel>
      </div>
      {secLoading ? (
        <div className="flex items-center gap-2 py-2 text-xs font-mono italic" style={{ color: LIGHT_INK }}>
          <Loader2 className="w-3 h-3 animate-spin" /> Loading security info...
        </div>
      ) : secError ? (
        <div className="text-xs font-mono px-3 py-2 rounded-sm mb-2" style={{ backgroundColor: 'rgba(220, 38, 38, 0.1)', color: '#dc2626' }}>
          {secError}
        </div>
      ) : security ? (
        <div className="space-y-1.5 mb-3">
          <SecRow label="Email">
            <span className="font-mono break-all">{security.email || '--'}</span>
            {typeof security.email === 'string' && security.email.endsWith('@mail.petalstudios.co') && (
              <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider px-1 rounded-sm" style={{ backgroundColor: 'rgba(120, 70, 30, 0.12)', color: LIGHT_INK }}>
                no real inbox
              </span>
            )}
          </SecRow>
          <SecRow label="Last sign-in">
            <span className="font-mono" title={security.last_sign_in_at || ''}>{timeAgo(security.last_sign_in_at)}</span>
          </SecRow>
          <SecRow label="MFA">
            <span
              className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
              style={security.mfa_enrolled
                ? { backgroundColor: 'rgba(34, 197, 94, 0.15)', color: '#15803d' }
                : { backgroundColor: 'rgba(120, 70, 30, 0.12)', color: LIGHT_INK }}
            >
              {security.mfa_enrolled ? `Enrolled (${security.factor_count})` : 'Not enrolled'}
            </span>
          </SecRow>
          {security.banned_until && (
            <SecRow label="Banned">
              <span className="font-mono" style={{ color: '#dc2626' }}>until {fmtDate(security.banned_until)}</span>
            </SecRow>
          )}
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setModal({ kind: 'reset' })}
        className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors"
        style={{ backgroundColor: '#1c1917', color: '#f4a261' }}
      >
        <KeyRound className="w-3 h-3" /> Reset password
      </button>

      {/* DANGER ZONE — bottom, visually separated (Fitts: small + far). */}
      <div className="mt-6 pt-3 pb-6" style={{ borderTop: '1px solid rgba(220, 38, 38, 0.35)' }}>
        <span className="block text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: '#dc2626' }}>
          Danger zone
        </span>
        {isSelf ? (
          <p className="text-[11px]" style={{ color: LIGHT_INK }}>
            You cannot deactivate yourself here.
          </p>
        ) : (
          <button
            type="button"
            onClick={() => setModal({ kind: 'active', next: !member.is_active })}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors"
            style={member.is_active
              ? { backgroundColor: 'transparent', color: '#dc2626', border: '1px solid #dc2626' }
              : { backgroundColor: 'transparent', color: '#15803d', border: '1px solid #15803d' }}
          >
            <Power className="w-3 h-3" /> {member.is_active ? 'Deactivate' : 'Reactivate'}
          </button>
        )}
      </div>

      {modal?.kind === 'grant' && (
        <ConfirmModal
          title={`${modal.next ? 'Grant' : 'Revoke'} rate-card ${modal.key}`}
          confirmLabel={modal.next ? 'Grant access' : 'Revoke access'}
          danger={!modal.next}
          onCancel={() => setModal(null)}
          onConfirm={() => applyGrant(modal.key, modal.next)}
        >
          {modal.next
            ? `Grant rate-card ${modal.key} to ${name}? They will see company wage data.`
            : `Revoke rate-card ${modal.key} from ${name}? They will lose access to company wage data.`}
        </ConfirmModal>
      )}
      {modal?.kind === 'reset' && (
        <ConfirmModal
          title="Reset password"
          confirmLabel="Reset password"
          onCancel={() => setModal(null)}
          onConfirm={async () => {
            const res = await adminResetPassword(member.user_id)
            if (!res.ok) throw new Error(res.data?.friendly || `Reset failed (${res.status}).`)
            onCredentials({ username: res.data.username, password: res.data.password, context: 'reset' })
            setModal(null)
          }}
        >
          Reset {name}'s password? Their current password stops working immediately — you'll get a new one to hand over.
        </ConfirmModal>
      )}
      {modal?.kind === 'active' && (
        <ConfirmModal
          title={modal.next ? 'Reactivate member' : 'Deactivate member'}
          confirmLabel={modal.next ? 'Reactivate' : 'Deactivate'}
          danger={!modal.next}
          onCancel={() => setModal(null)}
          onConfirm={async () => {
            const res = await adminSetActive(member.user_id, modal.next)
            // 'last_admin' can ride an ok-shaped payload — check it first.
            if (res.data?.error === 'last_admin' || !res.ok) {
              throw new Error(res.data?.friendly || `Action failed (${res.status}).`)
            }
            await wm.reload()
            setModal(null)
          }}
        >
          {modal.next
            ? `Reactivate ${name}? They regain sign-in and workspace access immediately.`
            : `Deactivate ${name}? Signs them out everywhere within the hour; access cuts immediately.`}
        </ConfirmModal>
      )}
    </div>
  )
}

// ─── Two-phase confirm modal (RateCardEditorModal pattern: explicit
// confirm click before anything is written; errors keep it open) ───
function ConfirmModal({ title, children, confirmLabel, danger, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onCancel])

  async function go() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await onConfirm()
    } catch (err) {
      setError(err?.message || String(err))
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 85, backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel() }}
    >
      <div
        style={{
          backgroundColor: '#1c1917', border: '2px solid #ea580c', borderRadius: '6px',
          padding: '20px 22px', width: 'min(400px, 92vw)', color: '#f4a261',
        }}
      >
        <h2 className="font-mono uppercase text-sm tracking-widest mb-3" style={{ color: '#ea580c' }}>
          {title}
        </h2>
        <p className="text-xs font-mono leading-relaxed mb-4" style={{ color: '#d6d3d1' }}>
          {children}
        </p>
        {error && (
          <div className="mb-3 text-xs font-mono px-3 py-2 rounded-sm" style={{ backgroundColor: 'rgba(220, 38, 38, 0.1)', color: '#dc2626' }}>
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="at-disable-40 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors"
            style={{ backgroundColor: 'transparent', color: '#a8a29e', border: '1px solid #44403c' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={go}
            disabled={busy}
            className="at-disable-40 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors"
            style={danger
              ? { backgroundColor: '#dc2626', color: '#fff' }
              : { backgroundColor: '#ea580c', color: '#fff' }}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Atoms ───
function MenuItem({ label, hint, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="at-menu-item block w-full text-left px-3 py-2 transition-colors"
    >
      <span className="block text-xs font-mono" style={{ color: '#fde8d0' }}>{label}</span>
      {hint && <span className="at-menu-hint block text-[10px] mt-0.5">{hint}</span>}
    </button>
  )
}

function ThLight({ children }) {
  return (
    <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-left" style={{ color: LIGHT_INK }}>
      {children}
    </th>
  )
}
function TdLight({ children }) {
  return <td className="px-3 py-2 align-middle">{children}</td>
}

function Avatar({ member, size = 24 }) {
  const initial = (member.display_name || member.username || '?').trim().charAt(0).toUpperCase()
  const px = `${size}px`
  if (isOwnAvatarUrl(member.avatar_url)) {
    return (
      <img
        src={member.avatar_url}
        alt=""
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: px, height: px, border: `1px solid ${LIGHT_RULE}` }}
      />
    )
  }
  return (
    <div
      className="rounded-full flex items-center justify-center flex-shrink-0 font-bold"
      style={{ width: px, height: px, fontSize: size >= 40 ? 16 : 10, backgroundColor: 'rgba(120, 70, 30, 0.55)', color: '#fde8d0' }}
    >
      {initial}
    </div>
  )
}

// Rate-access chips — Von Restorff: quietly distinct so granted rows pop
// without shouting wage data across the roster.
function GrantChips({ member }) {
  const view = !!member.grant_rate_card_view
  const edit = !!member.grant_rate_card_edit
  if (!view && !edit) {
    return <span className="text-xs font-mono italic" style={{ color: LIGHT_INK }}>--</span>
  }
  return (
    <span className="flex items-center gap-1">
      {(view || edit) && (
        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-sm" style={{ backgroundColor: 'rgba(234, 88, 12, 0.10)', color: '#c2410c' }}>
          View
        </span>
      )}
      {edit && (
        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-sm" style={{ backgroundColor: 'rgba(234, 88, 12, 0.18)', color: '#9a3412' }}>
          Edit
        </span>
      )}
    </span>
  )
}

function StatusDot({ active }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: active ? '#22c55e' : '#ef4444' }} />
      <span className="text-xs font-mono" style={{ color: LIGHT_INK }}>{active ? 'Active' : 'Deactivated'}</span>
    </span>
  )
}

function GroupLabel({ children }) {
  return (
    <span className="block text-[10px] font-bold uppercase tracking-widest mb-2 pb-1" style={{ color: LIGHT_INK, borderBottom: `1px solid ${LIGHT_RULE}` }}>
      {children}
    </span>
  )
}

function ToggleRow({ label, on, busy, disabled, note, onToggle }) {
  return (
    <div className="at-toggle-row flex items-center justify-between mb-2" data-disabled={String(!!disabled)}>
      <span className="text-xs" style={{ color: '#1c1917' }}>
        {label}
        {note && <span className="ml-1.5 text-[10px]" style={{ color: LIGHT_INK }}>{note}</span>}
      </span>
      <span className="flex items-center gap-1.5">
        {busy && <Loader2 className="w-3 h-3 animate-spin" style={{ color: '#ea580c' }} />}
        <button
          type="button"
          disabled={disabled || busy}
          onClick={onToggle}
          className="at-toggle rounded-full transition-colors flex-shrink-0"
          role="switch"
          aria-checked={on}
          aria-label={label}
          data-on={String(!!on)}
          data-disabled={String(!!disabled)}
          style={{ width: '32px', height: '18px', padding: '2px' }}
        >
          <span
            className="at-toggle-knob block rounded-full"
            style={{ width: '14px', height: '14px' }}
          />
        </button>
      </span>
    </div>
  )
}

function SecRow({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs" style={{ color: '#1c1917' }}>
      <span className="text-[10px] font-bold uppercase tracking-wider flex-shrink-0" style={{ color: LIGHT_INK }}>{label}</span>
      <span className="text-right min-w-0">{children}</span>
    </div>
  )
}
