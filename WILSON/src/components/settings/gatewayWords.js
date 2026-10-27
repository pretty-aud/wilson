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

// ── The two install stories (GW4, 2026-10-11) ────────────────────────────────
// GATEWAY_DESIGN.md §11 wrote them for the design's reader; these are the
// built gateway's, as the admin reads them, in the ONE text both places show:
// the card's two tabs under Add a gateway (GatewaySettings.jsx) and Help's two
// pages, File gateway on a NAS and File gateway on Windows
// (rabbitHelpContent.jsx). Each: { intro, steps: [{ lead, text, items? }],
// after: [{ lead, text }] }; a step item with `mounts: true` is where the card
// lists the mount lines it computes for the company's own locations.
//
// What they say that §11 did not (the GW4 brief, item 4): the release on
// GitHub (the MSI and the image by digest); the MSI is NOT signed yet (D14,
// her ruling of 2026-10-11), so SmartScreen warns and More info, then Run
// anyway, passes it; GW3's four things a browser's user must be told (the
// certificate, Chrome's question, the gateway's own computer, what plays), in
// the Bins tab's own words (binLocations.js holds them; gatewayWords imports
// nothing, so they are copied here and gatewayWords.test.js holds the copies
// to the originals); a domain's computer account (connect_without_login); the
// DHCP reservation for the forward; nothing ever in front of 8443; the NAS's
// reverse proxy with the gateway's root pinned; the free certificate and
// Let's Encrypt's terms; a stopped install and its log.

// GW3's sentences, word for word (bins/binLocations.js; held equal by the test).
export const BROWSER_CERTIFICATE_SENTENCE = 'On the office network, the gateway\'s certificate must be installed on this computer (Settings, Storage).'
export const BROWSER_CHROME_SENTENCE = 'Chrome will ask whether WILSON may reach devices on your network; allow it once.'
export const BROWSER_OWN_COMPUTER_SENTENCE = 'On the gateway\'s own computer the office door does not answer its own host: use another computer on the office network, or the outside door while the switch is on.'
export const BROWSER_FORMAT_SENTENCE = 'This clip\'s format does not play in a browser; the desktop app plays it.'

/** Where a release is, for both stories: the public repository's Releases page. */
const GATEWAY_RELEASES_PAGE = 'github.com/pretty-aud/wilson/releases'
/** The hardening guide (docs/gateway/HARDENING.md), linked from Help. */
export const HARDENING_GUIDE_URL = 'https://github.com/pretty-aud/wilson/blob/main/WILSON/docs/gateway/HARDENING.md'

// Step 5 of both stories is the same step: one object, two stories.
const TRUST_STEP = {
  lead: 'Trust it, once per office computer.',
  text: 'Choose Download certificate on the card, then on each computer that will play clips:',
  items: [
    { lead: 'The certificate:', text: `on Windows, open the file → Install Certificate → Local Machine → Place all certificates in the following store → Trusted Root Certification Authorities. On a Mac, open it in Keychain Access → System → double-click it → Trust → Always Trust. A Windows domain does it once with Group Policy (Computer Configuration → Windows Settings → Security Settings → Public Key Policies → Trusted Root Certification Authorities). A computer without it says, in the Bins tab: ${BROWSER_CERTIFICATE_SENTENCE} When the gateway makes a new certificate (a year before the old one ends, or when its office address moves to another network), the card offers the new one beside the old: install it the same way.` },
    { lead: 'Chrome\'s question:', text: `the first time this browser reaches the gateway, the Bins tab says: ${BROWSER_CHROME_SENTENCE} Allowed once, Chrome remembers it for WILSON; blocked, every clip reads as unreachable until you allow it again (the icon left of the address → Site settings).` },
    { lead: 'The gateway\'s own computer:', text: BROWSER_OWN_COMPUTER_SENTENCE },
    { lead: 'What plays:', text: `MP4 and M4V, WebM, a .mov the browser can decode (H.264, not ProRes or DNx), the usual audio formats and stills, and a frame sequence as its middle frame. Proxies play in the browser; masters play in the desktop app, and the inspector says so: ${BROWSER_FORMAT_SENTENCE}` },
  ],
}

