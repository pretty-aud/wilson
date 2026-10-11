// =============================================================================
// gatewayDoors.js — GW3 (2026-10-11): the file gateway's DOORS, in the page.
//
// What the Bins tab's gateway adapter (adapters/gatewayBins.js) talks to
// when the dev fixtures are on, so port 5289 plays a clip through "a
// gateway" without a listener, a certificate or a database: the probe, the
// tickets, the bytes and the renewal all answer in the page. The bytes are a
// bundled clip of random frames (data/clip-noise.mp4, three seconds of
// noise made by ffmpeg; data/clip-noise.wav for audio) — never real footage.
//
// The modes, on the URL (`?gateway=…`), each one of GATEWAY_DESIGN.md §2's
// cases:
//   (absent) / inside   the stub answers the probe as the OFFICE door: the
//                       rows play, no overlay (G6, G8)
//   outside             the OUTSIDE door answered: the viewer's name, member
//                       code and the clock over every player (D9)
//   none                no gateway enrolled (§2's first row); `?gateways=empty`
//                       reads the same
//   unseen              a gateway enrolled that has not answered WILSON for
//                       four minutes (§2's second row)
//   unreachable         a gateway WILSON sees that this browser's probes do
//                       not reach (§2's third row)
//   real                the REAL doors (bins/gatewayDoors.js) against a real
//                       gateway on this computer, for the Playwright run
//                       against GW2's executable: `gw`, `host`, `port` name
//                       its outside door; tickets come from
//                       /__fake-cloud/gateway-ticket, which the test fulfils
//                       from the fake cloud (the page itself never holds a
//                       sign-in token for a cloud); `renew_s` shortens the
//                       player's renewal for the run
//   `missing=<id>`      a clip the gateway answers 404 for (the row flips to
//                       "missing at its location")
//
// The stub's tickets are the wire's shape (v1.<payload>.<sig>) with a real
// jti and exp, so the player reads them as it reads the cloud's; the
// signature is the fixture's word, checked by nobody.
// =============================================================================

import { fid } from './ids'
import { BIN_FILES, BIN_LOCATIONS } from './data/scenes'
import { GATEWAY_ID } from './data/gateways'
// The real doors module makes every network call itself (nothing under
// src/dev may); the fixtures only choose when to call it.
import { probeGateway, clipUrl as realClipUrl, renewStream as realRenew, headClip as realHead, postTicketRequest } from '../../tools/rabbit_v0.1.0/bins/gatewayDoors'
import noiseClipUrl from './data/clip-noise.mp4'
import noiseAudioUrl from './data/clip-noise.wav'

export const STUB_BASE = 'https://fixture-gateway.local:8443'
export const STUB_DOOR_SIGNATURE = 'fixture-signature-checked-by-nobody'

/** The playback mode from the URL (see the header). */
export function gatewayPlaybackMode(search = typeof location === 'undefined' ? '' : location.search) {
  const q = new URLSearchParams(search)
  const v = q.get('gateway')
  const known = ['inside', 'outside', 'none', 'unseen', 'unreachable', 'real']
  const mode = known.includes(v) ? v : (q.get('gateways') === 'empty' ? 'none' : 'inside')
  return {
    mode,
    missing: new Set((q.get('missing') || '').split(',').filter(Boolean)),
    real: mode === 'real' ? {
      gatewayId: q.get('gw') || null,
      host: q.get('host') || '127.0.0.1',
      port: Number(q.get('port')) || 8444,
      renewAfterMs: Number(q.get('renew_s')) > 0 ? Number(q.get('renew_s')) * 1000 : null,
      ticketsPath: '/__fake-cloud/gateway-ticket',
      sub: q.get('sub') || null,
    } : null,
  }
}

const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const randomHex = (n) => { const b = new Uint8Array(n); globalThis.crypto.getRandomValues(b); return [...b].map((x) => x.toString(16).padStart(2, '0')).join('') }

/** A ticket in the wire's shape, for the page alone (its claims are read by the player: jti, exp). */
export function stubTicket({ gatewayId, workspaceId, sub, clip, loc, path, rv, now = Date.now() }) {
  const iat = Math.floor(now / 1000)
  const claims = { v: 1, kid: 'fixture1', gw: gatewayId, ws: workspaceId, sub, clip, loc, path, seq: false, mt: '', rv: !!rv, iat, exp: iat + 120, jti: randomHex(16) }
  return `v1.${b64url(JSON.stringify(claims))}.${b64url(STUB_DOOR_SIGNATURE)}`
}

