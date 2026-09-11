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
import { LIGHT_INK } from '../lightSurface'

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

      const { data, error: updErr } = await supabase
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

  const inputStyle = {
    backgroundColor: 'rgba(120, 70, 30, 0.55)',
    color: '#fde8d0',
    border: 'none',
  }
  const disabledStyle = {
    backgroundColor: 'rgba(120, 70, 30, 0.18)',
    color: LIGHT_INK,
    border: 'none',
  }
  const inputClass = 'w-full px-3 py-2 text-xs font-mono rounded-sm focus:ring-2 focus:ring-orange-500'
  const labelClass = 'block text-[11px] font-bold uppercase tracking-wider mb-1.5'

  // Freshly picked files preview via blob: URL; stored URLs only render when
  // they point at our own user-avatars bucket (same guard as the roster).
  const shownAvatar = avatarPreview || (isOwnAvatarUrl(row?.avatar_url) ? row.avatar_url : null)

  if (loading) {
    return (
      <div className="py-8 text-xs font-mono italic" style={{ color: LIGHT_INK }}>Loading profile…</div>
    )
  }
  if (!row) {
    return (
      <div className="py-8 text-xs font-mono italic" style={{ color: error ? '#dc2626' : LIGHT_INK }}>
        {error || 'No cloud profile found — sign in to a workspace to edit your profile.'}
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">Profile</h2>
      <p className="text-xs text-stone-950 mb-4 leading-relaxed">
        How you appear to teammates across WILSON. Username and role are managed
        by your workspace admin.
      </p>

      {/* Avatar */}
      <div className="flex items-center gap-4 mb-6">
        {shownAvatar ? (
          <img
            src={shownAvatar}
            alt="Avatar"
            className="w-16 h-16 rounded-full object-cover"
            style={{ border: '2px solid #c2410c' }}
          />
        ) : (
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold"
            style={{ backgroundColor: 'rgba(120, 70, 30, 0.55)', color: '#fde8d0' }}
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
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors disabled:opacity-40"
              style={{ backgroundColor: '#1c1917', color: '#f4a261' }}
            >
              {shownAvatar ? 'Change avatar' : 'Upload avatar'}
            </button>
            {shownAvatar && (
              <button
                type="button"
                onClick={handleRemoveAvatar}
                disabled={busy}
                className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors disabled:opacity-40"
                style={{ backgroundColor: 'transparent', color: '#dc2626', border: '1px solid #dc2626' }}
              >
                {avatarFile ? 'Discard' : 'Remove'}
              </button>
            )}
          </div>
          <p className="text-[10px] mt-1.5" style={{ color: LIGHT_INK }}>
            PNG, JPEG, WEBP, or GIF · under 2 MB{avatarFile ? ` · ${avatarFile.name}` : ''}
          </p>
        </div>
      </div>

      {/* Editable fields */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className={labelClass} style={{ color: LIGHT_INK }}>Display name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value.slice(0, 80))}
            disabled={busy}
            className={inputClass}
            style={inputStyle}
          />
        </div>
        <div>
          <label className={labelClass} style={{ color: LIGHT_INK }}>Pronouns</label>
          <input
            type="text"
            value={pronouns}
            onChange={(e) => setPronouns(e.target.value.slice(0, 40))}
            disabled={busy}
            placeholder="e.g. they/them"
            className={inputClass}
            style={inputStyle}
          />
        </div>
        <div>
          <label className={labelClass} style={{ color: LIGHT_INK }}>Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 80))}
            disabled={busy}
            placeholder="e.g. Compositor"
            className={inputClass}
            style={inputStyle}
          />
        </div>
        <div>
          <label className={labelClass} style={{ color: LIGHT_INK }}>Department</label>
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            disabled={busy}
            className={`${inputClass} cursor-pointer`}
            style={inputStyle}
          >
            <option value="">--</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>

      {/* Locked fields — enforced by the DB guard trigger, disabled here */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <div>
          <label className={labelClass} style={{ color: LIGHT_INK }}>Username</label>
          <input type="text" value={row.username || ''} disabled className={inputClass} style={disabledStyle} title="Usernames are managed by your workspace admin." />
        </div>
        <div>
          <label className={labelClass} style={{ color: LIGHT_INK }}>Role</label>
          <input type="text" value={ROLE_LABELS[row.app_role] || row.app_role || ''} disabled className={inputClass} style={disabledStyle} title="Roles are managed by your workspace admin." />
        </div>
        <div>
          <label className={labelClass} style={{ color: LIGHT_INK }}>Email</label>
          <input type="text" value={email} disabled className={inputClass} style={disabledStyle} title="Email changes arrive with the account settings work (Session 9)." />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={busy}
          className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors disabled:opacity-40"
          style={{ backgroundColor: '#1c1917', color: '#f4a261' }}
        >
          {busy ? 'Saving…' : 'Save profile'}
        </button>
        {savedFlash && (
          <span className="text-xs font-mono text-green-700">Saved.</span>
        )}
        {error && (
          <span className="text-xs font-mono" style={{ color: '#dc2626' }}>{error}</span>
        )}
      </div>
    </div>
  )
}
