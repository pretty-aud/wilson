// =============================================================================
// Where the gateway keeps its own files (the brief, item 1): config.json,
// credential.bin, the root key and certificate, the leaf, the journal, the
// last accepted manifest, healthy. Never a frame of footage.
//
//   Windows    C:\ProgramData\WILSON Gateway\   (its ACL the installer's:
//              SYSTEM, Administrators, NT SERVICE\WilsonGateway)
//   container  /data                           (the NAS's volume; mode 600 files)
//
// WILSON_GATEWAY_STATE_DIR moves it (the tests, this computer's proofs); it
// moves files, it admits nothing.
// =============================================================================

import path from 'node:path';

export const FILES = Object.freeze({
  config: 'config.json',
  state: 'state.json',
  credential: 'credential.bin',
  journal: 'journal',
  certs: 'certs',
  healthy: 'healthy',
  status: 'status.json',
  enrol: 'enrol.json',
  enrolResult: 'enrol-result.json',
  pipeKey: 'pipe.key',
  shares: 'shares.bin',
  updates: 'updates',
  lastManifest: 'last-manifest.json',
  updateFailed: 'update-failed.json',
});

export function stateDirFor({ platform = process.platform, env = process.env } = {}) {
  if (env.WILSON_GATEWAY_STATE_DIR) return path.resolve(env.WILSON_GATEWAY_STATE_DIR);
  if (platform === 'win32') return path.win32.join(env.ProgramData || 'C:\\ProgramData', 'WILSON Gateway');
  return '/data';
}

export function fileIn(dir, name) {
  return path.join(dir, FILES[name] || name);
}

/** Program Files' layout (the service host, current\, previous\, staged\, the updater). */
export function programDirFor({ env = process.env } = {}) {
  return path.win32.join(env.ProgramFiles || 'C:\\Program Files', 'WILSON Gateway');
}
