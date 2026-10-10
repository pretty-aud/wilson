// =============================================================================
// The interface rule (design §2's table, review round 2's R1): which of this
// host's addresses the INSIDE door binds. Pure: the facts are injected
// (os.networkInterfaces(), Windows' adapter list, Linux's /sys/class/net).
//
//   bind     RFC 1918 IPv4 and unique-local IPv6 (fc00::/7) of physical or
//            host-level interfaces only; never a container bridge (docker0,
//            br-*, veth*, 172.17.0.0/16 and its kin), a VPN or virtual
//            adapter, a link-local address or a global IPv6 address; never
//            0.0.0.0. An admin may pin the list in config.json; a pin still
//            has to be a private or unique-local address present on this host.
//   own      every address of every interface (loopback, VPN, bridges
//            included): a peer arriving from one of them is this host.
//   co-located nets  the subnets of this host's container and VM bridges: a
//            peer from one is a container or VM on this host (peers.mjs).
//   bridge   a container whose only network is a bridge keeps the inside door
//            closed and says why (D24); so does one that cannot read its
//            interfaces, since it then cannot tell.
// =============================================================================

import { parseIp, classifyIp, parseCidr, formatCidr, cidrContains, formatIp } from './ip.mjs';

// Container and VM bridges: a peer from their subnets is co-located.
const CO_LOCATED_LINUX_RE = /^(docker\d*|br-[0-9a-f]{6,}|veth|virbr|vnet\d|vmnet|vboxnet|lxcbr|lxdbr|incusbr|cni|flannel|cali|weave|podman|kube-bridge|cbr0)/i;
const CO_LOCATED_WINDOWS_RE = /vEthernet|VirtualBox|VMware|Hyper-V|\bWSL\b|Docker/i;
// VPN tunnels: not bound (a door is for the office LAN), but their peers are
// NOT blocked: a person on the company's VPN is inside by design (§6).
const VPN_RE = /^(tun|tap|wg|tailscale|zt|utun|ppp|ipsec|nordlynx)\d*|Tailscale|ZeroTier|WireGuard|OpenVPN|TAP-Windows|AnyConnect|Cisco|Fortinet|GlobalProtect|PANGP|Juniper|NordLynx|Pulse Secure|\bVPN\b/i;
const OTHER_VIRTUAL_RE = /Npcap|Loopback|Bluetooth|Teredo|isatap|6to4|IP-HTTPS|Kernel Debug|WAN Miniport/i;
const DOCKER_DEFAULT_BRIDGE = parseCidr('172.17.0.0/16');
const PAIRED_DEVTYPES = new Set(['vlan', 'macvlan', 'ipvlan', 'macvtap', 'bond', 'bridge']);

export const SENTENCES = Object.freeze({
  bridge: 'This gateway’s container is on a bridge network, so it cannot see browsers’ real addresses: the office door stays closed. Run it on the host’s network (Container Manager: use the same network as Docker Host).',
  no_sysfs: 'This container cannot read its network interfaces (/sys/class/net), so it cannot tell whether it is on the host’s network: the office door stays closed.',
  no_network: 'This gateway has no network apart from loopback: the office door stays closed.',
  no_address: 'No office network address on this computer: the office door stays closed. Connect it to the office network by cable or Wi-Fi (a VPN or virtual adapter does not count), or pin an address in config.json.',
});

/** A Linux interface is a veth (one end of a container's pair) when its link is elsewhere and it is no VLAN, macvlan, bond or bridge. */
export function isVethLike(facts) {
  if (!facts || facts.ifindex == null || facts.iflink == null) return null;
  return facts.ifindex !== facts.iflink && !PAIRED_DEVTYPES.has(String(facts.devtype || ''));
}

/**
 * @param {object} p
 * @param {Record<string, Array<{address:string,family:string|number,internal:boolean,cidr?:string}>>} p.interfaces os.networkInterfaces()
 * @param {'win32'|'linux'|string} p.platform
 * @param {Map<string,{hardware:boolean, description?:string}>|null} [p.adapters] Windows: Get-NetAdapter by name
 * @param {{available:boolean, byName:Record<string,{ifindex:number,iflink:number,devtype?:string}>}|null} [p.linuxFacts]
 * @param {boolean} [p.inImage] running inside the gateway's container image
 * @param {string[]} [p.pinned] config.json `inside.addresses`
 */
