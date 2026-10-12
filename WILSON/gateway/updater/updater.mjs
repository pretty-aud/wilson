// =============================================================================
// WilsonGatewayUpdater: the second Windows service (LocalSystem), the one
// thing that may swap files under Program Files, restart the gateway and
// change the firewall (design §8, R7; §10 row 24). It runs from
// C:\Program Files\WILSON Gateway\updater\ (its own node.exe and copy of the
// app), which only the MSI replaces, so it never swaps itself.
//
// At its own start: an unfinished swap (swap.json) is completed or reverted
// BEFORE the gateway service runs. Then it serves \\.\pipe\WilsonGatewayUpdater,
// one authenticated message per connection (pipe.mjs: everyone may connect,
// only a holder of pipe.key may say anything):
//
//   swap { artefact, manifest, signature }  answered at once, then swapped
//                                           (the swap stops the asker)
//   rollback                                current and previous exchanged
//   firewall_open { port } / firewall_close the outside door's inbound rule,
//                                           this program only, never the
//                                           inside door's port, never < 1024
//   smb_dialects                            Get-SmbConnection, which needs an
//                                           administrator (measured)
//
// NOTHING here runs on the computer that built it: the tests drive swap.mjs
// over a fake file system and assert the firewall's arguments only.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runSwap, recoverSwap, runRollback, swapPaths } from '../src/update/swap.mjs';
import { verifyManifest, verifyArtefact, compiledReleaseKeys } from '../src/update/manifest.mjs';
import { readTar, extractTo } from '../src/update/tar.mjs';
import { servePipe, loadOrMakePipeKey, pipePath, PIPES } from '../src/platform/pipe.mjs';
import { stateDirFor, programDirFor, FILES } from '../src/platform/state.mjs';
import { parseSmbConnections } from '../src/platform/shares.mjs';
import { parseConfig } from '../src/config.mjs';

export const GATEWAY_SERVICE = 'WilsonGateway';
export const FIREWALL_RULE = 'WILSON Gateway outside door';

const run = (file, args, timeout = 60_000) => new Promise((resolve) => {
  execFile(file, args, { windowsHide: true, timeout }, (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(stdout), err: String(stderr) }));
});

/** netsh's arguments for the outside door's rule: this program, inbound TCP on one port. */
export function firewallArgs(op, { port, program }) {
  if (op === 'close') return ['advfirewall', 'firewall', 'delete', 'rule', `name=${FIREWALL_RULE}`];
  return ['advfirewall', 'firewall', 'add', 'rule', `name=${FIREWALL_RULE}`, 'dir=in', 'action=allow', 'protocol=TCP', `localport=${port}`, `program=${program}`, 'enable=yes', 'profile=any'];
}

/** A port the updater will open: an integer from 1024 to 65535 and never the inside door's. */
export function firewallPortOk(port, insidePort) {
  return Number.isInteger(port) && port >= 1024 && port <= 65535 && port !== insidePort;
}

export function makeUpdaterEnv({ programDir, stateDir, keys = compiledReleaseKeys(), fsp = fs.promises, sc = (args) => run('sc.exe', args), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const paths = swapPaths(programDir, stateDir);
  async function waitState(want, ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const q = await sc(['query', GATEWAY_SERVICE]);
      if (new RegExp(`STATE\\s*:\\s*\\d+\\s+${want}`).test(q.out)) return true;
      await sleep(500);
    }
    return false;
  }
  return {
    paths,
    env: {
      fsp,
      now: () => Date.now(),
      sleep,
      service: {
        stop: async () => { await sc(['stop', GATEWAY_SERVICE]); await waitState('STOPPED', 30_000); },
        start: async () => { await sc(['start', GATEWAY_SERVICE]); },
      },
      runningVersion: async () => {
        try { return JSON.parse(await fsp.readFile(path.join(paths.current, 'app', 'package.json'), 'utf8')).version; } catch { return '0.0.0'; }
      },
      verify: async ({ manifestBytes, signatureText, archiveBytes, runningVersion, lastPublishedAt }) => {
        const v = verifyManifest({ manifestBytes, signatureText, keys, lastPublishedAt, runningVersion, platformKey: 'windows-x64' });
        if (!v.ok) return { ok: false, reason: v.reason };
        if (!v.newer) return { ok: false, reason: 'not_newer', version: v.manifest.version };
        if (!verifyArtefact(archiveBytes, v.manifest.artefacts['windows-x64'])) return { ok: false, reason: 'hash', version: v.manifest.version };
        return { ok: true, version: v.manifest.version, publishedAt: v.manifest.published_at };
      },
      extract: async (bytes, dir) => extractTo(readTar(bytes), dir, fsp),
    },
  };
}

async function main() {
  const stateDir = stateDirFor();
  const programDir = programDirFor();
  const { env, paths } = makeUpdaterEnv({ programDir, stateDir });
  const log = (event, detail = {}) => process.stdout.write(`${new Date().toISOString()} ${event} ${JSON.stringify(detail)}\n`);
  log('updater', { program: programDir, state: stateDir });
  const recovered = await recoverSwap(env, paths);
  if (recovered.action !== 'none') log('swap_recovered', recovered);

  await fs.promises.mkdir(stateDir, { recursive: true });
  const key = loadOrMakePipeKey(path.join(stateDir, FILES.pipeKey));
  const insidePort = () => { try { return parseConfig(fs.readFileSync(path.join(stateDir, FILES.config), 'utf8')).config.inside.port; } catch { return 8443; } };
  const program = path.win32.join(paths.current, 'node.exe');
  let busy = false;

  await servePipe({
    path: pipePath(PIPES.updater),
    key,
    listenOptions: { writableAll: true, readableAll: true },
    onError: (e) => log('pipe_error', { message: String(e.message).slice(0, 160) }),
    handler: async (m) => {
      switch (m?.type) {
        case 'swap': {
          if (busy) return { ok: false, reason: 'busy' };
          busy = true;
          setImmediate(async () => {
            try { log('swap_done', await runSwap(env, paths, m)); } catch (e) { log('swap_error', { message: String(e.message).slice(0, 200) }); } finally { busy = false; }
          });
          return { ok: true, accepted: true };
        }
        case 'rollback': {
          if (busy) return { ok: false, reason: 'busy' };
          busy = true;
          try { return await runRollback(env, paths); } finally { busy = false; }
        }
        case 'firewall_open':
        case 'firewall_close': {
          if (m.type === 'firewall_open' && !firewallPortOk(m.port, insidePort())) return { ok: false, reason: 'port refused' };
          await run('netsh.exe', firewallArgs('close', {}));
          if (m.type === 'firewall_close') return { ok: true };
          const r = await run('netsh.exe', firewallArgs('open', { port: m.port, program }));
          return r.code === 0 ? { ok: true } : { ok: false, reason: (r.out + r.err).trim().slice(0, 160) };
        }
        case 'smb_dialects': {
          const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-SmbConnection | Select-Object ServerName, ShareName, Dialect | ConvertTo-Json -Compress']);
          if (r.code !== 0) return { ok: false, reason: 'Get-SmbConnection failed' };
          try { return { ok: true, dialects: parseSmbConnections(r.out) }; } catch { return { ok: false, reason: 'unreadable' }; }
        }
        default:
          return { ok: false, reason: 'unknown message' };
      }
    },
  });
  log('updater_listening', { pipe: PIPES.updater });
  process.stdin.on('end', () => process.exit(0));
  process.stdin.resume();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { process.stderr.write(String(e?.stack || e) + '\n'); process.exit(1); });
}
