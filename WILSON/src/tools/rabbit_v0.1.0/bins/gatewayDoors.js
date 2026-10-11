// ============================================================
// RABBIT — Bins: the gateway's doors, from a browser (GW3)
// ============================================================
//
// The browser's half of the gateway's HTTP surface (GATEWAY_DESIGN.md §2,
// §5, §7; GW2's hand-off "For GW3", the routes as built): the probe that
// finds which door answers, the clip URL a <video> is pointed at, the
// renewal that keeps that URL alive, and the HEAD that tells a status a
// <video> cannot (401 / 404 / 415). Pure: `fetchImpl` is injected, so the
// tests run it against a fake and the dev fixtures stand in for a door
// without a listener.
//
// What a <video> cannot do shapes all of it: it cannot send a header, so
// the ticket rides the URL (`?t=`); it cannot read a response header, so
// the door is known from the ADDRESS that answered the probe, never from
// `Wilson-Gateway-Path`; it cannot read a status, so a failure is diagnosed
// with a HEAD on a fresh ticket. On the inside door `/v1/path` answers
// `{ path: 'inside', gateway_id }`; on the outside door the route is 404 on
// purpose (review round 2, R17), and the browser knows it used the outside
// address, which is what decides the viewer's name overlay (§7).

export const PROBE_TIMEOUT_MS = 1500
/** §5 step 7: the player renews at 75 s, well inside the ticket's two minutes. */
export const RENEW_AFTER_MS = 75_000
/** gateway-ticket takes at most fifty clip ids in one call. */
export const TICKET_BATCH_MAX = 50

/** `https://host:port`, an IPv6 literal bracketed. */
export function doorBase(host, port) {
  const h = String(host || '').trim()
  const bracketed = h.includes(':') && !h.startsWith('[') ? `[${h}]` : h
  return `https://${bracketed}:${Number(port) || 8443}`
}

/** The URL a <video> is pointed at (§5 step 5). */
export function clipUrl(base, id, ticket) {
  return `${base}/v1/clips/${id}?t=${encodeURIComponent(ticket)}`
}

