// =============================================================================
// CredentialsPopup — the show-once username/password handoff (Session 9).
//
// UX laws embodied:
//   Peak-End Rule — this is THE moment of the create/reset flows; big mono
//     rows, instant copy feedback, and a deliberate exit make it land well.
//   Doherty Threshold — "Copied ✓" swap renders synchronously (<400ms).
//   Fitts's Law — one large COPY BOTH primary; the only exit is one button.
//
// The password exists ONLY in this component's props while it is open — it
// is never stored, logged, or echoed anywhere else (show-once contract with
// the admin-create-user / admin-reset-password Edge Functions).
//
// ── UI overhaul C3b (AT-16, AT-34) ──────────────────────────────────────────
//
// One of four private modal shells on this surface, each with its own
// backdrop, z-index and radius. All four are now the kit `Dialog`, which
// brings the modal stack, the busy lock and — new here — a focus trap and a
// focus return (AT-34: no dialog on the surface trapped focus).
//
// 🚨 THE DELIBERATE EXIT SURVIVES THE MOVE, and it is the reason this file
// passes `onBeforeClose` rather than plain `onClose`. Closing before copying
// anything still takes two taps ("Close without copying?"), and the guard now
// covers the X and Escape as well as the button, so the three exits cannot
// disagree. Before this, Escape did nothing here and there was no X at all;
// Q17 ruled Escape-to-close in kit-wide, and routing it through the SAME gate
// is what keeps that ruling from quietly punching a hole in a show-once
// screen. The backdrop stays inert (`dismissOnBackdrop` is not passed).
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { Copy, Check, AlertTriangle } from 'lucide-react'
import Dialog from '../../ui/Dialog'
import Button from '../../ui/Button'
import Banner from '../../ui/Banner'

// Clipboard write with a legacy fallback — Electron's renderer supports
// navigator.clipboard, but it can reject when the window loses focus
// mid-flow; the execCommand textarea path covers that.
export async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

export default function CredentialsPopup({ open, username, password, context = 'created', onClose }) {
  const [copied, setCopied] = useState(null)     // 'username' | 'password' | 'both' | null
  const [hasCopied, setHasCopied] = useState(false)
  const [armedClose, setArmedClose] = useState(false)
  const revertTimer = useRef(null)
  const armTimer = useRef(null)

  // Reset per showing; clear feedback timers on close/unmount.
  useEffect(() => {
    if (!open) return undefined
    setCopied(null)
    setHasCopied(false)
    setArmedClose(false)
    return () => {
      if (revertTimer.current) clearTimeout(revertTimer.current)
      if (armTimer.current) clearTimeout(armTimer.current)
    }
  }, [open])

  if (!open) return null

  async function doCopy(key, text) {
    const ok = await copyTextToClipboard(text)
    if (!ok) return
    setHasCopied(true)
    setCopied(key)
    if (revertTimer.current) clearTimeout(revertTimer.current)
    revertTimer.current = setTimeout(() => setCopied(null), 1500)
  }

  // The one gate, shared by the footer button, the X and Escape. Returns
  // false the first time, which is what tells `Dialog` not to close; the
  // second call inside the 3s window returns true and the dialog goes.
  function mayClose() {
    if (hasCopied || armedClose) return true
    setArmedClose(true)
    if (armTimer.current) clearTimeout(armTimer.current)
    armTimer.current = setTimeout(() => setArmedClose(false), 3000)
    return false
  }

  return (
    <Dialog
      title="Credentials ready"
      subtitle={context === 'reset'
        ? 'New password generated. Hand these to the member directly.'
        : 'Account created. Hand these to the member directly.'}
      width="form"
      onClose={() => onClose?.()}
      onBeforeClose={mayClose}
      footer={(
        <Button
          variant={hasCopied || armedClose ? 'primary' : 'secondary'}
          onClick={() => { if (mayClose()) onClose?.() }}
        >
          {armedClose && !hasCopied ? 'Close without copying?' : "I've saved these"}
        </Button>
      )}
    >
      <CredentialRow
        label="Username"
        value={username}
        copied={copied === 'username'}
        onCopy={() => doCopy('username', username)}
      />
      <CredentialRow
        label="Password"
        value={password}
        copied={copied === 'password'}
        onCopy={() => doCopy('password', password)}
      />

      {/* The one primary in the dialog body: copying BOTH is the action the
          screen exists for, and it stays the largest target (Fitts). */}
      <Button
        variant="primary"
        Icon={copied === 'both' ? Check : Copy}
        onClick={() => doCopy('both', `Username: ${username}\nPassword: ${password}`)}
        className="at-cred-both"
      >
        {copied === 'both' ? 'Copied ✓' : 'Copy both'}
      </Button>

      <Banner tone="warning" Icon={AlertTriangle} className="at-cred-warn">
        This password is shown once. It cannot be retrieved later — only reset.
      </Banner>
    </Dialog>
  )
}

function CredentialRow({ label, value, copied, onCopy }) {
  return (
    <div className="at-cred-row">
      <span className="at-cred-label">{label}</span>
      <div className="at-cred-value">
        <code className="at-cred-code">{value}</code>
        <Button
          size="sm"
          Icon={copied ? Check : Copy}
          onClick={onCopy}
          className="at-cred-copy"
          data-copied={String(!!copied)}
        >
          {copied ? 'Copied ✓' : 'Copy'}
        </Button>
      </div>
    </div>
  )
}
