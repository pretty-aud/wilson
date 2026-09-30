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
// Sits ABOVE every modal (the session warning is 210, the kit's dialogs 70)
// because it is the reason those cannot make progress. In Electron it sits
// under the 32 px title bar so the window controls stay reachable.
//
// On the kit since the post-overhaul merge (2026-09-30): the strip is the kit
// `Banner` in its danger tone (which is what gives it `role="alert"`) with a
// kit `Button` in the action slot, on a fixed wrapper that only supplies the
// position — the same shape ModelWarningBanner takes in the flow.
// =============================================================================

import { useSyncExternalStore } from 'react'
import { RotateCw, WifiOff } from 'lucide-react'
import { Banner, Button, PAPER_RAISED } from '../ui'
import { connectionWatchdog } from './connectionWatchdog'

export const CONNECTION_LOST_COPY = 'Connection lost — reload to continue.'

const subscribe = (listener) => connectionWatchdog.subscribe(listener)
const getSnapshot = () => connectionWatchdog.getSnapshot()

export default function ConnectionLostBanner({ topOffset = 0, zIndex = 300, watchdog = null }) {
  const read = watchdog ? () => watchdog.getSnapshot() : getSnapshot
  // The third argument is the "server" snapshot. WILSON never server-renders
  // (Electron and a static host), so the only server render is a test's
  // renderToString, which should see the real value, not a hard-coded false.
  const lost = useSyncExternalStore(watchdog ? (l) => watchdog.subscribe(l) : subscribe, read, read)
  if (!lost) return null
  return (
    <div style={{ position: 'fixed', top: topOffset, left: 0, right: 0, zIndex, backgroundColor: PAPER_RAISED }}>
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
