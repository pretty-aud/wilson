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
  isMissingFunction,
} from './operatorApi'

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
    const res = await listWorkspaces()
    if (!mountedRef.current || seq !== seqRef.current) return
    setLoading(false)
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

      <div className="overflow-auto rounded-sm wilson-light-scroll mb-6" style={{ border: '1px solid #d6d3d1' }}>
        <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr style={{ backgroundColor: '#e7e5e4' }}>
              <ThLight>Company</ThLight>
              <ThLight>Slug</ThLight>
              <ThLight>Members</ThLight>
              <ThLight>Projects</ThLight>
              <ThLight>Files</ThLight>
              <ThLight>AI key</ThLight>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-xs" style={{ color: '#78716c' }}>
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

function CompanyPanel({ row, onDone, onTornDown }) {
  const [name, setName] = useState(row.name)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [keyInput, setKeyInput] = useState('')
  const [showKeyField, setShowKeyField] = useState(false)

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
