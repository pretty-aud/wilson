// =============================================================================
// ModelWarningBanner — Session 19, decision D6.
//
// When a configured AI model is dead or malformed, `resolveModel()` substitutes
// a working one so the generation still succeeds. That substitution must be
// visible. The whole reason S19 exists is that a model died and the failure
// reached users as a generic "try again" — nobody had anywhere to look.
//
// So this is deliberately not a toast: it does not time out, and it names the
// function and the bad model. It sits below the title bar rather than over the
// content, because it reports a degraded state, not an event — the work is
// still running, just not on the model someone chose.
//
// Dismissal is per-warning. Dismissing does not fix the setting, and the
// banner returns on the next call that resolves the same bad value.
//
// D2 / AUTH-01: this used to paint amber `#b45309` on a 14 percent amber tint,
// mounted as the first child of the authenticated column whose ground is the
// `#ea580c` frame. The tint composited to `#e2570c` and the text measured
// 1.34:1 — the one notice built to be impossible to miss was invisible, and it
// put an amber grey on an orange surface, which the light-surface rule forbids
// outright. The strip is now a RAISED DARK surface rather than a tint of the
// ground it sits on, and it is the kit `Banner`'s first caller.
//
// Measured on `paper-raised` #232020: the banner's own 14 percent `warning`
// tint composites to #40321d; `ink` #f5f0ec on it is 10.97:1 and the `warning`
// #f59e0b icon is 5.78:1.
//
// `data-surface="dark"` is load-bearing, not decoration: `.wilson-chrome`
// alone scopes the focus ring to `ink-light`, which is 1.00:1 on #232020.
// The dark-surface rule in index.css takes the signal ring back.
// =============================================================================

import { useEffect, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { Banner, IconButton, PAPER_RAISED } from '../ui'
import { subscribeModelWarnings, dismissModelWarning } from '../lib/activeModel'

export default function ModelWarningBanner() {
  const [warnings, setWarnings] = useState([])

  useEffect(() => subscribeModelWarnings(setWarnings), [])

  if (warnings.length === 0) return null

  return (
    <div
      className="wilson-chrome"
      data-surface="dark"
      style={{ position: 'relative', zIndex: 40, backgroundColor: PAPER_RAISED }}
    >
      {warnings.map((w) => (
        <Banner
          key={w.key}
          tone="warning"
          Icon={AlertTriangle}
          action={(
            <IconButton
              Icon={X}
              size="sm"
              title="Dismiss"
              onClick={() => dismissModelWarning(w.key)}
            />
          )}
        >
          {w.text}
        </Banner>
      ))}
    </div>
  )
}
