// =============================================================================
// gatewayWords.test.js — GW1 (2026-10-10): the File gateway card's words and
// rules, held to GATEWAY_DESIGN.md's own text and to 0093's validators.
//
//   * §3's paragraph and §11's two stories are VERBATIM: each string the card
//     shows is found, word for word, in the design (markdown emphasis and
//     code marks removed).
//   * §4's seven sentences come out of reachSentence exactly as the design's
//     table writes them, for the design's own example gateway.
//   * §8's health line comes out phrase for phrase for the design's example,
//     with the one deliberate difference said here: *not mounted* names the
//     container's side of the mount (the half WILSON computes), because the
//     cloud cannot know the NAS's own folder path.
//   * The address, range and fingerprint rules accept and refuse what 0093's
//     gateway_outside_address_ok / gateway_is_public_ip /
//     gateway_office_ranges_ok / gateway_confirm_root accept and refuse, with
//     a control beside every refusal.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  GATEWAY_CERT_PARAGRAPH, NAS_STORY, WINDOWS_STORY, mountPathFor, cloudUrlFor, parseOutsideAddress, formatAddress,
  parseOfficeRanges, normalizeFingerprint, formatFingerprint, agoWords, healthPhrases, insideForwardSentence,
  reachSentence, auditPhrase, howMuchWords, whereWords, whoWords, inspectorRemoteLine, FINGERPRINT_SHAPE,
  gatewayNameWords, versionWords, NEW_GATEWAY_NOTICE, FORGET_CONFIRM,
} from './gatewayWords'

const design = readFileSync(resolve(process.cwd(), 'docs/design/GATEWAY_DESIGN.md'), 'utf8')
const section = (from, to) => design.slice(design.indexOf(from), design.indexOf(to, design.indexOf(from) + from.length))
// Markdown's marks are not words: bold, italics and code spans removed,
// whitespace collapsed.
const plain = (s) => s.replace(/\*\*/g, '').replace(/\*/g, '').replace(/`/g, '').replace(/^>\s?/gm, '').replace(/\s+/g, ' ').trim()

const BS = String.fromCharCode(92)
// GW1 review round 2, finding 2: what a gateway could put in its name.
const RLO = String.fromCharCode(0x202e)
const ZWSP = String.fromCharCode(0x200b)
const BEL = String.fromCharCode(7)

describe('§3 and §11, verbatim', () => {
  it('the certificate paragraph is §3\'s, word for word', () => {
    const text = GATEWAY_CERT_PARAGRAPH.map(p => (typeof p === 'string' ? p : p.em)).join('')
    const s3 = plain(section('## 3. The certificate story', '**What the gateway makes on first run**'))
    expect(s3).toContain(text)
    // CONTROL: a changed word is caught.
    expect(s3).not.toContain(text.replace('two minutes per computer', 'five minutes per computer'))
  })

  for (const [name, story, from, to] of [
    ['the NAS story', NAS_STORY, '### A. On a NAS', '### B. On a Windows PC'],
    ['the Windows story', WINDOWS_STORY, '### B. On a Windows PC', '## 12. The build plan'],
  ]) {
    it(`${name}: every sentence the card shows is §11's`, () => {
      const s11 = plain(section(from, to))
      const pieces = story.intro ? [story.intro] : []
      for (const st of story.steps) {
        pieces.push(`${st.lead} ${st.text}`)
        for (const it of st.items || []) pieces.push(`${it.lead} ${it.text}`)
      }
      for (const a of story.after) pieces.push(`${a.lead}${a.text}`)
      // CONTROL: the framing sentence speaks to the design's reader; the card leaves it out.
      expect(JSON.stringify(story)).not.toContain('Read as the admin reads it')
      for (const p of pieces) expect(s11, p.slice(0, 60)).toContain(p)
      // The numbered steps are §11's, in its order and count.
      const numbered = s11.match(/ \d\. /g) || []
      expect(story.steps.length).toBe(numbered.length)
    })
  }

  it('the stories keep the network address\'s backslashes', () => {
    const volumes = NAS_STORY.steps[2].items.find(i => i.mounts)
    expect(volumes.text).toContain(`${BS}${BS}nas${BS}footage`)
    expect(WINDOWS_STORY.steps[0].text).toContain(`NT SERVICE${BS}WilsonGateway`)
  })
})