const OUTSIDE_NOTE_TEXT = 'turn on Allow files to be viewed from outside the office network on the card and read the sentence under it. Then choose one way in. Forward port 8444 on your router to the gateway and type your public name or address on the card. Or, for a free certificate, forward port 443 to the gateway\'s port 8444 and type a name that points at your public address, with port 443: the gateway asks Let\'s Encrypt for a certificate for that name when the switch first comes on (about a minute; asking means accepting Let\'s Encrypt\'s Subscriber Agreement) and renews it by itself. Or run a tunnel (Cloudflare Tunnel, Tailscale Funnel or ngrok) on the gateway\'s computer, pointed at https://127.0.0.1:8444, name it in the gateway\'s config.json as its declared proxy (the hardening guide gives the line), and type the tunnel\'s public name on the card: that company\'s servers then carry your footage, which is yours to choose. Give the gateway\'s computer a fixed address on the router first (a DHCP reservation), so the forward keeps pointing at it. Press Check reach: the line says what it found, in words, and the address is given to people\'s browsers only once the check has found your gateway there. Whatever you choose points at port 8444, never 8443: the office door closes anything that looks like a proxy or a tunnel, and the card turns amber if one is aimed at it. Never put a reverse proxy, a tunnel or any other program in front of port 8443.'

export const NAS_STORY = {
  intro: 'Synology DSM 7.2 with Container Manager is the worked example; QNAP\'s Container Station and TrueNAS Apps have the same five steps under their own names. About ten minutes, then two minutes for each office computer.',
  steps: [
    { lead: 'Get the image.', text: `The latest WILSON file gateway release (${GATEWAY_RELEASES_PAGE}) names its image by digest: ghcr.io/pretty-aud/wilson-gateway@sha256: and 64 letters and digits. Over SSH, as an administrator of the NAS: sudo docker pull ghcr.io/pretty-aud/wilson-gateway@sha256:… with the release's digest, which is exactly the image its signed version list names. Container Manager can fetch it too (Image → Add → Add From URL: ghcr.io/pretty-aud/wilson-gateway, the release's version as the tag); check that the digest it shows is the release's. (About a minute.)` },
    { lead: 'Make the folders.', text: 'File Station → docker → new folder wilson-gateway. That is where the gateway keeps its settings, its certificates and its journal; nothing of your footage goes there. The container runs as its own user (uid 65532), which must be able to write that folder: over SSH, sudo chown 65532:65532 /volume1/docker/wilson-gateway.' },
    {
      lead: 'Create the container.', text: 'Container Manager → Container → Create → the image → Advanced settings:',
      items: [
        { lead: 'Network:', text: 'Use the same network as Docker Host. This is the one setting that is not optional: on Docker\'s ordinary bridge network the gateway would see every browser as the same address and could not tell the office from a tunnel, so it keeps its office door closed and the card tells you to change the setting. No port settings are needed; the gateway listens on the NAS\'s own address, 8443 for the office door and 8444 for the outside door (closed until you turn the switch on).' },
        { lead: 'Volumes:', text: 'your footage share\'s folder, read-only, at the path WILSON gives it. For the location Footage (\\\\nas\\footage) that is /volume1/footage → /locations/nas/footage, read-only (the host and share names are written in lower case; folders below the share keep their own spelling). One line per footage location; the card writes yours out, and the health line names any that is missing. And docker/wilson-gateway → /data: the gateway\'s own files only (no footage, no tickets).', mounts: true },
        { lead: 'Environment:', text: 'WILSON_ENROL_TOKEN = the token the card shows (it works once, for 24 hours), and WILSON_CLOUD_URL = the WILSON cloud address beside it.' },
        { lead: 'Restart policy:', text: 'always.' },
      ],
    },
    { lead: 'Start it.', text: 'Within ten seconds the gateway appears on the card with its name and seen just now, and the token disappears. The container\'s log prints the gateway\'s certificate fingerprint on its first lines: type or paste it into the box beside the new gateway, which proves the gateway you see is the one you started and unlocks Download certificate. If the gateway does not appear, the log says why in one line (the token was used or expired; /data is not writable; a location is not mounted; the network is a bridge).' },
    TRUST_STEP,
  ],
  after: [
    { lead: 'From outside the office.', text: `Only if you want it: ${OUTSIDE_NOTE_TEXT}` },
    { lead: 'Behind the NAS\'s own reverse proxy.', text: 'Only for a proxy that can check the certificate of the program behind it. In the gateway\'s config.json (in docker/wilson-gateway) set "outside": { "behind_local_proxy": true }, so the outside door listens on the NAS\'s loopback only; point the proxy at https://127.0.0.1:8444 and have it check the certificate there against the gateway\'s own root (the file Download certificate gives you) under the NAS\'s host name, which that certificate carries; and keep its connections to the gateway open (the gateway counts the proxy as one visitor). A proxy that cannot check the certificate would hand your footage to whatever program took that port first: use the router forward instead. The proxy holds the public certificate itself, so the free one is off behind it.' },
    { lead: 'The NAS side of the share.', text: 'The container reads the folder directly, so no share login is needed. Keep SMB at 3 with signing and encryption on for the office computers that read the same share (Control Panel → File Services → SMB → Advanced), and leave SMB 1 off.' },
    { lead: 'Updates.', text: 'A container does not update itself. When a release is out, the card says it is available: pull it by its digest as in step 1, then recreate the container with the same settings (the /data folder keeps the gateway, its fingerprint and its enrolment).' },
    { lead: 'What it costs the NAS.', text: 'One small process; no transcoding; the bytes it serves are the bytes it reads, so a NAS that can serve the share can serve the gateway. Measured on a laptop: 337 MB/s over TLS, which is the disk and the link, not the gateway.' },
  ],
}

