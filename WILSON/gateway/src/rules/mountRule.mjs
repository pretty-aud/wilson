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
// localhost and C$, not this): it only refuses a shape it cannot turn into a
// safe POSIX path (an empty, '.' or '..' segment, a slash, NUL, a control
// character), because that would be a path out of /locations.
// =============================================================================

export const CONTAINER_LOCATIONS_ROOT = '/locations';

/** `\\host\share\rest…` → { host, share, rest: [] } | null. */
export function parseUncPath(unc) {
  if (typeof unc !== 'string' || unc.length > 1024 || !unc.startsWith('\\\\')) return null;
  const segs = unc.slice(2).split('\\');
  if (segs.length < 2) return null;
  for (const seg of segs) {
    if (!seg || seg === '.' || seg === '..' || seg.includes('/') || /[\u0000-\u001f\u007f]/.test(seg)) return null;
  }
  const [host, share, ...rest] = segs;
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
