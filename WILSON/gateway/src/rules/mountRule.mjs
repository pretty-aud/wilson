// =============================================================================
// A location's root on THIS gateway (design §5 step 6, §11 A step 3; review
// round 2, R15).
//
//   Windows    the location's unc_path itself (\\server\share\…), read by the
//              service's own account with the share login it was given.
//   container  /locations/<host>/<share>/<folders below>, with the host and the
//              share written in lower case and the folders below the share
//              keeping their own spelling: \\NAS\Footage\Day 1 is mounted at
//              /locations/nas/footage/Day 1.
//
// The gateway serves whatever location list the cloud hands it and
// second-guesses nothing about WHICH share it is (the cloud's CHECK refuses
// localhost and C$, not this). It refuses only what is not a share's address
// at all, or what Windows would read as another path (review round 1,
// finding 2):
//   - the server must be a NAME: letters, digits, '-', '_' and dots (a DNS
//     name, a NetBIOS name, an IPv4 address, an ipv6-literal.net name). So
//     not "?" or "." (\\?\C:\Windows, \\?\GLOBALROOT\…, \\.\pipe\… are the
//     device namespace), not "host@SSL@443" or "host@8080" (WebDAV over HTTP:
//     another protocol, out to port 80 or 443), no ':' or '%';
//   - no segment empty, '.', '..', or ending in a dot or a space (Windows
//     strips both, so \\nas\C$. is C$), none of / : * ? " < > |;
//   - no control or format character anywhere (the address is shown in the
//     health line and the status page): the desktop's rule, copied;
//   - the share is a share of files: not "pipe", "mailslot" or "IPC$", where
//     \\server\pipe\name opens a named pipe, not a file (on a consented
//     server, the gateway's own computer's name included, a pipe a local
//     process made would be read as a clip and would see the service connect;
//     review round 2, R2-N1), and no segment is a DOS device name (CON, PRN,
//     AUX, NUL, COM1–9, LPT1–9, with or without an extension).
// The container turns the result into a POSIX path under /locations.
// =============================================================================

export const CONTAINER_LOCATIONS_ROOT = '/locations';

const LABEL = '[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?';
const SERVER_RE = new RegExp(`^${LABEL}(?:\\.${LABEL})*$`);
const BAD_SEGMENT_CHARS_RE = /[/:*?"<>|]/;
const TRAILING_DOT_OR_SPACE_RE = /[. ]$/;
const INVISIBLE_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;
const NOT_A_FILE_SHARE_RE = /^(pipe|mailslot|ipc\$)$/i;
const DOS_DEVICE_RE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/** A server's name as a share address may hold it (see above). */
export function isServerName(host) {
  return typeof host === 'string' && host.length <= 253 && SERVER_RE.test(host);
}

/** `\\host\share\rest…` → { host, share, rest: [] } | null. */
export function parseUncPath(unc) {
  if (typeof unc !== 'string' || unc.length > 1024 || !unc.startsWith('\\\\')) return null;
  if (INVISIBLE_RE.test(unc)) return null;
  const segs = unc.slice(2).split('\\');
  if (segs.length < 2) return null;
  const [host, share, ...rest] = segs;
  if (!isServerName(host)) return null;
  if (NOT_A_FILE_SHARE_RE.test(share ?? '')) return null;
  for (const seg of [share, ...rest]) {
    if (!seg || seg === '.' || seg === '..' || TRAILING_DOT_OR_SPACE_RE.test(seg) || BAD_SEGMENT_CHARS_RE.test(seg) || DOS_DEVICE_RE.test(seg)) return null;
  }
  return { host, share, rest };
}

/** The container's root for a location, or null when the address has no safe shape. */
export function containerRootFor(unc) {
  const p = parseUncPath(unc);
  if (!p) return null;
  return [CONTAINER_LOCATIONS_ROOT, p.host.toLowerCase(), p.share.toLowerCase(), ...p.rest].join('/');
}

/** The root a location is read from on this platform. */
export function locationRoot(unc, platform) {
  if (platform === 'container') return containerRootFor(unc);
  return parseUncPath(unc) ? unc : null;
}