export const WINDOWS_STORY = {
  intro: 'Any Windows 10 or 11 PC, or a Windows server, that stays on in the office. About ten minutes, then two minutes for each office computer.',
  steps: [
    { lead: 'Run the installer', text: `(WILSON-Gateway-Setup-<version>.msi, from the latest WILSON file gateway release at ${GATEWAY_RELEASES_PAGE}) as an administrator. It is not signed yet, so Windows SmartScreen says Windows protected your PC: choose More info, then Run anyway. A signed build will stop that warning later. The installer sets up two services: the gateway, which runs as a Windows-managed service account with no password and no administrator rights (NT SERVICE\\WilsonGateway), and a small updater that swaps in new versions. It asks for the enrolment token and the WILSON cloud address the card shows, and at the end shows which of this PC's network addresses the office door uses (its wired or wireless addresses, never a VPN adapter) and the gateway's certificate fingerprint. (Two minutes.)` },
    { lead: 'Confirm the fingerprint.', text: 'Beside the new gateway on the card, type or paste the fingerprint the installer showed. That proves the gateway you see is the one you installed, and unlocks Download certificate.' },
    { lead: 'Give it the share\'s login.', text: 'The gateway reads your footage at its network address, as any computer does, with an account you choose. Make a read-only user for it on the server (on a Synology: Control Panel → User → create wilson-gateway, read-only on the footage share, nothing else), then in an administrator prompt: wilson-gateway share-login \\\\nas\\footage, which asks for that user\'s name and password once and hands them to the running gateway, which keeps them where only it can read them. One line per server. Until then the gateway never contacts that server: anyone in the company can name a location, so a server is contacted only once an administrator of this PC agrees. (An administrator of this PC could recover that login; it is read-only on the footage share and nothing else.)' },
    { lead: 'See it appear.', text: 'Within ten seconds the gateway appears on the card with its name, seen just now, and each footage location\'s reach. Not connected beside a location means step 3 is still owed for that server. In an administrator prompt, wilson-gateway doctor says the same on this PC.' },
    TRUST_STEP,
    { lead: 'Keep the PC on and awake', text: '(Power settings: never sleep when plugged in). The gateway checks for a new version once a day and updates itself; the card shows its version and up to date, and if an update fails it says so and keeps the old version running. An administrator can always install a newer .msi over it by hand, and wilson-gateway rollback, in an administrator prompt, puts the previous version back.' },
  ],
  after: [
    { lead: 'From outside the office.', text: `As on a NAS, with the forward pointing at this PC: ${OUTSIDE_NOTE_TEXT}` },
    { lead: 'In a Windows domain.', text: 'When the share is readable by this PC\'s own computer account, list the server in the gateway\'s settings file instead of running share-login: in C:\\ProgramData\\WILSON Gateway\\config.json, "connect_without_login": ["nas"] (the nas of \\\\nas\\footage; at most 16 servers), then restart the WilsonGateway service. The gateway contacts only the servers listed there or given a share login.' },
    { lead: 'What the installer does not do.', text: 'It does not open any port in the Windows firewall for the outside door (it opens 8443 for the local network only). The outside door\'s firewall rule is added when you turn the switch on and set an outside address, and removed when you turn it off.' },
    { lead: 'If the installer stops.', text: 'C:\\ProgramData\\WILSON Gateway must be a real folder holding only what this PC\'s administrators or the gateway made: the installer refuses a link there, or a file another account left, and names it in its log. To keep the log, run it from an administrator prompt as msiexec /i WILSON-Gateway-Setup-<version>.msi /l*v install.log; remove what the log names, then run the installer again.' },
  ],
}