export function chooseInsideAddresses({ interfaces = {}, platform = process.platform, adapters = null, linuxFacts = null, inImage = false, pinned = null } = {}) {
  const own = [];
  const coLocatedNets = [];
  const candidates = [];
  const refused = [];
  let externalCount = 0;
  let vethCount = 0;
  const coLocatedRe = platform === 'win32' ? CO_LOCATED_WINDOWS_RE : CO_LOCATED_LINUX_RE;

  for (const [name, list] of Object.entries(interfaces || {})) {
    for (const a of list || []) {
      const ip = parseIp(a.address);
      if (!ip) continue;
      own.push(formatIp(ip));
      if (a.internal) continue;
      externalCount++;
      const adapter = adapters && adapters.get ? adapters.get(name) : null;
      const describe = `${name} ${adapter?.description || ''}`;
      const facts = linuxFacts?.byName?.[name];
      const veth = platform !== 'win32' ? isVethLike(facts) : false;
      const cidr = a.cidr ? parseCidr(a.cidr) : null;
      const reject = (reason) => refused.push({ iface: name, address: formatIp(ip), reason });

      if (coLocatedRe.test(describe) || veth === true) {
        if (cidr) coLocatedNets.push(formatCidr(cidr));
        if (veth === true) vethCount++;
        reject(veth === true ? 'container network (veth)' : 'container or VM bridge');
        continue;
      }
      if (VPN_RE.test(describe)) { reject('VPN adapter'); continue; }
      if (OTHER_VIRTUAL_RE.test(describe)) { reject('virtual adapter'); continue; }
      if (adapter && adapter.hardware === false) { reject('virtual adapter'); continue; }
      const cls = classifyIp(ip);
      if (ip.family === 4 && cidrContains(DOCKER_DEFAULT_BRIDGE, ip)) {
        if (cidr) coLocatedNets.push(formatCidr(cidr));
        reject("Docker's default bridge (172.17.0.0/16)");
        continue;
      }
      if (cls === 'link_local') { reject('link-local'); continue; }
      if (ip.family === 6 && cls !== 'ula') { reject(cls === 'global' ? 'global IPv6 (publicly routable)' : 'not unique-local'); continue; }
      if (ip.family === 4 && cls !== 'private') { reject(`not private (${cls})`); continue; }
      candidates.push({ address: formatIp(ip), family: ip.family, iface: name });
    }
  }

  const base = { ownAddresses: [...new Set(own)], coLocatedNets: [...new Set(coLocatedNets)], refused };

  // In the image, the door opens only when the interfaces prove host networking.
  if (inImage) {
    if (externalCount === 0) return { ...base, addresses: [], closed: 'no_network', sentence: SENTENCES.no_network };
    if (!linuxFacts || !linuxFacts.available) return { ...base, addresses: [], closed: 'no_sysfs', sentence: SENTENCES.no_sysfs };
    const hostLevel = Object.entries(interfaces).some(([n, list]) => (list || []).some((x) => !x.internal) && isVethLike(linuxFacts.byName?.[n]) === false);
    if (!hostLevel || (vethCount > 0 && candidates.length === 0)) return { ...base, addresses: [], closed: 'bridge', sentence: SENTENCES.bridge };
  }

  let addresses = candidates;
  if (Array.isArray(pinned) && pinned.length) {
    const present = new Map();
    for (const list of Object.values(interfaces || {})) for (const a of list || []) if (!a.internal) { const ip = parseIp(a.address); if (ip) present.set(formatIp(ip), ip); }
    addresses = [];
    for (const p of pinned) {
      const ip = parseIp(String(p));
      const text = ip ? formatIp(ip) : String(p).slice(0, 64);
      if (!ip) { refused.push({ iface: 'pinned', address: text, reason: 'not an address' }); continue; }
      const cls = classifyIp(ip);
      if (!(cls === 'private' || cls === 'ula')) { refused.push({ iface: 'pinned', address: text, reason: `not private (${cls})` }); continue; }
      if (!present.has(text)) { refused.push({ iface: 'pinned', address: text, reason: 'not on this host' }); continue; }
      addresses.push({ address: text, family: ip.family, iface: 'pinned' });
    }
  }
  if (addresses.length === 0) return { ...base, addresses: [], closed: 'no_address', sentence: SENTENCES.no_address };
  return { ...base, addresses, closed: null, sentence: null };
}
