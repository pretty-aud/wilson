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
  return !LOOPBACK_HOST_RE.test(segs[2]) && !ADMIN_SHARE_RE.test(segs[3])
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
 * nothing is recorded. `members` is the workspace directory's rows.
 */
export function addedByName(userId, members) {
  if (!userId) return null
  const m = (members || []).find(x => x.user_id === userId)
  if (m) return m.display_name || m.username || 'a teammate'
  return 'someone who has left'
}

/**
 * What THIS computer said about a location when it was registered (the
 * provider's binsInfo.locations), in words, or null where no desktop answered
 * (a browser). `status`: { reachable, local_path, local_path_source, root }.
 */
export function locationReachWords(status) {
  if (!status || status.status === 'refused') return null
  if (status.local_path && status.reachable) return `On this computer at ${status.local_path}`
  if (status.local_path && !status.reachable) return `Not reachable from this computer (looked in ${status.local_path})`
  return status.reachable ? 'Reachable from this computer' : 'Not reachable from this computer'
}
