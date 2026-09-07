// =============================================================================
// CredentialsPopup — the show-once username/password handoff (Session 9).
//
// UX laws embodied:
//   Peak-End Rule — this is THE moment of the create/reset flows; big mono
//     rows, instant copy feedback, and a deliberate exit make it land well.
//   Doherty Threshold — "COPIED ✓" swap renders synchronously (<400ms).
//   Fitts's Law — one large COPY BOTH primary; the only exit is one button.
//
// The password exists ONLY in this component's props while it is open — it
// is never stored, logged, or echoed anywhere else (show-once contract with
// the admin-create-user / admin-reset-password Edge Functions).
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { Copy, Check, KeyRound, AlertTriangle } from 'lucide-react'

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

  // Deliberate exit: no backdrop click, no X, no Escape. Closing without a
  // copy needs a second tap on the same button ("Close without copying?").
  function handleClose() {
    if (hasCopied || armedClose) {
      onClose?.()
      return
    }
    setArmedClose(true)
    if (armTimer.current) clearTimeout(armTimer.current)
    armTimer.current = setTimeout(() => setArmedClose(false), 3000)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 90, backgroundColor: 'rgba(0,0,0,0.65)' }}
    >
      <div
        style={{
          backgroundColor: '#1c1917', border: '2px solid #ea580c', borderRadius: '6px',
          padding: '22px 24px', width: 'min(460px, 92vw)', color: '#f4a261',
        }}
      >
        <div className="flex items-center gap-2 mb-1">
          <KeyRound className="w-4 h-4" style={{ color: '#ea580c' }} />
          <h2 className="font-mono uppercase text-sm tracking-widest" style={{ color: '#ea580c' }}>
            Credentials ready
          </h2>
        </div>
        <p className="text-xs mb-4" style={{ color: '#a8a29e' }}>
          {context === 'reset'
            ? 'New password generated. Hand these to the member directly.'
            : 'Account created. Hand these to the member directly.'}
        </p>

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

        <button
          type="button"
          onClick={() => doCopy('both', `Username: ${username}\nPassword: ${password}`)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 mt-1 mb-3 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors"
          style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}
        >
          {copied === 'both' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied === 'both' ? 'Copied ✓' : 'Copy both'}
        </button>

        <div className="flex items-start gap-2 mb-4 text-[11px] leading-relaxed" style={{ color: '#fbbf24' }}>
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>This password is shown ONCE. It cannot be retrieved later — only reset.</span>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors"
            style={hasCopied || armedClose
              ? { backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #f4a261' }
              : { backgroundColor: 'transparent', color: '#78716c', border: '1px solid #44403c' }}
          >
            {armedClose && !hasCopied ? 'Close without copying?' : "I've saved these"}
          </button>
        </div>
      </div>
    </div>
  )
}

function CredentialRow({ label, value, copied, onCopy }) {
  return (
    <div className="mb-3">
      <span className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#a8a29e' }}>
        {label}
      </span>
      <div className="flex items-center gap-2">
        <code
          className="flex-1 px-3 py-2.5 text-sm font-mono rounded-sm break-all select-all"
          style={{ backgroundColor: 'rgba(244, 162, 97, 0.12)', color: '#fde8d0', border: '1px solid #44403c' }}
        >
          {value}
        </code>
        <button
          type="button"
          onClick={onCopy}
          className="flex items-center gap-1 px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors flex-shrink-0"
          style={copied
            ? { backgroundColor: 'rgba(34, 197, 94, 0.15)', color: '#22c55e', border: '1px solid #22c55e' }
            : { backgroundColor: 'transparent', color: '#f4a261', border: '1px solid #44403c' }}
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
    </div>
  )
}
