// =============================================================================
// ConnectionLostBanner — Track B bundle B2, part 2, and S1 (night 2,
// 2026-10-27). The two sentences the app says when connectionWatchdog decides
// a bounded call has hung while the browser still claims to be online:
//
//   reconnecting   "Connection lost — reconnecting…"       from the budget
//   reload         "Connection lost — reload to continue."  60 s lost on
//
// S1 made the watchdog abort the hung request, which the SDK reads as a
// retryable failure: it keeps the session and retries by itself, and the
// watchdog pings the service that hung every 10 s, so the moment the network
// answers the app continues with the same client — no reload. The first
// sentence says so. The second is B2's, kept for the state it was written
// for: nothing has answered for a minute, and a person who would rather not
// wait has the one remedy a client has. Reload stays on both states, as the
// escape hatch. Both sentences contain "Connection lost" and the button is
// "Reload" in both: CI's Playwright scenario 11 reads either.
//
// Before S1 the sentence was the second one alone, because the hang lived
// inside supabase-js's shared refresh promise and a reload was the only
// recovery the client had (Audrey's answer 10 of the fix plan deferred the
// reconnect; her answer of 2026-10-27 asked for it).
//
// Sits ABOVE every modal, at 300, because it is the reason none of them can
// make progress: the kit's dialogs are 70 and its toast stack 90, the
// operator console's own modals 85 and 90, App's quit dialog 200, and the
// idle "Still there?" dialog is the kit Dialog lifted to 210 by
// SessionWarning's layer (its cap notice rides the toast stack on /wilson
// and the corner card, also 210, on the console). The layer is
// `.connection-banner` in index.css (round 2 of the merge review, B-R2-07),
// beside the kit's own layers, where the z scale is written once; the strip
// clears Electron's 32px title bar through `--titlebar-offset`, the kit's
// one token for that (index.css: "any fixed overlay that must clear the bar
// reads this instead of a literal 32") — 32px under `.electron-app`, which
// TitleBar sets on <html>, and 0 in the browser and on the operator console,
// which has no TitleBar. So the window controls stay reachable, and nothing
// here computes an offset or carries a z.
//
// On the kit since the post-overhaul merge (2026-09-30): the strip is the kit
// `Banner` in its danger tone (which is what gives it `role="alert"`) with a
// kit `Button` in the action slot, on a fixed wrapper that only supplies the
// position — the same shape ModelWarningBanner takes in the flow.
// =============================================================================

import { useSyncExternalStore } from 'react'
import { RotateCw, WifiOff } from 'lucide-react'
import { Banner, Button } from '../ui'
import { connectionWatchdog } from './connectionWatchdog'

export const CONNECTION_LOST_COPY = 'Connection lost — reload to continue.'
export const RECONNECTING_COPY = 'Connection lost — reconnecting…'

// S2 (night 3, 2026-10-27; docs/design/RECONNECT_DESIGN.md §11.8): the one
// sentence each tool screen shows while the shell runs on a sign-in held at an
// offline launch, in place of its empty state. Her ruling: "One offline
// sentence on each screen, no empty-state words" — no "No projects yet", and no
// New or Create control beside it. The noun is the screen's.
export function offlineSentence(noun = 'projects') {
  return `Could not reach the database — your ${noun} appear when the connection returns.`
}

const subscribe = (listener) => connectionWatchdog.subscribe(listener)
const getPhase = () => connectionWatchdog.getPhase()

export default function ConnectionLostBanner({ watchdog = null }) {
  const read = watchdog ? () => watchdog.getPhase() : getPhase
  // The third argument is the "server" snapshot. WILSON never server-renders
  // (Electron and a static host), so the only server render is a test's
  // renderToString, which should see the real value, not a hard-coded 'ok'.
  const phase = useSyncExternalStore(watchdog ? (l) => watchdog.subscribe(l) : subscribe, read, read)
  if (phase === 'ok') return null
  return (
    <div className="connection-banner">
      <Banner
        tone="danger"
        Icon={WifiOff}
        data-testid="connection-lost-banner"
        action={(
          <Button size="sm" variant="primary" Icon={RotateCw} onClick={() => window.location.reload()}>
            Reload
          </Button>
        )}
      >
        {phase === 'reload' ? CONNECTION_LOST_COPY : RECONNECTING_COPY}
      </Banner>
    </div>
  )
}