describe('Tesler: what WILSON computes', () => {
  it('the mount line: host and share lower-cased, the folders below keep their spelling (R15)', () => {
    expect(mountPathFor(`${BS}${BS}NAS${BS}Footage`)).toBe('/locations/nas/footage')
    expect(mountPathFor(`${BS}${BS}salthours-nas${BS}Footage${BS}Día 02`)).toBe('/locations/salthours-nas/footage/Día 02')
    // CONTROLS: a drive letter and a bare host are no network address.
    expect(mountPathFor('Z:\\Footage'.replace('\\', BS))).toBeNull()
    expect(mountPathFor(`${BS}${BS}nas`)).toBeNull()
  })

  it('the cloud address is the functions base, no trailing slash', () => {
    expect(cloudUrlFor('https://abc.supabase.co/')).toBe('https://abc.supabase.co/functions/v1')
    expect(cloudUrlFor('https://abc.supabase.co')).toBe('https://abc.supabase.co/functions/v1')
    expect(cloudUrlFor('')).toBe('')
  })
})

describe('Postel: the outside address, as 0093 checks it', () => {
  const ok = (s) => parseOutsideAddress(s)
  it('reads what people paste and stores the database\'s spelling', () => {
    expect(ok('https://Gateway.YourCompany.com:443/v1/health').value).toEqual({ host: 'gateway.yourcompany.com', port: 443 })
    expect(ok('gateway.yourcompany.com').value).toEqual({ host: 'gateway.yourcompany.com', port: 8444 })
    expect(ok('gateway.yourcompany.com.:8444').value).toEqual({ host: 'gateway.yourcompany.com', port: 8444 })
    expect(ok('8.8.4.4:8444').value).toEqual({ host: '8.8.4.4', port: 8444 })
    // IPv6: bracketed or bare, respelled as Postgres's host() prints it.
    expect(ok('[2A00:1450:4001:0:0:0:0:200E]:443').value).toEqual({ host: '2a00:1450:4001::200e', port: 443 })
    expect(ok('2606:4700:4700::1111').value).toEqual({ host: '2606:4700:4700::1111', port: 8444 })
    // RFC 5952: one zero group is not compressed; the FIRST longest run is.
    expect(ok('[2a00:1:0:1:0:0:1:1]').value.host).toBe('2a00:1:0:1::1:1')
    expect(ok('[2a00:0:0:1:0:0:1:1]').value.host).toBe('2a00::1:0:0:1:1')
    expect(ok('[2a00:1:0:1:1:1:1:1]').value.host).toBe('2a00:1:0:1:1:1:1:1')
    expect(formatAddress({ host: '2a00:1450:4001::200e', port: 443 })).toBe('[2a00:1450:4001::200e]:443')
  })

  it('refuses every range gateway_is_public_ip refuses (a control beside each)', () => {
    for (const bad of ['10.0.0.5', '172.16.4.4', '192.168.1.10', '127.0.0.1', '0.1.2.3', '100.64.0.1', '169.254.1.1',
      '192.0.0.8', '192.0.2.10', '192.88.99.1', '198.18.0.1', '198.19.255.1', '198.51.100.7', '203.0.113.7', '224.0.0.1', '240.0.0.1', '255.255.255.255',
      '[::1]', '[::]', '[::ffff:8.8.8.8]', '[64:ff9b::808:808]', '[64:ff9b:1::1]', '[100::1]', '[2001::1]', '[2001:db8::1]', '[2002::1]',
      '[fd00::1]', '[fc12::1]', '[fe80::1]', '[ff02::1]', '[::8.8.8.8]']) {
      expect(ok(bad).ok, bad).toBe(false)
    }
    // CONTROLS: the neighbours just outside each refused range are public.
    for (const good of ['11.0.0.1', '172.32.0.1', '192.169.0.1', '100.128.0.1', '192.88.98.1', '198.20.0.1', '223.255.255.1', '[2001:4860::8888]', '[2a00::1]']) {
      expect(ok(good).ok, good).toBe(true)
    }
  })

  it('refuses a local, reserved or Supabase name, and a malformed one', () => {
    for (const bad of ['nas', 'nas.local', 'gw.lan', 'x.internal', 'a.home.arpa', 'gw.example', 'gw.test', 'gw.onion',
      'abc.supabase.co', 'supabase.com', 'under_score.com', '-x.com', 'x.com:0', 'x.com:70000', '1.2.3', '010.1.1.1', '', '   ']) {
      expect(ok(bad).ok, bad).toBe(false)
    }
    // CONTROLS.
    for (const good of ['notsupabase.co.uk', 'local.example-studio.com', 'my-gw.studio', 'x1.io']) expect(ok(good).ok, good).toBe(true)
  })

  it('a refusal is a sentence', () => {
    expect(ok('192.168.1.10').problem).toMatch(/^An outside address is a public name/)
  })
})

