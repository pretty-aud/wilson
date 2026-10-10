// =============================================================================
// gatewayWords.js — GW1 (post-overhaul, 2026-10-10): every sentence the File
// gateway card says, and the pure rules behind them.
//
// The words are GATEWAY_DESIGN.md's: §3's certificate paragraph and §11's two
// install stories VERBATIM, §4's seven reach sentences (with the few results
// the cloud's check adds), §8's health line phrase by phrase, over §2's door
// and update vocabulary (`closed_switch_off`, `closed_no_address`,
// `closed_no_cloud`, `open:<port>`; `up_to_date`, `available:<version>`,
// `failed:<version>:<reason>`). Help quotes the same constants
// (rabbitHelpContent.jsx), so the card and the manual cannot drift
// (gatewayWords.test.js and rabbitBinsHelp.test.jsx pin both).
//
// Tesler's law: what the system can work out, it works out and shows — the
// container mount path for each footage location, the cloud address the
// gateway is given — and nobody is asked to configure it.
// Postel's law: an outside address, an office range and a fingerprint are
// read in the forms people paste, and stored in the one form the database
// keeps. The rules below restate 0093's validators exactly
// (gateway_outside_address_ok, gateway_is_public_ip, gateway_office_ranges_ok,
// gateway_confirm_root's normalisation), so a refusal is a sentence before
// any request and nothing the card sends is refused by a CHECK.
// =============================================================================

// ── §3, verbatim ─────────────────────────────────────────────────────────────

export const GATEWAY_CERT_PARAGRAPH = [
  'The gateway talks to browsers over HTTPS, as every website does. A website buys a certificate from a company browsers already trust. Your gateway lives inside your office, where no such company can vouch for it, so the first time it runs it makes its own: a ',
  { em: 'root' },
  ' that says "trust certificates for the gateway\'s names", and a certificate for its names signed by that root. Browsers do not trust the root until you tell them to, once per computer: download it from this page (it comes from WILSON\'s cloud, so you never click past a warning) and install it as a trusted root. That is two minutes per computer, or one Group Policy for a Windows domain. From then on every browser on that computer trusts the gateway, and the gateway renews its own certificate for years without you. People outside the office use a different, public certificate (below), so nothing is installed on their computers.',
]

// ── §11, verbatim ────────────────────────────────────────────────────────────
// Each step: { lead, text, items? }. `lead` is the bold opening words; a step
// item with `mounts: true` is where the card lists the computed mount lines.

export const NAS_STORY = {
  intro: 'Read as the admin reads it, on the Settings card after "Add a gateway" with the NAS tab chosen. Synology DSM 7.2 with Container Manager is the worked example; QNAP\'s Container Station and TrueNAS Apps have the same five steps with their own names.',
  steps: [
    { lead: 'Get the image.', text: 'Container Manager → Registry → search wilson-gateway → download it by the digest this page shows (wilson-gateway@sha256:…), which is the exact image Petal signed; the moving stable tag is for trying it out. (About a minute.)' },
    { lead: 'Make the folders.', text: 'File Station → docker → new folder wilson-gateway. That is where the gateway keeps its settings, its certificates and its journal; nothing of your footage goes there.' },
    {
      lead: 'Create the container.', text: 'Container Manager → Container → Create → the image → Advanced settings:',
      items: [
        { lead: 'Network:', text: 'Use the same network as Docker Host. This is the one setting that is not optional: on Docker\'s ordinary bridge network the gateway would see every browser as the same address and could not tell the office from a tunnel, so it keeps its office door closed and this page tells you to change the setting (review round 2). No port settings are needed; the gateway listens on the NAS\'s own address, 8443 for the office door and 8444 for the outside door (closed until you turn the switch on).' },
        { lead: 'Volumes:', text: 'your footage share\'s folder, read-only, at the path WILSON tells you. For the location Footage (\\\\nas\\footage) that is /volume1/footage → /locations/nas/footage, read-only (the host and share names are written in lower case; folders below the share keep their own spelling). One line per footage location; the health line names any that is missing. And docker/wilson-gateway → /data: the gateway\'s own files only, readable by the gateway\'s user, where the NAS\'s administrator can see what is in flight and nothing else (no footage, no tickets).', mounts: true },
        { lead: 'Environment:', text: 'WILSON_ENROL_TOKEN = the token on this page (it works once, for 24 hours).' },
        { lead: 'Restart policy:', text: 'always.' },
      ],
    },
    { lead: 'Start it.', text: 'Within ten seconds the gateway appears on this page with its name and seen just now; the token on this page disappears. The container\'s log prints the gateway\'s certificate fingerprint on its first lines: type or paste it into the box beside the new gateway on this page, which proves the gateway you see is the one you started, and unlocks Download certificate. If the gateway does not appear, the log says why in one line (the token was used or expired; /data is not writable; a location is not mounted; the network is a bridge).' },
    { lead: 'Trust it, once per office computer.', text: 'Download certificate here, then on each computer: Windows: open the file → Install Certificate → Local Machine → Place all certificates in the following store → Trusted Root Certification Authorities. macOS: open it in Keychain Access → System → double-click → Trust → Always Trust. A Windows domain does it once with Group Policy (the path in §3). Then open WILSON in that computer\'s browser, allow Chrome\'s local-network question once, and press Space on a clip.' },
  ],
  outside: 'For viewing from outside the office (only if you want it): turn on Allow files to be viewed from outside the office network on this page and read the sentence under it. Then either forward port 8444 on your router to the NAS and type your public name or address here, or forward port 443 to 8444 and type a name that points at your public address to get a free certificate, or run a tunnel and declare it here. Press Check reach. The line tells you what it found, in words, and the address is given to people\'s browsers only once the check has found your gateway there. Whatever you choose points at port 8444, never 8443: the office door closes anything that looks like a proxy or a tunnel, and this page turns amber if one is aimed at it. Never put the NAS\'s reverse proxy, a tunnel or any other program in front of port 8443.',
  share: 'The NAS side of the share: the container reads the folder directly, so no share login is needed. Keep SMB at 3 with signing and encryption on for the office computers that read the same share (Control Panel → File Services → SMB → Advanced), and leave SMB 1 off.',
  cost: 'What it costs the NAS: one small process; no transcoding; the bytes it serves are the bytes it reads, so a NAS that can serve the share can serve the gateway. Measured on a laptop (Appendix A): 337 MB/s over TLS, which is the NAS\'s disk and link, not the gateway.',
}