// ── The sentences the card adds around them ──────────────────────────────────

export const GATEWAY_SECTION_DESCRIPTION = 'A small WILSON program on a computer in the office that lets browsers play clips straight from the company\'s footage share. In the office a clip never leaves the network; for people outside, it leaves through one door the company opens itself, only while the switch below is on. Nothing is copied or converted, and WILSON never relays a byte.'
export const GATEWAY_ADMIN_ONLY = 'Only a workspace admin can add or change the file gateway.'
export const GATEWAY_EMPTY = 'No gateway yet. Add one to play clips in the browser, in the office and, if the company allows it, outside.'
export const TOKEN_SHOWN_ONCE = 'This token is shown once and works once, for 24 hours. Give it to the gateway as it starts; once the gateway appears below, the token is spent.'
export const CLOUD_URL_HINT = 'The gateway\'s second setting: the WILSON cloud it talks to (WILSON_CLOUD_URL for the container; the installer\'s second field on Windows).'
export const FINGERPRINT_PROMPT = 'Type or paste the fingerprint the installer or the container\'s log printed. It proves this gateway is the one you installed, and unlocks Download certificate.'
export const FINGERPRINT_OTHER_ADMIN = 'Waiting for the admin who made this gateway\'s token to confirm its fingerprint: they are the one who saw it printed. If nobody installed it, choose Forget.'
// GW1 review round 2, finding 2: the notice sits in the gateway's own row,
// under its name, and does not repeat the name — a rogue gateway chooses its
// name ("Studio NAS (installed by IT)"), and this is the sentence meant to
// catch it.
export const NEW_GATEWAY_NOTICE = (when) => `This gateway enrolled ${when}, and no admin in this browser made its token today. If nobody in the company installed it, choose Forget: it gets no address and no ticket until its fingerprint is confirmed.`
export const OFFICE_RANGES_HINT = 'Addresses the gateway treats as the office besides its own network: a VPN pool, an office on unusual addressing. Private ranges only (10.x, 172.16–31.x, 192.168.x, fc00::/7), at most eight, none wider than a /16 (a /48 for IPv6). A viewing from these is not written down, as the office\'s is not.'
export const OUTSIDE_ADDRESS_HINT = 'The public name or address people outside the office reach the gateway at, and its port (8444 unless you forward 443 for the free certificate). It is given to their browsers only after Check reach finds this gateway there.'
export const NAME_REFUSAL = 'A gateway\'s name is 1 to 80 characters.'
export const FORGET_CONFIRM = (name) => `Forget “${gatewayNameWords(name)}”? It stops at once: no ticket is made for it again, its addresses are taken out of every browser, and its next check-in is refused. You can undo this for one minute; after that, enrol it again with a new token.`
export const FORGOTTEN_LINE = 'Forgotten: no ticket is made for it, and its next check-in is refused.'
export const IT_WORKS = 'It works: play a clip from outside.'
export const CHECKING = 'Checking… WILSON hands the gateway a code at its next check-in (within ten seconds), then knocks from the internet.'
export const CERTIFICATE_DOWNLOADED = 'Downloaded. Install it on each office computer as a trusted root (the steps are under Add a gateway, step 5).'
// ── GW3 (migration 0095): a new or next root certificate (§3, "the day it expires") ──
// A year before its root's end the gateway makes the next one and offers it
// beside the old; whenever an inside address leaves the root's /24s it makes
// a new root at once. Either reaches the cloud at the next sync, and D25 asks
// the enrolling admin for its fingerprint again before it is offered.
export const NEXT_ROOT_READY = 'A new certificate is ready: confirm its fingerprint, then download it.'
export const NEXT_ROOT_PROMPT = 'Type or paste the fingerprint of the new root certificate, as the gateway printed it in its log or on its status page. It proves the new certificate is this gateway\'s, and unlocks Download the new certificate.'
export const NEXT_ROOT_OTHER_ADMIN = 'A new certificate is ready. Waiting for the admin who made this gateway\'s token to confirm its fingerprint: they are the one who can check it against the gateway\'s own screen.'
/** The old certificate's fingerprint typed into the NEW certificate's box (GW3 review round 1, note 12). */
export const NEXT_ROOT_WRONG_ONE = 'That is the fingerprint of the certificate already in use. Type the new certificate\'s, as the gateway printed it in its log or on its status page.'
export const NEXT_ROOT_CONFIRMED = 'Confirmed: download the new certificate and install it on each office computer as a trusted root, beside the old one, before the old one expires.'
export const NEW_CERTIFICATE_DOWNLOADED = 'Downloaded the new certificate. Install it on each office computer as a trusted root, beside the old one.'
/**
 * The health line's phrase for a root on its way out (§3's twelve-month
 * sentence), read from the cloud's own columns rather than the gateway's
 * word: null while no new root has been reported.
 */
