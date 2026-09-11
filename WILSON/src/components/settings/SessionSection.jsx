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
import './settings.css'
import { Section, Group, Row } from './SettingsChrome'
import { Button } from '../../ui'

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
    <Section title="Session">
      {!perms.ready ? (
        <p className="s-row-desc">Checking your account…</p>
      ) : !perms.userId ? (
        // The true thing to say when there is no cloud session behind this
        // window — the same shape PasswordSection uses rather than rendering a
        // live control that cannot work.
        <p className="s-row-desc">
          You are not signed in to a workspace account on this device, so there
          is nothing to sign out of.
        </p>
      ) : (
        <Group>
          {/* The in-place confirm stays in place. S25 routes the two
              DESTRUCTIVE hand-rolled overlays through the kit Dialog; this one
              is a two-step on a reversible action (you can sign back in), and
              the review keeps the inline pattern exactly there. What changes
              is that both buttons had `hover:bg-red-50` and `hover:bg-stone-100`
              — two near-white fills on the orange ground, which C9 bans. */}
          <Row
            label="Sign out"
            description={confirming
              ? 'Sign out of WILSON on this device?'
              : 'Signs you out on this device only — other computers you are signed in on stay signed in, and so does the operator console if you use one. Your pet and your personal settings live with your account, so they will be waiting when you sign back in.'}
          >
            {!confirming ? (
              <Button surface="light" size="sm" variant="danger" Icon={LogOut} onClick={() => setConfirming(true)}>
                Sign out
              </Button>
            ) : (
              <>
                <Button surface="light" size="sm" variant="danger" onClick={handleSignOut} disabled={busy}>
                  {busy ? 'Signing out…' : 'Sign out'}
                </Button>
                <Button surface="light" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
                  Cancel
                </Button>
              </>
            )}
          </Row>
        </Group>
      )}
    </Section>
  )
}