/**
 * The doors a page talks to. `store` holds the posters (an image row's bytes
 * are its picture here); `identity` is the signed-in fixture user.
 */
export function createGatewayDoorsStub(store, identity, { playback = gatewayPlaybackMode(), now = () => Date.now() } = {}) {
  const { mode, missing, real } = playback
  const rowOf = (id) => BIN_FILES.find((f) => f.id === id) || null
  const kindOf = (row) => {
    const ext = String(row?.extension || '').toLowerCase()
    if (['.mp4', '.m4v', '.mov', '.webm'].includes(ext)) return 'video'
    if (['.mp3', '.m4a', '.wav', '.bwf', '.flac', '.ogg'].includes(ext)) return 'audio'
    if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'].includes(ext)) return 'image'
    return null
  }

  if (mode === 'real' && real) {
    // The real doors against a real gateway; only the tickets come from the test's fake cloud.
    return Object.freeze({
      mode,
      real,
      probe: (gateway) => probeGateway(gateway),
      clipUrl: realClipUrl,
      renew: (base, id, body) => realRenew(base, id, body),
      head: (base, id, ticket) => realHead(base, id, ticket),
      /** The tickets, from the test's fake cloud through a same-origin path the Playwright run fulfils. */
      tickets: (gatewayId, ids) => postTicketRequest(real.ticketsPath, { gateway_id: gatewayId, bin_file_ids: ids, sub: real.sub }),
      /** The one gateway row the page may probe: the real one, by its outside door. */
      gatewayRows() {
        if (!real.gatewayId) return []
        return [{
          id: real.gatewayId, workspace_id: identity.workspaceId, name: 'GW2 on this computer', platform: 'windows', version: '0.1.0',
          inside_addresses: [], reach: { [BIN_LOCATIONS[0].id]: 'reachable' }, last_seen_at: new Date(now()).toISOString(),
          root_fingerprint: 'real', outside_address: { host: real.host, port: real.port },
        }]
      },
    })
  }

  const door = mode === 'outside' ? 'outside' : 'inside'
  return Object.freeze({
    mode,
    real: null,
    /** §2: /v1/path on the inside addresses, then the outside address. The stub answers by its mode. */
    async probe(gateway) {
      if (!gateway || gateway.id !== GATEWAY_ID) return null
      if (mode === 'unreachable' || mode === 'none' || mode === 'unseen') return null
      await new Promise((r) => setTimeout(r, 40))
      return { door, base: STUB_BASE, gatewayId: gateway.id }
    },
    /** The bytes: the bundled noise clip for a video row, the noise for audio, a row's own picture for a still. */
    clipUrl(base, id, ticket) {
      const row = rowOf(id)
      const kind = kindOf(row)
      const t = encodeURIComponent(ticket || '')
      // `missing=<id>`: the bytes are not there, as a gateway's 404 leaves a
      // <video> (which then asks the HEAD below, answered 404).
      if (missing.has(id)) return `/__fixture-missing__/${encodeURIComponent(id)}.mp4?t=${t}`
      if (kind === 'audio') return `${noiseAudioUrl}?t=${t}`
      if (kind === 'image') return store?.posters?.get?.(id) || `${noiseClipUrl}?t=${t}`
      return `${noiseClipUrl}?t=${t}`
    },
    async renew(_base, id, { jti }) {
      return { ok: !!jti && !missing.has(id), status: jti && !missing.has(id) ? 204 : 401 }
    },
    async head(_base, id) {
      return { status: missing.has(id) ? 404 : 200, door }
    },
    /** gateway-ticket, in the page: a ticket per playable row; refused for a format the gateway never serves. */
    async tickets(gatewayId, ids) {
      await new Promise((r) => setTimeout(r, 60))
      const tickets = {}
      const refused = []
      const miss = []
      for (const id of ids || []) {
        const row = rowOf(id)
        if (!row) { miss.push(id); continue }
        if (!kindOf(row) || row.is_sequence) { refused.push({ id, reason: 'not_playable' }); continue }
        tickets[id] = stubTicket({ gatewayId, workspaceId: identity.workspaceId, sub: identity.userId, clip: id, loc: row.location_id, path: row.relative_path, rv: door === 'outside', now: now() })
      }
      return { ok: true, status: 200, data: { tickets, missing: miss, refused, expires_at: new Date(now() + 120_000).toISOString() } }
    },
    gatewayRows: null,
  })
}
