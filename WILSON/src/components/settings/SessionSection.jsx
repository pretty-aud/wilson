// =============================================================================
// SessionSection — the Sign out control (Session 31).
//
// `docs/OUTSTANDING.md` recorded this as "there is no way to log out", which was
// true of the Settings screen and slightly wrong about the app: the MECHANISM
// has existed since S30 as `window.wilsonSignOut`, and it already had exactly
// one caller — MfaEnrollGate's "Sign out instead" link, reachable only by an
// admin who has not yet set up two-factor. So this adds a second caller to a
// live path, not a fourth instance of the built-with-no-caller shape.
//
// 🚨 WHY THIS SHIPS WITH THE PER-USER PET AND NOT BEFORE IT.
// Nothing has ever cleared the pet on sign-out — `clearSession()` only clears
// the auth blob, and on the desktop app pet.json survives on disk regardless.
// The previous person's pet stayed in React state, kept decaying, kept saving,
// and reappeared for whoever signed in next. That leak has been near-unreachable
// only because sign-out was buried in the MFA gate. Making sign-out reachable
// WITHOUT the teardown in App.jsx would have converted a latent leak into a
// routine one — so the button and the teardown are one change.
// =============================================================================

import { useCallback, useState } from 'react'
import { LogOut } from 'lucide-react'
import { usePermissions } from '../../permissions/usePermissions'

export default function SessionSection() {
  const perms = usePermissions()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const handleSignOut = useCallback(async () => {
    setBusy(true)
    try {
      await window.wilsonSignOut?.()
    } finally {
      // No success state to render: a successful sign-out unmounts this whole
      // screen behind the auth overlay.
      setBusy(false)
      setConfirming(false)
    }
  }, [])

  return (
    <div>
      <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">
        Session
      </h2>

      {!perms.ready ? (
        <p className="text-xs font-mono italic" style={{ color: '#78716c' }}>
          Checking your account…
        </p>
      ) : !perms.userId ? (
        // The true thing to say when there is no cloud session behind this
        // window — the same shape PasswordSection uses rather than rendering a
        // live control that cannot work.
        <p className="text-xs text-stone-950 mb-4 leading-relaxed">
          You are not signed in to a workspace account on this device, so there
          is nothing to sign out of.
        </p>
      ) : (
        <>
          <p className="text-xs text-stone-950 mb-4 leading-relaxed">
            Signs you out on <strong>this device only</strong> — other computers
            you are signed in on stay signed in, and so does the operator console
            if you use one. Your pet and your personal settings live with your
            account, so they will be waiting when you sign back in.
          </p>

          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors border border-red-700 text-red-800 hover:bg-red-50 inline-flex items-center gap-2"
              style={{ backgroundColor: 'transparent' }}
            >
              <LogOut size={13} />
              Sign out
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-stone-950 mr-1">Sign out of WILSON on this device?</span>
              <button
                type="button"
                onClick={handleSignOut}
                disabled={busy}
                className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors border border-red-700 text-red-800 hover:bg-red-50 disabled:opacity-50"
                style={{ backgroundColor: 'transparent' }}
              >
                {busy ? 'Signing out…' : 'Sign out'}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors border border-stone-600 text-stone-800 hover:bg-stone-100 disabled:opacity-50"
                style={{ backgroundColor: 'transparent' }}
              >
                Cancel
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
