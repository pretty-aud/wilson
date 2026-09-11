// =============================================================================
// UpdatePrompt — Session 9: the login-time "update or skip" surface.
//
// Shown once per sign-in when the updater reports a newer version (and the
// user hasn't skipped that exact version). Update → download with live
// percent → restart+install. Skip remembers the version and stays quiet
// until the next release. Von Restorff: one modal, two choices.
//
// D2 / AUTH-06 + AUTH-13: this was a hand-rolled overlay — its own backdrop,
// its own #1c1917 card with a 2px #ea580c border, mono body copy, a
// `rounded-sm` progress bar, and two buttons in one row wearing two different
// type treatments (one 12px mono sentence case, one 12px bold uppercase
// letterspaced). It is now the kit `Dialog` at the 'confirm' width (400 — the
// only widths that may be written are 400 / 560 / 720 / 960) with kit
// `Button`s in the footer.
//
// The Dialog brings Escape-to-close, the modal stack and the busy lock
// (Q17, "yes, but keep it minimal"), which is why `onClose` is `onDismiss`:
// Escape and the header close both mean "not now", the same thing the quiet
// button has always meant. `dismissOnBackdrop` is deliberately NOT passed —
// a stray click must not dismiss a release notice.
//
// The body line is a SENTENCE, so it carries no mono (AUTH-13). The only
// mono left is the percentage readout, which is a numeric.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Download, RotateCw } from 'lucide-react'
import {
  Banner, Button, Dialog,
  DURATION, EASE_RESPONSE, FONT_MONO, INK_2, RADIUS_CONTROL, RULE, SIGNAL_FILL, TYPE,
} from '../ui'
import {
  downloadUpdate, installUpdate, onUpdateStatus, skipVersion,
} from '../cloud/updates'

const wilsonVersion = typeof __WILSON_VERSION__ !== 'undefined' ? __WILSON_VERSION__ : 'v?'

export default function UpdatePrompt({ version, onDismiss }) {
  const [phase, setPhase] = useState('offer') // offer | downloading | ready | error
  const [percent, setPercent] = useState(0)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    const unsub = onUpdateStatus((s) => {
      if (!mountedRef.current) return
      if (s.state === 'downloading') { setPhase('downloading'); setPercent(s.progress?.percent ?? 0) }
      else if (s.state === 'downloaded') setPhase('ready')
      else if (s.state === 'error') { setPhase('error'); setError(s.error ?? 'Download failed.') }
    })
    return () => unsub()
  }, [])

  const start = useCallback(async () => {
    setPhase('downloading')
    setPercent(0)
    const res = await downloadUpdate()
    if (!res.ok && mountedRef.current) {
      setPhase('error')
      setError(res.error ?? 'Download failed.')
    }
  }, [])

  const skip = useCallback(() => {
    skipVersion(version)
    onDismiss?.()
  }, [version, onDismiss])

  const footer = (
    <>
      {phase === 'offer' && (
        <>
          <Button variant="secondary" onClick={skip}>Skip this version</Button>
          <Button variant="primary" onClick={start}>
            <Download aria-hidden="true" />
            Update now
          </Button>
        </>
      )}
      {phase === 'downloading' && (
        <Button
          variant="secondary"
          onClick={onDismiss}
          title="Keeps downloading — install from Settings when ready"
        >
          Continue in background
        </Button>
      )}
      {phase === 'ready' && (
        <Button variant="primary" onClick={() => installUpdate()}>
          <RotateCw aria-hidden="true" />
          Restart &amp; install
        </Button>
      )}
      {phase === 'error' && (
        <Button variant="secondary" onClick={onDismiss}>Close</Button>
      )}
    </>
  )

  return (
    <Dialog title="Update available" width="confirm" onClose={onDismiss} footer={footer}>
      <div>
        WILSON {version} is ready to install (you're on {wilsonVersion}).
      </div>

      {phase === 'downloading' && (
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              height: 8, borderRadius: RADIUS_CONTROL, overflow: 'hidden',
              backgroundColor: RULE,
            }}
          >
            <div
              style={{
                width: `${percent}%`, height: '100%',
                backgroundColor: SIGNAL_FILL,
                transition: `width ${DURATION.response}ms ${EASE_RESPONSE}`,
              }}
            />
          </div>
          {/* The readout is a numeric, so it keeps the mono (Q4). */}
          <div style={{ marginTop: 6, fontFamily: FONT_MONO, fontSize: TYPE.caption, color: INK_2 }}>
            {percent}%
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div style={{ marginTop: 16 }}>
          <Banner tone="danger" Icon={AlertTriangle}>
            {error} — you can retry from Settings later.
          </Banner>
        </div>
      )}
    </Dialog>
  )
}
