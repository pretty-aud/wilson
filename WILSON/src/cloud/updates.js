// =============================================================================
// updates — Session 9: renderer-side wrapper for the auto-update bridge.
//
// Feature-detected: in the vite dev server (no preload) or a non-NSIS build
// everything resolves to { state: 'disabled' } and the UI stays quiet.
// Skip bookkeeping (login prompt's "Skip" is per-version) lives here.
// =============================================================================

import { reportAppEvent } from './errorCodes'

const SKIP_KEY = 'wilson.update.skipped-version'

const bridge = () =>
  (typeof window !== 'undefined' && window.electronAPI?.updates) || null

export function updatesSupported() {
  return !!bridge()
}

export async function getUpdateState() {
  const b = bridge()
  if (!b) return { state: 'disabled', reason: 'no-bridge' }
  try { return await b.getState() } catch { return { state: 'disabled', reason: 'bridge-error' } }
}

export async function checkForUpdates() {
  const b = bridge()
  if (!b) return { ok: false, error: 'no-bridge' }
  try {
    return await b.check()
  } catch (err) {
    reportAppEvent({ code: 'WIL-5001', eventType: 'update', context: {}, error: err })
    return { ok: false, error: err?.message ?? String(err) }
  }
}

export async function downloadUpdate() {
  const b = bridge()
  if (!b) return { ok: false, error: 'no-bridge' }
  try {
    return await b.download()
  } catch (err) {
    reportAppEvent({ code: 'WIL-5002', eventType: 'update', context: {}, error: err })
    return { ok: false, error: err?.message ?? String(err) }
  }
}

export async function installUpdate() {
  const b = bridge()
  if (!b) return { ok: false, error: 'no-bridge' }
  try { return await b.install() } catch (err) { return { ok: false, error: err?.message ?? String(err) } }
}

/** Subscribe to updater status pushes; returns unsubscribe (noop w/o bridge). */
export function onUpdateStatus(callback) {
  const b = bridge()
  if (!b) return () => {}
  try { return b.onStatus(callback) } catch { return () => {} }
}

export function getSkippedVersion() {
  try { return localStorage.getItem(SKIP_KEY) } catch { return null }
}

export function skipVersion(version) {
  try { if (version) localStorage.setItem(SKIP_KEY, version) } catch { /* private mode */ }
}
