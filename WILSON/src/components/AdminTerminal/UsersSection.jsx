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
  Users, Search, X, UserPlus, KeyRound, Power, ChevronDown,
} from 'lucide-react'
import { isOwnAvatarUrl } from '../TeamMembers/useWorkspaceMembers'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'
import { adminResetPassword, adminSetActive, adminUserSecurity } from '../../cloud/adminApi'
import CreateUserDialog from './CreateUserDialog'
import MultiInviteDialog from './MultiInviteDialog'
import CredentialsPopup from './CredentialsPopup'
// UI overhaul C3b — this section renders on the Admin Terminal, which is a
// DARK page now (Q1). The `../lightSurface` import is gone: every ink, well,
// rule and table frame it supplied comes from a kit component or a token in
// `@theme`, which is what C8 asks for and what stopped the five table header
// copies drifting in the first place.
import Table, { Th, Td, Row } from '../../ui/Table'
import Toolbar from '../../ui/Toolbar'
import Button from '../../ui/Button'
import IconButton from '../../ui/IconButton'
import Input from '../../ui/Input'
import Select from '../../ui/Select'
import Chip from '../../ui/Chip'
import Badge from '../../ui/Badge'
import Banner from '../../ui/Banner'
import Menu from '../../ui/Menu'
import Dialog from '../../ui/Dialog'
import Switch from '../../ui/Switch'
import Spinner from '../../ui/Spinner'
import StatusBadge from '../../ui/StatusBadge'
import EmptyState from '../../ui/EmptyState'
import Loading from '../../ui/Loading'
import SectionTitle from '../../ui/SectionTitle'

