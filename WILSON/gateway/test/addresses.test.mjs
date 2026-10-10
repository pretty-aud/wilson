// =============================================================================
// addresses.test.mjs — ip.mjs, peers.mjs and interfaces.mjs with injected
// peers and interfaces: everything this computer cannot produce itself (a
// public peer, a VPN, a Docker bridge, a NAS's interfaces, a forwarded
// header) is proven here; the socket-level proofs with this computer's own
// two peers are in doorsInside.test.mjs.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { parseIp, formatIp, normalizeIp, sameIp, parseCidr, cidrContains, classifyIp, surroundingNet, formatCidr } from '../src/rules/ip.mjs';
import { classifyInsidePeer, hasProxyHeader, PROXY_HEADERS, validateOfficeRanges, outsideSource, lastForwardedHop } from '../src/rules/peers.mjs';
import { chooseInsideAddresses, isVethLike, SENTENCES } from '../src/rules/interfaces.mjs';

describe('ip.mjs', () => {
  it('parses IPv4 strictly (no leading zeros) and IPv6 in every spelling', () => {
    expect(formatIp(parseIp('192.168.1.10'))).toBe('192.168.1.10');
    expect(parseIp('192.168.001.10')).toBeNull();
    expect(parseIp('0x7f.0.0.1')).toBeNull();
    expect(parseIp('2130706433')).toBeNull();
    expect(parseIp('300.1.1.1')).toBeNull();
    expect(formatIp(parseIp('FD12:3456:789A:1::1'))).toBe('fd12:3456:789a:1::1');
    expect(formatIp(parseIp('fe80::1%eth0'))).toBe('fe80::1');
    expect(formatIp(parseIp('[::1]'))).toBe('::1');
    expect(formatIp(parseIp('::'))).toBe('::');
    expect(formatIp(parseIp('1::'))).toBe('1::');
    expect(formatIp(parseIp('1:0:0:2:0:0:0:3'))).toBe('1:0:0:2::3');
    expect(parseIp('not an address')).toBeNull();
    expect(parseIp(undefined)).toBeNull();
  });
  it('folds an IPv4-mapped IPv6 peer to IPv4, as a dual-stack socket reports one', () => {
    expect(parseIp('::ffff:192.168.1.20')).toEqual({ family: 4, bytes: Uint8Array.from([192, 168, 1, 20]) });
    expect(normalizeIp('::ffff:c0a8:0114')).toBe('192.168.1.20');
    expect(sameIp('::ffff:127.0.0.1', '127.0.0.1')).toBe(true);
  });
  it('classifies', () => {
    const c = (s) => classifyIp(s);
    expect([c('127.0.0.1'), c('127.255.0.9'), c('::1')]).toEqual(['loopback', 'loopback', 'loopback']);
    expect([c('10.1.2.3'), c('172.16.0.1'), c('172.31.255.255'), c('192.168.0.1')]).toEqual(['private', 'private', 'private', 'private']);
    expect([c('172.15.0.1'), c('172.32.0.1'), c('8.8.8.8'), c('100.64.1.1')]).toEqual(['global', 'global', 'global', 'cgnat']);
    expect([c('169.254.1.1'), c('fe80::9'), c('fd00::1'), c('fc00::1'), c('2001:db8::1')]).toEqual(['link_local', 'link_local', 'ula', 'ula', 'global']);
    expect([c('224.0.0.1'), c('ff02::1'), c('0.0.0.0'), c('::'), c('203.0.113.9')]).toEqual(['multicast', 'multicast', 'unspecified', 'unspecified', 'reserved']);
  });
  it('contains by prefix, never across families', () => {
    expect(cidrContains('192.168.1.0/24', '192.168.1.200')).toBe(true);
    expect(cidrContains('192.168.1.0/24', '192.168.2.1')).toBe(false);
    expect(cidrContains('fd00::/64', 'fd00::abcd')).toBe(true);
    expect(cidrContains('0.0.0.0/0', '::1')).toBe(false);
    expect(formatCidr(parseCidr('192.168.1.77/24'))).toBe('192.168.1.0/24');
    expect(parseCidr('192.168.1.0/33')).toBeNull();
    expect(parseCidr('192.168.1.0')).toBeNull();
    expect(parseCidr('192.168.1.0/x')).toBeNull();
  });
  it('the /24 and /64 around an address (D26)', () => {
    expect(formatCidr(surroundingNet('10.20.30.40'))).toBe('10.20.30.0/24');
    expect(formatCidr(surroundingNet('fd12:3456:789a:1:2:3:4:5'))).toBe('fd12:3456:789a:1::/64');
  });
});

