// =============================================================================
// ProfileSection — the signed-in user's profile editor.
//
// Session 4. Lives in Settings → Profile; Session 8 mounts the same component
// on the Dashboard, so it is fully self-contained (fetches its own row, no
// required props).
//
// Saves display_name / pronouns / title / department / avatar_url to the
// caller's own workspace_members row (ws_members_self_update RLS). The avatar
// uploads to user-avatars/{workspace_id}/{user_id}/{ts}-{name} — the exact
// path the 0009 storage policies enforce (same code path as NewUserWelcome).
//
// Username and role are shown but disabled: the 0009/0010 guard trigger
// blocks self-edits of app_role/username at the DB level; the disabled inputs
// are just honest UI. Email comes from the auth session (auth.users), not
// workspace_members, and is read-only here (email change lands with the
// email_change template flow, Session 9).
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../cloud/auth/supabaseClient'
import { withTimeout, TimeoutError, AUTH_TIMEOUT_MS } from '../../cloud/auth/withTimeout'
import { usePermissions } from '../../permissions/usePermissions'
import { isOwnAvatarUrl } from '../TeamMembers/useWorkspaceMembers'
import { loadOtterSettings } from '../../lib/localData'
import './settings.css'
import { Section, Group, Row } from './SettingsChrome'
import { Button, Input, Select } from '../../ui'
import { devFixtures, devWriteRefused } from '../../dev/devFixtures'

const AVATAR_BUCKET = 'user-avatars'
const AVATAR_MAX_BYTES = 2 * 1024 * 1024 // 2 MB — mirrors the bucket's file_size_limit
const AVATAR_OK_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

const DEFAULT_DEPARTMENTS = [
  'CG Art', 'Production', 'Creatives', 'Post', 'QA',
  'Audio', 'Physical Production', 'Development', 'Executive', 'Operations',
]

const ROLE_LABELS = { admin: 'Admin', manager: 'Manager', user: 'User' }