describe('Postel: the office ranges (D21), as gateway_office_ranges_ok checks them', () => {
  it('clears host bits, spells the network as cidr prints it, drops a repeat', () => {
    expect(parseOfficeRanges('192.168.20.7/24, 10.8.0.0/16; 10.8.0.0/16').value).toEqual(['192.168.20.0/24', '10.8.0.0/16'])
    expect(parseOfficeRanges('192.168.1.5').value).toEqual(['192.168.1.5/32'])
    expect(parseOfficeRanges('FD12:3456:789A:1::/64').value).toEqual(['fd12:3456:789a:1::/64'])
    expect(parseOfficeRanges('fd12:3456:789a:1:2::/48').value).toEqual(['fd12:3456:789a::/48'])
    expect(parseOfficeRanges('').value).toEqual([])
  })

  it('refuses a public range, one wider than a /16 (a /48), more than eight', () => {
    for (const bad of ['8.8.8.0/24', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/15', 'fd00::/47', '2001:db8::/48', '10.1.2.3/33', '10.1.2.3/x', 'nas']) {
      expect(parseOfficeRanges(bad).ok, bad).toBe(false)
    }
    const nine = Array.from({ length: 9 }, (_, i) => `10.${i}.0.0/16`).join(' ')
    expect(parseOfficeRanges(nine).ok).toBe(false)
    // CONTROLS: exactly the limits.
    expect(parseOfficeRanges('10.0.0.0/16 172.31.0.0/16 192.168.0.0/16 fd00::/48').ok).toBe(true)
    expect(parseOfficeRanges(Array.from({ length: 8 }, (_, i) => `10.${i}.0.0/16`).join(' ')).ok).toBe(true)
  })
})

describe('the fingerprint (D25), as gateway_confirm_root reads it', () => {
  const hex = '5ac1f4e2b0d94c3a8e7f61d2c0b9a8774e3d2c1b0a99887766554433221100ff'
  it('with or without colons, either case, with openssl\'s prefix', () => {
    const pairs = formatFingerprint(hex)
    expect(pairs).toMatch(/^5A:C1:F4/)
    expect(normalizeFingerprint(pairs)).toBe(hex)
    expect(normalizeFingerprint(`sha256 Fingerprint=${pairs}`)).toBe(hex)
    expect(normalizeFingerprint(`SHA256 Fingerprint=${pairs}`)).toBe(hex)
    expect(normalizeFingerprint(` ${hex.toUpperCase()} `)).toBe(hex)
  })
  it('refuses anything but 64 hex characters', () => {
    expect(normalizeFingerprint(hex.slice(1))).toBeNull()
    expect(normalizeFingerprint(`${hex}0`)).toBeNull()
    expect(normalizeFingerprint(hex.replace('5', 'g'))).toBeNull()
    expect(FINGERPRINT_SHAPE).toMatch(/64 letters and digits/)
  })
})

describe('§4: the reach check in words, as the design\'s table writes them', () => {
  const s4 = section('## 4. Reach from outside', '## 5. Every read')
  const table = Object.fromEntries([...s4.matchAll(/^\| ([a-z ]+) \| (?:\*\*red:\*\* )?\*([^|]+)\* \|$/gm)].map(m => [m[1], m[2]]))
  const now = Date.parse('2026-10-10T12:00:00Z')
  const gw = {
    outside_address: { host: 'gateway.example.com', port: 8444 },
    inside_addresses: [{ host: '192.168.1.10', port: 8443 }],
    last_seen_at: new Date(now - 3000).toISOString(),
  }
  const say = (detail, extra = {}) => reachSentence({ outside: { detail, ms: 143, ...extra.outside }, inside_answered: !!extra.inside }, gw, { now })

  it('has the seven rows to compare with', () => {
    expect(Object.keys(table).sort()).toEqual(['certificate', 'inside door answered', 'not this gateway', 'reached', 'refused', 'switch off', 'timed out'])
  })
  it('each sentence, word for word', () => {
    expect(say('reached').text).toBe(table.reached)
    expect(say('timed_out').text).toBe(table['timed out'])
    expect(say('refused').text).toBe(table.refused)
    expect(say('certificate').text).toBe(table.certificate)
    expect(say('not_this_gateway').text).toBe(table['not this gateway'])
    expect(say('switch_off').text).toBe(table['switch off'])
    expect(say('reached', { inside: true }).inside.text).toBe(table['inside door answered'])
  })
  it('🚨 something else on the inside port (a tunnel\'s edge) is said plainly, never red (round 2, finding 4)', () => {
    const g = { outside_address: { host: 'gw.example.com', port: 443 }, inside_addresses: [{ host: '192.168.1.10', port: 8443 }] }
    const other = reachSentence({ outside: { detail: 'reached', ms: 90 }, inside_other: true }, g)
    expect(other.inside).toEqual({ tone: 'plain', text: 'Something else answers on port 8443 at that address, not the gateway\'s office door (a tunnel\'s own edge does). Nothing to change unless you forwarded that port yourself.' })
    // CONTROL: the gateway's own door is the red line; neither, nothing.
    expect(reachSentence({ outside: { detail: 'reached', ms: 90 }, inside_answered: true }, g).inside.tone).toBe('error')
    expect(reachSentence({ outside: { detail: 'reached', ms: 90 } }, g).inside).toBeNull()
  })
  it('the red form is the inside door\'s alone; reached and switch-off are the good news', () => {
    expect(say('reached', { inside: true }).inside.tone).toBe('error')
    expect(say('reached').tone).toBe('ok')
    expect(say('switch_off').tone).toBe('ok')
    for (const d of ['timed_out', 'refused', 'certificate', 'not_this_gateway', 'dns', 'not_public', 'gateway_not_syncing', 'something_new']) {
      expect(say(d).tone, d).toBe('warning')
      expect(say(d).inside).toBeNull()
    }
  })
})

describe('§8: the health line, phrase by phrase', () => {
  const now = Date.parse('2026-10-10T12:00:00Z')
  const locations = [{ id: 'L1', name: 'Footage', unc_path: `${BS}${BS}nas${BS}footage` }, { id: 'L2', name: 'Archive', unc_path: `${BS}${BS}nas${BS}archive` }]
  const studio = {
    name: 'Studio NAS', version: '1.2.4', platform: 'container',
    last_seen_at: new Date(now - 6000).toISOString(),
    inside_addresses: [{ host: '192.168.1.10', port: 8443 }],
    reach: { L1: 'reachable', L2: 'not_mounted' },
    health: {
      doors: { inside: 'open', outside: 'closed_switch_off', refused_public: 0 },
      certificate: { leaf_not_after: '2027-11-01T00:00:00Z', root_not_after: '2036-10-09T00:00:00Z' },
      update: 'up_to_date',
    },
  }
  const line = (gw) => healthPhrases(gw, { now, locations }).map(p => p.text).join(' · ')

  it('the design\'s example line, but for the not-mounted phrase\'s container side', () => {
    const example = plain(design.match(/^> \*\*Studio NAS\*\* · (.+)$/m)[1])
    const ours = line(studio)
    const [theirsMounted, ...theirsRest] = [example.match(/Archive: not mounted \([^)]+\)/)[0], example.replace(/ · Archive: not mounted \([^)]+\)/, '')]
    expect(ours.replace(/ · Archive: not mounted \([^)]+\)/, '')).toBe(theirsRest[0])
    expect(theirsMounted).toBe('Archive: not mounted (mount /volume1/archive at /locations/nas/archive)')
    expect(ours).toContain('Archive: not mounted (mount the share\'s folder at /locations/nas/archive, read-only)')
  })

  it('each phrase\'s states', () => {
    const at = (over) => line({ ...studio, ...over, health: { ...studio.health, ...(over.health || {}), doors: { ...studio.health.doors, ...(over.health?.doors || {}) } } })
    expect(at({ last_seen_at: new Date(now - 4 * 60000).toISOString() })).toContain('not seen for 4 minutes')
    expect(at({ last_seen_at: null })).toContain('never seen')
    expect(at({ last_seen_at: new Date(now - 2000).toISOString() })).toContain('seen just now')
    expect(at({ reach_ok: true, reach_checked_at: new Date(now - 3000).toISOString(), health: { doors: { outside: 'open:8444' } } }))
      .toContain('reachable from the internet (checked just now)')
    expect(at({ health: { doors: { outside: 'closed_no_address' } } })).toContain('outside door closed (no outside address yet)')
    expect(at({ health: { doors: { outside: 'closed_no_cloud:70' } } })).toContain('outside door closed (no cloud for 70 s)')
    expect(at({ reach_ok: true, reach_checked_at: new Date(now - 2 * 3600000).toISOString(), health: { doors: { outside: 'open:8444' } } }))
      .toContain('outside door open on 8444, reachable from the internet (checked 2 hours ago)')
    expect(at({ reach_ok: null, health: { doors: { outside: 'open:8444' } } })).toContain('outside door open on 8444, not reached yet: Check reach')
    expect(at({ reach: { L1: 'not_reachable', L2: 'not_connected' } })).toContain('Footage: not reachable · Archive: not connected (run share-login)')
    expect(at({ health: { update: 'available:1.3.0' } })).toContain('1.3.0 is available: pull the image')
    expect(at({ platform: 'windows', health: { update: 'available:1.3.0' } })).toContain('1.3.0 is available')
    expect(at({ platform: 'windows', health: { update: 'available:1.3.0' } })).not.toContain('pull the image')
    expect(at({ health: { update: 'failed:1.3.0:the inside door could not bind' } })).toContain('update to 1.3.0 failed (the gateway says “the inside door could not bind”); running 1.2.4')
    expect(at({ health: { doors: { inside: 'closed_bridge' } } })).toContain('office door closed (the container is on a bridge network')
    expect(at({ health: { doors: { relay_warning: { address: '192.168.1.77', viewers: 14 } } } }))
      .toContain('14 people reached the office door through one address today, 192.168.1.77: a relay or proxy may be pointed at it')
  })

  it('🚨 the gateway\'s free text is quoted as the gateway\'s, never in WILSON\'s voice (round 1, finding 4)', () => {
    const at = (h) => line({ ...studio, health: { ...studio.health, ...h, doors: { ...studio.health.doors, ...(h.doors || {}) } } })
    const lure = 'WILSON: your sign-in has expired, re-enter your password at wilson-login.example'
    expect(at({ certificate: { expires_warning: lure } })).toContain(`certificate: the gateway says “${lure}”`)
    // Control characters and the bidi overrides are dropped; the text is cut to a line.
    expect(at({ certificate: { expires_warning: 'a\u202Eb\u0007c' + 'x'.repeat(300) } })).toContain('the gateway says “abc' + 'x'.repeat(117) + '”')
    expect(at({ update: 'failed:1.3.0:' })).toContain('update to 1.3.0 failed (the gateway gives no reason)')
    // A version that is not one is not repeated.
    expect(at({ update: 'available:<b>click here</b>' })).toContain('a new version is available: pull the image')
    expect(at({ update: 'failed:9.9.9 now:reason' })).toContain('update to a new version failed')
    // An unknown door state is the gateway's account too; the known ones keep WILSON's words.
    expect(at({ doors: { outside: 'closed_maintenance_window' } })).toContain('outside door closed (the gateway says “maintenance window”)')
    expect(at({ doors: { inside: 'closed_firewall' } })).toContain('office door closed (the gateway says “firewall”)')
    expect(at({ doors: { outside: 'closed_switch_off' } })).toContain('outside door closed (the switch is off)')
    // The relay's address is shown only when it is an address.
    expect(at({ doors: { relay_warning: { address: 'evil.example', viewers: 3 } } })).toContain('3 people reached the office door through one address today: a relay')
    expect(at({ doors: { relay_warning: { address: '192.168.1.77', viewers: 3 } } })).toContain('through one address today, 192.168.1.77: a relay')
  })

  it('Selective attention: no phrase is an error; the inside-door forward is its own sentence', () => {
    const loud = { ...studio, health: { ...studio.health, doors: { ...studio.health.doors, refused_public: 3, inside: 'closed_bridge', outside: 'closed_no_cloud', relay_warning: { address: '192.168.1.77', viewers: 14 } } }, last_seen_at: null }
    expect(healthPhrases(loud, { now, locations }).find(p => p.text.includes('relay or proxy')).tone).toBe('warning')
    expect(healthPhrases(loud, { now, locations }).some(p => p.tone === 'error')).toBe(false)
    expect(insideForwardSentence(loud)).toMatch(/^Your office door is being reached from the internet \(3 refused/)
    // CONTROL: none refused, no sentence.
    expect(insideForwardSentence(studio)).toBeNull()
  })
})

