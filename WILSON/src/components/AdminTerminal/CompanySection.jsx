// =============================================================================
// CompanySection — workspace identity, member counts, and departments
// (Session 9).
//
// UX laws embodied:
//   Law of Common Region — three bordered cards chunk unrelated concerns.
//   Jakob's Law — SettingsPage's h2/p section grammar, verbatim.
//   Postel's Law — the departments editor trims input and ignores dupes
//     instead of erroring.
//
// Departments mirror SettingsPage's /api/otter-settings read + one-deep
// merge POST exactly — same file on disk, no cloud parity yet.
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { Building2, Copy, Check, X } from 'lucide-react'
import { supabase } from '../../cloud/auth/supabaseClient'
import { copyTextToClipboard } from './CredentialsPopup'
import { loadOtterSettings, saveOtterSettings } from '../../lib/localData'
import WorkspaceTakeout from './WorkspaceTakeout'
import { LIGHT_INK, LIGHT_RULE } from '../lightSurface' // §B — light page

const lightInputStyle = {
  backgroundColor: 'rgba(120, 70, 30, 0.55)',
  color: '#fde8d0',
  border: 'none',
}
const cardStyle = {
  backgroundColor: 'rgba(120, 70, 30, 0.12)',
  border: '1px solid rgba(120, 70, 30, 0.3)',
}
const darkBtnClass = 'px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors disabled:opacity-40'
const darkBtnStyle = { backgroundColor: '#1c1917', color: '#f4a261' }

// Same defaults SettingsPage/TeamMembersPage seed before settings load.
const DEFAULT_DEPARTMENTS = [
  'CG Art', 'Production', 'Creatives', 'Post', 'QA',
  'Audio', 'Physical Production', 'Development', 'Executive', 'Operations',
]