/** The claims of a ticket (`v1.<payload>.<sig>`), or null; the signature is the gateway's to check, never read here. */
export function ticketClaims(ticket) {
  if (typeof ticket !== 'string') return null
  const parts = ticket.split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') return null
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const text = decodeURIComponent(Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (ch) => `%${ch.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''))
    const claims = JSON.parse(text)
    return claims && typeof claims === 'object' ? claims : null
  } catch {
    return null
  }
}

/** When a ticket's authority ends, in ms since the epoch, or null. */
export function ticketExpiresAt(ticket) {
  const exp = ticketClaims(ticket)?.exp
  return Number.isFinite(exp) ? exp * 1000 : null
}

async function fetchPath(base, { fetchImpl, timeoutMs }) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null
  try {
    const res = await fetchImpl(`${base}/v1/path`, { method: 'GET', cache: 'no-store', ...(ctrl ? { signal: ctrl.signal } : {}) })
    // `fetch` resolves for every status: the status first, then a body.
    if (res.ok) {
      let body = null
      try { body = await res.json() } catch { body = null }
      return { status: res.status, body }
    }
    return { status: res.status, body: null }
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * §2: `GET /v1/path` on each inside address in parallel, 1.5 s, the first
 * answer kept; then the outside address, where the route is 404 and any
 * answer at all means the outside door was reached. Resolves
 * `{ door: 'inside'|'outside', base, gatewayId }` or null when nothing
 * answered. A gateway row is the view's: { id, inside_addresses: [{ host,
 * port }], outside_address: { host, port }|null }.
 */
export async function probeGateway(gateway, { fetchImpl = globalThis.fetch, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  if (!gateway || typeof fetchImpl !== 'function') return null
  const inside = Array.isArray(gateway.inside_addresses) ? gateway.inside_addresses.filter((a) => a && a.host) : []
  if (inside.length) {
    const found = await new Promise((resolve) => {
      let left = inside.length
      let done = false
      for (const a of inside) {
        const base = doorBase(a.host, a.port)
        fetchPath(base, { fetchImpl, timeoutMs }).then((r) => {
          if (done) return
          if (r && r.status === 200 && r.body && r.body.path === 'inside') {
            done = true
            resolve({ door: 'inside', base, gatewayId: typeof r.body.gateway_id === 'string' ? r.body.gateway_id : gateway.id })
          } else if (--left === 0) resolve(null)
        })
      }
    })
    if (found) return found
  }
  const out = gateway.outside_address
  if (out && out.host) {
    const base = doorBase(out.host, out.port)
    const r = await fetchPath(base, { fetchImpl, timeoutMs })
    // Any HTTP answer from the outside address is the outside door (its
    // /v1/path is 404 by design); a 200 naming itself inside is a forwarded
    // inside port, which the viewer still reached from outside.
    if (r) return { door: 'outside', base, gatewayId: gateway.id }
  }
  return null
}

/**
 * §5 step 7: `POST /v1/clips/<id>/renew` with the stream's first ticket's
 * `jti` and a fresh ticket; 204 extends the stream's life so the <video>'s
 * URL never changes. `{ ok, status }`; status 0 when nothing answered.
 */
export async function renewStream(base, id, { jti, ticket }, { fetchImpl = globalThis.fetch } = {}) {
  try {
    const res = await fetchImpl(`${base}/v1/clips/${id}/renew`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jti, t: ticket }),
      cache: 'no-store',
    })
    return { ok: res.status === 204, status: res.status }
  } catch {
    return { ok: false, status: 0 }
  }
}

/**
 * A HEAD on the clip with a ticket: the status a <video> cannot read (401 a
 * ticket failure, 404 the clip is not there, 415 the type, 429 the limits),
 * and the door the response names. `{ status, door }`; status 0 when
 * nothing answered.
 */
export async function headClip(base, id, ticket, { fetchImpl = globalThis.fetch } = {}) {
  try {
    const res = await fetchImpl(clipUrl(base, id, ticket), { method: 'HEAD', cache: 'no-store' })
    const door = typeof res.headers?.get === 'function' ? res.headers.get('wilson-gateway-path') : null
    return { status: res.status, door: door || null }
  } catch {
    return { status: 0, door: null }
  }
}

/**
 * A ticket call to a same-origin path (the dev fixtures' Playwright mode:
 * /__fake-cloud/gateway-ticket, fulfilled by the test from the fake cloud).
 * Here, not in the fixtures, because nothing under src/dev may reach the
 * network itself. `res.ok` before any body.
 */
export async function postTicketRequest(path, body, { fetchImpl = globalThis.fetch } = {}) {
  let res
  try {
    res = await fetchImpl(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' })
  } catch {
    return { ok: false, status: 0, code: 'network', friendly: 'The ticket call did not reach its cloud.' }
  }
  if (!res.ok) return { ok: false, status: res.status, code: `http_${res.status}`, friendly: `The cloud refused the tickets (${res.status}).` }
  let json = null
  try { json = await res.json() } catch { json = null }
  if (!json || typeof json.tickets !== 'object') return { ok: false, status: res.status, code: 'bad_answer', friendly: 'The cloud answered the ticket request in an unknown shape.' }
  return { ok: true, status: res.status, data: { tickets: json.tickets || {}, missing: json.missing || [], refused: json.refused || [], expires_at: json.expires_at || null } }
}

/** The production doors: the gateway's own, over the page's fetch. */
export const realGatewayDoors = Object.freeze({
  probe: (gateway, opts) => probeGateway(gateway, opts),
  clipUrl,
  renew: (base, id, body, opts) => renewStream(base, id, body, opts),
  head: (base, id, ticket, opts) => headClip(base, id, ticket, opts),
})
