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
// button has always meant. Concretely: `onDismiss` does NOT call
// `skipVersion`, so the prompt returns at the next sign-in — exactly what
// "Continue in background" and "Close" already did, and deliberately NOT what
// "Skip this version" does (that one remembers the version and stays quiet
// until the next release). Two exits, two meanings, both already shipped.
// `dismissOnBackdrop` is deliberately NOT passed — a stray click must not
// dismiss a release notice.
//
// 🚨 R2 REVERSAL — a failed download reports in the BODY again, as the kit
// `Banner tone="danger"`, NOT through Dialog's `error` slot. R1 moved it into
// that slot to avoid Banner's nesting cost; R2 measured what the slot does to
// the message. `.ui-dialog-error > span` is
// `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`
// (index.css), so the slot renders exactly ONE clipped line. At
// `width="confirm"` (400px) the footer row is 352px of content, shared with
// the phase's `Close` button (~72px), an 8px gap, the 16px AlertTriangle and
// its 6px gap — roughly 250px, about 43 characters of 13px Dense. The
// shortest string this surface can produce, "Download failed. — you can retry
// from Settings later.", is 53; a real electron-updater failure
// ("net::ERR_CONNECTION_RESET", a 404 on the feed URL) is far longer. The
// clipped half is the END of the sentence — the half that says what to do —
// and it survives only in a `title` tooltip, which no keyboard user can
// reach. `.ui-banner-text` is `flex: 1; min-width: 0` with no nowrap, so the
// Banner wraps and the body scrolls. Information wins over nesting.
//
// The cost R1 was right about is real and is now filed rather than paid for
// with the message: Banner is a full-bleed in-flow strip (`8px
// var(--spacing-gutter)`) dropped inside `.ui-dialog-body`'s own 24px, so the
// text is inset 48px from the card edge and Banner's `border-bottom` hairline
// stops 24px short of both edges. Two kit requests, NOT fixed with an inline
// style here (overriding a kit component at the call site is the Bins
// dead-hover pattern the kit header forbids):
//
//   🚨 K9  `.ui-dialog-error > span` should wrap — drop `white-space: nowrap`
//          and `text-overflow: ellipsis`. `.ui-dialog-foot` is already
//          `flex-wrap: wrap; align-items: center`, so a two-line error lays
//          out correctly. Until it lands, Dialog's `error` slot may only
//          carry strings short enough to fit, and neither of this session's
//          two callers' strings are. (InviteMemberDialog carries the same
//          note; the two surfaces now match.)
//   🚨 K10 Dialog should take a wrapping error slot in the BODY — or Banner
//          should have a nested/inset variant — so a long failure does not
//          have to choose between double padding and truncation.
//
// The AlertTriangle is kept so the glyph is the one `.ui-dialog-error` drew;
// on the danger tint (#413333 over `paper-raised`) the label measures 10.63:1
// and the glyph 6.34:1.
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
    <Dialog
      title="Update available"
      width="confirm"
      onClose={onDismiss}
      footer={footer}
    >
      <div>
        WILSON {version} is ready to install (you're on {wilsonVersion}).
      </div>

      {phase === 'downloading' && (
        <div style={{ marginTop: 16 }}>
          {/* The bar already knows the value; this reports it. No pixel and no
              behaviour changes — `percent` is the same number the readout
              below prints. */}
          <div
            role="progressbar"
            aria-label="Download progress"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
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

      {/* R2: back in the body, where the sentence can finish. 16px is the
          kit's between-blocks step (`.ui-field + .ui-field`), the same one
          the progress block above uses. Banner's role is `alert` for
          tone="danger", which is the announcement `.ui-dialog-error`'s
          `role="alert"` span was making — so nothing is lost to a screen
          reader either. See K9 / K10 in the header for the nesting cost. */}
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
