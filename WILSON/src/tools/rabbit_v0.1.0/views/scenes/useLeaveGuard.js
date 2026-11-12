// ============================================================
// RABBIT — a component's own leave guard (post-overhaul S3c, step 7)
// ============================================================
//
// A view that holds typed work registers it with the leave guard
// (state/leaveGuard.js) for as long as it is mounted, so an exit asks first.
// `dirty` and `ask` are read when an exit asks, never captured stale: each
// render hands in the current ones.
//   order    nearer work asks first (a popup's typed text, 1; the edit, 2)
//   reasons  the exits it is about ('tab', 'project', 'popup', …)
//   dirty()  whether it holds anything now
//   ask()    → Promise<boolean>: true to go on (it was discarded), false to stay
// ============================================================

import { useEffect, useRef } from 'react'
import { addLeaveGuard } from '../../state/leaveGuard'

export function useLeaveGuard({ order, reasons, dirty, ask }) {
  const live = useRef({ dirty, ask })
  live.current = { dirty, ask }
  const key = reasons.join(' ')
  useEffect(() => addLeaveGuard({
    order,
    applies: (reason) => key.split(' ').includes(reason),
    dirty: () => !!live.current.dirty(),
    ask: (reason) => live.current.ask(reason),
  }), [order, key])
}
