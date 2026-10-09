// ============================================================
// RABBIT — footage locations, the renderer's half (BC2)
// ============================================================
//
// A footage location is the company's share, saved once by its network
// address (\\server\footage) and named (Audrey's B2). 0091's CHECK
// (bin_locations_unc_path_shape_chk) is the authority; the desktop's
// isUncPath (electron/rabbitBins.cjs) and the fixtures' copy refuse the same
// list, and so does this one, so a person reads the refusal sentence BEFORE
// the request, with the field still in front of them (binsAdapterParity
// holds the four guards to one list).
//
// Postel's law, on the way in only: what a person pastes from Explorer, a
// Mac (smb://nas/footage) or a chat (with quotes, forward slashes, a
// trailing backslash) is rewritten to the one shape the database stores —
// then judged by the same rules. Nothing is accepted that the CHECK refuses.

// 0091's shape: two leading backslashes, a server and at least a share,
// segments free of \ / : * ? " < > |, no . or .. segment, no segment ending
// in a dot or a space, no trailing backslash, at most 1024 characters; never
// this computer (every spelling of the loopback host, an all-digit or 0-led
// host) and never an administrative share (C$, ADMIN$, IPC$).
const UNC_SEGMENT = '[^\\\\/:*?"<>|]+'
const UNC_RE = new RegExp(`^\\\\\\\\${UNC_SEGMENT}(\\\\${UNC_SEGMENT})+$`)
const LOOPBACK_HOST_RE = /^(localhost|127(\.\d+)*|0[\d.x].*|\d+)$/i
const ADMIN_SHARE_RE = /^([a-z]|admin|ipc)\$$/i
const TRAILING_DOT_OR_SPACE_RE = /[. ]$/

export function isUncPath(p) {
  if (typeof p !== 'string' || p.length > 1024 || !UNC_RE.test(p)) return false
  const segs = p.split('\\')
  if (segs.slice(2).some(seg => seg === '.' || seg === '..' || TRAILING_DOT_OR_SPACE_RE.test(seg))) return false
  // BC2 review round 1: a WebDAV address's port or SSL after the host
  // (\\localhost@8080\x) does not make this computer another one.
  const host = segs[2].split('@')[0]
  return !!host && !LOOPBACK_HOST_RE.test(host) && !ADMIN_SHARE_RE.test(segs[3])
}

/**
 * What a person typed or pasted, in the shape the database stores. Trims,
 * drops surrounding quotes, reads smb://host/share and //host/share as
 * \\host\share, turns every forward slash into a backslash and drops a
 * trailing one. Anything that does not start like a network address is
 * returned trimmed and unchanged, for the check to refuse.
 */
export function normalizeUncInput(input) {
  let s = String(input ?? '').trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1).trim()
  const smb = /^smb:\/\//i.exec(s)
  if (smb) s = '\\\\' + s.slice(smb[0].length)
  else if (/^[\\/]{2}[^\\/]/.test(s)) s = '\\\\' + s.slice(2)
  else return s
  s = s.replace(/\//g, '\\').replace(/\\{2,}/g, (m, i) => (i === 0 ? '\\\\' : '\\'))
  while (s.length > 2 && s.endsWith('\\')) s = s.slice(0, -1)
  return s
}

/** The share a path on the network lies in: \\server\share, or null. */
export function shareRootOf(p) {
  const s = normalizeUncInput(p)
  const m = /^\\\\([^\\]+)\\([^\\]+)/.exec(s)
  if (!m) return null
  const root = `\\\\${m[1]}\\${m[2]}`
  return isUncPath(root) ? root : null
}

/** A name to start from for a share: "footage" → "Footage", "vfx_plates" → "Vfx plates". */
export function suggestLocationName(unc) {
  const segs = String(unc || '').split('\\').filter(Boolean)
  const last = (segs[segs.length - 1] || '').replace(/\$$/, '').replace(/[_-]+/g, ' ').trim()
  if (!last) return ''
  return last.charAt(0).toUpperCase() + last.slice(1)
}

/**
 * Who added a location or a clip, in words (B11): the member's name, else
 * "someone who has left" for an id no longer in the company, else null when
 * nothing is recorded. `members` is the workspace directory's rows
 * ({ user_id, display_name, username }) or the roster's ({ id, name }).
 */
export function addedByName(userId, members) {
  if (!userId) return null
  const m = (members || []).find(x => x.user_id === userId || x.id === userId)
  if (m) return m.display_name || m.name || m.username || 'a teammate'
  return 'someone who has left'
}

// Where no computer can reach the footage to pick it (the cloud, in a
// browser), the add verbs say why. The desktop app signed in can.
export const ADD_NEEDS_DESKTOP = 'Adding clips needs the desktop app on a computer that can reach the footage.'

// ── B3: a clip this computer cannot reach ──
// "A clip a computer cannot reach still shows, with its details, marked
// 'not on this computer'; it can be logged, flagged and assigned to a shot;
// it cannot be played there."
export const NOT_ON_THIS_COMPUTER = 'not on this computer'

// ── Consent before contact (BC2 review round 1) ──
// Any member can name a company location; this computer connects to its
// address only once its own person agrees (the desktop's native "Connect
// this computer to \\server\share?", Cancel by default).
export const NOT_CONNECTED_HERE = 'Not connected on this computer'
export const CONNECT_LABEL = 'Connect…'
export const CONNECT_TITLE = 'Let this computer read footage at this address. Windows asks you to confirm the address first; only this computer keeps the answer.'
/** "Footage NAS" (\\nas\footage) is not connected on this computer yet… */
export function notConnectedSentence(names, unc = null) {
  const q = (names || []).map(n => `"${n}"`)
  const one = `${q[0] || 'This footage location'}${unc ? ` (${unc})` : ''}`
  const who = q.length <= 1 ? `${one} is` : `${q.slice(0, -1).join(', ')} and ${q[q.length - 1]} are`
  return `${who} not connected on this computer yet, so ${q.length <= 1 ? 'its clips' : 'their clips'} cannot be played here. Connect only to a share you recognise.`
}
/** The sentence under a clip whose location this computer has not connected to. */
export function notConnectedClipSentence(locationName) {
  return `${locationName ? `"${locationName}"` : 'Its footage location'} is not connected on this computer yet, so the clip cannot be played here. It can still be logged, flagged and assigned to a shot.`
}
/** The sentence under a company's clip that cannot be played here. */
export function notHereSentence(locationName) {
  return `${locationName ? `"${locationName}"` : 'Its footage location'} is not reachable from this computer, so the clip cannot be played here. It can still be logged, flagged and assigned to a shot.`
}

/**
 * What THIS computer said about a location when it was registered (the
 * provider's binsInfo.locations), in words, or null where no desktop answered
 * (a browser). `status`: { reachable, local_path, local_path_source, root }.
 */
export function locationReachWords(status) {
  if (!status || status.status === 'refused') return null
  // Review round 1: never contacted until this computer's person agrees.
  if (status.connected === false) return NOT_CONNECTED_HERE
  if (status.local_path && status.reachable) return `On this computer at ${status.local_path}`
  if (status.local_path && !status.reachable) return `Not reachable from this computer (looked in ${status.local_path})`
  return status.reachable ? 'Reachable from this computer' : 'Not reachable from this computer'
}
