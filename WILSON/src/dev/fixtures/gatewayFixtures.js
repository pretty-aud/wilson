// =============================================================================
// gatewayFixtures.js — GW1 (2026-10-10): the file gateway's cloud, in memory.
//
// What `devFixtures().gateways` answers, so Settings, Storage, File gateway
// and the Bins inspector's one line render on port 5288 without a database
// (src/cloud/gatewayApi.js delegates every call here in a dev build with the
// fixtures on). The shapes are the cloud's: the admin's columns of
// `gateways`, the view's columns for everyone else, the token rows without
// their hash, workspace_audit, file_events' viewed_remote rows.
//
// The rules are 0093's, restated where the card can meet them: a LIVE admin
// for every verb (the reviewer is Mara; `?fixtures=member` and
// `?fixtures=manager` are refused with the database's sentence), five pending
// tokens at most, the fingerprint confirmed only by the admin who made the
// token and only with the gateway's own, the certificate only after that,
// forget undoable for one minute, an address change clearing the check.
//
// Two things the real cloud does that a fixture has to act out:
//   * ENROLMENT. Six seconds after Add a gateway, the token is spent by a
//     gateway that "started": unconfirmed, made by the admin who made the
//     token, so the fingerprint box appears (walkthrough 60 types
//     FIXTURE_NEW_ROOT_FINGERPRINT). `?gateways=empty` starts with no gateway,
//     and the one that appears is a NAS; otherwise it is a Windows PC.
//   * CHECK REACH. No knock leaves this computer. The answer is §4's, chosen
//     by the address: a name whose first label is `timeout`, `refused`,
//     `other`, `selfsigned`, `inside` or `tunnel` answers that case (`tunnel`:
//     reached, and something else on the inside port — a tunnel's edge; GW1
//     review round 2, finding 4); anything else is reached while the switch
//     is on, and switch-off's refusal while it is off. A second and a half
//     of "Checking…" first, so the wait is seen.
//
// Rotate the ticket keys (review round 2, finding 6) is the database's rule
// only (a live admin; written down): the fixtures sign no ticket.
// =============================================================================

import { clone } from './store'
import { fid } from './ids'
import { MEMBERS } from './data/workspace'
import { PROJECT } from './data/project'
import {
  seedGateway, enrolledGateway, seedViewings, seedAudit, FIXTURE_ROOT_PEM,
} from './data/gateways'
import { parseOutsideAddress, parseOfficeRanges, normalizeFingerprint } from '../../components/settings/gatewayWords'

const ENROL_AFTER_MS = 6000
const CHECK_TAKES_MS = 1500
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

const SENT = {
  admin: 'Only a workspace admin can manage the file gateway.',
  notListed: 'That gateway is not in this company\'s list.',
  fiveTokens: 'This company already has five unused gateway tokens. Cancel one before making another.',
  notEnroller: 'Only the admin who made this gateway\'s enrolment token can confirm its fingerprint: they are the one who saw it printed.',
  fpShape: 'A certificate fingerprint is 64 letters and digits (0–9 and a–f), with or without colons between the pairs.',
  fpWrong: 'That fingerprint does not match the certificate this gateway sent WILSON. Copy it again from the installer\'s last screen or the container\'s first log lines; if you did not install this gateway, choose Forget.',
  confirmFirst: 'Confirm this gateway\'s fingerprint first: WILSON offers its certificate only after the admin who installed it has confirmed it is theirs.',
  tooLate: 'This gateway was forgotten more than a minute ago, so it cannot come back: enrol it again with a new token.',
  tokenGone: 'That token was used or has expired, so there is nothing to cancel.',
  noAddress: 'Give the gateway its outside address first: the public name or address people outside the office will reach it at.',
  name: 'A gateway\'s name is 1 to 80 characters.',
  address: 'An outside address is a public name like gateway.yourcompany.com, or a public address, with its port: never a name or address inside the office.',
  ranges: 'Office ranges are private ranges only (10.x, 172.16–31.x, 192.168.x or fc00::/7), at most eight, none wider than a /16 (a /48 for IPv6).',
}

const no = (code, friendly, status) => ({ ok: false, code, friendly, ...(status ? { status } : {}) })
const yes = (data, extra = {}) => ({ ok: true, data, ...extra })