export function nextRootPhrase(gw) {
  if (!gw?.next_root_fingerprint) return null
  const until = String(gw.health?.certificate?.root_not_after || '').slice(0, 10)
  const head = until ? `the root certificate expires on ${until}; a new one is ready` : 'the gateway made a new root certificate'
  const tail = gw.next_root_confirmed_at
    ? ', confirmed: download it and install it on each office computer'
    : ': confirm its fingerprint, then download it'
  return { text: `${head}${tail}`, tone: 'warning', strong: 'a new one is ready' }
}
export const VIEWED_EMPTY = 'Nothing was viewed from outside the office in the last 30 days.'
export const VIEWED_DESCRIPTION = 'Every viewing through the outside door in the last 30 days, newest first: who, which clip, when, how much, and from where. Office viewing is not written down. Only workspace admins see this.'
export const AUDIT_EMPTY = 'No changes yet.'
// §5 step 4 and §10 row 21 (GW1 review round 2, finding 6): Rotate the
// ticket keys.
export const TICKET_KEYS_DESCRIPTION = 'Every ticket to play a clip from outside the office is signed with this company\'s key, renewed each year. If you think the key has been stolen, rotate it.'
export const ROTATE_CONFIRM = 'Rotate the ticket keys? New tickets are signed with a new key at once. The old key is honoured for ten more minutes, so nobody\'s playback stops.'
export const ROTATED_LINE = 'Rotated: new tickets are signed with a new key, and the old one stops working in ten minutes.'

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

// GW1 review round 1, finding 4: the health report is the gateway's own
// account, and a free-text part of it (a reason, a warning) must never read
// as WILSON's voice among the line's fixed phrases. It is quoted and
// attributed, cut to a line, its control characters dropped.
const NOT_TEXT = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2064\\u2066-\\u2069\\ufeff]', 'g')
function theGatewaySays(s) {
  const t = String(s ?? '').replace(NOT_TEXT, '').replace(/\s+/g, ' ').trim().slice(0, 120)
  return t ? `the gateway says “${t}”` : 'the gateway gives no reason'
}
// Round 2, finding 2: a version is a version (0093's CHECK, restated).
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.+-]{1,40})?$/
function versionOr(v, fallback) { return VERSION.test(String(v ?? '')) ? String(v) : fallback }

