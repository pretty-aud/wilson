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
//
// ── UI overhaul F2: this page is the kit's WORKED EXAMPLE ────────────────────
//
// Two jobs beyond the restyle:
//
//  1. It is the first page on the Q1 dark ground. Audrey ruled the six DATA
//     pages off `#f4a261` and onto the same `paper` the three tools use, so
//     the ecosystem reads as one app and — the part that actually matters
//     here — so that STATUS COLOUR works at all. On the light orange the
//     greens and reds measure 1.4:1 to 3.1:1, which is why this page drew
//     "Active" in a green nobody could read and everything else in one ink.
//
//  2. Every component in the kit that had no caller after F1 gets a real one
//     here, and none of them is invented: Badge is the producer/director
//     markers this page already drew, StatusBadge is the Active/Inactive pill
//     it already drew, Banner is the two error strips, Loading is the state
//     that used to say "Loading..." in the same italic as "No matches", and
//     EmptyState is that second one. A component with no caller is a
//     component nobody has tested against a real screen (plan risk 11: ten
//     features have shipped in this repo with no caller at all).
//
// What did NOT change: every column, every filter, every permission gate,
// every edit, the CSV export's column rules, the invite flow and the
// two-phase rate confirmation. Three things are deliberately different and
// each is sanctioned in the plan:
//
//   · The in-page <h1> is gone. The orange bar's PageHeader already says
//     "Team members"; rendering it twice is the divergence the review names
//     (F32's inventory: "Files renders its title twice").
//   · `window.confirm` for a deactivation is now a Dialog (plan §4: Dialog
//     "replaces 64 overlays and five window.confirm"). Same words, same two
//     outcomes, same single click to confirm.
//   · The hand-rolled rate modal is that same Dialog, so it inherits Escape,
//     the modal stack and the busy lock (Q17) instead of its own partial copy.
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Users, Search, Trash2, X, UserPlus, Eye, RotateCcw, Download, AlertTriangle,
} from 'lucide-react'
import { downloadCsv, exportDateStamp } from '../../lib/csvExport'
import {
  Badge, Banner, Button, Card, Dialog, EmptyState, Field, HoverActions,
  IconButton, Input, Loading, Row, Select, StatusBadge, Table, Tabs, Td, Th,
  Toolbar, useToast,
} from '../../ui'
import { useWorkspaceMembers, isOwnAvatarUrl } from './useWorkspaceMembers'
import { useRateCard, computeEntryTotal } from '../RateCard/useRateCard'
import { useRateCardAccess } from '../RateCard/useRateCardAccess'
import { atLeast } from '../../permissions/roleMatrix'
import PermissionGate from '../../permissions/PermissionGate'
import InviteMemberDialog from '../../cloud/auth/InviteMemberDialog'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'
import { supabase } from '../../cloud/auth/supabaseClient'
import { devFixtures } from '../../dev/devFixtures'
import { adminSetActive, isMissingFunction } from '../../cloud/adminApi'
import { loadOtterSettings } from '../../lib/localData'

const VIEW_STORAGE_KEY = 'wilson.team-members.view'
const VIEWS = [
  { key: 'admin',   label: 'Admin' },
  { key: 'manager', label: 'Manager' },
  { key: 'user',    label: 'User' },
]
const ROLE_LABELS = { admin: 'Admin', manager: 'Manager', user: 'User' }
const ROSTER_PANEL_ID = 'tm-roster-panel'

const DEFAULT_DEPARTMENTS = [
  'CG Art', 'Production', 'Creatives', 'Post', 'QA',
  'Audio', 'Physical Production', 'Development', 'Executive', 'Operations',
]

