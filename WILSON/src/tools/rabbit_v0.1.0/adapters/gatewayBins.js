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
//                                probed until a door answers (`doors.probe`:
//                                the inside addresses in parallel, 1.5 s,
//                                then the outside address); the first answer
//                                is kept — the browser knows which door it
//                                reached by which address answered — until a
//                                HEAD finds nobody there or the address
//                                leaves the view: then it is probed again
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
//   diagnoseClip                 a HEAD says what a <video> cannot, with the
//                                element's own ticket first (its 401 is the
//                                ticket: the one fresh src) and a fresh one
//                                only without: 404 (the row flips to "not at
//                                its path"), 401, 415, 429, nothing at all
//                                (the door is dropped and probed again)
//   dispose                      everything let go (a sign-out, another person)
//
// D20: the desktop app signed in never comes here (its own composite reads
// files directly); D17: with several gateways, a clip plays through one that
// reports its location reachable. Every call through `fetch` reads `res.ok`
// before the body (the doors module, gatewayApi.js). `now` and every network
// hand are injected, so the tests fake them.

import { TICKET_BATCH_MAX, ticketClaims, doorBase } from '../bins/gatewayDoors'
import { GATEWAY_REFUSED_FRESH_TICKET } from '../bins/binLocations'

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
const TICKET_REUSE_MARGIN_MS = 30_000
/** A clip the cloud answered `missing` for, or refused, is not asked about again for this long. */
const MISSING_BACKOFF_MS = 60_000
const FAILED_BACKOFF_MS = 15_000
/** A ticket's life (D1): the hold is anchored to the moment the browser received it, never to the cloud's clock. */
const TICKET_LIFETIME_MS = 120_000
/** Kept this long after its end, a lapsed ticket's URL still serves an idle player's resume (then dropped). */
const LAPSED_KEEP_MS = 30 * 60_000
/** The sentence when no ticket came, in WILSON's voice (gatewayApi's own). */
export const NO_TICKET = 'WILSON could not get a ticket to play this clip just now. Try again in a moment.'
/**
 * The door refused a ticket the cloud had JUST minted (review round 2,
 * finding 1): a fresh one will not fare better (the switch turned off while
 * someone outside plays, a gateway whose clock or keys are off), so the clip
 * is backed off a minute and this is said, never another mint at once.
 */
export const DOOR_REFUSED_FRESH = GATEWAY_REFUSED_FRESH_TICKET
/** A refusal that holds for the clip (its format, its path's length); any other reason is "just now" and lapses with its back-off (round 2, note 9). */
const PERMANENT_REFUSALS = new Set(['not_playable', 'too_long'])
/** Two players on one stream renew it once: a renewal this recent covers the other's turn (round 2, note 13). */
const RENEW_SHARED_MS = 30_000

/**
 * The composite. `cloud` is the cloud adapter (supabaseAdapter or the dev
 * fixtures in its slot). Dependencies, all injected:
 *   listGateways()                 → { ok, data: [the view's rows] }
 *   fetchTickets(gatewayId, ids)   → { ok, data: { tickets, missing, refused, expires_at } }
 *   doors                          { probe(gateway), clipUrl(base, id, ticket), renew(base, id, { jti, ticket }), head(base, id, ticket) }
 *   rowOf(id)                      a clip row from the provider's state
 *   onChange()                     called when the doors, the capabilities or the tickets changed (the provider re-reads)
 *   now()                          the clock
 *   userId()                       the signed-in person: a ticket minted for anyone else is never used (review round 1, finding 1)
 */