/** `?gateways=empty`: the company before its first gateway (walkthrough 60's start). */
export function gatewayFixtureMode(search = typeof location === 'undefined' ? '' : location.search) {
  return new URLSearchParams(search).get('gateways') === 'empty' ? 'empty' : null
}

export function createGatewayFixtures(store, identity, {
  mode = null,
  clock = () => Date.now(),
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (t) => clearTimeout(t),
  wait = (ms) => new Promise(r => setTimeout(r, ms)),
} = {}) {
  const t0 = clock()
  // The viewings live in the store, where the fixtures' project adapter reads
  // them too (the Bins inspector's one line), so the two never disagree.
  if (!store.gatewayViewings) store.gatewayViewings = mode === 'empty' ? [] : seedViewings(t0)
  const state = {
    gateways: mode === 'empty' ? [] : [seedGateway(t0)],
    tokens: [],
    viewings: store.gatewayViewings,
    audit: mode === 'empty' ? [] : seedAudit(t0),
    live: new Set(mode === 'empty' ? [] : [seedGateway(t0).id]),
    timers: new Map(),
    seq: 1,
    auditSeq: 2000,
  }
  const isAdmin = () => identity.appRole === 'admin'
  const switchOn = () => store.workspace?.remote_viewing_enabled === true

  function audit(action, gatewayId, details = {}, actor = identity.userId) {
    state.audit.unshift({
      id: (state.auditSeq += 1),
      workspace_id: identity.workspaceId,
      action,
      actor_user_id: actor,
      actor_label: actor ? (MEMBERS.find(m => m.user_id === actor)?.display_name ?? null) : null,
      gateway_id: gatewayId,
      details,
      created_at: new Date(clock()).toISOString(),
    })
  }

  // What a sync would have said by now: the gateway checks in every ten
  // seconds, and its outside door follows the switch and the address (§9).
  function asRead(g, now) {
    const row = clone(g)
    if (state.live.has(g.id) && !g.revoked_at) row.last_seen_at = new Date(now - (now % 10000)).toISOString()
    const doors = row.health?.doors
    if (doors) {
      doors.outside = !switchOn() ? 'closed_switch_off'
        : !row.outside_address ? 'closed_no_address'
          : `open:${row.outside_address.port}`
      row.outside_open = doors.outside.startsWith('open')
    }
    row.health.office_ranges_applied = clone(row.office_ranges || [])
    return row
  }

  const find = (id) => state.gateways.find(g => g.id === id) || null
  const liveOne = (id) => { const g = find(id); return g && !g.revoked_at ? g : null }

  function enrol(token) {
    const t = state.tokens.find(x => x.id === token.id)
    if (!t || t.used_at || Date.parse(t.expires_at) <= clock()) return
    const id = fid('gateway', 100 + (state.seq += 1))
    const platform = mode === 'empty' ? 'container' : 'windows'
    const g = enrolledGateway(clock(), { id, createdBy: t.created_by, platform })
    state.gateways.push(g)
    state.live.add(id)
    t.used_at = new Date(clock()).toISOString()
    t.gateway_id = id
    audit('gateway.enrolled', id, { name: g.name, platform, version: g.version, hostname: g.hostname, fingerprint: g.root_fingerprint }, t.created_by)
  }

  return {
    async listGateways({ admin, now = clock() } = {}) {
      if (!admin) {
        return yes(state.gateways
          .filter(g => !g.revoked_at && g.root_confirmed_at)
          .map(g => { const r = asRead(g, now); return { id: r.id, name: r.name, platform: r.platform, version: r.version, last_seen_at: r.last_seen_at } }))
      }
      if (!isAdmin()) return yes([])
      return yes(state.gateways
        .filter(g => !g.revoked_at || Date.parse(g.revoked_at) > now - 60000)
        .map(g => asRead(g, now)))
    },

    async listEnrolmentTokens({ now = clock() } = {}) {
      if (!isAdmin()) return yes([])
      return yes(state.tokens
        .filter(t => Date.parse(t.created_at) > now - 24 * 3600 * 1000)
        .map(({ token: _secret, ...t }) => clone(t)))
    },

    async listGatewayAudit({ limit = 20 } = {}) {
      if (!isAdmin()) return yes([])
      return yes(clone(state.audit.slice(0, limit)))
    },

    async listRemoteViewings({ page = 0, pageSize = 25, now = clock() } = {}) {
      if (!isAdmin()) return yes({ rows: [], total: 0 })
      const rows = state.viewings
        .filter(v => Date.parse(v.created_at) >= now - 30 * 86400 * 1000)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id)
      const from = Math.max(0, page) * pageSize
      return yes({ rows: clone(rows.slice(from, from + pageSize)).map(r => ({ ...r, project_title: PROJECT.title })), total: rows.length })
    },

    async makeEnrolmentToken() {
      if (!isAdmin()) return no('42501', SENT.admin)
      const now = clock()
      if (state.tokens.filter(t => !t.used_at && Date.parse(t.expires_at) > now).length >= 5) return no('54000', SENT.fiveTokens)
      const bytes = new Uint8Array(32)
      globalThis.crypto.getRandomValues(bytes)
      const token = `wgt_${[...bytes].map(b => B32[b % 32]).join('')}`
      const row = {
        id: fid('gatewayToken', (state.seq += 1)),
        workspace_id: identity.workspaceId,
        created_by: identity.userId,
        created_at: new Date(now).toISOString(),
        expires_at: new Date(now + 24 * 3600 * 1000).toISOString(),
        used_at: null,
        gateway_id: null,
        token,
      }
      state.tokens.push(row)
      audit('gateway.token_made', null, { token_id: row.id, expires_at: row.expires_at })
      state.timers.set(row.id, schedule(() => { state.timers.delete(row.id); enrol(row) }, ENROL_AFTER_MS))
      return yes({ id: row.id, token, expires_at: row.expires_at })
    },

    async cancelEnrolmentToken(tokenId) {
      if (!isAdmin()) return no('not_found', SENT.tokenGone)
      const i = state.tokens.findIndex(t => t.id === tokenId && !t.used_at)
      if (i === -1) return no('not_found', SENT.tokenGone)
      state.tokens.splice(i, 1)
      if (state.timers.has(tokenId)) { cancel(state.timers.get(tokenId)); state.timers.delete(tokenId) }
      audit('gateway.token_cancelled', null, { token_id: tokenId })
      return yes({ id: tokenId })
    },

    async confirmGatewayFingerprint(gatewayId, fingerprint) {
      if (!isAdmin()) return no('42501', SENT.admin)
      const g = liveOne(gatewayId)
      if (!g) return no('P0002', SENT.notListed)
      if (g.created_by !== identity.userId) return no('42501', SENT.notEnroller)
      if (g.root_confirmed_at) return yes(g.root_confirmed_at)
      const fp = normalizeFingerprint(fingerprint)
      if (!fp) return no('22023', SENT.fpShape)
      if (fp !== g.root_fingerprint) return no('22023', SENT.fpWrong)
      g.root_confirmed_at = new Date(clock()).toISOString()
      audit('gateway.root_confirmed', g.id, { fingerprint: g.root_fingerprint })
      return yes(g.root_confirmed_at)
    },

    async fetchRootCertificate(gatewayId) {
      if (!isAdmin()) return no('42501', SENT.admin)
      const g = liveOne(gatewayId)
      if (!g) return no('P0002', SENT.notListed)
      if (!g.root_confirmed_at) return no('55000', SENT.confirmFirst)
      return yes(FIXTURE_ROOT_PEM)
    },

    async updateGateway(gatewayId, patch) {
      const g = isAdmin() ? liveOne(gatewayId) : null
      if (!g) return no('not_found', 'That gateway is not in this company\'s list any more, or only a workspace admin can change it.')
      if ('name' in patch) {
        const n = String(patch.name ?? '')
        if (n.trim().length < 1 || n.trim().length > 80) return no('23514', SENT.name)
        if (n !== g.name) { audit('gateway.renamed', g.id, { from: g.name.slice(0, 80), to: n.slice(0, 80) }); g.name = n }
      }
      if ('outside_address' in patch) {
        const a = patch.outside_address
        if (a !== null) {
          const p = parseOutsideAddress(`${a?.host}:${a?.port}`)
          if (!p.ok || p.value.host !== a.host || p.value.port !== a.port || Object.keys(a).length !== 2) return no('23514', SENT.address)
        }
        if (JSON.stringify(a) !== JSON.stringify(g.outside_address)) {
          audit('gateway.outside_address_changed', g.id, { from: g.outside_address, to: a })
          Object.assign(g, { outside_address: a, reach_ok: null, reach_checked_at: null, reach_detail: 'address_changed', reach_result: {}, reach_check_id: null })
        }
      }
      if ('office_ranges' in patch) {
        const r = patch.office_ranges
        const p = parseOfficeRanges((r || []).join(' '))
        if (!Array.isArray(r) || !p.ok || JSON.stringify(p.value) !== JSON.stringify(r)) return no('23514', SENT.ranges)
        if (JSON.stringify(r) !== JSON.stringify(g.office_ranges)) {
          audit('gateway.office_ranges_changed', g.id, { from: g.office_ranges, to: r })
          g.office_ranges = clone(r)
        }
      }
      return yes(asRead(g, clock()))
    },

    async forgetGateway(gatewayId) {
      if (!isAdmin()) return no('42501', SENT.admin)
      const g = find(gatewayId)
      if (!g) return no('P0002', SENT.notListed)
      if (g.revoked_at) return yes(g.revoked_at)
      g.revoked_at = new Date(clock()).toISOString()
      audit('gateway.forgotten', g.id, { name: g.name, hostname: g.hostname, platform: g.platform })
      return yes(g.revoked_at)
    },

    async unforgetGateway(gatewayId) {
      if (!isAdmin()) return no('42501', SENT.admin)
      const g = find(gatewayId)
      if (!g || !g.revoked_at || Date.parse(g.revoked_at) <= clock() - 60000) return no('55000', SENT.tooLate)
      g.revoked_at = null
      audit('gateway.forget_undone', g.id, {})
      return yes(true)
    },

    async requestGatewayUpdateCheck(gatewayId) {
      if (!isAdmin()) return no('42501', SENT.admin)
      const g = liveOne(gatewayId)
      if (!g) return no('P0002', SENT.notListed)
      g.update_check_requested_at = new Date(clock()).toISOString()
      return yes(g.update_check_requested_at)
    },

    async rotateTicketKeys() {
      if (!isAdmin()) return no('42501', SENT.admin)
      const at = new Date(clock()).toISOString()
      audit('gateway.keys_rotated', null, { retired: 1 })
      return yes({ retired: 1, at })
    },

    async checkGatewayReach(gatewayId) {
      if (!isAdmin()) return no('forbidden', 'Only a workspace admin can check whether the gateway is reachable from outside.', 403)
      const g = liveOne(gatewayId)
      if (!g) return no('not_found', SENT.notListed, 404)
      if (!g.outside_address) return no('no_address', SENT.noAddress, 409)
      const address = clone(g.outside_address)
      await wait(CHECK_TAKES_MS)
      const first = String(address.host).split('.')[0]
      const by = {
        timeout: { ok: false, detail: 'timed_out', ms: null, certificate: 'unknown', is_this_gateway: false },
        refused: { ok: false, detail: 'refused', ms: 31, certificate: 'unknown', is_this_gateway: false },
        other: { ok: false, detail: 'not_this_gateway', ms: 120, certificate: 'ok', is_this_gateway: false },
        selfsigned: { ok: false, detail: 'certificate', ms: 98, certificate: 'untrusted', is_this_gateway: false },
      }
      const outside = by[first]
        || (switchOn()
          ? { ok: true, detail: 'reached', ms: 143, certificate: 'ok', is_this_gateway: true }
          : { ok: false, detail: 'switch_off', ms: 4, certificate: 'unknown', is_this_gateway: false })
      const result = { outside: { ...outside, method: 'literal_tls' }, inside_answered: first === 'inside', inside_other: first === 'tunnel' }
      const checkedAt = new Date(clock()).toISOString()
      // The answer belongs to the address it probed; a change meanwhile wins.
      if (JSON.stringify(g.outside_address) === JSON.stringify(address) && !g.revoked_at) {
        Object.assign(g, {
          reach_ok: outside.ok && outside.is_this_gateway, reach_checked_at: checkedAt, reach_detail: outside.detail,
          reach_result: { ...clone(result), checked_at: checkedAt },
        })
        audit('gateway.reach_checked', g.id, { ...clone(result), address, automatic: false })
      }
      return yes({ ...result, checked_at: checkedAt })
    },
  }
}
