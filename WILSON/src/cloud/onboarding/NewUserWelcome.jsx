// =============================================================================
// NewUserWelcome — first-login profile capture for freshly invited users.
//
// Triggered when the current user's workspace_members row has no
// onboarded_at timestamp. Captures:
//   - display_name  (required)
//   - pronouns      (optional, ≤40 chars)
//   - title         (optional, ≤80 chars)
//   - avatar        (optional upload to Storage bucket 'user-avatars')
//
// On submit the wizard:
//   1. Uploads the avatar (if any) to user-avatars/{workspace_id}/{user_id}/{filename}
//   2. Generates a public URL (bucket is public-read; writes are RLS-scoped).
//   3. UPDATEs the workspace_members row with the new fields + onboarded_at=now().
//   4. Calls onComplete so the parent (App.jsx) dismisses the overlay.
//
// Storage bucket must exist as 'user-avatars' with public-read + RLS-scoped
// writes. The bucket is created out-of-band by the platform operator;
// see db/README.md Section 3.
// =============================================================================

import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'
import AuthShell, { AUTH_TEXT_STYLE, AuthCursor } from '../auth/AuthShell'
import { supabase } from '../auth/supabaseClient'

const AVATAR_BUCKET = 'user-avatars'
const AVATAR_MAX_BYTES = 2 * 1024 * 1024 // 2 MB
const AVATAR_OK_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