// `table-layout: fixed` reads the header row, so the columns are DECLARED
// here rather than emerging from whichever cell happened to be longest. The
// widths of the columns a view hides are never rendered; the browser
// redistributes the remainder.
// 🚨 These sum to EXACTLY 100 in the widest view — every column, Admin — and
// `tmColumnTotal` in the test file computes that from this object for all
// three views, because a declared width that over-sums is not declared at all:
// `table-layout: fixed` hands the excess back to the browser to reconcile and
// every column lands somewhere other than where it was written. An earlier cut
// summed to 112, a second to 109, and both carried a comment claiming 100.
// The number is checked now rather than asserted.
//
// The action column is a share rather than 56px for the same reason: a stray
// pixel value in a percentage table is a sum nobody can add up.
//
// The narrower views come in under 100 (Manager 86, User 75) and the browser
// shares the remainder, which is the intended behaviour.
//
// Department carries the widest real string ("Physical Production") inside a
// <select>, and a <select> has no `text-overflow` — it hard-clips mid-word
// rather than eliding. It takes the largest share of any data column for that
// reason, and both selects carry a `title` so a clipped value is still
// readable on hover.
const COL = {
  member: '16%', username: '8%', title: '11%', department: '14%',
  pronouns: '5%', fullTime: '5%', role: '10%', email: '10%',
  status: '5%', rate: '6%', projects: '6%', actions: '4%',
}
export const TM_COLUMN_WIDTHS = COL

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
  const toast = useToast()

  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [departments, setDepartments] = useState([])
  const [inviteOpen, setInviteOpen] = useState(false)
  const [rateModal, setRateModal] = useState(null) // { member, entry } | null
  // The deactivation confirm. It was `window.confirm`, which blocks the whole
  // renderer, cannot be styled, and on Windows announces itself as
  // "localhost says".
  const [confirmDeactivate, setConfirmDeactivate] = useState(null)
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
        // Dev fixtures (dev builds only): the dataset's roster, same row shape.
        const fx = import.meta.env.DEV ? devFixtures() : null
        const { data, error } = fx?.workspace
          ? fx.workspace.listProjectMemberships()
          : await supabase
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

  const pageError = wm.error || (showRate ? rc.error : null)
  const loading = (wm.loading || !wm.ready) && !wm.members.length

  // ── Roster CSV export (Session 14, Block B) ──
  // Exports EXACTLY the current view: same rows (filters + active-view
  // liveness rule) and same columns (email/status/rate ride the view
  // flags), so a basic user's export can never carry wage data — the rate
  // column only exists when showRate, and in cloud mode the entries behind
  // it are RLS-scoped anyway.
  function handleExportRoster() {
    const cols = [
      { key: 'display_name', header: 'Name' },
      { key: 'username',     header: 'Username' },
      { key: 'title',        header: 'Title' },
      { key: 'department',   header: 'Department' },
      { key: 'app_role',     header: 'App role' },
    ]
    if (showEmail) cols.push({ key: 'email', header: 'Email' })
    if (showStatus) cols.push({ key: 'status', header: 'Status', map: (m) => (m.is_active ? 'active' : 'deactivated') })
    // user_id, not id: directory rows have no id field — the screen keys
    // rate entries the same way (adversarial review, S14).
    if (showRate) cols.push({ key: 'wage', header: 'Wage', map: (m) => entryByUserId.get(m.user_id)?.wage ?? '' })
    const name = `team-roster-${exportDateStamp()}.csv`
    downloadCsv(name, filtered, cols)
    // F2: the export was the one action on this page that reported nothing
    // at all — the file appeared, or it did not. Naming it is FEEDBACK, not
    // a control: no click does anything new, and nothing is hidden behind it.
    toast.push({
      tone: 'success',
      title: 'Roster exported',
      body: `${filtered.length} member${filtered.length === 1 ? '' : 's'} to ${name}`,
    })
  }

  function runSetActive(member, active) {
    setAdminError(null)
    adminSetActive(member.user_id, active).then((res) => {
      if (res.ok) { wm.reload(); return }
      // Session 9: the Edge Function adds token revocation + last-admin
      // protection. Fall back to the direct update ONLY when the function
      // isn't deployed (bare 404) — a 404 with { error: 'not_found' } is a
      // real business error, and a network failure must not silently skip
      // the revocation the confirm dialog just promised.
      if (isMissingFunction(res)) {
        wm.setActive(member.user_id, active).catch(() => {})
        return
      }
      setAdminError(res.data.friendly)
    })
  }

  return (
    <div className="tm-page">
      <Toolbar
        wrap
        right={(
          <span className="tm-count">
            {filtered.length} member{filtered.length === 1 ? '' : 's'}
          </span>
        )}
      >
        {/* Saved views — only the views at or below your role. Three mutually
            exclusive filtered views of one table IS a tab bar; it was a
            segmented control with its own two-branch inline style. */}
        {availableViews.length > 1 && (
          <>
            <Eye className="tm-toolbar-glyph" aria-hidden="true" />
            <Tabs
              label="Saved views"
              panelId={ROSTER_PANEL_ID}
              items={availableViews.map(v => ({ id: v.key, label: v.label }))}
              value={activeView}
              onChange={pickView}
            />
          </>
        )}
        <PermissionGate requires="member.invite">
          <Button variant="primary" size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus aria-hidden="true" /> Invite user
          </Button>
        </PermissionGate>
        {/* Export the current view (Session 14) — columns follow the view
            flags, so this can never widen what the screen already shows. */}
        <Button
          size="sm"
          onClick={handleExportRoster}
          disabled={filtered.length === 0}
          title={filtered.length === 0 ? 'No members in the current view' : 'Export the current view as CSV'}
        >
          <Download aria-hidden="true" /> Export
        </Button>
        <Select
          size="sm"
          value={deptFilter}
          onChange={(v) => setDeptFilter(v ?? '')}
          placeholder="All departments"
          options={allDepts.map(d => ({ value: d, label: d }))}
          aria-label="Filter by department"
        />
        <span className="tm-search">
          <Search className="tm-toolbar-glyph" aria-hidden="true" />
          <Input
            size="sm"
            value={search}
            onChange={setSearch}
            placeholder="Search members"
            aria-label="Search members"
          />
          {search && (
            <IconButton icon={X} size="sm" title="Clear search" onClick={() => setSearch('')} />
          )}
        </span>
      </Toolbar>

      {/* The region the saved-view tabs switch. `tabpanel` plus the id the
          tabs point at with aria-controls, so the tablist is a promise the
          page keeps rather than a role with nothing behind it. */}
      <div
        className="tm-body"
        id={ROSTER_PANEL_ID}
        role={availableViews.length > 1 ? 'tabpanel' : undefined}
        aria-label={availableViews.length > 1 ? `${ROLE_LABELS[activeView] || activeView} view` : undefined}
        // A tabpanel with no focusable descendant needs its own tab stop, or a
        // keyboard user moves from the last tab straight past it. The loading
        // and empty branches are exactly that; the table brings its own.
        tabIndex={availableViews.length > 1 && (loading || filtered.length === 0) ? 0 : undefined}
      >
        {pageError && <Banner tone="danger" Icon={AlertTriangle}>{pageError}</Banner>}
        {/* No dismiss control: this strip did not have one, and adding one is
            a new control (C1). It still clears on the next action, as before. */}
        {adminError && <Banner tone="danger" Icon={AlertTriangle}>{adminError}</Banner>}

        {/* Loading and empty were the same picture in the same italic — which
            is the difference between "not yet" and "nothing here". */}
        {loading ? (
          <Loading rows={8} columns={7} label="Loading the roster" />
        ) : filtered.length === 0 ? (
          // No action slot: the Invite control is in the toolbar directly
          // above, and a second copy of it is a NEW control under C1 even
          // though it would only do what the first one does.
          <EmptyState
            Icon={Users}
            title={wm.members.length === 0 ? 'No members yet' : 'No matches'}
            body={wm.members.length === 0
              ? 'Invite your first teammate to this workspace.'
              : 'No member matches the current search and filters.'}
          />
        ) : (
          // §B1 — "there is a white box and white header for the box that
          // doesnt fit the visual language." It was a #d6d3d1 frame around a
          // #e7e5e4 header: a near-white card on the orange page (C9). The
          // REGION is kept (Law of Common Region) and is a Card now; the
          // table pads its own cells, so the card does not pad.
          <Card pad={false} className="tm-table-card">
            <Table
              aria-label="Workspace members"
              head={(
                <Row>
                  <Th width={COL.member}>Member</Th>
                  <Th width={COL.username}>Username</Th>
                  <Th width={COL.title}>Title</Th>
                  <Th width={COL.department}>Department</Th>
                  <Th width={COL.pronouns}>Pronouns</Th>
                  <Th width={COL.fullTime}>Full-time</Th>
                  <Th width={COL.role}>Role</Th>
                  {showEmail && <Th width={COL.email}>Email</Th>}
                  {showStatus && <Th width={COL.status}>Status</Th>}
                  {showRate && <Th width={COL.rate} numeric>Day rate</Th>}
                  <Th width={COL.projects}>Projects</Th>
                  {showActions && <Th width={COL.actions}><span className="tm-sr">Actions</span></Th>}
                </Row>
              )}
            >
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
                  onDeactivate={() => setConfirmDeactivate(m)}
                  onReactivate={() => runSetActive(m, true)}
                />
              ))}
            </Table>
          </Card>
        )}
      </div>

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

      {confirmDeactivate && (
        <Dialog
          title="Deactivate member"
          width="confirm"
          onClose={() => setConfirmDeactivate(null)}
          footer={(
            <>
              <Button onClick={() => setConfirmDeactivate(null)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={() => {
                  runSetActive(confirmDeactivate, false)
                  setConfirmDeactivate(null)
                }}
              >
                Deactivate
              </Button>
            </>
          )}
        >
          {/* The words are window.confirm's, unchanged — they are a promise
              about token revocation, and the fallback path depends on it. */}
          Deactivate &ldquo;{confirmDeactivate.display_name || confirmDeactivate.username}&rdquo;?
          {' '}Access cuts immediately; they are signed out everywhere within the hour.
        </Dialog>
      )}

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
  const who = member.display_name || member.username
  return (
    // `highlighted`, not `selected`: these rows carry a standing role, they
    // are not a selection the user made, and the kit draws the two
    // differently on purpose.
    <Row inactive={inactive} highlighted={highlighted}>
      <Td>
        <span className="tm-member">
          <Avatar member={member} />
          {/* `title` because the name is the one cell whose tail may elide
              when a row carries both staff badges. */}
          <span className="tm-name" title={who || undefined}>{who || '--'}</span>
          {staffBadges.map(b => (
            <Badge
              key={b}
              title={b === 'PRODUCER' ? 'Producer on at least one project' : 'Director on at least one project'}
            >
              {b === 'PRODUCER' ? 'Producer' : 'Director'}
            </Badge>
          ))}
          {isSelf && <Badge title="This is you">You</Badge>}
        </span>
      </Td>
      <Td>{member.username}</Td>
      <Td>
        {canEditProfile ? (
          <InlineText
            value={member.title || ''}
            onCommit={(title) => onUpdate({ title: title || null })}
            placeholder="Title"
            label={`Title for ${who}`}
          />
        ) : (
          <ReadValue value={member.title} />
        )}
      </Td>
      <Td>
        {canEditProfile ? (
          <Select
            size="sm"
            value={member.department || ''}
            placeholder="--"
            options={departments.map(d => ({ value: d, label: d }))}
            onChange={(department) => onUpdate({ department: department || null })}
            aria-label={`Department for ${who}`}
            title={member.department || undefined}
          />
        ) : (
          <ReadValue value={member.department} />
        )}
      </Td>
      <Td><ReadValue value={member.pronouns} /></Td>
      {/* Salaried staff or hired in (0059). Admin-only, and enforced DB-side
          by fn_ws_members_prevent_self_role_change — a member who could set
          this would choose which cost model they are billed under. The gate
          here is presentation; the trigger is the control. */}
      <Td>
        <PermissionGate
          requires="member.role.change"
          fallback={<span>{member.is_full_time ? 'Yes' : 'No'}</span>}
        >
          <input
            type="checkbox"
            className="tm-check"
            checked={!!member.is_full_time}
            onChange={(e) => onUpdate({ is_full_time: e.target.checked })}
            aria-label={`${who} is full-time staff`}
            title="Full-time staff populate the internal rate card"
          />
        </PermissionGate>
      </Td>
      <Td>
        {roleEditable ? (
          <PermissionGate
            requires="member.role.change"
            fallback={<span>{ROLE_LABELS[member.app_role] || member.app_role || '--'}</span>}
          >
            {isSelf ? (
              <span title="Ask another admin to change your role.">
                {ROLE_LABELS[member.app_role] || member.app_role || '--'}
              </span>
            ) : (
              <Select
                size="sm"
                value={member.app_role}
                options={[
                  { value: 'user',    label: 'User' },
                  { value: 'manager', label: 'Manager' },
                  { value: 'admin',   label: 'Admin' },
                ]}
                onChange={onSetRole}
                aria-label={`Role for ${who}`}
                title={ROLE_LABELS[member.app_role] || member.app_role || undefined}
              />
            )}
          </PermissionGate>
        ) : (
          <span>{ROLE_LABELS[member.app_role] || member.app_role || '--'}</span>
        )}
      </Td>
      {showEmail && <Td title={member.email || undefined}><ReadValue value={member.email} /></Td>}
      {showStatus && (
        <Td>
          {/* ONE semantic source. This was a two-branch inline style with a
              green that exists nowhere else in the app; on the dark ground
              the status tones are legible, which is half of why Q1 moved
              this page. */}
          <StatusBadge status={inactive ? 'offline' : 'active'} label={inactive ? 'Inactive' : 'Active'} />
        </Td>
      )}
      {showRate && (
        <Td numeric>
          <RateCell entry={rateEntry} editable={canEditRate} onEdit={onEditRate} />
        </Td>
      )}
      <Td title={assignedProjects.length ? assignedProjects.join(', ') : 'No project assignments'}>
        {/* §10-E: live project assignments (project_members via the
            workspace channel). */}
        {assignedProjects.length > 0 ? (
          <>
            {assignedProjects.slice(0, 2).join(', ')}
            {assignedProjects.length > 2 ? ` +${assignedProjects.length - 2}` : ''}
          </>
        ) : (
          <span className="tm-empty-value">--</span>
        )}
      </Td>
      {showActions && (
        <Td align="right">
          {/* Q17(b): revealed on hover AND on focus-within. These were
              permanently visible — 200 pieces of chrome on a 200-row roster —
              and hiding them behind hover WITHOUT the focus reveal would have
              turned each into a keyboard dead end. */}
          <HoverActions>
            {inactive ? (
              <IconButton icon={RotateCcw} size="sm" title={`Reactivate ${who}`} onClick={onReactivate} />
            ) : isSelf ? null : (
              <IconButton icon={Trash2} size="sm" danger title={`Deactivate ${who}`} onClick={onDeactivate} />
            )}
          </HoverActions>
        </Td>
      )}
    </Row>
  )
}

