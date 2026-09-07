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
// Sits ABOVE every modal (the session warning is 210, the close dialog 200)
// because it is the reason those cannot make progress. In Electron it sits
// under the 32 px title bar so the window controls stay reachable.
// =============================================================================

import { useSyncExternalStore } from 'react'
import { RotateCw, WifiOff } from 'lucide-react'
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
    <div
      role="alert"
      data-testid="connection-lost-banner"
      style={{
        position: 'fixed', top: topOffset, left: 0, right: 0, zIndex,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px',
        padding: '10px 16px',
        backgroundColor: 'rgba(28, 25, 23, 0.97)',
        borderBottom: '2px solid #dc2626',
        color: '#fde8d0',
      }}
    >
      <WifiOff size={14} style={{ color: '#fca5a5', flexShrink: 0 }} />
      <span className="text-xs font-mono">{CONNECTION_LOST_COPY}</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-sm"
        style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}
      >
        <RotateCw size={12} /> Reload
      </button>
    </div>
  )
}
