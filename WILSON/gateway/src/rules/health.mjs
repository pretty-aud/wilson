// =============================================================================
// The health line (design §8), composed from the gateway's own state. The
// same text is the status page's (the inside door's `/`), `wilson-gateway
// doctor`'s first line and what the gateway reports at sync. Pure.
//
// The design's example, which the test holds this composer to verbatim:
//
//   **Studio NAS** · 1.2.4 · seen 6 s ago · office door open (192.168.1.10:8443)
//   · outside door closed (the switch is off) · Footage: reachable · Archive:
//   **not mounted** (mount /volume1/archive at /locations/nas/archive) ·
//   certificate: renews itself (leaf until 2027-11-01; root until 2036-10-09)
//   · up to date
//
// The mount hint: the gateway knows where a share must be mounted
// (/locations/nas/archive) but not the NAS's own folder for it (/volume1/…),
// which is the NAS's; the line uses the folder when the caller knows it and
// the share's address otherwise.
//
// Tones: 'plain', 'bold', 'amber', 'red' (the status page colours them; the
// text form drops them, keeping ** for bold as the design writes it).
// =============================================================================

export const SEP = ' · ';

/**
 * The design's own spellings: "6 s", "70 s" (seconds up to two minutes),
 * "4 minutes", "2 h", "3 days".
 */