function Avatar({ member }) {
  const initial = (member.display_name || member.username || '?').trim().charAt(0).toUpperCase()
  if (isOwnAvatarUrl(member.avatar_url)) {
    return <img src={member.avatar_url} alt="" className="tm-avatar" />
  }
  return <span className="tm-avatar" aria-hidden="true">{initial}</span>
}

// Emptiness is italic and ONE ink. It used to be a lighter grey, which on
// this page measured 1.42:1 — "less important" rendered as "unreadable".
function ReadValue({ value }) {
  if (!value) return <span className="tm-empty-value">--</span>
  return <>{value}</>
}

function RateCell({ entry, editable, onEdit }) {
  const wage = formatMoney(entry?.wage, entry?.currency)
  const total = formatMoney(entry?.day_rate, entry?.currency) // day_rate = computed total
  const label = wage
    ? <>{wage}{total && total !== wage ? <span className="tm-rate-total"> / {total}</span> : null}</>
    : <span className="tm-empty-value">{editable ? 'Set rate' : '--'}</span>
  if (!editable) return label
  return (
    <button type="button" className="tm-cell-btn" onClick={onEdit} title="Edit rate card entry">
      {label}
    </button>
  )
}

// ─── Rate card editor — admin confirmation flow ───
// Phase 'form' collects wage/burden/overhead; phase 'confirm' shows the
// before → after summary and requires an explicit confirm click before the
// entry is written (rate_card.edit is admin-only; the modal is the second
// look the scope asks for).
//
// F2: the overlay, the backdrop, the Escape handler and the busy flag were
// private copies. It is the kit's Dialog now, so Escape, the modal stack and
// the busy lock come from one place (Q17) — and the error renders in the
// footer beside the button that failed, rather than above it.
function RateCardEditorModal({ member, entry, deptDefaults, onCancel, onConfirm }) {
  const [phase, setPhase] = useState('form')
  const [busy, setBusy] = useState(false)
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

  const TYPES = [{ value: 'percent', label: '%' }, { value: 'fixed', label: '$' }]

  return (
    <Dialog
      title={`${entry ? 'Edit rate' : 'Set rate'} — ${member.display_name || member.username}`}
      width="form"
      busy={busy}
      error={error || null}
      onClose={onCancel}
      footer={(
        <>
          <Button disabled={busy} onClick={phase === 'confirm' ? () => setPhase('form') : onCancel}>
            {phase === 'confirm' ? 'Back' : 'Cancel'}
          </Button>
          {/* F3: the kit's `loading` owns the busy state (D2 kit request K3) —
              the disable, `aria-busy`, the spinner and the label swap. It used
              to be a ternary on the label and a `disabled` prop, and nothing
              announced it. */}
          <Button
            variant="primary"
            loading={busy}
            loadingLabel="Saving…"
            onClick={phase === 'confirm' ? confirm : toConfirm}
          >
            {phase === 'confirm' ? 'Confirm change' : 'Review'}
          </Button>
        </>
      )}
    >
      {phase === 'form' ? (
        <div className="tm-rate-form">
          <Field label="Day rate (wage)">
            <Input type="number" min="0" value={wage} onChange={setWage} autoFocus />
          </Field>
          <div className="ui-field-row tm-rate-pair">
            <Field label="Burden">
              <Input type="number" min="0" value={burden} onChange={setBurden} placeholder="dept default" />
            </Field>
            <Field label="Type">
              <Select value={burdenType} options={TYPES} onChange={(v) => setBurdenType(v || 'percent')} />
            </Field>
          </div>
          <div className="ui-field-row tm-rate-pair">
            <Field label="Overhead">
              <Input type="number" min="0" value={overhead} onChange={setOverhead} placeholder="dept default" />
            </Field>
            <Field label="Type">
              <Select value={overheadType} options={TYPES} onChange={(v) => setOverheadType(v || 'percent')} />
            </Field>
          </div>
        </div>
      ) : (
        <div className="tm-rate-confirm">
          <p>
            Confirm the rate card change for{' '}
            <strong>{member.display_name || member.username}</strong>:
          </p>
          <p>
            Total day rate:{' '}
            {prevTotal != null && (
              <span className="tm-rate-prev">{formatMoney(prevTotal, entry?.currency)} &rarr; </span>
            )}
            <strong>{formatMoney(nextTotal, entry?.currency) || '--'}</strong>
          </p>
        </div>
      )}
    </Dialog>
  )
}

// ─── Inline cell editor ───
// Behaves exactly as it did: click to edit, Enter or blur commits, Escape
// reverts and closes.
//
// 🚨 The two keys are the kit Input's OWN contract, not a second copy here.
// Input blurs on Enter and, on Escape, reverts to the value the field had on
// focus and then blurs with the commit suppressed (`useEscapeRevert`). So
// `onCommit` is the write and `onBlur` only closes the editor. Handling Enter
// here as well would commit TWICE — Input's blur fires first and the key
// handler runs after it, with `value` not yet updated.
function InlineText({ value, onCommit, placeholder, label }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  if (editing) {
    return (
      <Input
        size="sm"
        autoFocus
        value={draft}
        onChange={setDraft}
        onCommit={() => { if (draft !== value) onCommit(draft) }}
        onBlur={() => setEditing(false)}
        aria-label={label}
      />
    )
  }
  return (
    <button
      type="button"
      className="tm-inline-edit"
      onClick={() => { setDraft(value); setEditing(true) }}
      aria-label={label}
    >
      {value || <span className="tm-empty-value">{placeholder || '--'}</span>}
    </button>
  )
}