export default function NewUserWelcome({ onComplete, membership }) {
  // membership = { workspace_id, user_id, display_name } — caller provides.
  const [ready, setReady]               = useState(false)
  const [revealing, setRevealing]       = useState(false)
  const [displayName, setDisplayName]   = useState(membership?.display_name ?? '')
  const [pronouns, setPronouns]         = useState('')
  const [title, setTitle]               = useState('')
  const [avatarFile, setAvatarFile]     = useState(null)
  const [avatarPreview, setAvatarPreview] = useState(null)
  const [busy, setBusy]                 = useState(false)
  const [error, setError]               = useState('')
  const fileInputRef                    = useRef(null)
  const firstInputRef                   = useRef(null)

  useEffect(() => {
    if (ready) firstInputRef.current?.focus()
  }, [ready])

  // Render a local preview URL whenever the user picks a new file.
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
      setError('AVATAR MUST BE PNG, JPEG, WEBP, OR GIF.')
      return
    }
    if (f.size > AVATAR_MAX_BYTES) {
      setError('AVATAR MUST BE UNDER 2 MB.')
      return
    }
    setError('')
    setAvatarFile(f)
  }, [])

  const handleSubmit = useCallback(async (e) => {
    e?.preventDefault()
    if (busy) return
    const name = displayName.trim()
    if (name.length < 1 || name.length > 80) {
      setError('DISPLAY NAME REQUIRED (1–80 CHARS).')
      return
    }
    if (pronouns.length > 40) {
      setError('PRONOUNS TOO LONG (MAX 40).')
      return
    }
    if (title.length > 80) {
      setError('TITLE TOO LONG (MAX 80).')
      return
    }
    setBusy(true)
    setError('')

    try {
      let avatarUrl = null

      if (avatarFile && membership) {
        // Sanitize the filename; path is {workspace_id}/{user_id}/{ts}-{name}.
        const safeName = (avatarFile.name || 'avatar').replace(/[^a-zA-Z0-9._-]+/g, '_')
        const objectPath = `${membership.workspace_id}/${membership.user_id}/${Date.now()}-${safeName}`

        const { error: upErr } = await supabase
          .storage
          .from(AVATAR_BUCKET)
          .upload(objectPath, avatarFile, {
            cacheControl: '3600',
            upsert: true,
            contentType: avatarFile.type,
          })
        if (upErr) {
          setError(`AVATAR UPLOAD FAILED: ${upErr.message}`)
          setBusy(false)
          return
        }

        const { data: pub } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(objectPath)
        avatarUrl = pub?.publicUrl ?? null
      }

      // UPDATE the membership row with RLS active — the user can update their
      // own row per workspace_members_self_update (lands fully in Session 3;
      // in Session 2 the admin-write policy covers the first-login case only
      // when the user is an admin. Session 3 adds a dedicated self-update
      // policy for non-admins).
      const patch = {
        display_name: name,
        pronouns:     pronouns.trim() || null,
        title:        title.trim()    || null,
        onboarded_at: new Date().toISOString(),
      }
      if (avatarUrl) patch.avatar_url = avatarUrl

      const { error: updErr } = await supabase
        .from('workspace_members')
        .update(patch)
        .eq('workspace_id', membership.workspace_id)
        .eq('user_id',      membership.user_id)

      if (updErr) {
        setError(`PROFILE SAVE FAILED: ${updErr.message}`)
        setBusy(false)
        return
      }

      setRevealing(true)
    } catch (err) {
      setError(`ERROR: ${err.message || 'unknown'}`)
      setBusy(false)
    }
  }, [busy, displayName, pronouns, title, avatarFile, membership])

  const inputStyle = {
    ...AUTH_TEXT_STYLE,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    caretColor: 'transparent',
    textAlign: 'center',
    width: '24ch',
    fontSize: '16px',
  }

  return (
    <AuthShell
      isRevealing={revealing}
      onIntroComplete={() => setReady(true)}
      onAnimationComplete={() => onComplete?.()}
      showLogoIntro
      playStartupSound={false}
    >
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px',
        minWidth: '360px',
      }}>
        <div style={AUTH_TEXT_STYLE}>WELCOME</div>
        <div style={{ ...AUTH_TEXT_STYLE, fontSize: '10px', opacity: 0.6 }}>
          TELL US ABOUT YOURSELF
        </div>

        <form onSubmit={handleSubmit}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
          <FieldLabel>DISPLAY NAME</FieldLabel>
          <TerminalInput
            ref={firstInputRef}
            value={displayName}
            onChange={(v) => setDisplayName(v.slice(0, 80))}
            style={inputStyle}
            aria-label="Display name"
          />

          <FieldLabel>PRONOUNS · OPTIONAL</FieldLabel>
          <TerminalInput
            value={pronouns}
            onChange={(v) => setPronouns(v.slice(0, 40))}
            style={inputStyle}
            placeholder="they/them"
            aria-label="Pronouns"
          />

          <FieldLabel>TITLE · OPTIONAL</FieldLabel>
          <TerminalInput
            value={title}
            onChange={(v) => setTitle(v.slice(0, 80))}
            style={inputStyle}
            placeholder="Lead Animator"
            aria-label="Title"
          />

          <FieldLabel>AVATAR · OPTIONAL</FieldLabel>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {avatarPreview && (
              <img
                src={avatarPreview}
                alt=""
                style={{
                  width: '48px', height: '48px', borderRadius: '50%',
                  objectFit: 'cover', border: '2px solid #fff',
                }}
              />
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept={AVATAR_OK_TYPES.join(',')}
              onChange={handleFilePick}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              style={{
                ...AUTH_TEXT_STYLE, fontSize: '11px',
                background: 'transparent', border: '1px solid #fff',
                padding: '4px 10px', cursor: 'pointer',
              }}
            >
              {avatarFile ? 'CHANGE' : 'CHOOSE FILE'}
            </button>
          </div>

          <button
            type="submit"
            disabled={busy}
            style={{
              ...AUTH_TEXT_STYLE, marginTop: '8px', fontSize: '13px',
              background: 'transparent', border: '2px solid #fff',
              padding: '6px 18px',
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.45 : 1,
            }}
          >
            {busy ? 'SAVING…' : 'GET STARTED'}
          </button>
        </form>

        {error && (
          <div style={{ ...AUTH_TEXT_STYLE, fontSize: '11px', color: '#fee2e2' }}>
            {error}
          </div>
        )}
      </div>
    </AuthShell>
  )
}

// ── Shared building blocks (parallel to NewCompanyWizard's copy) ──────────
function FieldLabel({ children }) {
  return (
    <div style={{ ...AUTH_TEXT_STYLE, fontSize: '11px', opacity: 0.8 }}>
      {children}
    </div>
  )
}

const TerminalInput = forwardRef(function TerminalInput(
  { value, onChange, style, type = 'text', ...rest },
  ref,
) {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <input
        ref={ref}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={style}
        {...rest}
      />
      <AuthCursor />
    </div>
  )
})
