// =============================================================================
// minuteClock.js — one clock for words drawn from the time (F4, 2026-11-13;
// review round 1).
//
// "5m ago", "3h ago": a component computes them from Date.now() while it
// draws, so they are as fresh as its last render. Until F4 a live pet's ticks
// drew every page every few seconds, and that kept them moving by accident;
// F4 took those renders away, and on a page left open the words stood still.
// A component that draws such words calls useMinuteClock(): it is drawn again
// once a minute, from one interval shared by every reader, which runs only
// while somebody reads it.
// =============================================================================
import { useSyncExternalStore } from 'react'

const MINUTE_MS = 60_000
const listeners = new Set()
let minute = 0
let timer = null

function subscribe(listener) {
  listeners.add(listener)
  if (timer === null) {
    timer = setInterval(() => {
      minute += 1
      for (const notify of listeners) notify()
    }, MINUTE_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}
const read = () => minute

/** Draw the calling component again once a minute (the value is a counter, not the time: read Date.now() as before). */
export function useMinuteClock() {
  return useSyncExternalStore(subscribe, read, read)
}
