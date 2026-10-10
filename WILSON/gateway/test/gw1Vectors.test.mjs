// =============================================================================
// gw1Vectors.test.mjs — the cloud's own tickets (GW1's mint, copied from
// origin/po/gw1-gateway-cloud:WILSON/docs/design/gateway-ticket-vectors.json
// into gateway/test/gw1-vectors.json) through this gateway's verifier and
// through both doors on loopback. Each ticket must get the verdict GW1 states,
// and each door the outcome GW1 states.
//
// When the file is absent the tests are SKIPPED BY NAME (the skipped test says
// what is missing and the command that copies it): never a silent pass.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyTicket, parseTicket, CLAIM_ORDER, TICKET_LIFE_S, MAX_TICKET_CHARS, SKEW_S } from '../src/wire/ticket.mjs';
import { signingKeyFromWire, KID_RE } from '../src/wire/formats.mjs';
import { makeShare, makeWorld } from './harness.mjs';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'gw1-vectors.json');
const present = fs.existsSync(FILE);
const V = present ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : null;

export const ABSENT_NAME = 'SKIPPED, gateway/test/gw1-vectors.json is absent: copy it with git show origin/po/gw1-gateway-cloud:WILSON/docs/design/gateway-ticket-vectors.json > gateway/test/gw1-vectors.json';

// GW1's verdict names, and the reason this verifier gives for each. A verdict
// this table does not know fails the test (a new kind of refusal is read, not
// passed over).
const REASON_FOR = { expired: 'expired', wrong_gateway: 'wrong_gateway', bad_signature: 'signature', wrong_workspace: 'wrong_workspace', not_yet: 'not_yet', unknown_kid: 'unknown_kid' };

describe.skipIf(!present)("GW1's ticket vectors, through the verifier", () => {
  const keys = present ? new Map(V.signing_keys.map((e) => { const k = signingKeyFromWire(e); return [e.kid, k && k.key]; })) : new Map();
  const keyFor = (kid) => keys.get(kid) || null;
  const scope = present ? { nowS: V.verifier.now, gatewayId: V.verifier.gateway_id, workspaceId: V.verifier.workspace_id } : {};

  it('the wire GW1 states is the wire this verifier enforces', () => {
    expect(V.wire.ticket).toBe('v1.<payload>.<sig>');
    expect(V.wire.claim_order).toEqual([...CLAIM_ORDER]);
    expect(V.wire.ttl_seconds).toBe(TICKET_LIFE_S);
    expect(V.wire.max_length).toBe(MAX_TICKET_CHARS);
    expect(V.wire.skew_seconds).toBe(SKEW_S);
  });

  it('every signing key GW1 delivers is one this gateway takes (kid and standard base64 of the raw 32 bytes)', () => {
    expect(V.signing_keys.length).toBeGreaterThan(0);
    for (const e of V.signing_keys) {
      expect(KID_RE.test(e.kid), e.kid).toBe(true);
      expect(keys.get(e.kid), e.kid).toBeTruthy();
    }
  });

  it('every ticket parses to exactly the claims GW1 states (the non-ASCII path included)', () => {
    for (const t of V.tickets) {
      const p = parseTicket(t.ticket);
      expect(p.ok, t.name).toBe(true);
      expect(p.claims, t.name).toEqual(t.claims);
    }
  });

  it('every ticket gets the verdict GW1 states', () => {
    expect(V.tickets.length).toBeGreaterThan(0);
    for (const t of V.tickets) {
      const r = verifyTicket(t.ticket, { keyFor, ...scope });
      if (t.verdict === 'valid') {
        expect(r.ok, `${t.name}: ${r.reason}`).toBe(true);
        expect(r.claims, t.name).toEqual(t.claims);
      } else {
        expect(Object.keys(REASON_FOR), `${t.name}: GW1's verdict ${t.verdict} is one this test knows`).toContain(t.verdict);
        expect(r.ok, t.name).toBe(false);
        expect(r.reason, t.name).toBe(REASON_FOR[t.verdict]);
      }
    }
  });

  it('a refused ticket is refused for its one stated fault only: mended, it passes', () => {
    // GW1: each refused ticket fails exactly one check. Mend that one input
    // and the verifier must accept, so the verdict cannot come from another.
    for (const t of V.tickets.filter((x) => x.verdict !== 'valid')) {
      let r;
      if (t.verdict === 'expired') r = verifyTicket(t.ticket, { keyFor, ...scope, nowS: t.claims.iat });
      else if (t.verdict === 'wrong_gateway') r = verifyTicket(t.ticket, { keyFor, ...scope, gatewayId: t.claims.gw });
      else if (t.verdict === 'bad_signature') {
        const [v, payload, sig] = t.ticket.split('.');
        const b = Buffer.from(sig, 'base64url');
        b[0] ^= 0x01;
        r = verifyTicket([v, payload, b.toString('base64url')].join('.'), { keyFor, ...scope });
      } else continue;
      expect(r.ok, `${t.name} mended: ${r.reason}`).toBe(true);
    }
  });
});

describe.skipIf(!present)("GW1's ticket vectors, through both doors on loopback", () => {
  let share;
  const worlds = {};
  const bytesOf = new Map();
  beforeAll(async () => {
    share = makeShare();
    for (const t of V.tickets) {
      const p = path.join(share.root, ...t.claims.path.split('/'));
      if (!bytesOf.has(t.claims.path)) {
        const b = crypto.randomBytes(4096 + bytesOf.size);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, b);
        bytesOf.set(t.claims.path, b);
      }
    }
    for (const door of ['inside', 'outside']) {
      const w = await makeWorld({ door, share, clock: { t: V.verifier.now * 1000 }, ids: { gatewayId: V.verifier.gateway_id, workspaceId: V.verifier.workspace_id } });
      for (const e of V.signing_keys) w.keys.set(e.kid, signingKeyFromWire(e).key);
      for (const t of V.tickets) w.state.locations.set(t.claims.loc, { root: share.root, state: 'reachable' });
      worlds[door] = w;
    }
  });
  afterAll(async () => {
    for (const w of Object.values(worlds)) await w.close();
    share?.cleanup();
  });

  for (const door of ['inside', 'outside']) {
    it(`the ${door} door does with each ticket what GW1 states`, async () => {
      const w = worlds[door];
      for (const t of V.tickets) {
        const said = door === 'inside' ? t.inside_door : t.outside_door;
        const r = await w.request(`/v1/clips/${t.claims.clip}?t=${t.ticket}`);
        if (said === 'serve') {
          expect(r.status, `${t.name} on the ${door} door`).toBe(200);
          expect(Buffer.compare(r.body, bytesOf.get(t.claims.path)), t.name).toBe(0);
        } else {
          expect(said.startsWith('refuse'), `${t.name}: GW1 says ${said}`).toBe(true);
          expect(r.status, `${t.name} on the ${door} door`).toBe(401);
          expect(r.body.length, t.name).toBe(0);
          const refused = w.state.log.filter((e) => e.event === 'clip_refused').at(-1);
          const want = t.verdict === 'valid' ? 'rv' : REASON_FOR[t.verdict];
          expect(refused?.reason, `${t.name} on the ${door} door`).toBe(want);
        }
      }
    });
  }
});

// Absent: one more SKIPPED test whose name says what is missing and how to
// copy it (defined only then, so a present file adds no skip to the count).
if (!present) {
  describe("GW1's ticket vectors", () => {
    it.skip(ABSENT_NAME, () => {});
  });
}
