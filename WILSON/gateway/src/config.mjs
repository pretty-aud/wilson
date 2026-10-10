// =============================================================================
// config.json, in the state folder. Everything has a default; a value that is
// not its shape is ignored and named (never half-applied).
//
//   cloud_url                 set by `enrol --cloud` / the installer's second
//                             field; https only
//   name                      a display name until the cloud renames it
//   inside.port               8443 (D2)
//   inside.addresses          a pinned list (interfaces.mjs still checks each)
//   inside.certificate        { cert, key } file names in the state folder:
//                             the company's own leaf, instead of the gateway's
//   outside.port              8444 (D2): the door the router forwards to
//   outside.behind_local_proxy   the NAS's reverse proxy on this host: the
//                             outside door listens on loopback only and takes
//                             the forwarded address from it (§4). The OUTSIDE
//                             door only: there is no such setting for the
//                             inside door, by design
//   outside.declared_proxy    { addresses: [...], name } a tunnel daemon whose
//                             forwarded address the audit may take; `name` is
//                             written in every audit row's `via`
//   outside.certificate       { cert, key }: the company's own public certificate
//   limits                    limits.mjs
// =============================================================================

import path from 'node:path';
import { normalizeCloudUrl } from './cloud/client.mjs';
import { normalizeIp } from './rules/ip.mjs';
import { resolveLimits } from './rules/limits.mjs';
import { isServerName } from './rules/mountRule.mjs';

export const DEFAULT_CONFIG = Object.freeze({
  cloud_url: null,
  name: null,
  inside: { port: 8443, addresses: null, certificate: null },
  outside: { port: 8444, behind_local_proxy: false, declared_proxy: null, certificate: null },
  limits: {},
  // Windows: the servers this gateway may contact without a share login (a
  // domain whose computer account reads the share). Every other server is
  // contacted only once an administrator has run share-login for it (review
  // round 1, finding 2).
  connect_without_login: [],
});

const isPort = (p) => Number.isInteger(p) && p >= 0 && p <= 65535;
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

function certificatePair(v, problems, where) {
  if (v == null) return null;
  if (typeof v === 'object' && FILE_RE.test(String(v.cert)) && FILE_RE.test(String(v.key))) return { cert: v.cert, key: v.key };
  problems.push(`${where}.certificate (two file names in the state folder: { "cert": "…pem", "key": "…pem" })`);
  return null;
}

export function parseConfig(text) {
  const problems = [];
  let raw = {};
  if (typeof text === 'string' && text.trim()) {
    try { raw = JSON.parse(text); } catch { problems.push('config.json is not JSON: the defaults are used'); raw = {}; }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
  const c = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  if (raw.cloud_url != null) { const u = normalizeCloudUrl(raw.cloud_url); if (u) c.cloud_url = u; else problems.push('cloud_url (an https:// address)'); }
  if (raw.name != null) { if (typeof raw.name === 'string' && raw.name.trim()) c.name = raw.name.trim().slice(0, 80); else problems.push('name'); }
  const ri = raw.inside && typeof raw.inside === 'object' ? raw.inside : {};
  const ro = raw.outside && typeof raw.outside === 'object' ? raw.outside : {};
  if (ri.port !== undefined) { if (isPort(ri.port)) c.inside.port = ri.port; else problems.push('inside.port'); }
  if (ri.addresses != null) {
    if (Array.isArray(ri.addresses) && ri.addresses.every((a) => typeof a === 'string')) c.inside.addresses = ri.addresses.slice(0, 16);
    else problems.push('inside.addresses (a list of addresses)');
  }
  c.inside.certificate = certificatePair(ri.certificate, problems, 'inside');
  if (ri.behind_local_proxy !== undefined) problems.push('inside.behind_local_proxy does not exist: only the outside door can sit behind a proxy (design §4)');
  if (ro.port !== undefined) { if (isPort(ro.port)) c.outside.port = ro.port; else problems.push('outside.port'); }
  if (ro.behind_local_proxy !== undefined) { if (typeof ro.behind_local_proxy === 'boolean') c.outside.behind_local_proxy = ro.behind_local_proxy; else problems.push('outside.behind_local_proxy'); }
  if (ro.declared_proxy != null) {
    const d = ro.declared_proxy;
    const addrs = Array.isArray(d?.addresses) ? d.addresses.map((a) => normalizeIp(String(a))) : [];
    if (addrs.length && addrs.every(Boolean) && typeof d.name === 'string' && d.name.trim()) c.outside.declared_proxy = { addresses: addrs.slice(0, 8), name: d.name.trim().slice(0, 48) };
    else problems.push('outside.declared_proxy ({ "addresses": ["…"], "name": "…" })');
  }
  c.outside.certificate = certificatePair(ro.certificate, problems, 'outside');
  if (raw.connect_without_login != null) {
    const list = raw.connect_without_login;
    if (Array.isArray(list) && list.length <= 16 && list.every(isServerName)) c.connect_without_login = [...new Set(list.map((h) => h.toLowerCase()))];
    else problems.push('connect_without_login (a list of at most 16 server names: the "nas" of \\\\nas\\footage)');
  }
  const { limits, ignored } = resolveLimits(raw.limits || {});
  c.limits = raw.limits && typeof raw.limits === 'object' ? raw.limits : {};
  for (const k of ignored) problems.push(`limits.${k}`);
  return { config: c, limits, problems };
}

/** The declared proxy the outside door trusts for a forwarded address. */
export function declaredProxyOf(config) {
  if (config.outside.behind_local_proxy) return { addresses: ['127.0.0.1', '::1'], name: 'local_proxy' };
  return config.outside.declared_proxy || null;
}

export function inStateDir(stateDir, file) {
  const p = path.resolve(stateDir, file);
  return p.startsWith(path.resolve(stateDir) + path.sep) ? p : null;
}