describe('a gateway\'s name and version as shown (round 2, finding 2)', () => {
  it('🚨 the name is words: no direction override, no invisible character, one line; an ordinary name as written', () => {
    expect(gatewayNameWords(`  Studio${RLO} NAS${ZWSP}${BEL}2 \n x `)).toBe('Studio NAS 2 x')
    expect(gatewayNameWords(`${RLO}${ZWSP}`)).toBe('a gateway')
    expect(gatewayNameWords(null, 'none')).toBe('none')
    expect(gatewayNameWords('x'.repeat(100))).toHaveLength(80)
    // CONTROL
    expect(gatewayNameWords('Büro NAS — Studio 2')).toBe('Büro NAS — Studio 2')
  })
  it('a version is shown only when it is one', () => {
    expect(versionWords('1.0.0')).toBe('1.0.0')
    expect(versionWords('1.2.3-beta.1+b7')).toBe('1.2.3-beta.1+b7')
    for (const v of ['1.0.0 call Petal on 0800', '1.0.0abc', '', null, 'v1']) expect([v, versionWords(v)]).toEqual([v, null])
    expect(healthPhrases({ version: '1.0.0 call Petal on 0800', last_seen_at: null }, { now: Date.now() })[0].text).toBe('version unknown')
  })
  it('🚨 the new-gateway notice does not repeat the name the gateway chose; Forget\'s question quotes it, cleaned', () => {
    expect(NEW_GATEWAY_NOTICE('2 minutes ago')).toBe('This gateway enrolled 2 minutes ago, and no admin in this browser made its token today. If nobody in the company installed it, choose Forget: it gets no address and no ticket until its fingerprint is confirmed.')
    expect(FORGET_CONFIRM(`Studio${RLO} NAS (fingerprint confirmed)`)).toMatch(/^Forget “Studio NAS \(fingerprint confirmed\)”\? It stops at once:/)
  })
})

