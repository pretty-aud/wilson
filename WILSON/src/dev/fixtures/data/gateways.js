// =============================================================================
// gateways.js — GW1 (2026-10-10, migration 0093): Lantern & Ash Pictures' file
// gateway, as the cloud would hold it.
//
// One gateway, "Salt Hours NAS", a container on the company's Synology,
// enrolled and confirmed by Mara a fortnight ago, reading the one footage
// location (data/scenes.js). The company tried viewing from outside for two
// weeks through a tunnel, so there are viewings in the last 30 days and the
// audit trail says so; yesterday Mara took the outside address away and
// turned the switch off again, which is how the dataset's workspace stands
// (data/workspace.js: remote_viewing_enabled false).
//
// 🚨 THESE TIMES ARE RELATIVE TO NOW, not to the dataset's fixed epoch: a
// gateway is "seen 4 s ago" or it is not running, and "the last 30 days" is
// the real calendar's. Everything else in the dataset keeps its fixed dates.
// Addresses are from the documentation ranges (RFC 5737), which no outside
// address may be (0093 refuses them), so they appear only as viewers' and
// as history, never as something the card could publish.
// =============================================================================

import { fid } from '../ids'
import { WORKSPACE_ID, MEMBER_ID, MEMBERS } from './workspace'
import { BIN_LOCATIONS, BIN_FILES } from './scenes'
import { PROJECT_ID } from './project'

export const GATEWAY_ID = fid('gateway', 1)

/** The fixture root's fingerprint, as the container's log would print it (walkthrough 60 types it). */
export const FIXTURE_ROOT_FINGERPRINT = '5ac1f4e2b0d94c3a8e7f61d2c0b9a8774e3d2c1b0a99887766554433221100ff'
export const FIXTURE_NEW_ROOT_FINGERPRINT = '9e8d7c6b5a49382716f5e4d3c2b1a0998877665544332211ffeeddccbbaa0011'

/** What Download certificate hands over on fixture data: a PEM-shaped file that says what it is. */
export const FIXTURE_ROOT_PEM = [
  '-----BEGIN CERTIFICATE-----',
  // base64 of "WILSON dev fixtures: not a certificate. The real one comes from the gateway's enrolment."
  'V0lMU09OIGRldiBmaXh0dXJlczogbm90IGEgY2VydGlmaWNhdGUuIFRoZSByZWFsIG9uZSBjb21lcyBmcm9tIHRoZSBnYXRld2F5J3MgZW5yb2xtZW50Lg==',
  '-----END CERTIFICATE-----',
  '',
].join('\n')

const LOCATION_ID = BIN_LOCATIONS[0].id
const label = (id) => MEMBERS.find(m => m.user_id === id)?.display_name ?? null
const ago = (now, ms) => new Date(now - ms).toISOString()
const H = 3600 * 1000
const D = 24 * H

/** The healthy NAS gateway (the admin's columns). */
export function seedGateway(now) {
  return {
    id: GATEWAY_ID,
    workspace_id: WORKSPACE_ID,
    name: 'Salt Hours NAS',
    platform: 'container',
    version: '1.0.0',
    hostname: 'salthours-nas',
    inside_addresses: [{ host: '192.168.10.20', port: 8443 }, { host: 'salthours-nas.local', port: 8443 }],
    outside_address: null,
    outside_open: false,
    root_fingerprint: FIXTURE_ROOT_FINGERPRINT,
    root_confirmed_at: ago(now, 16 * D - 20 * 60 * 1000),
    reach: { [LOCATION_ID]: 'reachable' },
    health: {
      doors: { inside: 'open', outside: 'closed_switch_off', refused_public: 0, inside_bound: ['192.168.10.20:8443'], relay_warning: null },
      update: 'up_to_date',
      certificate: { leaf_not_after: '2027-11-08T00:00:00Z', root_not_after: '2036-09-24T00:00:00Z', outside: null, expires_warning: null },
      office_ranges_applied: [],
      cloud: null,
      smb_dialect: null,
      minimum_version_ok: true,
    },
    office_ranges: [],
    reach_ok: false,
    reach_checked_at: ago(now, 1 * D + 2 * H),
    reach_detail: 'address_changed',
    reach_result: {},
    reach_check_id: null,
    update_check_requested_at: null,
    created_by: MEMBER_ID.mara,
    created_at: ago(now, 16 * D),
    last_seen_at: ago(now, 4000),
    revoked_at: null,
  }
}

/** A gateway the simulated enrolment brings, unconfirmed (the fingerprint box's case). */
export function enrolledGateway(now, { id, createdBy, platform }) {
  const windows = platform === 'windows'
  return {
    id,
    workspace_id: WORKSPACE_ID,
    name: windows ? 'EDIT-SUITE-PC' : 'salthours-nas',
    platform,
    version: '1.0.0',
    hostname: windows ? 'EDIT-SUITE-PC' : 'salthours-nas',
    inside_addresses: windows ? [{ host: '192.168.10.41', port: 8443 }] : [{ host: '192.168.10.20', port: 8443 }],
    outside_address: null,
    outside_open: false,
    root_fingerprint: FIXTURE_NEW_ROOT_FINGERPRINT,
    root_confirmed_at: null,
    reach: { [LOCATION_ID]: windows ? 'not_connected' : 'reachable' },
    health: {
      doors: { inside: 'open', outside: 'closed_switch_off', refused_public: 0, inside_bound: [], relay_warning: null },
      update: 'up_to_date',
      certificate: { leaf_not_after: null, root_not_after: null, outside: null, expires_warning: null },
      office_ranges_applied: [],
      cloud: null,
      smb_dialect: windows ? '3.1.1' : null,
      minimum_version_ok: true,
    },
    office_ranges: [],
    reach_ok: null,
    reach_checked_at: null,
    reach_detail: null,
    reach_result: {},
    reach_check_id: null,
    update_check_requested_at: null,
    created_by: createdBy,
    created_at: new Date(now).toISOString(),
    last_seen_at: new Date(now).toISOString(),
    revoked_at: null,
  }
}