export function composeGatewayBins(cloud, {
  listGateways, fetchTickets, doors, rowOf = () => null, onChange = () => {}, now = Date.now, log = () => {}, userId = null,
} = {}) {
  if (!cloud) throw new Error('composeGatewayBins needs the cloud adapter')
  if (typeof listGateways !== 'function' || typeof fetchTickets !== 'function' || !doors) throw new Error('composeGatewayBins needs listGateways, fetchTickets and the doors')
  const c = Object.create(cloud)

  const S = {
    gateways: [],
    reached: new Map(), // gateway id → { door, base, gatewayId }
    renewFailed: new Set(), // clip ids whose stream's renewal failed: their URL ends at the margin
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
    renewing: new Map(), // clip id → the renewal in flight (two players on one stream share it)
    doorRefused: new Map(), // clip id → until when the door's refusal of a fresh ticket stands (no fresh src meanwhile)
    renewedAt: new Map(), // clip id → when its stream was last renewed
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
  // P8 (0104, TPN-AUTH-012): a clip plays through the gateway only once an
  // admin or manager has checked its path (vetted_at): the cloud confirms
  // and mints for checked rows alone, so an unchecked row is offline here
  // with its own reason, and no ticket is ever asked for it.
  const online = (row) => !!(row && row.location_id && row.vetted_at && gatewayFor(row.location_id))

  c.binsCapabilities = () => caps

  // ── Discovery (§2) ──
  async function readGateways() {
    let res
    try { res = await listGateways() } catch (e) { res = { ok: false, friendly: String(e?.message || e) } }
    if (!res || !res.ok) { S.readError = res?.friendly || 'the gateway list could not be read'; return }
    S.readError = null
    S.gateways = Array.isArray(res.data) ? res.data.filter((g) => g && g.id) : []
    S.readAt = now()
    // A gateway gone from the list (forgotten, or its fingerprint no longer
    // confirmed) loses its door; so does one whose answering address is no
    // longer among its addresses (a new DHCP lease, the outside address
    // withdrawn): it is probed again below (review round 1, finding 8).
    for (const [id, r] of [...S.reached]) {
      const g = S.gateways.find((x) => x.id === id)
      if (!g || !basesOf(g).includes(r.base)) dropDoor(id)
    }
  }
  function basesOf(g) {
    const doors = (list) => (Array.isArray(list) ? list.filter((a) => a && a.host).map((a) => doorBase(a.host, a.port)) : [])
    // P8 (TPN-ENC-013): the names before the addresses, as the probe tries them.
    const inside = [...doors(g.inside_names), ...doors(g.inside_addresses)]
    const out = g.outside_address && g.outside_address.host ? [doorBase(g.outside_address.host, g.outside_address.port)] : []
    return [...inside, ...out]
  }
  /** A door no longer believed: its held tickets go with it (minted for it, useless elsewhere). */
  function dropDoor(gatewayId) {
    S.reached.delete(gatewayId)
    for (const [id, t] of [...S.tickets]) if (t.gatewayId === gatewayId) S.tickets.delete(id)
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
  // A row the gateway answered 404 for stays "not at its path" until the
  // rows are read again from the cloud (which drops the flag): the reach
  // report is per location and cannot vouch for one clip (round 1, finding 5).
  c.markOnline = (rows) => (rows || []).map((r) => (r && r.location_id
    ? { ...r, online: r.gateway_missing ? false : online(r), ...(r.vetted_at ? {} : { not_checked: true }) }
    : r))
  c.resolveBinFiles = async (rows) => {
    const out = new Map()
    for (const r of rows || []) {
      if (!r || !r.id || !r.location_id) continue
      out.set(r.id, online(r) ? { online: true } : { online: false, reason: r.vetted_at ? reachState(r.location_id) : 'not_checked' })
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
    // P8 (TPN-ENC-013): the first name before the first address, as the probe tries them.
    const door = first ? (first.inside_names?.[0] || first.inside_addresses?.[0] || first.outside_address || null) : null
    const address = door && door.host ? `${door.host}:${door.port}` : null
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
  // A ticket's hold: from the moment the browser received it, for the
  // ticket's own life (exp − iat, at most two minutes), less the 30 s
  // margin. Never the cloud's absolute `exp` against this browser's clock:
  // a clock minutes ahead would hold nothing and mint at network speed, one
  // minutes behind would keep a URL the gateway already refuses (round 1,
  // finding 2). A ticket without `iat` is given the design's life from
  // receipt (D1), never its `exp` against this clock either (round 2, note
  // 18b); and a ticket whose life is shorter than twice the margin is held
  // for half its life, not for nothing (note 18a: every ask would mint).
  const lifeOf = (ticket) => {
    const cl = ticketClaims(ticket)
    if (cl && Number.isFinite(cl.exp) && Number.isFinite(cl.iat)) return Math.max(0, Math.min(TICKET_LIFETIME_MS, (cl.exp - cl.iat) * 1000))
    return TICKET_LIFETIME_MS
  }
  const marginOf = (life) => Math.min(TICKET_REUSE_MARGIN_MS, life / 2)
  /** A ticket as held: received now, for its life; `born` and `life` stay the URL's ticket's through renewals. */
  const entryOf = (ticket, gatewayId) => {
    const life = lifeOf(ticket)
    const at = now()
    return { ticket, gatewayId, sub: subOf(ticket), born: at, life, exp: at + life, margin: marginOf(life) }
  }
  const marginOfEntry = (t) => (Number.isFinite(t?.margin) ? t.margin : TICKET_REUSE_MARGIN_MS)
  /** The URL's own ticket is still inside its first hold: a refusal of it is the door's, not its age (round 2, finding 1). */
  const young = (t) => !!t && Number.isFinite(t.born) && Number.isFinite(t.life) && t.born + t.life - marginOfEntry(t) > now()
  const subOf = (ticket) => {
    const s = ticketClaims(ticket)?.sub
    return typeof s === 'string' ? s : null
  }
  /**
   * A ticket minted for someone other than the signed-in person is never used
   * (round 1, finding 1); nor one that names a person while the signed-in one
   * is not known yet (round 2, note 18c): it is held, and used once the
   * person is known and is the one it names. With no `userId` given (the
   * tests' worlds) there is no person to check against.
   */
  const mine = (t) => {
    if (!t) return false
    if (typeof userId !== 'function') return true
    if (!t.sub) return true
    const me = userId()
    return !!me && t.sub === me
  }
  /** A refusal still standing: a permanent one, or a "just now" one inside its back-off (round 2, note 9). */
  const refusedOf = (id) => {
    const r = S.refused.get(id)
    if (!r) return null
    if (PERMANENT_REFUSALS.has(r)) return r
    const until = S.missing.get(id)
    if (until && until > now()) return r
    S.refused.delete(id)
    return null
  }
  const held = (id) => {
    const t = S.tickets.get(id)
    return t && mine(t) && t.exp - marginOfEntry(t) > now() ? t : null
  }
  const wanted = (id) => {
    const row = rowOf(id)
    if (!row || !row.location_id || row.gateway_missing || !online(row)) return false
    if (held(id) || S.inflight.has(id)) return false
    const until = S.missing.get(id)
    return !(until && until > now())
  }
  const prune = () => {
    for (const [id, t] of [...S.tickets]) if (t.exp + LAPSED_KEEP_MS < now() || !mine(t)) S.tickets.delete(id)
  }
  c.ensureTickets = async (ids) => {
    prune()
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
            S.ticketError = res?.friendly || NO_TICKET
            for (const id of batch) { S.missing.set(id, now() + FAILED_BACKOFF_MS); S.ticketErrors.set(id, S.ticketError) }
            return
          }
          S.ticketError = null
          for (const id of batch) S.ticketErrors.delete(id)
          const d = res.data || {}
          const answered = new Set()
          for (const [id, t] of Object.entries(d.tickets || {})) {
            if (!batch.includes(id) || typeof t !== 'string') continue
            S.tickets.set(id, entryOf(t, gatewayId))
            S.doorRefused.delete(id)
            S.missing.delete(id)
            S.refused.delete(id)
            S.renewFailed.delete(id)
            answered.add(id)
          }
          for (const id of d.missing || []) { S.missing.set(id, now() + MISSING_BACKOFF_MS); answered.add(id) }
          for (const r of d.refused || []) { S.refused.set(r.id, r.reason || 'refused'); S.missing.set(r.id, now() + MISSING_BACKOFF_MS); answered.add(r.id) }
          // An id the answer names nowhere (a ticket the shape check dropped,
          // a cloud that skipped it) is backed off like a failed call, or the
          // tab would ask again at every re-render (round 1, finding 3).
          for (const id of batch) {
            if (answered.has(id)) continue
            S.missing.set(id, now() + FAILED_BACKOFF_MS)
            S.ticketErrors.set(id, NO_TICKET)
          }
        }).catch((e) => {
          S.ticketError = String(e?.message || e) || NO_TICKET
          for (const id of batch) { S.missing.set(id, now() + FAILED_BACKOFF_MS); S.ticketErrors.set(id, NO_TICKET) }
        }).finally(() => { for (const id of batch) S.inflight.delete(id) })
        for (const id of batch) S.inflight.set(id, p)
        await p
      }
    }))
    try { onChange() } catch { /* the caller's */ }
  }

  /** The URL of a ticket for this clip through the door that serves its location, or null. */
  const urlOf = (id, t) => {
    const row = rowOf(id)
    if (!row || !row.location_id || row.online === false) return null
    const via = gatewayFor(row.location_id)
    if (!via || !t || t.gatewayId !== via.gateway.id) return null
    return doors.clipUrl(via.base, id, t.ticket)
  }
  /** A held ticket's URL (a new use asks for a fresh ticket at the margin); never one whose renewal failed past it. */
  c.binFileStreamUrl = (_projectId, id) => {
    const t = held(id)
    return t ? urlOf(id, t) : null
  }
  /** What the player needs beside the URL: the door (the overlay's cue), the stream's jti, the ticket's end, a refusal. */
  c.streamInfo = (id) => {
    const row = rowOf(id)
    const via = row && row.location_id ? gatewayFor(row.location_id) : null
    const t = S.tickets.get(id) || null
    const until = S.missing.get(id)
    const isHeld = !!held(id)
    return {
      door: via ? via.door : null,
      base: via ? via.base : null,
      gatewayId: via ? via.gateway.id : null,
      gatewayName: via ? via.gateway.name : null,
      jti: t && mine(t) ? (ticketClaims(t.ticket)?.jti ?? null) : null,
      expiresAt: t ? t.exp : null,
      held: isHeld,
      // A player already showing this clip keeps the URL of a ticket that
      // lapsed while it sat idle (no renewal: it was not playing); played
      // again, the door's 401 is answered by one fresh src at the same moment.
      // A stream whose renewal FAILED has no such URL: it ends at the margin.
      lapsedUrl: !isHeld && t && mine(t) && !S.renewFailed.has(id) ? urlOf(id, t) : null,
      renewFailed: S.renewFailed.has(id),
      refused: refusedOf(id),
      missing: !!(until && until > now() && !refusedOf(id)),
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
  const reReadAtMargin = (id, exp, margin = TICKET_REUSE_MARGIN_MS) => {
    if (S.marginTimers.has(id) || !Number.isFinite(exp)) return
    const wait = Math.max(0, exp - margin - now()) + 50
    S.marginTimers.set(id, setTimeout(() => {
      S.marginTimers.delete(id)
      try { onChange() } catch { /* the caller's */ }
    }, wait))
  }
  c.invalidateTicket = (id) => { S.tickets.delete(id) }
  /** A 401 is never retried with the same ticket: a fresh one, then a new src at the same currentTime (§5 step 7). */
  c.freshStreamUrl = async (id) => {
    // Not while the door turns down fresh tickets for this clip (round 2,
    // finding 1): its minute stands, whatever else was backed off.
    const refusedUntil = S.doorRefused.get(id)
    if (refusedUntil && refusedUntil > now()) return null
    S.tickets.delete(id)
    S.missing.delete(id)
    await c.ensureTickets([id])
    return c.binFileStreamUrl(null, id)
  }
  /**
   * §5 step 7: the fresh ticket posted with the stream's first jti; the URL
   * stays. A failure backs the clip off (a refused cloud is asked again in
   * 15 s at the soonest, not at every 10 s retry: round 1, finding 7) and
   * ends the URL at the margin.
   */
  c.renewStream = (id) => {
    // Two players on one stream (the inspector's, Space's) renew it once: the
    // one in flight is shared, and one this recent covers the other's turn
    // (review round 2, note 13).
    if (S.renewing.has(id)) return S.renewing.get(id)
    const last = S.renewedAt.get(id)
    if (last && now() - last < RENEW_SHARED_MS && held(id)) return Promise.resolve({ ok: true, status: 204, shared: true })
    const p = renewOnce(id).finally(() => { S.renewing.delete(id) })
    S.renewing.set(id, p)
    return p
  }
  const renewOnce = async (id) => {
    const row = rowOf(id)
    const via = row && row.location_id ? gatewayFor(row.location_id) : null
    const cur = S.tickets.get(id)
    if (!via || !cur || !mine(cur)) return { ok: false, status: 0, reason: 'no_stream' }
    const jti = ticketClaims(cur.ticket)?.jti
    if (!jti) return { ok: false, status: 0, reason: 'no_jti' }
    const until = S.missing.get(id)
    if (until && until > now()) return { ok: false, status: 0, reason: 'backoff' }
    let res
    try { res = await fetchTickets(via.gateway.id, [id]) } catch { res = null }
    const fresh = res && res.ok ? res.data?.tickets?.[id] : null
    if (!fresh) {
      const why = res?.friendly || NO_TICKET
      S.ticketError = why
      S.ticketErrors.set(id, why)
      S.missing.set(id, now() + FAILED_BACKOFF_MS)
      S.renewFailed.add(id)
      reReadAtMargin(id, cur.exp, marginOfEntry(cur))
      return { ok: false, status: res?.status || 0, reason: 'ticket' }
    }
    const r = await doors.renew(via.base, id, { jti, ticket: fresh })
    if (r && r.ok) {
      // The stream's authority is re-anchored to the fresh ticket's life from
      // now; the URL keeps the first ticket (its `born` and `life` too), which
      // the door reads by its jti.
      const life = lifeOf(fresh)
      S.tickets.set(id, { ...cur, exp: now() + life, margin: marginOf(life), fresh })
      S.ticketErrors.delete(id)
      S.renewFailed.delete(id)
      S.renewedAt.set(id, now())
      return { ok: true, status: r.status }
    }
    // The door refused the renewal (its stream lapsed, or ended): the URL ends
    // at the margin; the player's next play is answered by a fresh ticket.
    // Backed off like the cloud's refusal, so the player's 10 s retry asks
    // nothing (round 2, note 10).
    S.missing.set(id, now() + FAILED_BACKOFF_MS)
    S.renewFailed.add(id)
    reReadAtMargin(id, cur.exp, marginOfEntry(cur))
    return { ok: false, status: r?.status || 0, reason: 'refused' }
  }
  const verdictOf = (status) => (status === 0 ? 'unreachable'
    : status === 404 ? 'missing'
      : status === 401 ? 'ticket'
        : status === 415 ? 'format'
          : status === 429 ? 'busy'
            : status >= 200 && status < 300 ? 'ok' : 'unreachable')
  /**
   * What a <video> could not say. First a HEAD with the ELEMENT's own ticket
   * (one request, a diagnosis, never a playback retry): its 401 is the ticket
   * — the player's one fresh src at the same moment follows — and its 2xx
   * means the door serves those bytes and the browser could not decode them
   * (round 1, finding 6). With no ticket of its own, a fresh one is asked
   * for and HEADed. 'ok' | 'missing' (404: not at its path, or the catalogue
   * does not confirm it) | 'ticket' (401) | 'format' (415) | 'busy' (429) |
   * 'unreachable' (nothing answered: the door is dropped and probed again,
   * round 1, finding 8) | 'refused' (the cloud refuses this clip a ticket:
   * `reason`) | 'no_stream' (no door, no ticket).
   */
  c.diagnoseClip = async (id) => {
    const row = rowOf(id)
    const via = row && row.location_id ? gatewayFor(row.location_id) : null
    if (!via) return { verdict: 'no_stream', status: 0 }
    const settle = (r, t) => {
      const verdict = verdictOf(r.status)
      if (verdict === 'ticket') {
        S.tickets.delete(id)
        // A ticket still inside its first hold refused: the door turns down
        // what the cloud just minted, and a fresh one fares no better. The
        // clip is backed off a minute and the refusal said: the one fresh src
        // is for a ticket that aged, never a loop of mints (round 2, finding 1).
        if (young(t)) {
          S.missing.set(id, now() + MISSING_BACKOFF_MS)
          S.doorRefused.set(id, now() + MISSING_BACKOFF_MS)
          S.ticketErrors.set(id, DOOR_REFUSED_FRESH)
          return { verdict: 'door_refused', status: r.status, door: r.door || via.door }
        }
      }
      if (verdict === 'missing') S.missing.set(id, now() + MISSING_BACKOFF_MS)
      if (verdict === 'unreachable') {
        dropDoor(via.gateway.id)
        refreshCaps()
        try { onChange() } catch { /* the caller's */ }
        Promise.resolve().then(() => c.discover()).catch(() => {})
      }
      return { verdict, status: r.status, door: r.door || via.door }
    }
    const cur = S.tickets.get(id)
    if (cur && mine(cur) && cur.gatewayId === via.gateway.id) {
      return settle(await doors.head(via.base, id, cur.ticket), cur)
    }
    S.tickets.delete(id)
    S.missing.delete(id)
    await c.ensureTickets([id])
    const t = S.tickets.get(id)
    if (!t) {
      // No ticket. The cloud refused this clip one (by its reason: the
      // format, a path too long, a ticket WILSON could not read), refused the
      // person (removed, signed out, the switch off: the ticket is the
      // failure, said as such, never the clip), or knows no such clip.
      const reason = refusedOf(id)
      if (reason) {
        return reason === 'not_playable' ? { verdict: 'format', status: 0 } : { verdict: 'refused', status: 0, reason }
      }
      return { verdict: S.ticketErrors.has(id) ? 'ticket' : 'no_stream', status: 0 }
    }
    return settle(await doors.head(via.base, id, t.ticket), t)
  }
  /**
   * Everything this composite holds, let go: a sign-out, or another person
   * signing in, drops the composite (round 1, findings 1 and 15). Nothing it
   * held is used again; a promise still in flight writes into maps nobody reads.
   */
  c.dispose = () => {
    for (const timer of S.marginTimers.values()) clearTimeout(timer)
    S.marginTimers.clear()
    S.tickets.clear(); S.inflight.clear(); S.missing.clear(); S.refused.clear(); S.ticketErrors.clear(); S.renewFailed.clear()
    S.renewing.clear(); S.renewedAt.clear(); S.doorRefused.clear()
    S.reached.clear()
    S.gateways = []
    caps = GATEWAY_BINS_CAPABILITIES
  }

  // Nothing here reads a file: the cloud's refusals stand for picking, probing, the OS and relinking.
  return c
}
