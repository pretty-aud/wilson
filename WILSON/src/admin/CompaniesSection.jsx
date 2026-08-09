// =============================================================================
// CompaniesSection — Session 15: company lifecycle in the Operator Console.
//
// One table of every company on the platform, one detail panel per row, and
// four things you can do: create, rename, suspend/restore, tear down. Plus
// the per-company Anthropic key (locked #21) — set and clear only, because
// a stored key is never readable again by anyone (locked #8 applied to
// tenant credentials; the row holds ciphertext and a four-character hint).
//
// The design problem this file actually solves is that ONE of its five
// actions is irreversible and cross-tenant, and the other four are routine.
// Everything below follows from keeping those apart:
//
// UX laws applied (≥5):
//   Von Restorff — teardown is the only red control on the surface, it sits
//     alone below a rule at the bottom of the panel, and it is the only one
//     that opens a staged confirm. Nothing else is allowed to be red, so
//     red means exactly one thing here.
//   Fitts's Law — routine actions (rename, suspend, key) are grouped at the
//     top of the panel where the cursor already is after clicking a row;
//     teardown is deliberately far away and its confirm button starts
//     disabled, so the destructive target is small and distant while the
//     safe ones are large and near.
//   Cognitive Bias — the teardown confirm states REAL COUNTS fetched with
//     the list (members, projects, blobs) and requires the slug typed back.
//     Confirms that say "are you sure?" train people to click yes; a confirm
//     that says "12 members, 340 files, 1,204 blobs — type acme-studio"
//     cannot be cleared by reflex.
//   Peak-End — teardown does not end on an empty table. It ends on a
//     summary of what was actually destroyed (blobs found / removed /
//     failed), which is also the operator's receipt that the certificate
//     was written.
//   Selective Attention — suspended companies are dimmed and badged in
//     place rather than filtered away, so "this company is off" is visible
//     without anyone going looking for it.
//   Doherty Threshold — every action sets a per-row busy state immediately
//     and the list refreshes from the server afterwards rather than
//     optimistically, because these writes are too consequential to show a
//     result that has not happened yet.
//
// Enforcement note: every gate here is presentation. The Edge Functions
// re-check operator status against the live table, re-check the typed slug,
// and are the only path to any of these writes.
//
// ── Session 41: the Petal-cloud storage plane ────────────────────────────────
// Petal cloud becomes a paid, operator-managed product, so a sixth thing lives
// here: a company's storage quota, and whether their uploads are on hold. It is
// operator-owned in the structural sense — 0055 gives workspace_storage_plans a
// member READ policy and NO write policy at all, so this panel is the only path
// to a quota change anywhere in the product.
//
// Two rules from the sections above carry straight over, and one is new:
//
//   Von Restorff still holds — RED IS STILL RESERVED FOR TEARDOWN. A storage
//     hold is a billing decision, fully reversible, and nothing is deleted; it
//     gets the console's amber (#b45309, the same token ModelsSection uses for
//     "unverified") and the ordinary dark button, never red. If suspending a
//     late payer looked like tearing a company down, red would stop meaning
//     "irreversible" and the one control that needs the flinch would lose it.
//   Doherty/no-optimism still holds — every write below goes through run(),
//     which reloads the list from the server. A control that called the API
//     directly would succeed and leave the table showing pre-write bytes.
//   NEW: a failed reading renders as UNKNOWN, never as zero. The storage read
//     is a SECOND call that can fail on its own, and it must never take the
//     companies table down with it — but a usage bar sitting at 0% because the
//     query broke is worse than a blank one, for exactly the reason
//     countFilesAtProvider states: "0 files affected" on the strength of a
//     failed query is the reassurance that makes someone click through.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, RefreshCw, KeyRound, Trash2, Check, Copy } from 'lucide-react'
import {
  listWorkspaces,
  createWorkspace,
  renameWorkspace,
  setWorkspaceSuspended,
  teardownWorkspace,
  setWorkspaceAiKey,
  clearWorkspaceAiKey,
  listStoragePlans,
  setStoragePlan,
  clearStoragePlan,
  setStoragePlanSuspended,
  isMissingFunction,
} from './operatorApi'
// 🚨 NOT a local copy of this formatter. Its own header states the reason: both
// terminals render the same figures, and two roundings of one number side by
// side read as a bug. An operator quoting "1.4 GB" at a customer looking at
// "1.5 GB" in their own Storage screen is a support call, not a rounding.
import { formatBytes } from '../cloud/workspaceStorage'

const cardStyle = {
  backgroundColor: 'rgba(120, 70, 30, 0.12)',
  border: '1px solid rgba(120, 70, 30, 0.3)',
}
const darkBtnClass =
  'flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors disabled:opacity-40'
const darkBtnStyle = { backgroundColor: '#1c1917', color: '#f4a261' }
const lightInputStyle = {
  backgroundColor: 'rgba(120, 70, 30, 0.55)',
  color: '#fde8d0',
  border: 'none',
}
const inputClass =
  'px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500'

