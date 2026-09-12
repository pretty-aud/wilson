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
import Card from '../../ui/Card'
import Button from '../../ui/Button'
import IconButton from '../../ui/IconButton'
import Input from '../../ui/Input'
import Field from '../../ui/Field'
import Banner from '../../ui/Banner'
import Badge from '../../ui/Badge'
import Stat from '../../ui/Stat'
import SectionTitle from '../../ui/SectionTitle'

// 🚨 `darkBtnClass` / `darkBtnStyle` ARE GONE FROM THIS FILE — one of the four
// private copies AT-02 counted, already diverged three ways (two files carried
// `at-disable-40`, two `at-disable-50`, and one added a flex row the others
// lacked). Every caller is the kit `Button`, so the padding, the height, the
// disabled treatment and the case come from one place. `cardStyle` goes the
// same way: `Card` is the one bordered region this section's three blocks were
// hand-rolling.

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
    <div className="at-section at-section-narrow">
      <SectionTitle description="Who this workspace is, how many people are in it, and the departments they belong to.">
        Company
      </SectionTitle>

      {/* COMPANY DETAILS */}
      <Card title="Company details">
        <p className="at-card-desc">
          The workspace's identity across WILSON. The name is display-only; the slug is part of sign-in.
        </p>

        {wsError && <Banner tone="danger">{wsError}</Banner>}

        <Field label="Workspace name">
          <span className="at-field-row">
            <Input
              value={nameDraft}
              onChange={(v) => setNameDraft(String(v).slice(0, 80))}
              disabled={!ws || saving}
              aria-label="Workspace name"
            />
            <Button
              onClick={saveName}
              disabled={!ws || saving || !nameDraft.trim() || nameDraft.trim() === ws?.name}
              loading={saving}
              loadingLabel="Saving…"
            >
              Save
            </Button>
          </span>
        </Field>

        <Field label="Slug" hint="Slug is permanent — it's part of sign-in.">
          <code className="at-code">{ws?.slug || '--'}</code>
        </Field>

        <Field label="Workspace ID">
          <span className="at-field-row">
            <code className="at-code at-break">{workspaceId || '--'}</code>
            <IconButton
              Icon={copiedId ? Check : Copy}
              onClick={copyId}
              className="at-icon-btn"
              data-copied={String(copiedId)}
              title="Copy workspace ID"
            />
          </span>
        </Field>

        <Field label="Created">
          <span className="at-mono">
            {ws?.created_at ? new Date(ws.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '--'}
          </span>
        </Field>
      </Card>

      {/* MEMBERS SUMMARY */}
      <Card title="Members summary">
        <p className="at-card-desc">
          Live counts from the workspace directory. Manage people in the Users section.
        </p>
        {/* Three tiles, one component, no per-tile colour. The old pair of
            hand-picked greens and oranges said nothing the label did not
            already say, and neither survives the ground flip. */}
        <div className="at-stat-row">
          <Stat label="Total" value={total} />
          <Stat label="Active" value={active} />
          <Stat label="Admins" value={admins} />
        </div>
      </Card>

      {/* TEAMS (departments) */}
      <Card title="Teams">
        <p className="at-card-desc">
          Departments used across Team Members and R.A.B.B.I.T. views.
        </p>
        <div className="at-dept-list">
          {departments.map(d => (
            <Badge key={d} Icon={Building2} className="at-dept">
              {d}
              <IconButton
                size="sm"
                Icon={X}
                onClick={() => persistDepartments(departments.filter(x => x !== d))}
                className="at-icon-btn at-dept-remove"
                data-tone="chip"
                title={`Remove ${d}`}
              />
            </Badge>
          ))}
          {departments.length === 0 && <span className="at-none">No departments yet.</span>}
        </div>
        <div className="at-field-row at-dept-add">
          <Input
            value={newDept}
            onChange={setNewDept}
            onKeyDown={(e) => { if (e.key === 'Enter') addDepartment() }}
            placeholder="Add a department…"
            aria-label="New department"
          />
          <Button
            onClick={addDepartment}
            disabled={!newDept.trim() || departments.includes(newDept.trim())}
          >
            Add
          </Button>
        </div>
        <p className="at-note">
          Departments are stored on this machine (cloud parity lands with O.T.T.E.R.'s content model).
        </p>
      </Card>

      {/* WORKSPACE TAKEOUT (Session 14, Block B) */}
      <WorkspaceTakeout workspaceId={workspaceId} slug={ws?.slug} />
    </div>
  )
}