describe('peers.mjs: the inside door admits the office and nothing else', () => {
  const ctx = { ownAddresses: ['192.168.1.10', 'fd00::10', '172.17.0.1'], coLocatedNets: ['172.17.0.0/16', '172.29.64.0/20'], officeRanges: ['10.8.0.0/24'] };
  const r = (peer) => classifyInsidePeer(peer, ctx);
  it('admits private, unique-local and link-local peers', () => {
    expect(r('192.168.1.55')).toEqual({ admit: true, cls: 'private' });
    expect(r('::ffff:192.168.1.55').admit).toBe(true);
    expect(r('fd00::55').admit).toBe(true);
    expect(r('169.254.7.7').admit).toBe(true);
  });
  it('closes loopback, every spelling', () => {
    for (const p of ['127.0.0.1', '127.0.0.2', '::1', '::ffff:127.0.0.1']) expect(r(p)).toMatchObject({ admit: false, reason: 'loopback' });
  });
  it("closes the gateway's own addresses (a co-located daemon always arrives from one)", () => {
    expect(r('192.168.1.10')).toMatchObject({ admit: false, reason: 'own_address' });
    expect(r('::ffff:192.168.1.10')).toMatchObject({ admit: false, reason: 'own_address' });
    expect(r('fd00::10')).toMatchObject({ admit: false, reason: 'own_address' });
  });
  it("closes a container or VM on this host's own bridges (a sibling relay container)", () => {
    expect(r('172.17.0.2')).toMatchObject({ admit: false, reason: 'co_located' });
    expect(r('172.29.70.3')).toMatchObject({ admit: false, reason: 'co_located' });
  });
  it('closes public, CGNAT and reserved peers; a declared office range admits only what it covers', () => {
    expect(r('8.8.8.8')).toMatchObject({ admit: false, reason: 'public' });
    expect(r('100.64.0.9')).toMatchObject({ admit: false, reason: 'public' });
    expect(r('2001:db8::1')).toMatchObject({ admit: false, reason: 'public' });
    expect(r('10.8.0.7')).toEqual({ admit: true, cls: 'private' });
    expect(r('garbage')).toMatchObject({ admit: false, reason: 'unparseable' });
  });
  it('an office range admits a non-private peer only inside the range', () => {
    const odd = classifyInsidePeer('100.64.0.9', { officeRanges: ['100.64.0.0/24'] });
    expect(odd).toEqual({ admit: true, cls: 'office_range' });
  });
  it('every proxy header is seen, even empty, and an ordinary request carries none', () => {
    expect(PROXY_HEADERS).toEqual(expect.arrayContaining(['x-forwarded-for', 'forwarded', 'x-real-ip', 'via', 'cf-connecting-ip']));
    for (const h of PROXY_HEADERS) expect(hasProxyHeader({ host: 'x', [h]: '' }), h).toBe(true);
    expect(hasProxyHeader({ host: 'x', range: 'bytes=0-', origin: 'https://wilson.app' })).toBe(false);
    expect(hasProxyHeader(null)).toBe(false);
  });
});

