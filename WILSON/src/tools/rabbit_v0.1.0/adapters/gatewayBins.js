// ============================================================
// RABBIT — Bins in a BROWSER, through the company's file gateway (GW3)
// ============================================================
//
// GATEWAY_DESIGN.md §2 ("How the web app learns the address"), §5 (every
// read's checks, the browser's side), §7 (playback). Audrey's G2–G8, D1,
// D5, D17, D20, D22; BC3's seam ("the capability object").
//
// A browser signed in to a company is a COMPOSITE, as the desktop signed in
// is (adapters/desktopCloudBins.js over the desktop's file process): the
// bins' DATA is the cloud's (the four 0091 tables, through supabaseAdapter,
// or the dev fixtures in its slot), and the BYTES come from a gateway the
// browser reached — a small program on a computer in the company's office,
// found through the view `gateways_visible` and probed at its doors. Nothing
// is copied; the browser plays a clip where it is.
//
// What it is: Object.create(cloud) — every cloud method stays (lists,
// writes, takes, locations, the switch, the posters signed per read) —
// plus:
//
//   discover / refreshGateways   the view read (at a load, then every 60 s
//                                while the Bins tab is open), each gateway
//                                probed once per page session (`doors.probe`:
//                                the inside addresses in parallel, 1.5 s,
//                                then the outside address); the first answer
//                                is kept — the browser knows which door it
//                                reached by which address answered
//   binsCapabilities             `stream: true` once a door answered,
//                                `resolveFiles: true` (the rows' `online` is
//                                this composite's word), no picking, no OS
//   listBins / markOnline        the cloud's rows, `online` from the reach a
//                                reached gateway reports for each clip's
//                                location (§5's last paragraph): no per-clip
//                                round trip before play; a thousand clips cost
//                                the gateway nothing until one is opened
//   locationStatus / summary     the words per location (not reachable through
//                                the gateway, not mounted, run share-login, this
//                                gateway cannot use this address) and the
//                                tab's state (no gateway, not seen for over
//                                30 s, seen but unreachable from this browser,
//                                reached), §2's table
//   ensureTickets                gateway-ticket, at most fifty ids a call, on
//                                hover for a tile and in a batch for a shot's
//                                takes and a played selection (R12: never fifty
//                                at once when the grid mounts)
//   binFileStreamUrl             https://<door>/v1/clips/<id>?t=<ticket> while a
//                                ticket for the clip is held; null until then
//                                (the caller asks ensureTickets and re-reads)
//   renewStream                  §5 step 7: a fresh ticket posted with the
//                                stream's jti; the URL never changes
//   freshStreamUrl               a 401 is never retried with the same ticket:
//                                a fresh one, a new src at the same currentTime
//   diagnoseClip                 a HEAD on a fresh ticket says what a <video>
//                                cannot: 404 (the row flips to "missing at its
//                                location"), 401, 415, 429
//
// D20: the desktop app signed in never comes here (its own composite reads
// files directly); D17: with several gateways, a clip plays through one that
// reports its location reachable. Every call through `fetch` reads `res.ok`
// before the body (the doors module, gatewayApi.js). `now` and every network
// hand are injected, so the tests fake them.

import { TICKET_BATCH_MAX, ticketClaims, ticketExpiresAt } from '../bins/gatewayDoors'

// The composite's capability object: the keys every backend answers
// (binsAdapterParity.test.js). `stream` is answered per page session, once a
// door has: before that the object is the cloud's own catalogue.
export const GATEWAY_BINS_CAPABILITIES = Object.freeze({
  backend: 'gateway_cloud',
  pickFiles: false,
  probe: false,
  stream: false,
  resolveFiles: false,
  relink: false,
  openInOs: false,
  posters: 'cloud',
  locations: true,
  remoteViewingSwitch: true,
})

/** §2: the view is read again every 60 s while the Bins tab is open. */
export const GATEWAY_REFRESH_MS = 60_000
/** §2's second row: a gateway not seen by the cloud for over 30 s has stopped. */
export const UNSEEN_AFTER_MS = 30_000
/** A held ticket is reused only while its end is further off than this. */
export const TICKET_REUSE_MARGIN_MS = 30_000
/** A clip the cloud answered `missing` for, or refused, is not asked about again for this long. */
export const MISSING_BACKOFF_MS = 60_000
const FAILED_BACKOFF_MS = 15_000