function viewing(now, n, { clip, who, at, bytes, fraction, via = null, shared = false, addrs, incomplete = false, unverified = false }) {
  const f = BIN_FILES[clip]
  const clipBytes = f.size_bytes
  const read = bytes ?? Math.round(clipBytes * fraction)
  const started = new Date(now - at)
  return {
    id: 9600 + n,
    workspace_id: WORKSPACE_ID,
    project_id: PROJECT_ID,
    file_id: f.id,
    file_name: f.original_name,
    event: 'viewed_remote',
    subject: 'bin_file',
    size_bytes: read,
    actor_user_id: who,
    actor_label: label(who),
    created_at: started.toISOString(),
    external_id: `${GATEWAY_ID}:${fid('gatewayToken', 900 + n)}`,
    details: {
      viewing_id: fid('gatewayToken', 900 + n),
      gateway_id: GATEWAY_ID,
      gateway_name: 'Salt Hours NAS',
      started_at: started.toISOString(),
      ended_at: incomplete ? null : new Date(now - at + 4 * 60 * 1000).toISOString(),
      bytes: read,
      clip_bytes: clipBytes,
      fraction: Math.round((read / clipBytes) * 1000) / 1000,
      read_in_full: read / clipBytes >= 0.9,
      range_count: incomplete ? 3 : 12,
      source_address: addrs[0],
      source_addresses: addrs,
      shared_url: shared || addrs.length > 1,
      via,
      user_agent: 'Chrome 141',
      unverified_mint: unverified,
      incomplete,
    },
  }
}

/** Five viewings through the outside door, between two and fourteen days ago. */
export function seedViewings(now) {
  return [
    viewing(now, 1, { clip: 0, who: MEMBER_ID.priya, at: 2 * D + 3 * H, fraction: 0.97, via: 'cloudflare', addrs: ['203.0.113.7'] }),
    viewing(now, 2, { clip: 1, who: MEMBER_ID.theo, at: 4 * D + 5 * H, fraction: 0.31, via: 'cloudflare', addrs: ['198.51.100.23'] }),
    viewing(now, 3, { clip: 0, who: MEMBER_ID.priya, at: 6 * D + 2 * H, fraction: 0.62, via: 'cloudflare', addrs: ['203.0.113.7', '203.0.113.99'], shared: true }),
    viewing(now, 4, { clip: 2, who: MEMBER_ID.kenji, at: 9 * D, bytes: 48 * 1024 * 1024, via: 'cloudflare', addrs: ['198.51.100.140'], incomplete: true }),
    viewing(now, 5, { clip: 3, who: MEMBER_ID.priya, at: 13 * D + 6 * H, fraction: 1, via: 'cloudflare', addrs: ['203.0.113.7'], unverified: true }),
  ]
}

/** The trail: enrolment, the two weeks with the switch on, and yesterday's step back. */
export function seedAudit(now) {
  const mara = MEMBER_ID.mara
  const row = (n, at, action, details = {}, actor = mara, gateway = GATEWAY_ID) => ({
    id: 960 + n,
    workspace_id: WORKSPACE_ID,
    action,
    actor_user_id: actor,
    actor_label: actor ? label(actor) : null,
    gateway_id: gateway,
    details,
    created_at: ago(now, at),
  })
  return [
    row(1, 16 * D + 40 * 60 * 1000, 'gateway.token_made', {}, mara, null),
    row(2, 16 * D, 'gateway.enrolled', { name: 'salthours-nas', platform: 'container', version: '1.0.0' }),
    row(3, 16 * D - 10 * 60 * 1000, 'gateway.renamed', { from: 'salthours-nas', to: 'Salt Hours NAS' }),
    row(4, 16 * D - 20 * 60 * 1000, 'gateway.root_confirmed', { fingerprint: FIXTURE_ROOT_FINGERPRINT }),
    row(5, 15 * D, 'remote_viewing.on', {}, mara, null),
    row(6, 15 * D - 5 * 60 * 1000, 'gateway.outside_address_changed', { from: null, to: { host: 'footage.lanternash.example', port: 443 } }),
    row(7, 15 * D - 6 * 60 * 1000, 'gateway.reach_checked', { outside: { ok: true, detail: 'reached', ms: 151 }, inside_answered: false, automatic: false }),
    row(8, 1 * D + 2 * H, 'gateway.outside_address_changed', { from: { host: 'footage.lanternash.example', port: 443 }, to: null }),
    row(9, 1 * D + 2 * H - 60 * 1000, 'remote_viewing.off', {}, mara, null),
  ].reverse()
}
