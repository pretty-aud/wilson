// =============================================================================
// The gateway's calls to WILSON's cloud (Appendix C): gateway-enrol (with the
// enrolment token), gateway-sync and gateway-events (with the credential).
// HTTPS only; `Authorization: Bearer <token or credential>`; 10 s per call;
// an answer at most 1 MB; every field of every answer checked against its
// shape before the gateway uses it (a field that is not the shape is dropped
// and named in the log, never half-used).
//
// The cloud's address (the brief's "The wire, fixed"): the token carries no
// URL; the gateway takes it from `enrol --cloud <url>` / the installer's
// second field (kept in config.json), else WILSON_CLOUD_URL (the container),
// else the compiled-in default, prod's functions base.
//
// GW2's choices where Appendix C leaves the shape open (For GW3 in the
// hand-off): the enrolment token travels as the Bearer; the enrol and sync
// answers carry `workspace_id` (the ticket's `ws` cannot be checked without
// it); the events body is { rows: [...] }.
// =============================================================================

import { isCredential, signingKeyFromWire, UUID_RE } from '../wire/formats.mjs';
import { parseUncPath } from '../rules/mountRule.mjs';
import { parseVersion } from '../update/manifest.mjs';

export const DEFAULT_CLOUD_URL = 'https://rqyriuyldhovirbuievt.supabase.co/functions/v1';
export const CALL_TIMEOUT_MS = 10_000;
export const MAX_ANSWER_BYTES = 1024 * 1024;