/**
 * The composite. `cloud` is the cloud adapter (supabaseAdapter or the dev
 * fixtures in its slot). Dependencies, all injected:
 *   listGateways()                 → { ok, data: [the view's rows] }
 *   fetchTickets(gatewayId, ids)   → { ok, data: { tickets, missing, refused, expires_at } }
 *   doors                          { probe(gateway), clipUrl(base, id, ticket), renew(base, id, { jti, ticket }), head(base, id, ticket) }
 *   rowOf(id)                      a clip row from the provider's state
 *   onChange()                     called when the doors, the capabilities or the tickets changed (the provider re-reads)
 *   now()                          the clock
 */
export function composeGatewayBins(cloud, {
  listGateways, fetchTickets, doors, rowOf = () => null, onChange = () => {}, now = Date.now, log = () => {},
} = {}) {
  if (!cloud) throw new Error('composeGatewayBins needs the cloud adapter')
  if (typeof listGateways !== 'function' || typeof fetchTickets !== 'function' || !doors) throw new Error('composeGatewayBins needs listGateways, fetchTickets and the doors')
  const c = Object.create(cloud)

  const S = {
    gateways: [],
    reached: new Map(), // gateway id → { door, base, gatewayId }
    failed: new Map(), // gateway id → when the last probe found nothing
    readAt: 0,
    readError: null,
    probing: false,
    probedOnce: false,
    discovering: null,
    tickets: new Map(), // clip id → { ticket, exp, gatewayId }
    inflight: new Map(), // clip id → the batch's promise
    missing: new Map(), // clip id → until
    refused: new Map(), // clip id → reason
    ticketError: null, // the last failed call's sentence (the tab's)
    ticketErrors: new Map(), // clip id → the sentence of its own last failed ticket call or renewal
    marginTimers: new Map(), // clip id → the timer that re-reads the tab when its held ticket reaches the margin
  }
  let caps = GATEWAY_BINS_CAPABILITIES
  // `stream` AND `resolveFiles` turn on together: until a door answered, the
  // composite cannot say what this browser reaches, and the tab keeps BC3's
  // catalogue (every row "not on this computer", no dim, no count); once one
  // has, each row's `online` is its word and the dim and the counts return.
  const refreshCaps = () => {
    const reached = S.reached.size > 0
    if (caps.stream !== reached) caps = Object.freeze({ ...GATEWAY_BINS_CAPABILITIES, stream: reached, resolveFiles: reached })
  }

  // ── Which gateway serves a location (D17) ──
  const gatewayFor = (locationId) => {
    if (!locationId) return null
    for (const g of S.gateways) {
      const r = S.reached.get(g.id)
      if (r && g.reach && g.reach[locationId] === 'reachable') return { gateway: g, ...r }
    }
    return null
  }
  const reachState = (locationId) => {
    if (!S.gateways.length) return 'no_gateway'
    const reached = S.gateways.filter((g) => S.reached.has(g.id))
    if (!reached.length) return S.gateways.every((g) => unseen(g)) ? 'unseen' : 'gateway_unreachable'
    const states = reached.map((g) => (g.reach ? g.reach[locationId] : undefined))
    if (states.includes('reachable')) return 'reachable'
    return states.find((s) => typeof s === 'string') || 'unknown_address'
  }
  const unseen = (g) => {
    const t = Date.parse(g?.last_seen_at)
    return !Number.isFinite(t) || now() - t > UNSEEN_AFTER_MS
  }
  const online = (row) => !!(row && row.location_id && gatewayFor(row.location_id))

  c.binsCapabilities = () => caps

  // ── Discovery (§2) ──
  async function readGateways() {
    let res
    try { res = await listGateways() } catch (e) { res = { ok: false, friendly: String(e?.message || e) } }
    if (!res || !res.ok) { S.readError = res?.friendly || 'the gateway list could not be read'; return }
    S.readError = null
    S.gateways = Array.isArray(res.data) ? res.data.filter((g) => g && g.id) : []
    S.readAt = now()
    // A gateway gone from the list (forgotten, or its fingerprint no longer confirmed) loses its door.
    for (const id of [...S.reached.keys()]) if (!S.gateways.some((g) => g.id === id)) S.reached.delete(id)
  }
  async function probeAll() {
    const todo = S.gateways.filter((g) => !S.reached.has(g.id))
    // Nothing to probe (no gateway enrolled, or the view unreadable) still
    // ENDS the first probe: the tab's state is then 'none', never 'probing'
    // for good (listBins raises `probing` for the first discovery).
    if (!todo.length) { S.probing = false; S.probedOnce = true; return }
    S.probing = true
    try {
      await Promise.all(todo.map(async (g) => {
        let r = null
        try { r = await doors.probe(g) } catch (e) { log('gateway_probe_failed', { id: g.id, message: String(e?.message || e) }); r = null }
        if (r && r.base) S.reached.set(g.id, { door: r.door === 'outside' ? 'outside' : 'inside', base: r.base, gatewayId: r.gatewayId || g.id })
        else S.failed.set(g.id, now())
      }))
    } finally {
      S.probing = false
      S.probedOnce = true
    }
  }
  c.discover = () => {
    if (S.discovering) return S.discovering
    S.discovering = (async () => {
      try {
        await readGateways()
        await probeAll()
      } finally {
        S.discovering = null
        refreshCaps()
        try { onChange() } catch { /* the caller's */ }
      }
    })()
    return S.discovering
  }
  /** §2: every 60 s while the Bins tab is open (the caller's timer). */
  c.refreshGateways = () => c.discover()

  // ── The rows' online, the locations' words, the tab's state ──
  c.markOnline = (rows) => (rows || []).map((r) => (r && r.location_id ? { ...r, online: online(r) } : r))
  c.resolveBinFiles = async (rows) => {
    const out = new Map()
    for (const r of rows || []) {
      if (!r || !r.id || !r.location_id) continue
      out.set(r.id, online(r) ? { online: true } : { online: false, reason: reachState(r.location_id) })
    }
    return out
  }
  c.locationStatus = (locations) => (locations || []).filter((l) => l && l.id).map((l) => {
    const via = gatewayFor(l.id)
    return {
      id: l.id,
      status: 'gateway',
      reachable: !!via,
      gateway: reachState(l.id),
      gateway_name: via ? via.gateway.name : (S.gateways.find((g) => S.reached.has(g.id))?.name ?? null),
      door: via ? via.door : null,
    }
  })
  c.summary = () => {
    const reached = S.gateways.filter((g) => S.reached.has(g.id)).map((g) => ({ id: g.id, name: g.name, door: S.reached.get(g.id).door, base: S.reached.get(g.id).base }))
    let state = 'none'
    if (S.probing && !S.probedOnce) state = 'probing'
    else if (reached.length) state = 'reached'
    else if (S.gateways.length) state = S.gateways.every(unseen) ? 'unseen' : 'unreachable'
    const first = S.gateways.find((g) => !unseen(g)) || S.gateways[0] || null
    const address = first ? (first.inside_addresses?.[0] ? `${first.inside_addresses[0].host}:${first.inside_addresses[0].port}` : (first.outside_address ? `${first.outside_address.host}:${first.outside_address.port}` : null)) : null
    const seen = first ? Date.parse(first.last_seen_at) : NaN
    return {
      state,
      gateways: S.gateways.map((g) => ({ id: g.id, name: g.name, platform: g.platform, version: g.version, last_seen_at: g.last_seen_at })),
      reached,
      name: first?.name ?? null,
      address,
      unseenSeconds: Number.isFinite(seen) ? Math.max(0, Math.round((now() - seen) / 1000)) : null,
      probing: S.probing,
      probedOnce: S.probedOnce,
      readError: S.readError,
      ticketError: S.ticketError,
      // The player's renewal interval, when the doors name one (only the dev
      // fixtures' Playwright mode does; the production doors never): null
      // leaves the design's 75 s.
      renewAfterMs: doors && doors.real && Number(doors.real.renewAfterMs) > 0 ? Number(doors.real.renewAfterMs) : null,
    }
  }

  c.listBins = async (projectId) => {
    const data = await cloud.listBins(projectId)
    // The FIRST discovery of a page session runs behind the rows: the tab
    // shows the catalogue at once with the Chrome local-network sentence
    // above the probe (§2), and the rows take their marks when the doors
    // answer (onChange). Every later load has the doors already, and the
    // view's re-read is awaited so the rows land marked.
    const discovery = c.discover()
    if (S.probedOnce) {
      try { await discovery } catch (e) { log('gateway_discover_failed', { message: String(e?.message || e) }) }
    } else {
      discovery.catch((e) => log('gateway_discover_failed', { message: String(e?.message || e) }))
      S.probing = true
    }
    return {
      ...data,
      binFiles: c.markOnline(data.binFiles || []),
      ffmpeg: false,
      capabilities: caps,
      locationStatus: c.locationStatus(data.binLocations || []),
      gateway: c.summary(),
    }
  }
  // Rows that come back from the cloud without `online` (a copy, an undo's
  // restore) are marked before they reach state.
  c.copyBinFiles = async (projectId, ids, binId) => {
    const res = await cloud.copyBinFiles(projectId, ids, binId)
    return { ...res, created: c.markOnline(res?.created || []) }
  }
  c.restoreBinFiles = async (projectId, rows) => {
    const res = await cloud.restoreBinFiles(projectId, rows)
    return { ...res, restored: c.markOnline(res?.restored || []) }
  }

  // ── Tickets (§5 steps 1–4; R12) ──
  const held = (id) => {
    const t = S.tickets.get(id)
    return t && t.exp - TICKET_REUSE_MARGIN_MS > now() ? t : null
  }
  const wanted = (id) => {
    const row = rowOf(id)
    if (!row || !row.location_id || !online(row)) return false
    if (held(id) || S.inflight.has(id)) return false
    const until = S.missing.get(id)
    return !(until && until > now())
  }
  c.ensureTickets = async (ids) => {
    const want = [...new Set((ids || []).filter(Boolean))].filter(wanted)
    if (!want.length) return
    const groups = new Map()
    for (const id of want) {
      const via = gatewayFor(rowOf(id).location_id)
      if (!via) continue
      if (!groups.has(via.gateway.id)) groups.set(via.gateway.id, [])
      groups.get(via.gateway.id).push(id)
    }
    await Promise.all([...groups].map(async ([gatewayId, list]) => {
      for (let i = 0; i < list.length; i += TICKET_BATCH_MAX) {
        const batch = list.slice(i, i + TICKET_BATCH_MAX)
        const p = Promise.resolve().then(() => fetchTickets(gatewayId, batch)).then((res) => {
          if (!res || !res.ok) {
            S.ticketError = res?.friendly || 'the cloud did not answer'
            for (const id of batch) { S.missing.set(id, now() + FAILED_BACKOFF_MS); S.ticketErrors.set(id, S.ticketError) }
            return
          }
          S.ticketError = null
          for (const id of batch) S.ticketErrors.delete(id)
          const d = res.data || {}
          const fallbackExp = Date.parse(d.expires_at) || (now() + 120_000)
          for (const [id, t] of Object.entries(d.tickets || {})) {
            if (!batch.includes(id) || typeof t !== 'string') continue
            S.tickets.set(id, { ticket: t, exp: ticketExpiresAt(t) || fallbackExp, gatewayId })
            S.missing.delete(id)
            S.refused.delete(id)
          }
          for (const id of d.missing || []) S.missing.set(id, now() + MISSING_BACKOFF_MS)
          for (const r of d.refused || []) { S.refused.set(r.id, r.reason || 'refused'); S.missing.set(r.id, now() + MISSING_BACKOFF_MS) }
        }).catch((e) => {
          S.ticketError = String(e?.message || e)
          for (const id of batch) { S.missing.set(id, now() + FAILED_BACKOFF_MS); S.ticketErrors.set(id, S.ticketError) }
        }).finally(() => { for (const id of batch) S.inflight.delete(id) })
        for (const id of batch) S.inflight.set(id, p)
        await p
      }
    }))
    try { onChange() } catch { /* the caller's */ }
  }

  c.binFileStreamUrl = (_projectId, id) => {
    const row = rowOf(id)
    if (!row || !row.location_id || row.online === false) return null
    const via = gatewayFor(row.location_id)
    if (!via) return null
    const t = held(id)
    if (!t || t.gatewayId !== via.gateway.id) return null
    return doors.clipUrl(via.base, id, t.ticket)
  }
  /** What the player needs beside the URL: the door (the overlay's cue), the stream's jti, the ticket's end, a refusal. */
  c.streamInfo = (id) => {
    const row = rowOf(id)
    const via = row && row.location_id ? gatewayFor(row.location_id) : null
    const t = S.tickets.get(id) || null
    const until = S.missing.get(id)
    return {
      door: via ? via.door : null,
      base: via ? via.base : null,
      gatewayId: via ? via.gateway.id : null,
      gatewayName: via ? via.gateway.name : null,
      jti: t ? (ticketClaims(t.ticket)?.jti ?? null) : null,
      expiresAt: t ? t.exp : null,
      held: !!held(id),
      refused: S.refused.get(id) || null,
      missing: !!(until && until > now() && !S.refused.has(id)),
      pending: S.inflight.has(id),
      // This clip's own last failure (never another clip's: a stale error
      // from a hovered tile must not flash over a clip about to load).
      ticketError: S.ticketErrors.get(id) || null,
    }
  }
  /**
   * A stream whose renewal failed keeps its URL only until its held
   * ticket reaches the margin; the tab is re-read at that moment (not at
   * whatever re-render comes next), so the player drops the URL, a fresh
   * ticket is asked for, and the cloud's answer is either a new URL (the
   * player resumes where it was) or the refusal's sentence. Without this a
   * fully buffered clip would play on long after the viewer was removed.
   */
  const reReadAtMargin = (id, exp) => {
    if (S.marginTimers.has(id) || !Number.isFinite(exp)) return
    const wait = Math.max(0, exp - TICKET_REUSE_MARGIN_MS - now()) + 50
    S.marginTimers.set(id, setTimeout(() => {
      S.marginTimers.delete(id)
      try { onChange() } catch { /* the caller's */ }
    }, wait))
  }
  c.invalidateTicket = (id) => { S.tickets.delete(id) }
  /** A 401 is never retried with the same ticket: a fresh one, then a new src at the same currentTime (§5 step 7). */
  c.freshStreamUrl = async (id) => {
    S.tickets.delete(id)
    S.missing.delete(id)
    await c.ensureTickets([id])
    return c.binFileStreamUrl(null, id)
  }
  /** §5 step 7: the fresh ticket posted with the stream's first jti; the URL stays. */
  c.renewStream = async (id) => {
    const row = rowOf(id)
    const via = row && row.location_id ? gatewayFor(row.location_id) : null
    const cur = S.tickets.get(id)
    if (!via || !cur) return { ok: false, status: 0, reason: 'no_stream' }
    const jti = ticketClaims(cur.ticket)?.jti
    if (!jti) return { ok: false, status: 0, reason: 'no_jti' }
    let res
    try { res = await fetchTickets(via.gateway.id, [id]) } catch { res = null }
    const fresh = res && res.ok ? res.data?.tickets?.[id] : null
    if (!fresh) {
      const why = res?.friendly || 'the cloud did not answer'
      S.ticketError = why
      S.ticketErrors.set(id, why)
      reReadAtMargin(id, cur.exp)
      return { ok: false, status: res?.status || 0, reason: 'ticket' }
    }
    const r = await doors.renew(via.base, id, { jti, ticket: fresh })
    if (r && r.ok) {
      // The stream's authority is re-anchored to the fresh ticket's end; the
      // URL keeps the first ticket, which the door reads by its jti now.
      S.tickets.set(id, { ...cur, exp: ticketExpiresAt(fresh) || (now() + 120_000), fresh })
      S.ticketErrors.delete(id)
      return { ok: true, status: r.status }
    }
    reReadAtMargin(id, cur.exp)
    return { ok: false, status: r?.status || 0, reason: 'refused' }
  }
  /**
   * What a <video> could not say: a HEAD on a fresh ticket. 'ok' | 'missing'
   * (404: the clip is not at its path, or the catalogue does not confirm it) |
   * 'ticket' (401) | 'format' (415) | 'busy' (429) | 'unreachable' (nothing
   * answered) | 'no_stream' (no door, no ticket).
   */
  c.diagnoseClip = async (id) => {
    const row = rowOf(id)
    const via = row && row.location_id ? gatewayFor(row.location_id) : null
    if (!via) return { verdict: 'no_stream', status: 0 }
    S.tickets.delete(id)
    S.missing.delete(id)
    await c.ensureTickets([id])
    const t = S.tickets.get(id)
    if (!t) {
      // No fresh ticket. The cloud refused one (the viewer removed or signed
      // out, the switch off: the renewal had already failed the same way) or
      // did not answer: the TICKET is the failure, said as such, never the
      // clip; a format the cloud refuses is the format; a clip the cloud
      // does not know plays through nothing.
      if (S.refused.has(id)) return { verdict: 'format', status: 0 }
      return { verdict: S.ticketErrors.has(id) ? 'ticket' : 'no_stream', status: 0 }
    }
    const r = await doors.head(via.base, id, t.ticket)
    const verdict = r.status === 0 ? 'unreachable'
      : r.status === 404 ? 'missing'
        : r.status === 401 ? 'ticket'
          : r.status === 415 ? 'format'
            : r.status === 429 ? 'busy'
              : r.status >= 200 && r.status < 300 ? 'ok' : 'unreachable'
    if (verdict === 'ticket') S.tickets.delete(id)
    return { verdict, status: r.status, door: r.door || via.door }
  }

  // Nothing here reads a file: the cloud's refusals stand for picking, probing, the OS and relinking.
  return c
}