export const WINDOWS_STORY = {
  intro: 'Read as the admin reads it, with the Windows tab chosen.',
  steps: [
    { lead: 'Run the installer', text: '(WILSON Gateway Setup.msi, signed by Petal Studios) as an administrator. It installs two services: the gateway, which runs as a Windows-managed service account with no password and no administrator rights (NT SERVICE\\WilsonGateway), and a small updater that swaps in new versions. It asks for the enrolment token on this page, shows which of this PC\'s network addresses the office door will use (its wired or wireless addresses, never a VPN adapter), and prints the gateway\'s certificate fingerprint at the end. (Two minutes.)' },
    { lead: 'Confirm the fingerprint.', text: 'On this page, beside the new gateway, type or paste the fingerprint the installer printed. That proves the gateway you see here is the one you installed, and unlocks Download certificate.' },
    { lead: 'Give it the share\'s login.', text: 'The gateway reads your footage at its network address, as any computer does, with an account you choose. Make a read-only user for it on the server (on a Synology: Control Panel → User → create wilson-gateway, read-only on the footage share, nothing else), then in an administrator prompt: wilson-gateway share-login \\\\nas\\footage, which asks for that user\'s name and password once and hands them to the running gateway, which keeps them where only it can read them. One line per server. (An administrator of this PC could recover that login; it is read-only on the footage share and nothing else.)' },
    { lead: 'See it appear.', text: 'Within ten seconds the gateway appears on this page with its name, seen just now, and each footage location\'s reach. Not connected beside a location means step 3 is still owed for that server.' },
    { lead: 'Trust it, once per office computer,', text: 'exactly as the NAS story\'s step 5.' },
    { lead: 'Keep the PC on and awake', text: '(Power settings: never sleep when plugged in). The gateway updates itself; this page shows its version and up to date; if an update fails it says so and keeps the old version running.' },
  ],
  outside: 'For viewing from outside the office: as the NAS story, with the forward pointing at this PC\'s address (give it a DHCP reservation on the router first), at port 8444 and never 8443, and no tunnel or proxy ever in front of 8443.',
  firewall: 'What the installer does not do: it does not open any port in the Windows firewall for the outside door (it opens 8443 for the local network only); the outside door\'s firewall rule is added when you turn the switch on and set an outside address, and removed when you turn it off, and the page says so.',
}

// ── The sentences the card adds around them ──────────────────────────────────