/** An https:// base with no credentials, query or fragment, without a trailing slash; null otherwise. */
export function normalizeCloudUrl(u) {
  if (typeof u !== 'string' || !u.trim()) return null;
  let url;
  try { url = new URL(u.trim()); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
  return url.toString().replace(/\/+$/, '');
}

const ORIGIN_RE = /^https:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i;
const DEV_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(?::\d{1,5})?$/i;
/** The web app's origins: https ones, and the developer's loopback (GW3's Playwright). */
export function cleanOrigins(list) {
  return Array.isArray(list) ? list.filter((o) => typeof o === 'string' && o.length <= 255 && (ORIGIN_RE.test(o) || DEV_ORIGIN_RE.test(o))) : [];
}

const HOST_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
export function cleanOutsideAddress(a) {
  if (!a || typeof a !== 'object') return null;
  const port = Number(a.port);
  const host = typeof a.host === 'string' ? a.host.trim() : '';
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (!(HOST_RE.test(host) || /^[0-9a-f:.]+$/i.test(host))) return null;
  return { host, port };
}

function cleanKeys(list, dropped) {
  const out = [];
  for (const e of Array.isArray(list) ? list : []) {
    const k = signingKeyFromWire(e);
    if (k) out.push(k); else dropped.push('signing_keys[]');
  }
  return out;
}

const okVersion = (v) => v == null || !!parseVersion(v);

/** The enrol answer, checked: { gateway_id, credential, workspace_id, workspace_name, signing_keys, web_app_origins, sync_interval_s }. */
export function cleanEnrolAnswer(a) {
  const dropped = [];
  if (!a || typeof a !== 'object') return { ok: false, reason: 'not an object' };
  if (typeof a.gateway_id !== 'string' || !UUID_RE.test(a.gateway_id)) return { ok: false, reason: 'gateway_id' };
  if (!isCredential(a.credential)) return { ok: false, reason: 'credential' };
  const workspaceId = typeof a.workspace_id === 'string' && UUID_RE.test(a.workspace_id) ? a.workspace_id : null;
  const interval = Number.isInteger(a.sync_interval_s) ? Math.min(60, Math.max(5, a.sync_interval_s)) : 10;
  return {
    ok: true,
    dropped,
    value: {
      gatewayId: a.gateway_id,
      credential: a.credential,
      workspaceId,
      workspaceName: displayText(a.workspace_name, 200),
      signingKeys: cleanKeys(a.signing_keys, dropped),
      origins: cleanOrigins(a.web_app_origins),
      syncIntervalS: interval,
    },
  };
}

// Words the cloud hands over for people to read (a gateway's name, a
// location's, the company's): printed by `doctor` to a terminal and written
// into the health line, so no control, format or invisible character survives
// (review round 1, finding 3: an escape sequence in a rename would have
// rewritten the admin's console).
const INVISIBLE_G = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]+/gu;
export function displayText(s, max) {
  if (typeof s !== 'string') return null;
  const t = s.replace(INVISIBLE_G, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return t || null;
}

/** The sync answer, checked; a missing or wrong `remote_viewing` reads as OFF. */
export function cleanSyncAnswer(a) {
  const dropped = [];
  if (!a || typeof a !== 'object') return { ok: false, reason: 'not an object' };
  const locations = [];
  for (const l of Array.isArray(a.bin_locations) ? a.bin_locations : []) {
    if (!(l && typeof l.id === 'string' && UUID_RE.test(l.id))) { dropped.push('bin_locations[]'); continue; }
    // The address re-checked here, as a ticket's path is (review round 1,
    // finding 1): a location whose address is no share's (the device
    // namespace, WebDAV, a stripped alias, an invisible character) never
    // reaches the reach check, the doors or the health line; the log names it.
    if (!parseUncPath(l.unc_path)) { dropped.push(`bin_locations[${l.id}] (not a share address)`); continue; }
    locations.push({ id: l.id, unc: l.unc_path, name: displayText(l.name, 120) });
  }
  const confirmed = (Array.isArray(a.confirmed) ? a.confirmed : []).filter((c) => typeof c === 'string' && UUID_RE.test(c));
  for (const k of ['minimum_version', 'hard_minimum_version']) if (!okVersion(a[k])) dropped.push(k);
  const reach = a.reach && typeof a.reach === 'object' && typeof a.reach.ok === 'boolean'
    ? { ok: a.reach.ok, checkedAt: Number.isFinite(Date.parse(a.reach.checked_at)) ? Date.parse(a.reach.checked_at) : null }
    : null;
  return {
    ok: true,
    dropped,
    value: {
      remoteViewing: a.remote_viewing === true,
      outsideAddress: cleanOutsideAddress(a.outside_address),
      officeRanges: Array.isArray(a.office_ranges) ? a.office_ranges.slice(0, 32) : [],
      signingKeys: cleanKeys(a.signing_keys, dropped),
      keysPresent: Array.isArray(a.signing_keys),
      origins: cleanOrigins(a.web_app_origins),
      locations,
      confirmed,
      minimumVersion: okVersion(a.minimum_version) ? a.minimum_version ?? null : null,
      hardMinimumVersion: okVersion(a.hard_minimum_version) ? a.hard_minimum_version ?? null : null,
      checkUpdateNow: a.check_update_now === true,
      checkReachNow: a.check_reach_now === true,
      reachNonce: typeof a.reach_nonce === 'string' && a.reach_nonce.length >= 16 && a.reach_nonce.length <= 128 ? a.reach_nonce : null,
      renamed: displayText(a.renamed, 80),
      workspaceId: typeof a.workspace_id === 'string' && UUID_RE.test(a.workspace_id) ? a.workspace_id : null,
      reach,
    },
  };
}

async function readCapped(res) {
  const reader = res.body?.getReader?.();
  if (!reader) return '';
  const chunks = [];
  let n = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > MAX_ANSWER_BYTES) { reader.cancel().catch(() => {}); throw Object.assign(new Error('answer too large'), { code: 'ETOOBIG' }); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export class CloudClient {
  /**
   * @param {{ baseUrl: string, credential?: () => string|null, fetchImpl?: typeof fetch, timeoutMs?: number }} o
   */
  constructor({ baseUrl, credential = () => null, fetchImpl = globalThis.fetch, timeoutMs = CALL_TIMEOUT_MS }) {
    const base = normalizeCloudUrl(baseUrl);
    if (!base) throw new Error('the cloud’s address must be an https:// URL');
    this.base = base;
    this.credential = credential;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  /** @returns {Promise<{ ok: true, status: number, data: any } | { ok: false, status: number, unreachable?: boolean, revoked?: boolean, error?: string, code?: string }>} */
  async call(fn, body, bearer) {
    let res;
    try {
      res = await this.fetch(`${this.base}/${fn}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      return { ok: false, status: 0, unreachable: true, error: String(e?.cause?.code || e?.name || e?.message || 'network').slice(0, 80) };
    }
    let text = '';
    try { text = await readCapped(res); } catch (e) { return { ok: false, status: res.status, unreachable: true, error: e.code || 'read' }; }
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (res.status === 401) return { ok: false, status: 401, revoked: true, error: data?.error, code: data?.code };
    if (!res.ok) return { ok: false, status: res.status, unreachable: res.status >= 500 || res.status === 429, error: typeof data?.error === 'string' ? data.error.slice(0, 300) : null, code: data?.code };
    if (data === null || typeof data !== 'object') return { ok: false, status: res.status, unreachable: true, error: 'not JSON' };
    return { ok: true, status: res.status, data };
  }

  enrol(token, body) { return this.call('gateway-enrol', body, token); }
  sync(body) { return this.call('gateway-sync', body, this.credential()); }
  events(rows) { return this.call('gateway-events', { rows }, this.credential()); }
}
