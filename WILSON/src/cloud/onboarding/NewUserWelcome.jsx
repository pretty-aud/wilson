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
//
// Session 43 §A6 — the phantom cursor is gone, and it was this file's
// `TerminalInput`. Each one set `caretColor: 'transparent'` on its input and
// then rendered a decorative blinking `_` BESIDE it, so the screen showed one
// permanently-blinking glyph per field, none of which tracked focus or moved
// with what you typed. Audrey: "it had the blinking lines to right of the
// text box and it made no sense … you were trying to show the place where the
// user could type but it didnt come out correctly." Correct: the idea was
// right and the execution inverted it — a terminal cursor belongs at the
// insertion point or nowhere. The native caret does that job, so it is back
// on, and the terminal feel now comes from the FIELD TREATMENT (uppercase
// label, baseline rule) rather than from a second glyph competing with the
// real one.
//
// ── UI overhaul D2 ──────────────────────────────────────────────────────────
// This is the tallest surface in the auth family and the only one AuthShell's
// own geometry note calls out as overflowing the 700px minimum window
// (AUTH-16, "unfixed, unmeasured since"). Everything here that could be made
// shorter without leaving the scale, was:
//
//   AUTH-22  the local `24ch` field-width override is gone. One measure for
//            the family, `AUTH_FIELD_WIDTH`, straight off `AUTH_INPUT_STYLE`.
//   AUTH-09  every gap comes from the three named tokens. The old screen was
//            18px everywhere plus a hand-typed 12px in the avatar row and a
//            2px nudge over the submit; it is 8 / 16 / 24 now, and the header
//            block tightened from 18+18 to 8+24.
//   AUTH-23  the avatar ring was the family's only 2px border — it is a 1px
//            AUTH_INK hairline, and the 48px slot is RESERVED. The preview
//            used to mount only after a file was picked, so the row grew and
//            the whole centred column reflowed under the user's cursor at the
//            exact moment they were looking somewhere else (the file dialog).
//            The placeholder is the same box the image lands in, so nothing
//            moves. It is a hairline circle, not a control: no click target,
//            no icon, no label.
//   AUTH-11  the messages are sentences, not shouting. Case and terminal
//            punctuation only — no wording changed. The four AuthField labels
//            stay UPPERCASE because Label is the one role that keeps case,
//            and every `aria-label` is untouched: the Playwright suite selects
//            on those and they deliberately differ from the visible label.
//
// ⚠️ HEIGHT. Four field groups + a 48px avatar row + a submit. From the token
// values this column computes to ~393px with no error line and ~436px with
// one, against a well of H·(1−2·24vh) = 364px at 700px and 468px at 900px. So
// it still does not fit at the minimum window, and AUTH-16 is explicit that
// the fix is a FRESH MEASUREMENT in the running app, not arithmetic — the last
// person to count rows put a 348px block into a 346px well. The lever named
// there, if the measurement confirms it, is a two-column row for PRONOUNS and
// TITLE (both optional, both short, worth ~66px together); that is a decision
// for whoever holds the measurement, so it is NOT done here.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import AuthShell, {
  AUTH_TITLE_STYLE,
  AUTH_INPUT_STYLE,
  AUTH_BUTTON_STYLE,
  AUTH_BUTTON_BUSY_STYLE,
  AUTH_BUTTON_QUIET_STYLE,
  AUTH_HINT_STYLE,
  AUTH_ERROR_STYLE,
  AUTH_INK,
  AUTH_GAP_WITHIN_FIELD,
  AUTH_GAP_BETWEEN_FIELDS,
  AUTH_GAP_BETWEEN_BLOCKS,
  AuthField,
} from '../auth/AuthShell'
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
      setError('Avatar must be PNG, JPEG, WebP, or GIF.')
      return
    }
    if (f.size > AVATAR_MAX_BYTES) {
      setError('Avatar must be under 2 MB.')
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
      setError('Display name required (1–80 chars).')
      return
    }
    if (pronouns.length > 40) {
      setError('Pronouns too long (max 40).')
      return
    }
    if (title.length > 80) {
      setError('Title too long (max 80).')
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
          setError(`Avatar upload failed: ${upErr.message}`)
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
        setError(`Profile save failed: ${updErr.message}`)
        setBusy(false)
        return
      }

      setRevealing(true)
    } catch (err) {
      setError(`Error: ${err.message || 'unknown'}`)
      setBusy(false)
    }
  }, [busy, displayName, pronouns, title, avatarFile, membership])

  // Session 43 §A7: one field style for every auth surface, from AuthShell.
  // This screen used to carry its own copy — that drift is why the login and
  // the welcome page stopped looking like one system.
  //
  // D2 / AUTH-22: the last trace of that copy was `{ ...AUTH_INPUT_STYLE,
  // width: '24ch' }`, an unexplained override against the kit's 22ch. Two
  // measures for one control on two screens a new user sees back to back. The
  // kit now fixes the width once, in px, as `AUTH_FIELD_WIDTH`, so the inputs
  // below take `AUTH_INPUT_STYLE` unmodified and there is nothing left here to
  // drift.

  // AUTH-23: the reserved avatar slot. The box is identical whether or not a
  // file has been chosen — same 48px, same hairline, same place in the row —
  // so picking a file swaps pixels inside it and moves nothing around it.
  const avatarSlotStyle = {
    width: '48px',
    height: '48px',
    flexShrink: 0,
    borderRadius: '50%',
    border: `1px solid ${AUTH_INK}`,
    overflow: 'hidden',
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
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: AUTH_GAP_BETWEEN_BLOCKS,
        minWidth: '360px',
      }}>
        {/* Title and its deck are ONE block — 8px apart, then 24px of air
            before the form. The screen used to put 18px between all three, so
            the deck belonged to the form as much as to the title. */}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: AUTH_GAP_WITHIN_FIELD,
        }}>
          <div style={AUTH_TITLE_STYLE}>Welcome</div>
          <div style={AUTH_HINT_STYLE}>Tell us about yourself</div>
        </div>

        <form onSubmit={handleSubmit}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: AUTH_GAP_BETWEEN_FIELDS,
              }}>
          <AuthField label="DISPLAY NAME">
            <input
              ref={firstInputRef}
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value.slice(0, 80))}
              style={AUTH_INPUT_STYLE}
              aria-label="Display name"
            />
          </AuthField>

          <AuthField label="PRONOUNS · OPTIONAL">
            <input
              type="text"
              value={pronouns}
              onChange={(e) => setPronouns(e.target.value.slice(0, 40))}
              style={AUTH_INPUT_STYLE}
              placeholder="they/them"
              aria-label="Pronouns"
            />
          </AuthField>

          <AuthField label="TITLE · OPTIONAL">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 80))}
              style={AUTH_INPUT_STYLE}
              placeholder="Lead Animator"
              aria-label="Title"
            />
          </AuthField>

          <AuthField label="AVATAR · OPTIONAL">
          <div style={{
            display: 'flex', alignItems: 'center', gap: AUTH_GAP_WITHIN_FIELD,
          }}>
            {/* The slot is always drawn; only its contents change. See
                avatarSlotStyle above — this is the AUTH-23 reflow fix. */}
            <div style={avatarSlotStyle} aria-hidden="true">
              {avatarPreview && (
                <img
                  src={avatarPreview}
                  alt=""
                  style={{
                    display: 'block',
                    width: '100%', height: '100%', objectFit: 'cover',
                  }}
                />
              )}
            </div>
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
              style={AUTH_BUTTON_QUIET_STYLE}
            >
              {avatarFile ? 'Change' : 'Choose file'}
            </button>
          </div>
          </AuthField>

          {/* No marginTop: the form's own 16px gap separates the submit from
              the last field, which keeps every gap on the scale and gives the
              700px window back the 2px the old hand-typed nudge cost it. */}
          <button
            type="submit"
            disabled={busy}
            className="active:scale-[0.98]"
            style={{
              ...AUTH_BUTTON_STYLE,
              ...(busy ? AUTH_BUTTON_BUSY_STYLE : null),
            }}
          >
            {busy ? 'Saving…' : 'Get started'}
          </button>
        </form>

        {error && <div style={AUTH_ERROR_STYLE}>{error}</div>}
      </div>
    </AuthShell>
  )
}
