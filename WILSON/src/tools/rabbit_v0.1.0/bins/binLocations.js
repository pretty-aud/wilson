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

// A character no address needs and a Connect question must never carry:
// every control (C0, C1) and format character (a soft hyphen, the zero-width
// and bidi marks, the Arabic letter mark, the TAG characters, a byte-order
// mark), the line and paragraph separators, and every default-ignorable code
// point (the Hangul filler, the variation selectors, the combining grapheme
// joiner) — by Unicode property, so no list is a step behind the standard.
// BC2 review round 2 refused the C0 controls; BC3 review round 1 found a
// migrated project file could carry the rest, by list; round 2 found the
// list's gaps. The desktop's and the fixtures' guards carry the same regex,
// held to this one by binsAdapterParity.test.js.
export const UNC_FORBIDDEN_CHARS_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u

export function isUncPath(p) {
  if (typeof p !== 'string' || p.length > 1024 || !UNC_RE.test(p)) return false
  // Review round 2: no control character (the desktop shows the address
  // verbatim in its native Connect question).
  if (UNC_FORBIDDEN_CHARS_RE.test(p)) return false
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

// ── BC3: the browser (Audrey's B5: the catalogue until the gateway) ──
// "until the gateway exists, the browser shows the catalogue only — every
// bin and clip, pictures where they exist, log, flag, assign takes, remove —
// and says plainly that adding files and playing them needs the desktop
// app." One notice at the top of the tab says it, once; no control is
// disabled without this reason beside it.
// GW3 (2026-10-11): the gateway exists. The notice is keyed on picking alone
// (adding still needs the desktop); playing is the gateway's where one is
// reached, and the sentences below say what stands between a clip and the
// player when it is not (GATEWAY_DESIGN.md §2's table, §5, §7).
export const CATALOGUE_SENTENCE = 'This is the catalogue: every bin and clip, with its picture where the company allows one, its logging, its marks and its takes. Adding clips and playing them need the desktop app on a computer that can reach the footage.'
export const CATALOGUE_GATEWAY_SENTENCE = 'This is the catalogue: every bin and clip, with its picture where the company allows one, its logging, its marks and its takes. Clips play here through the company\'s file gateway; adding clips still needs the desktop app on a computer that can reach the footage.'
export const CATALOGUE_EMPTY_BINS_SENTENCE = 'A bin lists clips where they sit on the company\'s footage locations. Clips are added from the desktop app on a computer that reaches the footage.'
/** What Space does where nothing can play: the picture, large. */
export const POSTER_LARGE_HINT = 'Space shows the picture large.'
/** What Space does where the gateway plays (GW3): the clip, large. */
export const PLAYER_LARGE_HINT = 'Space plays the clip large.'
/**
 * The sentence under a company's clip in a browser with no gateway reached
 * (B3, in BC3's words): a browser reads no share, so "not reachable from this
 * computer" would counsel a folder question that no browser can answer. It
 * names what to do. Kept for the dev fixtures' plain catalogue; with a
 * gateway enrolled the sentence is gatewayClipSentence's.
 */
export function browserClipSentence(locationName) {
  return `A browser cannot read ${locationName ? `"${locationName}"` : 'its footage location'}, so the clip cannot be played here; open the project in the desktop app on a computer that reaches the share to play it. It can still be logged, flagged and assigned to a shot.`
}

// ── GW3: the file gateway, in the Bins tab's words (GATEWAY_DESIGN.md §2, §5, §7) ──
/** §2's first row, the admin's extra line under the catalogue sentence. */
export const GATEWAY_ADMIN_LINE = 'A file gateway lets browsers play clips from the company\'s server: Settings, Storage.'
/** §2: Chrome's Local Network Access prompt, said above the first probe. */
export const CHROME_LOCAL_NETWORK_SENTENCE = 'Chrome will ask whether WILSON may reach devices on your network; allow it once.'
/** §7, G7/D8: a format the browser does not play; no transcoding anywhere. */
export const NEEDS_DESKTOP_FORMAT = 'This clip\'s format does not play in a browser; the desktop app plays it.'
/** D22: the first play of a clip costs one round trip to the cloud; the UI says nothing but this. */
export const GATEWAY_LOADING = 'loading'
/** The office door closes its own host before TLS (§4): a browser on the gateway's own computer cannot use it. */
export const GATEWAY_OWN_COMPUTER_LINE = 'On the gateway\'s own computer the office door does not answer its own host: use another computer on the office network, or the outside door while the switch is on.'

function minutesWords(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  if (s < 90) return `${s} seconds`
  const m = Math.round(s / 60)
  if (m < 90) return `${m} minute${m === 1 ? '' : 's'}`
  const h = Math.round(m / 60)
  return `${h} hour${h === 1 ? '' : 's'}`
}

/** §2's second row: enrolled, not seen for over 30 s. */
export function gatewayUnseenSentence(name, seconds) {
  return `The company's gateway ${name ? `"${name}"` : ''} has not answered WILSON for ${minutesWords(seconds)}, so clips cannot play here. Everything else works; someone on the office network can check it.`.replace('gateway  has', 'gateway has')
}
/** §2's third row: seen, but this browser's probes fail (naming the certificate). */
export function gatewayUnreachableSentence(name, address) {
  return `WILSON can see the gateway ${name ? `"${name}"` : ''} but this browser cannot reach it${address ? ` at ${address}` : ''}. On the office network, the gateway's certificate must be installed on this computer (Settings, Storage). From outside, the switch is off or the outside door is not open.`.replace('gateway  but', 'gateway but')
}

/**
 * §2's fourth row, per location, as the gateway reports it (the four words
 * of its reach report) or as its absence from the report says ("this
 * gateway cannot use this address", GW2's hand-off): the word the tab shows
 * beside a location's name.
 */
export const GATEWAY_REACH_WORDS = Object.freeze({
  not_reachable: 'not reachable through the gateway',
  not_mounted: 'not mounted on the gateway',
  not_connected: 'not connected on the gateway: run share-login on the gateway',
  unknown_address: 'this gateway cannot use this address',
})
/** "not reachable through the gateway (Archive)" — the design's exact shape. */
export function gatewayReachWord(state, locationName) {
  const word = GATEWAY_REACH_WORDS[state] || GATEWAY_REACH_WORDS.not_reachable
  return `${word}${locationName ? ` (${locationName})` : ''}`
}
/**
 * The sentence under a company's clip the gateway cannot serve (the
 * desktop's notHereSentence shape). `state`: one of the reach words above,
 * or 'no_gateway' (none enrolled), 'gateway_unreachable' (none answered this
 * browser), 'unseen' (none has answered the cloud for over 30 s).
 */
export function gatewayClipSentence(locationName, state) {
  const loc = locationName ? `"${locationName}"` : 'Its footage location'
  const tail = 'It can still be logged, flagged and assigned to a shot.'
  switch (state) {
    case 'no_gateway':
      return `No file gateway is enrolled, so the clip cannot be played in a browser; the desktop app on a computer that reaches the share plays it. ${tail}`
    case 'gateway_unreachable':
      return `This browser cannot reach the company's file gateway, so the clip cannot be played here. ${tail}`
    // P8 (0104, TPN-AUTH-012): the gateway serves a path only once a workspace
    // admin or manager has checked it (bin_files.vetted_at).
    case 'not_checked':
      return `This clip has not been checked by a workspace admin or manager yet, so the file gateway does not serve it. ${tail}`
    case 'unseen':
      return `The company's file gateway has not answered WILSON, so the clip cannot be played here. ${tail}`
    case 'not_mounted':
      return `${loc} is not mounted on the gateway, so the clip cannot be played here. ${tail}`
    case 'not_connected':
      return `${loc} is not connected on the gateway yet (run share-login on the gateway), so the clip cannot be played here. ${tail}`
    case 'unknown_address':
      return `The gateway cannot use the address of ${loc}, so the clip cannot be played here. ${tail}`
    default:
      return `${loc} is not reachable through the gateway, so the clip cannot be played here. ${tail}`
  }
}
/** A 404 from the gateway: the clip is not at its path (the desktop's "missing at its location" shape). */
export function gatewayMissingSentence(locationName) {
  return `The clip is not at its path on ${locationName ? `"${locationName}"` : 'its footage location'}: the gateway looked and found nothing there. It can still be logged, flagged and assigned to a shot.`
}
/**
 * The cloud refused this clip a ticket, by its reason (gateway-ticket's
 * `refused[].reason`; GW3 review round 1, note 13): the format, a path too
 * long to fit a ticket, a ticket this page could not read; anything else
 * said plainly.
 */
export function refusalSentence(reason) {
  switch (reason) {
    case 'not_playable': return NEEDS_DESKTOP_FORMAT
    case 'too_long': return 'This clip\'s path is too long to fit in a ticket, so it cannot be played in a browser; the desktop app plays it.'
    case 'bad_ticket': return 'The cloud answered with a ticket WILSON could not read, so the clip cannot be played here just now.'
    default: return 'This clip cannot be played here right now.'
  }
}
/**
 * The bare element taken fullscreen or into picture-in-picture by the
 * browser's own control (Firefox and Safari ignore `controlsList`): the
 * player pauses and says where fullscreen is (review round 1, finding 4).
 */
export const FULLSCREEN_KEEPS_MARK = 'Use the frame\'s own fullscreen button, top right: it keeps your name on the picture.'
/**
 * The door turned down a ticket the cloud had just minted (GW3 review round
 * 2, finding 1): a fresh one would fare no better, so nothing is asked for a
 * minute and this is said.
 */
export const GATEWAY_REFUSED_FRESH_TICKET = 'The gateway turned down a ticket WILSON had just been given for this clip. WILSON asks again in a minute; if this keeps happening, an admin can check the gateway in Settings, Storage.'
/** The large player's footer: a clicked player keeps its own keys (Jakob; GW3 review round 2, finding 4). */
export const PLAYER_KEEPS_KEYS = 'Once the clip is clicked, Space and the arrows are the player\'s own; Esc still closes.'
/** The bytes stopped mid-clip while the door still serves them (round 2, note 11): the connection, not the format. */
export const CONNECTION_DROPPED = 'The connection to the gateway dropped while the clip played.'

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
