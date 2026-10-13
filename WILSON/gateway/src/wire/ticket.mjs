// =============================================================================
// The ticket (design §5 step 4 and step 6; the brief's "The wire, fixed").
//
//   claims   { v: 1, kid, gw, ws, sub, clip, loc, path, seq, mt, rv, iat, exp, jti }
//            keys in exactly this order and nothing else; ids lower-case
//            UUIDs; path the cloud's relative_path; iat/exp integer Unix
//            seconds with exp = iat + 120; jti 32 lower-case hex characters.
//   payload  base64url (no padding) of the UTF-8 bytes of JSON.stringify(claims)
//   sig      base64url (no padding) of Ed25519 over the ASCII bytes "v1.<payload>"
//   ticket   v1.<payload>.<sig>
//
// The gateway refuses a ticket string longer than 4096 characters BEFORE
// parsing; iat is the not-before; 30 s of clock skew each way.
//
// The answer to every failure here is one answer at the door (401, no body;
// design §5 step 6). The `reason` exists for the tests and the gateway's own
// log, never for the response.
// =============================================================================

import crypto from 'node:crypto';
import { b64urlDecodeStrict } from './b64.mjs';
import { KID_RE, UUID_RE, JTI_RE } from './formats.mjs';

export const CLAIM_ORDER = Object.freeze(['v', 'kid', 'gw', 'ws', 'sub', 'clip', 'loc', 'path', 'seq', 'mt', 'rv', 'iat', 'exp', 'jti']);
export const MAX_TICKET_CHARS = 4096;
export const SKEW_S = 30;
export const TICKET_LIFE_S = 120;
const MAX_PATH_CHARS = 1024;
const MAX_MT_CHARS = 255;

const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });
const utf8 = new TextDecoder('utf-8', { fatal: true });

/** The claims' own shape, field by field. True only for the exact wire shape. */
export function claimsHaveWireShape(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
  const keys = Object.keys(c);
  if (keys.length !== CLAIM_ORDER.length || keys.some((k, i) => k !== CLAIM_ORDER[i])) return false;
  if (c.v !== 1) return false;
  if (typeof c.kid !== 'string' || !KID_RE.test(c.kid)) return false;
  for (const id of [c.gw, c.ws, c.sub, c.clip, c.loc]) if (typeof id !== 'string' || !UUID_RE.test(id)) return false;
  if (typeof c.path !== 'string' || c.path.length === 0 || c.path.length > MAX_PATH_CHARS) return false;
  if (typeof c.seq !== 'boolean' || typeof c.rv !== 'boolean') return false;
  // `mt` is advisory (the row's mime_type, which 0091 lets be NULL): a string
  // or null; the door decides the type from the file on disk (media.mjs).
  if (!(c.mt === null || (typeof c.mt === 'string' && c.mt.length <= MAX_MT_CHARS))) return false;
  if (!Number.isSafeInteger(c.iat) || !Number.isSafeInteger(c.exp) || c.iat <= 0) return false;
  if (c.exp !== c.iat + TICKET_LIFE_S) return false;
  if (typeof c.jti !== 'string' || !JTI_RE.test(c.jti)) return false;
  return true;
}

/**
 * Parse only: the length cap, the three parts, strict base64url, UTF-8, JSON,
 * the canonical form (JSON.stringify of the parsed claims must give back the
 * very text that was signed: no whitespace, no duplicate key, no other
 * spelling of a number), and the claims' shape. Never throws.
 */
export function parseTicket(ticket) {
  if (typeof ticket !== 'string') return fail('shape');
  if (ticket.length > MAX_TICKET_CHARS) return fail('too_long');
  const parts = ticket.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return fail('shape');
  const payloadBytes = b64urlDecodeStrict(parts[1]);
  const signature = b64urlDecodeStrict(parts[2]);
  if (!payloadBytes || !signature || signature.length !== 64) return fail('shape');
  let text;
  let claims;
  try {
    text = utf8.decode(payloadBytes);
    claims = JSON.parse(text);
  } catch {
    return fail('payload');
  }
  if (!claimsHaveWireShape(claims)) return fail('claims');
  if (JSON.stringify(claims) !== text) return fail('claims');
  return {
    ok: true,
    claims: Object.freeze(claims),
    signingInput: Buffer.from('v1.' + parts[1], 'ascii'),
    signature,
  };
}

/**
 * Parse, then the signature against the cloud's public key for `kid`.
 * `keyFor(kid)` answers a KeyObject or null; an unknown kid answers
 * `{ ok: false, reason: 'unknown_kid', kid }` and NOTHING else of the claims
 * (they are unauthenticated), so the caller can sync once and try again.
 */
export function authenticateTicket(ticket, { keyFor }) {
  const parsed = parseTicket(ticket);
  if (!parsed.ok) return parsed;
  const key = keyFor(parsed.claims.kid);
  if (!key) return fail('unknown_kid', { kid: parsed.claims.kid });
  let good = false;
  try {
    good = crypto.verify(null, parsed.signingInput, key, parsed.signature);
  } catch {
    good = false;
  }
  return good ? { ok: true, claims: parsed.claims } : fail('signature');
}

/**
 * The dates and the scope of authenticated claims: not before iat, not at or
 * after exp (30 s of skew each way), this gateway, this workspace.
 */
export function checkTicketScope(claims, { nowS, gatewayId, workspaceId }) {
  if (nowS + SKEW_S < claims.iat) return fail('not_yet');
  if (nowS - SKEW_S >= claims.exp) return fail('expired');
  if (!gatewayId || claims.gw !== gatewayId) return fail('wrong_gateway');
  if (!workspaceId || claims.ws !== workspaceId) return fail('wrong_workspace');
  return { ok: true };
}

/** Everything in design order: parse, signature, dates, gateway and workspace. */
export function verifyTicket(ticket, { keyFor, nowS, gatewayId, workspaceId }) {
  const auth = authenticateTicket(ticket, { keyFor });
  if (!auth.ok) return auth;
  const scope = checkTicketScope(auth.claims, { nowS, gatewayId, workspaceId });
  return scope.ok ? auth : scope;
}