export const GATEWAY_SECTION_DESCRIPTION = 'A small WILSON program on a computer in the office that lets browsers play clips straight from the company\'s footage share. In the office a clip never leaves the network; for people outside, it leaves through one door the company opens itself, only while the switch below is on. Nothing is copied or converted, and WILSON never relays a byte.'
export const GATEWAY_ADMIN_ONLY = 'Only a workspace admin can add or change the file gateway.'
export const GATEWAY_EMPTY = 'No gateway yet. Add one to play clips in the browser, in the office and, if the company allows it, outside.'
export const TOKEN_SHOWN_ONCE = 'This token is shown once and works once, for 24 hours. Give it to the gateway as it starts; once the gateway appears below, the token is spent.'
export const CLOUD_URL_HINT = 'The gateway\'s second setting: the WILSON cloud it talks to (WILSON_CLOUD_URL for the container; the installer\'s second field on Windows).'
export const FINGERPRINT_PROMPT = 'Type or paste the fingerprint the installer or the container\'s log printed. It proves this gateway is the one you installed, and unlocks Download certificate.'
export const FINGERPRINT_OTHER_ADMIN = 'Waiting for the admin who made this gateway\'s token to confirm its fingerprint: they are the one who saw it printed. If nobody installed it, choose Forget.'
export const NEW_GATEWAY_NOTICE = (name, when) => `A new gateway, ${name}, enrolled ${when}, and no admin in this browser made its token today. If nobody in the company installed it, choose Forget: it gets no address and no ticket until its fingerprint is confirmed.`
export const OFFICE_RANGES_HINT = 'Addresses the gateway treats as the office besides its own network: a VPN pool, an office on unusual addressing. Private ranges only (10.x, 172.16–31.x, 192.168.x, fc00::/7), at most eight, none wider than a /16 (a /48 for IPv6). A viewing from these is not written down, as the office\'s is not.'
export const OUTSIDE_ADDRESS_HINT = 'The public name or address people outside the office reach the gateway at, and its port (8444 unless you forward 443 for the free certificate). It is given to their browsers only after Check reach finds this gateway there.'
export const NAME_REFUSAL = 'A gateway\'s name is 1 to 80 characters.'
export const FORGET_CONFIRM = (name) => `Forget ${name}? It stops at once: no ticket is made for it again, its addresses are taken out of every browser, and its next check-in is refused. You can undo this for one minute; after that, enrol it again with a new token.`
export const FORGOTTEN_LINE = 'Forgotten: no ticket is made for it, and its next check-in is refused.'
export const IT_WORKS = 'It works: play a clip from outside.'
export const CHECKING = 'Checking… WILSON hands the gateway a code at its next check-in (within ten seconds), then knocks from the internet.'
export const CERTIFICATE_DOWNLOADED = 'Downloaded. Install it on each office computer as a trusted root (the steps are under Add a gateway, step 5).'
export const VIEWED_EMPTY = 'Nothing was viewed from outside the office in the last 30 days.'
export const VIEWED_DESCRIPTION = 'Every viewing through the outside door in the last 30 days, newest first: who, which clip, when, how much, and from where. Office viewing is not written down. Only workspace admins see this.'
export const AUDIT_EMPTY = 'No changes yet.'
export const MEMBER_LINE = 'People in the company play clips through it; only a workspace admin sees its health and changes it.'

// ── Tesler: the container mount path, computed ──────────────────────────────

/**
 * \\host\share\Folder\Sub → /locations/host/share/Folder/Sub — host and share
 * lower-cased, folders below the share keeping their own spelling (§11, R15).
 * null for anything that is not a network address.
 */
export function mountPathFor(uncPath) {
  const s = String(uncPath || '')
  if (!/^\\\\[^\\]+\\[^\\]+/.test(s)) return null
  const parts = s.slice(2).split('\\').filter(Boolean)
  if (parts.length < 2) return null
  return ['/locations', parts[0].toLowerCase(), parts[1].toLowerCase(), ...parts.slice(2)].join('/')
}

/** The functions base the gateway is given: <SUPABASE_URL>/functions/v1, no trailing slash. */
export function cloudUrlFor(supabaseUrl) {
  const s = String(supabaseUrl || '').trim().replace(/\/+$/, '')
  return s ? `${s}/functions/v1` : ''
}

// ── Addresses: 0093's validators, restated ───────────────────────────────────

/** "192.0.2.10" → [192, 0, 2, 10]; leading zeros refused (the database's host() would respell them). */
function parseIpv4(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s))
  if (!m) return null
  const p = m.slice(1).map(x => (x.length > 1 && x.startsWith('0') ? NaN : Number(x)))
  return p.every(n => Number.isInteger(n) && n >= 0 && n <= 255) ? p : null
}

function v4Private(p) { return p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) }