export default function CompanySection({ isActive, wm }) {
  const workspaceId = wm.workspaceId

  const [ws, setWs] = useState(null) // { id, name, slug, created_at }
  const [nameDraft, setNameDraft] = useState('')
  const [wsError, setWsError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [copiedId, setCopiedId] = useState(false)

  const [departments, setDepartments] = useState(DEFAULT_DEPARTMENTS)
  const [newDept, setNewDept] = useState('')

  // StrictMode-safe mounted flag: body sets true, cleanup sets false.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Lazy-load on first activation only — all app pages render at once, so
  // mounting must stay free until the admin actually opens this section.
  const loadedRef = useRef(false)
  const seqRef = useRef(0)
  useEffect(() => {
    if (!isActive || loadedRef.current || !workspaceId) return
    loadedRef.current = true
    const seq = ++seqRef.current

    supabase
      .from('workspaces')
      .select('id, name, slug, created_at')
      .eq('id', workspaceId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!mountedRef.current || seq !== seqRef.current) return
        if (error) setWsError(error.message || String(error))
        else if (data) {
          setWs(data)
          setNameDraft(data.name || '')
        }
      })

    loadOtterSettings().then(data => {
      if (!mountedRef.current || seq !== seqRef.current) return
      if (data?.rabbit?.departments && Array.isArray(data.rabbit.departments)) {
        setDepartments(data.rabbit.departments)
      }
    }).catch(() => {})
  }, [isActive, workspaceId])

  // SettingsPage's persistOtterSettings, mirrored: re-fetch, one-deep merge
  // object-valued keys, POST the whole document. Best-effort by design.
  async function persistOtterSettings(patch) {
    try {
      const data = await loadOtterSettings().catch(() => ({}))
      const next = { ...data }
      for (const [k, v] of Object.entries(patch)) {
        if (v && typeof v === 'object' && !Array.isArray(v) && data[k] && typeof data[k] === 'object') {
          next[k] = { ...data[k], ...v }
        } else {
          next[k] = v
        }
      }
      await saveOtterSettings(next)
    } catch {
      /* best effort */
    }
  }

  function persistDepartments(next) {
    setDepartments(next)
    persistOtterSettings({ rabbit: { departments: next } })
  }

  function addDepartment() {
    const name = newDept.trim()
    if (!name || departments.includes(name)) return
    persistDepartments([...departments, name])
    setNewDept('')
  }

  async function saveName() {
    const name = nameDraft.trim()
    if (!ws || saving || !name || name === ws.name) return
    setSaving(true)
    setWsError(null)
    const prev = ws
    setWs({ ...ws, name }) // optimistic; the 0010-style guard trigger may reject
    try {
      const { data, error } = await supabase
        .from('workspaces')
        .update({ name })
        .eq('id', workspaceId)
        .select('id, name, slug, created_at')
        .maybeSingle()
      if (error) throw error
      if (!data) throw new Error('Rename was blocked — you may not have permission.')
      if (mountedRef.current) setWs(data)
    } catch (err) {
      if (mountedRef.current) {
        setWs(prev)
        setNameDraft(prev.name || '')
        setWsError(err?.message || String(err))
      }
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }

  async function copyId() {
    if (!workspaceId) return
    const ok = await copyTextToClipboard(workspaceId)
    if (!ok || !mountedRef.current) return
    setCopiedId(true)
    setTimeout(() => { if (mountedRef.current) setCopiedId(false) }, 1500)
  }

  const total = wm.members.length
  const active = wm.members.filter(m => m.is_active).length
  const admins = wm.members.filter(m => m.app_role === 'admin' && m.is_active).length

  return (
    <div className="space-y-6 pb-8" style={{ maxWidth: '640px' }}>
      {/* COMPANY DETAILS */}
      <div className="p-4 rounded-sm" style={cardStyle}>
        <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">
          Company details
        </h2>
        <p className="text-xs text-stone-950 mb-4 leading-relaxed">
          The workspace's identity across WILSON. The name is display-only; the slug is part of sign-in.
        </p>

        {wsError && (
          <div className="mb-3 text-xs font-mono px-3 py-2 rounded-sm" style={{ backgroundColor: 'rgba(220, 38, 38, 0.1)', color: '#dc2626' }}>
            {wsError}
          </div>
        )}

        <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: LIGHT_INK }}>
          Workspace name
        </label>
        <div className="flex items-center gap-2 mb-4">
          <input
            type="text"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value.slice(0, 80))}
            disabled={!ws || saving}
            className="flex-1 px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            style={lightInputStyle}
          />
          <button
            type="button"
            onClick={saveName}
            disabled={!ws || saving || !nameDraft.trim() || nameDraft.trim() === ws?.name}
            className={darkBtnClass}
            style={darkBtnStyle}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>

        <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: LIGHT_INK }}>
          Slug
        </label>
        <div className="flex items-center gap-2 mb-1">
          <code className="px-2 py-1 text-xs font-mono rounded-sm" style={{ backgroundColor: 'rgba(0,0,0,0.08)', color: '#1c1917' }}>
            {ws?.slug || '--'}
          </code>
        </div>
        <p className="text-[10px] mb-4" style={{ color: LIGHT_INK }}>
          Slug is permanent — it's part of sign-in.
        </p>

        <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: LIGHT_INK }}>
          Workspace ID
        </label>
        <div className="flex items-center gap-2 mb-4">
          <code className="px-2 py-1 text-xs font-mono rounded-sm break-all" style={{ backgroundColor: 'rgba(0,0,0,0.08)', color: '#1c1917' }}>
            {workspaceId || '--'}
          </code>
          <button
            type="button"
            onClick={copyId}
            className="p-1 rounded-sm hover:bg-stone-200 transition-colors flex-shrink-0"
            style={{ color: copiedId ? '#22c55e' : LIGHT_INK }}
            title="Copy workspace ID"
          >
            {copiedId ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>

        <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: LIGHT_INK }}>
          Created
        </label>
        <span className="text-xs font-mono" style={{ color: '#1c1917' }}>
          {ws?.created_at ? new Date(ws.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '--'}
        </span>
      </div>

      {/* MEMBERS SUMMARY */}
      <div className="p-4 rounded-sm" style={cardStyle}>
        <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">
          Members summary
        </h2>
        <p className="text-xs text-stone-950 mb-4 leading-relaxed">
          Live counts from the workspace directory. Manage people in the Users section.
        </p>
        <div className="flex gap-6">
          <CountStat label="Total" value={total} />
          <CountStat label="Active" value={active} color="#15803d" />
          <CountStat label="Admins" value={admins} color="#c2410c" />
        </div>
      </div>

      {/* TEAMS (departments) */}
      <div className="p-4 rounded-sm" style={cardStyle}>
        <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">
          Teams
        </h2>
        <p className="text-xs text-stone-950 mb-4 leading-relaxed">
          Departments used across Team Members and R.A.B.B.I.T. views.
        </p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {departments.map(d => (
            <span
              key={d}
              className="flex items-center gap-1 px-2 py-1 text-[11px] font-mono rounded-sm"
              style={{ backgroundColor: 'rgba(120, 70, 30, 0.18)', color: '#1c1917' }}
            >
              <Building2 className="w-3 h-3" style={{ color: LIGHT_INK }} />
              {d}
              <button
                type="button"
                onClick={() => persistDepartments(departments.filter(x => x !== d))}
                className="p-0.5 rounded-sm hover:bg-stone-300 transition-colors"
                style={{ color: LIGHT_INK }}
                title={`Remove ${d}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          {departments.length === 0 && (
            <span className="text-xs font-mono italic" style={{ color: LIGHT_INK }}>No departments yet.</span>
          )}
        </div>
        <div className="flex items-center gap-2 mb-2">
          <input
            type="text"
            value={newDept}
            onChange={(e) => setNewDept(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addDepartment() }}
            placeholder="Add a department..."
            className="flex-1 max-w-xs px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            style={lightInputStyle}
          />
          <button
            type="button"
            onClick={addDepartment}
            disabled={!newDept.trim() || departments.includes(newDept.trim())}
            className={darkBtnClass}
            style={darkBtnStyle}
          >
            Add
          </button>
        </div>
        <p className="text-[10px]" style={{ color: LIGHT_INK }}>
          Departments are stored on this machine (cloud parity lands with O.T.T.E.R.'s content model).
        </p>
      </div>

      {/* WORKSPACE TAKEOUT (Session 14, Block B) */}
      <WorkspaceTakeout workspaceId={workspaceId} slug={ws?.slug} />
    </div>
  )
}

function CountStat({ label, value, color = '#1c1917' }) {
  return (
    <div>
      <div className="text-xl font-bold font-mono" style={{ color }}>{value}</div>
      <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: LIGHT_INK }}>{label}</div>
    </div>
  )
}
