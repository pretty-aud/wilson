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
  // Plaintext BY DESIGN, named for what they are (P8, TPN-ENC-014; HARDENING §3, §10):
  //   enrol.json  the one-time enrolment TOKEN the installer writes as SYSTEM for
  //               the service to spend (mode 600, 24 h, one use; deleted once spent)
  //   pipe.key    the updater pipe's key, 32 random bytes the installer makes as
  //               SYSTEM (mode 600; the two services read it, nobody else)
  // Everything else a secret goes through platform/secrets.mjs: DPAPI, or sealed.
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

/** Program Files' layout (the service host, current\, previous\, staged\, the updater). */
export function programDirFor({ env = process.env } = {}) {
  return path.win32.join(env.ProgramFiles || 'C:\\Program Files', 'WILSON Gateway');
}