/** The gateway's version as shown, when it is one; null otherwise (round 2, finding 2). */
export function versionWords(v) { return versionOr(v, null) }

// Round 2, finding 2: a gateway chooses its own name, and the name is shown
// in sentences an admin acts on. Wherever it is shown it is words — control
// characters as spaces, the invisible and direction-changing ones dropped,
// one line (0093's gateway_clean_name, restated, for a row from before it) —
// and inside a sentence it is quoted, as the gateway's other words are.
const NAME_CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]', 'g')
const NAME_INVISIBLE = new RegExp('[\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u2069\\ufeff]', 'g')
export function gatewayNameWords(name, fallback = 'a gateway') {
  const t = String(name ?? '').replace(NAME_CONTROL, ' ').replace(NAME_INVISIBLE, '').replace(/\s+/g, ' ').trim().slice(0, 80).trim()
  return t || fallback
}
const named = (name) => (name ? `“${gatewayNameWords(name)}”` : 'a gateway')

/** The outside door's phrase from §2's vocabulary (read liberally). */
function outsidePhrase(gw, now) {
  const raw = String(gw?.health?.doors?.outside || '')
  if (!raw) return null
  const open = /^open(?::(\d{1,5}))?$/.exec(raw)
  if (open) {
    const port = open[1] || gw?.outside_address?.port || 8444
    if (gw?.reach_ok === true) {
      const checked = secondsSince(gw.reach_checked_at, now)
      const when = checked === null ? '' : checked < 10 ? ' (checked just now)' : ` (checked ${agoWords(checked)} ago)`
      return { text: `outside door open on ${port}, reachable from the internet${when}`, tone: 'plain' }
    }
    return { text: `outside door open on ${port}, not reached yet: Check reach`, tone: 'warning' }
  }
  if (raw === 'closed_switch_off') return { text: 'outside door closed (the switch is off)', tone: 'plain' }
  if (raw === 'closed_no_address') return { text: 'outside door closed (no outside address yet)', tone: 'plain' }
  const noCloud = /^closed_no_cloud(?::(\d+))?$/.exec(raw)
  if (noCloud) return { text: `outside door closed (no cloud${noCloud[1] ? ` for ${agoWords(Number(noCloud[1]))}` : ''})`, tone: 'warning' }
  if (raw.startsWith('closed')) return { text: `outside door closed (${theGatewaySays(humanize(raw.slice(6)))})`, tone: 'plain' }
  return { text: `outside door: ${theGatewaySays(humanize(raw))}`, tone: 'plain' }
}

function insidePhrase(gw) {
  const raw = String(gw?.health?.doors?.inside || '')
  if (!raw) return null
  const first = Array.isArray(gw.inside_addresses) ? gw.inside_addresses[0] : null
  if (/^open/.test(raw)) return { text: `office door open${first ? ` (${formatAddress(first)})` : ''}`, tone: 'plain' }
  if (/bridge/.test(raw)) return { text: 'office door closed (the container is on a bridge network: run it on the host\'s network)', tone: 'warning', strong: 'office door closed' }
  return { text: `office door closed${raw.length > 6 ? ` (${theGatewaySays(humanize(raw.replace(/^closed/, '')))})` : ''}`, tone: 'warning', strong: 'office door closed' }
}

