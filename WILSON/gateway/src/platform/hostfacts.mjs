// =============================================================================
// Facts about this host's network the interface rule needs (interfaces.mjs),
// which Node's os.networkInterfaces() does not give.
//
//   Windows  Get-NetAdapter: which adapters are hardware (HardwareInterface),
//            measured on this computer: the wired Intel adapter True, every
//            WAN miniport, Bluetooth, Teredo and 6to4 adapter False.
//   Linux    /sys/class/net/<if>: ifindex, iflink and DEVTYPE, which tell a
//            container's veth (its link is in another namespace) from a
//            physical NIC, a bond, a bridge or a VLAN.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

/** Windows: Map(adapter name → { hardware, virtual, description }), or null when PowerShell cannot say. */
export function windowsAdapters({ spawnImpl = spawn, timeoutMs = 15_000 } = {}) {
  return new Promise((resolve) => {
    const cmd = 'Get-NetAdapter -IncludeHidden | Select-Object Name, InterfaceDescription, HardwareInterface, Virtual | ConvertTo-Json -Compress';
    let out = '';
    let child;
    try { child = spawnImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true }); } catch { resolve(null); return; }
    const timer = setTimeout(() => { child.kill(); resolve(null); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) { resolve(null); return; }
      try { resolve(parseAdapters(out)); } catch { resolve(null); }
    });
  });
}

export function parseAdapters(json) {
  const raw = JSON.parse(json);
  const list = Array.isArray(raw) ? raw : [raw];
  const m = new Map();
  for (const a of list) {
    if (!a || typeof a.Name !== 'string') continue;
    m.set(a.Name, { hardware: a.HardwareInterface === true, virtual: a.Virtual === true, description: String(a.InterfaceDescription || '') });
  }
  return m;
}

/** Linux: { available, byName: { [if]: { ifindex, iflink, devtype } } } from /sys/class/net. */
export function linuxNetFacts({ root = '/sys/class/net', fsImpl = fs } = {}) {
  const byName = {};
  let names;
  try { names = fsImpl.readdirSync(root); } catch { return { available: false, byName }; }
  for (const name of names) {
    const read = (f) => { try { return fsImpl.readFileSync(path.join(root, name, f), 'utf8').trim(); } catch { return null; } };
    const ifindex = Number(read('ifindex'));
    const iflink = Number(read('iflink'));
    const devtype = (/^DEVTYPE=(.*)$/m.exec(read('uevent') || '') || [])[1] || null;
    byName[name] = { ifindex: Number.isFinite(ifindex) ? ifindex : null, iflink: Number.isFinite(iflink) ? iflink : null, devtype };
  }
  return { available: names.length > 0, byName };
}