export function durationWords(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 120) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 120) return `${m} minutes`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} days`;
}

const day = (t) => new Date(t).toISOString().slice(0, 10);
const hhmm = (t) => new Date(t).toISOString().slice(11, 16);
const hostPort = (a, port) => (String(a).includes(':') ? `[${a}]:${port}` : `${a}:${port}`);

export const OUTSIDE_PHRASES = Object.freeze({
  closed_switch_off: () => 'outside door closed (the switch is off)',
  closed_no_address: () => 'outside door closed (no outside address yet)',
  closed_no_cloud: (o) => `outside door closed (no cloud for ${durationWords((o.noCloudForMs ?? 60_000))})`,
  closed_minimum_version: (o) => `outside door closed (this version is below ${o.minimumVersion || 'the minimum'} for viewing from outside: update it)`,
  closed_bind_failed: (o) => `outside door closed (port ${o.port} is in use on this computer)`,
  closed_revoked: () => 'outside door closed (WILSON has forgotten this gateway)',
  closed_not_enrolled: () => 'outside door closed (not enrolled yet)',
  closed_no_certificate: () => 'outside door closed (no certificate for it yet)',
});

const INSIDE_CLOSED_PHRASES = Object.freeze({
  bridge: 'office door closed (the container is on a bridge network)',
  no_sysfs: 'office door closed (the container cannot read its network interfaces)',
  no_network: 'office door closed (no network)',
  no_address: 'office door closed (no office network address)',
  revoked: 'office door closed (WILSON has forgotten this gateway)',
  not_enrolled: 'office door closed (not enrolled yet)',
  bind_failed: 'office door closed (port in use on this computer)',
  starting: 'office door opening',
});

function seenPhrase(state) {
  if (!state.lastSyncAt) return { text: 'not seen yet', tone: 'amber' };
  const age = state.now - state.lastSyncAt;
  if (age < 30_000) return { text: `seen ${durationWords(age)} ago`, tone: 'plain' };
  return { text: `not seen for ${durationWords(age)}`, tone: age >= 5 * 60_000 ? 'red' : 'amber' };
}

function insidePhrase(inside) {
  if (inside?.state === 'open' && inside.addresses?.length) {
    return { text: `office door open (${inside.addresses.map((a) => hostPort(a.address, a.port)).join(', ')})`, tone: 'plain' };
  }
  return { text: INSIDE_CLOSED_PHRASES[inside?.closed] || 'office door closed', tone: 'amber' };
}

function outsidePhrase(o) {
  if (!o || !o.state) return { text: 'outside door closed (the switch is off)', tone: 'plain' };
  if (o.state === 'open') {
    if (o.reachOk === true && o.reachCheckedAt) return { text: `outside door open on ${o.port}, reachable from the internet (checked ${durationWords(o.now - o.reachCheckedAt)} ago)`, tone: 'plain' };
    if (o.reachOk === false) return { text: `outside door open on ${o.port}, not reached yet: Check reach`, tone: 'amber' };
    return { text: `outside door open on ${o.port}`, tone: 'plain' };
  }
  const f = OUTSIDE_PHRASES[o.state];
  const tone = o.state === 'closed_switch_off' || o.state === 'closed_no_address' ? 'plain' : 'amber';
  return { text: f ? f(o) : 'outside door closed', tone };
}

function locationSegments(loc, now) {
  const name = loc.name || loc.unc || 'a location';
  switch (loc.state) {
    case 'reachable':
      return [{ text: `${name}: reachable`, tone: 'plain' }];
    case 'not_reachable':
      return [{ text: `${name}: not reachable${loc.since ? ` since ${hhmm(loc.since)}` : ''}`, tone: 'amber' }];
    case 'not_mounted': {
      const from = loc.hostFolder || (loc.unc ? `the folder of ${loc.unc}` : 'the share’s folder');
      return [
        { text: `${name}: `, tone: 'plain' },
        { text: 'not mounted', tone: 'bold' },
        { text: ` (mount ${from} at ${loc.mountAt})`, tone: 'plain' },
      ];
    }
    case 'not_connected':
      return [{ text: `${name}: not connected (run share-login)`, tone: 'amber' }];
    default:
      void now;
      return [{ text: `${name}: not checked yet`, tone: 'plain' }];
  }
}

function certificatePhrase(c, now) {
  if (!c) return { text: 'certificate: not made yet', tone: 'amber' };
  if (c.kind === 'own') {
    if (!c.ownUntil) return { text: 'certificate: your company’s own', tone: 'plain' };
    const left = c.ownUntil - now;
    if (left <= 0) return { text: `certificate: your company’s own expired on ${day(c.ownUntil)}: browsers refuse it`, tone: 'red' };
    const days = Math.ceil(left / 86_400_000);
    if (days <= 30) return { text: `certificate: your company’s own expires in ${days} days (${day(c.ownUntil)})`, tone: days <= 7 ? 'red' : 'amber' };
    return { text: `certificate: your company’s own (until ${day(c.ownUntil)})`, tone: 'plain' };
  }
  return { text: `certificate: renews itself (leaf until ${day(c.leafUntil)}; root until ${day(c.rootUntil)})`, tone: 'plain' };
}

// ── GW4: the outside door's certificate (design §3) ──────────────────────────
// Said only when it is not the gateway's own leaf: the company's own PEM, or
// the free certificate (Let's Encrypt). The warnings come from 30 days before
// the end (amber, with the count of days and, for the free one, the reason its
// renewal failed), red from 7 and once expired, as the inside door's own
// certificate is warned. A free certificate that renews normally warns
// nothing: it renews at 30 days out by itself.
const DAY_MS = 86_400_000;
const daysLeft = (until, now) => Math.ceil((until - now) / DAY_MS);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function outsideCertificatePhrase(oc, now) {
  if (!oc) return null;
  if (oc.kind === 'own') {
    if (!oc.until) return { text: 'outside certificate: your company’s own', tone: 'plain' };
    if (oc.until <= now) return { text: `outside certificate: your company’s own expired on ${day(oc.until)}`, tone: 'red' };
    return { text: `outside certificate: your company’s own (until ${day(oc.until)})`, tone: 'plain' };
  }
  if (oc.kind !== 'acme') return null;
  switch (oc.state) {
    case 'valid': return { text: `outside certificate: Let’s Encrypt for ${oc.name}, renews itself (until ${day(oc.notAfter)})`, tone: 'plain' };
    case 'renewing': return { text: `outside certificate: Let’s Encrypt for ${oc.name}, renewing now (until ${day(oc.notAfter)})`, tone: 'plain' };
    case 'issuing': return { text: `outside certificate: getting your free certificate for ${oc.name} (about a minute)`, tone: 'plain' };
    case 'expired': return { text: `outside certificate: Let’s Encrypt for ${oc.name} expired on ${day(oc.notAfter)}`, tone: 'red' };
    default: return oc.doorOpen
      ? { text: `outside certificate: none yet for ${oc.name}`, tone: 'amber' }
      : { text: `outside certificate: none yet for ${oc.name} (it is asked for when the switch is on)`, tone: 'plain' };
  }
}

export function outsideCertificateWarning(oc, now) {
  if (!oc) return null;
  if (oc.kind === 'own') {
    if (!oc.until) return null;
    if (oc.until <= now) return { text: `the outside door’s certificate (your company’s own) expired on ${day(oc.until)}: browsers outside the office refuse it; put the new files in the gateway’s folder`, tone: 'red' };
    const d = daysLeft(oc.until, now);
    if (d <= 30) return { text: `the outside door’s certificate (your company’s own) expires in ${plural(d, 'day')}, on ${day(oc.until)}: put the new files in the gateway’s folder`, tone: d <= 7 ? 'red' : 'amber' };
    return null;
  }
  if (oc.kind !== 'acme') return null;
  const why = oc.failing?.reason ? ` (${oc.failing.reason})` : '';
  if (oc.state === 'expired') return { text: `the outside door’s free certificate expired on ${day(oc.notAfter)}${why}: browsers outside the office refuse it until it renews`, tone: 'red' };
  if ((oc.state === 'missing' || oc.state === 'failing') && oc.failing && oc.doorOpen) {
    return { text: `the outside door has no free certificate yet${why}: browsers outside the office cannot use the gateway until it has one`, tone: 'amber' };
  }
  if ((oc.state === 'valid' || oc.state === 'renewing') && oc.failing && oc.notAfter) {
    const d = daysLeft(oc.notAfter, now);
    if (d <= 30) return { text: `the outside door’s free certificate could not be renewed${why}; it expires in ${plural(d, 'day')}, on ${day(oc.notAfter)}`, tone: d <= 7 ? 'red' : 'amber' };
  }
  return null;
}

/** A channel that cannot be read is said after two days of trying (a day's outage is GitHub's, not news). */
export const CHANNEL_QUIET_MS = 48 * 3600_000;

/**
 * The release channel's trouble, in place of "up to date" (review round 2,
 * findings 2 and 4): a version list refused or not taken says so at once; a
 * channel that cannot be read, after CHANNEL_QUIET_MS without a good check.
 */
export function channelPhrase(channel, now) {
  const f = channel?.failure;
  if (!f) return null;
  if (f.kind === 'refused') return { text: `updates: the latest release’s version list was refused: ${f.words}${f.version ? ` (it names ${f.version})` : ''}`, tone: 'amber' };
  if (f.kind === 'lower') return { text: `updates: the latest release was not taken: ${f.words}; a newer release will reach this gateway`, tone: 'amber' };
  const since = channel.lastOkAt ?? f.since;
  if (f.kind === 'unreadable' && Number.isFinite(since) && now - since >= CHANNEL_QUIET_MS) return { text: `updates: not checked since ${day(since)}: ${f.words}`, tone: 'amber' };
  return null;
}

function updatePhrase(u, platform, now) {
  if (u && (!u.state || u.state === 'up_to_date')) {
    const ch = channelPhrase(u.channel, now);
    if (ch) return ch;
  }
  if (!u || u.state === 'up_to_date') return { text: 'up to date', tone: 'plain' };
  if (u.state === 'available') return { text: platform === 'container' ? `${u.version} is available: pull the image` : `${u.version} is available`, tone: 'amber' };
  if (u.state === 'updating') return { text: `updating to ${u.version}`, tone: 'plain' };
  if (u.state === 'failed') return { text: `update to ${u.version} failed (${u.reason || 'unknown reason'}); running ${u.running}`, tone: 'red' };
  if (u.state === 'disabled') return { text: 'updates off until a release key is set', tone: 'amber' };
  return { text: 'up to date', tone: 'plain' };
}

/**
 * @returns {{ segments: Array<{text:string,tone:string}>, text: string, warnings: Array<{text:string,tone:string}> }}
 */
export function composeHealthLine(state) {
  const now = state.now;
  const segs = [];
  const push = (s) => segs.push(s);
  const sep = () => push({ text: SEP, tone: 'plain' });

  push({ text: state.name || 'WILSON gateway', tone: 'bold' });
  sep(); push({ text: state.version, tone: 'plain' });
  sep(); push(seenPhrase(state));
  sep(); push(insidePhrase(state.inside));
  sep(); push(outsidePhrase({ ...(state.outside || {}), now }));
  for (const loc of state.locations || []) { sep(); for (const s of locationSegments(loc, now)) push(s); }
  sep(); push(certificatePhrase(state.certificate, now));
  const outsideCert = outsideCertificatePhrase(state.outsideCertificate, now);
  if (outsideCert) { sep(); push(outsideCert); }
  sep(); push(updatePhrase(state.update, state.platform, now));

  // The lines under it: the red and amber facts the admin must act on.
  const warnings = [];
  if (state.revoked) warnings.push({ text: 'WILSON has forgotten this gateway (its sign-in was refused): enrol it again', tone: 'red' });
  if (state.notEnrolled) warnings.push({ text: 'not enrolled yet: give it an enrolment token (wilson-gateway enrol)', tone: 'amber' });
  if (state.hardMinimum) warnings.push({ text: 'this version must be updated before it can serve', tone: 'red' });
  if (state.inside?.refusedPublic > 0) warnings.push({ text: `the office door is being reached from public addresses (${state.inside.refusedPublic} since the last sync): remove the router’s forward to port ${state.inside.port || 8443}`, tone: 'red' });
  if (state.inside?.relay) warnings.push({ text: `${state.inside.relay.viewers} people reached the office door through one address today, ${state.inside.relay.address}: a relay or proxy may be pointed at it`, tone: 'amber' });
  if (state.inside?.sentence) warnings.push({ text: state.inside.sentence, tone: 'amber' });
  // Before the root's twelve-month notice: the sync report's expires_warning is
  // the FIRST certificate warning, and the outside door's is the nearer one.
  const outsideWarning = outsideCertificateWarning(state.outsideCertificate, now);
  if (outsideWarning) warnings.push(outsideWarning);
  if (state.certificate?.rootExpiryNotice) warnings.push({ text: `the gateway’s root certificate expires on ${day(state.certificate.rootUntil)}; a new one will need installing on each office computer`, tone: 'amber' });
  if (state.certificate?.rootReplaced) warnings.push({ text: `the office network address changed to ${state.certificate.rootReplaced}, outside what the installed certificate covers: install the new certificate on each office computer (Settings, Storage)`, tone: 'red' });
  if (state.secrets && state.secrets.dpapi === false) warnings.push({ text: `secrets are protected by the folder’s permissions only (Windows data protection is unavailable: ${state.secrets.reason || 'unknown'})`, tone: 'amber' });
  for (const s of state.smb || []) if (s.dialect && !/^3/.test(s.dialect)) warnings.push({ text: `${s.unc} uses SMB ${s.dialect}: set SMB 3 with signing and encryption on the server`, tone: 'amber' });

  const text = segs.map((s) => (s.tone === 'bold' ? `**${s.text}**` : s.text)).join('');
  return { segments: segs, text, warnings };
}