export default function ProfileSection({ onSaved }) {
  const perms = usePermissions()
  const [row, setRow] = useState(null)          // the workspace_members row
  const [email, setEmail] = useState('')
  const [departments, setDepartments] = useState(DEFAULT_DEPARTMENTS)
  const [loading, setLoading] = useState(true)

  const [displayName, setDisplayName] = useState('')
  const [pronouns, setPronouns] = useState('')
  const [title, setTitle] = useState('')
  const [department, setDepartment] = useState('')
  const [avatarFile, setAvatarFile] = useState(null)
  const [avatarPreview, setAvatarPreview] = useState(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [savedFlash, setSavedFlash] = useState(false)
  const fileRef = useRef(null)

  // ── Load own row + session email + departments ──
  useEffect(() => {
    if (!perms.ready) return
    if (!perms.userId || !perms.workspaceId) {
      // Signed out / local-only mode: nothing to load — show the no-profile
      // state instead of spinning forever.
      setLoading(false)
      return
    }
    // Dev fixtures (2026-09-11, dev builds only): the reviewer's own row and
    // email come from the dataset; nothing is read from Supabase.
    const fx = import.meta.env.DEV ? devFixtures() : null
    if (fx?.workspace) {
      const member = fx.workspace.getMember(perms.userId)
      if (member) {
        setRow(member)
        setDisplayName(member.display_name || '')
        setPronouns(member.pronouns || '')
        setTitle(member.title || '')
        setDepartment(member.department || '')
      }
      setEmail(fx.profile?.email || '')
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      // Session 21. `setLoading(false)` used to sit at the end of this block
      // with no try/finally, so ANY path that did not reach the last line left
      // the panel on "Loading profile…" forever — the reported defect.
      //
      // Both legs below can hang, not just the auth one. supabase-js binds
      // `_getAccessToken()` into fetchWithAuth for every PostgREST request, and
      // that awaits `auth.getSession()` internally (supabase-js 2.101.1,
      // dist/index.mjs:523-528) — so the workspace_members SELECT carries the
      // same unbounded wait as the explicit getSession() beside it. Bounding
      // only the explicit call would have left the panel able to spin on the
      // other leg. The finally is what actually closes this.
      try {
        const [{ data: member, error: selErr }, { data: sess }] = await Promise.all([
          supabase
            .from('workspace_members')
            .select('*')
            .eq('workspace_id', perms.workspaceId)
            .eq('user_id', perms.userId)
            .maybeSingle(),
          withTimeout(supabase.auth.getSession(), AUTH_TIMEOUT_MS, 'reading your session'),
        ])
        if (cancelled) return
        if (selErr) {
          // A failed SELECT is not "no profile" — say what actually happened.
          setError(`Could not load your profile: ${selErr.message}`)
        } else if (member) {
          setRow(member)
          setDisplayName(member.display_name || '')
          setPronouns(member.pronouns || '')
          setTitle(member.title || '')
          setDepartment(member.department || '')
        }
        setEmail(sess?.session?.user?.email || '')
      } catch (err) {
        // A stall is not "no profile" either. Distinguish it, for the reason
        // modelSources.js:233 gives: telling someone to sign in again when the
        // network stalled sends them to the wrong remedy.
        if (!cancelled) {
          setError(
            err instanceof TimeoutError
              ? 'The server did not respond while loading your profile. Check your connection and try again.'
              : `Could not load your profile: ${err?.message ?? String(err)}`,
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    loadOtterSettings().then(data => {
      if (!cancelled && Array.isArray(data?.rabbit?.departments) && data.rabbit.departments.length) {
        setDepartments(data.rabbit.departments)
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [perms.ready, perms.userId, perms.workspaceId])

  // Local object-URL preview for a freshly picked avatar.
  useEffect(() => {
    if (!avatarFile) { setAvatarPreview(null); return }
    const url = URL.createObjectURL(avatarFile)
    setAvatarPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [avatarFile])

  const handleFilePick = useCallback((e) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!AVATAR_OK_TYPES.includes(f.type)) {
      setError('Avatar must be PNG, JPEG, WEBP, or GIF.')
      return
    }
    if (f.size > AVATAR_MAX_BYTES) {
      setError('Avatar must be under 2 MB.')
      return
    }
    setError('')
    setAvatarFile(f)
  }, [])

  async function handleSave() {
    if (busy || !row) return
    const name = displayName.trim()
    if (!name) { setError('Display name is required.'); return }
    if (name.length > 80) { setError('Display name max 80 chars.'); return }
    if (pronouns.trim().length > 40) { setError('Pronouns max 40 chars.'); return }
    if (title.trim().length > 80) { setError('Title max 80 chars.'); return }

    setBusy(true)
    setError('')
    try {
      // Dev fixtures (dev builds only): the row lands in the in-memory store; a
      // photo has bytes the fixtures cannot hold, so that part is refused loudly.
      const fx = import.meta.env.DEV ? devFixtures() : null
      if (fx?.workspace && avatarFile) throw devWriteRefused('Uploading an avatar')
      let avatarUrl = null
      if (avatarFile) {
        // Path layout {workspace_id}/{user_id}/{ts}-{name} is enforced by the
        // 0009 storage policies — do not change it here without a migration.
        const safeName = (avatarFile.name || 'avatar').replace(/[^a-zA-Z0-9._-]+/g, '_')
        const objectPath = `${row.workspace_id}/${row.user_id}/${Date.now()}-${safeName}`
        const { error: upErr } = await supabase
          .storage
          .from(AVATAR_BUCKET)
          .upload(objectPath, avatarFile, {
            cacheControl: '3600',
            upsert: true,
            contentType: avatarFile.type,
          })
        if (upErr) throw new Error(`Avatar upload failed: ${upErr.message}`)
        const { data: pub } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(objectPath)
        avatarUrl = pub?.publicUrl ?? null
      }

      const patch = {
        display_name: name,
        pronouns:     pronouns.trim() || null,
        title:        title.trim() || null,
        department:   department || null,
      }
      if (avatarUrl) patch.avatar_url = avatarUrl

      const { data, error: updErr } = fx?.workspace
        ? fx.workspace.updateMember(row.user_id, patch)
        : await supabase
          .from('workspace_members')
          .update(patch)
          .eq('workspace_id', row.workspace_id)
          .eq('user_id', row.user_id)
          .select()
          .maybeSingle()
      if (updErr) throw updErr
      // An RLS-refused UPDATE matches zero rows and raises NOTHING: postgrest
      // returns 200 with a null body, so `updErr` alone reports success for a
      // write that never landed. `setRow(data || {...row, ...patch})` then
      // painted the new avatar from local state and the panel said "Saved" —
      // right up until the next mount re-read the old row. That is the shape
      // of "avatar does not persist". Same reasoning as modelSources.js:275.
      if (!data) throw new Error('Nothing was saved — the update matched no row. Check that your membership is still active.')

      setRow(data)
      setAvatarFile(null)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2500)
      onSaved?.(data)
    } catch (err) {
      setError(err?.message || String(err))
      // Drop the pending pick so the UI reverts to the STORED avatar. Leaving
      // it set kept the blob-URL preview on screen, which made every failure
      // mode — upload rejected, zero-row write, anything — look exactly like a
      // success until the next mount.
      setAvatarFile(null)
    } finally {
      setBusy(false)
    }
  }

  // Session 8: avatar removal. A pending (unsaved) pick just gets
  // discarded; a stored avatar clears avatar_url and best-effort deletes
  // the blob (user_avatars_delete_own policy). The row update is the
  // source of truth — a failed blob delete only leaves an orphan object,
  // same known-gap family as the rabbit-files GC.
  async function handleRemoveAvatar() {
    if (busy || !row) return
    if (avatarFile) { setAvatarFile(null); setError(''); return }
    if (!row.avatar_url) return
    setBusy(true)
    setError('')
    try {
      // Dev fixtures (dev builds only): clear the row in memory; there is no blob.
      const fx = import.meta.env.DEV ? devFixtures() : null
      if (fx?.workspace) {
        const { data } = fx.workspace.updateMember(row.user_id, { avatar_url: null })
        setRow(data)
        return
      }
      const prefix = `/storage/v1/object/public/${AVATAR_BUCKET}/`
      const i = (row.avatar_url || '').indexOf(prefix)
      if (i !== -1) {
        // Parse + remove together: a malformed percent-sequence must only
        // cost us the blob cleanup, never the avatar_url reset below.
        try {
          const objectPath = decodeURIComponent(row.avatar_url.slice(i + prefix.length))
          await supabase.storage.from(AVATAR_BUCKET).remove([objectPath])
        } catch { /* orphan blob only */ }
      }
      const { data, error: updErr } = await supabase
        .from('workspace_members')
        .update({ avatar_url: null })
        .eq('workspace_id', row.workspace_id)
        .eq('user_id', row.user_id)
        .select()
        .maybeSingle()
      if (updErr) throw updErr
      // Same zero-row masking as handleSave — a refused removal would have
      // reported "Saved" and shown no avatar, and the blob is already gone by
      // this point, so a silent failure here loses the image either way.
      if (!data) throw new Error('Nothing was saved — the update matched no row. Check that your membership is still active.')
      setRow(data)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2500)
      onSaved?.(data)
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  // Freshly picked files preview via blob: URL; stored URLs only render when
  // they point at our own user-avatars bucket (same guard as the roster).
  const shownAvatar = avatarPreview || (isOwnAvatarUrl(row?.avatar_url) ? row.avatar_url : null)

  // S27: "loading", "no profile" and "it broke" used to be ONE block with an
  // ink flip between them, so a failure and an empty state were the same
  // object. Three states, three treatments.
  if (loading) {
    return <p className="s-profile-empty">Loading profile…</p>
  }
  if (!row) {
    return (
      <p className="s-profile-empty" data-tone={error ? 'error' : 'neutral'} role={error ? 'alert' : undefined}>
        {error || 'No cloud profile found — sign in to a workspace to edit your profile.'}
      </p>
    )
  }

  return (
    // ⚠️ THIS COMPONENT HAS TWO HOSTS. SettingsPage mounts it here and
    // Dashboard/DashboardPage.jsx mounts it as a whole tab. Both are the light
    // ground today, so one treatment serves both — but plan §2 Q1 moves the
    // Dashboard onto the dark `paper` in lane C2, and at that point this
    // component needs a `surface` prop rather than a second copy. Filed as a
    // kit request in the D1 hand-off.
    <Section
      first
      title="Profile"
      description="How you appear to teammates across WILSON. Username and role are managed by your workspace admin."
    >
      {/* A7: the avatar's action buttons started 80px in (a 64px circle plus a
          16px gap) and aligned to nothing in the field grid below. The avatar
          is a row now, so its controls sit on the same right-hand edge as
          every other control on the page. */}
      <div className="flex items-center gap-4 mb-6">
        {shownAvatar ? (
          <img
            src={shownAvatar}
            alt="Avatar"
            className="w-16 h-16 rounded-full object-cover"
            style={{ border: '1px solid var(--color-rule-light)' }}
          />
        ) : (
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{ backgroundColor: 'var(--color-well-light)', color: 'var(--color-ink-light)', fontSize: 'var(--text-h1)', fontWeight: 600 }}
          >
            {(displayName || row.username || '?').trim().charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <input
            ref={fileRef}
            type="file"
            accept={AVATAR_OK_TYPES.join(',')}
            onChange={handleFilePick}
            className="hidden"
          />
          <div className="flex items-center gap-2">
            <Button surface="light" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
              {shownAvatar ? 'Change avatar' : 'Upload avatar'}
            </Button>
            {shownAvatar && (
              <Button surface="light" size="sm" variant="danger" onClick={handleRemoveAvatar} disabled={busy}>
                {avatarFile ? 'Discard' : 'Remove'}
              </Button>
            )}
          </div>
          <p className="s-row-desc mt-2">
            PNG, JPEG, WEBP, or GIF · under 2 MB{avatarFile ? ` · ${avatarFile.name}` : ''}
          </p>
        </div>
      </div>

      {/* S19 / A1: a 2-column grid sat 16px above a 3-column grid and read as
          one block, with the gutter at 50 percent in the first and 33/66 in
          the second — six field edges that nearly lined up and none that did.
          One column of rows now, which is the contract the rest of the page
          uses, so there is no seam to misalign. */}
      <Group label="You">
        <Row label="Display name" stacked>
          <Input surface="light" aria-label="Display name" className="w-full"
            value={displayName} onChange={(v) => setDisplayName(v.slice(0, 80))} disabled={busy} />
        </Row>
        <Row label="Pronouns" stacked>
          <Input surface="light" aria-label="Pronouns" className="w-full" placeholder="e.g. they/them"
            value={pronouns} onChange={(v) => setPronouns(v.slice(0, 40))} disabled={busy} />
        </Row>
        <Row label="Title" stacked>
          <Input surface="light" aria-label="Title" className="w-full" placeholder="e.g. Compositor"
            value={title} onChange={(v) => setTitle(v.slice(0, 80))} disabled={busy} />
        </Row>
        <Row label="Department" stacked>
          <Select surface="light" aria-label="Department" className="w-full"
            value={department} onChange={(v) => setDepartment(v || '')} disabled={busy}
            placeholder="--"
            options={departments.map(d => ({ value: d, label: d }))} />
        </Row>
      </Group>

      {/* Managed by the workspace admin and enforced by a DB guard trigger.
          They are disabled, and the disabled token is what says so — making
          them look editable would be a lie the database enforces. */}
      <Group label="Managed by your workspace">
        <Row label="Username" stacked>
          <Input surface="light" className="w-full" value={row.username || ''} onChange={() => {}} disabled
            aria-label="Username" title="Usernames are managed by your workspace admin." />
        </Row>
        <Row label="Role" stacked>
          <Input surface="light" className="w-full" value={ROLE_LABELS[row.app_role] || row.app_role || ''} onChange={() => {}} disabled
            aria-label="Role" title="Roles are managed by your workspace admin." />
        </Row>
        <Row label="Email" stacked>
          <Input surface="light" className="w-full" value={email} onChange={() => {}} disabled
            aria-label="Email" title="Email changes arrive with the account settings work (Session 9)." />
        </Row>
      </Group>

      <div className="mt-6">
        <Button surface="light" variant="primary" onClick={handleSave} disabled={busy}>
          {busy ? 'Saving…' : 'Save profile'}
        </Button>
      </div>

      {/* S10: 'Saved.' was text-green-700 on #f4a261 — 2.60:1 — and it
          appeared and vanished on a 2500ms timeout with no transition, in a
          position the user may not have been looking at. Same ink as the page
          and the same left-edge treatment as every other confirmation here. */}
      {savedFlash && (
        <p className="s-feedback mt-4" data-tone="ok" role="status">Saved.</p>
      )}
      {error && (
        <p className="s-feedback mt-4" data-tone="error" role="alert">{error}</p>
      )}
    </Section>
  )
}