const ROLE_LABELS = { admin: 'Admin', manager: 'Manager', user: 'User' }
const ROLE_OPTIONS = [
  { value: 'user', label: 'User' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Admin' },
]

// The ADD PEOPLE panel's width, in one place: the `Menu` needs it to know its
// own minimum and `openAddMenu` needs it to right-align to the trigger.
const ADD_MENU_WIDTH = 240

// The six roster columns, declared rather than emergent. `table-layout: fixed`
// makes the header row the grid, so these ARE the widths — AT-18's finding was
// that no table on the surface declared one and the roster's own `truncate`
// was therefore inert.
//
// 🚨 PERCENTAGES ALONE CANNOT SATISFY SIX COLUMNS HERE, and two rounds of
// rebalancing them proved it rather than fixing it. The page is capped at the
// data measure, so the section pane saturates near 1016px whatever the window
// does; with the detail panel open the table gets about 752. Measured against
// the longest real string in each column — `Mara Okonkwo` plus its YOU badge,
// `kenji.morimoto`, `Manager`, the RATE ACCESS header, `Deactivated`,
// `May 10, 2026` — the six minimums sum to about 101 percent of 752. There is
// no split that fits; the first one clipped Joined, the second clipped Role,
// the Rate access header and Status instead.
//
// So the table declares a FLOOR and the kit's scroller does the rest:
// `.ui-table-scroll` is `overflow: auto`, so below `--at-roster-min` the
// roster scrolls sideways instead of slicing words in half. `Deactivated` is
// the string that sets the floor — it is a real status with its own filter
// tab, and `.ui-badge` is `white-space: nowrap`, so a short column does not
// ellipsise it, it cuts the pill.
const COLS = ['31%', '16%', '10%', '12%', '16%', '15%']

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
  const [addMenuAt, setAddMenuAt] = useState(null)   // { x, y } | null
  const [dialog, setDialog] = useState(null)   // 'invite' | 'create' | null
  const [creds, setCreds] = useState(null)     // { username, password, context } | null
  const addBtnRef = useRef(null)

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

  // The kit `Menu` owns click-outside and Escape dismissal, so the two
  // document listeners this component ran for them are deleted rather than
  // duplicated. `.ui-menu` is `position: fixed`, so it takes VIEWPORT
  // coordinates: the trigger's own rect, right-aligned to it, which is where
  // the absolutely-positioned panel sat.
  function openAddMenu() {
    const r = addBtnRef.current?.getBoundingClientRect()
    if (!r) return
    setAddMenuAt({ x: r.right - ADD_MENU_WIDTH, y: r.bottom + 4 })
  }

  // 🚨 THE ANCHORED-MENU DOUBLE TOGGLE. `Menu` dismisses on a document
  // mousedown outside itself, and the trigger IS outside itself, so a second
  // click on the trigger runs close-then-open and the menu never shuts from
  // the button that opened it.
  //
  // The guard is on WHAT closed the menu, not on WHEN. A 300ms time gate also
  // swallowed the next click after ANY dismissal — press Escape, change your
  // mind, and ADD PEOPLE was a dead button for a third of a second, which is
  // well inside a deliberate sequence. This flag is set only by a mousedown
  // that landed on the trigger itself, and cleared by the click that follows
  // it, so no other dismissal can suppress anything.
  const swallowNextRef = useRef(false)
  // 🚨 THE FLAG IS CLEARED BY THE NEXT CLICK ANYWHERE, not by the next click
  // on the trigger. A mousedown on a button is not a promise of a click on
  // it: press-and-slide-off is the universal way to cancel a click, and with
  // the flag waiting only for its own trigger it stayed armed indefinitely —
  // through a section hop and back, because this component never unmounts.
  // The first real click on ADD PEOPLE then did nothing. That is worse than
  // the 300ms guard it replaced, on exactly the gesture people use to change
  // their mind.
  function armSwallow() {
    if (!addMenuAt) return
    swallowNextRef.current = true
    document.addEventListener('click', () => { swallowNextRef.current = false }, { once: true })
  }
  function toggleAddMenu() {
    if (swallowNextRef.current) { swallowNextRef.current = false; return }
    openAddMenu()
  }

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
    <div className="at-section at-users">
      <div className="at-users-main">
        <SectionTitle
          description="Everyone with an account in this workspace. Select a row to open their detail panel."
          actions={(
            <Button
              ref={addBtnRef}
              variant="primary"
              Icon={UserPlus}
              onMouseDown={armSwallow}
              onClick={toggleAddMenu}
            >
              Add people <ChevronDown aria-hidden="true" />
            </Button>
          )}
        >
          Users
        </SectionTitle>

        <Toolbar
          right={(
            <div className="at-filter-group">
              {STATUS_FILTERS.map(f => (
                <Chip
                  key={f.key}
                  active={statusFilter === f.key}
                  onClick={() => setStatusFilter(f.key)}
                >
                  {f.label}
                </Chip>
              ))}
            </div>
          )}
        >
          <Search className="at-search-glyph" aria-hidden="true" />
          <Input
            size="sm"
            value={search}
            onChange={setSearch}
            placeholder="Search username, name, email…"
            aria-label="Search members"
            className="at-search-input"
          />
          {search && (
            <IconButton size="sm" Icon={X} title="Clear search" onClick={() => setSearch('')} />
          )}
        </Toolbar>

        {addMenuAt && (
          <Menu
            x={addMenuAt.x}
            y={addMenuAt.y}
            minWidth={ADD_MENU_WIDTH}
            onClose={() => setAddMenuAt(null)}
            items={[
              {
                label: 'Invite by email…',
                hint: 'They set their own password',
                onClick: () => setDialog('invite'),
              },
              {
                label: 'Create with password…',
                hint: 'You hand over the credentials',
                onClick: () => setDialog('create'),
              },
            ]}
          />
        )}

        {wm.error && (
          <Banner
            tone="danger"
            action={<IconButton size="sm" Icon={X} title="Dismiss" onClick={wm.clearError} />}
          >
            {wm.error}
          </Banner>
        )}

        {/* Loading and empty are two states, not one string in one component
            (AT-15). The skeleton has the roster's own six columns, so the
            wait has the shape of the thing being waited for. */}
        {(wm.loading || !wm.ready) && !wm.members.length ? (
          <Loading rows={8} columns={6} label="Loading members" />
        ) : filtered.length === 0 ? (
          <EmptyState
            Icon={Users}
            title={wm.members.length === 0 ? 'No members yet' : 'No matches'}
            body={wm.members.length === 0
              ? 'Add your first teammate with the button above.'
              : 'No member matches this search and filter.'}
          />
        ) : (
          <Table
            className="at-roster"
            scrollClassName="at-roster-scroll"
            head={(
              <Row>
                <Th width={COLS[0]}>Member</Th>
                <Th width={COLS[1]}>Username</Th>
                <Th width={COLS[2]}>Role</Th>
                <Th width={COLS[3]}>Rate access</Th>
                <Th width={COLS[4]}>Status</Th>
                <Th width={COLS[5]}>Joined</Th>
              </Row>
            )}
          >
            {filtered.map(m => (
              /* 🚨 `selected` AND `inactive` ARE THE KIT'S PROPS, NOT
                 `data-*` ATTRIBUTES WRITTEN BY HAND, and the difference is a
                 defect rather than a style. `Row` writes
                 `data-selected={selected || undefined}` so the attribute is
                 ABSENT when false, and `index.css` keys on its PRESENCE
                 (`.ui-tr[data-selected]`). C3's extraction spelled these
                 `String(...)`, which renders `data-selected="false"` — an
                 attribute that is present. Passed straight through, every row
                 in the roster painted as selected AND deactivated at once,
                 and it did: caught in the running app, not by reading, with
                 every `<td>` measuring `rgba(234, 88, 12, 0.16)` while its
                 row reported `data-selected="false"`.

                 The page keeps no rule of its own for either state now. The
                 kit owns the one selected treatment and the one deactivated
                 ink, which is the convergence this bundle is for — and
                 `adminTerminalCss.test.js` has a guard so no `.at-*` element
                 can hand a String()-spelled attribute to a kit selector that
                 keys on presence again. */
              <Row
                key={m.user_id}
                onClick={() => setSelectedId(m.user_id)}
                interactive
                selected={selectedId === m.user_id}
                inactive={!m.is_active}
              >
                <Td>
                  <span className="at-member-cell">
                    <Avatar member={m} />
                    {/* The one column allowed to truncate, so it carries the
                        full value in a tooltip. */}
                    <span className="at-member-name" title={m.display_name || m.username || undefined}>
                      {m.display_name || m.username || '--'}
                    </span>
                    {m.user_id === wm.userId && <Badge>You</Badge>}
                  </span>
                </Td>
                <Td><span className="at-mono">{m.username}</span></Td>
                <Td>{ROLE_LABELS[m.app_role] || m.app_role || '--'}</Td>
                <Td><GrantChips member={m} /></Td>
                <Td>
                  <StatusBadge status={m.is_active ? 'active' : 'offline'} label={m.is_active ? 'Active' : 'Deactivated'} />
                </Td>
                <Td><span className="at-mono">{fmtDate(m.created_at)}</span></Td>
              </Row>
            ))}
          </Table>
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
      className="at-detail-panel wilson-dark-scroll"
      data-entered={String(entered)}
    >
      <div className="at-panel-head">
        <span className="at-panel-head-label">Member detail</span>
        <IconButton size="sm" Icon={X} title="Close (Esc)" onClick={onClose} />
      </div>

      {/* IDENTITY */}
      <GroupLabel>Identity</GroupLabel>
      <div className="at-identity">
        <Avatar member={member} size={40} />
        <div className="at-identity-text">
          <div className="at-identity-name">
            {name}
            {isSelf && <Badge>You</Badge>}
          </div>
          <div className="at-identity-handle">@{member.username}</div>
        </div>
      </div>
      <div className="at-identity-meta">
        {[member.title, member.department].filter(Boolean).join(' · ') || '--'}
      </div>
      <div className="at-identity-joined">
        Joined {fmtDate(member.created_at)}
      </div>

      {/* ACCESS */}
      <GroupLabel>Access</GroupLabel>
      <div className="at-row">
        <span className="at-row-label">Role</span>
        {isSelf ? (
          <span className="at-row-value" title="Ask another admin to change your role.">
            {ROLE_LABELS[member.app_role] || member.app_role}
          </span>
        ) : (
          <Select
            size="sm"
            value={member.app_role}
            onChange={(v) => wm.setRole(member.user_id, v).catch(() => {})}
            options={ROLE_OPTIONS}
            aria-label={`Role for ${name}`}
          />
        )}
      </div>
      {isSelf && <p className="at-note">Ask another admin to change your role.</p>}
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
        <Loading label="Loading security info" />
      ) : secError ? (
        <Banner tone="danger">{secError}</Banner>
      ) : security ? (
        <div className="at-sec-group">
          <SecRow label="Email">
            <span className="at-mono at-break">{security.email || '--'}</span>
            {typeof security.email === 'string' && security.email.endsWith('@mail.petalstudios.co') && (
              <Badge title="Synthesized address — this account cannot receive mail">no real inbox</Badge>
            )}
          </SecRow>
          <SecRow label="Last sign-in">
            <span className="at-mono" title={security.last_sign_in_at || ''}>{timeAgo(security.last_sign_in_at)}</span>
          </SecRow>
          <SecRow label="MFA">
            {/* A dot plus its own word, from the one source that decides a
                status colour (AT-30). The enrolled/not-enrolled pair used to
                be two hand-written fills, one of them a green that appears
                nowhere else on the surface. */}
            <StatusBadge
              tone={security.mfa_enrolled ? 'success' : 'neutral'}
              label={security.mfa_enrolled ? `Enrolled (${security.factor_count})` : 'Not enrolled'}
            />
          </SecRow>
          {security.banned_until && (
            <SecRow label="Banned">
              <StatusBadge tone="danger" label={`until ${fmtDate(security.banned_until)}`} />
            </SecRow>
          )}
        </div>
      ) : null}
      <Button size="sm" Icon={KeyRound} onClick={() => setModal({ kind: 'reset' })}>
        Reset password
      </Button>

      {/* DANGER ZONE — bottom, visually separated (Fitts: small + far). */}
      <div className="at-danger-zone">
        <span className="at-danger-label">Danger zone</span>
        {isSelf ? (
          <p className="at-note">You cannot deactivate yourself here.</p>
        ) : (
          /* Deactivate is `danger`; reactivate is not a destructive act and
             stops borrowing the destructive treatment in a second colour
             (the old green appeared on no other control). */
          <Button
            size="sm"
            variant={member.is_active ? 'danger' : 'secondary'}
            Icon={Power}
            onClick={() => setModal({ kind: 'active', next: !member.is_active })}
          >
            {member.is_active ? 'Deactivate' : 'Reactivate'}
          </Button>
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

  // No Escape listener here: `Dialog` owns the key and only the TOPMOST
  // modal answers it, which this one never checked — with the panel's own
  // Escape-to-close also bound, one press used to run both.
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
    <Dialog
      title={title}
      width="confirm"
      busy={busy}
      error={error || null}
      dismissOnBackdrop
      onClose={onCancel}
      footer={(
        <>
          <Button onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={go}
            loading={busy}
            loadingLabel="Working…"
          >
            {confirmLabel}
          </Button>
        </>
      )}
    >
      <p className="at-confirm-body">{children}</p>
    </Dialog>
  )
}

// ─── Atoms ───
//
// `MenuItem`, `ThLight` and `TdLight` are DELETED here rather than restyled.
// The menu is the kit `Menu`, whose label/hint pairing is the thing AT-01
// was about — this file's private copy painted the hint `LIGHT_INK` on a
// `#1c1917` panel, 1.00:1, invisible to every user since it shipped. The two
// table atoms were one of three byte-identical copies (Logs, Users, and the
// out-of-scope operator console) that had already forked; they are `Th` and
// `Td` now, where the fork cannot happen again.

function Avatar({ member, size = 24 }) {
  const initial = (member.display_name || member.username || '?').trim().charAt(0).toUpperCase()
  const px = `${size}px`
  if (isOwnAvatarUrl(member.avatar_url)) {
    return (
      <img
        src={member.avatar_url}
        alt=""
        className="at-avatar at-avatar-img"
        style={{ width: px, height: px }}
      />
    )
  }
  return (
    <div
      className="at-avatar at-avatar-initial"
      style={{ width: px, height: px, fontSize: size >= 40 ? 16 : 11 }}
    >
      {initial}
    </div>
  )
}

// Rate-access chips — Von Restorff: quietly distinct so granted rows pop
// without shouting wage data across the roster.
/**
 * Rate-access badges — Von Restorff: quietly distinct so granted rows read at
 * a glance without shouting wage data across the roster. Two hand-written
 * fills in two oranges become one `Badge`, which is the kit's inert label.
 */
function GrantChips({ member }) {
  const view = !!member.grant_rate_card_view
  const edit = !!member.grant_rate_card_edit
  if (!view && !edit) return <span className="at-none">--</span>
  return (
    <span className="at-grants">
      {(view || edit) && <Badge>View</Badge>}
      {edit && <Badge>Edit</Badge>}
    </span>
  )
}

function GroupLabel({ children }) {
  return <span className="at-group-label">{children}</span>
}

/**
 * A label-left / control-right settings row, which is the contract D1 set for
 * Settings and the shape this panel already had.
 *
 * 🚨 THE TRACK IS THE KIT `Switch` NOW, so `data-on` is gone and
 * `aria-checked` is the state — one switch app-wide instead of the six
 * hand-rolled toggles the plan counted. `adminTerminalState.test.jsx` asserts
 * `aria-checked`, which both spellings carried, so the guard that proves this
 * boolean is the RIGHT one survives the swap rather than being rewritten
 * alongside it.
 */
function ToggleRow({ label, on, busy, disabled, note, onToggle }) {
  return (
    <div className="at-toggle-row at-row" data-disabled={String(!!disabled)}>
      <span className="at-row-label">
        {label}
        {note && <span className="at-note-inline">{note}</span>}
      </span>
      <span className="at-row-control">
        {busy && <Spinner size="sm" label="Saving" />}
        <Switch
          checked={!!on}
          disabled={disabled || busy}
          onChange={onToggle}
          aria-label={label}
        />
      </span>
    </div>
  )
}

/**
 * A label/value pair inside the SECURITY group.
 *
 * 🚨 A GRID, NOT `justify-between` (AT-17). Pushed apart, four pairs give two
 * ragged edges facing each other and no column forms anywhere — the finding
 * named this surface as the worst case of it. A fixed label track means the
 * values start on one line down the panel, which is the alignment half of
 * Audrey's brief that spacing alone cannot deliver.
 */
function SecRow({ label, children }) {
  return (
    <div className="at-sec-row">
      <span className="at-sec-label">{label}</span>
      <span className="at-sec-value">{children}</span>
    </div>
  )
}
