// =============================================================================
// ConnectionLostBanner — Track B bundle B2, part 2. The one sentence the app
// says when connectionWatchdog decides a bounded call has hung while the
// browser still claims to be online: "Connection lost — reload to continue."
//
// Why Reload and not Retry: the hang lives inside supabase-js's shared
// refresh promise, which nothing outside the SDK can cancel; a reload is the
// only recovery the client has, and Audrey chose the banner over reconnect
// logic (fix plan answer 10). A reload re-hydrates from the stored session,
// so it costs nothing but the page state.
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

const subscribe = (listener) => connectionWatchdog.subscribe(listener)
const getSnapshot = () => connectionWatchdog.getSnapshot()

export default function ConnectionLostBanner({ watchdog = null }) {
  const read = watchdog ? () => watchdog.getSnapshot() : getSnapshot
  // The third argument is the "server" snapshot. WILSON never server-renders
  // (Electron and a static host), so the only server render is a test's
  // renderToString, which should see the real value, not a hard-coded false.
  const lost = useSyncExternalStore(watchdog ? (l) => watchdog.subscribe(l) : subscribe, read, read)
  if (!lost) return null
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
        {CONNECTION_LOST_COPY}
      </Banner>
    </div>
  )
}