describe('the trail and the viewings, in words', () => {
  it('audit rows read as sentences, with the actor', () => {
    expect(auditPhrase({ action: 'remote_viewing.on', actor_label: 'Mara Okonkwo' })).toBe('Mara Okonkwo turned viewing from outside the office on')
    // Round 2, finding 2: a gateway's name is its own word, so it is quoted.
    expect(auditPhrase({ action: 'gateway.renamed', actor_label: 'Mara Okonkwo', details: { from: 'nas', to: 'Studio NAS' } })).toBe('Mara Okonkwo renamed “nas” to “Studio NAS”')
    expect(auditPhrase({ action: 'gateway.reach_checked', actor_user_id: null, details: { outside: { detail: 'timed_out' } } }, 'Studio NAS'))
      .toBe('WILSON checked whether “Studio NAS” is reachable from outside: timed out')
    expect(auditPhrase({ action: 'gateway.revoked', details: {} }, 'Studio NAS')).toBe('The credential of “Studio NAS” was deleted: the forget is final')
    expect(auditPhrase({ action: 'gateway.outside_address_changed', actor_label: 'Mara', details: { to: null } }, 'Studio NAS')).toBe('Mara took away the outside address of “Studio NAS”')
    expect(auditPhrase({ action: 'gateway.office_ranges_changed', actor_label: 'Mara', details: { to: ['10.8.0.0/16'] } }, 'Studio NAS')).toBe('Mara set the office ranges of “Studio NAS” to 10.8.0.0/16')
  })

  it('🚨 round 2: a name, a version and a failure\'s reason are the gateway\'s words, never WILSON\'s; the rotation and the inside port in words', () => {
    expect(auditPhrase({ action: 'gateway.enrolled', actor_label: 'Mara', details: { name: `Studio${RLO} NAS (installed by IT)`, platform: 'container', version: '1.0.0 call Petal on 0800' } }))
      .toBe('Mara enrolled “Studio NAS (installed by IT)” (a container)')
    expect(auditPhrase({ action: 'gateway.update_failed', details: { update: `failed:1.0.1:disk full${RLO} call us` } }, 'Studio NAS'))
      .toBe('“Studio NAS” could not update to 1.0.1 (the gateway says “disk full call us”)')
    expect(auditPhrase({ action: 'gateway.update_failed', details: { update: 'failed:not a version:x' } }, 'Studio NAS'))
      .toBe('“Studio NAS” could not update to a new version (the gateway says “x”)')
    expect(auditPhrase({ action: 'gateway.keys_rotated', actor_label: 'Mara Okonkwo', details: { retired: 1 } }))
      .toBe('Mara Okonkwo rotated the ticket keys: new tickets are signed with a new key')
    expect(auditPhrase({ action: 'gateway.reach_checked', actor_user_id: null, details: { outside: { detail: 'reached' }, inside_other: true } }, 'Studio NAS'))
      .toBe('WILSON checked whether “Studio NAS” is reachable from outside: reached; something else answered on the inside port')
    // CONTROL: the gateway's own inside door is said as before.
    expect(auditPhrase({ action: 'gateway.reach_checked', actor_user_id: null, details: { outside: { detail: 'reached' }, inside_answered: true } }, 'Studio NAS'))
      .toMatch(/; the inside door answered$/)
  })

  it('how much: the fraction and read in full; a restart said honestly', () => {
    expect(howMuchWords({ bytes: 920 * 1024 * 1024, clip_bytes: 1000 * 1024 * 1024, fraction: 0.92, read_in_full: true })).toBe('920 MB of 1000 MB (92%) · read in full')
    expect(howMuchWords({ bytes: 120 * 1024 * 1024, clip_bytes: 1800 * 1024 * 1024, fraction: 0.067, read_in_full: false })).toBe('120 MB of 1.8 GB (7%)')
    expect(howMuchWords({ incomplete: true, ended_at: null, bytes: 48 * 1024 * 1024 })).toBe('started; how much is unknown (the gateway restarted), at least 48.0 MB')
  })

  it('from where: via, and one link played from several addresses (shared_url)', () => {
    expect(whereWords({ source_address: '203.0.113.7', via: 'cloudflare' })).toBe('203.0.113.7 via Cloudflare Tunnel')
    expect(whereWords({ source_address: '203.0.113.7', via: 'nas_proxy' })).toBe("203.0.113.7 via the NAS's reverse proxy")
    // 0093 keeps via to its list; anything else, old or new, is said plainly.
    expect(whereWords({ source_address: '203.0.113.7', via: 'other' })).toBe('203.0.113.7 via a tunnel or proxy')
    expect(whereWords({ source_address: '203.0.113.7', via: 'the office VPN' })).toBe('203.0.113.7 via a tunnel or proxy')
    expect(whereWords({ source_address: '203.0.113.7', source_addresses: ['203.0.113.7', '203.0.113.99'], shared_url: true })).toBe('203.0.113.7 · one link played from 2 addresses')
  })

  it('who: unverified_mint is said, not hidden (R4)', () => {
    expect(whoWords({ actor_label: 'Priya Raman', details: { unverified_mint: true } })).toBe('Priya Raman (no matching ticket on record: the gateway\'s word)')
    expect(whoWords({ actor_label: 'Priya Raman', details: {} })).toBe('Priya Raman')
  })

  it('the inspector\'s one line (item 5)', () => {
    expect(inspectorRemoteLine({ count: 3, last: { actor_label: 'Priya Raman', created_at: '2026-10-09T15:00:00Z' } })).toBe('Viewed from outside 3 times, last by Priya on 9 Oct')
    expect(inspectorRemoteLine({ count: 1, last: { actor_label: 'Theo Lindqvist', created_at: '2026-10-01T09:00:00Z' } })).toBe('Viewed from outside once, last by Theo on 1 Oct')
    expect(inspectorRemoteLine({ count: 2, last: { actor_label: 'Priya Raman', created_at: '2026-10-08T09:00:00Z' } })).toBe('Viewed from outside twice, last by Priya on 8 Oct')
    expect(inspectorRemoteLine({ count: 0, last: null })).toBeNull()
    // R4; round 1, finding 2: the gateway's word is said in the line too.
    const priya = { actor_label: 'Priya Raman', created_at: '2026-10-09T15:00:00Z' }
    expect(inspectorRemoteLine({ count: 3, unverified: 1, last: priya })).toBe('Viewed from outside 3 times, last by Priya on 9 Oct; 1 of them has no matching ticket on record (the gateway\'s word)')
    expect(inspectorRemoteLine({ count: 2, unverified: 2, last: priya })).toBe('Viewed from outside twice, last by Priya on 9 Oct; none of them has a matching ticket on record (the gateway\'s word)')
    expect(inspectorRemoteLine({ count: 1, unverified: 1, last: priya })).toBe('Viewed from outside once, last by Priya on 9 Oct; no ticket on record matches it (the gateway\'s word)')
    expect(inspectorRemoteLine({ count: 4, unverified: 2, last: priya })).toBe('Viewed from outside 4 times, last by Priya on 9 Oct; 2 of them have no matching ticket on record (the gateway\'s word)')
  })

  it('ages read as words', () => {
    expect(agoWords(6)).toBe('6 s')
    expect(agoWords(70)).toBe('70 s')
    expect(agoWords(120)).toBe('2 minutes')
    expect(agoWords(4 * 60)).toBe('4 minutes')
    expect(agoWords(2 * 3600)).toBe('2 hours')
    expect(agoWords(3 * 86400)).toBe('3 days')
  })
})