// gateway_is_public_ip, IPv4 half: 0/8, 10/8, 100.64/10, 127/8, 169.254/16,
// 172.16/12, 192.0.0/24, 192.0.2/24, 192.88.99/24, 192.168/16, 198.18/15,
// 198.51.100/24, 203.0.113/24, 224/4, 240/4.
function v4Public(p) {
  return !(p[0] === 0 || p[0] === 127 || v4Private(p)
    || (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
    || (p[0] === 169 && p[1] === 254)
    || (p[0] === 192 && p[1] === 0 && (p[2] === 0 || p[2] === 2))
    || (p[0] === 192 && p[1] === 88 && p[2] === 99)
    || (p[0] === 198 && (p[1] === 18 || p[1] === 19))
    || (p[0] === 198 && p[1] === 51 && p[2] === 100)
    || (p[0] === 203 && p[1] === 0 && p[2] === 113)
    || p[0] >= 224)
}

/** Eight 16-bit groups, or null. Accepts "::" and a trailing dotted IPv4. */
function parseIpv6(s) {
  let str = String(s || '').toLowerCase()
  if (!str.includes(':') || !/^[0-9a-f:.]+$/.test(str)) return null
  const lastColon = str.lastIndexOf(':')
  const after = str.slice(lastColon + 1)
  if (after.includes('.')) {
    const p = parseIpv4(after)
    if (!p) return null
    str = `${str.slice(0, lastColon + 1)}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`
  }
  const halves = str.split('::')
  if (halves.length > 2) return null
  const groups = (part) => {
    if (part === '') return []
    const g = part.split(':')
    return g.every(x => /^[0-9a-f]{1,4}$/.test(x)) ? g.map(x => parseInt(x, 16)) : null
  }
  const head = groups(halves[0])
  if (!head) return null
  if (halves.length === 1) return head.length === 8 ? head : null
  const tail = groups(halves[1])
  if (!tail) return null
  const fill = 8 - head.length - tail.length
  if (fill < 1) return null
  return [...head, ...Array(fill).fill(0), ...tail]
}

/** RFC 5952 spelling, as Postgres's host() prints it: the first longest run of two or more zero groups becomes "::". */
function formatIpv6(g) {
  let best = -1
  let bestLen = 0
  for (let i = 0; i < 8;) {
    if (g[i] !== 0) { i += 1; continue }
    let j = i
    while (j < 8 && g[j] === 0) j += 1
    if (j - i > bestLen) { best = i; bestLen = j - i }
    i = j
  }
  const hex = g.map(n => n.toString(16))
  if (bestLen < 2) return hex.join(':')
  return `${hex.slice(0, best).join(':')}::${hex.slice(best + bestLen).join(':')}`
}

function inV6(g, prefix, bits) {
  for (let i = 0; i < 8 && bits > 0; i += 1, bits -= 16) {
    const take = Math.min(16, bits)
    const mask = (0xffff << (16 - take)) & 0xffff
    if ((g[i] & mask) !== (prefix[i] & mask)) return false
  }
  return true
}

// gateway_is_public_ip, IPv6 half.
const V6_NOT_PUBLIC = [
  ['::', 96], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
  ['2001::', 32], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
].map(([a, bits]) => [parseIpv6(a), bits])

function v6Public(g) { return !V6_NOT_PUBLIC.some(([p, bits]) => inV6(g, p, bits)) }

const LOCAL_NAME = /\.(local|localhost|internal|intranet|lan|home|corp|localdomain|home\.arpa|invalid|test|example|onion)$/
const NAME = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/
const SUPABASE_NAME = /(^|\.)supabase\.(co|in|net|com)$/

const OUTSIDE_ADDRESS_REFUSAL = 'An outside address is a public name like gateway.yourcompany.com, or a public address, with its port: never a name or address inside the office.'

/**
 * "https://Gateway.YourCompany.com:8444/", "gateway.yourcompany.com",
 * "[2a01:4f8:0:0::1]:443" → { ok, value: { host, port } }: the port 8444 when
 * none is given, a name lower-cased, an address in its canonical spelling.
 */
export function parseOutsideAddress(input) {
  let s = String(input || '').trim()
  if (!s) return { ok: false, problem: OUTSIDE_ADDRESS_REFUSAL }
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/[/?#].*$/, '')
  let host = s
  let port = 8444
  const bracketed = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(s)
  if (bracketed) {
    host = bracketed[1]
    if (bracketed[2]) port = Number(bracketed[2])
  } else {
    const m = /^([^:]*):(\d{1,5})$/.exec(s)
    if (m) { host = m[1]; port = Number(m[2]) }
  }
  host = host.toLowerCase().replace(/\.$/, '')
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, problem: OUTSIDE_ADDRESS_REFUSAL }
  if (!host || host.length > 253) return { ok: false, problem: OUTSIDE_ADDRESS_REFUSAL }
  const v4 = parseIpv4(host)
  if (v4) return v4Public(v4) ? { ok: true, value: { host: v4.join('.'), port } } : { ok: false, problem: OUTSIDE_ADDRESS_REFUSAL }
  if (host.includes(':')) {
    const g = parseIpv6(host)
    // A dotted tail spells an IPv4 inside IPv6: every such range is refused.
    if (!g || !v6Public(g)) return { ok: false, problem: OUTSIDE_ADDRESS_REFUSAL }
    return { ok: true, value: { host: formatIpv6(g), port } }
  }
  if (!NAME.test(host) || LOCAL_NAME.test(host) || SUPABASE_NAME.test(host)) return { ok: false, problem: OUTSIDE_ADDRESS_REFUSAL }
  return { ok: true, value: { host, port } }
}

export function formatAddress(a) {
  if (!a || !a.host) return ''
  return String(a.host).includes(':') ? `[${a.host}]:${a.port}` : `${a.host}:${a.port}`
}

const OFFICE_RANGES_REFUSAL = 'Office ranges are private ranges only (10.x, 172.16–31.x, 192.168.x or fc00::/7), at most eight, none wider than a /16 (a /48 for IPv6).'

/**
 * "10.8.0.0/16, 192.168.20.7/24, fd12:3456:789a::/48" → ["10.8.0.0/16",
 * "192.168.20.0/24", "fd12:3456:789a::/48"]: host bits cleared and the
 * network spelled as the database's cidr prints it; a bare address is its
 * /32 or /128; a repeat is dropped.
 */
export function parseOfficeRanges(text) {
  const items = String(text || '').split(/[\s,;]+/).map(s => s.trim()).filter(Boolean)
  const out = []
  for (const raw of items) {
    const slash = raw.indexOf('/')
    const addr = slash === -1 ? raw : raw.slice(0, slash)
    const bitsRaw = slash === -1 ? null : raw.slice(slash + 1)
    if (bitsRaw !== null && !/^\d{1,3}$/.test(bitsRaw)) return { ok: false, problem: OFFICE_RANGES_REFUSAL }
    const v4 = parseIpv4(addr)
    if (v4) {
      const bits = bitsRaw === null ? 32 : Number(bitsRaw)
      if (bits < 16 || bits > 32) return { ok: false, problem: OFFICE_RANGES_REFUSAL }
      const n = ((v4[0] << 24) | (v4[1] << 16) | (v4[2] << 8) | v4[3]) >>> 0
      const net = (n & ((0xffffffff << (32 - bits)) >>> 0)) >>> 0
      const octets = [net >>> 24, (net >>> 16) & 255, (net >>> 8) & 255, net & 255]
      if (!v4Private(octets)) return { ok: false, problem: OFFICE_RANGES_REFUSAL }
      const spelled = `${octets.join('.')}/${bits}`
      if (!out.includes(spelled)) out.push(spelled)
      continue
    }
    const g = parseIpv6(addr)
    const bits = bitsRaw === null ? 128 : Number(bitsRaw)
    if (!g || bits < 48 || bits > 128 || (g[0] & 0xfe00) !== 0xfc00) return { ok: false, problem: OFFICE_RANGES_REFUSAL }
    const masked = g.map((x, i) => {
      const keep = Math.max(0, Math.min(16, bits - i * 16))
      return keep === 0 ? 0 : x & ((0xffff << (16 - keep)) & 0xffff)
    })
    const spelled = `${formatIpv6(masked)}/${bits}`
    if (!out.includes(spelled)) out.push(spelled)
  }
  if (out.length > 8) return { ok: false, problem: OFFICE_RANGES_REFUSAL }
  return { ok: true, value: out }
}

/** "B1:16:14:…", "sha256 Fingerprint=b1:16…" or "b11614…" → 64 lower-case hex, else null (gateway_confirm_root's rule). */
export function normalizeFingerprint(input) {
  const s = String(input || '').toLowerCase().replace(/^\s*sha-?256\s*(fingerprint)?\s*[=:]?\s*/, '').replace(/[\s:]/g, '')
  return /^[0-9a-f]{64}$/.test(s) ? s : null
}

/** 64 hex → "B1:16:14:…" in pairs, as openssl prints it. */
export function formatFingerprint(hex) {
  const s = String(hex || '')
  return /^[0-9a-f]{64}$/.test(s) ? s.toUpperCase().match(/../g).join(':') : ''
}

export const FINGERPRINT_SHAPE = 'A certificate fingerprint is 64 letters and digits (0–9 and a–f), with or without colons between the pairs.'

// ── Time ─────────────────────────────────────────────────────────────────────

/** §8's ages: seconds up to two minutes ("no cloud for 70 s"), then minutes, hours, days. */
export function agoWords(seconds) {
  const s = Math.max(0, Math.round(seconds))
  if (s < 120) return `${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return m === 1 ? '1 minute' : `${m} minutes`
  const h = Math.round(m / 60)
  if (h < 48) return h === 1 ? '1 hour' : `${h} hours`
  return `${Math.round(h / 24)} days`
}

function secondsSince(iso, now) {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? (now - t) / 1000 : null
}

// ── §8: the health line, phrase by phrase ────────────────────────────────────
// Each phrase: { text, tone, strong? } — tone 'plain' | 'warning' | 'error';
// `strong` is the words to set bold inside it (§8's example bolds *not
// mounted*). One ink on this page (settings.css: no red passes AA on the
// orange ground), so a tone is weight and form, and 'error' is reserved for
// ONE thing: the office door reached from the internet (the brief's
// Selective attention: "the red word only for the inside-door forward").
// §8's "red from 5 minutes" for a gateway not seen is therefore a bold
// warning here, not an error: the brief's rule is the narrower one.

const LOCATION_WORDS = {
  reachable: () => ({ word: 'reachable', rest: '' }),
  not_reachable: () => ({ word: 'not reachable', rest: '' }),
  not_mounted: (loc) => ({ word: 'not mounted', rest: ` (mount the share's folder at ${mountPathFor(loc?.unc_path) || '/locations/<host>/<share>'}, read-only)` }),
  not_connected: () => ({ word: 'not connected', rest: ' (run share-login)' }),
}

function humanize(s) { return String(s).replace(/[_:]+/g, ' ').trim() }

/** The outside door's phrase from §2's vocabulary (read liberally). */
function outsidePhrase(gw, now) {
  const raw = String(gw?.health?.doors?.outside || '')
  if (!raw) return null
  const open = /^open(?::(\d{1,5}))?$/.exec(raw)
  if (open) {
    const port = open[1] || gw?.outside_address?.port || 8444
    if (gw?.reach_ok === true) {
      const checked = secondsSince(gw.reach_checked_at, now)
      return { text: `outside door open on ${port}, reachable from the internet${checked === null ? '' : ` (checked ${agoWords(checked)} ago)`}`, tone: 'plain' }
    }
    return { text: `outside door open on ${port}, not reached yet: Check reach`, tone: 'warning' }
  }
  if (raw === 'closed_switch_off') return { text: 'outside door closed (the switch is off)', tone: 'plain' }
  if (raw === 'closed_no_address') return { text: 'outside door closed (no outside address yet)', tone: 'plain' }
  const noCloud = /^closed_no_cloud(?::(\d+))?$/.exec(raw)
  if (noCloud) return { text: `outside door closed (no cloud${noCloud[1] ? ` for ${agoWords(Number(noCloud[1]))}` : ''})`, tone: 'warning' }
  if (raw.startsWith('closed')) return { text: `outside door closed (${humanize(raw.slice(6)) || 'no reason given'})`, tone: 'plain' }
  return { text: `outside door: ${humanize(raw)}`, tone: 'plain' }
}

function insidePhrase(gw) {
  const raw = String(gw?.health?.doors?.inside || '')
  if (!raw) return null
  const first = Array.isArray(gw.inside_addresses) ? gw.inside_addresses[0] : null
  if (/^open/.test(raw)) return { text: `office door open${first ? ` (${formatAddress(first)})` : ''}`, tone: 'plain' }
  if (/bridge/.test(raw)) return { text: 'office door closed (the container is on a bridge network: run it on the host\'s network)', tone: 'warning', strong: 'office door closed' }
  return { text: `office door closed${raw.length > 6 ? ` (${humanize(raw.replace(/^closed/, ''))})` : ''}`, tone: 'warning', strong: 'office door closed' }
}

export function healthPhrases(gw, { now = Date.now(), locations = [] } = {}) {
  const out = []
  if (!gw) return out
  out.push({ text: gw.version || 'version unknown', tone: 'plain' })
  const seen = secondsSince(gw.last_seen_at, now)
  if (seen === null) out.push({ text: 'never seen', tone: 'warning' })
  else if (seen < 30) out.push({ text: `seen ${agoWords(seen)} ago`, tone: 'plain' })
  else out.push({ text: `not seen for ${agoWords(seen)}`, tone: 'warning', ...(seen >= 300 ? { strong: `not seen for ${agoWords(seen)}` } : {}) })

  const inside = insidePhrase(gw)
  if (inside) out.push(inside)
  const outside = outsidePhrase(gw, now)
  if (outside) out.push(outside)

  const reach = gw.reach || {}
  for (const loc of locations) {
    const say = LOCATION_WORDS[reach[loc.id]]
    if (!say) continue
    const { word, rest } = say(loc)
    out.push({ text: `${loc.name}: ${word}${rest}`, tone: word === 'reachable' ? 'plain' : 'warning', ...(word === 'reachable' ? {} : { strong: word }) })
  }

  const health = gw.health || {}
  const cert = health.certificate || {}
  if (cert.leaf_not_after || cert.root_not_after) {
    const bits = [cert.leaf_not_after ? `leaf until ${String(cert.leaf_not_after).slice(0, 10)}` : null,
      cert.root_not_after ? `root until ${String(cert.root_not_after).slice(0, 10)}` : null].filter(Boolean).join('; ')
    out.push({ text: `certificate: renews itself (${bits})`, tone: 'plain' })
  }
  if (cert.expires_warning) out.push({ text: String(cert.expires_warning), tone: 'warning' })

  const update = String(health.update || '')
  if (update === 'up_to_date') out.push({ text: 'up to date', tone: 'plain' })
  else if (update.startsWith('available:')) {
    const v = update.slice(10)
    out.push({ text: gw.platform === 'container' ? `${v} is available: pull the image` : `${v} is available`, tone: 'warning' })
  } else if (update.startsWith('failed:')) {
    const [, v, ...why] = update.split(':')
    out.push({ text: `update to ${v} failed${why.length ? ` (${why.join(':')})` : ''}; running ${gw.version}`, tone: 'warning' })
  }
  if (health.minimum_version_ok === false) {
    out.push({ text: 'below the minimum version: the outside door stays closed until it is updated', tone: 'warning' })
  }

  const relay = health.doors?.relay_warning
  if (relay && Number(relay.viewers) > 1 && relay.address) {
    out.push({ text: `${relay.viewers} people reached the office door through one address today, ${relay.address}: a relay or proxy may be pointed at it`, tone: 'warning' })
  }
  return out
}

/** The ONE error of the health line: the office door reached from the internet (§4), or null. */
export function insideForwardSentence(gw) {
  const refused = Number(gw?.health?.doors?.refused_public || 0)
  if (!(refused > 0)) return null
  const port = (Array.isArray(gw?.inside_addresses) && gw.inside_addresses[0]?.port) || 8443
  return `Your office door is being reached from the internet (${refused} refused since the last check-in): remove the forward to port ${port}. Only port 8444 should be open.`
}

// ── §4: the reach check, in words ────────────────────────────────────────────

/**
 * The sentence for a check's result ({ outside: { ok, detail, ms, … },
 * inside_answered }). Returns { text, tone, inside: { text, tone } | null }.
 */
export function reachSentence(result, gw, { now = Date.now() } = {}) {
  const o = result?.outside || {}
  const where = formatAddress(gw?.outside_address) || 'the outside address'
  const port = gw?.outside_address?.port || 8444
  const lan = Array.isArray(gw?.inside_addresses) ? gw.inside_addresses.find(a => parseIpv4(a.host))?.host : null
  const seen = secondsSince(gw?.last_seen_at, now)
  const insidePort = (Array.isArray(gw?.inside_addresses) && gw.inside_addresses[0]?.port) || 8443
  let text
  let tone = 'warning'
  switch (o.detail) {
    case 'reached':
      text = `Reachable from the internet at ${where} (checked just now, certificate OK${o.ms != null ? `, ${o.ms} ms` : ''}). People outside the office can play clips while the switch is on.`
      tone = 'ok'
      break
    case 'timed_out':
      text = `Not reachable: nothing answered at ${where}. Is port ${port} forwarded to ${lan || 'the gateway'} on your router? The gateway itself is fine${seen !== null ? ` (seen ${agoWords(seen)} ago)` : ''}.`
      break
    case 'refused':
      text = 'Not reachable: the connection was refused. The outside door is closed on the gateway: the switch is off, or the gateway has no outside address yet.'
      break
    case 'certificate':
      text = 'Reached, but browsers will not trust the certificate (self-signed, or for another name). Use the free certificate (forward port 443) or install your own.'
      break
    case 'not_this_gateway':
      text = `Something answered at ${where}, but it is not your gateway (it did not know the check's code). The address is not given to anyone until it is.`
      break
    case 'switch_off':
      text = 'The switch is off, so the outside door is closed; the check confirms nothing answers from outside (good). Turn the switch on to open it.'
      tone = 'ok'
      break
    case 'dns':
      text = `${gw?.outside_address?.host || 'That name'} does not lead anywhere: it has no address on the internet. Check the name, or use your public address itself.`
      break
    case 'not_public':
      text = `${gw?.outside_address?.host || 'That name'} leads to an address inside a private network, which nobody outside can reach. Use your public name or address.`
      break
    case 'local_name':
    case 'supabase_host':
    case 'malformed':
      text = OUTSIDE_ADDRESS_REFUSAL
      break
    case 'gateway_not_syncing':
      text = `The gateway has not checked in with WILSON${seen !== null ? ` for ${agoWords(seen)}` : ''}, so the check could not run. Is it switched on?`
      break
    default:
      text = 'The check did not finish. Try again in a moment.'
  }
  const inside = result?.inside_answered
    ? { text: `Your inside door (port ${insidePort}) answers from the internet. Remove that forward: only port ${port} should be open.`, tone: 'error' }
    : null
  return { text, tone, inside }
}

// ── The audit list ───────────────────────────────────────────────────────────

const AUDIT_WORDS = {
  'remote_viewing.on': () => 'turned viewing from outside the office on',
  'remote_viewing.off': () => 'turned viewing from outside the office off',
  'gateway.token_made': () => 'made a gateway enrolment token',
  'gateway.token_cancelled': () => 'cancelled a gateway enrolment token',
  'gateway.enrolled': (d, g) => `enrolled ${g || d.name || 'a gateway'}${d.platform ? ` (${d.platform === 'container' ? 'a container' : 'Windows'}${d.version ? `, ${d.version}` : ''})` : ''}`,
  'gateway.root_confirmed': (d, g) => `confirmed the certificate fingerprint of ${g || 'a gateway'}`,
  'gateway.renamed': (d) => `renamed ${d.from || 'a gateway'} to ${d.to || 'a new name'}`,
  'gateway.outside_address_changed': (d, g) => (d.to ? `set ${g || 'a gateway'}'s outside address to ${formatAddress(d.to)}` : `took ${g || 'a gateway'}'s outside address away`),
  'gateway.office_ranges_changed': (d, g) => `set ${g || 'a gateway'}'s office ranges to ${(Array.isArray(d.to) && d.to.length ? d.to.join(', ') : 'none')}`,
  'gateway.forgotten': (d, g) => `forgot ${g || d.name || 'a gateway'}`,
  'gateway.forget_undone': (d, g) => `undid forgetting ${g || 'a gateway'}`,
  'gateway.revoked': (d, g) => `${g || 'a gateway'}'s credential was deleted: the forget is final`,
  'gateway.reach_checked': (d, g) => `checked whether ${g || 'a gateway'} is reachable from outside: ${humanize(d?.outside?.detail || 'done')}${d?.inside_answered ? '; the inside door answered' : ''}`,
  'gateway.update_failed': (d, g) => `${g || 'a gateway'} could not update (${humanize(String(d.update || 'unknown').replace(/^failed:/, ''))})`,
}

const NO_ACTOR = new Set(['gateway.revoked', 'gateway.update_failed'])

/** One audit row in words: "Mara Okonkwo turned viewing from outside the office on". */
export function auditPhrase(row, gatewayName) {
  const say = AUDIT_WORDS[row?.action]
  const what = say ? say(row.details || {}, gatewayName) : humanize(row?.action || 'something happened')
  const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1)
  if (NO_ACTOR.has(row?.action)) return capital(what)
  if (row?.action === 'gateway.reach_checked' && !row?.actor_user_id) return `WILSON ${what}`
  const who = row?.actor_label || (row?.actor_user_id ? 'An admin' : 'WILSON')
  return `${who} ${what}`
}

// ── The viewings table ───────────────────────────────────────────────────────

function formatBytesShort(n) {
  const b = Number(n)
  if (n == null || !Number.isFinite(b) || b < 0) return 'an unknown amount'
  if (b < 1024) return `${b} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = b / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1 }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`
}

/** "920 MB of 1.0 GB (92%) · read in full", or the restart's honest words. */
export function howMuchWords(details = {}) {
  if (details.incomplete && details.ended_at == null) {
    return `started; how much is unknown (the gateway restarted)${details.bytes ? `, at least ${formatBytesShort(details.bytes)}` : ''}`
  }
  const bytes = formatBytesShort(details.bytes)
  if (details.clip_bytes) {
    const pct = details.fraction != null ? Math.round(Number(details.fraction) * 100) : null
    return `${bytes} of ${formatBytesShort(details.clip_bytes)}${pct != null ? ` (${pct}%)` : ''}${details.read_in_full ? ' · read in full' : ''}`
  }
  return bytes
}

/** "203.0.113.7 via cloudflare", plus the shared-link mark (shared_url). */
export function whereWords(details = {}) {
  const addr = details.source_address || 'an unknown address'
  const via = details.via ? ` via ${details.via}` : ''
  const others = Array.isArray(details.source_addresses) ? details.source_addresses.length : 0
  const shared = details.shared_url ? ` · one link played from ${others > 1 ? `${others} addresses` : 'more than one address'}` : ''
  return `${addr}${via}${shared}`
}

/** The viewer, with the mark R4 asks for when no mint matched (unverified_mint). */
export function whoWords(row) {
  const who = row?.actor_label || 'Someone no longer in the company'
  return row?.details?.unverified_mint ? `${who} (no matching ticket on record: the gateway's word)` : who
}

/** "Viewed from outside 3 times, last by Priya on 9 Oct" — the Bins inspector's one line (item 5). */
export function inspectorRemoteLine({ count, last } = {}, { locale } = {}) {
  const n = Number(count) || 0
  if (n === 0) return null
  const times = n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`
  if (!last?.created_at) return `Viewed from outside ${times}`
  const who = String(last.actor_label || '').split(/\s+/)[0] || 'someone'
  const when = new Date(last.created_at).toLocaleDateString(locale || 'en-GB', { day: 'numeric', month: 'short' })
  return `Viewed from outside ${times}, last by ${who} on ${when}`
}