function ThLight({ children }) {
  return (
    <th
      className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-left"
      style={{ color: '#57534e' }}
    >
      {children}
    </th>
  )
}
function TdLight({ children }) {
  return <td className="px-3 py-2 align-middle">{children}</td>
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/

// ── Session 41 storage-plan constants ────────────────────────────────────────
// The operator types GB and the API takes BYTES. GB here means GiB (1024³),
// which is what formatBytes already divides by and what storage_free_tier_bytes()
// returns for the free allowance — so "1 GB free" on this screen is the same 1 GB
// the member-facing Storage screen shows. Mixing 1000³ in here would put the two
// terminals a comfortable 7% apart and neither would look wrong.
const GIB = 1024 ** 3
// Mirrors QUOTA_MAX in the operator-storage-plans function, which itself mirrors
// workspace_storage_plans_quota_chk in 0055. The CHECK is the authority; this
// copy exists only so the Save button greys out instead of the operator getting
// a 400 back. Kept in step by hand — three places, all commented as such.
const QUOTA_MAX_BYTES = 109951162777600 // 100 TiB
// The console's amber. Not a new colour: ModelsSection already uses #b45309 for
// "noteworthy but not wrong", which is exactly what a storage hold is.
const AMBER = '#b45309'

// One company's storage figures for the table. Deliberately its own component so
// the "no reading = —" branch is a single place rather than three inline
// ternaries that each have to remember not to print a zero.
//
// `plan` is null in two different situations that must render identically: the
// plan read failed, or it succeeded and this workspace was not in it (which
// should be impossible — operator_storage_plan_summary() left-joins from
// workspaces — but "impossible" is not a rendering strategy). Both are unknown.
function StorageCell({ plan }) {
  if (!plan) {
    return <span className="text-[11px]" style={{ color: '#a8a29e' }}>—</span>
  }
  // `status` is the PLAN's status. It is not row.deleted_at, which is the
  // company's own suspension and already has a badge in the first column — a
  // paid-up company can be suspended, and a live company can be over its bill.
  const held = plan.status === 'suspended'
  return (
    <>
      {/* Same used/total grammar as the Members column two cells to the left. */}
      <span className="text-xs" style={{ color: '#1c1917' }}>{formatBytes(plan.used_bytes)}</span>
      <span className="text-[10px]" style={{ color: '#78716c' }}>/{formatBytes(plan.quota_bytes)}</span>
      {held && (
        <span
          className="ml-1.5 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-sm"
          style={{ backgroundColor: 'rgba(180,83,9,0.15)', color: AMBER }}
          title="Petal cloud uploads are suspended for this company. Nothing stored has been deleted."
        >
          Hold
        </span>
      )}
      {!held && !plan.has_plan && (
        // No plan row at all — the free tier. Said quietly, because it is the
        // default state of most of the table and a badge on every row is noise.
        <span className="ml-1.5 text-[10px]" style={{ color: '#a8a29e' }}>free</span>
      )}
    </>
  )
}

export default function CompaniesSection({ isActive }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [creating, setCreating] = useState(false)
  const [credentials, setCredentials] = useState(null)
  // Teardown's result lives HERE, not in the panel. The panel is rendered only
  // while its row exists in `rows`; a successful teardown removes that row on
  // the very next reload, so a receipt held in panel state would unmount the
  // instant it had something to say. Peak-End: the last thing an operator sees
  // after destroying a company must be what was actually destroyed.
  const [tornDown, setTornDown] = useState(null)
  // Session 41. `plans` is an object keyed by workspace_id, or NULL meaning the
  // reading could not be taken — the two are not the same and must not collapse.
  // An empty object would be a legitimate "no companies have plans", which is a
  // real and common state; null is "we do not know", which is a caveat.
  const [plans, setPlans] = useState(null)
  // The storage read's failure has its own line, separate from `error`. The red
  // banner above means the console could not list companies; a storage read that
  // fails degrades one column and must not borrow the colour of an outage.
  const [planError, setPlanError] = useState('')

  // StrictMode-safe mounted flag + stale-response guard + one-shot lazy load,
  // the AdminTerminal section contract.
  const mountedRef = useRef(true)
  const loadedRef = useRef(false)
  const seqRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const reload = useCallback(async () => {
    const seq = ++seqRef.current
    setLoading(true)
    // Both reads are issued together and settled together, so there is ONE load
    // path: Refresh, the lazy first load, and every run() in the panel all
    // update the counts and the bytes at the same moment. A second, independent
    // storage fetch would have its own timing and its own failures, and the
    // table would periodically describe two different instants at once.
    const [res, planRes] = await Promise.all([listWorkspaces(), listStoragePlans()])
    if (!mountedRef.current || seq !== seqRef.current) return
    setLoading(false)

    // 🚨 The storage reading is settled FIRST and INDEPENDENTLY of the company
    // list, and nothing below it returns early on its behalf. A storage read is
    // a nice-to-have column; the companies table is the console. Folding this
    // into the `if (!res.ok)` branch would mean a missing operator-storage-plans
    // function took the whole section down in any environment where it has not
    // been deployed yet — which, on the day this ships, is two of the three.
    if (planRes.ok) {
      setPlanError('')
      const byId = {}
      for (const p of planRes.data?.plans ?? []) byId[p.workspace_id] = p
      setPlans(byId)
    } else {
      // null, not {} — see the state declaration. Every cell falls back to '—'.
      setPlans(null)
      setPlanError(isMissingFunction(planRes)
        ? 'operator-storage-plans is not deployed in this environment yet — storage figures are unavailable.'
        : (planRes.data?.friendly ?? 'Could not read storage plans — the figures below are unknown, not zero.'))
    }

    if (!res.ok) {
      setError(isMissingFunction(res)
        ? 'operator-workspaces is not deployed in this environment yet.'
        : (res.data?.friendly ?? 'Could not load companies.'))
      return
    }
    setError('')
    setRows(res.data?.workspaces ?? [])
  }, [])

  useEffect(() => {
    if (!isActive || loadedRef.current) return
    loadedRef.current = true
    reload()
  }, [isActive, reload])

  const selected = rows.find((r) => r.workspace_id === selectedId) ?? null
  // The single lookup. Returns null for "unknown" in every case, so no caller
  // ever has to decide what a missing plan means.
  const planFor = (id) => (plans ? (plans[id] ?? null) : null)

  return (
    <div className="pb-8" style={{ maxWidth: '900px' }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900">Companies</h2>
          <p className="text-xs text-stone-950 leading-relaxed">
            Every workspace on the platform. Counts are live.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={reload} disabled={loading} className={darkBtnClass} style={darkBtnStyle}>
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={() => setCreating(true)} className={darkBtnClass} style={darkBtnStyle}>
            <Plus size={12} /> New company
          </button>
        </div>
      </div>

      {error && (
        <p className="text-[11px] mb-3 px-3 py-2 rounded-sm" style={{ backgroundColor: 'rgba(220,38,38,0.10)', color: '#991b1b' }}>
          {error}
        </p>
      )}

      {/* Amber, not red, and it says what the column now means. The operator has
          to be able to tell "this company uses nothing" from "we could not find
          out", and the only place that distinction can be made is here — the
          cells themselves can only show a dash. */}
      {planError && (
        <p className="text-[11px] mb-3 px-3 py-2 rounded-sm" style={{ backgroundColor: 'rgba(180,83,9,0.10)', color: AMBER }}>
          {planError} Storage reads as “—” below; it is not zero.
        </p>
      )}

      <div className="overflow-auto rounded-sm wilson-light-scroll mb-6" style={{ border: '1px solid #d6d3d1' }}>
        <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr style={{ backgroundColor: '#e7e5e4' }}>
              <ThLight>Company</ThLight>
              <ThLight>Slug</ThLight>
              <ThLight>Members</ThLight>
              <ThLight>Projects</ThLight>
              <ThLight>Files</ThLight>
              {/* Next to Files, because they are the same question at two
                  granularities: how many objects, and how many bytes. */}
              <ThLight>Storage</ThLight>
              <ThLight>AI key</ThLight>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-xs" style={{ color: '#78716c' }}>
                  No companies yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.workspace_id}
                onClick={() => setSelectedId(r.workspace_id === selectedId ? null : r.workspace_id)}
                className="cursor-pointer"
                style={{
                  borderBottom: '1px solid #e7e5e4',
                  backgroundColor: r.workspace_id === selectedId ? 'rgba(234, 88, 12, 0.10)' : 'transparent',
                  // Selective Attention: a suspended tenant stays in place and
                  // reads as off, rather than quietly leaving the list.
                  opacity: r.deleted_at ? 0.55 : 1,
                }}
              >
                <TdLight>
                  <span className="text-xs font-semibold text-stone-900">{r.name}</span>
                  {r.deleted_at && (
                    <span className="ml-2 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-sm"
                      style={{ backgroundColor: 'rgba(220,38,38,0.15)', color: '#991b1b' }}>
                      Suspended
                    </span>
                  )}
                </TdLight>
                <TdLight><code className="text-[11px] font-mono" style={{ color: '#57534e' }}>{r.slug}</code></TdLight>
                <TdLight>
                  <span className="text-xs" style={{ color: '#1c1917' }}>{r.active_members}</span>
                  <span className="text-[10px]" style={{ color: '#78716c' }}>/{r.member_count}</span>
                </TdLight>
                <TdLight><span className="text-xs" style={{ color: '#1c1917' }}>{r.project_count}</span></TdLight>
                <TdLight><span className="text-xs" style={{ color: '#1c1917' }}>{r.file_count}</span></TdLight>
                <TdLight><StorageCell plan={planFor(r.workspace_id)} /></TdLight>
                <TdLight>
                  {r.has_ai_key
                    ? <code className="text-[11px] font-mono" style={{ color: '#166534' }}>…{r.ai_key_hint}</code>
                    : <span className="text-[11px]" style={{ color: '#a8a29e' }}>platform</span>}
                </TdLight>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {tornDown && (
        <div className="p-4 rounded-sm mb-4" style={{ backgroundColor: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.35)' }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: '#991b1b' }}>
                {tornDown.slug} torn down
              </p>
              {/* Honest counts. `removed` is what the bucket actually deleted,
                  not what was attempted — `missing` covers keys the bucket had
                  no object for (already GC'd, or a drifted path), and
                  `rejected` covers rows pointing outside this workspace's own
                  projects, which teardown refuses to touch. */}
              <p className="text-[11px] leading-relaxed" style={{ color: '#57534e' }}>
                {tornDown.blobs_removed} of {tornDown.blobs_found} blob(s) purged
                {tornDown.blobs_missing > 0 && <> · {tornDown.blobs_missing} already gone</>}
                {tornDown.blobs_failed > 0 && <> · <strong>{tornDown.blobs_failed} failed</strong></>}
                {tornDown.blobs_rejected > 0 && (
                  <> · <strong>{tornDown.blobs_rejected} refused</strong> (paths outside this company — see the Audit log)</>
                )}.
                A deletion certificate is in the Audit log and survives the company.
              </p>
            </div>
            <button
              onClick={() => setTornDown(null)}
              className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm flex-shrink-0"
              style={{ backgroundColor: 'transparent', color: '#57534e' }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {selected && (
        <CompanyPanel
          key={selected.workspace_id}
          row={selected}
          // Null until the storage read succeeds. The panel renders that as
          // unknown and still lets the operator set a quota — not knowing the
          // current usage is no reason to be unable to raise the ceiling.
          plan={planFor(selected.workspace_id)}
          onDone={reload}
          onTornDown={(result) => { setTornDown(result); setSelectedId(null) }}
        />
      )}

      {creating && (
        <CreateCompanyDialog
          onCancel={() => setCreating(false)}
          onCreated={(payload) => {
            setCreating(false)
            setCredentials(payload)
            reload()
          }}
        />
      )}

      {credentials && (
        <CredentialsDialog payload={credentials} onClose={() => setCredentials(null)} />
      )}
    </div>
  )
}

// ── Detail panel ─────────────────────────────────────────────────────────────

function CompanyPanel({ row, plan, onDone, onTornDown }) {
  const [name, setName] = useState(row.name)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [keyInput, setKeyInput] = useState('')
  const [showKeyField, setShowKeyField] = useState(false)

  // ── Session 41 storage-plan state ─────────────────────────────────────────
  // Seeded from the plan ONLY when there is one. A free-tier company gets an
  // EMPTY box, not a prefilled "1": prefilling the effective quota would let a
  // stray click on Save create a plan row at exactly the allowance the company
  // already had — no visible change, but they have silently moved from "free
  // tier" to "on a plan", which is the state Suspend acts on. An empty box makes
  // creating a plan a thing you typed.
  //
  // This panel is remounted per row (key={workspace_id}), so no reset effect is
  // needed on selection change. It does NOT re-seed when `plan` arrives late
  // after a failed first read — the placeholder shows the quota in force, so the
  // operator is not misled, and re-seeding would fight anything they had typed.
  // Rounded to one decimal for the same reason the placeholder is: a quota
  // stored as a byte count that is not a whole number of GiB would otherwise
  // seed the box with 2.4999999998, and saving that back would move the quota.
  const [quotaGb, setQuotaGb] = useState(() =>
    plan?.has_plan ? String(Math.round((Number(plan.quota_bytes) / GIB) * 10) / 10) : '')
  const [note, setNote] = useState('')

  // Explicit Number(): PostgREST hands bigints back as STRINGS once they pass
  // the safe-integer range, and `usedBytes / quotaBytes` on two strings is NaN
  // while `usedBytes + ''` would have concatenated. Same coercion, same reason,
  // as fetchStorageUsage.
  const usedBytes = plan ? Number(plan.used_bytes ?? 0) : null
  const quotaBytes = plan ? Number(plan.quota_bytes ?? 0) : null
  // null, not 0, when there is no reading or a nonsense quota — every consumer
  // below tests for null rather than falsiness, because 0% is a real answer.
  const usedPct = plan && quotaBytes > 0 && Number.isFinite(usedBytes)
    ? Math.round((usedBytes / quotaBytes) * 100)
    : null
  const held = plan?.status === 'suspended'
  const hasPlan = !!plan?.has_plan
  // 🚨 `plan` is null for BOTH "the read failed" and "no such row", so
  // `!hasPlan` is NOT "free tier" — it is "not known to be on a plan". Only a
  // reading that CAME BACK and says has_plan:false is the free allowance.
  // That is this file's own rule (a failed reading renders as UNKNOWN, never as
  // zero) applied to has_plan and not just to bytes — S41's review found the
  // card asserting "on the free allowance already" beside its own "this is
  // unknown" banner, from a query that never answered.
  const knownFree = !!plan && !plan.has_plan

  // GB in the box, bytes on the wire. Math.round because the CHECK wants a whole
  // number, and the >= 1 test because Math.round(0.0000000001 * GIB) is 0, which
  // is below QUOTA_MIN — a positive GB figure is not automatically a valid byte
  // count. The server re-checks all of this; this only decides the disabled bit.
  const quotaGbNum = Number(quotaGb.trim())
  const quotaBytesTyped = Number.isFinite(quotaGbNum) ? Math.round(quotaGbNum * GIB) : NaN
  const quotaOk =
    quotaGb.trim() !== '' &&
    Number.isFinite(quotaGbNum) &&
    quotaGbNum > 0 &&
    quotaBytesTyped >= 1 &&
    quotaBytesTyped <= QUOTA_MAX_BYTES

  // Teardown is its own little state machine so the confirm cannot be
  // half-open while another action runs. There is no 'done' state: on success
  // this panel is about to be unmounted (its row is gone), so the receipt is
  // handed up to CompaniesSection instead.
  const [tearStage, setTearStage] = useState('idle') // idle | confirm | running
  const [tearConfirm, setTearConfirm] = useState('')

  const run = useCallback(async (label, fn, okMsg) => {
    setBusy(label); setErr(''); setMsg('')
    const res = await fn()
    setBusy('')
    if (!res.ok) { setErr(res.data?.friendly ?? 'Action failed.'); return false }
    setMsg(okMsg)
    await onDone()
    return true
  }, [onDone])

  return (
    <div className="p-4 rounded-sm" style={cardStyle}>
      <h3 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">{row.name}</h3>
      <p className="text-xs text-stone-950 mb-4 leading-relaxed">
        <code className="font-mono">{row.slug}</code> · created{' '}
        {new Date(row.created_at).toLocaleDateString()} ·{' '}
        {row.admin_count} admin{row.admin_count === 1 ? '' : 's'}
        {row.blob_count > 0 && <> · {row.blob_count} cloud blob{row.blob_count === 1 ? '' : 's'}</>}
      </p>

      {msg && <p className="text-[11px] mb-3" style={{ color: '#166534' }}>{msg}</p>}
      {err && <p className="text-[11px] mb-3" style={{ color: '#991b1b' }}>{err}</p>}

      {/* Rename — the slug is immutable by trigger and part of sign-in. */}
      <div className="flex items-end gap-2 mb-4">
        <div className="flex-1">
          <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#57534e' }}>
            Display name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`w-full ${inputClass}`}
            style={lightInputStyle}
          />
        </div>
        <button
          className={darkBtnClass}
          style={darkBtnStyle}
          disabled={!!busy || name.trim() === row.name || name.trim().length === 0}
          onClick={() => run('rename', () => renameWorkspace(row.workspace_id, name.trim()), 'Renamed.')}
        >
          {busy === 'rename' ? 'Saving…' : 'Rename'}
        </button>
      </div>
      <p className="text-[10px] mb-4" style={{ color: '#78716c' }}>
        The slug is permanent — it is part of sign-in.
      </p>

      {/* Suspend / restore — reversible, so it is a normal button. */}
      <div className="flex items-center gap-2 mb-4">
        <button
          className={darkBtnClass}
          style={darkBtnStyle}
          disabled={!!busy}
          onClick={() => run(
            'suspend',
            () => setWorkspaceSuspended(row.workspace_id, !row.deleted_at),
            row.deleted_at ? 'Restored.' : 'Suspended.',
          )}
        >
          {busy === 'suspend'
            ? 'Working…'
            : row.deleted_at ? 'Restore company' : 'Suspend company'}
        </button>
        <span className="text-[10px]" style={{ color: '#78716c' }}>
          {row.deleted_at
            ? 'Members regain access immediately.'
            : 'Members lose access immediately. Nothing is deleted, and it can be undone.'}
        </span>
      </div>

      {/* Per-company Anthropic key. */}
      <div className="mb-2 pt-3" style={{ borderTop: '1px solid rgba(120,70,30,0.25)' }}>
        <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#57534e' }}>
          Anthropic key
        </label>
        <p className="text-[10px] mb-2 leading-relaxed" style={{ color: '#78716c' }}>
          {row.has_ai_key
            ? <>This company bills to its own key (…{row.ai_key_hint}). A stored key is never readable again — replace it or clear it.</>
            : <>This company bills to the platform key. Setting one here overrides that for every AI feature they use.</>}
        </p>
        {showKeyField ? (
          <div className="flex items-end gap-2">
            <input
              type="password"
              autoComplete="off"
              placeholder="sk-ant-…"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              className={`flex-1 ${inputClass}`}
              style={lightInputStyle}
            />
            <button
              className={darkBtnClass}
              style={darkBtnStyle}
              disabled={!!busy || keyInput.trim().length < 20}
              onClick={async () => {
                const ok = await run('key', () => setWorkspaceAiKey(row.workspace_id, keyInput.trim()), 'Key stored.')
                if (ok) { setKeyInput(''); setShowKeyField(false) }
              }}
            >
              {busy === 'key' ? 'Checking…' : 'Store key'}
            </button>
            <button
              className={darkBtnClass}
              style={{ backgroundColor: 'transparent', color: '#57534e' }}
              onClick={() => { setShowKeyField(false); setKeyInput('') }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button className={darkBtnClass} style={darkBtnStyle} onClick={() => setShowKeyField(true)}>
              <KeyRound size={12} /> {row.has_ai_key ? 'Replace key' : 'Set key'}
            </button>
            {row.has_ai_key && (
              <button
                className={darkBtnClass}
                style={{ backgroundColor: 'transparent', color: '#57534e' }}
                disabled={!!busy}
                onClick={() => run('clearkey', () => clearWorkspaceAiKey(row.workspace_id), 'Key cleared — back to the platform key.')}
              >
                {busy === 'clearkey' ? 'Clearing…' : 'Clear'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Petal cloud storage (Session 41) ─────────────────────────────────
          Routine and reversible, so it sits UP HERE with rename and the key,
          above the teardown rule — Fitts's Law, same as everything else the
          operator does more than once a year. Every control goes through run(). */}
      <div className="mb-2 pt-3" style={{ borderTop: '1px solid rgba(120,70,30,0.25)' }}>
        <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#57534e' }}>
          Petal cloud storage
        </label>

        {plan ? (
          <>
            <p className="text-[10px] mb-2 leading-relaxed" style={{ color: '#78716c' }}>
              <strong style={{ color: '#1c1917' }}>{formatBytes(usedBytes)}</strong> of{' '}
              <strong style={{ color: '#1c1917' }}>{formatBytes(quotaBytes)}</strong> used
              {usedPct !== null && <> · {usedPct}%</>}
              {' · '}
              {/* The resolved figure is already printed by formatBytes above,
                  so this only names the STATE. 0055 §3's rule is that the
                  numeral lives in storage_free_tier_bytes() and the client
                  never carries a copy — three hard-coded "1 GB" strings on this
                  screen would each have to be found and changed the day the
                  allowance moves. */}
              {hasPlan
                ? 'set plan'
                : 'the free allowance — this company has no plan row'}
              {held && <> · <strong style={{ color: AMBER }}>uploads on hold</strong></>}
              {hasPlan && plan.updated_at && (
                <> · last changed {new Date(plan.updated_at).toLocaleDateString()}</>
              )}
            </p>
            {usedPct !== null && (
              // Clamped, because usage CAN exceed quota: the quota gates new
              // uploads, it does not shrink what is already stored, and an
              // operator lowering a quota below current usage is a legitimate
              // (if unkind) act. A bar drawn at 140% would break the card.
              <div className="mb-3 rounded-sm" style={{ height: '4px', backgroundColor: 'rgba(120,70,30,0.25)' }}>
                <div
                  style={{
                    height: '4px',
                    width: `${Math.min(100, Math.max(0, usedPct))}%`,
                    borderRadius: '2px',
                    // Amber at the ceiling — noteworthy, not destructive. Red
                    // belongs to teardown and to nothing else on this surface.
                    backgroundColor: usedPct >= 100 ? AMBER : 'rgba(120,70,30,0.55)',
                  }}
                />
              </div>
            )}
          </>
        ) : (
          // 🚨 The whole reason this branch exists. No reading = say so. A bar
          // sitting at 0% because the read failed tells the operator this
          // company is using nothing, which is the most reassuring possible
          // rendering of "we have no idea".
          <p className="text-[10px] mb-3 leading-relaxed" style={{ color: AMBER }}>
            Usage and quota are <strong>unknown</strong> — the storage plan read
            did not come back. This is not zero. Refresh before judging anything
            by it. You can still set a quota, but nothing here tells you what it
            would replace; suspend and clear stay unavailable until the read
            succeeds.
          </p>
        )}

        {/* The note comes BEFORE the buttons on purpose: it applies to whichever
            one is pressed, and a field underneath them is a field nobody fills. */}
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Why (optional) — e.g. invoice 118 paid, chasing payment"
          className={`w-full ${inputClass} mb-1`}
          style={lightInputStyle}
        />
        <p className="text-[10px] mb-2 leading-relaxed" style={{ color: '#78716c' }}>
          The note goes to the platform audit log with whichever action you press
          — never onto the plan row itself, which this company’s own members can
          read.
        </p>

        <div className="flex items-end gap-2 mb-2">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#57534e' }}>
              Quota (GB)
            </label>
            <input
              value={quotaGb}
              onChange={(e) => setQuotaGb(e.target.value)}
              inputMode="decimal"
              // The placeholder carries the quota actually in force, so an empty
              // box is never ambiguous about what this company has today.
              placeholder={plan ? String(Math.round((quotaBytes / GIB) * 10) / 10) : '—'}
              className={inputClass}
              style={{ ...lightInputStyle, width: '110px' }}
            />
          </div>
          <button
            className={darkBtnClass}
            style={darkBtnStyle}
            disabled={!!busy || !quotaOk}
            onClick={async () => {
              const ok = await run(
                'quota',
                () => setStoragePlan({
                  workspaceId: row.workspace_id,
                  quotaBytes: quotaBytesTyped,
                  note: note.trim(),
                }),
                'Quota saved.',
              )
              // Clear the note only on success. Carrying it forward would
              // silently attach "invoice 118 paid" to the next unrelated action
              // in the audit log; keeping it on failure means a retry does not
              // have to retype it.
              if (ok) setNote('')
            }}
          >
            {busy === 'quota' ? 'Saving…' : hasPlan ? 'Save quota' : 'Set quota'}
          </button>
          {/* 🚨 NOT RED. Suspending a late payer is reversible and destroys
              nothing; red on this surface means teardown and only teardown. */}
          <button
            className={darkBtnClass}
            style={darkBtnStyle}
            disabled={!!busy || !hasPlan}
            onClick={async () => {
              const ok = await run(
                'hold',
                () => setStoragePlanSuspended(row.workspace_id, !held, note.trim()),
                held ? 'Uploads restored.' : 'Uploads suspended.',
              )
              if (ok) setNote('')
            }}
          >
            {busy === 'hold' ? 'Working…' : held ? 'Restore uploads' : 'Suspend uploads'}
          </button>
          {hasPlan && (
            <button
              className={darkBtnClass}
              style={{ backgroundColor: 'transparent', color: '#57534e' }}
              disabled={!!busy}
              onClick={async () => {
                const ok = await run(
                  'clearplan',
                  () => clearStoragePlan(row.workspace_id, note.trim()),
                  // 🚨 NO NUMERAL, and deliberately NOT formatBytes(quotaBytes)
                  // either: run() takes okMsg as an already-built string, and at
                  // that moment quotaBytes still derives from the PRE-clear plan
                  // — the paid quota just deleted. Interpolating there would
                  // report the plan you removed as the allowance you fell back
                  // to. The panel re-renders the resolved figure underneath.
                  'Plan cleared — back to the free allowance.',
                )
                if (ok) setNote('')
              }}
            >
              {busy === 'clearplan' ? 'Clearing…' : 'Clear plan'}
            </button>
          )}
        </div>

        {/* 🚨 THE HONEST LABEL. "Clear plan" DELETES the plan row, and the
            absence of a row IS the 1 GiB free allowance — so clearing GRANTS
            storage to a company that had none and stops billing them. It is not
            a way to cut anyone off, and copy implying otherwise would eventually
            get it used as one. Suspend is the control that stops uploads. */}
        <p className="text-[10px] mb-2 leading-relaxed" style={{ color: '#78716c' }}>
          <strong>Suspend uploads</strong> refuses new uploads and leaves
          everything already stored exactly where it is — it is the payment
          lever, and it is reversible.{' '}
          <strong>Clear plan</strong> removes the paid plan and puts this company
          back on the free allowance; it stops the billing, it does not cut
          them off.
          {knownFree && (
            <> This company is on the free allowance already, so there is no plan
            to suspend or clear — set a quota first.</>
          )}
        </p>
      </div>

      {/* ── Teardown. The only red control on this surface. ─────────────── */}
      <div className="mt-6 pt-4" style={{ borderTop: '1px solid rgba(220,38,38,0.35)' }}>
        {tearStage === 'confirm' ? (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: '#dc2626' }}>
              Permanently destroy {row.name}?
            </p>
            {/* Cognitive Bias: real numbers, not "are you sure?". */}
            <p className="text-[11px] leading-relaxed mb-3" style={{ color: '#57534e' }}>
              This deletes <strong>{row.member_count} membership(s)</strong>,{' '}
              <strong>{row.project_count} project(s)</strong>,{' '}
              <strong>{row.file_count} file record(s)</strong> and purges{' '}
              <strong>{row.blob_count} stored blob(s)</strong>. Their O.T.T.E.R.
              courses, notes, budgets and history go with it. This cannot be
              undone and there is no trash. User accounts themselves are not
              deleted — people who were only in this company keep a login with
              no workspace.
            </p>
            <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#57534e' }}>
              Type <code className="font-mono">{row.slug}</code> to confirm
            </label>
            <div className="flex items-center gap-2">
              <input
                value={tearConfirm}
                onChange={(e) => setTearConfirm(e.target.value)}
                className={inputClass}
                style={{ ...lightInputStyle, width: '260px' }}
              />
              <button
                className={darkBtnClass}
                style={{ backgroundColor: '#dc2626', color: '#fff' }}
                disabled={tearConfirm !== row.slug || tearStage === 'running'}
                onClick={async () => {
                  setTearStage('running'); setErr('')
                  const res = await teardownWorkspace(row.workspace_id, tearConfirm)
                  if (!res.ok) {
                    setErr(res.data?.friendly ?? 'Teardown failed.')
                    setTearStage('confirm')
                    return
                  }
                  // Hand the receipt up BEFORE reloading: the reload removes
                  // this row, which unmounts this component.
                  onTornDown?.({ ...res.data, slug: row.slug })
                  await onDone()
                }}
              >
                <Trash2 size={12} /> {tearStage === 'running' ? 'Destroying…' : 'Tear down'}
              </button>
              <button
                className={darkBtnClass}
                style={{ backgroundColor: 'transparent', color: '#57534e' }}
                disabled={tearStage === 'running'}
                onClick={() => { setTearStage('idle'); setTearConfirm('') }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors"
            style={{ backgroundColor: 'transparent', color: '#dc2626', border: '1px solid rgba(220,38,38,0.5)' }}
            onClick={() => setTearStage('confirm')}
          >
            Tear down company…
          </button>
        )}
      </div>
    </div>
  )
}

// ── Create ───────────────────────────────────────────────────────────────────

function CreateCompanyDialog({ onCancel, onCreated }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // Tesler's Law: slug derivation is the system's job. It stays editable
  // because the operator may know the company prefers something else, but
  // nobody should have to hand-slugify "Björn & Co. Studios".
  const effectiveSlug = slugTouched
    ? slug
    : name.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '')
        .trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 63)
        .replace(/^-+|-+$/g, '')

  const slugOk = SLUG_RE.test(effectiveSlug)
  const userOk = USERNAME_RE.test(username)
  const canSubmit = name.trim().length > 0 && slugOk && userOk && !busy

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 flex items-center justify-center px-4"
      style={{ zIndex: 85, backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel() }}
    >
      <div
        className="w-full"
        style={{ maxWidth: '440px', backgroundColor: '#1c1917', border: '2px solid #ea580c', borderRadius: '6px', padding: '20px 22px' }}
      >
        <h3 className="text-sm font-bold uppercase tracking-widest mb-1" style={{ color: '#f4a261' }}>
          New company
        </h3>
        <p className="text-[11px] mb-4 leading-relaxed" style={{ color: '#a8a29e' }}>
          Creates the workspace and its first admin. You will get a show-once
          password to hand over — it cannot be retrieved afterwards.
        </p>

        {[
          { label: 'Company name', value: name, set: (v) => setName(v), mono: false },
          {
            label: 'Slug (part of sign-in, permanent)',
            value: effectiveSlug,
            set: (v) => { setSlugTouched(true); setSlug(v.toLowerCase()) },
            mono: true,
            bad: effectiveSlug.length > 0 && !slugOk,
          },
          { label: 'Admin username', value: username, set: (v) => setUsername(v.toLowerCase()), mono: true, bad: username.length > 0 && !userOk },
          { label: 'Admin display name (optional)', value: displayName, set: setDisplayName, mono: false },
          { label: 'Admin email (optional)', value: email, set: setEmail, mono: true },
        ].map((f) => (
          <div key={f.label} className="mb-3">
            <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#a8a29e' }}>
              {f.label}
            </label>
            <input
              value={f.value}
              onChange={(e) => { f.set(e.target.value); setErr('') }}
              disabled={busy}
              className={`w-full px-3 py-2 text-xs rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500 ${f.mono ? 'font-mono' : ''}`}
              style={{
                backgroundColor: 'rgba(0,0,0,0.35)',
                color: '#fde8d0',
                border: f.bad ? '1px solid #dc2626' : 'none',
              }}
            />
          </div>
        ))}

        <p className="text-[10px] mb-3 leading-relaxed" style={{ color: '#78716c' }}>
          No email? One is synthesised and the account becomes admin-reset-only
          — the same convention as admin-created users.
        </p>

        {err && <p className="text-[11px] mb-3" style={{ color: '#fca5a5' }}>{err}</p>}

        <div className="flex items-center gap-2">
          <button
            className={darkBtnClass}
            style={{ backgroundColor: '#ea580c', color: '#fff' }}
            disabled={!canSubmit}
            onClick={async () => {
              setBusy(true); setErr('')
              const res = await createWorkspace({
                name: name.trim(),
                slug: effectiveSlug,
                adminUsername: username,
                adminDisplayName: displayName,
                adminEmail: email,
              })
              setBusy(false)
              if (!res.ok) { setErr(res.data?.friendly ?? 'Creation failed.'); return }
              onCreated(res.data)
            }}
          >
            {busy ? 'Creating…' : 'Create company'}
          </button>
          <button
            className={darkBtnClass}
            style={{ backgroundColor: 'transparent', color: '#a8a29e' }}
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Show-once credentials ────────────────────────────────────────────────────

function CredentialsDialog({ payload, onClose }) {
  const [copied, setCopied] = useState(false)
  const both = `Company: ${payload.slug}\nUsername: ${payload.username}\nPassword: ${payload.password}`

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 flex items-center justify-center px-4"
      style={{ zIndex: 90, backgroundColor: 'rgba(0,0,0,0.7)' }}
    >
      <div
        className="w-full"
        style={{ maxWidth: '440px', backgroundColor: '#1c1917', border: '2px solid #ea580c', borderRadius: '6px', padding: '20px 22px' }}
      >
        <h3 className="text-sm font-bold uppercase tracking-widest mb-1" style={{ color: '#f4a261' }}>
          Company created
        </h3>
        {/* Zeigarnik: this is the only time the password exists anywhere. The
            copy says so before the operator closes the one window it is in. */}
        <p className="text-[11px] mb-4 leading-relaxed" style={{ color: '#a8a29e' }}>
          This password is shown once and is not stored anywhere. Copy it now
          — if it is lost, the admin has to be reset, not recovered.
        </p>
        <pre
          className="text-[11px] font-mono p-3 rounded-sm mb-3 whitespace-pre-wrap break-all"
          style={{ backgroundColor: 'rgba(0,0,0,0.4)', color: '#fde8d0' }}
        >{both}</pre>
        {payload.email_synthesized && (
          <p className="text-[10px] mb-3 leading-relaxed" style={{ color: '#78716c' }}>
            No real email was given, so <code className="font-mono">{payload.email}</code> was
            synthesised. Password resets for this admin are operator/admin-only.
          </p>
        )}
        <div className="flex items-center gap-2">
          <button
            className={darkBtnClass}
            style={{ backgroundColor: '#ea580c', color: '#fff' }}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(both)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              } catch { /* the pre block is selectable as the fallback */ }
            }}
          >
            {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy all</>}
          </button>
          <button
            className={darkBtnClass}
            style={{ backgroundColor: 'transparent', color: '#a8a29e' }}
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