export function healthPhrases(gw, { now = Date.now(), locations = [] } = {}) {
  const out = []
  if (!gw) return out
  out.push({ text: versionWords(gw.version) || 'version unknown', tone: 'plain' })
  const seen = secondsSince(gw.last_seen_at, now)
  if (seen === null) out.push({ text: 'never seen', tone: 'warning' })
  else if (seen < 5) out.push({ text: 'seen just now', tone: 'plain' })
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
  if (cert.expires_warning) out.push({ text: `certificate: ${theGatewaySays(cert.expires_warning)}`, tone: 'warning' })
  // GW3 (0095): the cloud's own knowledge of a new root, after the gateway's word.
  const nextRoot = nextRootPhrase(gw)
  if (nextRoot) out.push(nextRoot)

  const update = String(health.update || '')
  if (update === 'up_to_date') out.push({ text: 'up to date', tone: 'plain' })
  else if (update.startsWith('available:')) {
    const v = versionOr(update.slice(10), 'a new version')
    out.push({ text: gw.platform === 'container' ? `${v} is available: pull the image` : `${v} is available`, tone: 'warning' })
  } else if (update.startsWith('failed:')) {
    const [, v, ...why] = update.split(':')
    out.push({ text: `update to ${versionOr(v, 'a new version')} failed (${theGatewaySays(why.join(':'))}); running ${versionWords(gw.version) || 'an unknown version'}`, tone: 'warning' })
  }
  if (health.minimum_version_ok === false) {
    out.push({ text: 'below the minimum version: the outside door stays closed until it is updated', tone: 'warning' })
  }

  const relay = health.doors?.relay_warning
  const relayAt = relay && (parseIpv4(relay.address) || parseIpv6(relay.address)) ? `, ${relay.address}` : ''
  if (relay && Number.isInteger(Number(relay.viewers)) && Number(relay.viewers) > 1) {
    out.push({ text: `${Number(relay.viewers)} people reached the office door through one address today${relayAt}: a relay or proxy may be pointed at it`, tone: 'warning' })
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
  // Round 2, finding 4: red only for the inside door's own signature (it
  // closes a public peer at once); something else answering on that port
  // (a tunnel's edge accepts 8443) is said plainly, and is not an error.
  const inside = result?.inside_answered
    ? { text: `Your inside door (port ${insidePort}) answers from the internet. Remove that forward: only port ${port} should be open.`, tone: 'error' }
    : result?.inside_other
      ? { text: `Something else answers on port ${insidePort} at that address, not the gateway's office door (a tunnel's own edge does). Nothing to change unless you forwarded that port yourself.`, tone: 'plain' }
      : null
  return { text, tone, inside }
}

// ── The audit list ───────────────────────────────────────────────────────────

const AUDIT_WORDS = {
  'remote_viewing.on': () => 'turned viewing from outside the office on',
  'remote_viewing.off': () => 'turned viewing from outside the office off',
  'gateway.token_made': () => 'made a gateway enrolment token',
  'gateway.token_cancelled': () => 'cancelled a gateway enrolment token',
  'gateway.enrolled': (d, g) => `enrolled ${named(g || d.name)}${d.platform ? ` (${d.platform === 'container' ? 'a container' : 'Windows'}${versionWords(d.version) ? `, ${versionWords(d.version)}` : ''})` : ''}`,
  'gateway.root_confirmed': (d, g) => `confirmed the certificate fingerprint of ${named(g)}`,
  'gateway.renamed': (d) => `renamed ${named(d.from)} to ${d.to ? named(d.to) : 'a new name'}`,
  // (No possessive after a quoted name: "“Salt Hours NAS”'s" reads badly.)
  'gateway.outside_address_changed': (d, g) => (d.to ? `set the outside address of ${named(g)} to ${formatAddress(d.to)}` : `took away the outside address of ${named(g)}`),
  'gateway.office_ranges_changed': (d, g) => `set the office ranges of ${named(g)} to ${(Array.isArray(d.to) && d.to.length ? d.to.join(', ') : 'none')}`,
  'gateway.forgotten': (d, g) => `forgot ${named(g || d.name)}`,
  'gateway.forget_undone': (d, g) => `undid forgetting ${named(g)}`,
  'gateway.revoked': (d, g) => `the credential of ${named(g)} was deleted: the forget is final`,
  'gateway.reach_checked': (d, g) => `checked whether ${named(g)} is reachable from outside: ${humanize(d?.outside?.detail || 'done')}${d?.inside_answered ? '; the inside door answered' : d?.inside_other ? '; something else answered on the inside port' : ''}`,
  // Round 2, finding 2: the failure's reason is the gateway's word, quoted
  // as the health line quotes it; a version that is not one is not repeated.
  'gateway.update_failed': (d, g) => {
    const [, v, ...why] = String(d.update || 'failed:').split(':')
    return `${named(g)} could not update to ${versionOr(v, 'a new version')} (${theGatewaySays(why.join(':'))})`
  },
  'gateway.keys_rotated': () => 'rotated the ticket keys: new tickets are signed with a new key',
  // GW3 (0095): a new or next root, in the trail. The gateway's doing has no
  // actor; the confirmation is the admin's.
  // GW3 review round 1, finding 9: a FUTURE root reported while a confirmed new one waits is kept out of its place.
  // Review round 2, finding 2: a root already IN USE takes the place, and the confirmed one it replaced is said.
  'gateway.next_root_received': (d, g) => (d.kept_confirmed
    ? `${named(g)} sent another root certificate for the year ahead while the new one you confirmed waits; the one you confirmed is kept`
    : d.replaced_confirmed
      ? `${named(g)} now signs with another new root certificate, so the new one you had confirmed is no longer used: confirm this one's fingerprint, then download it`
      : `${named(g)} sent a new root certificate${d.in_use ? ', already in use' : ', for the year ahead'}: confirm its fingerprint, then download it`),
  'gateway.next_root_confirmed': (d, g) => `confirmed the fingerprint of the new root certificate of ${named(g)}`,
  'gateway.root_replaced': (d, g) => `${named(g)} now signs with its new root certificate; the old one is no longer offered`,
}

const NO_ACTOR = new Set(['gateway.revoked', 'gateway.update_failed', 'gateway.next_root_received', 'gateway.root_replaced'])

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
    // GW3 (0095): the gateway's coverage (the distinct bytes it served) is
    // what "read in full" means; a percentage from the bytes alone counts a
    // scrub over the same minute again, and is said as before.
    const covered = details.fraction_from === 'coverage' ? ' covered' : ''
    return `${bytes} of ${formatBytesShort(details.clip_bytes)}${pct != null ? ` (${pct}%${covered})` : ''}${details.read_in_full ? ' · read in full' : ''}`
  }
  return bytes
}