describe('peers.mjs: office ranges (D21)', () => {
  it('private, at most eight, none wider than a /16 (IPv6: a /48)', () => {
    const { applied, refused } = validateOfficeRanges(['10.8.0.0/24', '192.168.50.0/16', '0.0.0.0/0', '10.0.0.0/8', '8.8.8.0/24', 'fd00:1::/48', 'fd00::/8', '2001:db8::/64', 'nope']);
    expect(applied).toEqual(['10.8.0.0/24', '192.168.0.0/16', 'fd00:1::/48']);
    expect(refused.map((x) => x.reason)).toEqual(['not_private', 'wider_than_16', 'not_private', 'wider_than_48', 'not_private', 'not_a_range']);
  });
  it('a ninth range is refused', () => {
    const many = Array.from({ length: 9 }, (_, i) => `10.${i}.0.0/24`);
    const { applied, refused } = validateOfficeRanges(many);
    expect(applied).toHaveLength(8);
    expect(refused).toEqual([{ range: '10.8.0.0/24', reason: 'more_than_eight' }]);
  });
  it('anything but an array applies nothing', () => {
    expect(validateOfficeRanges('10.0.0.0/24')).toEqual({ applied: [], refused: [] });
  });
});

describe('peers.mjs: the outside source address and via', () => {
  const proxy = { addresses: ['127.0.0.1', '::1'], name: 'local_proxy' };
  it('the peer, direct, when there is no declared proxy, whatever headers say', () => {
    expect(outsideSource({ peer: '203.0.113.7', headers: { 'x-forwarded-for': '10.0.0.1' } })).toEqual({ address: '203.0.113.7', via: 'direct' });
  });
  it('a forwarded header is read only when the peer IS the declared proxy', () => {
    expect(outsideSource({ peer: '127.0.0.1', headers: { 'x-forwarded-for': '198.51.100.1, 203.0.113.7' }, declaredProxy: proxy })).toEqual({ address: '203.0.113.7', via: 'local_proxy' });
    expect(outsideSource({ peer: '192.168.1.99', headers: { 'x-forwarded-for': '203.0.113.7' }, declaredProxy: proxy })).toEqual({ address: '192.168.1.99', via: 'direct' });
  });
  it("CF-Connecting-IP wins over X-Forwarded-For; a garbage value is not taken", () => {
    expect(outsideSource({ peer: '::1', headers: { 'cf-connecting-ip': '2001:db8::7', 'x-forwarded-for': '203.0.113.7' }, declaredProxy: proxy })).toEqual({ address: '2001:db8::7', via: 'local_proxy' });
    expect(outsideSource({ peer: '127.0.0.1', headers: { 'x-forwarded-for': 'evil<script>' }, declaredProxy: proxy })).toEqual({ address: '127.0.0.1', via: 'local_proxy (no forwarded address)' });
    expect(lastForwardedHop(['1.1.1.1', '2.2.2.2'])).toBe('2.2.2.2');
    expect(lastForwardedHop('')).toBeNull();
  });
});

