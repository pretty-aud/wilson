// ============================================================
// RABBIT — Bins: what the tab can do HERE, read from the capability object
// ============================================================
//
// BC3 (Audrey's B5): until the file gateway exists, a browser shows the
// CATALOGUE — every bin and clip, pictures where the company allows them,
// logging, marks, takes, move, copy, remove — and says plainly that adding
// clips and playing them need the desktop app. The branch is on BC1's
// capability object (`ctx.binsInfo.capabilities`), never on
// `window.electronAPI` or the user agent: the beta in a browser and Chromium
// inside the desktop app read the same object, and the dev fixtures answer
// it too. A null object (before the first list) reads as the signed-out
// desktop, as BinsView always has (B12).
//
// Pure, so binsViewBrowser.test.jsx can pin every answer.

import { NOT_ON_THIS_COMPUTER } from './binLocations'

/**
 * @param {object|null} caps the backend's capability object
 * @returns {{ catalogue: boolean, canPick: boolean, canStream: boolean,
 *   canProbe: boolean, canOpen: boolean, canRelink: boolean,
 *   nothingReachable: boolean, offlineWord: string }}
 *   - `catalogue`: no computer here can pick a file or read its bytes — the
 *     browser (the cloud adapter, the fixtures): one notice, New bin instead
 *     of Add, the picture large on Space, no drop from the OS;
 *   - `canPick` … `canRelink`: the four verbs a control is offered for only
 *     where the backend answers them (no disabled control without a reason);
 *   - `nothingReachable`: the backend cannot say what this computer reaches
 *     (`resolveFiles` false), so every row is "not on this computer" (B3) and
 *     a count of them says nothing — the notice says it once instead;
 *   - `offlineWord`: a company's clip is "not on this computer"; the
 *     signed-out desktop's says "offline" (B12).
 */
export function binsModeOf(caps) {
  const c = caps && typeof caps === 'object' ? caps : null
  const yes = (k) => (c ? c[k] !== false : true)
  return Object.freeze({
    catalogue: !!c && c.pickFiles === false && c.stream === false,
    canPick: yes('pickFiles'),
    canStream: yes('stream'),
    canProbe: yes('probe'),
    canOpen: yes('openInOs'),
    canRelink: yes('relink'),
    nothingReachable: !!c && c.resolveFiles === false,
    offlineWord: c?.locations ? NOT_ON_THIS_COMPUTER : 'offline',
  })
}