/** "203.0.113.7 via cloudflare", plus the shared-link mark (shared_url). */
// 0093 keeps `via` to a short list (round 1, finding 4); these are its words.
const VIA_WORDS = {
  cloudflare: 'Cloudflare Tunnel',
  tailscale: 'Tailscale Funnel',
  ngrok: 'ngrok',
  nas_proxy: "the NAS's reverse proxy",
}

export function whereWords(details = {}) {
  const addr = details.source_address || 'an unknown address'
  const via = details.via ? ` via ${VIA_WORDS[details.via] || 'a tunnel or proxy'}` : ''
  const others = Array.isArray(details.source_addresses) ? details.source_addresses.length : 0
  const shared = details.shared_url ? ` · one link played from ${others > 1 ? `${others} addresses` : 'more than one address'}` : ''
  return `${addr}${via}${shared}`
}

/** The viewer, with the mark R4 asks for when no mint matched (unverified_mint). */
export function whoWords(row) {
  const who = row?.actor_label || 'Someone no longer in the company'
  return row?.details?.unverified_mint ? `${who} (no matching ticket on record: the gateway's word)` : who
}

/**
 * "Viewed from outside 3 times, last by Priya on 9 Oct" — the Bins
 * inspector's one line (item 5). A viewing no ticket on record matches is
 * the gateway's word, not the cloud's (R4; GW1 review round 1, finding 2),
 * and the line says how many of them are.
 */
export function inspectorRemoteLine({ count, unverified, last } = {}, { locale } = {}) {
  const n = Number(count) || 0
  if (n === 0) return null
  const times = n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`
  const u = Math.min(n, Number(unverified) || 0)
  const mark = u === 0 ? ''
    : n === 1 ? "; no ticket on record matches it (the gateway's word)"
      : u === n ? "; none of them has a matching ticket on record (the gateway's word)"
        : `; ${u} of them ${u === 1 ? 'has' : 'have'} no matching ticket on record (the gateway's word)`
  if (!last?.created_at) return `Viewed from outside ${times}${mark}`
  const who = String(last.actor_label || '').split(/\s+/)[0] || 'someone'
  const when = new Date(last.created_at).toLocaleDateString(locale || 'en-GB', { day: 'numeric', month: 'short' })
  return `Viewed from outside ${times}, last by ${who} on ${when}${mark}`
}