describe('interfaces.mjs: which addresses the inside door binds', () => {
  const ni = (address, cidr, extra = {}) => ({ address, family: address.includes(':') ? 'IPv6' : 'IPv4', internal: false, cidr, ...extra });
  const lo = [{ address: '127.0.0.1', family: 'IPv4', internal: true, cidr: '127.0.0.1/8' }, { address: '::1', family: 'IPv6', internal: true, cidr: '::1/128' }];

  it('this PC: the wired adapter, never loopback or its link-local address', () => {
    const r = chooseInsideAddresses({ platform: 'win32', interfaces: {
      'Ethernet 5': [ni('fe80::1d7d:5b25:98d5:852f', 'fe80::1d7d:5b25:98d5:852f/64'), ni('192.168.1.173', '192.168.1.173/24')],
      'Loopback Pseudo-Interface 1': lo,
    }, adapters: new Map([['Ethernet 5', { hardware: true, description: 'Intel(R) Ethernet Connection (22) I219-V' }]]) });
    expect(r.addresses).toEqual([{ address: '192.168.1.173', family: 4, iface: 'Ethernet 5' }]);
    expect(r.ownAddresses).toEqual(expect.arrayContaining(['192.168.1.173', '127.0.0.1', '::1', 'fe80::1d7d:5b25:98d5:852f']));
    expect(r.refused).toEqual([{ iface: 'Ethernet 5', address: 'fe80::1d7d:5b25:98d5:852f', reason: 'link-local' }]);
    expect(r.closed).toBeNull();
  });
  it('a Windows PC with Hyper-V, WSL, a VPN and VirtualBox: only the hardware adapter; the VM switches become co-located nets', () => {
    const r = chooseInsideAddresses({ platform: 'win32', interfaces: {
      'Wi-Fi': [ni('192.168.0.23', '192.168.0.23/24'), ni('2a02:1234::23', '2a02:1234::23/64'), ni('fd5e::23', 'fd5e::23/64')],
      'vEthernet (WSL)': [ni('172.29.64.1', '172.29.64.1/20')],
      'vEthernet (Default Switch)': [ni('172.25.0.1', '172.25.0.1/20')],
      'Tailscale': [ni('100.101.102.103', '100.101.102.103/32')],
      'OpenVPN Data Channel Offload': [ni('10.8.0.6', '10.8.0.6/24')],
      'VirtualBox Host-Only Network': [ni('192.168.56.1', '192.168.56.1/24')],
      'Ethernet 2': [ni('10.0.0.5', '10.0.0.5/24')],
    }, adapters: new Map([['Wi-Fi', { hardware: true }], ['Ethernet 2', { hardware: false, description: 'Some Virtual NIC' }]]) });
    expect(r.addresses.map((a) => a.address)).toEqual(['192.168.0.23', 'fd5e::23']);
    expect(r.coLocatedNets).toEqual(['172.29.64.0/20', '172.25.0.0/20', '192.168.56.0/24']);
    const why = Object.fromEntries(r.refused.map((x) => [x.address, x.reason]));
    expect(why['2a02:1234::23']).toBe('global IPv6 (publicly routable)');
    expect(why['100.101.102.103']).toBe('VPN adapter');
    expect(why['10.8.0.6']).toBe('VPN adapter');
    expect(why['10.0.0.5']).toBe('virtual adapter');
  });
  it('a NAS on the host network: eth0 and the bond bind; docker0 and br-* are co-located nets', () => {
    const r = chooseInsideAddresses({ platform: 'linux', interfaces: {
      lo, eth0: [ni('192.168.1.10', '192.168.1.10/24')], bond0: [ni('10.0.0.2', '10.0.0.2/16')],
      docker0: [ni('172.17.0.1', '172.17.0.1/16')], 'br-3f9a2c41bd02': [ni('172.18.0.1', '172.18.0.1/16')], tun0: [ni('10.9.0.1', '10.9.0.1/24')],
    }, linuxFacts: { available: true, byName: { eth0: { ifindex: 2, iflink: 2 }, bond0: { ifindex: 3, iflink: 3, devtype: 'bond' }, docker0: { ifindex: 4, iflink: 4, devtype: 'bridge' }, 'br-3f9a2c41bd02': { ifindex: 5, iflink: 5, devtype: 'bridge' }, tun0: { ifindex: 6, iflink: 6 } } }, inImage: true });
    expect(r.closed).toBeNull();
    expect(r.addresses.map((a) => a.address)).toEqual(['192.168.1.10', '10.0.0.2']);
    expect(r.coLocatedNets).toEqual(['172.17.0.0/16', '172.18.0.0/16']);
  });
  it('the container on the default bridge: no inside door, and the sentence says why (D24)', () => {
    const r = chooseInsideAddresses({ platform: 'linux', inImage: true, interfaces: { lo, eth0: [ni('172.17.0.2', '172.17.0.2/16')] },
      linuxFacts: { available: true, byName: { eth0: { ifindex: 9, iflink: 10 } } } });
    expect(r).toMatchObject({ addresses: [], closed: 'bridge', sentence: SENTENCES.bridge });
  });
  it('a user-defined bridge (172.18.x, or 192.168.x from the pool) is a bridge too: told by the veth, not the address', () => {
    for (const addr of ['172.18.0.2', '192.168.16.2']) {
      const r = chooseInsideAddresses({ platform: 'linux', inImage: true, interfaces: { lo, eth0: [ni(addr, `${addr}/20`)] },
        linuxFacts: { available: true, byName: { eth0: { ifindex: 31, iflink: 32 } } } });
      expect(r.closed, addr).toBe('bridge');
    }
  });
  it('a container that cannot read /sys/class/net cannot tell, so stays closed; one with no network says so', () => {
    expect(chooseInsideAddresses({ platform: 'linux', inImage: true, interfaces: { lo, eth0: [ni('192.168.1.10', '192.168.1.10/24')] }, linuxFacts: { available: false, byName: {} } }).closed).toBe('no_sysfs');
    expect(chooseInsideAddresses({ platform: 'linux', inImage: true, interfaces: { lo } }).closed).toBe('no_network');
  });
  it('a VLAN or a macvlan is not mistaken for a veth', () => {
    expect(isVethLike({ ifindex: 7, iflink: 2, devtype: 'vlan' })).toBe(false);
    expect(isVethLike({ ifindex: 7, iflink: 2, devtype: 'macvlan' })).toBe(false);
    expect(isVethLike({ ifindex: 7, iflink: 8 })).toBe(true);
    expect(isVethLike({ ifindex: 7, iflink: 7 })).toBe(false);
    expect(isVethLike(undefined)).toBeNull();
  });
  it('a pin binds only private addresses present on this host, never a bridge-only container', () => {
    const interfaces = { 'Ethernet 5': [ni('192.168.1.173', '192.168.1.173/24'), ni('10.0.0.9', '10.0.0.9/24')], lo };
    const r = chooseInsideAddresses({ platform: 'win32', interfaces, pinned: ['10.0.0.9', '127.0.0.1', '192.168.9.9', '8.8.8.8', 'x'] });
    expect(r.addresses).toEqual([{ address: '10.0.0.9', family: 4, iface: 'pinned' }]);
    expect(r.refused.filter((x) => x.iface === 'pinned').map((x) => x.reason)).toEqual(['not private (loopback)', 'not on this host', 'not private (global)', 'not an address']);
    const bridged = chooseInsideAddresses({ platform: 'linux', inImage: true, interfaces: { lo, eth0: [ni('172.18.0.2', '172.18.0.2/16')] }, linuxFacts: { available: true, byName: { eth0: { ifindex: 1, iflink: 2 } } }, pinned: ['172.18.0.2'] });
    expect(bridged.closed).toBe('bridge');
  });
  it('no address at all: closed with the sentence', () => {
    const r = chooseInsideAddresses({ platform: 'win32', interfaces: { lo } });
    expect(r).toMatchObject({ addresses: [], closed: 'no_address', sentence: SENTENCES.no_address });
  });
});

describe('interfaces.mjs: the edges', () => {
  const ni = (address, cidr) => ({ address, family: 'IPv4', internal: false, cidr });
  it('Docker\'s default bridge address is never a door, whatever the interface is called', () => {
    const r = chooseInsideAddresses({ platform: 'linux', interfaces: { eth1: [ni('172.17.5.5', '172.17.5.5/16')], eth0: [ni('192.168.1.10', '192.168.1.10/24')] } });
    expect(r.addresses.map((a) => a.address)).toEqual(['192.168.1.10']);
    expect(r.refused).toEqual([{ iface: 'eth1', address: '172.17.5.5', reason: "Docker's default bridge (172.17.0.0/16)" }]);
    expect(r.coLocatedNets).toContain('172.17.0.0/16');
  });
  it('in the image, an interface /sys says nothing about cannot prove host networking: closed as a bridge', () => {
    const r = chooseInsideAddresses({ platform: 'linux', inImage: true, interfaces: { eth0: [ni('192.168.1.10', '192.168.1.10/24')] }, linuxFacts: { available: true, byName: {} } });
    expect(r.closed).toBe('bridge');
  });
});
